
/*
 * The world's sprite sheets (assets/world, Claude Design's «Живой мир»): doors,
 * chests, grass, splashes, glints, tap feedback, co-op markers, each region's
 * life, fog and light. Each sheet comes with an atlas: named animations, each
 * a row of frames with their place on the sheet and how long they hold
 * (`ms: 0` on the last frame: stop there). Sheets load in the background;
 * until one has, `sheet` returns null and callers draw what they drew before.
 */

export interface Frame {
  x: number;
  y: number;
  w: number;
  h: number;
  /** How long the frame holds; 0 on a last frame means «stop here». */
  ms: number;
}

export interface Sheet {
  image: HTMLImageElement;
  anims: Readonly<Record<string, readonly Frame[]>>;
}

/** The sheets there are: those with a region number come in five, as tiles0..4 do. */
export type SheetName =
  | `doors${0 | 1 | 2 | 3 | 4}` | `grass${0 | 1 | 2 | 3 | 4}` | `ambient${0 | 1 | 2 | 3 | 4}` | `fog${0 | 1 | 2 | 3 | 4}`
  /** The arena of waves' dressing, per tier (design system v14): gates, braziers, banners, sand, crowd. */
  | `arena${0 | 1 | 2 | 3 | 4}`
  | 'chests' | 'feedback' | 'glint' | 'coop' | 'splash' | 'light' | 'ui-map';

const BASE = `${import.meta.env.BASE_URL}assets/world/`;
const loaded = new Map<SheetName, Sheet>();
const loading = new Set<SheetName>();

async function load(name: SheetName): Promise<void> {
  try {
    const atlas = (await (await fetch(`${BASE}${name}.json`)).json()) as {
      animations: Record<string, { frames: Frame[] }>;
    };
    const image = new Image();
    image.src = `${BASE}${name}.png`;
    await image.decode();
    const anims: Record<string, Frame[]> = {};
    for (const [key, anim] of Object.entries(atlas.animations)) anims[key] = anim.frames;
    loaded.set(name, { image, anims });
  } catch {
    // Without it, then: the game draws what it did before.
    loading.delete(name);
  }
}

/** A sheet, once loaded; asking for one starts loading it. */
export function sheet(name: SheetName): Sheet | null {
  const done = loaded.get(name);
  if (done) return done;
  if (!loading.has(name)) {
    loading.add(name);
    void load(name);
  }
  return null;
}

/** Starts loading the sheets every depth uses, and those of a region. */
export function preloadSheets(region: number): void {
  for (const name of ['chests', 'feedback', 'glint', 'coop', 'splash', 'light', 'ui-map'] as const) sheet(name);
  const r = Math.max(0, Math.min(4, region)) as 0 | 1 | 2 | 3 | 4;
  for (const name of [`doors${r}`, `grass${r}`, `ambient${r}`, `fog${r}`] as const) sheet(name);
}

/** The region's number of a depth, as the sheets with a number count them. */
export const regionIndex = (depth: number): 0 | 1 | 2 | 3 | 4 => Math.max(0, Math.min(4, Math.floor((depth - 1) / 5))) as 0 | 1 | 2 | 3 | 4;

/**
 * Whose tiles, water and life a depth shows: its region's, but the last shop
 * (depth 21, LastShopLevel) is laid in the city's tiles and water (TILES_CITY,
 * WATER_CITY) with the city's visuals, though it opens the demon halls.
 */
export const lookIndex = (depth: number): 0 | 1 | 2 | 3 | 4 => regionIndex(depth);

/** How long an animation lasts once through (a last frame of 0 ms is the end). */
export function length(frames: readonly Frame[]): number {
  return frames.reduce((sum, frame) => sum + frame.ms, 0);
}

/**
 * The frame showing `t` ms in: once through (holding the last frame), or round and round;
 * `order` plays the frames in another order (a sway: 2,1,0,1,2,3,4,3), `hold` overrides each frame's ms.
 */
export function frameAt(frames: readonly Frame[], t: number, loop = false, order?: readonly number[], hold?: number): Frame {
  const seq = order ?? frames.map((_, i) => i);
  const ms = (i: number): number => hold ?? (frames[seq[i]!]!.ms || 0);
  let total = 0;
  for (let i = 0; i < seq.length; i++) total += ms(i);
  if (total <= 0) return frames[seq[seq.length - 1]!]!;
  let at = loop ? ((t % total) + total) % total : Math.max(0, t);
  for (let i = 0; i < seq.length; i++) {
    const d = ms(i);
    if (d === 0 || at < d) return frames[seq[i]!]!;
    at -= d;
  }
  return frames[seq[seq.length - 1]!]!;
}

/** Draws a frame with its top-left at (x, y), at its own size unless given another. */
export function drawFrame(ctx: CanvasRenderingContext2D, s: Sheet, frame: Frame, x: number, y: number, w = frame.w, h = frame.h): void {
  ctx.drawImage(s.image, frame.x, frame.y, frame.w, frame.h, x, y, w, h);
}

/** A white sheet tinted a colour (a player's), kept so it is made once per colour. */
const tinted = new Map<string, HTMLCanvasElement>();
export function tintedImage(s: Sheet, color: string): HTMLCanvasElement {
  const key = `${s.image.src}|${color}`;
  let canvas = tinted.get(key);
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.width = s.image.width;
    canvas.height = s.image.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(s.image, 0, 0);
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    tinted.set(key, canvas);
  }
  return canvas;
}
