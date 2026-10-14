import { T } from '../../../terrain';
import { gate } from '../../builders/builder';
import type { GenLevel } from '../../genlevel';
import { Painter } from '../../painter';
import { Random } from '../../random';
import { Point, Rect } from '../../rect';
import { DoorType, type Room } from '../../room';
import { f32 } from './helpers';
import { StandardRoom } from './standard';

/* levels/rooms/standard/SewerPipeRoom and RingRoom, the sewers' own rooms. */

/** SewerPipeRoom: channels of water from door to door, a ledge of floor alongside; doors to another such room are water too. */
export class SewerPipeRoom extends StandardRoom {
  readonly kind: string = 'SewerPipeRoom';
  private corners: Point[] | null = null;

  override minWidth(): number {
    return Math.max(7, super.minWidth());
  }
  override minHeight(): number {
    return Math.max(7, super.minHeight());
  }
  override sizeCatProbs(): number[] {
    return [3, 2, 1];
  }
  override canMerge(_l: GenLevel, _other: Room, _p: Point, _mergeTerrain: number): boolean {
    return false;
  }
  /** No doors next to the corners. */
  override canConnectPoint(p: Point): boolean {
    return super.canConnectPoint(p) && ((p.x > this.left + 1 && p.x < this.right - 1) || (p.y > this.top + 1 && p.y < this.bottom - 1));
  }

  paint(level: GenLevel): void {
    Painter.fill(level, this, T.WALL);
    const c = this.getConnectionSpace();

    // Through the middle with one door, or two in a normal-sized room; else along the edges.
    if (this.connected.size === 1 || (this.connected.size === 2 && this.sizeCat.name === 'NORMAL')) {
      for (const door of this.doors()) {
        const start = door.clone();
        if (start.x === this.left) start.x += 2;
        else if (start.y === this.top) start.y += 2;
        else if (start.x === this.right) start.x -= 2;
        else if (start.y === this.bottom) start.y -= 2;

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
        Painter.drawLine(level, start, mid, T.WATER);
        Painter.drawLine(level, mid, end, T.WATER);
      }
    } else {
      const doorPoints: Point[] = [...this.doors()];
      // With only two doors, a phantom third along an empty wall keeps a bigger room open enough.
      if (doorPoints.length === 2) {
        const p = new Point();
        let valid: boolean;
        do {
          valid = true;
          if (Random.Int(2) === 0) {
            p.x = Random.Int(2) === 0 ? this.left : this.right;
            p.y = Random.IntRange(this.top + 2, this.bottom - 2);
          } else {
            p.x = Random.IntRange(this.left + 2, this.right - 2);
            p.y = Random.Int(2) === 0 ? this.top : this.bottom;
          }
          for (const door of this.doors()) if (door.x === p.x || door.y === p.y) valid = false;
        } while (!valid);
        doorPoints.push(p);
      }

      const pointsToFill: Point[] = [];
      for (const door of doorPoints) {
        const p = door.clone();
        if (p.y === this.top) p.y += 2;
        else if (p.y === this.bottom) p.y -= 2;
        else if (p.x === this.left) p.x += 2;
        else p.x -= 2;
        pointsToFill.push(p);
      }

      const pointsFilled: Point[] = [pointsToFill.shift()!];
      let from: Point | null = null;
      let to: Point | null = null;
      while (pointsToFill.length > 0) {
        let shortestDistance = Number.MAX_SAFE_INTEGER;
        for (const f of pointsFilled) {
          for (const t of pointsToFill) {
            const dist = this.distanceBetweenPoints(f, t);
            if (dist < shortestDistance) {
              from = f;
              to = t;
              shortestDistance = dist;
            }
          }
        }
        this.fillBetweenPoints(level, from!, to!, T.WATER);
        pointsFilled.push(to!);
        // ArrayList.remove(Object): the first equal point.
        const target = to!;
        pointsToFill.splice(pointsToFill.findIndex((q) => q.equals(target)), 1);
      }
    }

    for (const p of this.getPoints()) {
      const cell = level.pointToCell(p);
      if (level.map[cell] === T.WATER) {
        for (const i of level.neighbours8) {
          if (level.map[cell + i] === T.WALL) Painter.set(level, cell + i, T.EMPTY);
        }
      }
    }

    for (const [r, door] of this.connected) {
      if (!door) continue;
      if (r instanceof SewerPipeRoom) {
        Painter.fill(level, door.x - 1, door.y - 1, 3, 3, T.EMPTY);
        if (door.x === this.left || door.x === this.right) Painter.fill(level, door.x - 1, door.y, 3, 1, T.WATER);
        else Painter.fill(level, door.x, door.y - 1, 1, 3, T.WATER);
        door.set(DoorType.WATER);
      } else {
        door.set(DoorType.REGULAR);
      }
    }
  }

  /** Where every door's channel must reach (one cell); inclusive of its right and bottom sides. */
  protected getConnectionSpace(): Rect {
    const c = this.connected.size <= 1 ? this.center() : this.getDoorCenter();
    return new Rect(c.x, c.y, c.x, c.y);
  }

  override canPlaceWater(_p: Point): boolean {
    return false;
  }

  /** A point as far from every door as can be. */
  protected getDoorCenter(): Point {
    let x = 0;
    let y = 0;
    for (const door of this.doors()) {
      x = f32(x + door.x);
      y = f32(y + door.y);
    }
    const n = this.connected.size;
    const c = new Point(Math.trunc(Math.trunc(x) / n), Math.trunc(Math.trunc(y) / n));
    // The sums are whole numbers, so these never move the point; the draws are kept.
    if (Random.Float() < x % 1) c.x++;
    if (Random.Float() < y % 1) c.y++;
    c.x = gate(this.left + 2, c.x, this.right - 2);
    c.y = gate(this.top + 2, c.y, this.bottom - 2);
    return c;
  }

