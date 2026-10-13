import {
  type Action, availableEnergy, BOMB_RECIPES, createItem, energyValue, EXOTIC_OF, goesInWhole, type Hero, type Item, itemDef, type ItemKind,
  itemSprite, knownIn, recipesFor, REGULAR_POTIONS, REGULAR_SCROLLS, S, SCROLL_STONES, SIMPLE_RECIPES, TRINKETS, trinketUpgradeCost,
  usableInRecipe, type World,
} from '@pd/core';
import { audio } from './audio';
import { capitalize, fill, t } from './i18n';
import { itemName } from './itemtext';
import { type BackpackOptions, button, el, show, showBackpack, showConfirm, sprites, windowOf } from './screens';

/*
 * Shattered's alchemy at the pot (AlchemyScene), in the design system's ShAlchemy markup: three
 * ingredients, the arrow, the result («?» when it is a surprise) and its price in energy; «turn
 * into energy» (WndEnergizeItem) with what each item is worth; and the recipe book
 * (Document.ALCHEMY_GUIDE) by pages. Also the small choices alchemy's items ask for (an
 * enchantment, an augmentation, a guess, a talent tier, a trinket...), as one window.
 */

/** Where the pot window gets the world as it is now, and sends what the player does. */
export interface PotOptions {
  current(): { world: World; hero: Hero } | null;
  onAction(action: Action): void;
  onClose(): void;
}

interface PotState {
  options: PotOptions;
  /** Pack slots put in, in order (a slot twice for two of a stack). */
  inputs: number[];
  /** What is shown: the pot, the energy picker (with what is picked), or the book at a page. */
  screen: { kind: 'pot' } | { kind: 'energize'; picked: Set<number> } | { kind: 'guide'; page: number } | { kind: 'trinket' };
  /** The pack as it was when the inputs were chosen: they are dropped if it changes under them. */
  pack: string;
}

let pot: PotState | null = null;

const packKey = (hero: Hero): string => hero.items.map((item) => `${item.kind}:${item.qty}`).join(',');

/** A Shattered item sprite in the design system's markup. */
function sitem(sprite: number): HTMLElement {
  const icon = el('i', { className: 'pd-sitem' });
  icon.dataset.s = String(sprite);
  return icon;
}

const spriteOf = (world: World, item: Item): number => itemSprite(item, world.run.labels);
/** A kind's sprite; in the book, a potion or scroll not known yet shows only its holder (its colour would give it away). */
const kindSprite = (world: World, kind: ItemKind): number => {
  const category = itemDef(kind).category;
  if ((category === 'potion' || category === 'scroll') && !knownIn(world.known, kind)) return category === 'potion' ? S.POTION_HOLDER : S.SCROLL_HOLDER;
  return spriteOf(world, createItem(kind));
};

function energyIcon(small = false): HTMLElement {
  return el('i', { className: `pd-energy-ico${small ? ' x1' : ''}` });
}

function head(world: World, title: string, onClose: () => void, sprite = 'alchemy'): HTMLElement {
  const icon = el('i', { className: 'pd-icon' });
  icon.style.width = '32px';
  icon.style.height = '32px';
  icon.style.backgroundImage = `var(--spr-${sprite})`;
  const energy = world.energy ?? 0;
  const counter = el('span', { className: 'pd-energy', ariaLabel: t.alchUi.energyCounter(energy) }, sitem(S.ENERGY), String(energy));
  const close = el('button', { className: 'pd-close', ariaLabel: t.close, onclick: () => {
    audio.play('click');
    onClose();
  } });
  return el('header', { className: 'pd-window-head' }, icon, el('div', { className: 'pd-titles' }, el('h2', { className: 'pd-heading', textContent: title })), counter, close);
}

/** Opens the pot (Hero.actAlchemy): tapped while standing by it. */
export function showAlchemy(options: PotOptions): void {
  const now = options.current();
  pot = { options, inputs: [], screen: { kind: 'pot' }, pack: now ? packKey(now.hero) : '' };
  draw();
}

export const alchemyOpen = (): boolean => pot !== null && document.querySelector('.pd-alch-window, .pd-alch-sub') !== null;

/** The world changed (something brewed or energized, here or by the server): drawn again if open. */
export function refreshAlchemy(): void {
  if (!pot) return;
  if (!alchemyOpen()) {
    pot = null;
    return;
  }
  draw();
}

