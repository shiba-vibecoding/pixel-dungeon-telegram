import { createItem, type Item } from '../../../../items';
import { T } from '../../../terrain';
import { Dungeon } from '../../dungeon';
import { type GenCategory, Generator } from '../../generator';
import type { GenLevel } from '../../genlevel';
import { Painter } from '../../painter';
import { Random } from '../../random';
import { Point } from '../../rect';
import { DoorType, type Room } from '../../room';
import { seamItem } from '../../seams';
import { EmptyRoom } from '../standard/basic';
import { CONSUMABLE_EXOTIC_CHANCE, crystalKey, DEFAULT_PROBS_TOTAL, ironKey, knowCurse } from './prizes';
import { SpecialRoom } from './special';

/* The special rooms opened with crystal keys (their siblings, the pit room's crystal door, are in pit.ts). */

/**
 * CrystalChoiceRoom: past a locked door, two little rooms behind crystal doors and one crystal key
 * for them: three or four potions and scrolls in one, a chest with a wand, ring or artifact in the other.
 */
export class CrystalChoiceRoom extends SpecialRoom {
  readonly kind: string = 'CrystalChoiceRoom';

  override minWidth(): number {
    return 7;
  }
  override minHeight(): number {
    return 7;
  }

  paint(level: GenLevel): void {
    Painter.fill(level, this, T.WALL);

    const entrance = this.entrance();
    const entry: Room = new EmptyRoom();
    let room1: Room = new EmptyRoom();
    let room2: Room = new EmptyRoom();

    if (entrance.x === this.left) {
      entry.set(this.left + 1, this.top + 1, this.left + 2, this.bottom - 1);
      room1.set(entry.right + 2, this.top + 1, this.right - 1, this.center().y - 1);
      room2.set(entry.right + 2, room1.bottom + 2, this.right - 1, this.bottom - 1);
      Painter.set(level, new Point(entry.right + 1, Math.trunc((room1.top + room1.bottom + 1) / 2)), T.CRYSTAL_DOOR);
      Painter.set(level, new Point(entry.right + 1, Math.trunc((room2.top + room2.bottom) / 2)), T.CRYSTAL_DOOR);
    } else if (entrance.y === this.top) {
      entry.set(this.left + 1, this.top + 1, this.right - 1, this.top + 2);
      room1.set(this.left + 1, entry.bottom + 2, this.center().x - 1, this.bottom - 1);
      room2.set(room1.right + 2, entry.bottom + 2, this.right - 1, this.bottom - 1);
      Painter.set(level, new Point(Math.trunc((room1.left + room1.right + 1) / 2), entry.bottom + 1), T.CRYSTAL_DOOR);
      Painter.set(level, new Point(Math.trunc((room2.left + room2.right) / 2), entry.bottom + 1), T.CRYSTAL_DOOR);
    } else if (entrance.x === this.right) {
      entry.set(this.right - 2, this.top + 1, this.right - 1, this.bottom - 1);
      Painter.drawLine(level, new Point(this.right - 1, this.top + 1), new Point(this.right - 1, this.bottom - 1), T.EMPTY);
      room1.set(this.left + 1, this.top + 1, entry.left - 2, this.center().y - 1);
      room2.set(this.left + 1, room1.bottom + 2, entry.left - 2, this.bottom - 1);
      Painter.set(level, new Point(entry.left - 1, Math.trunc((room1.top + room1.bottom + 1) / 2)), T.CRYSTAL_DOOR);
      Painter.set(level, new Point(entry.left - 1, Math.trunc((room2.top + room2.bottom) / 2)), T.CRYSTAL_DOOR);
    } else if (entrance.y === this.bottom) {
      entry.set(this.left + 1, this.bottom - 2, this.right - 1, this.bottom - 1);
      room1.set(this.left + 1, this.top + 1, this.center().x - 1, entry.top - 2);
      room2.set(room1.right + 2, this.top + 1, this.right - 1, entry.top - 2);
      Painter.set(level, new Point(Math.trunc((room1.left + room1.right + 1) / 2), entry.top - 1), T.CRYSTAL_DOOR);
      Painter.set(level, new Point(Math.trunc((room2.left + room2.right) / 2), entry.top - 1), T.CRYSTAL_DOOR);
    }

    Painter.fill(level, entry, T.EMPTY);
    Painter.fill(level, room1, T.EMPTY_SP);
    Painter.fill(level, room2, T.EMPTY_SP);

    if (Random.Int(2) === 0) {
      const tmp = room1;
      room1 = room2;
      room2 = tmp;
    }

    const n = Random.NormalIntRange(3, 4);
    for (let i = 0; i < n; i++) {
      const reward = Generator.random(Random.oneOf<GenCategory>('POTION', 'SCROLL'));
      let pos: number;
      do {
        pos = room1.square() >= 16 ? level.pointToCell(room1.random(1)) : level.pointToCell(room1.random(0));
      } while (level.heaps.has(pos));
      level.drop(reward, pos);
    }

    const hidden = Generator.random(Random.oneOf<GenCategory>('WAND', 'RING', 'ARTIFACT'));
    const chest = level.drop(hidden, level.pointToCell(room2.center()));
    chest.kind = 'chest';
    // Opening the chest is a choice, so it does not count against exploring.
    chest.autoExplored = true;

    level.addItemToSpawn(crystalKey());
    this.entrance().set(DoorType.LOCKED);
    level.addItemToSpawn(ironKey());
  }
}

