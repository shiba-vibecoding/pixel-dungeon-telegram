import { describe, expect, it } from 'vitest';
import {
  act, addHero, armorStats, canEnter, charAt, createItem, createMob, createWorld, distance, type Effect, F, floorAt, hasFlag,
  heroById, heroView, ItemGenerator, levelAt, type Mob, type MobKind, NEIGHBOURS8, Rng, T, type World,
} from '../src/index';
import { pacify } from './helpers';

function solo(): World {
  const world = pacify(createWorld(31));
  addHero(world, { id: 'p', name: 'P', heroClass: 'warrior' });
  const hero = heroById(world, 'p')!;
  hero.items = [];
  return world;
}

/** A tough rat (or something worse) right next to the hero, after them. */
function ratBeside(world: World, hp = 1000, kind: MobKind = 'rat'): Mob {
  const hero = heroById(world, 'p')!;
  const level = levelAt(world, 1);
  const pos = NEIGHBOURS8.map((n) => hero.pos + n).find((c) => canEnter(level, c) && !charAt(world, 1, c))!;
  const rat = createMob(`#rat${pos}`, kind, pos, 'hunting', floorAt(world, 1).now);
  Object.assign(rat, { enemy: 'p', target: hero.pos, enemySeen: true, ht: hp, hp });
  floorAt(world, 1).mobs.push(rat);
  return rat;
}

function strike(world: World, mob: Mob, times = 1): Effect[] {
  const effects: Effect[] = [];
  for (let i = 0; i < times && mob.hp > 0; i++) {
    const result = act(world, 'p', { type: 'attack', target: mob.id });
    if (result.ok) effects.push(...result.effects);
  }
  return effects;
}

describe('enchantments and glyphs', () => {
  it('turn up now and then on weapons and armour', () => {
    const generator = new ItemGenerator(Rng.seeded(5), 3);
    let weapons = 0;
    let enchanted = 0;
    let armours = 0;
    let inscribed = 0;
    for (let i = 0; i < 4000; i++) {
      const item = generator.of(i % 2 === 0 ? 'weapon' : 'armor');
      if (item.kind.startsWith('weapon.')) {
        weapons++;
        if (item.enchant) enchanted++;
      } else if (item.kind.startsWith('armor.')) {
        armours++;
        if (item.glyph) inscribed++;
      }
    }
    expect(enchanted / weapons).toBeGreaterThan(0.05);
    expect(enchanted / weapons).toBeLessThan(0.16);
    expect(inscribed / armours).toBeGreaterThan(0.06);
    expect(inscribed / armours).toBeLessThan(0.14);
  });

  it('a grim weapon may slay outright; a vampiric one heals its wielder', () => {
    let world = solo();
    let hero = heroById(world, 'p')!;
    Object.assign(hero, { attackSkill: 1000 });
    hero.weapon = { ...createItem('weapon.dagger', 1, 2000), enchant: 'death' };
    const rat = ratBeside(world, 100000);
    const effects = strike(world, rat);
    expect(effects.some((e) => e.type === 'enchanted' && e.enchant === 'death')).toBe(true);
    expect(rat.hp).toBeLessThanOrEqual(0);

    world = solo();
    hero = heroById(world, 'p')!;
    Object.assign(hero, { attackSkill: 1000, hp: 1 });
    hero.weapon = { ...createItem('weapon.sword', 1, 5), enchant: 'leech' };
    strike(world, ratBeside(world), 5);
    expect(hero.hp).toBeGreaterThan(1);
  });

  it('a grim weapon does not simply slay Yog-Dzewa, and only wounds the other bosses', () => {
    const world = solo();
    const hero = heroById(world, 'p')!;
    Object.assign(hero, { attackSkill: 100000 });
    hero.weapon = { ...createItem('weapon.dagger', 1, 2000), enchant: 'death' };
    const yog = ratBeside(world, 100000, 'yog');
    strike(world, yog, 3);
    expect(yog.hp).toBeGreaterThan(90000);
  });

  it('an eldritch weapon sends its victim fleeing', () => {
    const world = solo();
    const hero = heroById(world, 'p')!;
    Object.assign(hero, { attackSkill: 1000 });
    hero.weapon = { ...createItem('weapon.dagger', 1, 100), enchant: 'horror' };
    const rat = ratBeside(world);
    strike(world, rat);
    expect(rat.terror).toBeGreaterThan(0);
    for (let i = 0; i < 4; i++) act(world, 'p', { type: 'wait' });
    expect(distance(rat.pos, hero.pos)).toBeGreaterThan(1);
  });

  it('armour of viscosity takes a blow a point at a time', () => {
    const world = solo();
    const hero = heroById(world, 'p')!;
    Object.assign(hero, { defenseSkill: 0, hp: 5000, ht: 5000 });
    hero.armor = { ...createItem('armor.cloth', 1, 6), glyph: 'viscosity' };
    const rat = ratBeside(world, 1000, 'golem');
    const effects: Effect[] = [];
    for (let i = 0; i < 60 && !hero.deferred; i++) {
      const result = act(world, 'p', { type: 'wait' });
      if (result.ok) effects.push(...result.effects);
    }
    expect(effects.some((e) => e.type === 'glyph' && e.glyph === 'viscosity')).toBe(true);
    expect(hero.deferred).toBeGreaterThan(0);
    floorAt(world, 1).mobs = floorAt(world, 1).mobs.filter((m) => m !== rat);
    const before = hero.hp;
    for (let i = 0; i < 3; i++) act(world, 'p', { type: 'wait' });
    expect(hero.hp).toBeLessThan(before + 3);
  });

  it('a glyph adds to the armour; a scroll of enchantment gives one, or an enchantment', () => {
    const world = solo();
    const hero = heroById(world, 'p')!;
    const plain = armorStats(hero.armor).dr;
    hero.items = [createItem('scroll.enchantment', 2)];
    act(world, 'p', { type: 'use', item: 0, target: 'armor', choice: 0 });
    expect(hero.armor.glyph).toBeDefined();
    expect(armorStats(hero.armor).dr).toBeGreaterThan(plain);
    const result = act(world, 'p', { type: 'use', item: 0, target: 'weapon', choice: 2 });
    expect(hero.weapon!.enchant).toBeDefined();
    expect(result.ok && result.effects.some((e) => e.type === 'imbued')).toBe(true);
  });
});

