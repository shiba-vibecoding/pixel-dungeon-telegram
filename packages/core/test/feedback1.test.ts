import { describe, expect, it } from 'vitest';
import {
  act, addHero, canEnter, createItem, createWorld, floorAt, heroById, HUNGRY, isChallenged, isItemBlocked, levelAt, NEIGHBOURS8, NO_HEALING, NO_HERBALISM, STARVING,
} from '../src/index';
import { pacify } from './helpers';

/** Live-player feedback (Pharmacophobia day): dew, resting and starving as Shattered has them. */
function hurtHero(challenges = 0) {
  const world = pacify(createWorld(4));
  world.challenges = challenges;
  addHero(world, { id: 'p', name: 'P', heroClass: 'warrior' });
  const hero = heroById(world, 'p')!;
  // Off the stairs, where a dewdrop would be drunk anyway.
  hero.pos = NEIGHBOURS8.map((n) => hero.pos + n).find((c) => canEnter(levelAt(world, 1), c))!;
  hero.hp = 10;
  hero.regen = 0;
  return { world, hero };
}

describe('dew when hurt (Dewdrop.doPickUp)', () => {
  it('goes into the waterskin while it has room: the hero is not healed by it', () => {
    const { world, hero } = hurtHero();
    hero.items = [createItem('waterskin')];
    floorAt(world, 1).heaps.push({ pos: hero.pos, kind: 'heap', items: [createItem('dew')] });
    const result = act(world, 'p', { type: 'pickup' });
    expect(result.ok && result.effects.some((e) => e.type === 'dewCollected')).toBe(true);
    expect(hero.items[0]!.volume).toBe(1);
    expect(hero.hp).toBeLessThanOrEqual(11);
  });

  it('heals a twentieth of health once the skin is full, under Pharmacophobia too', () => {
    const { world, hero } = hurtHero(NO_HEALING);
    expect(isChallenged(world, NO_HEALING)).toBe(true);
    hero.items = [{ ...createItem('waterskin'), volume: 20 }];
    floorAt(world, 1).heaps.push({ pos: hero.pos, kind: 'heap', items: [createItem('dew')] });
    const result = act(world, 'p', { type: 'pickup' });
    expect(result.ok && result.effects.find((e) => e.type === 'dew')).toEqual({ type: 'dew', hero: 'p', amount: 1 });
    expect(hero.hp).toBe(11);
  });

  it('only Barren land blocks dew; Pharmacophobia does not', () => {
    const dew = createItem('dew');
    expect(isItemBlocked({ challenges: NO_HERBALISM }, dew)).toBe(true);
    expect(isItemBlocked({ challenges: NO_HEALING }, dew)).toBe(false);
    expect(isItemBlocked({ challenges: 0 }, dew)).toBe(false);
  });
});

describe('resting while starving (Regeneration.act, Hunger.act)', () => {
  it('waiting heals a hurt hero, but not a starving one, who loses health instead', () => {
    const fed = hurtHero();
    for (let i = 0; i < 40; i++) act(fed.world, 'p', { type: 'wait' });
    expect(fed.hero.hp).toBeGreaterThanOrEqual(13);

    const starving = hurtHero();
    starving.hero.hunger = STARVING;
    expect(starving.hero.hunger).toBeGreaterThan(HUNGRY);
    for (let i = 0; i < 120; i++) act(starving.world, 'p', { type: 'wait' });
    // A thousandth of 20 health a turn: two points in 120 turns, and no regeneration at all.
    expect(starving.hero.hp).toBeLessThan(10);
    expect(starving.hero.hp).toBeGreaterThanOrEqual(6);
  });
});
