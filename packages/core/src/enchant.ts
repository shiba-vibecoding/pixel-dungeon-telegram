import {
  baseKind, beckon, createMob, enchantLevel, type Hero, heroAttackDelay, heroDefenseSkill, isAlive, isShopkeeper, isStarving, type Mob, type MobKind,
  MOBS, mobStats, rollMob, STARVING,
} from './actors';
import { conjureImages } from './allies';
import { hurt } from './combat';
import { isEnemy as enemyMob } from './hero';
import { beyond, geyser, MAGIC_BOLT, STOP_TARGET, teleportChar, throwChar, trajectory } from './displace';
import { castShadow, terrainBlocksSight, viewDistance } from './fov';
import { type Char, charAt, type Ctx, enterCell, heroesOn, heroView, isHero, isPassable, isWater } from './floor';
import { type Enchantment, type Item, itemDef, ItemGenerator } from './items';
import { durabilityPerUse, isDart, isMissile } from './missiles';
import { plant, SEED_PLANTS, stepOnPlant } from './plants';
import { seedGas } from './gas';
import { gearLevel } from './weapons';
import { cellX, cellY, distance, LENGTH, NEIGHBOURS8, NEIGHBOURS9 } from './level/geometry';
import { F, hasFlag, T } from './level/terrain';
import { burst, immuneTo } from './traps';
import { chill } from './status';
import { enchantPowerMultiplier } from './rings';
import { freezing } from './cursed';
import { explodeBomb } from './inventory';

/*
 * Enchanted weapons and inscribed armour, as Shattered Pixel Dungeon has them
 * (Weapon.Enchantment, Armor.Glyph, and their curses): an enchantment acts on
 * the hero's blows, a glyph on the blows the hero takes; most of them the
 * more often, the higher the item's level. A few act elsewhere: projecting
 * reaches further (actors.ts heroReach, throwing.ts), obfuscation, swiftness,
 * flow and bulk change stealth and speed (actors.ts), brimstone keeps fire
 * off, camouflage hides in tall grass, anti-magic softens magic (gearHurt).
 */

/** Terror.DURATION; Burning.DURATION; Charm.DURATION; Blindness.DURATION; Frost.DURATION. */
export const TERROR_TURNS = 10;
const BURNING_TURNS = 8;
const CHARM_TURNS = 10;
const BLIND_TURNS = 10;
const FROST_TURNS = 10;
/** Ooze.DURATION; Adrenaline.DURATION. */
const OOZE_TURNS = 20;
export const ADRENALINE_TURNS = 10;

/**
 * Enchantment.genericProcChanceMultiplier and Glyph's: a hero's rings of arcana (RingOfArcana.enchantPowerMultiplier);
 * 1 for the rest. Seam: a berserker's rage, the runic blade's slash, smite, the elemental strike, the spirit blades and
 * striking wave talents (classes, talents, abilities) would raise it.
 */
export const procMultiplier = (char: Char): number => (isHero(char) ? enchantPowerMultiplier(char) : 1);

/* Who is who (Char.Property; a seam for the mobs stream's own) */

const BOSSES: ReadonlySet<MobKind> = new Set(['goo', 'tengu', 'dm300', 'king', 'yog']);
const MINIBOSSES: ReadonlySet<MobKind> = new Set(['fetidRat', 'curse']);
const INORGANIC: ReadonlySet<MobKind> = new Set(['dm300', 'golem', 'statue', 'wraith', 'curse']);
const UNDEAD: ReadonlySet<MobKind> = new Set(['skeleton', 'wraith', 'undead', 'king']);
const DEMONIC: ReadonlySet<MobKind> = new Set(['succubus', 'eye', 'scorpio', 'yog', 'larva', 'rottingFist', 'burningFist']);
/** Those who know no fear (Terror among their immunities), and those no magic drives amok. */
const FEARLESS: ReadonlySet<MobKind> = new Set(['yog', 'rottingFist', 'burningFist', 'golem', 'monk', 'brute', 'eye', 'curse', 'wraith']);
const UNSHAKEABLE: ReadonlySet<MobKind> = new Set(['yog', 'golem', 'monk']);
export const fearless = (mob: Mob): boolean => FEARLESS.has(baseKind(mob.kind));
export const unshakeable = (mob: Mob): boolean => UNSHAKEABLE.has(baseKind(mob.kind));
export const isBoss = (mob: Mob): boolean => BOSSES.has(mob.kind);
export const isUndead = (mob: Mob): boolean => UNDEAD.has(baseKind(mob.kind));
export const isDemonic = (mob: Mob): boolean => DEMONIC.has(baseKind(mob.kind));
/** Bleeding among the immunities (Char.Property.INORGANIC). */
export const bleedImmune = (mob: Mob): boolean => INORGANIC.has(mob.kind);
/** AllyBuff among the immunities: bosses and minibosses are never corrupted. */
const corruptImmune = (mob: Mob): boolean => BOSSES.has(mob.kind) || MINIBOSSES.has(mob.kind) || mob.kind === 'mimic' || mob.kind === 'statue';

