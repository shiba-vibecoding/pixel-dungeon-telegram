import { type Hero, statsOf } from './actors';
import { hasRoom } from './bags';
import type { Ctx } from './floor';
import { identify, isIdentified, learn } from './ident';
import {
  createItem, drawFromDeck, energyValue, EXOTIC_OF, isStackable, type Item, itemDef, ItemGenerator, type ItemKind, knownIn, REGULAR_OF,
  stacksWith,
} from './items';
import { adjacent, NEIGHBOURS8 } from './level/geometry';
import { T } from './level/terrain';
import { trinketUpgradeCost } from './trinkets';
import type { World } from './world';
import { underChallenges } from './challenges';

/*
 * Shattered's alchemy (AlchemyScene, Recipe and every item's own Recipe): at an alchemy pot the hero puts up to
 * three ingredients in, and every recipe they make is offered, each with its cost in alchemical energy (World.energy,
 * Dungeon.energy: energy crystals picked up, and items turned into energy at the pot, WndEnergizeItem). Brewing
 * takes no time: the game waits while the hero is at the pot.
 *
 * The client chooses the ingredients from the pack (each slot one item, a stack of thrown weapons or of liquid
 * metal whole) and which of the recipes they make to brew; the rules here find the recipes again and check them.
 */

/** What goes into the pot: one item from a slot of the pack, or a whole stack (Item.detach and detachAll). */
export interface Ingredient {
  /** The pack slot it comes from. */
  index: number;
  item: Item;
  /** How many of the stack. */
  qty: number;
}

/** A recipe as the client is shown it: what it makes (null while it is a surprise), how many, and what it costs. */
export interface RecipeOffer {
  id: RecipeId;
  cost: number;
  /** The result as it will come out, or null when it is random or not known yet («?»). */
  output: Item | null;
  /** How many come out, when they are known. */
  qty: number;
}

export type RecipeId =
  | 'scrollToStone' | 'potionToExotic' | 'scrollToExotic' | 'arcaneResin' | 'liquidMetal' | 'simple' | 'trinketCatalyst' | 'upgradeTrinket'
  | 'cookFruit' | 'enhanceBomb' | 'unstableBrew' | 'unstableSpell' | 'alchemize' | 'seedToPotion' | 'meatPie';

/** Recipe.SimpleRecipe: fixed ingredients (identified) for a fixed result. */
export interface Simple {
  inputs: readonly (readonly [ItemKind, number])[];
  cost: number;
  output: ItemKind;
  qty: number;
}

