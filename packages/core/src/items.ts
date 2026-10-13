import { effectiveLevel, isBroken } from './wear';
import { unidentified } from './ident';
import { HeapType, type ItemSpec } from './level/builder';
import type { Level, RoomInfo } from './level/generate';
import { LENGTH, WIDTH } from './level/geometry';
import { RoomType } from './level/room';
import { F, hasFlag } from './level/terrain';
import { deriveSeed, Rng } from './rng';
import type { RunState } from './run';
import { lootCount } from './party';
import { S } from './spd-sprites';
import { armorValue, randomArmor, randomMissile, randomOfTier, randomWeapon, weaponValue } from './gear';
import { defaultQuantity, missileValue, TIPPED_DARTS } from './missiles';

/*
 * Items, as data: every item family of the original — gold, potions,
 * scrolls and rings (unknown until used or identified, with colours, runes
 * and gems shuffled for every run), Shattered's wands, melee weapons and armour with
 * upgrade levels, thrown weapons, seeds, food, bags, keys and quest items вЂ”
 * with their prices and how the Generator rolls them.
 */

export type ItemCategory =
  | 'gold' | 'potion' | 'scroll' | 'weapon' | 'armor' | 'missile' | 'wand' | 'ring' | 'seed' | 'food' | 'dew' | 'torch' | 'key'
  | 'tome' | 'quest' | 'ankh' | 'kit' | 'bomb' | 'weightstone' | 'beacon' | 'honeypot' | 'vial' | 'bag' | 'wipeout' | 'bow' | 'seal';

export interface ItemDef {
  category: ItemCategory;
  /** Fixed sprite in items.png (Shattered's atlas, `S` in spd-sprites.ts); potions and scrolls take theirs from the run's labels. */
  sprite?: number;
  /** Melee weapons, armour and thrown weapons: their tier (the rest of their numbers are in weapons.ts, armor.ts, missiles.ts). */
  tier?: number;
  /** Food: how much hunger it takes away. */
  energy?: number;
}

const weapon = (tier: number, sprite: number): ItemDef => ({ category: 'weapon', sprite, tier });
const armor = (tier: number, sprite: number): ItemDef => ({ category: 'armor', sprite, tier });
const missile = (tier: number, sprite: number): ItemDef => ({ category: 'missile', sprite, tier });