function close(): void {
  const options = pot?.options;
  pot = null;
  options?.onClose();
}

function draw(): void {
  if (!pot) return;
  const now = pot.options.current();
  if (!now) return close();
  const { world, hero } = now;
  // The pack changed under the chosen ingredients (a brew, a pickup, a companion's gift): they are taken out.
  if (packKey(hero) !== pot.pack) {
    pot.inputs = [];
    pot.pack = packKey(hero);
  }
  if (pot.screen.kind === 'energize') return drawEnergize(world, hero, pot.screen.picked);
  if (pot.screen.kind === 'guide') return drawGuide(world, hero, pot.screen.page);
  if (pot.screen.kind === 'trinket') return drawTrinkets(world, hero);
  drawPot(world, hero);
}

/** AlchemyScene: the three inputs, the arrow, the output, its cost; brew, energize, the guide, clear. */
function drawPot(world: World, hero: Hero): void {
  const state = pot!;
  const offers = state.inputs.length > 0 ? recipesFor(world, hero, state.inputs) : [];
  const offer = offers[0];
  const energy = availableEnergy(world, hero);
  const short = offer !== undefined && offer.cost > energy;

  const row = el('div', { className: 'pd-alch' });
  for (let i = 0; i < 3; i++) {
    const index = state.inputs[i];
    const item = index !== undefined ? hero.items[index] : undefined;
    if (item) {
      const node = el('button', { className: 'pd-slot', ariaLabel: capitalize(itemName(world, item)) }, sitem(spriteOf(world, item)));
      if (goesInWhole(item) && item.qty > 1) node.append(el('span', { className: 'pd-qty', textContent: String(item.qty) }));
      // A tap takes it back out.
      node.onclick = () => {
        audio.play('click');
        state.inputs.splice(i, 1);
        draw();
      };
      row.append(node);
    } else {
      const add = el('button', { className: 'pd-slot add', ariaLabel: t.alchUi.add });
      add.onclick = () => {
        audio.play('click');
        pickIngredient(world, hero);
      };
      row.append(add);
    }
  }
  row.append(el('i', { className: `pd-alch-arrow${offer ? ' ready' : ''}` }));
  const out = el('div', { className: `pd-slot out${!offer ? ' empty' : offer.output ? '' : ' unknown'}` });
  if (offer) {
    out.append(sitem(offer.output ? spriteOf(world, offer.output) : unknownSprite(offer.id)));
    if (offer.qty > 1) out.append(el('span', { className: 'pd-qty', textContent: String(offer.qty) }));
  }
  row.append(out);

  const name = !offer ? t.alchUi.nothing
    : offer.output ? capitalize(offer.qty > 1 ? `${itemName(world, { ...offer.output, qty: 1 })} ×${offer.qty}` : itemName(world, offer.output))
    : unknownName(offer.id);
  const cost = !offer ? null
    : short ? el('span', { className: 'pd-alch-cost short' }, energyIcon(true), t.alchUi.short(offer.cost, energy))
    : el('span', { className: 'pd-alch-cost' }, ...(offer.cost > 0 ? [energyIcon(true), t.alchUi.cost(offer.cost)] : [t.alchUi.noEnergy]));
  const result = el('div', { className: 'pd-alch-out' }, el('span', { className: 'pd-alch-name', textContent: name }), cost);
  if (state.inputs.length > 0 && !offer) result.append(el('span', { className: 'pd-alch-cost', textContent: t.alch.nothingMade }));

  const brew = button(t.alchUi.brew, () => {
    if (!offer || short) return;
    const inputs = state.inputs;
    state.inputs = [];
    state.options.onAction({ type: 'alchemy', inputs, recipe: 0 });
    // AlchemyScene.combine: bubbles and a puff of smoke over the output (Speck.WOOL), and its PUFF.
    audio.play('puff');
    window.setTimeout(() => {
      draw();
      puff(document.querySelector<HTMLElement>('.pd-alch .pd-slot.out'), offer.id === 'trinketCatalyst' ? 'catalyst' : 'brew');
      // TrinketCatalyst.Recipe: WndTrinket opens at once with what the catalyst offers.
      if (offer.id === 'trinketCatalyst') {
        state.screen = { kind: 'trinket' };
        draw();
      }
    }, 0);
  }, 'primary');
  brew.disabled = !offer || short;
  const energize = el('button', { className: 'pd-button' }, energyIcon(), t.alchUi.toEnergy);
  energize.onclick = () => {
    audio.play('click');
    state.screen = { kind: 'energize', picked: new Set() };
    draw();
  };
  const guide = button(t.alchUi.recipes, () => {
    state.screen = { kind: 'guide', page: guidePageFor(world, hero, state.inputs) };
    draw();
  }, 'quiet');
  const clear = button(t.alchUi.clear, () => {
    state.inputs = [];
    draw();
  }, 'quiet');
  clear.disabled = state.inputs.length === 0;
  const box = el(
    'section',
    { className: 'pd-window pd-alch-window' },
    head(world, t.alch.title, close),
    row,
    result,
    el('div', { className: 'pd-actions' }, brew, el('div', { className: 'pd-row' }, energize), el('div', { className: 'pd-row' }, guide, clear)),
    el('p', { className: 'pd-note center', textContent: t.alch.text }),
  );
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-label', t.alch.title);
  show(box, close);
}