/** Who fights alongside the heroes (Char.Alignment.ALLY): mirror images, golden bees, wards, the guardian, the corrupted. */
export const isAlly = (char: Char): boolean => isHero(char) || char.ally === true || char.kind === 'mirror' || char.kind === 'bee';
/** Who fights the heroes (Char.Alignment.ENEMY): any monster not passive, and not an ally. */
export const isEnemy = (char: Char): boolean => !isHero(char) && enemyMob(char);

/** A monster's field of view (Char.fieldOfView). */
const mobView = (ctx: Ctx, mob: Mob): boolean[] =>
  castShadow(mob.pos, terrainBlocksSight(ctx.level.map), viewDistance(ctx.depth));

/** Poison.set(n) hurts n/3+1 a turn, less and less; here poison hurts 1 a turn, for as many turns as that adds up to. */
function poisonTurns(duration: number): number {
  let total = 0;
  for (let left = Math.round(duration); left > 0; left--) total += Math.trunc(left / 3) + 1;
  return total;
}

/** What the trackers of a blow are left holding for when its damage is dealt (Char.damage; see combat.ts). */
export interface Blow {
  /** Grim.GrimTracker.maxChance. */
  grim?: number;
  /** Kinetic.KineticTracker.conservedDamage (a kinetic weapon struck). */
  kinetic?: number;
  /** Vorpal.VorpalTracker.powerMulti. */
  vorpal?: number;
  /** Corrupting.CorruptingTracker.powerMulti. */
  corrupting?: number;
  /** Viscosity.ViscosityTracker.level (the hero's armour took the blow). */
  viscosity?: number;
}

const shown = (ctx: Ctx, pos: number, enchant: Enchantment): void => {
  ctx.effects.push({ type: 'enchanted', depth: ctx.depth, pos, enchant });
};

const strike = (ctx: Ctx, victim: Char, amount: number, by: Char | 'magic' | 'bomb'): void => {
  if (amount <= 0 || !isAlive(victim)) return;
  ctx.effects.push({ type: 'hurt', depth: ctx.depth, who: victim.id, damage: amount });
  hurt(ctx, victim, amount, by);
};

/** Shocking.arc: everyone within reach of the struck (two cells, through open ground) and on from each of them, never the attacker. */
function arc(ctx: Ctx, attacker: Char, from: Char, dist: number, affected: Char[]): void {
  const { level, world, depth } = ctx;
  const reach = new Map<number, number>([[from.pos, 0]]);
  const queue = [from.pos];
  for (let head = 0; head < queue.length; head++) {
    const cell = queue[head]!;
    const d = reach.get(cell)!;
    if (d >= dist) continue;
    for (const n of NEIGHBOURS8) {
      const next = cell + n;
      if (next < 0 || next >= LENGTH || reach.has(next) || hasFlag(level.map[next]!, F.SOLID) || distance(cell, next) !== 1) continue;
      reach.set(next, d + 1);
      queue.push(next);
    }
  }
  const hit: Char[] = [];
  for (const cell of reach.keys()) {
    const char = charAt(world, depth, cell);
    if (char && char !== attacker && !affected.includes(char)) hit.push(char);
  }
  affected.push(...hit);
  for (const char of hit) {
    ctx.effects.push({ type: 'zapped', depth, from: from.pos, to: char.pos, bolt: 'lightning' });
    const flying = !isHero(char) && MOBS[char.kind].flying === true;
    arc(ctx, attacker, char, isWater(level.map[char.pos]!) && !flying ? 2 : 1, affected);
  }
}

/** Blooming.plantGrass: tall grass springs up on open ground or grass where nothing grows. */
function plantGrass(ctx: Ctx, cell: number): boolean {
  const terrain = ctx.level.map[cell];
  const open = terrain === T.EMPTY || terrain === T.EMPTY_DECO || terrain === T.EMBERS || terrain === T.GRASS;
  if (!open || ctx.floor.plants?.some((p) => p.pos === cell)) return false;
  ctx.level.map[cell] = T.HIGH_GRASS;
  return true;
}

