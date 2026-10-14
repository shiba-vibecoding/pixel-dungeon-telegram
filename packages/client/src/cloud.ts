import { SEASON_KEY, seasonStale } from './season';
import { cloudStorage } from './telegram';

/*
 * What follows the player's Telegram account rather than one device
 * (WebApp.CloudStorage): badges, which open free looks; the rankings; and the
 * settings. At start the cloud's copy is merged in — badges and rankings
 * joined with what this device has, settings taken only where this device has
 * none (a new phone gets the old one's) — and what changed here goes back up
 * when the app is put away, and after a run. The run in progress stays on
 * the device: it is too big for the cloud's 4 KB a key.
 */

/** Merged, both ways: a union of what each side has. */
const JOINED = ['pd-badges', 'pd-rankings'] as const;
/** Taken from the cloud only where this device has nothing yet. */
const SETTINGS = [
  'pd-sound', 'pd-sound-volume', 'pd-music-volume', 'pd-haptics', 'pd-fx', 'pd-shake', 'pd-lang', 'pd-hints', 'pd-hints-seen',
  'pd-intro-seen', 'pd-seen-help', 'pd-moved', 'pd-class', 'pd-name', 'pd-challenges', 'pd-look', 'pd-live-arena',
] as const;
const KEYS: readonly string[] = [...JOINED, ...SETTINGS, SEASON_KEY];
/** CloudStorage keeps up to 4096 characters a value. */
const MAX_VALUE = 4096;

type Merge = (local: string | null, cloud: string) => string | null;
const merges = new Map<string, Merge>();
/** What the cloud holds, as last read or written, so only what changed goes up. */
const known = new Map<string, string>();

function local(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** How a joined key's two copies become one (badges.ts, rankings.ts). */
export function mergeWith(key: (typeof JOINED)[number], merge: Merge): void {
  merges.set(key, merge);
}

/**
 * Reads the cloud's copies and folds them into this device's; resolves once done (or at once
 * outside Telegram, or after a few seconds if the cloud does not answer).
 */
export function pullCloud(): Promise<void> {
  const cloud = cloudStorage();
  if (!cloud) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, 3000);
    cloud.getItems([...KEYS], (error, values) => {
      clearTimeout(timer);
      if (!error && values) {
        // The cloud still holds the old world's badges and rankings (season.ts): not joined back in, and removed.
        const stale = seasonStale(values[SEASON_KEY]);
        if (stale) {
          const old = JOINED.filter((key) => values[key] !== undefined);
          if (old.length > 0) cloud.removeItems?.([...old], () => undefined);
          for (const key of old) delete values[key];
        }
        for (const key of KEYS) {
          const remote = values[key];
          if (!remote) continue;
          known.set(key, remote);
          const here = local(key);
          const merge = merges.get(key);
          const value = merge ? merge(here, remote) : here === null ? remote : null;
          if (value === null || value === here) continue;
          try {
            localStorage.setItem(key, value);
          } catch {
            // This device keeps its own.
          }
        }
      }
      resolve();
    });
  });
}

/** Sends up what changed on this device since the cloud was last read or written. */
export function pushCloud(): void {
  const cloud = cloudStorage();
  if (!cloud) return;
  for (const key of KEYS) {
    const value = local(key);
    if (value === null || value.length > MAX_VALUE || known.get(key) === value) continue;
    known.set(key, value);
    cloud.setItem(key, value, (error) => {
      if (error) known.delete(key);
    });
  }
}

// Put away, the app may never come back: what changed goes up now.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) pushCloud();
});
