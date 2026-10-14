/*
 * Cards and numbers over the map, as the design system draws them
 * (docs/design/system/canvas-fx.md, PD.fx): Galmuri at whole multiples of
 * its pixel, a pixel outline of eight copies and a hard shadow, and motion
 * in steps — each value holds until the next frame, nothing in between.
 * Sizes are in font pixels; `px` is how many device pixels one CSS pixel is.
 */

export const FX_COLORS = {
  ink: '#e8e2c8', gold: '#ffeba4', goldDeep: '#ffcc66', damage: '#ff4433', heal: '#44ff44', boss: '#ff6a4a', line: '#9fa896',
  outline: '#0b0b09', shadow: 'rgba(0, 0, 0, 0.5)', band: 'rgba(11, 11, 9, 0.78)',
} as const;

const FONTS = { ui: { family: 'Galmuri11', em: 12 }, small: { family: 'Galmuri9', em: 10 } } as const;
const AROUND = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]] as const;

const snap = (v: number, s: number): number => Math.round(v / s) * s;

/** With reduced motion, a card shows at once without moving and goes in one frame. */
const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

type Frames<T> = ReadonlyArray<readonly [number, T]>;
interface Timeline<T> {
  /** The frame a card holds on with reduced motion. */
  hold: number;
  dur: number;
  frames: Frames<T>;
}

