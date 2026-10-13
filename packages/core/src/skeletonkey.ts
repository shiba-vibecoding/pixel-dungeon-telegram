import { type Hero, isAlive, type Mob } from './actors';
import { PF_CIRCLE8, PF_NEIGHBOURS8 } from './cone';
import { charAt, type Ctx, dropItem, exploredCells, heroesOn, isHero, isPassable, observe } from './floor';
import { floorLocked, regenOn } from './hero';
import { type Item } from './items';
import { adjacent, cellX, cellY } from './level/geometry';
import { F, hasFlag, T } from './level/terrain';
import type { World } from './world';

/*
 * items/artifacts/SkeletonKey: Shattered v4's artifact (its own level up to 10, gained by use). Its
 * charge (3 + half its level) comes back slowly, faster the emptier it is (60 to 120 turns a charge).
 * Inserted into a cell next to the hero: an iron lock opens for 1 charge, a crystal lock for 5, a
 * golden chest for 2, a crystal chest for 5 (never in a boss's sealed fight nor on a quest's side level),
 * a door it locked opens freely; an open doorway is locked for 2 (pushing out whoever stands in it), the
 * door then opening only to others (Hero.actUnlock); anywhere else it raises a temporary wall three
 * cells wide (five on a diagonal) between the hero and that way for 2, pushing enemies back. Opening
 * locks the dungeon's own keys would open makes those keys of no more use (KeyReplacementTracker).
 * SEAM(artifacts): carried, it counts as worn (Artifact.isEquipped), and the artifacts stream's
 * framework (equipping, its slot, Talent.onArtifactUsed, artifactProc, RingOfEnergy) is theirs.
 */

const f32 = Math.fround;
/** SkeletonKey.levelCap. */
export const KEY_LEVEL_CAP = 10;
/** KeyWall's life: Blob.seed(10), capped at 10 turns. */
const WALL_TURNS = 10;

export type SkeletonKeyAction = { type: 'skeletonKey'; item: number; target: number };

/** SkeletonKey.chargeCap: 3, and one more every two levels. */
export const keyChargeCap = (key: Item): number => 3 + Math.trunc(key.level / 2);
/** Its charge (a new key is full). */
export const keyCharge = (key: Item): number => key.charge ?? keyChargeCap(key);

/** Hero.actUnlock: a door this hero's (uncursed) skeleton key locked will not open to its bearer. */
export function skeletonKeyLocks(hero: Hero): boolean {
  return hero.items.some((item) => item.kind === 'artifact.skeletonKey' && !item.cursed);
}

/** Level.locked: a boss's sealed fight, or the vault's final room. */
const levelLocked = (world: World, hero: Hero): boolean => floorLocked(world, hero.depth) || world.floors[hero.depth]?.vault?.locked === true;

type Use = 'unlock' | 'relock' | 'unlockCrystal' | 'lock' | 'chest' | 'crystalChest' | 'wall';

/** What inserting the key into a cell would do, or why it will not (SkeletonKey's messages, by their keys). */
function keyUse(world: World, hero: Hero, key: Item, target: number): { use: Use; push?: number } | { problem: string } {
  const level = world.levels[hero.depth]!;
  const charge = keyCharge(key);
  const terrain = level.map[target]!;
  if (adjacent(target, hero.pos)) {
    if (terrain === T.LOCKED_EXIT) return { problem: 'wont_open' };
    if (terrain === T.LOCKED_DOOR) {
      if (levelLocked(world, hero) || level.branch) return { problem: 'wont_open' };
      return charge < 1 ? { problem: 'iron_charges' } : { use: 'unlock' };
    }
    if (terrain === T.HERO_LKD_DR) return { use: 'relock' };
    if (terrain === T.CRYSTAL_DOOR) return charge < 5 ? { problem: 'crystal_charges' } : { use: 'unlockCrystal' };
    if (terrain === T.DOOR || terrain === T.OPEN_DOOR) {
      if (charge < 2) return { problem: 'lock_charges' };
      const there = charAt(world, hero.depth, target);
      if (!there) return { use: 'lock' };
      const push = pushCell(world, hero, target);
      // (The original also refuses to push what cannot move; heroes and monsters here all can.)
      return push === -1 ? { problem: 'lock_no_space' } : { use: 'lock', push };
    }
    const heap = world.floors[hero.depth]?.heaps.find((h) => h.pos === target);
    if (heap?.kind === 'lockedChest') return charge < 2 ? { problem: 'gold_charges' } : { use: 'chest' };
    if (heap?.kind === 'crystalChest') return charge < 5 ? { problem: 'crystal_charges' } : { use: 'crystalChest' };
  }
  if (charge < 2) return { problem: 'wall_charges' };
  const idx = closestDirection(hero.pos, target);
  if (idx < 0 || hasFlag(level.map[hero.pos + PF_CIRCLE8[idx]!]!, F.SOLID)) return { problem: 'invalid_target' };
  return { use: 'wall' };
}

