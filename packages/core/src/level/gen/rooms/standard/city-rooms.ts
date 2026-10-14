import { T } from '../../../terrain';
import { gate } from '../../builders/builder';
import { Carpet } from '../../custom';
import type { GenLevel } from '../../genlevel';
import { Painter } from '../../painter';
import { Random } from '../../random';
import { Point, Rect } from '../../rect';
import { DoorType, type Room } from '../../room';
import { f32 } from './helpers';
import { StandardRoom } from './standard';

/*
 * levels/rooms/standard/HallwayRoom, LibraryHallRoom, LibraryRingRoom, StatuesRoom and
 * SegmentedLibraryRoom, the dwarven city's own rooms. The carpets are tiles/custom/Carpet.
 */

/** HallwayRoom: special-floor paths from every door to a carpeted 3x3 square with a statue or a pedestal in the middle. */
export class HallwayRoom extends StandardRoom {
  readonly kind: string = 'HallwayRoom';

  override minWidth(): number {
    return Math.max(5, super.minWidth());
  }
  override minHeight(): number {
    return Math.max(5, super.minHeight());
  }
  /** Only with another hallway. */
  override canMerge(l: GenLevel, other: Room, p: Point, mergeTerrain: number): boolean {
    return other instanceof HallwayRoom && super.canMerge(l, other, p, mergeTerrain);
  }
  override merge(l: GenLevel, other: Room, merge: Rect, mergeTerrain: number): void {
    super.merge(l, other, merge, mergeTerrain);
    const door = this.connected.get(other);
    if (door) Painter.set(l, door, T.EMPTY_SP);
  }

  paint(level: GenLevel): void {
    Painter.fill(level, this, T.WALL);
    Painter.fill(level, this, 1, T.EMPTY);

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
      Painter.drawLine(level, start, mid, T.EMPTY_SP);
      Painter.drawLine(level, mid, end, T.EMPTY_SP);
    }

    Painter.fill(level, c.left, c.top, 3, 3, T.EMPTY_SP);

    const carpet = new Carpet();
    carpet.setRect(c.left, c.top, 3, 3);
    if (this.isEntrance()) {
      Painter.fill(level, c.left + 1, c.top + 1, 1, 1, T.ENTRANCE_SP);
      carpet.overrideTile(1, 1, Carpet.CITY_ENTRANCE);
    } else if (this.isExit()) {
      Painter.fill(level, c.left + 1, c.top + 1, 1, 1, T.EXIT);
      carpet.overrideTile(1, 1, Carpet.SKIP);
    } else if (Random.Int(2) === 0) {
      Painter.fill(level, c.left + 1, c.top + 1, 1, 1, T.STATUE_SP);
      carpet.overrideTile(1, 1, Carpet.CITY_STATUE);
    } else {
      Painter.fill(level, c.left + 1, c.top + 1, 1, 1, T.REGION_DECO_ALT);
      carpet.overrideTile(1, 1, Carpet.CITY_PEDESTAL);
    }
    level.customTiles.push(carpet.toCustomTile());

    for (const door of this.doors()) door.set(DoorType.REGULAR);
  }

  /** The 3x3 square every path leads to (inclusive of its right and bottom sides). */
  protected getConnectionSpace(): Rect {
    const c = this.center();
    c.x = gate(this.left + 2, c.x, this.right - 2);
    c.y = gate(this.top + 2, c.y, this.bottom - 2);
    return new Rect(c.x - 1, c.y - 1, c.x + 1, c.y + 1);
  }
}

/** LibraryHallRoom: rows of bookshelves along the room, the region's decoration (pedestals) between. */
export class LibraryHallRoom extends StandardRoom {
  readonly kind: string = 'LibraryHallRoom';

  override minWidth(): number {
    return Math.max(7, super.minWidth());
  }
  override minHeight(): number {
    return Math.max(7, super.minHeight());
  }
  override sizeCatProbs(): number[] {
    return [2, 1, 0];
  }

