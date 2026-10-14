import { describe, expect, it } from 'vitest';
import { emptyWallet, type Wallet } from '@pd/core';
import { type AdminOps, parseAdminCommand } from '../src/admin';
import { Leaderboard, type DailyEntry } from '../src/leaderboard';
import { WindowLimiter } from '../src/limits';
import { claimAll, claimLetter, MAIL_KEPT_MS, pruneMail } from '../src/mail';
import { changeOutages, isDay, joinOutages, parseOutageDays } from '../src/outages';
import { type BotApi, type BotConfig, handleUpdate, type Wallets } from '../src/payments';
import { grantPioneer, PIONEER_BEFORE_RULES, type PioneerProfile, playedBefore } from '../src/pioneer';
import {
  adminNotice, escapeHtml, giveHonor, MAX_ACTIONS, MAX_ERRORS, newId, parseProblem, parseProblemId, PROBLEMS_PER_DAY, takeProblemSlot,
} from '../src/problem';
import { emptyProfile, keepStreak, type Streak, streakNow } from '../src/runs';

const DAY = 86_400_000;
const RELEASE = Date.UTC(2026, 9, 27);
const NOW = RELEASE + 3600_000;

/** A profile as the server keeps it: `born` is when it was made (absent: from before profiles noted it). */
const profile = (more: Partial<PioneerProfile> = {}): PioneerProfile => ({ ...emptyProfile('Ann'), ...more });

describe('«Первопроходец»', () => {
  it('goes to a profile kept from before profiles noted their birth', () => {
    const p = profile();
    expect(playedBefore(p, [], RELEASE)).toBe(true);
    const letter = grantPioneer(p, [], NOW, RELEASE);
    expect(letter).toMatchObject({ id: 'pioneer', kind: 'pioneer', gifts: [{ type: 'trophy', board: 'pioneer', place: 0 }] });
    expect(p.mail).toHaveLength(1);
    expect(p.pioneer).toBe(NOW);
  });

  it('goes to a profile made before the release moment, and to one with any run of older rules', () => {
    expect(grantPioneer(profile({ born: RELEASE - DAY }), [], NOW, RELEASE)).not.toBeNull();
    // Born after, but a saved run of rules 17 is still an earlier player's.
    expect(grantPioneer(profile({ born: RELEASE + 1 }), [{ rules: PIONEER_BEFORE_RULES - 1 }], NOW, RELEASE)).not.toBeNull();
    // A finished run with no word of its rules is older still.
    const finished = profile({ born: RELEASE + 1, history: [{ rules: undefined } as never] });
    expect(grantPioneer(finished, [], NOW, RELEASE)).not.toBeNull();
    // With no release moment set, the profiles kept from before are still found.
    expect(grantPioneer(profile(), [], NOW, null)).not.toBeNull();
  });

  it('does not go to a new player: born after the release, runs of the new rules only', () => {
    const p = profile({ born: RELEASE + 60_000, history: [{ rules: PIONEER_BEFORE_RULES } as never] });
    expect(grantPioneer(p, [{ rules: PIONEER_BEFORE_RULES }], NOW, RELEASE)).toBeNull();
    expect(p.mail).toEqual([]);
    expect(p.pioneer).toBeUndefined();
    // Without a release moment, a profile with a birth is new.
    expect(grantPioneer(profile({ born: NOW }), [], NOW, null)).toBeNull();
  });

  it('is made once, however often it is asked and whatever became of the letter', () => {
    const p = profile();
    expect(grantPioneer(p, [], NOW, RELEASE)).not.toBeNull();
    expect(grantPioneer(p, [], NOW + 1, RELEASE)).toBeNull();
    expect(claimLetter(p, 'pioneer', NOW)).toBe('claimed');
    // Even with the letter gone (it is not kept for ever once claimed? it stays), asking again brings nothing.
    p.mail = [];
    expect(grantPioneer(p, [], NOW + 2, RELEASE)).toBeNull();
    expect(p.mail).toEqual([]);
  });

  it('claimed twice is one cup, first on the shelf and never dropped by it', () => {
    const p = profile();
    p.trophies = Array.from({ length: 60 }, (_, i) => ({ board: `daily:2026-09-${String((i % 28) + 1).padStart(2, '0')}x${i}`, place: 1, at: i }));
    grantPioneer(p, [], NOW, RELEASE);
    expect(claimLetter(p, 'pioneer', NOW)).toBe('claimed');
    expect(claimLetter(p, 'pioneer', NOW + 5)).toBe('already');
    expect(claimAll(p, NOW + 6)).toBe(0);
    expect(p.trophies.filter((t) => t.board === 'pioneer')).toHaveLength(1);
    expect(p.trophies[0]).toEqual({ board: 'pioneer', place: 0, at: NOW });
    expect(p.trophies.length).toBeLessThanOrEqual(50);
    // Later cups go behind it, and a full shelf drops its oldest, never the pioneer's.
    p.mail.unshift({ id: 'daily:2026-10-30', kind: 'cup', board: 'daily:2026-10-30', place: 2, at: NOW, gifts: [{ type: 'trophy', board: 'daily:2026-10-30', place: 2 }] });
    claimLetter(p, 'daily:2026-10-30', NOW + 10);
    expect(p.trophies[0]!.board).toBe('pioneer');
    expect(p.trophies[1]!.board).toBe('daily:2026-10-30');
    expect(p.trophies).toHaveLength(50);
  });

  it('waits in the mail however long the player is away', () => {
    const p = profile();
    grantPioneer(p, [], NOW, RELEASE);
    p.mail.push({ id: 'daily:2026-10-01', kind: 'cup', board: 'daily:2026-10-01', place: 1, at: NOW, gifts: [] });
    expect(pruneMail(p, NOW + MAIL_KEPT_MS + DAY)).toBe(true);
    expect(p.mail.map((letter) => letter.id)).toEqual(['pioneer']);
  });
});

