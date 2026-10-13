import { effectiveLevel } from './wear';
import { armorStats, type Item, type ItemKind, missileStats, type WeaponStats, weaponStats } from './items';
import { type HeroClass, startingKit } from './heroclass';
import { isStarving } from './hero';
import type { Rng } from './rng';
import type { Action, PlanStep } from './world';

/*
 * Heroes and monsters as plain data: the hero's numbers as Shattered Pixel
 * Dungeon has them (Hero: accuracy, evasion, damage and speed with what is
 * worn; the kits are in heroclass.ts, the rest of the hero's rules in
 * hero.ts), and the monsters' with the original's Bestiary.
 */

const f32 = Math.fround;

export type { HeroClass } from './heroclass';
export { HUNGRY, isHungry, isStarving, STARVING } from './hero';

/** HeroSubClass: the two ways each class can master with the Tome of Mastery. */
export type SubClass = 'gladiator' | 'berserker' | 'battlemage' | 'warlock' | 'freerunner' | 'assassin' | 'sniper' | 'warden';
export const SUBCLASSES: Readonly<Record<HeroClass, readonly [SubClass, SubClass]>> = {
  warrior: ['gladiator', 'berserker'],
  mage: ['battlemage', 'warlock'],
  rogue: ['freerunner', 'assassin'],
  huntress: ['sniper', 'warden'],
};

/** Backpack slots, equipment aside. */
export const BACKPACK_SIZE = 20;

export interface Hero {
  id: string;
  name: string;
  heroClass: HeroClass;
  depth: number;
  pos: number;
  hp: number;
  /** Hero.HT: 20, five more a level, and whatever potions of might added (htBoost); see hero.ts updateHT. */
  ht: number;
  htBoost?: number;
  str: number;
  lvl: number;
  exp: number;
  /** Base accuracy and evasion; each grows by one per level. */
  attackSkill: number;
  defenseSkill: number;
  /** When the hero acts next, on its depth's clock. */
  time: number;
  /** The player's chosen action, performed when the hero's turn comes. */
  intent: Action | null;
  /** Live turns (world.live): what the player has told the hero to do, done a turn at a time (see liveTick). */
  plan?: PlanStep[];
  /** Regeneration.partialRegen: health regained towards the next point. */
  regen: number;
  /** Caustic ooze from Goo: time since it last burned, or -1 when clean. Water washes it off. */
  ooze: number;
  /** The weapon in hand; none after a monk's disarming blow, until the hero takes one up again. */
  weapon: Item | null;
  armor: Item;
  /** Rings worn, two at most. */
  rings: Item[];
  items: Item[];
  gold: number;
  /** Turns left of sensing every monster on the level / of being unseen. */
  mindVision: number;
  invisible: number;
  /** Turns left of poison (1 damage a turn), burning (washed off by water) and paralysis. */
  poison: number;
  burning: number;
  paralysed: number;
  /** Turns left of being rooted to the spot and of moving at half speed (mystery meat). */
  rooted: number;
  slowed: number;
  /** Turns left of weakness (a warlock's shadow bolt): two points of strength less. */
  weakened: number;
  /** Turns left of being crippled (moving at half speed), of a torch's light, and of a succubus's charm. */
  crippled: number;
  light: number;
  charmed: number;
  /** Whom the hero is charmed by, and cannot bring themselves to attack. */
  charmedBy: string | null;
  /** Turns left of staggering about (dreamweed's confusion gas). */
  dizzy: number;
  /** The way the hero has mastered, once they have read the Tome of Mastery. */
  subclass: SubClass | null;
  /** Gladiator: hits in a row, and until when the next one keeps the combo going. */
  combo: number;
  comboUntil: number;
  /** Warden: bark from trampled grass and plants, adding to armour and wearing off a point a turn. */
  barkskin: number;
  /** Sungrass: the spot it heals the hero on, while they stay there (-1 when not), and time towards the next healing. */
  sungrass?: number;
  sungrassTime?: number;
  /** Earthroot: bark that takes the blows while the hero stays on that spot. */
  earthroot?: { pos: number; level: number } | null;
  /** Armour of viscosity: damage still to be taken, a point a turn. */
  deferred?: number;
  /** Turns left of being blinded (a scroll of psionic blast): the hero sees nothing beyond arm's reach. */
  blind?: number;
  /** Bleeding (an albino rat's bite): how hard it still bleeds; it hurts every turn, less and less. */
  bleeding?: number;
  /** Turns left of being marked by the sacrificial fire: dying meanwhile, the hero is an offering. */
  marked?: number;
  /** Turns left of floating above traps and chasms (a potion of levitation). */
  levitating?: number;
  /** Turns left of breathing no gas (a potion of purity). */
  gasImmune?: number;
  /** Hunger.level: 0 when fed, hungry from HUNGRY, starving at STARVING (it grows a point a turn). */
  hunger: number;
  /** Unused since Shattered's hunger (kept for the shape of older saves). */
  hungerTime: number;
  /** Hunger.partialDamage: starvation's damage building up towards the next point. */
  starve?: number;
  /** LockedFloor.left: on a boss's sealed floor, the turns passive healing goes on (see hero.ts). */
  lockedFloor?: number;
  /** BrokenSeal.WarriorShield: the shield left, the cooldown, turns without an enemy in sight, the shield as raised (seal.ts). */
  sealShield?: { shield: number; cooldown: number; idle: number; initial: number };
  /** For the badges (Statistics): gold picked up, food eaten, potions brewed and piranhas slain this run. */
  stats?: RunStats;
  /** For the end of the run: monsters slain, and what dealt the killing blow. */
  kills: number;
  killedBy: string | null;
}

