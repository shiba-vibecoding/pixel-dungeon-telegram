import { createMob, type Hero, heroAttackDelay, heroDamageRoll, isAlive, type Mob, MOBS } from '../actors';
import { getCloser, sightBlockers, spend } from '../ai';
import { armorTier } from '../armor';
import { attack, drRoll, hurt, finishOff } from '../combat';
import { castShadow, terrainBlocksSight, viewDistance } from '../fov';
import { weaponProc } from '../enchant';
import { canEnter, type Char, charAt, type Ctx, enterCell, heroView, isHero, leaveCell } from '../floor';
import { isMagicImmune } from '../buffs';
import { isImmune, hasProp } from '../props';
import { adjacent, distance, LENGTH, NEIGHBOURS8, NEIGHBOURS9 } from '../level/geometry';
import { F, hasFlag } from '../level/terrain';
import { dispelInvisibility } from '../artifacts';
import { Rng } from '../rng';
import { pointsInTalent } from '../talents';
import { throwChar } from '../wands';
import type { World } from '../world';
import { isFoe, openSpace, prolong, trueDistance } from './common';

/*
 * The armour abilities' allies: the rogue's shadow clone and the huntress's spirit hawk (DirectableAlly: they follow
 * the hero from depth to depth, can be sent to hold a place or after a foe), and the decoy the smoke bomb leaves.
 */

/** SpiritHawk.HawkAlly.timeRemaining. */
export const HAWK_TURNS = 100;

type Direct = NonNullable<Mob['directed']>;

/** The hero's shadow clone or spirit hawk, on the depth. */
export const allyOf = (ctx: Ctx, kind: 'shadow' | 'hawk'): Mob | undefined =>
  ctx.floor.mobs.find((mob) => mob.kind === kind && isAlive(mob));

/** The hero whose ally this is. */
const ownerOf = (world: World, ally: Mob): Hero | undefined => world.heroes.find((hero) => hero.id === ally.directed?.owner);

/* Summoning */

/** The cells beside the hero where an ally may appear: free, and passable (a hawk flies, so it may take cells to be avoided too). */
function spawnCells(ctx: Ctx, hero: Hero, flies: boolean): number[] {
  return NEIGHBOURS8.map((n) => hero.pos + n).filter((cell) => {
    if (cell < 0 || cell >= LENGTH || charAt(ctx.world, ctx.depth, cell)) return false;
    const terrain = ctx.level.map[cell]!;
    return hasFlag(terrain, F.PASSABLE) || (flies && hasFlag(terrain, F.AVOID));
  });
}

export const canSummon = (ctx: Ctx, hero: Hero, kind: 'shadow' | 'hawk'): boolean => spawnCells(ctx, hero, kind === 'hawk').length > 0;

/** ShadowClone.ShadowAlly(heroLevel): 80 health, with Perfect Copy a tenth of 15 + 5 a level more a point; the hero's own skill and evasion. */
export function summonShadow(ctx: Ctx, hero: Hero): Mob {
  const pos = ctx.rng.element(spawnCells(ctx, hero, false))!;
  const ally = createMob(`#${++ctx.world.nextId}`, 'shadow', pos, 'wandering', ctx.floor.now + 1);
  const bonus = Math.round(0.1 * pointsInTalent(hero, 'perfectCopy') * (15 + 5 * hero.lvl));
  ally.ht = ally.hp = 80 + (bonus > 0 ? bonus : 0);
  ally.shadow = { defense: hero.lvl + 4 };
  ally.ally = true;
  ally.directed = { owner: hero.id, defend: -1, moving: false };
  ctx.floor.mobs.push(ally);
  enterCell(ctx.level, pos);
  ctx.effects.push({ type: 'ability', depth: ctx.depth, hero: hero.id, ability: 'shadowClone', from: hero.pos, to: pos, mob: ally.id });
  dispelInvisibility(ctx, hero);
  return ally;
}

