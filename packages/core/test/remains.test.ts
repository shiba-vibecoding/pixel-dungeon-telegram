import { describe, expect, it } from 'vitest';
import { act, addHero, createItem, createWorld, floorAt, heroById, mobStats } from '../src/index';
import { pacify } from './helpers';

function withRemains(kind: 'tomb' | 'skeleton', cursed: boolean) {
  const world = pacify(createWorld(12));
  // Not the warrior: his seal's shield would take the curse's blow.
  addHero(world, { id: 'p', name: 'P', heroClass: 'mage' });
  const hero = heroById(world, 'p')!;
  const item = { ...createItem('weapon.sword', 1, cursed ? -2 : 0), ...(cursed ? { cursed: true } : {}) };
  floorAt(world, 1).heaps.push({ pos: hero.pos, kind, items: [item] });
  return { world, hero };
}

describe('disturbed remains', () => {
  it('a tomb opened calls up wraiths around the hero, hard to hit but slain by one blow', () => {
    const { world } = withRemains('tomb', false);
    expect(act(world, 'p', { type: 'pickup' }).ok).toBe(true);
    const wraiths = floorAt(world, 1).mobs.filter((m) => m.kind === 'wraith');
    expect(wraiths.length).toBeGreaterThan(0);
    expect(mobStats(wraiths[0]!)).toMatchObject({ ht: 1, attack: 11, defense: 55 });
  });

  it('a skeleton holding something cursed lets out a wraith beside whoever disturbs it (or, with no room, takes half their health)', () => {
    let { world, hero } = withRemains('skeleton', true);
    act(world, 'p', { type: 'pickup' });
    // Heap.open: Wraith.spawnAt(pos), beside it if the hero stands on it.
    const risen = floorAt(world, 1).mobs.filter((m) => m.kind === 'wraith' || m.kind === 'tormentedSpirit');
    expect(risen.length === 1 || hero.hp === 10).toBe(true);

    ({ world, hero } = withRemains('skeleton', false));
    act(world, 'p', { type: 'pickup' });
    expect(hero.hp).toBe(20);
  });
});
