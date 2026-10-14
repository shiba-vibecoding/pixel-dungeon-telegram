import {
  CHALLENGES, challengeMultiplier, type Hero, type Item, itemDef, type ItemKind, ITEMS, itemSprite, journalNotes, kindKnown, type Landmark, type Mob, type MobKind,
  S, type World,
} from '@pd/core';
import { CHALLENGE_MASKS, challengeIcon, countChallenges } from './challenge-info';
import { audio } from './audio';
import { sliderSound } from './sfx';
import { fx } from './fx';
import { capitalize, lang, locale, t } from './i18n';
import { itemInfo, itemName } from './itemtext';
import { type FxMode, quality } from './quality';
import { type QuickCount, quickCount, setQuickCount } from './quickslot';
import { closeButton, el, info, portrait, show, sprites, windowOf } from './screens';
import { mobDescription } from './examine';
import { canFullscreen, haptics, isFullscreen, openExternal, setFullscreen } from './telegram';
import { hints } from './hints';
import { confirmDanger } from './mistap';
import { confirmRisky } from './riskyuse';
import { BEST_GROUPS, BESTIARY_ENTRIES, type BestEntry, type BestGroup, portraitCell, REGION_DEPTHS, slainLabel } from './bestiary';

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

/** «Report a problem»: a row with the report's icon (design v20, .pd-linkrow.report). */
function reportRow(onClick: () => void): HTMLElement {
  const icon = el('i', { className: 'pd-icon' });
  icon.style.cssText = 'width:24px;height:24px;background-image:var(--spr-report)';
  const row = el('button', { className: 'pd-linkrow report', onclick: () => (click(), onClick()) }, icon, el('span', { textContent: t.rel.report.title }));
  row.type = 'button';
  return row;
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
  /** The hero's name, asked for where Telegram does not tell it (the camp has no field for it); absent in Telegram. */
  name?: { value: string; set(name: string): void };
  /** «Report a problem» (reportui.ts): absent where the server cannot take one (no Telegram, no server). */
  onReport?: () => void;
  /** «What's new»: the window of the last update again. */
  onNews?: () => void;
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
    stepsRow(t.soundVolume, () => level(audio.soundVolume), louder((v) => audio.setSoundVolume(v)), () => audio.play(sliderSound())),
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
    switchRow(t.meta.confirmDanger, t.meta.confirmDangerNote, confirmDanger.on, (on) => confirmDanger.set(on)),
    switchRow(t.forum.settings.risky, t.forum.settings.riskyNote, confirmRisky.on, (on) => confirmRisky.set(on)),
    stepsRow(t.meta.shake, () => quality.shake, (v) => quality.setShake(v), () => fx.shake(3, 240, fx.now)),
    el(
      'div',
      { className: 'pd-set-row' },
      el('span', { className: 'pd-info', textContent: t.meta.quickslots }),
      segments([['2', '2'], ['4', '4'], ['6', '6']] as const, String(quickCount()) as '2' | '4' | '6', (n) => setQuickCount(Number(n) as QuickCount), true),
    ),
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
  const nameGroup = options.name && group(
    t.heroName,
    el('input', {
      className: 'pd-input', value: options.name.value, maxLength: 20, placeholder: t.yourName,
      oninput: (event: Event) => options.name!.set((event.target as HTMLInputElement).value),
    }),
  );
  const more = group(
    t.meta.more,
    options.onNews ? linkRow(t.rel.news.row, options.onNews) : null,
    options.onReport ? reportRow(options.onReport) : null,
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
        el('div', { className: 'pd-col' }, nameGroup, sound, game, learning),
        el('div', { className: 'pd-col' }, more, reset),
      ),
    ),
    options.onClose,
  );
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

