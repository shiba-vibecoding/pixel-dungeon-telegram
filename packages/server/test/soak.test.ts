import { describe, expect, it } from 'vitest';
import { makeSpec, soakRun, softTotal, type Failure, type RunStats } from './soak-engine';

/*
 * The stability and replay soak: SOAK=1 npx vitest run soak (SOAK_FROM, SOAK_RUNS pick the specs, SOAK_OUT a file for the
 * failures as JSON). Skipped otherwise; it plays hundreds of whole runs.
 */
const on = Boolean(process.env.SOAK);
const from = Number(process.env.SOAK_FROM ?? 0);
const runs = Number(process.env.SOAK_RUNS ?? 30);

describe.skipIf(!on)('soak', () => {
  it(`plays ${runs} seeded runs from ${from} and replays each as the server does`, async () => {
    const failures: Failure[] = [];
    const all: Array<{ id: number; mode: string; heroClass: string; stats: RunStats }> = [];
    const started = Date.now();
    for (let id = from; id < from + runs; id++) {
      const spec = makeSpec(id);
      const { failures: found, stats } = soakRun(spec);
      failures.push(...found);
      all.push({ id, mode: spec.mode, heroClass: spec.heroClass, stats });
      console.log(`#${id} ${spec.heroClass} ${spec.mode} ch${spec.challenges}${spec.daily ? ' daily' : ''}: ${stats.actions} actions, depth ${stats.deepest}${stats.victory ? ' WON' : stats.over ? ' over' : ''}, device ${stats.deviceMs} ms + replay ${stats.replayMs} ms, ${found.length} failures`);
    }
    console.log(`soft: ${softTotal.count} undefined-valued keys (first ${softTotal.first}), ${softTotal.alias} shared objects (first ${softTotal.aliasFirst})`);
    if (process.env.SOAK_OUT) {
      const { writeFileSync } = await import('node:fs');
      writeFileSync(process.env.SOAK_OUT, JSON.stringify({ failures, runs: all, ms: Date.now() - started }, null, 1));
    }
    const bot = failures.filter((f) => f.kind === 'botlimit');
    if (bot.length > 0) console.log(`bot limits (not failures): ${bot.map((f) => `#${f.spec}`).join(' ')}`);
    expect(failures.filter((f) => f.kind !== 'botlimit').map((f) => `#${f.spec} seed ${f.seed} ${f.heroClass} ${f.mode} ${f.kind} at ${f.at}: ${f.message}`)).toEqual([]);
  }, 3_600_000);
});
