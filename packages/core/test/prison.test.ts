import { describe, expect, it } from 'vitest';
import {
  act, type Action, addHero, adjacent, canEnter, charAt, createItem, createMob, createWorld, type Effect, findPath,
  floorAt, heroById, isAlive, levelAt, type Mob, type MobKind, NEIGHBOURS8, RoomType, T, WIDTH, type World,
} from '../src/index';
import { botAction, checkInvariants, pacify, skeletonKey } from './helpers';

/** A hero on the given depth with no monsters around, ready to meet one. */
function at(depth: number, seed = 3): World {
  const world = createWorld(seed);
  for (let d = 1; d <= depth; d++) levelAt(world, d);
  pacify(world);
  floorAt(world, depth).mobs = [];
  floorAt(world, depth).respawn = 1e9;
  addHero(world, { id: 'p', name: 'P', heroClass: 'warrior' });
  const hero = heroById(world, 'p')!;
  hero.depth = depth;
  const level = levelAt(world, depth);
  hero.pos = level.entrance;
  hero.time = floorAt(world, depth).now;
  return world;
}

/** A monster of `kind` right next to the hero, after it. */
function besides(world: World, kind: MobKind): Mob {
  const hero = heroById(world, 'p')!;
  const level = levelAt(world, hero.depth);
  const pos = NEIGHBOURS8.map((n) => hero.pos + n).find((c) => canEnter(level, c) && !charAt(world, hero.depth, c))!;
  const mob = createMob(`#${kind}`, kind, pos, 'hunting', floorAt(world, hero.depth).now);
  Object.assign(mob, { enemy: 'p', target: hero.pos, enemySeen: true });
  floorAt(world, hero.depth).mobs.push(mob);
  return mob;
}

