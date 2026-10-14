import type { GenLevel } from './genlevel';
import { Point, Rect } from './rect';
import type { Room } from './room';

/*
 * levels/painters/Painter's static drawing helpers. Like the original, fill(level, rect, ...) takes
 * the rect's width() and height(): a room's include its walls, a plain Rect's stop short of its
 * right and bottom edges.
 */

function fillXY(level: GenLevel, x: number, y: number, w: number, h: number, value: number): void {
  const width = level.width;
  let pos = y * width + x;
  for (let i = y; i < y + h; i++, pos += width) {
    for (let j = 0; j < w; j++) level.map[pos + j] = value;
  }
}

export const Painter = {
  set(level: GenLevel, a: number | { x: number; y: number }, b: number, c?: number): void {
    if (typeof a === 'number' && c !== undefined) {
      // set(level, x, y, value)
      level.map[a + b * level.width] = c;
    } else if (typeof a === 'number') {
      // set(level, cell, value)
      level.map[a] = b;
    } else {
      level.map[a.x + a.y * level.width] = b;
    }
  },

  /**
   * fill(level, x, y, w, h, value); fill(level, rect, value); fill(level, rect, m, value);
   * fill(level, rect, l, t, r, b, value).
   */
  fill(level: GenLevel, a: number | Rect, b: number, c?: number, d?: number, e?: number, f?: number, g?: number): void {
    if (typeof a === 'number') {
      fillXY(level, a, b, c!, d!, e!);
    } else if (c === undefined) {
      fillXY(level, a.left, a.top, a.width(), a.height(), b);
    } else if (d === undefined) {
      fillXY(level, a.left + b, a.top + b, a.width() - b * 2, a.height() - b * 2, c);
    } else {
      // (rect, l, t, r, b, value): b = left inset, c = top, d = right, e = bottom, f = value.
      fillXY(level, a.left + b, a.top + c, a.width() - (b + d), a.height() - (c + e!), f!);
      void g;
    }
  },

  /** fill(level, rect, value), for code that prefers to say so. */
  fillRect(level: GenLevel, rect: Rect, value: number): void {
    fillXY(level, rect.left, rect.top, rect.width(), rect.height(), value);
  },

  /** Painter.drawLine: a line of cells from one point to another, stepping along the longer axis. */
  drawLine(level: GenLevel, from: Point, to: Point, value: number): void {
    const f32 = Math.fround;
    let x = f32(from.x);
    let y = f32(from.y);
    let dx = f32(to.x - from.x);
    let dy = f32(to.y - from.y);
    const movingbyX = Math.abs(dx) >= Math.abs(dy);
    if (movingbyX) {
      dy = f32(dy / Math.abs(dx));
      dx = f32(dx / Math.abs(dx));
    } else {
      dx = f32(dx / Math.abs(dy));
      dy = f32(dy / Math.abs(dy));
    }
    Painter.set(level, javaRound(x), javaRound(y), value);
    while ((movingbyX && to.x !== x) || (!movingbyX && to.y !== y)) {
      x = f32(x + dx);
      y = f32(y + dy);
      Painter.set(level, javaRound(x), javaRound(y), value);
    }
  },

  /** fillEllipse(level, rect, value), fillEllipse(level, rect, m, value), fillEllipse(level, x, y, w, h, value). */
  fillEllipse(level: GenLevel, a: number | Rect, b: number, c?: number, d?: number, e?: number): void {
    if (typeof a !== 'number') {
      if (c === undefined) return Painter.fillEllipse(level, a.left, a.top, a.width(), a.height(), b);
      return Painter.fillEllipse(level, a.left + b, a.top + b, a.width() - b * 2, a.height() - b * 2, c);
    }
    const x = a;
    const y = b;
    const w = c!;
    const h = d!;
    const value = e!;
    const radH = Math.fround(h / 2);
    const radW = Math.fround(w / 2);
    for (let i = 0; i < h; i++) {
      // The middle of each row of tiles decides the row's width.
      const rowY = -radH + 0.5 + i;
      let rowW = 2.0 * Math.sqrt(radW * radW * (1.0 - (rowY * rowY) / (radH * radH)));
      if (w % 2 === 0) rowW = javaRound(rowW / 2.0) * 2.0;
      else rowW = Math.floor(rowW / 2.0) * 2.0 + 1;
      const cell = x + Math.trunc((w - Math.trunc(rowW)) / 2) + (y + i) * level.width;
      for (let j = 0; j < Math.trunc(rowW); j++) level.map[cell + j] = value;
    }
  },

  /** fillDiamond(level, rect, value), fillDiamond(level, rect, m, value), fillDiamond(level, x, y, w, h, value). */
  fillDiamond(level: GenLevel, a: number | Rect, b: number, c?: number, d?: number, e?: number): void {
    if (typeof a !== 'number') {
      if (c === undefined) return Painter.fillDiamond(level, a.left, a.top, a.width(), a.height(), b);
      return Painter.fillDiamond(level, a.left + b, a.top + b, a.width() - b * 2, a.height() - b * 2, c);
    }
    const x = a;
    const y = b;
    const w = c!;
    const h = d!;
    const value = e!;
    // The width grows by (h-2 - h%2) to end at w, from at least 2 (even widths) or 3 (odd).
    let diamondWidth = w - (h - 2 - (h % 2));
    diamondWidth = Math.max(diamondWidth, w % 2 === 0 ? 2 : 3);
    for (let i = 0; i <= h; i++) {
      fillXY(level, x + Math.trunc((w - diamondWidth) / 2), y + i, diamondWidth, h - 2 * i, value);
      diamondWidth += 2;
      if (diamondWidth > w) break;
    }
  },

  /** Painter.drawInside: walks n cells into the room from a point on its edge, painting each (-1: none); the point after. */
  drawInside(level: GenLevel, room: Room, from: Point, n: number, value: number): Point {
    const step = new Point();
    if (from.x === room.left) step.set(+1, 0);
    else if (from.x === room.right) step.set(-1, 0);
    else if (from.y === room.top) step.set(0, +1);
    else if (from.y === room.bottom) step.set(0, -1);
    const p = from.clone().offset(step.x, step.y);
    for (let i = 0; i < n; i++) {
      if (value !== -1) Painter.set(level, p, value);
      p.offset(step.x, step.y);
    }
    return p;
  },
};

/** Java's Math.round: floor(x + 0.5). */
export const javaRound = (x: number): number => Math.floor(x + 0.5);
