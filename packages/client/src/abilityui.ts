import {
  ABILITIES, ABILITY_TALENTS, type AbilityKind, abilityAim, type Action, CLASS_ABILITIES, type Hero, type Item, pointsInTalent, type Talent, TALENTS,
  talentIcon, talentPointsAvailable, talentsOf, type World,
} from '@pd/core';
import { artText } from './artifacttext';
import { ABILITY_GLOW, abilityDesc, abilityName, abilityShort, AT, capital, chargeText, talentLevels, talentTitle } from './abilitytext';
import { itemName } from './itemtext';
import { button, el, info, itemIcon, show, windowOf } from './screens';

/*
 * The windows of the armour abilities, after the design system's ShPicks and ShTalents: the crown's pick of an ability (three cards
 * with the tier 4 talents each opens), an ability's description (WndInfoArmorAbility), and the tier 4 talents with a card for each.
 */

export interface AbilityHost {
  world: World;
  hero: Hero;
  /** Does something in the world; the window closes first. */
  act(action: Action): void;
  /** Does something in the world and leaves the window as it is (the caller draws it afresh). */
  stay(action: Action): void;
  /** Back to what was open before. */
  back(): void;
}

/** hero_icons.png's frame of an ability (.pd-hicon; screens.ts sprites() sets its offset). */
function abilityIcon(kind: AbilityKind, scale = 4): HTMLElement {
  const icon = el('i', { className: 'pd-hicon' });
  icon.dataset.h = String(ABILITIES[kind].icon);
  icon.style.setProperty('--u', `${scale}px`);
  return icon;
}

/** talent_icons.png's frame of a talent. */
function talentIconNode(talent: Talent, hero: Hero, scale = 2): HTMLElement {
  const icon = el('i', { className: 'pd-ticon' });
  icon.dataset.t = String(talentIcon(talent, hero.heroClass));
  icon.style.setProperty('--u', `${scale}px`);
  return icon;
}

const pips = (points: number, max: number): HTMLElement =>
  el('span', { className: 'pd-pips', ariaHidden: 'true' }, ...Array.from({ length: max }, (_, i) => el('i', { className: i < points ? 'on' : '' })));

/** The three tier 4 talents of an ability, small (the pick's cards). */
const talentStrip = (kind: AbilityKind, hero: Hero): HTMLElement =>
  el('span', { className: 'pd-tpick-talents' }, ...ABILITY_TALENTS[kind].slice(0, 3).map((talent) => talentIconNode(talent, hero, 1)));

/* The crown's pick */

/**
 * WndChooseAbility: the three abilities of the hero's class as cards (a tap on one shows it in full); choosing asks once more,
 * and the pick can wait or be left to chance.
 */
export function showAbilityPick(host: AbilityHost, crownIndex: number): void {
  const { world, hero } = host;
  const crown = hero.items[crownIndex]!;
  const choose = (choice: number): void => host.act({ type: 'use', item: crownIndex, choice });
  const ask = (title: string, text: string, onYes: () => void, kind?: AbilityKind): void => {
    show(
      windowOf(
        { narrow: true, ...(kind ? { icon: el('div', { className: 'pd-slot' }, abilityIcon(kind, 2)) } : {}), title },
        info(text, 'pd-info'),
        el('div', { className: 'pd-confirm-actions' }, button(AT.yes, onYes, 'primary'), button(AT.no, () => showAbilityPick(host, crownIndex), 'quiet')),
      ),
      () => showAbilityPick(host, crownIndex),
    );
  };
  const cards = CLASS_ABILITIES[hero.heroClass].map((kind, i) => {
    const art = el('button', { className: 'pd-tpick-art', ariaLabel: capital(abilityName(kind)), onclick: () => showAbilityInfo(host, kind, () => showAbilityPick(host, crownIndex)) }, abilityIcon(kind));
    const card = el(
      'div',
      { className: 'pd-tpick' },
      art,
      el('span', { className: 'pd-tpick-name', textContent: capital(abilityName(kind)) }),
      el('p', { className: 'pd-tpick-desc', textContent: abilityShort(kind) }),
      el('div', { className: 'pd-tpick-act' }, button(AT.choose, () => ask(capital(abilityName(kind)), artText('windows.wndchooseability.are_you_sure'), () => choose(i), kind)), talentStrip(kind, hero)),
    );
    card.style.setProperty('--glow', ABILITY_GLOW[kind]);
    return card;
  });
  show(
    windowOf(
      { title: capital(itemName(world, crown)), icon: el('div', { className: 'pd-slot' }, itemIcon(world, crown)) },
      el('p', { className: 'pd-tpick-intro', textContent: artText('windows.wndchooseability.message') }),
      el('div', { className: 'pd-scroll' }, el('div', { className: 'pd-tpicks' }, ...cards)),
      button(AT.random, () => ask(artText('windows.wndchooseability.random_title'), artText('windows.wndchooseability.random_sure'), () => choose(3)), 'quiet'),
      button(AT.later, host.back, 'quiet'),
    ),
    host.back,
  );
}

