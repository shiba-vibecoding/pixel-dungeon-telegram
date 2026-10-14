import { HeapType, type LevelBuilder } from './builder';
import { cell, WIDTH } from './geometry';
import { PRISON_STYLE } from './prison';
import type { RegionStyle } from './regular';
import { T } from './terrain';
import { deriveSeed, Rng, Stream } from '../rng';

/*
 * Depth 10: Tengu's prison (PrisonBossLevel), a fixed 32×32 layout that
 * changes as the fight goes on. At the start: the stairs room, a hallway down
 * past four prison cells (one of them holds the iron key), and Tengu's cell
 * at the bottom behind a locked door. The fight's pause opens the way back up
 * the hallway (the stairs room is walled off); its second phase is an oval
 * arena; once it is won, the hallway leads to a chasm and the way down.
 *
 * Shattered's region decorations (Terrain.REGION_DECO: the prison's cages)
 * stand here as statues until the levels stream brings its terrain.
 */

/** Terrain.REGION_DECO (the prison's cages). SEAM(levels): Shattered's own terrain. */
export const REGION_DECO = T.STATUE;

/** Shattered's Rect: right and bottom exclusive for Painter.fill. */
interface SRect { left: number; top: number; right: number; bottom: number }
const rect = (left: number, top: number, right: number, bottom: number): SRect => ({ left, top, right, bottom });

export const ENTRANCE_POS = cell(10, 4);
const ENTRANCE_ROOM = rect(8, 2, 13, 8);
export const START_HALLWAY = rect(9, 7, 12, 24);
const START_CELLS: readonly SRect[] = [rect(5, 9, 10, 16), rect(11, 9, 16, 16), rect(5, 15, 10, 22), rect(11, 15, 16, 22)];
export const TENGU_CELL = rect(6, 23, 15, 32);
export const TENGU_CELL_CENTER = cell(10, 27);
export const TENGU_CELL_DOOR = cell(10, 23);
const START_TORCHES: ReadonlyArray<readonly [number, number]> = [[10, 2], [7, 9], [13, 9], [7, 15], [13, 15], [8, 23], [12, 23]];
/** Where items and characters are kept when the arena replaces the level. */
export const PAUSE_SAFE_AREA = rect(9, 2, 12, 12);
export const ARENA = rect(3, 1, 18, 16);
const END_START = { x: START_HALLWAY.left + 2, y: START_HALLWAY.top + 2 };
/** The way down, in the end map (its transition reaches two right and three down). */
export const LEVEL_EXIT = cell(END_START.x + 11, END_START.y + 6);
export const EXIT_CELLS: readonly number[] = [0, 1, 2].flatMap((dy) => [0, 1].map((dx) => LEVEL_EXIT + dx + dy * WIDTH));

const W = T.WALL;
const D = T.WALL_DECO;
const e = T.EMPTY;
const E = T.EXIT;
const C = T.CHASM;
// prettier-ignore
const END_MAP: readonly number[] = [
  W, W, D, W, W, W, W, W, W, W, W, W, W, W,
  W, e, e, e, W, W, W, W, W, W, W, W, W, W,
  W, e, e, e, e, e, e, e, e, W, W, W, W, W,
  e, e, e, e, e, e, e, e, e, e, e, e, W, W,
  e, e, e, e, e, e, e, e, e, e, e, e, e, W,
  e, e, e, C, C, C, C, C, C, C, C, e, e, W,
  e, W, C, C, C, C, C, C, C, C, C, E, E, W,
  e, e, e, C, C, C, C, C, C, C, C, E, E, W,
  e, e, e, e, e, C, C, C, C, C, C, E, E, W,
  e, e, e, e, e, e, e, W, W, W, C, C, C, W,
  W, e, e, e, e, e, W, W, W, W, C, C, C, W,
  W, e, e, e, e, W, W, W, W, W, W, C, C, W,
  W, W, W, W, W, W, W, W, W, W, W, C, C, W,
  W, W, W, W, W, W, W, W, W, W, W, C, C, W,
  W, D, W, W, W, W, W, W, W, W, W, C, C, W,
  e, e, e, W, W, W, W, W, W, W, W, C, C, W,
  e, e, e, W, W, W, W, W, W, W, W, C, C, W,
  e, e, e, W, W, W, W, W, W, W, W, C, C, W,
  e, e, e, W, W, W, W, W, W, W, W, C, C, W,
  e, e, e, W, W, W, W, W, W, W, W, C, C, W,
  e, e, e, W, W, W, W, W, W, W, W, C, C, W,
  e, e, e, W, W, W, W, W, W, W, W, C, C, W,
  W, W, W, W, W, W, W, W, W, W, W, C, C, W,
];

