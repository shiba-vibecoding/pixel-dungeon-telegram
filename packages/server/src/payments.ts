import { emptyWallet, forSale, inSeason, offerBySku, SUBSCRIPTION_SECONDS, type Wallet } from '@pd/core';
import { ADMIN_USAGE, type AdminCommand, describePayments, isAdminChat, parseAdminCommand } from './admin';
import { invoiceText, speaksRussian } from './catalogue';
import type { WindowLimiter } from './limits';
import { recentCharges, type WalletChange } from './wallet';

/*
 * Pixel-Mart's payments in Telegram Stars (core.telegram.org/bots/payments-stars):
 * the server makes an invoice link for a player (createInvoiceLink, currency
 * XTR, no provider token); Telegram asks the bot's webhook to confirm the
 * checkout (pre_checkout_query, within 10 seconds), then tells it the payment
 * went through (successful_payment) or was refunded (refunded_payment), and
 * the player's wallet is updated. The same webhook answers the bot's commands:
 * /start, /paysupport and /terms, which Telegram's rules for payments require,
 * passes what players write to support on to the admin, and takes the admin's
 * own commands (admin.ts).
 *
 * Kept apart from the Worker so it can be tested with a fake Bot API.
 */

/** A call to the Bot API: method and parameters in, its `result` out. */
export type BotApi = (method: string, params: Record<string, unknown>) => Promise<unknown>;

/** Players' wallets, wherever they are kept; a change is applied where the wallet is, all at once (wallet.ts). */
export interface Wallets {
  get(user: number): Promise<Wallet>;
  apply(user: number, change: WalletChange): Promise<Wallet>;
}

/** What an invoice carries back to the webhook: who pays and for what (at most 128 bytes). */
interface Payload {
  u: number;
  s: string;
}

function parsePayload(text: unknown): Payload | null {
  try {
    const payload = JSON.parse(String(text)) as Payload;
    return typeof payload.u === 'number' && typeof payload.s === 'string' ? payload : null;
  } catch {
    return null;
  }
}

/** An invoice link for an offer, worded from the server's catalogue in the buyer's language, or why there is none. */
export async function createInvoice(
  api: BotApi, user: number, sku: string, language?: string, now = Date.now(),
): Promise<{ link: string } | { error: string }> {
  const offer = offerBySku(sku);
  if (!offer || !forSale(offer)) return { error: 'not for sale' };
  if (!inSeason(offer, now)) return { error: 'out of season' };
  const text = invoiceText(offer, language);
  const payload: Payload = { u: user, s: offer.sku };
  const link = await api('createInvoiceLink', {
    title: text.title,
    description: text.description,
    payload: JSON.stringify(payload),
    currency: 'XTR',
    prices: [{ label: text.title, amount: offer.stars }],
    ...(offer.subscription ? { subscription_period: SUBSCRIPTION_SECONDS } : {}),
  });
  return typeof link === 'string' ? { link } : { error: 'telegram refused' };
}

/** True if a checkout is for something on sale today, at its price, in Stars, by whom it was made out to. */
export function checkoutValid(checkout: NonNullable<TelegramUpdate['pre_checkout_query']>, now: number): boolean {
  const payload = parsePayload(checkout.invoice_payload);
  const offer = payload && offerBySku(payload.s);
  return !!offer && forSale(offer) && inSeason(offer, now)
    && checkout.currency === 'XTR' && checkout.total_amount === offer.stars && payload!.u === checkout.from.id;
}

/** What the bot says, in the player's language. */
export interface BotText {
  greeting(name: string): string;
  play: string;
  thanks: string;
  paySupport: string;
  /** A message to support went to the admin. */
  passedOn: string;
  /** There is no admin chat to pass it to (ADMIN_CHAT_ID unset), or the player wrote too much at once. */
  writeDirectly: string;
  terms: string;
  fullTerms: string;
}

/** Where players can always reach a person. */
const CONTACT = '@barboskich';

const EN: BotText = {
  greeting: (name) => `The dungeon awaits, ${name}. Go down, and mind the traps.`,
  play: 'Play Pixel Dungeon',
  thanks: 'Thank you! It is yours: open the game to wear it.',
  paySupport:
    'Trouble with a purchase? Write here, in one message, what happened and when; it goes to the developer, who ' +
    'answers within two days and refunds Stars for anything that did not arrive. Purchases are looks only: they ' +
    'never change the game itself.',
  passedOn: 'Thank you, your message has been passed on. The developer will answer here within two days.',
  writeDirectly: `Please write to ${CONTACT} about it: they answer within two days.`,
  terms:
    'Pixel-Mart sells looks for Telegram Stars: hero recolours, effects, portrait frames, camps for the home screen, and a monthly ' +
    'patronage. They change nothing in the game. Purchases are kept by your Telegram account; a patronage renews ' +
    'monthly until cancelled in Telegram. Refunds through /paysupport.',
  fullTerms: 'The full terms:',
};

