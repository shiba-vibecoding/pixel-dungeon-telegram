import {
  armorStats, chargesKnown, durabilityOf, isBroken, kindKnown, levelKnown, maxDurability, CLASS_ARMOR, CLASS_ARMOR_OF, type Hero, type HeroClass,
  type Item, itemDef, type ItemKind, itemSprite, magicMissileDamage, missileStats, SCROLL_RUNES, visiblyCursed, wandMaxCharges, weaponStats,
  type World, isExotic, labelOf, TRINKETS, RAT_SKULL, PARCHMENT_SCRAP, PETRIFIED_SEED, EXOTIC_CRYSTALS,
  MOSSY_CLUMP, SUNDIAL, CLOVER, TRAP_MECHANISM, MIMIC_TOOTH, WONDROUS_RESIN, EYE_OF_NEWT, SALT_CUBE, VIAL_OF_BLOOD, CHAOTIC_CENSER,
  FERRET_TUFT, SPYGLASS,
} from '@pd/core';
import { fill, t } from './i18n';

/*
 * How items are called and described, given what the party knows: the kinds
 * it has learned, and what is known of each item (its level, its curse, a
 * wand's charges; see the core's ident.ts).
 */

const CLASS_OF = Object.fromEntries(Object.entries(CLASS_ARMOR_OF).map(([cls, kind]) => [kind, cls])) as Partial<Record<ItemKind, HeroClass>>;

/** Whether the party knows what kind of thing it is (unknown potions, scrolls, wands and rings go by their looks). */
export const isKnown = (world: World, item: Item): boolean => kindKnown(world, item);

export function itemName(world: World, item: Item): string {
  const category = itemDef(item.kind).category;
  if (category === 'gold') return `${item.qty} ${t.goldShort}`;
  if (category === 'vial') return `${t.items[item.kind]} (${item.volume ?? 0}/10)`;
  if (!isKnown(world, item)) {
    const label = labelOf(item.kind, world.run.labels);
    // Wand.name and Ring.name go by the wood or the gem; Item.toString adds a known level all the same.
    if (category === 'wand') return levelled(t.unknownWand(t.woods[label]!), item);
    if (category === 'ring') return levelled(t.unknownRing(t.gems[label]!), item);
    // ExoticPotion and ExoticScroll: the colour or rune of their ordinary counterpart, as something exotic.
    const exotic = isExotic(item.kind);
    return category === 'potion' ? `${exotic ? t.alch.exoticPotionPrefix : ''}${t.unknownPotion(t.colors[label]!)}`
      : `${exotic ? t.alch.exoticScrollPrefix : ''}${t.unknownScroll(SCROLL_RUNES[label]!)}`;
  }
  // Blandfruit.name: cooked with a seed, the fruit of that potion.
  if (item.kind === 'food.blandfruit' && item.potion) return FRUIT[item.potion] ? t.alch[FRUIT[item.potion]!] : t.alch.cooked;
  let name = t.items[item.kind];
  // Trinket.toString: its level, like any levelled item's.
  if (category === 'trinket') return levelled(name, item);
  // Weapon.name and Armor.name: the enchantment or glyph is part of the name.
  if (item.enchant) name = t.enchantName(name, item.enchant, item.kind);
  if (item.glyph) name = t.glyphName(name, item.glyph);
  if (category === 'weapon' || category === 'armor' || category === 'wand' || category === 'ring' || item.kind === 'missile.boomerang') {
    // Weapon.toString: a worn-out item says so, once its level is known (Item.visiblyBroken).
    if (isBroken(item) && levelKnown(item)) name = t.brokenName(name, item.kind);
    return levelled(name, item);
  }
  return name;
}

