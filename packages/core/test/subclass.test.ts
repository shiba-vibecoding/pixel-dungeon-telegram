import { describe, expect, it } from 'vitest';
import {
  act, addHero, berserkOf, canEnter, charAt, comboOf, createItem, createMob, createWorld, floorAt, freerunning, heroById, heroSpeed, levelAt,
  momentumOf, NEIGHBOURS8, prepLevel, T, type World,
} from '../src/index';
import { pacify } from './helpers';

type Way = Extract<Parameters<typeof act>[2], { type: 'master' }>['subclass'];

function solo(heroClass: 'warrior' | 'mage' | 'rogue' | 'huntress'): World {
  const world = pacify(createWorld(23));
  addHero(world, { id: 'p', name: 'P', heroClass });
  heroById(world, 'p')!.items.unshift(createItem('mask.tengu'));
  return world;
}

/** Moves the hero to open ground, with room all around (for blows that knock back). */
function openGround(world: World): void {
  const hero = heroById(world, 'p')!;
  const level = levelAt(world, 1);
  for (let cell = 0; cell < level.map.length; cell++) {
    const plain = (c: number): boolean => canEnter(level, c) && level.map[c] !== T.DOOR && level.map[c] !== T.OPEN_DOOR;
    const free = NEIGHBOURS8.every((n) => plain(cell + n)) && plain(cell + 2) && plain(cell + 3) && plain(cell + 4);
    if (free && canEnter(level, cell) && !charAt(world, 1, cell)) {
      hero.pos = cell;
      return;
    }
  }
  throw new Error('no open ground');
}

/** A tough rat right next to the hero. */
function ratBeside(world: World, hp = 1000, id = `#rat${hp}`): string {
  openGround(world);
  const hero = heroById(world, 'p')!;
  const rat = createMob(id, 'rat', hero.pos + 1, 'hunting', floorAt(world, 1).now);
  Object.assign(rat, { enemy: 'p', target: hero.pos, enemySeen: true, ht: hp, hp });
  floorAt(world, 1).mobs.push(rat);
  return rat.id;
}

const master = (world: World, subclass: Way): void => {
  act(world, 'p', { type: 'master', item: 0, subclass });
};

describe("Tengu's mask", () => {
  it('lets a hero master one of the two ways of their class, once', () => {
    const world = solo('warrior');
    const hero = heroById(world, 'p')!;
    expect(act(world, 'p', { type: 'master', item: 0, subclass: 'sniper' })).toEqual({ ok: false, reason: 'not a way for you' });
    const result = act(world, 'p', { type: 'master', item: 0, subclass: 'gladiator' });
    expect(result.ok && result.effects).toContainEqual({ type: 'mastered', hero: 'p', subclass: 'gladiator' });
    expect(hero.subclass).toBe('gladiator');
    expect(hero.items.some((item) => item.kind === 'mask.tengu')).toBe(false);
    hero.items.unshift(createItem('mask.tengu'));
    expect(act(world, 'p', { type: 'master', item: 0, subclass: 'berserker' }).ok).toBe(false);
  });
});

describe('the gladiator', () => {
  it('builds a combo with every blow that lands, and loses it when the chain breaks', () => {
    const world = solo('warrior');
    const hero = heroById(world, 'p')!;
    master(world, 'gladiator');
    hero.attackSkill = 1000;
    const rat = ratBeside(world);
    for (let i = 0; i < 3; i++) act(world, 'p', { type: 'attack', target: rat });
    expect(comboOf(hero)?.count).toBe(3);
    for (let i = 0; i < 6; i++) act(world, 'p', { type: 'wait' });
    expect(comboOf(hero)).toBeUndefined();
  });

  it('a clobber knocks the foe back, once; a slam waits for four', () => {
    const world = solo('warrior');
    const hero = heroById(world, 'p')!;
    master(world, 'gladiator');
    hero.attackSkill = 1000;
    const rat = ratBeside(world);
    for (let i = 0; i < 2; i++) act(world, 'p', { type: 'attack', target: rat });
    expect(act(world, 'p', { type: 'ability', ability: 'combo', move: 'slam', target: rat })).toEqual({ ok: false, reason: 'that move is not ready' });
    const before = floorAt(world, 1).mobs[0]!.pos;
    const result = act(world, 'p', { type: 'ability', ability: 'combo', move: 'clobber', target: rat });
    expect(result.ok && result.effects).toContainEqual({ type: 'comboMove', hero: 'p', move: 'clobber' });
    expect(floorAt(world, 1).mobs[0]!.pos).not.toBe(before);
    expect(comboOf(hero)!.clobberUsed).toBe(true);
    expect(act(world, 'p', { type: 'ability', ability: 'combo', move: 'clobber', target: rat }).ok).toBe(false);
  });
});

