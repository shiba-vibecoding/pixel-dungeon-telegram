import {
  allSpells, type Action, MONK_ABILITIES, MONK_AIMS, MONK_COST, monkDescArgs, monkEmpowered, monkEnergy, monkEnergyCap, spellDescArgs, spellDescExtra, type Enchantment, type Glyph, type Hero, hasAbility, abilityAims, classState, type ItemKind, itemDef, type SpellDef, tomeOf,
  trinityOptions, type World,
} from '@pd/core';
import { artText, capital } from './artifacttext';
import { audio } from './audio';
import { lang, t } from './i18n';
import { itemName } from './itemtext';
import { button, el, info, show, windowOf } from './screens';

/*
 * The Duelist's weapon ability and the Cleric's holy tome in the windows: the spells by tier with their cost and what they ask
 * for (a cell, an item, an effect to choose), the quick spell, and the line a weapon's ability asks its target with.
 */

const strings = {
  en: { spells: 'Spells', tier: (n: number) => `Tier ${n}`, cast: 'Cast', quick: 'Quick spell', quickOff: 'Not the quick spell', charges: (n: number) => `Charges: ${n}`, none: 'No spells yet: talents bring them.', choose: 'Choose an effect', noEffects: 'You have identified nothing of the kind yet.', pickItem: 'Choose an item' },
  ru: { spells: 'Заклинания', tier: (n: number) => `Ярус ${n}`, cast: 'Применить', quick: 'Быстрое заклинание', quickOff: 'Не быстрое', charges: (n: number) => `Заряды: ${n}`, none: 'Заклинаний пока нет: их дают таланты.', choose: 'Выберите эффект', noEffects: 'Вы пока ничего такого не опознали.', pickItem: 'Выберите предмет' },
} as const;
const S = strings[lang === 'ru' ? 'ru' : 'en'];

export interface ClassHost {
  world: World;
  hero: Hero;
  /** Does it; the window closes first. */
  act(action: Action): void;
  /** Asks for a cell on the map; the next tap does what `make` says. */
  aim(prompt: string, make: (cell: number) => Action): void;
  /** Back to what was open before. */
  back(): void;
}

/** actors.hero.spells.<name>: the class's message key of a spell. */
const keyOf = (spell: SpellDef): string =>
  `actors.hero.spells.${spell.id === 'bless' ? 'blessspell' : spell.id === 'lifeLink' ? 'lifelinkspell' : spell.id.toLowerCase()}`;
const textOf = (key: string, args?: Array<string | number>): string => artText(key, args);

/** ClericSpell.desc: the description with its numbers as the hero has them, what the subclass adds, and the charge cost. */
function spellDesc(hero: Hero, world: World, spell: SpellDef): string {
  const extra = spellDescExtra(hero, spell.id);
  return [
    textOf(`${keyOf(spell)}.desc`, spellDescArgs(hero, spell.id)),
    ...(extra ? [textOf(`${keyOf(spell)}.${extra}`)] : []),
    artText('actors.hero.spells.clericspell.charge_cost', [Math.trunc(spell.cost(hero, world))]),
  ].join('\n\n');
}

export const spellName = (spell: SpellDef): string => capital(textOf(`${keyOf(spell)}.name`));

/** HolyTome.execute: the spells the Cleric has, by tier, as rows (a tap opens one). */
export function showTome(host: ClassHost): void {
  const { world, hero } = host;
  const tome = tomeOf(hero);
  const charges = Math.floor(tome?.charge ?? 0);
  const rows: HTMLElement[] = [];
  const quick = classState(hero).quick;
  for (const tier of [1, 2, 3, 4] as const) {
    const spells = allSpells(hero, world).filter((spell) => spell.tier === tier);
    if (spells.length === 0) continue;
    rows.push(el('h3', { className: 'pd-tier-head', textContent: S.tier(tier) }));
    for (const spell of spells) {
      const cost = spell.cost(hero, world);
      const node = button(`${spellName(spell)}${quick === spell.id ? ' ★' : ''} · ${cost}`, () => showSpell(host, spell), charges >= cost ? '' : 'quiet');
      rows.push(node);
    }
  }
  show(
    windowOf(
      { title: capital(tome ? itemName(world, tome) : S.spells), sub: S.charges(charges), onClose: host.back },
      rows.length ? el('div', { className: 'pd-scroll' }, ...rows) : info(S.none),
    ),
    host.back,
  );
}

/** One spell: what it does, what it costs, and the buttons to cast it or to make it the quick spell. */
function showSpell(host: ClassHost, spell: SpellDef): void {
  const { world, hero } = host;
  const quick = classState(hero).quick === spell.id;
  const back = (): void => showTome(host);
  show(
    windowOf(
      { title: spellName(spell), sub: S.charges(Math.floor(tomeOf(hero)?.charge ?? 0)), onClose: back, narrow: true },
      info(spellDesc(hero, world, spell)),
      el(
        'div',
        { className: 'pd-confirm-actions' },
        button(S.cast, () => cast(host, spell), 'primary'),
        button(quick ? S.quickOff : S.quick, () => {
          audio.play('click');
          host.act({ type: 'quick', spell: spell.id });
        }, 'quiet'),
        button(t.back ?? 'Back', back, 'quiet'),
      ),
    ),
    back,
  );
}

