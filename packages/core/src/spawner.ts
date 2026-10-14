import { RAT_SKULL, sundialMultiplier, trinketLevel } from './trinkets';
import { mineRespawn } from './minemobs';
import { createMob, type Mob, type MobKind } from './actors';
import { rollForChampion } from './champions';
import { castShadow, terrainBlocksSight } from './fov';
import { charAt, type Ctx, heroesOn, heroSight, isPassable } from './floor';
import { enemyCount, fits } from './mobs';
import { mobCount, partySize, respawnTime, scaleMob } from './party';
import { Feeling, LAST_SHOP_DEPTH } from './level/builder';
import type { Level, RoomInfo } from './level/generate';
import { adjacent, cellX, cellY, LENGTH, NEIGHBOURS8, WIDTH } from './level/geometry';
import { RoomType } from './level/room';
import { F, hasFlag, T } from './level/terrain';
import type { Rng } from './rng';
import type { World } from './world';

/*
 * MobSpawner: which monsters a depth deals and in what order. Each depth has
 * its rotation of standard monsters (a shaman's mask and an elemental's kind
 * rolled as the rotation is made), now and then one from the region below
 * added, one in fifty of each swapped for its rare kind, shuffled; a level
 * deals from its rotation until it runs out and makes a new one
 * (Level.createMob), and every monster dealt may come as a champion under
 * the challenge. RegularLevel.createMobs places a new level's first monsters,
 * MobSpawner.act tops it up as they die.
 */

/** Shaman.random(): a red mask four times in ten, a blue four, a purple two. */
function randomShaman(rng: Rng): MobKind {
  const roll = rng.float();
  return roll < 0.4 ? 'shaman' : roll < 0.8 ? 'blueShaman' : 'purpleShaman';
}

/**
 * RatSkull.exoticChanceMultiplier: how much likelier the rare kinds are (MobSpawner.swapMobAlts,
 * Elemental.random, Piranha.random, Statue.random, Wraith.spawnAt), with the rat skull (a trinket) carried.
 */
export const exoticChanceMultiplier = (world?: World): number => RAT_SKULL.exoticChanceMultiplier(trinketLevel(world?.heroes[0], 'trinket.ratSkull'));

/** Elemental.random(): one in fifty a chaos elemental; else fire four times in ten, frost four, shock two. */
function randomElemental(rng: Rng, world?: World): MobKind {
  if (rng.float() < (1 / 50) * exoticChanceMultiplier(world)) return 'chaosElemental';
  const roll = rng.float();
  return roll < 0.4 ? 'elemental' : roll < 0.8 ? 'frostElemental' : 'shockElemental';
}

/** MobSpawner.standardMobRotation: the depth's monsters, unshuffled (beyond the halls, the halls' last). */
function standardRotation(rng: Rng, depth: number, world?: World): MobKind[] {
  const shaman = (): MobKind => randomShaman(rng);
  const elemental = (): MobKind => randomElemental(rng, world);
  switch (depth) {
    // The sewers.
    default:
    case 1: return ['rat', 'rat', 'rat', 'snake'];
    case 2: return ['rat', 'rat', 'snake', 'gnoll', 'gnoll'];
    case 3: return ['rat', 'snake', 'gnoll', 'gnoll', 'gnoll', 'swarm', 'crab'];
    case 4: case 5: return ['gnoll', 'swarm', 'crab', 'crab', 'slime', 'slime'];
    // The prison.
    case 6: return ['skeleton', 'skeleton', 'skeleton', 'thief', 'swarm'];
    case 7: return ['skeleton', 'skeleton', 'skeleton', 'thief', 'dm100', 'guard'];
    case 8: return ['skeleton', 'skeleton', 'thief', 'dm100', 'dm100', 'guard', 'guard', 'necromancer'];
    case 9: case 10: return ['skeleton', 'thief', 'dm100', 'dm100', 'guard', 'guard', 'necromancer', 'necromancer'];
    // The caves.
    case 11: return ['bat', 'bat', 'bat', 'brute', shaman()];
    case 12: return ['bat', 'bat', 'brute', 'brute', shaman(), 'spinner'];
    case 13: return ['bat', 'brute', 'brute', shaman(), shaman(), 'spinner', 'spinner', 'dm200'];
    case 14: case 15: return ['bat', 'brute', shaman(), shaman(), 'spinner', 'spinner', 'dm200', 'dm200'];
    // The city.
    case 16: return ['ghoul', 'ghoul', 'ghoul', elemental(), 'warlock'];
    case 17: return ['ghoul', elemental(), elemental(), 'warlock', 'monk'];
    case 18: return ['ghoul', elemental(), 'warlock', 'warlock', 'monk', 'monk', 'golem'];
    case 19: case 20: return [elemental(), 'warlock', 'warlock', 'monk', 'monk', 'golem', 'golem', 'golem'];
    // The halls.
    case 21: return ['succubus', 'succubus', 'eye'];
    case 22: return ['succubus', 'eye'];
    case 23: return ['succubus', 'eye', 'eye', 'scorpio'];
    case 24: case 25: case 26: return ['succubus', 'eye', 'eye', 'scorpio', 'scorpio', 'scorpio'];
  }
}

