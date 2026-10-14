import { beckon, createMob, type Hero, isAlive, type Mob, type MobKind, mobStats, MOBS } from './actors';
import { dealMob, rollMob } from './spawner';
import { freezeEternalFire } from './roomblobs';
import { randomRespawnCell } from './ai';
import { isChallenged } from './challenges';
import { charArmor, type Hazard, hurt } from './combat';
import { burnHeaps, freezeHeaps } from './cooking';
import {
  charAt, type Char, type Ctx, enterCell, exploredCells, heroesOn, heroSight, heroView, isHero, landItem, leaveCell, observe,
} from './floor';
import { seedGas } from './gas';
import { type Heap, type Item, itemDef, ItemGenerator, type ItemKind, randomEnchantment } from './items';
import { isBossDepth } from './level/builder';
import { cellX, cellY, distance, LENGTH, WIDTH } from './level/geometry';
import { F, hasFlag, T } from './level/terrain';
import type { TrapInfo } from './level/trapdefs';
import { scaleMob } from './party';
import { stepOnPlant } from './plants';
import { isUpgradable } from './scrolls';
import { S } from './spd-sprites';
import { type Burst, burst, immuneTo, mobFall, mobPress, springTrap, trapAt, triggerTrap } from './traps';
import { frostHurtsElemental } from './wandmaker-mobs';

/*
 * What each of Shattered's traps does when it goes off (Trap.activate, levels/traps/*). The power
 * of a trap lying on its level is its depth (Trap.scalingDepth). Systems the traps lean on that
 * other parts of the port are still bringing over (the Fire, Freezing, Electricity and confusion
 * blobs, Shattered's conditions, curses, some monsters) go through small stand-ins marked SEAM.
 */

const W = WIDTH;
/** PathFinder.NEIGHBOURS8 and NEIGHBOURS9 in Shattered's order, which decides the random picks among them. */
const N8: readonly number[] = [-W - 1, -W, -W + 1, -1, +1, W - 1, W, W + 1];
const N9: readonly number[] = [-W - 1, -W, -W + 1, -1, 0, +1, W - 1, W, W + 1];
const N4: readonly number[] = [-W, -1, +1, +W];
/** PathFinder.CIRCLE8: clockwise from the top left. */
const CIRCLE8: readonly number[] = [-W - 1, -W, -W + 1, +1, W + 1, W, W - 1, -1];
/** Integer.MAX_VALUE: a cell PathFinder did not reach. */
const FAR = 0x7fffffff;
const f32 = Math.fround;

/** Burning.DURATION, Blindness.DURATION, Cripple.DURATION, Paralysis.DURATION, Weakness.DURATION, Vertigo.DURATION. */
const BURNING = 8;
const BLINDNESS = 10;
const CRIPPLE = 10;
const PARALYSIS = 10;
const WEAKNESS = 20;
const VERTIGO = 10;
/** SummoningTrap.DELAY and DistortionTrap.DELAY: the newcomers act this much later. */
const SUMMON_DELAY = 2;
/** Wraith.SPAWN_DELAY. */
const WRAITH_DELAY = 2;
/** Challenges.STRONGER_BOSSES. SEAM(challenges): not one of pd-ts's challenges yet, so never set. */
const STRONGER_BOSSES = 256;

/**
 * SEAM(levels): the Hazard a trap's own blow counts as, for the death message. combat.ts has no trap
 * sources but the gripping trap's ("a gripping trap"); Shattered names each trap (Dungeon.fail(trap)).
 */
const TRAP_HAZARD: Hazard = 'gripping';

/* Char.Property, for the kinds pd-ts has (SEAM(mobs): Shattered's own monsters bring theirs). */
const BOSS: ReadonlySet<MobKind> = new Set<MobKind>(['goo', 'tengu', 'dm300', 'king', 'yog', 'rottingFist', 'burningFist']);
const MINIBOSS: ReadonlySet<MobKind> = new Set<MobKind>(['fetidRat', 'curse', 'rotHeart', 'rotLasher', 'newbornElemental']);
const IMMOVABLE: ReadonlySet<MobKind> = new Set<MobKind>(['shopkeeper', 'impShopkeeper', 'imp', 'wandmaker', 'blacksmith', 'king', 'yog', 'rotHeart', 'rotLasher']);
const LARGE: ReadonlySet<MobKind> = new Set<MobKind>(['golem', 'dm300', 'ghost']);
const FIERY: ReadonlySet<MobKind> = new Set<MobKind>(['elemental', 'burningFist', 'newbornElemental']);
const hasProp = (ch: Char, prop: ReadonlySet<MobKind>): boolean => !isHero(ch) && prop.has(ch.kind);
const largeKind = (kind: MobKind): boolean => LARGE.has(kind);

/** Char.flying: a floating hero, a flying monster. */
const flying = (ch: Char): boolean => (isHero(ch) ? (ch.levitating ?? 0) > 0 : MOBS[ch.kind].flying === true);

/* The level's flag maps (Level.solid, passable…), read off the terrain. */
const flagAt = (ctx: Ctx, cell: number, flag: number): boolean => cell >= 0 && cell < LENGTH && hasFlag(ctx.level.map[cell]!, flag);
const solid = (ctx: Ctx, cell: number): boolean => flagAt(ctx, cell, F.SOLID);
const passable = (ctx: Ctx, cell: number): boolean => flagAt(ctx, cell, F.PASSABLE);
const avoid = (ctx: Ctx, cell: number): boolean => flagAt(ctx, cell, F.AVOID);
const pit = (ctx: Ctx, cell: number): boolean => flagAt(ctx, cell, F.PIT);
const water = (ctx: Ctx, cell: number): boolean => flagAt(ctx, cell, F.LIQUID);
const flamable = (ctx: Ctx, cell: number): boolean => flagAt(ctx, cell, F.FLAMABLE);
const secret = (ctx: Ctx, cell: number): boolean => flagAt(ctx, cell, F.SECRET);
const insideMap = (cell: number): boolean => cell >= W && cell < LENGTH - W && cell % W !== 0 && cell % W !== W - 1;

/** Level.openSpace: not solid, with an open corner whose two sides are open too (room for a large monster). */
function openSpace(ctx: Ctx, cell: number): boolean {
  if (solid(ctx, cell)) return false;
  for (let j = 1; j < CIRCLE8.length; j += 2) {
    if (solid(ctx, cell + CIRCLE8[j]!)) continue;
    if (!solid(ctx, cell + CIRCLE8[(j + 1) % 8]!) && !solid(ctx, cell + CIRCLE8[(j + 2) % 8]!)) return true;
  }
  return false;
}

/** PathFinder.buildDistanceMap: steps from `from` through the cells `ok` allows, up to `limit`; FAR where it does not reach. */
function distanceMap(ctx: Ctx, from: number, ok: (cell: number) => boolean, limit = FAR): Int32Array {
  const dist = new Int32Array(LENGTH).fill(FAR);
  dist[from] = 0;
  const queue = [from];
  for (let head = 0; head < queue.length; head++) {
    const cell = queue[head]!;
    const d = dist[cell]!;
    if (d >= limit) continue;
    for (const n of N8) {
      const next = cell + n;
      if (next < 0 || next >= LENGTH || distance(cell, next) !== 1 || dist[next] !== FAR || !ok(next)) continue;
      dist[next] = d + 1;
      queue.push(next);
    }
  }
  return dist;
}

/** The cells a distance map reached, in cell order (as the traps loop over PathFinder.distance). */
const reached = (dist: Int32Array): number[] => {
  const cells: number[] = [];
  dist.forEach((d, cell) => {
    if (d < FAR) cells.push(cell);
  });
  return cells;
};

/** A 5x5 patch around a cell, not through walls (buildDistanceMap(pos, not(solid), 2)). */
const patch = (ctx: Ctx, pos: number): number[] => reached(distanceMap(ctx, pos, (c) => !solid(ctx, c), 2));
/** The cell and its neighbours, but walls. */
const around9 = (ctx: Ctx, pos: number): number[] => N9.map((n) => pos + n).filter((c) => !solid(ctx, c));

