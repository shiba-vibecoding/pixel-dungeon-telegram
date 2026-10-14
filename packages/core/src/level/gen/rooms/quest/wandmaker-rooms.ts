import { createItem, type Item } from '../../../../items';
import { T } from '../../../terrain';
import { customTile, mapSimpleImage } from '../../custom';
import { Dungeon } from '../../dungeon';
import type { GenLevel } from '../../genlevel';
import { Generator } from '../../generator';
import { Painter } from '../../painter';
import { Random } from '../../random';
import { Point } from '../../rect';
import { BOTTOM, DoorType, type Room } from '../../room';
import { SpecialRoom } from '../special/special';
import { StandardRoom } from '../standard/standard';

/*
 * levels/rooms/quest: the old wandmaker's rooms in the prison, one for each of his errands
 * (Wandmaker.Quest.spawnRoom adds one): the barricaded mass grave of the corpse dust, the ritual
 * site where four candles summon a newborn fire elemental, and the locked rot garden round the
 * rotberry's heart. Their art is environment/custom_tiles/prison_quest.png.
 */

/** Assets.Environment.PRISON_QUEST. */
const PRISON_QUEST = 'prison_quest';

/**
 * MassGraveRoom: an 11x10 room behind a barricade (a potion of liquid flame to burn it is somewhere
 * on the level), its door at the bottom, at least three rooms from the entrance; bones over its floor,
 * raised statues by the walls, one or two skeletons up the top and, in the remains, the corpse dust
 * among a few coins, a find now and then and some armour.
 */
export class MassGraveRoom extends SpecialRoom {
  readonly kind: string = 'MassGraveRoom';

  override minWidth(): number {
    return 11;
  }
  override maxWidth(): number {
    return 11;
  }
  override minHeight(): number {
    return 10;
  }
  override maxHeight(): number {
    return 10;
  }

  paint(level: GenLevel): void {
    const entrance = this.entrance();
    entrance.set(DoorType.BARRICADE);
    level.addItemToSpawn(createItem('potion.liquidFlame'));

    Painter.fill(level, this, T.WALL);
    Painter.fill(level, this, 1, T.CUSTOM_DECO_EMPTY);

    const { left, top, right } = this;
    Painter.fill(level, left + 1, top + 1, 3, 1, T.WALL);
    Painter.fill(level, left + 1, top + 2, 2, 1, T.WALL);
    Painter.fill(level, right - 3, top + 1, 3, 1, T.WALL);
    Painter.fill(level, right - 2, top + 2, 2, 1, T.WALL);
    Painter.set(level, left + 5, top, T.WALL_DECO);

    Painter.set(level, left + 3, top + 2, T.STATUE);
    Painter.set(level, right - 3, top + 2, T.STATUE);

    // StatueRaised (customTerrain, under the rest): the statues' own tile, 4 in the sheet.
    level.customTiles.push(customTile('MassGraveRoom$StatueRaised', PRISON_QUEST, left + 3, top + 2, 1, 1, [4]));
    level.customTiles.push(customTile('MassGraveRoom$StatueRaised', PRISON_QUEST, right - 3, top + 2, 1, 1, [4]));
    level.customTiles.push(massGraveDeco(left + 1, top, this.width() - 2, this.height() - 1));

    // 50% 1 skeleton, 50% 2 skeletons (the bound drawn anew each time round, as Java's loop does).
    for (let i = 0; i <= Random.Int(2); i++) {
      let pos: number;
      let p: Point;
      do {
        p = this.random(1);
        // Pulled in range for the top two rows.
        if (p.y <= top + 2) p.x = Random.IntRange(left + 4, right - 4);
        pos = level.pointToCell(p);
      } while (p.y > top + 3 || level.findMob(pos) !== undefined);
      level.mobs.push({ kind: 'skeleton', pos });
    }

    // 100% corpse dust, 2x100% 1 coin, 2x30% a coin more, 1x60% a random item, 1x30% armour.
    const items: Item[] = [];
    items.push(corpseDust());
    items.push(createItem('gold', 1));
    items.push(createItem('gold', 1));
    // new Gold(): a single coin too.
    if (Random.Float() <= Math.fround(0.3)) items.push(createItem('gold', 1));
    if (Random.Float() <= Math.fround(0.3)) items.push(createItem('gold', 1));
    if (Random.Float() <= Math.fround(0.6)) items.push(Generator.random());
    if (Random.Float() <= Math.fround(0.3)) items.push(Generator.randomArmor());

    for (const item of items) {
      let pos: number;
      let p: Point;
      do {
        p = this.random(1);
        if (p.y <= top + 2) p.x = Random.IntRange(left + 4, right - 4);
        pos = level.pointToCell(p);
      } while (p.y > top + 5 || level.heaps.has(pos));
      const heap = level.drop(item, pos);
      // Heap.setHauntedIfCursed: the corpse dust is cursed, and haunts its remains.
      if (heap.items.some((it) => it.cursed)) heap.haunted = true;
      heap.kind = 'skeleton';
    }
  }

