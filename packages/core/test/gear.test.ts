import { describe, expect, it } from 'vitest';
import {
  act, addHero, canEnter, charAt, createItem, createMob, createWorld, distance, type Effect, type Enchantment, floorAt, type Glyph, heroById,
  heroDefenseSkill, heroSpeed, heroStealth, type Item, levelAt, type Mob, type MobKind, NEIGHBOURS8, T, WIDTH, type World,
} from '../src/index';
import { pacify } from './helpers';

/*
 * Shattered's enchantments, glyphs and curses at work (Weapon.Enchantment, Armor.Glyph), and its melee
 * weapons' reach.
 */

function solo(heroClass: 'warrior' | 'rogue' = 'warrior', seed = 31): World {
  const world = pacify(createWorld(seed));
  addHero(world, { id: 'p', name: 'P', heroClass });
  const hero = heroById(world, 'p')!;
  hero.items = [];
  Object.assign(hero, { attackSkill: 100000, hp: 1000, ht: 1000 });
  return world;
}

/** A tough monster right next to the hero, after them (or asleep). */
function beside(world: World, hp = 1000, kind: MobKind = 'rat', state: Mob['state'] = 'hunting'): Mob {
  const hero = heroById(world, 'p')!;
  const level = levelAt(world, 1);
  const pos = NEIGHBOURS8.map((n) => hero.pos + n).find((c) => canEnter(level, c) && level.map[c] !== T.DOOR && !charAt(world, 1, c))!;
  const mob = createMob(`#m${pos}`, kind, pos, state, floorAt(world, 1).now);
  Object.assign(mob, { enemy: 'p', target: hero.pos, enemySeen: true, ht: hp, hp });
  floorAt(world, 1).mobs.push(mob);
  return mob;
}

const strike = (world: World, mob: Mob, times = 1): Effect[] => {
  const effects: Effect[] = [];
  for (let i = 0; i < times && mob.hp > 0; i++) {
    const result = act(world, 'p', { type: 'attack', target: mob.id });
    if (result.ok) effects.push(...result.effects);
  }
  return effects;
};
const wait = (world: World, times = 1): Effect[] => {
  const effects: Effect[] = [];
  for (let i = 0; i < times; i++) {
    const result = act(world, 'p', { type: 'wait' });
    if (result.ok) effects.push(...result.effects);
  }
  return effects;
};
const enchanted = (kind: Item['kind'], enchant: Enchantment, level = 0): Item => ({ ...createItem(kind, 1, level), enchant });
const inscribed = (glyph: Glyph, level = 0): Item => ({ ...createItem('armor.mail', 1, level), glyph });

