import { describe, expect, it } from 'vitest';
import {
  act, type Action, addHero, adjacent, AMULET_POS, BOTTOM_DOOR, canEnter, cell, charAt, createItem, createWorld, distance, type Effect,
  floorAt, GATE_CELLS, HALLS_EXIT, heroById, isAlive, isFist, levelAt, type Mob, NEIGHBOURS8, PEDESTALS, PYLON_POSITIONS, T,
  TENGU_CELL_DOOR, THRONE, TOP_DOOR, WIDTH, type World, YOG_POS,
} from '../src/index';
import { checkInvariants } from './helpers';

/*
 * Shattered Pixel Dungeon's five boss fights, stage by stage: Goo, Tengu and
 * his prison, DM-300 and its pylons, the Dwarf King and his court, Yog-Dzewa
 * and its fists, and the Amulet's hall below.
 */

/** A sturdy hero standing on a boss's depth, every depth above made and emptied. */
function atBoss(depth: number, seed = 3): World {
  const world = createWorld(seed);
  addHero(world, { id: 'p', name: 'P', heroClass: 'warrior' });
  for (let d = 1; d <= depth; d++) levelAt(world, d);
  for (let d = 1; d < depth; d++) floorAt(world, d).mobs = [];
  const hero = heroById(world, 'p')!;
  Object.assign(hero, { depth, pos: levelAt(world, depth).entrance, time: floorAt(world, depth).now, lvl: 20, ht: 5000, hp: 5000, attackSkill: 1e6, defenseSkill: 1e6 });
  hero.weapon = createItem('weapon.shortSword', 1, 0);
  return world;
}

const hero = (world: World) => heroById(world, 'p')!;
const floorOf = (world: World) => floorAt(world, hero(world).depth);
const mob = (world: World, kind: string): Mob | undefined => floorOf(world).mobs.find((m) => m.kind === kind);

/** Plays an action, keeping the hero whole; the effects it brought. */
function play(world: World, action: Action): Effect[] {
  let result = act(world, 'p', action);
  if (!result.ok) result = act(world, 'p', { type: 'wait' });
  const h = hero(world);
  if (h.hp > 0) h.hp = h.ht;
  h.paralysed = 0;
  h.hunger = 0;
  checkInvariants(world);
  return result.ok ? result.effects : [];
}

/** Steps the hero onto a free cell beside a monster (or a cell), and strikes or waits. */
function besides(world: World, at: number): number {
  const level = levelAt(world, hero(world).depth);
  const free = NEIGHBOURS8.map((n) => at + n).find((c) => canEnter(level, c) && !charAt(world, hero(world).depth, c));
  if (free !== undefined) hero(world).pos = free;
  return hero(world).pos;
}

/** The hero steps to a cell within `reach` of a target, from a cell further off. */
function stepNear(world: World, target: number, reach: number): Effect[] {
  const level = levelAt(world, hero(world).depth);
  const free = (c: number): boolean => canEnter(level, c) && !charAt(world, hero(world).depth, c);
  for (let to = 0; to < level.map.length; to++) {
    if (!free(to) || distance(to, target) > reach) continue;
    const from = NEIGHBOURS8.map((n) => to + n).find((c) => free(c) && distance(c, target) > reach);
    if (from === undefined) continue;
    hero(world).pos = from;
    return play(world, { type: 'move', to });
  }
  throw new Error('nowhere to step');
}

function strike(world: World, target: Mob): Effect[] {
  if (!adjacent(hero(world).pos, target.pos)) besides(world, target.pos);
  return play(world, { type: 'attack', target: target.id });
}

const fx = (effects: Effect[], name: string): boolean => effects.some((e) => e.type === 'bossFx' && e.fx === name);
const yelled = (effects: Effect[], line: string): boolean => effects.some((e) => e.type === 'yell' && e.line === line);

