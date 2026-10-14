import { createItem, type Item } from '../../../../items';
import { T } from '../../../terrain';
import { gate } from '../../builders/builder';
import type { GenLevel } from '../../genlevel';
import { Painter } from '../../painter';
import { Random } from '../../random';
import { type Point, Rect } from '../../rect';
import { type Door, DoorType } from '../../room';
import { newVaultMob, T2_MOBS, VAULT_ROOMS, type VaultLevel, vaultKindOf, vaultOf, setupFlameTrap } from '../../vault-level';
import { laser, VaultRoom } from './vault-rooms';

/*
 * levels/rooms/quest/vault/treasure: the vault's treasure rooms, each behind a single door, each a puzzle
 * to its treasure: a chest of equipment, a consumable (sometimes one that solves a harder room: a
 * stone of blink or a potion of invisibility) and, but for the guarded ones, a dwarf token. Seven of
 * nine are made, the easier first (VaultTreasureRoom.generateRoomList).
 */

const REGULAR = DoorType.REGULAR;
const token = (): Item => createItem('quest.token');

/** VaultTreasureRoom: a single door; nothing placed in it at random. */
export abstract class VaultTreasureRoom extends VaultRoom {
  private entranceDoor: Door | null = null;

  override maxConnections(): number {
    return 1;
  }

  entrance(): Door {
    if (!this.entranceDoor) {
      const first = this.doors()[0];
      if (!first) throw new Error(`${this.kind} has no door`);
      this.entranceDoor = first;
    }
    return this.entranceDoor;
  }

  override canPlaceItem(): boolean {
    return false;
  }

  override canPlaceCharacter(): boolean {
    return false;
  }
}

/** A cell of a rect's points not yet holding anything (the original's do-while on heaps). */
function freeSpot(level: GenLevel, rect: Rect): number {
  let pos: number;
  do {
    pos = level.pointToCell(Random.element(rect.getPoints())!);
  } while (level.heaps.get(pos));
  return pos;
}

/** PathFinder.NEIGHBOURS8 for the level's width, in the original's order. */
const n8 = (level: GenLevel): number[] => level.neighbours8;

/* Tier 1 */

/**
 * VaultFlamePathRoom: three sides of flame vents in waves, a path round them to the treasure at the far
 * end (a tier 1 chest, a T2-solving item or a consumable, a token).
 */
export class VaultFlamePathRoom extends VaultTreasureRoom {
  override readonly kind: string = 'VaultFlamePathRoom';

