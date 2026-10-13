import { createItem } from '../../../../items';
import { T } from '../../../terrain';
import type { TrapKind } from '../../../trapdefs';
import { Dungeon } from '../../dungeon';
import type { GenLevel } from '../../genlevel';
import { javaRound, Painter } from '../../painter';
import { Random } from '../../random';
import type { Point } from '../../rect';
import { DoorType } from '../../room';
import { SecretRoom } from './secret';

/**
 * SecretHoardRoom: gold, about eight piles' worth spread over half the floor, and visible traps of
 * one kind on about half of the rest: rockfall, or else disintegration from floor 10 and poison
 * darts before.
 */
export class SecretHoardRoom extends SecretRoom {
  readonly kind: string = 'SecretHoardRoom';

  paint(level: GenLevel): void {
    Painter.fill(level, this, T.WALL);
    Painter.fill(level, this, 1, T.EMPTY);

    let trapClass: TrapKind;
    if (Random.Int(2) === 0) trapClass = 'rockfall';
    else if (Dungeon.depth >= 10) trapClass = 'disintegration';
    else trapClass = 'poisonDart';

    // Half of the inside of the room.
    const totalGold = Math.trunc(((this.width() - 2) * (this.height() - 2)) / 2);
    // However many piles, about eight piles' worth.
    const goldRatio = Math.fround(8 / totalGold);
    for (let i = 0; i < totalGold; i++) {
      let goldPos: number;
      do {
        goldPos = level.pointToCell(this.random());
      } while (level.heaps.has(goldPos));
      // new Gold().random(), the pile scaled down.
      const quantity = Random.IntRange(30 + Dungeon.depth * 10, 60 + Dungeon.depth * 20);
      level.drop(createItem('gold', javaRound(Math.fround(quantity * goldRatio))), goldPos);
    }

    for (const p of this.getPoints()) {
      if (Random.Int(2) === 0 && level.map[level.pointToCell(p)] === T.EMPTY) {
        level.setTrap(trapClass, level.pointToCell(p), true);
        Painter.set(level, p, T.TRAP);
      }
    }

    this.entrance().set(DoorType.HIDDEN);
  }

  override canPlaceTrap(_p: Point): boolean {
    return false;
  }
}
