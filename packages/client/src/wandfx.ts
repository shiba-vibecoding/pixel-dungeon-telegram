import { fx, type BurstOptions } from './fx';
import { quality } from './quality';
import { loaded, shImage, WAND_BOLT_ROW } from './shfx';
import type { Puppet } from './view';

/*
 * The looks of Shattered's wands (effects/): the bolts' trails of particles
 * (MagicMissile and its particles), the beams (Beam: DeathRay, LightRay,
 * HealthRay), lightning's arcs (Lightning), the blast wave's ripple
 * (WandOfBlastWave.BlastWave), and the conditions creatures are seen under
 * (CharSprite's states: frozen in a block of ice, chilled with snow falling,
 * darkened by corruption or doom, shielded in a halo), the sentries bobbing
 * (WardSprite) and the lotus's leaves (LotusSprite). World pixels, the visual
 * clock; nothing here touches the world.
 */

/** MagicMissile.SPEED: 200 world pixels a second, a cell in 80 ms. */
export const BOLT_MS_PER_CELL = 80;

/** Each bolt's particles (MagicMissile's kinds): their colours and how they move. */
const TRAILS: Record<string, Omit<BurstOptions, 'count'>> = {
  // MagicParticle: white specks, glowing, drifting off.
  magic: { colors: ['#ffffff', '#d8ecff'], speed: [4, 16], life: [200, 400], glow: true, size: [1, 1] },
  // FlameParticle: orange, rising.
  fire: { colors: ['#ee7722', '#ffaa44', '#ffdd66'], speed: [4, 12], life: [250, 450], rise: 30, glow: true, size: [1, 2] },
  // FrostParticle: pale blue, sinking a little.
  frost: { colors: ['#88ccff', '#ffffff', '#b8e0ff'], speed: [4, 14], life: [300, 500], gravity: 20, glow: true, size: [1, 1] },
  // CorrosionParticle: grey to orange, falling.
  corrosion: { colors: ['#aaaaaa', '#ff8800', '#d49a40'], speed: [4, 12], life: [300, 500], gravity: 60, size: [1, 2] },
  // The force bolt (blast wave): dusty and brown.
  force: { colors: ['#664422', '#8a6a44'], speed: [6, 20], life: [200, 400], drag: 0.2, size: [1, 2] },
  // EarthParticle: brown and dull gold, falling.
  earth: { colors: ['#805500', '#332500', '#fff568', '#80791a'], speed: [4, 12], life: [300, 500], gravity: 90, size: [1, 2] },
  // WardParticle: purple, rising.
  ward: { colors: ['#8822ff', '#b070ff'], speed: [2, 8], life: [300, 600], rise: 20, glow: true, size: [1, 1] },
  // ShadowParticle: black and deep purple.
  corruption: { colors: ['#000000', '#2a0030', '#4a1060'], speed: [3, 10], life: [300, 600], rise: 10, size: [1, 2] },
  shadow: { colors: ['#000000', '#2a0030', '#4a1060'], speed: [3, 10], life: [300, 600], rise: 10, size: [1, 2] },
  // RainbowParticle: every hue.
  rainbow: { colors: ['#ff4040', '#ffd040', '#40ff60', '#40c0ff', '#c060ff', '#ff60c0'], speed: [4, 16], life: [250, 450], glow: true, size: [1, 1] },
  // LeafParticle: greens, drifting down.
  foliage: { colors: ['#004400', '#2a7a22', '#88cc44'], speed: [2, 8], life: [400, 700], gravity: 25, size: [1, 2] },
  poison: { colors: ['#58a83a', '#98d860'], speed: [4, 12], life: [250, 450], size: [1, 1] },
  // Lightning's SparkParticle: white and pale yellow, flung out fast.
  spark: { colors: ['#ffffff', '#ffffcc', '#c0e8ff'], speed: [20, 40], life: [150, 300], drag: 0.3, glow: true, size: [1, 1] },
  // ElmoParticle (0x22EE66): a staff taking in a wand. EnergyParticle (0xFFFFAA): wands recharged.
  elmo: { colors: ['#22ee66', '#88ffaa'], speed: [6, 16], life: [400, 700], rise: 24, glow: true, size: [1, 1] },
  energy: { colors: ['#ffffaa', '#ffffff'], speed: [10, 24], life: [300, 500], drag: 0.4, glow: true, size: [1, 1] },
  // IceBlock.melt's Splash (0xB2D6FF): drops thrown up and falling.
  melt: { colors: ['#b2d6ff', '#ffffff'], speed: [15, 35], life: [250, 450], gravity: 160, angle: -Math.PI / 2, cone: 2, size: [1, 1] },
};

