import { T } from '../../../terrain';
import { Carpet, customTile, mapSimpleImage } from '../../custom';
import { Dungeon } from '../../dungeon';
import type { GenLevel } from '../../genlevel';
import { Painter } from '../../painter';
import { Random } from '../../random';
import { Point } from '../../rect';
import { DoorType } from '../../room';
import { SpecialRoom } from '../special/special';
import { wallBanners } from './vault-rooms';

/*
 * levels/rooms/quest/AmbitiousImpRoom: the imp's room on his city level (9x9), with green flames on four
 * pillars, carpets and banners, and in the middle the sealed pit into the dwarven vault (the branch's
 * way down, which the imp's spell opens); the imp stands just past it, facing the door.
 */
export class AmbitiousImpRoom extends SpecialRoom {
  readonly kind: string = 'AmbitiousImpRoom';

  override maxWidth(): number {
    return 9;
  }
  override minWidth(): number {
    return 9;
  }
  override maxHeight(): number {
    return 9;
  }
  override minHeight(): number {
    return 9;
  }

  paint(level: GenLevel): void {
    Painter.fill(level, this, T.WALL_DECO);
    Painter.fill(level, this, 1, T.EMPTY);
    const c = this.center();
    Painter.set(level, c.x - 2, c.y - 2, T.REGION_DECO);
    Painter.set(level, c.x + 2, c.y - 2, T.REGION_DECO);
    Painter.set(level, c.x - 2, c.y + 2, T.REGION_DECO);
    Painter.set(level, c.x + 2, c.y + 2, T.REGION_DECO);
    Painter.set(level, c.x - 3, c.y - 3, T.WALL_DECO);
    Painter.set(level, c.x + 3, c.y - 3, T.WALL_DECO);
    Painter.set(level, c.x - 3, c.y + 3, T.WALL_DECO);
    Painter.set(level, c.x + 3, c.y + 3, T.WALL_DECO);

    const entrance = this.entrance();
    let pos = level.pointToCell(c);
    if (entrance.x === this.left || entrance.x === this.right) {
      pos += Random.IntRange(-1, 1) * level.width;
      pos += entrance.x === this.left ? -2 : 2;
    } else if (entrance.y === this.top || entrance.y === this.bottom) {
      pos += Random.IntRange(-1, 1);
      pos += level.width * (entrance.y === this.top ? -2 : 2);
    }
    level.mobs.push({ kind: 'imp', pos, state: 'passive' });

    Painter.drawInside(level, this, entrance, 1, T.EMPTY);
    entrance.set(DoorType.REGULAR);

    Painter.fill(level, this.left + 1, this.top + 3, 7, 3, T.CUSTOM_DECO_EMPTY);
    Painter.fill(level, this.left + 3, this.top + 1, 3, 7, T.CUSTOM_DECO_EMPTY);
    level.customTiles.push(new Carpet().setRect(this.left + 1, this.top + 3, 7, 3).toCustomTile());
    level.customTiles.push(new Carpet().setRect(this.left + 3, this.top + 1, 3, 7).toCustomTile());
    // QuestEntrance: the sealed pit; EntranceBarrier: the barrier over it, glowing (the client pulses it).
    level.customTiles.push(customTile('QuestEntrance', 'city_quest', c.x - 2, c.y - 2, 5, 5, mapSimpleImage(0, 0, 256, 5, 5)));
    level.customTiles.push(customTile('EntranceBarrier', 'city_quest', c.x - 1, c.y - 1, 3, 3, mapSimpleImage(5, 1, 256, 3, 3)));
    level.customTiles.push(wallBanners(this.left + 1, this.top));

    const entrancePos = level.pointToCell(c);
    level.addTransition(entrancePos, 'branchExit', { depth: Dungeon.depth, branch: Dungeon.branch + 1, type: 'branchEntrance' });
    Painter.set(level, entrancePos, T.EXIT);
  }

  override canPlaceCharacter(): boolean {
    return false;
  }
  override canPlaceItem(): boolean {
    return false;
  }
  override canPlaceTrap(): boolean {
    return false;
  }
  override canPlaceGrass(p: Point): boolean {
    return Point.distance(p, this.center()) >= 5;
  }
  override canPlaceWater(p: Point): boolean {
    return Point.distance(p, this.center()) >= 5;
  }
}
