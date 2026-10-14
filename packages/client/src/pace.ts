/*
 * How often the map is drawn. The game's rules and its animation clocks run on every frame, but the picture only has to be
 * redrawn that often while something on screen moves: a walk, a blow, a gesture, the camera settling. Standing still, what is
 * left is the world's own slow life (water, mist, torches, a breathing hero), which needs a handful of frames a second, not
 * sixty: the canvas is then drawn every CALM_MS, and when the player has been away for a while, every AWAY_MS. A frame not
 * drawn leaves the last picture on screen: no canvas work, nothing for the compositor to upload, a phone that stays cooler.
 *
 * The pace only decides when; every source of motion that is not ambient says so itself (input, effects, `busy`), and
 * a missed one costs smoothness, not correctness.
 */

/** Gap between drawn frames while the picture only breathes (about 22 a second). */
export const CALM_MS = 45;
/** The same on a phone «auto» found too slow for full effects (quality.ts): fewer frames to draw (15 a second). */
export const LIGHT_MS = 66;
/** The same once nobody has touched the game for AWAY_AFTER_MS (about 11 a second). */
export const AWAY_MS = 90;
export const AWAY_AFTER_MS = 20_000;
/** A touch, a key or a wheel keeps the map at full pace this long (the tap's reticle, the path dots going out). */
export const INPUT_MS = 800;
/** Effects (blows, bursts, floating numbers, light on the walls) are done within this long of the last one. */
export const EFFECT_MS = 2500;

/**
 * «Максимальная плавность» (settings): every frame the display gives is drawn, even standing still: 120 a second on a
 * 120 Hz screen. Off by default: it costs battery and warmth for water and torches no one needs that smooth.
 */
export const smooth = {
  on: (() => {
    try {
      return localStorage.getItem('pd-smooth') === 'on';
    } catch {
      return false;
    }
  })(),
  set(on: boolean): void {
    this.on = on;
    try {
      localStorage.setItem('pd-smooth', on ? 'on' : 'off');
    } catch {
      // This session only.
    }
  },
};

export class Pace {
  private drawn = -Infinity;
  private touched = -Infinity;
  private effected = -Infinity;
  private forced = true;
  /** Frames asked about and frames said to draw, for the dev console (__pd.pace). */
  asked = 0;
  drew = 0;

  /** The player did something (a touch, a key, a wheel). */
  touch(now: number): void {
    this.touched = now;
  }

  /** The world did something to look at (effects came out of the last turn). */
  effect(now: number): void {
    this.effected = now;
  }

  /** The next frame is drawn whatever the pace (a resized canvas, a new floor, coming back from out of sight). */
  force(): void {
    this.forced = true;
  }

  /** Whether the player is away: nothing touched and nothing happening for a good while. */
  away(now: number): boolean {
    return now - this.touched > AWAY_AFTER_MS && now - this.effected > AWAY_AFTER_MS;
  }

  /** Whether nothing moves and nobody is playing just now: what only has to follow slowly (the HUD) may. */
  isCalm(now: number, busy: boolean): boolean {
    return !busy && now - this.touched > INPUT_MS && now - this.effected > EFFECT_MS;
  }

  /** Whether this frame's picture is drawn. `busy`: something that moves is on screen (the caller knows what). */
  due(now: number, busy: boolean, light = false): boolean {
    this.asked++;
    // The game starts with the player present: the first frame is the start of the wait for a touch.
    if (this.touched === -Infinity) this.touched = this.effected = now;
    const calm = this.isCalm(now, busy);
    // A clock that went backwards (a hidden tab, a virtual clock in tests) never starves the screen.
    const since = now - this.drawn;
    const gap = smooth.on ? 0 : calm ? (this.away(now) ? AWAY_MS : light ? LIGHT_MS : CALM_MS) : 0;
    if (!this.forced && since >= 0 && since < gap) return false;
    this.forced = false;
    this.drawn = now;
    this.drew++;
    return true;
  }
}
