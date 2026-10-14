import { type Hero, heroDefenseSkill, heroRings, heroStealth, isAlive, type Mob, MOBS } from './actors';
import { getStep } from './ai';
import { attack, charArmor, hurt } from './combat';
import { ballistica, MAGIC_BOLT, PF_NEIGHBOURS8, STOP_TARGET, subPath } from './cone';
import { charAt, type Ctx, enterCell, heroesOn, isHero, isPassable, isWater, leaveCell } from './floor';
import { castShadow, terrainBlocksSight, viewDistance } from './fov';
import { seedGas } from './gas';
import { identify, isIdentified } from './ident';
import { createItem } from './items';
import { atan2 } from './level/gen/trig';
import { adjacent, cellX, cellY, distance, LENGTH } from './level/geometry';
import { F, hasFlag } from './level/terrain';
import { mobConditions, mobPress } from './traps';
import { bossAct, bossDied } from './vaultboss';
import { isVault, VAULT_NPCS, vaultNpcAct, vaultUnseal } from './vault';

/*
 * The dwarven vault's guards (actors/mobs/quest/vault): Shattered's skeleton, DM-100, DM-200, ghoul,
 * golem, gnoll shaman and elementals, sharper and tougher, worth no experience but a dwarf token each,
 * and stealthy (Mob.activateSteathGameplayBehaviour): asleep, they hardly notice anyone past two cells;
 * wandering, they walk set rounds and see best ahead of them; glimpsing a hero, they first go and look
 * (INVESTIGATING) before they hunt. SEAM(mobs): their kinds' own talents are as close as this port's
 * monsters allow (the mobs stream ports the base kinds): the DM-100's and the shaman's bolts, the
 * elementals' ranged spells and touches, the DM-200's gas vent and the golem's pull are here; the shaman's
 * vulnerability and hex, the frost's chill and the golem's self-teleport are not.
 */

const TICK = 1;
const f32 = Math.fround;
const G2R = f32(Math.PI / 180);

/** The vault's monsters (not its fixtures). */
export const isVaultMonster = (mob: Mob): boolean => mob.kind.startsWith('vault') && !VAULT_NPCS.has(mob.kind);

const isElemental = (mob: Mob): boolean =>
  mob.kind === 'vaultFireElemental' || mob.kind === 'vaultFrostElemental' || mob.kind === 'vaultShockElemental';

/** A vault character's turn: the fixtures, the greater elemental, or a guard. */
export function vaultMobAct(ctx: Ctx, mob: Mob): void {
  if (VAULT_NPCS.has(mob.kind)) {
    vaultNpcAct(ctx, mob);
    return;
  }
  if (mob.kind === 'vaultBossElemental') {
    bossAct(ctx, mob);
    return;
  }
  guardAct(ctx, mob);
}

function spend(mob: Mob, time: number): void {
  mob.time += (mob.slowed ?? 0) > 0 ? time * 2 : time;
}

/** Mob.chooseEnemy, for one party: the hero it is after if still in sight, else the nearest in sight, else the one it had. */
function chooseEnemy(ctx: Ctx, mob: Mob, fov: boolean[]): Hero | undefined {
  const heroes = heroesOn(ctx.world, ctx.depth);
  const current = heroes.find((h) => h.id === mob.enemy);
  if (current && fov[current.pos] && current.invisible <= 0) return current;
  let chosen: Hero | undefined;
  for (const hero of heroes) {
    if (hero.invisible > 0 || !fov[hero.pos]) continue;
    if (!chosen || distance(mob.pos, hero.pos) < distance(mob.pos, chosen.pos)) chosen = hero;
  }
  chosen ??= current ?? heroes[0];
  mob.enemy = chosen?.id ?? null;
  return chosen;
}

