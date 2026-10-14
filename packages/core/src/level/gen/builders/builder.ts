import { javaRound } from '../painter';
import { Random } from '../random';
import { Point, PointF, Rect } from '../rect';
import { BOTTOM, LEFT, RIGHT, type Room, TOP } from '../room';
import { atan, tan } from '../trig';

/*
 * levels/builders/Builder: takes a list of rooms and lays them out as a connected map, or fails
 * (null), and the shared geometry the builders use to do it.
 */

const f32 = Math.fround;

export abstract class Builder {
  abstract build(rooms: Room[]): Room[] | null;

  static findNeighbours(rooms: Room[]): void {
    for (let i = 0; i < rooms.length - 1; i++) {
      for (let j = i + 1; j < rooms.length; j++) rooms[i]!.addNeigbour(rooms[j]!);
    }
  }

  /** The largest free rectangle around a start point, at most maxSize each way, clear of the rooms given. */
  static findFreeSpace(start: Point, collision: Room[], maxSize: number): Rect {
    const space = new Rect(start.x - maxSize, start.y - maxSize, start.x + maxSize, start.y + maxSize);
    let colliding = [...collision];
    do {
      // Drop empty rooms and those we are not overlapping.
      colliding = colliding.filter((room) => !(
        room.isEmpty() ||
        Math.max(space.left, room.left) >= Math.min(space.right, room.right) ||
        Math.max(space.top, room.top) >= Math.min(space.bottom, room.bottom)
      ));

      // The overlapping room closest to the start.
      let closestRoom: Room | null = null;
      let closestDiff = 2147483647;
      const curDiff = new Point();
      for (const curRoom of colliding) {
        curDiff.x = curDiff.y = 0;
        let inside = true;
        if (start.x <= curRoom.left) {
          inside = false;
          curDiff.x = curRoom.left - start.x;
        } else if (start.x >= curRoom.right) {
          inside = false;
          curDiff.x = start.x - curRoom.right;
        }
        if (start.y <= curRoom.top) {
          inside = false;
          curDiff.y = curRoom.top - start.y;
        } else if (start.y >= curRoom.bottom) {
          inside = false;
          curDiff.y = start.y - curRoom.bottom;
        }
        // The start point is inside a room: no space at all.
        if (inside) {
          space.set(start.x, start.y, start.x, start.y);
          return space;
        }
        if (curDiff.length() < closestDiff) {
          closestDiff = curDiff.length();
          closestRoom = curRoom;
        }
      }

      if (closestRoom) {
        let wDiff = 2147483647;
        if (closestRoom.left >= start.x) wDiff = (space.right - closestRoom.left) * (space.height() + 1);
        else if (closestRoom.right <= start.x) wDiff = (closestRoom.right - space.left) * (space.height() + 1);
        let hDiff = 2147483647;
        if (closestRoom.top >= start.y) hDiff = (space.bottom - closestRoom.top) * (space.width() + 1);
        else if (closestRoom.bottom <= start.y) hDiff = (closestRoom.bottom - space.top) * (space.width() + 1);

        // Shrink as little as resolves the collision.
        if (wDiff < hDiff || (wDiff === hDiff && Random.Int(2) === 0)) {
          if (closestRoom.left >= start.x && closestRoom.left < space.right) space.right = closestRoom.left;
          if (closestRoom.right <= start.x && closestRoom.right > space.left) space.left = closestRoom.right;
        } else {
          if (closestRoom.top >= start.y && closestRoom.top < space.bottom) space.bottom = closestRoom.top;
          if (closestRoom.bottom <= start.y && closestRoom.bottom > space.top) space.top = closestRoom.bottom;
        }
        colliding.splice(colliding.indexOf(closestRoom), 1);
      } else {
        colliding = [];
      }
    } while (colliding.length > 0);
    return space;
  }

  /** The angle in degrees between two rooms' centres, 0 straight up. */
  static angleBetweenRooms(from: Room, to: Room): number {
    const fromCenter = new PointF(f32((from.left + from.right) / 2), f32((from.top + from.bottom) / 2));
    const toCenter = new PointF(f32((to.left + to.right) / 2), f32((to.top + to.bottom) / 2));
    return Builder.angleBetweenPoints(fromCenter, toCenter);
  }