export const ITEMS = {
  gold: { category: 'gold', sprite: S.GOLD },

  'potion.healing': { category: 'potion' },
  'potion.experience': { category: 'potion' },
  'potion.mindVision': { category: 'potion' },
  'potion.invisibility': { category: 'potion' },
  'potion.strength': { category: 'potion' },
  // Harmful when drunk, and worth throwing at monsters instead.
  'potion.toxicGas': { category: 'potion' },
  'potion.paralyticGas': { category: 'potion' },
  'potion.liquidFlame': { category: 'potion' },
  'potion.frost': { category: 'potion' },
  // Drunk: floating above traps and chasms for a while; cleansing the air around.
  'potion.levitation': { category: 'potion' },
  'potion.purity': { category: 'potion' },
  /** Only from a well of transmutation, out of a potion of strength. */
  'potion.might': { category: 'potion' },

  'scroll.identify': { category: 'scroll' },
  'scroll.teleportation': { category: 'scroll' },
  'scroll.mapping': { category: 'scroll' },
  'scroll.challenge': { category: 'scroll' },
  'scroll.lullaby': { category: 'scroll' },
  'scroll.upgrade': { category: 'scroll' },
  'scroll.recharging': { category: 'scroll' },
  'scroll.enchantment': { category: 'scroll' },
  'scroll.terror': { category: 'scroll' },
  'scroll.psionicBlast': { category: 'scroll' },
  'scroll.mirrorImage': { category: 'scroll' },
  'scroll.removeCurse': { category: 'scroll' },

  // Melee weapons (MeleeWeapon), by tier; their numbers are in weapons.ts.
  'weapon.wornShortsword': weapon(1, S.WORN_SHORTSWORD),
  'weapon.gloves': weapon(1, S.GLOVES),
  'weapon.dagger': weapon(1, S.DAGGER),
  'weapon.rapier': weapon(1, S.RAPIER),
  'weapon.cudgel': weapon(1, S.CUDGEL),
  'weapon.shortsword': weapon(2, S.SHORTSWORD),
  'weapon.handAxe': weapon(2, S.HAND_AXE),
  'weapon.spear': weapon(2, S.SPEAR),
  'weapon.quarterstaff': weapon(2, S.QUARTERSTAFF),
  'weapon.dirk': weapon(2, S.DIRK),
  'weapon.sickle': weapon(2, S.SICKLE),
  'weapon.sword': weapon(3, S.SWORD),
  'weapon.mace': weapon(3, S.MACE),
  'weapon.scimitar': weapon(3, S.SCIMITAR),
  'weapon.roundShield': weapon(3, S.ROUND_SHIELD),
  'weapon.sai': weapon(3, S.SAI),
  'weapon.whip': weapon(3, S.WHIP),
  'weapon.longsword': weapon(4, S.LONGSWORD),
  'weapon.battleAxe': weapon(4, S.BATTLE_AXE),
  'weapon.flail': weapon(4, S.FLAIL),
  'weapon.runicBlade': weapon(4, S.RUNIC_BLADE),
  'weapon.assassinsBlade': weapon(4, S.ASSASSINS_BLADE),
  'weapon.crossbow': weapon(4, S.CROSSBOW),
  'weapon.katana': weapon(4, S.KATANA),
  'weapon.greatsword': weapon(5, S.GREATSWORD),
  'weapon.warHammer': weapon(5, S.WAR_HAMMER),
  'weapon.glaive': weapon(5, S.GLAIVE),
  'weapon.greataxe': weapon(5, S.GREATAXE),
  'weapon.greatshield': weapon(5, S.GREATSHIELD),
  'weapon.gauntlet': weapon(5, S.GAUNTLETS),
  'weapon.warScythe': weapon(5, S.WAR_SCYTHE),
  /** MagesStaff: the mage's own, a weapon and a wand at once (the wand imbued in it: Item.wand). */
  'weapon.magesStaff': weapon(1, S.MAGES_STAFF),
  /** The troll blacksmith's, lent for his errand (Pickaxe): a tool first, a weapon at a pinch. */
  'weapon.pickaxe': weapon(2, S.PICKAXE),
  /** The huntress's own (SpiritBow): never equipped, it shoots arrows of spirit that grow with her. */
  spiritBow: { category: 'bow', sprite: S.SPIRIT_BOW, tier: 1 },

  'armor.cloth': armor(1, S.ARMOR_CLOTH),
  'armor.leather': armor(2, S.ARMOR_LEATHER),
  'armor.mail': armor(3, S.ARMOR_MAIL),
  'armor.scale': armor(4, S.ARMOR_SCALE),
  'armor.plate': armor(5, S.ARMOR_PLATE),
  // Class armour (ClassArmor), made with the armour kit out of whatever armour the hero wore:
  // as good as that armour, and with a special ability of its class.
  'armor.warrior': armor(6, S.ARMOR_WARRIOR),
  'armor.mage': armor(6, S.ARMOR_MAGE),
  'armor.rogue': armor(6, S.ARMOR_ROGUE),
  'armor.huntress': armor(6, S.ARMOR_HUNTRESS),

  // Thrown weapons (MissileWeapon), by tier; their numbers are in missiles.ts.
  'missile.throwingStone': missile(1, S.THROWING_STONE),
  'missile.throwingKnife': missile(1, S.THROWING_KNIFE),
  'missile.throwingSpike': missile(1, S.THROWING_SPIKE),
  'missile.dart': missile(1, S.DART),
  'missile.fishingSpear': missile(2, S.FISHING_SPEAR),
  'missile.throwingClub': missile(2, S.THROWING_CLUB),
  'missile.shuriken': missile(2, S.SHURIKEN),
  'missile.throwingSpear': missile(3, S.THROWING_SPEAR),
  'missile.kunai': missile(3, S.KUNAI),
  'missile.bolas': missile(3, S.BOLAS),
  'missile.javelin': missile(4, S.JAVELIN),
  'missile.tomahawk': missile(4, S.TOMAHAWK),
  'missile.heavyBoomerang': missile(4, S.BOOMERANG),
  'missile.trident': missile(5, S.TRIDENT),
  'missile.throwingHammer': missile(5, S.THROWING_HAMMER),
  'missile.forceCube': missile(5, S.FORCE_CUBE),
  // Darts tipped with a seed (TippedDart): tier 2, but a dart's damage, and something more on a hit.
  'missile.rotDart': missile(2, S.ROT_DART),
  'missile.healingDart': missile(2, S.HEALING_DART),
  'missile.displacingDart': missile(2, S.DISPLACING_DART),
  'missile.chillingDart': missile(2, S.CHILLING_DART),
  'missile.incendiaryDart': missile(2, S.INCENDIARY_DART),
  'missile.poisonDart': missile(2, S.POISON_DART),
  'missile.adrenalineDart': missile(2, S.ADRENALINE_DART),
  'missile.blindingDart': missile(2, S.BLINDING_DART),
  'missile.shockingDart': missile(2, S.SHOCKING_DART),
  'missile.paralyticDart': missile(2, S.PARALYTIC_DART),
  'missile.cleansingDart': missile(2, S.CLEANSING_DART),
  'missile.holyDart': missile(2, S.HOLY_DART),
  // Shattered's wands (items/wands), each known by its look: no wood to guess from.
  'wand.magicMissile': { category: 'wand', sprite: S.WAND_MAGIC_MISSILE },
  'wand.lightning': { category: 'wand', sprite: S.WAND_LIGHTNING },
  'wand.disintegration': { category: 'wand', sprite: S.WAND_DISINTEGRATION },
  'wand.fireblast': { category: 'wand', sprite: S.WAND_FIREBOLT },
  'wand.corrosion': { category: 'wand', sprite: S.WAND_CORROSION },
  'wand.blastWave': { category: 'wand', sprite: S.WAND_BLAST_WAVE },
  'wand.livingEarth': { category: 'wand', sprite: S.WAND_LIVING_EARTH },
  'wand.frost': { category: 'wand', sprite: S.WAND_FROST },
  'wand.prismaticLight': { category: 'wand', sprite: S.WAND_PRISMATIC_LIGHT },
  'wand.warding': { category: 'wand', sprite: S.WAND_WARDING },
  'wand.transfusion': { category: 'wand', sprite: S.WAND_TRANSFUSION },
  'wand.corruption': { category: 'wand', sprite: S.WAND_CORRUPTION },
  'wand.regrowth': { category: 'wand', sprite: S.WAND_REGROWTH },
  // Rings, two of which can be worn at once; they go by their gem until worn a while.
  'ring.mending': { category: 'ring' },
  'ring.detection': { category: 'ring' },
  'ring.shadows': { category: 'ring' },
  'ring.power': { category: 'ring' },
  'ring.accuracy': { category: 'ring' },
  'ring.evasion': { category: 'ring' },
  'ring.satiety': { category: 'ring' },
  'ring.haste': { category: 'ring' },
  'ring.elements': { category: 'ring' },
  'ring.thorns': { category: 'ring' },
  'ring.haggler': { category: 'ring' },
  'ring.herbalism': { category: 'ring' },
  // Seeds, thrown where a plant should grow.
  'seed.firebloom': { category: 'seed', sprite: S.SEED_FIREBLOOM },
  'seed.icecap': { category: 'seed', sprite: S.SEED_ICECAP },
  'seed.sorrowmoss': { category: 'seed', sprite: S.SEED_SORROWMOSS },
  'seed.dreamweed': { category: 'seed', sprite: S.SEED_STORMVINE },
  'seed.sungrass': { category: 'seed', sprite: S.SEED_SUNGRASS },
  'seed.earthroot': { category: 'seed', sprite: S.SEED_EARTHROOT },
  'seed.fadeleaf': { category: 'seed', sprite: S.SEED_FADELEAF },
  /** Only from the shrub the old wandmaker is after; it brews strength. */
  'seed.rotberry': { category: 'seed', sprite: S.SEED_ROTBERRY },
  // Food (Food, Pasty, MysteryMeat), as filling as Shattered makes it (Hunger.HUNGRY is 300): a ration
  // staves off hunger for a while (Food.energy = HUNGRY), a pasty completely (STARVING); mystery meat
  // from crabs is a gamble, worth half a ration.
  'food.ration': { category: 'food', sprite: S.RATION, energy: 300 },
  'food.pasty': { category: 'food', sprite: S.PASTY, energy: 450 },
  'food.meat': { category: 'food', sprite: S.MEAT, energy: 150 },
  // Mystery meat cooked by fire or frozen by frost (ChargrilledMeat, FrozenCarpaccio), and the
  // shops' smaller ration (SmallRation, Pixel Dungeon's overpriced one): half a ration each.
  'food.steak': { category: 'food', sprite: S.STEAK, energy: 150 },
  'food.carpaccio': { category: 'food', sprite: S.CARPACCIO, energy: 150 },
  'food.overpriced': { category: 'food', sprite: S.OVERPRICED, energy: 150 },
  /** Shattered, it lets out a golden bee that fights for whoever broke it, for a while (Honeypot). */
  honeypot: { category: 'honeypot', sprite: S.HONEYPOT },
  /** The sacrificial fire's reward: read, it kills every monster on the level but its boss (ScrollOfWipeOut). */
  wipeOut: { category: 'wipeout', sprite: S.HALLS_PAGE },
  /** Thrown, it blows up where it lands (Bomb). */
  bomb: { category: 'bomb', sprite: S.BOMB },
  /** Goo's legacy now and then: takes its bearer back to a place set beforehand (LloydsBeacon). */
  beacon: { category: 'beacon', sprite: S.BEACON },
  /**
   * StoneOfAugmentation (the shops' runestone; the kind keeps its old name): it augments a weapon for speed or
   * damage, or armour for evasion or defence, or takes the augment away.
   */
  weightstone: { category: 'weightstone', sprite: S.STONE_AUGMENTATION },
  /** Bags (SeedPouch, ScrollHolder, WandHolster), sold in the shops: what they hold takes no room in the backpack. */
  'bag.seeds': { category: 'bag', sprite: S.POUCH },
  'bag.scrolls': { category: 'bag', sprite: S.HOLDER },
  'bag.wands': { category: 'bag', sprite: S.HOLSTER },
  /** Every hero's, from the start: it keeps the dew picked up, to be drunk when hurt (Waterskin; Pixel Dungeon's dew vial). */
  waterskin: { category: 'vial', sprite: S.WATERSKIN },
  /** The Warrior's broken seal, when it is not affixed to armour (BrokenSeal; on armour it is Item.seal). */
  seal: { category: 'seal', sprite: S.SEAL },
  /** Shaken from tall grass; heals whoever picks it up. */
  dew: { category: 'dew', sprite: S.DEWDROP },
  /** Opens the locked room of the level it was found on. */
  'key.iron': { category: 'key', sprite: S.IRON_KEY },
  /** Opens a locked or crystal chest of the level it was found on. */
  'key.golden': { category: 'key', sprite: S.GOLDEN_KEY },
  /** SkeletonKey: dropped by a boss, it opens the locked way down from its level. */
  'key.skeleton': { category: 'key', sprite: S.WORN_KEY },
  /** The sad ghost's dried rose. */
  'quest.rose': { category: 'quest', sprite: S.ARTIFACT_ROSE1 },
  /** The fetid rat's, for the sad ghost. */
  'quest.skull': { category: 'quest', sprite: S.RAT_SKULL },
  /** Dark gold, mined from the veins of the caves for the troll blacksmith. */
  'quest.ore': { category: 'quest', sprite: S.ORE },
  /** Left by the monks or golems the ambitious imp wants gone. */
  'quest.token': { category: 'quest', sprite: S.TOKEN },
  /** What the old wandmaker is after: corpse dust, or a phantom fish (which can be eaten, for a moment unseen). */
  'quest.dust': { category: 'quest', sprite: S.DUST },
  'quest.fish': { category: 'quest', sprite: S.PHANTOM_MEAT },
  /** Tengu's legacy: reading it, a hero masters one of two ways. */
  'tome.mastery': { category: 'tome', sprite: S.MASTERY },
  /** Lit, it lets one see further in the dark halls for a while. */
  torch: { category: 'torch', sprite: S.TORCH },
  /** The King of Dwarves' legacy: it turns the armour worn into the hero's class armour. */
  'kit.armor': { category: 'kit', sprite: S.KIT },
  /** Brings its bearer back to life once, at a price: everything else in the pack, and all gold. */
  ankh: { category: 'ankh', sprite: S.ANKH },
  /** The Amulet of Yendor, at the very bottom of the dungeon. */
  'quest.amulet': { category: 'quest', sprite: S.AMULET },
} as const satisfies Record<string, ItemDef>;

