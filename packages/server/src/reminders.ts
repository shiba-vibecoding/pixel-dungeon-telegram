import { dayOf } from '@pd/core';
import { SEASON } from './boards';

/* What the bot's reminders say and when (notifier.ts sends them). Pure logic. */

export interface Subscriber {
  chat: number;
  ru: boolean;
  /** The streak as the player's object last told, and the last day it was kept (a daily begun). */
  streak: number;
  last: string | null;
  /** The last day a reminder went out, and the last week whose result did. */
  sent?: string;
  week?: string;
  /** The season that streak belongs to (boards.ts); a streak of an earlier season was wiped with the world and is not reminded of. */
  season?: number;
}

export type Job = { chat: number; text: string; button: string; start: string };

/** When the streak reminder goes (UTC hour): evening in Europe, before the day's end at midnight UTC. */
export const REMIND_HOUR = 17;
/** When last week's results go out on Monday (UTC hour). */
export const WEEKLY_HOUR = 8;
export const subKey = (chat: number): string => `s:${chat}`;

/** The streak reminder for a subscriber now, if one is due. */
export function streakReminder(sub: Subscriber, now: number): Job | null {
  const today = dayOf(now);
  const yesterday = dayOf(now - 86_400_000);
  if ((sub.season ?? 1) < SEASON || sub.streak < 2 || sub.last !== yesterday || sub.sent === today) return null;
  return {
    chat: sub.chat,
    text: sub.ru
      ? `🔥 Ваша серия — ${sub.streak} ${daysRu(sub.streak)} подряд — сгорит в полночь по UTC. Подземелье дня ждёт!`
      : `🔥 Your ${sub.streak}-day streak breaks at midnight UTC. Today's dungeon is waiting!`,
    button: sub.ru ? 'Спуститься' : 'Descend',
    start: 'daily',
  };
}

function daysRu(n: number): string {
  const tens = n % 100;
  const ones = n % 10;
  if (tens >= 11 && tens <= 14) return 'дней';
  return ones === 1 ? 'день' : ones >= 2 && ones <= 4 ? 'дня' : 'дней';
}

/** Last week's result for a subscriber who was on its board. */
export function weeklyResult(sub: Subscriber, week: string, place: number, total: number): Job {
  const medal = place <= 10;
  return {
    chat: sub.chat,
    text: sub.ru
      ? `Неделя ${week.split('-W')[1]} закрылась. Ваше место в недельном рейтинге: #${place} из ${total}.${medal ? '\n🏅 Вы в десятке лучших — медаль недели ваша!' : ''}\nНовая неделя уже идёт.`
      : `Week ${week.split('-W')[1]} is over. Your place on the weekly board: #${place} of ${total}.${medal ? '\n🏅 Top 10 — the week\'s medal is yours!' : ''}\nA new week has begun.`,
    button: sub.ru ? 'Играть' : 'Play',
    start: 'play',
  };
}

