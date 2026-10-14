import { createItem } from '../../../../items';
import { T } from '../../../terrain';
import { Carpet, customTile } from '../../custom';
import type { CustomTile, GenLevel } from '../../genlevel';
import { Painter } from '../../painter';
import { Random } from '../../random';
import type { Point } from '../../rect';
import { DoorType, type Room } from '../../room';
import { SecretRoom } from './secret';

/** environment/custom_tiles/rat_king_room.png: 0 a statue's base, 1 a statue, 2 a statue's top, 3 the pillow (4: a statue, as examined). */
const RAT_KING_ROOM = 'rat_king_room';

/**
 * RatKingRoom: the Rat King's hidden treasury off Goo's level: a 7x7 room, its king on a pillow
 * on a carpet in the middle, rat statues round him (but by the door) and gold all over the floor.
 */
export class RatKingRoom extends SecretRoom {
  readonly kind: string = 'RatKingRoom';

  /** Never connects to the entrance room. */
  override canConnect(r: Room): boolean {
    return r.kind !== 'SewerBossEntranceRoom' && super.canConnect(r);
  }

  override canPlaceWater(_p: Point): boolean {
    return false;
  }
  override canPlaceGrass(_p: Point): boolean {
    return false;
  }
  override canPlaceTrap(_p: Point): boolean {
    return false;
  }

  // 5x5 inside, so the layout always fits.
  override minWidth(): number {
    return 7;
  }
  override maxWidth(): number {
    return 7;
  }
  override minHeight(): number {
    return 7;
  }
  override maxHeight(): number {
    return 7;
  }

  paint(level: GenLevel): void {
    Painter.fill(level, this, T.WALL);
    Painter.fill(level, this, 1, T.EMPTY);
    Painter.fill(level, this, 2, T.EMPTY_SP);

    const entrance = this.entrance();
    entrance.set(DoorType.HIDDEN);
    const door = level.pointToCell(entrance);

    const center = level.pointToCell(this.center());
    const w = level.width;

    const statuePositions = [
      center - 2 - 2 * w, center - 2 * w, center + 2 - 2 * w, center + 2,
      center + 2 + 2 * w, center + 2 * w, center - 2 + 2 * w, center - 2,
    ];
    for (const cell of statuePositions) {
      if (level.distance(door, cell) >= 2) Painter.set(level, cell, T.CUSTOM_DECO);
    }

    // RatKingStatues is laid in Shattered's customTerrain (drawn as the terrain, under every
    // customTile); it comes first here, so that a client drawing in order layers it the same.
    level.customTiles.push(this.statues(level));
    level.customTiles.push(new Carpet().setRect(this.left + 2, this.top + 2, this.width() - 4, this.height() - 4).toCustomTile());
    level.customTiles.push(this.deco(level));
    level.customTiles.push(this.overhang(level));

    level.mobs.push({ kind: 'ratKing', pos: center, state: 'passive' });

    for (const p of this.getPoints()) {
      const cell = level.pointToCell(p);
      if (cell !== center && (level.map[cell] === T.EMPTY || level.map[cell] === T.EMPTY_SP)) {
        level.drop(createItem('gold', Random.IntRange(5, 20)), cell);
      }
    }
  }

  /** RatKingRoomDeco, over the inside: the statues' bases and the pillow in the middle. */
  private deco(level: GenLevel): CustomTile {
    const x0 = this.left + 1;
    const y0 = this.top + 1;
    const tileW = this.width() - 2;
    const tileH = this.height() - 2;
    const data: number[] = [];
    for (let y = 0; y < tileH; y++) {
      for (let x = 0; x < tileW; x++) {
        const cell = x0 + x + (y0 + y) * level.width;
        if (x === 2 && y === 2) data.push(3);
        else if (level.map[cell] === T.CUSTOM_DECO) data.push(0);
        else data.push(-1);
      }
    }
    return customTile('RatKingRoomDeco', RAT_KING_ROOM, x0, y0, tileW, tileH, data);
  }

  /** RatKingStatues, over the inside's columns, walls above and below included: the statues. */
  private statues(level: GenLevel): CustomTile {
    const x0 = this.left + 1;
    const y0 = this.top;
    const tileW = this.width() - 2;
    const tileH = this.height();
    const data: number[] = [];
    for (let y = 0; y < tileH; y++) {
      for (let x = 0; x < tileW; x++) data.push(level.map[x0 + x + (y0 + y) * level.width] === T.CUSTOM_DECO ? 1 : -1);
    }
    return customTile('RatKingStatues', RAT_KING_ROOM, x0, y0, tileW, tileH, data);
  }

  /** StatueOverhang, drawn above the characters: each statue's top, on the cell above it. */
  private overhang(level: GenLevel): CustomTile {
    const x0 = this.left + 1;
    const y0 = this.top;
    const tileW = this.width() - 2;
    const tileH = this.height();
    const data: number[] = [];
    for (let y = 0; y < tileH; y++) {
      for (let x = 0; x < tileW; x++) data.push(level.map[x0 + x + (y0 + y + 1) * level.width] === T.CUSTOM_DECO ? 2 : -1);
    }
    return customTile('StatueOverhang', RAT_KING_ROOM, x0, y0, tileW, tileH, data, true);
  }
}
