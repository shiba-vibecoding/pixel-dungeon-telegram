import { DurableObject } from 'cloudflare:workers';
import {
  allowedLook, type ClientMessage, emptyWallet, type GameMode, type HeroClass, isPatron, type Look, type PlayerInfo, RULES_VERSION, type Wallet,
} from '@pd/core';
import { botApi, createInvoice, handleUpdate, type TelegramUpdate, type Wallets } from './payments';
import { ChunkWriter, chunkKeys, fromChunks } from './chunks';
import { guestId } from './guest';
import { type DailyEntry, isPublicId, Leaderboard, publicId, servedEntry } from './leaderboard';
import { CLOSE_TOO_BIG, MAX_MESSAGE_BYTES, MessageLimiter, messageBytes, WindowLimiter } from './limits';
import { parseClientMessage } from './messages';
import { type Delivery, RoomLogic, type RoomState } from './room-logic';
import {
  ADDRESS_HEADER, addReport, MAX_REPORT_BYTES, parseReport, type Report, REPORT_WINDOW_MS, REPORTS_PER_WINDOW,
} from './reports';
import { boardTtl } from './boards';
import { CORS, json, jsonBody } from './http';
import { boardRoute, mailRoute, meRoute, Player, problemRoute, runRoute } from './player';
import type { AdminOps } from './admin';
import { changeOutages, normalizeDays } from './outages';
import { adminNotice, KEEP_PROBLEMS, newId, type Problem, type StoredProblem } from './problem';
import { Card, cardRoute, challengeRoute } from './sharing';
import { Notifier, notifierStub, notifyRoute } from './notifier';
import { readBody, sameSecret } from './secret';
import { SignalLimiter, validSignal } from './signals';
import { DAY_SECONDS, type TelegramUser, verifyInitData, WEEK_SECONDS } from './telegram-auth';
import { applyWalletChange, emptyRecord, parseWalletChange, type WalletChange } from './wallet';

/*
 * Co-op server: one Durable Object per room holds the authoritative world.
 * WebSockets use the hibernation API, so an idle room costs nothing and is
 * restored from storage when the next message arrives.
 *
 *   GET /room/<name>  (WebSocket upgrade)
 *     ?initData=<Telegram.WebApp.initData>&hero=<class>   with BOT_TOKEN set
 *     ?gs=<guest secret>&name=<name>&hero=<class>         as a guest when ALLOW_GUESTS is "true" (guest.ts)
 *     ?id=<id>&name=<name>&hero=<class>                   in development (no BOT_TOKEN)
 *
 * The URL of a room's socket carries the player's init data, so nothing here
 * ever logs a request's URL, and wrangler.jsonc turns off Cloudflare's
 * invocation logs (which would record it).
 */

export interface Env {
  ROOM: DurableObjectNamespace<Room>;
  DAILY: DurableObjectNamespace<DailyBoard>;
  /** One per Telegram user: what they bought in Pixel-Mart. */
  WALLET: DurableObjectNamespace<WalletStore>;
  /** One per player: their checked runs and profile (player.ts). */
  PLAYER: DurableObjectNamespace<Player>;
  /** One per shared picture (sharing.ts). */
  CARD: DurableObjectNamespace<Card>;
  /** The bot's reminders (notifier.ts). */
  NOTIFIER: DurableObjectNamespace<Notifier>;
  /** The secret Telegram sends with every webhook call (setWebhook's secret_token). */
  WEBHOOK_SECRET?: string;
  /** The Mini App's t.me link, for the bot's play button. */
  APP_LINK?: string;
  /** The terms page, which the bot's /terms points to. */
  TERMS_URL?: string;
  /** The chat that receives /paysupport messages and may give the bot's admin commands (admin.ts). */
  ADMIN_CHAT_ID?: string;
  /** Bot token secret. When set, players must prove their identity with Telegram init data. */
  BOT_TOKEN?: string;
  /** "true" lets players without Telegram join as guests even when BOT_TOKEN is set. */
  ALLOW_GUESTS?: string;
  /** What went wrong, clients' and the server's own (reports.ts). */
  REPORTS: DurableObjectNamespace<ReportStore>;
  /** Secret that reads the reports back: GET /reports with Authorization: Bearer <REPORT_KEY>. */
  REPORT_KEY?: string;
  /** Days the server was down (YYYY-MM-DD, separated by commas): streaks take them as played (outages.ts). */
  OUTAGE_DAYS?: string;
  /** The moment of the Shattered release (ISO): profiles made before it are pioneers (pioneer.ts). */
  RELEASE_AT?: string;
}

/** A room left without players this long is deleted, dungeon and all. */
const ROOM_TTL_MS = 30 * 24 * 3600_000;
/** How long a room waits after a move before saving, to save a burst of moves as one write. */
const SAVE_DELAY_MS = 5000;
/** A day's leaderboard is kept this long after its day. */
const BOARD_TTL_MS = 60 * 24 * 3600_000;

/** Stores a report; never fails what it is reporting on. `address` is a client's, for the per-address limit. */
async function storeReport(env: Env, report: Report, address?: string): Promise<number> {
  try {
    const response = await env.REPORTS.get(env.REPORTS.idFromName('all')).fetch('https://reports/', {
      method: 'POST', body: JSON.stringify(report), headers: address ? { [ADDRESS_HEADER]: address } : {},
    });
    return response.status;
  } catch {
    // Reporting is best effort.
    return 500;
  }
}