const RU: BotText = {
  greeting: (name) => `Подземелье ждёт, ${name}. Спускайтесь и смотрите под ноги.`,
  play: 'Играть в Pixel Dungeon',
  thanks: 'Спасибо! Покупка ваша — откройте игру, чтобы надеть её.',
  paySupport:
    'Что-то не так с покупкой? Напишите сюда одним сообщением, что и когда случилось: оно уйдёт разработчику, ' +
    'он ответит в течение двух дней и вернёт звёзды за то, что не пришло. Все покупки — только облик, на саму ' +
    'игру они не влияют.',
  passedOn: 'Спасибо, ваше сообщение передано. Разработчик ответит здесь в течение двух дней.',
  writeDirectly: `Пожалуйста, напишите об этом ${CONTACT}: ответ — в течение двух дней.`,
  terms:
    'В Пиксель-Марте за звёзды Telegram продаётся облик: перекраски героев, эффекты, рамки портрета, привалы для главного экрана и подписка ' +
    '«Покровитель» на месяц. На игру они не влияют. Покупки привязаны к вашему аккаунту Telegram; подписка ' +
    'продлевается каждый месяц, пока вы не отмените её в Telegram. Возврат — через /paysupport.',
  fullTerms: 'Полные условия:',
};

const textFor = (language?: string): BotText => (speaksRussian(language) ? RU : EN);

export interface TelegramUpdate {
  pre_checkout_query?: { id: string; from: { id: number }; currency: string; total_amount: number; invoice_payload: string };
  message?: {
    message_id?: number;
    chat: { id: number; type: string };
    from?: { id: number; first_name?: string; last_name?: string; username?: string; language_code?: string; is_bot?: boolean };
    text?: string;
    caption?: string;
    photo?: unknown;
    document?: unknown;
    successful_payment?: {
      currency: string;
      total_amount: number;
      invoice_payload: string;
      telegram_payment_charge_id: string;
      subscription_expiration_date?: number;
    };
    refunded_payment?: { invoice_payload: string; telegram_payment_charge_id: string };
  };
}

type Message = NonNullable<TelegramUpdate['message']>;

/** How the bot is set up (wrangler.jsonc). */
export interface BotConfig {
  /** The Mini App's t.me link, for the play button. */
  appLink: string;
  /** The chat that receives support messages and may give admin commands (admin.ts). */
  adminChatId?: string;
  /** The terms page, for /terms. */
  termsUrl?: string;
  /** How often one player's messages reach the admin; unlimited without one. */
  supportLimiter?: WindowLimiter;
}

/** Handles one webhook update. */
export async function handleUpdate(update: TelegramUpdate, api: BotApi, wallets: Wallets, config: BotConfig, now = Date.now()): Promise<void> {
  const checkout = update.pre_checkout_query;
  if (checkout) {
    // Confirm only what we sell today, at its price, to whom it was made out.
    await api('answerPreCheckoutQuery', checkoutValid(checkout, now)
      ? { pre_checkout_query_id: checkout.id, ok: true }
      : { pre_checkout_query_id: checkout.id, ok: false, error_message: 'This offer is no longer available.' });
    return;
  }
  const message = update.message;
  if (!message || message.from?.is_bot) return;

  // The admin's chat may be a group: its commands are taken before the private-chat check.
  if (isAdminChat(message.chat.id, config.adminChatId)) {
    const command = parseAdminCommand(message.text ?? '');
    if (command) {
      await runAdminCommand(command, message.chat.id, api, wallets, now);
      return;
    }
  }
  if (message.chat.type !== 'private') return;
  const text = textFor(message.from?.language_code);

  const paid = message.successful_payment;
  if (paid) {
    const payload = parsePayload(paid.invoice_payload);
    if (payload && paid.currency === 'XTR') {
      const expiresAt = paid.subscription_expiration_date ? paid.subscription_expiration_date * 1000 : undefined;
      await wallets.apply(payload.u, {
        kind: 'pay', sku: payload.s, charge: paid.telegram_payment_charge_id, stars: paid.total_amount, at: now, ...(expiresAt ? { expiresAt } : {}),
      });
      await api('sendMessage', { chat_id: message.chat.id, text: text.thanks, ...playButton(text, config.appLink) });
    }
    return;
  }
  const refund = message.refunded_payment;
  if (refund) {
    const payload = parsePayload(refund.invoice_payload);
    if (payload) await wallets.apply(payload.u, { kind: 'refund', charge: refund.telegram_payment_charge_id });
    return;
  }

  const words = (message.text ?? '').trim();
  const command = words.startsWith('/') ? words.split(/\s|@/)[0]!.toLowerCase() : '';
  // "/paysupport <what happened>" is a message to support as much as one written after it.
  const toSupport = command === '/paysupport' ? /\s\S/.test(words) : !command && isSupportMessage(message);
  // The admin writing to the bot is not a support request to themselves.
  if (toSupport && message.from && !isAdminChat(message.chat.id, config.adminChatId)) {
    await passOn(message, text, api, wallets, config, now);
    return;
  }
  const reply =
    command === '/paysupport' ? text.paySupport
    : command === '/terms' ? (config.termsUrl ? `${text.terms}\n\n${text.fullTerms} ${config.termsUrl}` : text.terms)
    : text.greeting(message.from?.first_name ?? '');
  await api('sendMessage', { chat_id: message.chat.id, text: reply, ...playButton(text, config.appLink) });
}