export type ItemKind = keyof typeof ITEMS;

export interface Item {
  kind: ItemKind;
  /** How many: gold coins, potions, scrolls, darts; always 1 for equipment. */
  qty: number;
  /** Upgrade level of weapons, armour and wands, possibly negative. */
  level: number;
  /** Wands (Wand.curCharges and partialCharge): charges left, and the share of the next one gathered so far. */
  charges?: number;
  partial?: number;
  /** The mage's staff: the wand imbued in it (MagesStaff.wand), charged and zapped through the staff. */
  wand?: Item;
  /** WandOfRegrowth.totChrgUsed and chargesOverLimit: charges spent so far, and those beyond what the wand can bear. */
  grown?: number;
  overgrown?: number;
  /** WandOfTransfusion.freeCharge: the next transfusion on an ally costs the hero no health. */
  freeCharge?: boolean;
  /** Keys: the depth whose door they open. */
  depth?: number;
  /** Rings: turns worn so far; after a while one knows what they are. */
  worn?: number;
  /** Melee weapons: an enchantment that does something more with every blow. */
  enchant?: Enchantment;
  /** Armour: a glyph that does something when its wearer is struck. */
  glyph?: Glyph;
  /** The blacksmith's pickaxe: stained with a vampire bat's blood. */
  bloody?: boolean;
  /** Worse than plain, and cursed: once worn, it will not come off until the curse is lifted. */
  cursed?: boolean;
  /** Class armour: the armour it was made from, whose protection it keeps. */
  base?: ItemKind;
  /** The waterskin: how many drops of dew it holds, twenty at most. */
  volume?: number;
  /** Armour: the Warrior's broken seal affixed to it, and the upgrade it carries (0 or 1); see seal.ts. */
  seal?: { level: number };
  /** Lloyd's beacon: where it was set, if it was. */
  returnTo?: { depth: number; pos: number };
  /**
   * Weapon.augment and Armor.augment (a stone of augmentation): a weapon for speed or for damage, armour for evasion
   * or for defence; absent, none.
   */
  augment?: Augment;
  /**
   * Uses left before an upgraded wand or ring breaks (Item.durability), absent while whole (see wear.ts); for a
   * thrown weapon, MissileWeapon.durability: what is left of the stack's first one, of 100 (absent while 100).
   */
  durability?: number;
  /**
   * What is not known yet of a weapon, armour, ring or wand as found (Item.levelKnown and cursedKnown,
   * Wand.curChargeKnown, all false): its level, whether it is cursed, a wand's charges left. Absent
   * once known, and on whatever was known from the start. See ident.ts.
   */
  levelUnknown?: boolean;
  curseUnknown?: boolean;
  chargesUnknown?: boolean;
  /** Wands: zaps so far towards knowing them (Wand.usagesToKnow). */
  familiarity?: number;
  /**
   * Weapons, thrown weapons and armour: uses left before they are known, and how many of those are ready now
   * (Weapon and Armor.usesLeftToID, availableUsesToID; a wand's zaps, Wand.usesLeftToID: 10 at first, 5 of
   * them ready, more with every level the hero gains); rings: the share of a level still to gain
   * while worn (Ring.levelsToID). Absent: as found. See ident.ts.
   */
  usesLeftToID?: number;
  availableUsesToID?: number;
  levelsToID?: number;
  /** Thrown weapons: the set this stack belongs to (MissileWeapon.setID); absent, the kind's own set (as darts share one). */
  set?: number;
  /** The explosive curse's fuse (Explosive.durability, of 100); absent while 100. */
  explosive?: number;
  /** The crystal enchantment's wear (Crystal.durability, of 100); absent while 100. */
  crystal?: number;
  /**
   * Seams for the alchemy stream: an enchantment or glyph hardened against upgrades (Weapon.enchantHardened,
   * Armor.glyphHardened), a curse infused (curseInfusionBonus: a level and more), a potion of mastery drunk on it
   * (masteryPotionBonus: two strength less). Weapons and armour honour them (weapons.ts, armor.ts).
   */
  hardened?: boolean;
  infused?: boolean;
  mastery?: boolean;
}