/** Every SimpleRecipe, with the size of its list of ingredients (Recipe.oneIngredientRecipes...). */
export const SIMPLE_RECIPES: readonly (Simple & { size: 1 | 2 | 3 })[] = [
  // One ingredient.
  { size: 1, inputs: [['potion.frost', 1]], cost: 8, output: 'brew.blizzard', qty: 1 },
  { size: 1, inputs: [['potion.liquidFlame', 1]], cost: 12, output: 'brew.infernal', qty: 1 },
  { size: 1, inputs: [['potion.stormClouds', 1]], cost: 8, output: 'brew.aqua', qty: 8 },
  { size: 1, inputs: [['potion.paralyticGas', 1]], cost: 10, output: 'brew.shocking', qty: 1 },
  { size: 1, inputs: [['potion.dragonsBreath', 1]], cost: 10, output: 'elixir.dragonsBlood', qty: 1 },
  { size: 1, inputs: [['potion.snapFreeze', 1]], cost: 6, output: 'elixir.icyTouch', qty: 1 },
  { size: 1, inputs: [['potion.corrosiveGas', 1]], cost: 8, output: 'elixir.toxicEssence', qty: 1 },
  { size: 1, inputs: [['potion.strength', 1]], cost: 16, output: 'elixir.might', qty: 1 },
  { size: 1, inputs: [['potion.levitation', 1]], cost: 10, output: 'elixir.featherFall', qty: 1 },
  { size: 1, inputs: [['scroll.upgrade', 1]], cost: 12, output: 'spell.magicalInfusion', qty: 1 },
  { size: 1, inputs: [['scroll.passage', 1]], cost: 12, output: 'spell.beacon', qty: 5 },
  { size: 1, inputs: [['scroll.teleportation', 1]], cost: 10, output: 'spell.phaseShift', qty: 6 },
  { size: 1, inputs: [['scroll.transmutation', 1]], cost: 12, output: 'spell.recycle', qty: 12 },
  { size: 1, inputs: [['liquidMetal', 10]], cost: 10, output: 'spell.telekineticGrab', qty: 8 },
  { size: 1, inputs: [['quest.embers', 1]], cost: 10, output: 'spell.summonElemental', qty: 6 },
  { size: 1, inputs: [['food.meat', 1]], cost: 1, output: 'food.stewed', qty: 1 },
  // Two.
  { size: 2, inputs: [['potion.toxicGas', 1], ['quest.gooBlob', 1]], cost: 1, output: 'brew.caustic', qty: 1 },
  { size: 2, inputs: [['potion.earthenArmor', 1], ['quest.gooBlob', 1]], cost: 8, output: 'elixir.arcaneArmor', qty: 1 },
  { size: 2, inputs: [['potion.healing', 1], ['quest.gooBlob', 1]], cost: 6, output: 'elixir.aquaticRejuvenation', qty: 1 },
  { size: 2, inputs: [['potion.healing', 1], ['honeypot.shattered', 1]], cost: 2, output: 'elixir.honeyedHealing', qty: 1 },
  { size: 2, inputs: [['scroll.removeCurse', 1], ['quest.metalShard', 1]], cost: 6, output: 'spell.curseInfusion', qty: 4 },
  { size: 2, inputs: [['scroll.mapping', 1], ['quest.metalShard', 1]], cost: 8, output: 'spell.reclaimTrap', qty: 5 },
  { size: 2, inputs: [['scroll.recharging', 1], ['quest.metalShard', 1]], cost: 4, output: 'spell.wildEnergy', qty: 5 },
  { size: 2, inputs: [['food.meat', 2]], cost: 2, output: 'food.stewed', qty: 2 },
  // Three.
  { size: 3, inputs: [['food.meat', 3]], cost: 2, output: 'food.stewed', qty: 3 },
];

/** Scroll.ScrollToStone.stones: the runestone two of come from each scroll. */
export const SCROLL_STONES: Readonly<Partial<Record<ItemKind, ItemKind>>> = {
  'scroll.identify': 'stone.intuition', 'scroll.lullaby': 'stone.deepSleep', 'scroll.mapping': 'stone.clairvoyance',
  'scroll.mirrorImage': 'stone.flock', 'scroll.retribution': 'stone.blast', 'scroll.rage': 'stone.aggression',
  'scroll.recharging': 'stone.shock', 'scroll.removeCurse': 'stone.detectMagic', 'scroll.teleportation': 'stone.blink',
  'scroll.terror': 'stone.fear', 'scroll.transmutation': 'stone.augmentation', 'scroll.upgrade': 'stone.enchantment',
};

/**
 * Potion.SeedToPotion.types: the potion each seed brews. Shattered's seeds this port has (the plants are nobody's
 * stream yet): blindweed's invisibility goes to dreamweed, as before; mageroyal, starflower, stormvine and
 * swiftthistle (purity, experience, levitation, haste) join this table when their seeds come.
 */
export const SEED_POTIONS: Readonly<Partial<Record<ItemKind, ItemKind>>> = {
  'seed.dreamweed': 'potion.invisibility',
  'seed.earthroot': 'potion.paralyticGas',
  'seed.fadeleaf': 'potion.mindVision',
  'seed.firebloom': 'potion.liquidFlame',
  'seed.icecap': 'potion.frost',
  'seed.rotberry': 'potion.strength',
  'seed.sorrowmoss': 'potion.toxicGas',
  'seed.sungrass': 'potion.healing',
};

/** Bomb.EnhanceBomb.validIngredients and bombCosts. */
export const BOMB_RECIPES: Readonly<Partial<Record<ItemKind, readonly [ItemKind, number]>>> = {
  'potion.frost': ['bomb.frost', 0],
  'scroll.mirrorImage': ['bomb.woolly', 0],
  'potion.liquidFlame': ['bomb.fire', 1],
  'scroll.rage': ['bomb.noisemaker', 1],
  'potion.invisibility': ['bomb.smoke', 2],
  'scroll.recharging': ['bomb.flashbang', 2],
  'potion.healing': ['bomb.regrowth', 3],
  'scroll.removeCurse': ['bomb.holy', 3],
  'quest.gooBlob': ['bomb.arcane', 6],
  'quest.metalShard': ['bomb.shrapnel', 6],
};