describe('problem reports', () => {
  const body = (more: Record<string, unknown> = {}) => ({
    text: 'после лестницы пропал рюкзак', attach: true,
    info: { version: '2.4', rules: 18, build: 'abc123', device: 'Pixel 7', platform: 'android', lang: 'ru', run: { id: 'r1', seed: 12345, depth: 9, slot: 'dungeon', seq: 812 } },
    actions: Array.from({ length: 300 }, (_, i) => `move ${i}`), errors: Array.from({ length: 30 }, (_, i) => `TypeError ${i}`), ...more,
  });

  it('keeps the version, the run, the device, the last ~200 actions and the last console errors', () => {
    const problem = parseProblem(body(), 5)!;
    expect(problem.facts).toMatchObject({ version: '2.4', rules: 18, build: 'abc123', platform: 'android', run: { id: 'r1', seed: 12345, depth: 9, seq: 812 } });
    expect(problem.actions).toHaveLength(MAX_ACTIONS);
    expect(problem.actions!.at(-1)).toBe('move 299');
    expect(problem.errors).toHaveLength(MAX_ERRORS);
    expect(problem.errors!.at(-1)).toBe('TypeError 29');
  });

  it('leaves the log out when the player did not attach it', () => {
    const problem = parseProblem(body({ attach: false }), 5)!;
    expect(problem.actions).toBeUndefined();
    expect(problem.errors).toBeUndefined();
    expect(problem.text).toBe('после лестницы пропал рюкзак');
  });

  it('cuts every field, strips control characters and refuses what is not a report', () => {
    const problem = parseProblem(body({ text: `${'я'.repeat(2000)}\u0000\u0007`, actions: ['x'.repeat(500), '\u0000\u0001'], errors: ['e'.repeat(900)] }), 5)!;
    expect(problem.text).toHaveLength(1000);
    expect(problem.actions).toEqual(['x'.repeat(80)]);
    expect(problem.errors![0]).toHaveLength(300);
    expect(parseProblem(null, 5)).toBeNull();
    expect(parseProblem('nonsense', 5)).toBeNull();
    expect(parseProblem({ text: 'hi' }, 5)).toBeNull();
    expect(parseProblem({ text: 'hi', info: { rules: 'x' } }, 5)).toBeNull();
  });

  it('allows five reports a player a (UTC) day, and counts a new day afresh', () => {
    let state: { day: string; count: number } | undefined;
    for (let i = 0; i < PROBLEMS_PER_DAY; i++) {
      const taken = takeProblemSlot(state, '2026-10-27');
      expect(taken.ok).toBe(true);
      state = taken.state;
    }
    expect(takeProblemSlot(state, '2026-10-27').ok).toBe(false);
    expect(takeProblemSlot(state, '2026-10-28')).toEqual({ ok: true, state: { day: '2026-10-28', count: 1 } });
  });

  it('shows the admin a short notice with the id, the player’s words escaped', () => {
    const problem = { ...parseProblem(body({ text: '<b>hi</b> & <a href="x">link</a>' }), 5)!, id: 'ABC234' };
    const notice = adminNotice(problem);
    expect(notice).toContain('<code>ABC234</code>');
    expect(notice).toContain('/bughunter ABC234');
    expect(notice).toContain('&lt;b&gt;hi&lt;/b&gt; &amp; &lt;a href="x"&gt;link&lt;/a&gt;');
    expect(notice).not.toContain('<b>');
    expect(notice).not.toContain('<a ');
    expect(escapeHtml('<&>')).toBe('&lt;&amp;&gt;');
    expect(notice.split('\n').length).toBeLessThanOrEqual(6);
  });

  it('makes ids an admin can type, and gives the badge once', () => {
    expect(newId()).toMatch(/^[A-HJKMNP-Z2-9]{6}$/);
    expect(parseProblemId(' abc234 ')).toBe('ABC234');
    expect(parseProblemId('ABC10O')).toBeNull();
    expect(parseProblemId('ABC')).toBeNull();
    const p: { honors?: string[] } = {};
    expect(giveHonor(p, 'bughunter')).toBe(true);
    expect(giveHonor(p, 'bughunter')).toBe(false);
    expect(giveHonor(p, 'admin')).toBe(false);
    expect(p.honors).toEqual(['bughunter']);
  });
});

