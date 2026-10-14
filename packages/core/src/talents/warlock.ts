import { type Hero, createMob, type Mob } from '../actors';
import { affectHunger } from '../hero';
import { type Ctx, enterCell, isPassable, charAt } from '../floor';
import { pointsInTalent } from './data';
import { onFoodEaten } from './index';

/*
 * The warlock's talents (Mob.defenseProc and Mob.die with a SoulMark on the monster): soul eater feeds the hero as the marked
 * suffer and may count a kill as a meal; soul siphon lets allies' blows heal too; necromancer's minions raise a wraith
 * from a marked monster that dies.
 */

/** Mob.defenseProc under SoulMark: hunger eased by a third a point of soul eater, and four tenths of it as health. */
export function soulMarkRestoration(ctx: Ctx, hero: Hero, restoration: number): void {
  if (restoration <= 0) return;
  const eater = pointsInTalent(hero, 'soul_eater');
  if (eater > 0) affectHunger(ctx, hero, (restoration * eater) / 3);
  if (hero.hp < hero.ht) {
    const heal = Math.min(hero.ht - hero.hp, Math.ceil(restoration * 0.4));
    hero.hp += heal;
    ctx.effects.push({ type: 'healed', hero: hero.id, amount: heal });
  }
}

/** Mob.die: soul eater counts a kill as a meal (Random.Int(10) < points), necromancer's minions may raise a wraith (40% a third of a point). */
export function onSoulMarkedDied(ctx: Ctx, mob: Mob): void {
  const hero = ctx.world.heroes.find((h) => h.depth === ctx.depth && h.hp > 0);
  if (!hero) return;
  if (ctx.rng.int(10) < pointsInTalent(hero, 'soul_eater')) onFoodEaten(ctx, hero, 0, null);
  if (mob.kind !== 'wraith' && ctx.rng.float() < (0.4 * pointsInTalent(hero, 'necromancers_minions')) / 3) {
    const pos = mob.pos;
    if (!isPassable(ctx.level, pos) || charAt(ctx.world, ctx.depth, pos)) return;
    // Wraith.spawnAt, under Corruption: it fights for the hero.
    const wraith = createMob(`#${++ctx.world.nextId}`, 'wraith', pos, 'hunting', ctx.floor.now + 2);
    wraith.level = ctx.depth;
    wraith.enemySeen = true;
    wraith.ally = true;
    wraith.corrupted = true;
    ctx.floor.mobs.push(wraith);
    enterCell(ctx.level, pos);
    ctx.effects.push({ type: 'ally', depth: ctx.depth, mob: wraith.id, event: 'corrupted' });
  }
}
