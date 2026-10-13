import { createMob, type Hero, isAlive, type Mob } from '../actors';
import { hurt } from '../combat';
import { ballistica, cone, MAGIC_BOLT, STOP_SOLID, STOP_TARGET, subPath, WONT_STOP } from '../ballistica';
import { charAt, type Char, type Ctx, dropItem, heroesOn, isHero, isPassable, isWater, observe } from '../floor';
import { createItem } from '../items';
import { adjacent, cellX, cellY, distance, LENGTH, WIDTH } from '../level/geometry';
import { setTerrain } from '../level/flags';
import { F, hasFlag, T } from '../level/terrain';
import { DIGGABLE_AREA, GATE, GATE_CELLS, MAIN_ARENA, PYLON_POSITIONS } from '../level/caves-boss';
import { rectInside } from '../level/spainter';
import { bossHurt } from '../hero';
import { getStep, mobFov, spendMob } from '../ai';
import { seedGas } from '../gas';
import { scaleMob } from '../party';
import {
  assignBar, barAssigned, bleed, bossFloor, bossMob, CIRCLE8, fight, insideMap, lockFloor, N8, N9, removeTimed,
  say, schedule, setBarrier, show, theHero, throwChar, trueDistance, unlockFloor, yell,
} from './common';
import type { BossRules } from './rules';
import type { Timed } from './state';

/*
 * DM-300 (actors/mobs/DM300.java), its pylons (Pylon.java) and its caves
 * (CavesBossLevel). The machine spits toxic gas at its target and slams the
 * ground to bring rocks down around it (knocking whoever is beside it back),
 * every few turns, sooner when it cannot reach its target. Stepping on a live
 * wire charges a barrier. At two thirds and at a third of its health it
 * supercharges: invulnerable and twice as fast, it digs through rock after the
 * hero, while one of the corner pylons comes alive, arcing lightning round
 * itself and electrifying the arena's water and wires, until the hero destroys
 * it. With both pylons gone it can be destroyed for good.
 */

const MIN_COOLDOWN = 5;
const MAX_COOLDOWN = 9;
const NONE = 0;
const GAS = 1;
const ROCKS = 2;
/** DM300.totalPylonsToActivate, without the stronger bosses' challenge. */
const TOTAL_PYLONS = 2;

/* The caves (CavesBossLevel.seal, unseal, occupyCell, activatePylon, eliminatePylon) */

/** CavesBossLevel.occupyCell: a hero coming near a pylon, the gate still shut, seals the level. */
export function cavesOccupy(ctx: Ctx, hero: Hero): void {
  if (bossFloor(ctx.floor).locked || !hasFlag(ctx.level.map[GATE_CELLS[0]!]!, F.SOLID)) return;
  if (PYLON_POSITIONS.some((pos) => distance(hero.pos, pos) <= 3)) sealCaves(ctx);
}

/** CavesBossLevel.seal: rocks close the stairs; DM-300 starts up somewhere in the arena. */
function sealCaves(ctx: Ctx): void {
  if (!lockFloor(ctx)) return;
  const { level, floor, world, rng } = ctx;
  const entrance = level.entrance;
  setTerrain(level.map, entrance, T.WALL);
  const heap = floor.heaps.find((h) => h.pos === entrance);
  if (heap) {
    floor.heaps.splice(floor.heaps.indexOf(heap), 1);
    let n: number;
    do n = entrance + N8[rng.int(8)]!; while (!isPassable(level, n));
    for (const item of heap.items) dropItem(floor, n, item);
  }
  const there = charAt(world, ctx.depth, entrance);
  if (there) {
    let n: number;
    do n = entrance + N8[rng.int(8)]!; while (!isPassable(level, n));
    there.pos = n;
  }
  for (const h of heroesOn(world, ctx.depth)) observe(world, h);
  show(ctx, 'rocks', { cells: [entrance] });
  ctx.effects.push({ type: 'arena', depth: ctx.depth, sealed: true });
  const open = openSpace(ctx);
  const points: number[] = [];
  for (let y = MAIN_ARENA.top; y <= MAIN_ARENA.bottom; y++) for (let x = MAIN_ARENA.left; x <= MAIN_ARENA.right; x++) points.push(x + y * WIDTH);
  let pos: number;
  let tries = 0;
  do {
    pos = rng.element(points)!;
  } while ((!open[pos] || level.map[pos] === T.EMPTY_SP || charAt(world, ctx.depth, pos)) && ++tries < 1000);
  const dm = scaleMob(world, createMob(`#${++world.nextId}`, 'dm300', pos, 'wandering', floor.now));
  floor.mobs.push(dm);
  fight(ctx, dm, 'start');
}

