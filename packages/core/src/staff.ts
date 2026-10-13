import type { Hero } from './actors';
import type { Ctx } from './floor';
import { createItem, isCurseEnchant, type Item, itemDef, randomWeaponCurse, wandMaxCharges } from './items';
import type { ItemRef } from './scrolls';

/*
 * The mage's staff (MagesStaff): a melee weapon of the first tier that holds
 * a wand, zapped through it with one more charge than the wand would hold,
 * charging faster, and as strong as the staff. The mage sets out with one
 * imbued with magic missile; imbuing another wand replaces the one inside,
 * and the staff takes the better of the two levels (one more, if the wand
 * was as good). A battlemage's blows with it do what its wand does on a hit
 * (wands.ts staffBlow).
 */

/** MagesStaff(Wand): a staff with a wand in it, known through and through and uncursed, and full. */
export function staffWith(wand: Item): Item {
  const staff = createItem('weapon.magesStaff');
  // Wand.identify: its level, curse and charges known.
  for (const key of ['levelUnknown', 'curseUnknown', 'chargesUnknown', 'usesLeftToID', 'availableUsesToID', 'cursed'] as const) delete wand[key];
  staff.wand = wand;
  updateWand(staff, false);
  wand.charges = wandMaxCharges(wand, true);
  return staff;
}

/**
 * MagesStaff.updateWand: the wand inside is as good as the staff, and holds one charge more; levelled
 * (an upgrade), it gains a charge as well.
 */
export function updateWand(staff: Item, levelled: boolean): void {
  const wand = staff.wand;
  if (!wand) return;
  const charges = wand.charges ?? 0;
  wand.level = staff.level;
  wand.charges = Math.min(charges + (levelled ? 1 : 0), wandMaxCharges(wand, true));
}

/** Why a wand cannot be imbued into a staff. */
export function imbueProblem(hero: Hero, staffRef: ItemRef, wandIndex: number): string | null {
  const staff = staffRef === 'weapon' ? hero.weapon : typeof staffRef === 'number' ? hero.items[staffRef] : undefined;
  if (staff?.kind !== 'weapon.magesStaff') return 'that is no staff';
  const wand = Number.isInteger(wandIndex) ? hero.items[wandIndex] : undefined;
  if (!wand || itemDef(wand.kind).category !== 'wand') return 'choose a wand';
  return null;
}

/**
 * MagesStaff.imbueWand: the wand goes into the staff, the one there before is lost, its charges
 * added to the new one's. The staff takes the higher of the two levels, one more if the wand was at
 * least as good and the staff upgraded at all. The wand's level and charges are known; a cursed wand
 * curses the staff.
 */
export function imbue(ctx: Ctx, hero: Hero, staffRef: ItemRef, wandIndex: number): void {
  const staff = (staffRef === 'weapon' ? hero.weapon : hero.items[staffRef as number])!;
  const wand = hero.items[wandIndex]!;
  hero.items.splice(wandIndex, 1);
  const oldCharges = staff.wand?.charges ?? 0;
  let level = Math.max(staff.level, wand.level);
  if (wand.level >= staff.level && staff.level > 0) level++;
  staff.level = level;
  staff.wand = wand;
  delete wand.levelUnknown;
  delete wand.chargesUnknown;
  delete wand.durability;
  updateWand(staff, false);
  wand.charges = Math.min(wandMaxCharges(wand, true), (wand.charges ?? 0) + oldCharges);
  if (wand.cursed) {
    // MagesStaff.imbueWand: a cursed wand curses the staff, with a curse enchantment unless it has one already.
    if (!staff.cursed || !isCurseEnchant(staff.enchant)) staff.enchant = randomWeaponCurse(ctx.rng);
    staff.cursed = true;
    delete staff.curseUnknown;
    if (hero.weapon === staff) ctx.effects.push({ type: 'cursedEquip', hero: hero.id, item: staff });
  }
  delete wand.cursed;
  ctx.effects.push({ type: 'wand', hero: hero.id, note: 'staffImbued', item: wand.kind });
}
