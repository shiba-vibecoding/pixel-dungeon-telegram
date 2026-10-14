import { CURRENT } from './releases';

/*
 * When «Что нового» is shown (design system v20, ReleaseNews): once per version, on the first launch after an
 * update. A player who has played before the update sees it; a brand-new player does not (they get the step
 * tutorial instead). The last version seen is kept on the device (`pd-seen-version`) and with the player's
 * profile on the server, as the end of the tutorial is, so that another device or a cleared cache does not
 * show it a second time.
 */

const KEY = 'pd-seen-version';

/** Negative when `a` is an older version than `b`: dotted numbers. */
export function compareVersions(a: string, b: string): number {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

export interface NewsFacts {
  /** The version seen on this device, and as the server has it (null: none, undefined: the server was not asked or could not say). */
  local: string | null;
  server?: string | null;
  /** The player has played before: a run begun, the tutorial seen, the game opened earlier. */
  veteran: boolean;
  current: string;
}

/**
 * What to do at launch: 'show' the window; 'mark' this version as seen without it (a new player; or those
 * who have seen it elsewhere); 'none' when it is known to be seen.
 */
export function newsDue(facts: NewsFacts): 'show' | 'mark' | 'none' {
  const seen = [facts.local, facts.server].filter((v): v is string => typeof v === 'string').sort(compareVersions).at(-1) ?? null;
  if (seen !== null) return compareVersions(seen, facts.current) < 0 ? 'show' : 'none';
  return facts.veteran ? 'show' : 'mark';
}

/** The version seen on this device. */
export function seenHere(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/** Remembers on this device that the news of `version` were seen. */
export function markSeenHere(version: string = CURRENT.version): void {
  try {
    localStorage.setItem(KEY, version);
  } catch {
    // Seen for this session only.
  }
}
