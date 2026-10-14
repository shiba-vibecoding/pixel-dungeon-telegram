import { createMob, type Hero, isAlive, type Mob } from '../actors';
import { disarmTrap, setTrap, trapAt } from '../traps';
import { attack, drRollOf, hurt, killMob } from '../combat';
import { burnCell } from '../traps';
import { ballistica, PROJECTILE, WONT_STOP } from '../ballistica';
import { charAt, type Char, type Ctx, dropItem, heroesOn, isHero, observe } from '../floor';
import type { Item } from '../items';
import { adjacent, distance, LENGTH, WIDTH } from '../level/geometry';
import { F, hasFlag, T } from '../level/terrain';
import {
  ARENA, insideRect, PAUSE_SAFE_AREA, randomTenguCellPos, setMapArena, setMapEnd, setMapPause,
  START_HALLWAY, TENGU_CELL, TENGU_CELL_CENTER, TENGU_CELL_DOOR,
} from '../level/prison-boss';
import { bossHurt } from '../hero';
import { isChallenged, STRONGER_BOSSES } from '../challenges';
import { mobFov, spendMob } from '../ai';
import { scaleMob } from '../party';
import { S } from '../spd-sprites';
import { createItem } from '../items';
import {
  assignBar, bleed, bossFloor, bossMob, CIRCLE8, distanceMap, fight, gatherParty, lockFloor, N8, patchGenerate, removeTimed,
  schedule, show, timedOf, trueDistance, unlockFloor, yell,
} from './common';
import { BOSS_SLOT, bossScore } from '../score';
import type { BossRules } from './rules';
import type { Timed } from './state';
import type { World } from '../world';

/*
 * Tengu (actors/mobs/Tengu.java) and his prison (PrisonBossLevel). He waits
 * in his cell at the bottom of the level, locked; once the hero is inside, the
 * door locks behind them and the fight begins. Tengu never walks: he throws
 * shuriken at anyone in a clear line (and strikes whoever is next to him), and
 * every eighth of his health lost he vanishes in smoke and reappears elsewhere
 * in the cell, which fills with hidden dart traps between him and the hero,
 * more the more he is hurt. At half health he is gone, the level changes, and
 * the hero climbs back up the hallway into an oval arena, where Tengu fights
 * on with his abilities: bombs that count down and blast all within two steps,
 * waves of fire, shockers that arc all around them. Slain, he leaves his mask.
 */

/** Tengu's numbers: half of them is each phase. */
export const TENGU_HT = 200;

/** Tengu's health (his initialiser): 200, 250 under the stronger bosses challenge. */
export const tenguHealth = (world: World): number => (isChallenged(world, STRONGER_BOSSES) ? 250 : TENGU_HT);

const BOMB_ABILITY = 0;
const FIRE_ABILITY = 1;
const SHOCKER_ABILITY = 2;

/* The prison's course (PrisonBossLevel.progress, occupyCell) */

/** PrisonBossLevel.occupyCell: the hero steps into Tengu's cell, or back up the hallway in the pause. */
export function prisonOccupy(ctx: Ctx, hero: Hero): void {
  const state = bossFloor(ctx.floor).prison ?? 'start';
  const y = Math.trunc(hero.pos / WIDTH);
  if (state === 'start' && y > TENGU_CELL.top) progress(ctx, hero);
  else if (state === 'fightPause' && y <= START_HALLWAY.top + 1) progress(ctx, hero);
}

function heroOf(ctx: Ctx, preferred?: Hero): Hero | undefined {
  return preferred ?? heroesOn(ctx.world, ctx.depth)[0];
}

