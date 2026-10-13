import { drawAura, drawBeams } from './mobfx';
import { HEIGHT, type Level, LENGTH, S, T, WIDTH } from '@pd/core';
import { type Assets, frameAt, ICONS, levelRegion } from './sprites';
import { CHAIN_MS, FALL_MS, type Puppet, TILE, type View } from './view';
import { bossCard, depthCard, floatNumber, levelCard, nameplate, slainCard, waveCard } from './cards';

import { fx } from './fx';
import { CHEST_ANIMS, type HeapLook } from './motion';
import { drawFrame, frameAt as sheetFrame, lookIndex, regionIndex, sheet, tintedImage } from './worldsheets';
import { quality } from './quality';
import { BOLT_FRAME_MS, HEART_MS, loaded, PRISM_PHASE_MS, shImage, WAND_BOLT_ROW, WAND_BOLT_TRAIL } from './shfx';
import { tintSprite, wandFx } from './wandfx';
import { t } from './i18n';
import { flightAngle, glowStrength } from './gearfx';

/** An item's sprite in one colour, kept once made (for ItemSprite.Glowing). */
const tintedItems = new Map<string, HTMLCanvasElement>();
function tintedItem(items: CanvasImageSource, sprite: number, color: string): HTMLCanvasElement {
  const key = `${sprite}|${color}`;
  let canvas = tintedItems.get(key);
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.width = canvas.height = 16;
    const c = canvas.getContext('2d')!;
    c.drawImage(items, (sprite % 16) * 16, Math.floor(sprite / 16) * 16, 16, 16, 0, 0, 16, 16);
    c.globalCompositeOperation = 'source-atop';
    c.fillStyle = color;
    c.fillRect(0, 0, 16, 16);
    tintedItems.set(key, canvas);
  }
  return canvas;
}

/* Canvas renderer for the world, using the original 16px tiles and sprites. */

export const FONT = '"Galmuri11", "Galmuri9", ui-monospace, monospace';
/** How long a boss's title card stays up. */

export interface Camera {
  /** World pixel shown at the canvas's top-left corner. */
  x: number;
  y: number;
  zoom: number;
}

const isWater = (terrain: number): boolean => terrain >= T.WATER_TILES && terrain <= T.WATER;

/** Draws the static tile layer; water is animated underneath it. Redraw when terrain changes. */
export function bakeLevel(level: Level, assets: Assets): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH * TILE;
  canvas.height = HEIGHT * TILE;
  const ctx = canvas.getContext('2d')!;
  const tiles = assets.tiles[levelRegion(level)]!;
  const columns = tiles.width / TILE;
  for (let i = 0; i < LENGTH; i++) {
    const terrain = level.map[i]!;
    const sx = (terrain % columns) * TILE;
    const sy = Math.trunc(terrain / columns) * TILE;
    ctx.drawImage(tiles, sx, sy, TILE, TILE, (i % WIDTH) * TILE, Math.trunc(i / WIDTH) * TILE, TILE, TILE);
  }
  return canvas;
}

/**
 * Brings a baked tile layer up to date with the level, redrawing only the cells that changed
 * (a door opened, grass trampled) rather than all of them; `seen` is the map it was baked from.
 */
export function patchLevel(baked: HTMLCanvasElement, seen: Uint8Array, level: Level, assets: Assets): void {
  const ctx = baked.getContext('2d')!;
  const tiles = assets.tiles[levelRegion(level)]!;
  const columns = tiles.width / TILE;
  for (let i = 0; i < LENGTH; i++) {
    const terrain = level.map[i]!;
    if (seen[i] === terrain) continue;
    seen[i] = terrain;
    const x = (i % WIDTH) * TILE;
    const y = Math.trunc(i / WIDTH) * TILE;
    ctx.clearRect(x, y, TILE, TILE);
    ctx.drawImage(tiles, (terrain % columns) * TILE, Math.trunc(terrain / columns) * TILE, TILE, TILE, x, y, TILE, TILE);
  }
}

function drawIcon(ctx: CanvasRenderingContext2D, assets: Assets, icon: readonly [number, number, number, number], x: number, y: number): void {
  const [sx, sy, w, h] = icon;
  ctx.drawImage(assets.icons, sx, sy, w, h, Math.round(x - w / 2), Math.round(y - h), w, h);
}

/** One texel per cell: the fog's darkness, eased from frame to frame (see drawFog). */
const fogCanvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
let fogDark: Float32Array | null = null;
let fogLevel: Level | null = null;
let fogTime = 0;
/** How quickly a cell comes out of the dark, and how slowly it sinks back (ms to close most of the gap). */
const FOG_REVEAL_MS = 70;
const FOG_FORGET_MS = 260;

function drawFog(ctx: CanvasRenderingContext2D, level: Level, visible: readonly boolean[], explored: readonly boolean[], now: number): void {
  if (!fogCanvas) return;
  const fresh = fogLevel !== level || !fogDark;
  if (fresh) {
    fogCanvas.width = WIDTH;
    fogCanvas.height = HEIGHT;
    fogDark = new Float32Array(LENGTH).fill(1);
    fogLevel = level;
  }
  const dt = fresh ? 0 : Math.min(100, Math.max(0, now - fogTime));
  fogTime = now;
  const fog = fogCanvas.getContext('2d')!;
  const data = fog.createImageData(WIDTH, HEIGHT);
  const reveal = 1 - Math.exp(-dt / FOG_REVEAL_MS);
  const forget = 1 - Math.exp(-dt / FOG_FORGET_MS);
  for (let i = 0; i < LENGTH; i++) {
    const target = visible[i] ? 0 : explored[i] ? 0.55 : 1;
    const dark = fogDark![i]!;
    fogDark![i] = fresh ? target : dark + (target - dark) * (target < dark ? reveal : forget);
    data.data[i * 4 + 3] = Math.round(fogDark![i]! * 255);
  }
  fog.putImageData(data, 0, 0);
  // Drawn up with smoothing: the darkness fades from cell to cell instead of stopping at tile edges.
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(fogCanvas, 0, 0, WIDTH, HEIGHT, 0, 0, WIDTH * TILE, HEIGHT * TILE);
  ctx.restore();
}