/** Frame layouts; one frame is 66 ms for cards (15 a second), 100 ms for numbers. */
export const TIMELINES = {
  level: {
    hold: 3, dur: 1600,
    frames: [[0, { a: 0, dy: 4 }], [66, { a: 0.5, dy: 2 }], [133, { a: 1, dy: -1 }], [200, { a: 1, dy: 0 }], [1400, { a: 0.66, dy: -1 }], [1466, { a: 0.33, dy: -2 }], [1533, { a: 0, dy: -3 }]],
  } as Timeline<{ a: number; dy: number }>,
  boss: {
    hold: 6, dur: 3000,
    frames: [
      [0, { band: 0.33, rule: 0, name: 0, sub: 0 }], [66, { band: 0.66, rule: 0.25, name: 0, sub: 0 }], [133, { band: 1, rule: 0.5, name: 0, sub: 0 }],
      [200, { band: 1, rule: 1, name: 0.5, sub: 0 }], [266, { band: 1, rule: 1, name: 1, sub: 0 }], [466, { band: 1, rule: 1, name: 1, sub: 0.5 }],
      [533, { band: 1, rule: 1, name: 1, sub: 1 }], [2733, { band: 0.66, rule: 0.66, name: 0.66, sub: 0.66 }],
      [2800, { band: 0.33, rule: 0.33, name: 0.33, sub: 0.33 }], [2866, { band: 0, rule: 0, name: 0, sub: 0 }],
    ],
  } as Timeline<{ band: number; rule: number; name: number; sub: number }>,
  slain: {
    hold: 2, dur: 2200,
    frames: [[0, { a: 1, flash: 1, rule: 0 }], [66, { a: 1, flash: 0, rule: 0.5 }], [133, { a: 1, flash: 0, rule: 1 }], [2000, { a: 0.66, flash: 0, rule: 0.66 }], [2066, { a: 0.33, flash: 0, rule: 0.33 }], [2133, { a: 0, flash: 0, rule: 0 }]],
  } as Timeline<{ a: number; flash: number; rule: number }>,
  depth: {
    hold: 7, dur: 2400,
    frames: [
      [0, { band: 0.33, rule: 0, emb: 0, dy: 0, title: 0, sub: 0 }], [66, { band: 0.66, rule: 0.25, emb: 0, dy: 0, title: 0, sub: 0 }],
      [133, { band: 1, rule: 0.5, emb: 0, dy: 0, title: 0, sub: 0 }], [200, { band: 1, rule: 1, emb: 0.5, dy: 2, title: 0, sub: 0 }],
      [266, { band: 1, rule: 1, emb: 1, dy: -1, title: 0.5, sub: 0 }], [333, { band: 1, rule: 1, emb: 1, dy: 0, title: 1, sub: 0 }],
      [400, { band: 1, rule: 1, emb: 1, dy: 0, title: 1, sub: 0.5 }], [466, { band: 1, rule: 1, emb: 1, dy: 0, title: 1, sub: 1 }],
      [2200, { band: 0.66, rule: 0.66, emb: 0.66, dy: 0, title: 0.66, sub: 0.66 }],
      [2266, { band: 0.33, rule: 0.33, emb: 0.33, dy: 0, title: 0.33, sub: 0.33 }],
      [2333, { band: 0, rule: 0, emb: 0, dy: 0, title: 0, sub: 0 }],
    ],
  } as Timeline<{ band: number; rule: number; emb: number; dy: number; title: number; sub: number }>,
  /** A region's first visit: the descent's head, then its lines of text one by one; held 5.6 s. */
  intro: {
    hold: 15, dur: 5800,
    frames: [
      [0, { band: 0.33, rule: 0, emb: 0, dy: 0, title: 0, sub: 0, lines: 0 }], [66, { band: 0.66, rule: 0.25, emb: 0, dy: 0, title: 0, sub: 0, lines: 0 }],
      [133, { band: 1, rule: 0.5, emb: 0, dy: 0, title: 0, sub: 0, lines: 0 }], [200, { band: 1, rule: 1, emb: 0.5, dy: 2, title: 0, sub: 0, lines: 0 }],
      [266, { band: 1, rule: 1, emb: 1, dy: -1, title: 0.5, sub: 0, lines: 0 }], [333, { band: 1, rule: 1, emb: 1, dy: 0, title: 1, sub: 0, lines: 0 }],
      [400, { band: 1, rule: 1, emb: 1, dy: 0, title: 1, sub: 0.5, lines: 0 }], [466, { band: 1, rule: 1, emb: 1, dy: 0, title: 1, sub: 1, lines: 0 }],
      [600, { band: 1, rule: 1, emb: 1, dy: 0, title: 1, sub: 1, lines: 0.5 }], [666, { band: 1, rule: 1, emb: 1, dy: 0, title: 1, sub: 1, lines: 1 }],
      [800, { band: 1, rule: 1, emb: 1, dy: 0, title: 1, sub: 1, lines: 1.5 }], [866, { band: 1, rule: 1, emb: 1, dy: 0, title: 1, sub: 1, lines: 2 }],
      [1000, { band: 1, rule: 1, emb: 1, dy: 0, title: 1, sub: 1, lines: 2.5 }], [1066, { band: 1, rule: 1, emb: 1, dy: 0, title: 1, sub: 1, lines: 3 }],
      [1200, { band: 1, rule: 1, emb: 1, dy: 0, title: 1, sub: 1, lines: 3.5 }], [1266, { band: 1, rule: 1, emb: 1, dy: 0, title: 1, sub: 1, lines: 4 }],
      [5600, { band: 0.66, rule: 0.66, emb: 0.66, dy: 0, title: 0.66, sub: 0.66, lines: 2.64 }],
      [5666, { band: 0.33, rule: 0.33, emb: 0.33, dy: 0, title: 0.33, sub: 0.33, lines: 1.32 }],
      [5733, { band: 0, rule: 0, emb: 0, dy: 0, title: 0, sub: 0, lines: 0 }],
    ],
  } as Timeline<{ band: number; rule: number; emb: number; dy: number; title: number; sub: number; lines: number }>,
  /** The arena's wave banner: as a boss's name, but shorter (2.2 s). */
  wave: {
    hold: 6, dur: 2200,
    frames: [
      [0, { band: 0.33, rule: 0, name: 0, sub: 0 }], [66, { band: 0.66, rule: 0.25, name: 0, sub: 0 }], [133, { band: 1, rule: 0.5, name: 0, sub: 0 }],
      [200, { band: 1, rule: 1, name: 0.5, sub: 0 }], [266, { band: 1, rule: 1, name: 1, sub: 0 }], [400, { band: 1, rule: 1, name: 1, sub: 0.5 }],
      [466, { band: 1, rule: 1, name: 1, sub: 1 }], [1933, { band: 0.66, rule: 0.66, name: 0.66, sub: 0.66 }],
      [2000, { band: 0.33, rule: 0.33, name: 0.33, sub: 0.33 }], [2066, { band: 0, rule: 0, name: 0, sub: 0 }],
    ],
  } as Timeline<{ band: number; rule: number; name: number; sub: number }>,
  number: {
    hold: 0, dur: 700,
    frames: [[0, { a: 1, dy: 0 }], [100, { a: 1, dy: -2 }], [200, { a: 1, dy: -4 }], [300, { a: 1, dy: -6 }], [400, { a: 0.66, dy: -8 }], [500, { a: 0.33, dy: -8 }], [600, { a: 0, dy: -8 }]],
  } as Timeline<{ a: number; dy: number }>,
};

