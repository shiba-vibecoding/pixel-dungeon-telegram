import { describe, expect, it } from 'vitest';
import {
  act, addHero, canEnter, charAt, createItem, createMob, createWorld, type Effect, floorAt, type HeroClass, heroAttackSkill,
  heroById, heroDefenseSkill, heroSpeed, isIdentified, itemPrice, journalNotes, KIT_SEAMS, levelAt, maxShield, NEIGHBOURS8,
  shielding, startingKit, T, visibleEnemies, WIDTH, type World,
} from '../src/index';
import { pacify } from './helpers';

function solo(heroClass: HeroClass = 'warrior', seed = 9): World {
  const world = pacify(createWorld(seed));
  addHero(world, { id: 'p', name: 'P', heroClass });
  return world;
}

const freeBeside = (world: World, pos: number): number => {
  const hero = heroById(world, 'p')!;
  const level = levelAt(world, hero.depth);
  return NEIGHBOURS8.map((n) => pos + n).find((c) => canEnter(level, c) && !charAt(world, hero.depth, c) && level.map[c] !== T.DOOR)!;
};

/** A rat beside the hero, after them; `hp` as given. */
function ratBeside(world: World, hp = 1e9): string {
  const hero = heroById(world, 'p')!;
  const floor = floorAt(world, hero.depth);
  const rat = createMob(`#r${floor.mobs.length}`, 'rat', freeBeside(world, hero.pos), 'hunting', floor.now);
  Object.assign(rat, { hp, ht: hp, enemy: 'p', target: hero.pos, enemySeen: true });
  floor.mobs.push(rat);
  return rat.id;
}

describe('the classes (HeroClass.initHero)', () => {
  it('everyone at 20 health and 10 strength, in cloth armour, with a ration, a velvet pouch and a waterskin', () => {
    for (const heroClass of ['warrior', 'mage', 'rogue', 'huntress'] as const) {
      const hero = heroById(solo(heroClass), 'p')!;
      expect(hero).toMatchObject({ hp: 20, ht: 20, str: 10, lvl: 1, attackSkill: 10, defenseSkill: 5 });
      expect(hero.armor.kind).toBe('armor.cloth');
      for (const kind of ['food.ration', 'bag.seeds', 'waterskin'] as const) expect(hero.items.some((i) => i.kind === kind), `${heroClass} ${kind}`).toBe(true);
    }
  });

  it("each class's own kit, through the seams other streams fill (KIT_SEAMS)", () => {
    expect(heroById(solo('warrior'), 'p')!.weapon!.kind).toBe('weapon.wornShortsword');
    // The mage's staff is the real one (the wands stream's MagesStaff), with a wand of magic missile imbued.
    expect(heroById(solo('mage'), 'p')!.weapon).toMatchObject({ kind: 'weapon.magesStaff', wand: { kind: 'wand.magicMissile' } });
    expect(heroById(solo('rogue'), 'p')!.weapon!.kind).toBe('weapon.dagger');
    expect(heroById(solo('rogue'), 'p')!.artifact!.kind).toBe('artifact.cloak');
    expect(heroById(solo('huntress'), 'p')!.weapon!.kind).toBe('weapon.gloves');
    expect(heroById(solo('huntress'), 'p')!.items[0]!.kind).toBe('spiritBow');
    // The quick slots each class starts with (Dungeon.quickslot.setSlot).
    expect(startingKit('warrior').quickslots).toEqual(['missile.throwingStone']);
    expect(startingKit('mage').quickslots).toEqual(['weapon.magesStaff']);
    expect(startingKit('warrior').items[0]).toMatchObject({ kind: 'missile.throwingStone', qty: 3 });
    expect(startingKit('rogue').items[0]).toMatchObject({ kind: 'missile.throwingKnife', qty: 3 });
  });

  it("the warrior's armour comes with the broken seal affixed; nobody else's", () => {
    expect(heroById(solo('warrior'), 'p')!.armor.seal).toEqual({ level: 0 });
    for (const heroClass of ['mage', 'rogue', 'huntress'] as const) expect(heroById(solo(heroClass), 'p')!.armor.seal).toBeUndefined();
  });

  it('the warrior is not encumbered by his own sword', () => {
    const hero = heroById(solo('warrior'), 'p')!;
    expect(heroAttackSkill(hero)).toBe(10);
  });
});

