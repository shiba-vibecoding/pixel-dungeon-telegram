import { T } from '../../../terrain';
import { Generator } from '../../generator';
import type { GenLevel } from '../../genlevel';
import { Painter } from '../../painter';
import { generatePatch } from '../../patch';
import { Random } from '../../random';
import { Point, type Rect } from '../../rect';
import { DoorType, type Room } from '../../room';
import { f32, reachable } from './helpers';
import { StandardRoom } from './standard';

/*
 * levels/rooms/standard/PatchRoom and the rooms filled in by a Patch: RegionDecoPatchRoom,
 * CircleBasinRoom, CaveRoom, RuinsRoom, ChasmRoom, RitualRoom and BurnedRoom.
 */

/** PatchRoom: a room filled in (by its subclass) where a random patch over its inside is set. */
export abstract class PatchRoom extends StandardRoom {
  /** Over the room's inside, row by row: (width()-2) x (height()-2). */
  protected patch: boolean[] = [];

  protected abstract fill(): number;
  protected abstract clustering(): number;
  /** Whether every open cell must be reachable from the doors (the doors' fronts are kept open). */
  protected abstract ensurePath(): boolean;
  protected abstract cleanEdges(): boolean;

  protected setupPatch(level: GenLevel): void {
    let attempts = 0;
    const pw = this.width() - 2;
    const ph = this.height() - 2;
    if (this.ensurePath()) {
      let fill = this.fill();
      let valid: boolean;
      do {
        this.patch = generatePatch(pw, ph, fill, this.clustering(), true);
        let startPoint = level.pointToCell(this.center());
        for (const door of this.doors()) {
          if (door.x === this.left) {
            startPoint = this.xyToPatchCoords(door.x + 1, door.y);
            this.patch[this.xyToPatchCoords(door.x + 1, door.y)] = false;
            this.patch[this.xyToPatchCoords(door.x + 2, door.y)] = false;
          } else if (door.x === this.right) {
            startPoint = this.xyToPatchCoords(door.x - 1, door.y);
            this.patch[this.xyToPatchCoords(door.x - 1, door.y)] = false;
            this.patch[this.xyToPatchCoords(door.x - 2, door.y)] = false;
          } else if (door.y === this.top) {
            startPoint = this.xyToPatchCoords(door.x, door.y + 1);
            this.patch[this.xyToPatchCoords(door.x, door.y + 1)] = false;
            this.patch[this.xyToPatchCoords(door.x, door.y + 2)] = false;
          } else if (door.y === this.bottom) {
            startPoint = this.xyToPatchCoords(door.x, door.y - 1);
            this.patch[this.xyToPatchCoords(door.x, door.y - 1)] = false;
            this.patch[this.xyToPatchCoords(door.x, door.y - 2)] = false;
          }
        }
        const reached = reachable(pw, this.patch.length, startPoint, this.patch.map((b) => !b));
        valid = true;
        for (let i = 0; i < this.patch.length; i++) {
          if (!this.patch[i] && !reached[i]) {
            valid = false;
            break;
          }
        }
        attempts++;
        if (attempts > 100) {
          fill = f32(fill - f32(0.01));
          attempts = 0;
        }
      } while (!valid);
    } else {
      this.patch = generatePatch(pw, ph, this.fill(), this.clustering(), true);
    }
    if (this.cleanEdges()) this.cleanDiagonalEdges();
  }

  /** Sets every patched cell to a terrain. */
  protected fillPatch(level: GenLevel, terrain: number): void {
    for (let i = this.top + 1; i < this.bottom; i++) {
      for (let j = this.left + 1; j < this.right; j++) {
        if (this.patch[this.xyToPatchCoords(j, i)]) level.map[i * level.width + j] = terrain;
      }
    }
  }

  /** Clears patched cells that touch the rest only diagonally (lowering the fill a little). */
  protected cleanDiagonalEdges(): void {
    const p = this.patch;
    const pWidth = this.width() - 2;
    for (let i = 0; i < p.length - pWidth; i++) {
      if (!p[i]) continue;
      // Down-left.
      if (i % pWidth !== 0) {
        if (p[i - 1 + pWidth] && !(p[i - 1] || p[i + pWidth])) p[i - 1 + pWidth] = false;
      }
      // Down-right.
      if ((i + 1) % pWidth !== 0) {
        if (p[i + 1 + pWidth] && !(p[i + 1] || p[i + pWidth])) p[i + 1 + pWidth] = false;
      }
    }
  }

  protected xyToPatchCoords(x: number, y: number): number {
    return x - this.left - 1 + (y - this.top - 1) * (this.width() - 2);
  }
}