/** Mob.act for a vault guard, through the stealth gameplay's states. */
function guardAct(ctx: Ctx, mob: Mob): void {
  const v = (mob.vault ??= { stealth: true });
  if (mob.state === 'hunting' && isElemental(mob)) v.rangedCooldown = (v.rangedCooldown ?? 0) - 1;
  if (mob.kind === 'vaultDM200') v.ventCooldown = (v.ventCooldown ?? 0) - 1;
  if (mob.kind === 'vaultGolem') {
    v.selfTeleCooldown = (v.selfTeleCooldown ?? 0) - 1;
    v.enemyTeleCooldown = (v.enemyTeleCooldown ?? 0) - 1;
  }
  // Elemental.add: fire feeds no fire elemental; it hurts a frost elemental badly (half its health or more).
  if ((mob.burning ?? 0) > 0 && mob.kind === 'vaultFireElemental') mob.burning = 0;
  if ((mob.burning ?? 0) > 0 && mob.kind === 'vaultFrostElemental') {
    mob.burning = 0;
    const damage = ctx.rng.normalIntRange(Math.trunc(mob.ht / 2), Math.trunc((mob.ht * 3) / 5));
    ctx.effects.push({ type: 'hurt', depth: ctx.depth, who: mob.id, damage });
    hurt(ctx, mob, damage, 'burning');
    if (!isAlive(mob)) return;
  }
  if (mobConditions(ctx, mob)) {
    spend(mob, TICK);
    return;
  }
  // VaultGhoul.act: drawn to where a ghoul nearby is looking or hunting, as partners share their foes.
  if (mob.kind === 'vaultGhoul' && (mob.state === 'wandering' || mob.state === 'sleeping')) {
    const other = ctx.floor.mobs.find((m) => m !== mob && m.kind === 'vaultGhoul' && distance(mob.pos, m.pos) < 4 &&
      (m.state === 'investigating' || m.state === 'hunting'));
    if (other) {
      mob.state = 'wandering';
      mob.target = other.pos;
    }
  }
  const justAlerted = mob.alerted;
  mob.alerted = false;
  const fov = castShadow(mob.pos, terrainBlocksSight(ctx.level.map), viewDistance(ctx.depth));
  const enemy = chooseEnemy(ctx, mob, fov);
  const enemyInFOV = enemy !== undefined && isAlive(enemy) && fov[enemy.pos] === true && enemy.invisible <= 0;

  switch (mob.state) {
    case 'sleeping':
      sleeping(ctx, mob, enemy, enemyInFOV);
      return;
    case 'wandering':
      wandering(ctx, mob, enemy, enemyInFOV, justAlerted, fov);
      return;
    case 'investigating':
      investigating(ctx, mob, enemy, enemyInFOV, justAlerted, fov);
      return;
    case 'fleeing':
    case 'passive':
      spend(mob, TICK);
      return;
    case 'hunting':
      hunting(ctx, mob, enemy, enemyInFOV, fov);
  }
}

/* Detection (Mob's detectionChance, in the stealth gameplay's versions) */

/** StealthGameplaySleeping: one in (distance + stealth)², nothing under 10% (from four cells or so). */
function sleepingChance(mob: Mob, hero: Hero): number {
  const d = distance(mob.pos, hero.pos) + heroStealth(hero);
  const chance = f32(1 / f32(d * d));
  return chance < f32(0.1) ? 0 : chance;
}

/** PointF.angle between two cells, in degrees. */
const angleDeg = (from: number, to: number): number => f32(f32(atan2(cellY(to) - cellY(from), cellX(to) - cellX(from))) / G2R);

/**
 * StealthGameplayWandering: seeing best the way it walks. Within a 75° cone ahead and six cells, as a
 * wandering monster usually does (one in distance/2 + stealth); within 150°, as a sleeping one (one in
 * distance + stealth); behind it, hardly (one in (distance + stealth)³, nothing under 10%). Standing (or
 * having just turned on the spot), as a sleeping one.
 */
function wanderingChance(mob: Mob, hero: Hero): number {
  const prev = mob.vault?.previousPos ?? mob.pos;
  const d = distance(mob.pos, hero.pos);
  const stealth = heroStealth(hero);
  if (!adjacent(mob.pos, prev)) return f32(1 / (d + stealth));
  const movementDir = angleDeg(prev, mob.pos);
  const enemyDir = angleDeg(mob.pos, hero.pos);
  const diff = Math.abs(f32(enemyDir - movementDir));
  if (diff <= 37.5 && d <= 6) return f32(1 / f32(f32(d / 2) + stealth));
  if (diff <= 75) return f32(1 / (d + stealth));
  const s = d + stealth;
  const chance = f32(1 / f32(s * s * s));
  return chance < f32(0.1) ? 0 : chance;
}

