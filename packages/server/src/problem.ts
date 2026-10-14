/*
 * «Сообщить о проблеме» (design v20 ReleaseReport): a player's word on what went wrong, from the settings or the
 * error screen, with — when they leave it on — the run's last actions and the console's last errors. It goes to
 * the admin through the bot, and may earn the «Охотник за багами» badge when the admin confirms it.
 *
 *   POST /problem   { initData | id, rules, text?, attach, info, actions?, errors? }   a report: its id, or why not
 *
 * The body is the player's own word, so everything about it is bounded: the body's size (MAX_PROBLEM_BYTES), each
 * field, how many lines the log may hold, and how many reports one player may send a day (PROBLEMS_PER_DAY, kept in
 * their profile). Their text is never put in a URL, and is escaped where the bot's message shows it (escapeHtml).
 * The report is kept by the ReportStore object (index.ts) with the reporter privately beside it, so that the
 * admin's /bughunter <id> can find them; GET /reports never serves who.
 *
 * Pure logic, so it can be tested without a Durable Object.
 */

/** The longest report body: the log's lines, a text and a few facts fit well within. */
export const MAX_PROBLEM_BYTES = 40 * 1024;
/** How many reports one player may send in a (UTC) day. */
export const PROBLEMS_PER_DAY = 5;
/** The log keeps the last this many actions and this many console errors. */
export const MAX_ACTIONS = 200;
export const MAX_ERRORS = 10;
const TEXT_CHARS = 1000;
const ACTION_CHARS = 80;
const ERROR_CHARS = 300;
const FACT_CHARS = 120;
/** Reports kept at most (the oldest go first). */
export const KEEP_PROBLEMS = 200;
/** An id as the admin types it: six letters and digits without the look-alikes (no 0/O, 1/I/L). */
export const ID_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const ID_LENGTH = 6;

/** What a player sends about the moment. */
export interface ProblemFacts {
  /** The game's version, the rules' version and the build. */
  version: string;
  rules: number;
  build: string;
  /** The run: its id, seed, depth, the slot, the actions taken; absent at the title. */
  run?: { id: string; seed: number; depth: number; slot: string; seq: number };
  /** The phone and Telegram's platform, and the language. */
  device: string;
  platform: string;
  lang: string;
}

/** A report as it is kept. */
export interface Problem {
  /** What the admin quotes: /bughunter <id>. */
  id: string;
  at: number;
  /** The player's words, cut. */
  text: string;
  facts: ProblemFacts;
  /** The last actions and console errors, when the player attached the log. */
  actions?: string[];
  errors?: string[];
  /** The admin confirmed it: the badge was given. */
  hunter?: boolean;
}

/** A report with the reporter beside it: only the store keeps who. */
export interface StoredProblem extends Problem {
  by: string;
}

/** Control characters out (a newline stays one in the player's text), then cut. */
function clean(value: unknown, limit: number, lines = false): string {
  const pattern = lines ? /[\u0000-\u0009\u000b-\u001f\u007f]/g : /[\u0000-\u001f\u007f]/g;
  return String(value ?? '').replace(pattern, ' ').trim().slice(0, limit);
}

const int = (value: unknown, min: number, max: number): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : null;

