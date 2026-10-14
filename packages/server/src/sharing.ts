import { DurableObject } from 'cloudflare:workers';
import { CORS, json, jsonBody } from './http';
import type { Env } from './index';
import { botApi } from './payments';
import { speaksRussian } from './catalogue';
import { verifyInitData, WEEK_SECONDS } from './telegram-auth';

/*
 * Sharing a result in Telegram:
 *
 *   POST /card              the result's picture (PNG body, init data in the X-Init-Data header): kept
 *                           a few days at a public address, which a story (WebApp.shareToStory) and a
 *                           challenge's photo need
 *   GET  /card/<id>.png     the picture
 *   POST /challenge         { initData, text, card?, mode }: a message the player may send to any chat
 *                           (Bot API savePreparedInlineMessage), its id for WebApp.shareMessage
 *
 * Each picture is a Durable Object of its own (Card), deleted by its alarm.
 */

/** The largest picture taken: the game's cards are 100–400 KB. */
const MAX_CARD_BYTES = 900 * 1024;
/** How long a picture is kept: a story lasts a day, a challenge is opened within days. */
const CARD_TTL_MS = 4 * 24 * 3600_000;
/** How many pictures one player may keep posting in a day, per Worker instance. */
const CARDS_PER_DAY = 30;
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const uploads = new Map<string, { day: string; count: number }>();

function allowUpload(user: number, now: number): boolean {
  const day = new Date(now).toISOString().slice(0, 10);
  const entry = uploads.get(String(user));
  if (!entry || entry.day !== day) {
    uploads.set(String(user), { day, count: 1 });
    return true;
  }
  if (entry.count >= CARDS_PER_DAY) return false;
  entry.count++;
  return true;
}

/** One picture: its bytes, and an alarm that deletes it. */
export class Card extends DurableObject<Env> {
  override async fetch(request: Request): Promise<Response> {
    if (request.method === 'PUT') {
      const bytes = new Uint8Array(await request.arrayBuffer());
      await this.ctx.storage.put('png', bytes);
      await this.ctx.storage.setAlarm(Date.now() + CARD_TTL_MS);
      return new Response(null, { status: 204 });
    }
    const bytes = await this.ctx.storage.get<Uint8Array>('png');
    if (!bytes) return new Response('not found', { status: 404 });
    return new Response(bytes, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' } });
  }

  override async alarm(): Promise<void> {
    await this.ctx.storage.deleteAll();
  }
}

const cardStub = (env: Env, id: string): DurableObjectStub<Card> => env.CARD.get(env.CARD.idFromName(id));

/** POST /card and GET /card/<id>.png. */
export async function cardRoute(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: { ...CORS, 'Access-Control-Allow-Headers': 'Content-Type, X-Init-Data' } });
  }
  const match = /^\/card\/([0-9a-f]{32})\.png$/.exec(url.pathname);
  if (request.method === 'GET' && match) return cardStub(env, match[1]!).fetch('https://card/');
  if (request.method !== 'POST' || url.pathname !== '/card') return json({ error: 'not found' }, 404);
  if (!env.BOT_TOKEN) return json({ error: 'sharing needs Telegram' }, 503);
  const user = await verifyInitData(request.headers.get('X-Init-Data') ?? '', env.BOT_TOKEN, WEEK_SECONDS);
  if (!user) return json({ error: 'unauthorized' }, 401);
  if (!allowUpload(user.id, Date.now())) return json({ error: 'too many pictures today' }, 429);
  const length = Number(request.headers.get('Content-Length') ?? 0);
  if (length > MAX_CARD_BYTES) return json({ error: 'too big' }, 413);
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.length > MAX_CARD_BYTES || PNG.some((b, i) => bytes[i] !== b)) return json({ error: 'not a picture' }, 400);
  const id = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
  await cardStub(env, id).fetch('https://card/', { method: 'PUT', body: bytes });
  return json({ url: `${url.origin}/card/${id}.png` });
}

/** POST /challenge: a prepared message with the result and a button into the same dungeon. */
export async function challengeRoute(request: Request, env: Env): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (!env.BOT_TOKEN) return json({ error: 'sharing needs Telegram' }, 503);
  const body = await jsonBody(request);
  if (!body || typeof body.initData !== 'string') return json({ error: 'bad json' }, 400);
  const user = await verifyInitData(body.initData, env.BOT_TOKEN, WEEK_SECONDS);
  if (!user) return json({ error: 'unauthorized' }, 401);
  const text = typeof body.text === 'string' ? body.text.slice(0, 900) : '';
  const card = typeof body.card === 'string' && body.card.startsWith(`${new URL(request.url).origin}/card/`) ? body.card : null;
  const mode = body.mode === 'arena' ? 'arena' : 'daily';
  const ru = speaksRussian(user.language_code);
  // Opened over the whole screen (Bot API 8.0 direct links' mode).
  const link = `${env.APP_LINK ?? 'https://t.me/pixel_dungeon_gamebot/pixel_dungeon'}?startapp=${mode}`;
  const button = { text: mode === 'arena' ? (ru ? '⚔ На арену' : '⚔ To the arena') : (ru ? '⚔ Принять вызов' : '⚔ Take the challenge'), url: link };
  const result = card
    ? { type: 'photo', id: crypto.randomUUID().slice(0, 32), photo_url: card, thumbnail_url: card, caption: text, reply_markup: { inline_keyboard: [[button]] } }
    : {
      type: 'article', id: crypto.randomUUID().slice(0, 32), title: 'Pixel Dungeon', description: text.slice(0, 120),
      input_message_content: { message_text: `${text}\n${link}` }, reply_markup: { inline_keyboard: [[button]] },
    };
  try {
    const prepared = (await botApi(env.BOT_TOKEN)('savePreparedInlineMessage', {
      user_id: user.id, result, allow_user_chats: true, allow_bot_chats: false, allow_group_chats: true, allow_channel_chats: true,
    })) as { id: string };
    return json({ id: prepared.id });
  } catch (error) {
    return json({ error: String(error instanceof Error ? error.message : error).slice(0, 200) }, 502);
  }
}

