import { createItem, type Item, itemDef, ItemGenerator, type ItemKind, rollFood, rollGold } from '../../items';
import { Rng } from '../../rng';
import { Dungeon } from './dungeon';
import { Random } from './random';

/*
 * items/Generator, as level generation calls it. Shattered's Generator (its categories, decks and
 * tiers) is being brought in by other streams; until they land, Pixel Dungeon's item tables stand
 * in through these calls, which keep Shattered's names so the rooms read as the original.
 *
 * SEAM(gear): WEAPON/WEP_T1..T5, ARMOR, MISSILE/MIS_T1..T5 (Generator.randomWeapon/Armor/Missile).
 * SEAM(wands): WAND. SEAM(artifacts): ARTIFACT, RING (Generator.randomArtifact; null once none is left).
 * SEAM(alchemy): STONE, TRINKET, and the exotic potions and scrolls some rooms make.
 */

export type GenCategory =
  | 'TRINKET' | 'WEAPON' | 'WEP_T1' | 'WEP_T2' | 'WEP_T3' | 'WEP_T4' | 'WEP_T5' | 'ARMOR' | 'MISSILE' | 'MIS_T1' | 'MIS_T2'
  | 'MIS_T3' | 'MIS_T4' | 'MIS_T5' | 'WAND' | 'RING' | 'ARTIFACT' | 'FOOD' | 'POTION' | 'SEED' | 'SCROLL' | 'STONE' | 'GOLD';

/** An Rng that always draws from the top of the generation stack (Random), for the item tables. */
class StackRng extends Rng {
  constructor() {
    super({ x: 0, y: 0, z: 0, w: 1 });
  }

  override next(): number {
    return Random.rng.next();
  }
}

const stackRng = new StackRng();
const generator = (): ItemGenerator => new ItemGenerator(stackRng, Dungeon.depth);

/** Pixel Dungeon's thrown weapons, the stand-in for Shattered's (SEAM(gear)). */
const MISSILE_KINDS: ItemKind[] = ['missile.javelin', 'missile.incendiary', 'missile.curare', 'missile.shuriken', 'missile.tomahawk', 'missile.dart'];

/** Shattered's weapon tiers by name (WEP_T1..T5) mapped to Pixel Dungeon's tiers. */
const WEAPONS_BY_TIER: Record<number, ItemKind[]> = {
  1: ['weapon.dagger', 'weapon.knuckles', 'weapon.shortSword'],
  2: ['weapon.quarterstaff', 'weapon.spear'],
  3: ['weapon.mace', 'weapon.sword'],
  4: ['weapon.longsword', 'weapon.battleAxe'],
  5: ['weapon.warHammer', 'weapon.glaive'],
};

function randomOf(category: 'weapon' | 'armor' | 'potion' | 'scroll' | 'wand' | 'ring' | 'seed'): Item {
  for (;;) {
    const item = generator().of(category);
    // Pixel Dungeon's weapon table holds thrown weapons too; a melee weapon is asked for.
    if (category !== 'weapon' || itemDef(item.kind).category === 'weapon') return item;
  }
}

export const Generator = {
  /** Generator.random(): a random category by its chances, then an item of it. */
  random(category?: GenCategory): Item {
    if (category) return this.randomCategory(category);
    return generator().random();
  },

  randomCategory(category: GenCategory): Item {
    switch (category) {
      case 'WEAPON':
        return this.randomWeapon();
      case 'WEP_T1':
      case 'WEP_T2':
      case 'WEP_T3':
      case 'WEP_T4':
      case 'WEP_T5': {
        const tier = Number(category.slice(5));
        const item = randomOf('weapon');
        const kinds = WEAPONS_BY_TIER[tier]!;
        return { ...item, kind: kinds[Random.Int(kinds.length)]! };
      }
      case 'ARMOR':
        return this.randomArmor();
      case 'MISSILE':
      case 'MIS_T1':
      case 'MIS_T2':
      case 'MIS_T3':
      case 'MIS_T4':
      case 'MIS_T5':
        return this.randomMissile();
      case 'WAND':
        return randomOf('wand');
      case 'RING':
        return randomOf('ring');
      case 'ARTIFACT':
        // SEAM(artifacts): Generator.randomArtifact; a ring stands in, as Shattered gives once none is left.
        return randomOf('ring');
      case 'FOOD':
        return rollFood(stackRng);
      case 'POTION':
        return randomOf('potion');
      case 'SEED':
        return randomOf('seed');
      case 'SCROLL':
        return randomOf('scroll');
      case 'STONE':
        // SEAM(alchemy): runestones; Pixel Dungeon's weightstone (the stone of augmentation) stands in.
        return createItem('weightstone');
      case 'TRINKET':
        // SEAM(alchemy): trinkets; nothing stands in.
        return createItem('gold', 1);
      case 'GOLD':
        return rollGold(stackRng, Dungeon.depth);
    }
  },

  /** Generator.randomUsingDefaults: the same, without the decks (no decks yet: the same). */
  randomUsingDefaults(category?: GenCategory): Item {
    return this.random(category);
  },

  /** Generator.randomWeapon: a melee weapon of the depth's tiers (SEAM(gear)). */
  randomWeapon(): Item {
    return randomOf('weapon');
  },

  /** Generator.randomArmor (SEAM(gear)). */
  randomArmor(): Item {
    return randomOf('armor');
  },

  /** Generator.randomMissile (SEAM(gear)): a set of thrown weapons. */
  randomMissile(): Item {
    const kind = MISSILE_KINDS[Random.Int(MISSILE_KINDS.length - 1)]!;
    return createItem(kind, Random.IntRange(2, 4));
  },

  /** Generator.randomArtifact (SEAM(artifacts)): null, as when the run's artifacts are all found. */
  randomArtifact(): Item | null {
    return null;
  },
};
