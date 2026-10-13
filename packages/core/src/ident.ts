import type { Hero } from './actors';
import type { Ctx } from './floor';
import { itemDef, type Item, type ItemKind, knownIn, labelKind } from './items';
import type { World } from './world';

/*
 * Identification (Item.levelKnown and cursedKnown, Wand.curChargeKnown): a
 * melee weapon, armour, ring or wand as found tells neither its level nor
 * whether it is cursed, and a wand not how many charges it has left. Putting
 * it on tells the curse (a cursed thing binds itself at once); striking with a
 * weapon, being struck in armour, zapping a wand or wearing a ring long enough
 * tells the rest; a scroll of identify, a well of awareness and the end of the
 * run tell everything. Potions, scrolls, wands and rings also hide their kind,
 * which the party learns together (World.known). Thrown weapons, class armour
 * and everything else hide nothing (MissileWeapon, ClassArmor: levelKnown).
 *
 * Kept on the item as what is not known yet, absent once known; so an item
 * from before this was kept is known, and an item handed over keeps what its
 * bearer had learned of it.
 */

/** Weapon.HITS_TO_KNOW and Armor.HITS_TO_KNOW: blows struck, and blows taken, before the level is known. */
export const WEAPON_HITS_TO_KNOW = 20;
export const ARMOR_HITS_TO_KNOW = 10;
/** Wand.USAGES_TO_KNOW: zaps before a wand is known through and through. */
export const WAND_USAGES_TO_KNOW = 40;

export const levelKnown = (item: Item): boolean => !item.levelUnknown;
export const cursedKnown = (item: Item): boolean => !item.curseUnknown;
/** Wand.curChargeKnown. */
export const chargesKnown = (item: Item): boolean => !item.chargesUnknown;

/** Item.visiblyCursed: cursed, and known to be. */
export const visiblyCursed = (item: Item): boolean => !!item.cursed && cursedKnown(item);

/** Potion, Scroll, Ring and Wand.isKnown: whether the party knows what kind of thing it is; the rest show it. */
export function kindKnown(world: World, item: Item): boolean {
  const category = itemDef(item.kind).category;
  const hides = category === 'potion' || category === 'scroll' || category === 'wand' || category === 'ring';
  return !hides || knownIn(world.known, item.kind);
}

/** Item.isIdentified (and Ring.isIdentified, Wand.isIdentified): nothing more to learn about it. */
export function isIdentified(world: World, item: Item): boolean {
  return kindKnown(world, item) && levelKnown(item) && cursedKnown(item) && chargesKnown(item);
}

/** ItemStatusHandler.know: the party learns a kind; true if it did not know it yet. */
export function learn(world: World, kind: ItemKind): boolean {
  // ExoticPotion.setKnown and ExoticScroll.setKnown: knowing an exotic is knowing its counterpart.
  kind = labelKind(kind);
  if (world.known.includes(kind)) return false;
  world.known.push(kind);
  return true;
}

/** Item.identify (Potion, Scroll, Ring and Wand.identify: the kind too); true if the party learned the kind. */
export function identify(world: World, item: Item): boolean {
  delete item.levelUnknown;
  delete item.curseUnknown;
  delete item.chargesUnknown;
  delete item.familiarity;
  const category = itemDef(item.kind).category;
  const hides = category === 'potion' || category === 'scroll' || category === 'wand' || category === 'ring';
  return hides && learn(world, item.kind);
}

/** As the Generator makes them (a new Item: levelKnown and cursedKnown false): a melee weapon, armour, ring or wand tells nothing yet. */
export function unidentified(item: Item): Item {
  const category = itemDef(item.kind).category;
  if (category !== 'weapon' && category !== 'armor' && category !== 'ring' && category !== 'wand') return item;
  item.levelUnknown = true;
  item.curseUnknown = true;
  if (category === 'wand') item.chargesUnknown = true;
  return item;
}

/**
 * Weapon.proc and Armor.proc: every blow struck with a weapon, or taken in
 * armour, makes its bearer more familiar with it, and after `hitsToKnow` of
 * them its level is known.
 */
export function familiarise(ctx: Ctx, hero: Hero, item: Item, hitsToKnow: number): void {
  if (levelKnown(item)) return;
  item.familiarity = (item.familiarity ?? 0) + 1;
  if (item.familiarity < hitsToKnow) return;
  delete item.levelUnknown;
  delete item.familiarity;
  ctx.effects.push({ type: 'familiar', hero: hero.id, item, learned: false });
}

/** Belongings.identify: everything a hero carries and wears is known (Dungeon.win, Hero.die). */
export function identifyBelongings(world: World, hero: Hero): void {
  for (const item of [hero.weapon, hero.armor, ...hero.rings, ...hero.items]) {
    if (item) identify(world, item);
  }
}

/**
 * Belongings.observe (WaterOfAwareness): what the hero wears is known through
 * and through, and the curses of all that is carried. The kinds the party
 * learned that way.
 */
export function observeBelongings(world: World, hero: Hero): ItemKind[] {
  const learned: ItemKind[] = [];
  for (const item of [hero.weapon, hero.armor, ...hero.rings]) {
    if (item && identify(world, item)) learned.push(item.kind);
  }
  for (const item of hero.items) delete item.curseUnknown;
  return learned;
}
