import {
  type BossArt, cell, F, type Floor, hasFlag, HEIGHT, isWater, type Level, PYLON_POSITIONS, T, THRONE, WIDTH, type World,
} from '@pd/core';
import type { Assets } from './sprites';
import { TILE } from './view';

/*
 * Shattered's custom tiles on the boss levels (CustomTilemap): Goo's nest and
 * the sewers' way down, the prison's way down once Tengu is beaten, DM-300's
 * arena (wires, the pylons' bases, the gate) and the way into the city, the
 * Dwarf King's throne room with its carpets, statues and banners and the
 * demon halls' ground beyond, Yog's centre piece, and the Amulet's hall. Laid
 * over the region's own tiles: `ground` under the characters, `wall` over them.
 */

type Sheet = BossArt['sheet'];

/** Every piece of art over a level as it is now: the static from the level, the rest worked out from the world. */
export function bossArt(world: World, level: Level, floor: Floor | undefined): BossArt[] {
  const art = [...(level.boss?.art ?? [])];
  switch (level.depth) {
    case 10:
      if (floor?.boss?.prison === 'won') art.push(...prisonExit());
      break;
    case 15:
      art.push(cavesArena(level, floor));
      break;
    case 20:
      art.push(...cityArt(level));
      break;
    case 25:
      art.push(...hallsCentre(level));
      break;
    case 26:
      art.push(...lastLevelArt(level, world.amuletTaken === true));
      break;
  }
  return art;
}

