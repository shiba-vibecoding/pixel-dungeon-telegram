import type { Hero } from '../actors';
import type { Ctx } from '../floor';
import type { World } from '../world';
import type { ClassAction } from './actions';

/* The Cleric's holy tome and spells (filled in below). */

export function tomeTurn(_ctx: Ctx, _hero: Hero): void {
  // (the tome's recharge)
}

export function castProblem(_world: World, _hero: Hero, _action: Extract<ClassAction, { type: 'cast' }>): string | null {
  return 'no such spell';
}

export function castSpell(_ctx: Ctx, _hero: Hero, _action: Extract<ClassAction, { type: 'cast' }>): number {
  return 0;
}

export function quickProblem(_hero: Hero, _spell: string | null): string | null {
  return 'no such spell';
}
