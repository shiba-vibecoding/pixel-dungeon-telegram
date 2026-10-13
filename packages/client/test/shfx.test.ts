import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BREW_HEAT_MS, BREW_MS, BUFF_TINTS, potFrame, WAND_BOLT_ROW, WAND_BOLT_TRAIL } from '../src/shfx';

const json = (name: string): unknown => JSON.parse(readFileSync(new URL(`../public/assets/shattered/${name}`, import.meta.url), 'utf8'));

describe('design v19 sheets', () => {
  it('every tinted buff points at its own column of buffs-tints.png', () => {
    const sheet = json('buffs-tints.json') as Array<[string, string, string, number, unknown]>;
    const named: Record<string, string> = {
      shield: 'barrier', prismaticGuard: 'prismatic', potionHealing: 'healing', htBoost: 'might', stealth: 'cloak', timeFreeze: 'hourglass', stasis: 'hourglass', thorns: 'capeThorns',
    };
    for (const [buff, index] of Object.entries(BUFF_TINTS)) expect(sheet[index]![0]).toBe(named[buff] ?? buff);
    // The talisman's foresight and the full prismatic guard are chosen where the buffs are listed.
    expect(sheet[8]![0]).toBe('prismaticFull');
    expect(sheet[17]![0]).toBe('talisman');
  });

  it('the wand bolts have a row and a trail colour each, in the order of wand-bolts.json', () => {
    const wands = json('wand-bolts.json') as string[];
    expect(WAND_BOLT_TRAIL).toHaveLength(wands.length);
    const kinds: Record<string, string> = {
      magic: 'magicMissile', fire: 'fireblast', frost: 'frost', lightning: 'lightning', corrosion: 'corrosion', force: 'blastWave', earth: 'livingEarth',
      ward: 'warding', foliage: 'regrowth', blood: 'transfusion', corruption: 'corruption', rainbow: 'prismatic',
    };
    for (const [kind, row] of Object.entries(WAND_BOLT_ROW)) expect(wands[row]).toBe(kinds[kind]);
  });

  it('the pot heats for 540 ms, puffs for 440 and then boils again', () => {
    const brew = { mode: 'brew' as const, start: 1000 };
    expect(potFrame(null, 5000).sheet).toBe('pot-idle');
    expect(potFrame(brew, 1000)).toEqual({ sheet: 'pot-brew', frame: 0 });
    expect(potFrame(brew, 1000 + 539)).toEqual({ sheet: 'pot-brew', frame: 5 });
    expect(potFrame(brew, 1000 + BREW_HEAT_MS)).toEqual({ sheet: 'pot-brew', frame: 6 });
    expect(potFrame(brew, 1000 + BREW_MS - 1)).toEqual({ sheet: 'pot-brew', frame: 9 });
    expect(potFrame(brew, 1000 + BREW_MS).sheet).toBe('pot-idle');
    expect(potFrame({ mode: 'cata', start: 0 }, 100).sheet).toBe('pot-catalyst');
  });
});
