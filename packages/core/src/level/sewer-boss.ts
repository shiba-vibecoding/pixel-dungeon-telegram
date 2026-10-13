import type { LevelBuilder } from './builder';
import { WIDTH } from './geometry';
import { initRooms, paint, paintGrass, paintWater, placeTraps, type RegionStyle } from './regular';
import { buildDistanceMap, buildPath, type Room, RoomType } from './room';
import { SEWER_STYLE } from './sewer';
import { T } from './terrain';

/*
 * Depth 5: Goo's lair (SewerBossLevel). Tunnels lead from the entrance to a
 * large arena whose locked exit sits in the top wall, above a gutter of
 * murky water.
 */

export const SEWER_BOSS_STYLE: RegionStyle = {
  ...SEWER_STYLE,
  water: () => [0.5, 5],
  grass: () => [0.4, 4],
  decorate: decorateBossLevel,
};

export function buildSewerBossLevel(level: LevelBuilder): boolean {
  const { rng } = level;
  if (!initRooms(level, SEWER_BOSS_STYLE)) {
    return false;
  }
  const rooms = level.rooms;

  const minDistance = Math.trunc(Math.sqrt(rooms.length));
  let roomEntrance: Room;
  let roomExit: Room;
  let retry = 0;
  do {
    let inner = 0;
    do {
      if (inner++ > 10) return false;
      roomEntrance = rng.element(rooms)!;
    } while (roomEntrance.width() < 4 || roomEntrance.height() < 4);
    inner = 0;
    do {
      if (inner++ > 10) return false;
      roomExit = rng.element(rooms)!;
    } while (roomExit === roomEntrance || roomExit.width() < 6 || roomExit.height() < 6 || roomExit.top === 0);
    buildDistanceMap(rooms, roomExit);
    if (retry++ > 10) return false;
  } while (roomEntrance.distance < minDistance);

  roomEntrance.type = RoomType.ENTRANCE;
  roomExit.type = RoomType.BOSS_EXIT;
  level.roomEntrance = roomEntrance;
  level.roomExit = roomExit;

  // The shortest route gets expensive, and the rooms are connected along the
  // next best one: the way to the boss winds a little.
  buildDistanceMap(rooms, roomExit);
  let path = buildPath(roomEntrance, roomExit);
  if (!path) return false;
  for (const node of path) node.price = roomEntrance.distance;
  buildDistanceMap(rooms, roomExit);
  path = buildPath(roomEntrance, roomExit);
  if (!path) return false;
  let room = roomEntrance;
  for (const next of path) {
    room.connect(next);
    room = next;
  }

  // The arena may not be entered through its top wall, where the exit is.
  const approach = [...roomExit.connected.keys()][0]!;
  if (roomExit.top === approach.bottom) return false;

  for (const r of rooms) {
    if (r.type === RoomType.NULL && r.connected.size > 0) r.type = RoomType.TUNNEL;
  }
  // SewerBossLevel.build: the Rat King's hidden room, beside the arena but not through its top wall.
  const candidates = roomExit.neighbours.filter((r) => !roomExit.connected.has(r) &&
    (roomExit.left === r.right || roomExit.right === r.left || roomExit.bottom === r.top));
  if (candidates.length > 0) {
    const kingsRoom = rng.element(candidates)!;
    kingsRoom.connect(roomExit);
    kingsRoom.type = RoomType.RAT_KING;
  }

  paint(level, SEWER_BOSS_STYLE);
  paintWater(level, SEWER_BOSS_STYLE);
  paintGrass(level, SEWER_BOSS_STYLE);
  placeTraps(level, SEWER_BOSS_STYLE);
  return true;
}

function decorateBossLevel(level: LevelBuilder): void {
  const { map, rng } = level;
  const roomExit = level.roomExit!;
  const start = roomExit.top * WIDTH + roomExit.left + 1;
  const end = start + roomExit.width() - 1;
  for (let i = start; i < end; i++) {
    if (i !== level.exit) {
      map[i] = T.WALL_DECO;
      map[i + WIDTH] = T.WATER;
    } else {
      map[i + WIDTH] = T.EMPTY;
    }
  }

  const roomEntrance = level.roomEntrance!;
  for (let attempt = 0; attempt < 100; attempt++) {
    const pos = roomEntrance.random(rng);
    if (pos !== level.entrance) {
      map[pos] = T.EMPTY;
      return;
    }
  }
}
