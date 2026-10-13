import { describe, expect, it } from 'vitest';
import { createItem, createRun, deriveSeed, generateLevel, type Item, Rng, type RunState, T, WIDTH, type World } from '../src/index';
import { F, terrainFlags } from '../src/level/terrain';
import { Dungeon } from '../src/level/gen/dungeon';
import type { GenLevel } from '../src/level/gen/genlevel';
import { Painter } from '../src/level/gen/painter';
import { Random } from '../src/level/gen/random';
import { DoorType } from '../src/level/gen/room';
import { SPECIAL_ROOMS } from '../src/level/gen/rooms/special/special';
import { chooseBag, generateShopItems, ImpShopRoom, ShopRoom } from '../src/level/gen/rooms/special/shop';
import { generating, paintRoomAlone } from './levelgen-helpers';

const KINDS = [
  'ArmoryRoom', 'CryptRoom', 'CrystalChoiceRoom', 'CrystalPathRoom', 'CrystalVaultRoom', 'DemonSpawnerRoom', 'GardenRoom',
  'LaboratoryRoom', 'LibraryRoom', 'MagicWellRoom', 'MagicalFireRoom', 'PitRoom', 'PoolRoom', 'RunestoneRoom', 'SacrificeRoom',
  'SentryRoom', 'ShopRoom', 'StatueRoom', 'StorageRoom', 'ToxicGasRoom', 'TrapsRoom', 'TreasuryRoom', 'WeakFloorRoom',
];
const SIDES = ['left', 'top', 'right', 'bottom'] as const;
const DEPTHS = [2, 4, 7, 9, 12, 14, 17, 19, 22, 24];

const flags = (level: GenLevel, cell: number): number => terrainFlags[level.map[cell]!]!;
/** Somewhere one can step (Level.passable or avoid, but not a chasm). */
const walkable = (level: GenLevel, cell: number): boolean => (flags(level, cell) & F.PASSABLE) !== 0 ||
  ((flags(level, cell) & F.AVOID) !== 0 && (flags(level, cell) & F.PIT) === 0);

/** Level generation code run for a depth of a run, with a world (or none). */
function withWorld<R>(depth: number, run: RunState, world: World | null, fn: () => R): R {
  return Random.using(Rng.seeded(deriveSeed(run.seed, 99, depth)), () => Dungeon.generating({ depth, branch: 0, run, world }, fn));
}

/** A world whose first hero carries these items. */
const worldWith = (items: Item[]): World => ({ heroes: [{ items }], challenges: 0 }) as unknown as World;

const wareCount = (wares: Array<Item | null>): number => wares.filter((w) => w !== null).length;

/** Cells reachable from a cell (8-way, as heroes walk): floor, traps, and doors of every sort. */
const DOORS: ReadonlySet<number> = new Set([T.LOCKED_DOOR, T.CRYSTAL_DOOR, T.BARRICADE, T.SECRET_DOOR]);
function reachFrom(map: readonly number[], from: number): boolean[] {
  const reached = new Array<boolean>(map.length).fill(false);
  const ok = (c: number): boolean => {
    const f = terrainFlags[map[c]!]!;
    return (f & F.PASSABLE) !== 0 || ((f & F.AVOID) !== 0 && (f & F.PIT) === 0) || DOORS.has(map[c]!);
  };
  const queue = [from];
  reached[from] = true;
  for (let head = 0; head < queue.length; head++) {
    const c = queue[head]!;
    for (const n of [-WIDTH - 1, -WIDTH, -WIDTH + 1, -1, 1, WIDTH - 1, WIDTH, WIDTH + 1]) {
      const next = c + n;
      if (next < 0 || next >= map.length || reached[next] || !ok(next)) continue;
      reached[next] = true;
      queue.push(next);
    }
  }
  return reached;
}

