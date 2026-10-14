import { beckon, type Hero, heroDefenseSkill, isAlive, type Mob, type MobKind, MOBS } from './actors';
import { chooseEnemy, mobSight, notice, randomRespawnCell, spend, TIME_TO_RESPAWN } from './ai';
import { beatBlacksmithBoss, pickaxeDamage, pickaxeOf } from './blacksmith';
import { attack, hurt, mobDied } from './combat';
import { castShadow, terrainBlocksSight } from './fov';
import { type Char, charAt, type Ctx, dropItem, enterCell, heroesOn, heroSight, isHero, leaveCell } from './floor';
import { createItem } from './items';
import type { Level } from './level/generate';
import { distance, LENGTH, WIDTH } from './level/geometry';
import { F, hasFlag, T } from './level/terrain';
import { questScore } from './score';
import { mobConditions, mobPress, trapAt, triggerTrap } from './traps';
import { mobCount, partySize, respawnTime, scaleMob } from './party';
import type { MineMobState } from './mine-types';

/*
 * The monsters of the troll blacksmith's mine (actors/mobs): the crystal quest's wisps (they drift
 * through crystal and shoot beams of light), guardians (each in its crystal cell; knocked down, they
 * mend instead of dying) and the crystal spire (hurt only by the pickaxe, it calls the guardians and
 * sends spikes of crystal at the hero); the gnoll quest's guards (spears that reach two cells, armoured
 * by a sapper near), sappers (they throw boulders and bring rocks down) and the gnoll geomancer (asleep
 * under rock armour until the pickaxe wakes it, then dashing through the rock, throwing boulders and
 * calling down rockfalls); the fungi (a rooted sentry, spinners at home in the grass, the core). Hooked
 * into ai.ts and combat.ts with a line each.
 */

const f32 = Math.fround;
const TICK = 1;
const W = WIDTH;
/** PathFinder.NEIGHBOURS4, NEIGHBOURS8 and NEIGHBOURS9 in Shattered's order (the order decides ties and draws). */
const N4 = [-W, -1, +1, +W];
const N8 = [-W - 1, -W, -W + 1, -1, +1, +W - 1, +W, +W + 1];
const N9 = [-W - 1, -W, -W + 1, -1, 0, +1, +W - 1, +W, +W + 1];

/** What a monster's state shows the client of the mine (sprites, sounds, the log). */
export type MineEventKind =
  /** CrystalSpire: a pickaxe blow (`amount`), its warning (first blow), its alarm (third), its shattering; its spikes. */
  | 'spireHit' | 'spireWarning' | 'spireAlert' | 'spireShattered' | 'spikes'
  /** Cells something is about to strike (GameScene.targetedCell): spikes, a thrown boulder's path. */
  | 'targeted'
  /** CrystalGuardian: knocked down, mending (`amount`), back up; it breaks a crystal underfoot. */
  | 'crumple' | 'mend' | 'rise' | 'shatter'
  /** Char.isInvulnerable: the blow does nothing. */
  | 'immune'
  /** A boulder thrown (from, to); rocks about to fall (cells); falling. */
  | 'rockThrow' | 'rockfallWarning' | 'rockfall'
  /** GnollGeomancer: a pickaxe blow on its armour (`amount`), its warning, its waking; its armour gone; its dash. */
  | 'geoHit' | 'geoWarning' | 'geoAlert' | 'armorBroken' | 'dash'
  /** GnollGuard.attackProc: a hard blow from its spear's reach (`hero`). */
  | 'spearWarn';

const st = (mob: Mob): MineMobState => (mob.mine ??= {});

const isMineKind = (kind: MobKind): boolean =>
  kind === 'crystalWisp' || kind === 'crystalGuardian' || kind === 'crystalSpire' || kind === 'gnollGuard' || kind === 'gnollSapper' ||
  kind === 'gnollGeomancer' || kind === 'fungalSentry' || kind === 'fungalSpinner' || kind === 'fungalCore';

/* The level, as Shattered's flag maps see it */

const solidAt = (level: Level, cell: number): boolean => cell >= 0 && cell < LENGTH && hasFlag(level.map[cell]!, F.SOLID);
const passableAt = (level: Level, cell: number): boolean => cell >= 0 && cell < LENGTH && hasFlag(level.map[cell]!, F.PASSABLE);
const avoidAt = (level: Level, cell: number): boolean => cell >= 0 && cell < LENGTH && hasFlag(level.map[cell]!, F.AVOID);

/** Level.insideMap: within the level's own border. */
function insideMap(level: Level, cell: number): boolean {
  const x = cell % W;
  const y = Math.trunc(cell / W);
  return cell >= 0 && x >= 1 && y >= 1 && x < (level.width ?? W) - 1 && y < (level.height ?? W) - 1;
}

/** Level.trueDistance. */
function trueDistance(a: number, b: number): number {
  const dx = (a % W) - (b % W);
  const dy = Math.trunc(a / W) - Math.trunc(b / W);
  return f32(Math.sqrt(dx * dx + dy * dy));
}

/** Level.adjacent. */
const adjacent = (a: number, b: number): boolean => distance(a, b) === 1;

/** GameMath.gate. */
const gate = (min: number, value: number, max: number): number => (value <= min ? min : value >= max ? max : value);

/** Level.openSpace: not solid, with an open corner whose two sides are open too. */
function openSpace(level: Level, cell: number): boolean {
  if (solidAt(level, cell)) return false;
  const c = [-W - 1, -W, -W + 1, +1, +W + 1, +W, +W - 1, -1];
  for (let j = 1; j < c.length; j += 2) {
    if (solidAt(level, cell + c[j]!)) return false;
    if (!solidAt(level, cell + c[(j + 1) % 8]!) && !solidAt(level, cell + c[(j + 2) % 8]!)) return true;
  }
  return false;
}

/** Integer.MAX_VALUE: no way there. */
const UNREACHABLE = 2147483647;

/** PathFinder.buildDistanceMap (8 ways): steps from `from` over `passable`; UNREACHABLE for none. */
function distanceMap(from: number, passable: (cell: number) => boolean): Int32Array {
  const dist = new Int32Array(LENGTH).fill(UNREACHABLE);
  dist[from] = 0;
  const queue = [from];
  for (let head = 0; head < queue.length; head++) {
    const cell = queue[head]!;
    for (const n of N8) {
      const next = cell + n;
      if (next < 0 || next >= LENGTH || dist[next]! <= dist[cell]! + 1 || !adjacent(cell, next) || !passable(next)) continue;
      dist[next] = dist[cell]! + 1;
      queue.push(next);
    }
  }
  return dist;
}

/* Ballistica */

const STOP_TARGET = 1;
const STOP_CHARS = 2;
const STOP_SOLID = 4;
const PROJECTILE = STOP_TARGET | STOP_CHARS | STOP_SOLID;
const MAGIC_BOLT = STOP_CHARS | STOP_SOLID;
const WONT_STOP = 0;

interface Path {
  path: number[];
  sourcePos: number;
  collisionPos: number;
  dist: number;
}

/** mechanics/Ballistica: the full path from `from` past `to` to the map's edge, and where it collides. */
function ballistica(ctx: Ctx, from: number, to: number, params: number): Path {
  const { level, world, depth } = ctx;
  const stopTarget = (params & STOP_TARGET) > 0;
  const stopChars = (params & STOP_CHARS) > 0;
  const stopTerrain = (params & STOP_SOLID) > 0;
  const path: number[] = [];
  let collision: number | null = null;
  const collide = (cell: number): void => {
    if (collision === null) collision = cell;
  };
  const x0 = from % W;
  const x1 = to % W;
  const y0 = Math.trunc(from / W);
  const y1 = Math.trunc(to / W);
  let dx = x1 - x0;
  let dy = y1 - y0;
  const stepX = dx > 0 ? +1 : -1;
  const stepY = dy > 0 ? +1 : -1;
  dx = Math.abs(dx);
  dy = Math.abs(dy);
  const [stepA, stepB, dA, dB] = dx > dy ? [stepX, stepY * W, dx, dy] : [stepY * W, stepX, dy, dx];
  let cell = from;
  let err = Math.trunc(dA / 2);
  while (insideMap(level, cell)) {
    if (collision === null && stopTerrain && cell !== from && !passableAt(level, cell) && !avoidAt(level, cell) && !charAt(world, depth, cell)) {
      collide(path[path.length - 1]!);
    }
    path.push(cell);
    if (collision === null && stopTerrain && cell !== from && solidAt(level, cell)) collide(cell);
    if (collision === null && cell !== from && stopChars && charAt(world, depth, cell)) collide(cell);
    if (collision === null && cell === to && stopTarget) collide(cell);
    cell += stepA;
    err += dB;
    if (err >= dA) {
      err -= dA;
      cell += stepB;
    }
  }
  if (collision !== null) return { path, sourcePos: from, collisionPos: collision, dist: path.indexOf(collision) };
  if (path.length > 0) return { path, sourcePos: from, collisionPos: path[path.length - 1]!, dist: path.length - 1 };
  return { path: [from], sourcePos: from, collisionPos: from, dist: 0 };
}

