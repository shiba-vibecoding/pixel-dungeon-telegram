import { type Hero, heroStr, isAlive, type Mob } from '../actors';
import type { AttackOverride } from '../combat';
import type { Ctx } from '../floor';
import { isHero, type Char } from '../floor';
import type { Item } from '../items';
import { wearsForce, brawlBonus } from '../rings';
import { augmentDamage } from '../weapons';
import { cs, hasTimer, marks } from './state';
import { pointsIn } from '../talents';
import { onFoodEaten as duelistFoodEaten, onPotionUsed as duelistPotionUsed, takeEmpower, accuracyFactor, afterAttack, combinedLethality, evasionFactor, onAttackProc, onAbilityKill, aggressiveBarrierOnAttack } from './duelist-talents';
import { addComboHit, chargedShot, crossbowCharged, takeSpin } from './duelist';
import { hurt } from '../combat';
import { focusBlocks, meditating } from './monk';
import { clericBlowDamage, clericDefenseDamage } from './cleric-hooks';

/*
 * Where the classes meet Char.attack: the accuracy, evasion and damage the Duelist's and the Cleric's trackers
 * change, what their talents add on a hit, and what waits for a blow to land. combat.ts calls these around the
 * blow it already plays.
 */

/** RingOfForce.fightingUnarmed with the brawler's stance: a Duelist who holds the stance strikes with her ring, weapon or none. */
export const brawling = (hero: Hero): boolean => hero.cls?.brawl?.active === true && wearsForce(hero);

/** What a hero's ordinary blow strikes with (Belongings.attackingWeapon, but the brawler's ring is no weapon here). */
export const meleeStrike = (hero: Hero): Item | null => (brawling(hero) ? null : hero.weapon);

/** What a blow was made of; combat.ts asks for each part as it goes. */
export interface BlowMods {
  /** The factor on the roll to hit; Infinity never misses. */
  accuracy: number;
  /** The damage after Char.attack's own multipliers of the classes. */
  damage(damage: number): number;
  /** Hero.attackProc's talents. */
  proc(damage: number): number;
  /** The blow landed: combos, charged shots, executions. */
  landed(defender: Char, wasEnemy: boolean, damage: number): void;
  /** Hero.attack's tidying of trackers. */
  after(): void;
}

export function heroBlow(ctx: Ctx, hero: Hero, defender: Char, strike: Item | null, override: AttackOverride, thrown: boolean): BlowMods {
  const ability = override.ability !== undefined;
  const unarmed = override.unarmed === true;
  const stance = !thrown && !ability && !unarmed && brawling(hero);
  let accuracy = 1;
  let extra = 0;
  let slain: (() => void) | null = null;
  if (!thrown) {
    // Hero.attackSkill: precise assault and liquid agility; Flail.accuracyFactor and Crossbow.accuracyFactor.
    accuracy *= accuracyFactor(hero, strike, ability, unarmed);
    const spin = takeSpin(hero, strike);
    if (spin >= 0) {
      accuracy = Infinity;
      extra += spin;
      slain = () => onAbilityKill(ctx, hero, defender as Mob);
    }
    if (crossbowCharged(hero, strike)) accuracy = Infinity;
    // Scimitar.SwordDance: 1.5 times as accurate.
    if (hasTimer(hero, 'dance')) accuracy *= 1.5;
  }
  const crossbow = !thrown && crossbowCharged(hero, strike);
  return {
    accuracy,
    damage(damage) {
      // PhysicalEmpower (Hero.damageRoll), a flail's spin (Flail.damageRoll), the brawler's stance.
      damage += takeEmpower(hero) + extra;
      if (stance) {
        damage += brawlBonus(hero, heroStr(hero));
        if (hero.weapon) damage = augmentDamage(hero.weapon, damage);
      }
      return clericBlowDamage(ctx, hero, defender, damage);
    },
    proc(damage) {
      if (isHero(defender) || ability || unarmed) return damage;
      const arrow = thrown && override.weapon?.kind === 'spiritBow';
      return onAttackProc(hero, defender, damage, thrown, arrow, ctx.rng);
    },
    landed(target, wasEnemy, damage) {
      if (isHero(target)) return;
      // Hero.attack: a hit on an enemy builds the Duelist's next combo strike.
      if (hero.heroClass === 'duelist' && wasEnemy && !ability && !unarmed) addComboHit(hero, target, !isAlive(target));
      // Char.attack: combined lethality (after a blow with another weapon than the one whose ability was used).
      const weapon = override.ability ?? hero.weapon;
      if (!thrown && isAlive(target) && combinedLethality(hero, target, weapon)) {
        const rest = target.hp;
        ctx.effects.push({ type: 'hurt', depth: ctx.depth, who: target.id, damage: rest });
        hurt(ctx, target, rest, hero);
        ctx.effects.push({ type: 'classFx', depth: ctx.depth, hero: hero.id, fx: { k: 'text', at: target.pos, text: 'x', tone: 'n' } });
      }
      if (crossbow) {
        if (isAlive(target)) chargedShot(ctx, hero, target);
        else {
          delete cs(hero).charged;
          onAbilityKill(ctx, hero, target);
        }
      }
      if (slain && !isAlive(target)) slain();
    },
    after() {
      if (!thrown) afterAttack(hero);
      aggressiveBarrierOnAttack(ctx, hero);
    },
  };
}

