import { describe, expect, it } from 'vitest';
import { createRun, generateLevel, T, WIDTH } from '../src/index';
import { F, terrainFlags } from '../src/level/terrain';
import type { GenLevel } from '../src/level/gen/genlevel';
import { DoorType, Room } from '../src/level/gen/room';
import { SECRET_ROOMS, type SecretRoom } from '../src/level/gen/rooms/secret/secret';
import { paintRoomAlone } from './levelgen-helpers';

/* The secret rooms (levels/rooms/secret), each painted on its own, and in whole levels. */

const KINDS = [...SECRET_ROOMS.keys()].filter((k) => k !== 'EmptySecretRoom');
const DEPTHS = [2, 4, 7, 12, 17, 22, 24];
const SIDES = ['left', 'top', 'right', 'bottom'] as const;

/** A maker whose rooms take the given size rather than rolling one. */
function sized(make: () => SecretRoom, w: number, h: number): () => SecretRoom {
  return () => {
    const room = make();
    const setSize = Room.prototype.setSize as (this: Room, a: number, b: number, c: number, d: number) => boolean;
    room.setSize = (() => setSize.call(room, w, w, h, h)) as Room['setSize'];
    return room;
  };
}

/** Everything the room put on the level lies inside its walls, and its door is hidden. */
function checkRoom(level: GenLevel, room: Room): void {
  const inside = (cell: number): boolean => room.inside(level.cellToPoint(cell));
  const doors = room.doors();
  expect(doors).toHaveLength(1);
  expect(doors[0]!.type).toBe(DoorType.HIDDEN);
  expect(level.map[level.pointToCell(doors[0]!)]).toBe(T.SECRET_DOOR);
  for (const cell of level.heaps.keys()) expect(inside(cell), `${room.kind}: heap at ${cell}`).toBe(true);
  for (const heap of level.heaps.values()) expect(heap.items.length).toBeGreaterThan(0);
  for (const mob of level.mobs) expect(inside(mob.pos), `${room.kind}: ${mob.kind}`).toBe(true);
  for (const cell of level.traps.keys()) expect(inside(cell)).toBe(true);
  for (const cell of level.plants.keys()) expect(inside(cell)).toBe(true);
  for (const blob of level.blobs) expect(inside(blob.cell), `${room.kind}: ${blob.kind}`).toBe(true);
  for (const tile of level.customTiles) {
    expect(tile.x >= room.left && tile.y >= room.top && tile.x + tile.w - 1 <= room.right && tile.y + tile.h - 1 <= room.bottom).toBe(true);
    expect(tile.data?.length).toBe(tile.w * tile.h);
  }
  // Nothing beyond the room was painted (the helper's level is wall outside the room but for the door).
  for (let cell = 0; cell < level.length; cell++) {
    const p = level.cellToPoint(cell);
    const inRect = p.x >= room.left && p.x <= room.right && p.y >= room.top && p.y <= room.bottom;
    if (!inRect) expect(level.map[cell], `${room.kind}: painted outside at ${p.x},${p.y}`).toBe(T.WALL);
  }
}

