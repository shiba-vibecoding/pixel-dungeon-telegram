import { describe, expect, it } from 'vitest';
import {
  act, addHero, canEnter, charAt, createItem, createMob, createWorld, durabilityPerUse, floorAt, heroById, isStackable, type Item,
  ItemGenerator, type ItemKind, levelAt, missileStats, type Mob, NEIGHBOURS8, Rng, T, usesLeft, WIDTH, type World,
} from '../src/index';
import { pacify } from './helpers';

/** A hero with a stack of one thrown weapon, and a tough rat two cells away along an open line. */
function range(kind: ItemKind, qty = 3): { world: World; rat: Mob } {
  for (let seed = 1; seed <= 40; seed++) {
    const world = pacify(createWorld(seed));
    addHero(world, { id: 'p', name: 'P', heroClass: 'huntress' });
    const hero = heroById(world, 'p')!;
    Object.assign(hero, { str: 20, attackSkill: 100000 });
    hero.items = [createItem(kind, qty)];
    const map = levelAt(world, 1);
    for (const dir of [1, -1, WIDTH, -WIDTH]) {
      const line = [1, 2, 3].map((k) => hero.pos + dir * k);
      if (!line.every((c) => canEnter(map, c) && map.map[c] !== T.DOOR && !charAt(world, 1, c))) continue;
      const rat = createMob('#rat', 'rat', line[1]!, 'hunting', floorAt(world, 1).now);
      Object.assign(rat, { enemy: 'p', target: hero.pos, hp: 100000, ht: 100000, enemySeen: true });
      floorAt(world, 1).mobs.push(rat);
      return { world, rat };
    }
  }
  throw new Error('no open line');
}

const throwAt = (world: World, rat: Mob, index = 0) => act(world, 'p', { type: 'throw', item: index, target: rat.pos });
const lying = (world: World, kind: ItemKind): Item[] => floorAt(world, 1).heaps.flatMap((h) => h.items.filter((i) => i.kind === kind));

