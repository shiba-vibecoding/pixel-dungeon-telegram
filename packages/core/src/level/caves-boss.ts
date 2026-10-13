import type { LevelBuilder } from './builder';
import { LENGTH, SOLO_SPAN, WIDTH } from './geometry';
import { CAVES_STYLE } from './caves';
import { patch, type RegionStyle } from './regular';
import { Room, RoomType } from './room';
import { T } from './terrain';

/*
 * Depth 15: DM-300's caves (CavesBossLevel). A small walled room with the
 * stairs sits in the middle of a wide cave strewn with spent traps; DM-300
 * starts up as soon as someone steps out into the cave, and the rock closes
 * the room's door behind the party. The exit opens when DM-300 is destroyed.
 */

// Laid out on the level's own span (32), the grid's top-left part, whatever the grid's size.
const ROOM_LEFT = SOLO_SPAN / 2 - 2;
const ROOM_RIGHT = SOLO_SPAN / 2 + 2;
const ROOM_TOP = SOLO_SPAN / 2 - 2;
const ROOM_BOTTOM = SOLO_SPAN / 2 + 2;

export const CAVES_BOSS_STYLE: RegionStyle = { ...CAVES_STYLE, decorate: decorateBossLevel };

export function buildCavesBossLevel(level: LevelBuilder): boolean {
  const { rng, map } = level;
  let topMost = Number.MAX_SAFE_INTEGER;
  for (let i = 0; i < 8; i++) {
    let left: number;
    let right: number;
    let top: number;
    let bottom: number;
    if (rng.int(2) === 0) {
      left = rng.intBetween(1, ROOM_LEFT - 3);
      right = ROOM_RIGHT + 3;
    } else {
      left = ROOM_LEFT - 3;
      right = rng.intBetween(ROOM_RIGHT + 3, SOLO_SPAN - 1);
    }
    if (rng.int(2) === 0) {
      top = rng.intBetween(2, ROOM_TOP - 3);
      bottom = ROOM_BOTTOM + 3;
    } else {
      top = ROOM_TOP - 3;
      bottom = rng.intBetween(ROOM_TOP + 3, SOLO_SPAN - 1);
    }
    level.fill(left, top, right - left + 1, bottom - top + 1, T.EMPTY);
    if (top < topMost) {
      topMost = top;
      level.exit = rng.intBetween(left, right) + (top - 1) * WIDTH;
    }
  }
  map[level.exit] = T.LOCKED_EXIT;

  for (let i = 0; i < LENGTH; i++) {
    if (map[i] === T.EMPTY && rng.int(6) === 0) map[i] = T.INACTIVE_TRAP;
  }

  // The stairs room in the middle, with a row of toxic traps along its top.
  level.fill(ROOM_LEFT - 1, ROOM_TOP - 1, ROOM_RIGHT - ROOM_LEFT + 3, ROOM_BOTTOM - ROOM_TOP + 3, T.WALL);
  level.fill(ROOM_LEFT, ROOM_TOP + 1, ROOM_RIGHT - ROOM_LEFT + 1, ROOM_BOTTOM - ROOM_TOP, T.EMPTY);
  level.fillTraps(ROOM_LEFT, ROOM_TOP, ROOM_RIGHT - ROOM_LEFT + 1, 'toxic', true);
  level.arenaDoor = rng.intBetween(ROOM_LEFT, ROOM_RIGHT) + (ROOM_BOTTOM + 1) * WIDTH;
  map[level.arenaDoor] = T.DOOR;
  level.entrance = rng.intBetween(ROOM_LEFT + 1, ROOM_RIGHT - 1) + rng.intBetween(ROOM_TOP + 1, ROOM_BOTTOM - 1) * WIDTH;
  map[level.entrance] = T.ENTRANCE;

  const water = patch(level, 0.45, 6);
  for (let i = 0; i < LENGTH; i++) {
    if (map[i] === T.EMPTY && water[i]) map[i] = T.WATER;
  }

  const room = new Room();
  room.set(ROOM_LEFT - 1, ROOM_TOP - 1, ROOM_RIGHT + 1, ROOM_BOTTOM + 1);
  room.type = RoomType.ENTRANCE;
  level.rooms = [room];
  return true;
}

function decorateBossLevel(level: LevelBuilder): void {
  const { map, rng } = level;
  for (let i = WIDTH + 1; i < LENGTH - WIDTH; i++) {
    if (map[i] !== T.EMPTY) continue;
    const n = [1, -1, WIDTH, -WIDTH].filter((d) => map[i + d] === T.WALL).length;
    if (rng.int(8) <= n) map[i] = T.EMPTY_DECO;
  }
  for (let i = 0; i < LENGTH; i++) {
    if (map[i] === T.WALL && rng.int(8) === 0) map[i] = T.WALL_DECO;
  }
  let sign: number;
  do {
    sign = rng.intBetween(ROOM_LEFT, ROOM_RIGHT) + rng.intBetween(ROOM_TOP, ROOM_BOTTOM) * WIDTH;
  } while (sign === level.entrance);
  map[sign] = T.EMPTY;
}
