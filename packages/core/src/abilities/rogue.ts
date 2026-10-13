import { createMob, type Hero, isAlive, type Mob } from '../actors';
import { dispelInvisibility } from '../artifacts';
import { buffsOf } from '../buffs';
import { finishOff } from '../combat';
import { charAt, type Ctx, heroView } from '../floor';
import { shieldUp } from '../status';
import { adjacent, LENGTH, NEIGHBOURS8, WIDTH } from '../level/geometry';
import { F, hasFlag } from '../level/terrain';
import { pointsInTalent } from '../talents';
import { isImmune } from '../props';
import { occupyCell } from '../wands';
import { isFoe, prolong, relocate, stateOf } from './common';

/*
 * The rogue's armour abilities: SmokeBomb, DeathMark and (in allies.ts) ShadowClone.
 */

/* Smoke bomb */

/** SmokeBomb.chargeUse: cheaper while the rogue is unseen with Shadow Step (16%, 30%, 41%, 50% off). */
export function smokeCharge(hero: Hero, base: number): number {
  if (pointsInTalent(hero, 'shadowStep') <= 0 || hero.invisible <= 0) return base;
  return base * 0.84 ** pointsInTalent(hero, 'shadowStep');
}

/** Cells within six steps of walkable ground (PathFinder.buildDistanceMap(hero.pos, passable | avoid, 6)). */
function withinSix(ctx: Ctx, from: number): Set<number> {
  const seen = new Map<number, number>([[from, 0]]);
  const queue = [from];
  for (let head = 0; head < queue.length; head++) {
    const cell = queue[head]!;
    const d = seen.get(cell)!;
    if (d >= 6) continue;
    for (const n of NEIGHBOURS8) {
      const next = cell + n;
      if (next < 0 || next >= LENGTH || seen.has(next) || Math.abs((next % WIDTH) - (cell % WIDTH)) > 1) continue;
      const terrain = ctx.level.map[next]!;
      if (!hasFlag(terrain, F.PASSABLE) && !hasFlag(terrain, F.AVOID)) continue;
      seen.set(next, d + 1);
      queue.push(next);
    }
  }
  return new Set(seen.keys());
}

/** Why the rogue cannot blink there (SmokeBomb.activate): not in sight, not within six steps, or someone stands there. */
export function smokeBombProblem(ctx: Ctx, hero: Hero, target: number | undefined): string | null {
  if (target === undefined || !Number.isInteger(target) || target < 0 || target >= LENGTH) return 'art:actors.hero.abilities.rogue.smokebomb.prompt';
  if (target !== hero.pos && hero.rooted > 0) return 'you are rooted';
  if (!withinSix(ctx, hero.pos).has(target) || !heroView(ctx.world, hero)[target] || (target !== hero.pos && charAt(ctx.world, ctx.depth, target))) {
    return 'art:actors.hero.abilities.rogue.smokebomb.fov';
  }
  return null;
}

/** The ninja log of the hero's, if one stands. */
export const ninjaLogOf = (ctx: Ctx): Mob | undefined => ctx.floor.mobs.find((mob) => mob.kind === 'ninjaLog' && isAlive(mob));

/** SmokeBomb.NinjaLog: the decoy that takes the place the rogue left (20 health a point of Body Replacement). */
function leaveLog(ctx: Ctx, hero: Hero, pos: number): void {
  const old = ninjaLogOf(ctx);
  if (old) finishOff(ctx, old);
  const points = pointsInTalent(hero, 'bodyReplacement');
  const log = createMob(`#${++ctx.world.nextId}`, 'ninjaLog', pos, 'passive', ctx.floor.now + 1);
  log.ally = true;
  log.owner = hero.id;
  log.ht = log.hp = 20 * points;
  log.ninja = { points };
  ctx.floor.mobs.push(log);
}

/**
 * SmokeBomb.activate: the rogue throws down a smoke bomb and blinks away (up to six cells, over anything but walls).
 * Those beside the old place are blinded for five turns and lose track of the rogue; Body Replacement leaves a wooden
 * decoy there, Hasty Retreat gives a few moments of haste and invisibility. Unseen already, Shadow Step costs less and
 * takes no time.
 */
export function smokeBomb(ctx: Ctx, hero: Hero, target: number): number {
  const { depth } = ctx;
  const stepping = hero.invisible > 0 && pointsInTalent(hero, 'shadowStep') > 0;
  const from = hero.pos;
  const blinded: number[] = [];
  if (!stepping) {
    for (const mob of ctx.floor.mobs) {
      if (!adjacent(mob.pos, hero.pos) || mob.ally || !isAlive(mob)) continue;
      if (!isImmune(mob, 'blindness')) prolong(mob, 'blind', 5);
      if (mob.state === 'hunting') mob.state = 'wandering';
      blinded.push(mob.pos);
    }
    if (pointsInTalent(hero, 'bodyReplacement') > 0) leaveLog(ctx, hero, hero.pos);
    const retreat = pointsInTalent(hero, 'hastyRetreat');
    if (retreat > 0) {
      // Effectively 1, 2, 3 and 4 turns.
      const duration = 0.67 + retreat;
      const buffs = buffsOf(hero);
      buffs.haste = (buffs.haste ?? 0) + duration;
      hero.invisible += duration;
    }
  }
  ctx.effects.push({ type: 'ability', depth, hero: hero.id, ability: 'smokeBomb', from, to: target, cells: blinded });
  if (target !== hero.pos) relocate(ctx, hero, target);
  hero.rooted = 0;
  occupyCell(ctx, hero);
  return stepping ? 0 : 1;
}

/* Death mark */

/** DeathMarkTracker.DURATION. */
export const MARK_TURNS = 5;