/** MobSpawner.addRareMobs: on the last depth of a region, now and then a visitor from the region below. */
function addRareMobs(rng: Rng, depth: number, rotation: MobKind[]): void {
  const visitor: Partial<Record<number, MobKind>> = { 4: 'thief', 9: 'bat', 14: 'ghoul', 19: 'succubus' };
  const kind = visitor[depth];
  if (kind && rng.float() < 0.025) rotation.push(kind);
}

/** MobSpawner.RARE_ALTS: the rare kind of a monster (a chaos elemental comes from Elemental.random instead). */
export const RARE_ALTS: Partial<Record<MobKind, MobKind>> = {
  rat: 'albino', gnoll: 'gnollExile', crab: 'hermitCrab', slime: 'causticSlime',
  thief: 'bandit', necromancer: 'spectralNecromancer',
  brute: 'shielded', dm200: 'dm201',
  monk: 'senior',
  scorpio: 'acidic',
};

/** MobSpawner.swapMobAlts: one in fifty of each swapped for its rare kind. */
function swapMobAlts(rng: Rng, rotation: MobKind[], world?: World): void {
  const altChance = (1 / 50) * exoticChanceMultiplier(world);
  for (let i = 0; i < rotation.length; i++) {
    if (rng.float() < altChance) {
      const alt = RARE_ALTS[rotation[i]!];
      if (alt) rotation[i] = alt;
    }
  }
}

/** Random.shuffle(List): Collections.shuffle, from the end. */
function shuffleList<T>(rng: Rng, list: T[]): void {
  for (let i = list.length; i > 1; i--) {
    const j = rng.int(i);
    const t = list[i - 1]!;
    list[i - 1] = list[j]!;
    list[j] = t;
  }
}

/** MobSpawner.getMobRotation: a depth's rotation, its rare visitor and rare kinds in, shuffled. */
export function mobRotation(rng: Rng, depth: number, world?: World): MobKind[] {
  const rotation = standardRotation(rng, depth, world);
  addRareMobs(rng, depth, rotation);
  swapMobAlts(rng, rotation, world);
  shuffleList(rng, rotation);
  return rotation;
}

/**
 * A monster kind for a depth as MobSpawner would deal one, out of a fresh rotation (the arena's waves and
 * the summoning trap's use of it); `mutable` false keeps the rare kinds out.
 */
export function rollMob(rng: Rng, depth: number, mutable = true): MobKind {
  const rotation = standardRotation(rng, depth);
  if (mutable) {
    addRareMobs(rng, depth, rotation);
    swapMobAlts(rng, rotation);
  }
  return rotation[rng.int(rotation.length)]!;
}

/**
 * Level.createMob: the next monster of the level's rotation (a new rotation when it runs out), which may
 * come as a champion (ChampionEnemy.rollForChampion).
 */
export function dealMob(world: World, level: Level, rng: Rng, id: string, pos: number, time: number): Mob {
  if (!level.mobRotation || level.mobRotation.length === 0) level.mobRotation = mobRotation(rng, level.depth, world);
  const mob = createMob(id, level.mobRotation.shift()!, pos, 'sleeping', time);
  rollForChampion(world, mob, rng, level.depth);
  return scaleMob(world, mob);
}

/** RegularLevel.mobLimit: how many monsters a level holds — none on the first (until the Amulet comes up). */
export function mobLimit(world: World, level: Level, rng: Rng): number {
  if (level.depth <= 1) return world.amuletTaken ? 10 : 0;
  let mobs = 3 + (level.depth % 5) + rng.int(3);
  // SEAM(levels): Level.Feeling.LARGE, a third more of them, once there are large levels.
  const large = (Feeling as unknown as Record<string, number>).LARGE;
  if (large !== undefined && level.feeling === large) mobs = Math.ceil(mobs * 1.33);
  return mobs;
}

/** Level.TIME_TO_RESPAWN. */
export const TIME_TO_RESPAWN = 50;

