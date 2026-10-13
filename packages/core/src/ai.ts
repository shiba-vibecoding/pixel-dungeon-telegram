import {
  baseKind, beckon, createMob, GOO_PUMPED, type Hero, heroStealth, isAlive, isShopkeeper, type Mob, type MobState, MOBS, mobSpeed, mobStats,
} from './actors';
import { attack, defenseOf, hurt } from './combat';
import { dissolveGuardian, lotusAct, wardCanAttack, wardZap } from './allies';
import { castShadow, terrainBlocksSight, viewDistance } from './fov';
import { canEnter, type Char, charAt, type Ctx, enterCell, type Floor, heroesOn, heroView, isHero, isPassable, isWater, leaveCell } from './floor';
import { isChallenged, SWARM_INTELLIGENCE } from './challenges';
import { altarCallsMob } from './altar';
import { type Item, itemDef, ItemGenerator, randomEnchantment, randomGlyph } from './items';
import { identify } from './ident';
import { isBossDepth, LAST_SHOP_DEPTH } from './level/builder';
import { KING_PEDESTALS } from './level/city-boss';
import type { Level, RoomInfo } from './level/generate';
import { adjacent, cellX, cellY, distance, LENGTH, NEIGHBOURS8, WIDTH } from './level/geometry';
import { RoomType } from './level/room';
import { F, hasFlag, T } from './level/terrain';
import { burst, mobConditions, mobPress } from './traps';
import { buffsOf, magicDamage } from './buffs';
import { seedGas, smokeCells } from './gas';
import { flies, timeScale } from './status';
import { ghostAct, ghostSeesBoss, isInvisible } from './artifacts';
import { staggerTarget } from './plants';
import type { Rng } from './rng';
import type { World } from './world';
import { S } from './spd-sprites';
import { mobCount, partySize, scaleMob } from './party';
import { canAttackWithExtraReach, growChampion } from './champions';
import { fits, isEnemy, isOpenSpace } from './mobs';
import { hasProp } from './props';
import { randomArmor, randomWeapon } from './gear';
import {
  attackSpecial, beeAct, canAttackSpecial, escaped, exileWander, fleeSpecial, focusTime, golemWander, huntSpecial, mobPostAct, mobPreAct,
  piranhaSees, piranhaStep, rollRangedCooldown, teleportAway,
} from './mobskills';
import { distanceMap, getStep as pathStep, getStepBack, pathLength, route } from './pathfinder';
import { createMobs, dealMob, exoticChanceMultiplier, respawn, respawnCell, TIME_TO_RESPAWN } from './spawner';

/*
 * Monster behaviour, ported from Shattered's Mob: sleeping monsters may notice
 * whoever is in sight (the nearer and less stealthy, the likelier), wandering
 * ones roam between rooms and notice twice as readily, hunting ones chase
 * their enemy and strike when they can, fleeing ones run (and turn to fight
 * when cornered). With several heroes, a monster keeps after the one it chose
 * while it can see them, otherwise turns to the nearest one in sight. What
 * each of Shattered's monsters does beyond this is in mobskills.ts; who comes
 * where, in spawner.ts.
 */

const TICK = 1;
const TIME_TO_WAKE_UP = 1;
export { respawn, TIME_TO_RESPAWN };

/**
 * Char.viewDistance of a monster: eight cells, whatever the level (only the hero's sight follows the level's);
 * the demons of the halls see six (Light.DISTANCE), a bee four.
 */
export function mobSight(mob: Mob): number {
  switch (baseKind(mob.kind)) {
    case 'succubus': case 'eye': case 'scorpio': case 'ripper': return 6;
    case 'bee': return 4;
    default: return 8;
  }
}

/** What blocks a monster's sight: walls and the like, and smoke screens (SmokeScreen: losBlocking). */
export function sightBlockers(ctx: Ctx): (cell: number) => boolean {
  const terrain = terrainBlocksSight(ctx.level.map);
  const smoke = smokeCells(ctx.floor);
  return smoke.size === 0 ? terrain : (cell) => terrain(cell) || smoke.has(cell);
}

/** Mob.fieldOfView: what it sees from where it stands; nothing while blinded; a ward four cells, and one more a tier. */
export function mobFov(ctx: Ctx, mob: Mob): boolean[] {
  if ((mob.blind ?? 0) > 0) return new Array<boolean>(LENGTH).fill(false);
  const sight = mob.kind === 'ward' ? Math.min(3 + (mob.ward?.tier ?? 1), mobSight(mob)) : mobSight(mob);
  return castShadow(mob.pos, sightBlockers(ctx), sight);
}

/**
 * Char.spend: slowed, everything takes twice as long; chilled, a little longer the colder (status.ts timeScale); a
 * monk's focus comes back with time (Monk.spend).
 */
export function spend(mob: Mob, time: number): void {
  focusTime(mob, time, false);
  mob.time += time / timeScale(mob);
}

/** Char.stealth: a hero's; a monster has none. */
const stealthOf = (char: Char): number => (isHero(char) ? heroStealth(char) : 0);

/** Char.alignment: whether `other` is against `mob` — a monster against the heroes and their allies, an ally against the monsters. */
function hostileTo(mob: Mob, other: Char): boolean {
  if (other === mob || !isAlive(other)) return false;
  if (mob.ally) return !isHero(other) && !other.ally && isEnemy(other) && other.state !== 'passive' && other.kind !== 'lotus';
  return isHero(other) || other.ally === true;
}

/**
 * Mob.chooseEnemy: one in terror runs from whoever frightened it; it keeps after its enemy while it sees them
 * (unless only wandering, when only a hero holds it); otherwise it goes for the nearest of those it is against in
 * sight (by the way there, those it can strike first, a hero when as near), or the nearest hero at all. An ally
 * goes for the monsters (chooseFoe).
 */
