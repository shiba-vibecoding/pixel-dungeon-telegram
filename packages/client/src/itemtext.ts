import {
  armorStats, augmentDamage, bowMax, bowMin, bowStr, buffedLevel, chargeLimit, chargesKnown, chargesPerCast, cursedKnown, durabilityOf, isBroken,
  isCurseEnchant, isCurseGlyph, isIdentified, isTippedDart, kindKnown, levelKnown, maxCharges, maxDurability, CLASS_ARMOR, CLASS_ARMOR_OF, type Hero,
  type HeroClass, type Item, itemDef, type ItemKind, itemSprite, missileStats, SCROLL_RUNES, sealShield, sharpshootingBonus, sharpshootingDurability, usesLeft,
  visiblyCursed, visiblyUpgraded,
  wandDamage, WATERSKIN_VOLUME, weaponStats, type World,
  isExotic, labelOf, TRINKETS, RAT_SKULL, PARCHMENT_SCRAP, PETRIFIED_SEED, EXOTIC_CRYSTALS,
  MOSSY_CLUMP, SUNDIAL, CLOVER, TRAP_MECHANISM, MIMIC_TOOTH, WONDROUS_RESIN, EYE_OF_NEWT, SALT_CUBE, VIAL_OF_BLOOD, CHAOTIC_CENSER,
  FERRET_TUFT, SPYGLASS,
} from '@pd/core';
import { lt, plain } from './levelnames';
import { fill, fmt, t } from './i18n';
import { artifactInfo, artifactName, artText } from './artifacttext';
import { abilityShort, chargeText } from './abilitytext';

/*
 * How items are called and described, given what the party knows: the kinds
 * it has learned, and what is known of each item (its level, its curse, a
 * wand's charges; see the core's ident.ts).
 */

const CLASS_OF = Object.fromEntries(Object.entries(CLASS_ARMOR_OF).map(([cls, kind]) => [kind, cls])) as Partial<Record<ItemKind, HeroClass>>;

/** Whether the party knows what kind of thing it is (unknown potions, scrolls and rings go by their looks). */
export const isKnown = (world: World, item: Item): boolean => kindKnown(world, item);