  paint(level: GenLevel): void {
    const vault = vaultOf(level);
    Painter.fill(level, this, T.WALL);
    const entrance = this.entrance();
    entrance.set(REGULAR);
    const c = this.center();
    const { left, top, right, bottom } = this;
    const leftSide = new Rect(left + 1, top + 1, left + 3, bottom - 1);
    const topSide = new Rect(left + 1, top + 1, right - 1, top + 3);
    const rightSide = new Rect(right - 3, top + 1, right - 1, bottom - 1);
    const bottomSide = new Rect(left + 1, bottom - 3, right - 1, bottom - 1);
    const w = level.width;
    let treasure: Rect;
    if (entrance.x === left) {
      if (entrance.y < c.y) {
        this.fillGroup(level, bottomSide, RIGHT);
        this.fillGroup(level, rightSide, UP);
        this.fillGroup(level, topSide, LEFT);
        Painter.set(level, left + 1 + w * (top + 6), T.EMPTY_SP);
      } else {
        this.fillGroup(level, topSide, RIGHT);
        this.fillGroup(level, rightSide, DOWN);
        this.fillGroup(level, bottomSide, LEFT);
        Painter.set(level, left + 1 + w * (top + 4), T.EMPTY_SP);
      }
      treasure = new Rect(left + 1, top + 5, left + 5, top + 5);
    } else if (entrance.y === top) {
      if (entrance.x < c.x) {
        this.fillGroup(level, rightSide, DOWN);
        this.fillGroup(level, bottomSide, LEFT);
        this.fillGroup(level, leftSide, UP);
        Painter.set(level, left + 6 + w * (top + 1), T.EMPTY_SP);
      } else {
        this.fillGroup(level, leftSide, DOWN);
        this.fillGroup(level, bottomSide, RIGHT);
        this.fillGroup(level, rightSide, UP);
        Painter.set(level, left + 4 + w * (top + 1), T.EMPTY_SP);
      }
      treasure = new Rect(left + 5, top + 1, left + 5, top + 5);
    } else if (entrance.x === right) {
      if (entrance.y < c.y) {
        this.fillGroup(level, bottomSide, LEFT);
        this.fillGroup(level, leftSide, UP);
        this.fillGroup(level, topSide, RIGHT);
        Painter.set(level, right - 1 + w * (top + 6), T.EMPTY_SP);
      } else {
        this.fillGroup(level, topSide, LEFT);
        this.fillGroup(level, leftSide, DOWN);
        this.fillGroup(level, bottomSide, RIGHT);
        Painter.set(level, right - 1 + w * (top + 4), T.EMPTY_SP);
      }
      treasure = new Rect(right - 5, top + 5, right - 1, top + 5);
    } else {
      if (entrance.x < c.x) {
        this.fillGroup(level, rightSide, UP);
        this.fillGroup(level, topSide, LEFT);
        this.fillGroup(level, leftSide, DOWN);
        Painter.set(level, left + 6 + w * (bottom - 1), T.EMPTY_SP);
      } else {
        this.fillGroup(level, leftSide, UP);
        this.fillGroup(level, topSide, RIGHT);
        this.fillGroup(level, rightSide, DOWN);
        Painter.set(level, left + 4 + w * (bottom - 1), T.EMPTY_SP);
      }
      treasure = new Rect(left + 5, bottom - 5, left + 5, bottom - 1);
    }

    Painter.fill(level, treasure.left, treasure.top, treasure.width() + 1, treasure.height() + 1, T.EMPTY_SP);
    let treasurePos = level.pointToCell(Random.element(treasure.getPoints())!);
    level.drop(vault.createEquipment(1), treasurePos).kind = 'chest';
    const solve = vault.findT2SolveItem() ?? vault.createConsumable(1);
    treasurePos = freeSpot(level, treasure);
    level.drop(solve, treasurePos);
    treasurePos = freeSpot(level, treasure);
    level.drop(token(), treasurePos);
  }

  /** A group of flame vents in rows (or columns), each starting at a different offset and moving one way. */
  fillGroup(level: GenLevel, space: Rect, dir: number): void {
    const prior: number[] = [];
    const w = level.width;
    const rollOffset = (): number => {
      let ofs: number;
      do {
        ofs = Random.Int(5);
      } while (prior.includes(ofs));
      return ofs;
    };
    if (dir === LEFT || dir === RIGHT) {
      for (let y = space.top; y <= space.bottom; y++) {
        const ofs = rollOffset();
        let delay = 0;
        if (dir === LEFT) for (let x = space.right; x >= space.left; x--) setupFlameTrap(level, x + w * y, delay++ + ofs, 5, 2);
        else for (let x = space.left; x <= space.right; x++) setupFlameTrap(level, x + w * y, delay++ + ofs, 5, 2);
        prior.push(ofs);
      }
    } else {
      for (let x = space.left; x <= space.right; x++) {
        const ofs = rollOffset();
        let delay = 0;
        if (dir === UP) for (let y = space.bottom; y >= space.top; y--) setupFlameTrap(level, x + w * y, delay++ + ofs, 5, 2);
        else for (let y = space.top; y <= space.bottom; y++) setupFlameTrap(level, x + w * y, delay++ + ofs, 5, 2);
        prior.push(ofs);
      }
    }
  }

  override canConnectPoint(p: Point): boolean {
    const c = this.center();
    return Math.abs(c.x - p.x) > 1 && Math.abs(c.y - p.y) > 1 && super.canConnectPoint(p);
  }
}

/** The direction the flames move in. */
const LEFT = 0;
const UP = 1;
const RIGHT = 2;
const DOWN = 3;

