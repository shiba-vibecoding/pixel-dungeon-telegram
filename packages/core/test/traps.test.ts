import { describe, expect, it } from 'vitest';
import {
  act, addHero, canEnter, charAt, createItem, createWorld, F, findPath, floorAt, hasFlag, heroById, levelAt,
  NEIGHBOURS8, setTrap, T, type TrapKind, type World,
  WIDTH,
} from '../src/index';
import { pacify } from './helpers';

/*
 * Traps as the party meets them on a level (Level.pressCell, Trap.trigger): what each kind does is
 * shattered-traps.test.ts's.
 */

/** A hero next to a freshly laid trap of the given kind, in sight or hidden. */
function besideTrap(kind: TrapKind, visible = true, seed = 6): { world: World; cell: number } {
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
  setTrap(level, cell, kind, visible);
  return { world, cell };
}

describe('traps', () => {
  it('go off under a thrown dart that lands on them, as Level.drop presses the cell', () => {
    const { world, cell } = besideTrap('toxic');
    const hero = heroById(world, 'p')!;
    hero.items.push(createItem('missile.dart', 1));
    const result = act(world, 'p', { type: 'throw', item: hero.items.length - 1, target: cell });
    expect(result.ok && result.effects).toContainEqual({ type: 'trap', depth: 1, pos: cell, kind: 'toxic', hero: '' });
    expect(levelAt(world, 1).map[cell]).toBe(T.INACTIVE_TRAP);
  });

  it('a hidden trap is found as it goes off under the hero, and is spent', () => {
    const { world, cell } = besideTrap('ooze', false);
    const hero = heroById(world, 'p')!;
    expect(levelAt(world, 1).map[cell]).toBe(T.SECRET_TRAP);
    const result = act(world, 'p', { type: 'move', to: cell });
    expect(result.ok && result.effects).toContainEqual({ type: 'trap', depth: 1, pos: cell, kind: 'ooze', hero: 'p', hidden: true });
    expect(levelAt(world, 1).map[cell]).toBe(T.INACTIVE_TRAP);
    expect(levelAt(world, 1).traps!.find((t) => t.pos === cell)).toMatchObject({ visible: true, active: false });
    expect(world.explored[1]![cell]).toBe(true);
    expect(hero.ooze).toBeGreaterThanOrEqual(0);
  });

  it('summoning traps call monsters around their victim', () => {
    const { world, cell } = besideTrap('summoning');
    floorAt(world, 1).mobs = [];
    act(world, 'p', { type: 'move', to: cell });
    const summoned = floorAt(world, 1).mobs;
    expect(summoned.length).toBeGreaterThanOrEqual(1);
    for (const mob of summoned) expect(Math.max(Math.abs((mob.pos % WIDTH) - (cell % WIDTH)), Math.abs(Math.trunc(mob.pos / WIDTH) - Math.trunc(cell / WIDTH)))).toBeLessThanOrEqual(2);
  });

  it('a burning trap sets the hero alight', () => {
    const { world, cell } = besideTrap('burning');
    const hero = heroById(world, 'p')!;
    act(world, 'p', { type: 'move', to: cell });
    expect(hero.burning).toBeGreaterThan(0);
    const hp = hero.hp;
    act(world, 'p', { type: 'wait' });
    expect(hero.hp).toBeLessThan(hp);
  });

  it('a pitfall trap gives way a turn later: the hero still on it falls to the depth below', () => {
    const { world, cell } = besideTrap('pitfall');
    const hero = heroById(world, 'p')!;
    const result = act(world, 'p', { type: 'move', to: cell });
    expect(result.ok && result.effects).toContainEqual(expect.objectContaining({ type: 'pitfall', stage: 'warn' }));
    const after = act(world, 'p', { type: 'search' });
    expect(after.ok && after.effects).toContainEqual(expect.objectContaining({ type: 'pitfall', stage: 'open' }));
    expect(hero.depth).toBe(2);
  });

  it('walking paths step around visible traps', () => {
    const world = pacify(createWorld(6));
    addHero(world, { id: 'p', name: 'P', heroClass: 'warrior' });
    const level = levelAt(world, 1);
    const hero = heroById(world, 'p')!;
    const path = findPath(level, hero.pos, level.exit)!;
    const middle = path[Math.trunc(path.length / 2)]!;
    setTrap(level, middle, 'toxic', true);
    const around = findPath(level, hero.pos, level.exit);
    if (around) expect(around).not.toContain(middle);
    // Unless the trap is the destination.
    expect(findPath(level, hero.pos, middle)?.at(-1)).toBe(middle);
  });
});
