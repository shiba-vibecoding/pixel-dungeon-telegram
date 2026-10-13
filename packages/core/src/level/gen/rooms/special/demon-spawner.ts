import type { MobKind } from '../../../../actors';
import { T } from '../../../terrain';
import { customTile } from '../../custom';
import type { GenLevel, MobSpawn } from '../../genlevel';
import { Painter } from '../../painter';
import type { Point } from '../../rect';
import { DoorType, type Room } from '../../room';
import { SpecialRoom } from './special';

/**
 * DemonSpawnerRoom: a demon spawner in the middle of a room floored in the halls' special tiles
 * (one in every halls floor, added by HallsLevel.initRooms); its door is never hidden.
 */
export class DemonSpawnerRoom extends SpecialRoom {
  readonly kind: string = 'DemonSpawnerRoom';

  paint(level: GenLevel): void {
    Painter.fill(level, this, T.WALL);
    Painter.fill(level, this, 1, T.EMPTY);

    const c = this.center();
    const door = this.entrance();
    // Never hidden at random.
    door.set(DoorType.UNLOCKED);

    // SEAM(mobs): DemonSpawner. Statistics.spawnersAlive counts it from the start (spawnRecorded).
    level.mobs.push({
      kind: 'demonSpawner' as MobKind, pos: c.x + c.y * level.width, state: 'passive', spawnCooldown: 0, spawnRecorded: true,
    } as MobSpawn);

    level.customTiles.push(demonSpawnerFloor(level, this.left + 1, this.top + 1, this.width() - 2, this.height() - 2));
  }

  /** Never connected to the exit room. */
  override connect(room: Room): boolean {
    if (room.isExit()) return false;
    return super.connect(room);
  }

  override canPlaceTrap(_p: Point): boolean {
    return false;
  }
  override canPlaceWater(_p: Point): boolean {
    return false;
  }
  override canPlaceGrass(_p: Point): boolean {
    return false;
  }
}

/**
 * DemonSpawnerRoom.CustomFloor over the room's inside, from halls_special.png: plain (19) or cracked
 * (27; 31 once the Amulet is taken, which the client decides) floor, and the spawner's base across
 * three tiles (37, 38, 39). Shattered maps it from the finished level, after the halls painter has
 * cracked the floor, and this room is painted before that: the data is worked out when first read
 * (once generation is done), then kept.
 */
function demonSpawnerFloor(level: GenLevel, x: number, y: number, w: number, h: number): ReturnType<typeof customTile> {
  const tile = customTile('DemonSpawnerRoom.CustomFloor', 'halls_special', x, y, w, h, []);
  Object.defineProperty(tile, 'data', {
    enumerable: true,
    configurable: true,
    get(): number[] {
      const data = new Array<number>(w * h).fill(0);
      let cell = x + y * level.width;
      for (let i = 0; i < data.length; i++) {
        if (i % w === 0) cell = x + (y + Math.trunc(i / w)) * level.width;
        if ((level.findMob(cell)?.kind as string) === 'demonSpawner') {
          data[i - 1] = 5 + 4 * 8;
          data[i] = 6 + 4 * 8;
          data[i + 1] = 7 + 4 * 8;
          i++;
          cell++;
        } else if (level.map[cell] === T.EMPTY_DECO) {
          data[i] = 27;
        } else {
          data[i] = 19;
        }
        cell++;
      }
      Object.defineProperty(tile, 'data', { value: data, enumerable: true, configurable: true, writable: true });
      return data;
    },
  });
  return tile;
}

