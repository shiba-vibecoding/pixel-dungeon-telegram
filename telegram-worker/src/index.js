const STARS = 50;
const PAYLOAD = 'pixel_dungeon_support_50_v1';

const INVOICE_COPY = {
  en: { description: 'Voluntary support for the Telegram port. No gameplay bonuses.', label: 'Support' },
  ru: { description: 'Добровольная поддержка Telegram-порта без игровых бонусов.', label: 'Поддержка' },
  es: { description: 'Apoyo voluntario al port de Telegram, sin ventajas en el juego.', label: 'Apoyo' },
  fr: { description: 'Soutien volontaire au portage Telegram, sans avantage en jeu.', label: 'Soutien' },
  de: { description: 'Freiwillige Unterstützung für den Telegram-Port, ohne Spielvorteile.', label: 'Unterstützung' },
  pt_BR: { description: 'Apoio voluntário ao porte para Telegram, sem vantagens no jogo.', label: 'Apoio' },
  pl: { description: 'Dobrowolne wsparcie portu na Telegram, bez korzyści w grze.', label: 'Wsparcie' },
  it: { description: 'Supporto volontario al port per Telegram, senza vantaggi di gioco.', label: 'Supporto' },
  tr: { description: 'Telegram portuna gönüllü destek; oyun içi avantaj sağlamaz.', label: 'Destek' },
  uk: { description: 'Добровільна підтримка Telegram-порту без ігрових переваг.', label: 'Підтримка' },
  id: { description: 'Dukungan sukarela untuk port Telegram, tanpa keuntungan permainan.', label: 'Dukungan' },
  ja: { description: 'ゲーム内特典のない、Telegram移植版への任意の応援です。', label: '応援' },
  ko: { description: '게임 혜택 없이 Telegram 포팅 버전을 자발적으로 후원합니다.', label: '후원' },
  zh_CN: { description: '自愿支持 Telegram 移植版，不提供任何游戏优势。', label: '支持' },
  zh_TW: { description: '自願支持 Telegram 移植版，不提供任何遊戲優勢。', label: '支持' },
};

const THANKS_COPY = {
  en: 'Thank you for supporting the Pixel Dungeon Telegram port! ⭐',
  ru: 'Спасибо за поддержку Telegram-порта Pixel Dungeon! ⭐',
  es: '¡Gracias por apoyar el port de Pixel Dungeon para Telegram! ⭐',
  fr: 'Merci de soutenir le portage Telegram de Pixel Dungeon ! ⭐',
  de: 'Danke für deine Unterstützung des Pixel-Dungeon-Ports für Telegram! ⭐',
  pt_BR: 'Obrigado por apoiar o porte de Pixel Dungeon para Telegram! ⭐',
  pl: 'Dziękujemy za wsparcie portu Pixel Dungeon na Telegram! ⭐',
  it: 'Grazie per il supporto al port di Pixel Dungeon per Telegram! ⭐',
  tr: 'Pixel Dungeon Telegram portunu desteklediğin için teşekkürler! ⭐',
  uk: 'Дякуємо за підтримку Telegram-порту Pixel Dungeon! ⭐',
  id: 'Terima kasih telah mendukung port Pixel Dungeon untuk Telegram! ⭐',
  ja: 'Pixel DungeonのTelegram移植版を応援していただき、ありがとうございます！ ⭐',
  ko: 'Pixel Dungeon Telegram 포팅 버전을 후원해 주셔서 감사합니다! ⭐',
  zh_CN: '感谢你支持 Pixel Dungeon 的 Telegram 移植版！ ⭐',
  zh_TW: '感謝你支持 Pixel Dungeon 的 Telegram 移植版！ ⭐',
};

function normalizedLanguage(value) {
  const language = String(value || 'en').replace('-', '_');
  if (INVOICE_COPY[language]) return language;
  const base = language.split('_')[0];
  return INVOICE_COPY[base] ? base : 'en';
}

function paymentLanguage(payload) {
  if (typeof payload !== 'string' || !payload.startsWith(`${PAYLOAD}:`)) return null;
  const language = normalizedLanguage(payload.slice(PAYLOAD.length + 1));
  return `${PAYLOAD}:${language}` === payload ? language : null;
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
  });
}

function corsHeaders(env) {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}

async function telegram(env, method, data) {
  const response = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const result = await response.json();
  if (!response.ok || !result.ok) {
    throw new Error(`${method}: ${result.description || response.status}`);
  }
  return result.result;
}

