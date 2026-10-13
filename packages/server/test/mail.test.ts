import { describe, expect, it } from 'vitest';
import {
  addLetter, boardEnd, boardsToCheck, claimAll, claimLetter, collectMail, type Lookup, MAIL_KEPT_MS, type MailProfile, noteEntered, pruneMail,
  readLetter,
} from '../src/mail';
import { fromEntries, toEntries } from '../src/run-store';
import { emptyProfile } from '../src/runs';

const DAY = 86_400_000;
/** Tuesday the 13th of October 2026, noon (UTC). */
const NOW = Date.UTC(2026, 9, 13, 12);

const profile = (): MailProfile => emptyProfile('Alice');
/** Boards by name: the player's place there; a missing one is a board that holds nobody (or is gone). */
const boards = (standings: Record<string, number | 'error'>, total = 214): Lookup => async (name) => {
  const place = standings[name];
  if (place === 'error') return 'error';
  return place ? { rank: place, total } : null;
};
const dayBefore = (days: number): string => new Date(NOW - days * DAY).toISOString().slice(0, 10);

describe('mail', () => {
  it('knows when a board closes', () => {
    expect(boardEnd('daily:2026-10-12')).toBe(Date.UTC(2026, 9, 13));
    // Week 42 of 2026 is October 12th to 18th.
    expect(boardEnd('week:2026-W42')).toBe(Date.UTC(2026, 9, 19));
    expect(boardEnd('week:2026-W01')).toBe(Date.UTC(2026, 0, 5));
    expect(boardEnd('all')).toBeNull();
  });

  it('turns a won place on yesterday’s daily board into a cup letter, claimed onto the shelf', async () => {
    const p = profile();
    const yesterday = `daily:${dayBefore(1)}`;
    expect(await collectMail(p, NOW, boards({ [yesterday]: 1 }))).toBe(true);
    expect(p.mail).toHaveLength(1);
    expect(p.mail[0]).toMatchObject({ id: yesterday, kind: 'cup', place: 1, total: 214, gifts: [{ type: 'trophy', board: yesterday, place: 1 }] });
    // Nothing is on the shelf until the letter is claimed.
    expect(p.trophies).toEqual([]);
    expect(claimLetter(p, yesterday, NOW)).toBe('claimed');
    expect(p.trophies).toEqual([{ board: yesterday, place: 1, at: NOW }]);
  });

  it('writes no letter for a place beyond the prize: 4th of the day, 11th of the week', async () => {
    const p = profile();
    const last = 'week:2026-W41';
    await collectMail(p, NOW, boards({ [`daily:${dayBefore(1)}`]: 4, [last]: 11 }));
    expect(p.mail).toEqual([]);
    const q = profile();
    await collectMail(q, NOW, boards({ [last]: 10 }));
    expect(q.mail[0]).toMatchObject({ kind: 'medal', place: 10 });
  });

  it('claiming twice gives one trophy', async () => {
    const p = profile();
    const board = `daily:${dayBefore(1)}`;
    await collectMail(p, NOW, boards({ [board]: 2 }));
    expect(claimLetter(p, board, NOW)).toBe('claimed');
    expect(claimLetter(p, board, NOW + 1000)).toBe('already');
    expect(claimAll(p, NOW + 2000)).toBe(0);
    expect(p.trophies).toHaveLength(1);
    expect(p.trophies[0]!.at).toBe(NOW);
    expect(claimLetter(p, 'daily:1999-01-01', NOW)).toBe('none');
    // Looked at again, the same board brings no second letter and no second trophy.
    await collectMail(p, NOW + DAY, boards({ [board]: 2 }));
    expect(p.mail).toHaveLength(1);
    expect(p.trophies).toHaveLength(1);
  });

  it('a player away five days finds every letter, from the boards their runs went onto', async () => {
    const p = profile();
    const entered = [6, 5, 4, 3, 2].map((days) => `daily:${dayBefore(days)}`);
    for (const board of entered) noteEntered(p, board);
    noteEntered(p, 'week:2026-W41');
    noteEntered(p, `daily:${dayBefore(0)}`);
    // The open board (today's) is not asked yet.
    expect(boardsToCheck(p, NOW)).not.toContain(`daily:${dayBefore(0)}`);
    const standings: Record<string, number> = { 'week:2026-W41': 7 };
    entered.forEach((board, i) => (standings[board] = (i % 3) + 1));
    await collectMail(p, NOW, boards(standings));
    expect(p.mail.map((letter) => letter.id).sort()).toEqual([...entered, 'week:2026-W41'].sort());
    expect(claimAll(p, NOW)).toBe(6);
    expect(p.trophies).toHaveLength(6);
    // Newest first.
    expect(p.mail.map((letter) => letter.at)).toEqual([...p.mail.map((letter) => letter.at)].sort((a, b) => b - a));
  });

  it('a board that is gone gives no letter and no error; one that cannot be asked is asked again', async () => {
    const p = profile();
    const board = `daily:${dayBefore(3)}`;
    noteEntered(p, board);
    // Failing now: nothing is lost, and it is not marked looked at.
    await collectMail(p, NOW, boards({ [board]: 'error' }));
    expect(p.claimed).not.toContain(board);
    expect(boardsToCheck(p, NOW)).toContain(board);
    expect(p.mail).toEqual([]);
    // Gone (its object holds nobody): looked at, no letter.
    await collectMail(p, NOW, boards({}));
    expect(p.mail).toEqual([]);
    expect(p.claimed).toContain(board);
  });

  it('keeps letters thirty days from the board’s close, and gives none for a board older than that', async () => {
    const p = profile();
    const board = `daily:${dayBefore(1)}`;
    await collectMail(p, NOW, boards({ [board]: 1 }));
    const end = boardEnd(board)!;
    expect(pruneMail(p, end + MAIL_KEPT_MS - 1)).toBe(false);
    expect(p.mail).toHaveLength(1);
    expect(pruneMail(p, end + MAIL_KEPT_MS)).toBe(true);
    expect(p.mail).toEqual([]);

    const old = profile();
    const expired = `daily:${dayBefore(40)}`;
    noteEntered(old, expired);
    // Never asked about: no letter, and no error.
    expect(boardsToCheck(old, NOW)).not.toContain(expired);
    expect(await collectMail(old, NOW, boards({ [expired]: 1 }))).toBe(true);
    expect(old.mail).toEqual([]);
    expect(old.entered).toEqual([]);
  });

  it('a claimed letter that has expired leaves the trophy on the shelf, and the board makes no letter again', async () => {
    const p = profile();
    const board = `daily:${dayBefore(1)}`;
    await collectMail(p, NOW, boards({ [board]: 3 }));
    claimLetter(p, board, NOW);
    const later = NOW + 40 * DAY;
    await collectMail(p, later, boards({ [board]: 3 }));
    expect(p.mail).toEqual([]);
    expect(p.trophies).toHaveLength(1);
  });

  it('does not write a letter for a place the shelf holds already (a trophy from before the mail)', () => {
    const p = profile();
    const board = `daily:${dayBefore(1)}`;
    p.trophies.push({ board, place: 1, at: NOW });
    expect(addLetter(p, board, { rank: 1 })).toBeNull();
  });

  it('marks a letter read, and keeps the arena’s boards out of the mailbox', () => {
    const p = profile();
    addLetter(p, 'daily:2026-10-12', { rank: 2 });
    expect(readLetter(p, 'daily:2026-10-12')).toBe(true);
    expect(readLetter(p, 'daily:2026-10-12')).toBe(false);
    expect(addLetter(p, 'arena:2026-W41', { rank: 1 })).toBeNull();
    noteEntered(p, 'arena:2026-W41');
    noteEntered(p, 'all');
    expect(p.entered).toEqual([]);
  });

  it('keeps letters, the boards entered and the tutorial’s end with the profile; an older profile has none of them', () => {
    const p = emptyProfile('Alice');
    addLetter(p, 'daily:2026-10-12', { rank: 1, total: 5 });
    noteEntered(p, 'week:2026-W41');
    p.coachDone = true;
    const back = fromEntries(new Map(Object.entries(toEntries(p, {})))).profile;
    expect(back.mail).toEqual(p.mail);
    expect(back.entered).toEqual(['week:2026-W41']);
    expect(back.coachDone).toBe(true);
    const old = fromEntries(new Map([['profile', JSON.stringify({ name: 'Bob', games: 3 })]])).profile;
    expect(old).toMatchObject({ name: 'Bob', games: 3, mail: [], entered: [], coachDone: false });
  });
});
