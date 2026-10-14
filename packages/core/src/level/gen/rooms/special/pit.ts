import type { Heap, Item } from '../../../../items';
import { T } from '../../../terrain';
import { Dungeon } from '../../dungeon';
import { customTile } from '../../custom';
import { type GenCategory, Generator } from '../../generator';
import type { GenLevel } from '../../genlevel';
import { Painter } from '../../painter';
import { Random } from '../../random';
import { Point } from '../../rect';
import { DoorType } from '../../room';
import { crystalKey } from './prizes';
import { SpecialRoom } from './special';
import { cornerOpposite } from './vaults';

/*
 * WeakFloorRoom and PitRoom: a room of crumbling ledges over a chasm, with a well glimpsed far below;
 * the floor below it then has the pit room, where whoever falls lands by the remains of an adventurer.
 */

/**
 * WeakFloorRoom: ledges of special floor jutting from the door's wall over a chasm, a distant well
 * seen below by the far wall (WeakFloorRoom.HiddenWell, and the WellID blob that keeps track of
 * having seen it). The next floor gets the pit room (SpecialRoom.createRoom).
 */
export class WeakFloorRoom extends SpecialRoom {
  readonly kind: string = 'WeakFloorRoom';

  paint(level: GenLevel): void {
    Painter.fill(level, this, T.WALL);
    Painter.fill(level, this, 1, T.CHASM);

    const door = this.entrance();
    door.set(DoorType.REGULAR);

    let well: Point;
    if (door.x === this.left) {
      for (let i = this.top + 1; i < this.bottom; i++) {
        Painter.drawInside(level, this, new Point(this.left, i), Random.IntRange(1, this.width() - 4), T.EMPTY_SP);
      }
      well = new Point(this.right - 1, Random.Int(2) === 0 ? this.top + 2 : this.bottom - 1);
    } else if (door.x === this.right) {
      for (let i = this.top + 1; i < this.bottom; i++) {
        Painter.drawInside(level, this, new Point(this.right, i), Random.IntRange(1, this.width() - 4), T.EMPTY_SP);
      }
      well = new Point(this.left + 1, Random.Int(2) === 0 ? this.top + 2 : this.bottom - 1);
    } else if (door.y === this.top) {
      for (let i = this.left + 1; i < this.right; i++) {
        Painter.drawInside(level, this, new Point(i, this.top), Random.IntRange(1, this.height() - 4), T.EMPTY_SP);
      }
      well = new Point(Random.Int(2) === 0 ? this.left + 1 : this.right - 1, this.bottom - 1);
    } else {
      for (let i = this.left + 1; i < this.right; i++) {
        Painter.drawInside(level, this, new Point(i, this.bottom), Random.IntRange(1, this.height() - 4), T.EMPTY_SP);
      }
      well = new Point(Random.Int(2) === 0 ? this.left + 1 : this.right - 1, this.top + 2);
    }

    Painter.set(level, well, T.CHASM);
    // HiddenWell: one tile of weak_floor.png, the region's (Dungeon.depth / 5).
    level.customTiles.push(customTile('WeakFloorRoom.HiddenWell', 'weak_floor', well.x, well.y, 1, 1, [Math.trunc(Dungeon.depth / 5)]));
    level.seedBlob(well.x + level.width * well.y, 1, 'WellID');
  }
}

/** Heap.setHauntedIfCursed: remains with something cursed in them are haunted. */
function hauntIfCursed(heap: Heap): Heap {
  if (heap.items.some((item) => item.cursed)) heap.haunted = true;
  return heap;
}

/**
 * PitRoom: where one lands from the weak floor above, behind a crystal door: an empty well in a far
 * corner and an adventurer's remains in the middle, with a ring, artifact or piece of gear, one or
 * two consumables and the crystal key to the door.
 */
export class PitRoom extends SpecialRoom {
  readonly kind: string = 'PitRoom';

  // A little bigger at least, against tiny fights with the wraith; smaller at most, so the well shows.
  override minWidth(): number {
    return 6;
  }
  override minHeight(): number {
    return 6;
  }
  override maxWidth(): number {
    return 9;
  }
  override maxHeight(): number {
    return 9;
  }

  paint(level: GenLevel): void {
    Painter.fill(level, this, T.WALL);
    Painter.fill(level, this, 1, T.EMPTY);

    const entrance = this.entrance();
    entrance.set(DoorType.CRYSTAL);

    Painter.set(level, cornerOpposite(this), T.EMPTY_WELL);

    const remains = level.pointToCell(this.center());

    let mainLoot: Item | null = null;
    do {
      switch (Random.Int(3)) {
        case 0:
          mainLoot = Generator.random('RING');
          break;
        case 1:
          mainLoot = Generator.random('ARTIFACT');
          break;
        case 2:
          mainLoot = Generator.random(Random.oneOf<GenCategory>('WEAPON', 'WEAPON', 'MISSILE', 'ARMOR', 'ARMOR'));
          break;
      }
    } while (!mainLoot || Dungeon.itemBlocked(mainLoot));
    hauntIfCursed(level.drop(mainLoot, remains)).kind = 'skeleton';

    const n = Random.IntRange(1, 2);
    for (let i = 0; i < n; i++) {
      hauntIfCursed(level.drop(Generator.random(Random.oneOf<GenCategory>('POTION', 'SCROLL', 'FOOD', 'GOLD')), remains));
    }

    level.drop(crystalKey(), remains);
  }

  /** The hero lands weak and likely has a wraith to fight: no traps. */
  override canPlaceTrap(_p: Point): boolean {
    return false;
  }

  /** So the well can be seen through the door. */
  override canPlaceGrass(_p: Point): boolean {
    return false;
  }
}