/** CustomTilemap.mapSimpleImage: a w×h block of the texture from tile (txX, txY), 16 tiles a row. */
function simpleImage(txX: number, txY: number, w: number, h: number, cols = 16): number[] {
  const data: number[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.push(txX + x + (txY + y) * cols);
  return data;
}

/** PrisonBossLevel.ExitVisual and ExitVisualWalls: the way down past the chasm. */
function prisonExit(): BossArt[] {
  const rows = (lines: string[]): number[] => lines.join('').split('').map(Number);
  const ground = rows([
    '00001111100000', '10001111111100', '10011111111110', '10011111111110', '10111111111110', '11100000000110',
    '10110000000110', '10011100000110', '00001110000110', '00011100000000', '00011000000000',
  ]);
  const walls = rows([
    '00000000010000', '00000000000010', '00000000000001', '00000000000001', '01000000001111', '00000000001111',
    '00000000001111', '00000001111111', '10000011011111', '00000110011111', '00011100001001',
    ...new Array<string>(11).fill('00000000001001'),
  ]);
  const mask = (tiles: number[], render: number[]): number[] => tiles.map((t, i) => (render[i] ? t : -1));
  return [
    { sheet: 'prison_exit', x: 11, y: 10, w: 14, tiles: mask(simpleImage(0, 0, 14, 11), ground), layer: 'ground' },
    { sheet: 'prison_exit', x: 11, y: 10, w: 14, tiles: mask(simpleImage(0, 10, 14, 22), walls), layer: 'wall' },
  ];
}

/** CavesBossLevel.ArenaVisuals: the pylons' bases, the exposed wires, the gate (whole, or blown open). */
function cavesArena(level: Level, floor: Floor | undefined): BossArt {
  const top = 12;
  const tileW = 33;
  const tileH = 27;
  const tiles: number[] = [];
  const locked = floor?.boss?.locked === true;
  const pylonAt = (pos: number): boolean => (floor?.mobs ?? []).some((m) => m.kind === 'pylon' && m.pos === pos);
  for (let y = top; y < top + tileH; y++) {
    for (let x = 0; x < tileW; x++) {
      const j = cell(x, y);
      const t = level.map[j]!;
      let tile = -1;
      if (y === 13 && x >= 14 && x <= 18) {
        // The gate: five tiles, whole while it stands.
        tile = (hasFlag(t, F.SOLID) ? 40 : 32) + (x - 14);
      } else if (t === T.EMPTY_SP) {
        for (const k of PYLON_POSITIONS) {
          const kx = k % WIDTH;
          const ky = Math.trunc(k / WIDTH);
          if (k === j) tile = locked && !pylonAt(k) ? 38 : -1;
          else if (Math.abs(kx - x) <= 1 && Math.abs(ky - y) <= 1) tile = 54 + (x + 8 * y) - (kx + 8 * ky);
        }
      } else if (t === T.INACTIVE_TRAP) {
        tile = 37;
      }
      tiles.push(tile);
    }
  }
  return { sheet: 'caves_boss', x: 0, y: top, w: tileW, tiles, layer: 'ground' };
}

/** The King's level in Shattered's terms, row by row 15 wide: the throne (CUSTOM_DECO) apart from the carpets. */
function cityMap(level: Level): { map: number[]; throne: number } {
  const w = 15;
  const map: number[] = [];
  for (let y = 0; y < 48; y++) for (let x = 0; x < w; x++) map.push(level.map[cell(x, y)]!);
  return { map, throne: (THRONE % WIDTH) + Math.trunc(THRONE / WIDTH) * w };
}

/** CityBossLevel.CustomGroundVisuals, CustomTerrainVisuals and CustomWallVisuals. */
function cityArt(level: Level): BossArt[] {
  const w = 15;
  const h = 48;
  const { map, throne } = cityMap(level);
  const chasm = (t: number | undefined): boolean => t !== undefined && hasFlag(t, F.PIT);
  const isWall = (t: number | undefined): boolean => t === T.WALL;
  const isThrone = (i: number): boolean => i === throne;
  const isCarpet = (i: number): boolean => map[i] === T.EMPTY_SP && !isThrone(i);
  const isStatue = (i: number): boolean => map[i] === T.STATUE;
  const ground = new Array<number>(w * h).fill(-1);
  let stairsTop = -1;
  for (let i = w; i < w * 22; i++) {
    const t = map[i]!;
    if (t === T.EXIT && stairsTop === -1) stairsTop = i;
    if (isWall(t) && chasm(map[i - w])) {
      ground[i] = 13 * 8 + 6;
      ground[++i] = 13 * 8 + 7;
    } else if (isWall(t) && isWall(map[i - w])) {
      ground[i] = 14 * 8 + 6;
      ground[++i] = 14 * 8 + 7;
    } else if (i > w && chasm(t) && isWall(map[i - w])) {
      ground[i] = 15 * 8 + 6;
      ground[++i] = 15 * 8 + 7;
    } else if (t === T.PEDESTAL) {
      ground[i] = 12 * 8 + 5;
    } else if (isStatue(i)) {
      ground[i] = 15 * 8 + 5;
    } else if (t === T.EMPTY || t === T.EMPTY_DECO || t === T.EMBERS || t === T.GRASS || t === T.HIGH_GRASS) {
      if (Math.trunc(i / w) === 21) {
        for (let k = 0; k < 7; k++) ground[i + k] = 11 * 8 + k;
        i += 6;
      } else if (chasm(map[i - 1])) ground[i] = 12 * 8 + 1;
      else if (chasm(map[i + 1])) ground[i] = 12 * 8 + 3;
      else if (t === T.EMPTY_DECO) ground[i] = 12 * 8 + 4;
      else ground[i] = 12 * 8 + 2;
    }
  }
  if (stairsTop >= 0) {
    for (let r = 0; r < 7; r++) {
      for (let j = 0; j < 7; j++) ground[stairsTop + j] = (r + 4) * 8 + j;
      stairsTop += w;
    }
  }
  for (let i = w * 22; i < w * h; i++) {
    const t = map[i]!;
    if (t === T.PEDESTAL) {
      ground[i] = 13 * 8 + 4;
    } else if (isStatue(i)) {
      if (i < w * 32) {
        if (i % w > 7) {
          ground[i] = 10 * 8 + 7;
          ground[++i] = 11 * 8 + 7;
        } else {
          ground[i] = 8 * 8 + 7;
          ground[++i] = 9 * 8 + 7;
        }
      } else if (i % w > 7) {
        ground[i] = 15 * 8 + 4;
      }
    } else if (isCarpet(i)) {
      if (isCarpet(i + 1) && isCarpet(i + w)) {
        ground[i] = 13 * 8 + 1;
        ground[++i] = 13 * 8 + 2;
        ground[++i] = 13 * 8 + 3;
      } else if (isThrone(i + 1)) {
        ground[i] = 14 * 8 + 1;
        ground[++i] = 14 * 8 + 2;
        ground[++i] = 14 * 8 + 3;
      } else if (isCarpet(i + 1) && isCarpet(i - w)) {
        ground[i] = 15 * 8 + 1;
        ground[++i] = 15 * 8 + 2;
        ground[++i] = 15 * 8 + 3;
      } else if (!isCarpet(i - w) || isThrone(i - 2 * w)) {
        ground[i] = 13 * 8;
      } else if (!isCarpet(i + w)) {
        ground[i] = 15 * 8;
      } else {
        ground[i] = 14 * 8;
      }
    }
  }
  // CustomTerrainVisuals: the skull piles above, the statues and the banners along the walls below.
  const terrain = new Array<number>(w * h).fill(-1);
  for (let i = w; i < w * 22; i++) if (isStatue(i)) terrain[i] = 15 * 8 + 5;
  for (let i = w * 22; i < w * h; i++) {
    const t = map[i]!;
    if (isStatue(i)) {
      if (i < w * 32) {
        if (i % w > 7) {
          terrain[i] = 10 * 8 + 7;
          terrain[++i] = 11 * 8 + 7;
        } else {
          terrain[i] = 8 * 8 + 7;
          terrain[++i] = 9 * 8 + 7;
        }
      } else if (i % w > 7) {
        terrain[i] = 15 * 8 + 4;
      }
    } else if (i < w * 32 && t === T.WALL_DECO && map[i + w] !== T.WALL) {
      terrain[i] = 6 * 8 + 7;
    } else if (i < w * 32 && (t === T.EMPTY || t === T.EMPTY_DECO) && map[i - w] === T.WALL_DECO) {
      terrain[i] = 7 * 8 + 7;
    }
  }
  // CustomWallVisuals: the pillars' tops, the skulls' tops, the stairs' shadow, the throne's back.
  const walls = new Array<number>(w * h).fill(-1);
  let shadowTop = -1;
  for (let i = w; i < w * 21; i++) {
    const t = map[i]!;
    if (t === T.EXIT && shadowTop === -1) shadowTop = i - w * 4;
    if (chasm(t) && isWall(map[i + w])) {
      walls[i] = 12 * 8 + 6;
      walls[++i] = 12 * 8 + 7;
    } else if (isWall(t) && chasm(map[i - w])) {
      walls[i] = 13 * 8 + 6;
      walls[++i] = 13 * 8 + 7;
    } else if (isStatue(i + w)) {
      walls[i] = 14 * 8 + 5;
    }
  }
  if (shadowTop >= 0) {
    for (let r = 0; r < 8; r++) {
      const base = r < 4 ? r * 8 : (r - 4) * 8 + 3;
      walls[shadowTop] = base;
      for (let k = 1; k <= 6; k++) walls[shadowTop + k] = base + 1;
      walls[shadowTop + 7] = base + 2;
      shadowTop += w;
    }
  }
  for (let i = w * 21; i < w * h; i++) {
    if (isStatue(i) && i % w > 7) walls[i - w] = 14 * 8 + 4;
    else if (isThrone(i)) walls[i - w] = 13 * 8 + 5;
  }
  return [
    { sheet: 'city_boss', x: 0, y: 0, w, tiles: ground, layer: 'ground' },
    { sheet: 'city_boss', x: 0, y: 0, w, tiles: terrain, layer: 'ground' },
    { sheet: 'city_boss', x: 0, y: 0, w, tiles: walls, layer: 'wall' },
  ];
}

/** HallsBossLevel.CenterPieceVisuals and CenterPieceWalls: Yog's pit, closed until it falls. */
function hallsCentre(level: Level): BossArt[] {
  const open = level.map[level.exit] === T.EXIT;
  // prettier-ignore
  const ground = [
    8, 9, 10, 11, 11, 11, 12, 13, 14,
    16, 17, 18, 27, 19, 27, 20, 21, 22,
    24, 25, 26, 19, 19, 19, 28, 29, 30,
    24, 25, 26, 19, 19, 19, 28, 29, 30,
    24, 25, 26, 19, 19, 19, 28, 29, 30,
    24, 25, 34, 35, 35, 35, 34, 29, 30,
    40, 41, 36, 36, 36, 36, 36, 40, 41,
    48, 49, 36, 36, 36, 36, 36, 48, 49,
  ];
  const walls = new Array<number>(81).fill(-1);
  walls.splice(54, 9, 32, 33, -1, -1, -1, -1, -1, 32, 33);
  walls.splice(63, 9, 40, 41, -1, -1, -1, -1, -1, 40, 41);
  if (open) {
    ground[4] = 19;
    ground[12] = ground[14] = 31;
    walls[3] = 1;
    walls[4] = 0;
    walls[5] = 2;
    walls[13] = 23;
  }
  return [
    { sheet: 'halls_sp', x: 12, y: 9, w: 9, tiles: ground, layer: 'ground' },
    { sheet: 'halls_sp', x: 12, y: 8, w: 9, tiles: walls, layer: 'wall' },
  ];
}

/** LastLevel.CustomFloor and its centre pieces: candles round the Amulet, the walk, Yog's hall far below. */
function lastLevelArt(level: Level, taken: boolean): BossArt[] {
  const w = 16;
  const roomTop = 10;
  const h = 48;
  const amulet = cell(8, 12);
  // prettier-ignore
  const CANDLES = [
    -1, 42, 46, 46, 46, 43, -1,
    42, 46, 46, 46, 46, 46, 43,
    46, 46, 45, 19, 44, 46, 46,
    46, 46, 19, 19, 19, 46, 46,
    46, 46, 43, 19, 42, 46, 46,
    44, 46, 46, 19, 46, 46, 45,
    -1, 44, 45, 19, 44, 45, -1,
  ];
  const floorW = 7;
  const floorH = h - roomTop;
  const tiles = new Array<number>(floorW * floorH).fill(0);
  const variance = (c: number): number => ((c * 2654435761) >>> 0) % 100;
  for (let y = 0; y < floorH; y++) {
    for (let x = 0; x < floorW; x++) {
      const c = cell(5 + x, y);
      const i = x + y * floorW;
      const cx = 5 + x - ((amulet % WIDTH) - 3);
      const cy = y - (Math.trunc(amulet / WIDTH) - 3);
      if (cx >= 0 && cx < 7 && cy >= 0 && cy < 7) {
        let candle = CANDLES[cx + cy * 7]!;
        if (candle === 46 && variance(c) >= 50) candle++;
        if (taken && candle > 40) candle += 8;
        tiles[i] = candle;
        continue;
      }
      const t = level.map[c]!;
      tiles[i] = t === T.EMPTY_DECO ? (taken ? 31 : 27) : t === T.EMPTY ? 19 : -1;
    }
  }
  // prettier-ignore
  const centre = [
    -1, -1, -1, -1, -1, -1, -1, -1, 19, -1, -1, -1, -1, -1, -1, -1,
    0, 0, 0, 0, 8, 9, 10, 11, 19, 11, 12, 13, 14, 0, 0, 0,
    0, 0, 0, 0, 16, 17, 18, 31, 19, 31, 20, 21, 22, 0, 0, 0,
    0, 0, 0, 0, 24, 25, 26, 19, 19, 19, 28, 29, 30, 0, 0, 0,
    0, 0, 0, 0, 24, 25, 26, 19, 19, 19, 28, 29, 30, 0, 0, 0,
    0, 0, 0, 0, 24, 25, 26, 19, 19, 19, 28, 29, 30, 0, 0, 0,
    0, 0, 0, 0, 24, 25, 34, 35, 35, 35, 34, 29, 30, 0, 0, 0,
    0, 0, 0, 0, 40, 41, 36, 36, 36, 36, 36, 40, 41, 0, 0, 0,
    0, 0, 0, 0, 48, 49, 36, 36, 36, 36, 36, 48, 49, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  ];
  // prettier-ignore
  const walls = [
    4, 4, 4, 4, 4, 4, 4, 5, 7, 3, 4, 4, 4, 4, 4, 4,
    0, 0, 0, 0, 0, 0, 0, 1, 15, 2, 0, 0, 0, 0, 0, 0,
    -1, -1, -1, -1, -1, -1, -1, -1, 23, -1, -1, -1, -1, -1, -1, -1,
    ...new Array<number>(16 * 4).fill(-1),
    -1, -1, -1, -1, 32, 33, -1, -1, -1, -1, -1, 32, 33, -1, -1, -1,
    -1, -1, -1, -1, 40, 41, -1, -1, -1, -1, -1, 40, 41, -1, -1, -1,
  ];
  return [
    { sheet: 'halls_sp', x: 5, y: 0, w: floorW, tiles, layer: 'ground' },
    { sheet: 'halls_sp', x: 0, y: h - roomTop, w, tiles: centre, layer: 'ground' },
    { sheet: 'halls_sp', x: 0, y: h - roomTop - 1, w, tiles: walls, layer: 'wall' },
  ];
}

/** The texture of a sheet, and how many tiles it has a row. */
function texture(assets: Assets, sheet: Sheet): { image: HTMLImageElement; cols: number } {
  const image = assets.bossTiles[sheet];
  return { image, cols: Math.max(1, Math.floor(image.width / 16)) };
}

/**
 * Draws a layer of the art. `explored` and `visible` dim it as the fog does the map: ground art is
 * drawn under the fog anyway; wall art, over the characters, only where the party has been.
 */
export function drawBossArt(
  ctx: CanvasRenderingContext2D, assets: Assets, art: readonly BossArt[], layer: 'ground' | 'wall',
  explored: readonly boolean[], visible: readonly boolean[],
): void {
  for (const piece of art) {
    if (piece.layer !== layer) continue;
    const { image, cols } = texture(assets, piece.sheet);
    piece.tiles.forEach((tile, i) => {
      if (tile < 0) return;
      const x = piece.x + (i % piece.w);
      const y = piece.y + Math.trunc(i / piece.w);
      if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT) return;
      const at = x + y * WIDTH;
      if (!explored[at]) return;
      if (layer === 'wall') ctx.globalAlpha = visible[at] ? 1 : 0.45;
      ctx.drawImage(image, (tile % cols) * 16, Math.trunc(tile / cols) * 16, 16, 16, x * TILE, y * TILE, TILE, TILE);
    });
  }
  ctx.globalAlpha = 1;
}

/** Whether a cell is covered by ground art (the tile beneath is then the floor's, not a statue's). */
export function coveredCells(art: readonly BossArt[]): Set<number> {
  const covered = new Set<number>();
  for (const piece of art) {
    if (piece.layer !== 'ground') continue;
    piece.tiles.forEach((tile, i) => {
      if (tile >= 0) covered.add(cell(piece.x + (i % piece.w), piece.y + Math.trunc(i / piece.w)));
    });
  }
  return covered;
}

export { isWater };
