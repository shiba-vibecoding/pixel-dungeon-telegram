import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createRun, generateLevel, T, WIDTH } from '../src/index';
import { Feeling } from '../src/level/gen/dungeon';
import type { GenLevel } from '../src/level/gen/genlevel';
import type { Room } from '../src/level/gen/room';
import { STANDARD_ROOMS } from '../src/level/gen/rooms/standard/registry';
import { F, terrainFlags } from '../src/level/terrain';
import { paintRoomAlone } from './levelgen-helpers';

/* The standard rooms (levels/rooms/standard, its entrance and exit rooms), each on its own and in whole levels. */

type Side = 'left' | 'top' | 'right' | 'bottom';

/** Where one can walk (or step, onto a trap, or through a door, hidden or not). */
const walkable = (t: number): boolean =>
  (terrainFlags[t]! & F.PASSABLE) !== 0 || t === T.TRAP || t === T.SECRET_TRAP || t === T.SECRET_DOOR || t === T.DOOR || t === T.LOCKED_DOOR;

/** Kinds others port into the same table. */
const NOT_MINE = new Set(['ImpShopRoom', 'EmptyRoom', 'EntranceRoom', 'ExitRoom']);
const KINDS = [...STANDARD_ROOMS.keys()].filter((k) => !NOT_MINE.has(k));

const DEPTHS = [1, 3, 8, 13, 18, 23];
const LAYOUTS: Side[][] = [['left', 'right'], ['top'], ['left', 'top', 'right', 'bottom'], ['bottom', 'left'], ['right'], ['top', 'bottom']];

/** Cells of the room (walls included) reachable from its doors without leaving it. */
function reachedFromDoors(level: GenLevel, room: Room): Set<number> {
  const inRoom = (c: number): boolean => {
    const x = c % level.width;
    const y = Math.trunc(c / level.width);
    return x >= room.left && x <= room.right && y >= room.top && y <= room.bottom;
  };
  const queue = room.doors().map((d) => level.pointToCell(d));
  const seen = new Set(queue);
  for (let head = 0; head < queue.length; head++) {
    const cell = queue[head]!;
    for (const n of level.neighbours8) {
      const next = cell + n;
      if (seen.has(next) || !inRoom(next) || !walkable(level.map[next]!)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return seen;
}

function checkRoom(kind: string, depth: number, sides: Side[], seed: number): void {
  const where = `${kind} at depth ${depth}, doors ${sides.join('/')}, seed ${seed}`;
  const { level, room } = paintRoomAlone(STANDARD_ROOMS.get(kind)!, depth, sides, seed, Feeling.NONE);
  expect(room.kind, where).toBe(kind);

  for (const door of room.doors()) {
    const inside = level.pointToCell(room.pointInside(door, 1));
    expect(walkable(level.map[inside]!), `${where}: inside of door ${door.x},${door.y} is ${level.map[inside]}`).toBe(true);
  }

  const reached = reachedFromDoors(level, room);
  for (let x = room.left + 1; x < room.right; x++) {
    for (let y = room.top + 1; y < room.bottom; y++) {
      const cell = level.pointToCell({ x, y });
      if (walkable(level.map[cell]!)) expect(reached.has(cell), `${where}: ${x},${y} cut off`).toBe(true);
    }
  }

  const cells = (terrains: number[]): number[] => {
    const found: number[] = [];
    for (let i = 0; i < level.length; i++) if (terrains.includes(level.map[i]!)) found.push(i);
    return found;
  };
  const entrances = cells([T.ENTRANCE, T.ENTRANCE_SP]);
  const exits = cells([T.EXIT]);
  if (room.isEntrance()) {
    expect(entrances, where).toHaveLength(1);
    expect(exits, where).toHaveLength(0);
    expect(level.transitions, where).toHaveLength(1);
    expect(level.transitions[0]!.cell, where).toBe(entrances[0]);
    expect(['entrance', 'surface'], where).toContain(level.transitions[0]!.type);
  } else if (room.isExit()) {
    expect(exits, where).toHaveLength(1);
    expect(entrances, where).toHaveLength(0);
    expect(level.transitions, where).toHaveLength(1);
    expect(level.transitions[0]!.cell, where).toBe(exits[0]);
    expect(level.transitions[0]!.type, where).toBe('exit');
  } else {
    expect(entrances.length + exits.length + level.transitions.length, where).toBe(0);
  }
}

describe('the standard rooms', () => {
  it('registers every kind the chance tables draw from', () => {
    const source = readFileSync(new URL('../src/level/gen/rooms/standard/registry.ts', import.meta.url), 'utf8');
    const named = new Set([...source.matchAll(/'(\w+Room)'/g)].map((m) => m[1]!));
    expect(named.size).toBeGreaterThan(50);
    for (const kind of named) expect(STANDARD_ROOMS.has(kind), kind).toBe(true);
  });

  for (const kind of KINDS) {
    it(`${kind} paints alone, open from every door`, () => {
      let seed = 1;
      for (const depth of DEPTHS) {
        for (const sides of LAYOUTS) {
          checkRoom(kind, depth, sides, seed);
          seed += 7;
        }
      }
    });
  }
});

/** Cells reachable from one over walkable ground (secret doors included). */
function reachable(map: readonly number[], from: number): Set<number> {
  const seen = new Set([from]);
  const queue = [from];
  const dirs = [-WIDTH - 1, -WIDTH, -WIDTH + 1, -1, +1, WIDTH - 1, WIDTH, WIDTH + 1];
  for (let head = 0; head < queue.length; head++) {
    const cell = queue[head]!;
    for (const d of dirs) {
      const next = cell + d;
      if (next < 0 || next >= map.length || seen.has(next) || !walkable(map[next]!)) continue;
      // No wrapping round the map's edge.
      if (Math.abs((next % WIDTH) - (cell % WIDTH)) > 1) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return seen;
}

describe('levels of standard rooms', () => {
  const depths = [1, 2, 3, 4, 6, 7, 8, 9, 11, 12, 13, 14, 16, 17, 18, 19, 21, 22, 23, 24];
  for (let seed = 1; seed <= 10; seed++) {
    it(`run ${seed}: every floor is made, its way down reachable from its way up`, () => {
      const run = createRun(seed * 101);
      for (const depth of depths) {
        const level = generateLevel(run, depth);
        expect(level.entrance, `depth ${depth}`).toBeGreaterThanOrEqual(0);
        expect(level.exit, `depth ${depth}`).toBeGreaterThanOrEqual(0);
        expect(reachable(level.map, level.entrance).has(level.exit), `run ${seed}, depth ${depth}`).toBe(true);
      }
    }, 60_000);
  }
});
