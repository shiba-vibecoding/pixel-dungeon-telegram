import { describe, expect, it } from 'vitest';
import {
  act, type Action, addHero, canEnter, charAt, createItem, createMob, createWorld, drawFromDeck, energyValue, floorAt, heroById, type Hero, type Item,
  itemDef, ITEMS, type ItemKind, labelKind, levelAt, NEIGHBOURS8, recipesFor, REGULAR_POTIONS, Rng, T, WIDTH, type World,
} from '../src/index';
import { checkInvariants, pacify } from './helpers';

/** A hero beside an alchemy pot (laid on a free cell next to them), with nothing in the pack. */
function atPot(seed = 11, heroClass: 'warrior' | 'mage' = 'warrior'): { world: World; hero: Hero; pot: number } {
  const world = pacify(createWorld(seed));
  const hero = addHero(world, { id: 'p', name: 'P', heroClass });
  hero.items = [];
  Object.assign(hero, { hp: 300, ht: 300 });
  const level = levelAt(world, 1);
  // Somewhere with open floor four cells along at least one way, the pot just behind.
  const open = (c: number): boolean =>
    canEnter(level, c) && [T.EMPTY, T.EMPTY_SP, T.GRASS, T.EMPTY_DECO].includes(level.map[c] as 1) && !charAt(world, 1, c);
  for (let c = 0; c < level.map.length; c++) {
    for (const dir of [1, -1, WIDTH, -WIDTH]) {
      if (!open(c) || !open(c - dir) || ![1, 2, 3, 4].every((k) => open(c + dir * k))) continue;
      hero.pos = c;
      level.map[c - dir] = T.ALCHEMY;
      return { world, hero, pot: c - dir };
    }
  }
  throw new Error('no room for a pot');
}

const know = (world: World, ...kinds: ItemKind[]): void => {
  for (const kind of kinds) if (!world.known.includes(labelKind(kind))) world.known.push(labelKind(kind));
};
const slot = (hero: Hero, kind: ItemKind): number => hero.items.findIndex((item) => item.kind === kind);
const qty = (hero: Hero, kind: ItemKind): number => hero.items.filter((item) => item.kind === kind).reduce((n, item) => n + item.qty, 0);

/** An open cell a few steps from the hero, in a straight line, with a rat on it if asked. */
function lineFrom(world: World, hero: Hero, steps = 3): number {
  const level = levelAt(world, hero.depth);
  for (const dir of [1, -1, WIDTH, -WIDTH]) {
    const cells = Array.from({ length: steps }, (_, k) => hero.pos + dir * (k + 1));
    if (cells.every((c) => canEnter(level, c) && level.map[c] !== T.DOOR && level.map[c] !== T.ALCHEMY && !charAt(world, hero.depth, c))) return cells.at(-1)!;
  }
  throw new Error('no open line');
}

function ratAt(world: World, pos: number, hp = 200): ReturnType<typeof createMob> {
  const rat = createMob(`#rat${pos}`, 'rat', pos, 'hunting', floorAt(world, 1).now);
  Object.assign(rat, { enemy: 'p', hp, ht: hp });
  floorAt(world, 1).mobs.push(rat);
  return rat;
}

describe('alchemical energy', () => {
  it('comes from energy crystals picked up, and from items turned into energy at the pot', () => {
    const { world, hero } = atPot();
    floorAt(world, 1).heaps.push({ pos: hero.pos, kind: 'heap', items: [createItem('energy', 5)] });
    expect(act(world, 'p', { type: 'pickup' }).ok).toBe(true);
    expect(world.energy).toBe(5);
    expect(hero.items).toEqual([]);
    // WndEnergizeItem: a known potion of strength is worth 10, a runestone 3 (one of a stack, or all).
    hero.items = [createItem('potion.strength'), createItem('stone.blink', 3)];
    know(world, 'potion.strength');
    expect(act(world, 'p', { type: 'energize', item: 0 }).ok).toBe(true);
    expect(world.energy).toBe(15);
    expect(act(world, 'p', { type: 'energize', item: 0 }).ok).toBe(true);
    expect(qty(hero, 'stone.blink')).toBe(2);
    expect(act(world, 'p', { type: 'energize', item: 0, all: true }).ok).toBe(true);
    expect(world.energy).toBe(24);
    hero.items = [createItem('weapon.sword')];
    expect(act(world, 'p', { type: 'energize', item: 0 })).toEqual({ ok: false, reason: 'that holds no energy' });
  });

  it('values unknown potions and scrolls plainly, so energy gives nothing away', () => {
    const strength = createItem('potion.strength');
    expect(energyValue(strength, false)).toBe(6);
    expect(energyValue(strength, true)).toBe(10);
    expect(energyValue(createItem('potion.mastery'), true)).toBe(14);
    expect(energyValue(createItem('scroll.enchantment'), true)).toBe(16);
    expect(energyValue(createItem('spell.phaseShift', 6), true)).toBe(12);
    expect(energyValue(createItem('trinket.clover'), true)).toBe(5);
  });
});