/** Weapon.Augment (speed, damage) and Armor.Augment (evasion, defense). */
export type Augment = 'speed' | 'damage' | 'evasion' | 'defense';

/* Enchantments and glyphs (Weapon.Enchantment, Armor.Glyph), and the curses among them */

export const COMMON_ENCHANTMENTS = ['blazing', 'chilling', 'kinetic', 'shocking', 'venomous'] as const;
export const UNCOMMON_ENCHANTMENTS = ['blocking', 'blooming', 'eldritch', 'elastic', 'lucky', 'projecting', 'unstable', 'vorpal'] as const;
export const RARE_ENCHANTMENTS = ['corrupting', 'crystal', 'grim', 'vampiric'] as const;
export const WEAPON_CURSES = [
  'annoying', 'displacing', 'dazzling', 'explosive', 'friendly', 'polarized', 'pressurized', 'sacrificial', 'wayward', 'wondrous',
] as const;

export type Enchantment =
  | (typeof COMMON_ENCHANTMENTS)[number] | (typeof UNCOMMON_ENCHANTMENTS)[number] | (typeof RARE_ENCHANTMENTS)[number]
  | (typeof WEAPON_CURSES)[number];

export const COMMON_GLYPHS = ['obfuscation', 'swiftness', 'viscosity', 'potential'] as const;
export const UNCOMMON_GLYPHS = ['brimstone', 'stone', 'entanglement', 'repulsion', 'camouflage', 'flow'] as const;
export const RARE_GLYPHS = ['affection', 'antiMagic', 'thorns'] as const;
export const ARMOR_CURSES = ['antiEntropy', 'corrosion', 'displacement', 'metabolism', 'multiplicity', 'stench', 'overgrowth', 'bulk'] as const;

export type Glyph =
  | (typeof COMMON_GLYPHS)[number] | (typeof UNCOMMON_GLYPHS)[number] | (typeof RARE_GLYPHS)[number] | (typeof ARMOR_CURSES)[number];

const isOneOf = <T extends string>(list: readonly T[], value: string | undefined): value is T => (list as readonly string[]).includes(value ?? '');
/** Enchantment.curse() and Glyph.curse(). */
export const isCurseEnchant = (enchant: Enchantment | undefined): boolean => isOneOf(WEAPON_CURSES, enchant);
export const isCurseGlyph = (glyph: Glyph | undefined): boolean => isOneOf(ARMOR_CURSES, glyph);

/** Enchantment.typeChances and Glyph.typeChances: common, uncommon, rare. */
const TYPE_CHANCES = [50, 40, 10];

/** Enchantment.random(toIgnore) and Glyph.random: a kind by rarity, then one of it not ignored (or any, if none is left). */
function randomOf<T extends string>(rng: Rng, tiers: ReadonlyArray<readonly T[]>, ignore: ReadonlyArray<T | undefined>): T {
  const tier = tiers[rng.chances(TYPE_CHANCES)]!;
  const left = tier.filter((kind) => !ignore.includes(kind));
  return left.length === 0 ? randomOf(rng, tiers, []) : rng.element(left)!;
}

/** Enchantment.random: never one of those to ignore (the weapon's own, for Weapon.enchant()). */
export const randomEnchantment = (rng: Rng, ...ignore: Array<Enchantment | undefined>): Enchantment =>
  randomOf<Enchantment>(rng, [COMMON_ENCHANTMENTS, UNCOMMON_ENCHANTMENTS, RARE_ENCHANTMENTS], ignore);
/** Enchantment.randomCommon / randomUncommon. */
export const randomCommonEnchantment = (rng: Rng, ...ignore: Array<Enchantment | undefined>): Enchantment =>
  randomTier(rng, COMMON_ENCHANTMENTS, ignore, () => randomEnchantment(rng));
export const randomUncommonEnchantment = (rng: Rng, ...ignore: Array<Enchantment | undefined>): Enchantment =>
  randomTier(rng, UNCOMMON_ENCHANTMENTS, ignore, () => randomEnchantment(rng));
/** Enchantment.randomCurse. */
export const randomWeaponCurse = (rng: Rng, ...ignore: Array<Enchantment | undefined>): Enchantment =>
  randomTier(rng, WEAPON_CURSES, ignore, () => randomEnchantment(rng));

/** Glyph.random: never one of those to ignore (the armour's own, for Armor.inscribe()). */
export const randomGlyph = (rng: Rng, ...ignore: Array<Glyph | undefined>): Glyph =>
  randomOf<Glyph>(rng, [COMMON_GLYPHS, UNCOMMON_GLYPHS, RARE_GLYPHS], ignore);
export const randomCommonGlyph = (rng: Rng, ...ignore: Array<Glyph | undefined>): Glyph =>
  randomTier(rng, COMMON_GLYPHS, ignore, () => randomGlyph(rng));
