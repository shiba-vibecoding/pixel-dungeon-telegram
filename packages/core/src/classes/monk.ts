import { type Hero, heroAttackDelay, isAlive, type Mob } from '../actors';
import { ballistica, PROJECTILE } from '../ballistica';
import { cleanse } from '../buffs';
import { attack } from '../combat';
import { beyond, press, throwChar } from '../displace';
import { enterCell, leaveCell, charAt, type Ctx, heroView, isHero } from '../floor';
import { dispelInvisibility } from '../artifacts';
import { regenOn } from '../hero';
import { isEnemy } from '../enchant';
import { distance, LENGTH } from '../level/geometry';
import { F, hasFlag } from '../level/terrain';
import { hasProp } from '../props';
import { canReach } from '../throwing';
import type { World } from '../world';
import { cs, hasTimer, clearTimer, setTimer } from './state';
import { pointsIn } from '../talents';

/*
 * The Monk (MonkEnergy): energy gained by defeating enemies (more for bosses), spent on five abilities of 1 to 5
 * energy — Flurry, Focus, Dash, Dragon Kick, Meditate — each stronger once the energy is nearly at its cap
 * (the monastic vigor talent brings that nearer).
 */

export type MonkAbility = 'flurry' | 'focus' | 'dash' | 'kick' | 'meditate';
export const MONK_ABILITIES: readonly MonkAbility[] = ['flurry', 'focus', 'dash', 'kick', 'meditate'];
export const MONK_COST: Readonly<Record<MonkAbility, number>> = { flurry: 1, focus: 2, dash: 3, kick: 4, meditate: 5 };
/** Whether the ability asks for a cell (targetingPrompt). */
export const MONK_AIMS: Readonly<Record<MonkAbility, boolean>> = { flurry: true, focus: false, dash: true, kick: true, meditate: false };

/** MonkEnergy.energyCap: 10 at base, 20 at level 30. */
export const energyCap = (hero: Hero): number => Math.max(10, 5 + Math.trunc(hero.lvl / 2));

export const energyOf = (hero: Hero): number => hero.cls?.energy ?? 0;

/** MonkEnergy.abilitiesEmpowered: 100%/80%/60% of the cap at +1/+2/+3 (never, with no points). */
export const empowered = (hero: Hero): boolean => energyOf(hero) / energyCap(hero) >= Math.fround(1.2 - 0.2 * pointsIn(hero, 'MONASTIC_VIGOR'));

/** MonkEnergy.gainEnergy: bosses give 5, minibosses 3, wraiths and larvae half, the rest 1; unencumbered spirit adds a share. */
export function gainEnergy(ctx: Ctx, hero: Hero, mob: Mob): void {
  if (hero.subclass !== 'monk' || !regenOn(ctx.world, hero)) return;
  let gain: number;
  if (hasProp(mob, 'boss')) gain = 5;
  else if (hasProp(mob, 'miniboss')) gain = 3;
  else if (mob.kind === 'wraith' || mob.kind === 'larva') gain = 0.5;
  else gain = 1;
  const points = pointsIn(hero, 'UNENCUMBERED_SPIRIT');
  if (points > 0) {
    let multi = 1;
    const armorTier = armourTier(hero);
    if (armorTier <= 1 && points >= 3) multi += 1;
    else if (armorTier <= 2 && points >= 2) multi += 0.75;
    else if (armorTier <= 3 && points >= 1) multi += 0.5;
    const stance = hero.cls?.brawl?.active === true;
    const weapon = hero.weapon;
    if (weapon && !stance && weaponTier(weapon) !== undefined) {
      const tier = weaponTier(weapon)!;
      if (tier <= 1 && points >= 3) multi += 1;
      else if (tier <= 2 && points >= 2) multi += 0.75;
      else if (tier <= 3 && points >= 1) multi += 0.5;
    }
    gain *= multi;
  }
  const state = cs(hero);
  state.energy = (state.energy ?? 0) + gain;
  // If we kill while using an ability, the cap is enforced after spending.
  if (!hasTimer(hero, 'unarmed')) state.energy = Math.min(state.energy, energyCap(hero));
}

import { itemDef } from '../items';
const armourTier = (hero: Hero): number => itemDef(hero.armor.kind).tier ?? (hero.armor.base ? itemDef(hero.armor.base).tier ?? 1 : 1);
const weaponTier = (item: { kind: string }): number | undefined => (itemDef(item.kind as never).category === 'weapon' ? itemDef(item.kind as never).tier : undefined);

