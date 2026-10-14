import { describe, expect, it } from 'vitest';
import { boxOf, CamControl, type CamInput, type CamState, type Pt } from '../src/camcontrol';

/*
 * The map camera under a virtual clock and synthetic pointers: a phone 375 x 812 CSS pixels at two device pixels each, the
 * hero in the middle of a 64 x 64 grid whose level lies in the middle 40 x 40, zoom 2.
 */

const TILE = 16;
const FRAME = 16;

class Rig {
  cam: CamControl;
  t = 1000;
  zooms: number[] = [];
  hero: Pt = { x: 32 * TILE + 8, y: 32 * TILE + 8 };
  cell: Pt = { ...this.hero };
  floor: string | number = 1;
  bounds = { left: 12 * TILE, top: 12 * TILE, right: 52 * TILE, bottom: 52 * TILE };
  viewport = { width: 750, height: 1624, middle: 700, bandTop: 120, bandBottom: 1300, px: 2 };
  reduced = false;

  constructor() {
    this.cam = new CamControl({ tile: TILE, reducedMotion: () => this.reduced, onZoomStep: (level) => this.zooms.push(level) });
    this.cam.configure({ min: 1, max: 4, base: 2, delta: 0 });
    this.run(32);
  }

  input(): CamInput {
    return { hero: this.hero, cell: this.cell, floor: this.floor, bounds: this.bounds, viewport: this.viewport };
  }

  /** Runs frames for `ms` of virtual time. */
  run(ms: number): CamState {
    let state = this.cam.state;
    for (let spent = 0; spent < ms; spent += FRAME) {
      this.t += FRAME;
      state = this.cam.frame(FRAME, this.input());
    }
    return state;
  }

  /** The hero walks to a new cell: the sprite glides over `ms`, the cell changes at once. */
  step(dx: number, dy: number, ms = 100): void {
    this.cell = { x: this.cell.x + dx * TILE, y: this.cell.y + dy * TILE };
    const from = { ...this.hero };
    for (let spent = 0; spent < ms; spent += FRAME) {
      const k = Math.min(1, (spent + FRAME) / ms);
      this.hero = { x: from.x + (this.cell.x - from.x) * k, y: from.y + (this.cell.y - from.y) * k };
      this.run(FRAME);
    }
    this.hero = { ...this.cell };
  }

  /** A finger from `a` to `b` in `ms` (device pixels), lifted at the end unless `hold`. Returns the tap, if it was one. */
  drag(a: Pt, b: Pt, ms: number, id = 1, hold = false): ReturnType<CamControl['pointerUp']> {
    this.cam.pointerDown(id, a.x, a.y, this.t);
    const steps = Math.max(1, Math.round(ms / FRAME));
    for (let i = 1; i <= steps; i++) {
      this.t += FRAME;
      this.cam.pointerMove(id, a.x + ((b.x - a.x) * i) / steps, a.y + ((b.y - a.y) * i) / steps, this.t);
      this.cam.frame(FRAME, this.input());
    }
    return hold ? null : this.cam.pointerUp(id, b.x, b.y, this.t);
  }

  tap(at: Pt): ReturnType<CamControl['pointerUp']> {
    this.cam.pointerDown(9, at.x, at.y, this.t);
    this.t += 60;
    return this.cam.pointerUp(9, at.x, at.y, this.t);
  }

  /** Where the hero is on the screen, device pixels. */
  heroOnScreen(): Pt {
    const s = this.cam.state;
    return { x: (this.hero.x - s.x) * s.zoom, y: (this.hero.y - s.y) * s.zoom };
  }

  /** Where a world point is on the screen. */
  onScreen(p: Pt): Pt {
    const s = this.cam.state;
    return { x: (p.x - s.x) * s.zoom, y: (p.y - s.y) * s.zoom };
  }

  /** The world point under a screen point. */
  under(p: Pt): Pt {
    const s = this.cam.state;
    return { x: s.x + p.x / s.zoom, y: s.y + p.y / s.zoom };
  }

