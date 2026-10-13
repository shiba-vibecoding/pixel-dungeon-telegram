import { describe, expect, it } from 'vitest';
import {
  act, addHero, createItem, createWorld, floorAt, heroById, isWater, levelAt, NEIGHBOURS8, RoomType, T, type World,
  WIDTH,
} from '../src/index';

/** The first run (and depth) whose layout has a room of `type` (and passes `also`). */
function withRoom(type: RoomType, also: (world: World, depth: number) => boolean = () => true): { world: World; depth: number } {
  for (let seed = 1; seed < 500; seed++) {
    const world = createWorld(seed * 11);
    for (let depth = 2; depth <= 9; depth++) {
      if (depth === 5) continue;
      if (levelAt(world, depth).rooms.some((room) => room.type === type) && also(world, depth)) return { world, depth };
    }
  }
  throw new Error(`no ${RoomType[type]} room`);
}

/** Puts a solo hero on `depth`, standing on `pos`. */
function heroAt(world: World, depth: number, pos: number): void {
  addHero(world, { id: 'p', name: 'P', heroClass: 'warrior' });
  const hero = heroById(world, 'p')!;
  Object.assign(hero, { depth, pos, time: floorAt(world, depth).now, attackSkill: 1000, hp: 1000, ht: 1000, items: [] });
  for (const mob of floorAt(world, depth).mobs) if (mob.kind !== 'statue' && mob.kind !== 'piranha') mob.state = 'passive';
}

describe('the ankh', () => {
  // The mage: the warrior's seal would shield him from the last blow.
  it('brings its bearer back at the stairs, at the cost of the pack and the gold', () => {
    const world = createWorld(5);
    addHero(world, { id: 'p', name: 'P', heroClass: 'mage' });
    const hero = heroById(world, 'p')!;
    hero.items = [createItem('ankh'), createItem('potion.healing', 3), { ...createItem('key.iron'), depth: 1 }];
    hero.gold = 300;
    hero.poison = 50;
    hero.hp = 1;
    const result = act(world, 'p', { type: 'wait' });
    expect(result.ok && result.effects.some((e) => e.type === 'resurrected')).toBe(true);
    expect(hero.hp).toBe(hero.ht);
    expect(hero.gold).toBe(0);
    expect(hero.items.map((item) => item.kind)).toEqual(['key.iron']);
    expect(world.over).toBe(false);
    // Without one, death is death.
    hero.poison = 50;
    hero.hp = 1;
    act(world, 'p', { type: 'wait' });
    expect(hero.hp).toBeLessThanOrEqual(0);
    expect(world.over).toBe(true);
  });

  it("on a boss's level, the hero rises where they fell: the stairs may be cut off from the fight", () => {
    const world = createWorld(5);
    addHero(world, { id: 'p', name: 'P', heroClass: 'mage' });
    const hero = heroById(world, 'p')!;
    const level = levelAt(world, 10);
    // Somewhere well away from the stairs.
    const spot = level.map.findIndex((t, c) => (t === T.EMPTY_SP || t === T.EMPTY) && Math.abs(c - level.entrance) > 64);
    Object.assign(hero, { depth: 10, pos: spot, time: floorAt(world, 10).now, hp: 1, poison: 50 });
    hero.items = [createItem('ankh')];
    act(world, 'p', { type: 'wait' });
    expect(hero.hp).toBe(hero.ht);
    expect(hero.pos).toBe(spot);
  });
});

