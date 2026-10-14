import type { GenLevel } from './genlevel';
import { Painter } from './painter';
import { Random } from './random';
import { Point, Rect } from './rect';

/*
 * levels/rooms/Room: a rectangle of the level, walls included (so width() and height() are one more
 * than the Rect's), with the rooms next to it and those it is connected to by a door. Builders lay
 * rooms out and connect them; painters (Room.paint) turn each into terrain.
 */

/** Room.Door.Type, in Shattered's order: a door keeps the strongest type any room asks for. */
export enum DoorType {
  EMPTY,
  TUNNEL,
  WATER,
  REGULAR,
  UNLOCKED,
  HIDDEN,
  BARRICADE,
  LOCKED,
  CRYSTAL,
  WALL,
}

export class Door extends Point {
  type = DoorType.EMPTY;
  private typeLocked = false;

  lockTypeChanges(lock: boolean): void {
    this.typeLocked = lock;
  }

  override set(type: DoorType): this;
  override set(x: number, y: number): this;
  override set(a: number, b?: number): this {
    if (b !== undefined) return super.set(a, b);
    if (!this.typeLocked && a > this.type) this.type = a;
    return this;
  }
}

/** Room.ALL, LEFT, TOP, RIGHT, BOTTOM. */
export const ALL = 0;
export const LEFT = 1;
export const TOP = 2;
export const RIGHT = 3;
export const BOTTOM = 4;

/** What kind of room a room is, for what is decided by class in Shattered (instanceof checks). */
export type RoomGroup = 'standard' | 'special' | 'secret' | 'connection' | 'boss';

export abstract class Room extends Rect {
  /** The room's class name in Shattered (e.g. 'SewerPipeRoom'): what the level remembers of it. */
  abstract readonly kind: string;
  abstract readonly group: RoomGroup;

  neigbours: Room[] = [];
  /** Connected rooms in insertion order; the door is placed once both are painted. */
  connected = new Map<Room, Door | null>();

  distance = 0;
  price = 1;

  /* Spatial logic. Overrides must store any random choice: the same room answers the same every time. */

  minWidth(): number {
    return -1;
  }
  maxWidth(): number {
    return -1;
  }
  minHeight(): number {
    return -1;
  }
  maxHeight(): number {
    return -1;
  }

  setSize(): boolean;
  setSize(minW: number, maxW: number, minH: number, maxH: number): boolean;
  setSize(minW?: number, maxW?: number, minH?: number, maxH?: number): boolean {
    if (minW === undefined) return this.setSize(this.minWidth(), this.maxWidth(), this.minHeight(), this.maxHeight());
    if (minW < this.minWidth() || maxW! > this.maxWidth() || minH! < this.minHeight() || maxH! > this.maxHeight() || minW > maxW! || minH! > maxH!) {
      return false;
    }
    // One less, because rooms include their right and bottom sides.
    this.resize(Random.NormalIntRange(minW, maxW!) - 1, Random.NormalIntRange(minH!, maxH!) - 1);
    return true;
  }

  forceSize(w: number, h: number): boolean {
    return this.setSize(w, w, h, h);
  }

  setSizeWithLimit(w: number, h: number): boolean {
    if (w < this.minWidth() || h < this.minHeight()) return false;
    this.setSize();
    if (this.width() > w || this.height() > h) {
      this.resize(Math.min(this.width(), w) - 1, Math.min(this.height(), h) - 1);
    }
    return true;
  }

  /** The point `n` cells in from a point on the room's edge. */
  pointInside(from: Point, n: number): Point {
    const step = from.clone();
    if (from.x === this.left) step.offset(+n, 0);
    else if (from.x === this.right) step.offset(-n, 0);
    else if (from.y === this.top) step.offset(0, +n);
    else if (from.y === this.bottom) step.offset(0, -n);
    return step;
  }

  override width(): number {
    return super.width() + 1;
  }

  override height(): number {
    return super.height() + 1;
  }

