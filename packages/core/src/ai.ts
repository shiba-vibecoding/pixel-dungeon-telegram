import {
  baseKind, beckon, createMob, GOO_PUMPED, type Hero, heroStealth, isAlive, isShopkeeper, type Mob, type MobState, MOBS, mobStats, rollMob,
} from './actors';
import { attack, defenseOf, hurt } from './combat';
import { dissolveGuardian, lotusAct, wardCanAttack, wardZap } from './allies';
import { hasProp } from './props';
import { castShadow, LIGHT_DISTANCE, terrainBlocksSight, viewDistance } from './fov';
import { canEnter, type Char, charAt, type Ctx, enterCell, type Floor, heroesOn, heroSight, heroView, isHero, isPassable, isWater, leaveCell } from './floor';
import { isChallenged, SWARM_INTELLIGENCE } from './challenges';
import { altarCallsMob } from './altar';
import { type Item, itemDef, ItemGenerator, randomEnchantment } from './items';
import { identify } from './ident';
import { isBossDepth, LAST_SHOP_DEPTH } from './level/builder';
import { KING_PEDESTALS } from './level/city-boss';
import type { Level, RoomInfo } from './level/generate';
import { adjacent, cellX, cellY, distance, LENGTH, NEIGHBOURS8, WIDTH } from './level/geometry';
import { RoomType } from './level/room';
import { F, hasFlag, T } from './level/terrain';
import { burst, mobConditions, mobPress } from './traps';
import { seedGas, seedWeb } from './gas';
import { staggerTarget } from './plants';
import type { Rng } from './rng';
import type { World } from './world';
import { S } from './spd-sprites';
import { mobCount, partySize, respawnTime, scaleMob } from './party';
import { mobTimeScale } from './throwing';
import { ghostAct, ghostSeesBoss, isInvisible } from './artifacts';

/*
 * Monster behaviour, ported from Mob: sleeping monsters may notice a hero in
 * sight, wandering ones roam between rooms, hunting ones chase their enemy and
 * attack when adjacent. With several heroes, a monster keeps after the one it
 * chose while it can see them, otherwise turns to the nearest hero in sight.
 */

const TICK = 1;
const TIME_TO_WAKE_UP = 1;
export const TIME_TO_RESPAWN = 50;

/**
 * How far a monster sees: the level's distance, but the demons of the halls see as if by torchlight.
 * Never the DARKNESS challenge's: in the original only the hero's sight follows the level's.
 */

export function mobSight(mob: Mob, depth: number): number {
  const demon = mob.kind === 'succubus' || mob.kind === 'eye' || baseKind(mob.kind) === 'scorpio';
  return demon ? Math.max(viewDistance(depth), LIGHT_DISTANCE) : viewDistance(depth);
}

export function spend(mob: Mob, time: number): void {
  // Char.spend: slowed, everything takes twice as long; chilled, a little longer the colder; with adrenaline, half as long.
  mob.time += time / mobTimeScale(mob);
}

/** Char.stealth: a hero's; a monster has none. */
const stealthOf = (char: Char): number => (isHero(char) ? heroStealth(char) : 0);

/**
 * Mob.chooseEnemy. A monster keeps after its foe while it sees it (unless it only wanders); otherwise
 * it goes for the nearest in sight of those it is against, a hero before an ally as near. An ally
 * (Char.Alignment.ALLY) is against the monsters (not the harmless; the earth guardian, an intelligent
 * ally, only those already up and fighting); a monster against the heroes and their allies.
 */
function chooseEnemy(ctx: Ctx, mob: Mob, fov: boolean[]): Char | undefined {
  if (mob.ally) return chooseFoe(ctx, mob, fov);
  // Invisible heroes cannot be picked out.
  const heroes = heroesOn(ctx.world, ctx.depth).filter((hero) => !isInvisible(hero));
  const allies = ctx.floor.mobs.filter((other) => other.ally && other !== mob && isAlive(other));
  const current: Char | undefined = heroes.find((hero) => hero.id === mob.enemy) ?? allies.find((ally) => ally.id === mob.enemy);
  if (current && fov[current.pos] && (mob.state !== 'wandering' || isHero(current))) return current;

  let chosen: Char | undefined;
  for (const hero of heroes) {
    if (fov[hero.pos] && (!chosen || distance(mob.pos, hero.pos) < distance(mob.pos, chosen.pos))) {
      chosen = hero;
    }
  }
  for (const ally of allies) {
    if (fov[ally.pos] && (!chosen || distance(mob.pos, ally.pos) < distance(mob.pos, chosen.pos))) chosen = ally;
  }
  if (chosen && !isHero(chosen)) {
    mob.enemy = chosen.id;
    return chosen;
  }
  chosen ??= current && isHero(current) ? current : undefined;
  if (!chosen) {
    for (const hero of heroes) {
      if (!chosen || distance(mob.pos, hero.pos) < distance(mob.pos, chosen.pos)) chosen = hero;
    }
  }
  mob.enemy = chosen?.id ?? null;
  return chosen;
}

/** Mob.chooseEnemy for an ally: the nearest monster in sight it can fight, the one it fights if it still sees it. */
function chooseFoe(ctx: Ctx, mob: Mob, fov: boolean[]): Mob | undefined {
  const intelligent = mob.kind === 'guardian';
  const hostile = (other: Mob): boolean =>
    other !== mob && !other.ally && isAlive(other) && other.state !== 'passive' && other.kind !== 'lotus' &&
    (!intelligent || (other.state !== 'sleeping' && other.state !== 'wandering'));
  const current = ctx.floor.mobs.find((other) => other.id === (mob.foe ?? mob.enemy) && hostile(other));
  if (current && fov[current.pos] && mob.state !== 'wandering') return current;
  let chosen: Mob | undefined;
  for (const other of ctx.floor.mobs) {
    if (!hostile(other) || !fov[other.pos]) continue;
    // Those it can strike come first, then the nearest.
    if (!chosen) chosen = other;
    else if (canAttack(ctx, mob, chosen) && !canAttack(ctx, mob, other)) continue;
    else if ((canAttack(ctx, mob, other) && !canAttack(ctx, mob, chosen)) || distance(mob.pos, other.pos) < distance(mob.pos, chosen.pos)) chosen = other;
  }
  mob.enemy = chosen?.id ?? null;
  delete mob.foe;
  return chosen;
}

