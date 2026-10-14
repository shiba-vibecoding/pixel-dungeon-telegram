import { describe, expect, it } from 'vitest';
import {
  act, type Action, addHero, adjacent, canEnter, charAt, CIRCLE8, createItem, createWorld, distance, type Effect, floorAt, heroById, isAlive,
  levelAt, type Mob, NEIGHBOURS8, PYLON_POSITIONS, STRONGER_BOSSES, T, type World,
} from '../src/index';
import type { Ctx } from '../src/floor';
import { Rng } from '../src/rng';
import { DM300, PYLON, rocksTurn, ventTurn } from '../src/bosses/dm300';
import { bossFloor } from '../src/bosses/common';
import { MAIN_ARENA } from '../src/level/caves-boss';
import { WIDTH } from '../src/level/geometry';
import { checkInvariants } from './helpers';

/*
 * The stronger bosses' challenge (Challenges.STRONGER_BOSSES) on DM-300, its pylons and its caves.
 */

function atCaves(seed: number, challenges: number): World {
  const world = createWorld(seed, challenges);
  addHero(world, { id: 'p', name: 'P', heroClass: 'warrior' });
  for (let d = 1; d <= 15; d++) levelAt(world, d);
  for (let d = 1; d < 15; d++) floorAt(world, d).mobs = [];
  const hero = heroById(world, 'p')!;
  Object.assign(hero, { depth: 15, pos: levelAt(world, 15).entrance, time: floorAt(world, 15).now, lvl: 20, ht: 5000, hp: 5000, attackSkill: 1e6, defenseSkill: 1e6 });
  hero.weapon = createItem('weapon.shortsword', 1, 0);
  return world;
}

const hero = (world: World) => heroById(world, 'p')!;
const floorOf = (world: World) => floorAt(world, 15);
const mob = (world: World, kind: string): Mob | undefined => floorOf(world).mobs.find((m) => m.kind === kind);

function play(world: World, action: Action): Effect[] {
  let result = act(world, 'p', action);
  if (!result.ok) result = act(world, 'p', { type: 'wait' });
  const h = hero(world);
  if (h.hp > 0) h.hp = h.ht;
  h.paralysed = 0;
  h.hunger = 0;
  checkInvariants(world);
  return result.ok ? result.effects : [];
}

function strike(world: World, target: Mob): Effect[] {
  const level = levelAt(world, 15);
  if (!adjacent(hero(world).pos, target.pos)) {
    const free = NEIGHBOURS8.map((n) => target.pos + n).find((c) => canEnter(level, c) && !charAt(world, 15, c));
    if (free !== undefined) hero(world).pos = free;
  }
  return play(world, { type: 'attack', target: target.id });
}

/** The hero steps beside a pylon: the level seals and DM-300 starts up. */
function seal(world: World): Mob {
  const level = levelAt(world, 15);
  const target = PYLON_POSITIONS[2]!;
  const free = (c: number): boolean => canEnter(level, c) && !charAt(world, 15, c);
  for (let to = 0; to < level.map.length; to++) {
    if (!free(to) || distance(to, target) > 3) continue;
    const from = NEIGHBOURS8.map((n) => to + n).find((c) => free(c) && distance(c, target) > 3);
    if (from === undefined) continue;
    hero(world).pos = from;
    play(world, { type: 'move', to });
    break;
  }
  expect(floorOf(world).boss?.locked).toBe(true);
  return mob(world, 'dm300')!;
}

function ctxOf(world: World): Ctx {
  return { world, depth: 15, level: levelAt(world, 15), floor: floorOf(world), rng: Rng.seeded(7), effects: [] };
}

const yelled = (effects: Effect[], line: string): boolean => effects.some((e) => e.type === 'yell' && e.line === line);

