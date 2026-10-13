import { type CircleBack, type Hero, heroAttackDelay, isAlive, type Mob } from './actors';
import { ballistica } from './ai';
import { attack, CRIPPLE_TURNS, hurt } from './combat';
import { press } from './displace';
import { ADRENALINE_TURNS, bleedImmune, isAlly, isDemonic, isUndead, procMultiplier } from './enchant';
import { type Char, charAt, type Ctx, enterCell, heroView, isHero, isPassable, isWater, landItem, leaveCell } from './floor';
import { familiarise } from './ident';
import { createItem, type Item, itemDef } from './items';
import { adjacent, cellX, cellY, distance, LENGTH, NEIGHBOURS8 } from './level/geometry';
import { F, hasFlag } from './level/terrain';
import {
  durabilityLeft, durabilityPerUse, isDart, isSticky, isTippedDart, MAX_DURABILITY,
} from './missiles';
import { burst, immuneTo } from './traps';
import { CHILL_TURNS, ignite, timeScale } from './status';
import { sharpshootingDurability } from './rings';
import { gearLevel } from './weapons';
import { isImmune } from './props';
import { collect, pressUnderItem } from './inventory';
import { S } from './spd-sprites';
import type { World } from './world';
import type { Level } from './level/generate';

/*
 * Thrown weapons in flight, as Shattered Pixel Dungeon throws them
 * (MissileWeapon.onThrow, rangedHit, rangedMiss, decrementDurability; the
 * kinds' own procs; the heavy boomerang that circles back, the force cube
 * that strikes all around), the spirit bow's arrows (SpiritBow.SpiritArrow),
 * melee weapons' reach (KindOfWeapon.canReach), and what the hero's gear does
 * turn by turn.
 */

/** Shuriken.ShurikenInstantTracker.DURATION. */
const SHURIKEN_TURNS = 20;
/** HeavyBoomerang.CircleBack: it is back after this many turns. */
const CIRCLE_TURNS = 5;
/** Cripple.DURATION, Blindness.DURATION, Chill.DURATION, Bless.DURATION, Paralysis (a paralytic dart). */
const BLIND_TURNS = 10;
const BLESS_TURNS = 30;
const PARALYSIS_TURNS = 5;

/**
 * The thrown weapon's stack in the pack, while its copy is in flight (MissileWeapon.parent): it is the stack that
 * wears, and is learned about. Null when the last of a stack was thrown.
 */
let parent: Item | null = null;

/** Level.drop's pressCell: what lands on a cell sets off a trap or a plant there, or falls down a chasm. */
function drop(ctx: Ctx, pos: number, item: Item): void {
  landItem(ctx, pos, item);
  pressUnderItem(ctx, pos);
}

/**
 * Item.throwPos and MissileWeapon.throwPos: where a throw lands (the first thing in its way); a projecting weapon
 * reaches its mark up to four cells away, over anything between.
 */
export function throwPos(ctx: Ctx, hero: Hero, weapon: Item, target: number): number {
  const projecting = weapon.enchant === 'projecting' ||
    (isDart(weapon.kind) && hero.weapon?.kind === 'weapon.crossbow' && hero.weapon.enchant === 'projecting');
  const terrain = ctx.level.map[target];
  if (projecting && terrain !== undefined && (hasFlag(terrain, F.PASSABLE) || hasFlag(terrain, F.AVOID) || charAt(ctx.world, ctx.depth, target)) &&
    distance(hero.pos, target) <= Math.round(4 * procMultiplier(hero))) {
    return target;
  }
  return ballistica(ctx, hero.pos, target).at(-1)!;
}

/**
 * MissileWeapon.decrementDurability: the stack in the pack wears by a use; should it have had none left, the one
 * thrown breaks instead and the stack is whole again. The last of a stack wears itself.
 */
