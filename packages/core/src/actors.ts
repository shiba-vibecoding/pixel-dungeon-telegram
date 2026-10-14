import { effectiveLevel } from './wear';
import { dpow } from './fmath';
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
import type { VaultMob } from './vault-types';
import type { MineMobState } from './mine-types';
import type { BossMob } from './bosses/state';
import type { Awareness, PendingScroll } from './artifacts';
import type { WealthCounters } from './rings';
import { type AbilityKind, pointsInTalent, type TalentBook } from './talents/data';
import { holdFastArmor } from './talents/hold-fast';
import { freerunning, momentumEvasion, momentumSpeed } from './talents/rogue';
import { consumeLethalMomentum } from './talents/turns';
import type { TalentBuffs } from './talents/state';
import type { AbilityState } from './abilities/state';
import { natureBowSpeed, natureSpeed } from './abilities/huntress';

/*
 * Heroes and monsters as plain data: the hero's numbers as Shattered Pixel
 * Dungeon has them (Hero: accuracy, evasion, damage and speed with what is
 * worn; the kits are in heroclass.ts, the rest of the hero's rules in
 * hero.ts), and the monsters' with the original's Bestiary.
 */

const f32 = Math.fround;

export type { HeroClass } from './heroclass';
export { HUNGRY, isHungry, isStarving, STARVING } from './hero';

/** HeroSubClass: the two ways each class can master with Tengu's mask (HeroClass's subclasses, in its order). */
export type SubClass = 'gladiator' | 'berserker' | 'battlemage' | 'warlock' | 'freerunner' | 'assassin' | 'sniper' | 'warden';
export const SUBCLASSES: Readonly<Record<HeroClass, readonly [SubClass, SubClass]>> = {
  warrior: ['berserker', 'gladiator'],
  mage: ['battlemage', 'warlock'],
  rogue: ['assassin', 'freerunner'],
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
  /** Caustic ooze from Goo: 0 while it eats at the hero, -1 when clean. Water washes it off. */
  ooze: number;
  /** Ooze.left and Ooze.acted: turns before it wears off, and whether it has hurt yet (bosses/goo.ts). */
  oozeLeft?: number;
  oozeActed?: boolean;
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
  /** The way the hero has mastered, once they have put on Tengu's mask (HeroSubClass). */
  subclass: SubClass | null;
  /** Shattered's talents (talents/): the points in each, tier by tier; absent in older saves (started by talentBook). */
  talents?: TalentBook;
  /** The talents' trackers and the subclasses' buffs: berserk rage, combo, momentum, preparation, the sniper's mark... */
  tal?: TalentBuffs;
  /** Pixel Dungeon's barkskin from mystery meat (a frozen carpaccio), adding to armour and wearing off a point a turn. */
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
  /** Hero.armorAbility: the ability the Dwarf King's crown gave the class armour (abilities/). */
  ability?: AbilityKind;
  /** The ability's trackers: Endure, the leap's double jump, Nature's Power, the warp beacon... (abilities/state.ts). */
  abil?: AbilityState;
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
    barkskin: 0,
    hunger: 0,
    hungerTime: 0,
    kills: 0,
    killedBy: null,
  };
}

/** Hero.STARTING_STR. */
export const STARTING_STR = 10;

/** Char.isAlive: health left, or marked for death (DeathMark: a monster at no health lives until the mark ends). */
export const isAlive = (char: { hp: number; deathMark?: unknown }): boolean => char.hp > 0 || char.deathMark !== undefined;

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

/** Hero.STR: rings of might add to it (RingOfMight.strengthBonus), so does the strongman talent and a warden's surge. (Shattered's Weakness takes nothing from strength: a weakened blow is two thirds as hard, combat.ts.) */
export const heroStr = (hero: Hero): number => hero.str + mightStrength(hero) + strongmanBonus(hero) + ((hero.tal?.surge ?? -1) >= 0 ? 1 : 0);

