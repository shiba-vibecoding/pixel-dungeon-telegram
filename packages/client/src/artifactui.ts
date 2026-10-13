import {
  type Action, type ArtifactAction, artifactSeams, chargeCap, type ArtifactKind, type ArtifactUse, canFeed, chargesToUse, ghostOf, ghostQuestDone,
  ghostStrength, type Hero, isTargetedScroll, isWorn, type Item, itemDef, type ItemKind, type ItemRef, kindKnown, levelCap, maxPrick, minPrick,
  type MiscSlot, prickDeathChance, scrollTargets, stealChance, thievery, visiblyUpgraded, type World,
} from '@pd/core';
import { ARTIFACT_CLASS, artifactState, artText, capital, chargeOf, format } from './artifacttext';
import { t } from './i18n';
import { itemName } from './itemtext';
import { button, el, info, show, windowOf } from './screens';

/*
 * The artifacts in the backpack (Artifact.actions and execute, their windows):
 * what each can do, the windows that ask before (the hourglass's way, the
 * chalice's warning, the toolkit's energy, the rose's ghost's gear, the
 * spellbook's scroll), the card the design system draws for an artifact
 * (ShArtifact: level steps, charge bar, state line) and the charge strip on
 * its icon.
 */

/** What the backpack lends an artifact's actions. */
export interface ArtifactHost {
  world: World;
  hero: Hero;
  /** Do it; the backpack closes for the dungeon to answer. */
  act(action: Action): void;
  /** Do it; the backpack stays open. */
  stay(action: Action): void;
  /** The next tap on the map picks the cell. */
  aim(action: ArtifactAction): void;
  /** The backpack opened on what can be chosen, the chosen one handed back (WndBag.ItemSelector). */
  /** The backpack as a selector; cancelled, `onCancel` (else back to where it was). */
  pick(title: string, targets: readonly ItemRef[], onPick: (ref: ItemRef) => void, onCancel?: () => void): void;
  /** Back to the backpack, with the artifact chosen. */
  back(): void;
}

/** A Shattered action name (AC_STEALTH = «STEALTH») as a button says it. */
const acLabel = (kind: ItemKind, ac: string): string => {
  const text = artText(`${ARTIFACT_CLASS[kind as ArtifactKind]}.ac_${ac}`) || ac;
  return capital(text.toLowerCase());
};

/** The uses that aim at a cell. */
const AIMED: ReadonlySet<ArtifactUse> = new Set(['scry', 'cast', 'direct', 'steal', 'root', 'zap']);

