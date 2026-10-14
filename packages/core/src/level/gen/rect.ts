import { Random } from './random';

/* com.watabou.utils.Point, PointF and Rect, as level generation uses them. */

export class Point {
  constructor(
    public x = 0,
    public y = 0,
  ) {}

  static of(p: { x: number; y: number }): Point {
    return new Point(p.x, p.y);
  }

  set(x: number, y: number): this {
    this.x = x;
    this.y = y;
    return this;
  }

  clone(): Point {
    return new Point(this.x, this.y);
  }

  offset(dx: number, dy: number): this {
    this.x += dx;
    this.y += dy;
    return this;
  }

  /** Point.length: (float) sqrt. */
  length(): number {
    return Math.fround(Math.sqrt(this.x * this.x + this.y * this.y));
  }

  equals(other: { x: number; y: number }): boolean {
    return other.x === this.x && other.y === this.y;
  }

  static distance(a: Point, b: Point): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.fround(Math.sqrt(dx * dx + dy * dy));
  }
}

export class PointF {
  constructor(
    public x = 0,
    public y = 0,
  ) {}
}

/** Rect: right and bottom are edges, so width() is right - left (rooms add one: they include their walls). */
export class Rect {
  constructor(
    public left = 0,
    public top = 0,
    public right = 0,
    public bottom = 0,
  ) {}

  static of(r: Rect): Rect {
    return new Rect(r.left, r.top, r.right, r.bottom);
  }

  width(): number {
    return this.right - this.left;
  }

  height(): number {
    return this.bottom - this.top;
  }

  square(): number {
    return this.width() * this.height();
  }

  set(left: number, top: number, right: number, bottom: number): this {
    this.left = left;
    this.top = top;
    this.right = right;
    this.bottom = bottom;
    return this;
  }

  setRect(r: Rect): this {
    return this.set(r.left, r.top, r.right, r.bottom);
  }

  setPos(x: number, y: number): this {
    return this.set(x, y, x + (this.right - this.left), y + (this.bottom - this.top));
  }

  shift(x: number, y: number): this {
    return this.set(this.left + x, this.top + y, this.right + x, this.bottom + y);
  }

  resize(w: number, h: number): this {
    return this.set(this.left, this.top, this.left + w, this.top + h);
  }

  isEmpty(): boolean {
    return this.right <= this.left || this.bottom <= this.top;
  }

  setEmpty(): this {
    this.left = this.right = this.top = this.bottom = 0;
    return this;
  }

  intersect(other: Rect): Rect {
    return new Rect(
      Math.max(this.left, other.left),
      Math.max(this.top, other.top),
      Math.min(this.right, other.right),
      Math.min(this.bottom, other.bottom),
    );
  }

  union(other: Rect): Rect {
    return new Rect(
      Math.min(this.left, other.left),
      Math.min(this.top, other.top),
      Math.max(this.right, other.right),
      Math.max(this.bottom, other.bottom),
    );
  }

  /** Rect.inside: right and bottom excluded. */
  insideRect(p: { x: number; y: number }): boolean {
    return p.x >= this.left && p.x < this.right && p.y >= this.top && p.y < this.bottom;
  }

  /** Rect.center: a random one of the middle two when the span is even. */
  center(): Point {
    return new Point(
      Math.trunc((this.left + this.right) / 2) + ((this.right - this.left) % 2 === 0 ? Random.Int(2) : 0),
      Math.trunc((this.top + this.bottom) / 2) + ((this.bottom - this.top) % 2 === 0 ? Random.Int(2) : 0),
    );
  }

  shrink(d = 1): Rect {
    return new Rect(this.left + d, this.top + d, this.right - d, this.bottom - d);
  }

  scale(d: number): Rect {
    return new Rect(this.left * d, this.top * d, this.right * d, this.bottom * d);
  }

  /** Rect.getPoints: every point, edges included, column by column. */
  getPoints(): Point[] {
    const points: Point[] = [];
    for (let i = this.left; i <= this.right; i++) {
      for (let j = this.top; j <= this.bottom; j++) points.push(new Point(i, j));
    }
    return points;
  }
}