/** StealthGameplayInvestigating: as wandering usually does, but less on the first turn it sees someone. */
function investigatingChance(mob: Mob, hero: Hero): number {
  let chance = f32(1 / f32(f32(distance(mob.pos, hero.pos) / 2) + heroStealth(hero)));
  if ((mob.vault?.investigatingTurns ?? 0) === 1 && chance <= 1) chance = f32(chance - f32(0.33));
  return chance;
}

/* The states */

/** It caught sight of someone: it goes to look (INVESTIGATING), and the hero knows. */
function startInvestigating(ctx: Ctx, mob: Mob, enemy: Hero): void {
  mob.enemySeen = true;
  mob.state = 'investigating';
  mob.target = enemy.pos;
  mob.vault!.investigatingTurns = 0;
  ctx.effects.push({ type: 'investigating', depth: ctx.depth, mob: mob.id });
}

/** StealthGameplaySleeping.act: the least stealthy hero in sight may wake it; then it investigates, or wanders. */
function sleeping(ctx: Ctx, mob: Mob, enemy: Hero | undefined, enemyInFOV: boolean): void {
  mob.vault!.wanderPositions ??= [mob.pos];
  if (enemyInFOV || (enemy && enemy.invisible > 0)) {
    const fov = castShadow(mob.pos, terrainBlocksSight(ctx.level.map), viewDistance(ctx.depth));
    let best = 0;
    let closest: Hero | undefined;
    for (const hero of heroesOn(ctx.world, ctx.depth)) {
      if (!fov[hero.pos] || hero.invisible > 0) continue;
      const chance = sleepingChance(mob, hero);
      if (!closest || chance > best) {
        best = chance;
        closest = hero;
      }
    }
    if (closest && ctx.rng.float() < sleepingChance(mob, closest)) {
      // Sleeping.awaken, and then the stealth gameplay's: hunting becomes investigating.
      if (enemyInFOV && enemy) {
        startInvestigating(ctx, mob, enemy);
      } else {
        mob.state = 'wandering';
        mob.target = randomDestination(mob);
      }
      spend(mob, 1);
      return;
    }
  }
  mob.enemySeen = false;
  spend(mob, TICK);
}

/** StealthGameplayWandering.act: noticing someone it investigates (a turn spent); otherwise it walks its rounds. */
function wandering(ctx: Ctx, mob: Mob, enemy: Hero | undefined, enemyInFOV: boolean, justAlerted: boolean, fov: boolean[]): void {
  if (enemyInFOV && enemy && (justAlerted || ctx.rng.float() < wanderingChance(mob, enemy))) {
    startInvestigating(ctx, mob, enemy);
    spend(mob, TICK);
    return;
  }
  continueWandering(ctx, mob, fov);
}

/** Wandering.continueWandering: towards its target, or a new one. */
function continueWandering(ctx: Ctx, mob: Mob, fov: boolean[]): void {
  mob.enemySeen = false;
  if (mob.target !== -1 && getCloser(ctx, mob, mob.target, fov)) {
    spend(mob, 1 / MOBS[mob.kind].speed);
  } else {
    mob.target = randomDestination(mob);
    spend(mob, TICK);
  }
}

