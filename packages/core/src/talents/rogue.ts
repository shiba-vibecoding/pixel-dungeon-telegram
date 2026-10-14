import { type Hero, heroDamageRoll, isAlive, type Mob } from '../actors';
import { createItem } from '../items';
import type { Floor } from '../floor';
import type { Level } from '../level/generate';
import { RoomType } from '../level/room';
import { T } from '../level/terrain';
import { deriveSeed, Rng, Stream } from '../rng';
import type { World } from '../world';
import { isInvisible } from '../artifacts';
import type { Ctx } from '../floor';
import { isBoss, isMiniboss } from '../buffs';
import { enterCell, leaveCell, charAt, isPassable } from '../floor';
import { adjacent, distance, LENGTH, NEIGHBOURS8, WIDTH } from '../level/geometry';
import { F, hasFlag } from '../level/terrain';
import { flies } from '../status';
import { pointsInTalent } from './data';
import { tbOf } from './state';
import { occupyCell } from '../wands';

/*
 * The rogue's subclasses: Momentum (the freerunner, actors/buffs/Momentum.java) and Preparation (the assassin,
 * actors/buffs/Preparation.java).
 */

const f32 = Math.fround;

/* Momentum */

/** The freerunner's buff, once there is one. */
export const momentumOf = (hero: Hero) => (hero.subclass === 'freerunner' ? hero.tal?.momentum : undefined);

/** Momentum.freerunning. */
export const freerunning = (hero: Hero): boolean => (momentumOf(hero)?.freerunTurns ?? 0) > 0;

/** Momentum.gainStack: a step taken, or a swap with an ally (Hero.actMove, Char.interact). */
export function gainMomentum(hero: Hero): void {
  if (hero.subclass !== 'freerunner') return;
  const b = tbOf(hero);
  const m = (b.momentum ??= { stacks: 0, freerunTurns: 0, freerunCooldown: 0, movedLastTurn: true });
  m.movedLastTurn = true;
  if (m.freerunCooldown <= 0 && m.freerunTurns <= 0) m.stacks = Math.min(m.stacks + 1, 10);
}

/** Momentum.speedMultiplier: twice as fast freerunning, and unseen with the best speedy stealth. */
export function momentumSpeed(hero: Hero): number {
  if (freerunning(hero)) return 2;
  if (hero.subclass === 'freerunner' && isInvisible(hero) && pointsInTalent(hero, 'speedy_stealth') === 3) return 2;
  return 1;
}

/** Momentum.evasionBonus: freerunning, half the hero's level more evasion, and evasive armor's share of spare strength. */
export function momentumEvasion(hero: Hero, excessArmorStr: number): number {
  if (!freerunning(hero)) return 0;
  return Math.trunc(hero.lvl / 2) + excessArmorStr * pointsInTalent(hero, 'evasive_armor');
}

/** Momentum.act, a turn's worth. */
export function momentumTurn(hero: Hero): void {
  const m = momentumOf(hero);
  if (!m) return;
  if (m.freerunCooldown > 0) m.freerunCooldown--;
  if (m.freerunCooldown === 0 && m.freerunTurns <= 0 && isInvisible(hero) && pointsInTalent(hero, 'speedy_stealth') >= 1) {
    m.stacks = Math.min(m.stacks + 2, 10);
    m.movedLastTurn = true;
  }
  if (m.freerunTurns > 0) {
    if (!isInvisible(hero) || pointsInTalent(hero, 'speedy_stealth') < 2) m.freerunTurns--;
  } else if (!m.movedLastTurn) {
    // GameMath.gate(0, stacks - 1, round(stacks * 0.667)): a stop costs a third at least.
    m.stacks = Math.min(Math.max(0, m.stacks - 1), Math.round(f32(m.stacks * f32(0.667))));
  }
  m.movedLastTurn = false;
  if (m.stacks <= 0 && m.freerunTurns <= 0 && m.freerunCooldown <= 0) delete hero.tal!.momentum;
}

/** Momentum.doAction: spend the stacks on two turns of freerunning each. */
export function freerunProblem(hero: Hero): string | null {
  const m = momentumOf(hero);
  return m && m.stacks > 0 && m.freerunTurns <= 0 ? null : 'no momentum';
}

export function doFreerun(ctx: Ctx, hero: Hero): void {
  const m = momentumOf(hero)!;
  m.freerunTurns = 2 * m.stacks;
  // The cooldown is functionally 10 + 2 a stack once the run ends.
  m.freerunCooldown = 10 + 4 * m.stacks;
  ctx.effects.push({ type: 'freerun', hero: hero.id, stacks: m.stacks });
  m.stacks = 0;
}

/* Preparation */

/** Preparation.AttackLevel: invisible this many turns, the bonus, how many damage rolls it takes the best of. */
const LEVELS = [
  { turns: 1, bonus: 0.1, rolls: 1 },
  { turns: 3, bonus: 0.2, rolls: 1 },
  { turns: 5, bonus: 0.35, rolls: 2 },
  { turns: 9, bonus: 0.5, rolls: 3 },
] as const;

