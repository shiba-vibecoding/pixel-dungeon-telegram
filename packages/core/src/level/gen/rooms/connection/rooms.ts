import type { GenLevel } from '../../genlevel';
import { Maze } from '../../maze';
import { gate } from '../../builders/builder';
import { Painter } from '../../painter';
import { Random } from '../../random';
import { Point, Rect } from '../../rect';
import { Door, DoorType, type Room } from '../../room';
import { T } from '../../../terrain';
import { ConnectionRoom } from './connection';

/* levels/rooms/connection: the connection rooms. */

/** TunnelRoom: straight tunnels from every door to a cell in the middle. */
export class TunnelRoom extends ConnectionRoom {
  readonly kind: string = 'TunnelRoom';

  paint(level: GenLevel): void {
    const floor = level.tunnelTile();
    const c = this.getConnectionSpace();
    for (const door of this.doors()) {
      const start = door.clone();
      if (start.x === this.left) start.x++;
      else if (start.y === this.top) start.y++;
      else if (start.x === this.right) start.x--;
      else if (start.y === this.bottom) start.y--;

      const rightShift = start.x < c.left ? c.left - start.x : start.x > c.right ? c.right - start.x : 0;
      const downShift = start.y < c.top ? c.top - start.y : start.y > c.bottom ? c.bottom - start.y : 0;

      // Always inward first.
      let mid: Point;
      let end: Point;
      if (door.x === this.left || door.x === this.right) {
        mid = new Point(start.x + rightShift, start.y);
        end = new Point(mid.x, mid.y + downShift);
      } else {
        mid = new Point(start.x, start.y + downShift);
        end = new Point(mid.x + rightShift, mid.y);
      }
      Painter.drawLine(level, start, mid, floor);
      Painter.drawLine(level, mid, end, floor);
    }

    // A bigger room with many doors sometimes gets an extra diagonal cell in the middle.
    if (this.width() >= 7 && this.height() >= 7 && this.connected.size >= 4 && c.square() === 0) {
      const cell = level.pointToCell(new Point(c.left, c.top));
      const ofs = 2 * Random.Int(4);
      const circle8 = level.circle8;
      if (level.map[cell + circle8[(ofs + 7) % 8]!] === floor && level.map[cell + circle8[(ofs + 1) % 8]!] === floor) {
        Painter.set(level, cell + circle8[ofs]!, floor);
      }
    }

    for (const door of this.doors()) door.set(DoorType.TUNNEL);
  }

  /** Where every door's tunnel must reach (usually one cell); inclusive of its right and bottom sides. */
  protected getConnectionSpace(): Rect {
    const c = this.getDoorCenter();
    return new Rect(c.x, c.y, c.x, c.y);
  }

  /** A point as far from every door as can be. */
  protected getDoorCenter(): Point {
    let x = 0;
    let y = 0;
    for (const door of this.doors()) {
      x += door.x;
      y += door.y;
    }
    const n = this.connected.size;
    const c = new Point(Math.trunc(x / n), Math.trunc(y / n));
    // The original's sums are whole numbers, so these never move the point; the draws are kept.
    if (Random.Float() < x % 1) c.x++;
    if (Random.Float() < y % 1) c.y++;
    c.x = gate(this.left + 1, c.x, this.right - 1);
    c.y = gate(this.top + 1, c.y, this.bottom - 1);
    return c;
  }
}

/** Fills the walls between neighbouring bridges and walkways with chasm too, so the gaps join up. */
function openToBridges(level: GenLevel, room: Room): void {
  for (const r of room.neigbours) {
    if (r instanceof BridgeRoom || r instanceof RingBridgeRoom || r instanceof WalkwayRoom) {
      const i = room.intersect(r);
      if (i.width() !== 0) {
        i.left++;
        i.right--;
      } else {
        i.top++;
        i.bottom--;
      }
      Painter.fill(level, i.left, i.top, i.width() + 1, i.height() + 1, T.CHASM);
    }
  }
}

/** BridgeRoom: tunnels across a chasm. */
export class BridgeRoom extends TunnelRoom {
  override readonly kind: string = 'BridgeRoom';

  override paint(level: GenLevel): void {
    if (Math.min(this.width(), this.height()) > 3) Painter.fill(level, this, 1, T.CHASM);
    super.paint(level);
    openToBridges(level, this);
  }

  override canMerge(_l: GenLevel, _other: Room, _p: Point, mergeTerrain: number): boolean {
    return mergeTerrain === T.CHASM;
  }
}

/** PerimeterRoom: tunnels along the room's walls. */
export class PerimeterRoom extends ConnectionRoom {
  readonly kind: string = 'PerimeterRoom';

