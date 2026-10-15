import { WIDTH } from '@pd/core';
import { quality } from './quality';
import { TILE } from './view';
import { drawFrame, frameAt, sheet } from './worldsheets';

/*
 * The map answering a tap (feedback.png): the cell aimed at is framed —
 * gold corners closing in for a walk, red for an attack — and stays framed
 * while the hero goes there; the way ahead is dotted, each dot going out as
 * the hero passes it; a cell that cannot be reached gets a red cross.
 */

/** Where a dot was passed, to shrink it away. */
interface Passed {
  cell: number;
  start: number;
}

const INTRO = [0, 1, 2] as const;
const PULSE = [0, 1, 2, 1] as const;
const DOT_OUT_MS = 180;
/** The danger ring stays this long (ms). */
const DANGER_RING_MS = 4000;
/** --danger of the design system. */
const DANGER_RED = '#ff8a73';

export class Feedback {
  /** The cell aimed at (or the monster chased, followed as it moves), and when. */
  private target: { cell: number; mob?: string; attack: boolean; start: number } | null = null;
  private nope: { cell: number; start: number } | null = null;
  /** The danger badge's pick (design v19, .pd-danger-ring): the enemy last stepped to is ringed in red, followed as it moves. */
  private ring: { mob: string; cell: number; start: number } | null = null;
  /** The target an aim from a quick slot has marked (QuickSlotButton.crossM): the slot tapped again fires at it. */
  private marked: string | null = null;
  private passed: Passed[] = [];
  /** The dots last drawn: only a dot of the way goes out when stepped on. */
  private dotted = new Set<number>();

  aim(cell: number, attack: boolean, now: number, mob?: string): void {
    this.target = { cell, attack, start: now, ...(mob ? { mob } : {}) };
    this.nope = null;
  }

  /** The enemy the danger badge stepped to. */
  danger(mob: string, cell: number, now: number): void {
    this.ring = { mob, cell, start: now };
  }

  refuse(cell: number, now: number): void {
    this.nope = { cell, start: now };
    this.target = null;
  }

  clear(): void {
    this.target = null;
  }

  /** The monster the aim is marked on (or none), set on every frame. */
  mark(mob: string | null): void {
    this.marked = mob;
  }

  /** The ring goes (the enemy is out of sight). */
  clearDanger(): void {
    this.ring = null;
  }

  /** The hero has stepped on a dot of the way. */
  stepped(cell: number, now: number): void {
    if (this.dotted.has(cell)) this.passed.push({ cell, start: now });
  }

  /**
   * Over the floor, under the characters. `path` is the way still to walk, `mobAt` where a chased
   * monster is now (the frame follows it), `done` whether the hero has got there.
   */
  draw(ctx: CanvasRenderingContext2D, path: readonly number[], mobAt: (id: string) => number | undefined, done: boolean, now: number): void {
    const s = sheet('feedback');
    if (!s) return;
    const xy = (cell: number): [number, number] => [(cell % WIDTH) * TILE, Math.trunc(cell / WIDTH) * TILE];

    // The way ahead, dot by dot; the passed ones shrink away.
    const dots = s.anims['path-dots'];
    if (dots) {
      this.dotted = new Set(path);
      for (const cell of path.slice(0, -1)) {
        const [x, y] = xy(cell);
        drawFrame(ctx, s, dots[1]!, x + 6, y + 6);
      }
      this.passed = this.passed.filter((p) => now - p.start < DOT_OUT_MS * 3);
      for (const p of this.passed) {
        const step = Math.floor((now - p.start) / DOT_OUT_MS);
        const [x, y] = xy(p.cell);
        if (step < 2) drawFrame(ctx, s, dots[step + 1]!, x + 6, y + 6);
      }
    }

    if (this.target) {
      const cell = this.target.mob ? mobAt(this.target.mob) ?? this.target.cell : this.target.cell;
      // Got there, or the blow has been struck: the frame goes (after a moment, so it is seen).
      if (done && now - this.target.start > 260) {
        this.target = null;
      } else {
        const frames = s.anims[this.target.attack ? 'target-attack' : 'target-move'];
        if (frames) {
          const t = now - this.target.start;
          const each = frames[0]!.ms;
          // Closing in once, then pulsing while the hero is on the way.
          const frame = quality.reducedMotion
            ? frames[2]!
            : t < each * INTRO.length ? frameAt(frames, t, false, INTRO) : frameAt(frames, t - each * INTRO.length, true, PULSE);
          const [x, y] = xy(cell);
          drawFrame(ctx, s, frame, x, y);
        }
      }
    }

    // The marked target: the attack frame, pulsing as long as the aim lasts.
    const markedAt = this.marked ? mobAt(this.marked) : undefined;
    if (markedAt !== undefined) {
      const frames = s.anims['target-attack'];
      if (frames) {
        const frame = quality.reducedMotion ? frames[2]! : frameAt(frames, now, true, PULSE);
        const [x, y] = xy(markedAt);
        drawFrame(ctx, s, frame, x, y);
      }
    }

    if (this.ring) {
      const t = now - this.ring.start;
      if (t > DANGER_RING_MS) {
        this.ring = null;
      } else {
        const cell = mobAt(this.ring.mob) ?? this.ring.cell;
        const [x, y] = xy(cell);
        // A red frame with its corners cut off (the design's notch), fading in the last half second, pulsing a little.
        ctx.globalAlpha = Math.min(1, (DANGER_RING_MS - t) / 500) * (quality.reducedMotion ? 1 : 0.8 + 0.2 * Math.sin(t / 120));
        ctx.fillStyle = DANGER_RED;
        ctx.fillRect(x + 1, y, TILE - 2, 1);
        ctx.fillRect(x + 1, y + TILE - 1, TILE - 2, 1);
        ctx.fillRect(x, y + 1, 1, TILE - 2);
        ctx.fillRect(x + TILE - 1, y + 1, 1, TILE - 2);
        ctx.globalAlpha = 1;
      }
    }

    if (this.nope) {
      const frames = s.anims.nope;
      const t = now - this.nope.start;
      const life = frames ? frames.reduce((sum, f) => sum + f.ms, 0) : 0;
      if (!frames || t > life) {
        this.nope = null;
      } else {
        const [x, y] = xy(this.nope.cell);
        ctx.globalAlpha = Math.min(1, (life - t) / 120);
        drawFrame(ctx, s, frameAt(frames, t), x, y);
        ctx.globalAlpha = 1;
      }
    }
  }
}