/** The two rows of a laser room (or columns): the sentries that fire, timed down the line, and visual-only ones facing them. */
function laserRows(
  level: GenLevel, along: 'x' | 'y', from: number, to: number, step: 1 | -1, fireRow: number, faceRow: number, dir: number,
  cooldown: (i: number) => number, fields: { afterShotCooldown: number; shotsAfterCooldown?: number },
): void {
  const w = level.width;
  for (let i = from; step > 0 ? i < to : i > to; i += step) {
    const firePos = along === 'x' ? i + w * fireRow : fireRow + w * i;
    level.mobs.push(laser(firePos, { laserDirs: [firePos + dir], curCooldown: cooldown(i), ...fields, giveWarning: false }));
    Painter.set(level, firePos, T.PEDESTAL);
    // The second row is only visual, so as not to do double damage.
    const facePos = along === 'x' ? i + w * faceRow : faceRow + w * i;
    level.mobs.push(laser(facePos, {
      laserDirs: [facePos - dir], curCooldown: MAX_INT, afterShotCooldown: MAX_INT, ...(fields.shotsAfterCooldown !== undefined ? { shotsAfterCooldown: 0 } : {}),
      giveWarning: false,
    }));
    Painter.set(level, facePos, T.PEDESTAL);
  }
}

/** Integer.MAX_VALUE: a sentry that never fires. */
const MAX_INT = 2147483647;

/** VaultLaserTreasureRoom: a hall swept by disintegration rays in a wave; the treasure at its far end. */
export class VaultLaserTreasureRoom extends VaultTreasureRoom {
  override readonly kind: string = 'VaultLaserTreasureRoom';

  paint(level: GenLevel): void {
    const vault = vaultOf(level);
    Painter.fill(level, this, T.WALL);
    const entrance = this.entrance();
    entrance.set(REGULAR);
    const { left, top, right, bottom } = this;
    const w = level.width;
    let itemPlace: Rect;
    const fields = { afterShotCooldown: 3 };
    if (entrance.x === left || entrance.x === right) {
      const areaTop = gate(top + 2, entrance.y - 2, bottom - 6);
      Painter.fill(level, left + 1, areaTop, 9, 5, T.EMPTY);
      if (entrance.x === left) {
        itemPlace = new Rect(right - 1, areaTop, right - 1, areaTop + 4);
        laserRows(level, 'x', right - 2, left + 1, -1, areaTop - 1, areaTop + 5, w, (x) => right - x, fields);
      } else {
        itemPlace = new Rect(left + 1, areaTop, left + 1, areaTop + 4);
        laserRows(level, 'x', left + 2, right - 1, 1, areaTop - 1, areaTop + 5, w, (x) => x - left, fields);
      }
    } else {
      const areaLeft = gate(left + 2, entrance.x - 2, right - 6);
      Painter.fill(level, areaLeft, top + 1, 5, 9, T.EMPTY);
      if (entrance.y === top) {
        itemPlace = new Rect(areaLeft, bottom - 1, areaLeft + 4, bottom - 1);
        laserRows(level, 'y', bottom - 2, top + 1, -1, areaLeft - 1, areaLeft + 5, 1, (y) => bottom - y, fields);
      } else {
        itemPlace = new Rect(areaLeft, top + 1, areaLeft + 4, top + 1);
        laserRows(level, 'y', top + 2, bottom - 1, 1, areaLeft - 1, areaLeft + 5, 1, (y) => y - top, fields);
      }
    }
    Painter.drawInside(level, this, entrance, 1, T.EMPTY);
    placeTreasures(level, vault, itemPlace, 1, () => vault.findT2SolveItem() ?? vault.createConsumable(1), true);
  }
}

/** A chest of a tier's equipment, a second item and (with `withToken`) a token, on free points of a rect. */
function placeTreasures(level: GenLevel, vault: VaultLevel, place: Rect, tier: number, second: () => Item, withToken: boolean): void {
  Painter.fill(level, place.left, place.top, place.width() + 1, place.height() + 1, T.EMPTY_SP);
  let pos = level.pointToCell(Random.element(place.getPoints())!);
  level.drop(vault.createEquipment(tier), pos).kind = 'chest';
  const item = second();
  pos = freeSpot(level, place);
  level.drop(item, pos);
  if (!withToken) return;
  pos = freeSpot(level, place);
  level.drop(token(), pos);
}

/**
 * VaultCircleScanTreasureRoom: a scanning sentry in the middle sweeping round (clockwise or not, away
 * from the door) and the treasure walled into a corner behind two statues.
 */
export class VaultCircleScanTreasureRoom extends VaultTreasureRoom {
  override readonly kind: string = 'VaultCircleScanTreasureRoom';

