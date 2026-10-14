import {
  type Action, canUseMove, COMBO_MOVES, COMBO_REQ, type ComboMove, comboOf, type Hero, type HeroClass, itemDef, metamorphOptions, metamorphTargets, METAMORPH_OPTIONS, type MetamorphTarget, SUBCLASSES,
  type SubClass, SUBCLASS_TALENTS, readBook, talentPointsAvailable, talentPointsSpent, TALENTS, talentIcon, type TalentId, TIER_LEVELS, tierPoints,
  pointsInTalent, upgradeProblem, type World,
} from '@pd/core';
import { audio } from './audio';
import { capitalize, lang, t } from './i18n';
import {
  AVATAR, button, el, hideOverlay, show, showConfirm, showInfo, windowOf,
} from './screens';
import { abilityName } from './abilitytext';
import { emphasized, subclassDesc, subclassName, subclassShort, tal, talentDesc, talentLevels, talentTitle } from './talenttext';

/*
 * The talents' windows, after the design system's ShTalents and ShPicks: the hero window's «Talents» tab with its four tiers,
 * a talent's card, the choice of a way with Tengu's mask, and the scroll of metamorphosis's two steps (WndHero,
 * TalentsPane, WndInfoTalent, WndChooseSubclass, ScrollOfMetamorphosis).
 */

/** What the windows need of the game. */
export interface TalentHost {
  world: World;
  hero: Hero;
  act(action: Action): void;
  onClose(): void;
}

const ru = lang === 'ru';
const UI = {
  hero: ru ? 'Герой' : 'Hero',
  talents: ru ? 'Таланты' : 'Talents',
  tier: (n: number): string => (ru ? `Ярус ${n}` : `Tier ${n}`),
  levels: (a: number, b: number): string => (ru ? `ур. ${a}–${b}` : `lvl ${a}–${b}`),
  free: ru ? 'свободно' : 'free',
  hint: ru ? 'Касание по таланту — описание' : 'Tap a talent for its description',
  random: ru ? 'Наугад' : 'Random',
  upgrade: ru ? 'Улучшить' : 'Upgrade',
  of: (a: number, b: number): string => (ru ? `${a} из ${b}` : `${a} of ${b}`),
  freeInTier: (tier: number): string => (ru ? `Свободно очков яруса ${tier}: ` : `Free tier ${tier} points: `),
  noPoints: ru ? 'Нет свободных очков в этом ярусе.' : 'No free points in this tier.',
  maxed: ru ? 'Талант улучшен до предела.' : 'This talent is at its best.',
  tierClass: ru ? 'Класс' : 'Class',
  choose: ru ? 'Выбрать' : 'Choose',
  details: ru ? 'Подробнее' : 'Details',
  opens: ru ? 'откроет ярус 3' : 'opens tier 3',
  wayTitle: ru ? 'Путь мастерства' : 'Path of mastery',
  metamorphose: ru ? 'Изменить талант' : 'Metamorphose talent',
  cancel: ru ? 'Отмена' : 'Cancel',
  locked4: ru ? 'С 20 уровня: наденьте корону короля гномов и выберите способность брони.' : 'From level 20: put on the Dwarf King\'s crown and choose an armour ability.',
};

/* Icons */

const frame = (node: HTMLElement, n: number, columns: number): HTMLElement => {
  node.style.setProperty('--ix', String(n % columns));
  node.style.setProperty('--iy', String(Math.trunc(n / columns)));
  return node;
};

/** Talent.icon: a 16 px frame of talent_icons.png (32 to a row), at the size the window gives it. */
export const ticon = (n: number): HTMLElement => frame(el('i', { className: 'pd-ticon' }), n, 32);
/** HeroIcon: a frame of hero_icons.png (8 to a row). */
export const hicon = (n: number): HTMLElement => frame(el('i', { className: 'pd-hicon' }), n, 8);
/** ItemSpriteSheet: a frame of Shattered's items.png (16 to a row). */
export const sitem = (n: number): HTMLElement => frame(el('i', { className: 'pd-sitem' }), n, 16);

/** HeroIcon.* of each subclass. */
export const SUBCLASS_ICON: Readonly<Record<SubClass, number>> = {
  berserker: 0, gladiator: 1, battlemage: 2, warlock: 3, assassin: 4, freerunner: 5, sniper: 6, warden: 7, champion: 8, monk: 9, priest: 10, paladin: 11,
};
const GLOW: Readonly<Record<SubClass, string>> = {
  berserker: '#ff6644', gladiator: '#ffcc66', battlemage: '#66aaff', warlock: '#b070ff', assassin: '#9a9a9a', freerunner: '#66ddaa',
  sniper: '#ffaa44', warden: '#77cc55', champion: '#ffb04a', monk: '#e8d070', priest: '#fff2a0', paladin: '#ffe070',
};