describe('secret rooms, each on its own', () => {
  it('registers every kind of Shattered, and the Rat King\'s room', () => {
    expect(KINDS.sort()).toEqual([
      'RatKingRoom', 'SecretArtilleryRoom', 'SecretChestChasmRoom', 'SecretGardenRoom', 'SecretHoardRoom', 'SecretHoneypotRoom',
      'SecretLaboratoryRoom', 'SecretLarderRoom', 'SecretLibraryRoom', 'SecretMazeRoom', 'SecretRunestoneRoom', 'SecretSummoningRoom',
      'SecretWellRoom',
    ]);
  });

  for (const kind of KINDS) {
    const make = SECRET_ROOMS.get(kind)!;

    it(`${kind}: paints at every depth, from every side, behind a hidden door`, () => {
      for (const depth of DEPTHS) {
        for (const side of SIDES) {
          for (let seed = 1; seed <= 4; seed++) {
            const { level, room } = paintRoomAlone(make, depth, [side], seed * 7 + depth);
            expect(room.kind).toBe(kind);
            checkRoom(level, room);
          }
        }
      }
    });

    it(`${kind}: paints at its smallest and largest`, () => {
      const probe = make();
      const ws = [probe.minWidth(), probe.maxWidth()];
      const hs = [probe.minHeight(), probe.maxHeight()];
      for (const w of ws) {
        for (const h of hs) {
          for (const side of SIDES) {
            for (const depth of [3, 13, 23]) {
              const { level, room } = paintRoomAlone(sized(make, w, h), depth, [side], w * 31 + h + depth);
              expect([room.width(), room.height()]).toEqual([w, h]);
              checkRoom(level, room);
            }
          }
        }
      }
    });
  }

  it('the well holds awareness or health; the laboratory an alchemy pot; the garden foliage throughout', () => {
    const waters = new Set<string>();
    for (let seed = 1; seed <= 20; seed++) {
      const { level } = paintRoomAlone(SECRET_ROOMS.get('SecretWellRoom')!, 6, ['left'], seed);
      const blob = level.blobs[0]!;
      expect(level.map[blob.cell]).toBe(T.WELL);
      waters.add(blob.kind);
    }
    expect([...waters].sort()).toEqual(['WaterOfAwareness', 'WaterOfHealth']);

    const lab = paintRoomAlone(SECRET_ROOMS.get('SecretLaboratoryRoom')!, 8, ['top'], 3).level;
    expect(lab.blobs.map((b) => b.kind)).toEqual(['Alchemy']);
    expect(lab.map[lab.blobs[0]!.cell]).toBe(T.ALCHEMY);
    expect(lab.heaps.size).toBeGreaterThanOrEqual(2);

    const { level: garden, room } = paintRoomAlone(SECRET_ROOMS.get('SecretGardenRoom')!, 8, ['top'], 3);
    expect(garden.blobs.filter((b) => b.kind === 'Foliage')).toHaveLength((room.width() - 2) * (room.height() - 2));
  });

  it('the hoard\'s traps are in sight, the summoning room\'s hidden under all its floor', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const hoard = paintRoomAlone(SECRET_ROOMS.get('SecretHoardRoom')!, seed + 2, ['left'], seed).level;
      for (const trap of hoard.traps.values()) {
        expect(['rockfall', 'disintegration', 'poisonDart']).toContain(trap.kind);
        expect(trap.visible).toBe(true);
        expect(hoard.map[trap.pos]).toBe(T.TRAP);
      }
      expect([...hoard.heaps.values()].every((h) => h.items[0]!.kind === 'gold')).toBe(true);

      const { level, room } = paintRoomAlone(SECRET_ROOMS.get('SecretSummoningRoom')!, seed + 2, ['right'], seed);
      expect(level.traps.size).toBe((room.width() - 2) * (room.height() - 2));
      for (const trap of level.traps.values()) {
        expect(trap.kind).toBe('summoning');
        expect(trap.visible).toBe(false);
        expect(level.map[trap.pos]).toBe(T.SECRET_TRAP);
      }
      expect([...level.heaps.values()].map((h) => h.kind)).toEqual(['skeleton']);
    }
  });

  it('the honeypot room has its bee by the broken pot; the maze its chest; the chasm keys for its chests', () => {
    const honey = paintRoomAlone(SECRET_ROOMS.get('SecretHoneypotRoom')!, 9, ['bottom'], 2).level;
    expect(honey.mobs.map((m) => m.kind)).toEqual(['bee']);
    expect(honey.mobs[0]!.level).toBe(9);
    expect([...honey.heaps.values()].map((h) => h.items[0]!.kind).sort()).toEqual(['bomb', 'honeypot', 'honeypot.shattered']);

    for (let seed = 1; seed <= 5; seed++) {
      const maze = paintRoomAlone(SECRET_ROOMS.get('SecretMazeRoom')!, 12, ['left'], seed).level;
      const chests = [...maze.heaps.values()].filter((h) => h.kind === 'chest');
      expect(chests).toHaveLength(1);
      expect(chests[0]!.items[0]!.cursed).toBe(false);
      expect(terrainFlags[maze.map[chests[0]!.pos]!]! & F.PASSABLE).not.toBe(0);

      const chasm = paintRoomAlone(SECRET_ROOMS.get('SecretChestChasmRoom')!, 12, ['top'], seed).level;
      const heaps = [...chasm.heaps.values()];
      const locked = heaps.filter((h) => h.kind === 'lockedChest').length;
      const keys = heaps.filter((h) => h.items[0]!.kind === 'key.golden').length;
      expect(locked).toBe(4);
      expect(keys).toBe(locked);
      expect(chasm.itemsToSpawn.map((i) => i.kind)).toContain('potion.levitation');
    }
  });

  it('the Rat King sits on his pillow among his statues and his gold', () => {
    for (const side of SIDES) {
      const { level, room } = paintRoomAlone(SECRET_ROOMS.get('RatKingRoom')!, 5, [side], 4);
      const center = level.pointToCell(room.center());
      expect(level.mobs).toEqual([{ kind: 'ratKing', pos: center, state: 'passive' }]);
      expect(level.customTiles.map((t) => t.kind)).toEqual(['RatKingStatues', 'Carpet', 'RatKingRoomDeco', 'StatueOverhang']);
      const statues = level.map.filter((t) => t === T.CUSTOM_DECO).length;
      // Eight places for statues, but those beside the door.
      expect(statues).toBeGreaterThanOrEqual(6);
      expect(statues).toBeLessThan(8);
      // Gold on every floor cell but the king's.
      expect(level.heaps.size).toBe(25 - 1 - statues);
      expect(level.heaps.has(center)).toBe(false);
    }
  });
});

describe('secret rooms in whole levels', () => {
  it('levels of depths 2-24 are made with their secret rooms, every kind among them', () => {
    const seen = new Map<string, number>();
    for (let seed = 1; seed <= 10; seed++) {
      const run = createRun(seed * 1009);
      for (let depth = 2; depth <= 24; depth++) {
        if (depth % 5 === 0) continue;
        const level = generateLevel(run, depth);
        for (const room of level.rooms) {
          if (room.group !== 'secret') continue;
          seen.set(room.kind!, (seen.get(room.kind!) ?? 0) + 1);
          // Its one way in is a hidden door (corners aside, no other cell of its walls can be walked through).
          let hidden = 0;
          for (let x = room.left; x <= room.right; x++) {
            for (let y = room.top; y <= room.bottom; y++) {
              const edge = x === room.left || x === room.right || y === room.top || y === room.bottom;
              const corner = (x === room.left || x === room.right) && (y === room.top || y === room.bottom);
              if (!edge || corner) continue;
              const t = level.map[x + y * WIDTH]!;
              if (t === T.SECRET_DOOR) hidden++;
              else expect((terrainFlags[t]! & F.PASSABLE) === 0, `${room.kind} at depth ${depth}: ${t} at ${x},${y}`).toBe(true);
            }
          }
          expect(hidden, `${room.kind} at depth ${depth}`).toBe(1);
        }
      }
    }
    expect(seen.has('EmptySecretRoom')).toBe(false);
    expect([...seen.keys()].sort()).toEqual(KINDS.filter((k) => k !== 'RatKingRoom').sort());
  });
});
