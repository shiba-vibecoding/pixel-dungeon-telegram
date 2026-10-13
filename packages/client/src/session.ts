import {
  act, type Action, addHero, applyBoon, applyEvent, type Bones, type ClientMessage, createWorld, dailyRules, type Effect, fingerprint, type GameMode, giveBones, heroById,
  type HeroClass,
  LIVE_CALM_MS, liveBeatMs, liveReady, liveTick,
  type Look, restartWorld, RULES_VERSION, type ServerMessage, type Signal, type World,
} from '@pd/core';
import type { RunApi, RunMeta, SyncAnswer } from './checked';
import { guestSecret } from './guest';
import { netlog, sendNetlog, startNetlog } from './netlog';
import { report } from './report';
import { reloadForUpdate } from './update';

/*
 * Where the world comes from. A solo session runs the core directly and keeps
 * the run in local storage; an online session keeps a replica of the room's
 * world, applying the ordered events the server broadcasts, and only sends
 * intentions.
 */

export interface Session {
  readonly mode: 'solo' | 'online';
  /** Null until an online session receives its first snapshot. */
  world: World | null;
  myId: string;
  online: string[];
  /** Connection state for the HUD; empty when all is well. */
  status: string;
  /** Bumped whenever the world is replaced wholesale, so views reset. */
  generation: number;
  /** True while my last action is in flight or queued behind companions. */
  readonly busy: boolean;
  /**
   * Online, a step of a walk may follow the last one before the room has answered: the
   * room's answer takes longer than a step on many phones' networks, and a walk paced
   * by it stutters. Null when the next action must wait; else the cell my last step,
   * still on its way, goes to (where the next one starts from).
   */
  readonly stepAhead: number | null;
  /**
   * Live turns (world.live): how long the current beat lasts (ms), so a step on screen takes as long and
   * walks never pause; null under classic turns.
   */
  readonly beatMs: number | null;
  /** Alone under live turns: while this says so (a window open, the app put away), the clock stands still. */
  hold?: () => boolean;
  send(action: Action): void;
  /** A new run after the party has fallen. */
  restart(): void;
  /** Effects that happened since the last call, in order. */
  drain(): Effect[];
  close(): void;
  /** What each player wears (Pixel-Mart), by hero id; outside the world. */
  looks: Record<string, Look>;
  /** Puts my look on, for the party to see. */
  wear(look: Look): void;
  /** A ping or an emote for the party (co-op only; alone there is no one to signal). */
  signal(signal: Signal): void;
  /** Signals the room relayed since the last call (mine among them), in order: who sent each, and when it came (performance.now()). */
  drainSignals(): Array<{ from: string; signal: Signal; at: number }>;
  /** A checked run (checked.ts): how it stands with the server; null for a run played on the device alone. */
  readonly checked?: CheckState | null;
}

export interface CheckState {
  readonly meta: RunMeta;
  /** The device has moves the server has not taken, and cannot reach it just now. */
  readonly offline: boolean;
  /** The run's end as the server scored it, once the run is over; null if it cannot be had (or the run is not checked). */
  finished(): Promise<SyncAnswer | null>;
}

/** What a checked run needs besides the world. */
export interface CheckOptions {
  api: RunApi;
  meta: RunMeta;
  /** Moves played and not yet taken by the server. */
  log?: Action[];
  /** The run's world as the server gave it (a new run, or one carried on from another device). */
  world?: World;
  /** A new checked run in the same slot (after a fall); null: none could be had, the next is the device's alone. */
  renew(): Promise<{ run: RunMeta; world: World } | null>;
}

/** Moves sent to the server at once when so many wait; fewer go after SYNC_DELAY_MS. */
const SYNC_BATCH = 40;
const SYNC_DELAY_MS = 8000;
/** The most moves one request carries (the server takes at most 400; a keepalive request must stay small). */
const SYNC_MAX = 300;
/** How long the end of a run waits for the server's word on it. */
const FINISH_WAIT_MS = 10_000;

const SAVE_VERSION = 31;