  /** Room.random(m): a point m cells in from the walls (1 by default: just inside). */
  random(m = 1): Point {
    return new Point(Random.IntRange(this.left + m, this.right - m), Random.IntRange(this.top + m, this.bottom - m));
  }

  /** Room.inside: within the walls. */
  inside(p: { x: number; y: number }): boolean {
    return p.x > this.left && p.y > this.top && p.x < this.right && p.y < this.bottom;
  }

  override center(): Point {
    return new Point(
      Math.trunc((this.left + this.right) / 2) + ((this.right - this.left) % 2 === 1 ? Random.Int(2) : 0),
      Math.trunc((this.top + this.bottom) / 2) + ((this.bottom - this.top) % 2 === 1 ? Random.Int(2) : 0),
    );
  }

  /* Connection logic */

  minConnections(direction: number): number {
    return direction === ALL ? 1 : 0;
  }

  curConnections(direction: number): number {
    if (direction === ALL) return this.connected.size;
    let total = 0;
    for (const r of this.connected.keys()) {
      const i = this.intersect(r);
      if (direction === LEFT && i.width() === 0 && i.left === this.left) total++;
      else if (direction === TOP && i.height() === 0 && i.top === this.top) total++;
      else if (direction === RIGHT && i.width() === 0 && i.right === this.right) total++;
      else if (direction === BOTTOM && i.height() === 0 && i.bottom === this.bottom) total++;
    }
    return total;
  }

  remConnections(direction: number): number {
    if (this.curConnections(ALL) >= this.maxConnections(ALL)) return 0;
    return this.maxConnections(direction) - this.curConnections(direction);
  }

  maxConnections(direction: number): number {
    return direction === ALL ? 16 : 4;
  }

  /** Whether a door may go at a point: along exactly one edge, never a corner. */
  canConnectPoint(p: Point): boolean {
    return (p.x === this.left || p.x === this.right) !== (p.y === this.top || p.y === this.bottom);
  }

  canConnectDirection(direction: number): boolean {
    return this.remConnections(direction) > 0;
  }

  /** Room.canConnect(Room): by both rooms' limits, at some point they share. */
  canConnect(r: Room): boolean {
    // An entrance and an exit never connect directly.
    if ((this.isExit() && r.isEntrance()) || (this.isEntrance() && r.isExit())) return false;
    const i = this.intersect(r);
    let foundPoint = false;
    for (const p of i.getPoints()) {
      if (this.canConnectPoint(p) && r.canConnectPoint(p)) {
        foundPoint = true;
        break;
      }
    }
    if (!foundPoint) return false;
    if (i.width() === 0 && i.left === this.left) return this.canConnectDirection(LEFT) && r.canConnectDirection(RIGHT);
    if (i.height() === 0 && i.top === this.top) return this.canConnectDirection(TOP) && r.canConnectDirection(BOTTOM);
    if (i.width() === 0 && i.right === this.right) return this.canConnectDirection(RIGHT) && r.canConnectDirection(LEFT);
    if (i.height() === 0 && i.bottom === this.bottom) return this.canConnectDirection(BOTTOM) && r.canConnectDirection(TOP);
    return false;
  }

  canMerge(_l: GenLevel, _other: Room, _p: Point, _mergeTerrain: number): boolean {
    return false;
  }

  /** Room.merge: knocks the shared wall out between two rooms. */
  merge(l: GenLevel, _other: Room, merge: Rect, mergeTerrain: number): void {
    Painter.fillRect(l, merge, mergeTerrain);
  }

  addNeigbour(other: Room): boolean {
    if (this.neigbours.includes(other)) return true;
    const i = this.intersect(other);
    if ((i.width() === 0 && i.height() >= 2) || (i.height() === 0 && i.width() >= 2)) {
      this.neigbours.push(other);
      other.neigbours.push(this);
      return true;
    }
    return false;
  }

