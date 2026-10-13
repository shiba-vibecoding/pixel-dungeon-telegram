/*
 * Art of the Shattered update, part 2 (design v19; assets/shattered/): the sheets for the map's effects (wand
 * bolts, the prismatic image, the ally heart, the chains), and the animated canvases of the alchemy pot. They are
 * loaded when first asked for, not with the first screen: a sheet that is not there yet draws nothing for a
 * few frames.
 */

import { loop } from './lifecycle';
import { quality } from './quality';

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

/**
 * buffs-tints.png / buffs-tints-large.png (assets/shattered/buffs-tints.json): the 18 buffs whose icon Shattered tints,
 * by the hud's buff names. The sheets are drawn already tinted, so nothing is coloured in code. Two are chosen where
 * the buffs are listed instead: the talisman's foresight (17) and the prismatic guard at full strength (8).
 */
export const BUFF_TINTS: Readonly<Record<string, number>> = {
  haste: 0, stamina: 1, fireImbue: 2, toxicImbue: 3, frostImbue: 4, shield: 5, arcaneArmor: 6, prismaticGuard: 7,
  potionHealing: 9, aquaHealing: 10, htBoost: 11, stealth: 12, invisible: 13, timeFreeze: 14, stasis: 14, slow: 15, thorns: 16,
};

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

/* Animated canvases (one frame loop for all of them; it sleeps while the game is out of sight, lifecycle.ts) */


const tickers = new Set<(now: number) => boolean>();
let stopLoop: (() => void) | null = null;

/** Calls `draw` every frame while the canvas is in the page; the loop ends with the last of them. */
export function animate(canvas: HTMLElement, draw: (now: number) => void): void {
  tickers.add((now) => {
    if (!canvas.isConnected) return false;
    draw(now);
    return true;
  });
  stopLoop ??= loop((now) => {
    for (const ticker of [...tickers]) if (!ticker(now)) tickers.delete(ticker);
    if (tickers.size === 0) {
      stopLoop?.();
      stopLoop = null;
    }
  });
}

/** What the pot is doing: boiling, or brewing since a time (design v19: pot-brew.png / pot-catalyst.png after pot-idle.png). */
export interface PotState {
  /** 'cata' is the catalyst recipe's purple brew. */
  mode: 'brew' | 'cata';
  start: number;
}

/** The heating: six frames of 90 ms, the puff four of 110 ms; the whole brew in this long. */
export const BREW_HEAT_MS = 540;
export const BREW_PUFF_MS = 440;
export const BREW_MS = BREW_HEAT_MS + BREW_PUFF_MS;

/** Which sheet and frame the pot shows `t` ms into a brew (or boiling, after it). */
export function potFrame(state: PotState | null, now: number): { sheet: 'pot-idle' | 'pot-brew' | 'pot-catalyst'; frame: number } {
  if (state) {
    const t = now - state.start;
    const sheet = state.mode === 'cata' ? 'pot-catalyst' : 'pot-brew';
    if (t >= 0 && t < BREW_HEAT_MS) return { sheet, frame: Math.floor(t / 90) };
    if (t >= BREW_HEAT_MS && t < BREW_MS) return { sheet, frame: 6 + Math.min(3, Math.floor((t - BREW_HEAT_MS) / 110)) };
  }
  return { sheet: 'pot-idle', frame: quality.reducedMotion ? 0 : Math.floor(now / 150) % 6 };
}

/** Brings a `canvas.pd-alch-pot` to life: 32×32 pixels shown at 64, boiling, and brewing while `state()` says so. */
export function mountPot(canvas: HTMLCanvasElement, state: () => PotState | null): void {
  canvas.width = 32;
  canvas.height = 32;
  const g = canvas.getContext('2d')!;
  animate(canvas, (now) => {
    const { sheet, frame } = potFrame(state(), now);
    const image = shImage(sheet);
    g.clearRect(0, 0, 32, 32);
    if (loaded(image)) g.drawImage(image, frame * 32, 0, 32, 32, 0, 0, 32, 32);
    canvas.dataset.phase = sheet === 'pot-idle' ? 'idle' : frame < 6 ? 'heat' : 'done';
  });
}