/** StealthGameplayInvestigating.act: after whom it saw; lost before reaching where they were, it goes back to its rounds. */
function investigating(ctx: Ctx, mob: Mob, enemy: Hero | undefined, enemyInFOV: boolean, justAlerted: boolean, fov: boolean[]): void {
  const v = mob.vault!;
  v.investigatingTurns = enemyInFOV ? (v.investigatingTurns ?? 0) + 1 : 0;
  if (enemyInFOV && enemy) {
    mob.target = enemy.pos;
  } else if (distance(mob.pos, mob.target) <= 1) {
    mob.state = 'wandering';
    mob.target = randomDestination(mob);
    spend(mob, TICK);
    return;
  }
  if (enemyInFOV && enemy && (justAlerted || ctx.rng.float() < investigatingChance(mob, enemy))) {
    // Wandering.noticeEnemy: it hunts, and acts again at once.
    mob.enemySeen = true;
    mob.state = 'hunting';
    mob.target = enemy.pos;
    ctx.effects.push({ type: 'noticed', depth: ctx.depth, mob: mob.id });
    hunting(ctx, mob, enemy, enemyInFOV, fov);
    return;
  }
  continueWandering(ctx, mob, fov);
}

/** Mob.Hunting.act: at its enemy if it can, after them otherwise; lost, back to its rounds. */
function hunting(ctx: Ctx, mob: Mob, enemy: Hero | undefined, enemyInFOV: boolean, fov: boolean[]): void {
  mob.enemySeen = enemyInFOV;
  if (enemyInFOV && enemy && canAttack(ctx, mob, enemy)) {
    mob.target = enemy.pos;
    doAttack(ctx, mob, enemy);
    return;
  }
  if (enemyInFOV && enemy) {
    mob.target = enemy.pos;
    // DM200 and Golem: now and then, from afar, the gas vent or the pull (always, when it cannot get closer).
    if ((mob.kind === 'vaultDM200' || mob.kind === 'vaultGolem') && special(ctx, mob, enemy, fov)) return;
  } else if (!enemy) {
    mob.state = 'wandering';
    mob.target = randomDestination(mob);
    spend(mob, TICK);
    return;
  }
  if (mob.target !== -1 && getCloser(ctx, mob, mob.target, fov)) {
    spend(mob, 1 / MOBS[mob.kind].speed);
    return;
  }
  spend(mob, TICK);
  if (!enemyInFOV) {
    mob.state = 'wandering';
    mob.target = randomDestination(mob);
  }
}

/** The DM-200's vent and the golem's pull, while hunting someone it cannot strike. */
function special(ctx: Ctx, mob: Mob, enemy: Hero, fov: boolean[]): boolean {
  const v = mob.vault!;
  const dist = distance(mob.pos, enemy.pos);
  const ready = mob.kind === 'vaultDM200' ? (v.ventCooldown ?? 0) <= 0 : (v.enemyTeleCooldown ?? 0) <= 0;
  const can = ready && reachableAround(ctx, mob.pos, enemy.pos);
  const now = dist >= 1 && ctx.rng.int(Math.trunc(100 / dist)) === 0 && can;
  if (now) {
    fire(ctx, mob, enemy);
    return true;
  }
  if (getCloser(ctx, mob, enemy.pos, fov)) {
    spend(mob, 1 / MOBS[mob.kind].speed);
    return true;
  }
  if (can) {
    fire(ctx, mob, enemy);
    return true;
  }
  return false;
}

/** DM200.canVent and Golem.canTele: the way can go round what blocks, but not through it, in about as many steps. */
function reachableAround(ctx: Ctx, from: number, to: number): boolean {
  const limit = distance(from, to) + 1;
  const dist = new Map<number, number>([[to, 0]]);
  const queue = [to];
  for (let head = 0; head < queue.length; head++) {
    const cell = queue[head]!;
    if (cell === from) return true;
    const d = dist.get(cell)!;
    if (d >= limit) continue;
    for (const n of PF_NEIGHBOURS8) {
      const next = cell + n;
      if (next < 0 || next >= LENGTH || dist.has(next) || !adjacent(cell, next) || hasFlag(ctx.level.map[next]!, F.SOLID)) continue;
      dist.set(next, d + 1);
      queue.push(next);
    }
  }
  return false;
}