/** ClericSpell.onCast: a spell that wants nothing is cast; the rest ask for a cell, an item or an effect first. */
export function cast(host: ClassHost, spell: SpellDef): void {
  const { hero } = host;
  switch (spell.aim) {
    case 'none':
      host.act({ type: 'cast', spell: spell.id });
      return;
    case 'cell':
      host.aim(textOf(`${keyOf(spell)}.prompt`) || artText('actors.hero.spells.clericspell.prompt'), (cell) => ({ type: 'cast', spell: spell.id, cell }));
      return;
    case 'item': {
      const rows = hero.items.map((item, i) => button(capital(itemName(host.world, item)), () => host.act({ type: 'cast', spell: spell.id, item: i })));
      show(windowOf({ title: spellName(spell), onClose: () => showSpell(host, spell), narrow: true }, info(S.pickItem), el('div', { className: 'pd-scroll' }, ...rows)), () => showSpell(host, spell));
      return;
    }
    case 'choice': {
      const form = spell.id === 'bodyForm' ? 'body' : spell.id === 'mindForm' ? 'mind' : 'spirit';
      const options = trinityOptions(hero, form);
      const rows = options.map((option, i) => button(capital(optionName(host.world, option)), () => host.act({ type: 'cast', spell: spell.id, choice: i })));
      show(
        windowOf(
          { title: spellName(spell), onClose: () => showSpell(host, spell), narrow: true },
          info(artText('actors.hero.abilities.cleric.trinity$wnditemtypeselect.text')),
          rows.length ? el('div', { className: 'pd-scroll' }, ...rows) : info(S.noEffects),
        ),
        () => showSpell(host, spell),
      );
    }
  }
}

/** What Trinity's options are called: an enchantment or a glyph by its name, the rest by their item's. */
export function optionName(world: World, option: string): string {
  if (option.startsWith('enchant:')) return t.enchantName('', option.slice(8) as Enchantment, 'weapon.sword' as ItemKind).trim();
  if (option.startsWith('glyph:')) return t.glyphName('', option.slice(6) as Glyph).trim();
  void itemDef;
  return itemName(world, { kind: option as ItemKind, qty: 1, level: 0 } as never);
}

/** HolyTome.quickSpell: the spell the quick slot casts, if the tome has one chosen and the Cleric has it still. */
export function quickSpellOf(world: World, hero: Hero): SpellDef | undefined {
  const id = classState(hero).quick;
  return id ? allSpells(hero, world).find((spell) => spell.id === id) : undefined;
}

/** MeleeWeapon.targetingPrompt: the line a weapon's ability asks for its target with. */
export function weaponPrompt(kind: ItemKind): string {
  const own = artText(`items.weapon.melee.${kind.slice('weapon.'.length).toLowerCase()}.prompt`);
  return own || artText('items.weapon.melee.meleeweapon.ability_target') || artText('actors.hero.abilities.armorability.prompt');
}

export { abilityAims, hasAbility };

/* The Monk's abilities (WndMonkAbilities) */

const MONK_KEY: Readonly<Record<string, string>> = { flurry: 'flurry', focus: 'focus', dash: 'dash', kick: 'dragonkick', meditate: 'meditate' };
const monkKey = (ability: string): string => `actors.buffs.monkenergy$monkability$${MONK_KEY[ability]}`;

/** WndMonkAbilities: the five abilities with their cost in energy, the ones the Monk can pay for lit; a tap uses one (aimed ones ask for a cell). */
export function showMonk(host: ClassHost): void {
  const { hero } = host;
  const energy = Math.floor(monkEnergy(hero));
  const power = monkEmpowered(hero);
  const rows = MONK_ABILITIES.map((ability) => {
    const name = capital(artText(`${monkKey(ability)}.name`));
    const node = button(`${name} · ${MONK_COST[ability]}`, () => showMonkAbility(host, ability), energy >= MONK_COST[ability] ? '' : 'quiet');
    return node;
  });
  show(
    windowOf(
      { title: capital(artText('actors.buffs.monkenergy.name')), sub: `${energy} / ${monkEnergyCap(hero)}${power ? ' ★' : ''}`, onClose: host.back, narrow: true },
      info(artText('actors.buffs.monkenergy.desc', [energy, monkEnergyCap(hero)])),
      el('div', { className: 'pd-scroll' }, ...rows),
    ),
    host.back,
  );
}

function showMonkAbility(host: ClassHost, ability: (typeof MONK_ABILITIES)[number]): void {
  const { hero } = host;
  const power = monkEmpowered(hero);
  const key = monkKey(ability);
  const desc = artText(power ? `${key}.empower_desc` : `${key}.desc`, monkDescArgs(hero, ability));
  const back = (): void => showMonk(host);
  const use = (): void => {
    if (!MONK_AIMS[ability]) host.act({ type: 'monk', ability });
    else host.aim(artText(`${key}.prompt`) || artText('items.weapon.melee.meleeweapon.prompt') || artText('actors.hero.abilities.armorability.prompt'), (cell) => ({ type: 'monk', ability, cell }));
  };
  show(
    windowOf(
      { title: capital(artText(`${key}.name`)), sub: `${MONK_COST[ability]}`, onClose: back, narrow: true },
      info(desc),
      el('div', { className: 'pd-confirm-actions' }, button(S.cast, use, 'primary'), button(t.back ?? 'Back', back, 'quiet')),
    ),
    back,
  );
}
