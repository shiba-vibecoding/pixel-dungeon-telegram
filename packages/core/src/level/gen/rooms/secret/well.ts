import { T } from '../../../terrain';
import type { GenLevel } from '../../genlevel';
import { Painter } from '../../painter';
import { Random } from '../../random';
import { Point } from '../../rect';
import { DoorType } from '../../room';
import { SecretRoom } from './secret';

/** The waters a secret well may hold (WellWater blobs, by Shattered's class names). */
const WATERS = ['WaterOfAwareness', 'WaterOfHealth'];

/** SecretWellRoom: a path from the door to a well of awareness or of health, in a pit. */
export class SecretWellRoom extends SecretRoom {
  readonly kind: string = 'SecretWellRoom';

  /** Refuses doors next to corners. */
  override canConnectPoint(p: Point): boolean {
    return super.canConnectPoint(p) && ((p.x > this.left + 1 && p.x < this.right - 1) || (p.y > this.top + 1 && p.y < this.bottom - 1));
  }

  paint(level: GenLevel): void {
    Painter.fill(level, this, T.WALL);
    const door = this.entrance();
    let well: Point;
    if (door.x === this.left) well = new Point(this.right - 2, door.y);
    else if (door.x === this.right) well = new Point(this.left + 2, door.y);
    else if (door.y === this.top) well = new Point(door.x, this.bottom - 2);
    else well = new Point(door.x, this.top + 2);

    Painter.fill(level, well.x - 1, well.y - 1, 3, 3, T.CHASM);
    Painter.drawLine(level, door, well, T.EMPTY);

    Painter.set(level, well, T.WELL);

    const water = Random.element(WATERS)!;
    level.seedBlob(well.x + level.width * well.y, 1, water);

    this.entrance().set(DoorType.HIDDEN);
  }
}
