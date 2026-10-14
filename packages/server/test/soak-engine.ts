import {
  act, type Action, ARTIFACT_USES, distance, findPath, canEnter, charAt, createItem, type Effect, fingerprint, floorAt, HERO_CLASSES, heroById, type HeroClass,
  isAlive, ITEMS, type Item, type ItemKind, itemDef, levelAt, swapsWithHero, LENGTH, MONK_ABILITIES, MOBS, NEIGHBOURS8, Rng, T, TALENTS, visibleCells, type World,
  allSpells, BACKPACK_SIZE, HUNGRY, STARVING, talentPointsFree, type TalentId,
} from '@pd/core';
import { botCheats, step } from '../../core/test/runner';
import { botAction, checkInvariants } from '../../core/test/helpers';
import { EntryWriter, fromEntries, toEntries } from '../src/run-store';
import { emptyProfile, ME, PlayerLogic, type RunSlot, type StartOptions } from '../src/runs';

/*
 * The soak: seeded runs of every class, played as a device plays them, then played again from the seed the way the
 * server does (PlayerLogic.sync over entries stored and loaded as the Player Durable Object keeps them), the
 * fingerprints compared at every sync point. Everything a run asks of the world besides actions (the "dev helpers":
 * jumping depths, making the hero sturdy, stocking the pack) is an explicit entry of the log, so both copies get the same.
 */

export interface Soft { count: number; first?: string; alias: number; aliasFirst?: string }

/** What the plain checks saw across all runs: objects with undefined values, and objects shared between places. */
export const softTotal: Soft = { count: 0, alias: 0 };

export type SoakMode = 'natural' | 'sturdy' | 'chaos';

export interface Spec {
  id: number;
  seed: number;
  heroClass: HeroClass;
  challenges: number;
  /** A daily dungeon's date, or null for an ordinary run. */
  daily: string | null;
  mode: SoakMode;
  /** A fallen hero's bones the ordinary run begins with (the depth they lie on and the kind of item), if any. */
  bones: { depth: number; kind: ItemKind } | null;
  /** How many actions the run may take at most (the turn cap). */
  cap: number;
  /** Depths to jump to on the way, with the action count at which each happens. */
  warps: Array<{ at: number; depth: number }>;
}

type Cheat =
  | { t: 'strengthen' }
  | { t: 'keep' }
  /** To the exit of the depth above `depth`; the bot then descends (a real action). */
  | { t: 'warp'; depth: number }
  /** Straight onto `depth`'s entrance (when descending did not work). */
  | { t: 'land'; depth: number }
  | { t: 'stock'; items: Item[] }
  /** The bot burns the soiled fist's grass away. */
  | { t: 'burn'; depth: number; cells: number[] };

export type Entry = { k: 'a'; a: Action } | { k: 'c'; c: Cheat };

export interface Failure {
  spec: number;
  seed: number;
  heroClass: HeroClass;
  mode: SoakMode;
  challenges: number;
  daily: string | null;
  kind: 'exception' | 'invariant' | 'stuck' | 'botlimit' | 'diverge' | 'plain' | 'refused' | 'server';
  /** Index into the log (actions and cheats). */
  at: number;
  depth: number;
  message: string;
}

export interface RunStats {
  deviceMs: number;
  replayMs: number;
  actions: number;
  deepest: number;
  over: boolean;
  victory: boolean;
  bosses: string[];
  checkpoints: number;
  syncs: number;
  /** Depths reached, for coverage. */
  depths: number[];
}

/* ----- specs ----- */

export function makeSpec(id: number): Spec {
  const rng = Rng.seeded(id * 7919 + 13);
  const heroClass = HERO_CLASSES[id % HERO_CLASSES.length]!;
  const round = Math.floor(id / HERO_CLASSES.length);
  const mode: SoakMode = (['sturdy', 'natural', 'chaos', 'sturdy', 'natural', 'chaos', 'sturdy'] as const)[round % 7]!;
  const roll = rng.int(10);
  let challenges = 0;
  if (roll >= 4 && roll < 9) challenges = rng.int(512);
  else if (roll === 9) challenges = 511;
  // About one run in six is the daily dungeon, under the day's own rules.
  const daily = rng.int(6) === 0 ? `2026-${String(1 + rng.int(12)).padStart(2, '0')}-${String(1 + rng.int(28)).padStart(2, '0')}` : null;
  const warps: Spec['warps'] = [];
  if (mode === 'chaos') {
    warps.push({ at: 0, depth: 1 + rng.int(26) });
  } else if (mode === 'natural') {
    // Natural play does not get far on its own: it is dropped onto the deeper floors in turn.
    let depth = 1;
    for (let at = 40; warps.length < 3; at += 150 + rng.int(300)) {
      depth = Math.min(26, depth + 1 + rng.int(9));
      warps.push({ at, depth });
    }
  } else if (rng.int(3) === 0) {
    // A sturdy run now and then skips ahead by a few floors.
    let depth = 1;
    for (let n = 1 + rng.int(3), at = 300; n > 0; n--, at += 500 + rng.int(3000)) {
      depth = Math.min(26, depth + 2 + rng.int(7));
      warps.push({ at, depth });
    }
  }
  const cap = mode === 'sturdy' ? 60000 : mode === 'natural' ? 4000 : 1500;
  const bones = !daily && rng.int(4) === 0 ? { depth: 1 + rng.int(8), kind: rng.oneOf(['weapon.sword', 'armor.mail', 'ring.haste', 'gold', 'weapon.mace', 'armor.leather'] as const) } : null;
  return { id, seed: 1 + rng.int(2 ** 30), heroClass, challenges, daily, mode, bones, cap, warps };
}

