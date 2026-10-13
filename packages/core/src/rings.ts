import { isMagicImmune } from './buffs';
import { type Hero, heroRings } from './actors';
import { underChallenges } from './challenges';
import type { Ctx } from './floor';
import { createItem, type Item, itemDef, ItemGenerator, type ItemKind, rollGold } from './items';
import type { Rng } from './rng';

/*
 * Shattered's rings (items/rings/): each worn ring of a kind adds its bonus —
 * its level and one, or for a cursed ring its level less two, never above
 * nought (Ring.soloBonus) — and the bonuses of a kind stack. What each kind
 * does, as the multipliers its class gives the places Shattered asks them
 * (Ring.getBonus and getBuffedBonus call sites): accuracy and evasion, haste
 * on the move, furor on the attack, might in strength and health, force in
 * the bare hand and the weapon's blow, sharpshooting in thrown weapons,
 * tenacity against harm the more hurt the wearer is, elements against the
 * elements, energy in wands and artifacts, arcana in enchantments and wealth
 * in what is found.
 */

/** Ring.soloBonus: what one ring adds. */
export const soloBonus = (ring: Item): number => (ring.cursed ? Math.min(0, ring.level - 2) : ring.level + 1);

/** Seam (talents stream): EnhancedRings, a level more on every ring's buffed bonus for a while. */
export function enhancedRings(_hero: Hero): boolean {
  return false;
}

/** MagicImmune (alchemy's potion of magic immunity; the talents and abilities streams' too): no ring works under it. */
export function ringsSuppressed(hero: Hero): boolean {
  return isMagicImmune(hero);
}

/** Ring.getBonus: the worn rings of a kind, their bonuses added up. */
export function ringBonus(hero: Hero, kind: ItemKind): number {
  if (ringsSuppressed(hero)) return 0;
  return heroRings(hero).reduce((sum, ring) => (ring.kind === kind ? sum + soloBonus(ring) : sum), 0);
}

/** Ring.getBuffedBonus: as getBonus, with enhanced rings a level more each. */
export function ringBuffedBonus(hero: Hero, kind: ItemKind): number {
  if (ringsSuppressed(hero)) return 0;
  const plus = enhancedRings(hero) ? 1 : 0;
  return heroRings(hero).reduce((sum, ring) => (ring.kind === kind ? sum + soloBonus(ring) + plus : sum), 0);
}

const f32 = Math.fround;

/** RingOfAccuracy.accuracyMultiplier. */
export const accuracyMultiplier = (hero: Hero): number => f32(f32(1.3) ** ringBuffedBonus(hero, 'ring.accuracy'));

/** RingOfEvasion.evasionMultiplier. */
export const evasionMultiplier = (hero: Hero): number => f32(1.125 ** ringBuffedBonus(hero, 'ring.evasion'));

/** RingOfHaste.speedMultiplier: on the move. */
export const speedMultiplier = (hero: Hero): number => f32(1.15 ** ringBuffedBonus(hero, 'ring.haste'));

/** RingOfFuror.attackSpeedMultiplier. */
export const attackSpeedMultiplier = (hero: Hero): number => f32(1.09051 ** ringBuffedBonus(hero, 'ring.furor'));

/** RingOfMight.strengthBonus. */
export const mightStrength = (hero: Hero): number => ringBonus(hero, 'ring.might');

/** RingOfMight.HTMultiplier. */
export const mightHTMultiplier = (hero: Hero): number => f32(1.035 ** ringBuffedBonus(hero, 'ring.might'));

/** RingOfEnergy.wandChargeMultiplier (the talents' light reading aside). */
export const wandChargeMultiplier = (hero: Hero): number => f32(1.175 ** ringBuffedBonus(hero, 'ring.energy'));

/** RingOfEnergy.artifactChargeMultiplier (the talents' light cloak aside). */
export const energyArtifactMultiplier = (hero: Hero): number => f32(1.175 ** ringBuffedBonus(hero, 'ring.energy'));

/** RingOfEnergy.armorChargeMultiplier: the class armour's charge. */
export const armorChargeMultiplier = (hero: Hero): number => f32(1.175 ** ringBuffedBonus(hero, 'ring.energy'));

