import {
  cellX, cellY, type Effect, F, heroById, LENGTH, type Level, T, terrainFlags, type TrapKind, visibleCells, WIDTH, type World,
} from '@pd/core';
import type { Sound } from './audio';
import { fx } from './fx';
import { quality } from './quality';
import type { View } from './view';

/*
 * Shattered's own effects on the levels (effects/*, effects/particles/*), drawn from its effect sheets
 * (effects/specks.png, effects/effects.png): what each trap shows as it goes off (levels/traps/*Trap.activate),
 * the blobs the traps let loose (Fire, Freezing, Electricity, ConfusionGas), the death ray (Beam.DeathRay),
 * wounds, teleport lights, the pitfall's crumbling floor, falling rocks, wool, and the lasting emitters of
 * the level's features: the sacrificial fire, the eternal fire, a garden's shafts of light, the alchemy
 * pot's bubbles, the wells' healing crosses and question marks, and a sentry charging up.
 *
 * Everything here is cosmetic: particles live in world pixels (a tile is 16) on the visual clock.
 */

const TILE = 16;
const BASE = `${import.meta.env.BASE_URL}assets/spd/effects/`;

/** The trap's own sounds as Trap.activate plays them, after the click; `seen`: only where the party can see the trap. */
export const TRAP_ACTIVATION: Partial<Record<TrapKind, ReadonlyArray<{ sound: Sound; rate?: number; seen?: boolean }>>> = {
  // AlarmTrap, GuardianTrap: ALERT, heard throughout the level.
  alarm: [{ sound: 'alert' }],
  guardian: [{ sound: 'alert' }],
  // BurningTrap, BlazingTrap: BURNING.
  burning: [{ sound: 'burning' }],
  blazing: [{ sound: 'burning' }],
  // ChillingTrap, FrostTrap: SHATTER, when seen.
  chilling: [{ sound: 'shatter', seen: true }],
  frost: [{ sound: 'shatter', seen: true }],
  // ToxicTrap, ConfusionTrap, CorrosionTrap: GAS.
  toxic: [{ sound: 'gas' }],
  confusion: [{ sound: 'gas' }],
  corrosion: [{ sound: 'gas' }],
  // GeyserTrap: GAS, a little deeper.
  geyser: [{ sound: 'gas', rate: 0.75 }],
  // CursingTrap: CURSED, when seen.
  cursing: [{ sound: 'cursed', seen: true }],
  // FlashingTrap: BLAST, when seen.
  flashing: [{ sound: 'blast', seen: true }],
  // FlockTrap: PUFF and SHEEP.
  flock: [{ sound: 'puff' }, { sound: 'sheep' }],
  // ShockingTrap, StormTrap: LIGHTNING, when seen.
  shocking: [{ sound: 'lightning', seen: true }],
  storm: [{ sound: 'lightning', seen: true }],
  // The rest sound through what they do: the teleports (TELEPORT), the death ray (RAY), the grim trap's bolt
  // (CURSED or BURNING), the darts (HIT), the rocks (ROCKS), the explosion (BLAST).
};

/** Whether a trap's teleports and the like should be shown as Shattered's (light specks) rather than a puff of smoke. */
export const TELEPORTING: ReadonlySet<TrapKind> = new Set<TrapKind>(['teleportation', 'warping', 'gateway', 'disarming']);

/* Speck (effects/Speck.java): its frames in specks.png (7x7) and the behaviours used here. */
const SPECK = 7;
const HEALING = 0;
const LIGHT = 2;
const QUESTION = 3;
const SCREAM = 5;
const WOOL = 7;
const ROCK = 8;
const BUBBLE = 12;
const STEAM = 13;
const DISCOVER = 101;
const CONFUSION = 113;

interface Speck {
  type: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  ax: number;
  ay: number;
  angle: number;
  spin: number;
  scale: number;
  born: number;
  life: number;
  /** Speck.hardlight: drawn in this colour (r, g, b), or as it is. */
  tint?: string;
  light?: boolean;
}

/** PixelParticle and its kinds (effects/particles/*). */
type PixelKind = 'flame' | 'elmo' | 'sacrificial' | 'shadow' | 'spark' | 'snow' | 'splash' | 'pit' | 'magic' | 'ward' | 'shaft';

interface Pixel {
  kind: PixelKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  ax: number;
  ay: number;
  born: number;
  life: number;
  size: number;
  /** "r, g, b". */
  color: string;
  /** PitfallParticle's tilt, degrees. */
  angle?: number;
}

/** Emitter.start(factory, interval, quantity) on a rectangle (CellEmitter.get: a cell; CellEmitter.center: a point). */
interface Emitter {
  x: number;
  y: number;
  w: number;
  h: number;
  emit: (x: number, y: number, now: number) => void;
  interval: number;
  left: number;
  next: number;
}

/** Beam.DeathRay: a ray from one point to another, thinning and fading over half a second. */
interface Beam {
  sx: number;
  sy: number;
  ex: number;
  ey: number;
  born: number;
  life: number;
}

