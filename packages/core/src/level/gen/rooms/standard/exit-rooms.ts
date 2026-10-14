import { T } from '../../../terrain';
import { Carpet } from '../../custom';
import type { GenLevel } from '../../genlevel';
import type { Point } from '../../rect';
import { ChasmBridgeRoom, RegionDecoBridgeRoom, WaterBridgeRoom } from './bridge-rooms';
import { CavesFissureRoom, CircleWallRoom } from './caves-rooms';
import { HallwayRoom, LibraryHallRoom, LibraryRingRoom, StatuesRoom } from './city-rooms';
import {
  cellBlockSpot, circleWallCenter, decoBridgeSpot, fissureSpot, libraryRingCenter, pedestalSpot, statuesCenter,
} from './entrance-rooms';
import { clearAround, crampedCell, notOnExit, regularExit } from './helpers';
import { CaveRoom, ChasmRoom, CircleBasinRoom, RegionDecoPatchRoom, RitualRoom, RuinsRoom } from './patch-rooms';
import { CellBlockRoom, PillarsRoom, StatueLineRoom } from './prison-rooms';
import { RingRoom } from './sewer-rooms';

/*
 * levels/rooms/standard/exit: the rooms with the way down, each a kind of standard room with the
 * stairs worked in as its entrance room has them. Nobody is placed on the stairs.
 */

/** WaterBridgeExitRoom: the stairs on the dry side of a stream. */
export class WaterBridgeExitRoom extends WaterBridgeRoom {
  override readonly kind: string = 'WaterBridgeExitRoom';

  override minWidth(): number {
    return Math.max(7, super.minWidth());
  }
  override minHeight(): number {
    return Math.max(7, super.minHeight());
  }
  override isExit(): boolean {
    return true;
  }
  override paint(level: GenLevel): void {
    super.paint(level);
    let exit: number;
    do {
      exit = level.pointToCell(this.random(2));
    } while (this.spaceRect!.insideRect(level.cellToPoint(exit)) || level.findMob(exit));
    clearAround(level, exit);
    regularExit(level, exit, T.EXIT);
  }
  override canPlaceCharacter(p: Point, l: GenLevel): boolean {
    return super.canPlaceCharacter(p, l) && notOnExit(p, l);
  }
}

/** RegionDecoPatchExitRoom: the stairs among patches of the region's decoration. */
export class RegionDecoPatchExitRoom extends RegionDecoPatchRoom {
  override readonly kind: string = 'RegionDecoPatchExitRoom';

  override minHeight(): number {
    return Math.max(7, super.minHeight());
  }
  override minWidth(): number {
    return Math.max(7, super.minWidth());
  }
  override isExit(): boolean {
    return true;
  }
  override paint(level: GenLevel): void {
    super.paint(level);
    const exit = crampedCell(level, this, (t) => t === T.REGION_DECO, (t) => t !== T.REGION_DECO);
    regularExit(level, exit, T.EXIT);
    clearAround(level, exit);
  }
  override canPlaceCharacter(p: Point, l: GenLevel): boolean {
    return super.canPlaceCharacter(p, l) && notOnExit(p, l);
  }
}

/** RingExitRoom: the stairs on special floor in the hollow middle of a ring. */
export class RingExitRoom extends RingRoom {
  override readonly kind: string = 'RingExitRoom';

  override sizeCatProbs(): number[] {
    return [0, 1, 0];
  }
  override isExit(): boolean {
    return true;
  }
  protected override centerDecoTiles(): number {
    return T.EMPTY_SP;
  }
  protected override placeCenterDetail(level: GenLevel, pos: number): void {
    regularExit(level, pos, T.EXIT);
  }
  override canPlaceCharacter(p: Point, l: GenLevel): boolean {
    return super.canPlaceCharacter(p, l) && notOnExit(p, l);
  }
}

/** CircleBasinExitRoom: the stairs where the bridges cross. */
export class CircleBasinExitRoom extends CircleBasinRoom {
  override readonly kind: string = 'CircleBasinExitRoom';