const category = (item: Item): string => itemDef(item.kind).category;

/**
 * Recipe.usableInRecipe: of what is worn, only thrown weapons (not cursed, and known not to be) and wands
 * known not to be cursed; anything else as long as it is not cursed.
 */
export function usableInRecipe(item: Item): boolean {
  const c = category(item);
  if (c === 'weapon' || c === 'armor' || c === 'ring') return false;
  if (c === 'missile' || c === 'wand') return !item.curseUnknown && !item.cursed && item.kind !== 'missile.boomerang';
  return !item.cursed;
}

/** AlchemyScene.itemSelector: a stack of thrown weapons, or of liquid metal, goes in whole. */
export const goesInWhole = (item: Item): boolean => category(item) === 'missile' || item.kind === 'liquidMetal';

/** Whether the hero can brew here: at an alchemy pot, or next to one (Hero.actAlchemy). */
export function atPot(world: World, hero: Hero): boolean {
  const map = world.levels[hero.depth]?.map;
  if (!map) return false;
  return map[hero.pos] === T.ALCHEMY || NEIGHBOURS8.some((n) => map[hero.pos + n] === T.ALCHEMY && adjacent(hero.pos + n, hero.pos));
}

/**
 * The artifacts stream's alchemist's toolkit: energy it can lend a recipe, and whether it lets the hero brew away
 * from a pot (AlchemistsToolkit.kitEnergy). None until that stream fills these in.
 */
export const toolkit = {
  energy: (_hero: Hero): number => 0,
  consume: (_hero: Hero, cost: number): number => cost,
  anywhere: (_hero: Hero): boolean => false,
};

/** Gathers the ingredients a client named: pack slots, one item each (a whole stack of what goes in whole). */
export function gather(hero: Hero, inputs: readonly number[]): Ingredient[] | string {
  if (!Array.isArray(inputs) || inputs.length < 1 || inputs.length > 3) return 'put in one to three ingredients';
  const taken = new Map<number, number>();
  const ingredients: Ingredient[] = [];
  for (const index of inputs) {
    const item = Number.isInteger(index) ? hero.items[index] : undefined;
    if (!item) return 'no such item';
    if (!usableInRecipe(item)) return 'that cannot go into the pot';
    const qty = goesInWhole(item) ? item.qty : 1;
    const used = (taken.get(index) ?? 0) + qty;
    if (used > item.qty) return 'not enough of that';
    taken.set(index, used);
    ingredients.push({ index, item, qty });
  }
  return ingredients;
}

/* The recipes */

interface Recipe {
  id: RecipeId;
  size?: number;
  /** A SimpleRecipe's own ingredients and result. */
  simple?: Simple;
  test(world: World, ings: readonly Ingredient[]): boolean;
  cost(world: World, ings: readonly Ingredient[]): number;
  /** The result as offered (null: a surprise), and how many. */
  sample(world: World, ings: readonly Ingredient[]): { item: Item | null; qty: number };
}

const one = (ings: readonly Ingredient[]): Ingredient => ings[0]!;
const ofKind = (ings: readonly Ingredient[], test: (item: Item) => boolean): Ingredient | undefined => ings.find((i) => test(i.item));

/** Recipe.SimpleRecipe.testIngredients: everything identified, and enough of each input. */
function simpleTest(world: World, recipe: Simple, ings: readonly Ingredient[]): boolean {
  if (!ings.every((i) => isIdentified(world, i.item))) return false;
  const needed = recipe.inputs.map(([, n]) => n);
  for (const ing of ings) {
    const at = recipe.inputs.findIndex(([kind]) => kind === ing.item.kind);
    if (at >= 0) needed[at]! -= ing.qty;
  }
  return needed.every((n) => n <= 0);
}

const resinQuantity = (wand: Item): number => 2 * (wand.level - (wand.resin ?? 0) + 1);

/** LiquidMetal.Recipe.metalQuantity, by the thrown weapon's tier (a seam for the gear stream's tiers and durability). */
const MISSILE_TIER: Partial<Record<ItemKind, number>> = {
  'missile.dart': 1, 'missile.curare': 1, 'missile.incendiary': 1, 'missile.shuriken': 2, 'missile.javelin': 4, 'missile.tomahawk': 4,
};
function metalQuantity(missile: Item): number {
  const tier = MISSILE_TIER[missile.kind] ?? 2;
  const perWeapon = Math.fround(5 * (tier + 1) * Math.fround(1.35 ** Math.min(5, Math.max(0, missile.level))));
  // A thrown weapon at full durability (the gear stream's MissileWeapon.durabilityLeft: 100 until it wears).
  const quantity = missile.qty - 1 + 0.25 + 0.0075 * 100;
  return Math.round(quantity * perWeapon);
}

