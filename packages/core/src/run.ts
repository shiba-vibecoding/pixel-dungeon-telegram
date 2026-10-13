import { type Labels, rollLabels } from './items';
import type { LimitedDrop } from './level/gen/dungeon';
import { Random } from './level/gen/random';
import { initSecretsForRun } from './level/gen/rooms/secret/secret';
import { initSpecialsForRun } from './level/gen/rooms/special/special';
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
  /** This run's potion colours and scroll runes. */
  labels: Labels;
  /** Pixel Dungeon's special room deck and weak-floor flag, unused since Shattered's rooms (kept for older saves' shape). */
  specials?: number[];
  weakFloorCreated?: boolean;
  blacksmithSpawned?: boolean;
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