function decrementDurability(ctx: Ctx, hero: Hero, thrown: Item): void {
  if (parent) {
    const perUse = durabilityPerUse(parent, gearLevel(parent), sharpshootingDurability(hero));
    if (durabilityLeft(parent) <= perUse) {
      thrown.durability = 0;
      delete parent.durability;
      if (perUse < 100) ctx.effects.push({ type: 'worn', hero: hero.id, item: parent, state: 'broken' });
    } else {
      parent.durability = durabilityLeft(parent) - perUse;
      if (parent.durability >= MAX_DURABILITY) delete parent.durability;
      else if (parent.durability > 0 && parent.durability <= perUse) ctx.effects.push({ type: 'worn', hero: hero.id, item: parent, state: 'warning' });
    }
    parent = null;
    return;
  }
  const perUse = durabilityPerUse(thrown, gearLevel(thrown), sharpshootingDurability(hero));
  thrown.durability = durabilityLeft(thrown) - perUse;
  if (thrown.durability > 0 && thrown.durability <= perUse) ctx.effects.push({ type: 'worn', hero: hero.id, item: thrown, state: 'warning' });
  else if (perUse < 100 && thrown.durability <= 0) ctx.effects.push({ type: 'worn', hero: hero.id, item: thrown, state: 'broken' });
  if (thrown.durability >= MAX_DURABILITY) delete thrown.durability;
}

/** PinCushion: stuck in whom it hit, to drop where they die (allies and the dying excepted). */
function stick(ctx: Ctx, victim: Char | undefined, cell: number, item: Item): void {
  if (victim && !isHero(victim) && isAlive(victim) && !isAlly(victim) && isSticky(item.kind)) {
    (victim.pinned ??= []).push(item);
    return;
  }
  drop(ctx, cell, item);
}

/**
 * MissileWeapon.rangedHit: it wears, and unless it broke it sticks in whom it hit or drops there; a tipped dart
 * spent leaves a plain dart behind (TippedDart.rangedHit); a heavy boomerang circles back.
 */
function rangedHit(ctx: Ctx, hero: Hero, thrown: Item, victim: Char | undefined, cell: number): void {
  decrementDurability(ctx, hero, thrown);
  if (thrown.kind === 'missile.heavyBoomerang') {
    if (durabilityLeft(thrown) > 0) circleBack(hero, thrown, cell, ctx.depth);
    return;
  }
  if (durabilityLeft(thrown) > 0) {
    stick(ctx, victim, cell, thrown);
    return;
  }
  if (isTippedDart(thrown.kind)) stick(ctx, victim, victim?.pos ?? cell, createItem('missile.dart'));
}

/** MissileWeapon.rangedMiss: it falls where it was aimed; a heavy boomerang circles back. */
function rangedMiss(ctx: Ctx, hero: Hero, thrown: Item, cell: number): void {
  parent = null;
  if (thrown.kind === 'missile.heavyBoomerang') circleBack(hero, thrown, cell, ctx.depth);
  else drop(ctx, cell, thrown);
}

/** HeavyBoomerang.CircleBack.setup: back to where it was thrown from, in five turns. */
function circleBack(hero: Hero, item: Item, from: number, depth: number): void {
  (hero.circling ??= []).push({ item, from, to: hero.pos, depth, left: CIRCLE_TURNS });
}

/**
 * MissileWeapon.doThrow and onThrow: one of the stack flies at a cell (the stack wears as it hits). Thrown at
 * someone, it is a ranged attack (Hero.shoot) at a weapon's delay; at nobody, it lands, in a turn. A shuriken flies
 * instantly once in twenty turns. Returns the time it took.
 */