/** Explosive.proc's bomb: the closest open cell next to the struck, as seen from the attacker. */
function explosiveCurse(ctx: Ctx, hero: Hero, mob: Char, weapon: Item): void {
  const before = weapon.explosive ?? 100;
  const after = before - Math.round(ctx.rng.intRange(0, 10) * procMultiplier(hero));
  weapon.explosive = after;
  if (before > 50 && after <= 50) ctx.effects.push({ type: 'explosive', hero: hero.id, item: weapon, state: 'warm' });
  else if (before > 10 && after <= 10) ctx.effects.push({ type: 'explosive', hero: hero.id, item: weapon, state: 'hot' });
  else if (after <= 0) {
    let pos = -1;
    const trueDistance = (a: number, b: number): number => Math.hypot(cellX(a) - cellX(b), cellY(a) - cellY(b));
    for (const n of NEIGHBOURS8) {
      const cell = mob.pos + n;
      if (hasFlag(ctx.level.map[cell]!, F.SOLID)) continue;
      if (pos === -1 || trueDistance(hero.pos, cell) < trueDistance(hero.pos, pos)) pos = cell;
    }
    weapon.explosive = after + 100;
    // The explosion damages thrown weapons (MissileWeapon.damage: they cannot break of it).
    if (isMissile(weapon.kind)) weapon.durability = Math.max(1, (weapon.durability ?? 100) - 9 * durabilityPerUse(weapon));
    explodeBomb(ctx, pos === -1 ? mob.pos : pos, null);
  }
  if (weapon.explosive !== undefined && weapon.explosive >= 100) delete weapon.explosive;
}

/** Corruption.corruptionHeal and the CorruptingTracker: what was slain rises again, whole, fighting for the hero. */
export function corruptSlain(ctx: Ctx, slain: Mob, power: number): void {
  const { world, depth, level, floor } = ctx;
  if (charAt(world, depth, slain.pos) || !isPassable(level, slain.pos)) return;
  // Multiplicity.duplicate, then Buff.affect(Corruption): an ally of the heroes (allies.ts, ai.ts allyAct) as the wand's are.
  const ally = createMob(`#${++world.nextId}`, slain.kind, slain.pos, 'wandering', floor.now + 1);
  if (slain.level !== undefined) ally.level = slain.level;
  ally.ht = ally.hp = slain.ht;
  ally.ally = true;
  ally.corrupted = true;
  if (power > 1.1) ally.adrenaline = Math.round(5 * (power - 1));
  floor.mobs.push(ally);
  enterCell(level, ally.pos);
  ctx.effects.push({ type: 'corrupted', depth, mob: ally.id, pos: ally.pos });
  ctx.effects.push({ type: 'ally', depth, mob: ally.id, event: 'corrupted' });
}

/**
 * Weapon.proc, as to the weapon's magic: what the enchantment (or the curse) does as the blow lands, after the armour
 * (Char.attackProc); returns the damage that goes through. `weapon` is the weapon in hand, the thrown one, or the
 * spirit bow for its arrow. A dart thrown with a crossbow in hand carries the crossbow's enchantment first.
 */
export function weaponProc(ctx: Ctx, hero: Hero, mob: Mob, damage: number, weapon: Item | null, blow: Blow): number {
  if (!weapon) return damage;
  if (isMissile(weapon.kind) && hero.weapon?.kind === 'weapon.crossbow' && isDart(weapon.kind) && hero.weapon.enchant) {
    damage = enchantProc(ctx, hero, mob, damage, hero.weapon, hero.weapon.enchant, blow);
  }
  if (!weapon.enchant || !isAlive(mob)) return damage;
  return enchantProc(ctx, hero, mob, damage, weapon, weapon.enchant, blow);
}

/** Unstable's choice of enchantments (all with an effect on a hit). */
const UNSTABLE: readonly Enchantment[] = [
  'blazing', 'blocking', 'blooming', 'chilling', 'kinetic', 'corrupting', 'elastic', 'grim', 'lucky', 'shocking', 'vampiric', 'venomous', 'vorpal',
  'eldritch',
];

