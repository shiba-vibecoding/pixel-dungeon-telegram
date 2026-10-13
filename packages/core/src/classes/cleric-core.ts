import { BY_ID, registerSpells } from './cleric-registry';
import type { Hero, Mob } from '../actors';
import { isAlive } from '../actors';
import { ballistica } from '../ballistica';
import { artifactSeams, dispelInvisibility } from '../artifacts';
import { chargeCap } from '../artifacts/artifact';
import { isMagicImmune } from '../buffs';
import { hurt } from '../combat';
import { energyArtifactMultiplier } from '../rings';
import { charAt, type Char, type Ctx, isHero } from '../floor';
import type { Item } from '../items';
import { regenOn } from '../hero';
import { hasTalent, pointsIn } from '../talents';
import type { World } from '../world';
import type { ClassAction } from './actions';
import { addShield, tell } from './common';
import { addTimer, cs, hasTimer, marks, markTurns, setTimer, timerLeft } from './state';
import { poweredAlly } from './cleric-allies';

/*
 * The Cleric: her holy tome (HolyTome) and what every spell shares (ClericSpell): the tome's charges, which come back with
 * time and grow with use, the registry of spells, and what happens when one is cast (onSpellCast).
 */

export type SpellId =
  | 'guidingLight' | 'holyWeapon' | 'holyWard' | 'holyIntuition' | 'shieldOfLight'
  | 'recallInscription' | 'sunray' | 'divineSense' | 'bless'
  | 'cleanse' | 'radiance' | 'smite' | 'layOnHands' | 'auraOfProtection' | 'wallOfLight' | 'holyLance' | 'hallowedGround' | 'mnemonicPrayer'
  | 'divineIntervention' | 'judgement' | 'flash' | 'bodyForm' | 'mindForm' | 'spiritForm' | 'beamingRay' | 'lifeLink' | 'stasis';

export type CastAction = Extract<ClassAction, { type: 'cast' }>;

/** What a spell asks for besides itself: nothing, a cell, or an item of the pack (or a choice from a list). */
export type Aim = 'none' | 'cell' | 'item' | 'choice';

export interface SpellDef {
  id: SpellId;
  tier: 1 | 2 | 3 | 4;
  aim: Aim;
  /** ClericSpell.targetingFlags for a cell aim: a bolt that stops at the first creature, one that stops at its target, or none. */
  flags?: 'bolt' | 'stop' | 'projectile' | 'free';
  /** ClericSpell.chargeUse. */
  cost(hero: Hero, world: World): number;
  /** Whether the hero has the spell at all (ClericSpell.getSpellList and canCast, charges aside). */
  has(hero: Hero, world: World): boolean;
  /** Refusals the spell makes before anything is spent. */
  problem?(world: World, hero: Hero, action: CastAction): string | null;
  /** Casts it; returns the time it took (the spell calls spellCast at the moment Shattered's onSpellCast does). */
  cast(ctx: Ctx, hero: Hero, action: CastAction): number;
}

export const MSG = 'art:actors.hero.spells.';
export const SELF = 'cannot target yourself';

/* The tome */

export const isTome = (item: Item | null | undefined): item is Item => item?.kind === 'artifact.tome';

/** The tome the hero casts from: the one worn, or (with light reading) one in the pack. */
export function tomeOf(hero: Hero): Item | undefined {
  const worn = [hero.artifact, hero.misc].find(isTome);
  if (worn) return worn;
  return hasTalent(hero, 'LIGHT_READING') ? hero.items.find(isTome) : undefined;
}

export const isWornTome = (hero: Hero, item: Item): boolean => hero.artifact === item || hero.misc === item;

/** HolyTome.spendCharge: charges go (whole ones from the partial), and the spell teaches the tome by the level it is cast at. */
export function spendCharge(hero: Hero, tome: Item, spent: number): boolean {
  let leveled = false;
  tome.partial = (tome.partial ?? 0) - spent;
  while (tome.partial < 0) {
    tome.charge = (tome.charge ?? 0) - 1;
    tome.partial += 1;
  }
  // The target hero level is 1 + 2 × the tome's level, and an extra one for each level after 6.
  let diff = hero.lvl - (1 + tome.level * 2);
  if (tome.level >= 7) diff -= tome.level - 6;
  tome.exp = (tome.exp ?? 0) + Math.round(diff >= 0 ? spent * 10 * Math.fround(1.1) ** diff : spent * 10 * Math.fround(0.75) ** -diff);
  if (tome.exp >= (tome.level + 1) * 50 && tome.level < 10) {
    tome.level++;
    tome.exp -= tome.level * 50;
    leveled = true;
  }
  return leveled;
}

/** HolyTome.directCharge. */
export function directCharge(tome: Item, amount: number): void {
  if ((tome.charge ?? 0) >= chargeCap(tome)) return;
  tome.partial = (tome.partial ?? 0) + amount;
  while (tome.partial >= 1) {
    tome.charge = (tome.charge ?? 0) + 1;
    tome.partial -= 1;
  }
  if ((tome.charge ?? 0) >= chargeCap(tome)) {
    tome.partial = 0;
    tome.charge = chargeCap(tome);
  }
}

/** HolyTome.charge (the artifact charging: a boost): a quarter of it, less when only carried. */
export function chargeTome(hero: Hero, tome: Item, amount: number): void {
  if (tome.cursed || isMagicImmune(hero) || (tome.charge ?? 0) >= chargeCap(tome)) return;
  if (!isWornTome(hero, tome)) amount *= Math.fround((0.75 * pointsIn(hero, 'LIGHT_READING')) / 3);
  tome.partial = (tome.partial ?? 0) + 0.25 * amount;
  while (tome.partial >= 1) {
    tome.charge = (tome.charge ?? 0) + 1;
    tome.partial -= 1;
  }
  if ((tome.charge ?? 0) >= chargeCap(tome)) {
    tome.partial = 0;
    tome.charge = chargeCap(tome);
  }
}