const RECIPES: readonly Recipe[] = [
  // Recipe.oneIngredientRecipes, in order.
  {
    id: 'scrollToStone', size: 1,
    test: (_w, ings) => category(one(ings).item) === 'scroll' && SCROLL_STONES[one(ings).item.kind] !== undefined,
    cost: () => 0,
    sample: (w, ings) => (knownIn(w.known, one(ings).item.kind) ? { item: createItem(SCROLL_STONES[one(ings).item.kind]!, 2), qty: 2 } : { item: null, qty: 2 }),
  },
  {
    id: 'potionToExotic', size: 1,
    test: (_w, ings) => category(one(ings).item) === 'potion' && EXOTIC_OF[one(ings).item.kind] !== undefined,
    cost: () => 4,
    sample: (_w, ings) => ({ item: createItem(EXOTIC_OF[one(ings).item.kind]!), qty: 1 }),
  },
  {
    id: 'scrollToExotic', size: 1,
    test: (_w, ings) => category(one(ings).item) === 'scroll' && EXOTIC_OF[one(ings).item.kind] !== undefined,
    cost: () => 6,
    sample: (_w, ings) => ({ item: createItem(EXOTIC_OF[one(ings).item.kind]!), qty: 1 }),
  },
  {
    id: 'arcaneResin', size: 1,
    test: (_w, ings) => category(one(ings).item) === 'wand' && !one(ings).item.curseUnknown && !one(ings).item.cursed,
    cost: () => 5,
    sample: (_w, ings) => (one(ings).item.levelUnknown ? { item: createItem('resin'), qty: 0 } : { item: createItem('resin', resinQuantity(one(ings).item)), qty: resinQuantity(one(ings).item) }),
  },
  {
    id: 'liquidMetal', size: 1,
    test: (_w, ings) => category(one(ings).item) === 'missile' && !one(ings).item.curseUnknown && !one(ings).item.cursed,
    cost: () => 3,
    sample: (_w, ings) => (one(ings).item.levelUnknown ? { item: createItem('liquidMetal'), qty: 0 } : { item: createItem('liquidMetal', metalQuantity(one(ings).item)), qty: metalQuantity(one(ings).item) }),
  },
  ...SIMPLE_RECIPES.filter((r) => r.size === 1).map(simpleRecipe),
  {
    id: 'trinketCatalyst', size: 1,
    test: (_w, ings) => one(ings).item.kind === 'trinket.catalyst',
    cost: () => 6,
    sample: () => ({ item: null, qty: 1 }),
  },
  {
    id: 'upgradeTrinket', size: 1,
    test: (_w, ings) => category(one(ings).item) === 'trinket' && one(ings).item.level < 3,
    cost: (_w, ings) => trinketUpgradeCost(one(ings).item),
    sample: (_w, ings) => ({ item: { ...one(ings).item, level: one(ings).item.level + 1 }, qty: 1 }),
  },
  // Recipe.twoIngredientRecipes.
  {
    id: 'cookFruit', size: 2,
    test: (_w, ings) => {
      const fruit = ofKind(ings, (i) => i.kind === 'food.blandfruit' && !i.potion);
      const seed = ofKind(ings, (i) => category(i) === 'seed');
      return !!fruit && !!seed && SEED_POTIONS[seed.item.kind] !== undefined;
    },
    cost: () => 2,
    sample: (_w, ings) => ({ item: cookedFruit(ofKind(ings, (i) => category(i) === 'seed')!.item.kind), qty: 1 }),
  },
  {
    id: 'enhanceBomb', size: 2,
    test: (w, ings) => ings.every((i) => isIdentified(w, i.item)) && ings.some((i) => i.item.kind === 'bomb') &&
      ings.some((i) => BOMB_RECIPES[i.item.kind] !== undefined),
    cost: (_w, ings) => BOMB_RECIPES[ofKind(ings, (i) => BOMB_RECIPES[i.kind] !== undefined)!.item.kind]![1],
    sample: (_w, ings) => ({ item: createItem(BOMB_RECIPES[ofKind(ings, (i) => BOMB_RECIPES[i.kind] !== undefined)!.item.kind]![0]), qty: 1 }),
  },
  {
    id: 'unstableBrew', size: 2,
    // UnstableBrew.Recipe: a seed and a potion, ordinary or exotic, known or not.
    test: (_w, ings) => ings.some((i) => category(i.item) === 'seed') &&
      ings.some((i) => category(i.item) === 'potion' && (EXOTIC_OF[i.item.kind] !== undefined || REGULAR_OF[i.item.kind] !== undefined)),
    cost: () => 1,
    sample: () => ({ item: createItem('brew.unstable'), qty: 1 }),
  },
  ...SIMPLE_RECIPES.filter((r) => r.size === 2 && r.inputs.length === 2).slice(0, 4).map(simpleRecipe),
  {
    id: 'unstableSpell', size: 2,
    test: (_w, ings) => ings.some((i) => category(i.item) === 'stone') &&
      ings.some((i) => category(i.item) === 'scroll' && (EXOTIC_OF[i.item.kind] !== undefined || REGULAR_OF[i.item.kind] !== undefined)),
    cost: () => 1,
    sample: () => ({ item: createItem('spell.unstable'), qty: 1 }),
  },
  {
    id: 'alchemize', size: 2,
    test: (_w, ings) => (category(ings[0]!.item) === 'seed' && category(ings[1]!.item) === 'stone') ||
      (category(ings[0]!.item) === 'stone' && category(ings[1]!.item) === 'seed'),
    cost: () => 2,
    sample: () => ({ item: createItem('spell.alchemize', 8), qty: 8 }),
  },
  ...SIMPLE_RECIPES.filter((r) => r.size === 2).slice(4).map(simpleRecipe),
  // Recipe.threeIngredientRecipes.
  {
    id: 'seedToPotion', size: 3,
    test: (_w, ings) => ings.every((i) => category(i.item) === 'seed' && i.qty >= 1 && SEED_POTIONS[i.item.kind] !== undefined),
    cost: () => 0,
    sample: () => ({ item: null, qty: 1 }),
  },
  ...SIMPLE_RECIPES.filter((r) => r.size === 3).map(simpleRecipe),
  {
    id: 'meatPie', size: 3,
    test: (_w, ings) => ings.some((i) => i.item.kind === 'food.pasty' || i.item.kind === 'quest.fish') &&
      ings.some((i) => i.item.kind === 'food.ration') &&
      ings.some((i) => ['food.meat', 'food.stewed', 'food.steak', 'food.carpaccio'].includes(i.item.kind)),
    cost: () => 6,
    sample: () => ({ item: createItem('food.meatPie'), qty: 1 }),
  },
];

