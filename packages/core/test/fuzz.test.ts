import { describe, expect, it } from 'vitest';
import {
  act, type Action, addHero, canEnter, charAt, createItem, createWorld, floorAt, heroById, isAlive, ITEMS, type ItemKind, itemDef, levelAt,
  NEIGHBOURS8, Rng, visibleCells, type World,
} from '../src/index';
import { checkInvariants, unblock } from './helpers';

/*
 * Chaos: two heroes, carrying one of nearly everything, do random things
 * across the dungeon. Nothing may throw, and the world must stay sound.
 */

const KINDS = (Object.keys(ITEMS) as ItemKind[]).filter((kind) => kind !== 'gold' && kind !== 'quest.amulet');

function stock(world: World, id: string, rng: Rng): void {
  const hero = heroById(world, id)!;
  const kinds = [...KINDS];
  rng.shuffle(kinds);
  // The gear's own kinds always among them, for their actions to be tried.
  for (const kind of ['weightstone', 'spiritBow', 'missile.dart', 'seed.icecap'] as const) {
    kinds.splice(kinds.indexOf(kind), 1);
    kinds.unshift(kind);
  }
  hero.items = kinds.slice(0, 18).map((kind) => {
    const item = createItem(kind, itemDef(kind).category === 'missile' || kind === 'bomb' ? 3 : 1);
    if (kind === 'waterskin') item.volume = 10;
    if (kind.startsWith('key.')) item.depth = hero.depth;
    return item;
  });
  Object.assign(hero, { ht: 300, hp: 300, attackSkill: 60, defenseSkill: 30 });
}

function randomAction(world: World, id: string, rng: Rng): Action {
  const hero = heroById(world, id)!;
  const level = levelAt(world, hero.depth);
  const seen = visibleCells(world, hero.depth);
  const cells = seen.flatMap((v, c) => (v ? [c] : []));
  const mobs = floorAt(world, hero.depth).mobs.filter((m) => NEIGHBOURS8.some((n) => m.pos === hero.pos + n));
  const item = rng.int(Math.max(1, hero.items.length));
  const target = rng.element(cells) ?? hero.pos + 1;
  switch (rng.int(16)) {
    case 0: return { type: 'move', to: hero.pos + rng.element(NEIGHBOURS8)! };
    case 1: return mobs.length > 0 ? { type: 'attack', target: rng.element(mobs)!.id } : { type: 'search' };
    case 2: return { type: 'use', item, target: rng.int(2) === 0 ? 'weapon' : 'armor' };
    case 3: return { type: 'throw', item, target };
    case 4: return { type: 'zap', item, target };
    case 5: return { type: 'equip', item };
    case 6: return { type: 'drop', item };
    case 7: return { type: 'pickup' };
    case 8: return { type: 'special', target };
    // The beacon, when the hero has one: a random slot would hardly ever hit it.
    case 9: return { type: 'beacon', item: Math.max(0, hero.items.findIndex((i) => i.kind === 'beacon')), mode: rng.int(2) === 0 ? 'set' : 'return' };
    case 10: {
      // The gear's own actions: a stone of augmentation, the spirit bow, tipping darts, cleaning them.
      const of = (kind: ItemKind): number => Math.max(0, hero.items.findIndex((i) => i.kind === kind));
      const augments = ['speed', 'damage', 'evasion', 'defense', 'none'] as const;
      switch (rng.int(4)) {
        case 0: return { type: 'augment', item: of('weightstone'), on: rng.int(2) === 0 ? 'weapon' : 'armor', augment: rng.oneOf(augments) };
        case 1: return { type: 'shoot', item: of('spiritBow'), target };
        case 2: return { type: 'tip', item: of('missile.dart'), seed: hero.items.findIndex((i) => i.kind.startsWith('seed.')), all: rng.int(2) === 0 };
        default: return { type: 'clean', item, all: rng.int(2) === 0 };
      }
    }
    case 11: return hero.pos === level.exit ? { type: 'descend' } : { type: 'move', to: hero.pos + rng.element(NEIGHBOURS8)! };
    case 12: return { type: 'faceCurse' };
    case 13: return { type: 'remove', ring: 0 };
    case 14: return { type: 'sell', item };
    default: return { type: 'wait' };
  }
}

