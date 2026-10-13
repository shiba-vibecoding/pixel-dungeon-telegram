import { createMob, type Hero, heroBelongings, isAlive, isHungry, type Mob, type MobKind, rollMob } from './actors';
import { canEnter, charAt, type Ctx, dropItem, enterCell, type Floor, freeCellNear, leaveCell, observe } from './floor';
import { collect } from './inventory';
import { createItem, type Item, itemDef, type ItemKind, ITEMS, rollFood } from './items';
import { missileStr } from './missiles';
import { meleeStr } from './weapons';
import { armorStr } from './armor';
import { ARENA_CENTRE, ARENA_DEPTHS, ARENA_RADIUS, ARENA_STANDS, buildArenaLevel, insideArena, ringDistance } from './level/arena';
import { identify } from './ident';
import { isInvisible } from './artifacts';
import { isBossDepth, LAST_SHOP_DEPTH } from './level/builder';
import { discoverable } from './level/flags';
import type { Level } from './level/generate';
import { distance, LENGTH, NEIGHBOURS8 } from './level/geometry';
import { T } from './level/terrain';
import { mobCount, partySize, scaleMob } from './party';
import { deriveSeed, type Rng, seedRng, Stream } from './rng';
import type { World } from './world';

/*
 * «Arena of waves»: an endless wave survival on a hand-made map (level/arena.ts).
 * Monsters of the region come through the four gates wave after wave; between
 * waves the party rests on the dais, the fallen get up again, and every hero
 * picks one of three rewards. Every fifth wave is a champions' wave: the
 * region's rare monsters, and the region's boss where its fight works outside
 * its lair (Goo, Tengu, DM-300); the King and Yog-Dzewa need their halls, so
 * their waves are elite packs instead. Every five waves the arena sinks a
 * region deeper; past the demon halls it stays, and the monsters only grow
 * more numerous and sturdier. The run ends when the whole party has fallen.
 *
 * All of it runs in the world's own turns (an arena turn, once a turn, while
 * a wave is on: see nextTurn in world.ts), on the depth's random stream, so the
 * room and every client play it alike.
 */

export interface ArenaSpawn {
  kind: MobKind;
  /** When it comes, on the depth's clock, and through which gate (0 north, 1 east, 2 south, 3 west). */
  at: number;
  gate: number;
  /** The wave's boss: it comes alone, and is announced. */
  boss?: boolean;
}

export interface ArenaState {
  /** The depth the arena stands on now: the tier's (ARENA_DEPTHS). */
  depth: number;
  /** The wave being fought, or the last one fought; 0 before the first. */
  wave: number;
  /** A wave is on, or the party rests between waves. */
  phase: 'rest' | 'fight';
  /** Monsters of this wave still to come, in order. */
  spawns: ArenaSpawn[];
  /** When the next arena turn comes (fight only). */
  tick: number;
  /** When the wave began, and when a monster last fell (for stragglers). */
  started: number;
  lastKill: number;
  /** How many monsters the wave brings in all. */
  count: number;
  /** Heroes ready for the next wave (rest only). */
  ready: string[];
  /** Each hero's three rewards to pick one from, until picked or the next wave starts. */
  offers: Record<string, Item[]>;
  /** Monsters slain in the arena, by anyone. */
  kills: number;
}

export const WAVES_PER_TIER = 5;
/**
 * Monsters that may be about at once: a wave flows in rather than coming as one blob. Few at
 * first, while the heroes are green; more as the waves go on, and more for a party.
 */
const aliveCap = (wave: number, party: number): number => Math.min(6, 1 + Math.floor(wave / 3)) + 2 * (party - 1);
/** The first wave whose monsters may be rare variants (an albino rat's bleeding is a death sentence at first). */
const RARES_FROM = 4;
/** How many come through a gate together, at most: one at a time in the first waves. */
const groupMax = (wave: number): number => (wave <= 2 ? 1 : wave <= 6 ? 2 : 3);
/** Turns a monster's last fall may be ago before stragglers are driven out of hiding. */
const STRAGGLERS = 150;
/** Past the demon halls' first tier, every wave makes monsters this much sturdier. */
const ENDLESS_HEALTH = 0.08;

