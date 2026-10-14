import { type Hero, isAlive, type Mob, type MobKind } from '../actors';
import { charAt, type Char, type Ctx, enterCell, type Floor, freeCellNear, heroesOn, isHero, isPassable, leaveCell, observe } from '../floor';
import { type Ballistica } from '../ballistica';
import { LENGTH, trueDistance as cellTrueDistance, WIDTH } from '../level/geometry';
import { F, hasFlag } from '../level/terrain';
import type { Rng } from '../rng';
import type { BossFloor, BossMob, Timed } from './state';
import { ghostSeesBoss } from '../artifacts/rose';

/*
 * What every boss fight shares: Level.seal and unseal, the boss health bar,
 * the bosses' yells and warnings (as effects for the client), the buffs they
 * leave on the floor's clock, Patch.generate for their levels, and the few
 * movements they use (ScrollOfTeleportation.appear, WandOfBlastWave.throwChar).
 */

/** The bosses (Property.BOSS) whose fights seal their floor. */
export const BOSS_KINDS: ReadonlySet<MobKind> = new Set<MobKind>(['goo', 'tengu', 'dm300', 'king', 'yog']);
/** YogFist's six kinds. */
export const FIST_KINDS: ReadonlySet<MobKind> = new Set<MobKind>(['burningFist', 'soiledFist', 'rottingFist', 'rustedFist', 'brightFist', 'darkFist']);
export const isFist = (mob: { kind: MobKind }): boolean => FIST_KINDS.has(mob.kind);

/** PathFinder's neighbourhoods on our grid. */
export const N4: readonly number[] = [-WIDTH, -1, +1, +WIDTH];
export const N8: readonly number[] = [-WIDTH - 1, -WIDTH, -WIDTH + 1, -1, +1, +WIDTH - 1, +WIDTH, +WIDTH + 1];
export const N9: readonly number[] = [-WIDTH - 1, -WIDTH, -WIDTH + 1, -1, 0, +1, +WIDTH - 1, +WIDTH, +WIDTH + 1];
/** PathFinder.CIRCLE8: the neighbours clockwise from the top left. */
export const CIRCLE8: readonly number[] = [-WIDTH - 1, -WIDTH, -WIDTH + 1, +1, +WIDTH + 1, +WIDTH, +WIDTH - 1, -1];

const f32 = Math.fround;

/** Random.NormalFloat(min, max). */
export function normalFloat(rng: Rng, min: number, max: number): number {
  return f32(min + f32(f32(rng.floatMax(f32(max - min)) + rng.floatMax(f32(max - min))) / 2));
}

/** Level.trueDistance, a float as Shattered's is (geometry.ts: the square root, rounded the same everywhere). */
export const trueDistance = (a: number, b: number): number => f32(cellTrueDistance(a, b));

/** Level.insideMap. */
export const insideMap = (cell: number): boolean =>
  cell >= WIDTH && cell < LENGTH - WIDTH && cell % WIDTH !== 0 && cell % WIDTH !== WIDTH - 1;

export const isSolid = (ctx: Pick<Ctx, 'level'>, cell: number): boolean =>
  cell < 0 || cell >= LENGTH || hasFlag(ctx.level.map[cell]!, F.SOLID);

/** The floor's boss state, made on first use. */
export function bossFloor(floor: Floor): BossFloor {
  return (floor.boss ??= { timed: [] });
}

/** A mob's boss state, made on first use. */
export function bossMob(mob: Mob): BossMob {
  return (mob.boss ??= {});
}

/** The boss of a kind on the depth, if it is there. */
export function findMob(ctx: Ctx, kind: MobKind): Mob | undefined {
  return ctx.floor.mobs.find((mob) => mob.kind === kind && isAlive(mob));
}

/** Dungeon.hero: the hero a boss's abilities aim at (the first living hero on the depth; the boss's enemy if it has one). */
export function theHero(ctx: Ctx, mob?: Mob): Hero | undefined {
  const heroes = heroesOn(ctx.world, ctx.depth);
  return heroes.find((hero) => hero.id === mob?.enemy) ?? heroes[0];
}

/* Level.seal and unseal; the boss health bar */

/** Level.seal: the floor is locked (the heroes' LockedFloor). The levels' own seal() does the rest. */
export function lockFloor(ctx: Ctx): boolean {
  const boss = bossFloor(ctx.floor);
  if (boss.locked) return false;
  boss.locked = true;
  return true;
}

/** Level.unseal. */
export function unlockFloor(ctx: Ctx): boolean {
  const boss = bossFloor(ctx.floor);
  if (!boss.locked) return false;
  boss.locked = false;
  return true;
}

