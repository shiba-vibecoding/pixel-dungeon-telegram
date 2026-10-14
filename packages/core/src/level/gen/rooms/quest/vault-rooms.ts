import type { HeroClass } from '../../../../actors';
import { staffWith } from '../../../../staff';
import { createItem, type Item, randomEnchantment, randomGlyph, wandMaxCharges } from '../../../../items';
import type { VaultMob } from '../../../../vault-types';
import { T } from '../../../terrain';
import { Carpet, customTile, mapSimpleImage } from '../../custom';
import { Dungeon } from '../../dungeon';
import type { GenLevel, MobSpawn } from '../../genlevel';
import { Painter } from '../../painter';
import { Random } from '../../random';
import { Point } from '../../rect';
import { DoorType, type Room } from '../../room';
import { StandardRoom } from '../standard/standard';
import { DARKNESS } from '../../../../challenges';
import {
  isEquipable, isLarge, mobTier, setupFlameTrap, setWander, T1_MOBS, T2_MOBS, T3_MOBS, type VaultGenMob, VAULT_ROOMS, vaultOf,
} from '../../vault-level';

/*
 * levels/rooms/quest/vault: the dwarven vault's rooms. VaultRoom is always 11x11 (9x9 inside) and never
 * merges; VaultLongRoom twice that one way. The entry room has the vault beacons and the way back up;
 * the tokens room the strange door, the mirror behind it and a guard on its rounds; the others guards
 * on their rounds (Mob.setupStealthGameplayWanderPositions), scanning sentries, disintegration
 * sentries and flame vents, with treasure here and there.
 */

/** Room.Door.Type.REGULAR. */
const REGULAR = DoorType.REGULAR;

/** VaultRoom: a large room, always 11x11 with its walls; never merged. */
export abstract class VaultRoom extends StandardRoom {
  override sizeCatProbs(): number[] {
    return [0, 1, 0];
  }
  override minHeight(): number {
    return 11;
  }
  override maxHeight(): number {
    return 11;
  }
  override minWidth(): number {
    return 11;
  }
  override maxWidth(): number {
    return 11;
  }
  override canMerge(): boolean {
    return false;
  }
  override sizeFactor(): number {
    return 1;
  }

  /** Whether one of the rooms joined to this one is the entry (only tier 1 guards there). */
  nextToEntry(): boolean {
    for (const r of this.connected.keys()) if (r.isEntrance()) return true;
    return false;
  }
}

/** VaultLongRoom: 21x11 or 11x21, counting as two rooms. */
export abstract class VaultLongRoom extends VaultRoom {
  /** Only used while it has no size yet; after that, its width and height say. */
  private readonly wideRoll = Random.Int(2) === 0;

  protected wide(): boolean {
    return this.width() === this.height() ? this.wideRoll : this.width() > this.height();
  }
  override minWidth(): number {
    return this.wide() ? 21 : 11;
  }
  override maxWidth(): number {
    return this.minWidth();
  }
  override minHeight(): number {
    return this.wide() ? 11 : 21;
  }
  override maxHeight(): number {
    return this.minHeight();
  }
  override sizeFactor(): number {
    return 2;
  }
}

/* The guards (Mob, VaultLevel.createMob) */

/** A guard for a room: from the rotation, any refused (and given back) until one fits. */
function guard(level: GenLevel, ok: (mob: VaultGenMob) => boolean): VaultGenMob {
  const vault = vaultOf(level);
  const toReturn: VaultGenMob['cls'][] = [];
  let enemy: VaultGenMob;
  for (;;) {
    enemy = vault.createMob();
    if (ok(enemy)) break;
    toReturn.push(enemy.cls);
  }
  for (const cls of toReturn) vault.returnMob(cls);
  return enemy;
}

/** Next to the entry room only the vault's tier 1 guards (skeletons and DM-100s). */
const tierOneNear = (room: VaultRoom) => (mob: VaultGenMob): boolean =>
  !room.nextToEntry() || mob.cls === 'VaultSkeleton' || mob.cls === 'VaultDM100';

function wander(mob: VaultGenMob, pos: number, positions: number[], idx: number): void {
  mob.spawn.pos = pos;
  setWander(mob, positions, idx);
  mob.spawn.state = 'wandering';
}

/** new VaultSentry(): scanning every turn by default, no warning. */
function sentry(pos: number, fields: VaultMob): MobSpawn {
  return {
    kind: 'vaultSentry', pos, state: 'passive',
    vault: { scanDirIdx: 0, curCooldown: 1, afterScanCooldown: 1, scansAfterCooldown: 1, scansMade: 0, giveWarning: false, recentZaps: [], ...fields },
  };
}

/** new VaultLaser(): one shot after its cooldown, warning a turn ahead by default. */
export function laser(pos: number, fields: VaultMob): MobSpawn {
  return {
    kind: 'vaultLaser', pos, state: 'passive',
    vault: { laserDirIdx: 0, curCooldown: 0, afterShotCooldown: 0, shotsAfterCooldown: 1, shotsFired: 0, giveWarning: true, ...fields },
  };
}

/* VaultEntranceRoom */

