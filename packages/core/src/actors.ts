import { effectiveLevel } from './wear';
import { createItem, type Item, itemDef, type ItemKind } from './items';
import { armorDrMax, armorDrMin, armorEvasionBonus, armorStr } from './armor';
import {
  augmentDamage, augmentDelay, bowLevel, bowMax, bowMin, bowStr, crossbowDartMax, crossbowDartMin, gearLevel, jround, meleeMax, meleeMin,
  meleeStr, surpriseShare, weaponAcc, weaponDefense, weaponDly, weaponRch, type WeaponStats, weaponStats,
} from './weapons';
import { isDart, missileMax, missileMin, missileStr, missileSurprise } from './missiles';
import { type Buffs, buffSpeed } from './buffs';
import { CLOVER, FERRET_TUFT, trinketLevel } from './trinkets';
import { type HeroClass, startingKit } from './heroclass';
import { isStarving } from './hero';
import {
  accuracyMultiplier, attackSpeedMultiplier, evasionMultiplier, forceArmedBonus, forceRange, mightStrength, sharpshootingBonus, speedMultiplier,
} from './rings';
import type { Rng } from './rng';
import { adjacent } from './level/geometry';
import { T } from './level/terrain';
import type { Action, PlanStep } from './world';
import type { Awareness, PendingScroll } from './artifacts';
import type { WealthCounters } from './rings';
import { type ClassState, hasTimer, type MobMarks } from './classes/state';

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
export type SubClass =
  | 'gladiator' | 'berserker' | 'battlemage' | 'warlock' | 'freerunner' | 'assassin' | 'sniper' | 'warden' | 'champion' | 'monk' | 'priest' | 'paladin';
