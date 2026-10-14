/*
 * The map camera and everything a player does to it: look around, zoom, the whole level, come back to the hero.
 * No DOM and no clock of its own: pointers come in with their timestamps, frames come in with the time since the last one,
 * so the whole thing runs under a virtual clock in tests (test/camcontrol.test.ts).
 *
 * The model: the camera looks at `hero + pan`. `pan` is the player's own offset, in world pixels, and it is KEPT while the hero
 * walks (looking ahead along the way). Nothing moves it but the player and five explicit things, all eased and never instant:
 *
 *   - the «centre» button, a double tap on the hero, a floor change, death, the key C/Space-hold: `recentre()`;
 *   - the hero acting (their cell changed) with the view panned so far that they would stand off the visible area, or within
 *     a tile of its edge: `nudge`, which moves just enough to bring them back, never to the middle;
 *   - the danger badge: `lookAt()`;
 *   - Shift + arrow keys: `keyPan()`;
 *   - the fling a released drag leaves (about 300 ms).
 *
 * A new enemy, the edge of the screen and the passing of time move nothing; while a finger is down nothing automatic runs.
 *
 * The «whole level» view is a blend (`overview`, 0..1) between the hero-following view and a view that fits the explored map in the
 * screen; it stays until dismissed (the button again, or a tap on the map: which walks, and goes back to the normal zoom).
 */

export interface Pt {
  x: number;
  y: number;
}

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** The canvas and the free band the HUD and the toolbar leave (device pixels). */
export interface CamViewport {
  width: number;
  height: number;
  /** Where the hero rests: the middle of the free band. */
  middle: number;
  bandTop: number;
  bandBottom: number;
  /** Device pixels to a CSS pixel (the touch slop and the fling's speeds are in CSS pixels). */
  px: number;
}

export interface CamInput {
  /** Where the hero is drawn now, world pixels (centre of the sprite's cell): it moves smoothly as they walk. */
  hero: Pt;
  /** Where the hero is as far as the game goes (the centre of their cell): a change is an action. */
  cell: Pt;
  /** The floor (and run): another one is a cut to the hero and an eased return of the offset. */
  floor: string | number;
  /** Where the level lies (the non-wall extent), world pixels. */
  bounds: Box;
  viewport: CamViewport;
}

export interface CamState {
  /** The world pixel at the canvas's top-left corner, and the zoom. */
  x: number;
  y: number;
  zoom: number;
  /** Something is moving: the picture has to be drawn at full pace (pace.ts). */
  moving: boolean;
}

export interface CamOptions {
  tile?: number;
  reducedMotion?: () => boolean;
  /** The player chose a zoom level (a step, the wheel, a pinch let go): to be remembered. */
  onZoomStep?: (level: number, changed: boolean) => void;
}

/** What a finger lifted without having travelled or pinched was: a tap at this point (device pixels). */
export interface Tap {
  x: number;
  y: number;
}

/** A drag starts after the finger has moved this far (CSS pixels). */
export const DRAG_SLOP = 9;
/** An automatic move takes this long (ms), easing out. */
export const EASE_MS = 240;
/** The view sent to look at something takes this long. */
export const LOOK_MS = 300;
/** A key's pan step. */
export const KEY_MS = 200;
/** A fling's speed falls by e in this long: it is over in about 300 ms. */
export const FLING_TAU_MS = 90;
/** The zoom glides to its level: the time to close two thirds of the gap. */
export const ZOOM_TAU_MS = 70;
/** The whole-level view comes and goes in about this long. */
export const OVERVIEW_TAU_MS = 80;
/** A second tap on the hero within this long of the first is a double tap. */
export const DOUBLE_TAP_MS = 350;
/** The camera trails the hero a little: the time to close two thirds of the gap, and the same for a long way. */
export const FOLLOW_LAG_MS = 60;
export const FOLLOW_CATCH_UP_MS = 45;
/** The view is «away» from the hero when panned further than this many tiles. */
export const AWAY_TILES = 1.5;
/** The hero keeps this many tiles from the edge of the visible area once they have acted. */
export const EDGE_TILES = 1;

