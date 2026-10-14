import { type Hero, isAlive } from '../actors';
import { type Ctx, exploredCells, heroView } from '../floor';
import type { Item } from '../items';
import { discoverable } from '../level/flags';
import { adjacent, cellX, cellY, HEIGHT, LENGTH, NEIGHBOURS9, trueDistance, WIDTH } from '../level/geometry';
import { dpow } from '../fmath';
import { discover, F, hasFlag, T } from '../level/terrain';
import { trapAt } from '../traps';
import type { World } from '../world';
import { chargeCap, levelCap, visiblyUpgraded } from './artifact';
import { ballistica, cone, STOP_TARGET } from '../ballistica';
import { isWorn, say, upgradeArtifact, wornOf } from './common';
import { dispelInvisibility } from './invisibility';
import { artifactChargeMultiplier, artifactProc, magicImmune, onArtifactUsed, regenOn } from './seams';

/** PathFinder's true distance: straight across, not in steps. */

/*
 * TalismanOfForesight: worn, it warns of traps hidden nearby, and charges
 * slowly. Scrying, it sweeps a cone of the level, wider the closer, mapping
 * what it reaches, finding what is hidden there, and showing for a while
 * the creatures and the heaps it touched. It grows with what it reveals.
 */

/** A creature or a heap the talisman showed: seen as long as it lasts (CharAwareness, HeapAwareness). */
export interface Awareness {
  char?: string;
  pos?: number;
  depth: number;
  left: number;
}

/** TalismanOfForesight.maxDist: how far it can scry with the charge it has. */
const maxDist = (item: Item): number => Math.min(5 + 2 * item.level, ((item.charge ?? 0) - 3) / 1.08);

export function talismanProblem(hero: Hero, item: Item, cell: number | undefined): string | null {
  if (magicImmune(hero)) return 'art:magic_immune';
  if (!isWorn(hero, item)) return 'art:artifact.need_to_equip';
  if (item.cursed) return 'art:cannot';
  if ((item.charge ?? 0) < 5) return 'art:talismanofforesight.low_charge';
  if (cell === undefined || !Number.isInteger(cell) || cell < 0 || cell >= LENGTH || cell === hero.pos) return 'art:talismanofforesight.prompt';
  return null;
}

/** The scry listener: a cone towards the chosen cell (at least two cells off), as far as the charge reaches. */
export function scry(ctx: Ctx, hero: Hero, item: Item, cell: number): number {
  let target = cell;
  // At least two tiles of distance.
  if (adjacent(target, hero.pos)) {
    const x = Math.max(0, Math.min(WIDTH - 1, 2 * cellX(target) - cellX(hero.pos)));
    const y = Math.max(0, Math.min(HEIGHT - 1, 2 * cellY(target) - cellY(hero.pos)));
    target = x + y * WIDTH;
  }
  let dist = trueDistance(hero.pos, target);
  if (dist >= 3 && dist > maxDist(item)) {
    const trajectory = ballistica(ctx, hero.pos, target, STOP_TARGET);
    for (const step of trajectory.path) {
      if (trueDistance(hero.pos, step) > maxDist(item)) break;
      target = step;
    }
    dist = trueDistance(hero.pos, target);
  }
  // Two hundred degrees, eight in a hundred less a cell away.
  const angle = Math.round(200 * dpow(0.92, dist));
  // ConeAOE(core, degrees): as long as the core ray, its own params.
  const { cells } = cone(ctx, ballistica(ctx, hero.pos, target, STOP_TARGET), Infinity, angle, STOP_TARGET);
  const { world, level, floor } = ctx;
  const explored = exploredCells(world, hero.depth);
  const open = discoverable(level.map);
  const fov = heroView(world, hero);
  const lasts = 5 + 2 * item.level;
  let earned = 0;
  let noticed = false;
  for (const c of cells) {
    const seenBefore = explored[c];
    if (open[c] && !explored[c]) {
      explored[c] = true;
      earned++;
    }
    if (hasFlag(level.map[c]!, F.SECRET)) {
      const was = level.map[c]!;
      level.map[c] = discover(was);
      explored[c] = true;
      ctx.effects.push({ type: 'discovered', depth: hero.depth, cell: c });
      noticed = true;
      earned += was === T.SECRET_DOOR ? 100 : trapAt(level, c) ? 10 : 0;
    }
    const mob = floor.mobs.find((m) => m.pos === c && isAlive(m));
    // Not the neutral folk (a mimic is no neutral), nor the hero's allies.
    if (mob && mob.state !== 'passive' && mob.kind !== 'ghostHero') {
      (hero.aware ??= []).push({ char: mob.id, depth: hero.depth, left: lasts });
      artifactProc(ctx, mob, visiblyUpgraded(item), Math.trunc(3 + dist * 1.08));
      if (!fov[c]) earned += 10;
    }
    const heap = floor.heaps.find((h) => h.pos === c && h.kind !== 'hidden');
    if (heap) {
      (hero.aware ??= []).push({ pos: c, depth: hero.depth, left: lasts });
      // Heap.seen: what the party had not set eyes on yet.
      if (!seenBefore) earned += 10;
    }
  }
  item.exp = (item.exp ?? 0) + earned;
  if (item.exp >= 100 + 50 * item.level && item.level < levelCap(item)) {
    item.exp -= 100 + 50 * item.level;
    upgradeArtifact(ctx, item);
    say(ctx, hero, 'talismanofforesight.levelup', 'p');
  }
  // Five charge at two tiles, up to thirty at twenty-five.
  const cost = 3 + dist * 1.08;
  item.charge = Math.trunc((item.charge ?? 0) - cost);
  item.partial = (item.partial ?? 0) - ((dist * 1.08) % 1);
  if (item.partial < 0 && item.charge > 0) {
    item.partial++;
    item.charge--;
  }
  while (item.charge < 0) {
    item.charge++;
    item.partial--;
  }
  dispelInvisibility(ctx, hero);
  onArtifactUsed(ctx, hero);
  ctx.effects.push({ type: 'scried', depth: hero.depth, hero: hero.id, to: target, cells, noticed });
  return 1;
}

