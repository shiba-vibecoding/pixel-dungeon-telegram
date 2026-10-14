import { T } from './terrain';
import {
  ALCHEMY_POT_OVERHANG, BARRICADE_OVERHANG, CHASM, directFlatVisuals, directVisuals, DOOR_OVERHANG, DOOR_OVERHANG_CRYSTAL,
  DOOR_OVERHANG_OPEN, DOOR_SIDEWAYS, DOOR_SIDEWAYS_CRYSTAL, DOOR_SIDEWAYS_LOCKED, DOOR_SIDEWAYS_OVERHANG, DOOR_SIDEWAYS_OVERHANG_CLOSED,
  DOOR_SIDEWAYS_OVERHANG_CRYSTAL, DOOR_SIDEWAYS_OVERHANG_LOCKED, doorTile, EMBERS, EMBERS_ALT, EXIT_UNDERHANG, FLAT_BOOKSHELF,
  FLAT_BOOKSHELF_ALT, FLAT_FURROWED_ALT, FLAT_FURROWED_GRASS, FLAT_HIGH_GRASS, FLAT_HIGH_GRASS_ALT, FLAT_MINE_BOULDER,
  FLAT_MINE_BOULDER_ALT, FLAT_MINE_BOULDER_ALT_2, FLAT_MINE_CRYSTAL, FLAT_MINE_CRYSTAL_ALT, FLAT_MINE_CRYSTAL_ALT_2, FLAT_WALL,
  FLAT_WALL_ALT, FLAT_WALL_DECO, FLAT_WALL_DECO_ALT, FLOOR, FLOOR_ALT_1, FLOOR_ALT_2, FLOOR_DECO, FLOOR_DECO_ALT, FLOOR_SP,
  FLOOR_SP_ALT, FURROWED_OVERHANG, FURROWED_OVERHANG_ALT, GRASS, GRASS_ALT, HIGH_GRASS_OVERHANG, HIGH_GRASS_OVERHANG_ALT,
  MINE_BOULDER_OVERHANG, MINE_BOULDER_OVERHANG_ALT, MINE_BOULDER_OVERHANG_ALT_2, MINE_CRYSTAL_OVERHANG_BLUE,
  MINE_CRYSTAL_OVERHANG_GREEN, MINE_CRYSTAL_OVERHANG_RED, MINE_FLOOR_DECO_HEAVY, MINE_FLOOR_DECO_HEAVY_ALT, NULL_TILE,
  RAISED_ALCHEMY_POT, RAISED_BARRICADE, RAISED_DOOR, RAISED_DOOR_CRYSTAL, RAISED_DOOR_LOCKED, RAISED_DOOR_OPEN,
  RAISED_DOOR_SIDEWAYS, RAISED_FURROWED_ALT, RAISED_FURROWED_GRASS, RAISED_HIGH_GRASS, RAISED_HIGH_GRASS_ALT,
  RAISED_MINE_BOULDER, RAISED_MINE_BOULDER_ALT, RAISED_MINE_BOULDER_ALT_2, RAISED_MINE_CRYSTAL_BLUE_1, RAISED_MINE_CRYSTAL_BLUE_2,
  RAISED_MINE_CRYSTAL_GREEN_1, RAISED_MINE_CRYSTAL_GREEN_2, RAISED_MINE_CRYSTAL_RED_1, RAISED_MINE_CRYSTAL_RED_2,
  RAISED_REGION_DECO, RAISED_REGION_DECO_ALT, RAISED_STATUE, RAISED_STATUE_SP, RAISED_WALL, RAISED_WALL_ALT,
  RAISED_WALL_BOOKSHELF, RAISED_WALL_BOOKSHELF_ALT, RAISED_WALL_DECO, RAISED_WALL_DECO_ALT, RAISED_WALL_DOOR,
  REGION_DECO_ALT_OVERHANG, REGION_DECO_OVERHANG, STATUE_OVERHANG, STATUE_SP_OVERHANG, stitchChasmTile, stitchWaterTile,
  WALL_OVERHANG, WALL_OVERHANG_DECO, WALL_OVERHANG_WOODEN, WALLS_INTERNAL, wallStitcheable, WATER,
} from './tilesheet';