  /** Pans the view by a slow drag (no fling): the offset ends up as asked, in world pixels. */
  panBy(x: number, y: number): void {
    const z = this.cam.zoom;
    this.drag({ x: 400, y: 700 }, { x: 400 - x * z, y: 700 - y * z }, 320, 1, true);
    this.t += 200;
    this.cam.pointerUp(1, 400 - x * z, 700 - y * z, this.t);
    this.run(500);
  }
}

describe('looking around', () => {
  it('sits on the hero at first, in the middle of the free band', () => {
    const rig = new Rig();
    const at = rig.heroOnScreen();
    expect(at.x).toBeCloseTo(375, 0);
    expect(at.y).toBeCloseTo(700, 0);
    expect(rig.cam.away).toBe(false);
  });

  it('moves the map one to one under the finger', () => {
    const rig = new Rig();
    const grabbed = rig.under({ x: 300, y: 800 });
    rig.drag({ x: 300, y: 800 }, { x: 180, y: 640 }, 320, 1, true);
    const now = rig.onScreen(grabbed);
    expect(now.x).toBeCloseTo(180, 0);
    expect(now.y).toBeCloseTo(640, 0);
    expect(rig.cam.pan.x).toBeCloseTo(60, 0);
    expect(rig.cam.pan.y).toBeCloseTo(80, 0);
  });

  it('keeps the offset after the finger lifts, and coasts a while on a fling', () => {
    const rig = new Rig();
    // A quick swipe: 300 device pixels in 100 ms.
    rig.drag({ x: 600, y: 700 }, { x: 300, y: 700 }, 100);
    const released = rig.cam.pan.x;
    expect(released).toBeCloseTo(150, 0);
    rig.run(48);
    const early = rig.cam.pan.x;
    expect(early).toBeGreaterThan(released + 1);
    // Done within about 300 ms, and the view stays where it came to rest: it does not drift back.
    rig.run(600);
    const rest = rig.cam.pan.x;
    expect(rest).toBeGreaterThan(early);
    expect(rig.cam.state.moving).toBe(false);
    rig.run(3000);
    expect(rig.cam.pan.x).toBeCloseTo(rest, 3);
    expect(rig.cam.away).toBe(true);
  });

  it('does not coast when the finger stopped before it lifted', () => {
    const rig = new Rig();
    rig.drag({ x: 600, y: 700 }, { x: 300, y: 700 }, 100, 1, true);
    rig.t += 200;
    rig.cam.pointerUp(1, 300, 700, rig.t);
    const rest = rig.cam.pan.x;
    rig.run(500);
    expect(rig.cam.pan.x).toBeCloseTo(rest, 3);
  });

  it('settles a fling within about 300 ms', () => {
    const rig = new Rig();
    rig.drag({ x: 600, y: 700 }, { x: 400, y: 700 }, 80);
    rig.run(160);
    const at160 = rig.cam.pan.x;
    rig.run(300);
    const at460 = rig.cam.pan.x;
    rig.run(300);
    // After ~460 ms what is left is a few pixels at most.
    expect(Math.abs(rig.cam.pan.x - at460)).toBeLessThan(1);
    expect(at460 - at160).toBeGreaterThan(0);
  });

  it('does nothing by itself while the player looks: not the edge of the screen, not time', () => {
    const rig = new Rig();
    // A long way off, the hero out of the picture altogether.
    rig.panBy(320, 0);
    const left = rig.cam.pan.x;
    expect(rig.heroOnScreen().x).toBeLessThan(0);
    rig.run(5000);
    expect(rig.cam.pan.x).toBeCloseTo(left, 6);
    expect(rig.heroOnScreen().x).toBeLessThan(0);
  });
});

