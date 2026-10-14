import type { World } from '@pd/core';
import { emptyProfile, type Profile, RUN_SLOTS, type Run, type RunSlot } from './runs';

/*
 * How a player is kept in their Durable Object's storage: the profile in one entry, and
 * each slot's run cut as rooms are (chunks.ts): a small record, and one chunk per depth,
 * so that a batch of moves writes the record and the depth it was played on, not the
 * whole dungeon.
 */

/** The shape of stored runs; a run of another is dropped (SAVE_VERSION in the client, STATE_FORMAT in rooms). */
export const RUN_FORMAT = 32;

const PROFILE = 'profile';
const runKey = (slot: RunSlot): string => `run:${slot}`;
const depthKey = (slot: RunSlot, depth: number): string => `run:${slot}:${depth}`;

interface RunMeta extends Omit<Run, 'world'> {
  format: number;
  world: Omit<World, 'levels' | 'floors' | 'explored'>;
  depths: number[];
}

interface DepthChunk {
  level: World['levels'][number];
  floor: World['floors'][number];
  explored?: World['explored'][number];
}

/**
 * A player's entries, keyed as they are stored. `kept` gives a depth's entry as last written when
 * that depth cannot have changed (nobody was near it), which spares writing out a whole dungeon
 * after every batch of moves.
 */
export function toEntries(
  profile: Profile, runs: Partial<Record<RunSlot, Run>>, kept: (key: string, slot: RunSlot, depth: number) => string | undefined = () => undefined,
): Record<string, string> {
  const entries: Record<string, string> = { [PROFILE]: JSON.stringify(profile) };
  for (const slot of RUN_SLOTS) {
    const run = runs[slot];
    if (!run) continue;
    const { levels, floors, explored, ...rest } = run.world;
    const depths = Object.keys(levels).map(Number).sort((a, b) => a - b);
    const meta: RunMeta = { ...run, format: RUN_FORMAT, world: rest, depths };
    entries[runKey(slot)] = JSON.stringify(meta);
    for (const depth of depths) {
      const key = depthKey(slot, depth);
      const chunk: DepthChunk = { level: levels[depth]!, floor: floors[depth]!, explored: explored[depth] };
      entries[key] = kept(key, slot, depth) ?? JSON.stringify(chunk);
    }
  }
  return entries;
}

/** A player back from their stored entries; a run that is incomplete or of another format is left out. */
export function fromEntries(entries: ReadonlyMap<string, string>): { profile: Profile; runs: Partial<Record<RunSlot, Run>> } {
  const raw = entries.get(PROFILE);
  const profile = { ...emptyProfile(), ...(raw ? (JSON.parse(raw) as Partial<Profile>) : {}) };
  const runs: Partial<Record<RunSlot, Run>> = {};
  for (const slot of RUN_SLOTS) {
    const metaRaw = entries.get(runKey(slot));
    if (!metaRaw) continue;
    const { depths, world, format, ...rest } = JSON.parse(metaRaw) as RunMeta;
    if (format !== RUN_FORMAT) continue;
    const full = { ...world, levels: {}, floors: {}, explored: {} } as World;
    let whole = true;
    for (const depth of depths) {
      const chunkRaw = entries.get(depthKey(slot, depth));
      if (chunkRaw === undefined) {
        whole = false;
        break;
      }
      const chunk = JSON.parse(chunkRaw) as DepthChunk;
      full.levels[depth] = chunk.level;
      full.floors[depth] = chunk.floor;
      if (chunk.explored) full.explored[depth] = chunk.explored;
    }
    if (whole) runs[slot] = { ...rest, world: full };
  }
  return { profile, runs };
}

/** Remembers what was last written, so that only changed entries are written again and those gone are deleted. */
export class EntryWriter {
  private written = new Map<string, string>();

  changes(entries: Record<string, string>): { put: Record<string, string>; remove: string[] } {
    const put: Record<string, string> = {};
    for (const [key, value] of Object.entries(entries)) {
      if (this.written.get(key) !== value) put[key] = value;
    }
    const remove = [...this.written.keys()].filter((key) => !(key in entries));
    this.written = new Map(Object.entries(entries));
    return { put, remove };
  }

  /** An entry as last written. */
  get(key: string): string | undefined {
    return this.written.get(key);
  }

  loaded(entries: ReadonlyMap<string, string>): void {
    this.written = new Map(entries);
  }

  reset(): void {
    this.written = new Map();
  }
}
