import { beckon, createMob, type Hero, heroArmor, isAlive, type Mob, type MobKind, MOBS, mobStats } from './actors';
import { mobGearTick } from './throwing';
import { dealMob } from './spawner';
import { bleedTick } from './afflict';
import { hasProp } from './props';
import { CRIPPLE_TURNS, earnExp, hurt } from './combat';
import { charAt, type Char, type Ctx, enterCell, exploredCells, heroesOn, isHero, isPassable, isWater, leaveCell } from './floor';
import { distance, NEIGHBOURS8 } from './level/geometry';
import { F, hasFlag, T } from './level/terrain';
import { clearGas, seedGas } from './gas';
import { burnHeaps, chillPack, freezeHeaps } from './cooking';
import { scaleMob } from './party';
import { stepOnPlant } from './plants';
import { tenguDartTrap } from './bosses/index';
import { tickMob } from './buffs';
import { flies, mobStatusTurn } from './status';

/*
 * Traps (levels/traps): set off by stepping on them, visible or hidden; then
 * they are spent. The gas traps let out a cloud that spreads (gas.ts).
 */

export type TrapKind = 'toxic' | 'fire' | 'paralytic' | 'poison' | 'alarm' | 'lightning' | 'gripping' | 'summoning';

const TRAPS: ReadonlyMap<number, TrapKind> = new Map<number, TrapKind>([
  [T.TOXIC_TRAP, 'toxic'], [T.SECRET_TOXIC_TRAP, 'toxic'],
  [T.FIRE_TRAP, 'fire'], [T.SECRET_FIRE_TRAP, 'fire'],
  [T.PARALYTIC_TRAP, 'paralytic'], [T.SECRET_PARALYTIC_TRAP, 'paralytic'],
  [T.POISON_TRAP, 'poison'], [T.SECRET_POISON_TRAP, 'poison'],
  [T.ALARM_TRAP, 'alarm'], [T.SECRET_ALARM_TRAP, 'alarm'],
  [T.LIGHTNING_TRAP, 'lightning'], [T.SECRET_LIGHTNING_TRAP, 'lightning'],
  [T.GRIPPING_TRAP, 'gripping'], [T.SECRET_GRIPPING_TRAP, 'gripping'],
  [T.SUMMONING_TRAP, 'summoning'], [T.SECRET_SUMMONING_TRAP, 'summoning'],
]);

export const trapAt = (terrain: number): TrapKind | undefined => TRAPS.get(terrain);

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
    // Freezing: frozen stiff, and any fire put out.
    if (kind === 'frost' && !immuneTo(char, 'frost')) {
      char.paralysed = Math.max(char.paralysed ?? 0, Math.round(FROST_TURNS * ctx.rng.floatRange(1, 1.5)));
      char.burning = 0;
    }
    if (kind === 'purity' && isHero(char)) char.gasImmune = Math.max(char.gasImmune ?? 0, PURE_TURNS);
    if (kind === 'frost' && isHero(char) && !immuneTo(char, 'frost')) chillPack(ctx, char);
  }
  if (kind === 'frost') freezeHeaps(ctx, pos, radius);
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
 * Level.press: a trap goes off under whoever steps on it, or under an item that lands on it
 * (`victim` null: thrown or dropped there; then only what needs no victim happens).
 * Level.mobPress sets traps off under monsters too (see mobPress): what hurts lands on them.
 */
export function triggerTrap(ctx: Ctx, victim: Char | null, pos: number): void {
  // Tengu's cell: its hidden traps are dart traps (TenguDartTrap).
  if (tenguDartTrap(ctx, victim, pos)) return;
  const { level, rng, depth } = ctx;
  const kind = trapAt(level.map[pos]!);
  if (!kind) return;
  level.map[pos] = T.INACTIVE_TRAP;
  const mob = victim && !isHero(victim) ? victim : null;
  // A monster only ever sets off a trap the party could see already: no need to map it for them.
  if (!mob) exploredCells(ctx.world, depth)[pos] = true;
  ctx.effects.push({ type: 'trap', depth, pos, kind, hero: victim && isHero(victim) ? victim.id : '', ...(mob ? { mob: mob.id } : {}) });
  springTrap(ctx, kind, victim, pos);
}

