import { describe, expect, it } from 'vitest';
import { boardObject, finishedBoards, SEASON } from '../src/boards';
import { claimAll, collectMail, type Lookup } from '../src/mail';
import { grantPioneer, parseReleaseAt } from '../src/pioneer';
import { streakReminder, type Subscriber } from '../src/reminders';
import { toEntries } from '../src/run-store';
import { emptyProfile, type Profile } from '../src/runs';
import { loadPlayer, needsWipe } from '../src/season';

const DAY = 86_400_000;
/** The first moment after the update; the old world was written a few days before. */
const NOW = Date.UTC(2026, 9, 27, 9);
const RELEASE = Date.UTC(2026, 9, 27, 9);

/** A player of the old world: season 1 (the field absent), everything a veteran has. */
function veteran(): Profile {
  const p = emptyProfile('Ann');
  p.games = 40;
  p.wins = 3;
  p.deepest = 26;
  p.best = 91_000;
  p.bestByClass = { warrior: 91_000 };
  p.arenaWaves = 12;
  p.arenaBest = 5000;
  p.streak = { last: '2026-10-26', count: 9, best: 14, freezes: 2 };
  p.dailyDate = '2026-10-26';
  p.badges = { ...p.badges, earned: ['victory'] } as Profile['badges'];
  p.history = [{ rules: 17, slot: 'dungeon', ranked: true, at: NOW - DAY, depth: 5, level: 6, gold: 100, won: false, score: 400, turns: 900, kills: 12, heroClass: 'warrior' } as never];
  p.trophies = [{ board: 'daily:2026-10-20', place: 1, at: NOW - 6 * DAY }];
  p.claimed = ['daily:2026-10-20'];
  p.entered = ['daily:2026-10-26', 'week:2026-W43'];
  p.mail = [{ id: 'daily:2026-10-26', kind: 'cup', board: 'daily:2026-10-26', place: 2, at: NOW - DAY, gifts: [{ type: 'trophy', board: 'daily:2026-10-26', place: 2 }] }];
  p.coachDone = true;
  p.newsSeen = '2.3';
  p.honors = ['bughunter'];
  p.born = NOW - 40 * DAY;
  return p;
}

const stored = (p: Profile, extra: Record<string, string> = {}): Map<string, string> => new Map([...Object.entries(toEntries(p, {})), ...Object.entries(extra)]);

describe('the world starts afresh (season 2)', () => {
  it('an old profile becomes fresh, with identity and settings kept, plus the pioneer cup', () => {
    const { profile, runs, wiped, born } = loadPlayer(stored(veteran(), { 'run:dungeon': '{"format":31}', 'run:dungeon:1': '{}' }), NOW);
    expect(wiped).toBe(true);
    expect(born).toBe(false);
    expect(runs).toEqual({});
    // Kept.
    expect(profile).toMatchObject({ name: 'Ann', coachDone: true, newsSeen: '2.3', honors: ['bughunter'], born: NOW - 40 * DAY, season: SEASON });
    // Gone: records, history, streak, freezes, badges, trophies, boards entered.
    expect(profile).toMatchObject({ games: 0, wins: 0, deepest: 0, best: 0, bestByClass: {}, arenaWaves: 0, arenaBest: 0, dailyDate: null, history: [], trophies: [], claimed: [], entered: [], bones: null });
    expect(profile.streak).toEqual({ last: null, count: 0, best: 0, freezes: 0 });
    expect(profile.badges).toEqual(emptyProfile().badges);
    // The one carry-over: a pioneer letter, whose cup is claimed from the mail; the old board letter is gone.
    expect(profile.mail).toHaveLength(1);
    expect(profile.mail[0]).toMatchObject({ id: 'pioneer', kind: 'pioneer', gifts: [{ type: 'trophy', board: 'pioneer', place: 0 }] });
    expect(profile.pioneer).toBe(NOW);
    expect(claimAll(profile, NOW)).toBe(1);
    expect(profile.trophies).toEqual([{ board: 'pioneer', place: 0, at: NOW }]);
    // Asking for the pioneer again, now or with a release moment after the birth, brings nothing more.
    expect(grantPioneer(profile, [], NOW + 1, RELEASE + DAY)).toBeNull();
  });

  it('is written out once and read the same afterwards: no second wipe, no second letter', () => {
    const first = loadPlayer(stored(veteran()), NOW);
    const again = loadPlayer(stored(first.profile), NOW + DAY);
    expect(again.wiped).toBe(false);
    expect(again.profile).toEqual(first.profile);
    expect(needsWipe(again.profile)).toBe(false);
  });

  it('a never-played profile is fresh and gets no pioneer, whatever its age', () => {
    const idle = emptyProfile('Bob');
    idle.born = NOW - 30 * DAY;
    const { profile, wiped } = loadPlayer(stored(idle), NOW);
    expect(wiped).toBe(true);
    expect(profile.mail).toEqual([]);
    expect(profile.trophies).toEqual([]);
    // Born before the release moment: still not a pioneer.
    expect(grantPioneer(profile, [], NOW, RELEASE + DAY)).toBeNull();
    // Kept from before profiles noted their birth: the same.
    const kept = loadPlayer(stored(emptyProfile('Old')), NOW).profile;
    expect(grantPioneer(kept, [], NOW, null)).toBeNull();
    expect(kept.mail).toEqual([]);
  });

  it('a run under way, though nothing was finished, is a game played', () => {
    const { profile } = loadPlayer(stored(emptyProfile('Cy'), { 'run:daily': '{"format":31}' }), NOW);
    expect(profile.mail.map((letter) => letter.id)).toEqual(['pioneer']);
  });

  it('keeps a pioneer cup and letter the old profile already had', () => {
    const p = veteran();
    p.pioneer = NOW - DAY;
    p.mail = [{ id: 'pioneer', kind: 'pioneer', board: 'pioneer', place: 0, at: NOW - DAY, gifts: [{ type: 'trophy', board: 'pioneer', place: 0 }] }, ...p.mail];
    p.trophies = [{ board: 'pioneer', place: 0, at: NOW - DAY }, ...p.trophies];
    const { profile } = loadPlayer(stored(p), NOW);
    expect(profile.trophies).toEqual([{ board: 'pioneer', place: 0, at: NOW - DAY }]);
    expect(profile.mail.map((letter) => letter.id)).toEqual(['pioneer']);
    expect(profile.pioneer).toBe(NOW - DAY);
  });

  it('a player the server never kept is new: born now, of this season, no pioneer', () => {
    const { profile, born, wiped } = loadPlayer(new Map(), NOW);
    expect([born, wiped]).toEqual([true, false]);
    expect(profile).toMatchObject({ born: NOW, season: SEASON, mail: [] });
    expect(grantPioneer(profile, [], NOW, null)).toBeNull();
  });
});

