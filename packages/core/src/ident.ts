import { type Hero, heroBelongings, heroEquipped, heroRings } from './actors';
import type { Ctx } from './floor';
import { itemDef, type Item, type ItemKind, knownIn, labelKind } from './items';
import type { World } from './world';

/*
 * Identification (Item.levelKnown and cursedKnown, Wand.curChargeKnown): a
 * melee weapon, armour, ring or wand as found tells neither its level nor
 * whether it is cursed, and a wand not how many charges it has left. Putting
 * it on tells the curse (a cursed thing binds itself at once); striking with a
 * weapon or being struck in armour as experience comes (Shattered's numbers),
 * wearing a ring for a level's worth of experience, or zapping a wand often
 * enough tells the rest; a scroll of identify, a well of awareness and the end of the
 * run tell everything. Potions, scrolls and rings also hide their kind, which
 * the party learns together (World.known); Shattered's wands are known by
 * their look, and only hide their level, curse and charges (Wand.isKnown).
 * Thrown weapons hide their level and curse as melee weapons do (known after
 * ten hits); darts, class armour and everything else hide nothing (Dart,
 * ClassArmor: levelKnown).
 *
 * Kept on the item as what is not known yet, absent once known; so an item
 * from before this was kept is known, and an item handed over keeps what its
 * bearer had learned of it.
 */

/**
 * Weapon.usesToID and Armor.USES_TO_ID: blows struck with a weapon, and taken in armour, to know
 * it through and through. Only half of them are ready at first; the rest come with experience
 * (onHeroGainExp), so an item is known after use and time together.
 */
export const WEAPON_USES_TO_ID = 20;
export const ARMOR_USES_TO_ID = 10;
/** MissileWeapon.usesToID: half of a melee weapon's. */
export const MISSILE_USES_TO_ID = 10;
/** Ring.levelsToID: a ring worn is known after a level's worth of experience. */
export const RING_LEVELS_TO_ID = 1;
/** Wand.USES_TO_ID: zaps before a wand is known through and through, of which half may be counted at first (availableUsesToID). */
export const WAND_USES_TO_ID = 10;

export const levelKnown = (item: Item): boolean => !item.levelUnknown;
export const cursedKnown = (item: Item): boolean => !item.curseUnknown;
/** Wand.curChargeKnown. */
export const chargesKnown = (item: Item): boolean => !item.chargesUnknown;

/** Item.visiblyCursed: cursed, and known to be. */
export const visiblyCursed = (item: Item): boolean => !!item.cursed && cursedKnown(item);

/** Potions, scrolls and rings hide their kind until the party learns it. */
const hidesKind = (item: Item): boolean => {
  const category = itemDef(item.kind).category;
  return category === 'potion' || category === 'scroll' || category === 'ring';
};

/** Potion, Scroll and Ring.isKnown: whether the party knows what kind of thing it is; the rest show it. */
export function kindKnown(world: World, item: Item): boolean {
  return !hidesKind(item) || knownIn(world.known, item.kind);
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

/** Item.identify (Potion, Scroll and Ring.identify: the kind too; Wand.identify: the charges too); true if the party learned the kind. */
export function identify(world: World, item: Item): boolean {
  delete item.levelUnknown;
  delete item.curseUnknown;
  delete item.chargesUnknown;
  delete item.familiarity;
  delete item.usesLeftToID;
  delete item.availableUsesToID;
  delete item.levelsToID;
  return hidesKind(item) && learn(world, item.kind);
}

/** As the Generator makes them (a new Item: levelKnown and cursedKnown false): a melee weapon, armour, ring or wand tells nothing yet. */
export function unidentified(item: Item): Item {
  const category = itemDef(item.kind).category;
  if (category !== 'weapon' && category !== 'armor' && category !== 'missile' && category !== 'ring' && category !== 'wand' && category !== 'artifact') return item;
  item.levelUnknown = true;
  item.curseUnknown = true;
  if (category === 'wand') item.chargesUnknown = true;
  return item;
}

/** Talent seam: Talent.itemIDSpeedFactor (Adventurer's and Veteran's Intuition), 1 until the talents stream. */
export const idSpeedFactor = (_hero: Hero, _item: Item): number => 1;

const f32 = Math.fround;
const usesToID = (item: Item): number => {
  const category = itemDef(item.kind).category;
  return category === 'armor' ? ARMOR_USES_TO_ID : category === 'missile' ? MISSILE_USES_TO_ID : WEAPON_USES_TO_ID;
};
const usesLeft = (item: Item): number => item.usesLeftToID ?? usesToID(item);
const usesAvailable = (item: Item): number => item.availableUsesToID ?? usesToID(item) / 2;

/**
 * Weapon.proc and Armor.proc: every blow struck with a weapon, or taken in armour, uses up one of
 * the uses ready towards knowing it; the last one makes it known (Weapon.identify: "You are now
 * familiar enough with your weapon to identify it").
 */
export function familiarise(ctx: Ctx, hero: Hero, item: Item): void {
  if (levelKnown(item)) return;
  const uses = Math.min(usesAvailable(item), idSpeedFactor(hero, item));
  item.availableUsesToID = f32(usesAvailable(item) - uses);
  item.usesLeftToID = f32(usesLeft(item) - uses);
  if (item.usesLeftToID > 0) return;
  identify(ctx.world, item);
  ctx.effects.push({ type: 'familiar', hero: hero.id, item, learned: false });
}

/**
 * Item.onHeroGainExp, for everything the hero has: experience (as a share of the level) readies
 * more uses towards knowing the weapon in hand and the armour worn, enough over half a level
 * (Weapon and Armor.onHeroGainExp; thrown weapons in the pack too); a ring worn a level's worth is known
 * (Ring.onHeroGainExp).
 */
export function heroGainsExp(ctx: Ctx, hero: Hero, percent: number): void {
  const missiles = hero.items.filter((item) => itemDef(item.kind).category === 'missile');
  for (const item of [hero.weapon, hero.armor, ...missiles]) {
    if (!item || levelKnown(item)) continue;
    const half = usesToID(item) / 2;
    const factor = f32(percent * idSpeedFactor(hero, item));
    if (usesAvailable(item) <= half) item.availableUsesToID = Math.min(half, f32(usesAvailable(item) + f32(factor * usesToID(item))));
  }
  for (const ring of heroRings(hero)) {
    if (isIdentified(ctx.world, ring)) continue;
    ring.levelsToID = f32((ring.levelsToID ?? RING_LEVELS_TO_ID) - f32(percent * idSpeedFactor(hero, ring)));
    if (ring.levelsToID > 0) continue;
    const learned = identify(ctx.world, ring);
    ctx.effects.push({ type: 'familiar', hero: hero.id, item: ring, learned });
  }
}

/** Belongings.identify: everything a hero carries and wears is known (Dungeon.win, Hero.die). */
export function identifyBelongings(world: World, hero: Hero): void {
  for (const item of heroBelongings(hero)) identify(world, item);
}

/**
 * Belongings.observe (WaterOfAwareness): what the hero wears is known through
 * and through, and the curses of all that is carried. The kinds the party
 * learned that way.
 */
export function observeBelongings(world: World, hero: Hero): ItemKind[] {
  const learned: ItemKind[] = [];
  for (const item of heroEquipped(hero)) {
    if (identify(world, item)) learned.push(item.kind);
  }
  for (const item of hero.items) delete item.curseUnknown;
  return learned;
}
