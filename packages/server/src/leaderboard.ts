import { HERO_CLASSES } from '@pd/core';

/*
 * The daily dungeon's leaderboard: everyone plays the same seed, and each
 * player's best run of the day counts. Pure logic; the Durable Object stores
 * `entries()` and serves it over HTTP.
 */

export interface DailyResult {
  heroClass: string;
  depth: number;
  level: number;
  gold: number;
  won: boolean;
}

export interface DailyEntry extends DailyResult {
  id: string;
  name: string;
  score: number;
  at: number;
  /** Turns the run took: of equal scores, fewer turns rank higher; absent in entries from before it was kept. */
  turns?: number;
  /** The arena: monsters slain; anywhere, absent in boards from before it was kept. */
  kills?: number;
  /** A patron of the game (Pixel-Mart): a star by the name. */
  patron?: boolean;
  /** Who it is, privately: the player's account key, never served (see servedEntry). */
  owner?: string;
}

/** An entry as anyone may see it: without its owner. */
export function servedEntry(entry: DailyEntry): DailyEntry {
  const { owner: _owner, ...rest } = entry;
  return rest;
}

const HERO_CLASS_SET: ReadonlySet<string> = new Set(HERO_CLASSES);
export const BOARD_SIZE = 100;

/** The original's Rankings score: gold plus experience times depth, doubled for a win. */
export function score(result: DailyResult): number {
  return (result.gold + result.level * result.depth * 100) * (result.won ? 2 : 1);
}

/** The Amulet's depth: the deepest anyone can get, and the only place a run is won. */
const LAST_DEPTH = 26;

/** Checks a submitted result and clamps it to what the dungeon allows. */
export function parseResult(input: unknown): DailyResult | null {
  if (typeof input !== 'object' || input === null) return null;
  const r = input as Record<string, unknown>;
  const int = (value: unknown, min: number, max: number): number | null =>
    Number.isInteger(value) && (value as number) >= min && (value as number) <= max ? (value as number) : null;
  const depth = int(r.depth, 1, LAST_DEPTH);
  const level = int(r.level, 1, 30);
  const gold = int(r.gold, 0, 100_000);
  if (depth === null || level === null || gold === null || typeof r.won !== 'boolean') return null;
  if (typeof r.heroClass !== 'string' || !HERO_CLASS_SET.has(r.heroClass)) return null;
  return { heroClass: r.heroClass, depth, level, gold, won: r.won && depth === LAST_DEPTH };
}

/** Board order: higher score first; equal scores by fewer turns (an entry without the count goes after those with one), then who finished earlier. */
export function compareEntries(a: DailyEntry, b: DailyEntry): number {
  return b.score - a.score || (a.turns ?? Infinity) - (b.turns ?? Infinity) || a.at - b.at;
}

export class Leaderboard {
  constructor(private readonly board: DailyEntry[] = []) {}

  entries(): DailyEntry[] {
    return this.board;
  }

  /** Records a run if it beats the player's best; returns the player's place (1-based) or null. */
  submit(id: string, name: string, result: DailyResult, now: number): number | null {
    return this.put({ ...result, id, name: name.slice(0, 32), score: score(result), at: now });
  }

  /** Records an entry scored already (a checked run) if it beats the player's best; returns the player's place or null. */
  put(entry: DailyEntry): number | null {
    const id = entry.id;
    const previous = this.board.findIndex((e) => e.id === id);
    if (previous >= 0) {
      // A player's best run stands: a higher score, or the same score in fewer turns.
      const better = entry.score > this.board[previous]!.score
        || (entry.score === this.board[previous]!.score && (entry.turns ?? Infinity) < (this.board[previous]!.turns ?? Infinity));
      if (!better) return this.rank(id);
      this.board.splice(previous, 1);
    }
    this.board.push(entry);
    // Higher scores first; equal scores by fewer turns, and only then the earlier run.
    this.board.sort(compareEntries);
    this.board.length = Math.min(this.board.length, BOARD_SIZE);
    return this.rank(id);
  }

  rank(id: string): number | null {
    const index = this.board.findIndex((e) => e.id === id);
    return index >= 0 ? index + 1 : null;
  }

  /** A player's entry by their account key, and its place. */
  ofOwner(owner: string): { rank: number; entry: DailyEntry } | null {
    const index = this.board.findIndex((e) => e.owner === owner);
    return index >= 0 ? { rank: index + 1, entry: this.board[index]! } : null;
  }

  top(count: number): DailyEntry[] {
    return this.board.slice(0, count).map(servedEntry);
  }
}

/** How many results a player may send in a day; a real player finishes a handful of runs at most. */
export const MAX_SUBMISSIONS = 10;

/** Counts a player's result of the day: false, without counting, once they have sent MAX_SUBMISSIONS. */
export function countSubmission(counts: Record<string, number>, id: string, max = MAX_SUBMISSIONS): boolean {
  const sent = counts[id] ?? 0;
  if (sent >= max) return false;
  counts[id] = sent + 1;
  return true;
}

/** What the board shows for a player: an opaque id, the same all day, unlinkable across days. */
const PUBLIC_ID = /^p[0-9a-f]{16}$/;

export function isPublicId(id: string): boolean {
  return PUBLIC_ID.test(id);
}

/**
 * A player's id on one day's board: a keyed hash of the day and their account,
 * so the board never shows a Telegram id, and nobody can tell from two days'
 * boards that the same player is on both. `key` is a server secret.
 */
export async function publicId(key: string, date: string, playerId: string): Promise<string> {
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey('raw', encoder.encode(`daily-board:${key}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(`${date}\n${playerId}`)));
  return `p${[...mac.slice(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}