/** TrinketCatalyst.WndTrinket at the pot: three trinkets shown and a fourth unknown; closing it leaves the choice for later. */
function drawTrinkets(world: World, hero: Hero): void {
  const state = pot!;
  const back = (): void => {
    state.screen = { kind: 'pot' };
    draw();
  };
  const index = hero.items.findIndex((item) => item.kind === 'trinket.catalyst' && item.rolled);
  const catalyst = hero.items[index];
  // Not rolled yet (the world has not answered): the pot until it has.
  if (!catalyst?.rolled) return drawPot(world, hero);
  showChoice(world, t.alch.chooseTrinket, t.alch.catalystText, catalyst, catalyst.rolled.map((kind, choice) => ({
    label: choice < 3 ? capitalize(t.items[kind]) : capitalize(t.alch.catalystRandom),
    sprite: choice < 3 ? kindSprite(world, kind) : S.TRINKET_HOLDER,
    onPick: () => {
      state.options.onAction({ type: 'use', item: index, choice });
      audio.play('puff');
      back();
    },
  })), back, 'pd-alch-sub');
}

/** The silhouette under the «?» of a surprise result. */
function unknownSprite(id: string): number {
  switch (id) {
    case 'seedToPotion': return S.POTION_HOLDER;
    case 'scrollToStone': return S.STONE_HOLDER;
    case 'trinketCatalyst': return S.TRINKET_HOLDER;
    default: return S.SOMETHING;
  }
}

function unknownName(id: string): string {
  switch (id) {
    case 'seedToPotion': return t.alch.potionRandom;
    case 'scrollToStone': return t.alch.stonesOf;
    case 'trinketCatalyst': return capitalize(t.alch.catalystRandom);
    default: return t.alchUi.random;
  }
}

/** WndBag's selector for the pot: what may go in (Recipe.usableInRecipe), and of a stack only as many as there are. */
function pickIngredient(world: World, hero: Hero): void {
  const state = pot!;
  const used = (index: number): number => state.inputs.filter((i) => i === index).length;
  const targets = hero.items.flatMap((item, index) => {
    if (!usableInRecipe(item)) return [];
    const left = goesInWhole(item) ? (used(index) > 0 ? 0 : 1) : item.qty - used(index);
    return left > 0 ? [index] : [];
  });
  const back = (): void => draw();
  const options: BackpackOptions = {
    world, hero,
    onAction: state.options.onAction,
    onAim: () => undefined,
    onClose: back,
    pick: {
      title: t.alchUi.pickTitle,
      targets,
      onPick: (ref) => {
        if (typeof ref === 'number' && state.inputs.length < 3) {
          audio.play('item');
          state.inputs.push(ref);
        }
        draw();
      },
      onCancel: back,
    },
  };
  showBackpack(options);
}

/* Energy */

