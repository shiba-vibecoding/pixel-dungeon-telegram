/*
 * A window that must come back (the forum study's U4): the backpack, an item's panel and above all a pending pick (the
 * item a scroll is to be read on) are kept on this device while they are open, and put back after a turn of the phone,
 * a resize, the Mini App coming back from the background or a reload, if the game still allows it: the same run, the same
 * turn, the hero alive, the item still what it was. What the window is (screens.ts WindowState) is no concern here.
 */

const KEY = 'pd-window';

export interface Memo<S = unknown> {
  /** The run it was open in (its seed and id). */
  run: string;
  /** The turn it was open at: a window is not put back once the game has moved on. */
  turn: number;
  /** The kind of the item the window is about, to be sure it is the same one. */
  kind?: string;
  state: S;
}

/** Whether a kept window may be put back now. */
export function memoValid(memo: Memo | null, run: string, turn: number, alive: boolean, over: boolean): memo is Memo {
  return !!memo && alive && !over && memo.run === run && memo.turn === turn;
}

export function saveMemo(memo: Memo): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(memo));
  } catch {
    // For this session only.
  }
}

export function clearMemo(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing kept.
  }
}

/** The window kept on this device, if it reads right. */
export function loadMemo(): Memo | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const memo = JSON.parse(raw) as Memo;
    return typeof memo.run === 'string' && Number.isInteger(memo.turn) && memo.state && typeof memo.state === 'object' ? memo : null;
  } catch {
    return null;
  }
}
