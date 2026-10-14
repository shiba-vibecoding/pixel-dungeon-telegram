import type { Hero, Mob } from '../actors';
import { hurt, type Hazard } from '../combat';
import { type Char, type Ctx, isHero } from '../floor';
import { distance } from '../level/geometry';
import { pointsInTalent as pointsIn } from '../talents';
import { cs, hasTimer, markTurns, marks } from './state';
import { poweredAlly } from './cleric-allies';

/*
 * Where the Cleric's blessings meet Char.attack and Char.damage: an illuminated foe struck, the power of many, the aura of
 * protection, the shield of light, the shields of ascended form and divine intervention, and the link of life.
 */

const cleric = (ctx: Ctx): Hero | undefined => ctx.world.heroes.find((h) => h.depth === ctx.depth && h.heroClass === 'cleric' && h.hp > 0);

/** GuidingLight.Illuminated, struck: it is gone; searing light adds to a hero's blow; a priest's ally's blow adds the priest's own. */
function lightStruck(ctx: Ctx, attacker: Char, defender: Mob, damage: number): number {
  if (!defender.marks?.lit) return damage;
  delete defender.marks.lit;
  const hero = cleric(ctx);
  if (isHero(attacker) && pointsIn(attacker, 'searing_light') > 0) damage += 1 + 2 * pointsIn(attacker, 'searing_light');
  if (!isHero(attacker) && hero?.subclass === 'priest') {
    ctx.effects.push({ type: 'hurt', depth: ctx.depth, who: defender.id, damage: 5 + hero.lvl });
    hurt(ctx, defender, 5 + hero.lvl, hero);
  }
  return damage;
}

/** What the Cleric's blessings do to a hero's own blow (Char.attack, the hero attacking). */
export function clericBlowDamage(ctx: Ctx, hero: Hero, defender: Char, damage: number): number {
  if (!isHero(defender)) damage = lightStruck(ctx, hero, defender, damage);
  return damage;
}

/**
 * What the blessings do to a blow dealt by anyone but a hero (Char.attack): an illuminated foe struck by an ally; the power of
 * many (a quarter more, or more still on the foe a beaming ray named); the aura of protection on the defender; the shield of
 * light that eases the blows of one foe.
 */
export function clericDefenseDamage(ctx: Ctx, attacker: Char, defender: Char, damage: number): number {
  if (!isHero(defender)) damage = lightStruck(ctx, attacker, defender, damage);
  if (!isHero(attacker) && markTurns(attacker, 'power') > 0) {
    if (markTurns(attacker, 'beam') > 0 && attacker.marks?.beamObject === defender.id) {
      const hero = cleric(ctx);
      damage *= Math.fround(1.3 + 0.05 * (hero ? pointsIn(hero, 'beamingRay') : 0));
    } else damage *= 1.25;
  }
  return damage;
}

/** Char.damage: the link of life, the aura (for harm that is no blow), and the power of many's share, for whoever is hurt. */
export function clericHurt(ctx: Ctx, victim: Char, damage: number, source: Char | Hazard): number {
  const hero = cleric(ctx);
  if (!hero || damage <= 0) return damage;
  const friend = isHero(victim) || victim.ally === true;
  const linked = friend && (isHero(victim) ? false : markTurns(victim, 'lifeLinkSpell') > 0);
  // LifeLink: harm is shared with the one it binds, each taking the half.
  if (source !== 'lifeLink' && source !== 'hunger') {
    const other = linkedPartner(ctx, hero, victim);
    if (other) {
      damage = Math.ceil(damage / 2);
      ctx.effects.push({ type: 'hurt', depth: ctx.depth, who: other.id, damage });
      hurt(ctx, other, damage, 'lifeLink');
    }
  }
  const blowless = typeof source === 'string';
  // If the harm came from a character it was already reduced in Char.attack.
  if (friend && blowless && hasTimer(hero, 'aura', ctx.floor.now) && (distance(victim.pos, hero.pos) <= 2 || linked)) {
    damage *= Math.fround(0.9 - 0.1 * pointsIn(hero, 'aura_of_protection'));
  }
  if (!isHero(victim) && markTurns(victim, 'power') > 0) {
    damage *= markTurns(victim, 'lifeLinkSpell') > 0 ? Math.fround(0.7 - 0.05 * pointsIn(hero, 'lifeLink')) : 0.75;
  }
  return damage;
}

/** Whoever the creature is linked to by LifeLink (the hero to the ally, the ally to the hero), if both live. */
function linkedPartner(ctx: Ctx, hero: Hero, victim: Char): Char | undefined {
  if (isHero(victim)) {
    if (victim !== hero || !hasTimer(hero, 'lifeLink', ctx.floor.now)) return undefined;
    return ctx.floor.mobs.find((m) => m.id === cs(hero).linkObject && m.hp > 0);
  }
  if (markTurns(victim, 'lifeLink') > 0 && victim.marks?.linkObject === hero.id && hero.hp > 0) return hero;
  return undefined;
}

/** The shields of ascended form (the hero's) and divine intervention (the allies'), which take blows before any other. */
export function clericShields(ctx: Ctx, victim: Char, damage: number): number {
  if (damage <= 0) return damage;
  if (isHero(victim)) {
    const a = victim.cls?.ascend;
    if (a && a.shield > 0) {
      const taken = Math.min(a.shield, damage);
      a.shield -= taken;
      return damage - taken;
    }
    return damage;
  }
  const divine = Number(victim.marks?.divine ?? 0);
  if (divine > 0) {
    const taken = Math.min(divine, damage);
    victim.marks!.divine = divine - taken;
    return damage - taken;
  }
  void ctx;
  return damage;
}

/** Char.defenseProc: the shield of light eases a foe's blow. */
export function lightShield(ctx: Ctx, attacker: Mob, defender: Char, damage: number): number {
  const hero = cleric(ctx);
  if (!hero) return damage;
  const min = 1 + pointsIn(hero, 'shield_of_light');
  if (isHero(defender)) {
    if (hasTimer(defender, 'shieldOfLight', ctx.floor.now) && cs(defender).lightFoe === attacker.id) {
      return Math.max(damage - ctx.rng.normalIntRange(min, 2 * min), 0);
    }
  } else if (markTurns(defender, 'shieldOfLight') > 0 && defender.marks?.lightFoe === attacker.id) {
    return Math.max(damage - ctx.rng.normalIntRange(min, 2 * min), 0);
  }
  return damage;
}

/** Hero.drRoll's additions: none for the Cleric. */
export function drRollBonus(_hero: Hero): number {
  return 0;
}

export { poweredAlly, marks };
