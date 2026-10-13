import { type Hero, type Item, type ItemKind, type ItemRef, itemDef, startingKit, type World } from '@pd/core';

/*
 * The quick slots as Shattered Pixel Dungeon has them (QuickSlot, Toolbar):
 * six of them, as many shown as the screen has room for (four at least on a
 * phone, all six on a wide screen, keys 1 to 6). Each holds a kind of item
 * from the pack; once the last of it is used up the slot keeps it as a
 * placeholder, greyed, and the next one picked up fills it again
 * (QuickSlot.replacePlaceholder). A new run starts with its class's slots
 * (HeroClass.init…: the warrior's stones, the mage's staff, the rogue's cloak
 * and knives, the huntress's bow). The slots are kept on this device, with the
 * run they belong to. The mage's staff in hand counts as the pack's
 * (WEAPON_SLOT): Shattered puts it in the first slot from the start.
 */

/** The «slot» of the weapon in hand, where the mage's staff is zapped from. */
export const WEAPON_SLOT = -2;

/** QuickSlot.SIZE. */
export const QUICKSLOTS = 6;

const KEY = 'pd-quickslots';

interface Stored {
  /** The run (its seed) and the class the slots were set for. */
  run: string;
  slots: Array<ItemKind | null>;
}

let state: Stored = load();

function load(): Stored {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Stored | null;
    if (raw && typeof raw.run === 'string' && Array.isArray(raw.slots)) {
      return { run: raw.run, slots: Array.from({ length: QUICKSLOTS }, (_, i) => raw.slots[i] ?? null) };
    }
  } catch {
    // No storage, or something else in it: start afresh.
  }
  return { run: '', slots: new Array<ItemKind | null>(QUICKSLOTS).fill(null) };
}

function save(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Kept for this session only.
  }
}

/** The slots belong to this run: a new run (or another hero) starts with its class's (HeroClass.init…). */
export function syncQuickslots(world: World, hero: Hero): void {
  const run = `${world.run.seed}:${hero.id}:${hero.heroClass}`;
  if (state.run === run) return;
  const kit = startingKit(hero.heroClass).quickslots;
  state = { run, slots: Array.from({ length: QUICKSLOTS }, (_, i) => kit[i] ?? null) };
  save();
}

/** QuickSlot.setSlot: an item's kind in a slot, and out of any other (the same item is never in two). */
export function chooseQuickslot(kind: ItemKind, slot = 0): void {
  state.slots = state.slots.map((other, i) => (i === slot ? kind : other === kind ? null : other));
  save();
}

/** QuickSlot.clearSlot. */
export function clearQuickslot(slot: number): void {
  state.slots[slot] = null;
  save();
}

export const isQuickslotted = (kind: ItemKind): boolean => state.slots.includes(kind);

/** The kind a slot holds, if any. */
export const quickKind = (slot: number): ItemKind | null => state.slots[slot] ?? null;

/** What a quickslot tap does with an item: aim a throw or a zap, use it at once, or an artifact's default action. */
export function quickUse(kind: ItemKind): 'throw' | 'zap' | 'use' | 'artifact' | null {
  const category = itemDef(kind).category;
  if (category === 'artifact') return 'artifact';
  if (category === 'wand' || kind === 'weapon.magesStaff') return 'zap';
  if (category === 'missile' || category === 'bomb' || category === 'honeypot' || category === 'seed') return 'throw';
  if (['potion', 'scroll', 'food', 'torch', 'vial', 'wipeout'].includes(category) || kind === 'quest.fish') return 'use';
  return null;
}

/** The backpack slot of the item a quick slot shows, WEAPON_SLOT for the staff in hand, or -1 (empty, or a placeholder: none left). */
export function quickIndex(hero: Hero, slot = 0): number {
  const kind = state.slots[slot];
  if (kind === 'weapon.magesStaff' && hero.weapon?.kind === kind && hero.weapon.wand !== undefined) return WEAPON_SLOT;
  return kind ? hero.items.findIndex((item) => item.kind === kind) : -1;
}

/** The artifact a quick slot shows, worn (by its slot) or in the pack: Shattered's quick slots hold equipped artifacts too. */
export function quickArtifact(hero: Hero, slot: number): { item: Item; ref: ItemRef } | null {
  const kind = state.slots[slot];
  if (!kind || itemDef(kind).category !== 'artifact') return null;
  if (hero.artifact?.kind === kind) return { item: hero.artifact, ref: 'artifact' };
  if (hero.misc?.kind === kind) return { item: hero.misc, ref: 'misc' };
  const index = quickIndex(hero, slot);
  return index >= 0 ? { item: hero.items[index]!, ref: index } : null;
}

/** QuickSlot.isPlaceholder: the slot keeps a kind none of which is left in the pack (or in hand, for the staff; nor worn, for an artifact). */
export const isPlaceholder = (hero: Hero, slot: number): boolean =>
  state.slots[slot] != null && quickIndex(hero, slot) === -1 && quickArtifact(hero, slot) === null;

/**
 * Toolbar.layout: how many slots the screen shows — four on a narrow phone, five from a wider one,
 * six on a wide screen (QuickSlotButton.lastVisible).
 */
export function visibleQuickslots(wide: boolean, width: number): number {
  if (wide) return QUICKSLOTS;
  // Toolbar: 4, one more above 152 points of width, another above 170 (a point is about 2.5 px here).
  return 4 + (width > 380 ? 1 : 0) + (width > 425 ? 1 : 0);
}

/** The item a quick slot shows, if any: in the pack, or the staff in hand. */
export function quickItem(hero: Hero, slot = 0): Item | undefined {
  const index = quickIndex(hero, slot);
  return index === WEAPON_SLOT ? hero.weapon ?? undefined : hero.items[index];
}