interface SoloSave {
  version: number;
  world: World;
  /** A checked run: the server's run, and the moves it has not taken yet. */
  check?: { meta: RunMeta; log: Action[] };
}

/**
 * How a run saved by an older version is brought up to date: each step takes a world of
 * version N to N + 1. A change that only adds optional fields needs no step (and no new
 * version); one that renames or reshapes state gets its step here when SAVE_VERSION goes up,
 * so an update never throws a run away.
 */
const MIGRATIONS: Readonly<Record<number, (world: World) => void>> = {};

/** The saved run, brought up to this version; null if there is none, it is over, or it is too old to carry on. */
export function loadSolo(key: string): World | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const save = JSON.parse(raw) as SoloSave;
    let version = save.version;
    for (; version < SAVE_VERSION && MIGRATIONS[version]; version++) MIGRATIONS[version]!(save.world);
    return version === SAVE_VERSION && !save.world.over ? save.world : null;
  } catch {
    return null;
  }
}

/** A run saved by a version too old to carry on, still in its slot: the title says so before a new run replaces it. */
/** A saved checked run's standing with the server: its run, and the moves not yet sent. */
export function loadCheck(key: string): { meta: RunMeta; log: Action[] } | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const save = JSON.parse(raw) as SoloSave;
    return save.version === SAVE_VERSION && save.check ? save.check : null;
  } catch {
    return null;
  }
}

export function staleSolo(key: string): { depth: number; heroClass: HeroClass } | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const save = JSON.parse(raw) as SoloSave;
    if (save.version === SAVE_VERSION || save.world?.over || loadSolo(key)) return null;
    const hero = save.world?.heroes?.[0];
    return hero ? { depth: hero.depth, heroClass: hero.heroClass } : null;
  } catch {
    return null;
  }
}

export function forgetSolo(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Storage is unavailable; nothing was saved either.
  }
}

/**
 * @param key local storage slot, or null not to save
 * @param newSeed seed for a fresh run (also used by restart)
 */
/**
 * @param challenges the challenges of a fresh run (a bit mask; see Challenges in the core)
 * @param mode the dungeon, or the arena of waves (kept in a slot of its own: see main.ts)
 * @param bones a fallen hero's bones for a fresh run to hold (bones.ts), read when the run starts
 */
