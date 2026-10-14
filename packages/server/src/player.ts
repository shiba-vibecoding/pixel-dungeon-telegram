import { DurableObject } from 'cloudflare:workers';
import { type Action, dayOf, MAX_CHALLENGES, type HeroClass, HERO_CLASSES, isPatron, RULES_VERSION, type Wallet } from '@pd/core';
import { BOARD_KINDS, type BoardKind, boardName, boardOfRun, boardsFor } from './boards';
import { CORS, json, jsonBody } from './http';
import type { Env } from './index';
import { secretDailySeed } from './daily-seed';
import { outageDays } from './outages';
import { type DailyEntry, publicId } from './leaderboard';
import { claimAll, claimLetter, collectMail, type Lookup, noteEntered, readAll } from './mail';
import { newsSeenAfter, parseVersion } from './news';
import { grantPioneer } from './pioneer';
import { giveHonor, MAX_PROBLEM_BYTES, parseProblem, takeProblemSlot } from './problem';
import { readBody } from './secret';
import { sanitizeAction } from './messages';
import { EntryWriter, fromEntries, toEntries } from './run-store';
import { describe, ended, MAX_SYNC_ACTIONS, parseSlot, PlayerLogic, type RunSlot, type RunSummary, streakNow } from './runs';
import { notifierStub } from './notifier';
import { verifyInitData, WEEK_SECONDS } from './telegram-auth';

/*
 * Checked runs over HTTP (runs.ts):
 *
 *   POST /run   { initData, rules, op: 'start', slot, hero, challenges }   a new run: its id and world
 *               { initData, rules, op: 'sync', slot, run, from, actions, hash }  moves played on the device
 *               { initData, rules, op: 'get', slot }                         the run as the server has it
 *   POST /me    { initData }                     the profile: records, streak, trophies, mail, places now
 *               { initData, coachDone: true }    the step tutorial is done (kept with the profile, for every device)
 *               { initData, news: '2.4' }        the news of that version have been seen (kept the same way)
 *   POST /mail  { initData, op: 'readAll' | 'claim' | 'claimAll', letter }   the mailbox (mail.ts): its letters and trophies after
 *   POST /board { initData?, kind }              a board's best, and my place on it
 *   POST /problem { initData, text?, attach, info, actions?, errors? }   «Сообщить о проблеме» (problem.ts): at most five a day
 *
 * Each player's runs and profile live in their own Durable Object (Player), so a player's
 * requests are taken one at a time. Only Telegram players have checked runs: elsewhere the
 * game is played on the device alone, and counts nowhere.
 */

/** The largest sync: init data and MAX_SYNC_ACTIONS actions. */
const MAX_RUN_BYTES = 128 * 1024;
/** How many entries a board shows. */
const BOARD_TOP = 50;

interface Who {
  /** The account key: tg<Telegram id>, or the development id. */
  key: string;
  name: string;
}

/** The player behind a request: Telegram init data; without a bot token (development), the id the client gives. */
async function who(body: Record<string, unknown>, env: Env): Promise<Who | null> {
  if (env.BOT_TOKEN) {
    if (typeof body.initData !== 'string' || !body.initData) return null;
    const user = await verifyInitData(body.initData, env.BOT_TOKEN, WEEK_SECONDS);
    return user ? { key: `tg${user.id}`, name: (user.first_name || user.username || 'Hero').slice(0, 32) } : null;
  }
  const id = typeof body.id === 'string' ? body.id.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64) : '';
  return id ? { key: `dev${id}`, name: (typeof body.name === 'string' && body.name.slice(0, 32)) || 'Hero' } : null;
}

const playerStub = (env: Env, key: string): DurableObjectStub<Player> => env.PLAYER.get(env.PLAYER.idFromName(key));
const boardStub = (env: Env, name: string): DurableObjectStub => env.DAILY.get(env.DAILY.idFromName(name));
/** The key a board's public ids are made with: a server secret, so they cannot be worked back to accounts. */
const boardKey = (env: Env): string => env.BOT_TOKEN ?? 'development';