/** The frame showing `t` ms into a timeline: the last one whose time has come. */
function step<T>(timeline: Timeline<T>, t: number): T {
  const { frames } = timeline;
  if (reduced) {
    const last = frames[frames.length - 1]!;
    return t >= last[0] ? last[1] : frames[timeline.hold]![1];
  }
  let value = frames[0]![1];
  for (const [at, v] of frames) {
    if (at <= t) value = v;
    else break;
  }
  return value;
}

export interface TextOptions {
  font?: 'ui' | 'small';
  /** Font pixel size in CSS pixels: 2 is Galmuri11 at 24px. */
  scale?: number;
  color?: string;
  outline?: string | 'none';
  /** Shadow depth in font pixels; 0 for none. */
  shadow?: number;
  align?: CanvasTextAlign;
  alpha?: number;
  /** Draw it afresh every time (text that changes every frame, or is drawn once). */
  cache?: boolean;
}

/**
 * Text made once: a number floating up is the same eighteen copies of its letters every frame it stays, so its picture is kept
 * and drawn as one (a fade then fades the whole picture evenly, rather than the copies' overlaps adding up), only once its font has
 * loaded (a picture of the fallback font would stay), and at most so many at a time.
 */
interface TextPicture {
  image: HTMLCanvasElement;
  /** Where the text's own origin (its left end on the baseline) is inside the picture, device pixels. */
  ox: number;
  oy: number;
  width: number;
}
const pictures = new Map<string, TextPicture | false>();
/** A bigger picture than this (a boss's name across the screen) is drawn letter by letter instead: it is up for seconds, once. */
const MAX_PICTURE_AREA = 40_000;
const MAX_PICTURES = 120;
const fontReady = new Map<string, boolean>();

function ready(font: string): boolean {
  let ok = fontReady.get(font);
  if (ok === undefined) {
    ok = typeof document === 'undefined' || !document.fonts || document.fonts.check(font);
    // A font still loading is asked about again; one found ready stays so.
    if (ok) fontReady.set(font, true);
  }
  return ok;
}

