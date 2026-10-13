import {
  type Action, BACKPACK_SIZE, scrollTargets, isBroken, isIdentified, type Hero, inBag, type HeroClass, type Item, itemDef, itemPrice, type ItemRef,
  itemSprite, levelKnown, maxExp, type MobKind, S, SUBCLASSES, visiblyCursed, type World, CLASS_ARMOR_OF, heroById, offersSealTransfer, shielding,
} from '@pd/core';
import { audio } from './audio';
import { chooseQuickslot, isQuickslotted, QUICKSLOTS, quickKind, quickUse } from './quickslot';
import { ARENA_BADGES, BADGES, type BadgeId, badgeText, earnedBadges, markBadgesSeen, unseenBadges } from './badges';
import { BUFF_ICONS, type BuffName } from './hud';
import { capitalize, locale, t } from './i18n';
import { chargesOf, isKnown, itemInfo, itemName, plainName, strengthOf, wearOf } from './itemtext';
import { mart } from './mart';
import { rankIcon, trophyKind } from './trophyicons';
import { countChallenges } from './meta';
import type { RunRecord } from './rankings';
import { type Assets, heroSprite } from './sprites';
import type { LogLine } from './view';

/*
 * DOM windows over the game, in the design system's markup (docs/design/system):
 * a window has a head with a title and a cross, then text, then its actions,
 * the main one red and first, the dangerous ones last behind a line.
 */

const root = document.getElementById('overlay')!;
const HERO_CLASSES: readonly HeroClass[] = ['warrior', 'mage', 'rogue', 'huntress'];
/** Heroes in avatars.png and in the heroes strip, in this order. */
export const AVATAR: Readonly<Record<HeroClass, number>> = { warrior: 0, mage: 1, rogue: 2, huntress: 3 };

let assets: Assets | null = null;

/** The sprite sheets portraits are cut from. */
export function setAssets(loaded: Assets): void {
  assets = loaded;
}

export type Child = Node | string | null | undefined | false;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, props: Partial<HTMLElementTagNameMap[K]> & { className?: string } = {}, ...children: Child[]
): HTMLElementTagNameMap[K] {
  const element = Object.assign(document.createElement(tag), props);
  for (const child of children) {
    if (child) element.append(child);
  }
  return element;
}

/** A button of the design system: '' secondary, 'primary' (one per window), 'danger', 'quiet', 'ally'. */
export function button(label: string, onClick: () => void, className = ''): HTMLButtonElement {
  const click = (): void => {
    audio.play('click');
    onClick();
  };
  return el('button', { className: `pd-button ${className}`.trim(), textContent: label, onclick: click });
}

/**
 * Lays out a window's actions as the design asks: the main one first, the
 * others two to a row, the dangerous ones last behind a line.
 */
function actions(primary: readonly HTMLElement[], secondary: readonly HTMLElement[], danger: readonly HTMLElement[] = []): HTMLElement {
  const box = el('div', { className: 'pd-actions' }, ...primary);
  // A label too long for half a row (Russian ones often are) takes a whole row.
  const short = (node: HTMLElement): boolean => (node.textContent ?? '').length <= 11;
  for (let i = 0; i < secondary.length; i++) {
    const node = secondary[i]!;
    const next = secondary[i + 1];
    if (next && short(node) && short(next)) {
      box.append(el('div', { className: 'pd-row' }, node, next));
      i++;
    } else {
      box.append(node);
    }
  }
  if (danger.length > 0) box.append(el('div', { className: 'pd-danger-zone' }, ...danger));
  return box;
}

/** What closes the window open now, by its cross, a tap beside it or Telegram's back button. */
let closer: (() => void) | null = null;

root.addEventListener('pointerdown', (event) => {
  if (event.target === root && closer) {
    audio.play('click');
    closer();
  }
});

export function show(content: HTMLElement, onClose: (() => void) | null, bare = false): void {
  closer = onClose;
  root.replaceChildren(content);
  root.classList.add('open');
  root.classList.toggle('bare', bare);
  sprites(content);
}

export function hideOverlay(): void {
  closer = null;
  root.classList.remove('open', 'bare');
  root.replaceChildren();
}

export function overlayOpen(): boolean {
  return root.classList.contains('open');
}

/** A window over the map (not the title's bare screen): the map beneath needs fewer frames. */
export function windowOverMap(): boolean {
  return root.classList.contains('open') && !root.classList.contains('bare');
}

/** Closes the open window the way its cross would; false if it has none. */
export function closeOverlay(): boolean {
  if (!overlayOpen()) return false;
  if (closer) closer();
  else return false;
  return true;
}

/** Sets --ix/--iy (items.png: 16 a row, Shattered's; badges.png: 8 a row) and --bx/--by (buffs.png: 18 a row) from data-i and data-b. */
export function sprites(scope: ParentNode): void {
  scope.querySelectorAll<HTMLElement>('[data-i]').forEach((node) => {
    let i = Number(node.dataset.i);
    // The arena's badges have a sheet of their own, in one row (badges.ts ARENA_BADGES).
    const arena = node.classList.contains('pd-badge') && i >= ARENA_BADGES;
    node.classList.toggle('arena', arena);
    if (arena) i -= ARENA_BADGES;
    const perRow = node.classList.contains('pd-item') ? 16 : 8;
    node.style.setProperty('--ix', String(i % perRow));
    node.style.setProperty('--iy', String(Math.floor(i / perRow)));
  });
  scope.querySelectorAll<HTMLElement>('[data-b]').forEach((node) => {
    // From 1000: Shattered's buffs.png, the same 18 a row but more rows (see BUFF_ICONS).
    const spd = Number(node.dataset.b) >= 1000;
    const b = Number(node.dataset.b) % 1000;
    node.classList.toggle('spd', spd);
    node.style.setProperty('--bx', String(b % 18));
    node.style.setProperty('--by', String(Math.floor(b / 18)));
  });
}

function closeButton(onClose: () => void): HTMLButtonElement {
  return el('button', {
    className: 'pd-close',
    ariaLabel: t.close,
    onclick: () => {
      audio.play('click');
      onClose();
    },
  });
}

interface WindowOptions {
  title?: string;
  /** A line under the title. */
  sub?: string;
  /** An item slot or a portrait before the title. */
  icon?: HTMLElement | null;
  /** The cross; a window without one wants an answer. */
  onClose?: () => void;
  narrow?: boolean;
  className?: string;
}

/** A window: the head (icon, title, cross), then the body. */
export function windowOf(options: WindowOptions, ...body: Child[]): HTMLElement {
  const head =
    (options.title || options.icon || options.onClose) &&
    el(
      'header',
      { className: 'pd-window-head' },
      options.icon,
      el(
        'div',
        { className: 'pd-titles' },
        options.title && el('h2', { className: 'pd-heading', textContent: options.title }),
        options.sub && el('span', { className: 'pd-note', textContent: options.sub }),
      ),
    );
  const box = el(
    'section',
    { className: `pd-window${options.narrow ? ' narrow' : ''}${options.className ? ` ${options.className}` : ''}` },
    head,
    ...body,
  );
  box.setAttribute('role', options.onClose ? 'dialog' : 'alertdialog');
  if (options.onClose) box.append(closeButton(options.onClose));
  return box;
}

export const info = (text: string, className = 'pd-info'): HTMLElement => el('p', { className, textContent: text });

/* Portraits */

/**
 * The first frame of a character's sprite, up to three times its size, on a
 * small canvas; for a hero, `row` is the armour's tier, as on the map.
 */
export function portrait(kind: MobKind | HeroClass, row = 0, skin?: string): HTMLElement {
  const box = el('div', { className: 'pd-portrait' });
  const sprite = assets && (kind in assets.heroes ? heroSprite(assets, kind as HeroClass, skin) : assets.mobs[kind as MobKind]);
  if (!sprite) return box;
  const { sheet } = sprite;
  const frame = sprite.anims.idle.frames[0] ?? 0;
  const canvas = el('canvas', { width: sheet.w, height: sheet.h });
  const scale = Math.max(1, Math.min(3, Math.floor(52 / Math.max(sheet.w, sheet.h))));
  canvas.style.width = `${sheet.w * scale}px`;
  canvas.style.height = `${sheet.h * scale}px`;
  const ctx = canvas.getContext('2d')!;
  const sy = (Math.floor(frame / sheet.cols) + row) * sheet.h;
  ctx.drawImage(sheet.image, (frame % sheet.cols) * sheet.w, sy, sheet.w, sheet.h, 0, 0, sheet.w, sheet.h);
  box.append(canvas);
  return box;
}

/** A health bar of the design system; `v` from 0 to 1. */
export function healthBar(hp: number, ht: number, text = true): HTMLElement {
  const bar = el('div', { className: `pd-bar${hp <= ht / 4 ? ' low' : ''}` }, text && el('span', { className: 'pd-bar-text', textContent: `${Math.max(0, hp)}/${ht}` }));
  bar.style.setProperty('--v', String(Math.max(0, Math.min(1, hp / ht))));
  return bar;
}

/* Item slots */

function itemIcon(world: World, item: Item): HTMLElement {
  const icon = el('i', { className: 'pd-item' });
  icon.dataset.i = String(itemSprite(item, world.run.labels));
  return icon;
}

/** A sprite of the design system's own (--spr-*), at a size in CSS pixels. */
function picture(sprite: string, width?: number, height?: number): HTMLElement {
  const node = el('i', { className: 'pd-icon' });
  node.style.backgroundImage = `var(--spr-${sprite})`;
  if (width) node.style.width = `${width}px`;
  if (height) node.style.height = `${height}px`;
  return node;
}