  paint(level: GenLevel): void {
    Painter.fill(level, this, T.WALL);
    Painter.fill(level, this, 1, T.EMPTY);
    const { left, top, right, bottom } = this;
    const width = this.width();
    const height = this.height();

    // Which way the shelves run: mostly by the longer side; an odd side over an even one; then the doors.
    let topBottomBooks = 0;
    let leftRightBooks = 0;
    if (width > height) topBottomBooks += width - height;
    else if (height > width) leftRightBooks += height - width;
    if (width % 2 === 0 && height % 2 !== 0) topBottomBooks += 2;
    else if (width % 2 !== 0 && height % 2 === 0) leftRightBooks += 2;
    for (const door of this.doors()) {
      if (door.x === left || door.x === right) topBottomBooks = f32(topBottomBooks + f32(0.1));
      else leftRightBooks = f32(leftRightBooks + f32(0.1));
    }

    const layingOutLeftToRight = topBottomBooks > leftRightBooks || (topBottomBooks === leftRightBooks && Random.Int(2) === 0);
    const majorDim = layingOutLeftToRight ? height : width;
    const minorDim = layingOutLeftToRight ? width : height;

    // Small or big rooms get shelves along the edges.
    if (majorDim >= 11 || majorDim < 9) {
      if (layingOutLeftToRight) {
        Painter.drawLine(level, new Point(left + 1, top + 1), new Point(right - 1, top + 1), T.BOOKSHELF);
        Painter.drawLine(level, new Point(left + 1, bottom - 1), new Point(right - 1, bottom - 1), T.BOOKSHELF);
      } else {
        Painter.drawLine(level, new Point(left + 1, top + 1), new Point(left + 1, bottom - 1), T.BOOKSHELF);
        Painter.drawLine(level, new Point(right - 1, top + 1), new Point(right - 1, bottom - 1), T.BOOKSHELF);
      }
    }

    const center = this.center();

    // Big ones get rows inset as well.
    let lengthInset = 2;
    if (majorDim >= 9) {
      if (minorDim >= 13) lengthInset++;
      if (layingOutLeftToRight) {
        Painter.drawLine(level, new Point(left + lengthInset, center.y - 2), new Point(right - lengthInset, center.y - 2), T.BOOKSHELF);
        Painter.drawLine(level, new Point(left + lengthInset, center.y + 2), new Point(right - lengthInset, center.y + 2), T.BOOKSHELF);
      } else {
        Painter.drawLine(level, new Point(center.x - 2, top + lengthInset), new Point(center.x - 2, bottom - lengthInset), T.BOOKSHELF);
        Painter.drawLine(level, new Point(center.x + 2, top + lengthInset), new Point(center.x + 2, bottom - lengthInset), T.BOOKSHELF);
      }
    }

    if (minorDim % 2 === 1 && minorDim < 9) {
      Painter.set(level, center, T.REGION_DECO);
    } else {
      let pedestalInset = 2;
      if (minorDim >= 10) {
        pedestalInset++;
        if (minorDim >= 13) pedestalInset++;
      }
      if (layingOutLeftToRight) {
        Painter.set(level, left + pedestalInset, center.y, T.REGION_DECO);
        Painter.set(level, right - pedestalInset, center.y, T.REGION_DECO);
      } else {
        Painter.set(level, center.x, top + pedestalInset, T.REGION_DECO);
        Painter.set(level, center.x, bottom - pedestalInset, T.REGION_DECO);
      }
    }

    // The doors stay reachable.
    for (const door of this.doors()) {
      Painter.drawInside(level, this, door, 1, T.EMPTY);
      door.set(DoorType.REGULAR);
    }
  }
}

/** LibraryRingRoom: a walkway between shelves on the walls and a block of shelves in the middle (crossed in giant rooms). */
export class LibraryRingRoom extends StandardRoom {
  readonly kind: string = 'LibraryRingRoom';

