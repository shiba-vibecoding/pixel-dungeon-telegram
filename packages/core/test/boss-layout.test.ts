import { describe, expect, it } from 'vitest';
import { createRun } from '../src/run';
import { generateLevel, LENGTH, NEIGHBOURS8, T, WIDTH } from '../src/index';
import { setMapEnd } from '../src/level/prison-boss';

/** Whether the exit can be reached from the entrance through anything that is not solid rock. */
function connected(map: readonly number[], from: number, to: number): boolean {
  const seen = new Uint8Array(LENGTH);
  const queue = [from];
  seen[from] = 1;
  while (queue.length > 0) {
    const cell = queue.shift()!;
    if (cell === to) return true;
    for (const n of NEIGHBOURS8) {
      const next = cell + n;
      if (next < 0 || next >= LENGTH || seen[next]) continue;
      if (Math.abs((next % WIDTH) - (cell % WIDTH)) > 1) continue;
      const terrain = map[next]!;
      if (terrain === T.WALL || terrain === T.WALL_DECO) continue;
      seen[next] = 1;
      queue.push(next);
    }
  }
  return false;
}

describe('boss levels', () => {
  it('always join their stairs to the way down, whatever the grid is', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const run = createRun(seed);
      for (const depth of [5, 10, 15, 20, 25]) {
        const level = generateLevel(run, depth);
        const map = [...level.map];
        // Tengu's prison: the way down is there once the fight is won (PrisonBossLevel.setMapEnd).
        if (depth === 10) setMapEnd(map, run.seed);
        // The way down behind the caves' gate, the city's top door, Yog's carved wall: open once the boss falls.
        for (let i = 0; i < map.length; i++) if (map[i] === T.STATUE_SP || map[i] === T.LOCKED_DOOR) map[i] = T.EMPTY;
        if (depth === 25) map[level.exit] = T.EXIT;
        expect(connected(map, level.entrance, level.exit), `seed ${seed}, depth ${depth}`).toBe(true);
      }
    }
  });
});