/** BossHealthBar.assignBoss; false if a boss was assigned already. */
export function assignBar(ctx: Ctx, mob: Mob): boolean {
  const boss = bossFloor(ctx.floor);
  if (boss.bar !== undefined && ctx.floor.mobs.some((m) => m.id === boss.bar && isAlive(m))) return false;
  if (boss.bar === mob.id) return false;
  boss.bar = mob.id;
  return true;
}

export const barAssigned = (ctx: Ctx): boolean => bossFloor(ctx.floor).bar !== undefined;

/** BossHealthBar.bleed: the boss's last stand (the music's finale). */
export function bleed(ctx: Ctx, mob: Mob, on: boolean): void {
  const boss = bossFloor(ctx.floor);
  if ((boss.bleed ?? false) === on) return;
  boss.bleed = on;
  if (on) fight(ctx, mob, 'finale');
}

/** The signal the client's music and screens follow: a boss fight starts, changes phase, reaches its finale, ends. */
export function fight(ctx: Ctx, mob: Mob, state: 'start' | 'phase' | 'finale' | 'end', phase?: number): void {
  ctx.effects.push({ type: 'bossFight', depth: ctx.depth, mob: mob.id, kind: mob.kind, state, ...(phase !== undefined ? { phase } : {}) });
  // Goo.notice, Tengu.notice...: the rose's ghost has its word on the boss (GhostHero.sayBoss).
  if (state === 'start') ghostSeesBoss(ctx);
}

/* What the bosses say and show */

/** Mob.yell: a boss's line (Messages of its class), in its voice. */
export function yell(ctx: Ctx, mob: Mob, line: string, hero?: Hero): void {
  ctx.effects.push({ type: 'yell', depth: ctx.depth, mob: mob.id, kind: mob.kind, line, ...(hero ? { hero: hero.id } : {}) });
}

/** CharSprite.showStatus over a boss ('status'), or a line in the log (GLog: 'log' plain, 'warn' w, 'negative' n). */
export function say(ctx: Ctx, mob: Mob, line: string, as: 'status' | 'log' | 'warn' | 'negative' = 'status'): void {
  ctx.effects.push({ type: 'bossLine', depth: ctx.depth, mob: mob.id, kind: mob.kind, line, as });
}

/** A boss fight's visual (and its sound, on the client). */
export function show(ctx: Ctx, fx: BossFx, extra: Omit<Extract<import('../floor').Effect, { type: 'bossFx' }>, 'type' | 'depth' | 'fx'> = {}): void {
  ctx.effects.push({ type: 'bossFx', depth: ctx.depth, fx, ...extra });
}

/**
 * The visuals of the boss fights, each with Shattered's sound on the client:
 * - pumpUp: Goo swells (GooSprite.pumpUp: the cells it may strike, CHARGEUP); pumpAttack: it lets go (BURNING);
 * - puff: Tengu vanishes in smoke (Speck.WOOL, PUFF); throw: a bomb or shocker flies (`value`: its item sprite);
 *   bombTick: a bomb's countdown (`value` 3, 2, 1); blast: a bomb goes off over `cells` (BLAST); fire: Tengu's fire
 *   wave lights `cells` (BURNING); shock: a shocker arcs (`cells`: the ends of its two arcs; LIGHTNING);
 *   traps: Tengu's cell fills with darts, `cells` glinting a moment; flash: the screen flashes (`value` its colour);
 * - gasZap / slam: DM-300 spits gas / slams (GAS / ROCKS); targeted: cells marked for rocks or a beam (`value` ms);
 *   rocks: rocks fall on `cells` (ROCKS, shake); charge / discharge: DM-300's supercharge starts or ends; shield: it
 *   draws a barrier from the wires; pylon: a pylon switches on; zap: a pylon arcs to `cells` (LIGHTNING); dig: DM-300
 *   tunnels through `cells` of rock (ROCKS, shake); gate: the arena's gate is blown open (`cells`);
 * - summon: a summoning circle on `pos` (`value` index of MOB kind in SUMMONS); summoned: it brings its
 *   minion forth (BONES/BURNING/CURSED/CHARGEUP by kind); link: a life link from `pos` to `to` (RAY); teleport:
 *   from `pos` to `to`; scream (CHALLENGE);
 * - beam: Yog's death rays from `pos` to each of `cells` (RAY); dark: the halls grow darker; rise: a fist comes up
 *   out of the pit at `pos`; bolt: a fist's ranged attack from `pos` to `to` (`value`: its fist kind); flashDark:
 *   the dark fist's flash of darkness; grass: the soiled fist grows grass on `cells`; steam: the burning fist
 *   boils away water on `cells`.
 */
