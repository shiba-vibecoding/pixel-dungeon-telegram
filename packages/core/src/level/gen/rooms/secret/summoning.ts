import { T } from '../../../terrain';
import type { GenLevel } from '../../genlevel';
import { Generator } from '../../generator';
import { Painter } from '../../painter';
import { DoorType } from '../../room';
import { SecretRoom } from './secret';

/**
 * SecretSummoningRoom: a floor of hidden summoning traps (3x3 to 6x6 of them) round the remains of
 * someone who came for what lies in them.
 */
export class SecretSummoningRoom extends SecretRoom {
  readonly kind: string = 'SecretSummoningRoom';

  override maxWidth(): number {
    return 8;
  }
  override maxHeight(): number {
    return 8;
  }

  paint(level: GenLevel): void {
    Painter.fill(level, this, T.WALL);
    Painter.fill(level, this, 1, T.SECRET_TRAP);

    const center = this.center();
    const item = Generator.random();
    const heap = level.drop(item, level.pointToCell(center));
    // Heap.setHauntedIfCursed: haunted by the first cursed thing in it, its curse then known.
    const cursed = heap.items.find((i) => i.cursed);
    if (cursed) {
      heap.haunted = true;
      delete cursed.curseUnknown;
    }
    heap.kind = 'skeleton';

    // TrapMechanism.revealHiddenTrapChance: 0 without the trinket (SEAM(alchemy)).
    const revealedChance = 0;
    let revealInc = 0;
    for (const p of this.getPoints()) {
      const cell = level.pointToCell(p);
      if (level.map[cell] === T.SECRET_TRAP) {
        revealInc += revealedChance;
        if (revealInc >= 1) {
          level.setTrap('summoning', cell, true);
          Painter.set(level, cell, T.TRAP);
          revealInc--;
        } else {
          level.setTrap('summoning', cell, false);
        }
      }
    }

    this.entrance().set(DoorType.HIDDEN);
  }
}
