import {
  act, type Action, addHero, applyBoon, type BadgeId, type BadgeProgress, type Bones, checkBadges, countGame, createWorld, dailyRules, dailySeed, deriveSeed,
  BONES_ROLLS, emptyBadgeProgress, fingerprint, giveBones, type HeroClass, heroById, leaveBones, Rng, type RunOutcome, runOutcome, type World,
} from '@pd/core';

/*
 * A player's checked runs and what they add up to. The device plays a run at once, with no
 * wait for the network, and sends what the player did in batches; the server plays the same
 * actions on its own copy of the run (the core is deterministic), so the score, the badges and
 * the places on the boards come from the server's copy only. A device whose copy parts from it
 * (a bug, or an edited device) is sent the server's back. A run's past cannot be played again:
 * the server never takes back what it has taken, so dying cannot be undone by reloading.
 *
 * Pure logic, kept by the player's Durable Object (Player, index.ts).
 */

export type RunSlot = 'dungeon' | 'arena' | 'daily';
export const RUN_SLOTS: readonly RunSlot[] = ['dungeon', 'arena', 'daily'];

/** The hero's id in a player's own run. */
export const ME = 'me';
/** The most actions one sync takes; a device with more sends them in turns. */
export const MAX_SYNC_ACTIONS = 400;

export interface Run {
  id: string;
  slot: RunSlot;
  seed: number;
  /** The daily dungeon: its day (YYYY-MM-DD). */
  date?: string;
  /** Counts for the boards: every run but a daily dungeon played again the same day. */
  ranked: boolean;
  /** Actions taken so far. */
  seq: number;
  startedAt: number;
  updatedAt: number;
  /** How it ended, once it has. */
  finished?: RunOutcome;
  summary?: RunSummary;
  /** A new best of the player's. */
  record?: boolean;
  /** Its places on the boards it went to (player.ts). */
  places?: Partial<Record<string, number | null>>;
  world: World;
}

/** A finished run, as the player's history keeps it. */
export interface RunSummary extends RunOutcome {
  slot: RunSlot;
  ranked: boolean;
  at: number;
  date?: string;
}

export interface Streak {
  /** The last day (YYYY-MM-DD) that kept the streak: a daily dungeon begun. */
  last: string | null;
  count: number;
  best: number;
  /** Days the streak may miss without breaking: one earned every seven days of it, two at most. */
  freezes: number;
}

/** A place among the best of a finished week or day, won once and kept. */
export interface Trophy {
  board: string;
  place: number;
  at: number;
}

export interface Profile {
  name: string;
  games: number;
  wins: number;
  deepest: number;
  /** The best checked score in the dungeon, and by class. */
  best: number;
  bestByClass: Partial<Record<HeroClass, number>>;
  /** The arena of waves: most waves held, and the best score. */
  arenaWaves: number;
  arenaBest: number;
  streak: Streak;
  /** The last day whose ranked daily dungeon was begun. */
  dailyDate: string | null;
  badges: BadgeProgress;
  /** The last fallen hero's bones, for the next ordinary run. */
  bones: Bones | null;
  history: RunSummary[];
  trophies: Trophy[];
  /** Boards already looked at for trophies (their names). */
  claimed: string[];
}

export const MAX_FREEZES = 2;
const HISTORY = 20;

export function emptyProfile(name = 'Hero'): Profile {
  return {
    name, games: 0, wins: 0, deepest: 0, best: 0, bestByClass: {}, arenaWaves: 0, arenaBest: 0,
    streak: { last: null, count: 0, best: 0, freezes: 0 }, dailyDate: null, badges: emptyBadgeProgress(), bones: null, history: [], trophies: [], claimed: [],
  };
}

/** The days between two dates (YYYY-MM-DD), b after a. */
const daysBetween = (a: string, b: string): number => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/**
 * The streak once a daily dungeon is begun on `today`: a day on from the last goes on; a gap the
 * freezes can cover goes on too, spending them; a longer one starts afresh.
 */