/** HolyTome.TomeRecharge.act, a turn's worth. */
export function tomeTurn(ctx: Ctx, hero: Hero): void {
  const tome = tomeOf(hero);
  if (!tome) return;
  const cap = chargeCap(tome);
  if ((tome.charge ?? 0) < cap && !tome.cursed && !isMagicImmune(hero)) {
    if (regenOn(ctx.world, hero)) {
      let missing = cap - (tome.charge ?? 0);
      if (tome.level > 7) missing += (5 * (tome.level - 7)) / 3;
      let turns = 45 - missing;
      turns /= energyArtifactMultiplier(hero);
      let gain = Math.fround(1 / turns);
      if (!isWornTome(hero, tome)) gain *= Math.fround((0.75 * pointsIn(hero, 'LIGHT_READING')) / 3);
      tome.partial = (tome.partial ?? 0) + gain;
    }
    while ((tome.partial ?? 0) >= 1) {
      tome.charge = (tome.charge ?? 0) + 1;
      tome.partial! -= 1;
      if (tome.charge === cap) tome.partial = 0;
    }
  } else {
    tome.partial = 0;
  }
}

/** HolyWeapon.HolyWepBuff.extend: no longer than twice its duration. */
function extendTimer(hero: Hero, key: string, by: number): void {
  const left = timerLeft(hero, key);
  if (left + by <= 100) addTimer(hero, key, by);
  else setTimer(hero, key, 100);
}

/** ClericSpell.onSpellCast. */
export function spellCast(ctx: Ctx, hero: Hero, spell: SpellDef): void {
  const tome = tomeOf(hero)!;
  dispelInvisibility(ctx, hero);
  const state = cs(hero);
  if (hasTalent(hero, 'SATIATED_SPELLS') && state.holy?.satiated) {
    const amount = 1 + 2 * pointsIn(hero, 'SATIATED_SPELLS');
    addShield(hero, amount);
    const ally = poweredAlly(ctx);
    if (ally && markTurns(ally, 'lifeLinkSpell') > 0) addShield(ally, amount);
    delete state.holy!.satiated;
  }
  const cost = spell.cost(hero, ctx.world);
  if (spendCharge(hero, tome, cost)) tell(ctx, hero, 'holytome.levelup', 'p');
  artifactSeams.onArtifactUsed(ctx, hero);
  if (hero.subclass === 'paladin') {
    const extend = (key: string, own: SpellId): void => {
      if (spell.id !== own && hasTimer(hero, key)) extendTimer(hero, key, 10 * cost);
    };
    extend('holyWep', 'holyWeapon');
    extend('holyArm', 'holyWard');
  }
  const ascend = state.ascend;
  if (ascend) {
    ascend.spellCasts++;
    ascend.shield += Math.trunc(10 * cost);
  }
}

/* The registry */

export { registerSpells };
export const spellDef = (id: string): SpellDef | undefined => BY_ID.get(id);

/** ClericSpell.getSpellList: every spell the hero has in a tier. */
export function spellsOf(hero: Hero, world: World, tier: 1 | 2 | 3 | 4): SpellDef[] {
  return [...BY_ID.values()].filter((def) => def.tier === tier && def.has(hero, world));
}

/** The spells of all tiers, in the window's order. */
export const allSpells = (hero: Hero, world: World): SpellDef[] => ([1, 2, 3, 4] as const).flatMap((tier) => spellsOf(hero, world, tier));

/* Shared parts of the spells */

/** A hostile creature a spell could be cast at. */
export const hostileMob = (mob: Mob): boolean => isAlive(mob) && !mob.ally && mob.state !== 'passive';

/** Where a bolt cast at a cell stops, and who is there. */
export function boltTarget(world: World, depth: number, hero: Hero, cell: number, flags: number): { end: number; who: Char | undefined } {
  const aim = ballistica({ world, depth, level: world.levels[depth]! }, hero.pos, cell, flags);
  return { end: aim.collisionPos, who: charAt(world, depth, aim.collisionPos) };
}

/** Mob.damage from a spell: the hero's. */
export function spellHurt(ctx: Ctx, hero: Hero, victim: Char, amount: number): void {
  if (amount <= 0 || !isAlive(victim)) return;
  ctx.effects.push({ type: 'hurt', depth: ctx.depth, who: victim.id, damage: amount });
  hurt(ctx, victim, amount, hero);
}

/** GuidingLight.Illuminated: the next blow on it is the stronger. */
export function illuminate(target: Char): void {
  if (!isHero(target)) marks(target).lit = true;
}

/** Barrier.setShield: raised to this much, never lowered. */
export function shieldTo(ch: Char, amount: number): void {
  if (amount > (ch.shield ?? 0)) {
    ch.shield = amount;
    ch.shieldDecay = 0;
  }
}

/** Whether the hero's powered ally is life-linked to them (many spells then repeat on it). */
export function linkedAlly(ctx: Ctx): Mob | undefined {
  const ally = poweredAlly(ctx);
  return ally && markTurns(ally, 'lifeLinkSpell') > 0 ? ally : undefined;
}

export const isFlier = (ch: Char): boolean =>
  isHero(ch) ? (ch.levitating ?? 0) > 0 : (ch.levitating ?? 0) > 0 || ['bat', 'swarm', 'elemental', 'eye', 'ghost', 'wraith', 'bee', 'curse', 'ghostHero'].includes(ch.kind);
