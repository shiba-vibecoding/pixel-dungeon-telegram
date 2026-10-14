import { type Hero, heroAttackDelay, isAlive, type Mob } from '../actors';
import { ballistica, cone, type Ballistica, WONT_STOP } from '../ballistica';
import { attack } from '../combat';
import { weaponProc } from '../enchant';
import { type Char, charAt, type Ctx, heroView, isHero } from '../floor';
import { dispelInvisibility } from '../artifacts';
import { F, hasFlag } from '../level/terrain';
import { LENGTH } from '../level/geometry';
import { plant, type PlantKind, stepOnPlant } from '../plants';
import { pointsInTalent } from '../talents';
import { isMagicImmune } from '../buffs';
import { itemDef } from '../items';
import { stateOf, trueDistance } from './common';

/*
 * The huntress's armour abilities: SpectralBlades and NaturesPower (the Spirit Hawk is in allies.ts).
 */

/* Spectral blades */

export function spectralBladesProblem(ctx: Ctx, hero: Hero, target: number | undefined): string | null {
  if (target === undefined || !Number.isInteger(target) || target < 0 || target >= LENGTH) return 'art:actors.hero.abilities.armorability.prompt';
  if (charAt(ctx.world, ctx.depth, target) === hero) return 'art:actors.hero.abilities.armorability.self_target';
  const path = ballistica(ctx, hero.pos, target, WONT_STOP);
  const enemy = firstFoe(ctx, path, hero, 2 * pointsInTalent(hero, 'projectingBlades'), new Set());
  return enemy && heroView(ctx.world, hero)[enemy.pos] ? null : 'art:actors.hero.abilities.huntress.spectralblades.no_target';
}

/** SpectralBlades.findChar: the first creature along the path that is no ally, seeing through so many walls. */
function firstFoe(ctx: Ctx, path: Ballistica, hero: Hero, wallPenetration: number, existing: Set<Char>): Mob | undefined {
  for (const cell of path.path) {
    const ch = charAt(ctx.world, ctx.depth, cell);
    if (ch && isAlive(ch)) {
      if (ch === hero || existing.has(ch) || isHero(ch) || ch.ally) continue;
      return ch;
    }
    if (hasFlag(ctx.level.map[cell]!, F.SOLID)) {
      wallPenetration--;
      if (wallPenetration < 0) return undefined;
    }
  }
  return undefined;
}

/**
 * SpectralBlades.activate: a blade flies at the enemy in the aimed line, striking as a blow of the hero's melee weapon would
 * (all its enchantments work); Fan Of Blades sends others at as many more in a cone round that line, at half the harm, and
 * Projecting Blades sees through walls and aims better.
 */
export function spectralBlades(ctx: Ctx, hero: Hero, target: number): number {
  const reach = 2 * pointsInTalent(hero, 'projectingBlades');
  const b = ballistica(ctx, hero.pos, target, WONT_STOP);
  const targets: Mob[] = [];
  const enemy = firstFoe(ctx, b, hero, reach, new Set())!;
  targets.push(enemy);
  const fan = pointsInTalent(hero, 'fanOfBlades');
  const fov = heroView(ctx.world, hero);
  if (fan > 0) {
    const shape = cone(ctx, b, Infinity, 30 * fan, b.params);
    for (const ray of shape.rays) {
      const found = firstFoe(ctx, ray, hero, reach, new Set(targets));
      if (found && fov[found.pos] && !targets.includes(found)) targets.push(found);
    }
    while (targets.length > 1 + fan) {
      let furthest = targets[0]!;
      for (const ch of targets) if (trueDistance(enemy.pos, ch.pos) > trueDistance(enemy.pos, furthest.pos)) furthest = ch;
      targets.splice(targets.indexOf(furthest), 1);
    }
  }
  ctx.effects.push({
    type: 'ability', depth: ctx.depth, hero: hero.id, ability: 'spectralBlades', from: hero.pos, to: enemy.pos, cells: targets.map((ch) => ch.pos),
  });
  const state = stateOf(hero);
  const accuracy = 1 + 0.25 * pointsInTalent(hero, 'projectingBlades');
  for (const ch of targets) {
    if (!isAlive(ch)) continue;
    if (pointsInTalent(hero, 'spiritBlades') > 0) state.spiritBlades = true;
    attack(ctx, hero, ch, { damageMulti: ch === enemy ? 1 : 0.5, accuracyMulti: accuracy });
    delete state.spiritBlades;
  }
  dispelInvisibility(ctx, hero);
  return heroAttackDelay(hero);
}