export const isArena = (world: World): boolean => world.mode === 'arena' && world.arena !== undefined;

/** The tier of a wave: 0 sewers (waves 1-5), 1 prison, 2 caves, 3 city, 4 demon halls (21 and on). */
export const tierOf = (wave: number): number => Math.min(4, Math.floor((Math.max(1, wave) - 1) / WAVES_PER_TIER));

/** Every fifth wave. */
export const isChampionsWave = (wave: number): boolean => wave > 0 && wave % WAVES_PER_TIER === 0;

/**
 * The depth whose monsters and treasures a wave matches: the tier's depths in turn, never a boss's.
 * The first sewers' waves hold back a little (rats twice before the gnolls come), as a fresh hero
 * would meet the first depths' monsters one room at a time.
 */
export function equivalentDepth(wave: number): number {
  if (wave < WAVES_PER_TIER) return [1, 1, 1, 2, 3][Math.max(0, wave)]!;
  const depth = tierOf(wave) * WAVES_PER_TIER + 1 + ((Math.max(1, wave) - 1) % WAVES_PER_TIER);
  // The last shop (21) has no monsters of its own: the halls' first waves bring the next depth's.
  return isBossDepth(depth) ? depth - 1 : depth === LAST_SHOP_DEPTH ? depth + 1 : depth;
}

/** Monsters a wave brings, for the party: one fewer in the first three, while the heroes are green. */
export const waveBudget = (wave: number, party: number): number => mobCount(Math.round(2 + wave * 0.9) - (wave <= 3 ? 1 : 0), party);

/** Waves the party has come through. */
export const wavesCleared = (arena: ArenaState): number => (arena.phase === 'rest' ? arena.wave : arena.wave - 1);

/**
 * The run's score in the arena: waves cleared × 100, monsters slain × 5 and level × 10. For a
 * hero, their own kills and level; for the party, everyone's kills and the best level.
 */
export function arenaScore(world: World, heroId?: string): number {
  const arena = world.arena;
  if (!arena) return 0;
  const hero = world.heroes.find((h) => h.id === heroId);
  const kills = hero ? hero.kills : arena.kills;
  const lvl = hero?.lvl ?? Math.max(1, ...world.heroes.map((h) => h.lvl));
  return wavesCleared(arena) * 100 + kills * 5 + lvl * 10;
}

/** A fresh arena: the party on the dais of the sewers, resting before the first wave (see arenaJoined for the opening gift). */
export function newArena(): ArenaState {
  return {
    depth: ARENA_DEPTHS[0]!, wave: 0, phase: 'rest', spawns: [], tick: 0, started: 0, lastKill: 0, count: 0, ready: [], offers: {}, kills: 0,
  };
}

/** Allies and the harmless: what a wave does not wait for. */
const ALLIES: ReadonlySet<MobKind> = new Set(['mirror', 'bee', 'sheep']);

/** A monster the wave is made of (or born of it, as a swarm's split). */
export const hostile = (mob: Mob): boolean => mob.state !== 'passive' && !ALLIES.has(mob.kind) && !mob.image;

/** Monsters of the wave still to beat: those about and those still to come. */
export function arenaRemaining(world: World): number {
  const arena = world.arena;
  if (!arena || arena.phase !== 'fight') return 0;
  return arena.spawns.length + (world.floors[arena.depth]?.mobs.filter(hostile).length ?? 0);
}

/** The arena's level for a depth, made (with its floor) the first time it is wanted. */
export function arenaLevelAt(world: World, depth: number): Level {
  if (!world.levels[depth]) {
    const level = buildArenaLevel(world.run.seed, depth);
    world.levels[depth] = level;
    world.floors[depth] = {
      mobs: [], rng: seedRng(deriveSeed(world.run.seed, Stream.PLAY, depth)), now: 0, plants: [], respawn: -1, heaps: [],
    };
    // The party knows the whole pit from the start, the stands round it too; what is in it they still have to see.
    world.explored[depth] = discoverable(level.map).map((open, pos) => open || ringDistance(pos) <= ARENA_RADIUS + 1 + ARENA_STANDS);
  }
  return world.levels[depth]!;
}

