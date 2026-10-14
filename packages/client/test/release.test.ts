import { describe, expect, it } from 'vitest';
import type { Action } from '@pd/core';
import { ACTIONS_KEPT, describeAction, ERRORS_KEPT, noteAction, noteError, recent, resetActions } from '../src/diag';
import { compareVersions, newsDue } from '../src/news';
import { CURRENT, RELEASES } from '../src/releases';
import { trophyKind } from '../src/trophyicons';
import { REL_EN, REL_RU } from '../src/i18n-release';

describe('the news data', () => {
  it('has the versions newest first, each once, with both languages for every line', () => {
    const versions = RELEASES.map((release) => release.version);
    expect(new Set(versions).size).toBe(versions.length);
    for (let i = 1; i < versions.length; i++) expect(compareVersions(versions[i - 1]!, versions[i]!)).toBeGreaterThan(0);
    expect(CURRENT).toBe(RELEASES[0]);
    for (const release of RELEASES) {
      expect(release.changes.length).toBeGreaterThan(0);
      for (const change of release.changes) {
        expect(['add', 'now', 'fix', 'bal']).toContain(change.tag);
        expect(change.text.ru.length).toBeGreaterThan(5);
        expect(change.text.en.length).toBeGreaterThan(5);
      }
    }
  });

  it('gives a major update its banner words and four main items', () => {
    expect(CURRENT.major).toBe(true);
    expect(CURRENT.main).toHaveLength(4);
    expect(CURRENT.title?.en && CURRENT.title.ru && CURRENT.kick?.en && CURRENT.kick.ru && CURRENT.sub?.en && CURRENT.sub.ru).toBeTruthy();
    for (const item of CURRENT.main!) expect(item.title.ru && item.title.en && item.text.ru && item.text.en).toBeTruthy();
  });

  it('has the same screens’ strings in Russian as in English', () => {
    const shape = (value: unknown): unknown =>
      Array.isArray(value) ? value.map(shape) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shape(v)])) : typeof value;
    expect(shape(REL_RU)).toEqual(shape(REL_EN));
    expect(REL_RU.rules.items).toHaveLength(5);
  });
});

describe('when the news are shown', () => {
  const facts = { local: null, veteran: true, current: '2.4' };

  it('compares dotted versions as numbers', () => {
    expect(compareVersions('2.4', '2.10')).toBeLessThan(0);
    expect(compareVersions('2.4', '2.4')).toBe(0);
    expect(compareVersions('3', '2.9.9')).toBeGreaterThan(0);
  });

  it('shows them once to a player who has played before, and not again', () => {
    expect(newsDue(facts)).toBe('show');
    expect(newsDue({ ...facts, local: '2.3' })).toBe('show');
    expect(newsDue({ ...facts, local: '2.4' })).toBe('none');
  });

  it('does not show them to a brand-new player, who has the tutorial instead', () => {
    expect(newsDue({ ...facts, veteran: false })).toBe('mark');
  });

  it('takes the server’s word that another device saw them, and the newer of the two', () => {
    expect(newsDue({ ...facts, server: '2.4' })).toBe('none');
    expect(newsDue({ ...facts, local: '2.3', server: '2.4' })).toBe('none');
    expect(newsDue({ ...facts, local: '2.4', server: null })).toBe('none');
    // The server could not be asked: this device alone.
    expect(newsDue({ ...facts, server: undefined })).toBe('show');
    expect(newsDue({ ...facts, server: null })).toBe('show');
  });
});

describe('the pioneer cup', () => {
  it('is a trophy of its own on the shelf', () => {
    expect(trophyKind('pioneer', 0)).toBe('pioneer');
    expect(trophyKind('daily:2026-10-12', 1)).toBe('gold');
    expect(trophyKind('week:2026-W41', 4)).toBe('week');
  });
});

describe('what a problem report carries', () => {
  it('keeps the last actions and errors, no more than the server takes', () => {
    resetActions();
    for (let i = 0; i < ACTIONS_KEPT + 30; i++) noteAction({ type: 'move', to: i } as Action);
    for (let i = 0; i < ERRORS_KEPT + 5; i++) noteError(`error ${i}\n  at somewhere`);
    const { actions, errors } = recent();
    expect(actions).toHaveLength(ACTIONS_KEPT);
    expect(actions.at(-1)).toBe(`#${ACTIONS_KEPT + 30} move {"to":${ACTIONS_KEPT + 29}}`);
    expect(errors).toHaveLength(ERRORS_KEPT);
    expect(errors.at(-1)).toBe(`error ${ERRORS_KEPT + 4} at somewhere`);
    resetActions();
    expect(recent().actions).toEqual([]);
  });

  it('writes an action as a short line', () => {
    expect(describeAction({ type: 'wait' } as Action, 3)).toBe('#3 wait');
    expect(describeAction({ type: 'say', text: 'x'.repeat(300) } as unknown as Action, 4).length).toBeLessThanOrEqual(80);
  });
});
