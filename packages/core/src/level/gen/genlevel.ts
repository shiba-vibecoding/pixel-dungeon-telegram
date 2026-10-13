import type { Mob, MobKind } from '../../actors';
import type { Heap, HeapKind, Item } from '../../items';
import type { PlantKind } from '../../plants';
import { F, terrainFlags, T } from '../terrain';
import type { TrapInfo, TrapKind } from '../trapdefs';
import { TRAPS } from '../trapdefs';
import { Dungeon, Feeling } from './dungeon';
import { Point } from './rect';
import { Random } from './random';
import type { Room } from './room';

/*
 * levels/Level while it is being made: a map of its own size (Level.setSize, decided by the
 * painter once the builder has laid the rooms out), the flag maps, and what the rooms put on it —
 * heaps of items, monsters, traps, plants, gases and wells (blobs), the ways in and out
 * (LevelTransition) and custom visuals. generate.ts turns it into the world's Level once done.
 */

export type TransitionType = 'surface' | 'entrance' | 'exit' | 'branchEntrance' | 'branchExit';

/** levels/features/LevelTransition: a cell (or a rectangle of cells) leading to another depth. */
export interface LevelTransition {
  /** LevelTransition.centerCell: where a hero arriving here is put. */
  cell: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
  type: TransitionType;
  destDepth: number;
  destBranch: number;
  destType: TransitionType | null;
}

/** A monster or other character a room puts on the level; the world makes it into a Mob. */
export interface MobSpawn extends Partial<Omit<Mob, 'kind' | 'pos'>> {
  kind: MobKind;
  pos: number;
}

/** Blob.seed: a gas or a lasting effect on a cell (wells, the alchemy pot, the sacrificial fire, eternal fire...). */
export interface BlobSpawn {
  kind: string;
  cell: number;
  amount: number;
}

/** A custom visual over part of the level (CustomTilemap): what the client draws there. */
export interface CustomTile {
  /** The CustomTilemap's class name in Shattered (e.g. 'Carpet'): what the client names and describes. */
  kind: string;
  /** The texture: a file in Shattered's environment/custom_tiles (client: assets/spd/custom_tiles/<texture>.png). */
  texture?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Per-tile visuals, row by row, when the visual is laid out tile by tile (-1: nothing). */
  data?: number[];
  /** Anything else the visual needs (a variant). */
  variant?: number;
  /** Drawn above the characters (customWalls) rather than below them (customTiles). */
  wall?: boolean;
}

export class GenLevel {
  width = 0;
  height = 0;
  length = 0;
  map: number[] = [];
  feeling: Feeling;
  /** Level.viewDistance, as the feeling and region leave it. */
  viewDistance = 8;

  passable: boolean[] = [];
  losBlocking: boolean[] = [];
  flamable: boolean[] = [];
  secret: boolean[] = [];
  solid: boolean[] = [];
  avoid: boolean[] = [];
  water: boolean[] = [];
  pit: boolean[] = [];
  openSpace: boolean[] = [];

  transitions: LevelTransition[] = [];
  mobs: MobSpawn[] = [];
  heaps = new Map<number, Heap>();
  traps = new Map<number, TrapInfo>();
  plants = new Map<number, PlantKind>();
  blobs: BlobSpawn[] = [];
  customTiles: CustomTile[] = [];
  /** Level.itemsToSpawn: items to drop somewhere in the level once it is built. */
  itemsToSpawn: Item[] = [];
  /** Level.locked: a boss's level, sealed for the fight. */
  locked = false;
  rooms: Room[] = [];
  /** The level's own size, once it has been fitted into the world's grid (fitToGrid). */
  contentWidth = 0;
  contentHeight = 0;

  constructor(feeling: Feeling = Feeling.NONE) {
    this.feeling = feeling;
  }

  /** What Level.create clears before every attempt at building. */
  resetContents(): void {
    this.width = this.height = this.length = 0;
    this.transitions = [];
    this.mobs = [];
    this.heaps = new Map();
    this.blobs = [];
    this.plants = new Map();
    this.traps = new Map();
    this.customTiles = [];
    this.rooms = [];
  }

  /** Level.setSize: a new map of solid wall (or chasm, under a chasm feeling). */
  setSize(w: number, h: number): void {
    this.width = w;
    this.height = h;
    this.length = w * h;
    this.map = new Array<number>(this.length).fill(this.feeling === Feeling.CHASM ? T.CHASM : T.WALL);
    for (const key of ['passable', 'losBlocking', 'flamable', 'secret', 'solid', 'avoid', 'water', 'pit', 'openSpace'] as const) {
      this[key] = new Array<boolean>(this.length).fill(false);
    }
  }

  tunnelTile(): number {
    return this.feeling === Feeling.CHASM ? T.EMPTY_SP : T.EMPTY;
  }

  cellToPoint(cell: number): Point {
    return new Point(cell % this.width, Math.trunc(cell / this.width));
  }

  pointToCell(p: { x: number; y: number }): number {
    return p.x + p.y * this.width;
  }