/** CavesBossLevel.unseal: the energy is gone, the stairs open again, and the gate is blown open. */
function unsealCaves(ctx: Ctx, dm: Mob): void {
  if (ctx.world.arena || ctx.depth !== 15 || !unlockFloor(ctx)) return;
  const { level } = ctx;
  delete bossFloor(ctx.floor).energy;
  setTerrain(level.map, level.entrance, T.ENTRANCE);
  for (const cell of GATE_CELLS) level.map[cell] = T.EMPTY;
  show(ctx, 'gate', { cells: [...GATE_CELLS] });
  for (const h of heroesOn(ctx.world, ctx.depth)) observe(ctx.world, h);
  ctx.effects.push({ type: 'arena', depth: ctx.depth, sealed: false });
  fight(ctx, dm, 'end');
}

/** CavesBossLevel.activatePylon: one pylon comes alive (never the one nearest the hero, while others are left). */
function activatePylon(ctx: Ctx): void {
  const pylons = ctx.floor.mobs.filter((m) => m.kind === 'pylon' && !m.boss?.active);
  const hero = theHero(ctx);
  if (pylons.length === 1) activate(ctx, pylons[0]!);
  else if (pylons.length > 0) {
    let closest: Mob | undefined;
    for (const p of pylons) {
      if (!closest || (hero && trueDistance(p.pos, hero.pos) < trueDistance(closest.pos, hero.pos))) closest = p;
    }
    pylons.splice(pylons.indexOf(closest!), 1);
    activate(ctx, ctx.rng.element(pylons)!);
  }
  // PylonEnergy on every wire, every pool and the gate.
  const boss = bossFloor(ctx.floor);
  const energy = new Set(boss.energy ?? []);
  for (let i = (MAIN_ARENA.top - 1) * WIDTH; i < LENGTH; i++) {
    const t = ctx.level.map[i]!;
    if ((t === T.INACTIVE_TRAP || isWater(t) || GATE_CELLS.includes(i)) && cellX(i) < 33) energy.add(i);
  }
  boss.energy = [...energy].sort((a, b) => a - b);
  ensureBlobs(ctx);
}

/** Pylon.activate. */
function activate(ctx: Ctx, pylon: Mob): void {
  bossMob(pylon).active = true;
  pylon.state = 'hunting';
  show(ctx, 'pylon', { mob: pylon.id, pos: pylon.pos });
}

/** CavesBossLevel.eliminatePylon: DM-300 loses its charge; the energy goes while more than two pylons are left. */
function eliminatePylon(ctx: Ctx): void {
  const dm = ctx.floor.mobs.find((m) => m.kind === 'dm300');
  if (dm) loseSupercharge(ctx, dm);
  const remaining = ctx.floor.mobs.filter((m) => m.kind === 'pylon').length;
  if (remaining > 2) delete bossFloor(ctx.floor).energy;
}

function ensureBlobs(ctx: Ctx): void {
  if (!bossFloor(ctx.floor).timed.some((t) => t.kind === 'blobs')) schedule(ctx, { kind: 'blobs', owner: '', time: ctx.floor.now });
}

/**
 * CavesBossLevel.PylonEnergy.evolve, a turn of it: it spreads at once to every pool, and shocks whoever
 * stands in it (6 to 12), but never DM-300, nor anything that flies.
 */
