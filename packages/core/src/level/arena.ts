import { deriveSeed, Rng, Stream } from '../rng';
import { Feeling } from './gen/dungeon';
import type { Level } from './generate';
import { cell, LENGTH, WIDTH } from './geometry';
import { RoomType } from './room';
import { T } from './terrain';

/*
 * «The Pit of Yendor», the arena of waves: a hand-made, symmetric, octagonal
 * pit in the middle of the grid, walled in, with the stands of the crowd three
 * rings deep around the wall. Four gates in the wall, north, east, south and
 * west, open onto short corridors through the stands, each to a small pen
 * where the monsters of a wave come in. In the
 * middle a raised dais with a pedestal: rewards appear there, and heroes
 * gather at rest. Nothing leads up or down.
 *
 * The arena sinks deeper every five waves: each region (tier) has its own
 * depth, look and pattern of cover, so it feels new while the shape stays.
 * It fits the solo span of a regular level's grid share and never depends on
 * the party's size, so heroes who join later find the same arena.
 */

/** The middle of the arena: the pedestal on the dais. */
export const ARENA_CENTRE = cell(23, 23);
/** Half the arena's width inside the stands: 25 cells across. */
const RADIUS = 12;
/** How far the corners are cut: |dx| + |dy| <= RADIUS + CUT. */
const CUT = 5;
/** The wall is the ring just outside the floor; the gates are in it. */
const GATE_AT = RADIUS + 1;
/** How deep the stands are, beyond the wall. */
const STANDS = 3;
/** Where the pens begin: 3 by 3 cells, past the corridors through the stands. */
const PEN_AT = GATE_AT + STANDS + 1;

/** The depth the arena stands on in each tier: the first depth of a region (sewers, prison, caves, city, halls). */
export const ARENA_DEPTHS: readonly number[] = [1, 6, 11, 16, 21];

/** Where the gates, pens and dais are, for the waves (arena.ts). */
export interface ArenaRing {
  /** The pedestal in the middle of the dais. */
  dais: number;
  /** The gate cells, north, east, south, west. */
  gates: number[];
  /** The cells of the pen behind each gate, in the same order. */
  pens: number[][];
  /** The floor cell just inside each gate, where what lies beyond it is brought at rest. */
  mouths: number[];
  /** The four braziers on the diagonals (fixtures that block the way, as statues do). */
  braziers: number[];
}

/** Octagonal distance from the middle: inside the arena up to RADIUS, the stands beyond. */
const ring = (dx: number, dy: number): number => Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dx) + Math.abs(dy) - CUT);

const at = (dx: number, dy: number): number => ARENA_CENTRE + dx + dy * WIDTH;

/**
 * How far a cell is from the middle, as the octagon measures it: the floor is up to
 * ARENA_RADIUS, the wall one more, then the stands (ARENA_STANDS deep).
 */
export function ringDistance(pos: number): number {
  return ring((pos % WIDTH) - (ARENA_CENTRE % WIDTH), Math.trunc(pos / WIDTH) - Math.trunc(ARENA_CENTRE / WIDTH));
}
export const ARENA_RADIUS = RADIUS;
export const ARENA_STANDS = STANDS;

/** True for a cell of the arena proper: the floor inside the wall. */
export const insideArena = (pos: number): boolean => ringDistance(pos) <= RADIUS;

/** How far out along the diagonals the braziers stand. */
const BRAZIER = 7;

/** The four directions of the gates, as unit steps: north, east, south, west. */
const SIDES: ReadonlyArray<readonly [number, number]> = [[0, -1], [1, 0], [0, 1], [-1, 0]];

/** Every mirror image of a point in one eighth of the arena. */
function mirrored(points: ReadonlyArray<readonly [number, number]>): Array<[number, number]> {
  const all = new Map<string, [number, number]>();
  for (const [a, b] of points) {
    for (const [x, y] of [[a, b], [b, a]] as const) {
      for (const sx of [1, -1]) for (const sy of [1, -1]) all.set(`${sx * x},${sy * y}`, [sx * x, sy * y]);
    }
  }
  return [...all.values()];
}