export function itemName(world: World, item: Item): string {
  const category = itemDef(item.kind).category;
  if (category === 'gold') return `${item.qty} ${t.goldShort}`;
  if (category === 'vial') return `${t.items[item.kind]} (${item.volume ?? 0}/${WATERSKIN_VOLUME})`;
  // Artifact: its own name (the sandals' grows), and the level shown +0 to +10 (visiblyUpgraded).
  if (category === 'artifact') {
    const level = visiblyUpgraded(item);
    return level === 0 ? artifactName(item) : `${artifactName(item)} +${level}`;
  }
  if (!isKnown(world, item)) {
    const label = labelOf(item.kind, world.run.labels);
    // Ring.name goes by the gem; Item.toString adds a known level all the same.
    if (category === 'ring') return levelled(t.unknownRing(t.gems[label]!), item);
    // ExoticPotion and ExoticScroll: the colour or rune of their ordinary counterpart, as something exotic.
    const exotic = isExotic(item.kind);
    return category === 'potion' ? `${exotic ? t.alch.exoticPotionPrefix : ''}${t.unknownPotion(t.colors[label]!)}`
      : `${exotic ? t.alch.exoticScrollPrefix : ''}${t.unknownScroll(SCROLL_RUNES[label]!)}`;
  }
  // Blandfruit.name: cooked with a seed, the fruit of that potion.
  if (item.kind === 'food.blandfruit' && item.potion) return FRUIT[item.potion] ? t.alch[FRUIT[item.potion]!] : t.alch.cooked;
  // MagesStaff.name: the staff of its wand.
  let name = item.kind === 'weapon.magesStaff' && item.wand ? t.staffNames[item.wand.kind] ?? t.items[item.kind] : t.items[item.kind];
  // Trinket.toString: its level, like any levelled item's.
  if (category === 'trinket') return levelled(name, item);
  // Weapon.name and Armor.name: the enchantment or glyph is part of the name (a curse once it is known).
  if (item.enchant && (cursedKnown(item) || !isCurseEnchant(item.enchant))) name = t.enchantName(name, item.enchant, item.kind);
  if (item.glyph && (cursedKnown(item) || !isCurseGlyph(item.glyph))) name = t.glyphName(name, item.glyph);
  if (category === 'weapon' || category === 'armor' || category === 'missile' || category === 'wand' || category === 'ring') {
    // Item.toString: a worn-out wand or ring says so, once its level is known (Item.visiblyBroken).
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

/**
 * Wand.status: charges left of the most, once the wand's level is known, with «?» while the charges left are not;
 * MagesStaff.status: its wand's; null otherwise.
 */
export function chargesOf(item: Item): string | null {
  if (item.kind === 'weapon.magesStaff') return item.wand ? `${item.wand.charges ?? 0}/${maxCharges(item.wand, item)}` : null;
  if (item.charges === undefined || !levelKnown(item)) return null;
  return `${chargesKnown(item) ? item.charges : '?'}/${maxCharges(item, null)}`;
}

/** Wand.statsDesc of each kind: what it does, with its numbers (as strong as it zaps, once its level is known; plain, until then). */
export function wandStats(hero: Hero, wand: Item, staff: Item | null): string {
  const known = staff !== null || levelKnown(wand);
  const level = known ? buffedLevel(hero, wand, staff) : 0;
  const cursed = staff ? !!staff.cursed : !!wand.cursed;
  const stats = t.wandStats[wand.kind];
  if (!stats) return '';
  switch (wand.kind) {
    case 'wand.fireblast': {
      const charges = chargesPerCast(wand, cursed);
      const [min, max] = wandDamage(wand.kind, level, charges)!;
      return stats(charges, min, max);
    }
    case 'wand.corrosion':
      return stats(2 + level);
    case 'wand.warding':
      return stats(2 + (known ? (staff ?? wand).level : 0));
    case 'wand.transfusion': {
      const self = Math.round(hero.ht * 0.05);
      const [min, max] = wandDamage(wand.kind, level)!;
      return stats(self, self + 3 * level, 5 + level, min, max);
    }
    case 'wand.corruption':
      return stats();
    case 'wand.regrowth': {
      const text = stats(chargesPerCast(wand, cursed));
      // The charges it may still spend before its growth fails (once it is known through and through).
      const left = chargeLimit(hero.lvl, (staff ?? wand).level) - (wand.grown ?? 0);
      return (staff !== null || (levelKnown(wand) && chargesKnown(wand))) && left < 10000 ? `${text} ${t.regrowthLimit(Math.max(left, 0))}` : text;
    }
    default: {
      const [min, max] = wandDamage(wand.kind, level)!;
      return stats(min, max);
    }
  }
}

/** The item as it would be plain and whole: what is typical of its kind (MeleeWeapon.info's min(0), max(0), STRReq(0)). */
const typical = (item: Item): Item => ({ ...item, level: 0, durability: undefined, glyph: undefined, augment: undefined });

/** The strength a weapon, armour or thrown weapon wants (the spirit bow at its bearer's level). */
function strengthFor(item: Item, hero?: Hero): number | null {
  const category = itemDef(item.kind).category;
  if (category === 'weapon') return weaponStats(item).str;
  if (category === 'armor') return armorStats(item).str;
  if (category === 'missile') return missileStats(item).str;
  if (category === 'bow' && hero) return bowStr(hero.lvl, item);
  return null;
}

/** ItemSlot's top right: the strength it wants, or the typical one while its level is unknown; null for the rest. */
export function strengthOf(item: Item, hero?: Hero): { str: number; known: boolean } | null {
  const known = levelKnown(item);
  const str = strengthFor(known ? item : typical(item), hero);
  return str === null ? null : { str, known };
}

/**
 * How worn an item is, once its level is known: an upgraded wand's or ring's wear (WndBag's durability bars), or what
 * is left of a thrown set's first one; null for what does not wear.
 */
export function wearOf(_world: World, item: Item): { left: number; max: number } | null {
  if (!levelKnown(item)) return null;
  if (itemDef(item.kind).category === 'missile') {
    const uses = usesLeft(item);
    return uses && uses.left < uses.max ? uses : null;
  }
  if (item.level <= 0) return null;
  const max = maxDurability(item);
  return Number.isFinite(max) ? { left: Math.max(0, Math.ceil(durabilityOf(item))), max } : null;
}

/** The name without its «broken» and its level, for a window's title that shows the level struck through. */
export function plainName(world: World, item: Item): string {
  return itemName(world, { ...item, level: 0, durability: undefined });
}

/** Shattered's glow of each enchantment and glyph (Enchantment.glowing, Glyph.glowing), raised to read on stone (migration.md). */
const MAGIC_COLORS: Readonly<Record<string, string>> = {
  blazing: '#ff6a33', blocking: '#7c96ff', blooming: '#4cc24c', chilling: '#66f0ff', corrupting: '#b878e8', crystal: '#4aa8ff',
  elastic: '#ff66ff', eldritch: '#a9a3bf', grim: '#d8cfb8', kinetic: '#ffee55', lucky: '#66ff66', projecting: '#a77ae0', shocking: '#ffffff',
  unstable: '#bbbbbb', vampiric: '#e8506e', venomous: '#9a7cff', vorpal: '#d89090',
  affection: '#ff6fa8', antiMagic: '#88eeff', brimstone: '#ff6a33', camouflage: '#7cc24a', entanglement: '#c08a4a', flow: '#7c96ff',
  obfuscation: '#a8a8a8', potential: '#ffffff', repulsion: '#e8e2c8', stone: '#a8a090', swiftness: '#ffee55', thorns: '#e8506e',
  viscosity: '#a77ae0',
};

/** The colour an item's enchantment flares with (for hit effects): the table's, or red for a curse. */
export const magicColor = (id: string): string => MAGIC_COLORS[id] ?? '#e04040';

/** Kinds of magic the player has looked at (Catalog.setSeen), kept on this device: the others are marked new. */
const SEEN_KEY = 'pd-seen-magic';
let seenMagic: Set<string> | null = null;
function seen(): Set<string> {
  if (!seenMagic) {
    try {
      seenMagic = new Set(JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]') as string[]);
    } catch {
      seenMagic = new Set();
    }
  }
  return seenMagic;
}
/** The player has read about this enchantment or glyph. */
export function markSeen(id: string): void {
  const all = seen();
  if (all.has(id)) return;
  all.add(id);
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify([...all]));
  } catch {
    // Not kept, then: it is marked new again next time.
  }
}