/** `canvas.pd-catalyst` (the catalyst pulsing in the result slot, 6 frames of 120 ms) and `canvas.pd-energy-pile` (4 frames of 200 ms). */
export function mountSprite(canvas: HTMLCanvasElement, sheet: 'catalyst' | 'energy-pile', frames: number, ms: number): void {
  canvas.width = 16;
  canvas.height = 16;
  const g = canvas.getContext('2d')!;
  const image = shImage(sheet);
  animate(canvas, (now) => {
    g.clearRect(0, 0, 16, 16);
    if (loaded(image)) g.drawImage(image, (quality.reducedMotion ? 0 : Math.floor(now / ms) % frames) * 16, 0, 16, 16, 0, 0, 16, 16);
  });
}

/** An energy shard flies in this long; the next thing's shards start a little after (ms). */
export const SHARD_MS = 520;
export const SHARD_GAP_MS = 90;
const SHARDS_EACH = 3;

/**
 * Energy flying to the counter (design v19, PD.alchEnergy): 3 shards from each item in `from` arc to `to`, each item
 * 90 ms after the last, 520 ms in the air; the counter turns green for a moment and «+N» rises over it. Returns how
 * long it all takes (ms), when the counter may change.
 */
export function flyEnergy(root: HTMLElement, from: readonly HTMLElement[], to: HTMLElement, gain: number): number {
  const rr = root.getBoundingClientRect();
  const canvas = document.createElement('canvas');
  canvas.className = 'pd-alch-fly';
  canvas.width = Math.max(1, Math.round(rr.width / 2));
  canvas.height = Math.max(1, Math.round(rr.height / 2));
  canvas.style.width = `${rr.width}px`;
  canvas.style.height = `${rr.height}px`;
  canvas.setAttribute('aria-hidden', 'true');
  root.append(canvas);
  const g = canvas.getContext('2d')!;
  const shard = shImage('energy-shard');
  const end = to.getBoundingClientRect();
  const tx = (end.left - rr.left + 12) / 2;
  const ty = (end.top - rr.top + end.height / 2) / 2;
  const points: Array<{ x: number; y: number; delay: number }> = [];
  from.forEach((node, j) => {
    const box = node.getBoundingClientRect();
    for (let i = 0; i < SHARDS_EACH; i++) {
      points.push({ x: (box.left - rr.left + box.width / 2) / 2 + (i - 1) * 3, y: (box.top - rr.top + box.height / 2) / 2, delay: j * SHARD_GAP_MS + i * 40 });
    }
  });
  const pop = document.createElement('span');
  pop.className = 'pd-energy-pop';
  pop.textContent = `+${gain}`;
  to.append(pop);
  const last = points.length > 0 ? points[points.length - 1]!.delay + SHARD_MS : 0;
  const total = last + 700;
  let start = -1;
  animate(canvas, (now) => {
    if (start < 0) start = now;
    const t = now - start;
    g.clearRect(0, 0, canvas.width, canvas.height);
    for (const p of points) {
      const q = (t - p.delay) / SHARD_MS;
      if (q < 0 || q > 1) continue;
      const e = q * q * (3 - 2 * q);
      const x = p.x + (tx - p.x) * e;
      const y = p.y + (ty - p.y) * e - Math.sin(q * Math.PI) * 30;
      if (loaded(shard)) g.drawImage(shard, (Math.floor(t / 60) % 4) * 7, 0, 7, 7, Math.round(x) - 3, Math.round(y) - 3, 7, 7);
    }
    pop.classList.toggle('on', t > last - 60 && t < last + 700);
    to.classList.toggle('gain', t > last - 60 && t < last + 300);
    if (t >= total) {
      canvas.remove();
      pop.remove();
      to.classList.remove('gain');
    }
  });
  return total;
}

/** Loads what the alchemy window draws. */
export function preloadAlchemy(): void {
  for (const name of ['pot-idle', 'pot-brew', 'pot-catalyst', 'catalyst', 'energy-shard', 'energy-pile']) shImage(name);
}
