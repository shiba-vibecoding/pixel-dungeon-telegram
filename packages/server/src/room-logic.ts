import {
  applyEvent, autoAction, blockers, type ClientMessage, createWorld, type GameMode, isAlive, liveBeatMs, liveBlockers, liveReady, type PlayerInfo, type ServerMessage,
  type World, type WorldEvent,
} from '@pd/core';

/*
 * One co-op room: the authoritative world plus who is connected. Pure logic
 * with no Cloudflare APIs, so it can be tested directly; the Durable Object
 * only moves bytes, persists `state()` and wakes the room up at `deadline()`.
 *
 * Turns: a hero in danger who has not decided yet holds up companions on the
 * same depth (see blockers() in the core). Only a player who is playing holds
 * the party: one who has done nothing for IDLE_TIMEOUT (reading the chat,
 * looking away) waits at once, turn after turn, until they act again, as a
 * disconnected one does. A player at the controls gets TURN_TIMEOUT at most.
 */

export interface Delivery {
  /** Player ids to send to. */
  to: string[];
  message: ServerMessage;
}

/** Bumped whenever the saved world format changes; older rooms are brought up to date by MIGRATIONS, or start afresh. */
export const STATE_FORMAT = 32;

/**
 * How a room saved in an older format is brought up to date: each step takes a world of format
 * N to N + 1 (as the client's solo saves, session.ts). Optional fields added need no step.
 */
const MIGRATIONS: Readonly<Record<number, (world: World) => void>> = {};

export interface RoomState {
  format: number;
  world: World;
  seq: number;
  /** When each hero who is holding companions up started doing so (ms). */
  holdingSince: Record<string, number>;
  /**
   * Players who play a hero not of their own id, by player id: a seat taken
   * over from someone long gone, or a new hero for a player whose own was
   * taken over (see seatFor). Absent in rooms saved before seats could change.
   */
  seats?: Record<string, string>;
  /** Since when each hero's player has been away (ms), by hero id. */
  offlineSince?: Record<string, number>;
  /** When each hero's player last did something (ms), by hero id. */
  activeAt?: Record<string, number>;
  /** The arena of waves, at rest: since when someone has been ready for the next wave (ms). */
  readySince?: number;
}

/** The longest a party waits for a companion's move. */
export const TURN_TIMEOUT = 8000;
/**
 * A player who has not acted for this long is not at the controls: the party does not wait
 * for them (in play, a turn in a fight comes within a second or two; a party held up by a
 * friend who had looked away, every turn, was the co-op's worst trouble).
 */
export const IDLE_TIMEOUT = 4000;

/**
 * The arena of waves waits for every living hero to be ready for the next wave. A hero whose
 * player is away is ready at once (they would not hold a turn up either); one whose player is
 * here but has done nothing for this long, while a companion has been ready this long, is
 * made ready too, so a party never waits on someone who has looked away.
 */
export const ARENA_READY_TIMEOUT = 30_000;

/**
 * Live turns: a fight waits for a player who has said nothing for LIVE_TURN_TIMEOUT, then their
 * hero waits a turn. One who is away, or has done nothing for LIVE_IDLE_MS while a companion plays,
 * is not waited for at all. With nobody playing, nothing is hurried: the room simply waits.
 */
export const LIVE_TURN_TIMEOUT = 15_000;
export const LIVE_IDLE_MS = 30_000;

/** Heroes per party; a shared invite link in a big chat must not flood one dungeon. */
export const PARTY_SIZE = 4;

/** How long a full party's hero must have been without its player before a newcomer may take it over. */
export const SEAT_TIMEOUT = 30 * 60_000;

export class RoomLogic {
  private readonly online = new Set<string>();
  /** Live turns: when each depth's next beat may come (its last one's time on screen gone by). */
  private readonly nextBeat = new Map<number, number>();

  constructor(
    private readonly saved: RoomState,
    private readonly newSeed: () => number = () => Math.floor(Math.random() * 2 ** 31),
  ) {}

  /**
   * A new room; `mode` makes it the arena of waves (the creator's choice: whoever joins plays what the room is).
   * New rooms play live turns (the core's liveTick, on the room's clock); rooms saved before them keep classic turns.
   */
  static create(seed: number, newSeed?: () => number, mode: GameMode = 'dungeon', live = true): RoomLogic {
    return new RoomLogic({ format: STATE_FORMAT, world: createWorld(seed, 0, mode, live), seq: 0, holdingSince: {} }, newSeed);
  }

  /** Whether the room plays live turns (the core's liveTick): calm depths walk on, fights go turn by turn together. */
  get live(): boolean {
    return this.saved.world.live === true;
  }

