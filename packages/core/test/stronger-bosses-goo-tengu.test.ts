import { describe, expect, it } from 'vitest';
import {
  act, type Action, addHero, adjacent, canEnter, cell, charAt, createItem, createWorld, type Effect, floorAt, heroById, isAlive, levelAt,
  type Mob, NEIGHBOURS8, STRONGER_BOSSES, T, TENGU_CELL_DOOR, WIDTH, type World,
} from '../src/index';
import { checkInvariants } from './helpers';

/*
 * Challenges.STRONGER_BOSSES («Злые боссы») for Goo and Tengu: their health, Goo's quickening healing and
 * its swelling in one turn, Tengu's abilities (always with fire, cast faster), the lock's time, the prison's
 * traps and Tengu's poisoned darts.
 */

/** A sturdy hero standing on a boss's depth, every depth above made and emptied. */
function atBoss(depth: number, seed = 3, challenges = STRONGER_BOSSES): World {
  const world = createWorld(seed, challenges);
  addHero(world, { id: 'p', name: 'P', heroClass: 'warrior' });
  for (let d = 1; d <= depth; d++) levelAt(world, d);
  for (let d = 1; d < depth; d++) floorAt(world, d).mobs = [];
  const hero = heroById(world, 'p')!;
  Object.assign(hero, { depth, pos: levelAt(world, depth).entrance, time: floorAt(world, depth).now, lvl: 20, ht: 5000, hp: 5000, attackSkill: 1e6, defenseSkill: 1e6 });
  hero.weapon = createItem('weapon.shortsword', 1, 0);
  return world;
}

const hero = (world: World) => heroById(world, 'p')!;
const floorOf = (world: World) => floorAt(world, hero(world).depth);
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

function besides(world: World, at: number): void {
  const level = levelAt(world, hero(world).depth);
  const free = NEIGHBOURS8.map((n) => at + n).find((c) => canEnter(level, c) && !charAt(world, hero(world).depth, c));
  if (free !== undefined) hero(world).pos = free;
}

function strike(world: World, target: Mob): Effect[] {
  if (!adjacent(hero(world).pos, target.pos)) besides(world, target.pos);
  return play(world, { type: 'attack', target: target.id });
}

const fxCount = (effects: Effect[], name: string): number => effects.filter((e) => e.type === 'bossFx' && e.fx === name).length;

/** The hero inside Tengu's cell, the fight begun. */
function inCell(seed = 3, challenges = STRONGER_BOSSES): World {
  const world = atBoss(10, seed, challenges);
  const level = levelAt(world, 10);
  level.map[TENGU_CELL_DOOR] = T.DOOR;
  hero(world).pos = TENGU_CELL_DOOR;
  play(world, { type: 'move', to: TENGU_CELL_DOOR + WIDTH });
  return world;
}

/** Tengu in his arena, at half his health. */
function inArena(seed: number, challenges: number): World {
  const world = inCell(seed, challenges);
  const tengu = mob(world, 'tengu')!;
  tengu.hp = tengu.ht / 2 + 1;
  for (let i = 0; i < 20 && floorOf(world).boss?.prison === 'fightStart'; i++) strike(world, tengu);
  hero(world).pos = cell(10, 9);
  play(world, { type: 'move', to: cell(10, 8) });
  expect(floorOf(world).boss?.prison).toBe('fightArena');
  return world;
}

