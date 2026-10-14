/*
 * «Что нового»: the last version of the game's news a player has seen is kept with their profile, as the end of
 * the step tutorial is (Profile.newsSeen), so that a new device or a cleared cache does not show the window again.
 * Versions are dotted numbers (`2.4`); only a newer one replaces the kept.
 */

const VERSION = /^\d{1,3}(\.\d{1,3}){0,2}$/;

/** A version as a client sends it, or null. */
export const parseVersion = (value: unknown): string | null => (typeof value === 'string' && VERSION.test(value) ? value : null);

/** Negative when a is older than b, positive when newer. */
export function compareVersions(a: string, b: string): number {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** The profile's news version after the player saw `seen`: the newer of the two. */
export const newsSeenAfter = (kept: string | undefined, seen: string): string => (kept === undefined || compareVersions(seen, kept) > 0 ? seen : kept);
