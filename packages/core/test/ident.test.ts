import { describe, expect, it } from 'vitest';
import {
  act, addHero, canEnter, charAt, createItem, createMob, createWorld, type Effect, floorAt, type HeroClass, heroById, isIdentified, type Item,
  ItemGenerator, itemDef, itemPrice, levelAt, NEIGHBOURS8, Rng, scrollTargets, type World,
} from '../src/index';
import { pacify } from './helpers';

/** As the Generator would make it: neither its level nor its curse known (a wand's charges neither). */
const unknown = (item: Item): Item => ({
  ...item, levelUnknown: true, curseUnknown: true, ...(itemDef(item.kind).category === 'wand' ? { chargesUnknown: true } : {}),
});

/** A hero beside a rat that never dies. */
function sparring(): { world: World; rat: string } {
  const world = pacify(createWorld(5));
  addHero(world, { id: 'p', name: 'P', heroClass: 'warrior' });
  const hero = heroById(world, 'p')!;
  Object.assign(hero, { str: 20, ht: 1e6, hp: 1e6 });
  const level = levelAt(world, 1);
  const floor = floorAt(world, 1);
  const pos = NEIGHBOURS8.map((n) => hero.pos + n).find((c) => canEnter(level, c) && !charAt(world, 1, c))!;
  const rat = createMob('#rat', 'rat', pos, 'hunting', floor.now);
  Object.assign(rat, { ht: 1e9, hp: 1e9, enemy: hero.id, target: hero.pos });
  floor.mobs.push(rat);
  return { world, rat: rat.id };
}

/** Slays a frail rat beside the hero, for the experience (a rat is a tenth of the first level). */
function slayRat(world: World): Effect[] {
  const hero = heroById(world, 'p')!;
  const level = levelAt(world, hero.depth);
  const floor = floorAt(world, hero.depth);
  const pos = NEIGHBOURS8.map((n) => hero.pos + n).find((c) => canEnter(level, c) && !charAt(world, hero.depth, c))!;
  const rat = createMob(`#frail${world.turn}`, 'rat', pos, 'hunting', floor.now);
  Object.assign(rat, { hp: 1, ht: 1, enemySeen: false });
  floor.mobs.push(rat);
  const skill = hero.attackSkill;
  hero.attackSkill = 1e6;
  const effects: Effect[] = [];
  while (floor.mobs.includes(rat)) {
    const result = act(world, 'p', { type: 'attack', target: rat.id });
    if (result.ok) effects.push(...result.effects);
  }
  hero.attackSkill = skill;
  return effects;
}

const landed = (effects: Effect[], attacker: string): number =>
  effects.filter((e) => e.type === 'attack' && e.attacker === attacker && e.hit).length;

