import type { Hero, Mob } from '../actors';
import { setShield } from '../buffs';
import type { Ctx } from '../floor';
import type { Item } from '../items';
import { hasProp } from '../props';
import { clearTimer, cs, hasTimer, prolong, prolongForAction, setTimer } from './state';
import { gainCharge } from './charger';
import { pointsInTalent as pointsIn } from '../talents';
import { isHero } from '../floor';
import { onCombinedEnergyWeapon } from './monk';

/*
 * The Duelist's talents (Talent.java and the places Shattered consults them): what each does and when. Tier 1
 * and 2 are hers from the start, tier 3 by her way, and the armour abilities' in classes/duelist-armor.ts.
 */

const fx = (ctx: Ctx, hero: Hero, fxx: import('./fx').ClassFx): void => {
  ctx.effects.push({ type: 'classFx', depth: ctx.depth, hero: hero.id, fx: fxx });
};

/** Greater Haste (lethal haste): moves that take no time, for so many moves. */
export function giveGreaterHaste(hero: Hero, moves: number): void {
  cs(hero).greaterHaste = moves;
}

/** MeleeWeapon.beforeAbilityUsed's talent: aggressive barrier shields a Duelist at half her health or less. */
export function onBeforeAbility(ctx: Ctx, hero: Hero): void {
  const points = pointsIn(hero, 'aggressive_barrier');
  if (hero.heroClass === 'duelist' && points > 0 && hero.hp / hero.ht <= 0.5) {
    const amount = 1 + 2 * points;
    setShield(hero, amount);
    ctx.effects.push({ type: 'barrier', depth: ctx.depth, who: hero.id, amount });
    fx(ctx, hero, { k: 'text', at: hero.pos, text: String(amount), tone: 'p', icon: 'shield' });
  }
}

/** Talent.AggressiveBarrierCooldown's other use: a non-Duelist's barrier on attacking, once in fifty turns (metamorphosis). */
export function aggressiveBarrierOnAttack(ctx: Ctx, hero: Hero): void {
  const points = pointsIn(hero, 'aggressive_barrier');
  if (hero.heroClass === 'duelist' || points === 0 || hasTimer(hero, 'aggressive') || hero.hp / hero.ht > 0.5) return;
  const amount = 1 + 2 * points;
  setShield(hero, amount);
  ctx.effects.push({ type: 'barrier', depth: ctx.depth, who: hero.id, amount });
  setTimer(hero, 'aggressive', 50);
}

/** MeleeWeapon.afterAbilityUsed: the talents that wait for an ability to be used. */
export function onAbilityUsed(ctx: Ctx, hero: Hero, wep: Item): void {
  const state = cs(hero);
  if (pointsIn(hero, 'precise_assault') > 0) prolongForAction(hero, 'precise', 4);
  if (pointsIn(hero, 'varied_charge') > 0) {
    if (state.varied === undefined || state.varied === wep.kind) {
      state.varied = wep.kind;
    } else {
      delete state.varied;
      gainCharge(hero, pointsIn(hero, 'varied_charge') / 6);
      fx(ctx, hero, { k: 'spell', at: hero.pos, name: 'charge' });
    }
  }
  if (pointsIn(hero, 'combined_lethality') > 0) {
    if (state.lethality === undefined || state.lethality === wep.kind) {
      state.lethality = wep.kind;
      prolongForAction(hero, 'lethality', 0);
    } else {
      // We triggered the talent, so remove the tracker.
      delete state.lethality;
      clearTimer(hero, 'lethality');
    }
  }
  onCombinedEnergyWeapon(ctx, hero);
  if (hasTimer(hero, 'counter')) {
    gainCharge(hero, pointsIn(hero, 'counterAbility') * 0.375);
    clearTimer(hero, 'counter');
  }
}

/** MeleeWeapon.onAbilityKill: lethal haste, effectively 3/5 turns of greater haste. */
export function onAbilityKill(_ctx: Ctx, hero: Hero, killed: Mob): void {
  if (!killed.ally && pointsIn(hero, 'lethal_haste') > 0) giveGreaterHaste(hero, 2 + 2 * pointsIn(hero, 'lethal_haste'));
}

/**
 * Char.attack's combined lethality: after the next attack with another weapon than the one whose ability was used, an
 * enemy below 13/27/40% of its health is slain outright (not bosses). Returns whether it was.
 */
export function combinedLethality(hero: Hero, foe: Mob, weapon: Item | null): boolean {
  if (!hasTimer(hero, 'lethality') || !weapon || cs(hero).lethality === undefined || cs(hero).lethality === weapon.kind) return false;
  clearTimer(hero, 'lethality');
  delete cs(hero).lethality;
  const props = (p: 'boss' | 'miniboss'): boolean => hasProp(foe, p);
  return foe.hp > 0 && !foe.ally && !props('boss') && !props('miniboss') && foe.hp / foe.ht <= (0.4 * pointsIn(hero, 'combined_lethality')) / 3;
}

/** Talent.onFoodEaten: the Duelist's meals. */
export function onFoodEaten(ctx: Ctx, hero: Hero): void {
  const strengthening = pointsIn(hero, 'strengthening_meal');
  if (strengthening > 0) {
    // 3 bonus physical damage for the next 2/3 attacks (PhysicalEmpower.set keeps the stronger).
    const left = 1 + strengthening;
    const old = cs(hero).empower;
    if (!old || 3 * left > old.dmg * old.left) cs(hero).empower = { dmg: 3, left };
  }
  const focused = pointsIn(hero, 'focused_meal');
  if (focused > 0 && hero.heroClass === 'duelist') {
    // 0.67/1 charge for the duelist.
    gainCharge(hero, (focused + 1) / 3);
    fx(ctx, hero, { k: 'spell', at: hero.pos, name: 'charge' });
  }
}