describe("Goo's lair (SewerBossLevel)", () => {
  it('is laid out round a Goo room, the way down behind a wall, Goo asleep in its nest', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const world = createWorld(seed);
      const level = levelAt(world, 5);
      const room = level.boss!.gooRoom!;
      expect(room.right - room.left + 1, `seed ${seed}`).toBeGreaterThanOrEqual(10);
      expect(level.map[level.exit]).toBe(T.LOCKED_EXIT);
      expect(level.map[level.entrance]).toBe(T.ENTRANCE);
      expect(level.boss!.art!.some((a) => a.sheet === 'sewer_boss')).toBe(true);
      const goo = floorAt(world, 5).mobs.find((m) => m.kind === 'goo')!;
      expect(goo.state).toBe('sleeping');
      expect(goo.ht).toBe(100);
      expect(goo.pos).toBe(Math.trunc((room.left + room.right) / 2) + Math.trunc((room.top + room.bottom) / 2) * WIDTH);
    }
  });

  it('seals the stairs once awake; bleeds below half; slain, it leaves its key and blobs of goo', () => {
    const world = atBoss(5);
    const level = levelAt(world, 5);
    const goo = mob(world, 'goo')!;
    const all: Effect[] = [];
    all.push(...strike(world, goo));
    expect(floorOf(world).boss?.locked).toBe(true);
    expect(level.map[level.entrance]).toBeGreaterThanOrEqual(T.WATER_TILES);
    expect(all.some((e) => e.type === 'bossFight' && e.state === 'start')).toBe(true);
    for (let i = 0; i < 400 && isAlive(goo); i++) all.push(...strike(world, goo));
    expect(isAlive(goo)).toBe(false);
    expect(yelled(all, 'gluuurp')).toBe(true);
    expect(yelled(all, 'defeated')).toBe(true);
    expect(floorOf(world).boss?.locked).toBe(false);
    expect(level.map[level.entrance]).toBe(T.ENTRANCE);
    const items = floorOf(world).heaps.flatMap((h) => h.items);
    expect(items.some((i) => i.kind === 'key.skeleton')).toBe(true);
    const blobs = items.filter((i) => i.kind === 'quest.gooBlob').length;
    expect(blobs).toBeGreaterThanOrEqual(2);
    expect(blobs).toBeLessThanOrEqual(4);
    expect(all.some((e) => e.type === 'bossSlain' && e.kind === 'goo')).toBe(true);
  });

  it('pumps up for a turn, then strikes from two cells away, three times as hard', () => {
    let pumped = false;
    for (let seed = 1; seed <= 6 && !pumped; seed++) {
      const world = atBoss(5, seed);
      const goo = mob(world, 'goo')!;
      goo.hp = goo.ht = 100000;
      strike(world, goo);
      for (let i = 0; i < 60; i++) {
        const effects = play(world, { type: 'wait' });
        if (fx(effects, 'pumpUp') && (goo.boss?.pumpedUp ?? 0) >= 1) pumped = true;
        if (fx(effects, 'pumpAttack')) {
          expect(goo.boss?.pumpedUp).toBe(0);
          break;
        }
      }
    }
    expect(pumped).toBe(true);
  });

  it("caustic ooze eats at the hero for twenty turns, and water washes it off", () => {
    const world = atBoss(5);
    const h = hero(world);
    h.hp = h.ht = 100;
    h.ooze = 0;
    h.oozeLeft = 20;
    const before = h.hp;
    act(world, 'p', { type: 'wait' });
    expect(h.hp).toBe(before - 1);
    for (let i = 0; i < 25; i++) act(world, 'p', { type: 'wait' });
    expect(h.ooze).toBe(-1);
  });
});