/** WndEnergizeItem as the design draws it: the pack's items with their energy, picked ones framed, and the sum. */
function drawEnergize(world: World, hero: Hero, picked: Set<number>): void {
  const state = pot!;
  const back = (): void => {
    state.screen = { kind: 'pot' };
    draw();
  };
  const worth = (item: Item): number => energyValue(item, knownIn(world.known, item.kind));
  const grid = el('div', { className: 'pd-alch-pick' });
  hero.items.forEach((item, index) => {
    const energy = worth(item);
    const node = el('button', {
      className: `pd-slot${picked.has(index) ? ' picked' : ''}${energy <= 0 ? ' disabled' : ''}`,
      ariaLabel: `${capitalize(itemName(world, item))}: +${energy}`,
    }, sitem(spriteOf(world, item)));
    if (energy > 0) node.append(el('span', { className: 'pd-qty energy', textContent: `+${energy}` }));
    if (item.qty > 1) node.append(el('span', { className: 'pd-tag', textContent: String(item.qty) }));
    node.disabled = energy <= 0;
    node.onclick = () => {
      audio.play('click');
      if (picked.has(index)) picked.delete(index);
      else picked.add(index);
      draw();
    };
    grid.append(node);
  });
  const total = [...picked].reduce((sum, index) => sum + (hero.items[index] ? worth(hero.items[index]!) : 0), 0);
  const sum = el('div', { className: 'pd-energize-sum' }, el('span', { textContent: t.alchUi.youGet }), el('b', {}, energyIcon(), ` +${total}`));
  const go = (): void => {
    // From the last slot to the first, so each slot still names its item as the pack closes up.
    for (const index of [...picked].sort((a, b) => b - a)) state.options.onAction({ type: 'energize', item: index, all: true });
    // AlchemyScene.energizeItem: sparks over the energy, and its LIGHTNING.
    audio.play('lightning', 1.2, 0.6);
    state.screen = { kind: 'pot' };
    window.setTimeout(() => {
      draw();
      puff(document.querySelector<HTMLElement>('.pd-alch-window .pd-energy'), 'energy');
    }, 0);
  };
  const primary = button(t.alchUi.toEnergy, () => {
    if (total <= 0) return;
    // A trinket is worth only 5 once energized: asked first (WndEnergizeItem's trinket warning).
    if ([...picked].some((i) => itemDef(hero.items[i]?.kind ?? 'gold').category === 'trinket')) {
      showConfirm(t.alch.energizePrompt, t.alch.trinketWarn, t.alch.trinketYes, t.alch.trinketNo, go, () => draw());
      return;
    }
    go();
  }, 'primary');
  primary.disabled = total <= 0;
  const box = el(
    'section',
    { className: 'pd-window pd-alch-window pd-alch-sub' },
    head(world, t.alch.energize, back, 'energy16'),
    el('p', { className: 'pd-info', textContent: t.alch.energizeHint }),
    el('div', { className: 'pd-scroll' }, grid),
    sum,
    el('div', { className: 'pd-actions' }, primary, el('div', { className: 'pd-row' }, button(t.back, back, 'quiet'))),
  );
  box.setAttribute('role', 'dialog');
  show(box, back);
}

/* The guide */

const PAGES = ['potions', 'stones', 'energy_food', 'exotic_potions', 'exotic_scrolls', 'bombs', 'weapons', 'brews_elixirs', 'spells'] as const;
type Page = (typeof PAGES)[number];

interface Line {
  inputs: Array<{ sprite: number; n?: number }>;
  energy: number;
  out: { sprite: number; n?: number };
  name: string;
  /** What to take from the pack for «into the pot», when it is the very kinds. */
  kinds?: ItemKind[];
}

const pageTitle = (page: Page): string => (t.alch as Record<string, string>)[`page_${page}_title`] ?? page;
const pageBody = (page: Page): string => (t.alch as Record<string, string>)[`page_${page}_body`] ?? '';

function simpleLines(world: World, test: (output: ItemKind) => boolean): Line[] {
  return SIMPLE_RECIPES.filter((r) => test(r.output)).map((r) => ({
    inputs: r.inputs.map(([kind, n]) => ({ sprite: kindSprite(world, kind), ...(n > 1 ? { n } : {}) })),
    energy: r.cost,
    out: { sprite: kindSprite(world, r.output), ...(r.qty > 1 ? { n: r.qty } : {}) },
    name: capitalize(t.items[r.output]),
    kinds: r.inputs.flatMap(([kind, n]) => (goesInWhole(createItem(kind)) ? [kind] : Array<ItemKind>(n).fill(kind))),
  }));
}

