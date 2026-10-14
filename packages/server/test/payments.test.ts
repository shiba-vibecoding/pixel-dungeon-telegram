import { describe, expect, it } from 'vitest';
import { emptyWallet, isPatron, type Wallet } from '@pd/core';
import { WindowLimiter } from '../src/limits';
import { type BotApi, type BotConfig, createInvoice, handleUpdate, type Wallets } from '../src/payments';
import { applyWalletChange, emptyRecord, type WalletRecord } from '../src/wallet';

const NOW = Date.UTC(2026, 9, 12);

/** A Bot API that remembers its calls and makes up invoice links; `fail` names methods that throw. */
function fakeApi(fail: string[] = []): { api: BotApi; calls: Array<{ method: string; params: Record<string, unknown> }> } {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const api: BotApi = async (method, params) => {
    calls.push({ method, params });
    if (fail.includes(method)) throw new Error(`${method}: Bad Request`);
    return method === 'createInvoiceLink' ? 'https://t.me/$invoice' : true;
  };
  return { api, calls };
}

/** Wallets in memory, applying changes as the WalletStore object does. */
function memoryWallets(): Wallets & { store: Map<number, Wallet> } {
  const records = new Map<number, WalletRecord>();
  const store = new Map<number, Wallet>();
  return {
    store,
    async get(user) {
      return store.get(user) ?? emptyWallet();
    },
    async apply(user, change) {
      const next = applyWalletChange(records.get(user) ?? emptyRecord(), change);
      records.set(user, next);
      store.set(user, next.wallet);
      return next.wallet;
    },
  };
}

const ADMIN = 900;
const config = (more: Partial<BotConfig> = {}): BotConfig => ({ appLink: 'https://t.me/bot/app', adminChatId: String(ADMIN), ...more });

const private_ = (user: number) => ({ chat: { id: user, type: 'private' }, from: { id: user, first_name: 'Ann', language_code: 'ru' } });
const fromAdmin = (text: string) => ({ message: { message_id: 1, chat: { id: ADMIN, type: 'private' }, from: { id: ADMIN }, text } });

const payment = (user: number, sku: string, charge: string, amount: number, expires?: number) => ({
  message: {
    ...private_(user),
    successful_payment: {
      currency: 'XTR', total_amount: amount, invoice_payload: JSON.stringify({ u: user, s: sku }), telegram_payment_charge_id: charge,
      ...(expires ? { subscription_expiration_date: expires } : {}),
    },
  },
});

