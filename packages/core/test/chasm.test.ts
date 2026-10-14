import { describe, expect, it } from 'vitest';
import {
  act, addHero, canEnter, cellX, cellY, createItem, createWorld, F, floorAt, hasFlag, heroById, levelAt,
  NEIGHBOURS8, RoomType, T, type Level, type RoomInfo, type World,
} from '../src/index';
import { pacify } from './helpers';

const isPassable = (level: Level, pos: number): boolean => hasFlag(level.map[pos]!, F.PASSABLE);

const inside = (room: RoomInfo, pos: number): boolean =>
  cellX(pos) > room.left && cellX(pos) < room.right && cellY(pos) > room.top && cellY(pos) < room.bottom;

/** A run whose depth `depth` (1-3) has a weak floor, with its pit room below. */
function weakFloorRun(): { world: World; depth: number } {
  for (let seed = 1; seed < 400; seed++) {
    const world = createWorld(seed);
    for (let depth = 1; depth <= 3; depth++) {
      if (levelAt(world, depth).rooms.some((room) => room.type === RoomType.WEAK_FLOOR)) return { world, depth };
    }
  }
  throw new Error('no weak floor in 400 runs');
}

/** Puts a solo hero on `depth`, on a ledge cell next to a chasm cell; returns that chasm cell. */
function standByChasm(world: World, depth: number, where: (level: Level, pos: number) => boolean): number {
  pacify(world);
  addHero(world, { id: 'p', name: 'P', heroClass: 'warrior' });
  const hero = heroById(world, 'p')!;
  const level = levelAt(world, depth);
  for (let pos = 0; pos < level.map.length; pos++) {
    if (!hasFlag(level.map[pos]!, F.PIT) || !where(level, pos)) continue;
    const ledge = NEIGHBOURS8.map((n) => pos + n).find((c) => isPassable(level, c));
    if (ledge === undefined) continue;
    Object.assign(hero, { depth, pos: ledge, time: floorAt(world, depth).now });
    return pos;
  }
  throw new Error('no chasm with a ledge');
}

describe('chasms', () => {
  it('a weak floor has a pit room beneath it behind a crystal door, with remains and its key', () => {
    const { world, depth } = weakFloorRun();
    const below = levelAt(world, depth + 1);
    const pit = below.rooms.find((room) => room.type === RoomType.PIT)!;
    expect(pit).toBeDefined();
    const doors = below.map.flatMap((t, pos) => (t === T.CRYSTAL_DOOR ? [pos] : []));
    expect(doors.some((pos) => cellX(pos) >= pit.left && cellX(pos) <= pit.right && cellY(pos) >= pit.top && cellY(pos) <= pit.bottom))
      .toBe(true);
    const remains = floorAt(world, depth + 1).heaps.find((heap) => heap.kind === 'skeleton' && inside(pit, heap.pos))!;
    expect(remains.items.some((item) => item.kind === 'key.crystal' && item.depth === depth + 1)).toBe(true);
    expect(remains.items.length).toBeGreaterThanOrEqual(3);
  });

  it('jumping into a weak floor lands the hero in the pit room, hurt and crippled', () => {
    const { world, depth } = weakFloorRun();
    const weak = levelAt(world, depth).rooms.find((room) => room.type === RoomType.WEAK_FLOOR)!;
    const chasm = standByChasm(world, depth, (_, pos) => inside(weak, pos));
    const hero = heroById(world, 'p')!;
    expect(act(world, 'p', { type: 'move', to: chasm }).ok).toBe(false);
    const result = act(world, 'p', { type: 'jump', to: chasm });
    expect(result.ok && result.effects).toContainEqual({ type: 'fell', hero: 'p', depth, pos: chasm });
    expect(hero.depth).toBe(depth + 1);
    const pit = levelAt(world, depth + 1).rooms.find((room) => room.type === RoomType.PIT)!;
    expect(inside(pit, hero.pos)).toBe(true);
    expect(hero.hp).toBeLessThan(hero.ht);
    expect(hero.crippled).toBeGreaterThan(0);
  });

  it('only a chasm right beside the hero can be jumped into', () => {
    const { world, depth } = weakFloorRun();
    const chasm = standByChasm(world, depth, () => true);
    const hero = heroById(world, 'p')!;
    const floorCell = NEIGHBOURS8.map((n) => hero.pos + n).find((c) => canEnter(levelAt(world, depth), c))!;
    expect(act(world, 'p', { type: 'jump', to: floorCell })).toEqual({ ok: false, reason: 'no chasm there' });
    hero.rooted = 5;
    expect(act(world, 'p', { type: 'jump', to: chasm })).toEqual({ ok: false, reason: 'you are rooted' });
  });

  it('what is thrown into a chasm turns up on the depth below', () => {
    const { world, depth } = weakFloorRun();
    const chasm = standByChasm(world, depth, () => true);
    const hero = heroById(world, 'p')!;
    hero.items = [createItem('missile.dart', 1)];
    const darts = (): number[] =>
      floorAt(world, depth + 1).heaps.filter((heap) => heap.items.some((item) => item.kind === 'missile.dart')).map((h) => h.pos);
    const before = darts();
    expect(act(world, 'p', { type: 'throw', item: 0, target: chasm }).ok).toBe(true);
    expect(floorAt(world, depth).heaps.some((heap) => heap.pos === chasm)).toBe(false);
    const landed = darts().filter((pos) => !before.includes(pos));
    expect(landed).toHaveLength(1);
    expect(isPassable(levelAt(world, depth + 1), landed[0]!)).toBe(true);
  });
});