/** The beams (Beam's kinds): their colours, core and glow. */
const BEAMS: Record<string, { core: string; glow: string; width: number }> = {
  // Beam.DeathRay: disintegration, a ward's shot, the evil eye's gaze.
  death: { core: '#e8b0ff', glow: '120, 0, 160', width: 4 },
  beam: { core: '#e8b0ff', glow: '120, 0, 160', width: 4 },
  // Beam.LightRay: prismatic light.
  light: { core: '#ffffff', glow: '255, 250, 200', width: 4 },
  // Beam.HealthRay: transfusion.
  blood: { core: '#ffb0b0', glow: '204, 0, 0', width: 3 },
};

/** Beam: a ray fades and thins over half a second. Lightning: its arcs, a third. BlastWave: the ripple, a fifth. */
const BEAM_MS = 500;
const ARC_MS = 300;
const RIPPLE_MS = 200;

interface Beam {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  start: number;
  kind: string;
}

interface Arc {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  start: number;
}

interface Ripple {
  x: number;
  y: number;
  start: number;
  /** BlastWave.blast's radius, in cells. */
  radius: number;
}

class WandFx {
  private beams: Beam[] = [];
  private arcs: Arc[] = [];
  private ripples: Ripple[] = [];
  private lastTrail = 0;
  private lastAura = 0;
  /** What happens where a missile lands, held until it gets there (MagicMissile's callback). */
  private landings: Array<{ at: number; land: (now: number) => void }> = [];

  /** Shown when a missile lands: `ms` after now. */
  later(ms: number, now: number, land: (now: number) => void): void {
    if (ms <= 0) land(now);
    else this.landings.push({ at: now + ms, land });
  }

  /** How long a wand's missile takes from one cell to another (MagicMissile.SPEED). */
  flight(from: { x: number; y: number }, to: { x: number; y: number }): number {
    return Math.min(600, Math.max(90, (Math.hypot(to.x - from.x, to.y - from.y) / 16) * BOLT_MS_PER_CELL));
  }

  /** A burst of one of the wands' particles (an emitter's burst). */
  burst(kind: string, x: number, y: number, now: number, count: number): void {
    const look = TRAILS[kind];
    if (look) fx.burst(x, y, now, { ...look, count, spread: 3 });
  }

  /** Whether a bolt kind is drawn as a beam rather than a missile. */
  isBeam(kind: string): boolean {
    return kind in BEAMS;
  }

  /** Beam.DeathRay, LightRay, HealthRay: from the zapper to where it ends. */
  beam(x0: number, y0: number, x1: number, y1: number, kind: string, now: number): void {
    this.beams.push({ x0, y0, x1, y1, start: now, kind });
    // The beam's particles along its length (PurpleParticle, RainbowParticle, BloodParticle).
    const trail = TRAILS[kind === 'light' ? 'rainbow' : kind === 'blood' ? 'fire' : 'corruption'];
    const length = Math.hypot(x1 - x0, y1 - y0);
    const colors = kind === 'blood' ? ['#cc0000', '#ff4040'] : kind === 'light' ? trail!.colors : ['#8800cc', '#e0a0ff', '#2a0030'];
    for (let d = 0; d < length; d += quality.light ? 16 : 8) {
      const k = d / Math.max(1, length);
      fx.burst(x0 + (x1 - x0) * k, y0 + (y1 - y0) * k, now, { ...trail!, colors, count: 1 });
    }
  }

