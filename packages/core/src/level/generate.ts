import { DARKNESS } from '../challenges';
import type { Heap, Item } from '../items';
import type { MobKind } from '../actors';
import type { PlantInfo } from '../plants';
import type { ArenaRing } from './arena';
import { deriveSeed, Rng, Stream } from '../rng';
import type { RunState } from '../run';
import type { World } from '../world';
import { isBossDepth, type ItemSpawn, type ItemSpec, LevelBuilder, type WellWater } from './builder';
import { SOLO_SPAN } from './geometry';
import { buildCavesBossLevel, CAVES_BOSS_STYLE } from './caves-boss';
import { buildCityBossLevel, CITY_BOSS_STYLE } from './city-boss';
import { buildHallsBossLevel, buildLastLevel, HALLS_BOSS_STYLE, LAST_STYLE } from './halls-boss';
import { buildPrisonBossLevel, PRISON_BOSS_STYLE } from './prison-boss';
import type { RegionStyle } from './regular';
import { buildSewerBossLevel, SEWER_BOSS_STYLE } from './sewer-boss';
import { RoomType } from './room';
import type { TrapInfo } from './trapdefs';
import { Dungeon, Feeling } from './gen/dungeon';
import type { BlobSpawn, CustomTile, GenLevel, LevelTransition, MobSpawn } from './gen/genlevel';
import { Random } from './gen/random';
import { levelCreateStart, RegularLevel } from './gen/regular-level';
import { regionFor } from './gen/regions';
import type { Room as GenRoom } from './gen/room';
import { resetPitRoom } from './gen/rooms/special/special';
import type { SacrificialFireSpawn } from './gen/rooms/special/sacrifice';
import './gen/rooms';
// The branch levels register themselves (BRANCH_LEVELS): the blacksmith's mine.
import './gen/mining-level';
import { BRANCH_LEVELS } from './gen/branches';

export { Feeling } from './gen/dungeon';

export interface RoomInfo {
  left: number;
  top: number;
  right: number;
  bottom: number;
  /** The room's role as Pixel Dungeon's layouts named it (the boss levels', and the world's few questions). */
  type: RoomType;
  /** The room's class in Shattered (e.g. 'SewerPipeRoom'), for Shattered's levels. */
  kind?: string;
  /** Standard, special, secret or connection room. */
  group?: string;
}

/** What a new level starts with, moved onto its floor when it is first made (world.ts levelAt). */
export interface LevelSpawn {
  heaps: Heap[];
  mobs: MobSpawn[];
  plants: PlantInfo[];
  blobs: BlobSpawn[];
  /** Dungeon.dropToChasm: what fell into a chasm while the level was made, for the depth below. */
  fallen?: Item[];
}

