import { cell, LENGTH, WIDTH } from './geometry';
import { T } from './terrain';

/*
 * Shattered's Painter on a level of its own size (Level.setSize), for the boss
 * levels laid out cell by cell in Shattered's coordinates: `x + y * w`, as the
 * Java indexes them. `blit` copies the result into the top-left of our grid.
 */

/** Shattered's Rect: right and bottom exclusive for Painter.fill. */
export interface SRect { left: number; top: number; right: number; bottom: number }
export const srect = (left: number, top: number, right: number, bottom: number): SRect => ({ left, top, right, bottom });
export const rectW = (r: SRect): number => r.right - r.left;
export const rectH = (r: SRect): number => r.bottom - r.top;
/** Rect.center: its middle point (rounded down). */
export const rectCenter = (r: SRect): { x: number; y: number } => ({ x: Math.trunc((r.left + r.right) / 2), y: Math.trunc((r.top + r.bottom) / 2) });
/** Rect.inside(Point): edges included. */
export const rectInside = (r: SRect, x: number, y: number): boolean => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;

export class SLevel {
  readonly map: number[];
  constructor(readonly w: number, readonly h: number, fillWith: number = T.WALL) {
    this.map = new Array<number>(w * h).fill(fillWith);
  }

  get length(): number {
    return this.w * this.h;
  }

  set(pos: number, value: number): void {
    this.map[pos] = value;
  }

  setXY(x: number, y: number, value: number): void {
    this.map[x + y * this.w] = value;
  }

  /** Painter.fill(level, x, y, w, h, value). */
  fill(x: number, y: number, w: number, h: number, value: number): void {
    for (let row = y; row < y + h; row++) for (let col = x; col < x + w; col++) this.map[col + row * this.w] = value;
  }

  /** Painter.fill(level, rect, m, value). */
  fillRect(r: SRect, m: number, value: number): void {
    this.fill(r.left + m, r.top + m, rectW(r) - m * 2, rectH(r) - m * 2, value);
  }

  /** Painter.fillEllipse(level, rect, m, value). */
  fillEllipse(r: SRect, m: number, value: number): void {
    const x = r.left + m;
    const y = r.top + m;
    const w = rectW(r) - m * 2;
    const h = rectH(r) - m * 2;
    const radH = h / 2;
    const radW = w / 2;
    for (let i = 0; i < h; i++) {
      const rowY = -radH + 0.5 + i;
      let rowW = 2.0 * Math.sqrt(radW * radW * (1.0 - (rowY * rowY) / (radH * radH)));
      rowW = w % 2 === 0 ? Math.round(rowW / 2.0) * 2.0 : Math.floor(rowW / 2.0) * 2.0 + 1;
      this.fill(x + Math.trunc((w - rowW) / 2), y + i, rowW, 1, value);
    }
  }

  /** Painter.fillDiamond(level, rect, m, value). */
  fillDiamond(r: SRect, m: number, value: number): void {
    const x = r.left + m;
    const y = r.top + m;
    const w = rectW(r) - m * 2;
    const h = rectH(r) - m * 2;
    let diamondWidth = w - (h - 2 - (h % 2));
    diamondWidth = Math.max(diamondWidth, w % 2 === 0 ? 2 : 3);
    for (let i = 0; i <= h; i++) {
      this.fill(x + Math.trunc((w - diamondWidth) / 2), y + i, diamondWidth, h - 2 * i, value);
      diamondWidth += 2;
      if (diamondWidth > w) break;
    }
  }

  /** Our grid's cell for one of this level's. */
  toCell(pos: number): number {
    return cell(pos % this.w, Math.trunc(pos / this.w));
  }

  /** Copies the level into the top-left of our grid (the rest stays wall). */
  blit(map: number[]): void {
    map.fill(T.WALL, 0, LENGTH);
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) map[x + y * WIDTH] = this.map[x + y * this.w]!;
  }
}
