import { effectiveLevel, wear } from './wear';
import { type Hero, isAlive, maxExp, type Mob, mobStats } from './actors';
import {
  type Ballistica, ballistica, cone, type Cone, IGNORE_SOFT_SOLID, insideMap, MAGIC_BOLT, PROJECTILE, STOP_SOLID, STOP_TARGET, subPath,
  WONT_STOP,
} from './ballistica';
import { hurt, lootAndExp } from './combat';
import { charAt, type Char, type Ctx, enterCell, exploredCells, heroView, isHero, isWater, leaveCell } from './floor';
import { identify, idSpeedFactor, isIdentified, WAND_USES_TO_ID } from './ident';
import { isMagicImmune } from './buffs';
import { pointsInTalent } from './talents/data';
import {
  afterWandSpent, backupBarrier, beforeWandSpent, empowerBoost, onWandProc, scrollEmpowerUsed, shieldBattery, wandLevelBonus, wandProcMultiplier,
} from './talents/magic';
import { type Item, type ItemKind, itemDef, wandMaxCharges } from './items';
import { discoverable } from './level/flags';
import { adjacent, cellX, cellY, distance, LENGTH, NEIGHBOURS8, NEIGHBOURS9 } from './level/geometry';
import { discover, F, hasFlag, T } from './level/terrain';
import { clearGasAt, destroyCell, gasAt, seedFire, seedGas, setGasStrength } from './gas';
import { freezeHeaps, burnHeaps } from './cooking';
import { DARKNESS, isChallenged } from './challenges';
import { viewDistance } from './fov';
import { hasProp, isImmune, resistance } from './props';
import { chill, CHARM_TURNS, FROST_TURNS, freeze, ignite, OOZE_TURNS, ooze, shieldUp, SOUL_MARK_TURNS } from './status';
import { mobPress, trapAt, triggerTrap } from './traps';
import { stepOnPlant } from './plants';
import { allyWandHeal, corruptionHeal, findGuardian, guardianInfo, placeGuardian, spawnWard, upgradeWard, wardEnergy } from './allies';
import { cursedZap } from './cursed';
import { regrowCone } from './regrowth';
import { trample } from './world';
import { wandChargeMultiplier } from './rings';
import { dispelInvisibility } from './artifacts';
import type { ItemRef } from './scrolls';

/*
 * Shattered's wands (items/wands): Wand and DamageWand, and every kind of
 * wand, zapped at a cell. A wand holds two charges and one more a level
 * (magic missile one more still), ten at most, and gathers them back by
 * itself, the quicker the more it lacks (Wand.Charger). It tells its curse
 * the first time it is zapped, and its level and charges after ten zaps
 * (fewer counted at first, more with every level the hero gains). A cursed
 * wand does something random instead (cursed.ts). A battlemage's blows with
 * the mage's staff do what its wand does on a hit (onHit); a warlock's zaps
 * may leave a soul mark.
 */

const f32 = Math.fround;

/** How a bolt, a beam or a cone looks in flight (MagicMissile and Beam kinds); some are the monsters'. */
export type Bolt =
  | 'magic' | 'lightning' | 'fire' | 'frost' | 'corrosion' | 'force' | 'earth' | 'ward' | 'corruption' | 'rainbow' | 'foliage'
  | 'death' | 'light' | 'blood' | 'beam' | 'poison' | 'shadow'
  /** LloydsBeacon's zap (MagicMissile.BEACON). */
  | 'beacon'
  // Alchemy's spells: wild energy's chaotic zap, a telekinetic grab.
  | 'wild' | 'grab';

/** What a wand tells its wielder (Wand's and its kinds' messages). */
export type WandNote =
  | 'fizzles' | 'selfTarget' | 'curseDiscover' | 'identify' | 'noMoreWards' | 'badLocation' | 'alreadyCorrupted' | 'charged'
  | 'noTele' | 'staffImbued' | 'gravityEnd';

/** Wand.TIME_TO_ZAP. */
const TIME_TO_ZAP = 1;

/** A wand being zapped: the wand itself, the staff it is in (if it is), and the level it zaps at. */
export interface Zap {
  ctx: Ctx;
  hero: Hero;
  wand: Item;
  staff: Item | null;
  cursed: boolean;
  level: number;
}

/** The wand an ItemRef points at: one in the pack, or the one in the mage's staff (in hand or in the pack). */
export function wandAt(hero: Hero, ref: ItemRef): { wand: Item; staff: Item | null } | null {
  const item = ref === 'weapon' ? hero.weapon : typeof ref === 'number' ? hero.items[ref] : undefined;
  if (!item) return null;
  if (item.kind === 'weapon.magesStaff') return item.wand ? { wand: item.wand, staff: item } : null;
  return itemDef(item.kind).category === 'wand' ? { wand: item, staff: null } : null;
}

/** Wand.level as it counts: the wand's, or its staff's (a staff's wand is as good as the staff, worn down as it is). */
const baseLevel = (wand: Item, staff: Item | null): number => (staff ? effectiveLevel(staff) : effectiveLevel(wand));

/**
 * Wand.buffedLvl: the wand's level (Shattered has no ring of power)
 * and no less than a magic missile's charge while it lasts.
 */
export function buffedLevel(hero: Hero, wand: Item, staff: Item | null = null): number {
  // A scroll's empowerment, and desperate power on the last charge (Wand.buffedLvl).
  const level = Math.max(0, baseLevel(wand, staff)) + wandLevelBonus(hero, wand);
  const charge = hero.magicCharge;
  return charge && charge.level > level ? charge.level : level;
}

/** Wand.maxCharges: one more in the staff. */
export const maxCharges = (wand: Item, staff: Item | null): number => wandMaxCharges(wand, staff !== null);

/**
 * Wand.chargesPerCast: one, but the wands of fireblast and regrowth spend three tenths of what they
 * hold (rounded up, one to three) — one only when cursed.
 */
export function chargesPerCast(wand: Item, cursed: boolean): number {
  if (wand.kind !== 'wand.fireblast' && wand.kind !== 'wand.regrowth') return 1;
  if (cursed) return 1;
  return Math.min(3, Math.max(1, Math.ceil(f32((wand.charges ?? 0) * f32(0.3)))));
}

/** Wand.collisionProperties: how each kind's bolt flies; a cursed wand's always as a magic bolt. */
function collisionOf(ctx: Ctx, hero: Hero, wand: Item, target: number, cursed: boolean): number {
  if (cursed) return MAGIC_BOLT;
  switch (wand.kind) {
    case 'wand.disintegration':
    case 'wand.fireblast':
    case 'wand.regrowth':
      return WONT_STOP;
    case 'wand.corrosion':
      return STOP_TARGET | STOP_SOLID;
    case 'wand.blastWave':
    case 'wand.transfusion':
      return PROJECTILE;
    case 'wand.warding':
      // WandOfWarding.collisionProperties: up to the cell aimed at, if it can be seen; else as a thrown thing.
      return heroView(ctx.world, hero)[target] ? STOP_TARGET : PROJECTILE;
    default:
      return MAGIC_BOLT;
  }
}

/** Hero.heroDamageIntRange (seam for the alchemy stream: the thirteen-leaf clover would alter the roll). */
const heroDamageIntRange = (ctx: Ctx, min: number, max: number): number => ctx.rng.normalIntRange(min, max);