export const SUBCLASSES: Readonly<Record<HeroClass, readonly [SubClass, SubClass]>> = {
  warrior: ['gladiator', 'berserker'],
  mage: ['battlemage', 'warlock'],
  rogue: ['freerunner', 'assassin'],
  huntress: ['sniper', 'warden'],
  duelist: ['champion', 'monk'],
  cleric: ['priest', 'paladin'],
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
  /**
   * Belongings' artifact, misc and ring slots (KindofMisc): an artifact, a second artifact or ring,
   * and a ring. Read them through heroRings and heroArtifacts.
   */
  artifact: Item | null;
  misc: Item | null;
  ring: Item | null;
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
  /* Shattered's wands (wands.ts, status.ts). */
  /** Barrier (ShieldBuff): shielding that takes blows before health, and fades a little every turn. */
  shield?: number;
  shieldDecay?: number;
  /** WandOfLivingEarth.RockArmor: earthen armour gathered from zaps, which takes half of every blow, and the wand level it is of. */
  rockArmor?: { armor: number; level: number };
  /** WandOfMagicMissile.MagicCharge: turns left in which the other wands zap as strong as the magic missile that charged them. */
  magicCharge?: { level: number; turns: number; fresh?: boolean };
  /** WandOfLightning.LightningCharge: turns left of arcs reaching a cell further (a battlemage's staff of lightning). */
  lightningCharge?: number;
  /** Recharging (ScrollOfRecharging): turns left of every wand charging faster. */
  recharging?: number;
  /** Chill: turns left of moving slower, the more the colder; Frost: turns left frozen solid (a cursed wand's doing). */
  chill?: number;
  frozen?: number;
  /** Corrosion: turns left, and how hard it eats away now (it grows every turn). */
  corrosion?: { left: number; damage: number };
  /** Hex (missing and being hit more), Vulnerable (taking a third more), Invulnerability: turns left (Bless: below). */
  hexed?: number;
  vulnerable?: number;
  invulnerable?: number;
  /** HeroDisguise: turns left of looking like a hero of another class. */
  disguise?: { heroClass: HeroClass; turns: number };
  /** TimeStasis: turns left of being frozen in time, untouchable and still (a cursed wand's, or the timekeeper's hourglass's stasis, unseen too). */
  stasis?: number;
  /** CursedWand's lingering effects: a supernova building up, gravity gone wild, the ground about to give way. */
  supernova?: { pos: number; turns: number; harmsAllies: boolean };
  gravity?: { turns: number; positiveOnly: boolean; next?: number };
  sinkhole?: { cells: number[]; turns: number; depth: number };
  /** Sungrass.Health (a battlemage's staff of regrowth): health still to come back while standing there, and what has gathered. */
  herbal?: { level: number; pos: number; partial: number };
  /** The unstable spellbook's scroll the player has yet to settle: read as it is or empowered, and on what. */
  pendingScroll?: PendingScroll;
  /** Creatures and heaps the talisman of foresight shows for a while (CharAwareness, HeapAwareness). */
  aware?: Awareness[];
  /** The ring of wealth's counters (TriesToDropTracker, DropsToEquipTracker), once one has been worn. */
  wealth?: WealthCounters;
  /** Hunger.level: 0 when fed, hungry from HUNGRY, starving at STARVING (it grows a point a turn). */
  hunger: number;
  /** Unused since Shattered's hunger (kept for the shape of older saves). */
  hungerTime: number;
  /** Shattered's buffs from alchemy (buffs.ts): haste, shielding, healing over time, imbues and the like. */
  buffs?: Buffs;
  /** Hunger.partialDamage: starvation's damage building up towards the next point. */
  starve?: number;
  /** Turns left of Bless (from experience at the level cap): a quarter more accurate and evasive. */
  blessed?: number;
  /** LockedFloor.left: on a boss's sealed floor, the turns passive healing goes on (see hero.ts). */
  lockedFloor?: number;
  /** BrokenSeal.WarriorShield: the shield left, the cooldown, turns without an enemy in sight, the shield as raised (seal.ts). */
  sealShield?: { shield: number; cooldown: number; idle: number; initial: number };
  /** For the badges (Statistics): gold picked up, food eaten, potions brewed and piranhas slain this run. */
  stats?: RunStats;
  /** For the end of the run: monsters slain, and what dealt the killing blow. */
  kills: number;
  killedBy: string | null;
  /** Thrown sets upgraded since some of them were thrown: the level a copy must have to be picked up (MissileWeapon.UpgradedSetTracker). */
  upgradedSets?: Record<number, number>;
  /** Heavy boomerangs on their way back (HeavyBoomerang.CircleBack). */
  circling?: CircleBack[];
  /** Turns left before a shuriken flies instantly again (Shuriken.ShurikenInstantTracker). */
  shuriken?: number;
  /** A blocking weapon's shield (Blocking.BlockBuff): how much it holds, and the turns it lasts. */
  blocking?: { shield: number; left: number };
  /** Damage a kinetic weapon kept from a blow that overkilled (Kinetic.ConservedDamage). */
  kinetic?: number;
  /** Turns left of a wayward weapon's poor aim (Wayward.WaywardBuff). */
  wayward?: number;
  /*
   * The classes stream: talents, the armour ability, the Champion's second weapon and what the Duelist and the
   * Cleric keep (classes/state.ts).
   */
  /** Hero.talents: points in each talent, by its name (talents.ts). */
  talents?: Record<string, number>;
  /** Hero.armorAbility: the ability chosen for the class armour (classes/abilities.ts). */
  armorAbility?: string;
  /** Belongings.secondWep: the Champion's second weapon. */
  secondWep?: Item | null;
  cls?: ClassState;
}

