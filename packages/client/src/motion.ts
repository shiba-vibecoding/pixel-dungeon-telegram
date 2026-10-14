import { type Effect, HEAP_SPRITES, heroById, type Level, LENGTH, S, T, TileSheet, TileVisuals, WIDTH, type World } from '@pd/core';
import { audio } from './audio';
import { between, dropSound } from './sfx';
import { fx } from './fx';
import { quality } from './quality';
import { type Assets, levelRegion, oldTiles } from './sprites';
import type { LevelTiles } from './tiles';
import { TILE, type View } from './view';
import { drawFrame, type Frame, frameAt, length, lookIndex, sheet, type SheetName } from './worldsheets';

/*
 * The world answering touch, drawn with Claude Design's world sheets
 * (worldsheets.ts) where they have loaded, and with transformed tiles until then. Everything here comes from comparing what the
 * world is with what it was a frame ago, so it plays whoever caused it: a door
 * swings open under any foot and shuts behind it, tall grass is pressed flat
 * and sways as someone brushes past, water rings around a step, things that
 * fall to the floor drop and bounce, a chest shakes, throws its lid and lets
 * out what it held, and what is picked up rises off the floor towards whoever
 * took it (into the backpack, for me: see `takeLaunches`).
 */

const DOOR_OPEN_MS = 170;
const DOOR_CLOSE_MS = 210;
const TRAMPLE_MS = 300;
const FADE_MS = 320;
const DROP_MS = 420;
const LIFT_MS = 130;
const CHEST_SHAKE_MS = 150;
const CHEST_MS = 380;
const SWAY_MS = 1100;
const RIPPLE_MS = 700;

type TileKind = 'open' | 'close' | 'locked' | 'barricade' | 'trample' | 'fade';

interface TileAnim {
  cell: number;
  from: number;
  to: number;
  start: number;
  kind: TileKind;
  /** How long it plays: the sheet's frames, or the transformed tile's time. */
  ms: number;
}

/** A sprite animation played once somewhere (a splash, a footprint, a glint), world pixels top-left. */
interface Flash {
  sheet: SheetName;
  key: string;
  /** Which frame of the animation, for a still one (a footprint). */
  frame?: number;
  x: number;
  y: number;
  start: number;
  /** How long it stays, fading out over the last `fade` ms. */
  life: number;
  fade?: number;
}

/** A coin flying off a pile of gold that was picked up. */
interface Coin {
  x: number;
  y: number;
  vx: number;
  vy: number;
  start: number;
}

/**
 * Which chest animation (chests.png) plays for a heap's sprite. No mimic here: it shares the chest's sprite,
 * so it would be keyed over the chest's own; a sprung mimic plays MIMIC_ANIM instead (the `mimic` effect).
 */
export const CHEST_ANIMS = new Map<number, string>(
  ([['chest', 'chest'], ['lockedChest', 'locked_chest'], ['crystalChest', 'crystal_chest'], ['tomb', 'tomb'], ['skeleton', 'bones']] as const)
    .map(([kind, key]) => [HEAP_SPRITES[kind], key]),
);

/** The animation of a chest that turned out to be a mimic. */
const MIMIC_ANIM = 'mimic';

/** The wind's round of tall grass frames, and a pass's (bent away from whoever passes). */
const WIND = [2, 1, 0, 1, 2, 3, 4, 3] as const;
const PASS_RIGHT = [2, 3, 4, 3, 2] as const;
const PASS_LEFT = [2, 1, 0, 1, 2] as const;
const PASS_MS = 80;
const COIN_MS = 650;
const SEARCH_MS = 520;

/** A heap that has just come to lie somewhere: it falls in (from a hand, a corpse, a throw) and bounces. */
interface Arrival {
  start: number;
  /** How high it falls from, world pixels. */
  height: number;
  landed: boolean;
}

/** A heap that has just gone, drawn a moment longer. */
interface Ghost {
  pos: number;
  sprite: number;
  start: number;
  kind: 'lift' | 'chest' | 'fade';
  /** The chests.png animation a chest plays, where it is not the one its sprite gives (a mimic's jaws). */
  anim?: string;
  /** Where it flies to (a companion who took it), world pixels. */
  toward?: { x: number; y: number };
  /** How long it is drawn. */
  life: number;
}

/** What I picked up: main.ts flies it into the backpack from here. */
export interface Launch {
  sprite: number;
  /** World pixels: the middle of the item where it leaves the floor. */
  x: number;
  y: number;
  /** When it should set off, on the visual clock. */
  at: number;
  gold: boolean;
}

