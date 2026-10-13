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
  /** Turns left of Weakness (a red shaman's bolt): blows two thirds as hard. */
  weakened: number;
  /** Turns left of being crippled (moving at half speed), of a torch's light, and of a succubus's charm. */
  crippled: number;
  light: number;
  charmed: number;
  /** Whom the hero is charmed by, and cannot bring themselves to attack. */
  charmedBy: string | null;
  /** Charm.ignoreNextHit: the next blow taken does not shake the charm (a succubus's kiss is one). */
  charmShrug?: boolean;
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
  /** Turns left of Bless (from experience at the level cap): a quarter more accurate and evasive. */
  blessed?: number;
  /** Turns left of Vulnerable (a blue shaman's bolt: a third more harm, after the armour), Hex (a purple one's: a fifth worse at hitting and dodging). */
  vulnerable?: number;
  hexed?: number;
  /** Turns left of Degrade (a warlock's bolt): upgraded gear works as if less upgraded (Degrade.reduceLevel). */
  degraded?: number;
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

/** Hero.STR. (Shattered's Weakness takes nothing from strength: a weakened blow is two thirds as hard, combat.ts.) */
export const heroStr = (hero: Hero): number => hero.str;

/** Fury.LEVEL: below this share of health, a berserker flies into a fury. */
export const FURY_LEVEL = 0.4;

/** The numbers of the weapon in hand, or of bare fists (RingOfForce.damageRoll without a ring: 1 to STR-8). */
export function heroWeapon(hero: Hero): WeaponStats {
  return hero.weapon ? weaponStats(hero.weapon) : { min: 1, max: Math.max(1, heroStr(hero) - 8), str: 0, accuracy: 1, delay: 1 };
}

/** Char.hit with Bless: the blessed roll a quarter higher, attacking and defending alike. */
const blessing = (hero: Hero): number => ((hero.blessed ?? 0) > 0 ? 1.25 : 1);

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
  const accuracy = f32(accuracyMultiplier(hero) * blessing(hero));
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
  let evasion = f32(f32(hero.defenseSkill * (bonus === 0 ? 1 : f32(1.2 ** bonus))) * blessing(hero));
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
  return Math.max(1, Math.round(f32(f32(hero.attackSkill * f32(accuracyMultiplier(hero) * blessing(hero))) * factor)));
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
  | 'fetidRat' | 'curse' | 'ratKing' | 'wraith' | 'bee' | 'impShopkeeper'
  /* Shattered's roster (MobSpawner): the sewers' snakes and slimes, */
  | 'snake' | 'slime' | 'causticSlime' | 'gnollExile' | 'hermitCrab'
  /* the prison's DM-100s, guards and necromancers (and their skeletons), */
  | 'dm100' | 'guard' | 'necromancer' | 'spectralNecromancer' | 'necroSkeleton'
  /* the caves' shamans of three masks and DM-200s, */
  | 'blueShaman' | 'purpleShaman' | 'dm200' | 'dm201'
  /* the city's ghouls and elementals of four kinds, */
  | 'ghoul' | 'frostElemental' | 'shockElemental' | 'chaosElemental'
  /* the halls' ripper demons and their spawners, */
  | 'ripper' | 'spawner'
  /* and anywhere: tormented spirits, mimics of three more kinds, armoured statues, phantom piranhas; */
  | 'tormentedSpirit' | 'goldenMimic' | 'crystalMimic' | 'ebonyMimic' | 'armoredStatue' | 'phantomPiranha'
  /* the sad ghost's foes besides the fetid rat (Ghost.Quest). */
  | 'gnollTrickster' | 'greatCrab';
/** `passive`: the sad ghost and the shopkeeper, who neither fight nor can be hurt; `fleeing`: a thief making off with its loot. */
export type MobState = 'sleeping' | 'wandering' | 'hunting' | 'fleeing' | 'passive';