export interface RunStats {
  gold: number;
  food: number;
  brewed: number;
  piranhas: number;
}

/** A hero's run statistics, started on first use (older saves have none). */
export const statsOf = (hero: Hero): RunStats => (hero.stats ??= { gold: 0, food: 0, brewed: 0, piranhas: 0 });

export interface PlayerInfo {
  id: string;
  name: string;
  heroClass: HeroClass;
}

/** A new hero (Hero, HeroClass.initHero): 20 health, 10 strength, the class's kit (heroclass.ts). */
export function createHero(player: PlayerInfo, depth: number, pos: number, time: number): Hero {
  const kit = startingKit(player.heroClass);
  return {
    id: player.id,
    name: player.name,
    heroClass: player.heroClass,
    depth,
    pos,
    hp: 20,
    ht: 20,
    str: STARTING_STR,
    lvl: 1,
    exp: 0,
    attackSkill: 10,
    defenseSkill: 5,
    time,
    intent: null,
    regen: 0,
    ooze: -1,
    weapon: kit.weapon,
    armor: kit.armor,
    rings: kit.rings,
    items: kit.items,
    gold: 0,
    mindVision: 0,
    invisible: 0,
    poison: 0,
    burning: 0,
    paralysed: 0,
    rooted: 0,
    slowed: 0,
    weakened: 0,
    crippled: 0,
    light: 0,
    charmed: 0,
    charmedBy: null,
    dizzy: 0,
    subclass: null,
    combo: 0,
    comboUntil: 0,
    barkskin: 0,
    hunger: 0,
    hungerTime: 0,
    kills: 0,
    killedBy: null,
  };
}

/** Hero.STARTING_STR. */
export const STARTING_STR = 10;

export const isAlive = (char: { hp: number }): boolean => char.hp > 0;

/** The levels of every worn ring of a kind, added up (several buffs of a kind stack in the original). */
export const ringBonus = (hero: Hero, kind: ItemKind): number =>
  (hero.rings ?? []).reduce((sum, ring) => (ring.kind === kind ? sum + effectiveLevel(ring) : sum), 0);

/** Hero.STR: weakness takes two points of strength away while it lasts. */
export const heroStr = (hero: Hero): number => hero.str - (hero.weakened > 0 ? 2 : 0);

/** Fury.LEVEL: below this share of health, a berserker flies into a fury. */
export const FURY_LEVEL = 0.4;

/** The numbers of the weapon in hand, or of bare fists (RingOfForce.damageRoll without a ring: 1 to STR-8). */
export function heroWeapon(hero: Hero): WeaponStats {
  return hero.weapon ? weaponStats(hero.weapon) : { min: 1, max: Math.max(1, heroStr(hero) - 8), str: 0, accuracy: 1, delay: 1 };
}

/** Pixel Dungeon's ring of accuracy (1.4 a level), until rings are Shattered's (RingOfAccuracy.accuracyMultiplier). */
const accuracyMultiplier = (hero: Hero): number => {
  const bonus = ringBonus(hero, 'ring.accuracy');
  return bonus === 0 ? 1 : f32(1.4 ** bonus);
};

