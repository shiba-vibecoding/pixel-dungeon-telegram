import { describe, expect, it } from 'vitest';
import {
  act, addHero, canEnter, CHALLENGES, createItem, createMob, createWorld, DARKNESS, floorAt, heroById, heroView,
  isChallenged, MAX_CHALLENGES, STRONGER_BOSSES,
  type Item, ItemGenerator, itemDef, levelAt, NEIGHBOURS8, NO_ARMOR, NO_FOOD, NO_HEALING, NO_HERBALISM, NO_SCROLLS, restartWorld,
  mobRotation, Rng, rollMob, SWARM_INTELLIGENCE, T, viewDistance, WIDTH, type World,
} from '../src/index';
import { pacify } from './helpers';
import { heroDrRoll } from '../src/actors';
import { armorDrMax, armorDrMin } from '../src/armor';
import type { Ctx } from '../src/floor';
import { plant } from '../src/plants';

/** Everything lying about (shops' wares and closed containers included) on depths 1..deepest of a few runs. */
function floorItems(challenges: number, deepest: number, seeds = 6): Item[] {
  const items: Item[] = [];
  for (let seed = 1; seed <= seeds; seed++) {
    const world = createWorld(seed, challenges);
    for (let depth = 1; depth <= deepest; depth++) {
      items.push(...floorAt(world, depth).heaps.flatMap((heap) => heap.items));
      // Monsters carry nothing yet, but a mimic holds its chest's treasure.
      items.push(...floorAt(world, depth).mobs.flatMap((mob) => mob.loot ?? []));
    }
  }
  return items;
}

const category = (item: Item): string => itemDef(item.kind).category;

function solo(challenges: number, heroClass: 'warrior' | 'mage' | 'rogue' | 'huntress' = 'warrior'): World {
  const world = pacify(createWorld(5, challenges));
  addHero(world, { id: 'p', name: 'P', heroClass });
  return world;
}

const distance = (a: number, b: number): number =>
  Math.max(Math.abs((a % WIDTH) - (b % WIDTH)), Math.abs(Math.trunc(a / WIDTH) - Math.trunc(b / WIDTH)));