export const randomUncommonGlyph = (rng: Rng, ...ignore: Array<Glyph | undefined>): Glyph =>
  randomTier(rng, UNCOMMON_GLYPHS, ignore, () => randomGlyph(rng));
/** Glyph.randomCurse. */
export const randomArmorCurse = (rng: Rng, ...ignore: Array<Glyph | undefined>): Glyph =>
  randomTier(rng, ARMOR_CURSES, ignore, () => randomGlyph(rng));

function randomTier<T extends string>(rng: Rng, tier: readonly T[], ignore: ReadonlyArray<T | undefined>, otherwise: () => T): T {
  const left = tier.filter((kind) => !ignore.includes(kind));
  return left.length === 0 ? otherwise() : rng.element(left)!;
}

export const itemDef = (kind: ItemKind): ItemDef => ITEMS[kind];
export const isStackable = (kind: ItemKind): boolean => {
  const category = itemDef(kind).category;
  return category === 'potion' || category === 'scroll' || category === 'gold' || category === 'food' || category === 'torch' ||
    category === 'seed' || category === 'bomb' || category === 'honeypot' || category === 'wipeout' || category === 'weightstone' || category === 'missile' || kind === 'quest.token' || kind === 'quest.ore';
};

/** Item.isSimilar: two stacks of a kind join; thrown weapons only those of one set and level (MissileWeapon.isSimilar). */
export const stacksWith = (a: Item, b: Item): boolean =>
  a.kind === b.kind && isStackable(a.kind) && (itemDef(a.kind).category !== 'missile' || (a.level === b.level && a.set === b.set));

export function createItem(kind: ItemKind, qty = 1, level = 0): Item {
  const item: Item = { kind, qty, level };
  if (itemDef(kind).category === 'wand') {
    item.charges = wandMaxCharges(item);
    item.partial = 0;
  }
  return item;
}

/* Prices (Item.price): what a shopkeeper pays; shops ask several times more. */

const POTION_PRICES: Partial<Record<ItemKind, number>> = {
  'potion.healing': 30, 'potion.experience': 80, 'potion.mindVision': 35, 'potion.invisibility': 40,
  'potion.strength': 100, 'potion.toxicGas': 40, 'potion.paralyticGas': 40, 'potion.liquidFlame': 40,
  'potion.frost': 50, 'potion.levitation': 35, 'potion.purity': 50, 'potion.might': 200,
};
const SCROLL_PRICES: Partial<Record<ItemKind, number>> = {
  'scroll.identify': 30, 'scroll.teleportation': 40, 'scroll.mapping': 25, 'scroll.lullaby': 50,
  'scroll.upgrade': 50, 'scroll.recharging': 40, 'scroll.enchantment': 60, 'scroll.terror': 50, 'scroll.psionicBlast': 80, 'scroll.mirrorImage': 40, 'scroll.removeCurse': 30,
};
const FOOD_PRICES: Partial<Record<ItemKind, number>> = {
  'food.ration': 10, 'food.pasty': 20, 'food.meat': 5, 'food.steak': 5, 'food.carpaccio': 10, 'food.overpriced': 20,
};

/** Item.price; unknown potions and scrolls fetch a plain price. 0 for what cannot be sold. */
export function itemPrice(item: Item, known: boolean): number {
  const def = itemDef(item.kind);
  // RatSkull.price: a hunting trophy, of a sort.
  if (item.kind === 'quest.skull') return 100;
  // Item.considerState: a known curse halves the price; a known level makes it worth more (half that, broken), or less.
  const levelled = (price: number): number => {
    if (item.cursed && !item.curseUnknown) price = Math.trunc(price / 2);
    if (!item.levelUnknown) {
      if (item.level > 0) price = isBroken(item) ? Math.trunc((price * (item.level + 1)) / 2) : price * (item.level + 1);
      else if (item.level < 0) price = Math.trunc(price / (1 - item.level));
    }
    return Math.max(1, price);
  };
  switch (def.category) {
    // MeleeWeapon.value and Armor.value (gear.ts); the pickaxe is not for sale, nor the spirit bow.
    case 'weapon':
      // MagesStaff.value: not for sale.
      if (item.kind === 'weapon.pickaxe' || item.kind === 'weapon.magesStaff') return 0;
      return weaponValue(item);
    case 'armor':
      // Armor.value: the warrior's sealed armour is not for sale.
      if (item.seal) return 0;
      return armorValue(item);
    case 'potion':
      return (known ? POTION_PRICES[item.kind] ?? 20 : 20) * item.qty;
    case 'scroll':
      return (known ? SCROLL_PRICES[item.kind] ?? 15 : 15) * item.qty;
    case 'food':
      return (FOOD_PRICES[item.kind] ?? 10) * item.qty;
    case 'missile':
      return missileValue(item);
    case 'wand':
      // Wand.value.
      return levelled(75);
    case 'torch':
      return 10 * item.qty;
    case 'ring':
      return levelled(80);
    case 'seed':
      return 10 * item.qty;
    case 'ankh':
      return 50 * item.qty;
    case 'bomb':
      return 10 * item.qty;
    case 'honeypot':
      return 50 * item.qty;
    case 'bag':
      return 50;
    case 'wipeout':
      return 100 * item.qty;
    // StoneOfAugmentation.value.
    case 'weightstone':
      return 30 * item.qty;
    default:
      return 0;
  }
}

/**
 * WndTradeItem.price: shops ask five times the value, and more the deeper
 * they are. Unknown potions and scrolls go for a plain price, so the price
 * gives nothing away.
 */
export const buyPrice = (item: Item, depth: number, known: boolean, haggling = false): number => {
  const price = itemPrice(item, known) * 5 * (Math.trunc(depth / 5) + 1);
  // RingOfHaggler: half price, for whoever wears one.
  return haggling && price >= 2 ? Math.trunc(price / 2) : price;
};

/* The wand of magic missile */

/** Wand.initialCharges: two charges (three for magic missile). */
export const initialCharges = (kind: ItemKind): number => (kind === 'wand.magicMissile' ? 3 : 2);

/**
 * Wand.updateLevel: the initial charges and one more a level, ten at most; a wand in the mage's staff
 * holds one more (MagesStaff.updateWand), ten at most still.
 */
export const wandMaxCharges = (item: Item, inStaff = false): number =>
  Math.min(Math.min(initialCharges(item.kind) + item.level, 10) + (inStaff ? 1 : 0), 10);

