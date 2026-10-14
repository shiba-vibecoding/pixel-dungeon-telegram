import { SEASON } from './boards';
import { PIONEER_ID, pioneerLetter } from './mail';
import { emptyProfile, type Profile, type Run, type RunSlot } from './runs';
import { fromEntries } from './run-store';

/*
 * The world starts afresh with the Shattered update (SEASON in boards.ts): unfinished runs, every board, records,
 * run history, streaks and freezes, badges and trophies all begin from nothing. The boards need no clearing (a
 * new season's boards are other Durable Objects); a player's own object is reset lazily, on first contact after the
 * update, when what it holds was written in an earlier season (Profile.season; absent: season 1).
 *
 * What a reset keeps: who the player is and their settings (name, the tutorial seen, the news seen, the bug
 * hunter's honour, the day's problem-report count). What it adds: the «Первопроходец» letter (pioneer.ts), if the
 * old profile had played anything: a finished run or game, a record, or a run under way.
 *
 * Pure logic; player.ts asks it when the player's object loads.
 */

/** Whether a stored profile was written in an earlier season and must be started afresh. */
export const needsWipe = (profile: Pick<Profile, 'season'>): boolean => (profile.season ?? 1) < SEASON;

/** Whether the old profile belongs to someone who played: any game, record, finished run, or a run under way. */
export function hasPlayed(old: Profile, hadRun: boolean): boolean {
  return hadRun || old.games > 0 || old.wins > 0 || old.deepest > 0 || old.best > 0 || old.arenaBest > 0 || old.arenaWaves > 0 || old.history.length > 0;
}

/** The profile of the new season made from an old one: identity and settings kept, the pioneer cup granted to a veteran. */
export function startSeason(old: Profile, hadRun: boolean, now: number): Profile {
  const fresh = emptyProfile(old.name);
  fresh.season = SEASON;
  fresh.coachDone = old.coachDone;
  if (old.born !== undefined) fresh.born = old.born;
  if (old.newsSeen !== undefined) fresh.newsSeen = old.newsSeen;
  if (old.honors !== undefined) fresh.honors = old.honors;
  if (old.problems !== undefined) fresh.problems = old.problems;
  // The pioneer cup (and its letter) survives as it stood; a veteran without one is sent it now. Whoever has not
  // played is marked as settled, so that the profile's age alone never makes them a pioneer (pioneer.ts).
  const letter = old.mail.find((candidate) => candidate.id === PIONEER_ID);
  const cup = old.trophies.find((trophy) => trophy.board === PIONEER_ID);
  if (letter) fresh.mail = [letter];
  if (cup) fresh.trophies = [cup];
  if (!letter && !cup && hasPlayed(old, hadRun)) fresh.mail = [pioneerLetter(now)];
  fresh.pioneer = old.pioneer ?? now;
  return fresh;
}

/** What a player's object holds once loaded. */
export interface Loaded {
  profile: Profile;
  runs: Partial<Record<RunSlot, Run>>;
  /** The player is new to the server: their birth is noted (pioneer.ts). */
  born: boolean;
  /** An earlier season's profile was started afresh: it is written out at once. */
  wiped: boolean;
}

/** A player from their stored entries, started afresh if the entries are of an earlier season. */
export function loadPlayer(entries: ReadonlyMap<string, string>, now: number): Loaded {
  const { profile, runs } = fromEntries(entries);
  if (!entries.has('profile')) {
    profile.born = now;
    profile.season = SEASON;
    return { profile, runs, born: true, wiped: false };
  }
  if (!needsWipe(profile)) return { profile, runs, born: false, wiped: false };
  // A run under way counts as played, whatever its format (fromEntries leaves runs of another format out).
  const hadRun = [...entries.keys()].some((key) => key.startsWith('run:'));
  return { profile: startSeason(profile, hadRun, now), runs: {}, born: false, wiped: true };
}
