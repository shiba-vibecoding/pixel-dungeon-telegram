import { F, terrainFlags, T } from '../../terrain';
import { TRAPS, type TrapKind } from '../../trapdefs';
import { Dungeon, Feeling } from '../dungeon';
import type { GenLevel } from '../genlevel';
import { Painter } from '../painter';
import { generatePatch } from '../patch';
import { Random } from '../random';
import { Point, Rect } from '../rect';
import { buildDistanceMap, Door, DoorType, type Room } from '../room';
import { isStandard } from '../rooms/standard/standard';

/*
 * levels/painters/RegularPainter: sizes the level to its rooms, paints every room, puts the doors
 * in (hidden ones more often the deeper), merges neighbouring rooms where their walls allow, and
 * then lays water, grass and traps, and lets the region decorate.
 */

export abstract class RegularPainter {
  private waterFill = 0;
  private waterSmoothness = 0;
  private grassFill = 0;
  private grassSmoothness = 0;
  private nTraps = 0;
  private trapClasses: readonly TrapKind[] = [];
  private trapChances: readonly number[] = [];

  setWater(fill: number, smoothness: number): this {
    this.waterFill = Math.fround(fill);
    this.waterSmoothness = smoothness;
    return this;
  }

  setGrass(fill: number, smoothness: number): this {
    this.grassFill = Math.fround(fill);
    this.grassSmoothness = smoothness;
    return this;
  }

  setTraps(num: number, classes: readonly TrapKind[], chances: readonly number[]): this {
    this.nTraps = num;
    this.trapClasses = classes;
    this.trapChances = chances;
    return this;
  }

  protected padding(level: GenLevel): number {
    return level.feeling === Feeling.CHASM ? 2 : 1;
  }

  paint(level: GenLevel, rooms: Room[] | null): boolean {
    // A painter can work without rooms, on a level sized by something else.
    if (rooms) {
      const padding = this.padding(level);
      let leftMost = Number.MAX_SAFE_INTEGER;
      let topMost = Number.MAX_SAFE_INTEGER;
      for (const r of rooms) {
        if (r.left < leftMost) leftMost = r.left;
        if (r.top < topMost) topMost = r.top;
      }
      leftMost -= padding;
      topMost -= padding;
      let rightMost = 0;
      let bottomMost = 0;
      for (const r of rooms) {
        r.shift(-leftMost, -topMost);
        if (r.right > rightMost) rightMost = r.right;
        if (r.bottom > bottomMost) bottomMost = r.bottom;
      }
      rightMost += padding;
      bottomMost += padding;
      // One more for the zero values.
      level.setSize(rightMost + 1, bottomMost + 1);
    } else {
      if (level.length === 0) return false;
      rooms = [];
    }

    Random.shuffle(rooms);
    level.rooms = rooms;

    for (const r of [...rooms]) {
      // Painting a room with no connections: a special room cannot stay so.
      if (r.connected.size === 0 && r.group !== 'standard' && r.group !== 'connection') return false;
      this.placeDoors(r);
      r.paint(level);
    }

    this.paintDoors(level, rooms);

    // A stream of its own, so that this extra variety does not shift the rest of the level.
    Random.pushGenerator(Random.Long());
    try {
      if (this.waterFill > 0) this.paintWater(level, rooms);
      if (this.grassFill > 0) this.paintGrass(level, rooms);
      if (this.nTraps > 0) this.paintTraps(level, rooms);
      this.decorate(level, rooms);
    } finally {
      Random.popGenerator();
    }
    return true;
  }

  protected abstract decorate(level: GenLevel, rooms: Room[]): void;

  private placeDoors(r: Room): void {
    for (const [n, existing] of r.connected) {
      if (existing) continue;
      const i = r.intersect(n);
      const doorSpots: Point[] = [];
      for (const p of i.getPoints()) if (r.canConnectPoint(p) && n.canConnectPoint(p)) doorSpots.push(p);
      // "Could not place a door!": reported, and left without one.
      if (doorSpots.length === 0) continue;
      const spot = Random.element(doorSpots)!;
      const door = new Door(spot.x, spot.y);
      r.connected.set(n, door);
      n.connected.set(r, door);
    }
  }

  /** From 2 in 20 on floor 2 to all of them on floor 20; pulled towards half on a secrets floor. */
  hiddenDoorChance(l: GenLevel): number {
    let chance = 0;
    if (Dungeon.depth > 1) chance = Math.min(1, Math.fround(Dungeon.depth / 20));
    if (l.feeling === Feeling.SECRETS) chance = Math.fround(Math.fround(0.5 + chance) / 2);
    return chance;
  }