/** HeavyBoomerang.CircleBack: a boomerang flying back to where it was thrown from, in `left` turns. */
export interface CircleBack {
  item: Item;
  /** Where it fell, and where it returns to, on which depth. */
  from: number;
  to: number;
  depth: number;
  left: number;
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
    artifact: kit.artifact,
    misc: null,
    ring: null,
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

/* Belongings: the equipment slots of a hero */

/** The three slots of KindofMisc: an artifact, an artifact or a ring, a ring. */
export type MiscSlot = 'artifact' | 'misc' | 'ring';
export const MISC_SLOTS: readonly MiscSlot[] = ['artifact', 'misc', 'ring'];

/** The rings a hero wears: in the ring slot, and one in the misc slot. */
export const heroRings = (hero: Hero): Item[] =>
  [hero.misc, hero.ring].filter((item): item is Item => item != null && itemDef(item.kind).category === 'ring');

/** The artifacts a hero wears: in the artifact slot, and one in the misc slot. */
export const heroArtifacts = (hero: Hero): Item[] =>
  [hero.artifact, hero.misc].filter((item): item is Item => item != null && itemDef(item.kind).category === 'artifact');

/** Everything a hero wears or holds in hand (Belongings' equipped items), in the order of its slots. */
export const heroEquipped = (hero: Hero): Item[] =>
  [hero.weapon, hero.armor, hero.artifact, hero.misc, hero.ring].filter((item): item is Item => item != null);

/** Everything a hero has: what is worn, then the pack (Belongings.iterator). */
export const heroBelongings = (hero: Hero): Item[] => [...heroEquipped(hero), ...hero.items];

/** Ring.getBonus: what the worn rings of a kind add (rings.ts). */
export { ringBonus } from './rings';

/** Hero.STR: rings of might add to it (RingOfMight.strengthBonus); weakness takes two points away while it lasts. */
export const heroStr = (hero: Hero): number => hero.str + mightStrength(hero) - (hero.weakened > 0 ? 2 : 0);

/** Fury.LEVEL: below this share of health, a berserker flies into a fury. */
export const FURY_LEVEL = 0.4;

/** The numbers of the weapon in hand, or of bare fists (RingOfForce.damageRoll: as a weapon of the strength's tier with a ring of force, else 1 to STR-8). */
export function heroWeapon(hero: Hero): WeaponStats {
  if (hero.weapon) return weaponStats(hero.weapon);
  const force = forceRange(hero, heroStr(hero));
  return { min: force?.[0] ?? 1, max: force?.[1] ?? Math.max(1, heroStr(hero) - 8), str: 0, accuracy: 1, delay: 1, reach: 1 };
}

/** What a hero strikes with: the weapon in hand, or a thrown weapon (or the spirit bow, for its arrow) in flight. */
export type Strike = Item | null;

/** The strength a weapon wants: a melee weapon's, a thrown one's, the spirit bow's (at its bearer's level). */
export function strikeStr(hero: Hero, weapon: Item): number {
  const category = itemDef(weapon.kind).category;
  if (category === 'bow') return bowStr(hero.lvl, weapon);
  return category === 'missile' ? missileStr(weapon) : meleeStr(weapon);
}

/**
 * Weapon.accuracyFactor (and MissileWeapon's): its accuracy, worse the heavier it is for the hero (1.5× a point of
 * strength short); a wayward weapon aims at a fifth while its curse holds; thrown, half as accurate point-blank and
 * half as accurate again from afar (adjacentAccFactor).
 */
function accuracyFactor(hero: Hero, weapon: Item, targetPos?: number): number {
  const category = itemDef(weapon.kind).category;
  let acc = category === 'weapon' ? weaponAcc(weapon.kind) : 1;
  if ((hero.wayward ?? 0) > 0 && weapon.enchant === 'wayward') acc = f32(acc / 5);
  const encumbrance = strikeStr(hero, weapon) - heroStr(hero);
  let factor = encumbrance > 0 ? f32(acc / 1.5 ** encumbrance) : acc;
  if ((category === 'missile' || category === 'bow') && targetPos !== undefined) {
    // Seam: the point blank talent (talents stream) adds a quarter a point.
    factor = f32(factor * (adjacent(hero.pos, targetPos) ? 0.5 : 1.5));
  }
  return factor;
}

/** Char.hit with Bless: the blessed roll a quarter higher, attacking and defending alike. */
const blessing = (hero: Hero): number => ((hero.blessed ?? 0) > 0 ? 1.25 : 1);

/** Hero.attackSkill: with a weapon, times its accuracy factor; a ring of accuracy helps either way (RingOfAccuracy.accuracyMultiplier). */
export function heroAttackSkill(hero: Hero, targetPos?: number, weapon: Strike = hero.weapon): number {
  const accuracy = f32(accuracyMultiplier(hero) * blessing(hero));
  if (!weapon) return Math.max(1, jround(f32(hero.attackSkill * accuracy)));
  return Math.max(1, jround(f32(f32(hero.attackSkill * accuracy) * accuracyFactor(hero, weapon, targetPos))));
}

/**
 * Hero.defenseSkill: a ring of evasion helps, paralysis halves it; then the armour (Armor.evasionFactor): 1.5× worse
 * a point of strength short, and its augment's evasion added. Armour of stone is never dodged.
 */
export function heroDefenseSkill(hero: Hero): number {
  // RingOfEvasion.evasionMultiplier.
  let evasion = f32(f32(hero.defenseSkill * evasionMultiplier(hero)) * blessing(hero));
  if (hero.paralysed > 0) evasion = f32(evasion / 2);
  if (hero.armor.glyph === 'stone') return 0;
  const encumbrance = armorStr(hero.armor) - heroStr(hero);
  if (encumbrance > 0) evasion = f32(evasion / 1.5 ** encumbrance);
  // Seam (talents stream): Momentum's evasion. Here the 1.9 freerunner still doubles it, unburdened and fed.
  if (hero.subclass === 'freerunner' && !isStarving(hero) && encumbrance <= 0) evasion = f32(evasion * 2);
  // FerretTuft.evasionMultiplier.
  const tuft = trinketLevel(hero, 'trinket.ferretTuft');
  if (tuft >= 0) evasion = f32(evasion * FERRET_TUFT.evasionMultiplier(tuft));
  evasion = f32(evasion + armorEvasionBonus(hero.armor));
  return Math.max(1, jround(evasion));
}

/**
 * Hero.drRoll: a roll of the armour's protection, two less a point of strength short; a roll of the weapon's
 * parrying (0 to its defence factor), the same way; and a warden's bark (Barkskin).
 */
export function heroDrRoll(hero: Hero, rng: Rng): number {
  let dr = 0;
  const str = heroStr(hero);
  let armor = rng.normalIntRange(armorDrMin(hero.armor), armorDrMax(hero.armor));
  if (str < armorStr(hero.armor)) armor -= 2 * (armorStr(hero.armor) - str);
  if (armor > 0) dr += armor;
  if (hero.weapon && itemDef(hero.weapon.kind).category === 'weapon') {
    let parry = rng.normalIntRange(0, weaponDefense(hero.weapon));
    if (str < meleeStr(hero.weapon)) parry -= 2 * (meleeStr(hero.weapon) - str);
    if (parry > 0) dr += parry;
  }
  const bark = Math.ceil(hero.barkskin ?? 0);
  if (bark > 0) dr += rng.normalIntRange(0, bark);
  // Barkskin (a potion of earthen armour): up to its level more.
  const earthen = hero.buffs?.barkskin?.level ?? 0;
  if (earthen > 0) dr += rng.normalIntRange(0, earthen);
  return dr;
}

/**
 * Hero.damageRoll: the weapon's roll (NormalIntRange of its min and max, augmented), plus up to the strength to spare
 * (heroDamageIntRange(0, excess)); a dagger, dirk, assassin's blade, throwing knife or kunai rolls from nearer its
 * most on a surprise attack. Bare-handed: 1 to STR-8. Darts thrown with a crossbow in hand take its numbers; a spirit
 * arrow the bow's. Seam: the thirteen-leaf clover (a trinket) would alter the hero's rolls.
 */
export function heroDamageRoll(hero: Hero, rng: Rng, surprised = false, weapon: Strike = hero.weapon, fists = false): number {
  let damage: number;
  if (fists) {
    // A Monk's ability: plain fists, whatever ring is worn (RingOfForce.damageRoll with the UnarmedAbilityTracker).
    damage = rng.normalIntRange(1, Math.max(heroStr(hero) - 8, 1));
  } else if (!weapon) {
    // RingOfForce.damageRoll: bare-handed, as a weapon of the strength's tier with a ring of force; else 1 to STR-8.
    const force = forceRange(hero, heroStr(hero));
    damage = force ? rng.normalIntRange(force[0], force[1]) : rng.normalIntRange(1, Math.max(heroStr(hero) - 8, 1));
  } else {
    const category = itemDef(weapon.kind).category;
    let min: number;
    let max: number;
    let share = 0;
    // RingOfSharpshooting.levelDamageBonus: levels more for thrown weapons and the spirit bow's arrows.
    const sharp = category === 'bow' || category === 'missile' ? sharpshootingBonus(hero) : 0;
    if (category === 'bow') {
      min = bowMin(hero.lvl, weapon, sharp);
      max = bowMax(hero.lvl, weapon, sharp);
    } else if (category === 'missile') {
      const crossbow = hero.weapon?.kind === 'weapon.crossbow' && isDart(weapon.kind) ? hero.weapon : null;
      min = crossbow ? crossbowDartMin(crossbow) + sharp : missileMin(weapon, gearLevel(weapon) + sharp);
      max = crossbow ? crossbowDartMax(crossbow) + 2 * sharp : missileMax(weapon, gearLevel(weapon) + sharp);
      share = missileSurprise(weapon.kind);
    } else {
      min = meleeMin(weapon);
      max = meleeMax(weapon);
      share = surpriseShare(weapon.kind);
    }
    damage = surprised && share > 0
      ? augmentDamage(weapon, rng.normalIntRange(min + jround((max - min) * share), max))
      : augmentDamage(weapon, rng.normalIntRange(min, max));
    // ThirteenLeafClover.alterDamageRoll: now and then the most or the least it could be.
    const leaf = trinketLevel(hero, 'trinket.clover');
    if (leaf >= 0 && rng.float() < CLOVER.alterHeroDamageChance(leaf)) damage = augmentDamage(weapon, CLOVER.alterDamageRoll(rng, min, max));
    const excess = heroStr(hero) - strikeStr(hero, weapon);
    if (excess > 0) damage += rng.normalIntRange(0, excess);
    // RingOfForce.armedDamageBonus: rings of force add to a weapon's blow as well.
    damage += forceArmedBonus(hero);
  }
  // Fury: a berserker badly hurt hits half as hard again (seam: Shattered's Berserk is the talents stream's).
  if (hero.subclass === 'berserker' && hero.hp > 0 && hero.hp <= hero.ht * FURY_LEVEL) damage = Math.trunc(damage * 1.5);
  return Math.max(0, damage);
}

/**
 * Hero.attackDelay: the weapon's delay (Weapon.delayFactor: augmented, 1.2× slower a point of strength short); bare
 * hands, a turn; quicker with rings of furor (RingOfFuror.attackSpeedMultiplier).
 */
export function heroAttackDelay(hero: Hero, weapon: Strike = hero.weapon): number {
  if (!weapon) return f32(1 / attackSpeedMultiplier(hero));
  const category = itemDef(weapon.kind).category;
  let delay = augmentDelay(weapon, category === 'weapon' ? weaponDly(weapon.kind) : 1);
  const encumbrance = strikeStr(hero, weapon) - heroStr(hero);
  if (encumbrance > 0) delay = f32(delay * 1.2 ** encumbrance);
  // Scimitar.SwordDance: 0.6 faster (Weapon.speedMultiplier adds it to the furor ring's).
  return f32(delay / (attackSpeedMultiplier(hero) + (hero.cls && hasTimer(hero, 'dance') ? 0.6 : 0)));
}

/** Weapon.reachFactor: how far the weapon in hand strikes (a projecting one a cell further). */
export function heroReach(hero: Hero): number {
  if (!hero.weapon || itemDef(hero.weapon.kind).category !== 'weapon') return 1;
  const reach = weaponRch(hero.weapon.kind);
  return hero.weapon.enchant === 'projecting' ? reach + 1 : reach;
}

/** A weapon's level as its enchantment counts it (Weapon.buffedLvl): the spirit bow grows with its bearer. */
export const enchantLevel = (hero: Hero, weapon: Item): number =>
  itemDef(weapon.kind).category === 'bow' ? bowLevel(hero.lvl, weapon) : gearLevel(weapon);

/** What a hero's speed depends on besides the hero: the ground underfoot, and whether an enemy is near (Swiftness). */
export interface Footing {
  terrain: number;
  enemyNear: boolean;
}

/**
 * Hero.speed: crippled, half as fast (Char.speed); a freerunner unburdened and fed, faster (the 1.9 subclass, a seam
 * for the talents stream's Momentum); armour 1.2× slower a point of strength short (Armor.speedFactor); armour of
 * swiftness quicker with no enemy near, of flow in water, of bulk slow in doorways.
 */
export function heroSpeed(hero: Hero, footing?: Footing): number {
  const encumbrance = armorStr(hero.armor) - heroStr(hero);
  let speed = hero.crippled > 0 ? 0.5 : 1;
  if (hero.subclass === 'freerunner' && !isStarving(hero) && encumbrance <= 0) speed *= 1.6;
  if (encumbrance > 0) speed = f32(speed / 1.2 ** encumbrance);
  const glyph = hero.armor.glyph;
  const level = gearLevel(hero.armor);
  if (footing && glyph === 'swiftness' && !footing.enemyNear) speed = f32(speed * f32(1.2 + 0.04 * level));
  if (footing && glyph === 'flow' && footing.terrain >= T.WATER_TILES && footing.terrain <= T.WATER) speed = f32(speed * f32(2 + 0.5 * level));
  if (footing && glyph === 'bulk' && (footing.terrain === T.DOOR || footing.terrain === T.OPEN_DOOR)) speed = f32(speed / 3);
  // RingOfHaste.speedMultiplier; stamina, haste (buffs.ts).
  return f32(speed * speedMultiplier(hero) * buffSpeed(hero));
}

/** A hero's armour at its most (Armor.DRMax, with the weapon's parrying and the bark at theirs), for what wants one figure. */
export const heroArmor = (hero: Hero): number =>
  armorDrMax(hero.armor) + (hero.weapon && itemDef(hero.weapon.kind).category === 'weapon' ? weaponDefense(hero.weapon) : 0) +
  Math.max(0, Math.ceil(hero.barkskin ?? 0)) + (hero.buffs?.barkskin?.level ?? 0);
/** Hero.stealth: armour of obfuscation adds 1 and a third a level (Obfuscation.stealthBoost); talents add to it in their stream. */
export const heroStealth = (hero: Hero): number => (hero.armor.glyph === 'obfuscation' ? Math.fround(1 + gearLevel(hero.armor) / 3) : 0);
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
  | 'fetidRat' | 'curse' | 'ratKing' | 'wraith' | 'bee' | 'impShopkeeper' | 'ghostHero'
  /** Alchemy's prismatic image (PrismaticGuard). */
  | 'prismatic'
  /** WandOfWarding.Ward, WandOfLivingEarth.EarthGuardian, WandOfRegrowth.Lotus. */
  | 'ward' | 'guardian' | 'lotus';
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
  /** PrismaticImage: the hero's ally out of a scroll of prismatic image, as strong as its hero's level (see mobStats). */
  prismatic: { name: 'prismatic image', ht: 10, attack: 10, defense: 5, damage: [2, 4], dr: 0, exp: 0, maxLvl: 0, speed: 1 },
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
  /** A ward of the wand of warding (NPC: one hit point, until it grows into a sentry); it never misses. */
  ward: { name: 'ward', ht: 1, attack: 0, defense: 0, damage: [0, 0], dr: 0, exp: 0, maxLvl: 0, speed: 1 },
  /** The wand of living earth's guardian, as strong as the wand and the hero (see mobStats). */
  guardian: { name: 'earthen guardian', ht: 1, attack: 0, defense: 0, damage: [2, 4], dr: 0, exp: 0, maxLvl: 0, speed: 1 },
  /** The wand of regrowth's lotus, which withers a little every turn. */
  lotus: { name: 'golden lotus', ht: 25, attack: 0, defense: 0, damage: [0, 0], dr: 0, exp: 0, maxLvl: 0, speed: 1 },
  /** DriedRose.GhostHero: the sad ghost come back as a companion (its numbers come from its rose and its hero, see mobStats). */
  ghostHero: { name: 'sad ghost', ht: 40, attack: 10, defense: 5, damage: [1, 5], dr: 0, exp: 0, maxLvl: 0, speed: 1, flying: true },
};