interface TierLook {
  /** Cover, in one eighth of the arena (mirrored eightfold), and what it is made of. */
  cover: ReadonlyArray<readonly [number, number]>;
  coverTerrain: number;
  /** Statues besides, if any (sight passes them; nothing else does). */
  statues?: ReadonlyArray<readonly [number, number]>;
  /** Tufts of tall grass: the middle of each, mirrored, with its four neighbours. */
  grass: ReadonlyArray<readonly [number, number]>;
  /** How deep the corner pools reach in from the cut corners (0: none). */
  pools: number;
  /** Share of plain floor with a decorated tile; embers strewn about. */
  deco: number;
  embers: number;
  /** Paved lanes from the dais to the gates. */
  lanes: boolean;
}

/*
 * The cover of each tier. Points are (dx, dy) from the middle with dx >= dy >= 0;
 * the lanes from the gates to the dais (dx = 0 or dy = 0) stay open but for a
 * pillar or two, so a wave always has a way in.
 */
const LOOKS: readonly TierLook[] = [
  // The sewers: a ring of pillars, wide pools in the corners, a little grass.
  {
    cover: [[4, 4], [8, 2]], coverTerrain: T.WALL, grass: [[9, 5], [5, 0]], pools: 3, deco: 0.08, embers: 0, lanes: false,
  },
  // The prison: a broken square of cell walls round the dais, and posts beyond.
  {
    cover: [[6, 2], [6, 3], [6, 4], [10, 3]], coverTerrain: T.WALL, grass: [[9, 6]], pools: 2, deco: 0.06, embers: 0, lanes: true,
  },
  // The caves: boulders in clumps and thick grass to hide in.
  {
    cover: [[4, 6], [5, 6], [4, 7], [9, 1], [10, 1]], coverTerrain: T.WALL, grass: [[7, 3], [2, 9], [10, 6]], pools: 3, deco: 0.1,
    embers: 0, lanes: false,
  },
  // The dwarven city: statues along the lanes, pillars at the corners of the dais square.
  {
    cover: [[5, 5], [9, 4]], coverTerrain: T.WALL, statues: [[3, 1], [7, 0], [10, 7]], grass: [[6, 2]], pools: 2, deco: 0.05,
    embers: 6, lanes: true,
  },
  // The demon halls: a forest of pillars, embers and little else.
  {
    cover: [[3, 3], [6, 1], [7, 5], [10, 2], [5, 9]], coverTerrain: T.WALL, grass: [[8, 8]], pools: 1, deco: 0.06, embers: 12,
    lanes: false,
  },
];

/** The tier whose arena stands on a depth. */
export const arenaTier = (depth: number): number => Math.max(0, ARENA_DEPTHS.indexOf(depth));

/**
 * The arena of a tier, laid out for its depth. The same seed and depth always
 * give the same arena (its decorations are seeded; its shape is fixed).
 */
