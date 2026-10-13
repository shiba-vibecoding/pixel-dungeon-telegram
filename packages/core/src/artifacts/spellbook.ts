import type { Hero } from '../actors';
import { type Ctx, heroView } from '../floor';
import { applyItem } from '../inventory';
import { type Item, type ItemKind, scrollChances } from '../items';
import { kindKnown } from '../ident';
import type { Rng } from '../rng';
import { canTarget, isTargetedScroll, itemAt, type ItemRef } from '../scrolls';
import type { World } from '../world';
import { chargeCap, levelCap, visiblyUpgraded } from './artifact';
import { isWorn, say, upgradeArtifact } from './common';
import { artifactChargeMultiplier, artifactProc, exoticScrollOf, magicImmune, onArtifactUsed, readExoticScroll, regenOn } from './seams';

/*
 * UnstableSpellbook: worn, it reads a random scroll for a charge (identify,
 * remove curse and magic mapping half as often). Its index asks for scrolls
 * one at a time: each one given to it makes it a level stronger, and a scroll
 * it was given comes out empowered — the reader may read its exotic
 * counterpart instead, for a second charge. What it reads it reads
 * anonymously: no scroll becomes known by it.
 */

/** A scroll the book has rolled and the reader has yet to settle: read as it is, or its exotic (charged), and on what. */
export interface PendingScroll {
  kind: ItemKind;
  /** The exotic counterpart the reader may choose instead, if the book was given this scroll already. */
  exotic?: ItemKind;
}

/** UnstableSpellbook.setupScrolls: the index, every scroll kind once in the order the Generator's chances draw them. */
export function setupScrolls(item: Item, rng: Rng): ItemKind[] {
  const table = scrollChances().filter(([kind]) => kind !== 'scroll.upgrade');
  const chances = table.map(([, chance]) => chance);
  const scrolls: ItemKind[] = [];
  for (;;) {
    const i = rng.chances(chances);
    if (i < 0 || chances[i] === 0) break;
    scrolls.push(table[i]![0]);
    chances[i] = 0;
    if (chances.every((chance) => chance === 0)) break;
  }
  item.scrolls = scrolls;
  return scrolls;
}

/** The index (made the first time it is needed, for a book made without a random stream). */
export const indexOf = (ctx: Ctx, item: Item): ItemKind[] => item.scrolls ?? setupScrolls(item, ctx.rng);

export function spellbookProblem(world: World, hero: Hero, item: Item, use: string, scroll: Item | undefined): string | null {
  if (magicImmune(hero)) return 'art:magic_immune';
  if (use === 'read') {
    if ((hero.blind ?? 0) > 0) return 'art:unstablespellbook.blinded';
    if (!isWorn(hero, item)) return 'art:artifact.need_to_equip';
    if ((item.charge ?? 0) <= 0) return 'art:unstablespellbook.no_charge';
    if (item.cursed) return 'art:unstablespellbook.cursed';
    return null;
  }
  // ADD: a scroll from the pack, one of the first two the index asks for.
  if (!isWorn(hero, item)) return 'art:artifact.need_to_equip';
  if (item.level >= levelCap(item) || item.cursed) return 'art:cannot';
  if (!scroll || !scroll.kind.startsWith('scroll.')) return 'art:unstablespellbook.prompt';
  if (!kindKnown(world, scroll)) return 'art:unstablespellbook.unknown_scroll';
  const index = item.scrolls;
  if (index && !index.slice(0, 2).includes(scroll.kind)) return 'art:unstablespellbook.unable_scroll';
  return null;
}

/** Whether the pending scroll can be settled this way: an exotic needs a charge left, a scroll read on something wants it to fit. */
export function resolveProblem(world: World, hero: Hero, choice: number | undefined, on: ItemRef | undefined): string | null {
  const pending = hero.pendingScroll;
  if (!pending) return 'art:cannot';
  if (choice === 1 && !pending.exotic) return 'art:cannot';
  if (on !== undefined) {
    const target = itemAt(hero, on);
    const kind = choice === 1 ? pending.exotic! : pending.kind;
    if (!target || !isTargetedScroll(kind) || !canTarget(world, kind, target)) return 'art:cannot';
  }
  return null;
}

