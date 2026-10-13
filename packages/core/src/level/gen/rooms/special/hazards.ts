import type { MobKind } from '../../../../actors';
import { createItem, type Item } from '../../../../items';
import { T } from '../../../terrain';
import type { TrapKind } from '../../../trapdefs';
import { Dungeon } from '../../dungeon';
import type { GenLevel, MobSpawn } from '../../genlevel';
import { Painter } from '../../painter';
import { Random } from '../../random';
import { Point } from '../../rect';
import { DoorType, type Room } from '../../room';
import { seamItem } from '../../seams';
import { EmptyRoom } from '../standard/basic';
import { findCatalyst, randomArmorOfSet, randomGold, randomMissileOfSet, randomWeaponOfSet, uncursedPrize } from './prizes';
import { SpecialRoom } from './special';
import { consumablePrize } from './vaults';

/*
 * The special rooms whose treasure lies past a hazard, each with a potion somewhere on the floor to
 * get past it: the fire (frost), the pool (invisibility), the sentry (haste), the gas (purity) and
 * the traps (levitation).
 */

/** Cells of a blob on the level (Level.blobs.get(X).cur > 0 there). */
const blobCells = (level: GenLevel, kind: string): Set<number> =>
  new Set(level.blobs.filter((b) => b.kind === kind && b.amount > 0).map((b) => b.cell));

/**
 * MagicalFireRoom: a wall of eternal fire across the room, three or four consumables behind it (a
 * honeypot half the time), and a potion of frost on the floor to put it out.
 */
export class MagicalFireRoom extends SpecialRoom {
  readonly kind: string = 'MagicalFireRoom';

  override minWidth(): number {
    return 7;
  }
  override minHeight(): number {
    return 7;
  }

  paint(level: GenLevel): void {
    Painter.fill(level, this, T.WALL);
    Painter.fill(level, this, 1, T.EMPTY);

    const door = this.entrance();
    door.set(DoorType.REGULAR);

    const firePos = this.center();
    const behindFire: Room = new EmptyRoom();

    if (door.x === this.left || door.x === this.right) {
      firePos.y = this.top + 1;
      while (firePos.y !== this.bottom) {
        level.seedBlob(level.pointToCell(firePos), 1, 'EternalFire');
        Painter.set(level, firePos, T.EMPTY_SP);
        firePos.y++;
      }
      if (door.x === this.left) behindFire.set(firePos.x + 1, this.top + 1, this.right - 1, this.bottom - 1);
      else behindFire.set(this.left + 1, this.top + 1, firePos.x - 1, this.bottom - 1);
    } else {
      firePos.x = this.left + 1;
      while (firePos.x !== this.right) {
        level.seedBlob(level.pointToCell(firePos), 1, 'EternalFire');
        Painter.set(level, firePos, T.EMPTY_SP);
        firePos.x++;
      }
      if (door.y === this.top) behindFire.set(this.left + 1, firePos.y + 1, this.right - 1, this.bottom - 1);
      else behindFire.set(this.left + 1, this.top + 1, this.right - 1, firePos.y - 1);
    }

    Painter.fill(level, behindFire, T.EMPTY_SP);

    let honeyPot = Random.Int(2) === 0;
    const n = Random.IntRange(3, 4);
    for (let i = 0; i < n; i++) {
      let pos: number;
      do {
        pos = level.pointToCell(behindFire.random(0));
      } while (level.heaps.has(pos));
      if (honeyPot) {
        level.drop(createItem('honeypot'), pos);
        honeyPot = false;
      } else {
        level.drop(consumablePrize(level), pos);
      }
    }

    level.addItemToSpawn(createItem('potion.frost'));
  }

  override canPlaceGrass(_p: Point): boolean {
    return false;
  }

  /** While the fire burns, nobody is placed on the special floor or next to the fire. */
  override canPlaceCharacter(p: Point, l: GenLevel): boolean {
    const fire = blobCells(l, 'EternalFire');
    if (fire.size > 0) {
      const cell = l.pointToCell(p);
      if (l.map[cell] === T.EMPTY_SP) return false;
      if (fire.has(cell)) return false;
      for (const i of l.neighbours4) if (fire.has(cell + i)) return false;
    }
    return super.canPlaceCharacter(p, l);
  }
}