describe('the berserker', () => {
  it('builds rage as it is hurt, and spends it on a shield', () => {
    const world = solo('warrior');
    const hero = heroById(world, 'p')!;
    master(world, 'berserker');
    hero.ht = 20;
    hero.hp = 20;
    const rat = ratBeside(world, 1000);
    const mob = floorAt(world, 1).mobs.find((m) => m.id === rat)!;
    Object.assign(mob, { kind: 'brute' });
    for (let i = 0; i < 12 && !(berserkOf(hero) && berserkOf(hero)!.power > 0); i++) {
      hero.hp = Math.max(hero.hp, 18);
      act(world, 'p', { type: 'wait' });
    }
    const buff = berserkOf(hero);
    expect(buff).toBeDefined();
    expect(buff!.power).toBeGreaterThan(0);
    buff!.power = 1;
    const result = act(world, 'p', { type: 'ability', ability: 'berserk' });
    expect(result.ok && result.effects.some((e) => e.type === 'berserk')).toBe(true);
    expect(berserkOf(hero)!.state).toBe('berserk');
    expect(berserkOf(hero)!.shield).toBeGreaterThan(0);
  });
});

describe('the freerunner', () => {
  it('builds momentum as it walks and freeruns at twice the speed', () => {
    const world = solo('rogue');
    const hero = heroById(world, 'p')!;
    master(world, 'freerunner');
    const level = levelAt(world, 1);
    const walking = heroSpeed(hero);
    for (let i = 0; i < 3; i++) {
      const to = NEIGHBOURS8.map((n) => hero.pos + n).find((c) => canEnter(level, c) && !charAt(world, 1, c) && level.map[c] !== T.DOOR)!;
      act(world, 'p', { type: 'move', to });
    }
    expect(momentumOf(hero)!.stacks).toBeGreaterThanOrEqual(2);
    act(world, 'p', { type: 'ability', ability: 'freerun' });
    expect(freerunning(hero)).toBe(true);
    expect(heroSpeed(hero)).toBeCloseTo(walking * 2);
  });
});

describe('the assassin', () => {
  it('prepares while unseen, and strikes from the shadows', () => {
    const world = solo('rogue');
    const hero = heroById(world, 'p')!;
    master(world, 'assassin');
    hero.attackSkill = 1000;
    hero.invisible = 30;
    for (let i = 0; i < 5; i++) act(world, 'p', { type: 'wait' });
    expect(hero.tal?.prep).toBeGreaterThanOrEqual(5);
    expect(prepLevel(hero.tal!.prep!)).toBeGreaterThanOrEqual(2);
    const rat = ratBeside(world, 200);
    const mob = floorAt(world, 1).mobs.find((m) => m.id === rat)!;
    const result = act(world, 'p', { type: 'ability', ability: 'ambush', target: rat });
    expect(result.ok).toBe(true);
    expect(mob.hp).toBeLessThan(200);
  });
});

describe('the sniper', () => {
  it('marks a target with a thrown weapon and follows up with the bow', () => {
    const world = solo('huntress');
    const hero = heroById(world, 'p')!;
    master(world, 'sniper');
    hero.attackSkill = 1000;
    const rat = ratBeside(world, 1000);
    hero.items.push(createItem('missile.dart', 5));
    const dart = hero.items.findIndex((item) => item.kind === 'missile.dart');
    const mob = floorAt(world, 1).mobs.find((m) => m.id === rat)!;
    act(world, 'p', { type: 'throw', item: dart, target: mob.pos });
    expect(hero.tal?.sniper?.object).toBe(rat);
    const hp = mob.hp;
    const result = act(world, 'p', { type: 'ability', ability: 'snipe' });
    expect(result).toMatchObject({ ok: true });
    expect(mob.hp).toBeLessThan(hp);
    expect(hero.tal?.sniper).toBeUndefined();
  });
});

describe('the warden', () => {
  it('is healed over time by the sungrass she steps on', () => {
    const world = solo('huntress');
    const hero = heroById(world, 'p')!;
    master(world, 'warden');
    const level = levelAt(world, 1);
    const cell = NEIGHBOURS8.map((n) => hero.pos + n).find((c) => canEnter(level, c) && level.map[c] !== T.DOOR)!;
    floorAt(world, 1).plants = [{ pos: cell, kind: 'sungrass' }];
    hero.hp = 3;
    act(world, 'p', { type: 'move', to: cell });
    for (let i = 0; i < 5; i++) act(world, 'p', { type: 'wait' });
    expect(hero.hp).toBeGreaterThan(5);
  });
});
