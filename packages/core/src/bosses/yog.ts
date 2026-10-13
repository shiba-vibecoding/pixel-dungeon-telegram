import { createMob, type Hero, isAlive, type Mob, type MobKind } from '../actors';
import { hurt, killMob, magicHit } from '../combat';
import { ballistica, MAGIC_BOLT, WONT_STOP } from '../ballistica';
import { charAt, type Char, type Ctx, heroesOn, heroView, isHero, isPassable, isWater, observe } from '../floor';
import { distance, LENGTH, WIDTH } from '../level/geometry';
import { setTerrain } from '../level/flags';
import { F, hasFlag, T } from '../level/terrain';
import { HALLS_EXIT, YOG_POS } from '../level/halls-boss';
import { bossHurt } from '../hero';
import { getStep, meleeAttack, spendMob } from '../ai';
import { applyOoze } from './goo';
import { burst } from '../traps';
import { seedGas } from '../gas';
import { deriveSeed, Rng, Stream } from '../rng';
import { scaleMob } from '../party';
import {
  appear, assignBar, bleed, bossFloor, bossMob, deferDamage, fight, isFist, lockFloor, N8, N9, normalFloat, say, show,
  theHero, trueDistance, unlockFloor, yell,
} from './common';
import type { BossRules } from './rules';

/*
 * Yog-Dzewa (actors/mobs/YogDzewa.java), its fists (YogFist.java) and its hall
 * (HallsBossLevel). The Old God does not move nor strike: every ten to fifteen
 * turns it marks lines of cells for its death rays (more of them the more it
 * is hurt) and fires them as the hero's next turn comes, and as often it
 * brings forth a larva. Every 300 health it loses, the hall grows darker and a
 * fist rises from the pit (one of each pair: burning or soiled, rotting or
 * rusted, bright or dark), and while a fist lives Yog cannot be hurt; nor can
 * a fist near Yog. After the third, at its last hundred, it fights on alone,
 * summoning faster than ever.
 */

/** YogDzewa.getPairedFist. */
const PAIRS: ReadonlyArray<readonly [MobKind, MobKind]> = [['burningFist', 'soiledFist'], ['rottingFist', 'rustedFist'], ['brightFist', 'darkFist']];
/** Yog's minions (YogDzewa.die kills them with it). SEAM(mobs): ripper demons, Yog's eyes and scorpios with the demon spawners. */
const MINION_KINDS: ReadonlySet<MobKind> = new Set<MobKind>(['larva']);
/** Statistics.spawnersAlive: the demon spawners of the halls left alive. SEAM(levels): there are none here yet. */
export const spawnersAlive = (_ctx: Ctx): number => 0;

const MIN_ABILITY_CD = 10;
const MAX_ABILITY_CD = 15;
const MIN_SUMMON_CD = 10;
const MAX_SUMMON_CD = 15;

const fistsAlive = (ctx: Ctx): Mob[] => ctx.floor.mobs.filter((m) => isFist(m) && isAlive(m));

/* The hall (HallsBossLevel.occupyCell, seal, unseal) */

/** HallsBossLevel.occupyCell: two steps off the stairs, the hall seals. */
export function hallsOccupy(ctx: Ctx, hero: Hero): void {
  const { level } = ctx;
  if (level.map[level.entrance] === T.ENTRANCE && level.map[HALLS_EXIT] !== T.EXIT && distance(hero.pos, level.entrance) >= 2) sealHalls(ctx);
}

