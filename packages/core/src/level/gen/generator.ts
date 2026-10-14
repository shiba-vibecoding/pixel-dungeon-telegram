import { createItem, type Item, itemDef, ItemGenerator, rollFood, rollGold } from '../../items';
import { randomArmor, randomizeWeapon, randomMissile, randomOfTier, randomWeapon } from '../../gear';
import { Rng } from '../../rng';
import { Dungeon } from './dungeon';
import { Random } from './random';

/*
 * items/Generator, as level generation calls it, with Shattered's names: the gear stream's weapon, armour and
 * thrown weapon tiers and decks (gear.ts), the run's decks for potions, scrolls, runestones and wands
 * (ItemGenerator with the run), its artifacts (null once none is left, as Generator.randomArtifact).
 * SEAM(alchemy): TRINKET (the trinket catalyst's choice is the alchemy stream's; gold stands in).
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
const run = () => (Dungeon.world?.run ?? (() => { try { return Dungeon.run; } catch { return undefined; } })());
const generator = (): ItemGenerator => new ItemGenerator(stackRng, Dungeon.depth, { run: run() });

function randomOf(category: 'potion' | 'scroll' | 'wand' | 'ring' | 'seed' | 'stone'): Item {
  return generator().of(category);
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
      case 'WEP_T5':
        return randomizeWeapon(createItem(randomOfTier(stackRng, Number(category.slice(5)), false, run())), stackRng);
      case 'ARMOR':
        return this.randomArmor();
      case 'MISSILE':
        return this.randomMissile();
      case 'MIS_T1':
      case 'MIS_T2':
      case 'MIS_T3':
      case 'MIS_T4':
      case 'MIS_T5':
        return randomizeWeapon(createItem(randomOfTier(stackRng, Number(category.slice(5)), true, run()), 3), stackRng);
      case 'WAND':
        return randomOf('wand');
      case 'RING':
        return randomOf('ring');
      case 'ARTIFACT':
        return this.randomArtifact() ?? randomOf('ring');
      case 'FOOD':
        return rollFood(stackRng);
      case 'POTION':
        return randomOf('potion');
      case 'SEED':
        return randomOf('seed');
      case 'SCROLL':
        return randomOf('scroll');
      case 'STONE':
        return randomOf('stone');
      case 'TRINKET':
        // SEAM(alchemy): Generator.Category.TRINKET.
        return createItem('gold', 1);
      case 'GOLD':
        return rollGold(stackRng, Dungeon.depth);
    }
  },

  /** Generator.randomUsingDefaults: the same, without the decks. */
  randomUsingDefaults(category?: GenCategory): Item {
    return this.random(category);
  },

  /** Generator.randomWeapon: a melee weapon of the depth's tiers. */
  randomWeapon(): Item {
    return randomWeapon(stackRng, Dungeon.depth, run());
  },

  /** Generator.randomArmor. */
  randomArmor(): Item {
    return randomArmor(stackRng, Dungeon.depth);
  },

  /** Generator.randomMissile: a set of thrown weapons. */
  randomMissile(): Item {
    return randomMissile(stackRng, Dungeon.depth, run());
  },

  /** Generator.randomArtifact: one the run has not dealt yet, or null once none is left. */
  randomArtifact(): Item | null {
    const item = generator().of('artifact');
    return itemDef(item.kind).category === 'artifact' ? item : null;
  },
};
