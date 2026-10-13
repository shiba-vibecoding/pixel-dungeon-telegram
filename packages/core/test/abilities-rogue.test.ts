import { describe, expect, it } from 'vitest';
import { act, createItem, floorAt, heroById, isAlive, levelAt, Rng, type AbilityKind, type Talent, type World, mobStats } from '../src/index';
import { hurt } from '../src/combat';
import { CENTRE, FREE, foeAt, ready, special, wait } from './abilities-helpers';

const rogue = (ability: AbilityKind, talents: Partial<Record<Talent, number>> = {}): World => ready('rogue', ability, talents);

const ctxOf = (world: World) => ({ world, depth: 1, level: levelAt(world, 1), floor: floorAt(world, 1), rng: new Rng(floorAt(world, 1).rng), effects: [] });

describe("the rogue's smoke bomb", () => {
  it('blinks the rogue up to six cells to a seen, empty place, blinding those beside the old one', () => {
    const world = rogue('smokeBomb');
    const hero = heroById(world, 'p')!;
    const from = hero.pos;
    const rat = foeAt(world, from + 1);
    const goal = from + 6;
    expect(special(world).ok).toBe(false);
    expect(special(world, { target: from + 7 })).toEqual({ ok: false, reason: 'art:actors.hero.abilities.rogue.smokebomb.fov' });
    expect(special(world, { target: goal }).ok).toBe(true);
    expect(hero.pos).toBe(goal);
    expect(rat.blind ?? 0).toBeGreaterThan(0);
    expect(rat.state).toBe('wandering');
    expect(100 - hero.armor.charge!).toBeCloseTo(50, 0);
  });

  it('is refused onto an occupied cell, and when rooted', () => {
    const world = rogue('smokeBomb');
    const hero = heroById(world, 'p')!;
    foeAt(world, hero.pos + 3);
    expect(special(world, { target: hero.pos + 3 }).ok).toBe(false);
    hero.rooted = 2;
    expect(special(world, { target: hero.pos + 4 })).toEqual({ ok: false, reason: 'you are rooted' });
  });

  it('leaves a wooden decoy that draws the blows with body replacement', () => {
    const world = rogue('smokeBomb', { bodyReplacement: 3 });
    const hero = heroById(world, 'p')!;
    const from = hero.pos;
    special(world, { target: from + 5 });
    const log = floorAt(world, 1).mobs.find((m) => m.kind === 'ninjaLog')!;
    expect(log).toBeDefined();
    expect(log.pos).toBe(from);
    expect(log.hp).toBe(60);
    expect(log.ally).toBe(true);
    // A second bomb replaces it.
    hero.armor.charge = 100;
    special(world, { target: from + 3 });
    expect(floorAt(world, 1).mobs.filter((m) => m.kind === 'ninjaLog')).toHaveLength(1);
  });

  it('hasty retreat hastens and hides the rogue', () => {
    const world = rogue('smokeBomb', { hastyRetreat: 2 });
    const hero = heroById(world, 'p')!;
    special(world, { target: hero.pos + 4 });
    expect(hero.buffs?.haste ?? 0).toBeGreaterThan(0);
    expect(hero.invisible).toBeGreaterThan(0);
  });

  it('shadow step: cheaper while unseen, and the blink takes no time', () => {
    const world = rogue('smokeBomb', { shadowStep: 4 });
    const hero = heroById(world, 'p')!;
    hero.invisible = 20;
    const time = hero.time;
    special(world, { target: hero.pos + 3 });
    expect(hero.time).toBe(time);
    expect(100 - hero.armor.charge!).toBeCloseTo(50 * 0.84 ** 4, 0);
  });
});

