import { describe, expect, it } from 'vitest';
import {
  act, addHero, createItem, createMob, createWorld, type Effect, floorAt, heroById, levelAt, type Mob, type MobKind, type MobState, T, WIDTH,
  type World,
} from '../src/index';
import { pacify } from './helpers';

/** Middle of the open ground carved out for these tests. */
const CENTRE = 16 + 16 * WIDTH;

/**
 * A solo hero (unseen, so that nothing goes for them) in the middle of a patch of bare floor,
 * 9 by 7 cells, on the first depth with its monsters cleared away.
 */
function openGround(): World {
  const world = pacify(createWorld(6));
  addHero(world, { id: 'p', name: 'P', heroClass: 'warrior' });
  const hero = heroById(world, 'p')!;
  const level = levelAt(world, 1);
  for (let dy = -3; dy <= 3; dy++) {
    for (let dx = -4; dx <= 4; dx++) level.map[CENTRE + dx + dy * WIDTH] = T.EMPTY;
  }
  hero.pos = CENTRE;
  hero.invisible = 1000;
  return world;
}

function addMob(world: World, kind: MobKind, pos: number, state: MobState, target: number): Mob {
  const mob = createMob(`#${900 + floorAt(world, 1).mobs.length}`, kind, pos, state, heroById(world, 'p')!.time);
  mob.target = target;
  floorAt(world, 1).mobs.push(mob);
  return mob;
}

const wait = (world: World): Effect[] => {
  const result = act(world, 'p', { type: 'wait' });
  return result.ok ? result.effects : [];
};

describe('monsters and traps (Level.mobPress)', () => {
  it('a monster stepping on a trap the party can see sets it off, and takes the harm', () => {
    const world = openGround();
    const trap = CENTRE + 3 * WIDTH - 2;
    levelAt(world, 1).map[trap] = T.POISON_TRAP;
    // Wandering to that very cell, right next to it: a goal next to it is stepped onto, whatever it is.
    const rat = addMob(world, 'rat', trap - 1, 'wandering', trap);
    const effects = wait(world);
    expect(effects).toContainEqual({ type: 'trap', depth: 1, pos: trap, kind: 'poison', hero: '', mob: rat.id });
    expect(levelAt(world, 1).map[trap]).toBe(T.INACTIVE_TRAP);
    expect(rat.pos).toBe(trap);
    expect(rat.poison).toBeGreaterThan(0);
  });

  it('a gripping trap holds a monster bleeding and crippled; lightning burns it', () => {
    const world = openGround();
    const grip = CENTRE + 3 * WIDTH - 2;
    const bolt = CENTRE - 3 * WIDTH + 2;
    levelAt(world, 1).map[grip] = T.GRIPPING_TRAP;
    levelAt(world, 1).map[bolt] = T.LIGHTNING_TRAP;
    const gnoll = addMob(world, 'gnoll', grip - 1, 'wandering', grip);
    const crab = addMob(world, 'crab', bolt + 1, 'wandering', bolt);
    const effects = wait(world);
    expect(gnoll.crippled).toBe(10);
    expect(effects).toContainEqual({ type: 'trap', depth: 1, pos: bolt, kind: 'lightning', hero: '', mob: crab.id });
    expect(effects.some((e) => e.type === 'hurt' && e.who === crab.id)).toBe(true);
    expect(crab.hp).toBeLessThan(crab.ht);
  });

  it('a hidden trap stays hidden under a monster: only a hero finds it', () => {
    const world = openGround();
    const trap = CENTRE + 3 * WIDTH - 2;
    levelAt(world, 1).map[trap] = T.SECRET_POISON_TRAP;
    const rat = addMob(world, 'rat', trap - 1, 'wandering', trap);
    const effects = wait(world);
    expect(rat.pos).toBe(trap);
    expect(effects.some((e) => e.type === 'trap')).toBe(false);
    expect(levelAt(world, 1).map[trap]).toBe(T.SECRET_POISON_TRAP);
  });

  it('a monster walks around a trap it can see on its way somewhere further', () => {
    const world = openGround();
    const from = CENTRE + 3 * WIDTH - 4;
    const trap = from + 1;
    levelAt(world, 1).map[trap] = T.ALARM_TRAP;
    const rat = addMob(world, 'rat', from, 'wandering', from + 3);
    for (let i = 0; i < 4; i++) wait(world);
    expect(rat.pos).toBe(from + 3);
    expect(levelAt(world, 1).map[trap]).toBe(T.ALARM_TRAP);
  });

  it('a monster blinded with rage charges straight over it, and sets it off', () => {
    const world = openGround();
    const from = CENTRE + 3 * WIDTH - 4;
    const trap = from + 1;
    levelAt(world, 1).map[trap] = T.ALARM_TRAP;
    const rat = addMob(world, 'rat', from, 'wandering', from + 3);
    rat.rage = 5;
    const other = addMob(world, 'gnoll', CENTRE - 3 * WIDTH, 'sleeping', -1);
    wait(world);
    expect(levelAt(world, 1).map[trap]).toBe(T.INACTIVE_TRAP);
    // AlarmTrap: every other monster comes to see; the one that set it off is already there.
    expect(other.state).toBe('wandering');
    expect(other.target).toBe(trap);
  });
});

