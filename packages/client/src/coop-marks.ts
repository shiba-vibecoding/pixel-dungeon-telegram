import { type EmoteKind, EMOTES, type HeroClass, isAlive, type Signal, WIDTH, type World } from '@pd/core';
import './coop.css';
import { audio } from './audio';
import { t } from './i18n';
import { quality } from './quality';
import type { Camera } from './render';
import type { Session } from './session';
import { type Puppet, TILE, type View } from './view';
import { type Frame, frameAt, sheet, type Sheet, tintedImage } from './worldsheets';

/*
 * Co-op signals and markers (Claude Design's «Живой мир», part 8), all outside
 * the world: the room relays them and forgets them. A long press on the map
 * pings a cell (main.ts); a button under the HUD opens the party's emotes.
 * Over the drawn map: pings where they were made (an arrow at the edge if that
 * is off screen), emotes over heads, a flame over a fallen companion, and, for
 * each companion out of view, a marker at the edge pointing their way.
 *
 * Everything here is drawn after the world, in device pixels: the map's art at
 * the camera's zoom, the edge markers at the UI's scale (two CSS pixels to the
 * art's pixel, like the HUD).
 */

/** The colour co-op wears everywhere (the design system's --ally); my own signals are gold, so I can tell them apart. */
const ALLY = '#5ec8c0';
const MINE = '#ffeba4';

/** How long an emote stays over a head, and the design system's frame (cards move by 66 ms steps). */
const EMOTE_MS = 1500;
const STEP_MS = 66;
/** A ping plays its animation this many times over, so a glance can catch it. */
const PING_PLAYS = 3;
/** How long an off-screen ping keeps an arrow at the edge. */
const PING_ARROW_MS = 2000;
/** Signals that waited longer than this to be shown (a tab in the background) are dropped. */
const STALE_MS = 1500;

const PORTRAITS: Record<HeroClass, number> = { warrior: 0, mage: 1, rogue: 2, huntress: 3, duelist: 4, cleric: 5 };

interface Ping {
  from: string;
  depth: number;
  cell: number;
  start: number;
}

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface CoopFrame {
  session: Session;
  world: World;
  view: View;
  camera: Camera;
  /** The band the HUD and toolbar leave free, in CSS pixels from the top (Hud.freeZone). */
  free: { top: number; bottom: number };
  /** The visual clock (fx.time), as the view's puppets move by. */
  now: number;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  node.className = className;
  return node;
};

/** An emote from coop.png, drawn by CSS (coop.css) at two or three times its size. */
const emoteGlyph = (index: number): HTMLElement => {
  const glyph = el('i', 'pd-emote');
  glyph.style.setProperty('--e', String(index));
  return glyph;
};

export class CoopMarks {
  private pings: Ping[] = [];
  /** The emote showing over each hero, by hero id: a new one replaces the last. */
  private readonly emotes = new Map<string, { emote: EmoteKind; start: number }>();
  private readonly root: HTMLElement;
  private readonly toggle: HTMLButtonElement;
  private readonly panel: HTMLElement;
  private session: Session | null = null;

  /** @param host the HUD's layer (#ui): the button hides with the HUD. */
  constructor(host: HTMLElement) {
    this.root = el('div', 'pd-coopctl');
    this.root.hidden = true;
    // Absolute: a relative url() in a custom property would resolve against the stylesheet that uses it
    // (built into assets/), not against the page.
    const sheetUrl = new URL(`${import.meta.env.BASE_URL}assets/world/coop.png`, document.baseURI).href;
    this.root.style.setProperty('--coop-sheet', `url("${sheetUrl}")`);
    this.toggle = el('button', 'pd-tool pd-signal');
    this.toggle.ariaLabel = t.signalsLabel;
    this.toggle.setAttribute('aria-haspopup', 'menu');
    this.toggle.setAttribute('aria-expanded', 'false');
    this.toggle.append(emoteGlyph(EMOTES.indexOf('here')));
    this.toggle.onclick = () => {
      audio.play('click');
      this.open(this.panel.hidden !== false);
    };
    this.panel = el('div', 'pd-emotes');
    this.panel.setAttribute('role', 'menu');
    this.panel.hidden = true;
    EMOTES.forEach((emote, i) => {
      const button = el('button', 'pd-tool');
      button.setAttribute('role', 'menuitem');
      button.ariaLabel = t.emotes[emote];
      button.title = t.emotes[emote];
      button.append(emoteGlyph(i));
      button.onclick = () => {
        audio.play('click');
        this.session?.signal({ kind: 'emote', emote });
        this.open(false);
      };
      this.panel.append(button);
    });
    this.root.append(this.toggle, this.panel);
    host.append(this.root);
    // A touch anywhere else closes the emotes, as a menu does.
    document.addEventListener('pointerdown', (event) => {
      if (!this.panel.hidden && !this.root.contains(event.target as Node)) this.open(false);
    }, true);
    sheet('coop');
  }

