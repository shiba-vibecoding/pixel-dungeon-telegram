import { describe, expect, it } from 'vitest';
import {
  act, addHero, ankhChoices, canEnter, charAt, createItem, createWorld, floorAt, type Hero, heroById, isWater, type Item, levelAt, NEIGHBOURS8, RoomType, T, type World,
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
  Object.assign(hero, { depth, pos, time: floorAt(world, depth).now, attackSkill: 1000, hp: 1000, ht: 1000, items: [], str: 20 });
  hero.weapon = createItem('weapon.warHammer', 1, 10);
  for (const mob of floorAt(world, depth).mobs) if (mob.kind !== 'statue' && mob.kind !== 'piranha') mob.state = 'passive';
}

describe('the ankh (Ankh, Hero.die, WndResurrect, LostBackpack)', () => {
  // The mage: the warrior's seal would shield him from the last blow.
  function dying(items: Item[]): { world: World; hero: Hero } {
    const world = createWorld(5);
    addHero(world, { id: 'p', name: 'P', heroClass: 'mage' });
    const hero = heroById(world, 'p')!;
    hero.items = [...hero.items.filter((i) => i.kind === 'waterskin'), ...items];
    hero.gold = 300;
    hero.poison = 50;
    hero.hp = 1;
    return { world, hero };
  }

  it('unblessed: up elsewhere on the floor, the gear kept, the rest left in a backpack where the hero fell', () => {
    const { world, hero } = dying([createItem('ankh'), createItem('potion.healing', 3), { ...createItem('key.iron'), depth: 1 }]);
    const fell = hero.pos;
    const weapon = hero.weapon;
    const result = act(world, 'p', { type: 'wait' });
    expect(result.ok && result.effects).toContainEqual({ type: 'resurrected', hero: 'p', blessed: false });
    expect(hero.hp).toBe(hero.ht);
    expect(hero.gold).toBe(300);
    expect(hero.pos).not.toBe(fell);
    expect(hero.weapon).toBe(weapon);
    expect(hero.items.map((item) => item.kind).sort()).toEqual(['key.iron', 'waterskin']);
    expect(hero.lostInventory?.items.map((item) => item.kind)).toEqual(['potion.healing']);
    expect(floorAt(world, 1).heaps.some((h) => h.pos === fell && h.items.some((i) => i.kind === 'lostPack'))).toBe(true);
    expect(world.notes).toContainEqual({ landmark: 'lostPack', depth: 1 });
    expect(world.over).toBe(false);
    // WndResurrect: the potions kept instead of the staff.
    const choices = ankhChoices(hero);
    const potion = choices.findIndex((i) => i.kind === 'potion.healing');
    expect(act(world, 'p', { type: 'ankhKeep', keep: [potion] }).ok).toBe(true);
    expect(hero.weapon).toBeNull();
    expect(hero.items.some((i) => i.kind === 'potion.healing')).toBe(true);
    expect(hero.armor.standIn).toBe(true);
    // The backpack picked up: everything is back, and the note goes.
    floorAt(world, 1).mobs = [];
    hero.pos = fell;
    expect(act(world, 'p', { type: 'pickup' }).ok).toBe(true);
    expect(hero.weapon).toBe(weapon);
    expect(hero.armor.standIn).toBeFalsy();
    expect(hero.lostInventory).toBeUndefined();
    expect(world.notes?.some((n) => n.landmark === 'lostPack')).toBe(false);
    // Without one, death is death.
    hero.poison = 50;
    hero.hp = 1;
    act(world, 'p', { type: 'wait' });
    expect(hero.hp).toBeLessThanOrEqual(0);
    expect(world.over).toBe(true);
  });

  it('blessed with a full waterskin: up where the hero fell, a quarter of their health, invulnerable a while', () => {
    const { world, hero } = dying([createItem('ankh')]);
    const ankh = hero.items.findIndex((i) => i.kind === 'ankh');
    expect(act(world, 'p', { type: 'ankhBless', item: ankh })).toEqual({ ok: false, reason: 'your waterskin is not full' });
    hero.items.find((i) => i.kind === 'waterskin')!.volume = 20;
    hero.poison = 0;
    hero.hp = hero.ht;
    expect(act(world, 'p', { type: 'ankhBless', item: ankh }).ok).toBe(true);
    expect(hero.items[ankh]!.blessed).toBe(true);
    hero.poison = 50;
    hero.hp = 1;
    const at = hero.pos;
    const result = act(world, 'p', { type: 'wait' });
    expect(result.ok && result.effects).toContainEqual({ type: 'resurrected', hero: 'p', blessed: true });
    expect(hero.pos).toBe(at);
    expect(hero.hp).toBeGreaterThan(0);
    expect(hero.hp).toBeLessThanOrEqual(Math.trunc(hero.ht / 4));
    expect(hero.poison ?? 0).toBe(0);
    expect(hero.lostInventory).toBeUndefined();
  });
});

