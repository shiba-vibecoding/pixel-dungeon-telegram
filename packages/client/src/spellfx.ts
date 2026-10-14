/*
 * SpellSprite (effects/SpellSprite.java): a small icon that fades in over a character, stays a moment, fades out: food eaten,
 * a charge, rage, haste, sight. The frames are Shattered's spell_icons.png (16 px); `tint` is hardlight(r, g, b).
 */

const SIZE = 16;
const FADE_IN = 200;
const STATIC = 800;
const FADE_OUT = 400;
export const SPELL_LIFE = FADE_IN + STATIC + FADE_OUT;

/** The frames of spell_icons.png (SpellSprite.FOOD...PURITY). */
export const SPELL_FRAMES = { food: 0, map: 1, charge: 2, berserk: 3, ankh: 4, haste: 5, vision: 6, purity: 7 } as const;
export type SpellName = keyof typeof SPELL_FRAMES;

export interface Spell {
  hero: string;
  frame: number;
  tint?: readonly [number, number, number];
  start: number;
}

let image: HTMLImageElement | null = null;
const tinted = new Map<string, HTMLCanvasElement>();

function sheet(): HTMLImageElement | null {
  if (!image) {
    image = new Image();
    image.src = new URL(`${import.meta.env.BASE_URL}assets/spd/spell_icons.png`, document.baseURI).href;
  }
  return image.complete && image.naturalWidth > 0 ? image : null;
}

/** One frame, multiplied by its tint, kept. */
function frameOf(frame: number, tint?: readonly [number, number, number]): CanvasImageSource | null {
  const source = sheet();
  if (!source) return null;
  const key = `${frame}:${tint?.join(',') ?? ''}`;
  let canvas = tinted.get(key);
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.width = canvas.height = SIZE;
    const c = canvas.getContext('2d')!;
    c.imageSmoothingEnabled = false;
    c.drawImage(source, frame * SIZE, 0, SIZE, SIZE, 0, 0, SIZE, SIZE);
    if (tint) {
      c.globalCompositeOperation = 'multiply';
      c.fillStyle = `rgb(${Math.round(tint[0] * 255)}, ${Math.round(tint[1] * 255)}, ${Math.round(tint[2] * 255)})`;
      c.fillRect(0, 0, SIZE, SIZE);
      c.globalCompositeOperation = 'destination-in';
      c.drawImage(source, frame * SIZE, 0, SIZE, SIZE, 0, 0, SIZE, SIZE);
    }
    tinted.set(key, canvas);
  }
  return canvas;
}

/** Draws a spell sprite at a screen point (the top of the character it is over); false once it has run its course. */
export function drawSpell(ctx: CanvasRenderingContext2D, spell: Spell, x: number, y: number, zoom: number, now: number): boolean {
  const age = now - spell.start;
  if (age < 0 || age > SPELL_LIFE) return age <= SPELL_LIFE;
  const image = frameOf(spell.frame, spell.tint);
  if (!image) return true;
  let alpha = 1;
  let scale = 1;
  if (age < FADE_IN) alpha = scale = age / FADE_IN;
  else if (age > FADE_IN + STATIC) alpha = 1 - (age - FADE_IN - STATIC) / FADE_OUT;
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.globalAlpha = Math.max(0, alpha);
  const size = SIZE * zoom * scale;
  ctx.drawImage(image, x - size / 2, y - SIZE * zoom + (SIZE * zoom - size) / 2, size, size);
  ctx.restore();
  return true;
}
