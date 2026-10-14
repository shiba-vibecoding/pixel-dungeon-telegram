import { isAlive, type Mob, MOBS, mobStats } from './actors';
import { burstOnEternalFire } from './roomblobs';
import { isTallGrass, trample } from './highgrass';
import { earnExp, hurt, mobDied } from './combat';
import { type Char, type Ctx, enterCell, exploredCells, heroesOn, isHero, isWater, leaveCell } from './floor';
import { distance } from './level/geometry';
import { F, hasFlag, T } from './level/terrain';
import { clearGas, seedGas } from './gas';
import { burnHeaps, chillPack, freezeHeaps } from './cooking';
import { stepOnPlant } from './plants';
import { activate } from './trap-effects';
import { frostHurtsElemental } from './wandmaker-mobs';
import type { Level } from './level/generate';
import { type TrapInfo, type TrapKind, TRAPS } from './level/trapdefs';
import { mobGearTick } from './throwing';
import { bleedTick } from './afflict';
import { hasProp } from './props';
import { tenguDartTrap } from './bosses/index';
import { tickMob } from './buffs';
import { deathMarkTurn } from './abilities';
import { flies, mobStatusTurn } from './status';

/*
 * Traps (levels/traps): set off by stepping on them, visible or hidden; then most are spent.
 * What each one does is in trap-effects.ts; the gas traps let out a cloud that spreads (gas.ts).
 */

export type { TrapKind } from './level/trapdefs';

/** The active trap on a cell (a TRAP or SECRET_TRAP cell), if any. */
export function trapAt(level: Level, pos: number): TrapInfo | undefined {
  const terrain = level.map[pos];
  if (terrain !== T.TRAP && terrain !== T.SECRET_TRAP) return undefined;
  const trap = level.traps?.find((t) => t.pos === pos);
  return trap?.active ? trap : undefined;
}

/** Level.setTrap: a trap laid on a cell, in sight or hidden. */
export function setTrap(level: Level, pos: number, kind: TrapKind, visible: boolean): TrapInfo {
  const trap: TrapInfo = { pos, kind, visible: visible || !TRAPS[kind].canBeHidden, active: true };
  level.traps = [...(level.traps ?? []).filter((t) => t.pos !== pos), trap].sort((a, b) => a.pos - b.pos);
  level.map[pos] = trap.visible ? T.TRAP : T.SECRET_TRAP;
  return trap;
}

/** Trap.disarm and Level.disarmTrap: spent, the cell an inactive trap. */
export function disarmTrap(level: Level, trap: TrapInfo): void {
  trap.active = false;
  level.map[trap.pos] = T.INACTIVE_TRAP;
}

/** Trap.reveal with Level.discover: a hidden trap is found. */
export function revealTrap(level: Level, pos: number): void {
  if (level.map[pos] === T.SECRET_TRAP) level.map[pos] = T.TRAP;
  const trap = level.traps?.find((t) => t.pos === pos);
  if (trap) trap.visible = true;
}

const GAS_RADIUS = 2;
const BURNING_TURNS = 8;

/** Frost.DURATION; GasesImmunity, as a cleansing cloud gives it. */
const FROST_TURNS = 5;
const PURE_TURNS = 5;

/** What a gas trap or a shattered potion releases; purity cleanses the air instead. */
export type Burst = 'toxic' | 'paralytic' | 'fire' | 'frost' | 'purity';

/**
 * IMMUNITIES: Yog-Dzewa breathes no gas and does not burn, nor does its
 * burning fist; piranhas in their pool fear neither gas, fire nor frost.
 */