  /** Lightning.Arc: from one point to another. */
  arc(x0: number, y0: number, x1: number, y1: number, now: number): void {
    this.arcs.push({ x0, y0, x1, y1, start: now });
  }

  /** WandOfBlastWave.BlastWave.blast. */
  ripple(x: number, y: number, radius: number, now: number): void {
    this.ripples.push({ x, y, start: now, radius });
  }

  /**
   * Every frame: the particles off the bolts in flight (MagicMissile's emitter), and off the creatures
   * under some condition: snow round the chilled, leaves round a lotus.
   */
  emit(
    projectiles: ReadonlyArray<{ from: number; to: number; start: number; duration: number; trail?: string; wide?: boolean }>,
    puppets: Iterable<Puppet>,
    where: (cell: number) => { x: number; y: number },
    now: number,
  ): void {
    if (this.landings.length) {
      const due = this.landings.filter((l) => l.at <= now);
      this.landings = this.landings.filter((l) => l.at > now);
      for (const l of due) l.land(now);
    }
    if (now - this.lastTrail >= 16) {
      this.lastTrail = now;
      for (const p of projectiles) {
        const trail = p.trail && TRAILS[p.trail];
        if (!trail) continue;
        // A bolt with a sprite of its own (wand-bolts.png) has its four squares instead of a stream of particles (render.ts).
        if (WAND_BOLT_ROW[p.trail!] !== undefined && loaded(shImage('wand-bolts'))) continue;
        const k = Math.min(1, Math.max(0, (now - p.start) / p.duration));
        const a = where(p.from);
        const b = where(p.to);
        // A missile's emitter is 4 pixels wide and pours every 0.01 s; a cone's, 10 wide and every 0.03 s.
        fx.burst(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, now, p.wide
          ? { ...trail, count: 1, spread: 5 }
          : { ...trail, count: quality.light ? 1 : 2, spread: 2 });
      }
    }
    if (now - this.lastAura < 120) return;
    this.lastAura = now;
    for (const puppet of puppets) {
      if (!puppet.alive) continue;
      const at = where(puppet.to);
      // CharSprite.State.CHILLED: snow falling about it.
      if (puppet.chilled && !puppet.frozen && Math.random() < 0.6) {
        fx.burst(at.x + (Math.random() - 0.5) * 12, at.y - 10, now, {
          count: 1, colors: ['#ffffff', '#d8f0ff'], speed: [2, 6], life: [500, 800], gravity: 18, angle: Math.PI / 2, cone: 0.6, size: [1, 1],
        });
      }
      // LotusSprite: a leaf every half second off each cell in its reach (a few cells' worth a tick here).
      if (puppet.kind === 'lotus' && (puppet.reach ?? 0) > 0) {
        const reach = puppet.reach!;
        const leaves = Math.min(quality.light ? 3 : 8, Math.round(Math.PI * reach * reach * 0.24));
        for (let i = 0; i < leaves; i++) {
          const dx = Math.round((Math.random() * 2 - 1) * reach);
          const dy = Math.round((Math.random() * 2 - 1) * reach);
          if (dx * dx + dy * dy > reach * reach) continue;
          fx.burst(at.x + dx * 16 + (Math.random() - 0.5) * 12, at.y + dy * 16 + (Math.random() - 0.5) * 12, now, { ...TRAILS.foliage!, count: 1 });
        }
      }
    }
  }

