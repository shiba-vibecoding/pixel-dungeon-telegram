import { createMob, type Hero, type Mob } from './actors';
import { randomRespawnCell } from './ai';
import { type Ctx, dropItem } from './floor';
import { collect } from './inventory';
import { createItem, type Item, type ItemKind } from './items';
import { identify } from './ident';
import type { Level } from './level/generate';
import { adjacent, cellX, cellY, LENGTH, WIDTH } from './level/geometry';
import { RoomType } from './level/room';
import { F, hasFlag, T } from './level/terrain';
import type { Rng } from './rng';
import type { World } from './world';

/*
 * The old wandmaker of the prison (Wandmaker): once per run he waits by the
 * entrance of one of depths 7-9, lost on his way to some corpse dust. Fetch
 * it from a pile of bones on his level and he gives one of two wands: a
 * battle wand or a useful one. Or else he is after a rotberry seed, from a
 * shrub that grows somewhere on his level; or, on a level with little water,
 * a phantom fish, all but invisible in it until a hero searches right beside.
 */

export interface WandQuest {
  depth: number;
  given: boolean;
  done: boolean;
  battle: Item;
  utility: Item;
  /** What he is after: corpse dust (also when absent, in older saves), a rotberry seed or a phantom fish. */
  wants?: 'dust' | 'berry' | 'fish';
}

export type WandmakerLine = 'intro' | 'remind' | 'reward' | 'farewell';

const BATTLE_WANDS: readonly ItemKind[] = ['wand.avalanche', 'wand.disintegration', 'wand.firebolt', 'wand.lightning', 'wand.poison'];
const UTILITY_WANDS: readonly ItemKind[] = ['wand.amok', 'wand.blink', 'wand.regrowth', 'wand.slowness', 'wand.reach'];

/** Wand.random, then upgraded once more: a wand worth the trouble. */
function rewardWand(rng: Rng, kinds: readonly ItemKind[]): Item {
  let level = 1;
  if (rng.float() < 0.5) {
    level++;
    if (rng.float() < 0.15) level++;
  }
  return createItem(rng.oneOf(kinds), 1, level);
}

/** Wandmaker.Quest.spawn: the deeper the prison level, the likelier, until he has appeared. */
export function spawnWandmaker(world: World, level: Level, mobs: Mob[], rng: Rng): void {
  if (world.wandQuest || level.depth < 7 || level.depth > 9 || rng.int(10 - level.depth) !== 0) return;
  const room = level.rooms.find((r) => r.type === RoomType.ENTRANCE);
  if (!room) return;
  let pos = -1;
  for (let attempt = 0; attempt < 100 && pos === -1; attempt++) {
    const cell = rng.intBetween(room.left + 1, room.right) + rng.intBetween(room.top + 1, room.bottom) * WIDTH;
    const terrain = level.map[cell]!;
    if (cell !== level.entrance && hasFlag(terrain, F.PASSABLE) && !mobs.some((m) => m.pos === cell)) pos = cell;
  }
  if (pos === -1) return;
  mobs.push(createMob(`#${++world.nextId}`, 'wandmaker', pos, 'passive', 0));
  world.wandQuest = {
    depth: level.depth, given: false, done: false,
    battle: rewardWand(rng, BATTLE_WANDS), utility: rewardWand(rng, UTILITY_WANDS),
    wants: errand(rng, level),
  };
}

/** Wandmaker.Quest.spawn: the fish only where there is little water; otherwise the dust or the berry. */
function errand(rng: Rng, level: Level): 'dust' | 'berry' | 'fish' {
  const pick = (['berry', 'dust', 'fish'] as const)[rng.int(3)]!;
  if (pick !== 'fish') return pick;
  const water = level.map.filter((terrain) => hasFlag(terrain, F.LIQUID)).length;
  return water > LENGTH / 16 ? (rng.int(2) === 0 ? 'berry' : 'dust') : 'fish';
}

const WANTED: Readonly<Record<'dust' | 'berry' | 'fish', ItemKind>> = { dust: 'quest.dust', berry: 'seed.rotberry', fish: 'quest.fish' };

/** The backpack slot of what the wandmaker is after, or -1. */
const wantedOf = (world: World, hero: Hero): number => hero.items.findIndex((item) => item.kind === WANTED[world.wandQuest?.wants ?? 'dust']);

