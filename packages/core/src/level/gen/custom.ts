import { Dungeon } from './dungeon';
import type { CustomTile } from './genlevel';

/*
 * tiles/CustomTilemap and its kinds: art laid over part of a level, from one of Shattered's
 * environment/custom_tiles/*.png (16x16 tiles), worked out when the level is made so the client
 * only has to draw `data` (tile indices into the texture, row by row; -1 draws nothing).
 */

/** CustomTilemap.mapSimpleImage: a w x h block of a texture `texW` pixels wide, from tile (txX, txY). */
export function mapSimpleImage(txX: number, txY: number, texW: number, tileW: number, tileH: number): number[] {
  const data = new Array<number>(tileW * tileH);
  const texTileWidth = texW / 16;
  let x = txX;
  let y = txY;
  for (let i = 0; i < data.length; i++) {
    data[i] = x + texTileWidth * y;
    x++;
    if (x - txX === tileW) {
      x = txX;
      y++;
    }
  }
  return data;
}

/** A custom tilemap of some kind over a rectangle of the level (in the level's tile coordinates). */
export function customTile(kind: string, texture: string, x: number, y: number, w: number, h: number, data: number[], wall = false): CustomTile {
  return { kind, texture, x, y, w, h, data, ...(wall ? { wall } : {}) };
}

/** tiles/custom/Carpet: a carpet laid over a rectangle, stitched at its edges, in the region's colours. */
export class Carpet {
  static readonly SKIP = -1;
  // The first 80 tiles are carpet and its stitching; the custom ones follow.
  static readonly CITY_STATUE = 80;
  static readonly CITY_PEDESTAL = 81;
  static readonly CITY_ENTRANCE = 82;
  static readonly CITY_STATUE_TR = 83;
  static readonly CITY_STATUE_BR = 84;
  static readonly CITY_STATUE_TL = 85;
  static readonly CITY_STATUE_BL = 86;
  static readonly CITY_PEDESTAL_TR = 87;
  static readonly CITY_PEDESTAL_TL = 88;

  tileX = 0;
  tileY = 0;
  tileW = 1;
  tileH = 1;
  private readonly overrides = new Map<number, number>();

  setRect(x: number, y: number, w: number, h: number): this {
    this.tileX = x;
    this.tileY = y;
    this.tileW = w;
    this.tileH = h;
    return this;
  }

  /** A tile in carpet coordinates (0,0 its top-left) drawn otherwise. */
  overrideTile(x: number, y: number, override: number): void {
    this.overrides.set(x + this.tileW * y, override);
  }

  /** A tile in level coordinates drawn otherwise. */
  overrideLevelTile(x: number, y: number, override: number): void {
    this.overrideTile(x - this.tileX, y - this.tileY, override);
  }

  /** Carpet.create: the region's carpet, its edges stitched (+1 top, +2 right, +4 bottom, +8 left). */
  toCustomTile(): CustomTile {
    const data: number[] = [];
    const regionOfs = 16 * Math.trunc((Dungeon.depth - 1) / 5);
    let i = 0;
    for (let y = 0; y < this.tileH; y++) {
      for (let x = 0; x < this.tileW; x++) {
        const override = this.overrides.get(i);
        if (override !== undefined) {
          data.push(override);
        } else {
          let tile = regionOfs;
          if (y === 0) tile += 1;
          if (x === this.tileW - 1) tile += 2;
          if (y === this.tileH - 1) tile += 4;
          if (x === 0) tile += 8;
          data.push(tile);
        }
        i++;
      }
    }
    return customTile('Carpet', 'carpet', this.tileX, this.tileY, this.tileW, this.tileH, data);
  }
}
