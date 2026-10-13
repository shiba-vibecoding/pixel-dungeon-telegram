import type { Hero } from './actors';
import { isAlive } from './actors';
import { type Ctx, heroView } from './floor';
import { createItem, type Item, itemDef, type ItemKind, type LevelTrinkets } from './items';
import { distance, NEIGHBOURS8, WIDTH } from './level/geometry';
import { type GasKind, reachable, seedCorrosive, seedGas } from './gas';
import type { Rng } from './rng';
import type { World } from './world';
import { buffsOf } from './buffs';

/*
 * Trinkets (items/trinkets): made from the trinket catalyst, one of four of the hero's choosing (alchemy.ts), and
 * upgraded in the alchemy pot up to +3 (Trinket.UpgradeTrinket). Each changes the run a little, the more the higher
 * its level; trinketLevel is -1 without one. Their effects are hooked where they act: the generator, the hero's
 * numbers, healing, hunger, the grass. Those that act through systems other streams port keep a seam here: the
 * mossy clump and trap mechanism (level feelings: levels), the mimic tooth's stealthy and ebony mimics and the
 * rat skull (mobs), the wondrous resin (cursed wands: wands), the shard of oblivion's hold on identification (gear).
 */

export const TRINKETS: readonly ItemKind[] = [
  'trinket.ratSkull', 'trinket.parchmentScrap', 'trinket.petrifiedSeed', 'trinket.exoticCrystals', 'trinket.mossyClump', 'trinket.sundial',
  'trinket.clover', 'trinket.trapMechanism', 'trinket.mimicTooth', 'trinket.wondrousResin', 'trinket.eyeOfNewt', 'trinket.saltCube',
  'trinket.vialOfBlood', 'trinket.shardOfOblivion', 'trinket.chaoticCenser', 'trinket.ferretTuft', 'trinket.spyglass',
];

/** Trinket.trinketLevel: the level of the hero's trinket of a kind, or -1 without one. */
export function trinketLevel(hero: Hero | undefined, kind: ItemKind): number {
  const trinket = hero?.items.find((item) => item.kind === kind);
  return trinket ? trinket.level : -1;
}

/** Trinket.upgradeEnergyCost: what upgrading a trinket in the alchemy pot costs (the clump, scrap and resin more). */
export function trinketUpgradeCost(item: Item): number {
  const dearer = item.kind === 'trinket.mossyClump' || item.kind === 'trinket.parchmentScrap' || item.kind === 'trinket.wondrousResin';
  return dearer ? 10 + 5 * item.level : 6 + 2 * item.level;
}

/** Trinkets as found: known through and through (Trinket: levelKnown, unique). */
export const createTrinket = (kind: ItemKind): Item => createItem(kind);

/* Each trinket's numbers (their static methods), by level (-1: none) */

