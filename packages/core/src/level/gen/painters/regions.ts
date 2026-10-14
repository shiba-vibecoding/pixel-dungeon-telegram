import { F, terrainFlags, T } from '../../terrain';
import { floorTile, wallStitcheable } from '../../tilesheet';
import { Dungeon } from '../dungeon';
import type { GenLevel } from '../genlevel';
import { Random } from '../random';
import type { Room } from '../room';
import { isSpecial } from '../rooms/special/special';
import { isStandard } from '../rooms/standard/standard';
import { RegularPainter } from './regular';

/* levels/painters/SewerPainter, PrisonPainter, CavesPainter, CityPainter and HallsPainter: each region's decorations. */

/** SewerPainter: drains over water, moss in the corners. */
export class SewerPainter extends RegularPainter {
  protected decorate(level: GenLevel, _rooms: Room[]): void {
    const map = level.map;
    const w = level.width;
    const l = level.length;
    for (let i = 0; i < w; i++) {
      if (map[i] === T.WALL && map[i + w] === T.WATER && Random.Int(4) === 0) map[i] = T.WALL_DECO;
    }
    for (let i = w; i < l - w; i++) {
      if (map[i] === T.WALL && map[i - w] === T.WALL && map[i + w] === T.WATER && Random.Int(2) === 0) map[i] = T.WALL_DECO;
    }
    for (let i = w + 1; i < l - w - 1; i++) {
      if (map[i] === T.EMPTY) {
        const count = (map[i + 1] === T.WALL ? 1 : 0) + (map[i - 1] === T.WALL ? 1 : 0) + (map[i + w] === T.WALL ? 1 : 0) + (map[i - w] === T.WALL ? 1 : 0);
        if (Random.Int(16) < count * count) map[i] = T.EMPTY_DECO;
      }
    }
  }
}

/** PrisonPainter: blood in the corners, chains hanging over chasms, torches on the walls. */
export class PrisonPainter extends RegularPainter {
  protected decorate(level: GenLevel, rooms: Room[]): void {
    const w = level.width;
    const l = level.length;
    const map = level.map;
    for (let i = w + 1; i < l - w - 1; i++) {
      if (map[i] === T.EMPTY) {
        let c = Math.fround(0.05);
        if (map[i + 1] === T.WALL && map[i + w] === T.WALL) c = Math.fround(c + 0.2);
        if (map[i - 1] === T.WALL && map[i + w] === T.WALL) c = Math.fround(c + 0.2);
        if (map[i + 1] === T.WALL && map[i - w] === T.WALL) c = Math.fround(c + 0.2);
        if (map[i - 1] === T.WALL && map[i - w] === T.WALL) c = Math.fround(c + 0.2);
        if (Random.Float() < c) map[i] = T.EMPTY_DECO;
      }
    }
    for (const r of rooms) {
      if (isSpecial(r)) continue;
      // 1 in 15 by default; fissures and chasm bridges more.
      const chance = r.kind === 'FissureRoom' ? 3 : r.kind.startsWith('ChasmBridge') ? 5 : 15;
      for (let y = r.bottom - 1; y > r.top; y--) {
        let cell = r.left + 1 + level.width * y;
        for (let x = r.left + 1; x < r.right; x++) {
          if (level.map[cell] === T.CHASM && level.map[cell - level.width] === T.CHASM && Random.Int(chance) === 0) {
            level.map[cell] = T.REGION_DECO_ALT;
          }
          cell++;
        }
      }
    }
    for (let i = 0; i < w; i++) {
      if (map[i] === T.WALL && (map[i + w] === T.EMPTY || map[i + w] === T.EMPTY_SP) && Random.Int(6) === 0) map[i] = T.WALL_DECO;
    }
    for (let i = w; i < l - w; i++) {
      if (map[i] === T.WALL && map[i - w] === T.WALL && (map[i + w] === T.EMPTY || map[i + w] === T.EMPTY_SP) && Random.Int(3) === 0) {
        map[i] = T.WALL_DECO;
      }
    }
  }
}