/** An item's description, its curse set apart as a warning. */
function described(lines: readonly string[]): HTMLElement[] {
  return lines.filter(Boolean).map((line) =>
    line === t.cursedInfo ? el('p', { className: 'pd-callout cursed', textContent: line })
    : line === t.tooHeavy ? el('p', { className: 'pd-callout bad', textContent: line })
    : info(line));
}

interface SlotOptions {
  onClick?: () => void;
  /** Worn: the equipment row. */
  equipped?: boolean;
  hero?: Hero;
  /** An empty equipment place: the silhouette of what goes there (Shattered's holders in items.png). */
  placeholder?: number;
}

/** A 52×52 slot: the sprite and up to three corner labels (level, strength, quantity). */
export function slot(world: World, item: Item | undefined, options: SlotOptions = {}): HTMLElement {
  if (!item) {
    if (options.placeholder !== undefined) {
      const icon = el('i', { className: 'pd-item' });
      icon.dataset.i = String(options.placeholder);
      return el('div', { className: 'pd-slot placeholder' }, icon);
    }
    return el('div', { className: 'pd-slot empty' });
  }
  // ItemSlot: the curse and the level only once they are known (Item.visiblyCursed, visiblyUpgraded).
  const cursed = visiblyCursed(item);
  const node = el('button', {
    className: `pd-slot${options.equipped ? ' equipped' : ''}${cursed ? ' cursed' : ''}`,
    ariaLabel: capitalize(itemName(world, item)),
  });
  node.append(itemIcon(world, item));
  const charges = chargesOf(item);
  if (charges !== null) {
    node.append(el('span', { className: 'pd-qty', textContent: charges }));
  } else if (item.qty > 1) {
    node.append(el('span', { className: 'pd-qty', textContent: String(item.qty) }));
  }
  if (item.level !== 0 && levelKnown(item)) {
    node.append(el('span', { className: `pd-lvl ${item.level > 0 ? 'up' : 'down'}`, textContent: `${item.level > 0 ? '+' : '−'}${Math.abs(item.level)}` }));
  }
  // WndBag's durability bars: how worn an upgraded item is; a broken one's level is struck through (it works as +0).
  const wear = wearOf(world, item);
  if (wear) {
    node.append(durabilityBar(wear.left, wear.max));
    markWear(node);
  }
  // ItemSlot's top right: the strength it wants, or the typical one with a «?» while its level is unknown.
  const strength = strengthOf(item);
  if (strength && !options.equipped) {
    const { str, known } = strength;
    node.append(el('span', { className: `pd-tag${options.hero && options.hero.str < str ? ' bad' : ''}`, textContent: known ? String(str) : `${str}?` }));
  }
  if (cursed) node.append(el('span', { className: 'pd-mark curse' }));
  if (options.hero && inQuickslot(options.hero, item)) node.append(el('span', { className: 'pd-mark quick' }));
  node.onclick = () => {
    audio.play('click');
    options.onClick?.();
  };
  return node;
}

/** The row of a hero's sprite sheet: the tier of the armour worn. */
export const armorTier = (hero: Hero): number => itemDef(hero.armor.kind).tier ?? 0;

/**
 * The design system's durability bar (PD.durability): filled in 2px steps, «low» at a quarter or less,
 * «broken» when worn out; its slot is marked so the corner digits rise above it.
 */
export function durabilityBar(left: number, max: number, big = false): HTMLElement {
  const bar = el('i', { className: `pd-dur${big ? ' big' : ''}` });
  const steps = big ? 40 : 21;
  const share = max > 0 ? Math.max(0, Math.min(1, left / max)) : 0;
  bar.style.setProperty('--v', String(left <= 0 ? 0 : Math.max(1 / steps, Math.round(share * steps) / steps)));
  bar.classList.toggle('low', left > 0 && share <= 0.25);
  bar.classList.toggle('broken', left <= 0);
  return bar;
}

/** A slot holding a durability bar lifts its corner digits; a broken one dims and strikes its level. */
export function markWear(node: HTMLElement): void {
  const bar = node.querySelector(':scope > .pd-dur');
  if (!bar) return;
  node.classList.add('has-dur');
  node.classList.toggle('broken', bar.classList.contains('broken'));
}

/** An item's description, its curse and weight set apart as warnings, and how worn it is under its numbers. */
function describedItem(world: World, hero: Hero, item: Item): HTMLElement[] {
  const nodes = described(itemInfo(world, hero, item));
  const wear = wearOf(world, item);
  if (!wear) return nodes;
  const line = el('div', { className: `pd-durability${wear.left > 0 && wear.left / wear.max <= 0.25 ? ' low' : ''}` },
    info(t.durability(wear.left, wear.max)), durabilityBar(wear.left, wear.max, true));
  const after = [line, ...(wear.left <= 0 ? [el('p', { className: 'pd-callout broken', textContent: t.brokenInfo })] : [])];
  return [nodes[0]!, ...after, ...nodes.slice(1)].filter(Boolean);
}

/** A window title for an item: a broken item's level struck through rather than its name saying «broken». */
function titleFor(world: World, item: Item, box: HTMLElement): void {
  if (!isBroken(item) || item.level <= 0 || !levelKnown(item)) return;
  const heading = box.querySelector('.pd-heading');
  if (!heading) return;
  heading.textContent = `${capitalize(plainName(world, item))} `;
  heading.append(el('span', { className: 'pd-lvl-broken', textContent: `+${item.level}` }));
}

/** The item is the one the quickslot shows. */
const inQuickslot = (hero: Hero, item: Item): boolean => isQuickslotted(item.kind) && hero.items.find((other) => other.kind === item.kind) === item;

/* Title */

export interface TitleOptions {
  heroClass: HeroClass;
  /** The solo run that can be continued, if any. */
  save: { heroClass: HeroClass; lvl: number; depth: number } | null;
  /** Shown outside Telegram, where the name is not known. */
  askName: string | null;
  onClass(heroClass: HeroClass): void;
  onName(name: string): void;
  onContinue(): void;
  onSolo(): void;
  onDaily(): void;
  /** Shows today's board; absent without checked runs. */
  onDailyBoard?: () => void;
  /**
   * The daily dungeon today, as the server knows it: its attempt open, under way, or played (with
   * the place it took of how many); absent without checked runs.
   */
  dailyState?: { state: 'open' | 'going' | 'done'; place: number | null; total: number };
  /** Practice in today's dungeon, once its attempt is played. */
  onPractice?: () => void;
  /** Today's rules of the daily dungeon, as a line. */
  dailyRules?: string;
  /** The player's card (rankui.ts profileCard), once the server has told who they are. */
  profile?: HTMLElement;
  onRankings(): void;
  onMart(): void;
  onSettings(): void;
  /** Challenges switched on for the next new game (a bit mask). */
  challenges: number;
  onChallenges(): void;
  /** The arena of waves' entry, under «Play with friends» (arenaui.ts). */
  arena?: HTMLElement;
}

/** «Rankings» with its cup. */
function rankingsButton(onClick: () => void): HTMLButtonElement {
  const node = button(t.ranked.title, onClick);
  node.prepend(rankIcon('gold', { x1: true }));
  return node;
}

