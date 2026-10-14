/*
 * Hero.interrupt (Shattered Pixel Dungeon): whatever the hero was doing over several turns, a walk along a
 * path, a chase, a rest, a key held down, stops when they take damage from any source and when an enemy comes
 * into view. The walks live on the client (the server replays single actions: a move, a wait), so nothing here
 * touches the rules: it only drops the player's own plan, and the next press starts a new one.
 */

/** The parts of the walking state that a single order can leave pending (main.ts `walk`). */
export interface Walking {
  queue: number[];
  chase: string | null;
  stairs: 'descend' | 'ascend' | null;
  pickup: boolean;
  resting: boolean;
  open: number | null;
  mine: number | null;
  branch: boolean;
}

/** The direction key held down, if any (main.ts `held`). */
export interface HeldKey {
  code: string;
  striding: boolean;
}

/**
 * The hero's health, and where: a drop in it, on the same floor, is damage taken. (A shield that wears off is not
 * damage, so it is not counted; a blow a shield soaks up still comes as an `attack` or `hurt` effect.)
 */
export interface Vitals {
  /** The run's generation and depth: a new floor or run is not a wound. */
  place: string;
  points: number;
}

export function vitalsOf(hero: { hp: number }, place: string): Vitals {
  return { place, points: hero.hp };
}

/** Hero.damage -> interrupt(): health lost since the last look, whoever or whatever took it. */
export function tookDamage(before: Vitals | null, now: Vitals): boolean {
  return before !== null && before.place === now.place && now.points < before.points;
}

/**
 * Drops every pending multi-turn order. A chase of the monster that struck (`except`) is kept: the hero is
 * already at its throat. Returns whether anything was pending, and so was stopped.
 */
export function interruptWalk(walk: Walking, held: HeldKey, except: string | null = null): boolean {
  const chase = walk.chase !== null && walk.chase !== except;
  const busy = walk.queue.length > 0 || chase || walk.stairs !== null || walk.pickup || walk.resting || walk.open !== null ||
    walk.mine !== null || walk.branch || held.code !== '';
  walk.queue = [];
  if (chase) walk.chase = null;
  walk.stairs = null;
  walk.pickup = false;
  walk.resting = false;
  walk.open = null;
  walk.mine = null;
  walk.branch = false;
  held.code = '';
  return busy;
}