describe('taps and drags', () => {
  it('a touch that stays within the slop is a tap', () => {
    const rig = new Rig();
    // 9 CSS pixels is 18 device pixels here.
    const tap = rig.drag({ x: 300, y: 800 }, { x: 310, y: 806 }, 64);
    expect(tap).toEqual({ x: 310, y: 806 });
    expect(rig.cam.pan.x).toBe(0);
  });

  it('a drag past the slop never taps, and a tap after it works as usual', () => {
    const rig = new Rig();
    expect(rig.drag({ x: 300, y: 800 }, { x: 330, y: 800 }, 64)).toBeNull();
    expect(rig.cam.pan.x).not.toBe(0);
    rig.run(1000);
    expect(rig.tap({ x: 100, y: 500 })).toEqual({ x: 100, y: 500 });
  });

  it('a finger that stops a coasting view taps nothing', () => {
    const rig = new Rig();
    rig.drag({ x: 650, y: 700 }, { x: 250, y: 700 }, 90);
    rig.run(32);
    expect(rig.tap({ x: 300, y: 700 })).toBeNull();
    // Once it has settled, a tap is a tap again.
    rig.run(800);
    expect(rig.tap({ x: 300, y: 700 })).toEqual({ x: 300, y: 700 });
  });

  it('a long press can claim the touch', () => {
    const rig = new Rig();
    rig.cam.pointerDown(3, 300, 700, rig.t);
    const mine = rig.cam.tapping;
    expect(mine).toBeGreaterThan(0);
    rig.cam.spend();
    expect(rig.cam.tapping).toBe(0);
    expect(rig.cam.pointerUp(3, 300, 700, rig.t + 600)).toBeNull();
  });

  it('the right button is left alone, the middle button pans at once and never taps', () => {
    const rig = new Rig();
    rig.cam.pointerDown(4, 300, 700, rig.t, 2);
    expect(rig.cam.touching).toBe(false);
    expect(rig.cam.pointerUp(4, 300, 700, rig.t + 50)).toBeNull();
    rig.cam.pointerDown(5, 300, 700, rig.t, 1);
    rig.t += 16;
    rig.cam.pointerMove(5, 296, 700, rig.t);
    expect(rig.cam.pan.x).toBeCloseTo(2, 3);
    expect(rig.cam.pointerUp(5, 296, 700, rig.t + 400)).toBeNull();
  });
});

describe('the hero acts after a pan', () => {
  it('keeps the offset over five steps', () => {
    const rig = new Rig();
    rig.panBy(48, -32);
    const kept = { ...rig.cam.pan };
    expect(kept.x).toBeCloseTo(48, 0);
    const before = rig.heroOnScreen();
    for (let i = 0; i < 5; i++) rig.step(1, 0);
    rig.run(600);
    expect(rig.cam.pan.x).toBeCloseTo(kept.x, 3);
    expect(rig.cam.pan.y).toBeCloseTo(kept.y, 3);
    // The hero is at the same place on the screen as before: the view went along with them, the look-ahead intact.
    const after = rig.heroOnScreen();
    expect(after.x).toBeCloseTo(before.x, 0);
    expect(after.y).toBeCloseTo(before.y, 0);
  });

  it('a step that would leave the hero off the screen nudges the view just enough', () => {
    const rig = new Rig();
    // Panned so far that the hero is off the left edge of the picture.
    rig.panBy(260, 0);
    expect(rig.heroOnScreen().x).toBeLessThan(0);
    const before = rig.cam.pan.x;
    rig.step(0, 1);
    // Eased: not there at once.
    rig.run(32);
    expect(rig.cam.pan.x).toBeGreaterThan(before - 400);
    expect(rig.cam.state.moving).toBe(true);
    rig.run(600);
    const at = rig.heroOnScreen();
    // A tile (32 device pixels at zoom 2) in from the edge, and not a pixel more: nowhere near the middle.
    expect(at.x).toBeCloseTo(TILE * 2, 0);
    expect(at.x).toBeLessThan(100);
    expect(rig.cam.pan.x).toBeLessThan(before);
    // The vertical offset was fine and stays.
    expect(rig.cam.pan.y).toBeCloseTo(0, 3);
  });

  it('a hero within a tile of the edge is nudged in, and one further in is left alone', () => {
    const rig = new Rig();
    rig.panBy(-176, 0);
    const out = rig.heroOnScreen();
    expect(out.x).toBeGreaterThan(750 - TILE * 2);
    const before = rig.cam.pan.x;
    rig.step(1, 0);
    rig.run(600);
    expect(rig.heroOnScreen().x).toBeCloseTo(750 - TILE * 2, 0);
    expect(rig.cam.pan.x).toBeGreaterThan(before);

    const calm = new Rig();
    calm.panBy(-60, 0);
    const kept = calm.cam.pan.x;
    calm.step(1, 0);
    calm.run(600);
    expect(calm.cam.pan.x).toBeCloseTo(kept, 3);
  });

  it('waits for the finger: nothing moves while the player is dragging', () => {
    const rig = new Rig();
    rig.drag({ x: 400, y: 700 }, { x: 0, y: 700 }, 480, 1, true);
    const pan = rig.cam.pan.x;
    rig.step(0, 1);
    rig.run(500);
    expect(rig.cam.pan.x).toBeCloseTo(pan, 6);
  });

  it('keeps the hero in the band the HUD leaves free', () => {
    const rig = new Rig();
    rig.panBy(0, -320);
    expect(rig.heroOnScreen().y).toBeGreaterThan(1300);
    rig.step(0, 1);
    rig.run(600);
    expect(rig.heroOnScreen().y).toBeCloseTo(1300 - TILE * 2, 0);
  });
});