export function showTitle(options: TitleOptions): void {
  let selected = options.heroClass;
  const name = el('span', { className: 'pd-class-name', textContent: t.classes[selected] });
  const about = info(t.classInfo[selected], 'pd-note');
  const classes = el('div', { className: 'pd-classes' });
  classes.setAttribute('role', 'radiogroup');
  const renderClasses = (): void => {
    classes.replaceChildren(
      ...HERO_CLASSES.map((heroClass) => {
        const face = el('i', { className: 'pd-class-face' });
        face.style.setProperty('--av', String(AVATAR[heroClass]));
        const node = el(
          'button',
          {
            className: `pd-class${heroClass === selected ? ' selected' : ''}`,
            ariaLabel: t.classes[heroClass],
            onclick: () => {
              audio.play('click');
              selected = heroClass;
              name.textContent = t.classes[heroClass];
              about.textContent = t.classInfo[heroClass];
              options.onClass(heroClass);
              renderClasses();
            },
          },
          face,
        );
        node.setAttribute('role', 'radio');
        node.setAttribute('aria-checked', String(heroClass === selected));
        return node;
      }),
    );
  };
  renderClasses();

  const field =
    options.askName !== null &&
    el(
      'div',
      { className: 'pd-field' },
      el('label', { htmlFor: 'pd-name', textContent: t.heroName }),
      el('input', {
        id: 'pd-name',
        className: 'pd-input',
        value: options.askName,
        maxLength: 20,
        placeholder: t.yourName,
        oninput: (event: Event) => options.onName((event.target as HTMLInputElement).value),
      }),
    );

  const { save } = options;
  const main: HTMLElement[] = [];
  const rest: HTMLElement[] = [];
  if (save) {
    const resume = button(t.continueRun, options.onContinue, `${main.length ? '' : 'primary big '}stacked`);
    resume.append(el('span', { className: 'pd-btn-sub', textContent: t.continueMeta(t.classes[save.heroClass], save.lvl, save.depth) }));
    (main.length ? rest : main).push(resume);
  }
  const fresh = button(save ? t.newRun : t.solo, options.onSolo, main.length ? '' : 'primary big');
  // The challenges go with a new game: beside it, the cup lit when some are on.
  const on = countChallenges(options.challenges);
  const challenges = button(t.meta.challenges, options.onChallenges);
  const cup = el('i', { className: 'pd-icon' });
  cup.style.cssText = `width:24px;height:24px;background-image:var(--spr-challenge-${on ? 'on' : 'off'})`;
  challenges.prepend(cup);
  if (on) challenges.append(el('b', { className: 'pd-ch-n', textContent: String(on) }));
  if (main.length) rest.push(el('div', { className: 'pd-row' }, fresh, challenges));
  else main.push(fresh, challenges);

  // The daily dungeon: its attempt open (or under way), or played, with the place it took (a cup for 1–3).
  const day = options.dailyState;
  const done = day?.state === 'done';
  const chip = day && el('span', { className: `pd-chip${done ? ' done' : ''}`, textContent: done ? t.ranked.dailyChipDone : day.state === 'going' ? t.ranked.dailyChipGoing : t.ranked.dailyChipOpen });
  const place = done && day.place !== null
    ? el(
      'div',
      { className: 'pd-daily-place' },
      day.place <= 3 ? rankIcon(trophyKind('daily', day.place)) : null,
      el('b', { textContent: `#${day.place}` }),
      el('span', { textContent: t.ranked.ofTotal(Math.max(day.total, day.place)) }),
    )
    : null;
  const daily = el(
    'div',
    { className: `pd-daily${done ? ' done' : ''}` },
    el('div', { className: 'pd-daily-head' }, picture('stairs'), el('h3', { textContent: t.daily }), chip),
    place,
    options.dailyRules ? el('p', { className: 'pd-daily-rules', textContent: options.dailyRules }) : null,
    info(done ? t.ranked.dailyDone : day ? t.ranked.dailyOpenNote : t.dailyInfo, 'pd-note'),
    el(
      'div',
      { className: 'pd-row' },
      done && options.onPractice ? button(t.ranked.practice2, options.onPractice) : button(t.descendDaily, options.onDaily),
      options.onDailyBoard && button(t.dailyBoard, options.onDailyBoard),
    ),
  );

  const logo = el(
    'div',
    { className: 'pd-logo' },
    el('img', { src: 'assets/banner-title.png', alt: 'Pixel Dungeon' }),
    el('span', { className: 'pd-logo-sub', textContent: t.subtitle }),
  );

  show(
    el(
      'main',
      { className: `pd-title-screen${options.profile ? ' ranked' : ''}` },
      el(
        'div',
        { className: 'pd-corner' },
        el('button', { className: 'pd-iconbtn prefs', ariaLabel: t.meta.settings, onclick: () => (audio.play('click'), options.onSettings()) }),
      ),
      logo,
      options.profile,
      el(
        'section',
        { className: 'pd-window' },
        classes,
        el('div', { className: 'pd-class-info' }, name, about),
        field,
        el(
          'div',
          { className: 'pd-actions' },
          daily,
          ...main,
          ...rest,
          options.arena,
          el('div', { className: 'pd-row' }, rankingsButton(options.onRankings), button(t.mart, options.onMart)),
        ),
      ),
    ),
    null,
    true,
  );
}

/* Menu */

export interface MenuOptions {
  onResume(): void;
  onHelp(): void;
  onBadges(): void;
  onJournal(): void;
  onSettings(): void;
  onMart(): void;
  onTreat(): void;
  /** Sends the co-op session's log with a word from the player; absent alone. */
  onReport?: () => void;
  onExit(): void;
}

export function showMenu(options: MenuOptions): void {
  show(
    windowOf(
      { title: t.menu, onClose: options.onResume, narrow: true },
      el(
        'div',
        { className: 'pd-menu-list' },
        button(t.resume, options.onResume, 'primary'),
        el('div', { className: 'pd-row' }, button(t.meta.journal, options.onJournal), button(t.help, options.onHelp)),
        el('div', { className: 'pd-row' }, button(t.badges, options.onBadges), button(t.mart, options.onMart)),
        button(t.meta.settings, options.onSettings),
        options.onReport && button(t.reportProblem, options.onReport, 'quiet'),
        button(t.treat, options.onTreat, 'quiet'),
        button(t.toMenu, options.onExit, 'quiet'),
      ),
    ),
    options.onResume,
  );
}

/* Badges */

/** WndBadges: every badge, the ones earned bright, new ones with a golden dot; a tap tells what each is for. */
export function showBadges(onClose: () => void): void {
  const earned = earnedBadges();
  const fresh = unseenBadges();
  markBadgesSeen();
  const big = el('i', { className: 'pd-badge big' });
  const name = el('span', { className: 'pd-badge-name' });
  const detail = el('div', { className: 'pd-badge-detail' }, big, name);
  const select = (id: BadgeId, image: number, node: HTMLElement | null): void => {
    big.className = 'pd-badge big';
    big.dataset.i = String(image);
    big.classList.toggle('dim', !earned.has(id));
    name.textContent = badgeText(id);
    detail.classList.toggle('locked', !earned.has(id));
    grid.querySelectorAll('.selected').forEach((n) => n.classList.remove('selected'));
    node?.classList.add('selected');
    sprites(detail);
  };
  const grid = el('div', { className: 'pd-grid c6' });
  // The arena's badges are left out: the arena of waves is no longer offered.
  for (const badge of BADGES.filter((b) => b.image < ARENA_BADGES)) {
    const icon = el('i', { className: `pd-badge${earned.has(badge.id) ? '' : ' dim'}` });
    icon.dataset.i = String(badge.image);
    const node = el('button', { className: `pd-slot${fresh.has(badge.id) ? ' new' : ''}`, ariaLabel: badgeText(badge.id) }, icon);
    node.onclick = () => {
      audio.play('click');
      select(badge.id, badge.image, node);
    };
    grid.append(node);
  }
  // «Patron of the arts», outside the original's badges: for a tip or the patronage.
  if (mart.maecenas) {
    const node = el('button', { className: 'pd-slot', ariaLabel: t.maecenas }, el('i', { className: 'pd-offer-badge patron' }));
    node.onclick = () => {
      audio.play('click');
      grid.querySelectorAll('.selected').forEach((n) => n.classList.remove('selected'));
      node.classList.add('selected');
      big.className = 'pd-offer-badge patron';
      name.textContent = t.maecenas;
      detail.classList.remove('locked');
    };
    grid.append(node);
  }
  const first = BADGES.find((b) => fresh.has(b.id)) ?? BADGES.find((b) => earned.has(b.id)) ?? BADGES[0]!;
  show(
    windowOf(
      { title: t.badges, sub: t.badgesCount(earned.size, BADGES.length), onClose },
      el('div', { className: 'pd-scroll' }, grid),
      detail,
    ),
    onClose,
  );
  select(first.id, first.image, grid.children[BADGES.indexOf(first)] as HTMLElement);
}

/* Hero */

export interface HeroOptions {
  hero: Hero;
  /** Pixel-Mart's «Look» rows, if the shop is there. */
  looks?: HTMLElement;
  /** The look the hero wears, for their portrait. */
  skin?: string;
  buffs: ReadonlyArray<{ name: BuffName; turns?: number }>;
  onClose(): void;
}

export function stats(rows: ReadonlyArray<readonly [string, string, string?]>): HTMLElement {
  return el(
    'dl',
    { className: 'pd-stats' },
    ...rows.map(([label, value, tone]) => el('div', {}, el('dt', { textContent: label }), el('dd', { className: tone ?? '', textContent: value }))),
  );
}

/** WndHero: the hero's numbers and what currently ails or helps them. */
export function showHero(options: HeroOptions): void {
  const { hero } = options;
  const buffs = options.buffs.map((buff) => {
    const icon = el('i');
    icon.dataset.b = String(BUFF_ICONS[buff.name]);
    const text = buff.turns ? `${t.buffs[buff.name]} (${t.turnsLeft(buff.turns)})` : t.buffs[buff.name];
    return el('div', { className: 'pd-row' }, el('span', { className: 'pd-buff' }, icon), info(text));
  });
  show(
    windowOf(
      {
        title: t.heroTitle(hero.subclass ? capitalize(t.subclasses[hero.subclass]) : t.classes[hero.heroClass], hero.lvl),
        icon: portrait(hero.heroClass, armorTier(hero), options.skin),
        onClose: options.onClose,
      },
      stats([
        [t.strength, String(hero.str)],
        // WndHero: health, and the shield over it (the warrior's seal).
        [t.health, shielding(hero) > 0 ? `${Math.max(0, hero.hp)}+${shielding(hero)}/${hero.ht}` : `${Math.max(0, hero.hp)}/${hero.ht}`],
        [t.experience, `${hero.exp}/${maxExp(hero)}`],
        [t.goldLabel, String(hero.gold), 'gold'],
        [t.slain, String(hero.kills)],
      ]),
      el('h3', { className: 'pd-heading', textContent: t.conditions }),
      ...(buffs.length > 0 ? buffs : [info(t.noConditions, 'pd-note')]),
      options.looks && el('h3', { className: 'pd-subhead', textContent: t.looksTitle }),
      options.looks,
    ),
    options.onClose,
  );
}

/* Shops */

export interface TradeOptions {
  world: World;
  hero: Hero;
  item: Item;
  price: number;
  onBuy(): void;
  onClose(): void;
}

/** WndTradeItem for a shop's ware: what it is, and what it costs. */
export function showTrade(options: TradeOptions): void {
  const { world, hero, item, price } = options;
  const short = hero.gold < price;
  const buy = button(t.buyFor(price), () => {
    options.onBuy();
    options.onClose();
  }, 'primary');
  buy.disabled = short;
  const head = windowOf(
    { title: capitalize(itemName(world, item)), icon: slot(world, item, { hero }), onClose: options.onClose },
    ...describedItem(world, hero, item),
    actions([buy], []),
    info(t.yourGold(hero.gold), 'pd-note center'),
  );
  titleFor(world, item, head);
  head.querySelector('.pd-titles')!.append(el('span', { className: `pd-price${short ? ' short' : ''}`, textContent: String(price) }));
  show(head, options.onClose);
}

