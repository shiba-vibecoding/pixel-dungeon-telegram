import { describe, expect, it } from 'vitest';
import { practiceSeed } from '@pd/core';
import { secretDailySeed } from '../src/daily-seed';

describe('the daily seed', () => {
  it('is the same all day for one secret, and differs by day and by secret', async () => {
    const a = await secretDailySeed('s3cret', '2026-10-14');
    expect(await secretDailySeed('s3cret', '2026-10-14')).toBe(a);
    expect(await secretDailySeed('s3cret', '2026-10-15')).not.toBe(a);
    expect(await secretDailySeed('other', '2026-10-14')).not.toBe(a);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(2 ** 31);
  });

  it('cannot be had from the date alone: not the practice seed, with a secret or the development one', async () => {
    const day = '2026-10-14';
    expect(await secretDailySeed('s3cret', day)).not.toBe(practiceSeed(day));
    expect(await secretDailySeed(undefined, day)).toBe(await secretDailySeed('', day));
    expect(await secretDailySeed(undefined, day)).not.toBe(practiceSeed(day));
  });
});
