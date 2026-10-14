import {
  act, type Action, addHero, adjacent, createItem, createWorld, type Effect, findPath, floorAt, heroById, type HeroClass,
  canEnter, charAt, distance, isAlive, levelAt, NEIGHBOURS8, swapsWithHero, T, WIDTH, type World,
} from '../src/index';
import { botAction, checkInvariants, skeletonKey, unblock } from './helpers';

/*
 * The whole dungeon in one go: a sturdy bot walks from the first depth to
 * the Amulet on one world, through every region, boss and quest floor the
 * seed makes, checking the invariants after every action. Now and then the
 * world goes through JSON, as a save does, and play goes on from the copy.
 */

const BOSSES = new Set(['goo', 'tengu', 'dm300', 'king', 'yog', 'rottingFist', 'burningFist']);

export function step(world: World, id = 'p'): Action {
  const action = plan(world, id);
  // Companions swap places when one walks into the other; two bots bound for the same cell would
  // swap for ever, so the second gives way, as people do.
  if (action.type === 'move') {
    const hero = heroById(world, id)!;
    const other = world.heroes.find((h) => h.id !== id && h.depth === hero.depth && h.pos === action.to && isAlive(h));
    if (other && id > other.id) return { type: 'wait' };
  }
  return action;
}

function plan(world: World, id: string): Action {
  const hero = heroById(world, id)!;
  const floor = floorAt(world, hero.depth);
  const level = levelAt(world, hero.depth);
  if (hero.depth === 26) {
    // With the Amulet in hand, the party calls it a day.
    if (hero.items.some((i) => i.kind === 'quest.amulet')) return { type: 'endGame' };
    const amulet = floor.heaps.find((h) => h.items.some((i) => i.kind === 'quest.amulet'));
    if (amulet) {
      if (hero.pos === amulet.pos) return { type: 'pickup' };
      const path = findPath(level, hero.pos, amulet.pos);
      if (path && path.length > 0) return { type: 'move', to: path[0]! };
    }
  }
  // Yog's fists first, then whatever else stands beside the hero.
  const awake = floor.mobs.filter((m) => adjacent(m.pos, hero.pos) && m.state !== 'passive');
  const foe = awake.find((m) => m.kind !== 'yog') ?? awake[0];
  if (foe) return { type: 'attack', target: foe.id };
  // A fallen boss's skeleton key, for the locked way down.
  const skeleton = skeletonKey(world, id);
  if (skeleton) return skeleton;
  if (hero.pos === level.exit) return { type: 'descend' };
  // A boss on the floor is hunted down: its fall opens the way on.
  const boss = floor.mobs.find((m) => m.kind === 'rottingFist' || m.kind === 'burningFist') ?? floor.mobs.find((m) => BOSSES.has(m.kind));
  if (boss) {
    const others = new Set(floor.mobs.filter((m) => m !== boss).map((m) => m.pos));
    const path = findPath(level, hero.pos, boss.pos, others);
    if (path && path.length > 0) {
      const inTheWay = floor.mobs.find((m) => m.pos === path[0]);
      return inTheWay ? { type: 'attack', target: inTheWay.id } : { type: 'move', to: path[0]! };
    }
  }
  // A boss's arena: the iron key from its chest, through the arena door, and into the middle, where the boss shows.
  const chest = level.arenaDoor === undefined ? undefined : floor.heaps.find((h) => h.items.some((i) => i.kind === 'key.iron' && (i.depth ?? hero.depth) === hero.depth));
  if (chest) {
    if (hero.pos === chest.pos) return { type: 'pickup' };
    const toChest = toward(world, chest.pos, id);
    if (toChest) return toChest;
  }
  if (level.arenaDoor !== undefined && !floor.arenaEntered) {
    const door = level.arenaDoor;
    // The door still locked and its key in a companion's pack: out of their way, and let them open it.
    const keyFor = (h: { items: Array<{ kind: string; depth?: number }> }): boolean => h.items.some((i) => i.kind === 'key.iron' && i.depth === hero.depth);
    if (level.map[door] === T.LOCKED_DOOR && !keyFor(hero) && world.heroes.some((h) => h !== hero && h.depth === hero.depth && keyFor(h))) {
      if (distance(hero.pos, door) >= 3) return { type: 'wait' };
      const away = NEIGHBOURS8.map((n) => hero.pos + n)
        .filter((c) => canEnter(level, c) && !charAt(world, hero.depth, c) && distance(c, door) > distance(hero.pos, door))[0];
      return away === undefined ? { type: 'wait' } : { type: 'move', to: away };
    }
    // Through the door, to the side farther from the entrance: that is the arena.
    const far = (cell: number): number => findPath(level, level.entrance, cell, new Set([door]))?.length ?? Infinity;
    const inside = [door + WIDTH, door - WIDTH, door + 1, door - 1].filter((c) => canEnter(level, c)).sort((a, b) => far(b) - far(a))[0];
    const inArena = hero.pos === door && inside !== undefined ? toward(world, inside, id) : toward(world, door, id);
    if (inArena) return inArena;
  }
  // The only way on crosses a trap: the bot walks over it, as a player would tap it.
  if (!findPath(level, hero.pos, level.exit)) {
    const path = findPath(level, hero.pos, level.exit, new Set(floor.mobs.map((m) => m.pos)), undefined, false, true);
    if (path && path.length > 0) return { type: 'move', to: path[0]! };
  }
  const action = botAction(world, id, 26);
  // Stuck searching far from any hidden door: a trap bars the way to one; walk over it.
  const hidden = level.map.flatMap((terrain, cell) => (terrain === T.SECRET_DOOR ? [cell] : []));
  if (action.type === 'search' && !hidden.some((cell) => adjacent(cell, hero.pos))) {
    const mobs = new Set(floor.mobs.map((m) => m.pos));
    for (const door of hidden) {
      for (const n of NEIGHBOURS8) {
        const path = findPath(level, hero.pos, door + n, mobs, undefined, false, true);
        if (path && path.length > 0) return { type: 'move', to: path[0]! };
      }
    }
  }
  return action;
}