/** DamageWand.min and max of each kind, at a level. */
export function wandDamage(kind: ItemKind, level: number, charges = 1): readonly [number, number] | null {
  switch (kind) {
    case 'wand.magicMissile':
      return [2 + level, 8 + 2 * level];
    case 'wand.lightning':
      return [5 + level, 10 + 5 * level];
    case 'wand.disintegration':
      return [2 + level, 8 + 4 * level];
    case 'wand.fireblast':
      // 1/2/3 base damage scaling 1/2/3 a level, by the charges spent; 2/8/18 base scaling 2/4/6.
      return [(1 + level) * charges, charges === 1 ? 2 + 2 * level : charges === 2 ? 2 * (4 + 2 * level) : 3 * (6 + 2 * level)];
    case 'wand.blastWave':
      return [1 + level, 3 + 3 * level];
    case 'wand.livingEarth':
      return [4, 6 + 2 * level];
    case 'wand.frost':
      return [2 + level, 8 + 5 * level];
    case 'wand.prismaticLight':
      return [1 + level, 5 + 3 * level];
    case 'wand.transfusion':
      return [3 + level, 6 + 2 * level];
    default:
      return null;
  }
}

/** DamageWand.damageRoll. */
function damageRoll(z: Zap, level = z.level): number {
  const [min, max] = wandDamage(z.wand.kind, level, chargesPerCast(z.wand, z.cursed))!;
  // DamageWand.damageRoll: empowering meal's bonus damage for a few zaps.
  return heroDamageIntRange(z.ctx, min, max) + empowerBoost(z.ctx, z.hero);
}

/** Damage from a wand, as the target resists it (Char.resist: the fiery the fireblast, the icy the frost, ...). */
function strike(z: Zap, victim: Char, damage: number): void {
  const dealt = Math.round(damage * resistance(victim, z.wand.kind));
  z.ctx.effects.push({ type: 'attack', depth: z.ctx.depth, attacker: z.hero.id, target: victim.id, hit: true, damage: dealt });
  hurt(z.ctx, victim, dealt, isHero(victim) ? 'wand' : z.hero);
}

/**
 * Wand.wandProc: what any zap does to whoever it reaches — a warlock's leaves a soul mark, now and
 * then (one in seven at least, likelier the stronger the zap). Seam for the talents stream: arcane
 * vision, searing light, sunray.
 */
export function wandProc(ctx: Ctx, hero: Hero, target: Char, level: number, chargesUsed: number): void {
  if (target === hero || isHero(target)) return;
  // Wand.wandProc: arcane vision.
  onWandProc(hero, target);
  if (hero.subclass === 'warlock' && ctx.rng.float() > f32(f32(powi(0.92, level * chargesUsed + 1)) - 0.07)) {
    target.soulMarked = Math.max(target.soulMarked ?? 0, SOUL_MARK_TURNS + level);
  }
}

/** b to a whole power, by multiplying (Math.pow may differ in its last bit from one engine to another). */
export function powi(base: number, exponent: number): number {
  let result = 1;
  for (let i = 0; i < exponent; i++) result *= base;
  return result;
}

/** Level.pressCell: a hard press, as of something landing there: traps (hidden ones too), tall grass, a door, a plant. */
export function pressCell(ctx: Ctx, cell: number): void {
  const terrain = ctx.level.map[cell]!;
  if (hasFlag(terrain, F.PIT)) return;
  if (trapAt(terrain)) triggerTrap(ctx, null, cell);
  if (ctx.level.map[cell] === T.HIGH_GRASS) trample(ctx, cell);
  if (ctx.level.map[cell] === T.DOOR) enterCell(ctx.level, cell);
  stepOnPlant(ctx, null, cell);
}

/** Why a wand cannot be zapped at all (Wand.actions): it is known to be empty. A wand of unknown charges may be tried. */
export function zapProblem(hero: Hero, ref: ItemRef): string | null {
  const found = wandAt(hero, ref);
  if (!found) return 'that cannot be zapped';
  const { wand, staff } = found;
  // MagesStaff.actions: zap only while its wand holds a charge (the staff's wand is known through and through).
  if (staff && (wand.charges ?? 0) <= 0) return 'the wand is out of charges';
  return (wand.charges ?? 0) <= 0 && !wand.chargesUnknown ? 'the wand is out of charges' : null;
}

/**
 * Wand.zapper.onSelect: a wand zapped at a cell. Its bolt flies as its kind does; aimed at the hero,
 * or stopped at once, it does nothing. Not enough charges: it fizzles (Wand.tryToZap), taking no time.
 * Otherwise it does its work (or a cursed wand's random one), its curse is known, and it is used.
 */
export function zap(ctx: Ctx, hero: Hero, ref: ItemRef, target: number): number {
  const { wand, staff } = wandAt(hero, ref)!;
  // MagesStaff.execute: the staff's wand is as cursed as the staff.
  const cursed = staff ? !!staff.cursed : !!wand.cursed;
  const bolt = ballistica(ctx, hero.pos, target, collisionOf(ctx, hero, wand, target, cursed));
  const note = (what: WandNote): void => {
    ctx.effects.push({ type: 'wand', hero: hero.id, note: what, item: wand.kind });
  };
  if (target === hero.pos || bolt.collisionPos === hero.pos) {
    // Shield battery: zapped at oneself, a wand's charges become a shield.
    if (target === hero.pos && !isMagicImmune(hero) && shieldBattery(ctx, hero, wand)) return 1;
    note('selfTarget');
    return 0;
  }
  const charges = chargesPerCast(wand, cursed);
  if ((wand.charges ?? 0) < charges) {
    note('fizzles');
    return 0;
  }
  // WandOfWarding.tryToZap: no more wards than the wands of warding can keep.
  if (wand.kind === 'wand.warding' && !cursed && !wardsAllow(ctx, hero, target)) {
    note('noMoreWards');
    return 0;
  }
  // Backup barrier: a shield as the last charge goes (before the zap, so it helps against skeletons).
  if (!cursed) {
    backupBarrier(ctx, hero, wand, staff !== null, charges, heldWands(hero).map((held) => held.wand));
  }
  const z: Zap = { ctx, hero, wand, staff, cursed, level: buffedLevel(hero, wand, staff) };
  const curseUnknown = staff ? staff.curseUnknown : wand.curseUnknown;
  if (cursed) {
    if (curseUnknown) note('curseDiscover');
    cursedZap(ctx, hero, wand, ballistica(ctx, hero.pos, target, MAGIC_BOLT), true);
  } else {
    onZap(z, bolt, target);
  }
  // The wand's curse is known now.
  delete wand.curseUnknown;
  if (staff) delete staff.curseUnknown;
  wandUsed(z, charges);
  return TIME_TO_ZAP;
}

/**
 * Wand.wandUsed: a zap counts towards knowing the wand (as many as it may count now); the charges
 * are spent (one, if cursed); a magic missile's charge that made this wand stronger is used up; the
 * hero is seen again; and (as wands wear here) it wears.
 */
function wandUsed(z: Zap, charges: number): void {
  const { ctx, hero, wand, staff } = z;
  if (!isIdentified(ctx.world, wand)) {
    const uses = Math.min(wand.availableUsesToID ?? WAND_USES_TO_ID / 2, idSpeedFactor(hero, wand));
    wand.availableUsesToID = f32((wand.availableUsesToID ?? WAND_USES_TO_ID / 2) - uses);
    wand.usesLeftToID = f32((wand.usesLeftToID ?? WAND_USES_TO_ID) - uses);
    // Scholar's intuition at +2 knows a wand at its first zap.
    if (wand.usesLeftToID <= 0 || pointsInTalent(hero, 'scholars_intuition') === 2) {
      identify(ctx.world, wand);
      ctx.effects.push({ type: 'familiar', hero: hero.id, item: wand, learned: false });
    }
  }
  beforeWandSpent(ctx, hero, wand, staff !== null, z.level, maxCharges(wand, staff));
  wand.charges = (wand.charges ?? 0) - (z.cursed ? 1 : charges);
  const charge = hero.magicCharge;
  if (charge) {
    const own = Math.max(0, baseLevel(wand, staff));
    if (!charge.fresh && charge.level === z.level && z.level > own) delete hero.magicCharge;
    else {
      delete charge.fresh;
      scrollEmpowerUsed(hero);
    }
  } else {
    scrollEmpowerUsed(hero);
  }
  afterWandSpent(hero, staff !== null);
  // Invisibility.dispel: the cloak's stealth and the hourglass's frozen time end too.
  dispelInvisibility(ctx, hero);
  wear(ctx, hero, staff ?? wand);
}