export function energyTurn(ctx: Ctx): void {
  const boss = bossFloor(ctx.floor);
  if (!boss.energy?.length) return;
  const energy = new Set(boss.energy);
  for (let i = 0; i < LENGTH; i++) if (insideMap(i) && isWater(ctx.level.map[i]!)) energy.add(i);
  boss.energy = [...energy].sort((a, b) => a - b);
  const victims: Char[] = [];
  for (const cell of boss.energy) {
    const ch = charAt(ctx.world, ctx.depth, cell);
    if (!ch || (!isHero(ch) && (ch.kind === 'dm300' || ch.kind === 'pylon')) || !isAlive(ch)) continue;
    if (isHero(ch) && (ch.levitating ?? 0) > 0) continue;
    victims.push(ch);
  }
  if (victims.length > 0) show(ctx, 'zap', { cells: victims.map((v) => v.pos) });
  for (const ch of victims) {
    const damage = ctx.rng.normalIntRange(6, 12);
    ctx.effects.push({ type: 'hurt', depth: ctx.depth, who: ch.id, damage });
    hurt(ctx, ch, damage, 'lightning');
  }
}

/** Level.openSpace: a cell large characters fit in (not solid, with an open corner on both its sides). */
export function openSpace(ctx: Ctx): boolean[] {
  const solid = (c: number): boolean => c < 0 || c >= LENGTH || hasFlag(ctx.level.map[c]!, F.SOLID);
  const open = new Array<boolean>(LENGTH).fill(false);
  for (let i = WIDTH + 1; i < LENGTH - WIDTH - 1; i++) {
    if (solid(i)) continue;
    for (let j = 1; j < 8; j += 2) {
      if (solid(i + CIRCLE8[j]!)) open[i] = false;
      else if (!solid(i + CIRCLE8[(j + 1) % 8]!) && !solid(i + CIRCLE8[(j + 2) % 8]!)) {
        open[i] = true;
        break;
      }
    }
  }
  return open;
}

/* DM-300 */

const dmCooldown = (ctx: Ctx): number => ctx.rng.normalIntRange(MIN_COOLDOWN, MAX_COOLDOWN);

/** Dungeon.findStep for DM-300: through open space only, round the characters in sight. */
function findStep(ctx: Ctx, mob: Mob, to: number, fov: boolean[]): number {
  const open = openSpace(ctx);
  if (adjacent(mob.pos, to)) return !charAt(ctx.world, ctx.depth, to) && open[to] ? to : -1;
  return getStep(mob.pos, to, (c) => open[c]! && !(fov[c] && charAt(ctx.world, ctx.depth, c)));
}

/** Char.cooldown: how long until a character's next turn. */
const cooldownOf = (ctx: Ctx, ch: Char): number => Math.max(0, ch.time - ctx.floor.now);

/** DM300.ventGas: toxic gas along the line to the target and around it, just before the target's next turn. */
function ventGas(ctx: Ctx, dm: Mob, target: Char): void {
  const trajectory = ballistica(ctx, dm.pos, target.pos, STOP_TARGET);
  show(ctx, 'gasZap', { mob: dm.id, pos: dm.pos, to: target.pos });
  schedule(ctx, {
    kind: 'vent', owner: dm.id, from: dm.pos, collision: trajectory.collisionPos, path: subPath(trajectory, 0, trajectory.dist),
    time: ctx.floor.now + cooldownOf(ctx, target), urgent: true,
  });
}

export function ventTurn(ctx: Ctx, vent: Extract<Timed, { kind: 'vent' }>): void {
  removeTimed(ctx, vent);
  let vented = 0;
  seedGas(ctx, vent.collision, 'toxic', 100);
  for (const cell of vent.path) {
    seedGas(ctx, cell, 'toxic', 20);
    vented += 20;
  }
  if (vented < 250) {
    const around = Math.ceil((250 - vented) / 8);
    for (const n of N8) seedGas(ctx, vent.from + n, 'toxic', around);
  }
}

