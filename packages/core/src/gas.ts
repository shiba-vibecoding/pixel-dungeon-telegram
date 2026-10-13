import { isAlive, MOBS } from './actors';
import { hurt } from './combat';
import { burnHeaps } from './cooking';
import { charAt, type Char, type Ctx, type Floor, heroesOn, isHero } from './floor';
import { distance, HEIGHT, LENGTH, WIDTH } from './level/geometry';
import { F, hasFlag, T } from './level/terrain';
import { corrode, ignite } from './status';
import { immuneTo } from './traps';

/*
 * Clouds of gas (Blob, ToxicGas, ParalyticGas). A cloud is so much gas per
 * cell; every turn it spreads into the open cells around (never through
 * walls or closed doors) and thins out, and whoever stands in it breathes it:
 * toxic gas hurts, paralytic gas paralyses. Kept sparse, as [cell, volume]
 * pairs in cell order, since most of a level has none.
 *
 * A spinner's cobweb (Web) is kept the same way, though it is no gas: it
 * never spreads, only wears away a little every turn, and holds fast whoever
 * stands in it.
 *
 * Shattered's wands bring more: CorrosiveGas (the wand of corrosion's, eating
 * away at whoever breathes it), ConfusionGas and Regrowth (a cursed wand's),
 * and Fire, which is no gas either: it burns where it was set for a few
 * turns, sets alight whoever stands in it, and creeps on along whatever can
 * burn, leaving embers.
 */

export type GasKind = 'toxic' | 'paralytic' | 'web' | 'corrosive' | 'confusion' | 'regrowth' | 'fire';
export const GAS_KINDS: readonly GasKind[] = ['toxic', 'paralytic', 'web', 'corrosive', 'confusion', 'regrowth', 'fire'];
/** What is breathed, and what a cleansing cloud clears away. */
const AIRBORNE: readonly GasKind[] = ['toxic', 'paralytic', 'corrosive', 'confusion'];

/** How long paralytic gas holds whoever breathes it, after the last breath. */
const PARALYSIS_TURNS = 5;

export const hasGas = (floor: Floor): boolean => GAS_KINDS.some((kind) => (floor.gas?.[kind]?.length ?? 0) > 0);

/**
 * Blob.seed: so much gas let out at a cell. Let out in a closed doorway (which
 * gas does not pass), it goes to the open cells on either side instead.
 */
export function seedGas(ctx: Ctx, pos: number, kind: GasKind, amount: number): void {
  const floor = ctx.floor;
  const cloud = new Map((floor.gas?.[kind] ?? []).map(([cell, volume]) => [cell, volume]));
  const map = ctx.level.map;
  const open = (cell: number): boolean => cell >= 0 && cell < LENGTH && !hasFlag(map[cell]!, F.SOLID);
  const cells = open(pos) ? [pos] : [-1, 1, -WIDTH, WIDTH].map((n) => pos + n).filter(open);
  if (cells.length === 0) return;
  for (const cell of cells) cloud.set(cell, (cloud.get(cell) ?? 0) + Math.trunc(amount / cells.length));
  (floor.gas ??= {})[kind] = [...cloud].sort((a, b) => a[0] - b[0]);
  // The gas acts on the depth's clock from now on, a turn at a time.
  floor.gasAt ??= floor.now;
}

/**
 * CorrosiveGas.setStrength: how hard the cloud on the depth eats away, the strongest it was set to
 * (one strength for the whole cloud, as in Shattered).
 */
export function setGasStrength(ctx: Ctx, kind: GasKind, strength: number): void {
  const strengths = (ctx.floor.gasStrength ??= {});
  if (strength > (strengths[kind] ?? 0)) strengths[kind] = strength;
}

/** Blob.volumeAt: how much of a gas (or fire) there is on a cell. */
export function gasAt(floor: Floor, kind: GasKind, cell: number): number {
  return floor.gas?.[kind]?.find(([c]) => c === cell)?.[1] ?? 0;
}

/** Blob.clear: none of it left on a cell. */
export function clearGasAt(floor: Floor, kind: GasKind, cell: number): void {
  const cloud = floor.gas?.[kind];
  if (!cloud) return;
  floor.gas![kind] = cloud.filter(([c]) => c !== cell);
  tidy(floor);
}

/** Web.seed: a web is spun on a cell; it is as thick as the thickest spun there, never thicker. */
export function seedWeb(ctx: Ctx, pos: number, amount: number): void {
  const floor = ctx.floor;
  const web = new Map((floor.gas?.web ?? []).map(([cell, volume]) => [cell, volume]));
  if ((web.get(pos) ?? 0) >= amount) return;
  web.set(pos, amount);
  (floor.gas ??= {}).web = [...web].sort((a, b) => a[0] - b[0]);
  floor.gasAt ??= floor.now;
}

