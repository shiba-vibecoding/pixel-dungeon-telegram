/*
 * The daily dungeon's seed is a secret of the server's: HMAC-SHA256(DAILY_SECRET, date), cut to 31 bits. A seed anyone
 * could compute from the date was how a community scouted its daily tournament before playing the counted run. Now the
 * seed leaves the server only inside the run it starts for a player, and tomorrow's cannot be had at all.
 */

/** Used where no secret is set (wrangler dev, tests). It is public: production sets DAILY_SECRET. */
export const DEV_DAILY_SECRET = 'pd-dev-daily-secret';

let warned = false;

/** The day's (YYYY-MM-DD, UTC) seed, 0 .. 2^31 - 1. */
export async function secretDailySeed(secret: string | undefined, date: string): Promise<number> {
  if (!secret && !warned) {
    warned = true;
    console.error('DAILY_SECRET is not set: the daily seed is derived from a public development secret');
  }
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret || DEV_DAILY_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new DataView(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`daily:${date}`)));
  return mac.getUint32(0) & 0x7fffffff;
}