describe('an enemy appearing', () => {
  it('moves nothing: the camera has no way to hear of it, and a view left alone stays', () => {
    const rig = new Rig();
    rig.panBy(100, 40);
    const pan = { ...rig.cam.pan };
    const state = { ...rig.cam.state };
    // Frames go by, the hero stands still, monsters come into sight (the camera is not told).
    rig.run(3000);
    expect(rig.cam.pan.x).toBeCloseTo(pan.x, 6);
    expect(rig.cam.pan.y).toBeCloseTo(pan.y, 6);
    expect(rig.cam.state.x).toBeCloseTo(state.x, 6);
    expect(rig.cam.state.y).toBeCloseTo(state.y, 6);
  });

  it('the danger badge sends the view to the enemy, eased, and the view then stays', () => {
    const rig = new Rig();
    const foe = { x: rig.hero.x + 5 * TILE, y: rig.hero.y - 3 * TILE };
    rig.cam.lookAt(foe);
    rig.run(32);
    expect(rig.cam.pan.x).toBeGreaterThan(0);
    expect(rig.cam.pan.x).toBeLessThan(5 * TILE);
    rig.run(600);
    expect(rig.cam.pan.x).toBeCloseTo(5 * TILE, 3);
    expect(rig.cam.pan.y).toBeCloseTo(-3 * TILE, 3);
    rig.run(3000);
    expect(rig.cam.pan.x).toBeCloseTo(5 * TILE, 3);
  });
});

