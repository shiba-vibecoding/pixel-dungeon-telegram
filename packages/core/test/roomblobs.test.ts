import { describe, expect, it } from 'vitest';
import {
  act, addHero, canEnter, charAt, createItem, createWorld, floorAt, heroById, levelAt, T, WIDTH, type World,
} from '../src/index';

/** The first run (and depth) with a room of Shattered's class `kind`. */
function withRoom(kind: string): { world: World; depth: number } {
  for (let seed = 1; seed < 400; seed++) {
    const world = createWorld(seed * 13);
    for (let depth = 2; depth <= 24; depth++) {
      if (depth % 5 === 0) continue;
      if (levelAt(world, depth).rooms.some((room) => room.kind === kind)) return { world, depth };
    }
  }
  throw new Error(`no ${kind}`);
}

function heroAt(world: World, depth: number, pos: number): void {
  addHero(world, { id: 'p', name: 'P', heroClass: 'mage' });
  const hero = heroById(world, 'p')!;
  Object.assign(hero, { depth, pos, time: floorAt(world, depth).now, hp: 500, ht: 500, items: [] });
  floorAt(world, depth).mobs = [];
  floorAt(world, depth).respawn = 1e9;
}

describe('the special rooms\' lasting blobs', () => {
  it('MagicalFireRoom: the eternal fire bars the way and burns whoever stands by it, until frost puts all of it out', () => {
    const { world, depth } = withRoom('MagicalFireRoom');
    const level = levelAt(world, depth);
    const fire = level.eternalFire!;
    expect(fire.length).toBeGreaterThan(0);
    for (const cell of fire) expect(canEnter(level, cell)).toBe(false);
    // Beside the fire, on the door's side.
    const beside = fire.flatMap((cell) => [-1, 1, -WIDTH, WIDTH].map((n) => cell + n)).find((c) => canEnter(level, c) && !charAt(world, depth, c))!;
    heroAt(world, depth, beside);
    const hero = heroById(world, 'p')!;
    act(world, 'p', { type: 'wait' });
    act(world, 'p', { type: 'wait' });
    expect(hero.burning).toBeGreaterThan(0);
    hero.burning = 0;
    hero.items = [createItem('potion.frost')];
    act(world, 'p', { type: 'throw', item: 0, target: fire[0]! });
    expect(level.eternalFire).toBeUndefined();
    expect(canEnter(level, fire[0]!)).toBe(true);
  });

  it('ToxicGasRoom: the room is full of gas, and its vents keep it coming', () => {
    const { world, depth } = withRoom('ToxicGasRoom');
    const level = levelAt(world, depth);
    const floor = floorAt(world, depth);
    const vents = level.traps!.filter((t) => t.kind === 'toxicVent');
    expect(vents.length).toBeGreaterThan(0);
    for (const vent of vents) {
      expect(level.map[vent.pos]).toBe(T.INACTIVE_TRAP);
      expect(vent.visible).toBe(true);
    }
    expect(floor.vents!.length).toBe(vents.length);
    expect(floor.gas?.toxic?.length).toBeGreaterThan(0);
    // Far from it, time passes: the gas is still there, fed by the vents.
    heroAt(world, depth, level.entrance);
    for (let i = 0; i < 60; i++) act(world, 'p', { type: 'wait' });
    const gas = new Map(floor.gas?.toxic ?? []);
    for (const vent of vents) expect(gas.get(vent.pos) ?? 0).toBeGreaterThan(0);
  });
});
