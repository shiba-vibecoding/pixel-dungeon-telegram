import { castShadow } from '../../fov';
import { createItem, type HeapKind, type Item, itemDef } from '../../items';
import { DARKNESS, NO_SCROLLS } from '../../challenges';
import { HEIGHT, LENGTH, WIDTH } from '../geometry';
import { F, T, terrainFlags } from '../terrain';
import type { TrapKind } from '../trapdefs';
import { Builder } from './builders/builder';
import { FigureEightBuilder, LoopBuilder } from './builders/loop';
import { Dungeon, Feeling, limitedAdd, limitedDrop } from './dungeon';
import { GenLevel } from './genlevel';
import { Generator } from './generator';
import type { RegularPainter } from './painters/regular';
import { Random } from './random';
import type { Room } from './room';
import { seamItem } from './seams';
import { createSecretRoom, secretsForFloor } from './rooms/secret/secret';
import { createSpecialRoom, initSpecialsForFloor, isSpecial, SPECIAL_ROOMS } from './rooms/special/special';
import { createEntranceRoom, createExitRoom, createStandardRoom } from './rooms/standard/registry';
import { isStandard, type StandardRoom } from './rooms/standard/standard';
import { QuestHooks } from './quests';
import { lootCount, mobCount, partyRooms } from '../../party';

/*
 * levels/RegularLevel and Level.create: a level of rooms laid out by a builder (a loop or a figure
 * eight) and painted by the region's painter; then its monsters and items. The regions' levels
 * (SewerLevel ... HallsLevel) say how many rooms of each sort, the painter and the traps.
 */

export interface RegionConfig {
  /** standardRooms(forceMax). */
  standardRooms(forceMax: boolean): number;
  specialRooms(forceMax: boolean): number;
  painter(level: GenLevel, nTraps: number): RegularPainter;
  trapClasses(): readonly TrapKind[];
  trapChances(): readonly number[];
  /** Extra rooms (the quests', the halls' demon spawner): RegularLevel.initRooms overridden. */
  initRooms?(rooms: Room[]): Room[];
  /** Before the monsters (the sad ghost, the old wandmaker): RegularLevel.createMobs overridden. */
  beforeMobs?(level: RegularLevel): void;
  /** Items the level adds to spawn before it is made (the halls' torches). */
  create?(level: GenLevel): void;
  /** The level's view distance, after the feeling's (HallsLevel). */
  viewDistance?(viewDistance: number): number;
}

export class RegularLevel {
  readonly level: GenLevel;
  rooms: Room[] = [];
  roomEntrance: Room | null = null;
  roomExit: Room | null = null;

  constructor(readonly config: RegionConfig, feeling: Feeling) {
    this.level = new GenLevel(feeling);
  }

  protected builder(): Builder {
    if (Random.Int(2) === 0) {
      return new LoopBuilder().setLoopShape(2, Random.Float(0, 0.65), Random.Float(0, 0.5));
    }
    return new FigureEightBuilder().setLoopShape(2, Random.Float(0.3, 0.8), 0);
  }

  /** RegularLevel.nTraps. */
  nTraps(): number {
    return Random.NormalIntRange(2, 3 + Math.trunc(Dungeon.depth / 5));
  }

  protected initRooms(): Room[] {
    const feeling = this.level.feeling;
    const initRooms: Room[] = [];
    initRooms.push((this.roomEntrance = createEntranceRoom()));
    initRooms.push((this.roomExit = createExitRoom()));

    // Large levels have the most standard rooms, and half as many again.
    let standards = this.config.standardRooms(feeling === Feeling.LARGE);
    if (feeling === Feeling.LARGE) standards = Math.ceil(Math.fround(standards * 1.5));
    // A party's depths spread wider: more rooms for every hero past the first (party.ts).
    standards = partyRooms(standards, Dungeon.party);
    for (let i = 0; i < standards; i++) {
      let s: StandardRoom;
      do {
        s = createStandardRoom();
      } while (!s.setSizeCat(standards - i));
      i += s.sizeFactor() - 1;
      initRooms.push(s);
    }

    if (Dungeon.shopOnLevel()) initRooms.push((SPECIAL_ROOMS.get('ShopRoom') ?? SPECIAL_ROOMS.get('EmptySpecialRoom'))!());

    // The most special rooms, and one more, on large levels.
    let specials = this.config.specialRooms(feeling === Feeling.LARGE);
    if (feeling === Feeling.LARGE) specials++;
    initSpecialsForFloor();
    for (let i = 0; i < specials; i++) {
      const s = createSpecialRoom();
      if (s.kind === 'PitRoom') specials++;
      initRooms.push(s);
    }

    let secrets = secretsForFloor(Dungeon.depth);
    // One more on a level of secrets.
    if (feeling === Feeling.SECRETS) secrets++;
    for (let i = 0; i < secrets; i++) initRooms.push(createSecretRoom());

    return this.config.initRooms ? this.config.initRooms(initRooms) : initRooms;
  }