describe('the prison', () => {
  it('is populated by its own monsters', () => {
    const kinds = new Set<string>();
    for (let seed = 1; seed <= 15; seed++) {
      const world = createWorld(seed);
      for (let depth = 1; depth <= 9; depth++) levelAt(world, depth);
      for (let depth = 6; depth <= 9; depth++) {
        for (const mob of floorAt(world, depth).mobs) kinds.add(mob.kind);
      }
      expect(floorAt(world, 10).mobs, 'Tengu waits for the arena').toEqual([]);
    }
    for (const kind of ['skeleton', 'thief', 'swarm', 'shaman']) expect(kinds).toContain(kind);
    expect(kinds).not.toContain('rat');
  });

  it('thieves steal from the pack and run; the loot drops where they die', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const world = at(6, seed);
      const hero = heroById(world, 'p')!;
      hero.items = [createItem('potion.healing', 3)];
      hero.defenseSkill = 0;
      const thief = besides(world, 'thief');
      let stole: Effect | undefined;
      for (let i = 0; i < 20 && !stole; i++) {
        const result = act(world, 'p', { type: 'wait' });
        stole = result.ok ? result.effects.find((e) => e.type === 'stole') : undefined;
      }
      if (!stole) continue;
      expect(hero.items).toHaveLength(0);
      expect(thief.item).toMatchObject({ kind: 'potion.healing', qty: 3 });
      expect(['fleeing', 'hunting']).toContain(thief.state);
      thief.hp = 1;
      const pos = thief.pos;
      hero.pos = NEIGHBOURS8.map((n) => pos + n).find((c) => canEnter(levelAt(world, 6), c) && !charAt(world, 6, c))!;
      hero.attackSkill = 1000;
      act(world, 'p', { type: 'attack', target: thief.id });
      if (floorAt(world, 6).mobs.includes(thief)) continue;
      expect(floorAt(world, 6).heaps.some((h) => h.items.some((i) => i.kind === 'potion.healing' && i.qty === 3))).toBe(true);
      return;
    }
    throw new Error('the thief never stole');
  });

  it('a struck swarm of flies splits in two', () => {
    const world = at(6);
    const hero = heroById(world, 'p')!;
    hero.attackSkill = 1000;
    const swarm = besides(world, 'swarm');
    for (let i = 0; i < 10 && floorAt(world, 6).mobs.length === 1; i++) act(world, 'p', { type: 'attack', target: swarm.id });
    const swarms = floorAt(world, 6).mobs.filter((m) => m.kind === 'swarm');
    expect(swarms.length).toBeGreaterThan(1);
    expect(swarms.some((s) => s.generation === 1)).toBe(true);
    expect(swarms.reduce((sum, s) => sum + s.hp, 0)).toBeLessThanOrEqual(80);
  });

  it('a skeleton falls apart in an explosion of bones', () => {
    const world = at(6);
    const hero = heroById(world, 'p')!;
    Object.assign(hero, { attackSkill: 1000, ht: 100, hp: 100 });
    const skeleton = besides(world, 'skeleton');
    skeleton.hp = 1;
    const result = act(world, 'p', { type: 'attack', target: skeleton.id });
    expect(result.ok && result.effects.some((e) => e.type === 'bones')).toBe(true);
    expect(result.ok && result.effects.some((e) => e.type === 'hurt' && e.who === 'p')).toBe(true);
  });

  it('a shaman strikes with lightning from afar', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const world = at(7, seed);
      const hero = heroById(world, 'p')!;
      const level = levelAt(world, 7);
      // Somewhere two or three steps away in a straight line.
      const far = [2, 3].flatMap((k) => NEIGHBOURS8.map((n) => hero.pos + n * k)).find(
        (c) => canEnter(level, c) && level.map[c] !== T.DOOR && canEnter(level, (c + hero.pos) / 2) && !charAt(world, 7, c),
      );
      if (far === undefined || !Number.isInteger((far + hero.pos) / 2)) continue;
      const shaman = createMob('#shaman', 'shaman', far, 'hunting', floorAt(world, 7).now);
      Object.assign(shaman, { enemy: 'p', target: hero.pos, enemySeen: true });
      floorAt(world, 7).mobs.push(shaman);
      const effects: Effect[] = [];
      for (let i = 0; i < 6; i++) {
        const result = act(world, 'p', { type: 'search' });
        if (result.ok) effects.push(...result.effects);
      }
      const bolt = effects.find((e) => e.type === 'zapped' && e.bolt === 'lightning');
      if (!bolt) continue;
      expect(effects.some((e) => e.type === 'attack' && e.attacker === '#shaman')).toBe(true);
      return;
    }
    throw new Error('the shaman never cast');
  });

  it('a brute flies into a rage when badly hurt; a bat heals as it bites', () => {
    const world = at(9);
    const hero = heroById(world, 'p')!;
    Object.assign(hero, { attackSkill: 1000, ht: 1000, hp: 1000, defenseSkill: 0 });
    hero.weapon = createItem('weapon.knuckles');
    const brute = besides(world, 'brute');
    brute.hp = 11;
    let enraged = false;
    for (let i = 0; i < 20 && isAlive(brute) && !enraged; i++) {
      const result = act(world, 'p', { type: 'attack', target: brute.id });
      enraged = result.ok && result.effects.some((e) => e.type === 'enraged');
    }
    expect(enraged || !isAlive(brute)).toBe(true);
    if (enraged) expect(brute.enraged).toBe(true);

    floorAt(world, 9).mobs = [];
    const bat = besides(world, 'bat');
    bat.hp = 10;
    for (let i = 0; i < 20 && bat.hp <= 10; i++) act(world, 'p', { type: 'wait' });
    expect(bat.hp).toBeGreaterThan(10);
  });
});