  connect(room: Room): boolean {
    if ((this.neigbours.includes(room) || this.addNeigbour(room)) && !this.connected.has(room) && this.canConnect(room)) {
      this.connected.set(room, null);
      room.connected.set(this, null);
      return true;
    }
    return false;
  }

  clearConnections(): void {
    for (const r of this.neigbours) {
      const index = r.neigbours.indexOf(this);
      if (index >= 0) r.neigbours.splice(index, 1);
    }
    this.neigbours = [];
    for (const r of this.connected.keys()) r.connected.delete(this);
    this.connected.clear();
  }

  isEntrance(): boolean {
    return false;
  }

  isExit(): boolean {
    return false;
  }

  /** The doors of this room, in connection order (connected.values()). */
  doors(): Door[] {
    return [...this.connected.values()].filter((d): d is Door => d !== null);
  }

  /* Painting */

  abstract paint(level: GenLevel): void;

  canPlaceWater(_p: Point): boolean {
    return true;
  }

  waterPlaceablePoints(): Point[] {
    return this.pointsWhere((p) => this.canPlaceWater(p));
  }

  canPlaceGrass(_p: Point): boolean {
    return true;
  }

  grassPlaceablePoints(): Point[] {
    return this.pointsWhere((p) => this.canPlaceGrass(p));
  }

  canPlaceTrap(_p: Point): boolean {
    return true;
  }

  trapPlaceablePoints(): Point[] {
    return this.pointsWhere((p) => this.canPlaceTrap(p));
  }

  /** Whether an item can be placed here (usually by randomDropCell). */
  canPlaceItem(p: Point, _l: GenLevel): boolean {
    return this.inside(p);
  }

  itemPlaceablePoints(l: GenLevel): Point[] {
    return this.pointsWhere((p) => this.canPlaceItem(p, l));
  }

  /** Whether a character can be placed here (spawned, teleported, wandering). */
  canPlaceCharacter(p: Point, _l: GenLevel): boolean {
    return this.inside(p);
  }

  charPlaceablePoints(l: GenLevel): Point[] {
    return this.pointsWhere((p) => this.canPlaceCharacter(p, l));
  }

  private pointsWhere(ok: (p: Point) => boolean): Point[] {
    const points: Point[] = [];
    for (let i = this.left; i <= this.right; i++) {
      for (let j = this.top; j <= this.bottom; j++) {
        const p = new Point(i, j);
        if (ok(p)) points.push(p);
      }
    }
    return points;
  }

  /* Graph.Node: for path building, only doors one can walk through count as edges. */

  edges(): Room[] {
    const edges: Room[] = [];
    for (const [r, d] of this.connected) {
      if (d && (d.type === DoorType.EMPTY || d.type === DoorType.TUNNEL || d.type === DoorType.UNLOCKED || d.type === DoorType.REGULAR)) {
        edges.push(r);
      }
    }
    return edges;
  }
}

/** Graph.buildDistanceMap: rooms' distance from the focus, by price, through walkable doors. */
export function buildDistanceMap(nodes: Iterable<Room>, focus: Room): void {
  for (const node of nodes) node.distance = Number.MAX_SAFE_INTEGER;
  const queue: Room[] = [focus];
  focus.distance = 0;
  for (let head = 0; head < queue.length; head++) {
    const node = queue[head]!;
    for (const edge of node.edges()) {
      if (edge.distance > node.distance + node.price) {
        queue.push(edge);
        edge.distance = node.distance + node.price;
      }
    }
  }
}

/** Graph.buildPath: the rooms from one to another, down the distance map; null if none. */
export function buildPath(from: Room, to: Room): Room[] | null {
  const path: Room[] = [];
  let room = from;
  while (room !== to) {
    let min = room.distance;
    let next: Room | null = null;
    for (const edge of room.edges()) {
      if (edge.distance < min) {
        min = edge.distance;
        next = edge;
      }
    }
    if (!next) return null;
    path.push(next);
    room = next;
  }
  return path;
}