/** Shattered's potions and scrolls by how common they are (defaultProbsTotal); the rarest last. */
const commonness = (item: Item): number => DEFAULT_PROBS_TOTAL[item.kind] ?? 0;

/**
 * CrystalPathRoom: a passage with six little rooms off it behind crystal doors, each opening the
 * next: potions and scrolls, the commonest nearest, the rarest two on pedestals at the far end. Three
 * crystal keys lie elsewhere on the floor, so three of the six can be opened.
 */
export class CrystalPathRoom extends SpecialRoom {
  readonly kind: string = 'CrystalPathRoom';

  override minWidth(): number {
    return 7;
  }
  override minHeight(): number {
    return 7;
  }

  paint(level: GenLevel): void {
    Painter.fill(level, this, T.WALL);

    // The rooms, from the nearest to the entrance to the furthest.
    const rooms: Room[] = [];
    for (let i = 0; i < 6; i++) rooms.push(new EmptyRoom());
    const [r0, r1, r2, r3, r4, r5] = rooms as [Room, Room, Room, Room, Room, Room];

    const entry = this.entrance().clone();
    let prize1 = 0;
    let prize2 = 0;
    const set = (x: number, y: number): void => Painter.set(level, x, y, T.CRYSTAL_DOOR);

    if (entry.x === this.left || entry.x === this.right) {
      Painter.drawInside(level, this, entry, this.width() > 8 ? 5 : 3, T.EMPTY);
      const roomW1 = this.width() >= 9 ? 2 : 1;
      const roomW2 = this.width() % 2 === 0 ? 2 : 1;
      const roomH = this.height() >= 9 ? 2 : 1;
      if (entry.x === this.left) {
        r0.setPos(this.left + 1, entry.y - roomH - 1).resize(roomW1 - 1, roomH - 1);
        set(r0.left, r0.bottom + 1);
        r1.setPos(this.left + 1, entry.y + 2).resize(roomW1 - 1, roomH - 1);
        set(r1.left, r1.top - 1);
        r2.setPos(r1.right + 2, entry.y - roomH - 1).resize(roomW1 - 1, roomH - 1);
        set(r2.left, r2.bottom + 1);
        r3.setPos(r1.right + 2, entry.y + 2).resize(roomW1 - 1, roomH - 1);
        set(r3.left, r3.top - 1);
        r4.setPos(r3.right + 2, entry.y - roomH - 1).resize(roomW2 - 1, roomH);
        set(r4.left - 1, r4.bottom - 1);
        r5.setPos(r3.right + 2, entry.y + 1).resize(roomW2 - 1, roomH);
        set(r5.left - 1, r5.top + 1);
        prize1 = level.pointToCell(new Point(r4.left, r4.bottom));
        prize2 = level.pointToCell(new Point(r5.left, r5.top));
      } else {
        r0.setPos(this.right - roomW1, entry.y - roomH - 1).resize(roomW1 - 1, roomH - 1);
        set(r0.right, r0.bottom + 1);
        r1.setPos(this.right - roomW1, entry.y + 2).resize(roomW1 - 1, roomH - 1);
        set(r1.right, r1.top - 1);
        r2.setPos(r1.left - roomW1 - 1, entry.y - roomH - 1).resize(roomW1 - 1, roomH - 1);
        set(r2.right, r2.bottom + 1);
        r3.setPos(r1.left - roomW1 - 1, entry.y + 2).resize(roomW1 - 1, roomH - 1);
        set(r3.right, r3.top - 1);
        r4.setPos(r3.left - roomW2 - 1, entry.y - roomH - 1).resize(roomW2 - 1, roomH);
        set(r4.right + 1, r4.bottom - 1);
        r5.setPos(r3.left - roomW2 - 1, entry.y + 1).resize(roomW2 - 1, roomH);
        set(r5.right + 1, r5.top + 1);
        prize1 = level.pointToCell(new Point(r4.right, r4.bottom));
        prize2 = level.pointToCell(new Point(r5.right, r5.top));
      }
    } else {
      Painter.drawInside(level, this, entry, this.height() > 8 ? 5 : 3, T.EMPTY);
      const roomW = this.width() >= 9 ? 2 : 1;
      const roomH1 = this.height() >= 9 ? 2 : 1;
      const roomH2 = this.height() % 2 === 0 ? 2 : 1;
      if (entry.y === this.top) {
        r0.setPos(entry.x - roomW - 1, this.top + 1).resize(roomW - 1, roomH1 - 1);
        set(r0.right + 1, r0.top);
        r1.setPos(entry.x + 2, this.top + 1).resize(roomW - 1, roomH1 - 1);
        set(r1.left - 1, r1.top);
        r2.setPos(entry.x - roomW - 1, r1.bottom + 2).resize(roomW - 1, roomH1 - 1);
        set(r2.right + 1, r2.top);
        r3.setPos(entry.x + 2, r1.bottom + 2).resize(roomW - 1, roomH1 - 1);
        set(r3.left - 1, r3.top);
        r4.setPos(entry.x - roomW - 1, r3.bottom + 2).resize(roomW, roomH2 - 1);
        set(r4.right - 1, r4.top - 1);
        r5.setPos(entry.x + 1, r3.bottom + 2).resize(roomW, roomH2 - 1);
        set(r5.left + 1, r5.top - 1);
        prize1 = level.pointToCell(new Point(r4.right, r4.top));
        prize2 = level.pointToCell(new Point(r5.left, r5.top));
      } else {
        r0.setPos(entry.x - roomW - 1, this.bottom - roomH1).resize(roomW - 1, roomH1 - 1);
        set(r0.right + 1, r0.bottom);
        r1.setPos(entry.x + 2, this.bottom - roomH1).resize(roomW - 1, roomH1 - 1);
        set(r1.left - 1, r1.bottom);
        r2.setPos(entry.x - roomW - 1, r1.top - roomH1 - 1).resize(roomW - 1, roomH1 - 1);
        set(r2.right + 1, r2.bottom);
        r3.setPos(entry.x + 2, r1.top - roomH1 - 1).resize(roomW - 1, roomH1 - 1);
        set(r3.left - 1, r3.bottom);
        r4.setPos(entry.x - roomW - 1, r3.top - roomH2 - 1).resize(roomW, roomH2 - 1);
        set(r4.right - 1, r4.bottom + 1);
        r5.setPos(entry.x + 1, r3.top - roomH2 - 1).resize(roomW, roomH2 - 1);
        set(r5.left + 1, r5.bottom + 1);
        prize1 = level.pointToCell(new Point(r4.right, r4.bottom));
        prize2 = level.pointToCell(new Point(r5.left, r5.bottom));
      }
    }

    for (const room of rooms) Painter.fill(level, room, T.EMPTY_SP);
    Painter.set(level, prize1, T.PEDESTAL);
    Painter.set(level, prize2, T.PEDESTAL);

    // A random potion or scroll in each room, the less valuable nearer.
    const potions: Item[] = [];
    const scrolls: Item[] = [];
    if (Random.Int(2) === 0) {
      this.addRewardItem('POTION', potions);
      scrolls.push((Random.Float() < CONSUMABLE_EXOTIC_CHANCE ? seamItem('scrollOfMetamorphosis') : seamItem('scrollOfTransmutation'))!);
    } else {
      potions.push(Random.Float() < CONSUMABLE_EXOTIC_CHANCE ? seamItem('potionOfDivineInspiration')! : createItem('potion.experience'));
      this.addRewardItem('SCROLL', scrolls);
    }
    this.addRewardItem('POTION', potions);
    this.addRewardItem('SCROLL', scrolls);
    this.addRewardItem('POTION', potions);
    this.addRewardItem('SCROLL', scrolls);
    // (Generator.undoDrop for the duplicates drawn: Pixel Dungeon's tables keep no decks to undo.)

    // Rarer ones further along (a stable sort, as Collections.sort).
    potions.sort((a, b) => commonness(b) - commonness(a));
    scrolls.sort((a, b) => commonness(b) - commonness(a));

    // The least valuable in rooms 2 and 3, then 0 and 1, the best on 4 and 5.
    const shuffle = Random.Int(2);
    level.drop(potions.shift(), level.pointToCell(rooms[shuffle === 1 ? 2 : 3]!.center()));
    level.drop(scrolls.shift(), level.pointToCell(rooms[shuffle === 1 ? 3 : 2]!.center()));
    level.drop(potions.shift(), level.pointToCell(rooms[shuffle === 1 ? 0 : 1]!.center()));
    level.drop(scrolls.shift(), level.pointToCell(rooms[shuffle === 1 ? 1 : 0]!.center()));
    // Only seen once the doors before them are open: not counted for exploring.
    level.drop(potions.shift(), shuffle === 1 ? prize1 : prize2).autoExplored = true;
    level.drop(scrolls.shift(), shuffle === 1 ? prize2 : prize1).autoExplored = true;

    level.addItemToSpawn(crystalKey());
    level.addItemToSpawn(crystalKey());
    level.addItemToSpawn(crystalKey());

    this.entrance().set(DoorType.REGULAR);
  }

