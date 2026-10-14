import { T } from '../../../terrain';
import { Carpet } from '../../custom';
import { Dungeon } from '../../dungeon';
import type { GenLevel } from '../../genlevel';
import { Painter } from '../../painter';
import { Random } from '../../random';
import { type Point, Rect } from '../../rect';
import type { Room } from '../../room';
import { entranceCanMerge, entranceCanPlaceTrap, placeEntrance } from './basic';
import { ChasmBridgeRoom, RegionDecoBridgeRoom, WaterBridgeRoom } from './bridge-rooms';
import { CavesFissureRoom, CircleWallRoom } from './caves-rooms';
import { HallwayRoom, LibraryHallRoom, LibraryRingRoom, StatuesRoom } from './city-rooms';
import { clearAround, crampedCell, regularEntrance } from './helpers';
import { CaveRoom, ChasmRoom, CircleBasinRoom, RegionDecoPatchRoom, RitualRoom, RuinsRoom } from './patch-rooms';
import { CellBlockRoom, PillarsRoom, StatueLineRoom } from './prison-rooms';
import { RingRoom } from './sewer-rooms';

/*
 * levels/rooms/standard/entrance: the rooms with the way up, each a kind of standard room with the
 * stairs worked in. Only those used on the first floors keep EntranceRoom's rules on merging and traps.
 */

/** WaterBridgeEntranceRoom: the stairs on the dry side of a stream. */
export class WaterBridgeEntranceRoom extends WaterBridgeRoom {
  override readonly kind: string = 'WaterBridgeEntranceRoom';

  override minWidth(): number {
    return Math.max(7, super.minWidth());
  }
  override minHeight(): number {
    return Math.max(7, super.minHeight());
  }
  override isEntrance(): boolean {
    return true;
  }
  override canMerge(l: GenLevel, other: Room, p: Point, mergeTerrain: number): boolean {
    return Dungeon.depth > 2 && super.canMerge(l, other, p, mergeTerrain);
  }
  override canPlaceTrap(p: Point): boolean {
    return entranceCanPlaceTrap() && super.canPlaceTrap(p);
  }

  override paint(level: GenLevel): void {
    super.paint(level);
    let entrance: number;
    do {
      entrance = level.pointToCell(this.random(2));
    } while (this.spaceRect!.insideRect(level.cellToPoint(entrance)) || level.findMob(entrance));
    clearAround(level, entrance);
    placeEntrance(level, entrance);
    // (EntranceRoom.placeEarlyGuidePages: there is no adventurer's guide to place pages of.)
  }
}

/** RegionDecoPatchEntranceRoom: the stairs among patches of the region's decoration. */
export class RegionDecoPatchEntranceRoom extends RegionDecoPatchRoom {
  override readonly kind: string = 'RegionDecoPatchEntranceRoom';

  override minHeight(): number {
    return Math.max(7, super.minHeight());
  }
  override minWidth(): number {
    return Math.max(7, super.minWidth());
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

  override paint(level: GenLevel): void {
    super.paint(level);
    const entrance = crampedCell(level, this, (t) => t === T.REGION_DECO, (t) => t !== T.REGION_DECO);
    placeEntrance(level, entrance);
    clearAround(level, entrance);
    // (EntranceRoom.placeEarlyGuidePages: there is no adventurer's guide to place pages of.)
  }
}

/** RingEntranceRoom: the stairs on special floor in the hollow middle of a ring. */
export class RingEntranceRoom extends RingRoom {
  override readonly kind: string = 'RingEntranceRoom';

  override sizeCatProbs(): number[] {
    return [0, 1, 0];
  }
  override isEntrance(): boolean {
    return true;
  }
  protected override centerDecoTiles(): number {
    return T.EMPTY_SP;
  }
  protected override placeCenterDetail(level: GenLevel, pos: number): void {
    regularEntrance(level, pos, T.ENTRANCE_SP);
  }
}

/** CircleBasinEntranceRoom: the stairs where the bridges cross. */
export class CircleBasinEntranceRoom extends CircleBasinRoom {
  override readonly kind: string = 'CircleBasinEntranceRoom';