/** The vault's own region decorations for walls with banners (AmbitiousImpRoom.WallBanners, drawn as the map says: vault-tiles.ts). */
export function wallBanners(x: number, y: number): ReturnType<typeof customTile> {
  return { kind: 'WallBanners', texture: 'city_quest', x, y, w: 7, h: 3 };
}

/**
 * VaultEntranceRoom: the platform the imp's spell lands on (the way back up, through the escape
 * crystal), carpets, two vault beacons (and a torch in the dark) on the side farthest from the doors.
 */
export class VaultEntranceRoom extends VaultRoom {
  override readonly kind: string = 'VaultEntranceRoom';

  paint(level: GenLevel): void {
    Painter.fill(level, this, T.WALL);
    Painter.fill(level, this, 2, T.EMPTY);
    const c = this.center();
    Painter.set(level, c.x - 3, c.y - 3, T.WALL);
    Painter.set(level, c.x + 3, c.y - 3, T.WALL);
    Painter.set(level, c.x - 3, c.y + 3, T.WALL);
    Painter.set(level, c.x + 3, c.y + 3, T.WALL);
    for (const door of this.doors()) {
      door.set(REGULAR);
      Painter.drawInside(level, this, door, 3, T.EMPTY);
    }
    Painter.set(level, c.x - 2, c.y - 2, T.REGION_DECO);
    Painter.set(level, c.x + 2, c.y - 2, T.REGION_DECO);
    Painter.set(level, c.x - 2, c.y + 2, T.REGION_DECO);
    Painter.set(level, c.x + 2, c.y + 2, T.REGION_DECO);

    Painter.fill(level, this.left + 2, this.top + 4, 7, 3, T.CUSTOM_DECO_EMPTY);
    Painter.fill(level, this.left + 4, this.top + 2, 3, 7, T.CUSTOM_DECO_EMPTY);
    level.customTiles.push(new Carpet().setRect(this.left + 2, this.top + 4, 7, 3).toCustomTile());
    level.customTiles.push(new Carpet().setRect(this.left + 4, this.top + 2, 3, 7).toCustomTile());
    // QuestEntranceInternal: the platform.
    level.customTiles.push(customTile('QuestEntranceInternal', 'city_quest', c.x - 1, c.y - 1, 3, 3, mapSimpleImage(8, 1, 256, 3, 3)));
    level.customTiles.push(wallBanners(this.left + 2, this.top + 1));

    const candidates = [new Point(this.left + 2, c.y), new Point(this.right - 2, c.y), new Point(c.x, this.top + 2), new Point(c.x, this.bottom - 2)];
    let furthest: Point | null = null;
    let furthestDist = 0;
    for (const p of candidates) {
      let dist = 0;
      for (const d of this.doors()) dist = Math.fround(dist + Point.distance(p, d));
      if (!furthest || dist > furthestDist) {
        furthest = p;
        furthestDist = dist;
      }
    }
    // (The pedestals are disabled in the original: they did not suit the carpet.)
    const ofs = furthest!.x === c.x ? 1 : level.width;
    const at = level.pointToCell(furthest!);
    const addTorch = Dungeon.isChallenged(DARKNESS);
    const beacon = (): Item => createItem('quest.vaultBeacon');
    switch (Random.Int(3)) {
      case 0:
        if (addTorch) level.drop(createItem('torch'), at - ofs);
        level.drop(beacon(), at);
        level.drop(beacon(), at + ofs);
        break;
      case 1:
        level.drop(beacon(), at - ofs);
        if (addTorch) level.drop(createItem('torch'), at);
        level.drop(beacon(), at + ofs);
        break;
      case 2:
        level.drop(beacon(), at - ofs);
        level.drop(beacon(), at);
        if (addTorch) level.drop(createItem('torch'), at + ofs);
        break;
    }

    const entrance = level.pointToCell(this.center());
    level.addTransition(entrance, 'branchEntrance', { depth: Dungeon.depth, branch: 0, type: 'branchExit' });
  }

  override isEntrance(): boolean {
    return true;
  }

  override canConnectPoint(p: Point): boolean {
    return (p.x > this.left + 1 && p.x < this.right - 1) || (p.y > this.top + 1 && p.y < this.bottom - 1);
  }
}

/* VaultTokensRoom and its mirror */

/**
 * VaultMirror.createReward: the hero class's own item, better (on a stream of its own, as some classes
 * draw and some do not). SEAM(gear/wands/artifacts): the warrior's broken seal +1 with a glyph; the
 * mage's staff +3 (magic missile), enchanted; the rogue's cloak of shadows +8; the huntress's spirit bow, enchanted. The
 * seal, the cloak and the bow are one of a kind (Item.unique): never taken out of the vault; the staff's
 * wand may be (EscapeCrystal).
 */
export function mirrorReward(heroClass: HeroClass): Item {
  Random.pushGenerator(Random.Long());
  try {
    let reward: Item;
    switch (heroClass) {
      case 'warrior':
        reward = { ...createItem('seal'), level: 1, glyph: randomGlyph(Random.rng) };
        break;
      case 'mage':
        // A mage's staff +3, its wand of magic missile, enchanted.
        reward = staffWith(createItem('wand.magicMissile', 1, 3));
        reward.level = 3;
        reward.enchant = randomEnchantment(Random.rng);
        break;
      case 'rogue':
        reward = { ...createItem('artifact.cloak', 1, 8), unique: true };
        break;
      case 'huntress':
        reward = { ...createItem('spiritBow'), enchant: randomEnchantment(Random.rng), unique: true };
        break;
    }
    return reward;
  } finally {
    Random.popGenerator();
  }
}

