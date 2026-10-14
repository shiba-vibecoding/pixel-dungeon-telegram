import { T } from './terrain';

/*
 * tiles/DungeonTileSheet: how each terrain is drawn from Shattered's tiles_*.png (16 tiles a row) —
 * flat floor tiles, water and chasms stitched to what is round them, raised walls and doors, and
 * the overhangs drawn above whoever stands below them. Kept in the core because level generation
 * asks some of the same questions (which tiles are floor, which stitch as walls); the client draws
 * with the rest (client/src/tiles.ts).
 */

const WIDTH = 16;
const xy = (x: number, y: number): number => x - 1 + WIDTH * (y - 1);

export const NULL_TILE = -1;

/* Floor tiles */
const GROUND = xy(1, 1);
export const FLOOR = GROUND + 0;
export const FLOOR_DECO = GROUND + 1;
export const GRASS = GROUND + 2;
export const EMBERS = GROUND + 3;
export const FLOOR_SP = GROUND + 4;
export const MINE_FLOOR_DECO_HEAVY = GROUND + 5;
export const FLOOR_ALT_1 = GROUND + 6;
export const FLOOR_DECO_ALT = GROUND + 7;
export const GRASS_ALT = GROUND + 8;
export const EMBERS_ALT = GROUND + 9;
export const FLOOR_SP_ALT = GROUND + 10;
export const MINE_FLOOR_DECO_HEAVY_ALT = GROUND + 11;
export const FLOOR_ALT_2 = GROUND + 12;
export const ENTRANCE = GROUND + 16;
export const EXIT = GROUND + 17;
export const WELL = GROUND + 18;
export const EMPTY_WELL = GROUND + 19;
export const PEDESTAL = GROUND + 20;
export const ENTRANCE_SP = GROUND + 22;

export const CHASM = xy(9, 2);
export const CHASM_FLOOR = CHASM + 1;
export const CHASM_FLOOR_SP = CHASM + 2;
export const CHASM_WALL = CHASM + 3;
export const CHASM_WATER = CHASM + 4;

/** Tiles that stitch with a chasm below them, and the stitching drawn. */
const chasmStitcheable = new Map<number, number>([
  [T.EMPTY, CHASM_FLOOR], [T.GRASS, CHASM_FLOOR], [T.EMBERS, CHASM_FLOOR], [T.EMPTY_WELL, CHASM_FLOOR], [T.HIGH_GRASS, CHASM_FLOOR],
  [T.FURROWED_GRASS, CHASM_FLOOR], [T.EMPTY_DECO, CHASM_FLOOR], [T.CUSTOM_DECO, CHASM_FLOOR], [T.WELL, CHASM_FLOOR],
  [T.STATUE, CHASM_FLOOR], [T.REGION_DECO, CHASM_FLOOR], [T.SECRET_TRAP, CHASM_FLOOR], [T.INACTIVE_TRAP, CHASM_FLOOR],
  [T.TRAP, CHASM_FLOOR], [T.BOOKSHELF, CHASM_FLOOR], [T.BARRICADE, CHASM_FLOOR], [T.PEDESTAL, CHASM_FLOOR],
  [T.CUSTOM_DECO_EMPTY, CHASM_FLOOR], [T.MINE_BOULDER, CHASM_FLOOR], [T.MINE_CRYSTAL, CHASM_FLOOR],
  [T.EMPTY_SP, CHASM_FLOOR_SP], [T.STATUE_SP, CHASM_FLOOR_SP],
  [T.WALL, CHASM_WALL], [T.DOOR, CHASM_WALL], [T.OPEN_DOOR, CHASM_WALL], [T.LOCKED_DOOR, CHASM_WALL], [T.HERO_LKD_DR, CHASM_WALL],
  [T.SECRET_DOOR, CHASM_WALL], [T.WALL_DECO, CHASM_WALL],
  [T.WATER, CHASM_WATER],
]);

/** DungeonTileSheet.stitchChasmTile: the chasm tile under a given tile; the alternate region decoration varies by region. */
export function stitchChasmTile(above: number, depth: number): number {
  if (above === T.REGION_DECO_ALT) {
    if (depth <= 5) return CHASM_FLOOR_SP;
    if (depth <= 10) return CHASM;
    if (depth <= 20) return CHASM_FLOOR_SP;
    return CHASM_FLOOR;
  }
  return chasmStitcheable.get(above) ?? CHASM;
}

/* Water */
export const WATER = xy(1, 3);

