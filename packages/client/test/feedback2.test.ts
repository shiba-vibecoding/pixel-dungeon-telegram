import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../src/ui.css', import.meta.url), 'utf8');
const hud = readFileSync(new URL('../src/hud.ts', import.meta.url), 'utf8');
const hints = readFileSync(new URL('../src/hints.ts', import.meta.url), 'utf8');

describe('the backpack stays readable at any size', () => {
  it('the item panel never collapses and the pack scrolls instead', () => {
    expect(css).toMatch(/\.pd-bag-side \{[^}]*overflow-y: auto/);
    expect(css).toMatch(/\.pd-pick \{[^}]*min-height: 188px/);
  });

  it('the side panel needs width, not height: from 760 px, whatever the height', () => {
    const wide = /@media \(min-width: 760px\) \{([^@]*?)\n\}/.exec(css)?.[1] ?? '';
    expect(wide).toContain('#overlay .pd-bag-body { flex-direction: row;');
    expect(wide).not.toContain('min-height: 701px');
    // Only the bigger cells wait for height.
    expect(css).toContain('@media (min-width: 760px) and (min-height: 701px)');
  });
});

describe('the corner buttons on a computer (journal, settings, menu)', () => {
  it('are 48 px, opaque, with hover and focus states', () => {
    expect(css).toMatch(/\.pd-dcorner \.pd-mapbtn \{ width: 48px; height: 48px; background: #4a4e45;/);
    expect(css).toContain('.pd-dcorner .pd-mapbtn:hover');
    expect(css).toContain('.pd-dcorner .pd-mapbtn:focus-visible');
  });

  it('say what they are in a tooltip, with the key', () => {
    expect(hud).toContain('node.title = key ?');
    expect(hud).toContain('menu.title = `${t.menu} (Esc)`');
  });
});

describe('the distant well of the weak floor', () => {
  it('has a hint in both languages, saying that the chasm leads to the floor below', () => {
    expect(hints.match(/distantWell:/g)).toHaveLength(2);
    expect(hints).toContain('Вы еле-еле можете разглядеть внизу колодец');
    expect(hints).toContain('You can just make out a well in the depths below');
  });
});
