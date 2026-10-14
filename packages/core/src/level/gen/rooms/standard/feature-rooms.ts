import type { Item } from '../../../../items';
import { type PlantKind, SEED_PLANTS } from '../../../../plants';
import { T } from '../../../terrain';
import { Generator } from '../../generator';
import type { GenLevel } from '../../genlevel';
import { Painter } from '../../painter';
import { Random } from '../../random';
import { Point, Rect } from '../../rect';
import { DoorType, type Room } from '../../room';
import { f32 } from './helpers';
import { StandardRoom } from './standard';

/*
 * The standard rooms any region may have: levels/rooms/standard/SkullsRoom (the halls' own),
 * PlantsRoom, AquariumRoom, PlatformRoom, FissureRoom, GrassyGraveRoom, StripedRoom, StudyRoom,
 * SuspiciousChestRoom and MinefieldRoom (BurnedRoom is with the patch rooms).
 */

/** SkullsRoom: a round room round a ring of statues (skulls) round a solid middle. */
export class SkullsRoom extends StandardRoom {
  readonly kind: string = 'SkullsRoom';

  override minWidth(): number {
    return Math.max(7, super.minWidth());
  }
  override minHeight(): number {
    return Math.max(7, super.minHeight());
  }
  override sizeCatProbs(): number[] {
    return [0, 3, 1];
  }

  paint(level: GenLevel): void {
    Painter.fill(level, this, T.WALL);
    Painter.fillEllipse(level, this, 2, T.EMPTY);
    for (const door of this.doors()) {
      door.set(DoorType.REGULAR);
      if (door.x === this.left || door.x === this.right) {
        Painter.drawInside(level, this, door, Math.trunc(this.width() / 2), T.EMPTY);
      } else {
        Painter.drawInside(level, this, door, Math.trunc(this.height() / 2), T.EMPTY);
      }
    }
    Painter.fillEllipse(level, this, 4, T.STATUE);
    Painter.fillEllipse(level, this, 6, T.WALL);
  }
}

/**
 * Shattered's seeds that Pixel Dungeon has no plant for, and the nearest that stands in.
 * SEAM(alchemy): until Shattered's plants come in with the alchemy stream.
 */
const NEAREST_PLANT: Readonly<Record<string, PlantKind>> = {
  'seed.swiftthistle': 'fadeleaf',
  'seed.starflower': 'sungrass',
  'seed.mageroyal': 'sungrass',
  'seed.stormvine': 'fadeleaf',
  'seed.blindweed': 'dreamweed',
};

/** The plant a seed grows into. */
function plantOf(seed: Item): PlantKind {
  return SEED_PLANTS[seed.kind] ?? NEAREST_PLANT[seed.kind] ?? 'sungrass';
}

/** PlantsRoom.randomSeed: any seed but a firebloom's. */
function randomSeed(): PlantKind {
  let result: Item;
  do {
    result = Generator.randomUsingDefaults('SEED');
  } while (result.kind === 'seed.firebloom');
  return plantOf(result);
}

/** The rooms grass rooms merge with grass (instanceof PlantsRoom or GrassyGraveRoom). */
const GRASSY = (r: Room): boolean => r instanceof PlantsRoom || r instanceof GrassyGraveRoom;

/** PlantsRoom: grass round tall grass, with one, two or four plants. */
export class PlantsRoom extends StandardRoom {
  readonly kind: string = 'PlantsRoom';

  override minWidth(): number {
    return Math.max(super.minWidth(), 5);
  }
  override minHeight(): number {
    return Math.max(super.minHeight(), 5);
  }
  override sizeCatProbs(): number[] {
    return [3, 1, 0];
  }
  override merge(l: GenLevel, other: Room, merge: Rect, mergeTerrain: number): void {
    if (mergeTerrain === T.EMPTY && GRASSY(other)) super.merge(l, other, merge, T.GRASS);
    else super.merge(l, other, merge, mergeTerrain);
  }