/** Ballistica.subPath(start, end), inclusive. */
const subPath = (b: Path, start: number, end: number): number[] => b.path.slice(start, Math.min(end, b.path.length - 1) + 1);

/* Who is who */

const findMob = (ctx: Ctx, id: string | undefined): Mob | undefined =>
  id === undefined ? undefined : ctx.floor.mobs.find((m) => m.id === id && isAlive(m));

/** GnollGuard and GnollGeomancer.hasSapper: their sapper alive. */
export function hasSapper(ctx: Ctx, mob: Mob): boolean {
  const sapper = findMob(ctx, mob.mine?.sapper);
  return sapper !== undefined && sapper.kind === 'gnollSapper';
}

/** Mob.aggro: after a hero. */
function aggro(mob: Mob, hero: Hero): void {
  mob.enemy = hero.id;
  if (mob.state !== 'passive') mob.state = 'hunting';
}

/** The hero a monster with no ally in the world is after: its enemy if still about, else the nearest (Dungeon.hero in Shattered). */
function heroFor(ctx: Ctx, mob: Mob): Hero | undefined {
  const heroes = heroesOn(ctx.world, ctx.depth);
  const current = heroes.find((h) => h.id === mob.enemy);
  if (current) return current;
  let nearest: Hero | undefined;
  for (const h of heroes) if (!nearest || distance(mob.pos, h.pos) < distance(mob.pos, nearest.pos)) nearest = h;
  return nearest;
}

/** Char.cooldown for a hero: how long until they act (at least a turn, at most three, for the warnings). */
const warningDelay = (ctx: Ctx, hero: Hero): number => gate(TICK, Math.ceil(hero.time - ctx.floor.now), 3 * TICK);

const interrupt = (ctx: Ctx, hero: Hero): void => {
  ctx.effects.push({ type: 'interrupted', hero: hero.id, reason: 'danger' });
};

/** Moves a character a cell, as Pushing and Level.occupyCell do: a monster presses where it lands, a hero sets off a trap. */
function shove(ctx: Ctx, ch: Char, to: number): void {
  const from = ch.pos;
  ch.pos = to;
  leaveCell(ctx.world, ctx.level, ctx.depth, from);
  enterCell(ctx.level, to);
  if (isHero(ch)) {
    ctx.effects.push({ type: 'knockedBack', depth: ctx.depth, hero: ch.id, from, to });
    if (trapAt(ctx.level, to) && !(ch.levitating ?? 0)) triggerTrap(ctx, ch, to);
  } else {
    ctx.effects.push({ type: 'pushed', depth: ctx.depth, mob: ch.id, from, to });
    mobPress(ctx, ch);
  }
}

const IMMOVABLE: ReadonlySet<string> = new Set(['crystalSpire', 'gnollGeomancer', 'fungalSentry', 'fungalCore', 'blacksmith', 'sentry', 'demonSpawner']);

/* The generation's links (GnollSapper.linkPartner) */

/** As the mine's monsters are made: each sapper and the guard placed beside it are partners. */
export function linkMineMobs(mobs: Mob[]): void {
  for (const sapper of mobs) {
    const at = sapper.mine?.partnerAt;
    if (sapper.kind !== 'gnollSapper' || at === undefined) continue;
    delete sapper.mine!.partnerAt;
    const guard = mobs.find((m) => m.pos === at && m.kind === 'gnollGuard');
    if (!guard) continue;
    st(sapper).partner = guard.id;
    st(guard).sapper = sapper.id;
  }
}

/** GnollSapper.losePartner: its partner loses the armour it gave. */
function losePartner(ctx: Ctx, sapper: Mob): void {
  const partner = ctx.floor.mobs.find((m) => m.id === sapper.mine?.partner);
  if (partner?.mine?.sapper === sapper.id) delete partner.mine.sapper;
  if (sapper.mine) delete sapper.mine.partner;
}

/** GnollSapper.linkPartner. */
function linkPartner(ctx: Ctx, sapper: Mob, partner: Mob): void {
  losePartner(ctx, sapper);
  st(sapper).partner = partner.id;
  st(partner).sapper = sapper.id;
}

/* Hooks from ai.ts */

/**
 * The turns the mine's monsters take their own way; false lets the ordinary monster's turn go on (wisps,
 * guards, guardians on their feet, sappers but when they see their enemy).
 */
export function mineMobAct(ctx: Ctx, mob: Mob): boolean {
  if (!isMineKind(mob.kind)) return false;
  if ((mob.mine?.hasted ?? 0) > 0) mob.mine!.hasted!--;
  switch (mob.kind) {
    case 'crystalSpire':
      spireAct(ctx, mob);
      return true;
    case 'crystalGuardian':
      if (!mob.mine?.recovering) return false;
      guardianRecover(ctx, mob);
      return true;
    case 'gnollSapper':
      return sapperAct(ctx, mob);
    case 'gnollGeomancer':
      geomancerAct(ctx, mob);
      return true;
    case 'fungalSentry':
      sentryAct(ctx, mob);
      return true;
    case 'fungalCore':
      // FungalCore: it does nothing at all but be hacked at.
      spend(mob, TICK);
      return true;
    default:
      return false;
  }
}

/** CrystalGuardian.Sleeping.awaken: it does not wake for an enemy it cannot reach; the geomancer never wakes of itself. */
export function mineMayWake(ctx: Ctx, mob: Mob, enemy: Hero): boolean {
  if (mob.kind === 'gnollGeomancer') return false;
  if (mob.kind !== 'crystalGuardian') return true;
  const dist = distanceMap(enemy.pos, (c) => passableAt(ctx.level, c));
  return dist[mob.pos] !== UNREACHABLE;
}

/** Wandering.randomDestination: a guard to its sapper, a sapper back to where it keeps. */
export function mineWanderTarget(ctx: Ctx, mob: Mob): number | undefined {
  if (mob.kind === 'gnollGuard' && hasSapper(ctx, mob)) return findMob(ctx, mob.mine!.sapper)!.pos;
  if (mob.kind === 'gnollSapper' && mob.mine?.spawnPos !== undefined) return mob.mine.spawnPos;
  return undefined;
}

/** Mob.canAttack for the mine's: undefined for the ordinary rule. */
export function mineCanAttack(ctx: Ctx, mob: Mob, enemy: Hero): boolean | undefined {
  switch (mob.kind) {
    case 'crystalWisp':
    case 'fungalSentry':
      return adjacent(mob.pos, enemy.pos) || ballistica(ctx, mob.pos, enemy.pos, MAGIC_BOLT).collisionPos === enemy.pos;
    case 'gnollGuard':
      // It cannot curve a spear's reach as the hero can: two cells, in open line both ways.
      return distance(enemy.pos, mob.pos) <= 2 && ballistica(ctx, mob.pos, enemy.pos, PROJECTILE).collisionPos === enemy.pos &&
        ballistica(ctx, enemy.pos, mob.pos, PROJECTILE).collisionPos === mob.pos;
    default:
      return undefined;
  }
}