  /**
   * Live turns: plays every depth whose next beat is ready (the core's liveReady) and due (its last
   * beat has had its time on screen), each sent to everyone as an event with how long it lasts. A
   * fight held up by someone who is away, or has said nothing for too long, has their hero wait.
   */
  pump(now: number): Delivery[] {
    if (!this.live) return [];
    const world = this.saved.world;
    const deliveries = this.liveTimeouts(now);
    for (const depth of this.depths()) {
      if (!liveReady(world, depth) || now < (this.nextBeat.get(depth) ?? 0)) continue;
      const ms = liveBeatMs(world, depth);
      deliveries.push(...this.commit({ type: 'tick', depth, ms }, this.onlinePlayers()));
      this.nextBeat.set(depth, now + ms);
    }
    return [...deliveries, ...this.liveTimeouts(now), ...this.readyTheAbsent(now)];
  }

  /** When pump should run next by itself: a beat that is ready comes due, or a fight's wait runs out. Null: at the next message. */
  nextWake(now: number): number | null {
    if (!this.live || this.saved.world.over || this.online.size === 0) return null;
    const times: number[] = [];
    for (const depth of this.depths()) {
      if (liveReady(this.saved.world, depth)) times.push(Math.max(now, this.nextBeat.get(depth) ?? 0));
    }
    for (const since of Object.values(this.saved.holdingSince)) times.push(since + LIVE_TURN_TIMEOUT);
    return times.length > 0 ? Math.min(...times) : null;
  }

  /** Depths with living heroes, shallowest first. */
  private depths(): number[] {
    return [...new Set(this.saved.world.heroes.filter(isAlive).map((hero) => hero.depth))].sort((a, b) => a - b);
  }

  /**
   * Heroes the fights wait for (the core's liveBlockers): one whose player is away or has stopped
   * playing waits a turn at once, and anyone else after LIVE_TURN_TIMEOUT; but only while somebody
   * plays (a party all gone quiet is not marched to its death).
   */
  private liveTimeouts(now: number): Delivery[] {
    const deliveries: Delivery[] = [];
    const activeAt = (id: string): number => this.saved.activeAt?.[id] ?? 0;
    const playing = [...this.online].some((id) => now - activeAt(id) < LIVE_IDLE_MS);
    const holding: Record<string, number> = {};
    for (const id of liveBlockers(this.saved.world)) {
      const since = this.saved.holdingSince[id] ?? now;
      const gone = !this.online.has(id) || now - activeAt(id) >= LIVE_IDLE_MS;
      if (playing && (gone || now >= since + LIVE_TURN_TIMEOUT)) {
        const event: WorldEvent = { type: 'act', heroId: id, action: { type: 'wait' } };
        if (applyEvent(this.saved.world, event).ok) deliveries.push(this.broadcast(event));
      } else {
        holding[id] = since;
      }
    }
    this.saved.holdingSince = holding;
    return deliveries;
  }

  /**
   * A saved room, brought up to this format; a fresh one if there is none or it is too old to carry on
   * (of the saved room's kind, else of `mode`).
   */
  static restore(saved: RoomState | undefined, seed: number, mode: GameMode = 'dungeon'): RoomLogic {
    if (!saved) return RoomLogic.create(seed, undefined, mode);
    for (; saved.format < STATE_FORMAT && MIGRATIONS[saved.format]; saved.format++) MIGRATIONS[saved.format]!(saved.world);
    return saved.format === STATE_FORMAT ? new RoomLogic(saved) : RoomLogic.create(seed, undefined, saved.world?.mode ?? mode);
  }

  state(): RoomState {
    return this.saved;
  }

  onlinePlayers(): string[] {
    return [...this.online];
  }

  /** Restores who is connected after the object woke up from hibernation. */
  restoreOnline(ids: Iterable<string>): void {
    for (const id of ids) this.online.add(id);
  }

  /** True if a newcomer cannot join: the party is complete (members may always come back). */
  isFull(playerId: string): boolean {
    const heroes = this.saved.world.heroes;
    return heroes.length >= PARTY_SIZE && !heroes.some((hero) => hero.id === playerId);
  }