/** PrisonBossLevel.progress: the fight moves on to its next stage. */
export function progress(ctx: Ctx, by?: Hero): void {
  const boss = bossFloor(ctx.floor);
  const { level, floor, world } = ctx;
  const seed = world.run.seed;
  switch (boss.prison ?? 'start') {
    case 'start': {
      let pos = TENGU_CELL_CENTER;
      if (charAt(world, ctx.depth, pos)) {
        const free = N8.map((n) => pos + n).filter((c) => !charAt(world, ctx.depth, c));
        if (free.length === 0) return;
        pos = ctx.rng.element(free)!;
      }
      lockFloor(ctx);
      level.map[TENGU_CELL_DOOR] = T.LOCKED_DOOR;
      // Whatever lay in the doorway is pushed into the cell.
      const heap = floor.heaps.find((h) => h.pos === TENGU_CELL_DOOR);
      if (heap) {
        floor.heaps.splice(floor.heaps.indexOf(heap), 1);
        for (const item of heap.items) dropItem(floor, TENGU_CELL_DOOR + WIDTH, item);
      }
      ctx.effects.push({ type: 'arena', depth: ctx.depth, sealed: true });
      // Companions still outside come in with the hero (Mob.restoreAllies).
      gatherParty(ctx, (pos) => insideRect({ left: TENGU_CELL.left + 1, top: TENGU_CELL.top + 1, right: TENGU_CELL.right - 2, bottom: TENGU_CELL.bottom - 2 }, pos), TENGU_CELL_DOOR + WIDTH);
      let tengu = boss.tengu;
      if (!tengu) {
        tengu = createMob(`#${++world.nextId}`, 'tengu', pos, 'hunting', floor.now);
        tengu.hp = tengu.ht = tenguHealth(world);
        scaleMob(world, tengu);
      }
      delete boss.tengu;
      tengu.pos = pos;
      tengu.state = 'hunting';
      tengu.time = floor.now;
      floor.mobs.push(tengu);
      boss.prison = 'fightStart';
      tenguNotice(ctx, tengu, heroOf(ctx, by));
      show(ctx, 'puff', { pos: tengu.pos });
      fight(ctx, tengu, 'start');
      break;
    }
    case 'fightStart': {
      const tengu = floor.mobs.find((m) => m.kind === 'tengu');
      if (!tengu) return;
      clearEntities(ctx, TENGU_CELL, tengu);
      setMapPause(level.map, seed);
      cleanMapState(ctx);
      gatherParty(ctx, () => true, TENGU_CELL_DOOR + WIDTH);
      // Tengu leaves the level until the arena.
      floor.mobs.splice(floor.mobs.indexOf(tengu), 1);
      boss.tengu = tengu;
      clearAbilities(ctx, tengu);
      show(ctx, 'flash', { value: 0xffffff });
      show(ctx, 'blast', { cells: [] });
      boss.prison = 'fightPause';
      fight(ctx, tengu, 'phase', 2);
      break;
    }
    case 'fightPause': {
      const tengu = boss.tengu;
      if (!tengu) return;
      clearEntities(ctx, PAUSE_SAFE_AREA, tengu);
      setMapArena(level.map);
      cleanMapState(ctx);
      delete boss.tengu;
      tengu.state = 'hunting';
      tengu.pos = ARENA.left + Math.trunc((ARENA.right - ARENA.left) / 2) + WIDTH * (ARENA.top + 2);
      tengu.time = floor.now;
      // Anyone where Tengu comes down steps aside.
      const there = charAt(world, ctx.depth, tengu.pos);
      if (there) there.pos = N8.map((n) => tengu.pos + n).find((c) => hasFlag(level.map[c]!, F.PASSABLE) && !charAt(world, ctx.depth, c)) ?? there.pos;
      floor.mobs.push(tengu);
      // BossHealthBar.isAssigned: Tengu was gone from the level; he is noticed afresh («I have you now»).
      delete boss.bar;
      gatherParty(ctx, () => true, by?.pos ?? START_HALLWAY.left + 1 + (START_HALLWAY.top + 1) * WIDTH);
      tenguNotice(ctx, tengu, heroOf(ctx, by));
      show(ctx, 'puff', { pos: tengu.pos });
      show(ctx, 'flash', { value: 0xffffff });
      show(ctx, 'blast', { cells: [] });
      boss.prison = 'fightArena';
      for (const hero of heroesOn(world, ctx.depth)) observe(world, hero);
      break;
    }
    case 'fightArena': {
      const tengu = floor.mobs.find((m) => m.kind === 'tengu');
      if (!tengu) return;
      unlockFloor(ctx);
      // The hero and Tengu are back in his cell, and the prison is as it was, with a way down.
      const heroes = heroesOn(world, ctx.depth);
      heroes.forEach((hero, i) => {
        hero.pos = TENGU_CELL.left + 4 + i + (TENGU_CELL.top + 2) * WIDTH;
      });
      tengu.pos = TENGU_CELL_CENTER;
      // Other monsters (allies aside: none here) are gone with the arena.
      for (const mob of [...floor.mobs]) if (mob !== tengu && mob.state !== 'passive') floor.mobs.splice(floor.mobs.indexOf(mob), 1);
      setMapEnd(level.map, seed);
      clearAbilities(ctx, tengu);
      tengu.hp = 0;
      killMob(ctx, tengu, heroes[0]?.id);
      clearEntities(ctx, TENGU_CELL, tengu);
      cleanMapState(ctx);
      for (const item of boss.stored ?? []) dropItem(floor, randomTenguCellPos(ctx.rng), item);
      delete boss.stored;
      show(ctx, 'flash', { value: 0xffffff });
      show(ctx, 'blast', { cells: [] });
      ctx.effects.push({ type: 'arena', depth: ctx.depth, sealed: false });
      boss.prison = 'won';
      fight(ctx, tengu, 'end');
      break;
    }
    default:
      break;
  }
}

/**
 * PrisonBossLevel.clearEntities: what lies outside the safe area (all of it, without one) is put
 * aside for the end, monsters outside it are gone, and so are plants.
 */