const easeOut = (p: number): number => 1 - (1 - p) ** 3;
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

type Gesture =
  | { kind: 'tap'; id: number; seq: number; x: number; y: number; panX: number; panY: number; swallow: boolean }
  | { kind: 'pan'; id: number; x: number; y: number; panX: number; panY: number }
  | { kind: 'pinch'; dist: number; zoom: number; world: Pt; mid: Pt }
  | { kind: 'done' };

interface Tween {
  kind: 'recentre' | 'nudge' | 'look' | 'key';
  from: Pt;
  to: Pt;
  ms: number;
  elapsed: number;
}

/** The bounds of the cells that are set in `cells` (a row-major grid `width` cells wide), world pixels; null if none is. */
export function boxOf(cells: ArrayLike<boolean | number>, width: number, tile: number): Box | null {
  let left = Infinity;
  let right = -Infinity;
  let top = Infinity;
  let bottom = -Infinity;
  for (let i = 0; i < cells.length; i++) {
    if (!cells[i]) continue;
    const x = i % width;
    const y = Math.trunc(i / width);
    if (x < left) left = x;
    if (x > right) right = x;
    if (y < top) top = y;
    if (y > bottom) bottom = y;
  }
  return right < left ? null : { left: left * tile, top: top * tile, right: (right + 1) * tile, bottom: (bottom + 1) * tile };
}

export class CamControl {
  /** The player's offset from the hero, world pixels. */
  readonly pan: Pt = { x: 0, y: 0 };
  /** The zoom of the hero-following view (it glides to `target`); the one drawn is in `state`. */
  zoom = 2;
  /** Zoom levels (device pixels per art pixel), whole numbers. */
  min = 1;
  max = 4;
  base = 2;

  private target = 2;
  private anchor: Pt | null = null;
  private readonly tile: number;
  private readonly reduced: () => boolean;
  private readonly onZoomStep: (level: number, changed: boolean) => void;

  private input: CamInput | null = null;
  private floor: string | number | null = null;
  private cellX = NaN;
  private cellY = NaN;
  private pendingNudge = false;
  /** The hero as the camera has them: eased after the sprite. */
  private readonly follow: Pt = { x: 0, y: 0 };
  private tween: Tween | null = null;
  private fling: Pt | null = null;
  private heroTapAt = -Infinity;

  /** The whole-level view: wanted (0/1) and how far it has come (0..1). */
  private overviewWanted = 0;
  private overviewAmount = 0;
  private overviewBox: Box | null = null;
  private overviewZoom = 1;

  private readonly fingers = new Map<number, Pt>();
  private gesture: Gesture | null = null;
  private seq = 0;
  private samples: Array<{ x: number; y: number; t: number }> = [];
  private shown: CamState = { x: 0, y: 0, zoom: 2, moving: false };

  constructor(options: CamOptions = {}) {
    this.tile = options.tile ?? 16;
    this.reduced = options.reducedMotion ?? (() => false);
    this.onZoomStep = options.onZoomStep ?? (() => undefined);
  }

  /** The zoom range of this screen, and the level the player has chosen (`base + delta`). */
  configure(range: { min: number; max: number; base: number; delta: number }): void {
    this.min = range.min;
    this.max = range.max;
    this.base = range.base;
    this.target = this.level(range.base + range.delta);
    this.zoom = this.target;
    this.anchor = null;
  }

  private level(z: number): number {
    return clamp(Math.round(z), this.min, this.max);
  }

  /** The zoom level wanted (a whole number). */
  get zoomLevel(): number {
    return this.target;
  }

  get canZoomIn(): boolean {
    return this.target < this.max;
  }

  get canZoomOut(): boolean {
    return this.target > this.min;
  }

  /** What is drawn: the top-left corner and the zoom, as of the last frame. */
  get state(): CamState {
    return this.shown;
  }