/** Artifact.actions: what an artifact offers now, its default action first (Artifact.defaultAction). */
export function artifactActions(host: ArtifactHost, item: Item, ref: ItemRef): Array<{ label: string; run: () => void; icon?: 'steal' }> {
  const { world, hero } = host;
  const worn = isWorn(hero, item);
  const usable = worn && !item.cursed;
  const charge = item.charge ?? 0;
  const list: Array<{ label: string; run: () => void; icon?: 'steal' }> = [];
  const add = (ac: string, run: () => void, icon?: 'steal'): void => {
    list.push({ label: acLabel(item.kind, ac), run, ...(icon ? { icon } : {}) });
  };
  const use = (u: ArtifactUse, extra: Partial<ArtifactAction> = {}): void => {
    const action: ArtifactAction = { type: 'artifact', item: ref, use: u, ...extra };
    if (AIMED.has(u) && extra.cell === undefined) host.aim(action);
    else host.act(action);
  };
  const withPack = (u: ArtifactUse, title: string, ok: (other: Item) => boolean): void => {
    const targets = hero.items.flatMap((other, i) => (other !== item && ok(other) ? [i] : []));
    host.pick(title, targets, (picked) => host.act({ type: 'artifact', item: ref, use: u, with: picked as number }));
  };
  switch (item.kind as ArtifactKind) {
    case 'artifact.cloak':
      if (usable && (charge > 0 || item.stealth)) add('stealth', () => use('stealth'));
      break;
    case 'artifact.horn':
      if (worn && charge > 0) {
        add('snack', () => use('snack'));
        add('eat', () => use('eat'));
      }
      if (usable && item.level < levelCap(item)) {
        add('store', () => withPack('store', artText('hornofplenty.prompt'), (other) => itemDef(other.kind).category === 'food'));
      }
      break;
    case 'artifact.chalice':
      if (usable && item.level < levelCap(item)) add('prick', () => showPrick(host, item, () => use('prick')));
      break;
    case 'artifact.hourglass':
      if (usable && (charge > 0 || item.freeze)) {
        add('activate', () => (item.freeze ? use('freeze') : showHourglass(host, item, (stasis) => use(stasis ? 'stasis' : 'freeze'))));
      }
      break;
    case 'artifact.talisman':
      if (usable) add('scry', () => use('scry'));
      break;
    case 'artifact.spellbook':
      if (usable && charge > 0) add('read', () => use('read'));
      if (usable && item.level < levelCap(item)) {
        const wanted = (item.scrolls ?? []).slice(0, 2);
        add('add', () => withPack('add', artText('unstablespellbook.prompt'), (other) =>
          other.kind.startsWith('scroll.') && kindKnown(world, other) && (item.scrolls === undefined || wanted.includes(other.kind))));
      }
      break;
    case 'artifact.chains':
      if (usable && charge > 0) add('cast', () => use('cast'));
      break;
    case 'artifact.rose': {
      if (!ghostQuestDone(world)) break;
      const ghost = ghostOf(world, item);
      if (ghost) add('direct', () => use('direct'));
      else if (usable && charge >= 100) add('summon', () => use('summon'));
      if (!item.cursed && !item.levelUnknown && !item.curseUnknown) add('outfit', () => showOutfit(host, item, ref));
      break;
    }
    case 'artifact.armband':
      if (usable && charge > 0) add('steal', () => use('steal'), 'steal');
      break;
    case 'artifact.sandals':
      if (usable) {
        add('feed', () => withPack('feed', artText('sandalsofnature.prompt'), (other) => canFeed(item, other)));
        if (item.seedEffect) add('root', () => use('root'));
      }
      break;
    case 'artifact.toolkit':
      if (usable) {
        add('brew', () => use('brew'));
        if (item.level < levelCap(item)) add('energize', () => showEnergize(host, item, (levels) => use('energize', { choice: levels })));
      }
      break;
    case 'artifact.beacon':
      add('zap', () => use('zap'));
      add('set', () => use('set'));
      if (item.returnTo) add('return', () => use('return'));
      break;
    case 'artifact.cape':
      break;
  }
  return list;
}

/** Artifact.defaultAction, as a quick slot uses it; null if the artifact has none now. */
export function defaultArtifactAction(host: ArtifactHost, item: Item, ref: ItemRef): (() => void) | null {
  return artifactActions(host, item, ref)[0]?.run ?? null;
}

/** ChaliceOfBlood.execute(PRICK): the warning, with the damage and the chance of death, before the prick. */
function showPrick(host: ArtifactHost, item: Item, onYes: () => void): void {
  const chance = (Math.round(prickDeathChance(host.hero, item) * 10000) / 100).toString();
  show(
    windowOf(
      { title: capital(artText('chaliceofblood.name')), narrow: true, onClose: host.back },
      info(artText('chaliceofblood.prick_warn', [minPrick(item), maxPrick(item), chance])),
      el('div', { className: 'pd-confirm-actions' }, button(artText('chaliceofblood.yes'), onYes, 'danger'), button(artText('chaliceofblood.no'), host.back, 'quiet')),
    ),
    host.back,
  );
}

/** TimekeepersHourglass.execute(ACTIVATE): stasis or freezing time. */
function showHourglass(host: ArtifactHost, _item: Item, onChoose: (stasis: boolean) => void): void {
  show(
    windowOf(
      { title: capital(artText('timekeepershourglass.name')), narrow: true, onClose: host.back },
      info(artText('timekeepershourglass.prompt')),
      el('div', { className: 'pd-actions' },
        button(artText('timekeepershourglass.stasis'), () => onChoose(true), 'primary'),
        button(artText('timekeepershourglass.freeze'), () => onChoose(false))),
    ),
    host.back,
  );
}

