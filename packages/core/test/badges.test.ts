import { describe, expect, it } from 'vitest';
import { addHero, checkBadges, createWorld, emptyBadgeProgress, heroById } from '../src/index';
import { pacify } from './helpers';

describe('the item badges', () => {
  it('«all wands identified» is not earned by a hero who has found none (nothing to label is not everything labelled)', () => {
    for (const heroClass of ['warrior', 'duelist', 'cleric'] as const) {
      const world = pacify(createWorld(9));
      addHero(world, { id: 'p', name: 'P', heroClass });
      const progress = emptyBadgeProgress();
      const { fresh } = checkBadges(progress, world, heroById(world, 'p')!, []);
      expect(fresh, heroClass).not.toContain('wands');
      expect(fresh, heroClass).not.toContain('allItems');
    }
  });
});