describe('the alchemy pot', () => {
  it('brews three seeds into a potion, known when they are all of a kind', () => {
    const { world, hero } = atPot();
    hero.items = [createItem('seed.sungrass', 3)];
    expect(recipesFor(world, hero, [0, 0, 0]).map((r) => [r.id, r.cost, r.output])).toEqual([['seedToPotion', 0, null]]);
    const result = act(world, 'p', { type: 'alchemy', inputs: [0, 0, 0] });
    expect(result.ok && result.effects.find((e) => e.type === 'crafted')).toBeTruthy();
    expect(hero.items).toHaveLength(1);
    expect(itemDef(hero.items[0]!.kind).category).toBe('potion');
    expect(world.known).toContain(hero.items[0]!.kind);
    expect(hero.stats?.brewed).toBe(1);
  });

  it('works only at a pot, and takes no time', () => {
    const { world, hero, pot } = atPot();
    hero.items = [createItem('seed.sungrass', 3)];
    const time = hero.time;
    expect(act(world, 'p', { type: 'alchemy', inputs: [0, 0, 0] }).ok).toBe(true);
    expect(hero.time).toBe(time);
    levelAt(world, 1).map[pot] = T.EMPTY;
    hero.items = [createItem('seed.sungrass', 3)];
    expect(act(world, 'p', { type: 'alchemy', inputs: [0, 0, 0] })).toEqual({ ok: false, reason: 'you need an alchemy pot' });
  });

  it('wants enough energy, and what the ingredients make', () => {
    const { world, hero } = atPot();
    hero.items = [createItem('potion.healing'), createItem('weapon.sword')];
    expect(act(world, 'p', { type: 'alchemy', inputs: [0] })).toEqual({ ok: false, reason: 'not enough energy' });
    world.energy = 4;
    // ExoticPotion.PotionToExotic: any potion, known or not, for four energy.
    expect(recipesFor(world, hero, [0])).toEqual([{ id: 'potionToExotic', cost: 4, output: createItem('potion.shielding'), qty: 1 }]);
    expect(act(world, 'p', { type: 'alchemy', inputs: [0] }).ok).toBe(true);
    expect(world.energy).toBe(0);
    expect(hero.items.map((i) => i.kind)).toEqual(['weapon.sword', 'potion.shielding']);
    expect(act(world, 'p', { type: 'alchemy', inputs: [0] })).toEqual({ ok: false, reason: 'that cannot go into the pot' });
    expect(act(world, 'p', { type: 'alchemy', inputs: [1, 1] })).toEqual({ ok: false, reason: 'not enough of that' });
  });

  it('makes brews and elixirs of known potions only (Recipe.SimpleRecipe)', () => {
    const { world, hero } = atPot();
    world.energy = 100;
    hero.items = [createItem('potion.frost'), createItem('potion.toxicGas'), createItem('quest.gooBlob')];
    expect(recipesFor(world, hero, [0]).map((r) => r.id)).toEqual(['potionToExotic']);
    know(world, 'potion.frost', 'potion.toxicGas');
    expect(recipesFor(world, hero, [0]).map((r) => [r.id, r.cost, r.output?.kind])).toEqual([
      ['potionToExotic', 4, 'potion.snapFreeze'], ['simple', 8, 'brew.blizzard'],
    ]);
    expect(act(world, 'p', { type: 'alchemy', inputs: [0], recipe: 1 }).ok).toBe(true);
    expect(world.energy).toBe(92);
    expect(slot(hero, 'brew.blizzard')).toBeGreaterThanOrEqual(0);
    // CausticBrew: toxic gas and goo, for one energy.
    expect(act(world, 'p', { type: 'alchemy', inputs: [slot(hero, 'potion.toxicGas'), slot(hero, 'quest.gooBlob')] }).ok).toBe(true);
    expect(qty(hero, 'brew.caustic')).toBe(1);
    expect(world.energy).toBe(91);
  });

  it('uses only as much of a stack as a recipe needs (ten of fifteen liquid metal)', () => {
    const { world, hero } = atPot();
    world.energy = 10;
    hero.items = [createItem('liquidMetal', 15)];
    expect(act(world, 'p', { type: 'alchemy', inputs: [0] }).ok).toBe(true);
    expect(qty(hero, 'liquidMetal')).toBe(5);
    expect(qty(hero, 'spell.telekineticGrab')).toBe(8);
  });

  it('turns scrolls into runestones, known for what they were', () => {
    const { world, hero } = atPot();
    hero.items = [createItem('scroll.teleportation', 2)];
    expect(recipesFor(world, hero, [0])[0]).toEqual({ id: 'scrollToStone', cost: 0, output: null, qty: 2 });
    expect(act(world, 'p', { type: 'alchemy', inputs: [0] }).ok).toBe(true);
    expect(qty(hero, 'stone.blink')).toBe(2);
    expect(qty(hero, 'scroll.teleportation')).toBe(1);
    expect(world.known).toContain('scroll.teleportation');
  });

  it('cooks meat, a pie, and blandfruit with a seed', () => {
    const { world, hero } = atPot();
    world.energy = 20;
    hero.items = [createItem('food.meat', 3), createItem('food.pasty'), createItem('food.ration'), createItem('food.blandfruit'), createItem('seed.firebloom')];
    expect(act(world, 'p', { type: 'alchemy', inputs: [0, 0, 0] }).ok).toBe(true);
    expect(qty(hero, 'food.stewed')).toBe(3);
    expect(act(world, 'p', { type: 'alchemy', inputs: [slot(hero, 'food.pasty'), slot(hero, 'food.ration'), slot(hero, 'food.stewed')] }).ok).toBe(true);
    expect(qty(hero, 'food.meatPie')).toBe(1);
    expect(act(world, 'p', { type: 'alchemy', inputs: [slot(hero, 'food.blandfruit'), slot(hero, 'seed.firebloom')] }).ok).toBe(true);
    expect(hero.items.find((i) => i.kind === 'food.blandfruit')!.potion).toBe('potion.liquidFlame');
    // Eaten, the pie keeps hunger away (WellFed).
    hero.hunger = 300;
    act(world, 'p', { type: 'use', item: slot(hero, 'food.meatPie') });
    expect(hero.hunger).toBe(0);
    expect(hero.buffs?.wellFed).toBeGreaterThan(0);
  });

  it('makes better bombs out of a bomb and something known', () => {
    const { world, hero } = atPot();
    world.energy = 3;
    hero.items = [createItem('bomb'), createItem('potion.frost')];
    expect(recipesFor(world, hero, [0, 1])).toEqual([]);
    know(world, 'potion.frost');
    expect(recipesFor(world, hero, [0, 1])).toEqual([{ id: 'enhanceBomb', cost: 0, output: createItem('bomb.frost'), qty: 1 }]);
    expect(act(world, 'p', { type: 'alchemy', inputs: [0, 1] }).ok).toBe(true);
    expect(hero.items.map((i) => i.kind)).toEqual(['bomb.frost']);
  });

  it('turns the trinket catalyst into one of four trinkets, chosen', () => {
    const { world, hero } = atPot();
    world.energy = 6;
    hero.items = [createItem('trinket.catalyst')];
    expect(act(world, 'p', { type: 'use', item: 0, choice: 0 })).toEqual({ ok: false, reason: 'brew it in an alchemy pot first' });
    const result = act(world, 'p', { type: 'alchemy', inputs: [0] });
    expect(result.ok && result.effects.find((e) => e.type === 'catalyst')).toBeTruthy();
    const rolled = hero.items[0]!.rolled!;
    expect(rolled).toHaveLength(4);
    expect(new Set(rolled).size).toBe(4);
    expect(act(world, 'p', { type: 'use', item: 0, choice: 2 }).ok).toBe(true);
    expect(hero.items.map((i) => i.kind)).toEqual([rolled[2]]);
    // Trinket.UpgradeTrinket: six energy the first time, two more each level, up to +3.
    world.energy = 6;
    expect(act(world, 'p', { type: 'alchemy', inputs: [0] }).ok).toBe(true);
    expect(hero.items[0]!.level).toBe(1);
    expect(recipesFor(world, hero, [0])[0]!.cost).toBe(rolled[2] === 'trinket.mossyClump' || rolled[2] === 'trinket.parchmentScrap' || rolled[2] === 'trinket.wondrousResin' ? 15 : 8);
  });

  it('deals the trinkets like cards, each once until the deck is spent', () => {
    const run = { seed: 5 };
    const dealt = Array.from({ length: 17 }, () => drawFromDeck(run, 'trinket'));
    expect(new Set(dealt).size).toBe(17);
    // Potions: never strength, and over two decks the odds of Generator.Category.POTION.
    const potions = Array.from({ length: 30 }, () => drawFromDeck(run, 'potion'));
    expect(potions).not.toContain('potion.strength');
    expect(potions.filter((k) => k === 'potion.healing')).toHaveLength(6);
    expect(potions.filter((k) => k === 'potion.experience')).toHaveLength(1);
  });

  it('never breaks the world, whatever goes into the pot', () => {
    const kinds = (Object.keys(ITEMS) as ItemKind[]).filter((k) => k !== 'gold' && k !== 'quest.amulet');
    for (let seed = 1; seed <= 6; seed++) {
      const rng = Rng.seeded(seed);
      const { world, hero } = atPot(seed);
      world.energy = 500;
      for (let step = 0; step < 300; step++) {
        if (hero.items.length < 6) {
          const kind = rng.oneOf(kinds);
          const item: Item = createItem(kind, itemDef(kind).category === 'missile' || kind === 'liquidMetal' ? 12 : rng.intRange(1, 3));
          hero.items.push(item);
          if (rng.int(2) === 0) know(world, kind);
        }
        const n = rng.intRange(1, 3);
        const inputs = Array.from({ length: n }, () => rng.int(hero.items.length));
        const action: Action = rng.int(5) === 0
          ? { type: 'energize', item: rng.int(hero.items.length), all: rng.int(2) === 0 }
          : rng.int(4) === 0 ? { type: 'use', item: rng.int(hero.items.length), choice: rng.int(4), on: rng.int(hero.items.length), cell: hero.pos + rng.oneOf(NEIGHBOURS8) * 2 }
          : { type: 'alchemy', inputs, recipe: rng.int(2) };
        act(world, 'p', action);
        checkInvariants(world);
        if (world.over) break;
        if (hero.items.length > 14) hero.items.splice(0, 8);
      }
    }
  });
});