/**
 * Level.respawnCooldown: fifty turns between monsters (two thirds of that on a dark level: SEAM(levels));
 * once the Amulet is taken, much sooner — on the first depth a twenty-fifth of it for every monster there,
 * elsewhere a tenth, from five to twenty-five turns. The dimensional sundial (a trinket) makes it longer by day,
 * shorter by night (DimensionalSundial.spawnMultiplierAtCurrentTime).
 */
export function respawnCooldown(world: World, level: Level, count: number): number {
  let cooldown: number;
  if (world.amuletTaken) {
    if (level.depth === 1) cooldown = count * (TIME_TO_RESPAWN / 25);
    else cooldown = Math.round(Math.min(TIME_TO_RESPAWN / 2, Math.max(TIME_TO_RESPAWN / 10, count * (TIME_TO_RESPAWN / 10))));
  } else {
    const dark = (Feeling as unknown as Record<string, number>).DARK;
    cooldown = dark !== undefined && level.feeling === dark ? (2 * TIME_TO_RESPAWN) / 3 : TIME_TO_RESPAWN;
  }
  return cooldown / sundialMultiplier(world);
}

/** Room.random(1): a cell inside a room, off its walls. */
function randomCellIn(rng: Rng, room: RoomInfo): number {
  return rng.intBetween(room.left + 1, room.right) + rng.intBetween(room.top + 1, room.bottom) * WIDTH;
}

/** StandardRoom.sizeFactor, the room's weight for monsters (an entrance room's is 1). SEAM(levels): room sizes; 1 until then. */
const mobSpawnWeight = (room: RoomInfo): number => (room as RoomInfo & { sizeFactor?: number }).sizeFactor ?? 1;

const roomOf = (level: Level, cell: number): RoomInfo | undefined =>
  level.rooms.find((room) => cellX(cell) > room.left && cellX(cell) < room.right && cellY(cell) > room.top && cellY(cell) < room.bottom);

/** A breadth-first walk of `steps` from `from` over `open` cells: which cells it reaches. */
function walk(from: number, steps: number, open: (cell: number) => boolean): boolean[] {
  const reached = new Array<boolean>(LENGTH).fill(false);
  reached[from] = true;
  let frontier = [from];
  for (let step = 0; step < steps && frontier.length > 0; step++) {
    const next: number[] = [];
    for (const c of frontier) {
      for (const n of NEIGHBOURS8) {
        const cell = c + n;
        if (cell < 0 || cell >= LENGTH || reached[cell] || !adjacent(c, cell) || !open(cell)) continue;
        reached[cell] = true;
        next.push(cell);
      }
    }
    frontier = next;
  }
  return reached;
}

/**
 * RegularLevel.createMobs: a new level's monsters, asleep — eight on the first depth, so the hero can reach the
 * second level, otherwise as many as the level holds. They are dealt into the standard rooms (the bigger, the more
 * often), never within eight cells' sight of the entrance nor eight steps' walk from it, nor on the exit, a trap
 * or a plant, the large only where they fit; past the first depth one time in four a second shares the room.
 * Tall grass under one is trampled.
 */
export function createMobs(world: World, level: Level, rng: Rng, nextId: () => string, taken: (cell: number) => boolean): Mob[] {
  const mobs: Mob[] = [];
  let toSpawn = level.depth === 1 ? 8 : mobLimit(world, level, rng);
  toSpawn = mobCount(toSpawn, partySize(world));
  const rooms: RoomInfo[] = [];
  for (const room of level.rooms) {
    if (room.type !== RoomType.STANDARD) continue;
    const entrance = roomOf(level, level.entrance) === room;
    for (let i = 0; i < (entrance ? 1 : mobSpawnWeight(room)); i++) rooms.push(room);
  }
  if (rooms.length === 0) return mobs;
  shuffleList(rng, rooms);
  const entranceFov = castShadow(level.entrance, terrainBlocksSight(level.map), 8);
  const entranceRoom = roomOf(level, level.entrance);
  const walkable = (cell: number): boolean => {
    if (!hasFlag(level.map[cell]!, F.SOLID)) return true;
    // Doors within the entrance room are ignored for this walk, but doors on its edge are not.
    return !!entranceRoom && isPassable(level, cell) && cellX(cell) > entranceRoom.left && cellX(cell) < entranceRoom.right &&
      cellY(cell) > entranceRoom.top && cellY(cell) < entranceRoom.bottom;
  };
  const nearEntrance = walk(level.entrance, 8, walkable);
  const plants = new Set((level.plants ?? []).map((plant) => plant.pos));
  const ok = (mob: Mob, cell: number): boolean =>
    !taken(cell) && !mobs.some((other) => other.pos === cell) && !entranceFov[cell] && !nearEntrance[cell] &&
    isPassable(level, cell) && !hasFlag(level.map[cell]!, F.SOLID) && cell !== level.exit &&
    !isTrapCell(level, cell) && !plants.has(cell) && fits(level, mob, cell);
  const place = (mob: Mob, room: RoomInfo): boolean => {
    for (let tries = 30; tries >= 0; tries--) {
      mob.pos = randomCellIn(rng, room);
      if (ok(mob, mob.pos)) return true;
    }
    return false;
  };
  let index = 0;
  let mob: Mob | null = null;
  let guard = 0;
  while (toSpawn > 0 && guard++ < 1000) {
    mob ??= dealMob(world, level, rng, nextId(), -1, 0);
    if (index >= rooms.length) index = 0;
    const room = rooms[index++]!;
    if (!place(mob, room)) continue;
    toSpawn--;
    mobs.push(mob);
    mob = null;
    // A chance of a second monster in the same room, except on the first depth.
    if (level.depth > 1 && toSpawn > 0 && rng.int(4) === 0) {
      mob = dealMob(world, level, rng, nextId(), -1, 0);
      if (place(mob, room)) {
        toSpawn--;
        mobs.push(mob);
        mob = null;
      }
    }
  }
  for (const placed of mobs) if (level.map[placed.pos] === T.HIGH_GRASS) level.map[placed.pos] = T.GRASS;
  return mobs;
}

