import { describe, expect, it } from 'vitest';
import {
  act, addHero, createItem, createRun, createWorld, F, findPath, floorAt, generateLevel, hasFlag, HeapType, heroById, LAST_SHOP_DEPTH, levelAt,
  type RoomInfo, RoomType, T, viewDistance, WIDTH, type World,
} from '../src/index';
import { levelSpan } from '../src/party';
import { SOLO_SPAN } from '../src/level/geometry';
import { checkInvariants } from './helpers';

const inside = (r: RoomInfo, pos: number): boolean => {
  const x = pos % WIDTH;
  const y = Math.trunc(pos / WIDTH);
  return x > r.left && x < r.right && y > r.top && y < r.bottom;
};

/** A world with every depth down to the last shop made, the imp's errand done or not. */
function toLastShop(seed: number, impDone: boolean, party = 1): World {
  const world = createWorld(seed);
  for (let i = 0; i < party; i++) addHero(world, { id: `p${i}`, name: `P${i}`, heroClass: 'warrior' });
  for (let d = 1; d < LAST_SHOP_DEPTH; d++) levelAt(world, d);
  if (impDone) {
    world.impQuest = { depth: 18, given: true, done: true, prey: 'monk', reward: createItem('ring.energy') };
  }
  levelAt(world, LAST_SHOP_DEPTH);
  return world;
}

describe('the last shop (depth 21)', () => {
  it('is one way from the entrance to the exit, with no secrets, traps or special rooms', () => {
    for (let seed = 1; seed <= 12; seed++) {
      for (const span of [SOLO_SPAN, levelSpan(2), levelSpan(4)]) {
        for (const impDone of [false, true]) {
          const run = createRun(seed);
          const levels = Array.from({ length: LAST_SHOP_DEPTH }, (_, i) => generateLevel(run, i + 1, span, impDone));
          const level = levels[LAST_SHOP_DEPTH - 1]!;
          const label = `seed ${seed} span ${span} imp ${impDone}`;
          expect(level.map[level.entrance], label).toBe(T.ENTRANCE);
          expect(level.map[level.exit], label).toBe(T.EXIT);
          // (Across whatever traps a burned room holds.)
          expect(findPath(level, level.entrance, level.exit, new Set(), undefined, false, true), label).not.toBeNull();
          expect(level.secretDoors, label).toBe(0);
          expect(level.map.includes(T.SECRET_DOOR), label).toBe(false);
          // No traps are laid; only a burned standard room (StandardPainter) may hide a fire trap, as in the original.
          expect(level.map.filter((t) => hasFlag(t, F.SECRET)).every((t) => t === T.SECRET_FIRE_TRAP), label).toBe(true);
          if (impDone) expect(level.map.some((t) => hasFlag(t, F.SECRET)), label).toBe(false);
          const allowed = new Set([RoomType.NULL, RoomType.ENTRANCE, RoomType.EXIT, RoomType.PASSAGE, RoomType.SHOP, RoomType.STANDARD]);
          expect(level.rooms.every((r) => allowed.has(r.type)), label).toBe(true);
          expect(level.rooms.filter((r) => r.type === RoomType.SHOP).length, label).toBe(impDone ? 1 : 0);
          expect(level.rooms.filter((r) => r.type === RoomType.STANDARD).length, label).toBe(impDone ? 0 : 1);
          expect(level.shopkeeper !== undefined, label).toBe(impDone);
          // The shop's sign by the entrance (LastShopLevel.decorate) only once there is a shop.
          expect(level.map.includes(T.SIGN), label).toBe(impDone);
          // LastShopLevel.createItems drops nothing (but bones): only the shop's wares, or what a standard room's painter leaves.
          const special = level.rooms.find((r) => r.type === (impDone ? RoomType.SHOP : RoomType.STANDARD))!;
          expect(level.items.every((s) => inside(special, s.pos)), label).toBe(true);
          expect(level.items.every((s) => (s.heap === HeapType.FOR_SALE) === impDone), label).toBe(true);
          if (impDone) expect(level.items.length, label).toBeGreaterThan(0);
          expect(level.toSpawn, label).toEqual([]);
        }
      }
    }
  }, 60000);

  it('is the same level for everyone who makes it from the same world', () => {
    for (const impDone of [false, true]) {
      const a = toLastShop(7, impDone);
      const b = toLastShop(7, impDone);
      expect(a.levels[LAST_SHOP_DEPTH]).toEqual(b.levels[LAST_SHOP_DEPTH]);
      expect(a.floors[LAST_SHOP_DEPTH]).toEqual(b.floors[LAST_SHOP_DEPTH]);
    }
  });

  it("has no monsters, and no shop: the imp keeps his below the Dwarf King's throne now (CityBossLevel)", () => {
    for (let seed = 1; seed <= 10; seed++) {
      for (const party of [1, 3]) {
        for (const done of [false, true]) {
          const floor = floorAt(toLastShop(seed, done, party), LAST_SHOP_DEPTH);
          expect(floor.mobs, `seed ${seed}`).toEqual([]);
          expect(floor.respawn).toBe(-1);
          expect(floor.heaps.every((h) => h.kind !== 'forSale'), `seed ${seed}`).toBe(true);
        }
      }
    }
  }, 60000);

  it('never fills up with monsters, not even when the party grows', () => {
    const world = toLastShop(5, false);
    const hero = heroById(world, 'p0')!;
    hero.depth = LAST_SHOP_DEPTH;
    hero.pos = levelAt(world, LAST_SHOP_DEPTH).entrance;
    hero.time = floorAt(world, LAST_SHOP_DEPTH).now;
    Object.assign(hero, { ht: 50000, hp: 50000 });
    for (let i = 0; i < 3000; i++) {
      hero.hunger = 0;
      act(world, 'p0', { type: 'wait' });
    }
    checkInvariants(world);
    expect(floorAt(world, LAST_SHOP_DEPTH).mobs).toEqual([]);
    const heaps = floorAt(world, LAST_SHOP_DEPTH).heaps.length;
    addHero(world, { id: 'p1', name: 'P1', heroClass: 'mage' });
    expect(floorAt(world, LAST_SHOP_DEPTH).mobs).toEqual([]);
    expect(floorAt(world, LAST_SHOP_DEPTH).heaps.length).toBe(heaps);
  });

  it('is lit as usual, unlike the halls below', () => {
    expect(viewDistance(LAST_SHOP_DEPTH)).toBe(8);
    expect(viewDistance(LAST_SHOP_DEPTH, true)).toBe(3);
    expect(viewDistance(22)).toBe(3);
  });
});