export function mobAct(ctx: Ctx, mob: Mob): void {
  if (mob.kind === 'mirror') {
    imageAct(ctx, mob);
    return;
  }
  if (mob.kind === 'bee') {
    beeAct(ctx, mob);
    return;
  }
  // The rose's ghost: an ally, with its own ways (DirectableAlly).
  if (mob.kind === 'ghostHero') {
    if (!mobConditions(ctx, mob)) ghostAct(ctx, mob);
    else spend(mob, TICK);
    return;
  }
  // WandOfRegrowth.Lotus: it only withers.
  if (mob.kind === 'lotus') {
    lotusAct(ctx, mob);
    return;
  }
  // A magic sheep just stands there, until it fades away.
  if (mob.kind === 'sheep') {
    mob.lifespan = (mob.lifespan ?? 0) - TICK;
    if (mob.lifespan <= 0) {
      ctx.floor.mobs.splice(ctx.floor.mobs.indexOf(mob), 1);
      leaveCell(ctx.world, ctx.level, ctx.depth, mob.pos);
      ctx.effects.push({ type: 'faded', depth: ctx.depth, mob: mob.id, pos: mob.pos });
      return;
    }
    spend(mob, TICK);
    return;
  }
  // The shopkeeper minds the shop; the sad ghost drifts about the level at
  // half speed, never after anyone.
  // ImpShopkeeper.act: the imp greets the first hero to see him.
  if (mob.kind === 'impShopkeeper' && !mob.greeted && heroesOn(ctx.world, ctx.depth).some((hero) => heroView(ctx.world, hero)[mob.pos])) {
    mob.greeted = true;
    ctx.effects.push({ type: 'greeting', depth: ctx.depth, mob: mob.id });
  }
  if (mob.state === 'passive' && (isShopkeeper(mob) || mob.kind === 'wandmaker' || mob.kind === 'imp' || mob.kind === 'blacksmith' || mob.kind === 'ratKing')) {
    spend(mob, TICK);
    return;
  }
  if (mob.state === 'passive') {
    const fov = castShadow(mob.pos, terrainBlocksSight(ctx.level.map), mobSight(mob, ctx.depth));
    if (mob.target !== -1 && mob.target !== mob.pos && getCloser(ctx, mob, mob.target, fov)) {
      spend(mob, 1 / MOBS[mob.kind].speed);
    } else {
      mob.target = randomDestination(ctx.rng, ctx.level);
      spend(mob, TICK);
    }
    return;
  }
  // SacrificialFire.evolve: drawn to the altar's fire, and marked while in it.
  altarCallsMob(ctx, mob);
  // Piranha.act: out of the water, a piranha dies.
  if (mob.kind === 'piranha' && !isWater(ctx.level.map[mob.pos]!)) {
    hurt(ctx, mob, mob.hp, 'dry');
    return;
  }
  // Poisoned or paralysed by a trap's gas.
  if (mobConditions(ctx, mob)) {
    spend(mob, TICK);
    return;
  }

  // Dizzy, it staggers about instead of doing anything useful.
  if ((mob.dizzy ?? 0) > 0) {
    mob.dizzy!--;
    // Char.move: a stagger may take it onto a trap, or over a chasm.
    const to = staggerTarget(ctx, mob.pos);
    if (canStand(ctx, mob, to, true) && !charAt(ctx.world, ctx.depth, to)) moveMob(ctx, mob, to);
    spend(mob, TICK);
    return;
  }
  // Yog-Dzewa does not move or strike: its fists and larvae fight for it.
  if (mob.kind === 'yog') {
    spend(mob, TICK);
    return;
  }
  if ((mob.charmed ?? 0) > 0 && --mob.charmed! <= 0) delete mob.charmedBy;
  if ((mob.amok ?? 0) > 0) {
    mob.amok!--;
    runAmok(ctx, mob);
    return;
  }
  // Terror: it runs from whoever frightened it, and does nothing else.
  if ((mob.terror ?? 0) > 0) {
    mob.terror!--;
    const from = heroesOn(ctx.world, ctx.depth).find((hero) => hero.id === mob.terrorOf);
    if (from && getFurther(ctx, mob, from.pos) === 'moved') spend(mob, 1 / MOBS[mob.kind].speed);
    else spend(mob, TICK);
    return;
  }
  // CursePersonification.act: the curse mends itself, a point a turn.
  if (mob.kind === 'curse' && mob.hp < mob.ht) mob.hp++;
  // Goo mends itself in the murky water of its lair, and the rotting fist faster.
  if (mob.kind === 'goo' && isWater(ctx.level.map[mob.pos]!) && mob.hp < mob.ht) mob.hp++;
  if (mob.kind === 'rottingFist' && isWater(ctx.level.map[mob.pos]!)) mob.hp = Math.min(mob.ht, mob.hp + 4);
  // BurningFist.act: everything around the burning fist catches fire.
  if (mob.kind === 'burningFist') burst(ctx, mob.pos, 'fire', 1, true);
  if (mob.kind === 'dm300') ventGas(ctx, mob);

  // Blinded (a rogue's smoke bomb), it sees no one; a ward sees four cells, and one more a tier.
  const sight = mob.kind === 'ward' ? Math.min(3 + (mob.ward?.tier ?? 1), mobSight(mob, ctx.depth)) : mobSight(mob, ctx.depth);
  const fov = (mob.blind ?? 0) > 0
    ? new Array<boolean>(LENGTH).fill(false)
    : castShadow(mob.pos, terrainBlocksSight(ctx.level.map), sight);
  // Mob.aggro: bitten by a golden bee, it turns on the bee while the bee lives and is in sight.
  if (mob.beeFoe && beeFight(ctx, mob, fov)) return;
  const justAlerted = mob.alerted;
  mob.alerted = false;
  const enemy = chooseEnemy(ctx, mob, fov);
  const enemyInFov = enemy !== undefined && fov[enemy.pos]!;

  switch (mob.state) {
    case 'sleeping':
      // An animated statue stands still until someone strikes it.
      if (mob.kind === 'statue') {
        spend(mob, TICK);
        return;
      }
      if (enemyInFov && ctx.rng.int(distance(mob.pos, enemy.pos) + stealthOf(enemy)) === 0) {
        notice(ctx, mob, enemy, 'hunting');
        // Swarm intelligence: waking, it calls every other monster on the level to where it saw the hero.
        if (isChallenged(ctx.world, SWARM_INTELLIGENCE)) {
          for (const other of ctx.floor.mobs) if (other !== mob) beckon(other, mob.target);
        }
        spend(mob, TIME_TO_WAKE_UP);
      } else {
        mob.enemySeen = false;
        spend(mob, TICK);
      }
      return;

    case 'wandering':
      if (enemyInFov && (justAlerted || ctx.rng.int(Math.trunc(distance(mob.pos, enemy.pos) / 2) + stealthOf(enemy)) === 0)) {
        // Spotting someone costs no time: it starts hunting on this very turn.
        notice(ctx, mob, enemy, 'hunting');
        return;
      }
      // EarthGuardian.Wandering: with no foe in sight, it crumbles back into the hero's armour.
      if (mob.kind === 'guardian' && !enemyInFov) {
        dissolveGuardian(ctx, mob);
        return;
      }
      mob.enemySeen = false;
      if (mob.target !== -1 && getCloser(ctx, mob, mob.target, fov)) {
        spend(mob, 1 / MOBS[mob.kind].speed);
      } else {
        mob.target = randomDestination(ctx.rng, ctx.level);
        spend(mob, TICK);
      }
      return;

    case 'hunting':
      mob.enemySeen = enemyInFov;
      // Charmed, it cannot bring itself to strike the one who charmed it.
      if (enemyInFov && (mob.charmed ?? 0) > 0 && mob.charmedBy === enemy.id) {
        spend(mob, TICK);
        return;
      }
      if (enemyInFov && canAttack(ctx, mob, enemy)) {
        doAttack(ctx, mob, enemy);
        return;
      }
      if (enemyInFov) mob.target = enemy.pos;
      if (mob.target !== -1 && getCloser(ctx, mob, mob.target, fov)) {
        spend(mob, 1 / MOBS[mob.kind].speed);
      } else {
        // Lost the trail.
        spend(mob, TICK);
        mob.state = 'wandering';
        mob.target = randomDestination(ctx.rng, ctx.level);
      }
      return;

    case 'fleeing': {
      // Mob.Fleeing: away from the enemy, or from where it was last seen.
      mob.enemySeen = enemyInFov;
      if (enemyInFov) mob.target = enemy.pos;
      const fled = mob.target === -1 ? 'cornered' : getFurther(ctx, mob, mob.target);
      if (fled === 'moved') {
        spend(mob, 1 / MOBS[mob.kind].speed);
      } else {
        spend(mob, TICK);
        if (fled === 'cornered') {
          // Fleeing.nowhereToRun: cornered, it turns on its pursuer.
          mob.state = 'hunting';
          ctx.effects.push({ type: 'cornered', depth: ctx.depth, mob: mob.id, kind: mob.kind });
        }
      }
      // Spinner.act: a spinner comes back once its venom has worn off.
      if (mob.kind === 'spinner' && mob.state === 'fleeing' && enemyInFov && (enemy.poison ?? 0) <= 0) mob.state = 'hunting';
      return;
    }
  }
}

