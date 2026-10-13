import { T } from '../../../terrain';
import type { GenLevel } from '../../genlevel';
import { Painter } from '../../painter';
import { Random } from '../../random';
import { Point, PointF } from '../../rect';
import { DoorType, type Room } from '../../room';
import { atan, cos, sin } from '../../trig';
import { f32, reachable } from './helpers';
import { StandardRoom } from './standard';

/* levels/rooms/standard/CavesFissureRoom, CirclePitRoom and CircleWallRoom, the caves' own rooms. */

const A = 180 / Math.PI;

/** CavesFissureRoom.angleBetweenPoints: in degrees, clockwise from straight up. */
function angleBetweenPoints(from: PointF, to: PointF): number {
  const m = f32(f32(to.y - from.y) / f32(to.x - from.x));
  let angle = f32(A * (atan(m) + Math.PI / 2.0));
  if (from.x > to.x) angle = f32(angle - 180);
  return angle;
}

/** CavesFissureRoom: two to four fissures of chasm out from the middle, never at a door, each bridged. */
export class CavesFissureRoom extends StandardRoom {
  readonly kind: string = 'CavesFissureRoom';

  override minWidth(): number {
    return Math.max(7, super.minWidth());
  }
  override minHeight(): number {
    return Math.max(7, super.minHeight());
  }
  override sizeCatProbs(): number[] {
    return [9, 3, 1];
  }
  override canMerge(l: GenLevel, _other: Room, p: Point, mergeTerrain: number): boolean {
    if (mergeTerrain === T.CHASM) return true;
    return l.map[l.pointToCell(this.pointInside(p, 1))] !== T.CHASM;
  }
  override canPlaceItem(p: Point, l: GenLevel): boolean {
    return super.canPlaceItem(p, l) && l.map[l.pointToCell(p)] !== T.EMPTY_SP;
  }
  override canPlaceCharacter(p: Point, l: GenLevel): boolean {
    return super.canPlaceCharacter(p, l) && l.map[l.pointToCell(p)] !== T.EMPTY_SP;
  }