/** Keeps a report of the server's own, in the log too. */
async function keepReport(env: Env, report: Report): Promise<void> {
  console.error(`[${report.kind}] ${report.message}`, report.context ?? {});
  await storeReport(env, report);
}

/** An exception of the server's own, as a report. */
function serverReport(error: unknown, where: string, context: Record<string, string | number | boolean> = {}): Report {
  const e = error instanceof Error ? error : new Error(String(error));
  return { at: Date.now(), kind: 'server', message: `${where}: ${e.message}`.slice(0, 500), ...(e.stack ? { stack: e.stack.slice(0, 1500) } : {}), context };
}

async function reports(request: Request, env: Env): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const store = env.REPORTS.get(env.REPORTS.idFromName('all'));
  if (request.method === 'POST') {
    // A client's report: sendBeacon posts it as text, which needs no CORS preflight.
    const body = await readBody(request, MAX_REPORT_BYTES);
    if (body === null) return new Response(null, { status: 413, headers: CORS });
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      return new Response(null, { status: 400, headers: CORS });
    }
    const report = parseReport(parsed, Date.now());
    if (!report) return new Response(null, { status: 400, headers: CORS });
    const country = (request as Request & { cf?: { country?: string } }).cf?.country;
    if (country) report.context = { ...report.context, country };
    const status = await storeReport(env, report, request.headers.get('CF-Connecting-IP') ?? 'unknown');
    return new Response(null, { status: status === 429 ? 429 : 204, headers: CORS });
  }
  // Reading them back takes the key.
  if (!env.REPORT_KEY || !(await sameSecret(request.headers.get('Authorization'), `Bearer ${env.REPORT_KEY}`))) {
    return new Response('not found', { status: 404 });
  }
  if (request.method === 'DELETE') return store.fetch('https://reports/', { method: 'DELETE' });
  return store.fetch('https://reports/');
}

/** What the admin's commands do (admin.ts AdminOps): the reports' object knows who sent a problem, and the outage days. */
function adminOps(env: Env): AdminOps {
  const store = env.REPORTS.get(env.REPORTS.idFromName('all'));
  return {
    async bugHunter(id) {
      const found = await store.fetch('https://reports/resolve', { method: 'POST', body: JSON.stringify({ id }) });
      if (!found.ok) return 'unknown';
      const { by } = (await found.json()) as { by: string };
      const gave = await env.PLAYER.get(env.PLAYER.idFromName(by)).fetch('https://player/honor', { method: 'POST', body: JSON.stringify({ honor: 'bughunter' }) });
      const { granted } = (await gave.json()) as { granted: boolean };
      await store.fetch('https://reports/hunter', { method: 'POST', body: JSON.stringify({ id }) });
      const chat = /^tg(\d+)$/.exec(by)?.[1];
      if (granted && chat && env.BOT_TOKEN) {
        try {
          await botApi(env.BOT_TOKEN)('sendMessage', {
            chat_id: Number(chat),
            text: 'Спасибо! Ваш отчёт подтверждён: значок «Охотник за багами» теперь в вашем профиле.\nThank you! Your report was confirmed: the «Bug hunter» badge is in your profile now.',
          });
        } catch {
          // The badge is given all the same.
        }
      }
      return granted ? 'granted' : 'already';
    },
    async outages(change) {
      const response = await store.fetch('https://reports/outages', { method: 'POST', body: JSON.stringify(change ?? {}) });
      return (await response.json()) as string[];
    },
  };
}


/** Reports worth a message to the admin chat at once: errors, desyncs, the server's own failures, a player's «report a problem». */
const ALERT_KINDS: ReadonlySet<string> = new Set(['server', 'error', 'rejection', 'desync']);
/** The admin chat hears of at most this many new problems an hour; the rest wait in the reports. */
const ALERTS_PER_HOUR = 6;

/** The reports, kept in one object: the latest few hundred, each address sending only so many. */
export class ReportStore extends DurableObject<Env> {
  private readonly limiter = new WindowLimiter(REPORTS_PER_WINDOW, REPORT_WINDOW_MS);
  private readonly alerts = new WindowLimiter(ALERTS_PER_HOUR, 3600_000);

  /** A new kind of problem (not a repeat of one kept) goes to the admin chat, if there is one. */
  private async alert(report: Report, kept: readonly Report[]): Promise<void> {
    const playerReport = report.kind === 'coop-log' && report.message.startsWith('player report');
    if (!ALERT_KINDS.has(report.kind) && !playerReport) return;
    if (kept.some((r) => r.kind === report.kind && r.message === report.message && r.stack === report.stack)) return;
    if (!this.env.BOT_TOKEN || !this.env.ADMIN_CHAT_ID || !this.alerts.allow('admin', Date.now())) return;
    const context = Object.entries(report.context ?? {}).map(([k, v]) => `${k}=${v}`).join(' ');
    const head = `⚠️ ${playerReport ? 'Игрок сообщил о проблеме' : `[${report.kind}]`} ${report.message}`.slice(0, 600);
    const text = [head, context, report.stack?.split('\n').slice(0, 3).join('\n') ?? ''].filter(Boolean).join('\n');
    try {
      await botApi(this.env.BOT_TOKEN)('sendMessage', { chat_id: this.env.ADMIN_CHAT_ID, text });
    } catch {
      // The report is kept anyway.
    }
  }