  /** A potion or scroll of a kind not in the list yet (exotics count as their plain kind: none here). */
  private addRewardItem(cat: GenCategory, items: Item[]): void {
    for (;;) {
      const reward = Generator.random(cat);
      if (!items.some((i) => i.kind === reward.kind)) {
        items.push(reward);
        return;
      }
    }
  }

  /** Doors only in the middle of a side. */
  override canConnectPoint(p: Point): boolean {
    if (!super.canConnectPoint(p)) return false;
    const f32 = Math.fround;
    if (Math.abs(f32(p.x - f32(this.right - f32((this.width() - 1) / 2)))) < 1) return true;
    if (Math.abs(f32(p.y - f32(this.bottom - f32((this.height() - 1) / 2)))) < 1) return true;
    return false;
  }

  override canPlaceGrass(_p: Point): boolean {
    return false;
  }
  override canPlaceWater(_p: Point): boolean {
    return false;
  }
  override canPlaceTrap(_p: Point): boolean {
    return false;
  }
}

/**
 * CrystalVaultRoom: a 7x7 vault behind a locked door, two crystal chests on pedestals either side of
 * the middle, one of a wand, ring or artifact each (one time in ten the second is a crystal mimic);
 * one crystal key opens one of them.
 */
export class CrystalVaultRoom extends SpecialRoom {
  readonly kind: string = 'CrystalVaultRoom';
  private readonly prizeClasses: GenCategory[] = ['WAND', 'RING', 'ARTIFACT'];

