import { challengeMultiplier, type Hero, type Item, itemDef, type ItemKind, ITEMS, itemSprite, journalNotes, type Landmark, S, type World } from '@pd/core';
import { audio } from './audio';
import { fx } from './fx';
import { capitalize, lang, locale, t } from './i18n';
import { itemInfo, itemName } from './itemtext';
import { type FxMode, quality } from './quality';
import { el, info, show, sprites, windowOf } from './screens';
import { canFullscreen, haptics, isFullscreen, openExternal, setFullscreen } from './telegram';
import { hints } from './hints';

/*
 * The windows around the game rather than in it (design system v9): the
 * settings, the about window, the challenges and the journal with its catalog.
 */

const SOURCE_URL = 'https://github.com/shiba-vibecoding/pixel-dungeon-telegram';
const ORIGIN_URL = 'http://pixeldungeon.watabou.ru';
const SHATTERED_URL = 'https://shatteredpixel.com';
/** A page served beside the game (privacy.html, terms.html), as a full address for Telegram's browser. */
const page = (name: string): string => new URL(name, document.baseURI).href;

declare const __BUILD__: { commit: string; date: string } | undefined;
/** The build, stamped by Vite: the commit and the day it was built. */
const BUILD = typeof __BUILD__ !== 'undefined' ? __BUILD__ : { commit: 'dev', date: new Date().toISOString().slice(0, 10) };

const click = (): void => audio.play('click');

/* Controls */

/** A level in five steps of 44 px: a tap on a step sets it; on the only lit first step, silence. */
function stepsRow(label: string, get: () => number, set: (volume: number) => void, sample: () => void): HTMLElement {
  const value = el('span', { className: 'pd-set-value' });
  const box = el('div', { className: 'pd-steps' });
  box.setAttribute('role', 'slider');
  box.setAttribute('aria-label', label);
  box.setAttribute('aria-valuemin', '0');
  box.setAttribute('aria-valuemax', '100');
  const paint = (): void => {
    const lit = Math.round(get() * 5);
    [...box.children].forEach((node, i) => {
      node.classList.toggle('on', i < lit);
      node.setAttribute('aria-pressed', String(i < lit));
    });
    box.classList.toggle('off', lit === 0);
    box.setAttribute('aria-valuenow', String(lit * 20));
    value.textContent = lit ? `${lit * 20}%` : t.meta.off;
  };
  for (let i = 0; i < 5; i++) {
    const step = el('button', {
      className: 'pd-step',
      ariaLabel: `${label} ${(i + 1) * 20}%`,
      onclick: () => {
        const lit = Math.round(get() * 5);
        set(lit === 1 && i === 0 ? 0 : (i + 1) / 5);
        paint();
        sample();
      },
    });
    box.append(step);
  }
  paint();
  return el(
    'div',
    { className: 'pd-set-row' },
    el('span', { className: 'pd-set-label' }, el('span', { className: 'pd-info', textContent: label }), value),
    box,
  );
}

/** One of a few choices (a radio group of segments). */
function segments<V extends string>(choices: ReadonlyArray<readonly [V, string]>, value: V, onChange: (v: V) => void, inline = false): HTMLElement {
  const box = el('div', { className: `pd-seg${inline ? ' inline' : ''}` });
  box.setAttribute('role', 'radiogroup');
  const paint = (current: V): void => {
    [...box.children].forEach((node) => node.setAttribute('aria-checked', String((node as HTMLElement).dataset.v === current)));
  };
  for (const [v, label] of choices) {
    const option = el('button', {
      className: 'pd-seg-opt',
      textContent: label,
      onclick: () => {
        click();
        paint(v);
        onChange(v);
      },
    });
    option.dataset.v = v;
    option.setAttribute('role', 'radio');
    box.append(option);
  }
  paint(value);
  return box;
}

/** A row that turns something on or off. */
function switchRow(label: string, note: string | null, on: boolean, onChange: (on: boolean) => void): HTMLElement {
  const row = el(
    'button',
    {
      className: 'pd-switch',
      onclick: () => {
        const next = row.getAttribute('aria-checked') !== 'true';
        click();
        row.setAttribute('aria-checked', String(next));
        onChange(next);
      },
    },
    el(
      'span',
      { className: 'pd-set-label' },
      el('span', { className: 'pd-info', textContent: label }),
      note && el('span', { className: 'pd-set-value', textContent: note }),
    ),
    el('span', { className: 'pd-switch-box' }),
  );
  row.setAttribute('role', 'switch');
  row.setAttribute('aria-checked', String(on));
  return row;
}