describe('exotic potions and scrolls', () => {
  it('are known with their ordinary counterpart, and drawn a row below it', () => {
    const { world, hero } = atPot();
    hero.items = [createItem('potion.healing'), createItem('potion.shielding')];
    expect(world.known).not.toContain('potion.healing');
    act(world, 'p', { type: 'use', item: 0 });
    expect(world.known).toContain('potion.healing');
    expect(REGULAR_POTIONS).toHaveLength(12);
    // Shielding: a barrier of 60% of the most health, and ten, that takes the blows.
    act(world, 'p', { type: 'use', item: 0 });
    // (It has waned a point over the turn the drinking took.)
    expect(hero.buffs?.barrier?.shield).toBe(189);
  });

  it('a potion of mastery makes a weapon easier to wield', () => {
    const { world, hero } = atPot();
    know(world, 'potion.mastery');
    hero.items = [createItem('potion.mastery')];
    expect(act(world, 'p', { type: 'use', item: 0 })).toEqual({ ok: false, reason: 'choose a weapon or armour' });
    expect(act(world, 'p', { type: 'use', item: 0, on: 'weapon' }).ok).toBe(true);
    expect(hero.weapon!.mastery).toBe(true);
  });

  it("dragon's breath sets a cone alight, burning and crippling who is in it", () => {
    const { world, hero } = atPot();
    know(world, 'potion.dragonsBreath');
    const far = lineFrom(world, hero, 3);
    const rat = ratAt(world, far);
    rat.paralysed = 5;
    hero.items = [createItem('potion.dragonsBreath')];
    expect(act(world, 'p', { type: 'use', item: 0, cell: far }).ok).toBe(true);
    expect(rat.burning).toBeGreaterThan(0);
    expect(rat.crippled).toBeGreaterThan(0);
  });

  it('a scroll of transmutation swaps a potion for its exotic counterpart', () => {
    const { world, hero } = atPot();
    know(world, 'scroll.transmutation');
    hero.items = [createItem('scroll.transmutation'), createItem('potion.strength', 2)];
    expect(act(world, 'p', { type: 'use', item: 0, on: 1 }).ok).toBe(true);
    expect(hero.items.map((i) => [i.kind, i.qty])).toEqual([['potion.strength', 1], ['potion.mastery', 1]]);
  });

  it('a scroll of passage goes back to the first floor of the region', () => {
    const { world, hero } = atPot();
    levelAt(world, 8);
    hero.depth = 8;
    hero.pos = levelAt(world, 8).entrance;
    hero.items = [createItem('scroll.passage')];
    know(world, 'scroll.passage');
    expect(act(world, 'p', { type: 'use', item: 0 }).ok).toBe(true);
    expect(hero.depth).toBe(6);
  });

  it("a siren's song makes a monster an ally, which fights the others", () => {
    const { world, hero } = atPot();
    know(world, 'scroll.sirensSong');
    const far = lineFrom(world, hero, 2);
    const rat = ratAt(world, far, 8);
    hero.items = [createItem('scroll.sirensSong')];
    expect(act(world, 'p', { type: 'use', item: 0, cell: far }).ok).toBe(true);
    expect(rat.ally).toBe('p');
    // Walking into an ally swaps places with it.
    const other = ratAt(world, lineFrom(world, hero, 4), 50);
    for (let i = 0; i < 20 && other.hp === 50; i++) act(world, 'p', { type: 'wait' });
    expect(other.hp).toBeLessThan(50);
  });
});

