import { Rng } from '../../rng';

/*
 * com.watabou.utils.Random for level generation: a stack of seeded streams, the top one in use,
 * with Shattered's method names so that ported room and builder code reads as the original.
 * Generation is synchronous, so the stack is module state, set up by generateLevel (generate.ts)
 * for the length of one level and emptied after it. Nothing here touches Math.random: every
 * stream is seeded, so the server makes the same levels as the device.
 */

const stack: Rng[] = [];

const top = (): Rng => {
  const rng = stack[stack.length - 1];
  if (!rng) throw new Error('No random stream: level generation code ran outside generateLevel');
  return rng;
};

const f32 = Math.fround;

export const Random = {
  /** Runs `fn` with `rng` as the only stream on the stack (the start of Level.create). */
  using<R>(rng: Rng, fn: () => R): R {
    stack.push(rng);
    try {
      return fn();
    } finally {
      stack.pop();
    }
  },

  /** Random.pushGenerator(seed): a fresh stream for a part whose randomness must not shift the rest. */
  pushGenerator(seed: bigint): void {
    stack.push(Rng.seeded(seed));
  },

  popGenerator(): void {
    if (stack.length <= 1) throw new Error('tried to pop the last random number generator');
    stack.pop();
  },

  /** The stream in use, for code that takes an Rng. */
  get rng(): Rng {
    return top();
  },

  /** Random.Long(): a 64-bit value, to seed a pushed stream. */
  Long(): bigint {
    const rng = top();
    const hi = BigInt(Math.trunc(rng.next() * 4294967296));
    const lo = BigInt(Math.trunc(rng.next() * 4294967296));
    return BigInt.asIntN(64, (hi << 32n) | lo);
  },

  /** Random.Float(), Float(max), Float(min, max). */
  Float(a?: number, b?: number): number {
    const rng = top();
    if (a === undefined) return rng.float();
    if (b === undefined) return f32(rng.float() * a);
    return f32(a + f32(rng.float() * f32(b - a)));
  },

  /** Random.NormalFloat(min, max): triangular. */
  NormalFloat(min: number, max: number): number {
    const span = f32(max - min);
    return f32(min + f32(f32(this.Float(span) + this.Float(span)) / 2));
  },

  /** Random.Int(max): [0, max), 0 when max <= 0; Random.Int(min, max): [min, max). */
  Int(a: number, b?: number): number {
    if (b !== undefined) return a + this.Int(b - a);
    return a <= 0 ? 0 : Math.trunc(top().next() * a);
  },

  /** Random.IntRange(min, max): [min, max]. */
  IntRange(min: number, max: number): number {
    return min + this.Int(max - min + 1);
  },

  /** Random.NormalIntRange(min, max): [min, max], likelier towards the middle. */
  NormalIntRange(min: number, max: number): number {
    return min + Math.trunc(f32(f32(f32(this.Float() + this.Float()) * (max - min + 1)) / 2));
  },

  /** Random.InvNormalIntRange(min, max): [min, max], likelier towards the ends. */
  InvNormalIntRange(min: number, max: number): number {
    const roll1 = this.Float();
    const roll2 = this.Float();
    const roll = Math.abs(roll1 - 0.5) >= Math.abs(roll2 - 0.5) ? roll1 : roll2;
    return min + Math.trunc(f32(roll * (max - min + 1)));
  },

  /** Random.chances(float[]): an index weighted by the values (negatives count as 0); -1 if all are 0. */
  chances(chances: readonly number[]): number {
    let sum = 0;
    for (const c of chances) sum = f32(sum + Math.max(0, c));
    if (sum <= 0) return -1;
    const value = this.Float(sum);
    sum = 0;
    for (let i = 0; i < chances.length; i++) {
      sum = f32(sum + Math.max(0, chances[i]!));
      if (value < sum) return i;
    }
    return -1;
  },

  /** Random.chances(HashMap): a key weighted by its value, in insertion order; undefined if all are 0. */
  chancesOf<K>(chances: ReadonlyMap<K, number>): K | undefined {
    const keys = [...chances.keys()];
    const index = this.chances(keys.map((k) => chances.get(k)!));
    return index < 0 ? undefined : keys[index];
  },

  /** Random.element(collection), Random.oneOf(...): undefined for an empty one. */
  element<T>(items: Iterable<T>): T | undefined {
    const array = Array.isArray(items) ? (items as T[]) : [...items];
    return array.length > 0 ? array[this.Int(array.length)] : undefined;
  },

  oneOf<T>(...items: T[]): T {
    return items[this.Int(items.length)]!;
  },

  index(size: number): number {
    return this.Int(size);
  },

  /** Random.shuffle(array): in place. */
  shuffle<T>(array: T[]): void {
    for (let i = 0; i < array.length - 1; i++) {
      const j = this.Int(i, array.length);
      if (j !== i) {
        const t = array[i]!;
        array[i] = array[j]!;
        array[j] = t;
      }
    }
  },
};