/** HallsBossLevel.seal: the stairs burn away, and Yog-Dzewa is in the middle of the hall. */
function sealHalls(ctx: Ctx): void {
  if (!lockFloor(ctx)) return;
  const { level, world, floor, rng } = ctx;
  setTerrain(level.map, level.entrance, T.EMPTY_SP);
  ctx.effects.push({ type: 'burnt', depth: ctx.depth, pos: level.entrance });
  const yog = scaleMob(world, createMob(`#${++world.nextId}`, 'yog', YOG_POS, 'hunting', floor.now));
  yog.boss = newYog(ctx);
  const there = charAt(world, ctx.depth, YOG_POS);
  if (there) {
    const free = N8.map((n) => YOG_POS + n).filter((c) => !charAt(world, ctx.depth, c));
    const to = free.length > 0 ? rng.element(free)! : YOG_POS + 2 * WIDTH;
    there.pos = to;
    ctx.effects.push({ type: 'pushed', depth: ctx.depth, mob: there.id, from: YOG_POS, to });
  }
  floor.mobs.push(yog);
  for (const h of heroesOn(world, ctx.depth)) observe(world, h);
  ctx.effects.push({ type: 'arena', depth: ctx.depth, sealed: true });
}

/** HallsBossLevel.unseal: the stairs come back, the way down opens. */
function unsealHalls(ctx: Ctx, yog: Mob): void {
  if (!unlockFloor(ctx)) return;
  const { level } = ctx;
  setTerrain(level.map, level.entrance, T.ENTRANCE);
  level.map[HALLS_EXIT] = T.EXIT;
  show(ctx, 'rise', { pos: HALLS_EXIT });
  for (const h of heroesOn(ctx.world, ctx.depth)) observe(ctx.world, h);
  ctx.effects.push({ type: 'arena', depth: ctx.depth, sealed: false });
  fight(ctx, yog, 'end');
}

/** YogDzewa's fists to come (one of each pair, in a shuffled order) and its summons, from the depth's own seed. */
function newYog(ctx: Ctx): NonNullable<Mob['boss']> {
  const rng = Rng.seeded(deriveSeed(ctx.world.run.seed, Stream.MOBS, ctx.depth, 1));
  const fists: MobKind[] = PAIRS.map(([a, b]) => (rng.int(2) === 0 ? a : b));
  rng.shuffle(fists);
  const regular: MobKind[] = [];
  for (let i = 0; i < 4; i++) regular.push(i >= spawnersAlive(ctx) ? 'larva' : 'larva');
  ctx.rng.shuffle(regular);
  return { phase: 0, abilityCooldown: 0, summonCooldown: 0, fistSummons: fists, regularSummons: regular, targetedCells: [] };
}

/** YogDzewa.updateVisibility: the hall's light, dimmer with every phase (a torch still lights it). */
function updateVisibility(ctx: Ctx, yog: Mob): void {
  const phase = yog.boss?.phase ?? 0;
  bossFloor(ctx.floor).viewDistance = phase > 1 && isAlive(yog) ? Math.max(4 - (phase - 1), 1) : 4;
  for (const h of heroesOn(ctx.world, ctx.depth)) observe(ctx.world, h);
}

/* Yog-Dzewa */

/** YogDzewa.notice: the fight begins. */
function yogNotice(ctx: Ctx, yog: Mob, hero?: Hero): void {
  if (!assignBar(ctx, yog)) return;
  yell(ctx, yog, 'notice', hero);
  fight(ctx, yog, 'start');
  // A Yog-Dzewa met anywhere but its hall (no fists dealt yet) is dealt them now.
  if (yog.boss?.regularSummons === undefined) yog.boss = { ...newYog(ctx), ...yog.boss };
  const b = bossMob(yog);
  if ((b.phase ?? 0) === 0) {
    b.phase = 1;
    b.summonCooldown = normalFloat(ctx.rng, MIN_SUMMON_CD, MAX_SUMMON_CD);
    b.abilityCooldown = normalFloat(ctx.rng, MIN_ABILITY_CD, MAX_ABILITY_CD);
  }
}