describe('special rooms painted alone', () => {
  it('registers every special room under its Shattered name', () => {
    for (const kind of [...KINDS, 'ImpShopRoom']) {
      const make = SPECIAL_ROOMS.get(kind);
      expect(make, kind).toBeDefined();
      expect(make!().kind).toBe(kind);
    }
  });

  for (const kind of KINDS) {
    it(`${kind}: paints, with a way in and its items inside`, () => {
      let n = 0;
      for (const depth of DEPTHS) {
        for (const side of SIDES) {
          const seed = depth * 7 + n++;
          const { level, room } = paintRoomAlone(() => SPECIAL_ROOMS.get(kind)!(), depth, [side], seed);
          const door = room.doors()[0]!;
          expect(room.doors().length).toBe(1);

          // The door is put in (its own sort: locked, crystal, barricade...), and inside it one can step,
          // but past the traps room's chasm, which takes levitation.
          expect(level.map[level.pointToCell(door)], `${kind} door`).not.toBe(T.WALL);
          if (kind === 'SacrificeRoom') expect(door.type).toBe(DoorType.EMPTY);
          else expect(door.type).not.toBe(DoorType.EMPTY);
          const inside = level.pointToCell(room.pointInside(door, 1));
          if (!(kind === 'TrapsRoom' && level.map[inside] === T.CHASM)) {
            expect(walkable(level, inside), `${kind} at depth ${depth}, door on the ${side}`).toBe(true);
          }

          for (const heap of level.heaps.values()) {
            expect(room.inside(level.cellToPoint(heap.pos)), `${kind} heap`).toBe(true);
            expect(heap.items.length).toBeGreaterThan(0);
          }
          for (const mob of level.mobs) expect(room.inside(level.cellToPoint(mob.pos)), `${kind} mob`).toBe(true);
          for (const blob of level.blobs) expect(room.inside(level.cellToPoint(blob.cell)), `${kind} blob`).toBe(true);
        }
      }
    });
  }

  it('keys: the locked rooms want an iron key, the crystal rooms crystal keys', () => {
    const { level } = paintRoomAlone(() => SPECIAL_ROOMS.get('ArmoryRoom')!(), 3, ['left']);
    expect(level.itemsToSpawn.some((i) => i.kind === 'key.iron' && i.depth === 3)).toBe(true);
    const path = paintRoomAlone(() => SPECIAL_ROOMS.get('CrystalPathRoom')!(), 8, ['top']).level;
    expect(path.itemsToSpawn.filter((i) => i.kind === 'key.crystal' && i.depth === 8).length).toBe(3);
    const pit = paintRoomAlone(() => SPECIAL_ROOMS.get('PitRoom')!(), 8, ['top']);
    expect(pit.room.doors()[0]!.type).toBe(DoorType.CRYSTAL);
    expect([...pit.level.heaps.values()].some((h) => h.kind === 'skeleton' && h.items.some((i) => i.kind === 'key.crystal'))).toBe(true);
  });

  it('the hazard rooms: piranhas, a sentry, gas and vents, eternal fire, a sacrificial fire with its prize', () => {
    const pool = paintRoomAlone(() => SPECIAL_ROOMS.get('PoolRoom')!(), 7, ['left']).level;
    expect(pool.mobs.length).toBe(3);
    for (const m of pool.mobs) expect(pool.map[m.pos]).toBe(T.WATER);

    const sentry = paintRoomAlone(() => SPECIAL_ROOMS.get('SentryRoom')!(), 7, ['left']);
    const s = sentry.level.mobs[0] as unknown as { kind: string; initialChargeDelay: number; room: { left: number } };
    expect(s.kind).toBe('sentry');
    expect(s.initialChargeDelay).toBeGreaterThan(0);
    expect(s.room.left).toBe(sentry.room.left);
    expect(sentry.level.map[sentry.level.mobs[0]!.pos]).toBe(T.PEDESTAL);

    const gas = paintRoomAlone(() => SPECIAL_ROOMS.get('ToxicGasRoom')!(), 7, ['left']);
    const vents = [...gas.level.traps.values()].filter((t) => t.kind === 'toxicVent');
    expect(vents.length).toBe(Math.min(gas.room.width() - 2, gas.room.height() - 2));
    for (const v of vents) {
      expect(gas.level.map[v.pos]).toBe(T.INACTIVE_TRAP);
      expect(v.active).toBe(false);
      expect(gas.level.blobs.some((b) => b.kind === 'ToxicGasSeed' && b.cell === v.pos && b.amount === 12)).toBe(true);
    }
    expect(gas.level.blobs.some((b) => b.kind === 'ToxicGas' && b.amount === 30)).toBe(true);

    const fire = paintRoomAlone(() => SPECIAL_ROOMS.get('MagicalFireRoom')!(), 7, ['top']).level;
    expect(fire.blobs.filter((b) => b.kind === 'EternalFire').length).toBeGreaterThan(4);

    const altar = paintRoomAlone(() => SPECIAL_ROOMS.get('SacrificeRoom')!(), 7, ['top']).level;
    const sacrificial = altar.blobs.find((b) => b.kind === 'SacrificialFire') as { amount: number; prize?: Item } | undefined;
    expect(sacrificial?.amount).toBe(6 + 7 * 4);
    expect(sacrificial?.prize?.cursed).toBe(true);
  });

  it('the weak floor and the demon spawner lay their custom tiles', () => {
    const weak = paintRoomAlone(() => SPECIAL_ROOMS.get('WeakFloorRoom')!(), 12, ['left']).level;
    expect(weak.customTiles).toMatchObject([{ kind: 'WeakFloorRoom.HiddenWell', texture: 'weak_floor', w: 1, h: 1, data: [2] }]);
    expect(weak.blobs.some((b) => b.kind === 'WellID')).toBe(true);

    const demon = paintRoomAlone(() => SPECIAL_ROOMS.get('DemonSpawnerRoom')!(), 22, ['left']);
    const tile = demon.level.customTiles[0]!;
    expect(tile.kind).toBe('DemonSpawnerRoom.CustomFloor');
    expect(tile.w).toBe(demon.room.width() - 2);
    expect(tile.data!.length).toBe(tile.w * tile.h);
    expect(tile.data!.filter((d) => d === 37 || d === 38 || d === 39).length).toBe(3);
    expect(JSON.parse(JSON.stringify(tile)).data).toEqual(tile.data);
  });
});