/** Why an action is not for the arena now; null if it is fine; undefined if the arena has no say in it. */
export function arenaProblem(world: World, hero: Hero, action: { type: string; use?: unknown; choice?: unknown }): string | null | undefined {
  const arena = world.arena;
  switch (action.type) {
    case 'descend':
    case 'ascend':
    case 'jump':
      return arena ? 'there is no way out of the arena' : undefined;
    case 'artifact':
      return arena && action.use === 'return' ? 'art:lloydsbeacon.preventing' : undefined;
    case 'arenaReady':
      if (!arena) return 'not in the arena';
      return arena.phase === 'rest' ? null : 'the wave is on';
    case 'arenaPick': {
      if (!arena) return 'not in the arena';
      if (arena.phase !== 'rest') return 'the wave is on';
      const offer = arena.offers[hero.id];
      if (!offer) return 'nothing to pick';
      return Number.isInteger(action.choice) && (action.choice as number) >= 0 && (action.choice as number) < offer.length ? null : 'bad choice';
    }
    default:
      return undefined;
  }
}

/** «To battle!»: the hero is ready (or, pressed again, not after all); once every living hero is, the next wave begins. */
export function arenaReady(ctx: Ctx, hero: Hero, cancel = false): void {
  const arena = ctx.world.arena!;
  if (cancel) {
    if (arena.ready.includes(hero.id)) {
      arena.ready.splice(arena.ready.indexOf(hero.id), 1);
      ctx.effects.push({ type: 'arenaReady', hero: hero.id, ready: false });
    }
    return;
  }
  if (!arena.ready.includes(hero.id)) {
    arena.ready.push(hero.id);
    ctx.effects.push({ type: 'arenaReady', hero: hero.id, ready: true });
  }
  if (ctx.world.heroes.filter(isAlive).every((h) => arena.ready.includes(h.id))) startWave(ctx);
}

/** One of the three rewards: into the pack, or onto the dais if the pack is full. */
export function arenaPick(ctx: Ctx, hero: Hero, choice: number): void {
  const arena = ctx.world.arena!;
  const item = arena.offers[hero.id]![choice]!;
  delete arena.offers[hero.id];
  // The offer showed it for what it is: it is taken as such, its kind known to the party.
  if (identify(ctx.world, item)) ctx.effects.push({ type: 'identified', hero: hero.id, kind: item.kind });
  if (collect(hero, item)) {
    ctx.effects.push({ type: 'pickedUp', hero: hero.id, item });
  } else {
    dropItem(ctx.floor, freeHeapCell(ctx.floor, ctx.level), item);
    ctx.effects.push({ type: 'packFull', hero: hero.id });
  }
}

/**
 * A hero comes into the arena between waves: before the first, the arena master's opening gift to
 * pick from; later, a reward like everyone's, to catch up a little.
 */
export function arenaJoined(world: World, hero: Hero, rng: Rng): void {
  const arena = world.arena!;
  if (arena.phase === 'rest') arena.offers[hero.id] = rollOffer(rng, arena.wave, hero);
}

/** The arena's turn, once a turn while a wave is on: monsters come in, find the heroes, and the wave ends. */
export function arenaTurn(ctx: Ctx): void {
  const { world, floor } = ctx;
  const arena = world.arena!;
  arena.tick += 1;
  if (arena.phase !== 'fight') return;
  bringIn(ctx);
  const stalled = arena.spawns.length === 0 && floor.now - Math.max(arena.lastKill, arena.started) > STRAGGLERS;
  hunt(ctx, stalled);
  if (arena.spawns.length === 0 && !floor.mobs.some(hostile)) clearWave(ctx);
}

/** combat.ts: a monster fell. */
export function arenaKill(ctx: Ctx, mob: Mob): void {
  const arena = ctx.world.arena;
  if (!arena || !hostile(mob)) return;
  arena.kills++;
  arena.lastKill = ctx.floor.now;
}

/* The wave */