/*
 * The rest of tiles/DungeonTileSheet and the tilemaps that use it (DungeonTerrainTilemap,
 * DungeonWallsTilemap, RaisedTerrainTilemap, TerrainFeaturesTilemap): which tile of Shattered's
 * sheets each cell is drawn with, in each layer. Pure functions of the map, for the client.
 */

const WALL_INTERNAL = WALLS_INTERNAL + 0;
const WALL_INTERNAL_DECO = WALLS_INTERNAL + 16;
const WALL_INTERNAL_WOODEN = WALLS_INTERNAL + 32;

type Alts = { chances: number[]; alts: number[] };

/** DungeonTileSheet.tileAltVisuals: chances (against a cell's 0-99 variance) for each alternate, the rarest last. */
const tileAltVisuals = new Map<number, Alts>([
  [FLOOR, { chances: [52.5, 5], alts: [FLOOR_ALT_1, FLOOR_ALT_2] }],
  [GRASS, { chances: [50], alts: [GRASS_ALT] }],
  [FLAT_WALL, { chances: [50], alts: [FLAT_WALL_ALT] }],
  [EMBERS, { chances: [50], alts: [EMBERS_ALT] }],
  [FLAT_WALL_DECO, { chances: [50], alts: [FLAT_WALL_DECO_ALT] }],
  [FLOOR_SP, { chances: [50], alts: [FLOOR_SP_ALT] }],
  [FLOOR_DECO, { chances: [50], alts: [FLOOR_DECO_ALT] }],
  [FLAT_BOOKSHELF, { chances: [50], alts: [FLAT_BOOKSHELF_ALT] }],
  [FLAT_HIGH_GRASS, { chances: [50], alts: [FLAT_HIGH_GRASS_ALT] }],
  [FLAT_FURROWED_GRASS, { chances: [50], alts: [FLAT_FURROWED_ALT] }],
  [RAISED_WALL, { chances: [50], alts: [RAISED_WALL_ALT] }],
  [RAISED_WALL_DECO, { chances: [50], alts: [RAISED_WALL_DECO_ALT] }],
  [RAISED_WALL_BOOKSHELF, { chances: [50], alts: [RAISED_WALL_BOOKSHELF_ALT] }],
  [RAISED_HIGH_GRASS, { chances: [50], alts: [RAISED_HIGH_GRASS_ALT] }],
  [RAISED_FURROWED_GRASS, { chances: [50], alts: [RAISED_FURROWED_ALT] }],
  [HIGH_GRASS_OVERHANG, { chances: [50], alts: [HIGH_GRASS_OVERHANG_ALT] }],
  [FURROWED_OVERHANG, { chances: [50], alts: [FURROWED_OVERHANG_ALT] }],
]);

/** DungeonTileSheet.updateAltVariants: the mine's crystals and boulders vary with its quest. */
const crystalAlts = new Map<number, Alts>([
  [FLAT_MINE_CRYSTAL, { chances: [66.7, 33.3], alts: [FLAT_MINE_CRYSTAL_ALT, FLAT_MINE_CRYSTAL_ALT_2] }],
  [RAISED_MINE_CRYSTAL_BLUE_1, {
    chances: [83.3, 66.7, 50, 33.3, 16.7],
    alts: [RAISED_MINE_CRYSTAL_BLUE_2, RAISED_MINE_CRYSTAL_GREEN_1, RAISED_MINE_CRYSTAL_GREEN_2, RAISED_MINE_CRYSTAL_RED_1, RAISED_MINE_CRYSTAL_RED_2],
  }],
  [MINE_CRYSTAL_OVERHANG_BLUE, { chances: [66.7, 33.3], alts: [MINE_CRYSTAL_OVERHANG_GREEN, MINE_CRYSTAL_OVERHANG_RED] }],
]);
const gnollAlts = new Map<number, Alts>([
  [MINE_FLOOR_DECO_HEAVY, { chances: [50], alts: [MINE_FLOOR_DECO_HEAVY_ALT] }],
  [FLAT_MINE_BOULDER, { chances: [66.7, 33.3], alts: [FLAT_MINE_BOULDER_ALT, FLAT_MINE_BOULDER_ALT_2] }],
  [RAISED_MINE_BOULDER, { chances: [66.7, 33.3], alts: [RAISED_MINE_BOULDER_ALT, RAISED_MINE_BOULDER_ALT_2] }],
  [MINE_BOULDER_OVERHANG, { chances: [66.7, 33.3], alts: [MINE_BOULDER_OVERHANG_ALT, MINE_BOULDER_OVERHANG_ALT_2] }],
]);