/** One step toward a cell, cutting through whatever stands in the way; null if there is no way. */
function toward(world: World, goal: number, id = 'p'): Action | null {
  const hero = heroById(world, id)!;
  const floor = floorAt(world, hero.depth);
  const others = new Set(floor.mobs.filter((m) => !swapsWithHero(m)).map((m) => m.pos));
  others.delete(goal);
  const level = levelAt(world, hero.depth);
  // Around traps if possible; over one if that is the only way.
  const path = findPath(level, hero.pos, goal, others) ?? findPath(level, hero.pos, goal, others, undefined, false, true);
  if (!path || path.length === 0) return null;
  const inTheWay = floor.mobs.find((m) => m.pos === path[0]);
  return inTheWay && !swapsWithHero(inTheWay) ? { type: 'attack', target: inTheWay.id } : { type: 'move', to: path[0]! };
}

export function marathon(seed: number, heroClass: HeroClass): { world: World; effects: Effect[]; steps: number; trace: string[] } {
  let world = createWorld(seed);
  addHero(world, { id: 'p', name: 'P', heroClass });
  const strengthen = (): void => {
    const hero = heroById(world, 'p')!;
    Object.assign(hero, { attackSkill: 600, defenseSkill: 80, ht: Math.max(hero.ht, 5000), hp: Math.max(hero.hp, 1), str: 22 });
    // A blow that outpaces the rotting fist's healing in water.
    if (hero.weapon?.kind !== 'weapon.warHammer' || hero.weapon.level < 20) hero.weapon = createItem('weapon.warHammer', 1, 20);
  };
  strengthen();
  heroById(world, 'p')!.hp = 5000;
  const effects: Effect[] = [];
  let steps = 0;
  /** The last actions, for telling where a run got stuck. */
  const trace: string[] = [];
  for (; steps < 60000 && !world.over; steps++) {
    const action = step(world);
    const before = heroById(world, 'p')!;
    let result = act(world, 'p', action);
    // The run is about the world, not survival: the hero is kept fed and whole.
    const now = heroById(world, 'p')!;
    if (now.hp > 0) now.hp = now.ht;
    now.hunger = 0;
    const after = heroById(world, 'p')!;
    const gas = result.ok ? result.effects.filter((e) => e.type === 'hurt' && e.who === 'p').length : 0;
    trace.push(`${before.depth}@${before.pos} t${world.turn} hp${after.hp} para${after.paralysed.toFixed(1)} hurts${gas} ${JSON.stringify(action)} ${result.ok ? 'ok' : result.reason}`);
    if (trace.length > 12) trace.shift();
    if (!result.ok) result = act(world, 'p', { type: 'wait' });
    if (result.ok) effects.push(...result.effects);
    checkInvariants(world);
    // A save and a reload every so often: play goes on from the copy.
    if (steps % 2500 === 2499) {
      world = JSON.parse(JSON.stringify(world)) as World;
      strengthen();
    }
  }
  return { world, effects, steps, trace };
}


/**
 * Two sturdy bots in one party, taking turns as the server passes their
 * actions on; a hero who keeps the other waiting is moved on as the server
 * would. Each goes down on its own; the run ends when the Amulet is taken.
 */
export function partyMarathon(seed: number, classes: readonly [HeroClass, HeroClass]): { world: World; steps: number; trace: string[] } {
  let world = createWorld(seed);
  const ids = ['p', 'q'] as const;
  ids.forEach((id, i) => addHero(world, { id, name: id.toUpperCase(), heroClass: classes[i]! }));
  const keep = (): void => {
    for (const id of ids) {
      const hero = heroById(world, id)!;
      Object.assign(hero, { attackSkill: 600, defenseSkill: 80, ht: Math.max(hero.ht, 5000), str: 22, hunger: 0 });
      if (hero.hp > 0) hero.hp = hero.ht;
      if (hero.weapon?.kind !== 'weapon.warHammer' || hero.weapon.level < 20) hero.weapon = createItem('weapon.warHammer', 1, 20);
    }
  };
  keep();
  const trace: string[] = [];
  let steps = 0;
  for (; steps < 120000 && !world.over; steps++) {
    const id = ids[steps % 2]!;
    const hero = heroById(world, id)!;
    if (!isAlive(hero)) continue;
    const action = step(world, id);
    let result = act(world, id, action);
    if (!result.ok) result = act(world, id, { type: 'wait' });
    trace.push(`${id} ${hero.depth}@${hero.pos} ${JSON.stringify(action)} ${result.ok ? 'ok' : result.reason}`);
    if (trace.length > 12) trace.shift();
    unblock(world, (who, a) => act(world, who, a as Action));
    keep();
    checkInvariants(world);
    if (steps % 5000 === 4999) {
      world = JSON.parse(JSON.stringify(world)) as World;
      keep();
    }
  }
  return { world, steps, trace };
}
