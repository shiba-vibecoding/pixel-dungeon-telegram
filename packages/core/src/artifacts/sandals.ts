import { type Hero, isAlive } from '../actors';
import { charAt, type Ctx, heroView } from '../floor';
import { type Item, itemDef, type ItemKind } from '../items';
import { distance, LENGTH } from '../level/geometry';
import type { World } from '../world';
import { plant, SEED_PLANTS, stepOnPlant } from '../plants';
import { chargeCap, visiblyUpgraded } from './artifact';
import { isWorn, say, upgradeArtifact, wornOf } from './common';
import { dispelInvisibility } from './invisibility';
import { artifactChargeMultiplier, artifactProc, magicImmune, onArtifactUsed } from './seams';

/*
 * SandalsOfNature: worn, they draw strength from the grass their bearer
 * tramples, and the grass gives more seeds and dew. Fed seeds — three
 * different kinds for the first level, six, then nine — they grow into
 * shoes, boots and greaves; the last seed fed is one they can grow, a plant
 * set off at once where the hero points, for so much of their charge.
 */

/** SandalsOfNature.seedChargeReqs, by the seeds there are (Shattered's stormvine is the dreamweed here). */
export const SEED_CHARGE: Readonly<Partial<Record<ItemKind, number>>> = {
  'seed.rotberry': 8, 'seed.firebloom': 20, 'seed.sungrass': 80, 'seed.icecap': 20, 'seed.dreamweed': 20, 'seed.sorrowmoss': 20,
  'seed.earthroot': 40, 'seed.fadeleaf': 12, 'seed.stormvine': 20, 'seed.swiftthistle': 20, 'seed.mageroyal': 12, 'seed.starflower': 40,
  'seed.blindweed': 12,
};

/** SandalsOfNature.canUseSeed: a seed it has not had towards this level (at its last level, any but the one it grows). */
export const canFeed = (item: Item, seed: Item): boolean =>
  itemDef(seed.kind).category === 'seed' && !(item.seeds ?? []).includes(seed.kind) && (item.level < 3 || item.seedEffect !== seed.kind);

export function sandalsProblem(world: World, hero: Hero, item: Item, use: string, seed: Item | undefined, cell: number | undefined): string | null {
  if (magicImmune(hero)) return 'art:magic_immune';
  if (!isWorn(hero, item)) return 'art:artifact.need_to_equip';
  if (item.cursed) return 'art:cannot';
  if (use === 'feed') return seed && canFeed(item, seed) ? null : 'art:sandalsofnature.prompt';
  if (!item.seedEffect) return 'art:sandalsofnature.no_effect';
  if ((item.charge ?? 0) < (SEED_CHARGE[item.seedEffect] ?? 20)) return 'art:sandalsofnature.low_charge';
  if (cell === undefined || !Number.isInteger(cell) || cell < 0 || cell >= LENGTH) return 'art:sandalsofnature.prompt_target';
  return heroView(world, hero)[cell] && distance(hero.pos, cell) <= 3 ? null : 'art:sandalsofnature.out_of_range';
}

/** The item selector's onSelect: the seed is taken in; enough of them, and the footwear grows. */
export function feedSandals(ctx: Ctx, hero: Hero, item: Item, index: number): number {
  const seed = hero.items[index]!;
  const kind = seed.kind;
  if (item.level < 3) (item.seeds ??= []).unshift(kind);
  item.seedEffect = kind;
  if ((item.seeds ?? []).length >= 3 + item.level * 3) {
    item.seeds = [];
    upgradeArtifact(ctx, item);
    if (item.level >= 1 && item.level <= 3) say(ctx, hero, 'sandalsofnature.levelup', 'p');
  } else {
    say(ctx, hero, 'sandalsofnature.absorb_seed');
  }
  if (--seed.qty <= 0) hero.items.splice(index, 1);
  return 1;
}

/** The cell selector: within three cells in sight, the plant grows and is set off at once on whoever stands there. */
export function rootSandals(ctx: Ctx, hero: Hero, item: Item, cell: number): number {
  dispelInvisibility(ctx, hero);
  const kind = SEED_PLANTS[item.seedEffect!];
  if (kind) {
    plant(ctx, cell, kind);
    const who = charAt(ctx.world, ctx.depth, cell);
    stepOnPlant(ctx, who ?? null, cell, true);
    if (who && isAlive(who)) artifactProc(ctx, who, visiblyUpgraded(item), SEED_CHARGE[item.seedEffect!] ?? 20);
  }
  item.charge = (item.charge ?? 0) - (SEED_CHARGE[item.seedEffect!] ?? 20);
  onArtifactUsed(ctx, hero);
  return 1;
}

/** Naturalism.charge: trampled grass, half a charge at +0, one and a half at +3. */
export function naturalismCharge(hero: Hero, item: Item): void {
  if (item.cursed || magicImmune(hero)) return;
  const cap = chargeCap(item);
  if ((item.charge ?? 0) >= cap) return;
  item.partial = (item.partial ?? 0) + Math.max(0, ((3 + 2 * item.level) / 6) * artifactChargeMultiplier(hero));
  while (item.partial >= 1) {
    item.charge = (item.charge ?? 0) + 1;
    item.partial--;
  }
  item.charge = Math.min(item.charge ?? 0, cap);
}

/** SandalsOfNature.charge: twice the boost. */
export function chargeSandals(hero: Hero, item: Item, amount: number): void {
  if (item.cursed || magicImmune(hero)) return;
  const cap = chargeCap(item);
  if ((item.charge ?? 0) >= cap) return;
  item.partial = (item.partial ?? 0) + 2 * amount;
  while (item.partial >= 1) {
    item.charge = (item.charge ?? 0) + 1;
    item.partial--;
  }
  if (item.charge! >= cap) {
    item.charge = cap;
    item.partial = 0;
  }
}

/**
 * HighGrass.trample with the sandals worn: their level and one (`naturalismLevel`) for the seed and dew
 * odds, and a charge from the grass; -1 when cursed, for no loot at all; null without sandals.
 */
export function naturalism(hero: Hero | undefined): number | null {
  const item = hero ? wornOf(hero, 'artifact.sandals') : undefined;
  if (!hero || !item) return null;
  // ArtifactBuff.isCursed: no curse works under magic immunity.
  if (item.cursed && !magicImmune(hero)) return -1;
  naturalismCharge(hero, item);
  return item.level + 1;
}