/** A player's logic as a run begins: with the bones of an earlier fallen hero, if the spec has them. */
function newLogic(spec: Spec): PlayerLogic {
  const profile = emptyProfile('Soak');
  if (spec.bones) profile.bones = { depth: spec.bones.depth, item: createItem(spec.bones.kind) };
  return new PlayerLogic(profile);
}

function startOptions(spec: Spec, runId: string): StartOptions {
  return {
    slot: spec.daily ? 'daily' : 'dungeon', heroClass: spec.heroClass, challenges: spec.challenges, name: 'Soak', seed: spec.seed, id: runId, now: 1,
    today: spec.daily ?? '2026-10-14', ...(spec.daily ? { dailySeed: spec.seed } : {}),
  };
}

/* ----- cheats (the dev helpers) ----- */

const burnCells = botCheats.burn;

const free = (world: World, depth: number, from: number): number => {
  const level = levelAt(world, depth);
  const seen = new Set([from]);
  const queue = [from];
  for (let head = 0; head < queue.length; head++) {
    const cell = queue[head]!;
    if (canEnter(level, cell) && !charAt(world, depth, cell)) return cell;
    for (const n of NEIGHBOURS8) {
      const next = cell + n;
      if (next >= 0 && next < LENGTH && !seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return from;
};

/** Marathon's strengthening: a sturdy hero with a hammer that outpaces what heals, for play to reach the Amulet. */
function strengthen(world: World): void {
  const hero = heroById(world, ME)!;
  Object.assign(hero, { attackSkill: 600, defenseSkill: 80, ht: Math.max(hero.ht, 5000), hp: Math.max(hero.hp, 1), str: 22 });
  if (hero.weapon?.kind !== 'weapon.warHammer' || hero.weapon.level < 20) hero.weapon = createItem('weapon.warHammer', 1, 20);
}

export function applyCheat(world: World, cheat: Cheat): void {
  const hero = heroById(world, ME)!;
  switch (cheat.t) {
    case 'strengthen':
      strengthen(world);
      hero.hp = Math.max(hero.hp, 5000);
      break;
    case 'keep':
      if (hero.hp > 0) hero.hp = hero.ht;
      hero.hunger = 0;
      break;
    case 'warp': {
      const from = cheat.depth - 1;
      if (from < 1) break;
      const level = levelAt(world, from);
      hero.depth = from;
      hero.pos = free(world, from, level.exit);
      hero.time = floorAt(world, from).now;
      break;
    }
    case 'land': {
      const level = levelAt(world, cheat.depth);
      hero.depth = cheat.depth;
      hero.pos = free(world, cheat.depth, level.entrance);
      hero.time = floorAt(world, cheat.depth).now;
      world.reached = Math.max(world.reached ?? 1, cheat.depth);
      break;
    }
    case 'burn':
      burnCells(world, cheat.depth, cheat.cells);
      break;
    case 'stock':
      hero.items = cheat.items.map((item) => structuredClone(item));
      Object.assign(hero, { ht: 300, hp: 300, attackSkill: 60, defenseSkill: 30 });
      break;
  }
}

/* ----- chaos ----- */

const KINDS = (Object.keys(ITEMS) as ItemKind[]).filter((kind) => kind !== 'gold' && kind !== 'quest.amulet');
const TALENT_IDS = Object.keys(TALENTS) as TalentId[];

function stockItems(rng: Rng, depth: number): Item[] {
  const kinds = [...KINDS];
  rng.shuffle(kinds);
  for (const kind of ['stone.augmentation', 'spiritBow', 'missile.dart', 'seed.icecap', 'artifact.beacon'] as const) {
    kinds.splice(kinds.indexOf(kind), 1);
    kinds.unshift(kind);
  }
  return kinds.slice(0, 18).map((kind) => {
    const item = createItem(kind, itemDef(kind).category === 'missile' || kind === 'bomb' ? 3 : 1);
    if (kind === 'waterskin') item.volume = 10;
    if (kind.startsWith('key.')) item.depth = depth;
    return item;
  });
}

/** Cases of chaosAction that use the hero's gear and class (no dropping, selling or wandering off). */
const CLASS_PLAY = [2, 3, 4, 8, 9, 10, 15, 19, 20, 21, 22];

function chaosAction(world: World, rng: Rng, cases?: readonly number[]): Action {
  const hero = heroById(world, ME)!;
  const level = levelAt(world, hero.depth);
  const seen = visibleCells(world, hero.depth);
  const cells = seen.flatMap((v, c) => (v ? [c] : []));
  const mobs = floorAt(world, hero.depth).mobs.filter((m) => NEIGHBOURS8.some((n) => m.pos === hero.pos + n));
  const item = rng.int(Math.max(1, hero.items.length));
  const target = rng.element(cells) ?? hero.pos + 1;
  const spells = allSpells(hero, world);
  switch (cases ? rng.oneOf(cases) : rng.int(24)) {
    case 0: case 16: case 17: return { type: 'move', to: hero.pos + rng.element(NEIGHBOURS8)! };
    case 1: case 18: return mobs.length > 0 ? { type: 'attack', target: rng.element(mobs)!.id } : { type: 'search' };
    case 2: return { type: 'use', item, target: rng.int(2) === 0 ? 'weapon' : 'armor' };
    case 3: return { type: 'throw', item, target };
    case 4: return { type: 'zap', item, target };
    case 5: return { type: 'equip', item };
    case 6: return { type: 'drop', item };
    case 7: return { type: 'pickup' };
    case 8: return { type: 'special', target };
    case 9: {
      const carried = hero.items.findIndex((i) => itemDef(i.kind).category === 'artifact');
      const ref = rng.int(2) === 0 && carried >= 0 ? carried : rng.oneOf(['artifact', 'misc'] as const);
      return { type: 'artifact', item: ref, use: rng.element(ARTIFACT_USES)!, cell: target, with: item, choice: rng.int(2), on: rng.int(2) === 0 ? item : 'armor' };
    }
    case 10: {
      const of = (kind: ItemKind): number => Math.max(0, hero.items.findIndex((i) => i.kind === kind));
      const augments = ['speed', 'damage', 'evasion', 'defense', 'none'] as const;
      switch (rng.int(4)) {
        case 0: return { type: 'augment', item: of('stone.augmentation'), on: rng.int(2) === 0 ? 'weapon' : 'armor', augment: rng.oneOf(augments) };
        case 1: return { type: 'shoot', item: of('spiritBow'), target };
        case 2: return { type: 'tip', item: of('missile.dart'), seed: hero.items.findIndex((i) => i.kind.startsWith('seed.')), all: rng.int(2) === 0 };
        default: return { type: 'clean', item, all: rng.int(2) === 0 };
      }
    }
    case 11: return hero.pos === level.exit ? { type: 'descend' } : { type: 'move', to: hero.pos + rng.element(NEIGHBOURS8)! };
    case 12: return { type: rng.oneOf(['branch', 'ascend', 'descend'] as const) };
    case 13: return { type: 'remove', slot: rng.oneOf(['artifact', 'misc', 'ring'] as const) };
    case 14: return { type: 'sell', item };
    case 15: return { type: 'use', item, on: rng.int(Math.max(1, hero.items.length)), cell: target, choice: rng.int(4) };
    case 19: return { type: 'talent', talent: rng.element(TALENT_IDS)! };
    case 20: return rng.oneOf<Action>([
      { type: 'ability', ability: 'berserk' }, { type: 'ability', ability: 'freerun' }, { type: 'ability', ability: 'snipe' },
      { type: 'ability', ability: 'combo', move: rng.oneOf(['clobber', 'slam', 'parry', 'crush', 'fury'] as const), target: mobs[0]?.id },
      { type: 'ability', ability: 'ambush', target: mobs[0]?.id ?? 'none' },
    ]);
    case 21: return rng.oneOf<Action>([
      { type: 'weaponAbility', which: rng.oneOf(['weapon', 'second'] as const), cell: target }, { type: 'swap' }, { type: 'stance' },
      { type: 'monk', ability: rng.oneOf(MONK_ABILITIES), cell: target },
    ]);
    case 22: {
      const spell = rng.element(spells);
      return spell ? { type: 'cast', spell: spell.id, cell: target, item: rng.int(Math.max(1, hero.items.length)), choice: rng.int(3) } : { type: 'quick', spell: null };
    }
    case 23: return rng.oneOf<Action>([
      { type: 'open', cell: hero.pos + rng.element(NEIGHBOURS8)! }, { type: 'jump', to: hero.pos + rng.element(NEIGHBOURS8)! }, { type: 'reward', choice: rng.oneOf(['weapon', 'armor'] as const) },
      { type: 'wandReward', choice: rng.oneOf([1, 2] as const) }, { type: 'buy' }, { type: 'dismiss', target: mobs[0]?.id ?? 'none' },
    ]);
    default: return { type: 'wait' };
  }
}

/** A hero who ignores the fight: one step on the way to the stairs (or to Yog), cutting through whoever is in the way. */
function rush(world: World): Action | null {
  const hero = heroById(world, ME)!;
  const level = levelAt(world, hero.depth);
  const floor = floorAt(world, hero.depth);
  const yog = floor.mobs.find((m) => m.kind === 'yog');
  if (!yog && hero.pos === level.exit) return { type: 'descend' };
  const goal = yog ? yog.pos : level.exit;
  if (yog && distance(hero.pos, yog.pos) === 1) return { type: 'attack', target: yog.id };
  const none = new Set<number>();
  const path = findPath(level, hero.pos, goal, none) ?? findPath(level, hero.pos, goal, none, undefined, false, true);
  if (!path || path.length === 0) return null;
  const blocker = floor.mobs.find((m) => m.pos === path[0]);
  if (blocker && !swapsWithHero(blocker)) return { type: 'attack', target: blocker.id };
  return { type: 'move', to: path[0]! };
}

/* ----- invariants ----- */

/** Things that must hold of a world at any time; thrown with a description. `deep`: everything, not just the hero's depth. */
export function soakInvariants(world: World, deep: boolean, locks = false): void {
  const hero = heroById(world, ME)!;
  const fail = (what: string): never => { throw new Error(what); };
  if (!Number.isInteger(hero.depth) || hero.depth < 1 || hero.depth > 26) fail(`hero on depth ${hero.depth}`);
  if (!Number.isInteger(hero.pos) || hero.pos < 0 || hero.pos >= LENGTH) fail(`hero at cell ${hero.pos}`);
  if (!Number.isFinite(hero.hp) || !Number.isFinite(hero.ht) || hero.ht <= 0) fail(`hero hp ${hero.hp}/${hero.ht}`);
  if (hero.hp > hero.ht) fail(`hero hp ${hero.hp} above ht ${hero.ht}`);
  if (isAlive(hero) && hero.hp <= 0) fail(`a living hero with ${hero.hp} hp`);
  if (!world.levels[hero.depth] || !world.floors[hero.depth]) fail(`depth ${hero.depth} was never made`);
  for (const value of [hero.gold, hero.hunger, hero.lvl, hero.exp, hero.str, hero.time]) {
    if (!Number.isFinite(value)) fail(`hero has a non-finite number (${value})`);
  }
  const items = [...hero.items, hero.weapon, hero.armor, hero.artifact, hero.misc, hero.ring].filter((i): i is Item => !!i);
  if (hero.items.length > BACKPACK_SIZE + 12) fail(`hero carries ${hero.items.length} items`);
  const check = (item: Item, where: string): void => {
    if (!(item.kind in ITEMS)) fail(`${where}: unknown item kind ${item.kind}`);
    if (!Number.isInteger(item.qty) || item.qty < 1) fail(`${where}: ${item.kind} x${item.qty}`);
    if (!Number.isFinite(item.level)) fail(`${where}: ${item.kind} level ${item.level}`);
    if (item.kind.startsWith('key.') && !Number.isInteger(item.depth)) fail(`${where}: ${item.kind} without a depth`);
  };
  for (const item of items) check(item, 'hero');
  const depths = deep ? Object.keys(world.floors).map(Number) : [hero.depth];
  for (const depth of depths) {
    const floor = world.floors[depth]!;
    const level = levelAt(world, depth);
    const taken = new Map<number, string>();
    for (const mob of floor.mobs) {
      if (!(mob.kind in MOBS)) fail(`depth ${depth}: unknown mob ${mob.kind}`);
      if (!Number.isInteger(mob.pos) || mob.pos < 0 || mob.pos >= LENGTH) fail(`depth ${depth}: ${mob.id} at ${mob.pos}`);
      if (mob.hp <= 0 || mob.hp > mob.ht) fail(`depth ${depth}: ${mob.id} (${mob.kind}) has ${mob.hp}/${mob.ht} HP`);
      if (taken.has(mob.pos)) fail(`depth ${depth}: ${mob.id} and ${taken.get(mob.pos)} share cell ${mob.pos}`);
      taken.set(mob.pos, mob.id);
      if (hero.depth === depth && isAlive(hero) && hero.pos === mob.pos) fail(`depth ${depth}: ${mob.id} (${mob.kind}) and the hero share cell ${mob.pos}`);
      for (const loot of mob.loot ?? []) check(loot, `mob ${mob.id}`);
    }
    const cellsWithHeap = new Set<number>();
    for (const heap of floor.heaps) {
      if (!Number.isInteger(heap.pos) || heap.pos < 0 || heap.pos >= LENGTH) fail(`depth ${depth}: heap at ${heap.pos}`);
      if (cellsWithHeap.has(heap.pos)) fail(`depth ${depth}: two heaps on cell ${heap.pos}`);
      cellsWithHeap.add(heap.pos);
      if (heap.items.length === 0 && heap.kind !== 'hidden') fail(`depth ${depth}: an empty ${heap.kind} heap at ${heap.pos}`);
      for (const item of heap.items) check(item, `depth ${depth} heap ${heap.pos}`);
      const t = level.map[heap.pos]!;
      // (A jump past an unslain boss, then back up, leaves the hero on the walled-up exit of its level: the helper's doing, not the game's.)
      if ((t === T.WALL || t === T.SECRET_DOOR) && heap.pos !== hero.pos) fail(`depth ${depth}: a heap in a wall at ${heap.pos} (terrain ${t})`);
    }
    for (const item of floor.falling ?? []) check(item, `depth ${depth} falling`);
  }
  if (!locks) return;
  // Keys for locks: a locked door, golden or crystal chest on the hero's depth has a key somewhere in the world.
  const floor = world.floors[hero.depth]!;
  const level = levelAt(world, hero.depth);
  const keyHeld = (kind: ItemKind): boolean =>
    items.some((i) => i.kind === kind && i.depth === hero.depth) ||
    floor.heaps.some((h) => h.items.some((i) => i.kind === kind && i.depth === hero.depth)) ||
    floor.mobs.some((m) => (m.loot ?? []).some((i) => i.kind === kind && i.depth === hero.depth) || m.item?.kind === kind) ||
    (floor.falling ?? []).some((i) => i.kind === kind && i.depth === hero.depth);
  const lockedDoor = level.map.some((t) => t === T.LOCKED_DOOR);
  if (lockedDoor && !keyHeld('key.iron') && hero.depth !== 10) {
    // (The iron keys of boss levels are held by the boss fight's own state; every other locked door has its key about.)
    if (!level.boss && !level.arenaDoor) fail(`depth ${hero.depth}: a locked door and no iron key anywhere`);
  }
  if (floor.heaps.some((h) => h.kind === 'lockedChest') && !keyHeld('key.golden')) fail(`depth ${hero.depth}: a locked chest and no golden key anywhere`);
  if (floor.heaps.some((h) => h.kind === 'crystalChest') && !keyHeld('key.crystal')) fail(`depth ${hero.depth}: a crystal chest and no crystal key anywhere`);
  if (deep) checkInvariants(world);
}

/**
 * Whether the world would come back from JSON as itself. Hard problems (Maps, Sets, classes, NaN, infinities,
 * functions) are returned; objects with undefined values are counted into `soft`, which are plain only to a
 * storage that drops them.
 */
export function plainProblems(world: unknown, soft?: Soft): string[] {
  const problems: string[] = [];
  const seen = new Set<unknown>();
  const walk = (value: unknown, path: string): void => {
    if (problems.length >= 5) return;
    switch (typeof value) {
      case 'number':
        if (!Number.isFinite(value)) problems.push(`${path} is ${value}`);
        return;
      case 'string': case 'boolean': return;
      case 'undefined': problems.push(`${path} is undefined in an array`); return;
      case 'function': case 'symbol': case 'bigint': problems.push(`${path} is a ${typeof value}`); return;
      default:
    }
    if (value === null) return;
    if (seen.has(value)) {
      // The same object in two places comes back from storage as two (harmless unless one is changed later): counted, not failed.
      if (soft) {
        soft.alias++;
        soft.aliasFirst ??= path;
      }
      return;
    }
    seen.add(value);
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        if (!(i in value)) problems.push(`${path}[${i}] is a hole`);
        else if (value[i] === undefined) problems.push(`${path}[${i}] is undefined`);
        else walk(value[i], `${path}[${i}]`);
      }
      return;
    }
    const proto = Object.getPrototypeOf(value) as unknown;
    if (proto !== Object.prototype && proto !== null) {
      problems.push(`${path} is a ${(value as object).constructor?.name ?? 'class instance'}`);
      return;
    }
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === undefined) {
        if (soft) {
          soft.count++;
          soft.first ??= `${path}.${key}`;
        }
        continue;
      }
      walk(v, `${path}.${key}`);
    }
  };
  walk(world, 'world');
  return problems;
}