describe("Tengu's prison (PrisonBossLevel)", () => {
  /** The hero inside Tengu's cell, the fight begun. */
  function inCell(seed = 3): World {
    const world = atBoss(10, seed);
    const level = levelAt(world, 10);
    expect(level.map[TENGU_CELL_DOOR]).toBe(T.LOCKED_DOOR);
    level.map[TENGU_CELL_DOOR] = T.DOOR;
    hero(world).pos = TENGU_CELL_DOOR;
    play(world, { type: 'move', to: TENGU_CELL_DOOR + WIDTH });
    return world;
  }

  it('Tengu appears in his cell when the hero steps in, and the door locks behind', () => {
    const world = inCell();
    const level = levelAt(world, 10);
    expect(floorOf(world).boss?.prison).toBe('fightStart');
    expect(level.map[TENGU_CELL_DOOR]).toBe(T.LOCKED_DOOR);
    const tengu = mob(world, 'tengu')!;
    expect(tengu.ht).toBe(200);
    expect(distance(tengu.pos, cell(10, 27))).toBeLessThanOrEqual(1);
    expect(floorOf(world).boss?.locked).toBe(true);
  });

  it('jumps away when hurt, laying hidden dart traps; at half health the level changes, then the arena', () => {
    const world = inCell();
    const level = levelAt(world, 10);
    const tengu = mob(world, 'tengu')!;
    tengu.hp = 176;
    const effects = strike(world, tengu);
    expect(fx(effects, 'puff') || fx(effects, 'traps')).toBe(true);
    expect((floorOf(world).boss?.tenguTraps ?? []).length).toBeGreaterThan(0);
    for (const trap of floorOf(world).boss!.tenguTraps!) expect(level.map[trap]).toBe(T.SECRET_POISON_TRAP);
    tengu.hp = 101;
    for (let i = 0; i < 20 && floorOf(world).boss?.prison === 'fightStart'; i++) strike(world, tengu);
    expect(floorOf(world).boss?.prison).toBe('fightPause');
    expect(floorOf(world).mobs.includes(tengu)).toBe(false);
    expect(tengu.hp).toBe(100);
    expect(level.map[level.entrance]).toBe(T.WALL);
    // Back up the hallway: the arena.
    hero(world).pos = cell(10, 9);
    play(world, { type: 'move', to: cell(10, 8) });
    expect(floorOf(world).boss?.prison).toBe('fightArena');
    expect(mob(world, 'tengu')!.pos).toBe(cell(10, 3));
  });

  it('in the arena he throws bombs and shockers; slain, the prison opens a way down and he leaves his mask', () => {
    const world = inCell(5);
    const tengu = mob(world, 'tengu')!;
    tengu.hp = 101;
    for (let i = 0; i < 20 && floorOf(world).boss?.prison === 'fightStart'; i++) strike(world, tengu);
    hero(world).pos = cell(10, 9);
    play(world, { type: 'move', to: cell(10, 8) });
    const all: Effect[] = [];
    for (let i = 0; i < 60; i++) all.push(...play(world, { type: 'wait' }));
    expect(all.some((e) => e.type === 'bossFx' && e.fx === 'throw')).toBe(true);
    expect(fx(all, 'blast')).toBe(true);
    const t = mob(world, 'tengu')!;
    t.hp = 3;
    for (let i = 0; i < 30 && floorOf(world).boss?.prison !== 'won'; i++) all.push(...strike(world, mob(world, 'tengu') ?? t));
    expect(floorOf(world).boss?.prison).toBe('won');
    const level = levelAt(world, 10);
    expect(level.exits!.some((c) => level.map[c] === T.EXIT)).toBe(true);
    expect(floorOf(world).heaps.some((h) => h.items.some((i) => i.kind === 'mask.tengu'))).toBe(true);
    expect(yelled(all, 'defeated')).toBe(true);
    expect(floorOf(world).boss?.locked).toBe(false);
    // And down the way out.
    hero(world).pos = level.exits!.find((c) => level.map[c] === T.EXIT)!;
    expect(act(world, 'p', { type: 'descend' }).ok).toBe(true);
    expect(hero(world).depth).toBe(11);
  });

  it('plays the same way twice', () => {
    const run = (): string => {
      const world = inCell(7);
      for (let i = 0; i < 40; i++) {
        const t = mob(world, 'tengu');
        if (t) strike(world, t);
        else play(world, { type: 'wait' });
      }
      return JSON.stringify(world);
    };
    expect(run()).toBe(run());
  });
});

