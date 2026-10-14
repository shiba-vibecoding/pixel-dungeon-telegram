import { type Hero, heroBelongings } from './actors';
import { randomRespawnCell } from './ai';
import { ghostSeesHero } from './artifacts';
import { cure } from './buffs';
import { type Ctx, dropItem, enterCell, freeCellNear, leaveCell, observe } from './floor';
import { heroLives } from './imp';
import { createItem, type Item, itemDef } from './items';
import { addNote, removeNote } from './journal';
import { trueDistance } from './level/geometry';
import { T } from './level/terrain';
import { trapAt } from './traps';
import { WATERSKIN_VOLUME } from './waterskin';
import type { World } from './world';

/*
 * Shattered's ankh (Ankh, Hero.die, WndResurrect, InterlevelScene.resurrect, LostInventory, LostBackpack).
 *
 * Blessed with a full waterskin, it brings the hero back where they fell, with a quarter of their health, cured,
 * and invulnerable for a few turns. Unblessed, the hero gets up somewhere else on the floor, having forgotten it,
 * with all their belongings left behind in a backpack where they fell, but for two things they choose to keep
 * (their weapon and armour, unless they choose otherwise: the client's window, right after). Picking the backpack up
 * gives everything back. Gold is never lost.
 */

/** Invulnerability.DURATION, and the invisibility an unblessed revival gives (Hero.resurrect). */
const INVULNERABLE_TURNS = 3;
const INVISIBLE_TURNS = 3;

/** What an unblessed revival left behind (LostInventory): the belongings in the backpack, and where it lies. */
export interface LostInventory {
  depth: number;
  pos: number;
  weapon: Item | null;
  /** The armour left behind; null when it was kept (or the hero wears the stand-in, see below). */
  armor: Item | null;
  artifact: Item | null;
  misc: Item | null;
  ring: Item | null;
  items: Item[];
}

/** Hero.die: the ankh that saves a hero, the blessed one first. */
export function ankhOf(hero: Hero): number {
  let found = -1;
  hero.items.forEach((item, i) => {
    if (item.kind === 'ankh' && (found < 0 || item.blessed)) found = i;
  });
  return found;
}

/** Ankh.AC_BLESS: with the waterskin full. */
export function ankhBlessProblem(hero: Hero, item: number): string | null {
  const ankh = hero.items[item];
  if (!ankh || ankh.kind !== 'ankh') return 'no such item';
  if (ankh.blessed) return 'the ankh is blessed already';
  const skin = hero.items.find((i) => i.kind === 'waterskin');
  if (!skin || (skin.volume ?? 0) < WATERSKIN_VOLUME) return 'your waterskin is not full';
  return null;
}

/** Ankh.AC_BLESS: the dew of a full waterskin blesses it (a turn). */
export function blessAnkh(ctx: Ctx, hero: Hero, item: number): void {
  const ankh = hero.items[item]!;
  // A stack of ankhs: one is blessed, the others stay as they are.
  if (ankh.qty > 1) {
    ankh.qty--;
    hero.items.splice(item + 1, 0, { ...createItem('ankh'), blessed: true });
  } else {
    ankh.blessed = true;
  }
  const skin = hero.items.find((i) => i.kind === 'waterskin')!;
  skin.volume = 0;
  ctx.effects.push({ type: 'ankhBlessed', hero: hero.id });
}

/** Hero.die with an ankh: true when it brings the hero back. */
export function ankhRevives(ctx: Ctx, hero: Hero): boolean {
  const index = ankhOf(hero);
  if (index < 0) return false;
  const ankh = hero.items[index]!;
  const blessed = ankh.blessed === true;
  if (ankh.qty > 1) ankh.qty--;
  else hero.items.splice(index, 1);
  if (blessed) {
    // Back where they fell: a quarter of their health, cured, untouchable for three turns.
    hero.hp = Math.trunc(hero.ht / 4);
    hero.killedBy = null;
    hero.intent = null;
    cure(hero);
    hero.invulnerable = Math.max(hero.invulnerable ?? 0, INVULNERABLE_TURNS);
    ctx.effects.push({ type: 'resurrected', hero: hero.id, blessed: true });
    ghostSeesHero(ctx, hero, 'blessed_ankh');
    return true;
  }
  reviveElsewhere(ctx, hero);
  return true;
}

/**
 * InterlevelScene.resurrect: the floor is forgotten, the hero gets up on a cell away from where they fell (not on a
 * trap, nor if it can be helped on a plant, the farther the better), and the backpack lies where they fell.
 * (Shattered makes a locked boss floor anew; here the hero gets up elsewhere on it all the same.)
 */
