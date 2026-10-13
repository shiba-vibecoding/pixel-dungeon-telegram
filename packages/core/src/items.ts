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

/*
 * Items, as data: every item family of the original вЂ” gold, potions,
 * scrolls, wands and rings (unknown until used or identified, with colours,
 * runes, woods and gems shuffled for every run), melee weapons and armour with
 * upgrade levels, thrown weapons, seeds, food, bags, keys and quest items вЂ”
 * with their prices and how the Generator rolls them.
 */

export type ItemCategory =
  | 'gold' | 'potion' | 'scroll' | 'weapon' | 'armor' | 'missile' | 'wand' | 'ring' | 'seed' | 'food' | 'dew' | 'torch' | 'key'
  | 'tome' | 'quest' | 'ankh' | 'kit' | 'bomb' | 'weightstone' | 'beacon' | 'honeypot' | 'vial' | 'bag' | 'wipeout' | 'seal';

export interface ItemDef {
  category: ItemCategory;
  /** Fixed sprite in items.png (Shattered's atlas, `S` in spd-sprites.ts); potions and scrolls take theirs from the run's labels. */
  sprite?: number;
  /** Melee weapons (MeleeWeapon): tier, accuracy and delay factors, strength if not the usual. */
  tier?: number;
  accuracy?: number;
  delay?: number;
  str?: number;
  /** Food: how much hunger it takes away. */
  energy?: number;
}

const weapon = (tier: number, sprite: number, accuracy = 1, delay = 1, str?: number): ItemDef => ({
  category: 'weapon', sprite, tier, accuracy, delay, ...(str ? { str } : {}),
});
const armor = (tier: number, sprite: number): ItemDef => ({ category: 'armor', sprite, tier });

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

  'weapon.knuckles': weapon(1, S.GLOVES, 1, 0.5),
  'weapon.dagger': weapon(1, S.DAGGER, 1.2),
  /** The warrior's (WornShortsword's numbers: tier 1, 1-10, ten strength, where Pixel Dungeon's wanted eleven). */
  'weapon.shortSword': weapon(1, S.SHORTSWORD),
  'weapon.quarterstaff': weapon(2, S.QUARTERSTAFF),
  'weapon.spear': weapon(2, S.SPEAR, 1, 1.5),
  'weapon.mace': weapon(3, S.MACE, 1, 0.8),
  'weapon.sword': weapon(3, S.SWORD),
  'weapon.longsword': weapon(4, S.LONGSWORD),
  'weapon.battleAxe': weapon(4, S.BATTLE_AXE, 1.2),
  'weapon.warHammer': weapon(5, S.WAR_HAMMER, 1.2),
  'weapon.glaive': weapon(5, S.GLAIVE),
  /** The troll blacksmith's, lent for his errand (Pickaxe): a tool first, a weapon at a pinch. */
  'weapon.pickaxe': weapon(2, S.PICKAXE, 1, 1, 14),

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

  // Thrown: darts are lost when they hit and fall to the floor when they
  // miss; the boomerang always comes back.
  'missile.dart': { category: 'missile', sprite: S.DART },
  // The other thrown weapons (MissileWeapon): each does something more when it hits.
  'missile.curare': { category: 'missile', sprite: S.PARALYTIC_DART },
  'missile.incendiary': { category: 'missile', sprite: S.INCENDIARY_DART },
  'missile.javelin': { category: 'missile', sprite: S.JAVELIN },
  'missile.shuriken': { category: 'missile', sprite: S.SHURIKEN },
  'missile.tomahawk': { category: 'missile', sprite: S.TOMAHAWK },
  'missile.boomerang': { category: 'missile', sprite: S.BOOMERANG },
  'wand.magicMissile': { category: 'wand', sprite: S.WAND_MAGIC_MISSILE },
  // The other wands go by the wood they are made of until used.
  'wand.firebolt': { category: 'wand' },
  'wand.lightning': { category: 'wand' },
  'wand.poison': { category: 'wand' },
  'wand.slowness': { category: 'wand' },
  'wand.teleportation': { category: 'wand' },
  'wand.blink': { category: 'wand' },
  'wand.disintegration': { category: 'wand' },
  'wand.avalanche': { category: 'wand' },
  'wand.amok': { category: 'wand' },
  'wand.reach': { category: 'wand' },
  'wand.flock': { category: 'wand' },
  'wand.regrowth': { category: 'wand' },
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
  /** Balances a melee weapon for speed or for accuracy (Weightstone). */
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
  /** Wands: charges left, and time spent towards the next one. */
  charges?: number;
  recharge?: number;
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
  /** Melee weapons: balanced with a weightstone, for speed or for accuracy (Weapon.imbue). */
  imbue?: 'speed' | 'accuracy';
  /** Uses left before an upgraded item breaks (Item.durability); absent while whole. See wear.ts. */
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
   * Weapons and armour: uses left before they are known, and how many of those are ready now
   * (Weapon and Armor.usesLeftToID, availableUsesToID); rings: the share of a level still to gain
   * while worn (Ring.levelsToID). Absent: as found. See ident.ts.
   */
  usesLeftToID?: number;
  availableUsesToID?: number;
  levelsToID?: number;
}

