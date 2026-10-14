import { type CampId, type EffectId, type HeroClass, inSeason, type Offer, offerBySku, OFFERS } from '@pd/core';
import { audio } from './audio';
import { Camp, type CampScene, campClasses, seasonOf } from './camp';
import { badgeText } from './badges';
import { t } from './i18n';
import { mart, shelf } from './mart';
import { AVATAR, button, el, info, show, sprites, toast, windowOf } from './screens';

/*
 * Pixel-Mart's windows, in the design system's markup (docs/design/system,
 * «Pixel-Mart»): the shop with its four shelves, an offer up close, the
 * patronage, treating the developer, and the «Look» rows of the hero window.
 */

const BASE = `${import.meta.env.BASE_URL}assets/`;
const images = new Map<string, Promise<HTMLImageElement>>();

function image(src: string): Promise<HTMLImageElement> {
  let loading = images.get(src);
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = `${BASE}${src}`;
    });
    images.set(src, loading);
  }
  return loading;
}

const sheetFile = (heroClass: HeroClass, skin?: string): string =>
  `${skin ? 'skins/' : ''}${heroClass === 'huntress' ? 'ranger' : heroClass}${skin ? `-${skin}` : ''}.png`;

/** A hero frame on a pixelated canvas: `frame` of the sheet, `tier` its armour row. */
function heroCanvas(heroClass: HeroClass, skin: string | undefined, scale: number, tier = 0, frame = 0): HTMLCanvasElement {
  const canvas = el('canvas', { width: 12, height: 15 });
  canvas.style.width = `${12 * scale}px`;
  canvas.style.height = `${15 * scale}px`;
  void image(sheetFile(heroClass, skin)).then((sheet) => {
    const ctx = canvas.getContext('2d')!;
    const cols = Math.floor(sheet.width / 12);
    ctx.clearRect(0, 0, 12, 15);
    ctx.drawImage(sheet, (frame % cols) * 12, (Math.floor(frame / cols) + tier) * 15, 12, 15, 0, 0, 12, 15);
  });
  return canvas;
}