function picture(
  text: string, family: string, size: number, s: number, color: string, outline: string, shadow: number,
): TextPicture | null {
  const font = `${size}px "${family}"`;
  const key = `${font}|${s}|${color}|${outline}|${shadow}|${text}`;
  const kept = pictures.get(key);
  if (kept !== undefined) return kept || null;
  if (!ready(font) || typeof document === 'undefined') return null;
  const probe = document.createElement('canvas').getContext('2d');
  if (!probe) return null;
  probe.font = font;
  const width = probe.measureText(text).width;
  const pad = Math.ceil(s) + 1;
  const wide = Math.ceil(width) + pad * 2;
  const tall = Math.ceil(size * 1.5) + Math.ceil(shadow * s) + pad * 2;
  if (wide * tall > MAX_PICTURE_AREA) {
    pictures.set(key, false);
    return null;
  }
  const image = document.createElement('canvas');
  image.width = wide;
  image.height = tall;
  const g = image.getContext('2d')!;
  g.font = font;
  g.textAlign = 'left';
  g.textBaseline = 'alphabetic';
  const ox = pad;
  const oy = pad + Math.ceil(size * 1.1);
  if (shadow) {
    g.fillStyle = FX_COLORS.shadow;
    for (const [dx, dy] of AROUND) g.fillText(text, ox + dx * s, oy + dy * s + shadow * s);
    g.fillText(text, ox, oy + shadow * s);
  }
  if (outline !== 'none') {
    g.fillStyle = outline;
    for (const [dx, dy] of AROUND) g.fillText(text, ox + dx * s, oy + dy * s);
  }
  g.fillStyle = color;
  g.fillText(text, ox, oy);
  if (pictures.size >= MAX_PICTURES) {
    // The oldest half goes (a Map keeps the order things came in).
    let drop = MAX_PICTURES / 2;
    for (const old of pictures.keys()) {
      if (drop-- <= 0) break;
      pictures.delete(old);
    }
  }
  const made = { image, ox, oy, width };
  pictures.set(key, made);
  return made;
}

/** Text with a pixel outline and a hard shadow; returns its width in device pixels. */
export function fxText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, px: number, o: TextOptions = {}): number {
  const font = FONTS[o.font ?? 'ui'];
  const s = (o.scale ?? 2) * px;
  const size = Math.round(font.em * s);
  const align = o.align ?? 'center';
  x = snap(x, s);
  y = snap(y, s);
  const shadow = o.shadow ?? 1;
  const outline = o.outline ?? FX_COLORS.outline;
  const alpha = o.alpha ?? 1;
  const color = o.color ?? FX_COLORS.ink;
  const kept = o.cache !== false ? picture(text, font.family, size, s, color, outline, shadow) : null;
  if (kept) {
    const left = align === 'center' ? x - kept.width / 2 : align === 'right' || align === 'end' ? x - kept.width : x;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = alpha;
    ctx.drawImage(kept.image, Math.round(left - kept.ox), Math.round(y - kept.oy));
    ctx.restore();
    return kept.width;
  }
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = alpha;
  ctx.font = `${size}px "${font.family}"`;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  if (shadow) {
    ctx.fillStyle = FX_COLORS.shadow;
    for (const [dx, dy] of AROUND) ctx.fillText(text, x + dx * s, y + dy * s + shadow * s);
    ctx.fillText(text, x, y + shadow * s);
  }
  if (outline !== 'none') {
    ctx.fillStyle = outline;
    for (const [dx, dy] of AROUND) ctx.fillText(text, x + dx * s, y + dy * s);
  }
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  const width = ctx.measureText(text).width;
  ctx.restore();
  return width;
}

/** A line one font pixel thick, outlined. */
function rule(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, s: number, color: string, alpha: number): void {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = alpha;
  x = snap(x, s);
  y = snap(y, s);
  w = snap(w, s);
  ctx.fillStyle = FX_COLORS.outline;
  ctx.fillRect(x - s, y - s, w + 2 * s, 3 * s);
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, s);
  ctx.restore();
}

/** «Level 3!» over the hero; false once it is over. */
export function levelCard(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, t: number, px: number): boolean {
  const k = step(TIMELINES.level, t);
  if (k.a > 0) fxText(ctx, text, x, y + k.dy * 3 * px, px, { scale: 3, color: FX_COLORS.gold, alpha: k.a });
  return t < TIMELINES.level.dur;
}

/** «Depth 4» on a floor that is no new region's first (those have their card): small, light, over the middle of the free band. False once it is over. */
export function floorTitle(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, t: number, px: number): boolean {
  const k = step(TIMELINES.level, t);
  if (k.a > 0) fxText(ctx, text, x, y + k.dy * 2 * px, px, { scale: 2, color: FX_COLORS.ink, alpha: k.a * 0.9 });
  return t < TIMELINES.level.dur;
}