/** AboutScene: the freesound.org samples in Shattered's sounds, and their authors, by licence. */
const FREESOUND_BY: ReadonlyArray<readonly [string, string]> = [
  ['SFX ATTACK SWORD 001.wav', 'JoelAudio'],
  ['Pack: Slingshots and Longbows', 'saturdaysoundguy'],
  ['Cracking/Crunching, A.wav', 'InspectorJ'],
  ['Extracting a sword.mp3', 'Taira Komori'],
  ['Pack: Uni Sound Library', 'timmy h123'],
];
const FREESOUND_ZERO: ReadonlyArray<readonly [string, string]> = [
  ['Pack: Movie Foley: Swords', 'Black Snow'],
  ['machine gun shot 2.flac', 'qubodup'],
  ['m240h machine gun burst 4.flac', 'qubodup'],
  ['Pack: Onomatopoeia', 'Adam N'],
  ['Pack: Watermelon', 'lolamadeus'],
  ['metal chain', 'Mediapaja2009'],
  ['Pack: Sword Clashes Pack', 'JohnBuhr'],
  ['Pack: Metal Clangs and Pings', 'wilhellboy'],
  ['Pack: Stabbing Stomachs & Crushing Skulls', 'TheFilmLook'],
  ['Sheep bleating', 'zachrau'],
  ['Lemon,Juicy,Squeeze,Fruit.wav', 'Filipe Chagas'],
  ['Lemon,Squeeze,Squishy,Fruit.wav', 'Filipe Chagas'],
];

function freesoundCredits(): HTMLElement {
  const list = (title: string, samples: ReadonlyArray<readonly [string, string]>): HTMLElement =>
    el('p', { className: 'pd-legal' }, title, ...samples.flatMap(([work, author]) => [el('br'), `${work} — ${author}`]));
  return el('div', {}, el('p', { className: 'pd-legal', textContent: t.meta.freesound }), list(t.meta.ccBy, FREESOUND_BY), list(t.meta.ccZero, FREESOUND_ZERO));
}

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
        freesoundCredits(),
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

export interface ChallengesOptions {
  mask: number;
  /** Challenges open after the first victory (the original's VICTORY badge). */
  unlocked: boolean;
  onChange(mask: number): void;
  onClose(): void;
}

/** The challenges with a «?» beside them: Shattered's two new ones, whose rules are too long for the row. */
const LONG_CHALLENGES: readonly number[] = [128, 256];
/** The bosses of «Badder bosses», in the order of its text, and the bestiary entry whose portrait stands by each. */
const BADDER_BOSSES: readonly MobKind[] = ['goo', 'tengu', 'dm300', 'king', 'yog'];

/** The picture of a challenge, from the nine-icon sheet (`big`: twice the size). */
const challengeSprite = (mask: number, big = true): HTMLElement => {
  const icon = el('i', { className: big ? 'pd-ch9 big' : 'pd-ch9' });
  icon.style.setProperty('--c', String(challengeIcon(mask)));
  return icon;
};

/**
 * «?» on a long challenge: its rules in a window of their own. «Badder bosses» is told boss by boss: the text of Challenges.STRONGER_BOSSES
 * as the core fights it (core/src/bosses: health, the arena's traps, the cooldowns), a portrait from the bestiary and what changes.
 */
function showChallengeInfo(index: number, back: () => void): void {
  const [name, desc, rules] = t.meta.challengeList[index]!;
  const mask = CHALLENGE_MASKS[index]!;
  if (mask !== 256) {
    show(windowOf({ title: name, icon: challengeSprite(mask), onClose: back, narrow: true }, info(desc), info(rules, 'pd-info pd-rules')), back);
    return;
  }
  // "Goo: +20% health" and then its "- ..." lines; the last boss has no health line.
  const blocks: Array<{ head: string; lines: string[] }> = [];
  for (const line of rules.split(String.fromCharCode(10)).map((l) => l.trim()).filter(Boolean)) {
    if (line.startsWith('- ')) blocks[blocks.length - 1]?.lines.push(line.slice(2).replace(/\.$/, ''));
    else blocks.push({ head: line, lines: [] });
  }
  const list = el('ul', { className: 'pd-boss-list' });
  blocks.forEach((block, i) => {
    const colon = block.head.indexOf(':');
    const bossName = colon < 0 ? block.head : block.head.slice(0, colon);
    const health = colon < 0 ? '' : block.head.slice(colon + 1).trim();
    const entry = BESTIARY_ENTRIES.find((e) => e.kind === BADDER_BOSSES[i]);
    list.append(el(
      'li',
      {},
      entry ? mobFace(entry, false, false) : el('i'),
      el('span', {}, el('b', { textContent: bossName }), el('small', { textContent: [health, ...block.lines.map((line) => `· ${line}`)].filter(Boolean).join(String.fromCharCode(10)) })),
    ));
  });
  show(windowOf({ title: name, icon: challengeSprite(mask), onClose: back, narrow: true }, info(desc), el('div', { className: 'pd-scroll' }, list)), back);
}

