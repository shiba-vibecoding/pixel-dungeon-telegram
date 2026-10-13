/*
 * Pausing in the background. When the game is out of sight (the tab hidden, the window minimised, Telegram's own
 * «deactivated» event) the frame loop, the animated canvases and CSS animations stop, and on coming back everything
 * restarts cleanly. Telegram Desktop for Windows runs the app in Edge WebView, where a minimised window could
 * leave requestAnimationFrame and CSS animations frozen for good: so the loop is re-requested on every return, and
 * a watchdog re-requests it if frames stop coming while the game is in view.
 */
import { onActiveChange } from './telegram';

let deactivated = false;
let isPaused = typeof document !== 'undefined' && document.hidden;
const pauseHandlers = new Set<() => void>();
const resumeHandlers = new Set<() => void>();

/** Whether the game is out of sight. */
export const paused = (): boolean => isPaused;

/** Calls back when the game goes out of sight; returns a way to stop listening. */
export function onPause(handler: () => void): () => void {
  pauseHandlers.add(handler);
  return () => pauseHandlers.delete(handler);
}

/** Calls back when the game is in sight again; returns a way to stop listening. */
export function onResume(handler: () => void): () => void {
  resumeHandlers.add(handler);
  return () => resumeHandlers.delete(handler);
}

function sync(): void {
  const next = document.hidden || deactivated;
  if (next === isPaused) return;
  isPaused = next;
  const root = document.documentElement;
  // CSS animations stop while out of sight (styles: html.pd-paused).
  root.classList.toggle('pd-paused', next);
  if (!next) {
    // A reflow wakes animations a WebView left frozen.
    void root.offsetHeight;
  }
  for (const handler of [...(next ? pauseHandlers : resumeHandlers)]) {
    try {
      handler();
    } catch (error) {
      console.error(error);
    }
  }
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', sync);
  // Some WebViews send only these on minimising and restoring.
  addEventListener('pagehide', () => {
    deactivated = true;
    sync();
  });
  addEventListener('pageshow', () => {
    deactivated = false;
    sync();
  });
  onActiveChange((active) => {
    deactivated = !active;
    sync();
  });
  if (isPaused) document.documentElement.classList.add('pd-paused');
}

/**
 * A requestAnimationFrame loop that sleeps while the game is out of sight and starts afresh on return.
 * The callback gets the frame's time and `resumed` set to true on the first frame after a pause or a stall
 * (clocks measured between frames must start over then). Returns a way to stop it.
 */
export function loop(frame: (now: number, resumed: boolean) => void): () => void {
  let handle = 0;
  let last = 0;
  let restart = true;
  let stopped = false;
  const step = (now: number): void => {
    if (stopped) return;
    last = performance.now();
    handle = requestAnimationFrame(step);
    const resumed = restart;
    restart = false;
    frame(now, resumed);
  };
  const start = (): void => {
    if (stopped) return;
    cancelAnimationFrame(handle);
    restart = true;
    last = performance.now();
    handle = requestAnimationFrame(step);
  };
  const offPause = onPause(() => cancelAnimationFrame(handle));
  const offResume = onResume(start);
  // The watchdog: frames that stop while the game is in view are asked for again.
  const watchdog = window.setInterval(() => {
    if (!isPaused && performance.now() - last > 1500) start();
  }, 1000);
  if (!isPaused) start();
  return () => {
    stopped = true;
    cancelAnimationFrame(handle);
    offPause();
    offResume();
    clearInterval(watchdog);
  };
}