/**
 * MirrorImage.act: after the nearest monster in sight, with its hero's skill
 * and strength; having struck, it is gone. With nothing to fight, it keeps
 * close to its hero.
 */
function imageAct(ctx: Ctx, mob: Mob): void {
  const image = mob.image!;
  const fov = castShadow(mob.pos, terrainBlocksSight(ctx.level.map), viewDistance(ctx.depth));
  let foe: Mob | undefined;
  for (const other of ctx.floor.mobs) {
    if (other === mob || other.state === 'passive' || other.ally || !fov[other.pos] || !isAlive(other)) continue;
    if (!foe || distance(mob.pos, other.pos) < distance(mob.pos, foe.pos)) foe = other;
  }
  if (foe && adjacent(mob.pos, foe.pos)) {
    attack(ctx, mob, foe, { attack: image.attack, damage: [Math.trunc(image.damage / 2), image.damage] });
    ctx.floor.mobs.splice(ctx.floor.mobs.indexOf(mob), 1);
    leaveCell(ctx.world, ctx.level, ctx.depth, mob.pos);
    ctx.effects.push({ type: 'faded', depth: ctx.depth, mob: mob.id, pos: mob.pos });
    return;
  }
  const owner = heroesOn(ctx.world, ctx.depth).find((hero) => hero.id === image.owner);
  const goal = foe?.pos ?? (owner && distance(owner.pos, mob.pos) > 2 ? owner.pos : -1);
  if (goal !== -1 && getCloser(ctx, mob, goal, fov)) spend(mob, 1 / MOBS[mob.kind].speed);
  else spend(mob, TICK);
}

/** A monster after a golden bee: at it if next to it, towards it if not; false once the bee is gone or out of sight. */
function beeFight(ctx: Ctx, mob: Mob, fov: boolean[]): boolean {
  const bee = ctx.floor.mobs.find((other) => other.id === mob.beeFoe && isAlive(other));
  if (!bee || !fov[bee.pos] || mob.state === 'fleeing') {
    delete mob.beeFoe;
    return false;
  }
  mob.state = 'hunting';
  if (adjacent(mob.pos, bee.pos)) {
    attack(ctx, mob, bee);
    spend(mob, mobStats(mob).attackDelay ?? TICK);
    return true;
  }
  if (!getCloser(ctx, mob, bee.pos, fov)) return false;
  spend(mob, 1 / MOBS[mob.kind].speed);
  return true;
}

/** Bee.viewDistance. */
const BEE_SIGHT = 4;

/**
 * Bee.act: a golden bee lives a turn less with every turn. It sticks to the
 * monster it went for, or picks one in sight; with none, it keeps by the
 * nearest hero. A monster it bites turns on it (Mob.aggro).
 */
function beeAct(ctx: Ctx, mob: Mob): void {
  if (--mob.hp <= 0) {
    ctx.floor.mobs.splice(ctx.floor.mobs.indexOf(mob), 1);
    leaveCell(ctx.world, ctx.level, ctx.depth, mob.pos);
    ctx.effects.push({ type: 'faded', depth: ctx.depth, mob: mob.id, pos: mob.pos });
    return;
  }
  const fov = castShadow(mob.pos, terrainBlocksSight(ctx.level.map), BEE_SIGHT);
  const hostile = (other: Mob): boolean => other !== mob && other.state !== 'passive' && !other.ally && isAlive(other);
  let foe = ctx.floor.mobs.find((other) => other.id === mob.enemy && hostile(other));
  if (!foe) {
    foe = ctx.rng.element(ctx.floor.mobs.filter((other) => hostile(other) && fov[other.pos]));
    mob.enemy = foe?.id ?? null;
  }
  if (foe && adjacent(mob.pos, foe.pos)) {
    attack(ctx, mob, foe);
    // Bee.attackProc: the monster turns on the bee.
    if (isAlive(foe)) foe.beeFoe = mob.id;
    spend(mob, TICK);
    return;
  }
  let goal = foe?.pos ?? -1;
  if (goal === -1) {
    let nearest: Hero | undefined;
    for (const hero of heroesOn(ctx.world, ctx.depth)) {
      if (!nearest || distance(mob.pos, hero.pos) < distance(mob.pos, nearest.pos)) nearest = hero;
    }
    if (nearest && !adjacent(nearest.pos, mob.pos)) goal = nearest.pos;
  }
  if (goal !== -1 && getCloser(ctx, mob, goal, fov)) spend(mob, 1 / MOBS[mob.kind].speed);
  else spend(mob, TICK);
}