/** A player's own words (or picture, or file), not a sticker or a service message. */
function isSupportMessage(message: Message): boolean {
  return message.message_id !== undefined && !!(message.text?.trim() || message.caption || message.photo || message.document);
}

/** Who wrote and what they paid for, so the admin can find the payment. */
export function supportHeader(from: NonNullable<Message['from']>, wallet: Wallet): string {
  const name = [from.first_name, from.last_name].filter(Boolean).join(' ');
  const charges = recentCharges(wallet, 5).map((c) => `${c.charge} (${c.sku}, ${c.stars}★)`);
  return [
    `Support message from ${from.id}${from.username ? ` @${from.username}` : ''}${name ? ` (${name})` : ''}`,
    charges.length ? `Recent charges: ${charges.join(', ')}` : 'No payments',
    `Answer: /reply ${from.id} <text>`,
  ].join('\n');
}

/** Passes a player's message to the admin, and tells the player it was passed on (or where to write). */
async function passOn(message: Message, text: BotText, api: BotApi, wallets: Wallets, config: BotConfig, now: number): Promise<void> {
  const from = message.from!;
  const admin = config.adminChatId?.trim();
  if (!admin || (config.supportLimiter && !config.supportLimiter.allow(String(from.id), now))) {
    await api('sendMessage', { chat_id: message.chat.id, text: text.writeDirectly });
    return;
  }
  await api('sendMessage', { chat_id: admin, text: supportHeader(from, await wallets.get(from.id)) });
  await api('forwardMessage', { chat_id: admin, from_chat_id: message.chat.id, message_id: message.message_id });
  await api('sendMessage', { chat_id: message.chat.id, text: text.passedOn });
}

async function runAdminCommand(command: AdminCommand, chat: number, api: BotApi, wallets: Wallets, now: number): Promise<void> {
  const say = (text: string): Promise<unknown> => api('sendMessage', { chat_id: chat, text });
  switch (command.kind) {
    case 'usage':
      await say(ADMIN_USAGE);
      return;
    case 'payments':
      await say(describePayments(command.user, await wallets.get(command.user), now));
      return;
    case 'reply':
      try {
        await api('sendMessage', { chat_id: command.user, text: command.text });
        await say(`Sent to ${command.user}.`);
      } catch (error) {
        await say(`Not sent: ${(error as Error).message}`);
      }
      return;
    case 'refund': {
      try {
        await api('refundStarPayment', { user_id: command.user, telegram_payment_charge_id: command.charge });
      } catch (error) {
        await say(`Telegram refused the refund: ${(error as Error).message}`);
        return;
      }
      // Telegram may also send a refunded_payment message; a refund applied twice changes nothing.
      const before = await wallets.get(command.user);
      const paid = before.charges[command.charge];
      await wallets.apply(command.user, { kind: 'refund', charge: command.charge });
      await say(`Refunded ${command.charge} to ${command.user}${paid ? ` (${paid.sku}, ${paid.stars}★)` : ' (not in the wallet)'}.`);
      return;
    }
  }
}

function playButton(text: BotText, appLink: string): Record<string, unknown> {
  // Opened over the whole screen (Bot API 8.0 direct links' mode).
  return appLink ? { reply_markup: { inline_keyboard: [[{ text: text.play, url: `${appLink}?mode=fullscreen` }]] } } : {};
}

/** The Bot API over HTTPS. */
export function botApi(token: string): BotApi {
  return async (method, params) => {
    const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    const body = (await response.json()) as { ok: boolean; result?: unknown; description?: string };
    if (!body.ok) throw new Error(`${method}: ${body.description ?? response.status}`);
    return body.result;
  };
}

export { emptyWallet };