/**
 * Hero.attackSkill: the hero's accuracy, times the rings' and the weapon's (Weapon.accuracyFactor:
 * its own, divided by 1.5 for every point of strength it wants more); at least 1.
 */
export function heroAttackSkill(hero: Hero): number {
  const accuracy = accuracyMultiplier(hero);
  if (!hero.weapon) return Math.max(1, Math.round(f32(hero.attackSkill * accuracy)));
  const weapon = heroWeapon(hero);
  const encumbrance = weapon.str - heroStr(hero);
  const factor = encumbrance > 0 ? f32(weapon.accuracy / 1.5 ** encumbrance) : f32(weapon.accuracy);
  return Math.max(1, Math.round(f32(f32(hero.attackSkill * accuracy) * factor)));
}

/**
 * Hero.defenseSkill: the hero's evasion, times the rings' (Pixel Dungeon's ring of evasion, 1.2 a
 * level, until rings are Shattered's), halved while paralysed, divided by 1.5 for every point of
 * strength the armour wants more (Armor.evasionFactor); at least 1. A freerunner on the move is
 * twice as hard to hit (Pixel Dungeon's subclass, until the talents stream).
 */
export function heroDefenseSkill(hero: Hero): number {
  const bonus = ringBonus(hero, 'ring.evasion');
  let evasion = f32(hero.defenseSkill * (bonus === 0 ? 1 : f32(1.2 ** bonus)));
  if (hero.paralysed > 0) evasion = f32(evasion / 2);
  const encumbrance = armorStats(hero.armor).str - heroStr(hero);
  if (encumbrance > 0) evasion = f32(evasion / 1.5 ** encumbrance);
  if (hero.subclass === 'freerunner' && !isStarving(hero) && encumbrance <= 0) evasion *= 2;
  return Math.max(1, Math.round(evasion));
}

/**
 * Accuracy with a thrown weapon (Hero.attackSkill with a missile weapon): divided by 1.5 for every
 * point of strength it wants more, and nobody throws well point-blank (the gear stream ports
 * MissileWeapon.adjacentAccFactor). Shattered has no class bonuses here: Pixel Dungeon's clumsy
 * warrior and deft huntress are gone.
 */
export function heroRangedSkill(hero: Hero, item: Item, pointBlank: boolean): number {
  const encumbrance = missileStats(item).str - heroStr(hero);
  let factor = encumbrance > 0 ? f32(1 / 1.5 ** encumbrance) : 1;
  if (pointBlank) factor = f32(factor * 0.5);
  return Math.max(1, Math.round(f32(f32(hero.attackSkill * accuracyMultiplier(hero)) * factor)));
}

/**
 * Hero.speed: crippled, half as fast (Char.speed); armour too heavy slows its wearer, divided by 1.2
 * for every point of strength it wants more (Armor.speedFactor). A freerunner not starving nor
 * weighed down runs (Pixel Dungeon's subclass). Haste rings act on the time spent instead.
 */
export function heroSpeed(hero: Hero): number {
  const encumbrance = armorStats(hero.armor).str - heroStr(hero);
  const crippled = hero.crippled > 0 ? 0.5 : 1;
  const running = hero.subclass === 'freerunner' && !isStarving(hero) && encumbrance <= 0 ? 1.6 : 1;
  return (encumbrance > 0 ? 1 / 1.2 ** encumbrance : 1) * crippled * running;
}

/**
 * Hero.damageRoll: the weapon's roll (KindOfWeapon.damageRoll, a normal one), and up to a point more
 * for every point of strength to spare, for every class (MeleeWeapon.damageRoll); bare-handed, 1 to
 * STR-8 (RingOfForce.damageRoll).
 */
export function heroDamageRoll(hero: Hero, rng: Rng): number {
  const weapon = heroWeapon(hero);
  let damage = rng.normalIntRange(weapon.min, weapon.max);
  // Fury: a berserker badly hurt hits half as hard again (Pixel Dungeon's subclass).
  if (hero.subclass === 'berserker' && hero.hp > 0 && hero.hp <= hero.ht * FURY_LEVEL) damage = Math.trunc(damage * 1.5);
  if (hero.weapon) {
    const excess = heroStr(hero) - weapon.str;
    if (excess > 0) damage += rng.intRange(0, excess);
  }
  return damage;
}