describe('levels (Hero.earnExp)', () => {
  it('each brings five health at once, a point of accuracy and of evasion; the next costs five more', () => {
    const world = solo('mage');
    const hero = heroById(world, 'p')!;
    hero.hp = 12;
    hero.items.push(createItem('potion.experience'));
    const result = act(world, 'p', { type: 'use', item: hero.items.length - 1 });
    expect(result.ok && result.effects.find((e) => e.type === 'levelUp')).toEqual({ type: 'levelUp', hero: 'p', lvl: 2 });
    expect(hero).toMatchObject({ lvl: 2, ht: 25, hp: 17, attackSkill: 11, defenseSkill: 6, exp: 0 });
  });

  it('no further than level 30: experience there is spent for nothing', () => {
    const world = solo('mage');
    const hero = heroById(world, 'p')!;
    Object.assign(hero, { lvl: 30, ht: 165, hp: 165 });
    hero.items.push(createItem('potion.experience'));
    const result = act(world, 'p', { type: 'use', item: hero.items.length - 1 });
    expect(result.ok && result.effects.some((e) => e.type === 'levelCap')).toBe(true);
    expect(hero).toMatchObject({ lvl: 30, exp: 0, ht: 165 });
    // Bless: a quarter more accurate and evasive for thirty turns.
    expect(hero.blessed).toBeGreaterThan(25);
    const skill = heroAttackSkill(hero);
    hero.blessed = 0;
    expect(skill).toBe(Math.round(heroAttackSkill(hero) * 1.25));
  });

  it('an elixir of might adds a point of strength and a boost of health that wanes with levels (ElixirOfMight)', () => {
    const world = solo('mage');
    const hero = heroById(world, 'p')!;
    hero.items.push(createItem('elixir.might'));
    act(world, 'p', { type: 'use', item: hero.items.length - 1 });
    // HTBoost.boost(20): 4 + 20 / 20.
    expect(hero).toMatchObject({ str: 11, ht: 25 });
  });
});

describe('accuracy, evasion and speed (Hero)', () => {
  it('too heavy a weapon: accuracy divided by 1.5 a point; too heavy armour: evasion by 1.5 and speed by 1.2 a point', () => {
    const hero = heroById(solo('mage'), 'p')!;
    hero.weapon = createItem('weapon.sword');
    // A sword wants 14 strength: four short.
    expect(heroAttackSkill(hero)).toBe(Math.round(10 / 1.5 ** 4));
    hero.armor = createItem('armor.mail');
    // Mail (tier 3) wants 14: four short.
    expect(heroDefenseSkill(hero)).toBe(Math.max(1, Math.round(5 / 1.5 ** 4)));
    expect(heroSpeed(hero)).toBeCloseTo(1 / 1.2 ** 4);
    hero.str = 20;
    expect(heroDefenseSkill(hero)).toBe(5);
    expect(heroSpeed(hero)).toBe(1);
  });

  it('paralysed, half as evasive; the rogue no longer turns spare strength into evasion', () => {
    const hero = heroById(solo('rogue'), 'p')!;
    hero.str = 16;
    expect(heroDefenseSkill(hero)).toBe(5);
    hero.paralysed = 3;
    expect(heroDefenseSkill(hero)).toBe(3);
  });

  it('bare-handed: 1 to STR-8', () => {
    const world = solo('mage');
    const hero = heroById(world, 'p')!;
    hero.weapon = null;
    hero.str = 12;
    const rat = ratBeside(world);
    const seen = new Set<number>();
    for (let i = 0; i < 300; i++) {
      hero.attackSkill = 1e6;
      const result = act(world, 'p', { type: 'attack', target: rat });
      if (result.ok) for (const e of result.effects) if (e.type === 'attack' && e.attacker === 'p' && e.hit) seen.add(e.damage);
      hero.hp = hero.ht;
    }
    // Rats wear a point of armour.
    expect(Math.max(...seen)).toBe(4);
  });
});