describe('the old wandmaker', () => {
  it('waits by the entrance of one of depths 7-9 and trades a wand for what he is after', () => {
    let met = 0;
    let fish = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const world = createWorld(seed);
      for (let d = 1; d <= 9; d++) levelAt(world, d);
      const quest = world.wandQuest;
      if (!quest) continue;
      met++;
      expect(quest.depth).toBeGreaterThanOrEqual(7);
      expect(quest.battle.kind.startsWith('wand.')).toBe(true);
      expect(quest.battle.level).toBeGreaterThanOrEqual(1);
      const floor = floorAt(world, quest.depth);
      const wandmaker = floor.mobs.find((m) => m.kind === 'wandmaker')!;
      floor.mobs = [wandmaker];
      addHero(world, { id: 'p', name: 'P', heroClass: 'rogue' });
      const hero = heroById(world, 'p')!;
      const level = levelAt(world, quest.depth);
      hero.depth = quest.depth;
      hero.time = floor.now;
      hero.pos = NEIGHBOURS8.map((n) => wandmaker.pos + n).find((c) => canEnter(level, c) && !charAt(world, quest.depth, c))!;

      Object.assign(hero, { hp: 500, ht: 500 });
      const intro = act(world, 'p', { type: 'attack', target: wandmaker.id });
      expect(intro.ok && intro.effects).toEqual([{ type: 'wandmaker', hero: 'p', line: 'intro' }]);
      expect(act(world, 'p', { type: 'wandReward', choice: 'battle' })).toEqual({ ok: false, reason: 'nothing to give' });
      const back = hero.pos;
      if (quest.wants === 'berry') {
        // The rotberry: step on the shrub, and take its seed (the walk itself is not the point here).
        const shrub = floor.plants!.find((p) => p.kind === 'rotberry')!;
        hero.pos = NEIGHBOURS8.map((n) => shrub.pos + n).find((c) => canEnter(level, c) && !charAt(world, quest.depth, c))!;
        expect(act(world, 'p', { type: 'move', to: shrub.pos }).ok).toBe(true);
        expect(act(world, 'p', { type: 'pickup' }).ok).toBe(true);
        expect(hero.items.some((i) => i.kind === 'seed.rotberry')).toBe(true);
      } else if (quest.wants === 'fish') {
        // The phantom fish hides in the water: only a search right beside it turns it up.
        fish++;
        const pond = floor.heaps.find((h) => h.items.some((i) => i.kind === 'quest.fish'))!;
        if (pond.kind === 'hidden') {
          hero.pos = pond.pos;
          expect(act(world, 'p', { type: 'pickup' })).toEqual({ ok: false, reason: 'nothing here' });
          hero.pos = NEIGHBOURS8.map((n) => pond.pos + n).find((c) => canEnter(level, c) && !charAt(world, quest.depth, c))!;
          act(world, 'p', { type: 'search' });
          expect(pond.kind).toBe('heap');
        }
        hero.pos = pond.pos;
        expect(act(world, 'p', { type: 'pickup' }).ok).toBe(true);
      } else {
        // Fetch the dust (the walk itself is not the point here).
        const pile = floor.heaps.find((h) => h.items.some((i) => i.kind === 'quest.dust'));
        expect(pile?.kind).toBe('skeleton');
        hero.pos = pile!.pos;
        expect(act(world, 'p', { type: 'pickup' }).ok).toBe(true);
      }
      hero.pos = back;
      const reward = act(world, 'p', { type: 'attack', target: wandmaker.id });
      expect(reward.ok && reward.effects).toEqual([{ type: 'wandmaker', hero: 'p', line: 'reward' }]);
      const wand = act(world, 'p', { type: 'wandReward', choice: 'battle' });
      expect(wand.ok && wand.effects.at(-1)).toEqual({ type: 'wandmaker', hero: 'p', line: 'farewell' });
      expect(hero.items.some((i) => i.kind === quest.battle.kind)).toBe(true);
      expect(hero.items.some((i) => i.kind === 'quest.dust')).toBe(false);
      expect(world.known).toContain(quest.battle.kind);
      expect(floor.mobs.some((m) => m.kind === 'wandmaker')).toBe(false);
    }
    expect(met).toBeGreaterThan(15);
    expect(fish).toBeGreaterThan(0);
  });
});

