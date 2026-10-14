/*
 * Terrain ids and their physical properties, as Shattered Pixel Dungeon has them (levels/Terrain.java).
 * Water and chasms are single ids: how they meet their neighbours is for the client to draw
 * (DungeonTileSheet's stitching), not part of the map. Traps are not terrain kinds either: a
 * cell is TRAP, SECRET_TRAP or INACTIVE_TRAP, and the level's trap list says which trap lies there.
 */

export const T = {
  CHASM: 0,
  EMPTY: 1,
  GRASS: 2,
  EMPTY_WELL: 3,
  WALL: 4,
  DOOR: 5,
  OPEN_DOOR: 6,
  ENTRANCE: 7,
  /** An entrance drawn on special floor (the vault's, the mine's way back). */
  ENTRANCE_SP: 37,
  EXIT: 8,
  EMBERS: 9,
  LOCKED_DOOR: 10,
  /** A door the skeleton key locked (Terrain.HERO_LKD_DR). */
  HERO_LKD_DR: 38,
  CRYSTAL_DOOR: 31,
  PEDESTAL: 11,
  WALL_DECO: 12,
  BARRICADE: 13,
  EMPTY_SP: 14,
  HIGH_GRASS: 15,
  /** Tall grass that has been passed through: it still stands, but sheds nothing more. */
  FURROWED_GRASS: 30,

  SECRET_DOOR: 16,
  SECRET_TRAP: 17,
  TRAP: 18,
  INACTIVE_TRAP: 19,

  EMPTY_DECO: 20,
  LOCKED_EXIT: 21,
  UNLOCKED_EXIT: 22,
  WELL: 24,
  BOOKSHELF: 27,
  ALCHEMY: 28,

  /** Regular empty floor that is never painted over, for custom visuals. */
  CUSTOM_DECO_EMPTY: 32,
  /** A solid decoration drawn by a custom tilemap (it reuses the old id of signs). */
  CUSTOM_DECO: 23,
  /** A solid decoration that water shows through. */
  CUSTOM_DECO_WTR: 39,
  STATUE: 25,
  STATUE_SP: 26,
  /** Each region's own decoration (barrels, braziers, crystals, carts, skulls): solid. */
  REGION_DECO: 33,
  REGION_DECO_ALT: 34,
  /** The blacksmith's mine: crystals and boulders, broken with the pickaxe. */
  MINE_CRYSTAL: 35,
  MINE_BOULDER: 36,

  WATER: 29,
} as const;

export type Terrain = (typeof T)[keyof typeof T];

export const F = {
  PASSABLE: 0x01,
  LOS_BLOCKING: 0x02,
  FLAMABLE: 0x04,
  SECRET: 0x08,
  SOLID: 0x10,
  AVOID: 0x20,
  LIQUID: 0x40,
  PIT: 0x80,
} as const;

export const terrainFlags: readonly number[] = (() => {
  const f = new Array<number>(256).fill(0);
  f[T.CHASM] = F.AVOID | F.PIT;
  f[T.EMPTY] = F.PASSABLE;
  f[T.GRASS] = F.PASSABLE | F.FLAMABLE;
  f[T.EMPTY_WELL] = F.PASSABLE;
  f[T.WATER] = F.PASSABLE | F.LIQUID;
  f[T.WALL] = F.LOS_BLOCKING | F.SOLID;
  f[T.DOOR] = F.PASSABLE | F.LOS_BLOCKING | F.FLAMABLE | F.SOLID;
  f[T.OPEN_DOOR] = F.PASSABLE | F.FLAMABLE;
  f[T.ENTRANCE] = F.PASSABLE;
  f[T.ENTRANCE_SP] = f[T.ENTRANCE]!;
  f[T.EXIT] = F.PASSABLE;
  f[T.EMBERS] = F.PASSABLE;
  f[T.LOCKED_DOOR] = F.LOS_BLOCKING | F.SOLID;
  f[T.HERO_LKD_DR] = f[T.LOCKED_DOOR]!;
  f[T.CRYSTAL_DOOR] = F.SOLID;
  f[T.PEDESTAL] = F.PASSABLE;
  f[T.WALL_DECO] = f[T.WALL]!;
  f[T.BARRICADE] = F.FLAMABLE | F.SOLID | F.LOS_BLOCKING;
  f[T.EMPTY_SP] = f[T.EMPTY]!;
  f[T.HIGH_GRASS] = F.PASSABLE | F.LOS_BLOCKING | F.FLAMABLE;
  f[T.FURROWED_GRASS] = f[T.HIGH_GRASS]!;

  f[T.SECRET_DOOR] = f[T.WALL]! | F.SECRET;
  f[T.SECRET_TRAP] = f[T.EMPTY]! | F.SECRET;
  f[T.TRAP] = F.AVOID;
  f[T.INACTIVE_TRAP] = f[T.EMPTY]!;

  f[T.EMPTY_DECO] = f[T.EMPTY]!;
  f[T.LOCKED_EXIT] = F.SOLID;
  f[T.UNLOCKED_EXIT] = F.PASSABLE;
  f[T.WELL] = F.AVOID;
  f[T.BOOKSHELF] = f[T.BARRICADE]!;
  f[T.ALCHEMY] = F.SOLID;

  f[T.CUSTOM_DECO_EMPTY] = f[T.EMPTY]!;
  f[T.CUSTOM_DECO] = F.SOLID;
  f[T.CUSTOM_DECO_WTR] = F.SOLID;
  f[T.STATUE] = F.SOLID;
  f[T.STATUE_SP] = f[T.STATUE]!;

  f[T.REGION_DECO] = f[T.STATUE]!;
  f[T.REGION_DECO_ALT] = f[T.STATUE_SP]!;
  f[T.MINE_CRYSTAL] = F.SOLID;
  f[T.MINE_BOULDER] = F.SOLID;
  return f;
})();

export function hasFlag(terrain: number, flag: number): boolean {
  return (terrainFlags[terrain]! & flag) !== 0;
}

/** Terrain.discover: the visible form of a secret door or trap once it has been found. */
export function discover(terrain: number): number {
  switch (terrain) {
    case T.SECRET_DOOR:
      return T.DOOR;
    case T.SECRET_TRAP:
      return T.TRAP;
    default:
      return terrain;
  }
}

/** Terrain.TRAP, SECRET_TRAP or INACTIVE_TRAP: a cell the level's trap list has a trap for. */
export const isTrapCell = (terrain: number): boolean => terrain === T.TRAP || terrain === T.SECRET_TRAP || terrain === T.INACTIVE_TRAP;