/** Hero.attackDelay: the weapon's (Weapon.delayFactor), slower by 1.2 for every point of strength it wants more. */
export function heroAttackDelay(hero: Hero): number {
  const weapon = heroWeapon(hero);
  const encumbrance = weapon.str - heroStr(hero);
  return encumbrance > 0 ? f32(weapon.delay * 1.2 ** encumbrance) : weapon.delay;
}

/** Hero.dr: the armour's, and a warden's bark. */
export const heroArmor = (hero: Hero): number => armorStats(hero.armor).dr + Math.max(0, Math.ceil(hero.barkskin ?? 0));
export const heroStealth = (hero: Hero): number => ringBonus(hero, 'ring.shadows');
/** Hero.maxExp: what the next level costs. */
export const maxExp = (hero: Hero): number => 5 + hero.lvl * 5;

/* Monsters */

export type MobKind =
  | 'rat' | 'gnoll' | 'crab' | 'goo' | 'ghost' | 'shopkeeper' | 'wandmaker'
  | 'skeleton' | 'thief' | 'swarm' | 'shaman' | 'bat' | 'brute' | 'tengu'
  | 'spinner' | 'dm300'
  | 'elemental' | 'monk' | 'warlock' | 'golem' | 'king' | 'undead'
  | 'succubus' | 'eye' | 'scorpio' | 'yog' | 'rottingFist' | 'burningFist' | 'larva' | 'mimic'
  | 'statue' | 'piranha' | 'imp' | 'sheep' | 'blacksmith' | 'mirror'
  | 'albino' | 'bandit' | 'shielded' | 'senior' | 'acidic'
  | 'fetidRat' | 'curse' | 'ratKing' | 'wraith' | 'bee' | 'impShopkeeper';
/** `passive`: the sad ghost and the shopkeeper, who neither fight nor can be hurt; `fleeing`: a thief making off with its loot. */
export type MobState = 'sleeping' | 'wandering' | 'hunting' | 'fleeing' | 'passive';

/** Who keeps a shop: the shopkeeper, or the imp of the last one. */
export const isShopkeeper = (mob: { kind: MobKind }): boolean => mob.kind === 'shopkeeper' || mob.kind === 'impShopkeeper';

export interface MobStats {
  name: string;
  ht: number;
  attack: number;
  defense: number;
  damage: readonly [number, number];
  dr: number;
  exp: number;
  /** Heroes above this level no longer learn anything from it. */
  maxLvl: number;
  speed: number;
  /** Time a blow takes, if not one turn (the thief strikes twice as fast). */
  attackDelay?: number;
  /** Flies over traps and grass without disturbing them. */
  flying?: boolean;
}

