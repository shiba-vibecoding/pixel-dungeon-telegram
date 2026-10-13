import type { Hero } from '../actors';
import type { Ctx } from '../floor';
import type { World } from '../world';

/* The Cleric's armour abilities (filled in below). */
export const ascendedProblem = (_world: World, _hero: Hero, _cell: number | undefined): string | null => null;
export const doAscend = (_ctx: Ctx, _hero: Hero, _cell: number | undefined): number => 0;
export const powerProblem = (_world: World, _hero: Hero, _cell: number | undefined): string | null => null;
export const doPowerOfMany = (_ctx: Ctx, _hero: Hero, _cell: number | undefined): number => 0;
export const trinityProblem = (_world: World, _hero: Hero, _cell: number | undefined): string | null => null;
export const doTrinity = (_ctx: Ctx, _hero: Hero, _cell: number | undefined): number => 0;
export const trinityCost = (_hero: Hero): number => 35;
