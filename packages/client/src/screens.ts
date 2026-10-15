import {
  ankhChoices, escapeScore, isChallenged, NO_ARMOR, keepable, ALCHEMIZE_CHOICES, armorEvasionBonus, armorStats, augmentsFor, weaponStats, heroEquipped, CAN_THROW, energyValue, enchantOptions, INVENTORY_STONES, intuitionChoices, isTargetedScroll,
  knownIn, MUST_THROW, TARGETED_SPELLS,
  type Action, type Augment, BACKPACK_SIZE, scrollTargets, isBroken, isEnchantable, isIdentified, isTippedDart, type Hero, inBag, type HeroClass, HERO_CLASSES,
  type Item, itemAt, itemDef, itemPrice, type ItemKind, type ItemRef, itemSprite, levelKnown, maxExp, type MobKind, S, SUBCLASSES, TIPPED_DARTS,
  type ScoreBreakdown, HIGHLIGHT, visiblyCursed, type World, hasAbility, CLASS_ARMOR_OF, heroById, isClassArmor, type SealSource, talentPointsAvailable, offersSealTransfer, shielding, type ArtifactAction, miscChoices, type MiscSlot, visiblyUpgraded,
} from '@pd/core';
import { artifactActions, artifactCard, type ArtifactHost, chargeStrip, showMiscChooser } from './artifactui';
import { artText } from './artifacttext';
import { abilityName as abilityLabel, AT } from './abilitytext';
import { type AbilityHost, classArmorCard, showAbilityPick, showTalents, startAbility } from './abilityui';
import { lt, plain } from './levelnames';
import { audio } from './audio';
import { type ChoiceOption, showChoice } from './alchemyui';
import { chooseQuickslot, isPlaceholder, isQuickslotted, QUICKSLOTS, quickKind, quickUse, WEAPON_SLOT } from './quickslot';
import { ARENA_BADGES, BADGES, RETIRED, type BadgeId, badgeText, earnedBadges, markBadgesSeen, unseenBadges } from './badges';
import { BUFF_ICONS, type BuffEntry, type BuffName } from './hud';
import { capitalize, fill, fmt, lang, locale, t } from './i18n';
import { chargesOf, isKnown, itemInfo, itemName, magicOf, markSeen, plainName, strengthOf, wearOf } from './itemtext';
import { labelWords } from './labels';
import { mart } from './mart';
import { quality } from './quality';
import { confirmRisky, drinkRisk, enchantLossChance, equipRisk, targetEffect } from './riskyuse';
import { showHeroWindow } from './talentui';
import { showMetamorphosis, showSubclassPick } from './talentui';
import { subclassName, tal } from './talenttext';
import type { RunRecord } from './rankings';
import { type Assets, heroSprite } from './sprites';
import type { LogLine } from './view';

/*
 * DOM windows over the game, in the design system's markup (docs/design/system):
 * a window has a head with a title and a cross, then text, then its actions,
 * the main one red and first, the dangerous ones last behind a line.
 */

const root = document.getElementById('overlay')!;
/** Heroes in avatars.png and in the heroes strip, in this order. */
export const AVATAR: Readonly<Record<HeroClass, number>> = { warrior: 0, mage: 1, rogue: 2, huntress: 3, duelist: 4, cleric: 5 };

/**
 * A portrait face: the class's avatar, or the look worn (Pixel-Mart): the Duelist's and the Cleric's looks have their own
 * avatars (avatars-skins.png, three each: ash, royal, shadow), the older classes' looks are the sheet's alone.
 */
export function setAvatar(face: HTMLElement, heroClass: HeroClass, skin?: string): void {
  const index = skin ? ['ash', 'royal', 'shadow'].indexOf(skin) : -1;
  const own = index >= 0 && (heroClass === 'duelist' || heroClass === 'cleric');
  face.classList.toggle('skin', own);
  face.style.setProperty('--av', String(own ? (heroClass === 'duelist' ? 0 : 3) + index : AVATAR[heroClass]));
}

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
  windowListener?.(onClose !== null);
}

let windowListener: ((closable: boolean) => void) | null = null;

/** Told whenever a window is put up: whether it can be closed (Telegram's back button closes it on the title screen). */
export function onWindow(listener: (closable: boolean) => void): void {
  windowListener = listener;
}

/**
 * WndResurrect: two things to keep, the weapon and the armour to begin with; any of the hero's belongings (or what
 * lies in the backpack left behind) but an ankh or a bag. It wants an answer: no cross.
 */
export function showResurrect(world: World, hero: Hero, onKeep: (keep: number[]) => void): void {
  const choices = ankhChoices(hero);
  const keepable = (item: Item): boolean => item.kind !== 'ankh' && itemDef(item.kind).category !== 'bag';
  let picked = [hero.weapon, hero.armor].map((item) => (item ? choices.indexOf(item) : -1)).filter((i) => i >= 0);
  const grid = el('div', { className: 'pd-grid' });
  const draw = (): void => {
    grid.replaceChildren(...choices.map((item, i) => {
      const node = slot(world, item, { hero });
      if (picked.includes(i)) node.classList.add('equipped');
      if (!keepable(item)) node.style.opacity = '0.45';
      else node.onclick = () => {
        audio.play('click');
        picked = picked.includes(i) ? picked.filter((p) => p !== i) : [...picked, i].slice(-2);
        draw();
      };
      return node;
    }));
  };
  draw();
  const done = (): void => {
    hideOverlay();
    onKeep(picked);
  };
  const open = (): void => show(windowOf(
    { title: t.ankh.title, icon: slot(world, { kind: 'ankh', qty: 1, level: 0 } as Item) },
    // The pack may be long: the message and the grid scroll, «Confirm» stays in reach.
    el('div', { className: 'pd-scroll pd-stack' }, info(t.ankh.message), grid),
    button(t.ankh.confirm, () => {
      if (picked.length >= 2) done();
      else showConfirm(t.ankh.warnTitle, t.ankh.warnBody, t.ankh.warnYes, t.ankh.warnNo, done, open);
    }, 'primary'),
  ), null);
  open();
}

export function hideOverlay(): void {
  closer = null;
  root.classList.remove('open', 'bare');
  root.replaceChildren();
  windowListener?.(false);
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
  // Shattered's items.png in the design system's own markup (.pd-sitem, data-s: 16 a row).
  scope.querySelectorAll<HTMLElement>('[data-s]').forEach((node) => {
    const s = Number(node.dataset.s);
    node.style.setProperty('--ix', String(s % 16));
    node.style.setProperty('--iy', String(Math.floor(s / 16)));
  });
  // Shattered's talent_icons.png (32 a row, data-t) and hero_icons.png (8 a row, data-h): the talents' and armour abilities' icons.
  scope.querySelectorAll<HTMLElement>('[data-t]').forEach((node) => {
    const i = Number(node.dataset.t);
    node.style.setProperty('--ix', String(i % 32));
    node.style.setProperty('--iy', String(Math.floor(i / 32)));
  });
  scope.querySelectorAll<HTMLElement>('[data-h]').forEach((node) => {
    const i = Number(node.dataset.h);
    node.style.setProperty('--ix', String(i % 8));
    node.style.setProperty('--iy', String(Math.floor(i / 8)));
  });
  // The sheets of v19 in one row each: tinted buffs (buffs-tints.png, 18), the journal's new marks (journal2.png, 14).
  scope.querySelectorAll<HTMLElement>('[data-tb]').forEach((node) => node.style.setProperty('--ix', node.dataset.tb!));
  scope.querySelectorAll<HTMLElement>('[data-j2]').forEach((node) => node.style.setProperty('--ix', node.dataset.j2!));
  scope.querySelectorAll<HTMLElement>('[data-b]').forEach((node) => {
    // From 1000: Shattered's buffs.png, the same 18 a row but more rows (see BUFF_ICONS).
    const spd = Number(node.dataset.b) >= 1000;
    const b = Number(node.dataset.b) % 1000;
    node.classList.toggle('spd', spd);
    node.style.setProperty('--bx', String(b % 18));
    node.style.setProperty('--by', String(Math.floor(b / 18)));
  });
}

