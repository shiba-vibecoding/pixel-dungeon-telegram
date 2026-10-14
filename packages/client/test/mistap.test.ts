import { describe, expect, it } from 'vitest';
import { addHero, createWorld, exploredCells, findPath, floorAt, heroById, levelAt, LENGTH, T } from '@pd/core';
import { burningCells, firstDanger, stepDanger } from '../src/mistap';

/** A new run, the hero at the stairs, and a cell beside them to put things on. */
function setup() {
  const world = createWorld(11);
  addHero(world, { id: 'p', name: 'P', heroClass: 'warrior' });
  const hero = heroById(world, 'p')!;
  const level = levelAt(world, hero.depth);
  floorAt(world, hero.depth);
  const beside = [-1, 1, -32, 32].map((d) => hero.pos + d).find((c) => level.map[c] === T.EMPTY)
    ?? hero.pos + 1;
  return { world, hero, level, beside };
}

describe('mis-tap protection: what a step would be', () => {
  it('a trap in sight is a danger, a hidden one is not known', () => {
    const { world, hero, level, beside } = setup();
    exploredCells(world, hero.depth)[beside] = true;
    level.map[beside] = T.SECRET_TRAP;
    expect(stepDanger(world, hero, level, beside)).toBeNull();
    level.map[beside] = T.TRAP;
    expect(stepDanger(world, hero, level, beside)).toBe('trap');
    // Floating over it, or an inactive trap, is no danger.
    hero.levitating = 5;
    expect(stepDanger(world, hero, level, beside)).toBeNull();
    hero.levitating = 0;
    level.map[beside] = T.INACTIVE_TRAP;
    expect(stepDanger(world, hero, level, beside)).toBeNull();
  });

  it('flames in sight are a danger, unless the hero is burning already', () => {
    const { world, hero, level, beside } = setup();
    const floor = floorAt(world, hero.depth);
    floor.gas = { fire: [[beside, 3]] };
    expect(burningCells(world, hero.depth).has(beside)).toBe(true);
    expect(stepDanger(world, hero, level, beside)).toBe('fire');
    hero.burning = 4;
    expect(stepDanger(world, hero, level, beside)).toBeNull();
  });

  it('finds the first danger along a walk', () => {
    const { world, hero, level, beside } = setup();
    exploredCells(world, hero.depth)[beside] = true;
    level.map[beside] = T.TRAP;
    expect(firstDanger(world, hero, level, [hero.pos, beside])).toEqual({ index: 1, danger: 'trap' });
    expect(firstDanger(world, hero, level, [hero.pos])).toBeNull();
  });
});

describe('mis-tap protection: the route of a tap', () => {
  it('goes round a monster, a known trap or flames in sight when another way exists', () => {
    const { world, hero, level } = setup();
    const explored = exploredCells(world, hero.depth);
    explored.fill(true);
    // Find a goal two or more steps away whose shortest way has an alternative.
    let checked = 0;
    for (let goal = 0; goal < LENGTH && checked < 5; goal++) {
      const way = findPath(level, hero.pos, goal, new Set(), explored);
      if (!way || way.length < 3) continue;
      const first = way[0]!;
      const blocked = new Set([first]);
      const round = findPath(level, hero.pos, goal, blocked, explored);
      if (!round) continue;
      expect(round).not.toContain(first);
      checked++;
      // Flames are a blocked cell of the route: the same way round.
      const fire = floorAt(world, hero.depth);
      fire.gas = { fire: [[first, 2]] };
      const flames = burningCells(world, hero.depth);
      expect(findPath(level, hero.pos, goal, flames, explored)).toEqual(round);
    }
    expect(checked).toBeGreaterThan(0);
  });
});