  private readonly problemAlerts = new WindowLimiter(30, 3600_000);

  /** A player's problem report: kept with its reporter apart, the admin told. */
  private async keepProblem(request: Request): Promise<Response> {
    const { problem, by } = (await request.json()) as { problem: Omit<Problem, 'id'>; by: string };
    const kept = (await this.ctx.storage.get<StoredProblem[]>('problems')) ?? [];
    let id = newId();
    while (kept.some((p) => p.id === id)) id = newId();
    const stored: StoredProblem = { ...problem, id, by };
    let all = [...kept, stored].slice(-KEEP_PROBLEMS);
    // Within a stored value's limit, the oldest going first.
    while (all.length > 1 && JSON.stringify(all).length > 1_000_000) all = all.slice(1);
    await this.ctx.storage.put('problems', all);
    if (this.env.BOT_TOKEN && this.env.ADMIN_CHAT_ID && this.problemAlerts.allow('admin', Date.now())) {
      try {
        await botApi(this.env.BOT_TOKEN)('sendMessage', { chat_id: this.env.ADMIN_CHAT_ID, text: adminNotice(stored), parse_mode: 'HTML' });
      } catch {
        // Kept all the same: the admin reads it with the reports.
      }
    }
    return json({ id });
  }

  override async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (request.method === 'POST' && path === '/problem') return this.keepProblem(request);
    if (request.method === 'POST' && (path === '/resolve' || path === '/hunter')) {
      const { id } = (await request.json()) as { id: string };
      const kept = (await this.ctx.storage.get<StoredProblem[]>('problems')) ?? [];
      const found = kept.find((p) => p.id === id);
      if (!found) return json({ error: 'unknown' }, 404);
      if (path === '/hunter') {
        found.hunter = true;
        await this.ctx.storage.put('problems', kept);
      }
      return json({ by: found.by, hunter: found.hunter === true });
    }
    if (path === '/outages') {
      let days = normalizeDays((await this.ctx.storage.get<string[]>('outages')) ?? []);
      if (request.method === 'POST') {
        const change = (await request.json()) as { op?: 'add' | 'remove'; day?: string };
        if ((change.op === 'add' || change.op === 'remove') && typeof change.day === 'string') {
          days = changeOutages(days, change.op, change.day);
          await this.ctx.storage.put('outages', days);
        }
      }
      return json(days);
    }
    if (request.method === 'POST') {
      const address = request.headers.get(ADDRESS_HEADER);
      if (address && !this.limiter.allow(address, Date.now())) return new Response(null, { status: 429 });
      const report = (await request.json()) as Report;
      const kept = (await this.ctx.storage.get<Report[]>('reports')) ?? [];
      await this.alert(report, kept);
      const reports = addReport(kept, report);
      await this.ctx.storage.put('reports', reports);
      return new Response(null, { status: 204 });
    }
    if (request.method === 'DELETE') {
      await this.ctx.storage.delete('reports');
      return new Response(null, { status: 204 });
    }
    const reports = (await this.ctx.storage.get<Report[]>('reports')) ?? [];
    // The players' problem reports read like the rest, with their id; who sent them is never served.
    const problems = ((await this.ctx.storage.get<StoredProblem[]>('problems')) ?? []).map(({ by: _by, ...p }): Report => ({
      at: p.at, kind: 'problem', message: `#${p.id} ${p.text || '(no text)'}`.slice(0, 500),
      context: {
        version: p.facts.version, rules: p.facts.rules, build: p.facts.build, platform: p.facts.platform, lang: p.facts.lang, device: p.facts.device,
        ...(p.facts.run ? { run: p.facts.run.id, seed: p.facts.run.seed, depth: p.facts.run.depth, slot: p.facts.run.slot, seq: p.facts.run.seq } : {}),
        ...(p.hunter ? { hunter: true } : {}),
      },
      ...(p.actions || p.errors ? { log: [...(p.errors ?? []).map((e) => `ERR ${e}`), ...(p.actions ?? [])].join('\n') } : {}),
    }));
    return new Response(JSON.stringify([...reports, ...problems]), { headers: { 'Content-Type': 'application/json' } });
  }
}

const HERO_CLASSES: readonly HeroClass[] = ['warrior', 'mage', 'rogue', 'huntress'];

function heroClassOf(params: URLSearchParams): HeroClass {
  const value = params.get('hero');
  return (HERO_CLASSES as readonly string[]).includes(value ?? '') ? (value as HeroClass) : 'warrior';
}

