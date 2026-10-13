import { describe, expect, it } from 'vitest';
import { addHero, createWorld, floorAt, type HeroClass, levelAt, type World } from '../src/index';

const CLASSES: HeroClass[] = ['warrior', 'mage', 'rogue', 'huntress'];

function party(seed: number, size: number): World {
  const world = createWorld(seed);
  for (let i = 0; i < size; i++) addHero(world, { id: `h${i}`, name: `H${i}`, heroClass: CLASSES[i % 4]! });
  return world;
}

/** Every item lying on a depth, chests and all. */
const itemsOn = (world: World, depth: number) => floorAt(world, depth).heaps.flatMap((heap) => heap.items);
const count = (world: World, depths: number[], kind: string): number =>
  depths.reduce((sum, d) => sum + itemsOn(world, d).filter((item) => item.kind === kind).reduce((n, item) => n + item.qty, 0), 0);

const REGULAR = Array.from({ length: 25 }, (_, i) => i + 1).filter((d) => d % 5 !== 0);

describe('a dungeon made for the party', () => {
  it('is the same as ever for one hero', () => {
    const a = party(4242, 1);
    const b = createWorld(4242);
    addHero(b, { id: 'h0', name: 'H0', heroClass: 'warrior' });
    for (const d of [1, 2, 3]) {
      expect(floorAt(a, d).mobs.map((m) => [m.kind, m.ht])).toEqual(floorAt(b, d).mobs.map((m) => [m.kind, m.ht]));
      expect(itemsOn(a, d)).toEqual(itemsOn(b, d));
    }
  });

  it('holds more monsters, sturdier, and more to find for three', () => {
    let soloMobs = 0;
    let partyMobs = 0;
    let soloItems = 0;
    let partyItems = 0;
    for (const seed of [1, 2, 3]) {
      const solo = party(seed, 1);
      const three = party(seed, 3);
      for (const d of [2, 3, 4, 6, 7]) {
        soloMobs += floorAt(solo, d).mobs.length;
        partyMobs += floorAt(three, d).mobs.length;
        soloItems += itemsOn(solo, d).length;
        partyItems += itemsOn(three, d).length;
      }
      const rat = floorAt(three, 2).mobs.find((m) => m.kind === 'rat');
      if (rat) expect(rat.ht).toBe(Math.round(8 * 1.3));
    }
    expect(partyMobs).toBeGreaterThan(soloMobs * 1.5);
    expect(partyItems).toBeGreaterThan(soloItems * 1.5);
  });

  it('gives every hero their own strength and upgrades', () => {
    const solo = party(77, 1);
    const three = party(77, 3);
    // Every depth, the bosses' too: what falls into a chasm lands on the depth below.
    const all = [...REGULAR, 5, 10, 15, 20, 25];
    for (const d of all) {
      levelAt(solo, d);
      levelAt(three, d);
    }
    expect(count(three, all, 'potion.strength')).toBe(3 * count(solo, all, 'potion.strength'));
    expect(count(three, all, 'scroll.upgrade')).toBe(3 * count(solo, all, 'scroll.upgrade'));
    expect(count(solo, all, 'potion.strength')).toBeGreaterThan(0);
  });

  it('spreads the depths wider for a party, with more rooms', () => {
    let solo = 0;
    let three = 0;
    for (const seed of [11, 12, 13]) {
      const a = levelAt(party(seed, 1), 3);
      const b = levelAt(party(seed, 3), 3);
      solo += a.rooms.length;
      three += b.rooms.length;
    }
    expect(three).toBeGreaterThan(solo);
  });

  it('makes bosses much sturdier', () => {
    const goo = floorAt(party(5, 3), 5).mobs.find((m) => m.kind === 'goo')!;
    expect(goo.ht).toBe(Math.round(80 * 2.3));
    expect(goo.hp).toBe(goo.ht);
  });
});