function simpleRecipe(recipe: Simple & { size: number }): Recipe {
  return {
    id: 'simple',
    size: recipe.size,
    simple: recipe,
    test: (w, ings) => simpleTest(w, recipe, ings),
    cost: () => recipe.cost,
    sample: () => ({ item: createItem(recipe.output, recipe.qty), qty: recipe.qty }),
  };
}

/** Recipe.findRecipes: every recipe the ingredients make, in the original's order. */
function findRecipes(world: World, ings: readonly Ingredient[]): Recipe[] {
  return RECIPES.filter((r) => r.size === ings.length && r.test(world, ings));
}

/** What the client shows for these ingredients: each recipe they make, its cost and its result as far as known. */
export function recipesFor(world: World, hero: Hero, inputs: readonly number[]): RecipeOffer[] {
  const ings = gather(hero, inputs);
  if (typeof ings === 'string') return [];
  return findRecipes(world, ings).map((r) => {
    const { item, qty } = r.sample(world, ings);
    return { id: r.id, cost: r.cost(world, ings), output: item, qty };
  });
}

/** All the energy the hero can spend at the pot (with a toolkit's). */
export const availableEnergy = (world: World, hero: Hero): number => (world.energy ?? 0) + toolkit.energy(hero);

/** Why the hero cannot brew this. */
export function brewProblem(world: World, hero: Hero, inputs: readonly number[], recipe = 0): string | null {
  if (!atPot(world, hero) && !toolkit.anywhere(hero)) return 'you need an alchemy pot';
  const ings = gather(hero, inputs);
  if (typeof ings === 'string') return ings;
  const recipes = findRecipes(world, ings);
  if (recipes.length === 0) return 'those make nothing';
  const chosen = Number.isInteger(recipe) ? recipes[recipe] : undefined;
  if (!chosen) return 'no such recipe';
  if (chosen.cost(world, ings) > availableEnergy(world, hero)) return 'not enough energy';
  if (chosen.id === 'trinketCatalyst' && ings[0]!.item.rolled) return 'the catalyst has been brewed already';
  return null;
}