  override canConnectDirection(direction: number): boolean {
    return super.canConnectDirection(direction) && direction === BOTTOM;
  }

  override canConnectPoint(p: Point): boolean {
    return Math.abs(p.x - this.center().x) <= 2;
  }

  override canConnect(r: Room): boolean {
    if (r.isEntrance()) return false;
    // At least three rooms between it and the entrance room.
    for (const r1 of r.connected.keys()) {
      if (r1.isEntrance()) return false;
      for (const r2 of r1.connected.keys()) {
        if (r2.isEntrance()) return false;
        for (const r3 of r2.connected.keys()) {
          if (r3.isEntrance()) return false;
        }
      }
    }
    return super.canConnect(r);
  }
}

/** items/quest/CorpseDust: cursed (and known to be), so the remains it lies in are haunted. */
export function corpseDust(): Item {
  return { ...createItem('quest.dust'), cursed: true };
}

/** MassGraveRoom.MassGraveDeco: bones over the floor (tiles from (5, 0)), but where the walls and the door's way are. */
const MASS_GRAVE_RENDER = [
  0, 0, 0, 1, 1, 1, 0, 0, 0,
  0, 0, 1, 1, 1, 1, 1, 0, 0,
  1, 1, 1, 1, 1, 1, 1, 1, 1,
  1, 1, 1, 1, 1, 1, 1, 1, 1,
  1, 1, 1, 1, 1, 1, 1, 1, 1,
  1, 1, 1, 1, 1, 1, 1, 1, 1,
  1, 1, 1, 1, 1, 1, 1, 1, 1,
  1, 1, 1, 0, 0, 0, 1, 1, 1,
  1, 1, 0, 0, 0, 0, 0, 1, 1,
];

function massGraveDeco(x: number, y: number, w: number, h: number): ReturnType<typeof customTile> {
  // tileW = tileH = 9, whatever the rect says.
  const data = mapSimpleImage(5, 0, 256, 9, 9).map((tile, i) => (MASS_GRAVE_RENDER[i] === 0 ? -1 : tile));
  void w;
  void h;
  return customTile('MassGraveRoom$MassGraveDeco', PRISON_QUEST, x, y, 9, 9, data);
}

/**
 * RitualSiteRoom: a 10x10 standard room; along its top wall, cages and torture tables between short
 * walls (and a spare cage where there is room), and in the middle the ritual marker on a 3x3 of
 * custom floor; four ceremonial candles lie about the level. Items and characters are never put
 * within a cell of the marker's middle (CeremonialCandle.ritualPos).
 */
export class RitualSiteRoom extends StandardRoom {
  readonly kind: string = 'RitualSiteRoom';
  /** CeremonialCandle.ritualPos, as a point (the level's cells are renumbered when it is fitted into the grid). */
  ritualPoint: Point | null = null;

  override minWidth(): number {
    return Math.max(super.minWidth(), 10);
  }

  override minHeight(): number {
    return Math.max(super.minHeight(), 10);
  }