describe('shops', () => {
  it('stock 19 wares at 6, 11 and 16 (20 with the alchemize spell to come), and the imp 22 at 20', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      for (const [depth, count] of [[6, 19], [11, 19], [16, 19], [20, 22]] as const) {
        const run = createRun(seed);
        const wares = withWorld(depth, run, null, () => generateShopItems());
        // Leather/mail/scale/plate armour, a weapon, thrown weapons, darts, (alchemize), a bag, eleven consumables,
        // a bomb or honeypot, an ankh, a stone of augmentation and something rare; the imp adds three torches.
        expect(wares.length).toBe(count + 1);
        expect(wareCount(wares)).toBe(count);
        expect(wares.some((w) => w?.kind.startsWith('bag.'))).toBe(true);
        expect(wares.filter((w) => w?.kind === 'torch').length).toBe(depth === 20 ? 3 : 0);
      }
    }
  });

  it('lays every ware out for sale, the shopkeeper in the middle', () => {
    for (const depth of [6, 11, 16]) {
      for (const side of SIDES) {
        const { level, room } = paintRoomAlone(() => new ShopRoom(), depth, [side], depth);
        const forSale = [...level.heaps.values()].filter((h) => h.kind === 'forSale');
        expect(forSale.length).toBe(19);
        for (const h of forSale) expect(room.inside(level.cellToPoint(h.pos))).toBe(true);
        expect(level.mobs).toMatchObject([{ kind: 'shopkeeper', state: 'passive' }]);
        expect(level.heaps.has(level.mobs[0]!.pos)).toBe(false);
      }
    }
  });

  it("the imp's shop decides its wares at once and lays them out when it opens", () => {
    const { level, room } = paintRoomAlone(() => new ImpShopRoom(), 20, ['bottom'], 20);
    expect(room.width()).toBe(9);
    expect(level.heaps.size).toBe(0);
    const shop = room as ImpShopRoom;
    expect(wareCount(shop.wares())).toBe(22);
    generating(20, () => {
      Painter.fill(level, room, 1, T.EMPTY_SP);
      Painter.set(level, room.left + 4, room.top + 4, T.PEDESTAL);
      level.drop(createItem('food.ration'), level.pointToCell({ x: room.left + 2, y: room.top + 2 }));
      shop.spawnShop(level);
    });
    expect(shop.shopSpawned()).toBe(true);
    expect(level.mobs).toMatchObject([{ kind: 'impShopkeeper', pos: room.left + 4 + (room.top + 4) * level.width }]);
    expect([...level.heaps.values()].filter((h) => h.kind === 'forSale').reduce((n, h) => n + h.items.length, 0)).toBe(22);
    // What lay in the room was moved out below it.
    const ration = [...level.heaps.values()].find((h) => h.items.some((i) => i.kind === 'food.ration'))!;
    expect(room.inside(level.cellToPoint(ration.pos))).toBe(false);
  });

  it('chooses the bag that would hold most of the pack, once each a run', () => {
    const run = createRun(9);
    // Nothing carried: the velvet pouch, a head start ahead of the others.
    expect(withWorld(6, run, null, () => chooseBag())?.kind).toBe('bag.seeds');
    // Then the bag for what is most carried.
    const potions = worldWith([createItem('potion.healing', 3), createItem('potion.frost'), createItem('scroll.identify')]);
    expect(withWorld(11, run, potions, () => chooseBag())?.kind).toBe('bag.potions');
    // Ties go to the first left of scroll holder and holster.
    expect(withWorld(16, run, worldWith([]), () => chooseBag())?.kind).toBe('bag.scrolls');
    expect(withWorld(20, run, null, () => chooseBag())?.kind).toBe('bag.wands');
    // All sold: no bag, and one ware fewer.
    expect(withWorld(21, run, null, () => chooseBag())).toBeNull();
    expect(wareCount(withWorld(6, run, null, () => generateShopItems()))).toBe(18);
  });

  it('counts only what lies loose in the backpack, not what is in a bag already', () => {
    const wands = [createItem('wand.firebolt'), createItem('wand.lightning'), createItem('wand.poison')];
    const loose = createRun(4);
    expect(withWorld(6, loose, worldWith([...wands, createItem('seed.icecap')]), () => chooseBag())?.kind).toBe('bag.wands');
    const holstered = createRun(4);
    // A holster carried (from elsewhere) holds the wands: the seed decides.
    expect(withWorld(6, holstered, worldWith([createItem('bag.wands'), ...wands, createItem('seed.icecap')]), () => chooseBag())?.kind).toBe('bag.seeds');
  });
});