  paint(level: GenLevel): void {
    Painter.fill(level, this, T.WALL);
    Painter.fill(level, this, 1, T.GRASS);
    Painter.fill(level, this, 2, T.HIGH_GRASS);
    if (Math.min(this.width(), this.height()) >= 7) Painter.fill(level, this, 3, T.GRASS);

    const center = this.center();
    const { left, top, right, bottom } = this;
    const at = (x: number, y: number): number => level.pointToCell(new Point(x, y));

    if (Math.max(this.width(), this.height()) >= 9) {
      if (Math.min(this.width(), this.height()) >= 11) {
        // Four plants in very large rooms.
        Painter.drawLine(level, new Point(left + 2, center.y), new Point(right - 2, center.y), T.HIGH_GRASS);
        Painter.drawLine(level, new Point(center.x, top + 2), new Point(center.x, bottom - 2), T.HIGH_GRASS);
        level.plant(randomSeed(), at(center.x - 1, center.y - 1));
        level.plant(randomSeed(), at(center.x + 1, center.y - 1));
        level.plant(randomSeed(), at(center.x - 1, center.y + 1));
        level.plant(randomSeed(), at(center.x + 1, center.y + 1));
      } else if (this.width() > this.height() || (this.width() === this.height() && Random.Int(2) === 0)) {
        // Two, left and right.
        Painter.drawLine(level, new Point(center.x, top + 2), new Point(center.x, bottom - 2), T.HIGH_GRASS);
        level.plant(randomSeed(), at(center.x - 1, center.y));
        level.plant(randomSeed(), at(center.x + 1, center.y));
      } else {
        // Two, above and below.
        Painter.drawLine(level, new Point(left + 2, center.y), new Point(right - 2, center.y), T.HIGH_GRASS);
        level.plant(randomSeed(), at(center.x, center.y - 1));
        level.plant(randomSeed(), at(center.x, center.y + 1));
      }
    } else {
      // Just one in smaller rooms.
      level.plant(randomSeed(), level.pointToCell(center));
    }

    for (const door of this.doors()) door.set(DoorType.REGULAR);
  }

  override canPlaceItem(p: Point, l: GenLevel): boolean {
    return super.canPlaceItem(p, l) && !l.plants.has(l.pointToCell(p));
  }
  override canPlaceCharacter(p: Point, l: GenLevel): boolean {
    return super.canPlaceCharacter(p, l) && !l.plants.has(l.pointToCell(p));
  }
}

/** AquariumRoom: a pool ringed by special floor, with one to three piranhas in it. */
export class AquariumRoom extends StandardRoom {
  readonly kind: string = 'AquariumRoom';

  override minWidth(): number {
    return Math.max(super.minWidth(), 7);
  }
  override minHeight(): number {
    return Math.max(super.minHeight(), 7);
  }
  override sizeCatProbs(): number[] {
    return [3, 1, 0];
  }
  override canPlaceItem(p: Point, l: GenLevel): boolean {
    return super.canPlaceItem(p, l) && l.map[l.pointToCell(p)] !== T.WATER;
  }
  override canPlaceCharacter(p: Point, l: GenLevel): boolean {
    return super.canPlaceCharacter(p, l) && l.map[l.pointToCell(p)] !== T.WATER;
  }

  paint(level: GenLevel): void {
    Painter.fill(level, this, T.WALL);
    Painter.fill(level, this, 1, T.EMPTY);
    Painter.fill(level, this, 2, T.EMPTY_SP);
    Painter.fill(level, this, 3, T.WATER);

    const minDim = Math.min(this.width(), this.height());
    const numFish = Math.trunc((minDim - 4) / 3);
    for (let i = 0; i < numFish; i++) {
      // Piranha.random: one in fifty a phantom piranha (RatSkull.exoticChanceMultiplier is 1 without the trinket).
      // SEAM(mobs): no phantom piranha yet; a piranha stands in.
      void (Random.Float() < f32(1 / 50));
      let pos: number;
      do {
        pos = level.pointToCell(this.random(3));
      } while (level.map[pos] !== T.WATER || level.findMob(pos));
      level.mobs.push({ kind: 'piranha', pos });
    }

    for (const door of this.doors()) door.set(DoorType.REGULAR);
  }
}

/** PlatformRoom: platforms of special floor over a chasm, joined by narrow bridges. */
export class PlatformRoom extends StandardRoom {
  readonly kind: string = 'PlatformRoom';

  override minWidth(): number {
    return Math.max(super.minWidth(), 6);
  }
  override minHeight(): number {
    return Math.max(super.minHeight(), 6);
  }
  override sizeCatProbs(): number[] {
    return [6, 3, 1];
  }
  /** Next to another platform or chasm room it is connected to, the wall between becomes chasm, with special floor at the door. */
  override merge(l: GenLevel, other: Room, merge: Rect, mergeTerrain: number): void {
    const door = this.connected.get(other);
    if (mergeTerrain !== T.CHASM && this.connected.has(other) && PLATFORM_PARTNERS.has(other.kind)) {
      super.merge(l, other, merge, T.CHASM);
      if (door) Painter.set(l, door, T.EMPTY_SP);
    } else {
      super.merge(l, other, merge, mergeTerrain);
    }
  }