/** The region's rare monsters and strongest, for a champions' wave, by tier. */
const ELITES: ReadonlyArray<ReadonlyArray<readonly [MobKind, number]>> = [
  [['albino', 3], ['crab', 2], ['gnoll', 1]],
  [['bandit', 2], ['skeleton', 2], ['shaman', 1]],
  [['shielded', 2], ['spinner', 2], ['bat', 1]],
  [['senior', 2], ['golem', 2], ['warlock', 1], ['elemental', 1]],
  [['acidic', 2], ['succubus', 1], ['eye', 1], ['scorpio', 1]],
];

/**
 * Bosses who fight as well in the arena as in their lairs: Goo (its pools are in the corners),
 * Tengu (he jumps about whatever the floor) and DM-300 (its gas and falling rocks go anywhere).
 * The King of Dwarves summons from his pedestals and Yog-Dzewa needs its hall: their waves are elite packs.
 */
const BOSSES: Readonly<Record<number, MobKind>> = { 5: 'goo', 10: 'tengu', 15: 'dm300' };

/** What a wave is made of, in the order it comes. */
export function waveRoster(rng: Rng, wave: number, party: number): Array<{ kind: MobKind; boss?: boolean }> {
  const budget = waveBudget(wave, party);
  if (!isChampionsWave(wave)) {
    // Bestiary.mutable for the matching depth: now and then a rare variant, once the heroes have found their feet.
    return Array.from({ length: budget }, () => ({ kind: rollMob(rng, equivalentDepth(wave), wave >= RARES_FROM) }));
  }
  const boss = BOSSES[wave];
  const elites = ELITES[tierOf(wave)]!;
  const count = boss ? Math.max(2, Math.round(budget * 0.3)) : Math.max(3, Math.round(budget * 0.75));
  const roster: Array<{ kind: MobKind; boss?: boolean }> = Array.from({ length: count }, () => ({
    kind: elites[rng.chances(elites.map(([, chance]) => chance))]![0],
  }));
  // The boss comes after the first of its retinue, alone.
  if (boss) roster.splice(Math.min(2, roster.length), 0, { kind: boss, boss: true });
  return roster;
}

function startWave(ctx: Ctx): void {
  const { world, floor, rng, level } = ctx;
  const arena = world.arena!;
  arena.wave++;
  arena.phase = 'fight';
  arena.ready = [];
  arena.offers = {};
  arena.started = floor.now;
  arena.lastKill = floor.now;
  arena.tick = floor.now + 1;
  const roster = waveRoster(rng, arena.wave, partySize(world));
  arena.count = roster.length;
  // In groups of one to three at a random gate, every three or four turns: a flow, not a blob.
  arena.spawns = [];
  let at = floor.now + 2;
  for (let i = 0; i < roster.length;) {
    const size = roster[i]!.boss ? 1 : Math.min(roster.length - i, rng.intRange(1, groupMax(arena.wave)));
    const gate = rng.int(4);
    for (let j = 0; j < size; j++) {
      // A boss never comes in someone else's group.
      if (j > 0 && roster[i]!.boss) break;
      const { kind, boss } = roster[i]!;
      arena.spawns.push({ kind, at, gate, ...(boss ? { boss } : {}) });
      i++;
      if (i < roster.length && roster[i]!.boss) break;
    }
    at += arena.wave <= 2 ? rng.intRange(5, 7) : rng.intRange(3, 4);
  }
  const ring = level.ring!;
  for (const gate of ring.gates) if (level.map[gate] === T.LOCKED_DOOR) level.map[gate] = T.DOOR;
  ctx.effects.push({ type: 'arenaGates', depth: ctx.depth, open: true, cells: [...ring.gates] });
  const boss = roster.find((entry) => entry.boss)?.kind;
  ctx.effects.push({
    type: 'arenaWave', depth: ctx.depth, wave: arena.wave, champions: isChampionsWave(arena.wave), tier: tierOf(arena.wave),
    count: roster.length, ...(boss ? { boss } : {}),
  });
}