describe('the shop on depth 6', () => {
  function shopWorld(seed: number): { world: World; keeper: Mob } {
    const world = at(6, seed);
    const keeper = floorAt(world, 6).mobs.find((m) => m.kind === 'shopkeeper');
    // `at` clears the monsters; put the shopkeeper back where he stands.
    const level = levelAt(world, 6);
    const shopkeeper = keeper ?? createMob('#keeper', 'shopkeeper', level.shopkeeper!, 'passive', 0);
    if (!keeper) floorAt(world, 6).mobs.push(shopkeeper);
    return { world, keeper: shopkeeper };
  }

  it('is always there, with the shopkeeper among his wares', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const world = createWorld(seed);
      for (let d = 1; d <= 6; d++) levelAt(world, d);
      const wares = floorAt(world, 6).heaps.filter((h) => h.kind === 'forSale');
      // ShopRoom's rare ware comes in one shop in ten of three (a wand, a ring or an artifact).
      expect(wares.length === 15 || wares.length === 16, `seed ${seed}: ${wares.length}`).toBe(true);
      expect(wares.some((h) => h.items[0]!.kind === 'bag.seeds'), `seed ${seed}`).toBe(true);
      expect(wares.some((h) => h.items[0]!.kind === 'weightstone'), `seed ${seed}`).toBe(true);
      expect(wares.some((h) => h.items[0]!.kind === 'ankh'), `seed ${seed}`).toBe(true);
      expect(floorAt(world, 6).mobs.filter((m) => m.kind === 'shopkeeper'), `seed ${seed}`).toHaveLength(1);
    }
  });

  it('sells its wares for gold, and buys from the pack', () => {
    const { world, keeper } = shopWorld(5);
    const hero = heroById(world, 'p')!;
    const ware = floorAt(world, 6).heaps.find((h) => h.kind === 'forSale')!;
    hero.pos = ware.pos;
    expect(act(world, 'p', { type: 'pickup' })).toEqual({ ok: false, reason: 'that is for sale' });
    hero.gold = 1;
    expect(act(world, 'p', { type: 'buy' })).toEqual({ ok: false, reason: 'not enough gold' });
    hero.gold = 5000;
    const item = ware.items[0]!;
    const result = act(world, 'p', { type: 'buy' });
    expect(result.ok && result.effects.find((e) => e.type === 'bought')).toMatchObject({ item: { kind: item.kind } });
    expect(hero.gold).toBeLessThan(5000);
    expect(floorAt(world, 6).heaps.includes(ware)).toBe(false);

    // Selling needs the shopkeeper close by.
    hero.items = [createItem('weapon.sword', 1, 1)];
    const level = levelAt(world, 6);
    hero.pos = NEIGHBOURS8.map((n) => keeper.pos + n).find((c) => canEnter(level, c) && !charAt(world, 6, c))!;
    const gold = hero.gold;
    const sale = act(world, 'p', { type: 'sell', item: 0 });
    // A tier 3 sword +1: 80 gold, twice over.
    expect(sale.ok && sale.effects.find((e) => e.type === 'sold')).toMatchObject({ price: 160 });
    expect(hero.gold).toBe(gold + 160);
    expect(hero.items).toHaveLength(0);
    // Talking to him opens his trade.
    const talk = act(world, 'p', { type: 'attack', target: keeper.id });
    expect(talk.ok && talk.effects).toEqual([{ type: 'shop', hero: 'p' }]);
  });

  it('the shopkeeper vanishes with his wares when attacked', () => {
    const { world, keeper } = shopWorld(6);
    const hero = heroById(world, 'p')!;
    const level = levelAt(world, 6);
    hero.pos = NEIGHBOURS8.map((n) => keeper.pos + n).find((c) => canEnter(level, c) && !charAt(world, 6, c))!;
    hero.items = [createItem('missile.dart', 5)];
    hero.attackSkill = 1000;
    const result = act(world, 'p', { type: 'throw', item: 0, target: keeper.pos });
    expect(result.ok && result.effects.some((e) => e.type === 'shopkeeperFled')).toBe(true);
    expect(floorAt(world, 6).heaps.some((h) => h.kind === 'forSale')).toBe(false);
    expect(floorAt(world, 6).mobs.some((m) => m.kind === 'shopkeeper')).toBe(false);
  });
});

