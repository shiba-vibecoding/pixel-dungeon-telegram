import type { ItemKind } from '../items';
import type { Rng } from '../rng';
import { Feeling } from './gen/dungeon';
import { cell, LENGTH, SOLO_SPAN, WIDTH, type Point, type Rect } from './geometry';
import { type Room } from './room';
import { T } from './terrain';
import type { TrapInfo, TrapKind } from './trapdefs';

/*
 * The older layouts' builder (Pixel Dungeon's): the bosses' levels and the Amulet's hall are still
 * made with it, until the bosses stream brings Shattered's. The regular levels are Shattered's
 * (level/gen).
 */

export enum HeapType {
  HEAP,
  FOR_SALE,
  CHEST,
  LOCKED_CHEST,
  CRYSTAL_CHEST,
  TOMB,
  SKELETON,
  MIMIC,
  HIDDEN,
}

/*
 * The older layouts only record *what* should appear where; items are rolled later from their own
 * random stream (items.ts createItems).
 */
export type ItemSpec =
  | { roll: 'random' }
  | { roll: 'gold' }
  /** A few loose coins (Gold(Random.IntRange(1, 3))). */
  | { roll: 'coins' }
  /** From one of the categories, keeping the best of `tries` rolls by upgrade level. */
  | { roll: 'category'; categories: ReadonlyArray<'weapon' | 'armor' | 'potion' | 'scroll' | 'food' | 'gold' | 'ring' | 'wand' | 'stone'>; tries: number }
  /** The iron key to this level's locked room. */
  | { roll: 'key' }
  /** The golden key to this level's locked or crystal chest. */
  | { roll: 'goldenKey' }
  /** A potion of liquid flame, to burn the way into a storage room. */
  | { roll: 'liquidFlame' }
  /** A few bombs, an armoury's prize now and then. */
  | { roll: 'bombs' }
  /** One of the Rat King's chests: mostly a few coins, now and then worn gear. */
  | { roll: 'kingsPrize' }
  /** One particular item, such as the wares of a shop. */
  | { roll: 'kind'; kind: ItemKind; qty?: number }
  /** A shop's melee weapon and set of thrown weapons of a tier, plain and known (ShopRoom.generateItems). */
  | { roll: 'shopWeapon'; tier: number }
  | { roll: 'shopMissile'; tier: number }
  /** Two darts tipped with a random seed (TippedDart.randomTipped(2)). */
  | { roll: 'tippedDarts' }
  /** An artifact the run has not dealt yet (or a ring, if it has none left). */
  | { roll: 'artifact' }
  /** ShopRoom's rare ware: now and then a wand, a ring or an artifact. */
  | { roll: 'rare' };

export type WellWater = 'health' | 'awareness' | 'transmutation';

export interface ItemSpawn {
  pos: number;
  heap: HeapType;
  item: ItemSpec;
}

/** Dungeon.bossLevel. */
export const isBossDepth = (depth: number): boolean => depth % 5 === 0 && depth > 0 && depth <= 25;
/** Dungeon.shopOnLevel: the shops of the regular levels. */
export const isShopDepth = (depth: number): boolean => depth === 6 || depth === 11 || depth === 16;