/** DM300.dropRocks: whoever is near is knocked back; rocks will fall around them, all but one cell. */
function dropRocks(ctx: Ctx, dm: Mob, target: Char, fov: boolean[]): void {
  let rockCenter: number;
  show(ctx, 'slam', { mob: dm.id, pos: dm.pos, to: target.pos });
  if (adjacent(dm.pos, target.pos) || (fov[target.pos] && distance(dm.pos, target.pos) === 2)) {
    const power = adjacent(dm.pos, target.pos) ? 2 : 1;
    const opposite = target.pos + (target.pos - dm.pos);
    const trajectory = ballistica(ctx, target.pos, opposite, MAGIC_BOLT);
    throwChar(ctx, target, trajectory, power);
    rockCenter = trajectory.path[Math.min(trajectory.dist, power)]!;
  } else {
    rockCenter = target.pos;
  }
  const solid = (c: number): boolean => hasFlag(ctx.level.map[c]!, F.SOLID);
  const energized = (c: number): boolean => (bossFloor(ctx.floor).energy ?? []).includes(c);
  let safeCell: number;
  let tries = 0;
  do {
    safeCell = rockCenter + N8[ctx.rng.int(8)]!;
  } while (++tries < 1000 && (safeCell === dm.pos || (solid(safeCell) && ctx.rng.int(2) === 0) || (energized(safeCell) && ctx.rng.int(2) === 0)));
  const cells: number[] = [];
  const startX = cellX(rockCenter) - 3;
  const startY = cellY(rockCenter) - 3;
  for (let y = 0; y < 7; y++) {
    for (let x = 0; x < 7; x++) {
      const cx = startX + x;
      const cy = startY + y;
      if (cx < 0 || cy < 0 || cx >= WIDTH) continue;
      const pos = cx + cy * WIDTH;
      if (!insideMap(pos)) continue;
      if (!solid(pos) && pos !== safeCell && ctx.rng.int(distance(rockCenter, pos)) === 0) cells.push(pos);
    }
  }
  const delay = Math.min(3, Math.max(1, Math.ceil(cooldownOf(ctx, target))));
  show(ctx, 'targeted', { cells, value: delay });
  schedule(ctx, { kind: 'rocks', owner: dm.id, cells, time: ctx.floor.now + delay });
}

/** DM300.FallingRockBuff: rocks fall, 6 to 12 and a stun to whoever is under them (not DM-300, not a pylon). */
export function rocksTurn(ctx: Ctx, rocks: Extract<Timed, { kind: 'rocks' }>): void {
  removeTimed(ctx, rocks);
  show(ctx, 'rocks', { cells: rocks.cells });
  for (const cell of rocks.cells) {
    const ch = charAt(ctx.world, ctx.depth, cell);
    if (!ch || !isAlive(ch) || (!isHero(ch) && (ch.kind === 'dm300' || ch.kind === 'pylon'))) continue;
    const damage = ctx.rng.normalIntRange(6, 12);
    ctx.effects.push({ type: 'hurt', depth: ctx.depth, who: ch.id, damage });
    hurt(ctx, ch, damage, 'rocks');
    if (isAlive(ch)) ch.paralysed = Math.max(ch.paralysed ?? 0, 3);
  }
}

/** DM300.supercharge: a pylon comes alive; DM-300 cannot be hurt until it is destroyed. */
function supercharge(ctx: Ctx, dm: Mob): void {
  const b = bossMob(dm);
  b.supercharged = true;
  activatePylon(ctx);
  b.pylonsActivated = (b.pylonsActivated ?? 0) + 1;
  spendMob(dm, 3);
  yell(ctx, dm, 'charging');
  say(ctx, dm, 'invulnerable', 'status');
  show(ctx, 'charge', { mob: dm.id });
  b.chargeAnnounced = false;
  fight(ctx, dm, 'phase', b.pylonsActivated);
}