/** Fill from ~30% at 4x4 to ~60% at 18x18 (the caves, ruins, chasm and ritual rooms). */
const largeFill = (room: Room): number => f32(f32(0.3) + Math.min(room.width() * room.height(), 18 * 18) / 1024);

/** RegionDecoPatchRoom: patches of the region's decoration, every cell left reachable. */
export class RegionDecoPatchRoom extends PatchRoom {
  readonly kind: string = 'RegionDecoPatchRoom';

  override minHeight(): number {
    return Math.max(5, super.minHeight());
  }
  override minWidth(): number {
    return Math.max(5, super.minWidth());
  }
  // From ~20% at 4x4 to ~30% at 10x10.
  protected fill(): number {
    return f32(f32(0.2) + Math.min(this.width() * this.height(), 10 * 10) / 1024);
  }
  protected clustering(): number {
    return 1;
  }
  protected ensurePath(): boolean {
    return this.connected.size > 0;
  }
  protected cleanEdges(): boolean {
    return true;
  }

  paint(level: GenLevel): void {
    Painter.fill(level, this, T.WALL);
    Painter.fill(level, this, 1, T.EMPTY);
    for (const door of this.doors()) door.set(DoorType.REGULAR);
    this.setupPatch(level);
    this.fillPatch(level, T.REGION_DECO);
  }
}

/** CircleBasinRoom: a round room around a round chasm crossed by two bridges, puddles in the floor. */
export class CircleBasinRoom extends PatchRoom {
  readonly kind: string = 'CircleBasinRoom';

  override minWidth(): number {
    return this.sizeCat.minDim + 1;
  }
  override minHeight(): number {
    return this.sizeCat.minDim + 1;
  }
  override sizeCatProbs(): number[] {
    return [0, 3, 1];
  }
  /** Never an even size. */
  override resize(w: number, h: number): this {
    super.resize(w, h);
    if (this.width() % 2 === 0) this.right--;
    if (this.height() % 2 === 0) this.bottom--;
    return this;
  }
  protected fill(): number {
    return 0.5;
  }
  protected clustering(): number {
    return 5;
  }
  protected ensurePath(): boolean {
    return false;
  }
  protected cleanEdges(): boolean {
    return false;
  }

  paint(level: GenLevel): void {
    Painter.fill(level, this, T.WALL);
    Painter.fillEllipse(level, this, 1, T.EMPTY);
    for (const door of this.doors()) {
      door.set(DoorType.REGULAR);
      if (door.x === this.left || door.x === this.right) {
        Painter.drawInside(level, this, door, Math.trunc(this.width() / 2), T.EMPTY);
      } else {
        Painter.drawInside(level, this, door, Math.trunc(this.height() / 2), T.EMPTY);
      }
    }
    Painter.fillEllipse(level, this, 3, T.CHASM);

    const start = new Point(this.left + Math.trunc(this.width() / 2), this.top + 3);
    const end = new Point(this.left + Math.trunc(this.width() / 2), this.bottom - 3);
    Painter.drawLine(level, start, end, T.EMPTY_SP);
    start.set(this.left + 3, this.top + Math.trunc(this.height() / 2));
    end.set(this.right - 3, this.top + Math.trunc(this.height() / 2));
    Painter.drawLine(level, start, end, T.EMPTY_SP);

    if (this.width() > 11 || this.height() > 11) {
      const center = this.center();
      Painter.fill(level, center.x - 1, center.y - 1, 3, 3, T.EMPTY_SP);
      Painter.set(level, center, T.WALL);
    }

    this.setupPatch(level);
    for (let i = this.top + 1; i < this.bottom; i++) {
      for (let j = this.left + 1; j < this.right; j++) {
        const cell = i * level.width + j;
        if (level.map[cell] === T.EMPTY && this.patch[this.xyToPatchCoords(j, i)]) {
          level.map[cell] = T.WATER;
          if (level.map[cell - level.width] === T.WALL) level.map[cell - level.width] = T.WALL_DECO;
        }
      }
    }
  }
}

/** CaveRoom: rough cave walls, every cell left reachable. */
export class CaveRoom extends PatchRoom {
  readonly kind: string = 'CaveRoom';

  override sizeCatProbs(): number[] {
    return [4, 2, 1];
  }
  override minHeight(): number {
    return Math.max(5, super.minHeight());
  }
  override minWidth(): number {
    return Math.max(5, super.minWidth());
  }
  protected fill(): number {
    return largeFill(this);
  }
  protected clustering(): number {
    return 3;
  }
  protected ensurePath(): boolean {
    return this.connected.size > 0;
  }
  protected cleanEdges(): boolean {
    return true;
  }