describe('Pixel-Mart payments', () => {
  it('makes an invoice in Stars at the catalogue price, a subscription for the patron', async () => {
    const { api, calls } = fakeApi();
    expect(await createInvoice(api, 7, 'skin.mage.royal', 'en', NOW)).toEqual({ link: 'https://t.me/$invoice' });
    expect(calls[0]!.params).toMatchObject({ currency: 'XTR', prices: [{ amount: 75 }], payload: JSON.stringify({ u: 7, s: 'skin.mage.royal' }) });
    expect(calls[0]!.params.subscription_period).toBeUndefined();
    await createInvoice(api, 7, 'patron', 'en', NOW);
    expect(calls[1]!.params).toMatchObject({ prices: [{ amount: 99 }], subscription_period: 2_592_000 });
  });

  it('words the invoice from its own catalogue, in the buyer’s language', async () => {
    const { api, calls } = fakeApi();
    await createInvoice(api, 7, 'skin.huntress.royal', 'ru', NOW);
    await createInvoice(api, 7, 'frame.gold', 'en-GB', NOW);
    expect(calls[0]!.params).toMatchObject({ title: 'Облик охотницы: Королевский' });
    expect(calls[1]!.params).toMatchObject({ title: 'Frame: Gold', description: 'A frame for your portrait, seen by the party.' });
    for (const call of calls) expect(String(call.params.title).length).toBeLessThanOrEqual(32);
  });

  it('sells nothing that is not for sale or out of season', async () => {
    const { api } = fakeApi();
    expect(await createInvoice(api, 7, 'skin.mage.ash', 'en', NOW)).toEqual({ error: 'not for sale' });
    expect(await createInvoice(api, 7, 'nonsense', 'en', NOW)).toEqual({ error: 'not for sale' });
    expect(await createInvoice(api, 7, 'effect.snow', 'en', Date.UTC(2026, 6, 1))).toEqual({ error: 'out of season' });
  });

  it('confirms a checkout only at the right price, in Stars, in season, for the buyer it was made out to', async () => {
    const { api, calls } = fakeApi();
    const wallets = memoryWallets();
    const checkout = (from: number, amount: number, currency = 'XTR', sku = 'frame.gold', now = NOW) => handleUpdate({
      pre_checkout_query: { id: 'q', from: { id: from }, currency, total_amount: amount, invoice_payload: JSON.stringify({ u: 7, s: sku }) },
    }, api, wallets, config(), now);
    await checkout(7, 50);
    await checkout(7, 1);
    await checkout(8, 50);
    await checkout(7, 50, 'USD');
    // An invoice for the snow made in winter, paid in summer.
    await checkout(7, 50, 'XTR', 'effect.snow', Date.UTC(2026, 6, 1));
    await checkout(7, 50, 'XTR', 'effect.snow', Date.UTC(2026, 11, 20));
    expect(calls.map((c) => c.params.ok)).toEqual([true, false, false, false, false, true]);
  });

  it('a payment lands in the wallet once, a refund takes it back, the patronage keeps Telegram’s date', async () => {
    const { api, calls } = fakeApi();
    const wallets = memoryWallets();
    const pay = (sku: string, charge: string, amount: number, expires?: number) => handleUpdate(payment(7, sku, charge, amount, expires), api, wallets, config(), NOW);
    await pay('skin.warrior.shadow', 'c1', 75);
    await pay('skin.warrior.shadow', 'c1', 75);
    expect(wallets.store.get(7)!.owned).toEqual(['skin.warrior.shadow']);
    expect(calls.at(-1)).toMatchObject({ method: 'sendMessage', params: { chat_id: 7 } });
    await pay('patron', 'p1', 99, Math.floor(NOW / 1000) + 3600);
    expect(isPatron(wallets.store.get(7)!, NOW + 1000)).toBe(true);
    expect(isPatron(wallets.store.get(7)!, NOW + 7200_000)).toBe(false);
    await handleUpdate({
      message: { ...private_(7), refunded_payment: { invoice_payload: JSON.stringify({ u: 7, s: 'skin.warrior.shadow' }), telegram_payment_charge_id: 'c1' } },
    }, api, wallets, config(), NOW);
    expect(wallets.store.get(7)!.owned).toEqual([]);
    // The payment delivered again after its refund does not bring the purchase back.
    await pay('skin.warrior.shadow', 'c1', 75);
    expect(wallets.store.get(7)!.owned).toEqual([]);
  });

  it('sells the three camps at a hundred Stars, grants one to the wallet once, and takes it back with a refund', async () => {
    const { api, calls } = fakeApi();
    const wallets = memoryWallets();
    for (const sku of ['camp.cave', 'camp.prison', 'camp.hall']) {
      expect(await createInvoice(api, 7, sku, 'ru', NOW)).toEqual({ link: 'https://t.me/$invoice' });
    }
    expect(calls.map((c) => (c.params.prices as Array<{ amount: number }>)[0]!.amount)).toEqual([100, 100, 100]);
    expect(calls[0]!.params).toMatchObject({ title: 'Привал: Пещера с кристаллами', payload: JSON.stringify({ u: 7, s: 'camp.cave' }) });
    for (const call of calls) expect(String(call.params.title).length).toBeLessThanOrEqual(32);
    await createInvoice(api, 7, 'camp.hall', 'en', NOW);
    expect(calls.at(-1)!.params).toMatchObject({ title: 'Camp: Dwarven hall' });

    // The checkout is confirmed at the price only.
    calls.length = 0;
    const checkout = (amount: number) => handleUpdate({
      pre_checkout_query: { id: 'q', from: { id: 7 }, currency: 'XTR', total_amount: amount, invoice_payload: JSON.stringify({ u: 7, s: 'camp.cave' }) },
    }, api, wallets, config(), NOW);
    await checkout(99);
    await checkout(100);
    expect(calls.map((c) => c.params.ok)).toEqual([false, true]);

    const pay = (sku: string, charge: string, amount: number) => handleUpdate(payment(7, sku, charge, amount), api, wallets, config(), NOW);
    await pay('camp.cave', 'k1', 100);
    await pay('camp.cave', 'k1', 100);
    expect(wallets.store.get(7)!.owned).toEqual(['camp.cave']);
    await pay('camp.prison', 'k2', 100);
    expect(wallets.store.get(7)!.owned).toEqual(['camp.cave', 'camp.prison']);
    await handleUpdate({
      message: { ...private_(7), refunded_payment: { invoice_payload: JSON.stringify({ u: 7, s: 'camp.cave' }), telegram_payment_charge_id: 'k1' } },
    }, api, wallets, config(), NOW);
    expect(wallets.store.get(7)!.owned).toEqual(['camp.prison']);
    // Delivered again after its refund, the camp does not come back.
    await pay('camp.cave', 'k1', 100);
    expect(wallets.store.get(7)!.owned).toEqual(['camp.prison']);
  });

  it('answers /paysupport, /terms and other commands with the play button', async () => {
    const { api, calls } = fakeApi();
    const wallets = memoryWallets();
    for (const text of ['/paysupport', '/terms@pixel_dungeon_gamebot', '/start']) {
      await handleUpdate({ message: { ...private_(7), text } }, api, wallets, config({ termsUrl: 'https://example.org/terms.html' }), NOW);
    }
    expect(calls).toHaveLength(3);
    expect(String(calls[0]!.params.text)).toMatch(/вернёт звёзды/);
    expect(String(calls[1]!.params.text)).toMatch(/подписка/);
    expect(String(calls[1]!.params.text)).toMatch(/https:\/\/example\.org\/terms\.html$/);
    expect(String(calls[2]!.params.text)).toMatch(/Ann/);
    expect(calls[2]!.params.reply_markup).toEqual({ inline_keyboard: [[{ text: 'Играть в Pixel Dungeon', url: 'https://t.me/bot/app' }]] });
  });

  it('passes what a player writes on to the admin, with who they are and what they paid', async () => {
    const { api, calls } = fakeApi();
    const wallets = memoryWallets();
    await handleUpdate(payment(7, 'frame.gold', 'ch-1', 50), api, wallets, config(), NOW);
    calls.length = 0;
    const from = { id: 7, first_name: 'Ann', username: 'ann', language_code: 'en' };
    await handleUpdate({ message: { message_id: 55, chat: { id: 7, type: 'private' }, from, text: 'My frame never came' } }, api, wallets, config(), NOW);
    expect(calls.map((c) => [c.method, c.params.chat_id])).toEqual([['sendMessage', '900'], ['forwardMessage', '900'], ['sendMessage', 7]]);
    expect(String(calls[0]!.params.text)).toMatch(/7 @ann \(Ann\)[\s\S]*ch-1 \(frame\.gold, 50★\)[\s\S]*\/reply 7/);
    expect(calls[1]!.params).toMatchObject({ from_chat_id: 7, message_id: 55 });
    expect(String(calls[2]!.params.text)).toMatch(/passed on/);

    // "/paysupport <words>" is a message too.
    calls.length = 0;
    await handleUpdate({ message: { message_id: 56, chat: { id: 7, type: 'private' }, from, text: '/paysupport where is it' } }, api, wallets, config(), NOW);
    expect(calls.map((c) => c.method)).toEqual(['sendMessage', 'forwardMessage', 'sendMessage']);
  });

  it('without an admin chat, or past the limit, tells the player where to write instead', async () => {
    const { api, calls } = fakeApi();
    const wallets = memoryWallets();
    const message = (id: number) => ({ message: { message_id: id, ...private_(7), text: 'help' } });
    await handleUpdate(message(1), api, wallets, config({ adminChatId: undefined }), NOW);
    expect(calls.map((c) => c.method)).toEqual(['sendMessage']);
    expect(String(calls[0]!.params.text)).toMatch(/@barboskich/);

    calls.length = 0;
    const supportLimiter = new WindowLimiter(1, 60_000);
    await handleUpdate(message(2), api, wallets, config({ supportLimiter }), NOW);
    await handleUpdate(message(3), api, wallets, config({ supportLimiter }), NOW);
    expect(calls.map((c) => c.method)).toEqual(['sendMessage', 'forwardMessage', 'sendMessage', 'sendMessage']);
    expect(String(calls[3]!.params.text)).toMatch(/@barboskich/);
  });

  it('refunds and lists payments for the admin only', async () => {
    const { api, calls } = fakeApi();
    const wallets = memoryWallets();
    await handleUpdate(payment(7, 'skin.rogue.royal', 'ch-9', 75), api, wallets, config(), NOW);
    calls.length = 0;

    // Anyone else sending the command is answered as any player is, and nothing is refunded.
    await handleUpdate({ message: { message_id: 3, ...private_(8), text: '/refund 7 ch-9' } }, api, wallets, config(), NOW);
    expect(calls.some((c) => c.method === 'refundStarPayment')).toBe(false);
    expect(wallets.store.get(7)!.owned).toEqual(['skin.rogue.royal']);

    calls.length = 0;
    await handleUpdate(fromAdmin('/payments 7'), api, wallets, config(), NOW);
    expect(calls[0]).toMatchObject({ method: 'sendMessage', params: { chat_id: ADMIN } });
    expect(String(calls[0]!.params.text)).toMatch(/ch-9 · skin\.rogue\.royal · 75★/);

    calls.length = 0;
    await handleUpdate(fromAdmin('/refund 7 ch-9'), api, wallets, config(), NOW);
    expect(calls[0]).toEqual({ method: 'refundStarPayment', params: { user_id: 7, telegram_payment_charge_id: 'ch-9' } });
    expect(wallets.store.get(7)!.owned).toEqual([]);
    expect(String(calls[1]!.params.text)).toMatch(/Refunded ch-9 to 7 \(skin\.rogue\.royal, 75★\)/);
  });

  it('keeps the wallet when Telegram refuses a refund, and answers a malformed command with its usage', async () => {
    const { api, calls } = fakeApi(['refundStarPayment']);
    const wallets = memoryWallets();
    await handleUpdate(payment(7, 'frame.shadow', 'ch-2', 50), api, wallets, config(), NOW);
    calls.length = 0;
    await handleUpdate(fromAdmin('/refund 7 ch-2'), api, wallets, config(), NOW);
    expect(wallets.store.get(7)!.owned).toEqual(['frame.shadow']);
    expect(String(calls.at(-1)!.params.text)).toMatch(/refused/);
    await handleUpdate(fromAdmin('/refund seven'), api, wallets, config(), NOW);
    expect(String(calls.at(-1)!.params.text)).toMatch(/^\/refund <user_id> <charge_id>/);
  });

  it('ignores groups and other bots', async () => {
    const { api, calls } = fakeApi();
    await handleUpdate({ message: { chat: { id: 1, type: 'group' }, from: { id: 1 }, text: '/start' } }, api, memoryWallets(), config(), NOW);
    await handleUpdate({ message: { chat: { id: 2, type: 'private' }, from: { id: 2, is_bot: true }, text: '/start' } }, api, memoryWallets(), config(), NOW);
    expect(calls).toHaveLength(0);
  });
});
