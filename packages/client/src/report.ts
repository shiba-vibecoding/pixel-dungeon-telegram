/*
 * Tells the server what went wrong here (server reports.ts): script errors,
 * promises nobody caught, connections refused or lost, a world out of step
 * with the room. Only what the error was and where — the mode, the depth, the
 * build, Telegram's platform — never who; a few per session at most.
 */

type Context = Record<string, string | number | boolean>;

let endpoint = '';
let about: () => Context = () => ({});
const said = new Set<string>();
let sent = 0;
const LIMIT = 15;

/** The build: the hash in the name of the main script. */
export const build = ((): string => {
  if (typeof document === 'undefined') return 'test';
  const script = document.querySelector<HTMLScriptElement>('script[type="module"][src]');
  return /index-([\w-]+)\.js/.exec(script?.src ?? '')?.[1] ?? (import.meta.env.DEV ? 'dev' : '?');
})();

export function report(kind: string, message: string, stack?: string, context: Context = {}): void {
  if (!endpoint || sent >= LIMIT) return;
  const key = `${kind}|${message}`;
  if (said.has(key)) return;
  said.add(key);
  sent++;
  let facts: Context = {};
  try {
    facts = about();
  } catch {
    // Without them, then.
  }
  const body = JSON.stringify({
    kind, message: message.slice(0, 500), ...(stack ? { stack: stack.slice(0, 1500) } : {}),
    context: { build, ...facts, ...context },
  });
  try {
    if (!navigator.sendBeacon?.(endpoint, body)) void fetch(endpoint, { method: 'POST', body, keepalive: true }).catch(() => undefined);
  } catch {
    // Reporting never gets in the way.
  }
}

/** Sends a co-op session's log (netlog.ts); false when there is nowhere to send it. */
export function reportLog(message: string, log: string, context: Context = {}): boolean {
  if (!endpoint) return false;
  let facts: Context = {};
  try {
    facts = about();
  } catch {
    // Without them, then.
  }
  const body = JSON.stringify({ kind: 'coop-log', message: message.slice(0, 500), log: log.slice(-12_000), context: { build, ...facts, ...context } });
  try {
    if (!navigator.sendBeacon?.(endpoint, body)) void fetch(endpoint, { method: 'POST', body, keepalive: true }).catch(() => undefined);
  } catch {
    return false;
  }
  return true;
}

/** Starts listening; `server` is the co-op server's ws(s) address, `context` what to say about the moment. */
export function startReporting(server: string, context: () => Context): void {
  if (!server) return;
  endpoint = `${server.replace(/^ws/, 'http').replace(/\/+$/, '')}/report`;
  about = context;
  addEventListener('error', (event) => {
    // A resource that failed to load has no message; scripts' errors do.
    if (!event.message) return;
    const where = event.filename ? ` @ ${event.filename.replace(/^.*\//, '')}:${event.lineno}:${event.colno}` : '';
    report('error', `${event.message}${where}`, (event.error as Error | undefined)?.stack);
  });
  addEventListener('unhandledrejection', (event) => {
    const reason = event.reason as unknown;
    const message = reason instanceof Error ? reason.message : String(reason);
    report('rejection', message, reason instanceof Error ? reason.stack : undefined);
  });
}