/** Who is asking: from Telegram init data, a guest's secret, or a client-chosen id (development). */
async function authenticate(params: URLSearchParams, env: Env): Promise<PlayerInfo | null> {
  const name = (params.get('name') || 'Hero').slice(0, 32);
  const heroClass = heroClassOf(params);
  if (env.BOT_TOKEN) {
    const initData = params.get('initData');
    if (initData) {
      const user = await verifyInitData(initData, env.BOT_TOKEN);
      if (!user) return null;
      return { id: `tg${user.id}`, name: (user.first_name || user.username || 'Hero').slice(0, 32), heroClass };
    }
    // Browser players outside Telegram, if allowed; they can never pose as a Telegram user, nor as another guest.
    // A build from before guest secrets sends its private id instead, which serves as its secret.
    if (env.ALLOW_GUESTS !== 'true') return null;
    const id = await guestId(params.get('gs') ?? params.get('id') ?? '');
    return id ? { id, name, heroClass } : null;
  }
  // Development: without a bot token the client is trusted. Monster ids start with '#', so player ids never may.
  const clientId = (params.get('id') || crypto.randomUUID()).replace(/^#+/, '').slice(0, 64) || 'anon';
  return { id: clientId, name, heroClass };
}

/**
 * Who is behind a room's socket: `id` is the hero they play (see RoomLogic.seatFor),
 * `owner` the player as authenticated. Sockets from before seats have no owner: it is their id.
 */
interface Seat extends PlayerInfo {
  owner?: string;
}

const ownerOf = (seat: Seat): string => seat.owner ?? seat.id;
const REPLACED = '#replaced';

export class Room extends DurableObject<Env> {
  private logic: RoomLogic | null = null;
  private readonly writer = new ChunkWriter();
  private readonly signals = new SignalLimiter();
  private readonly limiter = new MessageLimiter();
  /** True once 'idleSince' is known to be gone from storage while players are here. */
  private idleCleared = false;
  /** The live clock's next beat, while it runs (see runClock). */
  private clock: ReturnType<typeof setTimeout> | null = null;
  /** A save waiting for the moves to settle (see apply). */
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  /** The alarm as last set, null for none; undefined until known since the room woke. */
  private alarmAt: number | null | undefined = undefined;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Clients send a bare 'ping' every few seconds: mobile networks drop quiet sockets, and
    // half-open ones left co-op players frozen. The runtime answers it without waking a
    // hibernated room, so it never reaches webSocketMessage nor counts against any limit.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  private playerOf(ws: WebSocket): Seat {
    return ws.deserializeAttachment() as Seat;
  }

  /** The room, loaded or made; a new one is of the kind its creator asked for (`mode`), the dungeon by default. */
  private async room(mode: GameMode = 'dungeon'): Promise<RoomLogic> {
    if (!this.logic) {
      this.logic = RoomLogic.restore(await this.load(), Math.floor(Math.random() * 2 ** 31), mode);
      this.logic.restoreOnline(this.ctx.getWebSockets().map((ws) => this.playerOf(ws).id));
    }
    return this.logic;
  }

  /** True if someone (other than a socket that is going) is in the room. */
  private occupied(leaving?: WebSocket): boolean {
    return this.ctx.getWebSockets().some((ws) => ws !== leaving && !this.playerOf(ws).id.endsWith(REPLACED));
  }

  /**
   * Sends what the room produced, saves it and sets the alarm. Storage rows written are what
   * Cloudflare counts (100,000 a day on the free plan), and a party makes a couple of moves a
   * second: so a room is saved SAVE_DELAY_MS after a move, with every other move made meanwhile,
   * and at once when someone leaves or the run ends. A room lost between (a deploy, a crash) is
   * back a moment earlier; the players' clients take its snapshot on reconnecting.
   */
  private async apply(deliveries: Delivery[], leaving?: WebSocket): Promise<void> {
    this.deliver(deliveries);
    if (leaving || this.logic?.state().world.over) await this.flush();
    else this.saveSoon();
    await this.schedule(leaving);
    this.runClock();
  }

  /**
   * Live turns: the room wakes by itself when a beat that is ready comes due or a fight's wait runs
   * out (RoomLogic.nextWake), and plays what is due (pump); otherwise the next message wakes it.
   */
  private runClock(): void {
    if (this.clock) clearTimeout(this.clock);
    this.clock = null;
    const at = this.logic?.nextWake(Date.now()) ?? null;
    if (at === null) return;
    this.clock = setTimeout(() => {
      this.clock = null;
      void this.beat();
    }, Math.max(0, at - Date.now()));
  }

  private async beat(): Promise<void> {
    try {
      const room = await this.room();
      this.deliver(room.pump(Date.now()));
      if (room.state().world.over) await this.flush();
      else this.saveSoon();
      this.runClock();
    } catch (error) {
      await this.failed(error, 'clock');
    }
  }

  private saveSoon(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.persist().catch((error: unknown) => this.failed(error, 'save'));
    }, SAVE_DELAY_MS);
  }

  /** Saves now what is waiting. */
  private async flush(): Promise<void> {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    await this.persist();
  }

  /** Sets the alarm (null: none), writing only when it changes. */
  private async setAlarmAt(at: number | null): Promise<void> {
    if (at === this.alarmAt) return;
    this.alarmAt = at;
    if (at === null) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(at);
  }

  /**
   * One alarm serves two ends: the turn timeout while someone holds the party up,
   * and, once the last player has left, the room's deletion ROOM_TTL_MS later.
   */
  private async schedule(leaving?: WebSocket): Promise<void> {
    const deadline = this.logic?.deadline();
    if (this.occupied(leaving)) {
      // Once per wake-up is enough: every action comes through here, and writes are counted.
      if (!this.idleCleared) await this.ctx.storage.delete('idleSince');
      this.idleCleared = true;
    } else {
      this.idleCleared = false;
      let idleSince = await this.ctx.storage.get<number>('idleSince');
      if (idleSince === undefined) {
        idleSince = Date.now();
        await this.ctx.storage.put('idleSince', idleSince);
      }
      if (!deadline) {
        await this.setAlarmAt(idleSince + ROOM_TTL_MS);
        return;
      }
    }
    await this.setAlarmAt(deadline ?? null);
  }

  override async alarm(): Promise<void> {
    // The alarm that woke the room is spent.
    this.alarmAt = null;
    try {
      if (!this.occupied()) {
        const idleSince = await this.ctx.storage.get<number>('idleSince');
        if (idleSince !== undefined && Date.now() >= idleSince + ROOM_TTL_MS) {
          await this.expire();
          return;
        }
      }
      const room = await this.room();
      await this.apply(room.tick(Date.now()));
    } catch (error) {
      await this.failed(error, 'alarm');
    }
  }

  /** Nobody has played here for ROOM_TTL_MS: the room goes, and a later visitor starts a new one. */
  private async expire(): Promise<void> {
    this.logic = null;
    this.writer.reset();
    this.alarmAt = null;
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }

  /**
   * Something threw while the room was changing: tell whoever looks after the game, and drop
   * what is in memory, which may be half changed. The next message reloads the room as last
   * saved; nothing of the failed change was sent, so the players are still in step with it.
   */
  private async failed(error: unknown, where: string): Promise<void> {
    const turn = this.logic?.state().world?.turn;
    this.logic = null;
    this.writer.reset();
    await keepReport(this.env, serverReport(error, `room ${where}`, { ...(turn !== undefined ? { turn } : {}), players: this.ctx.getWebSockets().length }));
  }

  override async fetch(request: Request): Promise<Response> {
    const params = new URL(request.url).searchParams;
    const player = await authenticate(params, this.env);
    if (!player) {
      return new Response('unauthorized', { status: 401 });
    }

    // A player reconnecting from another tab replaces the old connection.
    for (const ws of this.ctx.getWebSockets()) {
      const seat = this.playerOf(ws);
      if (ownerOf(seat) === player.id && !seat.id.endsWith(REPLACED)) {
        ws.serializeAttachment({ ...seat, id: `${seat.id}${REPLACED}` });
        ws.close(4000, 'replaced by a new connection');
      }
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    // A client on other rules would drift from the room: it reloads into the current build.
    // (A build from before the check sends no version: it is turned away too, and loads the new one when reopened.)
    if (params.get('v') !== String(RULES_VERSION)) {
      server.accept();
      server.close(4002, 'the game has been updated');
      return new Response(null, { status: 101, webSocket: client });
    }
    // The creator's link says what kind of room it is (only a room that does not exist yet listens).
    const room = await this.room(params.get('mode') === 'arena' ? 'arena' : 'dungeon');
    const heroId = room.seatFor(player.id, Date.now());
    if (heroId === null) {
      // Remember since when the absent have been away, so their seats can be freed in time.
      await this.persist();
      // Accept just to say why, then close: a failed upgrade would look like a network error.
      server.accept();
      server.close(4001, 'the party is full');
      return new Response(null, { status: 101, webSocket: client });
    }
    if (heroId !== player.id) {
      // A hero taken over (or a new one under another id): no look of anyone else's on it.
      const looks = await this.looks();
      if (looks[heroId]) {
        delete looks[heroId];
        await this.ctx.storage.put('looks', looks);
      }
    }
    const seat: Seat = { ...player, id: heroId, owner: player.id };
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment(seat);
    await this.apply(room.connect({ id: heroId, name: player.name, heroClass: player.heroClass }, Date.now()));
    // What everyone already in the room wears.
    this.deliver([{ to: [heroId], message: { type: 'looks', looks: await this.looks() } }]);
    return new Response(null, { status: 101, webSocket: client });
  }

  /** What the players of this room wear (Pixel-Mart), by hero id; kept so a hibernated room remembers. */
  private async looks(): Promise<Record<string, Look>> {
    return (await this.ctx.storage.get<Record<string, Look>>('looks')) ?? {};
  }

  /** A player's look, checked against their wallet (a Telegram player's purchases), then shown to the room. */
  private async wear(seat: Seat, look: Look): Promise<void> {
    const telegram = /^tg(\d+)$/.exec(ownerOf(seat));
    const wallet = telegram ? await wallets(this.env).get(Number(telegram[1])) : emptyWallet();
    // In development (no bot token) the client is trusted, as it is with its identity.
    const allowed = this.env.BOT_TOKEN ? allowedLook(look, wallet, seat.heroClass, Date.now()) : look;
    const looks = { ...(await this.looks()), [seat.id]: allowed };
    await this.ctx.storage.put('looks', looks);
    const everyone = this.ctx.getWebSockets().map((ws) => this.playerOf(ws).id);
    this.deliver([{ to: everyone, message: { type: 'looks', looks } }]);
  }

  override async webSocketMessage(ws: WebSocket, data: string | ArrayBuffer): Promise<void> {
    // Nothing a client needs to say is this big: whatever sent it is not the game.
    if (messageBytes(data) > MAX_MESSAGE_BYTES) {
      ws.close(CLOSE_TOO_BIG, 'message too big');
      return;
    }
    // A frame that is not JSON (a 'ping' the runtime did not answer, say) is ignored without a word.
    let raw: unknown;
    try {
      raw = JSON.parse(typeof data === 'string' ? data : new TextDecoder().decode(data));
    } catch {
      return;
    }
    // Rebuilt from the fields the room knows: nothing else reaches the world or the other players.
    const message = parseClientMessage(raw);
    if (!message) return;
    const seat = this.playerOf(ws);
    const now = Date.now();
    if (message.type === 'signal') {
      this.relay(seat, message.signal);
      return;
    }
    if (!this.limiter.allow(seat.id, message.type, now)) {
      // An action dropped unanswered would leave the client waiting for it; the rest can simply be dropped.
      if (message.type === 'act') this.deliver([{ to: [seat.id], message: { type: 'rejected', reason: 'too fast' } }]);
      return;
    }
    let clientMessage: ClientMessage;
    if (message.type === 'act') {
      if (!message.action) {
        this.deliver([{ to: [seat.id], message: { type: 'rejected', reason: 'unknown action' } }]);
        return;
      }
      clientMessage = { type: 'act', action: message.action };
    } else {
      clientMessage = message;
    }
    try {
      if (clientMessage.type === 'look') {
        await this.wear(seat, clientMessage.look);
        return;
      }
      const room = await this.room();
      const deliveries = room.receive(seat.id, clientMessage, now);
      if (clientMessage.type === 'sync') {
        this.deliver(deliveries);
      } else {
        await this.apply(deliveries);
      }
    } catch (error) {
      await this.failed(error, `message ${clientMessage.type}${clientMessage.type === 'act' ? ` ${clientMessage.action.type}` : ''}`);
      // The sender starts over from the room as saved.
      try {
        const room = await this.room();
        this.deliver(room.receive(seat.id, { type: 'sync' }, Date.now()));
      } catch (again) {
        await this.failed(again, 'resync');
      }
    }
  }

  /**
   * A ping or an emote, passed on to everyone in the room (the sender sees their own as the
   * others do). It never reaches the world or storage; one that is not a signal, or one too
   * many in a short while, is dropped without a word.
   */
  private relay(player: PlayerInfo, raw: unknown): void {
    const signal = validSignal(raw);
    if (!signal || !this.signals.allow(player.id, Date.now())) return;
    const everyone = this.ctx.getWebSockets().map((ws) => this.playerOf(ws).id);
    this.deliver([{ to: everyone, message: { type: 'signal', from: player.id, signal } }]);
  }

  override async webSocketClose(ws: WebSocket): Promise<void> {
    await this.leave(ws);
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    await this.leave(ws);
  }

  private async leave(ws: WebSocket): Promise<void> {
    const id = this.playerOf(ws).id;
    const stillConnected = this.ctx.getWebSockets().some((other) => other !== ws && this.playerOf(other).id === id);
    if (!stillConnected && !id.endsWith(REPLACED)) {
      this.limiter.forget(id);
      this.signals.forget(id);
      const room = await this.room();
      await this.apply(room.disconnect(id, Date.now()), ws);
    }
  }

  private deliver(deliveries: Delivery[]): void {
    const sockets = this.ctx.getWebSockets();
    for (const { to, message } of deliveries) {
      const text = JSON.stringify(message);
      for (const ws of sockets) {
        if (to.includes(this.playerOf(ws).id)) {
          try {
            ws.send(text);
          } catch {
            // The socket is closing; its close handler updates presence.
          }
        }
      }
    }
  }

  /** The stored room, from its chunks (see chunks.ts); a room stored whole by an earlier version is read as is. */
  private async load(): Promise<RoomState | undefined> {
    const meta = await this.ctx.storage.get<unknown>('state');
    if (meta === undefined) return undefined;
    if (typeof meta !== 'string') return meta as RoomState;
    const chunks = await this.ctx.storage.get<string>(chunkKeys(meta));
    const entries = new Map<string, string>([['state', meta], ...chunks]);
    this.writer.loaded(entries);
    return fromChunks(entries);
  }

  /** Writes the chunks that changed since last time, and drops those of depths gone after a restart. */
  private async persist(): Promise<void> {
    if (!this.logic) return;
    const { put, remove } = this.writer.changes(this.logic.state());
    if (Object.keys(put).length > 0) await this.ctx.storage.put(put);
    if (remove.length > 0) await this.ctx.storage.delete(remove);
  }
}