/** Wound: a red gash over whoever was cut, fading over a second. */
interface Wound {
  x: number;
  y: number;
  born: number;
}

const MAX_PIXELS = 900;
const MAX_SPECKS = 300;

const rnd = (a: number, b: number): number => a + Math.random() * (b - a);
const hex = (c: number): string => `${(c >> 16) & 255}, ${(c >> 8) & 255}, ${c & 255}`;
/** ColorMath.interpolate between two colours, as "r, g, b". */
const mix = (a: number, b: number, k: number): string => {
  const ch = (s: number): number => Math.round(((a >> s) & 255) + (((b >> s) & 255) - ((a >> s) & 255)) * k);
  return `${ch(16)}, ${ch(8)}, ${ch(0)}`;
};
const cellRect = (cell: number): { x: number; y: number } => ({ x: cellX(cell) * TILE, y: cellY(cell) * TILE });
const cellCentre = (cell: number): { x: number; y: number } => ({ x: cellX(cell) * TILE + TILE / 2, y: cellY(cell) * TILE + TILE / 2 });

/** How many of a burst to show: a third on light effects. */
const fewer = (n: number): number => (quality.lean ? Math.ceil(n / 3) : n);

function loadImage(name: string): HTMLImageElement | null {
  if (typeof Image === 'undefined') return null;
  const image = new Image();
  image.src = `${BASE}${name}.png`;
  return image;
}

class LevelFx {
  private pixels: Pixel[] = [];
  private specks: Speck[] = [];
  private emitters: Emitter[] = [];
  private beams: Beam[] = [];
  private wounds: Wound[] = [];
  private specksImage: HTMLImageElement | null = null;
  private effectsImage: HTMLImageElement | null = null;
  private readonly tinted = new Map<string, HTMLCanvasElement>();
  private last = 0;
  /** The trap that went off last, and when: what comes with it in the same update belongs to it. */
  private trap: { kind: TrapKind; pos: number; at: number } | null = null;
  /** A grim trap that went off: if no bolt left it in the same update, it had no one to aim at. */
  private grim: { pos: number; at: number } | null = null;
  /** The level last shown: a new one starts with nothing. */
  private level: Level | null = null;

  reset(): void {
    this.pixels = [];
    this.specks = [];
    this.emitters = [];
    this.beams = [];
    this.wounds = [];
    this.trap = null;
    this.grim = null;
  }

  /* Factories (Emitter.Factory): one particle at (x, y). */

  /** FlameParticle (lightMode): an orange square rising and shrinking. ElmoParticle: the same, green; SacrificialParticle: blue. */
  private flame(kind: 'flame' | 'elmo' | 'sacrificial', x: number, y: number, now: number): void {
    const color = kind === 'flame' ? 0xee7722 : kind === 'elmo' ? 0x22ee66 : 0x4488ee;
    this.pixel({ kind, x, y: kind === 'sacrificial' ? y - 4 : y, vx: 0, vy: 0, ax: 0, ay: kind === 'sacrificial' ? -100 : -80, born: now, life: 600, size: 4, color: hex(color) });
  }

  /** ShadowParticle.UP: a dark wisp rising; .CURSE: drawn in from around. */
  private shadow(x: number, y: number, now: number, curse = false): void {
    if (curse) {
      const a = Math.random() * Math.PI * 2;
      const s = rnd(16, 32);
      const vx = Math.cos(a) * s;
      const vy = Math.sin(a) * s;
      this.pixel({ kind: 'shadow', x: x - vx * 0.5, y: y - vy * 0.5, vx, vy, ax: 0, ay: 0, born: now, life: 500, size: 8, color: '0, 0, 0' });
      return;
    }
    this.pixel({ kind: 'shadow', x, y, vx: rnd(-8, 8), vy: rnd(-48, -32), ax: 0, ay: 0, born: now, life: 1000, size: 6, color: '0, 0, 0' });
  }

  /** SparkParticle (lightMode): a white spark thrown up, flickering smaller. */
  private spark(x: number, y: number, now: number): void {
    const a = -Math.random() * Math.PI;
    const s = rnd(20, 40);
    this.pixel({ kind: 'spark', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, ax: 0, ay: 50, born: now, life: rnd(500, 1000), size: 5, color: '255, 255, 255' });
  }

  /** SnowParticle: a flake drifting down, fading in and out. */
  private snow(x: number, y: number, now: number): void {
    const vy = rnd(5, 8);
    this.pixel({ kind: 'snow', x, y: y - vy * 1.2, vx: 0, vy, ax: 0, ay: 0, born: now, life: 1200, size: 1, color: '255, 255, 255' });
  }

  /** Splash: drops of a colour thrown out in a cone (`dir` and `cone` radians), falling back. */
  private splash(x: number, y: number, color: number, dir: number, cone: number, now: number): void {
    const a = rnd(dir - cone / 2, dir + cone / 2);
    const s = rnd(40, 80);
    this.pixel({ kind: 'splash', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, ax: 0, ay: 100, born: now, life: rnd(500, 1000), size: 4, color: hex(color) });
  }

