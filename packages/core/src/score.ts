import { type Hero, heroBelongings } from './actors';
import { challengeMultiplier20 } from './daily';
import { itemDef, itemPrice, knownIn } from './items';
import { isBossDepth } from './level/builder';
import { cellX, cellY, LENGTH, NEIGHBOURS4 } from './level/geometry';
import { RoomType } from './level/room';
import { T } from './level/terrain';
import type { World } from './world';

/*
 * Shattered's score (Statistics.java, Rankings.calculateScore, WndScoreBreakdown): five parts, then two multipliers.
 *
 *   progress  hero level x deepest depth x 65, at most 50 000
 *   treasure  gold collected + the value of what the hero carries, at most 20 000
 *   explore   each floor (regular ones only) is worth 50 x the number of floors, by how much of it was cleared
 *   bosses    1000 / 2000 / 3000 / 4000 / 5000+ for Goo, Tengu, DM-300, the Dwarf King and Yog-Dzewa, less for
 *             avoidable hits taken in the fight; a boss's part never counts below nothing
 *   quests    the ghost, the wandmaker, the blacksmith and the imp, the same way
 *   x win     2 for a win, 2.5 for a hero who carried the Amulet out to the surface
 *   x chal    1.25 to the power of the challenges on, rounded to the nearest twentieth
 *
 * Integer maths only, so the phone and the server cannot round differently: multipliers are halves and twentieths.
 * What accumulates (the bosses' and quests' parts) lives in the world as plain JSON (World.score); the rest is read
 * from the world when the score is asked for (floors, gold, the pack).
 */

/** Statistics.bossScores / questScores: five slots each, as in the original. */
export interface ScoreState {
  bosses: number[];
  quests: number[];
}

/** Which slot of Statistics.bossScores each boss has. */
export const BOSS_SLOT = { goo: 0, tengu: 1, dm300: 2, king: 3, yog: 4 } as const;
export type BossSlot = (typeof BOSS_SLOT)[keyof typeof BOSS_SLOT];
/** Which slot of Statistics.questScores each errand has. */
export const QUEST_SLOT = { ghost: 0, wandmaker: 1, blacksmith: 2, imp: 3 } as const;
export type QuestSlot = (typeof QUEST_SLOT)[keyof typeof QUEST_SLOT];

/** The caps of Rankings.calculateScore. */
export const PROGRESS_CAP = 50_000;
export const TREASURE_CAP = 20_000;
/** WndScoreBreakdown marks a part at these as maxed out. */
export const HIGHLIGHT = { progress: 50_000, treasure: 20_000, explore: 20_000, bosses: 15_000, quests: 10_000 } as const;

const scoreOf = (world: World): ScoreState => (world.score ??= { bosses: [0, 0, 0, 0, 0], quests: [0, 0, 0, 0, 0] });
/** What is kept so far, without starting it: asking for a score must not change the world. */
const scoreSoFar = (world: World): ScoreState => world.score ?? { bosses: [0, 0, 0, 0, 0], quests: [0, 0, 0, 0, 0] };

/* Hooks: the places in the rules that give or take score call these. */

/** Statistics.bossScores[slot] += amount (a boss beaten; a negative amount for an avoidable hit). */
export function bossScore(world: World, slot: BossSlot, amount: number): void {
  scoreOf(world).bosses[slot]! += amount;
}

/** Statistics.questScores[slot] += amount. */
export function questScore(world: World, slot: QuestSlot, amount: number): void {
  scoreOf(world).quests[slot]! += amount;
}

/** Ghost.Quest.process: the errand is done (here: handed in). */
export const scoreGhostDone = (world: World): void => questScore(world, QUEST_SLOT.ghost, 1000);
/** Fetid rat's ooze and stench, the crab's and the trickster's hits: taken while the ghost's errand stands. */
export const scoreGhostHit = (world: World, amount: number): void => questScore(world, QUEST_SLOT.ghost, -amount);
/** Wandmaker.Quest.complete and the quest bosses' deaths: the wands are earned. */
export const scoreWandmakerDone = (world: World): void => questScore(world, QUEST_SLOT.wandmaker, 2000);
/** Blacksmith.Quest.start: the favor earned (dark gold, up to 2000, and 1000 for the boss), given when the pickaxe is back. */
export const scoreBlacksmithDone = (world: World, favor: number): void => questScore(world, QUEST_SLOT.blacksmith, favor);
/** Imp.Quest.oldComplete: the full 4000. */
export const scoreImpDone = (world: World): void => {
  scoreOf(world).quests[QUEST_SLOT.imp] = 4000;
};

/** Boss.die: what each boss is worth (Yog-Dzewa's 5000 grows by 1250 for each demon spawner left alive). */
export function bossBeaten(world: World, kind: string, spawnersLeft: number): void {
  switch (kind) {
    case 'goo': return bossScore(world, BOSS_SLOT.goo, 1000);
    case 'tengu': return bossScore(world, BOSS_SLOT.tengu, 2000);
    case 'dm300': return bossScore(world, BOSS_SLOT.dm300, 3000);
    case 'king': return bossScore(world, BOSS_SLOT.king, 4000);
    case 'yog': return bossScore(world, BOSS_SLOT.yog, 5000 + 1250 * spawnersLeft);
    default: return undefined;
  }
}

/* The score itself. */

/**
 * RegularLevel.levelExplorePercent, in tenths (10 whole, 5, 2 or 0): half the floor's worth for a room missed, a fifth for two,
 * nothing for three. A room is missed when it holds a level-made heap that was never seen, or sits in a container or holds a key,
 * a statue or mimic not yet dealt with, the altar's fire still burning, or a barricade, a locked door or a secret door.
 * (Heap.seen is the cell being explored; Heap.autoExplored is `auto`, a heap made during play.)
 */