/** What the slot's mark and the card's enchantment line show: an item's enchantment or glyph, as far as it is known. */
export interface MagicMark {
  id: string;
  glyph: boolean;
  /** The colour (`--ench`): the table's; muted while the item is not known; the danger colour for a curse. */
  color: string;
  curse: boolean;
  /** Not looked at yet (the gold dot). */
  fresh: boolean;
  name: string;
  desc: string;
}

/**
 * Weapon.glowing and Armor.glowing: the enchantment or glyph shows once known — a curse only once the curse is
 * (cursedKnown).
 */
export function magicOf(item: Item): MagicMark | null {
  const id = item.enchant ?? item.glyph;
  if (!id) return null;
  const glyph = item.enchant === undefined;
  const curse = glyph ? isCurseGlyph(item.glyph) : isCurseEnchant(item.enchant);
  if (curse && !cursedKnown(item)) return null;
  const text = glyph ? t.gear.glyphs[item.glyph!] : t.gear.enchants[item.enchant!];
  const word = glyph ? t.gear.glyphWord : t.gear.enchantWord;
  return {
    id, glyph, curse,
    color: curse ? 'var(--danger)' : !levelKnown(item) ? 'var(--ink-muted)' : magicColor(id),
    fresh: !seen().has(id),
    name: capitalize(fmt(text.name, curse ? t.gear.curse : word)),
    desc: text.desc,
  };
}

const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** Weapon.info's lines on strength: too heavy (or probably), or the strength to spare as bonus damage. */
function strengthLines(known: boolean, str: number, hero: Hero, weapon: boolean): string[] {
  if (known) {
    if (str > hero.str) return [weapon ? t.gear.weaponTooHeavy : t.gear.armorTooHeavy];
    if (hero.str > str && weapon) return [fmt(t.gear.excessStr, hero.str - str)];
    return [];
  }
  return str > hero.str ? [weapon ? t.gear.weaponProbablyHeavy : t.gear.armorProbablyHeavy] : [];
}

