import { LENGTH, WIDTH } from './level/geometry';

/*
 * Shattered's PathFinder (watabou.utils): distance maps over the level, the
 * next step towards a cell, and the next step away from one (getStepBack,
 * for fleeing: towards the cells as far from the threat as the fleer can
 * get within a few steps more than it stands now).
 */

/** PathFinder.dir: the order a step is chosen in among equally good ones. */
const DIR = [-1, +1, -WIDTH, +WIDTH, -WIDTH - 1, -WIDTH + 1, +WIDTH - 1, +WIDTH + 1] as const;
/** PathFinder.dirLR: the order the maps spread in, left column first (so a map never wraps round the edge). */
const DIR_LR = [-1 - WIDTH, -1, -1 + WIDTH, -WIDTH, +WIDTH, +1 - WIDTH, +1, +1 + WIDTH] as const;

const MAX = 0x7fffffff;

/** The neighbours of `step` the maps spread to (dirLR, cut at the left and right edges). */
function* around(step: number): Generator<number> {
  const start = step % WIDTH === 0 ? 3 : 0;
  const end = (step + 1) % WIDTH === 0 ? 3 : 0;
  for (let i = start; i < DIR_LR.length - end; i++) {
    const n = step + DIR_LR[i]!;
    if (n >= 0 && n < LENGTH) yield n;
  }
}

/** PathFinder.buildDistanceMap(to, passable, limit): steps from `to` to every cell it reaches (MAX where not). */
export function distanceMap(to: number, passable: (cell: number) => boolean, limit = MAX): Int32Array {
  const distance = new Int32Array(LENGTH).fill(MAX);
  distance[to] = 0;
  const queue = [to];
  for (let head = 0; head < queue.length; head++) {
    const step = queue[head]!;
    const next = distance[step]! + 1;
    if (next > limit) continue;
    for (const n of around(step)) {
      if (passable(n) && distance[n]! > next) {
        distance[n] = next;
        queue.push(n);
      }
    }
  }
  return distance;
}

/** Whether a distance map reached a cell. */
export const reached = (distance: Int32Array, cell: number): boolean => distance[cell]! !== MAX;

/** PathFinder.buildDistanceMap(from, goals, passable): from the goals outwards until `from` is reached (it always may be). */
function goalMap(from: number, goals: (cell: number) => boolean, passable: (cell: number) => boolean): Int32Array | null {
  if (goals(from)) return null;
  const distance = new Int32Array(LENGTH).fill(MAX);
  const queue: number[] = [];
  for (let i = 0; i < LENGTH; i++) {
    if (goals(i)) {
      distance[i] = 0;
      queue.push(i);
    }
  }
  for (let head = 0; head < queue.length; head++) {
    const step = queue[head]!;
    if (step === from) return distance;
    const next = distance[step]! + 1;
    for (const n of around(step)) {
      if (n === from || (passable(n) && distance[n]! > next)) {
        distance[n] = next;
        queue.push(n);
      }
    }
  }
  return null;
}

/** The step down a map from `from`: the neighbour (in dir order) closest to the goal, or -1. */
function downhill(from: number, distance: Int32Array): number {
  let best = -1;
  let min = distance[from]!;
  for (const d of DIR) {
    const n = from + d;
    if (n < 0 || n >= LENGTH) continue;
    if (distance[n]! < min) {
      min = distance[n]!;
      best = n;
    }
  }
  return best;
}

/** PathFinder.getStep: the next step from `from` towards `to`, or -1 if it cannot be reached. */
export function getStep(from: number, to: number, passable: (cell: number) => boolean): number {
  if (from === to) return -1;
  const distance = goalMap(from, (cell) => cell === to, passable);
  return distance ? downhill(from, distance) : -1;
}

/** PathFinder.find, at once: the first step from `from` towards `to` and how many steps it takes (-1 and Infinity if none). */
export function route(from: number, to: number, passable: (cell: number) => boolean): { step: number; length: number } {
  if (from === to) return { step: -1, length: 0 };
  const distance = goalMap(from, (cell) => cell === to, passable);
  return distance ? { step: downhill(from, distance), length: distance[from]! } : { step: -1, length: Infinity };
}

/** PathFinder.find's length: how many steps from `from` to `to` (Infinity if none). */
export function pathLength(from: number, to: number, passable: (cell: number) => boolean): number {
  if (from === to) return 0;
  const distance = goalMap(from, (cell) => cell === to, passable);
  return distance ? distance[from]! : Infinity;
}

/**
 * PathFinder.getStepBack: a step away from `threat` — towards the cells farthest from it that can be reached
 * within `lookahead` steps more than the fleer is from it now; one that may not come any nearer to the
 * threat on its way (`canApproach` false: terror) settles for what it can reach that way. -1 if none.
 */
export function getStepBack(cur: number, threat: number, lookahead: number, passable: boolean[], canApproach: boolean): number {
  // buildEscapeDistanceMap
  const distance = new Int32Array(LENGTH).fill(MAX);
  distance[threat] = 0;
  const queue = [threat];
  let destDist = MAX;
  let d = 0;
  for (let head = 0; head < queue.length; head++) {
    const step = queue[head]!;
    d = distance[step]!;
    if (d > destDist) {
      d = destDist;
      break;
    }
    if (step === cur) destDist = d + lookahead;
    const next = d + 1;
    for (const n of around(step)) {
      if (passable[n] && distance[n]! > next) {
        distance[n] = next;
        queue.push(n);
      }
    }
  }
  if (d === 0) return -1;
  if (!canApproach) {
    // It may not come nearer the threat than it stands: cut off whatever is, and aim no further than it can reach.
    let newD = distance[cur]!;
    const queued = new Uint8Array(LENGTH);
    const q = [cur];
    queued[cur] = 1;
    for (let head = 0; head < q.length; head++) {
      const step = q[head]!;
      if (distance[step]! > newD) newD = distance[step]!;
      for (const n of around(step)) {
        if (!passable[n]) continue;
        if (distance[n]! < distance[cur]!) {
          passable[n] = false;
        } else if (distance[n]! >= distance[step]! && !queued[n]) {
          q.push(n);
          queued[n] = 1;
        }
      }
    }
    d = Math.min(newD, d);
  }
  const goals = goalMap(cur, (cell) => distance[cell] === d, (cell) => passable[cell]!);
  if (!goals) return -1;
  const step = downhill(cur, goals);
  return step === -1 ? cur : step;
}
