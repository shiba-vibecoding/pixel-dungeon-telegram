import type { LevelBuilder } from './builder';
import type { BossArt } from './generate';
import { cell, LENGTH, Rect, WIDTH } from './geometry';
import { PAINTERS } from './painters';
import { paint, paintGrass, paintWater, type RegionStyle, split } from './regular';
import { buildDistanceMap, buildPath, type Door, DoorType, Room, RoomType } from './room';
import { SEWER_STYLE } from './sewer';
import { T } from './terrain';

/*
 * Depth 5: Goo's lair (SewerBossLevel). Shattered builds it with its
 * FigureEightBuilder around Goo's room; until the levels stream brings the
 * builders, the classic split into rooms is laid around a room of Goo's
 * size, with the way from the stairs to the way down passing through it.
 * Shattered's rooms are painted as they are: the stairs' room under a row of
 * drains (SewerBossEntranceRoom), one of the four Goo rooms (diamond, walled,
 * thin or thick pillars) with its nest of murky water in the middle, the way
 * down behind a wall (SewerBossExitRoom), and the Rat King's hidden room.
 */

export const SEWER_BOSS_STYLE: RegionStyle = {
  ...SEWER_STYLE,
  water: () => [0.5, 5],
  grass: () => [0.2, 4],
  decorate: decorateSewerBoss,
};

/** The Shattered sizes (walls included) of a room. */
const sw = (r: Room): number => r.right - r.left + 1;
const sh = (r: Room): number => r.bottom - r.top + 1;

function fill(level: LevelBuilder, x: number, y: number, w: number, h: number, value: number): void {
  for (let row = y; row < y + h; row++) for (let col = x; col < x + w; col++) level.setXY(col, row, value);
}

/** Room.center: its middle, a random one of the two for an even span. */
function center(level: LevelBuilder, r: Room): { x: number; y: number } {
  return {
    x: Math.trunc((r.left + r.right) / 2) + ((r.right - r.left) % 2 === 1 ? level.rng.int(2) : 0),
    y: Math.trunc((r.top + r.bottom) / 2) + ((r.bottom - r.top) % 2 === 1 ? level.rng.int(2) : 0),
  };
}

const doorsOf = (r: Room): Door[] => r.doors();

/** SewerBossEntranceRoom.paint: drains along the top wall, water under them, the stairs somewhere inside. */
function paintEntrance(level: LevelBuilder, r: Room): void {
  level.fillRect(r, T.WALL);
  level.fillRect(r, T.EMPTY, 1);
  fill(level, r.left + 1, r.top + 1, sw(r) - 2, 1, T.WALL_DECO);
  fill(level, r.left + 1, r.top + 2, sw(r) - 2, 1, T.WATER);
  let entrance: number;
  do entrance = r.random(level.rng, 2); while (level.map[entrance] !== T.EMPTY && level.map[entrance] !== T.WATER);
  level.set(entrance, T.ENTRANCE);
  level.entrance = entrance;
  for (const door of doorsOf(r)) {
    door.set(DoorType.REGULAR);
    if (door.y === r.top || door.y === r.top + 1) level.drawInside(r, door, 1, T.WATER);
  }
}

/** SewerBossExitRoom.paint: the way down in a block of wall in the middle, locked. */
function paintExit(level: LevelBuilder, r: Room, art: BossArt[]): void {
  level.fillRect(r, T.WALL);
  level.fillRect(r, T.EMPTY, 1);
  for (const door of doorsOf(r)) door.set(DoorType.REGULAR);
  const c = center(level, r);
  fill(level, c.x - 1, c.y - 1, 3, 2, T.WALL);
  fill(level, c.x - 1, c.y + 1, 3, 1, T.EMPTY_SP);
  level.exit = cell(c.x, c.y);
  level.set(level.exit, T.LOCKED_EXIT);
  // SewerExit and SewerExitOverhang (sewer_boss.png).
  art.push({ sheet: 'sewer_boss', x: c.x - 1, y: c.y, w: 3, tiles: [21, -1, 22, 23, 23, 23, 24, 24, 24], layer: 'ground' });
  art.push({ sheet: 'sewer_boss', x: c.x - 1, y: c.y - 2, w: 3, tiles: [16, 17, 18, 19, -1, 20], layer: 'wall' });
}

