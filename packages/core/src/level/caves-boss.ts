import type { LevelBuilder } from './builder';
import { CAVES_STYLE } from './caves';
import type { BossArt } from './generate';
import { cell } from './geometry';
import type { RegionStyle } from './regular';
import { SLevel, srect } from './spainter';
import { F, hasFlag, T } from './terrain';
import { distanceMap, patchGenerate } from '../bosses/common';
import { STRONGER_BOSSES } from '../challenges';
import { Dungeon } from './gen/dungeon';

/*
 * Depth 15: DM-300's caves (CavesBossLevel), 33×42. The stairs stand in the
 * middle of a round arena strewn with water and live wires; a power pylon in
 * each corner. Above the arena a sealed gate, and beyond it the way down
 * across a chasm into the dwarven city. Stepping close to a pylon seals the
 * level: rocks close the stairs and DM-300 starts up somewhere in the arena.
 *
 * Shattered's custom decorations stand here as plain terrain until the levels
 * stream brings its own: the gate (Terrain.CUSTOM_DECO) as solid STATUE_SP
 * under the gate's art, the exit area's metal posts (REGION_DECO_ALT) as statues.
 */

export const CAVES_W = 33;
export const CAVES_H = 42;
/** CavesBossLevel.diggableArea, mainArena and gate, in its own coordinates. */
export const DIGGABLE_AREA = srect(2, 11, 31, 40);
export const MAIN_ARENA = srect(5, 14, 28, 37);
export const GATE = srect(14, 13, 19, 14);
/** Terrain.CUSTOM_DECO (the gate) and REGION_DECO_ALT. SEAM(levels): Shattered's own terrains. */
export const CUSTOM_DECO = T.STATUE_SP;
const REGION_DECO_ALT = T.STATUE;

/** The pylons, in our grid. */
export const PYLON_POSITIONS: readonly number[] = [cell(4, 13), cell(28, 13), cell(4, 37), cell(28, 37)];
/** The gate's cells, in our grid. */
export const GATE_CELLS: readonly number[] = [14, 15, 16, 17, 18].map((x) => cell(x, GATE.top));
/** The entrance: the middle of the arena. */
export const CAVES_ENTRANCE = cell(16, 25);

const n = -1;
const W = T.WALL;
const e = T.EMPTY;
const s = T.EMPTY_SP;

// prettier-ignore
const ENTRANCES: ReadonlyArray<readonly number[]> = [
  [n, n, n, n, n, n, n, n, n, n, n, n, n, n, n, n, n, n, n, n, W, e, W, W, n, n, n, W, W, e, W, W,
    n, n, W, W, e, e, e, e, n, n, e, e, e, W, W, e, n, n, W, W, e, W, e, e, n, n, W, W, e, e, e, e],
  [n, n, n, n, n, n, n, n, n, n, n, n, n, n, n, n, n, n, n, n, n, e, e, e, n, n, n, W, e, W, W, e,
    n, n, n, e, e, e, e, e, n, n, e, W, e, W, W, e, n, n, e, W, e, W, e, e, n, n, e, e, e, e, e, e],
  [n, n, n, n, n, n, n, n, n, n, n, n, n, n, n, n, n, n, n, n, n, n, n, n, n, n, n, W, W, e, W, W,
    n, n, n, W, W, e, W, W, n, n, n, e, e, e, e, e, n, n, n, W, W, e, W, e, n, n, n, W, W, e, e, e],
  [n, n, n, n, n, n, n, n, n, n, n, n, n, n, n, e, n, n, n, n, n, n, W, e, n, n, n, n, n, W, W, e,
    n, n, n, n, W, W, W, e, n, n, n, W, W, W, W, e, n, n, W, W, W, W, e, e, n, e, e, e, e, e, e, e],
];

// prettier-ignore
const CORNERS: ReadonlyArray<readonly number[]> = [
  [W, W, W, W, W, W, W, W, W, W, W, s, s, s, e, e, e, W, W, W, W, s, s, s, W, W, e, e, W, W, W, s, s, s, W, W, W, e, e, W,
    W, e, W, W, W, W, W, W, e, n, W, e, W, W, W, W, W, n, n, n, W, e, e, W, W, W, n, n, n, n, W, W, e, e, W, n, n, n, n, n,
    W, W, W, e, e, n, n, n, n, n, W, W, W, W, n, n, n, n, n, n],
  [W, W, W, W, W, W, W, W, W, W, W, s, s, s, W, W, W, W, W, W, W, s, s, s, e, e, e, e, e, W, W, s, s, s, W, W, W, W, e, e,
    W, W, e, W, W, W, W, W, W, e, W, W, e, W, W, W, W, n, n, n, W, W, e, W, W, W, n, n, n, n, W, W, e, W, W, n, n, n, n, n,
    W, W, e, e, W, n, n, n, n, n, W, W, W, e, e, n, n, n, n, n],
  [W, W, W, W, W, W, W, W, W, W, W, s, s, s, W, W, W, W, W, W, W, s, s, s, e, e, e, e, W, W, W, s, s, s, W, W, W, e, W, W,
    W, W, e, W, W, W, W, e, W, n, W, W, e, W, W, W, W, e, e, n, W, W, e, W, W, W, n, n, n, n, W, W, e, e, e, e, n, n, n, n,
    W, W, W, W, W, e, n, n, n, n, W, W, W, W, n, n, n, n, n, n],
  [W, W, W, W, W, W, W, W, W, W, W, s, s, s, W, W, W, W, W, W, W, s, s, s, e, e, e, W, W, W, W, s, s, s, W, W, e, W, W, W,
    W, W, e, W, W, W, e, W, W, n, W, W, e, W, W, W, e, e, n, n, W, W, e, e, e, e, e, n, n, n, W, W, W, W, W, e, n, n, n, n,
    W, W, W, W, W, n, n, n, n, n, W, W, W, W, n, n, n, n, n, n],
];