/* An ability in full */

/** WndInfoArmorAbility: the ability's name and description, and its four tier 4 talents (a tap on one reads it). */
export function showAbilityInfo(host: AbilityHost, kind: AbilityKind, back: () => void): void {
  const { hero } = host;
  const row = el('div', { className: 'pd-talent-row' });
  for (const talent of ABILITY_TALENTS[kind]) {
    const node = el('button', { className: 'pd-talent zero', ariaLabel: talentTitle(talent), onclick: () => showTalentCard(host, talent, () => showAbilityInfo(host, kind, back), true) },
      talentIconNode(talent, hero), pips(0, TALENTS[talent].max));
    row.append(node);
  }
  show(
    windowOf(
      { title: capital(abilityName(kind)), icon: el('div', { className: 'pd-slot' }, abilityIcon(kind, 3)), onClose: back },
      info(abilityDesc(kind, hero)),
      el('section', { className: 'pd-tier' }, el('header', { className: 'pd-tier-head' }, el('h3', { textContent: artText('windows.wndheroinfo.talents') || AT.talents }), el('span', { className: 'pd-tier-sub', textContent: AT.tier })), row),
    ),
    back,
  );
}

/* Tier 4 talents */

/** Hero.talents' tier 4: the four talents of the armour ability, with their points; a tap reads one, and may upgrade it. */
export function showTalents(host: AbilityHost): void {
  const { hero, world } = host;
  const kind = hero.ability;
  if (!kind) {
    show(windowOf({ title: AT.talents, onClose: host.back }, info(AT.noTalents)), host.back);
    return;
  }
  const free = talentPointsAvailable(hero, 4);
  const spent = talentsOf(hero).reduce((sum, talent) => sum + pointsInTalent(hero, talent), 0);
  const row = el('div', { className: 'pd-talent-row' });
  for (const talent of talentsOf(hero)) {
    const points = pointsInTalent(hero, talent);
    const max = TALENTS[talent].max;
    const node = el('button', {
      className: `pd-talent${points === 0 ? ' zero' : ''}${points === max ? ' max' : ''}${free > 0 && points < max ? ' can' : ''}`,
      ariaLabel: `${talentTitle(talent)}, ${points}/${max}`,
      onclick: () => showTalentCard(host, talent, () => showTalents(host), false),
    }, talentIconNode(talent, hero), pips(points, max));
    row.append(node);
  }
  const points = free > 0
    ? el('span', { className: 'pd-tier-points free' }, `${AT.free} `, el('b', { textContent: String(free) }))
    : el('span', { className: 'pd-tier-points' }, el('b', { textContent: String(spent) }));
  const armor = hero.armor;
  show(
    windowOf(
      { title: capital(abilityName(kind)), icon: el('div', { className: 'pd-slot' }, abilityIcon(kind, 3)), sub: AT.abilityHead, onClose: host.back },
      el('div', { className: 'pd-art-charge' }, el('span', { textContent: AT.charge }), chargeBar(armor), el('span', { textContent: `${Math.floor(armor.charge ?? 0)}%` })),
      info(`${abilityShort(kind)} ${artText('items.armor.classarmor.charge_use', [chargeText(world, hero, kind)])}`),
      el('section', { className: 'pd-tier' }, el('header', { className: 'pd-tier-head' }, el('h3', { textContent: AT.tier }), el('span', { className: 'pd-tier-sub', textContent: capital(abilityName(kind)) }), points), row),
      el('p', { className: 'pd-note center', textContent: AT.tapToRead }),
    ),
    host.back,
  );
}

/** ShArtifact's charge bar for the class armour's charge (out of 100). */
function chargeBar(armor: Item): HTMLElement {
  const bar = el('div', { className: `pd-charge-bar${(armor.charge ?? 0) >= 100 ? ' full' : ''}` });
  bar.style.setProperty('--v', String(Math.min(1, (armor.charge ?? 0) / 100)));
  return bar;
}

