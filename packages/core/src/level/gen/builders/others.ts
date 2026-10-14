import { Dungeon } from '../dungeon';
import { Random } from '../random';
import { Point, PointF, Rect } from '../rect';
import { ALL, type Room } from '../room';
import { createConnectionRoom } from '../rooms/connection/rooms';
import { Builder } from './builder';
import { RegularBuilder } from './regular';

/* levels/builders/LineBuilder, BranchesBuilder and GridBuilder. */

const f32 = Math.fround;

/** LineBuilder: the main path as a line in one direction (wandering by the path variance), the rest branching off. */
export class LineBuilder extends RegularBuilder {
  build(rooms: Room[]): Room[] | null {
    this.setupRooms(rooms);
    const entrance = this.entrance;
    if (!entrance) return null;

    const direction = Random.Float(0, 360);
    const branchable: Room[] = [];
    entrance.setSize();
    entrance.setPos(0, 0);
    this.mainPathRooms.unshift(entrance);
    if (this.exit) this.mainPathRooms.push(this.exit);
    if (this.shop) Builder.placeRoom(rooms, entrance, this.shop, f32(direction + 180));

    let prev = entrance;
    let pathTunnels = [...this.pathTunnelChances];
    for (let i = 1; i < this.mainPathRooms.length; i++) {
      const r = this.mainPathRooms[i]!;
      let tunnels = Random.chances(pathTunnels);
      if (tunnels === -1) {
        pathTunnels = [...this.pathTunnelChances];
        tunnels = Random.chances(pathTunnels);
      }
      pathTunnels[tunnels]!--;
      for (let j = 0; j < tunnels; j++) {
        const t = createConnectionRoom(Dungeon.depth);
        Builder.placeRoom(rooms, prev, t, f32(direction + Random.Float(-this.pathVariance, this.pathVariance)));
        branchable.push(t);
        rooms.push(t);
        prev = t;
      }
      Builder.placeRoom(rooms, prev, r, f32(direction + Random.Float(-this.pathVariance, this.pathVariance)));
      branchable.push(r);
      prev = r;
    }

    const roomsToBranch = [...this.multiConnections, ...this.singleConnections];
    this.weightRooms(branchable);
    if (!this.createBranches(rooms, branchable, roomsToBranch, this.branchTunnelChances)) return null;
    this.connectExtras(rooms);
    return rooms;
  }
}

/** BranchesBuilder: nothing but branches from the entrance, very random. */
export class BranchesBuilder extends RegularBuilder {
  build(rooms: Room[]): Room[] | null {
    this.setupRooms(rooms);
    const entrance = this.entrance;
    if (!entrance) return null;

    const branchable: Room[] = [];
    entrance.setSize();
    entrance.setPos(0, 0);
    branchable.push(entrance);
    if (this.shop) Builder.placeRoom(branchable, entrance, this.shop, Random.Float(360));

    // Two or three rooms of the main path first, for the branches to start from.
    const mainBranchRooms = Math.max(Random.Int(2, 3), this.mainPathRooms.length);
    let pathTunnels = [...this.pathTunnelChances];
    for (let i = 1; i < mainBranchRooms; i++) {
      let prev = entrance;
      const r = this.mainPathRooms[0]!;
      let tunnels = Random.chances(pathTunnels);
      if (tunnels === -1) {
        pathTunnels = [...this.pathTunnelChances];
        tunnels = Random.chances(pathTunnels);
      }
      pathTunnels[tunnels]!--;
      for (let j = 0; j < tunnels; j++) {
        const t = createConnectionRoom(Dungeon.depth);
        let result: number;
        do {
          result = Builder.placeRoom(rooms, prev, t, Random.Float(360));
        } while (result === -1);
        branchable.push(t);
        rooms.push(t);
        prev = t;
      }
      let result: number;
      do {
        result = Builder.placeRoom(rooms, prev, r, Random.Float(360));
      } while (result === -1);
      branchable.push(r);
      this.mainPathRooms.splice(this.mainPathRooms.indexOf(r), 1);
    }

    const roomsToBranch = [...this.mainPathRooms, ...this.multiConnections];
    if (this.exit) roomsToBranch.push(this.exit);
    roomsToBranch.push(...this.singleConnections);
    if (!this.createBranches(rooms, branchable, roomsToBranch, this.branchTunnelChances)) return null;
    this.connectExtras(rooms);
    return rooms;
  }

  protected override randomBranchAngle(r: Room): number {
    const c = this.entrance!.center();
    const entranceCenter = new PointF(c.x, c.y);
    let toCenter = Builder.angleBetweenPoints(new PointF(f32((r.left + r.right) / 2), f32((r.top + r.bottom) / 2)), entranceCenter);
    if (toCenter < 0) toCenter = f32(toCenter + 360);
    let currAngle = Random.Float(360);
    for (let i = 0; i < 4; i++) {
      const newAngle = Random.Float(360);
      if (Math.abs(toCenter - newAngle) < Math.abs(toCenter - currAngle)) currAngle = newAngle;
    }
    return currAngle;
  }
}