/** AlchemistsToolkit.execute(ENERGIZE): six energy a level, one level or as many as there is energy for. */
function showEnergize(host: ArtifactHost, item: Item, onChoose: (levels: number) => void): void {
  const energy = artifactSeams.alchemyEnergy(host.world);
  const most = Math.min(levelCap(item) - item.level, Math.trunc(energy / 6));
  if (energy < 6) {
    show(windowOf({ title: capital(artText('alchemiststoolkit.name')), narrow: true, onClose: host.back },
      info(artText('alchemiststoolkit.need_energy'))), host.back);
    return;
  }
  show(
    windowOf(
      { title: capital(artText('alchemiststoolkit.name')), narrow: true, onClose: host.back },
      info(artText('alchemiststoolkit.energize_desc')),
      el('div', { className: 'pd-actions' },
        button(artText('alchemiststoolkit.energize_1'), () => onChoose(1), 'primary'),
        most > 1 && button(artText('alchemiststoolkit.energize_all', [6 * most, most]), () => onChoose(most))),
    ),
    host.back,
  );
}

/** WndGhostHero: the ghost's weapon and armour, given from the pack or taken back. */
function showOutfit(host: ArtifactHost, item: Item, ref: ItemRef): void {
  const { world, hero } = host;
  const gear = (which: 'weapon' | 'armor'): HTMLElement => {
    const worn = which === 'weapon' ? item.ghostWeapon : item.ghostArmor;
    if (worn) {
      return button(t.art.takeBack(itemName(world, worn)), () => host.stay({ type: 'artifact', item: ref, use: 'unoutfit', choice: which === 'weapon' ? 0 : 1 }));
    }
    const category = which === 'weapon' ? 'weapon' : 'armor';
    return button(which === 'weapon' ? t.art.giveWeapon : t.art.giveArmor, () => {
      const targets = hero.items.flatMap((other, i) => (itemDef(other.kind).category === category ? [i] : []));
      host.pick(artText(`driedrose$wndghosthero.${which}_prompt`), targets, (picked) =>
        host.act({ type: 'artifact', item: ref, use: 'outfit', with: picked as number }));
    });
  };
  show(
    windowOf(
      { title: artText('driedrose$wndghosthero.title'), narrow: true, onClose: host.back },
      info(artText('driedrose$wndghosthero.desc', [ghostStrength(item)])),
      el('div', { className: 'pd-actions' }, gear('weapon'), gear('armor')),
    ),
    host.back,
  );
}

/**
 * The unstable spellbook's scroll to settle (UnstableSpellbook's empowered window, and InventoryScroll's
 * selector for a scroll read on something): which to read, and on what.
 */
export function showSpellbookChoice(host: ArtifactHost, kind: ItemKind, exotic: ItemKind | undefined, onClose: () => void): void {
  const { world, hero } = host;
  const ref: ItemRef = hero.artifact?.kind === 'artifact.spellbook' ? 'artifact' : 'misc';
  const resolve = (choice: number, scroll: ItemKind): void => {
    if (!isTargetedScroll(scroll)) {
      host.act({ type: 'artifact', item: ref, use: 'resolve', choice });
      return;
    }
    const targets = scrollTargets(world, hero, scroll);
    // The selector cancelled, the scroll is read on nothing and used up (InventoryScroll.confirmCancelation's yes).
    host.pick(t.art.readOn, targets, (on) => host.act({ type: 'artifact', item: ref, use: 'resolve', choice, on }),
      () => host.act({ type: 'artifact', item: ref, use: 'resolve', choice }));
  };
  if (!exotic) {
    resolve(0, kind);
    return;
  }
  show(
    windowOf(
      { title: artText('unstablespellbook.prompt'), narrow: true },
      info(artText('unstablespellbook.read_empowered')),
      el('div', { className: 'pd-actions' },
        button(capital(t.items[kind] ?? kind), () => resolve(0, kind), 'primary'),
        button(capital(t.items[exotic] ?? exotic), () => resolve(1, exotic))),
    ),
    onClose,
  );
}

/** KindofMisc's window: every slot taken, which of the artifact, misc and ring to take off for it. */
export function showMiscChooser(world: World, hero: Hero, item: Item, choices: readonly MiscSlot[], onChoose: (slot: MiscSlot) => void, onClose: () => void): void {
  show(
    windowOf(
      { title: artText('items.kindofmisc.unequip_title'), narrow: true, onClose },
      info(artText('items.kindofmisc.unequip_message')),
      // KindofMisc.doEquip's WndOptions: the worn things that could make way, by name.
      el('div', { className: 'pd-actions' }, ...choices.map((slot) => button(capital(itemName(world, hero[slot]!)), () => onChoose(slot)))),
    ),
    onClose,
  );
  void item;
}