/** RingOfArcana.enchantPowerMultiplier: how much more often enchantments and glyphs work (the gear stream's to apply). */
export const enchantPowerMultiplier = (hero: Hero): number => f32(f32(1.175) ** ringBuffedBonus(hero, 'ring.arcana'));

/** RingOfSharpshooting.levelDamageBonus: levels added to a thrown weapon's damage. */
export const sharpshootingBonus = (hero: Hero): number => ringBuffedBonus(hero, 'ring.sharpshooting');

/** RingOfSharpshooting.durabilityMultiplier: how much longer thrown weapons last (the gear stream's to apply). */
export const sharpshootingDurability = (hero: Hero): number => f32(1.2 ** ringBonus(hero, 'ring.sharpshooting'));

/** RingOfTenacity.damageMultiplier: less harm the more of the wearer's health is gone. */
export const tenacityMultiplier = (hero: Hero): number =>
  f32(0.85 ** (ringBuffedBonus(hero, 'ring.tenacity') * f32((hero.ht - hero.hp) / hero.ht)));

/** RingOfElements.resist: what the elements (fire, frost, ooze, paralysis, poison, gas, lightning, magic) do to the wearer. */
export const elementsResist = (hero: Hero): number => {
  const bonus = ringBuffedBonus(hero, 'ring.elements');
  return bonus === 0 ? 1 : 0.825 ** bonus;
};

/** RingOfWealth.dropChanceMultiplier. */
export const wealthDropMultiplier = (hero: Hero): number => f32(1.2 ** ringBuffedBonus(hero, 'ring.wealth'));

/** RingOfForce's tier for a hero's strength: a weapon tier from strength, each point past 18 half as much. */
function forceTier(str: number): number {
  let tier = Math.max(1, (str - 8) / 2);
  if (tier > 5) tier = 5 + (tier - 5) / 2;
  return tier;
}

/**
 * RingOfForce.damageRoll's range for a hero's bare hand: with a ring of force, as a weapon of the tier the hero's
 * strength makes; null without one (bare hands then do 1 to STR-8).
 */
export function forceRange(hero: Hero, str: number): readonly [number, number] | null {
  if (!heroRings(hero).some((ring) => ring.kind === 'ring.force') || ringsSuppressed(hero)) return null;
  const level = ringBuffedBonus(hero, 'ring.force');
  const tier = level <= 0 ? 1 : forceTier(str);
  return [Math.max(0, Math.round(tier + level)), Math.max(0, Math.round(5 * (tier + 1) + level * (tier + 1)))];
}

/** Whether a ring of force is worn (Hero.buff(RingOfForce.Force)). */
export const wearsForce = (hero: Hero): boolean => heroRings(hero).some((ring) => ring.kind === 'ring.force') && !ringsSuppressed(hero);

/** RingOfForce.damageRoll's brawler's stance bonus: 3 + tier, and 4+2×tier eighths of a level. */
export function brawlBonus(hero: Hero, str: number): number {
  const level = ringBuffedBonus(hero, 'ring.force');
  const tier = forceTier(str);
  return Math.floor(Math.fround(3 + tier + level * Math.fround((4 + 2 * tier) / 8)) + 0.5);
}

/** RingOfForce.armedDamageBonus: added to every melee blow with a weapon. */
export const forceArmedBonus = (hero: Hero): number => ringBuffedBonus(hero, 'ring.force');

/** Shattered's ring kinds. */
export const RING_KINDS: readonly ItemKind[] = [
  'ring.accuracy', 'ring.arcana', 'ring.elements', 'ring.energy', 'ring.evasion', 'ring.force', 'ring.furor', 'ring.haste', 'ring.might',
  'ring.sharpshooting', 'ring.tenacity', 'ring.wealth',
];

/*
 * RingOfWealth.tryForBonusDrop: a wearer finds more. Every so many tries (a monster slain is one, a boss
 * fifteen, a chest opened one) something extra turns up: mostly consumables, better the stronger the
 * rings, and every five to ten of those a piece of equipment, never cursed and at least as good as
 * the rings make it.
 */

/** A normal roll as Random.NormalIntRange: the mean of two. */
const normalInt = (rng: Rng, min: number, max: number): number => rng.normalIntRange(min, max);

/** The counters the original keeps as buffs (TriesToDropTracker, DropsToEquipTracker). */
export interface WealthCounters {
  tries: number;
  toEquip: number;
}

