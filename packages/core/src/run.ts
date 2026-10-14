import type { LimitedDrop } from './level/gen/dungeon';
import { Random } from './level/gen/random';
import { initSecretsForRun } from './level/gen/rooms/secret/secret';
import { initSpecialsForRun } from './level/gen/rooms/special/special';
import { type Deck, type DeckCategory, type ItemKind, type Labels, rollLabels } from './items';
import { RoomType, SPECIALS } from './level/room';
import { deriveSeed, Rng, Stream } from './rng';

/** Run-wide state that level generation reads and updates, depth by depth. */
export interface RunState {
  seed: number;
  /** SpecialRoom.runSpecials: the run's deck of special room kinds (Shattered's class names); used kinds go to the back. */
  specialRooms?: string[];
  /** SpecialRoom.pitNeededDepth: the depth below a weak floor, which needs its pit room (-1: none). */
  pitNeededDepth?: number;
  /** SecretRoom.runSecrets and regionSecretsThisRun: the deck of secret room kinds, and each region's secrets left. */
  secretRooms?: string[];
  regionSecrets?: number[];
  /** Dungeon.LimitedDrops: how many of each limited item (and laboratory) have spawned. */
  limited?: Partial<Record<LimitedDrop, number>>;
  /** Guaranteed potions of strength and scrolls of upgrade placed so far (LimitedDrops' counts, kept for the party's sake). */
  strengthFound: number;
  upgradesFound: number;
  /** This run's potion colours, scroll runes and ring gems. */
  labels: Labels;
  /** Pixel Dungeon's special room deck and weak-floor flag, unused since Shattered's rooms (kept for older saves' shape). */
  specials?: number[];
  weakFloorCreated?: boolean;
  blacksmithSpawned?: boolean;
  /** Shattered's decks of potions, scrolls, runestones and trinkets, as dealt so far (items.ts drawFromDeck). */
  kindDecks?: Partial<Record<DeckCategory, Deck>>;
  /** Dungeon.LimitedDrops: the stone of intuition, the trinket catalyst and the stone of enchantment have been laid out. */
  drops?: { intStone?: boolean; catalyst?: boolean; enchStone?: boolean; cookingHp?: number };
  /**
   * Generator's decks for weapons and thrown weapons by tier (Generator.Category.probs, as gear.ts deals them),
   * and how many each has dealt (Category.dropped); absent until the first is dealt.
   */
  decks?: Record<string, number[]>;
  deckDrops?: Record<string, number>;
  /** Generator's artifact deck: the kinds not dealt yet (absent until the first is; see artifacts/artifact.ts). */
  artifactsLeft?: ItemKind[];
  /** Generator.Category.WAND's deck: how many of each wand kind (in WAND_KINDS order) are left, and how many were dealt. */
  wandDeck?: number[];
  wandsDealt?: number;
}

export function createRun(seed: number): RunState {
  const run: RunState = { seed, strengthFound: 0, upgradesFound: 0, labels: rollLabels(seed) };
  // SpecialRoom.initForRun and SecretRoom.initForRun (Dungeon.init), from the run's own stream.
  Random.using(Rng.seeded(deriveSeed(seed, Stream.RUN)), () => {
    initSpecialsForRun(run);
    initSecretsForRun(run);
  });
  return run;
}