export interface SellOptions {
  world: World;
  hero: Hero;
  onSell(index: number): void;
  onClose(): void;
}

/** Shopkeeper.sell: what the pack is worth to him, item by item. */
export function showSell(options: SellOptions): void {
  const { world, hero } = options;
  const cards = hero.items.flatMap((item, index) => {
    const price = itemPrice(item, world.known.includes(item.kind));
    if (price <= 0) return [];
    return [
      el(
        'div',
        { className: 'pd-reward' },
        slot(world, item, { hero }),
        el('div', { className: 'pd-reward-name', textContent: capitalize(itemName(world, item)) }),
        el('div', { className: 'pd-reward-desc' }),
        button(t.sellFor(price), () => options.onSell(index), 'danger small'),
      ),
    ];
  });
  show(
    windowOf(
      { title: capitalize(t.mobs.shopkeeper), icon: portrait('shopkeeper'), onClose: options.onClose },
      info(cards.length > 0 ? t.sellInfo : t.nothingToSell, 'pd-speech'),
      cards.length > 0 && el('div', { className: 'pd-scroll' }, el('div', { className: 'pd-rewards' }, ...cards)),
      info(t.yourGold(hero.gold), 'pd-note center'),
    ),
    options.onClose,
  );
}

/* Quests */

export interface QuestOptions {
  world: World;
  hero: Hero;
  /** Who is speaking: the sad ghost or the old wandmaker. */
  who: MobKind;
  text: string;
  /** Rewards on offer, one of which the hero may take. */
  offers?: readonly Item[];
  onChoose?(index: number): void;
  /** Answers to give instead of just closing (WndQuest's buttons), each closing the window. */
  answers?: ReadonlyArray<{ label: string; onAnswer(): void }>;
  onClose(): void;
}

/** A word with a quest giver (WndQuest, WndSadGhost, WndWandmaker): portrait, name, speech, rewards or answers. */
export function showQuest(options: QuestOptions): void {
  const { hero, offers = [] } = options;
  // The rewards are shown for what they are.
  const world = { ...options.world, known: [...options.world.known, ...offers.map((item) => item.kind)] };
  const card = (item: Item, index: number): HTMLElement =>
    el(
      'div',
      { className: 'pd-reward' },
      slot(world, item, { hero }),
      el('div', { className: 'pd-reward-name', textContent: capitalize(itemName(world, item)) }),
      el('div', { className: 'pd-reward-desc', textContent: itemInfo(world, hero, item).join(' ') }),
      button(t.take, () => {
        options.onChoose?.(index);
        options.onClose();
      }, offers.length === 1 ? 'primary small' : 'small'),
    );
  const answers = options.answers ?? [];
  // A question wants an answer: no cross. The first answer is the yes.
  const answerRow =
    answers.length > 0 &&
    // One above the other, the yes first, so a long answer is never cut off.
    el(
      'div',
      { className: 'pd-confirm-actions' },
      ...answers.map((answer, i) =>
        button(answer.label, () => {
          answer.onAnswer();
          options.onClose();
        }, i === 0 ? 'primary' : 'quiet')),
    );
  const box = windowOf(
    { title: capitalize(t.mobs[options.who]), icon: portrait(options.who), onClose: answers.length > 0 ? undefined : options.onClose },
    info(options.text, 'pd-speech'),
    offers.length > 0 && el('div', { className: 'pd-rewards' }, ...offers.map(card)),
    answerRow,
  );
  show(box, answers.length > 0 ? null : options.onClose);
}

/* The Amulet of Yendor */

/**
 * AmuletScene: the Amulet in hand, «Let's call it a day» ends the run as won; «I'm not done yet»
 * goes on (up to the surface, for the happy end). With its words the first time it is taken;
 * from the backpack («End the game») only the question.
 */
export function showAmulet(world: World, hero: Hero, withText: boolean, onEnd: () => void, onStay: () => void): void {
  const amulet = hero.items.find((item) => item.kind === 'quest.amulet');
  const box = windowOf(
    { title: t.items['quest.amulet'], icon: slot(world, amulet, { hero }) },
    withText && info(t.amuletText, 'pd-speech'),
    info(t.amuletWayUp, 'pd-note'),
    el(
      'div',
      { className: 'pd-confirm-actions' },
      button(t.amuletEnd, () => {
        hideOverlay();
        onEnd();
      }, 'primary'),
      button(t.amuletStay, () => {
        hideOverlay();
        onStay();
      }, 'quiet'),
    ),
  );
  show(box, null);
}

/* Examine */

export interface InfoExtras {
  /** A portrait or an item slot beside the title. */
  icon?: HTMLElement;
  /** A creature's health, as a bar under its name. */
  health?: readonly [number, number];
}

/** A few lines about something looked at (the examine tool's windows). */
export function showInfo(title: string, lines: readonly string[], onClose: () => void, extras: InfoExtras = {}): void {
  const box = windowOf(
    { title: capitalize(title), icon: extras.icon, onClose },
    ...described(lines),
  );
  if (extras.health) box.querySelector('.pd-titles')!.append(healthBar(extras.health[0], extras.health[1]));
  show(box, onClose);
}

/* The blacksmith */

export interface ReforgeOptions {
  world: World;
  hero: Hero;
  text: string;
  onReforge(first: ItemRef, second: ItemRef): void;
  onClose(): void;
}

/**
 * WndBlacksmith: two items of one kind become one, a level better. Rather
 * than picking two items one after the other, each possible pair is offered
 * at once: the better item, and what would be melted down with it.
 */
export function showReforge(options: ReforgeOptions): void {
  const { world, hero } = options;
  const owned: Array<{ ref: ItemRef; item: Item }> = [
    ...(hero.weapon ? [{ ref: 'weapon' as ItemRef, item: hero.weapon }] : []),
    { ref: 'armor' as ItemRef, item: hero.armor },
    ...hero.items.map((item, index) => ({ ref: index as ItemRef, item })),
  ].filter(({ item }) => {
    const category = itemDef(item.kind).category;
    // Blacksmith.verify: he works only with what is identified.
    return (category === 'weapon' || category === 'armor' || category === 'wand' || category === 'ring') &&
      isIdentified(world, item) && item.level >= 0 && item.kind !== 'weapon.pickaxe';
  });
  const pairs: Array<{ first: ItemRef; second: ItemRef; better: Item; worse: Item }> = [];
  owned.forEach((a, i) => {
    for (const b of owned.slice(i + 1)) {
      if (a.item.kind !== b.item.kind) continue;
      // What is melted down comes from the pack.
      const [keep, melt] = typeof b.ref !== 'number' || (typeof a.ref === 'number' && a.item.level < b.item.level) ? [b, a] : [a, b];
      if (typeof melt.ref !== 'number') continue;
      const better = keep.item.level >= melt.item.level ? keep.item : melt.item;
      pairs.push({ first: keep.ref, second: melt.ref, better, worse: better === keep.item ? melt.item : keep.item });
    }
  });
  const card = (pair: (typeof pairs)[number]): HTMLElement =>
    el(
      'div',
      { className: 'pd-reward' },
      el('div', { className: 'pd-reforge' }, slot(world, pair.better, { hero }), el('span', { className: 'pd-reforge-arrow' }), slot(world, pair.worse, { hero })),
      el('div', { className: 'pd-reward-name', textContent: capitalize(itemName(world, pair.better)) }),
      el('div', { className: 'pd-reward-desc', textContent: t.reforgePair(itemName(world, pair.better), itemName(world, pair.worse)) }),
      button(t.reforge, () => {
        options.onReforge(pair.first, pair.second);
        options.onClose();
      }, pairs.length === 1 ? 'primary small' : 'small'),
    );
  show(
    windowOf(
      { title: capitalize(t.mobs.blacksmith), icon: portrait('blacksmith'), onClose: options.onClose },
      info(options.text, 'pd-speech'),
      pairs.length === 0
        ? info(t.nothingToReforge, 'pd-note')
        : el('div', { className: 'pd-scroll' }, el('div', { className: 'pd-rewards pd-reforges' }, ...pairs.map(card))),
    ),
    options.onClose,
  );
}

/* Small windows */

/** The tip on a level's sign (Sign.read): no cross, a tap anywhere closes it. */
export function showSign(text: string, onClose: () => void): void {
  const sign = el('div', { className: 'pd-sign' }, info(t.signTitle, 'pd-note'), info(text));
  show(sign, onClose);
  sign.onclick = () => {
    audio.play('click');
    onClose();
  };
}

/** Chasm.heroJump's WndOptions: a question with a yes and a no; the yes is dangerous here. */
export function showConfirm(title: string, text: string, yes: string, no: string, onYes: () => void, onClose: () => void): void {
  show(
    windowOf(
      { narrow: true },
      el('h2', { className: 'pd-heading center', textContent: title }),
      info(text, 'pd-info center'),
      // One above the other, so a long answer is never cut off.
      el(
        'div',
        { className: 'pd-confirm-actions' },
        button(yes, () => {
          onClose();
          onYes();
        }, 'danger'),
        button(no, onClose, 'quiet'),
      ),
    ),
    onClose,
  );
}

/** The help's controls: the button each line is about, and which line of the help text it is. */
const CONTROLS: ReadonlyArray<{ sprite?: string; item?: number; w: number; h: number; line?: number }> = [
  { sprite: 'target', w: 16, h: 16, line: 0 },
  { sprite: 'tool-backpack', w: 14, h: 15, line: 1 },
  { item: S.DART, w: 16, h: 16, line: 3 },
  { sprite: 'tool-search', w: 12, h: 12, line: 4 },
  { sprite: 'tool-wait', w: 12, h: 12, line: 5 },
  { sprite: 'tool-info', w: 8, h: 12, line: 6 },
  { sprite: 'menu', w: 6, h: 5 },
];
/** The rest of the help text: tips rather than controls. */
const TIPS = [11, 2, 7, 8, 9, 10];

