import type { Hero } from './actors';
import type { Ctx } from './floor';
import { visibleEnemies, regenOn } from './hero';
import { cursedKnown } from './ident';
import { createItem, type Item, itemDef } from './items';
import { hasRoom } from './bags';
import { canTransferGlyph as transferable } from './talents';
import { pointsInTalent } from './talents/data';
import { onShieldBroken } from './talents/combat';
import { holdFastDecay } from './talents/hold-fast';
import { dropItem } from './floor';

/*
 * The Warrior's broken seal (BrokenSeal) and the shield it gives him
 * (BrokenSeal.WarriorShield), as Shattered Pixel Dungeon has them. The seal is
 * affixed to armour (Armor.affixSeal) and moved between armours; it carries a
 * single upgrade with it, one the armour got while the seal was on it (or a
 * scroll of upgrade read on the seal itself). While the armour it is on is
 * worn, a blow that would take the warrior to half health or lower first
 * raises a shield of 3 + twice the armour's tier; then it cools down for 150
 * turns. The shield does not wear off with time, but ends a few turns after
 * the last enemy is out of sight, and what is left of it shortens the cooldown.
 *
 * On armour the seal is `Item.seal` ({ level }); on its own it is an item of
 * kind 'seal'. Seams for the talents stream: Iron Will (maxShield), Runic
 * Transference (carrying the glyph across, canTransferGlyph), Hold Fast (the
 * shield's decay factor).
 */

/** WarriorShield.COOLDOWN_START. */
export const SHIELD_COOLDOWN = 150;
/** Turns without an enemy in sight before the shield ends. */
const SHIELD_IDLE_TURNS = 5;

/** Iron Will's points (Talent.IRON_WILL): the seal's shield is that much stronger; for another class it is the whole shield. */
export const ironWill = (hero: Hero): number => pointsInTalent(hero, 'iron_will');
/** BrokenSeal.canTransferGlyph (Runic Transference): the glyph on the armour goes with the seal. */
export const canTransferGlyph = (hero: Hero, glyph?: string): boolean => transferable(hero, glyph);

/** The armour's tier, as Armor.tier (class armour is tier 6). */
const tierOf = (armor: Item): number => itemDef(armor.kind).tier ?? 1;

/** BrokenSeal.maxShield: 3 + twice the armour's tier (5 to 15), plus Iron Will. */
export const sealShield = (hero: Hero, armor: Item): number => 3 + 2 * tierOf(armor) + ironWill(hero);

/** WarriorShield.maxShield: the seal's shield while sealed armour is worn, otherwise none. */
export function maxShield(hero: Hero): number {
  // Metamorphosed iron will: another class gets a shield of as many points as it has.
  if (hero.heroClass !== 'warrior' && ironWill(hero) > 0) return ironWill(hero);
  return hero.armor?.seal ? sealShield(hero, hero.armor) : 0;
}

/** Char.shielding: all the hero's shields together (the warrior's is the only one yet). */
export const shielding = (hero: Hero): number => hero.sealShield?.shield ?? 0;

/** WarriorShield.coolingDown. */
export const coolingDown = (hero: Hero): boolean => (hero.sealShield?.cooldown ?? 0) > 0;

/** Buff.affect(hero, WarriorShield.class): there while sealed armour is worn, or while a shield or a cooldown lasts. */
function shieldBuff(hero: Hero): NonNullable<Hero['sealShield']> | undefined {
  if (!hero.sealShield && maxShield(hero) > 0) hero.sealShield = { shield: 0, cooldown: 0, idle: 0, initial: 0 };
  return hero.sealShield;
}

/**
 * WarriorShield.act, a turn's worth: the cooldown runs down (not while a sealed floor's healing is
 * off), and a shield with no enemy in sight for five turns ends, giving up to half the cooldown back.
 */
export function sealShieldTick(ctx: Ctx, hero: Hero): void {
  const buff = shieldBuff(hero);
  if (!buff) return;
  if (buff.cooldown > 0 && regenOn(ctx.world, hero)) buff.cooldown--;
  if (buff.shield > 0) {
    // Combo: a gladiator's combo going on counts as a fight.
    const combo = hero.tal?.combo !== undefined;
    if (visibleEnemies(ctx.world, hero).length === 0 && !combo) {
      buff.idle += holdFastDecay(hero);
      if (buff.idle >= SHIELD_IDLE_TURNS) {
        if (buff.cooldown > 0) {
          const left = buff.shield / buff.initial;
          buff.cooldown = Math.max(0, Math.trunc(buff.cooldown - SHIELD_COOLDOWN * (left / 2)));
        }
        buff.shield = 0;
      }
    } else {
      buff.idle = 0;
    }
  }
  if (buff.shield <= 0 && maxShield(hero) <= 0 && buff.cooldown === 0) delete hero.sealShield;
}

/**
 * Char.damage for the hero: a blow (anything but hunger) that leaves the warrior at half health or
 * less raises the seal's shield first, unless it is cooling down (WarriorShield.activate); then the
 * shields take what they can (ShieldBuff.processDamage). Returns the damage left for health.
 */