  insideMap(cell: number): boolean {
    const x = cell % this.width;
    const y = Math.trunc(cell / this.width);
    return x >= 1 && y >= 1 && x < this.width - 1 && y < this.height - 1;
  }

  /** Level.entrance(): the way up's cell, or -1. */
  entrance(): number {
    return this.getTransition(null)?.cell ?? -1;
  }

  /** Level.exit(): the way down's cell, or -1. */
  exit(): number {
    return this.getTransition('exit')?.cell ?? -1;
  }

  /** Level.getTransition: of a type (null: the entrance, the surface's or the branch's), or the first. */
  getTransition(type: TransitionType | null): LevelTransition | undefined {
    if (this.transitions.length === 0) return undefined;
    for (const t of this.transitions) {
      if (type === null ? t.type === 'entrance' || t.type === 'surface' || t.type === 'branchEntrance' : t.type === type) return t;
    }
    return type === null ? this.transitions[0] : undefined;
  }

  /** new LevelTransition(level, cell, type), with Shattered's defaults for where it leads. */
  addTransition(cell: number, type: TransitionType, dest?: { depth: number; branch: number; type: TransitionType | null }): LevelTransition {
    const p = this.cellToPoint(cell);
    const t: LevelTransition = {
      cell, left: p.x, top: p.y, right: p.x, bottom: p.y, type,
      destDepth: dest?.depth ?? (type === 'exit' ? Dungeon.depth + 1 : type === 'surface' ? 0 : Dungeon.depth - 1),
      destBranch: dest?.branch ?? (type === 'surface' ? 0 : Dungeon.branch),
      destType: dest ? dest.type : type === 'exit' ? 'entrance' : type === 'surface' ? null : 'exit',
    };
    this.transitions.push(t);
    return t;
  }

  findMob(pos: number): MobSpawn | undefined {
    return this.mobs.find((m) => m.pos === pos);
  }

  /** Level.addItemToSpawn. */
  addItemToSpawn(item: Item | null | undefined): void {
    if (item) this.itemsToSpawn.push(item);
  }

  /** Level.findPrizeItem: one of the items still to spawn (a trinket catalyst first), taken out; or one of a kind. */
  findPrizeItem(match?: (item: Item) => boolean): Item | null {
    if (this.itemsToSpawn.length === 0) return null;
    if (!match) {
      const catalyst = this.itemsToSpawn.findIndex((item) => (item.kind as string) === TRINKET_CATALYST);
      if (catalyst >= 0) return this.itemsToSpawn.splice(catalyst, 1)[0]!;
      const item = Random.element(this.itemsToSpawn)!;
      this.itemsToSpawn.splice(this.itemsToSpawn.indexOf(item), 1);
      return item;
    }
    const index = this.itemsToSpawn.findIndex(match);
    return index < 0 ? null : this.itemsToSpawn.splice(index, 1)[0]!;
  }

  /**
   * Level.drop: adds an item to the heap on a cell (a new heap if none). Something dropped on a
   * locked or crystal chest rolls off to a cell next to it; null items (or what the challenges
   * forbid: see Dungeon.blocked) go nowhere, and a heap that is not kept is returned all the same.
   */
  drop(item: Item | null | undefined, cell: number): Heap {
    if (!item || Dungeon.itemBlocked(item)) return { pos: cell, kind: 'heap', items: [] };
    let heap = this.heaps.get(cell);
    if (!heap) {
      heap = { pos: cell, kind: 'heap', items: [item] };
      if (this.map[cell] === T.CHASM || this.pit[cell]) {
        // Dungeon.dropToChasm: it falls to the depth below (see generate.ts).
        Dungeon.droppedToChasm.push(item);
        return heap;
      }
      this.heaps.set(cell, heap);
    } else if (heap.kind === 'lockedChest' || heap.kind === 'crystalChest') {
      let n: number;
      do {
        n = cell + this.neighbours8[Random.Int(8)]!;
        // (The flag maps are not built yet while rooms are painted: the terrain's own flags decide.)
      } while ((terrainFlags[this.map[n]!]! & (F.PASSABLE | F.AVOID)) === 0);
      return this.drop(item, n);
    } else {
      // Heap.drop: new items go on top.
      heap.items.unshift(item);
    }
    return heap;
  }

  /** Sets a heap's type (Heap.type), as the rooms do right after dropping. */
  setHeapType(heap: Heap, kind: HeapKind): Heap {
    heap.kind = kind;
    return heap;
  }

  /** Level.plant at generation: tall grass, bare floor or embers become grass under the plant. */
  plant(kind: PlantKind, pos: number): void {
    const t = this.map[pos];
    if (t === T.HIGH_GRASS || t === T.FURROWED_GRASS || t === T.EMPTY || t === T.EMBERS || t === T.EMPTY_DECO) {
      this.set(pos, T.GRASS);
    }
    if (Dungeon.noHerbalism()) return;
    this.plants.set(pos, kind);
  }

  /** Level.setTrap. */
  setTrap(kind: TrapKind, pos: number, visible: boolean): TrapInfo {
    const trap: TrapInfo = { pos, kind, visible: visible || !TRAPS[kind].canBeHidden, active: true };
    this.traps.set(pos, trap);
    return trap;
  }

