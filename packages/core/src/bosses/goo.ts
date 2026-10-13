import { type Hero, isAlive, type Mob } from '../actors';
import { attack } from '../combat';
import { ballistica, IGNORE_SOFT_SOLID, STOP_SOLID, STOP_TARGET } from '../ballistica';
import { type Char, type Ctx, dropItem, isHero, isPassable, isWater } from '../floor';
import { createItem } from '../items';
import { adjacent, distance, LENGTH, WIDTH } from '../level/geometry';
import { setTerrain } from '../level/flags';
import { T } from '../level/terrain';
import { bossHealed, bossHurt } from '../hero';
import { spendMob } from '../ai';
import {
  assignBar, barAssigned, bleed, bossMob, fight, lockFloor, N8, say, show, unlockFloor, yell,
} from './common';
import type { BossRules } from './rules';

/*
 * Goo (actors/mobs/Goo.java), in the sewers' boss level (SewerBossLevel): it
 * sleeps in its nest of murky water, which heals it; awake, it seals the
 * level (the stairs flood). Now and then it pumps itself up instead of
 * striking (a turn to swell, «!!!»), then lets go at anything within two
 * steps, three times as hard; below half its health it bleeds black ooze,
 * strikes surer and harder, and pumps up more often. Its touch may leave
 * caustic ooze. Slain, it leaves its worn key and two to four blobs of goo.
 */

/** Ooze.DURATION. */
export const OOZE_TURNS = 20;

const enraged = (mob: Mob): boolean => mob.hp * 2 <= mob.ht;

/** Ooze.set on a hero: caustic ooze that eats at them until washed off in water. */
export function applyOoze(ctx: Ctx, char: Char): void {
  if (!isHero(char)) return;
  if (char.ooze < 0) ctx.effects.push({ type: 'oozed', hero: char.id });
  char.ooze = 0;
  char.oozeLeft = OOZE_TURNS;
  char.oozeActed = false;
}

/**
 * Ooze.act, a turn's worth on a hero: washed away in water once it has acted; else it hurts (1 a turn
 * against Goo, half that above it, 1 + depth/5 below) and wears off after twenty turns.
 */
export function oozeTurn(ctx: Ctx, hero: Hero, hurtHero: (damage: number) => void): void {
  if (hero.ooze < 0) return;
  hero.oozeLeft ??= OOZE_TURNS;
  const water = isWater(ctx.level.map[hero.pos]!) && !((hero.levitating ?? 0) > 0);
  if (hero.oozeActed && water) {
    clearOoze(hero);
    return;
  }
  hero.oozeActed = true;
  const depth = ctx.depth;
  let damage = 0;
  if (depth > 5) damage = 1 + Math.trunc(depth / 5);
  else if (depth === 5) damage = 1;
  else if (Math.trunc(hero.oozeLeft) % 2 === 0) damage = 1;
  if (damage > 0) hurtHero(damage);
  hero.oozeLeft -= 1;
  if (hero.oozeLeft <= 0 || (isAlive(hero) && water)) clearOoze(hero);
}

export function clearOoze(hero: Hero): void {
  hero.ooze = -1;
  delete hero.oozeLeft;
  delete hero.oozeActed;
}

/** SewerBossLevel.seal: the floor is locked, and the stairs flood. */
export function sealSewers(ctx: Ctx, goo: Mob): void {
  // (Goo also comes to the arena of waves, which has no stairs to flood.)
  if (ctx.world.arena || ctx.depth !== 5 || !lockFloor(ctx)) return;
  const { level } = ctx;
  setTerrain(level.map, level.entrance, T.WATER);
  ctx.effects.push({ type: 'arena', depth: ctx.depth, sealed: true });
  fight(ctx, goo, 'start');
}

/** SewerBossLevel.unseal: the stairs are back. */
export function unsealSewers(ctx: Ctx, goo: Mob): void {
  if (ctx.world.arena || ctx.depth !== 5 || !unlockFloor(ctx)) return;
  const { level } = ctx;
  setTerrain(level.map, level.entrance, T.ENTRANCE);
  ctx.effects.push({ type: 'arena', depth: ctx.depth, sealed: false });
  fight(ctx, goo, 'end');
}

/** Goo.canAttack when pumped up: anything within two steps, the line clear both ways. */
function pumpedReach(ctx: Ctx, mob: Mob, cell: number): boolean {
  const params = STOP_TARGET | STOP_SOLID | IGNORE_SOFT_SOLID;
  return distance(cell, mob.pos) <= 2 &&
    ballistica(ctx, mob.pos, cell, params).collisionPos === cell &&
    ballistica(ctx, cell, mob.pos, params).collisionPos === mob.pos;
}

/** GooSprite.pumpUp's warning: every cell in sight it could strike from where it is. */
function pumpCells(ctx: Ctx, mob: Mob): number[] {
  const cells: number[] = [];
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const cell = mob.pos + dx + dy * WIDTH;
      if ((dx !== 0 || dy !== 0) && cell >= 0 && cell < LENGTH && Math.abs((cell % WIDTH) - (mob.pos % WIDTH)) <= 2 && pumpedReach(ctx, mob, cell)) {
        cells.push(cell);
      }
    }
  }
  return cells;
}

function pumpUp(ctx: Ctx, mob: Mob, level: number): void {
  show(ctx, 'pumpUp', { mob: mob.id, value: level, cells: pumpCells(ctx, mob) });
}