  paint(level: GenLevel): void {
    Painter.fill(level, this, T.WALL);
    Painter.fill(level, this, 1, T.EMPTY);
    for (const door of this.doors()) door.set(DoorType.REGULAR);
    this.setupPatch(level);
    this.fillPatch(level, T.WALL);
  }
}

/** RuinsRoom: scattered walls, the isolated bits of them rubble (the region's decoration). */
export class RuinsRoom extends PatchRoom {
  readonly kind: string = 'RuinsRoom';

  override sizeCatProbs(): number[] {
    return [4, 2, 1];
  }
  override canMerge(_l: GenLevel, _other: Room, _p: Point, _mergeTerrain: number): boolean {
    return true;
  }
  protected fill(): number {
    return largeFill(this);
  }
  protected clustering(): number {
    return 0;
  }
  protected ensurePath(): boolean {
    return this.connected.size > 0;
  }
  protected cleanEdges(): boolean {
    return true;
  }

  paint(level: GenLevel): void {
    Painter.fill(level, this, T.WALL);
    Painter.fill(level, this, 1, T.EMPTY);
    for (const door of this.doors()) door.set(DoorType.REGULAR);
    this.setupPatch(level);
    for (let i = this.top + 1; i < this.bottom; i++) {
      for (let j = this.left + 1; j < this.right; j++) {
        if (!this.patch[this.xyToPatchCoords(j, i)]) continue;
        // Isolated bits of wall are turned into rubble.
        let wall: boolean;
        if (i > this.top + 1 && i < this.bottom - 1 && j > this.left + 1 && j < this.right - 1) {
          let adjacent = 0;
          if (this.patch[this.xyToPatchCoords(j - 1, i)]) adjacent++;
          if (this.patch[this.xyToPatchCoords(j + 1, i)]) adjacent++;
          if (this.patch[this.xyToPatchCoords(j, i - 1)]) adjacent++;
          if (this.patch[this.xyToPatchCoords(j, i + 1)]) adjacent++;
          wall = Random.Int(2) < adjacent;
        } else {
          wall = true;
        }
        level.map[i * level.width + j] = wall ? T.WALL : T.REGION_DECO;
      }
    }
  }
}

/** The rooms a chasm room joins chasm to chasm with (instanceof ChasmRoom or PlatformRoom). */
const CHASM_PARTNERS = new Set(['ChasmRoom', 'ChasmEntranceRoom', 'ChasmExitRoom', 'PlatformRoom']);

/** ChasmRoom: patches of chasm, every cell left reachable. */
export class ChasmRoom extends PatchRoom {
  readonly kind: string = 'ChasmRoom';

  override sizeCatProbs(): number[] {
    return [4, 2, 1];
  }
  override minHeight(): number {
    return Math.max(5, super.minHeight());
  }
  override minWidth(): number {
    return Math.max(5, super.minWidth());
  }
  protected fill(): number {
    return largeFill(this);
  }
  protected clustering(): number {
    return 1;
  }
  protected ensurePath(): boolean {
    return this.connected.size > 0;
  }
  protected cleanEdges(): boolean {
    return true;
  }

  /** Next to another chasm or platform room, the wall between becomes chasm, with floor at the door. */
  override merge(l: GenLevel, other: Room, merge: Rect, mergeTerrain: number): void {
    if (mergeTerrain === T.EMPTY && CHASM_PARTNERS.has(other.kind)) {
      super.merge(l, other, merge, T.CHASM);
      const door = this.connected.get(other);
      if (door) Painter.set(l, door, T.EMPTY);
    } else {
      super.merge(l, other, merge, mergeTerrain);
    }
  }

  paint(level: GenLevel): void {
    Painter.fill(level, this, T.WALL);
    Painter.fill(level, this, 1, T.EMPTY);
    for (const door of this.doors()) door.set(DoorType.REGULAR);
    this.setupPatch(level);
    this.fillPatch(level, T.CHASM);
  }
}

/** RitualRoom: the region's decoration about, and in the middle a ring of statues round embers and a pedestal with loot. */
export class RitualRoom extends PatchRoom {
  readonly kind: string = 'RitualRoom';

  override minWidth(): number {
    return Math.max(super.minWidth(), 9);
  }
  override minHeight(): number {
    return Math.max(super.minHeight(), 9);
  }
  override sizeCatProbs(): number[] {
    return [6, 3, 1];
  }
  // The inner 7x7 is cleared, so the fill comes out much lower.
  protected fill(): number {
    return largeFill(this);
  }
  protected clustering(): number {
    return 0;
  }
  protected ensurePath(): boolean {
    return this.connected.size > 0;
  }
  protected cleanEdges(): boolean {
    return true;
  }

