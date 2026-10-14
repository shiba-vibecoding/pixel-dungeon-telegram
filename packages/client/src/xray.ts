import { F, HEIGHT, type Level, terrainFlags, WIDTH } from '@pd/core';
import { quality } from './quality';

/*
 * The x-ray: Shattered's raised walls overhang the floor cell north of them (the upper layer, tiles.ts), so whoever stands
 * right behind a wall is cut off at the waist. What the upper layer covers of a character or an item is drawn again on top of
 * it as a silhouette (a soft outline and a translucent fill), and the hero also sees the wall cells over them fade a little.
 * Silhouettes are made once per sprite frame and tint; each frame costs a few small blits, and only for what stands under a wall.
 */

const TILE = 16;

/** What the silhouette is made of: its colour, for whose sprite it is. */
export type XrayTint = 'hero' | 'foe' | 'ally' | 'item';

/** [fill, outline] of each tint; the fill's alpha is the translucency, the outline's the edge's strength. */
const TINTS: Record<XrayTint, readonly [string, string]> = {
  // The hero's gold-white, the enemies' red (--danger), the allies' (--ally) and items' neutral grey-white.
  hero: ['rgba(255, 238, 170, 0.42)', 'rgba(255, 248, 215, 0.85)'],
  foe: ['rgba(255, 90, 70, 0.4)', 'rgba(255, 150, 130, 0.85)'],
  ally: ['rgba(94, 200, 192, 0.4)', 'rgba(170, 235, 228, 0.85)'],
  item: ['rgba(235, 235, 235, 0.38)', 'rgba(255, 255, 255, 0.8)'],
};

/** A wall cell fades to this much of its opacity while the hero is right behind it. */
export const FADED_ALPHA = 0.55;
const FADE_MS = 140;

/** A sprite as it was drawn: where, which frame, and which way round (world pixels). */
export interface Placed {
  image: CanvasImageSource;
  sx: number;
  sy: number;
  w: number;
  h: number;
  dx: number;
  dy: number;
  flip: boolean;
}

const ids = new WeakMap<object, number>();
let nextId = 1;
const idOf = (image: object): number => {
  let id = ids.get(image);
  if (id === undefined) ids.set(image, (id = nextId++));
  return id;
};

const made = new Map<string, HTMLCanvasElement>();

/** The sprite frame as a ring and a veil in one colour (1 pixel of margin all round), kept once made. */
function silhouette(p: Placed, tint: XrayTint): HTMLCanvasElement {
  const key = `${idOf(p.image as object)}|${p.sx}|${p.sy}|${p.w}|${p.h}|${tint}`;
  let canvas = made.get(key);
  if (canvas) return canvas;
  if (made.size > 400) made.clear();
  const [fill, edge] = TINTS[tint];
  canvas = document.createElement('canvas');
  canvas.width = p.w + 2;
  canvas.height = p.h + 2;
  const c = canvas.getContext('2d')!;
  c.imageSmoothingEnabled = false;
  // The sprite's pixels in one colour.
  const paint = (colour: string): HTMLCanvasElement => {
    const layer = document.createElement('canvas');
    layer.width = p.w;
    layer.height = p.h;
    const l = layer.getContext('2d')!;
    l.imageSmoothingEnabled = false;
    l.drawImage(p.image, p.sx, p.sy, p.w, p.h, 0, 0, p.w, p.h);
    l.globalCompositeOperation = 'source-in';
    l.fillStyle = colour;
    l.fillRect(0, 0, p.w, p.h);
    return layer;
  };
  const ring = paint(edge);
  for (const [ox, oy] of [[0, 1], [2, 1], [1, 0], [1, 2]] as const) c.drawImage(ring, ox, oy);
  // Only the ring is left of that: the sprite's own place is cleared, the veil goes in it.
  c.globalCompositeOperation = 'destination-out';
  c.drawImage(p.image, p.sx, p.sy, p.w, p.h, 1, 1, p.w, p.h);
  c.globalCompositeOperation = 'source-over';
  c.drawImage(paint(fill), 1, 1);
  made.set(key, canvas);
  return canvas;
}

const isSolid = (map: readonly number[], cell: number): boolean => ((terrainFlags[map[cell] ?? 0] ?? 0) & F.SOLID) !== 0;

/**
 * The cells under the sprite that a wall's overhang or top can cover: a floor cell with a wall right below it, or a wall
 * cell itself (a tall sprite reaches up into the one above its feet). Tall grass and statues, which hide on purpose, are not among them.
 */