/** Wandmaker.fishQuest.placeItem: the fish hides in some water, or failing that lies in plain sight. */
function placeFish(ctx: Ctx): void {
  for (let attempt = 0; attempt < 100; attempt++) {
    const pos = ctx.rng.int(LENGTH);
    if (hasFlag(ctx.level.map[pos]!, F.LIQUID) && !ctx.floor.heaps.some((h) => h.pos === pos)) {
      ctx.floor.heaps.push({ pos, kind: 'hidden', items: [createItem('quest.fish')] });
      return;
    }
  }
  const pos = randomRespawnCell(ctx.rng, ctx.world, ctx.level, (cell) => !ctx.floor.heaps.some((h) => h.pos === cell));
  if (pos !== -1) dropItem(ctx.floor, pos, createItem('quest.fish'));
}

/** Wandmaker.Quest: the rotberry grows somewhere on his level, out of the hero's sight if it can. */
function plantRotberry(ctx: Ctx, hero: Hero): void {
  const far = (cell: number): boolean =>
    Math.max(Math.abs(cellX(cell) - cellX(hero.pos)), Math.abs(cellY(cell) - cellY(hero.pos))) > 8 &&
    !(ctx.floor.plants ?? []).some((plant) => plant.pos === cell);
  let pos = randomRespawnCell(ctx.rng, ctx.world, ctx.level, far);
  if (pos === -1) pos = randomRespawnCell(ctx.rng, ctx.world, ctx.level, () => true);
  if (pos === -1) return;
  (ctx.floor.plants ??= []).push({ pos, kind: 'rotberry' });
}

/** Wandmaker.Quest.placeItem: the dust lies in a pile of bones, out of sight if there is one. */
function placeDust(ctx: Ctx, hero: Hero): void {
  const bones = ctx.floor.heaps.filter((heap) => heap.kind === 'skeleton');
  const unseen = bones.filter((heap) => Math.max(Math.abs(cellX(heap.pos) - cellX(hero.pos)), Math.abs(cellY(heap.pos) - cellY(hero.pos))) > 8);
  const pile = ctx.rng.element(unseen.length > 0 ? unseen : bones);
  if (pile) {
    pile.items.push(createItem('quest.dust'));
    return;
  }
  const pos = randomRespawnCell(ctx.rng, ctx.world, ctx.level, (cell) => !ctx.floor.heaps.some((h) => h.pos === cell));
  if (pos === -1) return;
  ctx.floor.heaps.push({ pos, kind: 'skeleton', items: [createItem('quest.dust')] });
}

/** Talking to the wandmaker: the errand, a reminder, or the wands on offer. */
export function talkToWandmaker(ctx: Ctx, hero: Hero): void {
  const quest = ctx.world.wandQuest;
  if (!quest || quest.done) return;
  let line: WandmakerLine;
  if (!quest.given) {
    quest.given = true;
    if (quest.wants === 'berry') plantRotberry(ctx, hero);
    else if (quest.wants === 'fish') placeFish(ctx);
    else placeDust(ctx, hero);
    line = 'intro';
  } else {
    line = wantedOf(ctx.world, hero) >= 0 ? 'reward' : 'remind';
  }
  ctx.effects.push({ type: 'wandmaker', hero: hero.id, line });
}

export function wandRewardProblem(world: World, hero: Hero, choice: unknown): string | null {
  const quest = world.wandQuest;
  if (!quest || quest.done || wantedOf(world, hero) < 0) return 'nothing to give';
  if (choice !== 'battle' && choice !== 'utility') return 'bad choice';
  const wandmaker = world.floors[hero.depth]?.mobs.find((mob) => mob.kind === 'wandmaker');
  return wandmaker && adjacent(wandmaker.pos, hero.pos) ? null : 'the wandmaker is not here';
}

/** The dust for a wand; the wandmaker wishes the hero luck and is gone. */
export function wandFromWandmaker(ctx: Ctx, hero: Hero, choice: 'battle' | 'utility'): void {
  const quest = ctx.world.wandQuest!;
  const wanted = hero.items[wantedOf(ctx.world, hero)]!;
  if (--wanted.qty <= 0) hero.items.splice(hero.items.indexOf(wanted), 1);
  const wand = quest[choice];
  // WndWandmaker: the wand given is known through and through.
  identify(ctx.world, wand);
  if (!collect(hero, wand)) dropItem(ctx.floor, hero.pos, wand);
  ctx.effects.push({ type: 'pickedUp', hero: hero.id, item: wand });
  quest.done = true;
  ctx.floor.mobs = ctx.floor.mobs.filter((mob) => mob.kind !== 'wandmaker');
  ctx.effects.push({ type: 'wandmaker', hero: hero.id, line: 'farewell' });
}