export interface HeapLook {
  dy: number;
  dx: number;
  scaleX: number;
  scaleY: number;
  alpha: number;
  /** Not yet there: a thrown thing still in the air. */
  hidden: boolean;
}

const easeOut = (k: number): number => 1 - (1 - k) ** 3;
const easeIn = (k: number): number => k * k;

/** A fall with two bounces, as height above the floor for 0..1 of the drop's time. */
function bounce(k: number): number {
  if (k < 0.55) return 1 - (k / 0.55) ** 2;
  if (k < 0.82) {
    const b = (k - 0.55) / 0.27;
    return 0.22 * (1 - (2 * b - 1) ** 2);
  }
  const b = (k - 0.82) / 0.18;
  return 0.06 * (1 - (2 * b - 1) ** 2);
}

const isWater = (terrain: number): boolean => terrain === T.WATER;

/** The middle of a cell, world pixels: where its sounds come from. */
const centre = (cell: number): { x: number; y: number } => ({ x: (cell % WIDTH) * TILE + TILE / 2, y: Math.trunc(cell / WIDTH) * TILE + TILE / 2 });

export class Motion {
  private map: Uint8Array | null = null;
  private heaps = new Map<number, number>();
  private key = '';
  private tiles: TileAnim[] = [];
  private arrivals = new Map<number, Arrival>();
  private ghosts: Ghost[] = [];
  private sway = new Map<number, { start: number; dir: number }>();
  private ripples: Array<{ x: number; y: number; start: number; size: number }> = [];
  private flashes: Flash[] = [];
  private coins: Coin[] = [];
  /** Steps each walker still leaves wet prints for, after coming out of water. */
  private wet = new Map<string, number>();
  /** When something lying about next glints. */
  private nextGlint = 0;
  /** Where gold was taken this frame. */
  private gold: number[] = [];
  /** A search going out from a hero: a ring that spreads as far as it reaches. */
  private searches: Array<{ x: number; y: number; start: number }> = [];
  /** Each walker's last step, to notice new ones. */
  private steps = new Map<string, number>();
  /** This frame's events: who picked up where, chests opened, mimics sprung, throws landing. */
  private pickedAt = new Map<number, string>();
  private picked: Array<{ hero: string; sprite: number; gold: boolean }> = [];
  private opened = new Set<number>();
  private sprung = new Set<number>();
  private launches: Launch[] = [];

  constructor(private readonly assets: Assets) {}

  reset(): void {
    this.map = null;
    this.heaps.clear();
    this.key = '';
    this.tiles = [];
    this.arrivals.clear();
    this.ghosts = [];
    this.sway.clear();
    this.ripples = [];
    this.flashes = [];
    this.coins = [];
    this.searches = [];
    this.wet.clear();
    this.steps.clear();
    this.launches = [];
  }

  /** Takes in the effects of an update before `update` compares the world. */
  effects(effects: readonly Effect[], world: World, depth: number, itemSprite: (item: Effect & { type: 'pickedUp' }) => number): void {
    for (const effect of effects) {
      if (effect.type === 'pickedUp') {
        const hero = heroById(world, effect.hero);
        if (!hero || hero.depth !== depth) continue;
        this.pickedAt.set(hero.pos, effect.hero);
        this.picked.push({ hero: effect.hero, sprite: itemSprite(effect), gold: effect.item.kind === 'gold' });
        if (effect.item.kind === 'gold') this.gold.push(hero.pos);
      } else if (effect.type === 'searched') {
        const hero = heroById(world, effect.hero);
        if (hero && hero.depth === depth) this.searches.push({ ...centre(hero.pos), start: performance.now() });
      } else if (effect.type === 'opened' && effect.depth === depth) {
        this.opened.add(effect.pos);
      } else if (effect.type === 'mimic' && effect.depth === depth) {
        const hero = heroById(world, effect.hero);
        if (hero) this.sprung.add(hero.pos);
      }
    }
  }

  /** What I picked up this frame, to fly into the backpack. */
  takeLaunches(): Launch[] {
    const out = this.launches;
    this.launches = [];
    return out;
  }

