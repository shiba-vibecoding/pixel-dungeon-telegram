/*
 * Art of the Shattered update, part 2 (design v19; assets/shattered/): the sheets for the map's effects (wand
 * bolts, the prismatic image, the ally heart, the chains), and the animated canvases of the alchemy pot. They are
 * loaded when first asked for, not with the first screen: a sheet that is not there yet draws nothing for a
 * few frames.
 */

const base = `${import.meta.env.BASE_URL}assets/shattered/`;
const images = new Map<string, HTMLImageElement>();

/** A sheet of assets/shattered/ (name without .png), loading it on the first ask. */
export function shImage(name: string): HTMLImageElement {
  let image = images.get(name);
  if (!image) {
    image = new Image();
    image.src = `${base}${name}.png`;
    images.set(name, image);
  }
  return image;
}

/** Whether a sheet has come (a broken one never does). */
export const loaded = (image: HTMLImageElement): boolean => image.complete && image.naturalWidth > 0;

/** Loads the sheets the map's effects use, ahead of the first one. */
export function preloadMapFx(): void {
  for (const name of ['wand-bolts', 'prismatic', 'ally-heart', 'chain-link', 'chain-hook']) shImage(name);
}

/**
 * wand-bolts.png: two 8×8 frames (90 ms) a row, one row to a wand, in the order of wand-bolts.json; and the colour
 * of the four squares that trail each bolt (PD.demo.wands). Keyed by the client's bolt kinds (view.ts BOLT_COLORS).
 */
export const WAND_BOLT_ROW: Readonly<Record<string, number>> = {
  magic: 0, fire: 1, frost: 2, lightning: 3, corrosion: 4, force: 5, earth: 6, ward: 7, foliage: 8, blood: 9, corruption: 10, rainbow: 11,
};
export const WAND_BOLT_TRAIL: readonly string[] = [
  '#d8c8ff', '#ff9a2e', '#9ae8ff', '#fff6a0', '#8ad83a', '#e8e2c8', '#8a6a3a', '#b8a0ff', '#5ac83a', '#e0303a', '#5a2a8a', '#ffe0f0',
];
export const BOLT_FRAME_MS = 90;

/** The prismatic image's four colour phases change every 120 ms (prismatic.png rows). */
export const PRISM_PHASE_MS = 120;
/** The ally heart bobs every 400 ms; the second frame is a pixel lower. */
export const HEART_MS = 400;
