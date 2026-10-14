import { createMob, type Hero, type Mob } from './actors';
import { randomRespawnCell } from './ai';
import { type Ctx, dropItem, enterCell } from './floor';
import { collect } from './inventory';
import { createItem, type Item, itemDef, ItemGenerator } from './items';
import { identify } from './ident';
import type { Level } from './level/generate';
import { adjacent } from './level/geometry';
import type { Rng } from './rng';
import { scoreGhostDone } from './score';
import type { World } from './world';
import { isChallenged, NO_ARMOR, underChallenges } from './challenges';


/*
 * The sad ghost of the sewers (Ghost): once per run a ghost haunts one of
 * depths 2-4 with one of three errands. It may want its dried rose back,
 * which one of that level's monsters carries; or revenge on the fetid rat
 * that took its life, which comes out once the hunting starts; or to be rid
 * of the curse that binds it, which takes shape and fights when the hero
 * agrees to help. Done, it earns the choice of a fine weapon or armour.
 */

export type GhostErrand = 'rose' | 'rat' | 'curse';

export interface GhostQuest {
  depth: number;
  /** Absent in saves from before the other errands: the rose. */
  type?: GhostErrand;
  given: boolean;
  /** The rose has dropped, or the fetid rat has come out. */
  dropped: boolean;
  /** Kills left before the rose is sure to drop. */
  killsLeft: number;
  /** The curse has been fought and broken. */
  freed?: boolean;
  done: boolean;
  weapon: Item;
  armor: Item;
}

export type GhostLine = 'intro' | 'remind' | 'reward' | 'farewell';

const SEWER_MONSTERS = new Set(['rat', 'gnoll', 'crab', 'albino']);

export const errandOf = (quest: GhostQuest): GhostErrand => quest.type ?? 'rose';

/** Ghost.Quest.spawn: the deeper the sewer level, the likelier the ghost, until it has appeared. */
export function spawnGhost(world: World, level: Level, mobs: Mob[], rng: Rng): void {
  if (world.quest || level.depth < 2 || level.depth > 4 || rng.int(5 - level.depth) !== 0) return;
  const pos = randomRespawnCell(rng, world, level, (cell) => !mobs.some((mob) => mob.pos === cell));
  if (pos === -1) return;
  mobs.push(createMob(`#${++world.nextId}`, 'ghost', pos, 'passive', 0));
  const type = (['rose', 'rat', 'curse'] as const)[rng.int(3)]!;

  // The reward: the best of four weapons (no thrown ones) and of four armours.
  const generator = new ItemGenerator(rng, level.depth);
  let weapon: Item | null = null;
  for (let i = 0; i < 4; i++) {
    let another = generator.of('weapon');
    while (itemDef(another.kind).category !== 'weapon') another = generator.of('weapon');
    if (!weapon || another.level > weapon.level) weapon = another;
  }
  // Faith is my armor: only worn-out cloth armour (new ClothArmor().degrade()).
  let armor = isChallenged(world, NO_ARMOR) ? createItem('armor.cloth', 1, -1) : generator.of('armor');
  for (let i = 0; i < 3 && !isChallenged(world, NO_ARMOR); i++) {
    const another = generator.of('armor');
    if (another.level > armor.level) armor = another;
  }
  // Ghost.Quest.spawn: both are known through and through.
  identify(world, weapon!);
  identify(world, armor);
  world.quest = { depth: level.depth, type, given: false, dropped: false, killsLeft: 8, done: false, weapon: weapon!, armor };
}

/**
 * Ghost.Quest.processSewersKill: one of the level's monsters carries the rose;
 * or, at the first kill, the fetid rat comes out.
 */
export function questKill(ctx: Ctx, mob: Mob): void {
  const quest = ctx.world.quest;
  if (!quest || !quest.given || quest.dropped || quest.depth !== ctx.depth || !SEWER_MONSTERS.has(mob.kind)) return;
  if (errandOf(quest) === 'rat') {
    const pos = randomRespawnCell(ctx.rng, ctx.world, ctx.level, () => true);
    if (pos === -1) return;
    const rat = createMob(`#${++ctx.world.nextId}`, 'fetidRat', pos, 'wandering', ctx.floor.now);
    ctx.floor.mobs.push(rat);
    enterCell(ctx.level, pos);
    quest.dropped = true;
    return;
  }
  if (errandOf(quest) !== 'rose') return;
  if (ctx.rng.int(quest.killsLeft) === 0) {
    dropItem(ctx.floor, mob.pos, createItem('quest.rose'));
    quest.dropped = true;
  } else {
    quest.killsLeft--;
  }
}