function chooseEnemy(ctx: Ctx, mob: Mob, fov: boolean[]): Char | undefined {
  if (mob.ally) return chooseFoe(ctx, mob, fov);
  // Invisible heroes cannot be picked out.
  const heroes = heroesOn(ctx.world, ctx.depth).filter((hero) => !isInvisible(hero));
  const allies = ctx.floor.mobs.filter((other) => other.ally && other !== mob && isAlive(other));
  if ((mob.terror ?? 0) > 0) {
    const source = heroes.find((hero) => hero.id === mob.terrorOf);
    if (source) return source;
  }
  const current: Char | undefined = heroes.find((hero) => hero.id === mob.enemy) ?? allies.find((ally) => ally.id === mob.enemy);
  const charmer = (mob.charmed ?? 0) > 0 ? mob.charmedBy : undefined;
  if (current && fov[current.pos] && (mob.state !== 'wandering' || isHero(current)) && current.id !== charmer) return current;

  const seen: Char[] = [...heroes, ...allies].filter((char) => fov[char.pos]);
  // Charm: not the one charming it, if there is any other.
  const candidates = seen.length > 1 && charmer ? seen.filter((char) => char.id !== charmer) : seen;
  let chosen: Char | undefined;
  if (candidates.length > 0) {
    // The closest by the way there (around those in sight), preferring those it can strike, and a hero when as near.
    const open = passableMap(ctx, mob);
    const occupied = occupancy(ctx, fov);
    const steps = distanceMap(mob.pos, (cell) => open[cell] === 1 && occupied[cell] === 0);
    const near = (char: Char): number => Math.min(...NEIGHBOURS8.map((n) => steps[char.pos + n] ?? Infinity));
    let closestDist = Infinity;
    for (const char of candidates) {
      const dist = near(char);
      if (!chosen) {
        chosen = char;
        closestDist = dist;
      } else if (canAttack(ctx, mob, chosen) && !canAttack(ctx, mob, char)) {
        continue;
      } else if ((canAttack(ctx, mob, char) && !canAttack(ctx, mob, chosen)) || dist < closestDist) {
        chosen = char;
        closestDist = dist;
      } else if ((dist === closestDist && isHero(char)) || (canAttack(ctx, mob, char) && canAttack(ctx, mob, chosen) && dist < closestDist)) {
        chosen = char;
        closestDist = dist;
      }
    }
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
  // The earth guardian, an intelligent ally, only goes for those already up and fighting.
  const intelligent = mob.kind === 'guardian';
  const hostile = (other: Mob): boolean => hostileTo(mob, other) && (!intelligent || (other.state !== 'sleeping' && other.state !== 'wandering'));
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

/** The harmless and the shopkeepers: they mind their business and are never after anyone. */
const minding = (mob: Mob): boolean =>
  mob.state === 'passive' && (isShopkeeper(mob) || mob.kind === 'wandmaker' || mob.kind === 'imp' || mob.kind === 'blacksmith' || mob.kind === 'ratKing');

/**
 * A safety net under the free actions (a notice, a web, a chain, a leap cost no time, and the monster acts again at
 * once): a monster that has acted many times over without its clock moving waits a turn.
 */
const freeActs = new WeakMap<Mob, { at: number; count: number }>();

export function mobAct(ctx: Ctx, mob: Mob): void {
  const free = freeActs.get(mob);
  if (free && free.at === mob.time) {
    if (++free.count > 20) {
      spend(mob, TICK);
      return;
    }
  } else {
    freeActs.set(mob, { at: mob.time, count: 0 });
  }
  // Alchemy's allies (those that follow a hero: an enthralled monster, a prismatic image, a summoned elemental); the
  // wands' allies go the monsters' way, against the monsters (chooseFoe).
  if (mob.ally && mob.owner !== undefined && mob.kind !== 'mirror' && mob.kind !== 'bee') {
    allyAct(ctx, mob);
    return;
  }
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
  // ImpShopkeeper.act: the imp greets the first hero to see him.
  if (mob.kind === 'impShopkeeper' && !mob.greeted && heroesOn(ctx.world, ctx.depth).some((hero) => heroView(ctx.world, hero)[mob.pos])) {
    mob.greeted = true;
    ctx.effects.push({ type: 'greeting', depth: ctx.depth, mob: mob.id });
  }
  if (minding(mob)) {
    spend(mob, TICK);
    return;
  }
  // The sad ghost drifts about the level at half speed, never after anyone.
  if (mob.state === 'passive' && mob.kind === 'ghost') {
    const fov = mobFov(ctx, mob);
    if (mob.target !== -1 && mob.target !== mob.pos && getCloser(ctx, mob, mob.target, fov)) {
      spend(mob, 1 / mobSpeed(mob));
    } else {
      mob.target = randomDestination(ctx, mob);
      spend(mob, TICK);
    }
    return;
  }
  // SacrificialFire.evolve: drawn to the altar's fire, and marked while in it.
  altarCallsMob(ctx, mob);
  // Piranha.act: out of the water (or floating over it), a piranha dies — a phantom one teleports to water if it can.
  if ((mob.kind === 'piranha' || mob.kind === 'phantomPiranha') && !isWater(ctx.level.map[mob.pos]!)) {
    if (mob.kind === 'phantomPiranha' && teleportAway(ctx, mob)) {
      spend(mob, TICK);
      return;
    }
    hurt(ctx, mob, mob.hp, 'dry');
    return;
  }
  // Poisoned or paralysed by a trap's gas (Mob.act: paralysed, it sees no one and waits).
  if (mobConditions(ctx, mob)) {
    spend(mob, TICK);
    return;
  }
  growChampion(mob, ctx.floor.now);
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
  // CursePersonification.act: the curse mends itself, a point a turn.
  if (mob.kind === 'curse' && mob.hp < mob.ht) mob.hp++;
  // Goo mends itself in the murky water of its lair, and the rotting fist faster.
  if (mob.kind === 'goo' && isWater(ctx.level.map[mob.pos]!) && mob.hp < mob.ht) mob.hp++;
  if (mob.kind === 'rottingFist' && isWater(ctx.level.map[mob.pos]!)) mob.hp = Math.min(mob.ht, mob.hp + 4);
  // BurningFist.act: everything around the burning fist catches fire.
  if (mob.kind === 'burningFist') burst(ctx, mob.pos, 'fire', 1, true);
  if (mob.kind === 'dm300') ventGas(ctx, mob);
  // (Adrenaline wears off with the rest a monster carries: throwing.ts mobGearTick.)
  if ((mob.haste ?? 0) > 0) mob.haste!--;
  // Dread.act: it runs from whoever filled it with dread (and, far enough, is gone for good: buffs.ts).
  if ((mob.buffs?.dread ?? 0) > 0) {
    const from = heroesOn(ctx.world, ctx.depth).find((hero) => hero.id === mob.buffs!.dreadOf) ?? heroesOn(ctx.world, ctx.depth)[0];
    if (from && getFurther(ctx, mob, from.pos)) spend(mob, 1 / mobSpeed(mob));
    else spend(mob, TICK);
    return;
  }
  // Each kind's own act before Mob.act (mobskills.ts).
  if (mobPreAct(ctx, mob) || !isAlive(mob) || !ctx.floor.mobs.includes(mob)) return;

  const fov = mobFov(ctx, mob);
  // StoneOfAggression.Aggression: a monster in sight marked by the stone draws every other's anger.
  const marked = ctx.floor.mobs.find((other) => other !== mob && (other.buffs?.aggression ?? 0) > 0 && fov[other.pos] && isAlive(other));
  if (marked && !mob.beeFoe) mob.beeFoe = marked.id;
  // Mob.aggro: struck by an ally (or drawn by the stone), it turns on it while it lives and is in sight.
  if (mob.beeFoe && beeFight(ctx, mob, fov)) return;
  const justAlerted = mob.alerted;
  mob.alerted = false;
  // Terror: it flees whoever frightened it (Mob.act: Terror means FLEEING).
  if ((mob.terror ?? 0) > 0) {
    mob.terror!--;
    mob.state = 'fleeing';
  }
  const lastState = mob.state;
  const enemy = chooseEnemy(ctx, mob, fov);
  let enemyInFov = enemy !== undefined && isAlive(enemy) && fov[enemy.pos]! && !(isHero(enemy) && isInvisible(enemy));
  // Piranha's AI: an enemy it cannot swim to is as good as unseen.
  if (enemyInFov && (mob.kind === 'piranha' || mob.kind === 'phantomPiranha')) enemyInFov = piranhaSees(ctx, mob, enemy!);
  act(ctx, mob, enemy, enemyInFov, justAlerted, fov);
  swarmIntel(ctx, mob, enemy, enemyInFov && mob.state === lastState);
  mobPostAct(ctx, mob, lastState, enemy);
}

/** Mob.state.act: the state machine, once. */
function act(ctx: Ctx, mob: Mob, enemy: Char | undefined, enemyInFov: boolean, justAlerted: boolean, fov: boolean[]): void {
  switch (mob.state) {
    case 'sleeping':
      sleeping(ctx, mob, enemy, enemyInFov);
      return;
    case 'wandering':
      wandering(ctx, mob, enemy, enemyInFov, justAlerted, fov);
      return;
    case 'hunting':
      hunting(ctx, mob, enemy, enemyInFov, fov);
      return;
    case 'fleeing':
      fleeing(ctx, mob, enemy, enemyInFov, fov);
      return;
    case 'passive':
      // Mob.Passive: it only keeps track of whether it sees its enemy.
      mob.enemySeen = enemyInFov;
      spend(mob, TICK);
      return;
  }
}

/**
 * Mob.Sleeping: put under anything harmful, it wakes; else, with someone in sight, the least likely of those in
 * sight to be noticed (the farther and stealthier; one flying two or more cells off never is) may wake it, one
 * chance in their distance plus stealth.
 */
function sleeping(ctx: Ctx, mob: Mob, enemy: Char | undefined, enemyInFov: boolean): void {
  // An animated statue stands still until someone strikes it.
  if (mob.kind === 'statue' || mob.kind === 'armoredStatue') {
    spend(mob, TICK);
    return;
  }
  // Ghoul.Sleeping: a ghoul wakes when its partner does, and goes to it.
  const partner = mob.kind === 'ghoul' ? ctx.floor.mobs.find((other) => other.id === mob.partner && isAlive(other)) : undefined;
  if (partner && partner.state !== 'sleeping') {
    mob.state = 'wandering';
    mob.target = partner.pos;
    return;
  }
  if (debuffed(mob)) {
    awaken(ctx, mob, enemy, enemyInFov);
    return;
  }
  if (enemyInFov || (enemy && isHero(enemy) && isInvisible(enemy))) {
    // Mob.Sleeping: woken by the least stealthy of those against it in sight (one flying two or more cells off never wakes it).
    let lowest = Infinity;
    let closest: Char | undefined;
    const fov = mobFov(ctx, mob);
    const others: Char[] = [...heroesOn(ctx.world, ctx.depth), ...ctx.floor.mobs];
    for (const other of others) {
      if (!fov[other.pos] || !hostileTo(mob, other) || (isHero(other) && isInvisible(other))) continue;
      let dist = distance(mob.pos, other.pos) + stealthOf(other);
      if (flies(other) && distance(mob.pos, other.pos) >= 2) dist = Infinity;
      if (dist < lowest) {
        lowest = dist;
        closest = other;
      }
    }
    if (closest && ctx.rng.floatMax(lowest) < 1) {
      awaken(ctx, mob, closest === enemy || isHero(closest) ? closest : enemy, enemyInFov);
      return;
    }
  }
  mob.enemySeen = false;
  spend(mob, TICK);
}

/** Mob.Sleeping.detectionChance (one in distance plus stealth) and Wandering's (one in half the distance plus stealth). */
const detectionChance = (mob: Mob, char: Char, divisor: number): number => 1 / (distance(mob.pos, char.pos) / divisor + stealthOf(char));

/** Whether a monster is under anything harmful (Buff.buffType.NEGATIVE), which wakes it. */
function debuffed(mob: Mob): boolean {
  return (mob.poison ?? 0) > 0 || (mob.burning ?? 0) > 0 || (mob.crippled ?? 0) > 0 || (mob.bleeding ?? 0) > 0 ||
    (mob.weakened ?? 0) > 0 || (mob.vulnerable ?? 0) > 0 || (mob.hexed ?? 0) > 0 || (mob.slowed ?? 0) > 0 || (mob.rooted ?? 0) > 0 ||
    (mob.charmed ?? 0) > 0 || (mob.terror ?? 0) > 0 || (mob.amok ?? 0) > 0 || (mob.blind ?? 0) > 0;
}

/** Mob.Sleeping.awaken: up and hunting whom it saw (and calling to the others under swarm intelligence), or wandering. */
function awaken(ctx: Ctx, mob: Mob, enemy: Char | undefined, enemyInFov: boolean): void {
  if (enemyInFov && enemy) {
    notice(ctx, mob, enemy, 'hunting');
  } else {
    ctx.effects.push({ type: 'noticed', depth: ctx.depth, mob: mob.id });
    mob.state = 'wandering';
    mob.target = randomDestination(ctx, mob);
  }
  spend(mob, TIME_TO_WAKE_UP);
}

/**
 * Mob.Wandering: someone in sight it notices (at once if it was just struck) sets it hunting, at no cost in time;
 * else it walks on to where it was going, or picks somewhere else. A gnoll exile left in peace stays in peace
 * (GnollExile.Passive); a ghoul goes where its partner is (Ghoul.Wandering); a golem that cannot walk there
 * teleports (Golem.Wandering).
 */
function wandering(ctx: Ctx, mob: Mob, enemy: Char | undefined, enemyInFov: boolean, justAlerted: boolean, fov: boolean[]): void {
  if (exileWander(ctx, mob, enemy, enemyInFov, justAlerted) === 'calm') {
    continueWandering(ctx, mob, fov);
    return;
  }
  if (enemy && enemyInFov && (justAlerted || ctx.rng.float() < detectionChance(mob, enemy, 2))) {
    // Spotting someone costs no time: it starts hunting on this very turn.
    notice(ctx, mob, enemy, 'hunting');
    mob.alerted = true;
    if (mob.kind === 'gnollExile') ctx.effects.push({ type: 'mobSays', depth: ctx.depth, mob: mob.id, line: 'seenAggro' });
    // Thief.Wandering: carrying its loot, it runs rather than fights.
    if ((mob.kind === 'thief' || mob.kind === 'bandit') && mob.item) mob.state = 'fleeing';
    return;
  }
  continueWandering(ctx, mob, fov);
}

function continueWandering(ctx: Ctx, mob: Mob, fov: boolean[]): void {
  mob.enemySeen = false;
  // EarthGuardian.Wandering: with no foe in sight, it crumbles back into the hero's armour.
  if (mob.kind === 'guardian') {
    dissolveGuardian(ctx, mob);
    return;
  }
  const partner = mob.kind === 'ghoul' ? ctx.floor.mobs.find((other) => other.id === mob.partner && isAlive(other)) : undefined;
  if (partner && (partner.state !== 'wandering' || distance(mob.pos, partner.target) > 1)) {
    mob.target = partner.pos;
    if (getCloser(ctx, mob, mob.target, fov)) spend(mob, 1 / mobSpeed(mob));
    else spend(mob, TICK);
    return;
  }
  if (mob.target !== -1 && getCloser(ctx, mob, mob.target, fov)) {
    spend(mob, 1 / mobSpeed(mob));
    return;
  }
  if (golemWander(ctx, mob)) return;
  mob.target = wanderDestination(ctx, mob);
  spend(mob, TICK);
}

/**
 * Wandering.randomDestination; the sad ghost's foes (FetidRat, GnollTrickster, GreatCrab) pick, of two, the one
 * nearer the heroes.
 */
function wanderDestination(ctx: Ctx, mob: Mob): number {
  const first = randomDestination(ctx, mob);
  if (mob.kind !== 'fetidRat' && mob.kind !== 'gnollTrickster' && mob.kind !== 'greatCrab') return first;
  const second = randomDestination(ctx, mob);
  const hero = heroesOn(ctx.world, ctx.depth)[0];
  if (!hero) return first;
  const steps = (cell: number): number => pathLength(hero.pos, cell, (c) => isPassable(ctx.level, c));
  return steps(second) < steps(first) ? second : first;
}

/**
 * Mob.Hunting: it strikes its enemy in sight if it can (not the one it is charmed by); else it heads for where the
 * enemy is (or was last seen); with no enemy left it wanders. Unable to get any nearer, it looks for another enemy,
 * and failing that waits — losing the trail if it no longer sees its enemy. Each kind's own hunting comes first
 * (mobskills.ts huntSpecial).
 */
function hunting(ctx: Ctx, mob: Mob, enemy: Char | undefined, enemyInFov: boolean, fov: boolean[], retried = false): void {
  if (huntSpecial(ctx, mob, enemy, enemyInFov, fov)) return;
  mob.enemySeen = enemyInFov;
  const charmed = enemy !== undefined && (mob.charmed ?? 0) > 0 && mob.charmedBy === enemy.id;
  if (enemy && enemyInFov && !charmed && canAttack(ctx, mob, enemy)) {
    mob.target = enemy.pos;
    doAttack(ctx, mob, enemy);
    return;
  }
  if (enemy && enemyInFov) {
    mob.target = enemy.pos;
  } else if (!enemy) {
    mob.state = 'wandering';
    mob.target = randomDestination(ctx, mob);
    spend(mob, TICK);
    return;
  }
  if (mob.target !== -1 && getCloser(ctx, mob, mob.target, fov)) {
    spend(mob, 1 / mobSpeed(mob));
    return;
  }
  // Mob.Hunting.handleUnreachableTarget: another enemy, if there is one it could go for.
  if (!retried) {
    const old = mob.enemy;
    mob.enemy = null;
    const other = chooseEnemy(ctx, mob, fov);
    if (other && other.id !== old) {
      hunting(ctx, mob, other, fov[other.pos]! && !(isHero(other) && isInvisible(other)), fov, true);
      return;
    }
    mob.enemy = old;
  }
  spend(mob, TICK);
  if (!enemyInFov) {
    mob.state = 'wandering';
    mob.target = randomDestination(ctx, mob);
  }
}

/**
 * Mob.Fleeing: away from its enemy, or from where it was last seen; out of sight long enough (a roll on the
 * distance), it has got away (Fleeing.escaped: a thief with its loot, a crystal mimic); cornered, it turns to fight,
 * unless in terror.
 */
function fleeing(ctx: Ctx, mob: Mob, enemy: Char | undefined, enemyInFov: boolean, fov: boolean[]): void {
  if (fleeSpecial(ctx, mob, enemy, enemyInFov)) return;
  mob.enemySeen = enemyInFov;
  if (!enemy || (!enemyInFov && 1 + ctx.rng.int(distance(mob.pos, mob.target)) >= 6)) {
    escaped(ctx, mob);
    if (mob.state !== 'fleeing') {
      spend(mob, TICK);
      return;
    }
  } else if (enemyInFov) {
    mob.target = enemy.pos;
  }
  if (mob.target !== -1 && getFurther(ctx, mob, mob.target, fov)) {
    spend(mob, 1 / mobSpeed(mob));
    return;
  }
  spend(mob, TICK);
  // Fleeing.nowhereToRun: cornered and not in terror, it turns on its pursuer (or wanders, if it saw none).
  if ((mob.terror ?? 0) <= 0) {
    if (mob.enemySeen) {
      mob.state = 'hunting';
      ctx.effects.push({ type: 'cornered', depth: ctx.depth, mob: mob.id, kind: mob.kind });
      // CrystalMimic.Fleeing.nowhereToRun: crystal mimics are fast — it acts again at once.
      if (mob.kind === 'crystalMimic') mob.time -= TICK;
    } else {
      mob.state = 'wandering';
    }
  }
}

/**
 * Mob.processSwarmIntel, under swarm intelligence: a monster hunting a hero in sight calls the others near it to
 * the hero — two cells further for every turn it keeps them in sight, twelve at most.
 */
function swarmIntel(ctx: Ctx, mob: Mob, enemy: Char | undefined, enemyInFov: boolean): void {
  if (!isChallenged(ctx.world, SWARM_INTELLIGENCE) || mob.state !== 'hunting' || !enemyInFov || !enemy || !isEnemy(mob)) {
    delete mob.seenSince;
    return;
  }
  const now = ctx.floor.now;
  if (mob.seenSince === undefined || mob.seenSince >= now) mob.seenSince = now - 1;
  const range = Math.max(0, Math.min(12, 2 * Math.trunc(Math.max(now - mob.seenSince, 0))));
  for (const other of ctx.floor.mobs) {
    if (other === mob || !isEnemy(other) || (other.paralysed ?? 0) > 0 || other.state === 'hunting') continue;
    if (distance(mob.pos, other.pos) <= range) beckon(other, enemy.pos);
  }
}

/**
 * MirrorImage.act: after the nearest monster in sight, with its hero's skill
 * and strength; having struck, it is gone. With nothing to fight, it keeps
 * close to its hero.
 */
function imageAct(ctx: Ctx, mob: Mob): void {
  const image = mob.image!;
  const fov = castShadow(mob.pos, sightBlockers(ctx), viewDistance(ctx.depth));
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
  if (goal !== -1 && getCloser(ctx, mob, goal, fov)) spend(mob, 1 / mobSpeed(mob));
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
  spend(mob, 1 / mobSpeed(mob));
  return true;
}

/**
 * An ally's turn (Mob with Alignment.ALLY: an enthralled monster, a prismatic image, a summoned elemental): it goes
 * for the nearest monster in sight that is not a friend, and the monster it strikes turns on it (Mob.aggro); with
 * nobody to fight it keeps near its hero; a prismatic image steps back into its hero's guard.
 */
function allyAct(ctx: Ctx, mob: Mob): void {
  if (mobConditions(ctx, mob)) {
    spend(mob, TICK);
    return;
  }
  const owner = heroesOn(ctx.world, ctx.depth).find((hero) => hero.id === mob.owner);
  if (mob.kind === 'prismatic' && owner) mob.level = owner.lvl;
  const fov = mobFov(ctx, mob);
  const hostile = (other: Mob): boolean => hostileTo(mob, other) && fov[other.pos]!;
  let foe = ctx.floor.mobs.find((other) => other.id === mob.enemy && hostile(other));
  if (!foe) {
    for (const other of ctx.floor.mobs) {
      if (hostile(other) && (!foe || distance(mob.pos, other.pos) < distance(mob.pos, foe.pos))) foe = other;
    }
    mob.enemy = foe?.id ?? null;
  }
  if (foe && adjacent(mob.pos, foe.pos)) {
    attack(ctx, mob, foe);
    if (isAlive(foe)) foe.beeFoe = mob.id;
    spend(mob, mobStats(mob).attackDelay ?? TICK);
    return;
  }
  if (foe && getCloser(ctx, mob, foe.pos, fov)) {
    spend(mob, 1 / mobSpeed(mob));
    return;
  }
  // PrismaticImage.Wandering: nobody to fight, it goes back into its hero's guard.
  if (mob.kind === 'prismatic' && owner && !foe) {
    buffsOf(owner).prismaticGuard = mob.hp;
    ctx.floor.mobs.splice(ctx.floor.mobs.indexOf(mob), 1);
    leaveCell(ctx.world, ctx.level, ctx.depth, mob.pos);
    ctx.effects.push({ type: 'faded', depth: ctx.depth, mob: mob.id, pos: mob.pos });
    return;
  }
  if (owner && distance(owner.pos, mob.pos) > 2 && getCloser(ctx, mob, owner.pos, fov)) spend(mob, 1 / mobSpeed(mob));
  else spend(mob, TICK);
}

/** Amok: it falls upon whoever is nearest in sight, monster or hero. */
function runAmok(ctx: Ctx, mob: Mob): void {
  const fov = mobFov(ctx, mob);
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
    spend(mob, 1 / mobSpeed(mob));
  } else {
    spend(mob, TICK);
  }
}

/** Dungeon.findPassable: where a monster may step — open ground; a flier (or one beside itself) over traps and chasms; the large only in open space. */
function passableFor(ctx: Ctx, mob: Mob, cell: number): boolean {
  if (cell < 0 || cell >= LENGTH) return false;
  const heedless = MOBS[mob.kind].flying === true || (mob.amok ?? 0) > 0 || (mob.rage ?? 0) > 0;
  if (!canStand(ctx, mob, cell, heedless)) return false;
  return fits(ctx.level, mob, cell);
}

/**
 * Mob.getFurther and Dungeon.flee: a step back from the threat (PathFinder.getStepBack), looking eight steps ahead
 * (four in terror, never towards it); characters only count as in the way where the step runs into one. False if
 * it cannot get away (DM-201s never move).
 */
export function getFurther(ctx: Ctx, mob: Mob, threat: number, _fov?: boolean[]): boolean {
  if ((mob.rooted ?? 0) > 0 || threat === mob.pos || hasProp(mob, 'immovable')) return false;
  const open = passableMap(ctx, mob);
  const passable = new Array<boolean>(LENGTH);
  for (let cell = 0; cell < LENGTH; cell++) passable[cell] = open[cell] === 1;
  passable[mob.pos] = true;
  const terror = (mob.terror ?? 0) > 0;
  let step = getStepBack(mob.pos, threat, terror ? 4 : 8, [...passable], !terror);
  while (step !== -1 && step !== mob.pos && charAt(ctx.world, ctx.depth, step)) {
    passable[step] = false;
    step = getStepBack(mob.pos, threat, terror ? 4 : 8, [...passable], !terror);
  }
  if (step === -1) return false;
  if (step !== mob.pos) moveMob(ctx, mob, step);
  return true;
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

/** Mob.Wandering.noticeEnemy: it has seen someone, and is after them. */
function notice(ctx: Ctx, mob: Mob, enemy: Char, state: MobState): void {
  mob.enemySeen = true;
  mob.state = state;
  mob.target = enemy.pos;
  mob.enemy = enemy.id;
  ctx.effects.push({ type: 'noticed', depth: ctx.depth, mob: mob.id });
  if (isHero(enemy) && (mob.kind === 'goo' || mob.kind === 'tengu' || mob.kind === 'dm300' || mob.kind === 'king')) {
    ctx.effects.push({ type: 'yell', depth: ctx.depth, mob: mob.id, kind: mob.kind, line: 'notice', hero: enemy.id });
    ghostSeesBoss(ctx);
  }
}

/**
 * Mob.canAttack: at arm's length (or a champion's reach), or each kind's own way (mobskills.ts); the bosses theirs.
 */
export function canAttack(ctx: Ctx, mob: Mob, enemy: Char): boolean {
  // Ward.canAttack: a clear bolt; the lotus never.
  if (mob.kind === 'ward') return wardCanAttack(ctx, mob, enemy);
  if (mob.kind === 'lotus') return false;
  const special = canAttackSpecial(ctx, mob, enemy);
  if (special !== undefined) return special;
  // Tengu throws shuriken and the burning fist fire at anyone in a clear line.
  if (mob.kind === 'tengu' || mob.kind === 'burningFist') {
    return ballistica(ctx, mob.pos, enemy.pos).at(-1) === enemy.pos;
  }
  // The King goes to a pedestal to raise his undead while his court is short.
  if (mob.kind === 'king' && kingCanSummon(ctx, mob)) return mob.pos === kingPedestal(mob);
  if (mob.pumped) return distance(mob.pos, enemy.pos) <= 2;
  return adjacent(mob.pos, enemy.pos) || canAttackWithExtraReach(ctx, mob, enemy);
}

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
  const fov = castShadow(mob.pos, sightBlockers(ctx), viewDistance(depth));
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

/** Mob.attackDelay: the kind's, halved under Adrenaline (Char.attackDelay / 1.5 in Shattered: «delay /= 1.5»). */
const attackDelay = (mob: Mob): number => (mobStats(mob).attackDelay ?? TICK) / ((mob.adrenaline ?? 0) > 0 ? 1.5 : 1);

/** Mob.doAttack: each kind's way from afar (mobskills.ts), a boss's own, or a blow at arm's length. */
function doAttack(ctx: Ctx, mob: Mob, enemy: Char): void {
  // Ward.doAttack: its bolt.
  if (mob.kind === 'ward') {
    wardZap(ctx, mob, enemy);
    return;
  }
  if (attackSpecial(ctx, mob, enemy)) return;
  if (mob.kind === 'burningFist' && !adjacent(mob.pos, enemy.pos)) {
    // BurningFist.attack from afar: a ball of fire, a magic attack.
    spend(mob, TICK);
    ctx.effects.push({ type: 'zapped', depth: ctx.depth, from: mob.pos, to: enemy.pos, bolt: 'fire' });
    const hit = ctx.rng.floatMax(MOBS.burningFist.attack) * 2 >= ctx.rng.floatMax(defenseOf(enemy, mob));
    const damage = hit ? magicDamage(ctx, enemy, ctx.rng.normalIntRange(...MOBS.burningFist.damage)) : 0;
    ctx.effects.push({ type: 'attack', depth: ctx.depth, attacker: mob.id, target: enemy.id, hit, damage });
    if (hit) hurt(ctx, enemy, damage, mob);
    return;
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
    spend(mob, attackDelay(mob));
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

/**
 * Mob.getCloser: a step towards `target`. Rooted (or a DM-201), it cannot; a piranha only through water; a hunting
 * scorpio or gnoll trickster keeps its distance instead; a great crab is slow (two steps in three); a succubus
 * blinks up to her prey, now and then. Tengu jumps to anyone it sees; the King heads for his pedestal.
 */
export function getCloser(ctx: Ctx, mob: Mob, target: number, fov: boolean[]): boolean {
  // Rooted, it cannot move a step; what is immovable never does (a DM-201, a spawner, a ward).
  if ((mob.rooted ?? 0) > 0 || target === mob.pos || hasProp(mob, 'immovable')) return false;
  if (mob.kind === 'goo') mob.pumped = false;
  if (mob.kind === 'gnollTrickster') mob.combo = 0;
  // Scorpio.getCloser, GnollTrickster.getCloser: a hunting one keeps its distance, to strike from afar.
  if ((baseKind(mob.kind) === 'scorpio' || mob.kind === 'gnollTrickster') && mob.state === 'hunting') {
    return mob.enemySeen && getFurther(ctx, mob, target, fov);
  }
  // GreatCrab.getCloser: every third step it stays where it is (it is slow, though it notices as quickly).
  if (mob.kind === 'greatCrab') {
    mob.moving = (mob.moving ?? 0) + 1;
    if (mob.moving >= 3) {
      mob.moving = 0;
      return true;
    }
  }
  // Succubus.getCloser: she blinks up to her prey, now and then, at no cost in time.
  if (mob.kind === 'succubus') {
    if (fov[target] && distance(mob.pos, target) > 2 && (mob.blinkCooldown ?? 0) <= 0) {
      if (!blink(ctx, mob, target)) return false;
      mob.time -= 1 / mobSpeed(mob);
      return true;
    }
    mob.blinkCooldown = (mob.blinkCooldown ?? 0) - 1;
  }
  if (mob.kind === 'king' && kingCanSummon(ctx, mob)) target = kingPedestal(mob);
  // Tengu does not walk up to anyone it can see: it jumps.
  if (mob.kind === 'tengu' && fov[target]) {
    tenguJump(ctx, mob);
    return true;
  }
  const step = mob.kind === 'piranha' || mob.kind === 'phantomPiranha' ? piranhaStep(ctx, mob, target, fov) : findStep(ctx, mob, target, fov);
  if (step === -1) return false;
  moveMob(ctx, mob, step, true, true);
  return true;
}

/**
 * Succubus.blink: along a clear line to her prey (stopping short of anyone there); where she would land on
 * something to avoid (or, large, in a corridor), beside it if there is room. She cannot blink again for four to
 * six turns.
 */
function blink(ctx: Ctx, mob: Mob, target: number): boolean {
  const trace = ballistica(ctx, mob.pos, target);
  let cell = trace.at(-1)!;
  if (charAt(ctx.world, ctx.depth, cell) && cell !== mob.pos && trace.length > 1) cell = trace[trace.length - 2]!;
  if ((hasFlag(ctx.level.map[cell]!, F.AVOID) && cell !== mob.pos) || !fits(ctx.level, mob, cell)) {
    const end = trace.at(-1)!;
    const cells = NEIGHBOURS8.map((n) => end + n).filter((c) => isPassable(ctx.level, c) && !charAt(ctx.world, ctx.depth, c) && fits(ctx.level, mob, c));
    if (cells.length === 0) {
      mob.blinkCooldown = ctx.rng.intRange(4, 6);
      return false;
    }
    cell = ctx.rng.element(cells)!;
  }
  const from = mob.pos;
  appear(ctx, mob, cell);
  ctx.effects.push({ type: 'jumped', depth: ctx.depth, mob: mob.id, from, to: mob.pos });
  mob.blinkCooldown = ctx.rng.intRange(4, 6);
  return true;
}

/**
 * ScrollOfTeleportation.appear: a character is suddenly somewhere else, touching nothing where it lands
 * (Char.move without travelling).
 */
export function appear(ctx: Ctx, char: Char, to: number): void {
  if (to === char.pos) return;
  const from = char.pos;
  char.pos = to;
  leaveCell(ctx.world, ctx.level, ctx.depth, from);
  enterCell(ctx.level, to);
}

/**
 * Mob.move: a step to the next cell. A fleeing spinner leaves a web behind it (Spinner.move); then,
 * unless it flies, the monster presses the cell it comes to (Level.mobPress: traps, chasms, plants).
 * `press` false: it appears there by magic instead (WandOfBlink.appear), touching nothing. `travelling`:
 * a walk (a monk gathers focus faster on the move).
 */
export function moveMob(ctx: Ctx, mob: Mob, to: number, press = true, travelling = false): void {
  // Crippled, every step takes twice as long.
  if ((mob.crippled ?? 0) > 0) mob.time += 1 / mobSpeed(mob);
  if (travelling) focusTime(mob, 0, true);
  const from = mob.pos;
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
 * Mob.getCloser's path (Dungeon.findPath): the next step, treating characters the mover can see as obstacles. Traps
 * and chasms the party knows of are walked around, unless the mover flies or is beside itself (Amok, Rage); the
 * large keep to open space; a goal right next to it is stepped onto whatever it is. A hunter blocked only by
 * others (the way round more than twice as long) waits for the way to clear rather than go round.
 */
function findStep(ctx: Ctx, mob: Mob, to: number, fov: boolean[]): number {
  const { world, depth } = ctx;
  if (adjacent(mob.pos, to)) {
    return !charAt(world, depth, to) && canStand(ctx, mob, to, true) && fits(ctx.level, mob, to) ? to : -1;
  }
  const open = passableMap(ctx, mob);
  const occupied = occupancy(ctx, fov);
  const full = route(mob.pos, to, (cell) => open[cell] === 1 && occupied[cell] === 0);
  // Mob.getCloser: the path goes through whom it cannot see, but the step itself is never onto anyone.
  const free = (step: number): number => (step !== -1 && charAt(world, depth, step) ? -1 : step);
  if (mob.state !== 'hunting') return free(full.step);
  const through = route(mob.pos, to, (cell) => open[cell] === 1);
  if (through.length !== Infinity && (full.length === Infinity || full.length > 2 * through.length)) return free(through.step);
  return free(full.step);
}

/** Who stands where in sight (Dungeon.findPassable's characters): 1 where someone is. */
function occupancy(ctx: Ctx, fov: boolean[]): Uint8Array {
  const occupied = new Uint8Array(LENGTH);
  for (const hero of heroesOn(ctx.world, ctx.depth)) if (fov[hero.pos]) occupied[hero.pos] = 1;
  for (const other of ctx.floor.mobs) if (fov[other.pos]) occupied[other.pos] = 1;
  return occupied;
}

/** passableFor over the whole level at once, for a search. */
function passableMap(ctx: Ctx, mob: Mob): Uint8Array {
  const map = new Uint8Array(LENGTH);
  const heedless = MOBS[mob.kind].flying === true || (mob.amok ?? 0) > 0 || (mob.rage ?? 0) > 0;
  const large = hasProp(mob, 'large');
  for (let cell = 0; cell < LENGTH; cell++) {
    if (canStand(ctx, mob, cell, heedless) && (!large || isOpenSpace(ctx.level, cell))) map[cell] = 1;
  }
  return map;
}

/**
 * Where a monster may go: open ground (Level.passable), and with `avoid` also known traps and
 * chasms (Level.avoid); for a piranha only the water of its pool.
 */
function canStand(ctx: Ctx, mob: Mob | undefined, cell: number, avoid = false): boolean {
  if (mob?.kind === 'piranha' || mob?.kind === 'phantomPiranha') return isPassable(ctx.level, cell) && isWater(ctx.level.map[cell]!);
  return isPassable(ctx.level, cell) || (avoid && cell >= 0 && cell < LENGTH && hasFlag(ctx.level.map[cell]!, F.AVOID));
}

/** PathFinder.getStep, for whoever needs a step towards a cell (kept for the other modules). */
export function getStep(from: number, to: number, passable: (cell: number) => boolean): number {
  return pathStep(from, to, passable);
}

/** A random cell inside a room, as Room.random(). */
function randomCellIn(rng: Rng, room: RoomInfo): number {
  return rng.intBetween(room.left + 1, room.right) + rng.intBetween(room.top + 1, room.bottom) * WIDTH;
}

/** RegularLevel.randomDestination: somewhere in a room to wander to (open space for the large); thirty tries. */
export function randomDestination(ctx: Ctx, mob?: Mob): number {
  const { rng, level } = ctx;
  for (let attempt = 0; attempt < 30; attempt++) {
    const room = rng.element(level.rooms);
    if (!room) break;
    const cell = randomCellIn(rng, room);
    if (isPassable(level, cell) && (!mob || !hasProp(mob, 'large') || isOpenSpace(level, cell))) return cell;
  }
  return -1;
}

/** Level.randomDestination, for a depth being played. */
export const randomDestinationFor = (ctx: Ctx): number => randomDestination(ctx);

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
 * RegularLevel.randomRespawnCell: a free cell in a standard room, out of sight. None on the last shop's level
 * (LastShopLevel.randomRespawnCell): nothing teleports there, as under the original's "strong magic aura".
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

const nextMobId = (world: World): string => `#${++world.nextId}`;

/**
 * The monsters a new level starts with (RegularLevel.createMobs, spawner.ts), asleep in its rooms, and its
 * guardians: an animated statue (one in ten armoured), the piranhas of a flooded vault (one in fifty a phantom),
 * a demon spawner of the halls. Boss levels hold only their boss, shops their keeper.
 */
export function populate(world: World, level: Level, rng: Rng): Mob[] {
  // The Amulet's hall is empty but for the Amulet.
  if (level.depth >= 26) return [];
  if (isBossDepth(level.depth)) {
    // Goo sleeps in its lair; Tengu and DM-300 only appear when someone enters their arena.
    if (level.depth !== 5) return [];
    const arena = level.rooms.find((room) => room.type === RoomType.BOSS_EXIT)!;
    const goo = scaleMob(world, createMob(nextMobId(world), 'goo', randomCellIn(rng, arena), 'sleeping', 0));
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
    // Piranha.random: one in fifty a phantom piranha.
    const kind = rng.float() < (1 / 50) * exoticChanceMultiplier(world) ? 'phantomPiranha' : 'piranha';
    const piranha = createMob(nextMobId(world), kind, pos, 'sleeping', 0);
    piranha.level = level.depth;
    piranha.ht = piranha.hp = mobStats(piranha).ht;
    mobs.push(piranha);
  }
  // HallsLevel.initRooms: every level of the demon halls has its DemonSpawnerRoom, a demon spawner in its middle.
  // SEAM(levels): the room itself; until it is in, the middle of a standard room away from the stairs stands in.
  const spawnerAt = level.demonSpawner ?? (level.depth > 20 && level.depth < 25 ? spawnerRoomCell(level, rng) : undefined);
  if (spawnerAt !== undefined && spawnerAt !== -1) mobs.push(createMob(nextMobId(world), 'spawner', spawnerAt, 'passive', 0));
  const taken = (cell: number): boolean => mobs.some((mob) => mob.pos === cell);
  for (const mob of createMobs(world, level, rng, () => nextMobId(world), taken)) {
    if (baseKind(mob.kind) === 'elemental') mob.rangedCooldown = rollRangedCooldown({ rng });
    mobs.push(mob);
  }
  return mobs;
}

/** A standard room's middle, not the entrance's nor the exit's, free and open, for a demon spawner; -1 if none. */
function spawnerRoomCell(level: Level, rng: Rng): number {
  const inside = (room: RoomInfo, cell: number): boolean =>
    cellX(cell) > room.left && cellX(cell) < room.right && cellY(cell) > room.top && cellY(cell) < room.bottom;
  const rooms = level.rooms.filter((room) => room.type === RoomType.STANDARD && !inside(room, level.entrance) && !inside(room, level.exit));
  const room = rng.element(rooms);
  if (!room) return -1;
  const cell = Math.trunc((room.left + room.right) / 2) + Math.trunc((room.top + room.bottom) / 2) * WIDTH;
  return isPassable(level, cell) && !hasFlag(level.map[cell]!, F.AVOID) ? cell : -1;
}

/**
 * Statue.random: still as stone until struck, holding an enchanted weapon that is no worse than plain; one in ten
 * an armoured statue, in enchanted armour too (and twice as sturdy).
 */
function animatedStatue(world: World, level: Level, rng: Rng): Mob {
  const armored = rng.float() < Math.min(0.1 * exoticChanceMultiplier(world), (0.1 * exoticChanceMultiplier(world) + 0.1) / 2);
  // Statue.createWeapon: a weapon of the run's decks (Generator.random(WEAPON)), uncursed and enchanted, known through
  // and through.
  const weapon = randomWeapon(rng, level.depth, world.run);
  weapon.cursed = false;
  weapon.enchant = randomEnchantment(rng);
  identify(world, weapon);
  const statue = createMob(nextMobId(world), armored ? 'armoredStatue' : 'statue', level.statue!, 'sleeping', 0);
  statue.level = level.depth;
  statue.item = weapon;
  if (armored) {
    // ArmoredStatue.createWeapon: armour too (Generator.randomArmor), uncursed and inscribed.
    const armor = randomArmor(rng, level.depth);
    armor.cursed = false;
    armor.glyph = randomGlyph(rng);
    identify(world, armor);
    statue.armor = armor;
  }
  statue.ht = statue.hp = mobStats(statue).ht;
  return statue;
}

/**
 * A hero who joins the party after a depth was made: the depth gains the
 * monsters a party that size calls for (party.ts), asleep, out of sight.
 */
export function reinforce(world: World, level: Level, floor: Floor, rng: Rng, party: number): void {
  if (level.depth >= 26 || level.depth === LAST_SHOP_DEPTH || isBossDepth(level.depth) || level.depth <= 1) return;
  const base = 3 + (level.depth % 5) + rng.int(3);
  const extra = mobCount(base, party) - mobCount(base, party - 1);
  const ctx = { world, depth: level.depth, level, floor, rng, effects: [] } as Ctx;
  const seen = heroesOn(world, level.depth).map((hero) => castShadow(hero.pos, terrainBlocksSight(level.map), 8));
  for (let i = 0; i < extra; i++) {
    const mob = dealMob(world, level, rng, nextMobId(world), -1, floor.now);
    const pos = respawnCell(ctx, mob, (cell) => seen.some((fov) => fov[cell]));
    if (pos === -1) break;
    mob.pos = pos;
    floor.mobs.push(mob);
  }
}