/** POST /run: to the player's own object, once they are known. */
export async function runRoute(request: Request, env: Env): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  const body = await jsonBody(request, MAX_RUN_BYTES);
  if (!body) return json({ error: 'bad json' }, 400);
  // A device on other rules would play the run otherwise than the server: it updates first.
  if (body.rules !== RULES_VERSION) return json({ error: 'rules', rules: RULES_VERSION }, 409);
  const player = await who(body, env);
  if (!player) return json({ error: 'unauthorized' }, 401);
  const response = await playerStub(env, player.key).fetch('https://player/run', {
    method: 'POST', body: JSON.stringify({ ...body, initData: undefined, player }),
  });
  return new Response(response.body, { status: response.status, headers: { 'Content-Type': 'application/json', ...CORS } });
}

/** POST /me: the profile. */
export async function meRoute(request: Request, env: Env): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const body = await jsonBody(request);
  if (!body) return json({ error: 'bad json' }, 400);
  const player = await who(body, env);
  if (!player) return json({ error: 'unauthorized' }, 401);
  const news = parseVersion(body.news);
  const response = await playerStub(env, player.key).fetch('https://player/me', {
    method: 'POST', body: JSON.stringify({ player, coachDone: body.coachDone === true, ...(news ? { news } : {}) }),
  });
  return new Response(response.body, { status: response.status, headers: { 'Content-Type': 'application/json', ...CORS } });
}

/** POST /mail: read, claim or claim all; the player's own object does it. */
export async function mailRoute(request: Request, env: Env): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const body = await jsonBody(request);
  if (!body) return json({ error: 'bad json' }, 400);
  const player = await who(body, env);
  if (!player) return json({ error: 'unauthorized' }, 401);
  const op = body.op === 'readAll' || body.op === 'claim' || body.op === 'claimAll' ? body.op : null;
  if (!op) return json({ error: 'bad op' }, 400);
  const id = typeof body.letter === 'string' ? body.letter.slice(0, 64) : '';
  const response = await playerStub(env, player.key).fetch('https://player/mail', { method: 'POST', body: JSON.stringify({ player, op, id }) });
  return new Response(response.body, { status: response.status, headers: { 'Content-Type': 'application/json', ...CORS } });
}

/**
 * POST /problem: a player's report of what went wrong. Anyone who sent the rules of an older build may send one
 * (they are the ones likeliest to need to), so the rules are not checked; the body is capped, the player known by
 * their init data, and their own object counts their reports of the day (problem.ts) before the store keeps this.
 */
export async function problemRoute(request: Request, env: Env): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  const text = await readBody(request, MAX_PROBLEM_BYTES);
  if (text === null) return json({ error: 'too big' }, 413);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return json({ error: 'bad json' }, 400);
  }
  if (typeof body !== 'object' || body === null) return json({ error: 'bad json' }, 400);
  const player = await who(body as Record<string, unknown>, env);
  if (!player) return json({ error: 'unauthorized' }, 401);
  const problem = parseProblem(body, Date.now());
  if (!problem) return json({ error: 'bad report' }, 400);
  const response = await playerStub(env, player.key).fetch('https://player/problem', { method: 'POST', body: JSON.stringify({ player, problem }) });
  return new Response(response.body, { status: response.status, headers: { 'Content-Type': 'application/json', ...CORS } });
}

/** POST /board: a board's best, and (for a known player) their place. */
export async function boardRoute(request: Request, env: Env): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const body = await jsonBody(request);
  if (!body) return json({ error: 'bad json' }, 400);
  const kind = (BOARD_KINDS as readonly unknown[]).includes(body.kind) ? (body.kind as BoardKind) : null;
  if (!kind) return json({ error: 'bad board' }, 400);
  const name = boardName(kind, Date.now());
  const player = await who(body, env);
  const me = player ? await publicId(boardKey(env), name, player.key) : null;
  const response = await boardStub(env, name).fetch(`https://board/?name=${encodeURIComponent(name)}${me ? `&me=${me}` : ''}&top=${BOARD_TOP}`);
  const payload = (await response.json()) as { rank: number | null; top: DailyEntry[]; total?: number; you?: DailyEntry };
  return json({ name, ...payload });
}