/** Who keeps a shop: the shopkeeper, or the imp of the last one. */
export const isShopkeeper = (mob: { kind: MobKind }): boolean => mob.kind === 'shopkeeper' || mob.kind === 'impShopkeeper';

export interface MobStats {
  name: string;
  ht: number;
  /** Mob.attackSkill and defenseSkill. */
  attack: number;
  defense: number;
  /** Mob.damageRoll: a NormalIntRange. */
  damage: readonly [number, number];
  /** Mob.drRoll: a NormalIntRange(0, dr), then a second one up to `dr2` and a flat `drFlat` for those that add theirs to their kind's. */
  dr: number;
  dr2?: number;
  drFlat?: number;
  exp: number;
  /** Heroes above this level no longer learn anything from it. */
  maxLvl: number;
  speed: number;
  /** Time a blow takes, if not one turn (the thief strikes twice as fast). */
  attackDelay?: number;
  /** Flies over traps and grass without disturbing them. */
  flying?: boolean;
}

/** Hero.MAX_LEVEL - 1: Mob.maxLvl unless a monster says otherwise. */
const ANY_LVL = 29;

/*
 * The monsters' numbers: Shattered's for every monster of its roster (the
 * HP, defenseSkill, EXP and maxLvl each sets, its attackSkill, damageRoll and
 * drRoll), Pixel Dungeon's still for the bosses and their minions, which the
 * bosses stream ports, and for the folk who never fight.
 */