/** SpiritHawk.activate: a hawk beside the hero. */
export function summonHawk(ctx: Ctx, hero: Hero): Mob {
  const pos = ctx.rng.element(spawnCells(ctx, hero, true))!;
  const ally = createMob(`#${++ctx.world.nextId}`, 'hawk', pos, 'wandering', ctx.floor.now + 1);
  ally.hawk = { remaining: HAWK_TURNS, dodges: 0 };
  ally.ally = true;
  ally.directed = { owner: hero.id, defend: -1, moving: false };
  ctx.floor.mobs.push(ally);
  enterCell(ctx.level, pos);
  ctx.effects.push({ type: 'ability', depth: ctx.depth, hero: hero.id, ability: 'spiritHawk', from: hero.pos, to: pos, mob: ally.id });
  dispelInvisibility(ctx, hero);
  return ally;
}

/** A line the ally says by its message key. */
const say = (ctx: Ctx, hero: Hero, key: string): void => {
  ctx.effects.push({ type: 'artifact', hero: hero.id, msg: key, tone: 'i' });
};

const ALLY_KEYS = {
  shadow: 'actors.hero.abilities.rogue.shadowclone$shadowally',
  hawk: 'actors.hero.abilities.huntress.spirithawk$hawkally',
} as const;

/**
 * DirectableAlly.directTocell: hold a place, follow the hero, or go after a foe in the hero's sight (the hero's own cell
 * to follow; a cell out of sight or empty, or an ally's, to hold).
 */
export function directAlly(ctx: Ctx, hero: Hero, ally: Mob, cell: number): void {
  const direct = ally.directed!;
  const fov = heroView(ctx.world, hero);
  const there = cell >= 0 && cell < LENGTH ? charAt(ctx.world, ctx.depth, cell) : undefined;
  const keys = ALLY_KEYS[ally.kind as 'shadow' | 'hawk'];
  if (there === hero) {
    // followHero.
    direct.defend = -1;
    direct.moving = false;
    ally.enemy = null;
    ally.state = 'wandering';
    say(ctx, hero, `${keys}.direct_follow`);
  } else if (fov[cell] && there && !isHero(there) && isFoe(there)) {
    // targetChar.
    direct.defend = -1;
    direct.moving = false;
    ally.enemy = there.id;
    if (ally.state !== 'passive') ally.state = 'hunting';
    ally.target = there.pos;
    say(ctx, hero, `${keys}.direct_attack`);
  } else {
    // defendPos.
    direct.defend = cell;
    direct.moving = true;
    ally.enemy = null;
    ally.state = 'wandering';
    say(ctx, hero, `${keys}.direct_defend`);
  }
}

/* Their ways */

/** SpiritHawk.HawkAlly: how far it sees (6, and a cell more a point of Eagle Eye) and how fast it flies (2, and half a point of Swift Spirit). */
export const hawkSight = (hero: Hero): number => Math.min(8, 6 + pointsInTalent(hero, 'eagleEye'));
export const hawkSpeed = (hero: Hero): number => 2 + pointsInTalent(hero, 'swiftSpirit') / 2;

/** Mob.chooseEnemy for an intelligent ally's foes. */
const hostile = (mob: Mob): boolean => isFoe(mob) && mob.kind !== 'sheep' && mob.kind !== 'lotus';

/** DirectableAlly.speed: a clone returning to the hero (no place to hold) moves twice as fast. */
function allySpeed(ally: Mob, hero: Hero | undefined, depth: number): number {
  if (ally.kind === 'hawk') return hero ? hawkSpeed(hero) : 2;
  const direct = ally.directed!;
  return ally.state === 'wandering' && direct.defend === -1 && hero && hero.depth === depth && distance(ally.pos, hero.pos) > 1 ? 2 : 1;
}

/**
 * DirectableAlly's turn (Wandering and Hunting): wandering, it keeps by the hero or goes to the place it holds, and turns
 * on a foe in sight if it attacks of itself (the clone does, the hawk only when sent); hunting, it goes for its foe, and
 * strikes when it can, falling back to the place it holds when the foe is out of reach of it.
 */