/** Weapon.info's and Armor.info's last word: whether it is cursed, as far as that is known. */
function curseLines(item: Item, worn: boolean, weapon: boolean, curse: boolean): string[] {
  if (item.cursed && worn) return [weapon ? t.gear.weaponCursedWorn : t.gear.armorCursedWorn];
  if (!item.curseUnknown && item.cursed) return [weapon ? t.gear.weaponCursed : t.gear.armorCursed];
  if (!item.curseUnknown && item.levelUnknown) {
    return [curse ? (weapon ? t.gear.weaponWeakCursed : t.gear.armorWeakCursed) : weapon ? t.gear.weaponNotCursed : t.gear.armorNotCursed];
  }
  return [];
}

/** The kind's own line (stats_desc), its numbers filled in where it has them (the shields' defence, the tomahawk's bleeding). */
function statsLine(item: Item): string[] {
  const line = t.gear.stats[item.kind];
  if (!line) return [];
  const level = levelKnown(item) ? item.level : 0;
  if (item.kind === 'weapon.roundShield') return [fmt(line, 4 + level)];
  if (item.kind === 'weapon.greatshield') return [fmt(line, 6 + 2 * level)];
  if (item.kind === 'missile.tomahawk') return [fmt(line, Math.round(3 + level / 2), 6 + level)];
  return [line];
}

/** ClassArmor.desc: the ability the armour gives and what using it costs now, or that it has none. */
function classArmorLines(hero: Hero, item: Item): string[] {
  if (item.kind !== `armor.${hero.heroClass}`) return [];
  const kind = hero.ability;
  if (!kind) return [artText('items.armor.classarmor.no_ability')];
  return [abilityShort(kind), artText('items.armor.classarmor.charge_use', [chargeText(undefined, hero, kind)])];
}

