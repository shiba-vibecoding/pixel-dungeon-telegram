import { audio } from './audio';
import { t } from './i18n';
import { quality } from './quality';

/*
 * The step tutorial of the first run (design system v18, components/CampTutorial): the screen dimmed but for
 * the place the step is about, with gold corners round it that breathe, and a bubble («Step N of 4») with
 * «Next» and «Skip the tutorial» (the last step: «Got it»). Four steps, each shown when it becomes relevant:
 * an enemy seen, the stairs seen, the backpack once there is something in it, the quick slot.
 *
 * The overlay lets taps through to the game; a step closes itself when the player does what it is about
 * (Tutorial.did). Finishing or skipping is kept on the device (`pd-coach-done`) and with the player's profile
 * on the server, so a new device or a cleared cache does not play it again.
 */

export type StepId = 'enemy' | 'stairs' | 'backpack' | 'quick';
export const STEPS: readonly StepId[] = ['enemy', 'stairs', 'backpack', 'quick'];

/** A place on the interface layer, in its own pixels. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TutorialHost {
  /** The layer the overlay goes on (#ui). */
  root: HTMLElement;
  /** The layer's scale (the monitor layout's whole-number scale). */
  scale(): number;
  /** Where a step's place is on screen now; null if it is not on screen. */
  rectOf(step: StepId): Rect | null;
  /** The step has become relevant (the enemy is in sight, the stairs seen...). */
  ready(step: StepId): boolean;
  /** A word for the step's text (the enemy's name). */
  noun(step: StepId): string;
  /** A window is open over the game: the overlay waits. */
  blocked(): boolean;
  /** The tutorial is over, finished or skipped. */
  finished(): void;
}

const DONE = 'pd-coach-done';
const SEEN = 'pd-coach-seen';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Whether the tutorial is done, read once (the game asks every frame): kept up with every write of it here. */
let doneKnown: boolean | null = null;

function write(key: string, value: string): void {
  if (key === DONE) doneKnown = value === '1';
  try {
    localStorage.setItem(key, value);
  } catch {
    // For this session only.
  }
}

/** A text with its *emphasis* marked: the emphasised words in gold. */
function marked(text: string): Array<string | HTMLElement> {
  return text.split('*').map((part, i) => {
    if (i % 2 === 0) return part;
    const em = document.createElement('em');
    em.textContent = part;
    return em;
  });
}

/** Seen through or skipped, on this device. */
export const coachDone = (): boolean => (doneKnown ??= read(DONE) === '1');

/** A player who has played before the tutorial existed does not need it. */
export function veteranSkips(): boolean {
  if (coachDone() || read(SEEN) === '1') return false;
  const veteran = read('pd-moved') === '1';
  if (veteran) write(DONE, '1');
  return veteran;
}

/** The server says it is done (another device, or before the cache was cleared). */
export function markCoachDone(): void {
  write(DONE, '1');
}

export class Tutorial {
  /** Steps done; the one shown, or waiting to be, is STEPS[index]. */
  private index = 0;
  private shown: StepId | null = null;
  private node: HTMLElement | null = null;
  private ring: HTMLElement | null = null;
  private bubble: HTMLElement | null = null;
  private placed = '';
  /** When the step's place was last seen on screen. */
  private seenAt = 0;
  private after = 0;

  constructor(private readonly host: TutorialHost) {}

  /** The overlay is up now. */
  get visible(): boolean {
    return this.node !== null && !this.node.hidden;
  }

  /** The tutorial still has steps to show. */
  get active(): boolean {
    return !coachDone();
  }

  /** The step that is up, or null. */
  get step(): StepId | null {
    return this.shown;
  }

  /** The current step waits for its moment, or is up. */
  get waiting(): StepId | null {
    return this.active ? STEPS[this.index] ?? null : null;
  }

  /** Called every frame of the game. */
  frame(now: number): void {
    if (!this.active) {
      if (this.node) this.close();
      return;
    }
    const current = STEPS[this.index];
    if (!current) return;
    if (this.host.blocked()) {
      if (this.node) this.node.hidden = true;
      return;
    }
    if (this.shown !== current) {
      // A moment between steps, so that one does not take the place of the last at once.
      if (now < this.after || !this.host.ready(current)) return;
      this.open(current, now);
    }
    if (!this.node || !this.ring || !this.bubble) return;
    const rect = this.host.rectOf(current);
    if (!rect) {
      // The place is gone from the screen (the enemy walked off, the map was panned): the step waits until it is back.
      if (now - this.seenAt > 500) this.node.hidden = true;
      return;
    }
    this.seenAt = now;
    this.node.hidden = false;
    this.place(rect);
  }