  /**
   * Compares the world with the last frame and starts whatever its changes call for.
   * `heaps` are the heaps drawn at this depth, with their sprites.
   */
  update(
    level: Level, heaps: ReadonlyArray<{ pos: number; sprite: number }>, visible: readonly boolean[], view: View,
    myId: string, key: string, now: number,
  ): void {
    const fresh = key !== this.key || !this.map;
    if (fresh) {
      this.reset();
      this.key = key;
      this.map = Uint8Array.from(level.map);
      for (const heap of heaps) this.heaps.set(heap.pos, heap.sprite);
      this.forgetFrame();
      return;
    }

    // Terrain that changed: doors, grass, and whatever else (a secret found, grass burnt).
    const map = this.map!;
    for (let cell = 0; cell < LENGTH; cell++) {
      const was = map[cell]!;
      const is = level.map[cell]!;
      if (was === is) continue;
      map[cell] = is;
      if (!visible[cell]) continue;
      const r = levelRegion(level);
      // Doors.png is drawn from the front; a door in a side wall (DOOR_SIDEWAYS) has no frames and just changes.
      const sideways = (door: number): boolean => TileVisuals.getRaisedDoorTile(door, level.map[cell - WIDTH] ?? -1) === TileSheet.RAISED_DOOR_SIDEWAYS;
      if (was === T.DOOR && is === T.OPEN_DOOR) {
        if (!sideways(is)) this.tiles.push({ cell, from: was, to: is, start: now, kind: 'open', ms: this.animMs(`doors${r}`, 'door', DOOR_OPEN_MS) });
        // The original's own door sound, nothing laid over it.
        audio.play('door_open', 1, 0.6, centre(cell));
      } else if (was === T.OPEN_DOOR && is === T.DOOR) {
        if (!sideways(is)) this.tiles.push({ cell, from: was, to: is, start: now, kind: 'close', ms: this.animMs(`doors${r}`, 'door', DOOR_CLOSE_MS, true) });
        // Shutting behind whoever left: only a soft knock of wood as it meets the frame.
        audio.later(DOOR_CLOSE_MS * 0.7, 'knock', 0.75, 0.22, centre(cell));
      } else if (was === T.HIGH_GRASS && is === T.GRASS) {
        this.tiles.push({ cell, from: was, to: is, start: now, kind: 'trample', ms: this.animMs(`grass${r}`, 'trample', TRAMPLE_MS) });
        const x = (cell % WIDTH) * TILE + TILE / 2;
        const y = Math.trunc(cell / WIDTH) * TILE + TILE - 3;
        // HighGrass.trample makes no sound of its own: the hero's step into it does (main.ts), as in Hero.move.
        fx.burst(x, y, now, {
          count: 9, colors: ['#6aa84f', '#93c47d', '#38761d', '#b6d7a8'], speed: [14, 34], life: [380, 700], gravity: 150, drag: 0.25,
          angle: -Math.PI / 2, cone: 2.6, size: [1, 1], spread: 5,
        });
      } else if (was === T.LOCKED_DOOR) {
        // The key turns: the lock clicks and the door stands open.
        if (!sideways(was)) this.tiles.push({ cell, from: was, to: is, start: now, kind: 'locked', ms: this.animMs(`doors${r}`, 'locked', FADE_MS) });
      } else if (was === T.BARRICADE) {
        this.tiles.push({ cell, from: was, to: is, start: now, kind: 'barricade', ms: this.animMs(`doors${r}`, 'barricade', FADE_MS) });
      } else {
        this.tiles.push({ cell, from: was, to: is, start: now, kind: 'fade', ms: FADE_MS });
      }
    }

    // Heaps that have gone.
    const present = new Map(heaps.map((heap) => [heap.pos, heap.sprite]));
    let stagger = 0;
    for (const [pos, sprite] of this.heaps) {
      const still = present.get(pos);
      if (still === sprite) continue;
      const chest = this.opened.has(pos) || this.sprung.has(pos);
      if (this.sprung.has(pos)) {
        this.ghosts.push({ pos, sprite, start: now, kind: 'chest', anim: MIMIC_ANIM, life: this.chestLife(sprite, MIMIC_ANIM) });
      } else if (chest) {
        this.ghosts.push({ pos, sprite, start: now, kind: 'chest', life: this.chestLife(sprite) });
        this.chestBurst(pos, now + CHEST_SHAKE_MS);
      } else if (still === undefined) {
        const taker = this.pickedAt.get(pos);
        const puppet = taker ? view.puppets.get(taker) : undefined;
        if (taker && taker !== myId && puppet) {
          const at = view.position(puppet, now);
          this.ghosts.push({ pos, sprite, start: now, kind: 'lift', toward: { x: at.x + TILE / 2, y: at.y + 4 }, life: 280 });
        } else {
          this.ghosts.push({ pos, sprite, start: now, kind: taker ? 'lift' : 'fade', life: taker ? 280 : FADE_MS });
        }
      }
      // What I took sets off for the backpack: from the floor, or out of the opened chest.
      if (this.pickedAt.get(pos) === myId) {
        const delay = chest ? CHEST_SHAKE_MS + 90 : LIFT_MS * 0.6;
        const x = (pos % WIDTH) * TILE + TILE / 2;
        const y = Math.trunc(pos / WIDTH) * TILE + TILE / 2 - (chest ? 10 : 6);
        for (const item of this.picked.filter((p) => p.hero === myId)) {
          this.launches.push({ sprite: item.sprite, x, y, at: now + delay + stagger, gold: item.gold });
          stagger += 75;
        }
        this.picked = this.picked.filter((p) => p.hero !== myId);
      }
      // Something stays behind a chest opened with a full pack: it comes up out of it.
      if (still !== undefined) this.arrivals.set(pos, { start: now + (chest ? CHEST_SHAKE_MS : 0), height: chest ? 12 : 4, landed: false });
    }
    // Heaps that have come: dropped, thrown, fallen out of whoever died.
    for (const [pos, sprite] of present) {
      if (this.heaps.has(pos) || !visible[pos]) continue;
      void sprite;
      const flight = view.projectiles.find((p) => p.to === pos && p.sprite !== null);
      const start = flight ? flight.start + flight.duration : now;
      this.arrivals.set(pos, { start, height: flight ? 5 : 9, landed: false });
    }
    this.heaps = present;
    // Given rather than picked off the floor (a quest's reward): it comes from the hero's hands.
    const me = view.puppets.get(myId);
    if (me) {
      const at = view.position(me, now);
      for (const item of this.picked.filter((p) => p.hero === myId)) {
        this.launches.push({ sprite: item.sprite, x: at.x + TILE / 2, y: at.y + 2, at: now + stagger, gold: item.gold });
        stagger += 75;
      }
    }

    // Walkers: grass sways as they brush past, water rings where they step.
    for (const puppet of view.puppets.values()) {
      const last = this.steps.get(puppet.id);
      this.steps.set(puppet.id, puppet.moveStart);
      if (last === undefined || last === puppet.moveStart || !puppet.alive) continue;
      const pos = puppet.to;
      if (!visible[pos] && !puppet.isHero) continue;
      // Companions are heard walking, softly, from where they are.
      if (puppet.isHero && puppet.id !== myId) audio.play(isWater(level.map[pos]!) ? 'water' : 'step', 1.05, 0.22, centre(pos));
      const feetX = (pos % WIDTH) * TILE + TILE / 2;
      const feetY = Math.trunc(pos / WIDTH) * TILE + TILE - 2;
      if (isWater(level.map[pos]!)) {
        // A splash at the feet, rings spreading out, and wet feet for a few steps after.
        this.flashes.push({ sheet: 'splash', key: 'splash', x: feetX - 8, y: feetY - 15, start: now + 40, life: 240 });
        if (sheet('splash')) this.flashes.push({ sheet: 'splash', key: 'rings', x: feetX - 8, y: feetY - 6, start: now + 60, life: 440, fade: 120 });
        else this.ripples.push({ x: feetX, y: feetY - 2, start: now + 60, size: 1 });
        this.wet.set(puppet.id, 4);
      } else if (level.map[pos] !== T.GRASS && level.map[pos] !== T.HIGH_GRASS && level.map[pos] !== T.EMBERS) {
        const wet = this.wet.get(puppet.id) ?? 0;
        if (wet > 0) {
          // Footprints, left and right, drying away.
          this.wet.set(puppet.id, wet - 1);
          this.flashes.push({ sheet: 'splash', key: 'wet-steps', frame: wet % 2, x: feetX - 4 + (wet % 2 ? -2 : 2), y: feetY - 6, start: now + 50, life: 1500, fade: 1100 });
        } else if (puppet.isHero && Math.random() < 0.5) {
          this.flashes.push({ sheet: 'splash', key: 'dust', x: feetX - 4 + (puppet.flip ? 3 : -3), y: feetY - 7, start: now + 30, life: 240 });
        }
      }
      for (const d of [-WIDTH - 1, -WIDTH, -WIDTH + 1, -1, 1, WIDTH - 1, WIDTH, WIDTH + 1]) {
        const cell = pos + d;
        if (cell < 0 || cell >= LENGTH || Math.abs((cell % WIDTH) - (pos % WIDTH)) > 1) continue;
        if (level.map[cell] !== T.HIGH_GRASS || !visible[cell]) continue;
        // Bent away from whoever passes.
        const dir = Math.sign((cell % WIDTH) - (pos % WIDTH)) || (Math.random() < 0.5 ? -1 : 1);
        this.sway.set(cell, { start: now, dir });
      }
    }
    // Standing in water, the surface rings now and then.
    for (const puppet of view.puppets.values()) {
      if (!puppet.alive || !visible[puppet.to] || !isWater(level.map[puppet.to]!)) continue;
      if (now - puppet.moveStart > 600 && Math.random() < 0.012) {
        const pos = puppet.to;
        this.ripples.push({ x: (pos % WIDTH) * TILE + TILE / 2, y: Math.trunc(pos / WIDTH) * TILE + TILE - 4, start: now, size: 0.6 });
      }
    }

    // Arrivals land with a little dust and a tap.
    for (const [pos, arrival] of this.arrivals) {
      if (arrival.landed || now < arrival.start + DROP_MS * 0.55) continue;
      arrival.landed = true;
      const x = (pos % WIDTH) * TILE + TILE / 2;
      const y = Math.trunc(pos / WIDTH) * TILE + TILE - 3;
      fx.burst(x, y, now, { count: 4, colors: ['rgba(200, 190, 170, 0.8)', 'rgba(150, 140, 120, 0.7)'], speed: [6, 16], life: [250, 420], rise: 4, drag: 0.3, size: [1, 1], spread: 4 });
      // ItemSprite.drop: gold rings as it comes; whatever lands sounds what it lands on.
      if (visible[pos]) {
        if (present.get(pos) === S.GOLD) audio.play('gold', between(0.9, 1.1), 1, centre(pos));
        const landing = dropSound(level.map[pos]!);
        audio.play(landing.sound, landing.rate, 0.8, centre(pos));
      }
    }

    // Gold taken: coins spin up off the pile and fall away.
    for (const pos of this.gold) {
      if (!visible[pos] || quality.reducedMotion) continue;
      const { x, y } = centre(pos);
      for (let i = 0; i < 5; i++) {
        this.coins.push({ x: x - 3, y: y - 2, vx: (Math.random() - 0.5) * 70, vy: -60 - Math.random() * 45, start: now + i * 25 });
      }
    }
    // Now and then something lying in sight catches the light.
    if (now >= this.nextGlint) {
      this.nextGlint = now + 2000 + Math.random() * 2000;
      const lying = [...present.entries()].filter(([pos, sprite]) => visible[pos] && !CHEST_ANIMS.has(sprite));
      const pick = lying[Math.floor(Math.random() * lying.length)];
      if (pick && !quality.reducedMotion) {
        const [pos] = pick;
        const x = (pos % WIDTH) * TILE + 2 + Math.random() * 6;
        const y = Math.trunc(pos / WIDTH) * TILE + 1 + Math.random() * 6;
        this.flashes.push({ sheet: 'glint', key: 'glint', x, y, start: now, life: 330 });
      }
    }

    this.tiles = this.tiles.filter((a) => now - a.start < a.ms);
    this.ghosts = this.ghosts.filter((g) => now - g.start < g.life);
    this.flashes = this.flashes.filter((f) => now - f.start < f.life);
    this.coins = this.coins.filter((c) => now - c.start < COIN_MS);
    for (const [pos, arrival] of this.arrivals) if (now - arrival.start > DROP_MS) this.arrivals.delete(pos);
    for (const [cell, s] of this.sway) if (now - s.start > SWAY_MS || level.map[cell] !== T.HIGH_GRASS) this.sway.delete(cell);
    this.ripples = this.ripples.filter((r) => now - r.start < RIPPLE_MS);
    this.forgetFrame();
  }