/** PoolRoom: a pool with three piranhas in it, a chest of gear on a pedestal across it, and a potion of invisibility on the floor. */
export class PoolRoom extends SpecialRoom {
  readonly kind: string = 'PoolRoom';
  private static readonly NPIRANHAS = 3;

  override minWidth(): number {
    return 6;
  }
  override minHeight(): number {
    return 6;
  }

  paint(level: GenLevel): void {
    Painter.fill(level, this, T.WALL);
    Painter.fill(level, this, 1, T.WATER);

    const door = this.entrance();
    door.set(DoorType.REGULAR);

    let x = -1;
    let y = -1;
    if (door.x === this.left) {
      x = this.right - 1;
      y = this.top + Math.trunc(this.height() / 2);
      Painter.fill(level, this.left + 1, this.top + 1, 1, this.height() - 2, T.EMPTY_SP);
    } else if (door.x === this.right) {
      x = this.left + 1;
      y = this.top + Math.trunc(this.height() / 2);
      Painter.fill(level, this.right - 1, this.top + 1, 1, this.height() - 2, T.EMPTY_SP);
    } else if (door.y === this.top) {
      x = this.left + Math.trunc(this.width() / 2);
      y = this.bottom - 1;
      Painter.fill(level, this.left + 1, this.top + 1, this.width() - 2, 1, T.EMPTY_SP);
    } else if (door.y === this.bottom) {
      x = this.left + Math.trunc(this.width() / 2);
      y = this.top + 1;
      Painter.fill(level, this.left + 1, this.bottom - 1, this.width() - 2, 1, T.EMPTY_SP);
    }

    const pos = x + y * level.width;
    level.drop(gearPrize(level, Random.Int(3) === 0, true), pos).kind = 'chest';
    Painter.set(level, pos, T.PEDESTAL);

    level.addItemToSpawn(createItem('potion.invisibility'));

    for (let i = 0; i < PoolRoom.NPIRANHAS; i++) {
      // Piranha.random: one in fifty a phantom piranha (RatSkull: 1 without the trinket).
      const phantom = Random.Float() < Math.fround(1 / 50);
      let at: number;
      do {
        at = level.pointToCell(this.random());
      } while (level.map[at] !== T.WATER || level.findMob(at));
      // SEAM(mobs): no phantom piranha kind yet.
      level.mobs.push({ kind: phantom ? ('phantomPiranha' as MobKind) : 'piranha', pos: at });
    }
  }
}

/**
 * The gear prize of the pool, sentry and traps rooms: when `takeFound` (rolled by the room), a prize
 * the level holds; else a weapon, thrown weapons (not in the traps room) or armour of the next set of
 * floors, never cursed, now and then upgraded.
 */
function gearPrize(level: GenLevel, takeFound: boolean, missiles: boolean): Item {
  if (takeFound) {
    const prize = level.findPrizeItem();
    if (prize) return prize;
  }
  const floorSet = Math.trunc(Dungeon.depth / 5) + 1;
  // (Curse enchantments and glyphs would be removed: Pixel Dungeon's are never curses.)
  if (!missiles) return uncursedPrize(Random.Int(2) === 0 ? randomWeaponOfSet(floorSet) : randomArmorOfSet(floorSet));
  switch (Random.Int(5)) {
    case 2:
      return uncursedPrize(randomMissileOfSet(floorSet));
    case 3:
    case 4:
      return uncursedPrize(randomArmorOfSet(floorSet));
    default:
      return uncursedPrize(randomWeaponOfSet(floorSet));
  }
}

/** The sentry's fields as the world must keep them (SentryRoom.Sentry). */
export interface SentrySpawn {
  /** The room it guards (its walls included): it fires at a hero inside it, on the special floor. */
  room: { left: number; top: number; right: number; bottom: number };
  /** Turns a hero may spend in its sight before the first shot, and those left. */
  initialChargeDelay: number;
  curChargeDelay: number;
}