/** First index prep level, second talent level. */
const KO_THRESHOLDS = [
  [0.03, 0.04, 0.05, 0.06],
  [0.1, 0.13, 0.17, 0.2],
  [0.2, 0.27, 0.33, 0.4],
  [0.5, 0.67, 0.83, 1],
] as const;
const BLINK_RANGES = [
  [1, 1, 2, 2],
  [2, 3, 4, 5],
  [3, 4, 6, 7],
  [4, 6, 8, 10],
] as const;

/** Preparation.AttackLevel.getLvl: 0 to 3 for the turns spent unseen. */
export function prepLevel(turnsInvis: number): number {
  let level = 0;
  for (let i = 0; i < LEVELS.length; i++) if (turnsInvis >= LEVELS[i]!.turns) level = i;
  return level;
}

/** The turns the assassin has spent unseen (the buff is there while they are unseen). */
export const prepTurns = (hero: Hero): number | undefined => (hero.subclass === 'assassin' ? hero.tal?.prep : undefined);

/** Preparation.act, a turn's worth: another turn unseen, or the buff is gone. */
export function preparationTurn(hero: Hero): void {
  if (hero.subclass !== 'assassin') return;
  const b = tbOf(hero);
  if (isInvisible(hero)) b.prep = (b.prep ?? 0) + 1;
  else delete b.prep;
}

export const koThreshold = (hero: Hero, level: number): number => KO_THRESHOLDS[level]![pointsInTalent(hero, 'enhanced_lethality')]!;
export const blinkDistance = (hero: Hero, level: number): number => BLINK_RANGES[level]![pointsInTalent(hero, 'assassins_reach')]!;
export const prepBonus = (level: number): number => LEVELS[level]!.bonus;

/** Preparation.damageRoll: the best of one to three rolls, plus the level's bonus. */
export function prepDamageRoll(hero: Hero, rng: Rng, level: number, roll: () => number): number {
  let dmg = roll();
  for (let i = 1; i < LEVELS[level]!.rolls; i++) dmg = Math.max(dmg, roll());
  return Math.round(f32(dmg * f32(1 + LEVELS[level]!.bonus)));
}

/** Preparation.canKO: below the level's share of health (a fifth of it for bosses). */
export function canKO(hero: Hero, level: number, defender: Mob): boolean {
  const share = defender.hp / defender.ht;
  return isBoss(defender) || isMiniboss(defender) ? share < koThreshold(hero, level) / 5 : share < koThreshold(hero, level);
}

/** The roll for a prepared strike with the hero's own damage. */
export const preparedDamage = (hero: Hero, rng: Rng, level: number, weapon: Hero['weapon'], surprised: boolean): number =>
  prepDamageRoll(hero, rng, level, () => heroDamageRoll(hero, rng, surprised, weapon));

/** Preparation's prompt: how far the hero may blink to a target now. */
export function ambushRange(hero: Hero): number {
  const turns = prepTurns(hero);
  return turns === undefined ? 0 : blinkDistance(hero, prepLevel(turns));
}

/** Why a prepared strike cannot be made at that target. */
export function ambushProblem(ctx: Ctx, hero: Hero, targetId: string): string | null {
  const turns = prepTurns(hero);
  if (turns === undefined || !isInvisible(hero)) return 'not prepared';
  const mob = ctx.floor.mobs.find((m) => m.id === targetId);
  if (!mob || !isAlive(mob) || mob.state === 'passive' || mob.ally) return 'tal:preparation.no_target';
  if (hero.charmed > 0 && hero.charmedBy === mob.id) return 'tal:preparation.no_target';
  if (adjacent(hero.pos, mob.pos)) return null;
  return blinkCell(ctx, hero, mob) === -1 ? 'tal:preparation.out_of_reach' : null;
}

/**
 * Preparation.attack listener: the cell beside the target the hero can reach within the blink distance (over passable
 * or avoided ground, not through walls, and not into an occupied cell): the nearest by steps, then in a straight line.
 */
