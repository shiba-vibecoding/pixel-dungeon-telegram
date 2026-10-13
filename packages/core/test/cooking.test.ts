import { describe, expect, it } from 'vitest';
import {
  act, addHero, canEnter, charAt, createItem, createMob, createWorld, F, floorAt, hasFlag, heroAttackDelay, heroById, heroDefenseSkill,
  levelAt, type Mob, T, WIDTH, type World,
} from '../src/index';
import { pacify } from './helpers';

/** A hero, sturdy enough not to mind a fire, and an open line two cells long from them. */
function line(seed = 3): { world: World; near: number; far: number } {
  for (let s = seed; s < seed + 40; s++) {
    const world = pacify(createWorld(s));
    addHero(world, { id: 'p', name: 'P', heroClass: 'warrior' });
    const hero = heroById(world, 'p')!;
    Object.assign(hero, { hp: 500, ht: 500 });
    const level = levelAt(world, 1);
    for (const dir of [1, -1, WIDTH, -WIDTH]) {
      const cells = [1, 2, 3].map((k) => hero.pos + dir * k);
      if (cells.every((c) => canEnter(level, c) && level.map[c] === T.EMPTY && !charAt(world, 1, c))) {
        return { world, near: cells[0]!, far: cells[2]! };
      }
    }
  }
  throw new Error('no open line');
}

describe('cooking, burning and freezing', () => {
  it('fire burns scrolls lying about and chargrills mystery meat; frost freezes it', () => {
    let { world, far } = line();
    let hero = heroById(world, 'p')!;
    floorAt(world, 1).heaps.push({ pos: far, kind: 'heap', items: [createItem('scroll.identify'), createItem('food.meat', 2)] });
    hero.items = [createItem('potion.liquidFlame')];
    act(world, 'p', { type: 'throw', item: 0, target: far });
    expect(floorAt(world, 1).heaps.find((h) => h.pos === far)?.items).toEqual([createItem('food.steak', 2)]);

    ({ world, far } = line());
    hero = heroById(world, 'p')!;
    floorAt(world, 1).heaps.push({ pos: far, kind: 'heap', items: [createItem('food.meat')] });
    hero.items = [createItem('potion.frost')];
    act(world, 'p', { type: 'throw', item: 0, target: far });
    expect(floorAt(world, 1).heaps.find((h) => h.pos === far)?.items).toEqual([createItem('food.carpaccio')]);
  });

  it('a burning hero may lose scrolls from the pack, and have meat cooked in it', () => {
    const { world } = line();
    const hero = heroById(world, 'p')!;
    hero.items = [createItem('scroll.identify', 5), createItem('food.meat', 5)];
    hero.burning = 8;
    for (let i = 0; i < 8; i++) act(world, 'p', { type: 'wait' });
    const qty = (kind: string): number => hero.items.find((i) => i.kind === kind)?.qty ?? 0;
    expect(qty('scroll.identify') + qty('food.meat')).toBeLessThan(10);
    expect(qty('food.steak')).toBe(5 - qty('food.meat'));
  });

  it('frozen carpaccio is safe to eat, and often does some good', () => {
    const outcomes = new Set<string | null>();
    for (let seed = 1; seed <= 12; seed++) {
      const world = pacify(createWorld(seed));
      addHero(world, { id: 'p', name: 'P', heroClass: 'rogue' });
      const hero = heroById(world, 'p')!;
      hero.items = [createItem('food.carpaccio')];
      hero.hp = 5;
      hero.poison = 5;
      const result = act(world, 'p', { type: 'use', item: 0 });
      const ate = result.ok ? result.effects.find((e) => e.type === 'ate') : undefined;
      if (ate?.type === 'ate') outcomes.add(ate.outcome);
      expect(hero.burning + hero.rooted + hero.slowed).toBe(0);
    }
    expect([...outcomes].every((o) => o === null || ['invisible', 'barkskin', 'refreshed', 'better'].includes(o))).toBe(true);
    expect(outcomes.size).toBeGreaterThan(1);
  });
});