  /** The whole-level view is on (or on its way). */
  get overview(): boolean {
    return this.overviewWanted === 1;
  }

  /** How much of the whole-level view is showing (0..1), for the map to draw its markers. */
  get overviewShown(): number {
    return this.overviewAmount;
  }

  /** The view is panned away from the hero, so that «centre» is worth showing. */
  get away(): boolean {
    if (this.overviewWanted === 1 || this.tween?.kind === 'recentre') return false;
    return Math.hypot(this.pan.x, this.pan.y) > AWAY_TILES * this.tile;
  }

  /** A finger is looking around (dragging or pinching), or a fling is coasting. */
  get looking(): boolean {
    return this.gesture?.kind === 'pan' || this.gesture?.kind === 'pinch' || this.fling !== null;
  }

  /** A finger is on the map, whatever it is doing. */
  get touching(): boolean {
    return this.gesture !== null;
  }

  /** The number of the touch that is still just a tap (0 if it is not one): a long press asks whether it is still the same. */
  get tapping(): number {
    return this.gesture?.kind === 'tap' ? this.gesture.seq : 0;
  }

  /** The touch has been used for something else (a long press): lifting it taps nothing. */
  spend(): void {
    if (this.gesture?.kind === 'tap') this.gesture = { kind: 'done' };
  }

  /* ---- Fingers ---- */

  /** A pointer came down on the map. `button`: 0 is the touch or the left button, 1 the middle button (it pans at once), 2 is ignored. */
  pointerDown(id: number, x: number, y: number, t: number, button = 0): void {
    if (button === 2 || (button !== 0 && button !== 1)) return;
    this.fingers.set(id, { x, y });
    if (this.fingers.size === 1) {
      const speed = this.fling ? Math.hypot(this.fling.x, this.fling.y) * this.zoom : 0;
      const px = this.input?.viewport.px ?? 1;
      // A finger on the map takes the view back from whatever was moving it.
      if (this.tween?.kind === 'nudge') this.pendingNudge = true;
      this.tween = null;
      this.fling = null;
      this.samples = [{ x, y, t }];
      this.gesture = button === 1
        ? { kind: 'pan', id, x, y, panX: this.pan.x, panY: this.pan.y }
        // A finger that stops a coasting view is not tapping anything.
        : { kind: 'tap', id, seq: ++this.seq, x, y, panX: this.pan.x, panY: this.pan.y, swallow: speed > 0.3 * px };
    } else if (this.fingers.size === 2) {
      const input = this.input;
      if (!input || this.overviewWanted === 1) {
        this.gesture = { kind: 'done' };
        return;
      }
      const [a, b] = [...this.fingers.values()];
      const mid = { x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 };
      this.tween = null;
      this.fling = null;
      this.gesture = { kind: 'pinch', dist: Math.hypot(a!.x - b!.x, a!.y - b!.y) || 1, zoom: this.zoom, world: this.worldAt(mid), mid };
    }
  }

  pointerMove(id: number, x: number, y: number, t: number): void {
    if (!this.fingers.has(id)) return;
    this.fingers.set(id, { x, y });
    const g = this.gesture;
    if (!g) return;
    if (g.kind === 'tap' || g.kind === 'pan') {
      if (g.id !== id) return;
      this.samples.push({ x, y, t });
      while (this.samples.length > 2 && t - this.samples[0]!.t > 120) this.samples.shift();
      let pan = g;
      if (g.kind === 'tap') {
        const slop = DRAG_SLOP * (this.input?.viewport.px ?? 1);
        if (Math.hypot(x - g.x, y - g.y) <= slop) return;
        // A finger that travels is looking around, not tapping. The whole-level view fits the map: there is nothing to look at.
        if (this.overviewWanted === 1) {
          this.gesture = { kind: 'done' };
          return;
        }
        pan = { kind: 'pan', id: g.id, x: g.x, y: g.y, panX: g.panX, panY: g.panY };
        this.gesture = pan;
      }
      if (this.overviewWanted === 1) return;
      // The map moves with the finger, one to one.
      this.pan.x = pan.panX - (x - pan.x) / this.zoom;
      this.pan.y = pan.panY - (y - pan.y) / this.zoom;
      this.clampPan();
    } else if (g.kind === 'pinch' && this.fingers.size >= 2 && this.input) {
      const [a, b] = [...this.fingers.values()];
      const dist = Math.hypot(a!.x - b!.x, a!.y - b!.y) || 1;
      const mid = { x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 };
      // The zoom follows the fingers, a little past the ends, and the world under the midpoint goes where the midpoint goes.
      const z = clamp(g.zoom * (dist / g.dist), this.min - 0.6, this.max + 0.6);
      this.zoom = z;
      this.target = z;
      const c = this.centre();
      this.pan.x = g.world.x - (mid.x - c.x) / z - this.follow.x;
      this.pan.y = g.world.y - (mid.y - c.y) / z - this.follow.y;
      g.mid = mid;
      this.clampPan();
    }
  }