/**
 * CursedWand.RandomWand: some other wand's work, as strong as the cursed one, along the cursed bolt
 * (a wand made for the moment, never charged nor used).
 */
export function zapAs(ctx: Ctx, hero: Hero, wand: Item, bolt: Ballistica, target: number): void {
  onZap({ ctx, hero, wand, staff: null, cursed: false, level: Math.max(0, wand.level) }, bolt, target);
}

/** The wand's work (Wand.onZap of each kind), its bolt having flown (Wand.fx). */
function onZap(z: Zap, bolt: Ballistica, target: number): void {
  const { ctx, hero } = z;
  const fx = (bolt2: Bolt, to = bolt.collisionPos, from = hero.pos): void => {
    ctx.effects.push({ type: 'zapped', depth: ctx.depth, from, to, bolt: bolt2 });
  };
  const at = (cell: number): Char | undefined => {
    const char = charAt(ctx.world, ctx.depth, cell);
    return char && isAlive(char) ? char : undefined;
  };
  const cpc = chargesPerCast(z.wand, false);
  switch (z.wand.kind) {
    case 'wand.magicMissile': {
      fx('magic');
      const ch = at(bolt.collisionPos);
      if (!ch) {
        pressCell(ctx, bolt.collisionPos);
        return;
      }
      wandProc(ctx, hero, ch, z.level, 1);
      strike(z, ch, damageRoll(z));
      // WandOfMagicMissile.MagicCharge: a lesser wand held (or a charge already on) zaps as strong as this, for four turns.
      const others = heldWands(hero).filter(({ wand }) => wand !== z.wand);
      if (hero.magicCharge || others.some(({ wand, staff }) => buffedLevel(hero, wand, staff) < z.level)) {
        const charge = hero.magicCharge;
        hero.magicCharge = {
          level: Math.max(charge?.level ?? 0, z.level), turns: Math.max(charge?.turns ?? 0, MAGIC_CHARGE_TURNS),
          ...((charge?.level ?? 0) < z.level ? { fresh: true } : {}),
        };
      }
      return;
    }
    case 'wand.lightning':
      lightning(z, bolt);
      return;
    case 'wand.disintegration':
      disintegrate(z, bolt);
      return;
    case 'wand.fireblast':
      fireblast(z, bolt, cpc);
      return;
    case 'wand.corrosion': {
      fx('corrosion');
      // WandOfCorrosion.onZap: a cloud of corrosive gas, as strong as the wand.
      seedGas(ctx, bolt.collisionPos, 'corrosive', 50 + 10 * z.level);
      setGasStrength(ctx, 'corrosive', 2 + z.level);
      for (const n of NEIGHBOURS9) {
        const ch = at(bolt.collisionPos + n);
        if (ch) wandProc(ctx, hero, ch, z.level, 1);
      }
      if (!at(bolt.collisionPos)) pressCell(ctx, bolt.collisionPos);
      return;
    }
    case 'wand.blastWave':
      blastWave(z, bolt);
      return;
    case 'wand.livingEarth':
      livingEarth(z, bolt);
      return;
    case 'wand.frost': {
      fx('frost');
      const pos = bolt.collisionPos;
      freezeHeaps(ctx, pos, 0);
      clearGasAt(ctx.floor, 'fire', pos);
      const ch = at(pos);
      if (!ch) {
        pressCell(ctx, pos);
        return;
      }
      // Nothing more can be done to what is frozen.
      if ((ch.frozen ?? 0) > 0) return;
      let damage = damageRoll(z);
      // A fifteenth less damage for every turn of chill left, ten at most (half as much).
      if ((ch.chill ?? 0) > 0) damage = Math.round(damage * powi(f32(0.9333), Math.min(10, Math.ceil(ch.chill!))));
      wandProc(ctx, hero, ch, z.level, 1);
      strike(z, ch, damage);
      if (isAlive(ch)) chill(ch, (isWater(ctx.level.map[ch.pos]!) ? 4 : 2) + z.level);
      return;
    }
    case 'wand.prismaticLight':
      prismaticLight(z, bolt);
      return;
    case 'wand.warding':
      warding(z, bolt);
      return;
    case 'wand.transfusion':
      transfusion(z, bolt);
      return;
    case 'wand.corruption':
      corruption(z, bolt);
      return;
    case 'wand.regrowth':
      regrowCone(z, bolt, target, cpc);
      return;
    default:
      fx('magic');
  }
}

/** WandOfMagicMissile.MagicCharge.DURATION. */
const MAGIC_CHARGE_TURNS = 4;

/* Lightning */

/**
 * WandOfLightning: the bolt strikes whoever it reaches and arcs on to everyone close by (two cells
 * through water, one more with a lightning charge; the hero only from right beside), and on from
 * them. The more it strikes, the less each takes, unless the first stands in water; the zapper's
 * own allies are spared but for the one aimed at, and the zapper takes half.
 */
function lightning(z: Zap, bolt: Ballistica): void {
  const { ctx, hero } = z;
  const affected: Char[] = [];
  const arcs: Array<[number, number]> = [];
  const first = charAt(ctx.world, ctx.depth, bolt.collisionPos);
  const solid = (cell: number): boolean => hasFlag(ctx.level.map[cell]!, F.SOLID);
  const arc = (ch: Char): void => {
    let reach = isWater(ctx.level.map[ch.pos]!) ? 2 : 1;
    if ((hero.lightningCharge ?? 0) > 0) reach++;
    const dist = distanceMap(ch.pos, (cell) => !solid(cell), reach);
    const hit: Char[] = [];
    for (let cell = 0; cell < LENGTH; cell++) {
      if (dist[cell]! < 0) continue;
      const other = charAt(ctx.world, ctx.depth, cell);
      if (!other || !isAlive(other)) continue;
      // The hero is only zapped from right beside.
      if (isHero(other) && dist[cell]! > 1) continue;
      if (!affected.includes(other)) hit.push(other);
    }
    affected.push(...hit);
    for (const other of hit) {
      arcs.push([ch.pos, other.pos]);
      arc(other);
    }
  };
  if (first && isAlive(first)) {
    affected.push(first);
    arcs.push([hero.pos, first.pos]);
    arc(first);
  } else {
    arcs.push([hero.pos, bolt.collisionPos]);
  }
  for (const [from, to] of arcs) ctx.effects.push({ type: 'zapped', depth: ctx.depth, from, to, bolt: 'lightning' });
  // The zapper's allies (other than the one aimed at) are spared, and so is whoever is charged with lightning (LightningCharge).
  const struck = affected.filter((ch) => !(ch !== hero && (isHero(ch) || (!isHero(ch) && ch.ally)) && ch.pos !== bolt.collisionPos) &&
    !(isHero(ch) && (ch.lightningCharge ?? 0) > 0));
  if (struck.length === 0) return;
  let multiplier = f32(0.4 + f32(0.6 / struck.length));
  if (isWater(ctx.level.map[bolt.collisionPos]!)) multiplier = 1;
  for (const ch of struck) {
    wandProc(ctx, hero, ch, z.level, 1);
    if (ch === hero) strike(z, ch, Math.round(f32(damageRoll(z) * multiplier * 0.5)));
    else strike(z, ch, Math.round(f32(damageRoll(z) * multiplier)));
  }
}

/** PathFinder.buildDistanceMap(from, passable, limit): steps to each cell within the limit, -1 beyond. */
function distanceMap(from: number, passable: (cell: number) => boolean, limit: number): Int32Array {
  const dist = new Int32Array(LENGTH).fill(-1);
  dist[from] = 0;
  const queue = [from];
  for (let head = 0; head < queue.length; head++) {
    const cell = queue[head]!;
    if (dist[cell]! >= limit) continue;
    for (const n of NEIGHBOURS8) {
      const next = cell + n;
      if (next < 0 || next >= LENGTH || dist[next]! >= 0 || !adjacent(cell, next) || !passable(next)) continue;
      dist[next] = dist[cell]! + 1;
      queue.push(next);
    }
  }
  return dist;
}

