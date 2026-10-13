import { createRun, deriveSeed, Rng, type RunState, T } from '../src/index';
import { Dungeon, Feeling } from '../src/level/gen/dungeon';
import { GenLevel } from '../src/level/gen/genlevel';
import { Random } from '../src/level/gen/random';
import { Point } from '../src/level/gen/rect';
import { Door, type Room } from '../src/level/gen/room';
import { EmptyRoom } from '../src/level/gen/rooms/standard/basic';
import '../src/level/gen/rooms';

/* Helpers for testing level generation piece by piece. */

/** Runs `fn` as level generation code for a depth (the Random stack and Dungeon set up). */
export function generating<R>(depth: number, fn: () => R, seed = 1, run: RunState = createRun(seed)): R {
  return Random.using(Rng.seeded(deriveSeed(seed, 99, depth)), () => Dungeon.generating({ depth, branch: 0, run, world: null }, fn));
}

/**
 * A room made and painted on its own, as its level's painter would: sized (setSize), placed with a
 * plain room joined to it on each of the sides asked for (each with a door at a point both allow),
 * on a level just big enough. Returns the level (map in its own width) and the room.
 */
export function paintRoomAlone(
  make: () => Room, depth: number, sides: ReadonlyArray<'left' | 'top' | 'right' | 'bottom'> = ['left', 'right'], seed = 1,
  feeling = Feeling.NONE,
): { level: GenLevel; room: Room } {
  return generating(depth, () => {
    const room = make();
    if (!room.setSize()) throw new Error(`${room.kind} cannot size itself`);
    room.setPos(6, 6);
    const neighbours: Room[] = [];
    for (const side of sides) {
      const n = new EmptyRoom();
      n.forceSize(5, 5);
      if (side === 'left') n.setPos(room.left - 4, room.top);
      if (side === 'right') n.setPos(room.right, room.top);
      if (side === 'top') n.setPos(room.left, room.top - 4);
      if (side === 'bottom') n.setPos(room.left, room.bottom);
      // Neighbours span the whole side, so a door can go anywhere along it.
      if (side === 'left' || side === 'right') n.bottom = room.bottom;
      else n.right = room.right;
      if (!room.connect(n)) throw new Error(`${room.kind} will not connect on its ${side}`);
      neighbours.push(n);
    }
    for (const n of neighbours) {
      const i = room.intersect(n);
      const spots = i.getPoints().filter((p) => room.canConnectPoint(p) && n.canConnectPoint(p));
      const spot = Random.element(spots) ?? new Point(i.left, i.top);
      const door = new Door(spot.x, spot.y);
      room.connected.set(n, door);
      n.connected.set(room, door);
    }
    const level = new GenLevel(feeling);
    level.setSize(room.right + 7, room.bottom + 7);
    level.rooms = [room];
    room.paint(level);
    // The doors as the painter would put them in (never hidden here).
    for (const d of room.doors()) {
      const t = [T.EMPTY, level.tunnelTile(), T.WATER, T.DOOR, T.DOOR, T.SECRET_DOOR, T.BARRICADE, T.LOCKED_DOOR, T.CRYSTAL_DOOR, T.WALL][d.type]!;
      level.map[level.pointToCell(d)] = t;
    }
    return { level, room };
  }, seed);
}

/** The level's map as text, one character per cell (in the level's own width). */
export function genAscii(level: GenLevel): string {
  const rows: string[] = [];
  for (let y = 0; y < level.height; y++) {
    let row = '';
    for (let x = 0; x < level.width; x++) row += String.fromCharCode(48 + (level.map[x + y * level.width]! % 75));
    rows.push(row);
  }
  return rows.join('\n');
}
