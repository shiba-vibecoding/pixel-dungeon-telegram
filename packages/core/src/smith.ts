import { mend } from './wear';
import { isIdentified } from './ident';
import { createMob, type Hero, type Mob, STARVING, isStarving } from './actors';
import { type Ctx, dropItem } from './floor';
import { collect } from './inventory';
import { createItem, type Item, itemDef, wandMaxCharges } from './items';
import type { Level } from './level/generate';
import { adjacent, NEIGHBOURS8 } from './level/geometry';
import { T } from './level/terrain';
import type { Rng } from './rng';
import type { World } from './world';
import { isUpgradable, itemAt, type ItemRef } from './scrolls';

/*
 * The troll blacksmith of the caves (Blacksmith): once per run, on one of
 * depths 12-14, he keeps a forge behind a ring of fire. He lends a pickaxe,
 * and wants either fifteen pieces of dark gold ore mined from the veins in
 * the rock, or the blood of a vampire bat on the pickaxe. In return he
 * reforges two items of the same kind into one, better than either.
 */

export interface SmithQuest {
  depth: number;
  given: boolean;
  done: boolean;
  reforged: boolean;
  /** What he wants: dark gold ore, or a bat's blood on his pickaxe. */
  wants: 'gold' | 'blood';
}

export type SmithLine = 'intro' | 'noPickaxe' | 'noGold' | 'noBlood' | 'completed' | 'reforge' | 'busy';

/** How much ore he wants; how long a swing of the pickaxe takes (Pickaxe.TIME_TO_MINE). */
export const ORE_WANTED = 15;
export const TIME_TO_MINE = 2;

export type { ItemRef };

/** Blacksmith.Quest: whoever stands at the forge the layout put him at. */
export function spawnBlacksmith(world: World, level: Level, mobs: Mob[], rng: Rng): void {
  if (level.blacksmith === undefined || world.smithQuest) return;
  mobs.push(createMob(`#${++world.nextId}`, 'blacksmith', level.blacksmith, 'passive', 0));
  world.smithQuest = { depth: level.depth, given: false, done: false, reforged: false, wants: rng.int(2) === 0 ? 'blood' : 'gold' };
}

const hasPickaxe = (hero: Hero): boolean =>
  hero.weapon?.kind === 'weapon.pickaxe' || hero.items.some((item) => item.kind === 'weapon.pickaxe');

const pickaxeOf = (hero: Hero): Item | undefined =>
  hero.weapon?.kind === 'weapon.pickaxe' ? hero.weapon : hero.items.find((item) => item.kind === 'weapon.pickaxe');

const oreOf = (hero: Hero): number => hero.items.find((item) => item.kind === 'quest.ore')?.qty ?? 0;

/** Takes the pickaxe back: out of the hero's hands (leaving them bare-handed) or out of the pack. */
function returnPickaxe(hero: Hero): void {
  if (hero.weapon?.kind === 'weapon.pickaxe') {
    hero.weapon = null;
  } else {
    hero.items.splice(hero.items.findIndex((item) => item.kind === 'weapon.pickaxe'), 1);
  }
}

/** Talking to the blacksmith: the errand, a reminder, the end of it, or his services. */
export function talkToSmith(ctx: Ctx, hero: Hero): void {
  const quest = ctx.world.smithQuest;
  if (!quest) return;
  let line: SmithLine;
  if (!quest.given) {
    quest.given = true;
    const pickaxe = createItem('weapon.pickaxe');
    if (!collect(hero, pickaxe)) dropItem(ctx.floor, hero.pos, pickaxe);
    line = 'intro';
  } else if (!quest.done) {
    const pickaxe = pickaxeOf(hero);
    if (!pickaxe) line = 'noPickaxe';
    else if (quest.wants === 'blood' && !pickaxe.bloody) line = 'noBlood';
    else if (quest.wants === 'gold' && oreOf(hero) < ORE_WANTED) line = 'noGold';
    else {
      returnPickaxe(hero);
      hero.items = hero.items.filter((item) => item.kind !== 'quest.ore');
      quest.done = true;
      line = 'completed';
    }
  } else {
    line = quest.reforged ? 'busy' : 'reforge';
  }
  ctx.effects.push({ type: 'smith', hero: hero.id, line });
}