/* Disintegration */

/**
 * WandOfDisintegration: a beam six cells long and two more a level, through everyone and every
 * wall; it burns down what burns, and grows stronger for everyone it pierces after the first and
 * for every three walls passed before the last of them.
 */
function disintegrate(z: Zap, beam: Ballistica): void {
  const { ctx, hero } = z;
  const reach = Math.min(z.level * 2 + 6, beam.dist);
  ctx.effects.push({ type: 'zapped', depth: ctx.depth, from: hero.pos, to: beam.path[Math.min(beam.dist, z.level * 2 + 6)]!, bolt: 'death' });
  const chars: Char[] = [];
  let terrainPassed = 2;
  let terrainBonus = 0;
  const explored = exploredCells(ctx.world, ctx.depth);
  for (const cell of subPath(beam, 1, reach)) {
    const ch = charAt(ctx.world, ctx.depth, cell);
    if (ch && isAlive(ch)) {
      terrainBonus += Math.trunc(terrainPassed / 3);
      terrainPassed %= 3;
      // Undiscovered harmless folk are left be.
      if (!(!isHero(ch) && ch.state === 'passive' && !explored[cell])) chars.push(ch);
    }
    if (hasFlag(ctx.level.map[cell]!, F.SOLID)) terrainPassed++;
    if (hasFlag(ctx.level.map[cell]!, F.FLAMABLE)) destroyCell(ctx, cell);
  }
  const lvl = z.level + (chars.length - 1) + terrainBonus;
  for (const ch of chars) {
    wandProc(ctx, hero, ch, z.level, 1);
    strike(z, ch, damageRoll(z, lvl));
  }
}

/* Fireblast */

/**
 * WandOfFireblast: a cone of fire, the longer and wider the more charges it spends (one to three);
 * doors in it are blown open, and fire is set everywhere in it but on bare ground right beside the
 * zapper (where only flammable cells further on catch). Everyone in it is hurt and set alight;
 * two charges also cripple, three paralyse.
 */
function fireblast(z: Zap, bolt: Ballistica, cpc: number): void {
  const { ctx, hero } = z;
  const source = bolt.sourcePos;
  const shape = cone(ctx, bolt, 3 + 2 * cpc, 30 + 20 * cpc, STOP_TARGET | STOP_SOLID | IGNORE_SOFT_SOLID);
  showCone(z, shape, 'fire');
  const map = ctx.level.map;
  const affected: Char[] = [];
  const nearby: number[] = [];
  for (const cell of shape.cells) {
    if (cell === source) continue;
    if (map[cell] === T.DOOR) map[cell] = T.OPEN_DOOR;
    if (adjacent(source, cell) && !(hasFlag(map[cell]!, F.FLAMABLE) || hasFlag(map[cell]!, F.SOLID))) {
      nearby.push(cell);
      burnHeaps(ctx, cell, 0);
    } else {
      seedFire(ctx, cell, 1 + cpc);
    }
    const ch = charAt(ctx.world, ctx.depth, cell);
    if (ch && isAlive(ch)) affected.push(ch);
  }
  if (shape.cells.length === 0) nearby.push(source);
  const trueDistance = (a: number, b: number): number => Math.sqrt((cellX(a) - cellX(b)) ** 2 + (cellY(a) - cellY(b)) ** 2);
  for (const cell of nearby) {
    for (const n of NEIGHBOURS8) {
      const next = cell + n;
      if (trueDistance(next, bolt.collisionPos) < trueDistance(cell, bolt.collisionPos) && hasFlag(map[next]!, F.FLAMABLE) &&
        gasAt(ctx.floor, 'fire', next) === 0) {
        seedFire(ctx, next, 1 + cpc);
      }
    }
  }
  ctx.effects.push({ type: 'burst', depth: ctx.depth, pos: bolt.collisionPos, kind: 'fire', radius: 0, silent: true });
  for (const ch of affected) {
    wandProc(ctx, hero, ch, z.level, cpc);
    strike(z, ch, damageRoll(z));
    if (!isAlive(ch)) continue;
    ignite(ch);
    if (cpc === 2) ch.crippled = (ch.crippled ?? 0) + 4;
    if (cpc === 3) ch.paralysed = Math.max(ch.paralysed ?? 0, 4);
  }
}

/** The cone's flight: to the tip of every outer ray. */
function showCone(z: Zap, shape: Cone, bolt: Bolt): void {
  z.ctx.effects.push({ type: 'cone', depth: z.ctx.depth, from: z.hero.pos, cells: shape.outerRays.map((ray) => ray.path[ray.dist]!), bolt });
}

/* Blast wave */

/**
 * WandOfBlastWave: a wave where the bolt lands, pressing every cell around; it hurts whoever stands
 * there (but the zapper's allies) and throws them back from it, and the one it struck further still.
 */
function blastWave(z: Zap, bolt: Ballistica): void {
  const { ctx, hero } = z;
  const pos = bolt.collisionPos;
  ctx.effects.push({ type: 'zapped', depth: ctx.depth, from: hero.pos, to: pos, bolt: 'force' });
  ctx.effects.push({ type: 'blast', depth: ctx.depth, pos, radius: 3 });
  for (const n of NEIGHBOURS9) pressCell(ctx, pos + n);
  for (const n of NEIGHBOURS8) {
    const ch = charAt(ctx.world, ctx.depth, pos + n);
    if (!ch || !isAlive(ch)) continue;
    wandProc(ctx, hero, ch, z.level, 1);
    if (!isHero(ch) && !ch.ally) strike(z, ch, damageRoll(z));
    if ((isAlive(ch) || !hasFlag(ctx.level.map[ch.pos]!, F.PIT)) && ch.pos === pos + n) {
      throwChar(ctx, ch, ballistica(ctx, ch.pos, ch.pos + n, MAGIC_BOLT), Math.round(1.5 + z.level / 2), false, true);
    }
  }
  const ch = charAt(ctx.world, ctx.depth, pos);
  if (ch && isAlive(ch)) {
    wandProc(ctx, hero, ch, z.level, 1);
    strike(z, ch, damageRoll(z));
    if ((isAlive(ch) || !hasFlag(ctx.level.map[ch.pos]!, F.PIT)) && bolt.path.length > bolt.dist + 1 && ch.pos === pos) {
      throwChar(ctx, ch, ballistica(ctx, ch.pos, bolt.path[bolt.dist + 1]!, MAGIC_BOLT), z.level + 3, false, true);
    }
  }
}

/**
 * WandOfBlastWave.throwChar: thrown along a path, as far as the power goes (half as far for a boss),
 * stopping short of whoever is in the way; slammed into something, it is hurt and stunned for a
 * moment. The held fast and the immovable stay put. Where it lands, it lands (Level.occupyCell).
 */
export function throwChar(ctx: Ctx, ch: Char, trajectory: Ballistica, power: number, closeDoors: boolean, collideDamage: boolean): void {
  if (hasProp(ch, 'boss')) power = Math.trunc((power + 1) / 2);
  let dist = Math.min(trajectory.dist, power);
  let collided = dist === trajectory.dist;
  if (dist <= 0 || (ch.rooted ?? 0) > 0 || hasProp(ch, 'immovable')) return;
  if (charAt(ctx.world, ctx.depth, trajectory.path[dist]!)) {
    dist--;
    collided = true;
  }
  if (dist < 0) return;
  const to = trajectory.path[dist]!;
  if (to === ch.pos) return;
  const from = ch.pos;
  ch.pos = to;
  leaveCell(ctx.world, ctx.level, ctx.depth, from);
  enterCell(ctx.level, to);
  ctx.effects.push({ type: 'pushed', depth: ctx.depth, mob: ch.id, from, to });
  if (collided && collideDamage && isAlive(ch)) {
    const damage = ctx.rng.normalIntRange(dist, 2 * dist);
    ctx.effects.push({ type: 'hurt', depth: ctx.depth, who: ch.id, damage });
    hurt(ctx, ch, damage, 'knockback');
    if (isAlive(ch)) ch.paralysed = Math.max(ch.paralysed ?? 0, Math.round(1 + dist / 2));
  }
  if (closeDoors && ctx.level.map[from] === T.OPEN_DOOR && !charAt(ctx.world, ctx.depth, from)) ctx.level.map[from] = T.DOOR;
  if (isAlive(ch)) occupyCell(ctx, ch);
}