const charOn = (ctx: Ctx, cell: number): Char | undefined => charAt(ctx.world, ctx.depth, cell);
const heapOn = (ctx: Ctx, cell: number): Heap | undefined => ctx.floor.heaps.find((heap) => heap.pos === cell);
const nextMobId = (ctx: Ctx): string => `#${++ctx.world.nextId}`;

/** Level.heroFOV: what the party sees. */
function partyView(ctx: Ctx): boolean[] {
  const seen = new Array<boolean>(LENGTH).fill(false);
  for (const hero of heroesOn(ctx.world, ctx.depth)) {
    heroView(ctx.world, hero).forEach((v, i) => {
      if (v) seen[i] = true;
    });
  }
  return seen;
}

/** Whether the level is laid out in Shattered's rooms (a RegularLevel), not a boss level's older layout. */
const isRegularLevel = (ctx: Ctx): boolean => ctx.level.rooms.some((room) => room.kind !== undefined);

/** Collections.shuffle(list, Random): from the end down, each place swapped with one at or before it. */
function javaShuffle<T>(ctx: Ctx, list: T[]): void {
  for (let i = list.length - 1; i > 0; i--) {
    const j = ctx.rng.int(i + 1);
    const t = list[i]!;
    list[i] = list[j]!;
    list[j] = t;
  }
}

/**
 * Char.drRoll: a roll of the armour, NormalIntRange(0, dr) as a monster's.
 * SEAM(gear): the hero's is Armor.DRRoll (between its DRMin and DRMax) once armour is Shattered's.
 */
const drRoll = (ctx: Ctx, ch: Char): number => ctx.rng.normalIntRange(0, charArmor(ch));

/** Char.damage from a trap: shown, then dealt. */
function harm(ctx: Ctx, ch: Char, damage: number, source: Hazard = TRAP_HAZARD): void {
  if (damage <= 0 || !isAlive(ch)) return;
  ctx.effects.push({ type: 'hurt', depth: ctx.depth, who: ch.id, damage });
  hurt(ctx, ch, damage, source);
}

/* Moving characters and items about (ScrollOfTeleportation, Level.occupyCell, Level.drop). */

/**
 * Level.occupyCell for someone a trap moved: a monster as Level.mobPress; a hero presses the cell
 * hard (hidden traps too) and sets off a plant there, unless floating. A hero moved over a chasm
 * falls when their turn ends (world.ts overChasm).
 */
function occupy(ctx: Ctx, ch: Char): void {
  if (!isHero(ch)) {
    mobPress(ctx, ch);
    return;
  }
  enterCell(ctx.level, ch.pos);
  // Dungeon.observe: the hero sees from where they now stand.
  observe(ctx.world, ch);
  if (flying(ch)) return;
  if (trapAt(ctx.level, ch.pos)) triggerTrap(ctx, ch, ch.pos);
  if (isAlive(ch) && ch.depth === ctx.depth) stepOnPlant(ctx, ch, ch.pos);
}

/** ScrollOfTeleportation.appear, then occupyCell, and Roots let go. */
function appear(ctx: Ctx, ch: Char, pos: number): void {
  const from = ch.pos;
  ch.pos = pos;
  leaveCell(ctx.world, ctx.level, ctx.depth, from);
  if (isHero(ch)) ctx.effects.push({ type: 'teleported', hero: ch.id });
  else ctx.effects.push({ type: 'jumped', depth: ctx.depth, mob: ch.id, from, to: pos });
  occupy(ctx, ch);
  ch.rooted = 0;
}

/**
 * Level.randomRespawnCell(ch): a free cell out of the party's sight, not the exit; room for a large
 * monster. pd-ts's RegularLevel.randomRespawnCell (ai.ts) picks the cell.
 */
function respawnCell(ctx: Ctx, large: boolean): number {
  const seen = partyView(ctx);
  return randomRespawnCell(ctx.rng, ctx.world, ctx.level, (cell) => !seen[cell] && cell !== ctx.level.exit && (!large || openSpace(ctx, cell)));
}

/** ScrollOfTeleportation.teleportChar: somewhere else on the level, out of sight; false if it stays. */
function teleportChar(ctx: Ctx, ch: Char): boolean {
  if (!isRegularLevel(ctx)) return teleportInNonRegularLevel(ctx, ch);
  if (hasProp(ch, IMMOVABLE)) return false;
  let count = 20;
  let pos: number;
  do {
    pos = respawnCell(ctx, hasProp(ch, LARGE));
    if (count-- <= 0) break;
  } while (pos === -1 || secret(ctx, pos));
  if (pos === -1) return false;
  appear(ctx, ch, pos);
  return true;
}

/** ScrollOfTeleportation.teleportInNonRegularLevel: anywhere it could walk to, out of sight if it can be. */
function teleportInNonRegularLevel(ctx: Ctx, ch: Char): boolean {
  if (hasProp(ch, IMMOVABLE)) return false;
  const large = hasProp(ch, LARGE);
  const dist = distanceMap(ctx, ch.pos, (c) => passable(ctx, c) && (!large || openSpace(ctx, c)));
  const seen = partyView(ctx);
  const visible: number[] = [];
  const unseen: number[] = [];
  for (const cell of reached(dist)) {
    if (secret(ctx, cell) || charOn(ctx, cell)) continue;
    (seen[cell] ? visible : unseen).push(cell);
  }
  const pool = unseen.length > 0 ? unseen : visible;
  if (pool.length === 0) return false;
  appear(ctx, ch, ctx.rng.element(pool)!);
  return true;
}

/** ScrollOfTeleportation.teleportToLocation: to that very cell, if it is free and could be walked to. */
function teleportToLocation(ctx: Ctx, ch: Char, pos: number): boolean {
  const dist = distanceMap(ctx, pos, (c) => passable(ctx, c) || avoid(ctx, c));
  const there = charOn(ctx, pos);
  if (dist[ch.pos] === FAR || (!passable(ctx, pos) && !avoid(ctx, pos)) || (there && there !== ch)) return false;
  appear(ctx, ch, pos);
  return true;
}

/** Heap.pickUp: the top item taken off; an emptied heap is gone. */
function pickUp(ctx: Ctx, heap: Heap): Item {
  const item = heap.items.shift()!;
  if (heap.items.length === 0) ctx.floor.heaps.splice(ctx.floor.heaps.indexOf(heap), 1);
  return item;
}

/** Level.drop: the item comes down there (or through the chasm there) and presses the cell. */
function dropAt(ctx: Ctx, item: Item, cell: number): void {
  landItem(ctx, cell, item);
  if (pit(ctx, cell)) return;
  if (trapAt(ctx.level, cell)) triggerTrap(ctx, null, cell);
  stepOnPlant(ctx, null, cell);
}

/** Level.visited / mapped around a cell: the party's map shows it. */
function mapAround(ctx: Ctx, cell: number): void {
  const explored = exploredCells(ctx.world, ctx.depth);
  for (const n of N9) if (cell + n >= 0 && cell + n < LENGTH) explored[cell + n] = true;
}

/* Ballistica and WandOfBlastWave.throwChar, for the dart traps' aim and the geyser's blast. */

const STOP_TARGET = 1;
const STOP_CHARS = 2;
const STOP_SOLID = 4;
const PROJECTILE = STOP_TARGET | STOP_CHARS | STOP_SOLID;
const MAGIC_BOLT = STOP_CHARS | STOP_SOLID;

interface Ballistica {
  /** The whole line, on past the collision to the edge of the map. */
  path: number[];
  collisionPos: number;
  dist: number;
}