function buildEntrance(level: SLevel, rng: LevelBuilder['rng']): number {
  const w = level.w;
  const entrance = 16 + 25 * w;
  let nw = entrance - 7 - 7 * w;
  let ne = entrance + 7 - 7 * w;
  let se = entrance + 7 + 7 * w;
  let sw = entrance - 7 + 7 * w;
  const tiles = rng.oneOf(ENTRANCES);
  for (let i = 0; i < tiles.length; i++) {
    if (i % 8 === 0 && i !== 0) {
      nw += w - 8;
      ne += w + 8;
      se -= w - 8;
      sw -= w + 8;
    }
    if (tiles[i] !== n) level.map[nw] = level.map[ne] = level.map[se] = level.map[sw] = tiles[i]!;
    nw++;
    ne--;
    sw++;
    se--;
  }
  level.set(entrance, T.ENTRANCE);
  return entrance;
}

function buildCorners(level: SLevel, rng: LevelBuilder['rng']): void {
  const w = level.w;
  let nw = 2 + 11 * w;
  let ne = 30 + 11 * w;
  let se = 30 + 39 * w;
  let sw = 2 + 39 * w;
  const tiles = rng.oneOf(CORNERS);
  for (let i = 0; i < tiles.length; i++) {
    if (i % 10 === 0 && i !== 0) {
      nw += w - 10;
      ne += w + 10;
      se -= w - 10;
      sw -= w + 10;
    }
    if (tiles[i] !== n) level.map[nw] = level.map[ne] = level.map[se] = level.map[sw] = tiles[i]!;
    nw++;
    ne--;
    sw++;
    se--;
  }
}

/** DungeonTileSheet.floorTile: ground one walks on (doors and walls aside). */
const floorTile = (t: number): boolean => hasFlag(t, F.PASSABLE) && t !== T.DOOR && t !== T.OPEN_DOOR;

/** CavesPainter.decorate without rooms: worn floor beside walls, and veins of ore in the walls above floor. */
function decorate(level: SLevel, rng: LevelBuilder['rng']): void {
  const { map, w } = level;
  const l = level.length;
  for (let i = w + 1; i < l - w; i++) {
    if (map[i] !== T.EMPTY) continue;
    let count = 0;
    if (map[i + 1] === T.WALL) count++;
    if (map[i - 1] === T.WALL) count++;
    if (map[i + w] === T.WALL) count++;
    if (map[i - w] === T.WALL) count++;
    if (rng.int(6) <= count) map[i] = T.EMPTY_DECO;
  }
  for (let i = 0; i < l - w; i++) {
    if (map[i] === T.WALL && floorTile(map[i + w]!) && rng.int(4) === 0) map[i] = T.WALL_DECO;
  }
}