/** VaultTokensRoom.TokenDoorFloor: special flooring under the strange door (vault-tiles.ts: as the map says). */
const tokenDoorFloor = (x: number, y: number): ReturnType<typeof customTile> => ({ kind: 'TokenDoorFloor', texture: 'city_quest', x, y, w: 1, h: 1 });

/**
 * VaultTokensRoom: a long room around a diamond vault behind the strange door (ten dwarf tokens open it),
 * with the strange mirror and the best equipment and consumable; a guard walks its four corners.
 * At least two rooms between it and the entry.
 */
export class VaultTokensRoom extends VaultLongRoom {
  override readonly kind: string = 'VaultTokensRoom';

  paint(level: GenLevel): void {
    const vault = vaultOf(level);
    Painter.fill(level, this, T.WALL);
    const c = this.center();
    if (this.wide()) {
      let leftDoor = 0;
      let rightDoor = 0;
      for (const d of this.doors()) {
        if (d.x < c.x) {
          leftDoor = 1;
          Painter.fill(level, this.left + 1, this.top + 1, Math.trunc((this.width() - 2) / 2), this.height() - 2, T.EMPTY);
        } else {
          rightDoor = 1;
          Painter.fill(level, c.x + 1, this.top + 1, Math.trunc((this.width() - 2) / 2), this.height() - 2, T.EMPTY);
        }
      }
      Painter.fillDiamond(level, this.left + 3, this.top + 1, 9, 9, T.WALL);
      Painter.fillDiamond(level, this.left + 9, this.top + 1, 9, 9, T.WALL);
      Painter.fillDiamond(level, this.left + 5, this.top + 1, 9, 9, T.EMPTY_SP);
      Painter.fillDiamond(level, this.left + 7, this.top + 1, 9, 9, T.EMPTY_SP);
      Painter.fill(level, this.left + 4 - leftDoor, c.y, 13 + leftDoor + rightDoor, 1, T.EMPTY);
      Painter.fill(level, this.left + 4, c.y, 13, 1, T.EMPTY_SP);
    } else {
      let topDoor = 0;
      let bottomDoor = 0;
      for (const d of this.doors()) {
        if (d.y < c.y) {
          topDoor = 1;
          Painter.fill(level, this.left + 1, this.top + 1, this.width() - 2, Math.trunc((this.height() - 2) / 2), T.EMPTY);
        } else {
          bottomDoor = 1;
          Painter.fill(level, this.left + 1, c.y + 1, this.width() - 2, Math.trunc((this.height() - 2) / 2), T.EMPTY);
        }
      }
      Painter.fillDiamond(level, this.left + 1, this.top + 3, 9, 9, T.WALL);
      Painter.fillDiamond(level, this.left + 1, this.top + 9, 9, 9, T.WALL);
      Painter.fillDiamond(level, this.left + 1, this.top + 5, 9, 9, T.EMPTY_SP);
      Painter.fillDiamond(level, this.left + 1, this.top + 7, 9, 9, T.EMPTY_SP);
      Painter.fill(level, c.x, this.top + 4 - topDoor, 1, 13 + topDoor + bottomDoor, T.EMPTY);
      Painter.fill(level, c.x, this.top + 4, 1, 13, T.EMPTY_SP);
    }

    Painter.fillDiamond(level, c.x - 3, c.y - 3, 7, 7, T.WALL);
    Painter.fill(level, c.x - 1, c.y - 1, 3, 3, T.EMPTY_SP);
    Painter.fill(level, c.x - 2, c.y, 5, 1, T.EMPTY_SP);
    Painter.fill(level, c.x, c.y - 1, 1, 5, T.EMPTY_SP);
    Painter.set(level, c.x - 1, c.y - 1, T.REGION_DECO_ALT);
    Painter.set(level, c.x + 1, c.y - 1, T.REGION_DECO_ALT);

    const carpet = new Carpet().setRect(c.x - 1, c.y - 1, 3, 3);
    carpet.overrideTile(0, 0, Carpet.CITY_PEDESTAL_TL);
    carpet.overrideTile(2, 0, Carpet.CITY_PEDESTAL_TR);
    level.customTiles.push(carpet.toCustomTile());

    // The strange door, and the floor beneath it.
    Painter.set(level, c.x, c.y + 3, T.LOCKED_DOOR);
    const doorPos = c.x + (c.y + 3) * level.width;
    level.mobs.push({ kind: 'vaultTokenDoor', pos: doorPos, state: 'passive' });
    level.customTiles.push(tokenDoorFloor(c.x, c.y + 3));

    // The strange mirror, holding the hero class's item.
    const heroClass = Dungeon.world?.heroes[0]?.heroClass ?? 'warrior';
    const reward = mirrorReward(heroClass);
    level.mobs.push({ kind: 'vaultMirror', pos: c.x + (c.y - 1) * level.width, state: 'passive', vault: { reward } });

    if (Random.Int(2) === 0) {
      level.drop(vault.createEquipment(3), c.x - 2 + c.y * level.width);
      level.drop(vault.createConsumable(3), c.x + 2 + c.y * level.width);
    } else {
      level.drop(vault.createEquipment(3), c.x + 2 + c.y * level.width);
      level.drop(vault.createConsumable(3), c.x - 2 + c.y * level.width);
    }

    // A guard on the vault's four corners (no room for a large one).
    const enemy = guard(level, (mob) => !isLarge(mob));
    // (Both orders are the same in the original.)
    Random.Int(2);
    const positions = [
      level.pointToCell(new Point(c.x - 4, c.y)),
      level.pointToCell(new Point(c.x, c.y - 4)),
      level.pointToCell(new Point(c.x + 4, c.y)),
      level.pointToCell(new Point(c.x, c.y + 4)),
    ];
    const idx = Random.Int(4);
    wander(enemy, positions[idx]!, positions, idx);
    vault.addMob(enemy);
  }

