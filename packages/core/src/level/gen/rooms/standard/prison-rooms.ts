import { T } from '../../../terrain';
import type { GenLevel } from '../../genlevel';
import { Painter } from '../../painter';
import { Random } from '../../random';
import { Point, Rect } from '../../rect';
import { DoorType } from '../../room';
import { EmptyRoom } from './basic';
import { f32, jround } from './helpers';
import { StandardRoom } from './standard';

/*
 * levels/rooms/standard/SegmentedRoom, PillarsRoom, CellBlockRoom, StatueLineRoom and
 * RegionDecoLineRoom, the prison's own rooms.
 */

/** SegmentedRoom: split by walls into smaller rooms, each wall with a two-cell gap. */
export class SegmentedRoom extends StandardRoom {
  readonly kind: string = 'SegmentedRoom';

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
    for (const door of this.doors()) {
      door.set(DoorType.REGULAR);
      // Doorways count as open for where walls may go.
      Painter.set(level, door, T.EMPTY);
    }
    this.createWalls(level, new Rect(this.left + 1, this.top + 1, this.right - 1, this.bottom - 1));
  }

  private createWalls(level: GenLevel, area: Rect): void {
    if (Math.max(area.width() + 1, area.height() + 1) < 5 || Math.min(area.width() + 1, area.height() + 1) < 3) return;
    let tries = 10;
    if (area.width() > area.height() || (area.width() === area.height() && Random.Int(2) === 0)) {
      // Splitting into left and right.
      do {
        const splitX = Random.IntRange(area.left + 2, area.right - 2);
        if (level.map[splitX + level.width * (area.top - 1)] === T.WALL && level.map[splitX + level.width * (area.bottom + 1)] === T.WALL) {
          tries = 0;
          Painter.drawLine(level, new Point(splitX, area.top), new Point(splitX, area.bottom), T.WALL);
          const spaceTop = Random.IntRange(area.top, area.bottom - 1);
          Painter.set(level, splitX, spaceTop, T.EMPTY);
          Painter.set(level, splitX, spaceTop + 1, T.EMPTY);
          this.createWalls(level, new Rect(area.left, area.top, splitX - 1, area.bottom));
          this.createWalls(level, new Rect(splitX + 1, area.top, area.right, area.bottom));
        }
      } while (--tries > 0);
    } else {
      // Splitting into top and bottom.
      do {
        const splitY = Random.IntRange(area.top + 2, area.bottom - 2);
        if (level.map[area.left - 1 + level.width * splitY] === T.WALL && level.map[area.right + 1 + level.width * splitY] === T.WALL) {
          tries = 0;
          Painter.drawLine(level, new Point(area.left, splitY), new Point(area.right, splitY), T.WALL);
          const spaceLeft = Random.IntRange(area.left, area.right - 1);
          Painter.set(level, spaceLeft, splitY, T.EMPTY);
          Painter.set(level, spaceLeft + 1, splitY, T.EMPTY);
          this.createWalls(level, new Rect(area.left, area.top, area.right, splitY - 1));
          this.createWalls(level, new Rect(area.left, splitY + 1, area.right, area.bottom));
        }
      } while (--tries > 0);
    }
  }
}

/** PillarsRoom: two pillars at opposite corners, or four skewed round the middle. */
export class PillarsRoom extends StandardRoom {
  readonly kind: string = 'PillarsRoom';

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
    for (const door of this.doors()) door.set(DoorType.REGULAR);

    const minDim = Math.min(this.width(), this.height());

