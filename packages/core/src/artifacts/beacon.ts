import { type Hero, isAlive, type Mob } from '../actors';
import { randomRespawnCell } from '../ai';
import { charAt, type Ctx, enterCell, isHero, leaveCell } from '../floor';
import type { Item } from '../items';
import { isBossDepth } from '../level/builder';
import { LENGTH, NEIGHBOURS8 } from '../level/geometry';
import type { World } from '../world';
import { chargeCap, levelCap } from './artifact';
import { ballistica, MAGIC_BOLT } from './bolt';
import { isWorn, say, upgradeArtifact } from './common';
import { dispelInvisibility } from './invisibility';
import { regenOn } from './seams';

/*
 * LloydsBeacon, Shattered's artifact: set anywhere, it takes its bearer back
 * there from any depth, at once and as often as wanted. Worn, it also zaps:
 * whoever the bolt hits is teleported somewhere on the level (the hero, if
 * aimed at themselves), a charge a zap (two below depth 20). Every boss slain
 * makes it hold another charge. Nothing works on a boss's level, nor with a
 * monster right beside the hero.
 */

/** Monsters a beacon's bolt cannot move (Char.Property.IMMOVABLE). */
const IMMOVABLE: ReadonlySet<string> = new Set(['yog', 'rottingFist', 'burningFist', 'shopkeeper', 'impShopkeeper', 'ratKing', 'statue']);

/** The charges a zap takes: two in the depths below the 20th. */
const zapCost = (hero: Hero): number => (hero.depth > 20 ? 2 : 1);

export function beaconProblem(world: World, hero: Hero, item: Item, use: string, cell: number | undefined): string | null {
  if (use === 'set' || use === 'return') {
    if (use === 'return' && !item.returnTo) return 'art:cannot';
    // The psychic aura of creatures nearby (a companion's is no hindrance).
    const mobs = world.floors[hero.depth]?.mobs ?? [];
    if (NEIGHBOURS8.some((n) => mobs.some((mob) => mob.pos === hero.pos + n && hostile(mob)))) return 'art:lloydsbeacon.creatures';
    return null;
  }
  if (!isWorn(hero, item)) return 'art:artifact.need_to_equip';
  if ((item.charge ?? 0) < zapCost(hero)) return 'art:lloydsbeacon.no_charge';
  if (cell === undefined || !Number.isInteger(cell) || cell < 0 || cell >= LENGTH) return 'art:lloydsbeacon.prompt';
  return null;
}

const hostile = (mob: Mob): boolean => mob.state !== 'passive' && mob.kind !== 'ghostHero' && mob.kind !== 'bee' && mob.kind !== 'mirror';

/** Setting or returning on a boss's level: the beacon will not work, and the turn is wasted. */
export function beaconPrevented(ctx: Ctx, hero: Hero): boolean {
  if (!isBossDepth(hero.depth) && !ctx.world.arena) return false;
  say(ctx, hero, 'lloydsbeacon.preventing', 'w');
  return true;
}

/** LloydsBeacon.execute(SET): here, from now on. */
export function setBeacon(ctx: Ctx, hero: Hero, item: Item): number {
  item.returnTo = { depth: hero.depth, pos: hero.pos };
  say(ctx, hero, 'lloydsbeacon.return');
  ctx.effects.push({ type: 'beacon', hero: hero.id, mode: 'set' });
  return 1;
}

/** The zapper: a bolt that teleports whoever it hits elsewhere on the level. */
export function zapBeacon(ctx: Ctx, hero: Hero, item: Item, cell: number, teleportHero: () => void): number {
  dispelInvisibility(ctx, hero);
  item.charge = (item.charge ?? 0) - zapCost(hero);
  if (cell === hero.pos) {
    teleportHero();
    return 1;
  }
  const bolt = ballistica(ctx, hero.pos, cell, MAGIC_BOLT);
  const ch = charAt(ctx.world, ctx.depth, bolt.collisionPos);
  if (ch === hero) {
    teleportHero();
    return 1;
  }
  ctx.effects.push({ type: 'zapped', depth: ctx.depth, from: hero.pos, to: bolt.collisionPos, bolt: 'beacon' });
  if (!ch || isHero(ch) || !isAlive(ch)) return 1;
  let pos = -1;
  for (let count = 10; pos === -1 && count >= 0; count--) pos = randomRespawnCell(ctx.rng, ctx.world, ctx.level, () => true);
  if (pos === -1 || isBossDepth(ctx.depth)) {
    say(ctx, hero, 'items.scrolls.scrollofteleportation.no_tele', 'w');
  } else if (IMMOVABLE.has(ch.kind)) {
    say(ctx, hero, 'lloydsbeacon.tele_fail', 'w');
  } else {
    const from = ch.pos;
    ch.pos = pos;
    leaveCell(ctx.world, ctx.level, ctx.depth, from);
    enterCell(ctx.level, pos);
    if (ch.state === 'hunting') ch.state = 'wandering';
    ctx.effects.push({ type: 'jumped', depth: ctx.depth, mob: ch.id, from, to: pos });
  }
  return 1;
}

/** beaconRecharge.act: a charge in 100 turns less ten a missing one. */
export function beaconAct(ctx: Ctx, hero: Hero, item: Item): void {
  const cap = chargeCap(item);
  const charge = item.charge ?? 0;
  if (charge < cap && !item.cursed && regenOn(ctx, hero)) {
    item.partial = (item.partial ?? 0) + 1 / (100 - (cap - charge) * 10);
    while (item.partial >= 1) {
      item.partial--;
      item.charge = (item.charge ?? 0) + 1;
      if (item.charge === cap) item.partial = 0;
    }
  }
}

/** LloydsBeacon.charge: a quarter of the boost. */
export function chargeBeacon(item: Item, amount: number): void {
  const cap = chargeCap(item);
  if ((item.charge ?? 0) >= cap) return;
  item.partial = (item.partial ?? 0) + 0.25 * amount;
  while (item.partial >= 1) {
    item.partial--;
    item.charge = (item.charge ?? 0) + 1;
  }
  if (item.charge! >= cap) {
    item.partial = 0;
    item.charge = cap;
  }
}

/** Tengu.die, DM300.die and DwarfKing.die: a beacon the hero carries grows a level (LloydsBeacon.upgrade). */
export function bossSlainBeacon(ctx: Ctx): void {
  for (const hero of ctx.world.heroes) {
    const beacon = [hero.artifact, hero.misc, ...hero.items].find((item) => item?.kind === 'artifact.beacon');
    if (!beacon || beacon.level >= levelCap(beacon)) continue;
    upgradeArtifact(ctx, beacon);
    say(ctx, hero, 'lloydsbeacon.levelup', 'p');
  }
}