describe("Shattered's own potions and scrolls", () => {
  it('haste triples the speed of a hero for twenty turns', () => {
    const { world, hero } = atPot();
    hero.items = [createItem('potion.haste')];
    act(world, 'p', { type: 'use', item: 0 });
    expect(hero.buffs?.haste).toBeGreaterThan(0);
    const time = hero.time;
    const to = NEIGHBOURS8.map((n) => hero.pos + n).find((c) => canEnter(levelAt(world, 1), c) && !charAt(world, 1, c) && levelAt(world, 1).map[c] !== T.ALCHEMY)!;
    act(world, 'p', { type: 'move', to });
    expect(hero.time - time).toBeCloseTo(1 / 3);
  });

  it('retribution strikes everyone in sight, harder the more hurt the reader', () => {
    const { world, hero } = atPot();
    const rat = ratAt(world, lineFrom(world, hero, 3), 100);
    rat.paralysed = 5;
    know(world, 'scroll.retribution');
    hero.hp = 30;
    hero.items = [createItem('scroll.retribution')];
    act(world, 'p', { type: 'use', item: 0 });
    expect(rat.hp).toBeLessThan(100 - 10);
    expect(hero.blind).toBeGreaterThan(0);
    expect(hero.weakened).toBeGreaterThan(0);
  });

  it('a scroll of rage sends everyone in sight amok', () => {
    const { world, hero } = atPot();
    const rat = ratAt(world, lineFrom(world, hero, 3));
    hero.items = [createItem('scroll.rage')];
    act(world, 'p', { type: 'use', item: 0 });
    expect(rat.amok).toBeGreaterThan(0);
  });
});

