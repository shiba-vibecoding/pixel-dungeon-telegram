import { type Mob, type MobKind, MOBS } from './actors';
import { SOLO_SPAN } from './level/geometry';
import type { World } from './world';

/*
 * A dungeon made for the party that goes down it. The original is balanced for
 * one hero; a party of N finds it grown to match when each depth is first
 * reached: wider (more rooms), more monsters, sturdier ones, bosses much sturdier, monsters
 * coming back sooner, more to find, and the items that make a hero stronger
 * (strength, upgrades) once for every hero rather than once for all. Alone,
 * nothing changes: not even a roll of the dice.
 */

/** How many heroes the dungeon is made for. */
export function partySize(world: World): number {
  return Math.max(1, world.heroes.length);
}

const BOSSES: ReadonlySet<MobKind> = new Set(['goo', 'tengu', 'dm300', 'king', 'yog']);

/** Each hero past the first: this much more health on monsters, and on bosses. */
const MOB_HEALTH = 0.15;
const BOSS_HEALTH = 0.65;
/** ...this many more monsters on a depth, and this much sooner they come back. */
const MOB_COUNT = 0.4;
const RESPAWN = 0.4;
/** ...and this many more things lying about. */
const LOOT = 0.6;
/** ...and this many more rooms on a depth. */
const ROOMS = 0.25;

/** A monster as sturdy as the party needs it. */
export function scaleMob(world: World, mob: Mob): Mob {
  const extra = partySize(world) - 1;
  if (extra > 0) {
    const factor = 1 + (BOSSES.has(mob.kind) ? BOSS_HEALTH : MOB_HEALTH) * extra;
    mob.ht = mob.hp = Math.round(mob.ht * factor);
  }
  return mob;
}

/**
 * The party has grown: a boss already waiting (Goo, asleep in its lair) grows with it,
 * keeping whatever share of its health it has.
 */
export function regrowBoss(world: World, mob: Mob): void {
  if (!BOSSES.has(mob.kind)) return;
  const ht = Math.round(MOBS[mob.kind].ht * (1 + BOSS_HEALTH * (partySize(world) - 1)));
  mob.hp = Math.max(1, Math.round((mob.hp * ht) / mob.ht));
  mob.ht = ht;
}

/**
 * How many cells a side a depth spreads over: the original's 32 for one hero, four more for
 * each hero beside, up to 44 (the grid is 48: geometry.ts).
 */
export function levelSpan(party: number): number {
  return Math.min(44, SOLO_SPAN + 4 * Math.max(0, party - 1));
}

/** `base` monsters for one hero, as many as the party needs. */
export function mobCount(base: number, party: number): number {
  return base + Math.round(base * MOB_COUNT * Math.max(0, party - 1));
}

/** Turns between monsters coming back, for the party. */
export function respawnTime(base: number, party: number): number {
  return Math.max(1, Math.round(base / (1 + RESPAWN * Math.max(0, party - 1))));
}

/** A depth's `base` standard rooms for one hero, and a quarter as many again for every other hero. */
export function partyRooms(base: number, party: number): number {
  return base + Math.round(base * ROOMS * Math.max(0, party - 1));
}

/** `base` random things to find for one hero, as many as the party needs. */
export function lootCount(base: number, party: number): number {
  return base + Math.round(base * LOOT * Math.max(0, party - 1));
}