/**
 * The finest step on screen, in world pixels: one device pixel. Walkers and
 * the camera move by it rather than by the art's own (much coarser) pixel, so
 * motion glides; every sprite still lands on whole device pixels and stays crisp.
 */
let fine = 1;
const snap = (v: number): number => Math.round(v / fine) * fine;

/** A spinner's cobweb over a cell, 16×16: pale threads from a hub out to the edges, and two rings (made once). */
let web: HTMLCanvasElement | undefined;
function webImage(): HTMLCanvasElement {
  if (web) return web;
  web = document.createElement('canvas');
  web.width = web.height = 16;
  const g = web.getContext('2d')!;
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const dx = x - 7;
      const dy = y - 7;
      const d = Math.hypot(dx, dy);
      const spoke = dx === 0 || dy === 0 || Math.abs(dx) === Math.abs(dy);
      const ring = (Math.round(d) === 3 || Math.round(d) === 6) && (x * 3 + y) % 4 !== 0;
      if (!spoke && !ring) continue;
      g.fillStyle = `rgba(232, 232, 222, ${spoke ? (d < 2 ? 0.95 : 0.7) : 0.5})`;
      g.fillRect(x, y, 1, 1);
    }
  }
  return web;
}

/** A soft pixel puff of gas, 12×12, in a colour (made once per colour). */
const puffs = new Map<string, HTMLCanvasElement>();
function puffImage(color: string): HTMLCanvasElement {
  let image = puffs.get(color);
  if (image) return image;
  image = document.createElement('canvas');
  image.width = image.height = 12;
  const g = image.getContext('2d')!;
  for (let y = 0; y < 12; y++) {
    for (let x = 0; x < 12; x++) {
      const d = Math.hypot(x - 5.5, y - 5.5);
      if (d > 5.6) continue;
      // Thick in the middle, dithered thin at the rim.
      const a = d < 3 ? 0.85 : d < 4.6 ? 0.55 : (x + y) % 2 === 0 ? 0.35 : 0;
      if (!a) continue;
      g.fillStyle = `rgba(${color}, ${a})`;
      g.fillRect(x, y, 1, 1);
    }
  }
  puffs.set(color, image);
  return image;
}

/** The rose's ghost carries a blue light 1.6 cells wide that flickers by 0.06 (design v19: rgba(150, 210, 255, 0.22)). */
function drawGhostLight(ctx: CanvasRenderingContext2D, x: number, y: number, now: number): void {
  const cx = x + TILE / 2;
  const cy = y + TILE / 2 + Math.round(Math.sin(now / 500) * 2);
  const r = TILE * 1.6;
  const a = 0.22 + 0.06 * Math.sin(now / 300);
  const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  glow.addColorStop(0, `rgba(150, 210, 255, ${a})`);
  glow.addColorStop(0.5, `rgba(150, 210, 255, ${a * 0.45})`);
  glow.addColorStop(1, 'rgba(150, 210, 255, 0)');
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = glow;
  ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  ctx.restore();
}

