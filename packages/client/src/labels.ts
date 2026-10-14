import { capitalize, t } from './i18n';

/*
 * How a run counts (the forum study, §3): «counts» — the first run of the day's dungeon, and an ordinary run the server
 * checks; «repeat» — the day's dungeon played again, practice; «own seed» — a seed the player chose, which goes into no
 * record and no board; «not counted» — played without the server. The attempt of the day is spent when the run starts
 * (the server marks the day at the start, runs.ts PlayerLogic.start), so leaving or erasing the save gives nothing back.
 */

export type RunLabel = 'counted' | 'repeat' | 'custom' | 'local';

export interface RunFacts {
  /** A run the server checks (a session with `checked`). */
  checked: boolean;
  /** The server's word: it goes to the boards (false for the day's dungeon played again). */
  ranked: boolean;
  /** The player chose the seed. */
  customSeed?: boolean;
}

export function runLabel(run: RunFacts): RunLabel {
  if (run.customSeed) return 'custom';
  if (!run.checked) return 'local';
  return run.ranked ? 'counted' : 'repeat';
}

/** The label's word and what it means, in the player's language. */
export function labelWords(label: RunLabel): { kind: RunLabel; word: string; text: string; note: string } {
  const words = t.forum.label;
  const text = { counted: words.counted, repeat: words.repeat, custom: words.custom, local: words.local }[label];
  const note = { counted: words.countedNote, repeat: words.repeatNote, custom: words.customNote, local: words.localNote }[label];
  return { kind: label, word: text, text: capitalize(text), note };
}