function linesOf(world: World, page: Page): Line[] {
  const known = (kind: ItemKind): boolean => knownIn(world.known, kind);
  const category = (kind: ItemKind): string => itemDef(kind).category;
  switch (page) {
    case 'potions':
      return [{ inputs: [{ sprite: S.SEED_HOLDER }, { sprite: S.SEED_HOLDER }, { sprite: S.SEED_HOLDER }], energy: 0, out: { sprite: S.POTION_HOLDER }, name: t.alch.potionRandom }];
    case 'stones':
      return [
        { inputs: [{ sprite: S.SCROLL_HOLDER }], energy: 0, out: { sprite: S.STONE_HOLDER, n: 2 }, name: t.alch.stonesOf },
        ...(Object.entries(SCROLL_STONES) as Array<[ItemKind, ItemKind]>).filter(([scroll]) => known(scroll)).map(([scroll, stone]) => ({
          inputs: [{ sprite: kindSprite(world, scroll) }], energy: 0, out: { sprite: kindSprite(world, stone), n: 2 }, name: capitalize(t.items[stone]), kinds: [scroll],
        })),
      ];
    case 'energy_food':
      return [
        ...simpleLines(world, (out) => out === 'food.stewed'),
        {
          inputs: [{ sprite: kindSprite(world, 'food.pasty') }, { sprite: kindSprite(world, 'food.ration') }, { sprite: kindSprite(world, 'food.meat') }],
          energy: 6, out: { sprite: kindSprite(world, 'food.meatPie') }, name: capitalize(t.items['food.meatPie']), kinds: ['food.pasty', 'food.ration', 'food.meat'],
        },
        {
          inputs: [{ sprite: kindSprite(world, 'food.blandfruit') }, { sprite: S.SEED_HOLDER }], energy: 2,
          out: { sprite: kindSprite(world, 'food.blandfruit') }, name: capitalize(t.alch.cooked),
        },
      ];
    case 'exotic_potions':
    case 'exotic_scrolls': {
      const potions = page === 'exotic_potions';
      const generic: Line = {
        inputs: [{ sprite: potions ? S.POTION_HOLDER : S.SCROLL_HOLDER }], energy: potions ? 4 : 6,
        out: { sprite: potions ? S.POTION_HOLDER : S.SCROLL_HOLDER }, name: `${capitalize(potions ? t.alchUi.anyPotion : t.alchUi.anyScroll)} → ${t.alchUi.sameColour}`,
      };
      const kinds = (potions ? REGULAR_POTIONS : REGULAR_SCROLLS).filter((kind) => EXOTIC_OF[kind] && known(kind));
      return [generic, ...kinds.map((kind) => ({
        inputs: [{ sprite: kindSprite(world, kind) }], energy: potions ? 4 : 6, out: { sprite: kindSprite(world, EXOTIC_OF[kind]!) },
        name: capitalize(t.items[EXOTIC_OF[kind]!]), kinds: [kind],
      }))];
    }
    case 'bombs':
      return (Object.entries(BOMB_RECIPES) as Array<[ItemKind, readonly [ItemKind, number]]>).map(([with_, [bomb, cost]]) => ({
        inputs: [{ sprite: kindSprite(world, 'bomb') }, { sprite: kindSprite(world, with_) }],
        energy: cost, out: { sprite: kindSprite(world, bomb) }, name: capitalize(t.items[bomb]), ...(known(with_) || !['potion', 'scroll'].includes(category(with_)) ? { kinds: ['bomb', with_] as ItemKind[] } : {}),
      }));
    case 'weapons':
      return [
        { inputs: [{ sprite: S.WAND_HOLDER }], energy: 5, out: { sprite: kindSprite(world, 'resin') }, name: capitalize(t.items.resin) },
        { inputs: [{ sprite: S.MISSILE_HOLDER }], energy: 3, out: { sprite: kindSprite(world, 'liquidMetal') }, name: capitalize(t.items.liquidMetal) },
        { inputs: [{ sprite: kindSprite(world, 'trinket.catalyst') }], energy: 6, out: { sprite: S.TRINKET_HOLDER }, name: capitalize(t.alch.catalystRandom), kinds: ['trinket.catalyst'] },
        ...[0, 1, 2].map((level) => ({
          inputs: [{ sprite: S.TRINKET_HOLDER }], energy: trinketUpgradeCost({ kind: TRINKETS[0]!, qty: 1, level }),
          out: { sprite: S.TRINKET_HOLDER }, name: fill(t.alch.trinketLevel, level + 1),
        })),
      ];
    case 'brews_elixirs':
      return [
        ...simpleLines(world, (out) => category(out) === 'brew' || category(out) === 'elixir'),
        { inputs: [{ sprite: S.SEED_HOLDER }, { sprite: S.POTION_HOLDER }], energy: 1, out: { sprite: kindSprite(world, 'brew.unstable') }, name: capitalize(t.items['brew.unstable']) },
      ];
    case 'spells':
      return [
        ...simpleLines(world, (out) => category(out) === 'spell'),
        { inputs: [{ sprite: S.STONE_HOLDER }, { sprite: S.SCROLL_HOLDER }], energy: 1, out: { sprite: kindSprite(world, 'spell.unstable') }, name: capitalize(t.items['spell.unstable']) },
        { inputs: [{ sprite: S.SEED_HOLDER }, { sprite: S.STONE_HOLDER }], energy: 2, out: { sprite: kindSprite(world, 'spell.alchemize'), n: 8 }, name: capitalize(t.items['spell.alchemize']) },
      ];
  }
}

