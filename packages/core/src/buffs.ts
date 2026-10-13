import { baseKind, type Hero, isAlive, type Mob, MOBS } from './actors';
import { hurt } from './combat';
import { type Char, charAt, type Ctx, exploredCells, heroView, isHero, isWater } from './floor';
import { circleCells } from './fov';
import { createItem, itemDef, type ItemKind, WAND_RECHARGE, wandMaxCharges } from './items';
import { distance, LENGTH, NEIGHBOURS8 } from './level/geometry';
import { discover, F, hasFlag, T } from './level/terrain';
import { clearGasAt, seedGas } from './gas';
import { freezeHeaps } from './cooking';
import { looseItems } from './bags';
import { prismaticGuard } from './allies';
import { censerTurn } from './trinkets';
import { shatterPotion } from './potions';
import type { TrapKind } from './traps';
import { VIAL_OF_BLOOD, trinketLevel } from './trinkets';

/*
 * Shattered's buffs that alchemy brings (actors/buffs): what its potions, scrolls, stones, spells, brews and
 * elixirs do to heroes and monsters for a while. Kept on the character as `buffs`, turns left or a little state,
 * and played out a turn at a time: for a hero as time passes (world.ts spend), for a monster on its own turn
 * (traps.ts mobConditions). The older conditions of the original (poison, burning, paralysis...) stay where they
 * were, on the characters themselves.
 */

export interface Buffs {
  /** Haste (three times as fast), Stamina (half as fast again), MagicalSight, MagicImmune, Foresight: turns left. */
  haste?: number;
  stamina?: number;
  magicalSight?: number;
  magicImmune?: number;
  foresight?: number;
  /** Recharging: wands charge a quarter faster for so many turns; ArtifactRecharge (artifacts' seam). */
  recharging?: number;
  artifactRecharge?: number;
  /** FireImbue (immune to fire, setting what it strikes alight), FrostImbue (chilling what it strikes), ToxicImbue (a cloud of poison around): turns left. */
  fireImbue?: number;
  frostImbue?: number;
  toxicImbue?: number;
  /** ElixirOfFeatherFall.FeatherBuff: falls hurt nothing while it lasts. */
  featherFall?: number;
  /** PotionOfCleansing.Cleanse: nothing harmful takes hold for a few turns. */
  cleanse?: number;
  /** Drowsy (falls into a magical sleep when it runs out) and MagicalSleep. */
  drowsy?: number;
  magicalSleep?: boolean;
  /** Chill: slowed, the more the longer it lasts; Frost: frozen stiff (with paralysis). */
  chill?: number;
  frost?: number;
  /** Ooze (a caustic brew): it burns a little every turn, until washed off in water. */
  ooze?: number;
  /** Corrosion: so much harm a turn, growing, for so many turns. */
  corrosion?: { left: number; damage: number };
  /** Healing: health back over time (PotionOfHealing), at most so much a turn with a vial of blood. */
  healing?: { left: number; percent: number; flat: number; limit?: number };
  /** Barrier: a shield that takes the blows, and wanes. */
  barrier?: { shield: number; partial: number };
  /** ArcaneArmor and Barkskin (earthen armour): a level that wanes a point every `interval` turns. */
  arcaneArmor?: { level: number; interval: number; next: number };
  barkskin?: { level: number; interval: number; next: number };
  /** ElixirOfAquaticRejuvenation.AquaHealing: health back while standing in water, so much in all. */
  aquaHealing?: number;
  /** ElixirOfMight.HTBoost: levels left that the boost to health lasts. */
  htBoost?: number;
  /** The health HTBoost has added, so that it can be taken back as it changes. */
  htBoosted?: number;
  /** WellFed (a meat pie): no hunger, and a little health, for so long. */
  wellFed?: number;
  /** PrismaticGuard: a prismatic image waiting to step out, with so much health. */
  prismaticGuard?: number;
  /** ScrollOfChallenge.ChallengeArena: the arena's cells and turns left. */
  challenge?: { cells: number[]; left: number };
  /** BeaconOfReturning.BeaconTracker: where the beacon was set. */
  beacon?: { depth: number; pos: number };
  /** ReclaimTrap.ReclaimedTrap: the trap the spell holds. */
  reclaimed?: TrapKind;
  /** PotionOfDivineInspiration.DivineInspirationTracker: talent tiers already boosted (the talents stream's seam). */
  inspired?: number[];
  /** StoneOfIntuition.IntuitionUseTracker: a stone of intuition was used once already. */
  intuitionUsed?: boolean;
  /** ChaoticCenser.CenserGasTracker: turns until the next puff, and a puff about to land. */
  censer?: { left: number; spew?: { cell: number; gas: string; amount: number; depth: number } };
  /** Monsters: StoneOfAggression.Aggression (every other monster goes for it), Dread (flees and vanishes). */
  aggression?: number;
  dread?: number;
  dreadOf?: string;
}