/** PerimeterRoom.fillPerimiterPaths: paths round the inside of the walls joining the doors. */
function fillPerimeterPaths(level: LevelBuilder, r: Room, floor: number): void {
  const toFill = doorsOf(r).map((door) => {
    const p = { x: door.x, y: door.y };
    if (p.y === r.top) p.y++;
    else if (p.y === r.bottom) p.y--;
    else if (p.x === r.left) p.x++;
    else p.x--;
    return p;
  });
  if (toFill.length === 0) return;
  const space = (a: number, b: number): number => Math.abs(a - b) - 1;
  const between = (a: { x: number; y: number }, b: { x: number; y: number }): number => {
    if (((a.x === r.left + 1 || a.x === r.right - 1) && a.y === b.y) || ((a.y === r.top + 1 || a.y === r.bottom - 1) && a.x === b.x)) {
      return Math.max(space(a.x, b.x), space(a.y, b.y));
    }
    return Math.min(space(r.left, a.x) + space(r.left, b.x), space(r.right, a.x) + space(r.right, b.x)) +
      Math.min(space(r.top, a.y) + space(r.top, b.y), space(r.bottom, a.y) + space(r.bottom, b.y)) - 1;
  };
  const line = (a: { x: number; y: number }, b: { x: number; y: number }): void => {
    for (let x = Math.min(a.x, b.x); x <= Math.max(a.x, b.x); x++) for (let y = Math.min(a.y, b.y); y <= Math.max(a.y, b.y); y++) level.setXY(x, y, floor);
  };
  const corners = [{ x: r.left + 1, y: r.top + 1 }, { x: r.right - 1, y: r.top + 1 }, { x: r.right - 1, y: r.bottom - 1 }, { x: r.left + 1, y: r.bottom - 1 }];
  const fillBetween = (from: { x: number; y: number }, to: { x: number; y: number }): void => {
    if (((from.x === r.left + 1 || from.x === r.right - 1) && from.x === to.x) || ((from.y === r.top + 1 || from.y === r.bottom - 1) && from.y === to.y)) {
      fill(level, Math.min(from.x, to.x), Math.min(from.y, to.y), space(from.x, to.x) + 2, space(from.y, to.y) + 2, floor);
      return;
    }
    for (const c of corners) {
      if ((c.x === from.x || c.y === from.y) && (c.x === to.x || c.y === to.y)) {
        line(from, c);
        line(c, to);
        return;
      }
    }
    let side: { x: number; y: number };
    if (from.y === r.top + 1 || from.y === r.bottom - 1) {
      side = space(r.left, from.x) + space(r.left, to.x) <= space(r.right, from.x) + space(r.right, to.x)
        ? { x: r.left + 1, y: r.top + Math.trunc(sh(r) / 2) } : { x: r.right - 1, y: r.top + Math.trunc(sh(r) / 2) };
    } else {
      side = space(r.top, from.y) + space(r.top, to.y) <= space(r.bottom, from.y) + space(r.bottom, to.y)
        ? { x: r.left + Math.trunc(sw(r) / 2), y: r.top + 1 } : { x: r.left + Math.trunc(sw(r) / 2), y: r.bottom - 1 };
    }
    fillBetween(from, side);
    fillBetween(side, to);
  };
  const filled = [toFill.shift()!];
  while (toFill.length > 0) {
    let best = Infinity;
    let from = filled[0]!;
    let to = toFill[0]!;
    for (const f of filled) {
      for (const t of toFill) {
        const d = between(f, t);
        if (d < best) {
          best = d;
          from = f;
          to = t;
        }
      }
    }
    fillBetween(from, to);
    filled.push(to);
    toFill.splice(toFill.indexOf(to), 1);
  }
}