  paint(level: GenLevel): void {
    const vault = vaultOf(level);
    Painter.fill(level, this, T.WALL);
    Painter.fill(level, this, 2, T.EMPTY);
    Painter.fill(level, this, 4, 1, 4, 1, T.EMPTY);
    Painter.fill(level, this, 1, 4, 1, 4, T.EMPTY);
    const entrance = this.entrance();
    entrance.set(REGULAR);
    Painter.drawInside(level, this, entrance, 3, T.EMPTY);
    const c = this.center();
    let clockwise = true;
    Painter.set(level, c, T.PEDESTAL);
    const { left, top, right, bottom } = this;
    let treasure: Rect;
    if (entrance.x === left) {
      Painter.set(level, c.x + 2, c.y, T.WALL);
      Painter.set(level, c.x + 1, c.y, T.STATUE);
      Painter.set(level, c.x - 1, c.y, T.STATUE);
      treasure = new Rect(left + 1, c.y - 1, c.x - 2, c.y + 1);
      Painter.fill(level, treasure.left, treasure.top, treasure.width() + 1, treasure.height() + 1, T.WALL);
      treasure.right--;
      if (entrance.y < c.y) {
        clockwise = false;
        treasure.top++;
      } else {
        clockwise = true;
        treasure.bottom--;
      }
    } else if (entrance.y === top) {
      Painter.set(level, c.x, c.y + 2, T.WALL);
      Painter.set(level, c.x, c.y + 1, T.STATUE);
      Painter.set(level, c.x, c.y - 1, T.STATUE);
      treasure = new Rect(c.x - 1, top + 1, c.x + 1, top + 3);
      Painter.fill(level, treasure.left, treasure.top, treasure.width() + 1, treasure.height() + 1, T.WALL);
      treasure.bottom--;
      if (entrance.x < c.x) {
        clockwise = true;
        treasure.left++;
      } else {
        clockwise = false;
        treasure.right--;
      }
    } else if (entrance.x === right) {
      Painter.set(level, c.x - 2, c.y, T.WALL);
      Painter.set(level, c.x - 1, c.y, T.STATUE);
      Painter.set(level, c.x + 1, c.y, T.STATUE);
      treasure = new Rect(right - 3, c.y - 1, right - 1, c.y + 1);
      Painter.fill(level, treasure.left, treasure.top, treasure.width() + 1, treasure.height() + 1, T.WALL);
      treasure.left++;
      if (entrance.y < c.y) {
        clockwise = true;
        treasure.top++;
      } else {
        clockwise = false;
        treasure.bottom--;
      }
    } else {
      Painter.set(level, c.x, c.y - 2, T.WALL);
      Painter.set(level, c.x, c.y - 1, T.STATUE);
      Painter.set(level, c.x, c.y + 1, T.STATUE);
      treasure = new Rect(c.x - 1, bottom - 3, c.x + 1, bottom - 1);
      Painter.fill(level, treasure.left, treasure.top, treasure.width() + 1, treasure.height() + 1, T.WALL);
      treasure.top++;
      if (entrance.x < c.x) {
        clockwise = false;
        treasure.left++;
      } else {
        clockwise = true;
        treasure.right--;
      }
    }
    Painter.fill(level, treasure.left, treasure.top, treasure.width() + 1, treasure.height() + 1, T.EMPTY_SP);

    const pos = level.pointToCell(c);
    const w = level.width;
    let scanDirs = [
      [pos - 2], [pos - 2 - w], [pos - 2 - 2 * w], [pos - 1 - 2 * w], [pos - 2 * w], [pos + 1 - 2 * w], [pos + 2 - 2 * w], [pos + 2 - w],
      [pos + 2], [pos + 2 + w], [pos + 2 + 2 * w], [pos + 1 + 2 * w], [pos + 2 * w], [pos - 1 + 2 * w], [pos - 2 + 2 * w], [pos - 2 + w],
    ];
    if (!clockwise) scanDirs = scanDirs.reverse();
    level.mobs.push({
      kind: 'vaultSentry', pos, state: 'passive',
      vault: {
        scanLength: Math.fround(4.49), scanWidth: 45, scanDirs, scanDirIdx: 0, curCooldown: 1, afterScanCooldown: 1,
        scansAfterCooldown: 1, scansMade: 0, giveWarning: false, recentZaps: [],
      },
    });

    let treasurePos = level.pointToCell(Random.element(treasure.getPoints())!);
    level.drop(vault.createEquipment(1), treasurePos).kind = 'chest';
    const solve = vault.findT2SolveItem() ?? vault.createConsumable(1);
    treasurePos = freeSpot(level, treasure);
    level.drop(solve, treasurePos);
    treasurePos = freeSpot(level, treasure);
    level.drop(token(), treasurePos);
  }