/** Blandfruit.name: the fruit a potion's seed makes of it. */
const FRUIT: Partial<Record<ItemKind, `fruit_${string}` & keyof typeof t.alch>> = {
  'potion.healing': 'fruit_sunfruit', 'potion.strength': 'fruit_rotfruit', 'potion.paralyticGas': 'fruit_earthfruit',
  'potion.invisibility': 'fruit_blindfruit', 'potion.liquidFlame': 'fruit_firefruit', 'potion.frost': 'fruit_icefruit',
  'potion.mindVision': 'fruit_fadefruit', 'potion.toxicGas': 'fruit_sorrowfruit', 'potion.levitation': 'fruit_stormfruit',
  'potion.purity': 'fruit_dreamfruit', 'potion.experience': 'fruit_starfruit', 'potion.haste': 'fruit_swiftfruit',
};

/** Messages.decimalFormat("#.##"). */
const decimal = (n: number): string => String(Math.round(n * 100) / 100);

/** Each trinket's statsDesc, at its level (they are always known here). */
function trinketStats(hero: Hero, item: Item): string {
  const level = Math.max(0, item.level);
  const key = item.kind.slice('trinket.'.length);
  const template = (t.alch as Record<string, string>)[`${key}_stats_desc`];
  if (!template) return '';
  switch (item.kind) {
    case 'trinket.ratSkull': return fill(template, Math.trunc(RAT_SKULL.exoticChanceMultiplier(level)));
    case 'trinket.parchmentScrap': return fill(template, Math.trunc(PARCHMENT_SCRAP.enchantChanceMultiplier(level)), decimal(PARCHMENT_SCRAP.curseChanceMultiplier(level)));
    case 'trinket.petrifiedSeed': return fill(template, decimal(100 * PETRIFIED_SEED.stoneInsteadOfSeedChance(level)), decimal(100 * (PETRIFIED_SEED.grassLootMultiplier(level) - 1)));
    case 'trinket.exoticCrystals': return fill(template, decimal(100 * EXOTIC_CRYSTALS.consumableExoticChance(level)));
    case 'trinket.mossyClump': return fill(template, Math.trunc(100 * MOSSY_CLUMP.overrideNormalLevelChance(level)));
    case 'trinket.sundial': return fill(template, Math.trunc(100 * (1 - SUNDIAL.enemySpawnMultiplierDaytime(level))), Math.trunc(100 * (SUNDIAL.enemySpawnMultiplierNighttime(level) - 1)));
    case 'trinket.clover': return fill(template, Math.round(0.6 * 100 * CLOVER.alterHeroDamageChance(level)), Math.round(0.4 * 100 * CLOVER.alterHeroDamageChance(level)));
    case 'trinket.trapMechanism': return fill(template, Math.trunc(100 * TRAP_MECHANISM.overrideNormalLevelChance(level)), Math.trunc(100 * TRAP_MECHANISM.revealHiddenTrapChance(level)));
    case 'trinket.mimicTooth': return fill(template, decimal(MIMIC_TOOTH.mimicChanceMultiplier(level)), decimal(100 * MIMIC_TOOTH.ebonyMimicChance(level)));
    case 'trinket.wondrousResin': return fill(template, decimal(100 * WONDROUS_RESIN.positiveCurseEffectChance(level)), decimal(100 * WONDROUS_RESIN.extraCurseEffectChance(level)));
    case 'trinket.eyeOfNewt': return fill(template, decimal(100 * (1 - EYE_OF_NEWT.visionRangeMultiplier(level))), EYE_OF_NEWT.mindVisionRange(level));
    case 'trinket.saltCube': return fill(template, decimal(100 * (1 / SALT_CUBE.hungerGainMultiplier(level) - 1)), decimal(100 * (1 - SALT_CUBE.healthRegenMultiplier(level))));
    case 'trinket.vialOfBlood': return fill(template, decimal(100 * (VIAL_OF_BLOOD.totalHealMultiplier(level) - 1)), String(VIAL_OF_BLOOD.maxHealPerTurn(hero.ht, level)));
    case 'trinket.shardOfOblivion': return fill(template, level + 1);
    case 'trinket.chaoticCenser': return fill(template, CHAOTIC_CENSER.averageTurnsUntilGas(level));
    case 'trinket.ferretTuft': return fill(template, decimal(100 * (FERRET_TUFT.evasionMultiplier(level) - 1)));
    case 'trinket.spyglass':
      return level >= 2 ? fill(t.alch.spyglass_stats_desc_upgraded, decimal(100 * (SPYGLASS.extraLootChance(level) - 1))) : fill(template, decimal(100 * SPYGLASS.extraLootChance(level)));
    default: return '';
  }
}