export function wallCellsOver(level: Level, p: Placed): number[] {
  const map = level.map;
  const x0 = Math.floor(p.dx / TILE);
  const x1 = Math.floor((p.dx + p.w - 0.01) / TILE);
  const y0 = Math.floor(p.dy / TILE);
  const y1 = Math.floor((p.dy + p.h - 0.01) / TILE);
  const out: number[] = [];
  for (let y = Math.max(0, y0); y <= Math.min(HEIGHT - 1, y1); y++) {
    for (let x = Math.max(0, x0); x <= Math.min(WIDTH - 1, x1); x++) {
      const cell = x + y * WIDTH;
      if (isSolid(map, cell) || (y + 1 < HEIGHT && isSolid(map, cell + WIDTH))) out.push(cell);
    }
  }
  return out;
}

let scratch: HTMLCanvasElement | null = null;

/**
 * Draws the part of a sprite the upper layer covers, over it. `ctx` has the camera's transform on; the work is done at device
 * resolution on a small canvas so the silhouette lines up with the sprite and the wall pixel for pixel.
 */
export function drawXray(
  ctx: CanvasRenderingContext2D, p: Placed, tint: XrayTint, upper: HTMLCanvasElement, zoom: number, cameraX: number, cameraY: number,
): void {
  const ox = Math.floor(p.dx) - 1;
  const oy = Math.floor(p.dy) - 1;
  const w = Math.ceil(p.w + 3);
  const h = Math.ceil(p.h + 3);
  const z = zoom;
  if (!scratch) scratch = document.createElement('canvas');
  const width = Math.ceil(w * z);
  const height = Math.ceil(h * z);
  if (scratch.width < width || scratch.height < height) {
    scratch.width = Math.max(scratch.width, width);
    scratch.height = Math.max(scratch.height, height);
  }
  const s = scratch.getContext('2d')!;
  s.imageSmoothingEnabled = false;
  s.setTransform(1, 0, 0, 1, 0, 0);
  s.globalCompositeOperation = 'source-over';
  s.clearRect(0, 0, scratch.width, scratch.height);
  s.setTransform(z, 0, 0, z, -ox * z, -oy * z);
  const sil = silhouette(p, tint);
  if (p.flip) {
    s.translate(p.dx + p.w + 1, p.dy - 1);
    s.scale(-1, 1);
    s.drawImage(sil, 0, 0);
  } else {
    s.drawImage(sil, p.dx - 1, p.dy - 1);
  }
  // Kept only where the wall is: its pixels as a mask.
  s.setTransform(z, 0, 0, z, -ox * z, -oy * z);
  s.globalCompositeOperation = 'destination-in';
  s.drawImage(upper, ox, oy, w, h, ox, oy, w, h);
  s.globalCompositeOperation = 'source-over';
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(scratch, 0, 0, width, height, Math.round(ox * z - Math.round(cameraX * z)), Math.round(oy * z - Math.round(cameraY * z)), width, height);
  ctx.restore();
}

/** The wall cells being faded, each with how opaque it is now (1 is whole). */
const fades = new Map<number, number>();
let fadeAt = 0;
let fading = false;

/**
 * Eases the fade of the wall cells over the hero towards `wanted` (the cells to be faded; none lets all of them back), and says
 * whether any of them is still moving, for the pace. Light effects fade nothing (the silhouette is enough); reduced motion fades at once.
 */
export function fadeWalls(wanted: readonly number[], now: number): ReadonlyMap<number, number> {
  const dt = fadeAt === 0 ? 0 : Math.min(100, Math.max(0, now - fadeAt));
  fadeAt = now;
  const light = quality.light;
  const step = quality.reducedMotion ? 1 : dt / FADE_MS;
  const goal = new Set(light ? [] : wanted);
  fading = false;
  for (const cell of goal) if (!fades.has(cell)) fades.set(cell, 1);
  for (const [cell, alpha] of fades) {
    const to = goal.has(cell) ? FADED_ALPHA : 1;
    if (alpha === to) {
      if (to === 1) fades.delete(cell);
      continue;
    }
    const next = alpha > to ? Math.max(to, alpha - step * (1 - FADED_ALPHA)) : Math.min(to, alpha + step * (1 - FADED_ALPHA));
    fades.set(cell, next);
    if (next !== to) fading = true;
    else if (to === 1) fades.delete(cell);
  }
  return fades;
}

/** Whether a wall is fading in or out just now (pace.ts: the map is drawn at full pace). */
export const fadingWalls = (): boolean => fading;

/** A new floor: nothing of the last one fades. */
export function resetXray(): void {
  fades.clear();
  fadeAt = 0;
  fading = false;
}