/**
 * A player's Pixel-Mart wallet (see @pd/core shop.ts), kept under their Telegram id.
 *
 *   GET            the wallet
 *   POST /apply    a payment or a refund (wallet.ts), applied here and now
 *
 * A change is read, applied and written within one request with only storage
 * calls in between, and a Durable Object lets no other request in while its
 * storage is being read or written, so changes never overwrite each other.
 */
export class WalletStore extends DurableObject<Env> {
  override async fetch(request: Request): Promise<Response> {
    if (request.method === 'POST') {
      const change = parseWalletChange(await request.json());
      if (!change) return json({ error: 'bad change' }, 400);
      const stored = await this.ctx.storage.get<unknown>(['wallet', 'refunded']);
      const record = emptyRecord();
      const next = applyWalletChange({
        wallet: (stored.get('wallet') as Wallet | undefined) ?? record.wallet,
        refunded: (stored.get('refunded') as string[] | undefined) ?? record.refunded,
      }, change);
      await this.ctx.storage.put({ wallet: next.wallet, refunded: next.refunded });
      return json(next.wallet);
    }
    return json((await this.ctx.storage.get<Wallet>('wallet')) ?? emptyWallet());
  }
}

/** Wallets by Telegram user id. Each change runs inside the user's own object (WalletStore). */
function wallets(env: Env): Wallets {
  const stub = (user: number): DurableObjectStub<WalletStore> => env.WALLET.get(env.WALLET.idFromName(`tg${user}`));
  return {
    async get(user) {
      return (await (await stub(user).fetch('https://wallet/')).json()) as Wallet;
    },
    async apply(user, change: WalletChange) {
      const response = await stub(user).fetch('https://wallet/apply', { method: 'POST', body: JSON.stringify(change) });
      if (!response.ok) throw new Error(`wallet ${change.kind}: ${response.status}`);
      return (await response.json()) as Wallet;
    },
  };
}