  private forgetFrame(): void {
    this.pickedAt.clear();
    this.picked = [];
    this.opened.clear();
    this.sprung.clear();
    this.gold = [];
  }

  /**
   * How long a sheet's animation plays once through (its frames up to the one it stops on);
   * `fallback` while the sheet has not loaded. Backwards (a door shutting) it ends on the first frame.
   */
  private animMs(name: SheetName, key: string, fallback: number, backwards = false): number {
    const frames = sheet(name)?.anims[key];
    if (!frames) return fallback;
    const each = frames.map((f) => f.ms || frames[0]!.ms || 80);
    return (backwards ? each.slice(1).reduce((a, b) => a + b, 0) : length(frames)) + 40;
  }

  /** How long an opened chest is drawn: its frames, then a moment empty, fading. */
  private chestLife(sprite: number, anim?: string): number {
    const key = anim ?? CHEST_ANIMS.get(sprite);
    const frames = key ? sheet('chests')?.anims[key] : undefined;
    return frames ? CHEST_SHAKE_MS + length(frames) + 520 : CHEST_MS;
  }

  /** The lid flies up: dust and a glint of what is inside. */
  private chestBurst(pos: number, at: number): void {
    const x = (pos % WIDTH) * TILE + TILE / 2;
    const y = Math.trunc(pos / WIDTH) * TILE + TILE / 2;
    fx.burst(x, y - 2, at, { count: 14, colors: ['#ffe9a0', '#fff6c0', '#ffffff', '#e0a020'], glow: true, speed: [20, 60], life: [350, 800], rise: 26, drag: 0.35, size: [1, 1], spread: 4 });
    fx.burst(x, y + 4, at, { count: 8, colors: ['rgba(200, 190, 170, 0.8)', 'rgba(150, 140, 120, 0.7)'], speed: [10, 30], life: [300, 520], gravity: 60, drag: 0.3, size: [1, 2], spread: 6 });
    // The chest's own sound (Hero.actOpenChest: UNLOCK) is the view's, from the 'opened' effect.
  }