/** Ballistica: a straight line from `from` towards `to` and beyond, and where it collides. */
function ballistica(ctx: Ctx, from: number, to: number, params: number): Ballistica {
  const stopTarget = (params & STOP_TARGET) > 0;
  const stopChars = (params & STOP_CHARS) > 0;
  const stopTerrain = (params & STOP_SOLID) > 0;
  const path: number[] = [];
  let collisionPos: number | null = null;
  const collide = (cell: number): void => {
    collisionPos ??= cell;
  };
  let dx = cellX(to) - cellX(from);
  let dy = cellY(to) - cellY(from);
  const stepX = dx > 0 ? 1 : -1;
  const stepY = dy > 0 ? 1 : -1;
  dx = Math.abs(dx);
  dy = Math.abs(dy);
  const [stepA, stepB, dA, dB] = dx > dy ? [stepX, stepY * W, dx, dy] : [stepY * W, stepX, dy, dx];
  let cell = from;
  let err = Math.trunc(dA / 2);
  while (insideMap(cell)) {
    // In solid terrain with no one there: it collides with the cell before (not short of a closed door).
    if (collisionPos === null && stopTerrain && cell !== from && !passable(ctx, cell) && !avoid(ctx, cell) && !charOn(ctx, cell)) {
      collide(path[path.length - 1]!);
    }
    path.push(cell);
    if (collisionPos === null && stopTerrain && cell !== from && solid(ctx, cell)) collide(cell);
    if (collisionPos === null && cell !== from && stopChars && charOn(ctx, cell)) collide(cell);
    if (collisionPos === null && cell === to && stopTarget) collide(cell);
    cell += stepA;
    err += dB;
    if (err >= dA) {
      err -= dA;
      cell += stepB;
    }
  }
  if (collisionPos !== null) return { path, collisionPos, dist: path.indexOf(collisionPos) };
  if (path.length > 0) return { path, collisionPos: path[path.length - 1]!, dist: path.length - 1 };
  return { path: [from], collisionPos: from, dist: 0 };
}

/**
 * WandOfBlastWave.throwChar: thrown along the line up to `power` cells (a boss half as far), never
 * into someone; slammed into what stopped it, it is hurt and dazed. Then it presses where it lands.
 */
function throwChar(ctx: Ctx, ch: Char, line: Ballistica, power: number): void {
  if (hasProp(ch, BOSS)) power = Math.trunc((power + 1) / 2);
  let dist = Math.min(line.dist, power);
  let collided = dist === line.dist;
  if (dist <= 0 || (ch.rooted ?? 0) > 0 || hasProp(ch, IMMOVABLE)) return;
  if (hasProp(ch, LARGE)) {
    for (let i = 1; i <= dist; i++) {
      if (!openSpace(ctx, line.path[i]!)) {
        dist = i - 1;
        collided = true;
        break;
      }
    }
  }
  if (charOn(ctx, line.path[dist]!)) {
    dist--;
    collided = true;
  }
  if (dist < 0) return;
  const to = line.path[dist]!;
  const from = ch.pos;
  if (to === from) return;
  ch.pos = to;
  if (isHero(ch)) ctx.effects.push({ type: 'knockedBack', depth: ctx.depth, hero: ch.id, from, to });
  else ctx.effects.push({ type: 'pushed', depth: ctx.depth, mob: ch.id, from, to });
  if (collided && isAlive(ch)) {
    // SEAM(levels): WandOfBlastWave.Knockback, as a Hazard ('fall' for now).
    harm(ctx, ch, ctx.rng.normalIntRange(dist, 2 * dist), 'fall');
    if (isAlive(ch)) ch.paralysed = Math.max(ch.paralysed ?? 0, 1 + dist / 2);
  }
  // Door.leave: the door it was thrown out of closes behind it.
  leaveCell(ctx.world, ctx.level, ctx.depth, from);
  if (isAlive(ch)) occupy(ctx, ch);
}

/**
 * The dart, disintegration and grim traps' aim: whoever stands on the trap, otherwise the nearest one
 * in a clear line, within sight (at least torch range); the unseen count as at the edge of it. On a
 * tie with a hero already chosen, the other is taken.
 */
function aim(ctx: Ctx, pos: number, canTarget: (ch: Char) => boolean = () => true): Char | undefined {
  let target = charOn(ctx, pos);
  if (target && !canTarget(target)) target = undefined;
  if (target) return target;
  const range = f32(Math.max(6, heroSight(ctx.world, ctx.depth)) + 0.5);
  let closest = Number.MAX_VALUE;
  for (const ch of [...heroesOn(ctx.world, ctx.depth), ...ctx.floor.mobs]) {
    if (!isAlive(ch)) continue;
    let cur = f32(Math.sqrt((cellX(pos) - cellX(ch.pos)) ** 2 + (cellY(pos) - cellY(ch.pos)) ** 2));
    if (isHero(ch) && ch.invisible > 0) cur = Math.max(cur, range);
    const bolt = ballistica(ctx, pos, ch.pos, PROJECTILE);
    if (canTarget(ch) && bolt.collisionPos === ch.pos && (cur < closest || (cur === closest && target !== undefined && isHero(target)))) {
      target = ch;
      closest = cur;
    }
  }
  return closest > range ? undefined : target;
}

/* SEAMs: blobs and conditions other streams are porting. */

/**
 * SEAM(wands): the Fire blob (Blob.seed(cell, amount, Fire)). Done at once, as Fire.burn: whoever
 * stands on a seeded cell catches fire (Burning, 8 turns; not in water, nor the immune), the heap there
 * burns, and the fire runs on through every flamable cell next to a burning one (grass, doors,
 * bookshelves), leaving embers and burning whoever and whatever is there. Shattered's blob burns for
 * `amount` turns (5 on the blazing trap's dry cells, 1 on water and chasms, 2 for the burning trap) and
 * spreads turn by turn, catching whoever comes into it later.
 */
export function seedFire(ctx: Ctx, cells: number[]): void {
  ctx.effects.push({ type: 'blob', depth: ctx.depth, blob: 'fire', cells });
  const lit = new Set(cells);
  const queue = [...cells];
  for (let head = 0; head < queue.length; head++) {
    const cell = queue[head]!;
    if (flamable(ctx, cell)) {
      // Level.destroy: burnt down to embers.
      ctx.level.map[cell] = T.EMBERS;
      ctx.effects.push({ type: 'burnt', depth: ctx.depth, pos: cell });
      for (const n of N4) {
        const next = cell + n;
        if (!lit.has(next) && flamable(ctx, next)) {
          lit.add(next);
          queue.push(next);
        }
      }
    }
    const ch = charOn(ctx, cell);
    if (ch && !water(ctx, cell) && !immuneTo(ch, 'burning')) ch.burning = Math.max(ch.burning ?? 0, BURNING);
    burnHeaps(ctx, cell, 0);
  }
}

/**
 * SEAM(wands): the Freezing blob (Blob.seed(cell, amount, Freezing)). Done at once, as one
 * Freezing.freeze: whoever stands there is chilled (Chill, 3 turns, 5 in water; pd-ts has no Chill, so
 * they are slowed as long) and stops burning; meat in a heap there freezes. Shattered's blob lingers
 * `amount` turns, chilling again every turn until a chill at its full ten turns freezes solid (Frost).
 */
function seedFreezing(ctx: Ctx, cells: number[]): void {
  ctx.effects.push({ type: 'blob', depth: ctx.depth, blob: 'freezing', cells });
  // EternalFire: frost on or beside it puts the whole of it out.
  freezeEternalFire(ctx, cells);
  for (const cell of cells) {
    const ch = charOn(ctx, cell);
    if (ch && !frostHurtsElemental(ctx, ch) && !immuneTo(ch, 'frost')) {
      ch.slowed = Math.max(ch.slowed ?? 0, water(ctx, cell) ? 5 : 3);
      ch.burning = 0;
    }
    freezeHeaps(ctx, cell, 0);
  }
}