  paint(level: GenLevel): void {
    Painter.fill(level, this, T.WALL);
    Painter.fill(level, this, 1, T.CHASM);

    const platforms: Rect[] = [];
    this.splitPlatforms(new Rect(this.left + 2, this.top + 2, this.right - 2, this.bottom - 2), platforms);
    for (const platform of platforms) {
      Painter.fill(level, platform.left, platform.top, platform.width() + 1, platform.height() + 1, T.EMPTY_SP);
    }

    for (const door of this.doors()) {
      door.set(DoorType.REGULAR);
      Painter.drawInside(level, this, door, 2, T.EMPTY_SP);
    }
  }

  private splitPlatforms(curPlatform: Rect, allPlatforms: Rect[]): void {
    const curArea = (curPlatform.width() + 1) * (curPlatform.height() + 1);
    // The chance to split goes from 0% at an area of 25 to 100% at 36.
    if (Random.Float() < f32((curArea - 25) / 11)) {
      if (curPlatform.width() > curPlatform.height() || (curPlatform.width() === curPlatform.height() && Random.Int(2) === 0)) {
        const splitX = Random.IntRange(curPlatform.left + 2, curPlatform.right - 2);
        this.splitPlatforms(new Rect(curPlatform.left, curPlatform.top, splitX - 1, curPlatform.bottom), allPlatforms);
        this.splitPlatforms(new Rect(splitX + 1, curPlatform.top, curPlatform.right, curPlatform.bottom), allPlatforms);
        // A bridge between.
        const bridgeY = Random.NormalIntRange(curPlatform.top, curPlatform.bottom);
        allPlatforms.push(new Rect(splitX - 1, bridgeY, splitX + 1, bridgeY));
      } else {
        const splitY = Random.IntRange(curPlatform.top + 2, curPlatform.bottom - 2);
        this.splitPlatforms(new Rect(curPlatform.left, curPlatform.top, curPlatform.right, splitY - 1), allPlatforms);
        this.splitPlatforms(new Rect(curPlatform.left, splitY + 1, curPlatform.right, curPlatform.bottom), allPlatforms);
        const bridgeX = Random.NormalIntRange(curPlatform.left, curPlatform.right);
        allPlatforms.push(new Rect(bridgeX, splitY - 1, bridgeX, splitY + 1));
      }
    } else {
      allPlatforms.push(curPlatform);
    }
  }
}

/** The rooms a platform room joins chasm to chasm with (instanceof PlatformRoom or ChasmRoom). */
const PLATFORM_PARTNERS = new Set(['PlatformRoom', 'ChasmRoom', 'ChasmEntranceRoom', 'ChasmExitRoom']);

/** FissureRoom: a chasm filling the middle of the room, a ragged ledge round it (one cell of chasm in a small room). */
export class FissureRoom extends StandardRoom {
  readonly kind: string = 'FissureRoom';

  override sizeCatProbs(): number[] {
    return [6, 3, 1];
  }
  override minHeight(): number {
    return Math.max(5, super.minHeight());
  }
  override minWidth(): number {
    return Math.max(5, super.minWidth());
  }

  paint(level: GenLevel): void {
    Painter.fill(level, this, T.WALL);
    for (const door of this.doors()) door.set(DoorType.REGULAR);
    Painter.fill(level, this, 1, T.EMPTY);

    if (this.square() <= 25) {
      const p = this.center();
      Painter.set(level, p.x, p.y, T.CHASM);
    } else {
      const smallestDim = Math.min(this.width(), this.height());
      const floorW = Math.trunc(Math.sqrt(smallestDim));
      // The chance for a cell at the ledge's edge to stay floor, tending to 50% the wider the ledge.
      let edgeFloorChance = f32(Math.sqrt(smallestDim)) % 1;
      edgeFloorChance = f32(f32(edgeFloorChance + f32((floorW - 1) * 0.5)) / floorW);

      for (let i = this.top + 2; i <= this.bottom - 2; i++) {
        for (let j = this.left + 2; j <= this.right - 2; j++) {
          const v = Math.min(i - this.top, this.bottom - i);
          const h = Math.min(j - this.left, this.right - j);
          if (Math.min(v, h) > floorW || (Math.min(v, h) === floorW && Random.Float() > edgeFloorChance)) {
            Painter.set(level, j, i, T.CHASM);
          }
        }
      }
    }
  }
}