/** A player's report cut down to what is safe and small to keep; null if it is not a report at all. */
export function parseProblem(body: unknown, now: number): Omit<Problem, 'id'> | null {
  if (!body || typeof body !== 'object') return null;
  const raw = body as Record<string, unknown>;
  const info = (raw.info && typeof raw.info === 'object' ? raw.info : {}) as Record<string, unknown>;
  const text = clean(raw.text, TEXT_CHARS, true);
  const rules = int(info.rules, 0, 1_000_000);
  if (rules === null) return null;
  const facts: ProblemFacts = {
    version: clean(info.version, 16), rules, build: clean(info.build, 24),
    device: clean(info.device, FACT_CHARS), platform: clean(info.platform, 24), lang: clean(info.lang, 8),
  };
  const run = info.run && typeof info.run === 'object' ? (info.run as Record<string, unknown>) : null;
  if (run) {
    const depth = int(run.depth, 0, 100);
    const seq = int(run.seq, 0, 10_000_000);
    const seed = typeof run.seed === 'number' && Number.isFinite(run.seed) ? Math.trunc(run.seed) : null;
    if (depth !== null && seq !== null && seed !== null) facts.run = { id: clean(run.id, 64), seed, depth, slot: clean(run.slot, 12), seq };
  }
  const problem: Omit<Problem, 'id'> = { at: now, text, facts };
  // The log only if the player left it on (attach), and bounded either way.
  if (raw.attach !== false) {
    const lines = (value: unknown, count: number, chars: number): string[] =>
      Array.isArray(value) ? value.slice(-count).map((line) => clean(line, chars)).filter(Boolean) : [];
    const actions = lines(raw.actions, MAX_ACTIONS, ACTION_CHARS);
    const errors = lines(raw.errors, MAX_ERRORS, ERROR_CHARS);
    if (actions.length > 0) problem.actions = actions;
    if (errors.length > 0) problem.errors = errors;
  }
  return problem;
}

/** The text of a Telegram message in HTML mode: the characters that mean markup, said as themselves. */
export const escapeHtml = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A fresh id from random bytes (crypto.getRandomValues in the Worker). */
export function newId(random: (length: number) => Uint8Array = (length) => crypto.getRandomValues(new Uint8Array(length))): string {
  const bytes = random(ID_LENGTH);
  return Array.from(bytes, (byte) => ID_ALPHABET[byte % ID_ALPHABET.length]).join('');
}

/** An id as an admin typed it, upper case; null if it cannot be one. */
export function parseProblemId(text: string): string | null {
  const id = text.trim().toUpperCase();
  return id.length === ID_LENGTH && [...id].every((char) => ID_ALPHABET.includes(char)) ? id : null;
}

/** The short note the admin chat gets (HTML mode): what, where and the id to confirm it by. The player's words are escaped. */
export function adminNotice(problem: Problem): string {
  const f = problem.facts;
  const where = f.run ? `глубина ${f.run.depth}, ${escapeHtml(f.run.slot)}` : 'на экране «Привал»';
  const logged = problem.actions || problem.errors ? `журнал: ${problem.actions?.length ?? 0} действий, ${problem.errors?.length ?? 0} ошибок` : 'без журнала';
  const text = problem.text ? `«${escapeHtml(problem.text.replace(/\s+/g, ' ').slice(0, 300))}»` : '(без текста)';
  return [
    `🐞 Проблема <code>${problem.id}</code> · v${escapeHtml(f.version)} · правила ${f.rules}`,
    `${where} · ${escapeHtml(f.platform || '?')} · ${escapeHtml(f.lang || '?')}`,
    text,
    logged,
    `Подтвердить: /bughunter ${problem.id}`,
  ].join('\n');
}

/** Whether a player may send another report today, and their count after it (the day's, started anew each UTC day). */
export function takeProblemSlot(
  state: { day: string; count: number } | undefined, today: string, perDay = PROBLEMS_PER_DAY,
): { ok: boolean; state: { day: string; count: number } } {
  const current = state && state.day === today ? state : { day: today, count: 0 };
  return current.count >= perDay ? { ok: false, state: current } : { ok: true, state: { day: today, count: current.count + 1 } };
}

/** Honours that can be given. */
export const HONORS: readonly string[] = ['bughunter'];

/** Gives an honour to a profile: true if it was new. */
export function giveHonor(profile: { honors?: string[] }, honor: string): boolean {
  if (!HONORS.includes(honor)) return false;
  if (profile.honors?.includes(honor)) return false;
  profile.honors = [...(profile.honors ?? []), honor];
  return true;
}
