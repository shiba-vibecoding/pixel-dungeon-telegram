import { type Hero, isAlive, type Mob } from '../actors';
import { attackSpeedMultiplier } from '../rings';
import { attack } from '../combat';
import { type Ctx } from '../floor';
import { type Item, itemDef } from '../items';
import { gearLevel } from '../weapons';
import { S } from '../spd-sprites';
import { pointsInTalent } from './data';
import { tbOf } from './state';
import { dispelInvisibility } from '../artifacts';
import { consumeLethalMomentum } from './turns';

/*
 * The huntress's subclasses: the sniper's mark (actors/buffs/SnipersMark.java) with the bow's special shots
 * (SpiritBow.sniperSpecial), and seer shot. The warden's herbal powers are in plants.ts.
 */

/** SnipersMark.DURATION. */
export const MARK_TURNS = 4;
const f32 = Math.fround;

/** The spirit bow in the pack. */
export const bowOf = (hero: Hero): Item | undefined => hero.items.find((item) => itemDef(item.kind).category === 'bow');

/**
 * Hero.attackProc for a sniper: a thrown weapon that left its target alive marks it (shared upgrades: stays longer
 * and the special shot hits harder, by a sixth of the weapon's level, 2/4/6 levels at most).
 */
export function markTarget(hero: Hero, enemy: Mob, thrown: Item): void {
  if (hero.subclass !== 'sniper' || !isAlive(enemy)) return;
  const points = pointsInTalent(hero, 'shared_upgrades');
  const b = tbOf(hero);
  if (points > 0) {
    const levelBonus = Math.min(2 * points, Math.max(0, gearLevel(thrown)));
    b.sniper = { object: enemy.id, bonus: f32(levelBonus / 6), left: Math.max(b.sniper?.left ?? 0, MARK_TURNS + levelBonus) };
  } else {
    b.sniper = { object: enemy.id, bonus: 0, left: Math.max(b.sniper?.left ?? 0, MARK_TURNS) };
  }
}

/** The mark's target, if it is still there. */
export function markedMob(ctx: Ctx, hero: Hero): Mob | undefined {
  const mark = hero.tal?.sniper;
  if (!mark) return undefined;
  const mob = ctx.floor.mobs.find((m) => m.id === mark.object);
  if (!mob || !isAlive(mob)) {
    delete hero.tal!.sniper;
    return undefined;
  }
  return mob;
}

/** Why the mark's special shot cannot be made now. */
export function snipeProblem(ctx: Ctx, hero: Hero): string | null {
  if (hero.subclass !== 'sniper' || !hero.tal?.sniper) return 'no mark';
  if (!bowOf(hero)) return 'no bow';
  return markedMob(ctx, hero) ? null : 'no mark';
}

/** The special shot's time (SpiritBow.baseDelay): none, a turn for a volley, two for a sniper shot. */
const SPECIAL_DELAY = { none: 0, speed: 1, damage: 2 } as const;

/**
 * SnipersMark.doAction and SpiritBow.SpiritArrow.cast with sniperSpecial: a snapshot (reduced damage, no time), a volley
 * of three (half damage each, a turn) or a sniper shot (sure to hit, more damage the further it flies, two turns).
 * Returns the time taken.
 */
export function snipe(ctx: Ctx, hero: Hero): number {
  const mob = markedMob(ctx, hero)!;
  const bow = bowOf(hero)!;
  const mark = hero.tal!.sniper!;
  delete hero.tal!.sniper;
  const kind = bow.augment === 'speed' ? 'speed' : bow.augment === 'damage' ? 'damage' : 'none';
  hero.tal!.special = { bonus: mark.bonus, target: mob.pos, kind };
  ctx.effects.push({ type: 'snipe', hero: hero.id, kind });
  const arrows = kind === 'speed' ? 3 : 1;
  for (let i = 0; i < arrows && isAlive(mob) && isAlive(hero); i++) {
    ctx.effects.push({ type: 'missile', depth: ctx.depth, from: hero.pos, to: mob.pos, sprite: S.SPIRIT_ARROW });
    attack(ctx, hero, mob, { weapon: bow, sure: kind === 'damage' });
  }
  delete hero.tal!.special;
  dispelInvisibility(ctx, hero);
  if (consumeLethalMomentum(hero)) return 0;
  return f32(SPECIAL_DELAY[kind] / attackSpeedMultiplier(hero));
}

/**
 * SpiritBow.damageRoll with sniperSpecial: the mark's bonus, then the shot's own change; the sniper shot grows with distance
 * (1.2x at an adjacent cell, 1.125x more a cell, 3x at most).
 */
export function specialDamage(hero: Hero, damage: number): number {
  const special = hero.tal?.special;
  if (!special) return damage;
  damage = Math.round(f32(damage * f32(1 + special.bonus)));
  switch (special.kind) {
    case 'none':
      return Math.round(f32(damage * f32(0.667)));
    case 'speed':
      return Math.round(f32(damage * 0.5));
    default: {
      const cells = Math.max(Math.abs((hero.pos % 48) - (special.target % 48)), Math.abs(Math.trunc(hero.pos / 48) - Math.trunc(special.target / 48))) - 1;
      let multiplier = 1.2;
      for (let i = 0; i < cells; i++) multiplier = f32(multiplier * f32(1.125));
      return Math.round(f32(damage * Math.min(3, multiplier)));
    }
  }
}