export function shieldDamage(ctx: Ctx, hero: Hero, damage: number, hunger: boolean): number {
  if (hunger || damage <= 0) return damage;
  const buff = shieldBuff(hero);
  if (!buff) return damage;
  const half = Math.trunc(hero.ht / 2);
  if ((hero.hp <= half || hero.hp + buff.shield - damage <= half) && buff.cooldown <= 0) {
    const max = maxShield(hero);
    buff.shield += max;
    buff.cooldown = Math.max(0, buff.cooldown + SHIELD_COOLDOWN);
    buff.idle = 0;
    buff.initial = max;
    ctx.effects.push({ type: 'shielded', hero: hero.id, amount: max });
  }
  const absorbed = Math.min(buff.shield, damage);
  buff.shield -= absorbed;
  if (absorbed > 0 && buff.shield <= 0) onShieldBroken(hero);
  return damage - absorbed;
}

/* Affixing and detaching */

/** What the seal can be taken from: the seal in the pack, or an armour (worn, or in the pack) it is affixed to. */
export type SealSource = number | 'armor';

/** Armour by reference: the one worn, or one in the pack. */
const armorAt = (hero: Hero, ref: unknown): Item | undefined => {
  const item = ref === 'armor' ? hero.armor : Number.isInteger(ref) ? hero.items[ref as number] : undefined;
  return item && itemDef(item.kind).category === 'armor' ? item : undefined;
};

/** Why the seal cannot go from `from` onto `to` (BrokenSeal.affixToArmor), or null. */
export function affixProblem(hero: Hero, from: unknown, to: unknown): string | null {
  const source = from === 'armor' ? hero.armor : Number.isInteger(from) ? hero.items[from as number] : undefined;
  if (!source || (source.kind !== 'seal' && !source.seal)) return 'there is no seal there';
  const armor = armorAt(hero, to);
  if (!armor) return 'choose an armour';
  if (armor === source) return 'the seal is already there';
  if (armor.seal) return 'that armour has a seal already';
  if (!cursedKnown(armor)) return 'unknown_armor';
  if (armor.cursed) return 'cursed_armor';
  return null;
}

/**
 * BrokenSeal.affixToArmor: off the outgoing item (the seal from the pack, or the armour it was on,
 * which loses the upgrade the seal carried), onto the armour (Armor.affixSeal: the seal's upgrade
 * comes with it). It takes no time.
 */
export function affixSeal(ctx: Ctx, hero: Hero, from: SealSource, to: SealSource): void {
  const armor = armorAt(hero, to)!;
  const seal = from === 'armor' ? detachFrom(hero, hero.armor) : Number.isInteger(from) && hero.items[from]!.kind === 'seal'
    ? hero.items[from]! : detachFrom(hero, hero.items[from as number]!);
  if (hero.items.includes(seal)) hero.items.splice(hero.items.indexOf(seal), 1);
  armor.seal = { level: seal.level };
  // Armor.affixSeal: an upgraded seal raises the armour a level (without the upgrade's other effects).
  if (seal.level > 0) armor.level++;
  // A glyph the seal carried (Runic Transference) goes onto the armour.
  if (seal.glyph) armor.glyph = seal.glyph;
  ctx.effects.push({ type: 'sealAffixed', hero: hero.id, item: armor });
}

/**
 * Armor.detachSeal: the seal comes off as an item; if it carried an upgrade, the armour loses it
 * (Item.degrade). The glyph stays on the armour, unless Runic Transference carries it across.
 */
function detachFrom(hero: Hero, armor: Item): Item {
  const seal = createItem('seal', 1, armor.seal?.level ?? 0);
  delete armor.seal;
  if (seal.level > 0) armor.level--;
  if (canTransferGlyph(hero, armor.glyph) && armor.glyph) {
    seal.glyph = armor.glyph;
    delete armor.glyph;
  }
  return seal;
}

/** Why the seal cannot be taken off that armour (Armor.AC_DETACH), or null. */
export function detachProblem(hero: Hero, from: unknown): string | null {
  const armor = armorAt(hero, from);
  return armor?.seal ? null : 'there is no seal there';
}

/** Armor.execute(AC_DETACH): the seal back into the pack, or at the hero's feet with no room there. It takes no time. */
export function detachSeal(ctx: Ctx, hero: Hero, from: SealSource): void {
  const seal = detachFrom(hero, armorAt(hero, from)!);
  if (hasRoom(hero, seal)) hero.items.push(seal);
  else dropItem(ctx.floor, hero.pos, seal);
  ctx.effects.push({ type: 'sealDetached', hero: hero.id, item: seal });
}

/**
 * Armor.doEquip for the warrior: armour put on without a seal, the one taken off with it (and the new
 * one not cursed) — he is asked whether the seal should move over (Armor.seal_transfer). The client
 * asks; this says whether to.
 */
export function offersSealTransfer(hero: Hero, old: Item | undefined): boolean {
  return hero.heroClass === 'warrior' && !!old?.seal && !hero.armor.seal && !hero.armor.cursed;
}