  /**
   * The hero a player plays in this room, by id: their own, or a new one, or,
   * when the party is full, the hero of whoever has been away longest, if
   * that is over SEAT_TIMEOUT (a party must not keep seats for players who
   * never come back). Null if there is no seat for them. The player then
   * connects under that hero's id; the room remembers whose it is now, and
   * someone whose hero was taken over gets a new one when they come back.
   */
  seatFor(playerId: string, now: number): string | null {
    const seats = (this.saved.seats ??= {});
    const heroes = this.saved.world.heroes;
    const exists = (id: string): boolean => heroes.some((hero) => hero.id === id);
    const taken = new Set(Object.values(seats));
    const mine = seats[playerId];
    // Theirs, or a new one set aside for them that has yet to join.
    if (mine !== undefined && (exists(mine) || heroes.length < PARTY_SIZE)) return mine;
    if (mine === undefined && exists(playerId) && !taken.has(playerId)) return playerId;

    // No hero of their own (any more): a new one if there is room.
    if (heroes.length < PARTY_SIZE) {
      let id = playerId;
      for (let n = 2; exists(id) || taken.has(id); n++) id = `${playerId}~${n}`;
      if (id === playerId) delete seats[playerId];
      else seats[playerId] = id;
      return id;
    }
    const gone = this.longestAway(now);
    if (!gone) return null;
    // Whoever played that hero before (if not its first player) no longer does.
    for (const [player, hero] of Object.entries(seats)) if (hero === gone) delete seats[player];
    if (gone === playerId) delete seats[playerId];
    else seats[playerId] = gone;
    return gone;
  }

  /** The hero whose player has been away longest, if over SEAT_TIMEOUT. */
  private longestAway(now: number): string | null {
    const away = (this.saved.offlineSince ??= {});
    let best: string | null = null;
    for (const hero of this.saved.world.heroes) {
      if (this.online.has(hero.id)) continue;
      // A hero away since before the room kept count: counted from now.
      away[hero.id] ??= now;
      if (now - away[hero.id]! >= SEAT_TIMEOUT && (best === null || away[hero.id]! < away[best]!)) best = hero.id;
    }
    return best;
  }

  connect(player: PlayerInfo, now: number): Delivery[] {
    const deliveries: Delivery[] = [];
    const others = this.onlinePlayers().filter((id) => id !== player.id);
    this.online.add(player.id);
    if (this.saved.offlineSince) delete this.saved.offlineSince[player.id];
    (this.saved.activeAt ??= {})[player.id] = now;

    if (!this.saved.world.heroes.some((hero) => hero.id === player.id)) {
      // Everyone already here learns about the newcomer as a regular event;
      // the newcomer receives a snapshot that already contains it.
      deliveries.push(...this.commit({ type: 'join', player }, others));
    }
    deliveries.push({ to: [player.id], message: this.snapshot(player.id) });
    deliveries.push(this.presence());
    deliveries.push(...(this.live ? this.pump(now) : this.settle(now)));
    return deliveries;
  }

  disconnect(playerId: string, now: number): Delivery[] {
    this.online.delete(playerId);
    (this.saved.offlineSince ??= {})[playerId] = now;
    return [this.presence(), ...(this.live ? this.pump(now) : this.settle(now))];
  }

  receive(playerId: string, message: ClientMessage, now: number): Delivery[] {
    switch (message.type) {
      case 'sync':
        return [{ to: [playerId], message: this.snapshot(playerId) }];
      case 'act': {
        (this.saved.activeAt ??= {})[playerId] = now;
        const event: WorldEvent = { type: 'act', heroId: playerId, action: message.action };
        const result = applyEvent(this.saved.world, event);
        if (!result.ok) {
          return [{ to: [playerId], message: { type: 'rejected', reason: result.reason } }];
        }
        return [this.broadcast(event), ...(this.live ? this.pump(now) : this.settle(now))];
      }
      case 'restart':
        if (!this.saved.world.over) {
          return [{ to: [playerId], message: { type: 'rejected', reason: 'the party is still alive' } }];
        }
        this.saved.holdingSince = {};
        return this.commit({ type: 'restart', seed: this.newSeed() }, this.onlinePlayers());
      default:
        return [{ to: [playerId], message: { type: 'rejected', reason: 'unknown message' } }];
    }
  }

  /** When the room next needs to act on its own, if ever. */
  deadline(): number | null {
    const times = Object.entries(this.saved.holdingSince).map(([id, since]) => Math.min(since + TURN_TIMEOUT, this.idleAt(id, since)));
    const since = this.saved.readySince;
    if (since !== undefined) {
      for (const id of this.notReady()) times.push(Math.max(since, this.saved.activeAt?.[id] ?? since) + ARENA_READY_TIMEOUT);
    }
    return times.length > 0 ? Math.min(...times) : null;
  }

