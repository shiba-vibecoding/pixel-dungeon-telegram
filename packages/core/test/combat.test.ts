import { describe, expect, it } from 'vitest';
import {
  act, type Action, Feeling, addHero, armorStats, baseKind, blockers, canEnter, charAt, createItem, createMob, createWorld, type Effect,
  distance, F, floorAt, hasFlag, heroById, isAlive, type ItemKind, levelAt, MOBS, NEIGHBOURS8, Rng, rollMob, RoomType, T, weaponStats,
  type World,
  WIDTH,
} from '../src/index';
import { botAction, checkInvariants, pacify, unblock } from './helpers';

/** Plays one hero with the bot until it reaches depth 4, dies or runs out of moves. */
function playSolo(seed: number, heroClass: 'warrior' | 'mage' | 'rogue' | 'huntress', limit = 3000) {
  const world = createWorld(seed);
  addHero(world, { id: 'p', name: 'P', heroClass });
  const effects: Effect[] = [];
  let actions = 0;
  for (; actions < limit; actions++) {
    const hero = heroById(world, 'p')!;
    if (!isAlive(hero) || hero.depth === 4) break;
    const result = act(world, 'p', botAction(world, 'p'));
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (result.ok) effects.push(...result.effects);
    checkInvariants(world);
  }
  return { world, effects, actions };
}

/** A free cell next to `pos` that a monster could stand on. */
function freeNeighbour(world: World, depth: number, pos: number): number {
  const level = levelAt(world, depth);
  return NEIGHBOURS8.map((n) => pos + n).find(
    (cell) => canEnter(level, cell) && hasFlag(level.map[cell]!, F.PASSABLE) && !charAt(world, depth, cell),
  )!;
}

describe('monsters', () => {
  it('populate sewer levels as the bestiary says, asleep in standard rooms, away from the entrance', () => {
    // Bestiary.mob: never a rare variant at first; now and then a visitor from the prison below.
    const allowed: Record<number, string[]> = {
      1: ['rat'], 2: ['rat', 'gnoll'], 3: ['rat', 'gnoll', 'crab', 'swarm'], 4: ['rat', 'gnoll', 'crab', 'swarm', 'skeleton', 'thief'],
    };

    for (let seed = 1; seed <= 25; seed++) {
      const world = createWorld(seed);
      for (let depth = 1; depth <= 4; depth++) {
        const level = levelAt(world, depth);
        // The sad ghost may haunt one level besides its monsters, and special rooms have guardians of their own.
        const mobs = floorAt(world, depth).mobs.filter((mob) => mob.kind !== 'ghost' && mob.kind !== 'statue' && mob.kind !== 'piranha' && mob.kind !== 'sentry' && mob.kind !== 'bee');
        // RegularLevel.createMobs: eight on the first depth, then mobLimit: 3 + depth % 5, and up to two more.
        const base = depth === 1 ? 8 : 3 + (depth % 5);
        // A third more on a large level.
        const large = level.feeling === Feeling.LARGE;
        expect(mobs.length).toBeGreaterThanOrEqual(large ? Math.ceil(base * 1.33) : base);
        expect(mobs.length, `${seed} ${depth} ${level.feeling} ${mobs.map((m) => m.kind + m.pos)}`).toBeLessThanOrEqual(depth === 1 ? 8 : large ? Math.ceil((base + 2) * 1.33) : base + 2);
        expect(new Set(mobs.map((m) => m.pos)).size).toBe(mobs.length);
        for (const mob of mobs) {
          expect(allowed[depth]).toContain(mob.kind);
          expect(mob.state).toBe('sleeping');
          expect(hasFlag(level.map[mob.pos]!, F.PASSABLE)).toBe(true);
          // Never in sight of the entrance, nor within eight steps of it.
          expect(distance(mob.pos, level.entrance)).toBeGreaterThan(1);
        }
      }
    }
  });

  it('use the original weapons, armour and stats', () => {
    const stats = (kind: ItemKind, level = 0) => weaponStats(createItem(kind, 1, level));
    // The warrior's, as Shattered's worn shortsword: ten strength.
    expect(stats('weapon.shortSword')).toMatchObject({ min: 1, max: 10, str: 10 });
    expect(stats('weapon.dagger')).toMatchObject({ min: 1, max: 8, str: 10 });
    expect(stats('weapon.knuckles')).toMatchObject({ min: 1, max: 5, delay: 0.5 });
    expect(stats('weapon.mace')).toMatchObject({ min: 3, max: 12, str: 14 });
    // 30 / 1.2f is 24.99999 in Java's float arithmetic: the war hammer tops out at 24.
    expect(stats('weapon.warHammer')).toMatchObject({ min: 5, max: 24, str: 18 });
    // Upgrades raise damage and lower the strength needed.
    expect(stats('weapon.sword', 2)).toMatchObject({ min: 5, max: 22, str: 12 });
    expect(armorStats(createItem('armor.mail', 1, 1))).toEqual({ dr: 9, str: 12 });
    expect(MOBS.crab).toMatchObject({ ht: 15, speed: 2, dr: 4 });
  });
});