describe('chaos', () => {
  it('random play with every kind of item never breaks the world', () => {
    const accepted: Record<string, number> = {};
    for (let seed = 1; seed <= 24; seed++) {
      const rng = Rng.seeded(seed * 7919);
      const world = createWorld(seed);
      addHero(world, { id: 'a', name: 'A', heroClass: (['warrior', 'mage', 'rogue', 'huntress'] as const)[seed % 4]! });
      addHero(world, { id: 'b', name: 'B', heroClass: (['warrior', 'mage', 'rogue', 'huntress'] as const)[(seed + 1) % 4]! });
      // Start some runs deeper, to meet the later monsters and rooms.
      const depth = 1 + (seed % 6) * 4;
      for (const id of ['a', 'b']) {
        const hero = heroById(world, id)!;
        levelAt(world, depth);
        hero.depth = depth;
        const entrance = levelAt(world, depth).entrance;
        hero.pos = id === 'a' ? entrance : NEIGHBOURS8.map((n) => entrance + n).find((c) => canEnter(levelAt(world, depth), c) && !charAt(world, depth, c))!;
        hero.time = floorAt(world, depth).now;
        stock(world, id, rng);
      }
      for (let step = 0; step < 800 && !world.over; step++) {
        const id = step % 2 === 0 ? 'a' : 'b';
        if (!isAlive(heroById(world, id)!)) continue;
        const action = randomAction(world, id, rng);
        try {
          if (act(world, id, action).ok) accepted[action.type] = (accepted[action.type] ?? 0) + 1;
          unblock(world, (who, a) => act(world, who, a as Action));
          checkInvariants(world);
        } catch (error) {
          throw new Error(`seed ${seed}, step ${step}, ${id}: ${JSON.stringify(action)}: ${(error as Error).stack}`);
        }
      }
    }
    // Every kind of action got through at least now and then.
    for (const type of ['move', 'attack', 'use', 'throw', 'zap', 'equip', 'drop', 'pickup', 'beacon', 'augment', 'shoot', 'tip']) expect(accepted[type], type).toBeGreaterThan(0);
  }, 60000);

  it('a world saved as JSON in the middle of chaos carries on exactly like the original', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const rng = Rng.seeded(seed * 104729);
      const world = createWorld(seed);
      addHero(world, { id: 'a', name: 'A', heroClass: (['warrior', 'mage', 'rogue', 'huntress'] as const)[seed % 4]! });
      addHero(world, { id: 'b', name: 'B', heroClass: (['mage', 'huntress', 'warrior', 'rogue'] as const)[seed % 4]! });
      const depth = 1 + (seed % 6) * 4;
      for (const id of ['a', 'b']) {
        const hero = heroById(world, id)!;
        hero.depth = depth;
        const entrance = levelAt(world, depth).entrance;
        hero.pos = id === 'a' ? entrance : NEIGHBOURS8.map((n) => entrance + n).find((c) => canEnter(levelAt(world, depth), c) && !charAt(world, depth, c))!;
        hero.time = floorAt(world, depth).now;
        stock(world, id, rng);
      }
      let copy: World | null = null;
      for (let step = 0; step < 500 && !world.over; step++) {
        // Halfway through, the world goes through a save and a load (or over the wire, to a co-op replica).
        if (step === 250) copy = JSON.parse(JSON.stringify(world)) as World;
        const id = step % 2 === 0 ? 'a' : 'b';
        if (!isAlive(heroById(world, id)!)) continue;
        const action = randomAction(world, id, rng);
        for (const w of copy ? [world, copy] : [world]) {
          act(w, id, action);
          unblock(w, (who, a) => act(w, who, a as Action));
        }
      }
      if (copy) expect(JSON.stringify(copy), `seed ${seed}`).toBe(JSON.stringify(world));
    }
  }, 60000);
});
