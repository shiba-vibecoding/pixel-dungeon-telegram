import { describe, expect, it } from 'vitest';
import { addHero, applyBoon, challengeMultiplier, createWorld, dailyRules, NO_HEALING, NO_SCROLLS } from '../src/index';

describe('the daily dungeon’s rules', () => {
  it('are the same for a day, change over days, and never pair a boon with the hardship that spoils it', () => {
    expect(dailyRules('2026-10-13')).toEqual(dailyRules('2026-10-13'));
    const days = Array.from({ length: 60 }, (_, i) => dailyRules(new Date(Date.UTC(2026, 9, 1 + i)).toISOString().slice(0, 10)));
    expect(new Set(days.map((d) => `${d.challenge}:${d.boon}`)).size).toBeGreaterThan(10);
    for (const d of days) {
      expect(d.challenge === NO_HEALING && d.boon === 'supplies').toBe(false);
      expect(d.challenge === NO_SCROLLS && d.boon === 'scholar').toBe(false);
    }
  });

  it('give the hero the boon', () => {
    const world = createWorld(3);
    const hero = addHero(world, { id: 'p', name: 'P', heroClass: 'warrior' });
    const gold = hero.gold;
    applyBoon(world, hero, 'purse');
    expect(hero.gold).toBe(gold + 150);
    applyBoon(world, hero, 'alchemist');
    expect(world.known).toContain('potion.strength');
    expect(world.boon).toBe('alchemist');
  });

  it('raise a score a quarter for each challenge', () => {
    expect(challengeMultiplier(0)).toBe(1);
    expect(challengeMultiplier(1 | 4 | 32)).toBe(1.95);
  });
});
