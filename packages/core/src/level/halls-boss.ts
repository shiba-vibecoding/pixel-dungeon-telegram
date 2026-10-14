import { HeapType, type LevelBuilder } from './builder';
import { HALLS_STYLE } from './halls';
import { cell, WIDTH } from './geometry';
import type { RegionStyle } from './regular';
import { SLevel } from './spainter';
import { F, hasFlag, T } from './terrain';
import { distanceMap, patchGenerate } from '../bosses/common';

/*
 * Depth 25: Yog-Dzewa's hall (HallsBossLevel), 32×32: five tall chambers side
 * by side, statues and pools about, and in the middle, under a ceiling of
 * carved wall, the pit Yog rises from. Two steps off the stairs, the stairs
 * burn away behind the hero and Yog-Dzewa is there, before the sealed way down.
 *
 * Depth 26 (LastLevel): the Amulet of Yendor on its altar at the end of a long
 * walk over the abyss, ringed with candles. Shattered's is 64 cells tall; here
 * it is 48 (the grid's height): the walk is sixteen cells shorter.
 *
 * Shattered's region decorations (REGION_DECO, REGION_DECO_ALT) stand here as
 * statues until the levels stream brings its terrain.
 */

export const HALLS_W = 32;
export const HALLS_H = 32;
const ROOM_LEFT = HALLS_W / 2 - 4;
const ROOM_RIGHT = HALLS_W / 2 + 4;
const ROOM_TOP = 8;
const ROOM_BOTTOM = ROOM_TOP + 8;
/** REGION_DECO and REGION_DECO_ALT. SEAM(levels): Shattered's own terrains. */
const REGION_DECO = T.STATUE;
const REGION_DECO_ALT = T.STATUE_SP;

/** The way down (sealed, a carved wall, until Yog falls), and where Yog-Dzewa rises. */
export const HALLS_EXIT = cell(HALLS_W / 2, ROOM_TOP + 1);
export const YOG_POS = HALLS_EXIT + 3 * WIDTH;
export const HALLS_EXITS: readonly number[] = [HALLS_EXIT - 1, HALLS_EXIT, HALLS_EXIT + 1, HALLS_EXIT - WIDTH - 1, HALLS_EXIT - WIDTH, HALLS_EXIT - WIDTH + 1];

export const HALLS_BOSS_STYLE: RegionStyle = { ...HALLS_STYLE, decorate: () => undefined };

