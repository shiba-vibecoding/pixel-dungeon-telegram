import type { MobKind } from '../../../../actors';
import { createItem, type Item, randomEnchantment, randomGlyph } from '../../../../items';
import { T } from '../../../terrain';
import { Dungeon } from '../../dungeon';
import { type GenCategory, Generator } from '../../generator';
import type { GenLevel, MobSpawn } from '../../genlevel';
import { Painter } from '../../painter';
import { Random } from '../../random';
import { Point } from '../../rect';
import { DoorType } from '../../room';
import { seamItem, seamPlant } from '../../seams';
import {
  categoryOf, drawArmorCurse, findCatalyst, grassUnderPlant, ironKey, knowCurse, randomArmorOfSet, randomGold, spawnMimic, upgrade,
} from './prizes';
import { SpecialRoom } from './special';

/* The special rooms behind a locked door (and the storeroom behind a barricade), each with its own treasure. */

/** Where a feature goes against the wall across from the entrance, in one of its two corners (armoury statue, laboratory pot, pit well). */
export function cornerOpposite(room: SpecialRoom): Point {
  const entrance = room.entrance();
  if (entrance.x === room.left) return new Point(room.right - 1, Random.Int(2) === 0 ? room.top + 1 : room.bottom - 1);
  if (entrance.x === room.right) return new Point(room.left + 1, Random.Int(2) === 0 ? room.top + 1 : room.bottom - 1);
  if (entrance.y === room.top) return new Point(Random.Int(2) === 0 ? room.left + 1 : room.right - 1, room.bottom - 1);
  return new Point(Random.Int(2) === 0 ? room.left + 1 : room.right - 1, room.top + 1);
}

/** ArmoryRoom: a statue, two or three pieces of gear of different sorts (a bomb, a weapon, armour, thrown weapons); locked. */
export class ArmoryRoom extends SpecialRoom {
  readonly kind: string = 'ArmoryRoom';

  paint(level: GenLevel): void {
    Painter.fill(level, this, T.WALL);
    Painter.fill(level, this, 1, T.EMPTY);

    const entrance = this.entrance();
    Painter.set(level, cornerOpposite(this), T.STATUE);

    const n = Random.IntRange(2, 3);
    // Only one prize of each sort.
    const prizeCats = [1, 1, 1, 1];
    const freeCell = (): number => {
      let pos: number;
      do {
        pos = level.pointToCell(this.random());
      } while (level.map[pos] !== T.EMPTY || level.heaps.has(pos));
      return pos;
    };
    for (let i = 0; i < n; i++) {
      const pos = freeCell();
      level.drop(ArmoryRoom.prize(prizeCats), pos);
    }
    const cata = findCatalyst(level);
    if (cata) level.drop(cata, freeCell());

    entrance.set(DoorType.LOCKED);
    level.addItemToSpawn(ironKey());
  }

  private static prize(prizeCats: number[]): Item {
    const index = Random.chances(prizeCats);
    prizeCats[index] = 0;
    switch (index) {
      case 0:
        // Bomb.random: a double bomb one time in four.
        return Random.Int(4) === 0 ? createItem('bomb', 2) : createItem('bomb');
      case 1:
        return Generator.randomWeapon();
      case 2:
        return Generator.randomArmor();
      default:
        return Generator.randomMissile();
    }
  }
}

/** CryptRoom: a tomb holding cursed armour of the next set of floors (upgraded if it was not cursed already), two statues by it; locked. */
export class CryptRoom extends SpecialRoom {
  readonly kind: string = 'CryptRoom';