describe('thrown weapons (MissileWeapon)', () => {
  it('are found in sets of three, of the chapter\'s tiers, not knowing their level; darts never alone', () => {
    const generator = new ItemGenerator(Rng.seeded(2), 3);
    const kinds = new Set<string>();
    for (let i = 0; i < 600; i++) {
      const item = generator.of('missile');
      kinds.add(item.kind);
      expect(item.qty).toBe(3);
      expect(item.set).toBeGreaterThan(0);
      expect(item).toMatchObject({ levelUnknown: true, curseUnknown: true });
      expect(isStackable(item.kind)).toBe(true);
    }
    // Generator.floorSetTierProbs: the sewers give tiers 2 to 5, mostly 2 (75%); tier 1 only in the kits.
    expect(kinds).toContain('missile.shuriken');
    expect(kinds).not.toContain('missile.throwingKnife');
    expect(kinds).not.toContain('missile.dart');
  });

  it("have Shattered's numbers", () => {
    expect(missileStats(createItem('missile.tomahawk'))).toEqual({ min: 6, max: 16, str: 15, tier: 4 });
    expect(missileStats(createItem('missile.javelin'))).toEqual({ min: 8, max: 20, str: 15, tier: 4 });
    expect(missileStats(createItem('missile.dart'))).toEqual({ min: 1, max: 2, str: 9, tier: 1 });
    expect(missileStats(createItem('missile.forceCube', 1, 1))).toEqual({ min: 11, max: 35, str: 16, tier: 5 });
    // durabilityPerUse: 100 over the uses, a hundredth more; darts last forever.
    expect(durabilityPerUse(createItem('missile.shuriken'))).toBeCloseTo(20.001, 3);
    expect(usesLeft(createItem('missile.javelin'))).toEqual({ left: 8, max: 8 });
    expect(usesLeft(createItem('missile.javelin', 1, 1))).toEqual({ left: 12, max: 12 });
    expect(usesLeft(createItem('missile.dart'))).toBeNull();
  });

  it('wear out a use at a time: the one thrown when the stack has none left breaks', () => {
    const { world, rat } = range('missile.shuriken', 2);
    const hero = heroById(world, 'p')!;
    const effects = [];
    for (let i = 0; i < 6 && hero.items[0]?.kind === 'missile.shuriken'; i++) {
      // Each hit sticks the copy in the rat; pull them back out between throws.
      const result = throwAt(world, rat);
      if (result.ok) effects.push(...result.effects);
      for (const stuck of rat.pinned ?? []) {
        const stack = hero.items.find((item) => item.kind === 'missile.shuriken');
        if (stack) {
          stack.qty += 1;
        } else {
          hero.items.unshift(stuck);
        }
      }
      rat.pinned = [];
    }
    // Five uses: the fifth hit warns, the sixth breaks one.
    expect(effects.some((e) => e.type === 'worn' && e.state === 'warning')).toBe(true);
    expect(effects.some((e) => e.type === 'worn' && e.state === 'broken')).toBe(true);
  });

  it('bolas cripple, a paralytic dart paralyses, a tomahawk makes bleed, a chilling dart chills, an incendiary one burns', () => {
    const checks: Array<[ItemKind, (rat: Mob) => boolean]> = [
      ['missile.bolas', (rat) => (rat.crippled ?? 0) > 0],
      ['missile.paralyticDart', (rat) => (rat.paralysed ?? 0) > 0],
      ['missile.tomahawk', (rat) => (rat.bleeding ?? 0) > 0],
      ['missile.chillingDart', (rat) => (rat.chill ?? 0) > 0],
      ['missile.incendiaryDart', (rat) => (rat.burning ?? 0) > 0],
    ];
    for (const [kind, check] of checks) {
      const { world, rat } = range(kind);
      expect(throwAt(world, rat).ok).toBe(true);
      expect(check(rat), kind).toBe(true);
    }
  });

  it('a tipped dart is spent in one hit, and leaves a plain dart behind', () => {
    const { world, rat } = range('missile.poisonDart', 1);
    throwAt(world, rat);
    expect(rat.poison).toBeGreaterThan(0);
    expect([...(rat.pinned ?? []), ...lying(world, 'missile.dart')].map((i) => i.kind)).toEqual(['missile.dart']);
  });

  it('a shuriken flies instantly once in twenty turns', () => {
    const { world, rat } = range('missile.shuriken');
    const hero = heroById(world, 'p')!;
    let before = hero.time;
    throwAt(world, rat);
    expect(hero.time - before).toBe(0);
    before = hero.time;
    throwAt(world, rat);
    expect(hero.time - before).toBe(1);
  });

  it('a heavy boomerang circles back to where it was thrown from, five turns later', () => {
    const { world, rat } = range('missile.heavyBoomerang', 1);
    const hero = heroById(world, 'p')!;
    throwAt(world, rat);
    expect(hero.items.some((i) => i.kind === 'missile.heavyBoomerang')).toBe(false);
    expect(hero.circling).toHaveLength(1);
    floorAt(world, 1).mobs = [];
    for (let i = 0; i < 6; i++) act(world, 'p', { type: 'wait' });
    expect(hero.items.some((i) => i.kind === 'missile.heavyBoomerang')).toBe(true);
  });

  it('a force cube strikes whoever stands where it lands and all around', () => {
    const { world, rat } = range('missile.forceCube');
    const hero = heroById(world, 'p')!;
    const level = levelAt(world, 1);
    const cell = NEIGHBOURS8.map((n) => rat.pos + n).find((c) => canEnter(level, c) && !charAt(world, 1, c) && c !== hero.pos)!;
    const other = createMob('#other', 'rat', cell, 'hunting', floorAt(world, 1).now);
    Object.assign(other, { hp: 100000, ht: 100000, enemySeen: true });
    floorAt(world, 1).mobs.push(other);
    const result = throwAt(world, rat);
    const struck = result.ok ? result.effects.filter((e) => e.type === 'attack' && e.attacker === 'p').map((e) => e.type === 'attack' && e.target) : [];
    expect(struck).toContain('#rat');
    expect(struck).toContain('#other');
    expect(lying(world, 'missile.forceCube')).toHaveLength(1);
  });

  it('a thrown one picked up goes back onto its stack, its wear added up', () => {
    const { world, rat } = range('missile.javelin');
    const hero = heroById(world, 'p')!;
    floorAt(world, 1).mobs = [];
    throwAt(world, rat);
    const copy = lying(world, 'missile.javelin')[0]!;
    expect(copy.qty).toBe(1);
    hero.pos = floorAt(world, 1).heaps.find((h) => h.items.includes(copy))!.pos;
    act(world, 'p', { type: 'pickup' });
    expect(hero.items.filter((i) => i.kind === 'missile.javelin')).toMatchObject([{ qty: 3 }]);
  });

  it('upgraded, a set is whole and three again, and its older copies left about turn to dust', () => {
    const { world, rat } = range('missile.javelin', 3);
    const hero = heroById(world, 'p')!;
    hero.items[0]!.set = 77;
    floorAt(world, 1).mobs = [];
    throwAt(world, rat);
    throwAt(world, rat);
    expect(hero.items[0]!.qty).toBe(1);
    hero.items.push(createItem('scroll.upgrade'));
    expect(act(world, 'p', { type: 'use', item: 1, on: 0 }).ok).toBe(true);
    expect(hero.items[0]).toMatchObject({ kind: 'missile.javelin', qty: 3, level: 1 });
    expect(hero.items[0]!.durability).toBeUndefined();
    const heap = floorAt(world, 1).heaps.find((h) => h.items.some((i) => i.kind === 'missile.javelin'))!;
    hero.pos = heap.pos;
    const result = act(world, 'p', { type: 'pickup' });
    expect(result.ok && result.effects.some((e) => e.type === 'dust')).toBe(true);
    expect(hero.items.filter((i) => i.kind === 'missile.javelin')).toMatchObject([{ qty: 3 }]);
  });
});

