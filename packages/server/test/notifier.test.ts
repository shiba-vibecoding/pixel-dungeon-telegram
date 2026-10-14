import { describe, expect, it } from 'vitest';
import { SEASON } from '../src/boards';
import { streakReminder, weeklyResult } from '../src/reminders';

const at = (iso: string): number => Date.parse(iso);

describe('the bot’s reminders', () => {
  const sub = { chat: 1, ru: true, streak: 5, last: '2026-10-12', season: SEASON };

  it('remind of a streak at risk: kept yesterday, not today, once a day, and only a streak worth keeping', () => {
    const now = at('2026-10-13T17:00:00Z');
    expect(streakReminder(sub, now)?.text).toContain('5 дней');
    expect(streakReminder({ ...sub, last: '2026-10-13' }, now)).toBeNull();
    expect(streakReminder({ ...sub, sent: '2026-10-13' }, now)).toBeNull();
    expect(streakReminder({ ...sub, streak: 1 }, now)).toBeNull();
    // Broken already: nothing to save.
    expect(streakReminder({ ...sub, last: '2026-10-10' }, now)).toBeNull();
  });

  it('tell last week’s place, with the medal for the top 10', () => {
    expect(weeklyResult(sub, '2026-W41', 3, 120).text).toContain('медаль');
    expect(weeklyResult({ ...sub, ru: false }, '2026-W41', 40, 120).text).not.toContain('medal');
  });
});