/** A player's checked runs and profile (runs.ts), kept in storage as run-store.ts cuts them. */
export class Player extends DurableObject<Env> {
  private logic: PlayerLogic | null = null;
  private readonly writer = new EntryWriter();
  /** A profile made just now: written with the first thing that is. */
  private fresh = false;

  private async load(): Promise<PlayerLogic> {
    if (!this.logic) {
      const entries = await this.ctx.storage.list<string>();
      this.writer.loaded(entries);
      const { profile, runs } = fromEntries(entries);
      // A player the server has never kept: the moment they came is noted (pioneer.ts). Those kept before have none.
      if (!entries.has('profile')) {
        profile.born = Date.now();
        this.fresh = true;
      }
      this.logic = new PlayerLogic(profile, runs);
    }
    return this.logic;
  }

  /** Writes what changed. `fresh`: slots whose run is new (all of it written); `touched`: depths a slot's run may have changed. */
  private async persist(fresh: ReadonlySet<RunSlot>, touched: ReadonlyMap<RunSlot, ReadonlySet<number>>): Promise<void> {
    const logic = this.logic!;
    const entries = toEntries(logic.profile, logic.runs, (key, slot, depth) =>
      fresh.has(slot) || touched.get(slot)?.has(depth) ? undefined : this.writer.get(key));
    const { put, remove } = this.writer.changes(entries);
    try {
      if (Object.keys(put).length > 0) await this.ctx.storage.put(put);
      if (remove.length > 0) await this.ctx.storage.delete(remove);
    } catch (error) {
      // What was written is no longer known: the next load reads it again.
      this.writer.reset();
      this.logic = null;
      throw error;
    }
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const body = (await request.json()) as Record<string, unknown> & { player: Who };
    const logic = await this.load();
    const now = Date.now();
    if (url.pathname === '/mail') return json(await this.mail(logic, body, now));
    if (url.pathname === '/honor') {
      // The admin confirmed a problem report (index.ts adminOps): the badge goes to the profile, once.
      const granted = giveHonor(logic.profile, String(body.honor ?? ''));
      if (granted) await this.persist(new Set(), new Map());
      return json({ granted });
    }
    if (url.pathname === '/problem') {
      const today = dayOf(now);
      const taken = takeProblemSlot(logic.profile.problems, today);
      if (!taken.ok) return json({ error: 'limit' }, 429);
      const before = logic.profile.problems;
      logic.profile.problems = taken.state;
      let id: string | null = null;
      try {
        const stored = await this.env.REPORTS.get(this.env.REPORTS.idFromName('all')).fetch('https://reports/problem', {
          method: 'POST', body: JSON.stringify({ problem: body.problem, by: body.player.key }),
        });
        if (stored.ok) id = ((await stored.json()) as { id: string }).id;
      } catch {
        // Told below.
      }
      // A report that could not be kept does not count against the day.
      if (id === null) logic.profile.problems = before;
      await this.persist(new Set(), new Map());
      return id === null ? json({ error: 'not kept' }, 502) : json({ id, left: Math.max(0, 5 - taken.state.count) });
    }
    if (url.pathname === '/me') {
      // The tutorial's end is kept once and for good; a light answer, the profile comes with the next ask.
      if (body.coachDone === true) {
        if (!logic.profile.coachDone) {
          logic.profile.coachDone = true;
          await this.persist(new Set(), new Map());
        }
        return json({ coachDone: true });
      }
      if (typeof body.news === 'string') {
        const seen = newsSeenAfter(logic.profile.newsSeen, body.news);
        if (seen !== logic.profile.newsSeen) {
          logic.profile.newsSeen = seen;
          await this.persist(new Set(), new Map());
        }
        return json({ news: seen });
      }
      return json(await this.me(logic, body.player, now));
    }
    const slot = parseSlot(body.slot);
    if (!slot) return json({ error: 'bad slot' }, 400);
    switch (body.op) {
      case 'start': {
        const heroClass = (HERO_CLASSES as readonly unknown[]).includes(body.hero) ? (body.hero as HeroClass) : 'warrior';
        const challenges = Number.isInteger(body.challenges) ? (body.challenges as number) & MAX_CHALLENGES : 0;
        const today = dayOf(now);
        const run = logic.start({
          slot, heroClass, challenges, name: body.player.name, seed: crypto.getRandomValues(new Uint32Array(1))[0]! >>> 1,
          ...(slot === 'daily' ? { dailySeed: await secretDailySeed(this.env.DAILY_SECRET, today) } : {}),
          id: crypto.randomUUID(), now, today, outages: slot === 'daily' ? await outageDays(this.env) : [],
        });
        await this.persist(new Set([slot]), new Map());
        // The reminders hear that the streak was kept today (they keep nothing for those who did not ask).
        const chat = /^tg(\d+)$/.exec(body.player.key)?.[1];
        if (slot === 'daily' && run.ranked && chat) {
          try {
            await notifierStub(this.env).fetch('https://notifier/streak', {
              method: 'POST', body: JSON.stringify({ chat: Number(chat), streak: logic.profile.streak.count, last: logic.profile.streak.last }),
            });
          } catch {
            // A reminder may go out needlessly; nothing else is lost.
          }
        }
        return json({ run: describe(run), world: run.world });
      }
      case 'get': {
        const run = logic.runs[slot];
        return json(run ? { run: describe(run), world: run.world, ...ended(run) } : { run: null });
      }
      case 'sync': {
        const raw = Array.isArray(body.actions) ? body.actions : [];
        if (raw.length > MAX_SYNC_ACTIONS) return json({ error: 'too many actions' }, 413);
        const actions: Action[] = [];
        for (const item of raw) {
          const action = sanitizeAction(item);
          if (!action) return json({ error: 'bad action' }, 400);
          actions.push(action);
        }
        const from = Number.isInteger(body.from) ? (body.from as number) : -1;
        const id = typeof body.run === 'string' ? body.run : '';
        const hash = typeof body.hash === 'string' ? body.hash : null;
        const result = logic.sync(slot, id, from, actions, hash, now);
        await this.persist(new Set(), new Map([[slot, result.touched]]));
        if (!result.finish) return json(result.reply);
        // The run has ended: onto its boards, and the places it took there with the answer (and any asked again).
        const run = logic.runs[slot]!;
        run.places = await this.submit(body.player, result.finish.summary, now);
        await this.persist(new Set(), new Map());
        return json({ ...result.reply, ...ended(run) });
      }
      default:
        return json({ error: 'bad op' }, 400);
    }
  }