/**
 * Level.occupyCell: whoever comes to stand on a cell by no step of their own presses it — a monster
 * as it would (Level.mobPress), a hero's weight setting off any trap and plant there (a chasm under
 * a hero is the world's to see to: see overChasm).
 */
export function occupyCell(ctx: Ctx, ch: Char): void {
  if (!isHero(ch)) {
    mobPress(ctx, ch);
    return;
  }
  if ((ch.levitating ?? 0) > 0 || hasFlag(ctx.level.map[ch.pos]!, F.PIT)) return;
  if (trapAt(ctx.level.map[ch.pos]!)) triggerTrap(ctx, ch, ch.pos);
  if (ctx.level.map[ch.pos] === T.HIGH_GRASS) trample(ctx, ch.pos, ch);
  stepOnPlant(ctx, ch, ch.pos);
}

/* Living earth */

/**
 * WandOfLivingEarth: the bolt hurts whoever it strikes and gathers that much earthen armour about
 * the hero (shooting at a foe); once the armour is as thick as a guardian needs, it is shaped into
 * one where the bolt lands. With a guardian about, the armour goes to mending it, and zapping the
 * guardian itself mends it.
 */
function livingEarth(z: Zap, bolt: Ballistica): void {
  const { ctx, hero } = z;
  ctx.effects.push({ type: 'zapped', depth: ctx.depth, from: hero.pos, to: bolt.collisionPos, bolt: 'earth' });
  const ch = charAt(ctx.world, ctx.depth, bolt.collisionPos);
  const damage = damageRoll(z);
  let armorToAdd = damage;
  const guardian = findGuardian(ctx);
  // Armour only from a foe (or a mimic biding its time) shot at, or the guardian.
  const foe = ch && !isHero(ch) && (ch.ally ? false : ch.state !== 'passive' || ch.kind === 'mimic');
  if ((!guardian || ch !== guardian) && !foe) {
    armorToAdd = 0;
  } else {
    if (!hero.rockArmor && !guardian) hero.rockArmor = { armor: 0, level: 0 };
    if (hero.rockArmor) addRockArmor(hero, z.level, armorToAdd);
  }
  const armor = hero.rockArmor;
  if (guardian && guardian === ch) {
    guardianInfo(ctx, guardian, hero, z.level, armorToAdd);
    wandProc(ctx, hero, guardian, z.level, 1);
  } else if (!guardian && armor && armor.armor >= armorToGuardian(armor)) {
    // Enough armour: it takes shape as a guardian, beside whoever was struck (nearest the hero), or where the bolt landed.
    let pos = bolt.collisionPos;
    if (ch && isAlive(ch)) {
      wandProc(ctx, hero, ch, z.level, 1);
      strike(z, ch, damage);
      let closest = -1;
      const trueDist = (a: number, b: number): number => (cellX(a) - cellX(b)) ** 2 + (cellY(a) - cellY(b)) ** 2;
      for (const n of NEIGHBOURS9) {
        const c = bolt.collisionPos + n;
        if (hasFlag(ctx.level.map[c]!, F.PASSABLE) && !charAt(ctx.world, ctx.depth, c) && (closest === -1 || trueDist(c, hero.pos) < trueDist(closest, hero.pos))) {
          closest = c;
        }
      }
      if (closest === -1) return;
      pos = closest;
    }
    const made = placeGuardian(ctx, hero, pos, z.level, armor.armor);
    if (ch && isAlive(ch) && !isHero(ch) && (!ch.ally || (ch.amok ?? 0) > 0)) made.foe = ch.id;
    delete hero.rockArmor;
  } else if (ch && isAlive(ch)) {
    wandProc(ctx, hero, ch, z.level, 1);
    strike(z, ch, damage);
    if (guardian) {
      guardianInfo(ctx, guardian, hero, z.level, armorToAdd);
      if (isAlive(ch) && !isHero(ch) && !ch.ally) guardian.foe = ch.id;
    }
  } else {
    pressCell(ctx, bolt.collisionPos);
  }
}

/** RockArmor.armorToGuardian: as much as a guardian of the wand's level needs. */
export const armorToGuardian = (armor: { level: number }): number => 8 + armor.level * 4;

/** RockArmor.addArmor: as strong as the best wand that added to it, and twice what a guardian needs at most. */
export function addRockArmor(hero: Hero, level: number, amount: number): void {
  const armor = (hero.rockArmor ??= { armor: 0, level: 0 });
  armor.level = Math.max(armor.level, level);
  armor.armor = Math.min(armor.armor + amount, 2 * armorToGuardian(armor));
}

/** RockArmor.absorb: the armour takes half of a blow (rounded up), as long as it lasts. */
export function rockArmorAbsorbs(hero: Hero, damage: number): number {
  const armor = hero.rockArmor;
  if (!armor) return damage;
  const block = damage - Math.trunc(damage / 2);
  if (armor.armor <= block) {
    delete hero.rockArmor;
    return damage - armor.armor;
  }
  armor.armor -= block;
  return damage - block;
}

/* Prismatic light */

/**
 * WandOfPrismaticLight: a ray of light that maps the cells along it and around (finding what is
 * hidden there), lights up a dark depth about the hero for a while, and blinds whoever it strikes
 * now and then; demons and the undead take a third more of it.
 */
function prismaticLight(z: Zap, beam: Ballistica): void {
  const { ctx, hero } = z;
  ctx.effects.push({ type: 'zapped', depth: ctx.depth, from: hero.pos, to: beam.collisionPos, bolt: 'light' });
  const open = discoverable(ctx.level.map);
  const explored = exploredCells(ctx.world, ctx.depth);
  for (const c of subPath(beam, 0, beam.dist)) {
    if (!insideMap(c)) continue;
    for (const n of NEIGHBOURS9) {
      const cell = c + n;
      if (open[cell]) explored[cell] = true;
      if (hasFlag(ctx.level.map[cell]!, F.SECRET)) {
        ctx.level.map[cell] = discover(ctx.level.map[cell]!);
        explored[cell] = true;
        ctx.effects.push({ type: 'discovered', depth: ctx.depth, cell });
      }
    }
  }
  const darkness = isChallenged(ctx.world, DARKNESS);
  if (viewDistance(ctx.depth, darkness) < 6) {
    hero.light = Math.max(hero.light, darkness ? 2 + z.level : 10 + z.level * 5);
  }
  const ch = charAt(ctx.world, ctx.depth, beam.collisionPos);
  if (!ch || !isAlive(ch)) return;
  wandProc(ctx, hero, ch, z.level, 1);
  const damage = damageRoll(z);
  // Three in (5 + level) it fails to blind.
  if (ctx.rng.int(5 + z.level) >= 3 && !isImmune(ch, 'blindness')) ch.blind = Math.max(ch.blind ?? 0, Math.round(2 + z.level * 0.333));
  if (hasProp(ch, 'demonic') || hasProp(ch, 'undead')) strike(z, ch, Math.round(f32(damage * f32(1.333))));
  else strike(z, ch, damage);
}

/* Warding */