describe('the stronger bosses on DM-300 and its caves', () => {
  it('lays a live wire on one cell in four instead of one in eight', () => {
    const wires = (challenges: number): number => {
      let total = 0;
      for (let seed = 1; seed <= 6; seed++) total += levelAt(createWorld(seed, challenges), 15).map.filter((t) => t === T.INACTIVE_TRAP).length;
      return total;
    };
    const plain = wires(0);
    const harder = wires(STRONGER_BOSSES);
    expect(plain).toBeGreaterThan(0);
    expect(harder).toBeGreaterThan(plain * 1.5);
  });

  it('starts DM-300 with 400 health and its pylons with 80', () => {
    for (const [challenges, dm, pylon] of [[0, 300, 50], [STRONGER_BOSSES, 400, 80]] as const) {
      const world = atCaves(4, challenges);
      const pylons = floorOf(world).mobs.filter((m) => m.kind === 'pylon');
      expect(pylons).toHaveLength(4);
      for (const p of pylons) expect([p.hp, p.ht]).toEqual([pylon, pylon]);
      const boss = seal(world);
      expect([boss.hp, boss.ht]).toEqual([dm, dm]);
    }
  });

  it('supercharges at 300, 200 and 100 of 400, three pylons to destroy', () => {
    const world = atCaves(4, STRONGER_BOSSES);
    const dm = seal(world);
    const all: Effect[] = [];
    const active = () => floorOf(world).mobs.find((m) => m.kind === 'pylon' && m.boss?.active);
    const level = (n: number, hp: number): void => {
      dm.hp = hp;
      for (let i = 0; i < 20 && !dm.boss?.supercharged; i++) all.push(...strike(world, mob(world, 'dm300')!));
      expect(dm.boss?.supercharged).toBe(true);
      expect(dm.boss?.pylonsActivated).toBe(n);
      expect(dm.hp).toBe(400 - 100 * n);
      for (let i = 0; i < 300 && active(); i++) all.push(...strike(world, active()!));
      expect(dm.boss?.supercharged).toBe(false);
    };
    level(1, 305);
    expect(yelled(all, 'charge_lost')).toBe(true);
    expect(yelled(all, 'pylons_destroyed')).toBe(false);
    level(2, 205);
    expect(yelled(all, 'pylons_destroyed')).toBe(false);
    // The third charge: only now are the pylons the last of its defences.
    all.length = 0;
    level(3, 105);
    expect(yelled(all, 'pylons_destroyed')).toBe(true);
    expect(floorOf(world).boss?.bleed).toBe(true);
    for (let i = 0; i < 600 && isAlive(dm); i++) all.push(...strike(world, dm));
    expect(isAlive(dm)).toBe(false);
  });

  it('without the challenge it still takes two charges, at 200 and 100 of 300', () => {
    const world = atCaves(4, 0);
    const dm = seal(world);
    dm.hp = 205;
    for (let i = 0; i < 20 && !dm.boss?.supercharged; i++) strike(world, mob(world, 'dm300')!);
    expect(dm.hp).toBe(200);
    expect(dm.boss?.pylonsActivated).toBe(1);
  });

  it('spends 2 turns on supercharging instead of 3', () => {
    for (const [challenges, spent] of [[0, 3], [STRONGER_BOSSES, 2]] as const) {
      const world = atCaves(4, challenges);
      const dm = seal(world);
      const ctx = ctxOf(world);
      const before = dm.time;
      const hp = dm.hp;
      dm.hp = Math.trunc(dm.ht / (challenges ? 4 : 3)) * (challenges ? 3 : 2) - 1;
      DM300.afterDamage!(ctx, dm, hp, hero(world));
      expect(dm.boss?.supercharged).toBe(true);
      expect(dm.time - before).toBe(spent);
    }
  });

  it('lets 7 turns at most pass between abilities instead of 9', () => {
    for (const [challenges, most] of [[0, 9], [STRONGER_BOSSES, 7]] as const) {
      const world = atCaves(4, challenges);
      const dm = seal(world);
      const ctx = ctxOf(world);
      const seen = new Set<number>();
      for (let i = 0; i < 400; i++) {
        delete dm.boss!.abilityCooldown;
        delete bossFloor(ctx.floor).bar;
        DM300.notice!(ctx, dm, hero(world));
        seen.add(dm.boss!.abilityCooldown!);
      }
      expect(Math.max(...seen)).toBe(most);
      expect(Math.min(...seen)).toBe(5);
    }
  });

  it('lets out twice the gas', () => {
    const volume = (challenges: number): number => {
      const world = atCaves(4, challenges);
      const ctx = ctxOf(world);
      // Somewhere in the arena with nothing solid round it, for the gas to fall evenly.
      const clear = (c: number): boolean => [0, 1, 2, ...NEIGHBOURS8.flatMap((n) => [n, n + 2])].every((o) => canEnter(ctx.level, c + o));
      let from = -1;
      for (let y = MAIN_ARENA.top; y < MAIN_ARENA.bottom && from < 0; y++) for (let x = MAIN_ARENA.left; x < MAIN_ARENA.right && from < 0; x++) if (clear(x + y * WIDTH)) from = x + y * WIDTH;
      expect(from).toBeGreaterThan(0);
      bossFloor(ctx.floor).timed.push({ kind: 'vent', owner: 'x', time: 0, from, collision: from + 2, path: [from + 1, from + 2] });
      ventTurn(ctx, bossFloor(ctx.floor).timed[0] as never);
      return (ctx.floor.gas?.toxic ?? []).reduce((sum, [, v]) => sum + v, 0);
    };
    // 100 + 2 * 20 on the line, then (250 - 40) / 8 rounded up round DM-300; all of it doubled.
    expect(volume(0)).toBe(100 + 40 + 8 * Math.ceil(210 / 8));
    expect(volume(STRONGER_BOSSES)).toBe(200 + 80 + 8 * Math.ceil(420 / 8));
  });

  it('drops rocks for 10 to 20 and a stun of 5 turns instead of 6 to 12 and 3', () => {
    for (const [challenges, low, high, stun] of [[0, 6, 12, 3], [STRONGER_BOSSES, 10, 20, 5]] as const) {
      const world = atCaves(4, challenges);
      seal(world);
      const damages: number[] = [];
      for (let i = 0; i < 40; i++) {
        const ctx = ctxOf(world);
        ctx.rng = Rng.seeded(100 + i);
        const h = hero(world);
        h.hp = h.ht;
        h.paralysed = 0;
        bossFloor(ctx.floor).timed.push({ kind: 'rocks', owner: 'x', time: 0, cells: [h.pos] });
        rocksTurn(ctx, bossFloor(ctx.floor).timed[bossFloor(ctx.floor).timed.length - 1] as never);
        const hurt = ctx.effects.find((e) => e.type === 'hurt');
        damages.push((hurt as { damage: number }).damage);
        expect(h.paralysed).toBe(stun);
      }
      expect(Math.min(...damages)).toBeGreaterThanOrEqual(low);
      expect(Math.max(...damages)).toBeLessThanOrEqual(high);
      // Normally distributed, so the middle of the range is where they gather.
      expect(Math.max(...damages)).toBeGreaterThan(low + 2);
    }
  });

  it('has an active pylon arc to three cells (round the circle by 0, 3 and 5) instead of two (0 and 4)', () => {
    for (const [challenges, offsets] of [[0, [0, 4]], [STRONGER_BOSSES, [0, 3, 5]]] as const) {
      const world = atCaves(4, challenges);
      const pylon = floorOf(world).mobs.find((m) => m.kind === 'pylon')!;
      pylon.boss = { active: true, targetNeighbor: 2 };
      const ctx = ctxOf(world);
      PYLON.act!(ctx, pylon);
      const zap = ctx.effects.find((e) => e.type === 'bossFx' && e.fx === 'zap') as { cells: number[] };
      expect(zap.cells).toEqual(offsets.map((o) => pylon.pos + CIRCLE8[(2 + o) % 8]!));
      expect(pylon.boss!.targetNeighbor).toBe(3);
    }
  });

  it('gives a hurt boss half the passive-healing time', () => {
    for (const [challenges, factor] of [[0, 1], [STRONGER_BOSSES, 0.5]] as const) {
      const world = atCaves(4, challenges);
      const dm = seal(world);
      const h = hero(world);
      let seen = 0;
      for (let i = 0; i < 10 && seen === 0; i++) {
        const before = dm.hp;
        h.lockedFloor = 10;
        strike(world, dm);
        const taken = before - dm.hp;
        if (taken > 0) {
          seen = taken;
          // (The hero's own turn, which follows his blow, takes one off.)
          expect(h.lockedFloor).toBeCloseTo(10 + taken * factor - 1, 5);
        }
      }
      expect(seen).toBeGreaterThan(0);
    }
  });

  it('gives a hurt pylon half the passive-healing time too', () => {
    for (const [challenges, factor] of [[0, 1], [STRONGER_BOSSES, 0.5]] as const) {
      const world = atCaves(4, challenges);
      seal(world);
      const dm = mob(world, 'dm300')!;
      dm.hp = challenges ? 305 : 205;
      for (let i = 0; i < 20 && !dm.boss?.supercharged; i++) strike(world, mob(world, 'dm300')!);
      const pylon = floorOf(world).mobs.find((m) => m.kind === 'pylon' && m.boss?.active)!;
      const h = hero(world);
      let seen = 0;
      for (let i = 0; i < 10 && seen === 0; i++) {
        const before = pylon.hp;
        h.lockedFloor = 10;
        strike(world, pylon);
        const taken = before - pylon.hp;
        if (taken > 0) {
          seen = taken;
          // (The hero's own turn, which follows his blow, takes one off.)
          expect(h.lockedFloor).toBeCloseTo(10 + taken * factor - 1, 5);
        }
      }
      expect(seen).toBeGreaterThan(0);
    }
  });

  it('clears the electricity when the second pylon falls under the challenge, not before the last two', () => {
    for (const [challenges, first, second, cleared] of [[0, 205, 105, false], [STRONGER_BOSSES, 305, 205, true]] as const) {
      const world = atCaves(4, challenges);
      const dm = seal(world);
      const active = () => floorOf(world).mobs.find((m) => m.kind === 'pylon' && m.boss?.active);
      const charge = (hp: number): void => {
        dm.hp = hp;
        for (let i = 0; i < 20 && !dm.boss?.supercharged; i++) strike(world, mob(world, 'dm300')!);
        expect(dm.boss?.supercharged).toBe(true);
        expect((floorOf(world).boss?.energy ?? []).length).toBeGreaterThan(0);
        for (let i = 0; i < 300 && active(); i++) strike(world, active()!);
      };
      // Four pylons: the first to fall leaves three, more than the two (or one) that keep the energy off.
      charge(first);
      expect(floorOf(world).mobs.filter((m) => m.kind === 'pylon')).toHaveLength(3);
      expect(floorOf(world).boss?.energy).toBeUndefined();
      // The second leaves two: the plain game's last stand, one too many for the challenge's.
      charge(second);
      expect(floorOf(world).mobs.filter((m) => m.kind === 'pylon')).toHaveLength(2);
      // (activatePylon brought the energy back for the second charge; eliminatePylon clears it again or not.)
      expect(floorOf(world).boss?.energy === undefined).toBe(cleared);
    }
  });
});
