import { type Hero, heroStr, isAlive, type Mob } from '../actors';
import { ballistica, cone, MAGIC_BOLT, STOP_SOLID, STOP_TARGET, WONT_STOP } from '../ballistica';
import { drRoll } from '../combat';
import { weaponProc } from '../enchant';
import { type Char, charAt, type Ctx, enterCell, isHero, leaveCell } from '../floor';
import { adjacent, LENGTH, NEIGHBOURS8 } from '../level/geometry';
import { dispelInvisibility } from '../artifacts';
import { isMagicImmune } from '../buffs';
import { pointsInTalent } from '../talents';
import { isImmune } from '../props';
import { occupyCell, throwChar } from '../wands';
import { harm, isFoe, notAlly, prolong, stateOf, trueDistance } from './common';
import { comboAddTime, comboHit } from './seams';

/*
 * The warrior's armour abilities: HeroicLeap, Shockwave and Endure.
 */

/** Cripple.DURATION, Paralysis.DURATION is ten, Vulnerable.DURATION five: as the abilities set them. */
const SHOCKWAVE_CRIPPLE = 5;

/* Heroic leap */

/** HeroicLeap.chargeUse: a second leap in a row is cheaper with Double Jump (16%, 30%, 41%, 50% off). */
export function leapCharge(hero: Hero, base: number): number {
  const jump = hero.abil?.doubleJump;
  if (jump === undefined) return base;
  return base * 0.84 ** pointsInTalent(hero, 'doubleJump');
}

/** Why the hero cannot leap (HeroicLeap.activate: a rooted hero cannot; nothing says where to). */
export function leapProblem(hero: Hero, target: number | undefined): string | null {
  if (target === undefined || !Number.isInteger(target) || target < 0 || target >= LENGTH) return 'art:actors.hero.abilities.warrior.heroicleap.prompt';
  return hero.rooted > 0 ? 'you are rooted' : null;
}

/**
 * HeroicLeap.activate: over everything to the cell aimed at (short of a wall, and back a cell from anyone standing
 * on the landing), the leap shakes the ground: Body Slam hurts those around, Impact Wave throws them back and may
 * leave them vulnerable. Double Jump makes the next leap cheaper for a few turns.
 */
export function heroicLeap(ctx: Ctx, hero: Hero, target: number): number {
  const { world, depth, level } = ctx;
  const route = ballistica(ctx, hero.pos, target, STOP_TARGET | STOP_SOLID);
  let cell = route.collisionPos;
  // Can't occupy the same cell as another char, so move back one.
  let back = route.dist - 1;
  while (charAt(world, depth, cell) && cell !== hero.pos && back >= 0) {
    cell = route.path[back]!;
    back--;
  }
  const from = hero.pos;
  ctx.effects.push({ type: 'ability', depth, hero: hero.id, ability: 'heroicLeap', from, to: cell });
  if (cell !== hero.pos) {
    leaveCell(world, level, depth, hero.pos);
    hero.pos = cell;
    enterCell(level, cell);
  }
  occupyCell(ctx, hero);

  const slam = pointsInTalent(hero, 'bodySlam');
  const wave = pointsInTalent(hero, 'impactWave');
  for (const n of NEIGHBOURS8) {
    const mob = charAt(world, depth, hero.pos + n);
    if (!mob || mob === hero || isHero(mob) || mob.ally || !isAlive(mob)) continue;
    if (slam > 0) {
      let damage = ctx.rng.normalIntRange(slam, 4 * slam);
      damage += Math.round(drRoll(ctx, hero) * 0.25 * slam);
      damage -= drRoll(ctx, mob);
      harm(ctx, hero, mob, damage);
    }
    if (wave > 0 && isAlive(mob) && mob.pos === hero.pos + n) {
      throwChar(ctx, mob, ballistica(ctx, mob.pos, mob.pos + n, MAGIC_BOLT), 1 + wave, true, true);
      if (isAlive(mob) && ctx.rng.int(4) < wave) prolong(mob, 'vulnerable', 5);
    }
  }
  dispelInvisibility(ctx, hero);

  const state = stateOf(hero);
  if (state.doubleJump !== undefined) delete state.doubleJump;
  else if (pointsInTalent(hero, 'doubleJump') > 0) state.doubleJump = hero.time + 3;
  return 1;
}

/* Shockwave */

/** Why the shockwave cannot be sent (Shockwave.activate: not at oneself). */
export function shockwaveProblem(hero: Hero, target: number | undefined): string | null {
  if (target === undefined || !Number.isInteger(target) || target < 0 || target >= LENGTH) return 'art:actors.hero.abilities.armorability.prompt';
  return target === hero.pos ? 'art:actors.hero.abilities.armorability.self_target' : null;
}

/**
 * Shockwave.activate: a cone of force, five cells and sixty degrees (more with Expanding Wave); everything in it
 * not on the hero's side takes the hero's strength in damage, and is crippled for five turns, or paralysed now and then
 * (Shock Force). Striking Wave lets the blow carry the weapon's enchantment.
 */