/** Item.toString: the level after the name, once it is known and not plain. */
const levelled = (name: string, item: Item): string =>
  item.level === 0 || !levelKnown(item) ? name : `${name} ${item.level > 0 ? '+' : ''}${item.level}`;

/** Wand.status: charges left of the most, once the wand's level is known, with «?» while the charges left are not; null otherwise. */
export function chargesOf(item: Item): string | null {
  if (item.charges === undefined || !levelKnown(item)) return null;
  return `${chargesKnown(item) ? item.charges : '?'}/${wandMaxCharges(item)}`;
}

/** The item as it would be plain and whole: what is typical of its kind (MeleeWeapon.typicalSTR, Armor.typicalDR). */
const typical = (item: Item): Item => ({ ...item, level: 0, durability: undefined, glyph: undefined });

/** ItemSlot's top right: the strength a weapon or armour wants, or the typical one while its level is unknown; null for the rest. */
export function strengthOf(item: Item): { str: number; known: boolean } | null {
  const category = itemDef(item.kind).category;
  if (category !== 'weapon' && category !== 'armor') return null;
  const known = levelKnown(item);
  return { str: (category === 'weapon' ? weaponStats(known ? item : typical(item)) : armorStats(known ? item : typical(item))).str, known };
}

/** How worn an upgraded item is, once its level is known (WndBag's durability bars); null for items that do not wear. */
export function wearOf(_world: World, item: Item): { left: number; max: number } | null {
  if (item.level <= 0 || !levelKnown(item)) return null;
  const max = maxDurability(item);
  return Number.isFinite(max) ? { left: Math.max(0, Math.ceil(durabilityOf(item))), max } : null;
}

/** The name without its «broken» and its level, for a window's title that shows the level struck through. */
export function plainName(world: World, item: Item): string {
  return itemName(world, { ...item, level: 0, durability: undefined });
}

/** Weapon.info and Armor.info: how a stone of augmentation balanced it. */
function augmentInfo(augment: 'speed' | 'damage' | 'evasion' | 'defense'): string {
  return { speed: t.alch.augmentedSpeed, damage: t.alch.augmentedDamage, evasion: t.alch.augmentedEvasion, defense: t.alch.augmentedDefense }[augment];
}