  override sizeCatProbs(): number[] {
    return [0, 1, 0];
  }
  override isEntrance(): boolean {
    return true;
  }
  override paint(level: GenLevel): void {
    super.paint(level);
    regularEntrance(level, level.pointToCell(this.center()), T.ENTRANCE_SP);
  }
}

/** StatueLineEntranceRoom: the stairs in a room with a line of statues. */
export class StatueLineEntranceRoom extends StatueLineRoom {
  override readonly kind: string = 'StatueLineEntranceRoom';

  override minWidth(): number {
    return Math.max(7, super.minWidth());
  }
  override minHeight(): number {
    return Math.max(7, super.minHeight());
  }
  override isEntrance(): boolean {
    return true;
  }
  override paint(level: GenLevel): void {
    super.paint(level);
    let entrance: number;
    do {
      entrance = level.pointToCell(this.random(3));
    } while (level.findMob(entrance));
    regularEntrance(level, entrance, T.ENTRANCE);
  }
}

/** RegionDecoLineEntranceRoom: with a line of the region's decoration. */
export class RegionDecoLineEntranceRoom extends StatueLineEntranceRoom {
  override readonly kind: string = 'RegionDecoLineEntranceRoom';

  protected override decoTerrain(): number {
    return T.REGION_DECO;
  }
}

/** ChasmBridgeEntranceRoom: the stairs on one side of a chasm. */
export class ChasmBridgeEntranceRoom extends ChasmBridgeRoom {
  override readonly kind: string = 'ChasmBridgeEntranceRoom';

  override minWidth(): number {
    return Math.max(7, super.minWidth());
  }
  override minHeight(): number {
    return Math.max(7, super.minHeight());
  }
  override isEntrance(): boolean {
    return true;
  }
  override paint(level: GenLevel): void {
    super.paint(level);
    let entrance: number;
    do {
      entrance = level.pointToCell(this.random(2));
    } while (this.spaceRect!.insideRect(level.cellToPoint(entrance)) || level.findMob(entrance));
    clearAround(level, entrance);
    regularEntrance(level, entrance, T.ENTRANCE);
  }
}

/** PillarsEntranceRoom: the stairs among the pillars, never against one but from above. */
export class PillarsEntranceRoom extends PillarsRoom {
  override readonly kind: string = 'PillarsEntranceRoom';

  override sizeCatProbs(): number[] {
    return [3, 1, 0];
  }
  override isEntrance(): boolean {
    return true;
  }
  override paint(level: GenLevel): void {
    super.paint(level);
    let entrance: number;
    let valid: boolean;
    do {
      entrance = level.pointToCell(this.random(2));
      valid = true;
      for (const i of level.neighbours4) {
        if (i === -level.width) continue;
        if (level.map[entrance + i] === T.WALL) valid = false;
      }
    } while (level.findMob(entrance) || level.map[entrance] === T.WALL || !valid);
    regularEntrance(level, entrance, T.ENTRANCE);
  }
}

/** CellBlockEntranceRoom: the stairs in one of the open cells, away from its door. */
export class CellBlockEntranceRoom extends CellBlockRoom {
  override readonly kind: string = 'CellBlockEntranceRoom';

  override sizeCatProbs(): number[] {
    return [0, 1, 0];
  }
  override isEntrance(): boolean {
    return true;
  }
  override paint(level: GenLevel): void {
    super.paint(level);
    regularEntrance(level, cellBlockSpot(level, this), T.ENTRANCE_SP);
  }
}

/** Where a cell block's way in or out goes: special floor (an open cell), no door beside it. */
export function cellBlockSpot(level: GenLevel, room: Room): number {
  for (;;) {
    const cell = level.pointToCell(room.random(3));
    if (level.map[cell] === T.EMPTY_SP && !level.neighbours8.some((i) => level.map[cell + i] === T.DOOR)) return cell;
  }
}

/** CaveEntranceRoom: the stairs in a cave. */
export class CaveEntranceRoom extends CaveRoom {
  override readonly kind: string = 'CaveEntranceRoom';