describe('curses', () => {
  it('worse-than-plain gear is cursed, and once worn will not come off until the curse is lifted', () => {
    const generator = new ItemGenerator(Rng.seeded(11), 4);
    const items = Array.from({ length: 300 }, () => generator.of('armor'));
    expect(items.some((item) => item.level < 0)).toBe(true);
    for (const item of items) expect(!!item.cursed).toBe(item.level < 0);

    const world = solo();
    const hero = heroById(world, 'p')!;
    hero.items = [{ ...createItem('armor.mail', 1, -2), cursed: true }, createItem('armor.leather'), createItem('scroll.removeCurse')];
    const put = act(world, 'p', { type: 'equip', item: 0 });
    expect(put.ok && put.effects.some((e) => e.type === 'cursedEquip')).toBe(true);
    const leather = hero.items.findIndex((i) => i.kind === 'armor.leather');
    expect(act(world, 'p', { type: 'equip', item: leather })).toEqual({ ok: false, reason: 'it is cursed: you cannot take it off' });
    act(world, 'p', { type: 'use', item: hero.items.findIndex((i) => i.kind === 'scroll.removeCurse') });
    expect(hero.armor.cursed).toBeUndefined();
    expect(act(world, 'p', { type: 'equip', item: hero.items.findIndex((i) => i.kind === 'armor.leather') }).ok).toBe(true);
  });

  it('a cursed ring stays on; an upgrade lifts the curse too', () => {
    const world = solo();
    const hero = heroById(world, 'p')!;
    hero.items = [{ ...createItem('ring.haste', 1, -1), cursed: true }, createItem('scroll.upgrade')];
    act(world, 'p', { type: 'equip', item: 0 });
    expect(hero.ring?.kind).toBe('ring.haste');
    expect(act(world, 'p', { type: 'remove', slot: 'ring' })).toEqual({ ok: false, reason: 'it is cursed: you cannot take it off' });
    hero.weapon = { ...createItem('weapon.sword', 1, -1), cursed: true };
    act(world, 'p', { type: 'use', item: hero.items.findIndex((i) => i.kind === 'scroll.upgrade'), target: 'weapon' });
    expect(hero.weapon.cursed).toBeUndefined();
    expect(hero.weapon.level).toBe(0);
  });
});

describe('mirror images', () => {
  it('a scroll of mirror image conjures twins that go for the nearest monster and vanish once they strike', () => {
    const world = solo();
    const hero = heroById(world, 'p')!;
    hero.attackSkill = 100000;
    hero.items = [createItem('scroll.mirrorImage')];
    const rat = ratBeside(world, 100000);
    rat.state = 'sleeping';
    const result = act(world, 'p', { type: 'use', item: 0 });
    const images = floorAt(world, 1).mobs.filter((m) => m.kind === 'mirror');
    expect(result.ok && result.effects.some((e) => e.type === 'mirrored')).toBe(true);
    expect(images.length).toBeGreaterThan(0);
    expect(images.length).toBeLessThanOrEqual(3);
    for (let i = 0; i < 10; i++) act(world, 'p', { type: 'search' });
    expect(rat.hp).toBeLessThan(100000);
    expect(floorAt(world, 1).mobs.filter((m) => m.kind === 'mirror').length).toBeLessThan(images.length);
  });

  it('walking into one swaps places with it; armour of multiplicity may conjure one', () => {
    const world = solo();
    const hero = heroById(world, 'p')!;
    hero.items = [createItem('scroll.mirrorImage')];
    act(world, 'p', { type: 'use', item: 0 });
    const image = floorAt(world, 1).mobs.find((m) => m.kind === 'mirror')!;
    const [at, was] = [image.pos, hero.pos];
    act(world, 'p', { type: 'attack', target: image.id });
    expect(hero.pos).toBe(at);
    expect(image.pos).toBe(was);

    const world2 = solo();
    const hero2 = heroById(world2, 'p')!;
    Object.assign(hero2, { defenseSkill: 0, hp: 5000, ht: 5000 });
    hero2.armor = { ...createItem('armor.cloth', 1, 0), glyph: 'multiplicity' };
    ratBeside(world2, 100000, 'golem');
    let conjured = false;
    for (let i = 0; i < 80 && !conjured; i++) {
      const result = act(world2, 'p', { type: 'wait' });
      conjured = result.ok && result.effects.some((e) => e.type === 'mirrored');
    }
    expect(conjured).toBe(true);
  });
});