/** The direction round the hero nearest to the target (PathFinder.CIRCLE8), or -1. */
function closestDirection(from: number, target: number): number {
  const dist = (a: number, b: number): number => {
    const dx = cellX(a) - cellX(b);
    const dy = cellY(a) - cellY(b);
    return f32(Math.sqrt(dx * dx + dy * dy));
  };
  let closest = from;
  let idx = -1;
  for (let i = 0; i < PF_CIRCLE8.length; i++) {
    const cell = from + PF_CIRCLE8[i]!;
    if (dist(target, cell) < dist(target, closest)) {
      closest = cell;
      idx = i;
    }
  }
  return idx;
}

/** Where someone in a doorway is pushed: the cell beyond it from the hero, else the open one farthest from the hero; -1 if none. */
function pushCell(world: World, hero: Hero, target: number): number {
  const level = world.levels[hero.depth]!;
  const open = (cell: number): boolean => !hasFlag(level.map[cell]!, F.SOLID) && !charAt(world, hero.depth, cell);
  const opposite = target + (target - hero.pos);
  if (open(opposite)) return opposite;
  let best = -1;
  const dist = (a: number, b: number): number => {
    const dx = cellX(a) - cellX(b);
    const dy = cellY(a) - cellY(b);
    return dx * dx + dy * dy;
  };
  for (const n of PF_NEIGHBOURS8) {
    const cell = target + n;
    if (open(cell) && adjacent(cell, target) && (best === -1 || dist(hero.pos, best) < dist(hero.pos, cell))) best = cell;
  }
  return best;
}

export function skeletonKeyProblem(world: World, hero: Hero, action: SkeletonKeyAction): string | null {
  const key = Number.isInteger(action.item) ? hero.items[action.item] : undefined;
  if (key?.kind !== 'artifact.skeletonKey') return 'that is no skeleton key';
  if (key.cursed) return 'cursed';
  if (!Number.isInteger(action.target) || !world.levels[hero.depth]?.map[action.target] === undefined) return 'invalid_target';
  // Only where the hero has been, or has mapped.
  if (!exploredCells(world, hero.depth)[action.target]) return 'invalid_target';
  if (action.target === hero.pos) return 'invalid_target';
  const use = keyUse(world, hero, key, action.target);
  return 'problem' in use ? use.problem : null;
}