/** YogDzewa.act. */
function yogAct(ctx: Ctx, yog: Mob): void {
  const b = bossMob(yog);
  const hero = theHero(ctx);
  if ((b.phase ?? 0) === 0) {
    if (hero && heroView(ctx.world, hero)[yog.pos]) yogNotice(ctx, yog, hero);
    spendMob(yog, 1);
    return;
  }
  const phase = b.phase!;
  const targeted = b.targetedCells ?? [];
  // The beams marked last time strike now (held back while the hero is rooted).
  if (targeted.length > 0 && hero && hero.rooted <= 0) fireBeams(ctx, yog, targeted);
  if ((b.abilityCooldown ?? 0) <= 0 && hero) {
    const beams = 1 + Math.trunc((yog.ht - yog.hp) / Math.trunc((yog.ht * 4) / 10));
    const cells: number[] = [];
    const affected = new Set<number>();
    for (let i = 0; i < beams; i++) {
      let target = hero.pos;
      if (i !== 0) {
        let tries = 0;
        do {
          target = hero.pos + N8[ctx.rng.int(8)]!;
        } while (trueDistance(yog.pos, hero.pos) > trueDistance(yog.pos, target) && ++tries < 100);
      }
      cells.push(target);
      for (const c of ballistica(ctx, yog.pos, target, WONT_STOP).path) affected.add(c);
    }
    // One beam fewer if they would leave the hero nowhere to step.
    if (N9.every((n) => affected.has(hero.pos + n) || !isPassable(ctx.level, hero.pos + n))) cells.pop();
    const delay = Math.min(3, Math.max(1, Math.ceil(Math.max(0, hero.time - ctx.floor.now))));
    const marked = new Set<number>();
    for (const c of cells) for (const p of ballistica(ctx, yog.pos, c, WONT_STOP).path) marked.add(p);
    b.targetedCells = cells;
    show(ctx, 'targeted', { mob: yog.id, cells: [...marked], value: delay });
    spendMob(yog, delay);
    ctx.effects.push({ type: 'interrupted', hero: hero.id, reason: 'beams' });
    b.abilityCooldown = Math.fround((b.abilityCooldown ?? 0) + normalFloat(ctx.rng, MIN_ABILITY_CD, MAX_ABILITY_CD) - (phase - 1));
  } else {
    spendMob(yog, 1);
  }
  for (let guard = 0; (b.summonCooldown ?? 0) <= 0 && guard < 50; guard++) {
    const kind = b.regularSummons!.shift()!;
    b.regularSummons!.push(kind);
    let spawn = -1;
    for (const n of N8) {
      const c = yog.pos + n;
      if (charAt(ctx.world, ctx.depth, c) || !hero) continue;
      if (spawn === -1 || trueDistance(hero.pos, spawn) > trueDistance(hero.pos, c)) spawn = c;
    }
    if (spawn === -1) {
      for (const n of N8) {
        const c = yog.pos + n;
        const there = charAt(ctx.world, ctx.depth, c);
        if (!there || isHero(there) || there.kind !== 'sheep' || !hero) continue;
        if (spawn === -1 || trueDistance(hero.pos, spawn) > trueDistance(hero.pos, c)) spawn = c;
      }
      const sheep = spawn === -1 ? undefined : charAt(ctx.world, ctx.depth, spawn);
      if (sheep && !isHero(sheep)) {
        sheep.hp = 0;
        killMob(ctx, sheep);
      }
    }
    if (spawn === -1) break;
    const minion = scaleMob(ctx.world, createMob(`#${++ctx.world.nextId}`, kind, spawn, 'wandering', ctx.floor.now + 1));
    minion.minion = true;
    minion.target = hero?.pos ?? spawn;
    ctx.floor.mobs.push(minion);
    ctx.effects.push({ type: 'pushed', depth: ctx.depth, mob: minion.id, from: yog.pos, to: spawn });
    b.summonCooldown = Math.fround((b.summonCooldown ?? 0) + normalFloat(ctx.rng, MIN_SUMMON_CD, MAX_SUMMON_CD) - (phase - 1));
    if (fistsAlive(ctx).length > 0) b.summonCooldown += MIN_SUMMON_CD - (phase - 1);
  }
  if ((b.summonCooldown ?? 0) > 0) b.summonCooldown!--;
  if ((b.abilityCooldown ?? 0) > 0) b.abilityCooldown!--;
  // The last hundred: abilities and summons come very fast.
  if (phase === 5 && b.abilityCooldown! > 2) b.abilityCooldown = 2;
  if (phase === 5 && b.summonCooldown! > 3) b.summonCooldown = 3;
}