  override minHeight(): number {
    return Math.max(7, super.minHeight());
  }
  override minWidth(): number {
    return Math.max(7, super.minWidth());
  }
  override sizeCatProbs(): number[] {
    return [2, 1, 0];
  }
  override isEntrance(): boolean {
    return true;
  }
  override paint(level: GenLevel): void {
    super.paint(level);
    const entrance = crampedCell(level, this, (t) => t === T.WALL, (t) => t !== T.WALL);
    regularEntrance(level, entrance, T.ENTRANCE);
    clearAround(level, entrance);
  }
}

/** RegionDecoBridgeEntranceRoom: the stairs on one side of a line of the region's decoration, not against it. */
export class RegionDecoBridgeEntranceRoom extends RegionDecoBridgeRoom {
  override readonly kind: string = 'RegionDecoBridgeEntranceRoom';

  override minWidth(): number {
    return Math.max(8, super.minWidth());
  }
  override minHeight(): number {
    return Math.max(8, super.minHeight());
  }
  override isEntrance(): boolean {
    return true;
  }
  override paint(level: GenLevel): void {
    super.paint(level);
    regularEntrance(level, decoBridgeSpot(level, this, this.spaceRect!), T.ENTRANCE);
  }
}

/** Where a decoration bridge room's way in or out goes: off the line, with none of it beside. */
export function decoBridgeSpot(level: GenLevel, room: Room, spaceRect: Rect): number {
  let cell: number;
  let valid: boolean;
  do {
    valid = true;
    cell = level.pointToCell(room.random(2));
    if (spaceRect.insideRect(level.cellToPoint(cell))) {
      valid = false;
    } else {
      for (const i of level.neighbours8) if (level.map[cell + i] === T.REGION_DECO_ALT) valid = false;
    }
  } while (!valid);
  return cell;
}

/** CavesFissureEntranceRoom: the stairs on solid ground between the fissures. */
export class CavesFissureEntranceRoom extends CavesFissureRoom {
  override readonly kind: string = 'CavesFissureEntranceRoom';

  override sizeCatProbs(): number[] {
    return [3, 1, 0];
  }
  override isEntrance(): boolean {
    return true;
  }
  override paint(level: GenLevel): void {
    super.paint(level);
    const entrance = fissureSpot(level, this);
    regularEntrance(level, entrance, T.ENTRANCE);
  }
}

/** Where a fissure room's way in or out goes: on plain ground, with no chasm straight beside it. */
export function fissureSpot(level: GenLevel, room: Room): number {
  let cell: number;
  do {
    cell = level.pointToCell(room.random(2));
  } while (level.map[cell] === T.CHASM || level.map[cell] === T.EMPTY_SP || level.findMob(cell));
  for (const i of level.neighbours4) if (level.map[cell + i] === T.CHASM) Painter.set(level, cell + i, T.EMPTY);
  return cell;
}

/** CircleWallEntranceRoom: the stairs inside the round wall, a passage cut through it. */
export class CircleWallEntranceRoom extends CircleWallRoom {
  override readonly kind: string = 'CircleWallEntranceRoom';