function clearEntities(ctx: Ctx, safe: { left: number; top: number; right: number; bottom: number } | null, tengu: Mob): void {
  const { floor } = ctx;
  const boss = bossFloor(floor);
  const outside = (pos: number): boolean => safe === null || !insideRect(safe, pos);
  for (const heap of [...floor.heaps]) {
    if (!outside(heap.pos)) continue;
    (boss.stored ??= []).push(...heap.items);
    floor.heaps.splice(floor.heaps.indexOf(heap), 1);
  }
  for (const mob of [...floor.mobs]) {
    if (mob !== tengu && outside(mob.pos)) floor.mobs.splice(floor.mobs.indexOf(mob), 1);
  }
  if (floor.plants) floor.plants = floor.plants.filter((plant) => !outside(plant.pos));
}

/** PrisonBossLevel.cleanMapState: every cloud and blob is gone, the traps too, and the level is unexplored again. */
function cleanMapState(ctx: Ctx): void {
  const { floor, world, level } = ctx;
  const boss = bossFloor(floor);
  delete floor.gas;
  delete floor.gasAt;
  delete boss.fire;
  delete boss.shock;
  delete boss.tenguTraps;
  boss.timed = boss.timed.filter((entry) => entry.kind !== 'blobs');
  world.explored[ctx.depth] = new Array<boolean>(LENGTH).fill(false);
  for (const hero of heroesOn(world, ctx.depth)) observe(world, hero);
}

/** Tengu's bombs, fire and shockers end with him (Char.destroy detaches his buffs). */
function clearAbilities(ctx: Ctx, tengu: Mob): void {
  const boss = bossFloor(ctx.floor);
  boss.timed = boss.timed.filter((entry) => entry.owner !== tengu.id);
}

/** PrisonBossLevel.cleanTenguCell: Tengu's traps are gone. */
function cleanTenguCell(ctx: Ctx): void {
  const boss = bossFloor(ctx.floor);
  for (let y = TENGU_CELL.top + 1; y < TENGU_CELL.bottom - 1; y++) {
    for (let x = TENGU_CELL.left + 1; x < TENGU_CELL.right - 1; x++) ctx.level.map[x + y * WIDTH] = T.EMPTY;
  }
  delete boss.tenguTraps;
}

/**
 * PrisonBossLevel.placeTrapsInTenguCell: hidden dart traps fill `fill` of Tengu's cell, laid so that
 * the shortest way from the hero to Tengu avoiding them is neither too short nor too long.
 */
function placeTrapsInTenguCell(ctx: Ctx, tengu: Mob, hero: Hero, fill: number): void {
  const left = TENGU_CELL.left + 1;
  const top = TENGU_CELL.top + 1;
  const local = (pos: number): number => (pos % WIDTH) - left + (Math.trunc(pos / WIDTH) - top) * 7;
  const tenguPos = local(tengu.pos);
  const heroPos = local(hero.pos);
  // The fill ramps up much faster under the stronger bosses: effectively 78% to 90%.
  if (isChallenged(ctx.world, STRONGER_BOSSES)) fill = Math.fround(Math.fround(0.675) + Math.fround(fill / 4));
  const heroIn = heroPos >= 0 && heroPos < 49 && insideRect({ left, top, right: left + 6, bottom: top + 6 }, hero.pos);
  let patch: boolean[];
  let tries = 0;
  for (let guard = 0; ; guard++) {
    tries++;
    if (tries >= 100) {
      tries = 0;
      fill = Math.fround(fill - 0.01);
    }
    patch = patchGenerate(ctx.rng, 7, 7, fill, 0, false);
    const dist = distanceMap(tenguPos, (c) => !patch[c], Infinity, 7, 49);
    const d = heroIn ? dist[heroPos]! : 0;
    if (!heroIn || guard > 20000) break;
    if (!(d < Math.ceil(Math.fround(7 * fill)) || d > Math.ceil(Math.fround(4 + Math.fround(4 * fill))))) break;
  }
  const boss = bossFloor(ctx.floor);
  const traps: number[] = [];
  for (let i = 0; i < patch.length; i++) {
    if (!patch[i]) continue;
    const pos = left + (i % 7) + (top + Math.trunc(i / 7)) * WIDTH;
    if (boss.shock?.some(([c]) => c === pos) || (ctx.floor.plants ?? []).some((p) => p.pos === pos) || charAt(ctx.world, ctx.depth, pos)) continue;
    // A hidden trap (SECRET_TRAP with a TenguDartTrap).
    setTrap(ctx.level, pos, 'tenguDart', false);
    traps.push(pos);
  }
  boss.tenguTraps = traps;
  // FadingTraps: they show a moment, then fade from sight.
  show(ctx, 'traps', { cells: traps });
}

/**
 * TenguDartTrap (a PoisonDartTrap): stepped on, it shoots a poisoned dart at the closest character in
 * a clear line (never Tengu) within sight: 4 to 8 damage, less armour, and poison. True if it was one.
 */