describe('fighting through the sewers', () => {
  it('a bot hero kills monsters, levels up and goes deep, keeping every invariant', () => {
    let deep = 0;
    let kills = 0;
    for (const [seed, heroClass] of [[11, 'warrior'], [12, 'mage'], [13, 'rogue'], [14, 'huntress'], [15, 'warrior'], [16, 'warrior']] as const) {
      const { world, effects } = playSolo(seed, heroClass);
      const hero = heroById(world, 'p')!;
      if (hero.depth >= 3) deep++;
      kills += effects.filter((e) => e.type === 'died' && e.who.startsWith('#')).length;
      if (effects.some((e) => e.type === 'levelUp')) {
        expect(hero.lvl).toBeGreaterThan(1);
        expect(hero.ht).toBe((heroClass === 'huntress' ? 15 : 20) + (hero.lvl - 1) * 5);
      }
      const mobDeaths = effects.filter((e) => e.type === 'died' && e.who.startsWith('#')).length;
      expect(hero.kills).toBeLessThanOrEqual(mobDeaths);
      if (!isAlive(hero)) {
        expect(world.over).toBe(true);
        expect(effects.at(-1)).toMatchObject({ type: 'died', who: 'p' });
        expect(hero.killedBy).toBeTruthy();
      }
    }
    // Shattered's depths are bigger and fuller, and this bot heads straight for the stairs, fighting only
    // what stands in its way: few of them get far, but some must.
    expect(kills).toBeGreaterThan(5);
    expect(deep).toBeGreaterThan(0);
  });

  it('is deterministic and survives a JSON round trip mid-fight', () => {
    const a = playSolo(2024, 'warrior', 400).world;
    const b = playSolo(2024, 'warrior', 400).world;
    expect(b).toEqual(a);

    const copy: World = JSON.parse(JSON.stringify(a));
    for (let i = 0; i < 300 && isAlive(heroById(a, 'p')!); i++) {
      const action = botAction(a, 'p');
      expect(act(copy, 'p', action)).toEqual(act(a, 'p', action));
    }
    expect(copy).toEqual(a);
  });

  it('finds hidden doors by searching next to them', () => {
    let checked = 0;
    for (let seed = 1; seed <= 40 && checked < 3; seed++) {
      const world = pacify(createWorld(seed));
      const depth = [2, 3, 4].find((d) => levelAt(world, d).map.includes(T.SECRET_DOOR));
      if (!depth) continue;
      const level = levelAt(world, depth);
      const door = level.map.indexOf(T.SECRET_DOOR);
      addHero(world, { id: 'p', name: 'P', heroClass: 'warrior' });
      const hero = heroById(world, 'p')!;
      hero.depth = depth;
      hero.pos = NEIGHBOURS8.map((n) => door + n).find((cell) => canEnter(level, cell))!;
      const result = act(world, 'p', { type: 'search' });
      expect(level.map[door]).toBe(T.DOOR);
      expect(result.ok && result.effects).toContainEqual({ type: 'discovered', depth, cell: door });
      expect(hero.time).toBe(2);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('rejects attacks on monsters out of reach and moves into them', () => {
    const world = createWorld(5);
    addHero(world, { id: 'p', name: 'P', heroClass: 'warrior' });
    const mob = floorAt(world, 1).mobs[0]!;
    expect(act(world, 'p', { type: 'attack', target: mob.id })).toEqual({ ok: false, reason: 'too far away' });
    expect(act(world, 'p', { type: 'attack', target: '#999' })).toEqual({ ok: false, reason: 'no such enemy' });
    const hero = heroById(world, 'p')!;
    mob.pos = freeNeighbour(world, 1, hero.pos);
    expect(act(world, 'p', { type: 'move', to: mob.pos })).toEqual({ ok: false, reason: 'cell is occupied' });
  });
});

describe('co-op turns', () => {
  function partyWithRat(): { world: World; rat: ReturnType<typeof createMob> } {
    const world = pacify(createWorld(3));
    addHero(world, { id: 'alice', name: 'Alice', heroClass: 'warrior' });
    addHero(world, { id: 'bob', name: 'Bob', heroClass: 'mage' });
    const bob = heroById(world, 'bob')!;
    const rat = createMob('#100', 'rat', freeNeighbour(world, 1, bob.pos), 'hunting', 0);
    rat.enemy = 'bob';
    floorAt(world, 1).mobs.push(rat);
    return { world, rat };
  }

  it('a hero in danger holds the others up until they act', () => {
    const { world } = partyWithRat();
    const alice = heroById(world, 'alice')!;
    const bob = heroById(world, 'bob')!;
    // Alice goes first; then it is Bob's turn and he sees the rat.
    expect(act(world, 'alice', { type: 'wait' }).ok).toBe(true);
    expect(alice.time).toBe(1);
    expect(act(world, 'alice', { type: 'wait' }).ok).toBe(true);
    expect(alice.intent).toEqual({ type: 'wait' });
    expect(blockers(world)).toEqual(['bob']);

    // Bob acts: the rat takes its turn and Alice's queued action happens.
    const result = act(world, 'bob', { type: 'wait' });
    expect(result.ok).toBe(true);
    expect(alice.intent).toBeNull();
    expect(alice.time).toBe(2);
    expect(bob.time).toBe(1);
    expect(result.ok && result.effects.some((e) => e.type === 'attack' && e.attacker === '#100')).toBe(true);
    expect(blockers(world)).toEqual([]);
  });

  it('an idle hero out of danger rests while a companion explores', () => {
    const world = pacify(createWorld(4));
    addHero(world, { id: 'alice', name: 'Alice', heroClass: 'warrior' });
    addHero(world, { id: 'bob', name: 'Bob', heroClass: 'rogue' });
    for (let i = 0; i < 5; i++) expect(act(world, 'alice', { type: 'wait' }).ok).toBe(true);
    expect(heroById(world, 'alice')!.time).toBe(5);
    expect(heroById(world, 'bob')!.time).toBe(4);
    expect(blockers(world)).toEqual([]);
  });

  it('fallen heroes get back up when a companion goes deeper', () => {
    const { world, rat } = partyWithRat();
    const bob = heroById(world, 'bob')!;
    bob.hp = 1;
    const play = (id: string, action: Action) => act(world, id, action);
    for (let i = 0; i < 500 && isAlive(bob); i++) {
      play('bob', { type: 'wait' });
      unblock(world, play);
    }
    expect(isAlive(bob)).toBe(false);
    expect(world.over).toBe(false);
    expect(act(world, 'bob', { type: 'wait' })).toEqual({ ok: false, reason: 'you are dead' });

    // Alice deals with the rat, then takes the stairs.
    for (let i = 0; i < 2000 && heroById(world, 'alice')!.depth === 1; i++) {
      expect(play('alice', botAction(world, 'alice')).ok).toBe(true);
      checkInvariants(world);
    }
    expect(floorAt(world, 1).mobs).not.toContain(rat);
    expect(heroById(world, 'alice')!.depth).toBe(2);
    expect(bob).toMatchObject({ depth: 2, hp: 10 });
    expect(bob.pos).not.toBe(heroById(world, 'alice')!.pos);
  });
});

describe('rare variants', () => {
  it('one monster in thirty of some kinds is a worse version of it', () => {
    const rng = Rng.seeded(7);
    let rats = 0;
    let albinos = 0;
    for (let i = 0; i < 6000; i++) {
      const kind = rollMob(rng, 1);
      if (kind === 'rat') rats++;
      if (kind === 'albino') albinos++;
    }
    expect(albinos / (rats + albinos)).toBeGreaterThan(0.02);
    expect(albinos / (rats + albinos)).toBeLessThan(0.05);
    expect(baseKind('bandit')).toBe('thief');
    expect(baseKind('rat')).toBe('rat');
  });

  it('an albino rat leaves its victim bleeding; an acidic scorpio burns whoever strikes it', () => {
    const world = pacify(createWorld(3));
    addHero(world, { id: 'p', name: 'P', heroClass: 'warrior' });
    const hero = heroById(world, 'p')!;
    Object.assign(hero, { hp: 1000, ht: 1000, defenseSkill: 0, attackSkill: 1000 });
    const albino = createMob('#albino', 'albino', freeNeighbour(world, 1, hero.pos), 'hunting', floorAt(world, 1).now);
    Object.assign(albino, { enemy: 'p', target: hero.pos, enemySeen: true, hp: 1000, ht: 1000 });
    floorAt(world, 1).mobs.push(albino);
    let bled = false;
    for (let i = 0; i < 40 && !bled; i++) {
      act(world, 'p', { type: 'wait' });
      bled = (hero.bleeding ?? 0) > 0;
    }
    expect(bled).toBe(true);

    floorAt(world, 1).mobs = [];
    const acidic = createMob('#acidic', 'acidic', freeNeighbour(world, 1, hero.pos), 'sleeping', floorAt(world, 1).now);
    Object.assign(acidic, { hp: 100000, ht: 100000 });
    floorAt(world, 1).mobs.push(acidic);
    const before = hero.hp;
    for (let i = 0; i < 10; i++) act(world, 'p', { type: 'attack', target: '#acidic' });
    expect(hero.hp).toBeLessThan(before);
  });
});

describe('dwarf monks', () => {
  it("may knock the weapon out of the hero's hands, who then fights bare-handed", () => {
    const world = pacify(createWorld(4));
    addHero(world, { id: 'p', name: 'P', heroClass: 'warrior' });
    const hero = heroById(world, 'p')!;
    Object.assign(hero, { hp: 5000, ht: 5000, defenseSkill: 0 });
    const monk = createMob('#monk', 'monk', freeNeighbour(world, 1, hero.pos), 'hunting', floorAt(world, 1).now);
    Object.assign(monk, { enemy: 'p', target: hero.pos, enemySeen: true, hp: 100000, ht: 100000 });
    floorAt(world, 1).mobs.push(monk);
    const sword = hero.weapon!;
    for (let i = 0; i < 200 && hero.weapon; i++) act(world, 'p', { type: 'wait' });
    expect(hero.weapon).toBeNull();
    const heap = floorAt(world, 1).heaps.find((h) => h.pos === hero.pos)!;
    expect(heap.items).toContain(sword);
    // Bare fists still strike.
    expect(act(world, 'p', { type: 'attack', target: '#monk' }).ok).toBe(true);
    // Picked up and wielded again, nothing is lost.
    floorAt(world, 1).mobs = [];
    act(world, 'p', { type: 'pickup' });
    const index = hero.items.indexOf(sword);
    expect(act(world, 'p', { type: 'equip', item: index }).ok).toBe(true);
    expect(hero.weapon).toBe(sword);
    expect(hero.items).not.toContain(sword);
  });
});