export function immuneTo(char: Char, harm: 'burning' | 'gas' | 'frost' | 'toxic' | 'shock'): boolean {
  if (isHero(char)) {
    const b = char.buffs;
    // BlobImmunity (purity), and the imbues: fire (FireImbue), frost and chill (FrostImbue), toxic gas (ToxicImbue);
    // armour of brimstone keeps fire off its wearer (Char.isImmune: Burning).
    if (harm === 'gas') return (char.gasImmune ?? 0) > 0;
    if (harm === 'burning') return (b?.fireImbue ?? 0) > 0 || char.armor.glyph === 'brimstone';
    if (harm === 'frost') return (b?.frostImbue ?? 0) > 0;
    if (harm === 'toxic') return (b?.toxicImbue ?? 0) > 0;
    return false;
  }
  // SpiritHawk.HawkAlly: immune to all area-bound effects (BlobImmunity): gas, fire, frost and the rest of the blobs.
  if (char.kind === 'hawk') return true;
  // Piranha: the blobs but electricity and freezing, and burning.
  if (char.kind === 'piranha' || char.kind === 'phantomPiranha') return harm !== 'frost' && harm !== 'shock';
  if (harm === 'shock') return false;
  // Char.Property.INORGANIC: no toxic gas.
  if (harm === 'toxic') return hasProp(char, 'inorganic');
  // Char.Property: the fiery do not burn, the icy do not freeze (FIERY, ICY immunities); a blazing champion does not burn.
  if (harm === 'burning' && (hasProp(char, 'fiery') || char.champion === 'blazing')) return true;
  if (harm === 'frost' && hasProp(char, 'icy')) return true;
  // DM-300 breathes its own fumes unharmed.
  if (harm === 'gas' && char.kind === 'dm300') return true;
  // A newborn fire elemental does not burn (Char.Property.FIERY).
  if (harm === 'burning' && char.kind === 'newbornElemental') return true;
  return harm !== 'frost' && (char.kind === 'yog' || (harm === 'burning' && char.kind === 'burningFist'));
}

/**
 * Gas let out at a cell (`amount` of it, a cloud that spreads and lingers:
 * see gas.ts), or a burst of flame, frost or cleansing air reaching everyone
 * within `radius`. Flames set the grass around alight, but not those
 * standing in water.
 */
export function burst(ctx: Ctx, pos: number, kind: Burst, radius = GAS_RADIUS, silent = false, amount = 1000): void {
  ctx.effects.push({ type: 'burst', depth: ctx.depth, pos, kind, radius, ...(silent ? { silent } : {}) });
  if (kind === 'toxic' || kind === 'paralytic') {
    seedGas(ctx, pos, kind, amount);
    return;
  }
  const { level } = ctx;
  // PotionOfPurity.shatter: the air around is cleared of gas.
  if (kind === 'purity') clearGas(ctx, pos, radius);
  for (const char of around(ctx, pos, radius)) {
    if (kind === 'fire' && !isWater(level.map[char.pos]!) && !immuneTo(char, 'burning')) {
      char.burning = Math.max(char.burning ?? 0, BURNING_TURNS);
    }
    // Elemental.add: frost does a fire elemental harm instead (half to three fifths of its health).
    if (kind === 'frost' && !isHero(char) && char.kind === 'elemental') {
      elementalHarm(ctx, char);
      continue;
    }
    // Freezing: frozen stiff, and any fire put out (Elemental.add: a newborn fire elemental is hurt instead).
    if (kind === 'frost' && !frostHurtsElemental(ctx, char) && !immuneTo(char, 'frost')) {
      char.paralysed = Math.max(char.paralysed ?? 0, Math.round(FROST_TURNS * ctx.rng.floatRange(1, 1.5)));
      char.burning = 0;
    }
    if (kind === 'purity' && isHero(char)) char.gasImmune = Math.max(char.gasImmune ?? 0, PURE_TURNS);
    if (kind === 'frost' && isHero(char) && !immuneTo(char, 'frost')) chillPack(ctx, char);
  }
  if (kind === 'frost') freezeHeaps(ctx, pos, radius);
  // EternalFire: frost puts it out, and a potion of purity cleanses it.
  if (kind === 'frost' || kind === 'purity') burstOnEternalFire(ctx, pos, radius);
  if (kind !== 'fire') return;
  burnHeaps(ctx, pos, radius);
  // Whatever can burn nearby burns down to embers: grass, doors, barricades, bookshelves.
  for (let cell = 0; cell < level.map.length; cell++) {
    if (distance(cell, pos) <= radius + 1 && hasFlag(level.map[cell]!, F.FLAMABLE)) {
      level.map[cell] = T.EMBERS;
      ctx.effects.push({ type: 'burnt', depth: ctx.depth, pos: cell });
    }
  }
}

/** Elemental.add with one of its harmfulBuffs: half to three fifths of its health, instead of the buff. */
export function elementalHarm(ctx: Ctx, mob: Mob): void {
  const damage = ctx.rng.normalIntRange(Math.trunc(mob.ht / 2), Math.trunc((mob.ht * 3) / 5));
  ctx.effects.push({ type: 'hurt', depth: ctx.depth, who: mob.id, damage });
  hurt(ctx, mob, damage, 'burning');
}