  paint(level: GenLevel): void {
    Painter.fill(level, this, T.WALL);
    Painter.fill(level, this, 1, T.EMPTY);

    const c = this.center();
    let cx = c.x;
    let cy = c.y;

    const entrance = this.entrance();
    entrance.set(DoorType.LOCKED);
    level.addItemToSpawn(ironKey());

    if (entrance.x === this.left) {
      Painter.set(level, new Point(this.right - 1, this.top + 1), T.STATUE);
      Painter.set(level, new Point(this.right - 1, this.bottom - 1), T.STATUE);
      cx = this.right - 2;
    } else if (entrance.x === this.right) {
      Painter.set(level, new Point(this.left + 1, this.top + 1), T.STATUE);
      Painter.set(level, new Point(this.left + 1, this.bottom - 1), T.STATUE);
      cx = this.left + 2;
    } else if (entrance.y === this.top) {
      Painter.set(level, new Point(this.left + 1, this.bottom - 1), T.STATUE);
      Painter.set(level, new Point(this.right - 1, this.bottom - 1), T.STATUE);
      cy = this.bottom - 2;
    } else if (entrance.y === this.bottom) {
      Painter.set(level, new Point(this.left + 1, this.top + 1), T.STATUE);
      Painter.set(level, new Point(this.right - 1, this.top + 1), T.STATUE);
      cy = this.top + 2;
    }

    level.drop(CryptRoom.prize(), cx + cy * level.width).kind = 'tomb';
  }

  private static prize(): Item {
    // One set of floors higher than usual.
    const prize = randomArmorOfSet(Math.trunc(Dungeon.depth / 5) + 1);
    if (Dungeon.itemBlocked(prize)) return randomGold();
    // The curse is always drawn, so the parchment scrap does not shift the level.
    drawArmorCurse();
    // Armour not cursed already gets a free upgrade, and the curse unless it has a glyph.
    if (!prize.cursed) upgrade(prize);
    prize.cursed = true;
    knowCurse(prize);
    return prize;
  }
}

/** GardenRoom: tall grass round a lawn, now and then a sungrass or blandfruit bush, all in the light of foliage; locked. */
export class GardenRoom extends SpecialRoom {
  readonly kind: string = 'GardenRoom';

  paint(level: GenLevel): void {
    Painter.fill(level, this, T.WALL);
    Painter.fill(level, this, 1, T.HIGH_GRASS);
    Painter.fill(level, this, 2, T.GRASS);

    this.entrance().set(DoorType.LOCKED);
    level.addItemToSpawn(ironKey());

    // Cells with a plant on them, as Level.plants (the blandfruit bush has no plant here: SEAM(plants)).
    const planted = new Set<number>();
    const plantPos = (): number => {
      let pos: number;
      do {
        pos = level.pointToCell(this.random());
      } while (level.plants.has(pos) || planted.has(pos));
      return pos;
    };
    const blandfruit = (pos: number): void => {
      const kind = seamPlant('blandfruitBush');
      if (kind) level.plant(kind, pos);
      else grassUnderPlant(level, pos);
      planted.add(pos);
    };

    const bushes = Random.Int(3);
    if (bushes === 0) {
      level.plant('sungrass', plantPos());
    } else if (bushes === 1) {
      blandfruit(plantPos());
    } else if (Random.Int(5) === 0) {
      level.plant('sungrass', plantPos());
      blandfruit(plantPos());
    }

    for (let i = this.top + 1; i < this.bottom; i++) {
      for (let j = this.left + 1; j < this.right; j++) level.seedBlob(j + level.width * i, 1, 'Foliage');
    }
  }
}

/** The alchemy guide's pages, in order (Document.ALCHEMY_GUIDE): five for the sewers, four given from the prison on. */
const ALCHEMY_PAGES = ['Potions', 'Stones', 'Energy_Food', 'Exotic_Potions', 'Exotic_Scrolls', 'Bombs', 'Weapons', 'Brews_Elixirs', 'Spells'];

/**
 * LaboratoryRoom: an alchemy pot in a far corner, five energy crystals, one or two potions or stones
 * (the floor's strength potion first), and pages of the alchemy guide still to be found; locked.
 */