const SIZE = 32;

function fill(map: number[], x: number, y: number, w: number, h: number, value: number): void {
  for (let row = y; row < y + h; row++) for (let col = x; col < x + w; col++) map[cell(col, row)] = value;
}

/** Painter.fill(level, rect, m, value). */
function fillRect(map: number[], r: SRect, m: number, value: number): void {
  fill(map, r.left + m, r.top + m, r.right - r.left - m * 2, r.bottom - r.top - m * 2, value);
}

/** Painter.fillEllipse(level, rect, m, value). */
function fillEllipse(map: number[], r: SRect, m: number, value: number): void {
  const x = r.left + m;
  const y = r.top + m;
  const w = r.right - r.left - m * 2;
  const h = r.bottom - r.top - m * 2;
  const radH = h / 2;
  const radW = w / 2;
  for (let i = 0; i < h; i++) {
    const rowY = -radH + 0.5 + i;
    let rowW = 2.0 * Math.sqrt(radW * radW * (1.0 - (rowY * rowY) / (radH * radH)));
    rowW = w % 2 === 0 ? Math.round(rowW / 2.0) * 2.0 : Math.floor(rowW / 2.0) * 2.0 + 1;
    const start = x + Math.trunc((w - rowW) / 2);
    fill(map, start, y + i, rowW, 1, value);
  }
}

export const inRect = (r: SRect, pos: number): boolean => {
  const x = pos % WIDTH;
  const y = Math.trunc(pos / WIDTH);
  return x >= r.left && x < r.right && y >= r.top && y < r.bottom;
};

/** Rect.inside(Point): its edges included. */
export const insideRect = (r: SRect, pos: number): boolean => {
  const x = pos % WIDTH;
  const y = Math.trunc(pos / WIDTH);
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
};

/** PrisonBossLevel.randomPrisonCellPos. */
export function randomPrisonCellPos(rng: Rng): number {
  const room = START_CELLS[rng.int(START_CELLS.length)]!;
  return rng.intRange(room.left + 1, room.right - 2) + WIDTH * rng.intRange(room.top + 1, room.bottom - 2);
}

/** PrisonBossLevel.randomTenguCellPos. */
export function randomTenguCellPos(rng: Rng): number {
  return rng.intRange(TENGU_CELL.left + 1, TENGU_CELL.right - 2) + WIDTH * rng.intRange(TENGU_CELL.top + 1, TENGU_CELL.bottom - 2);
}

/** PrisonBossLevel.addCagesToCells: up to five cages against the cells' walls, always in the same places (seedCurDepth). */
function addCages(map: number[], seed: bigint | number): void {
  const rng = Rng.seeded(deriveSeed(seed, Stream.LAYOUT, 10, 1));
  for (let i = 0; i < 5; i++) {
    const pos = randomPrisonCellPos(rng);
    if ([-WIDTH, -1, +1, +WIDTH].some((n) => map[pos + n] === T.WALL)) map[pos] = REGION_DECO;
  }
}

