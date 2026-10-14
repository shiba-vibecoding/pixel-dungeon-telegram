import { getCloser } from '../ai';
import { castShadow, terrainBlocksSight, viewDistance } from '../fov';
import { attack } from '../combat';
import { type Mob, mobStats, isAlive, type Hero } from '../actors';
import { type Ctx, heroView, isHero, heroesOn } from '../floor';
import { distance, adjacent, LENGTH } from '../level/geometry';
import { markTurns } from './state';
import { mobConditions } from '../traps';

/* The Cleric's allies: the one Power of Many empowers, the light ally it can conjure, the one held in stasis. */

/** PowerOfMany.getPoweredAlly: whoever the Cleric has empowered on the level. */
export function poweredAlly(ctx: Pick<Ctx, 'floor'>): Mob | undefined {
  return ctx.floor.mobs.find((mob) => isAlive(mob) && markTurns(mob, 'power') > 0);
}

/** Stasis.getStasisAlly: the ally put out of time, waiting to come back. */
export const stasisAlly = (hero: Hero): Mob | undefined => hero.cls?.stasis?.ally;

const TICK = 1;
const spend = (mob: Mob, time: number): void => {
  mob.time += time;
};

/**
 * LightAlly.act (a DirectableAlly): it lives while Power of Many does; keeps by the hero (twice as fast when they are apart) or
 * holds the place it was sent to, and goes for a foe in sight, or the one it was told to attack.
 */
export function lightAllyAct(ctx: Ctx, mob: Mob): void {
  const { world, depth } = ctx;
  if (mobConditions(ctx, mob)) {
    spend(mob, TICK);
    return;
  }
  if (markTurns(mob, 'power') <= 0) {
    mob.hp = 0;
    ctx.floor.mobs.splice(ctx.floor.mobs.indexOf(mob), 1);
    ctx.effects.push({ type: 'faded', depth, mob: mob.id, pos: mob.pos });
    return;
  }
  const hero = heroesOn(world, depth).find((h) => h.id === mob.owner);
  const fov = castShadow(mob.pos, terrainBlocksSight(ctx.level.map), viewDistance(depth));
  const heroFov = hero ? heroView(world, hero) : new Array<boolean>(LENGTH).fill(false);
  const hostile = (other: Mob): boolean => other !== mob && !other.ally && other.state !== 'passive' && isAlive(other);
  const directed = (mob.directed ??= { owner: mob.owner ?? '', defend: -1, moving: false });
  let foe = ctx.floor.mobs.find((other) => other.id === mob.enemy && hostile(other) && fov[other.pos]);
  if (!foe && !directed.moving) {
    for (const other of ctx.floor.mobs) {
      if (hostile(other) && fov[other.pos] && other.state !== 'sleeping' && (!foe || distance(mob.pos, other.pos) < distance(mob.pos, foe.pos))) foe = other;
    }
  }
  mob.enemy = foe?.id ?? null;
  if (foe && (directed.defend === -1 || !heroFov[directed.defend] || adjacent(mob.pos, foe.pos))) {
    if (adjacent(mob.pos, foe.pos)) {
      attack(ctx, mob, foe);
      if (isAlive(foe)) foe.beeFoe = mob.id;
      spend(mob, mobStats(mob).attackDelay ?? TICK);
      return;
    }
    if (getCloser(ctx, mob, foe.pos, fov)) {
      spend(mob, 1);
      return;
    }
  }
  const goal = directed.defend !== -1 ? directed.defend : hero && hero.depth === depth ? hero.pos : mob.pos;
  // Twice as fast back to the hero.
  const speed = directed.defend === -1 && hero && distance(mob.pos, hero.pos) > 1 ? 2 : 1;
  if (goal !== mob.pos && !(goal === hero?.pos && adjacent(mob.pos, goal)) && getCloser(ctx, mob, goal, fov)) {
    spend(mob, 1 / speed);
    if (mob.pos === directed.defend) directed.moving = false;
    return;
  }
  if (directed.moving) {
    directed.defend = mob.pos;
    directed.moving = false;
  }
  spend(mob, TICK);
}

export { isHero };