export function buildArenaLevel(seed: number, depth: number): Level & { ring: ArenaRing } {
  const tier = arenaTier(depth);
  const look = LOOKS[tier]!;
  const rng = Rng.seeded(deriveSeed(seed, Stream.LAYOUT, depth));
  const map = new Array<number>(LENGTH).fill(T.WALL);

  // The floor; the wall around it is the region's rock, the stands beyond it decorated.
  for (let dy = -GATE_AT - STANDS; dy <= GATE_AT + STANDS; dy++) {
    for (let dx = -GATE_AT - STANDS; dx <= GATE_AT + STANDS; dx++) {
      const d = ring(dx, dy);
      if (d <= RADIUS) map[at(dx, dy)] = T.EMPTY;
      else if (d > GATE_AT && d <= GATE_AT + STANDS) map[at(dx, dy)] = T.WALL_DECO;
    }
  }

  // The corner pools, along the cut corners.
  if (look.pools > 0) {
    for (let dy = -RADIUS; dy <= RADIUS; dy++) {
      for (let dx = -RADIUS; dx <= RADIUS; dx++) {
        if (ring(dx, dy) > RADIUS || Math.abs(dx) < 5 || Math.abs(dy) < 5) continue;
        if (Math.abs(dx) + Math.abs(dy) > RADIUS + CUT - look.pools) map[at(dx, dy)] = T.WATER;
      }
    }
  }

  // Paved lanes from the dais to the gates.
  if (look.lanes) {
    for (let k = 2; k <= RADIUS; k++) for (const [sx, sy] of SIDES) map[at(sx * k, sy * k)] = T.EMPTY_SP;
  }

  // Tufts of tall grass.
  for (const [dx, dy] of mirrored(look.grass)) {
    for (const [nx, ny] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const pos = at(dx + nx, dy + ny);
      if (map[pos] === T.EMPTY) map[pos] = T.HIGH_GRASS;
    }
  }

  // Decorated floor and embers, here and there (not mirrored: wear is uneven).
  for (let dy = -RADIUS; dy <= RADIUS; dy++) {
    for (let dx = -RADIUS; dx <= RADIUS; dx++) {
      const pos = at(dx, dy);
      if (map[pos] === T.EMPTY && rng.float() < look.deco) map[pos] = T.EMPTY_DECO;
    }
  }
  for (let i = 0; i < look.embers; i++) {
    const pos = at(rng.intRange(-RADIUS + 2, RADIUS - 2), rng.intRange(-RADIUS + 2, RADIUS - 2));
    if (map[pos] === T.EMPTY || map[pos] === T.EMPTY_DECO) map[pos] = T.EMBERS;
  }

  // Cover: pillars or walls, and statues.
  for (const [dx, dy] of mirrored(look.cover)) map[at(dx, dy)] = look.coverTerrain;
  for (const [dx, dy] of mirrored(look.statues ?? [])) map[at(dx, dy)] = T.STATUE;

  // The braziers on the diagonals.
  const braziers = [at(-BRAZIER, -BRAZIER), at(BRAZIER, -BRAZIER), at(BRAZIER, BRAZIER), at(-BRAZIER, BRAZIER)];
  for (const pos of braziers) map[pos] = T.STATUE;

  // The raised dais, with the pedestal in the middle.
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) map[at(dx, dy)] = T.EMPTY_SP;
  map[ARENA_CENTRE] = T.PEDESTAL;

  // The four corridors, gates and pens.
  const gates: number[] = [];
  const pens: number[][] = [];
  const mouths: number[] = [];
  for (const [sx, sy] of SIDES) {
    const gate = at(sx * GATE_AT, sy * GATE_AT);
    map[gate] = T.LOCKED_DOOR;
    gates.push(gate);
    mouths.push(at(sx * RADIUS, sy * RADIUS));
    for (let k = GATE_AT + 1; k < PEN_AT; k++) map[at(sx * k, sy * k)] = T.EMPTY_SP;
    const pen: number[] = [];
    for (let depthIn = 0; depthIn < 3; depthIn++) {
      for (let across = -1; across <= 1; across++) {
        // Along the corridor's axis `depthIn` cells into the pen, `across` to the side.
        const dx = sx * (PEN_AT + depthIn) + (sx === 0 ? across : 0);
        const dy = sy * (PEN_AT + depthIn) + (sy === 0 ? across : 0);
        map[at(dx, dy)] = T.EMPTY;
        pen.push(at(dx, dy));
      }
    }
    pens.push(pen);
  }

  const centre = { x: ARENA_CENTRE % WIDTH, y: Math.trunc(ARENA_CENTRE / WIDTH) };
  return {
    depth,
    feeling: Feeling.NONE,
    map,
    // The dais stands where stairs would: heroes arrive and rise again there. No stairs lead anywhere:
    // the way down is a cell of solid rock in the corner of the grid, out of everyone's reach.
    entrance: ARENA_CENTRE,
    exit: 0,
    // One room, the arena itself: where monsters wander when they have lost the trail.
    rooms: [{
      left: centre.x - RADIUS - 1, top: centre.y - RADIUS - 1, right: centre.x + RADIUS + 1, bottom: centre.y + RADIUS + 1,
      type: RoomType.STANDARD,
    }],
    items: [],
    toSpawn: [],
    wells: [],
    secretDoors: 0,
    region: tier,
    ring: { dais: ARENA_CENTRE, gates, pens, mouths, braziers },
  };
}
