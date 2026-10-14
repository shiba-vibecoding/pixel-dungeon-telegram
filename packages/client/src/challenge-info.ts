import { CHALLENGES } from '@pd/core';
import { t } from './i18n';

/*
 * What the title and the first screen need to know about the challenges, and the device's erasing: apart from meta.ts (the windows), which is a chunk
 * of its own fetched when one is opened.
 */

/** The challenges in Shattered's order, as bits (Challenges.MASKS): the order of the sheet's list and of `t.meta.challengeList`. */
export const CHALLENGE_MASKS: readonly number[] = CHALLENGES.map((challenge) => challenge.mask);

/**
 * A challenge's picture in sheet-challenges9.png (design v23: nine icons, 16×16, in the order of the PD 1.9 list, then Shattered's
 * hostile champions and badder bosses).
 */
const ICON_OF_MASK: Readonly<Record<number, number>> = { 1: 0, 2: 1, 4: 2, 8: 3, 16: 4, 32: 5, 64: 6, 128: 7, 256: 8 };
export const challengeIcon = (mask: number): number => ICON_OF_MASK[mask] ?? 0;

/** A challenge's rules in a line (the daily's «hardship» note): the dashed lines of its text, else its first paragraph. */
export function challengeBrief(mask: number): string {
  const row = t.meta.challengeList[CHALLENGE_MASKS.indexOf(mask)];
  if (!row) return '';
  const rules = row[2].split(String.fromCharCode(10)).filter((line) => line.startsWith('- ')).map((line) => line.slice(2).replace(/\.$/, ''));
  return rules.length > 0 ? `${rules.join('; ')}.` : row[1];
}

export function countChallenges(mask: number): number {
  return CHALLENGE_MASKS.filter((bit) => mask & bit).length;
}

/** Everything this game keeps on the device; purchases live on the server. */
export function eraseDevice(): void {
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('pd-')) localStorage.removeItem(key);
    }
    sessionStorage.clear();
  } catch {
    // Nothing could be kept either.
  }
}
