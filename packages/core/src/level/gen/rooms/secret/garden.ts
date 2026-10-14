import { T } from '../../../terrain';
import type { GenLevel } from '../../genlevel';
import { Painter } from '../../painter';
import { generatePatch } from '../../patch';
import { Random } from '../../random';
import { DoorType } from '../../room';
import { plantSeam } from './helpers';
import { SecretRoom } from './secret';

/**
 * SecretGardenRoom: grass, half of it tall, a starflower, a seed pod, a dewcatcher and one more of
 * either, all in the light of foliage.
 */
export class SecretGardenRoom extends SecretRoom {
  readonly kind: string = 'SecretGardenRoom';

  paint(level: GenLevel): void {
    Painter.fill(level, this, T.WALL);
    Painter.fill(level, this, 1, T.GRASS);

    const grass = generatePatch(this.width() - 2, this.height() - 2, 0.5, 0, true);
    for (let i = this.top + 1; i < this.bottom; i++) {
      for (let j = this.left + 1; j < this.right; j++) {
        if (grass[this.xyToPatchCoords(j, i)]) level.map[i * level.width + j] = T.HIGH_GRASS;
      }
    }

    this.entrance().set(DoorType.HIDDEN);

    const planted = new Set<number>();
    plantSeam(level, 'starflower', this.plantPos(level, planted), planted);
    plantSeam(level, 'seedpod', this.plantPos(level, planted), planted);
    plantSeam(level, 'dewcatcher', this.plantPos(level, planted), planted);
    if (Random.Int(2) === 0) plantSeam(level, 'seedpod', this.plantPos(level, planted), planted);
    else plantSeam(level, 'dewcatcher', this.plantPos(level, planted), planted);

    for (let i = this.top + 1; i < this.bottom; i++) {
      for (let j = this.left + 1; j < this.right; j++) level.seedBlob(j + level.width * i, 1, 'Foliage');
    }
  }

  private plantPos(level: GenLevel, planted: Set<number>): number {
    let pos: number;
    do {
      pos = level.pointToCell(this.random());
    } while (level.plants.has(pos) || planted.has(pos));
    return pos;
  }

  protected xyToPatchCoords(x: number, y: number): number {
    return x - this.left - 1 + (y - this.top - 1) * (this.width() - 2);
  }
}