  protected paintDoors(l: GenLevel, rooms: Room[]): void {
    const hiddenDoorChance = this.hiddenDoorChance(l);
    const roomMerges = new Map<Room, Room>();

    for (const r of rooms) {
      for (const n of r.connected.keys()) {
        // Normal rooms merge at most once; large and giant ones as often as they can.
        if (roomMerges.get(r) === n || roomMerges.get(n) === r) {
          continue;
        } else if (!roomMerges.has(r) && !roomMerges.has(n) && this.mergeRooms(l, r, n, r.connected.get(n) ?? null, T.EMPTY)) {
          if (isStandard(r) && r.sizeCat.name === 'NORMAL') roomMerges.set(r, n);
          if (isStandard(n) && n.sizeCat.name === 'NORMAL') roomMerges.set(n, r);
          continue;
        }

        const d = r.connected.get(n);
        if (!d) continue;
        const door = d.x + d.y * l.width;

        if (d.type === DoorType.REGULAR) {
          if (Random.Float() < hiddenDoorChance) {
            d.type = DoorType.HIDDEN;
            if (l.feeling !== Feeling.SECRETS) {
              // Every standard room keeps an unbroken way to every other.
              buildDistanceMap(rooms, r);
              if (n.distance === Number.MAX_SAFE_INTEGER) d.type = DoorType.UNLOCKED;
            } else {
              // On a secrets floor, rooms need only not be cut off altogether.
              let roomsInGraph = 0;
              buildDistanceMap(rooms, r);
              for (const rDest of rooms) if (rDest.distance !== Number.MAX_SAFE_INTEGER && rDest.group !== 'connection') roomsInGraph++;
              if (roomsInGraph < 2) {
                d.type = DoorType.UNLOCKED;
              } else {
                roomsInGraph = 0;
                buildDistanceMap(rooms, n);
                for (const nDest of rooms) if (nDest.distance !== Number.MAX_SAFE_INTEGER && nDest.group !== 'connection') roomsInGraph++;
                if (roomsInGraph < 2) d.type = DoorType.UNLOCKED;
              }
            }
            buildDistanceMap(rooms, r);
            // Never the only ways into a room, but on a secrets floor.
            if (l.feeling !== Feeling.SECRETS && n.distance === Number.MAX_SAFE_INTEGER) d.type = DoorType.UNLOCKED;
          } else {
            d.type = DoorType.UNLOCKED;
          }
        }
        // (The tutorial's hidden doors by the entrance on floors 1 and 2 are not ported: there is no guidebook.)

        switch (d.type) {
          case DoorType.EMPTY:
            l.map[door] = T.EMPTY;
            break;
          case DoorType.TUNNEL:
            l.map[door] = l.tunnelTile();
            break;
          case DoorType.WATER:
            l.map[door] = T.WATER;
            break;
          case DoorType.UNLOCKED:
            l.map[door] = T.DOOR;
            break;
          case DoorType.HIDDEN:
            l.map[door] = T.SECRET_DOOR;
            break;
          case DoorType.BARRICADE:
            l.map[door] = T.BARRICADE;
            break;
          case DoorType.LOCKED:
            l.map[door] = T.LOCKED_DOOR;
            break;
          case DoorType.CRYSTAL:
            l.map[door] = T.CRYSTAL_DOOR;
            break;
          case DoorType.WALL:
            l.map[door] = T.WALL;
            break;
        }
      }
    }
  }

  /** RegularPainter.mergeRooms: knocks out the wall the two rooms share, as far as both allow; false if under 3 cells. */
  protected mergeRooms(l: GenLevel, r: Room, n: Room, start: Point | null, mergeTerrain: number): boolean {
    const intersect = r.intersect(n);
    if (intersect.left === intersect.right) {
      const merge = new Rect();
      merge.left = merge.right = intersect.left;
      merge.top = merge.bottom = start ? start.y : intersect.center().y;
      const p = new Point(merge.left, merge.top);
      while (merge.top > intersect.top && n.canMerge(l, r, p, mergeTerrain) && r.canMerge(l, n, p, mergeTerrain)) {
        merge.top--;
        p.y--;
      }
      p.y = merge.bottom;
      while (merge.bottom < intersect.bottom && n.canMerge(l, r, p, mergeTerrain) && r.canMerge(l, n, p, mergeTerrain)) {
        merge.bottom++;
        p.y++;
      }
      if (merge.height() >= 3) {
        r.merge(l, n, new Rect(merge.left, merge.top + 1, merge.left + 1, merge.bottom), mergeTerrain);
        return true;
      }
      return false;
    } else if (intersect.top === intersect.bottom) {
      const merge = new Rect();
      merge.left = merge.right = start ? start.x : intersect.center().x;
      merge.top = merge.bottom = intersect.top;
      const p = new Point(merge.left, merge.top);
      while (merge.left > intersect.left && n.canMerge(l, r, p, mergeTerrain) && r.canMerge(l, n, p, mergeTerrain)) {
        merge.left--;
        p.x--;
      }
      p.x = merge.right;
      while (merge.right < intersect.right && n.canMerge(l, r, p, mergeTerrain) && r.canMerge(l, n, p, mergeTerrain)) {
        merge.right++;
        p.x++;
      }
      if (merge.width() >= 3) {
        r.merge(l, n, new Rect(merge.left + 1, merge.top, merge.right, merge.top + 1), mergeTerrain);
        return true;
      }
      return false;
    }
    return false;
  }

