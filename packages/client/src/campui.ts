import type { EffectId, HeroClass, SkinVariant } from '@pd/core';
import { audio } from './audio';
import { Camp, type CampScene, campClasses, CAMP_ORDER, seasonOf } from './camp';
import type { Profile } from './checked';
import { locale, t } from './i18n';
import { countChallenges } from './meta';
import { boardCloses, type CardFallback, countdown, profileCard } from './rankui';
import { button, el, show } from './screens';
import { rankIcon, trophyKind } from './trophyicons';

/*
 * «Привал» as a screen (design system v18, migration.md): the live scene (camp.ts) with the player's card,
 * the edge icons, and the sheet of the day's dungeon and the ways in, over it. It replaces the old title:
 * the class is chosen on the scene, not on a form; everything the title did is kept: the daily dungeon in its
 * states, the profile, the boards, the shop, the settings, the challenges.
 */

/** The order of a look in avatars-skins.png. */
const SKIN_STEPS: readonly string[] = ['ash', 'royal', 'shadow'];

/** The quests icon is drawn and wired, and kept out of sight until quests come in a later update. */
const QUESTS_ICON = false;

export interface DailyRulesView {
  /** The hardship's place in the challenges' sheet and its name. */
  hardship: { index: number; name: string; info: string };
  /** The boon's item in items.png, its name and what it gives. */
  boon: { sprite: number; name: string; info: string };
}

export interface CampScreenOptions {
  /** The class on the scene: the saved run's, or the one picked for a new game. */
  heroClass: string;
  /** The solo run that can be continued, if any. */
  save: { heroClass: HeroClass; lvl: number; depth: number } | null;
  name: string;
  /** The server's word on the player, once it has told. */
  profile: Profile | null;
  fallback: CardFallback;
  /** The camp worn, and the looks on it (Pixel-Mart). */
  scene: CampScene;
  skinOf: (heroClass: string) => SkinVariant | undefined;
  effect?: EffectId;
  frame?: string;
  /** The hero on the scene changed (a swipe or an arrow). */
  onClass(heroClass: string): void;
  onContinue(): void;
  onSolo(): void;
  onDaily(): void;
  /** Shows today's board; absent without checked runs. */
  onDailyBoard?: () => void;
  /** The daily dungeon today, as the server knows it; absent without checked runs. */
  dailyState?: { state: 'open' | 'going' | 'done'; place: number | null; total: number };
  onPractice?: () => void;
  rules?: DailyRulesView;
  /** The UTC day turned over while the camp stood: the rules shown are yesterday's. */
  onNewDay?: () => void;
  onRankings(): void;
  onMart(): void;
  onSettings(): void;
  /** The mail icon: absent without the server's mailbox; its count of letters not claimed. */
  mail?: { count: number; onOpen(): void };
  challenges: number;
  onChallenges(): void;
}

/** An icon at the camp's edge: its label for readers, and a count (or a dot) over it. */
function edgeIcon(kind: string, label: string, onClick: () => void, count?: number | 'dot'): HTMLButtonElement {
  const badge = count === undefined || count === 0 ? null : el('span', { className: `pd-count${count === 'dot' ? ' dot' : ''}`, textContent: count === 'dot' ? '' : String(count) });
  const node = el(
    'button',
    {
      className: `pd-camp-icon ${kind}`,
      ariaLabel: badge && count !== 'dot' ? `${label}, ${count}` : label,
      title: label,
      onclick: () => {
        audio.play('click');
        onClick();
      },
    },
    el('i'),
    badge,
  );
  node.type = 'button';
  return node;
}

/**
 * Under the day's rules: each in a line of words (what the hardship does, what the boon gives), then the countdown to the next
 * daily dungeon and when that is on the player's own clock (the day is UTC: core verify.ts dayOf).
 */
function dailyInfo(options: CampScreenOptions): HTMLElement {
  const node = el('p', { className: 'pd-daily-info' });
  const { rules } = options;
  if (rules) {
    node.append(
      el('span', { className: 'bad', textContent: t.ranked.dailyHardship(rules.hardship.name, rules.hardship.info) }),
      el('span', { className: 'boon', textContent: t.ranked.dailyBoon(rules.boon.name, rules.boon.info) }),
    );
  }
  const next = el('span', { className: 'timer' });
  const resets = el('span', { className: 'timer' });
  node.append(next, resets);
  const opened = Date.now();
  const closes = boardCloses('daily', opened);
  resets.textContent = t.ranked.dailyResets(new Date(closes).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }));
  let started = false;
  const tick = (): void => {
    const now = Date.now();
    if (now >= closes) {
      if (node.isConnected) options.onNewDay?.();
      return;
    }
    next.textContent = t.ranked.dailyNext(countdown(closes - now));
    if (!started || node.isConnected) {
      started = true;
      window.setTimeout(tick, Math.min(30_000, closes - now + 500));
    }
  };
  tick();
  return node;
}

