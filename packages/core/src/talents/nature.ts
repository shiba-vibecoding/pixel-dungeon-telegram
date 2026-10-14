import type { Hero } from '../actors';
import { setBarkskin } from '../buffs';
import { type Ctx, dropItem } from '../floor';
import { createItem } from '../items';
import { T } from '../level/terrain';
import { regenOn } from '../hero';
import { furrowGrass } from '../world';
import { hasTalent, pointsInTalent } from './data';
import { tbOf } from './state';

/*
 * The huntress's talents among the grass and plants: nature's bounty drops berries from trampled grass, barkskin
 * hardens her in it, rejuvenating steps grow tall grass as she walks, nature's aid hardens her when a plant goes off in sight.
 */

/**
 * HighGrass.trample for a hero: barkskin (the huntress, level a third a point of her level, for a turn), and berries
 * from nature's bounty, on floors 2/3/4/6/7/8 up to a max of 4/6, likelier the further behind she is.
 */
export function onGrassTrampled(ctx: Ctx, hero: Hero, pos: number): void {
  if (hero.heroClass === 'huntress' && hasTalent(hero, 'barkskin')) {
    setBarkskin(hero, Math.trunc((hero.lvl * pointsInTalent(hero, 'barkskin')) / 3), 1);
  }
  if (!hasTalent(hero, 'natures_bounty')) return;
  const points = pointsInTalent(hero, 'natures_bounty');
  const b = tbOf(hero);
  const available = 2 + 2 * points - (b.berries ?? 0);
  if (available <= 0) return;
  let target = 2 + 2 * points;
  target -= available;
  target += target >= 5 ? 3 : 2;
  // If we're behind: 1/10, on page: 1/30, ahead: 1/90.
  const drop = ctx.depth > target ? ctx.rng.int(10) === 0 : ctx.depth === target ? ctx.rng.int(30) === 0 : ctx.rng.int(90) === 0;
  if (drop) {
    b.berries = (b.berries ?? 0) + 1;
    dropItem(ctx.floor, pos, createItem('food.berry'));
  }
}

/** Level.occupyCell: rejuvenating steps turn grass underfoot to tall grass (and, spent or with a sealed floor, to furrowed grass). */
export function onHeroMovedOnGrass(ctx: Ctx, hero: Hero): void {
  if (!hasTalent(hero, 'rejuvenating_steps')) return;
  const b = tbOf(hero);
  const terrain = ctx.level.map[hero.pos];
  if ((terrain !== T.GRASS && terrain !== T.EMBERS) || b.rejuvenating !== undefined) return;
  const points = pointsInTalent(hero, 'rejuvenating_steps');
  ctx.level.map[hero.pos] = T.HIGH_GRASS;
  if (!regenOn(ctx.world, hero) || (b.furrow ?? 0) >= 200) furrowGrass(ctx.level, hero.pos);
  else b.furrow = (b.furrow ?? 0) + (3 - points);
  b.rejuvenating = 15 - 5 * points;
}

/**
 * SpiritArrow.cast and MissileWeapon.onThrow: seer shot, an arrow (or, metamorphosed, a thrown weapon) that lands on empty
 * ground shows the cells around it for 5 turns a point; it cools down for 20.
 */
export function seerShot(ctx: Ctx, hero: Hero, cell: number): void {
  const points = pointsInTalent(hero, 'seer_shot');
  const b = tbOf(hero);
  if (points <= 0 || b.seerShot !== undefined) return;
  b.revealed = { depth: ctx.depth, pos: cell, left: 5 * points };
  b.seerShot = 20;
  ctx.effects.push({ type: 'spell', hero: hero.id, sprite: 'vision', tint: [0.7, 0.4, 0.7] });
}

/** Plant.trigger: nature's aid hardens the hero when a plant goes off in their sight (2, for 3 or 5 turns); barkskin when the hero sets one off. */
export function onPlantTriggered(ctx: Ctx, hero: Hero, steppedOn: boolean, inSight: boolean): void {
  if (steppedOn && hasTalent(hero, 'barkskin')) {
    setBarkskin(hero, Math.trunc((hero.lvl * pointsInTalent(hero, 'barkskin')) / 3), 1);
  }
  if (inSight && hasTalent(hero, 'natures_aid')) setBarkskin(hero, 2, 1 + 2 * pointsInTalent(hero, 'natures_aid'));
}