describe('bombs', () => {
  it('blow up a moment after they land (Bomb.Fuse), hurting whoever is next to them, and burning the grass', () => {
    const { world, near, far } = line();
    const level = levelAt(world, 1);
    const rat: Mob = createMob('#rat', 'rat', far, 'hunting', floorAt(world, 1).now);
    Object.assign(rat, { enemy: 'p', hp: 1000, ht: 1000, paralysed: 10 });
    floorAt(world, 1).mobs.push(rat);
    const beside = (near + far) / 2;
    level.map[beside] = T.GRASS;
    const hero = heroById(world, 'p')!;
    hero.items = [createItem('bomb', 2)];
    const thrown = act(world, 'p', { type: 'throw', item: 0, target: far });
    expect(thrown.ok && thrown.effects.some((e) => e.type === 'exploded')).toBe(false);
    expect(floorAt(world, 1).heaps.find((h) => h.pos === far)!.items[0]!.fuse).toBeDefined();
    const effects = [...(act(world, 'p', { type: 'wait' }) as { effects: { type: string }[] }).effects, ...(act(world, 'p', { type: 'wait' }) as { effects: { type: string }[] }).effects];
    expect(effects.some((e) => e.type === 'exploded')).toBe(true);
    expect(hero.items[0]!.qty).toBe(1);
    expect(rat.hp).toBeLessThan(1000);
    expect(hasFlag(level.map[beside]!, F.FLAMABLE)).toBe(false);
  });
});

describe('the stone of augmentation', () => {
  it('reshapes a melee weapon for speed or for damage, and is used up', () => {
    const { world } = line();
    const hero = heroById(world, 'p')!;
    hero.items = [createItem('stone.augmentation', 2)];
    const delay = heroAttackDelay(hero);
    // WEAPON_AUGMENTS: none, speed, damage.
    expect(act(world, 'p', { type: 'use', item: 0, on: 'weapon', choice: 1 }).ok).toBe(true);
    expect(hero.weapon!.augment).toBe('speed');
    expect(heroAttackDelay(hero)).toBeCloseTo(delay * (2 / 3));
    expect(act(world, 'p', { type: 'use', item: 0, on: 'weapon', choice: 1 })).toEqual({ ok: false, reason: 'it is augmented that way already' });
    expect(act(world, 'p', { type: 'use', item: 0, on: 'weapon', choice: 2 }).ok).toBe(true);
    expect(heroAttackDelay(hero)).toBeCloseTo(delay * (5 / 3));
  });

  it('augments by its own action too: a weapon for speed or damage, armour for evasion or defence', () => {
    const { world } = line();
    const hero = heroById(world, 'p')!;
    hero.items = [createItem('stone.augmentation', 3)];
    const delay = heroAttackDelay(hero);
    expect(act(world, 'p', { type: 'augment', item: 0, on: 'weapon', augment: 'speed' }).ok).toBe(true);
    expect(hero.weapon!.augment).toBe('speed');
    // Weapon.Augment.SPEED: two thirds of the delay.
    expect(heroAttackDelay(hero)).toBeCloseTo(delay * (2 / 3));
    expect(act(world, 'p', { type: 'augment', item: 0, on: 'weapon', augment: 'speed' })).toEqual({ ok: false, reason: 'it is augmented that way already' });
    expect(act(world, 'p', { type: 'augment', item: 0, on: 'weapon', augment: 'evasion' })).toEqual({ ok: false, reason: 'bad choice' });
    const evasion = heroDefenseSkill(hero);
    expect(act(world, 'p', { type: 'augment', item: 0, on: 'armor', augment: 'evasion' }).ok).toBe(true);
    // Armor.Augment.EVASION: two more evasion a level step.
    expect(heroDefenseSkill(hero)).toBe(evasion + 4);
    expect(act(world, 'p', { type: 'augment', item: 0, on: 'weapon', augment: 'none' }).ok).toBe(true);
    expect(hero.weapon!.augment).toBeUndefined();
    expect(hero.items).toEqual([]);
  });
});
