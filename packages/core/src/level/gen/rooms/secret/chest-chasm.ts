import { createItem, type Item } from '../../../../items';
import { T } from '../../../terrain';
import { Dungeon } from '../../dungeon';
import type { GenLevel } from '../../genlevel';
import { Generator } from '../../generator';
import { Painter } from '../../painter';
import { Point } from '../../rect';
import { DoorType } from '../../room';
import { SecretRoom } from './secret';

const goldenKey = (): Item => ({ ...createItem('key.golden'), depth: Dungeon.depth });

/**
 * SecretChestChasmRoom: a chasm with four locked chests on islands and their four golden keys on
 * islands in the corners; its size makes it take two potions of levitation, and one is put on the floor.
 */
export class SecretChestChasmRoom extends SecretRoom {
  readonly kind: string = 'SecretChestChasmRoom';

  override minWidth(): number {
    return 8;
  }
  override maxWidth(): number {
    return 9;
  }
  override minHeight(): number {
    return 8;
  }
  override maxHeight(): number {
    return 9;
  }

  paint(level: GenLevel): void {
    Painter.fill(level, this, T.WALL);
    Painter.fill(level, this, 1, T.CHASM);

    let chests = 0;

    const chest = (p: Point): void => {
      Painter.set(level, p, T.EMPTY_SP);
      level.drop(Generator.randomUsingDefaults(), level.pointToCell(p)).kind = 'lockedChest';
      if (level.heaps.has(level.pointToCell(p))) chests++;
    };
    const key = (p: Point): void => {
      Painter.set(level, p, T.EMPTY_SP);
      if (chests > 0) {
        level.drop(goldenKey(), level.pointToCell(p));
        chests--;
      }
    };

    let p = new Point(this.left + 3, this.top + 3);
    chest(p);
    p.x = this.right - 3;
    chest(p);
    p.y = this.bottom - 3;
    chest(p);
    p.x = this.left + 3;
    chest(p);

    p = new Point(this.left + 1, this.top + 1);
    key(p);
    p.x = this.right - 1;
    key(p);
    p.y = this.bottom - 1;
    key(p);
    p.x = this.left + 1;
    key(p);

    level.addItemToSpawn(createItem('potion.levitation'));

    this.entrance().set(DoorType.HIDDEN);
  }
}