/** WndInfoTalent: a talent's levels, what the next one gives, and the button to upgrade it. */
export function showTalentCard(host: AbilityHost, talent: Talent, back: () => void, readOnly: boolean): void {
  const { hero } = host;
  const points = readOnly ? 0 : pointsInTalent(hero, talent);
  const max = TALENTS[talent].max;
  const { intro, levels } = talentLevels(talent);
  const free = readOnly ? 0 : talentPointsAvailable(hero, 4);
  const list = el('ol', { className: 'pd-talent-levels' }, ...levels.map((text, i) =>
    el('li', { className: i < points ? 'done' : i === points ? 'next' : '' }, el('b', { textContent: `+${i + 1}` }), el('span', { textContent: text }))));
  const up = (): void => {
    host.stay({ type: 'talent', talent });
    showTalentCard(host, talent, back, false);
  };
  show(
    windowOf(
      {
        title: capital(talentTitle(talent)), sub: `${AT.tier}${hero.ability && !readOnly ? ` · ${capital(abilityName(hero.ability))}` : ''}`,
        icon: el('div', { className: 'pd-slot' }, talentIconNode(talent, hero)), onClose: back, narrow: true, className: 'pd-talent-card',
      },
      el('div', { className: 'pd-talent-progress' }, pips(points, max), el('span', { textContent: AT.of(points, max) })),
      intro && info(intro),
      list,
      readOnly ? null : el('div', { className: 'pd-actions' },
        points < max && free > 0 ? button(AT.improve, up, 'primary') : null,
        el('p', { className: 'pd-talent-cost', textContent: points >= max ? AT.maxed : free > 0 ? AT.pointsLeft(free) : AT.noPoints })),
    ),
    back,
  );
}

/* Using the ability */

/** The line an ability asks for its target with (ArmorAbility.targetingPrompt). */
function promptOf(kind: AbilityKind): string {
  const own = artText(`actors.hero.abilities.${ABILITIES[kind].key}.prompt`);
  return own || artText('actors.hero.abilities.armorability.prompt');
}

export interface AbilityUse {
  world: World;
  hero: Hero;
  /** Does the ability (with its target or choice). */
  send(action: Action): void;
  /** Asks for a cell on the map; the next tap sends the ability at it. */
  aim(prompt: string): void;
  /** Back to what was open before the beacon's window. */
  back(): void;
}

/**
 * ClassArmor.execute(AC_ABILITY): the ability asks for a cell on the map, or the warp beacon's choice, or just goes off. The
 * armour's charge and what it wants is the rules' to say (a refusal comes back as a line in the log).
 */
export function startAbility(use: AbilityUse): void {
  const { world, hero } = use;
  const kind = hero.ability;
  if (!kind) return;
  switch (abilityAim(world, hero)) {
    case 'none':
      use.send({ type: 'special' });
      return;
    case 'cell':
      use.aim(promptOf(kind));
      return;
    case 'beacon':
      showBeacon(use);
  }
}

/** WarpBeacon's WndOptions: teleport to the beacon, clear it, or cancel. */
function showBeacon(use: AbilityUse): void {
  const { hero } = use;
  const beacon = hero.abil?.beacon;
  show(
    windowOf(
      { title: capital(AT.beaconTitle), icon: el('div', { className: 'pd-slot' }, abilityIcon('warpBeacon', 3)), narrow: true },
      info(beacon ? artText('actors.hero.abilities.mage.warpbeacon.window_desc', [beacon.depth]) : ''),
      el(
        'div',
        { className: 'pd-confirm-actions' },
        button(capital(artText('actors.hero.abilities.mage.warpbeacon.window_tele')), () => {
          use.back();
          use.send({ type: 'special', choice: 0 });
        }, 'primary'),
        button(capital(artText('actors.hero.abilities.mage.warpbeacon.window_clear')), () => {
          use.back();
          use.send({ type: 'special', choice: 1 });
        }),
        button(capital(artText('actors.hero.abilities.mage.warpbeacon.window_cancel')), use.back, 'quiet'),
      ),
    ),
    use.back,
  );
}

/** The class armour's card in the backpack: the ability, the charge it has, what it costs now, and the tier 4 points free. */
export function classArmorCard(world: World, hero: Hero, item: Item): HTMLElement[] {
  const kind = hero.ability;
  const mine = item.kind === `armor.${hero.heroClass}`;
  if (!mine) return [];
  const bar = chargeBar(item);
  const nodes: HTMLElement[] = [el('div', { className: 'pd-art-charge' }, el('span', { textContent: AT.charge }), bar, el('span', {}, el('b', { textContent: String(Math.floor(item.charge ?? 0)) }), '%'))];
  if (kind) {
    const cost = abilityChargeCost(world, hero, kind);
    const ready = (item.charge ?? 0) >= cost;
    nodes.push(el('p', { className: `pd-art-state${ready && item === hero.armor ? ' on' : ''}`, textContent: capital(abilityName(kind)) }));
  }
  return nodes;
}

function abilityChargeCost(world: World, hero: Hero, kind: AbilityKind): number {
  return Number(chargeText(world, hero, kind));
}