/** Amok: it falls upon whoever is nearest in sight, monster or hero. */
function runAmok(ctx: Ctx, mob: Mob): void {
  const fov = castShadow(mob.pos, terrainBlocksSight(ctx.level.map), mobSight(mob, ctx.depth));
  const others: Array<Hero | Mob> = [
    ...heroesOn(ctx.world, ctx.depth),
    ...ctx.floor.mobs.filter((other) => other !== mob && other.state !== 'passive'),
  ].filter((other) => fov[other.pos] && isAlive(other));
  let nearest: Hero | Mob | undefined;
  for (const other of others) {
    if (!nearest || distance(mob.pos, other.pos) < distance(mob.pos, nearest.pos)) nearest = other;
  }
  if (nearest && adjacent(mob.pos, nearest.pos)) {
    attack(ctx, mob, nearest);
    spend(mob, mobStats(mob).attackDelay ?? TICK);
  } else if (nearest && getCloser(ctx, mob, nearest.pos, fov)) {
    spend(mob, 1 / MOBS[mob.kind].speed);
  } else {
    spend(mob, TICK);
  }
}

/**
 * PathFinder.getStepBack, simplified: the neighbouring cell furthest from
 * the threat, if it gains any distance; 'safe' when the threat cannot reach
 * the mob at all. Dungeon.flee: only a flier takes a way over traps and chasms.
 */
function getFurther(ctx: Ctx, mob: Mob, threat: number): 'moved' | 'safe' | 'cornered' {
  const { world, depth, level } = ctx;
  const flying = MOBS[mob.kind].flying === true;
  const dist = new Int32Array(LENGTH).fill(-1);
  dist[threat] = 0;
  const queue = [threat];
  for (let head = 0; head < queue.length; head++) {
    const c = queue[head]!;
    for (const n of NEIGHBOURS8) {
      const next = c + n;
      if (next < 0 || next >= LENGTH || dist[next]! >= 0 || !adjacent(c, next)) continue;
      if (!isPassable(level, next) && !(flying && hasFlag(level.map[next]!, F.AVOID))) continue;
      dist[next] = dist[c]! + 1;
      queue.push(next);
    }
  }
  if (dist[mob.pos]! < 0) return 'safe';
  let best = -1;
  let bestDist = dist[mob.pos]!;
  for (const n of STEP_ORDER) {
    const step = mob.pos + n;
    if (step < 0 || step >= LENGTH || !adjacent(mob.pos, step) || charAt(world, depth, step) || !canStand(ctx, mob, step, flying)) continue;
    if (dist[step]! > bestDist) {
      best = step;
      bestDist = dist[step]!;
    }
  }
  if (best === -1) return 'cornered';
  moveMob(ctx, mob, best);
  return 'moved';
}

/** DM300.act: the machine leaks toxic gas all around it, a cloud that spreads and lingers (it breathes it unharmed). */
function ventGas(ctx: Ctx, mob: Mob): void {
  seedGas(ctx, mob.pos, 'toxic', 30);
}

/**
 * DM300.move: stepping on a spent trap, it repairs itself; every step shakes
 * rocks loose next to it, stunning whoever they fall on.
 */
function dm300Steps(ctx: Ctx, mob: Mob, to: number): void {
  const { level, rng, world, depth } = ctx;
  if (level.map[to] === T.INACTIVE_TRAP && mob.hp < mob.ht) {
    mob.hp += rng.intBetween(1, mob.ht - mob.hp);
    ctx.effects.push({ type: 'repaired', depth, mob: mob.id });
  }
  const cell = to + NEIGHBOURS8[rng.int(NEIGHBOURS8.length)]!;
  ctx.effects.push({ type: 'avalanche', depth, cells: [cell] });
  if (level.map[cell] === T.EMPTY) level.map[cell] = T.EMPTY_DECO;
  const struck = charAt(world, depth, cell);
  if (struck && struck !== mob) struck.paralysed = Math.max(struck.paralysed ?? 0, 2);
}

function notice(ctx: Ctx, mob: Mob, enemy: Char, state: MobState): void {
  mob.enemySeen = true;
  mob.state = state;
  mob.target = enemy.pos;
  ctx.effects.push({ type: 'noticed', depth: ctx.depth, mob: mob.id });
  if (isHero(enemy) && (mob.kind === 'goo' || mob.kind === 'tengu' || mob.kind === 'dm300' || mob.kind === 'king')) {
    ctx.effects.push({ type: 'yell', depth: ctx.depth, mob: mob.id, kind: mob.kind, line: 'notice', hero: enemy.id });
    ghostSeesBoss(ctx);
  }
}

function canAttack(ctx: Ctx, mob: Mob, enemy: Char): boolean {
  // Ward.canAttack: a clear bolt; the lotus never.
  if (mob.kind === 'ward') return wardCanAttack(ctx, mob, enemy);
  if (mob.kind === 'lotus') return false;
  // Shamans cast lightning, warlocks shadow bolts, the burning fist fire, and Tengu throws shuriken
  // at anyone in a clear line.
  if (mob.kind === 'shaman' || mob.kind === 'warlock' || mob.kind === 'tengu' || mob.kind === 'burningFist') {
    return ballistica(ctx, mob.pos, enemy.pos).at(-1) === enemy.pos;
  }
  // The evil eye's gaze goes through anyone in the way; the scorpio only stings from afar.
  if (mob.kind === 'eye') return ballistica(ctx, mob.pos, enemy.pos, false).includes(enemy.pos);
  if (baseKind(mob.kind) === 'scorpio') return !adjacent(mob.pos, enemy.pos) && ballistica(ctx, mob.pos, enemy.pos).at(-1) === enemy.pos;
  // The King goes to a pedestal to raise his undead while his court is short.
  if (mob.kind === 'king' && kingCanSummon(ctx, mob)) return mob.pos === kingPedestal(mob);
  return mob.pumped ? distance(mob.pos, enemy.pos) <= 2 : adjacent(mob.pos, enemy.pos);
}