export function tenguDartTrap(ctx: Ctx, victim: Char | null, pos: number): boolean {
  const traps = ctx.floor.boss?.tenguTraps;
  if (!traps?.includes(pos)) return false;
  const trap = trapAt(ctx.level, pos);
  if (trap) disarmTrap(ctx.level, trap);
  else ctx.level.map[pos] = T.INACTIVE_TRAP;
  traps.splice(traps.indexOf(pos), 1);
  ctx.effects.push({ type: 'trap', depth: ctx.depth, pos, kind: 'tenguDart', hero: victim && isHero(victim) ? victim.id : '' });
  let target: Char | undefined = victim && !(!isHero(victim) && victim.kind === 'tengu') ? victim : undefined;
  if (!target) {
    const range = Math.max(6, 12) + 0.5;
    let closest = Infinity;
    const chars: Char[] = [...heroesOn(ctx.world, ctx.depth), ...ctx.floor.mobs];
    for (const ch of chars) {
      if (!isAlive(ch) || (!isHero(ch) && ch.kind === 'tengu')) continue;
      let d = trueDistance(pos, ch.pos);
      if (isHero(ch) && ch.invisible > 0) d = Math.max(d, range);
      if (ballistica(ctx, pos, ch.pos, PROJECTILE).collisionPos === ch.pos && (d < closest || (d === closest && isHero(ch)))) {
        target = ch;
        closest = d;
      }
    }
    if (closest > range) target = undefined;
  }
  if (!target) return true;
  if (isHero(target)) bossScore(ctx.world, BOSS_SLOT.tengu, -100);
  ctx.effects.push({ type: 'missile', depth: ctx.depth, from: pos, to: target.pos, sprite: S.DART });
  const dr = drRollOf(ctx, target);
  const damage = ctx.rng.normalIntRange(4, 8) - dr;
  if (damage > 0) {
    ctx.effects.push({ type: 'hurt', depth: ctx.depth, who: target.id, damage });
    hurt(ctx, target, damage, 'poison');
  }
  // Poison.set(8): SEAM(alchemy): Pixel Dungeon's poison stands in for Shattered's until it is ported.
  // TenguDartTrap.poisonAmount: 8, or 15 (50 damage in all) under the stronger bosses challenge.
  if (isAlive(target)) target.poison = Math.max(target.poison ?? 0, isChallenged(ctx.world, STRONGER_BOSSES) ? 15 : 8);
  return true;
}

/* Tengu */

function tenguNotice(ctx: Ctx, tengu: Mob, hero: Hero | undefined): void {
  if (!assignBar(ctx, tengu)) return;
  if (tengu.hp <= Math.trunc(tengu.ht / 2)) bleed(ctx, tengu, true);
  yell(ctx, tengu, tengu.hp === tengu.ht ? 'notice_gotcha' : 'notice_have', hero);
}

/** Tengu.canAttack: a clear line for a shuriken. */
const canThrowAt = (ctx: Ctx, tengu: Mob, enemy: Char): boolean => ballistica(ctx, tengu.pos, enemy.pos, PROJECTILE).collisionPos === enemy.pos;

/** Tengu.jump: away in a puff of smoke, within his cell or, in the arena, five to seven steps off. */
function jump(ctx: Ctx, tengu: Mob): void {
  const { world, depth, level, rng } = ctx;
  const heroes = heroesOn(world, depth);
  const enemy = heroes.find((h) => h.id === tengu.enemy) ?? heroes[0];
  if (!enemy || !isAlive(tengu)) return;
  const hero = heroes[0]!;
  const boss = bossFloor(ctx.floor);
  const tb = bossMob(tengu);
  let to: number;
  if (boss.prison === 'fightStart') {
    cleanTenguCell(ctx);
    let tries = 100;
    do {
      to = randomTenguCellPos(rng);
      tries--;
    } while (tries > 0 && (trueDistance(to, enemy.pos) <= 3.5 || trueDistance(to, hero.pos) <= 3.5 || charAt(world, depth, to)));
    if (tries <= 0) to = tengu.pos;
    show(ctx, 'puff', { pos: tengu.pos });
    moveTengu(ctx, tengu, to);
    show(ctx, 'puff', { pos: to });
    const fill = Math.fround(0.9 - 0.5 * ((tengu.hp - tengu.ht / 2) / (tengu.ht / 2)));
    placeTrapsInTenguCell(ctx, tengu, enemy, fill);
  } else {
    let tries = 100;
    do {
      to = rng.int(LENGTH);
      tries--;
    } while (tries > 0 && (hasFlag(level.map[to]!, F.SOLID) || distance(to, enemy.pos) < 5 || distance(to, enemy.pos) > 7 ||
      distance(to, hero.pos) < 5 || distance(to, hero.pos) > 7 || distance(to, tengu.pos) < 5 ||
      charAt(world, depth, to) || ctx.floor.heaps.some((h) => h.pos === to)));
    if (tries <= 0) to = tengu.pos;
    show(ctx, 'puff', { pos: tengu.pos });
    moveTengu(ctx, tengu, to);
    if ((tb.arenaJumps ?? 0) < 4) tb.arenaJumps = (tb.arenaJumps ?? 0) + 1;
    show(ctx, 'puff', { pos: to });
  }
}