  protected paintWater(l: GenLevel, rooms: Room[]): void {
    const lake = generatePatch(l.width, l.height, this.waterFill, this.waterSmoothness, true);
    if (rooms.length > 0) {
      for (const r of rooms) {
        for (const p of r.waterPlaceablePoints()) {
          const i = l.pointToCell(p);
          if (lake[i] && l.map[i] === T.EMPTY) l.map[i] = T.WATER;
        }
      }
    } else {
      for (let i = 0; i < l.length; i++) if (lake[i] && l.map[i] === T.EMPTY) l.map[i] = T.WATER;
    }
  }

  protected paintGrass(l: GenLevel, rooms: Room[]): void {
    const grass = generatePatch(l.width, l.height, this.grassFill, this.grassSmoothness, true);
    const grassCells: number[] = [];
    if (rooms.length > 0) {
      for (const r of rooms) {
        for (const p of r.grassPlaceablePoints()) {
          const i = l.pointToCell(p);
          if (grass[i] && l.map[i] === T.EMPTY) grassCells.push(i);
        }
      }
    } else {
      for (let i = 0; i < l.length; i++) if (grass[i] && l.map[i] === T.EMPTY) grassCells.push(i);
    }
    // Tall grass the likelier the more grass around.
    for (const i of grassCells) {
      if (l.heaps.has(i) || l.findMob(i)) {
        l.map[i] = T.GRASS;
        continue;
      }
      let count = 1;
      for (const n of l.neighbours8) if (grass[i + n]) count++;
      l.map[i] = Random.Float() < Math.fround(count / 12) ? T.HIGH_GRASS : T.GRASS;
    }
  }

  protected paintTraps(l: GenLevel, rooms: Room[]): void {
    const validCells: number[] = [];
    if (rooms.length > 0) {
      for (const r of rooms) {
        for (const p of r.trapPlaceablePoints()) {
          const i = l.pointToCell(p);
          if (l.map[i] === T.EMPTY) validCells.push(i);
        }
      }
    } else {
      for (let i = 0; i < l.length; i++) if (l.map[i] === T.EMPTY) validCells.push(i);
    }

    // No more than one trap every 5 valid cells.
    this.nTraps = Math.min(this.nTraps, Math.trunc(validCells.length / 5));

    // For traps that keep out of enclosed spaces: cells open both across and along.
    const passable = (i: number): boolean => (terrainFlags[l.map[i]!]! & F.PASSABLE) !== 0;
    const c4 = l.circle4;
    let validOpenSpace = validCells.filter((i) => (passable(i + c4[0]!) || passable(i + c4[2]!)) && (passable(i + c4[1]!) || passable(i + c4[3]!)));

    // TrapMechanism.revealHiddenTrapChance: 0 without the trinket (alchemy stream: SEAM(alchemy)).
    const revealedChance = 0;
    let revealInc = 0;

    // Five times the traps on a traps floor, the extra ones all in plain sight.
    const total = l.feeling === Feeling.TRAPS ? 5 * this.nTraps : this.nTraps;
    for (let i = 0; i < total; i++) {
      if (validCells.length === 0) break;
      const kind = this.trapClasses[Random.chances(this.trapChances)]!;
      const trapPos = TRAPS[kind].avoidsClosedSpaces && validOpenSpace.length > 0 ? Random.element(validOpenSpace)! : Random.element(validCells)!;
      removeValue(validCells, trapPos);
      removeValue(validOpenSpace, trapPos);
      // Open-space traps are never next to each other.
      for (const d of c4) removeValue(validOpenSpace, trapPos + d);
      validOpenSpace = validOpenSpace.slice();

      revealInc += revealedChance;
      let visible: boolean;
      if (i >= this.nTraps || revealInc >= 1) {
        visible = true;
        revealInc--;
      } else {
        visible = false;
      }
      const trap = l.setTrap(kind, trapPos, visible);
      // Some traps are never hidden.
      l.map[trapPos] = trap.visible ? T.TRAP : T.SECRET_TRAP;
    }
  }
}

function removeValue(list: number[], value: number): void {
  const index = list.indexOf(value);
  if (index >= 0) list.splice(index, 1);
}

void Painter;