  paint(level: GenLevel): void {
    Painter.fill(level, this, T.WALL);
    Painter.fill(level, this, 1, T.EMPTY);
    const c = this.center();
    this.setupPatch(level);
    this.fillPatch(level, T.REGION_DECO);

    Painter.fill(level, c.x - 3, c.y - 3, 7, 7, T.EMPTY);
    Painter.set(level, c.x - 2, c.y - 1, T.STATUE);
    Painter.set(level, c.x - 1, c.y - 2, T.STATUE);
    Painter.set(level, c.x + 2, c.y - 1, T.STATUE);
    Painter.set(level, c.x + 1, c.y - 2, T.STATUE);
    Painter.set(level, c.x - 2, c.y + 1, T.STATUE);
    Painter.set(level, c.x - 1, c.y + 2, T.STATUE);
    Painter.set(level, c.x + 2, c.y + 1, T.STATUE);
    Painter.set(level, c.x + 1, c.y + 2, T.STATUE);
    Painter.fill(level, c.x - 1, c.y - 1, 3, 3, T.EMBERS);
    Painter.set(level, c, T.PEDESTAL);

    this.placeloot(level, c);

    for (const door of this.doors()) door.set(DoorType.REGULAR);
  }

  /** Half the time one of the level's prizes, else a potion or a scroll. */
  protected placeloot(level: GenLevel, p: Point): void {
    let prize = Random.Int(2) === 0 ? level.findPrizeItem() : null;
    if (prize === null) prize = Generator.random(Random.oneOf('POTION', 'SCROLL'));
    level.drop(prize, level.pointToCell(p));
  }
}

/** BurnedRoom: patches of scorched floor, embers and fire traps, some hidden, some spent. */
export class BurnedRoom extends PatchRoom {
  readonly kind: string = 'BurnedRoom';

  override sizeCatProbs(): number[] {
    return [4, 1, 0];
  }
  override canMerge(l: GenLevel, _other: Room, p: Point, _mergeTerrain: number): boolean {
    return l.map[l.pointToCell(this.pointInside(p, 1))] === T.EMPTY;
  }
  // Past 8x8 each cell of width or height takes 3% off (a 14x14 room: 54%).
  protected fill(): number {
    return Math.min(1, f32(f32(1.48) - f32((this.width() + this.height()) * f32(0.03))));
  }
  protected clustering(): number {
    return 2;
  }
  protected ensurePath(): boolean {
    return false;
  }
  protected cleanEdges(): boolean {
    return false;
  }

  paint(level: GenLevel): void {
    Painter.fill(level, this, T.WALL);
    Painter.fill(level, this, 1, T.EMPTY);
    for (const door of this.doors()) door.set(DoorType.REGULAR);
    this.setupPatch(level);

    // TrapMechanism.revealHiddenTrapChance: 0 without the trinket (SEAM(alchemy)).
    const revealedChance = 0;
    let revealInc = 0;
    for (let i = this.top + 1; i < this.bottom; i++) {
      for (let j = this.left + 1; j < this.right; j++) {
        if (!this.patch[this.xyToPatchCoords(j, i)]) continue;
        const cell = i * level.width + j;
        let t: number;
        switch (Random.Int(5)) {
          case 1:
            t = T.EMBERS;
            break;
          case 2:
            t = T.TRAP;
            level.setTrap('burning', cell, true);
            break;
          case 3:
            revealInc = f32(revealInc + revealedChance);
            if (revealInc >= 1) {
              t = T.TRAP;
              level.setTrap('burning', cell, true);
              revealInc = f32(revealInc - 1);
            } else {
              t = T.SECRET_TRAP;
              level.setTrap('burning', cell, false);
            }
            break;
          case 4:
            t = T.INACTIVE_TRAP;
            level.setTrap('burning', cell, true).active = false;
            break;
          default:
            t = T.EMPTY;
            break;
        }
        level.map[cell] = t;
      }
    }
  }

  private outsidePatch(p: Point): boolean {
    return !this.inside(p) || !this.patch[this.xyToPatchCoords(p.x, p.y)];
  }
  override canPlaceWater(p: Point): boolean {
    return this.outsidePatch(p);
  }
  override canPlaceGrass(p: Point): boolean {
    return this.outsidePatch(p);
  }
  override canPlaceTrap(p: Point): boolean {
    return this.outsidePatch(p);
  }
}