/** A generated level as plain, serialisable data. */
export interface Level {
  depth: number;
  /** Dungeon.branch: 1 for the side levels of the quests (the blacksmith's mine, the vault); absent for the main way. */
  branch?: number;
  /** The blacksmith's mine (MiningLevel): the kind of its quest, which shapes its look (crystals, gnolls' boulders, fungi). */
  mine?: 'crystal' | 'gnoll' | 'fungi';
  feeling: Feeling;
  /** Shattered's terrain ids (terrain.ts), WIDTH x HEIGHT. */
  map: number[];
  /** The level's own size in the grid's top-left corner (the rest is solid rock); absent: the whole grid. */
  width?: number;
  height?: number;
  entrance: number;
  exit: number;
  /** LevelTransition: the ways to other depths (the entrance and exit among them). */
  transitions?: LevelTransition[];
  rooms: RoomInfo[];
  /** The traps lying on the level, by cell (TRAP, SECRET_TRAP and INACTIVE_TRAP cells). */
  traps?: TrapInfo[];
  /** Level.viewDistance: how far the heroes see here. */
  viewDistance?: number;
  /** CustomTilemap: visuals over parts of the level (the client draws them). */
  customTiles?: CustomTile[];
  /** What the level is first made with; moved onto its floor (and dropped from here) when the depth is first visited. */
  spawn?: LevelSpawn;
  /** Item drops requested by the older layouts (the boss levels), rolled later from the item stream. */
  items: ItemSpawn[];
  /** Items to drop anywhere on the level, by the older layouts. */
  toSpawn: ItemSpec[];
  /** WallOfLight.LightWall: cells of solid light and the turns they have left (the Cleric's; nothing walks through them). */
  lightWall?: Record<number, number>;
  /** Magic wells that still hold water. */
  wells: Array<{ pos: number; water: WellWater }>;
  secretDoors: number;
  /** Tengu's level: the door into the arena. */
  arenaDoor?: number;
  /** A shop's level: where the shopkeeper stands. */
  shopkeeper?: number;
  /** Where the troll blacksmith keeps his forge. */
  blacksmith?: number;
  /** MagicalFireRoom's eternal fire: cells nothing passes through until frost, water or purity puts it out (roomblobs.ts). */
  eternalFire?: number[];
  /** Where the sacrificial fire of an altar room burns, and how much it hungers for. */
  altar?: { pos: number; volume: number; prize?: Item };
  /** Where the Rat King holds court, beside Goo's lair. */
  ratKing?: number;
  /** Where an animated statue stands guard, and a pool's piranhas swim (the older layouts). */
  statue?: number;
  piranhas?: number[];
  /** Plants the level starts with (the older layouts). */
  plants?: PlantInfo[];
  /** The region whose look the level takes (0 sewers .. 4 demon halls), when it is not its depth's. */
  region?: number;
  /** The arena of waves: its dais, gates and pens (level/arena.ts). */
  ring?: ArenaRing;
  /** Unused since Shattered's terrain (FURROWED_GRASS is a terrain of its own); kept for older saves' shape. */
  furrowed?: number[];
  /** Level.mobsToSpawn: what is left of the depth's rotation of monsters (MobSpawner, spawner.ts). */
  mobRotation?: MobKind[];
  /** Where a demon spawner pulses (DemonSpawnerRoom). SEAM(levels): the room places it; the monsters' stream raises it (ai.ts populate). */
  demonSpawner?: number;
  /** The cells that lead down besides `exit` (a boss level's LevelTransition area). */
  exits?: number[];
  /** A boss level's fixtures and the art laid over them (bosses/*.ts, the client's bossart.ts). */
  boss?: BossLevelInfo;
}

/**
 * A boss level's fixtures: where things stand that its fight needs (Goo's nest, DM-300's pylons and gate,
 * the King's throne and pedestals, the imp's shop, Yog's place) and Shattered's custom tiles laid over the
 * map (CustomTilemap: `sheet` is the texture, `tiles` its indices, -1 for none, `w` wide).
 */
export interface BossLevelInfo {
  /** Goo's nest (GooBossRoom.setupGooNest), Goo's room. */
  nest?: { x: number; y: number; w: number; h: number };
  gooRoom?: { left: number; top: number; right: number; bottom: number };
  /** DM-300's arena: its pylons. */
  pylons?: number[];
  /** The King's throne and summoning pedestals; the imp's shop room (ImpShopRoom) and its wares to come. */
  throne?: number;
  pedestals?: number[];
  impShop?: { left: number; top: number; right: number; bottom: number };
  /** Custom tiles laid over the map, drawn by the client. */
  art?: BossArt[];
}

export interface BossArt {
  sheet: 'sewer_boss' | 'prison_exit' | 'caves_boss' | 'city_boss' | 'halls_sp';
  x: number;
  y: number;
  w: number;
  tiles: number[];
  /** Under the characters (CustomTilemap in customTiles) or over them, as walls are (customWalls). */
  layer: 'ground' | 'wall';
}

/** The deepest depth the port can generate. */
export const DEEPEST_LEVEL = 26;

/** How each boss depth (and the Amulet's hall) is laid out: the older layouts, until the bosses stream brings Shattered's. */
function bossLayoutFor(depth: number): { style: RegionStyle; build: (level: LevelBuilder) => boolean } | null {
  if (depth === 5) return { style: SEWER_BOSS_STYLE, build: buildSewerBossLevel };
  if (depth === 10) return { style: PRISON_BOSS_STYLE, build: buildPrisonBossLevel };
  if (depth === 15) return { style: CAVES_BOSS_STYLE, build: buildCavesBossLevel };
  if (depth === 20) return { style: CITY_BOSS_STYLE, build: buildCityBossLevel };
  if (depth === 25) return { style: HALLS_BOSS_STYLE, build: buildHallsBossLevel };
  if (depth === 26) return { style: LAST_STYLE, build: buildLastLevel };
  return null;
}

const MAX_ATTEMPTS = 128;