describe("Tengu's prison", () => {
  /** A strong scripted hero: to the key, through the arena door, Tengu, then the exit. */
  function bossAction(world: World): Action {
    const hero = heroById(world, 'p')!;
    const level = levelAt(world, 10);
    const floor = floorAt(world, 10);
    const tengu = floor.mobs.find((m) => m.kind === 'tengu');
    if (tengu && adjacent(tengu.pos, hero.pos)) return { type: 'attack', target: tengu.id };
    const skeleton = tengu ? null : skeletonKey(world, 'p');
    if (skeleton) return skeleton;
    const key = hero.items.some((i) => i.kind === 'key.iron');
    const chest = floor.heaps.find((h) => h.items.some((i) => i.kind === 'key.iron'));
    if (chest && hero.pos === chest.pos) return { type: 'pickup' };
    const arena = level.rooms.find((r) => r.type === RoomType.BOSS_EXIT)!;
    const middle = Math.trunc((arena.left + arena.right) / 2) + Math.trunc((arena.top + arena.bottom) / 2) * WIDTH;
    let goal: number;
    if (chest) goal = chest.pos;
    else if (tengu) goal = tengu.pos;
    else if (!floor.arenaEntered) goal = key ? level.arenaDoor! : middle;
    else goal = level.exit;
    if (hero.pos === level.exit) return { type: 'descend' };
    const others = new Set(floor.mobs.map((m) => m.pos));
    others.delete(goal);
    const path = findPath(level, hero.pos, goal, others);
    if (!path || path.length === 0) return { type: 'wait' };
    const blocker = floor.mobs.find((m) => m.pos === path![0]);
    return blocker ? { type: 'attack', target: blocker.id } : { type: 'move', to: path[0]! };
  }

  it('Tengu appears in the arena, seals it, and falling opens the way down to the caves', () => {
    let won = 0;
    for (const seed of [2, 3, 4]) {
      const world = at(10, seed);
      const hero = heroById(world, 'p')!;
      Object.assign(hero, { attackSkill: 300, defenseSkill: 40, ht: 5000, hp: 5000, str: 18 });
      hero.weapon = createItem('weapon.longsword', 1, 3);
      const level = levelAt(world, 10);
      const effects: Effect[] = [];
      for (let i = 0; i < 4000 && !world.over && hero.depth === 10; i++) {
        const action = bossAction(world);
        let result = act(world, 'p', action);
        if (!result.ok) result = act(world, 'p', { type: 'wait' });
        if (result.ok) effects.push(...result.effects);
        checkInvariants(world);
      }
      const types = new Set(effects.map((e) => e.type));
      expect(types.has('yell'), `seed ${seed}`).toBe(true);
      expect(effects.some((e) => e.type === 'arena' && e.sealed), `seed ${seed}`).toBe(true);
      expect(types.has('bossSlain'), `seed ${seed}`).toBe(true);
      expect(effects.some((e) => e.type === 'arena' && !e.sealed), `seed ${seed}`).toBe(true);
      expect(hero.depth, `seed ${seed}`).toBe(11);
      expect(world.over, `seed ${seed}`).toBe(false);
      won++;
    }
    expect(won).toBe(3);
  });

  it('in a party, the arena locks only once everyone is inside', () => {
    const world = at(10, 4);
    addHero(world, { id: 'q', name: 'Q', heroClass: 'mage' });
    const [p, q] = [heroById(world, 'p')!, heroById(world, 'q')!];
    const level = levelAt(world, 10);
    const arena = level.rooms.find((r) => r.type === RoomType.BOSS_EXIT)!;
    const door = level.arenaDoor!;
    level.map[door] = T.DOOR;
    const inside = NEIGHBOURS8.map((n) => door + n).find(
      (c) => canEnter(level, c) && c % WIDTH > arena.left && c % WIDTH < arena.right &&
        Math.trunc(c / WIDTH) > arena.top && Math.trunc(c / WIDTH) < arena.bottom,
    )!;
    const inArena = (c: number): boolean =>
      c % WIDTH > arena.left && c % WIDTH < arena.right && Math.trunc(c / WIDTH) > arena.top && Math.trunc(c / WIDTH) < arena.bottom;
    const outside = NEIGHBOURS8.map((n) => door + n).find((c) => canEnter(level, c) && !inArena(c))!;
    q.depth = 10;
    Object.assign(p, { pos: door, time: floorAt(world, 10).now, hp: 500, ht: 500 });
    Object.assign(q, { pos: outside, time: floorAt(world, 10).now, hp: 500, ht: 500 });
    act(world, 'p', { type: 'move', to: inside });
    expect(floorAt(world, 10).arenaEntered).toBe(true);
    expect(floorAt(world, 10).mobs.some((m) => m.kind === 'tengu')).toBe(true);
    // Q is still outside: the way in stays open for them.
    expect(level.map[door]).not.toBe(T.LOCKED_DOOR);
    // In a fight, turns alternate: P waits while Q comes in.
    for (let i = 0; i < 10 && q.pos !== door; i++) {
      act(world, 'q', { type: 'move', to: door });
      act(world, 'p', { type: 'wait' });
    }
    expect(q.pos).toBe(door);
    for (let i = 0; i < 10 && q.pos === door; i++) {
      const further = NEIGHBOURS8.map((n) => door + n).find((c) => canEnter(level, c) && !charAt(world, 10, c) && inArena(c))!;
      act(world, 'q', { type: 'move', to: further });
      act(world, 'p', { type: 'wait' });
    }
    expect(inArena(q.pos)).toBe(true);
    expect(level.map[door]).toBe(T.LOCKED_DOOR);
  });

  it('nor while a companion is still upstairs, who could never get in after', () => {
    const world = at(10, 4);
    addHero(world, { id: 'q', name: 'Q', heroClass: 'mage' });
    const p = heroById(world, 'p')!;
    const level = levelAt(world, 10);
    const arena = level.rooms.find((r) => r.type === RoomType.BOSS_EXIT)!;
    const door = level.arenaDoor!;
    level.map[door] = T.DOOR;
    const inArena = (c: number): boolean =>
      c % WIDTH > arena.left && c % WIDTH < arena.right && Math.trunc(c / WIDTH) > arena.top && Math.trunc(c / WIDTH) < arena.bottom;
    const inside = NEIGHBOURS8.map((n) => door + n).find((c) => canEnter(level, c) && inArena(c))!;
    Object.assign(p, { pos: door, time: floorAt(world, 10).now, hp: 500, ht: 500 });
    act(world, 'p', { type: 'move', to: inside });
    for (let i = 0; i < 5; i++) {
      const further = NEIGHBOURS8.map((n) => p.pos + n).find((c) => canEnter(level, c) && !charAt(world, 10, c) && inArena(c))!;
      act(world, 'p', { type: 'move', to: further });
    }
    expect(floorAt(world, 10).mobs.some((m) => m.kind === 'tengu')).toBe(true);
    expect(level.map[door]).not.toBe(T.LOCKED_DOOR);
  });

  it('a simple bot can play through the prison without breaking anything', () => {
    for (const seed of [11, 12]) {
      const world = at(6, seed);
      const hero = heroById(world, 'p')!;
      Object.assign(hero, { attackSkill: 200, defenseSkill: 30, ht: 3000, hp: 3000 });
      for (let i = 0; i < 6000 && isAlive(hero) && hero.depth < 10; i++) {
        const result = act(world, 'p', botAction(world, 'p', 10));
        if (!result.ok) act(world, 'p', { type: 'wait' });
        checkInvariants(world);
      }
      expect(hero.depth, `seed ${seed}`).toBe(10);
    }
  });
});