  override minWidth(): number {
    return Math.max(super.minWidth(), 9);
  }
  override minHeight(): number {
    return Math.max(super.minHeight(), 9);
  }
  override sizeCatProbs(): number[] {
    return [4, 2, 1];
  }
  /** Never an odd size when giant. */
  override resize(w: number, h: number): this {
    super.resize(w, h);
    if (this.sizeCat.name === 'GIANT') {
      if (this.width() % 2 === 1) this.right--;
      if (this.height() % 2 === 1) this.bottom--;
    }
    return this;
  }

  paint(level: GenLevel): void {
    Painter.fill(level, this, T.WALL);
    Painter.fill(level, this, 1, T.BOOKSHELF);
    Painter.fill(level, this, 2, T.EMPTY);
    Painter.fill(level, this, 4, T.BOOKSHELF);

    if (this.sizeCat.name === 'GIANT') {
      // Always rounded down.
      const c = new Point(Math.trunc((this.left + this.right) / 2), Math.trunc((this.top + this.bottom) / 2));
      Painter.fill(level, c.x - 4, c.y, 10, 2, T.EMPTY);
      Painter.fill(level, c.x, c.y - 4, 2, 10, T.EMPTY);
    }

    for (const door of this.doors()) {
      door.set(DoorType.REGULAR);
      Painter.drawInside(level, this, door, 2, T.EMPTY);
    }
  }
}

/** StatuesRoom: carpeted squares with a statue at each corner, a flaming pedestal (the region's decoration) in the bigger ones. */
export class StatuesRoom extends StandardRoom {
  readonly kind: string = 'StatuesRoom';

  override minWidth(): number {
    return Math.max(7, super.minWidth());
  }
  override minHeight(): number {
    return Math.max(7, super.minHeight());
  }
  override sizeCatProbs(): number[] {
    return [9, 3, 1];
  }

  paint(level: GenLevel): void {
    Painter.fill(level, this, T.WALL);
    Painter.fill(level, this, 1, T.EMPTY);
    for (const door of this.doors()) door.set(DoorType.REGULAR);

    const rows = Math.trunc((this.width() + 1) / 6);
    const cols = Math.trunc((this.height() + 1) / 6);
    const w = Math.trunc((this.width() - 4 - (rows - 1)) / rows);
    const h = Math.trunc((this.height() - 4 - (cols - 1)) / cols);
    const wSpacing = rows % 2 === this.width() % 2 ? 2 : 1;
    const hSpacing = cols % 2 === this.height() % 2 ? 2 : 1;

    for (let x = 0; x < rows; x++) {
      for (let y = 0; y < cols; y++) {
        const left = this.left + 2 + x * (w + wSpacing);
        const top = this.top + 2 + y * (h + hSpacing);

        Painter.fill(level, left, top, w, h, T.CUSTOM_DECO_EMPTY);
        Painter.set(level, left, top, T.STATUE);
        Painter.set(level, left + w - 1, top, T.STATUE);
        Painter.set(level, left, top + h - 1, T.STATUE);
        Painter.set(level, left + w - 1, top + h - 1, T.STATUE);

        const carpet = new Carpet();
        carpet.setRect(left, top, w, h);
        carpet.overrideTile(0, 0, Carpet.CITY_STATUE_TL);
        carpet.overrideTile(carpet.tileW - 1, 0, Carpet.CITY_STATUE_TR);
        carpet.overrideTile(0, carpet.tileH - 1, Carpet.CITY_STATUE_BL);
        carpet.overrideTile(carpet.tileW - 1, carpet.tileH - 1, Carpet.CITY_STATUE_BR);

        // A pedestal (or the way in or out) in the middle.
        const single = rows === 1 && cols === 1;
        if ((w >= 5 && h >= 5) || ((this.isEntrance() || this.isExit()) && single)) {
          let cx = left + Math.trunc(w / 2);
          if (w % 2 === 0 && Random.Int(2) === 0) cx--;
          let cy = top + Math.trunc(h / 2);
          if (h % 2 === 0 && Random.Int(2) === 0) cy--;
          if (this.isEntrance() && single) {
            Painter.set(level, cx, cy, T.ENTRANCE);
            carpet.overrideLevelTile(cx, cy, Carpet.CITY_ENTRANCE);
          } else if (this.isExit() && single) {
            Painter.set(level, cx, cy, T.EXIT);
            carpet.overrideLevelTile(cx, cy, Carpet.SKIP);
          } else {
            Painter.set(level, cx, cy, T.REGION_DECO);
            carpet.overrideLevelTile(cx, cy, Carpet.CITY_PEDESTAL);
          }
        }
        level.customTiles.push(carpet.toCustomTile());
      }
    }
  }
}