const isTrapCell = (level: Level, cell: number): boolean => hasFlag(level.map[cell]!, F.AVOID) && !hasFlag(level.map[cell]!, F.PIT);

/**
 * Level.randomRespawnCell (RegularLevel's): a free cell in a standard room but the entrance's, out of every hero's
 * sight, not the exit, where the monster fits; thirty tries. None on the last shop's level.
 */
export function respawnCell(ctx: Ctx, mob: Mob, seen: (cell: number) => boolean): number {
  const { level, world, depth, rng } = ctx;
  if (depth === LAST_SHOP_DEPTH) return -1;
  const standard = level.rooms.filter((room) => room.type === RoomType.STANDARD);
  const entrance = roomOf(level, level.entrance);
  for (let count = 0; count < 30; count++) {
    const room = rng.element(standard);
    if (!room || room === entrance) continue;
    const cell = randomCellIn(rng, room);
    if (!seen(cell) && !charAt(world, depth, cell) && isPassable(level, cell) && !hasFlag(level.map[cell]!, F.SOLID) &&
      fits(level, mob, cell) && cell !== level.exit) return cell;
  }
  return -1;
}

/**
 * MobSpawner.act and Level.spawnMob: while the level holds fewer enemies than it should, a new one (the
 * rotation's next) comes wandering from somewhere at least `disLimit` steps from every hero and out of their
 * sight — then the next in a respawn cooldown, or, failing to place it, a turn later.
 */
export function respawn(ctx: Ctx, disLimit = 12): void {
  // The blacksmith's mine keeps its own numbers (MiningLevel: minemobs.ts).
  if (mineRespawn(ctx)) return;
  const { world, depth, level, floor, rng } = ctx;
  const party = partySize(world);
  if (enemyCount(floor) < mobCount(mobLimit(world, level, rng), party) && !spawnMob(ctx, disLimit)) {
    // Try again in a turn.
    floor.respawn += 1;
    return;
  }
  floor.respawn += respawnTime(respawnCooldown(world, level, enemyCount(floor)), party);
}

/** Level.spawnMob: the rotation's next monster, wandering, placed far enough from the heroes; false if it found no place. */
function spawnMob(ctx: Ctx, disLimit: number): boolean {
  const { world, depth, level, floor, rng } = ctx;
  const heroes = heroesOn(world, depth);
  if (heroes.length === 0) return false;
  const seen = heroes.map((hero) => castShadow(hero.pos, terrainBlocksSight(level.map), heroSight(world, depth)));
  const steps = heroes.map((hero) => walk(hero.pos, disLimit - 1, (cell) => isPassable(level, cell) || hasFlag(level.map[cell]!, F.AVOID)));
  const mob = dealMob(world, level, rng, `#${++world.nextId}`, -1, floor.now);
  if (mob.state !== 'passive') mob.state = 'wandering';
  const near = (cell: number): boolean => steps.some((reached) => reached[cell]);
  let pos = -1;
  for (let tries = 30; tries > 0; tries--) {
    pos = respawnCell(ctx, mob, (cell) => seen.some((fov) => fov[cell]));
    if (pos !== -1 && !near(pos)) break;
  }
  if (pos === -1 || near(pos)) return false;
  mob.pos = pos;
  floor.mobs.push(mob);
  if (mob.champion) ctx.effects.push({ type: 'champion', depth, mob: mob.id, champion: mob.champion });
  return true;
}
