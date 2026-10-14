import type { Action, BadgeId, BadgeProgress, HeroClass, RunOutcome, World } from '@pd/core';
import { RULES_VERSION } from '@pd/core';

/*
 * Checked runs (the server's player.ts): the server hands out each run and plays the moves the
 * device sends it again on its own copy, so that what a run scores, the badges it earns and its
 * places on the boards are the server's word, not the device's. Only Telegram players have them
 * (the server knows them by their init data); in a plain browser the game is played on the
 * device alone and counts nowhere.
 */

export type RunSlot = 'dungeon' | 'arena' | 'daily';
export type BoardKind = 'daily' | 'week' | 'arena' | 'all' | 'arenaAll';

export interface RunMeta {
  id: string;
  slot: RunSlot;
  seq: number;
  /** Counts for the boards (a daily dungeon played again the same day does not). */
  ranked: boolean;
  date?: string;
}

export interface RunSummary extends RunOutcome {
  slot: RunSlot;
  ranked: boolean;
  at: number;
  date?: string;
}

export interface SyncAnswer {
  seq: number;
  /** The server's copy, when the device's parted from it. */
  run?: RunMeta;
  world?: World;
  badges?: BadgeId[];
  /** The run is over: how it ended, and its places on the boards. */
  finished?: RunSummary;
  places?: Partial<Record<BoardKind, number | null>>;
  record?: boolean;
  reason?: string;
}

/** What a letter gives; kinds are added as rewards come (the server's mail.ts). */
export type Gift = { type: 'trophy'; board: string; place: number };

/** A letter of the mailbox: one a finished board the player placed on (the server's mail.ts). */
export interface Letter {
  id: string;
  kind: 'cup' | 'medal' | 'pioneer';
  board: string;
  place: number;
  total?: number;
  /** When the board closed. */
  at: number;
  gifts: Gift[];
  read?: boolean;
  claimed?: number;
}

export type Trouble = 'offline' | 'unauthorized' | 'rules';

/** A player's report of a problem (the server's problem.ts): their words, and when attached, the run's last actions and the console's last errors. */
export interface ProblemReport {
  text: string;
  attach: boolean;
  info: {
    version: string;
    rules: number;
    build: string;
    run?: { id: string; seed: number; depth: number; slot: string; seq: number };
    device: string;
    platform: string;
    lang: string;
  };
  actions?: string[];
  errors?: string[];
}

export interface Profile {
  name: string;
  games: number;
  wins: number;
  deepest: number;
  best: number;
  bestByClass: Partial<Record<HeroClass, number>>;
  arenaWaves: number;
  arenaBest: number;
  streak: { last: string | null; count: number; best: number; freezes: number };
  /** Today's daily dungeon has been begun (its ranked try is spent). */
  dailyDone: boolean;
  badges: BadgeProgress;
  history: RunSummary[];
  trophies: Array<{ board: string; place: number; at: number }>;
  /** The mailbox: letters not yet expired. */
  mail: Letter[];
  /** The step tutorial was finished or skipped, on any device. */
  coachDone: boolean;
  /** The last version of «Что нового» seen, on any device. */
  newsSeen?: string | null;
  /** What the admin gave: 'bughunter' for a confirmed problem report. */
  honors?: string[];
  places: Partial<Record<BoardKind, number | null>>;
  /** How many players each board holds now. */
  totals?: Partial<Record<BoardKind, number>>;
  runs: Partial<Record<RunSlot, RunMeta & { over: boolean; depth: number; lvl: number; heroClass?: HeroClass }>>;
  today: string;
}

export interface BoardEntry {
  id: string;
  name: string;
  heroClass: HeroClass;
  score: number;
  depth: number;
  level: number;
  gold: number;
  won: boolean;
  kills?: number;
  patron?: boolean;
  at: number;
}

export interface BoardView {
  name: string;
  rank: number | null;
  top: BoardEntry[];
  total?: number;
  you?: BoardEntry;
}

export interface Identity {
  initData?: string;
  /** Development only (a server without a bot token takes the device's word for who it is). */
  id?: string;
  name?: string;
}

