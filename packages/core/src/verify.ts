import type { Hero } from './actors';
import { arenaScore, wavesCleared } from './arena';
import { type ScoreBreakdown, scoreBreakdown } from './score';
import type { World } from './world';

/*
 * Checked runs: the server plays every run again from the player's actions (the core is
 * deterministic), so what a run scored is what the server's own copy of it says, whatever a
 * player's device claims. A fingerprint of the state lets the device and the server tell at
 * once when their copies part (a bug, an edited device), and the device then takes the
 * server's copy back.
 */

/**
 * A hash of a value that does not depend on the order of its objects' keys (a world that went
 * through storage comes back with its keys in another order) and skips what is undefined.
 */
function hashValue(value: unknown, h: [number, number]): void {
  const feed = (text: string): void => {
    let [a, b] = h;
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      a = Math.imul(a ^ c, 2654435761);
      b = Math.imul(b ^ c, 1597334677);
    }
    h[0] = a;
    h[1] = b;
  };
  const walk = (v: unknown): void => {
    if (v === null) return feed('n');
    switch (typeof v) {
      case 'number':
        // -0 and 0 are the same once stored.
        return feed(`#${v === 0 ? 0 : v}`);
      case 'string':
        return feed(`"${v.length}:${v}`);
      case 'boolean':
        return feed(v ? 't' : 'f');
      case 'object': {
        if (Array.isArray(v)) {
          feed(`[${v.length}`);
          // Holes and undefined items are stored as null.
          for (const item of v) walk(item === undefined ? null : item);
          return feed(']');
        }
        const record = v as Record<string, unknown>;
        const keys = Object.keys(record).filter((key) => record[key] !== undefined).sort();
        feed(`{${keys.length}`);
        for (const key of keys) {
          feed(key);
          walk(record[key]);
        }
        return feed('}');
      }
      default:
        // Functions and undefined are not state.
        return undefined;
    }
  };
  walk(value);
}

/**
 * What the next turns of a run depend on, hashed: the heroes, and the depths they are on (their
 * layout and everything on them), with the run's own state. A difference anywhere else shows up
 * here as soon as it matters.
 */
export function fingerprint(world: World): string {
  const h: [number, number] = [0x811c9dc5, 0x9e3779b9];
  const { levels, floors, explored: _explored, ...rest } = world;
  hashValue(rest, h);
  const depths = [...new Set(world.heroes.map((hero) => hero.depth))].sort((a, b) => a - b);
  for (const depth of depths) {
    hashValue(depth, h);
    hashValue(levels[depth] ?? null, h);
    hashValue(floors[depth] ?? null, h);
  }
  return ((h[0] >>> 0).toString(36) + (h[1] >>> 0).toString(36)).padStart(14, '0');
}

/** The deepest depth a run has reached (levels are made as they are first entered). */
export const deepestDepth = (world: World): number => Math.max(1, ...Object.keys(world.levels).map(Number));

/** How a finished run (or one under way) stands: what the boards and the end screen show. */
export interface RunOutcome {
  mode: 'dungeon' | 'arena';
  heroClass: Hero['heroClass'];
  score: number;
  /** The deepest depth reached; in the arena, the waves held. */
  depth: number;
  level: number;
  gold: number;
  kills: number;
  won: boolean;
  /** What ended the run (a monster's kind, a cause), if anything did. */
  killedBy: string | null;
  turns: number;
  challenges: number;
  /** Shattered's score table (score.ts), in a dungeon run: the parts of `score`, which is its total. */
  breakdown?: ScoreBreakdown;
}

export function runOutcome(world: World, hero: Hero): RunOutcome {
  const gold = hero.stats?.gold ?? hero.gold;
  const base = {
    heroClass: hero.heroClass, level: hero.lvl, gold, kills: hero.kills, killedBy: hero.killedBy, turns: world.turn, challenges: world.challenges ?? 0,
  };
  if (world.arena) {
    return { ...base, mode: 'arena', score: arenaScore(world, hero.id), depth: wavesCleared(world.arena), won: false };
  }
  const depth = deepestDepth(world);
  // Rankings.calculateScore: progress, treasure, exploration, bosses and quests, times the win and challenge multipliers.
  const breakdown = scoreBreakdown(world, hero, depth, gold);
  return { ...base, mode: 'dungeon', score: breakdown.total, depth, won: world.victory, breakdown };
}

/**
 * The seed of a day's practice dungeon, played without the server (the label «not counted»): the same for everyone on
 * the same (UTC) day, `date` as YYYY-MM-DD. It is deliberately not the day's real seed: that one comes from the server's
 * secret (server/daily-seed.ts) and goes only to the player who starts the counted run, so nobody can scout it.
 */
export function practiceSeed(date: string): number {
  let hash = 2166136261;
  for (const char of `practice:${date}`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 1) % 2 ** 31;
}

/** A day as the daily dungeon counts them (UTC), YYYY-MM-DD. */
export const dayOf = (time: number): string => new Date(time).toISOString().slice(0, 10);

/** The ISO week a time falls in (UTC), as 2026-W42: the weekly boards' name. */
export function weekOf(time: number): string {
  const date = new Date(time);
  const day = (date.getUTCDay() + 6) % 7;
  // The Thursday of the same week decides its year.
  const thursday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - day + 3));
  const yearStart = Date.UTC(thursday.getUTCFullYear(), 0, 1);
  const week = 1 + Math.floor((thursday.getTime() - yearStart) / (7 * 86_400_000));
  return `${thursday.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** When the week `time` falls in ends (Monday 00:00 UTC after it). */
export function weekEnd(time: number): number {
  const date = new Date(time);
  const day = (date.getUTCDay() + 6) % 7;
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - day + 7);
}
