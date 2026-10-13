import { gearLevel } from '../weapons';
import type { Hero } from '../actors';
import type { Ctx } from '../floor';
import { regenOn } from '../hero';
import { maxShield, shielding as sealShielding } from '../seal';
import { pointsInTalent, hasTalent } from './data';
import { type BerserkBuff, tbOf } from './state';

/*
 * Berserk (actors/buffs/Berserk.java), the berserker's rage. It builds as he takes physical damage, armour or no
 * armour, steadily fades (more slowly the more hurt he is), adds up to half as much again to his blows and, at full
 * rage, can be spent to go berserk: a shield (his broken seal is needed) that fades while he fights on, after which
 * he must recover. Deathless fury lets a full rage start a berserk instead of dying; endless rage raises the cap;
 * enraged catalyst makes his enchantments likelier.
 */

/** Berserk.LEVEL_RECOVER_START and TURN_RECOVERY_START. */
const LEVEL_RECOVER_START = 4;
const TURN_RECOVERY_START = 100;
const f32 = Math.fround;

export const berserkOf = (hero: Hero): BerserkBuff | undefined => (hero.subclass === 'berserker' ? hero.tal?.berserk : undefined);

/** Buff.affect(hero, Berserk.class): the buff, started on first use. */
function affectBerserk(hero: Hero): BerserkBuff {
  const b = tbOf(hero);
  b.berserk ??= { state: 'normal', power: 0, buffer: 0, levelRecovery: 0, turnRecovery: 0, shield: 0 };
  return b.berserk;
}

/** Berserk.maxPower: 100% rage, a sixth more for each point of endless rage. */
export const maxPower = (hero: Hero): number => f32(1 + f32(0.1667 * pointsInTalent(hero, 'endless_rage')));

/** Berserk.damage: rage builds with a quarter of the share of health taken, to its cap; it holds for two turns. */
export function berserkDamaged(hero: Hero, damage: number): void {
  if (hero.subclass !== 'berserker' || damage <= 0) return;
  const berserk = affectBerserk(hero);
  if (berserk.state !== 'normal') return;
  berserk.power = Math.min(maxPower(hero), f32(berserk.power + f32(f32(damage / hero.ht) / 4)));
  berserk.buffer = 3;
}

/** Berserk.damageFactor: up to half as much again. */
export function berserkDamageFactor(hero: Hero, damage: number): number {
  const berserk = berserkOf(hero);
  return berserk ? damage * Math.min(1.5, 1 + berserk.power / 2) : damage;
}

/** Berserk.enchantFactor: enraged catalyst, up to 15% a point more to the chance of an enchantment. */
export function berserkEnchantFactor(hero: Hero, chance: number): number {
  const berserk = berserkOf(hero);
  return berserk ? chance + Math.min(1, berserk.power) * 0.15 * pointsInTalent(hero, 'enraged_catalyst') : chance;
}

/** Whether the berserk can be started now (at full rage, not already berserk or recovering). */
export const canBerserk = (hero: Hero): boolean => {
  const berserk = berserkOf(hero);
  return !!berserk && berserk.state === 'normal' && berserk.power >= 1;
};

/** Berserk.doAction: only with the seal, whose shield the rage is fed by. */
export function berserkProblem(hero: Hero): string | null {
  if (!canBerserk(hero)) return 'no rage to spend';
  return maxShield(hero) > 0 ? null : 'tal:berserk.no_seal';
}

/** Berserk.currentShieldBoost: 8 and two a level of armour, up to three times that when low on health, more with surplus rage. */
export function currentShieldBoost(hero: Hero, berserk: BerserkBuff): number {
  // Base multiplier scales at 1/1.5/2/2.5/3x at 100/37/20/9/0% health.
  let multiplier = f32(1 + f32(2 * f32((1 - hero.hp / hero.ht) ** 3)));
  // Endless rage effect on shield and cooldown.
  if (berserk.power > 1) {
    multiplier = f32(multiplier * berserk.power);
    berserk.levelRecovery = f32(berserk.levelRecovery * f32(2 - berserk.power));
    berserk.turnRecovery = f32(berserk.turnRecovery * f32(2 - berserk.power));
  }
  return Math.round(f32((8 + 2 * gearLevel(hero.armor)) * multiplier));
}

/** Berserk.maxShieldBoost: not counting talents. */
export const maxShieldBoost = (hero: Hero): number => (8 + 2 * gearLevel(hero.armor)) * 3;

/** Berserk.startBerserking. */
export function startBerserking(ctx: Ctx, hero: Hero): void {
  const berserk = affectBerserk(hero);
  berserk.state = 'berserk';
  if (hero.hp > 0 && !berserk.deathless) {
    berserk.turnRecovery = TURN_RECOVERY_START;
    berserk.levelRecovery = 0;
  } else {
    berserk.levelRecovery = LEVEL_RECOVER_START - pointsInTalent(hero, 'deathless_fury');
    berserk.turnRecovery = 0;
  }
  const amount = currentShieldBoost(hero, berserk);
  berserk.shield = Math.max(berserk.shield, amount);
  ctx.effects.push({ type: 'berserk', hero: hero.id, amount });
}