  override minWidth(): number {
    return Math.max(super.minWidth(), 11);
  }
  override minHeight(): number {
    return Math.max(super.minHeight(), 11);
  }
  override sizeCatProbs(): number[] {
    return [0, 1, 0];
  }
  override isEntrance(): boolean {
    return true;
  }
  override paint(level: GenLevel): void {
    super.paint(level);
    circleWallCenter(level, this, (cell) => regularEntrance(level, cell, T.ENTRANCE));
  }
}

/** The middle of a circle wall room hollowed out round the way in or out, and a passage cut out through the wall. */
export function circleWallCenter(level: GenLevel, room: Room, place: (cell: number) => void): void {
  const p = room.center();
  const cell = level.pointToCell(p);
  for (const i of level.neighbours8) if (level.map[cell + 2 * i] === T.WALL) Painter.set(level, cell + i, T.EMPTY);
  place(cell);

  let xDir = 0;
  let yDir = 0;
  if (Random.Int(2) === 0) xDir = Random.Int(2) === 0 ? 1 : -1;
  else yDir = Random.Int(2) === 0 ? 1 : -1;
  p.x += 2 * xDir;
  p.y += 2 * yDir;
  while (level.map[level.pointToCell(p)] === T.WALL) {
    Painter.set(level, p, T.EMPTY);
    p.x += xDir;
    p.y += yDir;
  }
}

/** HallwayEntranceRoom: the stairs in the carpeted square. */
export class HallwayEntranceRoom extends HallwayRoom {
  override readonly kind: string = 'HallwayEntranceRoom';

  override isEntrance(): boolean {
    return true;
  }
  override paint(level: GenLevel): void {
    super.paint(level);
    let entrance = -1;
    for (const p of this.getPoints()) {
      if (level.map[level.pointToCell(p)] === T.ENTRANCE_SP) {
        entrance = level.pointToCell(p);
        break;
      }
    }
    level.addTransition(entrance, 'entrance');
  }
}

/** StatuesEntranceRoom: the stairs in the middle; in a bigger room, on a carpet of their own among the statues' squares. */
export class StatuesEntranceRoom extends StatuesRoom {
  override readonly kind: string = 'StatuesEntranceRoom';

  override sizeCatProbs(): number[] {
    return [3, 1, 0];
  }
  override isEntrance(): boolean {
    return true;
  }
  override paint(level: GenLevel): void {
    super.paint(level);
    const entrance = statuesCenter(level, this, T.ENTRANCE, Carpet.CITY_ENTRANCE);
    regularEntrance(level, entrance, T.ENTRANCE);
  }
}

/**
 * The cell of a statues room's way in or out: in a room 11 or more across, the middle, on a carpet
 * laid under the others; otherwise where the room put it already (`terrain`).
 */
export function statuesCenter(level: GenLevel, room: Room, terrain: number, carpetTile: number): number {
  let cell = -1;
  if (room.width() >= 11 || room.height() >= 11) {
    const c = room.center();
    cell = level.pointToCell(c);
    const carpet = new Carpet();
    const carpetRect = new Rect(c.x - 1, c.y - 1, c.x + 1, c.y + 1);
    if (room.width() % 2 === 0) {
      if (c.x < (room.left + room.right) / 2) carpetRect.right++;
      else carpetRect.left--;
    }
    if (room.height() % 2 === 0) {
      if (c.y < (room.top + room.bottom) / 2) carpetRect.bottom++;
      else carpetRect.top--;
    }
    for (const p of carpetRect.getPoints()) {
      if (level.map[level.pointToCell(p)] !== T.STATUE) Painter.set(level, p, T.EMPTY_DECO);
    }
    carpet.setRect(carpetRect.left, carpetRect.top, carpetRect.width() + 1, carpetRect.height() + 1);
    carpet.overrideLevelTile(c.x, c.y, carpetTile);
    // Under the other carpets.
    level.customTiles.unshift(carpet.toCustomTile());
  } else {
    // Already placed in this case.
    for (const p of room.getPoints()) {
      if (level.map[level.pointToCell(p)] === terrain) {
        cell = level.pointToCell(p);
        break;
      }
    }
  }
  return cell;
}

/** LibraryHallEntranceRoom: the stairs on one of the pedestals. */
export class LibraryHallEntranceRoom extends LibraryHallRoom {
  override readonly kind: string = 'LibraryHallEntranceRoom';

  override isEntrance(): boolean {
    return true;
  }
  override paint(level: GenLevel): void {
    super.paint(level);
    regularEntrance(level, pedestalSpot(level, this), T.ENTRANCE);
  }
}

/** One of a library hall's pedestals (the region's decoration), at random. */
export function pedestalSpot(level: GenLevel, room: Room): number {
  for (;;) {
    const cell = level.pointToCell(room.random(2));
    if (level.map[cell] === T.REGION_DECO) return cell;
  }
}

/** LibraryRingEntranceRoom: the stairs on a carpet inside the ring of shelves, a way cut through them. */
export class LibraryRingEntranceRoom extends LibraryRingRoom {
  override readonly kind: string = 'LibraryRingEntranceRoom';