  /** The pointer went up: the tap it was, if it was one (not after a drag, a pinch, a long press or a stopped fling). */
  pointerUp(id: number, x: number, y: number, t: number): Tap | null {
    if (!this.fingers.has(id)) return null;
    this.fingers.set(id, { x, y });
    return this.release(id, t, true);
  }

  pointerCancel(id: number): void {
    if (this.fingers.has(id)) this.release(id, 0, false);
  }

  private release(id: number, t: number, ended: boolean): Tap | null {
    const at = this.fingers.get(id)!;
    this.fingers.delete(id);
    const g = this.gesture;
    if (g?.kind === 'pinch') {
      // Let go: the view settles on the nearest whole zoom, round the point between the fingers.
      this.setTarget(this.level(this.zoom), g.mid);
      this.gesture = this.fingers.size > 0 ? { kind: 'done' } : null;
      return null;
    }
    if (this.fingers.size > 0) return null;
    this.gesture = null;
    if (g?.kind === 'tap') return ended && !g.swallow ? { x: at.x, y: at.y } : null;
    if (g?.kind === 'pan' && ended) this.startFling(t);
    return null;
  }

  /** A drag let go while moving carries on and slows down. */
  private startFling(t: number): void {
    const px = this.input?.viewport.px ?? 1;
    const last = this.samples[this.samples.length - 1];
    if (!last || t - last.t > 70) return;
    const first = this.samples.find((s) => last.t - s.t <= 100) ?? last;
    const span = last.t - first.t;
    if (span < 8) return;
    // Device pixels a millisecond, capped; the view moves the other way round, in world pixels.
    const cap = 6 * px;
    const vx = clamp((last.x - first.x) / span, -cap, cap);
    const vy = clamp((last.y - first.y) / span, -cap, cap);
    if (Math.hypot(vx, vy) < 0.25 * px) return;
    this.fling = { x: -vx / this.zoom, y: -vy / this.zoom };
  }

  /* ---- Zoom ---- */

  private setTarget(level: number, anchor: Pt | null): void {
    const next = this.level(level);
    const changed = next !== Math.round(this.target);
    this.target = next;
    this.anchor = anchor;
    this.onZoomStep(next, changed);
  }

  /** One step of zoom (the buttons, the keys, the wheel): round `anchor` (device pixels), or the middle of the view. */
  zoomStep(dir: 1 | -1, anchor: Pt | null): void {
    if (this.overviewWanted === 1) this.exitOverview(false);
    this.setTarget(Math.round(this.target) + dir, anchor);
  }

  /** The zoom changes keeping the world point under `anchor` where it is on the screen: the offset makes up the difference. */
  private applyZoom(z: number, anchor: Pt): void {
    const c = this.centre();
    this.pan.x += (anchor.x - c.x) * (1 / this.zoom - 1 / z);
    this.pan.y += (anchor.y - c.y) * (1 / this.zoom - 1 / z);
    this.zoom = z;
  }

  /* ---- Automatic moves ---- */