/** SkeletonKey.targeter: the key turns in the cell (a turn); its charge spent, its experience gained. */
export function useSkeletonKey(ctx: Ctx, hero: Hero, action: SkeletonKeyAction): number {
  const key = hero.items[action.item]!;
  const target = action.target;
  const use = keyUse(ctx.world, hero, key, target);
  if ('problem' in use) return 0;
  const level = ctx.level;
  const spendCharge = (n: number): void => {
    key.charge = keyCharge(key) - n;
  };
  switch (use.use) {
    case 'unlock':
      level.map[target] = T.DOOR;
      spendCharge(1);
      gainExp(ctx, hero, key, 2 + 1);
      break;
    case 'relock':
      // A door it locked opens freely: no charge, nothing learned.
      level.map[target] = T.DOOR;
      break;
    case 'unlockCrystal':
      level.map[target] = T.EMPTY;
      spendCharge(5);
      gainExp(ctx, hero, key, 2 + 5);
      break;
    case 'lock': {
      if (use.push !== undefined) {
        const there = charAt(ctx.world, ctx.depth, target)!;
        there.pos = use.push;
        if (isHero(there)) ctx.effects.push({ type: 'knockedBack', depth: ctx.depth, hero: there.id, from: target, to: use.push });
        else ctx.effects.push({ type: 'pushed', depth: ctx.depth, mob: there.id, from: target, to: use.push });
      }
      level.map[target] = T.HERO_LKD_DR;
      spendCharge(2);
      gainExp(ctx, hero, key, 2);
      // What lay in the doorway is thrown out of it, any which way.
      const index = ctx.floor.heaps.findIndex((h) => h.pos === target);
      if (index >= 0) {
        const candidates = PF_NEIGHBOURS8.map((n) => target + n).filter((c) => isPassable(level, c));
        if (candidates.length > 0) {
          const heap = ctx.floor.heaps.splice(index, 1)[0]!;
          for (const item of heap.items) dropItem(ctx.floor, candidates[ctx.rng.int(candidates.length)]!, item);
        }
      }
      break;
    }
    case 'chest':
    case 'crystalChest': {
      const heap = ctx.floor.heaps.find((h) => h.pos === target)!;
      ctx.effects.push({ type: 'opened', depth: ctx.depth, pos: target, heap: heap.kind });
      heap.kind = 'heap';
      const cost = use.use === 'chest' ? 2 : 5;
      spendCharge(cost);
      gainExp(ctx, hero, key, 2 + cost);
      break;
    }
    case 'wall': {
      const idx = closestDirection(hero.pos, target);
      const knockBack = PF_CIRCLE8[idx]!;
      const cells = [hero.pos + PF_CIRCLE8[idx]!, hero.pos + PF_CIRCLE8[(idx + 7) % 8]!, hero.pos + PF_CIRCLE8[(idx + 1) % 8]!];
      // On a diagonal, two more.
      if (idx % 2 === 0) cells.push(hero.pos + 2 * PF_CIRCLE8[(idx + 7) % 8]!, hero.pos + 2 * PF_CIRCLE8[(idx + 1) % 8]!);
      const placed = cells.filter((cell) => placeWall(ctx, cell, knockBack));
      spendCharge(2);
      gainExp(ctx, hero, key, 2);
      for (const h of heroesOn(ctx.world, ctx.depth)) observe(ctx.world, h);
      ctx.effects.push({ type: 'skeletonKey', hero: hero.id, target, use: 'wall', cells: placed });
      return 1;
    }
  }
  if (use.use !== 'relock') processExcessKeys(ctx, hero);
  ctx.effects.push({ type: 'skeletonKey', hero: hero.id, target, use: use.use === 'crystalChest' ? 'chest' : use.use });
  return 1;
}

/** SkeletonKey.placeWall: a wall where there is none (or a fresh one over its own), pushing an enemy there back a cell. */
function placeWall(ctx: Ctx, cell: number, knockBack: number): boolean {
  const walls = (ctx.floor.keyWalls ??= []);
  const existing = walls.find((w) => w.cell === cell);
  if (existing) {
    existing.left = WALL_TURNS;
  } else {
    if (hasFlag(ctx.level.map[cell]!, F.SOLID)) return false;
    walls.push({ cell, terrain: ctx.level.map[cell] === T.OPEN_DOOR ? T.DOOR : ctx.level.map[cell]!, left: WALL_TURNS });
    ctx.level.map[cell] = T.WALL;
  }
  const ch = charAt(ctx.world, ctx.depth, cell);
  if (ch && !isHero(ch) && isEnemyMob(ch)) {
    const to = cell + knockBack;
    if (isPassable(ctx.level, to) && !charAt(ctx.world, ctx.depth, to)) {
      ch.pos = to;
      ctx.effects.push({ type: 'pushed', depth: ctx.depth, mob: ch.id, from: cell, to });
    }
  }
  return true;
}