export function throwMissile(ctx: Ctx, hero: Hero, index: number, target: number): number {
  const stack = hero.items[index]!;
  let thrown: Item;
  if (stack.qty > 1) {
    // MissileWeapon.split: the copy thrown is whole; the stack it came from wears for it.
    stack.qty--;
    thrown = { ...(JSON.parse(JSON.stringify(stack)) as Item), qty: 1 };
    delete thrown.durability;
    delete thrown.explosive;
    parent = stack;
  } else {
    hero.items.splice(index, 1);
    thrown = stack;
    parent = null;
  }
  const end = throwPos(ctx, hero, thrown, target);
  ctx.effects.push({ type: 'thrown', depth: ctx.depth, from: hero.pos, to: end, item: thrown.kind });
  const there = charAt(ctx.world, ctx.depth, end);
  const victim = there && there !== hero && !isHero(there) ? there : undefined;
  // MissileWeapon.castDelay: the weapon's delay at someone, a turn at nothing; Shuriken: instant once in a while.
  let delay = victim || thrown.kind === 'missile.forceCube' ? heroAttackDelay(hero, thrown) : 1;
  if (thrown.kind === 'missile.forceCube' && hasFlag(ctx.level.map[end]!, F.PIT) && !victim) delay = 1;
  if (thrown.kind === 'missile.shuriken') {
    if ((hero.shuriken ?? 0) <= 0) {
      delay = 0;
      hero.shuriken = SHURIKEN_TURNS - 1;
    }
  }
  if (thrown.kind === 'missile.forceCube' && !(hasFlag(ctx.level.map[end]!, F.PIT) && !victim)) {
    forceCube(ctx, hero, thrown, end);
    return delay;
  }
  if (!victim) {
    parent = null;
    // IncendiaryDart.onThrow: at nobody, it sets what can burn alight where it lands, and is spent.
    if (thrown.kind === 'missile.incendiaryDart' && hasFlag(ctx.level.map[end]!, F.FLAMABLE)) {
      burst(ctx, end, 'fire', 0);
      decrementDurability(ctx, hero, thrown);
      drop(ctx, end, durabilityLeft(thrown) > 0 ? thrown : createItem('missile.dart'));
      return delay;
    }
    drop(ctx, end, thrown);
    return delay;
  }
  const hit = attack(ctx, hero, victim, { weapon: thrown });
  if (hit) rangedHit(ctx, hero, thrown, isAlive(victim) ? victim : undefined, end);
  else rangedMiss(ctx, hero, thrown, end);
  return delay;
}

/**
 * ForceCube.onThrow: it lands, wears, and strikes whoever stands there and all around (furthest first), setting off
 * what lies on those cells; the blast is all show (WandOfBlastWave.BlastWave).
 */
function forceCube(ctx: Ctx, hero: Hero, cube: Item, cell: number): void {
  const keep = parent;
  rangedHit(ctx, hero, cube, undefined, cell);
  parent = keep;
  const targets: Char[] = [];
  const centre = charAt(ctx.world, ctx.depth, cell);
  if (centre) targets.push(centre);
  pressUnderItem(ctx, cell);
  for (const n of NEIGHBOURS8) {
    pressUnderItem(ctx, cell + n);
    const char = charAt(ctx.world, ctx.depth, cell + n);
    if (char) targets.push(char);
  }
  const trueDistance = (a: number, b: number): number => Math.hypot(cellX(a) - cellX(b), cellY(a) - cellY(b));
  targets.sort((a, b) => trueDistance(b.pos, hero.pos) - trueDistance(a.pos, hero.pos));
  ctx.effects.push({ type: 'exploded', depth: ctx.depth, pos: cell });
  for (const target of targets) {
    if (isHero(target)) continue;
    if (isAlive(target)) attack(ctx, hero, target, { weapon: cube });
  }
  parent = null;
}

/**
 * SpiritBow.AC_SHOOT: an arrow of spirit at a cell, with the bow's numbers and enchantment (SpiritArrow); it never
 * lands. Returns the time it took: the bow's delay at someone, a turn at nothing.
 */
export function shootBow(ctx: Ctx, hero: Hero, index: number, target: number): number {
  const bow = hero.items[index]!;
  const end = throwPos(ctx, hero, bow, target);
  ctx.effects.push({ type: 'missile', depth: ctx.depth, from: hero.pos, to: end, sprite: S.SPIRIT_ARROW });
  const there = charAt(ctx.world, ctx.depth, end);
  if (!there || there === hero || isHero(there)) return 1;
  parent = null;
  attack(ctx, hero, there, { weapon: bow });
  // Seam: the sniper's special shots, nature's power and seer shot (classes, talents) change how arrows fly.
  return heroAttackDelay(hero, bow);
}

/**
 * MissileWeapon.proc and the kinds' own: what a thrown weapon does as it hits, before its enchantment (and the
 * stack learns of it). Returns the damage; for a dart that only helps (healing, adrenaline, cleansing, holy) an ally,
 * nothing.
 */