describe('boards of an earlier season are never read', () => {
  /** What the Durable Objects hold, by object name: the old world's boards under their old names. */
  const objects: Record<string, { rank: number; total: number }> = {};
  const lookup: Lookup = async (board) => objects[boardObject(board)] ?? null;

  it('names the board objects after the season, apart from the old ones', () => {
    expect(boardObject('daily:2026-10-26')).toBe(`s${SEASON}:daily:2026-10-26`);
    expect(boardObject('all')).not.toBe('all');
    expect(boardObject('week:2026-W43', 1)).toBe('s1:week:2026-W43');
  });

  it('old boards give no letters through finishedBoards, and old trophies do not come back', async () => {
    // The player stood first on every board of the old world, under the old names.
    for (const name of [...finishedBoards(NOW), 'daily:2026-10-26', 'week:2026-W43']) objects[name] = { rank: 1, total: 99 };
    const { profile } = loadPlayer(stored(veteran()), NOW);
    profile.mail = [];
    await collectMail(profile, NOW, lookup);
    expect(profile.mail).toEqual([]);
    expect(profile.trophies).toEqual([]);
    // Boards of the new season do give them.
    objects[boardObject(finishedBoards(NOW)[0]!)] = { rank: 1, total: 3 };
    const later = loadPlayer(new Map(), NOW).profile;
    await collectMail(later, NOW, lookup);
    expect(later.mail.map((letter) => letter.id)).toEqual([finishedBoards(NOW)[0]]);
  });

  it('a streak of the old world is not reminded of', () => {
    const sub: Subscriber = { chat: 1, ru: false, streak: 9, last: '2026-10-26' };
    expect(streakReminder(sub, Date.UTC(2026, 9, 27, 17))).toBeNull();
    expect(streakReminder({ ...sub, season: SEASON }, Date.UTC(2026, 9, 27, 17))).not.toBeNull();
  });
});

describe('RELEASE_AT, set in wrangler.jsonc', () => {
  it('reads an ISO moment, a bare date, a value with spaces; empty or unset is none; a typo is none too', () => {
    expect(parseReleaseAt('2026-10-27T09:00:00Z')).toBe(Date.UTC(2026, 9, 27, 9));
    expect(parseReleaseAt(' 2026-10-27T09:00:00 ')).toBe(Date.UTC(2026, 9, 27, 9));
    expect(parseReleaseAt('2026-10-27')).toBe(Date.UTC(2026, 9, 27));
    expect(parseReleaseAt('2026-10-27T12:00:00+03:00')).toBe(Date.UTC(2026, 9, 27, 9));
    expect(parseReleaseAt('')).toBeNull();
    expect(parseReleaseAt(undefined)).toBeNull();
    expect(parseReleaseAt('soon')).toBeNull();
  });
});