function moveTengu(ctx: Ctx, tengu: Mob, to: number): void {
  const from = tengu.pos;
  tengu.pos = to;
  if (from !== to) ctx.effects.push({ type: 'jumped', depth: ctx.depth, mob: tengu.id, from, to });
}

/** Tengu.canUseAbility: in the arena, as he falls behind on abilities (two for every jump), sooner. Called once a turn. */
function canUseAbility(ctx: Ctx, tengu: Mob): boolean {
  if (tengu.hp > tengu.ht / 2) return false;
  const tb = bossMob(tengu);
  const used = tb.abilitiesUsed ?? 0;
  const target = targetAbilityUses(tengu);
  if (used >= target) return false;
  tb.abilityCooldown = (tb.abilityCooldown ?? 2) - 1;
  // (Not under the stronger bosses: they already cast quickly, and spend no time on the ones they are far behind on.)
  if (target - used >= 4 && !isChallenged(ctx.world, STRONGER_BOSSES)) tb.abilityCooldown = 0;
  else if (target - used >= 3) {
    if (tb.abilityCooldown === -1 || tb.abilityCooldown > 1) tb.abilityCooldown = 1;
  } else if (tb.abilityCooldown === -1) tb.abilityCooldown = ctx.rng.intRange(1, 4);
  return tb.abilityCooldown === 0;
}

function targetAbilityUses(tengu: Mob): number {
  const jumps = tengu.boss?.arenaJumps ?? 0;
  return 1 + 2 * jumps + Math.max(0, jumps - 2);
}

/** Tengu.useAbility: a bomb first, a shocker second, then any (the same as last time only one in ten). */
function useAbility(ctx: Ctx, tengu: Mob, hero: Hero): void {
  const tb = bossMob(tengu);
  const used = tb.abilitiesUsed ?? 0;
  let ability = -1;
  let done = false;
  for (let guard = 0; !done && guard < 1000; guard++) {
    if (used === 0) ability = BOMB_ABILITY;
    else if (used === 1) ability = SHOCKER_ABILITY;
    // Under the stronger bosses never fire by choice (0 or 2): it comes with every other ability.
    else ability = isChallenged(ctx.world, STRONGER_BOSSES) ? ctx.rng.int(2) * 2 : ctx.rng.int(3);
    if (ability !== (tb.lastAbility ?? -1) || ctx.rng.int(10) === 0) {
      switch (ability) {
        case SHOCKER_ABILITY:
          done = throwShocker(ctx, tengu, hero);
          if (used === 1 && !done) {
            ability = FIRE_ABILITY;
            done = throwFire(ctx, tengu, hero);
          }
          break;
        case FIRE_ABILITY:
          done = throwFire(ctx, tengu, hero);
          break;
        default:
          done = throwBomb(ctx, tengu, hero);
          if (used === 0 && !done) {
            ability = FIRE_ABILITY;
            done = throwFire(ctx, tengu, hero);
          }
      }
      // Always the fire ability too, under the stronger bosses.
      if (done && ability !== FIRE_ABILITY && isChallenged(ctx.world, STRONGER_BOSSES)) throwFire(ctx, tengu, hero);
    }
  }
  // Spends a turn less if seriously behind on ability uses (none at all, then, under the stronger bosses).
  const behind = targetAbilityUses(tengu) - used >= 4;
  if (isChallenged(ctx.world, STRONGER_BOSSES)) {
    if (!behind) spendMob(tengu, 1);
  } else {
    spendMob(tengu, behind ? 1 : 2);
  }
  tb.lastAbility = ability;
  tb.abilitiesUsed = used + 1;
}

/** Tengu.throwBomb: at the cell beside the target closest to Tengu with no bomb on it yet. */
function throwBomb(ctx: Ctx, tengu: Mob, target: Char): boolean {
  const bombs = timedOf(ctx, 'bomb').filter((b) => b.owner === tengu.id);
  let cell = -1;
  for (const n of N8) {
    const c = target.pos + n;
    if (bombs.some((b) => b.pos === c) || hasFlag(ctx.level.map[c]!, F.SOLID)) continue;
    if (cell === -1 || trueDistance(c, tengu.pos) < trueDistance(cell, tengu.pos)) cell = c;
  }
  if (cell === -1) return false;
  show(ctx, 'throw', { mob: tengu.id, pos: tengu.pos, to: cell, value: S.TENGU_BOMB });
  schedule(ctx, { kind: 'bomb', owner: tengu.id, pos: cell, timer: 3, time: ctx.floor.now });
  return true;
}

