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
import { artifactSprite, artifactValue, initArtifact, randomArtifact } from './artifacts/artifact';

/*
 * Items, as data: every item family of the original — gold, potions,
 * scrolls and rings (unknown until used or identified, with colours, runes
 * and gems shuffled for every run), Shattered's wands, melee weapons and armour with
 * upgrade levels, thrown weapons, seeds, food, bags, keys and quest items вЂ”
 * with their prices and how the Generator rolls them.
 */

export type ItemCategory =
  | 'gold' | 'potion' | 'scroll' | 'weapon' | 'armor' | 'missile' | 'wand' | 'ring' | 'seed' | 'food' | 'dew' | 'torch' | 'key'
  | 'tome' | 'quest' | 'ankh' | 'kit' | 'bomb' | 'honeypot' | 'vial' | 'bag' | 'wipeout' | 'bow' | 'seal'
  | 'artifact' | 'sandbag' | 'petal'
  // Shattered's alchemy (alchemy.ts): runestones, spells, brews, elixirs, trinkets and the trinket catalyst,
  // energy crystals, and what alchemy makes or wants that is none of those (arcane resin, liquid metal, goo, shards).
  | 'stone' | 'spell' | 'brew' | 'elixir' | 'trinket' | 'catalyst' | 'energy' | 'material';

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
const of = (category: ItemCategory, sprite: number): ItemDef => ({ category, sprite });
const missile = (tier: number, sprite: number): ItemDef => ({ category: 'missile', sprite, tier });