describe("DM-300's caves (CavesBossLevel)", () => {
  it('a pylon in each corner, the gate shut, the way down beyond it', () => {
    const world = createWorld(4);
    const level = levelAt(world, 15);
    expect(floorAt(world, 15).mobs.filter((m) => m.kind === 'pylon').map((m) => m.pos).sort()).toEqual([...PYLON_POSITIONS].sort());
    for (const c of GATE_CELLS) expect(level.map[c]).toBe(T.STATUE_SP);
    expect(level.map[level.exit]).toBe(T.EXIT);
  });

  it('wakes when the hero nears a pylon; supercharged at two thirds and a third; the pylons must fall, then DM-300', () => {
    const world = atBoss(15, 4);
    const level = levelAt(world, 15);
    stepNear(world, PYLON_POSITIONS[2]!, 3);
    expect(floorOf(world).boss?.locked).toBe(true);
    expect(level.map[level.entrance]).toBe(T.WALL);
    const dm = mob(world, 'dm300')!;
    expect(dm).toBeDefined();
    const all: Effect[] = [];
    dm.hp = 205;
    for (let i = 0; i < 20 && !dm.boss?.supercharged; i++) all.push(...strike(world, dm));
    expect(dm.boss?.supercharged).toBe(true);
    expect(dm.hp).toBe(200);
    expect(yelled(all, 'charging')).toBe(true);
    // Invulnerable while charged.
    strike(world, dm);
    expect(dm.hp).toBe(200);
    const active = () => floorOf(world).mobs.find((m) => m.kind === 'pylon' && m.boss?.active);
    expect(active()).toBeDefined();
    expect((floorOf(world).boss?.energy ?? []).length).toBeGreaterThan(0);
    for (let i = 0; i < 200 && active(); i++) all.push(...strike(world, active()!));
    expect(dm.boss?.supercharged).toBe(false);
    expect(yelled(all, 'charge_lost')).toBe(true);
    dm.hp = 105;
    for (let i = 0; i < 20 && !dm.boss?.supercharged; i++) strike(world, mob(world, 'dm300')!);
    expect(dm.boss?.pylonsActivated).toBe(2);
    for (let i = 0; i < 200 && active(); i++) all.push(...strike(world, active()!));
    expect(yelled(all, 'pylons_destroyed')).toBe(true);
    expect(floorOf(world).boss?.bleed).toBe(true);
    for (let i = 0; i < 400 && isAlive(dm); i++) all.push(...strike(world, dm));
    expect(isAlive(dm)).toBe(false);
    for (const c of GATE_CELLS) expect(level.map[c]).toBe(T.EMPTY);
    expect(level.map[level.entrance]).toBe(T.ENTRANCE);
    expect(floorOf(world).heaps.flatMap((h) => h.items).filter((i) => i.kind === 'quest.metalShard').length).toBeGreaterThanOrEqual(2);
  });
});

describe("the Dwarf King's throne room (CityBossLevel)", () => {
  function inThroneRoom(seed = 3, impDone = false): World {
    const world = atBoss(20, seed);
    if (impDone) world.impQuest = { depth: 18, given: true, done: true, prey: 'monk', reward: createItem('ring.mending') };
    hero(world).pos = BOTTOM_DOOR;
    play(world, { type: 'move', to: BOTTOM_DOOR - WIDTH });
    return world;
  }

  it('the King appears on his throne; his court comes from the pedestals', () => {
    const world = inThroneRoom();
    const level = levelAt(world, 20);
    expect(level.map[BOTTOM_DOOR]).toBe(T.LOCKED_DOOR);
    expect(level.map[TOP_DOOR]).toBe(T.LOCKED_DOOR);
    const king = mob(world, 'king')!;
    expect(distance(king.pos, THRONE)).toBeLessThanOrEqual(1);
    const all: Effect[] = [];
    for (let i = 0; i < 30; i++) all.push(...play(world, { type: 'wait' }));
    expect(fx(all, 'summon')).toBe(true);
    expect(floorOf(world).mobs.some((m) => m.minion && m.kind === 'ghoul')).toBe(true);
  });

  it('at fifty health he takes his throne behind a shield his slain subjects break; then he rages, his wounds deferred', () => {
    const world = inThroneRoom(3, true);
    const king = mob(world, 'king')!;
    const all: Effect[] = [];
    king.hp = 55;
    for (let i = 0; i < 20 && king.boss?.phase === 1; i++) all.push(...strike(world, king));
    expect(king.boss?.phase).toBe(2);
    expect(king.pos).toBe(THRONE);
    expect(king.shield).toBe(king.ht);
    strike(world, king);
    expect(king.hp).toBe(50);
    for (let i = 0; i < 15; i++) all.push(...play(world, { type: 'wait' }));
    expect(yelled(all, 'wave_1')).toBe(true);
    const subject = floorOf(world).mobs.find((m) => m.minion && m.boss?.kingDamager)!;
    expect(subject).toBeDefined();
    king.shield = 25;
    subject.hp = 1;
    for (let i = 0; i < 10 && isAlive(subject); i++) all.push(...strike(world, subject));
    expect(king.boss?.phase).toBe(3);
    expect(yelled(all, 'enraged')).toBe(true);
    const before = king.hp;
    strike(world, king);
    expect(king.hp).toBe(before);
    expect(floorOf(world).boss?.timed.some((t) => t.kind === 'deferred')).toBe(true);
    king.hp = 3;
    for (let i = 0; i < 300 && isAlive(king); i++) all.push(...strike(world, king));
    expect(isAlive(king)).toBe(false);
    const level = levelAt(world, 20);
    expect(level.map[TOP_DOOR]).toBe(T.DOOR);
    expect(level.map[BOTTOM_DOOR]).toBe(T.DOOR);
    expect(floorOf(world).heaps.some((h) => h.items.some((i) => i.kind === 'crown.king'))).toBe(true);
    expect(floorOf(world).mobs.some((m) => m.minion)).toBe(false);
    // The imp's errand was done: his shop opens below.
    expect(mob(world, 'impShopkeeper')).toBeDefined();
    expect(floorOf(world).heaps.filter((h) => h.kind === 'forSale').length).toBeGreaterThan(5);
    void PEDESTALS;
  });
});