describe('monsters and chasms (Chasm.mobFall)', () => {
  it('a monster that walks over a chasm falls, and is gone for good: no loot, but the party learns from it', () => {
    const world = openGround();
    const hero = heroById(world, 'p')!;
    const chasm = CENTRE + 3 * WIDTH - 2;
    levelAt(world, 1).map[chasm] = T.CHASM;
    const rat = addMob(world, 'rat', chasm - 1, 'wandering', chasm);
    const heaps = floorAt(world, 1).heaps.length;
    const effects = wait(world);
    expect(effects).toContainEqual({ type: 'mobFell', depth: 1, mob: rat.id, pos: chasm, kind: 'rat' });
    expect(floorAt(world, 1).mobs).not.toContain(rat);
    expect(effects.some((e) => e.type === 'died')).toBe(false);
    expect(floorAt(world, 1).heaps.length).toBe(heaps);
    expect(floorAt(world, 1).falling ?? []).toEqual([]);
    expect(hero.exp).toBe(1);
  });

  it('a flier hovers over a chasm, and flies across it', () => {
    const world = openGround();
    const level = levelAt(world, 1);
    // A chasm right across the open ground, but for the hero's own cell.
    for (let dy = -3; dy <= 3; dy++) if (dy !== 0) level.map[CENTRE + dy * WIDTH] = T.CHASM;
    const bat = addMob(world, 'bat', CENTRE - 2 * WIDTH - 2, 'wandering', CENTRE - 2 * WIDTH + 2);
    let over = false;
    let across = false;
    for (let i = 0; i < 3; i++) {
      wait(world);
      if (bat.pos === CENTRE - 2 * WIDTH) over = true;
      if (bat.pos === CENTRE - 2 * WIDTH + 2) across = true;
    }
    expect(floorAt(world, 1).mobs).toContain(bat);
    expect(over).toBe(true);
    expect(across).toBe(true);
  });

  it('a monster on foot walks around the chasm instead', () => {
    const world = openGround();
    const level = levelAt(world, 1);
    for (let dy = -3; dy <= -1; dy++) level.map[CENTRE + dy * WIDTH] = T.CHASM;
    const rat = addMob(world, 'rat', CENTRE - 2 * WIDTH - 2, 'wandering', CENTRE - 2 * WIDTH + 2);
    for (let i = 0; i < 12 && rat.pos !== CENTRE - 2 * WIDTH + 2; i++) wait(world);
    expect(floorAt(world, 1).mobs).toContain(rat);
    expect(rat.pos).toBe(CENTRE - 2 * WIDTH + 2);
  });
});

describe('spinner webs (Web)', () => {
  it('a fleeing spinner leaves webs behind it that hold a hero fast, until they wear away', () => {
    const world = openGround();
    const hero = heroById(world, 'p')!;
    const start = CENTRE + 1;
    const spinner = addMob(world, 'spinner', start, 'fleeing', CENTRE);
    wait(world);
    // Spinner.move: a web where it stood, and it is not held by its own web.
    expect(spinner.pos).not.toBe(start);
    const web = floorAt(world, 1).gas?.web ?? [];
    expect(web.map(([cell]) => cell)).toContain(start);
    expect(web.find(([cell]) => cell === start)![1]).toBeGreaterThanOrEqual(4);
    wait(world);
    expect(spinner.pos).not.toBe(start);
    floorAt(world, 1).mobs = [];

    expect(act(world, 'p', { type: 'move', to: start }).ok).toBe(true);
    expect(hero.pos).toBe(start);
    expect(hero.rooted).toBeGreaterThan(0);
    expect(act(world, 'p', { type: 'move', to: start + 1 })).toEqual({ ok: false, reason: 'you are rooted' });
    expect(hero.pos).toBe(start);

    // The web wears thinner every turn, and is gone in a few.
    for (let i = 0; i < 8; i++) wait(world);
    expect(floorAt(world, 1).gas?.web ?? []).toEqual([]);
    expect(act(world, 'p', { type: 'move', to: start + 1 }).ok).toBe(true);
    expect(hero.pos).toBe(start + 1);
  });

  it('a web holds a monster on foot, but not a flier', () => {
    const world = openGround();
    const level = levelAt(world, 1);
    expect(level.map[CENTRE + 2]).toBe(T.EMPTY);
    const spinner = addMob(world, 'spinner', CENTRE - 3 * WIDTH, 'fleeing', CENTRE);
    wait(world);
    const webbed = CENTRE - 3 * WIDTH;
    floorAt(world, 1).mobs = floorAt(world, 1).mobs.filter((mob) => mob !== spinner);
    const rat = addMob(world, 'rat', webbed, 'wandering', webbed + 3);
    const bat = addMob(world, 'bat', webbed + 1, 'wandering', webbed - 3);
    // Caught in it before their turns come: the bat flies out of the web at once; the rat stays caught while it lasts.
    rat.time = bat.time = floorAt(world, 1).gasAt! + 0.5;
    floorAt(world, 1).gas!.web = [[webbed, 4], [webbed + 1, 4]];
    wait(world);
    wait(world);
    expect(rat.pos).toBe(webbed);
    expect(bat.pos).not.toBe(webbed + 1);
    for (let i = 0; i < 8; i++) wait(world);
    expect(rat.pos).not.toBe(webbed);
  });
});
