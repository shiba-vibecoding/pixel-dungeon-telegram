import { describe, expect, it } from 'vitest';
import {
  act, addHero, createWorld, F, floorAt, hasFlag, heroById, LENGTH, levelAt, NEIGHBOURS8, RoomType, T, type World,
} from '../src/index';
import { pacify } from './helpers';

/** Cells reachable from the entrance with hidden and locked doors open and barricades burnt. */
function reachable(world: World, depth: number): Set<number> {
  const level = levelAt(world, depth);
  const open = (c: number): boolean =>
    hasFlag(level.map[c]!, F.PASSABLE) || hasFlag(level.map[c]!, F.AVOID) ||
    level.map[c] === T.SECRET_DOOR || level.map[c] === T.LOCKED_DOOR || level.map[c] === T.BARRICADE ||
    level.map[c] === T.BOOKSHELF || level.map[c] === T.CRYSTAL_DOOR || level.map[c] === T.CHASM;
  const seen = new Set([level.entrance]);
  const queue = [level.entrance];
  for (let head = 0; head < queue.length; head++) {
    for (const n of NEIGHBOURS8) {
      const next = queue[head]! + n;
      if (next >= 0 && next < LENGTH && !seen.has(next) && open(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen;
}

describe('special rooms', () => {
  it('appear across runs, each locked room with its key somewhere on the level', () => {
    const found = new Map<RoomType, number>();
    for (let seed = 1; seed <= 60; seed++) {
      const world = createWorld(seed * 7);
      for (let depth = 1; depth <= 4; depth++) {
        const level = levelAt(world, depth);
        const heaps = floorAt(world, depth).heaps;
        const locked = level.map.filter((t) => t === T.LOCKED_DOOR).length;
        const keys = heaps.flatMap((h) => h.items).filter((i) => i.kind === 'key.iron' && i.depth === depth).length;
        expect(keys, `seed ${seed * 7} depth ${depth}`).toBe(locked);
        for (const room of level.rooms) found.set(room.type, (found.get(room.type) ?? 0) + 1);
        // Every item can be reached from the entrance (through hidden and locked doors).
        const reach = reachable(world, depth);
        for (const heap of heaps) expect(reach.has(heap.pos), `heap at ${heap.pos}`).toBe(true);
        expect(level.wells.every((w) => level.map[w.pos] === T.WELL)).toBe(true);
        // A storage room comes with the liquid flame to burn its barricade.
        if (level.rooms.some((room) => room.type === RoomType.STORAGE)) {
          expect(heaps.flatMap((h) => h.items).some((i) => i.kind === 'potion.liquidFlame')).toBe(true);
        }
      }
    }
    for (const type of [
      RoomType.TREASURY, RoomType.ARMORY, RoomType.LIBRARY, RoomType.CRYPT, RoomType.MAGIC_WELL, RoomType.TRAPS, RoomType.STORAGE,
    ]) {
      expect(found.get(type) ?? 0, RoomType[type]).toBeGreaterThan(0);
    }
  });

  it('opens a locked door with the level key, and only with it', () => {
    for (let seed = 1; seed <= 80; seed++) {
      const world = pacify(createWorld(seed));
      const depth = [1, 2, 3, 4].find((d) => levelAt(world, d).map.includes(T.LOCKED_DOOR));
      if (!depth) continue;
      addHero(world, { id: 'p', name: 'P', heroClass: 'warrior' });
      const hero = heroById(world, 'p')!;
      const level = levelAt(world, depth);
      const door = level.map.indexOf(T.LOCKED_DOOR);
      const spot = NEIGHBOURS8.map((n) => door + n).find((c) => hasFlag(level.map[c]!, F.PASSABLE))!;
      Object.assign(hero, { depth, pos: spot, items: [] });
      expect(act(world, 'p', { type: 'move', to: door })).toEqual({ ok: false, reason: 'the door is locked' });
      hero.items.push({ kind: 'key.iron', qty: 1, level: 0, depth: depth + 1 });
      expect(act(world, 'p', { type: 'move', to: door }).ok).toBe(false);
      hero.items.push({ kind: 'key.iron', qty: 1, level: 0, depth });
      const result = act(world, 'p', { type: 'move', to: door });
      expect(result.ok && result.effects[0]).toMatchObject({ type: 'unlocked', pos: door });
      expect(hero.pos).toBe(door);
      expect(hero.items).toHaveLength(1);
      return;
    }
    throw new Error('no locked room found');
  });

  it('heals or enlightens once from a magic well', () => {
    for (let seed = 1; seed <= 120; seed++) {
      const world = pacify(createWorld(seed));
      const depth = [1, 2, 3, 4].find((d) => levelAt(world, d).wells.length > 0);
      if (!depth) continue;
      addHero(world, { id: 'p', name: 'P', heroClass: 'warrior' });
      const hero = heroById(world, 'p')!;
      const level = levelAt(world, depth);
      const { pos, water } = level.wells[0]!;
      const spot = NEIGHBOURS8.map((n) => pos + n).find((c) => hasFlag(level.map[c]!, F.PASSABLE))!;
      Object.assign(hero, { depth, pos: spot, hp: 3, poison: 5 });
      const result = act(world, 'p', { type: 'move', to: pos });
      expect(result.ok && result.effects).toContainEqual({ type: 'well', hero: 'p', water });
      expect(level.map[pos]).toBe(T.EMPTY_WELL);
      if (water === 'health') expect(hero).toMatchObject({ hp: 20, poison: 0 });
      else expect(world.explored[depth]![level.exit]).toBe(true);
      return;
    }
    throw new Error('no well found');
  });
});