/** DM300.loseSupercharge. */
function loseSupercharge(ctx: Ctx, dm: Mob): void {
  const b = bossMob(dm);
  b.supercharged = false;
  show(ctx, 'discharge', { mob: dm.id });
  b.turnsSinceLastAbility = Math.min(b.turnsSinceLastAbility ?? 0, MIN_COOLDOWN - 3);
  if ((b.pylonsActivated ?? 0) < TOTAL_PYLONS) {
    yell(ctx, dm, 'charge_lost');
  } else {
    yell(ctx, dm, 'pylons_destroyed');
    bleed(ctx, dm, true);
  }
}

/** One go at DM300.act's abilities: 'turn' if it took the turn, 'free' if it used one at no cost, 'none' if not. */
function abilityStep(ctx: Ctx, dm: Mob, fov: boolean[]): 'turn' | 'free' | 'none' {
  const b = bossMob(dm);
  if ((b.turnsSinceLastAbility ?? -1) >= 0) b.turnsSinceLastAbility!++;
  const hero = theHero(ctx);
  let enemy = heroesOn(ctx.world, ctx.depth).find((h) => h.id === dm.enemy && isAlive(h));
  const reachTarget = enemy ?? hero;
  const canReach = reachTarget === undefined ? false
    : adjacent(dm.pos, reachTarget.pos) || findStep(ctx, dm, reachTarget.pos, fov) !== -1;
  if (dm.state !== 'hunting') {
    if (hero && hero.invisible <= 0 && canReach) {
      dm.state = 'wandering';
      dm.target = hero.pos;
    }
    return 'none';
  }
  if (!enemy && hero && hero.invisible <= 0) {
    enemy = hero;
    dm.enemy = hero.id;
  }
  if (!enemy) return 'none';
  const since = b.turnsSinceLastAbility ?? 0;
  if (!canReach) {
    if (since < MIN_COOLDOWN) return 'none';
    const aim = cone(ctx, ballistica(ctx, dm.pos, enemy.pos, WONT_STOP), Infinity, 30, STOP_SOLID);
    if (aim.cells.includes(enemy.pos)) {
      b.lastAbility = GAS;
      b.turnsSinceLastAbility = 0;
      ventGas(ctx, dm, enemy);
      return 'free';
    } else if (enemy.paralysed <= 0) {
      b.lastAbility = ROCKS;
      b.turnsSinceLastAbility = 0;
      dropRocks(ctx, dm, enemy, fov);
      return 'free';
    }
    return 'none';
  }
  if (!fov[enemy.pos] || since <= (b.abilityCooldown ?? MIN_COOLDOWN)) return 'none';
  const last = b.lastAbility ?? NONE;
  if (last === NONE) b.lastAbility = ctx.rng.int(2) === 0 ? GAS : ROCKS;
  else if (last === GAS) b.lastAbility = ctx.rng.int(4) === 0 ? GAS : ROCKS;
  else b.lastAbility = ctx.rng.int(4) !== 0 ? GAS : ROCKS;
  const close = adjacent(dm.pos, enemy.pos);
  // At a distance, it costs no time.
  if (close) spendMob(dm, 1);
  b.turnsSinceLastAbility = 0;
  b.abilityCooldown = dmCooldown(ctx);
  if (b.lastAbility === GAS) ventGas(ctx, dm, enemy);
  else dropRocks(ctx, dm, enemy, fov);
  return close ? 'turn' : 'free';
}