/** The monsters whose time has come step out of the pens, as many as may be about at once. */
function bringIn(ctx: Ctx): void {
  const { world, floor, level, rng } = ctx;
  const arena = world.arena!;
  const ring = level.ring!;
  const cap = aliveCap(arena.wave, partySize(world));
  const heroes = world.heroes.filter((hero) => isAlive(hero) && hero.depth === ctx.depth);
  if (heroes.length === 0) return;
  while (arena.spawns.length > 0 && arena.spawns[0]!.at <= floor.now && floor.mobs.filter(hostile).length < cap) {
    const spawn = arena.spawns[0]!;
    // Through its own gate, unless a hero holds that pen: then the next one round.
    let pos = -1;
    for (let k = 0; k < 4 && pos === -1; k++) {
      const pen = ring.pens[(spawn.gate + k) % 4]!;
      if (k < 3 && pen.some((cell) => heroes.some((hero) => hero.pos === cell))) continue;
      const free = pen.filter((cell) => canEnter(level, cell) && !charAt(world, ctx.depth, cell));
      if (free.length > 0) pos = free[rng.int(free.length)]!;
    }
    // Every pen full: the rest wait their turn.
    if (pos === -1) return;
    arena.spawns.shift();
    const mob = scaleMob(world, createMob(`#${++world.nextId}`, spawn.kind, pos, 'hunting', floor.now));
    const endless = Math.max(0, arena.wave - 5 * WAVES_PER_TIER);
    if (endless > 0) mob.ht = mob.hp = Math.round(mob.ht * (1 + ENDLESS_HEALTH * endless));
    const prey = nearest(heroes, pos);
    Object.assign(mob, { enemy: prey.id, target: prey.pos });
    floor.mobs.push(mob);
    enterCell(level, pos);
    if (spawn.boss) {
      ctx.effects.push({ type: 'noticed', depth: ctx.depth, mob: mob.id });
      ctx.effects.push({ type: 'yell', depth: ctx.depth, mob: mob.id, kind: mob.kind, line: 'notice', hero: prey.id });
    }
  }
}

const nearest = (heroes: readonly Hero[], pos: number): Hero =>
  heroes.reduce((best, hero) => (distance(hero.pos, pos) < distance(best.pos, pos) ? hero : best));

/**
 * The arena's monsters know where the heroes are: one that has lost sight of its prey goes
 * for the nearest hero it can find (an invisible one it cannot). Stragglers that hid or ran
 * too long are driven out too.
 */
function hunt(ctx: Ctx, stalled: boolean): void {
  const heroes = ctx.world.heroes.filter((hero) => isAlive(hero) && hero.depth === ctx.depth && !isInvisible(hero));
  if (heroes.length === 0) return;
  for (const mob of ctx.floor.mobs) {
    if (!hostile(mob)) continue;
    if (mob.state === 'fleeing' && !stalled) continue;
    if (mob.state === 'hunting' && mob.enemySeen) continue;
    const prey = nearest(heroes, mob.pos);
    mob.state = 'hunting';
    mob.enemy = prey.id;
    mob.target = prey.pos;
  }
}

/** The last monster has fallen: the gates shut, the fallen get up, rewards are handed out. */
function clearWave(ctx: Ctx): void {
  const { world, floor, level } = ctx;
  const arena = world.arena!;
  arena.phase = 'rest';
  arena.spawns = [];
  arena.ready = [];
  ctx.effects.push({ type: 'arenaCleared', depth: ctx.depth, wave: arena.wave });
  const ring = level.ring!;

  // Whoever is out in a pen (or in a gateway) comes back to the dais; what lies there, to the gate's mouth.
  const outside = (pos: number): boolean => !insideArena(pos);
  for (const hero of world.heroes) {
    if (isAlive(hero) && hero.depth === ctx.depth && outside(hero.pos)) placeOnDais(ctx, hero, level, floor);
  }
  for (const heap of [...floor.heaps]) {
    if (!outside(heap.pos)) continue;
    // To the gate it lies behind: the nearest one.
    const mouth = ring.mouths.reduce((best, m) => (distance(m, heap.pos) < distance(best, heap.pos) ? m : best));
    floor.heaps.splice(floor.heaps.indexOf(heap), 1);
    for (const item of heap.items) dropItem(floor, mouth, item);
  }
  for (const gate of ring.gates) {
    if (charAt(world, ctx.depth, gate)) continue;
    level.map[gate] = T.LOCKED_DOOR;
  }
  ctx.effects.push({ type: 'arenaGates', depth: ctx.depth, open: false, cells: [...ring.gates] });

  // The fallen get up on the dais, with half their health, rid of whatever ailed them.
  for (const fallen of world.heroes) {
    if (isAlive(fallen)) continue;
    Object.assign(fallen, {
      hp: Math.max(1, Math.floor(fallen.ht / 2)), intent: null, regen: 0, ooze: -1, poison: 0, burning: 0, paralysed: 0, rooted: 0,
      slowed: 0, hunger: 0, weakened: 0, crippled: 0, charmed: 0, charmedBy: null, deferred: 0, blind: 0,
      bleeding: 0,
    });
    fallen.depth = ctx.depth;
    placeOnDais(ctx, fallen, level, floor);
    ctx.effects.push({ type: 'revived', hero: fallen.id });
  }

  // Every five waves the arena sinks a region deeper.
  if (tierOf(arena.wave + 1) !== tierOf(arena.wave)) sink(ctx, tierOf(arena.wave + 1));

  for (const hero of world.heroes) {
    if (!isAlive(hero)) continue;
    arena.offers[hero.id] = rollOffer(ctx.rng, arena.wave, hero);
    ctx.effects.push({ type: 'arenaOffer', hero: hero.id, items: arena.offers[hero.id]! });
  }
}

