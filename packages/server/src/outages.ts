/*
 * Days the server was down. A player cannot play the daily dungeon on such a day, so it must neither break
 * their streak nor spend a freeze: the streak logic (runs.ts keepStreak, streakNow) takes these days as played.
 *
 * The list comes from two places, joined: the OUTAGE_DAYS variable in wrangler.jsonc (days separated by commas
 * or spaces, set at a deploy) and the days the admin gives the bot (kept by the ReportStore object):
 *
 *   /outage 2026-10-20          one more day
 *   /outage remove 2026-10-20   a day taken off
 *   /outage                     the list
 *
 * Pure logic, so it can be tested without a Durable Object.
 */

/** The most days kept: a year's worth is far more than a service ever loses. */
export const MAX_OUTAGE_DAYS = 400;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar day as YYYY-MM-DD (not 2026-02-30). */
export function isDay(text: string): boolean {
  if (!DAY.test(text)) return false;
  const time = Date.parse(`${text}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === text;
}

/** Days sorted, without repeats, and only real ones; the newest MAX_OUTAGE_DAYS. */
export function normalizeDays(days: readonly string[]): string[] {
  return [...new Set(days.filter(isDay))].sort().slice(-MAX_OUTAGE_DAYS);
}

/** The days in a text (a variable's value): separated by commas, spaces or lines; what is not a day is left out. */
export function parseOutageDays(text: string | undefined): string[] {
  return normalizeDays((text ?? '').split(/[\s,;]+/));
}

/** What the variable and the admin's list say together. */
export const joinOutages = (...lists: ReadonlyArray<readonly string[]>): string[] => normalizeDays(lists.flat());

/** The list with a day added or taken off; the same list when the day is not a day. */
export function changeOutages(days: readonly string[], op: 'add' | 'remove', day: string): string[] {
  if (!isDay(day)) return [...days];
  return normalizeDays(op === 'add' ? [...days, day] : days.filter((d) => d !== day));
}

/** What asking for the outage days needs of the Worker's environment. */
export interface OutageEnv<Id> {
  OUTAGE_DAYS?: string;
  REPORTS: { idFromName(name: string): Id; get(id: Id): { fetch(url: string): Promise<Response> } };
}

/** The days the server was down: the variable's and the admin's (a failure to ask leaves the variable's alone). */
export async function outageDays<Id>(env: OutageEnv<Id>): Promise<string[]> {
  const fixed = parseOutageDays(env.OUTAGE_DAYS);
  try {
    const response = await env.REPORTS.get(env.REPORTS.idFromName('all')).fetch('https://reports/outages');
    return joinOutages(fixed, (await response.json()) as string[]);
  } catch {
    return fixed;
  }
}