export const RAT_SKULL = { exoticChanceMultiplier: (level: number): number => (level === -1 ? 1 : 2 + level) };
export const PARCHMENT_SCRAP = {
  enchantChanceMultiplier: (level: number): number => [2, 4, 7, 10][level] ?? 1,
  curseChanceMultiplier: (level: number): number => [1.5, 2, 1, 0][level] ?? 1,
};
export const PETRIFIED_SEED = {
  grassLootMultiplier: (level: number): number => (level <= 0 ? 1 : Math.fround(1 + Math.fround(Math.fround(0.25 * level) / 3))),
  stoneInsteadOfSeedChance: (level: number): number => [0.25, 0.46, 0.65, 0.8][level] ?? 0,
};
export const EXOTIC_CRYSTALS = { consumableExoticChance: (level: number): number => (level === -1 ? 0 : Math.fround(0.2 + Math.fround(0.2 * level))) };
export const MOSSY_CLUMP = { overrideNormalLevelChance: (level: number): number => (level === -1 ? 0 : 0.25 + 0.25 * level) };
export const SUNDIAL = {
  enemySpawnMultiplierDaytime: (level: number): number => (level === -1 ? 1 : Math.fround(0.95 - Math.fround(0.05 * level))),
  enemySpawnMultiplierNighttime: (level: number): number => (level === -1 ? 1 : Math.fround(1.25 + Math.fround(0.25 * level))),
};
export const CLOVER = {
  alterHeroDamageChance: (level: number): number => (level <= -1 ? 0 : Math.fround(0.25 + Math.fround(0.25 * level))),
  /** ThirteenLeafClover.alterDamageRoll: the most it could be six times in ten, the least otherwise. */
  alterDamageRoll: (rng: Rng, min: number, max: number): number => (rng.float() < 0.6 ? max : min),
};
export const TRAP_MECHANISM = {
  overrideNormalLevelChance: (level: number): number => (level === -1 ? 0 : 0.25 + 0.25 * level),
  revealHiddenTrapChance: (level: number): number => (level === -1 ? 0 : Math.fround(0.1 + Math.fround(0.1 * level))),
};
export const MIMIC_TOOTH = {
  mimicChanceMultiplier: (level: number): number => (level === -1 ? 1 : 1.5 + 0.5 * level),
  ebonyMimicChance: (level: number): number => (level >= 0 ? 0.125 + 0.125 * level : 0),
};
export const WONDROUS_RESIN = {
  positiveCurseEffectChance: (level: number): number => (level >= 0 ? 0.25 + 0.25 * level : 0),
  extraCurseEffectChance: (level: number): number => (level >= 0 ? 0.125 + 0.125 * level : 0),
};
export const EYE_OF_NEWT = {
  visionRangeMultiplier: (level: number): number => (level < 0 ? 1 : Math.fround(0.875 - Math.fround(0.125 * level))),
  mindVisionRange: (level: number): number => (level < 0 ? 0 : 2 + level),
};
export const SALT_CUBE = {
  hungerGainMultiplier: (level: number): number => (level === -1 ? 1 : Math.fround(1 / Math.fround(1 + Math.fround(0.25 * (level + 1))))),
  healthRegenMultiplier: (level: number): number => [0.84, 0.73, 0.66, 0.6][level] ?? 1,
};
export const VIAL_OF_BLOOD = {
  totalHealMultiplier: (level: number): number => (level === -1 ? 1 : Math.fround(1 + Math.fround(0.125 * (level + 1)))),
  maxHealPerTurn: (ht: number, level: number): number => {
    if (level === -1) return ht;
    return [4 + Math.round(0.15 * ht), 3 + Math.round(0.1 * ht), 2 + Math.round(0.07 * ht), 1 + Math.round(0.05 * ht)][level] ?? 4 + Math.round(0.15 * ht);
  },
};
export const SHARD_OF_OBLIVION = {
  /** ShardOfOblivion.passiveIDDisabled: with the shard, nothing is known by use alone (a seam for the gear stream). */
  passiveIDDisabled: (level: number): boolean => level >= 0,
  /** ShardOfOblivion.lootChanceMultiplier: a fifth more for each unknown thing worn, up to level + 1 of them. */
  lootChanceMultiplier: (level: number, unknownWorn: number): number => (level < 0 ? 1 : 1 + 0.2 * Math.min(unknownWorn, level + 1)),
};
export const CHAOTIC_CENSER = { averageTurnsUntilGas: (level: number): number => (level <= -1 ? -1 : Math.trunc(300 / (level + 1))) };
export const FERRET_TUFT = { evasionMultiplier: (level: number): number => (level <= -1 ? 1 : Math.fround(1 + Math.fround(0.125 * (level + 1)))) };
export const SPYGLASS = { extraLootChance: (level: number): number => (level <= -1 ? 0 : Math.fround(0.375 * (level + 1))) };

/** What the hero's trinkets do to a new level's finds (createItems). */
export function levelTrinkets(world: World): LevelTrinkets {
  const hero = world.heroes[0];
  if (!hero) return {};
  return {
    exotic: EXOTIC_CRYSTALS.consumableExoticChance(trinketLevel(hero, 'trinket.exoticCrystals')),
    enchant: PARCHMENT_SCRAP.enchantChanceMultiplier(trinketLevel(hero, 'trinket.parchmentScrap')),
    curse: PARCHMENT_SCRAP.curseChanceMultiplier(trinketLevel(hero, 'trinket.parchmentScrap')),
    spyglass: SPYGLASS.extraLootChance(trinketLevel(hero, 'trinket.spyglass')),
    mimics: MIMIC_TOOTH.mimicChanceMultiplier(trinketLevel(hero, 'trinket.mimicTooth')),
  };
}

/**
 * DimensionalSundial.spawnMultiplierAtCurrentTime: fewer monsters by day, more by night. The original reads the
 * device's clock, which a run checked by replaying it cannot: the hour comes with the world (World.night, set by
 * whoever starts the run; a seam for the server), day when it does not say.
 */
export function sundialMultiplier(world: World): number {
  const level = trinketLevel(world.heroes[0], 'trinket.sundial');
  if (level === -1) return 1;
  return world.night ? SUNDIAL.enemySpawnMultiplierNighttime(level) : SUNDIAL.enemySpawnMultiplierDaytime(level);
}

/**
 * Seams for the other streams' level feelings: the mossy clump makes some levels grassy or watery, the trap mechanism
 * some trapped or chasmed (MossyClump.getNextFeeling, TrapMechanism.getNextFeeling). Without the levels stream's
 * feelings, these report the chance only.
 */
export const feelingOverrideChance = (hero: Hero | undefined): { clump: number; mechanism: number } => ({
  clump: MOSSY_CLUMP.overrideNormalLevelChance(trinketLevel(hero, 'trinket.mossyClump')),
  mechanism: TRAP_MECHANISM.overrideNormalLevelChance(trinketLevel(hero, 'trinket.trapMechanism')),
});