async function ensureWebhook(request, env) {
  const webhookUrl = new URL('/telegram', request.url).toString();
  await telegram(env, 'setWebhook', {
    url: webhookUrl,
    secret_token: env.WEBHOOK_SECRET,
    allowed_updates: ['message', 'pre_checkout_query'],
  });
}

async function createInvoice(request, env) {
  const origin = request.headers.get('Origin') || '';
  if (origin !== env.ALLOWED_ORIGIN) {
    return json({ error: 'Origin is not allowed' }, 403, corsHeaders(env));
  }

  let body = {};
  try { body = await request.json(); } catch (error) {}
  const language = normalizedLanguage(body.language);
  const copy = INVOICE_COPY[language];

  await ensureWebhook(request, env);
  const url = await telegram(env, 'createInvoiceLink', {
    title: 'Pixel Dungeon — 50 ⭐',
    description: copy.description,
    payload: `${PAYLOAD}:${language}`,
    provider_token: '',
    currency: 'XTR',
    prices: [{ label: copy.label, amount: STARS }],
  });
  return json({ stars: STARS, url }, 200, corsHeaders(env));
}

async function answerCheckout(query, env) {
  const valid = paymentLanguage(query.invoice_payload) !== null &&
    query.currency === 'XTR' &&
    query.total_amount === STARS &&
    typeof query.id === 'string';
  const data = { pre_checkout_query_id: query.id, ok: valid };
  if (!valid) data.error_message = 'This invoice is no longer valid. Please reopen the support window.';
  await telegram(env, 'answerPreCheckoutQuery', data);
}

async function recordPayment(message, payment, env) {
  if (!env.PAYMENTS || typeof env.PAYMENTS.put !== 'function') return;
  const chargeId = payment.telegram_payment_charge_id;
  if (!chargeId) return;
  await env.PAYMENTS.put(`charge:${chargeId}`, JSON.stringify({
    chargeId,
    userId: message.from?.id || null,
    chatId: message.chat?.id || null,
    amount: payment.total_amount,
    currency: payment.currency,
    payload: payment.invoice_payload,
    paidAt: new Date().toISOString(),
  }));
}

async function sendHelp(message, env) {
  const command = String(message.text || '').split(/\s+/)[0].split('@')[0].toLowerCase();
  let text = '';
  if (command === '/terms') {
    text = 'Support is voluntary, costs 50 Telegram Stars and gives no gameplay bonuses or digital items.';
  } else if (command === '/support' || command === '/paysupport') {
    text = `Payment support: ${env.SUPPORT_URL}`;
  } else if (command === '/start') {
    text = `Play Pixel Dungeon: ${env.MINI_APP_URL}\n\nVoluntary support is available inside the game.`;
  }
  if (text) await telegram(env, 'sendMessage', { chat_id: message.chat.id, text });
}

async function handleTelegram(request, env) {
  const secret = request.headers.get('X-Telegram-Bot-Api-Secret-Token');
  if (!env.WEBHOOK_SECRET || secret !== env.WEBHOOK_SECRET) {
    return json({ error: 'Forbidden' }, 403);
  }

  const update = await request.json();
  if (update.pre_checkout_query) {
    await answerCheckout(update.pre_checkout_query, env);
  } else if (update.message?.successful_payment) {
    const payment = update.message.successful_payment;
    const language = paymentLanguage(payment.invoice_payload);
    if (payment.currency === 'XTR' && payment.total_amount === STARS &&
        language !== null) {
      await recordPayment(update.message, payment, env);
      await telegram(env, 'sendMessage', {
        chat_id: update.message.chat.id,
        text: THANKS_COPY[language] || THANKS_COPY.en,
      });
    }
  } else if (update.message?.text) {
    await sendHelp(update.message, env);
  }
  return json({ ok: true });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS' && url.pathname === '/invoice') {
      return new Response(null, { status: 204, headers: corsHeaders(env) });
    }
    if (request.method === 'POST' && url.pathname === '/invoice') {
      try {
        return await createInvoice(request, env);
      } catch (error) {
        console.error(error);
        return json({ error: 'Could not create invoice' }, 502, corsHeaders(env));
      }
    }
    if (request.method === 'POST' && url.pathname === '/telegram') {
      try {
        return await handleTelegram(request, env);
      } catch (error) {
        console.error(error);
        return json({ error: 'Webhook failed' }, 500);
      }
    }
    return json({ service: 'pixel-dungeon-stars', ok: true });
  },
};
