import { describe, expect, it } from 'vitest';
import {
  act, addHero, createMob, createWorld, F, floorAt, hasFlag, heroById, type HeroClass, heroRangedSkill, levelAt,
  LENGTH, type World,
} from '../src/index';
import { pacify } from './helpers';

/** A hero and a sleeping rat a few cells away in a straight, open line. */
function range(heroClass: HeroClass, seed = 7): { world: World; ratPos: number } {
  for (let s = seed; s < seed + 50; s++) {
    const world = pacify(createWorld(s));
    addHero(world, { id: 'p', name: 'P', heroClass });
    const hero = heroById(world, 'p')!;
    const level = levelAt(world, 1);
    for (const step of [1, -1, 32, -32]) {
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
  it('starting kits: stand-ins for the stones, knives and bow, a wand for the mage (heroclass.ts KIT_SEAMS)', () => {
    const world = createWorld(1);
    for (const heroClass of ['warrior', 'mage', 'rogue', 'huntress'] as const) addHero(world, { id: heroClass, name: heroClass, heroClass });
    expect(heroById(world, 'warrior')!.items).toEqual([
      { kind: 'missile.dart', qty: 8, level: 0 },
      { kind: 'food.ration', qty: 1, level: 0 },
      { kind: 'bag.seeds', qty: 1, level: 0 },
      { kind: 'waterskin', qty: 1, level: 0 },
    ]);
    expect(heroById(world, 'rogue')!.items[0]).toMatchObject({ kind: 'missile.dart', qty: 8 });
    expect(heroById(world, 'huntress')!.items[0]).toMatchObject({ kind: 'missile.boomerang' });
    expect(heroById(world, 'mage')!.items[0]).toMatchObject({ kind: 'wand.magicMissile', charges: 3 });
  });

  it('a dart flies to the first creature in line; misses land on the floor, hits are used up', () => {
    let hits = 0;
    let misses = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const { world, ratPos } = range('rogue', seed * 13);
      const hero = heroById(world, 'p')!;
      const result = act(world, 'p', { type: 'throw', item: 0, target: ratPos });
      expect(result.ok).toBe(true);
      expect(hero.items[0]!.qty).toBe(7);
      const effects = result.ok ? result.effects : [];
      expect(effects[0]).toMatchObject({ type: 'thrown', to: ratPos, item: 'missile.dart' });
      const shot = effects.find((e) => e.type === 'attack' && e.attacker === 'p');
      const onFloor = floorAt(world, 1).heaps.some((h) => h.pos === ratPos && h.items.some((i) => i.kind === 'missile.dart'));
      if (shot?.type === 'attack' && shot.hit) {
        hits++;
        expect(onFloor).toBe(false);
      } else {
        misses++;
        expect(onFloor).toBe(true);
      }
    }
    // A sleeping rat cannot dodge: the rogue hits it every time.
    expect(hits).toBe(12);
    expect(misses).toBe(0);
  });

  it('the boomerang always comes back', () => {
    const { world, ratPos } = range('huntress');
    const hero = heroById(world, 'p')!;
    expect(act(world, 'p', { type: 'throw', item: 0, target: ratPos }).ok).toBe(true);
    expect(hero.items[0]!.kind).toBe('missile.boomerang');
    expect(floorAt(world, 1).heaps.some((h) => h.items.some((i) => i.kind === 'missile.boomerang'))).toBe(false);
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

  it('every class throws alike (Shattered has no class bonuses); nobody well point-blank', () => {
    const world = createWorld(2);
    for (const heroClass of ['warrior', 'rogue', 'huntress'] as const) addHero(world, { id: heroClass, name: heroClass, heroClass });
    const dart = { kind: 'missile.dart' as const, qty: 1, level: 0 };
    const skill = (id: string, pointBlank = false) => heroRangedSkill(heroById(world, id)!, dart, pointBlank);
    expect(skill('huntress')).toBe(10);
    expect(skill('rogue')).toBe(10);
    expect(skill('warrior')).toBe(10);
    expect(skill('rogue', true)).toBe(5);
  });
});