/** The help: «Controls», each line beside the button it is about, and «Tips»; only the list scrolls. */
export function showHelp(onClose: () => void): void {
  const controls = el(
    'ul',
    { className: 'pd-tips' },
    ...CONTROLS.map((control) => {
      let glyph: HTMLElement;
      if (control.item !== undefined) {
        glyph = el('i', { className: 'pd-item' });
        glyph.dataset.i = String(control.item);
      } else {
        glyph = picture(control.sprite!);
        glyph.style.setProperty('--w', String(control.w));
        glyph.style.setProperty('--h', String(control.h));
      }
      const text = control.line === undefined ? t.helpHud : t.helpText[control.line] ?? '';
      return el('li', { className: 'pd-tip' }, el('span', { className: 'pd-tip-ico' }, glyph), info(text));
    }),
  );
  const tips = el('ul', { className: 'pd-tips plain' }, ...TIPS.map((i) => el('li', { className: 'pd-tip' }, info(t.helpText[i] ?? ''))));
  const scroll = el('div', { className: 'pd-scroll' }, controls);
  const tabs = el('div', { className: 'pd-tabs' });
  tabs.setAttribute('role', 'tablist');
  const tab = (label: string, list: HTMLElement): HTMLButtonElement => {
    const node = el('button', { className: 'pd-tab', textContent: label });
    node.setAttribute('role', 'tab');
    node.onclick = () => {
      audio.play('click');
      for (const other of tabs.children) other.setAttribute('aria-selected', String(other === node));
      scroll.replaceChildren(list);
      scroll.scrollTop = 0;
      sprites(scroll);
    };
    return node;
  };
  const first = tab(t.helpControls, controls);
  first.setAttribute('aria-selected', 'true');
  const second = tab(t.helpTips, tips);
  second.setAttribute('aria-selected', 'false');
  tabs.append(first, second);
  show(windowOf({ title: t.help, onClose }, tabs, scroll), onClose);
}

/** The log's history: every message kept, newest last, depths marked. */
export function showHistory(lines: readonly LogLine[], onClose: () => void): void {
  const list = el('div', { className: 'pd-history' });
  let depth = -1;
  for (const line of lines) {
    if (line.depth !== undefined && line.depth !== depth) {
      depth = line.depth;
      list.append(el('div', { className: 'pd-depth-mark', textContent: t.newDepth(depth) }));
    }
    const row = el('div', { className: `pd-log-line ${line.tone ?? ''}`.trim(), textContent: line.text });
    if ((line.count ?? 1) > 1) row.append(el('span', { className: 'pd-n', textContent: `×${line.count}` }));
    list.append(row);
  }
  const scroll = el('div', { className: 'pd-scroll' }, list);
  show(windowOf({ title: t.history, onClose }, scroll), onClose);
  scroll.scrollTop = scroll.scrollHeight;
}

/* The end of a run */

export interface EndOptions {
  victory: boolean;
  title: string;
  /** What befell the hero: where and by what. */
  cause: string;
  hero: { name: string; heroClass: HeroClass; lvl: number; depth: number; gold: number; kills: number };
  onRestart: () => void;
  restartLabel: string;
  onExit: () => void;
  /** The run's place among this device's best, if it made the table. */
  place?: number | null;
  /** The run's score. */
  score: number;
  /** How the server scored it (rankui.ts rankingBlock). */
  ranking?: HTMLElement;
  /** The ways to share the result (shareButton). */
  share?: readonly ShareChoice[];
  /** Opens the boards; absent without checked runs. */
  onBoards?: () => void;
}

/** The end of a run: the whole party fell, or it won. */
export function showRunEnd(options: EndOptions): void {
  const { hero } = options;
  const avatar = el('i');
  avatar.style.setProperty('--av', String(AVATAR[hero.heroClass]));
  const rows: Array<readonly [string, string, string?]> = [
    [t.statDepth, String(hero.depth)],
    [t.statLevel, String(hero.lvl)],
    [t.goldLabel, String(hero.gold), 'gold'],
    [t.slain, String(hero.kills)],
    [t.scoreLabel, options.score.toLocaleString(locale), 'ally'],
  ];
  show(
    el(
      'section',
      { className: `pd-window pd-runend${options.victory ? ' win' : ''}` },
      el('h2', { className: 'pd-display', textContent: options.title }),
      options.cause && el('p', { className: 'pd-cause', textContent: options.cause }),
      options.place && !options.ranking ? el('p', { className: 'pd-info center pd-gold', textContent: options.place === 1 ? t.newRecord : t.rankPlace(options.place) }) : null,
      el(
        'div',
        { className: 'pd-runend-hero' },
        el('div', { className: 'pd-avatar' }, avatar),
        el('div', { className: 'pd-info', textContent: `${hero.name} · ${t.classes[hero.heroClass]}` }),
      ),
      stats(rows),
      options.ranking,
      actions(
        [button(options.restartLabel, options.onRestart, 'primary')],
        [...(options.share?.length ? [shareButton(options.share)] : []), ...(options.onBoards ? [button(t.ranked.title, options.onBoards)] : [])],
      ),
      button(t.toMenu, options.onExit, 'quiet'),
    ),
    null,
  );
}

/** A way to share a result: a story, a chat, a link. */
export interface ShareChoice {
  label: string;
  run(): void;
}

/** «Share»: one way, at once; several, and it opens into a row of them in its place. */
export function shareButton(choices: readonly ShareChoice[], label = t.shareResult, className = ''): HTMLElement {
  if (choices.length === 1) return button(label, () => choices[0]!.run(), className);
  const node = button(label, () => {
    node.replaceWith(el('div', { className: 'pd-row pd-share-row' }, ...choices.map((choice) => button(choice.label, () => choice.run()))));
  }, className);
  return node;
}

/** A window with only a word in it, while something is on its way (a new run from the server). */
export function showWaiting(text: string): void {
  show(el('section', { className: 'pd-window narrow pd-waiting' }, el('p', { className: 'pd-info center', textContent: text })), null);
}

/** Rankings: the best runs on this device; `latest` is highlighted. */
export function showRankings(records: readonly RunRecord[], onClose: () => void, latest?: string): void {
  const ranks = el('div', { className: 'pd-ranks' });
  records.forEach((record, i) => {
    const face = el('i', { className: 'pd-rank-face' });
    face.style.setProperty('--av', String(AVATAR[record.heroClass]));
    const what = record.won ? `★ ${t.won}` : record.cause;
    ranks.append(
      el(
        'div',
        { className: `pd-rank${record.key === latest ? ' me' : ''}` },
        el('span', { className: 'pd-rank-n', textContent: String(i + 1) }),
        face,
        el(
          'span',
          { className: 'pd-rank-name', textContent: `${record.name} · ${t.classes[record.heroClass]}` },
          el('small', {
            textContent: record.mode === 'arena'
              ? `${t.arena.title} · ${t.levelShort} ${record.lvl} · ${t.arena.waveWord(record.depth)}${what ? ` · ${what}` : ''}`
              : `${t.levelShort} ${record.lvl} · ${t.depthShort(record.depth)}${what ? ` · ${what}` : ''}`,
          }),
        ),
        el('span', { className: 'pd-rank-score', textContent: record.score.toLocaleString(locale) }),
      ),
    );
  });
  show(
    windowOf(
      { title: t.rankings, onClose },
      records.length === 0 ? info(t.noRankings, 'pd-note') : el('div', { className: 'pd-scroll' }, ranks),
    ),
    onClose,
  );
}

/** Scrolls read on one thing the player picks. */
const TARGETED_SCROLLS = ['scroll.upgrade', 'scroll.enchantment', 'scroll.identify'] as const;

/* Backpack */

export interface BackpackOptions {
  world: World;
  hero: Hero;
  onAction(action: Action): void;
  /** Throw or zap the item at a cell the player picks next. */
  onAim(index: number, kind: 'throw' | 'zap' | 'special'): void;
  onClose(): void;
  /**
   * WndBag's selector: the backpack with only what a scroll can be read on to tap (worn
   * things too); the rest dimmed. A tap reads the scroll on it.
   */
  pick?: { title: string; targets: readonly ItemRef[]; onPick(ref: ItemRef): void; onCancel(): void };
}

/** What is chosen in the backpack: an item in the pack (by slot) or one worn. */
type BagChoice = { index: number } | { worn: 'weapon' | 'armor' } | { ring: number };

/** The backpack's filters (design system v10): the rest dims but stays where it is. */
type BagFilter = 'all' | 'potions' | 'scrolls' | 'gear';

/** The backpack open now, what is chosen in it and how it is filtered, so it can be drawn again as the world changes. */
let openBag: { options: BackpackOptions; choice: BagChoice | null; filter: BagFilter } | null = null;

/** Draws the open backpack again (after an action that keeps it open, or anything that changed the pack). */
export function refreshBackpack(world: World, hero: Hero): void {
  if (!openBag || !overlayOpen() || !root.querySelector('.pd-window.bag')) {
    openBag = null;
    return;
  }
  showBackpack({ ...openBag.options, world, hero }, openBag.choice);
}

/** The item a choice points at, if it is still there. */
function chosenItem(hero: Hero, choice: BagChoice | null): Item | undefined {
  if (!choice) return undefined;
  if ('index' in choice) return hero.items[choice.index];
  if ('ring' in choice) return hero.rings[choice.ring];
  return choice.worn === 'weapon' ? hero.weapon ?? undefined : hero.armor;
}

