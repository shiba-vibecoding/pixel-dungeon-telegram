import type { Hero } from './actors';
import type { Ctx } from './floor';
import { itemDef, type Item } from './items';

/*
 * Wear (Item.use, Item.durability): an upgraded weapon, armour, wand, ring or
 * boomerang wears with use, and once worn out it is "broken": it works as if
 * it had never been upgraded (a ring as +1) until it is mended. A scroll of
 * upgrade read on a broken item only mends it; a scroll of enchantment, the
 * weightstone, the blacksmith and any change of level mend it as well. The
 * tempering enchantment and the auto-repair glyph mend a little with every
 * blow, which keeps their item from wearing at all.
 *
 * Kept as the durability left, absent while whole.
 */

/** Item.maxDurability: how many uses an item has in it at its level. */
export function maxDurability(item: Item): number {
  const left = (factor: number): number => factor * (item.level < 16 ? 16 - item.level : 1);
  if (item.kind === 'missile.boomerang') return left(8);
  switch (itemDef(item.kind).category) {
    case 'weapon':
      return left(5);
    case 'armor':
      return left(6);
    case 'wand':
      return left(6);
    // Shattered's rings never wear out.
    case 'ring':
      return Infinity;
    default:
      return Infinity;
  }
}

export const durabilityOf = (item: Item): number => item.durability ?? maxDurability(item);

export const isBroken = (item: Item): boolean => durabilityOf(item) <= 0;

/** Item.effectiveLevel: a broken item works as a plain one (Ring.effectiveLevel: a broken ring as +1). */
export function effectiveLevel(item: Item): number {
  // CurseInfusion's curseInfusionBonus: a level more while the curse lasts.
  if (!isBroken(item)) return item.level + (item.infused && item.cursed ? 1 : 0);
  return itemDef(item.kind).category === 'ring' ? 1 : 0;
}

/** Item.fix: whole again. */
export function mend(item: Item): void {
  delete item.durability;
}

/** Item.polish: a use's worth of wear undone. */
export function polish(item: Item): void {
  if (item.durability === undefined) return;
  item.durability += 1;
  if (item.durability >= maxDurability(item)) delete item.durability;
}

/** The share of durability below which its bearer is warned (Item.DURABILITY_WARNING_LEVEL). */
const WARNING_LEVEL = 1 / 6;

/**
 * Item.use: one use (or `amount`, for a ring's turns) wears an upgraded item.
 * Its bearer hears when it is about to break, and when it breaks, if they know
 * its level (Item.levelKnown); otherwise it breaks unnoticed.
 */
export function wear(ctx: Ctx, hero: Hero, item: Item, amount = 1): void {
  if (item.level <= 0 || isBroken(item)) return;
  const max = maxDurability(item);
  if (!Number.isFinite(max)) return;
  const threshold = Math.trunc(max * WARNING_LEVEL);
  const before = durabilityOf(item);
  const after = before - amount;
  item.durability = after;
  if (after <= 0) item.durability = 0;
  if (item.levelUnknown) return;
  if (after <= 0) {
    ctx.effects.push({ type: 'worn', hero: hero.id, item, state: 'broken' });
  } else if (before >= threshold && threshold > after) {
    ctx.effects.push({ type: 'worn', hero: hero.id, item, state: 'warning' });
  }
}