/** Trap.activate: what a trap of a kind does at a cell, to whoever is there (a reclaimed trap set off by a spell too). */
export function springTrap(ctx: Ctx, kind: TrapKind, victim: Char | null, pos: number): void {
  const { level, rng, depth } = ctx;
  const mob = victim && !isHero(victim) ? victim : null;
  switch (kind) {
    case 'poison':
      if (victim && isHero(victim)) victim.poison = Math.max(victim.poison, 4 + Math.trunc(depth / 2));
      // PoisonTrap on a monster: Poison.set, half as long for those that resist it (Poison.durationFactor).
      if (mob && mob.kind !== 'bee') mob.poison = Math.ceil((POISON_RESISTANT.has(mob.kind) ? 0.5 : 1) * (4 + Math.trunc(depth / 2)));
      break;
    case 'toxic':
    case 'paralytic':
      // ToxicTrap and ParalyticTrap: a cloud, the bigger the deeper.
      burst(ctx, pos, kind, GAS_RADIUS, false, kind === 'toxic' ? 300 + 20 * depth : 80 + 5 * depth);
      break;
    case 'fire':
      // A small fire on the trap itself, catching the grass around.
      burst(ctx, pos, 'fire', 0);
      break;
    case 'alarm':
      // AlarmTrap: every other monster on the level comes to see.
      for (const other of ctx.floor.mobs) if (other !== victim) beckon(other, pos);
      break;
    case 'lightning': {
      if (!victim) break;
      const damage = Math.max(1, rng.intBetween(Math.trunc(victim.hp / 3), Math.trunc((2 * victim.hp) / 3)));
      ctx.effects.push({ type: 'hurt', depth, who: victim.id, damage });
      hurt(ctx, victim, damage, 'lightning');
      break;
    }
    case 'gripping': {
      if (!victim) break;
      const damage = Math.max(0, depth + 3 - rng.intRange(0, Math.trunc((mob ? mobStats(mob).dr : heroArmor(victim as Hero)) / 2)));
      if (mob) {
        // GrippingTrap on a monster: it bleeds (Bleeding.set) and is crippled.
        mob.bleeding = damage;
        mob.crippled = Math.max(mob.crippled ?? 0, CRIPPLE_TURNS);
        break;
      }
      ctx.effects.push({ type: 'hurt', depth, who: victim.id, damage });
      hurt(ctx, victim, damage, 'gripping');
      break;
    }
    case 'summoning':
      summonAround(ctx, pos);
      break;
  }
}

/** SummoningTrap.activate: one to three monsters of the depth on free cells around, on their way to it. */
export function summonAround(ctx: Ctx, pos: number): void {
  const { level, rng, depth } = ctx;
  let count = 1;
  if (rng.int(2) === 0) {
    count++;
    if (rng.int(2) === 0) count++;
  }
  const cells = NEIGHBOURS8.map((n) => pos + n).filter((c) => isPassable(level, c) && !charAt(ctx.world, depth, c));
  for (let i = 0; i < count && cells.length > 0; i++) {
    const cell = cells.splice(rng.index(cells.length), 1)[0]!;
    // SummoningTrap: the level's next monsters (Level.createMob), wandering towards the trap.
    const summoned: Mob = dealMob(ctx.world, level, rng, `#${++ctx.world.nextId}`, cell, ctx.floor.now + 1);
    if (summoned.state !== 'passive') summoned.state = 'wandering';
    summoned.target = pos;
    ctx.floor.mobs.push(summoned);
  }
}

/** Monsters that resist poison (RESISTANCES: Poison): it lasts half as long on them. */
const POISON_RESISTANT: ReadonlySet<MobKind> = new Set<MobKind>(['spinner', 'scorpio', 'acidic', 'statue', 'tengu']);

/**
 * Level.mobPress: a monster comes to stand on a cell, by its own step (Mob.move: never a flier)
 * or thrown there (pushed, a flock of sheep). Over a chasm it falls, unless it flies; a trap
 * the party can see goes off under it (hidden ones stay hidden: only a hero's weight finds them);
 * a door opens; a plant is set off.
 */
export function mobPress(ctx: Ctx, mob: Mob): void {
  const cell = mob.pos;
  const terrain = ctx.level.map[cell]!;
  if (hasFlag(terrain, F.PIT) && !flies(mob)) {
    mobFall(ctx, mob);
    return;
  }
  if (trapAt(terrain) && !hasFlag(terrain, F.SECRET)) triggerTrap(ctx, mob, cell);
  enterCell(ctx.level, cell);
  stepOnPlant(ctx, isAlive(mob) ? mob : null, cell);
}

/**
 * Chasm.mobFall: the monster drops out of the level for good (Mob.destroy, not Mob.die): the
 * party still learns from it, but whatever it carried or would have dropped falls with it.
 */
export function mobFall(ctx: Ctx, mob: Mob): void {
  const index = ctx.floor.mobs.indexOf(mob);
  if (index < 0) return;
  ctx.floor.mobs.splice(index, 1);
  mob.hp = 0;
  leaveCell(ctx.world, ctx.level, ctx.depth, mob.pos);
  ctx.effects.push({ type: 'mobFell', depth: ctx.depth, mob: mob.id, pos: mob.pos, kind: mob.kind });
  const stats = mobStats(mob);
  for (const hero of heroesOn(ctx.world, ctx.depth)) {
    if (stats.exp > 0 && hero.lvl <= stats.maxLvl) earnExp(ctx, hero, stats.exp);
  }
}

/** Hurt a monster's turn by the conditions traps leave behind; true if it loses the turn. */
export function mobConditions(ctx: Ctx, mob: Mob): boolean {
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