/** What a level's tiles are drawn from: its map and width, its depth, the mine's kind if it is the blacksmith's mine, and each cell's variance (0-99). */
export interface TileContext {
  map: readonly number[];
  width: number;
  depth: number;
  /** The blacksmith's mine (MiningLevel): its quest varies the crystals and boulders, and decorates inner walls. */
  mine?: 'crystal' | 'gnoll' | 'fungi';
  variance: Uint8Array;
}

/** DungeonTileSheet.getVisualWithAlts: priority runs back to front, so the rarest alternates come last. */
export function getVisualWithAlts(ctx: TileContext, visual: number, pos: number): number {
  const alts = tileAltVisuals.get(visual) ?? (ctx.mine === 'crystal' ? crystalAlts.get(visual) : ctx.mine === 'gnoll' ? gnollAlts.get(visual) : undefined);
  if (!alts) return visual;
  const variance = ctx.variance[pos] ?? 0;
  for (let i = 0; i < alts.chances.length; i++) if (variance < alts.chances[i]!) visual = alts.alts[i]!;
  return visual;
}

/** DungeonTileSheet.getRaisedWallTile: +1 open to the right, +2 open to the left; -1 under another wall. */
export function getRaisedWallTile(ctx: TileContext, tile: number, pos: number, right: number, below: number, left: number): number {
  let result: number;
  if (below === -1 || wallStitcheable(below)) return -1;
  else if (doorTile(below)) result = RAISED_WALL_DOOR;
  else if (tile === T.WALL || tile === T.SECRET_DOOR) result = RAISED_WALL;
  else if (tile === T.WALL_DECO) result = RAISED_WALL_DECO;
  else if (tile === T.BOOKSHELF) result = RAISED_WALL_BOOKSHELF;
  else return -1;
  result = getVisualWithAlts(ctx, result, pos);
  if (!wallStitcheable(right)) result += 1;
  if (!wallStitcheable(left)) result += 2;
  return result;
}

/** DungeonTileSheet.getRaisedDoorTile. */
export function getRaisedDoorTile(tile: number, below: number): number {
  if (wallStitcheable(below)) return RAISED_DOOR_SIDEWAYS;
  if (tile === T.DOOR) return RAISED_DOOR;
  if (tile === T.OPEN_DOOR) return RAISED_DOOR_OPEN;
  if (tile === T.LOCKED_DOOR || tile === T.HERO_LKD_DR) return RAISED_DOOR_LOCKED;
  if (tile === T.CRYSTAL_DOOR) return RAISED_DOOR_CRYSTAL;
  return -1;
}

/** DungeonTileSheet.stitchInternalWallTile: +1 open right, +2 open right-below, +4 open left-below, +8 open left. */
export function stitchInternalWallTile(ctx: TileContext, tile: number, right: number, rightBelow: number, below: number, leftBelow: number, left: number): number {
  let result: number;
  if (tile === T.BOOKSHELF || below === T.BOOKSHELF) result = WALL_INTERNAL_WOODEN;
  // Only the mine's walls are decorated on top.
  else if (ctx.mine && tile === T.WALL_DECO) result = WALL_INTERNAL_DECO;
  else result = WALL_INTERNAL;
  if (!wallStitcheable(right)) result += 1;
  if (!wallStitcheable(rightBelow)) result += 2;
  if (!wallStitcheable(leftBelow)) result += 4;
  if (!wallStitcheable(left)) result += 8;
  return result;
}

