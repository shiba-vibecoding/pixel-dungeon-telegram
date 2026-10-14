import { describe, expect, it } from 'vitest';
import { addHero, createWorld, heroById, visibleCells, visibleEnemies } from '@pd/core';
import { forgetSight, seenCells, seenEnemies } from '../src/sight';

function setup(seed = 11) {
  const world = createWorld(seed);
  addHero(world, { id: 'p', name: 'P', heroClass: 'warrior' });
  return { world, hero: heroById(world, 'p')! };
}

describe('what the party sees, kept between two turns', () => {
  it('is what the rules say, made once until the world changes', () => {
    forgetSight();
    const { world, hero } = setup();
    const first = seenCells(world, hero.depth);
    expect([...first]).toEqual(visibleCells(world, hero.depth));
    expect(seenCells(world, hero.depth)).toBe(first);
    expect(seenEnemies(world, hero)).toBe(seenEnemies(world, hero));
    expect(seenEnemies(world, hero).map((mob) => mob.id)).toEqual(visibleEnemies(world, hero).map((mob) => mob.id));
  });

  it('is made again after an action (the turn counts up) and after a restart (a new seed in the same world)', () => {
    forgetSight();
    const { world, hero } = setup();
    const first = seenCells(world, hero.depth);
    world.turn++;
    const second = seenCells(world, hero.depth);
    expect(second).not.toBe(first);
    world.run.seed = world.run.seed + 1;
    expect(seenCells(world, hero.depth)).not.toBe(second);
  });

  it('is not shared between two worlds', () => {
    forgetSight();
    const a = setup(11);
    const b = setup(12);
    const seenA = seenCells(a.world, a.hero.depth);
    expect(seenCells(b.world, b.hero.depth)).not.toBe(seenA);
  });
});
