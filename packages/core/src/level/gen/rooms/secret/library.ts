import { createItem, type Item, type ItemKind } from '../../../../items';
import { T } from '../../../terrain';
import type { GenLevel } from '../../genlevel';
import { Painter } from '../../painter';
import { Random } from '../../random';
import { DoorType } from '../../room';
import { seamItem } from '../../seams';
import { CONSUMABLE_EXOTIC_CHANCE } from './helpers';
import { SecretRoom } from './secret';

/**
 * The scrolls of the secret library and their chances (Shattered's HashMap, in its declared order).
 * Pixel Dungeon's scroll of challenge is Shattered's scroll of rage under its older name.
 */
const SCROLL_CHANCES: ReadonlyArray<readonly [string, number]> = [
  ['scroll.identify', 1], ['scroll.removeCurse', 2], ['scroll.mirrorImage', 3], ['scroll.recharging', 3],
  ['scroll.teleportation', 3], ['scroll.lullaby', 4], ['scroll.mapping', 4], ['scroll.challenge', 4],
  ['scrollOfRetribution', 4], ['scroll.terror', 4], ['scrollOfTransmutation', 6],
];

function makeScroll(kind: string): Item | null {
  if (kind === 'scrollOfRetribution' || kind === 'scrollOfTransmutation') return seamItem(kind);
  return createItem(kind as ItemKind);
}

/** SecretLibraryRoom: a round reading room within bookshelves, with two or three different scrolls. */
export class SecretLibraryRoom extends SecretRoom {
  readonly kind: string = 'SecretLibraryRoom';

  override minWidth(): number {
    return Math.max(7, super.minWidth());
  }
  override minHeight(): number {
    return Math.max(7, super.minHeight());
  }

  paint(level: GenLevel): void {
    Painter.fill(level, this, T.WALL);
    Painter.fill(level, this, 1, T.BOOKSHELF);

    Painter.fillEllipse(level, this, 2, T.EMPTY_SP);

    const entrance = this.entrance();
    if (entrance.x === this.left || entrance.x === this.right) {
      Painter.drawInside(level, this, entrance, Math.trunc((this.width() - 3) / 2), T.EMPTY_SP);
    } else {
      Painter.drawInside(level, this, entrance, Math.trunc((this.height() - 3) / 2), T.EMPTY_SP);
    }
    entrance.set(DoorType.HIDDEN);

    const n = Random.IntRange(2, 3);
    const chances = new Map<string, number>(SCROLL_CHANCES);
    for (let i = 0; i < n; i++) {
      let pos: number;
      do {
        pos = level.pointToCell(this.random());
      } while (level.map[pos] !== T.EMPTY_SP || level.heaps.has(pos));

      const scroll = Random.chancesOf(chances)!;
      chances.set(scroll, 0);
      // Every one of these has an exotic form (ExoticScroll.regToExo), so the roll is always made;
      // it is never won without the trinket (SEAM(alchemy): exotic scrolls).
      void (Random.Float() < CONSUMABLE_EXOTIC_CHANCE);
      level.drop(makeScroll(scroll), pos);
    }
  }
}