/** The death rays: 20 to 30 to everyone in their way (never Yog's own), burning what burns. */
function fireBeams(ctx: Ctx, yog: Mob, targets: number[]): void {
  const affected: Char[] = [];
  const ends: number[] = [];
  let burnt = false;
  for (const target of targets) {
    const beam = ballistica(ctx, yog.pos, target, WONT_STOP);
    ends.push(beam.collisionPos);
    for (const p of beam.path) {
      const ch = charAt(ctx.world, ctx.depth, p);
      if (ch && ch !== yog && (isHero(ch) || !ch.minion || ch.kind === 'bee') && !affected.includes(ch)) affected.push(ch);
      if (hasFlag(ctx.level.map[p]!, F.FLAMABLE)) {
        ctx.level.map[p] = T.EMBERS;
        ctx.effects.push({ type: 'burnt', depth: ctx.depth, pos: p });
        burnt = true;
      }
    }
  }
  show(ctx, 'beam', { mob: yog.id, pos: yog.pos, cells: ends });
  if (burnt) for (const h of heroesOn(ctx.world, ctx.depth)) observe(ctx.world, h);
  for (const ch of affected) {
    if (isFist(ch as Mob)) continue;
    // Char.hit with infinite accuracy: it always hits.
    const damage = ctx.rng.normalIntRange(20, 30);
    ctx.effects.push({ type: 'attack', depth: ctx.depth, attacker: yog.id, target: ch.id, hit: true, damage });
    hurt(ctx, ch, damage, yog);
  }
  bossMob(yog).targetedCells = [];
}

/** YogDzewa.processFistDeath: the last fist gone, Yog fights on alone, summoning a burst of minions. */
function processFistDeath(ctx: Ctx): void {
  const yog = ctx.floor.mobs.find((m) => m.kind === 'yog');
  if (!yog) return;
  const b = bossMob(yog);
  if (b.phase === 4 && fistsAlive(ctx).length === 0) {
    yell(ctx, yog, 'hope');
    b.summonCooldown = -15;
    b.phase = 5;
    bleed(ctx, yog, true);
  }
}

/** YogDzewa.addFist: up out of the pit, to the cell below it (or beside that). */
function addFist(ctx: Ctx, yog: Mob, kind: MobKind): void {
  const b = bossMob(yog);
  if ((b.abilityCooldown ?? 0) < 5) b.abilityCooldown = 5;
  if ((b.summonCooldown ?? 0) < 5) b.summonCooldown = 5;
  const target = HALLS_EXIT + WIDTH;
  const sheepOrFree = (c: number): boolean => {
    const there = charAt(ctx.world, ctx.depth, c);
    return !there || (!isHero(there) && there.kind === 'sheep');
  };
  let pos = HALLS_EXIT;
  if (sheepOrFree(target)) pos = target;
  else if (sheepOrFree(target - 1)) pos = target - 1;
  else if (sheepOrFree(target + 1)) pos = target + 1;
  const sheep = charAt(ctx.world, ctx.depth, pos);
  if (sheep && !isHero(sheep)) {
    sheep.hp = 0;
    killMob(ctx, sheep);
  }
  const fist = scaleMob(ctx.world, createMob(`#${++ctx.world.nextId}`, kind, pos, 'hunting', ctx.floor.now + 4));
  fist.boss = { rangedCooldown: 0 };
  fist.enemy = theHero(ctx)?.id ?? null;
  ctx.floor.mobs.push(fist);
  show(ctx, 'rise', { mob: fist.id, pos: HALLS_EXIT, to: pos });
}

