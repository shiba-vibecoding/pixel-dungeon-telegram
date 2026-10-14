import { createItem, type Item } from '../../../../items';
import { T } from '../../../terrain';
import { Dungeon } from '../../dungeon';
import type { GenLevel } from '../../genlevel';
import { Painter } from '../../painter';
import { DoorType } from '../../room';
import { plantSeam } from './helpers';
import { SecretRoom } from './secret';

/** Hunger.HUNGRY and Hunger.STARVING. */
const HUNGRY = 300;
const STARVING = 450;

/**
 * SecretLarderRoom: a blandfruit bush in a little pool, and food enough for 150 turns more each
 * region: pasties while a whole one fits, then chargrilled meat.
 */
export class SecretLarderRoom extends SecretRoom {
  readonly kind: string = 'SecretLarderRoom';

  override minHeight(): number {
    return 6;
  }
  override minWidth(): number {
    return 6;
  }

  paint(level: GenLevel): void {
    Painter.fill(level, this, T.WALL);
    Painter.fill(level, this, 1, T.EMPTY_SP);

    const c = this.center();
    Painter.fill(level, c.x - 1, c.y - 1, 3, 3, T.WATER);
    Painter.set(level, c, T.GRASS);

    plantSeam(level, 'blandfruitBush', level.pointToCell(c), new Set());

    let extraFood = (STARVING - HUNGRY) * (1 + Math.trunc(Dungeon.depth / 5));
    while (extraFood > 0) {
      let food: Item;
      if (extraFood >= STARVING) {
        food = createItem('food.pasty');
        extraFood -= STARVING;
      } else {
        food = createItem('food.steak');
        extraFood -= STARVING - HUNGRY;
      }
      let foodPos: number;
      do {
        foodPos = level.pointToCell(this.random());
      } while (level.map[foodPos] !== T.EMPTY_SP || level.heaps.has(foodPos));
      level.drop(food, foodPos);
    }

    this.entrance().set(DoorType.HIDDEN);
  }
}
