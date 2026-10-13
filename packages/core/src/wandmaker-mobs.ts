import { type Hero, heroStealth, isAlive, type Mob } from './actors';
import { ballistica } from './ai';
import { attack, hurt, mobDied } from './combat';
import { type Char, type Ctx, heroesOn, isHero, landItem, leaveCell } from './floor';
import { createItem } from './items';
import { addQuestScore } from './quest';
import { seedGas } from './gas';
import { seedFire } from './trap-effects';
import { adjacent, distance, LENGTH, WIDTH } from './level/geometry';
import { F, hasFlag } from './level/terrain';

/*
 * The monsters of the old wandmaker's errands (wandmaker.ts): the rot heart (RotHeart) at the middle
 * of the rot garden, which only lets out toxic gas when struck, and its rot lashers (RotLasher), rooted
 * and all but blind, lashing out at whoever stands beside them; both burn away at a touch of fire.
 * And the newborn fire elemental of the ritual site (Elemental.NewbornFireElemental), which charges
 * up blasts of fire at the cells around its foe. They act through ai.ts and combat.ts's hooks below.
 */

/** PathFinder.NEIGHBOURS8 and NEIGHBOURS9 in Shattered's order (candidates are picked from lists in it). */
export const JAVA_N8: readonly number[] = [-WIDTH - 1, -WIDTH, -WIDTH + 1, -1, +1, +WIDTH - 1, +WIDTH, +WIDTH + 1];
const JAVA_N9: readonly number[] = [-WIDTH - 1, -WIDTH, -WIDTH + 1, -1, 0, +1, +WIDTH - 1, +WIDTH, +WIDTH + 1];

const TICK = 1;

/** Actor.spend: slowed, everything takes twice as long. */
function spend(mob: Mob, time: number): void {
  mob.time += (mob.slowed ?? 0) > 0 ? time * 2 : time;
}

/**
 * Mob.act for the quest's monsters, after their conditions (ai.ts): the rot heart and its lashers
 * act wholly here; a newborn elemental only when a charged blast goes off (true when it acted).
 */
export function wandmakerMobAct(ctx: Ctx, mob: Mob): boolean {
  switch (mob.kind) {
    case 'rotHeart':
      // RotHeart.act: never alerted; Mob.Passive: it sees no one, and waits.
      mob.alerted = false;
      mob.enemySeen = false;
      spend(mob, TICK);
      return true;
    case 'rotLasher':
      lasherAct(ctx, mob);
      return true;
    case 'newbornElemental':
      return newbornAct(ctx, mob);
    default:
      return false;
  }
}

/* RotLasher */

/** Heroes a monster can make out (the invisible cannot be). */
const visibleHeroes = (ctx: Ctx): Hero[] => heroesOn(ctx.world, ctx.depth).filter((hero) => hero.invisible <= 0);

/**
 * RotLasher.act: hurt and with its enemy not beside it, it mends five points; then, seeing no further
 * than a cell (viewDistance 1), it waits (Waiting: noticing someone takes it a turn), lashes out at
 * whoever is beside it, and goes back to waiting once they step away. It never moves.
 */
function lasherAct(ctx: Ctx, mob: Mob): void {
  const heroes = visibleHeroes(ctx);
  let enemy = heroes.find((hero) => hero.id === mob.enemy);
  if (mob.hp < mob.ht && (!enemy || !adjacent(mob.pos, enemy.pos))) {
    const amount = Math.min(5, mob.ht - mob.hp);
    mob.hp += amount;
    ctx.effects.push({ type: 'lasherMends', depth: ctx.depth, mob: mob.id, amount });
  }
  // Mob.chooseEnemy within its sight of one cell (blinded, none).
  const inSight = (mob.blind ?? 0) > 0 ? [] : heroes.filter((hero) => adjacent(hero.pos, mob.pos));
  if (!enemy || !inSight.includes(enemy)) enemy = inSight[0] ?? enemy;
  mob.enemy = enemy?.id ?? null;
  const enemyInFov = enemy !== undefined && inSight.includes(enemy);
  const justAlerted = mob.alerted;
  mob.alerted = false;

  switch (mob.state) {
    case 'sleeping':
      // Mob.Sleeping: Random.Float(distance + stealth) < 1.
      if (enemyInFov && ctx.rng.floatMax(distance(mob.pos, enemy!.pos) + heroStealth(enemy!)) < 1) {
        notice(ctx, mob, enemy!);
      } else {
        mob.enemySeen = false;
      }
      spend(mob, TICK);
      return;
    case 'hunting':
      mob.enemySeen = enemyInFov;
      if (enemyInFov) {
        attack(ctx, mob, enemy!);
        spend(mob, TICK);
        return;
      }
      // It cannot get closer: back to waiting.
      spend(mob, TICK);
      mob.state = 'wandering';
      return;
    default:
      // RotLasher.Waiting (Mob.Wandering): Random.Float(distance / 2 + stealth) < 1 to notice; it takes a turn.
      if (enemyInFov && (justAlerted || ctx.rng.floatMax(distance(mob.pos, enemy!.pos) / 2 + heroStealth(enemy!)) < 1)) {
        notice(ctx, mob, enemy!);
      } else {
        mob.enemySeen = false;
      }
      spend(mob, TICK);
  }
}