function drawPuppet(ctx: CanvasRenderingContext2D, puppet: Puppet, x: number, y: number, now: number, frozen = false): void {
  const { sheet, anims } = puppet.sprite;
  const anim = puppet.anim === 'idle' && puppet.pumped ? 'pump' : puppet.anim;
  const frame = frameAt(anims[anim], frozen && !puppet.isHero ? 0 : now - puppet.animStart);
  // A prismatic image has a sheet of its own (prismatic.png, design v19): the hero's frames, one row to each of four colour phases.
  const glass = puppet.prismatic === true && loaded(shImage('prismatic'));
  const image = glass ? shImage('prismatic') : sheet.image;
  const sx = glass ? frame * sheet.w : (frame % sheet.cols) * sheet.w;
  const sy = glass ? (Math.floor(now / PRISM_PHASE_MS) % 4) * sheet.h : (Math.floor(frame / sheet.cols) + puppet.row) * sheet.h;
  // The rose's ghost sways by two pixels (design v19: ShMapFx).
  const sway = puppet.kind === 'ghostHero' ? Math.round(Math.sin(now / 500) * 2) : 0;
  // A melee lunge: forward and back again in a blink.
  const lunge = puppet.lungeStart !== undefined && now - puppet.lungeStart < LUNGE_MS ? Math.sin((Math.PI * (now - puppet.lungeStart)) / LUNGE_MS) : 0;
  const knock = knockback(puppet, now);
  const dx = snap(x + (TILE - sheet.w) / 2 + lunge * (puppet.lungeX ?? 0)) + knock * (puppet.knockX ?? 0);
  // Floating: a few pixels up, bobbing slowly, with its shadow left on the floor.
  const hover = (puppet.levitating && puppet.alive ? 4 + Math.round(Math.sin(now / 320)) : 0)
    // WardSprite.update: a sentry rises and sinks a pixel, slowly (sin of the time in seconds).
    + (puppet.bob && puppet.alive ? Math.round(Math.sin(now / 1000)) : 0);
  const dy = snap(y + TILE - sheet.h + lunge * (puppet.lungeY ?? 0)) + knock * (puppet.knockY ?? 0) - hover + sway;
  if (hover) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.fillRect(snap(x + 4), snap(y + TILE - 2), 8, 2);
    ctx.fillRect(snap(x + 5), snap(y + TILE - 3), 6, 1);
  }

  drawAura(ctx, puppet, x, y, now);
  ctx.save();
  if (puppet.invisible) ctx.globalAlpha = 0.4;
  if (puppet.alpha !== undefined) ctx.globalAlpha = puppet.alpha;
  // The rose's ghost is seen through (design v19: 0.82), with its blue light under it (drawGhostLight).
  if (puppet.kind === 'ghostHero' && !puppet.invisible && puppet.alpha === undefined) ctx.globalAlpha = 0.82;
  // timeFreeze.fx: while the hero freezes time, everything else stands still and grey (State.PARALYSED).
  if (frozen && !puppet.isHero) ctx.filter = 'grayscale(1) brightness(0.8)';
  if (puppet.fallStart !== undefined) {
    // MobSprite.fall: into a chasm, spinning (720 degrees a second, one way or the other) and
    // shrinking away to nothing about the middle of its feet' cell, fading as it goes.
    const k = Math.min(1, Math.max(0, (now - puppet.fallStart) / FALL_MS));
    const cx = x + TILE / 2;
    const cy = y + TILE / 2;
    const turn = (puppet.id.charCodeAt(puppet.id.length - 1) % 2 === 0 ? -1 : 1) * 4 * Math.PI * ((now - puppet.fallStart) / 1000);
    ctx.globalAlpha = 1 - k;
    ctx.translate(cx, cy);
    ctx.rotate(quality.reducedMotion ? 0 : turn);
    ctx.scale(1 - k, 1 - k);
    ctx.translate(-cx, -cy);
  } else if (!puppet.alive) {
    if (puppet.isHero) {
      ctx.globalAlpha = 0.75;
    } else if (!puppet.laid) {
      const left = puppet.removeAt - now;
      ctx.globalAlpha = Math.max(0, Math.min(1, left / 700));
    }
  }
  if (puppet.flip) {
    ctx.translate(dx + sheet.w, dy);
    ctx.scale(-1, 1);
  } else {
    ctx.translate(dx, dy);
  }
  ctx.drawImage(image, sx, sy, sheet.w, sheet.h, 0, 0, sheet.w, sheet.h);
  if (puppet.sprite.brightness !== undefined) {
    // CharSprite.brightness: darker, its own pixels only.
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = `rgba(0, 0, 0, ${1 - puppet.sprite.brightness})`;
    ctx.fillRect(0, 0, sheet.w, sheet.h);
    ctx.globalCompositeOperation = 'source-over';
  }
  if (puppet.alive) {
    // IceBlock: tinted (0.83, 1.17, 1.33) at 0.6. DarkBlock: brightness 0.4. WardSprite.resetColor: a ward dims as it shoots.
    if (puppet.frozen) tintSprite(ctx, image, sx, sy, sheet.w, sheet.h, 'rgb(212, 255, 255)', 0.6);
    else if (puppet.darkened) tintSprite(ctx, image, sx, sy, sheet.w, sheet.h, '#000000', 0.6);
    else if (puppet.dim !== undefined && puppet.dim < 1) tintSprite(ctx, image, sx, sy, sheet.w, sheet.h, '#000000', 1 - puppet.dim);
    if (puppet.shielded) {
      // ShieldHalo: a soft glow of 0xBBAACC about the sprite, as wide as its diagonal.
      const r = Math.hypot(sheet.w / 2, sheet.h / 2);
      const halo = ctx.createRadialGradient(sheet.w / 2, sheet.h / 2, 0, sheet.w / 2, sheet.h / 2, r);
      halo.addColorStop(0, 'rgba(187, 170, 204, 0.4)');
      halo.addColorStop(1, 'rgba(187, 170, 204, 0)');
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = halo;
      ctx.fillRect(sheet.w / 2 - r, sheet.h / 2 - r, r * 2, r * 2);
      ctx.globalCompositeOperation = 'source-over';
    }
  }
  if (now < puppet.flashUntil) {
    // Hit flash: adding the sprite onto itself brightens only its own pixels.
    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(image, sx, sy, sheet.w, sheet.h, 0, 0, sheet.w, sheet.h);
    ctx.drawImage(image, sx, sy, sheet.w, sheet.h, 0, 0, sheet.w, sheet.h);
  } else if (puppet.pumped && puppet.alive) {
    // A pumped-up Goo throbs.
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.35 + 0.35 * Math.sin(now / 60);
    ctx.drawImage(image, sx, sy, sheet.w, sheet.h, 0, 0, sheet.w, sheet.h);
  }
  ctx.restore();
}

const LUNGE_MS = 150;
/** A blow knocks the struck back and they spring back in this long. */
const KNOCK_MS = 120;

/**
 * How far along its knock-back a struck character is, 1 to 0: thrown the whole
 * way at once, held a moment, then back in whole steps (knockX and knockY are
 * whole pixels), as pixel art moves.
 */