/** Hero.STR with the strongman talent: a share of the base strength more (3% + 5% a point), rounded down. */
const strongmanBonus = (hero: Hero): number => {
  const points = pointsInTalent(hero, 'strongman');
  return points > 0 ? Math.floor(f32(hero.str * f32(0.03 + 0.05 * points))) : 0;
};

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
  let factor = encumbrance > 0 ? f32(acc / dpow(1.5, encumbrance)) : acc;
  if ((category === 'missile' || category === 'bow') && targetPos !== undefined) {
    // MissileWeapon.adjacentAccFactor: half as accurate point-blank (a quarter better a point of point blank), and half again from afar.
    factor = f32(factor * (adjacent(hero.pos, targetPos) ? f32(0.5 + 0.25 * pointsInTalent(hero, 'point_blank')) : 1.5));
  }
  return factor;
}

/** Char.hit with Bless: the blessed roll a quarter higher, attacking and defending alike. */
const blessing = (hero: Hero): number => ((hero.blessed ?? 0) > 0 ? 1.25 : 1);

/** Hero.attackSkill: with a weapon, times its accuracy factor; a ring of accuracy helps either way (RingOfAccuracy.accuracyMultiplier). */
export function heroAttackSkill(hero: Hero, targetPos?: number, weapon: Strike = hero.weapon): number {
  const accuracy = f32(accuracyMultiplier(hero) * blessing(hero));
  if (!weapon) return Math.max(1, jround(f32(hero.attackSkill * accuracy)));
  // Hero.attackSkill: freerunning with projectile momentum, a thrown weapon is more accurate (half again a point).
  const thrownBy = itemDef(weapon.kind).category;
  const momentum = (thrownBy === 'missile' || thrownBy === 'bow') && freerunning(hero) ? f32(1 + pointsInTalent(hero, 'projectile_momentum') / 2) : 1;
  return Math.max(1, jround(f32(f32(f32(hero.attackSkill * accuracy) * momentum) * accuracyFactor(hero, weapon, targetPos))));
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
  if (encumbrance > 0) evasion = f32(evasion / dpow(1.5, encumbrance));
  // Momentum.evasionBonus: freerunning, half the hero's level more, and evasive armor's share of strength to spare.
  evasion = f32(evasion + momentumEvasion(hero, Math.max(0, -encumbrance)));
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
  // HoldFast.armorBonus: resting on a spot.
  dr += holdFastArmor(hero, rng);
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
export function heroDamageRoll(hero: Hero, rng: Rng, surprised = false, weapon: Strike = hero.weapon): number {
  let damage: number;
  if (!weapon) {
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
  // MissileWeapon.damageRoll: freerunning with projectile momentum, a thrown weapon hits harder (15% a point).
  if (weapon && itemDef(weapon.kind).category === 'missile' && freerunning(hero)) {
    damage = Math.round(f32(damage * f32(1 + f32(0.15 * pointsInTalent(hero, 'projectile_momentum')))));
  }
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
  if (encumbrance > 0) delay = f32(delay * dpow(1.2, encumbrance));
  // Hero.attackDelay: a lethal momentum makes the blow cost nothing (consumed by the caller, once it knows it struck).
  // SpiritBow.speedMultiplier under Nature's Power: a third to a half more.
  if (category === 'bow') return f32(delay / (attackSpeedMultiplier(hero) + natureBowSpeed(hero)));
  return f32(delay / attackSpeedMultiplier(hero));
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
  if (encumbrance > 0) speed = f32(speed / dpow(1.2, encumbrance));
  const glyph = hero.armor.glyph;
  const level = gearLevel(hero.armor);
  if (footing && glyph === 'swiftness' && !footing.enemyNear) speed = f32(speed * f32(1.2 + 0.04 * level));
  if (footing && glyph === 'flow' && footing.terrain === T.WATER) speed = f32(speed * f32(2 + 0.5 * level));
  if (footing && glyph === 'bulk' && (footing.terrain === T.DOOR || footing.terrain === T.OPEN_DOOR)) speed = f32(speed / 3);
  // RingOfHaste.speedMultiplier; stamina, haste (buffs.ts).
  // Nature's Power: twice as fast, and more with Growing Power; momentum (freerunner) quickens the step.
  return f32(speed * speedMultiplier(hero) * buffSpeed(hero) * natureSpeed(hero) * momentumSpeed(hero));
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
  | 'ward' | 'guardian' | 'lotus'
  /** The armour abilities' allies: ShadowClone.ShadowAlly, SpiritHawk.HawkAlly, SmokeBomb.NinjaLog. */
  | 'shadow' | 'hawk' | 'ninjaLog'
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
  | 'gnollTrickster' | 'greatCrab'
  // Shattered's bosses' own: DM-300's pylons, Yog-Dzewa's other four fists (the King's ghouls are the city's).
  | 'pylon' | 'soiledFist' | 'rustedFist' | 'brightFist' | 'darkFist'
  // The levels' rooms and quests: SentryRoom's sentry, the wandmaker's, the blacksmith's mine, the imp's vault.
  | 'sentry'
  | 'rotHeart' | 'rotLasher' | 'newbornElemental'
  // The blacksmith's mine (minemobs.ts).
  | 'crystalWisp' | 'crystalGuardian' | 'crystalSpire' | 'gnollGuard' | 'gnollSapper' | 'gnollGeomancer'
  | 'fungalSentry' | 'fungalSpinner' | 'fungalCore'
  // The dwarven vault (vault.ts, vaultmobs.ts, vaultboss.ts).
  | 'vaultSentry' | 'vaultLaser' | 'vaultMirror' | 'vaultTokenDoor' | 'vaultRat' | 'vaultSkeleton' | 'vaultDM100' | 'vaultDM200'
  | 'vaultGhoul' | 'vaultGolem' | 'vaultShaman' | 'vaultFireElemental' | 'vaultFrostElemental' | 'vaultShockElemental'
  | 'vaultBossElemental';
/**
 * `passive`: the sad ghost and the shopkeeper, who neither fight nor can be hurt; `fleeing`: a thief making off with its loot;
 * `investigating`: a vault monster that glimpsed someone and goes to look (Mob.INVESTIGATING, vaultmobs.ts).
 */
export type MobState = 'sleeping' | 'wandering' | 'hunting' | 'fleeing' | 'passive' | 'investigating';

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
  // Goo (Shattered): its accuracy, damage and evasion change as it is hurt and pumps up (bosses/goo.ts).
  goo: { name: 'Goo', ht: 100, attack: 10, defense: 8, damage: [1, 8], dr: 2, exp: 10, maxLvl: 29, speed: 1 },
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
  tengu: { name: 'Tengu', ht: 200, attack: 20, defense: 15, damage: [6, 12], dr: 5, exp: 20, maxLvl: 29, speed: 1 },
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
  dm300: { name: 'DM-300', ht: 300, attack: 20, defense: 15, damage: [15, 25], dr: 10, exp: 30, maxLvl: 29, speed: 1 },
  /** Pylon: DM-300's power source in a corner of its arena, harmless until switched on. */
  pylon: { name: 'power pylon', ht: 50, attack: 0, defense: 0, damage: [0, 0], dr: 0, exp: 1, maxLvl: -2, speed: 1 },
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
  king: { name: 'King of Dwarves', ht: 300, attack: 26, defense: 22, damage: [15, 25], dr: 10, exp: 40, maxLvl: 29, speed: 1 },
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
  yog: { name: 'Yog-Dzewa', ht: 1000, attack: 0, defense: 0, damage: [0, 0], dr: 0, exp: 50, maxLvl: 29, speed: 1 },
  // YogFist: six kinds, two of a pair never together (bosses/yog.ts); no experience (maxLvl -2).
  rottingFist: { name: 'rotting fist', ht: 300, attack: 36, defense: 20, damage: [18, 36], dr: 15, exp: 25, maxLvl: -2, speed: 1 },
  burningFist: { name: 'burning fist', ht: 300, attack: 36, defense: 20, damage: [18, 36], dr: 15, exp: 25, maxLvl: -2, speed: 1 },
  soiledFist: { name: 'soiled fist', ht: 300, attack: 36, defense: 20, damage: [18, 36], dr: 15, exp: 25, maxLvl: -2, speed: 1 },
  rustedFist: { name: 'rusted fist', ht: 300, attack: 36, defense: 20, damage: [22, 44], dr: 15, exp: 25, maxLvl: -2, speed: 1 },
  brightFist: { name: 'bright fist', ht: 300, attack: 36, defense: 20, damage: [18, 36], dr: 15, exp: 25, maxLvl: -2, speed: 1 },
  darkFist: { name: 'dark fist', ht: 300, attack: 36, defense: 20, damage: [18, 36], dr: 15, exp: 25, maxLvl: -2, speed: 1 },
  /** YogDzewa.Larva. */
  larva: { name: "god's larva", ht: 20, attack: 30, defense: 12, damage: [15, 25], dr: 4, exp: 5, maxLvl: -2, speed: 1 },
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
  /** PrismaticImage: the hero's ally out of a scroll of prismatic image, as strong as its hero's level (see mobStats). */
  prismatic: { name: 'prismatic image', ht: 10, attack: 10, defense: 5, damage: [2, 4], dr: 0, exp: 0, maxLvl: 0, speed: 1 },
  blacksmith: { name: 'troll blacksmith', ht: 1, attack: 0, defense: 1000, damage: [0, 0], dr: 0, exp: 0, maxLvl: 0, speed: 1 },
  imp: { name: 'ambitious imp', ht: 1, attack: 0, defense: 1000, damage: [0, 0], dr: 0, exp: 0, maxLvl: 0, speed: 1 },
  curse: { name: 'curse personification', ht: 16, attack: 12, defense: 12, damage: [3, 5], dr: 1, exp: 0, maxLvl: 5, speed: 0.5, flying: true },
  /** Out of a honeypot: it guards the pot's pieces against anyone near them (its numbers grow with the depth). */
  bee: { name: 'golden bee', ht: 12, attack: 10, defense: 10, damage: [1, 3], dr: 0, exp: 0, maxLvl: ANY_LVL, speed: 1, flying: true },
  /** Asleep (or so he says) in his hidden treasury beside Goo's lair. */
  ratKing: { name: 'rat king', ht: 1, attack: 0, defense: 1000, damage: [0, 0], dr: 0, exp: 0, maxLvl: 0, speed: 2 },
  /** SentryRoom.Sentry: an immovable, invulnerable watcher that burns whoever walks its room's floor (see roommobs.ts). */
  sentry: { name: 'sentry', ht: 1, attack: 0, defense: 1000, damage: [0, 0], dr: 0, exp: 0, maxLvl: 0, speed: 1 },
  // The old wandmaker's errands (wandmaker-mobs.ts): the rotberry's heart and its lashers, rooted in their garden,
  // and the newborn fire elemental of the ritual site.
  rotHeart: { name: 'rot heart', ht: 80, attack: 0, defense: 0, damage: [0, 0], dr: 5, exp: 4, maxLvl: 30, speed: 1 },
  rotLasher: { name: 'rot lasher', ht: 80, attack: 25, defense: 0, damage: [10, 20], dr: 8, exp: 1, maxLvl: 30, speed: 1 },
  newbornElemental: { name: 'newborn fire elemental', ht: 60, attack: 15, defense: 12, damage: [10, 12], dr: 5, exp: 10, maxLvl: 20, speed: 1, flying: true },
  // The blacksmith's mine (minemobs.ts). maxLvl -2: no experience and no loot from the quest's monsters.
  crystalWisp: { name: 'crystal wisp', ht: 30, attack: 18, defense: 16, damage: [5, 10], dr: 5, exp: 7, maxLvl: -2, speed: 1, flying: true },
  crystalGuardian: { name: 'crystal guardian', ht: 100, attack: 20, defense: 14, damage: [10, 16], dr: 10, exp: 10, maxLvl: -2, speed: 1 },
  /** CrystalSpire: immovable, hurt only by the pickaxe; it calls its guardians and sends crystal spikes (minemobs.ts). */
  crystalSpire: { name: 'crystal spire', ht: 300, attack: 0, defense: 0, damage: [0, 0], dr: 0, exp: 20, maxLvl: 29, speed: 1 },
  gnollGuard: { name: 'gnoll guard', ht: 35, attack: 20, defense: 15, damage: [6, 12], dr: 6, exp: 7, maxLvl: -2, speed: 1 },
  gnollSapper: { name: 'gnoll sapper', ht: 45, attack: 18, defense: 15, damage: [1, 6], dr: 6, exp: 10, maxLvl: -2, speed: 1 },
  /** GnollGeomancer: immovable but for its dashes; armoured in rock, it throws boulders and brings rocks down (minemobs.ts). */
  gnollGeomancer: { name: 'gnoll geomancer', ht: 150, attack: 20, defense: 0, damage: [3, 6], dr: 6, exp: 20, maxLvl: 29, speed: 1 },
  fungalSentry: { name: 'fungal sentry', ht: 200, attack: 50, defense: 12, damage: [5, 10], dr: 0, exp: 10, maxLvl: -2, speed: 1 },
  fungalSpinner: { name: 'fungal spinner', ht: 40, attack: 22, defense: 16, damage: [10, 20], dr: 6, exp: 7, maxLvl: -2, speed: 1 },
  fungalCore: { name: 'fungal core', ht: 300, attack: 0, defense: 0, damage: [0, 0], dr: 0, exp: 20, maxLvl: 29, speed: 1 },
  // The dwarven vault's hazards and fixtures (VaultSentry, VaultLaser, VaultMirror, VaultTokenDoor): immovable, never hurt.
  vaultSentry: { name: 'scanning sentry', ht: 1, attack: 0, defense: 1000, damage: [0, 0], dr: 0, exp: 0, maxLvl: 0, speed: 1 },
  vaultLaser: { name: 'disintegration sentry', ht: 1, attack: 0, defense: 1000, damage: [0, 0], dr: 0, exp: 0, maxLvl: 0, speed: 1 },
  vaultMirror: { name: 'strange mirror', ht: 1, attack: 0, defense: 1000, damage: [0, 0], dr: 0, exp: 0, maxLvl: 0, speed: 1 },
  vaultTokenDoor: { name: 'strange door', ht: 1, attack: 0, defense: 1000, damage: [0, 0], dr: 0, exp: 0, maxLvl: 0, speed: 1 },
  // The vault's guards (actors/mobs/quest/vault): Shattered's monsters, sharper and tougher, worth no experience but a
  // dwarf token each; the base kind's numbers with the vault's accuracy, evasion and extra armour (vaultmobs.ts).
  vaultRat: { name: 'marsupial rat', ht: 8, attack: 24, defense: 18, damage: [1, 4], dr: 1, exp: 0, maxLvl: 30, speed: 1 },
  vaultSkeleton: { name: 'dwarven skeleton', ht: 25, attack: 24, defense: 20, damage: [2, 10], dr: 9, exp: 0, maxLvl: 30, speed: 1 },
  vaultDM100: { name: 'modified DM-100', ht: 20, attack: 25, defense: 18, damage: [2, 8], dr: 8, exp: 0, maxLvl: 30, speed: 1 },
  vaultDM200: { name: 'modified DM-200', ht: 80, attack: 28, defense: 15, damage: [10, 25], dr: 8, exp: 0, maxLvl: 30, speed: 1 },
  vaultGhoul: { name: 'dwarven ghoul', ht: 45, attack: 24, defense: 20, damage: [16, 22], dr: 4, exp: 0, maxLvl: 30, speed: 1 },
  vaultGolem: { name: 'golem', ht: 120, attack: 28, defense: 15, damage: [25, 30], dr: 12, exp: 0, maxLvl: 30, speed: 1 },
  vaultShaman: { name: 'captured shaman', ht: 35, attack: 25, defense: 18, damage: [5, 25], dr: 11, exp: 0, maxLvl: 30, speed: 1 },
  vaultFireElemental: { name: 'fire elemental', ht: 60, attack: 25, defense: 20, damage: [20, 25], dr: 5, exp: 0, maxLvl: 30, speed: 1, flying: true },
  vaultFrostElemental: { name: 'frost elemental', ht: 60, attack: 25, defense: 20, damage: [20, 25], dr: 5, exp: 0, maxLvl: 30, speed: 1, flying: true },
  vaultShockElemental: { name: 'shock elemental', ht: 60, attack: 25, defense: 20, damage: [20, 25], dr: 5, exp: 0, maxLvl: 30, speed: 1, flying: true },
  /** VaultBossElemental: the greater elemental guarding the vault's treasure, its form changing as it is hurt (vaultboss.ts). */
  vaultBossElemental: { name: 'greater elemental', ht: 600, attack: 28, defense: 20, damage: [20, 25], dr: 10, exp: 30, maxLvl: 29, speed: 1 },
  /** A ward of the wand of warding (NPC: one hit point, until it grows into a sentry); it never misses. */
  ward: { name: 'ward', ht: 1, attack: 0, defense: 0, damage: [0, 0], dr: 0, exp: 0, maxLvl: 0, speed: 1 },
  /** The wand of living earth's guardian, as strong as the wand and the hero (see mobStats). */
  guardian: { name: 'earthen guardian', ht: 1, attack: 0, defense: 0, damage: [2, 4], dr: 0, exp: 0, maxLvl: 0, speed: 1 },
  /** The wand of regrowth's lotus, which withers a little every turn. */
  lotus: { name: 'golden lotus', ht: 25, attack: 0, defense: 0, damage: [0, 0], dr: 0, exp: 0, maxLvl: 0, speed: 1 },
  /** DriedRose.GhostHero: the sad ghost come back as a companion (its numbers come from its rose and its hero, see mobStats). */
  ghostHero: { name: 'sad ghost', ht: 40, attack: 10, defense: 5, damage: [1, 5], dr: 0, exp: 0, maxLvl: 0, speed: 1, flying: true },
  /** ShadowClone.ShadowAlly: 80 health, the hero's own accuracy and evasion (see mobStats and abilities/allies.ts). */
  shadow: { name: 'shadow clone', ht: 80, attack: 15, defense: 5, damage: [10, 20], dr: 0, exp: 0, maxLvl: 0, speed: 1 },
  /** SpiritHawk.HawkAlly: ten health, quick and flying, living a hundred turns. */
  hawk: { name: 'spirit hawk', ht: 10, attack: 60, defense: 60, damage: [5, 10], dr: 0, exp: 0, maxLvl: 0, speed: 2, flying: true },
  /** SmokeBomb.NinjaLog: a decoy left behind (20 health a point of Body Replacement), which never acts. */
  ninjaLog: { name: 'ninja log', ht: 20, attack: 0, defense: 0, damage: [0, 0], dr: 0, exp: 0, maxLvl: 0, speed: 1 },
};

/** Weapon.defenseFactor (a shield's, a greatsword's...): the armour a statue's weapon adds to its own. */
export const weaponDefenseFactor = (weapon: Item): number => weaponDefense(weapon);

/**
 * A monster's numbers: the table's, or as strong as the depth it is on — an animated statue with its
 * weapon (Statue), an armoured one twice as sturdy (ArmoredStatue), a mimic as its level (Mimic.adjustStats,
 * a golden one a third stronger), a piranha (Piranha), a wraith (Wraith.adjustStats, a tormented spirit's
 * half as good again); a boss's summoned minion teaches
 * nothing and leaves nothing (maxLvl -2).
 */
export function mobStats(mob: Mob): MobStats {
  const stats = ownStats(mob);
  return mob.bossMinion ? { ...stats, maxLvl: -2 } : stats;
}

function ownStats(mob: Mob): MobStats {
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
  if (mob.kind === 'prismatic') {
    // PrismaticImage: the hero's accuracy and evasion (9 + lvl, 4 + lvl) and its own damage, by the hero's level.
    return { ...MOBS.prismatic, ht: mob.ht, attack: 9 + depth, defense: 4 + depth, damage: [2 + Math.trunc(depth / 4), 4 + Math.trunc(depth / 2)] };
  }
  if (mob.kind === 'shadow') {
    // ShadowAlly: the hero's own accuracy and evasion at its level (set when it was made).
    const defense = mob.shadow?.defense ?? 5;
    return { ...MOBS.shadow, ht: mob.ht, attack: defense + 5, defense };
  }
  if (mob.kind === 'ninjaLog') return { ...MOBS.ninjaLog, ht: mob.ht };
  if (mob.kind === 'guardian') {
    // EarthGuardian: half the hero's evasion, and as accurate as the hero; damageRoll grows with the depth.
    const defense = mob.guardian?.defense ?? 0;
    return { ...MOBS.guardian, ht: mob.ht, attack: 2 * defense + 5, defense, damage: [2, 4 + Math.trunc(depth / 2)] };
  }
  // Ward.defenseSkill: a sentry dodges as well as the depth allows.
  if (mob.kind === 'ward') return { ...MOBS.ward, ht: mob.ht, defense: (mob.ward?.tier ?? 1) > 3 ? 4 + depth : 0 };
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
  // Char.speed: Haste three times as fast (a crystal mimic on the run), Adrenaline twice, and alchemy's buffs (dread, stamina).
  const speed = MOBS[mob.kind].speed * ((mob.haste ?? 0) > 0 ? 3 : 1) * ((mob.adrenaline ?? 0) > 0 ? 2 : 1) * buffSpeed(mob)
    // DM300.speed: supercharged, twice as fast (bosses/dm300.ts).
    * (mob.kind === 'dm300' && mob.boss?.supercharged ? 2 : 1);
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
  /** SecretHoneypotRoom's bee: the shattered pot it guards (Bee.potPos), no one holding it. */
  beeHome?: number;
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
  /** SentryRoom.Sentry: the room it watches, and its charge (the turns a hero may stand on its floor). */
  room?: { left: number; top: number; right: number; bottom: number };
  initialChargeDelay?: number;
  curChargeDelay?: number;
  /** CorpseDust.DustWraith: a wraith the corpse dust raised, and how many times it went for the hero (atkCount). */
  dust?: number;
  /** NewbornFireElemental.targetingPos (-1: not charging); its cooldown is rangedCooldown below. */
  targetingPos?: number;
  /** A mirror image: whose twin it is, and the skill and strength it took from them. */
  image?: { owner: string; attack: number; damage: number };
  /** The dwarven vault's characters: their scans, beams, wandering rounds and spells (vault-types.ts). */
  vault?: VaultMob;
  /** The blacksmith's mine's monsters: colours, partners, abilities, rocks on their way (mine-types.ts). */
  mine?: MineMobState;
  /** A boss's own state (Goo's pumping up, Tengu's abilities, DM-300's charge, the King's phases...): bosses/state.ts. */
  boss?: BossMob;
  /** Property.BOSS_MINION: summoned by a boss (the King's court, Yog's larvae); teaches nothing (maxLvl -2). */
  bossMinion?: boolean;
  /** Shattered's buffs from alchemy (buffs.ts): dread, aggression, a magical sleep and the like. */
  buffs?: Buffs;
  /** The hero an ally from alchemy follows (a prismatic image, an enthralled monster, a summoned elemental). */
  owner?: string;
  /** Thrown weapons stuck in it, dropped where it dies (PinCushion). */
  pinned?: Item[];
  /** Turns left of acting twice as fast (Adrenaline). */
  adrenaline?: number;
  /** SuckerPunchTracker: a sucker punch has struck it already. */
  suckered?: boolean;
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
  /**
   * DeathMark.DeathMarkTracker (abilities/rogue.ts): the time the mark ends, and the health it had when marked.
   * Marked, it takes a quarter more harm and is not dead at no health (Char.isAlive: deathMarked) until the mark ends.
   */
  deathMark?: { until: number; hp: number };
  /** ShadowClone.ShadowAlly, SpiritHawk.HawkAlly, SmokeBomb.NinjaLog: the abilities' allies' own state (abilities/allies.ts). */
  shadow?: { defense: number };
  hawk?: { remaining: number; dodges: number };
  ninja?: { points: number };

  /* Shattered's monsters (mobs.ts, mobskills.ts, champions.ts). */
  /** Necromancer's skeleton: its master (Adrenaline, from a zap of its master: adrenaline below). */
  master?: string;
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
  /** Elemental.rangedCooldown. */
  rangedCooldown?: number;
  /** Monk.focusCooldown, and Focus (it parries the next blow). */
  focusCooldown?: number;
  focused?: boolean;
  /** Succubus.blinkCooldown. */
  blinkCooldown?: number;
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
  // Pylon.beckon and YogDzewa.beckon: they never come.
  if (mob.kind === 'pylon' || mob.kind === 'yog') return;
  // CrystalGuardian and GnollGeomancer.beckon: not while asleep; CrystalSpire.beckon: never; the fungi are rooted.
  if ((mob.kind === 'crystalGuardian' || mob.kind === 'gnollGeomancer') && mob.state === 'sleeping') return;
  if (mob.kind === 'crystalSpire' || mob.kind === 'fungalCore' || mob.kind === 'fungalSentry') return;
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