export function missileProc(ctx: Ctx, hero: Hero, mob: Mob, damage: number, thrown: Item): number {
  const { rng, depth } = ctx;
  if (itemDef(thrown.kind).category === 'bow') return damage;
  // MissileWeapon.proc: its curse shows once it hits; it, and its stack, are a use nearer to being known.
  const stack = parent ?? thrown;
  delete thrown.curseUnknown;
  delete stack.curseUnknown;
  const last = !parent && durabilityLeft(thrown) <= durabilityPerUse(thrown, gearLevel(thrown), sharpshootingDurability(hero));
  if (!last) {
    familiarise(ctx, hero, stack);
    if (!stack.levelUnknown) delete thrown.levelUnknown;
  }
  const ally = isAlly(mob);
  switch (thrown.kind) {
    case 'missile.bolas':
      // Bolas: a crippling half.
      mob.crippled = Math.max(mob.crippled ?? 0, CRIPPLE_TURNS / 2);
      return damage;
    case 'missile.fishingSpear':
      // FishingSpear: a piranha loses half its health at the least.
      return mob.kind === 'piranha' ? Math.max(damage, Math.trunc(mob.hp / 2)) : damage;
    case 'missile.tomahawk': {
      // Tomahawk: bleeding of 3-6 and half a level to a level more, whatever the armour.
      if (!bleedImmune(mob)) {
        const level = Math.max(0, thrown.level);
        const bleed = 3 + level / 2 + (rng.float() + rng.float()) / 2 * (6 + level - (3 + level / 2));
        mob.bleeding = Math.max(mob.bleeding ?? 0, Math.round(bleed));
      }
      return damage;
    }
    case 'missile.paralyticDart':
      mob.paralysed = Math.max(mob.paralysed ?? 0, PARALYSIS_TURNS);
      return damage;
    case 'missile.poisonDart':
      // Poison.set(3 + depth/2), a point a turn here.
      if (!bleedImmune(mob)) mob.poison = Math.max(mob.poison ?? 0, 3 + Math.trunc(depth / 2));
      return damage;
    case 'missile.blindingDart':
      mob.blind = Math.max(mob.blind ?? 0, BLIND_TURNS);
      return damage;
    case 'missile.chillingDart':
      // Buff.prolong(Chill): at least this long (nothing on the frozen or the icy).
      if (!isImmune(mob, 'chill') && !((mob.frozen ?? 0) > 0)) {
        mob.chill = Math.max(mob.chill ?? 0, isWater(ctx.level.map[mob.pos]!) ? CHILL_TURNS : 6);
        mob.burning = 0;
      }
      return damage;
    case 'missile.incendiaryDart':
      if (!isWater(ctx.level.map[mob.pos]!) && !immuneTo(mob, 'burning')) ignite(mob);
      return damage;
    case 'missile.rotDart':
      // RotDart: corrosion, weaker on bosses. Here, as poison of the same strength.
      mob.poison = Math.max(mob.poison ?? 0, mob.kind === 'goo' || mob.kind === 'tengu' || mob.kind === 'dm300' || mob.kind === 'king' || mob.kind === 'yog'
        ? Math.round(5 * (1 + Math.trunc(depth / 3)) / 2)
        : Math.round(10 * Math.max(1, depth) / 2));
      return damage;
    case 'missile.shockingDart': {
      const shock = rng.normalIntRange(5 + Math.trunc(depth / 4), 10 + Math.trunc(depth / 4));
      ctx.effects.push({ type: 'zapped', depth, from: mob.pos, to: mob.pos, bolt: 'lightning' });
      ctx.effects.push({ type: 'hurt', depth, who: mob.id, damage: shock });
      hurt(ctx, mob, shock, 'lightning');
      return damage;
    }
    case 'missile.displacingDart':
      // DisplacingDart: off to a cell 8-10 steps from the thrower, the nearest to it in sight if any.
      displaceFar(ctx, hero, mob);
      return damage;
    case 'missile.adrenalineDart':
      if (ally) {
        mob.adrenaline = Math.max(mob.adrenaline ?? 0, ADRENALINE_TURNS);
        return 0;
      }
      mob.crippled = Math.max(mob.crippled ?? 0, CRIPPLE_TURNS / 2);
      return damage;
    case 'missile.healingDart': {
      // HealingDart: heals 30 and half the health of whoever it hits (here at once), and cures them.
      const heal = Math.min(mob.ht - mob.hp, Math.trunc(0.5 * mob.ht + 30));
      if (heal > 0) mob.hp += heal;
      Object.assign(mob, { poison: 0, bleeding: 0, crippled: 0, blind: 0, ooze: 0, chill: 0 });
      return ally ? 0 : damage;
    }
    case 'missile.cleansingDart':
      if (ally) {
        Object.assign(mob, { poison: 0, bleeding: 0, crippled: 0, blind: 0, ooze: 0, chill: 0, paralysed: 0, burning: 0 });
        return 0;
      }
      // CleansingDart: a foe loses what helps it, and forgets whom it was after.
      Object.assign(mob, { adrenaline: 0, blessed: 0, enraged: false });
      if (mob.state === 'hunting' || mob.state === 'fleeing') mob.state = 'wandering';
      mob.enemySeen = false;
      return damage;
    case 'missile.holyDart':
      if (ally) {
        mob.blessed = Math.max(mob.blessed ?? 0, BLESS_TURNS);
        return 0;
      }
      if (isUndead(mob) || isDemonic(mob)) {
        const holy = rng.normalIntRange(10 + Math.trunc(depth / 3), 20 + Math.trunc(depth / 3));
        ctx.effects.push({ type: 'hurt', depth, who: mob.id, damage: holy });
        hurt(ctx, mob, holy, 'holy');
      } else {
        mob.blessed = Math.max(mob.blessed ?? 0, BLESS_TURNS);
      }
      return damage;
    default:
      return damage;
  }
}