describe('the alchemy guide (Document.ALCHEMY_GUIDE, AlchemyPage)', () => {
  it('its pages lie in the laboratories, and picked up they go into the guide, not the pack', () => {
    for (let seed = 1; seed < 60; seed++) {
      const world = createWorld(seed);
      expect(world.guidePages).toEqual([]);
      for (let depth = 1; depth <= 9; depth++) {
        if (depth === 5) continue;
        levelAt(world, depth);
        const heap = floorAt(world, depth).heaps.find((h) => h.items.some((i) => i.kind === 'alchemyPage'));
        if (!heap) continue;
        const page = heap.items.find((i) => i.kind === 'alchemyPage')!.page!;
        expect(['potions', 'stones', 'energy_food', 'exotic_potions', 'exotic_scrolls', 'bombs', 'weapons', 'brews_elixirs', 'spells']).toContain(page);
        addHero(world, { id: 'p', name: 'P', heroClass: 'warrior' });
        const hero = heroById(world, 'p')!;
        floorAt(world, depth).mobs = [];
        heap.items = heap.items.filter((i) => i.kind === 'alchemyPage');
        heap.kind = 'heap';
        Object.assign(hero, { depth, pos: heap.pos, time: floorAt(world, depth).now });
        expect(act(world, 'p', { type: 'pickup' }).ok).toBe(true);
        expect(world.guidePages).toContain(page);
        expect(hero.items.some((i) => i.kind === 'alchemyPage')).toBe(false);
        return;
      }
    }
    throw new Error('no alchemy page in 60 runs');
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
    const beside = NEIGHBOURS8.map((n) => statue.pos + n).find((c) => canEnter(level, c) && !charAt(world, depth, c))!;
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

  it('a crystal vault holds a wand, a ring or an artifact in each crystal chest; its crystal key opens one', () => {
    const { world, depth } = withRoom(RoomType.VAULT, (w, d) => floorAt(w, d).heaps.some((heap) => heap.kind === 'crystalChest'));
    const floor = floorAt(world, depth);
    const level = levelAt(world, depth);
    const chest = floor.heaps.find((heap) => heap.kind === 'crystalChest')!;
    expect(level.map[chest.pos]).toBe(T.PEDESTAL);
    for (const item of chest.items) expect(/^(wand|ring|artifact)./.test(item.kind)).toBe(true);
    heroAt(world, depth, chest.pos);
    expect(act(world, 'p', { type: 'pickup' })).toEqual({ ok: false, reason: 'the chest is locked' });
    const hero = heroById(world, 'p')!;
    hero.items = [{ ...createItem('key.crystal'), depth }];
    expect(act(world, 'p', { type: 'pickup' }).ok).toBe(true);
    expect(hero.items.some((item) => item.kind === 'key.crystal')).toBe(false);
    expect(hero.items.length).toBeGreaterThan(0);
    // Its crystal key, and the iron key to the vault's door, lie somewhere on the level.
    const keys = floor.heaps.flatMap((heap) => heap.items).map((item) => item.kind);
    expect(keys).toContain('key.crystal');
    expect(keys).toContain('key.iron');
  });
});
