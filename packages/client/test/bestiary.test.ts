import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { MobKind } from '@pd/core';

type Strings = { mobs: Record<string, string> };
let bestiary: typeof import('../src/bestiary');
let en: Strings;
let ru: Strings;

beforeAll(async () => {
  // The texts are chosen at load by the page's address; there is none here.
  vi.stubGlobal('location', { search: '' });
  const i18n = await import('../src/i18n');
  en = i18n.enStrings as unknown as Strings;
  ru = i18n.ruStrings as unknown as Strings;
  bestiary = await import('../src/bestiary');
});

const sheet = (): Array<[string, number, number | string, string, string]> =>
  JSON.parse(readFileSync(new URL('../public/assets/mobs/bestiary.json', import.meta.url), 'utf8'));
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

describe("the bestiary of design v22 against Shattered's own texts", () => {
  it('lists the sheet in its order, 69 cells in 24 pixels', () => {
    const rows = sheet();
    expect(rows).toHaveLength(69);
    expect(rows.map((row) => row[0])).toEqual(bestiary.SHEET_KEYS);
    // 11 to a row, 7 rows: the sheet is 264 x 168; the quest's three are the first of the seventh row.
    expect(bestiary.portraitCell(65)).toEqual({ mx: 10, my: 5 });
    expect(bestiary.portraitCell(66)).toEqual({ mx: 0, my: 6 });
    expect(bestiary.portraitCell(68)).toEqual({ mx: 2, my: 6 });
    expect(bestiary.portraitCell(11)).toEqual({ mx: 0, my: 1 });
  });

  it('every monster of the list is named in the sheet as the game names it, in English and in Russian', () => {
    const rows = sheet();
    bestiary.SHEET_KINDS.forEach((kind, n) => {
      if (!kind) return;
      expect(en.mobs[kind], kind).toBeTruthy();
      expect(ru.mobs[kind], kind).toBeTruthy();
      expect(rows[n]![4], `${kind} (en)`).toBe(cap(en.mobs[kind]!));
      expect(rows[n]![3], `${kind} (ru)`).toBe(cap(ru.mobs[kind]!));
    });
  });

  it('every entry has a cell on the sheet and a group, no monster twice, and the quest group holds the ghost\'s three', () => {
    const kinds = bestiary.BESTIARY_ENTRIES.map((entry) => entry.kind as MobKind);
    expect(new Set(kinds).size).toBe(kinds.length);
    for (const entry of bestiary.BESTIARY_ENTRIES) {
      expect(bestiary.BEST_GROUPS).toContain(entry.group);
      expect(entry.n).not.toBeNull();
    }
    expect(bestiary.BESTIARY_ENTRIES.filter((entry) => entry.group === 'quest').map((entry) => [entry.kind, entry.n])).toEqual([['fetidRat', 66], ['gnollTrickster', 67], ['greatCrab', 68]]);
    // The two the design draws and the core lacks (the trap guardian, the sentry) stay out.
    expect(kinds).toHaveLength(64 + 3);
  });

  it('the cell counts stop at 999+', () => {
    expect(bestiary.slainLabel(12)).toBe('12');
    expect(bestiary.slainLabel(1000)).toBe('999+');
  });
});