/** RingOfWealth.genConsumableDrop: low, mid or high value, the odds shifting with the rings' level. */
function consumable(rng: Rng, generator: ItemGenerator, depth: number, level: number): Item {
  const roll = rng.float();
  if (roll < 0.6 - 0.04 * level) return lowValue(rng, generator, depth);
  if (roll < 0.9 - 0.02 * level) return midValue(rng, generator, depth);
  return highValue(rng, generator, depth);
}

function lowValue(rng: Rng, generator: ItemGenerator, depth: number): Item {
  switch (rng.int(4)) {
    case 1:
      // Seam (alchemy stream): a runestone (Generator.Category.STONE); a potion meanwhile.
      return generator.of('potion');
    case 2:
      return generator.of('potion');
    case 3:
      return generator.of('scroll');
    default: {
      const gold = rollGold(rng, depth);
      gold.qty = Math.trunc(gold.qty / 2);
      return gold;
    }
  }
}

function midValue(rng: Rng, generator: ItemGenerator, depth: number): Item {
  switch (rng.int(6)) {
    // Seam (alchemy stream): exotic potions and scrolls, the unstable brew and spell; plain ones meanwhile.
    case 1:
      return generator.of('potion');
    case 2:
      return generator.of('scroll');
    case 3:
      return generator.of('potion');
    case 4:
      return createItem('bomb');
    case 5:
      return createItem('honeypot');
    default: {
      const item = lowValue(rng, generator, depth);
      item.qty *= 2;
      return item;
    }
  }
}

function highValue(rng: Rng, generator: ItemGenerator, depth: number): Item {
  switch (rng.int(4)) {
    // Seam (alchemy stream): the stone of enchantment, and transmutation; the scroll of enchantment meanwhile.
    case 1:
      return createItem('scroll.enchantment');
    case 2:
      return createItem('potion.experience');
    case 3:
      return createItem('scroll.enchantment');
    default: {
      const item = midValue(rng, generator, depth);
      // A bomb becomes a double bomb.
      item.qty *= 2;
      return item;
    }
  }
}

/** RingOfWealth.genEquipmentDrop: a weapon, armour, ring or artifact, uncursed, at least half the rings' level. */
function equipment(rng: Rng, generator: ItemGenerator, level: number): Item {
  let item: Item;
  switch (rng.int(5)) {
    case 2:
      item = generator.of('armor');
      break;
    case 3:
      item = generator.of('ring');
      break;
    case 4:
      item = generator.of('artifact');
      break;
    default:
      do item = generator.of('weapon');
      while (itemDef(item.kind).category !== 'weapon');
  }
  const minLevel = Math.trunc((level + 1) / 2);
  if (itemDef(item.kind).category !== 'artifact' && item.level < minLevel) item.level = minLevel;
  delete item.cursed;
  delete item.curseUnknown;
  return item;
}

/** RingOfWealth.tryForBonusDrop: what `tries` more chances turn up for a wearer, as their counters run down. */
export function wealthBonusDrops(ctx: Ctx, hero: Hero, tries: number): Item[] {
  const bonus = ringBuffedBonus(hero, 'ring.wealth');
  if (bonus <= 0) return [];
  const { rng } = ctx;
  const counters = (hero.wealth ??= { tries: normalInt(rng, 0, 20), toEquip: normalInt(rng, 5, 10) });
  const generator = new ItemGenerator(rng, ctx.depth, { run: ctx.world.run });
  const drops: Item[] = [];
  counters.tries -= tries;
  while (counters.tries <= 0) {
    if (counters.toEquip <= 0) {
      // A second ring of wealth counts for at most two more.
      let equipBonus = 0;
      for (const ring of heroRings(hero).filter((r) => r.kind === 'ring.wealth')) {
        const level = soloBonus(ring) + (enhancedRings(hero) ? 1 : 0);
        equipBonus = level > equipBonus ? level + Math.min(equipBonus, 2) : equipBonus + Math.min(level, 2);
      }
      drops.push(underChallenges(ctx.world, equipment(rng, generator, equipBonus - 1)));
      counters.toEquip += normalInt(rng, 5, 10);
    } else {
      drops.push(underChallenges(ctx.world, consumable(rng, generator, ctx.depth, bonus - 1)));
      counters.toEquip--;
    }
    counters.tries += normalInt(rng, 0, 20);
  }
  return drops;
}
