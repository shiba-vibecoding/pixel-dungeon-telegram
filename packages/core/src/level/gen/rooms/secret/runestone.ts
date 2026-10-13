import { createItem } from '../../../../items';
import { T } from '../../../terrain';
import type { GenLevel } from '../../genlevel';
import { Generator } from '../../generator';
import { Painter } from '../../painter';
import { Point } from '../../rect';
import { DoorType } from '../../room';
import { seamItem } from '../../seams';
import { SecretRoom } from './secret';

/**
 * SecretRunestoneRoom: a wall of bookshelves across the room, two runestones on the near side and a
 * stone of enchantment behind the shelves; a potion of liquid flame lies elsewhere on the floor to
 * burn a way through.
 */
export class SecretRunestoneRoom extends SecretRoom {
  readonly kind: string = 'SecretRunestoneRoom';

  paint(level: GenLevel): void {
    Painter.fill(level, this, T.WALL);
    Painter.fill(level, this, 1, T.EMPTY);

    const entrance = this.entrance();
    const center = this.center();

    if (entrance.x === this.left || entrance.x === this.right) {
      Painter.drawLine(level, new Point(center.x, this.top + 1), new Point(center.x, this.bottom - 1), T.BOOKSHELF);
      if (entrance.x === this.left) {
        Painter.fill(level, center.x + 1, this.top + 1, this.right - center.x - 1, this.height() - 2, T.EMPTY_SP);
      } else {
        Painter.fill(level, this.left + 1, this.top + 1, center.x - this.left - 1, this.height() - 2, T.EMPTY_SP);
      }
    } else {
      Painter.drawLine(level, new Point(this.left + 1, center.y), new Point(this.right - 1, center.y), T.BOOKSHELF);
      if (entrance.y === this.top) {
        Painter.fill(level, this.left + 1, center.y + 1, this.width() - 2, this.bottom - center.y - 1, T.EMPTY_SP);
      } else {
        Painter.fill(level, this.left + 1, this.top + 1, this.width() - 2, center.y - this.top - 1, T.EMPTY_SP);
      }
    }

    level.addItemToSpawn(createItem('potion.liquidFlame'));

    let dropPos: number;
    do {
      dropPos = level.pointToCell(this.random());
    } while (level.map[dropPos] !== T.EMPTY);
    level.drop(Generator.randomUsingDefaults('STONE'), dropPos);

    do {
      dropPos = level.pointToCell(this.random());
    } while (level.map[dropPos] !== T.EMPTY || level.heaps.has(dropPos));
    level.drop(Generator.randomUsingDefaults('STONE'), dropPos);

    do {
      dropPos = level.pointToCell(this.random());
    } while (level.map[dropPos] !== T.EMPTY_SP);
    level.drop(seamItem('stoneOfEnchantment'), dropPos);

    entrance.set(DoorType.HIDDEN);
  }

  override canPlaceWater(_p: Point): boolean {
    return false;
  }

  override canPlaceGrass(_p: Point): boolean {
    return false;
  }

  override canPlaceCharacter(p: Point, l: GenLevel): boolean {
    return super.canPlaceCharacter(p, l) && l.map[l.pointToCell(p)] !== T.EMPTY_SP;
  }
}
