import { isAlive, type Mob, MOBS, mobStats } from './actors';
import { burstOnEternalFire } from './roomblobs';
import { isTallGrass, trample } from './highgrass';
import { chasmLoot, earnExp, hurt } from './combat';
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
export function immuneTo(char: Char, harm: 'burning' | 'gas' | 'frost'): boolean {
  if (isHero(char)) return harm === 'gas' && (char.gasImmune ?? 0) > 0;
  if (char.kind === 'piranha') return true;
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
  if (MOBS[mob.kind].flying) {
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
  const index = ctx.floor.mobs.indexOf(mob);
  if (index < 0) return;
  ctx.floor.mobs.splice(index, 1);
  mob.hp = 0;
  leaveCell(ctx.world, ctx.level, ctx.depth, mob.pos);
  ctx.effects.push({ type: 'mobFell', depth: ctx.depth, mob: mob.id, pos: mob.pos, kind: mob.kind });
  // Mob.die(Chasm): half the experience (an odd point rounded up or down at random), and its loot
  // falls with it.
  const stats = mobStats(mob);
  let exp = stats.exp;
  if (exp % 2 === 1) exp += ctx.rng.int(2);
  exp = Math.trunc(exp / 2);
  for (const hero of heroesOn(ctx.world, ctx.depth)) {
    if (exp > 0 && hero.lvl <= stats.maxLvl) earnExp(ctx, hero, exp);
  }
  chasmLoot(ctx, mob);
}

/** Hurt a monster's turn by the conditions traps leave behind; true if it loses the turn. */
export function mobConditions(ctx: Ctx, mob: Mob): boolean {
  // IMMUNITIES: the fetid rat breathes its own paralytic cloud unharmed, and nothing holds the curse.
  if (mob.kind === 'fetidRat' || mob.kind === 'curse') mob.paralysed = 0;
  if (mob.kind === 'curse') mob.rooted = 0;
  if ((mob.slowed ?? 0) > 0) mob.slowed!--;
  if ((mob.crippled ?? 0) > 0) mob.crippled!--;
  if ((mob.rooted ?? 0) > 0) mob.rooted!--;
  if ((mob.rage ?? 0) > 0) mob.rage!--;
  if ((mob.blind ?? 0) > 0) mob.blind!--;
  // Bleeding: it hurts every turn, and eases, until it stops.
  if ((mob.bleeding ?? 0) > 0) {
    mob.bleeding = ctx.rng.intRange(Math.trunc(mob.bleeding! / 2), mob.bleeding!);
    if (mob.bleeding > 0) {
      ctx.effects.push({ type: 'hurt', depth: ctx.depth, who: mob.id, damage: mob.bleeding });
      hurt(ctx, mob, mob.bleeding, 'bleeding');
      if (!isAlive(mob)) return true;
    }
  }
  if ((mob.poison ?? 0) > 0) {
    mob.poison!--;
    ctx.effects.push({ type: 'hurt', depth: ctx.depth, who: mob.id, damage: 1 });
    hurt(ctx, mob, 1, 'poison');
    if (!isAlive(mob)) return true;
  }
  if ((mob.burning ?? 0) > 0) {
    mob.burning!--;
    if (mob.kind === 'elemental') {
      // Fire only feeds a fire elemental (Elemental.add).
      mob.burning = 0;
      if (mob.hp < mob.ht) mob.hp++;
    } else if (isWater(ctx.level.map[mob.pos]!) || immuneTo(mob, 'burning')) {
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