/** Shaman.doAttack from afar: a bolt of lightning, worse for someone standing in water. */
function zapLightning(ctx: Ctx, mob: Mob, enemy: Char): void {
  spend(mob, TIME_TO_ZAP);
  ctx.effects.push({ type: 'zapped', depth: ctx.depth, from: mob.pos, to: enemy.pos, bolt: 'lightning' });
  // A magic attack: accuracy counts double.
  const hit = ctx.rng.floatMax(MOBS.shaman.attack) * 2 >= ctx.rng.floatMax(defenseOf(enemy));
  let damage = 0;
  if (hit) {
    damage = ctx.rng.intBetween(2, 12);
    if (isWater(ctx.level.map[enemy.pos]!)) damage = Math.trunc(damage * 1.5);
  }
  ctx.effects.push({ type: 'attack', depth: ctx.depth, attacker: mob.id, target: enemy.id, hit, damage });
  if (hit) hurt(ctx, enemy, damage, mob);
}

const TIME_TO_ZAP = 2;
const SUCCUBUS_BLINK_DELAY = 5;

/** Eye.attack: the deathgaze strikes everyone along it, the eye's friends included. */
function deathGaze(ctx: Ctx, eye: Mob, enemy: Char): void {
  spend(eye, MOBS.eye.attackDelay!);
  const trace = ballistica(ctx, eye.pos, enemy.pos, false);
  ctx.effects.push({ type: 'zapped', depth: ctx.depth, from: eye.pos, to: trace.at(-1)!, bolt: 'beam' });
  for (const cell of trace.slice(1)) {
    const victim = charAt(ctx.world, ctx.depth, cell);
    if (!victim || !isAlive(victim) || victim === eye) continue;
    const defense = 'heroClass' in victim ? defenseOf(victim) : MOBS[victim.kind].defense;
    const hit = ctx.rng.floatMax(MOBS.eye.attack) * 2 >= ctx.rng.floatMax(defense);
    const damage = hit ? ctx.rng.normalIntRange(...MOBS.eye.damage) : 0;
    ctx.effects.push({ type: 'attack', depth: ctx.depth, attacker: eye.id, target: victim.id, hit, damage });
    if (hit) hurt(ctx, victim, damage, eye);
  }
}

/** Warlock.zap: a shadow bolt that hurts, and half the time leaves the hero weakened. */
function shadowBolt(ctx: Ctx, mob: Mob, enemy: Char): void {
  spend(mob, TICK);
  ctx.effects.push({ type: 'zapped', depth: ctx.depth, from: mob.pos, to: enemy.pos, bolt: 'shadow' });
  const hit = ctx.rng.floatMax(MOBS.warlock.attack) * 2 >= ctx.rng.floatMax(defenseOf(enemy));
  let damage = 0;
  if (hit) {
    if (ctx.rng.int(2) === 0 && isHero(enemy)) {
      if (enemy.weakened <= 0) ctx.effects.push({ type: 'weakened', hero: enemy.id });
      enemy.weakened = Math.max(enemy.weakened, WEAKNESS_TURNS);
    }
    damage = ctx.rng.intBetween(12, 18);
  }
  ctx.effects.push({ type: 'attack', depth: ctx.depth, attacker: mob.id, target: enemy.id, hit, damage });
  if (hit) hurt(ctx, enemy, damage, mob);
}

/** Weakness.DURATION. */
const WEAKNESS_TURNS = 40;

const kingPedestal = (mob: Mob): number => KING_PEDESTALS[mob.rightPedestal ? 1 : 0];

/** King.canTryToSummon: his court is short, and his pedestal is free. */
function kingCanSummon(ctx: Ctx, mob: Mob): boolean {
  const army = ctx.floor.mobs.filter((m) => m.kind === 'undead').length;
  const maxArmy = 1 + Math.trunc((5 * (mob.ht - mob.hp)) / mob.ht);
  if (army >= maxArmy) return false;
  const there = charAt(ctx.world, ctx.depth, kingPedestal(mob));
  return !there || there === mob;
}

/** King.summon: undead dwarves rise around him, as many as his court is short. */
function summonUndead(ctx: Ctx, king: Mob): void {
  const { world, depth, level, floor } = ctx;
  king.rightPedestal = !king.rightPedestal;
  const maxArmy = 1 + Math.trunc((5 * (king.ht - king.hp)) / king.ht);
  let wanted = maxArmy - floor.mobs.filter((m) => m.kind === 'undead').length;
  const dist = new Int32Array(LENGTH).fill(-1);
  dist[king.pos] = 0;
  const queue = [king.pos];
  for (let head = 0; head < queue.length && wanted > 0; head++) {
    const c = queue[head]!;
    for (const n of NEIGHBOURS8) {
      const next = c + n;
      if (next < 0 || next >= LENGTH || dist[next]! >= 0 || !adjacent(c, next) || !isPassable(level, next)) continue;
      dist[next] = dist[c]! + 1;
      if (charAt(world, depth, next)) continue;
      queue.push(next);
      if (wanted > 0) {
        const undead = createMob(`#${++world.nextId}`, 'undead', next, 'hunting', floor.now + 1);
        Object.assign(undead, { enemy: king.enemy, target: king.target });
        floor.mobs.push(undead);
        enterCell(level, next);
        wanted--;
      }
    }
  }
  ctx.effects.push({ type: 'yell', depth, mob: king.id, kind: 'king', line: 'summon' });
}
/** Tengu jumps away after this many blows at close quarters. */
const TENGU_JUMP_DELAY = 5;
/** ItemSpriteSheet.SHURIKEN. */
const SHURIKEN_SPRITE = S.SHURIKEN;

/**
 * Tengu.jump: spent traps around flare up as poison traps, and Tengu lands
 * somewhere in sight, never right next to its enemy.
 */
function tenguJump(ctx: Ctx, mob: Mob): void {
  const { world, depth, level, rng } = ctx;
  mob.jumpIn = TENGU_JUMP_DELAY;
  const fov = castShadow(mob.pos, terrainBlocksSight(level.map), viewDistance(depth));
  const enemy = heroesOn(world, depth).find((hero) => hero.id === mob.enemy);
  const pick = (landing: boolean): number =>
    randomCell(rng, (c) =>
      fov[c]! && isPassable(level, c) &&
      (!landing || (!(enemy && adjacent(c, enemy.pos)) && !charAt(world, depth, c))));
  for (let i = 0; i < 4; i++) {
    const trap = pick(false);
    if (trap === -1) break;
    if (level.map[trap] === T.INACTIVE_TRAP) {
      level.map[trap] = T.POISON_TRAP;
      ctx.effects.push({ type: 'discovered', depth, cell: trap });
    }
  }
  const to = pick(true);
  if (to === -1) return;
  const from = mob.pos;
  moveMob(ctx, mob, to);
  ctx.effects.push({ type: 'jumped', depth, mob: mob.id, from, to });
}