/** Mob.doAttack for the mine's: true if done here (spent its time). */
export function mineDoAttack(ctx: Ctx, mob: Mob, enemy: Hero): boolean {
  switch (mob.kind) {
    case 'crystalWisp':
      if (adjacent(mob.pos, enemy.pos) || ballistica(ctx, mob.pos, enemy.pos, MAGIC_BOLT).collisionPos !== enemy.pos) return false;
      wispZap(ctx, mob, enemy);
      return true;
    case 'gnollGuard':
      // GnollGuard.damageRoll: the spear's reach hits hardest, up close it is clumsy.
      attack(ctx, mob, enemy, { damage: adjacent(mob.pos, enemy.pos) ? [6, 12] : [16, 22] });
      spend(mob, TICK);
      return true;
    case 'fungalSentry':
      ctx.effects.push({ type: 'zapped', depth: ctx.depth, from: mob.pos, to: enemy.pos, bolt: 'poison' });
      attack(ctx, mob, enemy);
      spend(mob, TICK);
      return true;
    default:
      return false;
  }
}

/** Mob.modifyPassable: a wisp drifts through crystal; a hunting guardian stomps through it when the way round is long. */
export function mineCanStand(ctx: Ctx, mob: Mob, cell: number): boolean {
  if (cell < 0 || cell >= LENGTH || ctx.level.map[cell] !== T.MINE_CRYSTAL) return false;
  if (mob.kind === 'crystalWisp') return true;
  if (mob.kind === 'crystalGuardian') return guardianStomps(ctx, mob);
  return false;
}

const stompCache = new WeakMap<Mob, { key: string; value: boolean }>();

/** CrystalGuardian.modifyPassable: hunting, crystals are walked through when the way round is over twice as long. */
function guardianStomps(ctx: Ctx, mob: Mob): boolean {
  if (mob.state !== 'hunting' || mob.target === -1) return false;
  const key = `${mob.pos}:${mob.target}:${ctx.floor.now}`;
  const cached = stompCache.get(mob);
  if (cached?.key === key) return cached.value;
  const dist = distanceMap(mob.target, (c) => passableAt(ctx.level, c));
  const value = dist[mob.pos]! > 2 * distance(mob.pos, mob.target);
  stompCache.set(mob, { key, value });
  return value;
}

/**
 * After a step (Mob.move): a guardian breaks the crystal it stepped into (a move more, untouched by tight
 * spaces), and is slow where it is cramped (up to four times); haste makes anyone of them three times as quick.
 */
export function mineMoved(ctx: Ctx, mob: Mob): void {
  if (!isMineKind(mob.kind)) return;
  const crippled = (mob.crippled ?? 0) > 0;
  const hasted = (mob.mine?.hasted ?? 0) > 0;
  // Char.speed: crippled, half; hasted, three times.
  const base = (crippled ? 0.5 : 1) * (hasted ? 3 : 1);
  let speed = base;
  let extra = 0;
  if (mob.kind === 'crystalGuardian') {
    if (!openSpace(ctx.level, mob.pos)) speed = Math.max(0.25, f32(base / 4));
    if (ctx.level.map[mob.pos] === T.MINE_CRYSTAL) {
      ctx.level.map[mob.pos] = T.EMPTY;
      ctx.effects.push({ type: 'mineEvent', depth: ctx.depth, what: 'shatter', mob: mob.id, cells: [mob.pos] });
      extra = 1 / base;
    }
  }
  // The step's time as the original reckons it, less what the ordinary step already counts (a turn, and another crippled).
  mob.time += 1 / speed + extra - (1 + (crippled ? 1 : 0));
}

/* Hooks from combat.ts */

/** Char.defenseSkill: a knocked-down guardian cannot dodge. */
export function mineDefense(mob: Mob): number | undefined {
  return mob.kind === 'crystalGuardian' && mob.mine?.recovering ? 0 : undefined;
}

/** Char.isInvulnerable: the geomancer while armoured or guarded by a sapper; a downed guardian against all but heroes and the spire. */
function invulnerable(ctx: Ctx, mob: Mob, source: Char | string): boolean {
  if (mob.kind === 'gnollGeomancer') return (mob.mine?.armor ?? 0) > 0 || hasSapper(ctx, mob);
  if (mob.kind === 'crystalGuardian' && mob.mine?.recovering) {
    return typeof source !== 'string' && !isHero(source) && source.kind !== 'crystalSpire';
  }
  return false;
}

/**
 * Before a blow (Char.attack): an invulnerable target is not touched; a guardian striking a hero who is not
 * fighting the spire (hurt, within 8 cells) costs the quest's score.
 */
export function mineBeforeAttack(ctx: Ctx, attacker: Char, defender: Char): boolean {
  if (!isHero(attacker) && attacker.kind === 'crystalGuardian' && isHero(defender)) {
    const spireNear = ctx.floor.mobs.some((m) => m.kind === 'crystalSpire' && m.hp !== m.ht && distance(attacker.pos, m.pos) <= 8);
    if (!spireNear) questScore(ctx.world, 2, -100);
  }
  if (!isHero(defender) && isMineKind(defender.kind) && invulnerable(ctx, defender, attacker)) {
    ctx.effects.push({ type: 'mineEvent', depth: ctx.depth, what: 'immune', mob: defender.id });
    ctx.effects.push({ type: 'attack', depth: ctx.depth, attacker: attacker.id, target: defender.id, hit: false, damage: 0 });
    return true;
  }
  return false;
}

/** Char.attackProc: a fungal sentry's poison; a guard's spear warning. */
export function mineAttackProc(ctx: Ctx, attacker: Mob, defender: Char, damage: number): void {
  if (attacker.kind === 'fungalSentry') defender.poison = (defender.poison ?? 0) + 6;
  if (attacker.kind === 'gnollGuard' && isHero(defender) && !adjacent(attacker.pos, defender.pos) && damage > 12) {
    ctx.effects.push({ type: 'mineEvent', depth: ctx.depth, what: 'spearWarn', mob: attacker.id, hero: defender.id });
  }
}

/**
 * Char.damage for the mine's monsters, before it lands: the damage left for the ordinary reckoning, or -1
 * if it is done (immune, or reckoned here: the guardian's fall, the geomancer's brackets).
 */
export function mineDamage(ctx: Ctx, mob: Mob, damage: number, source: Char | string): number {
  if (!isMineKind(mob.kind)) return damage;
  if (invulnerable(ctx, mob, source)) return -1;
  switch (mob.kind) {
    case 'crystalGuardian':
      guardianDamage(ctx, mob, damage);
      return 0;
    case 'gnollGeomancer':
      geomancerDamage(ctx, mob, damage);
      return 0;
    case 'gnollGuard':
      return hasSapper(ctx, mob) ? Math.trunc(damage / 4) : damage;
    case 'gnollSapper':
      st(mob).cooldown = Math.trunc(f32((mob.mine?.cooldown ?? 0) - f32(damage / 10)));
      return damage;
    case 'fungalSpinner': {
      // FungalSpinner.damage: in the grass, a third less, and a tenth less for each more cell of it about.
      const grass = N9.filter((n) => ctx.level.map[mob.pos + n] === T.FURROWED_GRASS || ctx.level.map[mob.pos + n] === T.HIGH_GRASS).length;
      return grass > 0 ? Math.floor(f32((damage * (8 - grass)) / 10) + 0.5) : damage;
    }
    default:
      return damage;
  }
}

/** Mob.die for the mine's: a sapper's partner loses its armour; a boss beaten (the geomancer brings its boulders down). */
export function mineMobDied(ctx: Ctx, mob: Mob): void {
  if (mob.kind === 'gnollSapper') losePartner(ctx, mob);
  if (mob.kind === 'fungalCore') beatBlacksmithBoss(ctx.world);
  if (mob.kind === 'gnollGeomancer') {
    beatBlacksmithBoss(ctx.world);
    const cells: number[] = [];
    for (let i = 0; i < LENGTH; i++) {
      if (ctx.level.map[i] === T.MINE_BOULDER && trueDistance(i, mob.pos) <= 6) {
        ctx.level.map[i] = T.EMPTY_DECO;
        cells.push(i);
      }
    }
    ctx.effects.push({ type: 'mineEvent', depth: ctx.depth, what: 'rockfall', mob: mob.id, cells });
    ctx.effects.push({ type: 'bossSlain', depth: ctx.depth, kind: mob.kind });
  }
}

/* Interacting: the pickaxe on the spire and on the geomancer's armour */

