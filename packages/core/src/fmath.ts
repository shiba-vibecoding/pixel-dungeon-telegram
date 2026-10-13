/*
 * Arithmetic that every JavaScript engine does alike. The server (V8) replays what the phone (JavaScriptCore on iOS,
 * V8 or Blink elsewhere) played, and Math.hypot, Math.pow, `**`, Math.exp, Math.log and the trigonometry are free to
 * differ in their last bit from one engine to the other. + - * / and Math.sqrt are correctly rounded everywhere,
 * so everything here is built from those alone (the cone's trigonometry is in ballistica.ts).
 */

/** base to a whole power by repeated multiplication (negative powers: its reciprocal). Exact where the maths is. */
export function ipow(base: number, exponent: number): number {
  if (exponent < 0) return 1 / ipow(base, -exponent);
  let result = 1;
  for (let i = 0; i < exponent; i++) result *= base;
  return result;
}

const LN2 = 0.6931471805599453;

/** exp(x): reduced to x = k ln 2 + r with |r| <= ln 2 / 2, then the Taylor series of r, then 2^k (exact). */
export function dexp(x: number): number {
  const k = Math.round(x / LN2);
  const r = x - k * LN2;
  let term = 1;
  let sum = 1;
  for (let i = 1; i <= 20; i++) {
    term = (term * r) / i;
    sum += term;
  }
  return sum * ipow(2, k);
}

/** ln(x) for x > 0: x = m 2^e with m in [0.7, 1.4], then 2 atanh((m - 1) / (m + 1)) as its series. */
export function dlog(x: number): number {
  let m = x;
  let e = 0;
  while (m > 1.4) {
    m /= 2;
    e++;
  }
  while (m < 0.7) {
    m *= 2;
    e--;
  }
  const s = (m - 1) / (m + 1);
  const s2 = s * s;
  let sum = 0;
  for (let k = 20; k >= 0; k--) sum = 1 / (2 * k + 1) + s2 * sum;
  return 2 * s * sum + e * LN2;
}

/** base ** exponent for a base above nothing and an exponent that may be a fraction (whole ones multiply). */
export function dpow(base: number, exponent: number): number {
  if (Number.isInteger(exponent)) return ipow(base, exponent);
  return dexp(exponent * dlog(base));
}