function notice(ctx: Ctx, mob: Mob, enemy: Hero): void {
  mob.enemySeen = true;
  mob.state = 'hunting';
  mob.target = enemy.pos;
  ctx.effects.push({ type: 'noticed', depth: ctx.depth, mob: mob.id });
}

/**
 * Char.attack, as a monster goes for a hero: RotLasher.attack costs the quest 100 points every time;
 * a dust wraith's second and third attempts cost 100 each (the first is free).
 */
export function wandmakerAttack(ctx: Ctx, attacker: Mob, defender: Char): void {
  if (!isHero(defender)) return;
  if (attacker.kind === 'rotLasher') addQuestScore(ctx.world, 1, -100);
  if (attacker.dust !== undefined) {
    attacker.dust++;
    if (attacker.dust === 2 || attacker.dust === 3) addQuestScore(ctx.world, 1, -100);
  }
}

/** RotLasher.attackProc: its lash cripples for two turns more (Buff.affect(Cripple, 2) adds up). */
export function lasherCripples(ctx: Ctx, defender: Char): void {
  if (isHero(defender) && defender.crippled <= 0) ctx.effects.push({ type: 'crippled', hero: defender.id });
  defender.crippled = (defender.crippled ?? 0) + 2;
}

/* RotHeart */

/** RotHeart.defenseProc: struck, it lets out toxic gas, less in a cramped spot (5, and 3 for every open cell about it). */
export function rotHeartStruck(ctx: Ctx, heart: Mob): void {
  let openNearby = 0;
  for (const n of JAVA_N8) if (!hasFlag(ctx.level.map[heart.pos + n]!, F.SOLID)) openNearby++;
  seedGas(ctx, heart.pos, 'toxic', 5 + 3 * openNearby);
}

/** RotHeart.destroy: its lashers die with it. */
function lashersDie(ctx: Ctx): void {
  for (const lasher of ctx.floor.mobs.filter((m) => m.kind === 'rotLasher')) mobDied(ctx, lasher);
}

/**
 * RotHeart.damage and RotLasher.damage: burning, they are simply gone (destroy, no death of theirs:
 * no seed, no score), and the heart takes its lashers with it. True if so.
 */
export function burnsAway(ctx: Ctx, mob: Mob): boolean {
  if (mob.kind !== 'rotHeart' && mob.kind !== 'rotLasher') return false;
  mob.hp = 0;
  ctx.floor.mobs.splice(ctx.floor.mobs.indexOf(mob), 1);
  leaveCell(ctx.world, ctx.level, ctx.depth, mob.pos);
  ctx.effects.push({ type: 'died', depth: ctx.depth, who: mob.id, pos: mob.pos, kind: mob.kind });
  if (mob.kind === 'rotHeart') lashersDie(ctx);
  return true;
}

/**
 * Mob.die for the quest's monsters, after their loot: the rot heart takes its lashers with it and leaves
 * the rotberry seed (2000 points to the quest, as the hero may keep the seed); the newborn elemental
 * leaves its embers (2000 points too).
 */
export function wandmakerMobDied(ctx: Ctx, mob: Mob): void {
  if (mob.kind === 'rotHeart') {
    lashersDie(ctx);
    landItem(ctx, mob.pos, createItem('seed.rotberry'));
    addQuestScore(ctx.world, 1, 2000);
  }
  if (mob.kind === 'newbornElemental') {
    landItem(ctx, mob.pos, createItem('quest.embers'));
    addQuestScore(ctx.world, 1, 2000);
  }
}

/* Elemental.NewbornFireElemental */

/** Ballistica(from, to, STOP_SOLID | STOP_TARGET).collisionPos === to: a clear line, over anyone in the way. */
const reaches = (ctx: Ctx, from: number, to: number): boolean => ballistica(ctx, from, to, false).at(-1) === to;

/**
 * NewbornFireElemental.act, then Elemental.act: a blast charged up goes off now, instead of anything
 * else, at its target (or where a wall stops it short); otherwise, hunting, the ranged cooldown runs
 * down, and not hunting, any charge is lost. True if the blast went off.
 */
