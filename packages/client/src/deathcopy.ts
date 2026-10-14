import type { Hero, HeroClass, MobKind } from '@pd/core';
import { t } from './i18n';

/*
 * The words of the death window (the forum study's U6): what killed the hero, what that means when it was not a
 * monster (hunger, bleeding, deferred damage, a trap), and what the pack held, or what the ankh took from it.
 */

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

/** The things a hero's lost backpack holds (ankh.ts LostInventory), and none if there is none. */
export function lostPackItems(hero: Hero): number {
  const lost = hero.lostInventory;
  return lost ? [lost.weapon, lost.armor, lost.artifact, lost.misc, lost.ring].filter(Boolean).length + lost.items.length : 0;
}

/**
 * What the window says of the pack at the end: what it held, where an earlier ankh's lost backpack still lies (it was
 * never picked up), and that no ankh stood in the way.
 */
export function packLine(hero: Hero): string {
  const lost = hero.lostInventory;
  const parts = [
    hero.items.length > 0 || hero.gold > 0 ? t.forum.death.carried(hero.items.length, hero.gold) : '',
    lost ? t.forum.death.packAt(lost.depth, lostPackItems(hero)) : '',
    t.forum.death.noAnkh,
  ];
  return parts.filter(Boolean).join(' ');
}