describe('regeneration and resting', () => {
  it('a point of health every ten turns; resting takes a turn', () => {
    const world = solo('mage');
    const hero = heroById(world, 'p')!;
    hero.hp = 10;
    for (let i = 0; i < 9; i++) act(world, 'p', { type: 'wait' });
    expect(hero.hp).toBe(10);
    act(world, 'p', { type: 'wait' });
    expect(hero.hp).toBe(11);
    expect(hero.time).toBe(10);
  });

  it('no healing banked while unhurt (Regeneration: only below full health)', () => {
    const world = solo('mage');
    const hero = heroById(world, 'p')!;
    for (let i = 0; i < 25; i++) act(world, 'p', { type: 'wait' });
    hero.hp = 10;
    act(world, 'p', { type: 'wait' });
    expect(hero.hp).toBe(10);
  });
});

describe("a boss's sealed floor (LockedFloor)", () => {
  function atGoo(): World {
    const world = createWorld(3);
    addHero(world, { id: 'p', name: 'P', heroClass: 'mage' });
    const hero = heroById(world, 'p')!;
    const level = levelAt(world, 5);
    const floor = floorAt(world, 5);
    Object.assign(hero, { depth: 5, pos: level.entrance, time: floor.now });
    floor.mobs = [];
    const goo = createMob('#goo', 'goo', freeBeside(world, freeBeside(world, level.entrance)), 'hunting', floor.now);
    Object.assign(goo, { paralysed: 1e9, enemy: 'p' });
    floor.mobs.push(goo);
    return world;
  }

  it('no hunger while it lasts; healing stops after fifty turns of leaving the boss be, and hurting it brings it back', () => {
    const world = atGoo();
    const hero = heroById(world, 'p')!;
    hero.hp = 5;
    for (let i = 0; i < 60; i++) act(world, 'p', { type: 'wait' });
    expect(hero.hunger).toBe(0);
    // Five points in fifty turns, then nothing.
    expect(hero.hp).toBe(10);
    expect(hero.lockedFloor).toBe(0);
    // A blow on Goo: a turn and a half of healing back for every point of its damage.
    const goo = floorAt(world, 5).mobs[0]!;
    goo.hp = goo.ht = 1e6;
    hero.pos = freeBeside(world, goo.pos);
    Object.assign(hero, { attackSkill: 1e6, str: 30, weapon: createItem('weapon.warHammer', 1, 10) });
    act(world, 'p', { type: 'attack', target: goo.id });
    expect(hero.lockedFloor).toBeGreaterThan(0);
  });
});

describe('searching (Hero.search)', () => {
  it('a deliberate search finds what is a cell away, two for the rogue', () => {
    for (const [heroClass, reach] of [['mage', 1], ['rogue', 2]] as const) {
      const world = solo(heroClass);
      const hero = heroById(world, 'p')!;
      const level = levelAt(world, 1);
      const open = (c: number): boolean => level.map[c] === T.EMPTY;
      // A spot in a room with two open cells to its right.
      hero.pos = level.map.findIndex((_, c) => open(c) && open(c + 1) && open(c + 2) && open(c - WIDTH) && open(c + WIDTH));
      const far = hero.pos + 2;
      level.map[far] = T.SECRET_FIRE_TRAP;
      act(world, 'p', { type: 'search' });
      expect(level.map[far], heroClass).toBe(reach === 2 ? T.FIRE_TRAP : T.SECRET_FIRE_TRAP);
    }
  });
});