describe('identification (Item.levelKnown, cursedKnown)', () => {
  it('weapons, armour, rings and wands are found knowing nothing of their level or curse; thrown weapons hide nothing', () => {
    const generator = new ItemGenerator(Rng.seeded(7), 5);
    for (let i = 0; i < 300; i++) {
      const item = generator.of(['weapon', 'armor', 'ring', 'wand'][i % 4] as 'weapon' | 'armor' | 'ring' | 'wand');
      const category = itemDef(item.kind).category;
      if (category === 'missile') {
        expect(item.levelUnknown).toBeUndefined();
        continue;
      }
      expect(item).toMatchObject({ levelUnknown: true, curseUnknown: true });
      expect(item.chargesUnknown).toBe(category === 'wand' ? true : undefined);
    }
  });

  it('heroes set out knowing everything about their own kit', () => {
    for (const heroClass of ['warrior', 'mage', 'rogue', 'huntress'] as HeroClass[]) {
      const world = createWorld(3);
      const hero = addHero(world, { id: 'p', name: 'P', heroClass });
      for (const item of [hero.weapon, hero.armor, ...hero.rings, ...hero.items]) {
        if (item) expect(isIdentified(world, item), `${heroClass}: ${item.kind}`).toBe(true);
      }
    }
  });

  it('a weapon is known after twenty blows that land, ten of them ready at first and the rest as experience comes (Weapon.proc)', () => {
    const { world, rat } = sparring();
    const hero = heroById(world, 'p')!;
    hero.weapon = unknown(createItem('weapon.sword', 1, 2));
    const effects: Effect[] = [];
    const strike = (until: number): void => {
      while (landed(effects, 'p') < until) {
        const result = act(world, 'p', { type: 'attack', target: rat });
        if (result.ok) effects.push(...result.effects);
      }
    };
    strike(25);
    // Ten blows' worth spent, the rest wait for experience.
    expect(hero.weapon).toMatchObject({ levelUnknown: true, usesLeftToID: 10, availableUsesToID: 0 });
    // More sparring teaches nothing more.
    strike(40);
    expect(hero.weapon).toMatchObject({ levelUnknown: true, usesLeftToID: 10, availableUsesToID: 0 });
    // Experience readies two uses a rat (a tenth of a level); the blow that slays it spends one.
    effects.push(...slayRat(world));
    expect(hero.weapon).toMatchObject({ usesLeftToID: 10, availableUsesToID: 2 });
    effects.push(...slayRat(world));
    expect(hero.weapon).toMatchObject({ usesLeftToID: 9, availableUsesToID: 3 });
    for (let i = 0; i < 3; i++) effects.push(...slayRat(world));
    expect(hero.weapon).toMatchObject({ usesLeftToID: 6, availableUsesToID: 6 });
    expect(effects.some((e) => e.type === 'familiar')).toBe(false);
    strike(landed(effects, 'p') + 6);
    // Weapon.identify: known through and through, the curse too.
    expect(hero.weapon.levelUnknown).toBeUndefined();
    expect(hero.weapon.curseUnknown).toBeUndefined();
    expect(effects.filter((e) => e.type === 'familiar')).toEqual([{ type: 'familiar', hero: 'p', item: hero.weapon, learned: false }]);
  });

  it('armour is known after ten blows taken, five ready at first (Armor.proc, Armor.onHeroGainExp)', () => {
    const { world, rat } = sparring();
    const hero = heroById(world, 'p')!;
    hero.armor = unknown(createItem('armor.leather', 1, -1));
    const effects: Effect[] = [];
    const endure = (blows: number): void => {
      const target = landed(effects, rat) + blows;
      for (let turn = 0; turn < 2000 && landed(effects, rat) < target; turn++) {
        hero.hp = hero.ht;
        const result = act(world, 'p', { type: 'wait' });
        if (result.ok) effects.push(...result.effects);
      }
    };
    endure(8);
    expect(hero.armor).toMatchObject({ levelUnknown: true, usesLeftToID: 5, availableUsesToID: 0 });
    // Half a level's experience readies the other five (a rat is a tenth: one use each).
    for (let i = 0; i < 5; i++) effects.push(...slayRat(world));
    for (let turn = 0; turn < 2000 && !effects.some((e) => e.type === 'familiar'); turn++) {
      hero.hp = hero.ht;
      const result = act(world, 'p', { type: 'wait' });
      if (result.ok) effects.push(...result.effects);
    }
    expect(hero.armor.levelUnknown).toBeUndefined();
  });

  it('putting something on tells whether it is cursed, and a cursed thing binds itself', () => {
    const world = pacify(createWorld(5));
    const hero = addHero(world, { id: 'p', name: 'P', heroClass: 'warrior' });
    hero.items = [unknown({ ...createItem('weapon.mace', 1, -2), cursed: true }), unknown(createItem('ring.mending', 1, 2))];
    const first = act(world, 'p', { type: 'equip', item: 0 });
    expect(hero.weapon).toMatchObject({ kind: 'weapon.mace', cursed: true, levelUnknown: true });
    expect(hero.weapon!.curseUnknown).toBeUndefined();
    expect(first.ok && first.effects.some((e) => e.type === 'cursedEquip')).toBe(true);
    const ring = hero.items.findIndex((item) => item.kind === 'ring.mending');
    act(world, 'p', { type: 'equip', item: ring });
    expect(hero.rings[0]!.curseUnknown).toBeUndefined();
    expect(hero.rings[0]!.levelUnknown).toBe(true);
  });

  it('a ring worn for a level of experience is known through and through, its kind for the whole party (Ring.onHeroGainExp)', () => {
    const world = pacify(createWorld(5));
    const hero = addHero(world, { id: 'p', name: 'P', heroClass: 'warrior' });
    hero.rings = [{ ...unknown(createItem('ring.mending', 1, 1)), curseUnknown: undefined }];
    const effects: Effect[] = [];
    // Time alone teaches nothing now.
    for (let i = 0; i < 250; i++) {
      hero.hunger = 0;
      const result = act(world, 'p', { type: 'wait' });
      if (result.ok) effects.push(...result.effects);
    }
    expect(isIdentified(world, hero.rings[0]!)).toBe(false);
    for (let i = 0; i < 11 && !isIdentified(world, hero.rings[0]!); i++) effects.push(...slayRat(world));
    expect(isIdentified(world, hero.rings[0]!)).toBe(true);
    expect(world.known).toContain('ring.mending');
    expect(effects.filter((e) => e.type === 'familiar')).toEqual([{ type: 'familiar', hero: 'p', item: hero.rings[0], learned: true }]);
  });

  it('a scroll of identify is read on anything not yet identified, and reveals all of it', () => {
    const world = pacify(createWorld(5));
    const hero = addHero(world, { id: 'p', name: 'P', heroClass: 'mage' });
    hero.items = [createItem('scroll.identify', 2), unknown({ ...createItem('armor.mail', 1, -1), cursed: true }), createItem('food.ration')];
    expect(world.known).toContain('scroll.identify');
    expect(scrollTargets(world, hero, 'scroll.identify')).toEqual([1]);
    const result = act(world, 'p', { type: 'use', item: 0, on: 1 });
    expect(result.ok).toBe(true);
    const armor = hero.items[1]!;
    expect(isIdentified(world, armor)).toBe(true);
    expect(result.ok && result.effects.some((e) => e.type === 'revealed' && e.item === armor)).toBe(true);
    expect(scrollTargets(world, hero, 'scroll.identify')).toEqual([]);
  });

  it('a wand of unknown charges may be zapped empty: it fizzles, and its level is known', () => {
    const world = pacify(createWorld(5));
    const hero = addHero(world, { id: 'p', name: 'P', heroClass: 'warrior' });
    hero.items = [{ ...unknown(createItem('wand.slowness', 1, 1)), charges: 0 }];
    const result = act(world, 'p', { type: 'zap', item: 0, target: hero.pos + 2 });
    expect(result.ok && result.effects.some((e) => e.type === 'fizzled')).toBe(true);
    expect(hero.items[0]).toMatchObject({ charges: 0, chargesUnknown: true });
    expect(hero.items[0]!.levelUnknown).toBeUndefined();
    // Known to be empty, it is not zapped at all.
    hero.items[0]!.chargesUnknown = false;
    expect(act(world, 'p', { type: 'zap', item: 0, target: hero.pos + 2 }).ok).toBe(false);
  });

  it('winning makes everything the heroes carry known (Dungeon.win)', () => {
    const world = pacify(createWorld(7));
    const hero = addHero(world, { id: 'p', name: 'P', heroClass: 'warrior' });
    hero.pos = levelAt(world, 1).entrance;
    floorAt(world, 1).heaps.push({ pos: hero.pos, kind: 'heap', items: [createItem('quest.amulet')] });
    hero.items.push(unknown(createItem('ring.haste', 1, 2)), createItem('potion.purity'));
    act(world, 'p', { type: 'pickup' });
    expect(act(world, 'p', { type: 'endGame' }).ok).toBe(true);
    expect(world.victory).toBe(true);
    for (const item of hero.items) expect(isIdentified(world, item), item.kind).toBe(true);
  });

  it('the price takes in only what is known (Item.considerState)', () => {
    const sword = createItem('weapon.sword', 1, 2);
    expect(itemPrice(sword, true)).toBe(80 * 3);
    expect(itemPrice(unknown(sword), true)).toBe(80);
    const cursed = { ...createItem('weapon.sword', 1, -1), cursed: true };
    expect(itemPrice(cursed, true)).toBe(20);
    expect(itemPrice(unknown(cursed), true)).toBe(80);
  });

  it('a well of awareness drunk from: what is worn is known through and through, and the curses of the rest', () => {
    for (let seed = 1; seed < 400; seed++) {
      const world = createWorld(seed * 7);
      for (let depth = 1; depth <= 4; depth++) {
        const level = levelAt(world, depth);
        const well = level.wells.find((w) => w.water === 'awareness');
        if (!well) continue;
        const from = NEIGHBOURS8.map((n) => well.pos + n).find((c) => canEnter(level, c) && !charAt(world, depth, c));
        if (from === undefined) continue;
        pacify(world);
        const hero = addHero(world, { id: 'p', name: 'P', heroClass: 'warrior' });
        Object.assign(hero, { depth, pos: from, time: floorAt(world, depth).now });
        hero.weapon = unknown(createItem('weapon.spear', 1, 1));
        hero.rings = [{ ...unknown(createItem('ring.evasion', 1, 2)), curseUnknown: undefined }];
        hero.items = [unknown({ ...createItem('armor.scale', 1, -2), cursed: true }), createItem('potion.frost')];
        const result = act(world, 'p', { type: 'move', to: well.pos });
        expect(result.ok && result.effects.some((e) => e.type === 'well' && e.water === 'awareness')).toBe(true);
        expect(isIdentified(world, hero.weapon)).toBe(true);
        expect(isIdentified(world, hero.rings[0]!)).toBe(true);
        expect(world.known).toContain('ring.evasion');
        expect(hero.items[0]).toMatchObject({ cursed: true, levelUnknown: true });
        expect(hero.items[0]!.curseUnknown).toBeUndefined();
        // Belongings.observe: the potions and scrolls carried stay as unknown as they were.
        expect(world.known).not.toContain('potion.frost');
        return;
      }
    }
    throw new Error('no well of awareness');
  });

  it('dropped into a well of awareness, an item is revealed and the well runs dry (WaterOfAwareness.affectItem)', () => {
    for (let seed = 1; seed < 400; seed++) {
      const world = pacify(createWorld(seed * 7));
      for (let depth = 1; depth <= 4; depth++) {
        const level = levelAt(world, depth);
        const well = level.wells.find((w) => w.water === 'awareness');
        if (!well) continue;
        const hero = addHero(world, { id: 'p', name: 'P', heroClass: 'warrior' });
        Object.assign(hero, { depth, pos: well.pos, time: floorAt(world, depth).now });
        hero.items = [unknown(createItem('wand.blink', 1, 2))];
        const result = act(world, 'p', { type: 'drop', item: 0 });
        expect(result.ok && result.effects.some((e) => e.type === 'revealed')).toBe(true);
        const wand = floorAt(world, depth).heaps.find((h) => h.pos === well.pos)!.items[0]!;
        expect(isIdentified(world, wand)).toBe(true);
        expect(level.wells.some((w) => w.pos === well.pos)).toBe(false);
        return;
      }
    }
    throw new Error('no well of awareness');
  });
});