export function directableAct(ctx: Ctx, ally: Mob): void {
  const { world, depth } = ctx;
  const direct = ally.directed as Direct;
  const hero = ownerOf(world, ally);
  const hawk = ally.kind === 'hawk';
  if (hawk) {
    // HawkAlly.act: its time runs out; its sight and speed follow the talents.
    if (ally.hawk!.remaining <= 0) {
      finishOff(ctx, ally);
      return;
    }
  }
  const sight = hawk && hero ? hawkSight(hero) : viewDistance(depth);
  const fov = castShadow(ally.pos, sightBlockers(ctx), sight);
  const heroFov = hero && hero.depth === depth ? heroView(world, hero) : new Array<boolean>(LENGTH).fill(false);
  const tick = (time: number): void => {
    spend(ally, time);
    if (hawk) ally.hawk!.remaining -= time;
  };
  // Mob.chooseEnemy for an intelligent ally: its foe while it lives; else the nearest awake foe in sight.
  let enemy = ctx.floor.mobs.find((mob) => mob.id === ally.enemy && hostile(mob));
  if (!enemy || ally.state === 'wandering') {
    const foes = ctx.floor.mobs.filter((mob) => hostile(mob) && fov[mob.pos] && mob.state !== 'sleeping' && mob.state !== 'wandering');
    enemy = foes.sort((a, b) => distance(ally.pos, a.pos) - distance(ally.pos, b.pos))[0] ?? (ally.state === 'hunting' ? enemy : undefined);
    if (direct.moving) enemy = undefined;
    ally.enemy = enemy?.id ?? null;
  }
  const enemyInFov = enemy !== undefined && fov[enemy.pos]!;
  const canAttack = (foe: Mob): boolean => adjacent(ally.pos, foe.pos);
  const speed = hawk ? (hero ? hawkSpeed(hero) : 2) : allySpeed(ally, hero, depth);

  if (ally.state !== 'hunting') {
    // DirectableAlly.Wandering.
    const automatic = !hawk;
    if (enemy && enemyInFov && automatic && !direct.moving && (direct.defend === -1 || !heroFov[direct.defend] || canAttack(enemy))) {
      ally.enemySeen = true;
      ally.state = 'hunting';
      ally.target = enemy.pos;
    } else {
      ally.enemySeen = false;
      const target = direct.defend !== -1 ? direct.defend : hero && hero.depth === depth ? hero.pos : ally.pos;
      if (target !== ally.pos && !(target === hero?.pos && adjacent(ally.pos, target)) && getCloser(ctx, ally, target, fov)) {
        tick(1 / speed);
        if (ally.pos === direct.defend) direct.moving = false;
      } else {
        // Unable to get closer to the place it was sent to: it holds where it is.
        if (direct.moving) {
          direct.defend = ally.pos;
          direct.moving = false;
        }
        tick(1);
      }
      return;
    }
  }
  // DirectableAlly.Hunting and Mob.Hunting.
  if (enemy && enemyInFov && direct.defend !== -1 && heroFov[direct.defend] && !canAttack(enemy)) {
    ally.target = direct.defend;
    ally.state = 'wandering';
    tick(1);
    return;
  }
  ally.enemySeen = enemyInFov;
  if (enemy && enemyInFov && canAttack(enemy)) {
    allyStrike(ctx, ally, enemy, hero);
    if (hawk) ally.hawk!.remaining -= 1;
    return;
  }
  if (enemy && enemyInFov) ally.target = enemy.pos;
  else if (!enemy) {
    ally.state = 'wandering';
    tick(1);
    return;
  }
  if (ally.target !== -1 && getCloser(ctx, ally, ally.target, fov)) {
    tick(1 / speed);
  } else {
    tick(1);
    if (!enemyInFov) ally.state = 'wandering';
  }
}

/** The ally's blow: the clone's with the hero's weapon, a hawk's talons; the foe turns on it. */
function allyStrike(ctx: Ctx, ally: Mob, foe: Mob, hero: Hero | undefined): void {
  let damage: number;
  if (ally.kind === 'shadow') {
    // ShadowAlly.damageRoll: 10 to 20, and 8% a point of Shadow Blade of the hero's own blow (at a normal rate of attack).
    damage = ctx.rng.normalIntRange(10, 20);
    if (hero) {
      const points = pointsInTalent(hero, 'shadowBlade');
      const heroDamage = Math.round((0.08 * points * heroDamageRoll(hero, ctx.rng)) / heroAttackDelay(hero));
      if (heroDamage > 0) damage += heroDamage;
      // ShadowAlly.attackProc: the hero's weapon works its enchantment, a point in four of the time per point.
      if (hero.weapon && ctx.rng.int(4) < points && !isMagicImmune(hero)) damage = weaponProc(ctx, hero, foe, damage, hero.weapon, {});
    }
  } else {
    damage = ctx.rng.normalIntRange(5, 10);
  }
  attack(ctx, ally, foe, { damage: [Math.max(0, damage), Math.max(0, damage)] });
  // Mob.aggro: the foe turns on whoever struck it.
  if (isAlive(foe) && foe.state !== 'passive') {
    foe.enemy = ally.id;
    if (foe.state === 'sleeping') foe.state = 'hunting';
  }
  spend(ally, 1);
}

