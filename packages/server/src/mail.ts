import { weekEnd } from '@pd/core';
import { finishedBoards, trophyPlaces } from './boards';

/*
 * The player's mailbox («Привал» → Почта). When a board closes and the player placed on it, a
 * letter comes: the day's top 3 a cup, the week's top 10 a medal. The trophy goes onto the
 * player's shelf only when the letter is claimed, and claiming is idempotent per board, so a
 * letter claimed twice (a request sent again) is one trophy. Letters are kept 30 days from the
 * board's close.
 *
 * Letters are made lazily (collectMail, asked by /me) from what the player's own record says they
 * entered (Profile.entered), plus yesterday's day and last week's, which every player may have
 * entered before the record was kept. A player away for days finds every letter waiting.
 *
 * What a letter gives is a list of gifts of one kind each; new kinds (a season's frame, a streak
 * frost) are added here and in the client's mail window, and old letters stay as they are.
 * Nothing here gives Stars.
 *
 * Pure logic over the profile; the board lookups are passed in (player.ts asks the board objects).
 */

/** How long a letter is kept, from the board's close (ms). */
export const MAIL_KEPT_MS = 30 * 86_400_000;
const DAY_MS = 86_400_000;
/** Most letters kept at once, and boards remembered. */
const MAIL_MAX = 60;
const BOOKS_MAX = 200;

export type LetterKind = 'cup' | 'medal';

/** What a letter gives. */
export type Gift = { type: 'trophy'; board: string; place: number };

export interface Letter {
  /** The board it is about: one letter a board. */
  id: string;
  kind: LetterKind;
  board: string;
  place: number;
  /** How many players the board held, when it is known. */
  total?: number;
  /** When the board closed. */
  at: number;
  gifts: Gift[];
  /** Opened in the mail window. */
  read?: boolean;
  /** When it was claimed. */
  claimed?: number;
}

export interface Trophy {
  board: string;
  place: number;
  at: number;
}

/** The parts of a profile the mail touches. */
export interface MailProfile {
  trophies: Trophy[];
  /** Boards looked at already (their names). */
  claimed: string[];
  /** The boards of a day or week the player's runs went onto. */
  entered: string[];
  mail: Letter[];
}

/** When a board closes (ms), or null for one that never does. */
export function boardEnd(board: string): number | null {
  const [kind, when = ''] = board.split(':');
  if (kind === 'daily') {
    const day = Date.parse(`${when}T00:00:00Z`);
    return Number.isFinite(day) ? day + DAY_MS : null;
  }
  if (kind === 'week' || kind === 'arena') {
    const match = /^(\d{4})-W(\d{2})$/.exec(when);
    if (!match) return null;
    const year = Number(match[1]);
    const week = Number(match[2]);
    // Week 1 holds January 4th; its Monday starts it.
    const jan4 = Date.UTC(year, 0, 4);
    const monday = jan4 - ((new Date(jan4).getUTCDay() + 6) % 7) * DAY_MS + (week - 1) * 7 * DAY_MS;
    return weekEnd(monday);
  }
  return null;
}

/** Whether a board has closed by `now` and its letter would still be kept. */
export function mailable(board: string, now: number): boolean {
  const end = boardEnd(board);
  return end !== null && end <= now && end + MAIL_KEPT_MS > now;
}

/** The letter's kind: a cup for the day, a medal for the week. The arena's boards are not offered, so write no letters. */
export function letterKind(board: string): LetterKind | null {
  const kind = board.split(':')[0];
  return kind === 'daily' ? 'cup' : kind === 'week' ? 'medal' : null;
}

/** A run went onto this board: remembered, so its letter can come once the board closes. */
export function noteEntered(profile: Pick<MailProfile, 'entered'>, board: string): void {
  if (!letterKind(board) || profile.entered.includes(board)) return;
  profile.entered = [board, ...profile.entered].slice(0, BOOKS_MAX);
}

