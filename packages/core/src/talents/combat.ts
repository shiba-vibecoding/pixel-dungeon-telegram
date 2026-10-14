import type { Char, Ctx } from '../floor';
import { type Hero, isAlive, type Mob } from '../actors';
import { type Item, itemDef } from '../items';
import { surprises } from '../combat';
import { hasTalent, pointsInTalent } from './data';
import { berserkDamaged } from './berserk';
import { tbOf } from './state';

/*
 * Talent.onAttackProc and the other places the talents meet a blow: the trackers that add to the next hit, the shields
 * that give way, a kill that frees the next act. (Subclass buffs: berserk.ts, combo.ts, rogue.ts, huntress.ts.)
 */

const PROVOKED_TURNS = 5;

/**
 * Talent.onAttackProc: provoked anger, lingering magic, a sucker punch and a follow-up strike add to the blow.
 * `thrown`: the hero threw the weapon (a missile or an arrow), `enemy` is who it struck.
 */
export function onAttackProc(ctx: Ctx, hero: Hero, enemy: Mob, damage: number, weapon: Item | null, thrown: boolean): number {
  const b = tbOf(hero);
  if (hasTalent(hero, 'provoked_anger') && b.provoked !== undefined) {
    damage += 1 + 2 * pointsInTalent(hero, 'provoked_anger');
    delete b.provoked;
  }
  if (hasTalent(hero, 'lingering_magic') && b.lingering !== undefined) {
    damage += ctx.rng.intRange(pointsInTalent(hero, 'lingering_magic'), 2);
    delete b.lingering;
  }
  if (hasTalent(hero, 'sucker_punch') && surprises(hero, enemy, weapon) && !enemy.suckered) {
    damage += ctx.rng.intRange(pointsInTalent(hero, 'sucker_punch'), 2);
    enemy.suckered = true;
  }
  if (hasTalent(hero, 'followup_strike') && isAlive(enemy) && !enemy.ally && enemy.state !== 'passive') {
    if (thrown && weapon && itemDef(weapon.kind).category === 'missile') {
      b.followup = { object: enemy.id, left: 5 };
    } else if (b.followup && b.followup.object === enemy.id) {
      damage += 1 + pointsInTalent(hero, 'followup_strike');
      delete b.followup;
    }
  }
  return damage;
}

/**
 * Item.cast: improvised projectiles. A thing that is no thrown weapon, flung at an enemy, blinds it for 1 turn and one
 * more a point; it can be done once in 50 turns.
 */
export function improvisedProjectile(ctx: Ctx, hero: Hero, thrown: Item, cell: number): void {
  const points = pointsInTalent(hero, 'improvised_projectiles');
  const b = tbOf(hero);
  if (points <= 0 || b.improvised !== undefined || itemDef(thrown.kind).category === 'missile') return;
  const foe = ctx.floor.mobs.find((m) => m.pos === cell && isAlive(m) && !m.ally && m.state !== 'passive');
  if (!foe) return;
  foe.blind = Math.max(foe.blind ?? 0, 1 + points);
  b.improvised = 50;
  ctx.effects.push({ type: 'hit', hero: hero.id });
}

/** ShieldBuff.processDamage: a shield used up (shielding at nought) sets off provoked anger. */
export function onShieldBroken(hero: Hero): void {
  if (hasTalent(hero, 'provoked_anger')) tbOf(hero).provoked = PROVOKED_TURNS;
}

/** Hero.defenseProc: the berserker's rage builds on the blow (before armour). */
export function onDefenseProc(hero: Hero, damage: number): void {
  berserkDamaged(hero, damage);
}

/** Hero.damage with warrior food immunity: a quarter of the harm, none at all with the second point, until the hero acts. */
export function ironStomachFactor(ctx: Ctx, hero: Hero, damage: number): number {
  const stomach = hero.tal?.ironStomach;
  if (!stomach || stomach.depth !== hero.depth || ctx.floor.now >= stomach.until) return damage;
  return pointsInTalent(hero, 'iron_stomach') === 1 ? damage / 4 : 0;
}

/**
 * Mob.die: a kill by the hero may free the next act (lethal momentum: 34% and 33% a point), and the hero's loot luck
 * is noted for bounty hunter. `cause` is who dealt the blow.
 */
export function onMobKilled(ctx: Ctx, hero: Hero, _mob: Mob): void {
  if (hasTalent(hero, 'lethal_momentum') && ctx.rng.float() < 0.34 + 0.33 * pointsInTalent(hero, 'lethal_momentum')) {
    tbOf(hero).lethalMomentum = true;
  }
}

/** Mob.lootChance: bounty hunter, after a prepared strike: 2/4/8/16% by preparation level, a point each. */
export function bountyBonus(hero: Hero): number {
  const b = hero.tal;
  if (!b?.bounty || b.prepLevel === undefined) return 0;
  return 0.02 * 2 ** b.prepLevel * pointsInTalent(hero, 'bounty_hunter');
}

export type { Char };