/** A Bot API that remembers its calls. */
function fakeApi(): { api: BotApi; calls: Array<{ method: string; params: Record<string, unknown> }> } {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  return { api: async (method, params) => (calls.push({ method, params }), true), calls };
}

const wallets: Wallets = { get: async () => emptyWallet(), apply: async () => emptyWallet() as Wallet };
const ADMIN = 900;

function fakeOps(): AdminOps & { log: string[] } {
  const log: string[] = [];
  let days: string[] = [];
  return {
    log,
    async bugHunter(id) {
      log.push(`hunter ${id}`);
      return id === 'ABC234' ? 'granted' : 'unknown';
    },
    async outages(change) {
      if (change) {
        log.push(`outage ${change.op} ${change.day}`);
        days = changeOutages(days, change.op, change.day);
      }
      return days;
    },
  };
}

const config = (ops: AdminOps): BotConfig => ({ appLink: 'https://t.me/bot/app', adminChatId: String(ADMIN), ops, supportLimiter: new WindowLimiter(5, 60_000) });
const say = (chat: number, text: string, user = chat) => ({ message: { message_id: 1, chat: { id: chat, type: 'private' }, from: { id: user, first_name: 'X' }, text } });

describe('the admin’s bot commands', () => {
  it('parse /bughunter and /outage', () => {
    expect(parseAdminCommand('/bughunter abc234')).toEqual({ kind: 'bughunter', id: 'ABC234' });
    expect(parseAdminCommand('/bughunter')).toEqual({ kind: 'usage' });
    expect(parseAdminCommand('/bughunter 1234')).toEqual({ kind: 'usage' });
    expect(parseAdminCommand('/outage 2026-10-20')).toEqual({ kind: 'outage', op: 'add', day: '2026-10-20' });
    expect(parseAdminCommand('/outage remove 2026-10-20')).toEqual({ kind: 'outage', op: 'remove', day: '2026-10-20' });
    expect(parseAdminCommand('/outage')).toEqual({ kind: 'outage', op: 'list' });
    expect(parseAdminCommand('/outage 2026-02-30')).toEqual({ kind: 'usage' });
    expect(parseAdminCommand('/outage tomorrow')).toEqual({ kind: 'usage' });
  });

  it('work from the admin chat only', async () => {
    const ops = fakeOps();
    const mine = fakeApi();
    await handleUpdate(say(ADMIN, '/bughunter ABC234'), mine.api, wallets, config(ops), 1);
    expect(ops.log).toEqual(['hunter ABC234']);
    expect(String(mine.calls[0]!.params.text)).toContain('got the');
    await handleUpdate(say(ADMIN, '/bughunter ZZZZZZ'), mine.api, wallets, config(ops), 1);
    expect(String(mine.calls[1]!.params.text)).toContain('No report');
    await handleUpdate(say(ADMIN, '/outage 2026-10-20'), mine.api, wallets, config(ops), 1);
    expect(ops.log).toEqual(['hunter ABC234', 'hunter ZZZZZZ', 'outage add 2026-10-20']);
    expect(String(mine.calls[2]!.params.text)).toContain('2026-10-20');

    // Anyone else, in a private chat or a group, in any words: the commands do nothing at all.
    const other = fakeApi();
    const before = [...ops.log];
    await handleUpdate(say(555, '/bughunter ABC234'), other.api, wallets, config(ops), 1);
    await handleUpdate(say(555, '/outage 2026-10-21'), other.api, wallets, config(ops), 1);
    await handleUpdate({ message: { message_id: 2, chat: { id: -100, type: 'supergroup' }, from: { id: 555 }, text: '/bughunter ABC234' } }, other.api, wallets, config(ops), 1);
    // ...and not even when it is the admin's user id writing from another chat.
    await handleUpdate(say(556, '/outage remove 2026-10-20', ADMIN), other.api, wallets, config(ops), 1);
    expect(ops.log).toEqual(before);
    // With no admin chat set, nobody is one.
    await handleUpdate(say(ADMIN, '/bughunter ABC234'), other.api, wallets, { ...config(ops), adminChatId: undefined }, 1);
    expect(ops.log).toEqual(before);
  });
});

