import type { NO_HERBALISM as Herbalism, NO_SCROLLS as Scrolls } from '../../challenges';

/* challenges.ts's bits, here so this module stays light (it is loaded early, from the rooms' base classes). */
const NO_HERBALISM: typeof Herbalism = 8;
const NO_SCROLLS: typeof Scrolls = 64;
const isChallenged = (world: { challenges?: number }, mask: number): boolean => ((world.challenges ?? 0) & mask) !== 0;
import type { Item } from '../../items';
import type { RunState } from '../../run';
import type { World } from '../../world';
import { Random } from './random';

/*
 * What level generation reads of the dungeon as a whole (Dungeon's statics): the depth and branch
 * being made, the run's state (limited drops, special and secret room decks, quests), and the
 * world for what lies beyond the run (challenges, the hero). Set by generateLevel for the length
 * of one level, like the Random stack.
 */

/** Level.Feeling. */
export enum Feeling {
  NONE,
  CHASM,
  WATER,
  GRASS,
  DARK,
  LARGE,
  TRAPS,
  SECRETS,
}

/** Dungeon.LimitedDrops: items (and the laboratory) with limited spawns, and how many have spawned. */
export const LIMITED_DROPS = [
  'STRENGTH_POTIONS', 'UPGRADE_SCROLLS', 'ARCANE_STYLI', 'ENCH_STONE', 'INT_STONE', 'TRINKET_CATA', 'LAB_ROOM',
  'SWARM_HP', 'NECRO_HP', 'BAT_HP', 'WARLOCK_HP', 'COOKING_HP', 'BLANDFRUIT_SEED',
  'SLIME_WEP', 'SKELE_WEP', 'THEIF_MISC', 'GUARD_ARM', 'SHAMAN_WAND', 'DM200_EQUIP', 'GOLEM_EQUIP',
  'VELVET_POUCH', 'SCROLL_HOLDER', 'POTION_BANDOLIER', 'MAGICAL_HOLSTER',
  'LORE_SEWERS', 'LORE_PRISON', 'LORE_CAVES', 'LORE_CITY', 'LORE_HALLS',
] as const;
export type LimitedDrop = (typeof LIMITED_DROPS)[number];

/** A run's limited-drop counts (absent: none yet). */
export const limitedCount = (run: RunState, drop: LimitedDrop): number => run.limited?.[drop] ?? 0;
export const limitedDropped = (run: RunState, drop: LimitedDrop): boolean => limitedCount(run, drop) !== 0;
export function limitedAdd(run: RunState, drop: LimitedDrop, n = 1): void {
  (run.limited ??= {})[drop] = limitedCount(run, drop) + n;
}
/** LimitedDrops.drop(): for what can only drop once. */
export function limitedDrop(run: RunState, drop: LimitedDrop): void {
  (run.limited ??= {})[drop] = 1;
}

interface DungeonState {
  depth: number;
  branch: number;
  run: RunState | null;
  world: World | null;
  challenges: number;
}

const state: DungeonState = { depth: 0, branch: 0, run: null, world: null, challenges: 0 };