export function explorePercent10(world: World, depth: number): number {
  const level = world.levels[depth];
  const floor = world.floors[depth];
  if (!level || !floor) return 0;
  // Read, not made: asking for a score must not change the world.
  const explored = world.explored[depth] ?? [];
  const roomAt = (cell: number): number => {
    if (cell < 0 || cell >= LENGTH) return -1;
    const x = cellX(cell);
    const y = cellY(cell);
    return level.rooms.findIndex((r) => x > r.left && x < r.right && y > r.top && y < r.bottom);
  };
  const roomOfType = (type: RoomType): number => level.rooms.findIndex((r) => r.type === type);
  const missed = new Set<number>();

  for (const heap of floor.heaps) {
    if (heap.auto) continue;
    if (!explored[heap.pos] || (heap.kind !== 'heap' && heap.kind !== 'forSale' && heap.kind !== 'crystalChest')) missed.add(roomAt(heap.pos));
    else if (heap.items.some((item) => itemDef(item.kind).category === 'key')) missed.add(roomAt(heap.pos));
  }
  if (floor.altar && floor.altar.volume > 0) missed.add(roomOfType(RoomType.ALTAR));
  for (const mob of floor.mobs) {
    if (mob.ally) continue;
    if (mob.kind === 'statue' || mob.kind === 'armoredStatue') missed.add(roomOfType(RoomType.STATUE));
    else if (mob.kind === 'mimic' || mob.kind === 'goldenMimic' || mob.kind === 'crystalMimic' || mob.kind === 'ebonyMimic') missed.add(roomAt(mob.pos));
  }
  for (let cell = 0; cell < level.map.length; cell++) {
    const terrain = level.map[cell];
    if (terrain !== T.BARRICADE && terrain !== T.LOCKED_DOOR && terrain !== T.SECRET_DOOR) continue;
    // The room this is connected to: the last of the four neighbours' rooms, but one already missed is kept.
    let candidate = -2;
    for (const step of NEIGHBOURS4) {
      const room = roomAt(cell + step);
      if (room >= 0 && (candidate === -2 || !missed.has(candidate))) candidate = room;
    }
    if (candidate !== -2) missed.add(candidate);
  }
  return missed.size === 0 ? 10 : missed.size === 1 ? 5 : missed.size === 2 ? 2 : 0;
}

/** The floors Dungeon.updateLevelExplored records: regular ones (no boss floor, no Amulet's hall), made so far. */
export function exploredFloors(world: World): number[] {
  return Object.keys(world.levels).map(Number).filter((depth) => depth >= 1 && depth < 26 && !isBossDepth(depth)).sort((a, b) => a - b);
}

/** What WndScoreBreakdown shows. Multipliers are plain numbers (1, 2, 2.5; 1.25, 1.55 ...). */
export interface ScoreBreakdown {
  progress: number;
  /** Treasure (capped) and its two sources (before the cap). */
  treasure: number;
  gold: number;
  items: number;
  explore: number;
  /** The floors counted, and how many of them were cleared whole. */
  floors: number;
  clean: number;
  bosses: number;
  quests: number;
  /** Each boss's and each errand's own part (it can be below nothing: it then counts as nothing). */
  bossParts: number[];
  questParts: number[];
  winMultiplier: number;
  chalMultiplier: number;
  total: number;
}

/** The value of what a hero carries (Statistics.heldItemValue): everything on them at the end, at its sell value. */
export function heldItemValue(world: World, hero: Hero): number {
  let value = 0;
  for (const item of heroBelongings(hero)) value += itemPrice(item, knownIn(world.known ?? [], item.kind));
  return value;
}

/** Rankings.calculateScore: the parts, the multipliers and the total of a dungeon run, for one hero of it. */
export function scoreBreakdown(world: World, hero: Hero, deepest: number, gold: number): ScoreBreakdown {
  const state = scoreSoFar(world);
  const quests = [...state.quests];
  // A hero who keeps the corpse dust from the wandmaker's errand past the sewers still gets its due.
  const wants = world.wandQuest?.wants;
  if (deepest >= 10 && (wants === undefined || wants === 'dust') && heroBelongings(hero).some((item) => item.kind === 'quest.dust')) {
    quests[QUEST_SLOT.wandmaker] = 2000;
  }

  const progress = Math.min(hero.lvl * deepest * 65, PROGRESS_CAP);
  const items = heldItemValue(world, hero);
  const treasure = Math.min(gold + items, TREASURE_CAP);

  const floors = exploredFloors(world);
  const perFloor = floors.length * 50;
  let explore = 0;
  let clean = 0;
  for (const depth of floors) {
    const tenths = explorePercent10(world, depth);
    if (tenths === 10) clean++;
    // Math.round(percent * scorePerFloor): perFloor is a multiple of 50, so the tenths divide it exactly.
    explore += (tenths * perFloor) / 10;
  }

  const sum = (parts: readonly number[]): number => parts.reduce((total, part) => total + (part > 0 ? part : 0), 0);
  const bosses = sum(state.bosses);
  const errands = sum(quests);

  // gameWon adds a whole, ascended half a one: in halves, 2, 4 or 5.
  const winHalves = world.victory ? (world.ending === 'surface' ? 5 : 4) : 2;
  const chal20 = challengeMultiplier20(world.challenges ?? 0);
  const total = Math.trunc(((progress + treasure + explore + bosses + errands) * winHalves * chal20) / 40);
  return {
    progress, treasure, gold, items, explore, floors: floors.length, clean, bosses, quests: errands,
    bossParts: [...state.bosses], questParts: quests, winMultiplier: winHalves / 2, chalMultiplier: chal20 / 20, total,
  };
}