  draw(ctx: CanvasRenderingContext2D, now: number): void {
    this.beams = this.beams.filter((b) => now - b.start < BEAM_MS);
    this.arcs = this.arcs.filter((a) => now - a.start < ARC_MS);
    this.ripples = this.ripples.filter((r) => now - r.start < RIPPLE_MS);
    ctx.save();
    ctx.lineCap = 'round';
    for (const b of this.beams) {
      const look = BEAMS[b.kind]!;
      const p = 1 - (now - b.start) / BEAM_MS;
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = `rgba(${look.glow}, ${0.55 * p})`;
      ctx.lineWidth = look.width * 2 * p + 1;
      line(ctx, b.x0, b.y0, b.x1, b.y1);
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = look.core;
      ctx.globalAlpha = p;
      ctx.lineWidth = Math.max(1, look.width * p * 0.6);
      line(ctx, b.x0, b.y0, b.x1, b.y1);
      ctx.globalAlpha = 1;
    }
    for (const a of this.arcs) {
      // Lightning: a jagged white line, new every frame, with a blue glow, fading.
      const p = 1 - (now - a.start) / ARC_MS;
      const points = jagged(a.x0, a.y0, a.x1, a.y1);
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = `rgba(150, 200, 255, ${0.5 * p})`;
      ctx.lineWidth = 3;
      polyline(ctx, points);
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = `rgba(255, 255, 255, ${p})`;
      ctx.lineWidth = 1;
      polyline(ctx, points);
    }
    for (const r of this.ripples) {
      // BlastWave: a ring growing to its size, fading as it grows.
      const p = 1 - (now - r.start) / RIPPLE_MS;
      ctx.strokeStyle = `rgba(255, 255, 255, ${p})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(r.x, r.y, Math.max(1, (1 - p) * r.radius * 8), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }
}

function line(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number): void {
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
}

function polyline(ctx: CanvasRenderingContext2D, points: ReadonlyArray<readonly [number, number]>): void {
  ctx.beginPath();
  ctx.moveTo(points[0]![0], points[0]![1]);
  for (const [x, y] of points.slice(1)) ctx.lineTo(x, y);
  ctx.stroke();
}

/** Lightning.Arc's shape: the straight way broken into short legs, each knocked a little aside. */
function jagged(x0: number, y0: number, x1: number, y1: number): Array<[number, number]> {
  const length = Math.hypot(x1 - x0, y1 - y0);
  const legs = Math.max(2, Math.round(length / 6));
  const nx = -(y1 - y0) / Math.max(1, length);
  const ny = (x1 - x0) / Math.max(1, length);
  const points: Array<[number, number]> = [[x0, y0]];
  for (let i = 1; i < legs; i++) {
    const k = i / legs;
    const off = (Math.random() - 0.5) * 6;
    points.push([x0 + (x1 - x0) * k + nx * off, y0 + (y1 - y0) * k + ny * off]);
  }
  points.push([x1, y1]);
  return points;
}

export const wandFx = new WandFx();

/** Tints over a sprite's own pixels, for CharSprite's states (made on a scratch canvas). */
let scratch: HTMLCanvasElement | null = null;
export function tintSprite(
  ctx: CanvasRenderingContext2D, image: CanvasImageSource, sx: number, sy: number, w: number, h: number, color: string, alpha: number,
): void {
  scratch ??= document.createElement('canvas');
  if (scratch.width < w || scratch.height < h) {
    scratch.width = Math.max(scratch.width, w);
    scratch.height = Math.max(scratch.height, h);
  }
  const g = scratch.getContext('2d')!;
  g.clearRect(0, 0, scratch.width, scratch.height);
  g.globalCompositeOperation = 'source-over';
  g.drawImage(image, sx, sy, w, h, 0, 0, w, h);
  g.globalCompositeOperation = 'source-atop';
  g.fillStyle = color;
  g.globalAlpha = alpha;
  g.fillRect(0, 0, w, h);
  g.globalAlpha = 1;
  ctx.drawImage(scratch, 0, 0, w, h, 0, 0, w, h);
}