const pips = (points: number, max: number): HTMLElement =>
  el('span', { className: 'pd-pips' }, ...Array.from({ length: max }, (_, i) => el('i', { className: i < points ? 'on' : '' })));

/* The hero window */

let heroView: { host: TalentHost; stats: HTMLElement[]; tab: 'stats' | 'talents'; redraw(): void } | null = null;
let cardOf: TalentId | null = null;

/** Tiers that have a point to spend, for the «+» on the hero's button and the tab. */
export function hasFreePoints(hero: Hero): boolean {
  return [1, 2, 3, 4].some((tier) => talentPointsAvailable(hero, tier) > 0);
}

/** WndHero: the hero's numbers and, in a second tab, their talents. */
export function showHeroWindow(host: TalentHost, stats: HTMLElement[], title: string, sub: string, icon: HTMLElement, tab: 'stats' | 'talents' = 'stats'): void {
  heroView = { host, stats, tab, redraw: () => draw(title, sub, icon) };
  cardOf = null;
  draw(title, sub, icon);
}

function draw(title: string, sub: string, icon: HTMLElement): void {
  const view = heroView!;
  const { host } = view;
  const body = el('div', { className: 'pd-scroll' });
  const free = hasFreePoints(host.hero);
  const tabButton = (id: 'stats' | 'talents', label: string): HTMLButtonElement => {
    const node = el('button', { className: 'pd-tab', textContent: label, onclick: () => {
      audio.play('click');
      view.tab = id;
      draw(title, sub, icon);
    } });
    node.setAttribute('role', 'tab');
    node.setAttribute('aria-selected', String(view.tab === id));
    if (id === 'talents' && free) node.append(el('i', { className: 'pd-tab-plus', ariaLabel: ru ? 'есть очки' : 'free points' }));
    return node;
  };
  const tabs = el('div', { className: 'pd-tabs compact' }, tabButton('stats', UI.hero), tabButton('talents', UI.talents));
  tabs.setAttribute('role', 'tablist');
  if (view.tab === 'stats') body.append(...view.stats);
  else body.append(talentsPane(host, (id) => showCard(host, id, () => draw(title, sub, icon))));
  const foot = view.tab === 'talents'
    ? el('div', { className: 'pd-talents-foot' }, el('span', { textContent: UI.hint }), button(UI.random, () => spendAtRandom(host), 'quiet small'))
    : null;
  const box = windowOf({ title, sub, icon, onClose: host.onClose, className: 'pd-hero-window' }, tabs, body, foot);
  show(box, host.onClose);
}

/** The hero window, if open, drawn again (after a talent point is spent, a level gained, a way chosen). */
export function refreshHeroWindow(world: World, hero: Hero): void {
  if (!heroView || !document.querySelector('.pd-hero-window')) {
    heroView = null;
    return;
  }
  heroView.host = { ...heroView.host, world, hero };
  heroView.redraw();
}

/** TalentsPane's «Random» button: one free point to a random talent that can take it. */
function spendAtRandom(host: TalentHost): void {
  const choices: TalentId[] = [];
  for (let tier = 1; tier <= 4; tier++) {
    if (talentPointsAvailable(host.hero, tier) <= 0) continue;
    for (const [id] of Object.entries(readBook(host.hero).tiers[tier - 1]!)) if (upgradeProblem(host.hero, id) === null) choices.push(id as TalentId);
  }
  if (choices.length === 0) return;
  host.act({ type: 'talent', talent: choices[Math.floor(Math.random() * choices.length)]! });
}

