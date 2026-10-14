import type { LevelBuilder } from './builder';
import { CITY_STYLE } from './city';
import { cell } from './geometry';
import type { RegionStyle } from './regular';
import { rectCenter, SLevel, srect } from './spainter';
import { T } from './terrain';

/*
 * Depth 20: the Dwarf King's throne room (CityBossLevel), 15×48. From the
 * stairs, in a hall of bookshelves at the bottom, a door leads up into the
 * throne room: a diamond hall with the throne in the middle, four summoning
 * pedestals around it, statues either side. Stepping inside seals the hall and
 * the King appears on his throne. Beyond the locked door at the top, a long
 * way over the chasm to the way down into the demon halls, past the imp's
 * shop (ImpShopRoom), which opens once the King has fallen if the imp's errand
 * was done.
 *
 * Shattered's terrains stand in until the levels stream brings them: the
 * throne (CUSTOM_DECO) as STATUE_SP, the carpets (CUSTOM_DECO_EMPTY) as
 * EMPTY_SP, which Shattered draws the same, the entry's skull piles
 * (REGION_DECO) as statues; city_boss.png's art is laid over them.
 */

export const CITY_W = 15;
export const CITY_H = 48;
const ENTRY = srect(1, 37, 14, 48);
export const CITY_ARENA = srect(1, 25, 14, 38);
const END = srect(0, 0, 15, 22);
/** Terrain.CUSTOM_DECO (the throne), CUSTOM_DECO_EMPTY (carpet), REGION_DECO. SEAM(levels): Shattered's own terrains. */
const CUSTOM_DECO = T.STATUE_SP;
const CUSTOM_DECO_EMPTY = T.EMPTY_SP;
const REGION_DECO = T.STATUE;

const centre = rectCenter(CITY_ARENA);
/** CityBossLevel.throne and pedestals, in our grid. */
export const THRONE = cell(centre.x, centre.y);
export const PEDESTALS: readonly number[] = [
  cell(centre.x - 3, centre.y - 3), cell(centre.x + 3, centre.y - 3), cell(centre.x + 3, centre.y + 3), cell(centre.x - 3, centre.y + 3),
];
/** The doors below and above the throne room. */
export const BOTTOM_DOOR = cell(7, CITY_ARENA.bottom - 1);
export const TOP_DOOR = cell(7, CITY_ARENA.top);
/** ImpShopRoom: where the imp's shop opens (a Room's edges are its walls). */
export const IMP_SHOP = { left: END.left + 3, top: END.top + 12, right: END.left + 11, bottom: END.top + 20 };

export const CITY_BOSS_STYLE: RegionStyle = { ...CITY_STYLE, decorate: () => undefined };

/** DungeonTileSheet.wallStitcheable. */
const wallStitcheable = (t: number): boolean =>
  t === T.WALL || t === T.WALL_DECO || t === T.SECRET_DOOR || t === T.LOCKED_EXIT || t === T.UNLOCKED_EXIT || t === T.BOOKSHELF;

/** CityBossLevel.build. */
export function buildCityBossLevel(builder: LevelBuilder): boolean {
  const { rng } = builder;
  const level = new SLevel(CITY_W, CITY_H);
  const w = level.w;
  // The stairs' hall.
  level.fillRect(ENTRY, 0, T.WALL);
  level.fillRect(ENTRY, 1, T.BOOKSHELF);
  level.fillRect(ENTRY, 2, T.EMPTY);
  level.fill(ENTRY.left + 3, ENTRY.top + 3, 1, 5, T.BOOKSHELF);
  level.fill(ENTRY.right - 4, ENTRY.top + 3, 1, 5, T.BOOKSHELF);
  level.setXY(ENTRY.left + 5, ENTRY.top + 1, REGION_DECO);
  level.setXY(ENTRY.left + 7, ENTRY.top + 1, REGION_DECO);
  let c = rectCenter(ENTRY);
  level.fill(c.x - 1, c.y - 2, 3, 1, T.STATUE);
  level.fill(c.x - 1, c.y, 3, 1, T.STATUE);
  level.fill(c.x - 1, c.y + 2, 3, 1, T.STATUE);
  level.fill(c.x, ENTRY.top + 1, 1, 6, CUSTOM_DECO_EMPTY);
  level.setXY(c.x, ENTRY.top, T.DOOR);
  const entrance = c.x + (c.y + 2) * w;
  level.set(entrance, T.ENTRANCE);

  // The throne room.
  level.fillDiamond(CITY_ARENA, 1, T.EMPTY);
  level.fillRect(CITY_ARENA, 5, CUSTOM_DECO_EMPTY);
  level.fillRect(CITY_ARENA, 6, CUSTOM_DECO);
  c = rectCenter(CITY_ARENA);
  level.setXY(c.x - 3, c.y, T.STATUE);
  level.setXY(c.x - 4, c.y, T.STATUE);
  level.setXY(c.x + 3, c.y, T.STATUE);
  level.setXY(c.x + 4, c.y, T.STATUE);
  for (const [dx, dy] of [[-3, -3], [3, -3], [3, 3], [-3, 3]] as const) level.setXY(c.x + dx, c.y + dy, T.PEDESTAL);
  level.fill(c.x, c.y + 2, 1, 4, CUSTOM_DECO_EMPTY);
  level.setXY(c.x, CITY_ARENA.top, T.LOCKED_DOOR);

  // The way out, over the chasm.
  level.fillRect(END, 0, T.CHASM);
  level.fill(END.left + 4, END.top + 5, 7, 18, T.EMPTY);
  level.fill(END.left + 4, END.top + 5, 7, 4, T.EXIT);

  // The imp's shop: its pedestal and statues (its wares are decided now, laid out once it opens).
  level.setXY(Math.trunc((IMP_SHOP.left + IMP_SHOP.right) / 2), Math.trunc((IMP_SHOP.top + IMP_SHOP.bottom) / 2), T.PEDESTAL);
  level.setXY(IMP_SHOP.left + 2, IMP_SHOP.top, T.STATUE);
  level.setXY(IMP_SHOP.left + 6, IMP_SHOP.top, T.STATUE);
  level.fill(END.left + 5, END.bottom + 1, 5, 1, T.EMPTY);
  level.fill(END.left + 6, END.bottom + 2, 3, 1, T.EMPTY);

  // CityPainter.decorate without rooms.
  for (let i = 0; i < level.length - w; i++) {
    if (level.map[i] === T.EMPTY && rng.int(10) === 0) level.map[i] = T.EMPTY_DECO;
    else if (level.map[i] === T.WALL && !wallStitcheable(level.map[i + w]!) && rng.int(21 - 20) === 0) level.map[i] = T.WALL_DECO;
  }

  // The pillars over the chasm, last: no decoration on them.
  for (const y of [2, 7, 12, 17]) {
    level.fill(END.left + 1, END.top + y, 2, 2, T.WALL);
    level.fill(END.right - 3, END.top + y, 2, 2, T.WALL);
  }

  level.blit(builder.map);
  builder.entrance = level.toCell(entrance);
  builder.exit = cell(END.left + 7, END.top + 8);
  builder.exits = [];
  for (let y = END.top + 5; y < END.top + 9; y++) for (let x = END.left + 4; x < END.left + 11; x++) builder.exits.push(cell(x, y));
  builder.arenaDoor = BOTTOM_DOOR;
  builder.boss = { throne: THRONE, pedestals: [...PEDESTALS], impShop: { ...IMP_SHOP } };
  return true;
}
