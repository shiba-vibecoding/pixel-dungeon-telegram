import { type Hero, heroArtifacts } from '../actors';
import { chargeTome } from '../classes/cleric-core';
import { hasTalent } from '../talents';
import type { Ctx } from '../floor';
import type { Item } from '../items';
import { itemAt, type ItemRef } from '../scrolls';
import type { World } from '../world';
import { isArtifact } from './artifact';
import { armbandAct, armbandGainsExp, armbandProblem, chargeArmband, shoplift, stealFrom } from './armband';
import { beaconAct, beaconPrevented, beaconProblem, chargeBeacon, setBeacon, zapBeacon } from './beacon';
import { capeAct, capeOff, chargeCape } from './cape';
import { chainsAct, chainsGainExp, chainsProblem, castChains, chargeChains } from './chains';
import { chaliceProblem, chargeChalice, prick } from './chalice';
import { chargeCloak, cloakAct, cloakProblem, useCloak } from './cloak';
import { isWorn } from './common';
import { chargeHorn, eatFromHorn, hornGainsExp, hornProblem, storeInHorn } from './horn';
import { chargeHourglass, hourglassAct, hourglassOff, hourglassProblem, useHourglass } from './hourglass';
import { chargeRose, directGhost, outfitGhost, roseAct, roseProblem, summonGhost, unoutfitGhost } from './rose';
import { chargeSandals, feedSandals, rootSandals, sandalsProblem } from './sandals';
import { addToSpellbook, chargeSpellbook, readSpellbook, resolveProblem, resolveSpellbook, spellbookAct, spellbookProblem } from './spellbook';
import { awarenessFades, chargeTalisman, scry, talismanAct, talismanProblem } from './talisman';
import { chargeToolkit, energizeToolkit, toolkitAct, toolkitGainsExp, toolkitProblem, toolkitPutOn } from './toolkit';
import { lightCloakPoints, magicImmune } from './seams';

/*
 * Artifacts in play: the actions each offers (Artifact.actions and execute),
 * the passive buff each keeps while worn, and the hooks other rules call —
 * experience gained, a boost of charge, putting one on and taking it off.
 */

/** An artifact's actions, as Shattered names them (AC_*), plus settling the spellbook's scroll and the rose's gear. */
export type ArtifactUse =
  | 'stealth'
  | 'snack' | 'eat' | 'store'
  | 'prick'
  | 'stasis' | 'freeze'
  | 'scry'
  | 'read' | 'add' | 'resolve'
  | 'cast'
  | 'summon' | 'direct' | 'outfit' | 'unoutfit'
  | 'steal' | 'shoplift'
  | 'feed' | 'root'
  | 'brew' | 'energize'
  | 'zap' | 'set' | 'return';

export const ARTIFACT_USES: readonly ArtifactUse[] = [
  'stealth', 'snack', 'eat', 'store', 'prick', 'stasis', 'freeze', 'scry', 'read', 'add', 'resolve', 'cast', 'summon', 'direct',
  'outfit', 'unoutfit', 'steal', 'shoplift', 'feed', 'root', 'brew', 'energize', 'zap', 'set', 'return',
];

/** Which uses each artifact has. */
const USES: Readonly<Record<string, readonly ArtifactUse[]>> = {
  'artifact.cloak': ['stealth'],
  'artifact.horn': ['snack', 'eat', 'store'],
  'artifact.chalice': ['prick'],
  'artifact.hourglass': ['stasis', 'freeze'],
  'artifact.talisman': ['scry'],
  'artifact.spellbook': ['read', 'add', 'resolve'],
  'artifact.chains': ['cast'],
  'artifact.rose': ['summon', 'direct', 'outfit', 'unoutfit'],
  'artifact.armband': ['steal', 'shoplift'],
  'artifact.sandals': ['feed', 'root'],
  'artifact.cape': [],
  'artifact.toolkit': ['brew', 'energize'],
  'artifact.beacon': ['zap', 'set', 'return'],
};