describe("Yog-Dzewa's hall (HallsBossLevel)", () => {
  it('two steps off the stairs, they burn away and Yog rises; fists every 300 health; it falls, and the way down opens', () => {
    const world = atBoss(25, 3);
    const level = levelAt(world, 25);
    stepNear(world, level.entrance, 1);
    play(world, { type: 'move', to: NEIGHBOURS8.map((n) => hero(world).pos + n).find((c) => canEnter(level, c) && distance(c, level.entrance) >= 2)! });
    expect(floorOf(world).boss?.locked).toBe(true);
    expect(level.map[level.entrance]).toBe(T.EMPTY_SP);
    const yog = mob(world, 'yog')!;
    expect(yog.pos).toBe(YOG_POS);
    // Close enough to be seen: the fight begins.
    besides(world, yog.pos);
    const all: Effect[] = [];
    all.push(...play(world, { type: 'wait' }));
    expect(yog.boss?.phase).toBe(1);
    expect(yelled(all, 'notice')).toBe(true);
    for (let phase = 1; phase <= 3; phase++) {
      yog.hp = yog.ht - 300 * phase + 5;
      for (let i = 0; i < 30 && yog.boss?.phase === phase; i++) all.push(...strike(world, yog));
      expect(yog.boss?.phase).toBe(phase + 1);
      expect(floorOf(world).boss?.viewDistance).toBe(Math.max(4 - phase, 1));
      const fist = floorOf(world).mobs.find(isFist)!;
      expect(fist).toBeDefined();
      // Yog cannot be hurt while a fist lives; nor a fist near Yog.
      const yogHp = yog.hp;
      strike(world, yog);
      expect(yog.hp).toBe(yogHp);
      const fistHp = fist.hp;
      fist.pos = besides(world, yog.pos) === hero(world).pos ? fist.pos : fist.pos;
      if (distance(fist.pos, YOG_POS) <= 4) {
        strike(world, fist);
        expect(fist.hp).toBe(fistHp);
      }
      // Drawn away from Yog, it can be slain.
      const far = level.map.findIndex((t, c) => canEnter(level, c) && distance(c, YOG_POS) >= 8 && !charAt(world, 25, c) &&
        NEIGHBOURS8.some((n) => canEnter(level, c + n) && !charAt(world, 25, c + n)));
      fist.pos = far;
      fist.hp = 1;
      for (let i = 0; i < 200 && isAlive(fist); i++) {
        fist.hp = Math.min(fist.hp, 1);
        if (fist.kind === 'rustedFist') floorOf(world).boss!.timed = floorOf(world).boss!.timed.filter((t) => t.kind !== 'deferred');
        all.push(...strike(world, fist));
        if (fist.kind === 'rottingFist' && (fist.bleeding ?? 0) > 0) fist.hp = 0.5;
      }
    }
    expect(yog.boss?.phase).toBe(5);
    expect(yelled(all, 'hope')).toBe(true);
    for (let i = 0; i < 300 && isAlive(yog); i++) {
      for (const m of floorOf(world).mobs.filter((x) => x.minion)) m.hp = 1;
      all.push(...strike(world, yog));
    }
    expect(isAlive(yog)).toBe(false);
    expect(level.map[HALLS_EXIT]).toBe(T.EXIT);
    expect(level.map[level.entrance]).toBe(T.ENTRANCE);
    expect(floorOf(world).boss?.viewDistance).toBe(4);
    expect(fx(all, 'beam')).toBe(true);
  });
});

describe("the Amulet's hall (LastLevel)", () => {
  it('holds the Amulet at the end of the walk over the abyss', () => {
    const world = createWorld(5);
    const floor = floorAt(world, 26);
    expect(floor.heaps.find((h) => h.pos === AMULET_POS)?.items[0]?.kind).toBe('quest.amulet');
    expect(floor.mobs).toEqual([]);
  });
});
