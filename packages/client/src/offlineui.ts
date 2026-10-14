import { audio } from './audio';
import { t } from './i18n';
import { button, el, info, show } from './screens';

/*
 * «Нет связи с сервером» (design system v20, components/ReleaseOffline). Two moments, told apart because what is
 * true of them differs:
 *
 *  - 'live': a run the server handed out has moves it has not taken (session.ts: the moves stay in the log kept on
 *    the device and go again after a backoff, or at once when the network returns). The game goes on without
 *    boards and mail, and the run counts when the connection returns: «Retry» asks the server now, «Play offline»
 *    closes the window and plays on, under the strip (netstrip in main.ts).
 *  - 'start': a new run is asked for and the server cannot be reached. It hands out every run that counts, so a
 *    run begun now would count nowhere: «Retry» asks again, «Play without ranking» plays a local run.
 *
 * The window checks the server by itself every 20 seconds, and closes when it answers.
 */

/** How often the window asks the server by itself (s). */
export const AUTO_CHECK_S = 20;

export interface OfflineOptions {
  kind: 'live' | 'start';
  /** Asks the server whether it is there now. */
  ping(): Promise<boolean>;
  /** The server is there: carry on (a new run is asked for again; a run under way sends its moves). */
  onBack(): void;
  /** «Play offline» (live) or «Play without ranking» (start). */
  onPlay(): void;
}

/** Whether a window of this kind is open on the page now (the live one closes itself when the connection returns). */
let openNow: { close(): void } | null = null;

/** Closes the open offline window, if any (the connection came back by another way). */
export function closeOffline(): boolean {
  if (!openNow) return false;
  openNow.close();
  return true;
}

export function showOffline(options: OfflineOptions): void {
  let left = AUTO_CHECK_S;
  let busy = false;
  let timer = 0;
  const state = { close: (): void => undefined };
  const icon = el('i', { className: 'pd-offline-ico' });
  const auto = info('', 'pd-note center');
  const retry = button(t.rel.offline.retry, () => void check(), 'primary');
  const play = button(options.kind === 'live' ? t.rel.offline.play : t.rel.offline.playNew, () => {
    stop();
    options.onPlay();
  });
  const stop = (): void => {
    clearInterval(timer);
    if (openNow === state) openNow = null;
  };
  const text = (): void => {
    auto.textContent = busy ? t.rel.offline.checking : t.rel.offline.auto.replace('{n}', String(left));
  };
  const check = async (): Promise<void> => {
    if (busy) return;
    busy = true;
    retry.disabled = true;
    left = AUTO_CHECK_S;
    text();
    const there = await options.ping();
    busy = false;
    retry.disabled = false;
    if (!there) {
      auto.textContent = t.rel.offline.stillOff;
      window.setTimeout(text, 1500);
      return;
    }
    stop();
    audio.play('gold', 1, 0.3);
    options.onBack();
  };
  timer = window.setInterval(() => {
    if (!icon.isConnected) {
      stop();
      return;
    }
    if (busy) return;
    left--;
    if (left <= 0) void check();
    else text();
  }, 1000);
  state.close = stop;
  openNow = state;
  text();
  const box = el(
    'section',
    { className: 'pd-window narrow pd-offline', role: 'alertdialog', ariaLabel: t.rel.offline.title },
    icon,
    el('h2', { className: 'pd-heading center', textContent: t.rel.offline.title }),
    info(options.kind === 'live' ? t.rel.offline.text : t.rel.offline.textStart, 'pd-info center'),
    info(t.rel.offline.note, 'pd-note center'),
    el('div', { className: 'pd-actions' }, retry, play),
    auto,
  );
  show(box, null);
}