/** Whether an item passes a filter: «gear» is weapons, armour, rings, wands and thrown weapons. */
function passes(filter: BagFilter, item: Item): boolean {
  const category = itemDef(item.kind).category;
  if (filter === 'potions') return category === 'potion';
  if (filter === 'scrolls') return category === 'scroll';
  if (filter === 'gear') return ['weapon', 'armor', 'ring', 'wand', 'missile'].includes(category);
  return true;
}

/**
 * The backpack (WndBag) as one window (design system v10): the worn things and the key ring in
 * a row, the pack in a 5×4 grid, and the chosen item's panel — what it is, what can be done with
 * it — below (beside, on a wide screen), without leaving the backpack. Putting on, taking off,
 * dropping or setting a quick slot keeps it open; drinking, eating, reading, throwing and zapping
 * close it, for the dungeon to answer. Holding an item does its first action on release.
 */
export function showBackpack(options: BackpackOptions, choice: BagChoice | null = null): void {
  const { world, hero, pick } = options;
  const targets = new Set((pick?.targets ?? []).map(String));
  const filter: BagFilter = !pick && openBag && openBag.options.hero === hero ? openBag.filter : 'all';
  if (!pick) openBag = { options, choice, filter };
  // A choice that no longer holds (the item went) is forgotten.
  if (!chosenItem(hero, choice)) choice = null;
  const choose = (next: BagChoice): void => {
    if (pick) {
      const ref: ItemRef = 'index' in next ? next.index : 'ring' in next ? (next.ring === 0 ? 'ring0' : 'ring1') : next.worn;
      if (targets.has(String(ref))) pick.onPick(ref);
      return;
    }
    showBackpack(options, next);
  };
  const same = (a: BagChoice | null, b: BagChoice): boolean => JSON.stringify(a) === JSON.stringify(b);
  /** The chosen item framed in gold; filtered out or no target, dimmed; a target, blinking. */
  const mark = (node: HTMLElement, ref: ItemRef, here: BagChoice, item: Item): HTMLElement => {
    if (node.tagName !== 'BUTTON') return node;
    if (pick) node.classList.add(targets.has(String(ref)) ? 'can' : 'dim');
    else {
      if (same(choice, here)) node.classList.add('selected');
      if (!passes(filter, item)) node.classList.add('dim');
      const opts = { ...options, item, ...where(here) };
      holdToUse(node, () => firstActionName(opts), () => firstAction(opts));
      // What can be dragged: anything in the pack, and a worn ring or the weapon in hand (to take it off).
      if ('index' in here || 'ring' in here || ('worn' in here && here.worn === 'weapon')) node.dataset.from = JSON.stringify(here);
    }
    node.dataset.drop = String(ref);
    return node;
  };
  // The backpack's own slots; keys go on the key ring, and other bags' contents in a row below.
  const entries = hero.items.map((item, index) => ({ item, index, bagged: inBag(hero, item) }));
  const keys = entries.filter((entry) => itemDef(entry.item.kind).category === 'key');
  const loose = entries.filter((entry) => !entry.bagged);
  const bagged = entries.filter((entry) => entry.bagged && itemDef(entry.item.kind).category !== 'key');
  const grid = el('div', { className: 'pd-bag-grid' });
  for (let i = 0; i < Math.max(BACKPACK_SIZE, loose.length); i++) {
    const entry = loose[i];
    if (!entry) {
      const empty = el('div', { className: 'pd-slot empty' });
      empty.dataset.drop = 'pack';
      grid.append(empty);
      continue;
    }
    grid.append(mark(slot(world, entry.item, { hero, onClick: () => choose({ index: entry.index }) }), entry.index, { index: entry.index }, entry.item));
  }
  const coin = picture('coin', 16, 14);
  const close = pick ? pick.onCancel : (): void => {
    openBag = null;
    options.onClose();
  };
  const head = el(
    'header',
    { className: 'pd-bag-head' },
    el('h2', { className: 'pd-heading', textContent: t.backpack }),
    el('span', { className: 'pd-stat gold' }, coin, String(hero.gold)),
    el('span', { className: 'pd-stat' }, el('span', { className: 'pd-stat-label', textContent: t.strength }), String(hero.str)),
    closeButton(close),
  );
  // Filters, or in a scroll's choice the question and «cancel».
  const bar = pick
    ? el(
      'div',
      { className: 'pd-bag-target' },
      el('span', { textContent: pick.title }),
      button(t.cancel, pick.onCancel, 'quiet'),
    )
    : bagFilters(filter, (next) => {
      if (openBag) openBag.filter = next;
      showBackpack(options, choice);
    });
  if (pick) bar.setAttribute('role', 'status');
  const worn = (item: Item | undefined, placeholder: number, ref: ItemRef, here: BagChoice): HTMLElement =>
    item
      ? mark(slot(world, item, { hero, equipped: true, onClick: () => choose(here) }), ref, here, item)
      : withDrop(slot(world, undefined, { hero, equipped: true, placeholder }), String(ref));
  // The key ring: how many keys there are; what they open is said on the map.
  const keyCount = keys.reduce((sum, entry) => sum + entry.item.qty, 0);
  const keyring = el(
    'div',
    { className: `pd-slot keys${keyCount ? '' : ' placeholder'}`, ariaLabel: t.keysCount(keyCount) },
    keyringIcon(),
    keyCount > 0 && el('span', { className: 'pd-qty', textContent: String(keyCount) }),
  );
  const equip = el(
    'div',
    { className: 'pd-bag-equip' },
    // Bare-handed after a monk's blow: the weapon's silhouette.
    worn(hero.weapon ?? undefined, S.WEAPON_HOLDER, 'weapon', { worn: 'weapon' }),
    worn(hero.armor, S.ARMOR_HOLDER, 'armor', { worn: 'armor' }),
    ...[0, 1].map((i) => worn(hero.rings[i], S.RING_HOLDER, i === 0 ? 'ring0' : 'ring1', { ring: i })),
    keyring,
  );
  const item = chosenItem(hero, choice);
  const panel = pick
    ? el('div', { className: 'pd-pick empty' }, info(t.pickTarget))
    : item && choice
      ? itemDetail({ ...options, item, ...where(choice) })
      : el(
        'div',
        { className: 'pd-pick empty' },
        info(t.bagHint),
        el(
          'div',
          { className: 'pd-hold-hint' },
          el('span', { className: 'pd-hold-demo' }, el('span', { className: 'pd-hold-label', textContent: t.drink }), el('span', { className: 'pd-slot holding' }, itemIconAt(S.POTION_CRIMSON))),
          el('span', {}, el('b', { textContent: t.holdTitle }), ` ${t.holdText}`),
        ),
      );
  const side = el(
    'div',
    { className: 'pd-bag-side' },
    equip,
    grid,
    ...(bagged.length > 0
      ? [
          el('div', { className: 'pd-bagrow-title' }, info(t.inBags, 'pd-note')),
          el('div', { className: 'pd-bagrow' }, ...bagged.map(({ item: bagItem, index }) => mark(slot(world, bagItem, { hero, onClick: () => choose({ index }) }), index, { index }, bagItem))),
        ]
      : []),
  );
  // Where a dragged item is let go of to drop it on the floor (shown only while dragging).
  const away = el('div', { className: 'pd-bag-away', textContent: t.dragToDrop });
  away.dataset.drop = 'away';
  const box = el('section', { className: `pd-window bag${pick ? ' targeting' : ''}` }, head, bar, el('div', { className: 'pd-bag-body' }, side, panel), away);
  box.setAttribute('role', 'dialog');
  if (!pick) dragAndDrop(box, options);
  // Drawn again over itself (a choice, an action), it does not come in again.
  if (root.querySelector('.pd-window.bag')) box.classList.add('still');
  show(box, close);
}

/** Marks an empty place as somewhere a dragged item can be let go of. */
function withDrop(node: HTMLElement, key: string): HTMLElement {
  node.dataset.drop = key;
  return node;
}

/**
 * Dragging in the backpack: a weapon, armour or ring onto its place among the worn things puts
 * it on; a worn ring back into the pack takes it off; a known scroll of upgrade, enchantment or
 * identify onto an item reads it on that item; anything onto the strip at the bottom drops it.
 * While dragging, every place that would take the item is lit. A drag starts once the finger
 * has moved a little, so a tap still chooses and a hold still uses.
 */