  paint(level: GenLevel): void {
    for (const door of this.doors()) door.set(DoorType.REGULAR);

    Painter.fill(level, this, T.WALL);
    Painter.fill(level, this, 1, T.EMPTY);

    const { left, top } = this;
    const validTopRowCells = new Array<boolean>(10).fill(true);
    // The wall tiles.
    validTopRowCells[0] = validTopRowCells[3] = validTopRowCells[6] = validTopRowCells[9] = false;
    for (const d of this.doors()) {
      if (d.y === top) {
        validTopRowCells[d.x - left] = false;
      } else if (d.y <= top + 2) {
        if (d.x === left) validTopRowCells[1] = false;
        else validTopRowCells[8] = false;
      }
    }

    const topRow = new Point(left, top);
    let cageRow = Random.Int(2);

    for (let i = left; i < this.right; i += 3) {
      topRow.x = i;
      Painter.drawInside(level, this, topRow, 2, T.WALL);

      // The rare case of two doors (one at the side, one at the top): just go on.
      if (!validTopRowCells[topRow.x + 1 - left] && !validTopRowCells[topRow.x + 2 - left]) continue;

      if (!validTopRowCells[topRow.x + 2 - left]) topRow.x += 1;
      else if (!validTopRowCells[topRow.x + 1 - left]) topRow.x += 2;
      else topRow.x += Random.IntRange(1, 2);

      validTopRowCells[topRow.x - left] = false;
      if (cageRow === 0) {
        Painter.drawInside(level, this, topRow, 2, T.REGION_DECO);
      } else {
        Painter.drawInside(level, this, topRow, 2, T.CUSTOM_DECO);
        // RitualSiteRoom.Table (customTerrain): a 1x2 table from (0, 0).
        level.customTiles.push(customTile('RitualSiteRoom$Table', PRISON_QUEST, topRow.x, topRow.y + 1, 1, 2, mapSimpleImage(0, 0, 256, 1, 2)));
      }
      cageRow--;
    }

    // A spare valid cell of the top row, if any, gets a cage.
    let tries = 100;
    do {
      const i = Random.IntRange(1, 9);
      if (validTopRowCells[i]) {
        topRow.x = left + i;
        Painter.drawInside(level, this, topRow, 1, T.REGION_DECO);
        tries = 0;
      }
    } while (tries-- > 0);

    const c = this.center();
    c.y++;
    // RitualMarker: 5x5 from (0, 2), its outer ring left to the floor's own look in the info window.
    level.customTiles.push(customTile('RitualSiteRoom$RitualMarker', PRISON_QUEST, c.x - 2, c.y - 2, 5, 5, mapSimpleImage(0, 2, 256, 5, 5)));

    Painter.fill(level, c.x - 1, c.y - 1, 3, 3, T.CUSTOM_DECO_EMPTY);

    for (let n = 0; n < 4; n++) level.addItemToSpawn(createItem('quest.candle'));

    this.ritualPoint = c.clone();
  }

  private ritualPos(l: GenLevel): number {
    return this.ritualPoint ? l.pointToCell(this.ritualPoint) : -1;
  }

  override canPlaceItem(p: Point, l: GenLevel): boolean {
    return super.canPlaceItem(p, l) && l.distance(this.ritualPos(l), l.pointToCell(p)) >= 2;
  }

  override canPlaceCharacter(p: Point, l: GenLevel): boolean {
    return super.canPlaceCharacter(p, l) && l.distance(this.ritualPos(l), l.pointToCell(p)) >= 2;
  }

  override canConnectPoint(p: Point): boolean {
    // Walls are put here.
    if (p.y === this.top && (p.x === this.left + 3 || p.x === this.left + 6)) return false;
    return super.canConnectPoint(p);
  }
}

/**
 * RotGardenRoom: at least 10x10, behind a locked door (its iron key lies somewhere on the level): tall
 * grass with walls strewn chaotically through it, the rot heart well away from the door, and up to six
 * rot lashers placed so that a safe way to the heart always remains.
 */
export class RotGardenRoom extends SpecialRoom {
  readonly kind: string = 'RotGardenRoom';

  override minWidth(): number {
    return 10;
  }

  override minHeight(): number {
    return 10;
  }