/** Mutable state of one level of the older layouts while it is being generated. */
export class LevelBuilder {
  readonly map = new Array<number>(LENGTH).fill(T.WALL);
  rooms: Room[] = [];
  roomEntrance: Room | null = null;
  roomExit: Room | null = null;
  entrance = -1;
  exit = -1;
  secretDoors = 0;
  /** Tengu's level: the locked door into the arena. */
  arenaDoor = -1;
  /** The run's seed, for what a level redraws the same way every time (PrisonBossLevel's cages: seedCurDepth). */
  layoutSeed = 0;
  /** A boss level's way down when it is more than one cell (LevelTransition's area). */
  exits: number[] = [];
  /** A boss level's own data for its fight and its visuals (Level.boss). */
  boss: import('./generate').BossLevelInfo | null = null;
  /** A shop's level: where the shopkeeper stands. */
  shopkeeper = -1;
  /** The caves: whether the troll blacksmith may set up his forge here, whether he did, and where he stands. */
  blacksmithWanted = false;
  blacksmithPlaced = false;
  blacksmith = -1;
  /** An altar room: where the sacrificial fire burns, and how much it hungers for. */
  altar: { pos: number; volume: number } | null = null;
  /** The sewers' boss level: where the Rat King sits in his hidden treasury. */
  ratKing = -1;
  readonly items: ItemSpawn[] = [];
  /** Items to drop anywhere on the level (Level.itemsToSpawn), such as keys. */
  readonly toSpawn: ItemSpec[] = [];
  /** Magic wells and their water. */
  readonly wells: Array<{ pos: number; water: WellWater }> = [];
  /** The traps laid, by cell. */
  readonly traps = new Map<number, TrapInfo>();

  constructor(
    readonly rng: Rng,
    readonly depth: number,
    readonly feeling: Feeling,
    /** Unused by the older layouts that remain. */
    readonly specials: unknown[],
    /** How many cells a side the level spreads over (the grid's top-left part). */
    readonly span = SOLO_SPAN,
  ) {
    if (feeling === Feeling.CHASM) {
      for (let y = 0; y < span; y++) for (let x = 0; x < span; x++) this.map[x + y * WIDTH] = T.CHASM;
    }
  }

  get bossLevel(): boolean {
    return isBossDepth(this.depth);
  }

  tunnelTile(): number {
    return this.feeling === Feeling.CHASM ? T.EMPTY_SP : T.EMPTY;
  }

  set(pos: number, value: number): void {
    this.map[pos] = value;
  }

  setXY(x: number, y: number, value: number): void {
    this.map[cell(x, y)] = value;
  }

  fill(x: number, y: number, w: number, h: number, value: number): void {
    for (let row = y; row < y + h; row++) {
      const start = row * WIDTH + x;
      this.map.fill(value, start, start + w);
    }
  }

  /** Fills a rect including its walls, shrunk by `m` on every side. */
  fillRect(rect: Rect, value: number, m = 0): void {
    this.fill(rect.left + m, rect.top + m, rect.width() + 1 - m * 2, rect.height() + 1 - m * 2, value);
  }

  /** Lays a trap: TRAP if visible, SECRET_TRAP if hidden. */
  setTrap(pos: number, kind: TrapKind, visible: boolean): void {
    this.map[pos] = visible ? T.TRAP : T.SECRET_TRAP;
    this.traps.set(pos, { pos, kind, visible, active: true });
  }

  /** A row of traps. */
  fillTraps(x: number, y: number, w: number, kind: TrapKind, visible: boolean): void {
    for (let i = x; i < x + w; i++) this.setTrap(cell(i, y), kind, visible);
  }

  /** Walks `n` cells into the room from a door, painting each one. */
  drawInside(room: Room, from: Point, n: number, value: number): Point {
    const step = { x: 0, y: 0 };
    if (from.x === room.left) step.x = 1;
    else if (from.x === room.right) step.x = -1;
    else if (from.y === room.top) step.y = 1;
    else if (from.y === room.bottom) step.y = -1;
    const p = { x: from.x + step.x, y: from.y + step.y };
    for (let i = 0; i < n; i++) {
      if (value !== -1) this.setXY(p.x, p.y, value);
      p.x += step.x;
      p.y += step.y;
    }
    return p;
  }

  dropItem(pos: number, heap: HeapType, item: ItemSpec): void {
    this.items.push({ pos, heap, item });
  }
}

/**
 * Pixel Dungeon's last shop (depth 21): Shattered has none — depth 21 is a halls level, and the imp keeps his shop
 * by the King's throne (CityBossLevel). Kept for the code that asks, matching no depth.
 */
export const LAST_SHOP_DEPTH = -1;

export { Feeling } from './gen/dungeon';