export const MOBS: Readonly<Record<MobKind, MobStats>> = {
  rat: { name: 'marsupial rat', ht: 8, attack: 8, defense: 3, damage: [1, 5], dr: 1, exp: 1, maxLvl: 5, speed: 1 },
  gnoll: { name: 'gnoll scout', ht: 12, attack: 11, defense: 4, damage: [2, 5], dr: 2, exp: 2, maxLvl: 8, speed: 1 },
  crab: { name: 'sewer crab', ht: 15, attack: 12, defense: 5, damage: [3, 6], dr: 4, exp: 3, maxLvl: 9, speed: 2 },
  goo: { name: 'Goo', ht: 80, attack: 15, defense: 12, damage: [2, 12], dr: 2, exp: 10, maxLvl: 30, speed: 1 },
  ghost: { name: 'sad ghost', ht: 1, attack: 0, defense: 1000, damage: [0, 0], dr: 0, exp: 0, maxLvl: 0, speed: 0.5, flying: true },
  shopkeeper: { name: 'shopkeeper', ht: 1, attack: 0, defense: 1000, damage: [0, 0], dr: 0, exp: 0, maxLvl: 0, speed: 1 },
  /** ImpShopkeeper: an imp keeps the last shop, in the demon halls. */
  impShopkeeper: { name: 'ambitious imp', ht: 1, attack: 0, defense: 1000, damage: [0, 0], dr: 0, exp: 0, maxLvl: 0, speed: 1 },
  wandmaker: { name: 'old wandmaker', ht: 1, attack: 0, defense: 1000, damage: [0, 0], dr: 0, exp: 0, maxLvl: 0, speed: 1 },
  // The prison (depths 6-10).
  skeleton: { name: 'skeleton', ht: 25, attack: 12, defense: 9, damage: [3, 8], dr: 5, exp: 5, maxLvl: 10, speed: 1 },
  thief: { name: 'crazy thief', ht: 20, attack: 12, defense: 12, damage: [1, 7], dr: 3, exp: 5, maxLvl: 10, speed: 1, attackDelay: 0.5 },
  swarm: { name: 'swarm of flies', ht: 80, attack: 12, defense: 5, damage: [1, 4], dr: 0, exp: 1, maxLvl: 10, speed: 1, flying: true },
  shaman: { name: 'gnoll shaman', ht: 18, attack: 11, defense: 8, damage: [2, 6], dr: 4, exp: 6, maxLvl: 14, speed: 1 },
  bat: { name: 'vampire bat', ht: 30, attack: 16, defense: 15, damage: [6, 12], dr: 4, exp: 7, maxLvl: 15, speed: 2, flying: true },
  brute: { name: 'gnoll brute', ht: 40, attack: 20, defense: 15, damage: [8, 18], dr: 8, exp: 8, maxLvl: 15, speed: 1 },
  tengu: { name: 'Tengu', ht: 120, attack: 20, defense: 20, damage: [8, 15], dr: 5, exp: 20, maxLvl: 30, speed: 1 },
  // The caves (depths 11-15).
  spinner: { name: 'cave spinner', ht: 50, attack: 20, defense: 14, damage: [12, 16], dr: 6, exp: 9, maxLvl: 16, speed: 1 },
  dm300: { name: 'DM-300', ht: 200, attack: 28, defense: 18, damage: [18, 24], dr: 10, exp: 30, maxLvl: 30, speed: 1 },
  // The dwarven city (depths 16-20).
  elemental: { name: 'fire elemental', ht: 65, attack: 25, defense: 20, damage: [16, 20], dr: 5, exp: 10, maxLvl: 20, speed: 1, flying: true },
  monk: { name: 'dwarf monk', ht: 70, attack: 30, defense: 30, damage: [12, 16], dr: 2, exp: 11, maxLvl: 21, speed: 1, attackDelay: 0.5 },
  warlock: { name: 'dwarf warlock', ht: 70, attack: 25, defense: 18, damage: [12, 20], dr: 8, exp: 11, maxLvl: 21, speed: 1 },
  golem: { name: 'golem', ht: 85, attack: 28, defense: 18, damage: [20, 40], dr: 12, exp: 12, maxLvl: 22, speed: 1, attackDelay: 1.5 },
  king: { name: 'King of Dwarves', ht: 300, attack: 32, defense: 25, damage: [20, 38], dr: 14, exp: 40, maxLvl: 30, speed: 1 },
  undead: { name: 'undead dwarf', ht: 28, attack: 16, defense: 15, damage: [12, 16], dr: 5, exp: 0, maxLvl: 30, speed: 1 },
  // The demon halls (depths 22-25).
  succubus: { name: 'succubus', ht: 80, attack: 40, defense: 25, damage: [15, 25], dr: 10, exp: 12, maxLvl: 25, speed: 1 },
  eye: { name: 'evil eye', ht: 100, attack: 30, defense: 20, damage: [14, 20], dr: 10, exp: 13, maxLvl: 25, speed: 1, attackDelay: 1.6, flying: true },
  scorpio: { name: 'scorpio', ht: 95, attack: 36, defense: 24, damage: [20, 32], dr: 16, exp: 14, maxLvl: 25, speed: 1 },
  yog: { name: 'Yog-Dzewa', ht: 300, attack: 0, defense: 0, damage: [0, 0], dr: 0, exp: 50, maxLvl: 30, speed: 1 },
  rottingFist: { name: 'rotting fist', ht: 300, attack: 36, defense: 25, damage: [24, 36], dr: 15, exp: 0, maxLvl: 30, speed: 1 },
  burningFist: { name: 'burning fist', ht: 200, attack: 36, defense: 25, damage: [20, 32], dr: 15, exp: 0, maxLvl: 30, speed: 1 },
  larva: { name: "god's larva", ht: 25, attack: 30, defense: 20, damage: [15, 20], dr: 8, exp: 0, maxLvl: 30, speed: 1 },
  // A chest that bites; its numbers grow with the depth (see mobStats).
  mimic: { name: 'mimic', ht: 16, attack: 10, defense: 5, damage: [1, 4], dr: 0, exp: 2, maxLvl: 30, speed: 1 },
  // Guardians of special rooms, as strong as their depth (see mobStats): a statue that comes alive, armed;
  // piranhas that never leave their pool.
  statue: { name: 'animated statue', ht: 20, attack: 10, defense: 5, damage: [1, 4], dr: 1, exp: 0, maxLvl: 30, speed: 1 },
  // Rare variants (Bestiary.mutable): one monster in thirty of these kinds is something worse.
  albino: { name: 'albino rat', ht: 15, attack: 8, defense: 3, damage: [1, 5], dr: 1, exp: 2, maxLvl: 5, speed: 1 },
  bandit: { name: 'crazy bandit', ht: 20, attack: 12, defense: 12, damage: [1, 7], dr: 3, exp: 5, maxLvl: 10, speed: 1, attackDelay: 0.5 },
  shielded: { name: 'shielded brute', ht: 40, attack: 20, defense: 20, damage: [8, 18], dr: 10, exp: 8, maxLvl: 15, speed: 1 },
  senior: { name: 'senior monk', ht: 70, attack: 30, defense: 30, damage: [12, 20], dr: 2, exp: 11, maxLvl: 21, speed: 1, attackDelay: 0.5 },
  acidic: { name: 'acidic scorpio', ht: 95, attack: 36, defense: 24, damage: [20, 32], dr: 16, exp: 14, maxLvl: 25, speed: 1 },
  sheep: { name: 'sheep', ht: 1, attack: 0, defense: 1000, damage: [0, 0], dr: 0, exp: 0, maxLvl: 0, speed: 1 },
  mirror: { name: 'mirror image', ht: 1, attack: 0, defense: 0, damage: [0, 0], dr: 0, exp: 0, maxLvl: 0, speed: 1 },
  blacksmith: { name: 'troll blacksmith', ht: 1, attack: 0, defense: 1000, damage: [0, 0], dr: 0, exp: 0, maxLvl: 0, speed: 1 },
  imp: { name: 'ambitious imp', ht: 1, attack: 0, defense: 1000, damage: [0, 0], dr: 0, exp: 0, maxLvl: 0, speed: 1 },
  // The sad ghost's errands: the rat that killed it, and the curse that binds it (its numbers grow with the depth).
  fetidRat: { name: 'fetid rat', ht: 15, attack: 12, defense: 5, damage: [2, 6], dr: 2, exp: 3, maxLvl: 5, speed: 1 },
  curse: { name: 'curse personification', ht: 16, attack: 12, defense: 12, damage: [3, 5], dr: 1, exp: 0, maxLvl: 5, speed: 0.5, flying: true },
  /** A vengeful spirit out of disturbed remains: one blow kills it, but it is very hard to hit (its numbers grow with the depth). */
  wraith: { name: 'wraith', ht: 1, attack: 11, defense: 55, damage: [1, 4], dr: 0, exp: 0, maxLvl: 30, speed: 1, flying: true },
  /** Out of a honeypot: it fights for whoever broke it, and lives a turn less every turn (its numbers grow with the depth). */
  bee: { name: 'golden bee', ht: 20, attack: 10, defense: 10, damage: [2, 5], dr: 0, exp: 0, maxLvl: 0, speed: 1, flying: true },
  /** Asleep (or so he says) in his hidden treasury beside Goo's lair. */
  ratKing: { name: 'rat king', ht: 1, attack: 0, defense: 1000, damage: [0, 0], dr: 0, exp: 0, maxLvl: 0, speed: 2 },
  piranha: { name: 'giant piranha', ht: 15, attack: 22, defense: 12, damage: [1, 6], dr: 1, exp: 0, maxLvl: 30, speed: 2 },
};