/** UnstableSpellbook.doReadEffect: a charge, and a random scroll — read at once, or left for the reader to settle. */
export function readSpellbook(ctx: Ctx, hero: Hero, item: Item): number {
  item.charge = (item.charge ?? 0) - 1;
  const table = scrollChances().filter(([kind]) => kind !== 'scroll.upgrade');
  const chances = table.map(([, chance]) => chance);
  let kind: ItemKind;
  do {
    kind = table[ctx.rng.chances(chances)]![0];
    // Identify, remove curse and magic mapping come half as often.
  } while ((kind === 'scroll.identify' || kind === 'scroll.removeCurse' || kind === 'scroll.mapping') && ctx.rng.int(2) === 0);
  const exotic = exoticScrollOf(kind);
  // Charge left and a scroll the book was given: the reader may read it empowered.
  if ((item.charge ?? 0) > 0 && !indexOf(ctx, item).includes(kind) && exotic) {
    hero.pendingScroll = { kind, exotic };
    ctx.effects.push({ type: 'spellbook', hero: hero.id, kind, exotic });
    return 0;
  }
  if (isTargetedScroll(kind)) {
    // InventoryScroll.doRead: what it is read on is the reader's to choose.
    hero.pendingScroll = { kind };
    ctx.effects.push({ type: 'spellbook', hero: hero.id, kind });
    return 0;
  }
  readAnonymously(ctx, hero, item, kind, undefined);
  return 1;
}

/** The window's choice (0 the scroll, 1 its exotic, for a charge more) and, for a scroll read on something, what on. */
export function resolveSpellbook(ctx: Ctx, hero: Hero, item: Item | undefined, choice: number, on: ItemRef | undefined): number {
  const pending = hero.pendingScroll!;
  delete hero.pendingScroll;
  const target = on === undefined ? undefined : itemAt(hero, on);
  if (choice === 1 && pending.exotic) {
    if (item) item.charge = Math.max(0, (item.charge ?? 0) - 1);
    checkForArtifactProc(ctx, hero, item, pending.kind);
    readExoticScroll(ctx, hero, pending.exotic, target);
    onArtifactUsed(ctx, hero);
    return 1;
  }
  // An anonymous scroll read on nothing (the selector cancelled) is simply used up.
  if (isTargetedScroll(pending.kind) && !target) return 1;
  readAnonymously(ctx, hero, item, pending.kind, target);
  return 1;
}

/** Scroll.anonymize and doRead: read without teaching the party what it is. */
function readAnonymously(ctx: Ctx, hero: Hero, item: Item | undefined, kind: ItemKind, target: Item | undefined): void {
  checkForArtifactProc(ctx, hero, item, kind);
  ctx.effects.push({ type: 'used', hero: hero.id, kind, identified: false });
  ctx.effects.push({ type: 'spellbookRead', hero: hero.id, kind });
  applyItem(ctx, hero, kind, target);
  onArtifactUsed(ctx, hero);
}

/** UnstableSpellbook.checkForArtifactProc: a scroll that reaches everything in sight (rage: everything) touches it with the book's magic. */
function checkForArtifactProc(ctx: Ctx, hero: Hero, item: Item | undefined, kind: ItemKind): void {
  if (!item) return;
  const level = visiblyUpgraded(item);
  if (kind === 'scroll.lullaby' || kind === 'scroll.psionicBlast' || kind === 'scroll.terror') {
    const fov = heroView(ctx.world, hero);
    for (const mob of ctx.floor.mobs) if (fov[mob.pos]) artifactProc(ctx, mob, level, 1);
  } else if (kind === 'scroll.challenge') {
    for (const mob of ctx.floor.mobs) artifactProc(ctx, mob, level, 1);
  }
}

/** The ADD selector's onSelect: the scroll is burnt into the book, which grows a level. */
export function addToSpellbook(ctx: Ctx, hero: Hero, item: Item, index: number): number {
  const scroll = hero.items[index]!;
  const kind = scroll.kind;
  const wanted = indexOf(ctx, item);
  const at = wanted.slice(0, 2).indexOf(kind);
  wanted.splice(at, 1);
  if (--scroll.qty <= 0) hero.items.splice(index, 1);
  upgradeArtifact(ctx, item);
  say(ctx, hero, 'unstablespellbook.infuse_scroll');
  ctx.effects.push({ type: 'burnt', depth: ctx.depth, pos: hero.pos });
  return 2;
}

/** bookRecharge.act: a charge in 80 to 120 turns, the emptier the faster. */
export function spellbookAct(ctx: Ctx, hero: Hero, item: Item): void {
  const cap = chargeCap(item);
  const charge = item.charge ?? 0;
  if (charge < cap && !item.cursed && !magicImmune(hero) && regenOn(ctx, hero)) {
    item.partial = (item.partial ?? 0) + (1 / (120 - (cap - charge) * 5)) * artifactChargeMultiplier(hero);
    while (item.partial >= 1) {
      item.partial--;
      item.charge = (item.charge ?? 0) + 1;
      if (item.charge === cap) item.partial = 0;
    }
  }
}

/** UnstableSpellbook.charge: a tenth of the boost. */
export function chargeSpellbook(hero: Hero, item: Item, amount: number): void {
  const cap = chargeCap(item);
  if ((item.charge ?? 0) >= cap || item.cursed || magicImmune(hero)) return;
  item.partial = (item.partial ?? 0) + 0.1 * amount;
  while (item.partial >= 1) {
    item.partial--;
    item.charge = (item.charge ?? 0) + 1;
  }
  if (item.charge! >= cap) item.partial = 0;
}