  /** RegularLevel.build: rooms laid out until the builder succeeds, then painted; then fitted into the world's grid. */
  build(): boolean {
    const builder = this.builder();
    const initRooms = this.initRooms();
    Random.shuffle(initRooms);
    let rooms: Room[] | null = null;
    // The original tries for ever; a level that will not lay out after this many tries is made anew.
    for (let attempt = 0; attempt < 200 && !rooms; attempt++) {
      for (const r of initRooms) {
        r.neigbours = [];
        r.connected.clear();
      }
      rooms = builder.build([...initRooms]);
    }
    if (!rooms) return false;
    this.rooms = rooms;
    const painter = this.config.painter(this.level, this.nTraps());
    if (!painter.paint(this.level, rooms)) return false;
    return fitToGrid(this.level);
  }

  /** Level.mobLimit: 3 to 5 more than the floor of the region; a third more on a large level; none on the first floor. */
  mobLimit(): number {
    if (Dungeon.depth <= 1) return Dungeon.world?.amuletTaken ? 10 : 0;
    let mobs = 3 + (Dungeon.depth % 5) + Random.Int(3);
    if (this.level.feeling === Feeling.LARGE) mobs = Math.ceil(Math.fround(mobs * 1.33));
    return mobs;
  }

  /**
   * RegularLevel.createMobs: eight on the first floor (enough for a second level), else the limit,
   * in the standard rooms by their weight, never within eight steps or in sight of the entrance;
   * now and then two to a room.
   */
  createMobs(): void {
    this.config.beforeMobs?.(this);
    const level = this.level;
    let mobsToSpawn = Dungeon.depth === 1 ? 8 : this.mobLimit();
    // More of them for a party (party.ts).
    mobsToSpawn = mobCount(mobsToSpawn, Dungeon.party);

    const stdRooms: Room[] = [];
    for (const room of this.rooms) {
      if (isStandard(room)) for (let i = 0; i < room.mobSpawnWeight(); i++) stdRooms.push(room);
    }
    Random.shuffle(stdRooms);
    if (stdRooms.length === 0) return;

    const entrance = level.entrance();
    const entranceFOV = castShadow(entrance, (cell) => level.losBlocking[cell] === true, 8);
    const walkable = level.solid.map((s) => !s);
    // Doors inside the entrance room are ignored for this walk, those on its edge are not.
    const re = this.roomEntrance!;
    for (let y = re.top + 1; y < re.bottom; y++) {
      for (let x = re.left + 1; x < re.right; x++) {
        const cell = x + y * level.width;
        if (level.passable[cell]) walkable[cell] = true;
      }
    }
    const near = distanceMap(level, entrance, walkable, 8);

    let index = 0;
    const tryPlace = (kind: ReturnType<typeof QuestHooks.createMob>, roomToSpawn: Room): number => {
      let tries = 30;
      let pos: number;
      do {
        pos = level.pointToCell(roomToSpawn.random());
        tries--;
      } while (tries >= 0 && (
        level.findMob(pos) !== undefined || entranceFOV[pos] || near[pos] !== undefined || !level.passable[pos] || level.solid[pos] ||
        !roomToSpawn.canPlaceCharacter(level.cellToPoint(pos), level) || pos === level.exit() || level.traps.has(pos) ||
        level.plants.has(pos) || (!level.openSpace[pos] && kind.large === true)
      ));
      return tries >= 0 ? pos : -1;
    };

    let pending: ReturnType<typeof QuestHooks.createMob> | null = null;
    let guard = 0;
    while (mobsToSpawn > 0 && guard++ < 10_000) {
      pending ??= QuestHooks.createMob();
      if (index >= stdRooms.length) index = 0;
      const roomToSpawn = stdRooms[index++]!;
      const pos = tryPlace(pending, roomToSpawn);
      if (pos >= 0) {
        mobsToSpawn--;
        level.mobs.push({ kind: pending.kind, pos, state: 'sleeping' });
        pending = null;
        // A chance of a second one in the room, but on the first floor.
        if (Dungeon.depth > 1 && mobsToSpawn > 0 && Random.Int(4) === 0) {
          pending = QuestHooks.createMob();
          const pos2 = tryPlace(pending, roomToSpawn);
          if (pos2 >= 0) {
            mobsToSpawn--;
            level.mobs.push({ kind: pending.kind, pos: pos2, state: 'sleeping' });
            pending = null;
          }
        }
      }
    }

    // Nobody hides in tall grass from the start.
    for (const m of level.mobs) {
      if (level.map[m.pos] === T.HIGH_GRASS || level.map[m.pos] === T.FURROWED_GRASS) level.set(m.pos, T.GRASS);
    }
  }

