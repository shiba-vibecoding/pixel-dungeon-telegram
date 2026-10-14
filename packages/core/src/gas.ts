import { hasProp } from './props';
import { isAlive, MOBS } from './actors';
import { hurt } from './combat';
import { type Char, charAt, type Ctx, type Floor, heroesOn, isHero, isWater } from './floor';
import { distance, HEIGHT, LENGTH, NEIGHBOURS4, WIDTH } from './level/geometry';
import { F, hasFlag, T } from './level/terrain';
import { immuneTo } from './traps';
import type { Level } from './level/generate';
import { evolveRoomBlobs, freezeEternalFire, roomBlobsActive } from './roomblobs';
import { burnHeaps } from './cooking';
import { addCorrosion, freezeCell, igniteChar, isFiery } from './buffs';
import { PARALYSIS_TURNS } from './status';

/*
 * Clouds of gas and other blobs (Blob and its kinds). A cloud is so much gas per cell; every turn it spreads
 * into the open cells around (never through walls or closed doors) and thins out (Blob.evolve), and whoever
 * stands in it breathes it: toxic gas hurts, paralytic gas paralyses, confusion gas makes one stagger, corrosive
 * gas eats away, a smoke screen hides what is behind it, storm clouds turn the ground to water, an inferno and a
 * blizzard burn and freeze, stench paralyses for a moment, regrowth makes grass spring up. Fire (Fire) does not
 * spread like a gas: it burns where it is and catches whatever can burn beside it. Freezing lingers where it was
 * let out, chilling and freezing; electricity runs along water and shocks. Kept sparse, as [cell, volume] pairs
 * in cell order, since most of a level has none.
 *
 * A spinner's cobweb (Web) is kept the same way, though it is no gas: it never spreads, only wears away a
 * little every turn, and holds fast whoever stands in it.
 */

export type GasKind =
  | 'toxic' | 'paralytic' | 'web'
  // Shattered's blobs, from alchemy's potions, brews, bombs and the chaotic censer.
  | 'confusion' | 'corrosive' | 'smoke' | 'storm' | 'stench' | 'regrowth' | 'fire' | 'freezing' | 'inferno' | 'blizzard'
  | 'electricity';
/** The order clouds act in, each a turn (Blob actors in the order the level made them). */
export const GAS_KINDS: readonly GasKind[] = [
  'toxic', 'paralytic', 'web', 'confusion', 'corrosive', 'smoke', 'storm', 'stench', 'regrowth', 'inferno', 'blizzard', 'fire',
  'freezing', 'electricity',
];
/** What spreads like a gas (Blob.evolve), and what a cleansing cloud clears away. */
const AIRBORNE: readonly GasKind[] = ['toxic', 'paralytic', 'confusion', 'corrosive', 'smoke', 'storm', 'stench', 'regrowth', 'inferno', 'blizzard'];
/** What a potion of purity clears (BlobImmunity's immunities). */
const CLEANSED: readonly GasKind[] = [...AIRBORNE, 'fire', 'freezing', 'electricity', 'web'];

/** How long paralytic gas holds whoever breathes it, after the last breath. */

export const hasGas = (floor: Floor, level?: Level): boolean =>
  GAS_KINDS.some((kind) => (floor.gas?.[kind]?.length ?? 0) > 0) || roomBlobsActive(level, floor);

/** The volume of a blob at a cell (Blob.volumeAt). */
export function gasAt(floor: Floor, kind: GasKind, cell: number): number {
  const cloud = floor.gas?.[kind];
  if (!cloud) return 0;
  return cloud.find(([c]) => c === cell)?.[1] ?? 0;
}

/** Cells a smoke screen hides what is behind (SmokeScreen.onBuildFlagMaps: losBlocking). */
export function smokeCells(floor: Floor | undefined): ReadonlySet<number> {
  return new Set((floor?.gas?.smoke ?? []).map(([cell]) => cell));
}

/**
 * Blob.seed: so much gas let out at a cell. Let out in a closed doorway (which
 * gas does not pass), it goes to the open cells on either side instead.
 */