export const ITEMS = {
  gold: { category: 'gold', sprite: S.GOLD },

  // Shattered's twelve potions (Generator.Category.POTION), in its order; the label shuffle follows it.
  'potion.strength': { category: 'potion' },
  'potion.healing': { category: 'potion' },
  'potion.mindVision': { category: 'potion' },
  'potion.frost': { category: 'potion' },
  'potion.liquidFlame': { category: 'potion' },
  'potion.toxicGas': { category: 'potion' },
  'potion.haste': { category: 'potion' },
  'potion.invisibility': { category: 'potion' },
  'potion.levitation': { category: 'potion' },
  'potion.paralyticGas': { category: 'potion' },
  'potion.purity': { category: 'potion' },
  'potion.experience': { category: 'potion' },
  // Exotic potions (ExoticPotion), one for each of the twelve (EXOTIC_OF): known with it, drawn a row below it.
  'potion.mastery': { category: 'potion' },
  'potion.shielding': { category: 'potion' },
  'potion.magicalSight': { category: 'potion' },
  'potion.snapFreeze': { category: 'potion' },
  'potion.dragonsBreath': { category: 'potion' },
  'potion.corrosiveGas': { category: 'potion' },
  'potion.stamina': { category: 'potion' },
  'potion.shroudingFog': { category: 'potion' },
  'potion.stormClouds': { category: 'potion' },
  'potion.earthenArmor': { category: 'potion' },
  'potion.cleansing': { category: 'potion' },
  'potion.divineInspiration': { category: 'potion' },

  // Shattered's twelve scrolls (Generator.Category.SCROLL), in its order.
  'scroll.upgrade': { category: 'scroll' },
  'scroll.identify': { category: 'scroll' },
  'scroll.removeCurse': { category: 'scroll' },
  'scroll.mirrorImage': { category: 'scroll' },
  'scroll.recharging': { category: 'scroll' },
  'scroll.teleportation': { category: 'scroll' },
  'scroll.lullaby': { category: 'scroll' },
  'scroll.mapping': { category: 'scroll' },
  'scroll.rage': { category: 'scroll' },
  'scroll.retribution': { category: 'scroll' },
  'scroll.terror': { category: 'scroll' },
  'scroll.transmutation': { category: 'scroll' },
  // Exotic scrolls (ExoticScroll), one for each of the twelve.
  'scroll.enchantment': { category: 'scroll' },
  'scroll.divination': { category: 'scroll' },
  'scroll.antiMagic': { category: 'scroll' },
  'scroll.prismaticImage': { category: 'scroll' },
  'scroll.mysticalEnergy': { category: 'scroll' },
  'scroll.passage': { category: 'scroll' },
  'scroll.sirensSong': { category: 'scroll' },
  'scroll.foresight': { category: 'scroll' },
  'scroll.challenge': { category: 'scroll' },
  'scroll.psionicBlast': { category: 'scroll' },
  'scroll.dread': { category: 'scroll' },
  'scroll.metamorphosis': { category: 'scroll' },

  // Runestones (Runestone), in Generator.Category.STONE's order: thrown, or used on an item (InventoryStone).
  'stone.enchantment': of('stone', S.STONE_ENCHANT),
  'stone.intuition': of('stone', S.STONE_INTUITION),
  'stone.detectMagic': of('stone', S.STONE_DETECT),
  'stone.flock': of('stone', S.STONE_FLOCK),
  'stone.shock': of('stone', S.STONE_SHOCK),
  'stone.blink': of('stone', S.STONE_BLINK),
  'stone.deepSleep': of('stone', S.STONE_SLEEP),
  'stone.clairvoyance': of('stone', S.STONE_CLAIRVOYANCE),
  'stone.aggression': of('stone', S.STONE_AGGRESSION),
  'stone.blast': of('stone', S.STONE_BLAST),
  'stone.fear': of('stone', S.STONE_FEAR),
  'stone.augmentation': of('stone', S.STONE_AUGMENTATION),

  // Spells (Spell), made only by alchemy.
  'spell.alchemize': of('spell', S.ALCHEMIZE),
  'spell.beacon': of('spell', S.RETURN_BEACON),
  'spell.curseInfusion': of('spell', S.CURSE_INFUSE),
  'spell.magicalInfusion': of('spell', S.MAGIC_INFUSE),
  'spell.phaseShift': of('spell', S.PHASE_SHIFT),
  'spell.reclaimTrap': of('spell', S.RECLAIM_TRAP),
  'spell.recycle': of('spell', S.RECYCLE),
  'spell.summonElemental': of('spell', S.SUMMON_ELE),
  'spell.telekineticGrab': of('spell', S.TELE_GRAB),
  'spell.unstable': of('spell', S.UNSTABLE_SPELL),
  'spell.wildEnergy': of('spell', S.WILD_ENERGY),

  // Brews (Brew): thrown only (but for the unstable one), and always known.
  'brew.aqua': of('brew', S.BREW_AQUA),
  'brew.blizzard': of('brew', S.BREW_BLIZZARD),
  'brew.caustic': of('brew', S.BREW_CAUSTIC),
  'brew.infernal': of('brew', S.BREW_INFERNAL),
  'brew.shocking': of('brew', S.BREW_SHOCKING),
  'brew.unstable': of('brew', S.BREW_UNSTABLE),
  // Elixirs (Elixir): drunk, and always known.
  'elixir.aquaticRejuvenation': of('elixir', S.ELIXIR_AQUA),
  'elixir.arcaneArmor': of('elixir', S.ELIXIR_ARCANE),
  'elixir.dragonsBlood': of('elixir', S.ELIXIR_DRAGON),
  'elixir.featherFall': of('elixir', S.ELIXIR_FEATHER),
  'elixir.honeyedHealing': of('elixir', S.ELIXIR_HONEY),
  'elixir.icyTouch': of('elixir', S.ELIXIR_ICY),
  'elixir.might': of('elixir', S.ELIXIR_MIGHT),
  'elixir.toxicEssence': of('elixir', S.ELIXIR_TOXIC),

  // Trinkets (Trinket), in Generator.Category.TRINKET's order, from the trinket catalyst: each changes the run a little.
  'trinket.ratSkull': of('trinket', S.RAT_SKULL),
  'trinket.parchmentScrap': of('trinket', S.PARCHMENT_SCRAP),
  'trinket.petrifiedSeed': of('trinket', S.PETRIFIED_SEED),
  'trinket.exoticCrystals': of('trinket', S.EXOTIC_CRYSTALS),
  'trinket.mossyClump': of('trinket', S.MOSSY_CLUMP),
  'trinket.sundial': of('trinket', S.SUNDIAL),
  'trinket.clover': of('trinket', S.CLOVER),
  'trinket.trapMechanism': of('trinket', S.TRAP_MECHANISM),
  'trinket.mimicTooth': of('trinket', S.MIMIC_TOOTH),
  'trinket.wondrousResin': of('trinket', S.WONDROUS_RESIN),
  'trinket.eyeOfNewt': of('trinket', S.EYE_OF_NEWT),
  'trinket.saltCube': of('trinket', S.SALT_CUBE),
  'trinket.vialOfBlood': of('trinket', S.BLOOD_VIAL),
  'trinket.shardOfOblivion': of('trinket', S.OBLIVION_SHARD),
  'trinket.chaoticCenser': of('trinket', S.CHAOTIC_CENSER),
  'trinket.ferretTuft': of('trinket', S.FERRET_TUFT),
  'trinket.spyglass': of('trinket', S.SPYGLASS),
  /** TrinketCatalyst: brewed in the alchemy pot, it turns into one of four trinkets of the hero's choice. */
  'trinket.catalyst': of('catalyst', S.TRINKET_CATA),
  /** EnergyCrystal: picked up, it is alchemical energy (World.energy), not an item in the pack. */
  energy: of('energy', S.ENERGY),
  /** ArcaneResin: made from a wand, it gives a wand a level (up to +3). */
  resin: of('material', S.ARCANE_RESIN),
  /** LiquidMetal: made from thrown weapons, it repairs thrown weapons. */
  liquidMetal: of('material', S.LIQUID_METAL),
  /** GooBlob, MetalShard, Embers: what Goo, the blacksmith's mine and the wandmaker's elementals leave, for alchemy. */
  'quest.gooBlob': of('material', S.BLOB),
  'quest.metalShard': of('material', S.SHARD),
  'quest.embers': of('material', S.EMBER),
  /** Honeypot.ShatteredPot: what is left of a broken honeypot, which its bee still guards. */
  'honeypot.shattered': of('material', S.SHATTPOT),

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
  // Shattered's twelve (items/rings/, see rings.ts): Pixel Dungeon's mending, detection, shadows, power, satiety,
  // thorns, haggler and herbalism are gone (the ring of thorns became the cape of thorns, an artifact).
  'ring.accuracy': { category: 'ring' },
  'ring.arcana': { category: 'ring' },
  'ring.elements': { category: 'ring' },
  'ring.energy': { category: 'ring' },
  'ring.evasion': { category: 'ring' },
  'ring.force': { category: 'ring' },
  'ring.furor': { category: 'ring' },
  'ring.haste': { category: 'ring' },
  'ring.might': { category: 'ring' },
  'ring.sharpshooting': { category: 'ring' },
  'ring.tenacity': { category: 'ring' },
  'ring.wealth': { category: 'ring' },
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
  // The talents' food: the rogue's cached rations (SupplyRation: 200 energy and 5 health, a charge for the cloak) and the
  // huntress's berries (Berry: 100 energy; two of them grow a seed).
  'food.supply': { category: 'food', sprite: S.SUPPLY_RATION, energy: 200 },
  'food.berry': { category: 'food', sprite: S.BERRY, energy: 100 },
  // Mystery meat cooked by fire or frozen by frost (ChargrilledMeat, FrozenCarpaccio), and the
  // shops' smaller ration (SmallRation, Pixel Dungeon's overpriced one): half a ration each.
  'food.steak': { category: 'food', sprite: S.STEAK, energy: 150 },
  'food.carpaccio': { category: 'food', sprite: S.CARPACCIO, energy: 150 },
  'food.overpriced': { category: 'food', sprite: S.OVERPRICED, energy: 150 },
  // Alchemy's food (Shattered): mystery meat stewed (StewedMeat: Hunger.HUNGRY/2), a meat pie (MeatPie:
  // Hunger.STARVING*2, and well fed after), and the blandfruit (Hunger.STARVING), raw, cooked with a seed, or in chunks.
  'food.stewed': { category: 'food', sprite: S.STEWED, energy: 150 },
  'food.meatPie': { category: 'food', sprite: S.MEAT_PIE, energy: 900 },
  'food.blandfruit': { category: 'food', sprite: S.BLANDFRUIT, energy: 450 },
  'food.chunks': { category: 'food', sprite: S.BLAND_CHUNKS, energy: 450 },
  /** Shattered, it lets out a golden bee that fights for whoever broke it, for a while (Honeypot). */
  honeypot: { category: 'honeypot', sprite: S.HONEYPOT },
  /** The sacrificial fire's reward: read, it kills every monster on the level but its boss (ScrollOfWipeOut). */
  wipeOut: { category: 'wipeout', sprite: S.HALLS_PAGE },
  /** Thrown with its fuse lit, it blows up a moment after it lands (Bomb, bombs.ts). */
  bomb: { category: 'bomb', sprite: S.BOMB },
  // Bombs made better in the alchemy pot (Bomb.EnhanceBomb).
  'bomb.frost': { category: 'bomb', sprite: S.FROST_BOMB },
  'bomb.woolly': { category: 'bomb', sprite: S.WOOLY_BOMB },
  'bomb.fire': { category: 'bomb', sprite: S.FIRE_BOMB },
  'bomb.noisemaker': { category: 'bomb', sprite: S.NOISEMAKER },
  'bomb.smoke': { category: 'bomb', sprite: S.SMOKE_BOMB },
  'bomb.flashbang': { category: 'bomb', sprite: S.FLASHBANG },
  'bomb.regrowth': { category: 'bomb', sprite: S.REGROWTH_BOMB },
  'bomb.holy': { category: 'bomb', sprite: S.HOLY_BOMB },
  'bomb.arcane': { category: 'bomb', sprite: S.ARCANE_BOMB },
  'bomb.shrapnel': { category: 'bomb', sprite: S.SHRAPNEL_BOMB },
  /*
   * Artifacts (Artifact): each unique in a run, worn in the artifact or the misc slot; they charge
   * as time goes by and grow stronger with use (see artifacts/).
   */
  'artifact.cloak': { category: 'artifact', sprite: S.ARTIFACT_CLOAK },
  'artifact.horn': { category: 'artifact', sprite: S.ARTIFACT_HORN1 },
  'artifact.chalice': { category: 'artifact', sprite: S.ARTIFACT_CHALICE1 },
  'artifact.hourglass': { category: 'artifact', sprite: S.ARTIFACT_HOURGLASS },
  'artifact.talisman': { category: 'artifact', sprite: S.ARTIFACT_TALISMAN },
  'artifact.spellbook': { category: 'artifact', sprite: S.ARTIFACT_SPELLBOOK },
  'artifact.chains': { category: 'artifact', sprite: S.ARTIFACT_CHAINS },
  'artifact.rose': { category: 'artifact', sprite: S.ARTIFACT_ROSE1 },
  'artifact.armband': { category: 'artifact', sprite: S.ARTIFACT_ARMBAND },
  'artifact.sandals': { category: 'artifact', sprite: S.ARTIFACT_SANDALS },
  'artifact.cape': { category: 'artifact', sprite: S.ARTIFACT_CAPE },
  'artifact.toolkit': { category: 'artifact', sprite: S.ARTIFACT_TOOLKIT },
  /** Goo's legacy now and then: takes its bearer back to a place set beforehand (LloydsBeacon, an artifact in Shattered). */
  'artifact.beacon': { category: 'artifact', sprite: S.ARTIFACT_BEACON },
  /** TimekeepersHourglass.sandBag: sold in the shops to whoever has the hourglass, it makes it stronger. */
  sandbag: { category: 'sandbag', sprite: S.SANDBAG },
  /** DriedRose.Petal: found on the way down by whoever carries the rose, it makes the rose stronger. */
  petal: { category: 'petal', sprite: S.PETAL },
  /** Bags (SeedPouch, ScrollHolder, WandHolster), sold in the shops: what they hold takes no room in the backpack. */
  'bag.seeds': { category: 'bag', sprite: S.POUCH },
  'bag.scrolls': { category: 'bag', sprite: S.HOLDER },
  'bag.wands': { category: 'bag', sprite: S.HOLSTER },
  /** PotionBandolier: Shattered's fourth bag, for potions. */
  'bag.potions': { category: 'bag', sprite: S.BANDOLIER },
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
  /** CrystalKey: opens the crystal door or the crystal chests of the level it was found on. */
  'key.crystal': { category: 'key', sprite: S.CRYSTAL_KEY },
  /** WornKey: Goo's, it opens the locked way down from the sewers' boss level. */
  'key.skeleton': { category: 'key', sprite: S.WORN_KEY },
  /**
   * TengusMask: Tengu's, worn to choose a way to master (as the Tome of Mastery here). SEAM(talents): the
   * talents stream gives it its subclass choice.
   */
  'mask.tengu': { category: 'tome', sprite: S.MASK },
  /**
   * KingsCrown: the Dwarf King's, it turns the armour worn into class armour (as the armour kit here).
   * SEAM(abilities): the abilities stream gives it the choice of an armour ability.
   */
  'crown.king': { category: 'kit', sprite: S.CROWN },
  /** The sad ghost's dried rose. */
  'quest.rose': { category: 'quest', sprite: S.ARTIFACT_ROSE1 },
  /** The fetid rat's, for the sad ghost. */
  'quest.skull': { category: 'quest', sprite: S.RAT_SKULL },
  /** Dark gold, mined from the veins of the caves for the troll blacksmith. */
  'quest.ore': { category: 'quest', sprite: S.ORE },
  /** DwarfToken: what the dwarven vault's guards and treasures hold; ten open the vault's strange door. */
  'quest.token': { category: 'quest', sprite: S.TOKEN },
  /** EscapeCrystal: the imp's way out of the vault, holding the hero's belongings meanwhile (vault.ts). */
  'quest.escapeCrystal': { category: 'quest', sprite: S.ESCAPE },
  /** ImpStatue: the obsidian statuette the imp wants from the vault's treasury. */
  'quest.impStatue': { category: 'quest', sprite: S.STATUE },
  /** VaultBeacon: back to the vault's entry room, once. */
  'quest.vaultBeacon': { category: 'quest', sprite: S.RETURN_BEACON },
  /** What the old wandmaker is after: corpse dust, or a phantom fish (which can be eaten, for a moment unseen). */
  'quest.dust': { category: 'quest', sprite: S.DUST },
  'quest.fish': { category: 'quest', sprite: S.PHANTOM_MEAT },
  /** CeremonialCandle: four of them round the ritual site's marker summon a newborn fire elemental. */
  'quest.candle': { category: 'quest', sprite: S.CANDLE },
  /** Tengu's legacy: reading it, a hero masters one of two ways. */
  'tome.mastery': { category: 'tome', sprite: S.MASTERY },
  /** Lit, it lets one see further in the dark halls for a while. */
  torch: { category: 'torch', sprite: S.TORCH },
  /** SkeletonKey: Shattered v4's artifact, the vault's prize among others: it opens locks, locks doors and raises walls with its charge. */
  'artifact.skeletonKey': { category: 'artifact', sprite: S.ARTIFACT_KEY },
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
  /** Item.unique, where the kind does not say: the vault mirror's class items (their stand-ins), never taken out of the vault. */
  unique?: boolean;
  /**
   * Weapon.augment and Armor.augment (a stone of augmentation): a weapon for speed or for damage, armour for evasion
   * or for defence; absent, none.
   */
  augment?: Augment;
  /** Wands: levels given by arcane resin (Wand.resinBonus), part of `level`. */
  resin?: number;
  /** Blandfruit cooked with a seed: the potion it now carries (Blandfruit.potionAttrib). */
  potion?: ItemKind;
  /** The trinket catalyst: the four trinkets it can become, once rolled (TrinketCatalyst.rolledTrinkets). */
  rolled?: ItemKind[];
  /** A summoning spell's element, once imbued (SummonElemental.summonClass). */
  element?: 'fire' | 'frost' | 'shock' | 'chaos';
  /** A bomb lying with its fuse lit: when it goes off (Bomb.Fuse, on the depth's clock). See bombs.ts. */
  fuse?: number;
  /** A noisemaker set off by someone stepping on it: it calls the level every six turns until it blows (NoisemakerFuse). */
  triggered?: number;
  /*
   * Artifacts (Artifact): the level is Item.level (0 to the artifact's cap); `charge` and the build towards the
   * next (`partial`, as a wand's partialCharge), experience towards the next level (`exp`) and a `cooldown`
   * where the artifact has them. What else each one keeps is described in artifacts/.
   */
  charge?: number;
  exp?: number;
  cooldown?: number;
  /** CloakOfShadows.cloakStealth: under way, and the turns until it costs a charge again. */
  stealth?: { turnsToCost: number };
  /** TimekeepersHourglass: sandbags the shops have offered so far; its timeFreeze under way (charge build, cells pressed meanwhile). */
  sandBags?: number;
  freeze?: { turnsToCost: number; presses: number[] };
  /** HornOfPlenty.storedFoodEnergy. */
  stored?: number;
  /** UnstableSpellbook.scrolls: the scrolls it still wants, in the order it wants them. */
  scrolls?: ItemKind[];
  /** SandalsOfNature: the seeds fed to it towards the next level, and the plant it can grow (curSeedEffect). */
  seeds?: ItemKind[];
  seedEffect?: ItemKind;
  /** DriedRose: the ghost spoken to; summoned once already; the ghost hero's id while it is out; petals dropped so far; its gear. */
  talkedTo?: boolean;
  firstSummon?: boolean;
  ghost?: string;
  petals?: number;
  ghostWeapon?: Item;
  ghostArmor?: Item;
  /** TalismanOfForesight.warn: the hero has been warned of a trap nearby. */
  warn?: boolean;
  /** AlchemistsToolkit.warmUpDelay. */
  warmUp?: number;
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


/* Exotic potions and scrolls (ExoticPotion.regToExo, ExoticScroll.regToExo) */

/** Each potion's and scroll's exotic counterpart. */
export const EXOTIC_OF: Readonly<Partial<Record<ItemKind, ItemKind>>> = {
  'potion.strength': 'potion.mastery',
  'potion.healing': 'potion.shielding',
  'potion.mindVision': 'potion.magicalSight',
  'potion.frost': 'potion.snapFreeze',
  'potion.liquidFlame': 'potion.dragonsBreath',
  'potion.toxicGas': 'potion.corrosiveGas',
  'potion.haste': 'potion.stamina',
  'potion.invisibility': 'potion.shroudingFog',
  'potion.levitation': 'potion.stormClouds',
  'potion.paralyticGas': 'potion.earthenArmor',
  'potion.purity': 'potion.cleansing',
  'potion.experience': 'potion.divineInspiration',
  'scroll.upgrade': 'scroll.enchantment',
  'scroll.identify': 'scroll.divination',
  'scroll.removeCurse': 'scroll.antiMagic',
  'scroll.mirrorImage': 'scroll.prismaticImage',
  'scroll.recharging': 'scroll.mysticalEnergy',
  'scroll.teleportation': 'scroll.passage',
  'scroll.lullaby': 'scroll.sirensSong',
  'scroll.mapping': 'scroll.foresight',
  'scroll.rage': 'scroll.challenge',
  'scroll.retribution': 'scroll.psionicBlast',
  'scroll.terror': 'scroll.dread',
  'scroll.transmutation': 'scroll.metamorphosis',
};

/** Each exotic's ordinary counterpart (exoToReg). */
export const REGULAR_OF: Readonly<Partial<Record<ItemKind, ItemKind>>> = Object.fromEntries(
  Object.entries(EXOTIC_OF).map(([regular, exotic]) => [exotic, regular]),
);

export const isExotic = (kind: ItemKind): boolean => REGULAR_OF[kind] !== undefined;

/** The kind whose label (colour, rune) and knowledge an item shares: an exotic's ordinary counterpart, else itself. */
export const labelKind = (kind: ItemKind): ItemKind => REGULAR_OF[kind] ?? kind;

/** Whether the party knows a kind, given what it has learned: exotics are known with their ordinary counterpart. */
export const knownIn = (known: readonly ItemKind[], kind: ItemKind): boolean => known.includes(labelKind(kind));

/** Shattered's regular potions and scrolls, in the Generator's order (exotics aside). */
export const REGULAR_POTIONS = (Object.keys(ITEMS) as ItemKind[]).filter((k) => itemDef(k).category === 'potion' && !isExotic(k));
export const REGULAR_SCROLLS = (Object.keys(ITEMS) as ItemKind[]).filter((k) => itemDef(k).category === 'scroll' && !isExotic(k));

export const isStackable = (kind: ItemKind): boolean => {
  const category = itemDef(kind).category;
  return category === 'potion' || category === 'scroll' || category === 'gold' || category === 'food' || category === 'torch' ||
    category === 'seed' || category === 'bomb' || category === 'honeypot' || category === 'wipeout' || category === 'stone' ||
    category === 'spell' || category === 'brew' || category === 'elixir' || category === 'energy' || category === 'material' ||
    category === 'petal' ||
    category === 'missile' || kind === 'quest.token' || kind === 'quest.ore' || kind === 'quest.candle' ||
    kind === 'quest.impStatue' || kind === 'quest.vaultBeacon';
};

/**
 * Item.isSimilar for stacking: thrown weapons only those of one set and level (MissileWeapon.isSimilar); a cooked
 * blandfruit only with one cooked alike, a summoning spell with one of its element, a bomb not with one lit.
 */
export const stacksWith = (a: Item, b: Item): boolean =>
  a.kind === b.kind && isStackable(a.kind) && (itemDef(a.kind).category !== 'missile' || (a.level === b.level && a.set === b.set)) &&
  a.potion === b.potion && a.element === b.element && a.fuse === undefined && b.fuse === undefined;

export function createItem(kind: ItemKind, qty = 1, level = 0): Item {
  const item: Item = { kind, qty, level };
  if (itemDef(kind).category === 'wand') {
    item.charges = wandMaxCharges(item);
    item.partial = 0;
  }
  // A new artifact starts with the charge its kind sets out with.
  if (itemDef(kind).category === 'artifact') initArtifact(item);
  return item;
}

/* Prices (Item.value): what a shopkeeper pays; shops ask several times more. */

/** Shattered's Potion.value and Scroll.value of each kind, once known (30 while not). */
const POTION_PRICES: Partial<Record<ItemKind, number>> = {
  'potion.strength': 50, 'potion.healing': 30, 'potion.mindVision': 30, 'potion.frost': 30, 'potion.liquidFlame': 30,
  'potion.toxicGas': 30, 'potion.haste': 40, 'potion.invisibility': 40, 'potion.levitation': 40, 'potion.paralyticGas': 40,
  'potion.purity': 40, 'potion.experience': 50,
};
const SCROLL_PRICES: Partial<Record<ItemKind, number>> = {
  'scroll.upgrade': 50, 'scroll.identify': 30, 'scroll.removeCurse': 30, 'scroll.mirrorImage': 30, 'scroll.recharging': 30,
  'scroll.teleportation': 30, 'scroll.lullaby': 40, 'scroll.mapping': 40, 'scroll.rage': 40, 'scroll.retribution': 40,
  'scroll.terror': 40, 'scroll.transmutation': 50,
};
const FOOD_PRICES: Partial<Record<ItemKind, number>> = {
  'food.ration': 10, 'food.supply': 10, 'food.berry': 5, 'food.pasty': 20, 'food.meat': 5, 'food.steak': 5, 'food.carpaccio': 10, 'food.overpriced': 20,
  'food.stewed': 8, 'food.meatPie': 40, 'food.blandfruit': 20, 'food.chunks': 10,
};
/** Spells made several at a time are worth that share of their whole batch (e.g. 60 * quantity/OUT_QUANTITY). */
const SPELL_PRICES: Partial<Record<ItemKind, readonly [number, number]>> = {
  'spell.alchemize': [20, 8], 'spell.beacon': [60, 5], 'spell.curseInfusion': [60, 4], 'spell.magicalInfusion': [60, 1],
  'spell.phaseShift': [60, 6], 'spell.reclaimTrap': [60, 5], 'spell.recycle': [60, 12], 'spell.telekineticGrab': [50, 8],
  'spell.unstable': [40, 1], 'spell.wildEnergy': [60, 5],
};
const BOMB_PRICES: Partial<Record<ItemKind, number>> = {
  bomb: 15, 'bomb.frost': 50, 'bomb.woolly': 50, 'bomb.fire': 50, 'bomb.noisemaker': 60, 'bomb.smoke': 60, 'bomb.flashbang': 50,
  'bomb.regrowth': 50, 'bomb.holy': 50, 'bomb.arcane': 50, 'bomb.shrapnel': 70,
};

const MATERIAL_PRICES: Partial<Record<ItemKind, number>> = { resin: 30, liquidMetal: 1, 'quest.gooBlob': 30, 'quest.metalShard': 50, 'honeypot.shattered': 5 };

/** Value of one of a kind, as the Java value() with quantity 1 (unknown potions and scrolls at the plain 30). */
function unitValue(kind: ItemKind, known: boolean): number {
  const regular = REGULAR_OF[kind];
  // ExoticPotion.value / ExoticScroll.value: their counterpart's, and 20 or 30 more.
  if (regular) return unitValue(regular, known) + (itemDef(kind).category === 'potion' ? 20 : 30);
  if (itemDef(kind).category === 'potion') return known ? POTION_PRICES[kind] ?? 30 : 30;
  return known ? SCROLL_PRICES[kind] ?? 30 : 30;
}

/** Item.price; unknown potions and scrolls fetch a plain price. 0 for what cannot be sold. */
/** The four class armours (classArmor.ts's CLASS_ARMOR), which no shop will buy. */
const CLASS_ARMOR_KINDS: ReadonlySet<string> = new Set(['armor.warrior', 'armor.mage', 'armor.rogue', 'armor.huntress']);

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
      // Armor.value: the warrior's sealed armour is not for sale; nor is class armour (ClassArmor.value: 0).
      if (item.seal || CLASS_ARMOR_KINDS.has(item.kind)) return 0;
      return armorValue(item);
    case 'potion':
    case 'scroll':
      return unitValue(item.kind, known) * item.qty;
    case 'food':
      return (FOOD_PRICES[item.kind] ?? 10) * item.qty;
    case 'missile':
      return missileValue(item);
    case 'wand':
      // Wand.value.
      return levelled(75);
    case 'torch':
      return 10 * item.qty;
    // Ring.value.
    case 'ring':
      return levelled(75);
    case 'seed':
      return 10 * item.qty;
    case 'ankh':
      return 50 * item.qty;
    case 'bomb':
      return (BOMB_PRICES[item.kind] ?? 15) * item.qty;
    case 'honeypot':
      // Honeypot.value.
      return 30 * item.qty;
    case 'bag':
      // Bag.value: the pouch 30, the holder and the bandolier 40, the holster 60.
      return ({ 'bag.seeds': 30, 'bag.scrolls': 40, 'bag.potions': 40, 'bag.wands': 60 } as Partial<Record<ItemKind, number>>)[item.kind] ?? 50;
    case 'wipeout':
      return 100 * item.qty;
    case 'stone':
      // Runestone.value; the stones of augmentation and enchantment are worth twice as much.
      return (item.kind === 'stone.augmentation' || item.kind === 'stone.enchantment' ? 30 : 15) * item.qty;
    case 'spell': {
      const [value, batch] = SPELL_PRICES[item.kind] ?? [0, 1];
      return Math.trunc(Math.fround(value * Math.fround(item.qty / batch)));
    }
    case 'brew':
      // Brew.value; the unstable brew 40, the aqua brew a share of its batch of eight.
      if (item.kind === 'brew.aqua') return Math.trunc(Math.fround(60 * Math.fround(item.qty / 8)));
      return (item.kind === 'brew.unstable' ? 40 : 60) * item.qty;
    case 'elixir':
      return (item.kind === 'elixir.honeyedHealing' ? 40 : 60) * item.qty;
    case 'material':
      // ArcaneResin, LiquidMetal, GooBlob and MetalShard and a shattered honeypot (five; embers are worth nothing).
      return (MATERIAL_PRICES[item.kind] ?? 0) * item.qty;
    case 'artifact':
      return artifactValue(item);
    // TimekeepersHourglass.sandBag.value.
    case 'sandbag':
      return 30 * item.qty;
    default:
      return 0;
  }
}