  override canConnectPoint(p: Point): boolean {
    if (!super.canConnectPoint(p)) return false;
    return this.wide() ? p.x < this.left + 5 || p.x > this.right - 5 : p.y < this.top + 5 || p.y > this.bottom - 5;
  }

  override canConnect(r: Room): boolean {
    if (r.isEntrance()) return false;
    // At least two rooms between it and the entry room.
    for (const r1 of r.connected.keys()) {
      if (r1.isEntrance()) return false;
      for (const r2 of r1.connected.keys()) if (r2.isEntrance()) return false;
    }
    return super.canConnect(r);
  }

  override canPlaceItem(p: Point, l: GenLevel): boolean {
    return super.canPlaceItem(p, l) && l.map[l.pointToCell(p)] !== T.EMPTY_SP;
  }

  override canPlaceCharacter(p: Point, l: GenLevel): boolean {
    // No random placement in the inner vault.
    return super.canPlaceCharacter(p, l) && l.map[l.pointToCell(p)] !== T.EMPTY_SP;
  }
}

/** VaultSimpleEnemyTreasureRoom: a guard (tier 2 or 3) asleep in a walled corner, beside a chest. */
export class VaultSimpleEnemyTreasureRoom extends VaultRoom {
  override readonly kind: string = 'VaultSimpleEnemyTreasureRoom';

  paint(level: GenLevel): void {
    const vault = vaultOf(level);
    Painter.fill(level, this, T.WALL);
    Painter.fill(level, this, 1, T.EMPTY);
    let enemyPos = 0;
    let treasurePos = 0;
    const { left, top, right, bottom } = this;
    switch (Random.Int(4)) {
      case 0:
        Painter.fill(level, left + 2, top + 2, 6, 6, T.WALL);
        Painter.fill(level, left + 3, top + 3, 4, 4, T.EMPTY_SP);
        Painter.fill(level, left + 4, top + 7, 2, 1, T.EMPTY_SP);
        Painter.fill(level, left + 7, top + 4, 1, 2, T.EMPTY_SP);
        enemyPos = level.pointToCell(new Point(left + 4, top + 4));
        treasurePos = level.pointToCell(new Point(left + 3, top + 3));
        break;
      case 1:
        Painter.fill(level, left + 3, top + 2, 6, 6, T.WALL);
        Painter.fill(level, left + 4, top + 3, 4, 4, T.EMPTY_SP);
        Painter.fill(level, left + 5, top + 7, 2, 1, T.EMPTY_SP);
        Painter.fill(level, left + 3, top + 4, 1, 2, T.EMPTY_SP);
        enemyPos = level.pointToCell(new Point(right - 4, top + 4));
        treasurePos = level.pointToCell(new Point(right - 3, top + 3));
        break;
      case 2:
        Painter.fill(level, left + 3, top + 3, 6, 6, T.WALL);
        Painter.fill(level, left + 4, top + 4, 4, 4, T.EMPTY_SP);
        Painter.fill(level, left + 5, top + 3, 2, 1, T.EMPTY_SP);
        Painter.fill(level, left + 3, top + 5, 1, 2, T.EMPTY_SP);
        enemyPos = level.pointToCell(new Point(right - 4, bottom - 4));
        treasurePos = level.pointToCell(new Point(right - 3, bottom - 3));
        break;
      case 3:
        Painter.fill(level, left + 2, top + 3, 6, 6, T.WALL);
        Painter.fill(level, left + 3, top + 4, 4, 4, T.EMPTY_SP);
        Painter.fill(level, left + 4, top + 3, 2, 1, T.EMPTY_SP);
        Painter.fill(level, left + 7, top + 5, 1, 2, T.EMPTY_SP);
        enemyPos = level.pointToCell(new Point(left + 4, bottom - 4));
        treasurePos = level.pointToCell(new Point(left + 3, bottom - 3));
        break;
    }
    // No tier 1 guards: tier 2 and up.
    const enemy = guard(level, (mob) => !T1_MOBS.includes(mob.cls));
    let tier = 2;
    if (T2_MOBS.includes(enemy.cls)) tier = 2;
    if (T3_MOBS.includes(enemy.cls)) tier = 3;
    if (enemy.cls === 'VaultElemental') tier = 3;
    level.drop(vault.createEquipment(tier), treasurePos).kind = 'chest';
    for (const door of this.doors()) door.set(REGULAR);
    enemy.spawn.pos = enemyPos;
    vault.addMob(enemy);
  }