  /** How a heap lying at `pos` is drawn this frame. */
  heapLook(pos: number, now: number): HeapLook {
    const look: HeapLook = { dy: 0, dx: 0, scaleX: 1, scaleY: 1, alpha: 1, hidden: false };
    const arrival = this.arrivals.get(pos);
    if (arrival) {
      const t = now - arrival.start;
      if (t < 0) {
        look.hidden = true;
      } else {
        const k = Math.min(1, t / DROP_MS);
        look.dy = -bounce(k) * arrival.height;
        // A squash as it lands.
        const landing = k > 0.5 && k < 0.66 ? Math.sin(((k - 0.5) / 0.16) * Math.PI) : 0;
        look.scaleX = 1 + landing * 0.18;
        look.scaleY = 1 - landing * 0.16;
      }
    }
    return look;
  }

  /** Under the heaps, over the floor: animated tiles, grass in the wind, rings on water, heaps on their way out. */
  draw(ctx: CanvasRenderingContext2D, level: Level, visible: readonly boolean[], explored: readonly boolean[], now: number, levelTiles?: LevelTiles): void {
    const region = levelRegion(level);
    const grass = sheet(`grass${region}`);
    const doors = sheet(`doors${region}`);
    const tile = (terrain: number, cell: number): void => {
      // (PD 1.9's sheet of this region comes the first time a stand-in is wanted: nothing is drawn until it has.)
      const tiles = oldTiles(this.assets, region);
      const columns = tiles.width / TILE;
      if (columns > 0) ctx.drawImage(tiles, (terrain % columns) * TILE, Math.trunc(terrain / columns) * TILE, TILE, TILE, 0, 0, TILE, TILE);
      void cell;
    };
    const at = (cell: number): { x: number; y: number } => ({ x: (cell % WIDTH) * TILE, y: Math.trunc(cell / WIDTH) * TILE });
    // The floor under grass is the cell's own (FLOOR or one of its alternates by variance), not always the plain one.
    const floor = (cell: number): void => {
      if (levelTiles) levelTiles.drawFloor(ctx, cell, 0, 0);
      else tile(T.EMPTY, cell);
    };

    // Tall grass: always a breath of draught, and bent by whoever passes.
    const wind = !quality.light && !quality.reducedMotion;
    if (grass) {
      // Drawn blade by blade over the floor wherever it grows, so it looks the same in sight and out.
      const sway = grass.anims.sway!;
      for (let cell = 0; cell < LENGTH; cell++) {
        if (level.map[cell] !== T.HIGH_GRASS || !explored[cell]) continue;
        let frame: Frame = sway[2]!;
        if (visible[cell] && wind) {
          const s = this.sway.get(cell);
          if (s && now - s.start < PASS_MS * 5) frame = frameAt(sway, now - s.start, false, s.dir > 0 ? PASS_RIGHT : PASS_LEFT, PASS_MS);
          else frame = frameAt(sway, now + ((cell * 397) % 1760), true, WIND);
        }
        const { x, y } = at(cell);
        ctx.save();
        ctx.translate(x, y);
        floor(cell);
        ctx.restore();
        drawFrame(ctx, grass, frame, x, y);
      }
    } else if (wind || this.sway.size > 0) {
      for (let cell = 0; cell < LENGTH; cell++) {
        if (level.map[cell] !== T.HIGH_GRASS || !visible[cell]) continue;
        const { x, y } = at(cell);
        let lean = wind ? 0.35 * Math.sin(now / 1100 + (cell % WIDTH) * 0.6 + Math.trunc(cell / WIDTH) * 0.35) : 0;
        const s = this.sway.get(cell);
        if (s) {
          const t = now - s.start;
          lean += s.dir * 2.2 * Math.exp(-t / 260) * Math.cos(t / 75);
        }
        if (Math.abs(lean) < 0.05) continue;
        ctx.save();
        ctx.translate(x, y);
        tile(T.GRASS, cell);
        // Leaning from the roots: the top moves, the bottom stays.
        ctx.transform(1, 0, -lean / TILE, 1, lean, 0);
        tile(T.HIGH_GRASS, cell);
        ctx.restore();
      }
    }

    for (const a of this.tiles) {
      const t = now - a.start;
      const k = Math.min(1, t / a.ms);
      const { x, y } = at(a.cell);
      // Drawn frames, where the sheets have them.
      const owner = a.kind === 'trample' ? grass : a.kind === 'fade' ? null : doors;
      const key = a.kind === 'open' || a.kind === 'close' ? 'door' : a.kind;
      const frames = owner?.anims[key];
      if (owner && frames) {
        if (a.kind === 'trample') {
          ctx.save();
          ctx.translate(x, y);
          floor(a.cell);
          ctx.restore();
        }
        // A door shuts by its opening frames backwards.
        const order = a.kind === 'close' ? frames.map((_, i) => frames.length - 1 - i) : undefined;
        drawFrame(ctx, owner, frameAt(frames, t, false, order, a.kind === 'close' ? frames[0]!.ms : undefined), x, y);
        continue;
      }
      ctx.save();
      ctx.translate(x, y);
      if (a.kind === 'open') {
        // The door swings in on its hinge and is gone.
        ctx.globalAlpha = 1 - easeIn(Math.max(0, (k - 0.45) / 0.55));
        ctx.transform(1 - easeOut(k) * 0.85, 0, 0, 1, 0, 0);
        tile(a.from, a.cell);
      } else if (a.kind === 'close') {
        // ...and swings back shut behind whoever left, with a little settle.
        tile(a.from, a.cell);
        const swing = Math.min(1, easeOut(k) * 1.06);
        ctx.globalAlpha = Math.min(1, k * 3);
        ctx.transform(0.15 + swing * 0.85, 0, 0, 1, 0, 0);
        tile(a.to, a.cell);
      } else if (a.kind === 'trample') {
        // Pressed flat from the top down.
        ctx.globalAlpha = 1 - easeIn(k) * 0.8;
        ctx.transform(1, 0, 0, 1 - easeIn(k), 0, TILE * easeIn(k));
        tile(a.from, a.cell);
      } else {
        ctx.globalAlpha = 1 - k;
        tile(a.from, a.cell);
      }
      ctx.restore();
    }

    // Rings on the water.
    ctx.save();
    ctx.lineWidth = 0.5;
    for (const r of this.ripples) {
      const t = now - r.start;
      if (t < 0) continue;
      const k = t / RIPPLE_MS;
      ctx.strokeStyle = `rgba(210, 240, 255, ${0.55 * (1 - k) * r.size})`;
      ctx.beginPath();
      ctx.ellipse(r.x, r.y, (2 + 7 * easeOut(k)) * r.size, (1 + 3 * easeOut(k)) * r.size, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();

    // Splashes, rings, wet footprints and dust (glints go over the heaps: drawOver).
    this.drawFlashes(ctx, now, false);

    // A search: a faint gold ring spreading out two cells, as far as a search reaches.
    this.searches = this.searches.filter((s) => performance.now() - s.start < SEARCH_MS);
    for (const s of this.searches) {
      const k = (performance.now() - s.start) / SEARCH_MS;
      ctx.strokeStyle = `rgba(255, 230, 150, ${0.45 * (1 - k)})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(s.x, s.y, 4 + easeOut(k) * TILE * 2.4, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Heaps on their way out.
    for (const g of this.ghosts) {
      const t = now - g.start;
      const { x, y } = at(g.pos);
      const sx = (g.sprite % 16) * 16;
      const sy = Math.floor(g.sprite / 16) * 16;
      ctx.save();
      const chestKey = g.kind === 'chest' ? g.anim ?? CHEST_ANIMS.get(g.sprite) : undefined;
      const chests = chestKey ? sheet('chests') : null;
      const chestFrames = chestKey ? chests?.anims[chestKey] : undefined;
      if (chests && chestFrames) {
        // It shakes, opens frame by frame, shows itself empty a moment and fades away.
        const shake = t < CHEST_SHAKE_MS ? (Math.floor(t / 30) % 2 ? 1 : -1) * 0.75 : 0;
        const frame = t < CHEST_SHAKE_MS ? chestFrames[0]! : frameAt(chestFrames, t - CHEST_SHAKE_MS);
        ctx.globalAlpha = Math.max(0, Math.min(1, (g.life - t) / 300));
        drawFrame(ctx, chests, frame, x + shake, y - 1);
        ctx.restore();
        continue;
      }
      if (g.kind === 'chest') {
        if (t < CHEST_SHAKE_MS) {
          // It shakes...
          ctx.translate(x + (Math.floor(t / 30) % 2 ? 1 : -1) * 0.75, y - 1);
        } else {
          // ...throws its lid, and fades as what it held comes out.
          const k = (t - CHEST_SHAKE_MS) / (CHEST_MS - CHEST_SHAKE_MS);
          const pop = Math.sin(Math.min(1, k * 2) * Math.PI);
          ctx.globalAlpha = 1 - easeIn(k);
          ctx.translate(x + 8, y + 15);
          ctx.scale(1 - pop * 0.12, 1 + pop * 0.2);
          ctx.translate(-8, -16);
        }
      } else if (g.kind === 'lift') {
        const k = Math.min(1, t / (g.toward ? 280 : LIFT_MS));
        if (g.toward) {
          // To a companion's hands.
          const fromX = x + 8;
          const fromY = y + 8;
          const px = fromX + (g.toward.x - fromX) * easeIn(k);
          const py = fromY + (g.toward.y - fromY) * easeIn(k) - Math.sin(k * Math.PI) * 6;
          ctx.globalAlpha = 1 - easeIn(k);
          ctx.translate(px, py);
          ctx.scale(1 - k * 0.5, 1 - k * 0.5);
          ctx.translate(-8, -8);
        } else {
          // Up off the floor: the backpack takes it from there.
          ctx.globalAlpha = 1 - easeIn(k);
          ctx.translate(x + 8, y + 8 - easeOut(k) * 6);
          ctx.scale(1 + k * 0.2, 1 + k * 0.2);
          ctx.translate(-8, -8);
        }
      } else {
        ctx.globalAlpha = 1 - t / FADE_MS;
        ctx.translate(x, y - 1);
      }
      ctx.drawImage(this.assets.items, sx, sy, 16, 16, 0, 0, 16, 16);
      ctx.restore();
    }
  }

  /** Whether a door swings, a chest opens, a heap drops or flies, a ring spreads or a coin falls (pace.ts). */
  moving(): boolean {
    return this.tiles.length > 0 || this.ghosts.length > 0 || this.ripples.length > 0 || this.flashes.length > 0 ||
      this.coins.length > 0 || this.searches.length > 0 || this.launches.length > 0 || this.sway.size > 0 || this.arrivals.size > 0;
  }

  /** Over the heaps, under the characters: glints on what lies about, coins in the air. */
  drawOver(ctx: CanvasRenderingContext2D, now: number): void {
    this.drawFlashes(ctx, now, true);
    const glint = sheet('glint');
    const coin = glint?.anims.coin;
    if (!glint || !coin) return;
    for (const c of this.coins) {
      const t = (now - c.start) / 1000;
      if (t < 0) continue;
      const x = c.x + c.vx * t;
      const y = c.y + c.vy * t + 160 * t * t;
      ctx.globalAlpha = Math.max(0, Math.min(1, (COIN_MS / 1000 - t) / 0.2));
      drawFrame(ctx, glint, frameAt(coin, now - c.start + Math.abs(c.vx) * 3, true), Math.round(x), Math.round(y));
    }
    ctx.globalAlpha = 1;
  }

  private drawFlashes(ctx: CanvasRenderingContext2D, now: number, over: boolean): void {
    for (const f of this.flashes) {
      if ((f.sheet === 'glint') !== over) continue;
      const t = now - f.start;
      if (t < 0) continue;
      const s = sheet(f.sheet);
      const frames = s?.anims[f.key];
      if (!s || !frames) continue;
      const frame = f.frame !== undefined ? frames[f.frame]! : frameAt(frames, t);
      const fade = f.fade ?? 0;
      ctx.globalAlpha = fade > 0 ? Math.max(0, Math.min(1, (f.life - t) / fade)) : 1;
      drawFrame(ctx, s, frame, Math.round(f.x), Math.round(f.y));
    }
    ctx.globalAlpha = 1;
  }
}
