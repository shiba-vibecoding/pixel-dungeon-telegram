import { type Hero, isAlive } from '../actors';
import type { Ctx } from '../floor';
import { pointsInTalent, hasTalent } from './data';
import { berserkTurn } from './berserk';
import { comboTurn, parryExpires } from './combo';
import { holdFastDecay } from './hold-fast';
import { isInvisible } from '../artifacts';
import { momentumTurn, preparationTurn } from './rogue';
import { tbOf, tick } from './state';

/*
 * What the talents and subclasses do as time passes: their trackers and cooldowns count down as the hero spends time
 * (talentTime), and their buffs act once for every turn that passes (talentTurn: Berserk.act, Combo.act, Momentum.act,
 * Preparation.act, ProtectiveShadowsTracker.act).
 */

/** FlavourBuffs and cooldowns count down as time passes; gone below zero (they end at the turn's end). */
export function talentTime(hero: Hero, time: number): void {
  const b = hero.tal;
  if (!b) return;
  for (const key of ['improvised', 'rejuvenating', 'seerShot', 'provoked', 'lingering', 'empowered', 'enhancedRings', 'surge'] as const) tick(b, key, time);
  if (b.followup && (b.followup.left -= time) < 0) delete b.followup;
  if (b.sniper && (b.sniper.left -= time) < 0) delete b.sniper;
  if (b.revealed && (b.revealed.left -= time) < 0) delete b.revealed;
}

/** One turn of the hero's talent buffs; true if a deathless berserk ran out and the hero must die of it. */
export function talentTurn(ctx: Ctx, hero: Hero): boolean {
  if (!hero.tal && hero.subclass === null && !hasTalent(hero, 'protective_shadows')) return false;
  // Momentum acts before the hero, Preparation after other buffs so invisibility processes first.
  momentumTurn(hero);
  preparationTurn(hero);
  comboTurn(hero);
  const died = berserkTurn(ctx, hero, holdFastDecay(hero));
  shadowsTurn(hero);
  return died;
}

/** ProtectiveShadowsTracker.act: unseen, a barrier builds up (to 3/5), a point every two turns (one at +2). */
function shadowsTurn(hero: Hero): void {
  const points = pointsInTalent(hero, 'protective_shadows');
  const b = tbOf(hero);
  if (points <= 0 || !isInvisible(hero)) {
    delete b.shadows;
    return;
  }
  let inc = b.shadows ?? 0.5;
  if ((hero.shield ?? 0) < 1 + 2 * points) inc += 0.5 * points;
  if (inc >= 1) {
    inc = 0;
    hero.shield = (hero.shield ?? 0) + 1;
  }
  hero.shieldDecay = 0;
  b.shadows = inc;
}

/** The start of a hero's action: a parry's turn is over, iron stomach is over, a lethal momentum unused is gone. */
export function beforeHeroAct(ctx: Ctx, hero: Hero): void {
  if (!hero.tal) return;
  parryExpires(ctx, hero);
  if (hero.tal.ironStomach && (ctx.floor.now >= hero.tal.ironStomach.until || hero.tal.ironStomach.depth !== hero.depth)) delete hero.tal.ironStomach;
  delete hero.tal.lethalMomentum;
}

/** Hero.attackDelay / Item.cast: a lethal momentum tracker makes the act free, and is used up. */
export function consumeLethalMomentum(hero: Hero): boolean {
  if (!hero.tal?.lethalMomentum) return false;
  delete hero.tal.lethalMomentum;
  return true;
}

export { isAlive };
