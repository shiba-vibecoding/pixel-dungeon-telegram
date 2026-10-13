import type { Hero } from '../actors';
import { isMagicImmune } from '../buffs';
import type { Ctx } from '../floor';
import { LENGTH } from '../level/geometry';
import type { World } from '../world';
import { type CastAction, spellDef, tomeOf } from './cleric-core';
import { registerSpells } from './cleric-registry';
import { SPELLS_1_3 } from './cleric-spells';
import { T4_SPELLS } from './cleric-t4';

/* The Cleric's holy tome and spells (classes/cleric-core.ts, cleric-spells.ts, cleric-t4.ts): the registry and casting. */

registerSpells(SPELLS_1_3);
registerSpells(T4_SPELLS);

export {
  allSpells, chargeTome, directCharge, hostileMob, isTome, isWornTome, type CastAction, type SpellDef, type SpellId, spellDef, spellsOf, tomeOf, tomeTurn,
} from './cleric-core';

const isCleric = (hero: Hero): boolean => hero.heroClass === 'cleric';

/** Why a spell cannot be cast now (HolyTome.canCast, then the spell's own refusals), or null. */
export function castProblem(world: World, hero: Hero, action: CastAction): string | null {
  if (!isCleric(hero)) return 'you are no cleric';
  const spell = typeof action.spell === 'string' ? spellDef(action.spell) : undefined;
  if (!spell || !spell.has(hero, world)) return 'no such spell';
  const tome = tomeOf(hero);
  if (!tome) return 'art:artifact.need_to_equip';
  if (isMagicImmune(hero)) return 'your magic is suppressed';
  if (tome.cursed) return 'art:holytome.cursed';
  if ((tome.charge ?? 0) < spell.cost(hero, world)) return 'art:holytome.no_spell';
  if (spell.aim === 'cell' && (!Number.isInteger(action.cell) || action.cell! < 0 || action.cell! >= LENGTH)) return 'choose a target';
  if (spell.aim === 'item' && !Number.isInteger(action.item)) return 'choose an item';
  if (spell.aim === 'choice' && !Number.isInteger(action.choice)) return 'choose an effect';
  return spell.problem?.(world, hero, action) ?? null;
}

/** Casts the spell; returns the time it took. */
export function castSpell(ctx: Ctx, hero: Hero, action: CastAction): number {
  return spellDef(action.spell)!.cast(ctx, hero, action);
}

/** HolyTome.setQuickSpell: the spell must be one the hero has. */
export function quickProblem(hero: Hero, spell: string | null): string | null {
  if (!isCleric(hero)) return 'you are no cleric';
  return spell === null || spellDef(spell) ? null : 'no such spell';
}