  /** No grass to get in the way of seeing. */
  override canPlaceGrass(): boolean {
    return false;
  }

  override canConnectPoint(p: Point): boolean {
    const c = this.center();
    return Math.abs(c.x - p.x) > 1 && Math.abs(c.y - p.y) > 1 && super.canConnectPoint(p);
  }
}

/* Tier 2 */

/** VaultSingleEnemyTreasureRoom: a round room; a tier 2 guard sleeps right in front of the chest. */
export class VaultSingleEnemyTreasureRoom extends VaultTreasureRoom {
  override readonly kind: string = 'VaultSingleEnemyTreasureRoom';

  paint(level: GenLevel): void {
    const vault = vaultOf(level);
    Painter.fill(level, this, T.WALL);
    Painter.fillEllipse(level, this, 3, T.EMPTY);
    Painter.drawInside(level, this, this.entrance(), 3, T.EMPTY);
    // Reflection.newInstance(Random.oneOf(VaultLevel.T2Mobs)).
    const enemy = newVaultMob(vaultKindOf(Random.oneOf(...T2_MOBS) as 'VaultShaman'));
    enemy.spawn.pos = level.pointToCell(this.center());
    vault.addMob(enemy);
    let treasurePos: number;
    const entrance = this.entrance();
    if (entrance.x === this.left) {
      treasurePos = enemy.spawn.pos + 2;
      enemy.spawn.pos += 1;
    } else if (entrance.y === this.top) {
      treasurePos = enemy.spawn.pos + 2 * level.width;
      enemy.spawn.pos += level.width;
    } else if (entrance.x === this.right) {
      treasurePos = enemy.spawn.pos - 2;
      enemy.spawn.pos -= 1;
    } else {
      treasurePos = enemy.spawn.pos - 2 * level.width;
      enemy.spawn.pos -= level.width;
    }
    level.drop(vault.createEquipment(2), treasurePos).kind = 'chest';
    let i: number;
    do {
      i = level.neighbours4[Random.Int(4)]!;
    } while (level.map[treasurePos + i] === T.WALL || treasurePos + i === enemy.spawn.pos);
    level.drop(vault.createConsumable(2), treasurePos + i);
    entrance.set(REGULAR);
  }

  override canPlaceGrass(): boolean {
    return false;
  }

  override canConnectPoint(p: Point): boolean {
    const c = this.center();
    return (Math.abs(c.x - p.x) <= 2 || Math.abs(c.y - p.y) <= 2) && super.canConnectPoint(p);
  }
}

/**
 * VaultBookcaseTreasureRoom: two book-lined alcoves: a prize from the level in the near one, a tier 2
 * chest, a T3-solving item (or a consumable) and a token in the far one. A potion of liquid flame lies
 * about the level, for the books.
 */
export class VaultBookcaseTreasureRoom extends VaultTreasureRoom {
  override readonly kind: string = 'VaultBookcaseTreasureRoom';