  override sizeCatProbs(): number[] {
    return [0, 1, 0];
  }
  override isExit(): boolean {
    return true;
  }
  override paint(level: GenLevel): void {
    super.paint(level);
    regularExit(level, level.pointToCell(this.center()), T.EXIT);
  }
  override canPlaceCharacter(p: Point, l: GenLevel): boolean {
    return super.canPlaceCharacter(p, l) && notOnExit(p, l);
  }
}

/** StatueLineExitRoom: the stairs in a room with a line of statues. */
export class StatueLineExitRoom extends StatueLineRoom {
  override readonly kind: string = 'StatueLineExitRoom';

  override minWidth(): number {
    return Math.max(7, super.minWidth());
  }
  override minHeight(): number {
    return Math.max(7, super.minHeight());
  }
  override isExit(): boolean {
    return true;
  }
  override paint(level: GenLevel): void {
    super.paint(level);
    let exit: number;
    do {
      exit = level.pointToCell(this.random(3));
    } while (level.findMob(exit));
    regularExit(level, exit, T.EXIT);
  }
  override canPlaceCharacter(p: Point, l: GenLevel): boolean {
    return super.canPlaceCharacter(p, l) && notOnExit(p, l);
  }
}

/** RegionDecoLineExitRoom: with a line of the region's decoration. */
export class RegionDecoLineExitRoom extends StatueLineExitRoom {
  override readonly kind: string = 'RegionDecoLineExitRoom';

  protected override decoTerrain(): number {
    return T.REGION_DECO;
  }
}

/** ChasmBridgeExitRoom: the stairs on one side of a chasm. */
export class ChasmBridgeExitRoom extends ChasmBridgeRoom {
  override readonly kind: string = 'ChasmBridgeExitRoom';

  override minWidth(): number {
    return Math.max(7, super.minWidth());
  }
  override minHeight(): number {
    return Math.max(7, super.minHeight());
  }
  override isExit(): boolean {
    return true;
  }
  override paint(level: GenLevel): void {
    super.paint(level);
    let exit: number;
    do {
      exit = level.pointToCell(this.random(2));
    } while (this.spaceRect!.insideRect(level.cellToPoint(exit)) || level.findMob(exit));
    clearAround(level, exit);
    regularExit(level, exit, T.EXIT);
  }
  override canPlaceCharacter(p: Point, l: GenLevel): boolean {
    return super.canPlaceCharacter(p, l) && notOnExit(p, l);
  }
}

/** PillarsExitRoom: the stairs among the pillars, never against one but from above. */
export class PillarsExitRoom extends PillarsRoom {
  override readonly kind: string = 'PillarsExitRoom';

  override sizeCatProbs(): number[] {
    return [3, 1, 0];
  }
  override isExit(): boolean {
    return true;
  }
  override paint(level: GenLevel): void {
    super.paint(level);
    let exit: number;
    let valid: boolean;
    do {
      exit = level.pointToCell(this.random(2));
      valid = true;
      for (const i of level.neighbours4) {
        if (i === -level.width) continue;
        if (level.map[exit + i] === T.WALL) valid = false;
      }
    } while (level.findMob(exit) || level.map[exit] === T.WALL || !valid);
    regularExit(level, exit, T.EXIT);
  }
  override canPlaceCharacter(p: Point, l: GenLevel): boolean {
    return super.canPlaceCharacter(p, l) && notOnExit(p, l);
  }
}

/** CellBlockExitRoom: the stairs in one of the open cells, away from its door. */
export class CellBlockExitRoom extends CellBlockRoom {
  override readonly kind: string = 'CellBlockExitRoom';

  override sizeCatProbs(): number[] {
    return [0, 1, 0];
  }
  override isExit(): boolean {
    return true;
  }
  override paint(level: GenLevel): void {
    super.paint(level);
    regularExit(level, cellBlockSpot(level, this), T.EXIT);
  }
  override canPlaceCharacter(p: Point, l: GenLevel): boolean {
    return super.canPlaceCharacter(p, l) && notOnExit(p, l);
  }
}

/** CaveExitRoom: the stairs in a cave. */
export class CaveExitRoom extends CaveRoom {
  override readonly kind: string = 'CaveExitRoom';