/** GooBossRoom.randomGooRoom, painted: one of four rooms, the murky nest in its middle. */
function paintGooRoom(level: LevelBuilder, r: Room, art: BossArt[]): void {
  const W = sw(r);
  const H = sh(r);
  const variant = level.rng.int(4);
  level.fillRect(r, T.WALL);
  if (variant === 0) {
    // DiamondGooRoom.
    const x = r.left + 1;
    const y = r.top + 1;
    const w = W - 2;
    const h = H - 2;
    let dw = Math.max(w - (h - 2 - (h % 2)), w % 2 === 0 ? 2 : 3);
    for (let i = 0; i <= h; i++) {
      fill(level, x + Math.trunc((w - dw) / 2), y + i, dw, h - 2 * i, T.EMPTY);
      dw += 2;
      if (dw > w) break;
    }
    for (const door of doorsOf(r)) {
      door.set(DoorType.REGULAR);
      const dir = door.x === r.left ? [1, 0] : door.y === r.top ? [0, 1] : door.x === r.right ? [-1, 0] : [0, -1];
      const cur = { x: door.x, y: door.y };
      do {
        level.setXY(cur.x, cur.y, T.EMPTY_SP);
        cur.x += dir[0]!;
        cur.y += dir[1]!;
      } while (level.map[cell(cur.x, cur.y)] === T.WALL);
    }
    nestWater(level, r);
  } else if (variant === 1) {
    // WalledGooRoom.
    level.fillRect(r, T.EMPTY_SP, 1);
    level.fillRect(r, T.EMPTY, 2);
    const pw = Math.trunc((W - 6) / 2);
    const ph = Math.trunc((H - 6) / 2);
    fill(level, r.left + 2, r.top + 2, pw, 1, T.WALL);
    fill(level, r.left + 2, r.top + 2, 1, ph, T.WALL);
    fill(level, r.left + 2, r.bottom - 2, pw, 1, T.WALL);
    fill(level, r.left + 2, r.bottom - 1 - ph, 1, ph, T.WALL);
    fill(level, r.right - 1 - pw, r.top + 2, pw, 1, T.WALL);
    fill(level, r.right - 2, r.top + 2, 1, ph, T.WALL);
    fill(level, r.right - 1 - pw, r.bottom - 2, pw, 1, T.WALL);
    fill(level, r.right - 2, r.bottom - 1 - ph, 1, ph, T.WALL);
    for (const door of doorsOf(r)) door.set(DoorType.REGULAR);
    nestWater(level, r);
  } else if (variant === 2) {
    // ThinPillarsGooRoom.
    level.fillRect(r, T.WATER, 1);
    const pw = (W === 14 ? 4 : 2) + (W % 2);
    const ph = (H === 14 ? 4 : 2) + (H % 2);
    if (H < 12) {
      fill(level, r.left + Math.trunc((W - pw) / 2), r.top + 2, pw, 1, T.WALL);
      fill(level, r.left + Math.trunc((W - pw) / 2), r.bottom - 2, pw, 1, T.WALL);
    } else {
      fill(level, r.left + Math.trunc((W - pw) / 2), r.top + 3, pw, 1, T.WALL);
      fill(level, r.left + Math.trunc((W - pw) / 2), r.bottom - 3, pw, 1, T.WALL);
    }
    if (W < 12) {
      fill(level, r.left + 2, r.top + Math.trunc((H - ph) / 2), 1, ph, T.WALL);
      fill(level, r.right - 2, r.top + Math.trunc((H - ph) / 2), 1, ph, T.WALL);
    } else {
      fill(level, r.left + 3, r.top + Math.trunc((H - ph) / 2), 1, ph, T.WALL);
      fill(level, r.right - 3, r.top + Math.trunc((H - ph) / 2), 1, ph, T.WALL);
    }
    fillPerimeterPaths(level, r, T.EMPTY_SP);
    for (const door of doorsOf(r)) door.set(DoorType.REGULAR);
  } else {
    // ThickPillarsGooRoom.
    level.fillRect(r, T.WATER, 1);
    const pw = Math.trunc((W - 8) / 2);
    const ph = Math.trunc((H - 8) / 2);
    fill(level, r.left + 2, r.top + 2, pw + 1, ph + 1, T.WALL);
    fill(level, r.left + 2, r.bottom - 2 - ph, pw + 1, ph + 1, T.WALL);
    fill(level, r.right - 2 - pw, r.top + 2, pw + 1, ph + 1, T.WALL);
    fill(level, r.right - 2 - pw, r.bottom - 2 - ph, pw + 1, ph + 1, T.WALL);
    fillPerimeterPaths(level, r, T.EMPTY_SP);
    for (const door of doorsOf(r)) door.set(DoorType.REGULAR);
  }
  // GooBossRoom.setupGooNest: the nest's art over the middle of the room.
  const nest = { x: r.left + Math.trunc(W / 2) - 2, y: r.top + Math.trunc(H / 2) - 2, w: 4 + (W % 2), h: 4 + (H % 2) };
  const tiles: number[] = [];
  for (let y = 0; y < nest.h; y++) {
    for (let x = 0; x < nest.w; x++) {
      const last = { x: nest.w - 1, y: nest.h - 1 };
      tiles.push(
        (x === 0 || x === last.x) && (y === 0 || y === last.y) ? -1
        : (x === 1 && y === 0) || (x === 0 && y === 1) ? 0
        : (x === last.x - 1 && y === 0) || (x === last.x && y === 1) ? 1
        : (x === 1 && y === last.y) || (x === 0 && y === last.y - 1) ? 2
        : (x === last.x - 1 && y === last.y) || (x === last.x && y === last.y - 1) ? 3
        : x === 0 ? 4 : y === 0 ? 5 : x === last.x ? 6 : y === last.y ? 7 : 8,
      );
    }
  }
  art.push({ sheet: 'sewer_boss', x: nest.x, y: nest.y, w: nest.w, tiles, layer: 'ground' });
  level.boss = { ...(level.boss ?? {}), nest, gooRoom: { left: r.left, top: r.top, right: r.right, bottom: r.bottom } };
}

