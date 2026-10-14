import { describe, expect, it } from 'vitest';
import {
  act, addHero, createItem, createWorld, floorAt, heroById, levelAt, Rng, CLASS_ABILITIES, abilityChargeUse, talentPointsAvailable, WIDTH,
  type World,
} from '../src/index';
import { endEnduring, endureAdjust } from '../src/abilities';
import { pacify } from './helpers';
import { CENTRE, foeAt, ready, setTalents, special, wait } from './abilities-helpers';

describe("the Dwarf King's crown and class armour", () => {
  it('turns the armour worn into the hero\'s class armour with the chosen ability, keeping its level and glyph', () => {
    const world = pacify(createWorld(41));
    addHero(world, { id: 'p', name: 'P', heroClass: 'warrior' });
    const hero = heroById(world, 'p')!;
    hero.armor = { ...createItem('armor.mail', 1, 2), glyph: 'repulsion' };
    hero.items = [createItem('crown.king')];
    expect(act(world, 'p', { type: 'use', item: 0 })).toEqual({ ok: false, reason: 'choose an ability' });
    expect(act(world, 'p', { type: 'use', item: 0, choice: 1 }).ok).toBe(true);
    expect(hero.armor).toMatchObject({ kind: 'armor.warrior', base: 'armor.mail', level: 2, glyph: 'repulsion' });
    expect(hero.armor.charge).toBeCloseTo(50, 0);
    expect(hero.ability).toBe('shockwave');
    expect(hero.items).toHaveLength(0);
  });

  it('offers every class its three abilities, and a random one on the shuffle', () => {
    for (const heroClass of ['warrior', 'mage', 'rogue', 'huntress'] as const) {
      const world = pacify(createWorld(7));
      addHero(world, { id: 'p', name: 'P', heroClass });
      const hero = heroById(world, 'p')!;
      hero.items = [createItem('crown.king')];
      act(world, 'p', { type: 'use', item: 0, choice: 3 });
      expect(CLASS_ABILITIES[heroClass]).toContain(hero.ability);
    }
  });

  it('is for its own class only, and charges a hundred in five hundred turns while worn', () => {
    const world = ready('warrior', 'endure');
    const hero = heroById(world, 'p')!;
    hero.items = [createItem('armor.mage')];
    expect(act(world, 'p', { type: 'equip', item: 0 })).toEqual({ ok: false, reason: 'that armour is not made for you' });
    hero.armor.charge = 0;
    for (let i = 0; i < 250; i++) act(world, 'p', { type: 'wait' });
    expect(hero.armor.charge).toBeGreaterThan(45);
    expect(hero.armor.charge).toBeLessThan(55);
  });

  it('refuses an ability without the charge, and takes the cost from it', () => {
    const world = ready('warrior', 'endure');
    const hero = heroById(world, 'p')!;
    hero.armor.charge = 49;
    expect(act(world, 'p', { type: 'special' })).toEqual({ ok: false, reason: 'art:items.armor.classarmor.low_charge' });
    hero.armor.charge = 80;
    expect(act(world, 'p', { type: 'special' }).ok).toBe(true);
    expect(hero.armor.charge).toBeGreaterThan(29.9);
    expect(hero.armor.charge).toBeLessThan(31);
  });

  it('heroic energy makes every ability cheaper', () => {
    const world = ready('warrior', 'endure', { heroicEnergy: 4 });
    expect(abilityChargeUse(world, heroById(world, 'p')!)).toBe(30);
  });

  it('transfers its properties to another armour, which is destroyed', () => {
    const world = ready('warrior', 'endure');
    const hero = heroById(world, 'p')!;
    hero.items = [{ ...createItem('armor.plate', 1, 3), glyph: 'thorns' }];
    expect(act(world, 'p', { type: 'transfer', to: 'armor', from: 0 }).ok).toBe(true);
    expect(hero.armor).toMatchObject({ kind: 'armor.warrior', base: 'armor.plate', level: 3, glyph: 'thorns' });
    expect(hero.items).toHaveLength(0);
  });

  it('gives tier 4 talent points from level 21, one a level, with an ability', () => {
    const world = ready('warrior', 'endure');
    const hero = heroById(world, 'p')!;
    hero.lvl = 20;
    expect(talentPointsAvailable(hero, 4)).toBe(0);
    hero.lvl = 22;
    expect(talentPointsAvailable(hero, 4)).toBe(2);
    expect(act(world, 'p', { type: 'talent', talent: 'sustainedRetribution' }).ok).toBe(true);
    expect(talentPointsAvailable(hero, 4)).toBe(1);
    expect(act(world, 'p', { type: 'talent', talent: 'bodySlam' })).toEqual({ ok: false, reason: 'you have no such talent' });
  });
});