function dragAndDrop(box: HTMLElement, options: BackpackOptions): void {
  const { world, hero } = options;
  const SLOP = 8;
  let drag: { from: BagChoice; item: Item; node: HTMLElement; x: number; y: number; ghost: HTMLElement | null; ok: Map<string, Action> } | null = null;
  /** What letting go of `from` on each place would do. */
  const dropsFor = (from: BagChoice, item: Item): Map<string, Action> => {
    const drops = new Map<string, Action>();
    if ('ring' in from) {
      drops.set('pack', { type: 'remove', ring: from.ring });
      hero.items.forEach((_, i) => drops.set(String(i), { type: 'remove', ring: from.ring }));
      return drops;
    }
    // The weapon in hand back into the pack.
    if ('worn' in from && from.worn === 'weapon') {
      drops.set('pack', { type: 'unequip' });
      hero.items.forEach((_, i) => drops.set(String(i), { type: 'unequip' }));
      return drops;
    }
    if (!('index' in from)) return drops;
    const index = from.index;
    const category = itemDef(item.kind).category;
    if (category === 'weapon') drops.set('weapon', { type: 'equip', item: index });
    if (category === 'armor') drops.set('armor', { type: 'equip', item: index });
    if (category === 'ring') {
      drops.set('ring0', { type: 'equip', item: index });
      drops.set('ring1', { type: 'equip', item: index });
    }
    if (category === 'scroll' && isKnown(world, item) && (TARGETED_SCROLLS as readonly string[]).includes(item.kind)) {
      for (const ref of scrollTargets(world, hero, item.kind)) drops.set(String(ref), { type: 'use', item: index, on: ref });
    }
    drops.set('away', { type: 'drop', item: index });
    return drops;
  };
  const end = (): void => {
    drag?.ghost?.remove();
    box.classList.remove('dragging');
    box.querySelectorAll('.drop-ok, .drop-over').forEach((node) => node.classList.remove('drop-ok', 'drop-over'));
    drag = null;
  };
  const placeAt = (x: number, y: number): HTMLElement | null => {
    const under = document.elementFromPoint(x, y);
    return (under?.closest('[data-drop]') as HTMLElement | null) ?? null;
  };
  box.addEventListener('pointerdown', (event) => {
    const node = (event.target as HTMLElement).closest<HTMLElement>('[data-from]');
    if (!node) return;
    const from = JSON.parse(node.dataset.from!) as BagChoice;
    const item = chosenItem(hero, from);
    if (!item) return;
    drag = { from, item, node, x: event.clientX, y: event.clientY, ghost: null, ok: dropsFor(from, item) };
  });
  box.addEventListener('pointermove', (event) => {
    if (!drag) return;
    if (!drag.ghost) {
      if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < SLOP) return;
      // It is a drag: no hold, no tap; the places that take it light up.
      drag.node.dispatchEvent(new Event('pointercancel'));
      drag.node.setPointerCapture?.(event.pointerId);
      const ghost = el('div', { className: 'pd-drag-ghost' }, slot(world, drag.item, { hero }));
      sprites(ghost);
      document.body.append(ghost);
      drag.ghost = ghost;
      box.classList.add('dragging');
      box.querySelectorAll<HTMLElement>('[data-drop]').forEach((place) => {
        if (drag!.ok.has(place.dataset.drop!)) place.classList.add('drop-ok');
      });
    }
    drag.ghost!.style.transform = `translate(${event.clientX}px, ${event.clientY}px)`;
    box.querySelectorAll('.drop-over').forEach((place) => place.classList.remove('drop-over'));
    const place = placeAt(event.clientX, event.clientY);
    if (place && drag.ok.has(place.dataset.drop!)) place.classList.add('drop-over');
  });
  const release = (event: PointerEvent): void => {
    if (!drag?.ghost) {
      drag = null;
      return;
    }
    const place = placeAt(event.clientX, event.clientY);
    const action = place ? drag.ok.get(place.dataset.drop!) : undefined;
    const node = drag.node;
    end();
    // The click that ends a drag is not a tap on the item.
    const swallow = (click: Event): void => {
      click.stopImmediatePropagation();
      click.preventDefault();
    };
    node.addEventListener('click', swallow, { capture: true, once: true });
    window.setTimeout(() => node.removeEventListener('click', swallow, { capture: true }), 50);
    if (!action) return;
    audio.play('click');
    if (action.type === 'use') {
      // Reading a scroll: the dungeon answers, the backpack closes.
      openBag = null;
      options.onAction(action);
      options.onClose();
      return;
    }
    if (openBag) openBag.choice = null;
    options.onAction(action);
    refreshBackpack(options.world, options.hero);
  };
  box.addEventListener('pointerup', release);
  box.addEventListener('pointercancel', (event) => {
    if (event.target === box) end();
  });
}

/** The filter tabs: All, Potions, Scrolls, Gear. */
function bagFilters(current: BagFilter, onChange: (filter: BagFilter) => void): HTMLElement {
  const tabs = el('div', { className: 'pd-tabs compact pd-bag-filter' });
  tabs.setAttribute('role', 'tablist');
  for (const [id, label] of [['all', t.bagAll], ['potions', t.bagPotions], ['scrolls', t.bagScrolls], ['gear', t.bagGear]] as const) {
    const tab = el('button', { className: 'pd-tab', textContent: label, onclick: () => (audio.play('click'), onChange(id)) });
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', String(id === current));
    tabs.append(tab);
  }
  return tabs;
}

/** The key ring's picture. */
function keyringIcon(): HTMLElement {
  const icon = el('i', { className: 'pd-icon' });
  icon.style.cssText = 'width:30px;height:30px;background-image:var(--spr-keyring)';
  return icon;
}

/** An items.png sprite on its own. */
function itemIconAt(sprite: number): HTMLElement {
  const icon = el('i', { className: 'pd-item' });
  icon.dataset.i = String(sprite);
  return icon;
}

/** Where a choice sits, as the item window's options say it. */
function where(choice: BagChoice): { index: number | null; ring?: number } {
  return 'index' in choice ? { index: choice.index } : 'ring' in choice ? { index: null, ring: choice.ring } : { index: null };
}

/**
 * Holding a slot (design system v10): after 0.4 s it lifts (`.holding`) with the action's name
 * above it; let go on it and the action is done, slide off and it is not. A short tap only chooses.
 */
function holdToUse(node: HTMLElement, name: () => string | null, act: () => void): void {
  let timer = 0;
  let held = false;
  let label: HTMLElement | null = null;
  const reset = (): void => {
    window.clearTimeout(timer);
    node.classList.remove('holding');
    label?.remove();
    label = null;
  };
  node.addEventListener('pointerdown', () => {
    held = false;
    reset();
    const what = name();
    if (!what) return;
    timer = window.setTimeout(() => {
      held = true;
      node.classList.add('holding');
      label = el('span', { className: 'pd-hold-label', textContent: what });
      node.append(label);
    }, 400);
  });
  node.addEventListener('pointerleave', () => {
    held = false;
    reset();
  });
  node.addEventListener('pointercancel', () => {
    held = false;
    reset();
  });
  // The click that ends a hold does the action instead of choosing.
  node.addEventListener('click', (event) => {
    const was = held;
    held = false;
    reset();
    if (!was) return;
    event.stopImmediatePropagation();
    event.preventDefault();
    audio.play('click');
    act();
  }, { capture: true });
}

interface ItemOptions extends BackpackOptions {
  item: Item;
  /** Backpack slot, or null for equipped items. */
  index: number | null;
  /** For a worn ring: which of the two it is. */
  ring?: number;
}

/** The chosen item's panel: its picture and name («worn»), what it is, «drop» in the corner, and its actions. */
function itemDetail(options: ItemOptions): HTMLElement {
  const { world, hero, item, index } = options;
  const { main, more, danger } = itemActions(options);
  // A cursed thing one knows about: nothing urges putting it on (the callout says why).
  const knownCurse = visiblyCursed(item) && index !== null;
  if (knownCurse) main[0]?.classList.remove('primary');
  if (main[0]?.classList.contains('primary')) main[0].append(el('span', { className: 'pd-btn-sub', textContent: t.orHold }));
  const all = [...main, ...more];
  if (all.length % 2 === (main[0]?.classList.contains('primary') ? 0 : 1) && all.length > 0) all[all.length - 1]!.classList.add('wide');
  const title = el(
    'div',
    { className: 'pd-titles' },
    el('h3', { className: 'pd-heading', textContent: capitalize(itemName(world, item)) }),
    index === null && el('span', { className: 'pd-chip', textContent: t.wornChip }),
  );
  const drop = danger[0];
  drop?.classList.add('pd-pick-dropbtn');
  const box = el(
    'div',
    { className: 'pd-pick' },
    el('div', { className: 'pd-pick-head' }, slot(world, item, { hero, equipped: index === null }), title, drop),
    ...describedItem(world, hero, item),
    all.length > 0 && el('div', { className: 'pd-pick-actions' }, ...all),
  );
  box.setAttribute('aria-live', 'polite');
  titleFor(world, item, box);
  return box;
}

/** The name of an item's first action (drink, eat, read, put on...), if it has one. */
function firstActionName(options: ItemOptions): string | null {
  return itemActions(options).main[0]?.textContent ?? null;
}

/** Holding an item: its first action, done. */
function firstAction(options: ItemOptions): void {
  const first = itemActions(options).main[0];
  if (first instanceof HTMLButtonElement) first.click();
}

/** The old item window, kept for what still opens an item on its own: now the backpack with it chosen. */
function showItem(options: ItemOptions): void {
  const choice: BagChoice = options.index !== null ? { index: options.index } : options.ring !== undefined ? { ring: options.ring } : { worn: options.item === options.hero.armor ? 'armor' : 'weapon' };
  showBackpack(options, choice);
}

/**
 * What can be done with an item, as the design lays out actions: the first red, the rest
 * stone, dropping last. `act` closes the backpack (the dungeon answers); `stay` keeps it open.
 */