export function seedGas(ctx: Ctx, pos: number, kind: GasKind, amount: number): void {
  const floor = ctx.floor;
  const cloud = new Map((floor.gas?.[kind] ?? []).map(([cell, volume]) => [cell, volume]));
  const map = ctx.level.map;
  const open = (cell: number): boolean => cell >= 0 && cell < LENGTH && !hasFlag(map[cell]!, F.SOLID);
  // Fire, freezing and electricity stay where they are put (their own seed), solid or not.
  const cells = !AIRBORNE.includes(kind) || open(pos) ? [pos] : [-1, 1, -WIDTH, WIDTH].map((n) => pos + n).filter(open);
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

/** A corrosive cloud let out, as strong as the strongest that went into it. */
export function seedCorrosive(ctx: Ctx, pos: number, amount: number, strength: number): void {
  seedGas(ctx, pos, 'corrosive', amount);
  setGasStrength(ctx, 'corrosive', strength);
}

/** Fire.seed: so much fire on a cell (fire does not spread like a gas: see evolveFire). */
export const seedFire = (ctx: Ctx, cell: number, amount: number): void => seedGas(ctx, cell, 'fire', amount);

/** Web.seed: a web is spun on a cell; it is as thick as the thickest spun there, never thicker. */
export function seedWeb(ctx: Ctx, pos: number, amount: number): void {
  const floor = ctx.floor;
  const web = new Map((floor.gas?.web ?? []).map(([cell, volume]) => [cell, volume]));
  if ((web.get(pos) ?? 0) >= amount) return;
  web.set(pos, amount);
  (floor.gas ??= {}).web = [...web].sort((a, b) => a[0] - b[0]);
  floor.gasAt ??= floor.now;
}

/** Blob.clear: a blob is gone from a cell. */
export function clearGasAt(floor: Floor, kind: GasKind, cell: number): boolean {
  const cloud = floor.gas?.[kind];
  if (!cloud) return false;
  const left = cloud.filter(([c]) => c !== cell);
  if (left.length === cloud.length) return false;
  floor.gas![kind] = left;
  return true;
}

/**
 * PotionOfPurity.shatter: the air within reach of a cell (PotionOfPurity.DISTANCE, by paths around walls) is
 * cleared of every blob a cleansing cloud guards against.
 */
export function clearGas(ctx: Ctx, pos: number, radius: number): boolean {
  let cleared = false;
  const reach = reachable(ctx, pos, radius);
  for (const kind of CLEANSED) {
    const cloud = ctx.floor.gas?.[kind];
    if (!cloud) continue;
    const left = cloud.filter(([cell]) => !reach.has(cell));
    if (left.length !== cloud.length) cleared = true;
    ctx.floor.gas![kind] = left;
  }
  tidy(ctx.floor, ctx.level);
  return cleared;
}

/** PathFinder.buildDistanceMap(cell, not solid, radius): the open cells within so many steps. */
export function reachable(ctx: Ctx, pos: number, radius: number): Set<number> {
  const map = ctx.level.map;
  const dist = new Map<number, number>([[pos, 0]]);
  const queue = [pos];
  for (let head = 0; head < queue.length; head++) {
    const cell = queue[head]!;
    const d = dist.get(cell)!;
    if (d >= radius) continue;
    for (const n of [-1, 1, -WIDTH, WIDTH, -WIDTH - 1, -WIDTH + 1, WIDTH - 1, WIDTH + 1]) {
      const next = cell + n;
      if (next < 0 || next >= LENGTH || dist.has(next) || Math.abs((next % WIDTH) - (cell % WIDTH)) > 1) continue;
      if (hasFlag(map[next]!, F.SOLID)) continue;
      dist.set(next, d + 1);
      queue.push(next);
    }
  }
  return new Set(dist.keys());
}

/** One turn of every cloud on the depth: it spreads and thins (Blob.evolve), then acts on whoever is in it. */
export function evolveGas(ctx: Ctx): void {
  const { level, floor } = ctx;
  // The rooms' lasting blobs first: the vents feed the cloud, the eternal fire burns (roomblobs.ts).
  evolveRoomBlobs(ctx);
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
    if (kind === 'freezing') {
      evolveFreezing(ctx, cloud);
      continue;
    }
    if (kind === 'electricity') {
      evolveElectricity(ctx, cloud);
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
    if (kind === 'toxic' || kind === 'paralytic') {
      const inside = new Set(next.map(([cell]) => cell));
      for (const char of breathers(ctx)) {
        if (!inside.has(char.pos) || !isAlive(char) || immuneTo(char, 'gas') || (kind === 'toxic' && immuneTo(char, 'toxic'))) continue;
        breathe(ctx, char, kind);
      }
      continue;
    }
    // Shattered's blobs act on the cells as they were before this turn's spreading (cur, before Blob.act swaps).
    const before = cloud.filter(([, volume]) => volume > 0).map(([cell]) => cell);
    afterSpreading(ctx, kind, before, cur, next);
    if (kind === 'corrosive' && next.length === 0) delete floor.gasStrength?.corrosive;
  }
  tidy(floor, level);
}

/** What each of Shattered's spreading blobs does to the cells it filled, and to whoever stands in them. */
function afterSpreading(ctx: Ctx, kind: GasKind, cells: number[], cur: Int32Array, next: Array<[number, number]>): void {
  const { world, depth, floor, level } = ctx;
  const nextVolume = new Map(next);
  const charIn = (cell: number): Char | undefined => {
    const char = charAt(world, depth, cell);
    return char && isAlive(char) && !(!isHero(char) && char.state === 'passive' && !char.ally) && !immuneTo(char, 'gas') ? char : undefined;
  };
  switch (kind) {
    case 'confusion':
      // ConfusionGas: Vertigo, two turns more.
      for (const cell of cells) {
        const char = charIn(cell);
        if (char) char.dizzy = Math.max(char.dizzy ?? 0, 2);
      }
      return;
    case 'corrosive': {
      // CorrosiveGas: Corrosion for two turns, as strong as the cloud.
      const strength = floor.gasStrength?.corrosive ?? 0;
      for (const cell of cells) {
        const char = charIn(cell);
        if (char) addCorrosion(char, 2, strength);
      }
      return;
    }
    case 'stench':
      // StenchGas: Paralysis.DURATION / 5 (a fetid rat breathes its own unharmed: FetidRat immunities).
      for (const cell of cells) {
        const char = charIn(cell);
        if (char && !(!isHero(char) && char.kind === 'fetidRat')) char.paralysed = Math.max(char.paralysed ?? 0, 2);
      }
      return;
    case 'storm':
      // StormCloud: the ground turns to water (Level.setCellToWater), fire goes out, and fiery creatures suffer.
      for (const cell of cells) {
        setCellToWater(ctx, cell);
        clearGasAt(floor, 'fire', cell);
        const char = charIn(cell);
        if (char && isFiery(char)) {
          const damage = 1 + Math.trunc(depth / 5);
          ctx.effects.push({ type: 'hurt', depth, who: char.id, damage });
          hurt(ctx, char, damage, 'gas');
        }
      }
      return;
    case 'regrowth':
      // Regrowth.evolve: grass springs up where the cloud was, tall where it was thick and nobody stands; roots.
      for (const [cell, volume] of nextVolume) {
        const terrain = level.map[cell];
        const char = charAt(world, depth, cell);
        let grown = terrain;
        if (terrain === T.EMPTY || terrain === T.EMBERS || terrain === T.EMPTY_DECO) {
          grown = cur[cell]! > 9 && !char ? T.HIGH_GRASS : T.GRASS;
        } else if (terrain === T.GRASS && cur[cell]! > 9 && !floor.plants?.some((p) => p.pos === cell) && !char) {
          grown = T.HIGH_GRASS;
        }
        if (grown !== terrain) {
          level.map[cell] = grown!;
          ctx.effects.push({ type: 'grown', depth, pos: cell });
        }
        const held = charIn(cell);
        // (A monster's own turn wears a turn of roots off first: two, to be held on that turn.)
        if (held && volume > 1 && !(isHero(held) ? false : MOBS[held.kind].flying)) held.rooted = Math.max(held.rooted ?? 0, isHero(held) ? 1 : 2);
      }
      return;
    case 'inferno':
      // Inferno.evolve: it puts out fire and freezing, gives way to a blizzard, burns whoever is in it and what can
      // burn under it, and sets alight whatever can burn beside it.
      for (let cell = 0; cell < LENGTH; cell++) {
        if (cur[cell]! > 0) {
          clearGasAt(floor, 'fire', cell);
          clearGasAt(floor, 'freezing', cell);
          if (gasAt(floor, 'blizzard', cell) > 0) {
            clearGasAt(floor, 'blizzard', cell);
            clearGasAt(floor, 'inferno', cell);
            continue;
          }
          burnCell(ctx, cell);
          if (hasFlag(level.map[cell]!, F.FLAMABLE)) destroyTerrain(ctx, cell);
        } else if (hasFlag(level.map[cell]!, F.FLAMABLE) && NEIGHBOURS4.some((n) => (cur[cell + n] ?? 0) > 0)) {
          if (gasAt(floor, 'fire', cell) === 0) seedGas(ctx, cell, 'fire', 4);
        }
      }
      return;
    case 'blizzard':
      // Blizzard.evolve: it puts out fire and freezing, cancels an inferno, and freezes twice over.
      for (const cell of cells) {
        clearGasAt(floor, 'fire', cell);
        clearGasAt(floor, 'freezing', cell);
        if (gasAt(floor, 'inferno', cell) > 0) {
          clearGasAt(floor, 'inferno', cell);
          clearGasAt(floor, 'blizzard', cell);
          continue;
        }
        freezeCell(ctx, cell);
        freezeCell(ctx, cell);
      }
      return;
    default:
      // A smoke screen does nothing but hide.
      return;
  }
}

/**
 * Fire.evolve: a burning cell burns down (and what could burn there is destroyed when it goes out), freezing puts
 * it out, and it catches every cell that can burn next to it, at four.
 */
function evolveFire(ctx: Ctx, cloud: Array<[number, number]>): void {
  const { floor, level } = ctx;
  const cur = new Map(cloud);
  const next = new Map<number, number>();
  const candidates = new Set<number>();
  for (const [cell] of cloud) {
    candidates.add(cell);
    for (const n of NEIGHBOURS4) candidates.add(cell + n);
  }
  for (const cell of [...candidates].sort((a, b) => a - b)) {
    if (cell < 0 || cell >= LENGTH) continue;
    const fire = cur.get(cell) ?? 0;
    let value = 0;
    if (fire > 0) {
      if (gasAt(floor, 'freezing', cell) > 0) {
        clearGasAt(floor, 'freezing', cell);
        continue;
      }
      burnCell(ctx, cell);
      value = fire - 1;
      if (value <= 0 && hasFlag(level.map[cell]!, F.FLAMABLE)) destroyTerrain(ctx, cell);
    } else if (gasAt(floor, 'freezing', cell) <= 0 && hasFlag(level.map[cell]!, F.FLAMABLE) &&
      NEIGHBOURS4.some((n) => (cur.get(cell + n) ?? 0) > 0)) {
      value = 4;
      burnCell(ctx, cell);
    }
    if (value > 0) next.set(cell, value);
  }
  floor.gas!.fire = [...next].sort((a, b) => a[0] - b[0]);
}

/** Freezing.evolve: fire puts it out; otherwise it freezes (Freezing.freeze) and wanes a step a turn. */
function evolveFreezing(ctx: Ctx, cloud: Array<[number, number]>): void {
  const { floor } = ctx;
  const next: Array<[number, number]> = [];
  for (const [cell, volume] of cloud) {
    if (volume <= 0) continue;
    if (gasAt(floor, 'fire', cell) > 0) {
      clearGasAt(floor, 'fire', cell);
      continue;
    }
    freezeCell(ctx, cell);
    if (volume - 1 > 0) next.push([cell, volume - 1]);
  }
  floor.gas!.freezing = next;
  // EternalFire: frost on or beside it puts the whole of it out.
  freezeEternalFire(ctx, cloud.filter(([, volume]) => volume > 0).map(([cell]) => cell));
}

/**
 * Electricity.evolve: it first runs along the water, as strong as where it came from, then shocks whoever stands
 * in it (paralysed as long as it is strong, and hurt every other turn) and wanes a step.
 */
function evolveElectricity(ctx: Ctx, cloud: Array<[number, number]>): void {
  const { floor, level, depth, world, rng } = ctx;
  const cur = new Map(cloud);
  const spread = (cell: number, power: number): void => {
    cur.set(cell, Math.max(cur.get(cell) ?? 0, power));
    for (const n of NEIGHBOURS4) {
      const next = cell + n;
      if (next >= 0 && next < LENGTH && isWater(level.map[next]!) && (cur.get(next) ?? 0) < power) spread(next, power);
    }
  };
  for (const [cell, volume] of [...cur]) if (volume > 0) spread(cell, volume);
  const next: Array<[number, number]> = [];
  for (const [cell, volume] of [...cur].sort((a, b) => a[0] - b[0])) {
    if (volume <= 0) continue;
    const char = charAt(world, depth, cell);
    if (char && isAlive(char) && !immuneTo(char, 'gas') && !immuneTo(char, 'shock')) {
      if ((char.paralysed ?? 0) <= 0) char.paralysed = volume;
      if (volume % 2 === 1) {
        const damage = Math.round(rng.floatMax(2 + depth / 5));
        if (damage > 0) {
          ctx.effects.push({ type: 'hurt', depth, who: char.id, damage });
          hurt(ctx, char, damage, 'electricity');
        }
      }
    }
    if (volume - 1 > 0) next.push([cell, volume - 1]);
  }
  floor.gas!.electricity = next;
}

/** Fire.burn: whoever stands there catches fire, a heap there burns, a plant withers. */
export function burnCell(ctx: Ctx, cell: number): void {
  const char = charAt(ctx.world, ctx.depth, cell);
  if (char && isAlive(char)) igniteChar(ctx, char);
  if (ctx.floor.heaps.some((heap) => heap.pos === cell)) burnHeaps(ctx, cell, 0);
  // Plant.wither.
  if (ctx.floor.plants?.some((p) => p.pos === cell)) ctx.floor.plants = ctx.floor.plants.filter((p) => p.pos !== cell);
}

/** Level.destroy: what could burn (or bare floor) is embers now, and no web is left. */
export function destroyTerrain(ctx: Ctx, cell: number): void {
  const terrain = ctx.level.map[cell]!;
  if (terrain === T.EMPTY || terrain === T.EMPTY_DECO || hasFlag(terrain, F.FLAMABLE)) {
    ctx.level.map[cell] = T.EMBERS;
    ctx.effects.push({ type: 'burnt', depth: ctx.depth, pos: cell });
  }
  clearGasAt(ctx.floor, 'web', cell);
}

/** Level.destroy, as the wands call it. */
export const destroyCell = destroyTerrain;

/** Level.setCellToWater: bare floor, grass and embers turn to water. */
export function setCellToWater(ctx: Ctx, cell: number): boolean {
  const terrain = ctx.level.map[cell];
  if (terrain === T.EMPTY || terrain === T.GRASS || terrain === T.EMBERS || terrain === T.EMPTY_SP || terrain === T.HIGH_GRASS ||
    terrain === T.EMPTY_DECO) {
    ctx.level.map[cell] = T.WATER;
    ctx.effects.push({ type: 'grown', depth: ctx.depth, pos: cell });
    return true;
  }
  return false;
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

const ROOTS_IMMUNE: ReadonlySet<string> = new Set(['spinner', 'piranha', 'phantomPiranha', 'ghost', 'curse', 'spawner', 'dm201']);

/** Everyone on the depth who breathes: heroes, and monsters other than the harmless. */
function breathers(ctx: Ctx): Char[] {
  return [...heroesOn(ctx.world, ctx.depth), ...ctx.floor.mobs.filter((mob) => mob.state !== 'passive' || mob.ally || mob.kind === 'spawner')];
}

function breathe(ctx: Ctx, char: Char, kind: GasKind): void {
  // Char.Property: the inorganic breathe no toxic gas (INORGANIC immunities); the static know no paralysis, nor does a
  // fetid rat its own stench (StenchGas).
  if (kind === 'toxic' && hasProp(char, 'inorganic')) return;
  if (kind === 'paralytic' && (hasProp(char, 'static') || (!isHero(char) && char.kind === 'fetidRat'))) return;
  if (kind === 'paralytic') {
    char.paralysed = Math.max(char.paralysed ?? 0, PARALYSIS_TURNS);
    return;
  }
  // RotHeart, RotLasher: immunities.add(ToxicGas).
  if ('kind' in char && (char.kind === 'rotHeart' || char.kind === 'rotLasher')) return;
  // ToxicGas.evolve: the deeper, the deadlier.
  const strength = 5 + ctx.depth * 5;
  let damage = Math.trunc((char.ht + strength) / 40);
  if (ctx.rng.int(40) < (char.ht + strength) % 40) damage++;
  if (damage <= 0) return;
  ctx.effects.push({ type: 'hurt', depth: ctx.depth, who: char.id, damage });
  hurt(ctx, char, damage, 'gas');
}

/** Drops empty clouds, and the gas clock with the last of them. */
function tidy(floor: Floor, level: Level): void {
  if (floor.gas) {
    for (const kind of GAS_KINDS) {
      if (floor.gas[kind]?.length === 0) {
        delete floor.gas[kind];
        if (floor.gasStrength?.[kind]) delete floor.gasStrength[kind];
      }
    }
    if (Object.keys(floor.gas).length === 0) delete floor.gas;
  }
  // The rooms' lasting blobs keep the depth's blob turns going (roomblobs.ts).
  if (!hasGas(floor, level)) {
    delete floor.gas;
    delete floor.gasAt;
    delete floor.gasStrength;
  }
}

/** Whether a blob lies within `radius` of a cell (for the client and tests). */
export const gasNear = (floor: Floor, kind: GasKind, pos: number, radius: number): boolean =>
  (floor.gas?.[kind] ?? []).some(([cell]) => distance(cell, pos) <= radius);