/** The arena of the next tier: the party, and whatever lay about, go down with the dais. */
function sink(ctx: Ctx, tier: number): void {
  const { world } = ctx;
  const arena = world.arena!;
  const depth = ARENA_DEPTHS[tier]!;
  const level = arenaLevelAt(world, depth);
  const floor = world.floors[depth]!;
  floor.now = Math.max(floor.now, ctx.floor.now);
  const items = ctx.floor.heaps.filter((heap) => heap.kind === 'heap').flatMap((heap) => heap.items);
  ctx.floor.heaps = ctx.floor.heaps.filter((heap) => heap.kind !== 'heap');
  for (const item of items) dropItem(floor, freeHeapCell(floor, level), item);
  for (const hero of world.heroes) {
    if (!isAlive(hero) || hero.depth !== ctx.depth) continue;
    leaveCell(world, ctx.level, ctx.depth, hero.pos);
    hero.depth = depth;
    placeOnDais(ctx, hero, level, floor);
  }
  arena.depth = depth;
  ctx.effects.push({ type: 'arenaSinks', depth, tier });
}

function placeOnDais(ctx: Ctx, hero: Hero, level: Level, floor: Floor): void {
  const from = hero.pos;
  hero.pos = freeCellNear(ctx.world, level, hero.depth, ARENA_CENTRE);
  if (hero.depth === ctx.depth && from !== hero.pos) leaveCell(ctx.world, ctx.level, ctx.depth, from);
  hero.time = Math.max(hero.time, floor.now);
  enterCell(level, hero.pos);
  observe(ctx.world, hero);
}