/** Everyone alive within `radius` of a cell. */
function around(ctx: Ctx, pos: number, radius: number): Char[] {
  const chars: Char[] = heroesOn(ctx.world, ctx.depth).filter((hero) => distance(hero.pos, pos) <= radius);
  chars.push(...ctx.floor.mobs.filter((mob) => mob.state !== 'passive' && distance(mob.pos, pos) <= radius));
  return chars;
}

/**
 * Level.pressCell on a trap: Trap.trigger — a trap goes off under whoever steps on it, or under an
 * item that lands on it (`victim` null). Spent at once unless it goes on working (gripping,
 * flashing and gateway traps), and found if it was hidden; then it does what it does (activateTrap).
 */
export function triggerTrap(ctx: Ctx, victim: Char | null, pos: number): void {
  // Tengu's cell: its hidden traps are dart traps (TenguDartTrap).
  if (tenguDartTrap(ctx, victim, pos)) return;
  const trap = trapAt(ctx.level, pos);
  if (!trap) return;
  const mob = victim && !isHero(victim) ? victim : null;
  // A monster sets off a hidden trap only as a sheep does (a hard press): then it is mapped too.
  if (!mob || ctx.level.map[pos] === T.SECRET_TRAP) exploredCells(ctx.world, ctx.depth)[pos] = true;
  springTrap(ctx, trap, victim);
}

/**
 * Trap.trigger without the sound (as the summoning traps and the flock set off what lies under
 * whatever they bring): spent unless it goes on working, revealed, then activated.
 */
export function springTrap(ctx: Ctx, trap: TrapInfo, victim: Char | null): void {
  const { level, depth } = ctx;
  const pos = trap.pos;
  const hidden = level.map[pos] === T.SECRET_TRAP;
  if (TRAPS[trap.kind].disarmedByActivation) disarmTrap(level, trap);
  revealTrap(level, pos);
  const mob = victim && !isHero(victim) ? victim : null;
  ctx.effects.push({
    type: 'trap', depth, pos, kind: trap.kind, hero: victim && isHero(victim) ? victim.id : '', ...(mob ? { mob: mob.id } : {}),
    ...(hidden ? { hidden } : {}),
  });
  activateTrap(ctx, trap, victim);
}

/** Trap.activate: what each kind does (trap-effects.ts). */
export function activateTrap(ctx: Ctx, trap: TrapInfo, victim: Char | null): void {
  activate(ctx, trap, victim);
}

/**
 * Level.occupyCell for a monster: it comes to stand on a cell, by its own step (Mob.move: never a
 * flier) or thrown there (pushed, a flock of sheep, a trap). A flier touches nothing but a door.
 * Over a chasm it falls; a trap the party can see goes off under it (a soft press: hidden ones
 * stay hidden, but a sheep presses hard, as a hero does); a door opens; a plant is set off.
 */
export function mobPress(ctx: Ctx, mob: Mob): void {
  const cell = mob.pos;
  const terrain = ctx.level.map[cell]!;
  if (flies(mob)) {
    enterCell(ctx.level, cell);
    return;
  }
  if (hasFlag(terrain, F.PIT)) {
    mobFall(ctx, mob);
    return;
  }
  if (trapAt(ctx.level, cell) && (terrain === T.TRAP || mob.kind === 'sheep')) triggerTrap(ctx, mob, cell);
  // Level.pressCell: tall grass is trampled under it.
  if (isTallGrass(ctx.level.map[cell])) trample(ctx, cell, isAlive(mob) ? mob : null);
  enterCell(ctx.level, cell);
  stepOnPlant(ctx, isAlive(mob) ? mob : null, cell);
}

/**
 * Chasm.mobFall: the monster falls to its death (Mob.die(Chasm)): the party learns half as much from
 * it, and whatever it carried or would have dropped falls through to the depth below.
 */
export function mobFall(ctx: Ctx, mob: Mob): void {
  if (!ctx.floor.mobs.includes(mob)) return;
  ctx.effects.push({ type: 'mobFell', depth: ctx.depth, mob: mob.id, pos: mob.pos, kind: mob.kind });
  mob.fell = true;
  mobDied(ctx, mob);
}

