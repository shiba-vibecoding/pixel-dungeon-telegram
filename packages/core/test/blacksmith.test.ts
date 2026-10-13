import { describe, expect, it } from 'vitest';
import { createRun, type World } from '../src/index';
import { generateLevel } from '../src/level/generate';

describe('smoke', () => {
  it('spawns', () => {
    let found = 0;
    const t0 = Date.now();
    for (let seed = 1; seed <= 10; seed++) {
      const run = createRun(seed);
      const world = { smithQuest: null, challenges: 0, heroes: [] } as unknown as World;
      for (let d = 1; d <= 14; d++) if (d !== 5 && d !== 10) generateLevel(run, d, undefined, false, world);
      const q = world.smithQuest;
      if (q) {
        found++;
        const t1 = Date.now();
        const mine = generateLevel(run, q.depth, undefined, false, world, 1);
        console.log(seed, q.depth, q.type, mine.mine, mine.spawn?.mobs.map((m) => m.kind).join(','), Date.now() - t1);
      }
    }
    console.log('found', found, Date.now() - t0);
    expect(found).toBeGreaterThan(0);
  });
});