export function itemInfo(world: World, hero: Hero, item: Item): string[] {
  const category = itemDef(item.kind).category;
  // MeleeWeapon.info and Armor.info: the numbers once the level is known, else what is typical of the kind
  // («probably» too heavy, if even that is); the curse once it is known.
  if (category === 'weapon') {
    const known = levelKnown(item);
    const stats = weaponStats(known ? item : typical(item));
    return [
      known ? t.weaponInfo(stats.min, stats.max, stats.str) : t.weaponTypicalInfo(stats.min, stats.max, stats.str),
      ...(item.enchant ? [t.enchantInfo[item.enchant]] : []),
      ...(item.augment ? [augmentInfo(item.augment)] : []),
      ...(item.kind === 'weapon.pickaxe' ? [t.pickaxeInfo(!!item.bloody)] : []),
      ...(visiblyCursed(item) ? [t.cursedInfo] : []),
      ...(stats.str > hero.str ? [known ? t.tooHeavy : t.probablyTooHeavy] : []),
    ];
  }
  if (category === 'armor') {
    const known = levelKnown(item);
    const stats = armorStats(known ? item : typical(item));
    return [
      known ? t.armorInfo(stats.dr, stats.str) : t.armorTypicalInfo(stats.dr, stats.str),
      ...(item.glyph ? [t.glyphInfo[item.glyph]] : []), ...(item.augment ? [augmentInfo(item.augment)] : []), ...(visiblyCursed(item) ? [t.cursedInfo] : []),
      ...(CLASS_ARMOR.includes(item.kind) ? [t.classArmorInfo[CLASS_OF[item.kind]!], t.specialCost] : []),
      ...(stats.str > hero.str ? [known ? t.tooHeavy : t.probablyTooHeavy] : []),
    ];
  }
  if (category === 'missile') {
    const stats = missileStats(item);
    return [t.itemInfo[item.kind] ?? '', t.missileInfo(stats.min, stats.max)];
  }
  if (category === 'wand') {
    const status = chargesOf(item);
    const charges = status === null ? [] : [t.charges(status)];
    if (!isKnown(world, item)) return [t.unknownWandInfo, ...charges];
    if (item.kind !== 'wand.magicMissile' || !levelKnown(item)) return [t.itemInfo[item.kind] ?? '', ...charges];
    const [min, max] = magicMissileDamage(item);
    return [t.itemInfo[item.kind] ?? '', t.wandDamage(min, max), ...charges];
  }
  if (category === 'ring') {
    // Ring.info: the curse once it is known, whether or not the gem is.
    const cursed = visiblyCursed(item) ? [t.cursedInfo] : [];
    if (!isKnown(world, item)) return [t.unknownRingInfo, ...cursed];
    return [t.itemInfo[item.kind] ?? '', ...(item.level < 0 && levelKnown(item) ? [t.ringNegative] : []), ...cursed];
  }
  if (category === 'key') {
    if (item.kind === 'key.skeleton') return [t.skeletonKeyInfo];
    return [item.kind === 'key.golden' ? t.goldenKeyInfo(item.depth ?? 0) : t.keyInfo(item.depth ?? 0)];
  }
  if (category === 'gold') return [];
  if (category === 'trinket') {
    // Trinket.info: what it is, then what it does at its level; the catalyst says what it can become.
    return [t.itemInfo[item.kind] ?? '', TRINKETS.includes(item.kind) ? trinketStats(hero, item) : ''];
  }
  if (category === 'bomb') {
    // Bomb.desc: the plain bomb's damage at this depth; each a word on its fuse.
    const depth = Math.max(1, hero.depth);
    const desc = item.kind === 'bomb' ? fill(t.alch.bombDesc, 4 + depth, 12 + 3 * depth) : (t.itemInfo[item.kind] ?? '');
    return [desc, item.fuse !== undefined ? t.alch.bombBurning : t.alch.bombFuse];
  }
  // ElixirOfMight.desc: HTBoost.boost of the hero's health as it is.
  if (item.kind === 'elixir.might') return [fill(t.alch.mightDesc, Math.round(4 + hero.ht / 20))];
  if (item.kind === 'food.blandfruit' && item.potion) {
    // Blandfruit.desc: cooked, it does what its potion does; the harmful ones are better thrown.
    const thrown = ['potion.frost', 'potion.liquidFlame', 'potion.toxicGas', 'potion.paralyticGas'].includes(item.potion);
    return [t.alch.fruitCooked, thrown ? t.alch.fruitThrow : t.alch.fruitEat];
  }
  if ((category === 'potion' || category === 'scroll') && isExotic(item.kind) && !isKnown(world, item)) {
    return [category === 'potion' ? t.alch.exoticPotionUnknown : t.alch.exoticScrollUnknown];
  }
  if (category === 'beacon') return [t.itemInfo[item.kind] ?? '', ...(item.returnTo ? [t.beaconSetAt(item.returnTo.depth)] : [])];
  return [isKnown(world, item) ? (t.itemInfo[item.kind] ?? '') : t.unknownInfo];
}

/** Top-left corner of an item's sprite in items.png (Shattered's, 16 a row). */
export function spriteOffset(world: World, item: Item): [number, number] {
  const index = itemSprite(item, world.run.labels);
  return [(index % 16) * 16, Math.floor(index / 16) * 16];
}