/* Enchantments and glyphs (Weapon.Enchantment, Armor.Glyph) */

export type Enchantment =
  | 'fire' | 'poison' | 'death' | 'paralysis' | 'leech' | 'slow' | 'shock' | 'instability' | 'horror' | 'luck' | 'tempering';

/** How often each enchantment comes up. */
const ENCHANTMENT_CHANCES: ReadonlyArray<readonly [Enchantment, number]> = [
  ['fire', 10], ['poison', 10], ['death', 1], ['paralysis', 2], ['leech', 1], ['slow', 2], ['shock', 6], ['instability', 3],
  ['horror', 2], ['luck', 2], ['tempering', 3],
];

export type Glyph =
  | 'bounce' | 'affection' | 'antiEntropy' | 'potential' | 'metabolism' | 'stench' | 'viscosity' | 'displacement' | 'entanglement'
  | 'multiplicity' | 'autoRepair';

const GLYPHS: readonly Glyph[] = [
  'bounce', 'affection', 'antiEntropy', 'multiplicity', 'potential', 'metabolism', 'stench', 'viscosity', 'displacement',
  'entanglement', 'autoRepair',
];

/** Enchantment.random, never the one the weapon already has. */
export function randomEnchantment(rng: Rng, except?: Enchantment): Enchantment {
  const chances = ENCHANTMENT_CHANCES.map(([, chance]) => chance);
  for (;;) {
    const enchant = ENCHANTMENT_CHANCES[rng.chances(chances)]![0];
    if (enchant !== except) return enchant;
  }
}

/** Glyph.random, never the one the armour already has. */
export function randomGlyph(rng: Rng, except?: Glyph): Glyph {
  for (;;) {
    const glyph = GLYPHS[rng.int(GLYPHS.length)]!;
    if (glyph !== except) return glyph;
  }
}

export const itemDef = (kind: ItemKind): ItemDef => ITEMS[kind];
export const isStackable = (kind: ItemKind): boolean => {
  const category = itemDef(kind).category;
  return category === 'potion' || category === 'scroll' || category === 'gold' || category === 'food' || category === 'torch' ||
    category === 'seed' || category === 'bomb' || category === 'honeypot' || category === 'wipeout' || category === 'weightstone' || (category === 'missile' && kind !== 'missile.boomerang') || kind === 'quest.token' || kind === 'quest.ore';
};