export function keepStreak(streak: Streak, today: string): Streak {
  if (streak.last === today) return streak;
  const gap = streak.last ? daysBetween(streak.last, today) : Infinity;
  if (gap < 1) return streak;
  const missed = gap - 1;
  const count = missed <= streak.freezes ? streak.count + 1 : 1;
  const freezes = missed <= streak.freezes ? streak.freezes - missed : 0;
  // Every seventh day of a streak earns a freeze.
  const earned = count % 7 === 0 ? 1 : 0;
  return { last: today, count, best: Math.max(streak.best, count), freezes: Math.min(MAX_FREEZES, freezes + earned) };
}

/** A streak as it stands on `today` without anything played: broken if the freezes cannot cover the gap. */
export function streakNow(streak: Streak, today: string): Streak {
  if (!streak.last) return streak;
  const missed = daysBetween(streak.last, today) - 1;
  return missed > streak.freezes ? { ...streak, count: 0 } : streak;
}

export interface StartOptions {
  slot: RunSlot;
  heroClass: HeroClass;
  challenges: number;
  name: string;
  /** For runs that are not the daily dungeon's. */
  seed: number;
  /** A fresh id for the run. */
  id: string;
  now: number;
  /** Today (YYYY-MM-DD, UTC). */
  today: string;
}

export interface SyncReply {
  /** Actions taken so far. */
  seq: number;
  /** The run as the server has it, when the device's copy differs (or is of another run). */
  run?: { id: string; seq: number; ranked: boolean; slot: RunSlot; date?: string };
  world?: World;
  /** Badges the run earned in this batch. */
  badges?: BadgeId[];
  /** The run is over: how it ended, its places on the boards (once they are known) and whether it is a record. */
  finished?: RunSummary;
  places?: Partial<Record<string, number | null>>;
  record?: boolean;
  /** Why the server's copy was sent. */
  reason?: string;
}

export interface SyncResult {
  reply: SyncReply;
  /** Depths that may have changed. */
  touched: Set<number>;
  finish?: Finish;
}

/** What the boards and the profile hear when a run ends. */
export interface Finish {
  summary: RunSummary;
  /** A new best of the player's (dungeon score, or arena waves). */
  record: boolean;
}

export class PlayerLogic {
  constructor(
    public profile: Profile,
    public readonly runs: Partial<Record<RunSlot, Run>> = {},
  ) {}

  /**
   * A new run in a slot. The daily dungeon is one per day: asked again while it is under way,
   * it carries on; once it is over, a new one is practice that does not count.
   */
  start(options: StartOptions): Run {
    const { slot, now, today } = options;
    const current = this.runs[slot];
    if (slot === 'daily' && current && current.date === today && !current.finished) return current;
    const daily = slot === 'daily';
    const ranked = !daily || this.profile.dailyDate !== today;
    const seed = daily ? dailySeed(today) : options.seed;
    // The daily dungeon has its own rules (daily.ts): the day's hardship, and its boon once the hero is there.
    const rules = daily ? dailyRules(today) : null;
    const world = createWorld(seed, rules ? rules.challenge : slot === 'arena' ? 0 : options.challenges, slot === 'arena' ? 'arena' : 'dungeon');
    const hero = addHero(world, { id: ME, name: options.name, heroClass: options.heroClass });
    if (rules) applyBoon(world, hero, rules.boon);
    // Bones.java: a fallen hero's bones wait in ordinary runs, never in the daily dungeon (the same for everyone).
    if (slot === 'dungeon' && this.profile.bones) {
      giveBones(world, this.profile.bones);
      this.profile.bones = null;
    }
    if (daily && ranked) {
      this.profile.dailyDate = today;
      this.profile.streak = keepStreak(this.profile.streak, today);
    }
    this.profile.name = options.name;
    this.profile.games++;
    countGame(this.profile.badges, seed);
    const run: Run = { id: options.id, slot, seed, ...(daily ? { date: today } : {}), ranked, seq: 0, startedAt: now, updatedAt: now, world };
    this.runs[slot] = run;
    return run;
  }