export const MOBS: Readonly<Record<MobKind, MobStats>> = {
  // The sewers (depths 1-4).
  rat: { name: 'marsupial rat', ht: 8, attack: 8, defense: 2, damage: [1, 4], dr: 1, exp: 1, maxLvl: 5, speed: 1 },
  albino: { name: 'albino rat', ht: 12, attack: 8, defense: 2, damage: [1, 4], dr: 1, exp: 2, maxLvl: 5, speed: 1 },
  snake: { name: 'sewer snake', ht: 4, attack: 10, defense: 25, damage: [1, 4], dr: 0, exp: 2, maxLvl: 7, speed: 1 },
  gnoll: { name: 'gnoll scout', ht: 12, attack: 10, defense: 4, damage: [1, 6], dr: 2, exp: 2, maxLvl: 8, speed: 1 },
  /** GnollExile: twice a scout's health and half as good again, a cell more of reach. */
  gnollExile: { name: 'gnoll exile', ht: 24, attack: 15, defense: 6, damage: [1, 10], dr: 2, dr2: 1, exp: 2, maxLvl: 8, speed: 1 },
  crab: { name: 'sewer crab', ht: 15, attack: 12, defense: 5, damage: [1, 7], dr: 4, exp: 4, maxLvl: 9, speed: 2 },
  hermitCrab: { name: 'hermit crab', ht: 25, attack: 12, defense: 5, damage: [1, 7], dr: 4, drFlat: 2, exp: 4, maxLvl: 9, speed: 1 },
  swarm: { name: 'swarm of flies', ht: 50, attack: 10, defense: 5, damage: [1, 4], dr: 0, exp: 3, maxLvl: 9, speed: 1, flying: true },
  slime: { name: 'slime', ht: 20, attack: 12, defense: 5, damage: [2, 5], dr: 0, exp: 4, maxLvl: 9, speed: 1 },
  causticSlime: { name: 'caustic slime', ht: 20, attack: 12, defense: 5, damage: [2, 5], dr: 0, exp: 4, maxLvl: 9, speed: 1 },
  // The sad ghost's foes (Ghost.Quest).
  fetidRat: { name: 'fetid rat', ht: 20, attack: 12, defense: 5, damage: [1, 4], dr: 1, dr2: 2, exp: 4, maxLvl: 5, speed: 1 },
  gnollTrickster: { name: 'gnoll trickster', ht: 20, attack: 16, defense: 5, damage: [1, 6], dr: 2, exp: 5, maxLvl: 8, speed: 1 },
  greatCrab: { name: 'great crab', ht: 25, attack: 12, defense: 0, damage: [1, 7], dr: 4, exp: 6, maxLvl: 9, speed: 1 },
  goo: { name: 'Goo', ht: 80, attack: 15, defense: 12, damage: [2, 12], dr: 2, exp: 10, maxLvl: 30, speed: 1 },
  ghost: { name: 'sad ghost', ht: 1, attack: 0, defense: 1000, damage: [0, 0], dr: 0, exp: 0, maxLvl: 0, speed: 0.5, flying: true },
  shopkeeper: { name: 'shopkeeper', ht: 1, attack: 0, defense: 1000, damage: [0, 0], dr: 0, exp: 0, maxLvl: 0, speed: 1 },
  /** ImpShopkeeper: an imp keeps the last shop, in the demon halls. */
  impShopkeeper: { name: 'ambitious imp', ht: 1, attack: 0, defense: 1000, damage: [0, 0], dr: 0, exp: 0, maxLvl: 0, speed: 1 },
  wandmaker: { name: 'old wandmaker', ht: 1, attack: 0, defense: 1000, damage: [0, 0], dr: 0, exp: 0, maxLvl: 0, speed: 1 },
  // The prison (depths 6-9).
  skeleton: { name: 'skeleton', ht: 25, attack: 12, defense: 9, damage: [2, 10], dr: 5, exp: 5, maxLvl: 10, speed: 1 },
  /** Necromancer.NecroSkeleton: a skeleton that teaches nothing and leaves nothing (maxLvl -5); it rises with 20 health. */
  necroSkeleton: { name: "necromancer's skeleton", ht: 25, attack: 12, defense: 9, damage: [2, 10], dr: 5, exp: 5, maxLvl: -5, speed: 1 },
  thief: { name: 'crazy thief', ht: 20, attack: 12, defense: 12, damage: [1, 10], dr: 3, exp: 5, maxLvl: 11, speed: 1, attackDelay: 0.5 },
  bandit: { name: 'crazy bandit', ht: 20, attack: 12, defense: 12, damage: [1, 10], dr: 3, exp: 5, maxLvl: 11, speed: 1, attackDelay: 0.5 },
  dm100: { name: 'DM-100', ht: 20, attack: 11, defense: 8, damage: [2, 8], dr: 4, exp: 6, maxLvl: 13, speed: 1 },
  guard: { name: 'prison guard', ht: 40, attack: 12, defense: 10, damage: [4, 12], dr: 7, exp: 7, maxLvl: 14, speed: 1 },
  /** Necromancer: no blow of its own (Char.damageRoll, attackSkill), its skeleton fights for it. */
  necromancer: { name: 'necromancer', ht: 40, attack: 0, defense: 14, damage: [1, 1], dr: 5, exp: 7, maxLvl: 14, speed: 1 },
  spectralNecromancer: { name: 'spectral necromancer', ht: 40, attack: 0, defense: 14, damage: [1, 1], dr: 5, exp: 7, maxLvl: 14, speed: 1 },
  tengu: { name: 'Tengu', ht: 120, attack: 20, defense: 20, damage: [8, 15], dr: 5, exp: 20, maxLvl: 30, speed: 1 },
  // The caves (depths 11-14).
  bat: { name: 'vampire bat', ht: 30, attack: 16, defense: 15, damage: [5, 18], dr: 4, exp: 7, maxLvl: 15, speed: 2, flying: true },
  brute: { name: 'gnoll brute', ht: 40, attack: 20, defense: 15, damage: [5, 25], dr: 8, exp: 8, maxLvl: 16, speed: 1 },
  /** ArmoredBrute ('shielded', as Pixel Dungeon called its rare brute). */
  shielded: { name: 'armored brute', ht: 40, attack: 20, defense: 15, damage: [5, 25], dr: 8, drFlat: 4, exp: 8, maxLvl: 16, speed: 1 },
  /** Shaman.RedShaman; the blue and the purple are the same but for the spell their bolt carries. */
  shaman: { name: 'gnoll shaman', ht: 35, attack: 18, defense: 15, damage: [5, 10], dr: 6, exp: 8, maxLvl: 16, speed: 1 },
  blueShaman: { name: 'gnoll shaman', ht: 35, attack: 18, defense: 15, damage: [5, 10], dr: 6, exp: 8, maxLvl: 16, speed: 1 },
  purpleShaman: { name: 'gnoll shaman', ht: 35, attack: 18, defense: 15, damage: [5, 10], dr: 6, exp: 8, maxLvl: 16, speed: 1 },
  spinner: { name: 'cave spinner', ht: 50, attack: 22, defense: 17, damage: [10, 20], dr: 6, exp: 9, maxLvl: 17, speed: 1 },
  dm200: { name: 'DM-200', ht: 80, attack: 20, defense: 12, damage: [10, 25], dr: 8, exp: 9, maxLvl: 17, speed: 1 },
  dm201: { name: 'DM-201', ht: 120, attack: 20, defense: 12, damage: [15, 25], dr: 8, exp: 9, maxLvl: 17, speed: 1 },
  dm300: { name: 'DM-300', ht: 200, attack: 28, defense: 18, damage: [18, 24], dr: 10, exp: 30, maxLvl: 30, speed: 1 },
  // The dwarven city (depths 16-19).
  ghoul: { name: 'dwarven ghoul', ht: 45, attack: 24, defense: 20, damage: [16, 22], dr: 4, exp: 5, maxLvl: 20, speed: 1 },
  /** Elemental.FireElemental, and its frost, shock and chaos kin. */
  elemental: { name: 'fire elemental', ht: 60, attack: 25, defense: 20, damage: [20, 25], dr: 5, exp: 10, maxLvl: 20, speed: 1, flying: true },
  frostElemental: { name: 'frost elemental', ht: 60, attack: 25, defense: 20, damage: [20, 25], dr: 5, exp: 10, maxLvl: 20, speed: 1, flying: true },
  shockElemental: { name: 'shock elemental', ht: 60, attack: 25, defense: 20, damage: [20, 25], dr: 5, exp: 10, maxLvl: 20, speed: 1, flying: true },
  chaosElemental: { name: 'chaos elemental', ht: 60, attack: 25, defense: 20, damage: [20, 25], dr: 5, exp: 10, maxLvl: 20, speed: 1, flying: true },
  monk: { name: 'dwarf monk', ht: 70, attack: 30, defense: 30, damage: [12, 25], dr: 2, exp: 11, maxLvl: 21, speed: 1, attackDelay: 0.5 },
  senior: { name: 'senior monk', ht: 70, attack: 30, defense: 30, damage: [16, 25], dr: 2, exp: 11, maxLvl: 21, speed: 1, attackDelay: 0.5 },
  warlock: { name: 'dwarf warlock', ht: 70, attack: 25, defense: 18, damage: [12, 18], dr: 8, exp: 11, maxLvl: 21, speed: 1 },
  golem: { name: 'golem', ht: 120, attack: 28, defense: 15, damage: [25, 30], dr: 12, exp: 12, maxLvl: 22, speed: 1 },
  king: { name: 'King of Dwarves', ht: 300, attack: 32, defense: 25, damage: [20, 38], dr: 14, exp: 40, maxLvl: 30, speed: 1 },
  undead: { name: 'undead dwarf', ht: 28, attack: 16, defense: 15, damage: [12, 16], dr: 5, exp: 0, maxLvl: 30, speed: 1 },
  // The demon halls (depths 21-24).
  succubus: { name: 'succubus', ht: 80, attack: 40, defense: 25, damage: [25, 30], dr: 10, exp: 12, maxLvl: 25, speed: 1 },
  eye: { name: 'evil eye', ht: 100, attack: 30, defense: 20, damage: [20, 30], dr: 10, exp: 13, maxLvl: 26, speed: 1, flying: true },
  scorpio: { name: 'scorpio', ht: 110, attack: 36, defense: 24, damage: [30, 40], dr: 16, exp: 14, maxLvl: 27, speed: 1 },
  acidic: { name: 'acidic scorpio', ht: 110, attack: 36, defense: 24, damage: [30, 40], dr: 16, exp: 14, maxLvl: 27, speed: 1 },
  /** RipperDemon: teaches nothing (maxLvl -2), out of a demon spawner. */
  ripper: { name: 'ripper demon', ht: 60, attack: 30, defense: 22, damage: [15, 25], dr: 4, exp: 9, maxLvl: -2, speed: 1, attackDelay: 0.5 },
  /** DemonSpawner: never strikes nor moves, and dodges nothing. */
  spawner: { name: 'demon spawner', ht: 120, attack: 0, defense: 0, damage: [1, 1], dr: 12, exp: 15, maxLvl: 29, speed: 1 },
  yog: { name: 'Yog-Dzewa', ht: 300, attack: 0, defense: 0, damage: [0, 0], dr: 0, exp: 50, maxLvl: 30, speed: 1 },
  rottingFist: { name: 'rotting fist', ht: 300, attack: 36, defense: 25, damage: [24, 36], dr: 15, exp: 0, maxLvl: 30, speed: 1 },
  burningFist: { name: 'burning fist', ht: 200, attack: 36, defense: 25, damage: [20, 32], dr: 15, exp: 0, maxLvl: 30, speed: 1 },
  larva: { name: "god's larva", ht: 25, attack: 30, defense: 20, damage: [15, 20], dr: 8, exp: 0, maxLvl: 30, speed: 1 },
  // Anywhere: as strong as the depth they are on (see mobStats).
  mimic: { name: 'mimic', ht: 6, attack: 6, defense: 2, damage: [1, 2], dr: 1, exp: 0, maxLvl: ANY_LVL, speed: 1 },
  goldenMimic: { name: 'golden mimic', ht: 6, attack: 6, defense: 2, damage: [1, 2], dr: 1, exp: 0, maxLvl: ANY_LVL, speed: 1 },
  crystalMimic: { name: 'crystal mimic', ht: 6, attack: 6, defense: 2, damage: [1, 2], dr: 1, exp: 0, maxLvl: ANY_LVL, speed: 1 },
  ebonyMimic: { name: 'ebony mimic', ht: 6, attack: 6, defense: 2, damage: [1, 2], dr: 1, exp: 0, maxLvl: ANY_LVL, speed: 1 },
  statue: { name: 'animated statue', ht: 20, attack: 10, defense: 5, damage: [1, 4], dr: 1, exp: 0, maxLvl: ANY_LVL, speed: 1 },
  armoredStatue: { name: 'armored statue', ht: 40, attack: 10, defense: 5, damage: [1, 4], dr: 1, exp: 0, maxLvl: ANY_LVL, speed: 1 },
  piranha: { name: 'giant piranha', ht: 15, attack: 22, defense: 12, damage: [1, 6], dr: 1, exp: 0, maxLvl: ANY_LVL, speed: 2 },
  phantomPiranha: { name: 'phantom piranha', ht: 15, attack: 22, defense: 12, damage: [1, 6], dr: 1, exp: 0, maxLvl: ANY_LVL, speed: 2 },
  /** A vengeful spirit: one blow kills it, but it is very hard to hit (Wraith.adjustStats; teaches nothing, maxLvl -2). */
  wraith: { name: 'wraith', ht: 1, attack: 11, defense: 55, damage: [1, 3], dr: 0, exp: 0, maxLvl: -2, speed: 1, flying: true },
  tormentedSpirit: { name: 'tormented spirit', ht: 1, attack: 11, defense: 55, damage: [1, 3], dr: 0, exp: 0, maxLvl: -2, speed: 1, flying: true },
  sheep: { name: 'sheep', ht: 1, attack: 0, defense: 1000, damage: [0, 0], dr: 0, exp: 0, maxLvl: 0, speed: 1 },
  mirror: { name: 'mirror image', ht: 1, attack: 0, defense: 0, damage: [0, 0], dr: 0, exp: 0, maxLvl: 0, speed: 1 },
  blacksmith: { name: 'troll blacksmith', ht: 1, attack: 0, defense: 1000, damage: [0, 0], dr: 0, exp: 0, maxLvl: 0, speed: 1 },
  imp: { name: 'ambitious imp', ht: 1, attack: 0, defense: 1000, damage: [0, 0], dr: 0, exp: 0, maxLvl: 0, speed: 1 },
  curse: { name: 'curse personification', ht: 16, attack: 12, defense: 12, damage: [3, 5], dr: 1, exp: 0, maxLvl: 5, speed: 0.5, flying: true },
  /** Out of a honeypot: it guards the pot's pieces against anyone near them (its numbers grow with the depth). */
  bee: { name: 'golden bee', ht: 12, attack: 10, defense: 10, damage: [1, 3], dr: 0, exp: 0, maxLvl: ANY_LVL, speed: 1, flying: true },
  /** Asleep (or so he says) in his hidden treasury beside Goo's lair. */
  ratKing: { name: 'rat king', ht: 1, attack: 0, defense: 1000, damage: [0, 0], dr: 0, exp: 0, maxLvl: 0, speed: 2 },
};