/** A cell of the dais (or by it) with nothing lying on it yet, for a reward or what came down with the arena. */
function freeHeapCell(floor: Floor, level: Level): number {
  const seen = new Set([ARENA_CENTRE]);
  const queue = [ARENA_CENTRE];
  for (let head = 0; head < queue.length; head++) {
    const cell = queue[head]!;
    if (canEnter(level, cell) && !floor.heaps.some((heap) => heap.pos === cell)) return cell;
    for (const n of NEIGHBOURS8) {
      const next = cell + n;
      if (next >= 0 && next < LENGTH && !seen.has(next) && canEnter(level, next) && insideArena(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return ARENA_CENTRE;
}

/* Rewards */

/** What a reward may be, and how likely: kit to fight with, and things to use. */
/*
 * The arena's rewards. Not the dungeon's mix: there is nothing to map, identify, uncurse or
 * flee to in the pit, so those never come. An offer is three things for three needs — one to
 * stay alive, one for the next wave's crowd, one to grow stronger — so each pick is a real
 * choice. Gear on offer is better than what the hero wields and within their strength; stacks
 * grow with the waves.
 */

type Make = (rng: Rng, wave: number, hero: Hero) => Item | null;
type Pool = ReadonlyArray<readonly [number, Make]>;

const kindOf = (kind: ItemKind, qty = 1): Make => () => createItem(kind, qty);
const has = (hero: Hero, kind: ItemKind): boolean =>
  heroBelongings(hero).some((item) => item.kind === kind);
const wands = (hero: Hero): number => hero.items.filter((item) => itemDef(item.kind).category === 'wand').length;

/** To stay alive through the next wave. */
const SURVIVE: Pool = [
  [6, (rng, wave) => createItem('potion.healing', wave >= 8 && rng.int(3) === 0 ? 2 : 1)],
  [2, kindOf('seed.sungrass', 2)],
  [2, kindOf('seed.earthroot', 2)],
  [2, kindOf('honeypot')],
  [2, kindOf('scroll.mirrorImage')],
  // Should the hero fall, once: a late and rare gift.
  [1, (_rng, wave, hero) => (wave >= 8 && !has(hero, 'ankh') ? createItem('ankh') : null)],
];

/** Thrown weapons by the wave (kind, from wave, fewest, most): darts first, javelins and tomahawks later. */
const MISSILES: ReadonlyArray<readonly [ItemKind, number, number, number]> = [
  ['missile.dart', 0, 10, 16], ['missile.paralyticDart', 3, 3, 6], ['missile.incendiaryDart', 3, 3, 6], ['missile.shuriken', 6, 3, 3],
  ['missile.javelin', 8, 3, 3], ['missile.tomahawk', 12, 3, 3],
];

/** For the next wave's crowd: blasts, clouds, fear and sleep, and something to throw. */
const CROWD: Pool = [
  [4, (_rng, wave) => createItem('bomb', Math.min(3, 1 + Math.trunc(wave / 6)))],
  [3, kindOf('potion.liquidFlame')],
  [2, kindOf('potion.frost')],
  [2, kindOf('potion.paralyticGas')],
  [2, kindOf('potion.toxicGas')],
  [2, kindOf('scroll.terror')],
  [2, kindOf('scroll.lullaby')],
  [1, (_rng, wave) => (wave >= 6 ? createItem('scroll.psionicBlast') : null)],
  [1, (rng) => createItem(rng.oneOf(['seed.firebloom', 'seed.icecap', 'seed.sorrowmoss', 'seed.dreamweed'] as const), 2)],
  [4, (rng, wave, hero) => {
    const [kind, , fewest, most] = rng.oneOf(MISSILES.filter(([, from]) => wave >= from));
    // Heavy ones only for an arm strong enough to throw them well.
    if (missileStr(createItem(kind)) > hero.str + 2) return createItem('missile.dart', rng.intRange(10, 16));
    return createItem(kind, rng.intRange(fewest, most));
  }],
];

/** Battle wands worth carrying into a wave, and rings worth wearing in one. */
const BATTLE_WANDS: readonly ItemKind[] = [
  'wand.magicMissile', 'wand.fireblast', 'wand.lightning', 'wand.frost', 'wand.corrosion', 'wand.blastWave', 'wand.corruption',
  'wand.transfusion',
];
const LATE_WANDS: readonly ItemKind[] = ['wand.disintegration', 'wand.livingEarth', 'wand.prismaticLight', 'wand.warding'];
const FIGHTING_RINGS: readonly ItemKind[] = [
  'ring.haste', 'ring.evasion', 'ring.accuracy', 'ring.elements', 'ring.furor', 'ring.might', 'ring.tenacity', 'ring.force',
];

/**
 * A weapon or armour better than the one worn, which the hero can wield: of the same tier or
 * the next, upgraded enough to fit their strength (a level takes a point off what it asks).
 */
function betterGear(rng: Rng, wave: number, hero: Hero, slot: 'weapon' | 'armor'): Item {
  const worn = slot === 'weapon' ? hero.weapon : hero.armor;
  const wornTier = Math.min(5, worn ? (itemDef(worn.base ?? worn.kind).tier ?? 1) : 1);
  // The opening gift is always a step up; later, half the time, or always once the waves outgrow the tier.
  const tier = Math.min(5, wornTier + (wave === 0 || rng.int(2) === 0 || wave >= 4 * wornTier ? 1 : 0));
  const kinds = (Object.keys(ITEMS) as ItemKind[]).filter((kind) => {
    const def = itemDef(kind);
    return def.category === slot && def.tier === tier && kind !== 'weapon.pickaxe';
  });
  const kind = rng.oneOf(kinds);
  // Upgrades lower the strength wanted at +1, +3, +6...: as many as it takes to fit the hero's.
  const needs = (lvl: number): number => (slot === 'weapon' ? meleeStr(createItem(kind), lvl) : armorStr(createItem(kind), lvl));
  let fits = 0;
  while (needs(fits) > hero.str && fits < 30) fits++;
  let level = Math.max(Math.min(3, rng.int(2) + Math.trunc(wave / 7)), fits);
  // Of the same kind, it must still be the better of the two.
  if (worn && kind === worn.kind) level = Math.max(level, worn.level + 1);
  return createItem(kind, 1, Math.max(0, level));
}

/** To grow stronger: better gear, a battle wand, a ring, an enchantment, experience. */
const GROW: Pool = [
  [3, (rng, wave, hero) => betterGear(rng, wave, hero, 'weapon')],
  [3, (rng, wave, hero) => betterGear(rng, wave, hero, 'armor')],
  [3, (rng, wave, hero) => {
    if (wands(hero) >= 3) return null;
    const kinds = [...BATTLE_WANDS, ...(wave >= 8 ? LATE_WANDS : [])].filter((kind) => !has(hero, kind));
    return kinds.length > 0 ? createItem(rng.oneOf(kinds), 1, 1 + rng.int(2) + Math.trunc(wave / 8)) : null;
  }],
  [2, (rng, wave, hero) => {
    const kinds = [...FIGHTING_RINGS, ...(wands(hero) > 0 ? ['ring.energy' as const] : [])].filter((kind) => !has(hero, kind));
    return kinds.length > 0 ? createItem(rng.oneOf(kinds), 1, 1 + rng.int(2) + Math.trunc(wave / 8)) : null;
  }],
  [1, (_rng, _wave, hero) => (hero.weapon ? createItem('scroll.enchantment') : null)],
  [2, (_rng, _wave, hero) => (wands(hero) > 0 ? createItem('scroll.recharging') : null)],
  [2, kindOf('potion.experience')],
  [1, (_rng, wave) => (wave >= 8 ? createItem('potion.might') : null)],
  [1, (_rng, _wave, hero) => (has(hero, 'missile.heavyBoomerang') ? null : createItem('missile.heavyBoomerang', 3))],
];

/** One thing from a pool, not of a kind already on offer. */
function pick(rng: Rng, pool: Pool, wave: number, hero: Hero, taken: Set<string>): Item {
  for (let i = 0; i < 12; i++) {
    const item = pool[rng.chances(pool.map(([weight]) => weight))]![1](rng, wave, hero);
    if (item && !taken.has(item.kind)) {
      taken.add(item.kind);
      return item;
    }
  }
  // A pool runs dry only for a hero who has it all: a potion of healing is never wasted.
  return createItem('potion.healing');
}

/**
 * Three rewards for a hero after a wave: to survive, for the crowd, to grow. After a champions'
 * wave the third is a scroll of upgrade or a potion of strength; with nothing to eat, every third
 * wave (or when hungry) the first is food. Before the first wave, the arena master's opening
 * gift: a better weapon or armour, a potion of healing, and something for the crowd.
 */
export function rollOffer(rng: Rng, wave: number, hero: Hero): Item[] {
  const taken = new Set<string>();
  if (wave === 0) {
    return [betterGear(rng, 0, hero, rng.oneOf(['weapon', 'armor'] as const)), createItem('potion.healing'), pick(rng, CROWD, 0, hero, taken)];
  }
  const starving = !hero.items.some((item) => itemDef(item.kind).category === 'food') && (wave % 3 === 0 || isHungry(hero));
  const first = starving ? rollFood(rng) : pick(rng, SURVIVE, wave, hero, taken);
  const second = pick(rng, CROWD, wave, hero, taken);
  const third = isChampionsWave(wave)
    ? createItem(wave % (2 * WAVES_PER_TIER) === WAVES_PER_TIER ? 'scroll.upgrade' : 'potion.strength')
    : pick(rng, GROW, wave, hero, taken);
  return [first, second, third];
}