/** PotionOfPurity.shatter: the air within reach of a cell is cleared of every gas. */
export function clearGas(ctx: Ctx, pos: number, radius: number): boolean {
  let cleared = false;
  for (const kind of AIRBORNE) {
    const cloud = ctx.floor.gas?.[kind];
    if (!cloud) continue;
    const left = cloud.filter(([cell]) => distance(cell, pos) > radius);
    if (left.length !== cloud.length) cleared = true;
    ctx.floor.gas![kind] = left;
  }
  tidy(ctx.floor);
  return cleared;
}

/** One turn of every cloud on the depth: it spreads and thins (Blob.evolve), then acts on whoever is in it. */
export function evolveGas(ctx: Ctx): void {
  const { level, floor } = ctx;
  const open = level.map.map((terrain) => !hasFlag(terrain, F.SOLID));
  for (const kind of GAS_KINDS) {
    const cloud = floor.gas?.[kind];
    if (!cloud || cloud.length === 0) continue;
    if (kind === 'web') {
      evolveWeb(ctx, cloud);
      continue;
    }
    if (kind === 'fire') {
      evolveFire(ctx, cloud);
      continue;
    }
    const cur = new Int32Array(LENGTH);
    for (const [cell, volume] of cloud) cur[cell] = volume;
    const next: Array<[number, number]> = [];
    for (let y = 1; y < HEIGHT - 1; y++) {
      for (let pos = y * WIDTH + 1; pos < y * WIDTH + WIDTH - 1; pos++) {
        if (!open[pos]) continue;
        let count = 1;
        let sum = cur[pos]!;
        for (const n of [-1, 1, -WIDTH, WIDTH]) {
          if (open[pos + n]) {
            sum += cur[pos + n]!;
            count++;
          }
        }
        const value = sum >= count ? Math.trunc(sum / count) - 1 : 0;
        if (value > 0) next.push([pos, value]);
      }
    }
    floor.gas![kind] = next;
    if (kind === 'regrowth') {
      regrow(ctx, next);
      continue;
    }
    const inside = new Set(next.map(([cell]) => cell));
    for (const char of breathers(ctx)) {
      if (!inside.has(char.pos) || !isAlive(char) || immuneTo(char, 'gas')) continue;
      breathe(ctx, char, kind);
    }
  }
  tidy(floor);
}

/**
 * Web.evolve: every web wears a little thinner; whoever stands in one that is left is held fast
 * (Roots, prolonged a turn), but not a flier, nor those Roots cannot hold (Spinner, Piranha, the
 * sad ghost and the curse: IMMUNITIES).
 */
function evolveWeb(ctx: Ctx, web: Array<[number, number]>): void {
  const next = web.map(([cell, volume]): [number, number] => [cell, volume - 1]).filter(([, volume]) => volume > 0);
  ctx.floor.gas!.web = next;
  const inside = new Set(next.map(([cell]) => cell));
  for (const hero of heroesOn(ctx.world, ctx.depth)) {
    if (inside.has(hero.pos) && !(hero.levitating ?? 0)) hero.rooted = Math.max(hero.rooted, 1);
  }
  for (const mob of ctx.floor.mobs) {
    if (!inside.has(mob.pos) || MOBS[mob.kind].flying || ROOTS_IMMUNE.has(mob.kind)) continue;
    // A monster's own turn wears a turn of it off first (mobConditions): two, to be held on that turn.
    mob.rooted = Math.max(mob.rooted ?? 0, 2);
  }
}

const ROOTS_IMMUNE: ReadonlySet<string> = new Set(['spinner', 'piranha', 'ghost', 'curse']);

/** Everyone on the depth who breathes: heroes, and monsters other than the harmless. */
function breathers(ctx: Ctx): Char[] {
  return [...heroesOn(ctx.world, ctx.depth), ...ctx.floor.mobs.filter((mob) => mob.state !== 'passive')];
}

function breathe(ctx: Ctx, char: Char, kind: GasKind): void {
  // CorrosiveGas.evolve: Corrosion for two turns, as strong as the cloud.
  if (kind === 'corrosive') {
    corrode(char, 2, ctx.floor.gasStrength?.corrosive ?? 1);
    return;
  }
  // ConfusionGas.evolve: Vertigo, prolonged to two turns.
  if (kind === 'confusion') {
    char.dizzy = Math.max(char.dizzy ?? 0, 2);
    return;
  }
  if (kind === 'paralytic') {
    char.paralysed = Math.max(char.paralysed ?? 0, PARALYSIS_TURNS);
    return;
  }
  // ToxicGas.evolve: the deeper, the deadlier.
  const strength = 5 + ctx.depth * 5;
  let damage = Math.trunc((char.ht + strength) / 40);
  if (ctx.rng.int(40) < (char.ht + strength) % 40) damage++;
  if (damage <= 0) return;
  ctx.effects.push({ type: 'hurt', depth: ctx.depth, who: char.id, damage });
  hurt(ctx, char, damage, 'gas');
}

