import { createMob, heroDefenseSkill, type Mob, rollMob } from './actors';
import { hurt } from './combat';
import { charAt, type Ctx, enterCell, heroesOn, heroView, isPassable } from './floor';
import { cellX, cellY, NEIGHBOURS8 } from './level/geometry';
import { T } from './level/terrain';
import { scaleMob } from './party';

/*
 * The characters Shattered's special rooms bring that are no ordinary monsters: the sentry of a
 * sentry room (SentryRoom.Sentry), which burns whoever walks its room's special floor, and the halls'
 * demon spawner (DemonSpawner), which breeds ripper demons until destroyed.
 */

/**
 * SentryRoom.Sentry.act: while a hero it can see stands on the room's special floor, its charge runs
 * down by the time the hero spends (a turn at a time here, the hero's cooldown in Shattered); spent, it zaps them (a magic attack,
 * 20 + 2 x depth accuracy, 2 + depth/2 to 4 + depth damage, DeathGaze) and charges again for a turn.
 * Off the floor, it is back to its initial delay.
 */
export function sentryAct(ctx: Ctx, mob: Mob): void {
  const room = mob.room;
  mob.time += 1;
  if (!room) return;
  const hero = heroesOn(ctx.world, ctx.depth).find((h) => {
    const x = cellX(h.pos);
    const y = cellY(h.pos);
    return ctx.level.map[h.pos] === T.EMPTY_SP && x > room.left && x < room.right && y > room.top && y < room.bottom;
  });
  const sees = hero !== undefined && heroView(ctx.world, hero)[mob.pos] === true;
  if (!hero || !sees) {
    if (mob.curChargeDelay !== mob.initialChargeDelay) ctx.effects.push({ type: 'sentry', depth: ctx.depth, mob: mob.id, charging: false });
    mob.curChargeDelay = mob.initialChargeDelay;
    return;
  }
  const initial = mob.initialChargeDelay ?? 1;
  let charge = mob.curChargeDelay ?? initial;
  if (charge > 0.001) {
    if (charge === initial) ctx.effects.push({ type: 'sentry', depth: ctx.depth, mob: mob.id, charging: true });
    charge = Math.fround(charge - 1);
    // The pity mechanic: a hero walking in is stopped, so a mistap does not kill.
    ctx.effects.push({ type: 'interrupted', hero: hero.id, reason: 'sentry' });
  }
  if (charge <= 0.001) {
    charge = 1;
    ctx.effects.push({ type: 'zapped', depth: ctx.depth, from: mob.pos, to: hero.pos, bolt: 'beam' });
    // Char.hit with magic: the accuracy roll counts double.
    const accuracy = 20 + ctx.depth * 2;
    const hit = ctx.rng.floatMax(accuracy) * 2 >= ctx.rng.floatMax(heroDefenseSkill(hero));
    const damage = hit ? ctx.rng.normalIntRange(2 + Math.trunc(ctx.depth / 2), 4 + ctx.depth) : 0;
    ctx.effects.push({ type: 'attack', depth: ctx.depth, attacker: mob.id, target: hero.id, hit, damage });
    if (hit) hurt(ctx, hero, damage, mob);
  }
  mob.curChargeDelay = charge;
}

/**
 * DemonSpawner.act: its cooldown runs down a turn at a time; at nothing (it keeps no more than one
 * spawn in hand), a ripper demon comes out, hunting, beside it, and the cooldown goes up by 60 turns
 * (a third less over the deeper halls).
 */
export function spawnerAct(ctx: Ctx, mob: Mob): void {
  mob.time += 1;
  let cooldown = (mob.spawnCooldown ?? 0) - 1;
  if (cooldown <= 0) {
    if (cooldown < -20) cooldown = -20;
    const candidates = NEIGHBOURS8.map((n) => mob.pos + n).filter((c) => isPassable(ctx.level, c) && !charAt(ctx.world, ctx.depth, c));
    if (candidates.length > 0) {
      const pos = candidates[ctx.rng.int(candidates.length)]!;
      // SEAM(mobs): RipperDemon; one of the halls' monsters stands in.
      const spawn = scaleMob(ctx.world, createMob(`#${++ctx.world.nextId}`, rollMob(ctx.rng, ctx.depth, false), pos, 'hunting', ctx.floor.now + 1));
      const hero = heroesOn(ctx.world, ctx.depth)[0];
      if (hero) Object.assign(spawn, { enemy: hero.id, target: hero.pos });
      ctx.floor.mobs.push(spawn);
      enterCell(ctx.level, pos);
      ctx.effects.push({ type: 'appeared', depth: ctx.depth, mob: spawn.id, pos });
      cooldown += 60;
      if (ctx.depth > 21) cooldown -= Math.min(20, Math.fround((ctx.depth - 21) * 6.67));
    }
  }
  mob.spawnCooldown = cooldown;
  mob.alerted = false;
}

/** DemonSpawner.damage: a heavy blow is blunted (20 or more: 19 and the root of the rest), and every point hastens the next demon. */
export function spawnerDamage(mob: Mob, damage: number): number {
  if (damage >= 20) damage = 19 + Math.trunc((Math.sqrt(8 * (damage - 19) + 1) - 1) / 2);
  mob.spawnCooldown = (mob.spawnCooldown ?? 0) - damage;
  return damage;
}