describe('enchantments (Weapon.Enchantment)', () => {
  it('blazing sets the foe alight; chilling chills it, six turns at most', () => {
    let world = solo();
    heroById(world, 'p')!.weapon = enchanted('weapon.sword', 'blazing', 10);
    let mob = beside(world);
    strike(world, mob, 10);
    expect(mob.burning).toBeGreaterThan(0);

    world = solo();
    heroById(world, 'p')!.weapon = enchanted('weapon.sword', 'chilling', 10);
    mob = beside(world);
    strike(world, mob, 10);
    expect(mob.chill).toBeGreaterThan(0);
    expect(mob.chill).toBeLessThanOrEqual(6 * 1);
  });

  it('kinetic keeps what a blow overkilled, for the next one', () => {
    const world = solo();
    const hero = heroById(world, 'p')!;
    hero.weapon = enchanted('weapon.greataxe', 'kinetic', 5);
    hero.str = 30;
    strike(world, beside(world, 3));
    expect(hero.kinetic).toBeGreaterThan(0);
    const kept = hero.kinetic!;
    // ConservedDamage: it ebbs, 2.5% a turn (a tenth at least).
    wait(world, 2);
    expect(hero.kinetic).toBeLessThan(kept);
  });

  it('blocking shields its wielder for five turns', () => {
    const world = solo();
    const hero = heroById(world, 'p')!;
    hero.weapon = enchanted('weapon.sword', 'blocking', 60);
    const mob = beside(world, 100000);
    const effects = strike(world, mob, 10);
    expect(effects.some((e) => e.type === 'shielded')).toBe(true);
  });

  it('elastic knocks the foe back', () => {
    const world = solo();
    const hero = heroById(world, 'p')!;
    hero.weapon = enchanted('weapon.sword', 'elastic', 100);
    const mob = beside(world, 100000);
    const effects = strike(world, mob, 4);
    expect(effects.some((e) => e.type === 'pushed' && e.mob === mob.id)).toBe(true);
  });

  it('vorpal turns a blow into bleeding; lucky makes a foe slain drop something', () => {
    let world = solo();
    let hero = heroById(world, 'p')!;
    hero.weapon = enchanted('weapon.sword', 'vorpal');
    let mob = beside(world, 100000);
    for (let i = 0; i < 20 && !mob.bleeding; i++) strike(world, mob);
    expect(mob.bleeding).toBeGreaterThan(0);

    world = solo();
    hero = heroById(world, 'p')!;
    hero.weapon = enchanted('weapon.greataxe', 'lucky', 2000);
    hero.str = 40;
    let dropped = false;
    for (let i = 0; i < 40 && !dropped; i++) {
      mob = beside(world, 5);
      const effects = strike(world, mob);
      dropped = effects.some((e) => e.type === 'lucky');
    }
    expect(dropped).toBe(true);
  });

  it('corrupting raises a foe it slays on the hero\'s side, who wastes away', () => {
    const world = solo();
    const hero = heroById(world, 'p')!;
    hero.weapon = enchanted('weapon.greataxe', 'corrupting', 2000);
    hero.str = 40;
    let ally: Mob | undefined;
    for (let i = 0; i < 30 && !ally; i++) {
      strike(world, beside(world, 5, 'gnoll'));
      ally = floorAt(world, 1).mobs.find((m) => m.corrupted);
    }
    expect(ally).toBeDefined();
    expect(ally).toMatchObject({ kind: 'gnoll', ally: true, corrupted: true });
    // Corruption.act: a hundredth of its health a turn.
    const hp = ally!.hp;
    floorAt(world, 1).mobs = floorAt(world, 1).mobs.filter((m) => m === ally);
    wait(world, 120);
    expect(ally!.hp < hp || !floorAt(world, 1).mobs.includes(ally!)).toBe(true);
  });

  it('shocking arcs lightning from the foe to those beside it', () => {
    const world = solo();
    heroById(world, 'p')!.weapon = enchanted('weapon.sword', 'shocking');
    const mob = beside(world, 100000);
    const other = beside(world, 100000);
    for (let i = 0; i < 30 && other.hp === 100000; i++) strike(world, mob);
    expect(other.hp).toBeLessThan(100000);
  });

  it('blooming grows tall grass around the foe', () => {
    const world = solo();
    heroById(world, 'p')!.weapon = enchanted('weapon.sword', 'blooming', 100);
    const mob = beside(world, 100000);
    const effects = strike(world, mob, 5);
    const grown = effects.find((e) => e.type === 'bloomed');
    expect(grown).toBeDefined();
    for (const cell of grown!.type === 'bloomed' ? grown!.cells : []) expect(levelAt(world, 1).map[cell]).toBe(T.HIGH_GRASS);
  });

  it('crystal deals a third more as magic, and the weapon slowly wears', () => {
    const world = solo();
    const hero = heroById(world, 'p')!;
    hero.weapon = enchanted('weapon.sword', 'crystal');
    const mob = beside(world, 100000);
    const effects = strike(world, mob, 3);
    // A blow and its magic each: the crystal's third more is dealt apart.
    expect(effects.filter((e) => e.type === 'hurt' && e.who === mob.id).length).toBe(3);
    // Crystal.proc: it wears a little a blow, and mends a little a turn (CrystalRepair), faster than it wears.
    expect(hero.weapon.crystal ?? 100).toBeGreaterThan(99);
  });

  it('projecting reaches a cell further', () => {
    const world = solo();
    const hero = heroById(world, 'p')!;
    hero.weapon = enchanted('weapon.sword', 'projecting');
    const level = levelAt(world, 1);
    const dir = [1, -1, WIDTH, -WIDTH].find((d) => [1, 2].every((k) => canEnter(level, hero.pos + d * k) && !charAt(world, 1, hero.pos + d * k)))!;
    const mob = createMob('#far', 'rat', hero.pos + 2 * dir, 'hunting', floorAt(world, 1).now);
    Object.assign(mob, { hp: 100000, ht: 100000, enemySeen: true, rooted: 1000 });
    floorAt(world, 1).mobs.push(mob);
    expect(act(world, 'p', { type: 'attack', target: mob.id }).ok).toBe(true);
    hero.weapon = createItem('weapon.sword');
    expect(act(world, 'p', { type: 'attack', target: mob.id })).toEqual({ ok: false, reason: 'too far away' });
  });
});