/** Mob.interact for the mine's (the 'attack' action on them): the time it took, or null for an ordinary attack. */
export function mineInteract(ctx: Ctx, hero: Hero, mob: Mob): number | null {
  if (mob.kind === 'crystalSpire') return hitSpire(ctx, hero, mob);
  if (mob.kind === 'gnollGeomancer' && (mob.mine?.armor ?? 0) > 0) return hitGeomancer(ctx, hero, mob);
  return null;
}

/* CrystalWisp */

/** CrystalWisp.zap: a beam of light, a magic attack (accuracy doubled), 5-10 that armour does not stop. */
function wispZap(ctx: Ctx, mob: Mob, enemy: Hero): void {
  spend(mob, TICK);
  ctx.effects.push({ type: 'zapped', depth: ctx.depth, from: mob.pos, to: enemy.pos, bolt: 'beam' });
  const hit = ctx.rng.floatMax(MOBS.crystalWisp.attack) * 2 >= ctx.rng.floatMax(heroDefenseSkill(enemy));
  const damage = hit ? ctx.rng.normalIntRange(5, 10) : 0;
  ctx.effects.push({ type: 'attack', depth: ctx.depth, attacker: mob.id, target: enemy.id, hit, damage });
  if (hit) hurt(ctx, enemy, damage, mob);
}

/* CrystalGuardian */

/** CrystalGuardian.isAlive: brought down, it falls to one point and mends, never dying; most of its ailments drop away. */
function guardianDamage(ctx: Ctx, mob: Mob, damage: number): void {
  const s = st(mob);
  mob.hp = s.recovering ? Math.max(1, mob.hp - damage) : mob.hp - damage;
  if (mob.hp > 0) return;
  mob.hp = 1;
  // Every buff but Doom and Cripple.
  for (const key of ['poison', 'paralysed', 'burning', 'slowed', 'rooted', 'blind', 'bleeding', 'dizzy', 'terror', 'charmed', 'amok', 'rage'] as const) {
    delete mob[key];
  }
  s.hasted = 0;
  if (!s.recovering) {
    s.recovering = true;
    ctx.effects.push({ type: 'mineEvent', depth: ctx.depth, what: 'crumple', mob: mob.id });
  }
}

/** CrystalGuardian.act while recovering: five points a turn back, then up again. */
function guardianRecover(ctx: Ctx, mob: Mob): void {
  mob.hp = Math.min(mob.ht, mob.hp + 5);
  ctx.effects.push({ type: 'mineEvent', depth: ctx.depth, what: 'mend', mob: mob.id, amount: 5 });
  if (mob.hp === mob.ht) {
    st(mob).recovering = false;
    ctx.effects.push({ type: 'mineEvent', depth: ctx.depth, what: 'rise', mob: mob.id });
  }
  spend(mob, TICK);
}

/* CrystalSpire */

const SPIRE_ABILITY_CD = 15;

/** CrystalSpire.spreadDiamondAOE: one step further, four ways, through open ground or crystal. */
function spreadDiamond(level: Level, current: number[]): number[] {
  const spread: number[] = [];
  const have = new Set(current);
  const added = new Set<number>();
  for (const i of current) {
    for (const j of N4) {
      const c = i + j;
      if ((!solidAt(level, c) || level.map[c] === T.MINE_CRYSTAL) && !added.has(c) && !have.has(c)) {
        spread.push(c);
        added.add(c);
      }
    }
  }
  return spread;
}

/**
 * CrystalSpire.act: the spikes it called up burst (crystal grows on each cell; whoever stands there is hurt
 * for 6-15 — a guardian 12 more and crippled, a hero costing the quest's score — and thrown back: a guardian
 * away from the hero, others away from the spire); then, roused (three blows) and seeing its enemy, every
 * fifteen turns a diamond around the hero or a line towards them, wider in two waves more as it weakens.
 */
function spireAct(ctx: Ctx, mob: Mob): void {
  const s = st(mob);
  const level = ctx.level;
  const fov = castShadow(mob.pos, terrainBlocksSight(level.map), mobSight(mob));
  const enemy = heroFor(ctx, mob);
  if (enemy) mob.enemy = enemy.id;
  // It still tracks an invisible hero.
  const enemySeen = enemy !== undefined && fov[enemy.pos] === true;
  mob.enemySeen = enemySeen;

  if (s.targeted && s.targeted.length > 0) {
    const cells = s.targeted.shift()!;
    for (const i of cells) {
      if (charAt(ctx.world, ctx.depth, i) === mob) continue;
      level.map[i] = T.MINE_CRYSTAL;
    }
    ctx.effects.push({ type: 'mineEvent', depth: ctx.depth, what: 'spikes', mob: mob.id, cells });
    for (const i of cells) {
      const ch = charAt(ctx.world, ctx.depth, i);
      if (!ch || (!isHero(ch) && (ch.kind === 'crystalWisp' || ch.kind === 'crystalSpire'))) continue;
      let dmg = ctx.rng.normalIntRange(6, 15);
      const guardian = !isHero(ch) && ch.kind === 'crystalGuardian';
      if (guardian) {
        dmg += 12;
        ch.crippled = (ch.crippled ?? 0) + 30;
      } else if (isHero(ch)) {
        questScore(ctx.world, 2, -100);
      }
      ctx.effects.push({ type: 'hurt', depth: ctx.depth, who: ch.id, damage: dmg });
      hurt(ctx, ch, dmg, mob);
      let movePos = i;
      const hero = enemy;
      if (guardian && hero) {
        for (const j of N8) {
          if (!solidAt(level, i + j) && !charAt(ctx.world, ctx.depth, i + j) && trueDistance(i + j, hero.pos) > trueDistance(movePos, hero.pos)) {
            movePos = i + j;
          }
        }
      } else if (isHero(ch) || !IMMOVABLE.has(ch.kind)) {
        for (const j of N8) {
          if (!solidAt(level, i + j) && !charAt(ctx.world, ctx.depth, i + j) && trueDistance(i + j, mob.pos) > trueDistance(movePos, mob.pos)) {
            movePos = i + j;
          }
        }
      }
      if (isAlive(ch) && movePos !== i) shove(ctx, ch, movePos);
    }
    if (s.targeted.length > 0) ctx.effects.push({ type: 'mineEvent', depth: ctx.depth, what: 'targeted', mob: mob.id, cells: s.targeted[0]!, amount: TICK });
  }

  if ((s.hits ?? 0) < 3 || !enemySeen || !enemy) {
    spend(mob, TICK);
    return;
  }
  if ((s.cooldown ?? 0) <= 0) {
    if (ctx.rng.int(2) === 0) spireDiamond(ctx, mob, enemy);
    else spireLine(ctx, mob, enemy);
    const delay = warningDelay(ctx, enemy);
    ctx.effects.push({ type: 'mineEvent', depth: ctx.depth, what: 'targeted', mob: mob.id, cells: s.targeted![0]!, amount: delay });
    s.cooldown = f32((s.cooldown ?? 0) + SPIRE_ABILITY_CD);
    spend(mob, delay);
    interrupt(ctx, enemy);
  } else {
    s.cooldown = f32(s.cooldown! - 1);
    spend(mob, TICK);
  }
}

const weakened = (mob: Mob, thirds: number): boolean => mob.hp < f32((thirds * mob.ht) / 3);

/** CrystalSpire.diamondAOEAttack: around the hero, a step wider for each wave. */
function spireDiamond(ctx: Ctx, mob: Mob, hero: Hero): void {
  const s = st(mob);
  s.targeted = [];
  const cells = [hero.pos];
  cells.push(...spreadDiamond(ctx.level, cells));
  s.targeted.push([...cells]);
  if (weakened(mob, 2)) {
    cells.push(...spreadDiamond(ctx.level, cells));
    s.targeted.push([...cells]);
    if (weakened(mob, 1)) {
      cells.push(...spreadDiamond(ctx.level, cells));
      s.targeted.push([...cells]);
    }
  }
}

/** CrystalSpire.lineAttack: a line of up to seven cells towards (and past) the hero, widening with each wave. */
function spireLine(ctx: Ctx, mob: Mob, hero: Hero): void {
  const s = st(mob);
  s.targeted = [];
  const cells: number[] = [];
  const aim = ballistica(ctx, mob.pos, hero.pos, WONT_STOP);
  for (const i of subPath(aim, 1, 7)) {
    if (!solidAt(ctx.level, i) || ctx.level.map[i] === T.MINE_CRYSTAL) cells.push(i);
    else break;
  }
  s.targeted.push([...cells]);
  if (weakened(mob, 2)) {
    cells.push(...spreadDiamond(ctx.level, cells));
    s.targeted.push([...cells]);
    if (weakened(mob, 1)) {
      cells.push(...spreadDiamond(ctx.level, cells));
      s.targeted.push([...cells]);
    }
  }
}