  paint(level: GenLevel): void {
    const vault = vaultOf(level);
    Painter.fill(level, this, T.WALL);
    const entrance = this.entrance();
    entrance.set(REGULAR);
    const { left, top, right, bottom } = this;
    const w = level.width;
    let firstItem: number;
    let secondItem: number;
    if (entrance.x === left || entrance.x === right) {
      const bookTop = gate(top + 1, entrance.y - 2, bottom - 5);
      Painter.fill(level, left + 1, bookTop, 9, 5, T.BOOKSHELF);
      Painter.fill(level, left + 2, bookTop + 1, 3, 3, T.EMPTY_SP);
      Painter.fill(level, left + 6, bookTop + 1, 3, 3, T.EMPTY_SP);
      if (entrance.x === left) {
        firstItem = left + 3 + w * (bookTop + 2);
        secondItem = right - 3 + w * (bookTop + 2);
      } else {
        firstItem = right - 3 + w * (bookTop + 2);
        secondItem = left + 3 + w * (bookTop + 2);
      }
    } else {
      const bookLeft = gate(left + 1, entrance.x - 2, right - 5);
      Painter.fill(level, bookLeft, top + 1, 5, 9, T.BOOKSHELF);
      Painter.fill(level, bookLeft + 1, top + 2, 3, 3, T.EMPTY_SP);
      Painter.fill(level, bookLeft + 1, top + 6, 3, 3, T.EMPTY_SP);
      if (entrance.y === top) {
        firstItem = bookLeft + 2 + w * (top + 3);
        secondItem = bookLeft + 2 + w * (bottom - 3);
      } else {
        firstItem = bookLeft + 2 + w * (bottom - 3);
        secondItem = bookLeft + 2 + w * (top + 3);
      }
    }
    Painter.set(level, firstItem, T.PEDESTAL);
    Painter.set(level, secondItem, T.PEDESTAL);
    const prize = level.findPrizeItem();
    if (prize) level.drop(prize, firstItem);
    level.drop(vault.createEquipment(2), secondItem).kind = 'chest';
    const solve = vault.findT3SolveItem() ?? vault.createConsumable(2);
    level.drop(solve, secondItem + n8(level)[Random.Int(8)]!);
    level.drop(token(), secondItem + n8(level)[Random.Int(8)]!);
    level.addItemToSpawn(createItem('potion.liquidFlame'));
    Painter.drawInside(level, this, entrance, 2, T.EMPTY_SP);
  }
}

/**
 * VaultFlamesTreasureRoom: a round room of flame vents all firing together, the treasure on three pedestals
 * across from the door. A potion of purity lies about the level.
 */
export class VaultFlamesTreasureRoom extends VaultTreasureRoom {
  override readonly kind: string = 'VaultFlamesTreasureRoom';

  paint(level: GenLevel): void {
    const vault = vaultOf(level);
    Painter.fill(level, this, T.WALL);
    Painter.fillEllipse(level, this, 2, T.EMPTY);
    const c = this.center();
    const w = level.width;
    const cc = level.pointToCell(c);
    const positions = [cc - 3 * w, cc + 3, cc + 3 * w, cc - 3, cc - 3 * w, cc + 3];
    const entrance = this.entrance();
    const idx = entrance.x === this.left ? 1 : entrance.y === this.top ? 2 : entrance.x === this.right ? 3 : 4;
    Painter.set(level, positions[idx - 1]!, T.PEDESTAL);
    Painter.set(level, positions[idx]!, T.PEDESTAL);
    Painter.set(level, positions[idx + 1]!, T.PEDESTAL);
    level.drop(vault.createEquipment(2), positions[idx]!).kind = 'chest';
    for (let x = this.left + 2; x <= this.right - 2; x++) {
      for (let y = this.top + 2; y <= this.bottom - 2; y++) {
        if (level.map[x + w * y] === T.EMPTY) setupFlameTrap(level, x + w * y, 1, 1, 1);
      }
    }
    if (Math.abs(c.x - entrance.x) <= 1 || Math.abs(c.y - entrance.y) <= 1) Painter.drawInside(level, this, entrance, 1, T.EMPTY);
    else Painter.drawInside(level, this, entrance, 2, T.EMPTY);
    const solve = vault.findT3SolveItem() ?? vault.createConsumable(2);
    if (Random.Int(2) === 0) {
      level.drop(solve, positions[idx - 1]!);
      level.drop(token(), positions[idx + 1]!);
    } else {
      level.drop(token(), positions[idx - 1]!);
      level.drop(solve, positions[idx + 1]!);
    }
    level.addItemToSpawn(createItem('potion.purity'));
    entrance.set(REGULAR);
  }

  override canPlaceGrass(): boolean {
    return false;
  }

  override canConnectPoint(p: Point): boolean {
    const c = this.center();
    return (Math.abs(c.x - p.x) <= 2 || Math.abs(c.y - p.y) <= 2) && super.canConnectPoint(p);
  }
}

/* Tier 3 */

/**
 * VaultManyScansRoom: scanning sentries in its corners and sides, all looking at the middle, where a
 * tier 3 chest, a consumable and a token lie. A potion of invisibility lies about the level.
 */