/** MeleeWeapon.info, Armor.info, MissileWeapon.info and SpiritBow.info, without the enchantment (the card shows it apart). */
export function gearInfo(hero: Hero, item: Item): string[] | null {
  const category = itemDef(item.kind).category;
  const known = levelKnown(item);
  const shown = known ? item : typical(item);
  const worn = hero.weapon === item || hero.armor === item;
  if (category === 'weapon') {
    const stats = weaponStats(shown);
    const tier = itemDef(item.kind).tier!;
    return [
      t.itemInfo[item.kind] ?? '',
      `${fmt(known ? t.gear.weaponKnown : t.gear.weaponTypical, tier, stats.min, stats.max, stats.str)} ${strengthLines(known, stats.str, hero, true).join(' ')}`.trim(),
      ...statsLine(item),
      ...(item.augment === 'speed' ? [t.gear.faster] : item.augment === 'damage' ? [t.gear.stronger] : []),
      ...(item.kind === 'weapon.pickaxe' ? [plain(lt('items.quest.pickaxe.desc')), t.mineHint] : []),
      ...(item.hardened ? [t.hardened] : []),
      // MagesStaff.info: the wand it holds, what it does (unless the staff's curse is known), and a battlemage's blow with it.
      ...(item.kind === 'weapon.magesStaff' && item.wand
        ? [`${t.staffHasWand(t.items[item.wand.kind])} ${visiblyCursed(item) ? t.staffCursedWand : wandStats(hero, item.wand, item)}`]
        : []),
      ...(item.kind === 'weapon.magesStaff' && item.wand && hero.subclass === 'battlemage' ? [t.battlemageInfo[item.wand.kind] ?? ''] : []),
      ...curseLines(item, worn, true, isCurseEnchant(item.enchant)),
    ];
  }
  if (category === 'armor') {
    const stats = armorStats(shown);
    return [
      CLASS_ARMOR.includes(item.kind) ? artText(`items.armor.${CLASS_OF[item.kind]}armor.desc`) : t.itemInfo[item.base ?? item.kind] ?? '',
      `${fmt(known ? t.gear.armorKnown : t.gear.armorTypical, stats.tier, stats.min, stats.max, stats.str)} ${strengthLines(known, stats.str, hero, false).join(' ')}`.trim(),
      ...(item.augment === 'evasion' ? [t.gear.armorEvasion] : item.augment === 'defense' ? [t.gear.armorDefense] : []),
      ...(CLASS_ARMOR.includes(item.kind) ? classArmorLines(hero, item) : []),
      ...(item.hardened ? [t.hardened] : []),
      // Armor.info: the warrior's seal on it, and the shield it gives.
      ...(item.seal ? [t.hero.sealAttached(sealShield(hero, item))] : []),
      ...curseLines(item, worn, false, isCurseGlyph(item.glyph)),
    ];
  }
  if (category === 'vial') {
    // Waterskin.info: plain water, or healing dew; full, it seems to radiate energy.
    const volume = item.volume ?? 0;
    return [t.itemInfo[item.kind] ?? '', volume === 0 ? t.hero.waterskinWater : t.hero.waterskinHeal, ...(volume >= WATERSKIN_VOLUME ? [t.hero.waterskinFullDesc] : [])];
  }
  if (category === 'missile') {
    const stats = missileStats(shown, sharpshootingBonus(hero));
    const uses = usesLeft(item, sharpshootingDurability(hero));
    const typicalUses = usesLeft(typical(item), sharpshootingDurability(hero));
    const tipped = isTippedDart(item.kind);
    const dart = item.kind === 'missile.dart';
    return [
      t.itemInfo[item.kind] ?? '',
      `${fmt(known ? t.gear.missileKnown : t.gear.missileTypical, stats.tier, stats.min, stats.max, stats.str)} ${strengthLines(known, stats.str, hero, true).join(' ')}`.trim(),
      ...(!item.curseUnknown && item.cursed ? [t.gear.weaponCursed] : !item.curseUnknown && item.levelUnknown ? [t.gear.weaponNotCursed] : []),
      [...statsLine(item), t.gear.distance].join(' '),
      ...(item.augment === 'speed' ? [t.gear.faster] : item.augment === 'damage' ? [t.gear.stronger] : []),
      dart ? t.gear.dartUnlimited
        : !uses ? t.gear.unlimitedUses
        : known ? fmt(tipped ? t.gear.tipUsesLeft : t.gear.usesLeft, uses.left, uses.max)
        : fmt(t.gear.unknownUses, typicalUses?.max ?? uses.max),
    ];
  }
  if (category === 'bow') {
    const str = bowStr(hero.lvl, item);
    return [
      t.itemInfo[item.kind] ?? '',
      `${fmt(t.gear.bowStats, augmentDamage(item, bowMin(hero.lvl, item, sharpshootingBonus(hero))), augmentDamage(item, bowMax(hero.lvl, item, sharpshootingBonus(hero))), str)} ${strengthLines(true, str, hero, true).join(' ')}`.trim(),
      ...(item.augment === 'speed' ? [t.gear.faster] : item.augment === 'damage' ? [t.gear.stronger] : []),
      t.gear.distance,
    ];
  }
  return null;
}

export function itemInfo(world: World, hero: Hero, item: Item): string[] {
  const category = itemDef(item.kind).category;
  // MeleeWeapon.info, Armor.info, MissileWeapon.info, SpiritBow.info (gearInfo).
  const gear = gearInfo(hero, item);
  if (gear) return gear;
  if (category === 'wand') {
    // Wand.info: what it is, what it does, its curse (once known) or that it is free of one, a battlemage's staff of it.
    const status = chargesOf(item);
    return [
      t.itemInfo[item.kind] ?? '',
      wandStats(hero, item, null),
      ...(visiblyCursed(item) ? [t.wandCursed] : !item.curseUnknown && !isIdentified(world, item) ? [t.wandNotCursed] : []),
      ...(hero.subclass === 'battlemage' ? [t.battlemageInfo[item.kind] ?? ''] : []),
      ...(status === null ? [] : [t.charges(status)]),
    ];
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
  // Artifact.desc and info, Shattered's texts (artifacttext.ts).
  if (category === 'artifact') {
    return [...artifactInfo(world, hero, item, (kind) => t.items[kind as ItemKind] ?? kind), ...(visiblyCursed(item) ? [t.cursedInfo] : [])];
  }
  return [isKnown(world, item) ? (t.itemInfo[item.kind] ?? '') : t.unknownInfo];
}

/** Top-left corner of an item's sprite in items.png (Shattered's, 16 a row). */
export function spriteOffset(world: World, item: Item): [number, number] {
  const index = itemSprite(item, world.run.labels);
  return [(index % 16) * 16, Math.floor(index / 16) * 16];
}