describe("the warrior's abilities", () => {
  it('heroic leap lands on the cell aimed at, over foes, for 35 charge, body slamming and throwing back those beside the landing', () => {
    const world = ready('warrior', 'heroicLeap', { bodySlam: 4, impactWave: 4 });
    const hero = heroById(world, 'p')!;
    const spot = CENTRE + 2;
    const rat = foeAt(world, spot + 1);
    const hp = hero.hp;
    expect(special(world)).toEqual({ ok: false, reason: 'art:actors.hero.abilities.warrior.heroicleap.prompt' });
    const result = special(world, { target: spot });
    expect(result.ok).toBe(true);
    expect(hero.pos).toBe(spot);
    expect(hero.hp).toBe(hp);
    expect(100 - hero.armor.charge!).toBeCloseTo(35, 0);
    expect(rat.hp).toBeLessThan(100000);
    expect(rat.pos).toBeGreaterThan(spot + 1);
    expect(result.ok && result.effects.some((e) => e.type === 'ability' && e.ability === 'heroicLeap' && e.to === spot)).toBe(true);
  });

  it('heroic leap stops short of someone standing on the cell, and over the heads of those in the way', () => {
    const world = ready('warrior', 'heroicLeap');
    const hero = heroById(world, 'p')!;
    foeAt(world, CENTRE - 2);
    foeAt(world, CENTRE);
    expect(special(world, { target: CENTRE }).ok).toBe(true);
    expect(hero.pos).toBe(CENTRE - 1);
  });

  it('a second leap in a row costs less with double jump', () => {
    const world = ready('warrior', 'heroicLeap', { doubleJump: 4 });
    const hero = heroById(world, 'p')!;
    special(world, { target: CENTRE - 2 });
    const after = hero.armor.charge!;
    special(world, { target: CENTRE });
    expect(after - hero.armor.charge!).toBeCloseTo(35 * 0.84 ** 4, 0);
    special(world, { target: CENTRE + 2 });
    expect(hero.abil?.doubleJump).toBeDefined();
  });

  it('a rooted hero cannot leap', () => {
    const world = ready('warrior', 'heroicLeap');
    heroById(world, 'p')!.rooted = 3;
    expect(special(world, { target: CENTRE })).toEqual({ ok: false, reason: 'you are rooted' });
  });

  it('shockwave hurts and cripples everyone in its cone but the hero\'s allies, and not what is behind a wall', () => {
    const world = ready('warrior', 'shockwave', { shockForce: 4 });
    const hero = heroById(world, 'p')!;
    const near = foeAt(world, hero.pos + 2);
    const far = foeAt(world, hero.pos + 4);
    const friend = foeAt(world, hero.pos + 3);
    friend.ally = true;
    const side = foeAt(world, hero.pos + 1 + 4 * WIDTH);
    expect(special(world, { target: hero.pos + 1 }).ok).toBe(true);
    expect(near.hp).toBeLessThan(100000);
    expect(far.hp).toBeLessThan(100000);
    expect((near.crippled ?? 0) + (near.paralysed ?? 0)).toBeGreaterThan(0);
    expect(friend.hp).toBe(100000);
    expect(side.hp).toBe(100000);
    expect(special(world, { target: hero.pos })).toEqual({ ok: false, reason: 'art:actors.hero.abilities.armorability.self_target' });
  });

  it('expanding wave reaches further', () => {
    const plain = ready('warrior', 'shockwave');
    const wide = ready('warrior', 'shockwave', { expandingWave: 4 });
    const reach = (world: World): boolean => {
      const rat = foeAt(world, heroById(world, 'p')!.pos + 8);
      special(world, { target: heroById(world, 'p')!.pos + 1 });
      return rat.hp < 100000;
    };
    expect(reach(plain)).toBe(false);
    expect(reach(wide)).toBe(true);
  });

  it('endure takes three turns, halves what is taken meanwhile and pays it back in the next blows', () => {
    const world = ready('warrior', 'endure', { sustainedRetribution: 1 });
    const hero = heroById(world, 'p')!;
    const brute = foeAt(world, hero.pos + 1, 100000, 'brute');
    expect(special(world).ok).toBe(true);
    expect(hero.time).toBe(3);
    // The stance ended as the hero's turn came: what the brute did was stored, a quarter more for the retribution,
    // to be paid back over two blows.
    const tracker = hero.abil!.endure!;
    expect(tracker.enduring).toBe(false);
    expect(tracker.hitsLeft).toBe(2);
    expect(tracker.damageBonus).toBeGreaterThan(0);
    expect(300 - hero.hp).toBeGreaterThan(0);
    const hp = brute.hp;
    const bonus = tracker.damageBonus;
    act(world, 'p', { type: 'attack', target: brute.id });
    expect(hp - brute.hp).toBeGreaterThanOrEqual(bonus);
    expect(hero.abil!.endure!.hitsLeft).toBe(1);
    act(world, 'p', { type: 'attack', target: brute.id });
    expect(hero.abil?.endure).toBeUndefined();
  });

  it('endure stores half of every blow and takes the other half', () => {
    const world = ready('warrior', 'endure');
    const hero = heroById(world, 'p')!;
    hero.abil = { endure: { until: 12, enduring: true, damageBonus: 0, hitsLeft: 0 } };
    expect(endureAdjust(hero, 1, 20)).toBe(10);
    expect(hero.abil.endure!.damageBonus).toBe(10);
    setTalents(heroById(world, 'p')!, { shrugItOff: 4 });
    expect(endureAdjust(hero, 1, 20)).toBeCloseTo(20 * 0.5 * 0.8 ** 4, 5);
    endEnduring({ world, depth: 1, level: levelAt(world, 1), floor: floorAt(world, 1), rng: new Rng(floorAt(world, 1).rng), effects: [] }, { ...hero, time: 3 });
  });

  it('endure ends by itself after twelve turns', () => {
    const world = ready('warrior', 'endure');
    const hero = heroById(world, 'p')!;
    special(world);
    expect(endureAdjust(hero, 13, 20)).toBe(20);
    expect(hero.abil?.endure).toBeUndefined();
  });
});
