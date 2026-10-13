import { Feeling, isShopDepth, type LevelBuilder } from './builder';
import { cell, HEIGHT, LENGTH, NEIGHBOURS8, Rect, WIDTH } from './geometry';
import { PAINTERS } from './painters';
import { buildDistanceMap, buildPath, Door, DoorType, Room, RoomType } from './room';
import { T } from './terrain';

/* The classic room-and-corridor level, used by every non-boss depth. */

const f32 = Math.fround;

export interface RegionStyle {
  minRoomSize: number;
  maxRoomSize: number;
  /** Cellular-automaton seed density and generations for water and grass. */
  water(feeling: Feeling): [density: number, generations: number];
  grass(feeling: Feeling): [density: number, generations: number];
  trapChances: readonly number[];
  /** A last say over the room types, once they are assigned. */
  roomTypes?(level: LevelBuilder): void;
  decorate(level: LevelBuilder): void;
}

export function buildRegularLevel(level: LevelBuilder, style: RegionStyle): boolean {
  const { rng } = level;
  if (!initRooms(level, style)) {
    return false;
  }
  const rooms = level.rooms;

  // Entrance and exit: two large-enough rooms far enough apart.
  const minDistance = Math.trunc(Math.sqrt(rooms.length));
  const endpointRooms = rooms.filter((room) => room.width() >= 4 && room.height() >= 4);
  if (endpointRooms.length < 2) {
    return false;
  }
  let retry = 0;
  let roomEntrance: Room;
  let roomExit: Room;
  do {
    const entranceIndex = rng.int(endpointRooms.length);
    let exitIndex = rng.int(endpointRooms.length - 1);
    if (exitIndex >= entranceIndex) {
      exitIndex++;
    }
    roomEntrance = endpointRooms[entranceIndex]!;
    roomExit = endpointRooms[exitIndex]!;
    buildDistanceMap(rooms, roomExit);
    if (retry++ > 10) {
      return false;
    }
  } while (roomEntrance.distance < minDistance);

  roomEntrance.type = RoomType.ENTRANCE;
  roomExit.type = RoomType.EXIT;
  level.roomEntrance = roomEntrance;
  level.roomExit = roomExit;

  // Two (possibly overlapping) shortest routes from entrance to exit; the
  // second one is pushed away from the first by raising its rooms' price.
  const connected = new Set<Room>([roomEntrance]);
  for (let route = 0; route < 2; route++) {
    buildDistanceMap(rooms, roomExit);
    const path = buildPath(roomEntrance, roomExit);
    if (!path) {
      return false;
    }
    let room = roomEntrance;
    for (const next of path) {
      room.connect(next);
      room = next;
      connected.add(room);
    }
    if (route === 0) {
      for (const node of path) {
        node.price = roomEntrance.distance;
      }
    }
  }

  // Grow the connected area to 50–70% of all rooms.
  const nConnected = Math.trunc(f32(rooms.length * rng.floatRange(f32(0.5), f32(0.7))));
  let attempts = Math.max(16, rooms.length * rooms.length * 4);
  while (connected.size < nConnected && attempts-- > 0) {
    const cr = rng.element(connected)!;
    const or = rng.element(cr.neighbours);
    if (or && !connected.has(or)) {
      cr.connect(or);
      connected.add(or);
    }
  }
  if (connected.size < nConnected) {
    return false;
  }

  if (isShopDepth(level.depth) && PAINTERS.has(RoomType.SHOP)) {
    const shop = [...roomEntrance.connected.keys()].find(
      (r) => r.connected.size === 1 && r.width() >= 5 && r.height() >= 5,
    );
    if (!shop) {
      return false;
    }
    shop.type = RoomType.SHOP;
  }

  assignRoomTypes(level);
  style.roomTypes?.(level);
  paint(level, style);
  paintWater(level, style);
  paintGrass(level, style);
  placeTraps(level, style);
  return true;
}