  private ease(kind: Tween['kind'], to: Pt, ms: number): void {
    if (this.reduced()) {
      this.pan.x = to.x;
      this.pan.y = to.y;
      this.tween = null;
      this.clampPan();
      return;
    }
    this.tween = { kind, from: { ...this.pan }, to, ms, elapsed: 0 };
  }

  /** Back to the hero, eased (the centre button, a double tap on the hero, a floor change, death, the key). */
  recentre(): void {
    if (this.overviewWanted === 1) this.exitOverview(true);
    this.fling = null;
    this.pendingNudge = false;
    if (this.pan.x === 0 && this.pan.y === 0) {
      this.tween = null;
      return;
    }
    this.ease('recentre', { x: 0, y: 0 }, EASE_MS);
  }

  /** A double tap on the hero: the first remembers, the second recentres. Returns whether it was the second. */
  heroTap(t: number): boolean {
    const again = t - this.heroTapAt >= 0 && t - this.heroTapAt < DOUBLE_TAP_MS;
    this.heroTapAt = again ? -Infinity : t;
    if (again) this.recentre();
    return again;
  }

  /** A tap on anything but the hero. */
  otherTap(): void {
    this.heroTapAt = -Infinity;
  }

  /** The view goes to look at a world point (the danger badge). */
  lookAt(point: Pt): void {
    const input = this.input;
    if (!input) return;
    if (this.overviewWanted === 1) this.exitOverview(false);
    this.fling = null;
    this.pendingNudge = false;
    this.ease('look', this.clampTo({ x: point.x - input.hero.x, y: point.y - input.hero.y }), LOOK_MS);
  }

  /** Shift + an arrow key: the view moves a quarter of the screen that way (more presses add up). */
  keyPan(dx: number, dy: number): void {
    const input = this.input;
    if (!input || this.overviewWanted === 1) return;
    const view = input.viewport;
    const base = this.tween?.kind === 'key' ? this.tween.to : this.pan;
    this.fling = null;
    this.pendingNudge = false;
    this.ease('key', this.clampTo({ x: base.x + (dx * view.width * 0.25) / this.zoom, y: base.y + (dy * (view.bandBottom - view.bandTop) * 0.25) / this.zoom }), KEY_MS);
  }

  /** The offset that keeps the hero at least a tile inside the visible area (the band the HUD leaves free), nearest to `pan`. */
  private safePan(pan: Pt): Pt {
    const input = this.input;
    if (!input) return pan;
    const v = input.viewport;
    const z = this.zoom;
    const m = EDGE_TILES * this.tile * z;
    // Where the hero stands on screen is the middle less the offset: it has to lie between the margins.
    const range = (lo: number, hi: number): [number, number] => (lo > hi ? [(lo + hi) / 2, (lo + hi) / 2] : [lo, hi]);
    const [loX, hiX] = range((v.width / 2 - (v.width - m)) / z, (v.width / 2 - m) / z);
    const [loY, hiY] = range((v.middle - (v.bandBottom - m)) / z, (v.middle - (v.bandTop + m)) / z);
    return { x: clamp(pan.x, loX, hiX), y: clamp(pan.y, loY, hiY) };
  }

  /* ---- The whole level ---- */

  /** The zoom at which the explored map fits the free band of the screen (it follows the screen as it changes). */
  private fit(input: CamInput): void {
    const v = input.viewport;
    const where = this.overviewBox ?? input.bounds;
    const slack = this.tile;
    const w = where.right - where.left + slack * 2;
    const h = where.bottom - where.top + slack * 2;
    const fit = Math.min((v.width * 0.96) / w, ((v.bandBottom - v.bandTop) * 0.96) / h);
    // Never closer than the normal view, never out of sight of the art.
    this.overviewZoom = clamp(fit, 0.3, Math.max(this.base, this.target));
  }