  override minHeight(): number {
    return Math.max(7, super.minHeight());
  }
  override minWidth(): number {
    return Math.max(7, super.minWidth());
  }
  override sizeCatProbs(): number[] {
    return [2, 1, 0];
  }
  override isExit(): boolean {
    return true;
  }
  override paint(level: GenLevel): void {
    super.paint(level);
    const exit = crampedCell(level, this, (t) => t === T.WALL, (t) => t !== T.WALL);
    regularExit(level, exit, T.EXIT);
    clearAround(level, exit);
  }
  override canPlaceCharacter(p: Point, l: GenLevel): boolean {
    return super.canPlaceCharacter(p, l) && notOnExit(p, l);
  }
}

/** RegionDecoBridgeExitRoom: the stairs on one side of a line of the region's decoration, not against it. */
export class RegionDecoBridgeExitRoom extends RegionDecoBridgeRoom {
  override readonly kind: string = 'RegionDecoBridgeExitRoom';

  override minWidth(): number {
    return Math.max(8, super.minWidth());
  }
  override minHeight(): number {
    return Math.max(8, super.minHeight());
  }
  override isExit(): boolean {
    return true;
  }
  override paint(level: GenLevel): void {
    super.paint(level);
    regularExit(level, decoBridgeSpot(level, this, this.spaceRect!), T.EXIT);
  }
  override canPlaceCharacter(p: Point, l: GenLevel): boolean {
    return super.canPlaceCharacter(p, l) && notOnExit(p, l);
  }
}

/** CavesFissureExitRoom: the stairs on solid ground between the fissures. */
export class CavesFissureExitRoom extends CavesFissureRoom {
  override readonly kind: string = 'CavesFissureExitRoom';

  override sizeCatProbs(): number[] {
    return [3, 1, 0];
  }
  override isExit(): boolean {
    return true;
  }
  override paint(level: GenLevel): void {
    super.paint(level);
    regularExit(level, fissureSpot(level, this), T.EXIT);
  }
  override canPlaceCharacter(p: Point, l: GenLevel): boolean {
    return super.canPlaceCharacter(p, l) && notOnExit(p, l);
  }
}

/** CircleWallExitRoom: the stairs inside the round wall, a passage cut through it. */
export class CircleWallExitRoom extends CircleWallRoom {
  override readonly kind: string = 'CircleWallExitRoom';

  override minWidth(): number {
    return Math.max(super.minWidth(), 11);
  }
  override minHeight(): number {
    return Math.max(super.minHeight(), 11);
  }
  override sizeCatProbs(): number[] {
    return [0, 1, 0];
  }
  override isExit(): boolean {
    return true;
  }
  override paint(level: GenLevel): void {
    super.paint(level);
    circleWallCenter(level, this, (cell) => regularExit(level, cell, T.EXIT));
  }
  override canPlaceCharacter(p: Point, l: GenLevel): boolean {
    return super.canPlaceCharacter(p, l) && notOnExit(p, l);
  }
}

/** HallwayExitRoom: the stairs in the carpeted square. */
export class HallwayExitRoom extends HallwayRoom {
  override readonly kind: string = 'HallwayExitRoom';

  override isExit(): boolean {
    return true;
  }
  override paint(level: GenLevel): void {
    super.paint(level);
    let exit = -1;
    for (const p of this.getPoints()) {
      if (level.map[level.pointToCell(p)] === T.EXIT) {
        exit = level.pointToCell(p);
        break;
      }
    }
    level.addTransition(exit, 'exit');
  }
  override canPlaceCharacter(p: Point, l: GenLevel): boolean {
    return super.canPlaceCharacter(p, l) && notOnExit(p, l);
  }
}

/** StatuesExitRoom: the stairs in the middle; in a bigger room, on a carpet of their own among the statues' squares. */
export class StatuesExitRoom extends StatuesRoom {
  override readonly kind: string = 'StatuesExitRoom';