describe('challenges', () => {
  it("are Shattered's nine, in its order, with their masks, kept by the world and through a restart", () => {
    expect(CHALLENGES.map((c) => [c.id, c.mask])).toEqual([
      ['champions', 128], ['strongerBosses', 256], ['noFood', 1], ['noArmor', 2], ['noHealing', 4], ['noHerbalism', 8], ['swarm', 16],
      ['darkness', 32], ['noScrolls', 64],
    ]);
    expect(CHALLENGES.reduce((all, c) => all | c.mask, 0)).toBe(MAX_CHALLENGES);
    expect(STRONGER_BOSSES).toBe(256);
    const world = createWorld(1, NO_FOOD | DARKNESS | STRONGER_BOSSES);
    expect(isChallenged(world, NO_FOOD)).toBe(true);
    expect(isChallenged(world, STRONGER_BOSSES)).toBe(true);
    expect(isChallenged(world, NO_ARMOR)).toBe(false);
    addHero(world, { id: 'p', name: 'P', heroClass: 'mage' });
    restartWorld(world, 2);
    expect(world.challenges).toBe(NO_FOOD | DARKNESS | STRONGER_BOSSES);
    expect(world.heroes).toHaveLength(1);
    expect(createWorld(1).challenges).toBe(0);
    // A world saved before challenges existed has none.
    const old = JSON.parse(JSON.stringify(createWorld(3))) as World;
    delete (old as Partial<World>).challenges;
    expect(isChallenged(old, NO_FOOD)).toBe(false);
  });

  it('nothing is taken off the floor by the challenges, but the dew (Level.drop, Challenges.isItemBlocked)', () => {
    for (const mask of [NO_FOOD, NO_ARMOR, NO_HEALING, NO_HERBALISM]) {
      const items = floorItems(mask, 7);
      expect(items.some((item) => category(item) === 'food'), `food ${mask}`).toBe(true);
      expect(items.some((item) => category(item) === 'armor'), `armor ${mask}`).toBe(true);
      expect(items.some((item) => item.kind === 'potion.healing'), `healing ${mask}`).toBe(true);
      expect(items.some((item) => item.kind === 'bag.seeds'), `pouch ${mask}`).toBe(true);
    }
    // Dropped, a ration is a ration.
    const world = solo(NO_FOOD);
    const hero = heroById(world, 'p')!;
    const ration = hero.items.findIndex((item) => item.kind === 'food.ration');
    act(world, 'p', { type: 'drop', item: ration });
    expect(floorAt(world, 1).heaps.find((h) => h.pos === hero.pos)!.items[0]!.kind).toBe('food.ration');
  });

  it('on diet: food takes a third of the hunger away', () => {
    const eaten = (challenges: number): number => {
      const world = solo(challenges);
      const hero = heroById(world, 'p')!;
      hero.hunger = 400;
      const ration = hero.items.findIndex((item) => item.kind === 'food.ration');
      act(world, 'p', { type: 'use', item: ration });
      return 400 - hero.hunger;
    };
    // (The hours of eating pass on both sides, so the difference is what the challenge takes.)
    const energy = itemDef('food.ration').energy!;
    expect(eaten(0) - eaten(NO_FOOD)).toBe(energy - Math.trunc(energy / 3));
  });

  it('faith is my armor: armour stops far less (Armor.DRMax / DRMin)', () => {
    expect(armorDrMax(createItem('armor.mail', 1, 2), undefined, true)).toBe(1 + 3 + 2);
    expect(armorDrMin(createItem('armor.mail', 1, 2), undefined, true)).toBe(0);
    const rolls = (noArmor: boolean): number => {
      const world = solo(0);
      const hero = heroById(world, 'p')!;
      hero.armor = createItem('armor.plate', 1, 3);
      hero.str = 30;
      const rng = Rng.seeded(5);
      let total = 0;
      for (let i = 0; i < 200; i++) total += heroDrRoll(hero, rng, noArmor);
      return total;
    };
    expect(rolls(true)).toBeLessThan(rolls(false) / 2);
  });

  it('pharmacophobia: healing potions are found, and poison the hero instead of healing', () => {
    expect(floorItems(NO_HEALING, 7).some((item) => item.kind === 'potion.healing')).toBe(true);
    const world = solo(NO_HEALING);
    const hero = heroById(world, 'p')!;
    hero.hp = 1;
    hero.items.push(createItem('potion.healing'));
    act(world, 'p', { type: 'use', item: hero.items.length - 1 });
    expect(hero.poison).toBeGreaterThan(0);
    expect(hero.hp).toBeLessThanOrEqual(1);
  });

  it('barren land: tall grass sheds no dew and no plant takes root, while the pouch is found', () => {
    expect(floorItems(NO_HERBALISM, 7).some((item) => item.kind === 'dew')).toBe(false);
    const world = solo(NO_HERBALISM);
    const hero = heroById(world, 'p')!;
    const level = levelAt(world, 1);
    const home = hero.pos;
    const grass = NEIGHBOURS8.map((n) => home + n).find((c) => canEnter(level, c) && level.map[c] !== T.DOOR)!;
    for (let i = 0; i < 60; i++) {
      level.map[grass] = T.HIGH_GRASS;
      act(world, 'p', { type: 'move', to: grass });
      expect(level.map[grass]).toBe(T.GRASS);
      act(world, 'p', { type: 'move', to: home });
    }
    expect(floorAt(world, 1).heaps.some((heap) => heap.pos === grass && heap.items.some((i) => i.kind === 'dew'))).toBe(false);
    // Level.plant: the ground turns to grass, nothing grows.
    const ctx = { world, depth: 1, level, floor: floorAt(world, 1), rng: Rng.seeded(1), effects: [] } as unknown as Ctx;
    level.map[grass] = T.EMPTY;
    plant(ctx, grass, 'sungrass');
    expect(level.map[grass]).toBe(T.GRASS);
    expect(floorAt(world, 1).plants?.some((p) => p.pos === grass) ?? false).toBe(false);
  });

  it('forbidden runes: every second scroll of upgrade is held back (Level.java), every other scroll is found as ever', () => {
    const upgrades = (challenges: number): number => {
      let total = 0;
      for (let seed = 1; seed <= 6; seed++) {
        const world = createWorld(seed, challenges);
        for (let depth = 1; depth <= 12; depth++) {
          total += floorAt(world, depth).heaps.flatMap((heap) => heap.items).filter((item) => item.kind === 'scroll.upgrade').reduce((n, item) => n + item.qty, 0);
        }
      }
      return total;
    };
    expect(upgrades(NO_SCROLLS)).toBeLessThan(upgrades(0));
    expect(upgrades(NO_SCROLLS)).toBeGreaterThan(upgrades(0) / 3);
    const items = floorItems(NO_SCROLLS, 12);
    expect(items.some((item) => category(item) === 'scroll' && item.kind !== 'scroll.upgrade')).toBe(true);
    expect(items.some((item) => item.kind === 'bag.scrolls')).toBe(true);
  });

  it('swarm intelligence: a monster hunting a hero in sight calls the others near it, further the longer it sees them', () => {
    for (const challenges of [0, SWARM_INTELLIGENCE]) {
      const world = solo(challenges);
      const hero = heroById(world, 'p')!;
      const level = levelAt(world, 1);
      const floor = floorAt(world, 1);
      const seen = heroView(world, hero);
      const beside = NEIGHBOURS8.map((n) => hero.pos + n).find((c) => canEnter(level, c))!;
      const cells = level.map.map((_, c) => c).filter((c) => canEnter(level, c) && !seen[c]);
      const near = cells.find((c) => distance(c, beside) <= 2 && distance(c, hero.pos) > 1);
      const far = cells.filter((c) => distance(c, beside) > 12).slice(0, 1);
      floor.mobs = [
        createMob('#near', 'rat', beside, 'hunting', floor.now),
        ...far.map((pos, i) => createMob(`#far${i}`, 'rat', pos, 'sleeping', floor.now)),
      ];
      Object.assign(floor.mobs[0]!, { enemy: 'p', target: hero.pos, enemySeen: true });
      if (near !== undefined) floor.mobs.push(createMob('#close', 'rat', near, 'sleeping', floor.now));
      hero.hp = hero.ht = 500;
      for (let i = 0; i < 3; i++) act(world, 'p', { type: 'wait' });
      // Mob.processSwarmIntel: the call reaches two cells a turn the hunter keeps its prey in sight, twelve at most.
      for (const mob of floor.mobs.filter((m) => m.id.startsWith('#far'))) expect(mob.state).toBe('sleeping');
      const close = floor.mobs.find((m) => m.id === '#close');
      if (close) expect(close.state === 'sleeping').toBe(!challenges);
    }
  });
  it('into darkness: heroes see two cells (four by torchlight) where the level is not darker anyway', () => {
    expect(viewDistance(1, true)).toBe(2);
    expect(viewDistance(20, true)).toBe(2);
    // The caves and the halls set their own distance after the challenge's default (CavesLevel, HallsLevel).
    expect(viewDistance(12, true)).toBe(6);
    expect(viewDistance(24, true)).toBe(1);
    for (let seed = 1; seed <= 10; seed++) {
      const dark = createWorld(seed, DARKNESS);
      const lit = createWorld(seed);
      const hero = addHero(dark, { id: 'p', name: 'P', heroClass: 'warrior' });
      addHero(lit, { id: 'p', name: 'P', heroClass: 'warrior' });
      const cells = (world: World): number[] =>
        heroView(world, heroById(world, 'p')!).flatMap((seen, c) => (seen ? [c] : []));
      expect(Math.max(...cells(dark).map((c) => distance(c, hero.pos)))).toBeLessThanOrEqual(2);
      expect(cells(dark).length).toBeLessThanOrEqual(cells(lit).length);
      hero.light = 10;
      expect(Math.max(...cells(dark).map((c) => distance(c, hero.pos)))).toBeLessThanOrEqual(4);
    }
    // Somewhere on these runs the darkness hides what plain sight would show.
    const shown = (challenges: number): number => {
      let total = 0;
      for (let seed = 1; seed <= 10; seed++) {
        const world = createWorld(seed, challenges);
        total += heroView(world, addHero(world, { id: 'p', name: 'P', heroClass: 'warrior' })).filter(Boolean).length;
      }
      return total;
    };
    expect(shown(DARKNESS)).toBeLessThan(shown(0));

  });

});


