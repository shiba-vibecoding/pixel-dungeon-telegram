import { describe, expect, it, vi } from 'vitest';
import { addHero, armorDrMax, armorDrMin, createItem, createWorld, heroById, NO_ARMOR } from '@pd/core';

/** «Faith is my armor» (Challenges.NO_ARMOR): Armor.DRMax is 1 + tier + level, DRMin is 0. */
describe('armour numbers in item descriptions under «Faith is my armor»', () => {
  const mail = createItem('armor.mail', 1, 2);
  mail.levelUnknown = false;

  it('use the challenge\'s DRMin and DRMax, as the rules do', async () => {
    // The texts pick their language from the page's address.
    vi.stubGlobal('location', { search: '?lang=en' });
    const { gearInfo, itemInfo } = await import('../src/itemtext');
    const plain = createWorld(5);
    const faith = createWorld(5, NO_ARMOR);
    addHero(plain, { id: 'p', name: 'P', heroClass: 'warrior' });
    addHero(faith, { id: 'p', name: 'P', heroClass: 'warrior' });
    const hero = heroById(plain, 'p')!;
    const normal = gearInfo(hero, mail)!.join(' ');
    const stripped = gearInfo(hero, mail, true)!.join(' ');
    // Tier 3, +2: 3*(2+2) = 12 normally, 1+3+2 = 6 under the challenge, whose minimum is 0.
    expect([armorDrMin(mail, 2), armorDrMax(mail, 2)]).toEqual([2, 12]);
    expect([armorDrMin(mail, 2, true), armorDrMax(mail, 2, true)]).toEqual([0, 6]);
    expect(normal).toContain('2-12');
    expect(stripped).toContain('0-6');
    expect(itemInfo(faith, heroById(faith, 'p')!, mail).join(' ')).toContain('0-6');
    expect(itemInfo(plain, hero, mail).join(' ')).toContain('2-12');
  });
});
