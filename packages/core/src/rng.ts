/*
 * Deterministic random stream, bit-compatible with the seeded generator in
 * the Java version (com.watabou.utils.Random): xorshift128 seeded through
 * splitmix64, exposing 24-bit fractions.
 *
 * Unlike the Java original, which keeps one global stream, the state here is
 * plain data. It lives inside the game state, so a game can be saved, sent
 * over the network and replayed by the server with identical results.
 *
 * Java casts to `float` in many places; Math.fround reproduces that rounding
 * exactly, so ported code calls the float-flavoured helpers where Java used
 * floats.
 */

export interface RngState {
  x: number;
  y: number;
  z: number;
  w: number;
}

const U64 = 64;
const GOLDEN = 0x9e3779b97f4a7c15n;
const OFFSET = 0x61c8864680b583ebn;

function mix64(value: bigint): bigint {
  let z = BigInt.asUintN(U64, value);
  z = BigInt.asUintN(U64, (z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n);
  z = BigInt.asUintN(U64, (z ^ (z >> 27n)) * 0x94d049bb133111ebn);
  return z ^ (z >> 31n);
}

function int32(value: bigint): number {
  return Number(BigInt.asIntN(32, value));
}

/** Equivalent of `new Random.Seeded(seed)` in Java; `seed` is a Java long. */
export function seedRng(seed: bigint | number): RngState {
  const s = BigInt(seed);
  const a = mix64(s + GOLDEN);
  const b = mix64(s - OFFSET);
  const state = { x: int32(a), y: int32(a >> 32n), z: int32(b), w: int32(b >> 32n) };
  if ((state.x | state.y | state.z | state.w) === 0) {
    state.w = 1;
  }
  return state;
}

/**
 * Independent stream seeds derived from a run seed and labels, e.g.
 * deriveSeed(runSeed, Stream.LAYOUT, depth). Streams never share numbers, so
 * one subsystem consuming more randomness cannot change another's results.
 */
export function deriveSeed(...parts: Array<number | bigint>): bigint {
  let h = 0x6a09e667f3bcc908n;
  for (const part of parts) {
    h = mix64(BigInt.asUintN(U64, h + GOLDEN) ^ BigInt.asUintN(U64, BigInt(part)));
  }
  return BigInt.asIntN(U64, h);
}

export const Stream = {
  RUN: 1,
  LAYOUT: 2,
  ITEMS: 3,
  MOBS: 4,
  /** Everything that happens on a depth during play: combat, monster AI. */
  PLAY: 5,
} as const;

/** Next value in [0, 1) with 24 bits of precision (exact in float and double). */
export function nextFraction(state: RngState): number {
  const t = state.x ^ (state.x << 11);
  state.x = state.y;
  state.y = state.z;
  state.z = state.w;
  state.w = state.w ^ (state.w >>> 19) ^ (t ^ (t >>> 8));
  return (state.w >>> 8) / 16777216;
}

const f32 = Math.fround;

/**
 * Same API and arithmetic as com.watabou.utils.Random, bound to one state.
 * Method names follow the Java original to keep ported code recognisable.
 */
export class Rng {
  constructor(public state: RngState) {}

  static seeded(seed: bigint | number): Rng {
    return new Rng(seedRng(seed));
  }

  next(): number {
    return nextFraction(this.state);
  }

  /** Java: Random.Float() */
  float(): number {
    return f32(this.next());
  }

  /** Java: Random.Float(max) — max is a float. */
  floatMax(max: number): number {
    return f32(this.next() * max);
  }

  /** Java: Random.Float(min, max) — float arguments, `max - min` is float. */
  floatRange(min: number, max: number): number {
    return f32(min + this.next() * f32(max - min));
  }

  /** Java: Random.Int(max) */
  int(max: number): number {
    return max > 0 ? Math.trunc(this.next() * max) : 0;
  }

  /** Java: Random.Int(min, max) — max exclusive. */
  intBetween(min: number, max: number): number {
    return min + Math.trunc(this.next() * (max - min));
  }

  /** Java: Random.IntRange(min, max) — max inclusive. */
  intRange(min: number, max: number): number {
    return min + Math.trunc(this.next() * (max - min + 1));
  }

  /** Java: Random.NormalIntRange(min, max) */
  normalIntRange(min: number, max: number): number {
    const a = this.next();
    const b = this.next();
    return min + Math.trunc(((a + b) * (max - min + 1)) / 2);
  }

  /** Java: Random.NormalFloat(min, max) — the mean of two Float(max - min), past min. */
  normalFloat(min: number, max: number): number {
    const span = f32(max - min);
    return f32(min + f32(f32(this.floatMax(span) + this.floatMax(span)) / 2));
  }

  /** Java: Random.chances(float[]) — weights are floats, summed in float. */
  chances(chances: readonly number[]): number {
    const length = chances.length;
    if (length === 0) {
      return -1;
    }

    let sum = 0;
    for (let i = 0; i < length; i++) {
      if (chances[i]! > 0) {
        sum = f32(sum + chances[i]!);
      }
    }
    if (!(sum > 0)) {
      return 0;
    }

    let value = this.floatMax(sum);
    for (let i = 0; i < length - 1; i++) {
      if (chances[i]! > 0) {
        if (value < chances[i]!) {
          return i;
        }
        value = f32(value - chances[i]!);
      }
    }
    for (let i = length - 1; i >= 0; i--) {
      if (chances[i]! > 0) {
        return i;
      }
    }
    return 0;
  }

  /** Java: Random.chances(HashMap) over an insertion-ordered map. */
  chancesOf<K>(chances: ReadonlyMap<K, number>): K | undefined {
    if (chances.size === 0) {
      return undefined;
    }
    const keys = [...chances.keys()];
    const probs = keys.map((key) => f32(chances.get(key) ?? 0));

    let sum = 0;
    for (const p of probs) {
      if (p > 0) {
        sum = f32(sum + p);
      }
    }
    if (!(sum > 0)) {
      return keys[0];
    }

    let value = this.floatMax(sum);
    for (let i = 0; i < keys.length - 1; i++) {
      if (probs[i]! > 0) {
        if (value < probs[i]!) {
          return keys[i];
        }
        value = f32(value - probs[i]!);
      }
    }
    for (let i = keys.length - 1; i >= 0; i--) {
      if (probs[i]! > 0) {
        return keys[i];
      }
    }
    return keys[0];
  }

  /** Java: Random.index(collection) */
  index(size: number): number {
    return Math.trunc(this.next() * size);
  }

  /** Java: Random.oneOf(...) and Random.element(array) */
  oneOf<T>(items: readonly T[]): T {
    return items[Math.trunc(this.next() * items.length)]!;
  }

  /** Java: Random.element(array, max) */
  elementOf<T>(items: readonly T[], max: number): T {
    return items[Math.trunc(this.next() * max)]!;
  }

  /** Java: Random.element(Collection) — iterates in insertion order. */
  element<T>(items: Iterable<T>): T | undefined {
    const array = [...items];
    return array.length > 0 ? array[this.int(array.length)] : undefined;
  }

  /** Java: Random.shuffle(array) */
  shuffle<T>(array: T[]): void {
    for (let i = 0; i < array.length - 1; i++) {
      const j = this.intBetween(i, array.length);
      if (j !== i) {
        const t = array[i]!;
        array[i] = array[j]!;
        array[j] = t;
      }
    }
  }
}
