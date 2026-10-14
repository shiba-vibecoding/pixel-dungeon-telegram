import type { Enchantment, Glyph, Item } from './items';

/*
 * The troll blacksmith's quest and his mine, as data (blacksmith.ts, minemobs.ts): the quest's state
 * (Blacksmith.Quest), and what the mine's monsters keep beyond an ordinary monster's.
 */

/** Blacksmith.Quest.type: 1 the crystals, 2 the gnolls, 3 the fungi (not rolled in Shattered: only partly made). */
export type BlacksmithType = 1 | 2 | 3;

export interface BlacksmithQuest {
  /** The smithy's depth (12, 13 or 14); the mine is that depth's side level. */
  depth: number;
  type: BlacksmithType;
  /** He has told the hero of the mine and lent his pickaxe. */
  given: boolean;
  /** The hero has gone down to the mine (CavesLevel.activateTransition: once only). */
  started: boolean;
  /** The mine's boss is beaten: the crystal spire, the gnoll geomancer, the fungal core. */
  bossBeaten: boolean;
  /** The hero has come back up with the dark gold: no way down again. */
  completed: boolean;
  /** What the hero earned (50 a piece of ore, 2000 at most, and 1000 for the boss), spent on his services. */
  favor: number;
  /** His pickaxe while he holds it: before he lends it, and once it is returned. */
  pickaxe: Item | null;
  /** 2500 favour or more: he gives the pickaxe back for nothing. */
  freePickaxe: boolean;
  /** How many of each service the hero has had (each costs more than the last). */
  reforges: number;
  hardens: number;
  upgrades: number;
  smiths: number;
  /** The four items he can smith (two weapons, thrown weapons, an armour), rolled ahead; null once one is taken. */
  smithRewards: Item[] | null;
  /** The enchantment and glyph the chosen one gets, kept apart so they are not shown before. */
  smithEnchant?: Enchantment;
  smithGlyph?: Glyph;
}

/** What the mine's monsters keep (crystal wisps, guardians and the spire; gnoll guards, sappers and the geomancer; the fungi). */
export interface MineMobState {
  /** The crystal monsters' colour: 0 blue, 1 green, 2 red. */
  variant?: number;
  /** CrystalGuardian: knocked down, mending itself (it cannot die). */
  recovering?: boolean;
  /** CrystalSpire and GnollGeomancer: the pickaxe blows taken. */
  hits?: number;
  /** The ability cooldown (the spire's, the sapper's, the geomancer's). */
  cooldown?: number;
  /** CrystalSpire.targetedCells: the cells its next spikes burst from, in waves. */
  targeted?: number[][];
  /** GnollSapper: where it keeps to; its partner (a gnoll guard, or the geomancer); at generation, the cell of its guard. */
  spawnPos?: number;
  partner?: string;
  partnerAt?: number;
  /** GnollGuard and GnollGeomancer: the sapper whose presence armours them. */
  sapper?: string;
  /** GnollSapper and GnollGeomancer: whether their last ability was a rockfall (never twice running). */
  lastRockfall?: boolean;
  /** Boulders on their way: where from, and the cell aimed at. */
  rockFrom?: number[];
  rockTo?: number;
  /** GnollGeomancer.RockArmor: the shield of rock left. */
  armor?: number;
  /** GnollGeomancer: the sappers' places it may still dash to (-1 once used); set on its first turn. */
  sapperSpawns?: number[];
  /** GnollGeomancer: in its last third of health, where it can die. */
  finalBracket?: boolean;
  /** GnollRockFall (DelayedRockFall): rocks about to fall, when, and on which cells. */
  rockfalls?: Array<{ at: number; cells: number[] }>;
  /** Haste: turns of moving twice as fast (the spire's call to far guardians). */
  hasted?: number;
}