/** Dungeon.seedForDepth: each depth (and branch) has its own stream. */
const depthSeed = (run: RunState, depth: number, branch: number): bigint =>
  branch === 0 ? deriveSeed(run.seed, Stream.LAYOUT, depth) : deriveSeed(run.seed, Stream.LAYOUT, depth, branch);

/**
 * Dungeon.newLevel and Level.create: makes the layout of `depth` (of `branch`, the quests' side levels)
 * for a run. Levels are made in order of depth: the special rooms' deck, the limited drops and the pit
 * below a weak floor carry from one to the next. `world` is what lies beyond the run (challenges,
 * quests); tests may leave it out.
 */
export function generateLevel(run: RunState, depth: number, span = SOLO_SPAN, _impQuestDone = false, world: World | null = null, branch = 0): Level {
  if (depth < 1 || depth > DEEPEST_LEVEL) throw new Error(`Depth ${depth} cannot be generated`);
  const rng = Rng.seeded(depthSeed(run, depth, branch));

  if (branch !== 0) {
    const make = BRANCH_LEVELS.get(depth);
    if (!make) throw new Error(`No branch level at depth ${depth}`);
    return Random.using(rng, () => Dungeon.generating({ depth, branch, run, world }, () => toLevel(make(), depth, branch)));
  }

  const boss = bossLayoutFor(depth);
  if (boss) return legacyLevel(run, depth, rng, boss, world);

  return Random.using(rng, () => Dungeon.generating({ depth, branch: 0, run, world }, () => {
    const config = regionFor(depth);
    const regular = new RegularLevel(config, Feeling.NONE);
    const level = regular.level;
    // Level.viewDistance: 8, or 2 under the darkness challenge; the halls darker the deeper.
    level.viewDistance = Dungeon.isChallenged(DARKNESS) ? 2 : 8;
    level.viewDistance = config.viewDistance?.(level.viewDistance) ?? level.viewDistance;
    config.create?.(level);
    levelCreateStart(level);
    let built = false;
    // A layout given up after painting (one too big for the grid) gives back the prizes its rooms took.
    const toSpawn = [...level.itemsToSpawn];
    for (let attempt = 0; attempt < MAX_ATTEMPTS && !built; attempt++) {
      level.resetContents();
      level.itemsToSpawn = toSpawn.map((item) => JSON.parse(JSON.stringify(item)) as Item);
      Dungeon.droppedToChasm = [];
      built = regular.build();
    }
    if (!built) throw new Error(`Unable to generate depth ${depth} after ${MAX_ATTEMPTS} attempts`);
    level.buildFlagMaps();
    regular.createMobs();
    regular.createItems();
    void span;
    return toLevel(level, depth, 0);
  }));
}

/** The plain-data Level of a level just made. */
export function toLevel(level: GenLevel, depth: number, branch: number): Level {
  const rooms: RoomInfo[] = level.rooms.map((r) => ({
    left: r.left, top: r.top, right: r.right, bottom: r.bottom, type: roomType(r), kind: r.kind, group: r.group,
  }));
  // Wells hold their water as a blob in Shattered; here, as the level's wells.
  const wells: Array<{ pos: number; water: WellWater }> = [];
  const blobs: BlobSpawn[] = [];
  for (const blob of level.blobs) {
    const water = WELL_WATERS[blob.kind];
    if (water) wells.push({ pos: blob.cell, water });
    else blobs.push(blob);
  }
  const altar = blobs.find((b) => b.kind === 'SacrificialFire');
  const shopkeeper = level.mobs.find((m) => m.kind === 'shopkeeper');
  return {
    depth,
    ...(branch !== 0 ? { branch } : {}),
    ...(level.mine ? { mine: level.mine } : {}),
    feeling: level.feeling,
    map: level.map,
    width: level.contentWidth || level.width,
    height: level.contentHeight || level.height,
    entrance: level.entrance(),
    exit: level.exit(),
    transitions: level.transitions,
    rooms,
    traps: [...level.traps.values()].sort((a, b) => a.pos - b.pos),
    viewDistance: level.viewDistance,
    ...(level.customTiles.length > 0 ? { customTiles: level.customTiles } : {}),
    ...(shopkeeper ? { shopkeeper: shopkeeper.pos } : {}),
    ...(level.mobRotation.length > 0 ? { mobRotation: [...level.mobRotation] } : {}),
    spawn: {
      heaps: [...level.heaps.values()].filter((h) => h.items.length > 0).sort((a, b) => a.pos - b.pos),
      mobs: level.mobs,
      plants: [...level.plants].map(([pos, kind]) => ({ pos, kind })),
      blobs: blobs.filter((b) => b !== altar),
      fallen: Dungeon.droppedToChasm,
    },
    items: [],
    toSpawn: [],
    wells,
    secretDoors: level.map.filter((t) => t === 16).length,
    ...(altar ? { altar: { pos: altar.cell, volume: altar.amount, ...((altar as SacrificialFireSpawn).prize ? { prize: (altar as SacrificialFireSpawn).prize } : {}) } } : {}),
  };
}

