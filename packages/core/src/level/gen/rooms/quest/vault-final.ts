import { createItem } from '../../../../items';
import { T } from '../../../terrain';
import { Carpet, customTile, mapSimpleImage } from '../../custom';
import { Dungeon } from '../../dungeon';
import type { GenLevel } from '../../genlevel';
import { Painter } from '../../painter';
import { Random } from '../../random';
import { Point } from '../../rect';
import { DoorType, type Room } from '../../room';
import { EmptyRoom } from '../standard/basic';
import { SpecialRoom } from '../special/special';
import { VAULT_ROOMS } from '../../vault-level';

/*
 * levels/rooms/quest/vault/VaultFinalRoom: the vault's last room, the level's "exit" (three rooms at
 * least from the entry). A round hall with a gigantic summoning marker; on one side the entry behind
 * a door, on the other the treasury behind a locked door: the imp's obsidian statuette in the middle
 * of seven pedestals, and the imp's reward options on the others. Walking up to the locked door
 * summons the greater elemental (vault.ts), which seals both doors until it falls.
 */

export class VaultFinalRoom extends SpecialRoom {
  readonly kind: string = 'VaultFinalRoom';

  override minWidth(): number {
    return 21;
  }
  override maxWidth(): number {
    return 21;
  }
  override minHeight(): number {
    return 21;
  }
  override maxHeight(): number {
    return 21;
  }

  override isExit(): boolean {
    return true;
  }

  override canConnectPoint(p: Point): boolean {
    const c = this.center();
    return Math.abs(p.x - c.x) <= 5 || Math.abs(p.y - c.y) <= 5;
  }

  /** At least three rooms between it and the entry room. */
  override canConnect(r: Room): boolean {
    if (r.isEntrance()) return false;
    for (const r1 of r.connected.keys()) {
      if (r1.isEntrance()) return false;
      for (const r2 of r1.connected.keys()) {
        if (r2.isEntrance()) return false;
        for (const r3 of r2.connected.keys()) if (r3.isEntrance()) return false;
      }
    }
    return super.canConnect(r);
  }

  override canPlaceGrass(): boolean {
    return false;
  }
  override canPlaceWater(): boolean {
    return false;
  }
  override canPlaceItem(): boolean {
    return false;
  }

  entryDoor = new Point();
  lockedDoor = new Point();

  paint(level: GenLevel): void {
    Painter.fill(level, this, T.WALL);
    Painter.fillEllipse(level, this, 5, T.EMPTY_SP);
    const c = this.center();
    // MarkerTiles: the gigantic marker.
    level.customTiles.push(customTile('MarkerTiles', 'city_quest', c.x - 4, c.y - 4, 9, 9, mapSimpleImage(5, 4, 256, 9, 9)));

    const entrance = this.entrance();
    entrance.set(DoorType.REGULAR);
    const entry = new EmptyRoom();
    const treasure = new EmptyRoom();
    const { left, top, right, bottom } = this;
    if (entrance.x === left) {
      entry.set(left + 1, top + 5, left + 3, bottom - 5);
      this.entryDoor = new Point(left + 4, c.y);
      treasure.set(right - 3, top + 3, right - 1, bottom - 3);
      this.lockedDoor = new Point(right - 4, c.y);
    } else if (entrance.x === right) {
      treasure.set(left + 1, top + 3, left + 3, bottom - 3);
      this.lockedDoor = new Point(left + 4, c.y);
      entry.set(right - 3, top + 5, right - 1, bottom - 5);
      this.entryDoor = new Point(right - 4, c.y);
    } else if (entrance.y === top) {
      entry.set(left + 5, top + 1, right - 5, top + 3);
      this.entryDoor = new Point(c.x, top + 4);
      treasure.set(left + 3, bottom - 3, right - 3, bottom - 1);
      this.lockedDoor = new Point(c.x, bottom - 4);
    } else {
      treasure.set(left + 3, top + 1, right - 3, top + 3);
      this.lockedDoor = new Point(c.x, top + 4);
      entry.set(left + 5, bottom - 3, right - 5, bottom - 1);
      this.entryDoor = new Point(c.x, bottom - 4);
    }

    Painter.set(level, this.entryDoor, T.DOOR);
    Painter.set(level, this.lockedDoor, T.LOCKED_DOOR);
    Painter.fill(level, entry, T.CUSTOM_DECO_EMPTY);
    const carpet = new Carpet().setRect(entry.left, entry.top, entry.width(), entry.height());

    const w = level.width;
    const spots: number[] = [];
    const pedestal = (x: number, y: number): void => {
      Painter.set(level, x, y, T.REGION_DECO);
      carpet.overrideLevelTile(x, y, Carpet.CITY_PEDESTAL);
    };
    if (entry.width() > entry.height()) {
      for (const dx of [1, 3, 7, 9]) pedestal(entry.left + dx, entry.top + 1);
      for (const dx of [1, 3, 5, 7, 9, 11, 13]) spots.push(treasure.left + dx + (treasure.top + 1) * w);
    } else {
      for (const dy of [1, 3, 7, 9]) pedestal(entry.left + 1, entry.top + dy);
      for (const dy of [1, 3, 5, 7, 9, 11, 13]) spots.push(treasure.left + 1 + (treasure.top + dy) * w);
    }
    level.customTiles.push(carpet.toCustomTile());

    Painter.fill(level, treasure, T.EMPTY_SP);
    for (const cell of spots) Painter.set(level, cell, T.PEDESTAL);

    // The imp's statuette always in the middle; the reward options on the other pedestals.
    level.drop(createItem('quest.impStatue'), spots.splice(3, 1)[0]!);
    Random.shuffle(spots);
    const quest = Dungeon.world?.impQuest;
    for (const item of quest?.rewardOptions ?? []) level.drop(item, spots.shift()!);
    if (quest) quest.rewardOptions = [];

    // VaultTreasure: the gold piled about the pedestals (drawn as the map says, vault-tiles.ts).
    level.customTiles.push({ kind: 'VaultTreasure', texture: 'city_quest', x: treasure.left, y: treasure.top - 1, w: treasure.width(), h: treasure.height() + 1 });
    for (const door of [this.entryDoor, this.lockedDoor]) {
      level.customTiles.push({ kind: 'FinalRoomDoor', texture: 'city_quest', x: door.x, y: door.y, w: 1, h: 1 });
      level.customTiles.push({ kind: 'FinalRoomDoorOverhang', texture: 'city_quest', x: door.x, y: door.y - 1, w: 1, h: 2, wall: true });
    }
  }
}

VAULT_ROOMS.final = () => new VaultFinalRoom();