/** WandOfWarding.tryToZap: the wards' tiers add up to less than two a wand of warding held (and one a level). */
function wardsAllow(ctx: Ctx, hero: Hero, target: number): boolean {
  const { current, max } = wardEnergy(ctx, hero);
  const ch = charAt(ctx.world, ctx.depth, target);
  if (ch && !isHero(ch) && ch.kind === 'ward') return current < max || (ch.ward?.tier ?? 1) > 3;
  return current + 1 <= max;
}

/**
 * WandOfWarding.onZap: a ward where the bolt lands (or just before whoever it struck); zapped at a
 * ward, it grows a tier (or, at the limit, is mended).
 */
function warding(z: Zap, bolt: Ballistica): void {
  const { ctx, hero } = z;
  ctx.effects.push({ type: 'zapped', depth: ctx.depth, from: hero.pos, to: bolt.collisionPos, bolt: 'ward' });
  const note = (): void => {
    ctx.effects.push({ type: 'wand', hero: hero.id, note: 'badLocation', item: z.wand.kind });
  };
  let target = bolt.collisionPos;
  let ch = charAt(ctx.world, ctx.depth, target);
  const isWard = (c: Char | undefined): c is Mob => c !== undefined && !isHero(c) && c.kind === 'ward';
  if (ch && !isWard(ch)) {
    if (bolt.dist > 1) target = bolt.path[bolt.dist - 1]!;
    ch = charAt(ctx.world, ctx.depth, target);
    if (ch && !isWard(ch)) {
      note();
      pressCell(ctx, bolt.collisionPos);
      return;
    }
  }
  if (isWard(ch)) {
    const { current, max } = wardEnergy(ctx, hero);
    if (current < max) upgradeWard(ctx, ch, z.level);
    else allyWandHeal(ctx, ch, z.level, 1);
    return;
  }
  if (!hasFlag(ctx.level.map[target]!, F.PASSABLE)) {
    note();
    pressCell(ctx, target);
    return;
  }
  spawnWard(ctx, target, z.level);
  pressCell(ctx, target);
}

/* Transfusion */

/**
 * WandOfTransfusion: on an ally (or a charmed foe), the hero's own blood heals it, shielding it with
 * what is more than it can hold; on a foe, a shield for the hero, and a charm on the living, harm to
 * the undead.
 */
function transfusion(z: Zap, beam: Ballistica): void {
  const { ctx, hero } = z;
  ctx.effects.push({ type: 'zapped', depth: ctx.depth, from: hero.pos, to: beam.collisionPos, bolt: 'blood' });
  const ch = charAt(ctx.world, ctx.depth, beam.collisionPos);
  if (!ch || isHero(ch) || !isAlive(ch)) return;
  wandProc(ctx, hero, ch, z.level, 1);
  if (ch.ally || (ch.charmed ?? 0) > 0) {
    // Five hundredths of the hero's health.
    const selfDamage = Math.round(hero.ht * 0.05);
    let healing = selfDamage + 3 * z.level;
    const shielding = Math.max(0, ch.hp + healing - ch.ht);
    healing -= shielding;
    if (shielding > 0) {
      shieldUp(ch, shielding);
      ctx.effects.push({ type: 'barrier', depth: ctx.depth, who: ch.id, amount: shielding });
    }
    ch.hp += healing;
    if (healing > 0) ctx.effects.push({ type: 'mobHealed', depth: ctx.depth, mob: ch.id, amount: healing });
    if (!z.wand.freeCharge) {
      ctx.effects.push({ type: 'hurt', depth: ctx.depth, who: hero.id, damage: selfDamage });
      hurt(ctx, hero, selfDamage, 'wand');
    } else {
      delete z.wand.freeCharge;
    }
  } else if (ch.state !== 'passive' || ch.kind === 'mimic') {
    shieldUp(hero, 5 + z.level);
    ctx.effects.push({ type: 'barrier', depth: ctx.depth, who: hero.id, amount: 5 + z.level });
    if (!hasProp(ch, 'undead')) {
      if (!isImmune(ch, 'charm')) {
        ch.charmed = Math.max(ch.charmed ?? 0, CHARM_TURNS / 2);
        ch.charmedBy = hero.id;
        ch.charmFirm = true;
      }
    } else {
      strike(z, ch, damageRoll(z));
    }
  }
}

/* Corruption */

/** WandOfCorruption's debuffs: how bad each is (the minor ones weaken an enemy's resistance less), and how likely when given. */
const MINOR_DEBUFFS = [['weakened', 2], ['vulnerable', 2], ['crippled', 1], ['blind', 1], ['terror', 1]] as const;
const MAJOR_DEBUFFS = [['amok', 3], ['slowed', 2], ['hexed', 2], ['paralysed', 1]] as const;
/** Conditions that count as minor or major debuffs against resistance though the wand never gives them. */
const MINOR_OTHERS = ['chill', 'ooze', 'rooted', 'dizzy', 'bleeding', 'burning', 'poison'] as const;
const MAJOR_OTHERS = ['charmed', 'soulMarked', 'frozen'] as const;

/**
 * WandOfCorruption: a foe weak enough is corrupted — healed, rid of its ailments, and fighting for
 * the heroes until it wastes away (its loot and experience given up at once); one too strong gets a
 * debuff instead, a major one the likelier the closer it came. Bosses cannot be corrupted: they are
 * doomed instead.
 */
function corruption(z: Zap, bolt: Ballistica): void {
  const { ctx, hero } = z;
  ctx.effects.push({ type: 'zapped', depth: ctx.depth, from: hero.pos, to: bolt.collisionPos, bolt: 'corruption' });
  const ch = charAt(ctx.world, ctx.depth, bolt.collisionPos);
  if (!ch || !isAlive(ch)) {
    pressCell(ctx, bolt.collisionPos);
    return;
  }
  if (isHero(ch)) return;
  // The harmless (quest givers, shopkeepers, sheep) are beyond the wand: only Mobs that fight count.
  if (ch.state === 'passive' && ch.kind !== 'mimic' && ch.kind !== 'bee') {
    wandProc(ctx, hero, ch, z.level, 1);
    return;
  }
  const enemy = ch;
  let power = 3 + z.level / 3;
  const depth = ctx.depth;
  let resist: number;
  if (enemy.kind === 'mimic' || enemy.kind === 'statue') resist = 1 + depth;
  else if (enemy.kind === 'piranha' || enemy.kind === 'bee') resist = 1 + depth / 2;
  // Wraiths are always whole, five times as hard to corrupt.
  else if (enemy.kind === 'wraith') resist = (1 + depth / 4) / 5;
  else if (enemy.kind === 'swarm') resist = 1 + (mobStats(enemy).exp > 0 && !(enemy.generation ?? 0) ? mobStats(enemy).exp : 3);
  else resist = 1 + mobStats(enemy).exp;
  // Whole: five times; at 3/4: 3.25; at 1/2: twice; at 1/4: 1.25.
  resist *= 1 + 4 * (enemy.hp / enemy.ht) ** 2;
  for (const [key] of MAJOR_DEBUFFS) if (debuffed(enemy, key)) resist *= 0.5;
  for (const key of MAJOR_OTHERS) if (debuffed(enemy, key)) resist *= 0.5;
  if (enemy.corrosion) resist *= 0.5;
  if (enemy.doomed) resist *= 0.5;
  for (const [key] of MINOR_DEBUFFS) if (debuffed(enemy, key)) resist *= 0.75;
  for (const key of MINOR_OTHERS) if (debuffed(enemy, key)) resist *= 0.75;
  // A monster already corrupted or doomed cannot be again: a major debuff instead.
  if (enemy.corrupted || enemy.doomed) power = resist - 0.001;
  if (power > resist) corruptEnemy(z, enemy);
  else if (ctx.rng.float() < power / resist) debuffEnemy(z, enemy, 'major');
  else debuffEnemy(z, enemy, 'minor');
  wandProc(ctx, hero, ch, z.level, 1);
}