/** WndChallenges: nine switches, locked until the first victory. The two new ones carry a «new» tag and a «?». */
export function showChallenges(options: ChallengesOptions): void {
  let mask = options.unlocked ? options.mask : 0;
  // How many are on, and what they do to the score: the same function the score uses (core daily.ts challengeMultiplier, 1.25^n).
  const onText = (m: number): string =>
    countChallenges(m) > 0 ? `${t.meta.challengesOn(countChallenges(m))} · ${t.ranked.scoreTimes(challengeMultiplier(m).toLocaleString(locale))}` : t.meta.challengesOn(0);
  const sub = el('span', { className: 'pd-note', textContent: onText(mask) });
  const list = el('div', { className: `pd-challenges${options.unlocked ? '' : ' locked'}` });
  if (!options.unlocked) list.append(el('p', { className: 'pd-lockplate' }, el('span', { textContent: t.meta.challengesLocked })));
  t.meta.challengeList.forEach(([name, desc, rules], i) => {
    const bit = CHALLENGE_MASKS[i]!;
    const long = LONG_CHALLENGES.includes(bit);
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
      challengeSprite(bit),
      el(
        'span',
        { className: 'pd-ch-text' },
        el('span', { className: 'pd-ch-name', textContent: name }, long ? el('em', { className: 'pd-new-tag', textContent: t.forum.challengeNew }) : null),
        el('span', { className: 'pd-ch-desc', textContent: desc }),
        long ? null : el('span', { className: 'pd-ch-rules', textContent: rules }),
      ),
      el('span', { className: 'pd-switch-box' }),
    );
    row.setAttribute('role', 'switch');
    row.setAttribute('aria-checked', String(Boolean(mask & bit)));
    if (!options.unlocked) row.setAttribute('aria-disabled', 'true');
    if (!long) {
      list.append(el('div', { className: 'pd-challenge9' }, row));
      return;
    }
    const more = el('button', { className: 'pd-ch-info', textContent: '?', onclick: () => {
      click();
      showChallengeInfo(i, () => showChallenges({ ...options, mask }));
    } });
    more.setAttribute('aria-label', t.forum.challengeMore(name));
    list.append(el('div', { className: 'pd-challenge9 info' }, row, more));
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
  chasmFloor: null, waterFloor: null, grassFloor: null, darkFloor: null, largeFloor: null, trapsFloor: null, secretsFloor: null, demonSpawner: null, distantWell: null, lostPack: null,
  shop: { item: S.GOLD }, alchemy: { feature: Feature.Alchemy }, garden: { feature: Feature.Garden },
  wellOfHealth: { feature: Feature.WellOfHealth }, wellOfAwareness: { feature: Feature.WellOfAwareness },
  wellOfTransmutation: { feature: Feature.WellOfTransmutation }, sacrificialFire: { feature: Feature.Sacrifice },
  statue: { feature: Feature.Statue }, beaconLocation: { item: S.BEACON }, ghost: { feature: Feature.Ghost }, ratKing: { item: S.CROWN },
  wandmaker: { feature: Feature.Wandmaker }, troll: { feature: Feature.Troll }, imp: { feature: Feature.Imp },
};

/**
 * journal2.png (design v19), by a note's key: marks the journal.png lacks. The imp's shop is the shop on the twentieth
 * depth (Notes.LandmarkRecord.icon). The lost backpack, a distant well, the demon lair and the dark, large, trap and
 * secret floors have their marks here ahead of the notes that will name them (the levels stream): a note with one of
 * these keys picks its mark up by itself.
 */
const MARK2: Readonly<Record<string, number>> = {
  shop: 0, impShop: 1, ratKing: 2, demonSpawner: 3, lostPack: 4, beaconLocation: 5, distantWell: 6,
  chasmFloor: 7, waterFloor: 8, grassFloor: 9, darkFloor: 10, largeFloor: 11, trapsFloor: 12, secretsFloor: 13,
};

/** Names for notes whose keys the core does not make yet (journal2.json's): a note with one of them reads right at once. */
const MARK2_NAMES: Readonly<Record<string, { ru: string; en: string }>> = {
  lostPack: { ru: 'потерянный рюкзак', en: 'lost backpack' }, distantWell: { ru: 'дальний колодец', en: 'distant well' },
  demonSpawner: { ru: 'логово демонов', en: 'demon spawner' }, darkFloor: { ru: 'этаж: тьма', en: 'floor: dark' },
  largeFloor: { ru: 'этаж: большой', en: 'floor: large' }, trapsFloor: { ru: 'этаж: ловушки', en: 'floor: traps' },
  secretsFloor: { ru: 'этаж: тайники', en: 'floor: secrets' },
};

function noteIcon(landmark: string, depth: number): HTMLElement {
  const mark = MARK2[landmark === 'shop' && depth === 20 ? 'impShop' : landmark];
  if (mark !== undefined) {
    const node = el('i', { className: 'pd-jicon2' });
    node.dataset.j2 = String(mark);
    return node;
  }
  const icon = LANDMARK_ICONS[landmark as Landmark];
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
export function showJournal(options: JournalOptions, tab: 'notes' | 'catalog' | 'guide' = 'notes', category = 0, entry?: string): void {
  const { world, hero } = options;
  const reopen = (nextTab: 'notes' | 'catalog' | 'guide', nextCategory = category): void => showJournal(options, nextTab, nextCategory);
  // A guide entry has a page of its own, with the way back to the list in this tab.
  if (tab === 'guide' && entry) {
    showGuideEntry(entry, () => reopen('guide'), options.onClose);
    return;
  }
  const tabs = el('div', { className: 'pd-tabs' });
  tabs.setAttribute('role', 'tablist');
  for (const [id, label] of [['notes', t.meta.notes], ['catalog', t.meta.catalog], ['guide', t.forum.guide.tab]] as const) {
    const node = el('button', { className: 'pd-tab', textContent: label, onclick: () => (click(), reopen(id)) });
    node.setAttribute('role', 'tab');
    node.setAttribute('aria-selected', String(id === tab));
    tabs.append(node);
  }
  const bestiary = tab === 'catalog' && category === CATALOG.length;
  const parts = tab === 'notes'
    ? [el('div', { className: 'pd-scroll' }, notesView(world, hero))]
    : tab === 'guide'
      ? guideList((id) => showJournal(options, 'guide', category, id))
      : catalogView(options, category, (next) => reopen('catalog', next));
  show(
    windowOf({ title: t.meta.journal, onClose: options.onClose, className: bestiary ? 'wide pd-best-window' : tab === 'guide' ? 'wide pd-guide-window' : 'wide' }, tabs, ...parts),
    options.onClose,
  );
}

/** The guide alone, as the camp opens it (the journal's «Памятка» tab, without the world a run has). */
export function showGuide(onClose: () => void, entry?: string): void {
  if (entry) {
    showGuideEntry(entry, () => showGuide(onClose), onClose);
    return;
  }
  show(windowOf({ title: t.forum.guide.tab, onClose, className: 'wide pd-guide-window' }, ...guideList((id) => showGuide(onClose, id))), onClose);
}

/** What the player has read of the guide, kept on this device (a gold dot marks the rest). */
const GUIDE_READ_KEY = 'pd-guide-read';
function guideRead(): Set<string> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(GUIDE_READ_KEY) ?? '[]');
    return new Set(Array.isArray(raw) ? raw.filter((id): id is string => typeof id === 'string') : []);
  } catch {
    return new Set();
  }
}
function markGuideRead(id: string): void {
  try {
    const read = guideRead();
    if (read.has(id)) return;
    read.add(id);
    localStorage.setItem(GUIDE_READ_KEY, JSON.stringify([...read]));
  } catch { /* private mode: the dots just stay */ }
}

