import { HeapType, type LevelBuilder } from './builder';
import { cell, LENGTH } from './geometry';
import { decoratePrison, PRISON_STYLE } from './prison';
import { initRooms, paint, paintGrass, paintWater, type RegionStyle } from './regular';
import { buildDistanceMap, buildPath, type Room, RoomType } from './room';
import { T } from './terrain';

/*
 * Depth 10: Tengu's prison (PrisonBossLevel). A winding way leads from the
 * entrance to a locked arena strewn with spent traps; the key lies in a
 * chest in the room before it. Tengu appears once someone steps inside, and
 * the door locks behind; it opens again, with the exit, when Tengu falls.
 */

export const PRISON_BOSS_STYLE: RegionStyle = {
  ...PRISON_STYLE,
  water: () => [0.45, 5],
  grass: () => [0.3, 4],
  roomTypes: () => undefined,
  decorate: decorateBossLevel,
};

export function buildPrisonBossLevel(level: LevelBuilder): boolean {
  const { rng } = level;
  if (!initRooms(level, PRISON_BOSS_STYLE)) return false;
  const rooms = level.rooms;

  let roomEntrance: Room;
  let roomExit: Room;
  let path: Room[] | null;
  let retry = 0;
  // The original picks rooms at random until they fit, retrying the whole
  // level forever; picking among the rooms that fit gets there sooner.
  const arenas = rooms.filter((r) => r.width() >= 7 && r.height() >= 7 && r.top !== 0);
  if (arenas.length === 0) return false;
  do {
    if (retry++ > 10) return false;
    roomExit = rng.element(arenas)!;
    const exit = roomExit;
    const entrances = rooms.filter((r) => r !== exit && r.width() >= 4 && r.height() >= 4);
    if (entrances.length === 0) return false;
    roomEntrance = rng.element(entrances)!;
    buildDistanceMap(rooms, roomExit);
    path = buildPath(roomEntrance, roomExit);
  } while (!path || path.length < 3);

  roomEntrance.type = RoomType.ENTRANCE;
  roomExit.type = RoomType.BOSS_EXIT;
  level.roomEntrance = roomEntrance;
  level.roomExit = roomExit;

  // As on Goo's level, the way winds along the second-best route.
  for (const node of path) node.price = roomEntrance.distance;
  buildDistanceMap(rooms, roomExit);
  path = buildPath(roomEntrance, roomExit);
  if (!path || path.length < 2) return false;
  const anteroom = path[path.length - 2]!;
  anteroom.type = RoomType.STANDARD;
  let room = roomEntrance;
  for (const next of path) {
    room.connect(next);
    room = next;
  }
  for (const r of rooms) {
    if (r.type === RoomType.NULL && r.connected.size > 0) r.type = RoomType.PASSAGE;
  }

  paint(level, PRISON_BOSS_STYLE);
  // No secrets on the way to Tengu.
  for (let i = 0; i < LENGTH; i++) {
    if (level.map[i] === T.SECRET_DOOR) level.map[i] = T.DOOR;
  }
  level.secretDoors = 0;

  // The arena is entered from below or the sides, never through its top wall.
  const approach = [...roomExit.connected.values()][0];
  if (!approach || approach.y === roomExit.top) return false;
  level.arenaDoor = cell(approach.x, approach.y);

  paintWater(level, PRISON_BOSS_STYLE);
  paintGrass(level, PRISON_BOSS_STYLE);

  // Its traps are all poison, and in plain sight.
  const nTraps = rng.intBetween(1, rooms.length + level.depth);
  for (let i = 0; i < nTraps; i++) {
    const pos = rng.int(LENGTH);
    if (level.map[pos] === T.EMPTY) level.setTrap(pos, 'poisonDart', true);
  }

  // The key to the arena, in a chest in the room before it.
  for (let attempt = 0; attempt < 100; attempt++) {
    const pos = anteroom.random(rng);
    if (level.map[pos] === T.EMPTY || level.map[pos] === T.GRASS || level.map[pos] === T.EMPTY_DECO) {
      level.dropItem(pos, HeapType.CHEST, { roll: 'key' });
      return true;
    }
  }
  return false;
}

function decorateBossLevel(level: LevelBuilder): void {
  decoratePrison(level, 0.15, 4, 2);
  const arena = level.roomExit!;
  level.set(level.arenaDoor, T.LOCKED_DOOR);
  level.fill(arena.left + 2, arena.top + 2, arena.width() - 3, arena.height() - 3, T.INACTIVE_TRAP);
}
