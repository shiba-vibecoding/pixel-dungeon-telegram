import type { Hero, HeroClass } from './actors';
import { CLASS_ABILITIES } from './abilities';
import { dispelInvisibility } from './artifacts';
import { type Ctx } from './floor';
import { regenOn } from './hero';
import { itemDef, type Item, type ItemKind } from './items';
import { armorChargeMultiplier } from './rings';
import type { SealSource } from './seal';
import { canTransferGlyph } from './seal';
import type { AbilityKind } from './talents';

/*
 * Class armour (ClassArmor and its kinds) and the Dwarf King's crown (KingsCrown). The crown turns the armour worn into
 * the hero's class armour, as protective as before (its level, augment, glyph, seal and curse kept), and gives it one
 * of the class's three armour abilities. Worn, the armour gathers charge, a hundred in five hundred turns, which the
 * ability spends (abilities/). The crown's magic can be moved to another armour later.
 */

export const CLASS_ARMOR_OF: Readonly<Record<HeroClass, ItemKind>> = {
  warrior: 'armor.warrior', mage: 'armor.mage', rogue: 'armor.rogue', huntress: 'armor.huntress', duelist: 'armor.duelist', cleric: 'armor.cleric',
};
export const CLASS_ARMOR: readonly ItemKind[] = Object.values(CLASS_ARMOR_OF);

/** KingsCrown.upgradeArmor takes a turn (Actor.TICK); so does ClassArmor's transfer. */
export const TIME_TO_CROWN = 1;
export const TIME_TO_TRANSFER = 1;

/** ClassArmor.charge: a new class armour starts half full, and holds a hundred. */
export const START_CHARGE = 50;
export const MAX_CHARGE = 100;
/** ClassArmor.Charger: 100 over 500 turns. */
const CHARGE_PER_TURN = 100 / 500;

export const isClassArmor = (item: Item | null | undefined): boolean => item !== null && item !== undefined && CLASS_ARMOR.includes(item.kind);

/**
 * ClassArmor.upgrade: the armour becomes the class armour, with its level, tier (here, the base kind), augment, glyph,
 * seal, curse and potions' work; what the old armour showed of itself is shown still, the curse known.
 */
export function makeClassArmor(hero: Hero, armor: Item): Item {
  const made: Item = { ...armor, kind: CLASS_ARMOR_OF[hero.heroClass], base: armor.base ?? armor.kind, charge: START_CHARGE };
  delete made.curseUnknown;
  // Its level stays unknown if it was; identification by use starts over.
  delete made.usesLeftToID;
  delete made.availableUsesToID;
  return made;
}

/** The three abilities the crown offers (HeroClass.armorAbilities). */
export const abilitiesOf = (heroClass: HeroClass): readonly AbilityKind[] => CLASS_ABILITIES[heroClass];

/** Why the crown cannot be used as asked (KingsCrown.execute and WndChooseAbility): a choice of the class's three, or a random one (3). */
export function crownProblem(choice: number | undefined): string | null {
  return choice !== undefined && Number.isInteger(choice) && choice >= 0 && choice <= 3 ? null : 'choose an ability';
}

/**
 * KingsCrown.upgradeArmor: the crown is used up, and the armour worn is class armour with the ability chosen (or, `choice` 3,
 * one of the three at random, as the crown's shuffle button does).
 */
export function useCrown(ctx: Ctx, hero: Hero, index: number, choice: number): void {
  const abilities = abilitiesOf(hero.heroClass);
  const ability = choice >= abilities.length ? ctx.rng.oneOf(abilities) : abilities[choice]!;
  hero.items.splice(index, 1);
  hero.armor = makeClassArmor(hero, hero.armor);
  hero.ability = ability;
  ctx.effects.push({ type: 'classArmor', hero: hero.id, item: hero.armor, ability });
  dispelInvisibility(ctx, hero);
}

/**
 * ClassArmor.Charger.act, a turn's worth: worn class armour gathers charge (more with rings of energy), unless a sealed floor's
 * time for passive effects has run out.
 */
export function chargeClassArmor(ctx: Ctx, hero: Hero): void {
  const armor = hero.armor;
  if (!isClassArmor(armor) || !regenOn(ctx.world, hero)) return;
  armor.charge = Math.min(MAX_CHARGE, (armor.charge ?? 0) + CHARGE_PER_TURN * armorChargeMultiplier(hero));
}

/** The armour as the class armour can take it over: any armour that is not class armour itself, from the pack. */
const armorAt = (hero: Hero, ref: unknown): Item | undefined => {
  const item = ref === 'armor' ? hero.armor : Number.isInteger(ref) ? hero.items[ref as number] : undefined;
  return item && itemDef(item.kind).category === 'armor' ? item : undefined;
};

/** Why the class armour (`to`) cannot take over another armour's properties (`from`), or null (ClassArmor.AC_TRANSFER). */
export function transferProblem(hero: Hero, to: SealSource, from: SealSource): string | null {
  const classArmor = armorAt(hero, to);
  const source = armorAt(hero, from);
  if (!classArmor || !isClassArmor(classArmor)) return 'that is no class armour';
  if (!source) return 'choose an armour';
  // ClassArmor.AC_TRANSFER selects armour of any kind but itself; a worn armour cannot be given up here (nothing is worn then).
  if (source === classArmor || isClassArmor(source)) return 'choose an armour';
  if (from === 'armor') return 'take that armour off first';
  return null;
}

/**
 * ClassArmor.execute(AC_TRANSFER): the class armour takes the other armour's level, tier, augment, curse, glyph and seal
 * (the other is destroyed); a seal it carried upgrades it again and keeps its own glyph if it can carry one.
 */
export function transferArmor(ctx: Ctx, hero: Hero, to: SealSource, from: SealSource): void {
  const classArmor = armorAt(hero, to)!;
  const source = armorAt(hero, from)!;
  hero.items.splice(hero.items.indexOf(source), 1);
  classArmor.level = source.level;
  classArmor.base = source.base ?? source.kind;
  if (source.augment) classArmor.augment = source.augment;
  else delete classArmor.augment;
  if (source.cursed) classArmor.cursed = true;
  else delete classArmor.cursed;
  if (source.infused) classArmor.infused = true;
  else delete classArmor.infused;
  if (source.mastery) classArmor.mastery = true;
  else delete classArmor.mastery;
  if (source.seal) {
    classArmor.glyph = source.glyph;
    classArmor.seal = source.seal;
  } else if (classArmor.seal) {
    // Automates detaching the seal and affixing it to the new armour: its upgrade comes with it, and it keeps its own glyph if it can carry one.
    if (classArmor.seal.level > 0) classArmor.level++;
    if (!source.glyph && canTransferGlyph(hero)) {
      // Keeps the glyph it has.
    } else {
      classArmor.glyph = source.glyph;
    }
  } else {
    classArmor.glyph = source.glyph;
  }
  if (!source.glyph && !classArmor.glyph) delete classArmor.glyph;
  if (source.levelUnknown) classArmor.levelUnknown = true;
  else delete classArmor.levelUnknown;
  delete classArmor.curseUnknown;
  ctx.effects.push({ type: 'classArmorMoved', hero: hero.id, item: classArmor });
}