/** The buffs of a character, started on first use. */
export const buffsOf = (char: Char): Buffs => (char.buffs ??= {});

/* Durations (each buff's DURATION) */

export const HASTE_TURNS = 20;
export const STAMINA_TURNS = 100;
export const MAGICAL_SIGHT_TURNS = 50;
export const MAGIC_IMMUNE_TURNS = 20;
export const FORESIGHT_TURNS = 400;
export const RECHARGING_TURNS = 30;
export const IMBUE_TURNS = 50;
export const FEATHER_TURNS = 50;
export const CLEANSE_TURNS = 5;
export const DROWSY_TURNS = 5;
export const CHILL_TURNS = 10;
export const FROST_TURNS = 10;
export const BLINDNESS_TURNS = 10;
export const WEAKNESS_TURNS = 20;
export const AGGRESSION_TURNS = 20;
export const DREAD_TURNS = 20;
export const ROOTS_TURNS = 5;
export const CRIPPLE_TURNS = 10;
export const OOZE_TURNS = 20;
export const CHARM_TURNS = 10;
export const TERROR_TURNS = 20;
export const AMOK_TURNS = 5;
export const PARALYSIS_TURNS = 10;
export const BURNING_TURNS = 8;
/** MagicalSight.DISTANCE and Foresight.DISTANCE. */
export const MAGICAL_SIGHT_DISTANCE = 12;
export const FORESIGHT_DISTANCE = 8;

const has = (value: number | undefined): boolean => (value ?? 0) > 0;

/** Char.speed: stamina half as fast again, haste three times, dread twice (fleeing). */
export function buffSpeed(char: Char): number {
  const b = char.buffs;
  if (!b) return 1;
  return (has(b.stamina) ? 1.5 : 1) * (has(b.haste) ? 3 : 1) * (has(b.dread) ? 2 : 1);
}

/** Chill.speedFactor: everything takes longer the longer the chill lasts, twice as long at most (Char.spend). */
export const chillFactor = (char: Char): number => (has(char.buffs?.chill) ? Math.max(0.5, 1 - char.buffs!.chill! * 0.1) : 1);

/** MagicImmune: no magic of one's own works, nor any on one (rings, scrolls, wands, spells, runestones). */
export const isMagicImmune = (char: Char): boolean => has(char.buffs?.magicImmune);

/** Char.Property.FIERY: the fire elementals and the burning fist. */
export const isFiery = (char: Char): boolean => !isHero(char) && (char.kind === 'elemental' || char.kind === 'burningFist');

/** Char.Property.UNDEAD and DEMONIC, as the holy bomb sees them. */
export function isUnholy(char: Char): boolean {
  if (isHero(char)) return false;
  const kind = baseKind(char.kind);
  return ['skeleton', 'undead', 'wraith', 'king', 'succubus', 'eye', 'scorpio', 'yog', 'rottingFist', 'burningFist', 'larva'].includes(kind);
}

/** Whether something harmful would be shaken off at once: a potion of cleansing's Cleanse. */
export const cleansed = (char: Char): boolean => has(char.buffs?.cleanse);

/* Fire and frost */

