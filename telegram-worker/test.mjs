import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import worker from './src/index.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function environment(extra = {}) {
  return {
    ALLOWED_ORIGIN: 'https://shiba-vibecoding.github.io',
    BOT_TOKEN: 'test-token',
    WEBHOOK_SECRET: 'test-secret',
    MINI_APP_URL: 'https://shiba-vibecoding.github.io/pixel-dungeon-telegram/',
    SUPPORT_URL: 'https://t.me/barboskich',
    ...extra,
  };
}

function telegramMock(calls) {
  globalThis.fetch = async (url, options) => {
    const method = String(url).split('/').pop();
    const body = JSON.parse(options.body);
    calls.push({ method, body });
    const result = method === 'createInvoiceLink' ? 'https://t.me/$test_invoice' : true;
    return new Response(JSON.stringify({ ok: true, result }), {
      headers: { 'Content-Type': 'application/json' },
    });
  };
}

test('creates one localized 50 Stars invoice and configures the webhook', async () => {
  const calls = [];
  telegramMock(calls);
  const response = await worker.fetch(new Request('https://worker.example/invoice', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://shiba-vibecoding.github.io',
    },
    body: JSON.stringify({ language: 'ru' }),
  }), environment());

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { stars: 50, url: 'https://t.me/$test_invoice' });
  assert.equal(calls[0].method, 'setWebhook');
  assert.equal(calls[1].method, 'createInvoiceLink');
  assert.equal(calls[1].body.currency, 'XTR');
  assert.deepEqual(calls[1].body.prices, [{ label: 'Поддержка', amount: 50 }]);
  assert.equal(calls[1].body.payload, 'pixel_dungeon_support_50_v1:ru');
});

test('rejects invoice requests from another site', async () => {
  const response = await worker.fetch(new Request('https://worker.example/invoice', {
    method: 'POST',
    headers: { Origin: 'https://example.com' },
  }), environment());
  assert.equal(response.status, 403);
});

test('approves only the fixed Stars checkout', async () => {
  const calls = [];
  telegramMock(calls);
  const response = await worker.fetch(new Request('https://worker.example/telegram', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Telegram-Bot-Api-Secret-Token': 'test-secret',
    },
    body: JSON.stringify({ pre_checkout_query: {
      id: 'checkout-1',
      currency: 'XTR',
      total_amount: 50,
      invoice_payload: 'pixel_dungeon_support_50_v1:de',
    } }),
  }), environment());
  assert.equal(response.status, 200);
  assert.equal(calls[0].method, 'answerPreCheckoutQuery');
  assert.equal(calls[0].body.ok, true);
});

test('stores successful payment receipts and thanks the payer', async () => {
  const calls = [];
  const stored = [];
  telegramMock(calls);
  const env = environment({
    PAYMENTS: { put: async (key, value) => stored.push({ key, value: JSON.parse(value) }) },
  });
  const response = await worker.fetch(new Request('https://worker.example/telegram', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Telegram-Bot-Api-Secret-Token': 'test-secret',
    },
    body: JSON.stringify({ message: {
      from: { id: 7 },
      chat: { id: 8 },
      successful_payment: {
        currency: 'XTR',
        total_amount: 50,
        invoice_payload: 'pixel_dungeon_support_50_v1:uk',
        telegram_payment_charge_id: 'charge-1',
      },
    } }),
  }), env);
  assert.equal(response.status, 200);
  assert.equal(stored[0].key, 'charge:charge-1');
  assert.equal(stored[0].value.amount, 50);
  assert.equal(calls[0].method, 'sendMessage');
  assert.match(calls[0].body.text, /^Дякуємо/);
});
