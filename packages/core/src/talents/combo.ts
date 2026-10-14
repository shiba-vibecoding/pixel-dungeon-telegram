import { type Hero, heroAttackDelay, heroDamageRoll, heroReach, isAlive, type Mob } from '../actors';
import { dispelInvisibility } from '../artifacts';
import { ballistica, PROJECTILE } from '../ballistica';
import { attack, drRoll, hurt } from '../combat';
import { isEnemy } from '../enchant';
import { charAt, type Ctx, enterCell, isPassable, leaveCell } from '../floor';
import { adjacent, distance } from '../level/geometry';
import { F, hasFlag } from '../level/terrain';
import { flies } from '../status';
import { canReach } from '../throwing';
import { occupyCell, staffReach, throwChar } from '../wands';
import { pointsInTalent } from './data';
import { holdFastDecay } from './hold-fast';
import { type ComboBuff, tbOf } from './state';

/*
 * Combo (actors/buffs/Combo.java), the gladiator's. Every successful blow with a melee or thrown weapon adds a point;
 * wait more than five turns (fifteen after a kill, thirty with cleave) and it is lost. As it grows, special blows that
 * cannot miss open up: clobber at 2, slam at 4, parry at 6, crush at 8, fury at 10. Enhanced combo adds to each, and
 * lethal defense shortens the seal's cooldown on kills.
 */

export type ComboMove = 'clobber' | 'slam' | 'parry' | 'crush' | 'fury';
export const COMBO_MOVES: readonly ComboMove[] = ['clobber', 'slam', 'parry', 'crush', 'fury'];
/** ComboMove.comboReq. */
export const COMBO_REQ: Readonly<Record<ComboMove, number>> = { clobber: 2, slam: 4, parry: 6, crush: 8, fury: 10 };

const f32 = Math.fround;

export const comboOf = (hero: Hero): ComboBuff | undefined => (hero.subclass === 'gladiator' ? hero.tal?.combo : undefined);

/** Combo.getHighestMove. */
export function highestMove(combo: ComboBuff): ComboMove | null {
  let best: ComboMove | null = null;
  for (const move of COMBO_MOVES) if (combo.count >= COMBO_REQ[move]) best = move;
  return best;
}

/** Combo.canUseMove. */
export function canUseMove(combo: ComboBuff, move: ComboMove): boolean {
  if (move === 'clobber' && combo.clobberUsed) return false;
  if (move === 'parry' && combo.parryUsed) return false;
  return COMBO_REQ[move] <= combo.count;
}

/** Combo.hit: a point more, and the time it keeps (fifteen turns after a kill, fifteen more with each point of cleave). */
export function comboHit(ctx: Ctx, hero: Hero, enemy: Mob): void {
  if (hero.subclass !== 'gladiator') return;
  const b = tbOf(hero);
  const combo = (b.combo ??= { count: 0, time: 0, initialTime: 5 });
  combo.count++;
  if (combo.time <= 5) {
    combo.time = Math.max(combo.time, 5);
    combo.initialTime = 5;
  }
  if (!isAlive(enemy) || (enemy.corrupted && enemy.hp === enemy.ht)) {
    combo.time = 15 + 15 * pointsInTalent(hero, 'cleave');
    combo.initialTime = combo.time;
  }
  if (highestMove(combo) !== null) ctx.effects.push({ type: 'combo', hero: hero.id, count: combo.count });
}

/** Combo.act, a turn's worth: the time runs down (Hold Fast slows it); the combo is lost at nought. */
export function comboTurn(hero: Hero): void {
  const combo = comboOf(hero);
  if (!combo) return;
  combo.time -= holdFastDecay(hero);
  if (combo.time <= 0) delete tbOf(hero).combo;
}

/** Hero.canAttack: next to it, or within the weapon's reach (a staff of disintegration's too). */
export function canStrike(ctx: Ctx, hero: Hero, mob: Mob): boolean {
  if (adjacent(hero.pos, mob.pos)) return true;
  const reach = Math.max(heroReach(hero), staffReach(hero));
  return reach > 1 && canReach(ctx.world, ctx.level, hero, mob.pos, reach);
}

