import { describe, expect, it } from 'vitest';
import {
  createRun, F, Feeling, generateLevel, hasFlag, LENGTH, type Level, NEIGHBOURS4, NEIGHBOURS8, passable, T, WIDTH,
} from '../src/index';
import { ascii } from './ascii';

const SEEDS = Array.from({ length: 300 }, (_, i) => i * 7919 + 1);

function generateRun(seed: number): Level[] {
  const run = createRun(seed);
  return [1, 2, 3, 4].map((depth) => generateLevel(run, depth));
}

/**
 * Cells a hero can eventually walk through: secret doors can be found, and
 * visible traps ("avoid" cells that are not pits) can be stepped on on purpose.
 */
function walkable(map: readonly number[]): boolean[] {
  const open = passable(map);
  return map.map(
    (t, i) =>
      open[i]! ||
      t === T.SECRET_DOOR ||
      t === T.LOCKED_DOOR ||
      t === T.CRYSTAL_DOOR ||
      // Shattered's chasm-filled traps rooms are crossed on a potion of levitation they come with.
      t === T.CHASM ||
      (hasFlag(t, F.AVOID) && !hasFlag(t, F.PIT) && i % WIDTH > 0 && i % WIDTH < WIDTH - 1),
  );
}

function reachable(map: readonly number[], from: number): boolean[] {
  const ok = walkable(map);
  const seen = new Array<boolean>(LENGTH).fill(false);
  const queue = [from];
  seen[from] = true;
  for (let head = 0; head < queue.length; head++) {
    const pos = queue[head]!;
    for (const n of NEIGHBOURS8) {
      const next = pos + n;
      // Barricades (and bookshelves standing in for them) burn away.
      const burnable = map[next] === T.BARRICADE || map[next] === T.BOOKSHELF;
      if (next >= 0 && next < LENGTH && !seen[next] && (ok[next] || burnable)) {
        seen[next] = true;
        queue.push(next);
      }
    }
  }
  return seen;
}

describe('sewer level generation', () => {
  const runs = SEEDS.map((seed) => ({ seed, levels: generateRun(seed) }));

  it('places a distinct entrance and exit', () => {
    for (const { seed, levels } of runs) {
      for (const level of levels) {
        const where = `seed ${seed} depth ${level.depth}`;
        expect([T.ENTRANCE, T.ENTRANCE_SP], where).toContain(level.map[level.entrance]);
        expect(level.map[level.exit], where).toBe(T.EXIT);
        expect(level.entrance, where).not.toBe(level.exit);
      }
    }
  });

  it('connects the exit and every walkable cell to the entrance', () => {
    for (const { seed, levels } of runs) {
      for (const level of levels) {
        const seen = reachable(level.map, level.entrance);
        const ok = walkable(level.map);
        const lost = ok.flatMap((w, i) => (w && !seen[i] && level.map[i] !== T.CHASM ? [i] : []));
        if (!seen[level.exit] || lost.length > 0) {
          throw new Error(
            `seed ${seed} depth ${level.depth}: exit reached=${seen[level.exit]}, ` +
              `${lost.length} unreachable cells (first ${lost[0]})\n${ascii(level.map)}`,
          );
        }
      }
    }
  });

  it('keeps the map border solid', () => {
    for (const { levels } of runs) {
      for (const level of levels) {
        for (let i = 0; i < LENGTH; i++) {
          const x = i % WIDTH;
          if (i < WIDTH || i >= LENGTH - WIDTH || x === 0 || x === WIDTH - 1) {
            expect(hasFlag(level.map[i]!, F.PASSABLE), `cell ${i}`).toBe(false);
          }
        }
      }
    }
  });

  it('sets doors into walls', () => {
    for (const { seed, levels } of runs) {
      for (const level of levels) {
        level.map.forEach((t, i) => {
          if (t !== T.DOOR && t !== T.SECRET_DOOR) return;
          const [up, right, down, left] = NEIGHBOURS4.map((n) => hasFlag(level.map[i + n]!, F.SOLID) && level.map[i + n] !== T.DOOR);
          if (!((up && down) || (left && right))) {
            throw new Error(`seed ${seed} depth ${level.depth}: door ${i} is not in a wall\n${ascii(level.map)}`);
          }
        });
      }
    }
  });

  it('is a pure function of the seed', () => {
    expect(generateRun(424242)).toEqual(generateRun(424242));
    expect(generateRun(1)[0]!.map).not.toEqual(generateRun(2)[0]!.map);
  });

  it('generates the prison and Tengu\'s level after the sewers', () => {
    for (const seed of SEEDS.slice(0, 80)) {
      const run = createRun(seed);
      const levels = Array.from({ length: 10 }, (_, i) => generateLevel(run, i + 1));
      for (const level of levels.slice(5, 9)) {
        const where = `seed ${seed} depth ${level.depth}`;
        expect([T.ENTRANCE, T.ENTRANCE_SP], where).toContain(level.map[level.entrance]);
        expect(level.map[level.exit], where).toBe(T.EXIT);
        const seen = reachable(level.map, level.entrance);
        const lost = walkable(level.map).flatMap((w, i) => (w && !seen[i] && level.map[i] !== T.CHASM ? [i] : []));
        if (!seen[level.exit] || lost.length > 0) {
          throw new Error(`${where}: exit reached=${seen[level.exit]}, ${lost.length} lost\n${ascii(level.map)}`);
        }
      }
      const boss = levels[9]!;
      const where = `seed ${seed} depth 10`;
      expect(boss.map[boss.arenaDoor!], where).toBe(T.LOCKED_DOOR);
      expect(boss.map[boss.exit], where).toBe(T.LOCKED_EXIT);
      expect(boss.items.filter((spawn) => spawn.item.roll === 'key'), where).toHaveLength(1);
      // Through the locked door, the whole level can be reached.
      const seen = reachable(boss.map, boss.entrance);
      expect(seen[boss.items[0]!.pos], where).toBe(true);
      expect(seen[boss.arenaDoor!], where).toBe(true);
      expect(boss.map.some((t) => t === T.INACTIVE_TRAP), where).toBe(true);
    }
  });

  it('first depth has only worn dart traps, no secret doors and no feeling', () => {
    for (const { levels } of runs) {
      const first = levels[0]!;
      expect(first.secretDoors).toBe(0);
      // SewerLevel.trapClasses: on the first depth, only worn dart traps.
      // (a traps room brings its own: TrapsRoom.levelTraps)
      const roomOf = (pos: number) => first.rooms.find((r) => pos % WIDTH >= r.left && pos % WIDTH <= r.right && Math.trunc(pos / WIDTH) >= r.top && Math.trunc(pos / WIDTH) <= r.bottom);
      expect((first.traps ?? []).filter((trap) => trap.kind !== 'wornDart' && roomOf(trap.pos)?.kind !== 'TrapsRoom')).toEqual([]);
      expect(first.feeling).toBe(Feeling.NONE);
    }
  });
});