/** A row that leads somewhere: another window, or (ext) a page outside the game. */
function linkRow(label: string, onClick: () => void, external = false, sub?: string): HTMLElement {
  return el(
    'button',
    {
      className: `pd-linkrow${external ? ' ext' : ''}`,
      onclick: () => {
        click();
        onClick();
      },
    },
    el('span', {}, label, sub && el('small', { textContent: sub })),
  );
}

const group = (head: string | null, ...rows: Array<HTMLElement | null | false>): HTMLElement =>
  el('section', { className: 'pd-set-group' }, head && el('h3', { className: 'pd-set-head', textContent: head }), ...rows);

/* Settings */

export interface SettingsOptions {
  onClose(): void;
  /** The effects changed: the canvas is sized anew. */
  onEffects(mode: FxMode): void;
  /** Asked to erase everything on this device (see eraseDevice), once confirmed. */
  onReset(): void;
  /** The bot's reminders (in Telegram): on now, and the switch; absent elsewhere. */
  reminders?: { on: boolean; set(on: boolean): void };
}

/** The settings, from the title's corner or the menu in a run. */
export function showSettings(options: SettingsOptions): void {
  // An older «sound off» switch counts as silence here; any step brings the sound back.
  const level = (volume: number): number => (audio.enabled ? volume : 0);
  const louder = (set: (volume: number) => void) => (volume: number): void => {
    if (volume > 0 && !audio.enabled) audio.setEnabled(true);
    set(volume);
  };
  const fxNote = info(t.meta.fxNotes[quality.mode], 'pd-note');
  const sound = group(
    t.meta.sound,
    stepsRow(t.musicVolume, () => level(audio.musicVolume), louder((v) => audio.setMusicVolume(v)), () => undefined),
    stepsRow(t.soundVolume, () => level(audio.soundVolume), louder((v) => audio.setSoundVolume(v)), () => audio.play('coin', 1, 0.6)),
    switchRow(t.meta.vibration, t.meta.vibrationNote, haptics.on, (on) => haptics.set(on)),
  );
  const modes: ReadonlyArray<readonly [FxMode, string]> = (['auto', 'full', 'light'] as const).map((m) => [m, t.meta.fxModes[m]] as const);
  const learning = group(
    t.meta.learning,
    switchRow(t.meta.hints, t.meta.hintsNote, hints.enabled, (on) => hints.setEnabled(on)),
    options.reminders ? switchRow(t.ranked.remindersSwitch, t.ranked.remindersNote, options.reminders.on, (on) => options.reminders!.set(on)) : null,
    linkRow(t.meta.hintsAgain, () => {
      hints.reset();
      hints.setEnabled(true);
      showSettings(options);
    }),
  );
  const game = group(
    t.meta.game,
    el(
      'div',
      { className: 'pd-set-row stack' },
      el('span', { className: 'pd-info', textContent: t.meta.effects }),
      segments(modes, quality.mode, (mode) => {
        quality.setMode(mode);
        fxNote.textContent = t.meta.fxNotes[mode];
        options.onEffects(mode);
      }),
      fxNote,
    ),
    stepsRow(t.meta.shake, () => quality.shake, (v) => quality.setShake(v), () => fx.shake(3, 240, fx.now)),
    canFullscreen() && switchRow(t.fullscreen, null, isFullscreen(), (on) => setFullscreen(on)),
    el(
      'div',
      { className: 'pd-set-row' },
      el('span', { className: 'pd-info', textContent: t.meta.language }),
      segments([['ru', 'Русский'], ['en', 'English']] as const, lang, (next) => {
        if (next === lang) return;
        try {
          localStorage.setItem('pd-lang', next);
        } catch {
          return;
        }
        // Every word on the page is chosen at load: load it again in the other language.
        location.reload();
      }, true),
    ),
  );
  const reopen = (): void => showSettings(options);
  const more = group(
    t.meta.more,
    linkRow(t.meta.about, () => showAbout(reopen)),
    linkRow(t.meta.privacy, () => openExternal(page('privacy.html')), true),
    linkRow(t.meta.terms, () => openExternal(page('terms.html')), true),
  );
  const reset = el(
    'section',
    { className: 'pd-set-group danger' },
    el('button', { className: 'pd-button danger', textContent: t.meta.reset, onclick: () => (click(), confirmReset(reopen, options.onReset)) }),
  );
  show(
    windowOf(
      { title: t.meta.settings, onClose: options.onClose, className: 'settings' },
      el(
        'div',
        { className: 'pd-scroll pd-settings' },
        el('div', { className: 'pd-col' }, sound, game, learning),
        el('div', { className: 'pd-col' }, more, reset),
      ),
    ),
    options.onClose,
  );
}