/** The armband's offer on a ware (WndTradeItem): the chance and the charges, or null if it cannot. */
export function shopliftOffer(world: World, hero: Hero, ware: Item): { label: string; sure: boolean } | null {
  const armband = thievery(hero);
  if (!armband || chargesToUse(armband, world, ware) <= 0) return null;
  const chance = stealChance(armband, world, ware);
  return { label: artText('windows.wndtradeitem.steal', [Math.min(100, Math.trunc(chance * 100)), chargesToUse(armband, world, ware)]), sure: chance >= 1 };
}

/** The share of the way to the next level, for the card's part-filled step. */
function progress(item: Item): number {
  const exp = item.exp ?? 0;
  const of = (need: number): number => (need > 0 ? Math.max(0, Math.min(1, exp / need)) : 0);
  switch (item.kind as ArtifactKind) {
    case 'artifact.cloak': return of((item.level + 1) * 50);
    case 'artifact.talisman': return of(100 + 50 * item.level);
    case 'artifact.chains': return of(100 + item.level * 100);
    case 'artifact.armband': return of(10 + Math.round(3.33 * item.level));
    case 'artifact.cape': return of((item.level + 1) * 5);
    case 'artifact.horn': return Math.min(1, (item.stored ?? 0) / 300);
    case 'artifact.sandals': return Math.min(1, (item.seeds ?? []).length / (3 + item.level * 3));
    default: return 0;
  }
}

/** ShArtifact's card: the level in steps, the charge in segments, and what the artifact is doing. */
export function artifactCard(world: World, hero: Hero, item: Item): HTMLElement[] {
  const nodes: HTMLElement[] = [];
  const cap = levelCap(item);
  if (!item.levelUnknown && cap > 0) {
    const steps = el('span', { className: 'pd-steps' });
    steps.style.setProperty('--max', String(cap));
    for (let i = 0; i < cap; i++) {
      const step = el('i', { className: i < item.level ? 'on' : i === item.level ? 'part' : '' });
      if (i === item.level) step.style.setProperty('--p', String(progress(item)));
      steps.append(step);
    }
    nodes.push(el('div', { className: 'pd-art-level' }, el('span', { textContent: t.art.level }), steps,
      el('span', {}, el('b', { textContent: String(item.level) }), `/${cap}`)));
  }
  const charge = chargeOf(world, hero, item);
  if (charge) {
    const bar = el('div', { className: `pd-charge-bar seg${charge.full ? ' full' : ''}` });
    bar.style.setProperty('--v', String(charge.share));
    const cap2 = item.kind === 'artifact.chains' ? 5 + item.level * 2 : numberCap(item);
    bar.style.setProperty('--n', String(cap2));
    const [shown, of] = charge.text.includes('/') ? charge.text.split('/') : [charge.text, ''];
    nodes.push(el('div', { className: 'pd-art-charge' }, el('span', { textContent: t.art.charge }), bar,
      el('span', {}, el('b', { textContent: shown ?? '' }), of ? `/${of}` : '')));
  }
  const state = artifactState(world, hero, item);
  if (state) nodes.push(el('p', { className: `pd-art-state${state.on ? ' on' : ''}`, textContent: state.text }));
  return nodes;
}

/** How many segments the charge bar has: the cap, or ten for a charge in percent (or with no cap). */
function numberCap(item: Item): number {
  const cap = chargeCap(item);
  return cap === 100 || cap === 0 ? 10 : cap;
}

/** The small charge strip at the bottom of an artifact's icon (backpack and quick slot). */
export function chargeStrip(world: World, hero: Hero, item: Item): HTMLElement | null {
  if (itemDef(item.kind).category !== 'artifact') return null;
  const charge = chargeOf(world, hero, item);
  if (!charge) return null;
  const strip = el('span', { className: `pd-charge${charge.full ? ' full' : ''}` });
  strip.style.setProperty('--v', String(charge.share));
  return strip;
}

/** The level an artifact's slot shows: +0 to +10 (Artifact.visiblyUpgraded). */
export const artifactLevel = (item: Item): number => visiblyUpgraded(item);

export { format };