/**
 * GridBuilder: rooms of fixed sizes (ROOM_SIZE, or twice it less one) on a grid, placed largely at
 * random but drawn towards the middle to keep the level compact (the vault's).
 */
export class GridBuilder extends Builder {
  static ROOM_SIZE = 11;
  /** Each adjacency is looked at twice: about four in five neighbours end up joined. */
  protected extraConnectionChance = 0.55;

  build(rooms: Room[]): Room[] | null {
    const SIZE = GridBuilder.ROOM_SIZE;
    for (const r of rooms) r.setEmpty();
    let entrance: Room | null = null;
    let exit: Room | null = null;
    for (const r of rooms) {
      if (r.isEntrance()) entrance = r;
      else if (r.isExit()) exit = r;
    }
    if (!entrance || !entrance.forceSize(SIZE, SIZE)) throw new Error('rigid room sizes for now!');
    entrance.setPos(0, 0);

    // A few ordinary rooms for every special one.
    const multis: Room[] = [];
    const singles: Room[] = [];
    for (const r of rooms) (r.maxConnections(ALL) === 1 ? singles : multis).push(r);

    // A boundary from the number of rooms (big rooms may poke out of it).
    let maxWidth = 0;
    let maxHeight = 0;
    while (maxWidth * maxHeight < f32(rooms.length * 1.25)) {
      if (maxWidth < maxHeight || (maxWidth === maxHeight && Random.Int(2) === 0)) maxWidth++;
      else maxHeight++;
    }

    const toPlace: Room[] = [];
    const placed: Room[] = [];
    if (multis.length > 0) toPlace.push(multis.shift()!);
    if (multis.length > 0) toPlace.push(multis.shift()!);
    while (multis.length > 0 || singles.length > 0) {
      for (let k = 0; k < 3; k++) if (multis.length > 0) toPlace.push(multis.shift()!);
      if (singles.length > 0) toPlace.push(singles.shift()!);
    }
    const entranceIndex = toPlace.indexOf(entrance);
    if (entranceIndex >= 0) toPlace.splice(entranceIndex, 1);

    // The entrance always on the edge (corners a little likelier).
    let entryX: number;
    let entryY: number;
    switch (Random.Int(4)) {
      case 1:
        entryX = Random.Int(0, maxWidth);
        entryY = 0;
        break;
      case 2:
        entryX = maxWidth - 1;
        entryY = Random.Int(0, maxHeight);
        break;
      case 3:
        entryX = Random.Int(0, maxWidth);
        entryY = maxHeight - 1;
        break;
      default:
        entryX = 0;
        entryY = Random.Int(0, maxHeight);
    }
    entrance.setPos(entryX * (SIZE - 1), entryY * (SIZE - 1));
    placed.push(entrance);

    // The exit last.
    if (exit) {
      const exitIndex = toPlace.indexOf(exit);
      if (exitIndex >= 0) toPlace.splice(exitIndex, 1);
      toPlace.push(exit);
    }

    const aimCenter = new PointF(f32(maxWidth / 2), f32(maxHeight / 2));
    // Grid cells as x + 1000*y, offset by 100 each way to keep indexes positive (SparseArray: keys in order).
    const gridCells = new Map<number, Room>();
    gridCells.set(getIdx(entryX, entryY), entrance);

    let roomPlacementFailures = 0;
    while (toPlace.length > 0) {
      const r = toPlace.shift()!;
      let cellWidth = 1;
      let cellHeight = 1;
      if (!r.forceSize(SIZE, SIZE)) {
        if (!r.forceSize(2 * SIZE - 1, 2 * SIZE - 1)) {
          if (!r.forceSize(SIZE, 2 * SIZE - 1)) {
            if (!r.forceSize(2 * SIZE - 1, SIZE)) throw new Error('rigid room sizes for now!');
            cellWidth = 2;
            cellHeight = 1;
          } else {
            cellWidth = 1;
            cellHeight = 2;
          }
        } else {
          cellWidth = cellHeight = 2;
        }
      }

      let tries = 0;
      do {
        r.neigbours = [];
        tries++;
        if (tries > 100) {
          // Not now: back into the list, and start over if this keeps happening.
          toPlace.splice(Math.min(2, toPlace.length), 0, r);
          roomPlacementFailures++;
          if (roomPlacementFailures > 100) return null;
          break;
        }

        let n: Room;
        let nIdx: number;
        // The first two placed rooms always connect to the entrance.
        if (placed.length < 3) {
          n = entrance;
          nIdx = getIdx(entryX, entryY);
        } else {
          const keys = [...gridCells.keys()].sort((a, b) => a - b);
          nIdx = keys[Random.Int(keys.length)]!;
          n = gridCells.get(nIdx)!;
        }

        let rIdx = nIdx;
        const xDiff = f32(aimCenter.x - ((rIdx % 1000) - 100));
        const yDiff = f32(aimCenter.y - (Math.trunc(rIdx / 1000) - 100));
        const dist = f32(Math.sqrt(xDiff * xDiff + yDiff * yDiff));
        // The farther out, the likelier to be pulled to the middle; always on the first placement.
        if (Random.Float(12) < 8 + dist || placed.length === 1) {
          if (Math.abs(xDiff) >= Math.abs(yDiff)) rIdx += xDiff > 0 ? 1 : -1;
          else rIdx += yDiff > 0 ? 1000 : -1000;
        } else {
          switch (Random.Int(4)) {
            case 0:
              rIdx += 1;
              break;
            case 1:
              rIdx -= 1000;
              break;
            case 2:
              rIdx -= 1;
              break;
            case 3:
              rIdx += 1000;
              break;
          }
        }

        let x = (rIdx % 1000) - 100;
        let y = Math.trunc(rIdx / 1000) - 100;
        let valid: boolean;
        // (The original checks x against the height too.)
        if (x < 0 || x >= maxHeight || y < 0 || y >= maxHeight) {
          valid = false;
        } else if (gridCells.has(rIdx)) {
          valid = false;
        } else if (cellWidth > 1 || cellHeight > 1) {
          const space = this.findFreeGridSpace(new Point(x, y), gridCells, cellWidth, cellHeight);
          // 1x2 and 2x1 rooms must fit inside; bigger ones may stick out a little.
          if (cellWidth * cellHeight <= 2) {
            space.left = Math.max(0, space.left);
            space.top = Math.max(0, space.top);
            space.right = Math.min(maxWidth - 1, space.right);
            space.bottom = Math.min(maxHeight - 1, space.bottom);
          }
          const excessWidth = space.width() + 1 - cellWidth;
          const excessHeight = space.height() + 1 - cellHeight;
          valid = excessWidth >= 0 && excessHeight >= 0;
          if (valid) {
            x = space.left + Random.Int(excessWidth + 1);
            y = space.top + Random.Int(excessHeight + 1);
            rIdx = getIdx(x, y);
          }
        } else {
          valid = true;
        }

        // Two rooms of the same kind never share a side: it looks too repetitive on a grid.
        if (valid) {
          r.setPos(x * (SIZE - 1), y * (SIZE - 1));
          for (const other of placed) {
            if (other.kind === r.kind) {
              const i = r.intersect(other);
              if (i.width() > 0 || i.height() > 0) valid = false;
            }
          }
        }

        if (valid && r.connect(n)) {
          placed.push(r);
          for (let i = 0; i < cellWidth; i++) {
            for (let j = 0; j < cellHeight; j++) gridCells.set(rIdx + i + j * 1000, r);
          }
        }
      } while (!placed.includes(r));
    }

    Builder.findNeighbours(rooms);
    for (const r of rooms) {
      for (const n of r.neigbours) {
        if (!n.connected.has(r) && Random.Float() < this.extraConnectionChance) r.connect(n);
      }
    }
    return rooms;
  }