/** The Telegram user behind a request's init data, if signed within `maxAgeSeconds`; Pixel-Mart takes no guests. */
async function telegramUser(body: Record<string, unknown>, env: Env, maxAgeSeconds: number): Promise<TelegramUser | null> {
  if (!env.BOT_TOKEN || typeof body.initData !== 'string') return null;
  return verifyInitData(body.initData, env.BOT_TOKEN, maxAgeSeconds);
}

async function shop(request: Request, env: Env, route: 'me' | 'invoice'): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  if (!env.BOT_TOKEN) return json({ error: 'the shop is closed' }, 503);
  const body = await jsonBody(request);
  if (!body) return json({ error: 'bad json' }, 400);
  // Looking at one's wallet is harmless, and the Mini App may stay open for days; buying takes fresh init data.
  const user = await telegramUser(body, env, route === 'me' ? WEEK_SECONDS : DAY_SECONDS);
  if (user === null) return json({ error: 'unauthorized' }, 401);
  if (route === 'me') {
    const wallet = await wallets(env).get(user.id);
    return json({ owned: wallet.owned, patronUntil: wallet.patronUntil ?? null, patron: isPatron(wallet, Date.now()), tipped: wallet.tipped ?? 0 });
  }
  // The invoice's words come from the server's catalogue, in the buyer's language; the request's own are ignored.
  const result = await createInvoice(botApi(env.BOT_TOKEN), user.id, String(body.sku ?? ''), user.language_code);
  return 'link' in result ? json(result) : json(result, 400);
}

