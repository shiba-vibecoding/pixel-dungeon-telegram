import { describe, expect, it } from 'vitest';
import {
  act, type Action, addHero, createItem, duelistCharges, createMob, createWorld, fingerprint, floorAt, heroById, HERO_CLASSES, ITEMS, type ItemKind, itemDef, NEIGHBOURS8, swapsWithHero, canEnter, charAt, levelAt,
} from '../src/index';

/*
 * Found by the soak (server/test/soak.test.ts): a copy of a run and its replay must hash alike whatever one of them did
 * to the lazily made containers of the world (`hero.buffs ??= {}`), and a refused action, which is never sent to the
 * server, must leave no trace the fingerprint could see.
 */

describe('the fingerprint', () => {
  it('takes an empty container for none at all, and a missing key for an undefined one', () => {
    const world = createWorld(5);
    const hero = addHero(world, { id: 'me', name: 'Me', heroClass: 'warrior' });
    delete hero.buffs;
    const bare = fingerprint(world);
    hero.buffs = {};
    expect(fingerprint(world)).toBe(bare);
    (hero as unknown as Record<string, unknown>).plan = [];
    expect(fingerprint(world)).toBe(bare);
    (hero as unknown as Record<string, unknown>).wound = undefined;
    expect(fingerprint(world)).toBe(bare);
    // A container with something in it is state.
    hero.buffs = { prismaticGuard: 1 };
    expect(fingerprint(world)).not.toBe(bare);
  });

  it('still sees a changed hero, a changed list and a changed level', () => {
    const world = createWorld(5);
    const hero = addHero(world, { id: 'me', name: 'Me', heroClass: 'mage' });
    const before = fingerprint(world);
    hero.hp -= 1;
    const hurt = fingerprint(world);
    expect(hurt).not.toBe(before);
    hero.items.pop();
    expect(fingerprint(world)).not.toBe(hurt);
    const level = levelAt(world, 1);
    const cell = level.map[level.entrance + 1]!;
    level.map[level.entrance + 1] = cell === 1 ? 2 : 1;
    expect(fingerprint(world)).not.toBe(hurt);
  });

  it('is unmoved by an action the world refuses, whatever the class', () => {
    let refused = 0;
    for (const heroClass of HERO_CLASSES) {
      const world = createWorld(11);
      const hero = addHero(world, { id: 'me', name: 'Me', heroClass });
      // One of nearly everything in the pack (scrolls and potions that want something chosen are refused without it).
      hero.items = (Object.keys(ITEMS) as ItemKind[]).filter((kind) => ['scroll', 'potion', 'stone', 'seed', 'wand', 'ring', 'artifact'].includes(itemDef(kind).category)).map((kind) => createItem(kind));
      delete hero.buffs;
      const cell = hero.pos + 3;
      const actions: Action[] = [{ type: 'ascend' }, { type: 'branch' }, { type: 'reward', choice: 'weapon' }, { type: 'wandReward', choice: 1 }, { type: 'swap' }, { type: 'stance' }];
      for (let item = 0; item < hero.items.length + 2; item++) {
        actions.push(
          { type: 'use', item, on: 1, cell, choice: 0 }, { type: 'use', item, on: 99, cell, choice: 3 }, { type: 'zap', item, target: cell }, { type: 'throw', item, target: cell },
          { type: 'equip', item: item + 40 }, { type: 'drop', item: item + 40 }, { type: 'sell', item }, { type: 'artifact', item, use: 'zap', cell, with: 0, choice: 1, on: 0 },
        );
      }
      for (const action of actions) {
        const before = fingerprint(world);
        if (act(world, 'me', action).ok) continue;
        refused++;
        expect(fingerprint(world), `${heroClass}: ${JSON.stringify(action)} was refused but changed the world`).toBe(before);
      }
    }
    expect(refused).toBeGreaterThan(50);
  });
});

describe('mirror images', () => {
  it('trade places with a hero who walks into them (they are not walls in a corridor)', () => {
    const world = createWorld(3);
    const hero = addHero(world, { id: 'me', name: 'Me', heroClass: 'rogue' });
    const level = levelAt(world, 1);
    const floor = floorAt(world, 1);
    floor.mobs = [];
    const from = hero.pos;
    const step = NEIGHBOURS8.find((n) => canEnter(level, from + n) && !charAt(world, 1, from + n))!;
    const image = createMob('#image', 'mirror', from + step, 'passive', floor.now + 1);
    image.image = { owner: 'me', attack: 10, damage: 2 };
    floor.mobs.push(image);
    expect(swapsWithHero(image)).toBe(true);
    const result = act(world, 'me', { type: 'move', to: from + step });
    expect(result.ok).toBe(true);
    expect(heroById(world, 'me')!.pos).toBe(from + step);
    expect(image.pos).toBe(from);
  });
});

describe('a hero without buffs yet', () => {
  it('plays on as one whose buffs object exists, so that a refused action cannot part two copies of a run', () => {
    const make = (buffs: boolean) => {
      const world = createWorld(21);
      const hero = addHero(world, { id: 'me', name: 'Me', heroClass: 'warrior' });
      hero.items.push(createItem('trinket.chaoticCenser'));
      delete hero.buffs;
      if (buffs) hero.buffs = {};
      return world;
    };
    const bare = make(false);
    const made = make(true);
    for (let i = 0; i < 5; i++) {
      expect(act(bare, 'me', { type: 'wait' }).ok).toBe(true);
      expect(act(made, 'me', { type: 'wait' }).ok).toBe(true);
      expect(fingerprint(bare), `after ${i + 1} turns`).toBe(fingerprint(made));
    }
    // The censer in the pack works from the first turn.
    expect(heroById(bare, 'me')!.buffs?.censer).toBeDefined();
  });
});

describe('a Duelist who tries an ability she cannot use', () => {
  it('leaves the world as it was (the check looks at her charges, it does not start them)', () => {
    const world = createWorld(8);
    const hero = addHero(world, { id: 'me', name: 'Me', heroClass: 'duelist' });
    expect(hero.cls?.charges).toBeUndefined();
    const before = fingerprint(world);
    const result = act(world, 'me', { type: 'weaponAbility', which: 'weapon', cell: hero.pos + 5 });
    expect(result.ok).toBe(false);
    expect(fingerprint(world)).toBe(before);
    expect(hero.cls?.charges).toBeUndefined();
    expect(duelistCharges(hero)).toBe(2);
    expect(hero.cls?.charges).toBeUndefined();
  });
});