  /** Builder.findFreeSpace on the grid: grows a cell at a time each way, for a squarer shape. */
  findFreeGridSpace(start: Point, collision: ReadonlyMap<number, Room>, maxWidth: number, maxHeight: number): Rect {
    const space = new Rect(start.x, start.y, start.x, start.y);
    let expanded = true;
    while (expanded) {
      expanded = false;
      if (space.left > start.x - (maxWidth - 1)) {
        let valid = true;
        for (let y = space.top; y <= space.bottom; y++) if (collision.has(getIdx(space.left - 1, y))) valid = false;
        if (valid) {
          space.left--;
          expanded = true;
        }
      }
      if (space.top > start.y - (maxHeight - 1)) {
        let valid = true;
        for (let x = space.left; x <= space.right; x++) if (collision.has(getIdx(x, space.top - 1))) valid = false;
        if (valid) {
          space.top--;
          expanded = true;
        }
      }
      if (space.right < start.x + (maxWidth - 1)) {
        let valid = true;
        for (let y = space.top; y <= space.bottom; y++) if (collision.has(getIdx(space.right + 1, y))) valid = false;
        if (valid) {
          space.right++;
          expanded = true;
        }
      }
      if (space.bottom < start.y + (maxHeight - 1)) {
        let valid = true;
        for (let x = space.left; x <= space.right; x++) if (collision.has(getIdx(x, space.bottom + 1))) valid = false;
        if (valid) {
          space.bottom++;
          expanded = true;
        }
      }
    }
    return space;
  }
}

const getIdx = (x: number, y: number): number => x + 100 + 1000 * (y + 100);