/** The page the book opens at: the one about what is in the pot, else the first. */
function guidePageFor(world: World, hero: Hero, inputs: readonly number[]): number {
  const first = inputs[0] !== undefined ? hero.items[inputs[0]] : undefined;
  if (!first) return 0;
  const category = itemDef(first.kind).category;
  const page: Page = category === 'seed' ? 'potions' : category === 'scroll' ? (knownIn(world.known, first.kind) ? 'exotic_scrolls' : 'stones')
    : category === 'potion' ? 'exotic_potions' : category === 'bomb' ? 'bombs' : category === 'wand' || category === 'missile' || category === 'trinket' || category === 'catalyst' ? 'weapons'
    : category === 'food' ? 'energy_food' : category === 'stone' ? 'spells' : 'potions';
  return PAGES.indexOf(page);
}

/** Pack slots holding these kinds (identified), as many as asked; null if something is missing. */
function findInPack(world: World, hero: Hero, kinds: readonly ItemKind[]): number[] | null {
  const taken = new Map<number, number>();
  const inputs: number[] = [];
  for (const kind of kinds) {
    const index = hero.items.findIndex((item, i) => item.kind === kind && usableInRecipe(item) && (taken.get(i) ?? 0) < (goesInWhole(item) ? 1 : item.qty) &&
      (itemDef(kind).category !== 'potion' && itemDef(kind).category !== 'scroll' || knownIn(world.known, kind)));
    if (index < 0) return null;
    taken.set(index, (taken.get(index) ?? 0) + 1);
    inputs.push(index);
  }
  return inputs;
}

