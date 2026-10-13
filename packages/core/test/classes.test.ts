import { describe, expect, it } from 'vitest';
import { addHero, allowedLook, createWorld, emptyWallet, HERO_CLASSES, offerBySku, OFFERS, type HeroClass, heroById, startingKit, SUBCLASSES, type World } from '../src/index';
import { pacify } from './helpers';

export function solo(heroClass: HeroClass = 'duelist', seed = 9): World {
  const world = pacify(createWorld(seed));
  addHero(world, { id: 'p', name: 'P', heroClass });
  return world;
}

describe('the Duelist and the Cleric (HeroClass.DUELIST and CLERIC)', () => {
  it("Shattered's six classes, each with two ways to master", () => {
    expect(HERO_CLASSES).toEqual(['warrior', 'mage', 'rogue', 'huntress', 'duelist', 'cleric']);
    expect(SUBCLASSES.duelist).toEqual(['champion', 'monk']);
    expect(SUBCLASSES.cleric).toEqual(['priest', 'paladin']);
  });

  it('the Duelist starts with the rapier, two throwing spikes, cloth armour, a ration, a pouch and a waterskin', () => {
    const hero = heroById(solo('duelist'), 'p')!;
    expect(hero).toMatchObject({ hp: 20, ht: 20, str: 10, lvl: 1 });
    expect(hero.weapon!.kind).toBe('weapon.rapier');
    expect(hero.armor.kind).toBe('armor.cloth');
    expect(hero.items.find((item) => item.kind === 'missile.throwingSpike')).toMatchObject({ qty: 2 });
    for (const kind of ['food.ration', 'bag.seeds', 'waterskin'] as const) expect(hero.items.some((i) => i.kind === kind), kind).toBe(true);
    expect(startingKit('duelist').quickslots).toEqual(['weapon.rapier', 'missile.throwingSpike']);
  });

  it('the Cleric starts with the cudgel and the holy tome worn, three charges of it', () => {
    const hero = heroById(solo('cleric'), 'p')!;
    expect(hero.weapon!.kind).toBe('weapon.cudgel');
    expect(hero.artifact).toMatchObject({ kind: 'artifact.tome', level: 0, charge: 3 });
    expect(startingKit('cleric').quickslots).toEqual(['artifact.tome']);
  });

  it('they know what Shattered says they know', () => {
    const duelist = solo('duelist');
    for (const kind of ['scroll.identify', 'potion.strength', 'scroll.mirrorImage'] as const) expect(duelist.known).toContain(kind);
    const cleric = solo('cleric');
    for (const kind of ['scroll.identify', 'potion.purity', 'scroll.removeCurse'] as const) expect(cleric.known).toContain(kind);
  });

  it("Pixel-Mart sells all three looks for them, as for the older four; the ash one is earned with the second boss", () => {
    for (const heroClass of ['duelist', 'cleric'] as const) {
      expect(OFFERS.filter((o) => o.kind === 'skin' && o.heroClass === heroClass).map((o) => o.skin)).toEqual(['ash', 'royal', 'shadow']);
      expect(offerBySku(`skin.${heroClass}.ash`)).toMatchObject({ badge: 'boss2', stars: 0 });
      const wallet = { ...emptyWallet(), owned: [`skin.${heroClass}.royal`] };
      expect(allowedLook({ skin: 'royal' }, wallet, heroClass, 0)).toEqual({ skin: 'royal' });
      expect(allowedLook({ skin: 'shadow' }, wallet, heroClass, 0)).toEqual({});
    }
  });
});