/** CavesPainter: neighbours split by chasms or rocks, rounded corners, rubble, ore in the walls. */
export class CavesPainter extends RegularPainter {
  protected decorate(level: GenLevel, rooms: Room[]): void {
    const w = level.width;
    const l = level.length;
    const map = level.map;
    for (const r of rooms) {
      for (const n of r.neigbours) {
        if (!r.connected.has(n)) this.mergeRooms(level, r, n, null, Random.Int(3) === 0 ? T.REGION_DECO : T.CHASM);
      }
    }
    for (const room of rooms) {
      if (!isStandard(room) || room.kind === 'BlacksmithRoom') continue;
      if (room.width() <= 4 || room.height() <= 4) continue;
      const s = room.square();
      const doorAt = (cell: number): boolean => {
        const p = level.cellToPoint(cell);
        return room.doors().some((d) => d.x === p.x && d.y === p.y);
      };
      const solid = (cell: number): boolean => (terrainFlags[map[cell]!]! & F.SOLID) !== 0;
      // Each corner may be filled in, the more likely the bigger the room, but never over something
      // solid, a doorway, or by a visible trap next to the wall.
      const corners: Array<[number, number, number, number, number]> = [
        [room.left + 1 + (room.top + 1) * w, -1, -w, +1, +w],
        [room.right - 1 + (room.top + 1) * w, +1, -w, -1, +w],
        [room.left + 1 + (room.bottom - 1) * w, -1, +w, +1, -w],
        [room.right - 1 + (room.bottom - 1) * w, +1, +w, -1, -w],
      ];
      for (const [corner, side, vert, opSide, opVert] of corners) {
        if (Random.Int(s) > 8) {
          if (!solid(corner) && map[corner + side] === T.WALL && !doorAt(corner + side) && map[corner + vert] === T.WALL && !doorAt(corner + vert) &&
            map[corner + opSide] !== T.TRAP && map[corner + opVert] !== T.TRAP) {
            map[corner] = T.WALL;
            level.traps.delete(corner);
          }
        }
      }
    }
    for (let i = w + 1; i < l - w; i++) {
      if (map[i] === T.EMPTY) {
        let n = 0;
        if (map[i + 1] === T.WALL) n++;
        if (map[i - 1] === T.WALL) n++;
        if (map[i + w] === T.WALL) n++;
        if (map[i - w] === T.WALL) n++;
        if (Random.Int(6) <= n) map[i] = T.EMPTY_DECO;
      }
    }
    this.generateGold(level, rooms);
  }

  /** Veins of ore in walls over a floor. */
  protected generateGold(level: GenLevel, _rooms: Room[]): void {
    const w = level.width;
    const map = level.map;
    for (let i = 0; i < level.length - w; i++) {
      if (map[i] === T.WALL && floorTile(map[i + w]!) && Random.Int(4) === 0) map[i] = T.WALL_DECO;
    }
  }
}

/** CityPainter: worn paving, and carvings on the walls, more the deeper. */
export class CityPainter extends RegularPainter {
  protected decorate(level: GenLevel, _rooms: Room[]): void {
    const map = level.map;
    const w = level.width;
    for (let i = 0; i < level.length - w; i++) {
      if (map[i] === T.EMPTY && Random.Int(10) === 0) map[i] = T.EMPTY_DECO;
      else if (map[i] === T.WALL && !wallStitcheable(map[i + w]!) && Random.Int(21 - Dungeon.depth) === 0) map[i] = T.WALL_DECO;
    }
  }
}

/** HallsPainter: cracks in open floor, glowing runes, and neighbours split by chasms or pillars. */
export class HallsPainter extends RegularPainter {
  protected decorate(level: GenLevel, rooms: Room[]): void {
    const map = level.map;
    const w = level.width;
    const l = level.length;
    for (let i = w + 1; i < l - w - 1; i++) {
      if (map[i] === T.EMPTY) {
        let count = 0;
        for (const n of level.neighbours8) if ((terrainFlags[map[i + n]!]! & F.PASSABLE) > 0) count++;
        if (Random.Int(80) < count) map[i] = T.EMPTY_DECO;
      } else if (map[i] === T.WALL && map[i - 1] !== T.WALL_DECO && map[i - w] !== T.WALL_DECO && Random.Int(20) === 0) {
        map[i] = T.WALL_DECO;
      } else if (map[i] === T.REGION_DECO && Random.Int(2) === 0) {
        map[i] = T.REGION_DECO_ALT;
      }
    }
    for (const r of rooms) {
      for (const n of r.neigbours) {
        if (!r.connected.has(n)) this.mergeRooms(level, r, n, null, Random.Int(3) === 0 ? T.REGION_DECO : T.CHASM);
      }
    }
  }
}