/** Hurt a monster's turn by the conditions traps leave behind; true if it loses the turn. */
export function mobConditions(ctx: Ctx, mob: Mob): boolean {
  // DeathMarkTracker: the mark runs out, and a monster at no health dies.
  if (deathMarkTurn(ctx, mob)) return true;
  // What gear left on it: adrenaline, a lucky blow's tracker (throwing.ts).
  if (mobGearTick(ctx, mob)) return true;
  // Shattered's conditions first: corrosion, ooze, corruption, frost and the rest (status.ts); then alchemy's
  // buffs (buffs.ts): dread, aggression, a magical sleep...
  if (mobStatusTurn(ctx, mob)) return true;
  if (tickMob(ctx, mob)) return true;
  // IMMUNITIES: the fetid rat breathes its own paralytic cloud unharmed, and nothing holds the curse.
  if (mob.kind === 'fetidRat' || mob.kind === 'curse') mob.paralysed = 0;
  if (mob.kind === 'curse') mob.rooted = 0;
  if ((mob.slowed ?? 0) > 0) mob.slowed!--;
  if ((mob.crippled ?? 0) > 0) mob.crippled!--;
  if ((mob.rooted ?? 0) > 0) mob.rooted!--;
  if ((mob.rage ?? 0) > 0) mob.rage!--;
  if ((mob.blind ?? 0) > 0) mob.blind!--;
  // (Weakness, Vulnerable, Hex and a Barrier's shield wear off in status.ts mobStatusTurn.)
  // Bleeding: it hurts every turn as much as it bleeds, and eases, until it stops (Bleeding.act).
  if ((mob.bleeding ?? 0) > 0) {
    const damage = bleedTick(ctx.rng, mob);
    if (damage > 0) {
      ctx.effects.push({ type: 'hurt', depth: ctx.depth, who: mob.id, damage });
      hurt(ctx, mob, damage, 'bleeding');
      if (!isAlive(mob)) return true;
    }
  }
  if ((mob.poison ?? 0) > 0) {
    mob.poison!--;
    ctx.effects.push({ type: 'hurt', depth: ctx.depth, who: mob.id, damage: 1 });
    hurt(ctx, mob, 1, 'poison');
    if (!isAlive(mob)) return true;
  }
  // Elemental.add: burning does a frost elemental harm instead.
  if ((mob.burning ?? 0) > 0 && mob.kind === 'frostElemental') {
    mob.burning = 0;
    elementalHarm(ctx, mob);
    if (!isAlive(mob)) return true;
  }
  if ((mob.burning ?? 0) > 0) {
    mob.burning!--;
    if (isWater(ctx.level.map[mob.pos]!) || immuneTo(mob, 'burning')) {
      mob.burning = 0;
    } else {
      const damage = ctx.rng.intRange(1, 3 + Math.trunc(ctx.depth / 4));
      ctx.effects.push({ type: 'hurt', depth: ctx.depth, who: mob.id, damage });
      hurt(ctx, mob, damage, 'burning');
      if (!isAlive(mob)) return true;
    }
  }
  if ((mob.paralysed ?? 0) > 0) {
    mob.paralysed!--;
    mob.enemySeen = false;
    return true;
  }
  return false;
}

/**
 * Fire.burn on one cell (Tengu's fire as it goes out): what lies there burns, a plant withers, and
 * whatever can burn burns down to embers.
 */
export function burnCell(ctx: Ctx, cell: number): void {
  burnHeaps(ctx, cell, 0);
  if (ctx.floor.plants) ctx.floor.plants = ctx.floor.plants.filter((plant) => plant.pos !== cell);
  if (hasFlag(ctx.level.map[cell]!, F.FLAMABLE)) {
    ctx.level.map[cell] = T.EMBERS;
    ctx.effects.push({ type: 'burnt', depth: ctx.depth, pos: cell });
  }
}

/**
 * Trap.activate for a kind of trap at a cell, not one lying there (a reclaimed trap set off by a spell): what the
 * trap would do, without spending one.
 */
export function springTrapKind(ctx: Ctx, kind: TrapKind, victim: Char | null, pos: number): void {
  activateTrap(ctx, { pos, kind, visible: true, active: true }, victim);
}
export { summoning as summonAround } from './trap-effects';
