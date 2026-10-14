/*
 * Trigonometry for level generation from + - * / and sqrt only, which every JavaScript engine
 * computes exactly alike (IEEE 754). Math.tan, Math.atan and their kin are left to each engine,
 * and a last-bit difference between the device and the server would lay a level out differently.
 */

const HALF_PI = Math.PI / 2;
const QUARTER_PI = Math.PI / 4;

/** Series for small arguments (|x| <= ~0.2 after halving): x - x^3/3 + x^5/5 - ... */
function atanSmall(x: number): number {
  const x2 = x * x;
  let term = x;
  let sum = x;
  for (let n = 3; n <= 31; n += 2) {
    term *= -x2;
    sum += term / n;
  }
  return sum;
}

export function atan(x: number): number {
  if (Number.isNaN(x)) return NaN;
  if (x === Infinity) return HALF_PI;
  if (x === -Infinity) return -HALF_PI;
  if (x < 0) return -atan(-x);
  if (x > 1) return HALF_PI - atan(1 / x);
  // atan(x) = 2 atan(x / (1 + sqrt(1 + x^2))), twice: |x| <= tan(pi/16).
  let r = x;
  for (let i = 0; i < 2; i++) r = r / (1 + Math.sqrt(1 + r * r));
  return 4 * atanSmall(r);
}

function sinSmall(x: number): number {
  const x2 = x * x;
  let term = x;
  let sum = x;
  for (let n = 1; n <= 12; n++) {
    term *= -x2 / ((2 * n) * (2 * n + 1));
    sum += term;
  }
  return sum;
}

function cosSmall(x: number): number {
  const x2 = x * x;
  let term = 1;
  let sum = 1;
  for (let n = 1; n <= 12; n++) {
    term *= -x2 / ((2 * n - 1) * (2 * n));
    sum += term;
  }
  return sum;
}

/** sin and cos together, the angle brought into [-pi/4, pi/4] by quarter turns. */
function sinCos(a: number): [number, number] {
  const q = Math.round(a / HALF_PI);
  const r = a - q * HALF_PI;
  const s = sinSmall(r);
  const c = cosSmall(r);
  switch (((q % 4) + 4) % 4) {
    case 0:
      return [s, c];
    case 1:
      return [c, -s];
    case 2:
      return [-s, -c];
    default:
      return [-c, s];
  }
}

export function sin(a: number): number {
  return sinCos(a)[0];
}

export function cos(a: number): number {
  return sinCos(a)[1];
}

export function tan(a: number): number {
  const [s, c] = sinCos(a);
  return s / c;
}

export function atan2(y: number, x: number): number {
  if (x > 0) return atan(y / x);
  if (x < 0) return y >= 0 ? atan(y / x) + Math.PI : atan(y / x) - Math.PI;
  if (y > 0) return HALF_PI;
  if (y < 0) return -HALF_PI;
  return 0;
}

export { QUARTER_PI };