  /** RegularLevel.randomDropCell: a free cell in a room of a kind (standard by default), never the entrance room. */
  randomDropCell(group: 'standard' | 'special' = 'standard'): number {
    const level = this.level;
    for (let tries = 100; tries > 0; tries--) {
      const room = this.randomRoom(group);
      if (!room) return -1;
      if (room === this.roomEntrance) continue;
      const pos = level.pointToCell(room.random());
      if (level.passable[pos] && !level.solid[pos] && pos !== level.exit() && !level.heaps.has(pos) &&
        room.canPlaceItem(level.cellToPoint(pos), level) && !level.findMob(pos)) {
        // Never on a trap that would destroy what lies on it.
        const trap = level.traps.get(pos);
        if (!trap || !ITEM_DESTROYING_TRAPS.has(trap.kind)) return pos;
      }
    }
    return -1;
  }

  /** RegularLevel.randomRoom: shuffles the rooms and takes the first of a kind. */
  randomRoom(group: 'standard' | 'special'): Room | undefined {
    Random.shuffle(this.rooms);
    return this.rooms.find((r) => (group === 'standard' ? isStandard(r) : isSpecial(r)));
  }

  /** Clears tall grass where an item comes to lie (it would hide it). */
  private flatten(cell: number): void {
    const level = this.level;
    if (level.map[cell] === T.HIGH_GRASS || level.map[cell] === T.FURROWED_GRASS) level.set(cell, T.GRASS);
  }