/** DungeonTileSheet.stitchWallOverhangTile: +1 open down-right, +2 open down-left. */
export function stitchWallOverhangTile(ctx: TileContext, tile: number, rightBelow: number, below: number, leftBelow: number): number {
  let visual: number;
  if (tile === T.OPEN_DOOR) visual = DOOR_SIDEWAYS_OVERHANG;
  else if (tile === T.DOOR) visual = DOOR_SIDEWAYS_OVERHANG_CLOSED;
  else if (tile === T.LOCKED_DOOR || tile === T.HERO_LKD_DR) visual = DOOR_SIDEWAYS_OVERHANG_LOCKED;
  else if (tile === T.CRYSTAL_DOOR) visual = DOOR_SIDEWAYS_OVERHANG_CRYSTAL;
  else if (ctx.mine && below === T.WALL_DECO) visual = WALL_OVERHANG_DECO;
  else if (below === T.BOOKSHELF) visual = WALL_OVERHANG_WOODEN;
  else visual = WALL_OVERHANG;
  if (!wallStitcheable(rightBelow)) visual += 1;
  if (!wallStitcheable(leftBelow)) visual += 2;
  return visual;
}

/**
 * DungeonTerrainTilemap.getTileVisual (raised): the ground layer, under everything — floors, water's
 * edges and chasms stitched to their neighbours, the faces of walls, doors, statues, tall grass.
 * -1: nothing.
 */
export function terrainVisual(ctx: TileContext, pos: number): number {
  const { map, width } = ctx;
  const tile = map[pos]!;
  const size = map.length;
  const direct = directVisuals.get(tile);
  if (direct !== undefined) {
    let visual = direct;
    // The mine's floor by its boulders is heavier with rubble.
    if (visual === FLOOR_DECO && ctx.mine) {
      for (const n of [-width, -1, 1, width]) {
        if (map[pos + n] === T.MINE_BOULDER) {
          visual = MINE_FLOOR_DECO_HEAVY;
          break;
        }
      }
    }
    return getVisualWithAlts(ctx, visual, pos);
  }
  if (tile === T.WATER) {
    return stitchWaterTile(map[pos - width] ?? -1, map[pos + 1] ?? -1, map[pos + width] ?? -1, map[pos - 1] ?? -1, ctx.depth);
  }
  if (tile === T.CHASM) return stitchChasmTile(pos > width ? map[pos - width]! : -1, ctx.depth);
  if (doorTile(tile)) return getRaisedDoorTile(tile, map[pos - width] ?? -1);
  if (wallStitcheable(tile)) {
    return getRaisedWallTile(
      ctx, tile, pos,
      (pos + 1) % width !== 0 ? map[pos + 1]! : -1,
      pos + width < size ? map[pos + width]! : -1,
      pos % width !== 0 ? map[pos - 1]! : -1,
    );
  }
  switch (tile) {
    case T.STATUE:
      return RAISED_STATUE;
    case T.STATUE_SP:
      return RAISED_STATUE_SP;
    case T.REGION_DECO:
      return RAISED_REGION_DECO;
    case T.REGION_DECO_ALT:
      return RAISED_REGION_DECO_ALT;
    case T.MINE_CRYSTAL:
      return getVisualWithAlts(ctx, RAISED_MINE_CRYSTAL_BLUE_1, pos);
    case T.MINE_BOULDER:
      return getVisualWithAlts(ctx, RAISED_MINE_BOULDER, pos);
    case T.ALCHEMY:
      return RAISED_ALCHEMY_POT;
    case T.BARRICADE:
      return RAISED_BARRICADE;
    case T.HIGH_GRASS:
      return getVisualWithAlts(ctx, RAISED_HIGH_GRASS, pos);
    case T.FURROWED_GRASS:
      return getVisualWithAlts(ctx, RAISED_FURROWED_GRASS, pos);
    default:
      return NULL_TILE;
  }
}

/** DungeonTerrainTilemap.tile (flat): a terrain's tile as a picture (a window's icon of a cell). */
export function flatVisual(ctx: TileContext, pos: number, tile: number): number {
  const direct = directVisuals.get(tile);
  if (direct !== undefined) return getVisualWithAlts(ctx, direct, pos);
  if (tile === T.WATER) return WATER + 15;
  if (tile === T.CHASM) return CHASM;
  const flat = directFlatVisuals.get(tile);
  return flat === undefined ? NULL_TILE : getVisualWithAlts(ctx, flat, pos);
}