export class LaboratoryRoom extends SpecialRoom {
  readonly kind: string = 'LaboratoryRoom';

  paint(level: GenLevel): void {
    Painter.fill(level, this, T.WALL);
    Painter.fill(level, this, 1, T.EMPTY_SP);

    const entrance = this.entrance();
    const pot = cornerOpposite(this);
    Painter.set(level, pot, T.ALCHEMY);

    const chapter = 1 + Math.trunc(Dungeon.depth / 5);
    level.seedBlob(pot.x + level.width * pot.y, 1, 'Alchemy');

    // Cells holding what Pixel Dungeon has no item for yet (energy crystals, guide pages), as if it lay there.
    const taken = new Set<number>();
    const freeCell = (): number => {
      let pos: number;
      do {
        pos = level.pointToCell(this.random());
      } while (level.map[pos] !== T.EMPTY_SP || level.heaps.has(pos) || taken.has(pos));
      return pos;
    };

    let pos = freeCell();
    const crystals = seamItem('energyCrystal');
    if (crystals) crystals.qty = 5;
    level.drop(crystals, pos);
    taken.add(pos);

    const n = Random.NormalIntRange(1, 2);
    for (let i = 0; i < n; i++) {
      pos = freeCell();
      level.drop(LaboratoryRoom.prize(level), pos);
    }

    // SEAM(alchemy): no guide page is ever found yet, so every one is still missing.
    const missingPages = [...ALCHEMY_PAGES];
    // Five pages in the sewers, ten from the prison on.
    const chapterTarget = missingPages.length <= 5 ? 2 : 1;
    if (missingPages.length > 0 && chapter >= chapterTarget) {
      // One more page for each chapter past the target.
      const pagesToDrop = Math.min(missingPages.length, chapter - chapterTarget + 1);
      for (let i = 0; i < pagesToDrop; i++) {
        missingPages.shift();
        pos = freeCell();
        level.drop(seamItem('alchemyPage'), pos);
        taken.add(pos);
      }
    }

    entrance.set(DoorType.LOCKED);
    level.addItemToSpawn(ironKey());
  }

  private static prize(level: GenLevel): Item | null {
    let prize = findCatalyst(level);
    if (!prize) {
      prize = level.findPrizeItem((item) => item.kind === 'potion.strength');
      if (!prize) prize = Generator.random(Random.oneOf<GenCategory>('POTION', 'STONE'));
    }
    return prize;
  }
}

/** LibraryRoom: a wall of bookshelves, a scroll of identify or remove curse and up to two more scrolls; locked. */
export class LibraryRoom extends SpecialRoom {
  readonly kind: string = 'LibraryRoom';

  paint(level: GenLevel): void {
    Painter.fill(level, this, T.WALL);
    Painter.fill(level, this, 1, T.EMPTY_SP);

    const entrance = this.entrance();
    Painter.fill(level, this.left + 1, this.top + 1, this.width() - 2, 1, T.BOOKSHELF);
    Painter.drawInside(level, this, entrance, 1, T.EMPTY_SP);

    const n = Random.NormalIntRange(1, 3);
    for (let i = 0; i < n; i++) {
      let pos: number;
      do {
        pos = level.pointToCell(this.random());
      } while (level.map[pos] !== T.EMPTY_SP || level.heaps.has(pos));
      const item = i === 0 ? createItem(Random.Int(2) === 0 ? 'scroll.identify' : 'scroll.removeCurse') : LibraryRoom.prize(level);
      level.drop(item, pos);
    }

    entrance.set(DoorType.LOCKED);
    level.addItemToSpawn(ironKey());
  }

  private static prize(level: GenLevel): Item {
    return findCatalyst(level) ?? level.findPrizeItem((item) => categoryOf(item) === 'scroll') ?? Generator.random('SCROLL');
  }
}