export const YOG: BossRules = {
  attackSkill: () => Infinity,
  act(ctx, yog) {
    yogAct(ctx, yog);
    return true;
  },
  canAttack: () => false,
  getCloser: () => false,
  beckon: false,
  notice(ctx, yog, hero) {
    yogNotice(ctx, yog, hero);
  },
  beforeDamage(ctx, yog, damage) {
    const b = bossMob(yog);
    if ((b.phase ?? 0) === 0 || fistsAlive(ctx).length > 0) {
      say(ctx, yog, 'invulnerable', 'status');
      return null;
    }
    return damage;
  },
  afterDamage(ctx, yog, before, source) {
    const b = bossMob(yog);
    const phase = b.phase ?? 0;
    // (Shattered's 300 and 100 of 1000: tenths here, for a party's sturdier Yog.)
    const step = Math.trunc((yog.ht * 3) / 10);
    if (phase < 4) yog.hp = Math.max(yog.hp, yog.ht - step * phase);
    else if (phase === 4) yog.hp = Math.max(yog.hp, Math.trunc(yog.ht / 10));
    const taken = before - yog.hp;
    if (taken > 0) {
      b.abilityCooldown = (b.abilityCooldown ?? 0) - taken / 10;
      b.summonCooldown = (b.summonCooldown ?? 0) - taken / 10;
    }
    if (phase < 4 && yog.hp <= yog.ht - step * phase) {
      b.phase = phase + 1;
      updateVisibility(ctx, yog);
      say(ctx, yog, 'darkness', 'negative');
      say(ctx, yog, 'invulnerable', 'status');
      show(ctx, 'dark', { mob: yog.id, value: bossFloor(ctx.floor).viewDistance });
      const kind = b.fistSummons?.shift();
      if (kind) addFist(ctx, yog, kind);
      if ((b.abilityCooldown ?? 0) < 5) b.abilityCooldown = 5;
      if ((b.summonCooldown ?? 0) < 5) b.summonCooldown = 5;
      fight(ctx, yog, 'phase', b.phase);
    }
    bossHurt(ctx, yog, taken, 1 / 2);
    // YogDzewa.aggro: its minions nearby turn on whoever hurt it.
    if (typeof source !== 'string') {
      for (const m of ctx.floor.mobs) {
        if (m.minion && MINION_KINDS.has(m.kind) && distance(yog.pos, m.pos) <= 4) {
          m.state = 'hunting';
          m.enemy = source.id;
          m.target = source.pos;
        }
      }
    }
    // YogDzewa.isAlive: it cannot die before its last phase.
    if ((b.phase ?? 0) !== 5 && yog.hp <= 0) yog.hp = 1;
  },
  die(ctx, yog) {
    for (const m of [...ctx.floor.mobs]) {
      if (m.minion && MINION_KINDS.has(m.kind)) {
        m.hp = 0;
        killMob(ctx, m);
      }
    }
    bossMob(yog).phase = 6;
    updateVisibility(ctx, yog);
    unsealHalls(ctx, yog);
    yell(ctx, yog, 'defeated');
  },
  immune: new Set(['gas', 'burning', 'paralysis', 'sleep', 'terror', 'charm', 'rooted', 'blind', 'dizzy', 'amok']),
};

/* The fists */

/** YogFist.isNearYog: within four steps of where Yog rises, a fist cannot be hurt. */
const nearYog = (fist: Mob): boolean => distance(fist.pos, YOG_POS) <= 4;

const canRangedInMelee = (fist: Mob): boolean => fist.kind !== 'brightFist' && fist.kind !== 'darkFist';