/** DM200.zap (a trail of toxic gas, and a cloud on the enemy) or Golem.teleportEnemy (the enemy pulled to it). */
function fire(ctx: Ctx, mob: Mob, enemy: Hero): void {
  spend(mob, TICK);
  const v = mob.vault!;
  if (mob.kind === 'vaultDM200') {
    v.ventCooldown = 30;
    const occupied = (cell: number): boolean => charAt(ctx.world, ctx.depth, cell) !== undefined;
    const trail = ballistica(ctx.level, occupied, mob.pos, enemy.pos, STOP_TARGET);
    for (const cell of subPath(trail, 0, trail.dist)) seedGas(ctx, cell, 'toxic', 20);
    seedGas(ctx, trail.collisionPos, 'toxic', 100);
    ctx.effects.push({ type: 'zapped', depth: ctx.depth, from: mob.pos, to: enemy.pos, bolt: 'poison' });
    return;
  }
  let best = enemy.pos;
  const trueDist = (a: number, b: number): number => {
    const dx = cellX(a) - cellX(b);
    const dy = cellY(a) - cellY(b);
    return Math.sqrt(dx * dx + dy * dy);
  };
  for (const n of PF_NEIGHBOURS8) {
    const cell = mob.pos + n;
    if (isPassable(ctx.level, cell) && !charAt(ctx.world, ctx.depth, cell) && trueDist(cell, enemy.pos) > trueDist(best, enemy.pos)) best = cell;
  }
  if (best !== enemy.pos) {
    const from = enemy.pos;
    leaveCell(ctx.world, ctx.level, ctx.depth, from);
    enemy.pos = best;
    enterCell(ctx.level, best);
    ctx.effects.push({ type: 'knockedBack', depth: ctx.depth, hero: enemy.id, from, to: best });
    ctx.effects.push({ type: 'interrupted', hero: enemy.id, reason: 'vault' });
  }
  v.enemyTeleCooldown = 20;
}

/* Wandering rounds and steps */

/** StealthGameplayWandering.randomDestination: the next of its set spots once it stands on one (or stays, looking about). */
function randomDestination(mob: Mob): number {
  const v = (mob.vault ??= { stealth: true });
  if (!v.wanderPositions || v.wanderPositions.length === 0) v.wanderPositions = [mob.pos];
  let idx = v.wanderPosIdx ?? 0;
  let wanderPos = v.wanderPositions[idx]!;
  if (wanderPos === mob.pos) {
    if (v.wanderPositions.length > 1) {
      idx = (idx + 1) % v.wanderPositions.length;
      wanderPos = v.wanderPositions[idx]!;
    } else {
      // Looking about where it stands.
      v.previousPos = mob.pos;
    }
  }
  v.wanderPosIdx = idx;
  return wanderPos;
}

const flying = (mob: Mob): boolean => MOBS[mob.kind].flying === true;

/** Mob.getCloser: the next step, round the characters it can see; a flier over traps too. */
function getCloser(ctx: Ctx, mob: Mob, target: number, fov: boolean[]): boolean {
  if ((mob.rooted ?? 0) > 0 || target === mob.pos) return false;
  const stand = (cell: number): boolean =>
    isPassable(ctx.level, cell) || (flying(mob) && cell >= 0 && cell < LENGTH && hasFlag(ctx.level.map[cell]!, F.AVOID));
  let step: number;
  if (adjacent(mob.pos, target)) {
    step = !charAt(ctx.world, ctx.depth, target) && stand(target) ? target : -1;
  } else {
    step = getStep(mob.pos, target, (cell) => stand(cell) && !(fov[cell] && charAt(ctx.world, ctx.depth, cell)));
  }
  if (step === -1 || charAt(ctx.world, ctx.depth, step)) return false;
  move(ctx, mob, step);
  return true;
}

/** Char.move: where it stood is remembered (which way it faces); it presses the cell it comes to, unless it flies. */
function move(ctx: Ctx, mob: Mob, to: number): void {
  if ((mob.crippled ?? 0) > 0) mob.time += 1 / MOBS[mob.kind].speed;
  mob.vault!.previousPos = mob.pos;
  const from = mob.pos;
  mob.pos = to;
  leaveCell(ctx.world, ctx.level, ctx.depth, from);
  enterCell(ctx.level, to);
  if (!flying(mob)) mobPress(ctx, mob);
}

/* Fighting */