/**
 * CrystalSpire.interact: a blow of the pickaxe alone (its own damage, nothing of the hero's), which also
 * shortens its next attack's wait. The first warns; from the third it is roused: its wisps come to it, and
 * its guardians are set on the hero (the near sleeping ones dazed a while, the far awake ones hasted).
 * Shattered, it takes the crystals it can see with it, knocks its guardians down and blinds its wisps.
 */
function hitSpire(ctx: Ctx, hero: Hero, mob: Mob): number {
  const pick = pickaxeOf(hero);
  if (!pick) return 0;
  const s = st(mob);
  const dmg = pickaxeDamage(ctx, pick);
  mob.hp -= dmg;
  mob.enemy = hero.id;
  s.cooldown = f32((s.cooldown ?? 0) - f32(dmg / 10));
  ctx.effects.push({ type: 'mineEvent', depth: ctx.depth, what: 'spireHit', mob: mob.id, hero: hero.id, amount: dmg });
  ctx.effects.push({ type: 'attack', depth: ctx.depth, attacker: hero.id, target: mob.id, hit: true, damage: dmg });
  const level = ctx.level;
  if (!isAlive(mob)) {
    beatBlacksmithBoss(ctx.world);
    const fov = castShadow(mob.pos, terrainBlocksSight(level.map), mobSight(mob));
    mobDied(ctx, mob, hero.id);
    const cells: number[] = [];
    for (let i = 0; i < LENGTH; i++) {
      if (fov[i] && level.map[i] === T.MINE_CRYSTAL) {
        level.map[i] = T.EMPTY;
        cells.push(i);
      }
    }
    ctx.effects.push({ type: 'mineEvent', depth: ctx.depth, what: 'spireShattered', mob: mob.id, cells });
    ctx.effects.push({ type: 'bossSlain', depth: ctx.depth, kind: 'crystalSpire' });
    for (const other of [...ctx.floor.mobs]) {
      if (!fov[other.pos]) continue;
      if (other.kind === 'crystalGuardian') hurt(ctx, other, other.ht, mob);
      if (other.kind === 'crystalWisp') other.blind = (other.blind ?? 0) + 5;
    }
  }
  s.hits = (s.hits ?? 0) + 1;
  if (s.hits === 1) {
    ctx.effects.push({ type: 'mineEvent', depth: ctx.depth, what: 'spireWarning', mob: mob.id, hero: hero.id });
  } else if (s.hits >= 3) {
    if (s.hits === 3) {
      ctx.effects.push({ type: 'mineEvent', depth: ctx.depth, what: 'spireAlert', mob: mob.id, hero: hero.id });
      // The first attack a turn later.
      s.cooldown = 1;
    }
    let affectingGuardians = false;
    for (const other of ctx.floor.mobs) {
      if (other.kind === 'crystalWisp') {
        if (other.state !== 'hunting' && other.target !== mob.pos) beckon(other, mob.pos);
      } else if (other.kind === 'crystalGuardian') {
        if (other.state !== 'hunting' && other.target !== mob.pos) affectingGuardians = true;
      }
    }
    if (affectingGuardians) {
      // The way to the guardians: crystal counts as open, as do the tiles themselves.
      const dist = distanceMap(mob.pos, (c) => level.map[c] === T.MINE_CRYSTAL || hasFlag(level.map[c]!, F.PASSABLE));
      for (const g of ctx.floor.mobs) {
        if (g.kind !== 'crystalGuardian') continue;
        const d = dist[g.pos]!;
        if (g.state === 'sleeping') {
          aggro(g, hero);
          beckon(g, mob.pos);
          // The sleeping ones near the spire are slow to get up.
          if (d < 20) g.paralysed = (g.paralysed ?? 0) + (20 - d);
        } else if (g.state !== 'hunting' && g.target !== mob.pos) {
          beckon(g, mob.pos);
          // (Beckoned, it is not hunting yet: it is now.)
          aggro(g, hero);
          // The far awake ones are hurried along.
          if (d > 8) st(g).hasted = (g.mine?.hasted ?? 0) + Math.max(15, Math.floor(f32((d - 8) / 2) + 0.5));
        }
      }
    }
  }
  hero.invisible = 0;
  return 1;
}

/* Boulders: thrown and falling (GnollGeomancer's statics, also the sappers') */

/** The rocks the gnolls are about to throw, not to be chosen twice. */
function rocksInHand(ctx: Ctx): Set<number> {
  const rocks = new Set<number>();
  for (const m of ctx.floor.mobs) for (const r of m.mine?.rockFrom ?? []) rocks.add(r);
  return rocks;
}

/** GnollGeomancer.prepRockThrowAttack: the boulder in sight nearest the target with a clear throw to them; null if none. */
function prepRockThrow(ctx: Ctx, target: Hero, source: Mob, fov: boolean[]): Path | null {
  const candidates: number[] = [];
  for (let i = 0; i < LENGTH; i++) {
    if (fov[i] && ctx.level.map[i] === T.MINE_BOULDER && ballistica(ctx, i, target.pos, PROJECTILE).collisionPos === target.pos) candidates.push(i);
  }
  const taken = rocksInHand(ctx);
  const left = candidates.filter((c) => !taken.has(c));
  if (left.length === 0) return null;
  let from = left[0]!;
  for (const i of left) if (trueDistance(i, target.pos) < trueDistance(from, target.pos)) from = i;
  return ballistica(ctx, from, target.pos, PROJECTILE);
}

/**
 * GnollGeomancer.doRockThrowAttack: the boulder leaves its place and flies; whoever it strikes (not the
 * geomancer) takes 6-12 and is stunned (3 turns, a guard 10) and knocked a cell on, once a volley; a hero
 * struck costs the quest's score. Striking nobody, it presses the cell it lands on.
 */
function rockThrow(ctx: Ctx, source: Mob, from: number, to: number, knocked: Set<Char>): void {
  ctx.level.map[from] = T.EMPTY;
  const rock = ballistica(ctx, from, to, MAGIC_BOLT);
  ctx.effects.push({ type: 'mineEvent', depth: ctx.depth, what: 'rockThrow', mob: source.id, from, to: rock.collisionPos });
  const ch = charAt(ctx.world, ctx.depth, rock.collisionPos);
  if (ch && (isHero(ch) || ch.kind !== 'gnollGeomancer')) {
    const dmg = ctx.rng.normalIntRange(6, 12);
    ctx.effects.push({ type: 'hurt', depth: ctx.depth, who: ch.id, damage: dmg });
    hurt(ctx, ch, dmg, source);
    if (isHero(ch)) questScore(ctx.world, 2, -100);
    if (isAlive(ch)) ch.paralysed = Math.max(ch.paralysed ?? 0, !isHero(ch) && ch.kind === 'gnollGuard' ? 10 : 3);
    if (isAlive(ch) && !knocked.has(ch) && rock.path.length > rock.dist + 1) {
      throwChar(ctx, ch, ballistica(ctx, ch.pos, rock.path[rock.dist + 1]!, MAGIC_BOLT));
      knocked.add(ch);
    }
  } else if (!ch && trapAt(ctx.level, rock.collisionPos)) {
    triggerTrap(ctx, null, rock.collisionPos);
  }
}

/** WandOfBlastWave.throwChar with a power of 1: a cell along the way, unless held fast or blocked. */
function throwChar(ctx: Ctx, ch: Char, trajectory: Path): void {
  let dist = Math.min(trajectory.dist, 1);
  if (dist <= 0 || (ch.rooted ?? 0) > 0 || (!isHero(ch) && IMMOVABLE.has(ch.kind))) return;
  if (charAt(ctx.world, ctx.depth, trajectory.path[dist]!)) dist--;
  const newPos = trajectory.path[dist]!;
  if (newPos === ch.pos) return;
  shove(ctx, ch, newPos);
}

