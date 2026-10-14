import { T } from '../../../terrain';
import { Dungeon } from '../../dungeon';
import type { GenLevel } from '../../genlevel';
import { type SeamPlant, seamPlant } from '../../seams';

/* What several secret rooms share. */

/**
 * Level.plant of a seed Pixel Dungeon has no plant for (see seamPlant): nothing under the no
 * herbalism challenge; else the cell turns to grass as under any plant, and the stand-in, if there
 * is one, grows there. The cell goes into `planted`, standing for Level.plants in the rooms' checks.
 */
export function plantSeam(level: GenLevel, name: SeamPlant, pos: number, planted: Set<number>): void {
  if (Dungeon.noHerbalism()) return;
  const t = level.map[pos];
  if (t === T.HIGH_GRASS || t === T.FURROWED_GRASS || t === T.EMPTY || t === T.EMBERS || t === T.EMPTY_DECO) level.set(pos, T.GRASS);
  const kind = seamPlant(name);
  if (kind) level.plant(kind, pos);
  planted.add(pos);
}

/** ExoticCrystals.consumableExoticChance: 0 without the trinket (SEAM(alchemy)). */
export const CONSUMABLE_EXOTIC_CHANCE = 0;