/** Document.ALCHEMY_GUIDE by pages, each with the recipes it teaches; «into the pot» when the pack holds them all. */
function drawGuide(world: World, hero: Hero, pageIndex: number): void {
  const state = pot!;
  const back = (): void => {
    state.screen = { kind: 'pot' };
    draw();
  };
  const tabs = el('div', { className: 'pd-guide-pages' });
  tabs.setAttribute('role', 'tablist');
  PAGES.forEach((page, i) => {
    // (Every page is known: finding them in the dungeon is the levels stream's, see SHATTERED.md.)
    const tab = el('button', { textContent: pageTitle(page) });
    tab.setAttribute('aria-pressed', String(i === pageIndex));
    tab.onclick = () => {
      audio.play('click');
      state.screen = { kind: 'guide', page: i };
      draw();
    };
    tabs.append(tab);
  });
  const page = PAGES[pageIndex] ?? 'potions';
  const list = el('div', { className: 'pd-recipes' });
  for (const line of linesOf(world, page)) {
    const parts: HTMLElement[] = [];
    line.inputs.forEach((input, i) => {
      if (i > 0) parts.push(el('span', { className: 'op', textContent: '+' }));
      parts.push(sitem(input.sprite));
      if (input.n) parts.push(el('span', { className: 'n', textContent: `×${input.n}` }));
    });
    if (line.energy > 0) parts.push(el('span', { className: 'op', textContent: '+' }), el('span', { className: 'en' }, energyIcon(), String(line.energy)));
    parts.push(el('i', { className: 'pd-alch-arrow' }), sitem(line.out.sprite));
    if (line.out.n) parts.push(el('span', { className: 'n', textContent: `×${line.out.n}` }));
    const recipe = el('div', { className: 'pd-recipe' }, el('span', { className: 'pd-recipe-line', ariaLabel: line.name }, ...parts));
    const inputs = line.kinds ? findInPack(world, hero, line.kinds) : null;
    if (inputs) {
      recipe.append(button(t.alchUi.intoPot, () => {
        state.inputs = inputs;
        state.pack = packKey(hero);
        back();
      }));
    }
    recipe.append(el('span', { className: 'pd-recipe-name' }, el('b', { textContent: line.name })));
    list.append(recipe);
  }
  const box = el(
    'section',
    { className: 'pd-window pd-alch-window pd-alch-sub' },
    head(world, t.alch.guideTitle, back, 'book'),
    tabs,
    el('div', { className: 'pd-scroll' }, el('p', { className: 'pd-info', textContent: pageBody(page) }), list),
    el('div', { className: 'pd-row' }, button(t.back, back, 'quiet')),
  );
  box.setAttribute('role', 'dialog');
  show(box, back);
  tabs.querySelector('[aria-pressed="true"]')?.scrollIntoView({ inline: 'center', block: 'nearest' });
}

/**
 * AlchemyScene's emitters in the window: a puff of wool-white smoke and bubbles over the result
 * (Speck.WOOL, Speck.BUBBLE), the catalyst's glow, or sparks over the energy counter (SparkParticle).
 */
export function puff(at: HTMLElement | null, kind: 'brew' | 'catalyst' | 'energy'): void {
  if (!at) return;
  const layer = el('span', { className: `pd-alch-fx ${kind}` });
  layer.setAttribute('aria-hidden', 'true');
  const count = kind === 'energy' ? 20 : 10;
  for (let i = 0; i < count; i++) {
    const bit = el('i');
    const angle = Math.random() * Math.PI * 2;
    const reach = kind === 'energy' ? 14 + Math.random() * 18 : 6 + Math.random() * 16;
    bit.style.setProperty('--dx', `${Math.round(Math.cos(angle) * reach)}px`);
    bit.style.setProperty('--dy', `${Math.round(Math.sin(angle) * reach - (kind === 'energy' ? 0 : 14))}px`);
    bit.style.animationDelay = `${Math.round(Math.random() * 120)}ms`;
    layer.append(bit);
  }
  // Over the page rather than in the window, so that the window drawn again (the world answering) does not cut it short.
  const box = at.getBoundingClientRect();
  Object.assign(layer.style, { position: 'fixed', left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px`, inset: 'auto' });
  document.body.append(layer);
  window.setTimeout(() => layer.remove(), 900);
}

/* Choices */

export interface ChoiceOption {
  label: string;
  /** A sprite of items.png beside it. */
  sprite?: number;
  disabled?: boolean;
  onPick(): void;
}

/**
 * A choice an item asks for (WndOptions: an enchantment, an augmentation, a guess, a talent tier, a
 * trinket, a beacon's set or return, what to alchemize into): one window, the options as buttons.
 */
export function showChoice(
  world: World, title: string, text: string, item: Item | null, choices: readonly ChoiceOption[], onCancel: () => void, className?: string,
): void {
  const icon = item ? el('div', { className: 'pd-slot' }, sitem(spriteOf(world, item))) : null;
  const list = el('div', { className: 'pd-actions' });
  for (const choice of choices) {
    const node = el('button', { className: 'pd-button pd-choice' });
    if (choice.sprite !== undefined) {
      const picture = sitem(choice.sprite);
      node.append(picture);
    }
    node.append(choice.label);
    node.disabled = choice.disabled === true;
    node.onclick = () => {
      audio.play('click');
      choice.onPick();
    };
    list.append(node);
  }
  const box = windowOf({ title, icon, onClose: onCancel, narrow: true, ...(className ? { className } : {}) }, text ? el('p', { className: 'pd-info', textContent: text }) : null, list);
  show(box, onCancel);
  sprites(box);
}
