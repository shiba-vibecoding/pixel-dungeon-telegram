import { createItem } from '../../../../items';
import { T } from '../../../terrain';
import type { GenLevel } from '../../genlevel';
import { Generator } from '../../generator';
import { Painter } from '../../painter';
import { DoorType } from '../../room';
import { SecretRoom } from './secret';

/** SecretArtilleryRoom: a statue in the middle, two bombs (Bomb.DoubleBomb) and two sets of thrown weapons. */
export class SecretArtilleryRoom extends SecretRoom {
  readonly kind: string = 'SecretArtilleryRoom';

  paint(level: GenLevel): void {
    Painter.fill(level, this, T.WALL);
    Painter.fill(level, this, 1, T.EMPTY_SP);

    Painter.set(level, this.center(), T.STATUE_SP);

    for (let i = 0; i < 3; i++) {
      let itemPos: number;
      do {
        itemPos = level.pointToCell(this.random());
      } while (level.map[itemPos] !== T.EMPTY_SP || level.heaps.has(itemPos));

      if (i === 0) level.drop(createItem('bomb', 2), itemPos);
      // Generator.randomMissile(true): without the decks (SEAM(gear)).
      else level.drop(Generator.randomMissile(), itemPos);
    }

    this.entrance().set(DoorType.HIDDEN);
  }
}