/** The guide's entries: the questions asked most, and the trap colours last. */
function guideItems(): ReadonlyArray<{ id: string; title: string; text: string }> {
  const F = t.forum;
  return [...F.guide.entries, { id: 'traps', title: F.trapColourTitle, text: F.trapColourText }];
}

/** An entry's picture: an item of items.png, the bestiary's mimic, the well, a challenge's icon or a trap's colour. */
const GUIDE_ICONS: Readonly<Record<string, number>> = {
  hunger: S.RATION, hungerEnd: S.PASTY, ankh: S.ANKH, curses: S.CURSE_INFUSE, uncurse: S.SCROLL_HOLDER, wealth: S.GOLD,
  purity: S.DEWDROP, seeds: S.SEED_ROTBERRY, score: S.AMULET, drained: S.RAT_SKULL,
};
function guideIcon(id: string, big: boolean): HTMLElement {
  const item = GUIDE_ICONS[id];
  if (item !== undefined) {
    const node = el('i', { className: 'pd-item' });
    node.dataset.i = String(item);
    node.style.setProperty('--u', big ? '3px' : '2px');
    return node;
  }
  if (id === 'mimics') {
    const entry = BESTIARY_ENTRIES.find((e) => e.kind === 'mimic');
    if (entry) return mobFace(entry, false, false);
  }
  if (id === 'well') {
    const node = el('i', { className: 'pd-guide-img' });
    node.style.backgroundImage = 'var(--spr-guide-well)';
    return node;
  }
  if (id === 'challenges') {
    const node = el('i', { className: 'pd-ch9' });
    node.style.setProperty('--c', '8');
    return node;
  }
  const node = el('i', { className: 'pd-trapc' });
  node.style.setProperty('--c', '1');
  return node;
}

