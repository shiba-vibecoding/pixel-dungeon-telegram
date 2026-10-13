/*
 * Pixel-Mart: what the game sells for Telegram Stars, shared by the client
 * (the shop) and the server (invoices and payments), so a price is written
 * once. Nothing here touches the rules of the game: everything sold is a look
 * (MONETIZATION.md). Prices are in Stars.
 */

import type { HeroClass } from './actors';

export type OfferKind = 'skin' | 'effect' | 'frame' | 'camp' | 'patron' | 'tip';
export type SkinVariant = 'ash' | 'royal' | 'shadow';
export type EffectId = 'sparks' | 'fireflies' | 'snow';
export type FrameId = 'bronze' | 'gold' | 'shadow' | 'patron';
/** A camp on the home screen («Привал»): the cave with crystals, the prison yard, the dwarven hall. The plain one at the dungeon's gate is free. */
export type CampId = 'cave' | 'prison' | 'hall';

export interface Offer {
  sku: string;
  kind: OfferKind;
  /** Price in Telegram Stars; 0 for what only a badge (or the patronage) opens. */
  stars: number;
  /** A monthly subscription (the patron). */
  subscription?: boolean;
  /** Only sold between these days of the year ([month, day], inclusive, wrapping over the new year). */
  season?: { from: readonly [number, number]; to: readonly [number, number] };
  /** A badge that opens it for free (the client's badges, kept on the device). */
  badge?: string;
  /** For a hero's look: whose. */
  heroClass?: HeroClass;
  skin?: SkinVariant;
  effect?: EffectId;
  frame?: FrameId;
  camp?: CampId;
}

const HEROES: readonly HeroClass[] = ['warrior', 'mage', 'rogue', 'huntress'];

/** Thirty days, the length of a Telegram Stars subscription. */
export const SUBSCRIPTION_SECONDS = 2_592_000;

export const OFFERS: readonly Offer[] = [
  // Hero looks: recoloured sheets, every armour tier. The ash one is earned by slaying the second boss.
  ...HEROES.flatMap((heroClass): Offer[] => [
    { sku: `skin.${heroClass}.ash`, kind: 'skin', stars: 0, badge: 'boss2', heroClass, skin: 'ash' },
    { sku: `skin.${heroClass}.royal`, kind: 'skin', stars: 75, heroClass, skin: 'royal' },
    { sku: `skin.${heroClass}.shadow`, kind: 'skin', stars: 75, heroClass, skin: 'shadow' },
  ]),
  // Effects on the fx layer, seen by the whole party.
  { sku: 'effect.sparks', kind: 'effect', stars: 50, effect: 'sparks' },
  { sku: 'effect.fireflies', kind: 'effect', stars: 50, effect: 'fireflies' },
  { sku: 'effect.snow', kind: 'effect', stars: 50, effect: 'snow', season: { from: [12, 1], to: [2, 28] } },
  // Portrait frames; the bronze one for fifty foes slain, the patron's for patrons.
  { sku: 'frame.bronze', kind: 'frame', stars: 0, badge: 'slain2', frame: 'bronze' },
  { sku: 'frame.gold', kind: 'frame', stars: 50, frame: 'gold' },
  { sku: 'frame.shadow', kind: 'frame', stars: 50, frame: 'shadow' },
  { sku: 'frame.patron', kind: 'frame', stars: 0, frame: 'patron' },
  // Camps for the home screen: the same scene, another place around the fire.
  { sku: 'camp.cave', kind: 'camp', stars: 100, camp: 'cave' },
  { sku: 'camp.prison', kind: 'camp', stars: 100, camp: 'prison' },
  { sku: 'camp.hall', kind: 'camp', stars: 100, camp: 'hall' },
  // The patron: a month's subscription.
  { sku: 'patron', kind: 'patron', stars: 99, subscription: true },
  // Treating the developer.
  { sku: 'tip.25', kind: 'tip', stars: 25 },
  { sku: 'tip.100', kind: 'tip', stars: 100 },
  { sku: 'tip.500', kind: 'tip', stars: 500 },
];

export const offerBySku = (sku: string): Offer | undefined => OFFERS.find((offer) => offer.sku === sku);

