import { describe, expect, it } from 'vitest';
import {
  act, addHero, canEnter, charAt, createItem, createMob, createWorld, floorAt, heroById, levelAt, NEIGHBOURS8,
} from '../src/index';
import { pacify } from './helpers';

describe("Lloyd's beacon", () => {
  it('takes its bearer back where it was set, even from another depth, as often as wanted', () => {
    const world = pacify(createWorld(8));
    addHero(world, { id: 'p', name: 'P', heroClass: 'mage' });
    const hero = heroById(world, 'p')!;
    hero.items = [createItem('artifact.beacon')];
    expect(act(world, 'p', { type: 'artifact', item: 0, use: 'return' })).toEqual({ ok: false, reason: 'art:cannot' });
    const spot = hero.pos;
    expect(act(world, 'p', { type: 'artifact', item: 0, use: 'set' }).ok).toBe(true);
    expect(hero.items[0]!.returnTo).toEqual({ depth: 1, pos: spot });

    hero.pos = levelAt(world, 1).exit;
    expect(act(world, 'p', { type: 'descend' }).ok).toBe(true);
    expect(hero.depth).toBe(2);
    expect(act(world, 'p', { type: 'artifact', item: 0, use: 'return' }).ok).toBe(true);
    expect([hero.depth, hero.pos]).toEqual([1, spot]);
    // Shattered's beacon stays set.
    expect(hero.items[0]!.returnTo).toEqual({ depth: 1, pos: spot });
  });

  it('will not work with a monster right next to the bearer', () => {
    const world = pacify(createWorld(8));
    addHero(world, { id: 'p', name: 'P', heroClass: 'mage' });
    const hero = heroById(world, 'p')!;
    hero.items = [createItem('artifact.beacon')];
    const level = levelAt(world, 1);
    const beside = NEIGHBOURS8.map((n) => hero.pos + n).find((c) => canEnter(level, c) && !charAt(world, 1, c))!;
    floorAt(world, 1).mobs.push(createMob('#rat', 'rat', beside, 'sleeping', 0));
    expect(act(world, 'p', { type: 'artifact', item: 0, use: 'set' })).toEqual({ ok: false, reason: 'art:lloydsbeacon.creatures' });
  });

  it('worn, zaps a monster elsewhere on the level, for a charge', () => {
    const world = pacify(createWorld(8));
    addHero(world, { id: 'p', name: 'P', heroClass: 'mage' });
    const hero = heroById(world, 'p')!;
    hero.artifact = { ...createItem('artifact.beacon'), charge: 3 };
    const level = levelAt(world, 1);
    const beside = NEIGHBOURS8.map((n) => hero.pos + n).find((c) => canEnter(level, c) && !charAt(world, 1, c))!;
    const rat = createMob('#rat', 'rat', beside, 'sleeping', 0);
    floorAt(world, 1).mobs.push(rat);
    expect(act(world, 'p', { type: 'artifact', item: 'artifact', use: 'zap', cell: beside }).ok).toBe(true);
    expect(rat.pos).not.toBe(beside);
    expect(hero.artifact.charge).toBe(2);
  });
});
