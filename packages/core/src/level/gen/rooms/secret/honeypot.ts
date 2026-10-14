import { createItem, type Item } from '../../../../items';
import { T } from '../../../terrain';
import { Dungeon } from '../../dungeon';
import type { GenLevel } from '../../genlevel';
import { Painter } from '../../painter';
import { Random } from '../../random';
import { DoorType } from '../../room';
import { seamItem } from '../../seams';
import { SecretRoom } from './secret';

/**
 * SecretHoneypotRoom: a shattered honeypot between the door and the middle, its angry golden bee
 * guarding it, and a whole honeypot and a bomb (or two) somewhere in the room.
 */
export class SecretHoneypotRoom extends SecretRoom {
  readonly kind: string = 'SecretHoneypotRoom';

  /** The broken pot's cell (a heap in Shattered, while Pixel Dungeon has no such item: SEAM(mobs)). */
  private potCell = -1;

  paint(level: GenLevel): void {
    Painter.fill(level, this, T.WALL);
    Painter.fill(level, this, 1, T.EMPTY);

    const brokenPotPos = this.center();
    brokenPotPos.x = Math.trunc((brokenPotPos.x + this.entrance().x) / 2);
    brokenPotPos.y = Math.trunc((brokenPotPos.y + this.entrance().y) / 2);

    const potCell = level.pointToCell(brokenPotPos);
    level.drop(seamItem('shatteredPot'), potCell);
    this.potCell = potCell;

    // Bee.spawn(depth), at full health, guarding the pot no one holds (Bee.setPotInfo(pot, null)).
    level.mobs.push({ kind: 'bee', pos: potCell, level: Dungeon.depth, state: 'wandering', beeHome: potCell });

    this.placeItem(createItem('honeypot'), level);

    // new Bomb().random(): one in four is two bombs.
    this.placeItem(Random.Int(4) === 0 ? createItem('bomb', 2) : createItem('bomb'), level);

    this.entrance().set(DoorType.HIDDEN);
  }

  private placeItem(item: Item, level: GenLevel): void {
    let itemPos: number;
    do {
      itemPos = level.pointToCell(this.random());
    } while (level.heaps.has(itemPos) || itemPos === this.potCell);
    level.drop(item, itemPos);
  }
}
