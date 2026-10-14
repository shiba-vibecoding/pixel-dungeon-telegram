import { type Hero, type Mob, visibleCells, visibleEnemies, type World } from '@pd/core';

/*
 * What the party sees, asked for every frame by the indicator on the map, the tutorial and the music: a field of view each time
 * is a floor-sized array and a shadow cast. The world only changes when an action is done (core's `submit` ends with
 * `world.turn++`), so between two turns the answer is the same and is kept: one cast a turn, not three a frame. Nothing here
 * may be written to.
 */

let owner: World | null = null;
let turn = -1;
/** A restart makes a new run in the same world object: its seed tells it from the last. */
let seed = NaN;
const cells = new Map<number, readonly boolean[]>();
const foes = new Map<string, readonly Mob[]>();

function sync(world: World): void {
  if (world === owner && world.turn === turn && world.run.seed === seed) return;
  owner = world;
  turn = world.turn;
  seed = world.run.seed;
  cells.clear();
  foes.clear();
}

/** Everything the party sees on a depth (core visibleCells), kept until the next turn. */
export function seenCells(world: World, depth: number): readonly boolean[] {
  sync(world);
  let seen = cells.get(depth);
  if (!seen) cells.set(depth, (seen = visibleCells(world, depth)));
  return seen;
}

/** The enemies a hero sees (core visibleEnemies), kept until the next turn. */
export function seenEnemies(world: World, hero: Hero): readonly Mob[] {
  sync(world);
  const key = `${hero.id}@${hero.depth}`;
  let list = foes.get(key);
  if (!list) foes.set(key, (list = visibleEnemies(world, hero)));
  return list;
}

/** Lets go of what was kept (a new run, another floor of memory). */
export function forgetSight(): void {
  owner = null;
  turn = -1;
  seed = NaN;
  cells.clear();
  foes.clear();
}