/**
 * Item.energyVal: how much alchemical energy an item turns into (WndEnergizeItem); 0 for what cannot be.
 * Unknown potions and scrolls give the plain amount, so it gives nothing away.
 */
export function energyValue(item: Item, known: boolean): number {
  const { kind, qty } = item;
  const category = itemDef(kind).category;
  const batch = (value: number, out: number): number => Math.trunc(Math.fround(value * Math.fround(qty / out)));
  switch (category) {
    case 'potion':
    case 'scroll': {
      const regular = REGULAR_OF[kind];
      const base = (k: ItemKind): number =>
        // PotionOfStrength, PotionOfExperience, ScrollOfUpgrade, ScrollOfTransmutation: 10 once known.
        known && ['potion.strength', 'potion.experience', 'scroll.upgrade', 'scroll.transmutation'].includes(k) ? 10 : 6;
      // ExoticPotion.energyVal: 4 more; ExoticScroll.energyVal: 6 more.
      if (regular) return (base(regular) + (category === 'potion' ? 4 : 6)) * qty;
      return base(kind) * qty;
    }
    case 'stone':
      return (kind === 'stone.augmentation' || kind === 'stone.enchantment' ? 5 : 3) * qty;
    case 'seed':
      // Plant.Seed.energyVal; Rotberry's (and Starflower's) 3.
      return (kind === 'seed.rotberry' ? 3 : 2) * qty;
    case 'brew':
      if (kind === 'brew.aqua') return batch(12, 8);
      return (kind === 'brew.unstable' ? 8 : 12) * qty;
    case 'elixir':
      return (kind === 'elixir.honeyedHealing' ? 8 : 12) * qty;
    case 'spell':
      switch (kind) {
        case 'spell.alchemize': return batch(4, 8);
        case 'spell.beacon': return batch(12, 5);
        case 'spell.curseInfusion': return batch(12, 4);
        case 'spell.magicalInfusion': return 12 * qty;
        case 'spell.phaseShift': return batch(12, 6);
        case 'spell.reclaimTrap': return batch(12, 5);
        case 'spell.recycle': return batch(12, 12);
        case 'spell.telekineticGrab': return batch(10, 8);
        case 'spell.unstable': return 8 * qty;
        case 'spell.wildEnergy': return batch(12, 5);
        default: return 0;
      }
    case 'trinket':
      // Trinket.energyVal, whatever its level.
      return 5;
    case 'material':
      return kind === 'quest.gooBlob' || kind === 'quest.metalShard' ? 3 * qty : 0;
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
    // Exotics take the label of their counterpart (ExoticPotion.reset, ExoticScroll.reset).
    const kinds = (Object.keys(ITEMS) as ItemKind[]).filter(
      (kind) => itemDef(kind).category === category && itemDef(kind).sprite === undefined && !isExotic(kind),
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
  if (def.category === 'artifact') return artifactSprite(item);
  if (def.sprite !== undefined) return def.sprite;
  const label = labels[labelKind(item.kind)] ?? 0;
  if (def.category === 'ring') return RING_SPRITES[label]!;
  // ExoticPotion and ExoticScroll: the counterpart's flask or scroll, one row down.
  const exotic = isExotic(item.kind) ? 16 : 0;
  return (def.category === 'potion' ? POTION_SPRITES[label]! : SCROLL_SPRITES[label]!) + exotic;
}

/** The label (colour index, rune index) a potion or scroll goes by in this run, exotics by their counterpart's. */
export const labelOf = (kind: ItemKind, labels: Labels): number => labels[labelKind(kind)] ?? 0;

/* Generator */

/** Categories the generator picks from: melee weapons, armour and thrown weapons each their own (gear.ts). */
export type GeneratedCategory =
  'gold' | 'potion' | 'scroll' | 'weapon' | 'armor' | 'missile' | 'food' | 'wand' | 'ring' | 'artifact' | 'seed' | 'misc' | 'stone';

/**
 * How often each category comes up. Gear keeps its share of the finds, split as Shattered's category decks split it
 * (Generator.Category: weapons 4, armour 3, thrown weapons 3 in seventy finds); the deck of categories itself is
 * not ported here. Artifacts come as often as rings (Shattered's two decks hold a ring and an artifact, one each),
 * and only while the run has some left (see randomArtifact). Shattered's runestones (Generator.Category.STONE) come
 * one to eight potions there; here they get that share of the potions' weight.
 */
const CATEGORY_CHANCES: ReadonlyArray<readonly [GeneratedCategory, number]> = [
  ['weapon', 10], ['armor', 7.5], ['missile', 7.5], ['potion', 50], ['scroll', 40], ['wand', 4], ['ring', 2], ['artifact', 2], ['seed', 5],
  ['gold', 50], ['misc', 5], ['stone', 6],
];

const KIND_CHANCES: Readonly<Record<
  Exclude<GeneratedCategory, 'gold' | 'food' | 'misc' | 'weapon' | 'armor' | 'missile' | 'wand' | 'artifact' | 'potion' | 'scroll' | 'stone'>,
  ReadonlyArray<readonly [ItemKind, number]>
>> = {
  seed: [
    ['seed.firebloom', 1], ['seed.icecap', 1], ['seed.sorrowmoss', 1], ['seed.dreamweed', 1], ['seed.sungrass', 1],
    ['seed.earthroot', 1], ['seed.fadeleaf', 1],
  ],
  // Thorns and haggler are only dropped by DM-300 and thieves.
  // Generator.Category.RING: the twelve alike.
  ring: [
    ['ring.accuracy', 3], ['ring.arcana', 3], ['ring.elements', 3], ['ring.energy', 3], ['ring.evasion', 3], ['ring.force', 3],
    ['ring.furor', 3], ['ring.haste', 3], ['ring.might', 3], ['ring.sharpshooting', 3], ['ring.tenacity', 3], ['ring.wealth', 3],
  ],
};

/**
 * Shattered's decks (Generator.Category with defaultProbs): potions, scrolls, runestones and trinkets are drawn
 * like cards, each card once until the deck is spent, then it is dealt again; potions and scrolls have two decks
 * dealt in turn (defaultProbs2), one with a fourth more of the dangerous and none of the experience or
 * transmutation. Strength and upgrade come only as guaranteed finds; enchantment and augmentation stones too.
 */
export type DeckCategory = 'potion' | 'scroll' | 'stone' | 'trinket';

const DECKS: Readonly<Record<DeckCategory, { kinds: readonly ItemKind[]; probs: readonly number[]; probs2?: readonly number[] }>> = {
  potion: { kinds: REGULAR_POTIONS, probs: [0, 3, 2, 1, 2, 1, 1, 1, 1, 1, 1, 1], probs2: [0, 3, 2, 2, 1, 2, 1, 1, 1, 1, 1, 0] },
  scroll: { kinds: REGULAR_SCROLLS, probs: [0, 3, 2, 1, 2, 1, 1, 1, 1, 1, 1, 1], probs2: [0, 3, 2, 2, 1, 2, 1, 1, 1, 1, 1, 0] },
  stone: {
    kinds: (Object.keys(ITEMS) as ItemKind[]).filter((k) => itemDef(k).category === 'stone'),
    probs: [0, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 0],
  },
  trinket: { kinds: (Object.keys(ITEMS) as ItemKind[]).filter((k) => itemDef(k).category === 'trinket'), probs: Array(17).fill(1) },
};
const DECK_STREAM: Readonly<Record<DeckCategory, number>> = { potion: 71, scroll: 72, stone: 73, trinket: 74 };

/** A deck's state in a run (Category.probs, using2ndProbs, dropped). */
export interface Deck {
  probs: number[];
  second: boolean;
  dropped: number;
}

/**
 * Generator.fullReset for one deck: which of the two decks comes first is a coin (Random.Int(2)), and reset() then
 * turns to the other, as the original does.
 */
function newDeck(run: { seed: number }, category: DeckCategory): Deck {
  const def = DECKS[category];
  const coin = def.probs2 !== undefined && Rng.seeded(deriveSeed(run.seed, DECK_STREAM[category])).int(2) === 0;
  const second = def.probs2 !== undefined && !coin;
  return { probs: [...(second ? def.probs2! : def.probs)], second, dropped: 0 };
}

/**
 * Generator.random(cat) for a deck: the card comes from the deck's own seeded stream (Random.pushGenerator(cat.seed),
 * skipping what was dealt), so finds do not depend on when they happen; a spent deck is dealt again.
 */
export function drawFromDeck(run: { seed: number; kindDecks?: Partial<Record<DeckCategory, Deck>> }, category: DeckCategory): ItemKind {
  const def = DECKS[category];
  const deck = ((run.kindDecks ??= {})[category] ??= newDeck(run, category));
  const rng = Rng.seeded(deriveSeed(run.seed, DECK_STREAM[category], deck.dropped));
  // Random.chances gives -1 for a spent deck.
  let i = deck.probs.some((p) => p > 0) ? rng.chances(deck.probs) : -1;
  if (i === -1) {
    // Generator.reset: the other deck, or the same one again.
    if (def.probs2) deck.second = !deck.second;
    deck.probs = [...(deck.second ? def.probs2! : def.probs)];
    i = rng.chances(deck.probs);
  }
  deck.probs[i]!--;
  deck.dropped++;
  return def.kinds[i]!;
}

/** Generator.randomUsingDefaults: a kind by the whole deck's odds (both decks together for potions and scrolls). */
export function drawUsingDefaults(rng: Rng, category: DeckCategory): ItemKind {
  const def = DECKS[category];
  const probs = def.probs2 ? def.probs.map((p, i) => p + def.probs2![i]!) : [...def.probs];
  return def.kinds[rng.chances(probs)]!;
}

/** What the generator is told of the run and of the hero's trinkets (see trinkets.ts). */
export interface GenOptions {
  /** The run, for the decks: without it, kinds come by the default odds (Generator.randomUsingDefaults). */
  run?: RunState;
  /** ExoticCrystals.consumableExoticChance: how often a potion or scroll comes exotic. */
  exotic?: number;
  /** ParchmentScrap.enchantChanceMultiplier and curseChanceMultiplier. */
  enchant?: number;
  curse?: number;
}

/** Generator.Category.SCROLL's default chances (the unstable spellbook reads by them). */
export const scrollChances = (): ReadonlyArray<readonly [ItemKind, number]> =>
  DECKS.scroll.kinds.map((kind, i) => [kind, DECKS.scroll.probs[i]!] as const);
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

/** Ring.random: +0 two times in three, +1 four in fifteen, +2 one in fifteen; three in ten cursed (which works against its wearer). */
export function randomRing(rng: Rng, kind: ItemKind): Item {
  let level = 0;
  if (rng.int(3) === 0) {
    level++;
    if (rng.int(5) === 0) level++;
  }
  const ring = createItem(kind, 1, level);
  if (rng.float() < 0.3) ring.cursed = true;
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

  /** With the run, potions, scrolls, runestones and wands come from its decks (Generator.random); without, by the default odds. */
  constructor(private readonly rng: Rng, private readonly depth: number, private readonly options: GenOptions = {}) {}

  /** The run's state the decks are kept in, if this generator has it. */
  get runState(): RunState | undefined {
    return this.options.run;
  }

  random(): Item {
    const category = this.rng.chancesOf(this.chances)!;
    this.chances.set(category, this.chances.get(category)! / 2);
    return this.of(category);
  }

  /** A potion, scroll or runestone kind: from the run's deck when there is one, by the default odds otherwise. */
  private draw(category: 'potion' | 'scroll' | 'stone'): ItemKind {
    let kind = this.options.run ? drawFromDeck(this.options.run, category) : drawUsingDefaults(this.rng, category);
    // Generator.random: now and then exotic, with exotic crystals (ExoticCrystals.consumableExoticChance).
    const exotic = EXOTIC_OF[kind];
    if (exotic && (this.options.exotic ?? 0) > 0 && this.rng.float() < this.options.exotic!) kind = exotic;
    return kind;
  }

  of(category: GeneratedCategory): Item {
    if (category === 'gold') return rollGold(this.rng, this.depth);
    // Generator.random(ARTIFACT): out of artifacts, a ring instead.
    if (category === 'artifact') return (this.options.run ? randomArtifact(this.options.run, this.rng) : null) ?? this.of('ring');
    if (category === 'food') return rollFood(this.rng);
    // Generator.Category.MISC: two bombs to every honeypot; bombs come one to three at a time.
    if (category === 'misc') return this.rng.chances([2, 1]) === 0 ? createItem('bomb', this.rng.intRange(1, 3)) : createItem('honeypot');
    if (category === 'potion' || category === 'scroll' || category === 'stone') return createItem(this.draw(category));
    // Generator.randomWeapon, randomArmor and randomMissile, as found (gear.ts).
    if (category === 'weapon') return randomWeapon(this.rng, this.depth, this.options.run);
    if (category === 'armor') return randomArmor(this.rng, this.depth);
    if (category === 'missile') return randomMissile(this.rng, this.depth, this.options.run);
    if (category === 'wand') {
      // Wand.random: as found, it tells neither its level nor its curse, nor its charges (ident.ts).
      const kind = this.options.run ? wandFromDeck(this.options.run) : WAND_KINDS[this.rng.chances(WAND_KINDS.map(() => 3))]!;
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
/** `goldenMimic` and `crystalMimic`: mimics looking like a locked and a crystal chest (GoldenMimic, CrystalMimic); `remains`: a pit room's. */
export type HeapKind =
  | 'heap' | 'chest' | 'skeleton' | 'tomb' | 'forSale' | 'mimic' | 'lockedChest' | 'crystalChest' | 'hidden' | 'goldenMimic' | 'crystalMimic'
  | 'remains';

export interface Heap {
  pos: number;
  kind: HeapKind;
  items: Item[];
  /** Heap.haunted: remains with something cursed among them; disturbing them raises a wraith. */
  haunted?: boolean;
  /** Heap.autoExplored: made by the level for show, not counted as something missed. */
  autoExplored?: boolean;
}

/** Sprites of closed containers in items.png. */
/** A mimic looks just like a chest. */
export const HEAP_SPRITES: Readonly<Record<Exclude<HeapKind, 'heap' | 'forSale'>, number>> = {
  chest: S.CHEST, skeleton: S.BONES, tomb: S.TOMB, mimic: S.CHEST, lockedChest: S.LOCKED_CHEST, crystalChest: S.CRYSTAL_CHEST, remains: S.REMAINS,
  goldenMimic: S.LOCKED_CHEST, crystalMimic: S.CRYSTAL_CHEST,
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

/**
 * ShopRoom.generateItems' rare ware: in one shop in ten a wand, in one a ring (both +0), in one an
 * artifact, never cursed and known not to be; in the rest Shattered's stylus (gold for now).
 */
function shopRare(generator: ItemGenerator, rng: Rng): Item | null {
  let rare: Item;
  switch (rng.int(10)) {
    case 0:
      rare = generator.of('wand');
      rare.level = 0;
      rare.charges = wandMaxCharges(rare);
      break;
    case 1:
      rare = generator.of('ring');
      rare.level = 0;
      break;
    case 2:
      rare = generator.of('artifact');
      break;
    default:
      // Seam (gear stream): Shattered's arcane stylus goes here; until it exists, nothing.
      return null;
  }
  delete rare.cursed;
  delete rare.curseUnknown;
  return rare;
}

/** Rolls what a painter asked for. */
export function rollSpec(spec: ItemSpec, generator: ItemGenerator, rng: Rng, depth: number): Item | null {
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
      return createItem(spec.kind, spec.qty ?? 1);
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
    case 'artifact':
      return generator.of('artifact');
    case 'rare':
      return shopRare(generator, rng);
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
/** What the hero's trinkets do to a new level's finds (see trinkets.ts levelTrinkets). */
export interface LevelTrinkets {
  exotic?: number;
  enchant?: number;
  curse?: number;
  spyglass?: number;
  mimics?: number;
}

const SPYGLASS_STREAM = 75;

export function createItems(
  run: RunState, level: Level, rng: Rng, boss: boolean, party = 1, land: (item: Item) => Item = (item) => item,
  trinkets: LevelTrinkets = {},
): Heap[] {
  const heaps: Heap[] = [];
  const drop = (pos: number, kind: HeapKind, item: Item | null): void => {
    if (pos < 0 || !item) return;
    const heap = heaps.find((h) => h.pos === pos);
    if (heap) heap.items.push(land(item));
    else heaps.push({ pos, kind, items: [land(item)] });
  };
  const generator = new ItemGenerator(rng, level.depth, { run, exotic: trinkets.exotic, enchant: trinkets.enchant, curse: trinkets.curse });
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
    let kind: HeapKind = roll === 0 ? 'skeleton' : roll === 5 && level.depth > 1 ? 'mimic' : roll <= 5 ? 'chest' : 'heap';
    // MimicTooth.mimicChanceMultiplier: each time more mimics turns a fourth of the plain chests into mimics (a seam
    // for the mobs stream's stealthy and ebony mimics).
    const mimics = trinkets.mimics ?? 1;
    if (kind === 'chest' && mimics > 1 && level.depth > 1 && rng.float() < (mimics - 1) / 4) kind = 'mimic';
    const item = generator.random();
    // RegularLevel.createItems: half the artifacts lie in a locked chest, its golden key somewhere on the level.
    if (itemDef(item.kind).category === 'artifact' && rng.int(2) === 0) {
      const pos = randomDropCell(rng, level);
      if (pos >= 0 && !heaps.some((h) => h.pos === pos)) {
        drop(pos, 'lockedChest', item);
        drop(randomDropCell(rng, level), 'heap', { ...createItem('key.golden'), depth: level.depth });
        continue;
      }
    }
    drop(randomDropCell(rng, level), kind, item);
  }

  // Level.create's limited drops: a stone of intuition and the trinket catalyst once in the first floors, a stone
  // of enchantment once in the prison or the caves (Dungeon.intStoneNeeded, trinketCataNeeded, enchStoneNeeded).
  const chance = (n: number): boolean => n <= 0 || rng.int(n) === 0;
  const drops = (run.drops ??= {});
  if (level.depth < 5 && !drops.intStone && chance(4 - level.depth)) {
    drops.intStone = true;
    drop(randomDropCell(rng, level), 'heap', createItem('stone.intuition'));
  }
  if (level.depth < 5 && !drops.catalyst && chance(4 - level.depth)) {
    // RegularLevel.createItems: the catalyst in a locked chest, its golden key somewhere else on the level.
    drops.catalyst = true;
    drop(randomDropCell(rng, level), 'lockedChest', createItem('trinket.catalyst'));
    drop(randomDropCell(rng, level), 'heap', { ...createItem('key.golden'), depth: level.depth });
  }
  if (level.depth >= 5 && !drops.enchStone) {
    let visited = level.depth - 5;
    if (visited > 4) visited--;
    if (chance(9 - visited)) {
      drops.enchStone = true;
      drop(randomDropCell(rng, level), 'heap', createItem('stone.enchantment'));
    }
  }
  // CrackedSpyglass.extraLootChance: more finds, hidden, from a stream of their own.
  if ((trinkets.spyglass ?? 0) > 0) {
    const spy = Rng.seeded(deriveSeed(run.seed, SPYGLASS_STREAM, level.depth));
    const extra = Math.trunc(spy.float() + trinkets.spyglass!);
    const found = new ItemGenerator(spy, level.depth, { exotic: trinkets.exotic });
    for (let i = 0; i < extra; i++) drop(randomDropCell(spy, level), 'hidden', found.random());
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
  run?: RunState,
): void {
  const drop = (pos: number, kind: HeapKind, item: Item): void => {
    if (pos < 0) return;
    const heap = heaps.find((h) => h.pos === pos);
    if (heap) heap.items.push(land(item));
    else heaps.push({ pos, kind, items: [land(item)] });
  };

  const generator = new ItemGenerator(rng, level.depth, { run });
  const extra = lootCount(3, party) - lootCount(3, party - 1);
  for (let i = 0; i < extra; i++) {
    const roll = rng.int(20);
    const kind: HeapKind = roll <= 5 && roll > 0 ? 'chest' : 'heap';
    drop(randomDropCell(rng, level), kind, generator.random());
  }
  drop(randomDropCell(rng, level), 'heap', rollFood(rng));
  for (const kind of perHero) drop(randomDropCell(rng, level), 'heap', createItem(kind));
}
