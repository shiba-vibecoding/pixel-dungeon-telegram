import { describe, expect, it } from 'vitest';
import {
  act, addHero, createMob, createWorld, F, floorAt, hasFlag, heroAttackSkill, heroById, type HeroClass, levelAt,
  LENGTH, WIDTH, type World,
} from '../src/index';
import { pacify } from './helpers';

/** A hero and a sleeping rat a few cells away in a straight, open line. */
function range(heroClass: HeroClass, seed = 7): { world: World; ratPos: number } {
  for (let s = seed; s < seed + 50; s++) {
    const world = pacify(createWorld(s));
    addHero(world, { id: 'p', name: 'P', heroClass });
    const hero = heroById(world, 'p')!;
    const level = levelAt(world, 1);
    for (const step of [1, -1, WIDTH, -WIDTH]) {
      const line = [1, 2, 3].map((k) => hero.pos + step * k);
      if (line.every((c) => c >= 0 && c < LENGTH && hasFlag(level.map[c]!, F.PASSABLE) && !hasFlag(level.map[c]!, F.LOS_BLOCKING))) {
        const ratPos = line[2]!;
        floorAt(world, 1).mobs.push(createMob('#50', 'rat', ratPos, 'sleeping', 0));
        return { world, ratPos };
      }
    }
  }
  throw new Error('no open line found');
}

describe('thrown weapons and wands', () => {
  it("starting kits: Shattered's, as to weapons", () => {
    const world = createWorld(1);
    for (const heroClass of ['warrior', 'mage', 'rogue', 'huntress'] as const) addHero(world, { id: heroClass, name: heroClass, heroClass });
    expect(heroById(world, 'warrior')!.weapon).toMatchObject({ kind: 'weapon.wornShortsword' });
    expect(heroById(world, 'warrior')!.items).toEqual([
      { kind: 'missile.throwingStone', qty: 3, level: 0 },
      { kind: 'food.ration', qty: 1, level: 0 },
      { kind: 'bag.seeds', qty: 1, level: 0 },
      { kind: 'waterskin', qty: 1, level: 0 },
    ]);
    expect(heroById(world, 'rogue')!.items[0]).toMatchObject({ kind: 'missile.throwingKnife', qty: 3 });
    expect(heroById(world, 'huntress')!.items[0]).toMatchObject({ kind: 'spiritBow' });
    expect(heroById(world, 'huntress')!.weapon).toMatchObject({ kind: 'weapon.gloves' });
    expect(heroById(world, 'mage')!.items[0]).toMatchObject({ kind: 'wand.magicMissile', charges: 3 });
  });

  it('a throwing knife flies to the first creature in line: a miss lands on the floor, a hit sticks in it and the stack wears', () => {
    let hits = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const { world, ratPos } = range('rogue', seed * 13);
      const hero = heroById(world, 'p')!;
      const result = act(world, 'p', { type: 'throw', item: 0, target: ratPos });
      expect(result.ok).toBe(true);
      expect(hero.items[0]!.qty).toBe(2);
      const effects = result.ok ? result.effects : [];
      expect(effects[0]).toMatchObject({ type: 'thrown', to: ratPos, item: 'missile.throwingKnife' });
      const shot = effects.find((e) => e.type === 'attack' && e.attacker === 'p');
      const onFloor = floorAt(world, 1).heaps.some((h) => h.pos === ratPos && h.items.some((i) => i.kind === 'missile.throwingKnife'));
      const rat = floorAt(world, 1).mobs.find((m) => m.id === '#50');
      if (shot?.type === 'attack' && shot.hit) {
        hits++;
        // PinCushion: stuck in the rat (or, slain, at its feet); the stack in the pack wore by a use (5 uses: a fifth).
        expect(rat ? rat.pinned?.length === 1 : onFloor).toBe(true);
        expect(hero.items[0]!.durability).toBeCloseTo(100 - 20.001, 2);
      } else {
        expect(onFloor).toBe(true);
      }
    }
    // A sleeping rat cannot dodge: the rogue hits it every time.
    expect(hits).toBe(12);
  });

  it('the spirit bow shoots arrows that never land, as strong as the huntress is seasoned', () => {
    const { world, ratPos } = range('huntress');
    const hero = heroById(world, 'p')!;
    const result = act(world, 'p', { type: 'shoot', item: 0, target: ratPos });
    expect(result.ok && result.effects.some((e) => e.type === 'missile' && e.to === ratPos)).toBe(true);
    expect(result.ok && result.effects.some((e) => e.type === 'attack' && e.attacker === 'p' && e.hit)).toBe(true);
    expect(hero.items[0]!.kind).toBe('spiritBow');
    expect(floorAt(world, 1).heaps.some((h) => h.pos === ratPos)).toBe(false);
    expect(act(world, 'p', { type: 'throw', item: 0, target: ratPos }).ok).toBe(true);
  });

  it('the wand never misses, spends charges and recharges over time', () => {
    const { world, ratPos } = range('mage');
    const hero = heroById(world, 'p')!;
    const result = act(world, 'p', { type: 'zap', item: 0, target: ratPos });
    expect(result.ok && result.effects.some((e) => e.type === 'attack' && e.hit && e.damage >= 1 && e.damage <= 5)).toBe(true);
    expect(hero.items[0]!.charges).toBe(2);
    act(world, 'p', { type: 'zap', item: 0, target: ratPos });
    act(world, 'p', { type: 'zap', item: 0, target: ratPos });
    expect(act(world, 'p', { type: 'zap', item: 0, target: ratPos })).toEqual({ ok: false, reason: 'the wand is out of charges' });
    floorAt(world, 1).mobs = [];
    for (let i = 0; i < 41; i++) act(world, 'p', { type: 'wait' });
    expect(hero.items[0]!.charges).toBe(1);
  });

  it('thrown, a weapon is half as accurate point-blank and half as accurate again from afar (adjacentAccFactor)', () => {
    const world = createWorld(2);
    const hero = addHero(world, { id: 'p', name: 'P', heroClass: 'rogue' });
    const knife = { kind: 'missile.throwingKnife' as const, qty: 1, level: 0 };
    expect(heroAttackSkill(hero, hero.pos + 1, knife)).toBe(5);
    expect(heroAttackSkill(hero, hero.pos + 3, knife)).toBe(15);
    // Too heavy (a trident wants 17): 1.5× less accurate a point short.
    const trident = { kind: 'missile.trident' as const, qty: 1, level: 0 };
    expect(heroAttackSkill(hero, hero.pos + 3, trident)).toBe(Math.round(15 / 1.5 ** 7));
    // Every class throws alike (Shattered has no class bonuses).
    for (const heroClass of ['warrior', 'huntress'] as const) {
      const other = addHero(world, { id: heroClass, name: heroClass, heroClass });
      expect(heroAttackSkill(other, other.pos + 3, knife)).toBe(15);
    }
  });
});