describe('coming back', () => {
  it('the centre button shows only when panned away, and eases back', () => {
    const rig = new Rig();
    expect(rig.cam.away).toBe(false);
    rig.panBy(10, 0);
    expect(rig.cam.away).toBe(false);
    rig.panBy(120, 0);
    expect(rig.cam.away).toBe(true);
    rig.cam.recentre();
    // The button has gone as the move begins, and the view is on its way, not there.
    expect(rig.cam.away).toBe(false);
    rig.run(64);
    expect(rig.cam.pan.x).toBeGreaterThan(5);
    expect(rig.cam.state.moving).toBe(true);
    rig.run(400);
    expect(rig.cam.pan.x).toBe(0);
    expect(rig.heroOnScreen().x).toBeCloseTo(375, 0);
  });

  it('a double tap on the hero recentres, a lone one does nothing, a tap elsewhere in between starts over', () => {
    const rig = new Rig();
    rig.panBy(160, 0);
    expect(rig.cam.heroTap(10_000)).toBe(false);
    expect(rig.cam.pan.x).toBeGreaterThan(100);
    rig.cam.otherTap();
    expect(rig.cam.heroTap(10_100)).toBe(false);
    expect(rig.cam.heroTap(10_300)).toBe(true);
    rig.run(500);
    expect(rig.cam.pan.x).toBe(0);
    // Slow taps are two single taps.
    rig.panBy(160, 0);
    expect(rig.cam.heroTap(20_000)).toBe(false);
    expect(rig.cam.heroTap(20_500)).toBe(false);
    expect(rig.cam.pan.x).toBeGreaterThan(100);
  });

  it('a new floor cuts to the hero and brings the offset back eased', () => {
    const rig = new Rig();
    rig.panBy(120, 0);
    rig.floor = 2;
    rig.run(16);
    expect(rig.cam.pan.x).toBeGreaterThan(0);
    expect(rig.cam.pan.x).toBeLessThan(120);
    rig.run(500);
    expect(rig.cam.pan.x).toBe(0);
    expect(rig.heroOnScreen().x).toBeCloseTo(375, 0);
  });

  it('a finger on the map takes the view back from a move under way', () => {
    const rig = new Rig();
    rig.panBy(160, 0);
    rig.cam.recentre();
    rig.run(64);
    const part = rig.cam.pan.x;
    rig.cam.pointerDown(2, 300, 700, rig.t);
    rig.run(500);
    expect(rig.cam.pan.x).toBeCloseTo(part, 6);
  });

  it('with reduced motion it is instant', () => {
    const rig = new Rig();
    rig.reduced = true;
    rig.panBy(160, 0);
    rig.cam.recentre();
    rig.run(16);
    expect(rig.cam.pan.x).toBe(0);
  });

  it('Shift + arrow keys pan by a quarter of the screen, eased, and add up', () => {
    const rig = new Rig();
    rig.cam.keyPan(1, 0);
    rig.run(32);
    expect(rig.cam.pan.x).toBeGreaterThan(0);
    expect(rig.cam.pan.x).toBeLessThan(750 * 0.25 / 2);
    rig.cam.keyPan(1, 0);
    rig.run(500);
    expect(rig.cam.pan.x).toBeCloseTo(750 * 0.5 / 2, 3);
  });
});

describe('the limits', () => {
  it('the level never leaves the screen: the look-at point stays inside it', () => {
    const rig = new Rig();
    rig.drag({ x: 700, y: 700 }, { x: -9000, y: 700 }, 400, 1, true);
    rig.cam.pointerUp(1, -9000, 700, rig.t + 400);
    rig.run(1000);
    const s = rig.cam.state;
    const lookX = s.x + 375 / s.zoom;
    expect(lookX).toBeLessThanOrEqual(rig.bounds.right + TILE + 1e-6);
    expect(lookX).toBeGreaterThan(rig.bounds.right - 2 * TILE);
    // And with half a screen beyond the edge to look at.
    expect(rig.onScreen({ x: rig.bounds.right, y: 600 }).x).toBeGreaterThan(300);
    rig.drag({ x: 0, y: 100 }, { x: 0, y: 6000 }, 400, 1, true);
    rig.cam.pointerUp(1, 0, 6000, rig.t + 400);
    rig.run(1000);
    expect(rig.under({ x: 375, y: 700 }).y).toBeGreaterThanOrEqual(rig.bounds.top - TILE - 1e-6);
  });

  it('a fling stops at the edge, not past it', () => {
    const rig = new Rig();
    rig.drag({ x: 700, y: 700 }, { x: 0, y: 700 }, 60);
    rig.run(1500);
    const s = rig.cam.state;
    expect(s.x + 375 / s.zoom).toBeLessThanOrEqual(rig.bounds.right + TILE + 1e-6);
  });
});