/** Generator.Category.WEAPON's defenseFactor (a shield's): SEAM(gear) — Shattered's weapons stand behind it; none until then. */
export const weaponDefenseFactor = (_weapon: Item): number => 0;

/**
 * A monster's numbers: the table's, or as strong as the depth it is on — an animated statue with its
 * weapon (Statue), an armoured one twice as sturdy (ArmoredStatue), a mimic as its level (Mimic.adjustStats,
 * a golden one a third stronger), a piranha (Piranha), a wraith (Wraith.adjustStats, a tormented spirit's
 * half as good again).
 */
export function mobStats(mob: Mob): MobStats {
  const depth = mob.level ?? 1;
  if ((mob.kind === 'statue' || mob.kind === 'armoredStatue') && mob.item) {
    // Statue: its numbers grow with the depth, and it fights with the weapon it holds.
    const weapon = weaponStats(mob.item);
    return {
      ...MOBS[mob.kind], ht: mob.kind === 'armoredStatue' ? 30 + depth * 10 : 15 + depth * 5,
      attack: Math.trunc((9 + depth) * weapon.accuracy), defense: 4 + depth,
      damage: [weapon.min, weapon.max], dr: depth + weaponDefenseFactor(mob.item), attackDelay: weapon.delay,
    };
  }
  if (mob.kind === 'bee') {
    // Bee.spawn: (2 + level) * 4 health, as accurate as it is evasive (9 + level), a tenth to a quarter of its health a sting.
    const ht = (2 + depth) * 4;
    return { ...MOBS.bee, ht, attack: 9 + depth, defense: 9 + depth, damage: [Math.trunc(ht / 10), Math.trunc(ht / 4)] };
  }
  if (mob.kind === 'wraith') {
    const attack = 10 + depth;
    return { ...MOBS.wraith, attack, defense: attack * 5, damage: [1 + Math.trunc(depth / 2), 2 + depth] };
  }
  if (mob.kind === 'tormentedSpirit') {
    const scaled = Math.round(1.5 * depth);
    return { ...MOBS.tormentedSpirit, attack: 10 + scaled, defense: (10 + scaled) * 5, damage: [1 + Math.trunc(scaled / 2), 2 + scaled] };
  }
  if (mob.kind === 'curse') return { ...MOBS.curse, ht: 10 + depth * 3, attack: 10 + depth, defense: 10 + depth };
  if (mob.kind === 'piranha' || mob.kind === 'phantomPiranha') {
    return { ...MOBS[mob.kind], ht: 10 + depth * 5, attack: 20 + depth * 2, defense: 10 + depth * 2, damage: [depth, 4 + depth * 2], dr: depth };
  }
  if (!isMimic(mob.kind)) return MOBS[mob.kind];
  // GoldenMimic.setLevel: a third stronger.
  const level = mob.kind === 'goldenMimic' ? Math.round(depth * 1.33) : depth;
  return {
    ...MOBS[mob.kind], ht: (1 + level) * 6, attack: 6 + level, defense: 2 + Math.trunc(level / 2),
    damage: [1 + level, 2 + 2 * level], dr: 1 + Math.trunc(level / 2),
  };
}