/**
 * Regrowth.evolve: bare ground under the cloud turns to grass, and where it is thick (above 9) and
 * nobody stands, grass grows tall; whoever stands where it is thicker than a trace is held by roots.
 */
function regrow(ctx: Ctx, cloud: Array<[number, number]>): void {
  const { level, world, depth } = ctx;
  for (const [cell, volume] of cloud) {
    const terrain = level.map[cell]!;
    const char = charAt(world, depth, cell);
    let grown = terrain;
    if (terrain === T.EMPTY || terrain === T.EMBERS || terrain === T.EMPTY_DECO) {
      grown = volume > 9 && !char ? T.HIGH_GRASS : T.GRASS;
    } else if (terrain === T.GRASS && volume > 9 && !(ctx.floor.plants ?? []).some((p) => p.pos === cell) && !char) {
      grown = T.HIGH_GRASS;
    }
    if (grown !== terrain) level.map[cell] = grown;
    if (char && volume > 1) char.rooted = Math.max(char.rooted ?? 0, isHero(char) ? 1 : 2);
  }
}

/** Fire.seed: so much fire on a cell (fire does not spread like a gas: see evolveFire). */
export function seedFire(ctx: Ctx, cell: number, amount: number): void {
  const fire = new Map((ctx.floor.gas?.fire ?? []).map(([c, v]) => [c, v]));
  fire.set(cell, (fire.get(cell) ?? 0) + amount);
  (ctx.floor.gas ??= {}).fire = [...fire].sort((a, b) => a[0] - b[0]);
  ctx.floor.gasAt ??= ctx.floor.now;
}

/**
 * Level.destroy: what burnt down is gone: grass and the like to embers, a door, a barricade or
 * a bookshelf to bare floor.
 */
export function destroyCell(ctx: Ctx, cell: number): void {
  const terrain = ctx.level.map[cell]!;
  ctx.level.map[cell] = terrain === T.EMPTY || terrain === T.EMPTY_DECO || !hasFlag(terrain, F.SOLID) ? T.EMBERS : T.EMPTY;
  clearGasAt(ctx.floor, 'web', cell);
  ctx.effects.push({ type: 'burnt', depth: ctx.depth, pos: cell });
}

/**
 * Fire.evolve: a burning cell burns a turn less every turn, and burns down what can burn once it
 * is out; the fire creeps to whatever can burn next to it (four turns' worth). Wherever it burns
 * it sets alight whoever stands there, burns what lies there and withers the plant (Fire.burn).
 */
function evolveFire(ctx: Ctx, cloud: Array<[number, number]>): void {
  const map = ctx.level.map;
  const cur = new Int32Array(LENGTH);
  for (const [cell, volume] of cloud) cur[cell] = volume;
  const next: Array<[number, number]> = [];
  for (let y = 1; y < HEIGHT - 1; y++) {
    for (let cell = y * WIDTH + 1; cell < y * WIDTH + WIDTH - 1; cell++) {
      const flamable = hasFlag(map[cell]!, F.FLAMABLE);
      let fire = 0;
      if (cur[cell]! > 0) {
        burnCell(ctx, cell);
        fire = cur[cell]! - 1;
        if (fire <= 0 && flamable) destroyCell(ctx, cell);
      } else if (flamable && (cur[cell - 1]! > 0 || cur[cell + 1]! > 0 || cur[cell - WIDTH]! > 0 || cur[cell + WIDTH]! > 0)) {
        fire = 4;
        burnCell(ctx, cell);
      }
      if (fire > 0) next.push([cell, fire]);
    }
  }
  ctx.floor.gas!.fire = next;
}

/** Fire.burn: whoever stands on a burning cell catches fire, what lies there burns, a plant withers. */
export function burnCell(ctx: Ctx, cell: number): void {
  const char = charAt(ctx.world, ctx.depth, cell);
  if (char && isAlive(char) && !immuneTo(char, 'burning')) ignite(char);
  burnHeaps(ctx, cell, 0);
  if (ctx.floor.plants?.some((p) => p.pos === cell)) ctx.floor.plants = ctx.floor.plants.filter((p) => p.pos !== cell);
}

/** Drops empty clouds, and the gas clock with the last of them. */
function tidy(floor: Floor): void {
  if (!floor.gas) return;
  for (const kind of GAS_KINDS) {
    if (floor.gas[kind]?.length === 0) {
      delete floor.gas[kind];
      if (floor.gasStrength?.[kind]) delete floor.gasStrength[kind];
    }
  }
  if (!hasGas(floor)) {
    delete floor.gas;
    delete floor.gasAt;
    delete floor.gasStrength;
  }
}