  /** PitfallParticle: a black square on the floor, tilted, shrinking away as the ground gives. */
  private pit(x: number, y: number, size: number, now: number): void {
    this.pixel({ kind: 'pit', x, y, vx: 0, vy: 0, ax: 0, ay: 0, born: now, life: 1000, size, color: '0, 0, 0', angle: rnd(-30, 30) });
  }

  /** MagicMissile.MagicParticle.ATTRACTING (lightMode): light drawn in to a point, growing as it fades. */
  private magic(x: number, y: number, now: number): void {
    const a = Math.random() * Math.PI * 2;
    const s = rnd(16, 32);
    const vx = Math.cos(a) * s;
    const vy = Math.sin(a) * s;
    this.pixel({ kind: 'magic', x: x - vx * 0.5, y: y - vy * 0.5, vx, vy, ax: 0, ay: 0, born: now, life: 500, size: 1, color: hex(0x88ccff) });
  }

  /** MagicMissile.WardParticle.UP (lightMode): a violet square rising. */
  private ward(x: number, y: number, now: number): void {
    this.pixel({ kind: 'ward', x, y, vx: rnd(-8, 8), vy: rnd(-48, -32), ax: 0, ay: 0, born: now, life: 600, size: 8, color: hex(0x8822ff) });
  }

  /** ShaftParticle (lightMode): a thin shaft of light rising slowly, widening, then gone. */
  private shaft(x: number, y: number, now: number): void {
    const offs = Math.random() * 1200;
    this.pixel({ kind: 'shaft', x, y, vx: 0, vy: -6, ax: 0, ay: 0, born: now - offs, life: 1200 + offs, size: 1, color: '255, 255, 255' });
  }

  private pixel(p: Pixel): void {
    if (this.pixels.length < (quality.light ? MAX_PIXELS / 3 : MAX_PIXELS)) this.pixels.push(p);
  }

  /** Speck.reset: a speck of a kind at (x, y), as Speck.java sets it going. */
  private speck(type: number, x: number, y: number, now: number): void {
    if (this.specks.length >= MAX_SPECKS) return;
    const s: Speck = { type, x, y, vx: 0, vy: 0, ax: 0, ay: 0, angle: 0, spin: 0, scale: 1, born: now, life: 1000 };
    switch (type) {
      case HEALING:
        s.vy = -20;
        break;
      case LIGHT:
      case DISCOVER:
        s.angle = Math.random() * 360;
        s.spin = 90;
        s.life = type === DISCOVER ? 500 : 1000;
        break;
      case QUESTION:
        s.life = 800;
        break;
      case SCREAM:
        s.life = 900;
        break;
      case WOOL:
        s.life = 500;
        s.vy = -50;
        s.angle = Math.random() * 360;
        s.spin = rnd(-360, 360);
        break;
      case ROCK:
        s.angle = Math.random() * 360;
        s.spin = rnd(-360, 360);
        s.scale = rnd(1, 2);
        s.vy = 64;
        s.life = 200;
        s.y -= 64 * 0.2;
        break;
      case BUBBLE:
        s.vy = -15;
        s.scale = rnd(0.8, 1);
        s.life = rnd(800, 1500);
        break;
      case CONFUSION: {
        // hardlight(Random.Int(0x1000000) | 0x000080), drawn as light.
        const c = Math.floor(Math.random() * 0x1000000) | 0x80;
        s.tint = hex(c & 0xe0e0e0);
        s.light = true;
        s.spin = rnd(-20, 20);
        s.angle = Math.random() * 360;
        s.life = rnd(1000, 3000);
        break;
      }
    }
    if (quality.reducedMotion) s.spin = 0;
    this.specks.push(s);
  }

  /** Emitter.burst: `n` at once, anywhere on the rectangle. */
  private burst(rect: { x: number; y: number; w?: number; h?: number }, n: number, emit: (x: number, y: number, now: number) => void, now: number): void {
    for (let i = 0; i < fewer(n); i++) emit(rect.x + Math.random() * (rect.w ?? 0), rect.y + Math.random() * (rect.h ?? 0), now);
  }

  /** Emitter.start: one every `interval` ms, `quantity` in all, anywhere on the rectangle. */
  private start(rect: { x: number; y: number; w?: number; h?: number }, interval: number, quantity: number, emit: (x: number, y: number, now: number) => void, now: number): void {
    const step = quality.light ? interval * 3 : interval;
    this.emitters.push({ x: rect.x, y: rect.y, w: rect.w ?? 0, h: rect.h ?? 0, emit, interval: step, left: quality.light ? Math.ceil(quantity / 3) : quantity, next: now + step });
  }

  /** A cell as an emitter's rectangle (CellEmitter.get). */
  private static cell(cell: number): { x: number; y: number; w: number; h: number } {
    return { ...cellRect(cell), w: TILE, h: TILE };
  }