/** Goo.getCloser and getFurther: moving lets the swelling go. */
export function gooDeflates(ctx: Ctx, mob: Mob): void {
  const boss = bossMob(mob);
  if ((boss.pumpedUp ?? 0) !== 0) {
    boss.pumpedUp = 0;
    show(ctx, 'pumpUp', { mob: mob.id, value: 0 });
  }
}

export const GOO: BossRules = {
  attackSkill(_ctx, mob) {
    let attack = enraged(mob) ? 15 : 10;
    if ((mob.boss?.pumpedUp ?? 0) > 0) attack *= 2;
    return attack;
  },
  defenseSkill(_ctx, mob) {
    return Math.trunc(8 * (enraged(mob) ? 1.5 : 1));
  },
  damageRoll(ctx, mob) {
    const max = enraged(mob) ? 12 : 8;
    const boss = bossMob(mob);
    if ((boss.pumpedUp ?? 0) > 0) {
      boss.pumpedUp = 0;
      return ctx.rng.normalIntRange(3, max * 3);
    }
    return ctx.rng.normalIntRange(1, max);
  },
  drRoll(ctx) {
    return ctx.rng.normalIntRange(0, 2);
  },
  attackProc(ctx, mob, enemy, damage) {
    // One blow in three leaves caustic ooze.
    if (ctx.rng.int(3) === 0) applyOoze(ctx, enemy);
    return damage;
  },

  act(ctx, mob) {
    const boss = bossMob(mob);
    if (mob.state !== 'hunting' && (boss.pumpedUp ?? 0) > 0) {
      boss.pumpedUp = 0;
      show(ctx, 'pumpUp', { mob: mob.id, value: 0 });
    }
    // The murky water heals it, and keeps the sealed floor's healing from going on.
    if (isWater(ctx.level.map[mob.pos]!) && mob.hp < mob.ht) {
      const inc = boss.healInc ?? 1;
      mob.hp += inc;
      bossHealed(ctx, inc * 1.5);
      ctx.effects.push({ type: 'healedMob', depth: ctx.depth, mob: mob.id, amount: inc });
      if (mob.hp * 2 > mob.ht) {
        bleed(ctx, mob, false);
        mob.hp = Math.min(mob.hp, mob.ht);
      }
    } else {
      boss.healInc = 1;
    }
    if (mob.state !== 'sleeping') sealSewers(ctx, mob);
    return false;
  },

  canAttack(ctx, mob, enemy) {
    if ((mob.boss?.pumpedUp ?? 0) > 0) return pumpedReach(ctx, mob, enemy.pos);
    return adjacent(mob.pos, enemy.pos);
  },

  doAttack(ctx, mob, enemy) {
    const boss = bossMob(mob);
    const pumped = boss.pumpedUp ?? 0;
    if (pumped === 1) {
      boss.pumpedUp = 2;
      pumpUp(ctx, mob, 2);
      spendMob(mob, 1);
    } else if (pumped >= 2 || ctx.rng.int(enraged(mob) ? 2 : 5) > 0) {
      if (pumped >= 2) show(ctx, 'pumpAttack', { mob: mob.id, to: enemy.pos });
      attack(ctx, mob, enemy);
      // Goo.attack: the swelling is spent, hit or miss.
      boss.pumpedUp = 0;
      spendMob(mob, 1);
    } else {
      boss.pumpedUp = 1;
      spendMob(mob, 1);
      pumpUp(ctx, mob, 1);
      say(ctx, mob, '!!!', 'status');
      say(ctx, mob, 'pumpup', 'negative');
    }
  },

  getCloser(ctx, mob) {
    gooDeflates(ctx, mob);
    return undefined;
  },

  notice(ctx, mob, hero) {
    if (barAssigned(ctx)) return;
    assignBar(ctx, mob);
    sealSewers(ctx, mob);
    yell(ctx, mob, 'notice', hero);
  },

  beforeDamage(ctx, mob, damage) {
    if (!barAssigned(ctx)) {
      assignBar(ctx, mob);
      sealSewers(ctx, mob);
    }
    return damage;
  },

  afterDamage(ctx, mob, before) {
    if (enraged(mob) && before * 2 > mob.ht && isAlive(mob)) {
      bleed(ctx, mob, true);
      say(ctx, mob, 'enraged', 'status');
      yell(ctx, mob, 'gluuurp');
    }
    bossHurt(ctx, mob, before - mob.hp, 1.5);
  },

  die(ctx, mob) {
    unsealSewers(ctx, mob);
    // Its worn key, for the locked way down (the arena of waves has none).
    if (!ctx.world.arena) dropItem(ctx.floor, mob.pos, { ...createItem('key.skeleton'), depth: ctx.depth });
    // 60% two blobs, 30% three, 10% four.
    const blobs = ctx.rng.chances([0, 0, 6, 3, 1]);
    for (let i = 0; i < blobs; i++) {
      let ofs: number;
      let tries = 0;
      do {
        ofs = N8[ctx.rng.int(8)]!;
      } while (!isPassable(ctx.level, mob.pos + ofs) && ++tries < 100);
      dropItem(ctx.floor, mob.pos + ofs, createItem('quest.gooBlob'));
    }
    yell(ctx, mob, 'defeated');
  },
};