/** MagicWellRoom: a well of awareness or of health in the middle; locked. */
export class MagicWellRoom extends SpecialRoom {
  readonly kind: string = 'MagicWellRoom';
  /** Which water, when not left to chance. */
  overrideWater: 'WaterOfAwareness' | 'WaterOfHealth' | null = null;

  paint(level: GenLevel): void {
    Painter.fill(level, this, T.WALL);
    Painter.fill(level, this, 1, T.EMPTY);

    const c = this.center();
    Painter.set(level, c.x, c.y, T.WELL);

    const water = this.overrideWater ?? Random.element(['WaterOfAwareness', 'WaterOfHealth'] as const)!;
    level.seedBlob(c.x + level.width * c.y, 1, water);

    this.entrance().set(DoorType.LOCKED);
    level.addItemToSpawn(ironKey());
  }
}

/** RunestoneRoom: a dais of floor in a moat of chasm, two or three runestones on it; locked. */
export class RunestoneRoom extends SpecialRoom {
  readonly kind: string = 'RunestoneRoom';

  override minWidth(): number {
    return 6;
  }
  override minHeight(): number {
    return 6;
  }

  paint(level: GenLevel): void {
    Painter.fill(level, this, T.WALL);
    Painter.fill(level, this, 1, T.CHASM);

    Painter.drawInside(level, this, this.entrance(), 2, T.EMPTY_SP);
    Painter.fill(level, this, 2, T.EMPTY);

    const n = Random.NormalIntRange(2, 3);
    for (let i = 0; i < n; i++) {
      let dropPos: number;
      do {
        dropPos = level.pointToCell(this.random());
      } while (level.map[dropPos] !== T.EMPTY || level.heaps.has(dropPos));
      level.drop(RunestoneRoom.prize(level), dropPos);
    }

    this.entrance().set(DoorType.LOCKED);
    level.addItemToSpawn(ironKey());
  }

  private static prize(level: GenLevel): Item {
    // Runestones: Pixel Dungeon's weightstone stands for the stones (SEAM(alchemy)).
    return findCatalyst(level) ?? level.findPrizeItem((item) => categoryOf(item) === 'weightstone') ?? Generator.random('STONE');
  }
}

/**
 * StatueRoom: an animated statue (one in ten armoured) guarding a row of statues across from the
 * door; locked. Statue.random: the statue's gear comes from a stream of its own.
 */
export class StatueRoom extends SpecialRoom {
  readonly kind: string = 'StatueRoom';

  paint(level: GenLevel): void {
    Painter.fill(level, this, T.WALL);
    Painter.fill(level, this, 1, T.EMPTY);

    const c = this.center();
    let cx = c.x;
    let cy = c.y;

    const door = this.entrance();
    door.set(DoorType.LOCKED);
    level.addItemToSpawn(ironKey());

    if (door.x === this.left) {
      Painter.fill(level, this.right - 1, this.top + 1, 1, this.height() - 2, T.STATUE);
      cx = this.right - 2;
    } else if (door.x === this.right) {
      Painter.fill(level, this.left + 1, this.top + 1, 1, this.height() - 2, T.STATUE);
      cx = this.left + 2;
    } else if (door.y === this.top) {
      Painter.fill(level, this.left + 1, this.bottom - 1, this.width() - 2, 1, T.STATUE);
      cy = this.bottom - 2;
    } else if (door.y === this.bottom) {
      Painter.fill(level, this.left + 1, this.top + 1, this.width() - 2, 1, T.STATUE);
      cy = this.top + 2;
    }

    level.mobs.push(randomStatue(cx + cy * level.width));
  }
}

/**
 * Statue.random(): an animated statue with a melee weapon (never cursed, always enchanted); one in
 * ten an ArmoredStatue, with uncursed inscribed armour too. SEAM(mobs): no armoured statue kind yet.
 */