const isEnemyMob = (mob: Mob): boolean => mob.state !== 'passive' && mob.kind !== 'mirror';

/** SkeletonKey.gainExp: levels with use, the dungeon's locks teaching it most. */
function gainExp(ctx: Ctx, hero: Hero, key: Item, xp: number): void {
  if (key.level >= KEY_LEVEL_CAP) return;
  key.exp = (key.exp ?? 0) + xp;
  if (key.exp > 4 + key.level) {
    key.exp -= 4 + key.level;
    // SkeletonKey.upgrade: one more charge every two levels.
    key.level++;
    ctx.effects.push({ type: 'keyLevelUp', hero: hero.id });
  }
}

/**
 * KeyReplacementTracker.processExcessKeys: the keys of this depth beyond the locks left for them are
 * thrown away (iron keys for locked doors, golden for locked chests, crystal for crystal doors and chests).
 */
function processExcessKeys(ctx: Ctx, hero: Hero): void {
  const level = ctx.level;
  const heaps = ctx.floor.heaps;
  const needed: Record<'key.iron' | 'key.golden' | 'key.crystal', number> = {
    'key.iron': level.map.filter((t) => t === T.LOCKED_DOOR).length,
    'key.golden': heaps.filter((h) => h.kind === 'lockedChest').length,
    'key.crystal': level.map.filter((t) => t === T.CRYSTAL_DOOR).length + heaps.filter((h) => h.kind === 'crystalChest').length,
  };
  let removed = false;
  for (const kind of ['key.iron', 'key.golden', 'key.crystal'] as const) {
    let count = hero.items.filter((item) => item.kind === kind && item.depth === ctx.depth).length;
    while (count > needed[kind]) {
      hero.items.splice(hero.items.findIndex((item) => item.kind === kind && item.depth === ctx.depth), 1);
      count--;
      removed = true;
    }
  }
  if (removed) ctx.effects.push({ type: 'keysDiscarded', hero: hero.id });
}

/**
 * SkeletonKey.keyRecharge.act, a turn's worth (while carried, uncursed, and passive healing is on): 1 in
 * 120 turns at full, down to 1 in 60 when empty; and the key's walls, a turn older (KeyWall.evolve).
 */
export function skeletonKeyTurn(ctx: Ctx, hero: Hero): void {
  for (const key of hero.items) {
    if (key.kind !== 'artifact.skeletonKey' || key.cursed) continue;
    const cap = keyChargeCap(key);
    let charge = keyCharge(key);
    if (charge >= cap || !regenOn(ctx.world, hero)) continue;
    let partial = f32((key.partialCharge ?? 0) + f32(1 / f32(120 - f32((cap - charge) * 7.5))));
    while (partial >= 1) {
      partial = f32(partial - 1);
      charge++;
      if (charge === cap) partial = 0;
    }
    key.charge = charge;
    key.partialCharge = partial;
  }
  keyWallsTurn(ctx);
}

/** KeyWall.evolve: each wall a turn older; gone, the terrain under it is back. */
function keyWallsTurn(ctx: Ctx): void {
  const walls = ctx.floor.keyWalls;
  if (!walls || walls.length === 0) return;
  let ended = false;
  ctx.floor.keyWalls = walls.filter((wall) => {
    if (--wall.left > 0) return true;
    ctx.level.map[wall.cell] = wall.terrain === T.DOOR && charAt(ctx.world, ctx.depth, wall.cell) ? T.OPEN_DOOR : wall.terrain;
    ended = true;
    return false;
  });
  if (ended) for (const h of heroesOn(ctx.world, ctx.depth)) if (isAlive(h)) observe(ctx.world, h);
}