/** Hero.defenseSkill: how much harder to hit the hero is, or never hit (a guard, a focus, liquid agility, the stance). */
export function heroEvasion(ctx: Ctx, hero: Hero, attacker: Char): { factor: number; infinite: boolean } {
  const now = ctx.floor.now;
  if (hasTimer(hero, 'guard', now)) {
    cs(hero).blocked = true;
    ctx.effects.push({ type: 'classFx', depth: ctx.depth, hero: hero.id, fx: { k: 'sound', name: 'hit_parry' } });
    return { factor: 1, infinite: true };
  }
  if (focusBlocks(hero, true)) {
    ctx.effects.push({ type: 'classFx', depth: ctx.depth, hero: hero.id, fx: { k: 'sound', name: 'hit_parry' } });
    return { factor: 1, infinite: true };
  }
  const [factor, infinite] = evasionFactor(hero, now);
  void attacker;
  return { factor, infinite };
}

/** Char.attack on the hero as the defender: meditation resists, blessings and auras soften what monsters deal. */
export function classDamageTaken(ctx: Ctx, attacker: Char, defender: Char, damage: number): number {
  if (isHero(defender) && meditating(defender, ctx.floor.now)) damage *= 0.2;
  return clericDefenseDamage(ctx, attacker, defender, Math.round(damage));
}

/** The monster's bleeding that a harvest began: if it dies of it, the ability killed it (Bleeding.act). */
export function markHarvest(mob: Mob): void {
  marks(mob).harvest = true;
}


/** Bleeding.act: the monster that bled to death from a harvest was the ability's kill, for the Duelist on its depth. */
export function harvestKill(ctx: Ctx, mob: Mob): void {
  if (!mob.marks?.harvest) return;
  for (const hero of ctx.world.heroes) {
    if (hero.depth === ctx.depth && hero.heroClass === 'duelist') onAbilityKill(ctx, hero, mob);
  }
}

/** Food.eatingTime: the meals of the Duelist and the Cleric take two turns less (TIME_TO_EAT is 3). */
export function classEatingTime(hero: Hero): number {
  return pointsIn(hero, 'FOCUSED_MEAL') > 0 || pointsIn(hero, 'ENLIGHTENING_MEAL') > 0 ? 1 : 3;
}

/** Talent.onFoodEaten, for the meals of the Duelist and the Cleric. */
export function classFoodEaten(ctx: Ctx, hero: Hero): void {
  duelistFoodEaten(ctx, hero);
}

/** Talent.onPotionUsed: `factor` is 1 for a potion drunk, 2 for an exotic one, half that for one thrown. */
export function classPotionUsed(ctx: Ctx, hero: Hero, factor: number): void {
  duelistPotionUsed(ctx, hero, factor);
}