/**
 * SEAM(wands): the Electricity blob (Blob.seed(cell, amount, Electricity)). Worked out at once for
 * whoever stands in it: Electricity.evolve paralyses them for the charge left (Paralysis.prolong(volume)),
 * and shocks them on every odd volume for round(Float(2 + depth/5)); each shock may break the paralysis
 * (Paralysis.processDamage against what health is left), and then they would step out. Here the
 * paralysis lasts until that break and the shocks land together. The blob also spreads through water
 * and charges wands lying in it; pd-ts has none of that yet.
 */
function seedElectricity(ctx: Ctx, cells: number[], amount: number): void {
  ctx.effects.push({ type: 'blob', depth: ctx.depth, blob: 'electricity', cells });
  for (const cell of cells) {
    const ch = charOn(ctx, cell);
    if (!ch || !isAlive(ch) || hasProp(ch, IMMOVABLE)) continue;
    let resist = 0;
    let dealt = 0;
    let held = amount;
    for (let volume = amount; volume > 0; volume--) {
      if (volume % 2 === 0) continue;
      const shock = Math.round(ctx.rng.floatMax(f32(2 + f32(ctx.depth / 5))));
      dealt += shock;
      resist += shock;
      if (dealt >= ch.hp || ctx.rng.normalIntRange(0, resist) >= ctx.rng.normalIntRange(0, ch.hp - dealt)) {
        held = amount - volume + 1;
        break;
      }
    }
    if ((ch.paralysed ?? 0) <= 0) ch.paralysed = held;
    harm(ctx, ch, dealt, 'lightning');
  }
}

/**
 * SEAM(wands): ConfusionGas (Blob.seed(pos, amount, ConfusionGas)). pd-ts has no such cloud yet: as
 * dreamweed's, whoever is within two steps staggers about (Vertigo, 10 turns). Shattered's cloud of
 * `amount` spreads and lingers, giving Vertigo for 2 turns to whoever breathes it, turn after turn.
 */
function seedConfusion(ctx: Ctx, pos: number, _amount: number): void {
  const cells = patch(ctx, pos);
  ctx.effects.push({ type: 'blob', depth: ctx.depth, blob: 'confusion', cells });
  for (const cell of cells) {
    const ch = charOn(ctx, cell);
    if (ch && isAlive(ch) && (isHero(ch) || ch.state !== 'passive')) ch.dizzy = Math.max(ch.dizzy ?? 0, VERTIGO);
  }
}

/**
 * SEAM(wands): CorrosiveGas (Blob.seed(pos, amount, CorrosiveGas).setStrength(1 + depth/4)): as toxic
 * gas of the same amount. Shattered's corrodes for the strength set, more every turn breathed.
 */
function seedCorrosion(ctx: Ctx, pos: number, amount: number, _strength: number): void {
  seedGas(ctx, pos, 'toxic', amount);
}

/** SEAM(wands): Poison.set(amount) — pd-ts's poison hurts a point a turn; Shattered's left/3 + 1, easing. */
function poisonChar(ch: Char, amount: number): void {
  ch.poison = Math.max(ch.poison ?? 0, amount);
}

/** SEAM(wands): Ooze.set(DURATION): a hero's caustic ooze (pd-ts's has no duration, and monsters none at all). */
function oozeChar(ctx: Ctx, ch: Char): void {
  if (!isHero(ch)) return;
  if (ch.ooze < 0) ctx.effects.push({ type: 'oozed', hero: ch.id });
  ch.ooze = 0;
}

/** SEAM(wands): Weakness, prolonged: a hero's (pd-ts's: two points of strength less); monsters have none yet. */
function weakenChar(ctx: Ctx, ch: Char, turns: number): void {
  if (!isHero(ch)) return;
  if (ch.weakened <= 0) ctx.effects.push({ type: 'weakened', hero: ch.id });
  ch.weakened = Math.max(ch.weakened, turns);
}

/**
 * SEAM(gear): Weapon.enchant(Enchantment.randomCurse()) and Armor.inscribe(Glyph.randomCurse()) have no
 * curse enchantments to give yet: the item is only cursed, its curse known (CursingTrap.curse(Item)).
 */
function curseItem(item: Item): void {
  item.cursed = true;
  delete item.curseUnknown;
}

/**
 * SEAM(gear): Potion.shatter for potions caught in a blast: the harmful ones burst as a thrown one
 * does (inventory.ts); the rest just splash.
 */
const SHATTERS: Partial<Record<ItemKind, { kind: Burst; radius: number }>> = {
  'potion.toxicGas': { kind: 'toxic', radius: 2 },
  'potion.paralyticGas': { kind: 'paralytic', radius: 2 },
  'potion.liquidFlame': { kind: 'fire', radius: 1 },
  'potion.frost': { kind: 'frost', radius: 2 },
  'potion.purity': { kind: 'purity', radius: 2 },
};

/** Heap.explode: chests and skeletons burst open; on a heap, potions shatter, bombs go off, the rest is destroyed. */
function explodeHeap(ctx: Ctx, heap: Heap): void {
  if (heap.kind === 'chest' || heap.kind === 'skeleton') {
    ctx.effects.push({ type: 'opened', depth: ctx.depth, pos: heap.pos, heap: heap.kind });
    heap.kind = 'heap';
    return;
  }
  if (heap.kind !== 'heap') return;
  for (const item of [...heap.items]) {
    // Unique items and equipment are not affected (unique: keys, quest items, the tome, bags, the seal).
    const category = itemDef(item.kind).category;
    if (isUpgradable(item) || ['weapon', 'armor', 'missile', 'ring', 'wand', 'key', 'quest', 'tome', 'bag', 'seal'].includes(category)) continue;
    heap.items.splice(heap.items.indexOf(item), 1);
    if (category === 'potion') {
      const shatter = SHATTERS[item.kind];
      if (shatter) burst(ctx, heap.pos, shatter.kind, shatter.radius);
    } else if (category === 'bomb') {
      if (heap.items.length === 0) ctx.floor.heaps.splice(ctx.floor.heaps.indexOf(heap), 1);
      // The new explosion takes over from this one.
      explodeBomb(ctx, heap.pos);
      return;
    }
  }
  if (heap.items.length === 0 && ctx.floor.heaps.includes(heap)) ctx.floor.heaps.splice(ctx.floor.heaps.indexOf(heap), 1);
}

/**
 * Bomb.explode: the cell and those next to it (through whatever is not solid, or can burn): what can
 * burn is destroyed, heaps there explode, and everyone there takes NormalIntRange(4 + depth, 12 + 3*depth)
 * less a roll of their armour.
 */
function explodeBomb(ctx: Ctx, cell: number): void {
  ctx.effects.push({ type: 'exploded', depth: ctx.depth, pos: cell });
  const cells = reached(distanceMap(ctx, cell, (c) => !solid(ctx, c) || flamable(ctx, c), 1));
  const chars = cells.map((c) => charOn(ctx, c)).filter((ch): ch is Char => ch !== undefined);
  for (const c of cells) {
    if (flamable(ctx, c)) {
      ctx.level.map[c] = T.EMBERS;
      ctx.effects.push({ type: 'burnt', depth: ctx.depth, pos: c });
    }
    const heap = heapOn(ctx, c);
    if (heap) explodeHeap(ctx, heap);
  }
  for (const ch of chars) {
    if (!isAlive(ch)) continue;
    const damage = ctx.rng.normalIntRange(4 + ctx.depth, 12 + 3 * ctx.depth) - drRoll(ctx, ch);
    harm(ctx, ch, damage, 'bomb');
  }
}

/* The traps. */