  paint(level: GenLevel): void {
    PerimeterRoom.fillPerimiterPaths(level, this, level.tunnelTile());
    for (const door of this.doors()) door.set(DoorType.TUNNEL);
  }

  static fillPerimiterPaths(l: GenLevel, r: Room, floor: number): void {
    const corners: Point[] = [
      new Point(r.left + 1, r.top + 1), new Point(r.right - 1, r.top + 1),
      new Point(r.right - 1, r.bottom - 1), new Point(r.left + 1, r.bottom - 1),
    ];
    const pointsToFill: Point[] = [];
    for (const door of r.doors()) {
      const p = door.clone();
      if (p.y === r.top) p.y++;
      else if (p.y === r.bottom) p.y--;
      else if (p.x === r.left) p.x++;
      else p.x--;
      pointsToFill.push(p);
    }
    const pointsFilled: Point[] = [pointsToFill.shift()!];
    while (pointsToFill.length > 0) {
      let shortestDistance = 2147483647;
      let from: Point | null = null;
      let to: Point | null = null;
      for (const f of pointsFilled) {
        for (const t of pointsToFill) {
          const dist = distanceBetweenPoints(r, f, t);
          if (dist < shortestDistance) {
            from = f;
            to = t;
            shortestDistance = dist;
          }
        }
      }
      fillBetweenPoints(l, r, from!, to!, floor, corners);
      pointsFilled.push(to!);
      pointsToFill.splice(pointsToFill.indexOf(to!), 1);
    }
  }
}

const spaceBetween = (a: number, b: number): number => Math.abs(a - b) - 1;

/** The length of the path between two points along the inside of a room's walls. */
function distanceBetweenPoints(r: Room, a: Point, b: Point): number {
  // On the same side.
  if (((a.x === r.left + 1 || a.x === r.right - 1) && a.y === b.y) || ((a.y === r.top + 1 || a.y === r.bottom - 1) && a.x === b.x)) {
    return Math.max(spaceBetween(a.x, b.x), spaceBetween(a.y, b.y));
  }
  // Otherwise round the corners, one cell of overlap taken off.
  return (
    Math.min(spaceBetween(r.left, a.x) + spaceBetween(r.left, b.x), spaceBetween(r.right, a.x) + spaceBetween(r.right, b.x)) +
    Math.min(spaceBetween(r.top, a.y) + spaceBetween(r.top, b.y), spaceBetween(r.bottom, a.y) + spaceBetween(r.bottom, b.y)) -
    1
  );
}

/** The shortest path along the walls between two points. */
function fillBetweenPoints(level: GenLevel, r: Room, from: Point, to: Point, floor: number, corners: Point[]): void {
  // Along the same side.
  if (((from.x === r.left + 1 || from.x === r.right - 1) && from.x === to.x) || ((from.y === r.top + 1 || from.y === r.bottom - 1) && from.y === to.y)) {
    Painter.fill(level, Math.min(from.x, to.x), Math.min(from.y, to.y), spaceBetween(from.x, to.x) + 2, spaceBetween(from.y, to.y) + 2, floor);
    return;
  }
  // On adjacent sides: through the corner.
  for (const c of corners) {
    if ((c.x === from.x || c.y === from.y) && (c.x === to.x || c.y === to.y)) {
      Painter.drawLine(level, from, c, floor);
      Painter.drawLine(level, c, to, floor);
      return;
    }
  }
  // On opposite sides: as two paths via the middle of a side between.
  let side: Point;
  if (from.y === r.top + 1 || from.y === r.bottom - 1) {
    side = spaceBetween(r.left, from.x) + spaceBetween(r.left, to.x) <= spaceBetween(r.right, from.x) + spaceBetween(r.right, to.x)
      ? new Point(r.left + 1, r.top + Math.trunc(r.height() / 2))
      : new Point(r.right - 1, r.top + Math.trunc(r.height() / 2));
  } else {
    side = spaceBetween(r.top, from.y) + spaceBetween(r.top, to.y) <= spaceBetween(r.bottom, from.y) + spaceBetween(r.bottom, to.y)
      ? new Point(r.left + Math.trunc(r.width() / 2), r.top + 1)
      : new Point(r.left + Math.trunc(r.width() / 2), r.bottom - 1);
  }
  fillBetweenPoints(level, r, from, side, floor, corners);
  fillBetweenPoints(level, r, side, to, floor, corners);
}

/** WalkwayRoom: walkways along the walls of a chasm. */
export class WalkwayRoom extends PerimeterRoom {
  override readonly kind: string = 'WalkwayRoom';