/* ----- the device ----- */

export interface Checkpoint {
  /** Entries taken so far. */
  n: number;
  fp: string;
  /** The run's seq: accepted actions so far. */
  seq: number;
}

export interface Played {
  log: Entry[];
  checkpoints: Checkpoint[];
  stats: RunStats;
  failures: Failure[];
  world: World;
}

const sig = (error: unknown): string => {
  const e = error as Error;
  return `${e.message ?? String(e)}\n${(e.stack ?? '').split('\n').filter((l) => l.includes('/src/') || l.includes('\\src\\')).slice(0, 4).join('\n')}`;
};

/** Plays a run as a device does: the bot's actions through `act`, the log of what was taken, and a fingerprint at each sync point. */
export function playDevice(
  spec: Spec, options: { every?: number; deepEvery?: number; snapshot?: (world: World, checkpoint: Checkpoint) => void; explain?: boolean;
    /** Called after each action taken (for tracing a failure). */
    trace?: (world: World, action: Action, seq: number, effects: Effect[]) => void } = {},
): Played {
  const runId = `soak${spec.id}`;
  const logic = newLogic(spec);
  const start = startOptions(spec, runId);
  const world = structuredClone(logic.start(start).world);
  const rng = Rng.seeded(spec.seed ^ 0x50a4);
  // (The sync points have a stream of their own, so that the run does not depend on where they fall.)
  const syncRng = Rng.seeded(spec.seed ^ 0xc4ec);
  const log: Entry[] = [];
  const checkpoints: Checkpoint[] = [];
  const failures: Failure[] = [];
  const bosses = new Set<string>();
  const reached = new Set<number>([1]);
  let seq = 0;
  let nextCheckpoint = 1 + syncRng.int(options.every ?? 60);
  let lastDepth = 1;
  let lastProgress = 0;
  let progressMark = '';
  /** Times a step of the sturdy bot took it onto a teleportation trap since it last made progress. */
  let trapTeleports = 0;
  const stats: RunStats = { deviceMs: 0, replayMs: 0, actions: 0, deepest: 1, over: false, victory: false, bosses: [], checkpoints: 0, syncs: 0, depths: [] };
  const fail = (kind: Failure['kind'], message: string): void => {
    failures.push({
      spec: spec.id, seed: spec.seed, heroClass: spec.heroClass, mode: spec.mode, challenges: spec.challenges, daily: spec.daily, kind, at: log.length,
      depth: heroById(world, ME)?.depth ?? 0, message,
    });
  };
  const checkpoint = (): void => {
    const cp = { n: log.length, fp: fingerprint(world), seq };
    checkpoints.push(cp);
    options.snapshot?.(world, cp);
    stats.checkpoints++;
    nextCheckpoint = seq + 1 + syncRng.int(options.every ?? 60);
  };
  const cheat = (c: Cheat): void => {
    // A cheat is made between two syncs (the server is told of it at the same place in the log).
    checkpoint();
    log.push({ k: 'c', c });
    applyCheat(world, c);
    checkpoint();
  };
  botCheats.burn = (w, depth, cells) => cheat({ t: 'burn', depth, cells: [...cells] });
  let warpIndex = 0;
  let pendingDescend = false;
  let landTried = false;
  try {
    if (spec.mode === 'sturdy') cheat({ t: 'strengthen' });
    for (let i = 0; i < spec.cap && !world.over; i++) {
      const hero = heroById(world, ME)!;
      if (!isAlive(hero)) break;
      // The jumps of the plan.
      const warp = spec.warps[warpIndex];
      if (warp && i >= warp.at && hero.depth < warp.depth && !pendingDescend) {
        warpIndex++;
        if (spec.mode === 'chaos' && warp.at === 0) {
          const stock = stockItems(rng, warp.depth);
          cheat({ t: 'stock', items: stock });
        }
        cheat({ t: 'warp', depth: warp.depth });
        pendingDescend = true;
        landTried = false;
      }
      let action: Action;
      if (pendingDescend) {
        action = { type: 'descend' };
      } else if (spec.mode === 'chaos') {
        action = chaosAction(world, rng);
        if (i % 40 === 39) cheat({ t: 'keep' });
      } else {
        const free = talentPointsFree(heroById(world, ME)!);
        action = free > 0 && rng.int(3) === 0 ? { type: 'talent', talent: rng.element(TALENT_IDS)! } : spec.mode === 'sturdy' ? step(world, ME) : botAction(world, ME, 26);
        // Held up for long (summoners and boss minions keep a bot fighting at the door), the sturdy hero pushes on regardless.
        if (spec.mode === 'sturdy' && seq - lastProgress > 1500) action = rush(world) ?? action;
        // Now and then the hero tries its class and its gear.
        if (rng.int(spec.mode === 'sturdy' ? 25 : 8) === 0) action = chaosAction(world, rng, CLASS_PLAY);
        const h = heroById(world, ME)!;
        if (spec.mode === 'sturdy' ? h.hp < h.ht / 2 || h.hunger >= HUNGRY * 0.7 : h.hp < h.ht / 3 || h.hunger >= STARVING * 0.8) cheat({ t: 'keep' });
      }
      let result;
      // A refused action is not sent to the server: it must leave the world as it was (looked at in chaos and natural play, and early in the others).
      const strict = spec.mode !== 'sturdy' || seq < 300;
      const before = strict ? fingerprint(world) : '';
      const picture = strict && options.explain ? structuredClone(world) : null;
      try {
        result = act(world, ME, action);
      } catch (error) {
        fail('exception', `${JSON.stringify(action)}: ${sig(error)}`);
        return finish();
      }
      if (!result.ok) {
        if (strict && fingerprint(world) !== before) {
          fail('refused', `${JSON.stringify(action)} was refused (${result.reason}) but changed the world${picture ? `: ${diffWorlds(picture, world).join('; ')}` : ''}`);
          return finish();
        }
        if (pendingDescend) {
          // The way down was refused: land on the depth, as a dev helper would.
          if (!landTried) {
            landTried = true;
            const depth = warp?.depth ?? spec.warps[warpIndex - 1]!.depth;
            cheat({ t: 'land', depth });
          }
          pendingDescend = false;
          continue;
        }
        // The bot waits when it cannot do what it chose.
        try {
          result = act(world, ME, { type: 'wait' });
        } catch (error) {
          fail('exception', `wait after a refused ${JSON.stringify(action)}: ${sig(error)}`);
          return finish();
        }
        if (!result.ok) continue;
        action = { type: 'wait' };
      }
      pendingDescend = false;
      log.push({ k: 'a', a: action });
      seq++;
      stats.actions++;
      options.trace?.(world, action, seq, result.effects as Effect[]);
      for (const effect of result.effects as Effect[]) {
        if (effect.type === 'bossSlain') bosses.add(effect.kind);
        if (effect.type === 'teleported' && action.type === 'move') trapTeleports++;
      }
      const now = heroById(world, ME)!;
      const priorDepth = lastDepth;
      if (now.depth !== lastDepth) {
        lastDepth = now.depth;
        reached.add(now.depth);
        stats.deepest = Math.max(stats.deepest, now.depth);
        // The device syncs on a change of depth.
        checkpoint();
      }
      try {
        // (The locks and their keys are looked at on arrival: a player may throw a key into a chasm, where it falls to the depth below, as in Shattered.)
        soakInvariants(world, seq % 97 === 0, now.depth !== priorDepth);
      } catch (error) {
        fail('invariant', `after ${JSON.stringify(action)}: ${(error as Error).message}`);
        return finish();
      }
      if (seq % (options.deepEvery ?? 400) === 0) {
        const soft: Soft = { count: 0, alias: 0 };
        const problems = plainProblems(world, soft);
        if (problems.length > 0) {
          fail('plain', problems.join('; '));
          return finish();
        }
        softTotal.count += soft.count;
        softTotal.alias += soft.alias;
        softTotal.first ??= soft.first;
        softTotal.aliasFirst ??= soft.aliasFirst;
      }
      if (seq >= nextCheckpoint) checkpoint();
      if (spec.mode === 'sturdy') {
        const mark = `${now.depth}:${now.lvl}:${now.exp}:${Object.keys(world.levels).length}`;
        if (mark !== progressMark) {
          progressMark = mark;
          lastProgress = seq;
          trapTeleports = 0;
        } else if (seq - lastProgress > 3000) {
          // Yog's hall: the runner's boss script (test/runner.ts) does not always find its way through the fists and the summoned
          // rippers (about one sturdy run in twenty); a limit of the bot, reported apart, not as a failure.
          const walled = now.depth === 25 && floorAt(world, 25).mobs.some((m) => m.kind === 'yog');
          // (Or the bot's way to a secret door crosses a teleportation trap, and it is sent back again and again.)
          fail(walled || trapTeleports >= 5 ? 'botlimit' : 'stuck', `no progress for ${seq - lastProgress} actions at depth ${now.depth} cell ${now.pos}; last ${JSON.stringify(action)}`);
          return finish();
        }
      }
    }
  } catch (error) {
    fail('exception', sig(error));
  }
  return finish();

  function finish(): Played {
    botCheats.burn = burnCells;
    stats.over = world.over;
    stats.victory = world.victory;
    stats.bosses = [...bosses];
    stats.depths = [...reached];
    if (log.length > 0 && checkpoints.at(-1)?.n !== log.length) checkpoint();
    return { log, checkpoints, stats, failures, world };
  }
}