/**
 * GnollGeomancer.prepRockFallAttack: rocks will fall around the target, thinner further out (out to
 * `range`), sparing one cell beside them, the geomancer (and, for it, the sappers), and, with
 * `avoidBarricades`, anything by a barricade or the way in; they fall once the target has had its turn.
 */
function prepRockFall(ctx: Ctx, target: Hero, source: Mob, range: number, avoidBarricades: boolean): boolean {
  const level = ctx.level;
  const rng = ctx.rng;
  const center = target.pos;
  let safeCell: number;
  do {
    safeCell = center + N8[rng.int(8)]!;
  } while (safeCell === source.pos || (solidAt(level, safeCell) && rng.int(5) !== 0) || (trapAt(level, safeCell) && rng.int(5) !== 0));
  const cells: number[] = [];
  const start = center - W * range - range;
  for (let y = 0; y < 1 + 2 * range; y++) {
    let pos = start + W * y;
    for (let x = 0; x < 1 + 2 * range; x++, pos++) {
      if (!insideMap(level, pos)) continue;
      if (avoidBarricades && N9.some((j) => level.map[pos + j] === T.BARRICADE || level.map[pos + j] === T.ENTRANCE)) continue;
      const there = charAt(ctx.world, ctx.depth, pos);
      const there2 = there && !isHero(there) ? there.kind : null;
      if (!solidAt(level, pos) && pos !== safeCell && there2 !== 'gnollGeomancer' &&
        !(source.kind === 'gnollGeomancer' && there2 === 'gnollSapper') &&
        rng.int(1 + Math.trunc(distance(center, pos) / 2)) === 0) {
        cells.push(pos);
      }
    }
  }
  const delay = warningDelay(ctx, target);
  (st(source).rockfalls ??= []).push({ at: source.time + delay, cells });
  ctx.effects.push({ type: 'mineEvent', depth: ctx.depth, what: 'rockfallWarning', mob: source.id, cells, amount: delay });
  return true;
}

/**
 * GnollRockFall (DelayedRockFall) when its time comes: on each cell, whoever stands there takes 6-12 and is
 * stunned (a guard longer; a hero costs the quest's score), and an empty cell may be left a boulder (not
 * the way in, nor floor by it).
 */
function rockfallsDue(ctx: Ctx, mob: Mob): void {
  const pending = mob.mine?.rockfalls;
  if (!pending || pending.length === 0) return;
  const due = pending.filter((r) => r.at <= mob.time);
  if (due.length === 0) return;
  mob.mine!.rockfalls = pending.filter((r) => r.at > mob.time);
  const level = ctx.level;
  for (const fall of due) {
    for (const cell of fall.cells) {
      const ch = charAt(ctx.world, ctx.depth, cell);
      if (ch) {
        const dmg = ctx.rng.normalIntRange(6, 12);
        ctx.effects.push({ type: 'hurt', depth: ctx.depth, who: ch.id, damage: dmg });
        hurt(ctx, ch, dmg, mob);
        if (isHero(ch)) questScore(ctx.world, 2, -100);
        if (isAlive(ch)) ch.paralysed = Math.max(ch.paralysed ?? 0, !isHero(ch) && ch.kind === 'gnollGuard' ? 10 : 3);
      } else if (level.map[cell] !== T.EMPTY_SP && !adjacent(cell, level.entrance) && ctx.rng.int(3) === 0) {
        level.map[cell] = T.MINE_BOULDER;
      }
    }
    ctx.effects.push({ type: 'mineEvent', depth: ctx.depth, what: 'rockfall', mob: mob.id, cells: fall.cells });
  }
}

/** Next to a barricade or the way in: the gnolls throw rather than bring rocks down (which would spare it). */
const byBarricade = (level: Level, cell: number): boolean => N8.some((i) => level.map[cell + i] === T.BARRICADE || level.map[cell + i] === T.ENTRANCE);

/** The warning of a boulder's flight: its path from the rock to where it strikes. */
function warnThrow(ctx: Ctx, mob: Mob, aim: Path, delay: number): void {
  const warn = ballistica(ctx, aim.sourcePos, aim.collisionPos, STOP_SOLID);
  ctx.effects.push({ type: 'mineEvent', depth: ctx.depth, what: 'targeted', mob: mob.id, cells: subPath(warn, 0, warn.dist), amount: delay });
}

/* GnollSapper */

/**
 * GnollSapper.act and its Hunting: a thrown boulder lands a turn after it is aimed. Hunting an enemy it
 * sees, it rouses its partner when the enemy comes within three, and when its cooldown runs out throws a
 * boulder (always by a barricade, never rockfall twice running, else half the time) or brings rocks down;
 * it never walks up to an enemy it sees, but strikes one beside it. Unseen, it keeps near its post.
 */
function sapperAct(ctx: Ctx, mob: Mob): boolean {
  const s = st(mob);
  rockfallsDue(ctx, mob);
  if (s.rockFrom && s.rockFrom.length > 0) {
    const from = s.rockFrom[0]!;
    const to = s.rockTo ?? -1;
    delete s.rockFrom;
    delete s.rockTo;
    if (ctx.level.map[from] === T.MINE_BOULDER) rockThrow(ctx, mob, from, to, new Set());
    spend(mob, TICK);
    return true;
  }
  if (mob.state !== 'hunting') return false;
  const fov = castShadow(mob.pos, terrainBlocksSight(ctx.level.map), mobSight(mob));
  const chosen = chooseEnemy(ctx, mob, fov);
  const enemy = chosen && isHero(chosen) ? chosen : undefined;
  if (!enemy || !fov[enemy.pos]) {
    // Not after anything more than a few cells from its post.
    if (s.spawnPos !== undefined && mob.target !== -1 && distance(s.spawnPos, mob.target) > 3) mob.target = mob.pos;
    return false;
  }
  if (mobConditions(ctx, mob)) {
    spend(mob, TICK);
    return true;
  }
  mob.enemySeen = true;
  const partner = findMob(ctx, s.partner);
  if (partner && distance(mob.pos, enemy.pos) <= 3) {
    if (partner.state === 'sleeping') notice(ctx, partner, enemy, 'hunting');
    partner.target = enemy.pos;
    aggro(partner, enemy);
  }
  const cooldown = s.cooldown ?? 0;
  s.cooldown = cooldown - 1;
  if (cooldown <= 0) {
    const aim = prepRockThrow(ctx, enemy, mob, fov);
    if (aim && (byBarricade(ctx.level, enemy.pos) || s.lastRockfall || ctx.rng.int(2) === 0)) {
      s.lastRockfall = false;
      s.rockFrom = [aim.sourcePos];
      s.rockTo = aim.collisionPos;
      const delay = warningDelay(ctx, enemy);
      warnThrow(ctx, mob, aim, delay);
      interrupt(ctx, enemy);
      s.cooldown = ctx.rng.normalIntRange(4, 6);
      spend(mob, delay);
      return true;
    }
    if (prepRockFall(ctx, enemy, mob, 2, true)) {
      s.lastRockfall = true;
      interrupt(ctx, enemy);
      spend(mob, warningDelay(ctx, enemy));
      s.cooldown = ctx.rng.normalIntRange(4, 6);
      return true;
    }
  }
  if (adjacent(mob.pos, enemy.pos)) {
    attack(ctx, mob, enemy);
    spend(mob, TICK);
    return true;
  }
  spend(mob, TICK);
  return true;
}

/* GnollGeomancer */

/** Its sight goes through tall grass: it fights in the open it carves, and loses sight round walls. */
function geomancerView(ctx: Ctx, mob: Mob): boolean[] {
  const map = ctx.level.map;
  return castShadow(mob.pos, (c) => hasFlag(map[c]!, F.LOS_BLOCKING) && map[c] !== T.HIGH_GRASS && map[c] !== T.FURROWED_GRASS, 12);
}

/**
 * GnollGeomancer.act: its first turn notes the sappers' posts (where it may dash); boulders aimed last turn
 * fly; asleep, it sleeps on (only the pickaxe wakes it). Hunting an enemy it sees — any it can find — its
 * cooldown runs down faster while the enemy keeps away or a sapper guards it; spent, it throws one to three
 * boulders (more as it weakens) or brings down rocks over a wider field; it never strikes in melee.
 */