  private open(on: boolean): void {
    this.panel.hidden = !on;
    this.toggle.classList.toggle('active', on);
    this.toggle.setAttribute('aria-expanded', String(on));
  }

  private show(on: boolean): void {
    if (this.root.hidden === !on) return;
    this.root.hidden = !on;
    if (!on) this.open(false);
  }

  /** A long press on the map pinged a cell of the depth I am on: tells the party (co-op only). True if it went. */
  ping(session: Session, depth: number, cell: number): boolean {
    if (session.mode !== 'online') return false;
    session.signal({ kind: 'ping', depth, cell });
    return true;
  }

  /** Takes what the room relayed and draws the marks over the frame just rendered. */
  frame(ctx: CanvasRenderingContext2D, f: CoopFrame): void {
    const { session, world, view, now } = f;
    this.session = session;
    const online = session.mode === 'online';
    this.show(online);
    if (!online) {
      this.pings = [];
      this.emotes.clear();
      return;
    }
    const me = world.heroes.find((hero) => hero.id === session.myId);
    if (!me) return;
    for (const { from, signal, at } of session.drainSignals()) {
      // A tab that was away comes back to old news: a ping or an emote is only worth showing as it happens.
      if (performance.now() - at < STALE_MS) this.receive(from, signal, world, view, me.depth, now);
    }
    this.pings = this.pings.filter((ping) => ping.depth === me.depth && now - ping.start < Math.max(PING_ARROW_MS, this.pingLength()));
    for (const [id, shown] of this.emotes) if (now - shown.start >= EMOTE_MS) this.emotes.delete(id);

    const coop = sheet('coop');
    if (!coop) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = 1;
    this.draw(ctx, coop, f, me.depth);
    ctx.restore();
  }

  private receive(from: string, signal: Signal, world: World, view: View, depth: number, now: number): void {
    const hero = world.heroes.find((h) => h.id === from);
    if (signal.kind === 'ping') {
      // A ping is on its own depth's map: a companion elsewhere does not see it on mine.
      if (signal.depth !== depth) return;
      this.pings.push({ from, depth: signal.depth, cell: signal.cell, start: now });
      const x = (signal.cell % WIDTH) * TILE + TILE / 2;
      const y = Math.floor(signal.cell / WIDTH) * TILE + TILE / 2;
      audio.play('sparkle', 1.25, 0.45, { x, y });
      return;
    }
    if (!hero) return;
    this.emotes.set(from, { emote: signal.emote, start: now });
    const puppet = hero.depth === depth ? view.puppets.get(from) : undefined;
    if (puppet) {
      const at = view.position(puppet, now);
      audio.play('pop', 1.3, 0.35, { x: at.x + TILE / 2, y: at.y + TILE / 2 });
    } else if (hero.depth !== depth) {
      // Not on my map: said in the log instead, so a call for help from another depth is not lost.
      view.say(`${hero.name}: ${t.emotes[signal.emote]}`);
    }
  }

  private pingLength(): number {
    const frames = sheet('coop')?.anims.ping;
    return frames ? frames.reduce((sum, frame) => sum + frame.ms, 0) * PING_PLAYS : 0;
  }