/* ----- the server ----- */

/** The Player Durable Object's way with storage: what changed is written, and the run comes back from what was written. */
export class ServerSim {
  readonly storage = new Map<string, string>();
  private writer = new EntryWriter();
  logic: PlayerLogic;
  readonly slot: RunSlot;
  readonly runId: string;
  syncs = 0;

  constructor(spec: Spec, runId: string) {
    this.runId = runId;
    this.logic = newLogic(spec);
    const run = this.logic.start(startOptions(spec, runId));
    this.slot = run.slot;
    this.persist(true, new Set());
  }

  private persist(fresh: boolean, touched: ReadonlySet<number>): void {
    const entries = toEntries(this.logic.profile, this.logic.runs, (key, _slot, depth) => (fresh || touched.has(depth) ? undefined : this.writer.get(key)));
    const { put, remove } = this.writer.changes(entries);
    for (const [key, value] of Object.entries(put)) this.storage.set(key, value);
    for (const key of remove) this.storage.delete(key);
  }

  /** The Player object waking up: everything from storage. */
  reload(): void {
    const loaded = fromEntries(this.storage);
    this.writer.loaded(this.storage);
    this.logic = new PlayerLogic(loaded.profile, loaded.runs);
  }

  get world(): World {
    return this.logic.runs[this.slot]!.world;
  }