const WELL_WATERS: Readonly<Record<string, WellWater>> = {
  WaterOfHealth: 'health',
  WaterOfAwareness: 'awareness',
};

/** The role of a room as the older code asks after it. */
function roomType(r: GenRoom): RoomType {
  if (r.isEntrance()) return RoomType.ENTRANCE;
  if (r.isExit()) return RoomType.EXIT;
  switch (r.kind) {
    case 'WeakFloorRoom':
      return RoomType.WEAK_FLOOR;
    case 'PitRoom':
      return RoomType.PIT;
    case 'ShopRoom':
    case 'ImpShopRoom':
      return RoomType.SHOP;
    case 'GardenRoom':
    case 'SecretGardenRoom':
      return RoomType.GARDEN;
    case 'SacrificeRoom':
      return RoomType.ALTAR;
    case 'StatueRoom':
      return RoomType.STATUE;
    case 'PoolRoom':
      return RoomType.POOL;
    case 'CrystalVaultRoom':
      return RoomType.VAULT;
    case 'LaboratoryRoom':
      return RoomType.LABORATORY;
    case 'MagicWellRoom':
      return RoomType.MAGIC_WELL;
    case 'TrapsRoom':
      return RoomType.TRAPS;
    case 'StorageRoom':
      return RoomType.STORAGE;
    case 'TreasuryRoom':
      return RoomType.TREASURY;
    case 'ArmoryRoom':
      return RoomType.ARMORY;
    case 'LibraryRoom':
      return RoomType.LIBRARY;
    case 'CryptRoom':
      return RoomType.CRYPT;
  }
  if (r.group === 'standard') return RoomType.STANDARD;
  if (r.group === 'connection') return RoomType.TUNNEL;
  return RoomType.NULL;
}

/** The older layouts (the bosses' levels and the Amulet's hall), as Pixel Dungeon's port made them. */
function legacyLevel(run: RunState, depth: number, rng: Rng, layout: { style: RegionStyle; build: (level: LevelBuilder) => boolean }, world: World | null = null): Level {
  // A boss depth needs no pit room below a weak floor.
  Random.using(rng, () => Dungeon.generating({ depth, branch: 0, run, world: null }, () => resetPitRoom(depth)));
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const level = new LevelBuilder(rng, depth, Feeling.NONE, [], SOLO_SPAN);
    // The run's seed, for what a boss level redraws the same way every time (PrisonBossLevel's cages).
    level.layoutSeed = run.seed;
    // (The challenges are read while the layout is built: the caves' wires under the stronger bosses.)
    if (!Dungeon.generating({ depth, branch: 0, run, world }, () => layout.build(level))) continue;
    layout.style.decorate(level);
    return {
      depth,
      feeling: Feeling.NONE,
      map: level.map,
      entrance: level.entrance,
      exit: level.exit,
      rooms: level.rooms.map(({ left, top, right, bottom, type }) => ({ left, top, right, bottom, type })),
      traps: [...level.traps.values()].sort((a, b) => a.pos - b.pos),
      items: level.items,
      toSpawn: level.toSpawn,
      wells: level.wells,
      secretDoors: level.secretDoors,
      ...(isBossDepth(depth) || depth === 26 ? {} : {}),
      ...(level.arenaDoor >= 0 ? { arenaDoor: level.arenaDoor } : {}),
      ...(level.ratKing >= 0 ? { ratKing: level.ratKing } : {}),
      ...(level.exits.length > 0 ? { exits: level.exits } : {}),
      ...(level.boss ? { boss: level.boss } : {}),
    };
  }
  throw new Error(`Unable to generate depth ${depth} after ${MAX_ATTEMPTS} attempts`);
}