/** The time to the day's close, short: «5 ч» (the last hour: minutes). */
function left(): string {
  const ms = Math.floor(Date.now() / 86_400_000 + 1) * 86_400_000 - Date.now();
  const hours = Math.floor(ms / 3_600_000);
  return hours >= 1 ? t.rel.camp.left(hours, true) : t.rel.camp.left(Math.max(1, Math.ceil(ms / 60_000)), false);
}

/** The compact block of the day's dungeon: its rules (hardship red, boon green, the attempts) and the way down. */
function dailyBlock(options: CampScreenOptions): HTMLElement {
  const day = options.dailyState;
  const done = day?.state === 'done';
  // Under the title (design v20, CampRules): the attempt and the time to the day's close (00:00 UTC), or, once played, the place.
  const chipText = done
    ? day.place !== null ? t.rel.camp.placeOf(day.place) : t.rel.camp.played
    : `${day?.state === 'going' ? t.ranked.dailyChipGoing : t.rel.camp.attempt} · ${left()}`;
  const chip = el('small', { className: 'pd-daily-left' });
  if (done && day.place !== null && day.place <= 3) chip.append(rankIcon(trophyKind('daily', day.place), { x1: true }));
  chip.append(chipText);
  if (options.onDailyBoard) {
    chip.setAttribute('role', 'button');
    chip.tabIndex = 0;
    chip.style.cursor = 'pointer';
    chip.title = t.camp.board;
    chip.setAttribute('aria-label', `${chipText}. ${t.camp.board}`);
    const open = (): void => {
      audio.play('click');
      options.onDailyBoard!();
    };
    chip.onclick = open;
    chip.onkeydown = (event) => {
      if (event.key === 'Enter' || event.key === ' ') open();
    };
  }
  const { rules } = options;
  const rulesNode = el('div', { className: 'pd-daily-rules' });
  if (rules) {
    const hardship = el('i', { className: 'pd-ch-mini' });
    hardship.style.setProperty('--c', String(rules.hardship.index));
    const boon = el('i', { className: 'pd-item' });
    boon.dataset.i = String(rules.boon.sprite);
    rulesNode.ariaLabel = `${t.camp.today} ${rules.hardship.name}, ${rules.boon.name} — ${rules.boon.info}`;
    rulesNode.append(
      el('span', { className: 'bad' }, hardship, rules.hardship.name),
      el('span', { className: 'boon', title: rules.boon.info }, boon, rules.boon.name),
    );
  }
  return el(
    'div',
    { className: `pd-daily compact${done ? ' done' : ''}` },
    el('div', { className: 'pd-daily-title' }, el('h3', { textContent: t.daily }), chip),
    rulesNode,
    dailyInfo(options),
    done && options.onPractice ? button(t.ranked.practice2, options.onPractice) : button(t.descendDaily, options.onDaily),
  );
}

/** What the camp shows and the game drives. */
export interface CampScreen {
  camp: Camp;
}