const waterStitcheableSet = new Set<number>([
  T.EMPTY, T.GRASS, T.EMPTY_WELL, T.ENTRANCE, T.EXIT, T.EMBERS, T.BARRICADE, T.HIGH_GRASS, T.FURROWED_GRASS, T.SECRET_TRAP, T.TRAP,
  T.INACTIVE_TRAP, T.EMPTY_DECO, T.CUSTOM_DECO, T.WELL, T.STATUE, T.REGION_DECO, T.ALCHEMY, T.CUSTOM_DECO_EMPTY, T.MINE_CRYSTAL,
  T.MINE_BOULDER, T.DOOR, T.OPEN_DOOR, T.LOCKED_DOOR, T.HERO_LKD_DR, T.CRYSTAL_DOOR,
]);

/** DungeonTileSheet.waterStitcheable: ground that water's edge is drawn against (the alternate decoration only in the halls). */
export function waterStitcheable(tile: number, depth: number): boolean {
  if (tile === T.REGION_DECO_ALT) return depth > 20;
  return waterStitcheableSet.has(tile);
}

/** +1 ground above, +2 right, +4 below, +8 left. */
export function stitchWaterTile(top: number, right: number, bottom: number, left: number, depth: number): number {
  let result = WATER;
  if (waterStitcheable(top, depth)) result += 1;
  if (waterStitcheable(right, depth)) result += 2;
  if (waterStitcheable(bottom, depth)) result += 4;
  if (waterStitcheable(left, depth)) result += 8;
  return result;
}

/* Flat tiles */
const FLAT_WALLS = xy(1, 4);
export const FLAT_WALL = FLAT_WALLS + 0;
export const FLAT_WALL_DECO = FLAT_WALLS + 1;
export const FLAT_BOOKSHELF = FLAT_WALLS + 2;
export const FLAT_WALL_ALT = FLAT_WALLS + 4;
export const FLAT_WALL_DECO_ALT = FLAT_WALLS + 5;
export const FLAT_BOOKSHELF_ALT = FLAT_WALLS + 6;
export const FLAT_DOOR = FLAT_WALLS + 8;
export const FLAT_DOOR_OPEN = FLAT_WALLS + 9;
export const FLAT_DOOR_LOCKED = FLAT_WALLS + 10;
export const FLAT_DOOR_CRYSTAL = FLAT_WALLS + 11;
export const UNLOCKED_EXIT = FLAT_WALLS + 12;
export const LOCKED_EXIT = FLAT_WALLS + 13;

const FLAT_OTHER = xy(1, 5);
export const FLAT_ALCHEMY_POT = FLAT_OTHER + 0;
export const FLAT_BARRICADE = FLAT_OTHER + 1;
export const FLAT_HIGH_GRASS = FLAT_OTHER + 2;
export const FLAT_FURROWED_GRASS = FLAT_OTHER + 3;
export const FLAT_HIGH_GRASS_ALT = FLAT_OTHER + 5;
export const FLAT_FURROWED_ALT = FLAT_OTHER + 6;
export const FLAT_STATUE = FLAT_OTHER + 8;
export const FLAT_STATUE_SP = FLAT_OTHER + 9;
export const FLAT_REGION_DECO = FLAT_OTHER + 10;
export const FLAT_REGION_DECO_ALT = FLAT_OTHER + 11;
export const FLAT_MINE_CRYSTAL = FLAT_OTHER + 12;
export const FLAT_MINE_CRYSTAL_ALT = FLAT_OTHER + 13;
export const FLAT_MINE_CRYSTAL_ALT_2 = FLAT_OTHER + 14;
export const FLAT_MINE_BOULDER = FLAT_OTHER + 12;
export const FLAT_MINE_BOULDER_ALT = FLAT_OTHER + 13;
export const FLAT_MINE_BOULDER_ALT_2 = FLAT_OTHER + 14;

/* Raised tiles, lower layer */
const RAISED_WALLS = xy(1, 6);
export const RAISED_WALL = RAISED_WALLS + 0;
export const RAISED_WALL_DECO = RAISED_WALLS + 4;
export const RAISED_WALL_DOOR = RAISED_WALLS + 8;
export const RAISED_WALL_BOOKSHELF = RAISED_WALLS + 12;
export const RAISED_WALL_ALT = RAISED_WALLS + 16;
export const RAISED_WALL_DECO_ALT = RAISED_WALLS + 20;
export const RAISED_WALL_BOOKSHELF_ALT = RAISED_WALLS + 28;