/** A monster's numbers: the table's, but a mimic is as strong as the depth it lurks on (Mimic.adjustStats). */
export function mobStats(mob: Mob): MobStats {
  const depth = mob.level ?? 1;
  if (mob.kind === 'statue' && mob.item) {
    // Statue: its numbers grow with the depth, and it fights with the weapon it holds.
    const weapon = weaponStats(mob.item);
    return {
      ...MOBS.statue, ht: 15 + depth * 5, attack: Math.trunc((9 + depth) * weapon.accuracy), defense: 4 + depth,
      damage: [weapon.min, weapon.max], dr: depth, attackDelay: weapon.delay,
    };
  }
  if (mob.kind === 'bee') {
    const ht = (3 + depth) * 5;
    return { ...MOBS.bee, ht, attack: 9 + depth, defense: 9 + depth, damage: [Math.trunc(ht / 10), Math.trunc(ht / 4)] };
  }
  if (mob.kind === 'wraith') return { ...MOBS.wraith, attack: 10 + depth, defense: (10 + depth) * 5, damage: [1, 3 + depth] };
  if (mob.kind === 'curse') return { ...MOBS.curse, ht: 10 + depth * 3, attack: 10 + depth, defense: 10 + depth };
  if (mob.kind === 'piranha') {
    return { ...MOBS.piranha, ht: 10 + depth * 5, attack: 20 + depth * 2, defense: 10 + depth * 2, damage: [depth, 4 + depth * 2], dr: depth };
  }
  if (mob.kind !== 'mimic') return MOBS[mob.kind];
  const level = depth;
  const ht = (3 + level) * 4;
  const attack = 9 + level;
  return {
    ...MOBS.mimic, ht, attack, defense: Math.trunc(attack / 2),
    damage: [Math.trunc(ht / 10), Math.trunc(ht / 4)], exp: 2 + Math.trunc((2 * (level - 1)) / 5),
  };
}