/** Puts the camp on screen. The scene draws when `camp.frame(now)` is called (main.ts's frame loop). */
export function showCamp(options: CampScreenOptions): CampScreen {
  const root = el('main', { className: 'pd-camp' });
  root.id = 'camp';
  const classes = campClasses();
  const first = Math.max(0, classes.indexOf(options.heroClass));
  const avatar = (name: string): number => Math.max(0, CAMP_ORDER.indexOf(name));

  /** The portrait: the class's avatar, or (the Duelist and the Cleric in a Pixel-Mart look) the look's own. */
  const portrait = (name: string): { avatar: number; skinAvatar?: boolean } => {
    const index = avatar(name);
    const skin = options.skinOf(name);
    const step = skin ? SKIN_STEPS.indexOf(skin) : -1;
    return index >= 4 && step >= 0 ? { avatar: (index - 4) * 3 + step, skinAvatar: true } : { avatar: index };
  };

  const card = (): HTMLElement =>
    profileCard({
      name: options.name, ...portrait(camp.heroClass), ...(options.frame ? { frame: options.frame } : {}), profile: options.profile, fallback: options.fallback, onOpen: options.onRankings,
    });
  const top = el('div', { className: 'pd-camp-top' });

  const edges = el(
    'div',
    { className: 'pd-camp-edges' },
    el(
      'nav',
      { className: 'pd-camp-edge left' },
      ...(QUESTS_ICON ? [edgeIcon('quests', t.camp.questsNew, () => undefined, 'dot')] : []),
      ...(options.mail ? [edgeIcon('mail', t.camp.mail, options.mail.onOpen, options.mail.count)] : []),
    ),
    el(
      'nav',
      { className: 'pd-camp-edge right' },
      edgeIcon('ranks', t.camp.ranks, options.onRankings),
      edgeIcon('mart', t.camp.mart, options.onMart),
      edgeIcon('prefs', t.camp.prefs, options.onSettings),
    ),
  );

  // The way in: «Continue» goes on with the saved run (its hero on the button); «New game» starts with the class on the scene.
  const { save } = options;
  const on = countChallenges(options.challenges);
  const challenges = button(t.meta.challenges, options.onChallenges, 'pd-ch-btn');
  const cup = el('i', { className: 'pd-icon' });
  cup.style.cssText = `width:24px;height:24px;background-image:var(--spr-challenge-${on ? 'on' : 'off'})`;
  challenges.prepend(cup);
  if (on) challenges.append(el('b', { className: 'pd-ch-n', textContent: String(on) }));
  const actions = el('div', { className: 'pd-actions' });
  if (save) {
    // The saved run's hero on the button (design v20, CampFace): a 44 px portrait, «Warrior · lv 7 · depth 9» left-aligned.
    // It is the run's hero (and look), whatever class the scene shows for a new game.
    const resume = button('', options.onContinue, 'primary big stacked with-face');
    const heroFace = portrait(save.heroClass);
    const faceHead = el('i', { className: heroFace.skinAvatar ? 'skin' : '' });
    faceHead.style.setProperty('--av', String(heroFace.avatar));
    const face = el('span', { className: 'pd-camp-face' }, faceHead);
    face.setAttribute('aria-hidden', 'true');
    resume.append(
      face,
      el('span', { className: 'pd-btn-label', textContent: t.continueRun }),
      el('span', { className: 'pd-btn-sub', textContent: t.continueMeta(t.camp.cls[avatar(save.heroClass)] ?? t.classes[save.heroClass], save.lvl, save.depth) }),
    );
    actions.append(resume, el('div', { className: 'pd-row' }, button(t.newRun, options.onSolo), challenges));
  } else {
    const fresh = button(t.solo, options.onSolo, 'primary big stacked');
    const sub = el('span', { className: 'pd-btn-sub', textContent: t.camp.cls[first] ?? '' });
    fresh.append(sub);
    actions.append(fresh, challenges);
    // The label under «New game» follows the hero on the scene.
    root.addEventListener('pd-camp-hero', () => {
      sub.textContent = t.camp.cls[avatar(camp.heroClass)] ?? '';
    });
  }
  const sheet = el('div', { className: 'pd-camp-sheet' }, dailyBlock(options), actions);
  const ui = el('div', { className: 'pd-camp-ui' }, top, edges, sheet);

  const camp = new Camp(root, {
    scene: options.scene, season: seasonOf(new Date()), hero: first, skinOf: options.skinOf, effect: options.effect ?? null, fill: true,
    onHero: (name) => {
      options.onClass(name);
      top.replaceChildren(card());
      root.dispatchEvent(new Event('pd-camp-hero'));
    },
  });
  top.append(card());
  root.append(ui);
  show(root, null, true);
  audio.ambience('camp');

  // The hero's feet stand 16 px above the sheet: a low screen lifts the scene, a tall one lowers it (its extended sky fills the top).
  const fit = (): void => {
    const lift = sheet.getBoundingClientRect().top - root.getBoundingClientRect().top;
    camp.shift(Math.min(camp.ext, Math.round(lift - 16 - 129 * 4)));
  };
  const refit = (): void => {
    camp.resize();
    fit();
  };
  refit();
  if (typeof ResizeObserver === 'function') new ResizeObserver(refit).observe(root);
  return { camp };
}