export const Dungeon = {
  /** Sets the depth being made, for the length of `fn`. */
  generating<R>(env: { depth: number; branch: number; run: RunState; world: World | null }, fn: () => R): R {
    const saved = { ...state };
    Object.assign(state, env, { challenges: env.world?.challenges ?? 0 });
    Dungeon.droppedToChasm = [];
    try {
      return fn();
    } finally {
      Object.assign(state, saved);
    }
  },

  get depth(): number {
    return state.depth;
  },
  get branch(): number {
    return state.branch;
  },
  get run(): RunState {
    if (!state.run) throw new Error('No run: level generation code ran outside generateLevel');
    return state.run;
  },
  /** The world the level is made for, when there is one (tests make levels from a bare run). */
  get world(): World | null {
    return state.world;
  },

  /**
   * How many heroes the level is made for (party.ts): a party finds its depths with more rooms, more
   * monsters and more to find, and what makes a hero stronger once for each of them. Alone, Shattered's.
   */
  get party(): number {
    return state.world ? Math.max(1, state.world.heroes.length) : 1;
  },

  /** Items that fell into a chasm while the level was made (Dungeon.dropToChasm), for the depth below. */
  droppedToChasm: [] as Item[],

  /** Dungeon.bossLevel. */
  bossLevel(depth = state.depth): boolean {
    return depth === 5 || depth === 10 || depth === 15 || depth === 20 || depth === 25;
  },

  /** Dungeon.shopOnLevel. */
  shopOnLevel(): boolean {
    return state.depth === 6 || state.depth === 11 || state.depth === 16;
  },

  isChallenged(mask: number): boolean {
    return isChallenged({ challenges: state.challenges }, mask);
  },

  noHerbalism(): boolean {
    return this.isChallenged(NO_HERBALISM);
  },

  /**
   * Challenges.isItemBlocked. Here the world's own rule applies when the level's items come to
   * lie on its floor (underChallenges: what is forbidden turns to gold), so nothing is blocked.
   */
  itemBlocked(_item: Item): boolean {
    return false;
  },

  /** Dungeon.posNeeded: two potions of strength each region, every two floors, the earlier half the time. */
  posNeeded(): boolean {
    const depth = state.depth;
    const posLeftThisSet = 2 - (limitedCount(this.run, 'STRENGTH_POTIONS') - Math.trunc(depth / 5) * 2);
    if (posLeftThisSet <= 0) return false;
    const floorThisSet = depth % 5;
    let targetPOSLeft = 2 - Math.trunc(floorThisSet / 2);
    if (floorThisSet % 2 === 1 && Random.Int(2) === 0) targetPOSLeft--;
    return targetPOSLeft < posLeftThisSet;
  },

  /** Dungeon.souNeeded: three scrolls of upgrade each region; the chance is scrolls left over floors left. */
  souNeeded(): boolean {
    const depth = state.depth;
    const souLeftThisSet = 3 - (limitedCount(this.run, 'UPGRADE_SCROLLS') - Math.trunc(depth / 5) * 3);
    if (souLeftThisSet <= 0) return false;
    const floorThisSet = depth % 5;
    return Random.Int(5 - floorThisSet) < souLeftThisSet;
  },

  /** Dungeon.asNeeded: one arcane stylus each region. */
  asNeeded(): boolean {
    const depth = state.depth;
    const asLeftThisSet = 1 - (limitedCount(this.run, 'ARCANE_STYLI') - Math.trunc(depth / 5));
    if (asLeftThisSet <= 0) return false;
    const floorThisSet = depth % 5;
    return Random.Int(5 - floorThisSet) < asLeftThisSet;
  },

  /** Dungeon.enchStoneNeeded: one stone of enchantment, in the second or third region, 1 in 8 a floor. */
  enchStoneNeeded(): boolean {
    if (limitedDropped(this.run, 'ENCH_STONE')) return false;
    const region = 1 + Math.trunc(state.depth / 5);
    if (region <= 1) return false;
    let floorsVisited = state.depth - 5;
    if (floorsVisited > 4) floorsVisited--;
    return Random.Int(9 - floorsVisited) === 0;
  },

  /** Dungeon.intStoneNeeded: one stone of intuition on floors 1-3. */
  intStoneNeeded(): boolean {
    return state.depth < 5 && !limitedDropped(this.run, 'INT_STONE') && Random.Int(4 - state.depth) === 0;
  },

  /** Dungeon.trinketCataNeeded: one trinket catalyst on floors 1-3. */
  trinketCataNeeded(): boolean {
    return state.depth < 5 && !limitedDropped(this.run, 'TRINKET_CATA') && Random.Int(4 - state.depth) === 0;
  },

  /** Dungeon.labRoomNeeded: a laboratory each region, on floor 3 or 4, half the time on 3. */
  labRoomNeeded(): boolean {
    const depth = state.depth;
    const region = 1 + Math.trunc(depth / 5);
    if (region > limitedCount(this.run, 'LAB_ROOM')) {
      const floorThisRegion = depth % 5;
      if (floorThisRegion >= 4 || (floorThisRegion === 3 && Random.Int(2) === 0)) return true;
    }
    return false;
  },

  /** Every second scroll of upgrade is held back under the forbidden runes challenge. */
  noScrolls(): boolean {
    return this.isChallenged(NO_SCROLLS);
  },
};