function knockback(puppet: Puppet, now: number): number {
  if (puppet.knockStart === undefined) return 0;
  const k = (now - puppet.knockStart) / KNOCK_MS;
  if (k < 0 || k >= 1) return 0;
  const back = k < 0.25 ? 1 : 1 - (k - 0.25) / 0.75;
  const reach = Math.max(Math.abs(puppet.knockX ?? 0), Math.abs(puppet.knockY ?? 0)) || 1;
  return Math.round(back * reach) / reach;
}

function drawHealth(ctx: CanvasRenderingContext2D, puppet: Puppet, x: number, y: number): void {
  const top = snap(y + TILE - puppet.sprite.sheet.h - 3);
  const left = snap(x + 2);
  const width = TILE - 4;
  ctx.fillStyle = '#000';
  ctx.fillRect(left - 0.5, top - 0.5, width + 1, 2);
  ctx.fillStyle = '#cc0000';
  ctx.fillRect(left, top, width, 1);
  ctx.fillStyle = '#00ee00';
  ctx.fillRect(left, top, Math.max(0, Math.round((width * puppet.hp) / puppet.ht)), 1);
}

export interface Scene {
  level: Level;
  baked: HTMLCanvasElement;
  visible: readonly boolean[];
  explored: readonly boolean[];
  /** Items lying around, with their sprite index in items.png, and the colour of their glow, if magic. */
  heaps: ReadonlyArray<{ pos: number; sprite: number; aura?: string; glow?: { color: string; period: number } }>;
  /** Plants growing here, with their index in plants.png. */
  plants?: ReadonlyArray<{ pos: number; index: number }>;
  /** Clouds of gas: how much is in each cell, and its colour. */
  gas?: ReadonlyArray<{ pos: number; volume: number; color: string }>;
  /** Spinners' webs, and how much is left of each. */
  webs?: ReadonlyArray<{ pos: number; volume: number }>;
  /** Mind vision: every monster on the level shows. */
  seeAll: boolean;
  /** Where an altar's sacrificial fire burns, while it does. */
  altar?: number;
  /** The hero's position in world pixels, around which the view is lit. */
  focus?: { x: number; y: number };
  /** Pools of light: torches and whatever burns. */
  lights?: ReadonlyArray<{ x: number; y: number; radius: number; color: string; strength: number }>;
  /** The hero has fallen: how far the world has drained of colour, 0 to 1. */
  mourning?: number;
  /** The middle of the band the HUD and toolbar leave free, in device pixels. */
  middle?: number;
  /** Where the cards (a new region, a boss) go, in device pixels: above the hero, in the band's upper part. */
  cardY?: number;
  /** How each heap moves this frame: dropping in, bouncing (motion.ts). */
  heapLook?: (pos: number, now: number) => HeapLook;
  /** Drawn over the floor, under what lies on it: doors swinging, grass swaying, rings on water (motion.ts). */
  under?: (ctx: CanvasRenderingContext2D) => void;
  /** Drawn over what lies on the floor, under the characters: glints, coins in the air (motion.ts). */
  over?: (ctx: CanvasRenderingContext2D) => void;
}