function enchantProc(ctx: Ctx, hero: Hero, mob: Mob, damage: number, weapon: Item, enchant: Enchantment, blow: Blow): number {
  const { rng, depth, level: map } = ctx;
  const level = Math.max(0, enchantLevel(hero, weapon));
  const multi = procMultiplier(hero);
  const chance = (p: number): { hit: boolean; power: number } => {
    const procChance = p * multi;
    return { hit: rng.float() < procChance, power: Math.max(1, procChance) };
  };

  switch (enchant) {
    case 'blazing': {
      // Blazing: 33% at +0, 50% at +1, 60% at +2; it sets the foe alight, or burns it more if it burns already.
      const { hit, power } = chance((level + 1) / (level + 3));
      if (!hit) return damage;
      let powerMulti = power;
      if ((mob.burning ?? 0) <= 0) {
        if (!isWater(map.map[mob.pos]!) && !immuneTo(mob, 'burning') && mob.kind !== 'elemental') mob.burning = BURNING_TURNS;
        powerMulti -= 1;
      }
      if (powerMulti > 0) {
        const burn = Math.round(rng.normalIntRange(1, 3 + Math.trunc(depth / 4)) * 0.67 * powerMulti);
        if (!immuneTo(mob, 'burning') && mob.kind !== 'elemental') strike(ctx, mob, burn, 'magic');
      }
      shown(ctx, mob.pos, enchant);
      return damage;
    }
    case 'chilling': {
      // Chilling: 25%, 40%, 50%; three turns of chill a hit, six at most.
      const { hit, power } = chance((level + 1) / (level + 4));
      if (!hit) return damage;
      let add = 3 * power;
      if ((mob.chill ?? 0) > 0) add = Math.min(add, 6 * power - mob.chill!);
      if (add > 0) chill(mob, add);
      shown(ctx, mob.pos, enchant);
      return damage;
    }
    case 'kinetic': {
      // Kinetic: what a blow overkilled is kept, and added to the next.
      const conserved = Math.ceil(hero.kinetic ?? 0);
      blow.kinetic = conserved;
      if (conserved > 0) shown(ctx, mob.pos, enchant);
      return damage + conserved;
    }
    case 'shocking': {
      // Shocking: a third of the time, lightning arcs from the foe to all around, for half the blow.
      const { hit, power } = chance(1 / 3);
      if (!hit) return damage;
      const affected: Char[] = [];
      arc(ctx, hero, mob, 2, affected);
      for (const char of affected) {
        if (char !== mob && isEnemy(char)) strike(ctx, char, Math.round(damage * 0.5 * power), 'magic');
      }
      shown(ctx, mob.pos, enchant);
      return damage;
    }
    case 'venomous': {
      // Venomous: a third of the time, poison, more the higher the level.
      const { hit, power } = chance(1 / 3);
      if (!hit || bleedImmune(mob)) return damage;
      mob.poison = (mob.poison ?? 0) + poisonTurns(power * (level / 2 + 3));
      shown(ctx, mob.pos, enchant);
      return damage;
    }
    case 'blocking': {
      // Blocking: 10% at +0; a shield of 2 and a level, for five turns.
      const { hit, power } = chance((level + 4) / (level + 40));
      if (!hit) return damage;
      const shield = Math.round(power * (2 + level));
      if ((hero.blocking?.shield ?? 0) <= shield) hero.blocking = { shield, left: 5 };
      else hero.blocking!.left = 5;
      ctx.effects.push({ type: 'shielded', hero: hero.id, amount: shield });
      return damage;
    }
    case 'blooming': {
      // Blooming: 33%, 50%, 60%; tall grass springs up under the foe and around.
      const { hit, power } = chance((level + 1) / (level + 3));
      if (!hit) return damage;
      let plants = Math.fround((1.5 + 0.1 * level) * power);
      plants = rng.float() < plants % 1 ? Math.ceil(plants) : Math.floor(plants);
      const grown: number[] = [];
      if (plantGrass(ctx, mob.pos)) {
        grown.push(mob.pos);
        plants--;
      }
      if (plants > 0) {
        const cells = NEIGHBOURS8.map((n) => mob.pos + n).filter((c) => c !== hero.pos);
        rng.shuffle(cells);
        if (distance(hero.pos, mob.pos) === 1) cells.push(hero.pos);
        for (const cell of cells) {
          if (plants <= 0) break;
          if (plantGrass(ctx, cell)) {
            grown.push(cell);
            plants--;
          }
        }
      }
      if (grown.length > 0) ctx.effects.push({ type: 'bloomed', depth, cells: grown });
      return damage;
    }
    case 'eldritch': {
      // Eldritch: 25%, 40%, 50%; every other foe that sees the blow flees in terror.
      const { hit, power } = chance((level + 1) / (level + 4));
      if (!hit) return damage;
      for (const other of ctx.floor.mobs) {
        if (other === mob || !isEnemy(other) || fearless(other)) continue;
        const fov = mobView(ctx, other);
        if (!fov[hero.pos] && !fov[mob.pos]) continue;
        other.terror = Math.max(other.terror ?? 0, Math.round(power * 5));
        other.terrorOf = hero.id;
      }
      shown(ctx, mob.pos, enchant);
      return damage;
    }
    case 'elastic': {
      // Elastic: 20%, 33%, 43%; the foe is knocked two cells back.
      const { hit, power } = chance((level + 1) / (level + 5));
      if (!hit) return damage;
      throwChar(ctx, mob, beyond(ctx, hero.pos, mob.pos), Math.round(2 * power));
      shown(ctx, mob.pos, enchant);
      return damage;
    }
    case 'lucky': {
      // Lucky: 10% at +0; should the foe die of it, it drops something (Mob.die: LuckProc).
      const { hit, power } = chance((level + 4) / (level + 40));
      if (hit) {
        mob.luck = -10 + Math.round(5 * power);
        shown(ctx, mob.pos, enchant);
      } else {
        delete mob.luck;
      }
      return damage;
    }
    case 'projecting':
      // Projecting: no effect on a hit; it reaches further (heroReach, throwing.ts).
      return damage;
    case 'unstable': {
      // Unstable: some other enchantment every blow, carrying what a kinetic one kept.
      const conserved = Math.ceil(hero.kinetic ?? 0);
      delete hero.kinetic;
      return enchantProc(ctx, hero, mob, damage, weapon, rng.oneOf(UNSTABLE), blow) + conserved;
    }
    case 'vorpal': {
      // Vorpal: a quarter of the time, the blow turns into bleeding (Char.damage).
      if (bleedImmune(mob)) return damage;
      const { hit, power } = chance(1 / 4);
      if (hit) blow.vorpal = power;
      return damage;
    }
    case 'corrupting': {
      // Corrupting: 25% at +0; should the foe die of the blow, it rises again on the hero's side.
      const { hit, power } = chance((level + 5) / (level + 20));
      if (hit && !corruptImmune(mob) && !mob.corrupted && isAlive(mob)) blow.corrupting = power;
      return damage;
    }
    case 'crystal': {
      // Crystal: a third more as magic damage; it wears with use (and mends with time, see gearTick), unless thrown.
      if (!isMissile(weapon.kind)) {
        const avgUses = itemDef(weapon.kind).category === 'weapon' ? 50 - Math.min(20, (20 * gearLevel(weapon)) / 6) : 50;
        const before = weapon.crystal ?? 100;
        // Random.NormalFloat(0.5, 1.5) / avgUses, by the weapon's delay; it cannot go from flawed to shattered at once.
        let after = before - ((0.5 + (rng.float() + rng.float()) / 2) / avgUses) * heroAttackDelay(hero, weapon);
        if (before > 10 && after <= 10) after = Math.max(after, 1);
        weapon.crystal = after;
        crystalState(ctx, hero, weapon, before);
      }
      strike(ctx, mob, Math.ceil(damage * 0.33 * multi), 'magic');
      return damage;
    }
    case 'grim': {
      // Grim: the lower the foe's health after the blow, the likelier it dies outright (0-50%, 5% more a level).
      if (mob.kind === 'yog') return damage;
      blow.grim = (0.5 + 0.05 * level) * multi;
      return damage;
    }
    case 'vampiric': {
      // Vampiric: 5% to 30% by the health the hero is missing; half the blow heals the hero.
      const missing = (hero.ht - hero.hp) / hero.ht;
      const { hit, power } = chance(0.05 + 0.25 * missing);
      if (!hit || (!isEnemy(mob) && mob.kind !== 'mimic')) return damage;
      const heal = Math.min(Math.round(damage * 0.5 * power), hero.ht - hero.hp);
      if (heal > 0 && isAlive(hero)) {
        hero.hp += heal;
        ctx.effects.push({ type: 'healed', hero: hero.id, amount: heal });
        shown(ctx, mob.pos, enchant);
      }
      return damage;
    }

    // The curses
    case 'annoying': {
      // Annoying: one blow in twenty, it screams, and the whole level comes running.
      if (!chance(1 / 20).hit) return damage;
      for (const other of ctx.floor.mobs) beckon(other, hero.pos);
      hero.invisible = 0;
      ctx.effects.push({ type: 'annoying', hero: hero.id, line: rng.int(33) !== 0 ? rng.intRange(1, 10) : rng.intRange(11, 13) });
      return damage;
    }
    case 'displacing':
      // Displacing: one blow in twelve teleports the foe away.
      if (chance(1 / 12).hit) teleportChar(ctx, mob);
      return damage;
    case 'dazzling':
      // Dazzling: one blow in ten blinds everyone who sees the foe, the wielder longest.
      if (!chance(1 / 10).hit) return damage;
      for (const other of heroesOn(ctx.world, depth)) {
        if (heroView(ctx.world, other)[mob.pos]) other.blind = Math.max(other.blind ?? 0, other === hero ? BLIND_TURNS : BLIND_TURNS / 2);
      }
      for (const other of ctx.floor.mobs) {
        if (other.state !== 'passive' && mobView(ctx, other)[mob.pos]) other.blind = Math.max(other.blind ?? 0, BLIND_TURNS / 2);
      }
      ctx.effects.push({ type: 'dazzled', depth, pos: mob.pos });
      return damage;
    case 'explosive':
      explosiveCurse(ctx, hero, mob, weapon);
      return damage;
    case 'friendly': {
      // Friendly: charmed by the foe, the wielder strikes for nothing; one blow in ten charms them both.
      if (hero.charmed > 0 && hero.charmedBy === mob.id) damage = 0;
      if (chance(1 / 10).hit) {
        hero.charmed = Math.max(hero.charmed, CHARM_TURNS);
        hero.charmedBy = mob.id;
        mob.charmed = Math.max(mob.charmed ?? 0, CHARM_TURNS / 2);
        mob.charmedBy = hero.id;
        mob.charmIgnoreNext = true;
        ctx.effects.push({ type: 'charmed', hero: hero.id });
      }
      return damage;
    }
    case 'polarized':
      // Polarized: half the blows strike half as hard again, the others not at all.
      return chance(1 / 2).hit ? Math.round(1.5 * damage) : 0;
    case 'pressurized': {
      // Pressurized: one blow in eight, a geyser bursts under the foe, a melee blow knocking it straight back.
      if (!chance(1 / 8).hit) return damage;
      let towards = -1;
      if (itemDef(weapon.kind).category === 'weapon') {
        const aim = trajectory(ctx, hero.pos, mob.pos, STOP_TARGET);
        if (aim.path.length > aim.dist + 1) towards = aim.path[aim.dist + 1]!;
      }
      geyser(ctx, mob.pos, towards);
      return damage;
    }
    case 'sacrificial': {
      // Sacrificial: one blow in ten may make the wielder bleed, the more the healthier they are.
      if (!chance(1 / 10).hit) return damage;
      const share = hero.hp / hero.ht;
      const bleed = (share * share * hero.ht) / 8;
      if (rng.float() < bleed) hero.bleeding = Math.max(hero.bleeding ?? 0, Math.round(Math.max(1, bleed)));
      return damage;
    }
    case 'wayward':
      // Wayward: a quarter of the time its aim goes astray (a fifth of the accuracy) until the next blow.
      if ((hero.wayward ?? 0) > 0) hero.wayward = 0;
      else if (chance(1 / 4).hit) hero.wayward = 10;
      return damage;
    case 'wondrous':
      // Wondrous: one blow in eight, a cursed wand's random effect (CursedWand.randomValidEffect). Seam: the wands
      // stream's cursed wand effects; until they come, only the burst of colour.
      if (chance(1 / 8).hit) ctx.effects.push({ type: 'wondrous', depth, pos: mob.pos });
      return damage;
  }
}