/** The cell the hero leaps to, to strike a target further away (enhanced combo at +3): up to 1 + a third of the combo away. */
function leapFor(ctx: Ctx, hero: Hero, mob: Mob, combo: ComboBuff): number | null {
  if (pointsInTalent(hero, 'enhanced_combo') < 3) return null;
  if (distance(hero.pos, mob.pos) > 1 + Math.trunc(combo.count / 3)) return null;
  if (hero.rooted > 0) return null;
  const bolt = ballistica(ctx, hero.pos, mob.pos, PROJECTILE);
  if (bolt.collisionPos !== mob.pos || bolt.dist < 1) return null;
  const leap = bolt.path[bolt.dist - 1]!;
  return leap !== hero.pos && isPassable(ctx.level, leap) && !charAt(ctx.world, ctx.depth, leap) ? leap : null;
}

/** Why a combo move cannot be made at that target, or null (the listener's bad_target). */
export function comboProblem(ctx: Ctx, hero: Hero, move: ComboMove, targetId: string): string | null {
  const combo = comboOf(hero);
  if (!combo) return 'no combo';
  if (!COMBO_MOVES.includes(move)) return 'bad move';
  if (!canUseMove(combo, move)) return 'that move is not ready';
  if (move === 'parry') return null;
  const mob = ctx.floor.mobs.find((m) => m.id === targetId);
  if (!mob || !isAlive(mob) || mob.state === 'passive') return 'tal:combo.bad_target';
  if (hero.charmed > 0 && hero.charmedBy === mob.id) return 'tal:combo.bad_target';
  if (canStrike(ctx, hero, mob)) return null;
  return leapFor(ctx, hero, mob, combo) === null ? 'tal:combo.bad_target' : null;
}

/** Combo.useMove and doAttack: the move made at a target, sure to hit. Returns the time it took. */
export function useComboMove(ctx: Ctx, hero: Hero, move: ComboMove, targetId: string): number {
  const combo = comboOf(hero)!;
  ctx.effects.push({ type: 'comboMove', hero: hero.id, move });
  if (move === 'parry') {
    combo.parryUsed = true;
    combo.time = Math.max(combo.time, 5);
    dispelInvisibility(ctx, hero);
    // ParryTracker: lasts the turn spent; the next blow in it is dodged and answered.
    tbOf(hero).parry = { parried: false, until: hero.time + 1 };
    return 1;
  }
  const mob = ctx.floor.mobs.find((m) => m.id === targetId)!;
  if (!canStrike(ctx, hero, mob)) {
    const leap = leapFor(ctx, hero, mob, combo)!;
    const from = hero.pos;
    hero.pos = leap;
    leaveCell(ctx.world, ctx.level, ctx.depth, from);
    enterCell(ctx.level, leap);
    ctx.effects.push({ type: 'leapt', depth: ctx.depth, who: hero.id, from, to: leap });
    occupyCell(ctx, hero);
  }
  if (move === 'fury') {
    // Fury hits once for every point of combo, and uses the combo up.
    const hits = combo.count;
    delete tbOf(hero).combo;
    for (let i = 0; i < hits && isAlive(mob) && isAlive(hero); i++) {
      if (i > 0 && !canStrike(ctx, hero, mob)) break;
      comboAttack(ctx, hero, mob, 'fury', hits, null);
    }
    ctx.effects.push({ type: 'comboEnd', hero: hero.id });
  } else {
    comboAttack(ctx, hero, mob, move, combo.count, combo);
  }
  dispelInvisibility(ctx, hero);
  return heroAttackDelay(hero);
}

/** Combo.doAttack: one blow of a move: sure to hit, its damage as the move has it, and what follows. */
function comboAttack(ctx: Ctx, hero: Hero, enemy: Mob, move: ComboMove, count: number, combo: ComboBuff | null): void {
  const wasAlly = !isEnemy(enemy);
  let multiplier = 1;
  let bonus = 0;
  switch (move) {
    case 'clobber': multiplier = 0; break;
    case 'slam': bonus = Math.round(f32(drRoll(ctx, hero) * count / 5)); break;
    case 'crush': multiplier = f32(0.25 * count); break;
    case 'fury': multiplier = 0.6; break;
    default: break;
  }
  const oldPos = enemy.pos;
  const hit = attack(ctx, hero, enemy, { sure: true, damageMultiplier: multiplier, damageBonus: bonus });
  if (hit) {
    if (move === 'clobber') {
      // Knocked back along the line past them: 2 cells (3, with vertigo, and into pits, once the combo is 7 with enhanced combo).
      const line = ballistica(ctx, hero.pos, enemy.pos, PROJECTILE);
      const beyond = ballistica(ctx, line.collisionPos, line.path[line.path.length - 1]!, PROJECTILE);
      let dist = 2;
      if (isAlive(enemy) && count >= 7 && pointsInTalent(hero, 'enhanced_combo') >= 1) {
        dist++;
        enemy.dizzy = Math.max(enemy.dizzy ?? 0, 3);
      } else if (!flies(enemy)) {
        while (dist > beyond.dist || (dist > 0 && hasFlag(ctx.level.map[beyond.path[dist]!]!, F.PIT))) dist--;
      }
      if (!wasAlly && combo) comboHit(ctx, hero, enemy);
      if (enemy.pos === oldPos && isAlive(enemy)) throwChar(ctx, enemy, beyond, dist, true, false);
    } else if (move === 'parry') {
      if (combo) comboHit(ctx, hero, enemy);
    } else if (move === 'crush') {
      crushBlast(ctx, hero, enemy, count);
    }
  }
  if (move === 'clobber') {
    if (combo) combo.clobberUsed = true;
  } else if (move !== 'fury' && move !== 'parry') {
    delete tbOf(hero).combo;
    ctx.effects.push({ type: 'comboEnd', hero: hero.id });
  }
  // Lethal defense: a foe slain (or one that changed sides) shortens the seal's cooldown.
  if (!isAlive(enemy) || (!wasAlly && !isEnemy(enemy))) lethalDefense(hero);
}