  /**
   * RegularLevel.createItems: three to five finds (two more on a large level), now and then in a
   * chest, in remains or a mimic, the better ones locked in a chest whose golden key lies elsewhere;
   * then whatever the level has to spawn, and torches under the darkness challenge.
   */
  createItems(): void {
    const level = this.level;
    let nItems = 3 + Random.chances([6, 3, 1]);
    if (level.feeling === Feeling.LARGE) nItems += 2;
    // More to find for a party (party.ts).
    nItems = lootCount(nItems, Dungeon.party);

    for (let i = 0; i < nItems; i++) {
      const toDrop = Generator.random();
      const cell = this.randomDropCell();
      if (cell < 0) continue;
      this.flatten(cell);

      let type: HeapKind;
      let mimic = false;
      switch (Random.Int(20)) {
        case 0:
          type = 'skeleton';
          break;
        case 1:
        case 2:
        case 3:
        case 4:
          // SEAM(alchemy): MimicTooth.mimicChanceMultiplier, 1 without the trinket: (1-1)/4 never.
          Random.Float();
          type = 'chest';
          break;
        case 5:
          if (Dungeon.depth > 1 && !level.findMob(cell)) mimic = true;
          type = 'chest';
          break;
        default:
          type = 'heap';
      }
      if (mimic) {
        // SEAM(mobs): Mimic.spawnAt; a chest that is a mimic stands in.
        level.drop(toDrop, cell).kind = 'mimic';
        continue;
      }

      const upgradable = isUpgradable(toDrop);
      if (((itemDef(toDrop.kind).category as string) === 'artifact' && Random.Int(2) === 0) || (upgradable && Random.Int(4 - toDrop.level) === 0)) {
        const mimicChance = Math.fround(1 / 10);
        if (Dungeon.depth > 1 && Random.Float() < mimicChance && !level.findMob(cell)) {
          // SEAM(mobs): a golden mimic; a mimic chest stands in.
          level.drop(toDrop, cell).kind = 'mimic';
        } else {
          const dropped = level.drop(toDrop, cell);
          if (level.heaps.get(cell) === dropped) {
            dropped.kind = 'lockedChest';
            level.addItemToSpawn(goldenKey());
          }
        }
      } else {
        const dropped = level.drop(toDrop, cell);
        dropped.kind = type;
        // Heap.setHauntedIfCursed: remains with something cursed in them are haunted.
        if (type === 'skeleton' && toDrop.cursed) dropped.haunted = true;
      }
    }

    for (const item of level.itemsToSpawn) {
      const cell = this.randomDropCell();
      if (cell < 0) continue;
      level.drop(item, cell).kind = 'heap';
      this.flatten(cell);
    }

    // Separate streams, so the hero's belongings and meta progress never shift the level.
    Random.pushGenerator(Random.Long());
    if (Dungeon.isChallenged(DARKNESS)) {
      for (let n = level.feeling === Feeling.LARGE ? 2 : 1; n > 0; n--) {
        const cell = this.randomDropCell();
        if (cell < 0) continue;
        this.flatten(cell);
        level.drop(createItem('torch'), cell);
      }
    }
    Random.popGenerator();

    // Bones are laid by the world (bones.ts); the dried rose's petals, the cached rations talent,
    // the guide and lore pages, ebony mimics and the cracked spyglass's extra loot belong to systems
    // not ported here (SEAM(artifacts), SEAM(talents), SEAM(mobs), SEAM(alchemy)); their streams are
    // still drawn, so that adding them later moves nothing else.
    for (let i = 0; i < 7; i++) Random.Long();
  }
}

const ITEM_DESTROYING_TRAPS: ReadonlySet<TrapKind> = new Set<TrapKind>([
  'burning', 'blazing', 'chilling', 'frost', 'explosive', 'disintegration', 'pitfall',
]);

/** Item.isUpgradable, for what lies about: weapons, armour, thrown weapons, wands, rings, artifacts. */
function isUpgradable(item: Item): boolean {
  const category = itemDef(item.kind).category;
  return category === 'weapon' || category === 'armor' || category === 'missile' || category === 'wand' || category === 'ring';
}

const goldenKey = (): Item => ({ ...createItem('key.golden'), depth: Dungeon.depth });

/** PathFinder.buildDistanceMap(from, passable, limit): cells within `limit` steps (8-way), with their distance. */
function distanceMap(level: GenLevel, from: number, passable: boolean[], limit: number): Array<number | undefined> {
  const dist = new Array<number | undefined>(level.length);
  dist[from] = 0;
  const queue = [from];
  for (let head = 0; head < queue.length; head++) {
    const cell = queue[head]!;
    const d = dist[cell]!;
    if (d >= limit) continue;
    for (const n of level.neighbours8) {
      const next = cell + n;
      if (next < 0 || next >= level.length || dist[next] !== undefined || !passable[next]) continue;
      dist[next] = d + 1;
      queue.push(next);
    }
  }
  return dist;
}

/**
 * Fits a painted level into the world's grid (WIDTH x HEIGHT, the level in its top-left corner, solid
 * rock round it), moving everything placed on it to the grid's cell numbers. False if it does not fit.
 */
