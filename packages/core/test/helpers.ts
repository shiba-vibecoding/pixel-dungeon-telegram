import {
  type Action, adjacent, blockers, canEnter, F, findPath, MOBS, swapsWithHero, floorAt, hasFlag, heroById, HUNGRY, isAlive, levelAt, NEIGHBOURS8, T,
  type World,
} from '../src/index';

/** Removes the monsters, for tests about movement alone. */
export function pacify(world: World): World {
  for (let depth = 1; depth <= 4; depth++) {
    const floor = floorAt(world, depth);
    floor.mobs = [];
    floor.respawn = 1e9;
  }
  return world;
}

/**
 * A simple player: fights whatever is adjacent and awake, rests when hurt,
 * otherwise heads for the stairs down, cutting through monsters in the way.
 * When no path exists it cheats a little: it knows where the hidden doors are
 * and searches next to the nearest one.
 */
export function botAction(world: World, id: string, deepest = 4): Action {
  const hero = heroById(world, id)!;
  const level = levelAt(world, hero.depth);
  const floor = floorAt(world, hero.depth);
  const enemy = floor.mobs.find((mob) => adjacent(mob.pos, hero.pos) && mob.state !== 'sleeping' && mob.state !== 'passive');
  const healing = hero.items.findIndex((item) => item.kind === 'potion.healing');
  if (hero.hp < hero.ht / 3 && healing >= 0) return { type: 'use', item: healing };
  if (enemy) return { type: 'attack', target: enemy.id };
  // Disarmed by a monk: take up a weapon from the pack again.
  const weapon = hero.items.findIndex((item) => item.kind.startsWith('weapon.') && !item.cursed);
  if (!hero.weapon && weapon >= 0) return { type: 'equip', item: weapon };
  const food = hero.items.findIndex((item) => item.kind.startsWith('food.'));
  if (hero.hunger >= HUNGRY && food >= 0) return { type: 'use', item: food };
  if (floor.heaps.some((heap) => heap.pos === hero.pos && heap.kind !== 'forSale') && hero.items.length < 20) {
    return { type: 'pickup' };
  }
  if (hero.pos === level.exit && hero.depth < deepest) return { type: 'descend' };
  if (hero.hp < hero.ht / 2) return { type: 'wait' };

  const companions = new Set(
    world.heroes.filter((h) => h !== hero && h.depth === hero.depth && isAlive(h)).map((h) => h.pos),
  );
  const toward = (target: number): Action => {
    const path = findPath(level, hero.pos, target, companions);
    if (!path || path.length === 0) return { type: 'wait' };
    const inTheWay = floor.mobs.find((mob) => mob.pos === path[0]);
    if (swapsWithHero(inTheWay)) return { type: 'move', to: path[0]! };
    if (inTheWay?.state === 'passive') return { type: 'wait' };
    return inTheWay ? { type: 'attack', target: inTheWay.id } : { type: 'move', to: path[0]! };
  };

  if (findPath(level, hero.pos, level.exit, companions)) return toward(level.exit);

  const hidden = level.map.flatMap((terrain, cell) => (terrain === T.SECRET_DOOR ? [cell] : []));
  if (hidden.some((cell) => adjacent(cell, hero.pos))) return { type: 'search' };
  let best: number[] | null = null;
  for (const door of hidden) {
    for (const n of NEIGHBOURS8) {
      const path = findPath(level, hero.pos, door + n, companions);
      if (path && (!best || path.length < best.length)) best = path;
    }
  }
  return best && best.length > 0 ? toward(best.at(-1)!) : { type: 'search' };
}

/** What a server does once a hero has kept the others waiting too long. */
export function unblock(world: World, act: (id: string, action: Action) => unknown): void {
  for (let i = 0; i < 10; i++) {
    const stuck = blockers(world);
    if (stuck.length === 0) return;
    for (const id of stuck) act(id, { type: 'wait' });
  }
}

/** Invariants that must hold after every action. */
export function checkInvariants(world: World): void {
  for (const [key, floor] of Object.entries(world.floors)) {
    const depth = Number(key);
    const level = levelAt(world, depth);
    const cells = new Map<number, string>();
    const occupy = (pos: number, who: string): void => {
      if (cells.has(pos)) throw new Error(`${who} and ${cells.get(pos)} share cell ${pos} on depth ${depth}`);
      cells.set(pos, who);
    };
    for (const mob of floor.mobs) {
      if (!isAlive(mob) || mob.hp > mob.ht) throw new Error(`${mob.id} has ${mob.hp}/${mob.ht} HP`);
      // A trap may be found under a monster standing on it; a flier may hover over a chasm.
      const flier = MOBS[mob.kind].flying === true;
      // The Dwarf King sits on his throne (DwarfKing, CityBossLevel.throne).
      const throned = mob.kind === 'king' && level.boss?.throne === mob.pos;
      if (!canEnter(level, mob.pos) && !throned && !(flier && hasFlag(level.map[mob.pos]!, F.PIT))) throw new Error(`${mob.id} (${mob.kind}) stands in a wall at ${mob.pos} on depth ${depth} (terrain ${level.map[mob.pos]})`);
      occupy(mob.pos, mob.id);
    }
    for (const hero of world.heroes.filter((h) => h.depth === depth && isAlive(h))) {
      if (hero.hp > hero.ht) throw new Error(`${hero.id} has ${hero.hp}/${hero.ht} HP`);
      occupy(hero.pos, hero.id);
    }
  }
}

/**
 * After a boss falls: off to the skeleton key it dropped and up with it,
 * for the locked way down. Null once the hero holds the key (or there is none).
 */
export function skeletonKey(world: World, id: string): Action | null {
  const hero = heroById(world, id)!;
  if (hero.items.some((item) => item.kind === 'key.skeleton' && item.depth === hero.depth)) return null;
  const heap = floorAt(world, hero.depth).heaps.find((h) => h.items.some((item) => item.kind === 'key.skeleton'));
  if (!heap) return null;
  if (heap.pos === hero.pos) return { type: 'pickup' };
  const level = levelAt(world, hero.depth);
  const path = findPath(level, hero.pos, heap.pos) ?? findPath(level, hero.pos, heap.pos, new Set(), undefined, false, true);
  return path && path.length > 0 ? { type: 'move', to: path[0]! } : null;
}