const wallStitcheableTiles = [T.WALL, T.WALL_DECO, T.SECRET_DOOR, T.LOCKED_EXIT, T.UNLOCKED_EXIT, T.BOOKSHELF, NULL_TILE];

/** DungeonTileSheet.wallStitcheable: tiles that count as wall when walls are stitched. */
export const wallStitcheable = (tile: number): boolean => wallStitcheableTiles.includes(tile as never);

const RAISED_DOORS = xy(1, 8);
export const RAISED_DOOR = RAISED_DOORS + 0;
export const RAISED_DOOR_OPEN = RAISED_DOORS + 1;
export const RAISED_DOOR_LOCKED = RAISED_DOORS + 2;
export const RAISED_DOOR_CRYSTAL = RAISED_DOORS + 3;
export const RAISED_DOOR_SIDEWAYS = RAISED_DOORS + 4;

const doorTiles = [T.DOOR, T.LOCKED_DOOR, T.HERO_LKD_DR, T.CRYSTAL_DOOR, T.OPEN_DOOR];
export const doorTile = (tile: number): boolean => doorTiles.includes(tile as never);

const RAISED_OTHER = xy(9, 8);
export const RAISED_ALCHEMY_POT = RAISED_OTHER + 0;
export const RAISED_BARRICADE = RAISED_OTHER + 1;
export const RAISED_HIGH_GRASS = RAISED_OTHER + 2;
export const RAISED_FURROWED_GRASS = RAISED_OTHER + 3;
export const RAISED_HIGH_GRASS_ALT = RAISED_OTHER + 5;
export const RAISED_FURROWED_ALT = RAISED_OTHER + 6;
export const RAISED_STATUE = RAISED_OTHER + 8;
export const RAISED_STATUE_SP = RAISED_OTHER + 9;
export const RAISED_REGION_DECO = RAISED_OTHER + 10;
export const RAISED_REGION_DECO_ALT = RAISED_OTHER + 11;
export const RAISED_MINE_CRYSTAL_BLUE_1 = RAISED_OTHER + 12;
export const RAISED_MINE_CRYSTAL_BLUE_2 = RAISED_OTHER + 13;
export const RAISED_MINE_CRYSTAL_GREEN_1 = RAISED_OTHER + 14;
export const RAISED_MINE_CRYSTAL_GREEN_2 = RAISED_OTHER + 15;
export const RAISED_MINE_CRYSTAL_RED_1 = RAISED_OTHER + 16;
export const RAISED_MINE_CRYSTAL_RED_2 = RAISED_OTHER + 17;
export const RAISED_MINE_BOULDER = RAISED_OTHER + 12;
export const RAISED_MINE_BOULDER_ALT = RAISED_OTHER + 13;
export const RAISED_MINE_BOULDER_ALT_2 = RAISED_OTHER + 14;

/* Raised tiles, upper layer */
export const WALLS_INTERNAL = xy(1, 10);
const WALL_INTERNAL = WALLS_INTERNAL + 0;
const WALL_INTERNAL_DECO = WALLS_INTERNAL + 16;
const WALL_INTERNAL_WOODEN = WALLS_INTERNAL + 32;

const WALLS_OVERHANG = xy(1, 13);
export const WALL_OVERHANG = WALLS_OVERHANG + 0;
export const WALL_OVERHANG_DECO = WALLS_OVERHANG + 4;
export const WALL_OVERHANG_WOODEN = WALLS_OVERHANG + 8;
export const DOOR_SIDEWAYS_OVERHANG = WALLS_OVERHANG + 16;
export const DOOR_SIDEWAYS_OVERHANG_CLOSED = WALLS_OVERHANG + 20;
export const DOOR_SIDEWAYS_OVERHANG_LOCKED = WALLS_OVERHANG + 24;
export const DOOR_SIDEWAYS_OVERHANG_CRYSTAL = WALLS_OVERHANG + 28;

export const DOOR_OVERHANG = xy(1, 15);
export const DOOR_OVERHANG_OPEN = DOOR_OVERHANG + 1;
export const DOOR_OVERHANG_CRYSTAL = DOOR_OVERHANG + 2;
export const DOOR_SIDEWAYS = DOOR_OVERHANG + 3;
export const DOOR_SIDEWAYS_LOCKED = DOOR_OVERHANG + 4;
export const DOOR_SIDEWAYS_CRYSTAL = DOOR_OVERHANG + 5;
export const EXIT_UNDERHANG = DOOR_OVERHANG + 6;