/** The four kinds of mimic (Mimic and its kin). */
export const isMimic = (kind: MobKind): boolean => kind === 'mimic' || kind === 'goldenMimic' || kind === 'crystalMimic' || kind === 'ebonyMimic';

/**
 * Mob.speed: its kind's; a thief carrying off its loot goes at five sixths of it (Thief.speed); a champion
 * ... and no faster or slower otherwise here (Char.speed's cripple and the rest act on the time spent).
 */
export function mobSpeed(mob: Mob): number {
  // Haste: three times as fast (a crystal mimic on the run).
  const speed = MOBS[mob.kind].speed * ((mob.haste ?? 0) > 0 ? 3 : 1);
  return (mob.kind === 'thief' || mob.kind === 'bandit') && mob.item ? (5 * speed) / 6 : speed;
}

/** Brute.damageRoll while raging (BruteRage), and ArmoredBrute's. */
export const BRUTE_ENRAGED_DAMAGE = [15, 40] as const;

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

  /* Shattered's monsters (mobs.ts, mobskills.ts, champions.ts). */
  /** Char.Alignment.ALLY: it fights for the heroes. SEAM(wands): the allies (allies.ts). */
  ally?: boolean;
  /** ChampionEnemy: the champion it is (challenges.ts CHAMPION_ENEMIES), and a growing one's multiplier (Growing.multiplier). */
  champion?: ChampionKind;
  growth?: number;
  /** When a growing champion grows next (Growing.act: every four turns). */
  growAt?: number;
  /** An armoured statue's armour (ArmoredStatue.armor). */
  armor?: Item;
  /** Brute.hasRaged, and what is left of the rage's shield (BruteRage: it dies when that is spent). */
  hasRaged?: boolean;
  rageShield?: number;
  /** Spinner.webCoolDown and lastEnemyPos; RipperDemon.lastEnemyPos too. */
  webCooldown?: number;
  lastEnemyPos?: number;
  /** DM200.ventCooldown. */
  ventCooldown?: number;
  /** DM201.threatened: struck from afar, it lobs a grenade. */
  threatened?: boolean;
  /** Golem: teleporting itself next turn, and the cooldowns of its teleports (selfTeleCooldown, enemyTeleCooldown). */
  teleporting?: boolean;
  selfTele?: number;
  enemyTele?: number;
  /** Guard.chainsUsed. */
  chainsUsed?: boolean;
  /** Necromancer: summoning (and where), its first summon still to come, its skeleton (a spectral one's wraiths). */
  summoning?: boolean;
  summonPos?: number;
  summoned?: boolean;
  minion?: string;
  wraiths?: string[];
  /** Necromancer's skeleton: its master; Adrenaline from a zap of its master, turns left. */
  master?: string;
  adrenaline?: number;
  /** Elemental.rangedCooldown. */
  rangedCooldown?: number;
  /** Monk.focusCooldown, and Focus (it parries the next blow). */
  focusCooldown?: number;
  focused?: boolean;
  /** Succubus.blinkCooldown. */
  blinkCooldown?: number;
  /** A succubus's Barrier: shielding from life drawn out of a charmed hero. */
  barrier?: number;
  /** Eye: beamTarget, beamCooldown, beamCharged. */
  beamTarget?: number;
  beamCooldown?: number;
  beamCharged?: boolean;
  /** RipperDemon: where it is about to leap, and leapCooldown. */
  leapPos?: number;
  leapCooldown?: number;
  /** Ghoul: its partner, and how often it has been downed (GhoulLifeLink lasts five turns more each time). */
  partner?: string;
  timesDowned?: number;
  /** DemonSpawner.spawnCooldown. */
  spawnCooldown?: number;
  /** GnollExile: passive until provoked (Mob.PASSIVE then WANDERING), and how long since it told of itself. */
  provoked?: boolean;
  seenCooldown?: number;
  /** GnollTrickster.combo; GreatCrab.moving. */
  combo?: number;
  moving?: number;
  /** A golden bee's pot (Bee.potPos and potHolder): where its pieces lie (-1: carried, or gone), and who carries them. */
  pot?: { pos: number; holder: string | null };
  /** An ebony mimic still hidden (Char.Alignment.NEUTRAL, Mimic.stealthy): a faint outline, waiting to be bumped into. */
  hidden?: boolean;
  /** Crystal mimic: Haste, turns left (it moves three times as fast). */
  haste?: number;
  /** Mob.die from a fall (Chasm.class): half the experience. */
  fell?: boolean;
  /** Weakness (a red shaman's bolt: two thirds as hard a blow), Vulnerable, Hex, Roots (a web): turns left. */
  weakened?: number;
  vulnerable?: number;
  hexed?: number;
  /** Mob.timeSeenAt for swarm intelligence: since when it has kept its enemy in sight (the call goes further the longer). */
  seenSince?: number;
}

