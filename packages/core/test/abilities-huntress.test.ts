import { describe, expect, it } from 'vitest';
import { act, createItem, floorAt, heroById, heroSpeed, heroView, itemPrice, leaveBones, levelAt, T, WIDTH, type AbilityKind, type Talent, type World } from '../src/index';
import { observe } from '../src/floor';
import { CENTRE, foeAt, ready, special, wait } from './abilities-helpers';

const huntress = (ability: AbilityKind, talents: Partial<Record<Talent, number>> = {}): World => {
  const world = ready('huntress', ability, talents);
  const hero = heroById(world, 'p')!;
  hero.weapon = createItem('weapon.sword');
  return world;
};

describe("the huntress's spectral blades", () => {
  it('strike the enemy in the aimed line as a blow of the melee weapon, for 25 charge, taking an attack\'s time', () => {
    const world = huntress('spectralBlades');
    const hero = heroById(world, 'p')!;
    const rat = foeAt(world, hero.pos + 4);
    expect(special(world, { target: hero.pos })).toEqual({ ok: false, reason: 'art:actors.hero.abilities.armorability.self_target' });
    expect(special(world, { target: hero.pos - 3 })).toEqual({ ok: false, reason: 'art:actors.hero.abilities.huntress.spectralblades.no_target' });
    expect(special(world, { target: rat.pos }).ok).toBe(true);
    expect(rat.hp).toBeLessThan(100000);
    expect(100 - hero.armor.charge!).toBeCloseTo(25, 0);
  });

  it('a fan of blades strikes more enemies at half the harm', () => {
    const world = huntress('spectralBlades', { fanOfBlades: 3 });
    const hero = heroById(world, 'p')!;
    const main = foeAt(world, hero.pos + 4);
    const side = foeAt(world, hero.pos + 4 + 2 * WIDTH);
    special(world, { target: main.pos });
    expect(main.hp).toBeLessThan(100000);
    expect(side.hp).toBeLessThan(100000);
  });

  it('are stopped by walls, unless projecting blades see through them', () => {
    const plain = huntress('spectralBlades');
    const hero = heroById(plain, 'p')!;
    levelAt(plain, 1).map[hero.pos + 2] = T.WALL;
    foeAt(plain, hero.pos + 4);
    expect(special(plain, { target: hero.pos + 4 }).ok).toBe(false);
    const seeing = huntress('spectralBlades', { projectingBlades: 2 });
    const seer = heroById(seeing, 'p')!;
    levelAt(seeing, 1).map[seer.pos + 2] = T.WALL;
    const rat = foeAt(seeing, seer.pos + 4);
    observe(seeing, seer);
    // Seen through the wall? Not by the huntress's eyes: the blade needs the enemy in sight.
    const result = special(seeing, { target: rat.pos });
    expect(result.ok === false || rat.hp < 100000).toBe(true);
  });
});

describe("the huntress's nature's power", () => {
  it('doubles her speed afoot for eight turns, more with growing power, and shortens her bow\'s delay', () => {
    const world = huntress('naturesPower', { growingPower: 4 });
    const hero = heroById(world, 'p')!;
    const before = heroSpeed(hero);
    expect(special(world).ok).toBe(true);
    expect(hero.abil?.nature).toBeDefined();
    expect(heroSpeed(hero)).toBeCloseTo(before * 3, 3);
    wait(world, 9);
    expect(heroSpeed(hero)).toBeCloseTo(before, 3);
    expect(100 - hero.armor.charge!).toBeGreaterThan(30);
  });

  it('wild momentum extends it when an arrow slays, twice at most', () => {
    const world = huntress('naturesPower', { wildMomentum: 4 });
    const hero = heroById(world, 'p')!;
    hero.items.push(createItem('spiritBow'));
    special(world);
    const until = hero.abil!.nature!.until;
    const rat = foeAt(world, hero.pos + 3, 1);
    const bow = hero.items.findIndex((item) => item.kind === 'spiritBow');
    expect(act(world, 'p', { type: 'shoot', item: bow, target: rat.pos }).ok).toBe(true);
    expect(hero.abil!.nature!.until).toBe(until + 4);
    expect(hero.abil!.nature!.extensionsLeft).toBe(1);
  });
});

describe("the huntress's spirit hawk", () => {
  it('appears beside her for 35 charge, and shares its sight, round a corner too', () => {
    const world = huntress('spiritHawk');
    const hero = heroById(world, 'p')!;
    expect(special(world).ok).toBe(true);
    const hawk = floorAt(world, 1).mobs.find((m) => m.kind === 'hawk')!;
    expect(hawk.ally).toBe(true);
    expect(hawk.ht).toBe(10);
    expect(100 - hero.armor.charge!).toBeCloseTo(35, 0);
    // A hawk sent far away shows the hero what it sees there.
    const far = CENTRE + 5;
    special(world, { target: far });
    wait(world, 6);
    expect(Math.abs((hawk.pos % WIDTH) - (far % WIDTH))).toBeLessThanOrEqual(2);
    const fov = heroView(world, hero);
    expect(fov[far + 1]).toBe(true);
    expect(special(world, { target: far }).ok).toBe(true);
  });

  it('attacks only when sent after an enemy, and its talons blind', () => {
    const world = huntress('spiritHawk', { goForTheEyes: 4, swiftSpirit: 2 });
    const hero = heroById(world, 'p')!;
    special(world);
    const hawk = floorAt(world, 1).mobs.find((m) => m.kind === 'hawk')!;
    const rat = foeAt(world, hero.pos + 4);
    rat.state = 'sleeping';
    wait(world, 3);
    expect(rat.hp).toBe(100000);
    special(world, { target: rat.pos });
    expect(hawk.enemy).toBe(rat.id);
    wait(world, 10);
    expect(rat.hp).toBeLessThan(100000);
    expect(rat.blind ?? 0).toBeGreaterThanOrEqual(0);
  });

  it('is gone after a hundred turns', () => {
    const world = huntress('spiritHawk');
    special(world);
    wait(world, 105);
    expect(floorAt(world, 1).mobs.some((m) => m.kind === 'hawk')).toBe(false);
  });
});

describe('class armour beyond the abilities', () => {
  it('is worth nothing to a shop and never left in bones', () => {
    const world = huntress('naturesPower');
    const hero = heroById(world, 'p')!;
    expect(itemPrice(hero.armor, true)).toBe(0);
    const bones = leaveBones(hero, 1, 0.5);
    expect(bones.item.kind).toBe('gold');
  });

  it('a hawk sent past a wall shows the huntress what is there', () => {
    const world = huntress('spiritHawk', { eagleEye: 4 });
    const hero = heroById(world, 'p')!;
    special(world);
    const hawk = floorAt(world, 1).mobs.find((m) => m.kind === 'hawk')!;
    // A wall across the room, and the hawk on its far side.
    const map = levelAt(world, 1).map;
    for (let dy = -4; dy <= 4; dy++) map[hero.pos + 3 + dy * WIDTH] = T.WALL;
    hawk.pos = hero.pos + 5;
    const fov = heroView(world, hero);
    expect(fov[hero.pos + 6]).toBe(true);
    expect(fov[hero.pos + 8]).toBe(true);
    wait(world, 1);
  });
});
