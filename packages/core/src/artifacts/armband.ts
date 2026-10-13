import { type Hero, isShopkeeper, type Mob, MOBS } from '../actors';
import { lootOf, shopkeeperFlees } from '../combat';
import { charAt, type Ctx, dropItem, isHero } from '../floor';
import { collect } from '../inventory';
import { type Item, itemPrice } from '../items';
import { adjacent, LENGTH } from '../level/geometry';
import { underChallenges } from '../challenges';
import type { World } from '../world';
import { chargeCap, levelCap, visiblyUpgraded } from './artifact';
import { isWorn, say, upgradeArtifact, wornOf } from './common';
import { dispelInvisibility, isInvisible } from './invisibility';
import { artifactChargeMultiplier, artifactProc, magicImmune, onArtifactUsed } from './seams';

/*
 * MasterThievesArmband: worn, it charges as its bearer gains experience. A
 * charge steals from a monster beside the hero — more likely the stronger the
 * armband, and from one caught unawares — and leaves it blinded and crippled
 * a while; each monster can be robbed (or tried) once. In a shop it can
 * steal the ware the hero stands on, at a charge per so much of its worth;
 * caught, the shopkeeper runs off with the rest. Cursed, it lets gold slip
 * away.
 */

/** The ware the hero stands on in a shop. */
const wareUnder = (world: World, hero: Hero): Item | undefined =>
  world.floors[hero.depth]?.heaps.find((heap) => heap.pos === hero.pos && heap.kind === 'forSale')?.items[0];

export function armbandProblem(world: World, hero: Hero, item: Item, use: string, cell: number | undefined): string | null {
  if (magicImmune(hero)) return 'art:magic_immune';
  if (!isWorn(hero, item)) return 'art:artifact.need_to_equip';
  if ((item.charge ?? 0) < 1) return 'art:masterthievesarmband.no_charge';
  if (item.cursed) return 'art:masterthievesarmband.cursed';
  if (use === 'shoplift') {
    const ware = wareUnder(world, hero);
    return ware && chargesToUse(item, world, ware) > 0 ? null : 'art:cannot';
  }
  if (cell === undefined || !Number.isInteger(cell) || cell < 0 || cell >= LENGTH) return 'art:masterthievesarmband.prompt';
  const there = charAt(world, hero.depth, cell);
  if (!adjacent(hero.pos, cell) || !there || isHero(there)) return 'art:masterthievesarmband.no_target';
  if (isShopkeeper(there)) return 'art:masterthievesarmband.steal_shopkeeper';
  if (there.state === 'passive') return 'art:masterthievesarmband.no_target';
  return null;
}

/** Mob.surprisedBy: the hero unseen, or not the one it has spotted. */
const surprisedBy = (mob: Mob, hero: Hero): boolean => isInvisible(hero) || !mob.enemySeen || mob.enemy !== hero.id;

/** The targeter's onSelect: a theft from the monster beside the hero. */
export function stealFrom(ctx: Ctx, hero: Hero, item: Item, cell: number): number {
  const mob = charAt(ctx.world, ctx.depth, cell) as Mob;
  const surprised = surprisedBy(mob, hero);
  let lootMultiplier = 1 + 0.1 * item.level;
  let debuff = 3 + Math.trunc(item.level / 2);
  dispelInvisibility(ctx, hero);
  if (surprised) {
    lootMultiplier += 0.5;
    debuff += 2;
    item.exp = (item.exp ?? 0) + 2;
    ctx.effects.push({ type: 'surprised', depth: ctx.depth, mob: mob.id });
  }
  const loot = lootOf(ctx, mob);
  let chance = loot.chance * lootMultiplier;
  if (hero.lvl > MOBS[mob.kind].maxLvl + 2 || mob.robbed) chance = 0;
  if (chance === 0) {
    say(ctx, hero, 'masterthievesarmband.no_steal', 'w');
  } else if (ctx.rng.float() <= chance) {
    const stolen = loot.make();
    if (!stolen || underChallenges(ctx.world, stolen) !== stolen) {
      say(ctx, hero, 'masterthievesarmband.failed_steal');
      mob.robbed ??= 'tried';
    } else {
      if (!collect(hero, stolen)) dropItem(ctx.floor, hero.pos, stolen);
      ctx.effects.push({ type: 'pickedUp', hero: hero.id, item: stolen });
      say(ctx, hero, 'masterthievesarmband.stole_item', 'i', undefined, stolen);
      mob.robbed = 'stolen';
    }
  } else {
    say(ctx, hero, 'masterthievesarmband.failed_steal');
    mob.robbed ??= 'tried';
  }
  // Blindness and Cripple, prolonged.
  mob.blind = Math.max(mob.blind ?? 0, debuff);
  mob.crippled = Math.max(mob.crippled ?? 0, debuff);
  artifactProc(ctx, mob, visiblyUpgraded(item), 1);
  item.charge = (item.charge ?? 0) - 1;
  item.exp = (item.exp ?? 0) + 3;
  onArtifactUsed(ctx, hero);
  levelUp(ctx, hero, item);
  return 0;
}

