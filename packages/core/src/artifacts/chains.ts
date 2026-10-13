import { type Hero, isAlive, type Mob } from '../actors';
import { charAt, type Ctx, enterCell, exploredCells, isHero, leaveCell } from '../floor';
import type { Item } from '../items';
import { adjacent, distance, LENGTH, NEIGHBOURS8 } from '../level/geometry';
import { F, hasFlag } from '../level/terrain';
import { mobPress } from '../traps';
import { levelCap, visiblyUpgraded } from './artifact';
import { ballistica, STOP_TARGET, subPath } from '../ballistica';
import { isWorn, say, upgradeArtifact } from './common';
import { dispelInvisibility } from './invisibility';
import { heroPress } from './press';
import { artifactChargeMultiplier, artifactProc, magicImmune, onArtifactUsed, regenOn } from './seams';

/*
 * EtherealChains: cast at a creature, they pull it towards the hero; cast at
 * a wall, they pull the hero there, through anything in between — a charge a
 * cell either way. Worn, they charge with time and with the experience their
 * bearer gains, and grow from it. Cursed, they now and then cripple.
 */

/** Monsters the chains cannot move (Char.Property.IMMOVABLE). */
const IMMOVABLE: ReadonlySet<string> = new Set(['yog', 'rottingFist', 'burningFist', 'shopkeeper', 'impShopkeeper', 'ratKing', 'statue']);

/** Where a cast would pull, and how much it would cost; or why it cannot (the listener's messages). */
type Pull = { who: 'enemy'; mob: Mob; to: number; cost: number } | { who: 'hero'; to: number; cost: number } | { problem: string };

/** The soft cap of charge, past which experience charges the chains more slowly. */
const chargeTarget = (item: Item): number => 5 + item.level * 2;

/** PathFinder.buildDistanceMap over passable or avoided cells: can one walk from `from` to `to` at all? */
function walkable(ctx: Ctx, from: number, to: number): boolean {
  const map = ctx.level.map;
  const open = (c: number): boolean => hasFlag(map[c]!, F.PASSABLE) || hasFlag(map[c]!, F.AVOID);
  if (!open(to)) return false;
  const seen = new Uint8Array(LENGTH);
  const queue = [to];
  seen[to] = 1;
  for (let head = 0; head < queue.length; head++) {
    const c = queue[head]!;
    for (const n of NEIGHBOURS8) {
      const next = c + n;
      if (next < 0 || next >= LENGTH || seen[next] || !adjacent(c, next)) continue;
      if (next === from) return true;
      if (!open(next)) continue;
      seen[next] = 1;
      queue.push(next);
    }
  }
  return false;
}

function plan(ctx: Ctx, hero: Hero, item: Item, target: number): Pull {
  const { level, world, depth } = ctx;
  if (!exploredCells(world, depth)[target]) return { problem: 'art:etherealchains.prompt' };
  // Chains cannot be used to go where it is impossible to walk to.
  if (!walkable(ctx, hero.pos, target)) return { problem: 'art:etherealchains.cant_reach' };
  const chain = ballistica(ctx, hero.pos, target, STOP_TARGET);
  const there = charAt(world, depth, chain.collisionPos);
  if (there && !isHero(there)) {
    if (IMMOVABLE.has(there.kind) || there.state === 'passive') return { problem: 'art:etherealchains.cant_pull' };
    // As close to the hero as the path allows.
    const to = subPath(chain, 1, chain.dist).find((c) => !hasFlag(level.map[c]!, F.SOLID) && !charAt(world, depth, c));
    if (to === undefined) return { problem: 'art:etherealchains.does_nothing' };
    const cost = distance(there.pos, to);
    if (cost > (item.charge ?? 0)) return { problem: 'art:etherealchains.no_charge' };
    return { who: 'enemy', mob: there, to, cost };
  }
  if (hero.rooted > 0) return { problem: 'art:etherealchains.rooted' };
  const to = chain.collisionPos;
  const terrain = level.map[to]!;
  if (hasFlag(terrain, F.SOLID) || !(hasFlag(terrain, F.PASSABLE) || hasFlag(terrain, F.AVOID))) return { problem: 'art:etherealchains.inside_wall' };
  // Nothing solid next to it: nothing to grab.
  if (!NEIGHBOURS8.some((n) => to + n >= 0 && to + n < LENGTH && hasFlag(level.map[to + n]!, F.SOLID))) {
    return { problem: 'art:etherealchains.nothing_to_grab' };
  }
  const cost = distance(hero.pos, to);
  if (cost > (item.charge ?? 0)) return { problem: 'art:etherealchains.no_charge' };
  return { who: 'hero', to, cost };
}