/** Wand.random: a level better one time in three (two, one in fifteen), with charges to match; three in ten cursed. */
export function randomWand(rng: Rng, kind: ItemKind): Item {
  let level = 0;
  if (rng.int(3) === 0) {
    level++;
    if (rng.int(5) === 0) level++;
  }
  const wand = createItem(kind, 1, level);
  if (rng.float() < 0.3) wand.cursed = true;
  return wand;
}

/* Labels: the run's potion colours and scroll runes */

export const POTION_COLORS = [
  'turquoise', 'crimson', 'azure', 'jade', 'golden', 'magenta', 'charcoal', 'ivory', 'amber', 'bistre', 'indigo', 'silver',
] as const;
export const SCROLL_RUNES = [
  'KAUNAN', 'SOWILO', 'LAGUZ', 'YNGVI', 'GYFU', 'RAIDO', 'ISAZ', 'MANNAZ', 'NAUDIZ', 'BERKANAN', 'ODAL', 'TIWAZ',
] as const;
/** Shattered's potion flask of each colour, in POTION_COLORS order. */
const POTION_SPRITES = POTION_COLORS.map((color) => S[`POTION_${color.toUpperCase() as Uppercase<typeof color>}`]);
/** Shattered's scroll with each rune, in SCROLL_RUNES order. */
const SCROLL_SPRITES = SCROLL_RUNES.map((rune) => S[`SCROLL_${rune}`]);
/** Diamond, opal, garnet, ruby, amethyst, topaz, onyx, tourmaline, emerald, sapphire, quartz, agate. */
const RING_SPRITES = [
  S.RING_DIAMOND, S.RING_OPAL, S.RING_GARNET, S.RING_RUBY, S.RING_AMETHYST, S.RING_TOPAZ, S.RING_ONYX, S.RING_TOURMALINE,
  S.RING_EMERALD, S.RING_SAPPHIRE, S.RING_QUARTZ, S.RING_AGATE,
];

/** Kind → index into POTION_COLORS or SCROLL_RUNES, fixed for a run. */
export type Labels = Partial<Record<ItemKind, number>>;

export function rollLabels(seed: number): Labels {
  const rng = Rng.seeded(deriveSeed(seed, LABEL_STREAM));
  const labels: Labels = {};
  for (const category of ['potion', 'scroll', 'ring'] as const) {
    const kinds = (Object.keys(ITEMS) as ItemKind[]).filter(
      (kind) => itemDef(kind).category === category && itemDef(kind).sprite === undefined,
    );
    const indices = [...Array(12).keys()];
    rng.shuffle(indices);
    kinds.forEach((kind, i) => {
      labels[kind] = indices[i]!;
    });
  }
  return labels;
}

const LABEL_STREAM = 6;

export function itemSprite(item: Item, labels: Labels): number {
  const def = itemDef(item.kind);
  if (def.sprite !== undefined) return def.sprite;
  const label = labels[item.kind] ?? 0;
  if (def.category === 'ring') return RING_SPRITES[label]!;
  return def.category === 'potion' ? POTION_SPRITES[label]! : SCROLL_SPRITES[label]!;
}

/* Generator */

/** Categories the generator picks from: melee weapons, armour and thrown weapons each their own (gear.ts). */
export type GeneratedCategory = 'gold' | 'potion' | 'scroll' | 'weapon' | 'armor' | 'missile' | 'food' | 'wand' | 'ring' | 'seed' | 'misc';

/**
 * How often each category comes up. Gear keeps its share of the finds, split as Shattered's category decks split it
 * (Generator.Category: weapons 4, armour 3, thrown weapons 3 in seventy finds); the deck of categories itself is
 * not ported here.
 */
const CATEGORY_CHANCES: ReadonlyArray<readonly [GeneratedCategory, number]> = [
  ['weapon', 10], ['armor', 7.5], ['missile', 7.5], ['potion', 50], ['scroll', 40], ['wand', 4], ['ring', 2], ['seed', 5], ['gold', 50],
  ['misc', 5],
];

const KIND_CHANCES: Readonly<Record<Exclude<GeneratedCategory, 'gold' | 'food' | 'misc' | 'weapon' | 'armor' | 'missile' | 'wand'>, ReadonlyArray<readonly [ItemKind, number]>>> = {
  // Strength only comes as guaranteed finds, and might out of a well of transmutation.
  potion: [
    ['potion.healing', 45], ['potion.experience', 4], ['potion.toxicGas', 15], ['potion.paralyticGas', 10],
    ['potion.liquidFlame', 15], ['potion.levitation', 10], ['potion.mindVision', 20], ['potion.purity', 12],
    ['potion.invisibility', 10], ['potion.frost', 10],
  ],
  // Upgrade only comes as guaranteed finds.
  scroll: [
    ['scroll.identify', 30], ['scroll.teleportation', 10], ['scroll.removeCurse', 15], ['scroll.recharging', 10], ['scroll.mapping', 15],
    ['scroll.challenge', 12], ['scroll.terror', 8], ['scroll.lullaby', 8], ['scroll.psionicBlast', 4], ['scroll.mirrorImage', 6],
    ['scroll.enchantment', 1],
  ],
  seed: [
    ['seed.firebloom', 1], ['seed.icecap', 1], ['seed.sorrowmoss', 1], ['seed.dreamweed', 1], ['seed.sungrass', 1],
    ['seed.earthroot', 1], ['seed.fadeleaf', 1],
  ],
  // Thorns and haggler are only dropped by DM-300 and thieves.
  ring: [
    ['ring.mending', 1], ['ring.detection', 1], ['ring.shadows', 1], ['ring.power', 1], ['ring.accuracy', 1],
    ['ring.evasion', 1], ['ring.satiety', 1], ['ring.haste', 1], ['ring.elements', 1], ['ring.herbalism', 1],
  ],
};

/** Generator.Category.WAND.classes, in their order. */
export const WAND_KINDS: readonly ItemKind[] = [
  'wand.magicMissile', 'wand.lightning', 'wand.disintegration', 'wand.fireblast', 'wand.corrosion', 'wand.blastWave',
  'wand.livingEarth', 'wand.frost', 'wand.prismaticLight', 'wand.warding', 'wand.transfusion', 'wand.corruption', 'wand.regrowth',
];

/**
 * Generator.random(WAND): wands come from a deck, three of each kind; each one dealt is taken out of
 * it, and once it is empty a full one comes in. The run keeps the deck (RunState.wandDeck), and each
 * draw is seeded by the run and how many were dealt before (Category.seed and dropped), so the
 * wands of a run do not depend on when they turn up.
 */