describe('runestones, spells and bombs', () => {
  it('a stone of blink carries the thrower to where it lands', () => {
    const { world, hero } = atPot();
    const far = lineFrom(world, hero, 3);
    hero.items = [createItem('stone.blink')];
    act(world, 'p', { type: 'throw', item: 0, target: far });
    expect(hero.pos).toBe(far);
  });

  it('a stone of intuition makes a right guess known, and lasts two guesses', () => {
    const { world, hero } = atPot();
    hero.items = [createItem('stone.intuition'), createItem('potion.frost')];
    const choices = (Object.keys(ITEMS) as ItemKind[]).filter((k) => REGULAR_POTIONS.includes(k) && !world.known.includes(k));
    expect(act(world, 'p', { type: 'use', item: 0, on: 1, choice: choices.indexOf('potion.haste') }).ok).toBe(true);
    expect(world.known).not.toContain('potion.frost');
    expect(qty(hero, 'stone.intuition')).toBe(1);
    expect(act(world, 'p', { type: 'use', item: 0, on: 1, choice: choices.indexOf('potion.frost') }).ok).toBe(true);
    expect(world.known).toContain('potion.frost');
    expect(qty(hero, 'stone.intuition')).toBe(0);
  });

  it('phase shift sends a monster elsewhere, stunned', () => {
    const { world, hero } = atPot();
    const far = lineFrom(world, hero, 3);
    const rat = ratAt(world, far);
    hero.items = [createItem('spell.phaseShift', 2)];
    expect(act(world, 'p', { type: 'use', item: 0, cell: far }).ok).toBe(true);
    expect(rat.pos).not.toBe(far);
    expect(rat.paralysed).toBeGreaterThan(0);
    expect(qty(hero, 'spell.phaseShift')).toBe(1);
  });

  it('a beacon of returning is set, then brings its caster back', () => {
    const { world, hero } = atPot();
    hero.items = [createItem('spell.beacon', 1)];
    const home = hero.pos;
    expect(act(world, 'p', { type: 'use', item: 0, choice: 1 })).toEqual({ ok: false, reason: 'the beacon is not set' });
    expect(act(world, 'p', { type: 'use', item: 0, choice: 0 }).ok).toBe(true);
    hero.pos = lineFrom(world, hero, 3);
    expect(act(world, 'p', { type: 'use', item: 0, choice: 1 }).ok).toBe(true);
    expect(hero.pos).toBe(home);
    expect(hero.items).toEqual([]);
  });

  it('alchemize sells or turns into energy anywhere', () => {
    const { world, hero } = atPot();
    hero.items = [createItem('spell.alchemize', 2), createItem('stone.flock', 2)];
    expect(act(world, 'p', { type: 'use', item: 0, on: 1, choice: 3 }).ok).toBe(true);
    expect(world.energy).toBe(6);
    expect(qty(hero, 'spell.alchemize')).toBe(1);
  });

  it("bombs' fuses burn two turns; a frost bomb freezes those near it", () => {
    const { world, hero } = atPot();
    const far = lineFrom(world, hero, 3);
    const rat = ratAt(world, far);
    rat.paralysed = 1;
    hero.items = [createItem('bomb.frost')];
    act(world, 'p', { type: 'throw', item: 0, target: far });
    act(world, 'p', { type: 'wait' });
    act(world, 'p', { type: 'wait' });
    expect(rat.buffs?.frost).toBeGreaterThan(0);
  });

  it('picking a lit bomb up snuffs it', () => {
    const { world, hero } = atPot();
    const far = lineFrom(world, hero, 1);
    hero.items = [createItem('bomb')];
    act(world, 'p', { type: 'throw', item: 0, target: far });
    act(world, 'p', { type: 'move', to: far });
    act(world, 'p', { type: 'pickup' });
    expect(hero.items[0]).toEqual(createItem('bomb'));
    for (let i = 0; i < 3; i++) expect((act(world, 'p', { type: 'wait' }) as { effects: { type: string }[] }).effects.some((e) => e.type === 'exploded')).toBe(false);
  });
});