export class VaultManyScansRoom extends VaultTreasureRoom {
  override readonly kind: string = 'VaultManyScansRoom';

  paint(level: GenLevel): void {
    const vault = vaultOf(level);
    Painter.fill(level, this, T.WALL);
    Painter.fill(level, this, 1, T.EMPTY_SP);
    const w = level.width;
    const c = this.center();
    const { left, top, right, bottom } = this;
    const corners = [
      left + 1 + w * (top + 1), c.x + w * (top + 1), right - 1 + w * (top + 1),
      left + 1 + w * c.y, right - 1 + w * c.y,
      left + 1 + w * (bottom - 1), c.x + w * (bottom - 1), right - 1 + w * (bottom - 1),
    ];
    const entrance = this.entrance();
    entrance.set(REGULAR);
    const middle = c.x + w * c.y;
    for (const cell of corners) {
      if (level.trueDistance(cell, level.pointToCell(entrance)) >= 2) {
        level.mobs.push({
          kind: 'vaultSentry', pos: cell, state: 'passive',
          vault: {
            scanLength: 7, scanWidth: 70, scanDirs: [[middle]], scanDirIdx: 0, curCooldown: 1, afterScanCooldown: 1, scansAfterCooldown: 1,
            scansMade: 0, giveWarning: false, recentZaps: [],
          },
        });
      }
    }
    Painter.set(level, c, T.PEDESTAL);
    level.drop(vault.createEquipment(3), middle).kind = 'chest';
    level.drop(vault.createConsumable(3), middle + n8(level)[Random.Int(8)]!);
    level.drop(token(), middle + n8(level)[Random.Int(8)]!);
    level.addItemToSpawn(createItem('potion.invisibility'));
  }
}

/**
 * VaultMultipleEnemyTreasureRoom: a cross of floor with three ghouls, two of them dropping no token, the
 * third right before the tier 3 chest.
 */
export class VaultMultipleEnemyTreasureRoom extends VaultTreasureRoom {
  override readonly kind: string = 'VaultMultipleEnemyTreasureRoom';

  paint(level: GenLevel): void {
    const vault = vaultOf(level);
    Painter.fill(level, this, T.WALL);
    const entrance = this.entrance();
    entrance.set(REGULAR);
    const c = this.center();
    const { left, top, right, bottom } = this;
    const w = level.width;
    const ghoul = (pos: number, noToken: boolean): void => {
      const mob = newVaultMob('vaultGhoul');
      if (noToken) mob.spawn.vault.maxLvl = 0;
      mob.spawn.pos = pos;
      vault.addMob(mob);
    };
    let treasurePos: number;
    if (entrance.x === left || entrance.x === right) {
      const areaTop = gate(top + 1, entrance.y - 2, bottom - 5);
      Painter.fill(level, left + 1, areaTop + 1, 9, 3, T.EMPTY_SP);
      Painter.fill(level, left + 4, areaTop, 3, 5, T.EMPTY_SP);
      ghoul(c.x + areaTop * w, true);
      ghoul(c.x + (areaTop + 4) * w, true);
      let pos: number;
      if (entrance.x === left) {
        pos = c.x + 1 + (areaTop + 2) * w;
        treasurePos = pos + 2;
      } else {
        pos = c.x - 1 + (areaTop + 2) * w;
        treasurePos = pos - 2;
      }
      ghoul(pos, false);
    } else {
      const areaLeft = gate(left + 1, entrance.x - 2, right - 5);
      Painter.fill(level, areaLeft + 1, top + 1, 3, 9, T.EMPTY_SP);
      Painter.fill(level, areaLeft, top + 4, 5, 3, T.EMPTY_SP);
      ghoul(areaLeft + c.y * w, true);
      ghoul(areaLeft + 4 + c.y * w, true);
      let pos: number;
      if (entrance.y === top) {
        pos = areaLeft + 2 + (c.y + 1) * w;
        treasurePos = pos + 2 * w;
      } else {
        pos = areaLeft + 2 + (c.y - 1) * w;
        treasurePos = pos - 2 * w;
      }
      ghoul(pos, false);
    }
    Painter.set(level, treasurePos, T.PEDESTAL);
    level.drop(vault.createEquipment(3), treasurePos).kind = 'chest';
    let i: number;
    do {
      i = n8(level)[Random.Int(8)]!;
    } while (level.map[treasurePos + i] === T.WALL);
    level.drop(vault.createConsumable(3), treasurePos + i);
  }

