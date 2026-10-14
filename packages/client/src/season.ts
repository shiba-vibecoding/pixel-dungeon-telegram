/*
 * The world started afresh with the Shattered update (server: boards.ts SEASON). On the first launch after it, what the
 * old version kept on this device is cleared: the runs under way (the dungeon's, the arena's, the days' dailies), the
 * badges, the rankings, the arena's best wave, the bones, the windows and quick slots of a run, the magic seen. Who the
 * player is and how they set the game up (name, class, look, language, sound, the tutorial seen, the news seen) stays.
 *
 * This runs the moment the module is loaded, and main.ts imports it first: badges.ts and rankings.ts read the device
 * as they load, and must find it already cleared. The cloud's copy of the badges and rankings is cleared too
 * (cloud.ts asks `cloudSeasonStale`), or the next launch would join them back in.
 */

/** The season of this version; the same number as the server's. */
export const SEASON = 2;
/** Where the device (and the Telegram cloud) remembers the season it is of. */
export const SEASON_KEY = 'pd-season';

/** What a season's start clears: the keys, and the prefixes (the dailies of days). */
const KEYS = ['pd-solo', 'pd-arena', 'pd-badges', 'pd-rankings', 'pd-arena-best', 'pd-bones', 'pd-window', 'pd-quickslots', 'pd-seen-magic'];
const PREFIXES = ['pd-daily-'];

/** The slice of the Web Storage API this needs (a test brings its own). */
export interface Keep {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  key(index: number): string | null;
  readonly length: number;
}

/** Whether a season written down is older than this one (nothing written: season 1). */
export const seasonStale = (written: string | null | undefined): boolean => (Number(written) || 1) < SEASON;

/**
 * Starts the season on a device that is of an earlier one: clears what the old world kept and notes the new season.
 * Returns whether anything was cleared (a new install has nothing to clear). Never throws: storage may be missing.
 */
export function startSeason(storage: Keep): boolean {
  try {
    if (!seasonStale(storage.getItem(SEASON_KEY))) return false;
    const doomed: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key && (KEYS.includes(key) || PREFIXES.some((prefix) => key.startsWith(prefix)))) doomed.push(key);
    }
    for (const key of doomed) storage.removeItem(key);
    storage.setItem(SEASON_KEY, String(SEASON));
    return doomed.length > 0;
  } catch {
    // Storage blocked: nothing was kept either.
    return false;
  }
}

/** The device was cleared at this launch (the news window may say so). */
export const seasonStarted: boolean = (() => {
  try {
    return typeof localStorage === 'undefined' ? false : startSeason(localStorage);
  } catch {
    // Merely looking at the storage was refused.
    return false;
  }
})();