/** A magic bolt reaches its enemy (Ballistica.MAGIC_BOLT's collision is where they stand). */
function boltReaches(ctx: Ctx, mob: Mob, enemy: Hero): boolean {
  const occupied = (cell: number): boolean => charAt(ctx.world, ctx.depth, cell) !== undefined;
  return ballistica(ctx.level, occupied, mob.pos, enemy.pos, MAGIC_BOLT).collisionPos === enemy.pos;
}

/** Mob.canAttack, and the ranged kinds': the DM-100 and the shaman by bolt, the elementals once their spell is ready. */
function canAttack(ctx: Ctx, mob: Mob, enemy: Hero): boolean {
  if (adjacent(mob.pos, enemy.pos)) return true;
  if (mob.kind === 'vaultDM100' || mob.kind === 'vaultShaman') return boltReaches(ctx, mob, enemy);
  if (isElemental(mob)) return (mob.vault?.rangedCooldown ?? 0) < 0 && boltReaches(ctx, mob, enemy);
  return false;
}

/** Char.hit with magic: the accuracy roll counts double. */
const magicHit = (ctx: Ctx, mob: Mob, enemy: Hero): boolean =>
  f32(ctx.rng.floatMax(MOBS[mob.kind].attack) * 2) >= ctx.rng.floatMax(heroDefenseSkill(enemy));

/** Burning.reignite with Burning.DURATION, or a given duration. */
const ignite = (hero: Hero, turns = 8): void => {
  hero.burning = Math.max(hero.burning, turns);
};
/** Freezing.freeze: Frost holds the hero (SEAM(buffs): paralysis stands in, briefly, as frost breaks on a blow). */
const freeze = (hero: Hero): void => {
  hero.paralysed = Math.max(hero.paralysed, 2);
};

function doAttack(ctx: Ctx, mob: Mob, enemy: Hero): void {
  const v = mob.vault!;
  const near = adjacent(mob.pos, enemy.pos);
  if (!near && (mob.kind === 'vaultDM100' || mob.kind === 'vaultShaman') && boltReaches(ctx, mob, enemy)) {
    // DM100.doAttack and Shaman.zap: a bolt.
    spend(mob, TICK);
    ctx.effects.push({ type: 'zapped', depth: ctx.depth, from: mob.pos, to: enemy.pos, bolt: mob.kind === 'vaultDM100' ? 'lightning' : 'magic' });
    if (!magicHit(ctx, mob, enemy)) {
      ctx.effects.push({ type: 'attack', depth: ctx.depth, attacker: mob.id, target: enemy.id, hit: false, damage: 0 });
      return;
    }
    if (mob.kind === 'vaultShaman' && ctx.rng.int(2) === 0) {
      // VaultShaman.debuff: weakness (SEAM(buffs): vulnerability and hex are not here yet).
      const type = v.shamanType ?? 0;
      if (type <= 1) {
        if (enemy.weakened <= 0) ctx.effects.push({ type: 'weakened', hero: enemy.id });
        enemy.weakened = Math.max(enemy.weakened, 20);
      }
    }
    const damage = mob.kind === 'vaultDM100' ? ctx.rng.normalIntRange(3, 10) : ctx.rng.normalIntRange(6, 15);
    ctx.effects.push({ type: 'attack', depth: ctx.depth, attacker: mob.id, target: enemy.id, hit: true, damage });
    hurt(ctx, enemy, damage, mob);
    return;
  }
  if (isElemental(mob) && !near && (v.rangedCooldown ?? 0) <= 0 && boltReaches(ctx, mob, enemy)) {
    // Elemental.zap: its spell, which may miss.
    spend(mob, TICK);
    ctx.effects.push({ type: 'zapped', depth: ctx.depth, from: mob.pos, to: enemy.pos, bolt: mob.kind === 'vaultFireElemental' ? 'fire' : mob.kind === 'vaultShockElemental' ? 'lightning' : 'magic' });
    if (magicHit(ctx, mob, enemy)) {
      if (mob.kind === 'vaultFireElemental' && !isWater(ctx.level.map[enemy.pos]!)) ignite(enemy, 4);
      if (mob.kind === 'vaultFrostElemental') freeze(enemy);
      if (mob.kind === 'vaultShockElemental') enemy.blind = Math.max(enemy.blind ?? 0, 5);
    } else {
      ctx.effects.push({ type: 'attack', depth: ctx.depth, attacker: mob.id, target: enemy.id, hit: false, damage: 0 });
    }
    v.rangedCooldown = ctx.rng.normalIntRange(3, 5);
    return;
  }
  const before = enemy.hp;
  const hit = attack(ctx, mob, enemy);
  spend(mob, TICK);
  if (!hit || !isAlive(enemy)) return;
  // Elemental.meleeProc.
  if (mob.kind === 'vaultFireElemental' && ctx.rng.int(2) === 0 && !isWater(ctx.level.map[enemy.pos]!)) ignite(enemy);
  if (mob.kind === 'vaultFrostElemental' && (ctx.rng.int(3) === 0 || isWater(ctx.level.map[enemy.pos]!))) freeze(enemy);
  if (mob.kind === 'vaultShockElemental' && isWater(ctx.level.map[enemy.pos]!)) {
    // Shocking.arc: the one struck takes 40% more, standing in water.
    const damage = Math.round(f32((before - enemy.hp) * f32(0.4)));
    if (damage > 0) {
      ctx.effects.push({ type: 'hurt', depth: ctx.depth, who: enemy.id, damage });
      hurt(ctx, enemy, damage, mob);
    }
  }
}