/**
 * AlchemyScene.combine: the recipe is brewed, its energy spent, the ingredients used up; the result goes into the
 * pack (Item.collect), or at the hero's feet if there is no room.
 */
export function brew(ctx: Ctx, hero: Hero, inputs: readonly number[], recipeIndex = 0): void {
  const { world } = ctx;
  const ings = gather(hero, inputs) as Ingredient[];
  const recipe = findRecipes(world, ings)[recipeIndex]!;
  let cost = recipe.cost(world, ings);
  cost = toolkit.consume(hero, cost);
  world.energy = (world.energy ?? 0) - cost;
  const result = make(ctx, hero, recipe, ings);
  // The ingredients leave the pack (the slots shift as they go: highest first).
  const used = new Map<Item, number>();
  const amounts = consumption(recipe, ings);
  ings.forEach((ing, i) => used.set(ing.item, (used.get(ing.item) ?? 0) + amounts[i]!));
  for (const [item, qty] of used) {
    item.qty -= qty;
    if (item.qty <= 0) hero.items.splice(hero.items.indexOf(item), 1);
  }
  statsOf(hero).brewed++;
  if (result) give(ctx, hero, result);
  ctx.effects.push({ type: 'crafted', hero: hero.id, item: result, cost });
}

/**
 * How much of each ingredient a recipe uses: SimpleRecipe.brew only as much as it needs (ten of a stack of liquid
 * metal); the catalyst stays; the others all that went in.
 */
function consumption(recipe: Recipe, ings: readonly Ingredient[]): number[] {
  if (recipe.id === 'trinketCatalyst') return ings.map(() => 0);
  if (!recipe.simple) return ings.map((ing) => ing.qty);
  const needed = recipe.simple.inputs.map(([, n]) => n);
  return ings.map((ing) => {
    const at = recipe.simple!.inputs.findIndex(([kind]) => kind === ing.item.kind);
    if (at < 0) return 0;
    const used = Math.min(needed[at]!, ing.qty);
    needed[at]! -= used;
    return used;
  });
}

/** Recipe.brew: what comes out. */
function make(ctx: Ctx, hero: Hero, recipe: Recipe, ings: readonly Ingredient[]): Item | null {
  const { world } = ctx;
  const first = ings[0]!.item;
  switch (recipe.id) {
    case 'scrollToStone':
      // ScrollToStone.brew: the scroll is known for what it was.
      learn(world, first.kind);
      return createItem(SCROLL_STONES[first.kind]!, 2);
    case 'potionToExotic':
    case 'scrollToExotic':
      return createItem(EXOTIC_OF[first.kind]!);
    case 'arcaneResin':
      return createItem('resin', resinQuantity(first));
    case 'liquidMetal':
      return createItem('liquidMetal', metalQuantity(first));
    case 'trinketCatalyst':
      // TrinketCatalyst.Recipe: the catalyst stays, and offers four trinkets (WndTrinket) to choose from.
      first.rolled = [];
      while (first.rolled.length < 4) first.rolled.push(drawFromDeck(world.run, 'trinket'));
      ctx.effects.push({ type: 'catalyst', hero: hero.id, trinkets: first.rolled });
      return null;
    case 'upgradeTrinket':
      return { ...first, level: first.level + 1, qty: 1 };
    case 'cookFruit':
      return cookedFruit(ings.find((i) => category(i.item) === 'seed')!.item.kind);
    case 'enhanceBomb':
      return createItem(BOMB_RECIPES[ings.find((i) => BOMB_RECIPES[i.item.kind] !== undefined)!.item.kind]![0]);
    case 'unstableBrew':
      return createItem('brew.unstable');
    case 'unstableSpell':
      return createItem('spell.unstable');
    case 'alchemize':
      return createItem('spell.alchemize', 8);
    case 'meatPie':
      return createItem('food.meatPie');
    case 'seedToPotion':
      return seedToPotion(ctx, ings);
    case 'simple':
      return createItem(recipe.simple!.output, recipe.simple!.qty);
  }
}

