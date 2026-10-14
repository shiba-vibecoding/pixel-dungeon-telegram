import { exploredCells, type Floor, gasAt, type Hero, type Level, T, visibleCells, type World } from '@pd/core';

/*
 * Mis-tap protection: on a phone a thumb lands a cell off about one time in ten, and one death in ten is such a
 * tap. A tap that would put the hero straight onto a trap they can see, or into flames they can see, asks first
 * (the chasm's question, main.ts); the answer «don't ask again» is kept in the settings, on this device.
 * Pure rules here; the question and the settings switch live with the other windows.
 */

export type Danger = 'trap' | 'fire';

const KEY = 'pd-confirm-danger';

/** Whether the question is asked at all (the settings): on unless the player turned it off. */
export const confirmDanger = {
  on: ((): boolean => {
    try {
      return localStorage.getItem(KEY) !== 'off';
    } catch {
      return true;
    }
  })(),
  set(on: boolean): void {
    this.on = on;
    try {
      localStorage.setItem(KEY, on ? 'on' : 'off');
    } catch {
      // For this session only.
    }
  },
};

/** Fire.evolve's flames and the inferno's: a burning cell burns whoever stands in it. */
export const burns = (floor: Floor | undefined, cell: number): boolean =>
  !!floor && (gasAt(floor, 'fire', cell) > 0 || gasAt(floor, 'inferno', cell) > 0);

/** The cells in sight that are burning now (what a tap's route should keep out of). */
export function burningCells(world: World, depth: number): Set<number> {
  const cells = new Set<number>();
  const floor = world.floors[depth];
  if (!floor?.gas) return cells;
  const seen = visibleCells(world, depth);
  for (const kind of ['fire', 'inferno'] as const) {
    for (const [cell, volume] of floor.gas[kind] ?? []) if (volume > 0 && seen[cell]) cells.add(cell);
  }
  return cells;
}

/**
 * What stepping onto a cell would be: a trap the hero knows of (a hidden one is not known), or flames in sight; a hero
 * floating over the floor, or already burning, fears neither. Null: nothing the hero could not see coming.
 */
export function stepDanger(world: World, hero: Hero, level: Level, cell: number): Danger | null {
  if ((hero.levitating ?? 0) > 0) return null;
  const terrain = level.map[cell];
  if (terrain === T.TRAP && exploredCells(world, hero.depth)[cell]) return 'trap';
  if (hero.burning <= 0 && visibleCells(world, hero.depth)[cell] && burns(world.floors[hero.depth], cell)) return 'fire';
  return null;
}

/** The first danger on a walk, with its place in it. */
export function firstDanger(world: World, hero: Hero, level: Level, path: readonly number[]): { index: number; danger: Danger } | null {
  for (let index = 0; index < path.length; index++) {
    const danger = stepDanger(world, hero, level, path[index]!);
    if (danger) return { index, danger };
  }
  return null;
}
