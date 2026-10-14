import { describe, expect, it } from 'vitest';
import { CURRENT } from '../src/releases';
import { SEASON, SEASON_KEY, seasonStale, startSeason } from '../src/season';

/** A bare Web Storage. */
function storage(initial: Record<string, string>) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    get length() { return data.size; },
    key: (i: number) => [...data.keys()][i] ?? null,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

describe('the season starts afresh on the device', () => {
  it('clears the saves and the local progress of the old version, keeps identity and settings', () => {
    const s = storage({
      'pd-solo': '{"version":31}', 'pd-arena': '{"version":31}', 'pd-daily-2026-10-26': '{}', 'pd-badges': '{"earned":["victory"]}', 'pd-rankings': '[{"key":"a"}]',
      'pd-arena-best': '9', 'pd-bones': '{}', 'pd-window': '{}', 'pd-quickslots': '{}', 'pd-seen-magic': '[]',
      'pd-name': 'Ann', 'pd-class': 'mage', 'pd-lang': 'ru', 'pd-look': 'x', 'pd-sound': 'on', 'pd-seen-version': '2.3', 'pd-moved': '1', 'pd-guest-secret': 's', 'pd-launches': '9',
    });
    expect(startSeason(s)).toBe(true);
    expect([...s.data.keys()].sort()).toEqual(
      ['pd-class', 'pd-guest-secret', 'pd-lang', 'pd-launches', 'pd-look', 'pd-moved', 'pd-name', 'pd-season', 'pd-seen-version', 'pd-sound'].sort(),
    );
    expect(s.getItem(SEASON_KEY)).toBe(String(SEASON));
  });

  it('does it once: what the new season keeps afterwards stays', () => {
    const s = storage({ 'pd-solo': '{}' });
    startSeason(s);
    s.setItem('pd-solo', '{"version":32}');
    s.setItem('pd-badges', '{}');
    expect(startSeason(s)).toBe(false);
    expect(s.getItem('pd-solo')).toBe('{"version":32}');
    expect(s.getItem('pd-badges')).toBe('{}');
  });

  it('a new install has nothing to clear and only notes the season; broken storage does not throw', () => {
    const s = storage({});
    expect(startSeason(s)).toBe(false);
    expect(s.getItem(SEASON_KEY)).toBe(String(SEASON));
    const broken = { ...storage({}), getItem: () => { throw new Error('blocked'); } };
    expect(startSeason(broken)).toBe(false);
  });

  it('knows a stale cloud: no season written, or an earlier one', () => {
    expect(seasonStale(undefined)).toBe(true);
    expect(seasonStale(null)).toBe(true);
    expect(seasonStale('1')).toBe(true);
    expect(seasonStale(String(SEASON))).toBe(false);
  });

  it('the news say plainly, in both languages, that the world started afresh and that veterans got the cup', () => {
    expect(CURRENT.notice?.ru).toMatch(/чистого листа.*Первопроходец/);
    expect(CURRENT.notice?.en).toMatch(/afresh.*Pioneer/);
    const first = CURRENT.changes[0]!;
    expect(first.text.ru).toContain('чистого листа');
    expect(first.text.en).toContain('afresh');
    expect(CURRENT.changes.some((c) => c.text.ru.includes('Первопроходец') && c.text.en.includes('Pioneer'))).toBe(true);
  });
});