describe("the rogue's death mark", () => {
  it('marks an enemy in sight: a quarter more harm, and it lives on at no health until the mark ends', () => {
    const world = rogue('deathMark');
    const hero = heroById(world, 'p')!;
    const rat = foeAt(world, hero.pos + 3, 8);
    expect(special(world, { target: hero.pos + 4 })).toEqual({ ok: false, reason: 'art:actors.hero.abilities.armorability.no_target' });
    const time = hero.time;
    expect(special(world, { target: rat.pos }).ok).toBe(true);
    expect(hero.time).toBe(time);
    expect(rat.deathMark).toBeDefined();
    expect(100 - hero.armor.charge!).toBeCloseTo(25, 0);
    hurt(ctxOf(world), rat, 50, hero);
    expect(rat.hp).toBe(0);
    expect(isAlive(rat)).toBe(true);
    expect(floorAt(world, 1).mobs).toContain(rat);
    wait(world, 6);
    expect(floorAt(world, 1).mobs).not.toContain(rat);
  });

  it('the harm done to a marked monster is a quarter more', () => {
    const world = rogue('deathMark');
    const hero = heroById(world, 'p')!;
    const rat = foeAt(world, hero.pos + 3);
    special(world, { target: rat.pos });
    hurt(ctxOf(world), rat, 40, hero);
    expect(100000 - rat.hp).toBe(50);
  });

  it('cannot mark allies', () => {
    const world = rogue('deathMark');
    const hero = heroById(world, 'p')!;
    const rat = foeAt(world, hero.pos + 3);
    rat.ally = true;
    expect(special(world, { target: rat.pos })).toEqual({ ok: false, reason: 'art:actors.hero.abilities.rogue.deathmark.ally_target' });
  });

  it('deathly durability shields the rogue as the marked dies; fear the reaper cripples and terrifies', () => {
    const world = rogue('deathMark', { deathlyDurability: 4, fearTheReaper: 4 });
    const hero = heroById(world, 'p')!;
    const rat = foeAt(world, hero.pos + 3, 40);
    const other = foeAt(world, hero.pos + 4);
    special(world, { target: rat.pos });
    hurt(ctxOf(world), rat, 100, hero);
    expect(rat.crippled ?? 0).toBeGreaterThan(0);
    expect(rat.terror ?? 0).toBeGreaterThan(0);
    expect(other.crippled ?? 0).toBeGreaterThan(0);
    wait(world, 8);
    expect(hero.shield ?? 0).toBeGreaterThan(10);
  });

  it('double mark makes the second mark in a row cheaper and free of time', () => {
    const world = rogue('deathMark', { doubleMark: 4 });
    const hero = heroById(world, 'p')!;
    const a = foeAt(world, hero.pos + 3);
    const b = foeAt(world, hero.pos + 4);
    special(world, { target: a.pos });
    const mid = hero.armor.charge!;
    special(world, { target: b.pos });
    expect(mid - hero.armor.charge!).toBeCloseTo(25 * 0.707 ** 4, 0);
  });
});

describe("the rogue's shadow clone", () => {
  it('appears beside the rogue for 35 charge, and is directed for none', () => {
    const world = rogue('shadowClone');
    const hero = heroById(world, 'p')!;
    expect(special(world).ok).toBe(true);
    const clone = floorAt(world, 1).mobs.find((m) => m.kind === 'shadow')!;
    expect(clone.ht).toBe(80);
    expect(clone.ally).toBe(true);
    expect(100 - hero.armor.charge!).toBeCloseTo(35, 0);
    expect(mobStats(clone).defense).toBe(hero.lvl + 4);
    const charge = hero.armor.charge!;
    const rat = foeAt(world, hero.pos + 4);
    expect(special(world).ok).toBe(false);
    expect(special(world, { target: rat.pos }).ok).toBe(true);
    expect(clone.enemy).toBe(rat.id);
    expect(hero.armor.charge!).toBeGreaterThanOrEqual(charge);
    wait(world, 8);
    expect(rat.hp).toBeLessThan(100000);
  });

  it('holds a place it is sent to, and follows the rogue when called back', () => {
    const world = rogue('shadowClone');
    const hero = heroById(world, 'p')!;
    special(world);
    const clone = floorAt(world, 1).mobs.find((m) => m.kind === 'shadow')!;
    const place = hero.pos + 4;
    special(world, { target: place });
    wait(world, 8);
    expect(clone.pos).toBe(place);
    special(world, { target: hero.pos });
    wait(world, 8);
    expect(Math.abs((clone.pos % 32) - (hero.pos % 32))).toBeLessThanOrEqual(1);
  });

  it('shadow blade, cloned armour and perfect copy strengthen it', () => {
    const world = rogue('shadowClone', { perfectCopy: 4, clonedArmor: 4, shadowBlade: 4 });
    const hero = heroById(world, 'p')!;
    special(world);
    const clone = floorAt(world, 1).mobs.find((m) => m.kind === 'shadow')!;
    expect(clone.ht).toBe(80 + Math.round(0.4 * (15 + 5 * hero.lvl)));
    // Perfect copy: tapping the clone from up to four cells away trades places with it.
    const spot = clone.pos;
    clone.pos = hero.pos + 3;
    const me = hero.pos;
    expect(act(world, 'p', { type: 'attack', target: clone.id }).ok).toBe(true);
    expect(hero.pos).toBe(me + 3);
    expect(spot).toBeDefined();
  });

  it('goes with the rogue to another depth', () => {
    const world = rogue('shadowClone');
    const hero = heroById(world, 'p')!;
    special(world);
    const level = levelAt(world, 1);
    hero.pos = level.exit;
    act(world, 'p', { type: 'descend' });
    expect(hero.depth).toBe(2);
    expect(floorAt(world, 2).mobs.some((m) => m.kind === 'shadow')).toBe(true);
    expect(floorAt(world, 1).mobs.some((m) => m.kind === 'shadow')).toBe(false);
    void CENTRE; void FREE; void createItem;
  });
});