export function shockwave(ctx: Ctx, hero: Hero, target: number): number {
  const { depth } = ctx;
  const expanding = pointsInTalent(hero, 'expandingWave');
  const aim = ballistica(ctx, hero.pos, target, WONT_STOP);
  const dist = Math.min(aim.dist, 5 + expanding);
  const shape = cone(ctx, aim, dist, 60 + 15 * expanding, STOP_SOLID | STOP_TARGET);
  ctx.effects.push({ type: 'ability', depth, hero: hero.id, ability: 'shockwave', from: hero.pos, to: target, cells: shape.outerRays.map((ray) => ray.path[ray.dist]!) });
  const force = pointsInTalent(hero, 'shockForce');
  const striking = pointsInTalent(hero, 'strikingWave');
  const state = stateOf(hero);
  for (const cell of shape.cells) {
    const ch = charAt(ctx.world, depth, cell);
    if (!ch || !isAlive(ch) || ch === hero || isHero(ch) || ch.ally) continue;
    const scalingStr = heroStr(hero) - 10;
    let damage = ctx.rng.normalIntRange(5 + scalingStr, 10 + 2 * scalingStr);
    damage = Math.round(damage * (1 + 0.2 * force));
    damage -= drRoll(ctx, ch);
    if (striking === 4) state.strikingWave = true;
    if (ctx.rng.int(10) < 3 * striking) {
      const wasEnemy = isFoe(ch);
      // Hero.attackProc: the weapon's enchantment works on the wave's blow.
      if (damage >= 0 && !isMagicImmune(hero)) damage = weaponProc(ctx, hero, ch, damage, hero.weapon, {});
      harm(ctx, hero, ch, damage);
      if (wasEnemy) comboHit(ctx, hero, ch);
    } else {
      harm(ctx, hero, ch, damage);
    }
    if (isAlive(ch)) {
      if (ctx.rng.int(4) < force) {
        if (!isImmune(ch, 'paralysis')) prolong(ch, 'paralysed', 5);
      } else if (!isImmune(ch, 'slow')) {
        prolong(ch, 'crippled', SHOCKWAVE_CRIPPLE);
      }
    }
  }
  delete state.strikingWave;
  dispelInvisibility(ctx, hero);
  return 1;
}

/* Endure */

/** Endure.activate takes three turns, and the hero's stance lasts twelve in all. */
export const ENDURE_TURNS = 12;
export const ENDURE_TIME = 3;

/** Endure.activate: stand firm for three turns, taking half of every blow (and storing it). */
export function endure(ctx: Ctx, hero: Hero): number {
  const state = stateOf(hero);
  state.endure = { until: hero.time + ENDURE_TURNS, enduring: true, damageBonus: 0, hitsLeft: 0 };
  // A gladiator's combo gets three turns more (Combo.addTime).
  comboAddTime(hero, 3);
  ctx.effects.push({ type: 'ability', depth: ctx.depth, hero: hero.id, ability: 'endure', from: hero.pos, to: hero.pos });
  dispelInvisibility(ctx, hero);
  return ENDURE_TIME;
}

/** Whether the hero's endurance lasts yet at this time. */
export function enduring(hero: Hero, now: number): NonNullable<NonNullable<Hero['abil']>['endure']> | undefined {
  const tracker = hero.abil?.endure;
  if (!tracker) return undefined;
  if (now >= tracker.until) {
    delete hero.abil!.endure;
    return undefined;
  }
  return tracker;
}

/**
 * EndureTracker.adjustDamageTaken: while enduring, half of every blow is stored (as whole points) and the rest halved
 * again for each point of Shrug It Off (total reduction 60%, 68%, 74%, 80%).
 */
export function endureAdjust(hero: Hero, now: number, damage: number): number {
  const tracker = enduring(hero, now);
  if (!tracker?.enduring) return damage;
  tracker.damageBonus = Math.trunc(tracker.damageBonus + damage / 2);
  let multi = 0.5;
  const shrug = pointsInTalent(hero, 'shrugItOff');
  if (shrug > 0) multi *= 0.8 ** shrug;
  return damage * multi;
}

/** EndureTracker.damageFactor: once the stance is over, the stored damage is added to the next blows. */
export function endureStrike(hero: Hero, now: number, damage: number): number {
  const tracker = enduring(hero, now);
  if (!tracker || tracker.enduring) return damage;
  const bonus = tracker.damageBonus;
  tracker.hitsLeft--;
  if (tracker.hitsLeft <= 0) delete hero.abil!.endure;
  return damage + bonus;
}

/**
 * EndureTracker.endEnduring (at the start of the hero's next turn): the stored damage is spread over the blows to come,
 * more with Sustained Retribution (more hits, each 15% heavier) and Even The Odds (5% a point for each enemy within two cells).
 */
export function endEnduring(ctx: Ctx, hero: Hero): void {
  const tracker = enduring(hero, hero.time);
  if (!tracker?.enduring) return;
  tracker.enduring = false;
  tracker.damageBonus = Math.trunc(tracker.damageBonus * (1 + 0.15 * pointsInTalent(hero, 'sustainedRetribution')));
  let nearby = 0;
  for (const mob of ctx.floor.mobs) {
    if (isFoe(mob) && trueDistance(hero.pos, mob.pos) <= 2 && adjacentOrNear(hero.pos, mob.pos)) nearby++;
  }
  tracker.damageBonus = Math.trunc(tracker.damageBonus * (1 + nearby * 0.05 * pointsInTalent(hero, 'evenTheOdds')));
  tracker.hitsLeft = 1 + pointsInTalent(hero, 'sustainedRetribution');
  tracker.damageBonus = Math.trunc(tracker.damageBonus / tracker.hitsLeft);
  if (tracker.damageBonus > 0) {
    ctx.effects.push({ type: 'ability', depth: ctx.depth, hero: hero.id, ability: 'endure', from: hero.pos, to: hero.pos, cells: [tracker.damageBonus] });
  } else {
    delete hero.abil!.endure;
  }
}

/** Level.distance (the longer side) within two cells. */
const adjacentOrNear = (a: number, b: number): boolean => adjacent(a, b) || trueDistance(a, b) <= 2;

export type { Char, Mob };
export { notAlly };