/* The chaotic censer (ChaoticCenser.CenserGasTracker) */

const GAS_CAT_CHANCES: readonly (readonly number[])[] = [[80, 10, 10], [67, 13, 20], [54, 16, 30], [40, 20, 40]];
const GASSES: readonly (readonly (readonly [GasKind, number])[])[] = [
  [['toxic', 300], ['confusion', 300], ['stench', 200]],
  [['storm', 300], ['smoke', 300], ['regrowth', 200]],
  [['inferno', 300], ['blizzard', 300], ['corrosive', 200]],
];

/**
 * CenserGasTracker.act, a turn at a time: every so often (300 turns over the level + 1, give or take), when the
 * hero is fighting, the censer spews a random gas near the foe — never too close to the hero.
 */
export function censerTurn(ctx: Ctx, hero: Hero): void {
  const level = trinketLevel(hero, 'trinket.chaoticCenser');
  const b = buffsOf(hero);
  const avg = CHAOTIC_CENSER.averageTurnsUntilGas(level);
  if (avg === -1) {
    delete b.censer;
    return;
  }
  const censer = (b.censer ??= { left: Number.MAX_SAFE_INTEGER });
  if (censer.left > avg * 1.2) censer.left = ctx.rng.intRange(Math.trunc(avg * 0.833), Math.trunc(avg * 1.2));
  if (censer.left <= 0) {
    // The foe the hero fights (TargetHealthIndicator): the nearest monster in sight that is after someone.
    const fov = heroView(ctx.world, hero);
    let target: { pos: number } | undefined;
    for (const mob of ctx.floor.mobs) {
      if (!isAlive(mob) || mob.ally || mob.state !== 'hunting' || !fov[mob.pos]) continue;
      if (!target || distance(hero.pos, mob.pos) < distance(hero.pos, target.pos)) target = mob;
    }
    if (target && produceGas(ctx, hero, target.pos, level)) censer.left += ctx.rng.intRange(Math.trunc(avg * 0.9), Math.trunc(avg * 1.1));
  }
  censer.left = Math.max(censer.left - 1, -avg / 3);
}

function produceGas(ctx: Ctx, hero: Hero, targetPos: number, level: number): boolean {
  if (level < 0 || level > 3) return false;
  const { rng } = ctx;
  const category = rng.chances(GAS_CAT_CHANCES[level]!);
  const [gas, amount] = rng.oneOf(GASSES[category]!);
  const fov = heroView(ctx.world, hero);
  const steps = stepsFrom(ctx, hero.pos, 6);
  const candidates = [...steps].filter(([cell, d]) => fov[cell] && d >= 2 && d <= 6).map(([cell]) => cell);
  // Aimed a little nearer the hero when the foe is far.
  let aim = targetPos;
  if (distance(targetPos, hero.pos) >= 4) {
    for (const n of NEIGHBOURS8) {
      if (!steps.has(targetPos + n)) continue;
      if (distance(targetPos + n, hero.pos) < distance(aim, hero.pos)) aim = targetPos + n;
    }
  }
  if (candidates.length === 0) return false;
  const closest = Math.min(...candidates.map((cell) => distance(cell, aim)));
  const weights = candidates.map((cell) => {
    const d = distance(cell, aim) - closest;
    return d === 0 ? 8 : d <= 1 ? 1 : 0;
  });
  const cell = candidates[rng.chances(weights)]!;
  // GasSpewer.act: the gas lands (here at once, rather than when the hero's turn ends).
  if (gas === 'corrosive') seedCorrosive(ctx, cell, amount, 2 + Math.trunc(ctx.depth / 5));
  else seedGas(ctx, cell, gas, amount);
  ctx.effects.push({ type: 'censer', hero: hero.id, depth: ctx.depth, from: hero.pos, to: cell, gas });
  return true;
}

/** PathFinder.buildDistanceMap over what is not solid, as steps from a cell. */
function stepsFrom(ctx: Ctx, pos: number, radius: number): Map<number, number> {
  const reach = reachable(ctx, pos, radius);
  const dist = new Map<number, number>([[pos, 0]]);
  const queue = [pos];
  for (let head = 0; head < queue.length; head++) {
    const cell = queue[head]!;
    for (const n of NEIGHBOURS8) {
      const next = cell + n;
      if (!reach.has(next) || dist.has(next) || Math.abs((next % WIDTH) - (cell % WIDTH)) > 1) continue;
      dist.set(next, dist.get(cell)! + 1);
      queue.push(next);
    }
  }
  return dist;
}

/** Whether an item is a trinket (the catalyst aside). */
export const isTrinket = (item: Item): boolean => itemDef(item.kind).category === 'trinket';