/** Using an artifact: worn (by its slot) or in the pack (by its index). */
export interface ArtifactAction {
  type: 'artifact';
  item: ItemRef;
  use: ArtifactUse;
  /** The cell aimed at: scry, cast, direct, steal, root, zap. */
  cell?: number;
  /** A backpack slot of what it takes: the horn's food, the spellbook's scroll, the sandals' seed, the rose's gear. */
  with?: number;
  /** resolve: 0 the scroll, 1 its exotic; unoutfit: 0 the weapon, 1 the armour; energize: how many levels. */
  choice?: number;
  /** resolve: what the scroll is read on. */
  on?: ItemRef;
}

/** The spellbook whose scroll waits to be settled. */
const pendingBook = (hero: Hero): Item | undefined => heroArtifacts(hero).find((item) => item.kind === 'artifact.spellbook');

/** Why the artifact cannot be used so now, or null. Reasons starting 'art:' are message keys under items.artifacts. */
export function artifactProblem(world: World, hero: Hero, action: ArtifactAction, ctx: Ctx): string | null {
  if (hero.pendingScroll && action.use !== 'resolve') return 'art:unstablespellbook.prompt';
  const item = itemAt(hero, action.item);
  if (!item || !isArtifact(item)) return 'no such artifact';
  if (!(USES[item.kind] ?? []).includes(action.use)) return 'art:cannot';
  const withItem = action.with === undefined ? undefined : Number.isInteger(action.with) ? hero.items[action.with] : undefined;
  switch (item.kind) {
    case 'artifact.cloak':
      return cloakProblem(hero, item);
    case 'artifact.horn':
      return hornProblem(hero, item, action.use, withItem);
    case 'artifact.chalice':
      return chaliceProblem(hero, item);
    case 'artifact.hourglass':
      return hourglassProblem(hero, item);
    case 'artifact.talisman':
      return talismanProblem(hero, item, action.cell);
    case 'artifact.spellbook':
      if (action.use === 'resolve') return resolveProblem(world, hero, action.choice, action.on);
      return spellbookProblem(world, hero, item, action.use, withItem);
    case 'artifact.chains':
      return chainsProblem(ctx, hero, item, action.cell);
    case 'artifact.rose':
      if (action.use === 'direct' && (action.cell === undefined || !Number.isInteger(action.cell))) return 'art:cannot';
      return roseProblem(ctx, hero, item, action.use, withItem, action.choice);
    case 'artifact.armband':
      return armbandProblem(world, hero, item, action.use, action.cell);
    case 'artifact.sandals':
      return sandalsProblem(world, hero, item, action.use, withItem, action.cell);
    case 'artifact.toolkit':
      return toolkitProblem(world, hero, item, action.use, action.choice);
    case 'artifact.beacon':
      return beaconProblem(world, hero, item, action.use, action.cell);
    default:
      return 'art:cannot';
  }
}

/** What the world does for an artifact that moves the hero: back to the beacon's spot, or somewhere at random on the level. */
export interface Travel {
  teleport(): void;
  returnTo(depth: number, pos: number): void;
}

