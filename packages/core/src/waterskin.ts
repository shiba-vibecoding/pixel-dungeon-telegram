import type { Hero } from './actors';
import type { Ctx } from './floor';
import type { Item } from './items';
import { T } from './level/terrain';
import { pointsInTalent } from './talents/data';

/*
 * The waterskin (Waterskin) every hero sets out with, and dew (Dewdrop), as
 * Shattered Pixel Dungeon has them: a drop of dew is worth a twentieth of the
 * hero's health; picked up, it goes into the waterskin while there is room,
 * otherwise it heals at once (and an unhurt hero leaves it lying, unless on
 * the stairs). Drunk, the waterskin gives only as many drops as the wounds
 * need. It replaces Pixel Dungeon's dew vial, which no longer saves its
 * bearer from death.
 */

/** Waterskin.MAX_VOLUME. */
export const WATERSKIN_VOLUME = 20;
/** Waterskin.TIME_TO_DRINK. */
export const TIME_TO_DRINK = 1;

const f32 = Math.fround;

/**
 * Dewdrop.consumeDew: each drop heals 5% of the hero's health (20 drops for all of it); the health
 * gained, or null when it did nothing and was not forced (an unhurt hero does not pick a dewdrop up).
 */
export function consumeDew(hero: Hero, quantity: number, force: boolean): number | null {
  const effect = Math.round(f32(f32(hero.ht * f32(0.05)) * quantity));
  const heal = Math.min(hero.ht - hero.hp, effect);
  // Shielding dew: what the hero could not heal becomes a shield, up to a fifth of their health a point.
  let shield = 0;
  const points = pointsInTalent(hero, 'shielding_dew');
  if (points > 0) {
    shield = effect - heal;
    shield = Math.min(shield, Math.round(f32(hero.ht * f32(0.2 * points))) - (hero.shield ?? 0));
  }
  if (heal <= 0 && shield <= 0) return force ? 0 : null;
  hero.hp += heal;
  if (shield > 0) {
    hero.shield = (hero.shield ?? 0) + shield;
    hero.shieldDecay = 0;
  }
  return heal;
}

/**
 * Dewdrop.doPickUp: into the waterskin while it is not full; otherwise drunk at once, which an
 * unhurt hero would not (unless standing on the stairs, to let them through). False if it stays.
 */
export function pickUpDew(ctx: Ctx, hero: Hero, pos: number, quantity = 1): boolean {
  const skin = hero.items.find((item) => item.kind === 'waterskin');
  if (skin && (skin.volume ?? 0) < WATERSKIN_VOLUME) {
    // Waterskin.collectDew.
    skin.volume = Math.min(WATERSKIN_VOLUME, (skin.volume ?? 0) + quantity);
    ctx.effects.push({ type: 'dewCollected', hero: hero.id, full: skin.volume >= WATERSKIN_VOLUME });
    return true;
  }
  const terrain = ctx.level.map[pos];
  const stairs = terrain === T.ENTRANCE || terrain === T.EXIT || terrain === T.UNLOCKED_EXIT;
  const heal = consumeDew(hero, quantity, stairs);
  if (heal === null) ctx.effects.push({ type: 'dewFull', hero: hero.id });
  else ctx.effects.push({ type: 'dew', hero: hero.id, amount: heal });
  return heal !== null;
}

/**
 * Waterskin.execute(AC_DRINK): as many drops as the hero's wounds need (at least one, at most what
 * it holds), each worth 5% of their health.
 */
export function drinkFromWaterskin(ctx: Ctx, hero: Hero, skin: Item): void {
  const missing = f32(1 - f32(hero.hp / hero.ht));
  let needed = f32(missing / f32(0.05));
  // Shielding dew: extra drops if a shield can still grow.
  const points = pointsInTalent(hero, 'shielding_dew');
  if (points > 0) {
    const max = Math.round(f32(hero.ht * f32(0.2 * points)));
    const missingShield = f32(f32(1 - (hero.shield ?? 0) / max) * f32(0.2 * points));
    if (missingShield > 0) needed = f32(needed + f32(missingShield / f32(0.05)));
  }
  const drops = Math.max(1, Math.min(Math.ceil(needed - f32(0.01)), skin.volume ?? 0));
  const heal = consumeDew(hero, drops, true) ?? 0;
  skin.volume = (skin.volume ?? 0) - drops;
  ctx.effects.push({ type: 'vial', hero: hero.id, amount: heal });
}