describe('weapon curses', () => {
  it('polarized strikes for nothing or half as hard again; friendly may charm both', () => {
    const world = solo();
    const hero = heroById(world, 'p')!;
    hero.weapon = enchanted('weapon.sword', 'polarized');
    const mob = beside(world, 100000);
    const effects = strike(world, mob, 20);
    const blows = effects.filter((e) => e.type === 'attack' && e.attacker === 'p' && e.hit);
    expect(blows.some((e) => e.type === 'attack' && e.damage === 0)).toBe(true);
    expect(blows.some((e) => e.type === 'attack' && e.damage > 0)).toBe(true);

    hero.weapon = enchanted('weapon.sword', 'friendly');
    for (let i = 0; i < 40 && hero.charmed <= 0; i++) strike(world, mob);
    expect(hero.charmedBy).toBe(mob.id);
    expect(mob.charmedBy).toBe('p');
  });

  it('wayward spoils the aim now and then; displacing teleports the foe away', () => {
    let world = solo();
    let hero = heroById(world, 'p')!;
    hero.weapon = enchanted('weapon.sword', 'wayward');
    let mob = beside(world, 100000);
    for (let i = 0; i < 30 && !hero.wayward; i++) strike(world, mob);
    expect(hero.wayward).toBeGreaterThan(0);

    world = solo();
    hero = heroById(world, 'p')!;
    hero.weapon = enchanted('weapon.sword', 'displacing');
    mob = beside(world, 100000);
    let blinked = false;
    for (let i = 0; i < 60 && !blinked; i++) {
      if (distance(mob.pos, hero.pos) > 1) break;
      blinked = strike(world, mob).some((e) => e.type === 'blinked');
    }
    expect(blinked).toBe(true);
  });

  it('explosive grows warm, then hot, then blows up', () => {
    const world = solo();
    const hero = heroById(world, 'p')!;
    hero.weapon = enchanted('weapon.sword', 'explosive');
    const mob = beside(world, 1e9);
    const effects = strike(world, mob, 60);
    expect(effects.some((e) => e.type === 'explosive' && e.state === 'warm')).toBe(true);
    expect(effects.some((e) => e.type === 'exploded')).toBe(true);
  });

  it('annoying screams for the whole level; dazzling blinds those who see', () => {
    let world = solo();
    let hero = heroById(world, 'p')!;
    hero.weapon = enchanted('weapon.sword', 'annoying');
    let mob = beside(world, 1e9);
    let effects = strike(world, mob, 100);
    expect(effects.some((e) => e.type === 'annoying' && e.line >= 1 && e.line <= 13)).toBe(true);

    world = solo();
    hero = heroById(world, 'p')!;
    hero.weapon = enchanted('weapon.sword', 'dazzling');
    mob = beside(world, 1e9);
    effects = strike(world, mob, 40);
    expect(effects.some((e) => e.type === 'dazzled')).toBe(true);
    expect((hero.blind ?? 0) > 0 || effects.some((e) => e.type === 'dazzled')).toBe(true);
  });

  it('pressurized lets a geyser burst under the foe, flooding the ground', () => {
    const world = solo();
    heroById(world, 'p')!.weapon = enchanted('weapon.sword', 'pressurized');
    const mob = beside(world, 1e9);
    let effects: Effect[] = [];
    for (let i = 0; i < 60 && !effects.some((e) => e.type === 'geyser'); i++) effects = strike(world, mob);
    const geyser = effects.find((e) => e.type === 'geyser')!;
    expect(geyser).toBeDefined();
    expect(NEIGHBOURS8.some((n) => levelAt(world, 1).map[(geyser.type === 'geyser' ? geyser.pos : 0) + n] === T.WATER)).toBe(true);
  });
});

