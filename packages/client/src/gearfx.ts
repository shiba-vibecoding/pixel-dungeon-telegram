import { cursedKnown, type Enchantment, type Glyph, isCurseEnchant, isCurseGlyph, type Item, S } from '@pd/core';

/*
 * How Shattered's weapons, armour and thrown weapons look: how a thrown one
 * flies (MissileSprite: spinning, or pointing along its way), and the glow of
 * an enchanted item (ItemSprite.Glowing). Their hit sounds are sfx.ts's
 * (KindOfWeapon.hitSound, by the audio stream).
 */

/** How a thing in flight turns (MissileSprite.ANGULAR_SPEEDS): degrees a second, or 0 to point along its way. */
export interface Flight {
  spin: number;
  /** Shattered's missiles fly straight; other things thrown arc. */
  straight: boolean;
  /** How much faster than a thrown thing (arrows half as fast again, crossbow darts three times). */
  speed: number;
}

const POINTED: ReadonlySet<number> = new Set([
  S.DART, S.THROWING_KNIFE, S.THROWING_SPIKE, S.FISHING_SPEAR, S.THROWING_SPEAR, S.KUNAI, S.JAVELIN, S.TRIDENT, S.SPIRIT_ARROW,
  S.ROT_DART, S.INCENDIARY_DART, S.ADRENALINE_DART, S.HEALING_DART, S.CHILLING_DART, S.SHOCKING_DART, S.POISON_DART, S.CLEANSING_DART,
  S.PARALYTIC_DART, S.HOLY_DART, S.DISPLACING_DART, S.BLINDING_DART,
]);
const FAST_SPIN: Readonly<Record<number, number>> = { [S.BOOMERANG]: 1440, [S.BOLAS]: 1440, [S.SHURIKEN]: 2160 };
const MISSILE_SPRITES: ReadonlySet<number> = new Set([
  ...POINTED, S.BOOMERANG, S.BOLAS, S.SHURIKEN, S.THROWING_STONE, S.THROWING_CLUB, S.TOMAHAWK, S.THROWING_HAMMER, S.FORCE_CUBE,
]);

/** MissileSprite for a sprite: how it turns, whether it arcs, and how fast it goes. */
export function flightOf(sprite: number, crossbow = false): Flight {
  const missile = MISSILE_SPRITES.has(sprite);
  const pointed = POINTED.has(sprite);
  const speed = sprite === S.SPIRIT_ARROW ? 1.5 : crossbow && pointed ? 3 : 1;
  return { spin: pointed ? 0 : FAST_SPIN[sprite] ?? 720, straight: missile, speed };
}

/**
 * MissileSprite.reset's angle: the sprite (drawn pointing up and right) turned to point along its way; flipped when
 * it goes leftwards. Radians, clockwise on screen.
 */
export function flightAngle(dx: number, dy: number): { angle: number; flip: boolean } {
  let angle = 135 - (Math.atan2(dx, dy) / Math.PI) * 180;
  const flip = dx < 0;
  if (flip) angle += 90;
  return { angle: (angle * Math.PI) / 180, flip };
}

/** Enchantment.glowing and Glyph.glowing: Shattered's own colours, and how long a glow takes to swell (a second, if not said). */
const GLOWS: Readonly<Record<string, readonly [string, number?]>> = {
  blazing: ['#ff4400'], chilling: ['#00ffff'], kinetic: ['#ffff00'], shocking: ['#ffffff', 0.5], venomous: ['#4400aa'], blocking: ['#0000ff'],
  blooming: ['#008800'], eldritch: ['#222222'], elastic: ['#ff00ff'], lucky: ['#00ff00'], projecting: ['#8844cc'], unstable: ['#999999'],
  vorpal: ['#aa6666'], corrupting: ['#440066'], crystal: ['#0088ff'], grim: ['#000000'], vampiric: ['#660022'],
  obfuscation: ['#888888'], swiftness: ['#ffff00'], viscosity: ['#8844cc'], potential: ['#ffffff', 0.6], brimstone: ['#ff4400'],
  stone: ['#222222'], entanglement: ['#663300'], repulsion: ['#ffffff'], camouflage: ['#448822'], flow: ['#0000ff'], affection: ['#ff4488'],
  antiMagic: ['#88eeff'], thorns: ['#660022'],
};

/** ItemSprite.Glowing of an item: its enchantment's or glyph's colour (a curse once known, black), and the swell's period. */
export function glowOf(item: Item): { color: string; period: number } | null {
  const id: Enchantment | Glyph | undefined = item.enchant ?? item.glyph;
  if (!id) return null;
  const curse = item.enchant ? isCurseEnchant(item.enchant) : isCurseGlyph(item.glyph);
  if (curse && !cursedKnown(item)) return null;
  const [color, period] = curse ? (['#000000'] as const) : GLOWS[id] ?? ['#ffffff'];
  return { color, period: period ?? 1 };
}

/** ItemSprite.update: the glow swells up to six tenths and back, once a period each way. */
export function glowStrength(now: number, period: number): number {
  const phase = (now / 1000) % (2 * period);
  return (phase < period ? phase : 2 * period - phase) / period * 0.6;
}