export function initRooms(level: LevelBuilder, style: RegionStyle): boolean {
  level.rooms = [];
  split(level, style, new Rect(0, 0, level.span - 1, level.span - 1));
  if (level.rooms.length < 8) {
    return false;
  }
  const rooms = level.rooms;
  for (let i = 0; i < rooms.length - 1; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      rooms[i]!.addNeighbour(rooms[j]!);
    }
  }
  return true;
}

/** Binary space partition of the map into room rectangles. */
export function split(level: LevelBuilder, style: RegionStyle, rect: Rect): void {
  const { rng } = level;
  const w = rect.width();
  const h = rect.height();
  const { minRoomSize, maxRoomSize } = style;

  if (w > maxRoomSize && h < minRoomSize) {
    const vw = rng.intBetween(rect.left + 3, rect.right - 3);
    split(level, style, new Rect(rect.left, rect.top, vw, rect.bottom));
    split(level, style, new Rect(vw, rect.top, rect.right, rect.bottom));
  } else if (h > maxRoomSize && w < minRoomSize) {
    const vh = rng.intBetween(rect.top + 3, rect.bottom - 3);
    split(level, style, new Rect(rect.left, rect.top, rect.right, vh));
    split(level, style, new Rect(rect.left, vh, rect.right, rect.bottom));
  } else if (
    // The original divides integers here (49 / area is 0 or 1), so a
    // fitting rectangle becomes a room unless it is larger than 49 cells.
    // Kept as is: it is what gives the classic levels their room sizes.
    (rng.float() <= Math.trunc((minRoomSize * minRoomSize) / rect.square()) && w <= maxRoomSize && h <= maxRoomSize) ||
    w < minRoomSize ||
    h < minRoomSize
  ) {
    const room = new Room();
    room.set(rect.left, rect.top, rect.right, rect.bottom);
    level.rooms.push(room);
  } else if (rng.float() < f32(f32(w - 2) / (w + h - 4))) {
    const vw = rng.intBetween(rect.left + 3, rect.right - 3);
    split(level, style, new Rect(rect.left, rect.top, vw, rect.bottom));
    split(level, style, new Rect(vw, rect.top, rect.right, rect.bottom));
  } else {
    const vh = rng.intBetween(rect.top + 3, rect.bottom - 3);
    split(level, style, new Rect(rect.left, rect.top, rect.right, vh));
    split(level, style, new Rect(rect.left, vh, rect.right, rect.bottom));
  }
}

function assignRoomTypes(level: LevelBuilder): void {
  const { rng, specials } = level;
  let specialRooms = 0;

  for (const r of level.rooms) {
    if (r.type !== RoomType.NULL || r.connected.size !== 1) {
      continue;
    }
    // Dead ends may become special rooms, rarer with every one placed.
    if (specials.length > 0 && r.width() > 3 && r.height() > 3 && rng.int(specialRooms * specialRooms + 2) === 0) {
      if (level.pitRoomNeeded) {
        r.type = RoomType.PIT;
        level.pitRoomNeeded = false;
        for (const excluded of [
          RoomType.ARMORY, RoomType.CRYPT, RoomType.LABORATORY, RoomType.LIBRARY,
          RoomType.STATUE, RoomType.TREASURY, RoomType.VAULT, RoomType.WEAK_FLOOR,
        ]) {
          remove(specials, excluded);
        }
      } else if (level.depth % 5 === 2 && specials.includes(RoomType.LABORATORY)) {
        r.type = RoomType.LABORATORY;
      } else {
        const n = specials.length;
        const a = rng.int(n);
        const b = rng.int(n);
        r.type = specials[Math.min(a, b)]!;
        if (r.type === RoomType.WEAK_FLOOR) {
          level.weakFloorCreated = true;
        }
      }
      level.usedSpecials.push(r.type);
      remove(specials, r.type);
      specialRooms++;
    } else if (rng.int(2) === 0) {
      // Otherwise sometimes open a second exit into an ordinary neighbour.
      const candidates = r.neighbours.filter(
        (n) => !r.connected.has(n) && !level.isSpecial(n.type) && n.type !== RoomType.PIT,
      );
      if (candidates.length > 1) {
        r.connect(rng.element(candidates)!);
      }
    }
  }

  let count = 0;
  for (const r of level.rooms) {
    if (r.type === RoomType.NULL) {
      const connections = r.connected.size;
      if (connections === 0) {
        continue;
      }
      if (rng.int(connections * connections) === 0) {
        r.type = RoomType.STANDARD;
        count++;
      } else {
        r.type = RoomType.TUNNEL;
      }
    }
  }

  // Every level gets at least four proper rooms.
  const tunnels = level.rooms.filter((r) => r.type === RoomType.TUNNEL);
  while (count < 4 && tunnels.length > 0) {
    const room = tunnels.splice(rng.int(tunnels.length), 1)[0]!;
    room.type = RoomType.STANDARD;
    count++;
  }
}