/** The four tiers (TalentsPane): class talents, the way's, the armour ability's; the closed ones say what opens them. */
export function talentsPane(host: TalentHost, onPick: (id: TalentId) => void, only: ReadonlySet<number> | null = null): HTMLElement {
  const { hero } = host;
  const book = readBook(hero);
  const pane = el('div', { className: 'pd-talents' });
  for (let tier = 1; tier <= 4; tier++) {
    if (only && !only.has(tier)) continue;
    const first = TIER_LEVELS[tier]!;
    const last = TIER_LEVELS[tier + 1]! - 1;
    const talents = Object.entries(book.tiers[tier - 1]!) as Array<[TalentId, number]>;
    const available = talentPointsAvailable(hero, tier);
    const locked = (tier === 4 && !hero.ability) || (tier === 3 && !hero.subclass) || (tier === 2 && hero.lvl < first - 1) || (tier === 3 && hero.lvl < first - 1);
    const spent = talentPointsSpent(hero, tier);
    const counter = el('span', { className: `pd-tier-points${available > 0 ? ' free' : ''}` });
    if (!locked) {
      if (available > 0) counter.append(`${UI.free} `, el('b', { textContent: String(available) }));
      else counter.append(el('b', { textContent: String(spent) }), `/${tierPoints(tier)}`);
    }
    const sub = tier === 3 && hero.subclass ? `${UI.tierClass} · ${capitalize(subclassName(hero.subclass))}` : UI.levels(first, last);
    const head = el('header', { className: 'pd-tier-head' }, el('h3', { textContent: UI.tier(tier) }), el('span', { className: 'pd-tier-sub', textContent: sub }), counter);
    const section = el('section', { className: `pd-tier${locked ? ' locked' : ''}` }, head);
    if (locked) {
      const ghosts = el('div', { className: 'pd-talent-ghosts' }, ...Array.from({ length: tier === 3 ? 5 : tier === 4 ? 4 : 5 }, () => el('i')));
      ghosts.setAttribute('aria-hidden', 'true');
      const text = tier === 4 ? UI.locked4 : tier === 3 ? tal('ui.talentspane.unlock_tier3') : tal('ui.talentspane.unlock_tier2');
      section.append(ghosts, el('p', { className: 'pd-tier-lock', textContent: text }));
    } else {
      const row = el('div', { className: 'pd-talent-row' });
      for (const [id, points] of talents) {
        const def = TALENTS[id];
        if (!def) continue;
        const can = upgradeProblem(hero, id) === null;
        const node = el('button', { className: `pd-talent${points === 0 ? ' zero' : ''}${points >= def.max ? ' max' : ''}${can ? ' can' : ''}${cardOf === id ? ' selected' : ''}` }, ticon(talentIcon(id, hero.heroClass)), pips(points, def.max));
        node.ariaLabel = `${talentTitle(id)}, ${UI.of(points, def.max)}`;
        node.onclick = () => {
          audio.play('click');
          onPick(id);
        };
        row.append(node);
      }
      section.append(row);
    }
    pane.append(section);
  }
  return pane;
}

/* A talent's card (WndInfoTalent) */

interface CardAction {
  label: string;
  onPick(): void;
}

/** A talent's card: what each point gives, how many are in it, and the upgrade. `pick` replaces the upgrade (metamorphosis). */
export function showCard(host: TalentHost, id: TalentId, back: () => void, pick?: CardAction, points?: number, metamorphed = false): void {
  const { hero } = host;
  const def = TALENTS[id];
  const have = points ?? readBook(hero).tiers.map((tier) => tier[id]).find((value) => value !== undefined) ?? 0;
  const { lead, levels } = talentLevels(id, def.max);
  const tier = def.tier;
  const owner = tier === 4 && hero.ability ? capitalize(abilityName(hero.ability)) : tier === 3 && hero.subclass && SUBCLASS_TALENTS[hero.subclass].includes(id) ? capitalize(subclassName(hero.subclass)) : UI.tierClass;
  cardOf = id;
  const list = el(
    'ol',
    { className: 'pd-talent-levels' },
    ...levels.map((text, i) => el('li', { className: i < have ? 'done' : i === have ? 'next' : '' }, el('b', { textContent: `+${i + 1}` }), el('span', {}, ...emphasized(text)))),
  );
  const leadNode = lead ? el('p', { className: 'pd-info' }, ...emphasized(lead)) : null;
  const meta = metamorphed ? tal(`actors.hero.talent.${id}.meta_desc`) : '';
  const close = (): void => {
    cardOf = null;
    back();
  };
  const problem = upgradeProblem(hero, id);
  const available = talentPointsAvailable(hero, tier);
  let actions: HTMLElement;
  if (pick) {
    actions = el('div', { className: 'pd-actions' }, button(pick.label, pick.onPick, 'primary'));
  } else if (problem === null) {
    actions = el('div', { className: 'pd-actions' }, button(UI.upgrade, () => {
      host.act({ type: 'talent', talent: id });
      close();
    }, 'primary'), el('p', { className: 'pd-talent-cost' }, UI.freeInTier(tier), el('b', { textContent: String(available) })));
  } else {
    actions = el('div', { className: 'pd-actions' }, el('p', { className: 'pd-note center', textContent: have >= def.max ? UI.maxed : UI.noPoints }));
  }
  show(
    windowOf(
      {
        title: capitalize(talentTitle(id)),
        sub: `${UI.tier(tier)} · ${owner}`,
        icon: el('div', { className: 'pd-slot' }, ticon(talentIcon(id, hero.heroClass))),
        narrow: true,
        className: 'pd-talent-card',
        onClose: close,
      },
      el('div', { className: 'pd-talent-progress' }, pips(have, def.max), el('span', { textContent: UI.of(have, def.max) })),
      leadNode,
      list,
      meta ? el('p', { className: 'pd-note' }, ...emphasized(meta)) : null,
      actions,
    ),
    close,
  );
}