function geomancerAct(ctx: Ctx, mob: Mob): void {
  const s = st(mob);
  if (!s.sapperSpawns) {
    s.sapperSpawns = ctx.floor.mobs.filter((m) => m.kind === 'gnollSapper').slice(0, 3).map((m) => m.mine?.spawnPos ?? m.pos);
    // (Shattered's array keeps a 0 for a post it could not fill; none here.)
    while (s.sapperSpawns.length < 3) s.sapperSpawns.push(-1);
  }
  rockfallsDue(ctx, mob);
  if (s.rockFrom) {
    const knocked = new Set<Char>();
    const to = s.rockTo ?? -1;
    const rocks = s.rockFrom;
    delete s.rockFrom;
    delete s.rockTo;
    for (const rock of rocks) if (rock !== -1 && ctx.level.map[rock] === T.MINE_BOULDER) rockThrow(ctx, mob, rock, to, knocked);
    spend(mob, TICK);
    return;
  }
  if (mob.state === 'sleeping') {
    spend(mob, TICK);
    return;
  }
  if (mobConditions(ctx, mob)) {
    spend(mob, TICK);
    return;
  }
  const fov = geomancerView(ctx, mob);
  const visible = (h: Hero): boolean => fov[h.pos] === true && h.invisible <= 0;
  let enemy = heroesOn(ctx.world, ctx.depth).find((h) => h.id === mob.enemy && visible(h));
  if (!enemy) {
    for (const h of heroesOn(ctx.world, ctx.depth)) if (visible(h) && (!enemy || distance(mob.pos, h.pos) < distance(mob.pos, enemy.pos))) enemy = h;
    if (enemy) mob.enemy = enemy.id;
  }
  if (!enemy) {
    spend(mob, TICK);
    return;
  }
  if (mob.state !== 'hunting') {
    // Wandering, it notices whoever it sees (it cannot go anywhere).
    mob.state = 'hunting';
    mob.target = enemy.pos;
  }
  mob.enemySeen = true;
  const sapper = hasSapper(ctx, mob) ? findMob(ctx, s.sapper) : undefined;
  // More often on the enemy's approach, or while a sapper lives — but not on a stunned enemy.
  if ((distance(mob.pos, enemy.pos) > 2 || sapper) && (s.armor ?? 0) > 0 && enemy.paralysed <= 0) s.cooldown = Math.trunc((s.cooldown ?? 0) - 1);
  if (sapper) aggro(sapper, enemy);
  const cooldown = s.cooldown ?? 0;
  s.cooldown = cooldown - 1;
  if (cooldown <= 0) {
    const bracket = geomancerBracket(mob);
    let aim = prepRockThrow(ctx, enemy, mob, fov);
    if (aim && (byBarricade(ctx.level, enemy.pos) || s.lastRockfall || ctx.rng.int(2) === 0)) {
      s.lastRockfall = false;
      s.rockFrom = [-1, -1, -1];
      s.rockTo = aim.collisionPos;
      const delay = warningDelay(ctx, enemy);
      for (let i = 0; i < 3 - bracket; i++) {
        if (!aim) break;
        s.rockFrom[i] = aim.sourcePos;
        warnThrow(ctx, mob, aim, delay);
        aim = prepRockThrow(ctx, enemy, mob, fov);
      }
      interrupt(ctx, enemy);
      s.cooldown = ctx.rng.normalIntRange(3, 5);
      spend(mob, delay);
      return;
    }
    if (prepRockFall(ctx, enemy, mob, 6 - 2 * bracket, true)) {
      s.lastRockfall = true;
      interrupt(ctx, enemy);
      spend(mob, warningDelay(ctx, enemy));
      s.cooldown = ctx.rng.normalIntRange(3, 5);
      return;
    }
  }
  spend(mob, TICK);
}

/** Its health in thirds: 2 (whole health counts as the top third), 1, or 0, the last, where it can die. */
function geomancerBracket(mob: Mob): number {
  const bracket = Math.trunc(mob.hp / Math.trunc(mob.ht / 3));
  return bracket === 3 ? 2 : bracket;
}

/**
 * GnollGeomancer.damage: the rock armour takes what it can; a blow cannot take it through more than one
 * third of its health, and passing into a lower third it dashes away through the rock, armoured anew (25).
 * It shortens its next ability's wait. Struck asleep, it wakes (the pickaxe's blows put it back).
 */
function geomancerDamage(ctx: Ctx, mob: Mob, dmg: number): void {
  const s = st(mob);
  const hpBracket = Math.trunc(mob.ht / 3);
  const cur = geomancerBracket(mob);
  s.finalBracket = cur === 0;
  if (mob.state === 'sleeping') mob.state = 'wandering';
  let left = dmg;
  if ((s.armor ?? 0) > 0) {
    const absorbed = Math.min(s.armor!, left);
    s.armor! -= absorbed;
    left -= absorbed;
    if (s.armor! <= 0) {
      delete s.armor;
      ctx.effects.push({ type: 'mineEvent', depth: ctx.depth, what: 'armorBroken', mob: mob.id });
    }
  }
  mob.hp -= left;
  s.cooldown = Math.trunc(f32((s.cooldown ?? 0) - f32(dmg / 10)));
  const next = geomancerBracket(mob);
  if (next !== cur) {
    // Never through more than a third at once.
    if (mob.hp <= (cur - 1) * hpBracket) mob.hp = (cur - 1) * hpBracket + 1;
    carveRockAndDash(ctx, mob);
    s.armor = Math.max(s.armor ?? 0, 25);
  }
  // Char.isAlive: it cannot die before its last third.
  if (mob.hp <= 0 && !s.finalBracket) mob.hp = 1;
}

/** CrystalSpire.spreadDiamondAOE's twin for the geomancer: four ways, anywhere inside the map. */
function spreadInside(level: Level, current: number[]): number[] {
  const spread: number[] = [];
  const have = new Set(current);
  const added = new Set<number>();
  for (const i of current) {
    for (const j of N4) {
      const c = i + j;
      if (insideMap(level, c) && !added.has(c) && !have.has(c)) {
        spread.push(c);
        added.add(c);
      }
    }
  }
  return spread;
}

/**
 * GnollGeomancer.carveRockAndDash: to the nearest sapper's post (a living sapper within 16 preferred), at
 * most twelve cells, each post once: the way is carved through the rock — veins give up their dark gold,
 * rock turns to rubble or boulders, grass is flattened — and boulders ring the carved space. Reaching a
 * living sapper, it takes it as partner (armour while it lives), and brings it and its guard to its side.
 */