  /** Blob.seed. */
  seedBlob(cell: number, amount: number, kind: string): void {
    const existing = this.blobs.find((b) => b.kind === kind && b.cell === cell);
    if (existing) existing.amount += amount;
    else this.blobs.push({ kind, cell, amount });
  }

  /** Level.set: the terrain changes, and a trap no longer lies under what is not a trap cell. */
  set(cell: number, terrain: number): void {
    this.map[cell] = terrain;
    if (terrain !== T.TRAP && terrain !== T.SECRET_TRAP && terrain !== T.INACTIVE_TRAP) this.traps.delete(cell);
    this.updateCellFlags(cell);
  }

  /** Level.buildFlagMaps: the flag maps from the terrain, the level's edge closed. */
  buildFlagMaps(): void {
    for (let i = 0; i < this.length; i++) this.updateFlags(i);
    const lastRow = this.length - this.width;
    for (let i = 0; i < this.width; i++) {
      this.passable[i] = this.avoid[i] = false;
      this.losBlocking[i] = this.solid[i] = true;
      this.passable[lastRow + i] = this.avoid[lastRow + i] = false;
      this.losBlocking[lastRow + i] = this.solid[lastRow + i] = true;
    }
    for (let i = this.width; i < lastRow; i += this.width) {
      this.passable[i] = this.avoid[i] = false;
      this.losBlocking[i] = this.solid[i] = true;
      this.passable[i + this.width - 1] = this.avoid[i + this.width - 1] = false;
      this.losBlocking[i + this.width - 1] = this.solid[i + this.width - 1] = true;
    }
    for (let i = 0; i < this.length; i++) this.openSpaceAt(i);
  }

  updateCellFlags(cell: number): void {
    if (this.passable.length !== this.length) return;
    this.updateFlags(cell);
    for (const n of this.neighbours9) if (this.insideMap(cell + n)) this.openSpaceAt(cell + n);
  }

  private updateFlags(i: number): void {
    const flags = terrainFlags[this.map[i]!]!;
    this.passable[i] = (flags & F.PASSABLE) !== 0;
    this.losBlocking[i] = (flags & F.LOS_BLOCKING) !== 0;
    this.flamable[i] = (flags & F.FLAMABLE) !== 0;
    this.secret[i] = (flags & F.SECRET) !== 0;
    this.solid[i] = (flags & F.SOLID) !== 0;
    this.avoid[i] = (flags & F.AVOID) !== 0;
    this.water[i] = (flags & F.LIQUID) !== 0;
    this.pit[i] = (flags & F.PIT) !== 0;
  }

  /** An open space fits large monsters: not solid, with an open corner whose two sides are open too. */
  private openSpaceAt(i: number): void {
    if (this.solid[i]) {
      this.openSpace[i] = false;
      return;
    }
    const c = this.circle8;
    this.openSpace[i] = false;
    for (let j = 1; j < c.length; j += 2) {
      if (this.solid[i + c[j]!]) {
        this.openSpace[i] = false;
      } else if (!this.solid[i + c[(j + 1) % 8]!] && !this.solid[i + c[(j + 2) % 8]!]) {
        this.openSpace[i] = true;
        break;
      }
    }
  }

  /** PathFinder.NEIGHBOURS4/8/9 and CIRCLE4/8 for this level's width. */
  get neighbours4(): number[] {
    return [-this.width, -1, +1, +this.width];
  }
  get neighbours8(): number[] {
    const w = this.width;
    return [-w - 1, -w, -w + 1, -1, +1, +w - 1, +w, +w + 1];
  }
  get neighbours9(): number[] {
    const w = this.width;
    return [-w - 1, -w, -w + 1, -1, 0, +1, +w - 1, +w, +w + 1];
  }
  /** Clockwise from straight up. */
  get circle4(): number[] {
    return [-this.width, +1, +this.width, -1];
  }
  get circle8(): number[] {
    const w = this.width;
    return [-w - 1, -w, -w + 1, +1, +w + 1, +w, +w - 1, -1];
  }

  /** Level.distance: Chebyshev distance between cells. */
  distance(a: number, b: number): number {
    const ax = a % this.width;
    const ay = Math.trunc(a / this.width);
    const bx = b % this.width;
    const by = Math.trunc(b / this.width);
    return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
  }

  adjacent(a: number, b: number): boolean {
    return this.distance(a, b) === 1;
  }

  /** Level.trueDistance: Euclidean, as a float. */
  trueDistance(a: number, b: number): number {
    const ax = a % this.width;
    const ay = Math.trunc(a / this.width);
    const bx = b % this.width;
    const by = Math.trunc(b / this.width);
    return Math.fround(Math.sqrt((ax - bx) * (ax - bx) + (ay - by) * (ay - by)));
  }

  /** The room a cell is inside of (RegularLevel.room(pos)), if any. */
  room(cell: number): Room | undefined {
    const p = this.cellToPoint(cell);
    return this.rooms.find((r) => r.inside(p));
  }
}

const TRINKET_CATALYST = 'trinketCatalyst';