function doAttack(ctx: Ctx, mob: Mob, enemy: Char): void {
  // Ward.doAttack: its bolt.
  if (mob.kind === 'ward') {
    wardZap(ctx, mob, enemy);
    return;
  }
  if (mob.kind === 'shaman' && !adjacent(mob.pos, enemy.pos)) {
    zapLightning(ctx, mob, enemy);
    return;
  }
  if (mob.kind === 'warlock' && !adjacent(mob.pos, enemy.pos)) {
    shadowBolt(ctx, mob, enemy);
    return;
  }
  if (mob.kind === 'eye') {
    deathGaze(ctx, mob, enemy);
    return;
  }
  if (mob.kind === 'burningFist' && !adjacent(mob.pos, enemy.pos)) {
    // BurningFist.attack from afar: a ball of fire, a magic attack.
    spend(mob, TICK);
    ctx.effects.push({ type: 'zapped', depth: ctx.depth, from: mob.pos, to: enemy.pos, bolt: 'fire' });
    const hit = ctx.rng.floatMax(MOBS.burningFist.attack) * 2 >= ctx.rng.floatMax(defenseOf(enemy));
    const damage = hit ? ctx.rng.normalIntRange(...MOBS.burningFist.damage) : 0;
    ctx.effects.push({ type: 'attack', depth: ctx.depth, attacker: mob.id, target: enemy.id, hit, damage });
    if (hit) hurt(ctx, enemy, damage, mob);
    return;
  }
  if (baseKind(mob.kind) === 'scorpio') {
    ctx.effects.push({ type: 'zapped', depth: ctx.depth, from: mob.pos, to: enemy.pos, bolt: 'poison' });
  }
  if (mob.kind === 'king') {
    if (kingCanSummon(ctx, mob) && mob.pos === kingPedestal(mob)) {
      summonUndead(ctx, mob);
      spend(mob, TICK);
      return;
    }
    // King.attack: a hero standing on his pedestal makes him use the other one.
    if (charAt(ctx.world, ctx.depth, kingPedestal(mob)) === enemy) mob.rightPedestal = !mob.rightPedestal;
  }
  if (mob.kind === 'tengu') {
    mob.jumpIn = (mob.jumpIn ?? TENGU_JUMP_DELAY) - 1;
    if (mob.jumpIn <= 0 && adjacent(mob.pos, enemy.pos)) {
      tenguJump(ctx, mob);
    } else {
      if (!adjacent(mob.pos, enemy.pos)) {
        ctx.effects.push({ type: 'missile', depth: ctx.depth, from: mob.pos, to: enemy.pos, sprite: SHURIKEN_SPRITE });
      }
      attack(ctx, mob, enemy);
    }
    spend(mob, TICK);
    return;
  }
  if (mob.kind !== 'goo') {
    attack(ctx, mob, enemy);
    spend(mob, mobStats(mob).attackDelay ?? TICK);
    return;
  }
  // Goo (Goo.doAttack): sometimes pumps itself up, then strikes hard, leaping
  // at an enemy two cells away.
  if (mob.pumped) {
    if (adjacent(mob.pos, enemy.pos)) {
      attack(ctx, mob, enemy, { attack: GOO_PUMPED.attack, damage: GOO_PUMPED.damage });
    } else {
      const trace = ballistica(ctx, mob.pos, enemy.pos);
      if (trace.at(-1) !== enemy.pos) {
        // No clear leap: it deflates and acts again at once.
        mob.pumped = false;
        return;
      }
      moveMob(ctx, mob, trace.at(-2)!);
      if (isAlive(mob)) attack(ctx, mob, enemy, { attack: GOO_PUMPED.jumpAttack, damage: GOO_PUMPED.damage });
    }
    mob.pumped = false;
    spend(mob, TICK);
  } else if (ctx.rng.int(3) > 0) {
    attack(ctx, mob, enemy);
    spend(mob, TICK);
  } else {
    mob.pumped = true;
    spend(mob, GOO_PUMPED.delay);
    ctx.effects.push({ type: 'pumped', depth: ctx.depth, mob: mob.id });
  }
}

/**
 * Ballistica.cast: the cells a straight line from `from` passes on its way to
 * `to`, ending at the first character or sight-blocking cell, or before a wall.
 * `lob`: tossed high, over heads and through tall grass, as a seed is (a port's
 * change: in the original a seed stopped at the first blade of grass or
 * companion in the way, never where the player meant to plant it).
 */
export function ballistica(ctx: Ctx, from: number, to: number, hitChars = true, lob = false): number[] {
  const { world, depth, level } = ctx;
  let dx = cellX(to) - cellX(from);
  let dy = cellY(to) - cellY(from);
  const stepX = dx > 0 ? 1 : -1;
  const stepY = dy > 0 ? 1 : -1;
  dx = Math.abs(dx);
  dy = Math.abs(dy);
  const [stepA, stepB, dA, dB] = dx > dy ? [stepX, stepY * WIDTH, dx, dy] : [stepY * WIDTH, stepX, dy, dx];

  const trace = [from];
  let cell = from;
  let err = Math.trunc(dA / 2);
  while (cell !== to) {
    cell += stepA;
    err += dB;
    if (err >= dA) {
      err -= dA;
      cell += stepB;
    }
    trace.push(cell);
    const terrain = level.map[cell]!;
    if (!hasFlag(terrain, F.PASSABLE) && !hasFlag(terrain, F.AVOID)) {
      trace.pop();
      return trace;
    }
    if (lob) {
      // A door or a statue in the way: it drops before it.
      if (hasFlag(terrain, F.SOLID)) {
        trace.pop();
        return trace;
      }
      continue;
    }
    if (hasFlag(terrain, F.LOS_BLOCKING) || (hitChars && charAt(world, depth, cell))) return trace;
  }
  return trace;
}