/** Crystal's alerts as its wear crosses a half, a tenth, nothing: flawed, cracked, shattered (and gone). */
function crystalState(ctx: Ctx, hero: Hero, weapon: Item, before: number): void {
  const after = weapon.crystal ?? 100;
  if (before > 50 && after <= 50) ctx.effects.push({ type: 'crystal', hero: hero.id, item: weapon, state: 'flawed' });
  else if (before > 10 && after <= 10) ctx.effects.push({ type: 'crystal', hero: hero.id, item: weapon, state: 'cracked' });
  else if (after <= 0) {
    ctx.effects.push({ type: 'crystal', hero: hero.id, item: weapon, state: 'shattered' });
    if (hero.weapon === weapon) hero.weapon = null;
    else hero.items = hero.items.filter((item) => item !== weapon);
  }
}

/**
 * Armor.proc: what the hero's glyph (or its curse) does when a blow lands, before the armour soaks it
 * (Char.defenseProc); returns the damage that gets through to the armour.
 */
export function armorProc(ctx: Ctx, attacker: Mob, hero: Hero, damage: number, blow: Blow): number {
  const glyph = hero.armor.glyph;
  if (!glyph) return damage;
  const { rng, depth, world } = ctx;
  const level = Math.max(0, gearLevel(hero.armor));
  const multi = procMultiplier(hero);
  const chance = (p: number): { hit: boolean; power: number } => {
    const procChance = p * multi;
    return { hit: rng.float() < procChance, power: Math.max(1, procChance) };
  };
  const shown = (): void => {
    ctx.effects.push({ type: 'glyph', depth, hero: hero.id, glyph });
  };
  const near = distance(attacker.pos, hero.pos) === 1;

  switch (glyph) {
    case 'obfuscation':
    case 'swiftness':
    case 'flow':
    case 'brimstone':
    case 'camouflage':
    case 'antiMagic':
    case 'bulk':
      // No effect on a hit: they act on stealth, speed, fire, grass and magic (actors.ts, gearHurt).
      return damage;
    case 'viscosity':
      // Viscosity: some of what gets past the armour is put off, to be taken a little at a time (Char.attack).
      blow.viscosity = level;
      return damage;
    case 'potential': {
      // Potential: 17%, 29%, 38%; every wand in the pack gains a charge.
      const { hit } = chance((level + 1) / (level + 6));
      if (!hit) return damage;
      let wands = 0;
      for (const item of hero.items) {
        if (item.charges === undefined) continue;
        wands++;
        item.charges++;
      }
      if (wands > 0) shown();
      return damage;
    }
    case 'stone': {
      // Stone: never dodged, but a dodge's worth of every blow (three quarters of it) is soaked as damage.
      const accuracy = mobStats(attacker).attack;
      const evasion = Math.fround(stoneEvasion(hero) * multi);
      let hitChance = evasion >= accuracy ? accuracy / evasion / 2 : 1 - evasion / accuracy / 2;
      hitChance = Math.min(1, Math.max(0.25, (1 + 3 * hitChance) / 4));
      return Math.ceil(damage * hitChance);
    }
    case 'entanglement': {
      // Entanglement: a quarter of the time, earthroot's bark (5 and 2 a level) takes the blows while the hero stays put.
      const { hit, power } = chance(1 / 4);
      if (!hit) return damage;
      const bark = Math.round((5 + 2 * level) * power);
      hero.earthroot = { pos: hero.pos, level: Math.max(hero.earthroot?.pos === hero.pos ? hero.earthroot.level : 0, bark) };
      shown();
      return damage;
    }
    case 'repulsion': {
      // Repulsion: 20%, 33%, 43%; an attacker beside the hero is knocked two cells away.
      const { hit, power } = chance((level + 1) / (level + 5));
      if (!near || !hit) return damage;
      throwChar(ctx, attacker, trajectory(ctx, attacker.pos, attacker.pos + (attacker.pos - hero.pos), MAGIC_BOLT), Math.round(2 * power));
      shown();
      return damage;
    }
    case 'affection': {
      // Affection: 15%, 19%, 23%; the attacker is charmed by the hero.
      const { hit, power } = chance((level + 3) / (level + 20));
      if (!hit) return damage;
      attacker.charmed = Math.max(attacker.charmed ?? 0, Math.round(CHARM_TURNS * power));
      attacker.charmedBy = hero.id;
      shown();
      return damage;
    }
    case 'thorns': {
      // Thorns: 17%, 23%, 29%; the attacker bleeds (4 and a level).
      const { hit, power } = chance((level + 2) / (level + 12));
      if (!hit || bleedImmune(attacker)) return damage;
      attacker.bleeding = Math.max(attacker.bleeding ?? 0, Math.round((4 + level) * power));
      shown();
      return damage;
    }

    // The curses
    case 'antiEntropy': {
      // Anti-entropy: one blow in eight freezes everything around (Freezing.affect: chill, frost at its full), and sets
      // the wearer alight.
      if (!chance(1 / 8).hit) return damage;
      for (const n of NEIGHBOURS8) freezing(ctx, hero.pos + n);
      // The frost's show around the wearer (not on its own cell).
      ctx.effects.push({ type: 'burst', depth, pos: hero.pos, kind: 'frost', radius: 1, silent: true });
      if (!isWater(ctx.level.map[hero.pos]!) && hero.armor.glyph !== 'brimstone') hero.burning = Math.max(hero.burning, 4);
      shown();
      return damage;
    }
    case 'corrosion':
      // Corrosion: one blow in ten splashes acidic ooze on everyone around, the wearer too.
      if (!chance(1 / 10).hit) return damage;
      for (const n of NEIGHBOURS9) {
        const char = charAt(world, depth, hero.pos + n);
        if (!char) continue;
        if (isHero(char)) {
          if (char.ooze < 0) ctx.effects.push({ type: 'oozed', hero: char.id });
          char.ooze = 0;
        } else {
          char.ooze = Math.max(char.ooze ?? 0, OOZE_TURNS / 2);
        }
      }
      shown();
      return damage;
    case 'displacement':
      // Displacement: one blow in twenty flings the wearer elsewhere, and misses.
      if (!chance(1 / 20).hit) return damage;
      return teleportChar(ctx, hero) ? 0 : damage;
    case 'metabolism': {
      // Metabolism: one blow in six turns satiety into health.
      if (!chance(1 / 6).hit) return damage;
      const healing = Math.min(Math.trunc(STARVING / 100), hero.ht - hero.hp);
      if (healing <= 0 || isStarving(hero)) return damage;
      hero.hunger = Math.min(STARVING, hero.hunger + healing * 10);
      hero.hp += healing;
      ctx.effects.push({ type: 'healed', hero: hero.id, amount: healing });
      shown();
      return damage;
    }
    case 'multiplicity': {
      // Multiplicity: one blow in twenty, a twin appears: of the wearer, or of the attacker (or some monster of the depth).
      if (!chance(1 / 20).hit) return damage;
      const cells = NEIGHBOURS8.map((n) => hero.pos + n).filter((c) =>
        !charAt(world, depth, c) && (isPassable(ctx.level, c) || hasFlag(ctx.level.map[c]!, F.AVOID)));
      if (cells.length === 0) return damage;
      if (rng.int(2) === 0) {
        conjureImages(ctx, hero, 1);
      } else {
        const copyable = !BOSSES.has(attacker.kind) && !MINIBOSSES.has(attacker.kind) && attacker.kind !== 'mimic' &&
          attacker.kind !== 'statue' && !isShopkeeper(attacker) && attacker.state !== 'passive';
        const kind = copyable ? attacker.kind : rollMob(rng, depth);
        const pos = rng.element(cells)!;
        const twin = createMob(`#${++world.nextId}`, kind, pos, 'hunting', ctx.floor.now + 1);
        if (copyable && attacker.level !== undefined) twin.level = attacker.level;
        twin.ht = twin.hp = copyable ? attacker.ht : twin.ht;
        Object.assign(twin, { enemy: hero.id, target: hero.pos, enemySeen: true });
        ctx.floor.mobs.push(twin);
        enterCell(ctx.level, pos);
        ctx.effects.push({ type: 'blinked', depth, who: twin.id, from: pos, to: pos });
      }
      shown();
      return damage;
    }
    case 'stench':
      // Stench: one blow in eight lets out a cloud of toxic gas.
      if (!chance(1 / 8).hit) return damage;
      seedGas(ctx, hero.pos, 'toxic', 250);
      shown();
      return damage;
    case 'overgrowth': {
      // Overgrowth: one blow in twenty, a plant sprouts underfoot and goes off (a warden draws no bark from it).
      if (!chance(1 / 20).hit) return damage;
      const seed = new ItemGenerator(rng, depth).of('seed');
      const kind = SEED_PLANTS[seed.kind];
      if (kind) {
        plant(ctx, hero.pos, kind);
        const subclass = hero.subclass;
        if (subclass === 'warden') hero.subclass = null;
        stepOnPlant(ctx, hero, hero.pos);
        hero.subclass = subclass;
      }
      shown();
      return damage;
    }
  }
}