/** How often one player's messages reach the admin through /paysupport, per Worker instance. */
const supportLimiter = new WindowLimiter(5, 10 * 60_000);

/** The longest update the webhook reads; Telegram's are a few kilobytes. */
const MAX_UPDATE_BYTES = 256 * 1024;

async function webhook(request: Request, env: Env): Promise<Response> {
  // Only Telegram knows the secret set with setWebhook.
  if (!env.BOT_TOKEN || !env.WEBHOOK_SECRET || !(await sameSecret(request.headers.get('X-Telegram-Bot-Api-Secret-Token'), env.WEBHOOK_SECRET))) {
    return new Response('forbidden', { status: 403 });
  }
  // From here on Telegram always hears "ok": an update it does not hear back about is sent
  // again and again, and one that fails here would fail the same way every time.
  try {
    const body = await readBody(request, MAX_UPDATE_BYTES);
    if (body === null) throw new Error('update too large');
    let update: TelegramUpdate;
    try {
      update = JSON.parse(body) as TelegramUpdate;
    } catch {
      throw new Error('update is not JSON');
    }
    await handleUpdate(update, botApi(env.BOT_TOKEN), wallets(env), {
      appLink: env.APP_LINK ?? '', adminChatId: env.ADMIN_CHAT_ID, termsUrl: env.TERMS_URL, supportLimiter, ops: adminOps(env),
    });
  } catch (error) {
    await keepReport(env, serverReport(error, 'webhook'));
  }
  return new Response('ok');
}

/**
 * One board (boards.ts names them): a day's daily dungeon, a week's best, the best ever.
 * Entries are by public id (leaderboard.ts publicId); each knows its owner privately.
 *
 *   GET  ?name=&me=<public id>|owner=<account>&top=<n>   the best n, and that player's place
 *   POST /put?name=   an entry of a checked run (from the player's object only)
 *
 * Boards named by a bare date are the daily boards of before checked runs, read as they were.
 */