  /** Where a character is drawn (its sprite's middle), or the middle of a cell. */
  private static centre(view: View, id: string | undefined, cell: number, now: number): { x: number; y: number } {
    const puppet = id ? view.puppets.get(id) : undefined;
    if (!puppet) return cellCentre(cell);
    const at = view.position(puppet, now);
    return { x: at.x + TILE / 2, y: at.y + TILE - Math.min(puppet.sprite.sheet.h, TILE) / 2 - 1 };
  }

  /** The look of an effect on the levels (called with every effect, after the view has taken it in). */
  effect(effect: Effect, view: View, world: World, myId: string, now: number): void {
    if ('depth' in effect && effect.depth !== view.depth && effect.type !== 'branched') return;
    let sight: boolean[] | undefined;
    const seen = (cell: number): boolean => (sight ??= visibleCells(world, view.depth))[cell] === true;
    const level = world.levels[view.depth];
    const solid = (cell: number): boolean => ((terrainFlags[level?.map[cell] ?? T.WALL] ?? 0) & F.SOLID) !== 0;
    // A trap's companions come in the same update, right after it.
    const trap = this.trap && this.trap.at === now ? this.trap : null;
    const N9 = [-WIDTH - 1, -WIDTH, -WIDTH + 1, -1, 0, 1, WIDTH - 1, WIDTH, WIDTH + 1];
    switch (effect.type) {
      case 'trap': {
        this.trap = { kind: effect.kind, pos: effect.pos, at: now };
        const pos = effect.pos;
        const centre = cellCentre(pos);
        const inSight = seen(pos);
        switch (effect.kind) {
          case 'alarm':
          case 'guardian':
            // AlarmTrap: CellEmitter.center(pos).start(Speck.SCREAM, 0.3, 3), when seen.
            if (inSight) this.start(centre, 300, 3, (x, y, t) => this.speck(SCREAM, x, y, t), now);
            break;
          case 'chilling':
          case 'frost':
            // ChillingTrap, FrostTrap: Splash.at(pos, 0xB2D6FF, 5), when seen.
            if (inSight) this.burst(centre, 5, (x, y, t) => this.splash(x, y, 0xb2d6ff, -Math.PI / 2, Math.PI, t), now);
            break;
          case 'cursing':
          case 'weakening':
            // CursingTrap, WeakeningTrap: CellEmitter.get(pos).burst(ShadowParticle.UP, 5), when seen.
            if (inSight) this.burst(LevelFx.cell(pos), 5, (x, y, t) => this.shadow(x, y, t), now);
            break;
          case 'flashing':
            // FlashingTrap: GameScene.flash(0x80FFFFFF), when seen.
            if (inSight) fx.flash('255, 255, 255', 0.5, 500, now);
            break;
          case 'gripping':
            // GrippingTrap: Wound.hit on whoever stands there, or on the cell.
            this.wounds.push({ ...LevelFx.centre(view, effect.mob ?? (effect.hero || undefined), pos, now), born: now });
            break;
          case 'ooze':
            // OozeTrap: Splash.at(pos + i, 0x000000, 5) on every open cell around.
            for (const n of N9) if (!solid(pos + n)) this.burst(cellCentre(pos + n), 5, (x, y, t) => this.splash(x, y, 0x000000, -Math.PI / 2, Math.PI, t), now);
            break;
          case 'geyser':
            // GeyserTrap: Splash.at(centre, -PI/2, PI/2, 0x5bc1e3, 100, 0.01): a fountain for a second.
            this.start(centre, 10, 100, (x, y, t) => this.splash(x, y, 0x5bc1e3, -Math.PI / 2, Math.PI / 2, t), now);
            break;
          case 'grim':
            // GrimTrap with no one to aim at: CellEmitter.get(pos).burst(ShadowParticle.UP, 10) (unless its bolt follows).
            this.grim = { pos, at: now };
            break;
        }
        return;
      }
      case 'blob': {
        // Blob.seed: the blob's own emitter on each cell for as long as it lasts (the core works it out at once:
        // shown here for about as long as Shattered's would burn, freeze, spark or linger).
        const big = effect.cells.length > 9;
        for (const cell of effect.cells) {
          const rect = LevelFx.cell(cell);
          if (effect.blob === 'fire') {
            // BurningTrap, BlazingTrap: CellEmitter.get(i).burst(FlameParticle, 5); Fire.use: pour(FlameParticle, 0.03).
            this.burst(rect, 5, (x, y, t) => this.flame('flame', x, y, t), now);
            this.start(rect, 30, Math.round((big ? 2500 : 1200) / 30), (x, y, t) => this.flame('flame', x, y, t), now);
          } else if (effect.blob === 'freezing') {
            // Freezing.use: start(SnowParticle, 0.05).
            this.start(rect, 50, Math.round((big ? 3500 : 2000) / 50), (x, y, t) => this.snow(x, y, t), now);
          } else if (effect.blob === 'electricity') {
            // Electricity.use: start(SparkParticle, 0.05).
            this.start(rect, 50, Math.round((big ? 2500 : 1500) / 50), (x, y, t) => this.spark(x, y, t), now);
          } else {
            // ConfusionGas.use: pour(Speck.CONFUSION, 0.4), lit.
            this.start(rect, 400, 10, (x, y, t) => this.speck(CONFUSION, x, y, t), now);
          }
        }
        return;
      }
      case 'itemTeleported':
        // TeleportationTrap, GatewayTrap, DisarmingTrap: CellEmitter.get(pos).burst(Speck.LIGHT, 4).
        if (seen(effect.from)) this.burst(LevelFx.cell(effect.from), 4, (x, y, t) => this.speck(LIGHT, x, y, t), now);
        return;
      case 'pitfall':
        // PitfallTrap: CellEmitter.floor(cell).burst(PitfallParticle.FACTORY4, 8); DelayedPit: FACTORY8, 12.
        for (const cell of effect.cells) {
          if (effect.stage === 'warn') this.burst(LevelFx.cell(cell), 8, (x, y, t) => this.pit(x, y, 4, t), now);
          else if (effect.stage === 'open') this.burst(LevelFx.cell(cell), 12, (x, y, t) => this.pit(x, y, 8, t), now);
        }
        return;
      case 'appeared': {
        if (!seen(effect.pos)) return;
        const kind = view.puppets.get(effect.mob)?.kind ?? world.floors[view.depth]?.mobs.find((m) => m.id === effect.mob)?.kind;
        if (kind === 'wraith') {
          // Wraith.spawnAt: sprite.emitter().burst(ShadowParticle.CURSE, 5).
          const at = cellCentre(effect.pos);
          this.burst(at, 5, (x, y, t) => this.shadow(x, y, t, true), now);
        } else if (trap) {
          // ScrollOfTeleportation.appear: sprite.emitter().start(Speck.LIGHT, 0.2, 3).
          this.start(LevelFx.cell(effect.pos), 200, 3, (x, y, t) => this.speck(LIGHT, x, y, t), now);
        }
        return;
      }
      case 'teleported': {
        // ScrollOfTeleportation.appear for a hero: Speck.LIGHT on the sprite where it lands.
        const hero = heroById(world, effect.hero);
        if (hero && hero.depth === view.depth) this.start(LevelFx.cell(hero.pos), 200, 3, (x, y, t) => this.speck(LIGHT, x, y, t), now);
        return;
      }
      case 'jumped':
        // A monster a trap teleported: light where it was, and on it where it lands (not Tengu's smoke).
        if (!trap || !TELEPORTING.has(trap.kind)) return;
        if (seen(effect.from)) this.start(LevelFx.cell(effect.from), 200, 3, (x, y, t) => this.speck(LIGHT, x, y, t), now);
        if (seen(effect.to)) this.start(LevelFx.cell(effect.to), 200, 3, (x, y, t) => this.speck(LIGHT, x, y, t), now);
        return;
      case 'zapped': {
        if (effect.bolt === 'beam') {
          // Beam.DeathRay from the trap's cell (or the sentry's, the eye's middle) to whoever it strikes; the sentry's WardParticle.UP.
          const shooter = [...view.puppets.values()].find((p) => p.alive && p.to === effect.from);
          const from = LevelFx.centre(view, shooter?.id, effect.from, now);
          const to = LevelFx.centre(view, [...view.puppets.values()].find((p) => p.alive && p.to === effect.to)?.id, effect.to, now);
          if (seen(effect.from) || seen(effect.to)) this.beams.push({ sx: from.x, sy: from.y, ex: to.x, ey: to.y, born: now, life: 500 });
          if (shooter?.kind === 'sentry') this.burst(from, 2, (x, y, t) => this.ward(x, y, t), now);
        } else if (effect.bolt === 'shadow' && trap?.kind === 'grim' && trap.pos === effect.from) {
          // GrimTrap: once the bolt lands, target.sprite.emitter().burst(ShadowParticle.UP, 10).
          const cells = Math.max(Math.abs(cellX(effect.to) - cellX(effect.from)), Math.abs(cellY(effect.to) - cellY(effect.from)));
          this.grim = null;
          this.start(LevelFx.cell(effect.to), 1, 10, (x, y, t) => this.shadow(x, y, t), now + Math.max(90, cells * 45) - 1);
        }
        return;
      }
      case 'avalanche': {
        // RockfallTrap (and the wand of avalanche): CellEmitter.get(cell - width).start(Speck.ROCK, 0.07, 10) on
        // each cell in sight; PixelScene.shake(3, 0.7) if any was.
        let any = false;
        for (const cell of effect.cells) {
          if (!seen(cell)) continue;
          any = true;
          this.start(LevelFx.cell(cell - WIDTH), 70, 10, (x, y, t) => this.speck(ROCK, x, y, t), now);
        }
        if (any) fx.shake(3, 700, now);
        return;
      }
      case 'flock':
        // FlockTrap: CellEmitter.get(i).burst(Speck.WOOL, 4) where each sheep appears.
        for (const cell of effect.cells) if (seen(cell)) this.burst(LevelFx.cell(cell), 4, (x, y, t) => this.speck(WOOL, x, y, t), now);
        return;
      case 'discovered':
        // ScrollOfMagicMapping.discover: CellEmitter.get(cell).start(Speck.DISCOVER, 0.1, 4).
        this.start(LevelFx.cell(effect.cell), 100, 4, (x, y, t) => this.speck(DISCOVER, x, y, t), now);
        return;
      case 'marked': {
        // SacrificialFire: CellEmitter.get(cell).burst(SacrificialParticle, 5) on whoever it marks, when seen.
        const puppet = view.puppets.get(effect.who);
        if (puppet && seen(puppet.to)) this.burst(LevelFx.cell(puppet.to), 5, (x, y, t) => this.flame('sacrificial', x, y, t), now);
        return;
      }
      case 'sacrifice':
        // SacrificialFire.sacrifice: a burst of 20 on the fire; for the reward, on it and every cell around.
        if (effect.outcome === 'reward') {
          for (const n of N9) this.burst(LevelFx.cell(effect.pos + n), 20, (x, y, t) => this.flame('sacrificial', x, y, t), now);
        } else if (effect.outcome === 'worthy') {
          this.burst(LevelFx.cell(effect.pos), 20, (x, y, t) => this.flame('sacrificial', x, y, t), now);
        }
        return;
      case 'branched':
        // InterlevelScene: off to the other level, which comes up out of the dark.
        if (effect.hero !== myId) return;
        this.reset();
        fx.reset();
        fx.flash('0, 0, 0', 1, 650, now);
        return;
      default:
        return;
    }
  }