/** A boss's name on a band across the screen, its epithet under it, between two rules. */
export function bossCard(ctx: CanvasRenderingContext2D, name: string, sub: string, cy: number, width: number, t: number, px: number): boolean {
  const k = step(TIMELINES.boss, t);
  const h = 112 * px;
  if (k.band > 0) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = k.band;
    ctx.fillStyle = FX_COLORS.band;
    ctx.fillRect(0, snap(cy - h / 2, 2 * px), width, h);
    ctx.restore();
  }
  const half = Math.round(width * 0.4 * k.rule);
  if (half > 0) {
    rule(ctx, width / 2 - half, cy - h / 2 + 6 * px, half * 2, 2 * px, FX_COLORS.line, k.band);
    rule(ctx, width / 2 - half, cy + h / 2 - 8 * px, half * 2, 2 * px, FX_COLORS.line, k.band);
  }
  // A long name (the Dwarf King's in Russian) steps down a size rather than leave the screen.
  if (k.name > 0) {
    const scale = fits(ctx, name, width * 0.92, px, [4, 3, 2]);
    fxText(ctx, name, width / 2, cy + 8 * px, px, { scale, color: FX_COLORS.boss, alpha: k.name });
  }
  if (k.sub > 0) fxText(ctx, sub, width / 2, cy + 36 * px, px, { scale: 1.5, color: FX_COLORS.ink, alpha: k.sub, shadow: 0 });
  return t < TIMELINES.boss.dur;
}

/**
 * A wave of the arena begins (PD.fx.wave): «Wave 5» in gold ×4 on the band, its line under it; a
 * champions' wave has its rules and line in the boss's red, a boss's wave its number too.
 */
export function waveCard(
  ctx: CanvasRenderingContext2D, title: string, sub: string, kind: '' | 'champions' | 'boss', cy: number, width: number, t: number, px: number,
): boolean {
  const k = step(TIMELINES.wave, t);
  const h = 104 * px;
  if (k.band > 0) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = k.band;
    ctx.fillStyle = FX_COLORS.band;
    ctx.fillRect(0, snap(cy - h / 2, 2 * px), width, h);
    ctx.restore();
  }
  const red = kind === 'champions' || kind === 'boss';
  const half = Math.round(width * 0.4 * k.rule);
  if (half > 0) {
    rule(ctx, width / 2 - half, cy - h / 2 + 6 * px, half * 2, 2 * px, red ? FX_COLORS.boss : FX_COLORS.line, k.band);
    rule(ctx, width / 2 - half, cy + h / 2 - 8 * px, half * 2, 2 * px, red ? FX_COLORS.boss : FX_COLORS.line, k.band);
  }
  if (k.name > 0) {
    const scale = fits(ctx, title, width * 0.9, px, [4, 3]);
    fxText(ctx, title, width / 2, cy + 6 * px, px, { scale, color: kind === 'boss' ? FX_COLORS.boss : FX_COLORS.gold, alpha: k.name });
  }
  if (k.sub > 0 && sub) fxText(ctx, sub, width / 2, cy + 34 * px, px, { scale: 1.5, color: red ? FX_COLORS.boss : FX_COLORS.ink, alpha: k.sub, shadow: 0 });
  return t < TIMELINES.wave.dur;
}

/** How long a depth card stays up (the arena's sinking card goes before its wave's banner). */
export const DEPTH_CARD_MS = TIMELINES.depth.dur;

/**
 * Going down to a new region: «Depth 6» and the region's name beside its

 * emblem, on the same band as a boss's name. `emblems` is
 * assets/world/ui-map.png; region 0..4 picks the 32×32 emblem in its
 * `emblems` row (atlas ui-map.json), drawn ×2.
 */