/** Tengu.throwFire: a wave of fire rolling out from Tengu towards the target. */
function throwFire(ctx: Ctx, tengu: Mob, target: Char): boolean {
  const aim = ballistica(ctx, tengu.pos, target.pos, WONT_STOP);
  const direction = CIRCLE8.findIndex((n) => aim.sourcePos + n === aim.path[1]);
  if (direction < 0) return false;
  show(ctx, 'fire', { mob: tengu.id, pos: tengu.pos, to: target.pos, cells: [] });
  schedule(ctx, { kind: 'fire', owner: tengu.id, direction, cells: null, origin: tengu.pos, time: ctx.floor.now });
  return true;
}

/** Level.trueDistance as Shattered computes it for a cell of -1 (the point (-1, 0)): how throwShocker starts. */
const trueDistanceFromNone = (pos: number): number => {
  const dx = -1 - (pos % WIDTH);
  const dy = 0 - Math.trunc(pos / WIDTH);
  return Math.fround(Math.sqrt(dx * dx + dy * dy));
};

/** Tengu.throwShocker: beside the target, not beside Tengu, nor beside another shocker. */
function throwShocker(ctx: Ctx, tengu: Mob, target: Char): boolean {
  const shockers = timedOf(ctx, 'shocker').filter((s) => s.owner === tengu.id);
  let cell = -1;
  for (const n of N8) {
    const c = target.pos + n;
    if (distance(c, tengu.pos) < 2 || hasFlag(ctx.level.map[c]!, F.SOLID)) continue;
    if (shockers.some((s) => distance(c, s.pos) < 2)) continue;
    const best = cell === -1 ? trueDistanceFromNone(tengu.pos) : trueDistance(cell, tengu.pos);
    if (trueDistance(c, tengu.pos) < best) cell = c;
  }
  if (cell === -1) return false;
  show(ctx, 'throw', { mob: tengu.id, pos: tengu.pos, to: cell, value: S.TENGU_SHOCKER });
  schedule(ctx, { kind: 'shocker', owner: tengu.id, pos: cell, ordinals: null, time: Math.ceil(ctx.floor.now) });
  return true;
}

/** Tengu's Hunting.act: he never moves; he attacks, or uses an ability, or waits. */
function tenguAct(ctx: Ctx, tengu: Mob, fov: boolean[]): void {
  const heroes = heroesOn(ctx.world, ctx.depth).filter((h) => h.invisible <= 0);
  let enemy = heroes.find((h) => h.id === tengu.enemy && fov[h.pos]) ?? heroes.find((h) => fov[h.pos]);
  if (enemy) tengu.enemy = enemy.id;
  const hero = heroesOn(ctx.world, ctx.depth)[0];
  tengu.enemySeen = enemy !== undefined;
  if (enemy && !(tengu.charmed && tengu.charmedBy === enemy.id) && canThrowAt(ctx, tengu, enemy)) {
    if (hero && canUseAbility(ctx, tengu)) {
      useAbility(ctx, tengu, hero);
      return;
    }
    tengu.target = enemy.pos;
    if (!adjacent(tengu.pos, enemy.pos)) {
      ctx.effects.push({ type: 'missile', depth: ctx.depth, from: tengu.pos, to: enemy.pos, sprite: S.SHURIKEN });
    }
    attack(ctx, tengu, enemy);
    spendMob(tengu, 1);
    return;
  }
  // Tengu.Hunting.handleUnreachableTarget: an ability even without a target in sight, else a turn's wait.
  enemy = undefined;
  if (hero && canUseAbility(ctx, tengu)) {
    useAbility(ctx, tengu, hero);
    return;
  }
  spendMob(tengu, 1);
}