/** DM300.getCloser when supercharged and stuck: it digs through the arena's rock towards its target. */
function dig(ctx: Ctx, dm: Mob, target: number): boolean {
  const b = bossMob(dm);
  if (!b.supercharged || dm.state !== 'hunting' || (dm.rooted ?? 0) > 0 || target === dm.pos || adjacent(dm.pos, target)) return false;
  let best = dm.pos;
  for (const n of N8) {
    if (!charAt(ctx.world, ctx.depth, dm.pos + n) && trueDistance(best, target) > trueDistance(dm.pos + n, target)) best = dm.pos + n;
  }
  if (best === dm.pos) return false;
  const dug: number[] = [];
  for (const n of N9) {
    const c = dm.pos + n;
    const t = ctx.level.map[c];
    if (t !== T.WALL && t !== T.WALL_DECO) continue;
    const x = cellX(c);
    const y = cellY(c);
    if (y < GATE.bottom && x >= GATE.left - 2 && x < GATE.right + 2) continue;
    if (!rectInside(DIGGABLE_AREA, x, y)) continue;
    ctx.level.map[c] = T.EMPTY_DECO;
    dug.push(c);
  }
  show(ctx, 'dig', { mob: dm.id, cells: dug });
  for (const h of heroesOn(ctx.world, ctx.depth)) observe(ctx.world, h);
  spendMob(dm, 3);
  const open = openSpace(ctx);
  best = dm.pos;
  for (const n of N8) {
    const c = dm.pos + n;
    if (!charAt(ctx.world, ctx.depth, c) && open[c] && trueDistance(best, target) > trueDistance(c, target)) best = c;
  }
  if (best !== dm.pos) {
    const from = dm.pos;
    dm.pos = best;
    ctx.effects.push({ type: 'pushed', depth: ctx.depth, mob: dm.id, from, to: best });
    dmMoved(ctx, dm);
  }
  return true;
}

/** DM300.move: stepping onto a live wire (not an energized one) charges a barrier. */
export function dmMoved(ctx: Ctx, dm: Mob): void {
  if (ctx.level.map[dm.pos] !== T.INACTIVE_TRAP || dm.state !== 'hunting') return;
  if ((bossFloor(ctx.floor).energy ?? []).includes(dm.pos)) return;
  if (!(dm.shield ?? 0)) say(ctx, dm, 'shield', 'warn');
  const shield = 30 + Math.trunc((dm.ht - dm.hp) / 10);
  setBarrier(ctx, dm, shield);
  show(ctx, 'shield', { mob: dm.id, value: shield });
}

export const DM300: BossRules = {
  attackSkill() {
    return 20;
  },
  defenseSkill() {
    return 15;
  },
  damageRoll(ctx) {
    return ctx.rng.normalIntRange(15, 25);
  },
  drRoll(ctx) {
    return ctx.rng.normalIntRange(0, 10);
  },
  act(ctx, dm) {
    const b = bossMob(dm);
    if ((dm.paralysed ?? 0) > 0) return false;
    if (!b.supercharged) {
      const fov = mobFov(ctx, dm, 8);
      for (let i = 0; i < 4; i++) {
        const step = abilityStep(ctx, dm, fov);
        if (step === 'turn') return true;
        if (step === 'none') break;
      }
    } else {
      if (!b.chargeAnnounced) {
        yell(ctx, dm, 'supercharged');
        b.chargeAnnounced = true;
      }
      const hero = theHero(ctx);
      if (hero && hero.invisible <= 0) {
        dm.state = 'hunting';
        dm.target = hero.pos;
        dm.enemy = hero.id;
      }
    }
    return false;
  },
  speed(mob) {
    return mob.boss?.supercharged ? 2 : 1;
  },
  getCloser(ctx, dm, target, fov) {
    const step = findStep(ctx, dm, target, fov);
    if (step !== -1) {
      const from = dm.pos;
      dm.pos = step;
      ctx.effects.push({ type: 'pushed', depth: ctx.depth, mob: dm.id, from, to: step });
      // DM300.move: the ground shakes under it.
      dmMoved(ctx, dm);
      return true;
    }
    return dig(ctx, dm, target);
  },
  notice(ctx, dm, hero) {
    if (!assignBar(ctx, dm)) return;
    bossMob(dm).turnsSinceLastAbility = 0;
    bossMob(dm).abilityCooldown ??= dmCooldown(ctx);
    yell(ctx, dm, 'notice', hero);
  },
  beforeDamage(ctx, dm, damage) {
    if (!barAssigned(ctx)) {
      const hero = theHero(ctx);
      if (hero) DM300.notice!(ctx, dm, hero);
    }
    const b = bossMob(dm);
    if (b.supercharged) {
      if (!b.invulnWarned) {
        b.invulnWarned = true;
        say(ctx, dm, 'charging_hint', 'warn');
      }
      say(ctx, dm, 'invulnerable', 'status');
      return null;
    }
    return damage;
  },
  afterDamage(ctx, dm, before) {
    const b = bossMob(dm);
    bossHurt(ctx, dm, before - dm.hp, 1);
    const threshold = Math.trunc(dm.ht / 3) * (2 - (b.pylonsActivated ?? 0));
    // (Away from its caves, in the arena of waves, there are no pylons to charge it.)
    const pylons = ctx.floor.mobs.some((m) => m.kind === 'pylon');
    if (dm.hp <= threshold && threshold > 0 && pylons) {
      dm.hp = threshold;
      supercharge(ctx, dm);
    }
  },
  die(ctx, dm) {
    unsealCaves(ctx, dm);
    const shards = ctx.rng.chances([0, 0, 6, 3, 1]);
    for (let i = 0; i < shards; i++) {
      let ofs: number;
      let tries = 0;
      do ofs = N8[ctx.rng.int(8)]!; while (!isPassable(ctx.level, dm.pos + ofs) && ++tries < 100);
      dropItem(ctx.floor, dm.pos + ofs, createItem('quest.metalShard'));
    }
    yell(ctx, dm, 'defeated');
  },
  immune: new Set(['sleep', 'gas']),
};