/** Burning.reignite: on fire for the full time, unless immune (fire imbue) or standing in water. */
export function igniteChar(ctx: Ctx, char: Char): void {
  if (!isAlive(char) || cleansed(char)) return;
  if (isHero(char) ? has(char.buffs?.fireImbue) : char.kind === 'piranha' || char.kind === 'yog' || char.kind === 'burningFist') return;
  if (isWater(ctx.level.map[char.pos]!)) return;
  // Burning.attachTo: chill and frost give way.
  if (char.buffs) {
    delete char.buffs.chill;
    if (has(char.buffs.frost)) {
      char.paralysed = 0;
      delete char.buffs.frost;
    }
  }
  char.burning = Math.max(char.burning ?? 0, BURNING_TURNS);
}

/** Frost and Chill cannot take hold of those imbued with frost, nor of piranhas. */
const frostImmune = (char: Char): boolean => (isHero(char) ? has(char.buffs?.frostImbue) : char.kind === 'piranha');

/** Buff.affect(ch, Chill.class, turns): more chill, which puts fire out (Chill.attachTo). */
export function chillChar(char: Char, turns: number): void {
  if (frostImmune(char) || cleansed(char) || !isAlive(char)) return;
  const b = buffsOf(char);
  b.chill = (b.chill ?? 0) + turns;
  char.burning = 0;
}

/**
 * Frost.attachTo: frozen stiff (paralysed) for so long, fire out, chill gone; a frozen hero's random potion
 * shatters and a piece of meat freezes; a thief's stolen potion shatters too. `add` adds to frost already there
 * (Buff.affect), else it lasts at least so long (Buff.prolong).
 */
export function freezeChar(ctx: Ctx, char: Char, turns: number, add = false): void {
  if (frostImmune(char) || cleansed(char) || !isAlive(char)) return;
  const b = buffsOf(char);
  const fresh = !has(b.frost);
  b.frost = add ? (b.frost ?? 0) + turns : Math.max(b.frost ?? 0, turns);
  delete b.chill;
  char.burning = 0;
  char.paralysed = Math.max(char.paralysed ?? 0, b.frost);
  if (!fresh) return;
  if (isHero(char)) {
    const freezable = looseItems(char).filter((item) =>
      (itemDef(item.kind).category === 'potion' && item.kind !== 'potion.strength' && item.kind !== 'potion.mastery') || item.kind === 'food.meat');
    const item = ctx.rng.element(freezable);
    if (!item) return;
    if (--item.qty <= 0) char.items.splice(char.items.indexOf(item), 1);
    if (item.kind === 'food.meat') {
      const stack = char.items.find((i) => i.kind === 'food.carpaccio');
      if (stack) stack.qty++;
      else char.items.push(createItem('food.carpaccio'));
    } else {
      ctx.effects.push({ type: 'frozenPotion', hero: char.id, kind: item.kind });
      shatterPotion(ctx, char, item.kind, char.pos);
    }
  } else if (char.item && itemDef(char.item.kind).category === 'potion') {
    const kind = char.item.kind;
    delete char.item;
    shatterPotion(ctx, null, kind, char.pos);
  } else if (char.item?.kind === 'food.meat') {
    char.item = createItem('food.carpaccio');
  }
}

/**
 * Freezing.freeze: a frozen character stays frozen a little longer; others are chilled (more so in water), and
 * frozen once fully chilled. A heap there freezes too.
 */
export function freezeCell(ctx: Ctx, cell: number): void {
  const char = charAt(ctx.world, ctx.depth, cell);
  if (char && isAlive(char) && !frostImmune(char)) {
    if (has(char.buffs?.frost)) {
      freezeChar(ctx, char, 2, true);
    } else {
      const chill = char.buffs?.chill ?? 0;
      let turns = isWater(ctx.level.map[cell]!) ? 5 : 3;
      if (chill > 0) turns = Math.min(turns, CHILL_TURNS - chill);
      if (turns > 0) chillChar(char, turns);
      if (chill > 0 && chill >= CHILL_TURNS) freezeChar(ctx, char, FROST_TURNS);
    }
  }
  if (ctx.floor.heaps.some((heap) => heap.pos === cell)) freezeHeaps(ctx, cell, 0);
}