const OTHER_OVERHANG = xy(9, 15);
export const ALCHEMY_POT_OVERHANG = OTHER_OVERHANG + 0;
export const BARRICADE_OVERHANG = OTHER_OVERHANG + 1;
export const HIGH_GRASS_OVERHANG = OTHER_OVERHANG + 2;
export const FURROWED_OVERHANG = OTHER_OVERHANG + 3;
export const HIGH_GRASS_OVERHANG_ALT = OTHER_OVERHANG + 5;
export const FURROWED_OVERHANG_ALT = OTHER_OVERHANG + 6;
export const STATUE_OVERHANG = OTHER_OVERHANG + 8;
export const STATUE_SP_OVERHANG = OTHER_OVERHANG + 9;
export const REGION_DECO_OVERHANG = OTHER_OVERHANG + 10;
export const REGION_DECO_ALT_OVERHANG = OTHER_OVERHANG + 11;
export const MINE_CRYSTAL_OVERHANG_BLUE = OTHER_OVERHANG + 12;
export const MINE_CRYSTAL_OVERHANG_GREEN = OTHER_OVERHANG + 13;
export const MINE_CRYSTAL_OVERHANG_RED = OTHER_OVERHANG + 14;
export const MINE_BOULDER_OVERHANG = OTHER_OVERHANG + 12;
export const MINE_BOULDER_OVERHANG_ALT = OTHER_OVERHANG + 13;
export const MINE_BOULDER_OVERHANG_ALT_2 = OTHER_OVERHANG + 14;

/** DungeonTileSheet.directVisuals: tiles drawn as they are, with no stitching. */
export const directVisuals = new Map<number, number>([
  [T.EMPTY, FLOOR], [T.GRASS, GRASS], [T.EMPTY_WELL, EMPTY_WELL], [T.ENTRANCE, ENTRANCE], [T.EXIT, EXIT], [T.EMBERS, EMBERS],
  [T.PEDESTAL, PEDESTAL], [T.EMPTY_SP, FLOOR_SP], [T.ENTRANCE_SP, ENTRANCE_SP],
  [T.SECRET_TRAP, FLOOR], [T.TRAP, FLOOR], [T.INACTIVE_TRAP, FLOOR], [T.CUSTOM_DECO, FLOOR], [T.CUSTOM_DECO_EMPTY, FLOOR],
  [T.CUSTOM_DECO_WTR, WATER],
  [T.EMPTY_DECO, FLOOR_DECO], [T.LOCKED_EXIT, LOCKED_EXIT], [T.UNLOCKED_EXIT, UNLOCKED_EXIT], [T.WELL, WELL],
]);

/** DungeonTileSheet.directFlatVisuals: tiles drawn flat (when terrain is shown flat, and the raised tiles' base). */
export const directFlatVisuals = new Map<number, number>([
  [T.WALL, FLAT_WALL], [T.DOOR, FLAT_DOOR], [T.OPEN_DOOR, FLAT_DOOR_OPEN], [T.LOCKED_DOOR, FLAT_DOOR_LOCKED],
  [T.HERO_LKD_DR, FLAT_DOOR_LOCKED], [T.CRYSTAL_DOOR, FLAT_DOOR_CRYSTAL], [T.WALL_DECO, FLAT_WALL_DECO], [T.BOOKSHELF, FLAT_BOOKSHELF],
  [T.ALCHEMY, FLAT_ALCHEMY_POT], [T.BARRICADE, FLAT_BARRICADE], [T.HIGH_GRASS, FLAT_HIGH_GRASS], [T.FURROWED_GRASS, FLAT_FURROWED_GRASS],
  [T.STATUE, FLAT_STATUE], [T.STATUE_SP, FLAT_STATUE_SP], [T.REGION_DECO, FLAT_REGION_DECO], [T.REGION_DECO_ALT, FLAT_REGION_DECO_ALT],
  [T.MINE_CRYSTAL, FLAT_MINE_CRYSTAL], [T.MINE_BOULDER, FLAT_MINE_BOULDER], [T.SECRET_DOOR, FLAT_WALL],
]);

/** DungeonTileSheet.floorTile: water, and everything drawn as a plain floor tile. */
export function floorTile(tile: number): boolean {
  return tile === T.WATER || (directVisuals.get(tile) ?? CHASM) < CHASM;
}