/**
 * SentryRoom: a red sentry on a pedestal at one end, a chest on a pedestal at the other, and between
 * them the special floor it fires over; a safe strip of plain floor by the door, a line of statues,
 * and a potion of haste on the floor to run past it.
 */
export class SentryRoom extends SpecialRoom {
  readonly kind: string = 'SentryRoom';

  override minWidth(): number {
    return 7;
  }
  override minHeight(): number {
    return 7;
  }

  paint(level: GenLevel): void {
    Painter.fill(level, this, T.WALL);
    Painter.fill(level, this, 1, T.EMPTY_SP);

    const entrance = this.entrance();
    let center: Point;
    do {
      center = this.center();
    } while (center.x === entrance.x || center.y === entrance.y);

    const sentryPos = new Point();
    const treasurePos = new Point();
    // How long the dangerous way from the entrance to the treasure and back is.
    let dangerDist = 0;
    const statue = (x: number, y: number): void =>
      Painter.set(level, x, y, level.map[x + y * level.width] === T.EMPTY_SP ? T.STATUE_SP : T.STATUE);

    if (entrance.x === this.left) {
      sentryPos.set(this.right - 1, center.y);
      Painter.fill(level, this.left + 1, this.top + 1, 1, this.height() - 2, T.EMPTY);
      if (entrance.y > center.y) {
        treasurePos.set(this.left + 1, Math.trunc((this.top + 1 + center.y) / 2));
        Painter.fill(level, this.left + 1, this.top + 1, 2, center.y - this.top - 1, T.EMPTY);
      } else {
        treasurePos.set(this.left + 1, Math.trunc((this.bottom + center.y) / 2));
        Painter.fill(level, this.left + 1, center.y + 1, 2, this.bottom - center.y - 1, T.EMPTY);
      }
      for (let x = this.right - 3; x > this.left; x--) statue(x, center.y);
      dangerDist = 2 * (this.width() - 5);
    } else if (entrance.x === this.right) {
      sentryPos.set(this.left + 1, center.y);
      Painter.fill(level, this.right - 1, this.top + 1, 1, this.height() - 2, T.EMPTY);
      if (entrance.y > center.y) {
        treasurePos.set(this.right - 1, Math.trunc((this.top + 1 + center.y) / 2));
        Painter.fill(level, this.right - 2, this.top + 1, 2, center.y - this.top - 1, T.EMPTY);
      } else {
        treasurePos.set(this.right - 1, Math.trunc((this.bottom + 1 + center.y) / 2));
        Painter.fill(level, this.right - 2, center.y + 1, 2, this.bottom - center.y - 1, T.EMPTY);
      }
      for (let x = this.left + 3; x < this.right; x++) statue(x, center.y);
      dangerDist = 2 * (this.width() - 5);
    } else if (entrance.y === this.top) {
      sentryPos.set(center.x, this.bottom - 1);
      Painter.fill(level, this.left + 1, this.top + 1, this.width() - 2, 1, T.EMPTY);
      if (entrance.x > center.x) {
        treasurePos.set(Math.trunc((this.left + 1 + center.x) / 2), this.top + 1);
        Painter.fill(level, this.left + 1, this.top + 1, center.x - this.left - 1, 2, T.EMPTY);
      } else {
        treasurePos.set(Math.trunc((this.right + center.x) / 2), this.top + 1);
        Painter.fill(level, center.x + 1, this.top + 1, this.right - center.x - 1, 2, T.EMPTY);
      }
      for (let y = this.bottom - 3; y > this.top; y--) statue(center.x, y);
      dangerDist = 2 * (this.height() - 5);
    } else if (entrance.y === this.bottom) {
      sentryPos.set(center.x, this.top + 1);
      Painter.fill(level, this.left + 1, this.bottom - 1, this.width() - 2, 1, T.EMPTY);
      if (entrance.x > center.x) {
        treasurePos.set(Math.trunc((this.left + 1 + center.x) / 2), this.bottom - 1);
        Painter.fill(level, this.left + 1, this.bottom - 2, center.x - this.left - 1, 2, T.EMPTY);
      } else {
        treasurePos.set(Math.trunc((this.right + center.x) / 2), this.bottom - 1);
        Painter.fill(level, center.x + 1, this.bottom - 2, this.right - center.x - 1, 2, T.EMPTY);
      }
      for (let y = this.top + 3; y < this.bottom; y++) statue(center.x, y);
      dangerDist = 2 * (this.height() - 5);
    }

    Painter.set(level, sentryPos, T.PEDESTAL);
    // Sentry.room = new EmptyRoom() set to this room's rect (the new room rolls its size category, as in Java).
    const guarded = new EmptyRoom();
    guarded.set(this.left, this.top, this.right, this.bottom);
    const delay = Math.fround(Math.fround(dangerDist / 3) + Math.fround(0.1));
    const sentry: SentrySpawn = {
      room: { left: guarded.left, top: guarded.top, right: guarded.right, bottom: guarded.bottom },
      initialChargeDelay: delay,
      curChargeDelay: delay,
    };
    // SEAM(mobs): SentryRoom.Sentry, an immovable, invulnerable NPC.
    level.mobs.push({ kind: 'sentry' as MobKind, pos: level.pointToCell(sentryPos), state: 'passive', ...sentry } as MobSpawn);

    Painter.set(level, treasurePos, T.PEDESTAL);
    level.drop(gearPrize(level, Random.Int(2) === 0, true), level.pointToCell(treasurePos)).kind = 'chest';

    level.addItemToSpawn(seamItem('potionOfHaste'));

    entrance.set(DoorType.REGULAR);
  }