export function wandFromDeck(run: RunState): ItemKind {
  const deck = run.wandDeck ?? WAND_KINDS.map(() => 3);
  const dealt = run.wandsDealt ?? 0;
  const rng = Rng.seeded(deriveSeed(run.seed, WAND_DECK_STREAM, dealt));
  let i = deck.some((n) => n > 0) ? rng.chances(deck) : -1;
  if (i < 0) {
    deck.splice(0, deck.length, ...WAND_KINDS.map(() => 3));
    i = rng.chances(deck);
  }
  deck[i]!--;
  run.wandDeck = deck;
  run.wandsDealt = dealt + 1;
  return WAND_KINDS[i]!;
}

/** Generator.undoDrop: a wand put back into the deck (the wandmaker's second wand, drawn again). */
export function undoWand(run: RunState, kind: ItemKind): void {
  const i = WAND_KINDS.indexOf(kind);
  if (i < 0 || !run.wandDeck) return;
  run.wandDeck[i]!++;
  run.wandsDealt = Math.max(0, (run.wandsDealt ?? 1) - 1);
}

const WAND_DECK_STREAM = 7;

/** Gold.random: a pile's worth for a depth. */
export function rollGold(rng: Rng, depth: number): Item {
  return createItem('gold', rng.intBetween(20 + depth * 10, 40 + depth * 20));
}

/** Ring.random: one or two levels, and three rings in ten the wrong way. */
export function randomRing(rng: Rng, kind: ItemKind): Item {
  const level = rng.intBetween(1, 3);
  const ring = createItem(kind, 1, rng.float() < 0.3 ? -level : level);
  if (ring.level < 0) ring.cursed = true;
  return ring;
}

/** Generator.Category.FOOD: four rations to every pasty. */
export function rollFood(rng: Rng): Item {
  return createItem(rng.chances([4, 1]) === 0 ? 'food.ration' : 'food.pasty');
}

/**
 * Generator: each category gets rarer on a level every time it is picked. With the run's state, weapons and thrown
 * weapons are dealt from its decks (gear.ts); without it, by their default chances.
 */
export class ItemGenerator {
  private readonly chances = new Map(CATEGORY_CHANCES);

  /** With the run, wands come from its deck (Generator.random); without, any kind as likely (Generator.randomUsingDefaults). */
  constructor(private readonly rng: Rng, private readonly depth: number, private readonly run?: RunState) {}

  /** The run's state the decks are kept in, if this generator has it. */
  get runState(): RunState | undefined {
    return this.run;
  }

  random(): Item {
    const category = this.rng.chancesOf(this.chances)!;
    this.chances.set(category, this.chances.get(category)! / 2);
    return this.of(category);
  }

  of(category: GeneratedCategory): Item {
    if (category === 'gold') return rollGold(this.rng, this.depth);
    if (category === 'food') return rollFood(this.rng);
    // Generator.Category.MISC: two bombs to every honeypot; bombs come one to three at a time.
    if (category === 'misc') return this.rng.chances([2, 1]) === 0 ? createItem('bomb', this.rng.intRange(1, 3)) : createItem('honeypot');
    // Generator.randomWeapon, randomArmor and randomMissile, as found (gear.ts).
    if (category === 'weapon') return randomWeapon(this.rng, this.depth, this.run);
    if (category === 'armor') return randomArmor(this.rng, this.depth);
    if (category === 'missile') return randomMissile(this.rng, this.depth, this.run);
    if (category === 'wand') {
      // Wand.random: as found, it tells neither its level nor its curse, nor its charges (ident.ts).
      const kind = this.run ? wandFromDeck(this.run) : WAND_KINDS[this.rng.chances(WAND_KINDS.map(() => 3))]!;
      return unidentified(randomWand(this.rng, kind));
    }
    const table = KIND_CHANCES[category];
    const kind = table[this.rng.chances(table.map(([, chance]) => chance))]![0];
    // As found, a ring, a wand, a melee weapon or armour tells neither its level nor its curse (ident.ts).
    if (category === 'ring') return unidentified(randomRing(this.rng, kind));
    return createItem(kind);
  }
}

/* What lies around on a new level */

/** `forSale`: a shop's wares, bought rather than picked up. */
/** hidden: unseen until a hero searches right next to it. */
export type HeapKind = 'heap' | 'chest' | 'skeleton' | 'tomb' | 'forSale' | 'mimic' | 'lockedChest' | 'crystalChest' | 'hidden';

export interface Heap {
  pos: number;
  kind: HeapKind;
  items: Item[];
}

/** Sprites of closed containers in items.png. */
/** A mimic looks just like a chest. */
export const HEAP_SPRITES: Readonly<Record<Exclude<HeapKind, 'heap' | 'forSale'>, number>> = {
  chest: S.CHEST, skeleton: S.BONES, tomb: S.TOMB, mimic: S.CHEST, lockedChest: S.LOCKED_CHEST, crystalChest: S.CRYSTAL_CHEST,
  hidden: S.SOMETHING, // never drawn
};

const f32 = Math.fround;

/** Dungeon.posNeeded / souNeeded: guaranteed strength and upgrades, spread over the floors. */
function quotaReached(rng: Rng, depth: number, quota: readonly number[], found: number): boolean {
  for (let i = 0; i < quota.length; i += 2) {
    const qDepth = quota[i]!;
    if (depth <= qDepth) {
      return rng.float() < f32((quota[i + 1]! - found) / (qDepth - depth + 1));
    }
  }
  return false;
}

function randomCellIn(rng: Rng, room: RoomInfo): number {
  return rng.intBetween(room.left + 1, room.right) + rng.intBetween(room.top + 1, room.bottom) * WIDTH;
}

/** RegularLevel.randomDropCell: somewhere in a standard room. */
export function randomDropCell(rng: Rng, level: Level): number {
  for (let attempt = 0; attempt < 200; attempt++) {
    const room = rng.element(level.rooms);
    if (room?.type !== RoomType.STANDARD) continue;
    const pos = randomCellIn(rng, room);
    if (pos >= 0 && pos < LENGTH && hasFlag(level.map[pos]!, F.PASSABLE)) return pos;
  }
  return -1;
}

const HEAP_KINDS: Readonly<Partial<Record<HeapType, HeapKind>>> = {
  [HeapType.CHEST]: 'chest',
  [HeapType.MIMIC]: 'mimic',
  [HeapType.TOMB]: 'tomb',
  [HeapType.LOCKED_CHEST]: 'lockedChest',
  [HeapType.CRYSTAL_CHEST]: 'crystalChest',
  [HeapType.SKELETON]: 'skeleton',
  [HeapType.FOR_SALE]: 'forSale',
};