/** GrassyGraveRoom: tombs in grass, one holding an item, the others gold. */
export class GrassyGraveRoom extends StandardRoom {
  readonly kind: string = 'GrassyGraveRoom';

  override merge(l: GenLevel, other: Room, merge: Rect, mergeTerrain: number): void {
    if (mergeTerrain === T.EMPTY && GRASSY(other)) super.merge(l, other, merge, T.GRASS);
    else super.merge(l, other, merge, mergeTerrain);
  }

  paint(level: GenLevel): void {
    Painter.fill(level, this, T.WALL);
    for (const door of this.doors()) door.set(DoorType.REGULAR);
    Painter.fill(level, this, 1, T.GRASS);

    const w = this.width() - 2;
    const h = this.height() - 2;
    const nGraves = Math.trunc(Math.max(w, h) / 2);
    const index = Random.Int(nGraves);
    const shift = Random.Int(2);
    for (let i = 0; i < nGraves; i++) {
      const pos = w > h
        ? this.left + 1 + shift + i * 2 + (this.top + 2 + Random.Int(h - 2)) * level.width
        : this.left + 2 + Random.Int(w - 2) + (this.top + 1 + shift + i * 2) * level.width;
      level.drop(i === index ? Generator.random() : Generator.random('GOLD'), pos).kind = 'tomb';
    }
  }
}

/** StripedRoom: stripes of tall grass on special floor; large ones in rings instead. */
export class StripedRoom extends StandardRoom {
  readonly kind: string = 'StripedRoom';

  override sizeCatProbs(): number[] {
    return [2, 1, 0];
  }
  override merge(l: GenLevel, other: Room, merge: Rect, mergeTerrain: number): void {
    if (other instanceof StripedRoom && mergeTerrain === T.EMPTY) super.merge(l, other, merge, T.EMPTY_SP);
    else super.merge(l, other, merge, mergeTerrain);
  }

  paint(level: GenLevel): void {
    Painter.fill(level, this, T.WALL);
    for (const door of this.doors()) door.set(DoorType.REGULAR);

    if (this.sizeCat.name === 'NORMAL') {
      Painter.fill(level, this, 1, T.EMPTY_SP);
      if (this.width() > this.height() || (this.width() === this.height() && Random.Int(2) === 0)) {
        for (let i = this.left + 2; i < this.right; i += 2) Painter.fill(level, i, this.top + 1, 1, this.height() - 2, T.HIGH_GRASS);
      } else {
        for (let i = this.top + 2; i < this.bottom; i += 2) Painter.fill(level, this.left + 1, i, this.width() - 2, 1, T.HIGH_GRASS);
      }
    } else if (this.sizeCat.name === 'LARGE') {
      const layers = Math.trunc((Math.min(this.width(), this.height()) - 1) / 2);
      for (let i = 1; i <= layers; i++) Painter.fill(level, this, i, i % 2 === 1 ? T.EMPTY_SP : T.HIGH_GRASS);
    }
  }
}

/** StudyRoom: shelves on the walls, special floor, a pedestal in the middle with a prize, a potion or a scroll. */
export class StudyRoom extends StandardRoom {
  readonly kind: string = 'StudyRoom';

  override minWidth(): number {
    return Math.max(super.minWidth(), 7);
  }
  override minHeight(): number {
    return Math.max(super.minHeight(), 7);
  }
  override sizeCatProbs(): number[] {
    return [2, 1, 0];
  }

  paint(level: GenLevel): void {
    Painter.fill(level, this, T.WALL);
    Painter.fill(level, this, 1, T.BOOKSHELF);
    Painter.fill(level, this, 2, T.EMPTY_SP);
    for (const door of this.doors()) {
      Painter.drawInside(level, this, door, 2, T.EMPTY_SP);
      door.set(DoorType.REGULAR);
    }

    if (this.sizeCat.name === 'LARGE') {
      // Shelves in the four corners.
      const { left, top, right, bottom } = this;
      const pillarW = Math.trunc((this.width() - 7) / 2);
      const pillarH = Math.trunc((this.height() - 7) / 2);
      Painter.fill(level, left + 3, top + 3, pillarW, 1, T.BOOKSHELF);
      Painter.fill(level, left + 3, top + 3, 1, pillarH, T.BOOKSHELF);
      Painter.fill(level, left + 3, bottom - 2 - 1, pillarW, 1, T.BOOKSHELF);
      Painter.fill(level, left + 3, bottom - 2 - pillarH, 1, pillarH, T.BOOKSHELF);
      Painter.fill(level, right - 2 - pillarW, top + 3, pillarW, 1, T.BOOKSHELF);
      Painter.fill(level, right - 2 - 1, top + 3, 1, pillarH, T.BOOKSHELF);
      Painter.fill(level, right - 2 - pillarW, bottom - 2 - 1, pillarW, 1, T.BOOKSHELF);
      Painter.fill(level, right - 2 - 1, bottom - 2 - pillarH, 1, pillarH, T.BOOKSHELF);
    }

    const center = this.center();
    Painter.set(level, center, T.PEDESTAL);
    const prize = Random.Int(2) === 0 ? level.findPrizeItem() : null;
    if (prize !== null) level.drop(prize, center.x + center.y * level.width);
    else level.drop(Generator.random(Random.oneOf('POTION', 'SCROLL')), center.x + center.y * level.width);
  }
}