/** Trap.activate, kind by kind. */
export function activate(ctx: Ctx, trap: TrapInfo, victim: Char | null): void {
  const depth = ctx.depth;
  const pos = trap.pos;
  switch (trap.kind) {
    case 'alarm':
      // AlarmTrap: every monster on the level comes to look.
      for (const mob of [...ctx.floor.mobs]) beckon(mob, pos);
      return;
    case 'blazing':
      seedFire(ctx, patch(ctx, pos));
      return;
    case 'burning':
      seedFire(ctx, around9(ctx, pos));
      return;
    case 'chilling':
      seedFreezing(ctx, around9(ctx, pos));
      return;
    case 'frost':
      seedFreezing(ctx, patch(ctx, pos));
      return;
    case 'confusion':
      seedConfusion(ctx, pos, 300 + 20 * depth);
      return;
    case 'corrosion':
      seedCorrosion(ctx, pos, 80 + 5 * depth, 1 + Math.trunc(depth / 4));
      return;
    case 'toxic':
      seedGas(ctx, pos, 'toxic', 300 + 20 * depth);
      return;
    case 'shocking':
      seedElectricity(ctx, around9(ctx, pos), 10);
      return;
    case 'storm':
      seedElectricity(ctx, patch(ctx, pos), 20);
      return;
    case 'cursing':
      cursing(ctx, pos);
      return;
    case 'disarming':
      disarming(ctx, pos);
      return;
    case 'disintegration':
      disintegration(ctx, pos);
      return;
    case 'distortion':
      distortion(ctx, pos);
      return;
    case 'explosive':
      explodeBomb(ctx, pos);
      return;
    case 'flashing':
      flashing(ctx, pos);
      return;
    case 'flock':
      flock(ctx, pos);
      return;
    case 'gateway':
      gateway(ctx, trap);
      return;
    case 'geyser':
      geyser(ctx, pos);
      return;
    case 'gnollRockfall':
      gnollRockfall(ctx, pos);
      return;
    case 'grim':
      grim(ctx, pos);
      return;
    case 'gripping':
      gripping(ctx, pos);
      return;
    case 'guardian':
      guardian(ctx, pos, victim);
      return;
    case 'ooze':
      for (const cell of around9(ctx, pos)) {
        const ch = charOn(ctx, cell);
        if (ch && !flying(ch)) oozeChar(ctx, ch);
      }
      return;
    case 'pitfall':
      pitfall(ctx, trap);
      return;
    case 'poisonDart':
      dart(ctx, pos, S.POISON_DART, 8 + Math.round(f32((2 * depth) / 3)));
      return;
    case 'tenguDart':
      // TenguDartTrap: never at Tengu himself; 15 poison under the stronger bosses challenge, 8 otherwise.
      dart(ctx, pos, S.POISON_DART, isChallenged(ctx.world, STRONGER_BOSSES) ? 15 : 8, (ch) => isHero(ch) || ch.kind !== 'tengu');
      return;
    case 'wornDart':
      dart(ctx, pos, S.DART, null);
      return;
    case 'toxicVent':
      // ToxicGasRoom.ToxicVent.activate: nothing; it is only decoration.
      return;
    case 'rockfall':
      rockfall(ctx, pos);
      return;
    case 'summoning':
      summoning(ctx, pos);
      return;
    case 'teleportation':
      teleportation(ctx, pos);
      return;
    case 'warping': {
      // WarpingTrap: the party forgets the level when it goes off right beside a hero, then it teleports.
      if (heroesOn(ctx.world, depth).some((hero) => distance(hero.pos, pos) <= 1)) exploredCells(ctx.world, depth).fill(false);
      teleportation(ctx, pos);
      return;
    }
    case 'weakening': {
      const ch = charOn(ctx, pos);
      if (!ch) return;
      if (hasProp(ch, BOSS) || hasProp(ch, MINIBOSS)) weakenChar(ctx, ch, WEAKNESS / 2);
      weakenChar(ctx, ch, WEAKNESS * 3);
      return;
    }
  }
}

/** CursingTrap: what can be upgraded in the heap there turns cursed (not thrown weapons), and so does the gear of a hero on it. */
function cursing(ctx: Ctx, pos: number): void {
  const heap = heapOn(ctx, pos);
  if (heap) {
    for (const item of heap.items) if (isUpgradable(item) && itemDef(item.kind).category !== 'missile') curseItem(item);
  }
  const ch = charOn(ctx, pos);
  if (ch && isHero(ch) && !flying(ch)) curseHero(ctx, ch);
}

/**
 * CursingTrap.curse(Hero): the weapon or the armour, one without an enchantment or glyph first (a curse
 * then takes its place). SEAM(gear): Belongings.secondWep, and the mage's staff it spares, are not in pd-ts.
 */
function curseHero(ctx: Ctx, hero: Hero): void {
  const priority: Item[] = [];
  const canCurse: Item[] = [];
  if (hero.weapon && itemDef(hero.weapon.kind).category === 'weapon') (hero.weapon.enchant ? canCurse : priority).push(hero.weapon);
  (hero.armor.glyph ? canCurse : priority).push(hero.armor);
  let item: Item | undefined;
  if (priority.length > 0) {
    javaShuffle(ctx, priority);
    item = priority[0];
  } else if (canCurse.length > 0) {
    javaShuffle(ctx, canCurse);
    item = canCurse[0];
  }
  if (item) curseItem(item);
  ctx.effects.push({ type: 'trapCursed', hero: hero.id, ...(item ? { item } : {}) });
}

/**
 * DisarmingTrap: the top item of a heap there is sent to a random spot; an animated statue there falls
 * apart; and the weapon in the hand of a hero on it lands 10 to 20 steps away.
 */
function disarming(ctx: Ctx, pos: number): void {
  const heap = heapOn(ctx, pos);
  if (heap && heap.kind === 'heap') {
    const cell = respawnCell(ctx, false);
    if (cell !== -1) {
      const item = pickUp(ctx, heap);
      dropAt(ctx, item, cell);
      mapAround(ctx, cell);
      ctx.effects.push({ type: 'itemTeleported', depth: ctx.depth, from: pos, to: cell });
    }
  }
  const statue = charOn(ctx, pos);
  if (statue && !isHero(statue) && statue.kind === 'statue') harm(ctx, statue, statue.hp);
  const hero = charOn(ctx, pos);
  if (!hero || !isHero(hero) || flying(hero)) return;
  const weapon = hero.weapon;
  if (!weapon || weapon.cursed) return;
  const dist = distanceMap(ctx, pos, (c) => passable(ctx, c));
  let cell: number;
  let tries = 50;
  do {
    cell = respawnCell(ctx, false);
    if (tries-- < 0 && cell !== -1) break;
    // (With no cell ever to be found, Shattered would search for ever.)
    if (tries < -1000) return;
  } while (cell === -1 || dist[cell]! < 10 || dist[cell]! > 20);
  if (tries < 0) return;
  hero.weapon = null;
  dropAt(ctx, weapon, cell);
  mapAround(ctx, cell);
  ctx.effects.push({ type: 'itemTeleported', depth: ctx.depth, from: pos, to: cell, hero: hero.id });
}

/** DisintegrationTrap: a heap there explodes; a death ray strikes whoever it aims at for NormalIntRange(30, 50) + depth. */
function disintegration(ctx: Ctx, pos: number): void {
  const target = aim(ctx, pos);
  const heap = heapOn(ctx, pos);
  if (heap) explodeHeap(ctx, heap);
  if (!target) return;
  ctx.effects.push({ type: 'zapped', depth: ctx.depth, from: pos, to: target.pos, bolt: 'beam' });
  harm(ctx, target, ctx.rng.normalIntRange(30, 50) + ctx.depth);
}

/** GrimTrap: a shadow bolt that takes half the target's full health and half what it has left; never more than 90% of a hero's. */
function grim(ctx: Ctx, pos: number): void {
  const target = aim(ctx, pos);
  if (!target) return;
  let damage = Math.round(f32(f32(target.ht / 2) + f32(target.hp / 2)));
  if (isHero(target)) damage = Math.trunc(Math.min(damage, f32(target.ht * 0.9)));
  ctx.effects.push({ type: 'zapped', depth: ctx.depth, from: pos, to: target.pos, bolt: 'shadow' });
  harm(ctx, target, damage);
}