export function soloSession(
  key: string | null, heroClass: HeroClass, newSeed: () => number, name = 'Hero', challenges = 0, mode: GameMode = 'dungeon',
  bones: () => Bones | null = () => null, live = false, checkOptions?: CheckOptions, daily?: string,
): Session {
  const fresh = (): World => {
    // The daily dungeon played without the server keeps the day's rules all the same (daily.ts).
    const rules = daily ? dailyRules(daily) : null;
    const world = createWorld(newSeed(), rules ? rules.challenge : challenges, mode, live);
    const hero = addHero(world, { id: 'me', name, heroClass });
    if (rules) applyBoon(world, hero, rules.boon);
    const left = bones();
    if (left) giveBones(world, left);
    return world;
  };
  let pending: Effect[] = [];
  let saveTimer = 0;
  /** A save is waiting for the moves to settle. */
  let dirty = false;
  /** Writes the run now. */
  const flush = (): void => {
    clearTimeout(saveTimer);
    if (!key || !dirty) return;
    dirty = false;
    try {
      const world = session.world!;
      // A checked run is kept until the server has it all, over or not.
      if (world.over && !(check && check.log.length > 0)) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify({ version: SAVE_VERSION, world, ...(check ? { check } : {}) } satisfies SoloSave));
    } catch {
      // Out of space or storage blocked: the run is not kept, and the player is told (main.ts, once).
      dispatchEvent(new Event('pd-save-failed'));
    }
  };
  /** Saves once the moves settle (writing after every step of a walk would be wasted). */
  const save = (): void => {
    if (!key) return;
    dirty = true;
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(flush, 300);
  };
  // Leaving the app (Telegram closed or sent to the background) must not lose the last moves.
  const away = (): void => {
    if (!document.hidden) return;
    flush();
    void syncNow(true);
  };

  /* Checked runs: moves go to the server in batches; its answer may send its own copy back. */
  let check: { meta: RunMeta; log: Action[] } | null = checkOptions ? { meta: { ...checkOptions.meta }, log: [...(checkOptions.log ?? [])] } : null;
  let syncing = false;
  let syncTimer = 0;
  let retryMs = 0;
  let offline = false;
  /** A run carried on is checked against the server's once, moves or none. */
  let verify = check !== null;
  let answer: SyncAnswer | null = null;
  let waiters: Array<(answer: SyncAnswer | null) => void> = [];
  const settleWaiters = (value: SyncAnswer | null): void => {
    for (const waiter of waiters) waiter(value);
    waiters = [];
  };
  const syncSoon = (delay: number): void => {
    if (!check) return;
    clearTimeout(syncTimer);
    syncTimer = window.setTimeout(() => void syncNow(), delay);
  };
  const syncNow = async (keepalive = false): Promise<void> => {
    if (!check || syncing || closed || (check.log.length === 0 && !verify)) return;
    clearTimeout(syncTimer);
    syncing = true;
    const meta = { ...check.meta };
    const batch = check.log.slice(0, keepalive ? Math.min(SYNC_MAX, 150) : SYNC_MAX);
    const whole = batch.length === check.log.length;
    const reply = await checkOptions!.api.sync(meta, batch, whole ? fingerprint(session.world!) : null, keepalive);
    syncing = false;
    // Another run took the slot meanwhile (a restart): this answer is of no use.
    if (!check || check.meta.id !== meta.id) return;
    if (reply === 'offline') {
      offline = true;
      retryMs = Math.min(60_000, retryMs ? retryMs * 2 : 2000);
      syncSoon(retryMs);
      return;
    }
    if (reply === 'unauthorized') {
      // The server no longer knows the player: the run goes on, on the device alone.
      check = null;
      settleWaiters(null);
      save();
      return;
    }
    if (reply === 'rules') {
      // The game was updated: the new version picks the run up where the server has it.
      flush();
      reloadForUpdate();
      return;
    }
    if (reply.reason === 'none') {
      // The server keeps no run here (gone after long disuse): the run goes on, on the device alone.
      check = null;
      settleWaiters(null);
      save();
      return;
    }
    if (!reply.world && reply.seq === meta.seq && batch.length > 0) {
      // Nothing taken and nothing said why: try again later rather than at once.
      retryMs = Math.min(60_000, retryMs ? retryMs * 2 : 2000);
      syncSoon(retryMs);
      return;
    }
    offline = false;
    retryMs = 0;
    verify = false;
    if (reply.world && reply.run) {
      // The device's copy parted from the server's (or the run went on elsewhere): the server's is the run.
      session.world = reply.world;
      check = { meta: reply.run, log: [] };
      pending = [];
      session.generation++;
      dispatchEvent(new CustomEvent('pd-run-restored', { detail: reply.reason }));
    } else {
      check.log.splice(0, Math.max(0, reply.seq - meta.seq));
      check.meta.seq = reply.seq;
    }
    if (reply.finished) {
      answer = reply;
      settleWaiters(reply);
    }
    save();
    if (check.log.length > 0) syncSoon(check.log.length >= SYNC_BATCH ? 0 : SYNC_DELAY_MS);
  };
  document.addEventListener('visibilitychange', away);
  addEventListener('pagehide', flush);

  const session: Session = {
    mode: 'solo',
    world: checkOptions?.world ?? ((key && loadSolo(key)) || fresh()),
    myId: 'me',
    online: ['me'],
    status: '',
    generation: 0,
    busy: false,
    stepAhead: null,
    get beatMs() {
      return session.world?.live ? beat : null;
    },
    send(action) {
      const depth = heroById(session.world!, 'me')?.depth;
      const result = act(session.world!, 'me', action);
      if (result.ok) {
        pending.push(...result.effects);
        save();
        if (check) {
          check.log.push(action);
          // The end goes at once (its place on the boards is awaited); a new depth soon; else in batches.
          const world = session.world!;
          if (world.over) void syncNow();
          else syncSoon(check.log.length >= SYNC_BATCH ? 0 : heroById(world, 'me')?.depth !== depth ? 500 : SYNC_DELAY_MS);
        }
      } else {
        // Refused: let the player know why, where that is worth saying.
        pending.push({ type: 'interrupted', hero: 'me', reason: result.reason });
      }
    },
    restart() {
      if (checkOptions && check) {
        // A checked run's successor comes from the server too; failing that, the device plays one alone.
        const old = check.meta.id;
        void checkOptions.renew().then((next) => {
          if (closed || !check || check.meta.id !== old) return;
          if (next) {
            session.world = next.world;
            check = { meta: next.run, log: [] };
          } else {
            check = null;
            restartWorld(session.world!, newSeed());
          }
          answer = null;
          pending = [];
          session.generation++;
          save();
        });
        return;
      }
      restartWorld(session.world!, newSeed());
      const left = bones();
      if (left) giveBones(session.world!, left);
      session.generation++;
      save();
    },
    drain() {
      const effects = pending;
      pending = [];
      return effects;
    },
    close() {
      // Back to the title: what was played is kept, to the last move, and the server hears of it.
      void syncNow(true);
      closed = true;
      clearTimeout(clock);
      clearTimeout(syncTimer);
      flush();
      document.removeEventListener('visibilitychange', away);
      removeEventListener('pagehide', flush);
    },
    looks: {},
    wear(look) {
      session.looks = { me: look };
    },
    signal() {},
    drainSignals: () => [],
    get checked(): CheckState | null {
      if (!check) return null;
      const meta = check.meta;
      return {
        meta,
        offline,
        finished: () => {
          if (answer) return Promise.resolve(answer);
          if (!check || !session.world?.over) return Promise.resolve(null);
          void syncNow();
          return new Promise((resolve) => {
            waiters.push(resolve);
            window.setTimeout(() => resolve(answer), FINISH_WAIT_MS);
          });
        },
      };
    },
  };
  // Live turns alone: the session's own clock plays the hero's depth a beat at a time whenever there
  // is something to play (an order, or a move in a fight), a beat no sooner than the last has been
  // seen; it stands still while a window is open or the app is put away.
  let closed = false;
  let clock = 0;
  let beat = LIVE_CALM_MS;
  let nextBeat = 0;
  const tick = (): void => {
    if (closed) return;
    const world = session.world!;
    const me = heroById(world, 'me');
    const now = performance.now();
    if (me && world.live && !document.hidden && !session.hold?.() && now >= nextBeat && liveReady(world, me.depth)) {
      beat = liveBeatMs(world, me.depth);
      const result = liveTick(world, me.depth);
      if (result.ok) pending.push(...result.effects);
      nextBeat = now + beat;
      save();
    }
    clock = window.setTimeout(tick, world.live ? 16 : 1000);
  };
  if (session.world!.live) clock = window.setTimeout(tick, 16);
  save();
  // A checked run carried on: the server's copy is checked against this one at once.
  if (check) void syncNow();
  return session;
}