/** The armband's level-ups: ten experience a level, three and a third more each time. */
function levelUp(ctx: Ctx, hero: Hero, item: Item): void {
  while ((item.exp ?? 0) >= 10 + Math.round(3.33 * item.level) && item.level < levelCap(item)) {
    item.exp! -= 10 + Math.round(3.33 * item.level);
    say(ctx, hero, 'masterthievesarmband.level_up', 'p');
    upgradeArtifact(ctx, item);
  }
}

/** Thievery.chargesToUse: a charge for every ten (and half a level) of the ware's worth, as many as the armband has. */
export function chargesToUse(item: Item, world: World, ware: Item): number {
  const value = itemPrice(ware, world.known.includes(ware.kind));
  let using = 0;
  let charges = 0;
  while (using < value && charges < (item.charge ?? 0)) {
    using += 10 + item.level / 2;
    charges++;
  }
  return charges;
}

/** Thievery.stealChance: how likely the theft of a ware is. */
export function stealChance(item: Item, world: World, ware: Item): number {
  const value = itemPrice(ware, world.known.includes(ware.kind));
  return Math.min(1, (chargesToUse(item, world, ware) * (10 + item.level / 2)) / Math.max(1, value));
}

/** WndTradeItem's steal: sure, or a gamble that, lost, makes the shopkeeper flee with everything (Thievery.steal). */
export function shoplift(ctx: Ctx, hero: Hero, item: Item): number {
  const heap = ctx.floor.heaps.find((h) => h.pos === hero.pos && h.kind === 'forSale')!;
  const ware = heap.items[0]!;
  const charges = chargesToUse(item, ctx.world, ware);
  const chance = stealChance(item, ctx.world, ware);
  if (ctx.rng.float() > chance) {
    const keeper = ctx.floor.mobs.find((mob) => isShopkeeper(mob));
    if (keeper) {
      ctx.effects.push({ type: 'artifact', hero: hero.id, msg: 'actors.mobs.npcs.shopkeeper.thief', tone: 'n' });
      shopkeeperFlees(ctx, keeper);
    }
    return 0;
  }
  item.charge = (item.charge ?? 0) - charges;
  item.exp = (item.exp ?? 0) + 4 * charges;
  say(ctx, hero, 'masterthievesarmband.stole_item', 'i', undefined, ware);
  onArtifactUsed(ctx, hero);
  levelUp(ctx, hero, item);
  heap.items.shift();
  if (heap.items.length === 0) ctx.floor.heaps.splice(ctx.floor.heaps.indexOf(heap), 1);
  if (!collect(hero, ware)) dropItem(ctx.floor, hero.pos, ware);
  ctx.effects.push({ type: 'pickedUp', hero: hero.id, item: ware });
  return 1;
}

/** Thievery.act: a cursed armband lets a coin slip away now and then. */
export function armbandAct(ctx: Ctx, hero: Hero, item: Item): void {
  if (item.cursed && hero.gold > 0 && ctx.rng.int(5) === 0) hero.gold--;
}

/** Thievery.gainCharge: three charges a hero level at +0, four and a half at +10. */
export function armbandGainsExp(ctx: Ctx, hero: Hero, item: Item, levelPortion: number): void {
  if (item.cursed || magicImmune(hero)) return;
  const cap = chargeCap(item);
  if ((item.charge ?? 0) >= cap) {
    item.partial = 0;
    return;
  }
  item.partial = (item.partial ?? 0) + (3 + 0.15 * item.level) * levelPortion * artifactChargeMultiplier(hero);
  while (item.partial > 1) {
    item.partial--;
    item.charge = (item.charge ?? 0) + 1;
    if (item.charge === cap) {
      say(ctx, hero, 'masterthievesarmband.full', 'p');
      item.partial = 0;
    }
  }
}

/** MasterThievesArmband.charge: a tenth of the boost. */
export function chargeArmband(ctx: Ctx, hero: Hero, item: Item, amount: number): void {
  if (item.cursed || magicImmune(hero)) return;
  const cap = chargeCap(item);
  if ((item.charge ?? 0) >= cap) return;
  item.partial = (item.partial ?? 0) + 0.1 * amount;
  while (item.partial >= 1) {
    item.charge = (item.charge ?? 0) + 1;
    item.partial--;
  }
  if (item.charge! >= cap) {
    say(ctx, hero, 'masterthievesarmband.full', 'p');
    item.partial = 0;
    item.charge = cap;
  }
}

/** The armband a hero could steal a ware with (WndTradeItem shows the steal button): worn, uncursed, with charge enough. */
export const thievery = (hero: Hero): Item | undefined => {
  const item = wornOf(hero, 'artifact.armband');
  return item && !item.cursed && !magicImmune(hero) ? item : undefined;
};

