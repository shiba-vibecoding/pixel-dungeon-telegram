import { describe, expect, it } from 'vitest';
import { HERO_CLASSES } from '@pd/core';
import { makeSpec, playDevice, plainProblems, replayOnServer, soakRun } from './soak-engine';

/* A few short runs of the soak (soak.test.ts, which plays hundreds): the engine itself must keep working, and see what it is for. */

describe('the soak engine', () => {
  it('plays a short run of each class, and the server plays it again alike', () => {
    for (let id = 0; id < HERO_CLASSES.length * 3; id++) {
      const spec = { ...makeSpec(id), cap: 120 };
      const { failures, stats } = soakRun(spec);
      expect(failures.map((f) => `#${f.spec} ${f.kind}: ${f.message}`), `spec ${id}`).toEqual([]);
      expect(stats.actions).toBeGreaterThan(0);
    }
  });

  // Spec 227's first moves were refused, and a refusal made the hero's empty buffs (never sent to the server): found by the soak.
  it('finds a refused action that does not leave the world as it was only if the fingerprint sees the difference', () => {
    const spec = { ...makeSpec(227), cap: 100 };
    expect(spec.mode).toBe('chaos');
    expect(soakRun(spec).failures).toEqual([]);
  });

  it('tells a replay that parts from the device (a lost action) at the next sync point', () => {
    const spec = { ...makeSpec(1), cap: 200 };
    const played = playDevice(spec);
    const at = played.log.findIndex((entry, i) => i > 30 && entry.k === 'a' && entry.a.type === 'move');
    expect(at).toBeGreaterThan(0);
    const log = played.log.slice();
    log.splice(at, 1);
    const checkpoints = played.checkpoints.map((cp) => (cp.n > at ? { ...cp, n: cp.n - 1, seq: cp.seq - 1 } : cp));
    const failures = replayOnServer(spec, { ...played, log, checkpoints });
    expect(failures.length).toBeGreaterThan(0);
    expect(failures[0]!.kind).toMatch(/diverge|refused/);
  });

  it('knows a world storage would not give back as it was', () => {
    expect(plainProblems({ a: new Map(), b: [1, 2] }).join()).toContain('Map');
    expect(plainProblems({ a: NaN }).join()).toContain('NaN');
    expect(plainProblems({ a: [1, undefined] }).join()).toContain('undefined');
    expect(plainProblems({ a: new Set() }).join()).toContain('Set');
    expect(plainProblems({ a: { b: [1, 'two', null, true] } })).toEqual([]);
    const soft = { count: 0, alias: 0 };
    const shared = { x: 1 };
    expect(plainProblems({ a: shared, b: shared, c: undefined }, soft)).toEqual([]);
    expect(soft).toMatchObject({ count: 1, alias: 1 });
  });
});