/** The boards to ask about now: closed, still kept, and not looked at yet. */
export function boardsToCheck(profile: MailProfile, now: number): string[] {
  const all = new Set([...finishedBoards(now), ...profile.entered]);
  return [...all].filter((board) => letterKind(board) && mailable(board, now) && !profile.claimed.includes(board));
}

/** Letters past their keeping go; so do notes of boards no letter could come from any more. */
export function pruneMail(profile: MailProfile, now: number): boolean {
  const mail = profile.mail.filter((letter) => letter.at + MAIL_KEPT_MS > now);
  const entered = profile.entered.filter((board) => {
    const end = boardEnd(board);
    return end === null || end + MAIL_KEPT_MS > now;
  });
  const changed = mail.length !== profile.mail.length || entered.length !== profile.entered.length;
  profile.mail = mail;
  profile.entered = entered;
  return changed;
}

/** What a board says of a player: their place and how many were on it; null if they are not on it (or it is gone). */
export type Standing = { rank: number; total?: number } | null;
/** 'error': the board could not be asked; try again next time. */
export type Lookup = (board: string) => Promise<Standing | 'error'>;

/** A letter for a place won on a closed board, unless one is there (or the shelf has the trophy) already. */
export function addLetter(profile: MailProfile, board: string, standing: NonNullable<Standing>): Letter | null {
  const kind = letterKind(board);
  if (!kind || standing.rank > trophyPlaces(board)) return null;
  if (profile.mail.some((letter) => letter.id === board) || profile.trophies.some((trophy) => trophy.board === board)) return null;
  const letter: Letter = {
    id: board, kind, board, place: standing.rank, at: boardEnd(board) ?? 0,
    gifts: [{ type: 'trophy', board, place: standing.rank }],
    ...(standing.total ? { total: standing.total } : {}),
  };
  profile.mail = [letter, ...profile.mail].sort((a, b) => b.at - a.at).slice(0, MAIL_MAX);
  return letter;
}

/**
 * Looks at every board that closed since the last time (within the keeping) and makes the
 * letters. A board that cannot be asked is left for next time; one that is gone or never held
 * the player gives no letter, and no error. True if the profile changed.
 */
export async function collectMail(profile: MailProfile, now: number, lookup: Lookup): Promise<boolean> {
  let changed = pruneMail(profile, now);
  for (const board of boardsToCheck(profile, now)) {
    const standing = await lookup(board);
    if (standing === 'error') continue;
    if (standing) addLetter(profile, board, standing);
    profile.claimed = [board, ...profile.claimed].slice(0, BOOKS_MAX);
    changed = true;
  }
  return changed;
}

/** What claiming did. */
export type ClaimResult = 'claimed' | 'already' | 'none';

/** Claims a letter: its gifts go to the player (a trophy onto the shelf, once per board). */
export function claimLetter(profile: MailProfile, id: string, now: number): ClaimResult {
  const letter = profile.mail.find((candidate) => candidate.id === id);
  if (!letter) return 'none';
  if (letter.claimed !== undefined) return 'already';
  for (const gift of letter.gifts) {
    if (gift.type === 'trophy' && !profile.trophies.some((trophy) => trophy.board === gift.board)) {
      profile.trophies = [{ board: gift.board, place: gift.place, at: now }, ...profile.trophies].slice(0, 50);
    }
  }
  letter.claimed = now;
  letter.read = true;
  return 'claimed';
}

/** Claims every letter not claimed; how many were. */
export function claimAll(profile: MailProfile, now: number): number {
  let count = 0;
  for (const letter of [...profile.mail]) if (claimLetter(profile, letter.id, now) === 'claimed') count++;
  return count;
}

/** Marks a letter opened. */
export function readLetter(profile: MailProfile, id: string): boolean {
  const letter = profile.mail.find((candidate) => candidate.id === id);
  if (!letter || letter.read) return false;
  letter.read = true;
  return true;
}
