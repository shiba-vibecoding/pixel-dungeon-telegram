import { type Ballistica, cone, STOP_SOLID, STOP_TARGET } from './ballistica';
import { charAt, type Ctx, dropItem } from './floor';
import { createItem, ItemGenerator } from './items';
import { NEIGHBOURS8 } from './level/geometry';
import { F, hasFlag, T } from './level/terrain';
import { plant, SEED_PLANTS } from './plants';
import { hasProp, isImmune } from './props';
import { growLotus } from './allies';
import { wandProc, type Zap } from './wands';

/*
 * WandOfRegrowth: a cone of growth, the longer and wider the more charges it
 * spends (one to three, three tenths of what it holds). Bare ground in it
 * turns to grass and whoever stands there is held by roots; tall grass
 * springs up along its middle and about it, now and then a seed pod or a
 * dewcatcher and a plant from a seed, and at three charges a golden lotus,
 * which makes plants set off near it leave their seeds behind. A wand used
 * past what it can bear (more the stronger it is and the further the hero
 * has come) grows only furrowed grass, which gives nothing.
 *
 * Seam for the levels stream: Pixel Dungeon has no furrowed grass yet;
 * plain grass stands in for it here.
 */

const f32 = Math.fround;

/** WandOfRegrowth.chargeLimit: twenty charges and more with every hero level, the more the stronger the wand; none from +10. */
export function chargeLimit(heroLevel: number, wandLevel: number): number {
  if (wandLevel >= 10) return Infinity;
  return Math.round(f32(20 + heroLevel * (2 + wandLevel) * (1 + Math.trunc(wandLevel / (50 - 5 * wandLevel)))));
}

export function regrowCone(z: Zap, bolt: Ballistica, target: number, cpc: number): void {
  const { ctx, hero, wand, staff } = z;
  const { rng, level } = ctx;
  const shape = cone(ctx, bolt, 2 + 2 * cpc, 20 + 10 * cpc, STOP_SOLID | STOP_TARGET);
  ctx.effects.push({ type: 'cone', depth: ctx.depth, from: hero.pos, cells: shape.outerRays.map((ray) => ray.path[ray.dist]!), bolt: 'foliage' });
  const wandLevel = (staff ?? wand).level;
  const limit = chargeLimit(hero.lvl, wandLevel);
  const furrowed = (wand.grown ?? 0) >= limit ? ((wand.overgrown ?? 0) + 1) / 5 : 0;
  let grassToPlace = Math.round(f32(f32(f32(3.67) + f32(z.level / 3)) * cpc));
  // Only where something can grow: bare ground and grass, no plant there, and nobody immovable.
  let cells = shape.cells.filter((cell) => {
    const terrain = level.map[cell]!;
    if (!(terrain === T.EMPTY || terrain === T.EMBERS || terrain === T.EMPTY_DECO || terrain === T.GRASS || terrain === T.HIGH_GRASS)) return false;
    const ch = charAt(ctx.world, ctx.depth, cell);
    if (hasProp(ch, 'immovable')) return false;
    if ((ctx.floor.plants ?? []).some((p) => p.pos === cell)) return false;
    if (terrain !== T.HIGH_GRASS) level.map[cell] = T.GRASS;
    if (ch) {
      wandProc(ctx, hero, ch, z.level, cpc);
      if (!isImmune(ch, 'roots')) ch.rooted = Math.max(ch.rooted ?? 0, 4 * cpc);
    }
    return true;
  });
  rng.shuffle(cells);
  if (cpc >= 3) {
    // The lotus, where it was aimed if it can, else as far along the middle as it can.
    let pos = -1;
    if (cells.includes(target) && !charAt(ctx.world, ctx.depth, target)) pos = target;
    else for (let i = bolt.path.length - 1; i >= 0 && pos < 0; i--) if (cells.includes(bolt.path[i]!) && !charAt(ctx.world, ctx.depth, bolt.path[i]!)) pos = bolt.path[i]!;
    if (pos >= 0) {
      cells = cells.filter((c) => c !== pos);
      growLotus(ctx, pos, z.level);
    }
  }
  const tallGrass = (cell: number): void => {
    level.map[cell] = rng.float() > furrowed ? T.HIGH_GRASS : T.GRASS;
  };
  // Tall grass along the middle of the cone.
  for (const cell of bolt.path) {
    if (grassToPlace > 0 && cells.includes(cell)) {
      tallGrass(cell);
      grassToPlace--;
      cells = [...cells.filter((c) => c !== cell), cell];
    }
  }
  // A seed pod or a dewcatcher (one in six a charge), and a plant (one in three a charge).
  if (cells.length > 0 && rng.float() > furrowed && rng.int(6) < cpc) plant(ctx, cells.shift()!, rng.int(2) === 0 ? 'seedpod' : 'dewcatcher');
  if (cells.length > 0 && rng.float() > furrowed && rng.int(3) < cpc) {
    const seed = new ItemGenerator(rng, ctx.depth).of('seed');
    plant(ctx, cells.shift()!, SEED_PLANTS[seed.kind]!);
  }
  for (const cell of cells) {
    if (grassToPlace <= 0 || bolt.path.includes(cell)) break;
    if (level.map[cell] === T.HIGH_GRASS) continue;
    tallGrass(cell);
    grassToPlace--;
  }
  // How much of what it can bear the wand has spent.
  const used = wand.grown ?? 0;
  if (used < limit) {
    wand.overgrown = 0;
    wand.grown = used + cpc;
    if (wand.grown > limit) {
      wand.overgrown = wand.grown - limit;
      wand.grown = limit;
    }
  } else {
    wand.overgrown = (wand.overgrown ?? 0) + cpc;
  }
}

/** WandOfRegrowth.Dewcatcher.activate: three to six dewdrops scattered around it. */
export function dewcatcher(ctx: Ctx, pos: number): void {
  scatter(ctx, pos, ctx.rng.normalIntRange(3, 6), () => createItem('dew'));
}

/** WandOfRegrowth.Seedpod.activate: two to four seeds scattered around it. */
export function seedpod(ctx: Ctx, pos: number): void {
  scatter(ctx, pos, ctx.rng.normalIntRange(2, 4), () => new ItemGenerator(ctx.rng, ctx.depth).of('seed'));
}

function scatter(ctx: Ctx, pos: number, count: number, make: () => ReturnType<typeof createItem>): void {
  const { level } = ctx;
  const candidates = NEIGHBOURS8.map((n) => pos + n).filter((c) => hasFlag(level.map[c]!, F.PASSABLE) && c !== level.entrance && c !== level.exit);
  for (let i = 0; i < count && candidates.length > 0; i++) {
    const cell = candidates.splice(ctx.rng.index(candidates.length), 1)[0]!;
    dropItem(ctx.floor, cell, make());
  }
}