export function getCloser(ctx: Ctx, mob: Mob, target: number, fov: boolean[]): boolean {
  // Rooted, it cannot move a step; what is immovable never does (Ward.getCloser).
  if ((mob.rooted ?? 0) > 0 || hasProp(mob, 'immovable')) return false;
  if (mob.kind === 'goo') mob.pumped = false;
  // Scorpio.getCloser: a hunting scorpio keeps its distance, to sting from afar.
  if (baseKind(mob.kind) === 'scorpio' && mob.state === 'hunting') return mob.enemySeen && getFurther(ctx, mob, target) === 'moved';
  // Succubus.getCloser: she blinks up to her prey, now and then, at no cost in time.
  if (mob.kind === 'succubus' && fov[target] && distance(mob.pos, target) > 2 && (mob.jumpIn ?? 0) <= 0) {
    const trace = ballistica(ctx, mob.pos, target);
    let cell = trace.at(-1)!;
    if (charAt(ctx.world, ctx.depth, cell) && trace.length > 2) cell = trace[trace.length - 2]!;
    // Succubus.blink is WandOfBlink.appear, which presses nothing: in the original she could be
    // left standing on air over a chasm. Rather than that, she stops at the last firm cell along
    // the way; a trap she lands on stays as it is.
    for (let i = trace.indexOf(cell); i > 0 && !canEnter(ctx.level, cell); i--) cell = trace[i - 1]!;
    if (cell !== mob.pos && canEnter(ctx.level, cell) && !charAt(ctx.world, ctx.depth, cell)) {
      const from = mob.pos;
      moveMob(ctx, mob, cell, false);
      ctx.effects.push({ type: 'jumped', depth: ctx.depth, mob: mob.id, from, to: cell });
      mob.jumpIn = SUCCUBUS_BLINK_DELAY;
      mob.time -= 1 / MOBS[mob.kind].speed;
      return true;
    }
  }
  if (mob.kind === 'succubus') mob.jumpIn = (mob.jumpIn ?? 0) - 1;
  if (mob.kind === 'king' && kingCanSummon(ctx, mob)) target = kingPedestal(mob);
  // Tengu does not walk up to anyone it can see: it jumps.
  if (mob.kind === 'tengu' && fov[target]) {
    tenguJump(ctx, mob);
    return true;
  }
  const step = findStep(ctx, mob.pos, target, fov, mob);
  if (step === -1) return false;
  moveMob(ctx, mob, step);
  return true;
}

/**
 * Mob.move: a step to the next cell. A fleeing spinner leaves a web behind it (Spinner.move); then,
 * unless it flies, the monster presses the cell it comes to (Level.mobPress: traps, chasms, plants).
 * `press` false: it appears there by magic instead (WandOfBlink.appear), touching nothing.
 */
function moveMob(ctx: Ctx, mob: Mob, to: number, press = true): void {
  // Crippled, every step takes twice as long.
  if ((mob.crippled ?? 0) > 0) mob.time += 1 / MOBS[mob.kind].speed;
  const from = mob.pos;
  if (mob.kind === 'spinner' && mob.state === 'fleeing') seedWeb(ctx, from, ctx.rng.intBetween(5, 7));
  mob.pos = to;
  leaveCell(ctx.world, ctx.level, ctx.depth, from);
  enterCell(ctx.level, to);
  // Once Goo stirs, its lair floods behind the heroes: no way back up.
  if (mob.kind === 'goo' && ctx.level.map[ctx.level.entrance] === T.ENTRANCE) {
    ctx.level.map[ctx.level.entrance] = T.WATER_TILES;
  }
  if (press && !MOBS[mob.kind].flying) {
    mobPress(ctx, mob);
    if (!isAlive(mob)) return;
  }
  if (mob.kind === 'dm300') dm300Steps(ctx, mob, to);
}

/**
 * Dungeon.findPath: the next step, treating characters the mover can see as obstacles. Traps and
 * chasms the party knows of are walked around, unless the mover flies or is beside itself (Amok,
 * Rage); but a goal right next to it is stepped onto whatever it is.
 */
function findStep(ctx: Ctx, from: number, to: number, fov: boolean[], mob?: Mob): number {
  const { world, depth } = ctx;
  if (adjacent(from, to)) {
    return !charAt(world, depth, to) && canStand(ctx, mob, to, true) ? to : -1;
  }
  const heedless = mob !== undefined && (MOBS[mob.kind].flying === true || (mob.amok ?? 0) > 0 || (mob.rage ?? 0) > 0);
  return getStep(from, to, (cell) => canStand(ctx, mob, cell, heedless) && !(fov[cell] && charAt(world, depth, cell)));
}

/**
 * Where a monster may go: open ground (Level.passable), and with `avoid` also known traps and
 * chasms (Level.avoid); for a piranha only the water of its pool.
 */
function canStand(ctx: Ctx, mob: Mob | undefined, cell: number, avoid = false): boolean {
  if (mob?.kind === 'piranha') return isPassable(ctx.level, cell) && isWater(ctx.level.map[cell]!);
  return isPassable(ctx.level, cell) || (avoid && cell >= 0 && cell < LENGTH && hasFlag(ctx.level.map[cell]!, F.AVOID));
}

/** Neighbour order of PathFinder.getStep, which decides between equally short steps. */
const STEP_ORDER = [-1, +1, -WIDTH, +WIDTH, -WIDTH - 1, -WIDTH + 1, +WIDTH - 1, +WIDTH + 1];

/** PathFinder.getStep: the neighbour of `from` closest to `to`, or -1 if unreachable. */
export function getStep(from: number, to: number, passable: (cell: number) => boolean): number {
  if (from === to) return -1;
  const dist = new Int32Array(LENGTH).fill(LENGTH);
  dist[to] = 0;
  const queue = [to];
  let found = false;
  for (let head = 0; head < queue.length && !found; head++) {
    const cell = queue[head]!;
    const next = dist[cell]! + 1;
    for (const n of NEIGHBOURS8) {
      const neighbour = cell + n;
      if (neighbour < 0 || neighbour >= LENGTH || !adjacent(cell, neighbour) || dist[neighbour]! <= next) continue;
      if (neighbour === from) {
        dist[neighbour] = next;
        found = true;
        break;
      }
      if (passable(neighbour)) {
        dist[neighbour] = next;
        queue.push(neighbour);
      }
    }
  }
  if (!found) return -1;

  let best = -1;
  let bestDist = dist[from]!;
  for (const n of STEP_ORDER) {
    const step = from + n;
    if (step >= 0 && step < LENGTH && adjacent(from, step) && dist[step]! < bestDist) {
      best = step;
      bestDist = dist[step]!;
    }
  }
  return best;
}

/** A random cell inside a room, as Room.random(). */
function randomCellIn(rng: Rng, room: RoomInfo): number {
  return rng.intBetween(room.left + 1, room.right) + rng.intBetween(room.top + 1, room.bottom) * WIDTH;
}

/** RegularLevel.randomDestination: somewhere to wander to. */
function randomDestination(rng: Rng, level: Level): number {
  for (let attempt = 0; attempt < 100; attempt++) {
    const room = rng.element(level.rooms);
    if (!room) break;
    const cell = randomCellIn(rng, room);
    if (isPassable(level, cell)) return cell;
  }
  return randomCell(rng, (cell) => isPassable(level, cell));
}