/** MonkEnergy.abilityUsed. */
function spent(ctx: Ctx, hero: Hero, ability: MonkAbility): void {
  const state = cs(hero);
  state.energy = Math.min((state.energy ?? 0) - MONK_COST[ability], energyCap(hero));
  const points = pointsIn(hero, 'COMBINED_ENERGY');
  if (points > 0 && MONK_COST[ability] >= 5 - points) {
    if (!state.energyWep) {
      state.energyMonk = true;
      setTimer(hero, 'combinedEnergy', 5);
    } else {
      state.energyMonk = true;
      processCombinedEnergy(hero);
    }
  }
  void ctx;
}

/** MonkEnergy.processCombinedEnergy: a weapon ability and a monk ability close together give a point of energy. */
function processCombinedEnergy(hero: Hero): void {
  const state = cs(hero);
  state.energy = Math.min((state.energy ?? 0) + 1, energyCap(hero));
  delete state.energyMonk;
  delete state.energyWep;
  clearTimer(hero, 'combinedEnergy');
}

/** MeleeWeapon.afterAbilityUsed's combined energy: the weapon's ability counts towards the monk's. */
export function onCombinedEnergyWeapon(_ctx: Ctx, hero: Hero): void {
  if (pointsIn(hero, 'COMBINED_ENERGY') === 0) return;
  const state = cs(hero);
  if (!hasTimer(hero, 'combinedEnergy') || !state.energyMonk) {
    state.energyWep = true;
    state.energyMonk = false;
    setTimer(hero, 'combinedEnergy', 5);
  } else {
    state.energyWep = true;
    processCombinedEnergy(hero);
  }
}

/** The tracker times out: the half-done combination is forgotten. */
export function monkTurn(hero: Hero): void {
  const state = hero.cls;
  if (state && (state.energyMonk || state.energyWep) && !hasTimer(hero, 'combinedEnergy')) {
    delete state.energyMonk;
    delete state.energyWep;
  }
}

/* Using an ability */

const NO_TARGET = 'art:items.weapon.melee.meleeweapon.ability_no_target';
const OUT_OF_RANGE = 'art:items.weapon.melee.meleeweapon.ability_target_range';
const OCCUPIED = 'art:items.weapon.melee.meleeweapon.ability_occupied';

const fistsReach = (world: World, hero: Hero, target: Mob): boolean =>
  distance(hero.pos, target.pos) <= 1 || ((hero.cls?.holy?.ascended ?? 0) > 0 && canReach(world, world.levels[hero.depth]!, hero, target.pos, 3));

function foeAt(world: World, hero: Hero, cell: number): Mob | null {
  const there = Number.isInteger(cell) && cell >= 0 && cell < LENGTH ? charAt(world, hero.depth, cell) : undefined;
  if (!there || isHero(there) || !isAlive(there) || there.state === 'passive' || there.ally) return null;
  return there;
}

/** Why a monk ability cannot be used now, or null. */
export function monkProblem(world: World, hero: Hero, ability: MonkAbility, cell: number | undefined): string | null {
  if (hero.subclass !== 'monk') return 'you are no monk';
  if (!MONK_ABILITIES.includes(ability)) return 'no such ability';
  if (energyOf(hero) < MONK_COST[ability]) return 'art:actors.buffs.monkenergy.not_enough';
  if (ability === 'flurry' && (hero.cls?.flurryAt ?? -1) >= hero.time) return 'art:items.weapon.melee.meleeweapon.ability_cant_use';
  if (ability === 'focus' && hasTimer(hero, 'focus')) return 'art:items.weapon.melee.meleeweapon.ability_cant_use';
  if (!MONK_AIMS[ability]) return null;
  if (cell === undefined || !Number.isInteger(cell) || cell < 0 || cell >= LENGTH) return 'choose a target';
  if (ability === 'dash') {
    const range = empowered(hero) ? 8 : 4;
    if (hero.rooted > 0 || distance(hero.pos, cell) > range) return OUT_OF_RANGE;
    if (charAt(world, hero.depth, cell)) return OCCUPIED;
    const level = world.levels[hero.depth]!;
    const line = ballistica({ world, depth: hero.depth, level }, hero.pos, cell, PROJECTILE);
    if (line.collisionPos !== cell || (hasFlag(level.map[cell]!, F.SOLID) && !hasFlag(level.map[cell]!, F.PASSABLE))) return OUT_OF_RANGE;
    return null;
  }
  const foe = foeAt(world, hero, cell);
  if (!foe || !heroView(world, hero)[cell] || (hero.charmed > 0 && hero.charmedBy === foe.id)) return NO_TARGET;
  return fistsReach(world, hero, foe) ? null : OUT_OF_RANGE;
}

const fx = (ctx: Ctx, hero: Hero, f: import('./fx').ClassFx): void => {
  ctx.effects.push({ type: 'classFx', depth: ctx.depth, hero: hero.id, fx: f });
};

