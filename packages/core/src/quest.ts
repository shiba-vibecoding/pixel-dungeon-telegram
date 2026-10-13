import { createMob, type Hero, type Mob, type MobKind } from './actors';
import { randomRespawnCell } from './ai';
import { type Ctx, dropItem, enterCell, heroView } from './floor';
import { collect } from './inventory';
import { type Enchantment, type Glyph, type Item, randomEnchantment, randomGlyph } from './items';
import { identify } from './ident';
import { adjacent } from './level/geometry';
import { createItem } from './items';
import { Dungeon } from './level/gen/dungeon';
import { Generator } from './level/gen/generator';
import { Random } from './level/gen/random';
import { QuestHooks } from './level/gen/quests';
import type { RegularLevel } from './level/gen/regular-level';
import type { World } from './world';
import { underChallenges } from './challenges';

/*
 * The sad ghost of the sewers (Ghost and Ghost.Quest): once a run, on depth 2, 3 or 4 (the deeper,
 * the likelier), a ghost haunts the room of the way down. Spoken to, it sends the hero after what
 * killed it — a fetid rat on depth 2, a gnoll trickster on 3, a great crab on 4 — which comes out
 * somewhere on the level. Slain, the ghost offers a weapon or an armour for its trouble (as good as
 * each other, and sometimes enchanted or inscribed, which only shows once chosen), and finds peace.
 */

/** Ghost.Quest.type: 1 the fetid rat, 2 the gnoll trickster, 3 the great crab. */
export type GhostType = 1 | 2 | 3;

export interface GhostQuest {
  depth: number;
  type: GhostType;
  /** The ghost has told its story, and its foe has come out. */
  given: boolean;
  /** Its foe is slain (Ghost.Quest.processed). */
  processed: boolean;
  /** The reward is taken and the ghost is at peace (Ghost.Quest.completed). */
  done: boolean;
  weapon: Item;
  armor: Item;
  /** The enchantment or glyph the chosen reward gets, kept apart so it is not shown before (Ghost.Quest.enchant, glyph). */
  enchant?: Enchantment;
  glyph?: Glyph;
}

/** What the ghost says: its story, a reminder, its thanks with the rewards, a farewell; and, when its foe falls, «find me». */
export type GhostLine = 'intro' | 'remind' | 'reward' | 'farewell' | 'findMe';

/** The ghost's foe on each depth. */
export const GHOST_FOES: Readonly<Record<GhostType, MobKind>> = { 1: 'fetidRat', 2: 'gnollTrickster', 3: 'greatCrab' };

/**
 * Ghost.Quest.spawn (from SewerLevel.createMobs): on depth 2, 3 or 4, once a run (1 in 3, 2, 1), the
 * ghost in the exit room on an open cell, and its rewards rolled: armour and a weapon of the same
 * tier (50% tier 2, 30% 3, 15% 4, 5% 5) and level (50% +0, 30% +1, 15% +2, 5% +3), and one time in
 * five an enchantment and a glyph for whichever is chosen.
 */
export function spawnGhost(level: RegularLevel): void {
  const world = Dungeon.world;
  const depth = Dungeon.depth;
  if (!world || world.quest || depth <= 1 || Random.Int(5 - depth) !== 0) return;
  const room = level.roomExit!;
  const gen = level.level;
  let pos: number;
  do {
    pos = gen.pointToCell(room.random());
  } while (pos === -1 || gen.solid[pos] || !gen.openSpace[pos] || pos === gen.exit());
  gen.mobs.push({ kind: 'ghost', pos, state: 'passive' });

  const ARMORS = ['armor.leather', 'armor.mail', 'armor.scale', 'armor.plate'] as const;
  const armorTier = Random.chances([0, 0, 10, 6, 3, 1]);
  const armor = createItem(ARMORS[Math.max(2, armorTier) - 2]!);
  const wepTier = Random.chances([0, 0, 10, 6, 3, 1]);
  const weapon = Generator.random(`WEP_T${wepTier}` as 'WEP_T2');
  // The weapon's own starting properties are cleared.
  weapon.level = 0;
  delete weapon.enchant;
  delete weapon.cursed;
  delete weapon.durability;

  const roll = Random.Float();
  const itemLevel = roll < 0.5 ? 0 : roll < 0.8 ? 1 : roll < 0.95 ? 2 : 3;
  weapon.level += itemLevel;
  armor.level += itemLevel;

  // Rolled first, so the outcome does not change how many draws there are. SEAM(gear): Weapon.Enchantment
  // and Armor.Glyph random as Pixel Dungeon's lists have them.
  let enchant: Enchantment | undefined = randomEnchantment(Random.rng);
  let glyph: Glyph | undefined = randomGlyph(Random.rng);
  // SEAM(alchemy): ParchmentScrap.enchantChanceMultiplier, 1 without the trinket.
  if (Random.Float() > Math.fround(0.2)) {
    enchant = undefined;
    glyph = undefined;
  }
  world.quest = {
    depth, type: (depth - 1) as GhostType, given: false, processed: false, done: false, weapon, armor,
    ...(enchant ? { enchant } : {}), ...(glyph ? { glyph } : {}),
  };
}