function carveRockAndDash(ctx: Ctx, mob: Mob): void {
  const s = st(mob);
  const level = ctx.level;
  const spawns = (s.sapperSpawns ??= ctx.floor.mobs.filter((m) => m.kind === 'gnollSapper').slice(0, 3).map((m) => m.mine?.spawnPos ?? m.pos));
  const sapperAt = (post: number): Mob | undefined => ctx.floor.mobs.find((m) => m.kind === 'gnollSapper' && m.mine?.spawnPos === post && isAlive(m));
  let closest = -1;
  let closestAlive = false;
  for (const post of spawns) {
    if (post === -1) continue;
    if (closest === -1) {
      closest = post;
      closestAlive = sapperAt(post) !== undefined;
      continue;
    }
    const alive = sapperAt(post) !== undefined;
    if ((alive && !closestAlive && distance(mob.pos, post) <= 16) || trueDistance(mob.pos, post) < trueDistance(mob.pos, closest)) {
      closest = post;
      closestAlive = alive;
    }
  }
  let dashPos = closest;
  if (dashPos === -1) return;

  let path = ballistica(ctx, mob.pos, dashPos, STOP_TARGET);
  if (path.dist > 12) dashPos = path.path[12]!;
  if (charAt(ctx.world, ctx.depth, dashPos) || trapAt(level, dashPos)) {
    const candidates = N8.map((i) => dashPos + i).filter((c) => !charAt(ctx.world, ctx.depth, c) && !trapAt(level, c));
    if (candidates.length > 0) dashPos = candidates[ctx.rng.int(candidates.length)]!;
  }
  for (let i = 0; i < spawns.length; i++) if (spawns[i] === closest) spawns[i] = -1;

  path = ballistica(ctx, mob.pos, dashPos, STOP_TARGET);
  const cells = subPath(path, 0, path.dist);
  cells.push(...spreadInside(level, cells));
  cells.push(...spreadInside(level, cells));
  cells.push(...spreadInside(level, cells));
  const exterior = spreadInside(level, cells);

  // The flags as they were before the carving (Shattered rebuilds them after).
  const wasSolid = (c: number): boolean => solidAt(level, c);
  const solidBefore = new Map<number, boolean>();
  for (const c of [...cells, ...exterior, dashPos]) solidBefore.set(c, wasSolid(c));
  for (const i of cells) {
    if (level.map[i] === T.WALL_DECO) {
      dropItem(ctx.floor, i, createItem('quest.ore'));
      level.map[i] = T.EMPTY_DECO;
    } else if (solidBefore.get(i)) {
      level.map[i] = ctx.rng.int(3) === 0 ? T.MINE_BOULDER : T.EMPTY_DECO;
    } else if (level.map[i] === T.HIGH_GRASS || level.map[i] === T.FURROWED_GRASS) {
      level.map[i] = T.GRASS;
    }
  }
  for (const i of exterior) {
    if (!solidBefore.get(i) && level.map[i] !== T.EMPTY_SP && !adjacent(i, level.entrance) && !trapAt(level, i) &&
      !(ctx.floor.plants ?? []).some((p) => p.pos === i) && !charAt(ctx.world, ctx.depth, i)) {
      level.map[i] = T.MINE_BOULDER;
    }
  }
  if (solidBefore.get(dashPos)) level.map[dashPos] = T.EMPTY_DECO;

  const from = mob.pos;
  mob.pos = dashPos;
  leaveCell(ctx.world, level, ctx.depth, from);
  enterCell(level, dashPos);
  ctx.effects.push({ type: 'mineEvent', depth: ctx.depth, what: 'dash', mob: mob.id, from, to: dashPos, cells });
  spend(mob, TICK);
  s.cooldown = 1;

  if (closestAlive) {
    const sapper = sapperAt(closest);
    if (sapper) {
      const guard = findMob(ctx, sapper.mine?.partner);
      linkPartner(ctx, sapper, mob);
      // Brought to its side if far.
      if (distance(sapper.pos, dashPos) > 3) {
        const candidates = N8.map((i) => dashPos + i).filter((c) => !solidAt(level, c) && !trapAt(level, c) &&
          !(ctx.floor.plants ?? []).some((p) => p.pos === c) && !charAt(ctx.world, ctx.depth, c));
        if (candidates.length > 0) {
          const newPos = candidates[ctx.rng.int(candidates.length)]!;
          appear(ctx, sapper, newPos);
          st(sapper).spawnPos = newPos;
          candidates.splice(candidates.indexOf(newPos), 1);
          if (guard?.kind === 'gnollGuard' && candidates.length > 0) appear(ctx, guard, candidates[ctx.rng.int(candidates.length)]!);
        }
      }
    }
  }
}

/** ScrollOfTeleportation.appear: there in a blink, pressing nothing. */
function appear(ctx: Ctx, mob: Mob, to: number): void {
  const from = mob.pos;
  mob.pos = to;
  leaveCell(ctx.world, ctx.level, ctx.depth, from);
  enterCell(ctx.level, to);
  ctx.effects.push({ type: 'jumped', depth: ctx.depth, mob: mob.id, from, to });
}

/**
 * GnollGeomancer.interact while armoured: the pickaxe alone against the armour (asleep, never more than 15,
 * so three blows cannot break it); the first warns, the third wakes it: it dashes away through the rock,
 * hunts the hero, and rouses the guards (those without a sapper come to it) and the sappers.
 */
function hitGeomancer(ctx: Ctx, hero: Hero, mob: Mob): number {
  const pick = pickaxeOf(hero);
  if (!pick) return 0;
  const s = st(mob);
  let dmg = pickaxeDamage(ctx, pick);
  let wasSleeping = mob.state === 'sleeping';
  if (wasSleeping) dmg = Math.min(dmg, 15);
  dmg = Math.min(dmg, s.armor ?? 0);
  geomancerDamage(ctx, mob, dmg);
  ctx.effects.push({ type: 'mineEvent', depth: ctx.depth, what: 'geoHit', mob: mob.id, hero: hero.id, amount: dmg });
  s.hits = (s.hits ?? 0) + 1;
  if (s.hits === 1) ctx.effects.push({ type: 'mineEvent', depth: ctx.depth, what: 'geoWarning', mob: mob.id, hero: hero.id });
  if (s.hits === 3) {
    ctx.effects.push({ type: 'mineEvent', depth: ctx.depth, what: 'geoAlert', mob: mob.id, hero: hero.id });
    wasSleeping = false;
    spend(mob, TICK);
    carveRockAndDash(ctx, mob);
    mob.state = 'hunting';
    mob.enemy = hero.id;
    mob.enemySeen = true;
    for (const other of ctx.floor.mobs) {
      if (other.kind === 'gnollGuard') {
        aggro(other, hero);
        if (!hasSapper(ctx, other)) beckon(other, mob.pos);
      } else if (other.kind === 'gnollSapper') {
        aggro(other, hero);
      }
    }
  }
  if (wasSleeping) {
    mob.state = 'sleeping';
    mob.alerted = false;
  }
  hero.invisible = 0;
  return 1;
}

/* FungalSentry */

/** FungalSentry: rooted, it always notices whoever it sees (a turn to do so) and shoots poison from afar. */
function sentryAct(ctx: Ctx, mob: Mob): void {
  if (mobConditions(ctx, mob)) {
    spend(mob, TICK);
    return;
  }
  const fov = castShadow(mob.pos, terrainBlocksSight(ctx.level.map), mobSight(mob));
  const chosen = chooseEnemy(ctx, mob, fov);
  const enemy = chosen && isHero(chosen) ? chosen : undefined;
  const inFov = enemy !== undefined && fov[enemy.pos] === true;
  if (mob.state !== 'hunting') {
    if (inFov) notice(ctx, mob, enemy, 'hunting');
    spend(mob, TICK);
    return;
  }
  mob.enemySeen = inFov;
  if (inFov && mineCanAttack(ctx, mob, enemy)) {
    mineDoAttack(ctx, mob, enemy);
    return;
  }
  spend(mob, TICK);
  if (!inFov) mob.state = 'wandering';
}

/* Respawning */

/** Monsters that do not count towards the mine's numbers (Mob.spawningWeight 0, minibosses, the neutral spire). */
const UNCOUNTED: ReadonlySet<string> = new Set(['crystalGuardian', 'crystalSpire', 'gnollSapper', 'gnollGeomancer', 'fungalSentry', 'fungalCore']);

/**
 * Level's MobSpawner on the mine (MiningLevel: a third as often, one fewer than a floor's limit): the
 * quest's own monster, out of sight. True if this was the mine.
 */
export function mineRespawn(ctx: Ctx): boolean {
  const level = ctx.level;
  if (!level.mine) return false;
  const { world, floor, rng, depth } = ctx;
  const counted = floor.mobs.filter((m) => m.state !== 'passive' && !UNCOUNTED.has(m.kind)).length;
  const limit = mobCount(3 + (depth % 5) + rng.int(3) - 1, partySize(world));
  if (counted < limit) {
    const kind: MobKind = level.mine === 'crystal' ? 'crystalWisp' : level.mine === 'gnoll' ? 'gnollGuard' : 'fungalSpinner';
    const seen = heroesOn(world, depth).map((hero) => castShadow(hero.pos, terrainBlocksSight(level.map), heroSight(world, depth)));
    const pos = randomRespawnCell(rng, world, level, (cell) => !seen.some((fov) => fov[cell]));
    if (pos !== -1) {
      const mob = scaleMob(world, { id: `#${++world.nextId}`, kind, pos, hp: MOBS[kind].ht, ht: MOBS[kind].ht, state: 'wandering', target: -1, enemy: null, enemySeen: false, alerted: false, time: floor.now });
      if (kind === 'crystalWisp') mob.mine = { variant: rng.int(3) };
      floor.mobs.push(mob);
    }
  }
  floor.respawn += respawnTime(3 * TIME_TO_RESPAWN, partySize(world));
  return true;
}