function itemActions(options: ItemOptions): { main: HTMLElement[]; more: HTMLElement[]; danger: HTMLElement[] } {
  const { world, hero, item, index } = options;
  const category = itemDef(item.kind).category;
  const act = (action: Action): void => {
    openBag = null;
    options.onAction(action);
    options.onClose();
  };
  /** Done, the backpack stays open, drawn anew once the pack has changed (see refreshBackpack). */
  const stay = (action: Action, next: BagChoice | null = null): void => {
    if (openBag) openBag.choice = next;
    options.onAction(action);
    refreshBackpack(options.world, options.hero);
  };
  const aimWith = (kind: 'throw' | 'zap' | 'special', at: number): void => {
    openBag = null;
    options.onClose();
    options.onAim(at, kind);
  };
  const main: HTMLElement[] = [];
  const more: HTMLElement[] = [];
  const danger: HTMLElement[] = [];
  const use = (label: string, onClick: () => void): void => {
    (main.length === 0 ? main : more).push(button(label, onClick, main.length === 0 ? 'primary' : ''));
  };
  if (index !== null) {
    if (category === 'potion') use(t.drink, () => act({ type: 'use', item: index }));
    if (category === 'food' || item.kind === 'quest.fish') use(t.eat, () => act({ type: 'use', item: index }));
    if (category === 'torch') use(t.light, () => act({ type: 'use', item: index }));
    if (category === 'tome') use(t.readTome, () => showWays(options, index, act));
    if (item.kind === 'weapon.pickaxe') use(t.mine, () => act({ type: 'mine' }));
    if (item.kind === 'quest.amulet') {
      use(t.amuletEndGame, () => {
        openBag = null;
        showAmulet(world, hero, false, () => options.onAction({ type: 'endGame' }), options.onClose);
      });
    }
    if (category === 'kit') use(t.applyKit, () => act({ type: 'use', item: index, target: 'armor' }));
    if (category === 'seed') use(t.plantSeed, () => aimWith('throw', index));
    if (category === 'scroll') {
      // A known scroll that acts on one thing asks which, from the whole pack and what is worn (WndBag's selector).
      const targeted = isKnown(world, item) && (TARGETED_SCROLLS as readonly string[]).includes(item.kind);
      const targets = targeted ? scrollTargets(world, hero, item.kind) : [];
      if (targeted) {
        use(t.readOn, () =>
          showBackpack({
            ...options,
            pick: {
              title: t.pickTitle[item.kind as 'scroll.upgrade' | 'scroll.enchantment' | 'scroll.identify'] ?? t.read,
              targets,
              onPick: (on) => act({ type: 'use', item: index, on }),
              onCancel: () => showBackpack(options, { index }),
            },
          }));
      } else {
        use(t.read, () => act({ type: 'use', item: index }));
      }
    }
    if (category === 'weapon' || category === 'armor' || category === 'ring') {
      const worn: BagChoice = category === 'ring' ? { ring: hero.rings.length < 2 ? hero.rings.length : 0 } : { worn: category === 'armor' ? 'armor' : 'weapon' };
      use(category === 'ring' ? t.putOn : t.equip, () => {
        stay({ type: 'equip', item: index }, worn);
        if (category === 'armor') offerSealTransfer(options, index);
      });
    }
    // Armor.AC_DETACH: the warrior's seal off an armour in the pack.
    if (item.seal) more.push(button(t.hero.detach, () => stay({ type: 'detach', armor: index }, null)));
    if (category === 'beacon') {
      // LloydsBeacon: set it here, or go back to where it was set.
      if (item.returnTo) use(t.beaconReturn, () => act({ type: 'beacon', item: index, mode: 'return' }));
      use(t.beaconSet, () => act({ type: 'beacon', item: index, mode: 'set' }));
    }
    if (category === 'weightstone' && hero.weapon) {
      // Weightstone.WndBalance: the weapon in hand, balanced the way it is not yet.
      for (const imbue of ['speed', 'accuracy'] as const) {
        if (hero.weapon.imbue !== imbue) use(t.balanceFor[imbue], () => stay({ type: 'balance', item: index, imbue }, { worn: 'weapon' }));
      }
    }
    if (category === 'wipeout') use(t.read, () => act({ type: 'use', item: index }));
    if (category === 'vial' && item.volume) use(t.drink, () => act({ type: 'use', item: index }));
    // BrokenSeal.AC_AFFIX: onto an armour, worn or in the pack (WndBag's armour selector).
    if (category === 'seal') use(t.hero.affix, () => pickArmorForSeal(options, index, stay));
    if (category === 'missile' || category === 'wand' || category === 'bomb' || category === 'honeypot') {
      const kind = category === 'wand' ? 'zap' : 'throw';
      use(kind === 'throw' ? t.throwItem : t.zap, () => aimWith(kind, index));
    }
    if (category === 'potion') use(t.throwItem, () => aimWith('throw', index));
    if (category === 'honeypot') use(t.shatterPot, () => act({ type: 'use', item: index }));
    // Item.AC_THROW: anything in the pack can be thrown where the player taps (a bag would scatter what it holds).
    if (!['bag', 'missile', 'bomb', 'honeypot', 'potion', 'seed'].includes(category)) use(t.throwItem, () => aimWith('throw', index));
    // QuickSlot: any item with a use can be kept one tap away: into the first free slot (or one whose item
    // ran out), else the first. Holding a slot on the toolbar chooses for that slot (Toolbar's quickslot_assign).
    if (quickUse(item.kind) && !isQuickslotted(item.kind)) {
      more.push(button(t.quickslotShort, () => {
        const free = Array.from({ length: QUICKSLOTS }, (_, i) => i).find((i) => {
          const kind = quickKind(i);
          return kind === null || !hero.items.some((other) => other.kind === kind);
        });
        chooseQuickslot(item.kind, free ?? 0);
        refreshBackpack(world, hero);
      }));
    }
    danger.push(button(t.dropItem, () => stay({ type: 'drop', item: index }), 'danger'));
  } else if (options.ring !== undefined) {
    const ring = options.ring;
    use(t.takeOff, () => stay({ type: 'remove', ring }));
  } else if (item === hero.weapon) {
    use(t.takeOff, () => stay({ type: 'unequip' }));
  } else if (item === hero.armor && item.kind === CLASS_ARMOR_OF[hero.heroClass]) {
    // ClassArmor.doSpecial: the leap and the smoke bomb want a cell; the others act at once.
    const aimed = hero.heroClass === 'warrior' || hero.heroClass === 'rogue';
    use(t.specials[hero.heroClass], () => (aimed ? aimWith('special', -1) : act({ type: 'special' })));
  }
  // Armor.AC_DETACH, on the armour worn.
  if (item === hero.armor && item.seal) more.push(button(t.hero.detach, () => stay({ type: 'detach', armor: 'armor' }, null)));
  return { main, more, danger };
}

/** BrokenSeal.armorSelector: the backpack opened on the armours the seal can go onto (the one worn too). */
function pickArmorForSeal(options: ItemOptions, from: number | 'armor', stay: (action: Action, next?: BagChoice | null) => void): void {
  const { hero } = options;
  const targets: ItemRef[] = [
    ...(hero.armor && !hero.armor.seal ? ['armor' as const] : []),
    ...hero.items.flatMap((item, i) => (itemDef(item.kind).category === 'armor' && !item.seal ? [i] : [])),
  ];
  showBackpack({
    ...options,
    pick: {
      title: t.hero.affixPrompt,
      targets,
      onPick: (to) => {
        showBackpack(options, null);
        stay({ type: 'affix', from, to: to as number | 'armor' }, to === 'armor' ? { worn: 'armor' } : null);
      },
      onCancel: () => showBackpack(options, typeof from === 'number' ? { index: from } : { worn: 'armor' }),
    },
  });
}

/**
 * Armor.doEquip for the warrior: the armour taken off carried his seal and the new one has none (and
 * is not cursed) — he is asked whether the seal should move over (Armor.seal_transfer). The armour
 * taken off is where the new one was in the pack.
 */
function offerSealTransfer(options: ItemOptions, index: number): void {
  const hero = heroById(options.world, options.hero.id) ?? options.hero;
  if (!offersSealTransfer(hero, hero.items[index])) return;
  showConfirm(capitalize(t.items.seal), t.hero.sealTransfer, t.hero.yes, t.hero.no, () => {
    options.onAction({ type: 'affix', from: index, to: 'armor' });
    refreshBackpack(options.world, options.hero);
  }, () => showBackpack(options, { worn: 'armor' }));
}

/** TomeOfMastery: the two ways of the hero's class, as equal cards; the choice can wait. */
function showWays(options: ItemOptions, index: number, act: (action: Action) => void): void {
  const { hero } = options;
  const back = (): void => showBackpack(options);
  const book = el('div', { className: 'pd-slot' }, itemIcon(options.world, hero.items[index]!));
  show(
    windowOf(
      { title: t.chooseWay, icon: book },
      el(
        'div',
        { className: 'pd-choices' },
        ...SUBCLASSES[hero.heroClass].map((way) =>
          el(
            'div',
            { className: 'pd-choice' },
            el('span', { className: 'pd-choice-name', textContent: capitalize(t.subclasses[way]) }),
            el('p', { className: 'pd-choice-desc', textContent: t.subclassInfo[way] }),
            button(t.choose, () => act({ type: 'master', item: index, subclass: way }), 'small'),
          )),
      ),
      button(t.later, back, 'quiet'),
    ),
    back,
  );
}

/* Toast */

let toastTimer = 0;

export interface ToastOptions {
  tone?: 'good' | 'warn' | 'ally' | 'badge';
  /** An item sprite or a badge image beside the text. */
  item?: number;
  badge?: number;
}

/** One message at a time under the HUD; it fades out by itself. */
export function toast(text: string, options: ToastOptions = {}): void {
  const node = document.getElementById('toast')!;
  const icon = options.badge !== undefined ? el('i', { className: 'pd-badge' }) : options.item !== undefined ? el('i', { className: 'pd-item' }) : null;
  if (icon) icon.dataset.i = String(options.badge ?? options.item);
  node.className = `pd-toast${options.tone ? ` ${options.tone}` : ''}`;
  node.replaceChildren(...[icon, el('span', { textContent: text })].filter((n): n is HTMLElement => n !== null));
  sprites(node);
  node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    node.classList.add('hide');
    toastTimer = window.setTimeout(() => {
      node.hidden = true;
    }, 260);
  }, 2400);
}