export type BossFx =
  | 'pumpUp' | 'pumpAttack' | 'puff' | 'throw' | 'bombTick' | 'blast' | 'fire' | 'shock' | 'traps' | 'flash'
  | 'gasZap' | 'slam' | 'targeted' | 'rocks' | 'charge' | 'discharge' | 'shield' | 'pylon' | 'zap' | 'dig' | 'gate'
  | 'summon' | 'summoned' | 'link' | 'teleport' | 'scream'
  | 'beam' | 'dark' | 'rise' | 'bolt' | 'flashDark' | 'grass' | 'steam';

/* The floor's clock: buffs and delayed effects of the fights */

/** Adds a buff or delayed effect, due at `time`. */
export function schedule(ctx: Ctx, entry: Timed): void {
  bossFloor(ctx.floor).timed.push(entry);
}

/** The next buff or effect due on the floor, if any (the earliest, oldest first among equals). */
export function nextTimed(floor: Floor): Timed | undefined {
  let next: Timed | undefined;
  // At the same moment, an urgent one first (it goes before whoever is due then: VFX_PRIO).
  for (const entry of floor.boss?.timed ?? []) {
    if (!next || entry.time < next.time || (entry.time === next.time && entry.urgent === true && next.urgent !== true)) next = entry;
  }
  return next;
}

export function removeTimed(ctx: Ctx, entry: Timed): void {
  const timed = bossFloor(ctx.floor).timed;
  const index = timed.indexOf(entry);
  if (index >= 0) timed.splice(index, 1);
}

export function timedOf<K extends Timed['kind']>(ctx: Ctx, kind: K): Array<Extract<Timed, { kind: K }>> {
  return (ctx.floor.boss?.timed ?? []).filter((entry): entry is Extract<Timed, { kind: K }> => entry.kind === kind);
}

/** Viscosity.DeferedDamage.extend on a boss: freshly applied, it waits a turn before it hurts. */
export function deferDamage(ctx: Ctx, mob: Mob, damage: number): void {
  const entry = timedOf(ctx, 'deferred').find((d) => d.mob === mob.id);
  if (entry) {
    entry.damage += damage;
    return;
  }
  schedule(ctx, { kind: 'deferred', owner: mob.id, mob: mob.id, damage, time: ctx.floor.now + 2 });
}

export function deferredOn(ctx: Ctx, mob: Mob): number {
  return timedOf(ctx, 'deferred').find((d) => d.mob === mob.id)?.damage ?? 0;
}

/** ShieldBuff.setShield as a Barrier on a monster: never lowered by it. */
export function setBarrier(ctx: Ctx, mob: Mob, shield: number, holds = false): void {
  mob.boss ??= {};
  if ((mob.shield ?? 0) <= shield) mob.shield = shield;
  const entry = timedOf(ctx, 'barrier').find((b) => b.mob === mob.id);
  if (entry) {
    if (mob.shield === shield) entry.partial = 0;
    return;
  }
  schedule(ctx, { kind: 'barrier', owner: mob.id, mob: mob.id, partial: 0, time: ctx.floor.now + 1, ...(holds ? { holds } : {}) });
}

/** ShieldBuff.processDamage on a monster: its shield takes what it can; the rest is left. */
export function absorbShield(mob: Mob, damage: number): number {
  const shield = mob.shield ?? 0;
  if (shield <= 0 || damage <= 0) return damage;
  if (shield >= damage) {
    mob.shield = shield - damage;
    return 0;
  }
  mob.shield = 0;
  return damage - shield;
}

/* Movements */

/** Moves a character to a cell outright (ScrollOfTeleportation.appear: nothing there is pressed). */
export function appear(ctx: Ctx, char: Char, to: number): void {
  const from = char.pos;
  if (from === to) return;
  char.pos = to;
  leaveCell(ctx.world, ctx.level, ctx.depth, from);
  enterCell(ctx.level, to);
  if (isHero(char)) observe(ctx.world, char);
}

/**
 * WandOfBlastWave.throwChar, without collision damage: a character thrown along a trajectory, up
 * to `power` cells (half as far for a boss), stopping short of anyone in the way.
 */
export function throwChar(ctx: Ctx, char: Char, trajectory: Ballistica, power: number, boss = false): void {
  if (boss) power = Math.trunc((power + 1) / 2);
  let dist = Math.min(trajectory.dist, power);
  if (dist <= 0 || (char.rooted ?? 0) > 0) return;
  if (charAt(ctx.world, ctx.depth, trajectory.path[dist]!)) dist--;
  if (dist < 0) return;
  const to = trajectory.path[dist]!;
  if (to === char.pos) return;
  const from = char.pos;
  appear(ctx, char, to);
  ctx.effects.push({ type: 'pushed', depth: ctx.depth, mob: char.id, from, to });
}