function remove<T>(list: T[], value: T): void {
  const index = list.indexOf(value);
  if (index >= 0) {
    list.splice(index, 1);
  }
}

export function paint(level: LevelBuilder, style: RegionStyle): void {
  for (const r of level.rooms) {
    if (r.type !== RoomType.NULL) {
      placeDoors(level, r);
      const painter = PAINTERS.get(r.type);
      if (!painter) {
        throw new Error(`No painter for room type ${RoomType[r.type]}`);
      }
      painter(level, r);
    } else if (level.feeling === Feeling.CHASM && level.rng.int(2) === 0) {
      level.fillRect(r, T.WALL);
    }
  }
  for (const r of level.rooms) {
    paintDoors(level, style, r);
  }
}

function placeDoors(level: LevelBuilder, r: Room): void {
  for (const [n, existing] of r.connected) {
    if (existing) {
      continue;
    }
    const i = r.intersect(n);
    const door =
      i.width() === 0
        ? new Door(i.left, level.rng.intBetween(i.top + 1, i.bottom))
        : new Door(level.rng.intBetween(i.left + 1, i.right), i.top);
    r.connected.set(n, door);
    n.connected.set(r, door);
  }
}

function paintDoors(level: LevelBuilder, style: RegionStyle, r: Room): void {
  const { rng, depth } = level;
  for (const [n, d] of r.connected) {
    if (joinRooms(level, style, r, n)) {
      continue;
    }
    const door = cell(d!.x, d!.y);
    switch (d!.type) {
      case DoorType.EMPTY:
        level.set(door, T.EMPTY);
        break;
      case DoorType.TUNNEL:
        level.set(door, level.tunnelTile());
        break;
      case DoorType.REGULAR:
        if (depth <= 1) {
          level.set(door, T.DOOR);
        } else {
          const secret = (depth < 6 ? rng.int(12 - depth) : rng.int(6)) === 0;
          level.set(door, secret ? T.SECRET_DOOR : T.DOOR);
          if (secret) {
            level.secretDoors++;
          }
        }
        break;
      case DoorType.UNLOCKED:
        level.set(door, T.DOOR);
        break;
      case DoorType.HIDDEN:
        level.set(door, T.SECRET_DOOR);
        level.secretDoors++;
        break;
      case DoorType.BARRICADE:
        level.set(door, rng.int(3) === 0 ? T.BOOKSHELF : T.BARRICADE);
        break;
      case DoorType.LOCKED:
        level.set(door, T.LOCKED_DOOR);
        break;
    }
  }
}