export function render(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  view: View,
  myId: string,
  assets: Assets,
  camera: Camera,
  now: number,
): void {
  const { level, baked, visible, explored } = scene;
  const { canvas } = ctx;
  ctx.imageSmoothingEnabled = false;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  fine = 1 / camera.zoom;
  ctx.setTransform(camera.zoom, 0, 0, camera.zoom, -Math.round(camera.x * camera.zoom), -Math.round(camera.y * camera.zoom));

  // Slowly drifting water under the transparent parts of water tiles.
  const water = assets.water[levelRegion(level)]!;
  const pattern = ctx.createPattern(water, 'repeat')!;
  const drift = (now / 120) % water.width;
  pattern.setTransform(new DOMMatrix().translate(drift, drift * 0.5));
  ctx.fillStyle = pattern;
  for (let i = 0; i < LENGTH; i++) {
    if (isWater(level.map[i]!)) {
      ctx.fillRect((i % WIDTH) * TILE, Math.trunc(i / WIDTH) * TILE, TILE, TILE);
    }
  }
  ctx.drawImage(baked, 0, 0);

  // Items on the floor, remembered (and dimmed by the fog) once seen.
  for (const plant of scene.plants ?? []) {
    if (!explored[plant.pos]) continue;
    ctx.drawImage(assets.plants, plant.index * 16, 0, 16, 16, (plant.pos % WIDTH) * TILE, Math.trunc(plant.pos / WIDTH) * TILE, 16, 16);
  }
  // What fights left on the floor (blood, chunks, bodies), under what lies there: remembered
  // where the party has been, and dimmed with the rest of it by the fog.
  fx.drawDecals(ctx, now, (x, y) => explored[Math.trunc(y / TILE) * WIDTH + Math.trunc(x / TILE)] === true);
  scene.under?.(ctx);
  for (const heap of scene.heaps) {
    if (!explored[heap.pos]) continue;
    const look = visible[heap.pos] ? scene.heapLook?.(heap.pos, now) : undefined;
    if (look?.hidden) continue;
    const x = (heap.pos % WIDTH) * TILE;
    const y = Math.trunc(heap.pos / WIDTH) * TILE;
    // Things on the floor breathe a little (by device pixels, so smoothly), and cast a soft shadow.
    const breath = visible[heap.pos] && !quality.reducedMotion ? Math.sin(now / 520 + heap.pos) * 0.5 : 0;
    const lift = -(look?.dy ?? 0) - breath;
    ctx.fillStyle = `rgba(0, 0, 0, ${0.3 - Math.min(0.2, lift * 0.02)})`;
    ctx.beginPath();
    ctx.ellipse(x + TILE / 2, y + TILE - 2.5, 4.5 - Math.min(2, lift * 0.2), 1.3, 0, 0, Math.PI * 2);
    ctx.fill();
    // Magic lying about (rings, wands) glows softly from below, in its colour.
    const glints = sheet('glint');
    if (heap.aura && glints?.anims.aura && visible[heap.pos]) {
      const frame = sheetFrame(glints.anims.aura, quality.reducedMotion ? 0 : now + heap.pos * 97, true);
      ctx.globalAlpha = 0.8;
      ctx.drawImage(tintedImage(glints, heap.aura), frame.x, frame.y, frame.w, frame.h, x, y - 1, 16, 16);
      ctx.globalAlpha = 1;
    }
    ctx.save();
    ctx.translate(snap(x + TILE / 2 + (look?.dx ?? 0)), snap(y + TILE - 1 - lift));
    if (look) ctx.scale(look.scaleX, look.scaleY);
    // A closed chest, tomb or remains is drawn from the sheet its opening plays from, so the two match.
    const chests = sheet('chests');
    const closed = CHEST_ANIMS.get(heap.sprite);
    const first = closed ? chests?.anims[closed]?.[0] : undefined;
    // A heap of energy crystals glints in four frames of 200 ms (design v19: energy-pile.png).
    if (heap.sprite === S.ENERGY && loaded(shImage('energy-pile'))) ctx.drawImage(shImage('energy-pile'), (quality.reducedMotion ? 0 : Math.floor(now / 200) % 4) * 16, 0, 16, 16, -8, -16, 16, 16);
    else if (chests && first) ctx.drawImage(chests.image, first.x, first.y, 16, 16, -8, -16, 16, 16);
    else ctx.drawImage(assets.items, (heap.sprite % 16) * 16, Math.floor(heap.sprite / 16) * 16, 16, 16, -8, -16, 16, 16);
    // ItemSprite.Glowing: the sprite swells towards its glow's colour and back.
    if (heap.glow && visible[heap.pos]) {
      ctx.globalAlpha = quality.reducedMotion ? 0.3 : glowStrength(now, heap.glow.period);
      ctx.drawImage(tintedItem(assets.items, heap.sprite, heap.glow.color), -8, -16);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }
  scene.over?.(ctx);

  // The sacrificial fire: a flickering blue flame on its pedestal (SacrificialParticle).
  const ambient = sheet(`ambient${levelRegion(level)}`);
  if (scene.altar !== undefined && explored[scene.altar] && ambient?.anims.altar) {
    drawFrame(ctx, ambient, sheetFrame(ambient.anims.altar, now, true), (scene.altar % WIDTH) * TILE, Math.trunc(scene.altar / WIDTH) * TILE - 4);
  } else if (scene.altar !== undefined && explored[scene.altar]) {
    const x = (scene.altar % WIDTH) * TILE + TILE / 2;
    const y = Math.trunc(scene.altar / WIDTH) * TILE + TILE / 2;
    const flicker = 0.75 + 0.25 * Math.sin(now / 90) * Math.sin(now / 37);
    const glow = ctx.createRadialGradient(x, y - 3, 0, x, y - 3, 9);
    glow.addColorStop(0, `rgba(200, 240, 255, ${0.9 * flicker})`);
    glow.addColorStop(0.4, `rgba(68, 136, 238, ${0.6 * flicker})`);
    glow.addColorStop(1, 'rgba(68, 136, 238, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(x - 9, y - 12, 18, 18);
  }

  // Freshly discovered secrets glow for a moment.
  for (const flash of view.flashes) {
    const fade = 1 - (now - flash.start) / (flash.duration ?? 600);
    ctx.fillStyle = `rgba(${flash.color ?? '255, 255, 200'}, ${0.6 * fade})`;
    ctx.fillRect((flash.cell % WIDTH) * TILE, Math.trunc(flash.cell / WIDTH) * TILE, TILE, TILE);
  }

  // Spinners' webs where they can be seen (Web, a WebParticle in the original): a pale cobweb over
  // the cell, fading as it wears away.
  for (const strand of scene.webs ?? []) {
    if (!visible[strand.pos]) continue;
    ctx.globalAlpha = Math.min(0.85, 0.3 + strand.volume * 0.1);
    const flip = strand.pos % 2 === 0;
    const wx = (strand.pos % WIDTH) * TILE;
    const wy = Math.trunc(strand.pos / WIDTH) * TILE;
    if (flip) {
      ctx.save();
      ctx.translate(wx + TILE, wy);
      ctx.scale(-1, 1);
      ctx.drawImage(webImage(), 0, 0);
      ctx.restore();
    } else {
      ctx.drawImage(webImage(), wx, wy);
    }
  }
  ctx.globalAlpha = 1;

  // Gas where it can be seen: a faint haze over the cell and puffs drifting in it, thicker where
  // there is more (the original's Speck clouds), never flat squares.
  for (const cloud of scene.gas ?? []) {
    if (!visible[cloud.pos]) continue;
    const cx = (cloud.pos % WIDTH) * TILE;
    const cy = Math.trunc(cloud.pos / WIDTH) * TILE;
    const thick = Math.min(1, 0.25 + cloud.volume / 60);
    ctx.fillStyle = `rgba(${cloud.color}, ${0.1 * thick})`;
    ctx.fillRect(cx, cy, TILE, TILE);
    const puff = puffImage(cloud.color);
    const drift = quality.reducedMotion ? 0 : now;
    const puffs = quality.light ? 1 : 2;
    for (let i = 0; i < puffs; i++) {
      const seed = cloud.pos * 7 + i * 13;
      const px = cx + 2 + Math.sin(drift / (900 + i * 300) + seed) * 4;
      const py = cy + 1 + Math.cos(drift / (1100 + i * 250) + seed * 1.3) * 3 - i * 2;
      ctx.globalAlpha = Math.min(0.75, 0.3 + 0.45 * thick) * (0.8 + 0.2 * Math.sin(drift / 500 + seed));
      ctx.drawImage(puff, Math.round(px), Math.round(py));
    }
    ctx.globalAlpha = 1;
  }

  // The region's mist, drifting slowly over what can be seen (the dark of the fog covers the rest).
  const mist = sheet(`fog${levelRegion(level)}`);
  if (mist && !quality.light) {
    const pattern = ctx.createPattern(mist.image, 'repeat');
    if (pattern) {
      const drift = quality.reducedMotion ? 0 : now / 1000;
      pattern.setTransform(new DOMMatrix().translate(drift * 6, drift * 3));
      ctx.fillStyle = pattern;
      const left = Math.max(0, camera.x);
      const top = Math.max(0, camera.y);
      ctx.fillRect(left, top, Math.min(WIDTH * TILE, camera.x + canvas.width / camera.zoom) - left, Math.min(HEIGHT * TILE, camera.y + canvas.height / camera.zoom) - top);
    }
  }

  // Pools of warm light, added onto what is lit (the dark then covers what is not in sight): the
  // design's dithered light, tinted the fire's colour; a gradient until it has loaded.
  ctx.globalCompositeOperation = 'lighter';
  const lightSheet = sheet('light');
  const lightFrame = lightSheet?.anims.light?.[0];
  for (const light of quality.light ? [] : scene.lights ?? []) {
    if (lightSheet && lightFrame) {
      ctx.globalAlpha = Math.min(1, light.strength * 2.6);
      ctx.drawImage(
        tintedImage(lightSheet, `rgb(${light.color})`), lightFrame.x, lightFrame.y, lightFrame.w, lightFrame.h,
        light.x - light.radius, light.y - light.radius, light.radius * 2, light.radius * 2,
      );
      ctx.globalAlpha = 1;
      continue;
    }
    const glow = ctx.createRadialGradient(light.x, light.y, 0, light.x, light.y, light.radius);
    glow.addColorStop(0, `rgba(${light.color}, ${light.strength})`);
    glow.addColorStop(1, `rgba(${light.color}, 0)`);
    ctx.fillStyle = glow;
    ctx.fillRect(light.x - light.radius, light.y - light.radius, light.radius * 2, light.radius * 2);
  }
  ctx.globalCompositeOperation = 'source-over';

  // Fog of war: unexplored cells are black, remembered ones are dimmed, and the
  // edges between are soft. Each cell's darkness eases toward what it should be,
  // so what comes into sight surfaces quickly and what leaves it sinks slowly.
  drawFog(ctx, level, visible, explored, now);

  const seen = (x: number, y: number): boolean => visible[Math.trunc(y / TILE) * WIDTH + Math.trunc(x / TILE)] === true;

  // Characters, back to front. Monsters only show where the party can see.
  const shown = [...view.puppets.values()]
    .filter((puppet) => puppet.isHero || scene.seeAll || visible[puppet.to] || visible[puppet.from] || (puppet.aim !== undefined && visible[puppet.aim]))
    .map((puppet) => {
      // On whole screen pixels, as the map is: a walker between them shimmered against the floor.
      const at = view.position(puppet, now);
      return { puppet, x: Math.round(at.x * camera.zoom) / camera.zoom, y: Math.round(at.y * camera.zoom) / camera.zoom };
    })
    .sort((a, b) => Number(a.puppet.alive) - Number(b.puppet.alive) || a.y - b.y);
  for (const { puppet, x, y } of shown) {
    if (puppet.kind === 'ghostHero' && puppet.alive) drawGhostLight(ctx, x, y, now);
    drawPuppet(ctx, puppet, x, y, now, view.timeFrozen);
  }

  for (const { puppet, x, y } of shown) {
    if (!puppet.alive) continue;
    const top = y + TILE - puppet.sprite.sheet.h - 1;
    if (puppet.sleeping) {
      drawIcon(ctx, assets, ICONS.sleep, x + TILE - 2, top + Math.sin(now / 400) * 1.5);
    } else if (now < puppet.alertUntil) {
      drawIcon(ctx, assets, ICONS.alert, x + TILE / 2, top - 2);
    }
    if (puppet.hp < puppet.ht && !(puppet.isHero && puppet.id === myId)) drawHealth(ctx, puppet, x, y);
    // An ally wears a heart over its head (design v19: ally-heart.png, two frames of 7×7 every 400 ms, the second a pixel lower).
    if (puppet.ally && loaded(shImage('ally-heart'))) {
      const beat = Math.floor(now / HEART_MS) % 2;
      const sway = puppet.kind === 'ghostHero' ? Math.round(Math.sin(now / 500) * 2) : 0;
      ctx.drawImage(shImage('ally-heart'), beat * 7, 0, 7, 7, snap(x + (TILE - 7) / 2), top - 7 + beat + sway, 7, 7);
    }
  }

  // Thrown weapons and magic bolts in flight.
  for (const p of view.projectiles) {
    const k = Math.min(1, (now - p.start) / p.duration);
    const x = ((p.from % WIDTH) + ((p.to % WIDTH) - (p.from % WIDTH)) * k) * TILE + TILE / 2;
    const y = (Math.trunc(p.from / WIDTH) + (Math.trunc(p.to / WIDTH) - Math.trunc(p.from / WIDTH)) * k) * TILE + TILE / 2;
    const boltRow = p.sprite === null && p.trail ? WAND_BOLT_ROW[p.trail] : undefined;
    if (boltRow !== undefined && loaded(shImage('wand-bolts'))) {
      // A wand's bolt (design v19, wand-bolts.png): two frames of 8×8 at 90 ms, four squares of the wand's colour behind it.
      const dx = ((p.to % WIDTH) - (p.from % WIDTH)) * TILE;
      const dy = (Math.trunc(p.to / WIDTH) - Math.trunc(p.from / WIDTH)) * TILE;
      const length = Math.hypot(dx, dy) || 1;
      if (!quality.light) {
        ctx.fillStyle = WAND_BOLT_TRAIL[boltRow]!;
        for (let j = 1; j < 5; j++) {
          ctx.globalAlpha = 0.5 - j * 0.1;
          ctx.fillRect(Math.round(x - (dx / length) * j * 2.5) - 1, Math.round(y - (dy / length) * j * 2.5) - 1, 2, 2);
        }
        ctx.globalAlpha = 1;
      }
      ctx.drawImage(shImage('wand-bolts'), (Math.floor(now / BOLT_FRAME_MS) % 2) * 8, boltRow * 8, 8, 8, Math.round(x) - 4, Math.round(y) - 4, 8, 8);
    } else if (p.sprite === null && p.trail) {
      // MagicMissile: no body of its own, only the particles it pours (wandfx.ts) about a bright point.
      ctx.fillStyle = `rgba(${p.color ?? '255, 255, 255'}, 0.6)`;
      ctx.fillRect(Math.round(x) - 2, Math.round(y) - 2, 4, 4);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(Math.round(x) - 1, Math.round(y) - 1, 2, 2);
    } else if (p.sprite === null) {
      ctx.fillStyle = `rgba(${p.color ?? '120, 180, 255'}, 0.5)`;
      ctx.fillRect(Math.round(x) - 3, Math.round(y) - 3, 6, 6);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(Math.round(x) - 1, Math.round(y) - 1, 2, 2);
    } else {
      // A thrown thing flies in an arc, higher the farther it goes, its shadow running along the floor; a thrown weapon
      // straight, spinning or pointing along its way (MissileSprite).
      const cells = Math.max(Math.abs((p.to % WIDTH) - (p.from % WIDTH)), Math.abs(Math.trunc(p.to / WIDTH) - Math.trunc(p.from / WIDTH)));
      const height = p.flight?.straight ? 0 : Math.sin(k * Math.PI) * Math.min(14, 2 + cells * 2.5);
      ctx.fillStyle = `rgba(0, 0, 0, ${0.28 - height * 0.01})`;
      ctx.beginPath();
      ctx.ellipse(x, y + 6, 4 - height * 0.12, 1.3, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.save();
      ctx.translate(snap(x), snap(y - height));
      if (p.flight) {
        const dx = (p.to % WIDTH) - (p.from % WIDTH);
        const dy = Math.trunc(p.to / WIDTH) - Math.trunc(p.from / WIDTH);
        const { angle, flip } = flightAngle(dx, dy);
        const spun = quality.reducedMotion ? 0 : (p.flight.spin * (flip ? -1 : 1) * (now - p.start)) / 1000;
        ctx.rotate(angle + (spun * Math.PI) / 180);
        if (flip) ctx.scale(-1, 1);
      } else {
        ctx.rotate(k * Math.PI * 4);
      }
      ctx.drawImage(assets.items, (p.sprite % 16) * 16, Math.floor(p.sprite / 16) * 16, 16, 16, -8, -8, 16, 16);
      ctx.restore();
    }
  }

  drawBeams(ctx, view, now);
  // The ethereal chain (design v19: chain-link.png, a link every 5 px along the line, turned its way, the two frames
  // taking turns; chain-hook.png at the tip with a blue flash): it flies out from the hero to where it was thrown, then
  // pulls (the target moves with the action) and is gone.
  view.chains = view.chains.filter((c) => now - c.start < c.duration);
  const link = shImage('chain-link');
  const hook = shImage('chain-hook');
  for (const c of view.chains) {
    const elapsed = now - c.start;
    const k = elapsed < CHAIN_MS ? elapsed / CHAIN_MS : 1 - (elapsed - CHAIN_MS) / (c.duration - CHAIN_MS);
    const fx0 = (c.from % WIDTH) * TILE + TILE / 2;
    const fy0 = Math.trunc(c.from / WIDTH) * TILE + TILE / 2;
    const dx = ((c.to % WIDTH) * TILE + TILE / 2) - fx0;
    const dy = (Math.trunc(c.to / WIDTH) * TILE + TILE / 2) - fy0;
    const length = Math.hypot(dx, dy);
    const angle = Math.atan2(dy, dx);
    const fade = 1;
    const reach = length * k;
    ctx.save();
    ctx.globalAlpha = fade;
    const links = Math.floor(reach / 5);
    if (loaded(link)) {
      for (let i = 0; i < links; i++) {
        ctx.save();
        ctx.translate(snap(fx0 + Math.cos(angle) * i * 5), snap(fy0 + Math.sin(angle) * i * 5));
        ctx.rotate(angle);
        ctx.drawImage(link, (i % 2) * 6, 0, 6, 4, -3, -2, 6, 4);
        ctx.restore();
      }
    }
    const tipX = fx0 + Math.cos(angle) * reach;
    const tipY = fy0 + Math.sin(angle) * reach;
    ctx.globalCompositeOperation = 'lighter';
    const glow = ctx.createRadialGradient(tipX, tipY, 0, tipX, tipY, 9);
    glow.addColorStop(0, 'rgba(120, 216, 255, 0.35)');
    glow.addColorStop(0.5, 'rgba(120, 216, 255, 0.16)');
    glow.addColorStop(1, 'rgba(120, 216, 255, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(tipX - 9, tipY - 9, 18, 18);
    ctx.globalCompositeOperation = 'source-over';
    if (loaded(hook)) {
      ctx.translate(snap(tipX), snap(tipY));
      ctx.rotate(angle + Math.PI / 2);
      ctx.drawImage(hook, -3.5, -3.5, 7, 7);
    }
    ctx.restore();
  }

  fx.draw(ctx, now, seen);
  // Beams, lightning's arcs, the blast wave's ripple.
  wandFx.draw(ctx, now);

  // Floating numbers and words, drawn at screen resolution so text stays crisp.
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  // Fallen, the hero sees the world drain of colour.
  if (scene.mourning) {
    ctx.globalCompositeOperation = 'saturation';
    ctx.fillStyle = `rgba(128, 128, 128, ${scene.mourning})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = `rgba(0, 0, 0, ${scene.mourning * 0.3})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  // Device pixels per CSS pixel: the cards' sizes are in CSS pixels, as in the design system.
  const px = canvas.width / (canvas.clientWidth || canvas.width);
  // Companions' names above their heads, in the colour co-op wears everywhere.
  for (const { puppet, x, y } of shown) {
    if (!puppet.label || !puppet.alive) continue;
    const sx = (x + TILE / 2 - camera.x) * camera.zoom;
    const top = (y + TILE - puppet.sprite.sheet.h - camera.y) * camera.zoom;
    nameplate(ctx, puppet.label, sx, top, px, { patron: puppet.look?.patron });
  }
  ctx.globalAlpha = 1;

  // Numbers and words rising over characters (PD.fx.number): damage red, healing green, words in their colour.
  for (const floater of view.floaters) {
    const sx = (floater.x - camera.x) * camera.zoom;
    const sy = (floater.y - camera.y) * camera.zoom;
    const numeric = /^\d+$/.test(floater.text);
    const scale = floater.scale ?? 1;
    const kind = floater.word ? 'word' : numeric ? (scale >= 2 ? 'kill' : scale > 1 ? 'big' : 'damage') : /^\+\d+$/.test(floater.text) ? 'heal' : 'word';
    floatNumber(ctx, floater.text, kind, floater.color, sx, sy, now - floater.start, px);
  }
  ctx.globalAlpha = 1;

  // The hero's light, the view's edges sinking into the dark, is a layer over the canvas (#vignette, main.ts).
  fx.drawScreen(ctx, canvas.width, canvas.height, now);

  const middle = scene.cardY ?? scene.middle ?? canvas.height / 2;

  // My level-up: the new level, golden, three tiles over the hero.
  const card = view.levelCard;
  if (card && scene.focus) {
    const x = (scene.focus.x - camera.x) * camera.zoom;
    const y = (scene.focus.y - camera.y) * camera.zoom - TILE * camera.zoom * 3;
    if (!levelCard(ctx, t.levelCard(card.lvl), x, y, now - card.start, px)) view.levelCard = null;
  }

  // A new region on the way down: «Depth 6» and the region's name beside its emblem.
  const descent = view.depthCard;
  const emblems = sheet('ui-map');
  if (descent && emblems) {
    const region = descent.region ?? regionIndex(descent.depth);
    const text = descent.intro ? (t.meta.intros[region] ?? '') : '';
    // The arena's sinking card says the region and «The arena sinks deeper» (its own words).
    const title = descent.title ?? t.depthTitle(descent.depth);
    const sub = descent.sub ?? t.regionNames[region] ?? '';
    if (!depthCard(ctx, title, sub, emblems.image, region, middle, canvas.width, now - descent.start, px, undefined, text)) {
      view.depthCard = null;
    }
  }

  // The arena's wave banner, once its time has come (after the sinking card, if both came at once).
  const wave = view.waveCard;
  if (wave && now >= wave.start && !waveCard(ctx, wave.title, wave.sub, wave.kind, middle, canvas.width, now - wave.start, px)) {
    view.waveCard = null;
  }

  // A boss's title card as it notices the party: its name and epithet on a band across the free middle.
  const intro = view.bossIntro;
  if (intro && !bossCard(ctx, t.mobs[intro.kind].toUpperCase(), t.bossEpithets[intro.kind] ?? '', middle, canvas.width, now - intro.start, px)) {
    view.bossIntro = null;
  }

  // «Boss slain», white for a frame, then gold.
  if (view.bannerStart > 0 && !slainCard(ctx, t.bossDown, canvas.width / 2, middle, now - view.bannerStart, px)) view.bannerStart = 0;
}