  private draw(ctx: CanvasRenderingContext2D, coop: Sheet, f: CoopFrame, depth: number): void {
    const { session, world, view, camera, now } = f;
    const { canvas } = ctx;
    // Device pixels per CSS pixel, per art pixel of the map, and per art pixel of the UI.
    const px = canvas.width / (canvas.clientWidth || canvas.width);
    const zoom = Math.max(1, Math.round(camera.zoom));
    const ui = Math.max(1, Math.round(2 * px));
    const toScreen = (x: number, y: number): { x: number; y: number } => ({ x: (x - camera.x) * camera.zoom, y: (y - camera.y) * camera.zoom });
    const scaleY = canvas.height / (canvas.clientHeight || canvas.height);
    const band: Box = { left: 0, top: f.free.top * scaleY, right: canvas.width, bottom: f.free.bottom * scaleY };
    const reduced = quality.reducedMotion;
    const anims = coop.anims;

    // Pings: the animation on the cell, tinted the sender's colour; out of sight, an arrow at the edge.
    for (const ping of this.pings) {
      const color = ping.from === session.myId ? MINE : ALLY;
      const tinted = tintedImage(coop, color);
      const age = now - ping.start;
      const cellX = (ping.cell % WIDTH) * TILE;
      const cellY = Math.floor(ping.cell / WIDTH) * TILE;
      const at = toScreen(cellX + TILE / 2, cellY + TILE / 2);
      const onScreen = at.x >= band.left && at.x <= band.right && at.y >= band.top && at.y <= band.bottom;
      const frames = anims.ping;
      if (frames && age < this.pingLength()) {
        // With reduced motion the ping holds on its clearest frame, the column of light.
        const frame = reduced ? frames[Math.min(2, frames.length - 1)]! : frameAt(frames, age, true);
        const corner = toScreen(cellX + (TILE - frame.w) / 2, cellY + TILE - frame.h);
        blit(ctx, tinted, frame, corner.x, corner.y, zoom);
      }
      if (!onScreen && age < PING_ARROW_MS && anims['edge-arrow']?.[0]) {
        const place = edgePlace(at, band, 10 * ui, this.obstacles(canvas, px, 10 * ui));
        if (place) {
          ctx.globalAlpha = age > PING_ARROW_MS - 300 ? 0.5 : 1;
          drawArrow(ctx, tinted, anims['edge-arrow'][0], place.x, place.y, place.angle, ui);
          ctx.globalAlpha = 1;
        }
      }
    }

    // Each companion on this depth: a flame over the fallen, an emote over the head, a marker at the edge when out of view.
    const marked: Array<{ puppet: Puppet; heroClass: HeroClass; alive: boolean }> = [];
    for (const hero of world.heroes) {
      if (hero.depth !== depth) continue;
      const puppet = view.puppets.get(hero.id);
      if (!puppet) continue;
      const pos = view.position(puppet, now);
      const head = toScreen(pos.x + TILE / 2, pos.y + TILE - puppet.sprite.sheet.h);
      const fallen = !isAlive(hero) && !world.over;
      const mine = hero.id === session.myId;
      let above = head.y - zoom;
      if (fallen && !mine && anims.fallen) {
        const frame = reduced ? anims.fallen[0]! : frameAt(anims.fallen, now, true);
        above -= frame.h * zoom;
        blit(ctx, coop.image, frame, head.x - (frame.w * zoom) / 2, above, zoom);
      }
      const shown = this.emotes.get(hero.id);
      if (shown && anims.emotes) {
        const frame = anims.emotes[EMOTES.indexOf(shown.emote)];
        if (frame) {
          const age = now - shown.start;
          // It comes up two pixels in two steps, and goes in two (the design system's motion by frames).
          const rise = reduced ? 0 : Math.max(0, 2 - Math.floor(age / STEP_MS));
          const left = EMOTE_MS - age;
          ctx.globalAlpha = left < STEP_MS ? 0.33 : left < STEP_MS * 2 ? 0.66 : 1;
          // A companion's name is over their head (render.ts): the emote stands above it.
          const lift = puppet.label && puppet.alive ? 22 * px : 0;
          const bottom = above - lift + rise * zoom;
          blit(ctx, coop.image, frame, head.x - (frame.w * zoom) / 2, bottom - frame.h * zoom, zoom);
          ctx.globalAlpha = 1;
        }
      }
      if (!mine) marked.push({ puppet, heroClass: hero.heroClass, alive: !fallen });
    }

    const arrow = anims['edge-arrow']?.[0];
    const ring = anims['edge-arrow']?.[1];
    const portraits = anims.portraits;
    if (!arrow || !ring || !portraits || marked.length === 0) return;
    const tinted = tintedImage(coop, ALLY);
    // The ring is 14 art pixels across and the arrow reaches 18 from its middle: kept that far inside the free band.
    const reach = 19 * ui;
    let obstacles: Box[] | null = null;
    for (const { puppet, heroClass, alive } of marked) {
      const pos = view.position(puppet, now);
      const at = toScreen(pos.x + TILE / 2, pos.y + TILE / 2);
      const half = (TILE / 2) * camera.zoom;
      const seen = at.x + half > band.left && at.x - half < band.right && at.y + half > band.top && at.y - half < band.bottom;
      if (seen) continue;
      obstacles ??= this.obstacles(canvas, px, 8 * ui);
      const place = edgePlace(at, band, reach, obstacles);
      if (!place) continue;
      ctx.globalAlpha = alive ? 1 : 0.6;
      drawArrow(ctx, tinted, arrow, place.x + Math.cos(place.angle) * 12 * ui, place.y + Math.sin(place.angle) * 12 * ui, place.angle, ui);
      const left = Math.round(place.x - (ring.w * ui) / 2);
      const top = Math.round(place.y - (ring.h * ui) / 2);
      blit(ctx, tinted, ring, left, top, ui);
      const face = portraits[PORTRAITS[heroClass]];
      if (face) blit(ctx, coop.image, face, left + 2 * ui, top + 2 * ui, ui);
      ctx.globalAlpha = 1;
    }
  }