  /** Shows the whole explored level, fit to the screen; again takes it away. `box`: where the explored cells lie. */
  toggleOverview(box: Box | null): void {
    if (this.overviewWanted === 1) {
      this.exitOverview(false);
      return;
    }
    const input = this.input;
    if (!input) return;
    this.overviewBox = box ?? input.bounds;
    this.fit(input);
    this.overviewWanted = 1;
    this.tween = null;
    this.fling = null;
    if (this.reduced()) this.overviewAmount = 1;
  }

  /** Back to the normal view: where it was, or (`toHero`) at the hero. */
  exitOverview(toHero: boolean): void {
    if (this.overviewWanted === 0) return;
    this.overviewWanted = 0;
    if (this.reduced()) this.overviewAmount = 0;
    if (toHero && (this.pan.x !== 0 || this.pan.y !== 0)) this.ease('recentre', { x: 0, y: 0 }, EASE_MS);
  }

  /* ---- Frames ---- */

  /** The world point on screen at a device pixel, as the hero-following view has it. */
  private worldAt(p: Pt): Pt {
    const c = this.centre();
    return { x: this.follow.x + this.pan.x + (p.x - c.x) / this.zoom, y: this.follow.y + this.pan.y + (p.y - c.y) / this.zoom };
  }

  /** The screen point the camera looks at. */
  private centre(): Pt {
    const v = this.input?.viewport;
    return v ? { x: v.width / 2, y: v.middle } : { x: 0, y: 0 };
  }

  private clampTo(pan: Pt): Pt {
    const input = this.input;
    if (!input) return pan;
    const b = input.bounds;
    const t = this.tile;
    return {
      x: clamp(this.follow.x + pan.x, b.left - t, b.right + t) - this.follow.x,
      y: clamp(this.follow.y + pan.y, b.top - t, b.bottom + t) - this.follow.y,
    };
  }

  /** The point looked at stays within the level's extent: half a screen of nothing at most beyond its edge, never lost. */
  private clampPan(): void {
    const next = this.clampTo(this.pan);
    if (this.fling) {
      if (Math.abs(next.x - this.pan.x) > 1e-6) this.fling.x = 0;
      if (Math.abs(next.y - this.pan.y) > 1e-6) this.fling.y = 0;
    }
    this.pan.x = next.x;
    this.pan.y = next.y;
  }