export interface RunApi {
  /** The result's picture at a public address (a story and a challenge need one); null if it cannot be had. */
  card(png: Blob): Promise<string | null>;
  /** A message with the result the player may send to any chat (WebApp.shareMessage); its id, or null. */
  challenge(text: string, card: string | null, mode: 'daily' | 'arena'): Promise<string | null>;
  /** The bot's reminders on or off; false if the server could not be told. */
  notify(on: boolean): Promise<boolean>;
  start(slot: RunSlot, hero: HeroClass, challenges: number): Promise<{ run: RunMeta; world: World } | Trouble>;
  sync(meta: RunMeta, actions: readonly Action[], hash: string | null, keepalive?: boolean): Promise<SyncAnswer | Trouble>;
  get(slot: RunSlot): Promise<{ run: RunMeta | null; world?: World } | Trouble>;
  me(): Promise<Profile | null>;
  /** The mailbox: read all, claim one (by its id) or claim all; the letters and trophies after it, or null. */
  mail(op: 'readAll' | 'claim' | 'claimAll', id?: string): Promise<{ mail: Letter[]; trophies: Profile['trophies'] } | null>;
  /** Tells the server the step tutorial is done, to keep it so on every device. */
  coachDone(): Promise<boolean>;
  /** Tells the server the news of this version have been seen. */
  news(version: string): Promise<boolean>;
  /** «Сообщить о проблеме»: the report, its id on success; 'limit' past the day's five, null when it could not be sent. */
  problem(report: ProblemReport): Promise<{ id: string } | 'limit' | null>;
  board(kind: BoardKind): Promise<BoardView | null>;
}

/** The server's HTTP address, from its WebSocket one. */
export const httpBase = (server: string): string => server.replace(/^ws(s?):/, 'http$1:');

/** Talks to the server's checked runs; null where there are none (no server, or not in Telegram outside development). */
export function runApi(server: string, identity: () => Identity, development: boolean): RunApi | null {
  if (!server || (!identity().initData && !development)) return null;
  const base = httpBase(server);
  const post = async <T>(path: string, body: Record<string, unknown>, keepalive = false): Promise<T | Trouble> => {
    try {
      const response = await fetch(`${base}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...identity(), rules: RULES_VERSION, ...body }),
        keepalive,
      });
      if (response.status === 401) return 'unauthorized';
      if (response.status === 409) return 'rules';
      if (!response.ok) return 'offline';
      return (await response.json()) as T;
    } catch {
      return 'offline';
    }
  };
  const quiet = async <T>(path: string, body: Record<string, unknown>): Promise<T | null> => {
    const answer = await post<T>(path, body);
    return typeof answer === 'string' ? null : answer;
  };
  return {
    start: (slot, hero, challenges) => post('/run', { op: 'start', slot, hero, challenges }),
    // A keepalive request (the app being put away) must stay under 64 KB: the batch is cut to fit.
    sync: (meta, actions, hash, keepalive = false) =>
      post('/run', { op: 'sync', slot: meta.slot, run: meta.id, from: meta.seq, actions, hash }, keepalive),
    get: (slot) => post('/run', { op: 'get', slot }),
    me: () => quiet('/me', {}),
    mail: (op, id) => quiet('/mail', { op, ...(id ? { letter: id } : {}) }),
    coachDone: async () => (await quiet<{ coachDone: boolean }>('/me', { coachDone: true }))?.coachDone === true,
    news: async (version) => (await quiet<{ news: string }>('/me', { news: version }))?.news !== undefined,
    problem: async (report) => {
      // The report goes in the body only (never in a URL), and is sent whatever rules this build runs: an old build is the likeliest to need it.
      try {
        const response = await fetch(`${base}/problem`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...identity(), ...report }) });
        if (response.status === 429) return 'limit';
        return response.ok ? ((await response.json()) as { id: string }) : null;
      } catch {
        return null;
      }
    },
    card: async (png) => {
      try {
        const response = await fetch(`${base}/card`, { method: 'POST', headers: { 'Content-Type': 'image/png', 'X-Init-Data': identity().initData ?? '' }, body: png });
        return response.ok ? ((await response.json()) as { url: string }).url : null;
      } catch {
        return null;
      }
    },
    challenge: async (text, card, mode) => (await quiet<{ id: string }>('/challenge', { text, card, mode }))?.id ?? null,
    notify: async (on) => (await quiet<{ on: boolean }>('/notify', { on })) !== null,
    board: (kind) => quiet('/board', { kind }),
  };
}
