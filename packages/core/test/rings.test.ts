import { describe, expect, it } from 'vitest';
import {
  act, addHero, canEnter, charAt, createItem, createMob, createWorld, floorAt, heroAttackDelay, heroAttackSkill, heroById, heroRings, heroSpeed, heroStealth, heroStr, heroWeapon,
  ringBonus, Rng, tenacityMultiplier, wealthBonusDrops,
  type ItemKind, ITEMS, itemDef, itemSprite, levelAt, NEIGHBOURS8, type World,
} from '../src/index';
import { pacify } from './helpers';

function solo(heroClass: 'warrior' | 'rogue' = 'warrior'): World {
  const world = pacify(createWorld(17));
  addHero(world, { id: 'p', name: 'P', heroClass });
  heroById(world, 'p')!.items = [];
  return world;
}

describe('mimics', () => {
  it('lurk among the chests below the first depth, and spring when opened', () => {
    let mimics = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const world = createWorld(seed);
      for (let d = 1; d <= 4; d++) levelAt(world, d);
      expect(floorAt(world, 1).heaps.some((h) => h.kind === 'mimic')).toBe(false);
      for (let d = 2; d <= 4; d++) mimics += floorAt(world, d).heaps.filter((h) => h.kind === 'mimic').length;
    }
    expect(mimics).toBeGreaterThan(3);

    const world = solo();
    const hero = heroById(world, 'p')!;
    hero.gold = 100;
    const level = levelAt(world, 1);
    const pos = NEIGHBOURS8.map((n) => hero.pos + n).find((c) => canEnter(level, c) && !charAt(world, 1, c))!;
    floorAt(world, 1).heaps.push({ pos, kind: 'mimic', items: [createItem('potion.healing')] });
    act(world, 'p', { type: 'move', to: pos });
    const result = act(world, 'p', { type: 'pickup' });
    expect(result.ok && result.effects.some((e) => e.type === 'mimic')).toBe(true);
    const mimic = floorAt(world, 1).mobs.find((m) => m.kind === 'mimic')!;
    expect(mimic.pos).toBe(pos);
    expect(hero.pos).not.toBe(pos);
    // Mimic.adjustStats: (1 + level) * 6.
    expect(mimic.ht).toBe(12);
    // Slain, it gives the treasure back.
    hero.attackSkill = 1000;
    for (let i = 0; i < 30 && floorAt(world, 1).mobs.includes(mimic); i++) act(world, 'p', { type: 'attack', target: mimic.id });
    expect(floorAt(world, 1).heaps.some((h) => h.items.some((i) => i.kind === 'potion.healing'))).toBe(true);
  });
});