/** The brute, enraged when badly hurt: much harder hits. */
export const BRUTE_ENRAGED_DAMAGE = [10, 40] as const;

/** Goo, pumped up: harder hits from up to two cells away. */
export const GOO_PUMPED = { attack: 30, jumpAttack: 15, damage: [5, 30] as const, delay: 2 };

export interface Mob {
  /** '#' followed by a number, so it never clashes with a player id. */
  id: string;
  kind: MobKind;
  pos: number;
  hp: number;
  ht: number;
  state: MobState;
  /** The cell it is heading for, or -1. */
  target: number;
  /** The hero it is after. */
  enemy: string | null;
  enemySeen: boolean;
  /** Hurt since its last turn: it notices whoever is in sight at once. */
  alerted: boolean;
  time: number;
  /** Goo only: pumped up for a big attack. */
  pumped?: boolean;
  /** Turns left of being marked by the sacrificial fire: dying meanwhile, it is an offering. */
  marked?: number;
  /** Bitten by a golden bee (Mob.aggro): the bee it has turned on. */
  beeFoe?: string;
  /** The imp who keeps the last shop has greeted the heroes. */
  greeted?: boolean;
  /** The Rat King: woken by someone (though he says he was not asleep). */
  awake?: boolean;
  /** Turns left of poison, paralysis and burning from traps and potions. */
  poison?: number;
  paralysed?: number;
  burning?: number;
  /** Turns left of moving at half speed (wand of slowness). */
  slowed?: number;
  /** A thief's stolen goods, dropped when it dies. */
  item?: Item;
  /** Swarms: how many splits away from the original swarm. */
  generation?: number;
  /** Brutes: enraged below a quarter of their health. */
  enraged?: boolean;
  /** Tengu: attacks left before it jumps away. */
  jumpIn?: number;
  /** The King of Dwarves: which pedestal he summons his undead from next. */
  rightPedestal?: boolean;
  /** A mimic: the depth it lurks on, and the treasure it held. */
  level?: number;
  loot?: Item[];
  /** Turns left of staggering about. */
  dizzy?: number;
  /** Turns left of fleeing in terror from a hero (an eldritch weapon, a scroll of terror). */
  terror?: number;
  terrorOf?: string;
  /** Turns left of being charmed by a hero it then will not attack (armour of affection). */
  charmed?: number;
  charmedBy?: string;
  /** Turns left of running amok (a wand of amok): it attacks whoever is nearest, friend or foe. */
  amok?: number;
  /** Turns left of blind rage (Rage, from a scroll of challenge read in its sight): it charges over traps and chasms. */
  rage?: number;
  /** A magic sheep: turns left before it fades away. */
  lifespan?: number;
  /** Turns left of being held fast where it stands (a mage's molten earth), and of seeing nothing (a smoke bomb). */
  blind?: number;
  /** Turns left of being held fast where it stands (a mage's molten earth). */
  rooted?: number;
  /** Turns left of moving at half speed (a javelin's wound), and how hard it still bleeds (a tomahawk's). */
  crippled?: number;
  bleeding?: number;
  /** A mirror image: whose twin it is, and the skill and strength it took from them. */
  image?: { owner: string; attack: number; damage: number };
}