  /**
   * Every frame: the lasting emitters of what is in sight (BlobEmitter for the sacrificial fire, eternal fire,
   * foliage, the alchemy pot and the wells; a sentry's charge), and everything moved on.
   */
  frame(world: World, depth: number, visible: readonly boolean[], view: View, now: number): void {
    const level = world.levels[depth];
    if (level !== this.level) {
      this.level = level ?? null;
      this.reset();
    }
    const dt = this.last ? Math.min(100, Math.max(0, now - this.last)) : 0;
    this.last = now;
    if (!level) return;
    const floor = world.floors[depth];
    if (this.grim && now > this.grim.at) {
      if (visible[this.grim.pos]) this.burst(LevelFx.cell(this.grim.pos), 10, (x, y, t) => this.shadow(x, y, t), now);
      this.grim = null;
    }
    /** Emitter.pour / start(…, 0): `per` ms between particles, on average, on a rectangle. */
    const pour = (rect: { x: number; y: number; w?: number; h?: number }, per: number, emit: (x: number, y: number, t: number) => void): void => {
      const expected = (dt / per) * (quality.light ? 1 / 3 : 1);
      let n = Math.floor(expected) + (Math.random() < expected % 1 ? 1 : 0);
      while (n-- > 0) emit(rect.x + Math.random() * (rect.w ?? 0), rect.y + Math.random() * (rect.h ?? 0), now);
    };
    if (dt > 0) {
      // SacrificialFire.use: pour(SacrificialParticle, 0.01 + volume / max * 0.09).
      const altar = floor?.altar;
      if (altar && altar.volume > 0 && visible[altar.pos]) {
        const max = 6 + depth * 4;
        pour(LevelFx.cell(altar.pos), 10 + Math.min(1, altar.volume / max) * 90, (x, y, t) => this.flame('sacrificial', x, y, t));
      }
      // MagicalFireRoom.EternalFire.use: pour(ElmoParticle, 0.02).
      for (const cell of level.eternalFire ?? []) if (visible[cell]) pour(LevelFx.cell(cell), 20, (x, y, t) => this.flame('elmo', x, y, t));
      // Foliage.use: start(ShaftParticle, 0.9).
      for (const cell of floor?.foliage ?? []) if (visible[cell]) pour(LevelFx.cell(cell), 900, (x, y, t) => this.shaft(x, y, t));
      // WaterOfHealth: start(Speck.HEALING, 0.5); WaterOfAwareness: pour(Speck.QUESTION, 0.3).
      for (const well of level.wells ?? []) {
        if (!visible[well.pos] || level.map[well.pos] !== T.WELL) continue;
        if (well.water === 'health') pour(LevelFx.cell(well.pos), 500, (x, y, t) => this.speck(HEALING, x, y, t));
        else if (well.water === 'awareness') pour(LevelFx.cell(well.pos), 300, (x, y, t) => this.speck(QUESTION, x, y, t));
      }
      // Alchemy.use: start(Speck.BUBBLE, 0.33) over the pot.
      for (let cell = 0; cell < LENGTH; cell++) {
        if (level.map[cell] === T.ALCHEMY && visible[cell]) pour(LevelFx.cell(cell), 330, (x, y, t) => this.speck(BUBBLE, x, y, t));
      }
      // SentrySprite: while charging, pour(MagicParticle.ATTRACTING, 0.05) about its middle.
      for (const mob of floor?.mobs ?? []) {
        if (mob.kind !== 'sentry' || mob.curChargeDelay === undefined || mob.curChargeDelay === mob.initialChargeDelay || !visible[mob.pos]) continue;
        const at = LevelFx.centre(view, mob.id, mob.pos, now);
        pour(at, 50, (x, y, t) => this.magic(x, y, t));
      }
    }
    this.update(now, dt);
  }