export function fitToGrid(level: GenLevel): boolean {
  if (level.width > WIDTH || level.height > HEIGHT) return false;
  if (level.width === WIDTH && level.length === LENGTH) return true;
  const w = level.width;
  const h = level.height;
  const move = (cell: number): number => (cell % w) + Math.trunc(cell / w) * WIDTH;
  const map = new Array<number>(LENGTH).fill(T.WALL);
  for (let i = 0; i < level.length; i++) map[move(i)] = level.map[i]!;
  level.width = WIDTH;
  level.height = HEIGHT;
  level.length = LENGTH;
  level.map = map;
  for (const t of level.transitions) t.cell = move(t.cell);
  for (const m of level.mobs) m.pos = move(m.pos);
  level.heaps = new Map([...level.heaps].map(([cell, heap]) => [move(cell), { ...heap, pos: move(cell) }]));
  level.traps = new Map([...level.traps].map(([cell, trap]) => [move(cell), { ...trap, pos: move(cell) }]));
  level.plants = new Map([...level.plants].map(([cell, plant]) => [move(cell), plant]));
  for (const b of level.blobs) b.cell = move(b.cell);
  level.contentWidth = w;
  level.contentHeight = h;
  level.buildFlagMaps();
  return true;
}

/** Level.create's items for every regular floor, and the feeling (half the floors have one). */
export function levelCreateStart(level: GenLevel): void {
  const run = Dungeon.run;
  // A helping of food for every hero, and what makes a hero stronger once for each (party.ts).
  const party = Dungeon.party;
  for (let i = 0; i < party; i++) level.addItemToSpawn(Generator.random('FOOD'));
  if (Dungeon.posNeeded()) {
    limitedAdd(run, 'STRENGTH_POTIONS');
    run.strengthFound = (run.strengthFound ?? 0) + 1;
    for (let i = 0; i < party; i++) level.addItemToSpawn(createItem('potion.strength'));
  }
  if (Dungeon.souNeeded()) {
    limitedAdd(run, 'UPGRADE_SCROLLS');
    run.upgradesFound = (run.upgradesFound ?? 0) + 1;
    // Every second scroll of upgrade is held back under forbidden runes.
    if (!Dungeon.isChallenged(NO_SCROLLS) || (run.limited?.UPGRADE_SCROLLS ?? 0) % 2 !== 0) {
      for (let i = 0; i < party; i++) level.addItemToSpawn(createItem('scroll.upgrade'));
    }
  }
  if (Dungeon.asNeeded()) {
    limitedAdd(run, 'ARCANE_STYLI');
    level.addItemToSpawn(seamItem('stylus'));
  }
  if (Dungeon.enchStoneNeeded()) {
    limitedDrop(run, 'ENCH_STONE');
    level.addItemToSpawn(seamItem('stoneOfEnchantment'));
  }
  if (Dungeon.intStoneNeeded()) {
    limitedDrop(run, 'INT_STONE');
    level.addItemToSpawn(seamItem('stoneOfIntuition'));
  }
  if (Dungeon.trinketCataNeeded()) {
    limitedDrop(run, 'TRINKET_CATA');
    level.addItemToSpawn(seamItem('trinketCatalyst'));
  }

  if (Dungeon.depth > 1) {
    // Half the floors have a feeling, each about one in fourteen.
    switch (Random.Int(14)) {
      case 0:
        level.feeling = Feeling.CHASM;
        break;
      case 1:
        level.feeling = Feeling.WATER;
        break;
      case 2:
        level.feeling = Feeling.GRASS;
        break;
      case 3:
        level.feeling = Feeling.DARK;
        level.viewDistance = Math.round((5 * level.viewDistance) / 8);
        break;
      case 4:
        level.feeling = Feeling.LARGE;
        level.addItemToSpawn(Generator.random('FOOD'));
        break;
      case 5:
        level.feeling = Feeling.TRAPS;
        break;
      case 6:
        level.feeling = Feeling.SECRETS;
        break;
      default:
        // SEAM(alchemy): the mossy clump and the trap mechanism trinkets may choose the feeling; without them, none.
        Random.Float();
        Random.Float();
        level.feeling = Feeling.NONE;
    }
  }
}

void terrainFlags;
void F;