describe('Goo under the stronger bosses', () => {
  it('has 120 health, 100 without the challenge', () => {
    for (let seed = 1; seed <= 4; seed++) {
      expect(floorAt(createWorld(seed, STRONGER_BOSSES), 5).mobs.find((m) => m.kind === 'goo')!.ht).toBe(120);
      const plain = floorAt(createWorld(seed), 5).mobs.find((m) => m.kind === 'goo')!;
      expect(plain.ht).toBe(100);
      expect(plain.hp).toBe(100);
    }
    const goo = floorAt(createWorld(2, STRONGER_BOSSES), 5).mobs.find((m) => m.kind === 'goo')!;
    expect(goo.hp).toBe(120);
  });

  /** Goo awake, in the water, wounded, the hero beside it. */
  function bathing(challenges: number): { world: World; goo: Mob } {
    const world = atBoss(5, 3, challenges);
    const goo = mob(world, 'goo')!;
    goo.ht = 1000;
    goo.hp = 400;
    strike(world, goo);
    levelAt(world, 5).map[goo.pos] = T.WATER;
    goo.hp = 400;
    // (its nest is water: the first blow already had it bathing)
    goo.boss!.healInc = 1;
    return { world, goo };
  }

  it('heals one, two, then three a turn in its water, and starts over out of it', () => {
    const { world, goo } = bathing(STRONGER_BOSSES);
    const healed: number[] = [];
    for (let i = 0; i < 12; i++) {
      const effects = play(world, { type: 'wait' });
      for (const e of effects) if (e.type === 'healedMob' && e.mob === goo.id) healed.push(e.amount);
    }
    expect(healed.slice(0, 3)).toEqual([1, 2, 3]);
    expect(healed.length).toBeGreaterThan(5);
    expect(healed.slice(2).every((n) => n === 3)).toBe(true);
    // Out of the water it begins again at one.
    levelAt(world, 5).map[goo.pos] = T.EMPTY;
    play(world, { type: 'wait' });
    expect(goo.boss?.healInc).toBe(1);
  });

  it('heals one a turn all the while without the challenge', () => {
    const { world, goo } = bathing(0);
    const healed: number[] = [];
    for (let i = 0; i < 8; i++) {
      for (const e of play(world, { type: 'wait' })) if (e.type === 'healedMob' && e.mob === goo.id) healed.push(e.amount);
    }
    expect(healed.length).toBeGreaterThan(3);
    expect(new Set(healed)).toEqual(new Set([1]));
  });

  it("takes only as much of the lock's time as it heals (not half as much again)", () => {
    const left = (challenges: number): { left: number; heals: number } => {
      const { world, goo } = bathing(challenges);
      hero(world).lockedFloor = 30;
      const effects = play(world, { type: 'wait' });
      const heals = effects.filter((e) => e.type === 'healedMob' && e.mob === goo.id).length;
      return { left: hero(world).lockedFloor!, heals };
    };
    const badder = left(STRONGER_BOSSES);
    expect(badder.heals).toBe(1);
    // A turn of the hero's own, and one point for the point healed.
    expect(badder.left).toBe(30 - 1 - 1);
    const plain = left(0);
    expect(plain.heals).toBe(1);
    expect(plain.left).toBe(30 - 1 - 1.5);
  });

  it("is hurt for a point of the lock's time per point of damage (a point and a half without)", () => {
    const gain = (challenges: number): { left: number; lost: number } => {
      const world = atBoss(5, 3, challenges);
      const goo = mob(world, 'goo')!;
      goo.hp = goo.ht = 100000;
      strike(world, goo);
      hero(world).lockedFloor = 0;
      const before = goo.hp;
      play(world, { type: 'attack', target: goo.id });
      return { left: hero(world).lockedFloor!, lost: before - goo.hp };
    };
    const badder = gain(STRONGER_BOSSES);
    expect(badder.lost).toBeGreaterThan(0);
    // (a turn of the lock's own runs out after the blow)
    expect(badder.left).toBeCloseTo(badder.lost - 1, 4);
    const plain = gain(0);
    expect(plain.left).toBeCloseTo(plain.lost * 1.5 - 1, 4);
  });

  it('swells up in one go (straight to two), where it takes a turn for each stage without the challenge', () => {
    const seen = (challenges: number): Set<number> => {
      const stages = new Set<number>();
      for (let seed = 1; seed <= 8; seed++) {
        const world = atBoss(5, seed, challenges);
        const goo = mob(world, 'goo')!;
        goo.hp = goo.ht = 100000;
        strike(world, goo);
        for (let i = 0; i < 60; i++) {
          play(world, { type: 'wait' });
          stages.add(goo.boss?.pumpedUp ?? 0);
        }
      }
      return stages;
    };
    const badder = seen(STRONGER_BOSSES);
    expect(badder.has(2)).toBe(true);
    expect(badder.has(1)).toBe(false);
    const plain = seen(0);
    expect(plain.has(1)).toBe(true);
    expect(plain.has(2)).toBe(true);
  });
});

