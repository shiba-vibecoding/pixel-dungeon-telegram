import { type Hero, isShopkeeper, maxExp, type Mob, mobStats } from './actors';
import { hurt } from './combat';
import { type Char, type Ctx, dropItem, isHero, leaveCell } from './floor';
import { createItem } from './items';

/*
 * The altar room (AltarPainter, SacrificialFire). While its fire burns, every
 * monster on the level is drawn towards it; whoever stands in the fire is
 * marked for a few turns, and a marked creature that dies is an offering,
 * worth its experience (one to three times over, for a monster). Once the
 * fire has had enough, it goes out and leaves a scroll of wipe out.
 */

/** SacrificialFire.Marked.DURATION. */
export const MARKED_TURNS = 5;

/** The fire still burns on this depth. */
export const fireBurns = (ctx: Ctx): boolean => (ctx.floor.altar?.volume ?? 0) > 0;

/** SacrificialFire.evolve, for a monster's turn: drawn to the fire, and marked while in it. */
export function altarCallsMob(ctx: Ctx, mob: Mob): void {
  const fire = ctx.floor.altar;
  if (!fire || fire.volume <= 0 || mob.state === 'passive') {
    if ((mob.marked ?? 0) > 0) mob.marked!--;
    return;
  }
  if (mob.pos === fire.pos) {
    if (!mob.marked) ctx.effects.push({ type: 'marked', depth: ctx.depth, who: mob.id });
    mob.marked = MARKED_TURNS;
  } else if ((mob.marked ?? 0) > 0) {
    mob.marked!--;
  }
  // Mob.beckon: whoever is not already after someone heads for the fire.
  if (mob.state !== 'hunting') {
    mob.state = 'wandering';
    mob.target = fire.pos;
  }
}

/** SacrificialFire.evolve, for a hero's time passing: marked while in the fire, and a while after. */
export function altarMarksHero(ctx: Ctx, hero: Hero, time: number): void {
  if (fireBurns(ctx) && hero.pos === ctx.floor.altar!.pos) {
    if (!hero.marked) ctx.effects.push({ type: 'marked', depth: ctx.depth, who: hero.id });
    hero.marked = MARKED_TURNS;
  } else if ((hero.marked ?? 0) > 0) {
    hero.marked = Math.max(0, hero.marked! - time);
  }
}

/** SacrificialFire.sacrifice: a marked creature has died on the fire's level. */
export function sacrifice(ctx: Ctx, char: Char): void {
  const fire = ctx.floor.altar;
  if (!fire || fire.volume <= 0 || !((char.marked ?? 0) > 0)) return;
  const exp = isHero(char) ? maxExp(char) : mobStats(char).exp * ctx.rng.intRange(1, 3);
  if (exp <= 0) {
    ctx.effects.push({ type: 'sacrifice', depth: ctx.depth, pos: fire.pos, outcome: 'unworthy' });
    return;
  }
  fire.volume -= exp;
  if (fire.volume > 0) {
    ctx.effects.push({ type: 'sacrifice', depth: ctx.depth, pos: fire.pos, outcome: 'worthy' });
    return;
  }
  fire.volume = 0;
  dropItem(ctx.floor, fire.pos, createItem('wipeOut'));
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
    if (mob.state === 'passive' || mob.kind === 'ghostHero') continue;
    ctx.effects.push({ type: 'hurt', depth: ctx.depth, who: mob.id, damage: mob.hp });
    hurt(ctx, mob, mob.hp, hero);
  }
  for (const heap of ctx.floor.heaps) {
    if (heap.kind === 'forSale' || heap.kind === 'mimic') heap.kind = 'heap';
  }
}