/**
 * Talent.onAttackProc, Spirit Blades: a blade's blow may carry the spirit bow's enchantment too (three tenths a point),
 * once. Returns the damage after it.
 */
export function bladeBowProc(ctx: Ctx, hero: Hero, mob: Mob, damage: number, blow: Parameters<typeof weaponProc>[5]): number {
  const state = hero.abil;
  if (!state?.spiritBlades) return damage;
  if (ctx.rng.int(10) < 3 * pointsInTalent(hero, 'spiritBlades')) {
    const bow = [hero.weapon, ...hero.items].find((item) => item && itemDef(item.kind).category === 'bow');
    if (bow && !isMagicImmune(hero)) damage = weaponProc(ctx, hero, mob, damage, bow, blow);
    delete state.spiritBlades;
  }
  return damage;
}

/** Weapon.Enchantment.genericProcChanceMultiplier's additions from the abilities: the spirit blades' and the shockwave's fourth point. */
export function abilityProcBonus(hero: Hero): number {
  let bonus = 0;
  if (hero.abil?.spiritBlades && pointsInTalent(hero, 'spiritBlades') === 4) bonus += 0.1;
  if (hero.abil?.strikingWave && pointsInTalent(hero, 'strikingWave') === 4) bonus += 0.2;
  return bonus;
}

/* Nature's power */

/** naturesPowerTracker.DURATION. */
export const NATURE_TURNS = 8;

/** Whether the hero is empowered at this time. */
export const natureActive = (hero: Hero): boolean => (hero.abil?.nature?.until ?? 0) > hero.time;

/** NaturesPower.activate: eight turns of double speed afoot and a faster bow, extended twice at most (Wild Momentum). */
export function naturesPower(ctx: Ctx, hero: Hero): number {
  stateOf(hero).nature = { until: hero.time + NATURE_TURNS, extensionsLeft: 2 };
  ctx.effects.push({ type: 'ability', depth: ctx.depth, hero: hero.id, ability: 'naturesPower', from: hero.pos, to: hero.pos });
  dispelInvisibility(ctx, hero);
  return 1;
}

/** Hero.speed under Nature's Power: twice as fast, a quarter more a point of Growing Power. */
export const natureSpeed = (hero: Hero): number => (natureActive(hero) ? 2 + 0.25 * pointsInTalent(hero, 'growingPower') : 1);

/** SpiritBow.speedMultiplier under Nature's Power: a third to a half more (8 + points over 24). */
export const natureBowSpeed = (hero: Hero): number => (natureActive(hero) ? (8 + pointsInTalent(hero, 'growingPower')) / 24 : 0);

/** The plants Nature's Wrath draws on (SpiritBow's harmfulPlants; the blindweed and stormvine are not in this game). */
const HARMFUL: readonly PlantKind[] = ['firebloom', 'icecap', 'sorrowmoss'];

/**
 * SpiritBow.proc under Nature's Power: Nature's Wrath now and then (a point in twelve) sets a harmful plant off on the
 * foe, and a kill extends the empowerment (Wild Momentum).
 */
export function natureArrowProc(ctx: Ctx, hero: Hero, foe: Char): void {
  if (!natureActive(hero) || isHero(foe)) return;
  const wrath = pointsInTalent(hero, 'naturesWrath');
  if (ctx.rng.int(12) < wrath) {
    plant(ctx, foe.pos, ctx.rng.oneOf(HARMFUL));
    stepOnPlant(ctx, isAlive(foe) ? foe : null, foe.pos, true);
  }
  if (!isAlive(foe)) {
    const nature = hero.abil!.nature!;
    const turns = pointsInTalent(hero, 'wildMomentum');
    if (nature.extensionsLeft > 0 && turns > 0) {
      nature.until += turns;
      nature.extensionsLeft--;
    }
  }
}