/** An offer sold for Stars (not one only a badge or the patronage opens). */
export const forSale = (offer: Offer): boolean => offer.stars > 0;

/** Whether a seasonal offer is in season on a day (UTC). */
export function inSeason(offer: Offer, now: number): boolean {
  if (!offer.season) return true;
  const date = new Date(now);
  const day = (date.getUTCMonth() + 1) * 100 + date.getUTCDate();
  const from = offer.season.from[0] * 100 + offer.season.from[1];
  const to = offer.season.to[0] * 100 + offer.season.to[1];
  return from <= to ? day >= from && day <= to : day >= from || day <= to;
}

/** What a player has bought, kept by the server under their Telegram id. */
export interface Wallet {
  /** Offers bought for good (looks). */
  owned: string[];
  /** The patronage runs until then (ms since the epoch), renewed by Telegram each month. */
  patronUntil?: number;
  /** Stars given as tips, all told: the «Patron of the arts» badge. */
  tipped?: number;
  /** Every payment by its Telegram charge id, so a refund can be undone and nothing counts twice. */
  charges: Record<string, { sku: string; stars: number; at: number }>;
}

export const emptyWallet = (): Wallet => ({ owned: [], charges: {} });

export const isPatron = (wallet: Wallet, now: number): boolean => (wallet.patronUntil ?? 0) > now;

/** A payment Telegram confirmed (successful_payment). Paying twice for one charge changes nothing. */
export function walletPay(wallet: Wallet, sku: string, charge: string, stars: number, now: number, expiresAt?: number): Wallet {
  if (wallet.charges[charge]) return wallet;
  const offer = offerBySku(sku);
  if (!offer) return wallet;
  const next: Wallet = { ...wallet, owned: [...wallet.owned], charges: { ...wallet.charges, [charge]: { sku, stars, at: now } } };
  if (offer.kind === 'patron') {
    next.patronUntil = Math.max(wallet.patronUntil ?? 0, expiresAt ?? now + SUBSCRIPTION_SECONDS * 1000);
  } else if (offer.kind === 'tip') {
    next.tipped = (wallet.tipped ?? 0) + stars;
  } else if (!next.owned.includes(sku)) {
    next.owned.push(sku);
  }
  return next;
}

/** A refund (refunded_payment): what was bought with that charge goes away. */
export function walletRefund(wallet: Wallet, charge: string): Wallet {
  const paid = wallet.charges[charge];
  if (!paid) return wallet;
  const charges = { ...wallet.charges };
  delete charges[charge];
  const offer = offerBySku(paid.sku);
  const next: Wallet = { ...wallet, charges, owned: wallet.owned.filter((sku) => sku !== paid.sku) };
  if (offer?.kind === 'patron') delete next.patronUntil;
  if (offer?.kind === 'tip') next.tipped = Math.max(0, (wallet.tipped ?? 0) - paid.stars);
  return next;
}

/** What a hero wears, shown to the party: a look of their class, an effect, a portrait frame. */
export interface Look {
  skin?: SkinVariant;
  effect?: EffectId;
  frame?: FrameId;
  /** Set by the server from the wallet, never taken from the client. */
  patron?: boolean;
}

/**
 * What of a look the wearer may wear: bought, or opened by a badge (which only
 * the client knows of, so the server lets those through), or the patron's frame
 * while a patron. `heroClass` picks the skin's offer.
 */
export function allowedLook(look: Look, wallet: Wallet, heroClass: HeroClass, now: number): Look {
  const allowed: Look = {};
  const may = (sku: string): boolean => {
    const offer = offerBySku(sku);
    if (!offer) return false;
    if (offer.kind === 'frame' && offer.frame === 'patron') return isPatron(wallet, now);
    return wallet.owned.includes(sku) || offer.badge !== undefined;
  };
  if (look.skin && may(`skin.${heroClass}.${look.skin}`)) allowed.skin = look.skin;
  if (look.effect && may(`effect.${look.effect}`)) allowed.effect = look.effect;
  if (look.frame && may(`frame.${look.frame}`)) allowed.frame = look.frame;
  if (isPatron(wallet, now)) allowed.patron = true;
  return allowed;
}
