import type { Hero } from '../actors';
import type { Ctx } from '../floor';
import type { World } from '../world';
import { abilityProblem, useAbility } from './duelist';
import { type MonkAbility, monkProblem, useMonk } from './monk';
import { cs } from './state';
import { hasTalent, pointsIn, talentProblem } from '../talents';
import { upgradeTalent } from './talent-effects';
import { castProblem, castSpell, quickProblem } from './cleric';
import { wearsForce } from '../rings';
import { heroRings } from '../actors';

/*
 * What the Duelist and the Cleric can do that others cannot, as actions the rules replay: a talent point spent, a
 * weapon's ability, a Monk's ability, the Champion's swap of weapons, the brawler's stance, a Cleric's spell and the
 * choice of a quick spell.
 */

export type ClassAction =
  /** Hero.upgradeTalent: a point into a talent (no time). */
  | { type: 'talent'; talent: string }
  /** The ability of the weapon in hand, or the Champion's second one, aimed at a cell where it asks for one. */
  | { type: 'ability'; which?: 'weapon' | 'second'; cell?: number }
  /** One of the Monk's five abilities. */
  | { type: 'monk'; ability: MonkAbility; cell?: number }
  /** MeleeWeapon.Charger.doAction: the Champion swaps her weapons (no time). */
  | { type: 'swap' }
  /** RingOfForce's «brawler's stance»: taken, or let go. */
  | { type: 'stance' }
  /** A spell of the holy tome; `cell` where it is aimed, `item` and `choice` what it takes besides. */
  | { type: 'cast'; spell: string; cell?: number; item?: number; choice?: number }
  /** HolyTome.setQuickSpell: the spell the quick button casts (none, or the same again, clears it). */
  | { type: 'quick'; spell: string | null };

export const CLASS_ACTIONS: ReadonlySet<string> = new Set(['talent', 'ability', 'monk', 'swap', 'stance', 'cast', 'quick']);
export const isClassAction = (action: { type: string }): action is ClassAction => CLASS_ACTIONS.has(action.type);

/** Why a class action cannot be done now, or null. */
export function classProblem(world: World, hero: Hero, action: ClassAction): string | null {
  switch (action.type) {
    case 'talent':
      return typeof action.talent === 'string' ? talentProblem(hero, action.talent) : 'no such talent';
    case 'ability':
      return abilityProblem(world, hero, action.which ?? 'weapon', action.cell);
    case 'monk':
      return monkProblem(world, hero, action.ability, action.cell);
    case 'swap':
      if (hero.subclass !== 'champion') return 'you are no champion';
      return hero.secondWep || hero.items.length < 20 ? null : 'art:items.weapon.melee.meleeweapon.swap_full';
    case 'stance':
      if (hero.heroClass !== 'duelist') return 'you are no duelist';
      return wearsForce(hero) && heroRings(hero).some((ring) => ring.kind === 'ring.force') ? null : 'wear a ring of force first';
    case 'cast':
      return castProblem(world, hero, action);
    case 'quick':
      return quickProblem(hero, action.spell);
  }
}

/** Does a class action; returns the time it took. */
export function performClass(ctx: Ctx, hero: Hero, action: ClassAction): number {
  switch (action.type) {
    case 'talent':
      upgradeTalent(ctx, hero, action.talent);
      return 0;
    case 'ability':
      return useAbility(ctx, hero, action.which ?? 'weapon', action.cell);
    case 'monk':
      return useMonk(ctx, hero, action.ability, action.cell);
    case 'swap': {
      const first = hero.weapon;
      hero.weapon = hero.secondWep ?? null;
      hero.secondWep = first;
      ctx.effects.push({ type: 'classFx', depth: ctx.depth, hero: hero.id, fx: { k: 'sound', name: 'unlock' } });
      ctx.effects.push({ type: 'classFx', depth: ctx.depth, hero: hero.id, fx: { k: 'operate' } });
      return 0;
    }
    case 'stance': {
      // RingOfForce.execute: the stance is taken (at least fifty turns), or let go of while it is active.
      const stance = cs(hero).brawl;
      if (stance?.active) stance.active = false;
      else cs(hero).brawl = { active: true, min: 50 };
      ctx.effects.push({ type: 'classFx', depth: ctx.depth, hero: hero.id, fx: { k: 'operate' } });
      return 0;
    }
    case 'cast':
      return castSpell(ctx, hero, action);
    case 'quick':
      cs(hero).quick = action.spell === cs(hero).quick ? undefined : action.spell ?? undefined;
      if (cs(hero).quick === undefined) delete cs(hero).quick;
      return 0;
  }
}

export { hasTalent, pointsIn };
