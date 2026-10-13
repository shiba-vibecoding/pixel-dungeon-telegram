import type { Hero } from './actors';
import type { Floor } from './floor';
import { createItem, type Item, itemDef, randomDropCell } from './items';
import type { Level } from './level/generate';
import { NEIGHBOURS8 } from './level/geometry';
import { F, hasFlag } from './level/terrain';
import type { Rng } from './rng';
import type { RunState } from './run';
import { artifactValue, removeArtifact } from './artifacts';

/*
 * Bones (Bones.java): a fallen hero leaves one thing behind — the weapon, the
 * armour or a ring, picked at random, or else some of their gold — and the
 * next run finds it on the depth where they fell, in a skeleton. A thing of a
 * dead hero comes back cursed (so disturbing the skeleton may raise a wraith),
 * worn down to what that depth would give, its level unknown. The device keeps
 * the bones between runs (the client); a world carries them until their depth
 * is made. Solo runs only: the daily dungeon is the same for everyone, and a
 * party's world is the room's.
 */

export interface Bones {
  depth: number;
  item: Item;
  /** Laid on their depth (the device may forget them). */
  placed?: boolean;
}

/** How many ways Bones.pickItem chooses between (`roll` below): the weapon, the armour, the artifact, misc and ring slots. */
export const BONES_ROLLS = 5;

/**
 * Bones.leave: what a hero who has just fallen leaves, chosen with `roll` (0 to BONES_ROLLS-1) and `share` (0-1, of
 * the gold). The cloak of shadows is never left behind (Item.bones false).
 */
export function leaveBones(hero: Hero, roll: number, share: number): Bones {
  const picked = [hero.weapon, hero.armor, hero.artifact, hero.misc, hero.ring][roll];
  const worn = picked && picked.kind !== 'artifact.cloak' ? picked : null;
  const item = worn ? (JSON.parse(JSON.stringify(worn)) as Item) : createItem('gold', hero.gold > 0 ? 1 + Math.floor(share * hero.gold) : 1);
  return { depth: hero.depth, item };
}

/**
 * Bones.get: the item as it is found — cursed, worn down to the depth, its level unknown. An artifact the run has
 * not dealt yet comes back as a new one of its kind, +0 and cursed; one dealt already, as its worth in gold.
 */
function asFound(item: Item, depth: number, run: RunState): Item {
  if (item.kind === 'gold') return item;
  if (itemDef(item.kind).category === 'artifact') {
    if (!removeArtifact(run, item.kind)) return createItem('gold', Math.max(1, artifactValue(item)));
    return { ...createItem(item.kind), cursed: true };
  }
  const found: Item = { ...item, cursed: true };
  delete found.curseUnknown;
  // Armor.reset: armour can be kept in bones between runs, the warrior's seal cannot.
  delete found.seal;
  // Weapon and Armor.reset: what was learned of it is forgotten.
  delete found.usesLeftToID;
  delete found.availableUsesToID;
  delete found.levelsToID;
  const category = itemDef(found.kind).category;
  if (category === 'weapon' || category === 'armor' || category === 'ring' || category === 'wand') {
    const most = Math.trunc(((depth - 1) * 3) / 5) + 1;
    if (most < found.level) found.level = most;
    found.levelUnknown = true;
  }
  return found;
}

/** Lays the bones of the last hero who fell here on a newly made depth, in a skeleton (RegularLevel.createItems). */
export function layBones(bones: Bones, level: Level, floor: Floor, rng: Rng, run: RunState): void {
  let pos = randomDropCell(rng, level);
  // Levels without standard rooms (the bosses', the last shop's): beside the way in, as their createItems do.
  if (pos < 0) {
    pos = NEIGHBOURS8.map((n) => level.entrance + n).find((cell) => hasFlag(level.map[cell]!, F.PASSABLE) && !floor.heaps.some((h) => h.pos === cell)) ?? -1;
  }
  bones.placed = true;
  if (pos < 0 || floor.heaps.some((h) => h.pos === pos)) return;
  floor.heaps.push({ pos, kind: 'skeleton', items: [asFound(bones.item, level.depth, run)] });
}
