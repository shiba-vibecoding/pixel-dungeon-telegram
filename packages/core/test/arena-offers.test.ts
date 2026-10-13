import { describe, expect, it } from 'vitest';
import { rollOffer } from '../src/arena';
import { addHero, armorStats, createWorld, heroById, itemDef, type ItemKind, weaponStats } from '../src/index';
import { Rng } from '../src/rng';

/** What is of no use in the pit: nothing to map, identify, uncurse or flee to. */
const USELESS: readonly ItemKind[] = [
  'scroll.mapping', 'scroll.identify', 'scroll.removeCurse', 'scroll.teleportation', 'scroll.challenge', 'potion.mindVision', 'potion.levitation',
  'potion.purity', 'potion.invisibility', 'ring.detection', 'ring.shadows', 'ring.haggler', 'ring.herbalism', 'seed.fadeleaf', 'seed.rotberry',
  'wand.blink', 'wand.reach', 'wand.regrowth', 'torch', 'artifact.beacon',
];

describe('the arena\'s rewards', () => {
  it('are three different things of use, gear better than worn and within the hero\'s strength', () => {
    const world = createWorld(21, 0, 'arena');
    addHero(world, { id: 'p', name: 'P', heroClass: 'mage' });
    const hero = heroById(world, 'p')!;
    const rng = Rng.seeded(7n);
    const seen = new Map<string, number>();
    for (let wave = 0; wave <= 24; wave++) {
      for (let n = 0; n < 40; n++) {
        const offer = rollOffer(rng, wave, hero);
        expect(offer).toHaveLength(3);
        expect(new Set(offer.map((i) => i.kind)).size).toBe(3);
        for (const item of offer) {
          seen.set(item.kind, (seen.get(item.kind) ?? 0) + 1);
          expect(USELESS, `${item.kind} at wave ${wave}`).not.toContain(item.kind);
          expect(item.cursed ?? false).toBe(false);
          expect(item.level).toBeGreaterThanOrEqual(0);
          const category = itemDef(item.kind).category;
          if (category === 'weapon') expect(weaponStats(item).str, item.kind).toBeLessThanOrEqual(hero.str);
          if (category === 'armor') expect(armorStats(item).str, item.kind).toBeLessThanOrEqual(hero.str);
          if (category === 'armor') expect(itemDef(item.kind).tier! * 10 + item.level).toBeGreaterThan(itemDef(hero.armor.kind).tier! * 10 + hero.armor.level);
        }
      }
    }
    // A wide choice, not the same few things.
    expect(seen.size).toBeGreaterThan(30);
  });
});
