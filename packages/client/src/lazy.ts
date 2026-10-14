/*
 * Parts of the game the first screen does not need (a window opened by a button, a mode not shown) are separate chunks, fetched when
 * first wanted: `get()` loads once and answers every caller with the same module; `ready()` is the module if it has come, else
 * null (for the frame loop, which must not wait). After the first screen is up, `idle()` fetches the likely ones in the browser's
 * spare time, so the first tap rarely waits for the network.
 */

export interface Lazy<T> {
  get(): Promise<T>;
  ready(): T | null;
}

export function lazy<T>(load: () => Promise<T>): Lazy<T> {
  let loaded: T | null = null;
  let loading: Promise<T> | null = null;
  return {
    get() {
      return (loading ??= load().then(
        (module) => (loaded = module),
        (error: unknown) => {
          // A chunk that did not come (the network went) may be asked for again.
          loading = null;
          throw error;
        },
      ));
    },
    ready: () => loaded,
  };
}

/** Asks for the part and, when it has come, hands it to `use`; if it cannot come (the network went) `failed` is told, and it is asked for again next time. */
export function load<T>(part: Lazy<T>, use: (module: T) => void, failed?: () => void): void {
  part.get().then(use, failed ?? (() => undefined));
}

/** Runs `job` when the browser has nothing better to do (a little after the first screen), once. */
export function idle(job: () => void): void {
  const run = (): void => {
    try {
      job();
    } catch {
      // A prefetch that fails is no loss: the part is fetched when it is wanted.
    }
  };
  if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 8000 });
  else setTimeout(run, 3000);
}