  static angleBetweenPoints(from: PointF, to: PointF): number {
    const m = (to.y - from.y) / (to.x - from.x);
    let angle = f32(A * (atan(m) + Math.PI / 2.0));
    if (from.x > to.x) angle = f32(angle - 180);
    return angle;
  }

  /**
   * Places a room next to another so that the angle between their centres is as near the one given
   * (0 straight up, [0, 360)) as it can be; returns the angle it got, or -1 if it could not.
   */
  static placeRoom(collision: Room[], prev: Room, next: Room, angle: number): number {
    // Wrap the angle into [0, 360).
    angle = f32(angle % 360);
    if (angle < 0) angle = f32(angle + 360);

    const prevCenter = new PointF(f32((prev.left + prev.right) / 2), f32((prev.top + prev.bottom) / 2));

    // y = mx + b, the line from the previous room's centre.
    const m = tan(angle / A + Math.PI / 2.0);
    const b = prevCenter.y - m * prevCenter.x;

    // Where the line leaves the previous room.
    let start: Point;
    let direction: number;
    if (Math.abs(m) >= 1) {
      if (angle < 90 || angle > 270) {
        direction = TOP;
        start = new Point(javaRound((prev.top - b) / m), prev.top);
      } else {
        direction = BOTTOM;
        start = new Point(javaRound((prev.bottom - b) / m), prev.bottom);
      }
    } else if (angle < 180) {
      direction = RIGHT;
      start = new Point(prev.right, javaRound(m * prev.right + b));
    } else {
      direction = LEFT;
      start = new Point(prev.left, javaRound(m * prev.left + b));
    }

    // Kept to a point most rooms can connect at.
    if (direction === TOP || direction === BOTTOM) start.x = gate(prev.left + 1, start.x, prev.right - 1);
    else start.y = gate(prev.top + 1, start.y, prev.bottom - 1);

    // Room for it?
    const space = Builder.findFreeSpace(start, collision, Math.max(next.maxWidth(), next.maxHeight()));
    if (!next.setSizeWithLimit(space.width() + 1, space.height() + 1)) return -1;

    // The ideal centre, from the line and the room's size.
    const targetCenter = new PointF();
    if (direction === TOP) {
      targetCenter.y = f32(prev.top - f32((next.height() - 1) / 2));
      targetCenter.x = f32((targetCenter.y - b) / m);
      next.setPos(javaRound(f32(targetCenter.x - f32((next.width() - 1) / 2))), prev.top - (next.height() - 1));
    } else if (direction === BOTTOM) {
      targetCenter.y = f32(prev.bottom + f32((next.height() - 1) / 2));
      targetCenter.x = f32((targetCenter.y - b) / m);
      next.setPos(javaRound(f32(targetCenter.x - f32((next.width() - 1) / 2))), prev.bottom);
    } else if (direction === RIGHT) {
      targetCenter.x = f32(prev.right + f32((next.width() - 1) / 2));
      targetCenter.y = f32(m * targetCenter.x + b);
      next.setPos(prev.right, javaRound(f32(targetCenter.y - f32((next.height() - 1) / 2))));
    } else {
      targetCenter.x = f32(prev.left - f32((next.width() - 1) / 2));
      targetCenter.y = f32(m * targetCenter.x + b);
      next.setPos(prev.left - (next.width() - 1), javaRound(f32(targetCenter.y - f32((next.height() - 1) / 2))));
    }

    // Kept within reach of a connection and within the free space.
    if (direction === TOP || direction === BOTTOM) {
      if (next.right < prev.left + 2) next.shift(prev.left + 2 - next.right, 0);
      else if (next.left > prev.right - 2) next.shift(prev.right - 2 - next.left, 0);
      if (next.right > space.right) next.shift(space.right - next.right, 0);
      else if (next.left < space.left) next.shift(space.left - next.left, 0);
    } else {
      if (next.bottom < prev.top + 2) next.shift(0, prev.top + 2 - next.bottom);
      else if (next.top > prev.bottom - 2) next.shift(0, prev.bottom - 2 - next.top);
      if (next.bottom > space.bottom) next.shift(0, space.bottom - next.bottom);
      else if (next.top < space.top) next.shift(0, space.top - next.top);
    }

    return next.connect(prev) ? Builder.angleBetweenRooms(prev, next) : -1;
  }
}

const A = 180 / Math.PI;

/** GameMath.gate. */
export const gate = (min: number, value: number, max: number): number => (value < min ? min : value > max ? max : value);
