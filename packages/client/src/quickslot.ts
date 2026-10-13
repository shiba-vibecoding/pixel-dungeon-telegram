import { type Hero, type ItemKind, itemDef } from '@pd/core';

/*
 * The quick slots (QuickSlot): the items the player keeps one tap away. The
 * first is on every screen; a wide screen shows a second beside it (keys 1
 * and 2). The player may put any usable item in either; until then the first
 * holds the first thrown weapon or wand in the pack, and the second nothing.
 * The choices are kept on this device.
 */

const KEYS = ['pd-quickslot', 'pd-quickslot2'] as const;

const chosen: Array<ItemKind | null> = KEYS.map((key) => {
  try {
    return localStorage.getItem(key) as ItemKind | null;
  } catch {
    // No storage: the default it is.
    return null;
  }
});

/** Puts an item in a quick slot (0 or 1); out of the other one, if it was there. */
export function chooseQuickslot(kind: ItemKind, slot = 0): void {
  chosen[slot] = kind;
  if (chosen[1 - slot] === kind) chosen[1 - slot] = null;
  KEYS.forEach((key, i) => {
    try {
      if (chosen[i]) localStorage.setItem(key, chosen[i]!);
      else localStorage.removeItem(key);
    } catch {
      // Kept for this session only.
    }
  });
}

export const isQuickslotted = (kind: ItemKind): boolean => chosen.includes(kind);

/** What a quickslot tap does with an item: aim a throw or a zap, or use it at once. */
export function quickUse(kind: ItemKind): 'throw' | 'zap' | 'shoot' | 'use' | null {
  const category = itemDef(kind).category;
  if (category === 'wand') return 'zap';
  // SpiritBow.defaultAction: AC_SHOOT.
  if (category === 'bow') return 'shoot';
  if (category === 'missile' || category === 'bomb' || category === 'honeypot' || category === 'seed') return 'throw';
  if (['potion', 'scroll', 'food', 'torch', 'vial', 'wipeout'].includes(category) || kind === 'quest.fish') return 'use';
  return null;
}

/** The backpack slot shown in a quick slot (0 or 1), or -1. */
export function quickIndex(hero: Hero, slot = 0): number {
  const kind = chosen[slot];
  if (kind) {
    const index = hero.items.findIndex((item) => item.kind === kind);
    if (index >= 0) return index;
  }
  if (slot === 1) return -1;
  // The first slot, empty: the first thrown weapon or wand, unless that is in the second already.
  const other = chosen[1] ? hero.items.findIndex((item) => item.kind === chosen[1]) : -1;
  return hero.items.findIndex((item, i) => {
    const category = itemDef(item.kind).category;
    return i !== other && (category === 'missile' || category === 'wand' || category === 'bow');
  });
}
