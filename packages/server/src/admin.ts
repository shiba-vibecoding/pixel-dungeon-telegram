import type { Wallet } from '@pd/core';
import { isDay } from './outages';
import { parseProblemId } from './problem';
import { recentCharges } from './wallet';

/*
 * The bot's commands for whoever looks after the game, taken only from the
 * chat named by ADMIN_CHAT_ID (wrangler.jsonc): refunding a payment, looking
 * up a player's payments and answering a support message. Parsing and
 * authorization are kept here, apart from the Bot API, so they can be tested.
 *
 *   /refund <user_id> <charge_id>   refundStarPayment, then the wallet gives the purchase back
 *   /payments <user_id>             the player's charges, newest first
 *   /reply <user_id> <text>         a message to the player from the bot
 *   /bughunter <report id>          a player's problem report is confirmed: its reporter gets the «Охотник за багами» badge
 *   /outage [<day> | remove <day>]  the days the server was down (YYYY-MM-DD): no streak broken, no freeze spent; no day: the list
 *
 * All of them work only from the admin chat (payments.ts asks isAdminChat first): anyone else's are not even commands.
 */

export type AdminCommand =
  | { kind: 'refund'; user: number; charge: string }
  | { kind: 'payments'; user: number }
  | { kind: 'reply'; user: number; text: string }
  | { kind: 'bughunter'; id: string }
  | { kind: 'outage'; op: 'list' }
  | { kind: 'outage'; op: 'add' | 'remove'; day: string }
  /** An admin command with arguments that do not fit: say how it goes. */
  | { kind: 'usage' };

export const ADMIN_USAGE = '/refund <user_id> <charge_id>\n/payments <user_id>\n/reply <user_id> <text>\n/bughunter <report id>\n/outage [<YYYY-MM-DD> | remove <YYYY-MM-DD>]';

/** What the admin's commands do beyond the bot's own calls: kept by the Worker (index.ts), injected here so that they can be tested. */
export interface AdminOps {
  /** A problem report is confirmed: its reporter gets the badge. 'unknown': no such report is kept. */
  bugHunter(id: string): Promise<'granted' | 'already' | 'unknown'>;
  /** The outage days after the change (or as they stand, with none). */
  outages(change?: { op: 'add' | 'remove'; day: string }): Promise<string[]>;
}

/** True only in the admin's chat; with no admin chat set, nobody is one. */
export function isAdminChat(chatId: number, adminChatId: string | undefined): boolean {
  return !!adminChatId && /^-?\d+$/.test(adminChatId.trim()) && String(chatId) === adminChatId.trim();
}

const USER = /^\d{1,15}$/;
/** Telegram's charge ids are opaque tokens: letters, digits and a few signs. */
const CHARGE = /^[A-Za-z0-9_.:-]{1,256}$/;

/** An admin command in a message's text, or null if the text is not one of them. */
export function parseAdminCommand(text: string): AdminCommand | null {
  const [head = '', ...args] = text.trim().split(/\s+/);
  const command = head.split('@')[0]!.toLowerCase();
  if (command === '/refund') {
    const [user, charge] = args;
    return args.length === 2 && USER.test(user!) && CHARGE.test(charge!) ? { kind: 'refund', user: Number(user), charge: charge! } : { kind: 'usage' };
  }
  if (command === '/payments') {
    return args.length === 1 && USER.test(args[0]!) ? { kind: 'payments', user: Number(args[0]) } : { kind: 'usage' };
  }
  if (command === '/reply') {
    // The text keeps its own spacing and lines: everything after the user id.
    const match = /^\S+\s+(\d{1,15})\s+([\s\S]+)$/.exec(text.trim());
    return match ? { kind: 'reply', user: Number(match[1]), text: match[2]!.slice(0, 4000) } : { kind: 'usage' };
  }
  if (command === '/bughunter') {
    const id = args.length === 1 ? parseProblemId(args[0]!) : null;
    return id ? { kind: 'bughunter', id } : { kind: 'usage' };
  }
  if (command === '/outage') {
    if (args.length === 0 || (args.length === 1 && args[0]!.toLowerCase() === 'list')) return { kind: 'outage', op: 'list' };
    if (args.length === 1 && isDay(args[0]!)) return { kind: 'outage', op: 'add', day: args[0]! };
    if (args.length === 2 && args[0]!.toLowerCase() === 'remove' && isDay(args[1]!)) return { kind: 'outage', op: 'remove', day: args[1]! };
    return { kind: 'usage' };
  }
  return null;
}

/** A player's payments, one line each, for the admin. */
export function describePayments(user: number, wallet: Wallet, now: number): string {
  const charges = recentCharges(wallet, 30);
  const lines = charges.map((c) => `${c.charge} · ${c.sku} · ${c.stars}★ · ${new Date(c.at).toISOString().slice(0, 16).replace('T', ' ')}`);
  const patron = wallet.patronUntil && wallet.patronUntil > now ? `\npatron until ${new Date(wallet.patronUntil).toISOString().slice(0, 10)}` : '';
  return `${user}: ${charges.length ? `${charges.length} payment(s)` : 'no payments'}${patron}${lines.length ? `\n${lines.join('\n')}` : ''}`;
}