describe('days the server was down', () => {
  const streak = (more: Partial<Streak> = {}): Streak => ({ last: '2026-10-10', count: 2, best: 2, freezes: 0, ...more });

  it('parses the variable and the admin’s list into real days', () => {
    expect(parseOutageDays('2026-10-20, 2026-10-18 nonsense 2026-02-30;2026-10-20')).toEqual(['2026-10-18', '2026-10-20']);
    expect(parseOutageDays(undefined)).toEqual([]);
    expect(isDay('2026-10-20')).toBe(true);
    expect(isDay('2026-13-01')).toBe(false);
    expect(joinOutages(['2026-10-20'], ['2026-10-18', '2026-10-20'])).toEqual(['2026-10-18', '2026-10-20']);
    expect(changeOutages(['2026-10-18'], 'add', '2026-10-20')).toEqual(['2026-10-18', '2026-10-20']);
    expect(changeOutages(['2026-10-18', '2026-10-20'], 'remove', '2026-10-18')).toEqual(['2026-10-20']);
    expect(changeOutages(['2026-10-18'], 'add', 'x')).toEqual(['2026-10-18']);
  });

  it('do not break a streak: the day missed to an outage is a day played', () => {
    // Played the 10th, the server was down the 11th, played the 12th: with no freeze, the streak without outage would break.
    expect(keepStreak(streak(), '2026-10-12')).toMatchObject({ count: 1 });
    expect(keepStreak(streak(), '2026-10-12', ['2026-10-11'])).toMatchObject({ count: 4, freezes: 0 });
  });

  it('spend no freeze, and spend one only for a day that was missed', () => {
    expect(keepStreak(streak({ freezes: 1 }), '2026-10-12', ['2026-10-11'])).toMatchObject({ freezes: 1 });
    // Two days off, one of them an outage: the freeze covers the other.
    expect(keepStreak(streak({ freezes: 1 }), '2026-10-13', ['2026-10-11'])).toMatchObject({ count: 4, freezes: 0 });
    // Two missed and only one freeze: broken as ever.
    expect(keepStreak(streak({ freezes: 1 }), '2026-10-14', ['2026-10-11'])).toMatchObject({ count: 1, freezes: 0 });
    // Without outages everything is as it was.
    expect(keepStreak(streak({ freezes: 1 }), '2026-10-12')).toMatchObject({ count: 3, freezes: 0 });
  });

  it('keep the streak shown alive over the outage, and break it past the freezes as before', () => {
    expect(streakNow(streak(), '2026-10-12', ['2026-10-11']).count).toBe(2);
    expect(streakNow(streak(), '2026-10-12').count).toBe(0);
    expect(streakNow(streak(), '2026-10-13', ['2026-10-11']).count).toBe(0);
    expect(streakNow(streak({ freezes: 1 }), '2026-10-13', ['2026-10-11']).count).toBe(2);
  });
});

describe('the board’s order for equal scores', () => {
  const entry = (id: string, score: number, at: number): DailyEntry => ({
    id, name: id, heroClass: 'warrior', depth: 3, level: 3, gold: 0, won: false, score, kills: 0, at,
  });

  it('puts the run that finished earlier higher, whatever order the server heard them in', () => {
    const board = new Leaderboard();
    board.put(entry('late', 900, 3000));
    board.put(entry('early', 900, 1000));
    board.put(entry('middle', 900, 2000));
    board.put(entry('best', 1200, 9000));
    expect(board.top(10).map((e) => e.id)).toEqual(['best', 'early', 'middle', 'late']);
    expect(board.rank('early')).toBe(2);
  });

  it('does not push a player down by an equal run played later', () => {
    const board = new Leaderboard();
    board.put(entry('a', 500, 1000));
    board.put(entry('b', 500, 2000));
    expect(board.put(entry('a', 500, 5000))).toBe(1);
    expect(board.top(2).map((e) => e.id)).toEqual(['a', 'b']);
    // A better run moves them up and takes its own time.
    expect(board.put(entry('b', 700, 6000))).toBe(1);
    expect(board.top(2).map((e) => [e.id, e.at])).toEqual([['b', 6000], ['a', 1000]]);
  });
});