/* Death */

/**
 * Mob.die in the vault: a guard drops its dwarf token (lootChance 1) unless the hero has outgrown it (the
 * many-enemy room's ghouls, maxLvl 0); worn rings come a fifth nearer to being known (they gain no
 * experience here); the dwarven skeleton bursts; the greater elemental's fall opens the final room.
 */
export function vaultMobDied(ctx: Ctx, mob: Mob): void {
  if (!isVaultMonster(mob)) return;
  if (mob.kind === 'vaultBossElemental') {
    bossDied(ctx, mob);
    vaultUnseal(ctx);
    return;
  }
  const heroes = heroesOn(ctx.world, ctx.depth);
  const maxLvl = mob.vault?.maxLvl ?? MOBS[mob.kind].maxLvl;
  if (heroes.some((h) => h.lvl <= maxLvl + 2) && ctx.rng.float() < 1) {
    const heap = ctx.floor.heaps.find((h) => h.pos === mob.pos);
    if (heap) heap.items.unshift(createItem('quest.token'));
    else ctx.floor.heaps.push({ pos: mob.pos, kind: 'heap', items: [createItem('quest.token')] });
  }
  if (isVault(ctx.level)) {
    for (const hero of heroes) {
      for (const ring of heroRings(hero)) {
        if (isIdentified(ctx.world, ring)) continue;
        ring.levelsToID = f32((ring.levelsToID ?? 1) - f32(0.2));
        if (ring.levelsToID <= 0.0001) {
          const learned = identify(ctx.world, ring);
          ctx.effects.push({ type: 'familiar', hero: hero.id, item: ring, learned });
        }
      }
    }
  }
  if (mob.kind === 'vaultSkeleton') burst(ctx, mob);
}

/** Skeleton.die: its bones fly apart, 6-12 to everyone around, less two rolls of their armour. */
function burst(ctx: Ctx, skeleton: Mob): void {
  ctx.effects.push({ type: 'bones', depth: ctx.depth, pos: skeleton.pos });
  for (const n of PF_NEIGHBOURS8) {
    const victim = charAt(ctx.world, ctx.depth, skeleton.pos + n);
    if (!victim || !isAlive(victim)) continue;
    let damage = ctx.rng.normalIntRange(6, 12);
    damage = Math.max(0, damage - (ctx.rng.intRange(0, charArmor(victim)) + ctx.rng.intRange(0, charArmor(victim))));
    ctx.effects.push({ type: 'hurt', depth: ctx.depth, who: victim.id, damage });
    hurt(ctx, victim, damage, isHero(victim) ? 'bones' : skeleton);
  }
}

