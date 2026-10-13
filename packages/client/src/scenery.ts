import { type Effect, LENGTH, type Level, T, WIDTH } from '@pd/core';
import { quality } from './quality';
import { TILE } from './view';
import { drawFrame, frameAt, sheet } from './worldsheets';
import { levelRegion } from './sprites';

/*
 * Each region's life on the walls and floors, from the ambient sheets
 * (ambient0..4): water dripping from the sewers' pipes and bubbles rising in
 * them, the prison's torches, glints in the caves' veins, the dwarven city's
 * lanterns, the demon halls' lava and embers; wells shimmer everywhere, and a
 * trap's plate is seen to sink when someone steps on it. Out of sight, the
 * walls keep their lights (they were seen) but nothing moves.
 */

/** Something played once: a bubble, a glint in a vein, an ember rising, a trap's plate. */
interface Once {
  key: string;
  /** The first of the frames it plays, and how many (a trap plays two of its row). */
  from: number;
  count: number;
  x: number;
  y: number;
  start: number;
  /** World pixels it drifts up per second (an ember). */
  rise?: number;
  life: number;
}

/** A number from a cell that stays the same: phases and pauses differ from place to place. */
const hash = (cell: number): number => ((cell * 2654435761) >>> 0) / 4294967296;

const isWater = (terrain: number): boolean => terrain === T.WATER;

export class Scenery {
  private onces: Once[] = [];
  private next = 0;
  private depth = 0;

  /** What happened, for the region's life to answer (nothing does yet). */
  effects(_effects: readonly Effect[], _depth: number, _now: number): void {
    // Shattered's traps have no plate animation: a spent trap turns black (tiles.ts).
  }

  /** Over the floor and walls, under what lies about: the region's living things. */
  draw(ctx: CanvasRenderingContext2D, level: Level, visible: readonly boolean[], explored: readonly boolean[], now: number): void {
    const region = levelRegion(level);
    const s = sheet(`ambient${region}`);
    if (!s) return;
    if (level.depth !== this.depth) {
      this.depth = level.depth;
      this.onces = [];
    }
    const still = quality.reducedMotion;
    const at = (cell: number): [number, number] => [(cell % WIDTH) * TILE, Math.trunc(cell / WIDTH) * TILE];
    const lit = (cell: number): boolean => visible[cell] === true;
    const below = (cell: number): number => level.map[cell + WIDTH] ?? T.WALL;

    for (let cell = 0; cell < LENGTH; cell++) {
      if (!explored[cell]) continue;
      const terrain = level.map[cell]!;
      const [x, y] = at(cell);
      const time = still || !lit(cell) ? 0 : now + hash(cell) * 5000;
      if (terrain === T.WELL && s.anims.well) {
        drawFrame(ctx, s, frameAt(s.anims.well, time, true), x, y);
      } else if (terrain === T.WALL_DECO) {
        if (region === 1 && s.anims.torch) {
          // A torch on the wall, its flame never twice the same.
          drawFrame(ctx, s, frameAt(s.anims.torch, time, true), x, y);
        } else if (region === 3 && s.anims.lantern) {
          drawFrame(ctx, s, frameAt(s.anims.lantern, time, true), x, y);
        } else if (region === 0 && s.anims.drips && isWater(below(cell)) && lit(cell) && !still) {
          // A pipe dripping: the drop gathers a while (a pause of its own), then falls.
          const drips = s.anims.drips;
          const gather = 400 + hash(cell + 7) * 1600;
          const fall = drips.slice(1).reduce((sum, f) => sum + f.ms, 0);
          const t = (now + hash(cell) * 3000) % (gather + fall);
          const frame = t < gather ? drips[0]! : frameAt(drips.slice(1), t - gather);
          drawFrame(ctx, s, frame, x + 6, y + TILE - 4);
        }
      } else if (region === 4 && isWater(terrain) && s.anims.lava) {
        // The halls' lava: light running over it.
        drawFrame(ctx, s, frameAt(s.anims.lava, time, true), x, y);
      }
    }

    // Now and then, somewhere in sight: a bubble in the sewers, a glint in a cave's vein, an ember over lava.
    if (!still && now >= this.next) {
      this.next = now + (region === 4 ? 180 : region === 2 ? 900 : 600) * (0.5 + Math.random());
      const key = region === 0 ? 'bubbles' : region === 2 ? 'vein' : region === 4 ? 'embers' : '';
      const frames = key ? s.anims[key] : undefined;
      if (frames) {
        const wanted = (cell: number): boolean =>
          lit(cell) && (region === 2 ? level.map[cell] === T.WALL_DECO : isWater(level.map[cell]!));
        for (let attempt = 0; attempt < 30; attempt++) {
          const cell = Math.floor(Math.random() * LENGTH);
          if (!wanted(cell)) continue;
          const [x, y] = at(cell);
          const f = frames[0]!;
          const life = frames.reduce((sum, frame) => sum + frame.ms, 0) * (key === 'embers' ? 3 : 1);
          this.onces.push({
            key, from: 0, count: frames.length, start: now, life,
            x: x + Math.random() * (TILE - f.w), y: y + Math.random() * (TILE - f.h),
            ...(key === 'embers' ? { rise: 14 } : {}),
          });
          break;
        }
      }
    }

    this.onces = this.onces.filter((o) => now - o.start < o.life);
    for (const o of this.onces) {
      const frames = s.anims[o.key]?.slice(o.from, o.from + o.count);
      if (!frames?.length) continue;
      const t = now - o.start;
      const frame = o.key === 'embers' ? frameAt(frames, t, true) : frameAt(frames, t);
      const dy = o.rise ? (-o.rise * t) / 1000 : 0;
      ctx.globalAlpha = o.key === 'embers' ? Math.max(0, 1 - t / o.life) : 1;
      drawFrame(ctx, s, frame, Math.round(o.x), Math.round(o.y + dy));
    }
    ctx.globalAlpha = 1;
  }
}