    if (minDim === 7 || (this.sizeCat.name === 'NORMAL' && Random.Int(2) === 0)) {
      // Two pillars.
      const pillarInset = minDim >= 11 ? 2 : 1;
      const pillarSize = Math.trunc((minDim - 3) / 2) - pillarInset;
      let pillarX: number;
      let pillarY: number;
      if (Random.Int(2) === 0) {
        pillarX = Random.IntRange(this.left + 1 + pillarInset, this.right - pillarSize - pillarInset);
        pillarY = this.top + 1 + pillarInset;
      } else {
        pillarX = this.left + 1 + pillarInset;
        pillarY = Random.IntRange(this.top + 1 + pillarInset, this.bottom - pillarSize - pillarInset);
      }
      Painter.fill(level, pillarX, pillarY, pillarSize, pillarSize, T.WALL);
      // The second, mirrored.
      pillarX = this.right - (pillarX - this.left + pillarSize - 1);
      pillarY = this.bottom - (pillarY - this.top + pillarSize - 1);
      Painter.fill(level, pillarX, pillarY, pillarSize, pillarSize, T.WALL);
    } else {
      // Four pillars.
      const pillarInset = minDim >= 12 ? 2 : 1;
      const pillarSize = Math.trunc((minDim - 6) / (pillarInset + 1));
      const xSpaces = this.width() - 2 * pillarInset - pillarSize - 2;
      const ySpaces = this.height() - 2 * pillarInset - pillarSize - 2;
      const minSpaces = Math.min(xSpaces, ySpaces);
      const percentSkew = f32(jround(f32(Random.Float() * minSpaces)) / minSpaces);
      const skewX = jround(f32(percentSkew * xSpaces));
      const skewY = jround(f32(percentSkew * ySpaces));
      // Top-left, skewed right.
      Painter.fill(level, this.left + 1 + pillarInset + skewX, this.top + 1 + pillarInset, pillarSize, pillarSize, T.WALL);
      // Top-right, skewed down.
      Painter.fill(level, this.right - pillarSize - pillarInset, this.top + 1 + pillarInset + skewY, pillarSize, pillarSize, T.WALL);
      // Bottom-right, skewed left.
      Painter.fill(level, this.right - pillarSize - pillarInset - skewX, this.bottom - pillarSize - pillarInset, pillarSize, pillarSize, T.WALL);
      // Bottom-left, skewed up.
      Painter.fill(level, this.left + 1 + pillarInset, this.bottom - pillarSize - pillarInset - skewY, pillarSize, pillarSize, T.WALL);
    }
  }
}

/** CellBlockRoom: a corridor round a block of cells, each on special floor behind a door; a few are full of the region's decoration. */
export class CellBlockRoom extends StandardRoom {
  readonly kind: string = 'CellBlockRoom';

  override sizeCatProbs(): number[] {
    return [0, 3, 1];
  }

  paint(level: GenLevel): void {
    Painter.fill(level, this, T.WALL);
    Painter.fill(level, this, 1, T.EMPTY);
    Painter.fill(level, this, 3, T.WALL);

    // A Room (and a draw for its size, as `new EmptyRoom()` rolls one), so its width() takes in its edges.
    const internal = new EmptyRoom();
    internal.set(this.left + 3, this.top + 3, this.right - 3, this.bottom - 3);

    let rows = Math.trunc((internal.width() - 1) / 3);
    let cols = Math.trunc((internal.height() - 1) / 3);
    if (internal.height() === 11) cols--;
    if (internal.width() === 11) rows--;

    const w = Math.trunc((internal.width() - 2 - (rows - 1)) / rows);
    const h = Math.trunc((internal.height() - 2 - (cols - 1)) / cols);
    const wSpacing = rows * w + (rows + 1) === internal.width() ? 1 : 2;
    const hSpacing = cols * h + (cols + 1) === internal.height() ? 1 : 2;

    let topBottomDoors: boolean | null = rows > cols || (rows === cols && Random.Int(2) === 0);
    if (rows === 1 || cols === 1) topBottomDoors = !topBottomDoors;
    if (rows === 1 && cols === 1) topBottomDoors = null;

    let openRooms = rows * cols;
    if (openRooms === 9) openRooms--;
    // An entrance or exit needs at least one cell open.
    const guaranteeOpenRoom = this.isEntrance() || this.isExit();

    for (let x = 0; x < rows; x++) {
      for (let y = 0; y < cols; y++) {
        // No cell in the middle.
        if (rows === 3 && cols === 3 && x === 1 && y === 1) continue;
        const left = internal.left + 1 + x * (w + wSpacing);
        const top = internal.top + 1 + y * (h + hSpacing);

        if (Random.Int(w * h) === 0 && (!guaranteeOpenRoom || openRooms > 1)) {
          Painter.fill(level, left, top, w, h, T.REGION_DECO);
          openRooms--;
        } else {
          Painter.fill(level, left, top, w, h, T.EMPTY_SP);
        }

        if (topBottomDoors === null) {
          switch (Random.Int(4)) {
            case 0:
              Painter.set(level, internal.left, internal.top + Math.trunc(internal.height() / 2), T.DOOR);
              break;
            case 1:
              Painter.set(level, internal.left + Math.trunc(internal.width() / 2), internal.top, T.DOOR);
              break;
            case 2:
              Painter.set(level, internal.right, internal.top + Math.trunc(internal.height() / 2), T.DOOR);
              break;
            case 3:
              Painter.set(level, internal.left + Math.trunc(internal.width() / 2), internal.bottom, T.DOOR);
              break;
          }
        } else if (topBottomDoors) {
          if (y === 0) Painter.set(level, left + Math.trunc(w / 2), top - 1, T.DOOR);
          else if (y === cols - 1) Painter.set(level, left + Math.trunc(w / 2) - 1, top + h, T.DOOR);
          else if (x === 0) Painter.set(level, left - 1, top + Math.trunc(h / 2) - 1, T.DOOR);
          else if (x === rows - 1) Painter.set(level, left + w, top + Math.trunc(h / 2), T.DOOR);
        } else {
          if (x === 0) Painter.set(level, left - 1, top + Math.trunc(h / 2) - 1, T.DOOR);
          else if (x === rows - 1) Painter.set(level, left + w, top + Math.trunc(h / 2), T.DOOR);
          else if (y === 0) Painter.set(level, left + Math.trunc(w / 2), top - 1, T.DOOR);
          else if (y === cols - 1) Painter.set(level, left + Math.trunc(w / 2) - 1, top + h, T.DOOR);
        }
      }
    }

    for (const door of this.doors()) door.set(DoorType.REGULAR);
  }
}