  private spaceBetween(a: number, b: number): number {
    return Math.abs(a - b) - 1;
  }

  /** The length of channel between two points just inside the walls. */
  private distanceBetweenPoints(a: Point, b: Point): number {
    // On the same side.
    if (((a.x === this.left + 2 || a.x === this.right - 2) && a.y === b.y) || ((a.y === this.top + 2 || a.y === this.bottom - 2) && a.x === b.x)) {
      return Math.max(this.spaceBetween(a.x, b.x), this.spaceBetween(a.y, b.y));
    }
    // Otherwise round the corners, less one for the overlap.
    return (
      Math.min(this.spaceBetween(this.left, a.x) + this.spaceBetween(this.left, b.x), this.spaceBetween(this.right, a.x) + this.spaceBetween(this.right, b.x)) +
      Math.min(this.spaceBetween(this.top, a.y) + this.spaceBetween(this.top, b.y), this.spaceBetween(this.bottom, a.y) + this.spaceBetween(this.bottom, b.y)) -
      1
    );
  }

  /** The shortest channel between two points. */
  private fillBetweenPoints(level: GenLevel, from: Point, to: Point, floor: number): void {
    // Along the same side.
    if (((from.x === this.left + 2 || from.x === this.right - 2) && from.x === to.x) || ((from.y === this.top + 2 || from.y === this.bottom - 2) && from.y === to.y)) {
      Painter.fill(level, Math.min(from.x, to.x), Math.min(from.y, to.y), this.spaceBetween(from.x, to.x) + 2, this.spaceBetween(from.y, to.y) + 2, floor);
      return;
    }

    this.corners ??= [
      new Point(this.left + 2, this.top + 2),
      new Point(this.right - 2, this.top + 2),
      new Point(this.right - 2, this.bottom - 2),
      new Point(this.left + 2, this.bottom - 2),
    ];

    // On adjacent sides: through the corner between.
    for (const c of this.corners) {
      if ((c.x === from.x || c.y === from.y) && (c.x === to.x || c.y === to.y)) {
        Painter.drawLine(level, from, c, floor);
        Painter.drawLine(level, c, to, floor);
        return;
      }
    }

    // On opposite sides: by way of the shorter side between, as two adjacent-side channels.
    let side: Point;
    if (from.y === this.top + 2 || from.y === this.bottom - 2) {
      if (this.spaceBetween(this.left, from.x) + this.spaceBetween(this.left, to.x) <= this.spaceBetween(this.right, from.x) + this.spaceBetween(this.right, to.x)) {
        side = new Point(this.left + 2, this.top + Math.trunc(this.height() / 2));
      } else {
        side = new Point(this.right - 2, this.top + Math.trunc(this.height() / 2));
      }
    } else if (this.spaceBetween(this.top, from.y) + this.spaceBetween(this.top, to.y) <= this.spaceBetween(this.bottom, from.y) + this.spaceBetween(this.bottom, to.y)) {
      side = new Point(this.left + Math.trunc(this.width() / 2), this.top + 2);
    } else {
      side = new Point(this.left + Math.trunc(this.width() / 2), this.bottom - 2);
    }
    this.fillBetweenPoints(level, from, side, floor);
    this.fillBetweenPoints(level, side, to, floor);
  }
}

/** RingRoom: a walkway round a solid middle; in bigger rooms the middle is hollow, with a prize on special floor behind a door. */
export class RingRoom extends StandardRoom {
  readonly kind: string = 'RingRoom';

  override minWidth(): number {
    return Math.max(super.minWidth(), 7);
  }
  override minHeight(): number {
    return Math.max(super.minHeight(), 7);
  }
  override sizeCatProbs(): number[] {
    return [9, 3, 1];
  }

  paint(level: GenLevel): void {
    Painter.fill(level, this, T.WALL);
    Painter.fill(level, this, 1, T.EMPTY);

    const minDim = Math.min(this.width(), this.height());
    const passageWidth = Math.floor(f32(f32(0.2) * (minDim + 3)));
    Painter.fill(level, this, passageWidth + 1, T.WALL);

    if (minDim >= 10) {
      Painter.fill(level, this, passageWidth + 2, this.centerDecoTiles());

      const center = this.center();
      let xDir = 0;
      let yDir = 0;
      // The door goes the longer way out, if there is one.
      if (Random.Int(2) === 0) {
        if (center.x < (this.left + this.right) / 2) xDir = 1;
        else if (center.x > (this.left + this.right) / 2) xDir = -1;
        else xDir = Random.Int(2) === 0 ? 1 : -1;
      } else {
        if (center.y < (this.top + this.bottom) / 2) yDir = 1;
        else if (center.y > (this.top + this.bottom) / 2) yDir = -1;
        else yDir = Random.Int(2) === 0 ? 1 : -1;
      }

      Painter.set(level, center, T.EMPTY_SP);
      this.placeCenterDetail(level, level.pointToCell(center));
      center.x += xDir;
      center.y += yDir;
      while (level.map[level.pointToCell(center)] !== T.WALL) {
        Painter.set(level, center, T.EMPTY_SP);
        center.x += xDir;
        center.y += yDir;
      }
      Painter.set(level, center, T.DOOR);
    }

    for (const door of this.doors()) door.set(DoorType.REGULAR);
  }

  protected centerDecoTiles(): number {
    return T.REGION_DECO_ALT;
  }

  protected placeCenterDetail(level: GenLevel, pos: number): void {
    level.drop(level.findPrizeItem(), pos);
  }
}