export function depthCard(
  ctx: CanvasRenderingContext2D, title: string, region: string, emblems: CanvasImageSource, regionIndex: number,
  cy: number, width: number, t: number, px: number, emblemRow = { x: 0, y: 24 },
  /** A region's first visit: a few lines about it under the head, on the same band (PD.fx.intro). */
  text = '',
): boolean {
  const timeline = text ? TIMELINES.intro : TIMELINES.depth;
  const k: { band: number; rule: number; emb: number; dy: number; title: number; sub: number; lines?: number } = step(timeline, t);
  const lines = text ? wrap(ctx, text, `${Math.round(FONTS.small.em * 1.5 * px)}px "${FONTS.small.family}"`, Math.min(width * 0.84, 344 * px)).slice(0, 4) : [];
  const lh = 21 * px;
  const extra = lines.length ? lines.length * lh + 14 * px : 0;
  // The text's band grows both ways from where the card sits, so it reaches no nearer the hero below than it must.
  cy -= extra / 2;
  const top = snap(cy - 48 * px, 2 * px);
  const h = 96 * px + extra;
  if (k.band > 0) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = k.band;
    ctx.fillStyle = FX_COLORS.band;
    ctx.fillRect(0, top, width, h);
    ctx.restore();
  }
  const half = Math.round(width * 0.4 * k.rule);
  if (half > 0) {
    rule(ctx, width / 2 - half, top + 6 * px, half * 2, 2 * px, FX_COLORS.line, k.band);
    rule(ctx, width / 2 - half, top + h - 8 * px, half * 2, 2 * px, FX_COLORS.line, k.band);
  }
  // The lines come one by one (half bright for a frame, then full), and fade with the band.
  lines.forEach((line, i) => {
    const a = k.band < 1 ? k.band : Math.max(0, Math.min(1, (k.lines ?? 0) - i));
    if (a > 0) fxText(ctx, line, width / 2, top + 108 * px + i * lh, px, { font: 'small', scale: 1.5, color: FX_COLORS.ink, alpha: a, shadow: 0 });
  });
  // The emblem, a gap and the wider of the two lines are centred together; a long title steps down a size.
  const e = 64 * px, gap = 16 * px;
  const scale = fits(ctx, title, width * 0.92 - e - gap, px, [3, 2]);
  ctx.save();
  ctx.font = `${Math.round(FONTS.ui.em * scale * px)}px "${FONTS.ui.family}"`;
  let tw = ctx.measureText(title).width;
  ctx.font = `${Math.round(FONTS.ui.em * 1.5 * px)}px "${FONTS.ui.family}"`;
  tw = Math.max(tw, ctx.measureText(region).width);
  ctx.restore();
  const gx = snap(width / 2 - (e + gap + tw) / 2, 2 * px), tx = gx + e + gap;
  if (k.emb > 0) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = k.emb;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(emblems, emblemRow.x + regionIndex * 32, emblemRow.y, 32, 32, gx, snap(cy - 32 * px + k.dy * 2 * px, 2 * px), e, e);
    ctx.restore();
  }
  if (k.title > 0) fxText(ctx, title, tx, cy + 2 * px, px, { scale, color: FX_COLORS.gold, alpha: k.title, align: 'left' });
  if (k.sub > 0) fxText(ctx, region, tx, cy + 28 * px, px, { scale: 1.5, color: FX_COLORS.ink, alpha: k.sub, shadow: 0, align: 'left' });
  return t < timeline.dur;
}

/** Splits text into lines no wider than `width` (by words) in the given font. */
function wrap(ctx: CanvasRenderingContext2D, text: string, font: string, width: number): string[] {
  ctx.save();
  ctx.font = font;
  const out: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    const longer = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(longer).width > width) {
      out.push(line);
      line = word;
    } else {
      line = longer;
    }
  }
  if (line) out.push(line);
  ctx.restore();
  return out;
}

/** The largest of `scales` at which `text` fits in `width`. */
function fits(ctx: CanvasRenderingContext2D, text: string, width: number, px: number, scales: readonly number[]): number {
  ctx.save();
  for (const scale of scales) {
    ctx.font = `${Math.round(FONTS.ui.em * scale * px)}px "${FONTS.ui.family}"`;
    if (ctx.measureText(text).width <= width) {
      ctx.restore();
      return scale;
    }
  }
  ctx.restore();
  return scales[scales.length - 1]!;
}