/** A monster's numbers: the table's, but a mimic is as strong as the depth it lurks on (Mimic.adjustStats). */
export function mobStats(mob: Mob): MobStats {
  const depth = mob.level ?? 1;
  if (mob.kind === 'ghostHero' && mob.ghostGear) {
    // GhostHero: as accurate as the hero (lvl + 9) and as nimble (lvl + 4), striking with its weapon or bare-handed.
    const { lvl, str, weapon, armor } = mob.ghostGear;
    const w = weapon ? weaponStats(weapon) : null;
    return {
      ...MOBS.ghostHero, ht: mob.ht, attack: Math.trunc((lvl + 9) * (w?.accuracy ?? 1)), defense: lvl + 4,
      damage: w ? [w.min, w.max] : [1, Math.max(1, str - 8)], dr: armor ? armorDrMax(armor) : 0, attackDelay: w?.delay ?? 1,
    };
  }
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
  if (mob.kind === 'prismatic') {
    // PrismaticImage: the hero's accuracy and evasion (9 + lvl, 4 + lvl) and its own damage, by the hero's level.
    return { ...MOBS.prismatic, ht: mob.ht, attack: 9 + depth, defense: 4 + depth, damage: [2 + Math.trunc(depth / 4), 4 + Math.trunc(depth / 2)] };
  }
  if (mob.kind === 'wraith') return { ...MOBS.wraith, attack: 10 + depth, defense: (10 + depth) * 5, damage: [1, 3 + depth] };
  if (mob.kind === 'guardian') {
    // EarthGuardian: half the hero's evasion, and as accurate as the hero; damageRoll grows with the depth.
    const defense = mob.guardian?.defense ?? 0;
    return { ...MOBS.guardian, ht: mob.ht, attack: 2 * defense + 5, defense, damage: [2, 4 + Math.trunc(depth / 2)] };
  }
  // Ward.defenseSkill: a sentry dodges as well as the depth allows.
  if (mob.kind === 'ward') return { ...MOBS.ward, ht: mob.ht, defense: (mob.ward?.tier ?? 1) > 3 ? 4 + depth : 0 };
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
  /** Shattered's buffs from alchemy (buffs.ts): dread, aggression, a magical sleep and the like. */
  buffs?: Buffs;
  /** The hero an ally from alchemy follows (a prismatic image, an enthralled monster, a summoned elemental). */
  owner?: string;
  /** Thrown weapons stuck in it, dropped where it dies (PinCushion). */
  pinned?: Item[];
  /** Turns left of acting twice as fast (Adrenaline). */
  adrenaline?: number;
  /** A lucky blow landed (Lucky.LuckProc): should it die before it acts again, it drops something (at this ring level). */
  luck?: number;

  /* Shattered's wands (wands.ts, allies.ts, status.ts). */
  /** Char.Alignment.ALLY: it fights for the heroes (a ward, the earth guardian, a corrupted monster). */
  ally?: boolean;
  /** Corruption: an ally now, wasting away a hundredth of its health a turn (and the share of a point gathered so far). */
  corrupted?: boolean;
  corruptDecay?: number;
  /** An ally it is fighting (Mob.enemy, when that is not a hero). */
  foe?: string;
  /** Chill, Frost, Ooze, Weakness, Vulnerable, Hex, SoulMark, Bless, Invulnerability: turns left. */
  chill?: number;
  frozen?: number;
  ooze?: number;
  weakened?: number;
  vulnerable?: number;
  hexed?: number;
  soulMarked?: number;
  blessed?: number;
  invulnerable?: number;
  /** Corrosion: turns left, and how hard it eats away now. */
  corrosion?: { left: number; damage: number };
  /** Doom: it takes two thirds more harm, for good. */
  doomed?: boolean;
  /** Barrier: shielding that takes blows before health, fading a little every turn. */
  shield?: number;
  shieldDecay?: number;
  /** Charm.ignoreHeroAllies: blows from the heroes' allies do not shake off the charm (a wand of transfusion's). */
  charmFirm?: boolean;
  /** Charm.ignoreNextHit: the blow that charmed it (a friendly weapon's) does not shake the charm off. */
  charmIgnoreNext?: boolean;
  /** WandOfBlastWave.BWaveOnHitTracker: turns left before a battlemage's blast can strike it again. */
  blasted?: number;
  /** Levitation (a cursed wand's): turns left of floating over chasms and traps. */
  levitating?: number;
  /** A ward: its tier (2 and 3 sturdier wards, from 4 on a sentry), the wand level it shoots with, and its shots so far. */
  ward?: { tier: number; level: number; zaps: number };
  /** The earth guardian: the wand level it is of, and its evasion (half the hero's). */
  guardian?: { level: number; defense: number };
  /** The lotus: the level of the wand that grew it. */
  lotus?: { level: number };
  /** When its conditions last wore on (status.ts mobStatusTurn), so that they do so once a turn. */
  statusAt?: number;
  /** The rose's ghost (DirectableAlly, an ally too): whose it is, and the place it was told to hold (-1: none) and whether it is on its way. */
  directed?: { owner: string; defend: number; moving: boolean };
  /** The rose's ghost: its hero's level, its strength and the gear the rose gave it (GhostHero.updateRose). */
  ghostGear?: { lvl: number; str: number; weapon?: Item; armor?: Item };
  /** MasterThievesArmband.StolenTracker: robbed by the armband (nothing more to drop), or tried. */
  robbed?: 'stolen' | 'tried';
  /** What the Duelist's and the Cleric's abilities and spells have left on it (classes/state.ts). */
  marks?: MobMarks;
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