describe('zoom', () => {
  it('a pinch keeps the point between the fingers where it is, and settles on a whole zoom', () => {
    const rig = new Rig();
    rig.panBy(40, 20);
    const focal = { x: 300, y: 900 };
    const world = rig.under(focal);
    rig.cam.pointerDown(1, 250, 900, rig.t);
    rig.cam.pointerDown(2, 350, 900, rig.t);
    // The fingers spread to 1.6 times: a zoom of 3.2.
    for (let i = 1; i <= 10; i++) {
      rig.t += FRAME;
      const half = 50 + (30 * i) / 10;
      rig.cam.pointerMove(1, 300 - half, 900, rig.t);
      rig.cam.pointerMove(2, 300 + half, 900, rig.t);
      rig.cam.frame(FRAME, rig.input());
    }
    expect(rig.cam.state.zoom).toBeCloseTo(3.2, 1);
    expect(rig.onScreen(world).x).toBeCloseTo(focal.x, 0);
    expect(rig.onScreen(world).y).toBeCloseTo(focal.y, 0);
    rig.cam.pointerUp(1, 220, 900, rig.t);
    rig.cam.pointerUp(2, 380, 900, rig.t);
    rig.run(800);
    expect(rig.cam.state.zoom).toBe(3);
    expect(rig.zooms.at(-1)).toBe(3);
    expect(rig.onScreen(world).x).toBeCloseTo(focal.x, 0);
    expect(rig.onScreen(world).y).toBeCloseTo(focal.y, 0);
  });

  it('a pinch that is moved drags the map with the fingers', () => {
    const rig = new Rig();
    const world = rig.under({ x: 300, y: 900 });
    rig.cam.pointerDown(1, 250, 900, rig.t);
    rig.cam.pointerDown(2, 350, 900, rig.t);
    rig.t += FRAME;
    rig.cam.pointerMove(1, 150, 800, rig.t);
    rig.cam.pointerMove(2, 250, 800, rig.t);
    rig.cam.frame(FRAME, rig.input());
    expect(rig.onScreen(world).x).toBeCloseTo(200, 0);
    expect(rig.onScreen(world).y).toBeCloseTo(800, 0);
  });

  it('the buttons zoom round the middle of the view and keep the pan', () => {
    const rig = new Rig();
    rig.panBy(50, 10);
    const centre = rig.under({ x: 375, y: 700 });
    rig.cam.zoomStep(1, null);
    rig.run(1200);
    expect(rig.cam.state.zoom).toBe(3);
    const after = rig.under({ x: 375, y: 700 });
    expect(after.x).toBeCloseTo(centre.x, 1);
    expect(after.y).toBeCloseTo(centre.y, 1);
    expect(rig.cam.pan.x).toBeCloseTo(50, 1);
    expect(rig.cam.pan.y).toBeCloseTo(10, 1);
    // The hero is where they were, on screen: the offset in world pixels times the new zoom.
    expect(rig.heroOnScreen().x).toBeCloseTo(375 - 50 * 3, 0);
  });

  it('the wheel zooms round the cursor', () => {
    const rig = new Rig();
    const cursor = { x: 600, y: 400 };
    const world = rig.under(cursor);
    rig.cam.zoomStep(-1, cursor);
    rig.run(1200);
    expect(rig.cam.state.zoom).toBe(1);
    expect(rig.onScreen(world).x).toBeCloseTo(cursor.x, 0);
    expect(rig.onScreen(world).y).toBeCloseTo(cursor.y, 0);
    // The ends of the range stay the ends.
    rig.cam.zoomStep(-1, cursor);
    rig.run(500);
    expect(rig.cam.state.zoom).toBe(1);
    expect(rig.cam.canZoomOut).toBe(false);
    expect(rig.cam.canZoomIn).toBe(true);
  });

  it('with reduced motion the zoom is instant', () => {
    const rig = new Rig();
    rig.reduced = true;
    rig.cam.zoomStep(1, null);
    rig.run(16);
    expect(rig.cam.state.zoom).toBe(3);
  });
});