/** «Boss slain»: white for a frame, then gold, with rules growing at its sides. */
export function slainCard(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, t: number, px: number): boolean {
  const k = step(TIMELINES.slain, t);
  if (k.a <= 0) return t < TIMELINES.slain.dur;
  const w = fxText(ctx, text, x, y, px, { scale: 3, color: k.flash ? '#ffffff' : FX_COLORS.gold, alpha: k.a });
  const len = Math.round(48 * px * k.rule);
  if (len > 0) {
    rule(ctx, x - w / 2 - 12 * px - len, y - 15 * px, len, 3 * px, FX_COLORS.goldDeep, k.a);
    rule(ctx, x + w / 2 + 12 * px, y - 15 * px, len, 3 * px, FX_COLORS.goldDeep, k.a);
  }
  return t < TIMELINES.slain.dur;
}

/**
 * A number over a character: `x` the middle of its sprite, `y` its top.
 * 'big' is a blow of a quarter of its health or more; words rise the same way.
 */
export function floatNumber(
  ctx: CanvasRenderingContext2D, text: string, kind: 'damage' | 'heal' | 'big' | 'kill' | 'word', color: string, x: number, y: number, t: number, px: number,
): boolean {
  const k = step(TIMELINES.number, t);
  // A heavy blow's number lands big, a killing blow's bigger still.
  const scale = kind === 'kill' ? 4 : kind === 'big' ? 3 : 2;
  if (k.a > 0) {
    fxText(ctx, text, x, y - 2 * scale * px + k.dy * scale * px, px, {
      font: 'small', scale, alpha: k.a, shadow: 0,
      color: kind === 'heal' ? FX_COLORS.heal : kind === 'word' ? color : FX_COLORS.damage,
    });
  }
  return t < TIMELINES.number.dur;
}

const PATRON_STAR = ['...w...', '..wo#..', 'wwoo###', '#oooo##', '.#oo##.', '.##.##.', '##...##'];
const PATRON_COLORS: Record<string, string> = { '#': '#ffcc66', o: '#ffeba4', w: '#ffffff' };

/** The patron's star (PD.fx.patronStar): seven pixels a side, a bronze outline; `s` is its pixel in device pixels. Returns its width. */
export function patronStar(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): number {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  x = snap(x, s);
  y = snap(y, s);
  ctx.fillStyle = '#5a3d10';
  PATRON_STAR.forEach((row, j) => {
    for (let i = 0; i < 7; i++) if (row[i] !== '.') ctx.fillRect(x + i * s, y + j * s, 3 * s, 3 * s);
  });
  PATRON_STAR.forEach((row, j) => {
    for (let i = 0; i < 7; i++) {
      if (row[i] === '.') continue;
      ctx.fillStyle = PATRON_COLORS[row[i]!]!;
      ctx.fillRect(x + (i + 1) * s, y + (j + 1) * s, s, s);
    }
  });
  ctx.restore();
  return 9 * s;
}

/** A name over a head (PD.fx.nameplate): Galmuri9 at 15px, outlined, the patron's star before it. `x` the sprite's middle, `y` its top. */
export function nameplate(ctx: CanvasRenderingContext2D, name: string, x: number, y: number, px: number, o: { patron?: boolean; color?: string } = {}): void {
  const star = o.patron ? (9 * 2 + 4) * px : 0;
  ctx.save();
  ctx.font = `${Math.round(15 * px)}px "Galmuri9"`;
  const width = ctx.measureText(name).width;
  ctx.restore();
  const left = x - (width + star) / 2;
  const base = y - 6 * px;
  if (o.patron) patronStar(ctx, left, base - 16 * px, 2 * px);
  fxText(ctx, name, left + star, base, px, { font: 'small', scale: 1.5, color: o.color ?? '#5ec8c0', align: 'left', shadow: 0 });
}