  override paint(level: GenLevel): void {
    if (Math.min(this.width(), this.height()) > 3) Painter.fill(level, this, 1, T.CHASM);
    super.paint(level);
    openToBridges(level, this);
  }

  override canMerge(_l: GenLevel, _other: Room, _p: Point, mergeTerrain: number): boolean {
    return mergeTerrain === T.CHASM;
  }
}

/** RingTunnelRoom: the tunnels meet at a small ring round a pillar. */
export class RingTunnelRoom extends TunnelRoom {
  override readonly kind: string = 'RingTunnelRoom';
  private connSpace: Rect | null = null;

  override minWidth(): number {
    return Math.max(5, super.minWidth());
  }
  override minHeight(): number {
    return Math.max(5, super.minHeight());
  }

  override paint(level: GenLevel): void {
    super.paint(level);
    const floor = level.tunnelTile();
    const ring = this.getConnectionSpace();
    Painter.fill(level, ring.left, ring.top, 3, 3, floor);
    Painter.fill(level, ring.left + 1, ring.top + 1, 1, 1, T.WALL);
  }

  /** Remembered, so every call answers the same. */
  protected override getConnectionSpace(): Rect {
    if (!this.connSpace) {
      const c = this.getDoorCenter();
      c.x = gate(this.left + 2, c.x, this.right - 2);
      c.y = gate(this.top + 2, c.y, this.bottom - 2);
      this.connSpace = new Rect(c.x - 1, c.y - 1, c.x + 1, c.y + 1);
    }
    return this.connSpace;
  }
}

/** RingBridgeRoom: the ring over a chasm. */
export class RingBridgeRoom extends RingTunnelRoom {
  override readonly kind: string = 'RingBridgeRoom';

  override paint(level: GenLevel): void {
    Painter.fill(level, this, 1, T.CHASM);
    super.paint(level);
    openToBridges(level, this);
  }

  override canMerge(_l: GenLevel, _other: Room, _p: Point, mergeTerrain: number): boolean {
    return mergeTerrain === T.CHASM;
  }
}

/** MazeConnectionRoom: a little maze behind hidden doors, the way to secret rooms. */
export class MazeConnectionRoom extends ConnectionRoom {
  readonly kind: string = 'MazeConnectionRoom';

  paint(level: GenLevel): void {
    Painter.fill(level, this, 1, T.EMPTY);
    Maze.allowDiagonals = false;
    let maze = Maze.generateRoom(this);
    // A small maze should have its middle filled, to look like a maze.
    while (this.width() >= 5 && this.height() >= 5 && (this.width() <= 7 || this.height() <= 7) &&
      maze[Math.trunc(this.width() / 2)]![Math.trunc(this.height() / 2)] === Maze.EMPTY) {
      maze = Maze.generateRoom(this);
    }
    Painter.fill(level, this, 1, T.EMPTY);
    for (let x = 0; x < maze.length; x++) {
      for (let y = 0; y < maze[0]!.length; y++) {
        if (maze[x]![y] === Maze.FILLED) Painter.fill(level, x + this.left, y + this.top, 1, 1, T.WALL);
      }
    }
    for (const door of this.doors()) door.set(DoorType.HIDDEN);
  }

  override maxConnections(_direction: number): number {
    return 2;
  }
}

void Door;

const ROOMS: ReadonlyArray<new () => ConnectionRoom> = [TunnelRoom, BridgeRoom, PerimeterRoom, WalkwayRoom, RingTunnelRoom, RingBridgeRoom];

/** ConnectionRoom.chances by depth. */
const CHANCES: number[][] = (() => {
  const c: number[][] = [];
  c[1] = [20, 1, 0, 2, 2, 1];
  c[4] = c[3] = c[2] = c[1];
  c[5] = [20, 0, 0, 0, 0, 0];
  c[6] = [0, 0, 22, 3, 0, 0];
  c[10] = c[9] = c[8] = c[7] = c[6];
  c[11] = [12, 0, 0, 5, 5, 3];
  c[15] = c[14] = c[13] = c[12] = c[11];
  c[16] = [0, 0, 18, 3, 3, 1];
  c[20] = c[19] = c[18] = c[17] = c[16];
  c[21] = c[5];
  c[22] = [15, 4, 0, 2, 3, 2];
  c[26] = c[25] = c[24] = c[23] = c[22];
  return c;
})();

/** ConnectionRoom.createRoom: by the depth's chances. */
export function createConnectionRoom(depth: number): ConnectionRoom {
  const chances = CHANCES[Math.min(Math.max(depth, 1), 26)]!;
  return new ROOMS[Random.chances(chances)]!();
}