/** Freezing.affect (the old way, a snap freeze): frozen for Frost.DURATION, thrice that in water; fire there goes out. */
export function snapFreeze(ctx: Ctx, cell: number): void {
  const char = charAt(ctx.world, ctx.depth, cell);
  if (char && isAlive(char)) freezeChar(ctx, char, isWater(ctx.level.map[char.pos]!) ? FROST_TURNS * 3 : FROST_TURNS);
  clearGasAt(ctx.floor, 'fire', cell);
  if (ctx.floor.heaps.some((heap) => heap.pos === cell)) freezeHeaps(ctx, cell, 0);
}

/* Lasting harm and help */

/** Corrosion.set: lasts at least so long, and hurts at least so much. */
export function addCorrosion(char: Char, turns: number, damage: number): void {
  if (cleansed(char) || !isAlive(char)) return;
  const b = buffsOf(char);
  b.corrosion = { left: Math.max(turns, b.corrosion?.left ?? 0), damage: Math.max(damage, b.corrosion?.damage ?? 1) };
}

/** Healing.setHeal: health back over time; with a vial of blood (applyVialEffect), more of it, a little at a time. */
export function healOverTime(char: Char, amount: number, percent: number, flat: number, vial = false): void {
  const b = buffsOf(char);
  let limit: number | undefined;
  if (vial && isHero(char)) {
    const level = trinketLevel(char, 'trinket.vialOfBlood');
    if (level >= 0) {
      amount = Math.round(amount * VIAL_OF_BLOOD.totalHealMultiplier(level));
      limit = VIAL_OF_BLOOD.maxHealPerTurn(char.ht, level);
    }
  }
  b.healing = {
    left: Math.max(b.healing?.left ?? 0, amount), percent: Math.max(b.healing?.percent ?? 0, percent),
    flat: Math.max(b.healing?.flat ?? 0, flat), ...(limit !== undefined ? { limit } : {}),
  };
}

/** Barrier.setShield: a shield at least this strong. */
export function setShield(char: Char, amount: number): void {
  const b = buffsOf(char);
  if ((b.barrier?.shield ?? 0) <= amount) b.barrier = { shield: amount, partial: 0 };
}

/** ShieldBuff.processDamage: a barrier takes what it can of a blow. */
export function absorbShield(char: Char, damage: number): number {
  const barrier = char.buffs?.barrier;
  if (!barrier || barrier.shield <= 0 || damage <= 0) return damage;
  if (barrier.shield >= damage) {
    barrier.shield -= damage;
    damage = 0;
  } else {
    damage -= barrier.shield;
    barrier.shield = 0;
  }
  if (barrier.shield <= 0) delete char.buffs!.barrier;
  return damage;
}

/** ArcaneArmor.set: kept if it is the stronger over time (sqrt(interval) * level). */
export function setArcaneArmor(char: Char, level: number, interval: number): void {
  const b = buffsOf(char);
  const old = b.arcaneArmor;
  if (!old || Math.sqrt(old.interval) * old.level < Math.sqrt(interval) * level) b.arcaneArmor = { level, interval, next: interval };
}

/** Barkskin.conditionallyAppend: earthen armour this strong, waning a point every `interval` turns. */
export function setBarkskin(char: Char, level: number, interval: number): void {
  const b = buffsOf(char);
  if (!b.barkskin || b.barkskin.level <= level) b.barkskin = { level, interval, next: interval };
}

/** Char.damage from magic (AntiMagic.RESISTS): arcane armour takes up to its level off. */
export function magicDamage(ctx: Ctx, char: Char, damage: number): number {
  const armor = char.buffs?.arcaneArmor?.level ?? 0;
  if (armor > 0) damage = Math.max(0, damage - ctx.rng.normalIntRange(0, armor));
  return damage;
}

/** What a blow does to a character's buffs (Char.damage): a magical sleep ends; dread wears off a little (Dread.recover). */
export function onHurt(char: Char): void {
  const b = char.buffs;
  if (!b) return;
  if (b.magicalSleep) {
    delete b.magicalSleep;
    char.paralysed = 0;
  }
  if (has(b.dread)) {
    b.dread! -= 5;
    if (b.dread! <= 0) delete b.dread;
  }
}

