import type { Hero } from '../actors';
import { hurt } from '../combat';
import { type Char, type Ctx } from '../floor';
import type { Item } from '../items';
import { adjacent } from '../level/geometry';
import { chargeCap, levelCap } from './artifact';
import { say, upgradeArtifact, wornOf } from './common';

/*
 * CapeOfThorns: worn, it stores up the harm its bearer takes; once full, it
 * radiates for ten turns (and a turn a level), turning a random share of
 * every blow back on an attacker beside the hero, and grows from what it
 * turns away. (Shattered's generator no longer deals it; here DM-300 leaves
 * it, as it did in Shattered before.)
 */

/** Thorns.act: the radiating wears off a turn at a time. */
export function capeAct(ctx: Ctx, hero: Hero, item: Item): void {
  if ((item.cooldown ?? 0) > 0) {
    item.cooldown!--;
    if (item.cooldown === 0) say(ctx, hero, 'capeofthorns$thorns.inert', 'w');
  }
}

/** Thorns.proc: a blow taken (`attacker` null for harm from no one), and what is left of it. */
export function thornsProc(ctx: Ctx, hero: Hero, item: Item, damage: number, attacker: Char | null): number {
  if ((item.cooldown ?? 0) === 0) {
    item.charge = Math.trunc((item.charge ?? 0) + damage * (0.5 + item.level * 0.05));
    if (item.charge >= chargeCap(item)) {
      item.charge = 0;
      item.cooldown = 10 + item.level;
      say(ctx, hero, 'capeofthorns$thorns.radiating', 'p');
    }
  }
  if ((item.cooldown ?? 0) !== 0) {
    const deflected = ctx.rng.normalIntRange(0, damage);
    damage -= deflected;
    if (attacker && adjacent(attacker.pos, hero.pos) && deflected > 0) {
      ctx.effects.push({ type: 'hurt', depth: ctx.depth, who: attacker.id, damage: deflected });
      hurt(ctx, attacker, deflected, hero);
    }
    item.exp = (item.exp ?? 0) + deflected;
    if (item.exp >= (item.level + 1) * 5 && item.level < levelCap(item)) {
      item.exp -= (item.level + 1) * 5;
      upgradeArtifact(ctx, item);
      say(ctx, hero, 'capeofthorns$thorns.levelup', 'p');
    }
  }
  return damage;
}

/** Hero.damage with the cape worn: it takes its share of everything that hurts the hero. */
export function capeTakes(ctx: Ctx, hero: Hero, damage: number, attacker: Char | null): number {
  const cape = wornOf(hero, 'artifact.cape');
  return cape ? thornsProc(ctx, hero, cape, damage, attacker) : damage;
}

/** CapeOfThorns.charge: four times the boost, while it is not radiating; full, it starts at once. */
export function chargeCape(ctx: Ctx, hero: Hero, item: Item, amount: number): void {
  if ((item.cooldown ?? 0) === 0) item.charge = (item.charge ?? 0) + Math.round(4 * amount);
  if ((item.charge ?? 0) >= chargeCap(item)) thornsProc(ctx, hero, item, 0, null);
}

/** Thorns.detach: taken off, it loses what it had stored. */
export function capeOff(item: Item): void {
  item.cooldown = 0;
  item.charge = 0;
}