/** PoisonDartTrap and WornDartTrap: a dart at whoever it aims at, NormalIntRange(4, 8) less armour, and poison. */
function dart(ctx: Ctx, pos: number, sprite: number, poison: number | null, canTarget?: (ch: Char) => boolean): void {
  const target = aim(ctx, pos, canTarget);
  if (!target) return;
  ctx.effects.push({ type: 'missile', depth: ctx.depth, from: pos, to: target.pos, sprite });
  harm(ctx, target, ctx.rng.normalIntRange(4, 8) - drRoll(ctx, target));
  if (poison !== null) poisonChar(target, poison);
}

/**
 * FlashingTrap: a blinding flash for whoever stands on it — bleeding for (4 + depth/2) less half an
 * armour roll, blind, crippled for twice as long; a monster loses its quarry and wanders off.
 */
function flashing(ctx: Ctx, pos: number): void {
  const c = charOn(ctx, pos);
  if (!c) return;
  const damage = Math.max(0, 4 + Math.trunc(ctx.depth / 2) - Math.trunc(drRoll(ctx, c) / 2));
  c.bleeding = Math.max(c.bleeding ?? 0, damage);
  c.blind = Math.max(c.blind ?? 0, BLINDNESS);
  if (isHero(c) && c.crippled <= 0) ctx.effects.push({ type: 'crippled', hero: c.id });
  c.crippled = Math.max(c.crippled ?? 0, CRIPPLE * 2);
  if (isHero(c)) return;
  if (c.state === 'hunting') c.state = 'wandering';
  beckon(c, randomDestination(ctx, c));
}

/** RegularLevel.randomDestination: a random walkable spot in a random room (room for a large monster), or -1. */
function randomDestination(ctx: Ctx, mob: Mob): number {
  for (let count = 0; count < 30; count++) {
    const room = ctx.rng.element(ctx.level.rooms);
    if (!room) continue;
    const points: number[] = [];
    for (let x = room.left + 1; x < room.right; x++) for (let y = room.top + 1; y < room.bottom; y++) points.push(x + y * W);
    if (points.length === 0) continue;
    const cell = ctx.rng.element(points)!;
    if (passable(ctx, cell) && (!largeKind(mob.kind) || openSpace(ctx, cell))) return cell;
  }
  return -1;
}

/** GrippingTrap: for whoever (not flying) stands on it, bleeding for (2 + depth/2) less half an armour roll, and crippled. */
function gripping(ctx: Ctx, pos: number): void {
  const c = charOn(ctx, pos);
  if (!c || flying(c)) return;
  const damage = Math.max(0, 2 + Math.trunc(ctx.depth / 2) - Math.trunc(drRoll(ctx, c) / 2));
  c.bleeding = Math.max(c.bleeding ?? 0, damage);
  if (isHero(c) && c.crippled <= 0) ctx.effects.push({ type: 'crippled', hero: c.id });
  c.crippled = Math.max(c.crippled ?? 0, CRIPPLE);
}

/** FlockTrap: magic sheep on every free cell of the 5x5 patch around, for about six turns. */
function flock(ctx: Ctx, pos: number): void {
  const spawned: number[] = [];
  for (const cell of patch(ctx, pos)) {
    if (!insideMap(cell) || charOn(ctx, cell) || pit(ctx, cell)) continue;
    const sheep = createMob(nextMobId(ctx), 'sheep', cell, 'passive', ctx.floor.now + 1);
    // Sheep.initialize(6): gone after six turns, give or take two.
    sheep.lifespan = 6 + ctx.rng.floatRange(-2, 2);
    ctx.floor.mobs.push(sheep);
    spawned.push(cell);
    // Before the sheep presses its cell, a trap there is set off directly.
    const t = trapAt(ctx.level, cell);
    if (t) springTrap(ctx, t, sheep);
    if (ctx.floor.mobs.includes(sheep)) mobPress(ctx, sheep);
  }
  if (spawned.length > 0) ctx.effects.push({ type: 'flock', depth: ctx.depth, cells: spawned });
}

/**
 * GatewayTrap: the first time, whoever or whatever is on or beside it is teleported away, and that spot
 * is remembered; from then on everyone and every heap there is sent to that same spot, or beside it.
 */
function gateway(ctx: Ctx, trap: TrapInfo): void {
  const pos = trap.pos;
  if (trap.telePos === undefined || trap.telePos === -1) {
    for (const n of N9) {
      const ch = charOn(ctx, pos + n);
      if (ch && teleportChar(ctx, ch)) {
        if (!isHero(ch) && ch.state === 'hunting') ch.state = 'wandering';
        trap.telePos = ch.pos;
        break;
      }
      const heap = heapOn(ctx, pos + n);
      if (heap && heap.kind === 'heap') {
        const cell = respawnCell(ctx, false);
        const item = pickUp(ctx, heap);
        if (cell !== -1) {
          dropAt(ctx, item, cell);
          ctx.effects.push({ type: 'itemTeleported', depth: ctx.depth, from: pos + n, to: cell });
          trap.telePos = cell;
          break;
        }
      }
    }
  }
  const telePos = trap.telePos ?? -1;
  if (telePos === -1) return;
  const free = (c: number): boolean => passable(ctx, c) && !charOn(ctx, c);
  const positions = N8.map((n) => telePos + n).filter(free);
  javaShuffle(ctx, positions);
  if (free(telePos)) positions.unshift(telePos);
  const largePositions = positions.filter((c) => openSpace(ctx, c));
  for (const n of N9) {
    const ch = charOn(ctx, pos + n);
    if (ch && !hasProp(ch, IMMOVABLE)) {
      const newPos = (hasProp(ch, LARGE) ? largePositions[0] : positions[0]) ?? -1;
      if (newPos !== -1) {
        if (positions.includes(newPos)) positions.splice(positions.indexOf(newPos), 1);
        if (largePositions.includes(newPos)) largePositions.splice(largePositions.indexOf(newPos), 1);
        if (teleportToLocation(ctx, ch, newPos) && !isHero(ch) && ch.state === 'hunting') ch.state = 'wandering';
      }
    }
    const heap = heapOn(ctx, pos + n);
    if (heap && heap.kind === 'heap') {
      dropAt(ctx, pickUp(ctx, heap), telePos);
      ctx.effects.push({ type: 'itemTeleported', depth: ctx.depth, from: pos + n, to: telePos });
    }
  }
}

/**
 * Level.setCellToWater(true, cell): floor, grass and embers turn to water, and so do traps (gone from
 * the level). SEAM(levels): a custom tilemap's allowWater is not consulted.
 */
function toWater(ctx: Ctx, cell: number): void {
  const terrain = ctx.level.map[cell]!;
  const floorLike: readonly number[] = [T.EMPTY, T.GRASS, T.EMBERS, T.EMPTY_SP, T.HIGH_GRASS, T.FURROWED_GRASS, T.EMPTY_DECO];
  if (floorLike.includes(terrain)) {
    ctx.level.map[cell] = T.WATER;
  } else if (terrain === T.SECRET_TRAP || terrain === T.TRAP || terrain === T.INACTIVE_TRAP) {
    ctx.level.map[cell] = T.WATER;
    ctx.level.traps = (ctx.level.traps ?? []).filter((t) => t.pos !== cell);
  }
}

/**
 * GeyserTrap: water floods the cells around (the far ring only now and then) and blasts everyone
 * beside it two cells outward, whoever stands on it two cells in a random way (a hero's way never into
 * a hazard); fires go out, and fiery monsters take a bomb's worth of harm (two thirds of it beside).
 */