describe('whole levels', () => {
  it('generate every regular depth over ten runs, with their special rooms', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 10; seed++) {
      const run = createRun(seed);
      for (let depth = 1; depth <= 24; depth++) {
        if (depth % 5 === 0) continue;
        const level = generateLevel(run, depth);
        for (const r of level.rooms) if (r.group === 'special') seen.add(r.kind!);

        // Every special room hangs off the level: its door (locked, crystal, barricaded or hidden as it
        // may be) is reached from the entrance, and past it, some of its inside (but over the traps
        // room's chasm, which takes levitation).
        const reached = reachFrom(level.map, level.entrance);
        expect(reached[level.exit], `exit at ${depth}, seed ${seed}`).toBe(true);
        for (const r of level.rooms) {
          if (r.group !== 'special') continue;
          let door = false;
          let inside = false;
          for (let y = r.top; y <= r.bottom; y++) {
            for (let x = r.left; x <= r.right; x++) {
              if (!reached[x + y * WIDTH]) continue;
              if (x === r.left || x === r.right || y === r.top || y === r.bottom) door = true;
              else inside = true;
            }
          }
          expect(door, `${r.kind} at ${depth}, seed ${seed}`).toBe(true);
          if (r.kind !== 'TrapsRoom') expect(inside, `${r.kind} at ${depth}, seed ${seed}`).toBe(true);
        }

        const mobs = level.spawn?.mobs ?? [];
        if (depth === 6 || depth === 11 || depth === 16) {
          expect(level.rooms.some((r) => r.kind === 'ShopRoom'), `shop at ${depth}`).toBe(true);
          expect(mobs.some((m) => m.kind === 'shopkeeper')).toBe(true);
          expect(level.spawn!.heaps.filter((h) => h.kind === 'forSale').length).toBeGreaterThanOrEqual(18);
        }
        if (depth > 20) {
          const spawner = mobs.filter((m) => (m.kind as string) === 'demonSpawner');
          expect(spawner.length).toBe(1);
          // Its floor, worked out once the level is done: the spawner's base under it, the halls' cracks kept.
          const floor = level.customTiles!.find((t) => t.kind === 'DemonSpawnerRoom.CustomFloor')!;
          const sx = spawner[0]!.pos % WIDTH - floor.x;
          const sy = Math.trunc(spawner[0]!.pos / WIDTH) - floor.y;
          expect(floor.data![sx + sy * floor.w]).toBe(38);
          for (let i = 0; i < floor.data!.length; i++) {
            const cell = floor.x + (i % floor.w) + (floor.y + Math.trunc(i / floor.w)) * WIDTH;
            const base = Math.trunc(i / floor.w) === sy && Math.abs((i % floor.w) - sx) <= 1;
            if (!base && level.map[cell] === T.EMPTY_DECO) expect(floor.data![i]).toBe(27);
          }
        }
      }
    }
    for (const kind of KINDS) if (kind !== 'ShopRoom') expect(seen.has(kind), kind).toBe(true);
  });
});