/** A hero running in place, for an offer up close; it stops once its window is gone. */
function runningHero(heroClass: HeroClass, skin: string | undefined, scale: number): HTMLCanvasElement {
  const canvas = heroCanvas(heroClass, skin, scale, 2, 2);
  const frames = [2, 3, 4, 5, 6, 7];
  void image(sheetFile(heroClass, skin)).then((sheet) => {
    const ctx = canvas.getContext('2d')!;
    const cols = Math.floor(sheet.width / 12);
    const step = (now: number): void => {
      if (!canvas.isConnected) return;
      const frame = frames[Math.floor(now / 80) % frames.length]!;
      ctx.clearRect(0, 0, 12, 15);
      ctx.drawImage(sheet, (frame % cols) * 12, (Math.floor(frame / cols) + 2) * 15, 12, 15, 0, 0, 12, 15);
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
  return canvas;
}

const EFFECT_COLORS: Record<EffectId, readonly string[]> = {
  sparks: ['#fff3b0', '#ffcc66', '#ffeba4', '#ffffff'],
  fireflies: ['#d8ff8a', '#fff7a0', '#b8ff6a'],
  snow: ['#ffffff', '#e8f4ff', '#bfe3ff'],
};

/** An effect around a hero: a canvas whose motes drift, as in the game. */
function effectCanvas(effect: EffectId, heroClass: HeroClass, scale: number): HTMLCanvasElement {
  const W = 40;
  const H = 32;
  const canvas = el('canvas', { width: W, height: H });
  canvas.style.width = `${W * scale}px`;
  canvas.style.height = `${H * scale}px`;
  const colors = EFFECT_COLORS[effect];
  const motes = Array.from({ length: 14 }, (_, i) => ({ x: Math.random() * W, y: Math.random() * H, c: colors[i % colors.length]!, p: Math.random() * 6 }));
  void image(sheetFile(heroClass)).then((sheet) => {
    const ctx = canvas.getContext('2d')!;
    const draw = (now: number): void => {
      if (!canvas.isConnected) return;
      ctx.clearRect(0, 0, W, H);
      ctx.drawImage(sheet, 0, 0, 12, 15, 14, 12, 12, 15);
      for (const m of motes) {
        const k = now / 1000 + m.p;
        const x = effect === 'snow' ? (m.x + Math.sin(k) * 2 + W) % W : effect === 'sparks' ? 20 + Math.cos(k * 3 + m.p) * (6 + m.p) : (m.x + Math.sin(k * 0.7) * 4 + W) % W;
        const y = effect === 'snow' ? (m.y + k * 6) % H : effect === 'sparks' ? 18 + Math.sin(k * 3 + m.p) * (5 + m.p) : (m.y + Math.cos(k * 0.9) * 3 + H) % H;
        ctx.globalAlpha = effect === 'fireflies' ? 0.5 + 0.5 * Math.sin(k * 3) : 1;
        ctx.fillStyle = m.c;
        ctx.fillRect(Math.round(x), Math.round(y), 1, 1);
      }
      ctx.globalAlpha = 1;
      requestAnimationFrame(draw);
    };
    requestAnimationFrame(draw);
  });
  return canvas;
}

/** A portrait in a frame. */
function framedPortrait(frame: string, heroClass: HeroClass): HTMLElement {
  const face = el('i');
  face.style.setProperty('--av', String(AVATAR[heroClass]));
  return el('div', { className: `pd-avatar framed frame-${frame}` }, face);
}

/** A camp's name: short on its card («Тюрьма»), full in its window («Тюремный двор»). */
const campName = (camp: string, short: boolean): string => t.rel.mart.camps[camp]?.[short ? 3 : 0] ?? camp;

/** The camp's postcard (design v20: camp-card-*.png, 66×48 shown at ×2), drawn for the card and not cut from the scene. */
function campCard(camp: string): HTMLElement {
  const card = el('i', { className: 'pd-camp-card', role: 'img', ariaLabel: campName(camp, false) });
  card.style.setProperty('--card', `var(--spr-camp-card-${camp})`);
  return card;
}

function offerName(offer: Offer): string {
  if (offer.kind === 'skin') return t.skinNames[offer.skin!];
  if (offer.kind === 'effect') return t.effectNames[offer.effect!];
  if (offer.kind === 'frame') return t.frameNames[offer.frame!];
  if (offer.kind === 'camp') return campName(offer.camp!, true);
  return t.patron;
}

function offerInfo(offer: Offer): string {
  if (offer.kind === 'skin') return t.skinInfo[offer.skin!];
  if (offer.kind === 'effect') return t.effectInfo[offer.effect!];
  if (offer.kind === 'camp') return t.campInfo[offer.camp!];
  return t.frameInfo;
}

function offerArt(offer: Offer, heroClass: HeroClass): HTMLElement {
  if (offer.kind === 'skin') return heroCanvas(offer.heroClass!, offer.skin, 5, 2);
  if (offer.kind === 'effect') return effectCanvas(offer.effect!, heroClass, 2);
  if (offer.kind === 'camp') return campCard(offer.camp!);
  return framedPortrait(offer.frame!, heroClass);
}

/** A small picture of an offer for a 44px square: the look, the effect's motes, the frame. */
function smallArt(offer: Offer, heroClass: HeroClass): HTMLElement {
  if (offer.kind === 'skin') return heroCanvas(heroClass, offer.skin, 2.5, 0);
  if (offer.kind === 'effect') return effectCanvas(offer.effect!, heroClass, 1);
  const frame = el('i', { className: 'pd-perk-frame' });
  frame.style.borderImageSource = `var(--spr-frame-${offer.frame})`;
  return frame;
}

/** Called by the Mart's owner: what «Try it at the camp» does (it closes the Mart and shows the camp for ten seconds). */
let tryHandler: ((camp: CampId) => void) | undefined;

/**
 * A camp's window (design v20, MartCampOffer): a live slice of the real scene (light, motes, the hero answering a touch), what the camp
 * is, its features, and the buttons of its state: «Buy for ★», «Try it at the camp» (10 seconds), «Set at the camp», or «Set» with
 * «Back to At the gate». The scene's own camp is free and always owned.
 */
function showCampOffer(camp: string, heroClass: HeroClass, back: () => void): void {
  const [name, about, facts] = t.rel.mart.camps[camp] ?? [camp, '', [] as readonly string[]];
  const offer = camp === 'outdoor' ? null : OFFERS.find((o) => o.kind === 'camp' && o.camp === camp) ?? null;
  const worn = offer ? mart.owns(offer) && mart.isWorn(offer) : mart.campWorn() === undefined;
  const owned = offer === null || mart.owns(offer);
  const peek = el('div', { className: 'pd-camp-peek' });
  peek.dataset.camp = camp;
  if (worn) peek.append(el('span', { className: 'pd-chip', textContent: t.rel.mart.stands }));
  const actions = el('div', { className: 'pd-actions' });
  const close = (): void => back();
  if (worn) {
    const standing = button(t.rel.mart.standsOn, () => undefined, 'primary');
    standing.disabled = true;
    actions.append(standing);
    if (offer) actions.append(button(t.rel.mart.back, () => { mart.wearCamp(undefined); close(); }, 'quiet'));
  } else if (owned) {
    actions.append(button(t.rel.mart.putOn, () => { mart.wearCamp(offer ? offer.camp : undefined); close(); }, 'primary'));
  } else if (offer) {
    const buy = button(t.buy, () => void purchase(offer, close), 'primary');
    buy.append(' ', stars(offer.stars));
    buy.disabled = !mart.open || !mart.buyable(offer);
    actions.append(buy, button(t.rel.mart.tryOn, () => tryHandler?.(offer.camp as CampId), ''));
  }
  show(
    windowOf(
      { title: name, sub: t.rel.mart.kind, onClose: close, className: 'pd-camp-offer' },
      peek,
      info(about),
      el('ul', { className: 'pd-camp-facts' }, ...facts.map((fact) => el('li', { textContent: fact }))),
      info(t.rel.mart.only, 'pd-note'),
      actions,
      offer && !owned ? info(`${t.starsNote} ${t.rel.mart.tryNote}`, 'pd-note center') : null,
    ),
    close,
  );
  new Camp(peek, {
    scene: camp as CampScene, season: seasonOf(new Date()), hero: Math.max(0, campClasses().indexOf(heroClass)), skinOf: (n) => mart.skinOf(n), effect: mart.effectWorn(),
    crop: [0, 46, 94, 73], scale: 3, label: false, own: true,
  });
}

const stars = (amount: number, small = false): HTMLElement => el('span', { className: `pd-stars${small ? ' small' : ''}`, textContent: String(amount) });

const shortDate = (month: number, day: number): string =>
  new Date(Date.UTC(2026, month - 1, day)).toLocaleDateString(document.documentElement.lang === 'ru' ? 'ru-RU' : 'en-GB', { day: 'numeric', month: 'short' });

/** Buys an offer and says how it went. */
async function purchase(offer: Offer, then: () => void): Promise<void> {
  const status = await mart.buy(offer, { title: offerName(offer), description: offer.kind === 'tip' ? t.treatInfo : offerInfo(offer) });
  if (status === 'paid') {
    audio.play('badge');
    toast(t.thanksBought, { tone: 'good' });
  } else if (status === 'failed') {
    toast(t.buyFailed, { tone: 'warn' });
  } else if (status === 'expired') {
    toast(t.buyExpired, { tone: 'warn' });
  }
  then();
}

/** One card on a shelf, in its state: to buy, bought, worn, opened by a badge, in or out of season. */
function card(offer: Offer, heroClass: HeroClass, refresh: () => void, reopen: () => void): HTMLElement {
  const owned = mart.owns(offer);
  const worn = owned && mart.isWorn(offer);
  const seasonal = offer.season !== undefined;
  const now = Date.now();
  const inside = inSeason(offer, now);
  const byBadge = !owned && offer.badge !== undefined;
  const art = el('div', { className: `pd-offer-art${offer.kind === 'camp' ? ' camp' : ''}` }, offerArt(offer, heroClass));
  if (byBadge) art.append(el('i', { className: 'pd-offer-lock' }));
  if (worn) art.append(el('span', { className: 'pd-chip', textContent: offer.kind === 'camp' ? t.rel.mart.stands : t.worn }));
  else if (seasonal && !owned) art.append(el('span', { className: 'pd-chip season', textContent: inside ? t.seasonUntil(shortDate(...offer.season!.to)) : t.winter }));

  const meta = el('p', { className: 'pd-offer-meta' });
  let action: HTMLElement;
  if (worn) {
    meta.textContent = t.worn;
    action = button(t.takeOffLook, () => { mart.wear(offer, false); refresh(); }, 'small quiet');
  } else if (owned) {
    meta.textContent = t.ownedLabel;
    action = button(t.wear, () => { mart.wear(offer); refresh(); }, 'small');
  } else if (byBadge) {
    const badge = el('i', { className: 'pd-offer-badge' });
    const id = offer.badge!;
    badge.dataset.i = String(badgeImage(id));
    meta.append(badge, t.byBadge(badgeText(id as never)));
    action = el('p', { className: 'pd-offer-cond', textContent: '' });
  } else if (!inside) {
    meta.textContent = t.backInWinter;
    action = button(t.offSeason, () => undefined, 'small');
    (action as HTMLButtonElement).disabled = true;
  } else {
    meta.append(stars(offer.stars, true));
    action = button(t.buy, () => showOffer(offer, heroClass, reopen), 'small');
  }
  const node = el(
    'article',
    { className: `pd-offer${worn ? ' worn' : owned ? ' owned' : byBadge ? ' badge' : !inside ? ' offseason' : ''}${offer.kind === 'camp' ? ' camp' : ''}` },
    art,
    el('h3', { className: 'pd-offer-name', textContent: offerName(offer) }),
    meta,
    action,
  );
  art.onclick = () => showOffer(offer, heroClass, reopen);
  return node;
}

let badgeImages: Record<string, number> = {};

/** A badge's picture in badges.png. */
function badgeImage(id: string): number {
  return badgeImages[id] ?? 0;
}

/** Called once with the badges' pictures (badges.ts holds them). */
export function setBadgeImages(map: Record<string, number>): void {
  badgeImages = map;
}

/** The camp every hero has: the dungeon's gate, in the season's colours. Worn when no other camp is. */
function plainCamp(heroClass: HeroClass, refresh: () => void): HTMLElement {
  const worn = mart.campWorn() === undefined;
  const art = el('div', { className: 'pd-offer-art camp' }, campCard('outdoor'));
  if (worn) art.append(el('span', { className: 'pd-chip', textContent: t.rel.mart.stands }));
  const meta = el('p', { className: 'pd-offer-meta', textContent: t.rel.mart.free });
  const action = worn
    ? button(t.rel.mart.stands, () => undefined, 'small quiet')
    : button(t.wear, () => { mart.wearCamp(undefined); refresh(); }, 'small');
  (action as HTMLButtonElement).disabled = worn;
  art.onclick = () => showCampOffer('outdoor', heroClass, () => showMart({ heroClass, shelf: 'camp', onClose: tryClose ?? (() => undefined) }));
  return el('article', { className: `pd-offer camp${worn ? ' worn' : ' owned'}` }, art, el('h3', { className: 'pd-offer-name', textContent: campName('outdoor', true) }), meta, action);
}

type Shelf = 'skin' | 'effect' | 'frame' | 'camp' | 'patron';

export interface MartOptions {
  heroClass: HeroClass;
  shelf?: Shelf;
  onClose(): void;
  /** «Try it at the camp» (a camp's window): the camp is shown on the home screen for ten seconds. */
  onTry?: (camp: CampId) => void;
}

/** The close of the Mart now open, for windows that come back to it. */
let tryClose: (() => void) | undefined;

/** Pixel-Mart: the shopkeeper, four shelves, two cards a row. */
export function showMart(options: MartOptions): void {
  let current: Shelf = options.shelf ?? 'skin';
  tryHandler = options.onTry;
  tryClose = options.onClose;
  const reopen = (): void => showMart({ ...options, shelf: current });
  const keeper = el('i', { className: 'keeper' });
  keeper.style.setProperty('--keeper', `url(${BASE}shopkeeper.png)`);
  const body = el('div', { className: 'pd-scroll' });
  // Five shelves (design v20, MartShelves): only the chosen tab shows its word; the others an icon, their name in the label.
  const tabs = el('div', { className: 'pd-tabs compact shelf' });
  tabs.setAttribute('role', 'tablist');
  const render = (): void => {
    for (const tab of tabs.children) tab.setAttribute('aria-selected', String((tab as HTMLElement).dataset.shelf === current));
    if (current === 'patron') {
      body.replaceChildren(patronBody(render));
    } else {
      const offers = current === 'skin' ? OFFERS.filter((o) => o.kind === 'skin' && o.heroClass === options.heroClass) : shelf(current, options.heroClass);
      body.replaceChildren(
        el(
          'div',
          { className: 'pd-shop-grid' },
          ...(current === 'camp' ? [plainCamp(options.heroClass, render)] : []),
          ...offers.filter((o) => o.frame !== 'patron' || mart.patron).map((offer) => card(offer, options.heroClass, render, reopen)),
        ),
        ...(mart.open ? [] : [info(t.martClosed, 'pd-note center')]),
      );
    }
    sprites(body);
  };
  for (const id of ['skin', 'camp', 'effect', 'frame', 'patron'] as const) {
    const tab = el('button', { className: `pd-tab ${id}` }, el('i', { className: `pd-tab-ico ${id}` }), el('span', { textContent: t.martTabs[id] }));
    tab.ariaLabel = t.martTabs[id];
    tab.title = t.martTabs[id];
    tab.dataset.shelf = id;
    tab.setAttribute('role', 'tab');
    tab.onclick = () => {
      audio.play('click');
      current = id;
      render();
    };
    tabs.append(tab);
  }
  const box = windowOf({ title: t.mart, sub: t.martMotto, icon: el('div', { className: 'pd-portrait' }, keeper), onClose: options.onClose }, tabs, body);
  show(box, options.onClose);
  render();
}

/** An offer up close: the look running and on every armour tier, what it is, and the red «Buy». */
function showOffer(offer: Offer, heroClass: HeroClass, back: () => void): void {
  if (offer.kind === 'camp') return showCampOffer(offer.camp!, heroClass, back);
  const owner = offer.heroClass ?? heroClass;
  const big = offer.kind === 'skin' ? runningHero(owner, offer.skin, 8) : offer.kind === 'effect' ? effectCanvas(offer.effect!, owner, 4)
    : framedPortrait(offer.frame!, owner);
  const tiers = offer.kind === 'skin'
    ? el('div', { className: 'pd-tiers' }, ...t.tiers.map((name, tier) => el('div', { title: name, ariaLabel: name }, heroCanvas(owner, offer.skin, 3, tier), el('span', { textContent: String(tier + 1) }))))
    : null;
  const owned = mart.owns(offer);
  const action = owned
    ? button(mart.isWorn(offer) ? t.takeOffLook : t.wear, () => { mart.wear(offer, !mart.isWorn(offer)); close(); }, mart.isWorn(offer) ? 'quiet' : 'primary')
    : (() => {
        const buy = button(t.buyForStars, () => void purchase(offer, close), 'primary');
        buy.append(' ', stars(offer.stars));
        buy.disabled = !mart.open || !mart.buyable(offer);
        return buy;
      })();
  const close = (): void => back();
  show(
    windowOf(
      { title: offerName(offer), sub: offer.kind === 'skin' ? t.lookOf[owner] : t.martTabs[offer.kind as 'effect' | 'frame'], onClose: close },
      el('div', { className: 'pd-offer-hero' }, big),
      tiers,
      info(offerInfo(offer)),
      el('div', { className: 'pd-actions' }, action),
      info(mart.open ? t.starsNote : t.martClosed, 'pd-note center'),
    ),
    close,
  );
}

/** The patronage: what it gives, its price or how long it runs. */
function patronBody(refresh: () => void): HTMLElement {
  const offer = offerBySku('patron')!;
  const perk = (icon: HTMLElement, text: string): HTMLElement => el('li', { className: 'pd-perk' }, el('span', { className: 'pd-perk-ico' }, icon), info(text));
  const perks = el(
    'ul',
    { className: 'pd-perks' },
    perk(el('i', { className: 'pd-patron-mark' }), t.patronPerks[0]!),
    perk(el('i', { className: 'pd-perk-frame' }), t.patronPerks[1]!),
    perk(el('i', { className: 'pd-offer-badge patron' }), t.patronPerks[2]!),
  );
  const until = mart.patronUntilDate;
  if (mart.patron && until) {
    const date = until.toLocaleDateString(document.documentElement.lang === 'ru' ? 'ru-RU' : 'en-GB', { day: 'numeric', month: 'long' });
    return el('div', { className: 'pd-actions' }, el('span', { className: 'pd-chip active', textContent: t.patronActive(date) }), perks, info(t.patronRenews, 'pd-note center'));
  }
  const subscribe = button(t.subscribe, () => void purchase(offer, refresh), 'primary');
  subscribe.append(' ', stars(offer.stars));
  subscribe.disabled = !mart.open;
  return el(
    'div',
    { className: 'pd-actions' },
    el('div', { className: 'pd-window-head' }, el('i', { className: 'pd-patron-big' }), el('div', { className: 'pd-titles' }, el('h2', { className: 'pd-heading', textContent: t.patron }), info(t.patronSub, 'pd-note'))),
    perks,
    el('div', { className: 'pd-price-row' }, stars(offer.stars), info(t.perMonth, 'pd-note')),
    subscribe,
    info(mart.open ? t.starsNote : t.martClosed, 'pd-note center'),
  );
}

/** Treating the developer: three sizes, nothing but thanks (and the «Patron of the arts» badge). */
export function showTreat(onClose: () => void): void {
  const tips = OFFERS.filter((offer) => offer.kind === 'tip');
  const row = el('div', { className: 'pd-row' }, ...tips.map((offer) => {
    const tip = button('', () => void purchase(offer, () => undefined), offer.stars === 100 ? 'primary' : '');
    tip.append(stars(offer.stars));
    tip.disabled = !mart.open;
    return tip;
  }));
  show(windowOf({ title: t.treat, onClose, narrow: true }, info(t.treatInfo), row, info(mart.open ? t.starsNote : t.martClosed, 'pd-note center')), onClose);
}

/** The «Look» rows of the hero window: look, effect, frame, each opening its choices; what is not owned leads to the shop. */
export function looksRows(heroClass: HeroClass, onShop: (shelf: Shelf) => void): HTMLElement {
  const box = el('div', { className: 'pd-looks' });
  const render = (open: string | null): void => {
    box.replaceChildren();
    for (const kind of ['skin', 'effect', 'frame'] as const) {
      const offers = kind === 'skin' ? OFFERS.filter((o) => o.kind === 'skin' && o.heroClass === heroClass) : shelf(kind, heroClass).filter((o) => o.frame !== 'patron' || mart.patron);
      const worn = offers.find((offer) => mart.owns(offer) && mart.isWorn(offer));
      const art = el('span', { className: 'pd-look-art' }, worn ? smallArt(worn, heroClass) : kind === 'skin' ? heroCanvas(heroClass, undefined, 2.5) : null);
      const row = el(
        'button',
        { className: 'pd-look' },
        art,
        el('span', { className: 'pd-look-label', textContent: t.lookRows[kind] }),
        el('span', { className: 'pd-look-value', textContent: worn ? offerName(worn) : kind === 'skin' ? t.plain : t.none }),
      );
      row.setAttribute('aria-expanded', String(open === kind));
      row.onclick = () => {
        audio.play('click');
        render(open === kind ? null : kind);
      };
      box.append(row);
      if (open !== kind) continue;
      const picker = el('div', { className: 'pd-look-picker' });
      const plain = el('button', { className: `pd-look-opt${worn ? '' : ' on'}` }, kind === 'skin' ? heroCanvas(heroClass, undefined, 2) : el('i'), el('span', { textContent: kind === 'skin' ? t.plain : t.none }));
      plain.onclick = () => {
        if (worn) mart.wear(worn, false);
        render(kind);
      };
      picker.append(plain);
      for (const offer of offers) {
        const owned = mart.owns(offer);
        const opt = el(
          'button',
          { className: `pd-look-opt${owned && mart.isWorn(offer) ? ' on' : ''}${owned ? '' : ' shop'}` },
          smallArt(offer, heroClass),
          owned ? el('span', { textContent: offerName(offer) }) : offer.stars > 0 ? stars(offer.stars, true) : el('span', { textContent: offerName(offer) }),
        );
        opt.onclick = () => {
          audio.play('click');
          if (owned) {
            mart.wear(offer);
            render(kind);
          } else {
            onShop(kind);
          }
        };
        picker.append(opt);
      }
      box.append(picker);
    }
  };
  render(null);
  return box;
}
