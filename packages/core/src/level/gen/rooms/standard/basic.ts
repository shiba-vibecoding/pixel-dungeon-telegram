import { T } from '../../../terrain';
import { Dungeon } from '../../dungeon';
import type { GenLevel } from '../../genlevel';
import { Painter } from '../../painter';
import type { Point } from '../../rect';
import { DoorType, type Room } from '../../room';
import { StandardRoom } from './standard';

/* levels/rooms/standard/EmptyRoom, and the plain EntranceRoom and ExitRoom the others build on. */

/** EmptyRoom: walls and a bare floor. */
export class EmptyRoom extends StandardRoom {
  readonly kind: string = 'EmptyRoom';

  paint(level: GenLevel): void {
    Painter.fill(level, this, T.WALL);
    Painter.fill(level, this, 1, T.EMPTY);
    for (const door of this.doors()) door.set(DoorType.REGULAR);
  }
}

/** The rules every entrance room follows (EntranceRoom): at least 5x5, never merged on the first two floors, no traps on the first. */
export function entranceMinWidth(base: number): number {
  return Math.max(base, 5);
}

export function entranceCanMerge(room: StandardRoom, l: GenLevel, other: Room, p: Point, mergeTerrain: number): boolean {
  if (Dungeon.depth <= 2) return false;
  return StandardRoom.prototype.canMerge.call(room, l, other, p, mergeTerrain);
}

export function entranceCanPlaceTrap(): boolean {
  return Dungeon.depth !== 1;
}

/** Puts the way up on a cell: to the surface on the first floor (LevelTransition.SURFACE), else to the depth above. */
export function placeEntrance(level: GenLevel, cell: number): void {
  Painter.set(level, cell, T.ENTRANCE);
  level.addTransition(cell, Dungeon.depth === 1 ? 'surface' : 'entrance');
}

/** Puts the way down on a cell. */
export function placeExit(level: GenLevel, cell: number): void {
  Painter.set(level, cell, T.EXIT);
  level.addTransition(cell, 'exit');
}

/** EntranceRoom: the way up, somewhere two cells in from the walls. */
export class EntranceRoom extends StandardRoom {
  readonly kind: string = 'EntranceRoom';

  override minWidth(): number {
    return entranceMinWidth(super.minWidth());
  }
  override minHeight(): number {
    return entranceMinWidth(super.minHeight());
  }
  override isEntrance(): boolean {
    return true;
  }
  override canMerge(l: GenLevel, other: Room, p: Point, mergeTerrain: number): boolean {
    return entranceCanMerge(this, l, other, p, mergeTerrain);
  }
  override canPlaceTrap(p: Point): boolean {
    return entranceCanPlaceTrap() && super.canPlaceTrap(p);
  }

  paint(level: GenLevel): void {
    Painter.fill(level, this, T.WALL);
    Painter.fill(level, this, 1, T.EMPTY);
    for (const door of this.doors()) door.set(DoorType.REGULAR);
    let entrance: number;
    do {
      entrance = level.pointToCell(this.random(2));
    } while (level.findMob(entrance));
    placeEntrance(level, entrance);
    // (EntranceRoom.placeEarlyGuidePages: there is no adventurer's guide to place pages of.)
  }
}

/** ExitRoom: the way down, two cells in from the walls; nobody is placed on it. */
export class ExitRoom extends StandardRoom {
  readonly kind: string = 'ExitRoom';

  override minWidth(): number {
    return Math.max(super.minWidth(), 5);
  }
  override minHeight(): number {
    return Math.max(super.minHeight(), 5);
  }
  override isExit(): boolean {
    return true;
  }

  paint(level: GenLevel): void {
    Painter.fill(level, this, T.WALL);
    Painter.fill(level, this, 1, T.EMPTY);
    for (const door of this.doors()) door.set(DoorType.REGULAR);
    placeExit(level, level.pointToCell(this.random(2)));
  }

  override canPlaceCharacter(p: Point, l: GenLevel): boolean {
    return super.canPlaceCharacter(p, l) && l.pointToCell(p) !== l.exit();
  }
}