  /** No random items in the middle. */
  override canPlaceItem(p: Point, l: GenLevel): boolean {
    const c = this.center();
    if (Math.abs(c.x - p.x) <= 2) return false;
    if (Math.abs(c.y - p.y) <= 2) return false;
    return super.canPlaceItem(p, l);
  }
}

/** VaultRingRoom: a ring of floor round a solid middle; a guard goes round it. */
export class VaultRingRoom extends VaultRoom {
  override readonly kind: string = 'VaultRingRoom';

  paint(level: GenLevel): void {
    const vault = vaultOf(level);
    Painter.fill(level, this, T.WALL);
    Painter.fill(level, this, 1, T.EMPTY);
    Painter.fill(level, this, 4, T.WALL);
    for (const door of this.doors()) door.set(REGULAR);
    const enemy = guard(level, tierOneNear(this));
    const { left, top, right, bottom } = this;
    const positions = Random.Int(2) === 0
      ? [new Point(left + 2, top + 2), new Point(right - 2, top + 2), new Point(right - 2, bottom - 2), new Point(left + 2, bottom - 2)]
      : [new Point(left + 2, bottom - 2), new Point(right - 2, bottom - 2), new Point(right - 2, top + 2), new Point(left + 2, top + 2)];
    const cells = positions.map((p) => level.pointToCell(p));
    const idx = Random.Int(4);
    wander(enemy, cells[idx]!, cells, idx);
    vault.addMob(enemy);
  }
}

/** VaultCrossRoom: a cross of floor; a scanning sentry on a pedestal in the middle looks down each arm in turn. */
export class VaultCrossRoom extends VaultRoom {
  override readonly kind: string = 'VaultCrossRoom';

  paint(level: GenLevel): void {
    Painter.fill(level, this, T.WALL);
    Painter.fill(level, this, 4, 1, 4, 1, T.EMPTY);
    Painter.fill(level, this, 1, 4, 1, 4, T.EMPTY);
    Painter.set(level, this.center(), T.PEDESTAL);
    const pos = level.pointToCell(this.center());
    level.mobs.push(sentry(pos, {
      scanLength: 4, scanWidth: 90, afterScanCooldown: 3,
      scanDirs: [[pos - 1], [pos - level.width], [pos + 1], [pos + level.width]],
    }));
    for (const door of this.doors()) door.set(REGULAR);
  }

  override canConnectPoint(p: Point): boolean {
    const c = this.center();
    return (Math.abs(c.x - p.x) <= 1 || Math.abs(c.y - p.y) <= 1) && super.canConnectPoint(p);
  }
}

/** VaultQuadrantsRoom: four quarters round a statue; a guard by a chest in a corner away from the doors. */
export class VaultQuadrantsRoom extends VaultRoom {
  override readonly kind: string = 'VaultQuadrantsRoom';

  paint(level: GenLevel): void {
    const vault = vaultOf(level);
    Painter.fill(level, this, T.WALL);
    Painter.fill(level, this, 1, T.EMPTY);
    const c = this.center();
    Painter.drawInside(level, this, new Point(this.left, c.y), 3, T.WALL);
    Painter.drawInside(level, this, new Point(this.right, c.y), 3, T.WALL);
    Painter.drawInside(level, this, new Point(c.x, this.top), 3, T.WALL);
    Painter.drawInside(level, this, new Point(c.x, this.bottom), 3, T.WALL);
    Painter.set(level, c, T.STATUE);
    for (const door of this.doors()) door.set(REGULAR);

    let spawnPositions = [
      new Point(this.left + 2, this.top + 2), new Point(this.right - 2, this.top + 2),
      new Point(this.right - 2, this.bottom - 2), new Point(this.left + 2, this.bottom - 2),
    ];
    spawnPositions = spawnPositions.filter((p) => this.doors().every((door) => Point.distance(p, door) > 3));
    if (spawnPositions.length === 0) return;

    const enemy = guard(level, tierOneNear(this));
    const corner = Random.element(spawnPositions)!;
    enemy.spawn.pos = level.pointToCell(corner);
    enemy.spawn.state = 'wandering';
    vault.addMob(enemy);

    const tier = mobTier(enemy, 1);
    let treasurePos = enemy.spawn.pos;
    treasurePos += corner.x < c.x ? -1 : 1;
    treasurePos += corner.y < c.y ? -level.width : level.width;
    level.drop(vault.createEquipment(tier), treasurePos).kind = 'chest';
  }

  override canConnectPoint(p: Point): boolean {
    const c = this.center();
    return c.x !== p.x && c.y !== p.y && super.canConnectPoint(p);
  }
}

/** VaultRingsRoom: four solid blocks; a guard (no large one) wanders between nine spots in a random order. */
export class VaultRingsRoom extends VaultRoom {
  override readonly kind: string = 'VaultRingsRoom';