  paint(level: GenLevel): void {
    const w = level.width;
    let pathable = true;
    do {
      Painter.fill(level, this, T.WALL);
      Painter.fill(level, this, 1, T.EMPTY);
      for (const door of this.doors()) door.set(DoorType.REGULAR);

      const c = this.center();
      const center = new PointF(f32(c.x + 0.5), f32(c.y + 0.5));

      // The angle of each door from the middle.
      const doorAngles: number[] = [];
      for (const d of this.doors()) {
        let doorAngle = angleBetweenPoints(center, new PointF(f32(d.x + 0.5), f32(d.y + 0.5)));
        if (doorAngle < 0) doorAngle = f32(doorAngle + 360);
        doorAngles.push(doorAngle);
      }

      // 2-4 fissures, not too close to the doors or to each other.
      const lineAngles: number[] = [];
      const numLines = 1 + this.sizeFactor();
      for (let i = 0; i < numLines; i++) {
        let tries = 100;
        let valid: boolean;
        do {
          valid = true;
          const lineAngle = Random.Float(0, 360);
          for (const doorAngle of doorAngles) {
            let angleDiff = f32(Math.abs(lineAngle - doorAngle));
            if (angleDiff > 180) angleDiff = f32(360 - angleDiff);
            if (angleDiff <= (this.sizeCat.name === 'NORMAL' ? 30 : 15)) {
              valid = false;
              break;
            }
          }
          for (const existingLineAngle of lineAngles) {
            let angleDiff = f32(Math.abs(lineAngle - existingLineAngle));
            if (angleDiff > 180) angleDiff = f32(360 - angleDiff);
            if (angleDiff <= (numLines === 2 ? 120 : 60)) {
              valid = false;
              break;
            }
          }
          if (valid) lineAngles.push(lineAngle);
        } while (!valid && --tries > 0);
      }

      // Without at least two, it stays an empty room.
      if (lineAngles.length < 2) return;

      const giant = this.sizeCat.name === 'GIANT';
      for (const lineAngle of lineAngles) {
        let dX = f32(cos(lineAngle / A - Math.PI / 2.0));
        let dY = f32(sin(lineAngle / A - Math.PI / 2.0));
        let horizontal: boolean;
        if (Math.abs(dX) >= Math.abs(dY)) {
          horizontal = true;
          dY = f32(dY / Math.abs(dX));
          dX = f32(dX / Math.abs(dX));
        } else {
          horizontal = false;
          dX = f32(dX / Math.abs(dY));
          dY = f32(dY / Math.abs(dY));
        }

        const curr = new PointF(center.x, center.y);
        let cell = Math.trunc(curr.x) + Math.trunc(curr.y) * w;
        Painter.set(level, cell, T.CHASM);
        do {
          if (!horizontal) {
            if (level.map[cell - 1] === T.EMPTY && (curr.x % 1 <= 0.5 || giant)) Painter.set(level, cell - 1, T.CHASM);
            if (level.map[cell] === T.EMPTY) Painter.set(level, cell, T.CHASM);
            if (level.map[cell + 1] === T.EMPTY && (curr.x % 1 > 0.5 || giant)) Painter.set(level, cell + 1, T.CHASM);
          } else {
            if (level.map[cell - w] === T.EMPTY && (curr.y % 1 <= 0.5 || giant)) Painter.set(level, cell - w, T.CHASM);
            if (level.map[cell] === T.EMPTY) Painter.set(level, cell, T.CHASM);
            if (level.map[cell + w] === T.EMPTY && (curr.y % 1 > 0.5 || giant)) Painter.set(level, cell + w, T.CHASM);
          }
          curr.x = f32(curr.x + dX);
          curr.y = f32(curr.y + dY);
          cell = Math.trunc(curr.x) + Math.trunc(curr.y) * w;
        } while (level.map[cell] === T.EMPTY || level.map[cell] === T.CHASM);
      }

      // A chasm in the middle of larger rooms.
      if (lineAngles.length >= 3) {
        if (giant) Painter.fill(level, Math.trunc(center.x) - 2, Math.trunc(center.y) - 2, 5, 5, T.CHASM);
        else Painter.fill(level, Math.trunc(center.x) - 1, Math.trunc(center.y) - 1, 3, 3, T.CHASM);
      }

      // Bridges over the fissures.
      if (lineAngles.length === 2) {
        this.buildBridge(level, Random.element(lineAngles)!, center, 1);
      } else {
        for (const angle of lineAngles) this.buildBridge(level, angle, center, this.sizeFactor());
      }

      let doorPoint = 0;
      for (const door of this.doors()) {
        Painter.drawInside(level, this, door, 1, T.EMPTY);
        if (door.x === this.left) doorPoint = this.xyToRoomCoords(door.x + 1, door.y);
        else if (door.x === this.right) doorPoint = this.xyToRoomCoords(door.x - 1, door.y);
        else if (door.y === this.top) doorPoint = this.xyToRoomCoords(door.x, door.y + 1);
        else if (door.y === this.bottom) doorPoint = this.xyToRoomCoords(door.x, door.y - 1);
      }

      // Every cell that is not chasm must be reachable.
      pathable = true;
      const rw = this.width() - 2;
      const size = rw * (this.height() - 2);
      const passable = new Array<boolean>(size).fill(false);
      const inner = this.shrink().getPoints();
      for (const p of inner) passable[this.xyToRoomCoords(p.x, p.y)] = level.map[level.pointToCell(p)] !== T.CHASM;
      const reached = reachable(rw, size, doorPoint, passable);
      for (const p of inner) {
        const i = this.xyToRoomCoords(p.x, p.y);
        if (passable[i] && !reached[i]) {
          pathable = false;
          break;
        }
      }
    } while (!pathable);
  }