/* The pylons */

/** Pylon.act: switched on, it arcs to two opposite neighbours, turning a step every turn. */
function pylonAct(ctx: Ctx, pylon: Mob): void {
  const b = bossMob(pylon);
  if (!b.active) {
    spendMob(pylon, 1);
    return;
  }
  const t = b.targetNeighbor ?? 0;
  const cells = [pylon.pos + CIRCLE8[t]!, pylon.pos + CIRCLE8[(t + 4) % 8]!];
  show(ctx, 'zap', { mob: pylon.id, pos: pylon.pos, cells });
  for (const cell of cells) {
    const ch = charAt(ctx.world, ctx.depth, cell);
    if (!ch || !isAlive(ch) || (!isHero(ch) && ch.kind === 'dm300')) continue;
    const damage = ctx.rng.normalIntRange(10, 20);
    ctx.effects.push({ type: 'hurt', depth: ctx.depth, who: ch.id, damage });
    hurt(ctx, ch, damage, 'lightning');
  }
  b.targetNeighbor = (t + 1) % 8;
  spendMob(pylon, 1);
}

export const PYLON: BossRules = {
  act(ctx, pylon) {
    pylonAct(ctx, pylon);
    return true;
  },
  canAttack: () => false,
  getCloser: () => false,
  beckon: false,
  beforeDamage(ctx, pylon, damage) {
    // Inactive, it cannot be hurt.
    if (!pylon.boss?.active) {
      say(ctx, pylon, 'invulnerable', 'status');
      return null;
    }
    // Pylon.damage: big blows count for less.
    if (damage >= 15) damage = 14 + Math.trunc((Math.sqrt(8 * (damage - 14) + 1) - 1) / 2);
    bossHurt(ctx, pylon, damage, 1);
    return damage;
  },
  die(ctx) {
    eliminatePylon(ctx);
  },
  immune: new Set(['gas', 'poison', 'bleeding', 'paralysis', 'sleep', 'terror', 'charm', 'blind', 'rooted', 'burning']),
};

/** CavesBossLevel.createMobs: the four pylons. */
export function cavesPylons(nextId: () => string): Mob[] {
  return PYLON_POSITIONS.map((pos) => {
    const pylon = createMob(nextId(), 'pylon', pos, 'passive', 0);
    pylon.boss = { active: false, targetNeighbor: 0 };
    return pylon;
  });
}

/** A pylon's starting arc (Pylon.targetNeighbor = Random.Int(8)), rolled from the depth's monster stream. */
export function rollPylonArcs(pylons: Mob[], rng: Ctx['rng']): void {
  for (const pylon of pylons) bossMob(pylon).targetNeighbor = rng.int(8);
}