export const TENGU: BossRules = {
  attackSkill(_ctx, mob, target) {
    return adjacent(mob.pos, target.pos) ? 10 : 20;
  },
  defenseSkill() {
    return 15;
  },
  damageRoll(ctx) {
    return ctx.rng.normalIntRange(6, 12);
  },
  drRoll(ctx) {
    return ctx.rng.normalIntRange(0, 5);
  },
  act(ctx, mob) {
    tenguAct(ctx, mob, tenguFov(ctx, mob));
    return true;
  },
  canAttack(ctx, mob, enemy) {
    return canThrowAt(ctx, mob, enemy);
  },
  getCloser() {
    return false;
  },
  notice(ctx, mob, hero) {
    tenguNotice(ctx, mob, hero);
  },
  beforeDamage(ctx, mob, damage) {
    // Out of the level (the pause), nothing touches him.
    if (!ctx.floor.mobs.includes(mob)) return null;
    return damage;
  },
  afterDamage(ctx, mob, before) {
    const boss = bossFloor(ctx.floor);
    const bracket = Math.trunc(mob.ht / 8);
    const cur = Math.trunc(before / bracket);
    // He cannot be hurt through more than one eighth of his health at a time.
    if (mob.hp <= (cur - 1) * bracket) mob.hp = (cur - 1) * bracket + 1;
    const next = Math.trunc(Math.max(0, mob.hp) / bracket);
    // Tengu.damage: the lock's time, by the damage (two thirds of it under the stronger bosses).
    const lost = before - mob.hp;
    bossHurt(ctx, mob, isChallenged(ctx.world, STRONGER_BOSSES) ? Math.fround((2 * lost) / 3) : lost, 1);
    if (mob.hp <= 0 && boss.prison === 'fightArena') {
      // The second phase is over, once the blow is done.
      mob.hp = 0;
      schedule(ctx, { kind: 'progress', owner: mob.id, time: ctx.floor.now, urgent: true });
      return;
    }
    if (boss.prison === 'fightStart' && mob.hp <= mob.ht / 2) {
      mob.hp = Math.trunc(mob.ht / 2);
      yell(ctx, mob, 'interesting');
      progress(ctx);
      bleed(ctx, mob, true);
    } else if (next !== cur) {
      schedule(ctx, { kind: 'jump', owner: mob.id, time: ctx.floor.now, urgent: true });
    }
  },
  holdsOn(ctx, mob) {
    // Tengu.isAlive: in the level, he is not dead until the arena's fight is over (PrisonBossLevel.progress).
    return ctx.floor.mobs.includes(mob) && bossFloor(ctx.floor).prison === 'fightArena';
  },
  die(ctx, mob) {
    // Tengu's mask, for a hero who has not chosen a way yet.
    if (heroesOn(ctx.world, ctx.depth).some((h) => !h.subclass) || ctx.world.heroes.some((h) => !h.subclass)) {
      dropItem(ctx.floor, mob.pos, createItem('mask.tengu'));
    }
    yell(ctx, mob, 'defeated');
  },
  immune: new Set(['rooted', 'blind', 'terror']),
};

function tenguFov(ctx: Ctx, mob: Mob): boolean[] {
  return mobFov(ctx, mob, 12);
}

/* Tengu's abilities on the floor's clock */

/** Tengu.BombAbility.act: «3...», «2...», «1...», then the blast. */
export function bombTurn(ctx: Ctx, bomb: Extract<Timed, { kind: 'bomb' }>): void {
  if (bomb.timer > 0) {
    show(ctx, 'bombTick', { pos: bomb.pos, value: bomb.timer });
    bomb.timer--;
    bomb.time += 1;
    return;
  }
  removeTimed(ctx, bomb);
  const dist = distanceMap(bomb.pos, (c) => !hasFlag(ctx.level.map[c]!, F.SOLID), 2);
  const cells: number[] = [];
  for (let c = 0; c < LENGTH; c++) if (dist[c]! < Infinity) cells.push(c);
  show(ctx, 'blast', { pos: bomb.pos, cells });
  const depth = 10;
  for (const c of cells) {
    const ch = charAt(ctx.world, ctx.depth, c);
    if (!ch || (!isHero(ch) && ch.kind === 'tengu') || !isAlive(ch)) continue;
    if (isHero(ch)) bossScore(ctx.world, BOSS_SLOT.tengu, -100);
    const damage = ctx.rng.normalIntRange(5 + depth, 10 + depth * 2) - drRollOf(ctx, ch);
    if (damage > 0) {
      ctx.effects.push({ type: 'hurt', depth: ctx.depth, who: ch.id, damage });
      hurt(ctx, ch, damage, 'bomb');
    }
  }
}

/** Tengu.FireAbility.act: the wave rolls on a step, in its direction and the two beside it, lighting the fire blob. */
export function fireTurn(ctx: Ctx, fire: Extract<Timed, { kind: 'fire' }>): void {
  const owner = ctx.floor.mobs.find((m) => m.id === fire.owner);
  const boss = bossFloor(ctx.floor);
  const to = new Set<number>();
  const spread = (c: number): void => {
    for (const d of [left(fire.direction), fire.direction, right(fire.direction)]) {
      const n = c + CIRCLE8[d]!;
      if (!hasFlag(ctx.level.map[n]!, F.SOLID)) to.add(n);
    }
  };
  if (fire.cells === null) {
    fire.cells = [owner?.pos ?? fire.origin];
    spread(fire.cells[0]!);
  } else {
    for (const c of fire.cells) if ((boss.fire ?? []).some(([cell, v]) => cell === c && v > 0)) spread(c);
  }
  for (const c of fire.cells) to.delete(c);
  if (to.size === 0) {
    removeTimed(ctx, fire);
    return;
  }
  fire.cells = [...to];
  for (const c of fire.cells) seedBlob(ctx, 'fire', c, 2);
  show(ctx, 'fire', { cells: fire.cells });
  fire.time += 1;
}

