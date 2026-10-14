import {
  deriveSeed, discoverable, HEIGHT, LENGTH, type Level, PLANT_KINDS, type PlantInfo, Rng, T, TileSheet, TileVisuals, trapVisual, WIDTH,
} from '@pd/core';

/*
 * Shattered's tilemaps on the canvas (tiles/DungeonTerrainTilemap, DungeonWallsTilemap,
 * RaisedTerrainTilemap, TerrainFeaturesTilemap, WallOcclusionTilemap and the custom tilemaps):
 * a ground layer under everything (floors, the faces of walls, doors, water's edges, chasms,
 * occlusion shadows, traps, plants, grass) and an upper layer drawn over the characters (the tops
 * of walls and what overhangs the cell below, the tops of tall grass). Both are baked once per
 * level and patched where the map, the traps or the plants change.
 */

export const TILE = 16;

/** Shattered's environment sheets, as loaded (sprites.ts). */
export interface TileSheets {
  /** tiles_sewers, tiles_prison, tiles_caves, tiles_city, tiles_halls; then the mine's two. */
  tiles: HTMLImageElement[];
  minesCrystal: HTMLImageElement;
  minesGnoll: HTMLImageElement;
  water: HTMLImageElement[];
  features: HTMLImageElement;
  raised: HTMLImageElement;
  occlusion: HTMLImageElement;
  /** environment/custom_tiles, by name, once loaded. */
  custom: Map<string, HTMLImageElement>;
}

/** Plant.image of each pd-ts plant (the row of plants in terrain_features.png). */
const PLANT_IMAGES: Record<string, number> = {
  rotberry: 0, firebloom: 1, swiftthistle: 2, sungrass: 3, icecap: 4, dreamweed: 5, stormvine: 5, sorrowmoss: 6, mageroyal: 7,
  earthroot: 8, starflower: 9, fadeleaf: 10, blindweed: 11, blandfruit: 12,
};

/** The region of a level's tiles (Level.tilesTex): 0 sewers .. 4 halls. */
export const tilesRegion = (level: Level): number => Math.min(4, Math.max(0, level.region ?? Math.trunc((level.depth - 1) / 5)));

function drawTile(ctx: CanvasRenderingContext2D, image: HTMLImageElement, index: number, x: number, y: number): void {
  if (index < 0) return;
  const cols = Math.max(1, Math.trunc(image.width / TILE));
  ctx.drawImage(image, (index % cols) * TILE, Math.trunc(index / cols) * TILE, TILE, TILE, x, y, TILE, TILE);
}

export class LevelTiles {
  readonly ground: HTMLCanvasElement;
  readonly upper: HTMLCanvasElement;
  /** Cells whose ground tile lets the water below show (water, and the alchemy pot's water). */
  readonly water = new Uint8Array(LENGTH);
  private readonly variance = new Uint8Array(LENGTH);
  private map = new Uint8Array(LENGTH);
  private traps: Int16Array = new Int16Array(LENGTH).fill(-1);
  private plants: Int16Array = new Int16Array(LENGTH).fill(-1);
  private sheet: HTMLImageElement;
  private customKey = '';

  constructor(readonly level: Level, private readonly sheets: TileSheets, seed: number) {
    this.ground = document.createElement('canvas');
    this.upper = document.createElement('canvas');
    for (const canvas of [this.ground, this.upper]) {
      canvas.width = WIDTH * TILE;
      canvas.height = HEIGHT * TILE;
    }
    // DungeonTileSheet.setupVariance: each cell's 0-99, from the depth's own seed.
    const rng = Rng.seeded(deriveSeed(seed, 77, level.depth, level.branch ?? 0));
    for (let i = 0; i < LENGTH; i++) this.variance[i] = rng.int(100);
    this.sheet = this.tilesSheet();
  }

  private tilesSheet(): HTMLImageElement {
    const mine = this.level.mine;
    if (mine === 'crystal') return this.sheets.minesCrystal;
    if (mine === 'gnoll') return this.sheets.minesGnoll;
    return this.sheets.tiles[tilesRegion(this.level)]!;
  }

  private context(): TileVisuals.TileContext {
    const level = this.level;
    return {
      map: level.map, width: WIDTH, depth: level.region !== undefined ? level.region * 5 + 1 : level.depth,
      ...(level.mine ? { mine: level.mine } : {}), variance: this.variance,
    };
  }

  /** The trap and plant visuals of each cell, as they stand. */
  private features(plants: readonly PlantInfo[]): { traps: Int16Array; plants: Int16Array } {
    const traps = new Int16Array(LENGTH).fill(-1);
    for (const trap of this.level.traps ?? []) traps[trap.pos] = trap.visible ? trapVisual(trap) : -2;
    const plantsAt = new Int16Array(LENGTH).fill(-1);
    for (const plant of plants) plantsAt[plant.pos] = PLANT_IMAGES[plant.kind] ?? PLANT_KINDS.indexOf(plant.kind);
    return { traps, plants: plantsAt };
  }

  /** Draws every cell afresh. */
  bake(plants: readonly PlantInfo[]): void {
    this.sheet = this.tilesSheet();
    this.map = Uint8Array.from(this.level.map);
    ({ traps: this.traps, plants: this.plants } = this.features(plants));
    this.ground.getContext('2d')!.clearRect(0, 0, this.ground.width, this.ground.height);
    this.upper.getContext('2d')!.clearRect(0, 0, this.upper.width, this.upper.height);
    const open = discoverable(this.level.map);
    const ctx = this.context();
    for (let i = 0; i < LENGTH; i++) this.drawCell(i, ctx, open);
    this.drawCustom();
  }

