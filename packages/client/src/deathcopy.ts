import { type Hero, itemDef, type MobKind, type HeroClass } from '@pd/core';
import { t } from './i18n';

/*
 * The words of the death window (the forum study's U6): what killed the hero, what that means when it was not a
 * monster (hunger, bleeding, deferred damage, a trap), and what the pack held, or what the ankh took from it.
 */

/** The categories the ankh leaves with the hero (combat.ts resurrect): keys, quest items and tomes. */
const KEPT = new Set(['key', 'quest', 'tome']);

/** What a hero carries that the ankh takes: the stacks in the pack, and the gold. */
export function packWorth(hero: Hero): { items: number; gold: number } {
  return { items: hero.items.filter((item) => !KEPT.has(itemDef(item.kind).category)).length, gold: hero.gold };
}

/** The name of what killed the hero, in the player's words: a hazard, a monster, a class, or the raw word if it is none. */
export function causeName(killedBy: string | null | undefined): string {
  if (!killedBy) return '';
  const named = t.causes[killedBy] ?? t.forum.death.other[killedBy] ?? t.mobs[killedBy as MobKind] ?? t.classes[killedBy as HeroClass];
  return named ?? killedBy;
}

/** A line on what a cause means, for those that are not a monster's blow (empty for the rest). */
export function causeNote(killedBy: string | null | undefined): string {
  return (killedBy && t.forum.death.notes[killedBy]) || '';
}

/** What the window says about the pack at the end: what it held, and that no ankh stood in the way. */
export function packLine(hero: Hero): string {
  const { items, gold } = packWorth(hero);
  return items > 0 || gold > 0 ? `${t.forum.death.carried(items, gold)} ${t.forum.death.noAnkh}` : t.forum.death.noAnkh;
}
