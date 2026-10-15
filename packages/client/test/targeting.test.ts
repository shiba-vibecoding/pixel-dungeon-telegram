import { beforeEach, describe, expect, it } from 'vitest';
import { addHero, createWorld, distance, heroById, isAlive, levelAt, type Mob, passable, visibleCells, type World } from '@pd/core';
import { quickUse } from '../src/quickslot';
import { forgetSight } from '../src/sight';
import {
  autoAim, fireAtTarget, lastTargetIn, refreshTarget, rememberTarget, resetTargeting, shotPath, startTargeting, usesTargeting,
} from '../src/targeting';

/** A hero and two monsters put in plain sight, `near` and `far` cells away along the open floor. */
function setup() {
  const world = createWorld(23);
  addHero(world, { id: 'p', name: 'P', heroClass: 'huntress' });
  const hero = heroById(world, 'p')!;
  const level = levelAt(world, hero.depth);
  const walkable = passable(level.map);
  const see = visibleCells(world, hero.depth);
  const floor = world.floors[hero.depth]!;
  const cells = see.flatMap((seen, cell) => (seen && walkable[cell] && cell !== hero.pos ? [cell] : []));
  // The nearest two cells in sight that a shot lands on, one of them further than the other.
  cells.sort((a, b) => distance(hero.pos, a) - distance(hero.pos, b));
  const clear = cells.filter((cell) => shotPath(world, level, hero.depth, hero.pos, cell).at(-1) === cell);
  const mobs = floor.mobs.filter((m) => m.hp > 0).slice(0, 2);
  expect(mobs.length).toBe(2);
  const [nearMob, farMob] = mobs as [Mob, Mob];
  nearMob.pos = clear[2]!;
  farMob.pos = clear[clear.length - 1]!;
  for (const m of mobs) {
    m.state = 'hunting';
    m.ally = false;
  }
  forgetSight();
  return { world, hero, level, nearMob, farMob };
}

describe('aiming from a quick slot (QuickSlotButton.lastTarget, autoAim)', () => {
  beforeEach(() => {
    resetTargeting();
    forgetSight();
  });

  it('thrown weapons, bows, wands and bombs aim at the marked target; seeds and wards do not', () => {
    for (const kind of ['missile.throwingStone', 'spiritBow', 'wand.fireblast', 'bomb'] as const) {
      expect(quickUse(kind), kind).not.toBeNull();
    }
    expect(usesTargeting('missile.throwingStone')).toBe(true);
    expect(usesTargeting('spiritBow')).toBe(true);
    expect(usesTargeting('wand.fireblast')).toBe(true);
    expect(usesTargeting('wand.warding')).toBe(false);
    expect(usesTargeting('missile.healingDart')).toBe(false);
    expect(usesTargeting('food.ration')).toBe(false);
  });

  it('with no last target, the nearest enemy in sight that a shot can reach becomes it', () => {
    const { world, hero, level, nearMob, farMob } = setup();
    expect(startTargeting(world, hero)).toBe(false);
    refreshTarget(world, level, hero);
    expect(lastTargetIn([nearMob, farMob])).toBe(nearMob);
    expect(startTargeting(world, hero)).toBe(true);
  });

  it('keeps the last target across turns while it is in sight and alive, and swaps it when it dies', () => {
    const { world, hero, level, nearMob, farMob } = setup();
    rememberTarget(farMob);
    refreshTarget(world, level, hero);
    expect(lastTargetIn([nearMob, farMob])).toBe(farMob);
    // A new turn: the nearer one stands closer still, the choice is kept.
    world.turn++;
    refreshTarget(world, level, hero);
    expect(lastTargetIn([nearMob, farMob])).toBe(farMob);
    // It dies (and is gone): the nearest takes its place.
    farMob.hp = 0;
    expect(isAlive(farMob)).toBe(false);
    world.floors[hero.depth]!.mobs = world.floors[hero.depth]!.mobs.filter((m) => m !== farMob);
    world.turn++;
    refreshTarget(world, level, hero);
    expect(lastTargetIn([nearMob])).toBe(nearMob);
    expect(fireAtTarget(world, level, hero)?.mob).toBe(nearMob);
  });

  it('the slot tapped again fires at the marked target: its own cell when the way is clear', () => {
    const { world, hero, level, nearMob, farMob } = setup();
    rememberTarget(farMob);
    expect(startTargeting(world, hero)).toBe(true);
    const shot = fireAtTarget(world, level, hero)!;
    expect(shot.mob).toBe(farMob);
    expect(shot.cell).toBe(farMob.pos);
    expect(shotPath(world, level, hero.depth, hero.pos, shot.cell).at(-1)).toBe(farMob.pos);
    expect(nearMob.pos).not.toBe(farMob.pos);
  });

  it('autoAim angles the shot round whatever is in the way, or gives -1', () => {
    const { world, hero, level, nearMob } = setup();
    expect(autoAim(world, level, hero, nearMob.pos)).toBe(nearMob.pos);
    // A wall cell is not a place a shot can end on.
    const wall = level.map.findIndex((_, cell) => !passable(level.map)[cell] && cell > 100);
    expect(autoAim(world, level, hero, wall)).toBe(-1);
  });

  it('nothing to fire at when the target has left sight', () => {
    const { world, hero, level, farMob } = setup();
    rememberTarget(farMob);
    expect(startTargeting(world, hero)).toBe(true);
    farMob.pos = level.map.findIndex((_, cell) => cell > 100 && !visibleCells(world, hero.depth)[cell]);
    world.turn++;
    expect(fireAtTarget(world, level, hero)).toBeNull();
  });
});
