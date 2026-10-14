import { T } from '../../../terrain';
import type { GenLevel } from '../../genlevel';
import { Painter } from '../../painter';
import { Random } from '../../random';
import { Point, Rect } from '../../rect';
import { DoorType, type Room } from '../../room';
import { StandardRoom } from './standard';

/*
 * levels/rooms/standard/StandardBridgeRoom and its kinds: WaterBridgeRoom, ChasmBridgeRoom and
 * RegionDecoBridgeRoom.
 */

/**
 * StandardBridgeRoom: a band of water, chasm or the like across the room, cutting off the most
 * doors (or the most floor), with a bridge over it.
 */
export abstract class StandardBridgeRoom extends StandardRoom {
  /** The band (a Rect: its right and bottom edges are outside it), and the bridge over it. */
  protected spaceRect: Rect | null = null;
  protected bridgeRect: Rect | null = null;

  override minWidth(): number {
    return Math.max(5, super.minWidth());
  }
  override minHeight(): number {
    return Math.max(5, super.minHeight());
  }

  override canMerge(l: GenLevel, _other: Room, p: Point, _mergeTerrain: number): boolean {
    return l.map[l.pointToCell(this.pointInside(p, 1))] !== this.spaceTile();
  }
  override canPlaceItem(p: Point, l: GenLevel): boolean {
    return super.canPlaceItem(p, l) && (this.spaceRect === null || !this.spaceRect.insideRect(p));
  }
  override canPlaceCharacter(p: Point, l: GenLevel): boolean {
    return super.canPlaceCharacter(p, l) && (this.spaceRect === null || !this.spaceRect.insideRect(p));
  }

  paint(level: GenLevel): void {
    Painter.fill(level, this, T.WALL);
    Painter.fill(level, this, 1, T.EMPTY);

    // The band goes where it splits the most doors, or else the most room.
    let doorsXY = 0;
    for (const door of this.doors()) {
      door.set(DoorType.REGULAR);
      if (door.x === this.left || door.x === this.right) doorsXY++;
      else doorsXY--;
    }
    doorsXY += Math.trunc((this.width() - this.height()) / 2);

    let spaceRect: Rect;
    let bridgeRect: Rect;
    if (doorsXY > 0 || (doorsXY === 0 && Random.Int(2) === 0)) {
      const spacePoints: Point[] = [];
      for (const door of this.doors()) if (door.y === this.top || door.y === this.bottom) spacePoints.push(door);
      // Fake doors at the very left and right.
      spacePoints.push(new Point(this.left + 1, 0));
      spacePoints.push(new Point(this.right - 1, 0));
      spacePoints.sort((d1, d2) => d1.x - d2.x);

      let spaceStart = -1;
      let spaceEnd = -1;
      for (let i = 0; i < spacePoints.length - 1; i++) {
        if (spaceEnd - spaceStart < spacePoints[i + 1]!.x - spacePoints[i]!.x) {
          spaceStart = spacePoints[i]!.x;
          spaceEnd = spacePoints[i + 1]!.x;
        }
      }
      while (spaceEnd - spaceStart > this.maxBridgeWidth(this.width()) + 1) {
        if (Random.Int(2) === 0) spaceStart++;
        else spaceEnd--;
      }
      spaceRect = new Rect(spaceStart + 1, this.top + 1, spaceEnd, this.bottom);
      const bridgeY = Random.NormalIntRange(spaceRect.top + 1, spaceRect.bottom - 2);
      bridgeRect = new Rect(spaceRect.left, bridgeY, spaceRect.right, bridgeY + 1);
    } else {
      const spacePoints: Point[] = [];
      for (const door of this.doors()) if (door.x === this.left || door.x === this.right) spacePoints.push(door);
      // Fake doors at the very top and bottom.
      spacePoints.push(new Point(0, this.top + 1));
      spacePoints.push(new Point(0, this.bottom - 1));
      spacePoints.sort((d1, d2) => d1.y - d2.y);

      let spaceStart = -1;
      let spaceEnd = -1;
      for (let i = 0; i < spacePoints.length - 1; i++) {
        if (spaceEnd - spaceStart < spacePoints[i + 1]!.y - spacePoints[i]!.y) {
          spaceStart = spacePoints[i]!.y;
          spaceEnd = spacePoints[i + 1]!.y;
        }
      }
      while (spaceEnd - spaceStart > this.maxBridgeWidth(this.height()) + 1) {
        if (Random.Int(2) === 0) spaceStart++;
        else spaceEnd--;
      }
      spaceRect = new Rect(this.left + 1, spaceStart + 1, this.right, spaceEnd);
      const bridgeX = Random.NormalIntRange(spaceRect.left + 1, spaceRect.right - 2);
      bridgeRect = new Rect(bridgeX, spaceRect.top, bridgeX + 1, spaceRect.bottom);
    }
    this.spaceRect = spaceRect;
    this.bridgeRect = bridgeRect;

    Painter.fill(level, spaceRect, this.spaceTile());
    Painter.fill(level, bridgeRect, this.bridgeTile());
  }

  protected abstract maxBridgeWidth(roomDimension: number): number;
  protected abstract spaceTile(): number;

  protected bridgeTile(): number {
    return T.EMPTY_SP;
  }
}

/** WaterBridgeRoom: a stream across the room. */
export class WaterBridgeRoom extends StandardBridgeRoom {
  readonly kind: string = 'WaterBridgeRoom';

  protected maxBridgeWidth(roomDimension: number): number {
    return roomDimension >= 8 ? 3 : 2;
  }
  protected spaceTile(): number {
    return T.WATER;
  }
  override canPlaceWater(_p: Point): boolean {
    return false;
  }
}

/** ChasmBridgeRoom: a chasm across the room. */
export class ChasmBridgeRoom extends StandardBridgeRoom {
  readonly kind: string = 'ChasmBridgeRoom';

  protected maxBridgeWidth(roomDimension: number): number {
    return roomDimension >= 7 ? 2 : 1;
  }
  protected spaceTile(): number {
    return T.CHASM;
  }
}

/** RegionDecoBridgeRoom: a line of the region's decoration across the room, with a gap (it can be large: the line breaks the space up). */
export class RegionDecoBridgeRoom extends StandardBridgeRoom {
  readonly kind: string = 'RegionDecoBridgeRoom';

  override sizeCatProbs(): number[] {
    return [2, 1, 0];
  }
  protected maxBridgeWidth(_roomDimension: number): number {
    return 1;
  }
  protected spaceTile(): number {
    return T.REGION_DECO_ALT;
  }
  protected override bridgeTile(): number {
    return T.EMPTY_SP;
  }
}