/** ScrollOfChallenge.ChallengeArena: harm taken inside the arena is two thirds (Char.damage). */
export const challengeFactor = (char: Char): number => (has(char.buffs?.challenge?.left) ? 0.67 : 1);

/** Hunger.act: no hunger while well fed or in a challenge arena. */
export const hungerPaused = (hero: Hero): boolean => has(hero.buffs?.wellFed) || has(hero.buffs?.challenge?.left);

/** PotionOfHealing.cure: what a potion of healing (and much else) washes away. */
export function cure(char: Char): void {
  char.poison = 0;
  char.crippled = 0;
  if (isHero(char)) char.weakened = 0;
  char.bleeding = 0;
  char.blind = 0;
  char.slowed = 0;
  char.dizzy = 0;
  if (char.buffs) delete char.buffs.drowsy;
}

/**
 * PotionOfCleansing.cleanse: every harmful thing goes (but being an ally), hunger is staved off, and for a few
 * turns nothing harmful takes hold (Cleanse).
 */
export function cleanse(char: Char, turns = CLEANSE_TURNS): void {
  cure(char);
  char.paralysed = 0;
  char.burning = 0;
  char.rooted = 0;
  if (isHero(char)) {
    char.ooze = -1;
    char.charmed = 0;
    char.charmedBy = null;
    char.deferred = 0;
    // Hunger.satisfy(STARVING).
    char.hunger = 0;
  } else {
    char.terror = 0;
    char.amok = 0;
    char.charmed = 0;
    char.rage = 0;
  }
  const b = buffsOf(char);
  for (const key of ['chill', 'frost', 'corrosion', 'drowsy', 'magicalSleep', 'aggression', 'dread'] as const) delete b[key];
  b.cleanse = Math.max(b.cleanse ?? 0, turns);
}

/* Elixir of might (HTBoost) */

/** ElixirOfMight.HTBoost.boost: so much health, for a hero of this level, while levels are left. */
export function mightBoost(hero: Hero): number {
  const left = hero.buffs?.htBoost ?? 0;
  if (left <= 0) return 0;
  const boost = (ht: number): number => Math.round(4 + ht / 20);
  return Math.round((left * boost(15 + 5 * hero.lvl)) / 5);
}

/** Hero.updateHT: health follows the boost as it changes, health too when it grows (boostHP). */
export function updateMight(hero: Hero): void {
  const b = buffsOf(hero);
  const now = mightBoost(hero);
  const was = b.htBoosted ?? 0;
  if (now === was) return;
  hero.ht += now - was;
  if (now > was) hero.hp += now - was;
  hero.hp = Math.min(hero.hp, hero.ht);
  if (now > 0) b.htBoosted = now;
  else delete b.htBoosted;
}

/** HTBoost.onLevelUp: a level less to go. */
export function mightOnLevelUp(hero: Hero): void {
  const b = hero.buffs;
  if (!b?.htBoost) return;
  b.htBoost--;
  if (b.htBoost <= 0) delete b.htBoost;
  updateMight(hero);
}

/* Time passing */

/** Whole turns that end within a span of time that ends at `now` (as bleeding counts them). */
const turnsIn = (now: number, time: number): number => Math.floor(now) - Math.floor(now - time);

/** A hero's buffs, as `time` passes (it has been added to hero.time already). */
export function tickHero(ctx: Ctx, hero: Hero, time: number): void {
  const b = hero.buffs;
  if (!b) return;
  for (const key of ['haste', 'stamina', 'magicalSight', 'magicImmune', 'foresight', 'recharging', 'artifactRecharge', 'frostImbue',
    'featherFall', 'cleanse', 'chill'] as const) {
    if (b[key] !== undefined) {
      b[key] = b[key]! - time;
      if (b[key]! <= 0) delete b[key];
    }
  }
  if (b.cleanse) cleanseAgain(hero);
  const turns = turnsIn(hero.time, time);
  for (let i = 0; i < turns && isAlive(hero); i++) heroTurn(ctx, hero, b);
  if (b.frost !== undefined) {
    b.frost -= time;
    if (b.frost <= 0) frostEnds(ctx, hero);
  }
}