  override minWidth(): number {
    return Math.max(super.minWidth(), 13);
  }
  override minHeight(): number {
    return Math.max(super.minHeight(), 13);
  }
  override sizeCatProbs(): number[] {
    return [0, 1, 0];
  }
  override isEntrance(): boolean {
    return true;
  }
  override paint(level: GenLevel): void {
    super.paint(level);
    libraryRingCenter(level, this, (cell) => regularEntrance(level, cell, T.ENTRANCE_SP), Carpet.CITY_ENTRANCE);
  }
}

/** The carpeted middle of a library ring with the way in or out, and a way cut out through the shelves. */
export function libraryRingCenter(level: GenLevel, room: Room, place: (cell: number) => void, carpetTile: number): void {
  Painter.fill(level, room, 5, T.EMPTY_SP);
  const p = room.center();
  place(level.pointToCell(p));

  const carpet = new Carpet();
  carpet.setRect(room.left + 5, room.top + 5, room.width() - 10, room.height() - 10);
  carpet.overrideLevelTile(p.x, p.y, carpetTile);
  level.customTiles.push(carpet.toCustomTile());

  let dirX = 0;
  let dirY = 0;
  if (Random.Int(2) === 0) dirX = Random.Int(2) === 0 ? +1 : -1;
  else dirY = Random.Int(2) === 0 ? +1 : -1;
  p.x += dirX;
  p.y += dirY;
  while (level.map[level.pointToCell(p)] !== T.EMPTY) {
    Painter.set(level, p, T.EMPTY_SP);
    p.x += dirX;
    p.y += dirY;
  }
}

/** RuinsEntranceRoom: the stairs among the ruins. */
export class RuinsEntranceRoom extends RuinsRoom {
  override readonly kind: string = 'RuinsEntranceRoom';

  override minWidth(): number {
    return Math.max(super.minWidth(), 7);
  }
  override minHeight(): number {
    return Math.max(super.minHeight(), 7);
  }
  override isEntrance(): boolean {
    return true;
  }
  override sizeCatProbs(): number[] {
    return [2, 1, 0];
  }
  override paint(level: GenLevel): void {
    super.paint(level);
    const entrance = crampedCell(level, this, (t) => t === T.WALL, (t) => t !== T.WALL && t !== T.REGION_DECO);
    regularEntrance(level, entrance, T.ENTRANCE);
    clearAround(level, entrance);
  }
}

/** ChasmEntranceRoom: the stairs between patches of chasm. */
export class ChasmEntranceRoom extends ChasmRoom {
  override readonly kind: string = 'ChasmEntranceRoom';

  override minHeight(): number {
    return Math.max(7, super.minHeight());
  }
  override minWidth(): number {
    return Math.max(7, super.minWidth());
  }
  override sizeCatProbs(): number[] {
    return [2, 1, 0];
  }
  override isEntrance(): boolean {
    return true;
  }
  override paint(level: GenLevel): void {
    super.paint(level);
    const entrance = crampedCell(level, this, (t) => t === T.CHASM, (t) => t !== T.CHASM);
    regularEntrance(level, entrance, T.ENTRANCE);
    clearAround(level, entrance);
  }
}

/** RitualEntranceRoom: the stairs on the ritual's embers, where the loot would be. */
export class RitualEntranceRoom extends RitualRoom {
  override readonly kind: string = 'RitualEntranceRoom';

  override sizeCatProbs(): number[] {
    return [0, 1, 0];
  }
  override isEntrance(): boolean {
    return true;
  }
  protected override placeloot(level: GenLevel, p: Point): void {
    regularEntrance(level, level.pointToCell(p), T.ENTRANCE);
  }
}