/** Stone.testingEvasion: the hero's evasion as it would be without the stone. */
function stoneEvasion(hero: Hero): number {
  const glyph = hero.armor.glyph;
  hero.armor.glyph = undefined;
  const evasion = heroDefenseSkill(hero);
  hero.armor.glyph = glyph;
  return evasion;
}

/** Viscosity.ViscosityTracker.deferDamage: (level+1)/(level+6) of the blow, rounded up, put off to be taken later. */
export function deferDamage(ctx: Ctx, hero: Hero, damage: number, level: number): number {
  const percent = ((Math.max(0, level) + 1) / (Math.max(0, level) + 6)) * procMultiplier(hero);
  let dmg = damage;
  let amount: number;
  if (percent > 1) {
    dmg = Math.round(dmg / percent);
    amount = dmg;
  } else {
    amount = Math.ceil(dmg * percent);
  }
  if (amount > 0) {
    hero.deferred = (hero.deferred ?? 0) + amount;
    ctx.effects.push({ type: 'glyph', depth: ctx.depth, hero: hero.id, glyph: 'viscosity' });
  }
  return dmg - amount;
}

/** AntiMagic.drRoll: magic hurts a hero in armour of anti-magic less. */
export function antiMagicSoak(hero: Hero, rng: { normalIntRange(min: number, max: number): number }): number {
  if (hero.armor.glyph !== 'antiMagic') return 0;
  const level = gearLevel(hero.armor);
  const multi = procMultiplier(hero);
  return rng.normalIntRange(Math.round(level * multi), Math.round((3 + level * 1.5) * multi));
}