  /** A sync as the Player object does it; a reply with a world (or a refusal) is a divergence. */
  sync(from: number, actions: readonly Action[], hash: string | null) {
    this.syncs++;
    const result = this.logic.sync(this.slot, this.runId, from, actions, hash, 1000 + this.syncs);
    this.persist(false, result.touched);
    return result;
  }

  /** A dev helper's change to the run, written out whole. */
  cheat(c: Cheat): void {
    applyCheat(this.world, c);
    this.persist(true, new Set());
  }
}

export interface ReplayOptions {
  /** Load the run from storage before every sync (the Player object evicted between requests). Default true. */
  reload?: boolean;
  /** Called with the server's copy at a checkpoint that parts from the device's. */
  onParted?: (world: World, checkpoint: Checkpoint) => void;
}

/** Plays a run's log again from its seed on the server's side. Returns the failures (the first divergence, usually). */
export function replayOnServer(spec: Spec, played: Played, options: ReplayOptions = {}): Failure[] {
  const failures: Failure[] = [];
  const { log, checkpoints } = played;
  const runId = `soak${spec.id}`;
  const fail = (kind: Failure['kind'], at: number, message: string): void => {
    failures.push({ spec: spec.id, seed: spec.seed, heroClass: spec.heroClass, mode: spec.mode, challenges: spec.challenges, daily: spec.daily, kind, at, depth: 0, message });
  };
  let sim: ServerSim;
  try {
    sim = new ServerSim(spec, runId);
  } catch (error) {
    fail('server', 0, `start: ${sig(error)}`);
    return failures;
  }
  let n = 0;
  let seq = 0;
  let pending: Action[] = [];
  const flush = (hash: string | null) => {
    const from = sim.logic.runs[sim.slot]!.seq;
    const batch = pending;
    pending = [];
    return sim.sync(from, batch, hash);
  };
  try {
    for (const cp of checkpoints) {
      // Entries up to the checkpoint: actions are batched; a cheat is applied between batches.
      while (n < cp.n) {
        const entry = log[n++]!;
        if (entry.k === 'a') {
          pending.push(entry.a);
          seq++;
        } else {
          if (pending.length > 0) {
            const result = flush(null);
            if (result.reply.world || result.reply.reason) throw new Error(`refused before a cheat: ${result.reply.reason}`);
          }
          if (options.reload !== false) sim.reload();
          sim.cheat(entry.c);
        }
      }
      if (options.reload !== false) sim.reload();
      // (Even with no actions in the batch the fingerprint is checked.)
      const result = flush(cp.fp);
      if (result.reply.world || result.reply.reason) {
        options.onParted?.(result.reply.world ?? sim.world, cp);
        fail(result.reply.reason?.startsWith('refused') ? 'refused' : 'diverge', cp.n, `checkpoint at entry ${cp.n} (action ${cp.seq}): ${result.reply.reason}`);
        return failures;
      }
      if (result.reply.seq !== cp.seq) {
        fail('diverge', cp.n, `server took ${result.reply.seq} actions, device ${cp.seq}`);
        return failures;
      }
    }
    // The end: the server's world, after one more load from storage, is the device's.
    if (options.reload !== false) sim.reload();
    if (fingerprint(sim.world) !== fingerprint(played.world)) fail('diverge', log.length, 'the stored and loaded world differs from the device at the end');
    const problems = plainProblems(sim.world);
    if (problems.length > 0) fail('plain', log.length, problems.join('; '));
  } catch (error) {
    fail('server', n, sig(error));
  }
  return failures;
}