describe('the whole level', () => {
  const seen = { left: 20 * TILE, top: 18 * TILE, right: 45 * TILE, bottom: 50 * TILE };

  it('fits the explored map in the screen, and stays until it is dismissed', () => {
    const rig = new Rig();
    const box = seen;
    rig.panBy(60, 0);
    const pan = { ...rig.cam.pan };
    rig.cam.toggleOverview(box);
    expect(rig.cam.overview).toBe(true);
    rig.run(1500);
    expect(rig.cam.overviewShown).toBe(1);
    const s = rig.cam.state;
    // The whole box shows, inside the free band, with room to spare.
    const topLeft = rig.onScreen({ x: box.left, y: box.top });
    const bottomRight = rig.onScreen({ x: box.right, y: box.bottom });
    expect(topLeft.x).toBeGreaterThanOrEqual(0);
    expect(bottomRight.x).toBeLessThanOrEqual(750);
    expect(topLeft.y).toBeGreaterThanOrEqual(120);
    expect(bottomRight.y).toBeLessThanOrEqual(1300);
    expect(s.zoom).toBeLessThan(2);
    // The hero acts, time goes by, drags and pinches are tried: it stays.
    rig.step(1, 0);
    rig.step(0, 1);
    rig.drag({ x: 600, y: 700 }, { x: 100, y: 700 }, 100);
    rig.cam.pointerDown(1, 250, 900, rig.t);
    rig.cam.pointerDown(2, 350, 900, rig.t);
    rig.cam.pointerUp(1, 250, 900, rig.t + 50);
    rig.cam.pointerUp(2, 350, 900, rig.t + 50);
    rig.run(5000);
    expect(rig.cam.overview).toBe(true);
    expect(rig.cam.state.zoom).toBeCloseTo(s.zoom, 6);
    expect(rig.cam.state.x).toBeCloseTo(s.x, 6);
    expect(rig.cam.pan.x).toBeCloseTo(pan.x, 6);
    // The button again brings back the view as it was.
    rig.cam.toggleOverview(box);
    expect(rig.cam.overview).toBe(false);
    rig.run(1500);
    expect(rig.cam.overviewShown).toBe(0);
    expect(rig.cam.state.zoom).toBe(2);
  });

  it('a tap on the map in the overview comes back to the normal zoom, at the hero, smoothly', () => {
    const rig = new Rig();
    rig.panBy(100, 0);
    rig.cam.toggleOverview(seen);
    rig.run(1500);
    const tap = rig.tap({ x: 200, y: 500 });
    expect(tap).toEqual({ x: 200, y: 500 });
    // (main walks there) and leaves the overview.
    rig.cam.exitOverview(true);
    rig.run(48);
    expect(rig.cam.overviewShown).toBeGreaterThan(0);
    expect(rig.cam.overviewShown).toBeLessThan(1);
    expect(rig.cam.state.zoom).toBeGreaterThan(0.3);
    rig.run(1500);
    expect(rig.cam.state.zoom).toBe(2);
    expect(rig.cam.pan.x).toBe(0);
    expect(rig.heroOnScreen().x).toBeCloseTo(375, 0);
  });

  it('the zoom buttons leave it', () => {
    const rig = new Rig();
    rig.cam.toggleOverview(null);
    rig.run(1000);
    rig.cam.zoomStep(1, null);
    expect(rig.cam.overview).toBe(false);
    rig.run(1500);
    expect(rig.cam.state.zoom).toBe(3);
  });

  it('a new floor ends it', () => {
    const rig = new Rig();
    rig.cam.toggleOverview(null);
    rig.run(1000);
    rig.floor = 7;
    rig.run(16);
    expect(rig.cam.overview).toBe(false);
    expect(rig.cam.overviewShown).toBe(0);
  });

  it('finds the extent of the explored cells', () => {
    const cells = new Array<boolean>(64 * 64).fill(false);
    cells[10 + 12 * 64] = true;
    cells[30 + 40 * 64] = true;
    expect(boxOf(cells, 64, TILE)).toEqual({ left: 10 * TILE, top: 12 * TILE, right: 31 * TILE, bottom: 41 * TILE });
    expect(boxOf(new Array<boolean>(16).fill(false), 4, TILE)).toBeNull();
  });
});