  /** What else sits over the map's edges, in device pixels, grown by `margin`: this button, the map's buttons, the finds. */
  private obstacles(canvas: HTMLCanvasElement, px: number, margin: number): Box[] {
    const origin = canvas.getBoundingClientRect();
    const boxes: Box[] = [];
    const nodes = [this.root, ...document.querySelectorAll<HTMLElement>('#ui .pd-mapctl, #ui .pd-finds')];
    for (const node of nodes) {
      if (node.hidden) continue;
      const r = node.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      boxes.push({
        left: (r.left - origin.left) * px - margin,
        top: (r.top - origin.top) * px - margin,
        right: (r.right - origin.left) * px + margin,
        bottom: (r.bottom - origin.top) * px + margin,
      });
    }
    return boxes;
  }
}

/** Draws a frame of a sheet (or its tinted copy) at whole device pixels, `scale` device pixels to the art's pixel. */
function blit(ctx: CanvasRenderingContext2D, image: CanvasImageSource, frame: Frame, x: number, y: number, scale: number): void {
  ctx.drawImage(image, frame.x, frame.y, frame.w, frame.h, Math.round(x), Math.round(y), frame.w * scale, frame.h * scale);
}

/** The edge arrow (it looks right in the sheet), turned to `angle` round its middle at (x, y). */
function drawArrow(ctx: CanvasRenderingContext2D, image: CanvasImageSource, frame: Frame, x: number, y: number, angle: number, scale: number): void {
  ctx.save();
  ctx.translate(Math.round(x), Math.round(y));
  ctx.rotate(angle);
  ctx.drawImage(image, frame.x, frame.y, frame.w, frame.h, (-frame.w * scale) / 2, (-frame.h * scale) / 2, frame.w * scale, frame.h * scale);
  ctx.restore();
}

/**
 * Where a marker for something off screen at `at` goes: on the edge of the free band brought
 * in by `inset`, on the line from the band's middle towards it; slid along that edge out of
 * the way of whatever else is there. Null when the band is too small to hold one.
 */
export function edgePlace(at: { x: number; y: number }, band: Box, inset: number, obstacles: readonly Box[]): { x: number; y: number; angle: number } | null {
  const left = band.left + inset;
  const right = band.right - inset;
  const top = band.top + inset;
  const bottom = band.bottom - inset;
  if (right <= left || bottom <= top) return null;
  const cx = (left + right) / 2;
  const cy = (top + bottom) / 2;
  const dx = at.x - cx;
  const dy = at.y - cy;
  if (dx === 0 && dy === 0) return null;
  const k = Math.min(dx === 0 ? Infinity : (right - cx) / Math.abs(dx), dy === 0 ? Infinity : (bottom - cy) / Math.abs(dy));
  let x = cx + dx * k;
  let y = cy + dy * k;
  // On a side edge it slides up or down; on the top or bottom, left or right.
  const side = Math.abs(Math.abs(x - cx) - (right - cx)) < 0.5;
  for (const box of obstacles) {
    if (x < box.left || x > box.right || y < box.top || y > box.bottom) continue;
    if (side) {
      const up = box.top;
      const down = box.bottom;
      y = (Math.abs(y - up) <= Math.abs(down - y) && up >= top) || down > bottom ? Math.max(top, up) : Math.min(bottom, down);
    } else {
      const back = box.left;
      const on = box.right;
      x = (Math.abs(x - back) <= Math.abs(on - x) && back >= left) || on > right ? Math.max(left, back) : Math.min(right, on);
    }
  }
  return { x, y, angle: Math.atan2(at.y - y, at.x - x) };
}