  private buildBridge(level: GenLevel, fissureAngle: number, center: PointF, centerMargin: number): void {
    const dX = f32(cos(fissureAngle / A - Math.PI / 2.0));
    const dY = f32(sin(fissureAngle / A - Math.PI / 2.0));
    const edgemargin = 2;
    const w = level.width;

    if (Math.abs(dY) >= Math.abs(dX)) {
      // A horizontal bridge.
      const Y = dY > 0
        ? Random.IntRange(Math.trunc(center.y) + centerMargin, this.bottom - edgemargin)
        : Random.IntRange(this.top + edgemargin, Math.trunc(center.y) - centerMargin);
      let foundChasm = false;
      if (dX <= 0) {
        for (let X = this.left + 1; X <= this.right - 1; X++) {
          const cell = X + Y * w;
          if (level.map[cell] === T.CHASM) {
            foundChasm = true;
            Painter.set(level, cell, T.EMPTY_SP);
          } else if (foundChasm) {
            break;
          }
        }
      } else {
        for (let X = this.right - 1; X >= this.left + 1; X--) {
          const cell = X + Y * w;
          if (level.map[cell] === T.CHASM) {
            foundChasm = true;
            Painter.set(level, cell, T.EMPTY_SP);
          } else if (foundChasm) {
            break;
          }
        }
      }
    } else {
      // A vertical bridge.
      const X = dX > 0
        ? Random.IntRange(Math.trunc(center.x) + centerMargin, this.right - edgemargin)
        : Random.IntRange(this.left + edgemargin, Math.trunc(center.x) - centerMargin);
      let foundChasm = false;
      if (dY <= 0) {
        for (let Y = this.top + 1; Y <= this.bottom - 1; Y++) {
          const cell = X + Y * w;
          if (level.map[cell] === T.CHASM) {
            foundChasm = true;
            Painter.set(level, cell, T.EMPTY_SP);
          } else if (foundChasm) {
            break;
          }
        }
      } else {
        for (let Y = this.bottom - 1; Y >= this.top + 1; Y--) {
          const cell = X + Y * w;
          if (level.map[cell] === T.CHASM) {
            foundChasm = true;
            Painter.set(level, cell, T.EMPTY_SP);
          } else if (foundChasm) {
            break;
          }
        }
      }
    }
  }

  protected xyToRoomCoords(x: number, y: number): number {
    return x - this.left - 1 + (y - this.top - 1) * (this.width() - 2);
  }
}

/** Opens a path from each door to the middle of a round room (the circle rooms). */
function doorPathsInward(level: GenLevel, room: Room): void {
  for (const door of room.doors()) {
    door.set(DoorType.REGULAR);
    if (door.x === room.left || door.x === room.right) {
      Painter.drawInside(level, room, door, Math.trunc(room.width() / 2), T.EMPTY);
    } else {
      Painter.drawInside(level, room, door, Math.trunc(room.height() / 2), T.EMPTY);
    }
  }
}

/** CirclePitRoom: a round room round a round pit; in bigger rooms, sometimes a line of the region's decoration out to the wall. */
export class CirclePitRoom extends StandardRoom {
  readonly kind: string = 'CirclePitRoom';

  override minWidth(): number {
    return Math.max(8, super.minWidth());
  }
  override minHeight(): number {
    return Math.max(8, super.minHeight());
  }
  override sizeCatProbs(): number[] {
    return [4, 2, 1];
  }

  paint(level: GenLevel): void {
    Painter.fill(level, this, T.WALL);
    Painter.fillEllipse(level, this, 1, T.EMPTY);
    doorPathsInward(level, this);
    Painter.fillEllipse(level, this, 3, T.CHASM);

    // Half the time in large rooms, always in giant ones.
    if (this.sizeCat.name !== 'NORMAL' && Random.Int(4 - this.sizeFactor()) === 0) {
      // A line from the middle (give or take one each way) to a side.
      const center = this.center();
      center.x += Random.IntRange(-1, 1);
      center.y += Random.IntRange(-1, 1);
      const edge = center.clone();
      switch (Random.Int(4)) {
        case 0:
          edge.x = this.left;
          break;
        case 1:
          edge.y = this.top;
          break;
        case 2:
          edge.x = this.right;
          break;
        case 3:
          edge.y = this.bottom;
          break;
      }
      let valid = true;
      for (const door of this.doors()) if (door.equals(edge)) valid = false;
      if (valid) {
        Painter.drawLine(level, edge, center, T.REGION_DECO_ALT);
        Painter.drawInside(level, this, edge, 1, T.EMPTY_SP);
        Painter.set(level, edge, T.WALL);
      }
    }
  }
}

/** CircleWallRoom: a round walkway round a round wall. */
export class CircleWallRoom extends StandardRoom {
  readonly kind: string = 'CircleWallRoom';

  override sizeCatProbs(): number[] {
    return [0, 3, 1];
  }

  paint(level: GenLevel): void {
    Painter.fill(level, this, T.WALL);
    Painter.fillEllipse(level, this, 1, T.EMPTY);
    doorPathsInward(level, this);
    Painter.fillEllipse(level, this, 3, T.WALL);
  }
}