/** Camouflage.activate: trampling tall grass, the wearer melts into it for a few turns. */
export function camouflage(hero: Hero): void {
  if (hero.armor.glyph !== 'camouflage') return;
  hero.invisible = Math.max(hero.invisible, Math.round((3 + gearLevel(hero.armor) / 2) * procMultiplier(hero)));
}

/** Sources of harm armour of anti-magic softens (AntiMagic.RESISTS): magic, and the evil eye's gaze. */
const MAGIC_SOURCES: ReadonlySet<string> = new Set(['magic', 'wand', 'eye']);

/**
 * What a hero's gear soaks of any harm (Char.damage): armour of brimstone keeps fire off altogether; armour of
 * anti-magic soaks magic (AntiMagic.drRoll); a blocking weapon's shield takes what it can (ShieldBuff.processDamage).
 */
export function gearSoaks(ctx: Ctx, hero: Hero, damage: number, source: Char | string): number {
  if (source === 'burning' && hero.armor.glyph === 'brimstone') return 0;
  const what = typeof source === 'string' ? source : isHero(source) ? '' : source.kind;
  if (MAGIC_SOURCES.has(what)) damage = Math.max(0, damage - antiMagicSoak(hero, ctx.rng));
  if (hero.blocking && source !== 'hunger' && damage > 0) {
    const soaked = Math.min(hero.blocking.shield, damage);
    hero.blocking.shield -= soaked;
    damage -= soaked;
    if (hero.blocking.shield <= 0) delete hero.blocking;
  }
  return damage;
}

/**
 * RingOfWealth.genConsumableDrop, as a lucky blow's prize: at ring level -5, four in five a lesser find (half a pile
 * of gold, a potion, a scroll), else a better one (twice that, a bomb, a honeypot). Seam: runestones, exotics, brews
 * and spells (the alchemy stream's) are among them in Shattered.
 */
export function luckyDrop(ctx: Ctx, level: number): Item {
  const { rng, depth } = ctx;
  const generator = new ItemGenerator(rng, depth);
  const low = (): Item => {
    switch (rng.int(4)) {
      case 2:
        return generator.of('potion');
      case 3:
        return generator.of('scroll');
      default: {
        const gold = generator.of('gold');
        gold.qty = Math.max(1, Math.trunc(gold.qty / 2));
        return gold;
      }
    }
  };
  const roll = rng.float();
  if (roll < 0.6 - 0.04 * level) return low();
  switch (rng.int(6)) {
    case 4:
      return { kind: 'bomb', qty: 1, level: 0 };
    case 5:
      return { kind: 'honeypot', qty: 1, level: 0 };
    default: {
      const item = low();
      item.qty *= 2;
      return item;
    }
  }
}
