import { describe, expect, it } from 'vitest';
import {
  act, addHero, canEnter, charAt, createItem, createMob, createWorld, floorAt, heroById, levelAt, NEIGHBOURS8, RoomType, T,
  type World,
} from '../src/index';

/** A run in which the troll blacksmith has his forge, with a strong solo hero standing next to him. */
function withSmith(wants?: 'gold' | 'blood'): { world: World; depth: number } {
  for (let seed = 1; seed < 300; seed++) {
    const world = createWorld(seed * 13);
    levelAt(world, 14);
    if (!world.smithQuest || (wants && world.smithQuest.wants !== wants)) continue;
    const depth = world.smithQuest.depth;
    const smith = floorAt(world, depth).mobs.find((mob) => mob.kind === 'blacksmith')!;
    const level = levelAt(world, depth);
    const beside = NEIGHBOURS8.map((n) => smith.pos + n).find((c) => canEnter(level, c) && !charAt(world, depth, c))!;
    addHero(world, { id: 'p', name: 'P', heroClass: 'warrior' });
    const hero = heroById(world, 'p')!;
    Object.assign(hero, { depth, pos: beside, time: floorAt(world, depth).now, hp: 5000, ht: 5000, attackSkill: 5000, str: 20 });
    for (const mob of floorAt(world, depth).mobs) if (mob.kind !== 'blacksmith') mob.state = 'passive';
    return { world, depth };
  }
  throw new Error('no blacksmith in 300 runs');
}

const talk = (world: World, depth: number) => {
  const smith = floorAt(world, depth).mobs.find((mob) => mob.kind === 'blacksmith')!;
  const result = act(world, 'p', { type: 'attack', target: smith.id });
  return result.ok ? result.effects.find((e) => e.type === 'smith') : undefined;
};

// Pixel Dungeon's blacksmith: the Shattered quest (BlacksmithRoom, the mine) takes his place.
describe.skip('the troll blacksmith', () => {
  it('keeps his forge once per run on depths 12-14, behind a ring of fire', () => {
    const { world, depth } = withSmith();
    expect(depth).toBeGreaterThanOrEqual(12);
    expect(depth).toBeLessThanOrEqual(14);
    const level = levelAt(world, depth);
    const forge = level.rooms.find((room) => room.type === RoomType.BLACKSMITH)!;
    expect(forge).toBeDefined();
    expect(level.map.filter((t) => t === T.TRAP).length).toBeGreaterThan(4);
    for (let d = 11; d <= 14; d++) {
      if (d !== depth) expect(levelAt(world, d).rooms.some((room) => room.type === RoomType.BLACKSMITH)).toBe(false);
    }
  });

  it('lends a pickaxe for dark gold, mined from the veins, and takes fifteen pieces', () => {
    const { world, depth } = withSmith('gold');
    const hero = heroById(world, 'p')!;
    expect(talk(world, depth)).toEqual({ type: 'smith', hero: 'p', line: 'intro' });
    expect(hero.items.some((i) => i.kind === 'weapon.pickaxe')).toBe(true);
    expect(talk(world, depth)).toEqual({ type: 'smith', hero: 'p', line: 'noGold' });
    // Off to a vein in the rock, and back.
    const level = levelAt(world, depth);
    const back = hero.pos;
    const spot = level.map.findIndex((_, c) => canEnter(level, c) && !charAt(world, depth, c) &&
      NEIGHBOURS8.some((n) => level.map[c + n] === T.WALL_DECO));
    hero.pos = spot;
    const vein = NEIGHBOURS8.map((n) => spot + n).find((c) => level.map[c] === T.WALL_DECO)!;
    const hunger = hero.hunger;
    expect(act(world, 'p', { type: 'mine' }).ok).toBe(true);
    expect(level.map[vein]).toBe(T.WALL);
    expect(hero.items.find((i) => i.kind === 'quest.ore')?.qty).toBe(1);
    expect(hero.hunger).toBeGreaterThan(hunger);
    hero.pos = back;
    hero.items = hero.items.filter((i) => i.kind !== 'quest.ore');
    hero.items.push(createItem('quest.ore', 15));
    expect(talk(world, depth)).toEqual({ type: 'smith', hero: 'p', line: 'completed' });
    expect(hero.items.some((i) => i.kind === 'weapon.pickaxe' || i.kind === 'quest.ore')).toBe(false);
  });

  it('or wants a bat slain with his pickaxe', () => {
    const { world, depth } = withSmith('blood');
    const hero = heroById(world, 'p')!;
    talk(world, depth);
    const pick = hero.items.findIndex((i) => i.kind === 'weapon.pickaxe');
    act(world, 'p', { type: 'equip', item: pick });
    expect(hero.weapon!.kind).toBe('weapon.pickaxe');
    expect(talk(world, depth)).toEqual({ type: 'smith', hero: 'p', line: 'noBlood' });
    const level = levelAt(world, depth);
    const pos = NEIGHBOURS8.map((n) => hero.pos + n).find((c) => canEnter(level, c) && !charAt(world, depth, c))!;
    const bat = createMob('#bat', 'bat', pos, 'hunting', floorAt(world, depth).now);
    Object.assign(bat, { hp: 1, enemy: 'p' });
    floorAt(world, depth).mobs.push(bat);
    act(world, 'p', { type: 'attack', target: '#bat' });
    expect(hero.weapon!.bloody).toBe(true);
    expect(talk(world, depth)).toEqual({ type: 'smith', hero: 'p', line: 'completed' });
    expect(hero.weapon?.kind).not.toBe('weapon.pickaxe');
  });

  it('then reforges two items of a kind into one, a level better, once', () => {
    const { world, depth } = withSmith();
    const hero = heroById(world, 'p')!;
    world.smithQuest!.given = true;
    world.smithQuest!.done = true;
    hero.items = [createItem('weapon.sword', 1, 2), createItem('weapon.sword', 1, 1), createItem('weapon.mace', 1, 0)];
    expect(act(world, 'p', { type: 'reforge', first: 0, second: 2 })).toEqual({ ok: false, reason: 'choose two items of the same kind' });
    expect(talk(world, depth)).toEqual({ type: 'smith', hero: 'p', line: 'reforge' });
    expect(act(world, 'p', { type: 'reforge', first: 0, second: 1 }).ok).toBe(true);
    expect(hero.items.map((i) => `${i.kind}:${i.level}`)).toEqual(['weapon.sword:3', 'weapon.mace:0']);
    expect(world.smithQuest!.reforged).toBe(true);
    expect(talk(world, depth)).toEqual({ type: 'smith', hero: 'p', line: 'busy' });
  });
});