/** Foresight.act: it watches for hidden traps nearby, and charges, all of it in two thousand turns at +0, a thousand at +10. */
export function talismanAct(ctx: Ctx, hero: Hero, item: Item): void {
  checkAwareness(ctx, hero, item);
  const cap = chargeCap(item);
  if ((item.charge ?? 0) < cap && !item.cursed && !magicImmune(hero) && regenOn(ctx, hero)) {
    item.partial = (item.partial ?? 0) + (0.05 + item.level * 0.005) * artifactChargeMultiplier(hero);
    while (item.partial >= 1) {
      item.partial--;
      item.charge = (item.charge ?? 0) + 1;
      if (item.charge >= cap) {
        item.partial = 0;
        say(ctx, hero, 'talismanofforesight.full_charge', 'p');
      }
    }
  }
}

/** Foresight.checkAwareness: a hidden trap within three cells in sight makes the hero uneasy, once. */
export function checkAwareness(ctx: Ctx, hero: Hero, item: Item): void {
  const fov = heroView(ctx.world, hero);
  const map = ctx.level.map;
  let found = false;
  const cx = cellX(hero.pos);
  const cy = cellY(hero.pos);
  for (let y = Math.max(0, cy - 3); y <= Math.min(HEIGHT - 1, cy + 3) && !found; y++) {
    for (let x = Math.max(0, cx - 3); x <= Math.min(WIDTH - 1, cx + 3); x++) {
      const p = x + y * WIDTH;
      if (fov[p] && hasFlag(map[p]!, F.SECRET) && map[p] === T.SECRET_TRAP) {
        found = true;
        break;
      }
    }
  }
  if (found && !item.cursed && !magicImmune(hero)) {
    if (!item.warn) {
      say(ctx, hero, 'talismanofforesight$foresight.uneasy', 'w');
      ctx.effects.push({ type: 'interrupted', hero: hero.id, reason: 'art:talismanofforesight$foresight.uneasy' });
      item.warn = true;
    }
  } else {
    item.warn = false;
  }
}

/** TalismanOfForesight.charge: twice the boost. */
export function chargeTalisman(ctx: Ctx, hero: Hero, item: Item, amount: number): void {
  if (item.cursed || magicImmune(hero)) return;
  const cap = chargeCap(item);
  if ((item.charge ?? 0) >= cap) return;
  item.partial = (item.partial ?? 0) + 2 * amount;
  while (item.partial >= 1) {
    item.charge = (item.charge ?? 0) + 1;
    item.partial--;
  }
  if (item.charge! >= cap) {
    item.charge = cap;
    item.partial = 0;
    say(ctx, hero, 'talismanofforesight.full_charge', 'p');
  }
}

/** Hero.search with the talisman worn: cursed, it lets nothing be noticed in passing. */
export const talismanBlinds = (hero: Hero): boolean => wornOf(hero, 'artifact.talisman')?.cursed === true && !magicImmune(hero);

/** Hero.search: what was found charges the talisman (Foresight.charge: two for a trap, ten for a door). */
export function talismanFound(hero: Hero, door: boolean): void {
  const item = wornOf(hero, 'artifact.talisman');
  if (!item || item.cursed || magicImmune(hero)) return;
  item.charge = Math.min((item.charge ?? 0) + (door ? 10 : 2), chargeCap(item));
}

/** The creatures and heaps the talisman shows wear off with time (FlavourBuff). */
export function awarenessFades(hero: Hero, time: number): void {
  if (!hero.aware) return;
  for (const aware of hero.aware) aware.left -= time;
  hero.aware = hero.aware.filter((aware) => aware.left > 0);
  if (hero.aware.length === 0) delete hero.aware;
}

/** Dungeon.observe with CharAwareness and HeapAwareness: the cells around each shown creature or heap are seen. */
export function awareCells(world: World, hero: Hero, fov: boolean[]): void {
  if (!hero.aware) return;
  for (const aware of hero.aware) {
    if (aware.depth !== hero.depth) continue;
    let at = aware.pos;
    if (aware.char !== undefined) {
      const mob = world.floors[hero.depth]?.mobs.find((m) => m.id === aware.char);
      at = mob && isAlive(mob) ? mob.pos : undefined;
    }
    if (at === undefined) continue;
    for (const n of NEIGHBOURS9) {
      const c = at + n;
      if (c >= 0 && c < LENGTH && Math.abs((c % WIDTH) - (at % WIDTH)) <= 1) fov[c] = true;
    }
  }
}