  /**
   * The device's actions `from` its count of actions taken, and what its copy's fingerprint
   * came to after them. Actions the server already has (an answer lost on the way) are skipped;
   * an action the server's copy refuses, a fingerprint that differs, or a count the server never
   * reached sends the server's copy back.
   */
  sync(slot: RunSlot, id: string, from: number, actions: readonly Action[], hash: string | null, now: number): SyncResult {
    const run = this.runs[slot];
    const touched = new Set<number>();
    let finish: Finish | undefined;
    if (!run) return { reply: { seq: 0, reason: 'none' }, touched };
    const resend = (reason: string): SyncResult => ({ reply: { seq: run.seq, run: describe(run), world: run.world, reason, ...ended(run) }, touched, ...(finish ? { finish } : {}) });
    if (run.id !== id) return resend('another run');
    if (from > run.seq || from + actions.length < run.seq) return resend('out of step');
    const fresh: BadgeId[] = [];
    // Where the hero was and went: only those depths (and the ones beside, where things fall) can have changed.
    const near = (): void => {
      const depth = heroById(run.world, ME)?.depth;
      if (depth !== undefined) for (const d of [depth - 1, depth, depth + 1]) touched.add(d);
    };
    near();
    for (const action of actions.slice(run.seq - from)) {
      if (run.world.over) return resend('over');
      const result = act(run.world, ME, action);
      near();
      if (!result.ok) return resend(`refused: ${result.reason}`);
      run.seq++;
      const me = heroById(run.world, ME);
      if (me) fresh.push(...checkBadges(this.profile.badges, run.world, me, result.effects).fresh);
      if (run.world.over && !run.finished) finish = this.finish(run, now);
    }
    run.updatedAt = now;
    const reply: SyncReply = { seq: run.seq, ...(fresh.length ? { badges: fresh } : {}), ...ended(run) };
    if (hash !== null && from + actions.length === run.seq && hash !== fingerprint(run.world)) {
      return { reply: { ...reply, run: describe(run), world: run.world, reason: 'parted' }, touched, ...(finish ? { finish } : {}) };
    }
    return { reply, touched, ...(finish ? { finish } : {}) };
  }

  /** A run's end: into the profile, the history and (for a fallen hero of an ordinary run) the bones. */
  private finish(run: Run, now: number): Finish {
    const me = heroById(run.world, ME)!;
    const outcome = runOutcome(run.world, me);
    run.finished = outcome;
    const summary: RunSummary = { ...outcome, slot: run.slot, ranked: run.ranked, at: now, ...(run.date ? { date: run.date } : {}) };
    run.summary = summary;
    const p = this.profile;
    let record = false;
    if (outcome.mode === 'arena') {
      record = outcome.depth > p.arenaWaves;
      p.arenaWaves = Math.max(p.arenaWaves, outcome.depth);
      p.arenaBest = Math.max(p.arenaBest, outcome.score);
    } else {
      record = run.ranked && outcome.score > p.best;
      if (run.ranked) {
        p.best = Math.max(p.best, outcome.score);
        p.bestByClass[outcome.heroClass] = Math.max(p.bestByClass[outcome.heroClass] ?? 0, outcome.score);
      }
      p.deepest = Math.max(p.deepest, outcome.depth);
      if (outcome.won) p.wins++;
    }
    if (run.slot === 'dungeon' && !outcome.won) {
      // Bones.leave, with its dice from the run's own seed.
      const rng = Rng.seeded(deriveSeed(run.seed, 0xb0e5));
      p.bones = leaveBones(me, rng.int(BONES_ROLLS), rng.float());
    }
    p.history = [summary, ...p.history].slice(0, HISTORY);
    run.record = record;
    return { summary, record };
  }
}

/** What a reply says of a run that is over. */
export function ended(run: Run): Pick<SyncReply, 'finished' | 'places' | 'record'> {
  return run.summary ? { finished: run.summary, places: run.places ?? {}, record: run.record ?? false } : {};
}

export function describe(run: Run): NonNullable<SyncReply['run']> {
  return { id: run.id, seq: run.seq, ranked: run.ranked, slot: run.slot, ...(run.date ? { date: run.date } : {}) };
}

/** A slot's name from a request, or null. */
export const parseSlot = (value: unknown): RunSlot | null => (RUN_SLOTS as readonly unknown[]).includes(value) ? (value as RunSlot) : null;