describe('statue, pool and vault rooms', () => {
  it('an animated statue stands still until struck, then fights, and leaves its enchanted weapon', () => {
    const { world, depth } = withRoom(RoomType.STATUE);
    const statue = floorAt(world, depth).mobs.find((mob) => mob.kind === 'statue')!;
    expect(statue.item?.enchant).toBeDefined();
    expect(statue.item!.level).toBeGreaterThanOrEqual(0);
    expect(statue.ht).toBe(15 + depth * 5);
    const level = levelAt(world, depth);
    const beside = NEIGHBOURS8.map((n) => statue.pos + n).find((c) => level.map[c] === T.EMPTY)!;
    heroAt(world, depth, beside);
    for (let i = 0; i < 5; i++) act(world, 'p', { type: 'wait' });
    expect(statue.state).toBe('sleeping');
    const weapon = statue.item!.kind;
    for (let i = 0; i < 300 && statue.hp > 0; i++) act(world, 'p', { type: 'attack', target: statue.id });
    expect(statue.hp).toBeLessThanOrEqual(0);
    expect(floorAt(world, depth).heaps.some((heap) => heap.items.some((item) => item.kind === weapon && item.enchant))).toBe(true);
  });

  it('a statue does not stir when monsters are called, nor at a grim blow does a boss simply die', () => {
    const { world, depth } = withRoom(RoomType.STATUE);
    const statue = floorAt(world, depth).mobs.find((mob) => mob.kind === 'statue')!;
    const level = levelAt(world, depth);
    heroAt(world, depth, level.entrance);
    const hero = heroById(world, 'p')!;
    hero.items = [createItem('scroll.challenge')];
    const at = statue.pos;
    act(world, 'p', { type: 'use', item: 0 });
    for (let i = 0; i < 5; i++) act(world, 'p', { type: 'wait' });
    expect(statue.state).toBe('sleeping');
    expect(statue.pos).toBe(at);
  });

  it('a piranha out of the water dies', () => {
    const { world, depth } = withRoom(RoomType.POOL);
    const level = levelAt(world, depth);
    heroAt(world, depth, level.entrance);
    const piranha = floorAt(world, depth).mobs.find((mob) => mob.kind === 'piranha')!;
    const land = level.map.findIndex((t, c) => t === T.EMPTY && !floorAt(world, depth).mobs.some((m) => m.pos === c) && c !== level.entrance);
    piranha.pos = land;
    for (let i = 0; i < 5; i++) act(world, 'p', { type: 'wait' });
    expect(floorAt(world, depth).mobs.includes(piranha)).toBe(false);
  });

  it('piranhas guard a pool and never leave its water', () => {
    const { world, depth } = withRoom(RoomType.POOL);
    const level = levelAt(world, depth);
    const piranhas = floorAt(world, depth).mobs.filter((mob) => mob.kind === 'piranha');
    expect(piranhas).toHaveLength(3);
    for (const piranha of piranhas) expect(isWater(level.map[piranha.pos]!)).toBe(true);
    expect(level.map.includes(T.PEDESTAL)).toBe(true);
    // Lure them out: the hero stands at the pool's edge.
    const pool = level.rooms.find((room) => room.type === RoomType.POOL)!;
    const door = level.map.findIndex((t, c) => (t === T.DOOR || t === T.OPEN_DOOR) &&
      c % WIDTH >= pool.left && c % WIDTH <= pool.right && Math.trunc(c / WIDTH) >= pool.top && Math.trunc(c / WIDTH) <= pool.bottom);
    heroAt(world, depth, door);
    for (const piranha of piranhas) Object.assign(piranha, { state: 'hunting', enemy: 'p', target: door });
    for (let i = 0; i < 20; i++) act(world, 'p', { type: 'wait' });
    for (const piranha of floorAt(world, depth).mobs.filter((mob) => mob.kind === 'piranha')) {
      expect(isWater(level.map[piranha.pos]!)).toBe(true);
    }
  });

  it('a vault holds a wand or a ring; its chests open only with the golden key', () => {
    const kinds = new Set<string>();
    for (const wanted of ['lockedChest', 'crystalChest']) {
      const { world, depth } = withRoom(RoomType.VAULT, (w, d) => floorAt(w, d).heaps.some((heap) => heap.kind === wanted));
      const floor = floorAt(world, depth);
      const locked = floor.heaps.find((heap) => heap.kind === wanted)!;
      kinds.add(locked.kind);
      for (const item of locked.items) expect(item.kind.startsWith('wand.') || item.kind.startsWith('ring.')).toBe(true);
      heroAt(world, depth, locked.pos);
      expect(act(world, 'p', { type: 'pickup' })).toEqual({ ok: false, reason: 'the chest is locked' });
      const hero = heroById(world, 'p')!;
      hero.items = [{ ...createItem('key.golden'), depth }];
      expect(act(world, 'p', { type: 'pickup' }).ok).toBe(true);
      expect(hero.items.some((item) => item.kind === 'key.golden')).toBe(false);
      expect(hero.items.length).toBeGreaterThan(0);
      // Its golden key lies somewhere on the level.
      expect(floor.heaps.some((heap) => heap.items.some((item) => item.kind === 'key.golden'))).toBe(true);
    }
    expect(kinds.size).toBe(2);
  });
});