/** HallsBossLevel.build. */
export function buildHallsBossLevel(builder: LevelBuilder): boolean {
  const { rng } = builder;
  const level = new SLevel(HALLS_W, HALLS_H);
  const w = level.w;
  let entrance = -1;
  for (let i = 0; i < 5; i++) {
    let top: number;
    let bottom: number;
    if (i === 0 || i === 4) {
      top = rng.intRange(ROOM_TOP - 1, ROOM_TOP + 3);
      bottom = rng.intRange(ROOM_BOTTOM + 2, ROOM_BOTTOM + 6);
    } else if (i === 1 || i === 3) {
      top = rng.intRange(ROOM_TOP - 5, ROOM_TOP - 1);
      bottom = rng.intRange(ROOM_BOTTOM + 6, ROOM_BOTTOM + 10);
    } else {
      top = rng.intRange(ROOM_TOP - 6, ROOM_TOP - 3);
      bottom = rng.intRange(ROOM_BOTTOM + 8, ROOM_BOTTOM + 12);
    }
    level.fill(4 + i * 5, top, 5, bottom - top + 1, T.EMPTY);
    if (i === 2) entrance = 6 + i * 5 + (bottom - 1) * w;
  }
  const exitCell = w / 2 + (ROOM_TOP + 1) * w;
  const bossPos = exitCell + w * 3;
  const sdist = (a: number, b: number): number => Math.max(Math.abs((a % w) - (b % w)), Math.abs(Math.trunc(a / w) - Math.trunc(b / w)));
  let patch = patchGenerate(rng, w, level.h, 0.2, 0, true);
  for (let i = 0; i < level.length; i++) {
    if (level.map[i] === T.EMPTY && patch[i]) level.map[i] = sdist(i, bossPos) + rng.int(5) >= 10 ? REGION_DECO : T.STATUE;
  }
  level.set(entrance, T.ENTRANCE);
  level.fill(ROOM_LEFT - 1, ROOM_TOP - 1, 11, 11, T.EMPTY);
  patch = patchGenerate(rng, w, level.h, 0.3, 3, true);
  for (let i = 0; i < level.length; i++) {
    const t = level.map[i];
    if ((t === T.EMPTY || t === T.STATUE || t === REGION_DECO) && patch[i]) level.map[i] = T.WATER;
  }
  for (let i = 0; i < level.length; i++) if (level.map[i] === T.EMPTY && rng.int(4) === 0) level.map[i] = T.EMPTY_DECO;
  level.fill(ROOM_LEFT, ROOM_TOP, 9, 9, T.EMPTY_SP);
  level.fill(ROOM_LEFT, ROOM_TOP, 9, 2, T.WALL_DECO);
  level.fill(ROOM_LEFT, ROOM_BOTTOM - 1, 2, 2, T.WALL_DECO);
  level.fill(ROOM_RIGHT - 1, ROOM_BOTTOM - 1, 2, 2, T.WALL_DECO);
  level.fill(ROOM_LEFT + 3, ROOM_TOP + 2, 3, 4, T.EMPTY);
  for (let i = 0; i < level.length; i++) if (level.map[i] === REGION_DECO && rng.int(2) === 0) level.map[i] = REGION_DECO_ALT;
  // A way from the stairs to the way down.
  const dist = distanceMap(exitCell, (c) => hasFlag(level.map[c]!, F.PASSABLE), Infinity, w, level.length);
  if (dist[entrance] === Infinity) return false;
  level.blit(builder.map);
  builder.entrance = level.toCell(entrance);
  builder.exit = HALLS_EXIT;
  builder.exits = [...HALLS_EXITS];
  builder.arenaDoor = builder.entrance;
  return true;
}

/* The Amulet's hall (LastLevel) */

const LAST_W = 16;
const LAST_H = 48;
const LAST_ROOM_TOP = 10;
const MID = LAST_W / 2;
/** LastLevel.AMULET_POS. */
export const AMULET_POS = cell(MID, 12);

export const LAST_STYLE: RegionStyle = { ...HALLS_STYLE, decorate: () => undefined };

/** LastLevel.build: the walk over the abyss to the Amulet; below the stairs, the hall of Yog seen from above. */
export function buildLastLevel(builder: LevelBuilder): boolean {
  const { rng } = builder;
  const level = new SLevel(LAST_W, LAST_H, T.CHASM);
  const w = level.w;
  const h = level.h;
  level.fill(0, h - 1, w, 1, T.WALL);
  level.fill(MID - 1, 10, 3, h - 11, T.EMPTY);
  level.fill(MID - 2, h - 3, 5, 1, T.EMPTY);
  level.fill(MID - 3, h - 2, 7, 1, T.EMPTY);
  const entrance = (h - LAST_ROOM_TOP) * w + MID;
  level.fill(0, h - LAST_ROOM_TOP, w, 2, T.WALL);
  level.set(entrance, T.ENTRANCE);
  level.set(entrance + w, T.ENTRANCE);
  level.fill(0, h - LAST_ROOM_TOP + 2, w, 8, T.EMPTY);
  level.fill(MID - 1, h - LAST_ROOM_TOP + 2, 3, 1, T.ENTRANCE);
  for (let i = 0; i < level.length; i++) if (level.map[i] === T.EMPTY && rng.int(5) === 0) level.map[i] = T.EMPTY_DECO;
  level.fill(MID - 2, 9, 5, 7, T.EMPTY);
  level.fill(MID - 3, 10, 7, 5, T.EMPTY);
  // LastLevel.buildFlagMaps: below the stairs nothing can be walked on (it is the hall of Yog, far below).
  for (let i = (h - LAST_ROOM_TOP + 2) * w; i < level.length; i++) level.map[i] = T.WALL;
  level.blit(builder.map);
  builder.entrance = level.toCell(entrance);
  // Nothing leads further down.
  builder.exit = -1;
  builder.dropItem(AMULET_POS, HeapType.HEAP, { roll: 'kind', kind: 'quest.amulet' });
  return true;
}
