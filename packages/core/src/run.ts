import { type Labels, rollLabels } from './items';
import { RoomType, SPECIALS } from './level/room';
import { deriveSeed, Rng, Stream } from './rng';

/** Run-wide state that level generation reads and updates, depth by depth. */
export interface RunState {
  seed: number;
  /** Special room kinds in this run's preference order; used kinds move to the back. */
  specials: RoomType[];
  /** The deepest generated level has a weak floor, so the next one needs a pit room. */
  weakFloorCreated: boolean;
  /** Guaranteed potions of strength and scrolls of upgrade placed so far. */
  strengthFound: number;
  upgradesFound: number;
  /** This run's potion colours and scroll runes. */
  labels: Labels;
  /** The troll blacksmith has set up his forge in the caves (absent in older runs). */
  blacksmithSpawned?: boolean;
  /** The dew vial has been laid out in the sewers (absent in older runs). */
  dewVialSpawned?: boolean;
  /**
   * Generator's decks for weapons and thrown weapons by tier (Generator.Category.probs, as gear.ts deals them),
   * and how many each has dealt (Category.dropped); absent until the first is dealt.
   */
  decks?: Record<string, number[]>;
  deckDrops?: Record<string, number>;
}

export function createRun(seed: number): RunState {
  const rng = Rng.seeded(deriveSeed(seed, Stream.RUN));
  const specials = [...SPECIALS];
  rng.shuffle(specials);
  return { seed, specials, weakFloorCreated: false, strengthFound: 0, upgradesFound: 0, labels: rollLabels(seed) };
}

/** Moves a used special room kind to the back, making repeats less likely. */
export function useSpecial(run: RunState, type: RoomType): void {
  const index = run.specials.indexOf(type);
  if (index >= 0) {
    run.specials.splice(index, 1);
    run.specials.push(type);
  }
}