QuestHooks.ghost = spawnGhost;

/**
 * Ghost.interact: the first time, its story, and its foe comes out somewhere out of sight
 * (Level.randomRespawnCell); then a reminder until the foe is slain, then the rewards.
 */
export function talkToGhost(ctx: Ctx, hero: Hero): void {
  const quest = ctx.world.quest;
  if (!quest || quest.done) return;
  if (!quest.given) {
    const seen = heroView(ctx.world, hero);
    const pos = randomRespawnCell(ctx.rng, ctx.world, ctx.level, (cell) => !seen[cell]);
    if (pos === -1) return;
    const foe = createMob(`#${++ctx.world.nextId}`, GHOST_FOES[quest.type], pos, 'wandering', ctx.floor.now);
    ctx.floor.mobs.push(foe);
    enterCell(ctx.level, pos);
    quest.given = true;
    ctx.effects.push({ type: 'ghost', hero: hero.id, line: 'intro', questType: quest.type });
    return;
  }
  ctx.effects.push({ type: 'ghost', hero: hero.id, line: quest.processed ? 'reward' : 'remind', questType: quest.type });
}

/** Ghost.Quest.process: the foe slain on the ghost's depth, it calls the hero back («find me»). */
export function ghostFoeSlain(ctx: Ctx, mob: Mob, by?: string): void {
  const quest = ctx.world.quest;
  if (!quest || quest.processed || !quest.given || quest.depth !== ctx.depth || mob.kind !== GHOST_FOES[quest.type]) return;
  quest.processed = true;
  addQuestScore(ctx.world, 0, 1000);
  ctx.effects.push({ type: 'ghost', hero: by ?? ctx.world.heroes[0]?.id ?? '', line: 'findMe', questType: quest.type });
}

/** Statistics.questScores: what each quest adds to the run's score (0 the ghost, 1 the wandmaker, 2 the blacksmith, 3 the imp). */
export function addQuestScore(world: World, quest: number, points: number): void {
  const scores = (world.questScores ??= [0, 0, 0, 0, 0]);
  scores[quest] = (scores[quest] ?? 0) + points;
}

export function rewardProblem(world: World, hero: Hero, choice: unknown): string | null {
  const quest = world.quest;
  if (!quest || quest.done || !quest.processed) return 'nothing to give';
  if (choice !== 'weapon' && choice !== 'armor') return 'bad choice';
  const ghost = world.floors[hero.depth]?.mobs.find((mob) => mob.kind === 'ghost');
  return ghost && adjacent(ghost.pos, hero.pos) ? null : 'the ghost is not here';
}

/**
 * WndSadGhost.selectReward: the chosen item gets the enchantment or glyph kept for it and is known
 * through and through; what will not go in the pack lies by the ghost. The ghost bids farewell and fades.
 */
export function rewardFromGhost(ctx: Ctx, hero: Hero, choice: 'weapon' | 'armor'): void {
  const quest = ctx.world.quest!;
  const item = quest[choice];
  if (choice === 'weapon' && quest.enchant) item.enchant = quest.enchant;
  if (choice === 'armor' && quest.glyph) item.glyph = quest.glyph;
  identify(ctx.world, item);
  const ghost = ctx.floor.mobs.find((mob) => mob.kind === 'ghost');
  // What the challenges forbid (armour under faith is my armor) is its worth in gold.
  const given = underChallenges(ctx.world, item);
  if (collect(hero, given)) ctx.effects.push({ type: 'pickedUp', hero: hero.id, item: given });
  else dropItem(ctx.floor, ghost?.pos ?? hero.pos, given);
  quest.done = true;
  ctx.effects.push({ type: 'ghost', hero: hero.id, line: 'farewell', questType: quest.type });
  if (ghost) {
    ctx.floor.mobs.splice(ctx.floor.mobs.indexOf(ghost), 1);
    ctx.effects.push({ type: 'died', depth: ctx.depth, who: ghost.id, pos: ghost.pos, kind: 'ghost' });
  }
}