/**
 * DungeonWallsTilemap.getTileVisual: the upper layer, over the characters — the tops of walls, and
 * what overhangs the cell below (a wall's lip, a door's lintel, a statue's or tall grass's top).
 * `inside`: Level.insideMap.
 */
export function wallsVisual(ctx: TileContext, pos: number, inside: (cell: number) => boolean): number {
  const { map, width } = ctx;
  const tile = map[pos]!;
  const size = map.length;
  const below = pos + width < size ? map[pos + width]! : -1;
  if (wallStitcheable(tile)) {
    if (pos + width < size && !wallStitcheable(below)) {
      if (below === T.DOOR) return DOOR_SIDEWAYS;
      if (below === T.LOCKED_DOOR || below === T.HERO_LKD_DR) return DOOR_SIDEWAYS_LOCKED;
      if (below === T.CRYSTAL_DOOR) return DOOR_SIDEWAYS_CRYSTAL;
      if (below === T.OPEN_DOOR) return NULL_TILE;
    } else {
      return stitchInternalWallTile(
        ctx, tile,
        (pos + 1) % width !== 0 ? map[pos + 1]! : -1,
        (pos + 1) % width !== 0 && pos + width < size ? map[pos + 1 + width]! : -1,
        below,
        pos % width !== 0 && pos + width < size ? map[pos - 1 + width]! : -1,
        pos % width !== 0 ? map[pos - 1]! : -1,
      );
    }
  }
  if (tile === T.LOCKED_EXIT || tile === T.UNLOCKED_EXIT) return EXIT_UNDERHANG;
  if (pos + width < size && wallStitcheable(below)) {
    return stitchWallOverhangTile(ctx, tile, (pos + 1) % width !== 0 ? map[pos + 1 + width]! : -1, below, pos % width !== 0 ? map[pos - 1 + width]! : -1);
  }
  if (inside(pos)) {
    if (below === T.DOOR || below === T.LOCKED_DOOR || below === T.HERO_LKD_DR) return DOOR_OVERHANG;
    if (below === T.OPEN_DOOR) return DOOR_OVERHANG_OPEN;
    if (below === T.CRYSTAL_DOOR) return DOOR_OVERHANG_CRYSTAL;
  }
  if (pos + width < size) {
    switch (below) {
      case T.STATUE:
        return STATUE_OVERHANG;
      case T.STATUE_SP:
        return STATUE_SP_OVERHANG;
      case T.REGION_DECO:
        return REGION_DECO_OVERHANG;
      case T.REGION_DECO_ALT:
        return REGION_DECO_ALT_OVERHANG;
      case T.MINE_CRYSTAL:
        return getVisualWithAlts(ctx, MINE_CRYSTAL_OVERHANG_BLUE, pos + width);
      case T.MINE_BOULDER:
        return getVisualWithAlts(ctx, MINE_BOULDER_OVERHANG, pos + width);
      case T.ALCHEMY:
        return ALCHEMY_POT_OVERHANG;
      case T.BARRICADE:
        return BARRICADE_OVERHANG;
      case T.HIGH_GRASS:
        return getVisualWithAlts(ctx, HIGH_GRASS_OVERHANG, pos + width);
      case T.FURROWED_GRASS:
        return getVisualWithAlts(ctx, FURROWED_OVERHANG, pos + width);
    }
  }
  return NULL_TILE;
}

/** RaisedTerrainTilemap.getTileVisual (raised_terrain.png, 4 a row): the tops of tall grass, over the characters. */
export function raisedVisual(ctx: TileContext, pos: number): number {
  const tile = ctx.map[pos]!;
  const regionOffset = Math.trunc((ctx.depth - 1) / 5) * 4;
  if (tile === T.HIGH_GRASS) return regionOffset + (getVisualWithAlts(ctx, RAISED_HIGH_GRASS, pos) === RAISED_HIGH_GRASS_ALT ? 2 : 0);
  if (tile === T.FURROWED_GRASS) return regionOffset + 1 + (getVisualWithAlts(ctx, RAISED_FURROWED_GRASS, pos) === RAISED_FURROWED_ALT ? 2 : 0);
  return NULL_TILE;
}