/** Pickaxe.execute(AC_MINE): the first vein of dark gold next to the hero gives up a piece of ore. */
export function minePlace(ctx: Ctx, hero: Hero): number {
  if (hero.depth < 11 || hero.depth > 15 || !hasPickaxe(hero)) return -1;
  return NEIGHBOURS8.map((n) => hero.pos + n).find((cell) => ctx.level.map[cell] === T.WALL_DECO) ?? -1;
}

export function mineProblem(world: World, hero: Hero): string | null {
  if (!hasPickaxe(hero)) return 'you have no pickaxe';
  if (hero.depth < 11 || hero.depth > 15) return 'there is no dark gold here';
  const level = world.levels[hero.depth]!;
  return NEIGHBOURS8.some((n) => level.map[hero.pos + n] === T.WALL_DECO) ? null : 'there is no dark gold vein near you';
}

export function mine(ctx: Ctx, hero: Hero): void {
  const pos = minePlace(ctx, hero);
  if (pos < 0) return;
  ctx.level.map[pos] = T.WALL;
  const ore = createItem('quest.ore');
  if (!collect(hero, ore)) dropItem(ctx.floor, hero.pos, ore);
  // Hard work: it makes one hungry.
  if (!isStarving(hero)) hero.hunger = Math.min(STARVING, hero.hunger + STARVING / 10);
  ctx.effects.push({ type: 'mined', depth: ctx.depth, pos, hero: hero.id });
}

/** Blacksmith.verify: two different items of one kind, both identified, neither of poor quality, that can be upgraded. */
export function reforgeProblem(world: World, hero: Hero, first: ItemRef, second: ItemRef): string | null {
  const quest = world.smithQuest;
  if (!quest?.done || quest.reforged) return 'the blacksmith will not work for you';
  const smith = world.floors[hero.depth]?.mobs.find((mob) => mob.kind === 'blacksmith');
  if (!smith || !adjacent(smith.pos, hero.pos)) return 'the blacksmith is not here';
  // What is melted down must come from the pack: the hero keeps something in hand.
  if (typeof second !== 'number') return 'take it off first';
  const a = itemAt(hero, first);
  const b = itemAt(hero, second);
  if (!a || !b || a === b) return 'choose two different items';
  if (a.kind !== b.kind) return 'choose two items of the same kind';
  if (!isIdentified(world, a) || !isIdentified(world, b)) return 'I need to know what I am working with, identify them first';
  if (a.cursed || b.cursed) return 'I do not work with cursed items';
  if (a.level < 0 || b.level < 0) return 'it is junk, the quality is too poor';
  // Blacksmith.verify: only what a scroll of upgrade could improve.
  return isUpgradable(a) ? null : 'these cannot be reforged';

}

/** Blacksmith.upgrade: the better of the two comes out a level higher; the other is used up. */
export function reforge(ctx: Ctx, hero: Hero, first: ItemRef, second: ItemRef): void {
  const a = itemAt(hero, first)!;
  const b = itemAt(hero, second)!;
  const betterRef = b.level > a.level ? second : first;
  const worseRef = betterRef === first ? second : first;
  const better = itemAt(hero, betterRef)!;
  const worse = itemAt(hero, worseRef)!;
  better.level++;
  mend(better);
  if (better.charges !== undefined) better.charges = Math.min(better.charges + 1, wandMaxCharges(better));
  // The enchantment of the one melted down is not lost, if the better one had none.
  if (!better.enchant && worse.enchant) better.enchant = worse.enchant;
  if (!better.glyph && worse.glyph) better.glyph = worse.glyph;
  if (typeof worseRef === 'number') {
    hero.items.splice(worseRef, 1);
  } else {
    // The worse one was worn: the better one, from the pack, takes its place.
    hero.items.splice(betterRef as number, 1);
    hero[worseRef] = better;
  }
  ctx.world.smithQuest!.reforged = true;
  ctx.effects.push({ type: 'upgraded', hero: hero.id, item: better });
}