function newbornAct(ctx: Ctx, mob: Mob): boolean {
  const targeting = mob.targetingPos ?? -1;
  if (targeting !== -1 && mob.state === 'hunting') {
    mob.targetingPos = ballistica(ctx, mob.pos, targeting, false).at(-1)!;
    zap(ctx, mob);
    return true;
  }
  if (mob.state !== 'hunting') mob.targetingPos = -1;
  else mob.rangedCooldown = (mob.rangedCooldown ?? 0) - 1;
  return false;
}

/** NewbornFireElemental.canAttack: beside it, or, its cooldown run out, along a clear line. */
export function newbornCanAttack(ctx: Ctx, mob: Mob, enemy: Hero): boolean {
  return adjacent(mob.pos, enemy.pos) || ((mob.rangedCooldown ?? 0) < 0 && reaches(ctx, mob.pos, enemy.pos));
}

/**
 * NewbornFireElemental.doAttack: on cooldown, a blow (no fire in it, Elemental.meleeProc); with a
 * clear line, it charges a blast at one of the cells around its foe it can reach, taking as long as
 * the hero has before acting (one to three turns: «The elemental is charging up!»); with none of them
 * in reach, a blow, and a turn's cooldown.
 */
export function newbornDoAttack(ctx: Ctx, mob: Mob, enemy: Hero): void {
  if ((mob.rangedCooldown ?? 0) > 0) {
    melee(ctx, mob, enemy);
    return;
  }
  if (reaches(ctx, mob.pos, enemy.pos)) {
    const candidates = JAVA_N8.map((n) => enemy.pos + n).filter((target) => target !== mob.pos && reaches(ctx, mob.pos, target));
    if (candidates.length > 0) {
      const targeting = ctx.rng.element(candidates)!;
      mob.targetingPos = targeting;
      // GameMath.gate(attackDelay, ceil(hero.cooldown()), 3 x attackDelay).
      const delay = Math.min(3, Math.max(1, Math.ceil(enemy.time - ctx.floor.now)));
      const cells = JAVA_N9.map((n) => targeting + n).filter((cell) => cell >= 0 && cell < LENGTH && !hasFlag(ctx.level.map[cell]!, F.SOLID));
      ctx.effects.push({ type: 'elementalCharge', depth: ctx.depth, mob: mob.id, cells });
      spend(mob, delay);
      // Hero.interrupt.
      ctx.effects.push({ type: 'interrupted', hero: enemy.id, reason: 'charging' });
      return;
    }
    mob.rangedCooldown = 1;
    melee(ctx, mob, enemy);
    return;
  }
  // No line after all: nothing to fire, only a new cooldown (Shattered's spends no time here; a turn does).
  zap(ctx, mob);
  spend(mob, TICK);
}

function melee(ctx: Ctx, mob: Mob, enemy: Hero): void {
  attack(ctx, mob, enemy);
  spend(mob, TICK);
}

/**
 * NewbornFireElemental.zap: the blast bursts over the cell aimed at and those round it (Fire; those
 * caught burn, the hero costing the quest 200 points); then a new cooldown of 3 to 5 turns.
 */
function zap(ctx: Ctx, mob: Mob): void {
  const targeting = mob.targetingPos ?? -1;
  if (targeting !== -1) {
    spend(mob, 1);
    const cells = JAVA_N9.map((n) => targeting + n).filter((cell) => cell >= 0 && cell < LENGTH && !hasFlag(ctx.level.map[cell]!, F.SOLID));
    ctx.effects.push({ type: 'elementalBlast', depth: ctx.depth, mob: mob.id, from: mob.pos, to: targeting, cells });
    for (const hero of heroesOn(ctx.world, ctx.depth)) if (cells.includes(hero.pos)) addQuestScore(ctx.world, 1, -200);
    // Blob.seed(cell, 8 or, in water, 2, Fire), and Burning.reignite for whoever is there.
    seedFire(ctx, cells);
  }
  mob.targetingPos = -1;
  mob.rangedCooldown = ctx.rng.normalIntRange(3, 5);
}

/**
 * Elemental.add: Frost and Chill do not take hold of a fire elemental; they hurt it badly instead (half
 * to three fifths of its health). True if it was so (and it is not to be frozen).
 */
export function frostHurtsElemental(ctx: Ctx, ch: Char): boolean {
  if (isHero(ch) || ch.kind !== 'newbornElemental' || !isAlive(ch)) return false;
  const damage = ctx.rng.normalIntRange(Math.trunc(ch.ht / 2), Math.trunc((ch.ht * 3) / 5));
  ctx.effects.push({ type: 'hurt', depth: ctx.depth, who: ch.id, damage });
  hurt(ctx, ch, damage, 'frost');
  return true;
}