function blinkCell(ctx: Ctx, hero: Hero, mob: Mob): number {
  const range = ambushRange(hero);
  if (range <= 0 || hero.rooted > 0) return -1;
  const dist = new Map<number, number>([[hero.pos, 0]]);
  const queue = [hero.pos];
  for (let head = 0; head < queue.length; head++) {
    const cell = queue[head]!;
    const d = dist.get(cell)!;
    if (d >= range) continue;
    for (const n of NEIGHBOURS8) {
      const next = cell + n;
      if (next < 0 || next >= LENGTH || dist.has(next) || !adjacent(cell, next)) continue;
      if (!isPassable(ctx.level, next) && !hasFlag(ctx.level.map[next]!, F.AVOID)) continue;
      dist.set(next, d + 1);
      queue.push(next);
    }
  }
  // Level.trueDistance, compared by its square (no floating square root in the rules).
  const trueDistance = (a: number, b: number): number => ((a % WIDTH) - (b % WIDTH)) ** 2 + (Math.trunc(a / WIDTH) - Math.trunc(b / WIDTH)) ** 2;
  let dest = -1;
  for (const n of NEIGHBOURS8) {
    const cell = mob.pos + n;
    if (!dist.has(cell) || !adjacent(mob.pos, cell) || charAt(ctx.world, ctx.depth, cell)) continue;
    if (!isPassable(ctx.level, cell) && !(flies(hero) && hasFlag(ctx.level.map[cell]!, F.AVOID))) continue;
    if (dest === -1 || dist.get(dest)! > dist.get(cell)!) dest = cell;
    else if (dist.get(dest) === dist.get(cell) && trueDistance(hero.pos, dest) > trueDistance(hero.pos, cell)) dest = cell;
  }
  return dest;
}

/** Preparation.attack: blink beside the target (if not there already); the attack that follows is the caller's. */
export function ambush(ctx: Ctx, hero: Hero, mob: Mob): void {
  if (adjacent(hero.pos, mob.pos)) return;
  const dest = blinkCell(ctx, hero, mob);
  const from = hero.pos;
  hero.pos = dest;
  leaveCell(ctx.world, ctx.level, ctx.depth, from);
  enterCell(ctx.level, dest);
  ctx.effects.push({ type: 'blinked', depth: ctx.depth, who: hero.id, from, to: dest });
  occupyCell(ctx, hero);
}

export { distance };

/* Level-making talents (RegularLevel.createItems, GameScene.create) */

/** The special rooms an item may be left in (RegularLevel.randomDropCell(SpecialRoom.class), not a shop). */
const SPECIAL_ROOMS: ReadonlySet<RoomType> = new Set([
  RoomType.TREASURY, RoomType.ARMORY, RoomType.LIBRARY, RoomType.LABORATORY, RoomType.VAULT, RoomType.TRAPS, RoomType.STORAGE,
  RoomType.MAGIC_WELL, RoomType.GARDEN, RoomType.CRYPT, RoomType.STATUE, RoomType.POOL, RoomType.ALTAR, RoomType.WEAK_FLOOR,
]);

/**
 * RegularLevel.createItems: cached rations. Rogues with the talent find a supply ration in a chest in a special room on
 * floors 2/4/7, up to 2/3 at +1/+2 (more if they are behind). Two of the count are used up at a time.
 */
export function layCachedRations(world: World, level: Level, floor: Floor, rng: Rng): void {
  const hero = world.heroes.find((h) => pointsInTalent(h, 'cached_rations') > 0);
  if (!hero || level.depth <= 1) return;
  const b = tbOf(hero);
  const dropped = b.rations ?? 0;
  let targetFloor = 2 + dropped;
  if (dropped > 4) targetFloor++;
  if (level.depth < targetFloor || dropped >= 2 + 2 * pointsInTalent(hero, 'cached_rations')) return;
  const rooms = level.rooms.filter((room) => SPECIAL_ROOMS.has(room.type));
  for (let tries = 0; tries < 100 && rooms.length > 0; tries++) {
    const room = rng.element(rooms)!;
    const pos = rng.intBetween(room.left + 1, room.right) + rng.intBetween(room.top + 1, room.bottom) * WIDTH;
    const terrain = level.map[pos]!;
    if (!isPassable(level, pos) || terrain === T.EMPTY_SP || terrain === T.WATER || terrain === T.PEDESTAL) continue;
    if (floor.heaps.some((heap) => heap.pos === pos)) continue;
    if (terrain === T.HIGH_GRASS) level.map[pos] = T.GRASS;
    floor.heaps.push({ pos, kind: 'chest', items: [createItem('food.supply')] });
    b.rations = dropped + 2;
    return;
  }
}

/** Rogue's foresight: a hint, on arriving, that a secret room lies on the level (75%, 100% at +2; the same every visit). SEAM(levels). */
export function foresightHint(ctx: Ctx, hero: Hero): void {
  const points = pointsInTalent(hero, 'rogues_foresight');
  if (points <= 0 || ctx.world.mode === 'arena') return;
  // GameScene.create: one secret room is needed (two on a level with the secrets feeling); none exist in this build yet.
  const secrets = (ctx.level.rooms as Array<{ secret?: boolean }>).filter((room) => room.secret).length;
  if (secrets < 1) return;
  const rng = Rng.seeded(deriveSeed(ctx.world.run.seed, Stream.LAYOUT, ctx.depth, 77));
  if (rng.int(4) < 2 + points) ctx.effects.push({ type: 'tmsg', hero: hero.id, key: 'rogues_foresight.hint', tone: 'p' });
}