/** Berserk.doAction: go berserk. */
export function doBerserk(ctx: Ctx, hero: Hero): void {
  startBerserking(ctx, hero);
}

/**
 * Berserk.berserking, as Hero.isAlive asks it at zero health: a full rage with deathless fury starts a berserk at the
 * last (the hero then stands at a single point of health, shield and all, until the shield is gone). True if the hero
 * lives.
 */
export function deathlessFury(ctx: Ctx, hero: Hero): boolean {
  const berserk = berserkOf(hero);
  if (!berserk) return false;
  if (berserk.state === 'normal' && berserk.power >= 1 && hasTalent(hero, 'deathless_fury')) {
    hero.hp = 0;
    berserk.deathless = true;
    startBerserking(ctx, hero);
    hero.hp = 1;
    return true;
  }
  return berserk.state === 'berserk' && berserk.shield > 0 && !!berserk.deathless;
}

/** Berserk's shield, the last to take a blow (shieldUsePriority -1): what is left for health. */
export function berserkAbsorbs(hero: Hero, damage: number): number {
  const berserk = berserkOf(hero);
  if (!berserk || berserk.shield <= 0 || damage <= 0) return damage;
  const absorbed = Math.min(berserk.shield, damage);
  berserk.shield -= absorbed;
  return damage - absorbed;
}

/** The shield a berserking hero has over all, as Char.shielding counts it. */
export const berserkShielding = (hero: Hero): number => berserkOf(hero)?.shield ?? 0;

/** After a blow: a deathless berserk whose shield is gone dies at last (Hero.isAlive turns false). True if so. */
export function deathlessEnded(hero: Hero): boolean {
  const berserk = berserkOf(hero);
  if (!berserk?.deathless || berserk.shield > 0) return false;
  return endBerserk(hero, berserk);
}

/** Berserk.recover: levels gained shorten the recovery after a berserk from deathless fury. */
export function berserkRecover(hero: Hero, percent: number): void {
  const berserk = berserkOf(hero);
  if (!berserk || berserk.state !== 'recovering' || berserk.levelRecovery <= 0) return;
  berserk.levelRecovery = f32(berserk.levelRecovery - percent);
  if (berserk.levelRecovery <= 0) {
    berserk.levelRecovery = 0;
    if (berserk.turnRecovery === 0) berserk.state = 'normal';
  }
}

/**
 * Berserk.act, a turn's worth. Berserking, the shield loses 2.5% a turn (a point at least; Hold Fast slows it), and
 * the berserk ends with it; normally the rage fades once it has held its two turns, and the buff is gone with it;
 * recovering, the turns count down.
 */
export function berserkTurn(ctx: Ctx, hero: Hero, holdFastFactor: number): boolean {
  const berserk = berserkOf(hero);
  if (!berserk) return false;
  if (berserk.state === 'berserk') {
    const total = berserk.shield + (hero.shield ?? 0) + sealShielding(hero);
    if (total > 0) {
      // lose 2.5% of shielding per turn, but no less than 1
      let loss = Math.ceil(f32(total * f32(0.025))) * holdFastFactor;
      if (ctx.rng.float() < loss % 1) loss++;
      let left = Math.trunc(loss);
      // ShieldBuff.processDamage: the other shields give way first, then this one.
      for (const take of [takeFromBarrier, takeFromSeal]) left = take(hero, left);
      berserk.shield = Math.max(0, berserk.shield - left);
      if (berserk.shield <= 0) return endBerserk(hero, berserk);
    } else {
      return endBerserk(hero, berserk);
    }
  } else if (berserk.state === 'normal') {
    if (berserk.buffer > 0) {
      berserk.buffer--;
    } else {
      berserk.power = f32(berserk.power - f32(f32(Math.min(1, Math.max(0.1, berserk.power)) * f32(0.05)) * f32((hero.hp / hero.ht) ** 2)));
      if (berserk.power <= 0) delete tbOf(hero).berserk;
    }
  } else if (berserk.state === 'recovering' && berserk.levelRecovery === 0 && regenOn(ctx.world, hero)) {
    berserk.turnRecovery--;
    if (berserk.turnRecovery <= 0) {
      berserk.turnRecovery = 0;
      berserk.state = 'normal';
    }
  }
  return false;
}

function takeFromBarrier(hero: Hero, damage: number): number {
  const taken = Math.min(hero.shield ?? 0, damage);
  if (taken > 0) {
    hero.shield! -= taken;
    if (hero.shield! <= 0) delete hero.shield;
  }
  return damage - taken;
}

function takeFromSeal(hero: Hero, damage: number): number {
  const buff = hero.sealShield;
  if (!buff) return damage;
  const taken = Math.min(buff.shield, damage);
  buff.shield -= taken;
  return damage - taken;
}

/** The shield is gone: the berserk is over, and the berserker must recover (a deathless one dies). */
function endBerserk(hero: Hero, berserk: BerserkBuff): boolean {
  berserk.state = 'recovering';
  berserk.power = 0;
  if (berserk.deathless) {
    delete berserk.deathless;
    hero.hp = 0;
    return true;
  }
  return false;
}