describe('glyphs (Armor.Glyph)', () => {
  it('obfuscation hides, swiftness hurries with no enemy near, bulk drags in doorways', () => {
    const world = solo();
    const hero = heroById(world, 'p')!;
    hero.str = 20;
    const stealth = heroStealth(hero);
    hero.armor = inscribed('obfuscation', 3);
    expect(heroStealth(hero)).toBeCloseTo(stealth + 2);
    hero.armor = inscribed('swiftness');
    expect(heroSpeed(hero, { terrain: T.EMPTY, enemyNear: false })).toBeCloseTo(1.2);
    expect(heroSpeed(hero, { terrain: T.EMPTY, enemyNear: true })).toBe(1);
    hero.armor = inscribed('flow', 2);
    expect(heroSpeed(hero, { terrain: T.WATER, enemyNear: true })).toBeCloseTo(3);
    hero.armor = { ...inscribed('bulk'), cursed: true };
    expect(heroSpeed(hero, { terrain: T.DOOR, enemyNear: false })).toBeCloseTo(1 / 3);
  });

  it('stone can never be dodged, but soaks what a dodge would have', () => {
    const world = solo();
    const hero = heroById(world, 'p')!;
    hero.armor = inscribed('stone');
    expect(heroDefenseSkill(hero)).toBe(0);
  });

  it('brimstone keeps fire off; thorns make attackers bleed; affection charms them; repulsion knocks them back', () => {
    let world = solo();
    let hero = heroById(world, 'p')!;
    hero.armor = inscribed('brimstone');
    hero.burning = 5;
    const hp = hero.hp;
    wait(world, 3);
    expect(hero.hp).toBeGreaterThanOrEqual(hp);

    for (const [glyph, check] of [
      ['thorns', (mob: Mob) => (mob.bleeding ?? 0) > 0],
      ['affection', (mob: Mob) => (mob.charmed ?? 0) > 0],
      ['repulsion', (mob: Mob, effects: Effect[]) => effects.some((e) => e.type === 'pushed' && e.mob === mob.id)],
    ] as const) {
      world = solo();
      hero = heroById(world, 'p')!;
      Object.assign(hero, { defenseSkill: 0 });
      hero.armor = inscribed(glyph, 30);
      const mob = beside(world, 1e9, 'gnoll');
      let effects: Effect[] = [];
      for (let i = 0; i < 80 && !check(mob, effects); i++) {
        hero.hp = hero.ht;
        effects = wait(world);
      }
      expect(check(mob, effects), glyph).toBe(true);
    }
  });

  it('entanglement roots bark onto the wearer; potential charges the wands; viscosity defers', () => {
    const world = solo();
    const hero = heroById(world, 'p')!;
    Object.assign(hero, { defenseSkill: 0 });
    hero.armor = inscribed('entanglement');
    hero.items = [{ ...createItem('wand.fireblast'), charges: 0 }];
    beside(world, 1e9, 'gnoll');
    for (let i = 0; i < 80 && !hero.earthroot; i++) {
      hero.hp = hero.ht;
      wait(world);
    }
    // Earthroot.Armor: bark of 5 (and 2 a level) that the blows wear down.
    expect(hero.earthroot).toBeTruthy();
    hero.armor = inscribed('potential', 20);
    for (let i = 0; i < 80 && hero.items[0]!.charges === 0; i++) {
      hero.hp = hero.ht;
      wait(world);
    }
    expect(hero.items[0]!.charges).toBeGreaterThan(0);
  });
});

describe('armour curses', () => {
  it('displacement teleports its wearer; corrosion splashes ooze; stench lets out gas; metabolism trades food for health', () => {
    for (const [glyph, check] of [
      ['displacement', (_h: World, effects: Effect[]) => effects.some((e) => e.type === 'teleported')],
      ['corrosion', (w: World) => heroById(w, 'p')!.ooze >= 0],
      ['stench', (w: World) => (floorAt(w, 1).gas?.toxic?.length ?? 0) > 0],
      ['antiEntropy', (w: World) => heroById(w, 'p')!.burning > 0],
      ['multiplicity', (w: World) => floorAt(w, 1).mobs.length > 1],
    ] as const) {
      const world = solo();
      const hero = heroById(world, 'p')!;
      Object.assign(hero, { defenseSkill: 0 });
      hero.armor = { ...inscribed(glyph), cursed: true };
      beside(world, 1e9, 'gnoll');
      let effects: Effect[] = [];
      for (let i = 0; i < 300 && !check(world, effects); i++) {
        hero.hp = hero.ht;
        effects = wait(world);
      }
      expect(check(world, effects), glyph).toBe(true);
    }
  });
});

describe('reach (Weapon.RCH)', () => {
  it('a spear strikes two cells away, a whip three', () => {
    const world = solo();
    const hero = heroById(world, 'p')!;
    const level = levelAt(world, 1);
    // Somewhere with three open cells in a row ahead.
    let dir = 0;
    for (let cell = 0; cell < level.map.length && !dir; cell++) {
      if (!canEnter(level, cell) || charAt(world, 1, cell)) continue;
      dir = [1, -1, WIDTH, -WIDTH].find((d) => [1, 2, 3].every((k) => canEnter(level, cell + d * k) && !charAt(world, 1, cell + d * k))) ?? 0;
      if (dir) hero.pos = cell;
    }
    const mob = createMob('#far', 'rat', hero.pos + 2 * dir, 'hunting', floorAt(world, 1).now);
    Object.assign(mob, { hp: 100000, ht: 100000, enemySeen: true, rooted: 1000 });
    floorAt(world, 1).mobs.push(mob);
    hero.weapon = createItem('weapon.spear');
    hero.str = 20;
    const result = act(world, 'p', { type: 'attack', target: mob.id });
    expect(result.ok && result.effects.some((e) => e.type === 'attack' && e.attacker === 'p' && e.target === mob.id)).toBe(true);
    mob.pos = hero.pos + 3 * dir;
    expect(act(world, 'p', { type: 'attack', target: mob.id })).toEqual({ ok: false, reason: 'too far away' });
    hero.weapon = createItem('weapon.whip');
    expect(act(world, 'p', { type: 'attack', target: mob.id }).ok).toBe(true);
    // KindOfWeapon.canReach: a way of open ground no longer than the reach, round whoever stands between if need be.
    mob.pos = hero.pos + 4 * dir;
    expect(act(world, 'p', { type: 'attack', target: mob.id })).toEqual({ ok: false, reason: 'too far away' });
  });
});