function geyser(ctx: Ctx, pos: number): void {
  const dist = distanceMap(ctx, pos, (c) => !solid(ctx, c), 2);
  for (let i = 0; i < LENGTH; i++) {
    if (dist[i] === 2 && ctx.rng.int(3) > 0) toWater(ctx, i);
    else if (dist[i]! < 2) toWater(ctx, i);
  }
  const fieryHarm = (): number => ctx.rng.normalIntRange(5 + ctx.depth, 10 + ctx.depth * 2);
  for (const n of N8) {
    const ch = charOn(ctx, pos + n);
    if (!ch) continue;
    if (hasProp(ch, FIERY)) harm(ctx, ch, Math.trunc(f32(fieryHarm() * f32(0.67))));
    if (!isAlive(ch)) continue;
    ch.burning = 0;
    // A line to them and on past them, then just the part beyond: they are blown along it.
    const line = ballistica(ctx, pos, ch.pos, STOP_TARGET);
    throwChar(ctx, ch, ballistica(ctx, line.collisionPos, line.path[line.path.length - 1]!, PROJECTILE), 2);
  }
  const ch = charOn(ctx, pos);
  if (!ch) return;
  let target = -1;
  if (isHero(ch)) {
    const candidates = N8.filter((n) => !avoid(ctx, pos + n) && !avoid(ctx, pos + n + n)).map((n) => pos + n);
    if (candidates.length > 0) target = ctx.rng.element(candidates)!;
  } else {
    target = pos + N8[ctx.rng.int(8)]!;
  }
  if (hasProp(ch, FIERY)) harm(ctx, ch, fieryHarm());
  if (isAlive(ch) && target !== -1) {
    ch.burning = 0;
    throwChar(ctx, ch, ballistica(ctx, pos, target, MAGIC_BOLT), 2);
  }
}

/**
 * RockfallTrap: rocks come down on the whole room it lies in (a 5x5 patch off Shattered's rooms):
 * NormalIntRange(5 + depth, 10 + 2*depth) less armour, and whoever survives is paralysed.
 */
function rockfall(ctx: Ctx, pos: number): void {
  const room = isRegularLevel(ctx)
    ? ctx.level.rooms.find((r) => cellX(pos) > r.left && cellY(pos) > r.top && cellX(pos) < r.right && cellY(pos) < r.bottom)
    : undefined;
  let cells: number[];
  if (room) {
    cells = [];
    for (let x = room.left; x <= room.right; x++) {
      for (let y = room.top; y <= room.bottom; y++) if (!solid(ctx, x + y * W)) cells.push(x + y * W);
    }
  } else {
    cells = patch(ctx, pos);
  }
  ctx.effects.push({ type: 'avalanche', depth: ctx.depth, cells });
  for (const cell of cells) {
    const ch = charOn(ctx, cell);
    if (!ch || !isAlive(ch)) continue;
    const damage = ctx.rng.normalIntRange(5 + ctx.depth, 10 + ctx.depth * 2) - drRoll(ctx, ch);
    harm(ctx, ch, Math.max(damage, 0));
    if (isAlive(ch)) ch.paralysed = Math.max(ch.paralysed ?? 0, PARALYSIS);
  }
}

/**
 * GnollRockfallTrap: a 5x5 patch of rocks (in the blacksmith's mine, not beside a barricade): 6 to 12,
 * whatever the armour, and a short daze; in the mine an empty cell may get a boulder.
 * SEAM(mobs): the gnoll geomancer it spares and the gnoll guards it dazes for 10 turns are not in pd-ts.
 */
function gnollRockfall(ctx: Ctx, pos: number): void {
  const { level, depth } = ctx;
  const mining = level.branch === 1 && depth >= 11 && depth <= 14;
  const cells = patch(ctx, pos).filter((i) => !mining || !N9.some((j) => level.map[i + j] === T.BARRICADE));
  ctx.effects.push({ type: 'avalanche', depth, cells });
  for (const cell of cells) {
    const ch = charOn(ctx, cell);
    if (ch && isAlive(ch)) {
      harm(ctx, ch, ctx.rng.normalIntRange(6, 12));
      if (isAlive(ch)) ch.paralysed = Math.max(ch.paralysed ?? 0, 3);
    } else if (
      !ch && mining && !(level.traps ?? []).some((t) => t.pos === cell) && !(ctx.floor.plants ?? []).some((p) => p.pos === cell) &&
      ctx.rng.int(2) === 0
    ) {
      level.map[cell] = T.MINE_BOULDER;
    }
  }
}

/**
 * GuardianTrap: an alarm, and from depth 10 on spectral guardians (one more every five depths) appear
 * out of sight and come for the hero. SEAM(mobs): a Guardian is an animated statue (pd-ts's Statue)
 * with a plain, uncursed, unenchanted weapon of level 0; Shattered's has its own tinted sprite.
 */
function guardian(ctx: Ctx, pos: number, victim: Char | null): void {
  for (const mob of [...ctx.floor.mobs]) beckon(mob, pos);
  const heroes = heroesOn(ctx.world, ctx.depth);
  const hero = victim && isHero(victim) ? victim : [...heroes].sort((a, b) => distance(a.pos, pos) - distance(b.pos, pos))[0];
  for (let i = 0; i < Math.trunc((ctx.depth - 5) / 5); i++) {
    const guard = createMob(nextMobId(ctx), 'statue', -1, 'wandering', ctx.floor.now);
    guard.level = ctx.depth;
    guard.item = plainWeapon(ctx);
    guard.ht = guard.hp = mobStats(guard).ht;
    guard.pos = respawnCell(ctx, false);
    if (guard.pos === -1) continue;
    ctx.floor.mobs.push(scaleMob(ctx.world, guard));
    enterCell(ctx.level, guard.pos);
    if (hero) beckon(guard, hero.pos);
  }
}

/** Guardian.createWeapon: Generator.randomUsingDefaults(WEAPON), uncursed, unenchanted, level 0. */
function plainWeapon(ctx: Ctx): Item {
  const generator = new ItemGenerator(ctx.rng, ctx.depth);
  let weapon: Item;
  do weapon = generator.of('weapon');
  while (itemDef(weapon.kind).category !== 'weapon');
  weapon.cursed = false;
  delete weapon.enchant;
  weapon.level = 0;
  return weapon;
}

/** PitfallTrap: the floor around gives way a turn later (not on boss levels, below depth 25, or in the side levels). */
function pitfall(ctx: Ctx, trap: TrapInfo): void {
  if (isBossDepth(ctx.depth) || ctx.depth > 25 || (ctx.level.branch ?? 0) !== 0) {
    ctx.effects.push({ type: 'pitfall', depth: ctx.depth, cells: [], stage: 'none' });
    return;
  }
  const cells = N9.map((n) => trap.pos + n).filter((c) => !solid(ctx, c) || passable(ctx, c));
  // PitfallTrap.DelayedPit (Buff.append(hero, DelayedPit, 1)): kept by the trap until it opens.
  trap.pit = { at: ctx.floor.now + 1, cells };
  ctx.effects.push({ type: 'pitfall', depth: ctx.depth, cells, stage: 'warn' });
}

/** When the next pit on a level opens (for the depth's turn order), if one is waiting. */
export function nextPitAt(ctx: Pick<Ctx, 'level'>): number | undefined {
  let next: number | undefined;
  for (const trap of ctx.level.traps ?? []) if (trap.pit && (next === undefined || trap.pit.at < next)) next = trap.pit.at;
  return next;
}

/**
 * PitfallTrap.DelayedPit.act, for every pit whose time has come: whoever stands there (not flying, nor
 * the immovable harmless folk) falls, monsters out of the level, and heaps (not a shop's or locked
 * chests) drop to the depth below. Returns the heroes who fall, for the world to drop them
 * (Chasm.heroFall), last.
 */