const left = (d: number): number => (d === 0 ? 7 : d - 1);
const right = (d: number): number => (d === 7 ? 0 : d + 1);

/** Tengu.ShockerAbility.act: it arcs across its diagonals and its sides by turns, charging the cells around it. */
export function shockerTurn(ctx: Ctx, shocker: Extract<Timed, { kind: 'shocker' }>): void {
  if (shocker.ordinals === null) {
    shocker.ordinals = ctx.rng.int(2) === 1;
  } else if (shocker.ordinals) {
    show(ctx, 'shock', { pos: shocker.pos, cells: [shocker.pos - 1 - WIDTH, shocker.pos + 1 + WIDTH, shocker.pos - 1 + WIDTH, shocker.pos + 1 - WIDTH] });
    shocker.ordinals = false;
  } else {
    show(ctx, 'shock', { pos: shocker.pos, cells: [shocker.pos - WIDTH, shocker.pos + WIDTH, shocker.pos - 1, shocker.pos + 1] });
    shocker.ordinals = true;
  }
  seedBlob(ctx, 'shock', shocker.pos, 1);
  for (let i = shocker.ordinals ? 0 : 1; i < CIRCLE8.length; i += 2) {
    const c = shocker.pos + CIRCLE8[i]!;
    if (!hasFlag(ctx.level.map[c]!, F.SOLID)) seedBlob(ctx, 'shock', c, 2);
  }
  shocker.time += 1;
}

/** Blob.seed for Tengu's fire and shock blobs; their turn comes after the buffs'. */
export function seedBlob(ctx: Ctx, kind: 'fire' | 'shock', cell: number, amount: number): void {
  const boss = bossFloor(ctx.floor);
  const blob = (boss[kind] ??= []);
  const entry = blob.find(([c]) => c === cell);
  if (entry) entry[1] += amount;
  else blob.push([cell, amount]);
  if (!boss.timed.some((t) => t.kind === 'blobs')) schedule(ctx, { kind: 'blobs', owner: '', time: ctx.floor.now });
}

/**
 * FireBlob.evolve and ShockerBlob.evolve, a turn of each: every cell's charge runs down a step (fire
 * at most one), and where it runs out the cell burns (setting whoever stands there alight, but never
 * Tengu; heaps burn, grass burns away) or shocks (2 + depth damage, never to Tengu).
 */
export function tenguBlobsTurn(ctx: Ctx): void {
  const boss = bossFloor(ctx.floor);
  const fire = boss.fire ?? [];
  const next: Array<[number, number]> = [];
  const burnt: number[] = [];
  for (const [cell, cur] of fire) {
    const off = Math.min(1, Math.max(0, cur - 1));
    if (off > 0) next.push([cell, off]);
    if (cur > 0 && off === 0) burnt.push(cell);
  }
  boss.fire = next;
  for (const cell of burnt) {
    const ch = charAt(ctx.world, ctx.depth, cell);
    if (ch && !(!isHero(ch) && ch.kind === 'tengu')) ch.burning = Math.max(ch.burning ?? 0, 8);
    if (ch && isHero(ch)) bossScore(ctx.world, BOSS_SLOT.tengu, -100);
    burnCell(ctx, cell);
  }
  const shock = boss.shock ?? [];
  const nextShock: Array<[number, number]> = [];
  const shocked: number[] = [];
  for (const [cell, cur] of shock) {
    const off = cur > 0 ? cur - 1 : 0;
    if (off > 0) nextShock.push([cell, off]);
    if (cur > 0 && off === 0) shocked.push(cell);
  }
  boss.shock = nextShock;
  for (const cell of shocked) {
    const ch = charAt(ctx.world, ctx.depth, cell);
    if (!ch || (!isHero(ch) && ch.kind === 'tengu') || !isAlive(ch)) continue;
    const damage = 2 + 10;
    if (isHero(ch)) bossScore(ctx.world, BOSS_SLOT.tengu, -100);
    ctx.effects.push({ type: 'hurt', depth: ctx.depth, who: ch.id, damage });
    hurt(ctx, ch, damage, 'lightning');
  }
  if (boss.fire.length === 0) delete boss.fire;
  if (boss.shock.length === 0) delete boss.shock;
}

/** The timed turns of Tengu's level: a jump after a blow, the arena's end. */
export function tenguTimed(ctx: Ctx, entry: Extract<Timed, { kind: 'jump' | 'progress' }>): void {
  removeTimed(ctx, entry);
  const tengu = ctx.floor.mobs.find((m) => m.id === entry.owner);
  if (!tengu) return;
  if (entry.kind === 'jump') jump(ctx, tengu);
  else progress(ctx);
}

/** The items Tengu keeps aside through the fight's changes, for a resurrection's preserved belongings. */
export function storedItems(ctx: Ctx): Item[] {
  return bossFloor(ctx.floor).stored ?? [];
}