/** Everything this game keeps on the device; purchases live on the server. */
export function eraseDevice(): void {
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('pd-')) localStorage.removeItem(key);
    }
    sessionStorage.clear();
  } catch {
    // Nothing could be kept either.
  }
}

function confirmReset(onCancel: () => void, onDone: () => void): void {
  const cancel = el('button', { className: 'pd-button quiet', textContent: t.meta.cancel, onclick: () => (click(), onCancel()) });
  const box = windowOf(
    { narrow: true },
    el('h2', { className: 'pd-heading center', textContent: t.meta.resetTitle }),
    info(t.meta.resetText, 'pd-info center'),
    info(t.meta.resetKeep, 'pd-note center'),
    el(
      'div',
      { className: 'pd-actions' },
      el('button', {
        className: 'pd-button danger',
        textContent: t.meta.resetYes,
        onclick: () => {
          click();
          onDone();
        },
      }),
      cancel,
    ),
  );
  show(box, onCancel);
  cancel.focus();
}

/* About */

export function showAbout(onClose: () => void): void {
  const credits = el('dl', { className: 'pd-credits' });
  for (const [what, who, more] of t.meta.credits) {
    credits.append(
      el('div', { className: 'pd-credit' }, el('dt', { textContent: what }), el('dd', {}, who, more && el('small', { textContent: more }))),
    );
  }
  show(
    windowOf(
      { title: t.meta.about, onClose },
      el(
        'div',
        { className: 'pd-scroll pd-about' },
        el(
          'div',
          { className: 'pd-about-logo' },
          el('img', { src: 'assets/banner-title.png', alt: 'Pixel Dungeon' }),
          el('span', { className: 'pd-logo-sub', textContent: t.meta.subtitle }),
          el('span', { className: 'pd-set-value', textContent: t.meta.basedOn }),
          el('span', { className: 'pd-build', textContent: t.meta.build(BUILD.commit, BUILD.date) }),
        ),
        credits,
        el(
          'div',
          {},
          linkRow(t.meta.source, () => openExternal(SOURCE_URL), true, SOURCE_URL.replace('https://', '')),
          linkRow(t.meta.origin, () => openExternal(ORIGIN_URL), true, ORIGIN_URL.replace('http://', '')),
          linkRow(t.meta.shattered, () => openExternal(SHATTERED_URL), true, SHATTERED_URL.replace('https://', '')),
        ),
        el('p', { className: 'pd-legal', textContent: t.meta.legal }),
      ),
    ),
    onClose,
  );
}

/* Challenges */

/** The challenges in the original's order, as bits (Challenges.MASKS). */
export const CHALLENGE_MASKS = [1, 2, 4, 8, 16, 32, 64] as const;

export function countChallenges(mask: number): number {
  return CHALLENGE_MASKS.filter((bit) => mask & bit).length;
}

export interface ChallengesOptions {
  mask: number;
  /** Challenges open after the first victory (the original's VICTORY badge). */
  unlocked: boolean;
  onChange(mask: number): void;
  onClose(): void;
}

/** WndChallenges: seven switches, locked until the first victory. */
export function showChallenges(options: ChallengesOptions): void {
  let mask = options.unlocked ? options.mask : 0;
  // How many are on, and what they do to the score (core daily.ts challengeMultiplier).
  const onText = (m: number): string =>
    countChallenges(m) > 0 ? `${t.meta.challengesOn(countChallenges(m))} · ${t.ranked.scoreTimes(challengeMultiplier(m).toLocaleString(locale))}` : t.meta.challengesOn(0);
  const sub = el('span', { className: 'pd-note', textContent: onText(mask) });
  const list = el('div', { className: `pd-challenges${options.unlocked ? '' : ' locked'}` });
  if (!options.unlocked) list.append(el('p', { className: 'pd-lockplate' }, el('span', { textContent: t.meta.challengesLocked })));
  t.meta.challengeList.forEach(([name, desc], i) => {
    const bit = CHALLENGE_MASKS[i]!;
    const icon = el('i', { className: 'pd-ch-icon' });
    icon.style.setProperty('--c', String(i));
    const row = el(
      'button',
      {
        className: 'pd-challenge',
        onclick: () => {
          if (!options.unlocked) return;
          click();
          mask ^= bit;
          row.setAttribute('aria-checked', String(Boolean(mask & bit)));
          sub.textContent = onText(mask);
          options.onChange(mask);
        },
      },
      icon,
      el(
        'span',
        { className: 'pd-ch-text' },
        el('span', { className: 'pd-ch-name', textContent: name }),
        el('span', { className: 'pd-ch-desc', textContent: desc }),
      ),
      el('span', { className: 'pd-switch-box' }),
    );
    row.setAttribute('role', 'switch');
    row.setAttribute('aria-checked', String(Boolean(mask & bit)));
    if (!options.unlocked) row.setAttribute('aria-disabled', 'true');
    list.append(row);
  });
  const box = windowOf({ title: t.meta.challenges, onClose: options.onClose }, el('div', { className: 'pd-scroll' }, list), info(t.meta.challengesFoot, 'pd-note center'));
  box.querySelector('.pd-titles')?.append(sub);
  show(box, options.onClose);
}