/** Talent.onPotionUsed: liquid agility. `factor` is 1 for a potion drunk, less for one thrown or a lesser source. */
export function onPotionUsed(_ctx: Ctx, hero: Hero, factor: number): void {
  if (pointsIn(hero, 'liquid_agility') === 0) return;
  prolongForAction(hero, 'liqEva', Math.max(0, factor - 1));
  if (factor >= 0.5) {
    prolong(hero, 'liqAcc', 5);
    cs(hero).liquidUses = Math.round(factor);
  }
}

/** Hero.damageRoll's PhysicalEmpower: damage added to the next hits (strengthening meal). */
export function takeEmpower(hero: Hero): number {
  const empower = hero.cls?.empower;
  if (!empower) return 0;
  empower.left--;
  const dmg = empower.dmg;
  if (empower.left <= 0) delete hero.cls!.empower;
  return dmg;
}

/** Hero.attackSkill: precise assault and liquid agility. `ability`: an ability's blow (they do not count it). Returns the factor. */
export function accuracyFactor(hero: Hero, weapon: Item | null, ability: boolean, unarmedAbility: boolean): number {
  const preciseLevel = pointsIn(hero, 'precise_assault');
  if (!(preciseLevel > 0 || pointsIn(hero, 'liquid_agility') > 0) || ability || unarmedAbility) return 1;
  let factor = 1;
  // The non-Duelist benefit of precise assault: a lasting +10/20/30% accuracy.
  if (hero.heroClass !== 'duelist') factor *= 1 + 0.1 * preciseLevel;
  if (weapon?.kind === 'weapon.flail' && hasTimer(hero, 'spin')) return factor;
  if (weapon?.kind === 'weapon.crossbow' && cs(hero).charged) return factor;
  if (hasTimer(hero, 'precise')) {
    // 2x/5x/inf. accuracy for the Duelist who just used a weapon ability.
    return factor * (preciseLevel >= 3 ? Infinity : preciseLevel === 2 ? 5 : 2);
  }
  if (hasTimer(hero, 'liqAcc') && (cs(hero).liquidUses ?? 0) > 0) {
    cs(hero).liquidUses = (cs(hero).liquidUses ?? 0) - 1;
    return factor * (pointsIn(hero, 'liquid_agility') === 2 ? Infinity : 3);
  }
  return factor;
}

/** Hero.attack's cleanup after a blow that was not a thrown weapon's. */
export function afterAttack(hero: Hero): void {
  if (hasTimer(hero, 'precise')) clearTimer(hero, 'precise');
  else if (hasTimer(hero, 'liqAcc') && (cs(hero).liquidUses ?? 0) <= 0) clearTimer(hero, 'liqAcc');
}

/** Hero.defenseSkill: liquid agility (three times as evasive, or never hit) and the quarterstaff's stance. Returns [factor, infinite]. */
export function evasionFactor(hero: Hero, at: number): [number, boolean] {
  let factor = 1;
  if (hasTimer(hero, 'liqEva', at)) {
    if (pointsIn(hero, 'liquid_agility') === 1) factor *= 3;
    else if (pointsIn(hero, 'liquid_agility') === 2) return [1, true];
  }
  if (hasTimer(hero, 'defensive', at)) factor *= 3;
  return [factor, false];
}

/** Talent.onAttackProc's Duelist parts: patient strike, deadly followup. */
export function onAttackProc(hero: Hero, foe: Mob, damage: number, thrown: boolean, arrow: boolean, rng: { intRange(a: number, b: number): number }): number {
  const state = cs(hero);
  const patient = pointsIn(hero, 'patient_strike');
  if (patient > 0 && state.patient === hero.pos && !thrown) {
    delete state.patient;
    damage += rng.intRange(patient, 2);
  }
  const followup = pointsIn(hero, 'deadly_followup');
  if (followup > 0 && !foe.ally && foe.state !== 'passive') {
    if (thrown) {
      if (!arrow) {
        state.followup = foe.id;
        prolong(hero, 'followup', 5);
      }
    } else if (hasTimer(hero, 'followup') && state.followup === foe.id) {
      damage = Math.round(damage * (1 + 0.1 * followup));
    }
  }
  return damage;
}

/** Hero.moveStep: a move under greater haste takes no time and uses a move up. */
export function greaterHasteMove(hero: Hero): boolean {
  const left = hero.cls?.greaterHaste ?? 0;
  if (left <= 0) return false;
  hero.cls!.greaterHaste = left - 1;
  if (left - 1 <= 0) delete hero.cls!.greaterHaste;
  return true;
}

/** Hero.rest: patient strike remembers where the hero waited. */
export function onRest(hero: Hero): void {
  if (pointsIn(hero, 'patient_strike') > 0) cs(hero).patient = hero.pos;
}

/** Talent.onTalentUpgraded's Duelist parts. */
export function onTalentUpgraded(_ctx: Ctx, _hero: Hero, _talent: string): void {
  // (Adventurer's intuition identifies what is held at +2: ident.ts asks identifiedByTalent.)
}

/** Talent.itemIDSpeedFactor: adventurer's intuition makes weapons identify 2.5x/instantly and armour 1.75x/2.5x as fast. */
export function intuitionSpeed(hero: Hero, category: 'weapon' | 'armor'): number {
  const points = pointsIn(hero, 'adventurers_intuition');
  return category === 'weapon' ? 1 + 1.5 * points : 1 + 0.75 * points;
}

/** Whether adventurer's intuition identifies on equipping (+2). */
export const identifiesOnEquip = (hero: Hero): boolean => pointsIn(hero, 'adventurers_intuition') === 2;

export { isHero };
