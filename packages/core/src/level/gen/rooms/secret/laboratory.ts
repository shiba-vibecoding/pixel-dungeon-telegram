import { createItem, type Item, type ItemKind } from '../../../../items';
import { T } from '../../../terrain';
import type { GenLevel } from '../../genlevel';
import { Painter } from '../../painter';
import { Random } from '../../random';
import { DoorType } from '../../room';
import { seamItem } from '../../seams';
import { CONSUMABLE_EXOTIC_CHANCE } from './helpers';
import { SecretRoom } from './secret';

/** The potions of the secret laboratory and their chances (Shattered's HashMap, in its declared order). */
const POTION_CHANCES: ReadonlyArray<readonly [string, number]> = [
  ['potion.healing', 1], ['potion.mindVision', 2], ['potion.frost', 3], ['potion.liquidFlame', 3], ['potion.toxicGas', 3],
  ['potionOfHaste', 4], ['potion.invisibility', 4], ['potion.levitation', 4], ['potion.paralyticGas', 4],
  ['potion.purity', 4], ['potion.experience', 6],
];

const makePotion = (kind: string): Item | null => (kind === 'potionOfHaste' ? seamItem('potionOfHaste') : createItem(kind as ItemKind));

/**
 * SecretLaboratoryRoom: an alchemy pot, two handfuls of energy crystals and two or three different
 * potions (each now and then exotic, with the exotic crystals trinket).
 */
export class SecretLaboratoryRoom extends SecretRoom {
  readonly kind: string = 'SecretLaboratoryRoom';

  paint(level: GenLevel): void {
    Painter.fill(level, this, T.WALL);
    Painter.fill(level, this, 1, T.EMPTY_SP);

    this.entrance().set(DoorType.HIDDEN);

    const pot = this.center();
    Painter.set(level, pot, T.ALCHEMY);
    level.seedBlob(pot.x + level.width * pot.y, 1, 'Alchemy');

    // Cells holding what Pixel Dungeon has no item for yet (the energy crystals), as if they lay there.
    const taken = new Set<number>();
    const freeCell = (): number => {
      let pos: number;
      do {
        pos = level.pointToCell(this.random());
      } while (level.map[pos] !== T.EMPTY_SP || level.heaps.has(pos) || taken.has(pos));
      return pos;
    };

    for (let i = 0; i < 2; i++) {
      const pos = freeCell();
      const crystals = seamItem('energyCrystal');
      const quantity = Random.IntRange(3, 5);
      if (crystals) crystals.qty = quantity;
      level.drop(crystals, pos);
      taken.add(pos);
    }

    const n = Random.IntRange(2, 3);
    const chances = new Map<string, number>(POTION_CHANCES);
    for (let i = 0; i < n; i++) {
      const pos = freeCell();
      const potion = Random.chancesOf(chances)!;
      chances.set(potion, 0);
      // Every one of these has an exotic form (ExoticPotion.regToExo), so the roll is always made;
      // it is never won without the trinket (SEAM(alchemy): exotic potions).
      void (Random.Float() < CONSUMABLE_EXOTIC_CHANCE);
      level.drop(makePotion(potion), pos);
      taken.add(pos);
    }
  }
}