/* Journal */

/** Journal.Feature, in the order of journal.png: the icons the notes take from it. */
const enum Feature {
  WellOfHealth, WellOfAwareness, WellOfTransmutation, Sacrifice, Alchemy, Garden, Statue, Ghost, Wandmaker, Troll, Imp,
}

/** A landmark's icon (Notes.LandmarkRecord.icon): journal.png's where it has one, else an item's picture. */
const LANDMARK_ICONS: Readonly<Record<Landmark, { feature: Feature } | { item: number } | null>> = {
  chasmFloor: null, waterFloor: null, grassFloor: null,
  shop: { item: S.GOLD }, alchemy: { feature: Feature.Alchemy }, garden: { feature: Feature.Garden },
  wellOfHealth: { feature: Feature.WellOfHealth }, wellOfAwareness: { feature: Feature.WellOfAwareness },
  wellOfTransmutation: { feature: Feature.WellOfTransmutation }, sacrificialFire: { feature: Feature.Sacrifice },
  statue: { feature: Feature.Statue }, beaconLocation: { item: S.BEACON }, ghost: { feature: Feature.Ghost }, ratKing: { item: S.CROWN },
  wandmaker: { feature: Feature.Wandmaker }, troll: { feature: Feature.Troll }, imp: { feature: Feature.Imp },
};

function noteIcon(landmark: Landmark): HTMLElement {
  const icon = LANDMARK_ICONS[landmark];
  if (icon && 'item' in icon) {
    const node = el('i', { className: 'pd-item' });
    node.dataset.i = String(icon.item);
    return el('span', { className: 'pd-jicon item' }, node);
  }
  const node = el('i', { className: 'pd-jicon' });
  if (icon) node.style.setProperty('--j', String(icon.feature));
  else node.classList.add('blank');
  return node;
}

/** What the catalog lists, by tab, and the silhouette an unknown one shows (items.png). */
const CATALOG: ReadonlyArray<{ category: 'potion' | 'scroll' | 'ring' | 'wand'; silhouette: number }> = [
  { category: 'potion', silhouette: S.POTION_TURQUOISE },
  { category: 'scroll', silhouette: S.SCROLL_KAUNAN },
  { category: 'ring', silhouette: S.RING_EMERALD },
  { category: 'wand', silhouette: S.WAND_CORRUPTION },
];

export interface JournalOptions {
  world: World;
  hero: Hero;
  onClose(): void;
}

/** WndJournal and WndCatalogus in one window: the notes, and every potion, scroll, ring and wand. */
export function showJournal(options: JournalOptions, tab: 'notes' | 'catalog' = 'notes', category = 0): void {
  const { world, hero } = options;
  const reopen = (nextTab: 'notes' | 'catalog', nextCategory = category): void => showJournal(options, nextTab, nextCategory);
  const tabs = el('div', { className: 'pd-tabs' });
  tabs.setAttribute('role', 'tablist');
  for (const [id, label] of [['notes', t.meta.notes], ['catalog', t.meta.catalog]] as const) {
    const node = el('button', { className: 'pd-tab', textContent: label, onclick: () => (click(), reopen(id)) });
    node.setAttribute('role', 'tab');
    node.setAttribute('aria-selected', String(id === tab));
    tabs.append(node);
  }
  const body = tab === 'notes' ? notesView(world, hero) : catalogView(options, category, (next) => reopen('catalog', next));
  show(
    windowOf({ title: t.meta.journal, onClose: options.onClose, className: 'wide' }, tabs, el('div', { className: 'pd-scroll' }, body)),
    options.onClose,
  );
}

/**
 * WndJournal.NotesTab: the notes the core keeps (journal.ts), floor by floor, deepest first, with the
 * keys the hero holds for each floor (Notes.KeyRecord).
 */
