import { createMob, type Hero, isAlive, type Mob } from '../actors';
import { dispelInvisibility } from '../artifacts';
import { type Ctx, canEnter, charAt, enterCell, heroView, isHero } from '../floor';
import { F, hasFlag } from '../level/terrain';
import { LENGTH } from '../level/geometry';
import type { World } from '../world';
import { ABILITY_DEFS, chargeUse, spendArmorCharge } from './abilities';
import { stasisAlly } from './cleric-allies';
import { ASCEND_TURNS, ascend } from './cleric-t4';
import { addShield, say, tell } from './common';
import { cs, prolongMark } from './state';

export { bodyDuration, doTrinity, trinityCost, trinityProblem } from './trinity';

/* The Cleric's armour abilities: ascended form and power of many (trinity.ts has the third). */

const MSG = 'actors.hero.abilities.cleric.';

/* Ascended form */

/** AscendedForm (35 charge; baseChargeUse 50): nothing to refuse. */
export const ascendedProblem = (_world: World, _hero: Hero, _cell: number | undefined): string | null => null;

/** AscendedForm.activate: the buff is made, or refreshed (ten turns again, and the shield no lower than thirty). */
export function doAscend(ctx: Ctx, hero: Hero, _cell: number | undefined): number {
  const cost = chargeUse(hero, ABILITY_DEFS.ascendedForm);
  const old = cs(hero).ascend;
  if (old) {
    old.left = ASCEND_TURNS;
    old.shield = Math.max(old.shield, 30);
  } else {
    ascend(ctx, hero);
  }
  say(ctx, hero, { k: 'operate' });
  say(ctx, hero, { k: 'sound', name: 'chargeup' });
  say(ctx, hero, { k: 'spell', at: hero.pos, name: 'flareYellow' });
  spendArmorCharge(hero, cost);
  dispelInvisibility(ctx, hero);
  return 1;
}

/* Power of many */

/** PowerOfMany.getPoweredAlly: whoever carries the buff. */
const empowered = (world: World, hero: Hero): Mob | undefined =>
  world.floors[hero.depth]?.mobs.find((mob) => isAlive(mob) && (mob.marks?.t?.power ?? 0) > 0);

/** PowerOfMany.chargeUse: nothing while the light ally lives, for it is only directed. */
export const powerCost = (world: World | undefined, hero: Hero): number =>
  world && empowered(world, hero)?.kind === 'lightAlly' ? 0 : ABILITY_DEFS.powerOfMany.cost;

/** Whether the Cleric already has an ally empowered, or one held in stasis (PrismaticGuard and RockArmor too, once those exist here). */
const allyExists = (world: World, hero: Hero): boolean => empowered(world, hero) !== undefined || stasisAlly(hero) !== undefined;

export function powerProblem(world: World, hero: Hero, cell: number | undefined): string | null {
  const ally = empowered(world, hero);
  if (ally?.kind === 'lightAlly') return cell !== undefined && Number.isInteger(cell) && cell >= 0 && cell < LENGTH ? null : 'choose a target';
  if (allyExists(world, hero)) return `art:${MSG}powerofmany.ally_exists`;
  if (cell === undefined || !Number.isInteger(cell) || cell < 0 || cell >= LENGTH) return 'choose a target';
  if (!heroView(world, hero)[cell]) return `art:${MSG}powerofmany.no_vision`;
  const there = charAt(world, hero.depth, cell);
  if (there) return isHero(there) || !there.ally ? `art:${MSG}powerofmany.only_allies` : null;
  const level = world.levels[hero.depth]!;
  const terrain = level.map[cell]!;
  return hasFlag(terrain, F.SOLID) || !hasFlag(terrain, F.PASSABLE) || hasFlag(terrain, F.AVOID) ? 'art:actors.hero.spells.clericspell.invalid_target' : null;
}

/** DirectableAlly.directTocell: follow the hero, go for a foe in sight, or hold a place. */
function direct(ctx: Ctx, hero: Hero, ally: Mob, cell: number): void {
  const state = (ally.directed ??= { owner: hero.id, defend: -1, moving: false });
  const fov = heroView(ctx.world, hero);
  const there = charAt(ctx.world, ctx.depth, cell);
  if (there === hero) {
    state.defend = -1;
    state.moving = false;
    ally.enemy = null;
    ally.state = 'wandering';
    tell(ctx, hero, `${MSG}powerofmany$lightally.direct_follow`);
  } else if (fov[cell] && there && !isHero(there) && !there.ally && there.state !== 'passive') {
    state.defend = -1;
    state.moving = false;
    ally.enemy = there.id;
    ally.state = 'hunting';
    ally.target = there.pos;
    tell(ctx, hero, `${MSG}powerofmany$lightally.direct_attack`);
  } else {
    state.defend = cell;
    state.moving = true;
    ally.enemy = null;
    ally.state = 'wandering';
    tell(ctx, hero, `${MSG}powerofmany$lightally.direct_defend`);
  }
}

/** PowerOfMany.activate: direct the light ally (free), or empower an ally, or make a light ally where there is room. */
export function doPowerOfMany(ctx: Ctx, hero: Hero, cell: number | undefined): number {
  const ally = empowered(ctx.world, hero);
  if (ally?.kind === 'lightAlly') {
    direct(ctx, hero, ally, cell!);
    return 0;
  }
  // The cost is worked out first, for it would be nothing once a light ally stands.
  const cost = chargeUse(hero, ABILITY_DEFS.powerOfMany, undefined, ctx.world);
  let target = charAt(ctx.world, ctx.depth, cell!) as Mob | undefined;
  if (!target) {
    if (!canEnter(ctx.level, cell!)) return 0;
    // LightAlly: a copy of one of the heroes, as strong as the hero is at their level.
    const light = createMob(`#${++ctx.world.nextId}`, 'lightAlly', cell!, 'wandering', ctx.floor.now + 1);
    light.level = hero.lvl;
    light.hp = light.ht = 80;
    light.ally = true;
    light.owner = hero.id;
    light.directed = { owner: hero.id, defend: -1, moving: false };
    light.marks = { cls: ctx.rng.int(5) };
    ctx.floor.mobs.push(light);
    enterCell(ctx.level, cell!);
    say(ctx, hero, { k: 'spell', at: cell!, name: 'appear' });
    target = light;
  }
  prolongMark(target, 'power', 100);
  // Barrier.setShield(25): no less than that.
  if ((target.shield ?? 0) < 25) {
    target.shield = 25;
    target.shieldDecay = 0;
  } else addShield(target, 0);
  spendArmorCharge(hero, cost);
  say(ctx, hero, { k: 'sound', name: 'chargeup' });
  say(ctx, hero, { k: 'ray', from: hero.pos, to: cell!, name: 'zap' });
  dispelInvisibility(ctx, hero);
  return 1;
}
