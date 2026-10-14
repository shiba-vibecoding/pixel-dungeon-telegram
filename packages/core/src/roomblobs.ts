import { isAlive } from './actors';
import { burnHeaps } from './cooking';
import { type Ctx, type Floor, heroesOn, isHero } from './floor';
import type { Level } from './level/generate';
import { distance, LENGTH, WIDTH } from './level/geometry';
import { F, hasFlag, T } from './level/terrain';
import { immuneTo } from './traps';

/*
 * The lasting blobs Shattered's special rooms are made with, as the depth keeps them (Floor):
 * MagicalFireRoom's eternal fire, ToxicGasRoom's gas and the vents that keep it coming (ToxicGasSeed),
 * GardenRoom's foliage. The gas itself is gas.ts's toxic cloud.
 */

/** Burning.reignite(ch, 4): what the eternal fire sets alight for. */
const ETERNAL_BURNING = 4;

/** Level.spawn's blobs (Blob.seed at generation) laid onto the depth when it is first visited. */
export function spawnLevelBlobs(level: Level, floor: Floor): void {
  const blobs = level.spawn?.blobs ?? [];
  for (const blob of blobs) {
    switch (blob.kind) {
      case 'ToxicGas': {
        // ToxicGasRoom: as if the gas had been spreading in the room a while.
        const cloud = ((floor.gas ??= {}).toxic ??= []);
        const at = cloud.find(([cell]) => cell === blob.cell);
        if (at) at[1] += blob.amount;
        else cloud.push([blob.cell, blob.amount]);
        break;
      }
      case 'ToxicGasSeed':
        (floor.vents ??= []).push([blob.cell, blob.amount]);
        break;
      case 'EternalFire':
        (level.eternalFire ??= []).push(blob.cell);
        break;
      case 'Foliage':
        (floor.foliage ??= []).push(blob.cell);
        break;
      // SEAM(alchemy): the Alchemy blob (the pot's energy) is the alchemy stream's; wells are the level's.
    }
  }
  floor.gas?.toxic?.sort((a, b) => a[0] - b[0]);
  // Blobs act on the depth's clock, a turn at a time (gas.ts).
  if (floor.gas?.toxic?.length || floor.vents?.length || level.eternalFire?.length) floor.gasAt ??= floor.now;
  if (level.spawn) level.spawn.blobs = [];
}

/** Whether the depth's room blobs still need their turns. */
export const roomBlobsActive = (level: Level | undefined, floor: Floor): boolean => (floor.vents?.length ?? 0) > 0 || (level?.eternalFire?.length ?? 0) > 0;

/** A turn of the room blobs, before the gas spreads (gas.ts evolveGas). */
export function evolveRoomBlobs(ctx: Ctx): void {
  evolveVents(ctx);
  evolveEternalFire(ctx);
}

/**
 * ToxicGasRoom.ToxicGasSeed.evolve: every vent still in place (its inactive trap) lets out its gas,
 * unless the cloud there is already more than nine times as thick.
 */
function evolveVents(ctx: Ctx): void {
  const vents = ctx.floor.vents;
  if (!vents) return;
  const live = vents.filter(([cell]) => ctx.level.map[cell] === T.INACTIVE_TRAP);
  const cloud = ((ctx.floor.gas ??= {}).toxic ??= []);
  for (const [cell, amount] of live) {
    const at = cloud.find(([c]) => c === cell);
    if (!at) cloud.push([cell, amount]);
    else if (at[1] <= 9 * amount) at[1] += amount;
  }
  cloud.sort((a, b) => a[0] - b[0]);
  if (live.length > 0) ctx.floor.vents = live;
  else delete ctx.floor.vents;
}

/**
 * MagicalFireRoom.EternalFire.evolve: water under any of it puts all of it out; otherwise it burns
 * whoever stands in it or beside it (four ways), the flammable cells around catch fire, and heaps there
 * burn (but not on the room's special floor, nor in water).
 */
function evolveEternalFire(ctx: Ctx): void {
  const { level } = ctx;
  const fire = level.eternalFire;
  if (!fire || fire.length === 0) return;
  if (fire.some((cell) => level.map[cell] === T.WATER)) {
    quenchEternalFire(ctx);
    return;
  }
  const near = new Set<number>();
  for (const cell of fire) for (const n of [0, -1, 1, -WIDTH, WIDTH]) if (cell + n >= 0 && cell + n < LENGTH) near.add(cell + n);
  for (const cell of [...near].sort((a, b) => a - b)) {
    if (hasFlag(level.map[cell]!, F.FLAMABLE)) {
      // SEAM(wands): Blob.seed(cell, 4, Fire): burnt down at once, as trap-effects.ts's fire does.
      level.map[cell] = T.EMBERS;
      ctx.effects.push({ type: 'burnt', depth: ctx.depth, pos: cell });
    }
    const ch = heroesOn(ctx.world, ctx.depth).find((h) => h.pos === cell) ?? ctx.floor.mobs.find((m) => m.pos === cell);
    if (ch && isAlive(ch) && !immuneTo(ch, 'burning') && (isHero(ch) || ch.state !== 'passive')) {
      ch.burning = Math.max(ch.burning ?? 0, ETERNAL_BURNING);
    }
    if (level.map[cell] !== T.EMPTY_SP && level.map[cell] !== T.WATER) burnHeaps(ctx, cell, 0);
  }
}

/**
 * EternalFire.clear: frost or a blizzard on or beside any of it (or water under it, or a potion of
 * purity's cleansing) puts the whole of it out.
 */
export function quenchEternalFire(ctx: Ctx): void {
  if (!ctx.level.eternalFire?.length) return;
  ctx.effects.push({ type: 'blob', depth: ctx.depth, blob: 'freezing', cells: [...ctx.level.eternalFire] });
  delete ctx.level.eternalFire;
}

/** Freezing reaches these cells: the eternal fire on or beside any of them goes out. */
export function freezeEternalFire(ctx: Ctx, cells: readonly number[]): void {
  const fire = ctx.level.eternalFire;
  if (fire?.some((f) => cells.some((c) => distance(c, f) <= 1))) quenchEternalFire(ctx);
}

/** A burst of frost or of cleansing air within `radius` of a cell: the eternal fire it reaches (or borders) goes out. */
export function burstOnEternalFire(ctx: Ctx, pos: number, radius: number): void {
  if (ctx.level.eternalFire?.some((cell) => distance(cell, pos) <= radius + 1)) quenchEternalFire(ctx);
}