/** CavesBossLevel.CityEntrance, EntranceOverhang: the way out's custom tiles (static). */
function entranceArt(): BossArt[] {
  const tileW = CAVES_W;
  const tileH = 11;
  // prettier-ignore
  const entryWay = [-1, 7, 7, 7, -1, -1, 1, 2, 3, -1, 8, 1, 2, 3, 12, 16, 9, 10, 11, 20, 16, 16, 22, 20, 20, 16, 17, 18, 19, 20, 16, 16, 18, 20, 20, 16, 17, 18, 19, 20, 16, 16, 18, 20, 20, 16, 17, 18, 19, 20, 24, 25, 26, 27, 28];
  const ground = new Array<number>(tileW * tileH).fill(-1);
  let entryPos = 0;
  for (let i = 0; i < ground.length; i++) {
    if (i % tileW === Math.trunc(tileW / 2) - 2) {
      for (let k = 0; k < 4; k++) ground[i++] = entryWay[entryPos++]!;
      ground[i] = entryWay[entryPos++]!;
    } else if (Math.trunc(i / tileW) === 2) {
      ground[i] = 13;
    } else if (Math.trunc(i / tileW) === 3) {
      ground[i] = i % tileW === 9 || i % tileW === 23 ? -1 : 21;
    }
  }
  // prettier-ignore
  const overhangWay = [0, 7, 7, 7, 4, 0, 15, 15, 15, 4, -1, 23, 23, 23, -1, -1, -1, -1, -1, -1, -1, 6, -1, 14, -1, -1, -1, -1, -1, -1, -1, 6, -1, 14, -1, -1, -1, -1, -1, -1, -1, 6, -1, 14, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1];
  const wall = new Array<number>(tileW * tileH).fill(-1);
  entryPos = 0;
  for (let i = 0; i < wall.length; i++) {
    if (i % tileW === Math.trunc(tileW / 2) - 2) {
      for (let k = 0; k < 4; k++) wall[i++] = overhangWay[entryPos++]!;
      wall[i] = overhangWay[entryPos++]!;
    }
  }
  // EntranceTerrain: the posts beside the stairs up out of the arena (drawn as ground, they stand on the floor).
  // prettier-ignore
  const terrainWay = [-1, -1, -1, -1, -1, -1, -1, -1, -1, -1, 8, -1, -1, -1, 12, 30, -1, -1, -1, 31, -1, -1, -1, -1, -1, -1, 17, -1, 19, -1, -1, -1, -1, -1, -1, -1, 17, -1, 19, -1, -1, -1, -1, -1, -1, -1, 17, -1, 19, -1, -1, -1, -1, -1, -1];
  return [
    { sheet: 'caves_boss', x: 0, y: 0, w: tileW, tiles: ground, layer: 'ground' },
    { sheet: 'caves_boss', x: Math.trunc(CAVES_W / 2) - 2, y: 0, w: 5, tiles: terrainWay, layer: 'ground' },
    { sheet: 'caves_boss', x: 0, y: 0, w: tileW, tiles: wall, layer: 'wall' },
  ];
}

export const CAVES_BOSS_STYLE: RegionStyle = { ...CAVES_STYLE, decorate: () => undefined };

/** CavesBossLevel.build. */
export function buildCavesBossLevel(builder: LevelBuilder): boolean {
  const { rng } = builder;
  const level = new SLevel(CAVES_W, CAVES_H);
  const w = level.w;
  level.fillRect(GATE, 0, CUSTOM_DECO);
  level.fillEllipse(MAIN_ARENA, 0, T.EMPTY);
  const patch = patchGenerate(rng, w, CAVES_H - 14, 0.15, 2, true);
  for (let i = 14 * w; i < level.length; i++) {
    if (level.map[i] !== T.EMPTY) continue;
    if (patch[i - 14 * w]) level.map[i] = T.WATER;
    // One cell in eight is a live wire, one in four under the stronger bosses.
    else if (rng.int(Dungeon.isChallenged(STRONGER_BOSSES) ? 4 : 8) === 0) level.map[i] = T.INACTIVE_TRAP;
  }
  const entrance = buildEntrance(level, rng);
  buildCorners(level, rng);
  decorate(level, rng);

  // The exit area above the arena.
  level.fill(0, 3, w, 4, T.CHASM);
  level.fill(6, 7, 21, 1, T.CHASM);
  level.fill(9, 3, 1, 6, REGION_DECO_ALT);
  level.fill(23, 3, 1, 6, REGION_DECO_ALT);
  level.fill(10, 8, 13, 1, T.CHASM);
  level.fill(12, 9, 9, 1, T.CHASM);
  level.fill(13, 10, 7, 1, T.CHASM);
  level.fill(14, 3, 5, 10, T.EMPTY);
  level.fill(15, 2, 3, 3, T.EMPTY_SP);
  level.fill(15, 5, 3, 1, T.STATUE);
  level.fill(15, 7, 3, 1, T.STATUE);
  level.fill(15, 9, 3, 1, T.STATUE);
  level.fill(16, 5, 1, 6, T.EMPTY_SP);
  level.fill(15, 0, 3, 3, T.EXIT);

  // Every pylon can be reached without crossing water or wires.
  const pass = (c: number): boolean => {
    const t = level.map[c];
    return t === T.EMPTY || t === T.EMPTY_SP || t === T.EMPTY_DECO;
  };
  const dist = distanceMap(16 + 25 * w, pass, Infinity, w, level.length);
  for (const p of [4 + 13 * w, 28 + 13 * w, 4 + 37 * w, 28 + 37 * w]) {
    if (dist[p] === Infinity) return false;
  }

  level.blit(builder.map);
  builder.entrance = level.toCell(entrance);
  builder.exit = cell(16, 2);
  builder.exits = [15, 16, 17].flatMap((x) => [0, 1, 2].map((y) => cell(x, y))).filter((c) => builder.map[c] === T.EXIT);
  builder.boss = { pylons: [...PYLON_POSITIONS], art: entranceArt() };
  return true;
}