describe("the warrior's broken seal (BrokenSeal, WarriorShield)", () => {
  it('a blow to half health or below raises a shield of 3 + twice the tier first; then it cools down for 150 turns', () => {
    const world = solo('warrior');
    const hero = heroById(world, 'p')!;
    expect(maxShield(hero)).toBe(5);
    hero.hp = 11;
    hero.poison = 1;
    const result = act(world, 'p', { type: 'wait' });
    expect(result.ok && result.effects.find((e) => e.type === 'shielded')).toEqual({ type: 'shielded', hero: 'p', amount: 5 });
    expect(hero.hp).toBe(11);
    expect(shielding(hero)).toBe(4);
    expect(hero.sealShield!.cooldown).toBe(150);
  });

  it('the shield ends five turns after the last enemy is out of sight, and what is left shortens the cooldown', () => {
    const world = solo('warrior');
    const hero = heroById(world, 'p')!;
    hero.hp = 11;
    hero.poison = 1;
    act(world, 'p', { type: 'wait' });
    for (let i = 0; i < 4; i++) act(world, 'p', { type: 'wait' });
    expect(shielding(hero)).toBe(4);
    act(world, 'p', { type: 'wait' });
    expect(shielding(hero)).toBe(0);
    // 4/5 left: 40% of 150 back.
    expect(hero.sealShield!.cooldown).toBe(Math.trunc(145 - 150 * (0.8 / 2)));
  });

  it('with an enemy in sight the shield stays', () => {
    const world = solo('warrior');
    const hero = heroById(world, 'p')!;
    const rat = ratBeside(world);
    floorAt(world, 1).mobs.find((m) => m.id === rat)!.paralysed = 1e9;
    hero.hp = 11;
    hero.poison = 1;
    for (let i = 0; i < 10; i++) act(world, 'p', { type: 'wait' });
    expect(shielding(hero)).toBe(4);
    expect(visibleEnemies(world, hero).map((m) => m.id)).toEqual([rat]);
  });

  it('moves between armours, carrying one upgrade; not onto armour cursed or not known to be clean', () => {
    const world = solo('warrior');
    const hero = heroById(world, 'p')!;
    hero.items = [createItem('armor.leather', 1, 1), { ...createItem('armor.mail'), curseUnknown: true }, { ...createItem('armor.scale', 1, -1), cursed: true }];
    expect(act(world, 'p', { type: 'affix', from: 'armor', to: 1 })).toEqual({ ok: false, reason: 'unknown_armor' });
    expect(act(world, 'p', { type: 'affix', from: 'armor', to: 2 })).toEqual({ ok: false, reason: 'cursed_armor' });
    // Upgraded with the seal on, the cloth armour gives the seal its upgrade.
    hero.items.push(createItem('scroll.upgrade'));
    act(world, 'p', { type: 'use', item: 3, on: 'armor' });
    expect(hero.armor).toMatchObject({ level: 1, seal: { level: 1 } });
    const time = hero.time;
    const moved = act(world, 'p', { type: 'affix', from: 'armor', to: 0 });
    expect(moved.ok && moved.effects.some((e) => e.type === 'sealAffixed')).toBe(true);
    // No time taken; the cloth armour loses the upgrade the seal carried, the leather gains it.
    expect(hero.time).toBe(time);
    expect(hero.armor.level).toBe(0);
    expect(hero.armor.seal).toBeUndefined();
    expect(hero.items[0]).toMatchObject({ kind: 'armor.leather', level: 2, seal: { level: 1 } });
    // Off again, as an item of its own, and onto the cloth once more.
    act(world, 'p', { type: 'detach', armor: 0 });
    expect(hero.items[0]).toMatchObject({ kind: 'armor.leather', level: 1 });
    const seal = hero.items.findIndex((i) => i.kind === 'seal');
    expect(hero.items[seal]).toMatchObject({ kind: 'seal', level: 1 });
    act(world, 'p', { type: 'affix', from: seal, to: 'armor' });
    expect(hero.armor).toMatchObject({ kind: 'armor.cloth', level: 1, seal: { level: 1 } });
    expect(hero.items.some((i) => i.kind === 'seal')).toBe(false);
  });

  it('only while the sealed armour is worn; sealed armour is not for sale; the seal is never stolen', () => {
    const world = solo('warrior');
    const hero = heroById(world, 'p')!;
    expect(itemPrice(hero.armor, false)).toBe(0);
    hero.items.push(hero.armor);
    hero.armor = createItem('armor.leather');
    expect(maxShield(hero)).toBe(0);
  });

  it('a scroll of upgrade can be read on the seal itself, once', () => {
    const world = solo('warrior');
    const hero = heroById(world, 'p')!;
    act(world, 'p', { type: 'detach', armor: 'armor' });
    const seal = hero.items.findIndex((i) => i.kind === 'seal');
    hero.items.push(createItem('scroll.upgrade', 2));
    const scroll = hero.items.length - 1;
    expect(act(world, 'p', { type: 'use', item: scroll, on: seal }).ok).toBe(true);
    expect(hero.items[seal]!.level).toBe(1);
    expect(act(world, 'p', { type: 'use', item: hero.items.findIndex((i) => i.kind === 'scroll.upgrade'), on: seal })).toEqual({
      ok: false, reason: 'that cannot be upgraded',
    });
  });
});