  /** A finished run onto the boards it counts for; its place on each. */
  private async submit(player: Who, summary: RunSummary, now: number): Promise<Partial<Record<BoardKind, number | null>>> {
    const places: Partial<Record<BoardKind, number | null>> = {};
    const patron = await this.patron(player.key, now);
    for (const kind of boardsFor(summary)) {
      const name = boardOfRun(kind, summary, now);
      const entry: DailyEntry = {
        id: await publicId(boardKey(this.env), name, player.key), owner: player.key, name: player.name,
        heroClass: summary.heroClass, depth: summary.depth, level: summary.level, gold: summary.gold, won: summary.won,
        score: summary.score, turns: summary.turns, kills: summary.kills, at: now, ...(patron ? { patron } : {}),
      };
      noteEntered(this.logic!.profile, name);
      try {
        const response = await boardStub(this.env, name).fetch(`https://board/put?name=${encodeURIComponent(name)}`, { method: 'POST', body: JSON.stringify(entry) });
        places[kind] = ((await response.json()) as { rank: number | null }).rank;
      } catch {
        places[kind] = null;
      }
    }
    return places;
  }

  /** Whether a Telegram player is a patron now (Pixel-Mart): a star by their name on the boards. */
  private async patron(key: string, now: number): Promise<boolean> {
    if (!/^tg\d+$/.test(key)) return false;
    try {
      const wallet = (await (await this.env.WALLET.get(this.env.WALLET.idFromName(key)).fetch('https://wallet/')).json()) as Wallet;
      return isPatron(wallet, now);
    } catch {
      return false;
    }
  }