/** One whole soak run: the device's play and its replay. */
export function soakRun(spec: Spec): { failures: Failure[]; stats: RunStats } {
  const t0 = Date.now();
  const played = playDevice(spec);
  const t1 = Date.now();
  const failures = [...played.failures];
  if (played.log.length > 0 && !failures.some((f) => f.kind === 'exception')) failures.push(...replayOnServer(spec, played));
  played.stats.deviceMs = t1 - t0;
  played.stats.replayMs = Date.now() - t1;
  return { failures, stats: played.stats };
}

/** Where two worlds part (keys in any order, undefined as missing): the first few paths. */
export function diffWorlds(a: unknown, b: unknown, limit = 12): string[] {
  const out: string[] = [];
  const walk = (x: unknown, y: unknown, path: string): void => {
    if (out.length >= limit) return;
    if (x === y) return;
    if (x === null || y === null || typeof x !== 'object' || typeof y !== 'object') {
      if (x === undefined && y === undefined) return;
      out.push(`${path}: ${JSON.stringify(x)?.slice(0, 80)} vs ${JSON.stringify(y)?.slice(0, 80)}`);
      return;
    }
    if (Array.isArray(x) !== Array.isArray(y)) {
      out.push(`${path}: array vs object`);
      return;
    }
    const keys = new Set([...Object.keys(x), ...Object.keys(y)]);
    for (const key of keys) {
      const xv = (x as Record<string, unknown>)[key];
      const yv = (y as Record<string, unknown>)[key];
      if (xv === undefined && yv === undefined) continue;
      walk(xv, yv, `${path}.${key}`);
    }
  };
  walk(a, b, 'world');
  return out;
}