export function closeButton(onClose: () => void): HTMLButtonElement {
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

export function itemIcon(world: World, item: Item): HTMLElement {
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
  /** The empty «misc» place (design v19: slot-misc.png, a ring and an amulet in silhouette) in place of a holder. */
  misc?: boolean;
}

/** A 52×52 slot: the sprite and up to three corner labels (level, strength, quantity). */
export function slot(world: World, item: Item | undefined, options: SlotOptions = {}): HTMLElement {
  if (!item) {
    if (options.misc) return el('div', { className: 'pd-slot placeholder misc', ariaLabel: t.miscEmpty });
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
  // ClassArmor.status: the charge as a percentage.
  const charges = isClassArmor(item) && options.hero && item.kind === `armor.${options.hero.heroClass}` ? `${Math.floor(item.charge ?? 0)}%` : chargesOf(item);
  if (charges !== null) {
    node.append(el('span', { className: 'pd-qty', textContent: charges }));
  } else if (item.qty > 1) {
    node.append(el('span', { className: 'pd-qty', textContent: String(item.qty) }));
  }
  // Artifact.visiblyUpgraded: an artifact shows +0 to +10 whatever its own cap.
  const shown = itemDef(item.kind).category === 'artifact' ? visiblyUpgraded(item) : item.level;
  if (shown !== 0 && levelKnown(item)) {
    node.append(el('span', { className: `pd-lvl ${shown > 0 ? 'up' : 'down'}`, textContent: `${shown > 0 ? '+' : '−'}${Math.abs(shown)}` }));
  }
  // WndBag's durability bars: how worn an upgraded item is; a broken one's level is struck through (it works as +0).
  const wear = wearOf(world, item);
  if (wear) {
    node.append(durabilityBar(wear.left, wear.max));
    markWear(node);
  }
  // ItemSlot's top right: the strength it wants, or the typical one with a «?» while its level is unknown.
  const strength = strengthOf(item, options.hero);
  if (strength && !options.equipped) {
    const { str, known } = strength;
    node.append(el('span', { className: `pd-tag${options.hero && options.hero.str < str ? ' bad' : ''}`, textContent: known ? String(str) : `${str}?` }));
  }
  // ShMarks: the enchantment's spark (a weapon) or the glyph's shield-rune (armour), in its colour; red for a curse.
  const magic = magicOf(item);
  if (magic) {
    const mark = el('i', { className: `pd-mark ${magic.glyph ? 'glyph' : 'ench'}${magic.fresh ? ' new' : ''}` });
    mark.style.setProperty('--ench', magic.color);
    node.append(mark);
  }
  if (cursed) node.append(el('span', { className: 'pd-mark curse' }));
  if (options.hero && inQuickslot(options.hero, item)) node.append(el('span', { className: 'pd-mark quick' }));
  // ShArtifact: the artifact's charge as a strip along the icon's bottom.
  const strip = options.hero ? chargeStrip(world, options.hero, item) : null;
  if (strip) node.append(strip);
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
  // ShMarks' .pd-ench-line: the enchantment or glyph, named in its colour, and what it does (and it is seen now).
  const magic = magicOf(item);
  if (magic) {
    const line = el('div', { className: `pd-ench-line${magic.curse ? ' curse' : ''}` },
      el('i', { className: `pd-mark ${magic.glyph ? 'glyph' : 'ench'}` }), el('span', {}, el('b', { textContent: magic.name }), magic.desc));
    line.style.setProperty('--ench', magic.color);
    nodes.splice(Math.min(2, nodes.length), 0, line);
    markSeen(magic.id);
  }
  const wear = itemDef(item.kind).category === 'missile' ? null : wearOf(world, item);
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
// (The mage's staff counts in hand too: Shattered keeps it in a quick slot from the start; so do worn artifacts.)
const inQuickslot = (hero: Hero, item: Item): boolean =>
  isQuickslotted(item.kind) &&
  (itemDef(item.kind).category === 'artifact' && (hero.artifact?.kind === item.kind || hero.misc?.kind === item.kind)
    ? item === hero.artifact || item === hero.misc
    : hero.items.find((other) => other.kind === item.kind) === item || (item === hero.weapon && item.kind === 'weapon.magesStaff'));

/* Menu */

export interface MenuOptions {
  onResume(): void;
  onHelp(): void;
  onBadges(): void;
  onJournal(): void;
  onSettings(): void;
  onMart(): void;
  onTreat(): void;
  /** How this run counts (labels.ts) as a chip, and the rest of the subtitle («Daily dungeon · d7»); absent in co-op. */
  run?: { label: ReturnType<typeof labelWords>; sub: string };
  /** Sends the co-op session's log with a word from the player; absent alone. */
  onReport?: () => void;
  onExit(): void;
}

/**
 * The run label's chip (design v23, `.pd-runtag`, run-tags.png): «counts» green, «repeat» blue, «own seed» purple, «not counted» grey;
 * the full meaning is its title and its aria-label.
 */
export function runTag(label: ReturnType<typeof labelWords>): HTMLElement {
  const ix = { counted: 0, repeat: 1, custom: 2, local: 3 }[label.kind];
  const cls = { counted: 'ranked', repeat: 'replay', custom: 'seed', local: 'unranked' }[label.kind];
  const dot = el('i');
  dot.style.setProperty('--ix', String(ix));
  const tag = el('span', { className: `pd-runtag ${cls}`, title: label.note }, dot, label.word);
  tag.setAttribute('aria-label', label.note);
  return tag;
}

export function showMenu(options: MenuOptions): void {
  const box = windowOf(
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
  );
  // The subtitle: the chip, then where the run is.
  if (options.run) box.querySelector('.pd-titles')?.append(el('span', { className: 'pd-sub pd-menu-sub' }, runTag(options.run.label), options.run.sub));
  show(box, options.onResume);
}

/* Badges */

/** WndBadges: every badge, the ones earned bright, new ones with a golden dot; a tap tells what each is for. */
export function showBadges(onClose: () => void, honors: readonly string[] = []): void {
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
  for (const badge of BADGES.filter((b) => b.image < ARENA_BADGES && (!RETIRED.has(b.id) || earned.has(b.id)))) {
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
  // Honours the admin gave (server-side, not the run's badges in core): «Bug hunter» for a confirmed problem report.
  for (const honor of honors) {
    const words = t.rel.honors[honor];
    if (!words) continue;
    const node = el('button', { className: 'pd-slot', ariaLabel: words[0] }, el('i', { className: 'pd-offer-badge bughunter' }));
    node.onclick = () => {
      audio.play('click');
      grid.querySelectorAll('.selected').forEach((n) => n.classList.remove('selected'));
      node.classList.add('selected');
      big.className = 'pd-offer-badge bughunter';
      name.textContent = `${words[0]} · ${words[1]}`;
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
  world: World;
  /** The hero's actions (a talent point spent). */
  act(action: Action): void;
  /** The tab to open on (the talents', after a level gained). */
  tab?: 'stats' | 'talents';
  /** Pixel-Mart's «Look» rows, if the shop is there. */
  looks?: HTMLElement;
  /** The look the hero wears, for their portrait. */
  skin?: string;
  buffs: readonly BuffEntry[];
  /** The armour ability's tier 4 talents (abilityui.ts), if the hero has an ability. */
  onTalents?(): void;
  /** The Warden's plants (classui.ts showWarden). */
  onWarden?(): void;
  onClose(): void;
}

export function stats(rows: ReadonlyArray<readonly [string, string, string?]>): HTMLElement {
  return el(
    'dl',
    { className: 'pd-stats' },
    ...rows.map(([label, value, tone]) => el('div', {}, el('dt', { textContent: label }), el('dd', { className: tone ?? '', textContent: value }))),
  );
}

/** The five parts of a score, in Shattered's order, with the cap that gilds each (HIGHLIGHT). */
const SCORE_PARTS = ['progress', 'treasure', 'explore', 'bosses', 'quests'] as const;

/**
 * WndScoreBreakdown (design v22, ScoreTable): the five parts, each with its icon, what it counts and « / cap »; a part at its cap is framed in
 * gold with a «maximum» plate. Then the multipliers (shown when above 1) and the total. Under it, a fold with what each part counts, in
 * Shattered's own words.
 */
export function scoreTable(b: ScoreBreakdown): HTMLElement {
  const n = (value: number): string => value.toLocaleString(locale);
  const x = (value: number): string => `×${Number(value.toFixed(2)).toLocaleString(locale)}`;
  const s = t.scoring;
  const rows = SCORE_PARTS.map((part, i) => {
    const max = b[part] >= HIGHLIGHT[part];
    const from = part === 'treasure' ? s.treasureFrom(b.gold, n(b.items)) : part === 'explore' && b.floors > 0 ? s.exploreFrom(b.clean, b.floors) : t.v22.scoreShort[i]!;
    const icon = el('i', { className: 'pd-spart' });
    icon.style.setProperty('--ix', String(i));
    return el(
      'div',
      { className: `pd-score-row${max ? ' max' : ''}` },
      icon,
      el('span', { className: 'pd-score-name' }, el('b', { textContent: s[part][0] }), el('small', { textContent: from })),
      el('span', { className: 'pd-score-val' }, max ? el('span', { className: 'pd-max', textContent: t.v22.max }) : null, el('b', { textContent: n(b[part]) }), el('small', { textContent: `/ ${n(HIGHLIGHT[part])}` })),
    );
  });
  const mul = (label: string, value: number): HTMLElement => el('div', { className: 'pd-score-mul' }, el('span', { textContent: label }), el('b', { textContent: x(value) }));
  const table = el(
    'div',
    { className: 'pd-score' },
    ...rows,
    b.winMultiplier > 1 ? mul(s.win, b.winMultiplier) : null,
    b.chalMultiplier > 1 ? mul(s.challenge, b.chalMultiplier) : null,
    el('div', { className: 'pd-score-total' }, el('span', { textContent: s.total }), el('b', { textContent: n(b.total) })),
  );
  const notes = el(
    'details',
    { className: 'pd-score-notes' },
    el('summary', { textContent: s.more }),
    ...[s.progress, s.treasure, s.explore, s.bosses, s.quests].map(([label, text]) => el('p', {}, el('b', { textContent: `${label}. ` }), text)),
  );
  return el('div', { className: 'pd-score-table' }, table, notes);
}

/**
 * The small card of a run in «Mine» (design v22): its title and date, the five parts as icons with thousands (a part at its cap framed in gold),
 * the multipliers and the total. A tap on it opens the whole table.
 */
export function scoreCard(b: ScoreBreakdown, title: string, date: string): HTMLElement {
  const n = (value: number): string => value.toLocaleString(locale);
  const x = (value: number): string => `×${Number(value.toFixed(2)).toLocaleString(locale)}`;
  const k = lang === 'ru' ? 'к' : 'k';
  const mini = el(
    'ul',
    { className: 'pd-score-mini' },
    ...SCORE_PARTS.map((part, i) => {
      const icon = el('i', { className: 'pd-spart' });
      icon.style.setProperty('--ix', String(i));
      const node = el('li', { className: b[part] >= HIGHLIGHT[part] ? 'max' : '', title: t.scoring[part][0] }, icon, el('span', { textContent: `${Math.round(b[part] / 1000)}${k}` }));
      return node;
    }),
  );
  const mults = [b.winMultiplier > 1 ? x(b.winMultiplier) : '', b.chalMultiplier > 1 ? x(b.chalMultiplier) : ''].filter(Boolean).join(' · ');
  return el(
    'article',
    { className: 'pd-score-card' },
    el('header', {}, el('b', { textContent: title }), el('time', { textContent: date })),
    mini,
    el('footer', {}, el('span', { textContent: mults }), el('b', { textContent: n(b.total) })),
  );
}

/** The keys held for this floor, by sort, for the hero window (the HUD's key counter says the same at the top right). */
function keyRows(hero: Hero): Array<readonly [string, string, string?]> {
  const held = (['key.iron', 'key.golden', 'key.crystal'] as const)
    .map((kind) => [kind, hero.items.filter((i) => (i.kind === kind || (kind === 'key.iron' && i.kind === 'key.skeleton')) && i.depth === hero.depth).length] as const)
    .filter(([, n]) => n > 0);
  if (held.length === 0) return [];
  return [[t.keysLabel, held.map(([kind, n]) => `${t.items[kind] ?? kind} ×${n}`).join(', ')]];
}

/** WndHero: the hero's numbers and what currently ails or helps them. */
export function showHero(options: HeroOptions): void {
  const { hero } = options;
  const buffs = options.buffs.map((buff) => {
    const icon = el('i', buff.tint !== undefined ? 'pd-tbuff' : '');
    if (buff.tint !== undefined) icon.dataset.tb = String(buff.tint);
    else icon.dataset.b = String(BUFF_ICONS[buff.name]);
    const text = buff.turns ? `${t.buffs[buff.name]} (${t.turnsLeft(buff.turns)})` : t.buffs[buff.name];
    return el('div', { className: 'pd-row' }, el('span', { className: 'pd-buff' }, icon), info(text));
  });
  showHeroWindow(
    { world: options.world, hero, act: options.act, onClose: options.onClose },
    [
      stats([
        [t.strength, String(hero.str)],
        // WndHero: health, and the shield over it (the warrior's seal).
        [t.health, shielding(hero) > 0 ? `${Math.max(0, hero.hp)}+${shielding(hero)}/${hero.ht}` : `${Math.max(0, hero.hp)}/${hero.ht}`],
        [t.experience, `${hero.exp}/${maxExp(hero)}`],
        [t.goldLabel, String(hero.gold), 'gold'],
        ...keyRows(hero),
        [t.slain, String(hero.kills)],
      ]),
      // The armour ability's tier 4 talents, with a gold plus while there are points to put in them.
      hero.ability && options.onTalents && button(`${abilityLabel(hero.ability)} · ${AT.talentsShort}`, options.onTalents, talentPointsAvailable(hero, 4) > 0 ? 'primary' : ''),
      hero.subclass === 'warden' && options.onWarden ? button(t.v22.wardenButton, options.onWarden) : null,
      el('h3', { className: 'pd-heading', textContent: t.conditions }),
      ...(buffs.length > 0 ? buffs : [info(t.noConditions, 'pd-note')]),
      options.looks && el('h3', { className: 'pd-subhead', textContent: t.looksTitle }),
      options.looks,
    ].filter((node): node is HTMLElement => !!node),
    t.heroTitle(hero.subclass ? capitalize(subclassName(hero.subclass)) : t.classes[hero.heroClass], hero.lvl),
    '',
    portrait(hero.heroClass, armorTier(hero), options.skin),
    options.tab ?? 'stats',
  );
}

/* Shops */

export interface TradeOptions {
  world: World;
  hero: Hero;
  item: Item;
  price: number;
  onBuy(): void;
  /** WndTradeItem's steal, with the master thieves' armband worn: the offer, and what taking it does. */
  steal?: { label: string; sure: boolean; onSteal(): void };
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
  const steal = options.steal;
  // Not sure to work: the armband's warning first, as WndTradeItem asks.
  const stealButton = steal && button(steal.label, () => {
    if (steal.sure) {
      steal.onSteal();
      options.onClose();
    } else {
      showConfirm(capitalize(itemName(world, item)), artText('windows.wndtradeitem.steal_warn'), t.forum.verbs.steal,
        t.forum.verbs.cancel, () => {
          steal.onSteal();
          options.onClose();
        }, options.onClose);
    }
  }, 'small');
  stealButton?.prepend(el('i', { className: 'pd-steal' }));
  const head = windowOf(
    { title: capitalize(itemName(world, item)), icon: slot(world, item, { hero }), onClose: options.onClose },
    // The description scrolls on a short screen; «Buy» and the gold stay in reach.
    el('div', { className: 'pd-scroll pd-stack' }, ...describedItem(world, hero, item)),
    actions(stealButton ? [buy, stealButton] : [buy], []),
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
  /** The window's title and icon, when not the speaker's (WndSadGhost: «Defeated fetid rat» and the foe). */
  title?: string;
  icon?: MobKind;
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
    { title: options.title ?? capitalize(t.mobs[options.who]), icon: portrait(options.icon ?? options.who), onClose: answers.length > 0 ? undefined : options.onClose },
    // The words and the rewards scroll on a short screen; the title and the answers stay in reach.
    el('div', { className: 'pd-scroll pd-stack' }, info(options.text, 'pd-speech'), offers.length > 0 && el('div', { className: 'pd-rewards' }, ...offers.map(card))),
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

/** An extra answer under the two of a confirmation. `then`: the confirmed action follows (a «don't ask again» does the action too). */
export interface ConfirmExtra {
  label: string;
  onPress: () => void;
  then?: boolean;
}

export interface ConfirmOptions {
  /** More answers under the others, such as «Throw it instead». */
  extras?: readonly ConfirmExtra[];
  /** The action wants a hold of this many ms (a run being replaced): a tap fills a bar and does nothing else. */
  hold?: number;
  /** The action is no danger: a plain button rather than a red one. */
  calm?: boolean;
}

/**
 * Hold to confirm (design v23: `.pd-button.hold`): while a finger (or Space / Enter) stays down the fill climbs in 12 steps over `ms`
 * (3 with reduced motion); letting go early empties it at once; at the top the button turns gold, says «Replaced», and the action
 * follows 300 ms later. A bare tap only makes the hint under the row blink.
 */
function holdButton(label: string, ms: number, done: () => void, className: string, hint: HTMLElement): HTMLButtonElement {
  const fillBar = el('span', { className: 'pd-hold-fill' });
  fillBar.setAttribute('aria-hidden', 'true');
  const text = el('span', { className: 'pd-hold-text', textContent: label });
  const node = el('button', { className: `pd-button hold ${className}`.trim() }, fillBar, text);
  node.style.setProperty('--p', '0');
  node.setAttribute('aria-label', label);
  node.setAttribute('aria-description', t.forum.verbs.holdHint);
  const steps = quality.reducedMotion ? 3 : 12;
  let step = 0;
  let timer = 0;
  let finished = false;
  const stop = (): void => {
    if (finished) return;
    window.clearInterval(timer);
    timer = 0;
    step = 0;
    node.classList.remove('holding');
    node.style.setProperty('--p', '0');
    text.textContent = label;
  };
  const tick = (): void => {
    step++;
    node.style.setProperty('--p', String(step / steps));
    if (step < steps) return;
    window.clearInterval(timer);
    finished = true;
    node.classList.remove('holding');
    node.classList.add('done');
    text.textContent = t.forum.verbs.replaced;
    audio.play('click');
    window.setTimeout(done, 300);
  };
  const begin = (): void => {
    if (timer || finished) return;
    node.classList.add('holding');
    text.textContent = t.forum.verbs.holding;
    timer = window.setInterval(tick, ms / steps);
  };
  node.addEventListener('pointerdown', begin);
  for (const event of ['pointerup', 'pointerleave', 'pointercancel', 'blur'] as const) node.addEventListener(event, stop);
  node.addEventListener('keydown', (event) => {
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      begin();
    }
  });
  node.addEventListener('keyup', stop);
  // A bare click (a tap, a screen reader, a script) does nothing: the hold is the confirmation; the hint blinks once.
  node.addEventListener('click', (event) => {
    event.preventDefault();
    hint.classList.remove('blink');
    void hint.offsetWidth;
    hint.classList.add('blink');
  });
  return node;
}

/**
 * A question with two answers (design v23, `.pd-confirm2`): a quiet cancel at the left sized to its word, the action at the right as a
 * verb; more answers under a rule, a whole row each (`options.extras`, the «don't ask again» of `never`). `onClose` runs on any answer first.
 */
export function showConfirm(
  title: string, text: string, yes: string, no: string, onYes: () => void, onClose: () => void,
  /** A third answer under the others: «don't ask again». */
  never?: { label: string; onPress: () => void },
  options: ConfirmOptions = {},
): void {
  const tone = options.calm ? 'primary' : 'danger';
  const doIt = (): void => {
    onClose();
    onYes();
  };
  const hint = options.hold ? el('p', { className: 'pd-hold-hint', textContent: t.forum.holdFor((options.hold / 1000).toFixed(1)) }) : null;
  // The hold button is the design's red primary (replacing a run is the window's one action); a plain answer is red only if it is a danger.
  const answer = hint ? holdButton(yes, options.hold!, doIt, 'primary', hint) : button(yes, doIt, tone);
  const extras: ConfirmExtra[] = [...(options.extras ?? []), ...(never ? [{ ...never, then: true }] : [])];
  show(
    windowOf(
      { narrow: true, className: 'pd-confirm2' },
      el('h2', { className: 'pd-heading center', textContent: title }),
      info(text, 'pd-info center'),
      el('div', { className: 'pd-confirm-row' }, button(no, onClose, 'quiet'), answer),
      hint,
      extras.length > 0 && el(
        'div',
        { className: 'pd-confirm-more' },
        ...extras.map((extra) => button(extra.label, () => {
          onClose();
          extra.onPress();
          if (extra.then) onYes();
        })),
      ),
    ),
    onClose,
  );
}

/**
 * Mis-tap protection's question (design v22, MisclickConfirm): the narrow window of the chasm's question with a picture on top (the trap on
 * its tile, or the flame), what it will do in a line, and «Don't ask again»; ticked, it says where the settings bring the question back.
 * «Step» goes on (and, ticked, turns the question off for good); «No» stays put.
 */
export function showDangerConfirm(
  danger: 'trap' | 'fire', what: { name?: string; text: string }, onStep: () => void, onNever: () => void, onClose: () => void,
): void {
  const V = t.v22;
  const art = danger === 'trap' ? el('i', { className: 'pd-confirm-ico trap' }) : el('i', { className: 'pd-tbuff2 large' });
  if (danger === 'fire') {
    // large_buffs.png, frame 2: burning.
    art.style.setProperty('--ix', '2');
    art.style.setProperty('--iy', '0');
  }
  let ticked = false;
  const note = el('small', { textContent: V.dontAskNote });
  note.hidden = true;
  const check = el('button', { className: 'pd-check small', type: 'button' }, el('i'), el('span', {}, el('b', { textContent: V.dontAsk }), note));
  check.setAttribute('role', 'checkbox');
  check.setAttribute('aria-checked', 'false');
  check.onclick = () => {
    audio.play('click');
    ticked = !ticked;
    check.setAttribute('aria-checked', String(ticked));
    note.hidden = !ticked;
  };
  const text = el('p', { className: 'pd-info center' });
  if (what.name) text.append(el('b', { textContent: `${what.name}.` }), ' ');
  text.append(what.text);
  show(
    windowOf(
      { narrow: true, className: 'pd-confirm' },
      el('div', { className: 'pd-confirm-art' }, art),
      el('h2', { className: 'pd-heading center', textContent: danger === 'trap' ? V.trapQ : V.fireQ }),
      text,
      check,
      el(
        'div',
        { className: 'pd-row' },
        button(V.stay, onClose, 'quiet'),
        button(V.step, () => {
          onClose();
          if (ticked) onNever();
          onStep();
        }, 'primary'),
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
  { sprite: 'tool-search2', w: 12, h: 12, line: 4 },
  { sprite: 'tool-wait2', w: 12, h: 12, line: 5 },
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
  /** What that cause means, and what the pack held (deathcopy.ts): a line each, under the cause. */
  notes?: readonly string[];
  /** How the run counted — «counts», «repeat», «own seed» — and what that means for the boards (labels.ts). */
  label?: ReturnType<typeof labelWords>;
  hero: { name: string; heroClass: HeroClass; lvl: number; depth: number; gold: number; kills: number };
  onRestart: () => void;
  restartLabel: string;
  onExit: () => void;
  /** The run's place among this device's best, if it made the table. */
  place?: number | null;
  /** The run's score. */
  score: number;
  /** Where it comes from (score.ts), shown as the score table instead of the one line. */
  breakdown?: ScoreBreakdown;
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
    ...(options.breakdown ? [] : [[t.scoreLabel, options.score.toLocaleString(locale), 'ally'] as const]),
  ];
  show(
    el(
      'section',
      { className: `pd-window pd-runend${options.victory ? ' win' : ''}` },
      // Everything above the buttons scrolls on a short screen (the score table makes this window taller than a phone),
      // so «Again», «Boards» and «Menu» always stay in reach.
      el(
        'div',
        { className: 'pd-scroll' },
        el('h2', { className: 'pd-display', textContent: options.title }),
        // Under the title: how the run counted, as a chip with its meaning beside it (design v23, RunTags).
        options.label && el('div', { className: 'pd-runtag-line' }, runTag(options.label), el('span', { textContent: options.label.note })),
        options.cause && el('p', { className: 'pd-cause', textContent: options.cause }),
        ...(options.notes ?? []).filter(Boolean).map((note) => el('p', { className: 'pd-info center pd-note', textContent: note })),
        options.place && !options.ranking ? el('p', { className: 'pd-info center pd-gold', textContent: options.place === 1 ? t.newRecord : t.rankPlace(options.place) }) : null,
        el(
          'div',
          { className: 'pd-runend-hero' },
          el('div', { className: 'pd-avatar' }, avatar),
          el('div', { className: 'pd-info', textContent: `${hero.name} · ${t.classes[hero.heroClass]}` }),
        ),
        stats(rows),
        options.breakdown ? scoreTable(options.breakdown) : null,
        options.ranking,
      ),
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

/** Scrolls read on one thing the player picks, and nothing more to choose (so one can be dropped on its target). */
const TARGETED_SCROLLS = ['scroll.upgrade', 'scroll.identify', 'scroll.removeCurse', 'scroll.transmutation'] as const;

/** The selector's title for what an item is used on (WndBag's prompt). */
function pickTitleOf(kind: ItemKind): string {
  switch (kind) {
    case 'scroll.upgrade': return t.alch.upgradeTitle;
    case 'scroll.enchantment': return t.alch.enchantTitle;
    case 'scroll.identify': return t.alch.identifyTitle;
    case 'scroll.removeCurse': return t.alch.removeCurseTitle;
    case 'scroll.transmutation': return t.alch.transmuteTitle;
    case 'stone.augmentation': return t.alch.augmentTitle;
    case 'stone.enchantment': return t.alch.enchantStoneTitle;
    case 'stone.detectMagic': return t.alch.detectTitle;
    case 'stone.intuition': return t.alch.intuitionTitle;
    default: return t.chooseTarget;
  }
}

/* Backpack */

export interface BackpackOptions {
  world: World;
  hero: Hero;
  onAction(action: Action): void;
  /** Throw, zap or shoot the item at a cell the player picks next (or cast it there: a spell, dragon's breath, a siren's song). */
  onAim(index: number, kind: 'throw' | 'zap' | 'shoot' | 'special' | 'cast' | 'key', choice?: number): void;
  /** An action of the classes (a spell, a weapon's ability) aimed at a cell the player picks next. */
  onAimClass?(prompt: string, make: (cell: number) => Action): void;
  /** A Duelist's weapon ability, from the weapon's own window (MeleeWeapon.AC_ABILITY). */
  onWeaponAbility?(which: 'weapon' | 'second'): void;
  /** An artifact's use aimed at a cell the player picks next (talisman, chains, rose, armband, sandals, beacon). */
  onAimArtifact?(action: ArtifactAction): void;
  onClose(): void;
  /**
   * WndBag's selector: the backpack with only what a scroll can be read on to tap (worn
   * things too); the rest dimmed. A tap reads the scroll on it.
   */
  pick?: { title: string; targets: readonly ItemRef[]; onPick(ref: ItemRef): void; onCancel(): void };
}

/** What is chosen in the backpack: an item in the pack (by slot) or one worn. */
type BagChoice = { index: number } | { worn: 'weapon' | 'armor' } | { slot: MiscSlot };

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

/**
 * The window that is open now, as far as it can be put back (the forum study's U4): the backpack with its choice and
 * filter, or a target being picked (the item and the button of its panel that asked) — a pending pick is never lost to a
 * turn of the phone, a reload of the Mini App or a window that went away. A question asked in the middle of either
 * (put on? upgrade?) is part of it. Null: no such window.
 */
export type WindowState =
  | { w: 'bag'; choice: BagChoice | null; filter: BagFilter }
  | { w: 'pick'; index: number; button: number };

/** The item panel's last pressed button, and the one that opened the pick now. */
let lastUse: { index: number; button: number } | null = null;
let pickOrigin: { index: number; button: number } | null = null;

export function windowState(): WindowState | null {
  if (!overlayOpen()) return null;
  if (root.querySelector('.pd-window.bag.targeting')) return pickOrigin && pickOrigin.button >= 0 ? { w: 'pick', ...pickOrigin } : null;
  if (root.querySelector('.pd-window.bag') && openBag) return { w: 'bag', choice: openBag.choice, filter: openBag.filter };
  return null;
}

/** Puts a window back as it was (windowState); false if the item it is about is not what it was. */
export function reopenWindow(state: WindowState, options: BackpackOptions, kind?: ItemKind): boolean {
  if (state.w === 'pick') {
    const item = options.hero.items[state.index];
    if (!item || (kind && item.kind !== kind)) return false;
    showBackpack(options, { index: state.index });
    const { main, more } = itemActions({ ...options, item, index: state.index });
    const node = [...main, ...more][state.button];
    if (node instanceof HTMLButtonElement) node.click();
    return true;
  }
  if (state.choice && !chosenItem(options.hero, state.choice)) state = { ...state, choice: null };
  showBackpack(options, state.choice);
  if (openBag && state.filter !== 'all') {
    openBag.filter = state.filter;
    showBackpack(options, state.choice);
  }
  return true;
}

/** The item a choice points at, if it is still there. */
function chosenItem(hero: Hero, choice: BagChoice | null): Item | undefined {
  if (!choice) return undefined;
  if ('index' in choice) return hero.items[choice.index];
  if ('slot' in choice) return hero[choice.slot] ?? undefined;
  return choice.worn === 'weapon' ? hero.weapon ?? undefined : hero.armor;
}

/** Whether an item passes a filter: «gear» is weapons, armour, rings, wands and thrown weapons. */
function passes(filter: BagFilter, item: Item): boolean {
  const category = itemDef(item.kind).category;
  if (filter === 'potions') return category === 'potion';
  if (filter === 'scrolls') return category === 'scroll';
  if (filter === 'gear') return ['weapon', 'armor', 'ring', 'artifact', 'wand', 'missile'].includes(category);
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
      const ref: ItemRef = 'index' in next ? next.index : 'slot' in next ? next.slot : next.worn;
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
      if ('index' in here || 'slot' in here || ('worn' in here && here.worn === 'weapon')) node.dataset.from = JSON.stringify(here);
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
      : withDrop(slot(world, undefined, { hero, equipped: true, placeholder, misc: ref === 'misc' || ref === 'artifact' || ref === 'ring' }), String(ref));
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
    // Belongings: the artifact, misc and ring slots (KindofMisc).
    worn(hero.artifact ?? undefined, S.ARTIFACT_HOLDER, 'artifact', { slot: 'artifact' }),
    worn(hero.misc ?? undefined, S.SOMETHING, 'misc', { slot: 'misc' }),
    worn(hero.ring ?? undefined, S.RING_HOLDER, 'ring', { slot: 'ring' }),
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
    if ('slot' in from) {
      drops.set('pack', { type: 'remove', slot: from.slot });
      hero.items.forEach((_, i) => drops.set(String(i), { type: 'remove', slot: from.slot }));
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
    if (category === 'ring' || category === 'artifact') {
      // KindofMisc: onto a slot that is taken, it takes that one's place (where its kind may go).
      const choices = miscChoices(hero, item);
      for (const slot of ['artifact', 'misc', 'ring'] as const) {
        const fits = category === 'ring' ? slot !== 'artifact' : slot !== 'ring';
        if (choices.length === 0 ? fits : choices.includes(slot)) drops.set(slot, { type: 'equip', item: index, ...(choices.length > 0 ? { replace: slot } : {}) });
      }
    }
    if (category === 'scroll' && isKnown(world, item) && (TARGETED_SCROLLS as readonly string[]).includes(item.kind)) {
      for (const ref of scrollTargets(world, hero, item.kind)) drops.set(String(ref), { type: 'use', item: index, on: ref });
    }
    if (item.kind !== 'quest.dust') drops.set('away', { type: 'drop', item: index });
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
    const back = (): void => showBackpack(options);
    if (action.type === 'use') {
      // Reading a scroll: asked first, then the dungeon answers and the backpack closes.
      const kind = options.hero.items[action.item]?.kind;
      const go = (): void => {
        openBag = null;
        options.onAction(action);
        options.onClose();
      };
      if (kind && action.on !== undefined) askTarget(options, kind, action.on, go, back);
      else go();
      return;
    }
    const done = (): void => {
      if (openBag) openBag.choice = null;
      options.onAction(action);
      refreshBackpack(options.world, options.hero);
    };
    const moved = action.type === 'equip' ? options.hero.items[action.item] : undefined;
    if (moved) askEquip(options, moved, done, back);
    else done();
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
function where(choice: BagChoice): { index: number | null; slot?: MiscSlot } {
  return 'index' in choice ? { index: choice.index } : 'slot' in choice ? { index: null, slot: choice.slot } : { index: null };
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
  /** For a worn ring or artifact: its slot. */
  slot?: MiscSlot;
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
    ...(itemDef(item.kind).category === 'artifact' ? artifactCard(world, hero, item) : []),
    ...(isClassArmor(item) ? classArmorCard(world, hero, item) : []),
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

/** A quick slot's tap: the item's first action, as holding it in the backpack would do. */
export function quickAction(options: BackpackOptions, index: number): void {
  const item = options.hero.items[index];
  if (item) firstAction({ ...options, item, index });
}

/** Holding an item: its first action, done. */
function firstAction(options: ItemOptions): void {
  const first = itemActions(options).main[0];
  if (first instanceof HTMLButtonElement) first.click();
}

/**
 * Putting on what is not known not to be cursed asks first (riskyuse.ts, the forum study's U1): about three in ten are,
 * and a cursed thing will not come off. `go` puts it on; `back` is where a no returns to.
 */
function askEquip(options: BackpackOptions, item: Item, go: () => void, back: () => void): void {
  if (!confirmRisky.on || !equipRisk(item)) {
    go();
    return;
  }
  const F = t.forum.ask;
  openBag = null;
  showConfirm(
    F.putOnTitle(itemName(options.world, item)), F.putOnText(t.items['stone.detectMagic'], t.items['scroll.removeCurse']), F.putOn, F.cancel, go, back,
    { label: F.putOnNever, onPress: () => confirmRisky.set(false) }, { calm: true },
  );
}

/**
 * «Upgrade X?» before a scroll, stone or spell does for good what it does to the item picked (the forum study's U3): the
 * scroll stays in the pack until the answer is yes. Nothing is sent to the dungeon before it, so a cancel (or a window
 * lost to a turn of the phone) spends nothing: the core takes a scroll only with the action that reads it.
 * `again` is where a no returns to; `magic` names the enchantment already chosen.
 */
function askTarget(options: BackpackOptions, kind: ItemKind, on: ItemRef, go: () => void, again: () => void, magic = ''): void {
  const { world, hero } = options;
  const effect = targetEffect(kind);
  const target = itemAt(hero, on);
  if (!effect || !target) {
    go();
    return;
  }
  const F = t.forum.target;
  const name = itemName(world, target);
  openBag = null;
  const loss = effect === 'upgrade' ? enchantLossChance(target) : 0;
  const [title, text, yes] = {
    upgrade: [F.upgradeTitle(name), F.upgradeText + (loss > 0 ? F.upgradeLoss(loss) : ''), F.upgrade],
    enchant: [F.enchantTitle(name), magic ? F.enchantText(magic) : F.enchantPlain, F.enchant],
    transmute: [F.transmuteTitle(name), F.transmuteText, F.transmute],
    curse: [F.curseTitle(name), F.curseText, F.curse],
  }[effect];
  showConfirm(title, text, yes, t.forum.ask.cancel, go, again, undefined, { calm: true });
}

/** The old item window, kept for what still opens an item on its own: now the backpack with it chosen. */
function showItem(options: ItemOptions): void {
  const choice: BagChoice = options.index !== null ? { index: options.index } : options.slot !== undefined ? { slot: options.slot } : { worn: options.item === options.hero.armor ? 'armor' : 'weapon' };
  showBackpack(options, choice);
}

/**
 * What can be done with an item, as the design lays out actions: the first red, the rest
 * stone, dropping last. `act` closes the backpack (the dungeon answers); `stay` keeps it open.
 */
/**
 * EscapeCrystal.execute: out of the vault, with one of the hero's things kept (worn or in the pack) when
 * the heist went well enough to keep anything (WndBag of what may come along); otherwise straight out.
 */
function escapeVault(options: ItemOptions, act: (action: Action) => void): void {
  const { world, hero } = options;
  const score = escapeScore(world, hero);
  const refs: ItemRef[] = [...hero.items.map((_, i) => i), 'weapon', 'armor', 'artifact', 'misc', 'ring'];
  const targets = score < 500 ? [] : refs.filter((ref) => { const item = itemAt(hero, ref); return item !== undefined && keepable(item, score); });
  if (targets.length === 0) {
    act({ type: 'vault', op: 'escape' });
    return;
  }
  showBackpack({
    ...options,
    pick: {
      title: plain(lt('items.quest.escapecrystal.prompt')),
      targets,
      onPick: (keep) => act({ type: 'vault', op: 'escape', keep }),
      onCancel: () => act({ type: 'vault', op: 'escape' }),
    },
  });
}

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
  const aimWith = (kind: 'throw' | 'zap' | 'shoot' | 'special' | 'cast' | 'key', at: number): void => {
    openBag = null;
    options.onClose();
    options.onAim(at, kind);
  };
  const main: HTMLElement[] = [];
  const more: HTMLElement[] = [];
  const danger: HTMLElement[] = [];
  const use = (label: string, onClick: () => void, icon?: 'steal'): void => {
    // Which button of the item's panel was pressed, for a window that must come back (windowState).
    const node: HTMLButtonElement = button(label, () => {
      lastUse = options.index === null ? null : { index: options.index, button: [...main, ...more].indexOf(node) };
      onClick();
    }, main.length === 0 ? 'primary' : '');
    // The thieves' armband's «Steal» wears its picture (design v19: icon-steal.png).
    if (icon) node.prepend(el('i', { className: `pd-${icon}` }));
    (main.length === 0 ? main : more).push(node);
  };
  if (index !== null) {
    const known = isKnown(world, item);
    const back = (): void => showBackpack(options, { index });
    /** WndBag's selector for what an item acts on, then what follows. */
    const pickThen = (title: string, targets: readonly ItemRef[], then: (on: ItemRef) => void): void => {
      pickOrigin = lastUse;
      openBag = null;
      showBackpack({ ...options, pick: { title, targets, onPick: then, onCancel: back } });
    };
    const pickFor = (kind: ItemKind, title: string, then: (on: ItemRef) => void): void => pickThen(title, scrollTargets(world, hero, kind), then);
    const choose = (title: string, text: string, on: Item | null, choices: readonly ChoiceOption[]): void => {
      openBag = null;
      showChoice(world, title, text, on, choices, back);
    };
    /** The pick of a target, then «Upgrade X?» (askTarget): a no goes back to the pick; the scroll is spent by the yes alone. */
    const pickSure = (kind: ItemKind, title: string, then: (on: ItemRef) => void): void =>
      pickFor(kind, title, (on) => askTarget(options, item.kind, on, () => then(on), () => pickSure(kind, title, then)));
    if (category === 'potion' || category === 'brew' || category === 'elixir') {
      // Potion.actions: known harmful potions (and brews) are thrown first; drinking one asks first.
      const mustThrow = category === 'brew' ? item.kind !== 'brew.unstable' : known && MUST_THROW.has(item.kind);
      const drink = (): void => {
        if (known && item.kind === 'potion.dragonsBreath') return aimWith('cast', index);
        if (known && item.kind === 'potion.mastery') return pickFor('potion.mastery', t.alch.masteryPrompt, (on) => act({ type: 'use', item: index, on }));
        if (known && item.kind === 'potion.divineInspiration') {
          // PotionOfDivineInspiration: a talent tier to boost, one not boosted yet.
          const boosted = hero.buffs?.inspired ?? [];
          return choose(t.items[item.kind], t.alch.selectTier, item, [1, 2, 3, 4].map((tier) => ({
            label: fill(t.alch.tier1, tier), disabled: boosted.includes(tier), onPick: () => act({ type: 'use', item: index, choice: tier }),
          })));
        }
        act({ type: 'use', item: index });
      };
      const throwIt = (): void => aimWith('throw', index);
      // An unknown potion with an enemy in sight asks first (riskyuse.ts): drink, cancel, or throw it instead.
      const drinkAsked = (): void => {
        if (!confirmRisky.on || !drinkRisk(world, hero, item)) return drink();
        const F = t.forum.ask;
        openBag = null;
        showConfirm(
          F.drinkTitle(itemName(world, item)), F.drinkText, F.drink, F.cancel, drink, back,
          { label: F.drinkNever, onPress: () => confirmRisky.set(false) }, { calm: true, extras: [{ label: F.throwInstead, onPress: throwIt }] },
        );
      };
      if (mustThrow) {
        use(t.throwItem, throwIt);
        if (category === 'potion') {
          more.push(button(t.drink, () => {
            openBag = null;
            showConfirm(t.alch.harmful, t.alch.sureDrink, t.drink, t.cancel, drink, back);
          }));
        }
      } else {
        use(t.drink, drinkAsked);
        // A known potion that is better drunk asks before it is thrown away (Potion.doThrow's beneficial warning).
        const beneficial = known && category !== 'brew' && !CAN_THROW.has(item.kind);
        use(t.throwItem, beneficial ? () => {
          openBag = null;
          showConfirm(t.alch.beneficial, t.alch.sureThrow, t.throwItem, t.cancel, throwIt, back);
        } : throwIt);
      }
    }
    if (category === 'food' || item.kind === 'quest.fish') use(t.eat, () => act({ type: 'use', item: index }));
    // Ankh.AC_BLESS: with the waterskin full.
    if (item.kind === 'ankh' && !item.blessed && hero.items.some((other) => other.kind === 'waterskin' && (other.volume ?? 0) >= 20)) {
      use(t.ankh.bless, () => act({ type: 'ankhBless', item: index }));
    }
    if (category === 'torch') use(t.light, () => act({ type: 'use', item: index }));
    if (category === 'tome') {
      // TengusMask.AC_WEAR: the choice of a way (talentui.ts); the old Tome of Mastery too.
      use(item.kind === 'mask.tengu' ? capitalize(tal('items.tengusmask.ac_wear').toLowerCase()) || t.readTome : t.readTome, () => {
        openBag = null;
        showSubclassPick({ world, hero, act: (action) => options.onAction(action), onClose: options.onClose }, index, () => showBackpack(options));
      });
    }
    if (item.kind === 'quest.amulet') {
      use(t.amuletEndGame, () => {
        openBag = null;
        showAmulet(world, hero, false, () => options.onAction({ type: 'endGame' }), options.onClose);
      });
    }
    // KingsCrown.AC_WEAR: the pick of an armour ability for the armour worn.
    if (category === 'kit') use(actionLabel(t.wearCrown), () => {
      openBag = null;
      showAbilityPick(abilityHost(options, () => showBackpack(options, { index })), index);
    });
    if (category === 'seed') use(t.plantSeed, () => aimWith('throw', index));
    if (category === 'scroll') {
      // A known scroll that acts on one thing asks which, from the whole pack and what is worn (WndBag's selector).
      if (known && isTargetedScroll(item.kind)) {
        use(t.readOn, () => pickFor(item.kind, pickTitleOf(item.kind), (on) => {
          const target = itemAt(hero, on);
          // ScrollOfEnchantment: then one of three enchantments (WndEnchantSelect), and the question once one is chosen.
          if (item.kind === 'scroll.enchantment' && target) {
            const armor = itemDef(target.kind).category === 'armor';
            const name = plainName(world, { ...target, enchant: undefined, glyph: undefined });
            return choose(t.alch.enchantTitle, '', target, enchantOptions(world, hero, target).map((magic, choice) => {
              const label = capitalize(armor ? t.glyphName(name, magic as never) : t.enchantName(name, magic as never, target.kind));
              return { label, onPick: () => askTarget(options, item.kind, on, () => act({ type: 'use', item: index, on, choice }), back, label) };
            }));
          }
          askTarget(options, item.kind, on, () => act({ type: 'use', item: index, on }), () => showBackpack(options, { index }));
        }));
      } else if (known && item.kind === 'scroll.sirensSong') {
        use(t.read, () => aimWith('cast', index));
      } else if (known && item.kind === 'scroll.metamorphosis') {
        // ScrollOfMetamorphosis: a talent to change, then one of those offered for it (talentui.ts).
        use(t.read, () => {
          openBag = null;
          showMetamorphosis({ world, hero, act: (action) => options.onAction(action), onClose: options.onClose }, index, back);
        });
      } else {
        use(t.read, () => act({ type: 'use', item: index }));
      }
    }
    if (category === 'stone') {
      if (INVENTORY_STONES.has(item.kind)) {
        use(t.alchUi.use, () => pickSure(item.kind, pickTitleOf(item.kind), (on) => {
          const target = itemAt(hero, on);
          if (!target) return;
          if (item.kind === 'stone.augmentation') {
            // StoneOfAugmentation.WndAugment: one property against the other, or none (the numbers before and after).
            openBag = null;
            return showAugmentStone(options, index, on, target, act);
          }
          if (item.kind === 'stone.intuition') {
            // StoneOfIntuition.WndGuess: what kind it might be.
            return choose(t.alch.intuitionTitle, t.alch.guessText, target, intuitionChoices(world, target).map((kind, choice) => ({
              label: capitalize(t.items[kind]), sprite: guessSprite(itemDef(kind).category), onPick: () => act({ type: 'use', item: index, on, choice }),
            })));
          }
          act({ type: 'use', item: index, on });
        }));
      }
      use(t.throwItem, () => aimWith('throw', index));
    }
    if (category === 'spell') {
      if (TARGETED_SPELLS.has(item.kind)) {
        use(t.alchUi.cast, () => aimWith('cast', index));
      } else if (item.kind === 'spell.alchemize') {
        use(t.alchUi.cast, () => pickFor(item.kind, t.alch.alchemizePrompt, (on) => {
          const target = itemAt(hero, on);
          if (!target) return;
          // WndAlchemizeItem: sell or energize, one or all.
          const knownKind = knownIn(world.known, target.kind);
          const price = itemPrice({ ...target, qty: 1 }, knownKind);
          const energy = energyValue({ ...target, qty: 1 }, knownKind);
          const worn = heroEquipped(hero).includes(target);
          const labels: Record<(typeof ALCHEMIZE_CHOICES)[number], string> = {
            sellOne: fill(target.qty > 1 ? t.alch.sell1 : t.alch.sellIt, price), sellAll: fill(t.alch.sellAll, price * target.qty),
            energizeOne: fill(target.qty > 1 ? t.alch.energizeOne : t.alch.energizeIt, energy), energizeAll: fill(t.alch.energizeAll, energy * target.qty),
          };
          const shown = ALCHEMIZE_CHOICES.map((what, choice) => ({ what, choice })).filter(({ what }) =>
            (what.startsWith('sell') ? price > 0 && !worn : energy > 0) && (what.endsWith('All') ? target.qty > 1 : true));
          choose(t.alch.alchemizePrompt, '', target, shown.map(({ what, choice }) => ({ label: labels[what], onPick: () => act({ type: 'use', item: index, on, choice }) })));
        }));
      } else if (item.kind === 'spell.beacon') {
        // BeaconOfReturning: set it here, or go back to where it was set.
        use(t.alchUi.cast, () => choose(t.items[item.kind], t.alch.beaconBody, item, [
          { label: t.alch.beaconWndSet, onPick: () => act({ type: 'use', item: index, choice: 0 }) },
          { label: t.alch.beaconWndReturn, disabled: !hero.buffs?.beacon, onPick: () => act({ type: 'use', item: index, choice: 1 }) },
        ]));
      } else if (isTargetedScroll(item.kind)) {
        const title = item.kind === 'spell.recycle' ? t.alch.recycleTitle : item.kind === 'spell.curseInfusion' ? t.alch.curseInfusionTitle : t.alch.infuseTitle;
        use(t.alchUi.cast, () => pickSure(item.kind, title, (on) => act({ type: 'use', item: index, on })));
      } else {
        use(t.alchUi.cast, () => act({ type: 'use', item: index }));
      }
      if (item.kind === 'spell.summonElemental') {
        // SummonElemental: imbued with a known potion of liquid flame or frost, or scroll of recharging or transmutation.
        const imbues: readonly ItemKind[] = ['potion.liquidFlame', 'potion.frost', 'scroll.recharging', 'scroll.transmutation'];
        const targets = hero.items.flatMap((other, i) => (imbues.includes(other.kind) && isIdentified(world, other) ? [i] : []));
        if (targets.length > 0) use(t.alchUi.imbue, () => pickThen(t.alch.imbuePrompt, targets, (on) => act({ type: 'use', item: index, on })));
      }
    }
    if (category === 'catalyst' && item.rolled) {
      // TrinketCatalyst.WndTrinket: three trinkets shown, the fourth a surprise.
      const rolled = item.rolled;
      use(t.alchUi.choose, () => choose(t.alch.chooseTrinket, t.alch.catalystText, item, rolled.map((kind, choice) => ({
        label: choice < 3 ? capitalize(t.items[kind]) : capitalize(t.alch.catalystRandom),
        sprite: choice < 3 ? itemSprite({ kind, qty: 1, level: 0 }, world.run.labels) : S.TRINKET_HOLDER,
        onPick: () => act({ type: 'use', item: index, choice }),
      }))));
    }
    if (item.kind === 'resin') use(t.alchUi.use, () => pickFor('resin', t.alch.resinTitle, (on) => act({ type: 'use', item: index, on })));
    // LiquidMetal: a thrown weapon (no dart) to mend.
    if (item.kind === 'liquidMetal') use(t.alchUi.use, () => pickFor('liquidMetal', t.alch.metalTitle, (on) => act({ type: 'use', item: index, on })));
    // MagesStaff.actions: zap (its default) and imbue, wherever the staff is.
    if (item.kind === 'weapon.magesStaff') {
      if (item.wand) use(t.zap, () => aimWith('zap', index));
      use(t.staffImbue, () => pickWandToImbue(options, index, act));
    }
    if (category === 'ring' || category === 'artifact') {
      // KindofMisc.doEquip: every slot taken, the player says which to take off for it.
      use(t.putOn, () => askEquip(options, item, () => {
        const choices = miscChoices(hero, item);
        if (choices.length === 0) {
          stay({ type: 'equip', item: index }, null);
          return;
        }
        showMiscChooser(world, hero, item, choices, (replace) => {
          showBackpack(options);
          stay({ type: 'equip', item: index, replace }, null);
        }, () => showBackpack(options, { index }));
      }, back));
    }
    if (category === 'weapon' || category === 'armor') {
      const worn: BagChoice = { worn: category === 'armor' ? 'armor' : 'weapon' };
      use(t.equip, () => askEquip(options, item, () => {
        stay({ type: 'equip', item: index }, worn);
        if (category === 'armor') offerSealTransfer(options, index);
      }, back));
    }
    // ClassArmor.actions from the pack: the crown's magic can be moved to another armour (the ability wants it worn).
    if (isClassArmor(item) && item.kind === CLASS_ARMOR_OF[hero.heroClass]) {
      if (hero.ability) more.push(button(AT.talentsShort, () => {
        openBag = null;
        showTalents(abilityHost(options, () => showBackpack(options, { index })));
      }));
      more.push(button(actionLabel(artText('items.armor.classarmor.ac_transfer')), () => transferWindow(options, index, () => showBackpack(options, { index }))));
    }
    // Artifact.actions, from the pack (the beacon's set and return, the rose's outfit; the rest want it worn).
    if (category === 'artifact') for (const action of artifactActions(artifactHost(options, index), item, index)) use(action.label, action.run, action.icon);
    // Armor.AC_DETACH: the warrior's seal off an armour in the pack.
    if (item.seal) more.push(button(t.hero.detach, () => stay({ type: 'detach', armor: index }, null)));
    // SpiritBow.AC_SHOOT; Dart.AC_TIP; TippedDart.AC_CLEAN.
    if (category === 'bow') use(actionLabel(t.gear.shoot), () => aimWith('shoot', index));
    if (item.kind === 'missile.dart' && tippingSeeds(hero).length > 0) use(actionLabel(t.gear.tip), () => showTip(options, index, act));
    if (isTippedDart(item.kind)) use(actionLabel(t.gear.clean), () => showClean(options, index, act));
    if (category === 'wipeout') use(t.read, () => act({ type: 'use', item: index }));
    // EscapeCrystal.AC_USE: out of the vault, with one thing kept as the heist allows (its item selector).
    if (item.kind === 'quest.escapeCrystal') use(lt('items.quest.escapecrystal.ac_use'), () => escapeVault(options, act));
    // VaultBeacon: back to the vault's entry.
    if (item.kind === 'quest.vaultBeacon') use(t.beaconReturn, () => act({ type: 'vault', op: 'beacon', item: index }));
    // SkeletonKey.AC_INSERT: at a door, a chest or a wall cell (SkeletonKey.targeter).
    if (item.kind === 'artifact.skeletonKey') use(lt('items.artifacts.skeletonkey.ac_insert'), () => aimWith('key', index));
    if (category === 'vial' && item.volume) use(t.drink, () => act({ type: 'use', item: index }));
    // BrokenSeal.AC_AFFIX: onto an armour, worn or in the pack (WndBag's armour selector).
    if (category === 'seal') use(t.hero.affix, () => pickArmorForSeal(options, index, stay));
    if (category === 'missile' || category === 'wand' || category === 'bomb' || category === 'honeypot') {
      const kind = category === 'wand' ? 'zap' : 'throw';
      use(category === 'bomb' && !item.fuse ? t.alchUi.lightThrow : kind === 'throw' ? t.throwItem : t.zap, () => aimWith(kind, index));
    }
    if (category === 'honeypot') use(t.shatterPot, () => act({ type: 'use', item: index }));
    // Item.AC_THROW: anything in the pack can be thrown where the player taps (a bag would scatter what it holds).
    // (CorpseDust has no actions at all: not even throwing or dropping it.)
    if (!['bag', 'missile', 'bomb', 'honeypot', 'potion', 'seed', 'stone', 'brew', 'elixir'].includes(category) && item.kind !== 'quest.dust') use(t.throwItem, () => aimWith('throw', index));
    // QuickSlot: any item with a use can be kept one tap away: into the first free slot (or one whose item
    // ran out), else the first. Holding a slot on the toolbar chooses for that slot (Toolbar's quickslot_assign).
    if (quickUse(item.kind) && !isQuickslotted(item.kind)) more.push(quickslotButton(world, hero, item));
    danger.push(button(t.dropItem, () => stay({ type: 'drop', item: index }), 'danger'));
  } else if (options.slot !== undefined) {
    const slot = options.slot;
    // Artifact.actions on a worn artifact, then taking it off.
    if (itemDef(item.kind).category === 'artifact') {
      for (const action of artifactActions(artifactHost(options, slot), item, slot)) use(action.label, action.run, action.icon);
      // Shattered's quick slots hold a worn artifact too (the rogue's cloak starts in one).
      if (!isQuickslotted(item.kind)) more.push(quickslotButton(world, hero, item));
    }
    use(t.takeOff, () => stay({ type: 'remove', slot }));
  } else if (item === hero.weapon) {
    if (item.kind === 'weapon.magesStaff') {
      if (item.wand) use(t.zap, () => aimWith('zap', WEAPON_SLOT));
      use(t.staffImbue, () => pickWandToImbue(options, 'weapon', act));
      // QuickSlot: the staff in hand can be kept one tap away too.
      if (!isQuickslotted(item.kind)) more.push(button(t.quickslotShort, () => {
        const free = Array.from({ length: QUICKSLOTS }, (_, i) => i).find((i) => {
          const kind = quickKind(i);
          return kind === null || (!hero.items.some((other) => other.kind === kind) && hero.weapon?.kind !== kind);
        });
        chooseQuickslot(item.kind, free ?? 0);
        refreshBackpack(world, hero);
      }));
    }
    // MeleeWeapon.AC_ABILITY: a Duelist's weapon has an ability of its own.
    if (hero.heroClass === 'duelist' && hasAbility(item)) {
      use(actionLabel(artText('items.weapon.melee.meleeweapon.ac_ability')), () => {
        openBag = null;
        options.onClose();
        options.onWeaponAbility?.('weapon');
      });
    }
    use(t.takeOff, () => stay({ type: 'unequip' }));
  } else if (item === hero.armor && item.kind === CLASS_ARMOR_OF[hero.heroClass]) {
    // ClassArmor.execute(AC_ABILITY): the ability of the armour (it wants a cell to aim at, or none, or the beacon's choice).
    if (hero.ability) {
      use(actionLabel(abilityLabel(hero.ability)), () => {
        openBag = null;
        startAbility({
          world, hero,
          send: (action) => {
            options.onAction(action);
            options.onClose();
          },
          aim: (prompt, choice) => {
            options.onClose();
            options.onAim(-1, 'special', choice);
            toast(prompt);
          },
          back: () => showBackpack(options, { worn: 'armor' }),
        });
      });
      more.push(button(AT.talentsShort, () => {
        openBag = null;
        showTalents(abilityHost(options, () => showBackpack(options, { worn: 'armor' })));
      }));
    }
    more.push(button(actionLabel(artText('items.armor.classarmor.ac_transfer')), () => transferWindow(options, 'armor', () => showBackpack(options, { worn: 'armor' }))));
    if (!isQuickslotted(item.kind)) more.push(quickslotButton(world, hero, item));
  }
  // Armor.AC_DETACH, on the armour worn.
  if (item === hero.armor && item.seal) more.push(button(t.hero.detach, () => stay({ type: 'detach', armor: 'armor' }, null)));
  return { main, more, danger };
}

/** What the armour ability windows are given (abilityui.ts): the world, the hero, how to act from them, where they come back to. */
function abilityHost(options: BackpackOptions, back: () => void): AbilityHost {
  return {
    world: options.world,
    hero: options.hero,
    act: (action) => {
      options.onAction(action);
      options.onClose();
    },
    stay: (action) => options.onAction(action),
    back,
  };
}

/** ClassArmor.AC_TRANSFER's WndOptions: the crown's magic moves to another armour, which is destroyed; which one is asked next. */
function transferWindow(options: BackpackOptions, to: SealSource, back: () => void): void {
  const { hero } = options;
  const targets = hero.items.flatMap((other, i) => (itemDef(other.kind).category === 'armor' && !isClassArmor(other) ? [i] : []));
  show(
    windowOf(
      { title: capitalize(artText('items.armor.classarmor.transfer_title')), icon: el('div', { className: 'pd-slot' }, itemIconAt(S.CROWN)), onClose: back, narrow: true },
      info(artText('items.armor.classarmor.transfer_desc')),
      targets.length > 0
        ? button(artText('items.armor.classarmor.transfer_prompt'), () => showBackpack({
          ...options,
          pick: {
            title: artText('items.armor.classarmor.transfer_prompt'),
            targets,
            onPick: (on) => {
              if (typeof on !== 'number') return;
              options.onAction({ type: 'transfer', to, from: on });
              options.onClose();
            },
            onCancel: back,
          },
        }), 'primary')
        : info(AT.noArmor, 'pd-note'),
      button(artText('items.armor.classarmor.transfer_cancel'), back, 'quiet'),
    ),
    back,
  );
}

/** Shattered's action names are in capitals (AC_SHOOT: «SHOOT»): as a button says them. */
const actionLabel = (label: string): string => capitalize(label.toLowerCase());

/** What a stone of augmentation can be used on (ScrollOfEnchantment.enchantable), worn first. */
function augmentTargets(hero: Hero): ItemRef[] {
  const refs: ItemRef[] = [...(hero.weapon ? ['weapon' as const] : []), 'armor', ...hero.items.map((_, i) => i)];
  return refs.filter((ref) => {
    const item = itemAt(hero, ref);
    return item !== undefined && isEnchantable(item);
  });
}

/** StoneOfAugmentation.WndAugment: what to enhance, at the cost of what; or to take the augment away. */
function showAugment(options: ItemOptions, stone: number, on: ItemRef, act: (action: Action) => void): void {
  const { world, hero } = options;
  const item = itemAt(hero, on)!;
  const back = (): void => showBackpack(options, { index: stone });
  const armour = itemDef(item.kind).category === 'armor';
  const choices: Array<Augment | 'none'> = armour ? ['evasion', 'defense', 'none'] : ['speed', 'damage', 'none'];
  const labels: Record<Augment | 'none', string> = {
    speed: t.gear.augmentSpeed, damage: t.gear.augmentDamage, evasion: t.gear.augmentEvasion, defense: t.gear.augmentDefense, none: t.gear.augmentNone,
  };
  const current = item.augment ?? 'none';
  show(
    windowOf(
      { title: capitalize(itemName(world, item)), icon: slot(world, item, { hero }), onClose: back },
      info(item.augment ? `${t.gear.augmentChoice}\n\n${t.gear.augmentAlready}` : t.gear.augmentChoice),
      actions(
        [],
        choices.filter((c) => c !== current).map((c) => button(labels[c], () => act({ type: 'augment', item: stone, on, augment: c }))),
      ),
    ),
    back,
  );
}

/** The picture beside a guess in a stone of intuition's window (design v19: ShIcons): the holder of what is guessed at. */
const guessSprite = (category: string): number | undefined =>
  category === 'potion' ? S.POTION_HOLDER : category === 'scroll' ? S.SCROLL_HOLDER : category === 'ring' ? S.RING_HOLDER : category === 'wand' ? S.WAND_HOLDER
  : category === 'stone' ? S.STONE_HOLDER : category === 'spell' ? S.SPELL_HOLDER : category === 'trinket' ? S.TRINKET_HOLDER : undefined;

/** Seeds in the pack that darts can be tipped with (TippedDart.types). */
const tippingSeeds = (hero: Hero): number[] =>
  hero.items.flatMap((item, i) => (itemDef(item.kind).category === 'seed' && TIPPED_DARTS[item.kind] ? [i] : []));

/** A Shattered item sprite (items.png) in the design system's markup (.pd-sitem, data-s). */
function sitem(sprite: number): HTMLElement {
  const icon = el('i', { className: 'pd-sitem' });
  icon.dataset.s = String(sprite);
  return icon;
}

/** A slot holding an item's picture, with a quantity if there are several. */
function plainSlot(world: World, item: Item, qty?: number): HTMLElement {
  const node = el('span', { className: 'pd-slot' }, sitem(itemSprite(item, world.run.labels)));
  if (qty !== undefined && qty > 1) node.append(el('span', { className: 'pd-qty', textContent: String(qty) }));
  return node;
}

/**
 * Dart.AC_TIP (design v19: ShWeapons): the seeds of the pack in a row with their numbers, the chosen one framed;
 * what it makes of the darts (two darts to a seed) and its effect; «tip 2» and «tip all».
 */
function showTip(options: ItemOptions, index: number, act: (action: Action) => void): void {
  const { world, hero } = options;
  const darts = hero.items[index]!;
  const back = (): void => showBackpack(options, { index });
  const seeds = tippingSeeds(hero);
  let chosen = seeds[0]!;
  const row = el('div', { className: 'pd-dart-seeds' });
  const preview = el('div', { className: 'pd-dart-preview' });
  const buttons = el('div', { className: 'pd-actions' });
  const draw = (): void => {
    const seed = hero.items[chosen]!;
    const tipped: Item = { kind: TIPPED_DARTS[seed.kind]!, qty: 1, level: 0 };
    const two = Math.min(darts.qty, 2);
    const most = Math.min(darts.qty, seed.qty * 2);
    row.querySelectorAll<HTMLElement>('.pd-slot').forEach((node) => node.classList.toggle('selected', node.dataset.seed === String(chosen)));
    preview.replaceChildren(
      plainSlot(world, tipped, two),
      el(
        'span',
        { className: 'pd-dart-text' },
        el('b', { textContent: `${capitalize(itemName(world, { ...seed, qty: 1 }))} → ${t.weaponsUi.tipResult(two, capitalize(itemName(world, tipped)))}` }),
        t.itemInfo[tipped.kind] ?? '',
      ),
    );
    const one = button(darts.qty === 1 ? t.gear.tipOne : t.gear.tipTwo, () => act({ type: 'tip', item: index, seed: chosen }), 'primary');
    const all = darts.qty > 2 && most > 2
      ? [button(fmt(t.gear.tipAll, most, Math.trunc((most + 1) / 2)), () => act({ type: 'tip', item: index, seed: chosen, all: true }))]
      : [];
    // Shattered's labels are long: they wrap rather than run out of the button.
    for (const choice of [one, ...all]) Object.assign(choice.style, { whiteSpace: 'normal', height: 'auto', minHeight: '36px', lineHeight: '20px' });
    buttons.replaceChildren(one, ...all);
  };
  for (const seedIndex of seeds) {
    const seed = hero.items[seedIndex]!;
    const node = el(
      'button',
      {
        className: 'pd-slot',
        ariaLabel: capitalize(itemName(world, { ...seed, qty: 1 })),
        onclick: () => {
          audio.play('click');
          chosen = seedIndex;
          draw();
        },
      },
      sitem(itemSprite(seed, world.run.labels)),
      el('span', { className: 'pd-qty', textContent: String(seed.qty) }),
    );
    node.dataset.seed = String(seedIndex);
    row.append(node);
  }
  draw();
  show(
    windowOf(
      { title: t.gear.tipTitle, sub: t.weaponsUi.tipSub, icon: slot(world, darts, { hero }), onClose: back },
      el('p', { className: 'pd-note', textContent: t.gear.tipPrompt }),
      row,
      preview,
      buttons,
    ),
    back,
  );
}

/** TippedDart.AC_CLEAN (design v19: ShWeapons): the tipped dart, an arrow, the plain dart; one, or the whole stack. */
function showClean(options: ItemOptions, index: number, act: (action: Action) => void): void {
  const { world, hero } = options;
  const darts = hero.items[index]!;
  const back = (): void => showBackpack(options, { index });
  const plain: Item = { kind: 'missile.dart', qty: 1, level: 0 };
  show(
    windowOf(
      { title: t.gear.cleanTitle, sub: `${capitalize(itemName(world, { ...darts, qty: 1 }))} ×${darts.qty}`, icon: slot(world, darts, { hero }), onClose: back, narrow: true },
      el('div', { className: 'pd-dart-clean' }, plainSlot(world, { ...darts, qty: 1 }), el('i', { className: 'pd-alch-arrow ready' }), plainSlot(world, plain)),
      info(t.gear.cleanDesc),
      actions(
        [],
        [
          button(t.gear.cleanOne, () => act({ type: 'clean', item: index })),
          ...(darts.qty > 1 ? [button(`${t.gear.cleanAll} (${darts.qty})`, () => act({ type: 'clean', item: index, all: true }))] : []),
          button(t.cancel, back, 'quiet'),
        ],
      ),
    ),
    back,
  );
}

/**
 * StoneOfAugmentation.WndAugment (design v19: ShWeapons): the item, and three ways to balance it with what each leaves
 * of its numbers: a gain in green, a cost in red, the present state marked «now».
 */
function showAugmentStone(options: ItemOptions, stone: number, on: ItemRef, target: Item, act: (action: Action) => void): void {
  const { world, hero } = options;
  const back = (): void => showBackpack(options, { index: stone });
  const armour = itemDef(target.kind).category === 'armor';
  const augments = augmentsFor(target);
  const current = target.augment ?? null;
  const names: Record<Augment | 'none', string> = {
    speed: t.weaponsUi.speed, damage: t.weaponsUi.damage, evasion: t.weaponsUi.evasion, defense: t.weaponsUi.defense, none: t.weaponsUi.none,
  };
  const as = (augment: Augment | null): Item => {
    const copy: Item = { ...target };
    if (augment) copy.augment = augment;
    else delete copy.augment;
    return copy;
  };
  type Tone = 'good' | 'bad' | '';
  interface Line { label: string; value: string; tone: Tone; note: string }
  const signed = (n: number): string => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '0');
  const percent = (n: number): string => `${n > 0 ? '+' : '−'}${Math.abs(n)}%`;
  const tone = (better: number): Tone => (better > 0 ? 'good' : better < 0 ? 'bad' : '');
  const linesOf = (augment: Augment | null): Line[] => {
    const now = as(current);
    const item = as(augment);
    const same = augment === current;
    if (armour) {
      const noArmor = isChallenged(world, NO_ARMOR);
      const had = armorStats(now, noArmor);
      const has = armorStats(item, noArmor);
      const evasion = armorEvasionBonus(item);
      return [
        { label: t.weaponsUi.armorRow, value: `${has.min}–${has.max}`, tone: same ? '' : tone(has.max - had.max), note: same || has.max === had.max ? '' : signed(has.max - had.max) },
        { label: t.weaponsUi.evasionRow, value: signed(evasion), tone: same ? '' : tone(evasion - armorEvasionBonus(now)), note: '' },
      ];
    }
    const had = weaponStats(now);
    const has = weaponStats(item);
    const damageShift = had.max > 0 ? Math.round((has.max / had.max - 1) * 100) : 0;
    const delayShift = had.delay > 0 ? Math.round((has.delay / had.delay - 1) * 100) : 0;
    return [
      { label: t.weaponsUi.damageRow, value: `${has.min}–${has.max}`, tone: same ? '' : tone(damageShift), note: same || damageShift === 0 ? '' : percent(damageShift) },
      {
        label: t.weaponsUi.attackRow, value: t.weaponsUi.turns(has.delay), tone: same ? '' : tone(-delayShift),
        note: same || delayShift === 0 ? '' : delayShift < 0 ? t.weaponsUi.faster(Math.abs(delayShift)) : t.weaponsUi.slower(delayShift),
      },
    ];
  };
  // In the design's order: the two ways, then none.
  const order: Array<Augment | null> = [augments[1] ?? null, augments[2] ?? null, null];
  let chosen: Augment | null = order.find((augment) => augment !== current) ?? null;
  const list = el('div', { className: 'pd-aug-opts' });
  list.setAttribute('role', 'radiogroup');
  const apply = button(t.weaponsUi.apply, () => act({ type: 'use', item: stone, on, choice: augments.indexOf(chosen) }), 'primary');
  const paint = (): void => {
    list.querySelectorAll<HTMLElement>('.pd-aug-opt').forEach((node) => {
      const selected = node.dataset.augment === String(chosen);
      node.classList.toggle('selected', selected);
      node.setAttribute('aria-checked', String(selected));
    });
    apply.disabled = chosen === current;
  };
  for (const augment of order) {
    const node = el(
      'button',
      {
        className: 'pd-aug-opt',
        onclick: () => {
          audio.play('click');
          chosen = augment;
          paint();
        },
      },
      el('span', { className: 'pd-aug-name' }, names[augment ?? 'none'], augment === current ? el('span', { className: 'pd-chip', textContent: t.weaponsUi.now }) : null),
      ...linesOf(augment).map((line) =>
        el(
          'span',
          { className: 'pd-aug-row' },
          el('span', { textContent: line.label }),
          el('b', { className: line.tone, textContent: line.value }),
          line.note ? el('em', { className: line.tone, textContent: line.note }) : null,
        )),
    );
    node.setAttribute('role', 'radio');
    node.dataset.augment = String(augment);
    list.append(node);
  }
  paint();
  show(
    windowOf(
      { title: t.alch.augmentTitle, sub: t.weaponsUi.augSub, icon: plainSlot(world, hero.items[stone]!), onClose: back },
      el('div', { className: 'pd-aug-item' }, slot(world, target, { hero }), el('b', { textContent: capitalize(itemName(world, target)) })),
      list,
      el('div', { className: 'pd-actions' }, apply),
    ),
    back,
  );
}

/** Into the first free quick slot (or one whose item ran out), else the first. */
function quickslotButton(world: World, hero: Hero, item: Item): HTMLButtonElement {
  return button(t.quickslotShort, () => {
    const free = Array.from({ length: QUICKSLOTS }, (_, i) => i).find((i) => quickKind(i) === null || isPlaceholder(hero, i));
    chooseQuickslot(item.kind, free ?? 0);
    refreshBackpack(world, hero);
  });
}

/**
 * MagesStaff.AC_IMBUE: the backpack's selector, with only the wands to tap (WndBag.ItemSelector), then
 * WndOptions: what the imbue will make of the staff, and what it costs.
 */
function pickWandToImbue(options: ItemOptions, staffRef: ItemRef, act: (action: Action) => void): void {
  const { world, hero } = options;
  const back = (): void => showBackpack(options, staffRef === 'weapon' ? { worn: 'weapon' } : { index: staffRef as number });
  const wands = hero.items.flatMap((item, i) => (itemDef(item.kind).category === 'wand' ? [i] : []));
  showBackpack({
    ...options,
    pick: {
      title: t.staffImbuePrompt,
      targets: wands,
      onPick: (ref) => {
        const staff = staffRef === 'weapon' ? hero.weapon : hero.items[staffRef as number];
        const wand = typeof ref === 'number' ? hero.items[ref] : undefined;
        if (!staff || !wand) return;
        // MagesStaff.itemSelector.onSelect: the staff's level after the imbue (one more if the wand is as good).
        const level = wand.level >= staff.level ? (staff.level > 0 ? wand.level + 1 : wand.level) : staff.level;
        const text = [
          t.staffImbueText,
          isIdentified(world, wand) ? t.staffImbueLevel(level) : t.staffImbueUnknown(staff.level),
          ...(wand.curseUnknown || wand.cursed ? [t.staffImbueCursed] : []),
          ...(staff.wand ? [t.staffImbueLost] : []),
        ].join('\n\n');
        showConfirm(capitalize(itemName(world, wand)), text, t.staffImbueYes, t.staffImbueNo,
          () => act({ type: 'imbue', staff: staffRef, wand: ref as number }), back);
      },
      onCancel: back,
    },
  });
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

/** What the backpack lends an artifact's actions (artifactui.ts): acting, aiming, picking from the pack. */
function artifactHost(options: ItemOptions, ref: ItemRef): ArtifactHost {
  const back = (): void => showBackpack(options, typeof ref === 'number' ? { index: ref } : ref === 'weapon' || ref === 'armor' ? { worn: ref } : { slot: ref });
  return {
    world: options.world,
    hero: options.hero,
    act: (action) => {
      openBag = null;
      options.onAction(action);
      options.onClose();
    },
    stay: (action) => {
      options.onAction(action);
      refreshBackpack(options.world, options.hero);
    },
    aim: (action) => {
      openBag = null;
      options.onClose();
      options.onAimArtifact?.(action);
    },
    aimClass: (prompt, make) => {
      openBag = null;
      options.onClose();
      options.onAimClass?.(prompt, make);
    },
    pick: (title, targets, onPick, onCancel) => showBackpack({ ...options, pick: { title, targets, onPick, onCancel: onCancel ?? back } }),
    back,
  };
}

/* Toast */

let toastTimer = 0;

export interface ToastOptions {
  /** `update`: the new-version notice of design v20 (a turning icon, update.ts). */
  tone?: 'good' | 'warn' | 'ally' | 'badge' | 'update' | 'alarm';
  /** How long it stays, in ms (2400 by default); hunger's banner stays longer. */
  ms?: number;
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
  }, options.ms ?? 2400);
}