/** DisplacingDart.proc: a cell 8 to 10 steps from the thrower, the nearest to the target in sight (or out of it). */
function displaceFar(ctx: Ctx, hero: Hero, mob: Mob): void {
  const { level, world, depth } = ctx;
  if (mob.kind === 'yog') return;
  const dist = new Int32Array(LENGTH).fill(-1);
  dist[hero.pos] = 0;
  const queue = [hero.pos];
  for (let head = 0; head < queue.length; head++) {
    const cell = queue[head]!;
    for (const n of NEIGHBOURS8) {
      const next = cell + n;
      if (next < 0 || next >= LENGTH || dist[next]! >= 0 || !adjacent(cell, next)) continue;
      if (!isPassable(level, next) && !hasFlag(level.map[next]!, F.AVOID)) continue;
      dist[next] = dist[cell]! + 1;
      queue.push(next);
    }
  }
  const seen = heroView(world, hero);
  let best = -1;
  let bestSeen = false;
  const trueDistance = (a: number, b: number): number => Math.hypot(cellX(a) - cellX(b), cellY(a) - cellY(b));
  for (let cell = 0; cell < LENGTH; cell++) {
    if (!isPassable(level, cell) || dist[cell]! < 8 || dist[cell]! > 10 || charAt(world, depth, cell)) continue;
    const visible = seen[cell] === true;
    if (best === -1 || (visible && !bestSeen) || (visible === bestSeen && trueDistance(mob.pos, cell) < trueDistance(mob.pos, best))) {
      best = cell;
      bestSeen = visible;
    }
  }
  if (best === -1) return;
  const from = mob.pos;
  mob.pos = best;
  leaveCell(world, level, depth, from);
  enterCell(level, best);
  ctx.effects.push({ type: 'blinked', depth, who: mob.id, from, to: best });
  press(ctx, mob);
}

/**
 * KindOfWeapon.canReach: within the weapon's reach, along open ground no one else stands on (Spear and Glaive two
 * cells, Whip three, a projecting weapon one more).
 */
export function canReach(world: World, level: Level, hero: Hero, target: number, reach: number): boolean {
  if (distance(hero.pos, target) > reach) return false;
  const dist = new Map<number, number>([[target, 0]]);
  const queue = [target];
  for (let head = 0; head < queue.length; head++) {
    const cell = queue[head]!;
    const d = dist.get(cell)!;
    if (cell === hero.pos) return true;
    if (d >= reach) continue;
    for (const n of NEIGHBOURS8) {
      const next = cell + n;
      if (next < 0 || next >= LENGTH || dist.has(next) || !adjacent(cell, next) || hasFlag(level.map[next]!, F.SOLID)) continue;
      const char = charAt(world, hero.depth, next);
      if (char && char !== hero) continue;
      dist.set(next, d + 1);
      queue.push(next);
    }
  }
  return false;
}