describe('the remaining scrolls and potions', () => {
  it('terror drives off whatever is in sight; a psionic blast hurts it and blinds the reader', () => {
    let world = solo();
    let hero = heroById(world, 'p')!;
    let rat = ratBeside(world);
    hero.items = [createItem('scroll.terror')];
    act(world, 'p', { type: 'use', item: 0 });
    expect(rat.terror).toBeGreaterThan(0);

    world = solo();
    hero = heroById(world, 'p')!;
    rat = ratBeside(world, 90);
    hero.items = [createItem('scroll.psionicBlast')];
    act(world, 'p', { type: 'use', item: 0 });
    expect(rat.hp).toBeLessThan(90);
    expect(hero.blind).toBeGreaterThan(0);
    expect(heroView(world, hero).filter(Boolean).length).toBeLessThanOrEqual(9);
  });

  it('frost freezes those it is thrown at', () => {
    const world = solo();
    const hero = heroById(world, 'p')!;
    const rat = ratBeside(world);
    // Thrown a little way off, so that the cloud does not reach the thrower.
    const level = levelAt(world, 1);
    let far = -1;
    for (let h = 0; h < level.map.length && far < 0; h++) {
      if (!canEnter(level, h) || charAt(world, 1, h)) continue;
      hero.pos = h;
      const seen = heroView(world, hero);
      far = level.map.findIndex((_, c) => distance(c, h) === 3 && seen[c] && canEnter(level, c) && !charAt(world, 1, c));
    }
    rat.pos = far;
    hero.items = [createItem('potion.frost')];
    act(world, 'p', { type: 'throw', item: 0, target: far });
    // Freezing: the rat is chilled at once, and frozen solid once fully chilled (or thawed if it got out).
    expect(rat.chill).toBeGreaterThan(0);
    rat.paralysed = 0;
    for (let i = 0; i < 4; i++) act(world, 'p', { type: 'wait' });
    expect(rat.frozen || rat.chill).toBeGreaterThan(0);
    expect(hero.paralysed).toBe(0);
  });

  it('levitation floats over traps and chasms, and the hero falls when it wears off above one', () => {
    const world = solo();
    const hero = heroById(world, 'p')!;
    const level = levelAt(world, 1);
    const open = (c: number): boolean => canEnter(level, c) && level.map[c] !== T.DOOR && c !== hero.pos;
    const trap = NEIGHBOURS8.map((n) => hero.pos + n).find((c) => open(c) && NEIGHBOURS8.some((m) => open(c + m) && c + m !== c))!;
    const chasm = NEIGHBOURS8.map((n) => trap + n).find(open)!;
    level.map[trap] = T.TOXIC_TRAP;
    level.map[chasm] = T.CHASM;
    hero.items = [createItem('potion.levitation')];
    act(world, 'p', { type: 'use', item: 0 });
    expect(hero.levitating).toBeGreaterThan(0);
    act(world, 'p', { type: 'move', to: trap });
    expect(hero.pos).toBe(trap);
    expect(level.map[trap]).toBe(T.TOXIC_TRAP);
    expect(hero.poison).toBe(0);
    const back = act(world, 'p', { type: 'move', to: chasm });
    expect(back.ok).toBe(true);
    expect(hasFlag(level.map[hero.pos]!, F.PIT)).toBe(true);
    for (let i = 0; i < 30 && hero.depth === 1; i++) act(world, 'p', { type: 'wait' });
    expect(hero.depth).toBe(2);
  });

  it('purity keeps gas out of the lungs', () => {
    const world = solo();
    const hero = heroById(world, 'p')!;
    hero.items = [createItem('potion.purity'), createItem('potion.toxicGas')];
    act(world, 'p', { type: 'use', item: 0 });
    act(world, 'p', { type: 'use', item: 0 });
    expect(hero.poison).toBe(0);
  });
});