/** Uses the artifact; returns the time it took. */
export function performArtifact(ctx: Ctx, hero: Hero, action: ArtifactAction, travel: Travel): number {
  const item = itemAt(hero, action.item)!;
  const cell = action.cell!;
  const withIndex = action.with!;
  switch (action.use) {
    case 'stealth':
      return useCloak(ctx, hero, item);
    case 'snack':
    case 'eat':
      return eatFromHorn(ctx, hero, item, action.use === 'snack');
    case 'store':
      return storeInHorn(ctx, hero, item, withIndex);
    case 'prick':
      return prick(ctx, hero, item);
    case 'stasis':
    case 'freeze':
      return useHourglass(ctx, hero, item, action.use === 'stasis');
    case 'scry':
      return scry(ctx, hero, item, cell);
    case 'read':
      return readSpellbook(ctx, hero, item);
    case 'add':
      return addToSpellbook(ctx, hero, item, withIndex);
    case 'resolve':
      return resolveSpellbook(ctx, hero, pendingBook(hero), action.choice ?? 0, action.on);
    case 'cast':
      return castChains(ctx, hero, item, cell);
    case 'summon':
      return summonGhost(ctx, hero, item);
    case 'direct':
      return directGhost(ctx, hero, item, cell);
    case 'outfit':
      return outfitGhost(ctx, hero, item, withIndex);
    case 'unoutfit':
      return unoutfitGhost(ctx, hero, item, action.choice!);
    case 'steal':
      return stealFrom(ctx, hero, item, cell);
    case 'shoplift':
      return shoplift(ctx, hero, item);
    case 'feed':
      return feedSandals(ctx, hero, item, withIndex);
    case 'root':
      return rootSandals(ctx, hero, item, cell);
    case 'energize':
      return energizeToolkit(ctx, hero, item, action.choice!);
    case 'brew':
      // Seam (alchemy stream): the alchemy window opens with the toolkit's energy.
      ctx.effects.push({ type: 'alchemy', hero: hero.id, toolkit: true });
      return 0;
    case 'set':
      if (beaconPrevented(ctx, hero)) return 1;
      return setBeacon(ctx, hero, item);
    case 'return':
      if (beaconPrevented(ctx, hero)) return 1;
      ctx.effects.push({ type: 'beacon', hero: hero.id, mode: 'return' });
      travel.returnTo(item.returnTo!.depth, item.returnTo!.pos);
      return 0;
    case 'zap':
      return zapBeacon(ctx, hero, item, cell, travel.teleport);
  }
}

/**
 * The artifacts' buffs, once a turn: those worn (and the cloak carried, with the light cloak talent).
 * Returns the time a cursed hourglass stole.
 */
export function artifactsAct(ctx: Ctx, hero: Hero): number {
  let lost = 0;
  const worn = heroArtifacts(hero);
  const carried = lightCloakPoints(hero) > 0 ? hero.items.filter((item) => item.kind === 'artifact.cloak') : [];
  for (const item of [...worn, ...carried]) {
    switch (item.kind) {
      case 'artifact.cloak':
        cloakAct(ctx, hero, item);
        break;
      case 'artifact.hourglass':
        lost += hourglassAct(ctx, hero, item);
        break;
      case 'artifact.talisman':
        talismanAct(ctx, hero, item);
        break;
      case 'artifact.spellbook':
        spellbookAct(ctx, hero, item);
        break;
      case 'artifact.chains':
        chainsAct(ctx, hero, item);
        break;
      case 'artifact.rose':
        roseAct(ctx, hero, item);
        break;
      case 'artifact.armband':
        armbandAct(ctx, hero, item);
        break;
      case 'artifact.cape':
        capeAct(ctx, hero, item);
        break;
      case 'artifact.toolkit':
        toolkitAct(hero, item);
        break;
      case 'artifact.beacon':
        beaconAct(ctx, hero, item);
        break;
    }
  }
  return lost;
}

/** What wears off with time, however much passes: the creatures and heaps the talisman shows. */
export function artifactsTime(hero: Hero, time: number): void {
  awarenessFades(hero, time);
}

/** Hero.earnExp: the artifacts that charge (or learn) as the hero gains experience, with the share of a level gained. */
export function artifactsGainExp(ctx: Ctx, hero: Hero, percent: number): void {
  for (const item of heroArtifacts(hero)) {
    if (item.kind === 'artifact.chains') chainsGainExp(ctx, hero, item, percent);
    if (item.kind === 'artifact.horn') hornGainsExp(ctx, hero, item, percent);
    if (item.kind === 'artifact.toolkit') toolkitGainsExp(hero, item, percent);
    if (item.kind === 'artifact.armband') armbandGainsExp(ctx, hero, item, percent);
  }
}

