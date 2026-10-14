import { HeapType, type LevelBuilder } from './builder';
import { cell, type Point, WIDTH } from './geometry';
import type { ItemSpawn } from './builder';
import { type Door, DoorType, type Room, RoomType } from './room';
import { T } from './terrain';

/*
 * Pixel Dungeon's room painters that the older boss levels still use (the rest of the dungeon is
 * Shattered's rooms, level/gen/rooms).
 */

export type Painter = (level: LevelBuilder, room: Room) => void;

function setDoors(room: Room, type: DoorType): void {
  for (const door of room.doors()) {
    door.set(type);
  }
}

function paintEntrance(level: LevelBuilder, room: Room): void {
  level.fillRect(room, T.WALL);
  level.fillRect(room, T.EMPTY, 1);
  setDoors(room, DoorType.REGULAR);
  level.entrance = room.random(level.rng, 1);
  level.set(level.entrance, T.ENTRANCE);
}

function paintExit(level: LevelBuilder, room: Room): void {
  level.fillRect(room, T.WALL);
  level.fillRect(room, T.EMPTY, 1);
  setDoors(room, DoorType.REGULAR);
  level.exit = room.random(level.rng, 1);
  level.set(level.exit, T.EXIT);
}

/** The boss arena: its exit is locked into the middle of the top wall. */
function paintBossExit(level: LevelBuilder, room: Room): void {
  level.fillRect(room, T.WALL);
  level.fillRect(room, T.EMPTY, 1);
  setDoors(room, DoorType.REGULAR);
  level.exit = cell(Math.trunc((room.left + room.right) / 2), room.top);
  level.set(level.exit, T.LOCKED_EXIT);
}

function paintTunnel(level: LevelBuilder, room: Room): void {
  const floor = level.tunnelTile();
  const c = room.center(level.rng);
  const horizontal = room.width() > room.height() || (room.width() === room.height() && level.rng.int(2) === 0);

  if (horizontal) {
    let from = room.right - 1;
    let to = room.left + 1;
    for (const door of room.doors()) {
      const step = door.y < c.y ? 1 : -1;
      if (door.x === room.left) {
        from = room.left + 1;
        for (let y = door.y; y !== c.y; y += step) level.setXY(from, y, floor);
      } else if (door.x === room.right) {
        to = room.right - 1;
        for (let y = door.y; y !== c.y; y += step) level.setXY(to, y, floor);
      } else {
        from = Math.min(from, door.x);
        to = Math.max(to, door.x);
        for (let y = door.y + step; y !== c.y; y += step) level.setXY(door.x, y, floor);
      }
    }
    for (let x = from; x <= to; x++) level.setXY(x, c.y, floor);
  } else {
    let from = room.bottom - 1;
    let to = room.top + 1;
    for (const door of room.doors()) {
      const step = door.x < c.x ? 1 : -1;
      if (door.y === room.top) {
        from = room.top + 1;
        for (let x = door.x; x !== c.x; x += step) level.setXY(x, from, floor);
      } else if (door.y === room.bottom) {
        to = room.bottom - 1;
        for (let x = door.x; x !== c.x; x += step) level.setXY(x, to, floor);
      } else {
        from = Math.min(from, door.y);
        to = Math.max(to, door.y);
        for (let x = door.x + step; x !== c.x; x += step) level.setXY(x, door.y, floor);
      }
    }
    for (let y = from; y <= to; y++) level.setXY(c.x, y, floor);
  }
  setDoors(room, DoorType.TUNNEL);
}