/** While cleansed, whatever harm has taken hold since is shaken off again. */
function cleanseAgain(char: Char): void {
  const turns = char.buffs!.cleanse!;
  cleanse(char, turns);
}

/** One turn of a hero's buffs. */
function heroTurn(ctx: Ctx, hero: Hero, b: Buffs): void {
  // Healing.act: so much back a turn, at least one, at most what is left (and a vial of blood's limit).
  if (b.healing) {
    let heal = Math.max(1, Math.min(Math.round(b.healing.left * b.healing.percent) + b.healing.flat, b.healing.left));
    if (b.healing.limit !== undefined) heal = Math.min(heal, b.healing.limit);
    if (hero.hp < hero.ht) {
      const amount = Math.min(heal, hero.ht - hero.hp);
      hero.hp += amount;
      ctx.effects.push({ type: 'healed', hero: hero.id, amount });
    }
    b.healing.left -= heal;
    if (b.healing.left <= 0) delete b.healing;
  }
  // Barrier.act: it wanes, the faster the stronger (a twentieth of it a turn, a point at most).
  if (b.barrier) {
    b.barrier.partial += Math.min(1, b.barrier.shield / 20);
    if (b.barrier.partial >= 1) {
      b.barrier.shield--;
      b.barrier.partial = 0;
    }
    if (b.barrier.shield <= 0) delete b.barrier;
  }
  for (const key of ['arcaneArmor', 'barkskin'] as const) {
    const armor = b[key];
    if (armor && --armor.next <= 0) {
      armor.next = armor.interval;
      if (--armor.level <= 0) delete b[key];
    }
  }
  // FireImbue.act: grass underfoot burns to embers.
  if (b.fireImbue !== undefined) {
    if (ctx.level.map[hero.pos] === T.GRASS) {
      ctx.level.map[hero.pos] = T.EMBERS;
      ctx.effects.push({ type: 'burnt', depth: ctx.depth, pos: hero.pos });
    }
    if (--b.fireImbue <= 0) delete b.fireImbue;
  }
  // ToxicImbue.act: a cloud of poison all around, until it is spent (and a few turns of immunity after).
  if (b.toxicImbue !== undefined) {
    if (b.toxicImbue > 0) {
      let center = 6;
      for (const n of NEIGHBOURS8) {
        if (!hasFlag(ctx.level.map[hero.pos + n]!, F.SOLID)) seedGas(ctx, hero.pos + n, 'toxic', 6);
        else center += 6;
      }
      seedGas(ctx, hero.pos, 'toxic', center);
    }
    if (--b.toxicImbue <= -5) delete b.toxicImbue;
  }
  // AquaHealing.act: standing (not floating) in water, a fiftieth of one's health back a turn.
  if (b.aquaHealing !== undefined) {
    if (!has(hero.levitating) && isWater(ctx.level.map[hero.pos]!) && hero.hp < hero.ht) {
      let heal = Math.max(1, Math.min(hero.ht / 50, b.aquaHealing));
      heal = Math.min(heal, hero.ht - hero.hp);
      heal = ctx.rng.float() < heal % 1 ? Math.ceil(heal) : Math.floor(heal);
      hero.hp += heal;
      b.aquaHealing -= heal;
      if (heal > 0) ctx.effects.push({ type: 'healed', hero: hero.id, amount: heal });
    }
    if (b.aquaHealing <= 0) delete b.aquaHealing;
  }
  // WellFed.act: a point of health every eighteen turns.
  if (b.wellFed !== undefined) {
    b.wellFed--;
    if (b.wellFed < 0) delete b.wellFed;
    else if (b.wellFed % 18 === 0 && hero.hp < hero.ht) hero.hp++;
  }
  // Recharging: wands charge a quarter of a charge more a turn (Wand.Charger, CHARGE_BUFF_BONUS).
  if (has(b.recharging)) {
    for (const wand of hero.items) {
      if (wand.charges === undefined || wand.charges >= wandMaxCharges(wand)) continue;
      wand.recharge = (wand.recharge ?? 0) + WAND_RECHARGE / 4;
      while (wand.recharge >= WAND_RECHARGE && wand.charges < wandMaxCharges(wand)) {
        wand.recharge -= WAND_RECHARGE;
        wand.charges++;
      }
    }
  }
  // Foresight: every turn a search reaching far around, that finds whatever is hidden there (Hero.search).
  if (has(b.foresight)) foresee(ctx, hero);
  // Corrosion.act and Ooze.act.
  if (b.corrosion) corrode(ctx, hero, b);
  if (b.ooze !== undefined && isAlive(hero)) oozeTurn(ctx, hero, b);
  // Drowsy, then MagicalSleep: asleep until fully healed (a point a turn) or struck.
  if (b.drowsy !== undefined && --b.drowsy <= 0) {
    delete b.drowsy;
    if (hero.hp < hero.ht && !isMagicImmune(hero)) b.magicalSleep = true;
  }
  if (b.magicalSleep) {
    hero.paralysed = Math.max(hero.paralysed, 1);
    hero.hp = Math.min(hero.hp + 1, hero.ht);
    if (hero.hp >= hero.ht) {
      delete b.magicalSleep;
      hero.paralysed = 0;
    }
  }
  // ChallengeArena.act: it ends once the hero leaves the arena, or after its hundred turns.
  if (b.challenge) {
    if (!b.challenge.cells.includes(hero.pos) || --b.challenge.left <= 0) {
      delete b.challenge;
      ctx.effects.push({ type: 'arenaGone', hero: hero.id });
    }
  }
  if (b.prismaticGuard !== undefined) prismaticGuard(ctx, hero);
  if (b.censer !== undefined || trinketLevel(hero, 'trinket.chaoticCenser') >= 0) censerTurn(ctx, hero);
}