/** A free cell: open ground with nobody on it. */
export const freeCell = (ctx: Ctx, cell: number): boolean =>
  cell >= 0 && cell < LENGTH && isPassable(ctx.level, cell) && !charAt(ctx.world, ctx.depth, cell);

/**
 * Mob.holdAllies and restoreAllies, for a party: as a boss's fight closes a door, companions on the
 * depth who are not where they can follow are brought in beside `near` (and anyone left standing in
 * rock after the level changes, likewise).
 */
export function gatherParty(ctx: Ctx, inside: (pos: number) => boolean, near: number): void {
  for (const hero of heroesOn(ctx.world, ctx.depth)) {
    if (inside(hero.pos) && isPassable(ctx.level, hero.pos)) continue;
    const from = hero.pos;
    hero.pos = freeCellNear(ctx.world, ctx.level, ctx.depth, near);
    leaveCell(ctx.world, ctx.level, ctx.depth, from);
    enterCell(ctx.level, hero.pos);
    observe(ctx.world, hero);
    ctx.effects.push({ type: 'teleported', hero: hero.id });
  }
}

/* Patch */

/**
 * Patch.generate: a w×h field of patches, `fill` of it set (clustered `clustering` times; with
 * `forceFillRate`, made up to exactly that share afterwards).
 */
export function patchGenerate(rng: Rng, w: number, h: number, fill: number, clustering: number, forceFillRate: boolean): boolean[] {
  const length = w * h;
  let cur = new Array<boolean>(length).fill(false);
  let off = new Array<boolean>(length).fill(false);
  let fillDiff = -Math.round(f32(length * fill));
  if (forceFillRate && clustering > 0) fill = f32(fill + f32(f32(0.5 - fill) * 0.5));
  for (let i = 0; i < length; i++) {
    off[i] = rng.float() < fill;
    if (off[i]) fillDiff++;
  }
  for (let i = 0; i < clustering; i++) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const pos = x + y * w;
        let count = 0;
        let neighbours = 0;
        if (y > 0) {
          if (x > 0) {
            if (off[pos - w - 1]) count++;
            neighbours++;
          }
          if (off[pos - w]) count++;
          neighbours++;
          if (x < w - 1) {
            if (off[pos - w + 1]) count++;
            neighbours++;
          }
        }
        if (x > 0) {
          if (off[pos - 1]) count++;
          neighbours++;
        }
        if (off[pos]) count++;
        neighbours++;
        if (x < w - 1) {
          if (off[pos + 1]) count++;
          neighbours++;
        }
        if (y < h - 1) {
          if (x > 0) {
            if (off[pos + w - 1]) count++;
            neighbours++;
          }
          if (off[pos + w]) count++;
          neighbours++;
          if (x < w - 1) {
            if (off[pos + w + 1]) count++;
            neighbours++;
          }
        }
        cur[pos] = 2 * count >= neighbours;
        if (cur[pos] !== off[pos]) fillDiff += cur[pos] ? +1 : -1;
      }
    }
    const tmp = cur;
    cur = off;
    off = tmp;
  }
  if (forceFillRate && Math.min(w, h) > 2) {
    const neighbours = [-w - 1, -w, -w + 1, -1, 0, +1, +w - 1, +w, +w + 1];
    const growing = fillDiff < 0;
    while (fillDiff !== 0) {
      let cell: number;
      let tries = 0;
      do {
        cell = rng.intBetween(1, w - 1) + rng.intBetween(1, h - 1) * w;
        tries++;
      } while (off[cell] !== growing && tries * 10 < length);
      for (const n of neighbours) {
        if (fillDiff !== 0 && off[cell + n] !== growing) {
          off[cell + n] = growing;
          fillDiff += growing ? +1 : -1;
        }
      }
    }
  }
  return off;
}

/**
 * PathFinder.buildDistanceMap(from, passable, limit): steps from a cell to every cell it reaches
 * through passable ones (8 directions), up to `limit`; unreached cells stay Infinity.
 */
export function distanceMap(from: number, passable: (cell: number) => boolean, limit = Infinity, width = WIDTH, size = LENGTH): number[] {
  const dist = new Array<number>(size).fill(Infinity);
  dist[from] = 0;
  const queue = [from];
  const dirs = [-width - 1, -width, -width + 1, -1, +1, +width - 1, +width, +width + 1];
  for (let head = 0; head < queue.length; head++) {
    const cell = queue[head]!;
    const next = dist[cell]! + 1;
    if (next > limit) continue;
    const x = cell % width;
    for (const d of dirs) {
      const n = cell + d;
      if (n < 0 || n >= size) continue;
      const nx = n % width;
      if (Math.abs(nx - x) > 1) continue;
      if (dist[n]! <= next || !passable(n)) continue;
      dist[n] = next;
      queue.push(n);
    }
  }
  return dist;
}