/** SegmentedLibraryRoom: shelves on the walls, the special floor inside split by more shelves into carpeted nooks. */
export class SegmentedLibraryRoom extends StandardRoom {
  readonly kind: string = 'SegmentedLibraryRoom';

  override sizeCatProbs(): number[] {
    return [0, 3, 1];
  }

  paint(level: GenLevel): void {
    Painter.fill(level, this, T.WALL);
    Painter.fill(level, this, 1, T.BOOKSHELF);
    Painter.fill(level, this, 2, T.EMPTY_SP);
    for (const door of this.doors()) {
      door.set(DoorType.REGULAR);
      // Doorways count as open for where shelves may go.
      Painter.drawInside(level, this, door, 2, T.EMPTY_SP);
    }
    this.createWalls(level, new Rect(this.left + 2, this.top + 2, this.right - 2, this.bottom - 2));
    // (The original then looks for more open rectangles to carpet, but lays none of them.)
  }

  private createWalls(level: GenLevel, area: Rect): void {
    if (Math.max(area.width() + 1, area.height() + 1) >= 4 && Math.min(area.width() + 1, area.height() + 1) >= 3) {
      let tries = 10;
      if (area.width() > area.height() || (area.width() === area.height() && Random.Int(2) === 0)) {
        // Splitting into left and right.
        do {
          const splitX = Random.IntRange(area.left + 2, area.right - 2);
          if (level.map[splitX + level.width * (area.top - 1)] === T.BOOKSHELF && level.map[splitX + level.width * (area.bottom + 1)] === T.BOOKSHELF) {
            Painter.drawLine(level, new Point(splitX, area.top), new Point(splitX, area.bottom), T.BOOKSHELF);
            const spaceTop = Random.IntRange(area.top, area.bottom - 1);
            Painter.set(level, splitX, spaceTop, T.EMPTY_SP);
            this.createWalls(level, new Rect(area.left, area.top, splitX - 1, area.bottom));
            this.createWalls(level, new Rect(splitX + 1, area.top, area.right, area.bottom));
            return;
          }
        } while (--tries > 0);
      } else {
        // Splitting into top and bottom.
        do {
          const splitY = Random.IntRange(area.top + 2, area.bottom - 2);
          if (level.map[area.left - 1 + level.width * splitY] === T.BOOKSHELF && level.map[area.right + 1 + level.width * splitY] === T.BOOKSHELF) {
            Painter.drawLine(level, new Point(area.left, splitY), new Point(area.right, splitY), T.BOOKSHELF);
            const spaceLeft = Random.IntRange(area.left, area.right - 1);
            Painter.set(level, spaceLeft, splitY, T.EMPTY_SP);
            this.createWalls(level, new Rect(area.left, area.top, area.right, splitY - 1));
            this.createWalls(level, new Rect(area.left, splitY + 1, area.right, area.bottom));
            return;
          }
        } while (--tries > 0);
      }
    }
    // A carpet where the area was not split.
    if (area.width() + 1 >= 2 && area.height() + 1 >= 2) {
      const carpet = new Carpet();
      carpet.setRect(area.left, area.top, area.width() + 1, area.height() + 1);
      level.customTiles.push(carpet.toCustomTile());
    }
  }
}