  private update(now: number, dt: number): void {
    const step = dt / 1000;
    let n = 0;
    for (const e of this.emitters) {
      while (e.left > 0 && now >= e.next) {
        e.emit(e.x + Math.random() * e.w, e.y + Math.random() * e.h, e.next);
        e.left--;
        e.next += e.interval;
      }
      if (e.left > 0) this.emitters[n++] = e;
    }
    this.emitters.length = n;
    n = 0;
    for (const p of this.pixels) {
      if (now - p.born >= p.life) continue;
      if (now >= p.born) {
        p.vx += p.ax * step;
        p.vy += p.ay * step;
        p.x += p.vx * step;
        p.y += p.vy * step;
      }
      this.pixels[n++] = p;
    }
    this.pixels.length = n;
    n = 0;
    for (const s of this.specks) {
      if (now - s.born >= s.life) continue;
      if (now >= s.born) {
        s.vx += s.ax * step;
        s.vy += s.ay * step;
        s.x += s.vx * step;
        s.y += s.vy * step;
        s.angle += s.spin * step;
      }
      this.specks[n++] = s;
    }
    this.specks.length = n;
    this.beams = this.beams.filter((b) => now - b.born < b.life);
    this.wounds = this.wounds.filter((w) => now - w.born < 1000);
  }