/** YogFist.zap for each fist. */
function zap(ctx: Ctx, fist: Mob, enemy: Hero): void {
  spendMob(fist, 1);
  show(ctx, 'bolt', { mob: fist.id, pos: fist.pos, to: enemy.pos, value: FIST_ORDER.indexOf(fist.kind) });
  switch (fist.kind) {
    case 'burningFist': {
      if (isWater(ctx.level.map[enemy.pos]!)) {
        setTerrain(ctx.level.map, enemy.pos, T.EMPTY);
        show(ctx, 'steam', { cells: [enemy.pos] });
      } else {
        enemy.burning = Math.max(enemy.burning, 8);
      }
      // Fire round the target. SEAM(wands): Shattered's Fire blob; a burst of flame stands in.
      for (const n of N9) {
        const c = enemy.pos + n;
        if (!isWater(ctx.level.map[c]!) && !hasFlag(ctx.level.map[c]!, F.SOLID)) burst(ctx, c, 'fire', 0, true);
      }
      return;
    }
    case 'soiledFist': {
      if (magicHit(ctx, fist, enemy)) enemy.rooted = Math.max(enemy.rooted, 3);
      else ctx.effects.push({ type: 'attack', depth: ctx.depth, attacker: fist.id, target: enemy.id, hit: false, damage: 0 });
      const grass: number[] = [];
      for (const n of N9) {
        const c = enemy.pos + n;
        if (!canSpreadGrass(ctx, c)) continue;
        ctx.level.map[c] = ctx.rng.int(5) === 0 ? T.HIGH_GRASS : T.GRASS;
        grass.push(c);
      }
      show(ctx, 'grass', { cells: grass });
      for (const h of heroesOn(ctx.world, ctx.depth)) observe(ctx.world, h);
      return;
    }
    case 'rottingFist':
      seedGas(ctx, enemy.pos, 'toxic', 100);
      return;
    case 'rustedFist':
      enemy.crippled = Math.max(enemy.crippled, 4);
      return;
    case 'brightFist':
    case 'darkFist': {
      if (!magicHit(ctx, fist, enemy)) {
        ctx.effects.push({ type: 'attack', depth: ctx.depth, attacker: fist.id, target: enemy.id, hit: false, damage: 0 });
        return;
      }
      const damage = ctx.rng.normalIntRange(10, 20);
      ctx.effects.push({ type: 'attack', depth: ctx.depth, attacker: fist.id, target: enemy.id, hit: true, damage });
      hurt(ctx, enemy, damage, fist);
      if (!isAlive(enemy)) return;
      // The light beam blinds a while; the dark bolt eats away a torch's light (Light.weaken(50)).
      if (fist.kind === 'brightFist') enemy.blind = Math.max(enemy.blind ?? 0, 5);
      else enemy.light = Math.max(0, enemy.light - 50);
      return;
    }
  }
}

/** The fists, in the order the client knows their bolts. */
export const FIST_ORDER: readonly MobKind[] = ['burningFist', 'soiledFist', 'rottingFist', 'rustedFist', 'brightFist', 'darkFist'];

/** SoiledFist.canSpreadGrass: not within four steps of Yog, not on rock, not in tall grass already. */
function canSpreadGrass(ctx: Ctx, cell: number): boolean {
  const t = ctx.level.map[cell]!;
  return distance(cell, YOG_POS) > 4 && !hasFlag(t, F.SOLID) && t !== T.HIGH_GRASS && cell >= 0 && cell < LENGTH;
}

