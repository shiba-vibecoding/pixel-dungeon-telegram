import { describe, expect, it } from 'vitest';
import {
  act, addHero, createItem, createMob, createWorld, type Effect, floorAt, heroById, levelAt, type Mob, type MobKind, type MobState, setTrap, T, WIDTH,
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
    setTrap(levelAt(world, 1), trap, 'poisonDart', true);
    // Wandering to that very cell, right next to it: a goal next to it is stepped onto, whatever it is.
    const rat = addMob(world, 'rat', trap - 1, 'wandering', trap);
    const effects = wait(world);
    expect(effects).toContainEqual({ type: 'trap', depth: 1, pos: trap, kind: 'poisonDart', hero: '', mob: rat.id });
    expect(levelAt(world, 1).map[trap]).toBe(T.INACTIVE_TRAP);
    expect(rat.pos).toBe(trap);
    expect(rat.poison).toBeGreaterThan(0);
  });

  it('a gripping trap holds a monster bleeding and crippled, and goes on working', () => {
    const world = openGround();
    const grip = CENTRE + 3 * WIDTH - 2;
    setTrap(levelAt(world, 1), grip, 'gripping', true);
    const gnoll = addMob(world, 'gnoll', grip - 1, 'wandering', grip);
    const effects = wait(world);
    expect(effects).toContainEqual({ type: 'trap', depth: 1, pos: grip, kind: 'gripping', hero: '', mob: gnoll.id });
    expect(gnoll.crippled).toBeGreaterThan(0);
    expect(gnoll.bleeding).toBeGreaterThan(0);
    expect(levelAt(world, 1).map[grip]).toBe(T.TRAP);
  });

  it('a hidden trap stays hidden under a monster: only a hero finds it', () => {
    const world = openGround();
    const trap = CENTRE + 3 * WIDTH - 2;
    setTrap(levelAt(world, 1), trap, 'toxic', false);
    const rat = addMob(world, 'rat', trap - 1, 'wandering', trap);
    const effects = wait(world);
    expect(rat.pos).toBe(trap);
    expect(effects.some((e) => e.type === 'trap')).toBe(false);
    expect(levelAt(world, 1).map[trap]).toBe(T.SECRET_TRAP);
  });

  it('a monster walks around a trap it can see on its way somewhere further', () => {
    const world = openGround();
    const from = CENTRE + 3 * WIDTH - 4;
    const trap = from + 1;
    setTrap(levelAt(world, 1), trap, 'alarm', true);
    const rat = addMob(world, 'rat', from, 'wandering', from + 3);
    for (let i = 0; i < 4; i++) wait(world);
    expect(rat.pos).toBe(from + 3);
    expect(levelAt(world, 1).map[trap]).toBe(T.TRAP);
  });

  it('a monster blinded with rage charges straight over it, and sets it off', () => {
    const world = openGround();
    const from = CENTRE + 3 * WIDTH - 4;
    const trap = from + 1;
    setTrap(levelAt(world, 1), trap, 'alarm', true);
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
  it('a monster that walks over a chasm falls to its death: its loot falls through, the party learns half as much', () => {
    const world = openGround();
    const hero = heroById(world, 'p')!;
    const chasm = CENTRE + 3 * WIDTH - 2;
    levelAt(world, 1).map[chasm] = T.CHASM;
    const rat = addMob(world, 'rat', chasm - 1, 'wandering', chasm);
    const heaps = floorAt(world, 1).heaps.length;
    const effects = wait(world);
    expect(effects).toContainEqual({ type: 'mobFell', depth: 1, mob: rat.id, pos: chasm, kind: 'rat' });
    expect(floorAt(world, 1).mobs).not.toContain(rat);
    // Mob.die(Chasm): it dies, but drops out of sight rather than playing its death.
    expect(effects.findIndex((e) => e.type === 'mobFell')).toBeLessThan(effects.findIndex((e) => e.type === 'died'));
    expect(floorAt(world, 1).heaps.length).toBe(heaps);
    // Mob.die(Chasm): half a rat's one point, rounded either way.
    expect(hero.exp).toBeLessThanOrEqual(1);
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
  it('a spinner shoots a web where its prey is going, and a web holds a hero fast until it wears away', () => {
    const world = openGround();
    const hero = heroById(world, 'p')!;
    hero.invisible = 0;
    hero.hp = hero.ht = 500;
    const spinner = addMob(world, 'spinner', CENTRE + 3, 'hunting', CENTRE);
    // Spinner.webPos: the hero came from the left, so the web goes on the cell after them, on the way they go.
    Object.assign(spinner, { enemy: 'p', enemySeen: true, lastEnemyPos: CENTRE - 1, webCooldown: 0 });
    const effects = wait(world);
    expect(effects.some((e) => e.type === 'mobZap' && e.bolt === 'web')).toBe(true);
    const web = (floorAt(world, 1).gas?.web ?? []).map(([cell]) => cell);
    expect(web).toContain(CENTRE + 1);
    expect(web).toContain(CENTRE + 1 - WIDTH);
    expect(web).toContain(CENTRE + 1 + WIDTH);
    // Not again for ten turns.
    expect(spinner.webCooldown).toBeGreaterThan(5);
    floorAt(world, 1).mobs = [];

    expect(act(world, 'p', { type: 'move', to: CENTRE + 1 }).ok).toBe(true);
    expect(hero.pos).toBe(CENTRE + 1);
    expect(hero.rooted).toBeGreaterThan(0);
    expect(act(world, 'p', { type: 'move', to: CENTRE + 2 })).toEqual({ ok: false, reason: 'you are rooted' });
    // The web wears thinner every turn (Spinner's webs: twenty of it), and is gone in time.
    for (let i = 0; i < 25; i++) wait(world);
    expect(floorAt(world, 1).gas?.web ?? []).toEqual([]);
    expect(act(world, 'p', { type: 'move', to: CENTRE + 2 }).ok).toBe(true);
  });

  it('a web holds a monster on foot, but not a flier', () => {
    const world = openGround();
    const level = levelAt(world, 1);
    expect(level.map[CENTRE + 2]).toBe(T.EMPTY);
    const webbed = CENTRE - 3 * WIDTH;
    floorAt(world, 1).gas = { web: [[webbed, 4], [webbed + 1, 4]] };
    floorAt(world, 1).gasAt = floorAt(world, 1).now + 1;
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
