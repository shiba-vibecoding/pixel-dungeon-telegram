import { T } from '../../../terrain';
import { customTile } from '../../custom';
import { Dungeon } from '../../dungeon';
import { Generator } from '../../generator';
import type { GenLevel } from '../../genlevel';
import { Painter } from '../../painter';
import { Random } from '../../random';
import type { Point } from '../../rect';
import { DoorType, type Room, TOP } from '../../room';
import { StandardRoom } from '../standard/standard';

/*
 * levels/rooms/quest/BlacksmithRoom: the troll blacksmith's smithy on a caves floor. He stands by his
 * furnace, two pieces of gear lie on pedestals, and in a top corner a ladder leads down to his mine
 * (the 'branchExit' transition); its texture is caves_quest.
 */

const CAVES_QUEST = 'caves_quest';

export class BlacksmithRoom extends StandardRoom {
  readonly kind: string = 'BlacksmithRoom';

  override minWidth(): number {
    return Math.max(super.minWidth(), 8);
  }

  override minHeight(): number {
    return Math.max(super.minHeight(), 8);
  }

  paint(level: GenLevel): void {
    Painter.fill(level, this, T.WALL);
    Painter.fill(level, this, 1, T.EMPTY);
    Painter.fill(level, this, 2, T.EMPTY_SP);
    Painter.fill(level, this.left + 2, this.top + 1, this.width() - 4, 1, T.REGION_DECO_ALT);

    for (const door of this.doors()) {
      door.set(DoorType.REGULAR);
      Painter.drawInside(level, this, door, 1, T.EMPTY);
    }

    Painter.fill(level, this, 2, T.EMPTY_SP);

    const w = level.width;
    const npc = this.left + 3 + w * (this.top + 3);
    level.mobs.push({ kind: 'blacksmith', pos: npc, state: 'passive' });

    Painter.set(level, npc + 1, T.CUSTOM_DECO_WTR);
    Painter.set(level, npc + 1 - w, T.CUSTOM_DECO);
    Painter.set(level, npc - w, T.CUSTOM_DECO);
    Painter.set(level, npc - 1 - w, T.CUSTOM_DECO);

    let equipPos = this.right - 3 + (this.bottom - 3) * w;
    if (this.height() === 8) equipPos += w;
    for (let i = 0; i < 2; i++) {
      level.drop(Generator.random(Random.oneOf('ARMOR', 'WEAPON', 'MISSILE')), equipPos);
      Painter.set(level, equipPos, T.PEDESTAL);
      equipPos--;
    }

    let entranceOnLeft = Random.Int(2) === 0;
    for (const d of this.doors()) {
      if (d.y <= this.top + 2) {
        if (d.x <= this.left + 1) entranceOnLeft = false;
        else if (d.x >= this.right - 1) entranceOnLeft = true;
      }
    }

    const entrancePos = (this.top + 1) * w + (entranceOnLeft ? this.left + 1 : this.right - 1);
    level.addTransition(entrancePos, 'branchExit', { depth: Dungeon.depth, branch: Dungeon.branch + 1, type: 'branchEntrance' });
    Painter.set(level, entrancePos, T.EXIT);

    // QuestEntrance: the ladder down.
    const e = level.cellToPoint(entrancePos);
    level.customTiles.push(customTile('BlacksmithRoom.QuestEntrance', CAVES_QUEST, e.x, e.y, 1, 1, [0]));

    // SmithyVisuals: the furnace and anvil, and the smithy's floor and pedestals.
    const tileX = this.left + 2;
    const tileY = this.top + 2;
    const tileW = this.width() - 4;
    const tileH = this.height() - 4;
    const data = new Array<number>(tileW * tileH);
    for (let i = 0; i < data.length; i++) {
      if (i === 0) data[i] = 7;
      else if (i === 1) data[i] = 16;
      else if (i === 2) data[i] = 17;
      else if (Math.trunc(i / tileW) === 1 && i % tileW === 2) data[i] = 18;
      else {
        const cell = tileX + (i % tileW) + (tileY + Math.trunc(i / tileW)) * w;
        if (level.map[cell] === T.EMPTY_SP) {
          if (i >= data.length - tileW) data[i] = i % tileW === 0 ? 12 : i % tileW === tileW - 1 ? 14 : 13;
          else data[i] = i % tileW === 0 ? 8 : i % tileW === tileW - 1 ? 10 : -1;
        } else if (level.map[cell] === T.PEDESTAL) {
          data[i] = i >= data.length - tileW ? 20 : 21;
        } else {
          data[i] = -1;
        }
      }
    }
    level.customTiles.push(customTile('BlacksmithRoom.SmithyVisuals', CAVES_QUEST, tileX, tileY, tileW, tileH, data));

    // FurnaceOverhang: over the furnace, above the characters.
    const p = level.cellToPoint(npc);
    level.customTiles.push(customTile('BlacksmithRoom.FurnaceOverhang', CAVES_QUEST, p.x - 1, p.y - 2, 1, 1, [3], true));
  }

  /** Never joined to the way down: the smith's ladder and the floor's exit side by side would confuse. */
  override canConnect(r: Room): boolean {
    if (r.isExit()) return false;
    return super.canConnect(r);
  }

  override maxConnections(direction: number): number {
    return direction === TOP ? 1 : super.maxConnections(direction);
  }

  /** A single top connection only at its corners, and no side one at a corner. */
  override canConnectPoint(p: Point): boolean {
    if (p.y === this.top && p.x !== this.left + 1 && p.x !== this.right - 1) return false;
    if (p.y === this.top + 1) return false;
    return super.canConnectPoint(p);
  }

  override canPlaceCharacter(_p: Point, _l: GenLevel): boolean {
    return false;
  }

  override canPlaceItem(p: Point, l: GenLevel): boolean {
    return l.map[l.pointToCell(p)] === T.EMPTY;
  }

  override canPlaceGrass(_p: Point): boolean {
    return false;
  }

  override canPlaceTrap(_p: Point): boolean {
    return false;
  }

  override canPlaceWater(_p: Point): boolean {
    return false;
  }

  override canMerge(_l: GenLevel, _other: Room, _p: Point, _mergeTerrain: number): boolean {
    return false;
  }
}