  /**
   * One frame of `dt` ms. Moves what is moving and returns what to draw.
   */
  frame(dt: number, input: CamInput): CamState {
    dt = Math.max(0, Math.min(dt, 100));
    this.input = input;
    const cut = this.floor === null || this.floor !== input.floor;
    if (cut) {
      // A new floor (or run): the camera is cut to the hero; the offset it had comes back to them eased.
      const first = this.floor === null;
      this.floor = input.floor;
      this.follow.x = input.hero.x;
      this.follow.y = input.hero.y;
      this.fling = null;
      this.tween = null;
      this.pendingNudge = false;
      this.overviewWanted = 0;
      this.overviewAmount = 0;
      if (first) {
        this.pan.x = 0;
        this.pan.y = 0;
      } else if (this.pan.x !== 0 || this.pan.y !== 0) {
        this.ease('recentre', { x: 0, y: 0 }, EASE_MS);
      }
      this.cellX = input.cell.x;
      this.cellY = input.cell.y;
    } else if (input.cell.x !== this.cellX || input.cell.y !== this.cellY) {
      // The hero acted: the view is checked for the hero being in it (once nothing else has hold of the view).
      this.cellX = input.cell.x;
      this.cellY = input.cell.y;
      this.pendingNudge = true;
    }

    // The zoom glides to its level, round its anchor (the fingers, the cursor, or the middle of the view).
    const pinching = this.gesture?.kind === 'pinch';
    let zooming = false;
    if (!pinching && this.zoom !== this.target) {
      const z = this.reduced() || Math.abs(this.target - this.zoom) < 0.004
        ? this.target
        : this.zoom + (this.target - this.zoom) * (1 - Math.exp(-dt / ZOOM_TAU_MS));
      this.applyZoom(z, this.anchor ?? this.centre());
      if (z === this.target) this.anchor = null;
      zooming = z !== this.target;
    }

    // An eased move of the offset.
    let eased = false;
    if (this.tween) {
      const tw = this.tween;
      tw.elapsed += dt;
      const p = Math.min(1, tw.elapsed / tw.ms);
      const e = easeOut(p);
      this.pan.x = tw.from.x + (tw.to.x - tw.from.x) * e;
      this.pan.y = tw.from.y + (tw.to.y - tw.from.y) * e;
      eased = p < 1;
      if (!eased) this.tween = null;
    }

    // The coasting of a drag let go.
    if (this.fling && this.gesture === null) {
      const decay = Math.exp(-dt / FLING_TAU_MS);
      this.pan.x += this.fling.x * FLING_TAU_MS * (1 - decay);
      this.pan.y += this.fling.y * FLING_TAU_MS * (1 - decay);
      this.fling.x *= decay;
      this.fling.y *= decay;
      if (Math.hypot(this.fling.x, this.fling.y) * this.zoom < 0.02 * input.viewport.px) this.fling = null;
    }

    // The hero has acted and nobody is looking: if they would stand off the visible area, or within a tile of its edge, the
    // view moves just far enough to bring them in.
    if (this.pendingNudge && this.gesture === null && this.fling === null && this.overviewWanted === 0 && this.overviewAmount === 0) {
      this.pendingNudge = false;
      if (this.tween?.kind !== 'recentre') {
        const wanted = this.safePan(this.tween?.kind === 'look' || this.tween?.kind === 'key' ? this.tween.to : this.pan);
        const from = this.tween?.kind === 'look' || this.tween?.kind === 'key' ? this.tween.to : this.pan;
        if (Math.abs(wanted.x - from.x) > 0.01 || Math.abs(wanted.y - from.y) > 0.01) {
          this.ease('nudge', this.clampTo(wanted), EASE_MS);
          eased = this.tween !== null;
        }
      }
    }

    // The camera trails the hero a little, so a walk starts and stops with some weight; far from them it catches up quicker.
    if (!cut) {
      const far = Math.hypot(input.hero.x - this.follow.x, input.hero.y - this.follow.y) > this.tile * 4;
      const give = 1 - Math.exp(-dt / (far ? FOLLOW_CATCH_UP_MS : FOLLOW_LAG_MS));
      this.follow.x += (input.hero.x - this.follow.x) * give;
      this.follow.y += (input.hero.y - this.follow.y) * give;
    }
    const lagging = Math.hypot(input.hero.x - this.follow.x, input.hero.y - this.follow.y) * this.zoom > 0.25;
    this.clampPan();

    // The whole-level view comes in and goes out, eased.
    let blending = false;
    if (this.overviewAmount !== this.overviewWanted) {
      const give = 1 - Math.exp(-dt / OVERVIEW_TAU_MS);
      this.overviewAmount += (this.overviewWanted - this.overviewAmount) * give;
      if (this.reduced() || Math.abs(this.overviewWanted - this.overviewAmount) < 0.002) this.overviewAmount = this.overviewWanted;
      blending = this.overviewAmount !== this.overviewWanted;
    }

    if (this.overviewAmount > 0) this.fit(input);
    const c = this.centre();
    let lx = this.follow.x + this.pan.x;
    let ly = this.follow.y + this.pan.y;
    let z = this.zoom;
    const e = this.overviewAmount;
    if (e > 0 && this.overviewBox) {
      const box = this.overviewBox;
      lx += ((box.left + box.right) / 2 - lx) * e;
      ly += ((box.top + box.bottom) / 2 - ly) * e;
      z = this.zoom * (this.overviewZoom / this.zoom) ** e;
    }
    this.shown = {
      x: lx - c.x / z,
      y: ly - c.y / z,
      zoom: z,
      moving: eased || zooming || blending || lagging || this.fling !== null || (this.gesture !== null && this.gesture.kind !== 'done')
        || this.pendingNudge,
    };
    return this.shown;
  }
}
