import { type Hero, isAlive } from '../actors';
import type { Char, Ctx } from '../floor';
import { type Item } from '../items';
import { shieldUp } from '../status';
import { hasTalent, pointsInTalent } from './data';
import { tbOf } from './state';

/*
 * The mage's talents in the wands (Wand.java, MagesStaff.java): desperate power and inscribed power raise the level a wand
 * zaps at; empowering meal adds to its damage; arcane vision shows who was zapped; backup barrier, shield battery and
 * excess charge shield the mage; empowered strike and mystical charge answer the staff's blows; lingering magic follows
 * a zap with a stronger blow.
 */

/** Wand.buffedLvl's additions: a scroll's empowerment (+2 while it lasts), and desperate power on the last charge. */
export function wandLevelBonus(hero: Hero, wand: Item): number {
  let bonus = 0;
  if ((hero.tal?.scrollEmpower ?? 0) > 0) bonus += 2;
  if ((wand.charges ?? 0) === 1 && hasTalent(hero, 'desperate_power')) bonus += pointsInTalent(hero, 'desperate_power');
  return bonus;
}

/** DamageWand.damageRoll with WandEmpower: the bonus damage (one of its zaps used up). */
export function empowerBoost(ctx: Ctx, hero: Hero): number {
  const empower = hero.tal?.wandEmpower;
  if (!empower) return 0;
  const boost = empower.boost;
  if (--empower.left <= 0) delete hero.tal!.wandEmpower;
  ctx.effects.push({ type: 'hit', hero: hero.id });
  return boost;
}

/** Wand.wandUsed's use of ScrollEmpower: one zap of the empowerment is gone. */
export function scrollEmpowerUsed(hero: Hero): void {
  const b = hero.tal;
  if (b?.scrollEmpower === undefined) return;
  if (--b.scrollEmpower <= 0) delete b.scrollEmpower;
}

/** Wand.wandProc: arcane vision shows whom the wand reached for a while (5 and 5 a point turns). */
export function onWandProc(hero: Hero, target: Char): void {
  if (!hasTalent(hero, 'arcane_vision') || 'heroClass' in target) return;
  const left = 5 + 5 * pointsInTalent(hero, 'arcane_vision');
  (hero.aware ??= []).push({ char: target.id, depth: hero.depth, left });
}

const shield = (ctx: Ctx, hero: Hero, amount: number): void => {
  shieldUp(hero, Math.max(hero.shield ?? 0, amount));
  ctx.effects.push({ type: 'barrier', depth: ctx.depth, who: hero.id, amount });
};

/** Wand.Zapper.onSelect: backup barrier, as the last charge is spent (before the zap): 3/5 shielding. */
export function backupBarrier(ctx: Ctx, hero: Hero, wand: Item, inStaff: boolean, chargesPerCast: number, wands: Item[]): void {
  if (!hasTalent(hero, 'backup_barrier') || (wand.charges ?? 0) !== chargesPerCast) return;
  const amount = 1 + 2 * pointsInTalent(hero, 'backup_barrier');
  if (hero.heroClass === 'mage' && inStaff) {
    shield(ctx, hero, amount);
  } else if (hero.heroClass !== 'mage') {
    // Metamorphosed: when the wand is the highest level the hero has.
    if (wands.every((other) => other.level <= wand.level)) shield(ctx, hero, amount);
  }
}

/** Wand.Zapper.onSelect at oneself: shield battery turns the wand's charges into a shield (4% of health a charge). */
export function shieldBattery(ctx: Ctx, hero: Hero, wand: Item): boolean {
  if (!hasTalent(hero, 'shield_battery') || (wand.charges ?? 0) <= 0) return false;
  let amount = hero.ht * (0.04 * (wand.charges ?? 0));
  if (pointsInTalent(hero, 'shield_battery') === 2) amount *= 1.5;
  shield(ctx, hero, Math.round(amount));
  wand.charges = 0;
  ctx.effects.push({ type: 'charged', hero: hero.id });
  return true;
}

/** Wand.wandUsed before the charge is spent: a staff's wand zapped while full gives an excess charge shield. */
export function beforeWandSpent(ctx: Ctx, hero: Hero, wand: Item, inStaff: boolean, level: number, max: number): void {
  if (inStaff && hasTalent(hero, 'excess_charge') && (wand.charges ?? 0) >= max) {
    shield(ctx, hero, Math.round(level * 0.67 * pointsInTalent(hero, 'excess_charge')));
  }
}

/** Wand.wandUsed after it: empowered strike (a staff's zap) and lingering magic (any zap) follow with a stronger blow. */
export function afterWandSpent(hero: Hero, inStaff: boolean): void {
  const b = tbOf(hero);
  if (hasTalent(hero, 'empowered_strike') && inStaff) b.empowered = Math.max(b.empowered ?? 0, 10);
  if (hasTalent(hero, 'lingering_magic')) b.lingering = Math.max(b.lingering ?? 0, 5);
}

/** Wand.procChanceMultiplier: empowered strike makes the staff's wand effects likelier (not changed by enchantment multipliers). */
export function wandProcMultiplier(hero: Hero): number {
  return hero.tal?.empowered !== undefined ? 1 + pointsInTalent(hero, 'empowered_strike') / 2 : 1;
}

/** MagesStaff.proc: mystical charge feeds the artifacts, empowered strike hits harder. Returns the damage. */
export function staffProc(hero: Hero, damage: number, chargeArtifacts: (amount: number) => void): number {
  if (hasTalent(hero, 'mystical_charge')) chargeArtifacts(pointsInTalent(hero, 'mystical_charge') / 2);
  if (hero.tal?.empowered !== undefined) damage = Math.round(damage * (1 + pointsInTalent(hero, 'empowered_strike') / 6));
  return damage;
}

/** MagesStaff.proc's end: the empowerment is spent with the blow. */
export function staffProcDone(hero: Hero): void {
  if (hero.tal?.empowered !== undefined) delete hero.tal.empowered;
}

export { isAlive };