/** Corrosion.act: it hurts, and the next turn a point more (half a point, once strong), until it ends. */
function corrode(ctx: Ctx, char: Char, b: Buffs): void {
  const corrosion = b.corrosion!;
  const damage = Math.trunc(corrosion.damage);
  if (damage > 0) {
    ctx.effects.push({ type: 'hurt', depth: ctx.depth, who: char.id, damage });
    hurt(ctx, char, damage, 'corrosion');
  }
  corrosion.damage += corrosion.damage < Math.trunc(ctx.depth / 2) + 2 ? 1 : 0.5;
  if (--corrosion.left <= 0 && char.buffs) delete char.buffs.corrosion;
}

/**
 * Ooze.act: water washes it off (once it has burned at all); otherwise it hurts by the depth (half a point a turn
 * in the sewers, one at Goo's, more below) for its twenty turns.
 */
function oozeTurn(ctx: Ctx, char: Char, b: Buffs): void {
  const inWater = isWater(ctx.level.map[char.pos]!) && !flies(char);
  const left = b.ooze!;
  if (left < OOZE_TURNS && inWater) {
    delete b.ooze;
    return;
  }
  const depth = ctx.depth;
  const damage = depth > 5 ? 1 + Math.trunc(depth / 5) : depth === 5 ? 1 : Math.trunc(left) % 2 === 0 ? 1 : 0;
  if (damage > 0) {
    ctx.effects.push({ type: 'hurt', depth, who: char.id, damage });
    hurt(ctx, char, damage, 'ooze');
  }
  b.ooze = left - 1;
  if (b.ooze <= 0 || inWater) delete b.ooze;
}

/** Frost.detach: thawing out in water, one is left chilled a while. */
function frostEnds(ctx: Ctx, char: Char): void {
  delete char.buffs!.frost;
  if (isWater(ctx.level.map[char.pos]!)) chillChar(char, CHILL_TURNS / 2);
}

/**
 * Hero.search with foresight: everything within its reach is mapped, and whatever is hidden there is found, the
 * hero's own cell first scanned once.
 */
