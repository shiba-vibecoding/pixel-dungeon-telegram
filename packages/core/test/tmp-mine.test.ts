import { it } from 'vitest';
import { createRun, T, type World } from '../src/index';
import { generateLevel } from '../src/level/generate';

it('draws', () => {
  for (const seed of [1, 2]) {
    const run = createRun(seed);
    const world = { smithQuest: null, challenges: 0, heroes: [] } as unknown as World;
    for (let d = 1; d <= 14; d++) if (d !== 5 && d !== 10) generateLevel(run, d, undefined, false, world);
    const q = world.smithQuest!;
    const mine = generateLevel(run, q.depth, undefined, false, world, 1);
    const ch: Record<number, string> = { [T.WALL]: '#', [T.WALL_DECO]: '$', [T.EMPTY]: '.', [T.EMPTY_DECO]: ',', [T.EMPTY_SP]: '_', [T.MINE_CRYSTAL]: '*', [T.MINE_BOULDER]: 'o', [T.WATER]: '~', [T.GRASS]: '"', [T.HIGH_GRASS]: '"', [T.ENTRANCE_SP]: '<', [T.BARRICADE]: 'B', [T.TRAP]: '^', [T.REGION_DECO]: 'R' };
    const rows: string[] = [];
    for (let y = 0; y < (mine.height ?? 64); y++) {
      let row = '';
      for (let x = 0; x < (mine.width ?? 64); x++) {
        const c = x + y * 64;
        const m = mine.spawn!.mobs.find((mm) => mm.pos === c);
        row += m ? m.kind[0]!.toUpperCase() : ch[mine.map[c]!] ?? '?';
      }
      rows.push(row);
    }
    console.log(rows.join('\n'));
    console.log('gold', mine.map.filter((t) => t === T.WALL_DECO).length, mine.spawn!.heaps.map((h) => h.items.map((i) => i.kind + 'x' + i.qty).join('/')).join(' '));
  }
});