  /** What lies on the floor, under the characters (GameScene.floorEmitter): the pitfall's crumbling ground. */
  drawFloor(ctx: CanvasRenderingContext2D, now: number, visible: (x: number, y: number) => boolean): void {
    for (const p of this.pixels) if (p.kind === 'pit') this.drawPixel(ctx, p, now, visible);
    ctx.globalAlpha = 1;
  }

  /** Everything else, over the characters (world space, the camera's transform set), where the party can see. */
  draw(ctx: CanvasRenderingContext2D, now: number, visible: (x: number, y: number) => boolean): void {
    for (const glow of [false, true]) {
      ctx.globalCompositeOperation = glow ? 'lighter' : 'source-over';
      for (const p of this.pixels) if (p.kind !== 'pit' && LIT.has(p.kind) === glow) this.drawPixel(ctx, p, now, visible);
    }
    ctx.globalCompositeOperation = 'source-over';
    this.drawSpecks(ctx, now, visible);
    this.drawEffects(ctx, now, visible);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  private drawPixel(ctx: CanvasRenderingContext2D, p: Pixel, now: number, visible: (x: number, y: number) => boolean): void {
    const age = now - p.born;
    if (age < 0 || !visible(p.x, p.y)) return;
    // PixelParticle: k is left / lifespan, 1 to 0.
    const k = Math.max(0, 1 - age / p.life);
    let size = p.size;
    let alpha = 1;
    let color = p.color;
    let w = 0;
    let h = 0;
    switch (p.kind) {
      case 'flame': case 'elmo':
        size = p.size * k;
        alpha = k > 0.8 ? (1 - k) * 5 : 1;
        break;
      case 'sacrificial':
        size = p.size * k;
        alpha = k > 0.75 ? (1 - k) * 4 : 1;
        break;
      case 'shadow':
        // alpha 0 -> 1 -> 0, size 6 -> 0, colour 0x440044 -> 0x000000.
        size = p.size * k;
        color = mix(0x000000, 0x440044, k);
        alpha = k < 0.5 ? k * k * 4 : (1 - k) * 2;
        break;
      case 'spark':
        size = Math.random() * p.size * k;
        break;
      case 'snow':
        alpha = (k < 0.5 ? k : 1 - k) * 1.5;
        break;
      case 'splash': case 'pit': case 'ward':
        size = p.size * k;
        break;
      case 'magic':
        alpha = k;
        size = 4 - k * 3;
        break;
      case 'shaft':
        alpha = k < 0.5 ? k : 1 - k;
        w = (1 - k) * 4;
        h = 16 + (1 - k) * 16;
        break;
    }
    if (alpha <= 0) return;
    ctx.globalAlpha = Math.min(1, alpha);
    ctx.fillStyle = `rgb(${color})`;
    if (p.kind === 'shaft') {
      ctx.fillRect(p.x - w / 2, p.y - h / 2, Math.max(0.5, w), h);
      return;
    }
    const s = Math.round(size);
    if (s <= 0) return;
    if (p.angle) {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate((p.angle * Math.PI) / 180);
      ctx.fillRect(-s / 2, -s / 2, s, s);
      ctx.restore();
      return;
    }
    ctx.fillRect(Math.round(p.x - s / 2), Math.round(p.y - s / 2), s, s);
  }

  private image(which: 'specks' | 'effects'): HTMLImageElement | null {
    if (which === 'specks') this.specksImage ??= loadImage('specks');
    else this.effectsImage ??= loadImage('effects');
    const image = which === 'specks' ? this.specksImage : this.effectsImage;
    return image && image.complete && image.naturalWidth > 0 ? image : null;
  }

  /** A sheet drawn in one colour (Speck.hardlight, Wound's red), kept once made. */
  private tint(image: HTMLImageElement, color: string): HTMLCanvasElement {
    const key = `${image.src}|${color}`;
    let canvas = this.tinted.get(key);
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const g = canvas.getContext('2d')!;
      g.drawImage(image, 0, 0);
      g.globalCompositeOperation = 'source-atop';
      g.fillStyle = `rgb(${color})`;
      g.fillRect(0, 0, canvas.width, canvas.height);
      this.tinted.set(key, canvas);
    }
    return canvas;
  }