  /** The player did what the step is about: it closes by itself (or, if it was still to come, is not shown at all). */
  did(step: StepId): void {
    if (this.active && STEPS[this.index] === step) this.advance(performance.now());
  }

  private open(step: StepId, now: number): void {
    this.close();
    write(SEEN, '1');
    this.shown = step;
    this.seenAt = now;
    const i = STEPS.indexOf(step);
    const [title, text] = t.coach.steps[i]!;
    const last = i === STEPS.length - 1;
    const node = document.createElement('div');
    node.className = 'pd-coach';
    node.setAttribute('role', 'dialog');
    node.ariaLabel = title;
    const ring = document.createElement('div');
    ring.className = 'pd-coach-ring';
    const bubble = document.createElement('div');
    bubble.className = 'pd-coach-bubble above';
    const head = document.createElement('div');
    head.className = 'pd-coach-head';
    const name = document.createElement('b');
    name.textContent = title;
    const count = document.createElement('span');
    count.className = 'pd-coach-step';
    count.textContent = t.coach.step(i + 1, STEPS.length);
    head.append(name, count);
    const body = document.createElement('p');
    body.className = 'pd-coach-text';
    body.append(...marked(text.replace('%s', this.host.noun(step))));
    const skip = document.createElement('button');
    skip.className = 'pd-button quiet';
    skip.textContent = t.coach.skip;
    skip.onclick = () => {
      audio.play('click');
      this.finish();
    };
    const next = document.createElement('button');
    next.className = `pd-button${last ? ' primary' : ''}`;
    next.textContent = last ? t.coach.done : t.coach.next;
    next.onclick = () => {
      audio.play('click');
      this.advance(performance.now());
    };
    const actions = document.createElement('div');
    actions.className = 'pd-coach-actions';
    actions.append(skip, next);
    const dots = document.createElement('div');
    dots.className = 'pd-coach-dots';
    dots.setAttribute('aria-hidden', 'true');
    STEPS.forEach((_, n) => {
      const dot = document.createElement('i');
      if (n <= i) dot.className = 'on';
      dots.append(dot);
    });
    bubble.append(head, body, actions, dots);
    node.append(ring, bubble);
    node.hidden = true;
    this.host.root.append(node);
    this.node = node;
    this.ring = ring;
    this.bubble = bubble;
    this.placed = '';
    // A soft chime as a step comes up.
    audio.play('sparkle', 1, 0.3);
  }

  /** The ring round the place (4 px wider than a cell), the bubble above it or below. */
  private place(rect: Rect): void {
    const layer = this.host.root.getBoundingClientRect();
    const scale = this.host.scale() || 1;
    const width = layer.width / scale;
    const height = layer.height / scale;
    const key = `${Math.round(rect.x)},${Math.round(rect.y)},${Math.round(rect.w)},${Math.round(rect.h)},${Math.round(width)},${Math.round(height)}`;
    if (key === this.placed) return;
    this.placed = key;
    const ring = this.ring!;
    const bubble = this.bubble!;
    Object.assign(ring.style, { left: `${Math.round(rect.x)}px`, top: `${Math.round(rect.y)}px`, width: `${Math.round(rect.w)}px`, height: `${Math.round(rect.h)}px` });
    const below = rect.y + rect.h / 2 < height / 2;
    bubble.className = `pd-coach-bubble ${below ? 'below' : 'above'}`;
    if (below) {
      // Never under Telegram's own buttons at the top of a full screen (--safe-t, game.css).
      const safeTop = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--pd-tg-top')) || 0;
      bubble.style.top = `${Math.round(Math.max(rect.y + rect.h + 18, safeTop + 8))}px`;
      bubble.style.bottom = '';
    } else {
      bubble.style.bottom = `${Math.round(height - rect.y + 18)}px`;
      bubble.style.top = '';
    }
    bubble.style.setProperty('--tail', `${Math.round(Math.max(24, Math.min(width - 48, rect.x + rect.w / 2 - 12)))}px`);
  }

  private advance(now: number): void {
    this.close();
    this.index++;
    this.after = now + (quality.reducedMotion ? 600 : 1200);
    if (this.index >= STEPS.length) this.finish();
  }

  /** Finished or skipped: kept for good. */
  private finish(): void {
    this.close();
    write(DONE, '1');
    this.host.finished();
  }

  private close(): void {
    this.node?.remove();
    this.node = null;
    this.ring = null;
    this.bubble = null;
    this.shown = null;
  }
}