/** HawkAlly.attackProc: its talons blind (2 turns, then 5), then cripple (2, then 5) with Go For The Eyes. */
export function hawkProc(ctx: Ctx, hero: Hero | undefined, foe: Char): void {
  if (!hero || isHero(foe)) return;
  const eyes = pointsInTalent(hero, 'goForTheEyes');
  if (eyes <= 0) return;
  if (!isImmune(foe, 'blindness')) prolong(foe, 'blind', eyes === 1 ? 2 : 5);
  if (eyes >= 3 && !isImmune(foe, 'slow')) prolong(foe, 'crippled', eyes === 3 ? 2 : 5);
}

/** The hero a hawk or clone belongs to, wherever it stands in the world (for the combat hooks). */
export const allyOwner = (world: World, ally: Mob): Hero | undefined => ownerOf(world, ally);

/**
 * HawkAlly.defenseSkill: a point of Swift Spirit gives it two blows it cannot be hit by.
 * Returns whether the blow about to be rolled against it is dodged outright.
 */
export function hawkDodges(world: World, hawk: Mob): boolean {
  const hero = ownerOf(world, hawk);
  if (!hero || !hawk.hawk) return false;
  if (hawk.hawk.dodges < 2 * pointsInTalent(hero, 'swiftSpirit')) {
    hawk.hawk.dodges++;
    return true;
  }
  return false;
}

/** The armour of the abilities' allies (Char.drRoll): the clone's share of the hero's, the decoy's own. */
export function allyArmor(ctx: Ctx, mob: Mob): number {
  if (mob.kind === 'shadow') {
    const hero = ownerOf(ctx.world, mob);
    if (!hero) return 0;
    const points = pointsInTalent(hero, 'clonedArmor');
    return Math.max(0, Math.round(0.12 * points * drRoll(ctx, hero)));
  }
  if (mob.kind === 'ninjaLog') {
    const points = mob.ninja?.points ?? 0;
    return points > 0 ? ctx.rng.normalIntRange(points, 3 * points) : 0;
  }
  return 0;
}

/**
 * ShadowAlly.defenseProc: with Cloned Armor, a point in four of the time per point, the hero's glyph answers the blow
 * as it would on the hero (the ones that act on whoever struck: repulsion, affection and thorns).
 */
export function cloneGlyph(ctx: Ctx, clone: Mob, attacker: Mob): void {
  const hero = ownerOf(ctx.world, clone);
  if (!hero || ctx.rng.int(4) >= pointsInTalent(hero, 'clonedArmor') || isMagicImmune(hero)) return;
  const glyph = hero.armor.glyph;
  const level = Math.max(0, hero.armor.level);
  const chance = (p: number): boolean => ctx.rng.float() < p;
  switch (glyph) {
    case 'repulsion':
      if (distance(attacker.pos, clone.pos) === 1 && chance((level + 1) / (level + 5))) {
        const away = attacker.pos + (attacker.pos - clone.pos);
        throwChar(ctx, attacker, ballisticaAway(ctx, attacker.pos, away), 2, true, true);
        ctx.effects.push({ type: 'glyph', depth: ctx.depth, hero: hero.id, glyph });
      }
      break;
    case 'affection':
      if (chance((level + 3) / (level + 20)) && !isImmune(attacker, 'charm')) {
        attacker.charmed = Math.max(attacker.charmed ?? 0, 10);
        attacker.charmedBy = hero.id;
        ctx.effects.push({ type: 'glyph', depth: ctx.depth, hero: hero.id, glyph });
      }
      break;
    case 'thorns':
      if (chance((level + 2) / (level + 12)) && !isImmune(attacker, 'bleeding')) {
        attacker.bleeding = Math.max(attacker.bleeding ?? 0, 4 + level);
        ctx.effects.push({ type: 'glyph', depth: ctx.depth, hero: hero.id, glyph });
      }
      break;
    default:
  }
}

