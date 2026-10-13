import type { Hero } from '../actors';
import type { Ctx } from '../floor';
import { stepOnPlant } from '../plants';
import { trapAt, triggerTrap } from '../traps';
import { delayPress, frozenBy } from './hourglass';
import { discover, F, hasFlag } from '../level/terrain';

/*
 * Level.pressCell for a hero coming to stand on a cell: a trap goes off, a
 * plant is set off — unless the hero floats above them, or time stands still
 * (the hourglass), when they go off once it starts again.
 */
export function heroPress(ctx: Ctx, hero: Hero): void {
  if ((hero.levitating ?? 0) > 0) return;
  const cell = hero.pos;
  const frozen = frozenBy(hero);
  const trap = trapAt(ctx.level.map[cell]!) !== undefined;
  const plant = ctx.floor.plants?.some((p) => p.pos === cell) ?? false;
  if (frozen && (trap || plant)) {
    // The trap is found, and waits.
    if (trap && hasFlag(ctx.level.map[cell]!, F.SECRET)) ctx.level.map[cell] = discover(ctx.level.map[cell]!);
    delayPress(frozen, cell);
    return;
  }
  if (trap) triggerTrap(ctx, hero, cell);
  stepOnPlant(ctx, hero, cell);
}