/** ChampionEnemy's six kinds. */
export type ChampionKind = 'blazing' | 'projecting' | 'antiMagic' | 'giant' | 'blessed' | 'growing';

/**
 * Mob.beckon: called towards a spot — it stirs (if it was not hunting or fleeing, it wanders) and heads there.
 * Not those that keep still until provoked: an animated statue (Statue.beckon), a demon spawner, a gnoll exile
 * (only drawn there, still passive, now and then: GnollExile.beckon).
 */
export function beckon(mob: Mob, pos: number): void {
  if (mob.state === 'passive' || mob.kind === 'spawner' || ((mob.kind === 'statue' || mob.kind === 'armoredStatue') && mob.state === 'sleeping')) return;
  if (mob.kind === 'gnollExile' && !mob.provoked) {
    if ((mob.seenCooldown ?? 0) <= 0) mob.target = pos;
    return;
  }
  if (mob.state !== 'hunting' && mob.state !== 'fleeing') mob.state = 'wandering';
  mob.target = pos;
}

export function createMob(id: string, kind: MobKind, pos: number, state: MobState, time: number): Mob {
  const ht = MOBS[kind].ht;
  return { id, kind, pos, hp: ht, ht, state, target: -1, enemy: null, enemySeen: false, alerted: false, time };
}

/**
 * The kind a monster is a version of, as Shattered's classes extend one another (an albino rat is a Rat, an
 * armoured brute a Brute, a frost elemental an Elemental): what it shares with it unless it says otherwise.
 */
const BASE_KINDS: Partial<Record<MobKind, MobKind>> = {
  albino: 'rat', fetidRat: 'rat', gnollExile: 'gnoll', gnollTrickster: 'gnoll', hermitCrab: 'crab', greatCrab: 'crab',
  causticSlime: 'slime', bandit: 'thief', necroSkeleton: 'skeleton', spectralNecromancer: 'necromancer', tormentedSpirit: 'wraith',
  shielded: 'brute', blueShaman: 'shaman', purpleShaman: 'shaman', dm201: 'dm200',
  frostElemental: 'elemental', shockElemental: 'elemental', chaosElemental: 'elemental', senior: 'monk', acidic: 'scorpio',
  goldenMimic: 'mimic', crystalMimic: 'mimic', ebonyMimic: 'mimic', armoredStatue: 'statue', phantomPiranha: 'piranha',
};

/** The ordinary kind a rare variant is a version of (an albino rat is a rat). */
export const baseKind = (kind: MobKind): MobKind => BASE_KINDS[kind] ?? kind;