/**
 * TerrainFeaturesTilemap.getTileVisual (terrain_features.png, 16 a row): a trap (its colour and
 * shape, black once spent), a plant, or the region's grass, barricade, pot, statue and decorations
 * over the ground. `trap`: the trap's visual (trapVisual), -1 for no trap, -2 for a hidden one;
 * `plant`: the plant's image, or -1.
 */
export function featuresVisual(ctx: TileContext, pos: number, trap: number, plant: number): number {
  if (trap !== -1) return trap === -2 ? NULL_TILE : trap;
  if (plant >= 0) return plant + 7 * 16;
  const tile = ctx.map[pos]!;
  const stage = Math.min(Math.trunc((ctx.depth - 1) / 5), 4);
  switch (tile) {
    case T.HIGH_GRASS:
      return 128 + 16 * stage + (getVisualWithAlts(ctx, RAISED_HIGH_GRASS, pos) === RAISED_HIGH_GRASS_ALT ? 1 : 0);
    case T.FURROWED_GRASS:
      return 130 + 16 * stage + (getVisualWithAlts(ctx, RAISED_FURROWED_GRASS, pos) === RAISED_FURROWED_ALT ? 1 : 0);
    case T.GRASS:
      return 132 + 16 * stage + (getVisualWithAlts(ctx, GRASS, pos) === GRASS_ALT ? 1 : 0);
    case T.BARRICADE:
      return 134 + 16 * stage;
    case T.ALCHEMY:
      return 135 + 16 * stage;
    case T.STATUE:
    case T.STATUE_SP:
      return 136 + 16 * stage;
    case T.REGION_DECO:
      return 137 + 16 * stage;
    case T.REGION_DECO_ALT:
      return 138 + 16 * stage;
    case T.EMBERS:
      return 208 + (getVisualWithAlts(ctx, EMBERS, pos) === EMBERS_ALT ? 1 : 0);
    case T.MINE_CRYSTAL: {
      const vis = getVisualWithAlts(ctx, RAISED_MINE_CRYSTAL_BLUE_1, pos);
      const order = [RAISED_MINE_CRYSTAL_BLUE_1, RAISED_MINE_CRYSTAL_BLUE_2, RAISED_MINE_CRYSTAL_GREEN_1, RAISED_MINE_CRYSTAL_GREEN_2,
        RAISED_MINE_CRYSTAL_RED_1, RAISED_MINE_CRYSTAL_RED_2];
      return 210 + Math.max(0, order.indexOf(vis));
    }
    case T.MINE_BOULDER: {
      const vis = getVisualWithAlts(ctx, RAISED_MINE_BOULDER, pos);
      return 216 + (vis === RAISED_MINE_BOULDER_ALT_2 ? 2 : vis === RAISED_MINE_BOULDER_ALT ? 1 : 0);
    }
  }
  return NULL_TILE;
}

/** Which cells WallOcclusionTilemap shades (occlusion_shadows.png, 8 a row), round the walls. */
export function occlusionVisual(ctx: TileContext, pos: number, discoverable: boolean, inside: boolean, pit: boolean): number {
  if (!inside || !discoverable) return 0;
  const { map, width } = ctx;
  const tile = map[pos]!;
  const wall = (cell: number): boolean => wallStitcheable(map[cell] ?? -1);
  let curr = 0;
  if (doorTile(tile)) {
    curr = wall(pos - 1) && wall(pos + 1) ? 7 : 6;
  } else if (!wallStitcheable(tile) && !pit) {
    // Above a wall: but an alchemy pot keeps its look of the water below.
    if (wall(pos - width) && tile !== T.ALCHEMY) {
      curr += 40;
      if (wall(pos - 1)) curr += 2;
      else if (wall(pos + width - 1)) curr += 1;
      if (wall(pos + 1)) curr += 16;
      else if (wall(pos + width + 1)) curr += 8;
    } else {
      if (wall(pos - 1)) curr += 2;
      else if (wall(pos + width - 1)) curr += wall(pos - width - 1) ? 4 : 1;
      else if (wall(pos - width - 1)) curr += 3;
      if (wall(pos + 1)) curr += 16;
      else if (wall(pos + width + 1)) curr += wall(pos - width + 1) ? 32 : 8;
      else if (wall(pos - width + 1)) curr += 24;
    }
  }
  return curr;
}