/** A text in sentences: a full stop, a space and a capital, a bracket or a quote begin the next. */
function sentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+(?=[A-ZА-ЯЁ«“(])/u).map((part) => part.trim()).filter(Boolean);
}

/** The list: a count line, then a row for each entry (icon, title with a gold dot while unread, a line, a chevron). */
function guideList(open: (id: string) => void): HTMLElement[] {
  const items = guideItems();
  const read = guideRead();
  const count = el('p', { className: 'pd-cat-count', textContent: t.forum.guide.count(items.length, items.filter((item) => read.has(item.id)).length) });
  const list = el('ul', { className: 'pd-guide-list' });
  for (const item of items) {
    const chev = el('i', { className: 'pd-chev' });
    chev.setAttribute('aria-hidden', 'true');
    const row = el(
      'button',
      { className: `pd-guide-row${read.has(item.id) ? ' read' : ''}`, onclick: () => (click(), open(item.id)) },
      el('span', { className: 'pd-guide-ico' }, guideIcon(item.id, false)),
      el('span', { className: 'pd-spell-text' }, el('b', { textContent: item.title }), el('small', { textContent: sentences(item.text)[0] ?? '' })),
      chev,
    );
    list.append(el('li', {}, row));
  }
  return [count, el('div', { className: 'pd-scroll' }, list)];
}

