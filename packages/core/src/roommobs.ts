import { heroDefenseSkill, type Mob } from './actors';
import { hurt } from './combat';
import { type Ctx, heroesOn, heroView } from './floor';
import { cellX, cellY } from './level/geometry';
import { T } from './level/terrain';

/*
 * The sentry of a sentry room (SentryRoom.Sentry), which burns whoever walks its room's special floor.
 * (The halls' demon spawner is the monsters' stream's: mobs.ts.)
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
