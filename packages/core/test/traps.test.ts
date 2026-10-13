import { describe, expect, it } from 'vitest';
import {
  act, addHero, canEnter, charAt, createItem, createMob, createWorld, F, findPath, floorAt, hasFlag, heroById, levelAt,
  NEIGHBOURS8, T, type World,
  WIDTH,
} from '../src/index';
import { pacify } from './helpers';

/** A hero next to a freshly laid trap of the given terrain. */
function besideTrap(trap: number, seed = 6): { world: World; cell: number } {
  const world = pacify(createWorld(seed));
  // The mage: the warrior's seal would shield him from the traps' blows.
  addHero(world, { id: 'p', name: 'P', heroClass: 'mage' });
  const hero = heroById(world, 'p')!;
  const level = levelAt(world, 1);
  // Any plain floor beside the hero (not a door or the stairs): the trap is laid there.
  const plain = (c: number): boolean => ([T.EMPTY, T.EMPTY_SP, T.EMPTY_DECO, T.GRASS] as number[]).includes(level.map[c]!);
  const free = (c: number): boolean => canEnter(level, c) && !charAt(world, 1, c) && level.map[c] !== T.DOOR && level.map[c] !== T.OPEN_DOOR;
  const around = NEIGHBOURS8.map((n) => hero.pos + n);
  // Plain floor if there is any; otherwise whatever can be walked on (a flooded room).
  const cell = around.find((c) => plain(c) && free(c)) ?? around.find((c) => free(c) && hasFlag(level.map[c]!, F.PASSABLE))!;
  level.map[cell] = trap;
  return { world, cell };
}

describe('traps', () => {
  it('go off under a thrown dart that lands on them, as Level.drop presses the cell', () => {
    const { world, cell } = besideTrap(T.TOXIC_TRAP);
    const hero = heroById(world, 'p')!;
    hero.items.push(createItem('missile.dart', 1));
    const result = act(world, 'p', { type: 'throw', item: hero.items.length - 1, target: cell });
    expect(result.ok && result.effects).toContainEqual({ type: 'trap', depth: 1, pos: cell, kind: 'toxic', hero: '' });
    expect(levelAt(world, 1).map[cell]).toBe(T.INACTIVE_TRAP);
  });

  it('poison darts hurt a little every turn, and a spent trap stays harmless', () => {
    const { world, cell } = besideTrap(T.SECRET_POISON_TRAP);
    const hero = heroById(world, 'p')!;
    const result = act(world, 'p', { type: 'move', to: cell });
    expect(result.ok && result.effects).toContainEqual({ type: 'trap', depth: 1, pos: cell, kind: 'poison', hero: 'p' });
    expect(levelAt(world, 1).map[cell]).toBe(T.INACTIVE_TRAP);
    expect(world.explored[1]![cell]).toBe(true);
    // Four turns of poison on the first floor, one damage each.
    expect(hero.hp).toBe(20);
    expect(hero.poison).toBe(4);
    for (let i = 0; i < 5; i++) act(world, 'p', { type: 'wait' });
    expect(hero.poison).toBe(0);
    expect(hero.hp).toBe(16);
  });

  it('paralytic gas freezes heroes and monsters nearby for a few turns', () => {
    const { world, cell } = besideTrap(T.PARALYTIC_TRAP);
    const hero = heroById(world, 'p')!;
    const level = levelAt(world, 1);
    const rat = createMob('#90', 'rat', NEIGHBOURS8.map((n) => cell + n).find((c) => canEnter(level, c) && hasFlag(level.map[c]!, F.PASSABLE) && level.map[c] !== T.DOOR && !charAt(world, 1, c) && c !== hero.pos)!, 'hunting', 0);
    floorAt(world, 1).mobs.push(rat);
    const result = act(world, 'p', { type: 'move', to: cell });
    // The paralysed turns pass at once, for as long as the cloud lingers and a
    // few turns after; the rat in it is held just as long, and gets at most a
    // bite or two in.
    expect(hero.time).toBeGreaterThan(6);
    expect(hero.paralysed).toBe(0);
    expect(rat.paralysed ?? 0).toBeLessThanOrEqual(1);
    expect(result.ok && result.effects.filter((e) => e.type === 'attack').length).toBeLessThanOrEqual(2);
  });

  it('summoning traps call monsters around their victim', () => {
    const { world, cell } = besideTrap(T.SUMMONING_TRAP);
    act(world, 'p', { type: 'move', to: cell });
    const summoned = floorAt(world, 1).mobs;
    expect(summoned.length).toBeGreaterThanOrEqual(1);
    for (const mob of summoned) expect(Math.max(Math.abs((mob.pos % WIDTH) - (cell % WIDTH)), Math.abs(Math.trunc(mob.pos / WIDTH) - Math.trunc(cell / WIDTH)))).toBeLessThanOrEqual(2);
  });

  it('lightning takes a third to two thirds of the health', () => {
    const { world, cell } = besideTrap(T.LIGHTNING_TRAP);
    const hero = heroById(world, 'p')!;
    act(world, 'p', { type: 'move', to: cell });
    expect(hero.hp).toBeLessThanOrEqual(20 - 6);
    expect(hero.hp).toBeGreaterThanOrEqual(20 - 14);
  });

  it('fire burns until washed off and scorches the grass', () => {
    const { world, cell } = besideTrap(T.FIRE_TRAP);
    const hero = heroById(world, 'p')!;
    act(world, 'p', { type: 'move', to: cell });
    expect(hero.burning).toBeGreaterThan(0);
    act(world, 'p', { type: 'wait' });
    expect(hero.hp).toBeLessThan(20);
  });

  it('walking paths step around visible traps', () => {
    const world = pacify(createWorld(6));
    addHero(world, { id: 'p', name: 'P', heroClass: 'warrior' });
    const level = levelAt(world, 1);
    const hero = heroById(world, 'p')!;
    const path = findPath(level, hero.pos, level.exit)!;
    const middle = path[Math.trunc(path.length / 2)]!;
    level.map[middle] = T.TOXIC_TRAP;
    const around = findPath(level, hero.pos, level.exit);
    if (around) expect(around).not.toContain(middle);
    // Unless the trap is the destination.
    expect(findPath(level, hero.pos, middle)?.at(-1)).toBe(middle);
  });
});