export function openPits(ctx: Ctx): Hero[] {
  const fallen: Hero[] = [];
  for (const trap of ctx.level.traps ?? []) {
    if (!trap.pit || trap.pit.at > ctx.floor.now) continue;
    const cells = trap.pit.cells.filter((c) => insideMap(c) && !(solid(ctx, c) && !passable(ctx, c)));
    delete trap.pit;
    ctx.effects.push({ type: 'pitfall', depth: ctx.depth, cells, stage: 'open' });
    for (const cell of cells) {
      const ch = charOn(ctx, cell);
      if (ch && !flying(ch) && !(!isHero(ch) && ch.state === 'passive' && IMMOVABLE.has(ch.kind))) {
        if (isHero(ch)) fallen.push(ch);
        else mobFall(ctx, ch);
      }
      const heap = heapOn(ctx, cell);
      if (heap && heap.kind !== 'forSale' && heap.kind !== 'lockedChest' && heap.kind !== 'crystalChest') {
        // Dungeon.dropToChasm: on to the depth below.
        (ctx.floor.falling ??= []).push(...heap.items);
        ctx.floor.heaps.splice(ctx.floor.heaps.indexOf(heap), 1);
      }
    }
  }
  return fallen;
}

/** SummoningTrap: one to three monsters of the level appear around it, a moment later on the move. */
export function summoning(ctx: Ctx, pos: number): void {
  const points = spawnPoints(ctx, pos, 1);
  const mobs: Mob[] = [];
  for (const point of points) {
    // Level.createMob: the level's rotation of monsters (and its champions); a large one only in the open.
    let mob = dealMob(ctx.world, ctx.level, ctx.rng, nextMobId(ctx), point, ctx.floor.now + SUMMON_DELAY);
    while (largeKind(mob.kind) && !openSpace(ctx, point)) mob = dealMob(ctx.world, ctx.level, ctx.rng, nextMobId(ctx), point, ctx.floor.now + SUMMON_DELAY);
    if (mob.state !== 'passive') mob.state = 'wandering';
    ctx.floor.mobs.push(mob);
    mobs.push(mob);
  }
  arrive(ctx, mobs);
}

/** How many come (`base`, one more half the time, and another half of that) and where: free cells beside the trap. */
function spawnPoints(ctx: Ctx, pos: number, base: number): number[] {
  let count = base;
  if (ctx.rng.int(2) === 0) {
    count++;
    if (ctx.rng.int(2) === 0) count++;
  }
  const candidates = N8.map((n) => pos + n).filter((p) => !charOn(ctx, p) && (passable(ctx, p) || avoid(ctx, p)));
  const points: number[] = [];
  while (count > 0 && candidates.length > 0) {
    points.push(candidates.splice(ctx.rng.index(candidates.length), 1)[0]!);
    count--;
  }
  return points;
}

/**
 * The newcomers take their cells last, so all are there first: a trap under one goes off directly,
 * then it appears and presses its cell (a piranha out of water dies there).
 */
function arrive(ctx: Ctx, mobs: Mob[]): void {
  for (const mob of mobs) {
    const t = trapAt(ctx.level, mob.pos);
    if (t) springTrap(ctx, t, mob);
    if (!isAlive(mob) || !ctx.floor.mobs.includes(mob)) continue;
    ctx.effects.push({ type: 'appeared', depth: ctx.depth, mob: mob.id, pos: mob.pos });
    mobPress(ctx, mob);
    if (mob.kind === 'piranha' && isAlive(mob) && ctx.floor.mobs.includes(mob) && !water(ctx, mob.pos)) hurt(ctx, mob, mob.hp, 'dry');
  }
}

/**
 * MobSpawner.RARE_ALTS' values, in the order Shattered declares them. SEAM(mobs): the gnoll exile,
 * hermit crab, caustic slime, spectral necromancer, DM-201 and chaos elemental are not in pd-ts; the
 * nearest kind stands in.
 */
const RARE_ALTS: readonly MobKind[] = ['albino', 'gnoll', 'crab', 'rat', 'bandit', 'skeleton', 'shielded', 'golem', 'senior', 'elemental', 'acidic'];

/**
 * DistortionTrap: three to five creatures from all over the dungeon — another depth's monster, a wraith,
 * a piranha (likely to die on dry land), a mimic, a statue, a rare variant, very rarely the rat king.
 */
function distortion(ctx: Ctx, pos: number): void {
  const { rng, depth } = ctx;
  const points = spawnPoints(ctx, pos, 3);
  const mobs: Mob[] = [];
  let summoned = 0;
  for (const point of points) {
    summoned++;
    let mob: Mob;
    const make = (kind: MobKind, state: Mob['state'] = 'wandering'): Mob => createMob(nextMobId(ctx), kind, point, state, ctx.floor.now + SUMMON_DELAY);
    const otherFloor = (): Mob => {
      let floor: number;
      do floor = rng.int(25);
      while (isBossDepth(floor));
      // SEAM(mobs): MobSpawner.getMobRotation(floor).get(0) — that depth's Bestiary.mutable for now.
      return make(rollMob(rng, Math.max(1, floor)));
    };
    if (summoned === 1) {
      mob = depth !== 5 && rng.int(100) === 0 ? make('ratKing', 'passive') : otherFloor();
    } else if (summoned === 2) {
      const pick = rng.int(4);
      if (pick === 0) {
        spawnWraith(ctx, point);
        continue;
      }
      if (pick === 1) {
        // Piranha.random: SEAM(mobs) one in fifty is a phantom piranha, not in pd-ts.
        rng.int(50);
        mob = make('piranha');
      } else if (pick === 2) {
        // Mimic.spawnAt(point, false), out of hiding. SEAM(mobs): its prize (Mimic.generatePrize) is not rolled.
        mob = make('mimic');
      } else {
        // Statue.random(false): SEAM(mobs) one in ten is an armoured statue, not in pd-ts. Statues stay still until struck.
        rng.int(10);
        mob = make('statue', 'sleeping');
        mob.item = { ...plainWeapon(ctx), enchant: randomEnchantment(rng) };
      }
    } else if (summoned === 4) {
      mob = make(rng.element(RARE_ALTS)!);
    } else {
      mob = otherFloor();
    }
    if (largeKind(mob.kind) && !openSpace(ctx, point)) continue;
    // SEAM(mobs): Mob.maxLvl = Hero.MAX_LEVEL - 1 (they always teach something) has no per-monster field in pd-ts.
    if (mob.kind === 'piranha' || mob.kind === 'mimic' || mob.kind === 'statue') {
      mob.level = depth;
      mob.ht = mob.hp = mobStats(mob).ht;
    }
    if (mob.state !== 'passive') scaleMob(ctx.world, mob);
    ctx.floor.mobs.push(mob);
    mobs.push(mob);
  }
  arrive(ctx, mobs);
}

/** Wraith.spawnAt: a wraith rises there, already hunting, a little later. */
function spawnWraith(ctx: Ctx, pos: number): void {
  if ((solid(ctx, pos) && !passable(ctx, pos)) || charOn(ctx, pos)) return;
  const wraith = createMob(nextMobId(ctx), 'wraith', pos, 'hunting', ctx.floor.now + WRAITH_DELAY);
  wraith.level = ctx.depth;
  wraith.enemySeen = true;
  ctx.floor.mobs.push(wraith);
  enterCell(ctx.level, pos);
  ctx.effects.push({ type: 'appeared', depth: ctx.depth, mob: wraith.id, pos });
}

/**
 * TeleportationTrap: everyone on or beside it is teleported away (a hunting monster loses the scent),
 * and the top item of each heap there too.
 */
function teleportation(ctx: Ctx, pos: number): void {
  for (const n of N9) {
    const ch = charOn(ctx, pos + n);
    if (ch && teleportChar(ctx, ch) && !isHero(ch) && ch.state === 'hunting') ch.state = 'wandering';
    const heap = heapOn(ctx, pos + n);
    if (heap && heap.kind === 'heap') {
      const cell = respawnCell(ctx, false);
      const item = pickUp(ctx, heap);
      if (cell !== -1) {
        dropAt(ctx, item, cell);
        ctx.effects.push({ type: 'itemTeleported', depth: ctx.depth, from: pos + n, to: cell });
      }
    }
  }
}