  paint(level: GenLevel): void {
    const entrance = this.entrance();
    entrance.set(DoorType.LOCKED);
    level.addItemToSpawn({ ...createItem('key.iron'), depth: Dungeon.depth });

    // Mostly tall grass, with walls placed chaotically through it.
    Painter.fill(level, this, T.WALL);
    Painter.set(level, entrance, T.LOCKED_DOOR);

    const candidates: number[] = [];
    let passable = new Array<boolean>(level.length).fill(false);
    const entryPos = level.pointToCell(this.entrance());
    let openCells: number;
    let distance: number[];
    do {
      Painter.fill(level, this, 1, T.HIGH_GRASS);
      for (let i = 0; i < 12; i++) Painter.set(level, this.random(1), T.WALL);
      for (let i = 0; i < 8; i++) Painter.set(level, this.random(2), T.WALL);
      for (let i = 0; i < 4; i++) Painter.set(level, this.random(3), T.WALL);
      Painter.drawInside(level, this, entrance, 3, T.HIGH_GRASS);

      for (let i = 0; i < passable.length; i++) passable[i] = level.map[i] !== T.WALL;

      // The heart in a slightly random place, well away from the entrance.
      distance = distanceMap(level, entryPos, passable);
      candidates.length = 0;
      openCells = 0;
      for (const p of this.getPoints()) {
        const i = level.pointToCell(p);
        if (distance[i] !== UNREACHED) {
          openCells++;
          if (distance[i]! >= 7) candidates.push(i);
        } else if (level.map[i] === T.HIGH_GRASS) {
          // Grass shut off from the rest is filled in.
          level.map[i] = T.WALL;
        }
      }
      Random.shuffle(candidates);
      let closestPos = 7;
      while (candidates.length > 5) {
        for (const i of [...candidates]) {
          if (candidates.length > 5 && distance[i] === closestPos) candidates.splice(candidates.indexOf(i), 1);
        }
        closestPos++;
      }
      // Again if there is nowhere far enough, or more than about half the room is shut off.
    } while (candidates.length === 0 || openCells < 35);
    const heartPos = Random.element(candidates)!;
    placePlant(level, heartPos, 'rotHeart');

    // Up to 6 lashers, so that there is always a safe way to the heart.
    const newPassable = [...passable];
    const maxLashers = 6;
    for (let i = 1; i <= maxLashers; i++) {
      let pos: number;
      let tries = 50;
      const valid = (cell: number): boolean => {
        if (!validPlantPos(passable, newPassable, level, cell, heartPos, entryPos)) return false;
        // Accepted: the lasher's reach is out of the way from now on.
        passable = [...newPassable];
        return true;
      };
      do {
        pos = level.pointToCell(this.random());
        tries--;
      } while (tries > 0 && !valid(pos));
      if (tries <= 0) break;
      placePlant(level, pos, 'rotLasher');
    }

    // Open diagonals next to the heart get open sides next to them, so that its gas can spread.
    const c8 = level.circle8;
    for (let i = 0; i < c8.length; i += 2) {
      if (level.map[heartPos + c8[i]!] !== T.WALL) Painter.set(level, heartPos + c8[i + 1]!, T.HIGH_GRASS);
    }
  }
}

/** PathFinder.distance's Integer.MAX_VALUE. */
const UNREACHED = Number.MAX_SAFE_INTEGER;

/** PathFinder.buildDistanceMap(from, passable) over the whole level, 8-way, never wrapping round its edges. */
function distanceMap(level: GenLevel, from: number, passable: readonly boolean[]): number[] {
  const w = level.width;
  const dist = new Array<number>(level.length).fill(UNREACHED);
  dist[from] = 0;
  const queue = [from];
  for (let head = 0; head < queue.length; head++) {
    const step = queue[head]!;
    const x = step % w;
    const next = dist[step]! + 1;
    for (const n of level.neighbours8) {
      const dx = (((n % w) + w + 1) % w) - 1;
      if ((x === 0 && dx === -1) || (x === w - 1 && dx === 1)) continue;
      const cell = step + n;
      if (cell >= 0 && cell < level.length && passable[cell] && dist[cell]! > next) {
        dist[cell] = next;
        queue.push(cell);
      }
    }
  }
  return dist;
}

/**
 * RotGardenRoom.validPlantPos: on tall grass, with nobody within a cell, and leaving a way from the
 * door to the heart round the lasher's reach (its sides; everything about it when it is near the
 * heart, so that a safe cell beside the heart remains). `newPassable` is given back as `passable`
 * when the place is refused.
 */
function validPlantPos(passable: boolean[], newPassable: boolean[], level: GenLevel, pos: number, heartPos: number, entryPos: number): boolean {
  if (level.map[pos] !== T.HIGH_GRASS) return false;
  for (const i of level.neighbours9) if (level.findMob(pos + i) !== undefined) return false;

  newPassable[pos] = false;
  // Not near the heart: its sides will do. Near it: everything about it.
  const around = level.distance(pos, heartPos) > 2 ? level.neighbours4 : level.neighbours8;
  for (const i of around) newPassable[pos + i] = false;

  const distance = distanceMap(level, heartPos, newPassable);
  if (distance[entryPos] === UNREACHED) {
    for (let i = 0; i < passable.length; i++) newPassable[i] = passable[i]!;
    return false;
  }
  return true;
}

/** RotGardenRoom.placePlant: the heart or a lasher, on grass. */
function placePlant(level: GenLevel, pos: number, kind: 'rotHeart' | 'rotLasher'): void {
  level.mobs.push({ kind, pos, state: 'wandering' });
  Painter.set(level, pos, T.GRASS);
}