/** RatKingPainter.addChest: mostly a few coins; now and then a weapon or armour, a little worn. */
function kingsPrize(generator: ItemGenerator, rng: Rng): Item {
  switch (rng.int(10)) {
    case 0: {
      const prize = generator.of('weapon');
      if (itemDef(prize.kind).category === 'missile') prize.qty = 1;
      else prize.level -= rng.int(3);
      return prize;
    }
    case 1: {
      const prize = generator.of('armor');
      prize.level -= rng.int(3);
      return prize;
    }
    default:
      return createItem('gold', rng.intRange(1, 5));
  }
}

/** Rolls what a painter asked for. */
function rollSpec(spec: ItemSpec, generator: ItemGenerator, rng: Rng, depth: number): Item {
  switch (spec.roll) {
    case 'random':
      return generator.random();
    case 'gold':
      return rollGold(rng, depth);
    case 'coins':
      return createItem('gold', rng.intRange(1, 3));
    case 'key':
      return { ...createItem('key.iron'), depth };
    case 'goldenKey':
      return { ...createItem('key.golden'), depth };
    case 'liquidFlame':
      return createItem('potion.liquidFlame');
    case 'kingsPrize':
      return kingsPrize(generator, rng);
    case 'bombs':
      // Bomb.random: one to three.
      return createItem('bomb', rng.intRange(1, 3));
    case 'kind':
      return createItem(spec.kind);
    // ShopRoom.generateItems: of the tier, unenchanted, uncursed, +0, known; the thrown ones a set of their own.
    case 'shopWeapon':
      return createItem(randomOfTier(rng, spec.tier, false, generator.runState));
    case 'shopMissile': {
      const kind = randomOfTier(rng, spec.tier, true, generator.runState);
      return { ...createItem(kind, defaultQuantity(kind)), set: 1 + rng.int(0x3fffffff) };
    }
    case 'tippedDarts': {
      // TippedDart.randomTipped: a seed by the seed deck's defaults, until it is one darts are tipped with.
      let kind: ItemKind | undefined;
      while (!kind) kind = TIPPED_DARTS[generator.of('seed').kind];
      return createItem(kind, 2);
    }
    case 'category': {
      let best: Item | null = null;
      for (let i = 0; i < spec.tries; i++) {
        const item = generator.of(rng.oneOf(spec.categories));
        if (!best || item.level > best.level) best = item;
      }
      return best!;
    }
  }
}

/**
 * RegularLevel.createItems, plus the drops the layout asked for (special
 * rooms, graves). Every level has some food, one helping for each hero in
 * the party. Everything goes down through `land` (Level.drop), which the
 * world's challenges may turn into gold.
 */
export function createItems(
  run: RunState, level: Level, rng: Rng, boss: boolean, party = 1, land: (item: Item) => Item = (item) => item,
): Heap[] {
  const heaps: Heap[] = [];
  const drop = (pos: number, kind: HeapKind, item: Item): void => {
    if (pos < 0) return;
    const heap = heaps.find((h) => h.pos === pos);
    if (heap) heap.items.push(land(item));
    else heaps.push({ pos, kind, items: [land(item)] });
  };
  const generator = new ItemGenerator(rng, level.depth, run);
  if (boss) {
    // Boss levels hold nothing but what their layout asks for (Tengu's key).
    for (const spawn of level.items) {
      drop(spawn.pos, HEAP_KINDS[spawn.heap] ?? 'heap', rollSpec(spawn.item, generator, rng, level.depth));
    }
    return heaps;
  }

  let count = 3;
  while (rng.float() < 0.4) count++;
  // A party finds more lying about (party.ts).
  count = lootCount(count, party);
  for (let i = 0; i < count; i++) {
    const roll = rng.int(20);
    // RegularLevel.createItems: one chest in five below the first depth is a mimic.
    const kind: HeapKind = roll === 0 ? 'skeleton' : roll === 5 && level.depth > 1 ? 'mimic' : roll <= 5 ? 'chest' : 'heap';
    drop(randomDropCell(rng, level), kind, generator.random());
  }

  for (let i = 0; i < Math.max(1, party); i++) drop(randomDropCell(rng, level), 'heap', rollFood(rng));
  if (quotaReached(rng, level.depth, [4, 2, 9, 4, 14, 6, 19, 8, 24, 9], run.strengthFound)) {
    run.strengthFound++;
    // What makes a hero stronger, once for every hero.
    for (let i = 0; i < Math.max(1, party); i++) drop(randomDropCell(rng, level), 'heap', createItem('potion.strength'));
  }
  if (quotaReached(rng, level.depth, [5, 3, 10, 6, 15, 9, 20, 12, 25, 13], run.upgradesFound)) {
    run.upgradesFound++;
    for (let i = 0; i < Math.max(1, party); i++) drop(randomDropCell(rng, level), 'heap', createItem('scroll.upgrade'));
  }

  for (const spec of level.toSpawn) {
    drop(randomDropCell(rng, level), 'heap', rollSpec(spec, generator, rng, level.depth));
  }
  for (const spawn of level.items) {
    drop(spawn.pos, HEAP_KINDS[spawn.heap] ?? 'heap', rollSpec(spawn.item, generator, rng, level.depth));
  }
  return heaps;
}

/**
 * A hero who joins the party after a depth was made: their share of it, as if
 * they had been there from the start (party.ts) — the things that make a hero
 * stronger that the depth gave each hero (`perHero`), a helping of food, and
 * more lying about. Laid into `heaps`, through `land` as createItems does.
 */
export function shareOfDepth(
  level: Level, rng: Rng, perHero: readonly ItemKind[], party: number, heaps: Heap[], land: (item: Item) => Item = (item) => item,
): void {
  const drop = (pos: number, kind: HeapKind, item: Item): void => {
    if (pos < 0) return;
    const heap = heaps.find((h) => h.pos === pos);
    if (heap) heap.items.push(land(item));
    else heaps.push({ pos, kind, items: [land(item)] });
  };

  const generator = new ItemGenerator(rng, level.depth);
  const extra = lootCount(3, party) - lootCount(3, party - 1);
  for (let i = 0; i < extra; i++) {
    const roll = rng.int(20);
    const kind: HeapKind = roll <= 5 && roll > 0 ? 'chest' : 'heap';
    drop(randomDropCell(rng, level), kind, generator.random());
  }
  drop(randomDropCell(rng, level), 'heap', rollFood(rng));
  for (const kind of perHero) drop(randomDropCell(rng, level), 'heap', createItem(kind));
}