  paint(level: GenLevel): void {
    const vault = vaultOf(level);
    Painter.fill(level, this, T.WALL);
    Painter.fill(level, this, 1, T.EMPTY);
    Painter.fill(level, this.left + 2, this.top + 2, 3, 3, T.WALL);
    Painter.fill(level, this.right - 4, this.top + 2, 3, 3, T.WALL);
    Painter.fill(level, this.left + 2, this.bottom - 4, 3, 3, T.WALL);
    Painter.fill(level, this.right - 4, this.bottom - 4, 3, 3, T.WALL);
    for (const door of this.doors()) door.set(REGULAR);
    const nearOk = tierOneNear(this);
    const enemy = guard(level, (mob) => !isLarge(mob) && nearOk(mob));
    do {
      enemy.spawn.pos = level.pointToCell(this.random(1));
    } while (level.map[enemy.spawn.pos] === T.WALL);
    enemy.spawn.state = 'wandering';
    vault.addMob(enemy);
    const { left, top } = this;
    const positions: number[] = [];
    for (const dx of [1, 5, 9]) for (const dy of [1, 5, 9]) positions.push(level.pointToCell(new Point(left + dx, top + dy)));
    Random.shuffle(positions);
    setWander(enemy, positions, 0);
  }
}

/** VaultEnemyCenterRoom: rings of floor round a middle chamber, where a guard keeps a chest. */
export class VaultEnemyCenterRoom extends VaultRoom {
  override readonly kind: string = 'VaultEnemyCenterRoom';

  paint(level: GenLevel): void {
    const vault = vaultOf(level);
    Painter.fill(level, this, T.WALL);
    Painter.fill(level, this, 1, T.EMPTY);
    Painter.fill(level, this, 2, T.WALL);
    Painter.fill(level, this, 3, T.EMPTY);
    const { left, top, right, bottom } = this;
    Painter.drawLine(level, new Point(left + 1, top + 3), new Point(right - 1, top + 3), T.EMPTY);
    Painter.drawLine(level, new Point(left + 1, bottom - 3), new Point(right - 1, bottom - 3), T.EMPTY);
    Painter.drawLine(level, new Point(left + 3, top + 1), new Point(left + 3, bottom - 1), T.EMPTY);
    Painter.drawLine(level, new Point(right - 3, top + 1), new Point(right - 3, bottom - 1), T.EMPTY);
    for (const door of this.doors()) door.set(REGULAR);

    const enemy = guard(level, tierOneNear(this));
    const c = this.center();
    const positions = Random.Int(2) === 0
      ? [new Point(c.x - 1, c.y - 1), new Point(c.x + 1, c.y - 1), new Point(c.x + 1, c.y + 1), new Point(c.x - 1, c.y + 1)]
      : [new Point(c.x - 1, c.y - 1), new Point(c.x - 1, c.y + 1), new Point(c.x + 1, c.y + 1), new Point(c.x + 1, c.y - 1)];
    const cells = positions.map((p) => level.pointToCell(p));
    const idx = Random.Int(4);
    wander(enemy, cells[idx]!, cells, idx);
    vault.addMob(enemy);

    const tier = mobTier(enemy, 1);
    level.drop(vault.createEquipment(tier), level.pointToCell(c)).kind = 'chest';
  }

  /** No random items in the middle. */
  override canPlaceItem(p: Point, l: GenLevel): boolean {
    const c = this.center();
    if (Math.abs(c.x - p.x) <= 2) return false;
    if (Math.abs(c.y - p.y) <= 2) return false;
    return super.canPlaceItem(p, l);
  }
}

/** VaultHallwayRoom: a hallway with side passages; a guard paces its length; an equipment prize on the side without doors. */
export class VaultHallwayRoom extends VaultLongRoom {
  override readonly kind: string = 'VaultHallwayRoom';