describe('what each class knows from the start (HeroClass.initHero)', () => {
  it('everyone identify; the warrior healing and rage, the mage upgrade and liquid flame, the rogue mapping and invisibility, the huntress mind vision and lullaby', () => {
    const knows = (heroClass: 'warrior' | 'mage' | 'rogue' | 'huntress'): string[] => solo(0, heroClass).known;
    const sets = {
      warrior: ['potion.healing', 'scroll.challenge'],
      mage: ['scroll.upgrade', 'potion.liquidFlame'],
      rogue: ['scroll.mapping', 'potion.invisibility'],
      huntress: ['potion.mindVision', 'scroll.lullaby'],
    } as const;
    for (const [heroClass, own] of Object.entries(sets) as Array<[keyof typeof sets, readonly string[]]>) {
      const known = knows(heroClass);
      expect(known).toContain('scroll.identify');
      for (const kind of own) expect(known, heroClass).toContain(kind);
      // Nothing of the others' (and Pixel Dungeon's warrior's strength no more).
      const potionsAndScrolls = known.filter((kind) => kind.startsWith('potion.') || kind.startsWith('scroll.'));
      expect(potionsAndScrolls.sort(), heroClass).toEqual(['scroll.identify', ...own].sort());
    }
  });
});

describe('Generator and Bestiary odds, as in the original', () => {
  it("wands come from a deck of three of each of Shattered's thirteen, drawn the same whenever they turn up", () => {
    const run = createWorld(9).run;
    const generator = new ItemGenerator(Rng.seeded(9), 5, { run });
    const counts: Record<string, number> = {};
    for (let i = 0; i < 39; i++) {
      const kind = generator.of('wand').kind;
      counts[kind] = (counts[kind] ?? 0) + 1;
    }
    expect(Object.keys(counts)).toHaveLength(13);
    expect(Object.values(counts).every((n) => n === 3)).toBe(true);
    // A new deck once one is spent; the draws depend on the run alone.
    const again = new ItemGenerator(Rng.seeded(1234), 7, { run: createWorld(9).run });
    const first = new ItemGenerator(Rng.seeded(9), 5, { run: createWorld(9).run });
    for (let i = 0; i < 20; i++) expect(again.of('wand').kind).toBe(first.of('wand').kind);
    // Without a run (Generator.randomUsingDefaults), any kind as likely as another.
    const loose = new ItemGenerator(Rng.seeded(3), 5);
    const seen = new Set<string>();
    for (let i = 0; i < 3000; i++) seen.add(loose.of('wand').kind);
    expect(seen.size).toBe(13);
  });

  it("MobSpawner: each depth's rotation, now and then a visitor from the region below, one in fifty of a kind its rare one", () => {
    const seen = (depth: number, mutable: boolean): Set<string> => {
      const rng = Rng.seeded(depth);
      const kinds = new Set<string>();
      for (let i = 0; i < 20000; i++) kinds.add(rollMob(rng, depth, mutable));
      return kinds;
    };
    expect([...seen(1, false)].sort()).toEqual(['rat', 'snake']);
    expect([...seen(3, false)].sort()).toEqual(['crab', 'gnoll', 'rat', 'snake', 'swarm']);
    expect([...seen(4, false)].sort()).toEqual(['crab', 'gnoll', 'slime', 'swarm']);
    expect([...seen(4, true)]).toContain('thief');
    expect([...seen(8, false)].sort()).toEqual(['dm100', 'guard', 'necromancer', 'skeleton', 'thief']);
    expect([...seen(13, false)].sort()).toEqual(['bat', 'blueShaman', 'brute', 'dm200', 'purpleShaman', 'shaman', 'spinner']);
    expect([...seen(16, false)].sort()).toEqual(['chaosElemental', 'elemental', 'frostElemental', 'ghoul', 'shockElemental', 'warlock']);
    expect([...seen(24, false)].sort()).toEqual(['eye', 'scorpio', 'succubus']);
    expect(seen(19, true).has('succubus')).toBe(true);
    expect(seen(1, true).has('albino')).toBe(true);
    expect(seen(1, false).has('albino')).toBe(false);
  });

  it("a rotation is the depth's list (a kind now and then its rare one), shuffled", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const rotation = mobRotation(Rng.seeded(seed), 2).map((kind) => (kind === 'albino' ? 'rat' : kind === 'gnollExile' ? 'gnoll' : kind));
      expect([...rotation].sort()).toEqual(['gnoll', 'gnoll', 'rat', 'rat', 'snake']);
    }
  });
});
