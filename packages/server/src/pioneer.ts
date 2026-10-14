import type { Letter, MailProfile } from './mail';
import { PIONEER_ID, pioneerLetter } from './mail';

/*
 * «Первопроходец»: everyone who went down the dungeon before the Shattered update gets one letter with a
 * commemorative cup. Who counts as having played before:
 *   - a run (saved, or finished in the history) made under rules older than PIONEER_BEFORE_RULES: runs carry
 *     the rules they were begun under (Run.rules, RunSummary.rules); one with no word of it is older still;
 *   - a profile made before the release moment: a profile kept since before profiles carried their birth
 *     (`born` unset), or born before RELEASE_AT (wrangler.jsonc), if that is set.
 * The letter is made once (Profile.pioneer remembers it, however the letter is later claimed or kept), so
 * asking again, or from another device, brings nothing new. A player who comes after the release is born
 * after it and has runs of the new rules only: nothing.
 *
 * The Shattered update wiped the world (season.ts): a profile of the old season is started afresh when the
 * player's object loads, and the wipe itself sends the letter to whoever had played anything (and marks everyone
 * else as settled, `pioneer` set, so that a profile's age alone never makes a pioneer). What is left here is the
 * rest: a profile made after the deploy but before RELEASE_AT, and the old-rules runs a wiped profile no longer has.
 *
 * Pure logic over the profile; player.ts asks when the profile is read.
 */

/** The rules a run must have been begun under to be a new player's: the first of Shattered's. */
export const PIONEER_BEFORE_RULES = 18;

/**
 * The release moment from wrangler.jsonc's RELEASE_AT var (an ISO date or date-time, UTC: "2026-10-27T09:00:00Z"; a
 * date alone is its midnight UTC). Unset or empty: null, which is fine. A value that is not a date is null too, and
 * is said so in the log, so that a typo costs nothing worse than the early-joiners' cup.
 */
export function parseReleaseAt(value: string | undefined): number | null {
  const text = (value ?? '').trim();
  if (!text) return null;
  const at = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T00:00:00Z` : /(Z|[+-]\d{2}:?\d{2})$/i.test(text) ? text : `${text}Z`);
  if (!Number.isFinite(at)) {
    console.error(`RELEASE_AT is not a date: ${text.slice(0, 40)}`);
    return null;
  }
  return at;
}

/** What the grant looks at. */
export interface PioneerProfile extends MailProfile {
  /** When the profile was made (ms); absent in a profile kept from before it was noted. */
  born?: number;
  /** When the pioneer letter was made. */
  pioneer?: number;
  history: ReadonlyArray<{ rules?: number }>;
}

/** Whether this profile belongs to someone who played before the update. */
export function playedBefore(profile: PioneerProfile, runs: ReadonlyArray<{ rules?: number }>, releaseAt: number | null): boolean {
  const old = (item: { rules?: number }): boolean => (item.rules ?? 0) < PIONEER_BEFORE_RULES;
  if (profile.history.some(old) || runs.some(old)) return true;
  if (profile.born === undefined) return true;
  return releaseAt !== null && profile.born < releaseAt;
}

/** Makes the pioneer letter once for whoever played before; the letter if one was made now. */
export function grantPioneer(
  profile: PioneerProfile, runs: ReadonlyArray<{ rules?: number }>, now: number, releaseAt: number | null,
): Letter | null {
  if (profile.pioneer !== undefined) return null;
  // A letter or the cup already there (made by another way): remembered, nothing added.
  if (profile.mail.some((letter) => letter.id === PIONEER_ID) || profile.trophies.some((trophy) => trophy.board === PIONEER_ID)) {
    profile.pioneer = now;
    return null;
  }
  if (!playedBefore(profile, runs, releaseAt)) return null;
  profile.pioneer = now;
  const letter = pioneerLetter(now);
  profile.mail = [letter, ...profile.mail];
  return letter;
}