/** Crush: half the blow, less their armour, to everyone else within 3 steps (a 7x7 area). */
function crushBlast(ctx: Ctx, hero: Hero, enemy: Mob, count: number): void {
  ctx.effects.push({ type: 'blast', depth: ctx.depth, pos: enemy.pos, radius: 3 });
  for (const mob of [...ctx.floor.mobs]) {
    if (mob === enemy || !isAlive(mob) || !isEnemy(mob) || distance(mob.pos, hero.pos) > 3) continue;
    let hit = Math.trunc(Math.round(f32(heroDamageRoll(hero, ctx.rng) * f32(0.25 * count))) / 2);
    hit -= drRoll(ctx, mob);
    if ((mob.vulnerable ?? 0) > 0) hit = Math.trunc(hit * 1.33);
    if (hit > 0) {
      ctx.effects.push({ type: 'hurt', depth: ctx.depth, who: mob.id, damage: hit });
      hurt(ctx, mob, hit, hero);
    }
    if (!isAlive(mob)) lethalDefense(hero);
  }
}

/** Lethal defense: a foe down reduces the seal's cooldown by a third of its time a point (WarriorShield.reduceCooldown). */
export function lethalDefense(hero: Hero): void {
  const points = pointsInTalent(hero, 'lethal_defense');
  if (points <= 0) return;
  const seal = hero.sealShield;
  if (!seal) return;
  seal.cooldown = Math.max(seal.cooldown - Math.round(150 * (points / 3)), -150);
}

/**
 * Hero.defenseSkill with the parry: while it lasts, a blow at the hero is dodged for sure. (The riposte follows:
 * riposte.) The time is the depth's clock, the parry good until the hero acts again.
 */
export function parries(ctx: Ctx, hero: Hero): boolean {
  const parry = hero.tal?.parry;
  return !!parry && ctx.floor.now < parry.until;
}

/**
 * Hero.defenseVerb and Combo.RiposteTracker: a parried blow is answered at once by a blow of the hero's own at its
 * attacker, if they can strike it; the parry is spent, unless the combo is 9 with enhanced combo +2 (all blows in the turn).
 */
export function riposte(ctx: Ctx, hero: Hero, attacker: Mob): void {
  const combo = comboOf(hero);
  const parry = hero.tal?.parry;
  if (!parry) return;
  parry.parried = true;
  if (!(combo && combo.count >= 9 && pointsInTalent(hero, 'enhanced_combo') >= 2)) {
    // ParryTracker.detach once parried: gone, with the combo kept.
    parry.until = -1;
  }
  if (combo && isAlive(attacker) && isAlive(hero) && canStrike(ctx, hero, attacker) && !(hero.charmed > 0 && hero.charmedBy === attacker.id)) {
    comboAttack(ctx, hero, attacker, 'parry', combo.count, combo);
  }
}

/** The parry runs out with the turn it was made for; if nothing was parried, the combo is lost (ParryTracker.detach). */
export function parryExpires(ctx: Ctx, hero: Hero): void {
  const parry = hero.tal?.parry;
  if (!parry || (parry.until >= 0 && ctx.floor.now < parry.until)) return;
  if (!parry.parried) delete hero.tal!.combo;
  delete hero.tal!.parry;
}