  // A fixed size, for the look of it and room for crystal mimics.
  override minHeight(): number {
    return 7;
  }
  override maxHeight(): number {
    return 7;
  }
  override minWidth(): number {
    return 7;
  }
  override maxWidth(): number {
    return 7;
  }

  paint(level: GenLevel): void {
    Painter.fill(level, this, T.WALL);
    Painter.fill(level, this, 1, T.EMPTY_SP);
    Painter.fill(level, this, 2, T.EMPTY);

    const c = level.pointToCell(this.center());
    Random.shuffle(this.prizeClasses);

    const i1 = this.prize();
    const i2 = this.prize();

    let i1Pos: number;
    let i2Pos: number;
    const doorPos = level.pointToCell(this.entrance());
    const circle8 = level.circle8;
    do {
      const neighbourIdx = Random.Int(circle8.length);
      i1Pos = c + circle8[neighbourIdx]!;
      i2Pos = c + circle8[(neighbourIdx + 4) % 8]!;
    } while (level.adjacent(i1Pos, doorPos) || level.adjacent(i2Pos, doorPos));

    level.drop(i1, i1Pos).kind = 'crystalChest';
    // RatSkull.exoticChanceMultiplier and MimicTooth.mimicChanceMultiplier: 1 without the trinkets (SEAM(alchemy)).
    let altChance = Math.fround(1 / 10);
    if (altChance > Math.fround(0.1)) altChance = Math.fround(Math.fround(altChance + Math.fround(0.1)) / 2);
    if (Random.Float() < altChance) {
      // Mimic.spawnAt(i2Pos, CrystalMimic.class, i2): a crystal mimic's prize is only made sure to be uncursed.
      // SEAM(mobs): no crystal mimic yet; a mimic heap stands for it.
      i2.cursed = false;
      knowCurse(i2);
      level.drop(i2, i2Pos).kind = 'mimic';
    } else {
      level.drop(i2, i2Pos).kind = 'crystalChest';
    }

    Painter.set(level, i1Pos, T.PEDESTAL);
    Painter.set(level, i2Pos, T.PEDESTAL);

    level.addItemToSpawn(crystalKey());

    this.entrance().set(DoorType.LOCKED);
    level.addItemToSpawn(ironKey());
  }

  private prize(): Item {
    const cat = this.prizeClasses.shift()!;
    this.prizeClasses.push(cat);
    let prize: Item;
    do {
      prize = Generator.random(cat);
    } while (Dungeon.itemBlocked(prize));
    return prize;
  }
}