  private drawSpecks(ctx: CanvasRenderingContext2D, now: number, visible: (x: number, y: number) => boolean): void {
    const image = this.image('specks');
    if (!image) return;
    const cols = Math.floor(image.width / SPECK);
    for (const s of this.specks) {
      const age = now - s.born;
      if (age < 0 || !visible(s.x, s.y)) continue;
      // Speck.update: p goes 0 -> 1.
      const p = Math.min(1, age / s.life);
      let alpha = 1;
      let sx = s.scale;
      let sy = s.scale;
      let frame = s.type;
      switch (s.type) {
        case HEALING:
          alpha = p < 0.5 ? 1 : 2 - p * 2;
          break;
        case LIGHT:
          alpha = sx = sy = p < 0.2 ? p * 5 : (1 - p) * 1.25;
          break;
        case DISCOVER:
          frame = LIGHT;
          alpha = 1 - p;
          sx = sy = (p < 0.5 ? p : 1 - p) * 2;
          break;
        case QUESTION:
          sx = sy = Math.sqrt(p < 0.5 ? p : 1 - p) * 3;
          break;
        case SCREAM:
          alpha = Math.sqrt((p < 0.5 ? p : 1 - p) * 2);
          sx = sy = p * 7;
          break;
        case ROCK:
          alpha = p < 0.2 ? p * 5 : 1;
          break;
        case WOOL:
          sx = sy = 1 - p;
          break;
        case BUBBLE:
          alpha = p < 0.2 ? p * 5 : 1;
          break;
        case CONFUSION:
          frame = STEAM;
          alpha = Math.sqrt((p < 0.5 ? p : 1 - p) * 0.5);
          sx = sy = 1 + p;
          break;
      }
      if (alpha <= 0 || sx <= 0) continue;
      ctx.globalAlpha = Math.min(1, alpha);
      ctx.globalCompositeOperation = s.light ? 'lighter' : 'source-over';
      ctx.save();
      ctx.translate(s.x, s.y);
      if (s.angle) ctx.rotate((s.angle * Math.PI) / 180);
      ctx.scale(sx, sy);
      ctx.drawImage(s.tint ? this.tint(image, s.tint) : image, (frame % cols) * SPECK, Math.floor(frame / cols) * SPECK, SPECK, SPECK, -SPECK / 2, -SPECK / 2, SPECK, SPECK);
      ctx.restore();
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  /** Beams and wounds, from effects.png (Effects.Type.DEATH_RAY: 16,16 16x8; WOUND: 16,8 16x8). */
  private drawEffects(ctx: CanvasRenderingContext2D, now: number, visible: (x: number, y: number) => boolean): void {
    const image = this.image('effects');
    if (!image) return;
    ctx.globalCompositeOperation = 'lighter';
    for (const b of this.beams) {
      const p = Math.max(0, 1 - (now - b.born) / b.life);
      const len = Math.hypot(b.ex - b.sx, b.ey - b.sy);
      if (p <= 0 || len < 1) continue;
      ctx.globalAlpha = p;
      ctx.save();
      ctx.translate(b.sx, b.sy);
      ctx.rotate(Math.atan2(b.ey - b.sy, b.ex - b.sx));
      ctx.scale(len / 16, p);
      ctx.drawImage(image, 16, 16, 16, 8, 0, -4, 16, 8);
      ctx.restore();
    }
    ctx.globalCompositeOperation = 'source-over';
    const red = this.wounds.length > 0 ? this.tint(image, '255, 0, 0') : null;
    for (const w of this.wounds) {
      if (!red || !visible(w.x, w.y)) continue;
      const p = Math.max(0, 1 - (now - w.born) / 1000);
      ctx.globalAlpha = Math.sqrt(p);
      ctx.save();
      ctx.translate(w.x, w.y);
      ctx.scale(1 + p, 1);
      ctx.drawImage(red, 16, 8, 16, 8, -8, -4, 16, 8);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }
}

/** The particles drawn as light (Emitter.Factory.lightMode). */
const LIT: ReadonlySet<PixelKind> = new Set<PixelKind>(['flame', 'elmo', 'sacrificial', 'spark', 'magic', 'ward', 'shaft']);

export const levelFx = new LevelFx();