function reviveElsewhere(ctx: Ctx, hero: Hero): void {
  const { world, level, depth, rng } = ctx;
  const fell = hero.pos;
  let to = -1;
  for (let tries = 1; tries <= 1000; tries++) {
    const cell = randomRespawnCell(rng, world, level, () => true);
    if (cell < 0) continue;
    if (trapAt(level, cell)) continue;
    if (ctx.floor.plants?.some((p) => p.pos === cell) && tries < 500) continue;
    if (trueDistance(fell, cell) <= 30 - tries / 10) continue;
    to = cell;
    break;
  }
  if (to < 0) to = freeCellNear(world, level, depth, level.entrance);
  // The hero forgets the floor (heroFOV, visited, mapped).
  world.explored[depth] = level.map.map(() => false);
  leaveCell(world, level, depth, fell);
  hero.pos = to;
  if (level.map[to] === T.HIGH_GRASS || level.map[to] === T.FURROWED_GRASS) level.map[to] = T.GRASS;
  enterCell(level, to);

  // Hero.resurrect: whole again, every passing thing over; invisible for a moment.
  heroLives(hero);
  hero.hp = hero.ht;
  hero.killedBy = null;
  hero.intent = null;
  hero.invisible = Math.max(hero.invisible, INVISIBLE_TURNS);

  // LostInventory: everything but the weapon and armour (the window may choose two others), left behind.
  hero.lostInventory = { depth, pos: fell, weapon: null, armor: null, artifact: null, misc: null, ring: null, items: [] };
  keepOnly(hero, [...(hero.weapon ? [hero.weapon] : []), hero.armor]);
  dropItem(ctx.floor, fell, { ...createItem('lostPack'), owner: hero.id });
  addNote(world, 'lostPack', depth);
  hero.ankhChoice = true;
  observe(world, hero);
  ctx.effects.push({ type: 'resurrected', hero: hero.id, blessed: false });
}

/** A hero's belongings and what lies in their lost backpack, as one list (the choices of WndResurrect). */
export function ankhChoices(hero: Hero): Item[] {
  const lost = hero.lostInventory;
  const stored = lost ? [lost.weapon, lost.armor, lost.artifact, lost.misc, lost.ring, ...lost.items] : [];
  return [...heroBelongings(hero).filter((item) => !item.standIn), ...stored.filter((item): item is Item => item !== null)];
}

/** WndResurrect.itemSelector: neither an ankh nor a bag. */
const keepable = (item: Item): boolean => item.kind !== 'ankh' && itemDef(item.kind).category !== 'bag';

/** WndResurrect, confirmed: the (up to) two things kept instead. */
export function ankhKeepProblem(hero: Hero, keep: readonly number[]): string | null {
  if (!hero.ankhChoice || !hero.lostInventory) return 'nothing to choose';
  const choices = ankhChoices(hero);
  if (keep.length > 2 || new Set(keep).size !== keep.length) return 'bad choice';
  if (keep.some((i) => !Number.isInteger(i) || !choices[i] || !keepable(choices[i]!))) return 'bad choice';
  return null;
}

export function ankhKeep(ctx: Ctx, hero: Hero, keep: readonly number[]): void {
  const choices = ankhChoices(hero);
  const kept = keep.map((i) => choices[i]!);
  // Everything back first, then all but the chosen two away again.
  restoreBelongings(hero);
  keepOnly(hero, kept);
  hero.ankhChoice = false;
  ctx.effects.push({ type: 'ankhKept', hero: hero.id, items: kept });
}

/**
 * LostInventory.keptThoughLostInvent: the hero keeps `kept` (in their slots, or the pack); the rest goes into the lost
 * backpack. Armour left behind gives way to a plain cloth stand-in, as a hero always wears something here.
 */
function keepOnly(hero: Hero, kept: readonly Item[]): void {
  const lost = hero.lostInventory!;
  const keeps = (item: Item | null): boolean => item !== null && kept.includes(item);
  if (hero.weapon && !keeps(hero.weapon)) {
    lost.weapon = hero.weapon;
    hero.weapon = null;
  }
  if (!keeps(hero.armor)) {
    lost.armor = hero.armor;
    hero.armor = { ...createItem('armor.cloth'), standIn: true };
  }
  for (const slot of ['artifact', 'misc', 'ring'] as const) {
    if (hero[slot] && !keeps(hero[slot])) {
      lost[slot] = hero[slot];
      hero[slot] = null;
    }
  }
  // Keys and the quest's things stay with the hero (they are not belongings one can lose).
  const stays = (item: Item): boolean => kept.includes(item) || ['key', 'quest'].includes(itemDef(item.kind).category) || item.kind === 'waterskin';
  lost.items.push(...hero.items.filter((item) => !stays(item)));
  hero.items = hero.items.filter(stays);
}

/** Everything in the lost backpack back with the hero: worn things into their empty slots, the rest into the pack. */
function restoreBelongings(hero: Hero): void {
  const lost = hero.lostInventory;
  if (!lost) return;
  const back = (item: Item): void => {
    hero.items.push(item);
  };
  if (lost.weapon) {
    if (hero.weapon) back(lost.weapon);
    else hero.weapon = lost.weapon;
  }
  if (lost.armor) {
    if (hero.armor.standIn) hero.armor = lost.armor;
    else back(lost.armor);
  }
  for (const slot of ['artifact', 'misc', 'ring'] as const) {
    const item = lost[slot];
    if (!item) continue;
    if (hero[slot]) back(item);
    else hero[slot] = item;
  }
  hero.items.push(...lost.items);
  Object.assign(lost, { weapon: null, armor: null, artifact: null, misc: null, ring: null, items: [] });
}

/** LostBackpack.doPickUp: only its owner can take it up; everything comes back, and the note goes. */
export function pickUpLostPack(ctx: Ctx, hero: Hero, pack: Item): boolean {
  if (pack.owner !== hero.id || !hero.lostInventory) return false;
  restoreBelongings(hero);
  const depth = hero.lostInventory.depth;
  delete hero.lostInventory;
  hero.ankhChoice = false;
  removeNote(ctx.world, 'lostPack', depth);
  ctx.effects.push({ type: 'lostPackFound', hero: hero.id });
  return true;
}

/** Whether a hero still has a lost backpack on that depth (Notes: the landmark is kept until it is picked up). */
export const lostPackOn = (world: World, depth: number): boolean => world.heroes.some((hero) => hero.lostInventory?.depth === depth);