/* The choice of a way (WndChooseSubclass) */

/** Tengu's mask: the two ways of the hero's class as equal cards; the choice can wait. */
export function showSubclassPick(host: TalentHost, maskIndex: number, back: () => void): void {
  const { hero } = host;
  const mask = hero.items[maskIndex]!;
  const cards = SUBCLASSES[hero.heroClass].map((way) => {
    const glow = GLOW[way];
    const art = el('div', { className: 'pd-tpick-art' }, el('i', { className: 'pd-tpick-avatar' }), hicon(SUBCLASS_ICON[way]));
    (art.firstChild as HTMLElement).style.setProperty('--av', String(AVATAR[hero.heroClass as HeroClass]));
    const talents = el('span', { className: 'pd-tpick-talents' }, ...SUBCLASS_TALENTS[way].map((id) => ticon(TALENTS[id].icon)));
    const card = el(
      'div',
      { className: 'pd-tpick' },
      art,
      el('span', { className: 'pd-tpick-name', textContent: capitalize(subclassName(way)) }),
      el('p', { className: 'pd-tpick-desc' }, ...emphasized(subclassShort(way))),
      el('div', { className: 'pd-tpick-tal' }, talents, UI.opens),
      el(
        'div',
        { className: 'pd-tpick-act' },
        button(UI.choose, () => {
          showConfirm(
            capitalize(subclassName(way)),
            tal('windows.wndchoosesubclass.are_you_sure'),
            t.forum.verbs.choose,
            t.forum.verbs.later,
            () => {
              hideOverlay();
              host.act({ type: 'master', item: maskIndex, subclass: way });
            },
            () => showSubclassPick(host, maskIndex, back),
          );
        }),
        button(UI.details, () => {
          showInfo(capitalize(subclassName(way)), subclassDesc(way).split('\n\n'), () => showSubclassPick(host, maskIndex, back), {
            icon: hicon(SUBCLASS_ICON[way]),
          });
        }, 'quiet'),
      ),
    );
    card.style.setProperty('--glow', glow);
    return card;
  });
  show(
    windowOf(
      { title: UI.wayTitle, icon: el('div', { className: 'pd-slot' }, sitem(itemDef(mask.kind).sprite ?? 59)), onClose: back },
      el('p', { className: 'pd-tpick-intro' }, tal('windows.wndchoosesubclass.message')),
      el('div', { className: 'pd-tpicks two' }, ...cards),
      button(tal('windows.wndchoosesubclass.cancel') || t.later, back, 'quiet'),
    ),
    back,
  );
}

/* Metamorphosis (ScrollOfMetamorphosis) */