/** The fists' own turns before an ordinary one: the burning fist's flames and steam, the soiled fist's grass, the rotting fist's healing. */
function fistTurn(ctx: Ctx, fist: Mob): void {
  const b = bossMob(fist);
  if ((fist.paralysed ?? 0) <= 0 && (b.rangedCooldown ?? 0) > 0) b.rangedCooldown!--;
  const hero = theHero(ctx);
  if (hero && hero.invisible <= 0 && fist.state === 'wandering') {
    fist.state = 'hunting';
    fist.target = hero.pos;
    fist.enemy = hero.id;
  }
  const { level, rng } = ctx;
  switch (fist.kind) {
    case 'burningFist': {
      const steam: number[] = [];
      if (isWater(level.map[fist.pos]!)) {
        setTerrain(level.map, fist.pos, T.EMPTY);
        steam.push(fist.pos);
      }
      const evaporated = rng.chances([0, 1, 2]);
      for (let i = 0; i < evaporated; i++) {
        const c = fist.pos + N8[rng.int(8)]!;
        if (isWater(level.map[c]!)) {
          setTerrain(level.map, c, T.EMPTY);
          steam.push(c);
        }
      }
      if (steam.length > 0) show(ctx, 'steam', { cells: steam });
      for (const n of N9) {
        const c = fist.pos + n;
        if (!isWater(level.map[c]!) && !hasFlag(level.map[c]!, F.SOLID) && c !== fist.pos) burst(ctx, c, 'fire', 0, true);
      }
      break;
    }
    case 'soiledFist': {
      const furrowed = rng.chances([0, 2, 1]);
      for (let i = 0; i < furrowed; i++) {
        const c = fist.pos + N9[rng.int(9)]!;
        if (level.map[c] === T.GRASS) level.map[c] = T.HIGH_GRASS;
      }
      const grass: number[] = [];
      for (const n of N9) {
        const c = fist.pos + n;
        if (canSpreadGrass(ctx, c)) {
          level.map[c] = T.GRASS;
          grass.push(c);
        }
      }
      if (grass.length > 0) show(ctx, 'grass', { cells: grass });
      for (const h of heroesOn(ctx.world, ctx.depth)) observe(ctx.world, h);
      break;
    }
    case 'rottingFist':
      if (isWater(level.map[fist.pos]!) && fist.hp < fist.ht) {
        const heal = Math.trunc(fist.ht / 50);
        fist.hp = Math.min(fist.ht, fist.hp + heal);
        ctx.effects.push({ type: 'healedMob', depth: ctx.depth, mob: fist.id, amount: heal });
      }
      break;
  }
}

/** BrightFist and DarkFist at half health: away somewhere out of sight with a flash, the hero blinded or their light gone. */
function fistFlees(ctx: Ctx, fist: Mob): void {
  const hero = theHero(ctx);
  if (!hero) return;
  if (fist.kind === 'brightFist') hero.blind = Math.max(hero.blind ?? 0, 15);
  else hero.light = 0;
  const fov = heroView(ctx.world, hero);
  let cell = -1;
  for (let tries = 0; tries < 2000; tries++) {
    const i = ctx.rng.int(LENGTH);
    if (fov[i] || hasFlag(ctx.level.map[i]!, F.SOLID) || charAt(ctx.world, ctx.depth, i)) continue;
    if (getStep(i, HALLS_EXIT, (c) => isPassable(ctx.level, c)) === -1) continue;
    cell = i;
    break;
  }
  if (cell !== -1) {
    show(ctx, 'teleport', { mob: fist.id, pos: fist.pos, to: cell });
    appear(ctx, fist, cell);
  }
  fist.state = 'wandering';
  show(ctx, fist.kind === 'brightFist' ? 'flash' : 'flashDark', { value: 0xffffff });
  say(ctx, fist, 'teleport', 'warn');
}