describe('rings', () => {
  it('go by their gem until known; the rogue sets out wearing the cloak of shadows, no ring', () => {
    const rings = (Object.keys(ITEMS) as ItemKind[]).filter((k) => itemDef(k).category === 'ring');
    expect(rings).toHaveLength(12);
    const labels = createWorld(5).run.labels;
    expect(new Set(rings.map((k) => itemSprite(createItem(k), labels))).size).toBe(12);

    const world = solo('rogue');
    const rogue = heroById(world, 'p')!;
    expect(heroRings(rogue)).toEqual([]);
    expect(rogue.artifact).toMatchObject({ kind: 'artifact.cloak', level: 0, charge: 3 });
    expect(heroStealth(rogue)).toBe(0);
  });

  it('two can be worn (the ring and misc slots); a third waits for the player to say which to take off', () => {
    const world = solo();
    const hero = heroById(world, 'p')!;
    hero.items = [createItem('ring.accuracy', 1, 2), createItem('ring.haste', 1, 1), createItem('ring.energy', 1, 1)];
    const before = heroAttackSkill(hero);
    act(world, 'p', { type: 'equip', item: 0 });
    // RingOfAccuracy: 1.3 for every point of bonus, a +2 ring's being three.
    expect(heroAttackSkill(hero)).toBe(Math.round(Math.fround(before * Math.fround(Math.fround(1.3) ** 3))));
    act(world, 'p', { type: 'equip', item: 0 });
    expect(heroRings(hero).map((r) => r.kind)).toEqual(['ring.haste', 'ring.accuracy']);
    expect(act(world, 'p', { type: 'equip', item: 0 })).toEqual({ ok: false, reason: 'choose what to take off' });
    // KindofMisc's window: a ring with a ring in the misc slot cannot take the artifact slot's place.
    expect(act(world, 'p', { type: 'equip', item: 0, replace: 'artifact' })).toEqual({ ok: false, reason: 'bad choice' });
    expect(act(world, 'p', { type: 'equip', item: 0, replace: 'ring' }).ok).toBe(true);
    expect([hero.misc?.kind, hero.ring?.kind]).toEqual(['ring.haste', 'ring.energy']);
    expect(hero.items.map((r) => r.kind)).toEqual(['ring.accuracy']);
    act(world, 'p', { type: 'remove', slot: 'misc' });
    expect(heroRings(hero).map((r) => r.kind)).toEqual(['ring.energy']);
    expect(hero.items).toHaveLength(2);
  });

  it('a ring worn tells what it is with experience, not with time (Ring.onHeroGainExp; see ident.test.ts)', () => {
    const world = solo();
    const hero = heroById(world, 'p')!;
    hero.items = [createItem('ring.tenacity', 1, 1)];
    act(world, 'p', { type: 'equip', item: 0 });
    expect(world.known).not.toContain('ring.tenacity');
    for (let i = 0; i < 210; i++) act(world, 'p', { type: 'wait' });
    expect(world.known).not.toContain('ring.tenacity');
  });

  it('haste quickens the step, not searching nor resting (RingOfHaste.speedMultiplier)', () => {
    const world = solo();
    const hero = heroById(world, 'p')!;
    hero.ring = createItem('ring.haste', 1, 3);
    expect(heroSpeed(hero)).toBeCloseTo(Math.fround(1.15 ** 4));
    let before = hero.time;
    act(world, 'p', { type: 'search' });
    expect(hero.time - before).toBe(2);
    before = hero.time;
    act(world, 'p', { type: 'wait' });
    expect(hero.time - before).toBe(1);
  });

  it('a cursed ring works against its wearer: a +0 cursed one as -2 (Ring.soloBonus)', () => {
    const world = solo();
    const hero = heroById(world, 'p')!;
    hero.ring = { ...createItem('ring.evasion', 1, 0), cursed: true };
    expect(ringBonus(hero, 'ring.evasion')).toBe(-2);
    hero.ring = createItem('ring.evasion', 1, 0);
    expect(ringBonus(hero, 'ring.evasion')).toBe(1);
  });

  it('might adds strength and health; furor quickens blows; force arms the bare hand', () => {
    const world = solo();
    const hero = heroById(world, 'p')!;
    const str = heroStr(hero);
    const ht = hero.ht;
    const delay = heroAttackDelay(hero);
    hero.items = [createItem('ring.might', 1, 1), createItem('ring.furor', 1, 0)];
    act(world, 'p', { type: 'equip', item: 0 });
    act(world, 'p', { type: 'equip', item: 0 });
    expect(heroStr(hero)).toBe(str + 2);
    expect(hero.ht).toBe(Math.round(Math.fround(1.035 ** 2) * ht));
    expect(heroAttackDelay(hero)).toBeCloseTo(delay / 1.09051);
    hero.weapon = null;
    hero.ring = createItem('ring.force', 1, 0);
    expect(heroWeapon(hero).max).toBeGreaterThan(heroStr(hero) - 8);
  });

  it('tenacity eases blows the more the wearer is hurt', () => {
    const world = solo();
    const hero = heroById(world, 'p')!;
    hero.ring = createItem('ring.tenacity', 1, 2);
    Object.assign(hero, { ht: 100, hp: 100 });
    expect(tenacityMultiplier(hero)).toBe(1);
    hero.hp = 10;
    expect(tenacityMultiplier(hero)).toBeCloseTo(0.85 ** (3 * 0.9));
  });

  it('wealth finds more: every few monsters, something extra', () => {
    const world = solo();
    const hero = heroById(world, 'p')!;
    hero.ring = createItem('ring.wealth', 1, 2);
    const ctx = { world, depth: 1, level: levelAt(world, 1), floor: floorAt(world, 1), rng: Rng.seeded(5), effects: [] };
    let found = 0;
    for (let i = 0; i < 100; i++) found += wealthBonusDrops(ctx, hero, 1).length;
    expect(found).toBeGreaterThan(3);
  });
});
