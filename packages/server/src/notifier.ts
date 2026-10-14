import { DurableObject } from 'cloudflare:workers';
import { dayOf, weekOf } from '@pd/core';
import { boardObject, SEASON } from './boards';
import { CORS, json, jsonBody } from './http';
import type { Env } from './index';
import { botApi } from './payments';
import { speaksRussian } from './catalogue';
import { type Job, REMIND_HOUR, streakReminder, subKey, type Subscriber, WEEKLY_HOUR, weeklyResult } from './reminders';
import { verifyInitData, WEEK_SECONDS } from './telegram-auth';

/*
 * The bot's reminders, for players who asked for them (the game asks with
 * WebApp.requestWriteAccess first) and never more than one a day:
 *   - the daily streak at risk: the evening before it would break, if today's daily dungeon is not begun;
 *   - the week's result on Monday morning: the place on last week's board (and a medal for the top 10).
 * A player who blocks the bot is forgotten at the first message that fails.
 *
 *   POST /notify { initData, on }   asks for reminders, or stops them
 *
 * One object (Notifier, "all") keeps the subscribers and sends in small batches by its alarm, so a
 * long list never makes one invocation too long.
 */

/** Messages sent per alarm. */
const BATCH = 25;

export class Notifier extends DurableObject<Env> {
  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const body = (await request.json()) as Record<string, unknown>;
    const chat = Number(body.chat);
    if (!Number.isSafeInteger(chat)) return json({ error: 'bad chat' }, 400);
    const key = subKey(chat);
    const sub = await this.ctx.storage.get<Subscriber>(key);
    switch (url.pathname) {
      case '/subscribe':
        if (body.on) await this.ctx.storage.put(key, { streak: 0, last: null, ...sub, chat, ru: Boolean(body.ru) } satisfies Subscriber);
        else await this.ctx.storage.delete(key);
        return json({ on: Boolean(body.on) });
      case '/streak':
        // From the player's object when a daily dungeon begins; nothing is kept for those who did not ask.
        if (sub) await this.ctx.storage.put(key, { ...sub, streak: Number(body.streak) || 0, last: typeof body.last === 'string' ? body.last : sub.last, season: SEASON });
        return json({ ok: true });
      default:
        return json({ error: 'not found' }, 404);
    }
  }

  /** The hourly tick (index.ts scheduled): queues what is due now; the alarm sends it. */
  async tick(now: number): Promise<void> {
    const hour = new Date(now).getUTCHours();
    const monday = new Date(now).getUTCDay() === 1;
    const jobs: Job[] = [];
    const subs = await this.ctx.storage.list<Subscriber>({ prefix: 's:' });
    if (hour === REMIND_HOUR) {
      const today = dayOf(now);
      for (const [key, sub] of subs) {
        const job = streakReminder(sub, now);
        if (!job) continue;
        jobs.push(job);
        await this.ctx.storage.put(key, { ...sub, sent: today });
      }
    }
    if (monday && hour === WEEKLY_HOUR) {
      const week = weekOf(now - 7 * 86_400_000);
      const name = `week:${week}`;
      const response = await this.env.DAILY.get(this.env.DAILY.idFromName(boardObject(name))).fetch(`https://board/?name=${encodeURIComponent(name)}&owners=1&top=0`);
      const { owners = {}, total = 0 } = (await response.json()) as { owners?: Record<string, number>; total?: number };
      for (const [key, sub] of subs) {
        const place = owners[`tg${sub.chat}`];
        if (!place || sub.week === week) continue;
        jobs.push(weeklyResult(sub, week, place, total));
        await this.ctx.storage.put(key, { ...sub, week });
      }
    }
    if (jobs.length === 0) return;
    const queue = (await this.ctx.storage.get<Job[]>('queue')) ?? [];
    await this.ctx.storage.put('queue', [...queue, ...jobs]);
    if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(Date.now() + 1000);
  }

  override async alarm(): Promise<void> {
    const queue = (await this.ctx.storage.get<Job[]>('queue')) ?? [];
    const batch = queue.splice(0, BATCH);
    await this.ctx.storage.put('queue', queue);
    if (this.env.BOT_TOKEN) {
      const bot = botApi(this.env.BOT_TOKEN);
      const app = this.env.APP_LINK ?? 'https://t.me/pixel_dungeon_gamebot/pixel_dungeon';
      for (const job of batch) {
        try {
          await bot('sendMessage', {
            chat_id: job.chat, text: job.text,
            reply_markup: { inline_keyboard: [[{ text: job.button, url: job.start === 'play' ? app : `${app}?startapp=${job.start}` }]] },
          });
        } catch (error) {
          // Blocked, or the chat is gone: no more reminders there.
          if (/blocked|deactivated|chat not found|403/i.test(String(error))) await this.ctx.storage.delete(subKey(job.chat));
        }
      }
    }
    if (queue.length > 0) await this.ctx.storage.setAlarm(Date.now() + 1000);
  }
}

export const notifierStub = (env: Env): DurableObjectStub<Notifier> => env.NOTIFIER.get(env.NOTIFIER.idFromName('all'));

/** POST /notify: reminders on or off, for the Telegram player behind the init data. */
export async function notifyRoute(request: Request, env: Env): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (!env.BOT_TOKEN) return json({ error: 'reminders need Telegram' }, 503);
  const body = await jsonBody(request);
  if (!body || typeof body.initData !== 'string') return json({ error: 'bad json' }, 400);
  const user = await verifyInitData(body.initData, env.BOT_TOKEN, WEEK_SECONDS);
  if (!user) return json({ error: 'unauthorized' }, 401);
  const response = await notifierStub(env).fetch('https://notifier/subscribe', {
    method: 'POST', body: JSON.stringify({ chat: user.id, on: body.on === true, ru: speaksRussian(user.language_code) }),
  });
  return json(await response.json());
}