/**
 * What the hero's gear does as time passes: the shuriken's instant throw comes back, a blocking shield fades, kept
 * kinetic damage ebbs (2.5% a turn, a tenth at least), a wayward aim steadies, heavy boomerangs come back, crystal
 * weapons mend (Crystal.CrystalRepair).
 */
export function gearTick(ctx: Ctx, hero: Hero, time: number): void {
  if (hero.shuriken) hero.shuriken = Math.max(0, hero.shuriken - time);
  if (hero.blocking) {
    hero.blocking.left -= time;
    if (hero.blocking.left <= 0) delete hero.blocking;
  }
  if (hero.wayward) hero.wayward = Math.max(0, hero.wayward - time);
  const turns = Math.floor(hero.time) - Math.floor(hero.time - time);
  for (let i = 0; i < turns && hero.kinetic !== undefined; i++) {
    hero.kinetic -= Math.max(hero.kinetic * 0.025, 0.1);
    if (hero.kinetic <= 0) delete hero.kinetic;
  }
  for (const item of [hero.weapon, ...hero.items]) {
    if (item?.enchant !== 'crystal') continue;
    if (itemDef(item.kind).category === 'missile') {
      if (item.durability !== undefined) {
        item.durability = Math.min(MAX_DURABILITY, item.durability + 0.1 * time);
        if (item.durability >= MAX_DURABILITY) {
          delete item.durability;
          ctx.effects.push({ type: 'crystal', hero: hero.id, item, state: 'fixed' });
        }
      }
    } else if (item.crystal !== undefined) {
      item.crystal += 0.2 * time;
      if (item.crystal >= 100) {
        delete item.crystal;
        ctx.effects.push({ type: 'crystal', hero: hero.id, item, state: 'fixed' });
      }
    }
  }
  if (hero.circling?.length) {
    for (const flight of [...hero.circling]) {
      if (flight.depth !== ctx.depth) continue;
      flight.left -= time;
      if (flight.left <= 0) {
        hero.circling.splice(hero.circling.indexOf(flight), 1);
        circledBack(ctx, hero, flight);
      }
    }
    if (hero.circling.length === 0) delete hero.circling;
  }
}

/**
 * HeavyBoomerang.CircleBack.act: back where it was thrown from; its thrower there catches it (or it drops at their
 * feet), anyone else there is struck by it.
 */
function circledBack(ctx: Ctx, hero: Hero, flight: CircleBack): void {
  const { item, from, to } = flight;
  ctx.effects.push({ type: 'thrown', depth: ctx.depth, from, to, item: item.kind });
  const there = charAt(ctx.world, ctx.depth, to);
  if (there === hero) {
    if (!collect(hero, item)) drop(ctx, to, item);
    else ctx.effects.push({ type: 'pickedUp', hero: hero.id, item });
    return;
  }
  if (there && !isHero(there) && isAlive(there)) {
    parent = null;
    // Circling back, it is never point-blank (adjacentAccFactor 1.5).
    if (attack(ctx, hero, there, { weapon: item })) decrementDurability(ctx, hero, item);
    if (durabilityLeft(item) > 0) drop(ctx, to, item);
    return;
  }
  drop(ctx, to, item);
}

/**
 * What a monster's gear-made conditions do on its turn (Adrenaline, the lucky blow's tracker; the wands' conditions —
 * chill, ooze, corruption, bless — wear off in status.ts); true if it died of them.
 */
export function mobGearTick(_ctx: Ctx, mob: Mob): boolean {
  delete mob.luck;
  if (mob.adrenaline) mob.adrenaline = Math.max(0, mob.adrenaline - 1);
  return false;
}

/** Char.spend for a monster: slowed or chilled as status.ts has it; with adrenaline, twice as fast. */
export function mobTimeScale(mob: Mob): number {
  return (mob.adrenaline ?? 0) > 0 ? timeScale(mob) * 2 : timeScale(mob);
}
