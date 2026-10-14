import {
  allSpells, type Action, MONK_ABILITIES, MONK_AIMS, MONK_COST, monkDescArgs, monkEmpowered, monkEnergy, monkEnergyCap, spellDescArgs, spellDescExtra, type Enchantment, type Glyph, type Hero, hasAbility, abilityAims, classState, type ItemKind, itemDef, type SpellDef, tomeOf,
  trinityOptions, type World,
} from '@pd/core';
import { artText, capital } from './artifacttext';
import { audio } from './audio';
import { lang, t } from './i18n';
import { itemName } from './itemtext';
import { button, el, info, show, slot, windowOf } from './screens';
import { plantText } from './examine';
import { WARDEN_PLANTS } from './i18n-v22';
import { hicon } from './talentui';
import { subclassName } from './talenttext';

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

/** HeroIcon of each spell (hero_icons.png, design v22: the holy tome's icons are 40-66; on the action button the same + 32). */
export const SPELL_ICON: Readonly<Record<string, number>> = {
  guidingLight: 40, holyWeapon: 41, holyWard: 42, holyIntuition: 43, shieldOfLight: 44, recallInscription: 45, sunray: 46, divineSense: 47, bless: 48,
  cleanse: 49, radiance: 50, holyLance: 51, hallowedGround: 52, mnemonicPrayer: 53, smite: 54, layOnHands: 55, auraOfProtection: 56, wallOfLight: 57,
  divineIntervention: 58, judgement: 59, flash: 60, bodyForm: 61, mindForm: 62, spiritForm: 63, beamingRay: 64, lifeLink: 65, stasis: 66,
};

/** The cost of a spell as the design draws it: a blue crystal and the number (a free one in gold). */
export function costTag(cost: number): HTMLElement {
  const n = Math.trunc(cost);
  const node = el('span', { className: `pd-cost${n === 0 ? ' free' : ''}` }, el('i', { className: 'pd-cost-ico' }), String(n));
  node.title = n === 0 ? t.v22.free : `${t.v22.charge} ${n}`;
  return node;
}

/**
 * HolyTome.execute (design v22, ClericTome): the spells the Cleric has in tiers, a row each with its icon, name, cost in charge and a line
 * of what it does (a tap opens the spell), and a star for the one quick spell.
 */