/** Uniformly random cell satisfying `ok`, by reservoir sampling as in Level. */
function randomCell(rng: Rng, ok: (cell: number) => boolean): number {
  let result = -1;
  let candidates = 0;
  for (let cell = 0; cell < LENGTH; cell++) {
    if (ok(cell) && rng.int(++candidates) === 0) result = cell;
  }
  return result;
}

/**
 * RegularLevel.randomRespawnCell: a free cell in a standard room, out of sight.
 * None on the last shop's level (LastShopLevel.randomRespawnCell): nothing
 * teleports there, as under the original's "strong magic aura".
 */
export function randomRespawnCell(rng: Rng, world: World, level: Level, hidden: (cell: number) => boolean): number {
  if (level.depth === LAST_SHOP_DEPTH) return -1;
  const free = (cell: number): boolean =>
    cell >= 0 && cell < LENGTH && hidden(cell) && isPassable(level, cell) && !charAt(world, level.depth, cell);
  for (let count = 0; count < 10; count++) {
    let room: RoomInfo | undefined;
    for (let i = 0; i < 10 && !room; i++) {
      const candidate = rng.element(level.rooms);
      if (candidate?.type === RoomType.STANDARD) room = candidate;
    }
    if (!room) continue;
    const cell = randomCellIn(rng, room);
    if (free(cell)) return cell;
  }
  return randomCell(rng, free);
}

const nMobs = (rng: Rng, depth: number): number => 2 + (depth % 5) + rng.int(3);

const nextMobId = (world: World): string => `#${++world.nextId}`;

/** The monsters a new level starts with, asleep in its rooms. */
export function populate(world: World, level: Level, rng: Rng): Mob[] {
  // The Amulet's hall is empty but for the Amulet.
  if (level.depth >= 26) return [];
  if (isBossDepth(level.depth)) {
    // Goo sleeps in its lair; Tengu and DM-300 only appear when someone enters their arena.
    if (level.depth !== 5) return [];
    const arena = level.rooms.find((room) => room.type === RoomType.BOSS_EXIT)!;
    const goo = scaleMob(world, createMob(nextMobId(world), rollMob(rng, level.depth, false), randomCellIn(rng, arena), 'sleeping', 0));
    // The Rat King, in his hidden treasury next door.
    return level.ratKing === undefined ? [goo] : [goo, createMob(nextMobId(world), 'ratKing', level.ratKing, 'passive', 0)];
  }
  const mobs: Mob[] = [];
  if (level.shopkeeper !== undefined) {
    // ShopPainter.placeShopkeeper: the last shop is the ambitious imp's.
    mobs.push(createMob(nextMobId(world), level.depth === LAST_SHOP_DEPTH ? 'impShopkeeper' : 'shopkeeper', level.shopkeeper, 'passive', 0));
  }
  // LastShopLevel.createMobs: no monsters, only the shopkeeper if there is a shop.
  if (level.depth === LAST_SHOP_DEPTH) return mobs;
  if (level.statue !== undefined) mobs.push(animatedStatue(world, level, rng));
  for (const pos of level.piranhas ?? []) {
    const piranha = createMob(nextMobId(world), 'piranha', pos, 'sleeping', 0);
    piranha.level = level.depth;
    piranha.ht = piranha.hp = mobStats(piranha).ht;
    mobs.push(piranha);
  }
  const count = mobCount(nMobs(rng, level.depth), partySize(world));
  // Not yet registered in world.floors, so placement checks this list itself.
  const hidden = (cell: number): boolean => !mobs.some((mob) => mob.pos === cell);
  for (let i = 0; i < count; i++) {
    // RegularLevel.createMobs: Bestiary.mob, never a rare variant; those only come later, with the respawns.
    const kind = rollMob(rng, level.depth, false);
    const pos = randomRespawnCell(rng, world, level, hidden);
    if (pos === -1) break;
    mobs.push(scaleMob(world, createMob(nextMobId(world), kind, pos, 'sleeping', 0)));
  }
  return mobs;
}

/** Statue: still as stone until struck, holding an enchanted weapon that is no worse than plain. */
function animatedStatue(world: World, level: Level, rng: Rng): Mob {
  const generator = new ItemGenerator(rng, level.depth);
  let weapon: Item;
  do {
    weapon = generator.of('weapon');
  } while (itemDef(weapon.kind).category !== 'weapon' || weapon.level < 0);
  // Statue: its weapon is known through and through, then enchanted.
  identify(world, weapon);
  weapon.enchant = randomEnchantment(rng, weapon.enchant);
  const statue = createMob(nextMobId(world), 'statue', level.statue!, 'sleeping', 0);
  statue.level = level.depth;
  statue.item = weapon;
  statue.ht = statue.hp = mobStats(statue).ht;
  return statue;
}

/**
 * A hero who joins the party after a depth was made: the depth gains the
 * monsters a party that size calls for (party.ts), asleep, out of sight.
 */
export function reinforce(world: World, level: Level, floor: Floor, rng: Rng, party: number): void {
  if (level.depth >= 26 || level.depth === LAST_SHOP_DEPTH || isBossDepth(level.depth)) return;
  const base = nMobs(rng, level.depth);
  const extra = mobCount(base, party) - mobCount(base, party - 1);
  const seen = heroesOn(world, level.depth).map((hero) => castShadow(hero.pos, terrainBlocksSight(level.map), heroSight(world, level.depth)));
  for (let i = 0; i < extra; i++) {
    const kind = rollMob(rng, level.depth, false);
    const pos = randomRespawnCell(rng, world, level, (cell) => !seen.some((fov) => fov[cell]));
    if (pos === -1) break;
    floor.mobs.push(scaleMob(world, createMob(nextMobId(world), kind, pos, 'sleeping', floor.now)));
  }
}

/** Level.respawner: tops the depth up with a wandering monster now and then. */
export function respawn(ctx: Ctx): void {
  const { world, depth, level, floor, rng } = ctx;
  // Level.mobCount: allies do not count.
  if (floor.mobs.filter((mob) => !mob.ally).length < mobCount(nMobs(rng, depth), partySize(world))) {
    // Bestiary.mutable: now and then a rare variant.
    const kind = rollMob(rng, depth);

    const seen = heroesOn(world, depth).map((hero) => castShadow(hero.pos, terrainBlocksSight(level.map), heroSight(world, depth)));
    const pos = randomRespawnCell(rng, world, level, (cell) => !seen.some((fov) => fov[cell]));
    if (pos !== -1) {
      floor.mobs.push(scaleMob(world, createMob(nextMobId(world), kind, pos, 'wandering', floor.now)));
    }
  }
  floor.respawn += respawnTime(TIME_TO_RESPAWN, partySize(world));
}