  /** Never a door in the very middle of a side. */
  override canConnectPoint(p: Point): boolean {
    if (!super.canConnectPoint(p)) return false;
    if (this.width() % 2 === 1 && p.x === this.center().x) return false;
    if (this.height() % 2 === 1 && p.y === this.center().y) return false;
    return true;
  }
}

/**
 * ToxicGasRoom: a room long filled with toxic gas, vents (inactive traps) that keep it coming, a
 * skeleton with double gold far from the door and two chests of gold; a potion of purity on the floor.
 */
export class ToxicGasRoom extends SpecialRoom {
  readonly kind: string = 'ToxicGasRoom';

  override minWidth(): number {
    return 7;
  }
  override minHeight(): number {
    return 7;
  }

  paint(level: GenLevel): void {
    Painter.fill(level, this, T.WALL);
    Painter.fill(level, this, 1, T.EMPTY);
    Painter.set(level, this.center(), T.STATUE);

    for (const p of this.getPoints()) {
      const cell = level.pointToCell(p);
      // As if the gas had been spreading in the room a while.
      if (level.map[cell] === T.EMPTY) level.seedBlob(cell, 30, 'ToxicGas');
    }

    const traps = Math.min(this.width() - 2, this.height() - 2);
    for (let i = 0; i < traps; i++) {
      let cell: number;
      do {
        cell = level.pointToCell(this.random(2));
      } while (level.map[cell] !== T.EMPTY);
      // ToxicVent: a revealed trap that never goes off (decoration). SEAM(traps): no trap kind for it
      // yet, so the vent is kept as a blob on its cell, beside the gas seed it feeds.
      level.seedBlob(cell, 1, 'ToxicVent');
      level.seedBlob(cell, 12, 'ToxicGasSeed');
      Painter.set(level, cell, T.INACTIVE_TRAP);
    }

    // A skeleton with double gold, somewhat far from the door, then two chests of gold (no mimics;
    // a trinket catalyst may take one's place); more cells than needed, to pick the furthest.
    const goldPositions: number[] = [];
    for (let i = 0; i < 8; i++) {
      let posToAdd: number;
      do {
        posToAdd = level.pointToCell(this.random(2));
      } while (level.map[posToAdd] === T.STATUE || goldPositions.includes(posToAdd));
      goldPositions.push(posToAdd);
    }

    let furthestPos = -1;
    const entryPos = level.pointToCell(this.entrance());
    for (const i of goldPositions) {
      if (furthestPos === -1 || level.trueDistance(entryPos, i) > level.trueDistance(entryPos, furthestPos)) furthestPos = i;
    }
    goldPositions.splice(goldPositions.indexOf(furthestPos), 1);

    const mainGold = randomGold();
    mainGold.qty *= 2;
    level.drop(mainGold, furthestPos).kind = 'skeleton';

    for (let i = 0; i < 2; i++) {
      const item = findCatalyst(level) ?? randomGold();
      level.drop(item, goldPositions.shift()!).kind = 'chest';
    }

    level.addItemToSpawn(createItem('potion.purity'));

    this.entrance().set(DoorType.REGULAR);
  }