  override canConnectPoint(p: Point): boolean {
    const c = this.center();
    return (Math.abs(c.x - p.x) <= 3 || Math.abs(c.y - p.y) <= 3) && super.canConnectPoint(p);
  }
}

/** VaultHardLaserTreasureRoom: rays that fire six turns running, in a fast wave; a stone of blink lies about the level. */
export class VaultHardLaserTreasureRoom extends VaultTreasureRoom {
  override readonly kind: string = 'VaultHardLaserTreasureRoom';

  paint(level: GenLevel): void {
    const vault = vaultOf(level);
    Painter.fill(level, this, T.WALL);
    const entrance = this.entrance();
    entrance.set(REGULAR);
    const { left, top, right, bottom } = this;
    const w = level.width;
    let itemPlace: Rect;
    const fields = { afterShotCooldown: 2, shotsAfterCooldown: 6 };
    if (entrance.x === left || entrance.x === right) {
      const areaTop = gate(top + 1, entrance.y - 2, bottom - 5);
      Painter.fill(level, left + 1, areaTop, 9, 5, T.EMPTY_SP);
      if (entrance.x === left) {
        itemPlace = new Rect(right - 1, areaTop, right - 1, areaTop + 4);
        laserRows(level, 'x', right - 2, left + 1, -1, areaTop, areaTop + 4, w, (x) => right - x, fields);
      } else {
        itemPlace = new Rect(left + 1, areaTop, left + 1, areaTop + 4);
        laserRows(level, 'x', left + 2, right - 1, 1, areaTop, areaTop + 4, w, (x) => x - left, fields);
      }
    } else {
      const areaLeft = gate(left + 1, entrance.x - 2, right - 5);
      Painter.fill(level, areaLeft, top + 1, 5, 9, T.EMPTY_SP);
      if (entrance.y === top) {
        itemPlace = new Rect(areaLeft, bottom - 1, areaLeft + 4, bottom - 1);
        laserRows(level, 'y', bottom - 2, top + 1, -1, areaLeft, areaLeft + 4, 1, (y) => bottom - y, fields);
      } else {
        itemPlace = new Rect(areaLeft, top + 1, areaLeft + 4, top + 1);
        laserRows(level, 'y', top + 2, bottom - 1, 1, areaLeft, areaLeft + 4, 1, (y) => y - top, fields);
      }
    }
    placeTreasures(level, vault, itemPlace, 3, () => vault.createConsumable(3), true);
    vault.addBlinkStone();
  }
}

/* VaultTreasureRoom.generateRoomList and nextRoom */

const T1_ROOMS = [() => new VaultFlamePathRoom(), () => new VaultLaserTreasureRoom(), () => new VaultCircleScanTreasureRoom()];
const T2_ROOMS = [() => new VaultSingleEnemyTreasureRoom(), () => new VaultBookcaseTreasureRoom(), () => new VaultFlamesTreasureRoom()];
const T3_ROOMS = [() => new VaultManyScansRoom(), () => new VaultMultipleEnemyTreasureRoom(), () => new VaultHardLaserTreasureRoom()];

let treasuresToSpawn: Array<() => VaultTreasureRoom> = [];

/** VaultTreasureRoom.generateRoomList: each tier shuffled, then dealt one of each tier in turn, the easier first. */
export function generateTreasureList(): void {
  const t1 = [...T1_ROOMS];
  Random.shuffle(t1);
  const t2 = [...T2_ROOMS];
  Random.shuffle(t2);
  const t3 = [...T3_ROOMS];
  Random.shuffle(t3);
  const full = [t1, t2, t3];
  treasuresToSpawn = [];
  while (full.length > 0) {
    const current = full.shift()!;
    treasuresToSpawn.push(current.shift()!);
    if (current.length > 0) full.push(current);
  }
}

export function nextTreasureRoom(): VaultTreasureRoom {
  return treasuresToSpawn.shift()!();
}

VAULT_ROOMS.generateTreasureList = generateTreasureList;
VAULT_ROOMS.nextTreasure = nextTreasureRoom;