/** SuspiciousChestRoom: a chest on a pedestal with a prize (or gold); a third of the time it is a mimic. */
export class SuspiciousChestRoom extends StandardRoom {
  readonly kind: string = 'SuspiciousChestRoom';

  override minWidth(): number {
    return Math.max(5, super.minWidth());
  }
  override minHeight(): number {
    return Math.max(5, super.minHeight());
  }

  paint(level: GenLevel): void {
    Painter.fill(level, this, T.WALL);
    Painter.fill(level, this, 1, T.EMPTY);
    for (const door of this.doors()) door.set(DoorType.REGULAR);

    const i = level.findPrizeItem() ?? Generator.random('GOLD');
    const center = level.pointToCell(this.center());
    Painter.set(level, center, T.PEDESTAL);

    // MimicTooth.mimicChanceMultiplier: 1 without the trinket (SEAM(alchemy)).
    const mimicChance = f32(1 / 3);
    if (Random.Float() < mimicChance) {
      // SEAM(mobs): Mimic.spawnAt(center, i), a mimic chest standing in, holding the item and the
      // mimic's own prize (Mimic.generatePrize).
      level.drop(i, center);
      level.drop(mimicPrize(), center).kind = 'mimic';
    } else {
      level.drop(i, center).kind = 'chest';
    }
  }
}

/** Mimic.generatePrize: gold, thrown weapons, armour, a weapon or a ring, for killing it. */
function mimicPrize(): Item {
  switch (Random.Int(5)) {
    case 0:
      return Generator.random('GOLD');
    case 1:
      return Generator.randomMissile();
    case 2:
      return Generator.randomArmor();
    case 3:
      return Generator.randomWeapon();
    default:
      return Generator.random('RING');
  }
}

/** MinefieldRoom: hidden explosive traps, embers scattered round them. */
export class MinefieldRoom extends StandardRoom {
  readonly kind: string = 'MinefieldRoom';

  override sizeCatProbs(): number[] {
    return [4, 1, 0];
  }
  override canMerge(l: GenLevel, _other: Room, p: Point, _mergeTerrain: number): boolean {
    return l.map[l.pointToCell(this.pointInside(p, 1))] === T.EMPTY;
  }

  paint(level: GenLevel): void {
    Painter.fill(level, this, T.WALL);
    Painter.fill(level, this, 1, T.EMPTY);
    for (const door of this.doors()) door.set(DoorType.REGULAR);

    let mines = Math.floor(Math.sqrt(this.square()) + 0.5);
    if (this.sizeCat.name === 'NORMAL') mines -= 3;
    else if (this.sizeCat.name === 'LARGE') mines += 3;
    else mines += 9;

    // TrapMechanism.revealHiddenTrapChance: 0 without the trinket (SEAM(alchemy)).
    const revealedChance = 0;
    let revealInc = 0;
    const neighbours8 = level.neighbours8;
    for (let i = 0; i < mines; i++) {
      let pos: number;
      do {
        pos = level.pointToCell(this.random(1));
      } while (level.traps.has(pos));

      // Embers scattered round the mine.
      for (let j = 0; j < 8; j++) {
        const c = neighbours8[Random.Int(8)]!;
        if (!level.traps.has(pos + c) && level.map[pos + c] === T.EMPTY) Painter.set(level, pos + c, T.EMBERS);
      }

      revealInc = f32(revealInc + revealedChance);
      if (revealInc >= 1) {
        Painter.set(level, pos, T.TRAP);
        level.setTrap('explosive', pos, true);
        revealInc = f32(revealInc - 1);
      } else {
        Painter.set(level, pos, T.SECRET_TRAP);
        level.setTrap('explosive', pos, false);
      }
    }
  }
}