const FIST: BossRules = {
  attackSkill: () => 36,
  defenseSkill: () => 20,
  damageRoll: (ctx, fist) => (fist.kind === 'rustedFist' ? ctx.rng.normalIntRange(22, 44) : ctx.rng.normalIntRange(18, 36)),
  drRoll: (ctx) => ctx.rng.normalIntRange(0, 15),
  sight: 4,
  attackProc(ctx, fist, enemy, damage) {
    // RottingFist.attackProc: half its blows leave caustic ooze.
    if (fist.kind === 'rottingFist' && ctx.rng.int(2) === 0) applyOoze(ctx, enemy);
    return damage;
  },
  act(ctx, fist) {
    fistTurn(ctx, fist);
    return false;
  },
  canAttack(ctx, fist, enemy) {
    if ((fist.boss?.rangedCooldown ?? 0) <= 0) return ballistica(ctx, fist.pos, enemy.pos, MAGIC_BOLT).collisionPos === enemy.pos;
    return distance(fist.pos, enemy.pos) === 1;
  },
  doAttack(ctx, fist, enemy) {
    const b = bossMob(fist);
    if (distance(fist.pos, enemy.pos) === 1 && (!canRangedInMelee(fist) || (b.rangedCooldown ?? 0) > 0)) {
      meleeAttack(ctx, fist, enemy);
      return;
    }
    if (canRangedInMelee(fist)) b.rangedCooldown = Math.fround((b.rangedCooldown ?? 0) + normalFloat(ctx.rng, 8, 12));
    zap(ctx, fist, enemy);
  },
  beforeDamage(ctx, fist, damage, source) {
    if (nearYog(fist)) {
      if (!fist.boss?.invulnWarned) {
        bossMob(fist).invulnWarned = true;
        say(ctx, fist, 'invuln_warn', 'warn');
      }
      say(ctx, fist, 'invulnerable', 'status');
      return null;
    }
    switch (fist.kind) {
      case 'soiledFist': {
        const grass = N9.filter((n) => ctx.level.map[fist.pos + n] === T.HIGH_GRASS).length;
        if (grass > 0) damage = Math.round((damage * (6 - grass)) / 6);
        // It can be set alight, but takes no harm from burning.
        if (source === 'burning') return null;
        return damage;
      }
      case 'rottingFist':
        // RottingFist.damage: the hurt is turned into bleeding.
        if (source === 'bleeding') return damage;
        fist.bleeding = Math.max(fist.bleeding ?? 0, damage * 0.6);
        say(ctx, fist, `bleeding:${Math.trunc(fist.bleeding)}`, 'status');
        return null;
      case 'rustedFist':
        // RustedFist.damage: deferred, a tenth at a time.
        if (source === 'deferred') return damage;
        deferDamage(ctx, fist, damage);
        say(ctx, fist, `deferred:${damage}`, 'status');
        return null;
      default:
        return damage;
    }
  },
  afterDamage(ctx, fist, before) {
    bossHurt(ctx, fist, before - fist.hp, 1 / 2);
    if ((fist.kind === 'brightFist' || fist.kind === 'darkFist') && isAlive(fist) && before > fist.ht / 2 && fist.hp <= fist.ht / 2) {
      fist.hp = Math.trunc(fist.ht / 2);
      fistFlees(ctx, fist);
    }
  },
  die(ctx, fist) {
    const hero = theHero(ctx);
    if (hero && fist.kind === 'brightFist') {
      hero.blind = Math.max(hero.blind ?? 0, 30);
      show(ctx, 'flash', { value: 0xffffff });
    }
    if (hero && fist.kind === 'darkFist') {
      hero.light = 0;
      show(ctx, 'flashDark', {});
    }
    processFistDeath(ctx);
  },
  immune: new Set(['sleep']),
};

export const FISTS: Partial<Record<MobKind, BossRules>> = {
  burningFist: { ...FIST, immune: new Set(['sleep', 'frost', 'burning']) },
  soiledFist: FIST,
  rottingFist: { ...FIST, immune: new Set(['sleep', 'gas']) },
  rustedFist: FIST,
  brightFist: FIST,
  darkFist: FIST,
};

/** YogDzewa.Larva: Light.DISTANCE sight. */
export const LARVA: BossRules = {
  attackSkill: () => 30,
  defenseSkill: () => 12,
  damageRoll: (ctx) => ctx.rng.normalIntRange(15, 25),
  drRoll: (ctx) => ctx.rng.normalIntRange(0, 4),
  sight: 4,
};
