import type { MobKind } from '@pd/core';

/*
 * The bestiary's roster in the order of the design's portrait sheet (design v22: assets/mobs/bestiary.png and
 * bestiary.json, 24×24 cells, 11 to a row, 7 rows, 69 cells): thirty by region, the bosses, those found everywhere, the rare ones,
 * and the quest's three (the fetid rat, the gnoll trickster, the great crab).
 * `kind` is the core's monster; the design draws two that the core does not have (the trap guardian and the
 * sentry), which stay out of the list but keep their places on the sheet.
 */

export type BestGroup = 'region0' | 'region1' | 'region2' | 'region3' | 'region4' | 'boss' | 'any' | 'rare' | 'quest';

export interface BestEntry {
  /** The design's key (bestiary.json). */
  key: string;
  /** Its cell on the sheet, counting along the rows (the quest's too since design v22; null would be drawn from the monster's own sprite). */
  n: number | null;
  kind: MobKind | null;
  group: BestGroup;
}

const SHEET: ReadonlyArray<readonly [string, MobKind | null, BestGroup]> = [
  ['rat', 'rat', 'region0'], ['snake', 'snake', 'region0'], ['gnoll', 'gnoll', 'region0'], ['swarm', 'swarm', 'region0'],
  ['crab', 'crab', 'region0'], ['slime', 'slime', 'region0'],
  ['skeleton', 'skeleton', 'region1'], ['thief', 'thief', 'region1'], ['dm100', 'dm100', 'region1'], ['guard', 'guard', 'region1'],
  ['necro', 'necromancer', 'region1'],
  ['bat', 'bat', 'region2'], ['brute', 'brute', 'region2'], ['shamanR', 'shaman', 'region2'], ['shamanB', 'blueShaman', 'region2'],
  ['shamanP', 'purpleShaman', 'region2'], ['spinner', 'spinner', 'region2'], ['dm200', 'dm200', 'region2'],
  ['ghoul', 'ghoul', 'region3'], ['elemFire', 'elemental', 'region3'], ['elemFrost', 'frostElemental', 'region3'],
  ['elemShock', 'shockElemental', 'region3'], ['warlock', 'warlock', 'region3'], ['monk', 'monk', 'region3'], ['golem', 'golem', 'region3'],
  ['ripper', 'ripper', 'region4'], ['spawner', 'spawner', 'region4'], ['succubus', 'succubus', 'region4'], ['eye', 'eye', 'region4'],
  ['scorpio', 'scorpio', 'region4'],
  ['goo', 'goo', 'boss'], ['tengu', 'tengu', 'boss'], ['pylon', 'pylon', 'boss'], ['dm300', 'dm300', 'boss'], ['dwarfking', 'king', 'boss'],
  ['larva', 'larva', 'boss'], ['fistBurn', 'burningFist', 'boss'], ['fistSoil', 'soiledFist', 'boss'], ['fistRot', 'rottingFist', 'boss'],
  ['fistRust', 'rustedFist', 'boss'], ['fistBright', 'brightFist', 'boss'], ['fistDark', 'darkFist', 'boss'], ['yog', 'yog', 'boss'],
  ['wraith', 'wraith', 'any'], ['piranha', 'piranha', 'any'], ['mimic', 'mimic', 'any'], ['mimicGold', 'goldenMimic', 'any'],
  ['mimicEbony', 'ebonyMimic', 'any'], ['statue', 'statue', 'any'], ['guardian', null, 'any'], ['sentry', null, 'any'],
  ['albino', 'albino', 'rare'], ['exile', 'gnollExile', 'rare'], ['hermit', 'hermitCrab', 'rare'], ['caustic', 'causticSlime', 'rare'],
  ['bandit', 'bandit', 'rare'], ['spectral', 'spectralNecromancer', 'rare'], ['armBrute', 'shielded', 'rare'], ['dm201', 'dm201', 'rare'],
  ['elemChaos', 'chaosElemental', 'rare'], ['senior', 'senior', 'rare'], ['acidic', 'acidic', 'rare'], ['tormented', 'tormentedSpirit', 'rare'],
  ['phantom', 'phantomPiranha', 'rare'], ['mimicCrystal', 'crystalMimic', 'rare'], ['armStatue', 'armoredStatue', 'rare'],
  // Bestiary.QUEST: the sad ghost's foes, drawn on the sheet since design v22.
  ['fetid', 'fetidRat', 'quest'], ['trickster', 'gnollTrickster', 'quest'], ['greatcrab', 'greatCrab', 'quest'],
];

/** Every monster of the list, in groups' order. */
export const BESTIARY_ENTRIES: readonly BestEntry[] = SHEET.map(([key, kind, group], n): BestEntry => ({ key, n, kind, group })).filter((entry) => entry.kind !== null);

export const BEST_GROUPS: readonly BestGroup[] = ['region0', 'region1', 'region2', 'region3', 'region4', 'boss', 'any', 'rare', 'quest'];

/** The depths of each region (the design's captions). */
export const REGION_DEPTHS: ReadonlyArray<readonly [number, number]> = [[1, 4], [6, 9], [11, 14], [16, 19], [21, 24]];

/** A portrait's cell on bestiary.png: `--mx`, `--my` of `.pd-mob`. */
export const portraitCell = (n: number): { mx: number; my: number } => ({ mx: n % 11, my: Math.floor(n / 11) });

/** The slain count as the cell shows it: 999+ does not grow. */
export const slainLabel = (slain: number): string => (slain > 999 ? '999+' : String(slain));

/** The design's sheet in the order of its json (every key, with the places the core has no monster for). */
export const SHEET_KEYS: readonly string[] = SHEET.map(([key]) => key);
export const SHEET_KINDS: ReadonlyArray<MobKind | null> = SHEET.map(([, kind]) => kind);