/** What the hero brings back: the rose or the fetid rat's skull, as the errand was. */
const tokenOf = (quest: GhostQuest, hero: Hero): number =>
  hero.items.findIndex((item) => item.kind === (errandOf(quest) === 'rat' ? 'quest.skull' : 'quest.rose'));

const earned = (quest: GhostQuest, hero: Hero): boolean => (errandOf(quest) === 'curse' ? !!quest.freed : tokenOf(quest, hero) >= 0);

/** Talking to the ghost: the errand, a reminder, or the reward on offer. */
export function talkToGhost(ctx: Ctx, hero: Hero): void {
  const quest = ctx.world.quest;
  if (!quest || quest.done) return;
  let line: GhostLine;
  if (!quest.given) {
    // The curse is only taken on once the hero agrees to face it.
    if (errandOf(quest) !== 'curse') quest.given = true;
    line = 'intro';
  } else {
    line = earned(quest, hero) ? 'reward' : 'remind';
  }
  ctx.effects.push({ type: 'ghost', hero: hero.id, line, errand: errandOf(quest) });
}

export function faceCurseProblem(world: World, hero: Hero): string | null {
  const quest = world.quest;
  if (!quest || errandOf(quest) !== 'curse' || quest.given) return 'there is no curse to face';
  const ghost = world.floors[hero.depth]?.mobs.find((mob) => mob.kind === 'ghost');
  return ghost && adjacent(ghost.pos, hero.pos) ? null : 'the ghost is not here';
}

/** Ghost.replace: the curse that binds the ghost takes shape where it was, and turns on the hero. */
export function faceCurse(ctx: Ctx, hero: Hero): void {
  const quest = ctx.world.quest!;
  quest.given = true;
  const ghost = ctx.floor.mobs.find((mob) => mob.kind === 'ghost')!;
  ctx.floor.mobs.splice(ctx.floor.mobs.indexOf(ghost), 1);
  const curse = createMob(ghost.id, 'curse', ghost.pos, 'hunting', ctx.floor.now);
  curse.level = ctx.depth;
  curse.ht = curse.hp = 10 + ctx.depth * 3;
  Object.assign(curse, { enemy: hero.id, target: hero.pos, enemySeen: true });
  ctx.floor.mobs.push(curse);
  ctx.effects.push({ type: 'cursed', depth: ctx.depth, mob: curse.id, pos: curse.pos });
}

/** CursePersonification.die: the curse is broken, and the ghost is itself again. */
export function curseBroken(ctx: Ctx, curse: Mob): void {
  const quest = ctx.world.quest;
  if (quest) quest.freed = true;
  ctx.floor.mobs.push(createMob(curse.id, 'ghost', curse.pos, 'passive', ctx.floor.now));
  enterCell(ctx.level, curse.pos);
}

export function rewardProblem(world: World, hero: Hero, choice: unknown): string | null {
  const quest = world.quest;
  if (!quest || quest.done || !quest.given || !earned(quest, hero)) return 'nothing to give';
  if (choice !== 'weapon' && choice !== 'armor') return 'bad choice';
  const ghost = world.floors[hero.depth]?.mobs.find((mob) => mob.kind === 'ghost');
  return ghost && adjacent(ghost.pos, hero.pos) ? null : 'the ghost is not here';
}

/** The rose or skull for a reward; the ghost finds peace and fades away. */
export function rewardFromGhost(ctx: Ctx, hero: Hero, choice: 'weapon' | 'armor'): void {
  const quest = ctx.world.quest!;
  if (errandOf(quest) !== 'curse') hero.items.splice(tokenOf(quest, hero), 1);
  const item = quest[choice];
  // WndSadGhost: what will not go into the pack is dropped where the hero stands (Level.drop).
  if (!collect(hero, item)) dropItem(ctx.floor, hero.pos, underChallenges(ctx.world, item));
  ctx.effects.push({ type: 'pickedUp', hero: hero.id, item });
  quest.done = true;
  scoreGhostDone(ctx.world);
  ctx.floor.mobs = ctx.floor.mobs.filter((mob) => mob.kind !== 'ghost');
  ctx.effects.push({ type: 'ghost', hero: hero.id, line: 'farewell', errand: errandOf(quest) });
}