/** Mob.beckon: called towards a spot. Statue.beckon: an animated statue does not stir for it. */
export function beckon(mob: Mob, pos: number): void {
  if (mob.state === 'passive' || (mob.kind === 'statue' && mob.state === 'sleeping')) return;
  if (mob.state !== 'hunting') mob.state = 'wandering';
  mob.target = pos;
}

export function createMob(id: string, kind: MobKind, pos: number, state: MobState, time: number): Mob {
  const ht = MOBS[kind].ht;
  return { id, kind, pos, hp: ht, ht, state, target: -1, enemy: null, enemySeen: false, alerted: false, time };
}

/*
 * Who lives where (Bestiary.mobClass), with the original's rare visitors from
 * the region below: a swarm of flies, a skeleton or a thief in the sewers,
 * fire elementals and dwarf monks in the caves, a succubus in the city.
 * Depth 21, the last shop (LastShopLevel), has no monsters and no row: like
 * any depth beyond the table it would get the default.
 */
const BESTIARY: Readonly<Record<number, ReadonlyArray<readonly [MobKind, number]>>> = {
  1: [['rat', 1]],
  2: [['rat', 1], ['gnoll', 1]],
  3: [['rat', 1], ['gnoll', 2], ['crab', 1], ['swarm', 0.02]],
  4: [['rat', 1], ['gnoll', 2], ['crab', 3], ['swarm', 0.02], ['skeleton', 0.01], ['thief', 0.01]],
  5: [['goo', 1]],
  6: [['skeleton', 4], ['thief', 2], ['swarm', 1], ['shaman', 0.2]],
  7: [['skeleton', 3], ['shaman', 1], ['thief', 1], ['swarm', 1]],
  8: [['skeleton', 3], ['shaman', 2], ['gnoll', 1], ['thief', 1], ['swarm', 1], ['bat', 0.02]],
  9: [['skeleton', 3], ['shaman', 3], ['thief', 1], ['swarm', 1], ['bat', 0.02], ['brute', 0.01]],
  10: [['tengu', 1]],
  11: [['bat', 1], ['brute', 0.2]],
  12: [['bat', 1], ['brute', 1], ['spinner', 0.2]],
  13: [['bat', 1], ['brute', 3], ['shaman', 1], ['spinner', 1], ['elemental', 0.02]],
  14: [['bat', 1], ['brute', 3], ['shaman', 1], ['spinner', 4], ['elemental', 0.02], ['monk', 0.01]],
  15: [['dm300', 1]],
  16: [['elemental', 1], ['warlock', 1], ['monk', 0.2]],
  17: [['elemental', 1], ['monk', 1], ['warlock', 1]],
  18: [['elemental', 1], ['monk', 2], ['golem', 1], ['warlock', 1]],
  19: [['elemental', 1], ['monk', 2], ['golem', 3], ['warlock', 1], ['succubus', 0.02]],
  20: [['king', 1]],
  22: [['succubus', 1], ['eye', 1]],
  23: [['succubus', 1], ['eye', 2], ['scorpio', 1]],
  24: [['succubus', 1], ['eye', 2], ['scorpio', 3]],
  25: [['yog', 1]],
};

/**
 * Bestiary.mutable (Bestiary.mob when not `mutable`): a monster for the depth,
 * now and then (one in thirty) the rare variant of its kind. Beyond the
 * table, the original's default: an evil eye.
 */
export function rollMob(rng: Rng, depth: number, mutable = true): MobKind {
  const table = BESTIARY[depth] ?? [['eye', 1] as const];
  const kind = table[rng.chances(table.map(([, chance]) => chance))]![0];
  if (!mutable) return kind;
  // Random.Int(30) is drawn whatever the kind, as in the original.
  const rare = rng.int(30) === 0;
  const variant = VARIANTS[kind];
  return variant && rare ? variant : kind;
}


/** Bestiary.mutable: the rare variant of a kind, which behaves like it in most respects. */
const VARIANTS: Partial<Record<MobKind, MobKind>> = { rat: 'albino', thief: 'bandit', brute: 'shielded', monk: 'senior', scorpio: 'acidic' };
const BASE_KINDS: Partial<Record<MobKind, MobKind>> = Object.fromEntries(Object.entries(VARIANTS).map(([base, variant]) => [variant, base]));

/** The ordinary kind a rare variant is a version of (an albino rat is a rat). */
export const baseKind = (kind: MobKind): MobKind => BASE_KINDS[kind] ?? kind;