function foresee(ctx: Ctx, hero: Hero): void {
  const explored = exploredCells(ctx.world, hero.depth);
  for (const cell of circleCells(hero.pos, FORESIGHT_DISTANCE)) {
    if (cell === hero.pos) continue;
    explored[cell] = true;
    if (hasFlag(ctx.level.map[cell]!, F.SECRET)) {
      ctx.level.map[cell] = discover(ctx.level.map[cell]!);
      ctx.effects.push({ type: 'discovered', depth: ctx.depth, cell });
    }
  }
}

/** A monster's buffs, on its own turn; true if it loses the turn (frozen or asleep by magic). */
export function tickMob(ctx: Ctx, mob: Mob): boolean {
  const b = mob.buffs;
  if (!b) return false;
  for (const key of ['chill', 'aggression', 'frostImbue', 'cleanse', 'haste', 'stamina', 'magicImmune'] as const) {
    if (b[key] !== undefined && --b[key]! <= 0) delete b[key];
  }
  if (b.cleanse) cleanseAgain(mob);
  if (b.corrosion) {
    corrode(ctx, mob, b);
    if (!isAlive(mob)) return true;
  }
  if (b.ooze !== undefined) {
    oozeTurn(ctx, mob, b);
    if (!isAlive(mob)) return true;
  }
  if (b.frost !== undefined && --b.frost <= 0) frostEnds(ctx, mob);
  // Dread.act: out of every hero's sight and six cells away, it is gone for good; else it wears off.
  if (b.dread !== undefined) {
    const heroes = ctx.world.heroes.filter((h) => h.depth === ctx.depth && isAlive(h));
    const gone = heroes.length > 0 && heroes.every((h) => !heroView(ctx.world, h)[mob.pos] && distance(mob.pos, h.pos) >= 6);
    if (gone) {
      vanish(ctx, mob);
      return true;
    }
    if (--b.dread <= 0) {
      delete b.dread;
      delete b.dreadOf;
    }
  }
  if (b.drowsy !== undefined && --b.drowsy <= 0) {
    delete b.drowsy;
    if (!isMagicImmune(mob)) {
      b.magicalSleep = true;
      mob.state = 'sleeping';
    }
  }
  // MagicalSleep.act: an awake monster has shaken it off.
  if (b.magicalSleep) {
    if (mob.state !== 'sleeping' && !mob.ally) {
      delete b.magicalSleep;
      return false;
    }
    if (mob.ally) {
      mob.hp = Math.min(mob.hp + 1, mob.ht);
      if (mob.hp >= mob.ht) delete b.magicalSleep;
    }
    return true;
  }
  return false;
}

/** Char.destroy: a monster gone from the level without dying (it drops and teaches nothing). */
export function vanish(ctx: Ctx, mob: Mob): void {
  const index = ctx.floor.mobs.indexOf(mob);
  if (index < 0) return;
  ctx.floor.mobs.splice(index, 1);
  mob.hp = 0;
  ctx.effects.push({ type: 'faded', depth: ctx.depth, mob: mob.id, pos: mob.pos });
  if (ctx.level.map[mob.pos] === T.OPEN_DOOR && !charAt(ctx.world, ctx.depth, mob.pos)) ctx.level.map[mob.pos] = T.DOOR;
}

/** MagicalSleep on a monster (a stone of deep sleep): asleep, and it will not wake by itself. */
export function deepSleep(mob: Mob): void {
  if (isMagicImmune(mob) || cleansed(mob)) return;
  buffsOf(mob).magicalSleep = true;
  mob.state = 'sleeping';
}

/** Which monster kinds cannot be charmed, frightened or put to sleep by magic, being bosses (Char.Property.BOSS). */
export const isBoss = (mob: Mob): boolean => ['goo', 'tengu', 'dm300', 'king', 'yog'].includes(mob.kind);
/** Char.Property.MINIBOSS among the dungeon's people and guardians. */
export const isMiniboss = (mob: Mob): boolean => ['fetidRat', 'curse', 'statue', 'rottingFist', 'burningFist'].includes(mob.kind);
/** Flying creatures (Char.flying). */
export const flies = (char: Char): boolean => (isHero(char) ? has(char.levitating) : MOBS[char.kind].flying === true);

export type { ItemKind };
export const LEVEL_LENGTH = LENGTH;