/**
 * Potion.SeedToPotion.brew: three seeds make a potion. Two kinds of seed, one time in four, three, one time in two, it
 * is a random potion; otherwise the potion of one of the seeds. Seeds all of a kind make it known. Healing comes ever
 * more rarely the more of it has been brewed (Dungeon.LimitedDrops.COOKING_HP).
 */
function seedToPotion(ctx: Ctx, ings: readonly Ingredient[]): Item {
  const { rng, world } = ctx;
  const kinds = [...new Set(ings.map((i) => i.item.kind))];
  const random = (): ItemKind => new ItemGenerator(rng, ctx.depth).of('potion').kind;
  let kind: ItemKind;
  if ((kinds.length === 2 && rng.int(4) === 0) || (kinds.length === 3 && rng.int(2) === 0)) kind = random();
  else kind = SEED_POTIONS[rng.oneOf(ings).item.kind]!;
  const result = createItem(kind);
  if (kinds.length === 1) learn(world, kind);
  const drops = (world.run.drops ??= {});
  while (kind === 'potion.healing' && rng.int(10) < (drops.cookingHp ?? 0)) {
    kind = random();
    result.kind = kind;
  }
  if (kind === 'potion.healing') drops.cookingHp = (drops.cookingHp ?? 0) + 1;
  return result;
}

/** Blandfruit.cook: a blandfruit carrying the potion of the seed it was cooked with. */
function cookedFruit(seed: ItemKind): Item {
  return { ...createItem('food.blandfruit'), potion: SEED_POTIONS[seed]! };
}

/** Item.collect: into the pack (stacking), or at the hero's feet (Level.drop) if there is no room. */
function give(ctx: Ctx, hero: Hero, item: Item): void {
  const stack = isStackable(item.kind) ? hero.items.find((other) => stacksWith(other, item)) : undefined;
  if (stack) stack.qty += item.qty;
  else if (hasRoom(hero, item)) hero.items.push(item);
  else ctx.floor.heaps.push({ pos: hero.pos, kind: 'heap', items: [underChallenges(ctx.world, item)] });
}

/* Energy */

/** WndEnergizeItem: why this cannot be turned into energy here. */
export function energizeProblem(world: World, hero: Hero, index: number): string | null {
  if (!atPot(world, hero) && !toolkit.anywhere(hero)) return 'you need an alchemy pot';
  const item = Number.isInteger(index) ? hero.items[index] : undefined;
  if (!item) return 'no such item';
  return energyValue(item, knownIn(world.known, item.kind)) > 0 ? null : 'that holds no energy';
}

/** WndEnergizeItem.energizeOne and energizeAll: an item (or the whole stack) is energy now. */
export function energizeAt(ctx: Ctx, hero: Hero, index: number, all: boolean): void {
  const item = hero.items[index]!;
  const portion: Item = !all && item.qty > 1 ? { ...item, qty: 1 } : item;
  if (portion === item) hero.items.splice(index, 1);
  else item.qty--;
  energize(ctx, hero, portion);
}

/** WndEnergizeItem.energize: the energy an item holds (as valued before it is known) goes into the hero's store, and it is known. */
export function energize(ctx: Ctx, hero: Hero, item: Item): void {
  const energy = energyValue(item, knownIn(ctx.world.known, item.kind));
  ctx.world.energy = (ctx.world.energy ?? 0) + energy;
  // AlchemyScene.showIdentify: what is turned into energy is known for what it was.
  identify(ctx.world, item);
  ctx.effects.push({ type: 'energized', hero: hero.id, item, energy });
}

/** TrinketCatalyst.WndTrinket's choice: the catalyst is gone, and the chosen trinket in the pack, known. */
export function chooseTrinket(ctx: Ctx, hero: Hero, index: number, choice: number): void {
  const catalyst = hero.items[index]!;
  const kind = catalyst.rolled![choice]!;
  hero.items.splice(index, 1);
  const trinket = createItem(kind);
  identify(ctx.world, trinket);
  statsOf(hero).brewed++;
  give(ctx, hero, trinket);
  ctx.effects.push({ type: 'crafted', hero: hero.id, item: trinket, cost: 0 });
}
