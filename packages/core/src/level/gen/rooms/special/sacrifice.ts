import type { Item } from '../../../../items';
import { T } from '../../../terrain';
import { Dungeon } from '../../dungeon';
import type { BlobSpawn, GenLevel } from '../../genlevel';
import { Painter } from '../../painter';
import { Random } from '../../random';
import { DoorType } from '../../room';
import { drawWeaponCurse, knowCurse, randomGold, randomWeaponOfSet, upgrade } from './prizes';
import { SpecialRoom } from './special';

/** The sacrificial fire as SacrificeRoom seeds it: SacrificialFire.setPrize, the reward once it is fed enough. */
export interface SacrificialFireSpawn extends BlobSpawn {
  prize?: Item;
}

/**
 * SacrificeRoom: an altar with a sacrificial fire on a pedestal amid embers, on an island in a
 * chasm reached by a path of special floor, four statues round it for cover. Monsters killed by the
 * fire feed it; fed enough (6 + 4 per depth), it gives up its prize, a cursed weapon of the next set
 * of floors (upgraded if not cursed already).
 */
export class SacrificeRoom extends SpecialRoom {
  readonly kind: string = 'SacrificeRoom';

  override minWidth(): number {
    return 7;
  }
  override minHeight(): number {
    return 7;
  }

  paint(level: GenLevel): void {
    Painter.fill(level, this, T.WALL);
    Painter.fill(level, this, 1, T.CHASM);

    const c = this.center();
    const door = this.entrance();
    if (door.x === this.left || door.x === this.right) {
      if (door.y === c.y) c.y += Random.Int(2) === 0 ? -1 : +1;
      const p = Painter.drawInside(level, this, door, Math.abs(door.x - c.x) - 2, T.EMPTY_SP);
      for (; p.y !== c.y; p.y += p.y < c.y ? +1 : -1) Painter.set(level, p, T.EMPTY_SP);
    } else {
      if (door.x === c.x) c.x += Random.Int(2) === 0 ? -1 : +1;
      const p = Painter.drawInside(level, this, door, Math.abs(door.y - c.y) - 2, T.EMPTY_SP);
      for (; p.x !== c.x; p.x += p.x < c.x ? +1 : -1) Painter.set(level, p, T.EMPTY_SP);
    }

    // Four statues, for some cover from ranged enemies.
    const statue = c.clone();
    statue.x -= 2;
    if (statue.x > this.left) Painter.set(level, statue, T.STATUE);
    statue.x += 2;
    statue.y -= 2;
    if (statue.y > this.top) Painter.set(level, statue, T.STATUE);
    statue.y += 2;
    statue.x += 2;
    if (statue.x < this.right) Painter.set(level, statue, T.STATUE);
    statue.x -= 2;
    statue.y += 2;
    if (statue.y < this.bottom) Painter.set(level, statue, T.STATUE);

    Painter.fill(level, c.x - 1, c.y - 1, 3, 3, T.EMBERS);
    Painter.set(level, c, T.PEDESTAL);

    const cell = level.pointToCell(c);
    level.seedBlob(cell, 6 + Dungeon.depth * 4, 'SacrificialFire');
    const fire: SacrificialFireSpawn = level.blobs.find((b) => b.kind === 'SacrificialFire' && b.cell === cell)!;
    fire.prize = SacrificeRoom.prize();

    door.set(DoorType.EMPTY);
  }

  static prize(): Item {
    // One set of floors higher than usual.
    const prize = randomWeaponOfSet(Math.trunc(Dungeon.depth / 5) + 1);
    if (Dungeon.itemBlocked(prize)) return randomGold();
    // The curse is always drawn, so the parchment scrap does not shift the level.
    drawWeaponCurse();
    // A weapon not cursed already gets a free upgrade, and the curse unless it is enchanted.
    if (!prize.cursed) upgrade(prize);
    prize.cursed = true;
    knowCurse(prize);
    return prize;
  }
}