/** PrisonBossLevel.setMapStart. */
export function setMapStart(map: number[], seed: bigint | number): void {
  fill(map, 0, 0, SIZE, SIZE, T.WALL);
  fillRect(map, ENTRANCE_ROOM, 0, T.WALL);
  fillRect(map, ENTRANCE_ROOM, 1, T.EMPTY);
  map[ENTRANCE_POS] = T.ENTRANCE;
  fillRect(map, START_HALLWAY, 0, T.WALL);
  fillRect(map, START_HALLWAY, 1, T.EMPTY);
  map[cell(START_HALLWAY.left + 1, START_HALLWAY.top)] = T.DOOR;
  for (const r of START_CELLS) {
    fillRect(map, r, 0, T.WALL);
    fillRect(map, r, 1, T.EMPTY);
  }
  map[cell(START_HALLWAY.left, START_HALLWAY.top + 5)] = T.DOOR;
  map[cell(START_HALLWAY.right - 1, START_HALLWAY.top + 5)] = T.DOOR;
  map[cell(START_HALLWAY.left, START_HALLWAY.top + 11)] = T.DOOR;
  map[cell(START_HALLWAY.right - 1, START_HALLWAY.top + 11)] = T.DOOR;
  fillRect(map, TENGU_CELL, 0, T.WALL);
  fillRect(map, TENGU_CELL, 1, T.EMPTY);
  map[TENGU_CELL_DOOR] = T.LOCKED_DOOR;
  for (const [x, y] of START_TORCHES) map[cell(x, y)] = T.WALL_DECO;
  addCages(map, seed);
}

/** PrisonBossLevel.setMapPause: Tengu's cell opens, a way leads up the hallway, the stairs room is walled off. */
export function setMapPause(map: number[], seed: bigint | number): void {
  setMapStart(map, seed);
  map[TENGU_CELL_DOOR] = T.DOOR;
  fill(map, START_CELLS[1]!.left, START_CELLS[1]!.top + 3, 1, 7, T.EMPTY);
  fill(map, START_CELLS[1]!.left + 2, START_CELLS[1]!.top + 2, 3, 10, T.EMPTY);
  fillRect(map, ENTRANCE_ROOM, 0, T.WALL);
  map[cell(START_HALLWAY.left + 1, START_HALLWAY.top)] = T.EMPTY;
  map[cell(START_HALLWAY.left + 1, START_HALLWAY.top + 1)] = T.DOOR;
  addCages(map, seed);
}

/** PrisonBossLevel.setMapArena: an oval arena, walls all round. */
export function setMapArena(map: number[]): void {
  fill(map, 0, 0, SIZE, SIZE, T.WALL);
  fillRect(map, ARENA, 0, T.WALL);
  fillEllipse(map, ARENA, 1, T.EMPTY);
}

/** PrisonBossLevel.setMapEnd: the start's layout, Tengu's cell open, and the way down past the chasm. */
export function setMapEnd(map: number[], seed: bigint | number): void {
  fill(map, 0, 0, SIZE, SIZE, T.WALL);
  setMapStart(map, seed);
  map[TENGU_CELL_DOOR] = T.DOOR;
  let i = 0;
  for (let row = END_START.y; row < SIZE && i < END_MAP.length; row++) {
    for (let col = 0; col < 14; col++) map[cell(END_START.x + col, row)] = END_MAP[i++]!;
  }
  addCages(map, seed);
}

export const PRISON_BOSS_STYLE: RegionStyle = { ...PRISON_STYLE, decorate: () => undefined };

/** PrisonBossLevel.build: the start's layout; the iron key to Tengu's cell lies in one of the prison cells. */
export function buildPrisonBossLevel(level: LevelBuilder): boolean {
  setMapStart(level.map, level.layoutSeed);
  level.entrance = ENTRANCE_POS;
  level.exit = LEVEL_EXIT;
  level.exits = [...EXIT_CELLS];
  level.arenaDoor = TENGU_CELL_DOOR;
  // PrisonBossLevel.createItems: the key, in a random prison cell.
  let pos: number;
  do {
    pos = randomPrisonCellPos(level.rng);
  } while (level.map[pos] !== T.EMPTY);
  level.dropItem(pos, HeapType.HEAP, { roll: 'key' });
  return true;
}