  override sizeCatProbs(): number[] {
    return [3, 1, 0];
  }
  override isExit(): boolean {
    return true;
  }
  override paint(level: GenLevel): void {
    super.paint(level);
    regularExit(level, statuesCenter(level, this, T.EXIT, Carpet.SKIP), T.EXIT);
  }
  override canPlaceCharacter(p: Point, l: GenLevel): boolean {
    return super.canPlaceCharacter(p, l) && notOnExit(p, l);
  }
}

/** LibraryHallExitRoom: the stairs on one of the pedestals. */
export class LibraryHallExitRoom extends LibraryHallRoom {
  override readonly kind: string = 'LibraryHallExitRoom';

  override isExit(): boolean {
    return true;
  }
  override paint(level: GenLevel): void {
    super.paint(level);
    regularExit(level, pedestalSpot(level, this), T.EXIT);
  }
  override canPlaceCharacter(p: Point, l: GenLevel): boolean {
    return super.canPlaceCharacter(p, l) && notOnExit(p, l);
  }
}

/** LibraryRingExitRoom: the stairs on a carpet inside the ring of shelves, a way cut through them. */
export class LibraryRingExitRoom extends LibraryRingRoom {
  override readonly kind: string = 'LibraryRingExitRoom';

  override minWidth(): number {
    return Math.max(super.minWidth(), 13);
  }
  override minHeight(): number {
    return Math.max(super.minHeight(), 13);
  }
  override sizeCatProbs(): number[] {
    return [0, 1, 0];
  }
  override isExit(): boolean {
    return true;
  }
  override paint(level: GenLevel): void {
    super.paint(level);
    libraryRingCenter(level, this, (cell) => regularExit(level, cell, T.EXIT), Carpet.SKIP);
  }
  override canPlaceCharacter(p: Point, l: GenLevel): boolean {
    return super.canPlaceCharacter(p, l) && notOnExit(p, l);
  }
}

/** RuinsExitRoom: the stairs among the ruins. */
export class RuinsExitRoom extends RuinsRoom {
  override readonly kind: string = 'RuinsExitRoom';

  override minWidth(): number {
    return Math.max(super.minWidth(), 7);
  }
  override minHeight(): number {
    return Math.max(super.minHeight(), 7);
  }
  override isExit(): boolean {
    return true;
  }
  override sizeCatProbs(): number[] {
    return [2, 1, 0];
  }
  override paint(level: GenLevel): void {
    super.paint(level);
    const exit = crampedCell(level, this, (t) => t === T.WALL, (t) => t !== T.WALL && t !== T.REGION_DECO);
    regularExit(level, exit, T.EXIT);
    clearAround(level, exit);
  }
  override canPlaceCharacter(p: Point, l: GenLevel): boolean {
    return super.canPlaceCharacter(p, l) && notOnExit(p, l);
  }
}

/** ChasmExitRoom: the stairs between patches of chasm. */
export class ChasmExitRoom extends ChasmRoom {
  override readonly kind: string = 'ChasmExitRoom';

  override minHeight(): number {
    return Math.max(7, super.minHeight());
  }
  override minWidth(): number {
    return Math.max(7, super.minWidth());
  }
  override sizeCatProbs(): number[] {
    return [2, 1, 0];
  }
  override isExit(): boolean {
    return true;
  }
  override paint(level: GenLevel): void {
    super.paint(level);
    const exit = crampedCell(level, this, (t) => t === T.CHASM, (t) => t !== T.CHASM);
    regularExit(level, exit, T.EXIT);
    clearAround(level, exit);
  }
  override canPlaceCharacter(p: Point, l: GenLevel): boolean {
    return super.canPlaceCharacter(p, l) && notOnExit(p, l);
  }
}

/** RitualExitRoom: the stairs on the ritual's embers, where the loot would be. */
export class RitualExitRoom extends RitualRoom {
  override readonly kind: string = 'RitualExitRoom';

  override sizeCatProbs(): number[] {
    return [0, 1, 0];
  }
  override isExit(): boolean {
    return true;
  }
  protected override placeloot(level: GenLevel, p: Point): void {
    regularExit(level, level.pointToCell(p), T.EXIT);
  }
  override canPlaceCharacter(p: Point, l: GenLevel): boolean {
    return super.canPlaceCharacter(p, l) && notOnExit(p, l);
  }
}