describe('Tengu under the stronger bosses', () => {
  it('has 250 health in his prison, 200 without the challenge', () => {
    const world = inCell(3);
    const tengu = mob(world, 'tengu')!;
    expect(tengu.ht).toBe(250);
    expect(tengu.hp).toBe(250);
    expect(mob(inCell(3, 0), 'tengu')!.ht).toBe(200);
  });

  it("is hurt for two thirds of a point of the lock's time per point of damage, a whole point without", () => {
    const gain = (challenges: number): { left: number; lost: number } => {
      const world = inCell(3, challenges);
      const tengu = mob(world, 'tengu')!;
      hero(world).lockedFloor = 0;
      const before = tengu.hp;
      strike(world, tengu);
      return { left: hero(world).lockedFloor!, lost: before - tengu.hp };
    };
    const badder = gain(STRONGER_BOSSES);
    expect(badder.lost).toBeGreaterThan(1);
    expect(badder.left).toBeCloseTo((2 * badder.lost) / 3 - 1, 4);
    const plain = gain(0);
    expect(plain.left).toBeCloseTo(plain.lost - 1, 4);
  });

  it('fills his cell with traps much faster as he is hurt (78% to 90%, not 40% to 90%)', () => {
    const traps = (challenges: number): number => {
      let total = 0;
      for (let seed = 1; seed <= 4; seed++) {
        const world = inCell(seed, challenges);
        const tengu = mob(world, 'tengu')!;
        // One eighth of his health gone brings the first jump, with a fill of about half.
        tengu.hp = tengu.ht - Math.trunc(tengu.ht / 8) + 1;
        for (let i = 0; i < 6 && (floorOf(world).boss?.tenguTraps ?? []).length === 0; i++) strike(world, tengu);
        total += (floorOf(world).boss?.tenguTraps ?? []).length;
      }
      return total;
    };
    const badder = traps(STRONGER_BOSSES);
    const plain = traps(0);
    expect(plain).toBeGreaterThan(0);
    expect(badder).toBeGreaterThan(plain);
  });

  it('his darts poison for 15 (8 without the challenge)', () => {
    const poisoned = (challenges: number): number => {
      const world = inCell(3, challenges);
      const tengu = mob(world, 'tengu')!;
      tengu.hp = tengu.ht - Math.trunc(tengu.ht / 8) + 1;
      for (let i = 0; i < 6 && (floorOf(world).boss?.tenguTraps ?? []).length === 0; i++) strike(world, tengu);
      const trap = floorOf(world).boss!.tenguTraps![0]!;
      const level = levelAt(world, 10);
      const from = NEIGHBOURS8.map((n) => trap + n).find((c) => canEnter(level, c) && !charAt(world, 10, c))!;
      hero(world).pos = from;
      hero(world).poison = 0;
      play(world, { type: 'move', to: trap });
      expect(floorOf(world).boss?.tenguTraps).not.toContain(trap);
      return hero(world).poison ?? 0;
    };
    expect(poisoned(STRONGER_BOSSES)).toBeGreaterThan(8);
    expect(poisoned(STRONGER_BOSSES)).toBeLessThanOrEqual(15);
    expect(poisoned(0)).toBeLessThanOrEqual(8);
  });

  it('throws fire with every other ability in his arena, and never chooses fire by itself', () => {
    for (let seed = 1; seed <= 3; seed++) {
      const world = inArena(seed, STRONGER_BOSSES);
      const tengu = mob(world, 'tengu')!;
      expect(tengu.hp).toBe(125);
      // Two jumps are five abilities owed.
      tengu.boss!.arenaJumps = 2;
      const all: Effect[] = [];
      const abilities: number[] = [];
      for (let i = 0; i < 80 && isAlive(tengu); i++) {
        all.push(...play(world, { type: 'wait' }));
        const last = mob(world, 'tengu')?.boss?.lastAbility;
        if (last !== undefined && abilities[abilities.length - 1] !== last) abilities.push(last);
      }
      const used = tengu.boss?.abilitiesUsed ?? 0;
      expect(used).toBeGreaterThanOrEqual(2);
      // The bomb first, the shocker second; then bombs and shockers only.
      expect(tengu.boss?.lastAbility === 0 || tengu.boss?.lastAbility === 2).toBe(true);
      expect(abilities.every((a) => a === 0 || a === 2)).toBe(true);
      // Every ability brought a wave of fire with it.
      expect(fxCount(all, 'fire')).toBeGreaterThanOrEqual(used - 1);
    }
  });

  it('casts quicker: far behind on his abilities he waits a turn between two, not every other ability at once', () => {
    const used = (challenges: number): number => {
      const world = inArena(5, challenges);
      const tengu = mob(world, 'tengu')!;
      // Four jumps are eleven abilities owed.
      Object.assign(tengu.boss!, { arenaJumps: 4, abilitiesUsed: 0, abilityCooldown: 2 });
      for (let i = 0; i < 6; i++) play(world, { type: 'wait' });
      return tengu.boss!.abilitiesUsed ?? 0;
    };
    const badder = used(STRONGER_BOSSES);
    const plain = used(0);
    expect(badder).toBeGreaterThanOrEqual(2);
    // Without the challenge he uses one the moment he is four behind (every turn); with it, every other turn
    // (the ability itself takes no time, but the wait before the next one does).
    expect(plain).toBeGreaterThan(badder);
  });
});
