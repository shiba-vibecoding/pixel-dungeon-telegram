import { baseKind, createMob, type Hero, type Mob } from './actors';
import { randomRespawnCell } from './ai';
import { type Ctx, dropItem } from './floor';
import { collect } from './inventory';
import { createItem, type Item, ItemGenerator } from './items';
import { identify } from './ident';
import type { Level } from './level/generate';
import { adjacent } from './level/geometry';
import type { Rng } from './rng';
import { scoreImpDone } from './score';
import type { World } from './world';

/*
 * The ambitious imp of the dwarven city (Imp): once per run, on one of
 * depths 17-19, a lesser demon who wants to open a business asks for some
 * monks or golems to be cleared away. Each one slain while the errand
 * stands leaves a dwarf token; enough of them buy his family heirloom, a
 * ring two levels better than usual.
 */

export interface ImpQuest {
  depth: number;
  given: boolean;
  done: boolean;
  /** Whom he wants gone, and so how many tokens it takes: eight monks or six golems. */
  prey: 'monk' | 'golem';
  reward: Item;
}

export type ImpLine = 'intro' | 'remind' | 'reward' | 'farewell';

export const TOKENS_WANTED: Readonly<Record<ImpQuest['prey'], number>> = { monk: 8, golem: 6 };

/** Imp.Quest.spawn: the deeper the city level, the likelier, until he has appeared. */
export function spawnImp(world: World, level: Level, mobs: Mob[], rng: Rng): void {
  if (world.impQuest || level.depth < 17 || level.depth > 19 || rng.int(20 - level.depth) !== 0) return;
  const pos = randomRespawnCell(rng, world, level, (cell) => !mobs.some((mob) => mob.pos === cell));
  if (pos === -1) return;
  mobs.push(createMob(`#${++world.nextId}`, 'imp', pos, 'passive', 0));
  // A ring, never one of the worse ones, upgraded twice.
  const reward = new ItemGenerator(rng, level.depth).of('ring');
  reward.level = Math.max(reward.level, 0) + 2;
  world.impQuest = { depth: level.depth, given: false, done: false, prey: rng.int(2) === 0 ? 'monk' : 'golem', reward };
}

const tokensOf = (hero: Hero): number => hero.items.find((item) => item.kind === 'quest.token')?.qty ?? 0;

/** Imp.Quest.process: while the errand stands, each of the imp's targets slain leaves a token. */
export function impQuestKill(ctx: Ctx, mob: Mob): void {
  const quest = ctx.world.impQuest;
  if (quest?.given && !quest.done && baseKind(mob.kind) === quest.prey) dropItem(ctx.floor, mob.pos, createItem('quest.token'));
}

/** Talking to the imp: the errand, a reminder, or the ring on offer. */
export function talkToImp(ctx: Ctx, hero: Hero): void {
  const quest = ctx.world.impQuest;
  if (!quest || quest.done) return;
  let line: ImpLine;
  if (!quest.given) {
    quest.given = true;
    line = 'intro';
  } else {
    line = tokensOf(hero) >= TOKENS_WANTED[quest.prey] ? 'reward' : 'remind';
  }
  ctx.effects.push({ type: 'imp', hero: hero.id, line });
}

export function impRewardProblem(world: World, hero: Hero): string | null {
  const quest = world.impQuest;
  if (!quest || quest.done || tokensOf(hero) < TOKENS_WANTED[quest.prey]) return 'nothing to give';
  const imp = world.floors[hero.depth]?.mobs.find((mob) => mob.kind === 'imp');
  return imp && adjacent(imp.pos, hero.pos) ? null : 'the imp is not here';
}

/** WndImp: the tokens for the ring; the imp wishes the hero well and is gone. */
export function ringFromImp(ctx: Ctx, hero: Hero): void {
  const quest = ctx.world.impQuest!;
  hero.items = hero.items.filter((item) => item.kind !== 'quest.token');
  const ring = quest.reward;
  // The imp tells what it is (WndImp.takeReward identifies the ring).
  identify(ctx.world, ring);
  if (!collect(hero, ring)) dropItem(ctx.floor, hero.pos, ring);
  ctx.effects.push({ type: 'pickedUp', hero: hero.id, item: ring });
  quest.done = true;
  scoreImpDone(ctx.world);
  ctx.floor.mobs = ctx.floor.mobs.filter((mob) => mob.kind !== 'imp');
  ctx.effects.push({ type: 'imp', hero: hero.id, line: 'farewell' });
}