/** The scroll's two steps: the talent to change, then one of the talents offered for it. */
export function showMetamorphosis(host: TalentHost, scrollIndex: number, back: () => void): void {
  const { hero, world } = host;
  const targets = metamorphTargets(hero);
  const pick = (target: MetamorphTarget): void => {
    const options = metamorphOptions(world, hero, target);
    const index = targets.indexOf(target);
    const cards = el('div', { className: 'pd-talent-row' });
    options.forEach((id, option) => {
      const def = TALENTS[id];
      const node = el('button', { className: 'pd-talent' }, ticon(def.icon), pips(target.points, def.max));
      node.ariaLabel = talentTitle(id);
      node.onclick = () => {
        audio.play('click');
        showCard(host, id, () => pick(target), {
          label: tal('items.scrolls.exotic.scrollofmetamorphosis.metamorphose_talent') || UI.metamorphose,
          onPick: () => {
            hideOverlay();
            host.act({ type: 'use', item: scrollIndex, choice: index * METAMORPH_OPTIONS + option });
          },
        }, target.points, true);
      };
      cards.append(node);
    });
    show(
      windowOf(
        { title: capitalize(t.items['scroll.metamorphosis']), icon: el('div', { className: 'pd-slot' }, sitem(itemDef('scroll.metamorphosis').sprite ?? 0)), onClose: choose },
        el('p', { className: 'pd-info' }, tal('items.scrolls.exotic.scrollofmetamorphosis.replace_desc')),
        el('section', { className: 'pd-tier' }, cards),
        button(UI.cancel, back, 'quiet'),
      ),
      choose,
    );
  };
  function choose(): void {
    const pane = el('div', { className: 'pd-talents' });
    for (let tier = 1; tier <= 3; tier++) {
      const row = el('div', { className: 'pd-talent-row' });
      for (const target of targets.filter((target) => target.tier === tier)) {
        const def = TALENTS[target.talent];
        const node = el('button', { className: `pd-talent${target.points === 0 ? ' zero' : ''}` }, ticon(def.icon), pips(target.points, def.max));
        node.ariaLabel = talentTitle(target.talent);
        node.onclick = () => {
          audio.play('click');
          showCard(host, target.talent, choose, {
            label: tal('items.scrolls.exotic.scrollofmetamorphosis.metamorphose_talent') || UI.metamorphose,
            onPick: () => pick(target),
          }, target.points, true);
        };
        row.append(node);
      }
      pane.append(el('section', { className: 'pd-tier' }, el('header', { className: 'pd-tier-head' }, el('h3', { textContent: UI.tier(tier) })), row));
    }
    show(
      windowOf(
        { title: capitalize(t.items['scroll.metamorphosis']), icon: el('div', { className: 'pd-slot' }, sitem(itemDef('scroll.metamorphosis').sprite ?? 0)), onClose: back },
        el('p', { className: 'pd-info' }, tal('items.scrolls.exotic.scrollofmetamorphosis.choose_desc')),
        el('div', { className: 'pd-scroll' }, pane),
        button(UI.cancel, back, 'quiet'),
      ),
      back,
    );
  }
  choose();
}


/* The gladiator's combo moves (WndCombo) */

/** ComboMove.desc(count): what a move does at this combo, with enhanced combo's changes. */
export function comboMoveDesc(hero: Hero, move: ComboMove, count: number): string {
  const enhanced = pointsInTalent(hero, 'enhanced_combo');
  const key = `actors.buffs.combo$combomove.${move}`;
  switch (move) {
    case 'clobber':
      return count >= 7 && enhanced >= 1 ? tal(`${key}.empower_desc`) : tal(`${key}.desc`);
    case 'slam':
      return count >= 3 && enhanced >= 3 ? tal(`${key}.empower_desc`, Math.trunc(count / 3), count * 20) : tal(`${key}.desc`, count * 20);
    case 'parry':
      return count >= 9 && enhanced >= 2 ? tal(`${key}.empower_desc`) : tal(`${key}.desc`);
    case 'crush':
      return count >= 3 && enhanced >= 3 ? tal(`${key}.empower_desc`, Math.trunc(count / 3), count * 25) : tal(`${key}.desc`, count * 25);
    default:
      return count >= 3 && enhanced >= 3 ? tal(`${key}.empower_desc`, Math.trunc(count / 3)) : tal(`${key}.desc`);
  }
}

/** WndCombo: the moves the combo has opened, each with what it does; the chosen one asks for its target. */
export function showComboWindow(host: TalentHost, onPick: (move: ComboMove) => void): void {
  const combo = comboOf(host.hero);
  if (!combo) return;
  const rows = COMBO_MOVES.map((move) => {
    const ready = canUseMove(combo, move);
    const open = combo.count >= COMBO_REQ[move];
    const pickMove = (): void => {
      hideOverlay();
      onPick(move);
    };
    const note = !open ? `${tal('actors.buffs.combo.name')} ${COMBO_REQ[move]}+` : '';
    return el(
      'div',
      { className: `pd-choice${ready ? '' : ' dim'}` },
      el('span', { className: 'pd-choice-name', textContent: capitalize(tal(`actors.buffs.combo$combomove.${move}.name`)) }),
      el('p', { className: 'pd-choice-desc', textContent: open ? comboMoveDesc(host.hero, move, combo.count) : note }),
      ready ? button(UI.choose, pickMove, 'small') : null,
    );
  });
  show(
    windowOf(
      { title: capitalize(tal('actors.buffs.combo.action_name')), sub: String(combo.count), icon: el('div', { className: 'pd-slot' }, hicon(105)), onClose: host.onClose },
      el('div', { className: 'pd-choices' }, ...rows),
    ),
    host.onClose,
  );
}