export function createItem(kind: ItemKind, qty = 1, level = 0): Item {
  const item: Item = { kind, qty, level };
  if (itemDef(kind).category === 'wand') {
    item.charges = wandMaxCharges(item);
    item.recharge = 0;
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
const MISSILE_PRICES: Partial<Record<ItemKind, number>> = {
  'missile.dart': 2, 'missile.curare': 12, 'missile.incendiary': 10, 'missile.javelin': 15, 'missile.shuriken': 15, 'missile.tomahawk': 20,
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
    // Enchanted, half as much again.
    case 'weapon':
      if (item.kind === 'weapon.pickaxe') return 0;
      return levelled(Math.trunc(20 * 2 ** (def.tier! - 1) * (item.enchant ? 1.5 : 1)));
    case 'armor':
      // Armor.value: the warrior's sealed armour is not for sale.
      if (item.seal) return 0;
      return levelled(Math.trunc(10 * 2 ** (itemDef(item.base ?? item.kind).tier! - 1) * (item.glyph ? 1.5 : 1)));
    case 'potion':
      return (known ? POTION_PRICES[item.kind] ?? 20 : 20) * item.qty;
    case 'scroll':
      return (known ? SCROLL_PRICES[item.kind] ?? 15 : 15) * item.qty;
    case 'food':
      return (FOOD_PRICES[item.kind] ?? 10) * item.qty;
    case 'missile':
      return item.kind === 'missile.boomerang' ? 30 : (MISSILE_PRICES[item.kind] ?? 2) * item.qty;
    case 'wand':
      return levelled(50);
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
    case 'weightstone':
      return 40 * item.qty;
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

/* Thrown weapons (MissileWeapon) and the wand of magic missile */

/** How many come in one find (Random.Int(from, to)). */
const MISSILE_HANDFULS: Partial<Record<ItemKind, readonly [number, number]>> = {
  'missile.dart': [5, 15], 'missile.curare': [2, 5], 'missile.incendiary': [3, 6], 'missile.javelin': [5, 15],
  'missile.shuriken': [5, 15], 'missile.tomahawk': [5, 12],
};

const MISSILES: Partial<Record<ItemKind, { min: number; max: number; str: number; delay?: number }>> = {
  'missile.dart': { min: 1, max: 4, str: 10 },
  'missile.curare': { min: 1, max: 3, str: 14 },
  'missile.incendiary': { min: 1, max: 2, str: 12 },
  'missile.javelin': { min: 2, max: 15, str: 15 },
  'missile.shuriken': { min: 2, max: 6, str: 13, delay: 0.5 },
  'missile.tomahawk': { min: 4, max: 20, str: 17 },
};

export function missileStats(item: Item): { min: number; max: number; str: number; delay: number } {
  if (item.kind === 'missile.boomerang') {
    const level = effectiveLevel(item);
    return { min: 1 + level, max: 4 + 2 * level, str: 10, delay: 1 };
  }
  const stats = MISSILES[item.kind] ?? MISSILES['missile.dart']!;
  return { min: stats.min, max: stats.max, str: stats.str, delay: stats.delay ?? 1 };
}

/** One more charge every this many turns (Wand.Charger). */
export const WAND_RECHARGE = 40;

/** Wand.initialCharges and updateLevel: two charges (three for magic missile), one more a level, nine at most. */
export const wandMaxCharges = (item: Item): number => Math.min((item.kind === 'wand.magicMissile' ? 3 : 2) + item.level, 9);

/** WandOfMagicMissile: Random.Int(1, 6 + level * 2), so 1-5 for a plain wand. */
export const magicMissileDamage = (item: Item): readonly [number, number] => [1, 5 + effectiveLevel(item) * 2];

/* Weapon and armour numbers (MeleeWeapon, Armor) */

const f32 = Math.fround;

export interface WeaponStats {
  min: number;
  max: number;
  str: number;
  accuracy: number;
  delay: number;
}

export function weaponStats(item: Item): WeaponStats {
  // Pickaxe: fixed numbers, never upgraded.
  if (item.kind === 'weapon.pickaxe') return { min: 3, max: 12, str: 14, accuracy: 1, delay: 1 };
  const def = itemDef(item.kind);
  const tier = def.tier!;
  const accuracy = def.accuracy!;
  const delay = def.delay!;
  // MeleeWeapon.min/max: a broken weapon strikes as an unupgraded one; its strength stays as it was.
  const level = effectiveLevel(item);
  return {
    min: tier + level,
    max: Math.trunc(f32(f32((tier * tier - tier + 10) / f32(accuracy)) * f32(delay))) + level * tier,
    str: (def.str ?? 8 + tier * 2) - item.level,
    // Weapon.imbue: balanced for accuracy, half as accurate again; for speed, it strikes in six tenths of the time.
    accuracy: item.imbue === 'accuracy' ? f32(accuracy * 1.5) : accuracy,
    delay: item.imbue === 'speed' ? f32(delay * 0.6) : delay,
  };
}

export function armorStats(item: Item): { dr: number; str: number } {
  // Class armour protects as the armour it was made from.
  const tier = itemDef(item.base ?? item.kind).tier!;
  // Armor.DR: a glyph adds a level's worth of protection.
  return { dr: Math.max(tier * (2 + effectiveLevel(item) + (item.glyph ? 1 : 0)), 0), str: 7 + tier * 2 - item.level };
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
/**
 * Holly, yew, ebony, cherry, teak, rowan, willow, mahogany, bamboo, purpleheart, oak, birch: Shattered draws every
 * wand by its kind, so each wood borrows one of its wand sprites (all but magic missile's, which is known from the start).
 */
const WAND_SPRITES = [
  S.WAND_FIREBOLT, S.WAND_FROST, S.WAND_LIGHTNING, S.WAND_DISINTEGRATION, S.WAND_PRISMATIC_LIGHT, S.WAND_CORROSION,
  S.WAND_LIVING_EARTH, S.WAND_BLAST_WAVE, S.WAND_CORRUPTION, S.WAND_WARDING, S.WAND_REGROWTH, S.WAND_TRANSFUSION,
];
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
  for (const category of ['potion', 'scroll', 'wand', 'ring'] as const) {
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
  if (def.category === 'wand') return WAND_SPRITES[label]!;
  if (def.category === 'ring') return RING_SPRITES[label]!;
  return def.category === 'potion' ? POTION_SPRITES[label]! : SCROLL_SPRITES[label]!;
}

/* Generator */

/** Categories the generator picks from; thrown weapons come with the weapons. */
export type GeneratedCategory = 'gold' | 'potion' | 'scroll' | 'weapon' | 'armor' | 'food' | 'wand' | 'ring' | 'seed' | 'misc';

const CATEGORY_CHANCES: ReadonlyArray<readonly [GeneratedCategory, number]> = [
  ['weapon', 15], ['armor', 10], ['potion', 50], ['scroll', 40], ['wand', 4], ['ring', 2], ['seed', 5], ['gold', 50], ['misc', 5],
];

const KIND_CHANCES: Readonly<Record<Exclude<GeneratedCategory, 'gold' | 'food' | 'misc'>, ReadonlyArray<readonly [ItemKind, number]>>> = {
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
  weapon: [
    ['weapon.dagger', 1], ['weapon.knuckles', 1], ['weapon.quarterstaff', 1], ['weapon.spear', 1], ['weapon.mace', 1],
    ['weapon.sword', 1], ['weapon.longsword', 1], ['weapon.battleAxe', 1], ['weapon.warHammer', 1], ['weapon.glaive', 1],
    ['missile.dart', 0], ['missile.javelin', 1], ['missile.incendiary', 1], ['missile.curare', 1], ['missile.shuriken', 1],
    ['missile.tomahawk', 1],
  ],
  armor: [['armor.cloth', 1], ['armor.leather', 1], ['armor.mail', 1], ['armor.scale', 1], ['armor.plate', 1]],
  seed: [
    ['seed.firebloom', 1], ['seed.icecap', 1], ['seed.sorrowmoss', 1], ['seed.dreamweed', 1], ['seed.sungrass', 1],
    ['seed.earthroot', 1], ['seed.fadeleaf', 1],
  ],
  // Thorns and haggler are only dropped by DM-300 and thieves.
  ring: [
    ['ring.mending', 1], ['ring.detection', 1], ['ring.shadows', 1], ['ring.power', 1], ['ring.accuracy', 1],
    ['ring.evasion', 1], ['ring.satiety', 1], ['ring.haste', 1], ['ring.elements', 1], ['ring.herbalism', 1],
  ],
  wand: [
    ['wand.teleportation', 10], ['wand.slowness', 10], ['wand.firebolt', 15], ['wand.regrowth', 6], ['wand.poison', 10],
    ['wand.blink', 11], ['wand.lightning', 15], ['wand.amok', 10], ['wand.reach', 6], ['wand.flock', 10], ['wand.disintegration', 5],
    ['wand.avalanche', 5],
  ],
};

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

/** Weapon.random / Armor.random: sometimes better, sometimes worse than usual. */
function rollLevel(rng: Rng): number {
  if (rng.float() >= 0.4) return 0;
  let n = 1;
  if (rng.int(3) === 0) {
    n++;
    if (rng.int(3) === 0) n++;
  }
  return rng.int(2) === 0 ? n : -n;
}

/** Generator: each category gets rarer on a level every time it is picked. */
export class ItemGenerator {
  private readonly chances = new Map(CATEGORY_CHANCES);

  constructor(private readonly rng: Rng, private readonly depth: number) {}

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
    const table = KIND_CHANCES[category];
    const kind = table[this.rng.chances(table.map(([, chance]) => chance))]![0];
    // Dart.random: a handful of them.
    // MissileWeapon.random: a handful of them.
    const handful = MISSILE_HANDFULS[kind];
    if (handful) return createItem(kind, this.rng.intBetween(handful[0], handful[1]));
    // As found, a ring, a wand, a melee weapon or armour tells neither its level nor its curse (ident.ts).
    if (category === 'ring') return unidentified(randomRing(this.rng, kind));
    if (category === 'wand') {
      // Wand.random: half of them a level better, a few two.
      let level = 0;
      if (this.rng.float() < 0.5) {
        level++;
        if (this.rng.float() < 0.15) level++;
      }
      return unidentified(createItem(kind, 1, level));
    }
    const level = category === 'weapon' || category === 'armor' ? rollLevel(this.rng) : 0;
    const item = createItem(kind, 1, level);
    // Weapon.random and Armor.random: what came out worse is cursed.
    if (level < 0) item.cursed = true;
    // MeleeWeapon.random and Armor.random: now and then enchanted, the better the rarer.
    if (itemDef(kind).category === 'weapon' && this.rng.int(10 + level) === 0) item.enchant = randomEnchantment(this.rng);
    if (category === 'armor' && this.rng.int(10) === 0) item.glyph = randomGlyph(this.rng);
    return unidentified(item);
  }
}

/* What lies around on a new level */

/** `forSale`: a shop's wares, bought rather than picked up. */
/** hidden: unseen until a hero searches right next to it. */
/** `goldenMimic` and `crystalMimic`: mimics looking like a locked and a crystal chest (GoldenMimic, CrystalMimic). */
export type HeapKind =
  | 'heap' | 'chest' | 'skeleton' | 'tomb' | 'forSale' | 'mimic' | 'lockedChest' | 'crystalChest' | 'hidden' | 'goldenMimic' | 'crystalMimic';

export interface Heap {
  pos: number;
  kind: HeapKind;
  items: Item[];
}

/** Sprites of closed containers in items.png. */
/** A mimic looks just like a chest. */
export const HEAP_SPRITES: Readonly<Record<Exclude<HeapKind, 'heap' | 'forSale'>, number>> = {
  chest: S.CHEST, skeleton: S.BONES, tomb: S.TOMB, mimic: S.CHEST, lockedChest: S.LOCKED_CHEST, crystalChest: S.CRYSTAL_CHEST,
  goldenMimic: S.LOCKED_CHEST, crystalMimic: S.CRYSTAL_CHEST,
  hidden: S.SOMETHING, // never drawn
};

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
  const generator = new ItemGenerator(rng, level.depth);
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