  /** What a finished board says of a player: their place and how many were on it (null: not on it, or the board is gone). */
  private standing(key: string): Lookup {
    return async (name) => {
      try {
        const response = await boardStub(this.env, name).fetch(`https://board/?name=${encodeURIComponent(name)}&owner=${encodeURIComponent(key)}&top=0`);
        const { owner, total } = (await response.json()) as { owner?: { rank: number }; total?: number };
        return owner ? { rank: owner.rank, ...(total ? { total } : {}) } : null;
      } catch {
        // Asked again next time.
        return 'error';
      }
    };
  }

  /** The mailbox: a letter read or claimed, or all of them; the letters and the trophies as they stand. */
  private async mail(logic: PlayerLogic, body: Record<string, unknown>, now: number): Promise<Record<string, unknown>> {
    const p = logic.profile;
    const op = body.op;
    const id = typeof body.id === 'string' ? body.id : '';
    const changed = op === 'claimAll' ? claimAll(p, now) > 0 : op === 'claim' ? claimLetter(p, id, now) === 'claimed' : op === 'readAll' ? readAll(p) : false;
    if (changed) await this.persist(new Set(), new Map());
    return { mail: p.mail, trophies: p.trophies };
  }

  /** The profile, with the places held now and any trophies of boards finished since last asked. */
  private async me(logic: PlayerLogic, player: Who, now: number): Promise<Record<string, unknown>> {
    const p = logic.profile;
    // Boards finished since last asked become letters (mail.ts); the trophies are claimed from them.
    let changed = await collectMail(p, now, this.standing(player.key));
    // «Первопроходец»: one letter for whoever played before the update (pioneer.ts).
    const releaseAt = Date.parse(this.env.RELEASE_AT ?? '');
    if (grantPioneer(p, Object.values(logic.runs), now, Number.isFinite(releaseAt) ? releaseAt : null)) changed = true;
    if (this.fresh) {
      this.fresh = false;
      changed = true;
    }
    if (changed) await this.persist(new Set(), new Map());
    const places: Partial<Record<BoardKind, number | null>> = {};
    const totals: Partial<Record<BoardKind, number>> = {};
    for (const kind of BOARD_KINDS) {
      const name = boardName(kind, now);
      try {
        const response = await boardStub(this.env, name).fetch(`https://board/?name=${encodeURIComponent(name)}&owner=${encodeURIComponent(player.key)}&top=0`);
        const answer = (await response.json()) as { owner?: { rank: number }; total?: number };
        places[kind] = answer.owner?.rank ?? null;
        totals[kind] = answer.total ?? 0;
      } catch {
        places[kind] = null;
      }
    }
    const today = dayOf(now);
    const runs = Object.fromEntries(
      Object.entries(logic.runs).map(([slot, run]) => {
        const hero = run.world.heroes[0];
        return [slot, { ...describe(run), over: Boolean(run.finished), depth: hero?.depth ?? 1, lvl: hero?.lvl ?? 1, heroClass: hero?.heroClass }];
      }),
    );
    return {
      name: p.name, games: p.games, wins: p.wins, deepest: p.deepest, best: p.best, bestByClass: p.bestByClass,
      arenaWaves: p.arenaWaves, arenaBest: p.arenaBest, streak: streakNow(p.streak, today, await outageDays(this.env)), dailyDone: p.dailyDate === today,
      badges: p.badges, history: p.history, trophies: p.trophies, mail: p.mail, coachDone: p.coachDone, newsSeen: p.newsSeen ?? null, honors: p.honors ?? [], places, totals, runs, today,
    };
  }
}
