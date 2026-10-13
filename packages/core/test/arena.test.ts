import { describe, expect, it } from 'vitest';
import {
  act, type Action, addHero, adjacent, ARENA_CENTRE, ARENA_DEPTHS, arenaRemaining, arenaScore, canEnter, createItem, createWorld,
  type Effect, exploredCells, findPath, floorAt, heroById, type HeroClass, hostile, insideArena, isAlive, levelAt, LENGTH, NEIGHBOURS8,
  HEIGHT, restartWorld, T, WIDTH, type World,
} from '../src/index';
import { buildArenaLevel } from '../src/level/arena';
import { ascii } from './ascii';
import { arenaBot, strengthen } from './arena-bot';
import { checkInvariants } from './helpers';

/*
 * The arena of waves: its map, the flow of a wave (gates, spawns, the last
 * monster, rest, rewards), champions' waves, sinking a region deeper, the end,
 * and bots playing many waves alone and in a party.
 */

function arenaWorld(seed = 7, classes: HeroClass[] = ['warrior']): World {
  const world = createWorld(seed, 0, 'arena');
  classes.forEach((heroClass, i) => addHero(world, { id: i === 0 ? 'p' : `q${i}`, name: `H${i}`, heroClass }));
  return world;
}

/** Cells reachable on foot from a cell, through doors (and the gates, when `gates`). */
function reachable(world: World, depth: number, from: number, gates = false): Set<number> {
  const level = levelAt(world, depth);
  const seen = new Set([from]);
  const queue = [from];
  for (let head = 0; head < queue.length; head++) {
    for (const n of NEIGHBOURS8) {
      const next = queue[head]! + n;
      if (seen.has(next) || next < 0 || next >= LENGTH || !adjacent(queue[head]!, next)) continue;
      if (!canEnter(level, next) && !(gates && level.map[next] === T.LOCKED_DOOR)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return seen;
}

describe('the Pit of Yendor', () => {
  it('is a closed octagon with a dais, four gated pens, and no stairs', () => {
    const world = arenaWorld();
    const hero = heroById(world, 'p')!;
    const level = levelAt(world, hero.depth);
    expect(hero.depth).toBe(ARENA_DEPTHS[0]);
    expect(level.map[ARENA_CENTRE]).toBe(T.PEDESTAL);
    expect(level.entrance).toBe(ARENA_CENTRE);
    expect(level.map.includes(T.ENTRANCE) || level.map.includes(T.EXIT)).toBe(false);
    expect(canEnter(level, level.exit)).toBe(false);
    expect(level.region).toBe(0);
    const ring = level.ring!;
    expect(ring.gates.map((g) => level.map[g])).toEqual([T.LOCKED_DOOR, T.LOCKED_DOOR, T.LOCKED_DOOR, T.LOCKED_DOOR]);
    // From the dais: the whole arena and the corridors, but not the pens while the gates are shut.
    const open = reachable(world, hero.depth, ARENA_CENTRE);
    for (const pen of ring.pens) for (const cell of pen) expect(open.has(cell)).toBe(false);
    for (const cell of open) expect(insideArena(cell)).toBe(true);
    expect(open.size).toBeGreaterThan(400);
    // Through the gates, every pen.
    const all = reachable(world, hero.depth, ARENA_CENTRE, true);
    for (const pen of ring.pens) for (const cell of pen) expect(all.has(cell)).toBe(true);
    // Everything is on the map from the start.
    expect(exploredCells(world, hero.depth)[ring.pens[0]![0]!]).toBe(true);
    // No stairs to take, no chasm to jump.
    expect(act(world, 'p', { type: 'descend' })).toMatchObject({ ok: false });
    expect(act(world, 'p', { type: 'ascend' })).toMatchObject({ ok: false });
    expect(act(world, 'p', { type: 'jump', to: hero.pos + 1 })).toMatchObject({ ok: false });
  });

  it('keeps its shape, inside the grid and away from its edge, in every tier and for any party', () => {
    for (const depth of ARENA_DEPTHS) {
      const level = buildArenaLevel(3, depth);
      const map = ascii(level.map);
      const rows = map.split('\n');
      // Nothing but rock on the grid's border, and the level within the solo span of 32 from the middle.
      expect(rows[0]!.replace(/#/g, '')).toBe('');
      expect(rows.at(-1)!.replace(/#/g, '')).toBe('');
      for (const row of rows) expect(row[0] === '#' && row.at(-1) === '#').toBe(true);
      // Symmetric cover: the walls and statues mirror left to right.
      const solid = (t: number): boolean => t === T.WALL || t === T.STATUE;
      for (let y = 0; y < HEIGHT; y++) {
        for (let dx = 1; dx <= 12; dx++) {
          const x = ARENA_CENTRE % WIDTH;
          expect(solid(level.map[y * WIDTH + x + dx]!), `depth ${depth} row ${y}\n${map}`).toBe(solid(level.map[y * WIDTH + x - dx]!));
        }
      }
    }
    for (const n of [1, 2, 3, 4]) {
      const world = arenaWorld(11, ['warrior', 'mage', 'rogue', 'huntress'].slice(0, n) as HeroClass[]);
      for (const hero of world.heroes) {
        expect(insideArena(hero.pos)).toBe(true);
        expect(Math.abs((hero.pos % WIDTH) - (ARENA_CENTRE % WIDTH))).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('a wave', () => {
  it('starts on «To battle!», comes through the gates over turns, and ends in a rest with rewards', () => {
    const world = arenaWorld(21);
    const effects: Effect[] = [];
    const run = (action: Action): void => {
      const result = act(world, 'p', action);
      expect(result.ok, JSON.stringify(action) + (result.ok ? '' : result.reason)).toBe(true);
      if (result.ok) effects.push(...result.effects);
    };
    expect(world.arena).toMatchObject({ wave: 0, phase: 'rest' });
    // The opening gift: a weapon or armour, a potion of healing, something else to use.
    expect(world.arena!.offers.p).toHaveLength(3);
    expect(world.arena!.offers.p![1]!.kind).toBe('potion.healing');
    run({ type: 'arenaReady' });
    // Readying skips the gift.
    expect(world.arena!.offers.p).toBeUndefined();
    expect(world.arena).toMatchObject({ wave: 1, phase: 'fight' });
    const level = levelAt(world, ARENA_DEPTHS[0]!);
    expect(level.ring!.gates.every((g) => level.map[g] === T.DOOR)).toBe(true);
    expect(effects.find((e) => e.type === 'arenaWave')).toMatchObject({ wave: 1, champions: false, count: 2 });
    expect(arenaRemaining(world)).toBe(2);
    // Nobody has come in yet; over the next turns, they do, through the pens.
    expect(floorAt(world, 1).mobs.length).toBe(0);
    for (let i = 0; i < 12; i++) run({ type: 'wait' });
    const mobs = floorAt(world, 1).mobs;
    expect(mobs.length).toBeGreaterThan(0);
    expect(mobs.every((m) => m.state === 'hunting' && m.enemy === 'p')).toBe(true);
    expect(mobs.every((m) => m.kind === 'rat' || m.kind === 'albino')).toBe(true);
    // A strong hero fights the wave off.
    strengthen(world, 'p');
    for (let i = 0; i < 400 && world.arena!.phase === 'fight'; i++) {
      run(arenaBot(world, 'p'));
      strengthen(world, 'p');
    }
    expect(world.arena).toMatchObject({ wave: 1, phase: 'rest', kills: 2 });
    expect(effects.some((e) => e.type === 'arenaCleared' && e.wave === 1)).toBe(true);
    expect(level.ring!.gates.every((g) => level.map[g] === T.LOCKED_DOOR)).toBe(true);
    // Three rewards to pick from; the pick goes into the pack.
    const offer = world.arena!.offers.p!;
    expect(offer).toHaveLength(3);
    expect(effects.find((e) => e.type === 'arenaOffer')).toMatchObject({ hero: 'p' });
    const before = heroById(world, 'p')!.items.length;
    run({ type: 'arenaPick', choice: 1 });
    expect(world.arena!.offers.p).toBeUndefined();
    const hero = heroById(world, 'p')!;
    expect(hero.items.length + hero.gold).toBeGreaterThanOrEqual(before);
    expect(act(world, 'p', { type: 'arenaPick', choice: 0 })).toMatchObject({ ok: false });
    expect(arenaScore(world, 'p')).toBe(100 + 2 * 5 + hero.lvl * 10);
  });

  it('puts a reward on the dais when the pack is full', () => {
    const world = arenaWorld(5);
    const hero = heroById(world, 'p')!;
    world.arena!.offers.p = [createItem('weapon.sword'), createItem('armor.mail'), createItem('wand.firebolt')];
    world.arena!.wave = 1;
    while (hero.items.length < 20) hero.items.push(createItem('weapon.mace'));
    expect(act(world, 'p', { type: 'arenaPick', choice: 0 })).toMatchObject({ ok: true });
    expect(floorAt(world, hero.depth).heaps.some((h) => h.items.some((i) => i.kind === 'weapon.sword') && insideArena(h.pos))).toBe(true);
  });

  it('every fifth wave brings champions and the region boss, and an upgrade among the rewards', () => {
    const world = arenaWorld(31);
    world.arena!.wave = 4;
    const result = act(world, 'p', { type: 'arenaReady' });
    expect(result.ok && result.effects.find((e) => e.type === 'arenaWave')).toMatchObject({ wave: 5, champions: true, boss: 'goo' });
    expect(world.arena!.spawns.filter((s) => s.boss).map((s) => s.kind)).toEqual(['goo']);
    expect(world.arena!.spawns.filter((s) => !s.boss).every((s) => ['albino', 'crab', 'gnoll'].includes(s.kind))).toBe(true);
    strengthen(world, 'p');
    for (let i = 0; i < 1500 && world.arena!.phase === 'fight'; i++) {
      act(world, 'p', arenaBot(world, 'p'));
      strengthen(world, 'p');
    }
    expect(world.arena!.phase).toBe('rest');
    expect(world.arena!.offers.p!.some((i) => i.kind === 'scroll.upgrade')).toBe(true);
    // No skeleton key: there is nothing for it to open.
    expect(Object.values(world.floors).flatMap((f) => f.heaps).flatMap((h) => h.items).some((i) => i.kind === 'key.skeleton')).toBe(false);
  });

  it('sinks a region deeper after the fifth wave, keeping the party and what lay about safe', () => {
    const world = arenaWorld(41, ['warrior', 'mage']);
    world.arena!.wave = 4;
    for (const id of ['p', 'q1']) act(world, id, { type: 'arenaReady' });
    expect(world.arena!.phase).toBe('fight');
    // Something dropped in the old arena comes down with it.
    floorAt(world, 1).heaps.push({ pos: ARENA_CENTRE + 5, kind: 'heap', items: [createItem('potion.healing')] });
    const effects: Effect[] = [];
    for (let i = 0; i < 4000 && world.arena!.phase === 'fight'; i++) {
      for (const id of ['p', 'q1']) {
        strengthen(world, id);
        const hero = heroById(world, id)!;
        if (!isAlive(hero) || hero.intent) continue;
        const result = act(world, id, arenaBot(world, id));
        if (result.ok) effects.push(...result.effects);
      }
    }
    expect(world.arena!.phase).toBe('rest');
    expect(effects.find((e) => e.type === 'arenaSinks')).toMatchObject({ tier: 1, depth: ARENA_DEPTHS[1] });
    expect(world.arena!.depth).toBe(ARENA_DEPTHS[1]);
    expect(levelAt(world, ARENA_DEPTHS[1]!).region).toBe(1);
    for (const hero of world.heroes) {
      expect(hero.depth).toBe(ARENA_DEPTHS[1]);
      expect(Math.max(Math.abs((hero.pos % WIDTH) - (ARENA_CENTRE % WIDTH)), Math.abs(Math.trunc(hero.pos / WIDTH) - Math.trunc(ARENA_CENTRE / WIDTH)))).toBeLessThanOrEqual(2);
    }
    expect(floorAt(world, ARENA_DEPTHS[1]!).heaps.flatMap((h) => h.items).some((i) => i.kind === 'potion.healing')).toBe(true);
    expect(floorAt(world, 1).heaps.filter((h) => h.kind === 'heap')).toHaveLength(0);
    checkInvariants(world);
  });

  it('brings the fallen back on the dais at half health once the wave is over', () => {
    const world = arenaWorld(51, ['warrior', 'mage']);
    act(world, 'p', { type: 'arenaReady' });
    act(world, 'q1', { type: 'arenaReady' });
    const fallen = heroById(world, 'q1')!;
    fallen.hp = 0;
    for (let i = 0; i < 600 && world.arena!.phase === 'fight'; i++) {
      strengthen(world, 'p');
      act(world, 'p', arenaBot(world, 'p'));
    }
    expect(world.arena!.phase).toBe('rest');
    expect(fallen.hp).toBe(Math.floor(fallen.ht / 2));
    expect(insideArena(fallen.pos)).toBe(true);
    expect(world.arena!.offers.q1).toHaveLength(3);
    // Both must be ready for the next wave; pressed again, «To battle!» is taken back.
    act(world, 'p', { type: 'arenaReady' });
    expect(world.arena!.ready).toEqual(['p']);
    act(world, 'p', { type: 'arenaReady', cancel: true });
    expect(world.arena!.ready).toEqual([]);
    act(world, 'q1', { type: 'arenaReady' });
    expect(world.arena!.phase).toBe('rest');
    act(world, 'p', { type: 'arenaReady' });
    expect(world.arena!).toMatchObject({ phase: 'fight', wave: 2 });
  });

  it('ends the run when every hero has fallen, with the waves reached kept', () => {
    const world = arenaWorld(61);
    world.arena!.wave = 6;
    world.arena!.depth = ARENA_DEPTHS[0]!;
    act(world, 'p', { type: 'arenaReady' });
    const hero = heroById(world, 'p')!;
    hero.hp = 1;
    hero.defenseSkill = 0;
    for (let i = 0; i < 2000 && !world.over; i++) act(world, 'p', { type: 'wait' });
    expect(world.over).toBe(true);
    expect(world.victory).toBe(false);
    expect(world.arena!.wave).toBe(7);
    expect(arenaScore(world, 'p')).toBe(6 * 100 + world.arena!.kills * 5 + hero.lvl * 10);
    // A new run in the same room is an arena again.
    restartWorld(world, 99);
    expect(world.mode).toBe('arena');
    expect(world.arena).toMatchObject({ wave: 0, phase: 'rest' });
    expect(world.heroes).toHaveLength(1);
  });

  it('refuses the beacon\'s return, and its own actions outside the arena', () => {
    const world = arenaWorld(71);
    const hero = heroById(world, 'p')!;
    hero.items.push({ ...createItem('beacon'), returnTo: { depth: 1, pos: ARENA_CENTRE } });
    expect(act(world, 'p', { type: 'beacon', item: hero.items.length - 1, mode: 'return' })).toMatchObject({ ok: false });
    const dungeon = createWorld(5);
    addHero(dungeon, { id: 'p', name: 'P', heroClass: 'mage' });
    expect(act(dungeon, 'p', { type: 'arenaReady' })).toMatchObject({ ok: false });
    expect(dungeon.mode).toBeUndefined();
  });
});

/** Plays an arena run with sturdy bots until `waves` are cleared; returns the world and the trace. */
function playArena(seed: number, classes: HeroClass[], waves: number): { world: World; steps: number; trace: string[]; replay: Array<[string, Action]> } {
  let world = arenaWorld(seed, classes);
  const ids = world.heroes.map((h) => h.id);
  const trace: string[] = [];
  const replay: Array<[string, Action]> = [];
  let steps = 0;
  for (; steps < 60000 && !world.over && !(world.arena!.phase === 'rest' && world.arena!.wave >= waves); steps++) {
    const id = ids[steps % ids.length]!;
    const hero = heroById(world, id)!;
    for (const other of ids) strengthen(world, other);
    if (!isAlive(hero) || hero.intent) continue;
    const action = arenaBot(world, id);
    let result = act(world, id, action);
    replay.push([id, action]);
    if (!result.ok) {
      result = act(world, id, { type: 'wait' });
      replay.push([id, { type: 'wait' }]);
    }
    trace.push(`${id} w${world.arena!.wave} ${world.arena!.phase} left${arenaRemaining(world)} @${hero.pos} ${JSON.stringify(action)} ${result.ok ? 'ok' : result.reason}`);
    if (trace.length > 16) trace.shift();
    checkInvariants(world);
    if (steps % 3000 === 2999) world = JSON.parse(JSON.stringify(world)) as World;
  }
  return { world, steps, trace, replay };
}

describe('bots in the arena', () => {
  it('a sturdy hero alone clears wave after wave without the arena stalling, through Goo, Tengu and DM-300', () => {
    const { world, steps, trace } = playArena(101, ['warrior'], 16);
    const where = `${steps} steps, wave ${world.arena!.wave} ${world.arena!.phase}\n${trace.join('\n')}`;
    expect(world.over, where).toBe(false);
    expect(world.arena, where).toMatchObject({ wave: 16, phase: 'rest', depth: ARENA_DEPTHS[3] });
    expect(world.arena!.kills).toBeGreaterThan(100);
  }, 120000);

  it('a party of three clears twelve waves together', () => {
    const { world, steps, trace } = playArena(202, ['mage', 'rogue', 'huntress'], 12);
    const where = `${steps} steps, wave ${world.arena!.wave} ${world.arena!.phase}\n${trace.join('\n')}`;
    expect(world.arena, where).toMatchObject({ wave: 12, phase: 'rest', depth: ARENA_DEPTHS[2] });
  }, 120000);

  it('reaches the demon halls and keeps going past them', () => {
    const { world, steps, trace } = playArena(303, ['huntress'], 27);
    const where = `${steps} steps, wave ${world.arena!.wave} ${world.arena!.phase}\n${trace.join('\n')}`;
    expect(world.arena, where).toMatchObject({ wave: 27, phase: 'rest', depth: ARENA_DEPTHS[4] });
  }, 240000);

  it('plays the same for the same actions', () => {
    const { world, replay } = playArena(404, ['warrior', 'mage'], 6);
    const again = arenaWorld(404, ['warrior', 'mage']);
    for (const [id, action] of replay) {
      for (const other of ['p', 'q1']) strengthen(again, other);
      act(again, id, action);
    }
    // The bots' strength is set the same way before each action, so the worlds match.
    expect(JSON.stringify(again.arena)).toBe(JSON.stringify(world.arena));
    expect(JSON.stringify(again.heroes)).toBe(JSON.stringify(world.heroes));
  }, 120000);
});
