import { describe, expect, it } from 'vitest';
import {
  act, addHero, canEnter, CHALLENGES, createMob, createWorld, DARKNESS, floorAt, heroById, heroView, isChallenged,
  type Item, ItemGenerator, itemDef, levelAt, NEIGHBOURS8, NO_ARMOR, NO_FOOD, NO_HEALING, NO_HERBALISM, NO_SCROLLS, restartWorld,
  mobRotation, Rng, rollMob, SWARM_INTELLIGENCE, T, viewDistance, WIDTH, type World,
} from '../src/index';
import { pacify } from './helpers';

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
  it("are the original seven and Shattered's hostile champions, with their masks, kept by the world and through a restart", () => {
    expect(CHALLENGES.map((c) => [c.id, c.mask])).toEqual([
      ['noFood', 1], ['noArmor', 2], ['noHealing', 4], ['noHerbalism', 8], ['swarm', 16], ['darkness', 32], ['noScrolls', 64],
      ['champions', 128],
    ]);
    const world = createWorld(1, NO_FOOD | DARKNESS);
    expect(isChallenged(world, NO_FOOD)).toBe(true);
    expect(isChallenged(world, NO_ARMOR)).toBe(false);
    addHero(world, { id: 'p', name: 'P', heroClass: 'mage' });
    restartWorld(world, 2);
    expect(world.challenges).toBe(NO_FOOD | DARKNESS);
    expect(world.heroes).toHaveLength(1);
    expect(createWorld(1).challenges).toBe(0);
    // A world saved before challenges existed has none.
    const old = JSON.parse(JSON.stringify(createWorld(3))) as World;
    delete (old as Partial<World>).challenges;
    expect(isChallenged(old, NO_FOOD)).toBe(false);
  });

  it('on diet: no food lies about or is sold, only its worth in gold; the hero still sets out with a ration', () => {
    const items = floorItems(NO_FOOD, 7);
    expect(items.some((item) => category(item) === 'food')).toBe(false);
    expect(floorItems(0, 7).some((item) => category(item) === 'food')).toBe(true);
    const world = solo(NO_FOOD);
    const hero = heroById(world, 'p')!;
    const ration = hero.items.findIndex((item) => item.kind === 'food.ration');
    expect(ration).toBeGreaterThanOrEqual(0);
    // Dropped, it comes down as gold (Level.drop: new Gold(item.price())).
    act(world, 'p', { type: 'drop', item: ration });
    const heap = floorAt(world, 1).heaps.find((h) => h.pos === hero.pos)!;
    expect(heap.items[0]).toMatchObject({ kind: 'gold', qty: 10 });
  });

  it('faith is my armor: no armour anywhere', () => {
    expect(floorItems(NO_ARMOR, 7).some((item) => category(item) === 'armor')).toBe(false);
    expect(floorItems(0, 7).some((item) => category(item) === 'armor')).toBe(true);
    expect(heroById(solo(NO_ARMOR), 'p')!.armor.kind).toBe('armor.cloth');
  });

  it('pharmacophobia: no potion of healing on the floor or in the shops; other potions still', () => {
    const items = floorItems(NO_HEALING, 7);
    expect(items.some((item) => item.kind === 'potion.healing')).toBe(false);
    expect(items.some((item) => category(item) === 'potion')).toBe(true);
    // The shop of depth 6 always has one for sale: here gold lies in its place.
    const world = createWorld(1, NO_HEALING);
    const wares = floorAt(world, 6).heaps.filter((heap) => heap.kind === 'forSale').flatMap((heap) => heap.items);
    expect(wares.length).toBeGreaterThan(0);
    expect(wares.some((item) => item.kind === 'gold')).toBe(true);
  });

  it('barren land: tall grass sheds no dew, and no seed pouch is sold', () => {
    const items = floorItems(NO_HERBALISM, 7);
    expect(items.some((item) => item.kind === 'bag.seeds')).toBe(false);
    expect(floorItems(0, 7).some((item) => item.kind === 'bag.seeds')).toBe(true);
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
    // Challenges.isItemBlocked: only the dew (Shattered's grass still sheds seeds; they just will not grow).
    expect(floorAt(world, 1).heaps.some((heap) => heap.pos === grass && heap.items.some((i) => i.kind === 'dew'))).toBe(false);
  });

  it('forbidden runes: of all scrolls only upgrade can be found; no scroll holder either', () => {
    const items = floorItems(NO_SCROLLS, 12);
    const scrolls = items.filter((item) => category(item) === 'scroll');
    expect(scrolls.length).toBeGreaterThan(0);
    expect(scrolls.every((item) => item.kind === 'scroll.upgrade')).toBe(true);
    expect(items.some((item) => item.kind === 'bag.scrolls')).toBe(false);
    expect(floorItems(0, 12).some((item) => category(item) === 'scroll' && item.kind !== 'scroll.upgrade')).toBe(true);
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
  it('into darkness: heroes see three cells (four by torchlight) where the level is not darker anyway', () => {
    expect(viewDistance(1, true)).toBe(3);
    expect(viewDistance(20, true)).toBe(3);
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
      expect(Math.max(...cells(dark).map((c) => distance(c, hero.pos)))).toBeLessThanOrEqual(3);
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