function notesView(world: World, hero: Hero): HTMLElement {
  const notes = journalNotes(world);
  const keys = hero.items.filter((item) => itemDef(item.kind).category === 'key' && item.depth !== undefined);
  const depths = [...new Set([...notes.map((note) => note.depth), ...keys.map((key) => key.depth!)])].sort((a, b) => b - a);
  if (depths.length === 0) return el('p', { className: 'pd-empty pd-note center', textContent: t.hero.notesDesc });
  const list = el('div', { className: 'pd-journal' });
  for (const depth of depths) {
    list.append(el('div', { className: 'pd-jdepth-mark', textContent: t.hero.floorHeader(depth) }));
    for (const note of notes.filter((n) => n.depth === depth)) {
      list.append(el(
        'div',
        { className: `pd-jrow${depth === hero.depth ? ' here' : ''}` },
        noteIcon(note.landmark),
        el('span', { className: 'pd-jname', textContent: capitalize(t.hero.landmarks[note.landmark]) }),
      ));
    }
    for (const key of keys.filter((k) => k.depth === depth)) {
      const icon = el('i', { className: 'pd-item' });
      icon.dataset.i = String(itemSprite(key, world.run.labels));
      list.append(el(
        'div',
        { className: `pd-jrow${depth === hero.depth ? ' here' : ''}` },
        el('span', { className: 'pd-jicon item' }, icon),
        el('span', { className: 'pd-jname', textContent: capitalize(itemName(world, key)) }),
      ));
    }
  }
  sprites(list);
  return list;
}

function catalogView(options: JournalOptions, category: number, choose: (category: number) => void): HTMLElement {
  const { world, hero } = options;
  const tabs = el('div', { className: 'pd-tabs compact' });
  tabs.setAttribute('role', 'tablist');
  t.meta.categories.forEach((label, i) => {
    const node = el('button', { className: 'pd-tab', textContent: label, onclick: () => (click(), choose(i)) });
    node.setAttribute('role', 'tab');
    node.setAttribute('aria-selected', String(i === category));
    tabs.append(node);
  });
  const { category: kind, silhouette } = CATALOG[category]!;
  const kinds = (Object.keys(ITEMS) as ItemKind[]).filter((k) => itemDef(k).category === kind);
  const known = kinds.filter((k) => world.known.includes(k));
  const detail = el('div', { className: 'pd-cat-detail' });
  const grid = el('div', { className: 'pd-grid pd-catalog' });
  grid.setAttribute('role', 'listbox');
  const pick = (k: ItemKind, slot: HTMLElement): void => {
    grid.querySelectorAll('.selected').forEach((node) => node.classList.remove('selected'));
    slot.classList.add('selected');
    const isKnown = world.known.includes(k);
    const item = { kind: k, qty: 1, level: 0 } as Item;
    detail.className = `pd-cat-detail${isKnown ? '' : ' unknown'}`;
    detail.replaceChildren(
      itemIcon(isKnown ? itemSprite(item, world.run.labels) : silhouette, !isKnown),
      el('span', {}, el('b', { textContent: t.items[k] }), el('small', { textContent: isKnown ? t.meta.identified : t.meta.notIdentified })),
    );
    sprites(detail);
  };
  for (const k of kinds) {
    const isKnown = world.known.includes(k);
    const item = { kind: k, qty: 1, level: 0 } as Item;
    const slot = el('button', {
      className: `pd-slot${isKnown ? '' : ' unknown'}`,
      ariaLabel: t.items[k],
      onclick: () => {
        click();
        if (isKnown && slot.classList.contains('selected')) {
          // A second tap on a known one reads it, and comes back here.
          showItemText(options, item, () => showJournal(options, 'catalog', category));
          return;
        }
        pick(k, slot);
      },
    }, itemIcon(isKnown ? itemSprite(item, world.run.labels) : silhouette, !isKnown));
    slot.setAttribute('role', 'option');
    grid.append(slot);
  }
  void hero;
  return el(
    'div',
    {},
    tabs,
    el('div', { className: 'pd-cat-count', textContent: t.meta.known(known.length, kinds.length) }),
    grid,
    detail,
  );
}

function itemIcon(sprite: number, silhouette: boolean): HTMLElement {
  const icon = el('i', { className: `pd-item${silhouette ? ' silhouette' : ''}` });
  icon.dataset.i = String(sprite);
  return icon;
}

function showItemText(options: JournalOptions, item: Item, onClose: () => void): void {
  const { world, hero } = options;
  const lines = itemInfo(world, hero, item);
  show(
    windowOf(
      { title: itemName(world, item), icon: el('div', { className: 'pd-slot' }, itemIcon(itemSprite(item, world.run.labels), false)), onClose },
      ...lines.map((line) => info(line)),
    ),
    onClose,
  );
}