const N = 0;
const E = 1;
const S = 2;
const W = 3;

/** StatueLineRoom: a line of statues along the wall with the fewest doors. */
export class StatueLineRoom extends StandardRoom {
  readonly kind: string = 'StatueLineRoom';

  override minWidth(): number {
    return Math.max(5, super.minWidth());
  }
  override minHeight(): number {
    return Math.max(5, super.minHeight());
  }

  paint(level: GenLevel): void {
    Painter.fill(level, this, T.WALL);
    Painter.fill(level, this, 1, T.EMPTY);

    // Along a wall without doors if there is one; else with fewer (doors by a corner count half).
    const sidePreferences: [number, number, number, number] = [1, 1, 1, 1];
    for (const door of this.doors()) {
      door.set(DoorType.REGULAR);
      if (door.y === this.top) sidePreferences[N] -= 2;
      if (door.y === this.top + 1) sidePreferences[N] -= 1;
      if (door.y === this.bottom) sidePreferences[S] -= 2;
      if (door.y === this.bottom - 1) sidePreferences[S] -= 1;
      if (door.x === this.left) sidePreferences[W] -= 2;
      if (door.x === this.left + 1) sidePreferences[W] -= 1;
      if (door.x === this.right) sidePreferences[E] -= 2;
      if (door.x === this.right - 1) sidePreferences[E] -= 1;
    }
    let chosenSide = Random.chances(sidePreferences);
    while (chosenSide === -1) {
      sidePreferences[N]++;
      sidePreferences[E]++;
      sidePreferences[S]++;
      sidePreferences[W]++;
      chosenSide = Random.chances(sidePreferences);
    }

    this.fillAlongSide(chosenSide, level);

    for (const door of this.doors()) {
      door.set(DoorType.REGULAR);
      Painter.drawInside(level, this, door, 1, T.EMPTY);
    }
  }

  protected decoTerrain(): number {
    return T.STATUE;
  }

  private fillAlongSide(side: number, level: GenLevel): void {
    const { left, top, right, bottom } = this;
    switch (side) {
      case N:
        Painter.drawLine(level, new Point(left + 1, top + 1), new Point(right - 1, top + 1), this.decoTerrain());
        break;
      case E:
        Painter.drawLine(level, new Point(right - 1, top + 1), new Point(right - 1, bottom - 1), this.decoTerrain());
        break;
      case S:
        Painter.drawLine(level, new Point(left + 1, bottom - 1), new Point(right - 1, bottom - 1), this.decoTerrain());
        break;
      case W:
        Painter.drawLine(level, new Point(left + 1, top + 1), new Point(left + 1, bottom - 1), this.decoTerrain());
        break;
    }
  }
}

/** RegionDecoLineRoom: a line of the region's decoration instead. */
export class RegionDecoLineRoom extends StatueLineRoom {
  override readonly kind: string = 'RegionDecoLineRoom';

  protected override decoTerrain(): number {
    return T.REGION_DECO;
  }
}