  /** Nobody is placed in the gas. */
  override canPlaceCharacter(p: Point, l: GenLevel): boolean {
    if (!super.canPlaceCharacter(p, l)) return false;
    return !blobCells(l, 'ToxicGas').has(l.pointToCell(p));
  }

  /** The room has hazards enough. */
  override canPlaceTrap(_p: Point): boolean {
    return false;
  }
}

/** TrapsRoom's traps by region: one kind fills the room. */
const LEVEL_TRAPS: readonly (readonly TrapKind[])[] = [
  ['gripping', 'teleportation', 'flock'],
  ['poisonDart', 'gripping', 'explosive'],
  ['poisonDart', 'flashing', 'explosive'],
  ['warping', 'flashing', 'disintegration'],
  // The halls, muahahahaha.
  ['grim'],
];

/**
 * TrapsRoom: a floor of revealed traps of one kind (a chasm one time in four), a chest at the far
 * side (on a pedestal two times in three), and a potion of levitation on the floor to cross it.
 */
export class TrapsRoom extends SpecialRoom {
  readonly kind: string = 'TrapsRoom';

  // A bit limited in size, for neither too many nor too few traps.
  override minWidth(): number {
    return 6;
  }
  override maxWidth(): number {
    return 8;
  }
  override minHeight(): number {
    return 6;
  }
  override maxHeight(): number {
    return 8;
  }

  paint(level: GenLevel): void {
    Painter.fill(level, this, T.WALL);

    let trapClass: TrapKind | null;
    switch (Random.Int(4)) {
      case 0:
        trapClass = null;
        break;
      default:
        trapClass = Random.oneOf(...LEVEL_TRAPS[Math.trunc(Dungeon.depth / 5)]!);
        break;
    }

    if (trapClass === null) Painter.fill(level, this, 1, T.CHASM);
    else Painter.fill(level, this, 1, T.TRAP);

    const door = this.entrance();
    door.set(DoorType.REGULAR);

    const lastRow = level.map[this.left + 1 + (this.top + 1) * level.width] === T.CHASM ? T.CHASM : T.EMPTY;

    let x = -1;
    let y = -1;
    if (door.x === this.left) {
      x = this.right - 1;
      y = this.top + Math.trunc(this.height() / 2);
      Painter.fill(level, x, this.top + 1, 1, this.height() - 2, lastRow);
    } else if (door.x === this.right) {
      x = this.left + 1;
      y = this.top + Math.trunc(this.height() / 2);
      Painter.fill(level, x, this.top + 1, 1, this.height() - 2, lastRow);
    } else if (door.y === this.top) {
      x = this.left + Math.trunc(this.width() / 2);
      y = this.bottom - 1;
      Painter.fill(level, this.left + 1, y, this.width() - 2, 1, lastRow);
    } else if (door.y === this.bottom) {
      x = this.left + Math.trunc(this.width() / 2);
      y = this.top + 1;
      Painter.fill(level, this.left + 1, y, this.width() - 2, 1, lastRow);
    }

    for (const p of this.getPoints()) {
      const cell = level.pointToCell(p);
      if (level.map[cell] === T.TRAP) level.setTrap(trapClass!, cell, true);
    }

    const pos = x + y * level.width;
    if (Random.Int(3) === 0) {
      if (lastRow === T.CHASM) Painter.set(level, pos, T.EMPTY);
      level.drop(gearPrize(level, Random.Int(3) !== 0, false), pos).kind = 'chest';
    } else {
      Painter.set(level, pos, T.PEDESTAL);
      level.drop(gearPrize(level, Random.Int(3) !== 0, false), pos).kind = 'chest';
    }

    level.addItemToSpawn(createItem('potion.levitation'));
  }
}