  paint(level: GenLevel): void {
    const vault = vaultOf(level);
    Painter.fill(level, this, T.WALL);
    const { left, top, right, bottom } = this;
    if (this.wide()) {
      Painter.fill(level, left + 1, top + 4, this.width() - 2, 3, T.EMPTY);
      Painter.fill(level, left + 6, top + 1, 1, this.height() - 2, T.EMPTY);
      Painter.fill(level, right - 7, top + 1, 1, this.height() - 2, T.EMPTY);
    } else {
      Painter.fill(level, left + 4, top + 1, 3, this.height() - 2, T.EMPTY);
      Painter.fill(level, left + 1, top + 6, this.width() - 2, 1, T.EMPTY);
      Painter.fill(level, left + 1, bottom - 7, this.width() - 2, 1, T.EMPTY);
    }
    const c = this.center();
    let lootPositions = this.wide()
      ? [left + 2 + c.y * level.width, right - 2 + c.y * level.width]
      : [c.x + (top + 2) * level.width, c.x + (bottom - 2) * level.width];
    // A single treasure, on a side with no door, or in the middle with doors on both.
    for (const d of this.doors()) lootPositions = lootPositions.filter((i) => level.distance(i, level.pointToCell(d)) > 6);
    if (lootPositions.length === 0) lootPositions.push(level.pointToCell(c));
    const prize = level.findPrizeItem(isEquipable);
    if (prize) level.drop(prize, lootPositions[0]!);

    const enemy = guard(level, tierOneNear(this));
    if (this.wide()) {
      setWander(enemy, [level.pointToCell(new Point(left + 2, c.y)), level.pointToCell(new Point(right - 2, c.y))], Random.Int(2));
    } else {
      setWander(enemy, [level.pointToCell(new Point(c.x, top + 2)), level.pointToCell(new Point(c.x, bottom - 2))], Random.Int(2));
    }
    enemy.spawn.pos = level.pointToCell(c);
    enemy.spawn.state = 'wandering';
    vault.addMob(enemy);

    for (const door of this.doors()) {
      door.set(REGULAR);
      if (this.wide()) {
        if (door.x === left) {
          Painter.drawLine(level, new Point(door.x + 1, door.y), new Point(left + 1, c.y), T.EMPTY);
        } else if (door.x === right) {
          Painter.drawLine(level, new Point(door.x - 1, door.y), new Point(right - 1, c.y), T.EMPTY);
        } else if (door.x <= left + 3 || door.x >= right - 3) {
          Painter.drawInside(level, this, door, 5, T.EMPTY);
        } else {
          const closestX = door.x < c.x || (door.x === c.x && Random.Int(2) === 0) ? left + 6 : right - 7;
          if (door.y === top) Painter.drawLine(level, new Point(door.x, door.y + 1), new Point(closestX, door.y + 1), T.EMPTY);
          else Painter.drawLine(level, new Point(door.x, door.y - 1), new Point(closestX, door.y - 1), T.EMPTY);
        }
      } else if (door.y === top) {
        Painter.drawLine(level, new Point(door.x, door.y + 1), new Point(c.x, top + 1), T.EMPTY);
      } else if (door.y === bottom) {
        Painter.drawLine(level, new Point(door.x, door.y - 1), new Point(c.x, bottom - 1), T.EMPTY);
      } else if (door.y <= top + 3 || door.y >= bottom - 3) {
        Painter.drawInside(level, this, door, 5, T.EMPTY);
      } else {
        const closestY = door.y < c.y || (door.y === c.y && Random.Int(2) === 0) ? top + 6 : bottom - 7;
        if (door.x === left) Painter.drawLine(level, new Point(door.x + 1, door.y), new Point(door.x + 1, closestY), T.EMPTY);
        else Painter.drawLine(level, new Point(door.x - 1, door.y), new Point(door.x - 1, closestY), T.EMPTY);
      }
    }
  }
}

/** VaultLongRingsRoom: two rings of floor; two guards wander twenty far-apart spots; a prize in the middle. Never next to the entry. */
export class VaultLongRingsRoom extends VaultLongRoom {
  override readonly kind: string = 'VaultLongRingsRoom';

  paint(level: GenLevel): void {
    const vault = vaultOf(level);
    Painter.fill(level, this, T.WALL);
    Painter.fill(level, this, 1, T.EMPTY);
    Painter.fill(level, this, 4, T.WALL);
    if (this.wide()) Painter.fill(level, this, 8, 4, 8, 4, T.EMPTY);
    else Painter.fill(level, this, 4, 8, 4, 8, T.EMPTY);
    const c = this.center();
    const prize = level.findPrizeItem(isEquipable);
    if (prize) level.drop(prize, level.pointToCell(c));

    // Two guards.
    for (let n = 0; n < 2; n++) {
      const enemy = vault.createMob();
      const positions = new Array<number>(20);
      positions[0] = this.randomWander(level, -1);
      for (let idx = 1; idx < positions.length; idx++) positions[idx] = this.randomWander(level, positions[idx - 1]!);
      wander(enemy, positions[0], positions, 0);
      vault.addMob(enemy);
    }
    for (const door of this.doors()) door.set(REGULAR);
  }

  private randomWander(level: GenLevel, previous: number): number {
    let pos: number;
    do {
      pos = level.pointToCell(this.random(1));
    } while (level.map[pos] === T.WALL || level.map[pos] === T.WALL_DECO || level.distance(pos, previous) < 6);
    return pos;
  }

  /** The harder rooms are never next to the entry. */
  override canConnect(r: Room): boolean {
    return super.canConnect(r) && r.kind !== 'VaultEntranceRoom';
  }
}

/** VaultCircleRoom: a round room; a scanning sentry in the middle sweeps it, every way or both ways at once. */
export class VaultCircleRoom extends VaultRoom {
  override readonly kind: string = 'VaultCircleRoom';

  paint(level: GenLevel): void {
    Painter.fill(level, this, T.WALL);
    Painter.fill(level, this, 2, T.EMPTY);
    Painter.fill(level, this, 4, 1, 4, 1, T.EMPTY);
    Painter.fill(level, this, 1, 4, 1, 4, T.EMPTY);
    Painter.set(level, this.center(), T.PEDESTAL);
    const pos = level.pointToCell(this.center());
    const w = level.width;
    let fields: VaultMob;
    switch (Random.Int(3)) {
      case 0:
        fields = {
          scanWidth: 90,
          scanDirs: [[pos - 1], [pos - 1 - w], [pos - w], [pos + 1 - w], [pos + 1], [pos + 1 + w], [pos + w], [pos + w - 1]],
        };
        break;
      default:
        fields = {
          scanWidth: 45,
          scanDirs: [
            [pos - 2, pos + 2], [pos - 2 - w, pos + 2 + w], [pos - 2 - 2 * w, pos + 2 + 2 * w], [pos - 1 - 2 * w, pos + 1 + 2 * w],
            [pos - 2 * w, pos + 2 * w], [pos + 1 - 2 * w, pos - 1 + 2 * w], [pos + 2 - 2 * w, pos - 2 + 2 * w], [pos + 2 - w, pos - 2 + w],
          ],
        };
    }
    level.mobs.push(sentry(pos, { afterScanCooldown: 2, scanLength: Math.fround(4.49), ...fields }));
    for (const door of this.doors()) {
      door.set(REGULAR);
      Painter.drawInside(level, this, door, 4, T.EMPTY);
    }
  }