describe('the blobs', () => {
  it('corrosive gas eats away more every turn', () => {
    const { world, hero } = atPot();
    const far = lineFrom(world, hero, 3);
    const rat = ratAt(world, far, 1000);
    rat.paralysed = 20;
    hero.items = [createItem('potion.corrosiveGas')];
    act(world, 'p', { type: 'throw', item: 0, target: far });
    const before = rat.hp;
    act(world, 'p', { type: 'wait' });
    const first = before - rat.hp;
    act(world, 'p', { type: 'wait' });
    expect(before - rat.hp).toBeGreaterThan(first * 2 - 1);
  });

  it('storm clouds turn the ground to water', () => {
    const { world, hero } = atPot();
    const far = lineFrom(world, hero, 3);
    hero.items = [createItem('potion.stormClouds')];
    act(world, 'p', { type: 'throw', item: 0, target: far });
    act(world, 'p', { type: 'wait' });
    expect(levelAt(world, 1).map[far]).toBe(T.WATER);
  });

  it('an infernal brew burns, and a blizzard freezes, those in it', () => {
    for (const [brew, check] of [['brew.infernal', (r: { burning?: number }) => (r.burning ?? 0) > 0], ['brew.blizzard', (r: { buffs?: { chill?: number; frost?: number } }) => (r.buffs?.chill ?? r.buffs?.frost ?? 0) > 0]] as const) {
      const { world, hero } = atPot();
      const far = lineFrom(world, hero, 3);
      const rat = ratAt(world, far, 1000);
      rat.paralysed = 3;
      hero.items = [createItem(brew)];
      act(world, 'p', { type: 'throw', item: 0, target: far });
      act(world, 'p', { type: 'wait' });
      expect(check(rat as never)).toBe(true);
    }
  });
});