import { ballistica as castBallistica, MAGIC_BOLT } from '../ballistica';
const ballisticaAway = (ctx: Ctx, from: number, to: number) => castBallistica(ctx, from, to, MAGIC_BOLT);

/**
 * PerfectCopy: the clone trades places with the hero from up to a cell away for each point (ShadowAlly.canInteract and
 * interact), at once. Returns whether the hero is close enough to ask.
 */
export function copyReach(world: World, hero: Hero, clone: Mob): boolean {
  return clone.kind === 'shadow' && clone.directed?.owner === hero.id && distance(clone.pos, hero.pos) <= pointsInTalent(hero, 'perfectCopy');
}

/** ShadowAlly.interact with Perfect Copy: they swap places, with a puff of smoke on both. */
export function swapWithClone(ctx: Ctx, hero: Hero, clone: Mob): boolean {
  const { world, depth, level } = ctx;
  // Some checks from Mob.interact: a clone on bad ground, a large one with no room.
  if (!hasFlag(level.map[clone.pos]!, F.PASSABLE)) return false;
  if ((hasProp(clone, 'large') && !openSpace(ctx, hero.pos)) || (hasProp(hero as never, 'large') && !openSpace(ctx, clone.pos))) return false;
  const at = clone.pos;
  const from = hero.pos;
  clone.pos = from;
  hero.pos = at;
  enterCell(level, at);
  enterCell(level, from);
  ctx.effects.push({ type: 'ability', depth, hero: hero.id, ability: 'perfectCopy', from, to: at });
  void world;
  return true;
}

/** Mob.holdAllies and restoreAllies: a hero's clone and hawk follow them to another depth, to a cell beside them. */
export function alliesFollow(world: World, hero: Hero, fromDepth: number): void {
  const from = world.floors[fromDepth];
  const to = world.floors[hero.depth];
  const level = world.levels[hero.depth];
  if (!from || !to || !level || fromDepth === hero.depth) return;
  const follows = from.mobs.filter((mob) => (mob.kind === 'shadow' || mob.kind === 'hawk') && mob.directed?.owner === hero.id && isAlive(mob));
  for (const ally of follows) {
    from.mobs.splice(from.mobs.indexOf(ally), 1);
    const left = world.levels[fromDepth];
    if (left) leaveCell(world, left, fromDepth, ally.pos);
    const cells = NEIGHBOURS8.map((n) => hero.pos + n).filter((c) =>
      c >= 0 && c < LENGTH && canEnter(level, c) && !charAt(world, hero.depth, c) &&
      (ally.kind === 'hawk' || !hasFlag(level.map[c]!, F.AVOID)));
    if (cells.length === 0) continue;
    // restoreAllies: one of the free cells beside the hero, at random.
    ally.pos = cells[new Rng(to.rng).index(cells.length)]!;
    ally.time = to.now + 1;
    ally.directed!.defend = -1;
    ally.directed!.moving = false;
    ally.state = 'wandering';
    ally.enemy = null;
    to.mobs.push(ally);
    enterCell(level, ally.pos);
  }
}

export { hurt, trueDistance, armorTier, MOBS };

/**
 * Dungeon.observe: the hero sees all the spirit hawk sees (six cells round it, two more with Eagle Eye), and with three or four
 * points of Eagle Eye the hawk also shows what is round any monster within two or three cells of it.
 */
export function hawkVision(world: World, hero: Hero, fov: boolean[]): void {
  const floor = world.floors[hero.depth];
  const hawk = floor?.mobs.find((mob) => mob.kind === 'hawk' && mob.directed?.owner === hero.id && isAlive(mob));
  if (!hawk) return;
  const level = world.levels[hero.depth]!;
  const seen = castShadow(hawk.pos, terrainBlocksSight(level.map), hawkSight(hero));
  const eagle = pointsInTalent(hero, 'eagleEye');
  if (eagle >= 3) {
    const range = 1 + (eagle - 2);
    for (const mob of floor!.mobs) {
      if (!seen[mob.pos] && distance(hawk.pos, mob.pos) <= range) {
        for (const n of NEIGHBOURS9) if (mob.pos + n >= 0 && mob.pos + n < LENGTH) seen[mob.pos + n] = true;
      }
    }
  }
  for (let cell = 0; cell < LENGTH; cell++) if (seen[cell]) fov[cell] = true;
}