/** DeathMark.chargeUse: a second mark in a row costs less with Double Mark (30%, 50%, 65%, 75% off). */
export function markCharge(hero: Hero, base: number): number {
  if (hero.abil?.doubleMark === undefined || hero.abil.doubleMark !== hero.time) return base;
  return base * 0.707 ** pointsInTalent(hero, 'doubleMark');
}

export function deathMarkProblem(ctx: Ctx, hero: Hero, target: number | undefined): string | null {
  if (target === undefined || !Number.isInteger(target) || target < 0 || target >= LENGTH) return 'art:actors.hero.abilities.armorability.prompt';
  const ch = charAt(ctx.world, ctx.depth, target);
  if (!ch || !isAlive(ch) || !heroView(ctx.world, hero)[target]) return 'art:actors.hero.abilities.armorability.no_target';
  if (!isFoe(ch as Mob) || ch === hero) return 'art:actors.hero.abilities.rogue.deathmark.ally_target';
  return null;
}

/** DeathMark.activate: a mark that lasts five turns more on the enemy; marked, it cannot die until the mark ends. */
export function deathMark(ctx: Ctx, hero: Hero, target: number): number {
  const mob = charAt(ctx.world, ctx.depth, target) as Mob;
  const now = ctx.floor.now;
  const mark = mob.deathMark;
  const until = (mark ? Math.max(mark.until, now) : now) + MARK_TURNS;
  mob.deathMark = { until, hp: Math.max(mark?.hp ?? 0, mob.hp) };
  ctx.effects.push({ type: 'ability', depth: ctx.depth, hero: hero.id, ability: 'deathMark', from: hero.pos, to: target });
  ctx.effects.push({ type: 'deathMarked', depth: ctx.depth, mob: mob.id, on: true });
  const state = stateOf(hero);
  if (state.doubleMark !== undefined && state.doubleMark === hero.time) delete state.doubleMark;
  else if (pointsInTalent(hero, 'doubleMark') > 0) state.doubleMark = hero.time;
  return 0;
}

/**
 * DeathMark.processFearTheReaper: a marked enemy brought to no health is crippled for five turns (and terrified from
 * two points, and all within three cells of it crippled from three, terrified from four).
 */
export function fearTheReaper(ctx: Ctx, mob: Mob): void {
  if (mob.hp > 0 || !mob.deathMark) return;
  const hero = ctx.world.heroes.find((h) => h.depth === ctx.depth && isAlive(h));
  if (!hero) return;
  const points = pointsInTalent(hero, 'fearTheReaper');
  if (points <= 0) return;
  if (points >= 2 && !isImmune(mob, 'terror')) {
    prolong(mob, 'terror', 5);
    mob.terrorOf = hero.id;
  }
  if (!isImmune(mob, 'slow')) prolong(mob, 'crippled', 5);
  if (points >= 3) {
    for (const near of ctx.floor.mobs) {
      if (near === mob || !isFoe(near) || !reachable(ctx, mob.pos, near.pos, 3)) continue;
      if (points === 4 && !isImmune(near, 'terror')) {
        prolong(near, 'terror', 5);
        near.terrorOf = hero.id;
      }
      prolong(near, 'crippled', 5);
    }
  }
}

/** Within `steps` of a cell over ground that is not solid (PathFinder.buildDistanceMap(pos, !solid, 3)). */
function reachable(ctx: Ctx, from: number, to: number, steps: number): boolean {
  const seen = new Map<number, number>([[from, 0]]);
  const queue = [from];
  for (let head = 0; head < queue.length; head++) {
    const cell = queue[head]!;
    if (cell === to) return true;
    const d = seen.get(cell)!;
    if (d >= steps) continue;
    for (const n of NEIGHBOURS8) {
      const next = cell + n;
      if (next < 0 || next >= LENGTH || seen.has(next) || Math.abs((next % WIDTH) - (cell % WIDTH)) > 1) continue;
      if (hasFlag(ctx.level.map[next]!, F.SOLID)) continue;
      seen.set(next, d + 1);
      queue.push(next);
    }
  }
  return false;
}

/**
 * DeathMarkTracker.detach / detachOnDeath: the mark ends, and if the enemy has no health left it dies on the spot,
 * with the rogue gaining a shield (an eighth of its health when marked, for each point of Deathly Durability).
 */
export function endDeathMark(ctx: Ctx, mob: Mob, forced = false): void {
  const mark = mob.deathMark;
  if (!mark) return;
  delete mob.deathMark;
  if (mob.hp > 0) {
    ctx.effects.push({ type: 'deathMarked', depth: ctx.depth, mob: mob.id, on: false });
    return;
  }
  ctx.effects.push({ type: 'deathMarked', depth: ctx.depth, mob: mob.id, on: false, died: true });
  const hero = ctx.world.heroes.find((h) => h.depth === ctx.depth && isAlive(h));
  if (hero && !mob.ally) {
    const shield = Math.round(mark.hp * (0.125 * pointsInTalent(hero, 'deathlyDurability')));
    if (shield > 0) {
      shieldUp(hero, shield);
      ctx.effects.push({ type: 'barrier', depth: ctx.depth, who: hero.id, amount: shield });
    }
  }
  if (!forced) finishOff(ctx, mob, hero?.id);
}

/** A marked monster's turn: the mark runs out when its time has come (it dies then, if it has no health). */
export function deathMarkTurn(ctx: Ctx, mob: Mob): boolean {
  if (!mob.deathMark || ctx.floor.now < mob.deathMark.until) return false;
  endDeathMark(ctx, mob);
  return !isAlive(mob);
}

export { dispelInvisibility };