/** Merges two adjacent standard rooms by knocking out the wall between them. */
function joinRooms(level: LevelBuilder, style: RegionStyle, r: Room, n: Room): boolean {
  if (r.type !== RoomType.STANDARD || n.type !== RoomType.STANDARD) {
    return false;
  }
  const w = r.intersect(n);
  if (w.left === w.right) {
    if (w.bottom - w.top < 3) return false;
    if (w.height() === Math.max(r.height(), n.height())) return false;
    if (r.width() + n.width() > style.maxRoomSize) return false;
    w.top += 1;
    w.right++;
    level.fill(w.left, w.top, 1, w.height(), T.EMPTY);
  } else {
    if (w.right - w.left < 3) return false;
    if (w.width() === Math.max(r.width(), n.width())) return false;
    if (r.height() + n.height() > style.maxRoomSize) return false;
    w.left += 1;
    w.bottom++;
    level.fill(w.left, w.top, w.width(), 1, T.EMPTY);
  }
  return true;
}

/** Cellular automaton: random seeding, then smoothing generations. */
export function patch(level: LevelBuilder, density: number, generations: number): boolean[] {
  let off = new Array<boolean>(LENGTH);
  let cur = new Array<boolean>(LENGTH).fill(false);
  for (let i = 0; i < LENGTH; i++) {
    off[i] = level.rng.float() < density;
  }
  for (let g = 0; g < generations; g++) {
    for (let y = 1; y < HEIGHT - 1; y++) {
      for (let x = 1; x < WIDTH - 1; x++) {
        const pos = x + y * WIDTH;
        let count = 0;
        for (const n of NEIGHBOURS8) {
          if (off[pos + n]) count++;
        }
        cur[pos] = off[pos] ? count >= 4 : count >= 5;
      }
    }
    [cur, off] = [off, cur];
  }
  return off;
}

export function paintWater(level: LevelBuilder, style: RegionStyle): void {
  const [density, generations] = style.water(level.feeling);
  const lake = patch(level, f32(density), generations);
  for (let i = 0; i < LENGTH; i++) {
    if (level.map[i] === T.EMPTY && lake[i]) {
      level.map[i] = T.WATER;
    }
  }
}

export function paintGrass(level: LevelBuilder, style: RegionStyle): void {
  const [density, generations] = style.grass(level.feeling);
  const grass = patch(level, f32(density), generations);

  if (level.feeling === Feeling.GRASS) {
    for (const room of level.rooms) {
      if (room.type !== RoomType.NULL && room.type !== RoomType.PASSAGE && room.type !== RoomType.TUNNEL) {
        grass[cell(room.left + 1, room.top + 1)] = true;
        grass[cell(room.right - 1, room.top + 1)] = true;
        grass[cell(room.left + 1, room.bottom - 1)] = true;
        grass[cell(room.right - 1, room.bottom - 1)] = true;
      }
    }
  }

  for (let i = WIDTH + 1; i < LENGTH - WIDTH - 1; i++) {
    if (level.map[i] === T.EMPTY && grass[i]) {
      let count = 1;
      for (const n of NEIGHBOURS8) {
        if (grass[i + n]) count++;
      }
      level.map[i] = level.rng.float() < f32(count / 12) ? T.HIGH_GRASS : T.GRASS;
    }
  }
}

const SECRET_TRAPS = [
  T.SECRET_TOXIC_TRAP, T.SECRET_FIRE_TRAP, T.SECRET_PARALYTIC_TRAP, T.SECRET_POISON_TRAP,
  T.SECRET_ALARM_TRAP, T.SECRET_LIGHTNING_TRAP, T.SECRET_GRIPPING_TRAP, T.SECRET_SUMMONING_TRAP,
];

export function placeTraps(level: LevelBuilder, style: RegionStyle): void {
  const { rng, depth } = level;
  const nTraps = depth <= 1 ? 0 : rng.intBetween(1, level.rooms.length + depth);
  for (let i = 0; i < nTraps; i++) {
    const pos = rng.int(LENGTH);
    if (level.map[pos] === T.EMPTY) {
      const kind = rng.chances(style.trapChances);
      level.map[pos] = SECRET_TRAPS[kind] ?? level.map[pos]!;
    }
  }
}
