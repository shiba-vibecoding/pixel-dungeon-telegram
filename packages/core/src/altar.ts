import { baseKind, createMob, type Hero, isShopkeeper, type Mob, mobStats, rollMob } from './actors';
import { randomRespawnCell } from './ai';
import { hurt } from './combat';
import { type Char, type Ctx, dropItem, heroesOn, isHero, leaveCell } from './floor';
import { distance } from './level/geometry';
import { scaleMob } from './party';
import { createItem } from './items';

/*
 * The sacrificial fire of a sacrifice room (SacrificeRoom, SacrificialFire). Whoever stands on or beside
 * it is marked for a couple of turns, and a marked creature that dies there is an offering, worth its
 * experience (two or three times over, for a monster; enough for anything, for a hero). Once it has had
 * enough (6 + 4 per depth), it flares up, goes out, and leaves its prize: a cursed weapon of the next
 * set of floors. While it burns and the level is empty of foes, it calls up a few more to offer.
 */

/** SacrificialFire.Marked.DURATION. */
export const MARKED_TURNS = 2;

/** The fire still burns on this depth. */
export const fireBurns = (ctx: Ctx): boolean => (ctx.floor.altar?.volume ?? 0) > 0;

/** SacrificialFire.evolve: within a step of the fire (NEIGHBOURS9), a creature is marked. */
const byTheFire = (ctx: Ctx, pos: number): boolean => fireBurns(ctx) && distance(pos, ctx.floor.altar!.pos) <= 1;

/** SacrificialFire.evolve, for a monster's turn: marked while by the fire, and a while after. */
export function altarCallsMob(ctx: Ctx, mob: Mob): void {
  if (byTheFire(ctx, mob.pos)) {
    if (!mob.marked) ctx.effects.push({ type: 'marked', depth: ctx.depth, who: mob.id });
    mob.marked = MARKED_TURNS;
  } else if ((mob.marked ?? 0) > 0) {
    mob.marked!--;
  }
}

/**
 * SacrificialFire.evolve, for a hero's time passing: marked while by the fire, and a while after; and,
 * the fire found and no foe left on the level, it calls one up (Level.spawnMob(4)), three times at most
 * beyond one for every worthy offering.
 */
export function altarMarksHero(ctx: Ctx, hero: Hero, time: number): void {
  if (byTheFire(ctx, hero.pos)) {
    if (!hero.marked) ctx.effects.push({ type: 'marked', depth: ctx.depth, who: hero.id });
    hero.marked = MARKED_TURNS;
  } else if ((hero.marked ?? 0) > 0) {
    hero.marked = Math.max(0, hero.marked! - time);
  }
  const fire = ctx.floor.altar;
  if (!fire || fire.volume <= 0 || (fire.bonusSpawns ?? BONUS_SPAWNS) <= 0) return;
  if (!ctx.world.explored[ctx.depth]?.[fire.pos] || ctx.floor.mobs.some((mob) => mob.state !== 'passive')) return;
  const heroes = heroesOn(ctx.world, ctx.depth);
  const pos = randomRespawnCell(ctx.rng, ctx.world, ctx.level, (cell) => heroes.every((h) => distance(h.pos, cell) >= 4));
  if (pos === -1) return;
  ctx.floor.mobs.push(scaleMob(ctx.world, createMob(`#${++ctx.world.nextId}`, rollMob(ctx.rng, ctx.depth), pos, 'wandering', ctx.floor.now)));
  fire.bonusSpawns = (fire.bonusSpawns ?? BONUS_SPAWNS) - 1;
}

/** SacrificialFire.bonusSpawns: the monsters it may call up to be offered. */
const BONUS_SPAWNS = 3;

/** SacrificialFire.sacrifice: what an offering is worth, as the wand of corruption reckons it. */
function offeringWorth(ctx: Ctx, char: Char): number {
  if (isHero(char)) return 1_000_000;
  const kind = baseKind(char.kind);
  let exp = 0;
  if (kind === 'statue' || kind === 'mimic') exp = 1 + ctx.depth;
  else if (kind === 'piranha' || kind === 'bee') exp = 1 + Math.trunc(ctx.depth / 2);
  else if (kind === 'wraith') exp = 1 + Math.trunc(ctx.depth / 3);
  else if (kind === 'swarm' && (char.generation ?? 0) > 0) exp = 1;
  else if (mobStats(char).exp > 0) exp = 1 + mobStats(char).exp;
  return exp * ctx.rng.intRange(2, 3);
}

/** SacrificialFire.sacrifice: a marked creature has died by the fire. */
export function sacrifice(ctx: Ctx, char: Char): void {
  const fire = ctx.floor.altar;
  if (!fire || fire.volume <= 0 || !((char.marked ?? 0) > 0)) return;
  const exp = offeringWorth(ctx, char);
  if (exp <= 0) {
    ctx.effects.push({ type: 'sacrifice', depth: ctx.depth, pos: fire.pos, outcome: 'unworthy' });
    return;
  }
  if (fire.volume - exp > 0) {
    fire.volume -= exp;
    fire.bonusSpawns = (fire.bonusSpawns ?? BONUS_SPAWNS) + 1;
    ctx.effects.push({ type: 'sacrifice', depth: ctx.depth, pos: fire.pos, outcome: 'worthy' });
    return;
  }
  fire.volume = 0;
  // SEAM(gear): SacrificeRoom.prize(level) when the fire had none; the room always gives it one here.
  dropItem(ctx.floor, fire.pos, fire.prize ?? createItem('wipeOut'));
  delete fire.prize;
  ctx.effects.push({ type: 'sacrifice', depth: ctx.depth, pos: fire.pos, outcome: 'reward' });
}

/** Bestiary.isBoss: whom the scroll of wipe out spares. */
const BOSSES = new Set(['goo', 'tengu', 'dm300', 'king', 'yog', 'burningFist', 'rottingFist']);

/**
 * ScrollOfWipeOut: the wrath of the dungeon's spirits kills every monster on
 * the level but its boss. A shopkeeper is gone too, and the wares are free
 * for the taking; mimics are only chests now. Those who need the heroes (the
 * quest givers) and the heroes' allies are spared.
 */
export function wipeOut(ctx: Ctx, hero: Hero): void {
  hero.invisible = 0;
  ctx.effects.push({ type: 'wipedOut', depth: ctx.depth, hero: hero.id });
  for (const mob of [...ctx.floor.mobs]) {
    if (BOSSES.has(mob.kind) || !ctx.floor.mobs.includes(mob)) continue;
    if (isShopkeeper(mob)) {
      ctx.floor.mobs.splice(ctx.floor.mobs.indexOf(mob), 1);
      leaveCell(ctx.world, ctx.level, ctx.depth, mob.pos);
      ctx.effects.push({ type: 'died', depth: ctx.depth, who: mob.id, pos: mob.pos });
      continue;
    }
    if (mob.state === 'passive') continue;
    ctx.effects.push({ type: 'hurt', depth: ctx.depth, who: mob.id, damage: mob.hp });
    hurt(ctx, mob, mob.hp, hero);
  }
  for (const heap of ctx.floor.heaps) {
    if (heap.kind === 'forSale' || heap.kind === 'mimic') heap.kind = 'heap';
  }
}