describe('the journal (Notes)', () => {
  it('notes a well once seen, and drops the note once the well is drunk from', () => {
    for (let seed = 1; seed < 200; seed++) {
      const world = pacify(createWorld(seed));
      addHero(world, { id: 'p', name: 'P', heroClass: 'mage' });
      const depth = [1, 2, 3, 4].find((d) => levelAt(world, d).wells.some((w) => w.water === 'health'));
      if (!depth) continue;
      const level = levelAt(world, depth);
      const well = level.wells.find((w) => w.water === 'health')!;
      const hero = heroById(world, 'p')!;
      hero.depth = depth;
      Object.assign(hero, { pos: freeBeside(world, well.pos), time: floorAt(world, depth).now });
      act(world, 'p', { type: 'wait' });
      expect(journalNotes(world)).toContainEqual({ landmark: 'wellOfHealth', depth });
      act(world, 'p', { type: 'move', to: well.pos });
      expect(journalNotes(world).some((n) => n.landmark === 'wellOfHealth')).toBe(false);
      return;
    }
    throw new Error('no well of health');
  });
});

describe('small things (Hero.handle)', () => {
  it('standing in tall grass, a move in place tramples it', () => {
    const world = solo('mage');
    const hero = heroById(world, 'p')!;
    const level = levelAt(world, 1);
    hero.pos = freeBeside(world, hero.pos);
    expect(act(world, 'p', { type: 'move', to: hero.pos })).toEqual({ ok: false, reason: 'cannot move there' });
    level.map[hero.pos] = T.HIGH_GRASS;
    expect(act(world, 'p', { type: 'move', to: hero.pos }).ok).toBe(true);
    expect(level.map[hero.pos]).toBe(T.GRASS);
  });

  it('the huntress passes through tall grass without trampling it; it sheds nothing a second time', () => {
    const world = solo('huntress');
    const hero = heroById(world, 'p')!;
    const level = levelAt(world, 1);
    const home = hero.pos;
    const grass = freeBeside(world, home);
    level.map[grass] = T.HIGH_GRASS;
    const effects: Effect[] = [];
    for (let i = 0; i < 30; i++) {
      const result = act(world, 'p', { type: 'move', to: i % 2 === 0 ? grass : home });
      if (result.ok) effects.push(...result.effects);
    }
    expect(level.map[grass]).toBe(T.HIGH_GRASS);
    expect(level.furrowed).toEqual([grass]);
    // Anyone else flattens furrowed grass, without loot.
    hero.heroClass = 'mage';
    act(world, 'p', { type: 'move', to: grass });
    expect(level.map[grass]).toBe(T.GRASS);
    expect(isIdentified(world, hero.armor)).toBe(true);
  });
});