/** ArtifactRecharge.chargeArtifacts: every uncursed artifact worn gets a boost of `amount` turns' worth (talents, potions). */
export function chargeArtifacts(ctx: Ctx, hero: Hero, amount: number, ignoreHorn = false): void {
  for (const item of heroArtifacts(hero)) {
    if (item.cursed && !magicImmune(hero)) continue;
    if (ignoreHorn && item.kind === 'artifact.horn') continue;
    chargeArtifact(ctx, hero, item, amount);
  }
  // The holy tome carried (light reading) charges a little too.
  const carried = hero.items.find((item) => item.kind === 'artifact.tome');
  if (carried && hasTalent(hero, 'LIGHT_READING')) chargeTome(hero, carried, amount);
}

/** Artifact.charge, by kind. */
export function chargeArtifact(ctx: Ctx, hero: Hero, item: Item, amount: number): void {
  switch (item.kind) {
    case 'artifact.cloak': return chargeCloak(hero, item, amount);
    case 'artifact.horn': return chargeHorn(ctx, hero, item, amount);
    case 'artifact.chalice': return chargeChalice(ctx, hero, item, amount);
    case 'artifact.hourglass': return chargeHourglass(hero, item, amount);
    case 'artifact.talisman': return chargeTalisman(ctx, hero, item, amount);
    case 'artifact.spellbook': return chargeSpellbook(hero, item, amount);
    case 'artifact.chains': return chargeChains(hero, item, amount);
    case 'artifact.rose': return chargeRose(ctx, hero, item, amount);
    case 'artifact.armband': return chargeArmband(ctx, hero, item, amount);
    case 'artifact.sandals': return chargeSandals(hero, item, amount);
    case 'artifact.cape': return chargeCape(ctx, hero, item, amount);
    case 'artifact.toolkit': return chargeToolkit(hero, item, amount);
    case 'artifact.beacon': return chargeBeacon(item, amount);
    case 'artifact.tome': return chargeTome(hero, item, amount);
  }
}

/** Artifact.doEquip's activate: what an artifact starts when put on. */
export function artifactPutOn(_ctx: Ctx, _hero: Hero, item: Item): void {
  if (item.kind === 'artifact.toolkit') toolkitPutOn(item);
}

/** Artifact.doUnequip: what an artifact had under way ends when it comes off. */
export function artifactTakenOff(ctx: Ctx, hero: Hero, item: Item): void {
  // CloakOfShadows.doUnequip: the stealth ends, unless the light cloak talent lets the cloak work from the pack.
  if (item.kind === 'artifact.cloak' && item.stealth && lightCloakPoints(hero) === 0) {
    delete item.stealth;
    ctx.effects.push({ type: 'stealth', hero: hero.id, on: false });
  }
  if (item.kind === 'artifact.hourglass') hourglassOff(ctx, hero, item);
  if (item.kind === 'artifact.cape') capeOff(item);
}

export { isWorn };
export * from './artifact';
export { cloaked } from './cloak';
export { isInvisible, dispelInvisibility, stealthCloak } from './invisibility';
export { frozenBy, freezeTime, disarmPresses } from './hourglass';
export { heroPress } from './press';
export { prickDeathChance, minPrick, maxPrick, chaliceRegenDelay } from './chalice';
export { foodValue } from './horn';
export { talismanBlinds, talismanFound, awareCells, type Awareness } from './talisman';
export { capeTakes } from './cape';
export { naturalism, canFeed, SEED_CHARGE } from './sandals';
export { chargesToUse, stealChance, thievery } from './armband';
export {
  ghostAct, ghostDied, ghostFollows, ghostOf, ghostQuestDone, ghostSays, ghostSeesBoss, ghostSeesHero, ghostStrength, petalsFor, pickPetal,
} from './rose';
export { bossSlainBeacon } from './beacon';
export { readyToolkit, toolkitForbidsAlchemy, availableEnergy, consumeEnergy, toolkitWarming } from './toolkit';
export { type PendingScroll, indexOf as spellbookIndex, setupScrolls } from './spellbook';
export { upgradeArtifact, transferUpgrade, wornOf, carriedOf, say } from './common';
export * as artifactSeams from './seams';