function paintPassage(level: LevelBuilder, room: Room): void {
  const w = room.width() - 2;
  const h = room.height() - 2;
  const perimeter = w * 2 + h * 2;
  const floor = level.tunnelTile();

  // Positions along the inner rim, clockwise from the top-left corner.
  const toRim = (p: Point): number => {
    if (p.y === room.top) return p.x - room.left - 1;
    if (p.x === room.right) return p.y - room.top - 1 + w;
    if (p.y === room.bottom) return room.right - p.x - 1 + w + h;
    return p.y === room.top + 1 ? 0 : room.bottom - p.y - 1 + w * 2 + h;
  };
  const fromRim = (p: number): number => {
    if (p < w) return cell(room.left + 1 + p, room.top + 1);
    if (p < w + h) return cell(room.right - 1, room.top + 1 + (p - w));
    if (p < w * 2 + h) return cell(room.right - 1 - (p - (w + h)), room.bottom - 1);
    return cell(room.left + 1, room.bottom - 1 - (p - (w * 2 + h)));
  };

  const joints = room.doors().map(toRim).sort((a, b) => a - b);
  const n = joints.length;
  // Leave out the longest gap between doors; walk the rest of the rim.
  let start = 0;
  let maxGap = joints[0]! + perimeter - joints[n - 1]!;
  for (let i = 1; i < n; i++) {
    const gap = joints[i]! - joints[i - 1]!;
    if (gap > maxGap) {
      maxGap = gap;
      start = i;
    }
  }
  const end = joints[(start + n - 1) % n]!;
  let p = joints[start]!;
  do {
    level.set(fromRim(p), floor);
    p = (p + 1) % perimeter;
  } while (p !== end);
  level.set(fromRim(p), floor);

  setDoors(room, DoorType.TUNNEL);
}

/** The one door of a special room (they are all dead ends). */
const entranceOf = (room: Room): Door => room.doors()[0]!;

/** A random empty cell in the room without anything dropped on it yet. */
function freeSpot(level: LevelBuilder, room: Room): number {
  for (let attempt = 0; attempt < 100; attempt++) {
    const pos = room.random(level.rng);
    if (level.map[pos] === T.EMPTY && !level.items.some((spawn) => spawn.pos === pos)) return pos;
  }
  return room.random(level.rng);
}

/**
 * RatKingPainter: a hidden treasury of chests along the walls (one of them a
 * mimic), and the Rat King among them.
 */
function paintRatKing(level: LevelBuilder, room: Room): void {
  const { rng } = level;
  level.fillRect(room, T.WALL);
  level.fillRect(room, T.EMPTY_SP, 1);
  const entrance = entranceOf(room);
  entrance.set(DoorType.HIDDEN);
  const door = cell(entrance.x, entrance.y);
  const chests: ItemSpawn[] = [];
  const addChest = (pos: number): void => {
    if (pos === door - 1 || pos === door + 1 || pos === door - WIDTH || pos === door + WIDTH) return;
    level.dropItem(pos, HeapType.CHEST, { roll: 'kingsPrize' });
    chests.push(level.items.at(-1)!);
  };
  for (let x = room.left + 1; x < room.right; x++) {
    addChest(cell(x, room.top + 1));
    addChest(cell(x, room.bottom - 1));
  }
  for (let y = room.top + 2; y < room.bottom - 1; y++) {
    addChest(cell(room.left + 1, y));
    addChest(cell(room.right - 1, y));
  }
  if (chests.length > 0) rng.element(chests)!.heap = HeapType.MIMIC;
  level.ratKing = room.random(rng);
}

/** StandardPainter on a boss level: walls and a bare floor (no themes there). */
function paintStandard(level: LevelBuilder, room: Room): void {
  level.fillRect(room, T.WALL);
  setDoors(room, DoorType.REGULAR);
  level.fillRect(room, T.EMPTY, 1);
}

export const PAINTERS: ReadonlyMap<RoomType, Painter> = new Map<RoomType, Painter>([
  [RoomType.RAT_KING, paintRatKing],
  [RoomType.STANDARD, paintStandard],
  [RoomType.ENTRANCE, paintEntrance],
  [RoomType.EXIT, paintExit],
  [RoomType.BOSS_EXIT, paintBossExit],
  [RoomType.TUNNEL, paintTunnel],
  [RoomType.PASSAGE, paintPassage],
]);
