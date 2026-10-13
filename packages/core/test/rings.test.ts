import { describe, expect, it } from 'vitest';
import {
  act, addHero, canEnter, charAt, createItem, createMob, createWorld, floorAt, heroAttackSkill, heroById, heroRings, heroStealth,
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
    expect(mimic.ht).toBe(16);
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
    hero.items = [createItem('ring.accuracy', 1, 2), createItem('ring.haste', 1, 1), createItem('ring.mending', 1, 1)];
    const before = heroAttackSkill(hero);
    act(world, 'p', { type: 'equip', item: 0 });
    expect(heroAttackSkill(hero)).toBe(Math.round(Math.fround(before * Math.fround(1.4 ** 2))));
    act(world, 'p', { type: 'equip', item: 0 });
    expect(heroRings(hero).map((r) => r.kind)).toEqual(['ring.haste', 'ring.accuracy']);
    expect(act(world, 'p', { type: 'equip', item: 0 })).toEqual({ ok: false, reason: 'choose what to take off' });
    // KindofMisc's window: a ring with a ring in the misc slot cannot take the artifact slot's place.
    expect(act(world, 'p', { type: 'equip', item: 0, replace: 'artifact' })).toEqual({ ok: false, reason: 'bad choice' });
    expect(act(world, 'p', { type: 'equip', item: 0, replace: 'ring' }).ok).toBe(true);
    expect([hero.misc?.kind, hero.ring?.kind]).toEqual(['ring.haste', 'ring.mending']);
    expect(hero.items.map((r) => r.kind)).toEqual(['ring.accuracy']);
    act(world, 'p', { type: 'remove', slot: 'misc' });
    expect(heroRings(hero).map((r) => r.kind)).toEqual(['ring.mending']);
    expect(hero.items).toHaveLength(2);
  });

  it('a ring worn tells what it is with experience, not with time (Ring.onHeroGainExp; see ident.test.ts)', () => {
    const world = solo();
    const hero = heroById(world, 'p')!;
    hero.items = [createItem('ring.satiety', 1, 1)];
    act(world, 'p', { type: 'equip', item: 0 });
    expect(world.known).not.toContain('ring.satiety');
    for (let i = 0; i < 210; i++) act(world, 'p', { type: 'wait' });
    expect(world.known).not.toContain('ring.satiety');
  });

  it('haste makes everything quicker', () => {
    const world = solo();
    const hero = heroById(world, 'p')!;
    hero.ring = createItem('ring.haste', 1, 3);
    let before = hero.time;
    act(world, 'p', { type: 'search' });
    expect(hero.time - before).toBeCloseTo(2 * 1.1 ** -3);
    // Resting is a turn whatever (Hero.rest: spendConstant).
    before = hero.time;
    act(world, 'p', { type: 'wait' });
    expect(hero.time - before).toBe(1);
  });

  it('thorns turn some of a blow back on the attacker', () => {
    const world = solo();
    const hero = heroById(world, 'p')!;
    Object.assign(hero, { ht: 1000, hp: 1000, defenseSkill: 0 });
    hero.ring = createItem('ring.thorns', 1, 1);
    const level = levelAt(world, 1);
    const pos = NEIGHBOURS8.map((n) => hero.pos + n).find((c) => canEnter(level, c) && !charAt(world, 1, c))!;
    const rat = createMob('#rat', 'rat', pos, 'hunting', floorAt(world, 1).now);
    Object.assign(rat, { enemy: 'p', target: hero.pos, enemySeen: true, ht: 1000, hp: 1000 });
    floorAt(world, 1).mobs.push(rat);
    for (let i = 0; i < 30; i++) act(world, 'p', { type: 'wait' });
    expect(rat.hp).toBeLessThan(1000);
  });
});