/** The plan's refusal alone, whatever the item (for Trinity's chain-casting): null if the pull can be made. */
export function chainsPlanProblem(ctx: Ctx, hero: Hero, item: Item, cell: number): string | null {
  const pull = plan(ctx, hero, item, cell);
  return 'problem' in pull ? pull.problem : null;
}

export function chainsProblem(ctx: Ctx, hero: Hero, item: Item, cell: number | undefined): string | null {
  if (magicImmune(hero)) return 'art:magic_immune';
  if (!isWorn(hero, item)) return 'art:artifact.need_to_equip';
  if ((item.charge ?? 0) < 1) return 'art:etherealchains.no_charge';
  if (item.cursed) return 'art:etherealchains.cursed';
  if (cell === undefined || !Number.isInteger(cell) || cell < 0 || cell >= LENGTH || cell === hero.pos) return 'art:etherealchains.prompt';
  const pull = plan(ctx, hero, item, cell);
  return 'problem' in pull ? pull.problem : null;
}

/** The caster listener: chainEnemy or chainLocation. */
export function castChains(ctx: Ctx, hero: Hero, item: Item, cell: number): number {
  const pull = plan(ctx, hero, item, cell);
  if ('problem' in pull) return 0;
  const { world, level, depth } = ctx;
  if (pull.who === 'enemy') {
    const mob = pull.mob;
    const from = mob.pos;
    ctx.effects.push({ type: 'chained', depth, from: hero.pos, to: from, who: mob.id });
    mob.pos = pull.to;
    leaveCell(world, level, depth, from);
    ctx.effects.push({ type: 'pushed', depth, mob: mob.id, from, to: pull.to });
    item.charge! -= pull.cost;
    dispelInvisibility(ctx, hero);
    onArtifactUsed(ctx, hero);
    // Level.occupyCell: where it lands, it presses.
    mobPress(ctx, mob);
    if (isAlive(mob)) artifactProc(ctx, mob, visiblyUpgraded(item), pull.cost);
    return 1;
  }
  const from = hero.pos;
  ctx.effects.push({ type: 'chained', depth, from, to: pull.to, who: hero.id });
  hero.pos = pull.to;
  leaveCell(world, level, depth, from);
  enterCell(level, pull.to);
  ctx.effects.push({ type: 'pulled', depth, hero: hero.id, from, to: pull.to });
  item.charge! -= pull.cost;
  dispelInvisibility(ctx, hero);
  onArtifactUsed(ctx, hero);
  heroPress(ctx, hero);
  return 1;
}

/** chainsRecharge.act: a charge in 40 turns less two a missing one, up to the soft cap; cursed, now and then a cripple. */
export function chainsAct(ctx: Ctx, hero: Hero, item: Item): void {
  const target = chargeTarget(item);
  const charge = item.charge ?? 0;
  if (charge < target && !item.cursed && !magicImmune(hero) && regenOn(ctx, hero)) {
    item.partial = (item.partial ?? 0) + (1 / (40 - (target - charge) * 2)) * artifactChargeMultiplier(hero);
  } else if (item.cursed && ctx.rng.int(100) === 0) {
    // Buff.prolong(Cripple, 10).
    hero.crippled = Math.max(hero.crippled, 10);
  }
  while ((item.partial ?? 0) >= 1) {
    item.partial!--;
    item.charge = (item.charge ?? 0) + 1;
  }
}

/** chainsRecharge.gainExp: experience for the chains, and charge with it (slowed past the soft cap). */
export function chainsGainExp(ctx: Ctx, hero: Hero, item: Item, levelPortion: number): void {
  if (item.cursed || magicImmune(hero) || levelPortion === 0) return;
  item.exp = (item.exp ?? 0) + Math.round(levelPortion * 100);
  const target = chargeTarget(item);
  if ((item.charge ?? 0) > target) levelPortion *= target / item.charge!;
  item.partial = (item.partial ?? 0) + levelPortion * 6;
  if (item.exp > 100 + item.level * 100 && item.level < levelCap(item)) {
    item.exp -= 100 + item.level * 100;
    say(ctx, hero, 'etherealchains$chainsrecharge.levelup', 'p');
    upgradeArtifact(ctx, item);
  }
}

/** EtherealChains.charge: half the boost, up to twice the soft cap. */
export function chargeChains(hero: Hero, item: Item, amount: number): void {
  if (item.cursed || magicImmune(hero)) return;
  if ((item.charge ?? 0) >= chargeTarget(item) * 2) return;
  item.partial = (item.partial ?? 0) + 0.5 * amount;
  while (item.partial >= 1) {
    item.partial--;
    item.charge = (item.charge ?? 0) + 1;
  }
}
