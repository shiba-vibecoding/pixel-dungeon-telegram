import type { Action } from '@pd/core';

/*
 * What a problem report carries besides the player's words (reportui.ts, the server's problem.ts): the run's last
 * actions, as short lines, and the last errors the console saw. Both are rings kept in memory, never sent unasked:
 * only a report the player sends, with «Attach the run's log» on, takes them. Actions are kinds and cells and
 * item kinds; no names, no chat, nothing typed by the player.
 */

/** How many actions and errors a report may carry (the server keeps the same numbers). */
export const ACTIONS_KEPT = 200;
export const ERRORS_KEPT = 10;
const ACTION_CHARS = 80;
const ERROR_CHARS = 300;

const actions: string[] = [];
const errors: string[] = [];
let count = 0;

/** One action as a short line: its number in this session, its kind and what it points at. */
export function describeAction(action: Action, n: number): string {
  const { type, ...rest } = action as { type: string } & Record<string, unknown>;
  const fields = Object.keys(rest).length > 0 ? ` ${JSON.stringify(rest)}` : '';
  return `#${n} ${type}${fields}`.slice(0, ACTION_CHARS);
}

/** Writes an action down, as a hero takes it. */
export function noteAction(action: Action): void {
  actions.push(describeAction(action, ++count));
  if (actions.length > ACTIONS_KEPT) actions.shift();
}

/** A new run: the actions of the last are not this one's. */
export function resetActions(): void {
  actions.length = 0;
  count = 0;
}

/** Writes an error down. */
export function noteError(text: string): void {
  const line = text.replace(/\s+/g, ' ').trim().slice(0, ERROR_CHARS);
  if (!line) return;
  errors.push(line);
  if (errors.length > ERRORS_KEPT) errors.shift();
}

/** What is kept now, to attach to a report. */
export function recent(): { actions: string[]; errors: string[] } {
  return { actions: [...actions], errors: [...errors] };
}

let listening = false;

/** Starts listening for the console's errors (once). */
export function watchErrors(): void {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  addEventListener('error', (event) => {
    if (event.message) noteError(`${event.message}${event.filename ? ` @ ${event.filename.replace(/^.*\//, '')}:${event.lineno}` : ''}`);
  });
  addEventListener('unhandledrejection', (event) => {
    const reason = event.reason as unknown;
    noteError(`rejection: ${reason instanceof Error ? reason.message : String(reason)}`);
  });
  const original = console.error.bind(console);
  console.error = (...args: unknown[]): void => {
    noteError(args.map((arg) => (arg instanceof Error ? arg.message : typeof arg === 'string' ? arg : safe(arg))).join(' '));
    original(...args);
  };
}

function safe(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}
