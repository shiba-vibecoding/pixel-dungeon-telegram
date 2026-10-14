import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { type HeldKey, interruptWalk, tookDamage, vitalsOf, type Walking } from '../src/interrupt';

const walking = (over: Partial<Walking> = {}): Walking => ({
  queue: [], chase: null, stairs: null, pickup: false, resting: false, open: null, mine: null, branch: false, ...over,
});
const idle = (): HeldKey => ({ code: '', striding: false });

describe('Hero.interrupt: what stops the hero\'s plan', () => {
  it('health lost on the same floor is damage, from whatever source; health gained or a new floor is not', () => {
    const before = vitalsOf({ hp: 20 }, '1:3');
    expect(tookDamage(before, vitalsOf({ hp: 17 }, '1:3'))).toBe(true);
    expect(tookDamage(before, vitalsOf({ hp: 20 }, '1:3'))).toBe(false);
    expect(tookDamage(vitalsOf({ hp: 5 }, '1:3'), vitalsOf({ hp: 9 }, '1:3'))).toBe(false);
    // Arriving on another floor, or in a new run, with less health is not a wound.
    expect(tookDamage(before, vitalsOf({ hp: 3 }, '1:4'))).toBe(false);
    expect(tookDamage(before, vitalsOf({ hp: 3 }, '2:3'))).toBe(false);
    expect(tookDamage(null, vitalsOf({ hp: 3 }, '1:3'))).toBe(false);
  });

  it('drops a walk, a way to the stairs, a rest, a pickup and a key held down', () => {
    const walk = walking({ queue: [4, 5, 6], stairs: 'descend', pickup: true, resting: true, open: 9, mine: 8, branch: true });
    const held: HeldKey = { code: 'KeyD', striding: false };
    expect(interruptWalk(walk, held)).toBe(true);
    expect(walk).toEqual(walking());
    expect(held.code).toBe('');
  });

  it('drops a chase, except of the monster that struck', () => {
    const walk = walking({ chase: '#7' });
    interruptWalk(walk, idle(), '#7');
    expect(walk.chase).toBe('#7');
    interruptWalk(walk, idle(), '#9');
    expect(walk.chase).toBeNull();
    const other = walking({ chase: '#7', queue: [1] });
    interruptWalk(other, idle());
    expect(other.chase).toBeNull();
    expect(other.queue).toEqual([]);
  });

  it('says whether there was anything to stop', () => {
    expect(interruptWalk(walking(), idle())).toBe(false);
    expect(interruptWalk(walking({ resting: true }), idle())).toBe(true);
    expect(interruptWalk(walking(), { code: 'ArrowUp', striding: false })).toBe(true);
    // A chase of the one that struck is not stopped, so there was nothing to stop.
    expect(interruptWalk(walking({ chase: '#1' }), idle(), '#1')).toBe(false);
  });
});

describe('the backpack on a wide screen', () => {
  it("lays the item's window beside the pack from 760 px, in #overlay (the container query of .pd-overlay never matched in the game)", () => {
    const css = readFileSync(new URL('../src/game.css', import.meta.url), 'utf8');
    const block = /@media \(min-width: 760px\) \{([^@]*?)\n\}/.exec(css)?.[1] ?? '';
    expect(block).toContain('#overlay .pd-bag-body { flex-direction: row;');
    expect(block).toContain('#overlay .pd-pick { flex: 1 1 0;');
  });
});