/** An entry's page: «‹ Памятка» and the cross, the big picture and the title, then the text, points and notes (opened = read). */
function showGuideEntry(id: string, back: () => void, onClose: () => void): void {
  const F = t.forum;
  const item = guideItems().find((entry) => entry.id === id);
  if (!item) return back();
  markGuideRead(id);
  const body = el('div', { className: 'pd-scroll pd-guide-page' });
  if (id === 'traps') {
    body.append(info(F.trapColourText));
    const legend = el('ul', { className: 'pd-trap-legend' });
    // Trap.RED ... Trap.BLACK, as the sheet shows them; the spent black one last.
    F.trapColours.forEach(([name, what], i) => {
      const swatch = el('i', { className: 'pd-trapc' });
      swatch.style.setProperty('--c', String(i));
      legend.append(el('li', { className: i === 8 ? 'spent' : '' }, swatch, el('span', {}, el('b', { textContent: capitalize(name) }), el('small', { textContent: capitalize(what) }))));
    });
    body.append(legend, info(F.trapColourNote, 'pd-note'));
  } else if (id === 'purity') {
    body.append(info(F.guide.purityLead));
    body.append(el('div', { className: 'pd-compare' }, ...F.guide.purity.map(([name, kind, points]) => el(
      'div',
      {},
      el('header', {}, el('span', {}, el('b', { textContent: name }), el('small', { textContent: kind }))),
      el('ul', {}, ...points.map((point) => el('li', { textContent: point }))),
    ))));
  } else {
    const [lead, ...rest] = sentences(item.text);
    body.append(info(lead ?? item.text));
    if (rest.length > 1) body.append(el('ul', { className: 'pd-guide-points' }, ...rest.map((point) => el('li', { textContent: point }))));
    else if (rest.length === 1) body.append(info(rest[0]!));
  }
  const head = el('header', { className: 'pd-window-head' }, el('button', { className: 'pd-back', textContent: F.guide.tab, onclick: () => (click(), back()) }));
  head.append(closeButton(onClose));
  const box = el(
    'section',
    { className: 'pd-window wide pd-guide-window' },
    head,
    el('div', { className: 'pd-guide-title' }, el('span', { className: 'pd-guide-ico big' }, guideIcon(id, true)), el('h2', { className: 'pd-heading', textContent: item.title })),
    body,
  );
  box.setAttribute('role', 'dialog');
  show(box, onClose);
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
        noteIcon(note.landmark, depth),
        el('span', { className: 'pd-jname', textContent: capitalize((t.hero.landmarks as Record<string, string>)[note.landmark] ?? MARK2_NAMES[note.landmark]?.[lang] ?? note.landmark) }),
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

/**
 * The catalog's own tabs, as shelves (design v21): an icon each, the word only on the chosen one. Then what the tab
 * shows: for the bestiary a count, the list in a scroll and the chosen monster below it; for the rest one scroll.
 */
function catalogView(options: JournalOptions, category: number, choose: (category: number) => void): HTMLElement[] {
  const { world, hero } = options;
  const tabs = el('div', { className: 'pd-tabs compact shelf' });
  tabs.setAttribute('role', 'tablist');
  t.meta.categories.forEach((label, i) => {
    const icon = i < CATALOG.length ? itemIcon(CATALOG[i]!.silhouette, false) : el('i', { className: 'pd-tab-ico bestiary' });
    if (i < CATALOG.length) icon.classList.add('pd-tab-item');
    const node = el('button', { className: 'pd-tab', onclick: () => (click(), choose(i)) }, icon, el('span', { textContent: label }));
    node.ariaLabel = label;
    node.title = label;
    node.setAttribute('role', 'tab');
    node.setAttribute('aria-selected', String(i === category));
    tabs.append(node);
  });
  sprites(tabs);
  if (category === CATALOG.length) return [tabs, ...bestiaryView(options)];
  const { category: kind, silhouette } = CATALOG[category]!;
  const kinds = (Object.keys(ITEMS) as ItemKind[]).filter((k) => itemDef(k).category === kind);
  const known = kinds.filter((k) => kindKnown(world, { kind: k, qty: 1, level: 0 }));
  const detail = el('div', { className: 'pd-cat-detail' });
  const grid = el('div', { className: 'pd-grid pd-catalog' });
  grid.setAttribute('role', 'listbox');
  const pick = (k: ItemKind, slot: HTMLElement): void => {
    grid.querySelectorAll('.selected').forEach((node) => node.classList.remove('selected'));
    slot.classList.add('selected');
    const isKnown = kindKnown(world, { kind: k, qty: 1, level: 0 });
    const item = { kind: k, qty: 1, level: 0 } as Item;
    detail.className = `pd-cat-detail${isKnown ? '' : ' unknown'}`;
    detail.replaceChildren(
      itemIcon(isKnown ? itemSprite(item, world.run.labels) : silhouette, !isKnown),
      el('span', {}, el('b', { textContent: t.items[k] }), el('small', { textContent: isKnown ? t.meta.identified : t.meta.notIdentified })),
    );
    sprites(detail);
  };
  for (const k of kinds) {
    const isKnown = kindKnown(world, { kind: k, qty: 1, level: 0 });
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
  return [tabs, el(
    'div',
    { className: 'pd-scroll' },
    el('div', { className: 'pd-cat-count', textContent: t.meta.known(known.length, kinds.length) }),
    grid,
    detail,
  )];
}

/** The design's portrait of a monster (24×24 cell of bestiary.png), or its own sprite where the sheet has none. */
function mobFace(entry: BestEntry, large: boolean, silhouette: boolean): HTMLElement {
  if (entry.n === null) {
    const face = portrait(entry.kind!);
    if (silhouette) face.classList.add('silhouette');
    return face;
  }
  const { mx, my } = portraitCell(entry.n);
  const face = el('i', { className: `pd-mob${large ? ' x3' : ''}${silhouette ? ' silhouette' : ''}` });
  face.style.setProperty('--mx', String(mx));
  face.style.setProperty('--my', String(my));
  return face;
}

type PlainGroup = 'boss' | 'any' | 'rare' | 'quest';

/**
 * WndJournal.CatalogTab's bestiary (design v21): every monster of Shattered's roster by region, the bosses, those found
 * everywhere, the rare ones and the quest's. Those the party has seen this run are shown, the rest as dark shapes;
 * a tap tells what the monster is and how many have been slain. The list scrolls; the chosen monster stays below it.
 */
function bestiaryView(options: JournalOptions): HTMLElement[] {
  const { world } = options;
  const book = world.bestiary ?? {};
  const seenIn = (entry: BestEntry): boolean => book[entry.kind!]?.seen === true;
  const slainOf = (entry: BestEntry): number => book[entry.kind!]?.slain ?? 0;
  const count = el('div', {
    className: 'pd-cat-count',
    textContent: t.meta.best.count(BESTIARY_ENTRIES.filter(seenIn).length, BESTIARY_ENTRIES.length, BESTIARY_ENTRIES.reduce((sum, entry) => sum + slainOf(entry), 0)),
  });
  const list = el('div', { className: 'pd-best' });
  const detail = el('div', { className: 'pd-best-detail unseen' });
  const regionOf = (group: BestGroup): number => (group.startsWith('region') ? Number(group.slice(6)) : -1);
  const where = (entry: BestEntry): string => {
    const region = regionOf(entry.group);
    if (region < 0) return capitalize(t.meta.best.groups[entry.group as PlainGroup]);
    const [from, to] = REGION_DEPTHS[region]!;
    return `${capitalize(t.regionNames[region]!)} · ${t.meta.best.depths(from, to)}`;
  };
  const choose = (entry: BestEntry, slot: HTMLElement | null): void => {
    list.querySelectorAll('.selected').forEach((node) => {
      node.classList.remove('selected');
      node.setAttribute('aria-selected', 'false');
    });
    slot?.classList.add('selected');
    slot?.setAttribute('aria-selected', 'true');
    const seen = seenIn(entry);
    const slain = slainOf(entry);
    detail.className = `pd-best-detail${seen ? '' : ' unseen'}`;
    detail.replaceChildren(
      el('span', { className: 'pd-best-face' }, mobFace(entry, true, !seen)),
      el(
        'span',
        { className: 'pd-best-text' },
        el('b', { textContent: seen ? capitalize(t.mobs[entry.kind!]) : entry.group === 'boss' ? '???' : t.meta.best.unseen }),
        el('small', { textContent: seen && slain > 0 ? `${where(entry)} · ${t.meta.best.slain(slain)}` : where(entry) }),
        el('span', { textContent: seen ? mobDescription({ kind: entry.kind! } as Mob)[0] ?? '' : t.meta.notSeenEnemy }),
      ),
    );
  };
  for (const group of BEST_GROUPS) {
    const entries = BESTIARY_ENTRIES.filter((entry) => entry.group === group);
    if (entries.length === 0) continue;
    const region = regionOf(group);
    const title = region >= 0 ? capitalize(t.regionNames[region]!) : capitalize(t.meta.best.groups[group as PlainGroup]);
    const grid = el('div', { className: 'pd-best-grid' });
    grid.setAttribute('role', 'listbox');
    grid.ariaLabel = title;
    for (const entry of entries) {
      const seen = seenIn(entry);
      const slain = slainOf(entry);
      const slot = el(
        'button',
        { className: `pd-best-cell${seen ? '' : ' unseen'}`, onclick: () => (click(), choose(entry, slot)) },
        mobFace(entry, false, !seen),
        seen && slain > 0 && el('span', { className: 'pd-best-n', textContent: slainLabel(slain) }),
      );
      slot.setAttribute('role', 'option');
      slot.setAttribute('aria-selected', 'false');
      slot.ariaLabel = seen ? `${capitalize(t.mobs[entry.kind!])}${slain > 0 ? `, ${t.meta.best.slain(slain)}` : ''}` : t.meta.best.unseen;
      grid.append(slot);
    }
    list.append(el(
      'section',
      { className: 'pd-best-group' },
      el(
        'header',
        { className: 'pd-best-head' },
        el('b', { textContent: title }),
        region >= 0 && el('span', { textContent: t.meta.best.depths(REGION_DEPTHS[region]![0], REGION_DEPTHS[region]![1]) }),
        el('em', { textContent: `${entries.filter(seenIn).length}/${entries.length}` }),
      ),
      grid,
    ));
  }
  choose(BESTIARY_ENTRIES[0]!, null);
  return [count, el('div', { className: 'pd-scroll' }, list), detail];
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
