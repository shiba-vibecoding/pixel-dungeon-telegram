/*
 * How much the effects cost: full, or light for weaker phones (fewer
 * particles, no vignette or lights, a coarser canvas). «auto» starts full
 * and turns light by itself if frames come too slowly. The choice is kept
 * on this device. Reduced motion (the system setting) never shakes the view, holds no frame for a heavy blow and
 * thins the particles as the light mode does; the light mode shakes the view less.
 */

export type FxMode = 'auto' | 'full' | 'light';

const KEY = 'pd-fx';
/**
 * A frame slower than this, on average, is a phone struggling (under about 26 frames a second).
 * A steady 30 is not: a phone saving its battery runs every app at 30 and copes well.
 */
const SLOW_FRAME_MS = 38;
/** Frames are watched this long before «auto» decides anything. */
const SETTLE_MS = 4000;

function load(): FxMode {
  try {
    const value = localStorage.getItem(KEY);
    return value === 'full' || value === 'light' ? value : 'auto';
  } catch {
    return 'auto';
  }
}

class Quality {
  mode: FxMode = load();
  /** «auto» found the phone too slow. */
  private demoted = false;
  private average = 16;
  private watched = 0;
  readonly reducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  /** How hard the view shakes on heavy blows, 0 to 1: some like it, some do not (the settings, kept on this device). */
  shake = ((): number => {
    try {
      const value = Number(localStorage.getItem('pd-shake'));
      return localStorage.getItem('pd-shake') !== null && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0.6;
    } catch {
      return 0.6;
    }
  })();

  setShake(level: number): void {
    this.shake = level;
    try {
      localStorage.setItem('pd-shake', String(level));
    } catch {
      // For this session only.
    }
  }

  get light(): boolean {
    return this.mode === 'light' || (this.mode === 'auto' && this.demoted);
  }

  /** Fewer particles and a gentler picture: the light mode, and reduced motion (the system setting) too. */
  get lean(): boolean {
    return this.light || this.reducedMotion;
  }

  setMode(mode: FxMode): void {
    this.mode = mode;
    try {
      localStorage.setItem(KEY, mode);
    } catch {
      // Kept for this session only.
    }
  }

  /**
   * Notes a frame's length; true when «auto» has just turned light. Long
   * gaps (a hidden tab, a window open) are not counted.
   */
  frame(dt: number): boolean {
    if (this.mode !== 'auto' || this.demoted || dt <= 0 || dt > 250) return false;
    this.average += (dt - this.average) * 0.05;
    this.watched += dt;
    if (this.watched < SETTLE_MS || this.average < SLOW_FRAME_MS) return false;
    this.demoted = true;
    return true;
  }
}

export const quality = new Quality();