  override canPlaceCharacter(): boolean {
    return false;
  }
}

/** VaultAlternatingFireRoom: a floor of flame vents firing in a checkerboard, a tier-0 prize on a pedestal in the middle. */
export class VaultAlternatingFireRoom extends VaultRoom {
  override readonly kind: string = 'VaultAlternatingFireRoom';

  paint(level: GenLevel): void {
    const vault = vaultOf(level);
    Painter.fill(level, this, T.WALL);
    Painter.fill(level, this, 1, T.EMPTY);
    for (const door of this.doors()) door.set(REGULAR);
    const c = this.center();
    Painter.set(level, c, T.PEDESTAL);
    level.drop(vault.createEquipment(0), level.pointToCell(c));
    let alternate = false;
    for (let x = this.left + 2; x <= this.right - 2; x++) {
      for (let y = this.top + 2; y <= this.bottom - 2; y++) {
        const cell = x + y * level.width;
        if (level.map[cell] !== T.PEDESTAL) setupFlameTrap(level, cell, alternate ? 1 : 0, 2, 1);
        alternate = !alternate;
      }
    }
  }

  /** (As the original reads: the first test only binds to the left column.) */
  override canPlaceItem(p: Point, l: GenLevel): boolean {
    return (super.canPlaceItem(p, l) && p.x === this.left + 1) || p.y === this.top + 1 || p.x === this.right - 1 || p.y === this.bottom - 1;
  }

  override canPlaceCharacter(): boolean {
    return false;
  }
}

/** VaultLasersRoom: disintegration sentries along the walls, each firing across now and then (7-9 turns). */
export class VaultLasersRoom extends VaultRoom {
  override readonly kind: string = 'VaultLasersRoom';

  paint(level: GenLevel): void {
    Painter.fill(level, this, T.WALL);
    Painter.fill(level, this, 2, T.EMPTY);
    for (const door of this.doors()) {
      Painter.drawInside(level, this, door, 2, T.EMPTY);
      door.set(REGULAR);
    }
    const w = level.width;
    const shot = (cell: number, dir: number): void => {
      Painter.set(level, cell, T.PEDESTAL);
      const after = Random.IntRange(7, 9);
      const cur = Random.IntRange(1, after);
      level.mobs.push(laser(cell, { laserDirs: [dir], afterShotCooldown: after, curCooldown: cur }));
    };
    for (let x = this.left + 2; x <= this.right - 2; x++) {
      if (level.map[x + (this.top + 1) * w] === T.WALL && level.map[x + (this.bottom - 1) * w] === T.WALL) {
        if (Random.Int(2) === 0) {
          const cell = x + w * (this.top + 1);
          shot(cell, cell + w);
        } else {
          const cell = x + w * (this.bottom - 1);
          shot(cell, cell - w);
        }
      }
    }
    for (let y = this.top + 2; y <= this.bottom - 2; y++) {
      if (level.map[this.left + 1 + y * w] === T.WALL && level.map[this.right - 1 + y * w] === T.WALL) {
        if (Random.Int(2) === 0) {
          const cell = this.left + 1 + w * y;
          shot(cell, cell + 1);
        } else {
          const cell = this.right - 1 + w * y;
          shot(cell, cell - 1);
        }
      }
    }
  }

  override canPlaceCharacter(): boolean {
    return false;
  }
}

/* VaultRoom.rooms, chances, setupChances and createRoom: the deck of vault rooms. */

const DECK: ReadonlyArray<() => VaultRoom> = [
  () => new VaultRingRoom(), () => new VaultCrossRoom(), () => new VaultQuadrantsRoom(), () => new VaultRingsRoom(),
  () => new VaultEnemyCenterRoom(),
  () => new VaultHallwayRoom(), () => new VaultLongRingsRoom(),
  // (The tokens room is always added by the level.)
  () => new VaultCircleRoom(), () => new VaultAlternatingFireRoom(), () => new VaultLasersRoom(),
  // (A simple enemy treasure room is always added too.)
];

let chances: number[] = [];

export function setupVaultChances(): void {
  chances = [2, 2, 2, 2, 2, 1, 1, 1, 1, 1];
}

export function createVaultRoom(): VaultRoom {
  let idx = Random.chances(chances);
  if (idx === -1) {
    setupVaultChances();
    idx = Random.chances(chances);
  }
  chances[idx]!--;
  return DECK[idx]!();
}

VAULT_ROOMS.entrance = () => new VaultEntranceRoom();
VAULT_ROOMS.setupChances = setupVaultChances;
VAULT_ROOMS.createRoom = createVaultRoom;
VAULT_ROOMS.tokens = () => new VaultTokensRoom();
VAULT_ROOMS.simpleEnemyTreasure = () => new VaultSimpleEnemyTreasureRoom();