function debuffed(mob: Mob, key: string): boolean {
  const value = (mob as unknown as Record<string, unknown>)[key];
  return typeof value === 'number' ? value > 0 : !!value;
}

/** WandOfCorruption.debuffEnemy: one of the category's debuffs it has not got and is not immune to; none left, the next category. */
function debuffEnemy(z: Zap, enemy: Mob, category: 'minor' | 'major'): void {
  const table = category === 'minor' ? MINOR_DEBUFFS : MAJOR_DEBUFFS;
  const harm = { weakened: 'weakened', vulnerable: 'vulnerable', crippled: 'crippled', blind: 'blindness', terror: 'terror', amok: 'amok',
    slowed: 'slow', hexed: 'hexed', paralysed: 'paralysis' } as const;
  const chances = table.map(([key, chance]) => (debuffed(enemy, key) || isImmune(enemy, harm[key] as never) ? 0 : chance));
  if (chances.every((c) => c <= 0)) {
    if (category === 'minor') debuffEnemy(z, enemy, 'major');
    else corruptEnemy(z, enemy);
    return;
  }
  const key = table[z.ctx.rng.chances(chances)]![0];
  const turns = 6 + z.level * 3;
  if (key === 'terror') {
    enemy.terror = turns;
    enemy.terrorOf = z.hero.id;
  } else if (key === 'amok') {
    enemy.amok = turns;
    if (enemy.state === 'sleeping') enemy.state = 'hunting';
  } else {
    (enemy as unknown as Record<string, number>)[key] = turns;
  }
  z.ctx.effects.push({ type: 'debuffed', depth: z.ctx.depth, mob: enemy.id, debuff: key });
}

/** WandOfCorruption.corruptEnemy: corrupted (AllyBuff.affectAndLoot), or doomed if it cannot be. */
function corruptEnemy(z: Zap, enemy: Mob): void {
  const { ctx, hero } = z;
  if (enemy.corrupted || enemy.doomed) {
    ctx.effects.push({ type: 'wand', hero: hero.id, note: 'alreadyCorrupted', item: z.wand.kind });
    return;
  }
  if (isImmune(enemy, 'corruption')) {
    enemy.doomed = true;
    ctx.effects.push({ type: 'ally', depth: ctx.depth, mob: enemy.id, event: 'doomed' });
    return;
  }
  corruptionHeal(enemy);
  const wasEnemy = !enemy.ally;
  enemy.ally = true;
  enemy.corrupted = true;
  delete enemy.foe;
  enemy.enemy = null;
  enemy.state = enemy.state === 'sleeping' || enemy.state === 'passive' ? 'wandering' : enemy.state;
  if (enemy.kind === 'mimic') enemy.state = 'hunting';
  ctx.effects.push({ type: 'ally', depth: ctx.depth, mob: enemy.id, event: 'corrupted' });
  // AllyBuff.affectAndLoot: what it would have left and taught on dying, now.
  if (wasEnemy) lootAndExp(ctx, enemy, hero);
  // No one fights it for what it was any more.
  for (const other of ctx.floor.mobs) if (other.foe === enemy.id && other.ally) delete other.foe;
}

/* Battlemage: the staff's blows (Wand.onHit) */

/**
 * MagesStaff.proc for a battlemage: a blow with the staff gives its wand half a charge (if not full)
 * and does what the wand does on a hit.
 */
export function staffBlow(ctx: Ctx, hero: Hero, staff: Item, defender: Char, damage: number): (() => void) | undefined {
  const wand = staff.wand;
  if (!wand || hero.subclass !== 'battlemage') return undefined;
  if ((wand.charges ?? 0) < maxCharges(wand, staff)) wand.partial = (wand.partial ?? 0) + 0.5;
  const after = onHit(ctx, hero, staff, wand, defender, damage);
  return after;
}

/** Wand.procChanceMultiplier (seam for the talents stream: empowered strike raises it). */
const procChanceMultiplier = (hero: Hero): number => wandProcMultiplier(hero);

/** Wand.onHit of each kind; what must wait until the blow has landed comes back, to be done then. */
function onHit(ctx: Ctx, hero: Hero, staff: Item, wand: Item, defender: Char, damage: number): (() => void) | undefined {
  const { rng } = ctx;
  const level = buffedLevel(hero, wand, staff);
  const multi = procChanceMultiplier(hero);
  switch (wand.kind) {
    case 'wand.magicMissile':
      // Half a charge for every other wand.
      for (const { wand: other, staff: inStaff } of heldWands(hero)) if (other !== wand) gainCharge(other, inStaff, 0.5 * multi);
      return undefined;
    case 'wand.lightning': {
      // 25% at +0, 40% at +1, 50% at +2...: a lightning charge for ten turns.
      const chance = f32(f32((level + 1) / (level + 4)) * multi);
      if (rng.float() < chance) {
        hero.lightningCharge = Math.max(hero.lightningCharge ?? 0, Math.max(1, chance) * 10);
        ctx.effects.push({ type: 'zapped', depth: ctx.depth, from: hero.pos, to: hero.pos, bolt: 'lightning' });
      }
      return undefined;
    }
    case 'wand.fireblast': {
      // A quarter a burning creature in the 3x3 around the target, a twentieth a burning cell: an explosion of the fire.
      let chance = 0;
      for (const n of NEIGHBOURS9) {
        const ch = charAt(ctx.world, ctx.depth, defender.pos + n);
        if (ch && (ch.burning ?? 0) > 0) chance += 0.25;
        else if (gasAt(ctx.floor, 'fire', defender.pos + n) > 0) chance += 0.05;
      }
      chance = Math.min(1, chance) * multi;
      if (rng.float() >= chance) return undefined;
      const power = Math.max(1, chance);
      if (!ctx.floor.gas?.fire) return undefined;
      ctx.effects.push({ type: 'blast', depth: ctx.depth, pos: defender.pos, radius: 1 });
      for (const n of NEIGHBOURS9) {
        const cell = defender.pos + n;
        if (gasAt(ctx.floor, 'fire', cell) > 0) {
          destroyCell(ctx, cell);
          clearGasAt(ctx.floor, 'fire', cell);
        }
        const ch = charAt(ctx.world, ctx.depth, cell);
        if (!ch || !isAlive(ch)) continue;
        ch.burning = 0;
        if (!isHero(ch) && !ch.ally && ch.state !== 'passive') {
          const dmg = Math.round(power * heroDamageIntRange(ctx, 2 + 2 * level, 8 + 4 * level));
          ctx.effects.push({ type: 'hurt', depth: ctx.depth, who: ch.id, damage: dmg });
          hurt(ctx, ch, dmg, hero);
        }
      }
      return undefined;
    }
    case 'wand.corrosion': {
      // 33% at +0, 50% at +1, 60% at +2: ooze.
      const chance = f32(f32((level + 1) / (level + 3)) * multi);
      if (rng.float() < chance) ooze(defender, OOZE_TURNS * Math.max(1, chance));
      return undefined;
    }
    case 'wand.blastWave':
      // On a paralysed foe (not again for three turns): the paralysis broken by a blast.
      if (!isHero(defender) && (defender.paralysed ?? 0) > 0 && !(defender.blasted ?? 0)) {
        defender.paralysed = 0;
        const dmg = Math.round(multi * heroDamageIntRange(ctx, 8 + 2 * level, 12 + 3 * level));
        ctx.effects.push({ type: 'blast', depth: ctx.depth, pos: defender.pos, radius: 1 });
        ctx.effects.push({ type: 'hurt', depth: ctx.depth, who: defender.id, damage: dmg });
        hurt(ctx, defender, dmg, hero);
        defender.blasted = 3;
      }
      return undefined;
    case 'wand.livingEarth': {
      // A third of the blow to the guardian, or to the hero's armour.
      const armor = Math.round(damage * 0.33 * multi);
      const guardian = findGuardian(ctx);
      if (guardian) guardianInfo(ctx, guardian, hero, level, armor);
      else addRockArmor(hero, level, armor);
      return undefined;
    }
    case 'wand.frost': {
      // 1/9 at two turns of chill, up to 9/9 at ten: frozen solid, once the blow is done (it would thaw it).
      if (!(defender.chill ?? 0)) return undefined;
      const chance = f32(((Math.floor(defender.chill!) - 1) / 9) * multi);
      if (rng.float() >= chance) return undefined;
      return () => {
        if (isAlive(defender)) freeze(ctx, defender, Math.round(FROST_TURNS * Math.max(1, chance)));
      };
    }
    case 'wand.prismaticLight':
      // Cripples.
      defender.crippled = Math.max(defender.crippled ?? 0, Math.round((1 + effectiveLevel(staff)) * multi));
      return undefined;
    case 'wand.warding': {
      // 20% at +0, 33% at +1, 43% at +2: every ward is mended.
      const lvl = Math.max(0, effectiveLevel(staff));
      const chance = f32(f32((lvl + 1) / (lvl + 5)) * multi);
      if (rng.float() >= chance) return undefined;
      for (const ward of ctx.floor.mobs.filter((m) => m.kind === 'ward')) allyWandHeal(ctx, ward, effectiveLevel(staff), Math.max(1, chance));
      return undefined;
    }
    case 'wand.transfusion':
      // A charmed foe struck by its charmer: a free transfusion, and a shield.
      if (!isHero(defender) && (defender.charmed ?? 0) > 0 && defender.charmedBy === hero.id) {
        wand.freeCharge = true;
        const shield = Math.round(2 * (5 + level) * multi);
        shieldUp(hero, shield);
        ctx.effects.push({ type: 'barrier', depth: ctx.depth, who: hero.id, amount: shield });
        ctx.effects.push({ type: 'wand', hero: hero.id, note: 'charged', item: wand.kind });
      }
      return undefined;
    case 'wand.corruption': {
      // 16% at +0, 28.5% at +1, 37.5% at +2: amok.
      const lvl = Math.max(0, level);
      const chance = f32(f32((lvl + 1) / (lvl + 6)) * multi);
      if (rng.float() < chance && !isHero(defender)) defender.amok = Math.max(defender.amok ?? 0, Math.round((4 + lvl * 2) * Math.max(1, chance)));
      return undefined;
    }
    case 'wand.regrowth': {
      // In grass: a share of the blow back as health over time (Sungrass.Health).
      const grassy = (cell: number): boolean => ctx.level.map[cell] === T.GRASS || ctx.level.map[cell] === T.HIGH_GRASS;
      if (!grassy(hero.pos) && !grassy(defender.pos)) return undefined;
      const lvl = Math.max(0, effectiveLevel(staff));
      const healing = Math.round(Math.round(damage * f32(f32((lvl + 2) / (lvl + 6)) / 2)) * multi);
      if (healing > 0) {
        // Sungrass.Health.boost: more to come back, while the hero stays where they stand.
        const herbal = (hero.herbal ??= { level: 0, pos: hero.pos, partial: 0 });
        herbal.level += healing;
        herbal.pos = hero.pos;
      }
      return undefined;
    }
    default:
      // Disintegration: no effect on a hit, but the staff reaches a cell further (see staffReach).
      return undefined;
  }
}