  /** Redraws the cells whose terrain, trap or plant changed, and their neighbours (stitching depends on them). */
  patch(plants: readonly PlantInfo[]): void {
    const { traps, plants: plantsAt } = this.features(plants);
    const dirty = new Set<number>();
    for (let i = 0; i < LENGTH; i++) {
      if (this.map[i] !== this.level.map[i] || this.traps[i] !== traps[i] || this.plants[i] !== plantsAt[i]) {
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) dirty.add(i + dx + dy * WIDTH);
      }
    }
    this.traps = traps;
    this.plants = plantsAt;
    if (dirty.size === 0) return;
    this.map = Uint8Array.from(this.level.map);
    const open = discoverable(this.level.map);
    const ctx = this.context();
    const g = this.ground.getContext('2d')!;
    const u = this.upper.getContext('2d')!;
    for (const i of dirty) {
      if (i < 0 || i >= LENGTH) continue;
      const x = (i % WIDTH) * TILE;
      const y = Math.trunc(i / WIDTH) * TILE;
      g.clearRect(x, y, TILE, TILE);
      u.clearRect(x, y, TILE, TILE);
      this.drawCell(i, ctx, open);
    }
    this.drawCustom(dirty);
  }

  private drawCell(i: number, ctx: TileVisuals.TileContext, open: readonly boolean[]): void {
    const x = (i % WIDTH) * TILE;
    const y = Math.trunc(i / WIDTH) * TILE;
    const g = this.ground.getContext('2d')!;
    const u = this.upper.getContext('2d')!;
    const tile = this.level.map[i]!;
    const inside = (cell: number): boolean => {
      const cx = cell % WIDTH;
      const cy = Math.trunc(cell / WIDTH);
      return cx >= 1 && cy >= 1 && cx < WIDTH - 1 && cy < HEIGHT - 1;
    };
    const ground = TileVisuals.terrainVisual(ctx, i);
    // The water layer shows through water tiles (and the pot, and decorations standing in water).
    this.water[i] = (ground >= 32 && ground < 48) || tile === T.ALCHEMY || tile === T.CUSTOM_DECO_WTR ? 1 : 0;
    drawTile(g, this.sheet, ground, x, y);
    drawTile(g, this.sheets.occlusion, TileVisuals.occlusionVisual(ctx, i, open[i] === true, inside(i), tile === T.CHASM), x, y);
    drawTile(g, this.sheets.features, TileVisuals.featuresVisual(ctx, i, this.traps[i]!, this.plants[i]!), x, y);
    drawTile(u, this.sheets.raised, TileVisuals.raisedVisual(ctx, i), x, y);
    drawTile(u, this.sheet, TileVisuals.wallsVisual(ctx, i, inside), x, y);
  }

  /** The cell's own floor tile (FLOOR or an alternate by its variance), at (x, y): what lies under tall grass swaying or pressed down. */
  drawFloor(ctx: CanvasRenderingContext2D, cell: number, x: number, y: number): void {
    drawTile(ctx, this.sheet, TileVisuals.getVisualWithAlts(this.context(), TileSheet.FLOOR, cell), x, y);
  }

  /** The custom tilemaps (CustomTilemap): on the ground layer, or the upper one for walls; only where `cells` asks, if it does. */
  private drawCustom(cells?: ReadonlySet<number>): void {
    for (const custom of this.level.customTiles ?? []) {
      const image = custom.texture ? this.sheets.custom.get(custom.texture) : undefined;
      if (!image || !custom.data) continue;
      const layer = (custom.wall ? this.upper : this.ground).getContext('2d')!;
      for (let ty = 0; ty < custom.h; ty++) {
        for (let tx = 0; tx < custom.w; tx++) {
          const cell = custom.x + tx + (custom.y + ty) * WIDTH;
          if (cells && !cells.has(cell)) continue;
          drawTile(layer, image, custom.data[tx + ty * custom.w] ?? -1, (custom.x + tx) * TILE, (custom.y + ty) * TILE);
        }
      }
    }
    this.customKey = String(this.level.customTiles?.length ?? 0);
  }

  /** Whether the custom tilemaps loaded since the bake (a texture arrives later): bake again then. */
  get customStale(): boolean {
    return (this.level.customTiles ?? []).some((c) => c.texture !== undefined && !this.sheets.custom.has(c.texture)) || this.customKey === '';
  }
}

/** The water of a level, scrolling slowly down as Shattered's does (5 pixels a second), under its water tiles. */
export function drawWater(ctx: CanvasRenderingContext2D, tiles: LevelTiles, water: HTMLImageElement, now: number, still: boolean): void {
  const pattern = ctx.createPattern(water, 'repeat');
  if (!pattern) return;
  const ofs = still ? 0 : (now / 200) % water.height;
  pattern.setTransform(new DOMMatrix().translate(0, ofs));
  ctx.fillStyle = pattern;
  for (let i = 0; i < LENGTH; i++) {
    if (tiles.water[i]) ctx.fillRect((i % WIDTH) * TILE, Math.trunc(i / WIDTH) * TILE, TILE, TILE);
  }
}

/** A terrain as its picture (DungeonTerrainTilemap.tile, flat), for windows and examine. */
export function flatTile(
  ctx: CanvasRenderingContext2D, sheets: TileSheets, level: Level, terrain: number, x: number, y: number, size = TILE,
): void {
  const image = sheets.tiles[tilesRegion(level)]!;
  const visual = TileVisuals.flatVisual({ map: level.map, width: WIDTH, depth: level.depth, variance: new Uint8Array(LENGTH) }, 0, terrain);
  if (visual < 0) return;
  const cols = Math.trunc(image.width / TILE);
  ctx.drawImage(image, (visual % cols) * TILE, Math.trunc(visual / cols) * TILE, TILE, TILE, x, y, size, size);
}