export interface OnlineOptions {
  server: string;
  room: string;
  playerId: string;
  name: string;
  heroClass: HeroClass;
  /** Telegram.WebApp.initData when running inside Telegram. */
  initData?: string;
  /** The arena of waves: the room is made one if it does not exist yet (whoever comes first). */
  mode?: GameMode;
  text: { connecting: string; reconnecting: string; replaced: string; full: string; updating: string };
}

/** Steps of a walk that may be on their way to the room at once. */
const STEPS_AHEAD = 3;
/** A word to the room this often keeps the line warm (mobile networks drop quiet ones) and proves it alive. */
const PING_MS = 4000;
/** Nothing heard for this long: the connection is dead, however open it looks. */
const SILENCE_MS = 10_000;
/** Out of sight this long (Telegram minimised, another chat open): leave the room, so the party is not held up. */
const AWAY_MS = 5000;

export function onlineSession(options: OnlineOptions): Session {
  let seq = 0;
  let socket: WebSocket | null = null;
  /** My actions sent and not yet come back from the room. */
  let inFlight = 0;
  /** Where the last of them, if they are all steps, leads; null otherwise. */
  let ahead: number | null = null;
  /** Live turns: how long the room's current beat lasts (ms), from its last tick. */
  let beat = LIVE_CALM_MS;
  let closed = false;
  let pending: Effect[] = [];
  /** When the room was last heard from (performance.now()). */
  let lastHeard = 0;
  /** Left the room while the app was out of sight; back when it shows again. */
  let away = false;
  let awayTimer = 0;
  let retryTimer = 0;

  const transmit = (message: ClientMessage): void => {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  };

  const session: Session = {
    mode: 'online',
    world: null,
    myId: options.playerId,
    online: [],
    status: options.text.connecting,
    generation: 0,
    get busy() {
      // Live turns: an order goes at once and replaces the last; nothing waits for the room.
      if (session.world?.live) return false;
      const me = session.world && heroById(session.world, session.myId);
      return inFlight > 0 || Boolean(me?.intent);
    },
    get stepAhead() {
      const me = session.world && heroById(session.world, session.myId);
      const open = socket?.readyState === WebSocket.OPEN;
      return open && inFlight > 0 && inFlight < STEPS_AHEAD && ahead !== null && !me?.intent && !session.world?.live ? ahead : null;
    },
    get beatMs() {
      return session.world?.live ? beat : null;
    },
    send(action) {
      if (socket?.readyState !== WebSocket.OPEN) return;
      // Only a step may follow steps still on their way; anything else waits for the room.
      const follows = action.type === 'move' && session.stepAhead !== null;
      if (session.busy && !follows) return;
      inFlight++;
      sentAt.push(performance.now());
      // Steps are many: only the rest are written down one by one (steps go into the summary).
      if (action.type !== 'move') netlog(`act ${action.type}${inFlight > 1 ? ` (${inFlight} on the way)` : ''}`);
      ahead = action.type === 'move' && (inFlight === 1 || ahead !== null) ? action.to : null;
      transmit({ type: 'act', action });
    },
    restart() {
      transmit({ type: 'restart' });
    },
    drain() {
      const effects = pending;
      pending = [];
      return effects;
    },
    close() {
      closed = true;
      clearTimeout(awayTimer);
      clearTimeout(retryTimer);
      clearInterval(pinger);
      document.removeEventListener('visibilitychange', onVisibility);
      removeEventListener('online', onOnline);
      socket?.close();
    },
    looks: {},
    wear(look) {
      myLook = look;
      transmit({ type: 'look', look });
    },
    signal(signal) {
      transmit({ type: 'signal', signal });
    },
    drainSignals() {
      const received = signals;
      signals = [];
      return received;
    },
  };
  /** Signals received and not yet shown (see drainSignals). */
  let signals: Array<{ from: string; signal: Signal; at: number }> = [];
  /** My look, sent again whenever the connection is made anew. */
  let myLook: Look | null = null;
  /** Connections in a row that never opened. */
  let failures = 0;

  const receive = (message: ServerMessage): void => {
    switch (message.type) {
      case 'snapshot':
        session.world = message.world;
        session.myId = message.you;
        session.online = message.online;
        seq = message.seq;
        inFlight = 0;
        ahead = null;
        sentAt.length = 0;
        netlog(`snapshot seq ${message.seq}, ${message.world.heroes.length} heroes, ${message.online.length} online`);
        session.generation++;
        break;
      case 'event': {
        if (!session.world || message.seq !== seq + 1) {
          // Missed an event: start over from a fresh snapshot.
          netlog(`missed event: got ${message.seq} after ${seq}; sync`);
          transmit({ type: 'sync' });
          return;
        }
        const result = applyEvent(session.world, message.event);
        seq = message.seq;
        if (result.ok) {
          pending.push(...result.effects);
        } else {
          // The room took this action, so a world that refuses it has drifted from the room's:
          // start over from the room's own, and say so.
          report('desync', `${message.event.type === 'act' ? message.event.action.type : message.event.type}: ${result.reason}`);
          netlog(`desync: ${message.event.type === 'act' ? message.event.action.type : message.event.type}: ${result.reason}`);
          sendNetlog('desync');
          transmit({ type: 'sync' });
          return;
        }
        if (message.event.type === 'restart') session.generation++;
        // A beat of my depth sets how long steps take on my screen.
        if (message.event.type === 'tick' && message.event.depth === heroById(session.world, session.myId)?.depth) beat = message.event.ms;
        if (message.event.type === 'act' && message.event.heroId === session.myId) {
          inFlight = Math.max(0, inFlight - 1);
          const at = sentAt.shift();
          if (at !== undefined) noteRtt(performance.now() - at, message.event.action.type);
        }
        if (inFlight === 0) ahead = null;
        break;
      }
      case 'presence':
        session.online = message.online;
        break;
      case 'looks':
        session.looks = message.looks;
        break;
      case 'signal':
        // Kept only briefly: a tab in the background must not pile them up.
        signals.push({ from: message.from, signal: message.signal, at: performance.now() });
        if (signals.length > 16) signals.shift();
        break;
      case 'rejected':
        // Steps sent after a refused one are refused too, or soon will be: the walk stops here.
        inFlight = Math.max(0, inFlight - 1);
        sentAt.shift();
        netlog(`refused: ${message.reason}`);
        ahead = null;
        pending.push({ type: 'interrupted', hero: session.myId, reason: message.reason });
        break;
    }
  };

  const connect = (): void => {
    const url = new URL(`/room/${encodeURIComponent(options.room)}`, options.server);
    url.searchParams.set('hero', options.heroClass);
    url.searchParams.set('v', String(RULES_VERSION));
    if (options.mode === 'arena') url.searchParams.set('mode', 'arena');
    if (options.initData) {
      url.searchParams.set('initData', options.initData);
    } else {
      // The id serves a server in development; a live one knows a guest by their secret alone.
      url.searchParams.set('id', options.playerId);
      url.searchParams.set('gs', guestSecret());
      url.searchParams.set('name', options.name);
    }
    const ws = new WebSocket(url);
    socket = ws;
    netlog(`connecting${failures ? ` (try ${failures + 1})` : ''}`);
    let opened = false;
    ws.onopen = () => {
      opened = true;
      failures = 0;
      lastHeard = performance.now();
      netlog('open');
      session.status = '';
      if (myLook) transmit({ type: 'look', look: myLook });
    };
    ws.onmessage = (event) => {
      lastHeard = performance.now();
      // The room's answer to a ping, given without waking it.
      if (event.data === 'pong') return;
      try {
        receive(JSON.parse(String(event.data)) as ServerMessage);
      } catch (error) {
        // Whatever broke, the room's own world puts it right.
        report('error', `receive: ${(error as Error).message}`, (error as Error).stack);
        transmit({ type: 'sync' });
      }
    };
    ws.onclose = (event) => {
      if (socket !== ws) return;
      netlog(`closed ${event.code}${event.reason ? ` ${event.reason}` : ''}${opened ? '' : ' (never opened)'}`);
      if (opened && !closed && !away && event.code !== 1000 && event.code < 4000) sendNetlog(`dropped ${event.code}`);
      inFlight = 0;
      ahead = null;
      sentAt.length = 0;
      if (closed || away) return;
      // A room that cannot be reached (refused, or the network) is worth knowing about once it keeps happening.
      if (!opened && ++failures === 3) report('socket', `cannot connect: close ${event.code}${event.reason ? ` ${event.reason}` : ''}`, undefined, { telegram: Boolean(options.initData) });
      if (opened && event.code !== 1000 && event.code !== 1001 && event.code < 4000) report('socket', `dropped: close ${event.code}`);
      if (event.code === 4000) {
        session.status = options.text.replaced;
        return;
      }
      if (event.code === 4001) {
        session.status = options.text.full;
        return;
      }
      if (event.code === 4002) {
        // The room runs other rules than this page: load the current build, straight back into the room,
        // past any cached copy of the page. Just reloaded and still out of step (the new build or the
        // server is still on its way out): wait and ask again rather than reload over and over.
        session.status = options.text.updating;
        let last = 0;
        try {
          last = Number(sessionStorage.getItem('pd-reloaded')) || 0;
        } catch {
          // Then reload.
        }
        if (Date.now() - last < 60_000) {
          setTimeout(connect, 15_000);
          return;
        }
        try {
          sessionStorage.setItem('pd-reloaded', String(Date.now()));
        } catch {
          // Reloads anyway.
        }
        const fresh = new URL(location.href);
        fresh.searchParams.set('fresh', String(Date.now()));
        setTimeout(() => location.replace(fresh.toString()), 900);
        return;
      }
      session.status = options.text.reconnecting;
      retry();
    };
  };

  /** Connects again soon: at once after a dropped line, then less and less often while the network is down. */
  const retry = (): void => {
    clearTimeout(retryTimer);
    retryTimer = window.setTimeout(connect, Math.min(4000, 250 * 2 ** Math.min(4, failures)));
  };

  /** Drops a connection that has gone silent (half open: it looks fine and carries nothing) and makes a new one. */
  const reconnectNow = (): void => {
    const dead = socket;
    socket = null;
    inFlight = 0;
    ahead = null;
    if (dead) {
      dead.onclose = null;
      dead.onmessage = null;
      try {
        dead.close();
      } catch {
        // Already gone.
      }
    }
    clearTimeout(retryTimer);
    session.status = options.text.reconnecting;
    connect();
  };

  const pinger = window.setInterval(() => {
    if (closed || away || socket?.readyState !== WebSocket.OPEN) return;
    if (performance.now() - lastHeard > SILENCE_MS) {
      netlog(`silent for ${Math.round((performance.now() - lastHeard) / 1000)} s: reconnecting`);
      sendNetlog('silent line');
      reconnectNow();
      return;
    }
    socket.send('ping');
  }, PING_MS);

  const onVisibility = (): void => {
    clearTimeout(awayTimer);
    if (document.hidden) {
      // A moment out of sight keeps the room; a while, and the party goes on without waiting for me.
      awayTimer = window.setTimeout(() => {
        netlog('hidden: leaving the room for now');
        away = true;
        socket?.close(1000, 'away');
      }, AWAY_MS);
      return;
    }
    if (away) {
      away = false;
      netlog('shown again: back to the room');
      reconnectNow();
    } else if (socket?.readyState === WebSocket.OPEN && performance.now() - lastHeard > PING_MS * 1.5) {
      // Back from a short absence: make sure the line survived it.
      socket.send('ping');
    }
  };
  /** When my actions were sent, oldest first, to time the room's answers. */
  const sentAt: number[] = [];
  /** Answers over the last stretch, written down as one line every so often (and the slow ones each). */
  const rtts: number[] = [];
  let summaryAt = performance.now();
  const noteRtt = (ms: number, kind: string): void => {
    rtts.push(ms);
    if (ms > 1500) netlog(`slow answer: ${kind} after ${Math.round(ms)} ms`);
    const now = performance.now();
    if (now - summaryAt < 15_000) return;
    const sorted = [...rtts].sort((a, b) => a - b);
    netlog(`${Math.round((now - summaryAt) / 1000)} s: ${rtts.length} actions, answer median ${Math.round(sorted[Math.floor(sorted.length / 2)] ?? 0)} ms, worst ${Math.round(sorted[sorted.length - 1] ?? 0)} ms`);
    rtts.length = 0;
    summaryAt = now;
  };

  const onOnline = (): void => {
    if (!closed && !away && socket?.readyState !== WebSocket.OPEN) reconnectNow();
  };
  document.addEventListener('visibilitychange', onVisibility);
  addEventListener('online', onOnline);

  startNetlog(`co-op session: room ${options.room.length} chars, ${options.initData ? 'telegram' : 'guest'}, ${navigator.onLine ? 'online' : 'offline'}`);
  connect();
  return session;
}