  /** The arena at rest: living heroes not yet ready for the next wave. */
  private notReady(): string[] {
    const arena = this.saved.world.arena;
    if (!arena || arena.phase !== 'rest' || this.saved.world.over) return [];
    return this.saved.world.heroes.filter((hero) => isAlive(hero) && !arena.ready.includes(hero.id)).map((hero) => hero.id);
  }

  /**
   * The arena at rest, once someone is ready: heroes whose players are away are ready too, and so
   * are those whose players have done nothing for ARENA_READY_TIMEOUT while a companion waited as long.
   */
  private readyTheAbsent(now: number): Delivery[] {
    const arena = this.saved.world.arena;
    if (!arena || arena.phase !== 'rest' || arena.ready.length === 0 || this.saved.world.over) {
      delete this.saved.readySince;
      return [];
    }
    const since = (this.saved.readySince ??= now);
    const deliveries: Delivery[] = [];
    for (const id of this.notReady()) {
      const idle = now >= Math.max(since, this.saved.activeAt?.[id] ?? since) + ARENA_READY_TIMEOUT;
      if (this.online.has(id) && !idle) continue;
      const event: WorldEvent = { type: 'act', heroId: id, action: { type: 'arenaReady' } };
      if (applyEvent(this.saved.world, event).ok) deliveries.push(this.broadcast(event));
      // The wave may have begun.
      if (this.saved.world.arena?.phase !== 'rest') break;
    }
    if (this.saved.world.arena?.phase !== 'rest') delete this.saved.readySince;
    return deliveries;
  }

  /** When a hero's player counts as idle: IDLE_TIMEOUT after they last acted. */
  private idleAt(heroId: string, fallback: number): number {
    return (this.saved.activeAt?.[heroId] ?? fallback) + IDLE_TIMEOUT;
  }

  /** Makes heroes who ran out of time wait a turn. */
  tick(now: number): Delivery[] {
    // Live turns: the room's own clock (pump) does the waiting.
    if (this.live) return this.pump(now);
    const deliveries: Delivery[] = [];
    for (const [id, since] of Object.entries(this.saved.holdingSince)) {
      if (now >= since + TURN_TIMEOUT || now >= this.idleAt(id, since)) {
        delete this.saved.holdingSince[id];
        deliveries.push(...this.autoWait(id));
      }
    }
    return [...deliveries, ...this.settle(now)];
  }

  /** Lets absent heroes pass and starts the clock on the others holding things up. */
  private settle(now: number): Delivery[] {
    const deliveries: Delivery[] = [];
    for (let i = 0; i < 1000; i++) {
      const holding = blockers(this.saved.world);
      // Away, or not at the controls: they wait, and the party goes on.
      const absent = holding.filter((id) => !this.online.has(id) || now >= this.idleAt(id, this.saved.holdingSince[id] ?? now));
      if (absent.length === 0) {
        const next: Record<string, number> = {};
        for (const id of holding) next[id] = this.saved.holdingSince[id] ?? now;
        this.saved.holdingSince = next;
        break;
      }
      for (const id of absent) deliveries.push(...this.autoWait(id));
    }
    // The arena's rest is no turn: whoever is away is ready for the next wave.
    const ready = this.readyTheAbsent(now);
    if (ready.length > 0) return [...deliveries, ...ready, ...this.settle(now)];
    return deliveries;
  }

  /** A turn played for a hero whose player is not at the controls: they strike back if attacked, else wait (core autoAction). */
  private autoWait(heroId: string): Delivery[] {
    const action = autoAction(this.saved.world, heroId);
    let event: WorldEvent = { type: 'act', heroId, action };
    if (!applyEvent(this.saved.world, event).ok) {
      event = { type: 'act', heroId, action: { type: 'wait' } };
      if (!applyEvent(this.saved.world, event).ok) return [];
    }
    return [this.broadcast(event)];
  }

  private commit(event: WorldEvent, recipients: string[]): Delivery[] {
    applyEvent(this.saved.world, event);
    this.saved.seq++;
    const message: ServerMessage = { type: 'event', seq: this.saved.seq, event };
    return recipients.length > 0 ? [{ to: recipients, message }] : [];
  }

  /** For an event already applied to the world. */
  private broadcast(event: WorldEvent): Delivery {
    this.saved.seq++;
    return { to: this.onlinePlayers(), message: { type: 'event', seq: this.saved.seq, event } };
  }

  private presence(): Delivery {
    return { to: this.onlinePlayers(), message: { type: 'presence', online: this.onlinePlayers() } };
  }

  private snapshot(playerId: string): ServerMessage {
    return { type: 'snapshot', you: playerId, seq: this.saved.seq, world: this.saved.world, online: this.onlinePlayers() };
  }
}