describe('darts (Dart, TippedDart)', () => {
  it('are tipped with a seed, two to a seed, and wiped clean again', () => {
    const world = pacify(createWorld(4));
    const hero = addHero(world, { id: 'p', name: 'P', heroClass: 'rogue' });
    hero.items = [createItem('missile.dart', 7), createItem('seed.icecap', 2)];
    expect(act(world, 'p', { type: 'tip', item: 0, seed: 1 }).ok).toBe(true);
    expect(hero.items).toMatchObject([{ kind: 'missile.dart', qty: 5 }, { kind: 'seed.icecap', qty: 1 }, { kind: 'missile.chillingDart', qty: 2 }]);
    expect(act(world, 'p', { type: 'tip', item: 0, seed: 1, all: true }).ok).toBe(true);
    expect(hero.items).toMatchObject([{ kind: 'missile.dart', qty: 3 }, { kind: 'missile.chillingDart', qty: 4 }]);
    expect(act(world, 'p', { type: 'tip', item: 0, seed: 0 })).toEqual({ ok: false, reason: 'choose a seed' });
    expect(act(world, 'p', { type: 'clean', item: 1 }).ok).toBe(true);
    expect(hero.items).toMatchObject([{ kind: 'missile.dart', qty: 4 }, { kind: 'missile.chillingDart', qty: 3 }]);
    expect(act(world, 'p', { type: 'clean', item: 1, all: true }).ok).toBe(true);
    expect(hero.items).toMatchObject([{ kind: 'missile.dart', qty: 7 }]);
  });

  it('thrown with a crossbow in hand, they hit as hard as the crossbow makes them', () => {
    const { world, rat } = range('missile.dart', 20);
    const hero = heroById(world, 'p')!;
    hero.weapon = createItem('weapon.crossbow');
    const damage: number[] = [];
    for (let i = 0; i < 15; i++) {
      const result = throwAt(world, rat);
      for (const e of result.ok ? result.effects : []) if (e.type === 'attack' && e.hit) damage.push(e.damage);
    }
    // Crossbow.dartMin/dartMax: 4 to 12 (a dart alone: 1 to 2), and strength to spare on top.
    expect(Math.max(...damage)).toBeGreaterThan(4);
  });
});