/** MagesStaff.reachFactor: a battlemage's staff of disintegration reaches a cell further. */
export const staffReach = (hero: Hero): number =>
  hero.subclass === 'battlemage' && hero.weapon?.kind === 'weapon.magesStaff' && hero.weapon.wand?.kind === 'wand.disintegration' ? 2 : 1;

/* Charging (Wand.Charger) and identification over time */

/** Every wand the hero holds, and the staff it is in if it is: those in the pack, and the staff's in hand or in the pack. */
export function heldWands(hero: Hero): Array<{ wand: Item; staff: Item | null }> {
  const wands: Array<{ wand: Item; staff: Item | null }> = [];
  for (const item of [hero.weapon, ...hero.items]) {
    if (!item) continue;
    if (item.kind === 'weapon.magesStaff' && item.wand) wands.push({ wand: item.wand, staff: item });
    else if (itemDef(item.kind).category === 'wand') wands.push({ wand: item, staff: null });
  }
  return wands;
}

/** Wand.Charger.BASE_CHARGE_DELAY, SCALING_CHARGE_ADDITION and the scale factors (the staff's and the holster's quicker). */
const BASE_CHARGE_DELAY = 10;
const SCALING_CHARGE_ADDITION = 40;
const NORMAL_SCALE_FACTOR = f32(0.875);
const HOLSTER_SCALE_FACTOR = f32(0.85);
const STAFF_SCALE_FACTOR = f32(0.75);
/** Wand.Charger.CHARGE_BUFF_BONUS: a quarter of a charge a turn under Recharging. */
const CHARGE_BUFF_BONUS = 0.25;

/**
 * Wand.Charger.act, `ticks` times: a wand short of charges gathers a share of one every turn, the
 * bigger the more it lacks (ten turns plus forty times 0.875 to the power of what it lacks), a
 * quarter of one more under Recharging; full, it gathers nothing; rings of energy speed it up
 * (RingOfEnergy.wandChargeMultiplier). Seam for the other streams: a locked boss floor would stop it
 * (Regeneration.regenOn).
 */
export function chargeWands(hero: Hero, ticks: number, inHolster: (item: Item) => boolean): void {
  for (let t = 0; t < ticks; t++) {
    for (const { wand, staff } of heldWands(hero)) {
      const max = maxCharges(wand, staff);
      const charges = wand.charges ?? 0;
      if (charges < max) {
        const scale = staff ? STAFF_SCALE_FACTOR : inHolster(wand) ? HOLSTER_SCALE_FACTOR : NORMAL_SCALE_FACTOR;
        const turns = f32(BASE_CHARGE_DELAY + SCALING_CHARGE_ADDITION * powi(scale, max - charges));
        wand.partial = f32((wand.partial ?? 0) + f32(f32(1 / turns) * wandChargeMultiplier(hero)));
        if ((hero.recharging ?? 0) > 0) wand.partial = f32(wand.partial + CHARGE_BUFF_BONUS * Math.min(1, hero.recharging!));
      }
      while ((wand.partial ?? 0) >= 1 && (wand.charges ?? 0) < max) {
        wand.partial! -= 1;
        wand.charges = (wand.charges ?? 0) + 1;
      }
      if ((wand.charges ?? 0) >= max) wand.partial = 0;
    }
  }
}

/** Wand.gainCharge (and MagesStaff.gainCharge): a share of a charge, up to the most it holds. */
export function gainCharge(wand: Item, staff: Item | null, amount: number): void {
  const max = maxCharges(wand, staff);
  wand.partial = f32((wand.partial ?? 0) + amount);
  while (wand.partial >= 1) {
    wand.charges = Math.min(max, (wand.charges ?? 0) + 1);
    wand.partial -= 1;
  }
}

/** ScrollOfRecharging.charge's buff (Recharging.DURATION). */
export const RECHARGING_TURNS = 30;

/**
 * Wand.onHeroGainExp: with every level's worth of experience the hero gains, a wand not yet known
 * may count five more zaps towards knowing it (no more than five waiting).
 */
export function wandsGainExp(hero: Hero, share: number): void {
  for (const { wand } of heldWands(hero)) {
    if (!wand.levelUnknown && !wand.curseUnknown && !wand.chargesUnknown) continue;
    const available = wand.availableUsesToID ?? WAND_USES_TO_ID / 2;
    const gain = f32(share * idSpeedFactor(hero, wand));
    if (available <= WAND_USES_TO_ID / 2) wand.availableUsesToID = Math.min(WAND_USES_TO_ID / 2, f32(available + f32(f32(gain * WAND_USES_TO_ID) / 2)));
  }
}

export { CHARM_TURNS };