/** An unarmed blow of a monk ability (UnarmedAbilityTracker): bare fists, armour ignored, never missing. */
function fist(ctx: Ctx, hero: Hero, foe: Mob, multi: number, enchanted: boolean): boolean {
  setTimer(hero, 'unarmed', 1);
  const hit = attack(ctx, hero, foe, { unarmed: true, dmgMulti: multi, dmgBonus: 0, accMulti: Infinity, ...(enchanted && hero.weapon ? { enchantFrom: hero.weapon } : {}) });
  clearTimer(hero, 'unarmed');
  return hit;
}

/** The time a monk ability took, after doing it. */
export function useMonk(ctx: Ctx, hero: Hero, ability: MonkAbility, cell: number | undefined): number {
  const state = cs(hero);
  const power = empowered(hero);
  switch (ability) {
    case 'flurry': {
      const foe = foeAt(ctx.world, hero, cell!)!;
      fx(ctx, hero, { k: 'strike', at: foe.pos });
      fist(ctx, hero, foe, 1.5, power);
      if (isAlive(foe)) {
        fx(ctx, hero, { k: 'strike', at: foe.pos });
        fist(ctx, hero, foe, 1.5, power);
      }
      dispelInvisibility(ctx, hero);
      state.flurryAt = hero.time;
      spent(ctx, hero, 'flurry');
      return 0;
    }
    case 'focus':
      setTimer(hero, 'focus', 1e9);
      fx(ctx, hero, { k: 'mark', at: hero.pos, name: 'focus' });
      spent(ctx, hero, 'focus');
      return power ? 0 : 1;
    case 'dash': {
      const from = hero.pos;
      leaveCell(ctx.world, ctx.level, ctx.depth, from);
      hero.pos = cell!;
      enterCell(ctx.level, hero.pos);
      fx(ctx, hero, { k: 'lunge', from, to: cell! });
      press(ctx, hero);
      spent(ctx, hero, 'dash');
      return 0;
    }
    case 'kick': {
      const foe = foeAt(ctx.world, hero, cell!)!;
      fx(ctx, hero, { k: 'strike', at: foe.pos });
      const old = foe.pos;
      setTimer(hero, 'unarmed', 1);
      if (attack(ctx, hero, foe, { unarmed: true, dmgMulti: power ? 9 : 6, dmgBonus: 0, accMulti: Infinity })) fx(ctx, hero, { k: 'strong', at: old });
      clearTimer(hero, 'unarmed');
      const knock = (target: Mob): void => {
        const line = beyond(ctx, hero.pos, target.pos);
        throwChar(ctx, target, line, 6, true);
        if (line.dist > 0 && isAlive(target)) target.paralysed = Math.max(target.paralysed ?? 0, Math.min(6, line.dist));
      };
      if (old === foe.pos && isAlive(foe)) knock(foe);
      dispelInvisibility(ctx, hero);
      spent(ctx, hero, 'kick');
      if (power) {
        for (const other of [...ctx.floor.mobs]) {
          if (other !== foe && isAlive(other) && isEnemy(other) && distance(other.pos, hero.pos) <= 1) knock(other);
        }
      }
      return heroAttackDelay(hero);
    }
    case 'meditate': {
      fx(ctx, hero, { k: 'operate' });
      fx(ctx, hero, { k: 'flash', color: 0x88000000 });
      // Every harmful condition is shaken off.
      cleanse(hero, 0);
      if (hero.buffs) delete hero.buffs.cleanse;
      if (power) {
        const heal = Math.round((hero.ht - hero.hp) / 5);
        if (heal > 0) {
          const b = (hero.buffs ??= {});
          b.healing = { left: Math.max(b.healing?.left ?? 0, heal), percent: b.healing?.percent ?? 0, flat: Math.max(b.healing?.flat ?? 0, 1) };
        }
        setTimer(hero, 'meditate', 5);
      }
      // Recharging for eight turns and a boost to artifacts, as the meditation ends.
      hero.recharging = Math.max(hero.recharging ?? 0, 8);
      const b = (hero.buffs ??= {});
      b.artifactRecharge = Math.max(b.artifactRecharge ?? 0, 8);
      spent(ctx, hero, 'meditate');
      return 5;
    }
  }
}

/** Char.hit: a focused monk is never hit, once; the blow that is turned away uses the focus up. */
export function focusBlocks(hero: Hero, consume: boolean): boolean {
  if (!hasTimer(hero, 'focus')) return false;
  if (consume) clearTimer(hero, 'focus');
  return true;
}

/** Char.attack: while meditating (empowered), blows do a fifth of the harm. */
export const meditating = (hero: Hero, at: number): boolean => hasTimer(hero, 'meditate', at);