export function showTome(host: ClassHost): void {
  const { world, hero } = host;
  const V = t.v22;
  const tome = tomeOf(hero);
  const charges = Math.floor(tome?.charge ?? 0);
  // HolyTome: Math.min(level + 3, 10) charges.
  const cap = tome ? Math.min(tome.level + 3, 10) : charges;
  const quick = classState(hero).quick;
  const tiers: HTMLElement[] = [];
  for (const tier of [1, 2, 3, 4] as const) {
    const spells = allSpells(hero, world).filter((spell) => spell.tier === tier);
    if (spells.length === 0) continue;
    const name = tier === 3 && hero.subclass ? capital(subclassName(hero.subclass)) : V.tierSub[tier - 1]!;
    const rows = spells.map((spell) => {
      const cost = spell.cost(hero, world);
      const low = charges < cost;
      const main = el(
        'button',
        { className: 'pd-spell-main', type: 'button' },
        el('span', { className: 'pd-spell-ico' }, hicon(SPELL_ICON[spell.id] ?? 40)),
        el(
          'span',
          { className: 'pd-spell-text' },
          el('span', { className: 'pd-spell-line' }, el('b', { textContent: spellName(spell) }), costTag(cost)),
          el('small', { textContent: textOf(`${keyOf(spell)}.short_desc`) }),
        ),
      );
      main.ariaLabel = `${spellName(spell)}, ${V.charge} ${Math.trunc(cost)}`;
      if (low) main.setAttribute('aria-disabled', 'true');
      main.onclick = () => {
        audio.play('click');
        showSpell(host, spell);
      };
      const star = el('button', { className: 'pd-quick', type: 'button', ariaLabel: V.quick, title: V.quick });
      star.setAttribute('role', 'radio');
      star.setAttribute('aria-checked', String(quick === spell.id));
      star.onclick = () => {
        audio.play('click');
        host.act({ type: 'quick', spell: spell.id });
      };
      return el('div', { className: `pd-spell${low ? ' low' : ''}` }, main, star);
    });
    tiers.push(
      el(
        'section',
        { className: 'pd-tier pd-spell-tier' },
        el('header', { className: 'pd-tier-head' }, el('h3', { textContent: S.tier(tier) }), el('span', { className: 'pd-tier-sub', textContent: name })),
        ...rows,
      ),
    );
  }
  const pips = el('span', { className: 'pd-charge-pips' }, ...Array.from({ length: cap }, (_, i) => el('i', { className: i < charges ? 'on' : '' })));
  const head = el('div', { className: 'pd-tome-charge' }, el('span', {}, `${V.charge} `, el('b', { textContent: String(charges) }), ` ${V.of} ${cap}`), pips);
  const who = hero.subclass ? capital(subclassName(hero.subclass)) : capital(t.classes[hero.heroClass]);
  show(
    windowOf(
      {
        title: capital(tome ? itemName(world, tome) : S.spells), sub: `${who} · ${t.levelShort} ${hero.lvl}`, icon: tome ? slot(world, tome) : null,
        onClose: host.back, className: 'pd-hero-window pd-tome',
      },
      tiers.length ? head : null,
      tiers.length ? el('div', { className: 'pd-scroll' }, el('div', { className: 'pd-talents' }, ...tiers)) : info(S.none),
      tiers.length ? info(V.quickNote, 'pd-note') : null,
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
  // Design v22 (DuelistActions): a row each with its icon, what it does and its cost in energy as pips; the ones the Monk cannot pay for are dim.
  const rows = MONK_ABILITIES.map((ability, i) => {
    const name = capital(artText(`${monkKey(ability)}.name`));
    const low = energy < MONK_COST[ability];
    const icon = el('i', { className: 'pd-monk-ico' });
    icon.style.setProperty('--ix', String(i));
    const node = el(
      'button',
      { className: `pd-monk-ab${low ? ' low' : ''}`, type: 'button' },
      icon,
      el(
        'span',
        { className: 'pd-spell-text' },
        el('b', { textContent: name }),
        el('small', { textContent: artText(power ? `${monkKey(ability)}.empower_desc` : `${monkKey(ability)}.desc`, monkDescArgs(hero, ability)) }),
      ),
      el('span', { className: 'pd-energy-pips' }, ...Array.from({ length: 5 }, (_, n) => el('i', { className: n < MONK_COST[ability] ? 'on' : '' }))),
    );
    node.ariaLabel = `${name}, ${MONK_COST[ability]}`;
    if (low) node.setAttribute('aria-disabled', 'true');
    node.onclick = () => {
      audio.play('click');
      showMonkAbility(host, ability);
    };
    return node;
  });
  show(
    windowOf(
      {
        title: capital(artText('actors.buffs.monkenergy.name')), sub: `${energy} / ${monkEnergyCap(hero)}${power ? ` · ${t.v22.empowered}` : ''}`,
        icon: el('div', { className: `pd-slot pd-monk-slot${power ? ' emp' : ''}` }, hicon(110)), onClose: host.back, className: 'pd-monk-window',
      },
      el('div', { className: 'pd-scroll' }, el('div', { className: 'pd-monk-list' }, ...rows)),
      info(t.v22.monkNote, 'pd-note'),
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

/* The Warden's plants (design v22, WardenPlants) */

/**
 * HeroSubClass.WARDEN: a plant gives her its own effect in place of its harm. A row each for the plants of this game, with the plant, what it
 * gives her in a line and the picture of that effect.
 */
export function showWarden(onClose: () => void): void {
  const V = t.v22;
  const rows = (Object.keys(WARDEN_PLANTS) as Array<keyof typeof WARDEN_PLANTS>).map((kind) => {
    const plant = el('i', { className: 'pd-wplant' });
    plant.style.setProperty('--ix', String(WARDEN_PLANTS[kind]));
    const effect = el('i', { className: 'pd-weffect' });
    effect.style.setProperty('--ix', String(WARDEN_PLANTS[kind]));
    return el(
      'li',
      {},
      plant,
      el('span', { className: 'pd-spell-text' }, el('b', { textContent: capital(plantText(kind).name) }), el('small', { textContent: V.plants[kind] })),
      effect,
    );
  });
  show(
    windowOf(
      { title: V.warden, sub: V.wardenSub, icon: el('div', { className: 'pd-slot' }, hicon(7)), onClose, className: 'pd-warden-window' },
      el('div', { className: 'pd-scroll' }, el('ul', { className: 'pd-warden-list' }, ...rows)),
      info(V.wardenNote, 'pd-note'),
    ),
    onClose,
  );
}

/** The line under a plant's description for a Warden: what stepping on it gives her. */
export function wardenNote(kind: keyof typeof WARDEN_PLANTS): HTMLElement {
  const icon = el('i', { className: 'pd-weffect' });
  icon.style.setProperty('--ix', String(WARDEN_PLANTS[kind]));
  return el('p', { className: 'pd-warden-note' }, icon, el('span', {}, el('b', { textContent: t.v22.wardenLabel }), ` ${t.v22.plants[kind]}`));
}