export function randomStatue(pos: number): MobSpawn {
  // RatSkull.exoticChanceMultiplier: 1 without the trinket (SEAM(alchemy)).
  const armored = Random.Float() < Math.fround(1 / 10);
  Random.pushGenerator(Random.Long());
  try {
    // Statue.createWeapon(useDecks = true).
    const weapon = Generator.random('WEAPON');
    weapon.cursed = false;
    weapon.enchant = randomEnchantment(Random.rng);
    if (!armored) return { kind: 'statue', pos, state: 'passive', item: weapon };
    const armor = Generator.randomArmor();
    armor.cursed = false;
    armor.glyph = randomGlyph(Random.rng);
    // SEAM(mobs): ArmoredStatue.
    return { kind: 'armoredStatue' as MobKind, pos, state: 'passive', item: weapon, armor } as MobSpawn;
  } finally {
    Random.popGenerator();
  }
}

/** StorageRoom: three or four consumables (a honeypot half the time) behind a barricade, and a potion of liquid flame to burn it. */
export class StorageRoom extends SpecialRoom {
  readonly kind: string = 'StorageRoom';

  paint(level: GenLevel): void {
    Painter.fill(level, this, T.WALL);
    Painter.fill(level, this, 1, T.EMPTY_SP);

    let honeyPot = Random.Int(2) === 0;
    const n = Random.IntRange(3, 4);
    for (let i = 0; i < n; i++) {
      let pos: number;
      do {
        pos = level.pointToCell(this.random());
      } while (level.map[pos] !== T.EMPTY_SP || level.heaps.has(pos));
      if (honeyPot) {
        level.drop(createItem('honeypot'), pos);
        honeyPot = false;
      } else {
        level.drop(consumablePrize(level), pos);
      }
    }

    this.entrance().set(DoorType.BARRICADE);
    level.addItemToSpawn(createItem('potion.liquidFlame'));
  }
}

/** The storeroom's and the fire room's prize: two times in three a prize the level holds, else a potion, scroll, food or gold. */
export function consumablePrize(level: GenLevel): Item {
  if (Random.Int(3) !== 0) {
    const prize = level.findPrizeItem();
    if (prize) return prize;
  }
  return Generator.random(Random.oneOf<GenCategory>('POTION', 'SCROLL', 'FOOD', 'GOLD'));
}

/**
 * TreasuryRoom: a statue and two or three heaps of gold, all in chests (a fifth of them mimics, from
 * the second floor) or all loose with six handfuls of coins about; locked.
 */
export class TreasuryRoom extends SpecialRoom {
  readonly kind: string = 'TreasuryRoom';

  paint(level: GenLevel): void {
    Painter.fill(level, this, T.WALL);
    Painter.fill(level, this, 1, T.EMPTY);

    Painter.set(level, this.center(), T.STATUE);

    const chests = Random.Int(2) === 0;
    const n = Random.IntRange(2, 3);
    // MimicTooth.mimicChanceMultiplier: 1 without the trinket (SEAM(alchemy)).
    const mimicChance = Math.fround(1 / 5);
    for (let i = 0; i < n; i++) {
      const item = findCatalyst(level) ?? randomGold();
      let pos: number;
      do {
        pos = level.pointToCell(this.random());
      } while (level.map[pos] !== T.EMPTY || level.heaps.has(pos) || level.findMob(pos));
      if (chests && Dungeon.depth > 1 && Random.Float() < mimicChance) {
        spawnMimic(level, pos, item);
      } else {
        level.drop(item, pos).kind = chests ? 'chest' : 'heap';
      }
    }

    if (!chests) {
      for (let i = 0; i < 6; i++) {
        let pos: number;
        do {
          pos = level.pointToCell(this.random());
        } while (level.map[pos] !== T.EMPTY);
        level.drop(createItem('gold', Random.IntRange(5, 12)), pos);
      }
    }

    this.entrance().set(DoorType.LOCKED);
    level.addItemToSpawn(ironKey());
  }
}