/** The murky water of Goo's nest, a cross in the room's middle. */
function nestWater(level: LevelBuilder, r: Room): void {
  const W = sw(r);
  const H = sh(r);
  fill(level, r.left + Math.trunc(W / 2) - 1, r.top + Math.trunc(H / 2) - 2, 2 + (W % 2), 4 + (H % 2), T.WATER);
  fill(level, r.left + Math.trunc(W / 2) - 2, r.top + Math.trunc(H / 2) - 1, 4 + (W % 2), 2 + (H % 2), T.WATER);
}

/** SewerBossLevel.build. */
export function buildSewerBossLevel(level: LevelBuilder): boolean {
  const { rng } = level;
  const span = level.span;
  // GooBossRoom: a large room, 10 to 14 cells a side (walls included).
  const gw = rng.intRange(10, 14) - 1;
  const gh = rng.intRange(10, 14) - 1;
  const gx = rng.intRange(7, span - 1 - gw - 7);
  const gy = rng.intRange(4, span - 1 - gh - 4);
  const goo = new Room();
  goo.set(gx, gy, gx + gw, gy + gh);
  level.rooms = [];
  split(level, SEWER_BOSS_STYLE, new Rect(0, 0, gx, span - 1));
  const left = [...level.rooms];
  split(level, SEWER_BOSS_STYLE, new Rect(gx + gw, 0, span - 1, span - 1));
  const right = level.rooms.filter((r) => !left.includes(r));
  if (gy >= 4) split(level, SEWER_BOSS_STYLE, new Rect(gx, 0, gx + gw, gy));
  if (span - 1 - (gy + gh) >= 4) split(level, SEWER_BOSS_STYLE, new Rect(gx, gy + gh, gx + gw, span - 1));
  level.rooms.push(goo);
  const rooms = level.rooms;
  for (let i = 0; i < rooms.length - 1; i++) for (let j = i + 1; j < rooms.length; j++) rooms[i]!.addNeighbour(rooms[j]!);

  // The stairs on one side of Goo, the way down on the other.
  const [entranceSide, exitSide] = rng.int(2) === 0 ? [left, right] : [right, left];
  const entrances = entranceSide.filter((r) => sw(r) >= 7 && sh(r) >= 7);
  const exits = exitSide.filter((r) => sw(r) >= 8 && sh(r) >= 8);
  if (entrances.length === 0 || exits.length === 0) return false;
  const roomEntrance = rng.element(entrances)!;
  const roomExit = rng.element(exits)!;
  // From the stairs to Goo, kept to their side; then from Goo to the way down, on the other.
  for (const r of rooms) r.price = exitSide.includes(r) ? 1000 : 1;
  buildDistanceMap(rooms, goo);
  const first = buildPath(roomEntrance, goo);
  if (!first) return false;
  for (const r of rooms) r.price = entranceSide.includes(r) || first.includes(r) ? 1000 : 1;
  goo.price = 1;
  buildDistanceMap(rooms, roomExit);
  const second = buildPath(goo, roomExit);
  if (!second || second.some((r) => first.includes(r) && r !== goo) || second.some((r) => entranceSide.includes(r))) return false;
  let room = roomEntrance;
  for (const next of [...first, ...second]) {
    room.connect(next);
    room = next;
  }
  // Goo's room is never entered through more than its two ways (the paths may not touch it elsewhere).
  roomEntrance.type = RoomType.ENTRANCE;
  roomExit.type = RoomType.EXIT;
  goo.type = RoomType.BOSS_EXIT;
  level.roomEntrance = roomEntrance;
  level.roomExit = roomExit;
  for (const r of rooms) {
    if (r.type === RoomType.NULL && r.connected.size > 0) r.type = r.width() >= 4 && r.height() >= 4 && rng.int(2) === 0 ? RoomType.STANDARD : RoomType.TUNNEL;
  }
  // RatKingRoom: a secret room off the way, a neighbour of a room on it.
  const onWay = rooms.filter((r) => r.connected.size > 0 && r !== goo && r !== roomExit);
  const candidates = rooms.filter((r) => r.type === RoomType.NULL && r.width() >= 4 && r.height() >= 4 && r.neighbours.some((n) => onWay.includes(n)));
  if (candidates.length > 0) {
    const kings = rng.element(candidates)!;
    kings.connect(rng.element(kings.neighbours.filter((n) => onWay.includes(n)))!);
    kings.type = RoomType.RAT_KING;
  }

  // The rooms are painted as the original's, but for the three of the boss level, painted over afterwards.
  const own = [roomEntrance, roomExit, goo];
  for (const r of own) r.type = RoomType.STANDARD;
  paint(level, SEWER_BOSS_STYLE);
  paintWater(level, SEWER_BOSS_STYLE);
  paintGrass(level, SEWER_BOSS_STYLE);
  roomEntrance.type = RoomType.ENTRANCE;
  roomExit.type = RoomType.EXIT;
  goo.type = RoomType.BOSS_EXIT;
  const doors = new Map<number, number>();
  for (const r of own) for (const d of r.doors()) doors.set(cell(d.x, d.y), level.map[cell(d.x, d.y)]!);
  const art: BossArt[] = [];
  paintEntrance(level, roomEntrance);
  paintExit(level, roomExit, art);
  paintGooRoom(level, goo, art);
  // Their doors are plain doors: nothing hidden on the way to Goo (only the Rat King's is a secret).
  for (const [pos, terrain] of doors) level.set(pos, terrain === T.SECRET_DOOR ? T.DOOR : terrain);
  for (let i = 0; i < LENGTH; i++) {
    if (level.map[i] === T.SECRET_DOOR && !rooms.some((r) => r.type === RoomType.RAT_KING && onEdge(r, i))) level.map[i] = T.DOOR;
  }
  level.secretDoors = 0;
  level.boss = { ...(level.boss ?? {}), art };
  return true;
}

const onEdge = (r: Room, pos: number): boolean => {
  const x = pos % WIDTH;
  const y = Math.trunc(pos / WIDTH);
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom && (x === r.left || x === r.right || y === r.top || y === r.bottom);
};

/** SewerPainter.decorate, with no sign by the stairs: drains above water, moss in the corners. */
function decorateSewerBoss(level: LevelBuilder): void {
  const { map, rng } = level;
  for (let i = 0; i < WIDTH; i++) {
    if (map[i] === T.WALL && map[i + WIDTH] === T.WATER && rng.int(4) === 0) map[i] = T.WALL_DECO;
  }
  for (let i = WIDTH; i < LENGTH - WIDTH; i++) {
    if (map[i] === T.WALL && map[i - WIDTH] === T.WALL && map[i + WIDTH] === T.WATER && rng.int(2) === 0) map[i] = T.WALL_DECO;
  }
  for (let i = WIDTH + 1; i < LENGTH - WIDTH - 1; i++) {
    if (map[i] !== T.EMPTY) continue;
    const count = [1, -1, WIDTH, -WIDTH].filter((n) => map[i + n] === T.WALL).length;
    if (rng.int(16) < count * count) map[i] = T.EMPTY_DECO;
  }
}

void PAINTERS;