export class DailyBoard extends DurableObject<Env> {
  override async fetch(request: Request): Promise<Response> {
    const board = new Leaderboard((await this.ctx.storage.get<DailyEntry[]>('board')) ?? []);
    const url = new URL(request.url);
    const name = url.searchParams.get('name') ?? url.searchParams.get('date') ?? '';
    if (request.method === 'POST' && url.pathname === '/put') {
      const entry = (await request.json()) as DailyEntry;
      const rank = board.put(entry);
      await this.ctx.storage.put('board', board.entries());
      await this.expireAfter(name);
      return json({ rank, total: board.entries().length });
    }
    if (request.method === 'POST') return json({ error: 'results come from checked runs only' }, 410);
    // Every player's place, by account (the reminders' weekly results); never served outside.
    if (url.searchParams.get('owners') === '1') {
      const owners: Record<string, number> = {};
      board.entries().forEach((entry, i) => {
        if (entry.owner) owners[entry.owner] = i + 1;
      });
      return json({ owners, total: board.entries().length });
    }
    const me = url.searchParams.get('me');
    const owner = url.searchParams.get('owner');
    const count = Math.min(100, Math.max(0, Number(url.searchParams.get('top') ?? 20) || 0));
    const mine = owner ? board.ofOwner(owner) : null;
    const rank = me ? board.rank(me) : (mine?.rank ?? null);
    const you = me && rank !== null ? board.entries()[rank - 1] : undefined;
    return json({
      rank, top: board.top(count), total: board.entries().length,
      ...(you ? { you: servedEntry(you) } : {}), ...(mine ? { owner: { rank: mine.rank } } : {}),
    });
  }

  /** Sets the board's deletion some time after its day or week (boards.ts boardTtl); the best ever are kept. */
  private async expireAfter(name: string): Promise<void> {
    const ttl = boardTtl(name);
    if (ttl === null || (await this.ctx.storage.getAlarm()) !== null) return;
    await this.ctx.storage.setAlarm(Date.now() + ttl);
  }

  override async alarm(): Promise<void> {
    await this.ctx.storage.deleteAll();
  }
}

/** Only today's board (UTC, give or take a day for time zones) takes results. */
function isCurrentDay(date: string, now: number): boolean {
  const day = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(day) && Math.abs(now - day - 12 * 3600_000) <= 36 * 3600_000;
}

/** The key the board's public ids are made with: a server secret, so they cannot be worked back to accounts. */
const boardKey = (env: Env): string => env.BOT_TOKEN ?? 'development';

/** A board's entries as anyone may see them: by public id (boards kept before public ids hold account ids). */
async function publicEntries(entries: DailyEntry[], env: Env, date: string): Promise<DailyEntry[]> {
  return Promise.all(entries.map(async (entry) => (isPublicId(entry.id) ? entry : { ...entry, id: await publicId(boardKey(env), date, entry.id) })));
}

async function daily(request: Request, env: Env, date: string): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const board = env.DAILY.get(env.DAILY.idFromName(date));
  if (request.method === 'GET') {
    const me = new URL(request.url).searchParams.get('me');
    const response = await board.fetch(`https://board/?date=${date}${me ? `&me=${encodeURIComponent(me)}` : ''}`);
    const payload = (await response.json()) as { rank: number | null; top: DailyEntry[] };
    return json({ rank: payload.rank, top: await publicEntries(payload.top, env, date), ...(me && payload.rank !== null ? { you: me } : {}) });
  }
  // Results come from checked runs only (player.ts): a client's word for its score is not taken.
  return json({ error: 'results come from checked runs only' }, 410);
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/shop/me' || url.pathname === '/shop/invoice') return shop(request, env, url.pathname === '/shop/me' ? 'me' : 'invoice');
    if (url.pathname === '/telegram/webhook' && request.method === 'POST') return webhook(request, env);
    if (url.pathname === '/report' || url.pathname === '/reports') return reports(request, env);
    if (url.pathname === '/problem') return problemRoute(request, env);
    if (url.pathname === '/run') return runRoute(request, env);
    if (url.pathname === '/me') return meRoute(request, env);
    if (url.pathname === '/mail') return mailRoute(request, env);
    if (url.pathname === '/board') return boardRoute(request, env);
    if (url.pathname === '/card' || url.pathname.startsWith('/card/')) return cardRoute(request, env, url);
    if (url.pathname === '/challenge') return challengeRoute(request, env);
    if (url.pathname === '/notify') return notifyRoute(request, env);
    const day = /^\/daily\/(\d{4}-\d{2}-\d{2})$/.exec(url.pathname);
    if (day) return daily(request, env, day[1]!);

    const match = /^\/room\/([A-Za-z0-9_-]{1,64})$/.exec(url.pathname);
    if (!match) {
      return new Response('Pixel Dungeon co-op server', { status: url.pathname === '/' ? 200 : 404 });
    }
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('expected a WebSocket upgrade', { status: 426 });
    }
    const room = env.ROOM.get(env.ROOM.idFromName(match[1]!));
    return room.fetch(request);
  },
  /** Every hour (wrangler.jsonc triggers): the bot's reminders that are due (notifier.ts). */
  async scheduled(controller, env): Promise<void> {
    try {
      await notifierStub(env).tick(controller.scheduledTime);
    } catch (error) {
      await keepReport(env, serverReport(error, 'reminders'));
    }
  },
} satisfies ExportedHandler<Env>;

export { Card, Notifier, Player };
