import { applyLiquidMetal, liquidMetalProblem } from './alchemy';
import { mend, wear } from './wear';
import { chargesKnown, identify, isIdentified, learn } from './ident';
import {
  BACKPACK_SIZE, beckon, createMob, isShopkeeper, statsOf, type Hero, heroArtifacts, heroEquipped, heroRings, isAlive, maxExp, MISC_SLOTS,
  type MiscSlot, type Mob, type MobKind, mobStats, type SubClass, SUBCLASSES,
} from './actors';
import { affectHunger, growHT, STARVING } from './hero';
import { affixProblem, affixSeal, detachProblem, detachSeal, type SealSource } from './seal';
import { refreshMightHT } from './hero';
import { wealthBonusDrops } from './rings';
import {
  artifactPutOn, artifactTakenOff, carriedOf, dispelInvisibility, foodValue, levelCap, pickPetal, say, upgradeArtifact,
} from './artifacts';
import { ballistica, randomRespawnCell } from './ai';
import { charArmor, earnExp, hurt } from './combat';
import { fearless, TERROR_TURNS } from './enchant';
import { conjureImages } from './allies';
import {
  canEnter, charAt, type Ctx, discoverCell, dropItem, enterCell, exploredCells, heroView, isHero, isPassable, isWater, landItem, leaveCell,
} from './floor';
import {
  type Augment, buyPrice, createItem, type Heap, type HeapKind, isCurseEnchant, isCurseGlyph, isStackable, type Item, itemDef, ItemGenerator, type ItemKind,
  itemPrice, knownIn, stacksWith, wandMaxCharges,
} from './items';
import { isTippedDart, mergeMissiles, TIPPED_DARTS } from './missiles';
import { outdatedCopy } from './gear';
import { shootBow, throwMissile } from './throwing';
import { discoverable } from './level/flags';
import { adjacent, distance, LENGTH, NEIGHBOURS4, NEIGHBOURS8, NEIGHBOURS9 } from './level/geometry';
import { discover, F, hasFlag, T } from './level/terrain';
import { type Burst, burst, trapAt, triggerTrap } from './traps';
import { plant, SEED_PLANTS, stepOnPlant } from './plants';
import { gainCharge, heldWands, maxCharges, RECHARGING_TURNS, zap, zapProblem } from './wands';
import { imbue, imbueProblem } from './staff';
import { mineCell, mineProblem, pickaxeKept, TIME_TO_MINE } from './blacksmith';
import { transmute } from './transmute';
import { drinkFromWaterskin, pickUpDew, TIME_TO_DRINK, WATERSKIN_VOLUME } from './waterskin';
import { hasRoom } from './bags';
import { wipeOut } from './altar';
import { CLASS_ARMOR, CLASS_ARMOR_OF, crownProblem, TIME_TO_CROWN, TIME_TO_TRANSFER, transferArmor, transferProblem, useCrown } from './classArmor';
import { furrowGrass, type World } from './world';
import { scaleMob } from './party';
import { ambush, cleanseSpirit, potDropped, potPickedUp, spawnBee, spawnWraith as spawnShatteredWraith } from './mobskills';
import { mimicPrize } from './mobs';
import { underChallenges } from './challenges';
import { checkCandles, dustPickedUp, UNDROPPABLE } from './wandmaker';
import {
  canTarget, defaultTarget, enchantItem, isEnchantable, isItemRef, isTargetedScroll, itemAt, type ItemRef, TARGET_PROBLEMS, type TargetedScroll,
  upgradeItem,
} from './scrolls';
import { brew, brewProblem, chooseTrinket, energizeAt, energizeProblem } from './alchemy';
import { buffsOf, isMagicImmune } from './buffs';
import { eatingTime, onFoodEaten, onItemCollected, onItemEquipped, onPotionUsed, onRunestoneUsed, onScrollUsed, talentUse } from './talents';
import { tbOf } from './talents/state';
import { consumeLethalMomentum } from './talents/turns';
import { improvisedProjectile } from './talents/combat';
import { directChargeCloak } from './artifacts/cloak';
import { hasTalent, initSubclassTalents, talentBook } from './talents/data';
import { CAN_THROW, drinkPotion, drinkProblem, MUST_THROW, shatterPotion } from './potions';
import { readProblem, readScroll, scrollUseProblem } from './reading';
import { activateStone, INVENTORY_STONES, stoneProblem, useStone } from './stones';
import { castSpell, spellProblem } from './spells';
import { explode, lightFuse, snuff } from './bombs';
import { isChallenged, NO_FOOD } from './challenges';

/*
 * Picking things up, drinking, reading, equipping and dropping. Dropping is
 * also how heroes hand items to each other in a party.
 */

export type InventoryAction =
  | { type: 'pickup' }
  /**
   * Hero.actOpenChest: open a chest, a tomb or remains from the next cell (or the one the hero
   * stands on); what they held then lies there, to be picked up.
   */
  | { type: 'open'; cell: number }
  /**
   * Drink a potion, read a scroll or eat. Scrolls of upgrade, enchantment and
   * identify act on the item chosen `on` (see scrolls.ts); `target` is how older
   * clients chose between the weapon and the armour worn.
   */
  | {
    type: 'use'; item: number; on?: ItemRef; target?: 'weapon' | 'armor';
    /** Where a potion of dragon's breath, a siren's song or a targeted spell is aimed. */
    cell?: number;
    /**
     * A choice the item asks for: an enchantment (0-2), an augmentation, a guess, a talent tier, a trinket, a
     * beacon's set (0) or return (1), what to alchemize into (see each item's module).
     */
    choice?: number;
  }
  /**
   * Put on a weapon, armour, ring or artifact. With the artifact, misc and ring slots taken, a ring or
   * an artifact needs `replace`: which of them to take off for it (KindofMisc's window).
   */
  | { type: 'equip'; item: number; replace?: MiscSlot }
  | { type: 'drop'; item: number }
  /** Throw a dart, the boomerang or a potion at a cell; it flies until it hits someone or something. */
  | { type: 'throw'; item: number; target: number }
  /** Zap a wand at a cell: one in the pack (its slot), or the mage's staff in hand ('weapon') or in the pack. */
  | { type: 'zap'; item: ItemRef; target: number }
  /** MagesStaff.AC_IMBUE: a wand from the pack into the mage's staff (in hand, or in the pack). */
  | { type: 'imbue'; staff: ItemRef; wand: number }
  /** Buy the shop's ware the hero stands on. */
  | { type: 'buy' }
  /** Sell an item from the pack to the shopkeeper next to the hero. */
  | { type: 'sell'; item: number }
  /** Take off a worn ring or artifact, back into the pack (or, with no room there, at the hero's feet). */
  | { type: 'remove'; slot: MiscSlot }
  /** Put the weapon in hand away (KindOfWeapon's UNEQUIP), into the pack or, with no room there, at the hero's feet. */
  | { type: 'unequip' }
  /** Read the Tome of Mastery and master one of the two ways of the hero's class. */
  | { type: 'master'; item: number; subclass: SubClass }
  /** HeroAction.Mine: on the blacksmith's mine, break the wall, vein of dark gold, crystal or boulder beside the hero with his pickaxe. */
  | { type: 'mine'; cell: number }
  /**
   * ClassArmor.AC_TRANSFER: the class armour (`to`: the one worn or one in the pack) takes over the properties of another
   * armour in the pack (`from`), which is destroyed.
   */
  | { type: 'transfer'; to: SealSource; from: SealSource }
  /**
   * AlchemyScene: brew at an alchemy pot. `inputs` are pack slots, one item from each (a stack of thrown weapons or
   * of liquid metal whole; a slot twice for two of it); `recipe` which of the recipes they make (alchemy.ts).
   */
  | { type: 'alchemy'; inputs: number[]; recipe?: number }
  /** WndEnergizeItem: turn an item from the pack (or the whole stack) into alchemical energy, at a pot. */
  | { type: 'energize'; item: number; all?: boolean }
  /**
   * StoneOfAugmentation.apply: the stone (`item`) augments a weapon (speed, damage) or armour (evasion, defense) held
   * (`on`), or takes its augment away ('none').
   */
  | { type: 'augment'; item: number; on: ItemRef; augment: Augment | 'none' }
  /** SpiritBow.AC_SHOOT: an arrow of spirit at a cell. */
  | { type: 'shoot'; item: number; target: number }
  /** Dart.AC_TIP: darts (`item`) tipped with a seed (`seed`): two for the seed, or (`all`) as many as the seeds will tip. */
  | { type: 'tip'; item: number; seed: number; all?: boolean }
  /** TippedDart.AC_CLEAN: one tipped dart, or (`all`) the whole stack, wiped back to plain darts. */
  | { type: 'clean'; item: number; all?: boolean }
  /**
   * BrokenSeal.AC_AFFIX: the warrior's seal, from the pack or off the armour it is on (`from`: a pack slot,
   * or 'armor' for the one worn), onto an armour (`to`, the same way); and Armor.AC_DETACH, the seal off an armour.
   */
  | { type: 'affix'; from: SealSource; to: SealSource }
  | { type: 'detach'; armor: SealSource };

const INVENTORY_ACTIONS: ReadonlySet<string> = new Set([
  'pickup', 'open', 'use', 'equip', 'drop', 'throw', 'zap', 'buy', 'sell', 'remove', 'unequip', 'master', 'mine', 'transfer', 'alchemy',
  'energize', 'augment', 'shoot', 'tip', 'clean', 'imbue', 'affix', 'detach',
]);

export function isInventoryAction(action: { type: string }): action is InventoryAction {
  return INVENTORY_ACTIONS.has(action.type);
}

/** Why a cursed item will not come off. */
const CURSED = 'it is cursed: you cannot take it off';

const TIME_TO_PICK_UP = 1;
/** Key.TIME_TO_UNLOCK. */
const TIME_TO_UNLOCK = 1;
const TIME_TO_USE = 1;
const TIME_TO_EQUIP = 1;
const TIME_TO_DROP = 1;
const TIME_TO_THROW = 1;
const TIME_TO_EAT = 3;
/** PhantomFish.TIME_TO_EAT. */
const TIME_TO_EAT_FISH = 2;
/** InventoryStone.useAnimation: a stone takes a turn; tipping or cleaning darts a turn. */
const TIME_TO_AUGMENT = 1;
const TIME_TO_TIP = 1;
/** TomeOfMastery.TIME_TO_READ. */
const TIME_TO_READ_TOME = 10;
/** Light.DURATION. */
const LIGHT_TURNS = 250;

const MIND_VISION_DURATION = 20;
const INVISIBILITY_DURATION = 15;
/** Levitation.DURATION; GasesImmunity lasts 5 turns in the original, but here gas has no lingering cloud to outlast. */
const LEVITATION_DURATION = 20;
const GAS_IMMUNITY_DURATION = 15;

/**
 * The backpack slot of the key a chest wants (Hero.actOpenChest): a golden key for a locked chest, a crystal
 * key for a crystal chest, of the hero's depth; -1 if none. Keys do not work on the quests' side levels.
 */
function chestKeyFor(world: World, hero: Hero, heap: Heap): number {
  if (world.levels[hero.depth]?.branch) return -1;
  const kind = heap.kind === 'crystalChest' ? 'key.crystal' : 'key.golden';
  return hero.items.findIndex((item) => item.kind === kind && item.depth === hero.depth);
}

function heapAt(world: World, hero: Hero): Heap | undefined {
  return world.floors[hero.depth]?.heaps.find((heap) => heap.pos === hero.pos);
}

export function inventoryProblem(world: World, hero: Hero, action: InventoryAction): string | null {
  if (action.type === 'pickup') {
    const heap = heapAt(world, hero);
    if (!heap) return 'nothing here';
    if ((heap.kind === 'lockedChest' || heap.kind === 'crystalChest') && chestKeyFor(world, hero, heap) < 0) return 'the chest is locked';
    if (heap.kind === 'hidden') return 'nothing here';
    return heap.kind === 'forSale' ? 'that is for sale' : null;
  }
  if (action.type === 'open') {
    const heap = Number.isInteger(action.cell) ? world.floors[hero.depth]?.heaps.find((h) => h.pos === action.cell) : undefined;
    if (!heap || heap.kind === 'heap' || heap.kind === 'forSale' || heap.kind === 'hidden') return 'nothing to open';
    if (heap.pos !== hero.pos && !adjacent(heap.pos, hero.pos)) return 'too far away';
    if ((heap.kind === 'lockedChest' || heap.kind === 'crystalChest') && chestKeyFor(world, hero, heap) < 0) return 'the chest is locked';
    return null;
  }
  if (action.type === 'mine') return mineProblem(world, hero, action.cell);
  if (action.type === 'alchemy') return brewProblem(world, hero, action.inputs, action.recipe ?? 0);
  if (action.type === 'energize') return energizeProblem(world, hero, action.item);
  if (action.type === 'imbue') return isItemRef(action.staff) ? imbueProblem(hero, action.staff, action.wand) : 'that is no staff';
  if (action.type === 'zap') {
    if (!isItemRef(action.item)) return 'no such item';
    // (Shield battery lets the mage zap a wand at themselves.)
    if (!Number.isInteger(action.target) || action.target < 0 || action.target >= LENGTH || (action.target === hero.pos && !hasTalent(hero, 'shield_battery'))) return 'bad target';
    // Wand.actions: no zapping a wand known to be empty; one of unknown charges may be tried, and fizzle.
    return zapProblem(hero, action.item);
  }
  if (action.type === 'affix') return affixProblem(hero, action.from, action.to);
  if (action.type === 'detach') return detachProblem(hero, action.armor);
  if (action.type === 'transfer') return transferProblem(hero, action.to, action.from);
  if (action.type === 'unequip') {
    if (!hero.weapon) return 'nothing in hand';
    // EquipableItem.doUnequip: a cursed weapon will not leave the hand.
    return hero.weapon.cursed ? CURSED : null;
  }
  if (action.type === 'remove') {
    const worn = MISC_SLOTS.includes(action.slot) ? hero[action.slot] : null;
    if (!worn) return 'nothing worn there';
    return worn.cursed ? CURSED : null;
  }
  if (action.type === 'buy') {
    const heap = heapAt(world, hero);
    const ware = heap?.kind === 'forSale' ? heap.items[0] : undefined;
    if (!ware) return 'nothing for sale here';
    if (hero.gold < buyPrice(ware, hero.depth, knownIn(world.known, ware.kind), haggles(hero))) return 'not enough gold';
    return hasRoom(hero, ware) ? null : 'your pack is full';
  }
  const item = Number.isInteger(action.item) ? hero.items[action.item] : undefined;
  if (!item) return 'no such item';
  const category = itemDef(item.kind).category;
  switch (action.type) {
    case 'use':
      return useProblem(world, hero, item, action);
    case 'equip': {
      if (category !== 'weapon' && category !== 'armor' && category !== 'ring' && category !== 'artifact') return 'that cannot be equipped';
      if (category === 'ring' || category === 'artifact') return miscEquipProblem(hero, item, action.replace);
      // A cursed item, once worn, will not come off (EquipableItem.doUnequip).
      // ClassArmor.doEquip: class armour is for its own class only.
      if (CLASS_ARMOR.includes(item.kind) && item.kind !== CLASS_ARMOR_OF[hero.heroClass]) return 'that armour is not made for you';
      return hero[category]?.cursed ? CURSED : null;
    }
    case 'drop':
      // CorpseDust.actions: none, not even dropping it.
      if (UNDROPPABLE.has(item.kind)) return 'you cannot drop that';
      // Pickaxe.actions: not on the mine, where it is needed.
      return pickaxeKept(world, hero, item) ? 'you need the pickaxe down here' : null;
    case 'augment': {
      if (item.kind !== 'stone.augmentation') return 'that is no stone of augmentation';
      if (!isItemRef(action.on)) return 'bad target';
      const on = itemAt(hero, action.on);
      if (!on || !isEnchantable(on)) return 'that cannot be augmented';
      const armour = itemDef(on.kind).category === 'armor';
      const choices = armour ? ['evasion', 'defense', 'none'] : ['speed', 'damage', 'none'];
      if (!choices.includes(action.augment)) return 'bad choice';
      return (on.augment ?? 'none') === action.augment ? 'it is augmented that way already' : null;
    }
    case 'shoot':
      if (category !== 'bow') return 'that is no bow';
      if (!Number.isInteger(action.target) || action.target < 0 || action.target >= LENGTH || action.target === hero.pos) return 'bad target';
      return null;
    case 'tip': {
      if (item.kind !== 'missile.dart') return 'those are no darts';
      const seed = Number.isInteger(action.seed) ? hero.items[action.seed] : undefined;
      if (!seed || itemDef(seed.kind).category !== 'seed') return 'choose a seed';
      return TIPPED_DARTS[seed.kind] ? null : 'darts cannot be tipped with that';
    }
    case 'clean':
      return isTippedDart(item.kind) ? null : 'that is no tipped dart';
    case 'master':
      if (item.kind !== 'tome.mastery' && item.kind !== 'mask.tengu') return 'that is no mask';
      if (hero.subclass) return 'you have already mastered a way';
      return SUBCLASSES[hero.heroClass].includes(action.subclass) ? null : 'not a way for you';
    case 'sell':
      if (!shopkeeperBeside(world, hero)) return 'nobody to sell to';
      return itemPrice(item, knownIn(world.known, item.kind)) > 0 ? null : 'nobody would buy that';
    case 'throw': {
      // Item.AC_THROW: anything in the pack may be thrown (a bag would scatter what it holds: not that).
      if (category === 'bag' || UNDROPPABLE.has(item.kind)) return 'that cannot be thrown';
      if (pickaxeKept(world, hero, item)) return 'you need the pickaxe down here';
      if (!Number.isInteger(action.target) || action.target < 0 || action.target >= LENGTH || action.target === hero.pos) {
        return 'bad target';
      }
      return null;
    }
  }
}

/** Why an item cannot be used (drunk, read, eaten, cast...) as asked. */
function useProblem(world: World, hero: Hero, item: Item, action: Extract<InventoryAction, { type: 'use' }>): string | null {
  const category = itemDef(item.kind).category;
  const usable = ['potion', 'scroll', 'food', 'torch', 'kit', 'honeypot', 'vial', 'wipeout', 'brew', 'elixir', 'spell', 'catalyst'];
  const inventoryStone = INVENTORY_STONES.has(item.kind);
  if (!usable.includes(category) && item.kind !== 'quest.fish' && !inventoryStone && item.kind !== 'resin' && item.kind !== 'liquidMetal') {
    return 'that cannot be used';
  }
  // KingsCrown.execute: any armour will do (class armour too: the crown gives it another ability).
  if (category === 'kit') return crownProblem(action.choice);
  if (category === 'vial' && !item.volume) return 'your waterskin is empty';
  if (category === 'wipeout' && (hero.blind ?? 0) > 0) return 'you cannot read while blinded';
  if (action.target !== undefined && action.target !== 'weapon' && action.target !== 'armor') return 'bad target';
  if (action.on !== undefined && !isItemRef(action.on)) return 'bad target';
  if (action.cell !== undefined && (!Number.isInteger(action.cell) || action.cell < 0 || action.cell >= LENGTH)) return 'bad target';
  if (action.choice !== undefined && (!Number.isInteger(action.choice) || action.choice < 0 || action.choice > 255)) return 'bad choice';
  // Blandfruit: raw, it is not to be eaten.
  if (item.kind === 'food.blandfruit' && !item.potion) return 'it is too raw to eat';
  const known = knownIn(world.known, item.kind);
  const on = action.on !== undefined ? itemAt(hero, action.on) : undefined;
  if (action.on !== undefined && !on) return 'no such item';
  if (category === 'potion' || category === 'brew' || category === 'elixir') {
    return drinkProblem(world, hero, item.kind, known, { cell: action.cell, choice: action.choice, on });
  }
  if (category === 'scroll') {
    const reading = readProblem(hero);
    if (reading) return reading;
    const targeted = isTargetedScroll(item.kind) ? scrollTargetProblem(world, hero, item.kind, action) : null;
    if (targeted) return targeted;
    return scrollUseProblem(world, hero, item.kind, known, { cell: action.cell, choice: action.choice }, scrollTarget(world, hero, item.kind, action));
  }
  if (inventoryStone || category === 'spell' || item.kind === 'resin' || item.kind === 'liquidMetal') {
    if (isMagicImmune(hero) && item.kind !== 'resin' && item.kind !== 'liquidMetal') return 'your magic is suppressed';
    if (isTargetedScroll(item.kind)) {
      if (!on) return 'choose an item';
      if (!canTarget(world, item.kind, on)) return TARGET_PROBLEMS[item.kind];
    }
    if (inventoryStone) return stoneProblem(world, item.kind, on!, action.choice);
    if (item.kind === 'resin') return resinProblem(on!, item);
    if (item.kind === 'liquidMetal') return liquidMetalProblem(on!, item);
    return spellProblem(world, hero, item.kind, { on, cell: action.cell, choice: action.choice });
  }
  if (category === 'catalyst') {
    // TrinketCatalyst.WndTrinket: one of the four trinkets brewing it rolled.
    if (!item.rolled) return 'brew it in an alchemy pot first';
    return action.choice !== undefined && action.choice < item.rolled.length ? null : 'choose a trinket';
  }
  return null;
}

/** ArcaneResin: a wand below +3, and a resin more than its level. */
function resinProblem(wand: Item, resin: Item): string | null {
  if (wand.level >= 3) return 'resin cannot raise a wand further';
  return resin.qty >= wand.level + 1 ? null : `that needs ${wand.level + 1} resin`;
}

/** Performs an inventory action and says how long it took. */
export function performInventory(ctx: Ctx, hero: Hero, action: InventoryAction): number {
  switch (action.type) {
    case 'pickup':
      pickUp(ctx, hero);
      return TIME_TO_PICK_UP;
    case 'open':
      openHeap(ctx, hero, ctx.floor.heaps.find((h) => h.pos === action.cell)!);
      return TIME_TO_UNLOCK;
    case 'mine':
      mineCell(ctx, hero, action.cell);
      return TIME_TO_MINE;
    // BrokenSeal.affixToArmor and Armor.AC_DETACH take no time.
    case 'affix':
      affixSeal(ctx, hero, action.from, action.to);
      return 0;
    case 'detach':
      detachSeal(ctx, hero, action.armor);
      return 0;
    case 'transfer':
      transferArmor(ctx, hero, action.to, action.from);
      return TIME_TO_TRANSFER;
    case 'alchemy':
      // AlchemyScene: brewing takes no time.
      brew(ctx, hero, action.inputs, action.recipe ?? 0);
      return 0;
    case 'energize':
      energizeAt(ctx, hero, action.item, action.all === true);
      return 0;
    case 'augment': {
      // StoneOfAugmentation.apply: the stone is used up, and the item augmented the chosen way.
      const on = itemAt(hero, action.on)!;
      const stone = hero.items[action.item]!;
      if (action.augment === 'none') delete on.augment;
      else on.augment = action.augment;
      if (--stone.qty <= 0) hero.items.splice(hero.items.indexOf(stone), 1);
      ctx.effects.push({ type: 'augmented', hero: hero.id, item: on });
      return TIME_TO_AUGMENT;
    }
    case 'shoot':
    {
      const time = shootBow(ctx, hero, action.item, action.target);
      return consumeLethalMomentum(hero) ? 0 : time;
    }
    case 'tip':
      tipDarts(ctx, hero, action.item, action.seed, action.all === true);
      return TIME_TO_TIP;
    case 'clean': {
      // TippedDart.AC_CLEAN: wiped back into plain darts, the whole stack or one of it (the rest whole again).
      const tipped = hero.items[action.item]!;
      const qty = action.all ? tipped.qty : 1;
      if (qty >= tipped.qty) hero.items.splice(action.item, 1);
      else {
        tipped.qty -= qty;
        delete tipped.durability;
      }
      const darts = createItem('missile.dart', qty);
      if (!collect(hero, darts)) dropItem(ctx.floor, hero.pos, darts);
      ctx.effects.push({ type: 'cleaned', hero: hero.id, qty });
      return TIME_TO_TIP;
    }
    case 'use':
      if (itemDef(hero.items[action.item]!.kind).category === 'food') {
        const time = eatingTime(hero, hero.items[action.item]!.kind);
        eat(ctx, hero, action.item, time);
        return time;
      }
      if (itemDef(hero.items[action.item]!.kind).category === 'wipeout') {
        const scroll = hero.items[action.item]!;
        if (--scroll.qty <= 0) hero.items.splice(action.item, 1);
        wipeOut(ctx, hero);
        return TIME_TO_USE;
      }
      if (hero.items[action.item]!.kind === 'quest.fish') {
        // PhantomFish.execute: eaten, it leaves the hero unseen for a while.
        hero.items.splice(action.item, 1);
        hero.invisible = Math.max(hero.invisible, INVISIBILITY_DURATION);
        ctx.effects.push({ type: 'ate', hero: hero.id, kind: 'quest.fish', outcome: 'invisible' });
        return TIME_TO_EAT_FISH;
      }
      if (itemDef(hero.items[action.item]!.kind).category === 'vial') {
        drinkFromWaterskin(ctx, hero, hero.items[action.item]!);
        return TIME_TO_DRINK;
      }
      if (hero.items[action.item]!.kind === 'honeypot') {
        // Honeypot.execute: shattered right where the hero stands, its pieces kept (the bee is after whoever holds them).
        const pot = hero.items[action.item]!;
        if (--pot.qty <= 0) hero.items.splice(action.item, 1);
        if (shatterHoneypot(ctx, hero.pos, hero.id)) {
          if (!collect(hero, createItem('honeypot.shattered'))) dropItem(ctx.floor, hero.pos, createItem('honeypot.shattered'));
        } else {
          landItem(ctx, hero.pos, createItem('honeypot'));
        }
        return TIME_TO_THROW;
      }
      if (itemDef(hero.items[action.item]!.kind).category === 'kit') {
        useCrown(ctx, hero, action.item, action.choice!);
        return TIME_TO_CROWN;
      }
      if (itemDef(hero.items[action.item]!.kind).category === 'torch') {
        // Torch.execute: lit, it lights the way for a good while.
        const torch = hero.items[action.item]!;
        if (--torch.qty <= 0) hero.items.splice(action.item, 1);
        hero.light = Math.max(hero.light, LIGHT_TURNS);
        ctx.effects.push({ type: 'lit', hero: hero.id });
        return TIME_TO_USE;
      }
      return use(ctx, hero, action);
    case 'master':
      // TomeOfMastery.choose: the tome is used up, and the hero takes a new way.
      hero.items.splice(action.item, 1);
      hero.subclass = action.subclass;
      // TengusMask.choose: the subclass's talents of the third tier open (Talent.initSubclassTalents).
      talentBook(hero);
      initSubclassTalents(hero);
      ctx.effects.push({ type: 'mastered', hero: hero.id, subclass: action.subclass });
      return TIME_TO_READ_TOME;
    case 'unequip': {
      const weapon = hero.weapon!;
      hero.weapon = null;
      if (hasRoom(hero, weapon)) hero.items.push(weapon);
      else dropItem(ctx.floor, hero.pos, weapon);
      ctx.effects.push({ type: 'dropped', hero: hero.id, item: weapon });
      return TIME_TO_EQUIP;
    }
    case 'remove': {
      // KindofMisc.doUnequip: into the pack, or with no room there, at the hero's feet.
      const worn = takeOffMisc(ctx, hero, action.slot);
      if (hasRoom(hero, worn)) hero.items.push(worn);
      else dropItem(ctx.floor, hero.pos, worn);
      ctx.effects.push({ type: 'dropped', hero: hero.id, item: worn });
      return TIME_TO_EQUIP;
    }
    case 'equip': {
      const item = hero.items[action.item]!;
      if (itemDef(item.kind).category === 'ring' || itemDef(item.kind).category === 'artifact') {
        equipMisc(ctx, hero, action.item, action.replace);
        return TIME_TO_EQUIP;
      }
      const slot = itemDef(item.kind).category as 'weapon' | 'armor';
      // Bare-handed, nothing goes back into the pack.
      const old = hero[slot];
      if (old) hero.items[action.item] = old;
      else hero.items.splice(action.item, 1);
      hero[slot] = item;
      ctx.effects.push({ type: 'equipped', hero: hero.id, item });
      // KindOfWeapon.doEquip and Armor.doEquip: in hand or worn, its curse is known.
      delete item.curseUnknown;
      if (item.cursed) ctx.effects.push({ type: 'cursedEquip', hero: hero.id, item });
      onItemEquipped(ctx, hero, item);
      return TIME_TO_EQUIP;
    }
    case 'drop': {
      // Level.drop: what the challenges forbid on the floor turns to gold as it leaves the hand, before any well sees it.
      const item = underChallenges(ctx.world, hero.items.splice(action.item, 1)[0]!);
      // Into a well of transmutation, it comes out as something else, and the well runs dry.
      const well = ctx.level.wells.findIndex((w) => w.pos === hero.pos && w.water === 'transmutation');
      const changed = well >= 0 && ctx.level.map[hero.pos] === T.WELL ? transmute(item, ctx.rng, ctx.depth) : null;
      if (changed) {
        ctx.level.wells.splice(well, 1);
        ctx.level.map[hero.pos] = T.EMPTY_WELL;
        dropItem(ctx.floor, hero.pos, changed);
        ctx.effects.push({ type: 'transmuted', hero: hero.id, from: item, to: changed });
        return TIME_TO_DROP;
      }
      // The waterskin into a well of health (WaterOfHealth.affectItem): it comes out full, and the well runs dry.
      const healing = ctx.level.wells.findIndex((w) => w.pos === hero.pos && w.water === 'health');
      if (item.kind === 'waterskin' && (item.volume ?? 0) < WATERSKIN_VOLUME && healing >= 0 && ctx.level.map[hero.pos] === T.WELL) {
        item.volume = WATERSKIN_VOLUME;
        ctx.level.wells.splice(healing, 1);
        ctx.level.map[hero.pos] = T.EMPTY_WELL;
        dropItem(ctx.floor, hero.pos, item);
        ctx.effects.push({ type: 'dewCollected', hero: hero.id, full: true });
        return TIME_TO_DROP;
      }
      // Into a well of awareness, something not yet identified is revealed, and the well runs dry (WaterOfAwareness.affectItem).
      const awareness = ctx.level.wells.findIndex((w) => w.pos === hero.pos && w.water === 'awareness');
      if (awareness >= 0 && ctx.level.map[hero.pos] === T.WELL && !isIdentified(ctx.world, item)) {
        identify(ctx.world, item);
        ctx.level.wells.splice(awareness, 1);
        ctx.level.map[hero.pos] = T.EMPTY_WELL;
        dropItem(ctx.floor, hero.pos, item);
        ctx.effects.push({ type: 'revealed', hero: hero.id, item });
        return TIME_TO_DROP;
      }
      // Floating over a chasm, it falls through.
      landItem(ctx, hero.pos, item);
      ctx.effects.push({ type: 'dropped', hero: hero.id, item });
      // CeremonialCandle.doDrop: the ritual may be complete.
      if (item.kind === 'quest.candle') checkCandles(ctx);
      // ShatteredPot.doDrop: its bee guards it where it lies.
      if (item.kind === 'honeypot.shattered') potDropped(ctx, hero.id, hero.pos);
      return TIME_TO_DROP;
    }
    case 'throw': {
      // MissileWeapon.castDelay: a thrown weapon at someone takes its delay (throwing.ts); a kill with lethal momentum costs nothing.
      const missile = itemDef(hero.items[action.item]!.kind).category === 'missile';
      let time = TIME_TO_THROW;
      if (missile) time = throwMissile(ctx, hero, action.item, action.target);
      else {
        const whole = hero.items[action.item]!;
        throwItem(ctx, hero, action.item, action.target);
        // Item.cast: improvised projectiles, anything thrown at an enemy blinds it for a moment.
        improvisedProjectile(ctx, hero, whole, action.target);
      }
      return consumeLethalMomentum(hero) ? 0 : time;
    }
    case 'zap':
      return zap(ctx, hero, action.item, action.target);
    case 'imbue':
      // MagesStaff.itemSelector.applyWand: no time is taken.
      imbue(ctx, hero, action.staff, action.wand);
      return 0;
    case 'buy': {
      // WndTradeItem.buy: the gold goes, the ware comes into the pack.
      const heap = heapAt(ctx.world, hero)!;
      const item = heap.items.shift()!;
      const price = buyPrice(item, hero.depth, knownIn(ctx.world.known, item.kind), haggles(hero));
      hero.gold -= price;
      // A sandbag goes into the hourglass (sandBag.doPickUp); without one it stays on the counter.
      if (item.kind === 'sandbag' && !artifactPiece(ctx, hero, item)) dropItem(ctx.floor, hero.pos, item);
      else if (item.kind !== 'sandbag') collect(hero, item);
      if (heap.items.length === 0) ctx.floor.heaps.splice(ctx.floor.heaps.indexOf(heap), 1);
      ctx.effects.push({ type: 'bought', hero: hero.id, item, price });
      return TIME_TO_PICK_UP;
    }
    case 'sell': {
      // WndTradeItem.sellAll: the whole stack, at the item's own price.
      const item = hero.items.splice(action.item, 1)[0]!;
      const price = itemPrice(item, knownIn(ctx.world.known, item.kind));
      hero.gold += price;
      ctx.effects.push({ type: 'sold', hero: hero.id, item, price });
      return 0;
    }
  }
}

/**
 * DriedRose.Petal.doPickUp and TimekeepersHourglass.sandBag.doPickUp: a petal makes the rose carried stronger
 * (with no room left it is discarded), a sandbag the hourglass carried, if it is not cursed. False: left lying.
 */
function artifactPiece(ctx: Ctx, hero: Hero, item: Item): boolean {
  if (item.kind === 'petal') {
    for (let i = 0; i < item.qty; i++) if (pickPetal(ctx, hero) === 'none') return false;
    return true;
  }
  const hourglass = carriedOf(hero, 'artifact.hourglass');
  if (!hourglass || hourglass.cursed) {
    say(ctx, hero, 'timekeepershourglass$sandbag.no_hourglass', 'w');
    return false;
  }
  upgradeArtifact(ctx, hourglass, item.qty);
  say(ctx, hero, hourglass.level >= levelCap(hourglass) ? 'timekeepershourglass$sandbag.maxlevel' : 'timekeepershourglass$sandbag.levelup',
    hourglass.level >= levelCap(hourglass) ? 'p' : 'i');
  return true;
}

/** Wearing a ring of haggler, shops ask half. */
export const haggles = (_hero: Hero): boolean => false;

/*
 * KindofMisc: rings and artifacts share three slots — the artifact slot, the misc slot (either) and
 * the ring slot. A new one goes where its kind goes, else into the misc slot; with those taken, what
 * is worn may be moved over to make room, or else the player chooses what to take off for it.
 */

const isRingItem = (item: Item | null): boolean => !!item && itemDef(item.kind).category === 'ring';
const isArtifactItem = (item: Item | null): boolean => !!item && itemDef(item.kind).category === 'artifact';

/** KindofMisc.doEquip: whether no slot is free for it, even after moving what is in the misc slot over. */
function miscFull(hero: Hero, item: Item): boolean {
  if (isArtifactItem(item)) return !!hero.artifact && !!hero.misc && !(isRingItem(hero.misc) && !hero.ring);
  return !!hero.misc && !!hero.ring && !(isArtifactItem(hero.misc) && !hero.artifact);
}

/**
 * KindofMisc's window: what may be taken off for it, with every slot taken. A ring with a ring in the
 * misc slot must take the place of a ring; an artifact with an artifact there, of an artifact.
 */
export function miscChoices(hero: Hero, item: Item): MiscSlot[] {
  if (!miscFull(hero, item)) return [];
  return MISC_SLOTS.filter((slot) => {
    if (!hero[slot]) return false;
    if (slot === 'artifact' && isRingItem(item) && isRingItem(hero.misc)) return false;
    if (slot === 'ring' && isArtifactItem(item) && isArtifactItem(hero.misc)) return false;
    return true;
  });
}

function miscEquipProblem(hero: Hero, item: Item, replace: MiscSlot | undefined): string | null {
  // Artifact.doEquip: never two of one kind.
  if (isArtifactItem(item) && [hero.artifact, hero.misc].some((worn) => worn?.kind === item.kind)) {
    return 'you cannot wear two of the same artifact';
  }
  if (!miscFull(hero, item)) return null;
  if (replace === undefined) return 'choose what to take off';
  if (!miscChoices(hero, item).includes(replace)) return 'bad choice';
  // EquipableItem.doUnequip: a cursed thing will not come off.
  return hero[replace]!.cursed ? CURSED : null;
}

/** Takes a ring or an artifact off its slot, ending what the artifact had under way (Artifact.doUnequip). */
function takeOffMisc(ctx: Ctx, hero: Hero, slot: MiscSlot): Item {
  const worn = hero[slot]!;
  hero[slot] = null;
  if (isArtifactItem(worn)) artifactTakenOff(ctx, hero, worn);
  // RingOfMight.doUnequip: Hero.updateHT.
  if (worn.kind === 'ring.might') refreshMightHT(hero, false);
  return worn;
}

/** KindofMisc.doEquip, with the window's choice (`replace`) when every slot is taken. */
function equipMisc(ctx: Ctx, hero: Hero, index: number, replace: MiscSlot | undefined): void {
  const item = hero.items.splice(index, 1)[0]!;
  if (miscFull(hero, item)) {
    // The window's onSelect: the chosen one comes off (into the pack, whose room the new one just left),
    // and what is in the misc slot moves over where it must.
    hero.items.push(takeOffMisc(ctx, hero, replace!));
    if (replace === 'artifact' && isRingItem(item)) {
      hero.artifact = hero.misc;
      hero.misc = null;
    } else if (replace === 'ring' && isArtifactItem(item)) {
      hero.ring = hero.misc;
      hero.misc = null;
    }
  }
  // See if what is worn can be rearranged first.
  if (isArtifactItem(item) && hero.artifact && hero.misc && isRingItem(hero.misc) && !hero.ring) {
    hero.ring = hero.misc;
    hero.misc = null;
  } else if (isRingItem(item) && hero.misc && hero.ring && isArtifactItem(hero.misc) && !hero.artifact) {
    hero.artifact = hero.misc;
    hero.misc = null;
  }
  if (isArtifactItem(item)) {
    if (!hero.artifact) hero.artifact = item;
    else hero.misc = item;
  } else if (!hero.ring) {
    hero.ring = item;
  } else {
    hero.misc = item;
  }
  ctx.effects.push({ type: 'equipped', hero: hero.id, item });
  // RingOfMight.doEquip: Hero.updateHT.
  if (item.kind === 'ring.might') refreshMightHT(hero, false);
  // KindofMisc.doEquip: put on, its curse is known (it binds itself at once, if it is cursed).
  delete item.curseUnknown;
  if (item.cursed) ctx.effects.push({ type: 'cursedEquip', hero: hero.id, item });
  if (isArtifactItem(item)) {
    // Artifact.doEquip: an artifact put on is known through and through.
    identify(ctx.world, item);
    artifactPutOn(ctx, hero, item);
  }
  onItemEquipped(ctx, hero, item);
}

/** A shopkeeper standing next to the hero, ready to trade. */
export function shopkeeperBeside(world: World, hero: Hero): boolean {
  return (world.floors[hero.depth]?.mobs ?? []).some((mob) => isShopkeeper(mob) && adjacent(mob.pos, hero.pos));
}

/** MissileWeapon.onThrow: a hit uses the dart up, a miss leaves it on the floor; the boomerang returns. */
function throwItem(ctx: Ctx, hero: Hero, index: number, target: number): void {
  const item = hero.items[index]!;
  const category = itemDef(item.kind).category;
  if (category === 'potion' || category === 'brew' || category === 'elixir' || (item.kind === 'food.blandfruit' && item.potion)) {
    throwPotion(ctx, hero, index, target);
    return;
  }
  if (category === 'bomb') {
    throwBomb(ctx, hero, index, target);
    return;
  }
  if (category === 'stone' && !INVENTORY_STONES.has(item.kind) && !isMagicImmune(hero)) {
    throwStone(ctx, hero, index, target);
    return;
  }
  if (item.kind === 'honeypot') {
    // Honeypot.onThrow: it breaks where it lands (its pieces lie there, guarded), unless it falls down a chasm.
    if (--item.qty <= 0) hero.items.splice(index, 1);
    const end = ballistica(ctx, hero.pos, target).at(-1)!;
    ctx.effects.push({ type: 'thrown', depth: ctx.depth, from: hero.pos, to: end, item: 'honeypot' });
    if (hasFlag(ctx.level.map[end]!, F.PIT)) landItem(ctx, end, createItem('honeypot'));
    else landItem(ctx, end, createItem(shatterHoneypot(ctx, end, null) ? 'honeypot.shattered' : 'honeypot'));
    return;
  }
  if (itemDef(item.kind).category === 'seed') {
    // Plant.Seed.onThrow: it takes root where it lands; tossed, it lands where it was aimed.
    const kind = item.kind;
    if (--item.qty <= 0) hero.items.splice(index, 1);
    const end = ballistica(ctx, hero.pos, target, false, true).at(-1)!;
    ctx.effects.push({ type: 'thrown', depth: ctx.depth, from: hero.pos, to: end, item: kind });
    // Onto an alchemy pot it just lies there (seeds are brewed in the pot's window now); into a chasm, it falls.
    if (ctx.level.map[end] === T.ALCHEMY) {
      dropItem(ctx.floor, end, createItem(kind));
    } else if (hasFlag(ctx.level.map[end]!, F.PIT)) {
      landItem(ctx, end, createItem(kind));
    } else {
      plant(ctx, end, SEED_PLANTS[kind]!);
      // Plant.Seed.onThrow: the warden makes grass spring up around any seed she throws or plants.
      if (hero.subclass === 'warden') {
        const grown: number[] = [];
        for (const n of NEIGHBOURS8) {
          const t = ctx.level.map[end + n];
          if (t === T.EMPTY || t === T.EMPTY_DECO || t === T.EMBERS || t === T.GRASS) {
            furrowGrass(ctx.level, end + n);
            grown.push(end + n);
          }
        }
        if (grown.length > 0) ctx.effects.push({ type: 'bloomed', depth: ctx.depth, cells: grown });
      }
    }
    return;
  }
  if (itemDef(item.kind).category !== 'missile') {
    // Item.onThrow: anything else flies to the first thing in its way and falls there (a stack lets go of one);
    // over a chasm, it falls through.
    let flying = item;
    if (isStackable(item.kind) && item.qty > 1) {
      item.qty--;
      flying = { ...(JSON.parse(JSON.stringify(item)) as Item), qty: 1 };
    } else {
      hero.items.splice(index, 1);
    }
    const end = ballistica(ctx, hero.pos, target).at(-1)!;
    ctx.effects.push({ type: 'thrown', depth: ctx.depth, from: hero.pos, to: end, item: item.kind });
    landItem(ctx, end, flying);
    // CeremonialCandle.onThrow: the ritual may be complete.
    if (flying.kind === 'quest.candle') checkCandles(ctx);
    // ShatteredPot.onThrow: its bee goes where it lands.
    if (flying.kind === 'honeypot.shattered') potDropped(ctx, hero.id, end);
    return;
  }
}

/**
 * Level.drop's press(cell, null): an item landing on a trap sets it off, and on a plant sets it
 * off too (the old trick of clearing a trap with a thrown dart). Not on a chasm: it falls through.
 */
export function pressUnderItem(ctx: Ctx, pos: number): void {
  if (hasFlag(ctx.level.map[pos]!, F.PIT)) return;
  if (trapAt(ctx.level, pos)) triggerTrap(ctx, null, pos);
  stepOnPlant(ctx, null, pos);
}

/**
 * Bomb.onThrow (LIGHTTHROW): its fuse lit as it is thrown, the bomb lands and goes off a moment later (bombs.ts),
 * unless it falls down a chasm or someone picks it up.
 */
function throwBomb(ctx: Ctx, hero: Hero, index: number, target: number): void {
  const bomb = hero.items[index]!;
  const kind = bomb.kind;
  if (--bomb.qty <= 0) hero.items.splice(index, 1);
  const end = ballistica(ctx, hero.pos, target).at(-1)!;
  ctx.effects.push({ type: 'thrown', depth: ctx.depth, from: hero.pos, to: end, item: kind });
  const thrown = createItem(kind);
  if (!hasFlag(ctx.level.map[end]!, F.PIT)) lightFuse(ctx, thrown);
  landItem(ctx, end, thrown);
  pressUnderItem(ctx, end);
}

/** Bomb.explode where something else sets one off (the explosive curse): a plain bomb's blast at once (bombs.ts). */
export function explodeBomb(ctx: Ctx, end: number, _by: Hero | null): void {
  explode(ctx, 'bomb', end);
}

/**
 * Runestone.onThrow: a thrown stone works where it lands, and presses the cell if nobody is there; over a chasm
 * with nobody in the way it just falls. A stone of blink stops before whoever it would hit (StoneOfBlink.onThrow).
 */
function throwStone(ctx: Ctx, hero: Hero, index: number, target: number): void {
  const stone = hero.items[index]!;
  const kind = stone.kind;
  if (--stone.qty <= 0) hero.items.splice(index, 1);
  const trace = ballistica(ctx, hero.pos, target);
  let end = trace.at(-1)!;
  ctx.effects.push({ type: 'thrown', depth: ctx.depth, from: hero.pos, to: end, item: kind });
  if (kind === 'stone.blink' && charAt(ctx.world, ctx.depth, end) && trace.length > 1) end = trace[trace.length - 2]!;
  if (hasFlag(ctx.level.map[end]!, F.PIT) && !charAt(ctx.world, ctx.depth, end)) {
    landItem(ctx, end, createItem(kind));
    return;
  }
  hero.invisible = 0;
  activateStone(ctx, hero, kind, end);
  if (!charAt(ctx.world, ctx.depth, end)) pressUnderItem(ctx, end);
}

/**
 * Potion.onThrow: a thrown potion (or brew, or elixir) breaks where it lands, letting out whatever is in it; over a
 * chasm or into a well it falls whole. A cooked blandfruit with a thrown potion in it bursts the same way and leaves
 * its chunks (Blandfruit.onThrow); with any other, it just lands.
 */
function throwPotion(ctx: Ctx, hero: Hero, index: number, target: number): void {
  const item = hero.items[index]!;
  const kind = item.kind;
  const fruit = kind === 'food.blandfruit' ? item.potion : undefined;
  const thrownFruit = fruit ? { ...item, qty: 1 } : undefined;
  if (--item.qty <= 0) hero.items.splice(index, 1);
  const end = ballistica(ctx, hero.pos, target).at(-1)!;
  ctx.effects.push({ type: 'thrown', depth: ctx.depth, from: hero.pos, to: end, item: kind });
  if (hasFlag(ctx.level.map[end]!, F.PIT) || ctx.level.map[end] === T.WELL) {
    landItem(ctx, end, thrownFruit ?? createItem(kind));
    return;
  }
  if (fruit) {
    if (!['potion.liquidFlame', 'potion.toxicGas', 'potion.paralyticGas', 'potion.frost', 'potion.levitation', 'potion.purity'].includes(fruit)) {
      landItem(ctx, end, thrownFruit!);
      return;
    }
    shatterPotion(ctx, hero, fruit, end);
    landItem(ctx, end, createItem('food.chunks'));
    return;
  }
  // Level.pressCell: the potion sets off what it lands on (not an aqua brew or storm clouds, which disarm traps).
  if (kind !== 'brew.aqua' && kind !== 'potion.stormClouds') pressUnderItem(ctx, end);
  const shows = shatterPotion(ctx, hero, kind, end);
  // Potion.onThrow: Talent.onPotionUsed, for a harmful potion, one that may be thrown, or a brew.
  if (MUST_THROW.has(kind) || CAN_THROW.has(kind) || itemDef(kind).category === 'brew') {
    const thrownTalent = talentUse(kind);
    if (ctx.rng.float() < thrownTalent.chance) onPotionUsed(ctx, hero, end, thrownTalent.factor);
  }
  ctx.effects.push({
    type: 'shattered', hero: hero.id, depth: ctx.depth, pos: end, kind, identified: shows && itemDef(kind).category === 'potion' ? learn(ctx.world, kind) : false,
  });
}

/**
 * Dart.AC_TIP: darts tipped with a seed into tipped darts: two for one seed (one, if only one dart is left), or as
 * many as there are seeds for, two to a seed.
 */
function tipDarts(ctx: Ctx, hero: Hero, index: number, seedIndex: number, all: boolean): void {
  const darts = hero.items[index]!;
  const seed = hero.items[seedIndex]!;
  const kind = TIPPED_DARTS[seed.kind]!;
  const maxToTip = Math.min(darts.qty, seed.qty * 2);
  const tipping = all && darts.qty > 2 && maxToTip > 2 ? maxToTip : Math.min(darts.qty, 2);
  const seeds = Math.trunc((tipping + 1) / 2);
  seed.qty -= seeds;
  darts.qty -= tipping;
  hero.items = hero.items.filter((item) => item.qty > 0 || (item !== seed && item !== darts));
  const tipped = createItem(kind, tipping);
  if (!collect(hero, tipped)) dropItem(ctx.floor, hero.pos, tipped);
  ctx.effects.push({ type: 'tipped', hero: hero.id, kind, qty: tipping });
}

/** Adds an item to the backpack, stacking where possible; false if there is no room. */
export function collect(hero: Hero, item: Item): boolean {
  if (item.kind === 'gold') {
    hero.gold += item.qty;
    statsOf(hero).gold += item.qty;
    return true;
  }
  if (isStackable(item.kind)) {
    const stack = hero.items.find((other) => stacksWith(other, item));
    if (stack) {
      // MissileWeapon.merge: a thrown weapon back on its stack.
      if (itemDef(item.kind).category === 'missile') mergeMissiles(stack, item);
      else stack.qty += item.qty;
      return true;
    }
  }
  if (!hasRoom(hero, item)) return false;
  hero.items.push(item);
  return true;
}

/** Opens a chest or remains if need be, and takes everything there is room for. */
/** Heap.open: a chest unlocked (with the golden key, if it wants one), a tomb or remains disturbed; false if a mimic sprang instead. */
function openHeap(ctx: Ctx, hero: Hero, heap: Heap): boolean {
  if (MIMIC_OF[heap.kind] && springMimic(ctx, hero, heap)) return false;
  // A locked chest takes the golden key, a crystal chest the crystal one (Notes.remove).
  if (heap.kind === 'lockedChest' || heap.kind === 'crystalChest') hero.items.splice(chestKeyFor(ctx.world, hero, heap), 1);
  if (heap.kind !== 'heap') {
    ctx.effects.push({ type: 'opened', depth: ctx.depth, pos: heap.pos, heap: heap.kind });
    disturb(ctx, hero, heap);
    heap.kind = 'heap';
    // Heap.open: rings of wealth find something more in it.
    heap.items.unshift(...wealthBonusDrops(ctx, hero, 1));
  }
  return true;
}

function pickUp(ctx: Ctx, hero: Hero): void {
  const heap = ctx.floor.heaps.find((h) => h.pos === hero.pos)!;
  if (!openHeap(ctx, hero, heap)) return;
  const left: Item[] = [];
  for (const item of heap.items) {
    // Noisemaker.doPickUp: a noisemaker that has gone off cannot be picked up.
    if (item.triggered !== undefined) {
      left.push(item);
      continue;
    }
    // Bomb.doPickUp: picking it up snuffs its fuse.
    if (item.fuse !== undefined) {
      snuff(item);
      ctx.effects.push({ type: 'snuffed', hero: hero.id });
    }
    if (item.kind === 'dew') {
      // Dewdrop.doPickUp: an unhurt hero with a full waterskin leaves it lying.
      if (!pickUpDew(ctx, hero, heap.pos, item.qty)) left.push(item);
    } else if (item.kind === 'energy') {
      // EnergyCrystal.doPickUp: it is alchemical energy, not something in the pack.
      ctx.world.energy = (ctx.world.energy ?? 0) + item.qty;
      ctx.effects.push({ type: 'pickedUp', hero: hero.id, item });
    } else if (outdatedCopy(hero, item)) {
      // MissileWeapon.doPickUp: a copy of a set upgraded since crumbles to dust.
      ctx.effects.push({ type: 'dust', hero: hero.id, item });
    } else if (item.kind === 'petal' || item.kind === 'sandbag') {
      // DriedRose.Petal and sandBag.doPickUp: into the artifact, or left where they lie.
      if (artifactPiece(ctx, hero, item)) ctx.effects.push({ type: 'pickedUp', hero: hero.id, item });
      else left.push(item);
    } else if (collect(hero, item)) {
      ctx.effects.push({ type: 'pickedUp', hero: hero.id, item });
      // CorpseDust.doPickUp: its curse takes hold.
      if (item.kind === 'quest.dust') dustPickedUp(ctx, hero);
      onItemCollected(ctx, hero, item);
      // ShatteredPot.doPickUp: its bee is after whoever holds it now.
      if (item.kind === 'honeypot.shattered') potPickedUp(ctx, hero.id, heap.pos);
      if (item.kind === 'quest.amulet') {
        // Amulet.doPickUp: the journey's goal. Its bearer may end the run here («Let's call it a day»)
        // or carry it on, up to the surface; the question comes once, as AmuletScene with its text.
        ctx.effects.push({ type: 'amulet', hero: hero.id, first: !ctx.world.amuletTaken });
        ctx.world.amuletTaken = true;
      }
    } else {
      left.push(item);
    }
  }
  if (left.some((item) => item.kind !== 'dew' && item.kind !== 'petal' && item.kind !== 'sandbag')) ctx.effects.push({ type: 'packFull', hero: hero.id });
  heap.items = left;
  if (left.length === 0) ctx.floor.heaps.splice(ctx.floor.heaps.indexOf(heap), 1);
}

/**
 * Heap.open on remains: a tomb's sinners rise as wraiths all around; a
 * skeleton with something cursed among its belongings would too, but with
 * the hero standing on it the curse falls on them instead, for half their health.
 */
function disturb(ctx: Ctx, hero: Hero, heap: Heap): void {
  if (heap.kind === 'tomb') {
    const risen = NEIGHBOURS4.filter((n) => spawnWraith(ctx, hero.pos + n)).length;
    if (risen > 0) ctx.effects.push({ type: 'wraiths', depth: ctx.depth, pos: heap.pos });
  }
  if (heap.kind === 'skeleton' && heap.items.some((item) => item.cursed) && !spawnWraith(ctx, heap.pos, true)) {
    const damage = Math.trunc(hero.hp / 2);
    ctx.effects.push({ type: 'wraiths', depth: ctx.depth, pos: heap.pos });
    ctx.effects.push({ type: 'hurt', depth: ctx.depth, who: hero.id, damage });
    hurt(ctx, hero, damage, 'bones');
  }
}

/**
 * Wraith.spawnAt: a wraith rises on a free cell (one in a hundred a tormented spirit), already after the hero, and
 * acts a little later; a tomb's rise only where they are let out (Wraith.spawnAround), a skeleton's beside it too.
 */
export function spawnWraith(ctx: Ctx, pos: number, allowAdjacent = false): boolean {
  return spawnShatteredWraith(ctx, pos, undefined, undefined, allowAdjacent) !== null;
}

/**
 * Honeypot.shatter: out flies a golden bee, where the pot broke or, if someone stands there, on a free cell beside;
 * it guards the pot's pieces (or goes after whoever holds them). False if there was no room for it.
 */
function shatterHoneypot(ctx: Ctx, pos: number, holder: string | null): boolean {
  return spawnBee(ctx, pos, holder) !== null;
}

/** Wraith.SPAWN_DELAY. */
const WRAITH_SPAWN_DELAY = 2;

/** What mystery meat can do to whoever eats it, and what frozen carpaccio can. */
export type MeatOutcome = 'hot' | 'legs' | 'unwell' | 'stuffed' | 'invisible' | 'barkskin' | 'refreshed' | 'better';

/**
 * Food.execute: the food's energy takes hunger away (Food.satisfy; Pixel Dungeon's warrior healed and
 * mage recharged as they ate, which Shattered leaves to the talents). Mystery meat (MysteryMeat) has a
 * four in five chance of disagreeing with the eater.
 */
function eat(ctx: Ctx, hero: Hero, index: number, time: number): void {
  const item = hero.items[index]!;
  const kind = item.kind;
  const fruit = item.potion;
  if (--item.qty <= 0) hero.items.splice(index, 1);
  // Food.satisfy: a cursed horn worn takes its share.
  affectHunger(ctx, hero, foodValue(ctx, hero, itemDef(kind).energy!));
  // MeatPie.satisfy: well fed for a long while after (WellFed.reset: Hunger.STARVING turns, a third under the challenge).
  if (kind === 'food.meatPie') buffsOf(hero).wellFed = isChallenged(ctx.world, NO_FOOD) ? Math.trunc(STARVING / 3) : STARVING;
  statsOf(hero).food++;
  let outcome: MeatOutcome | null = null;
  if (kind === 'food.meat') {
    outcome = (['hot', 'legs', 'unwell', 'stuffed', null] as const)[ctx.rng.int(5)]!;
    if (outcome === 'hot') hero.burning = Math.max(hero.burning, MEAT_BURNING_TURNS);
    if (outcome === 'legs') hero.rooted = Math.max(hero.rooted, ROOTED_TURNS);
    if (outcome === 'unwell') hero.poison = Math.max(hero.poison, Math.trunc(hero.ht / 5));
    if (outcome === 'stuffed') hero.slowed = Math.max(hero.slowed, SLOWED_TURNS);
  }
  if (kind === 'food.carpaccio') {
    // FrozenCarpaccio.execute: four times in five, something good besides.
    outcome = (['invisible', 'barkskin', 'refreshed', 'better', null] as const)[ctx.rng.int(5)]!;
    if (outcome === 'invisible') hero.invisible = Math.max(hero.invisible, INVISIBILITY_DURATION);
    if (outcome === 'barkskin') hero.barkskin = Math.max(hero.barkskin, Math.trunc(hero.ht / 4));
    if (outcome === 'refreshed') Object.assign(hero, { poison: 0, crippled: 0, weakened: 0, bleeding: 0 });
    if (outcome === 'better' && hero.hp < hero.ht) {
      const amount = Math.min(Math.trunc(hero.ht / 4), hero.ht - hero.hp);
      hero.hp += amount;
      ctx.effects.push({ type: 'healed', hero: hero.id, amount });
    }
  }
  // SupplyRation.satisfy: five health, and a charge for the cloak; Berry.satisfy: every second berry grows a seed.
  if (kind === 'food.supply') {
    const amount = Math.min(5, hero.ht - hero.hp);
    hero.hp += amount;
    ctx.effects.push({ type: 'healed', hero: hero.id, amount: 5 });
    const cloak = [...heroArtifacts(hero), ...hero.items].find((it) => it.kind === 'artifact.cloak');
    if (cloak) directChargeCloak(cloak, 1);
  }
  if (kind === 'food.berry') {
    const b = tbOf(hero);
    b.berrySeeds = (b.berrySeeds ?? 0) + 1;
    if (b.berrySeeds >= 2) {
      delete b.berrySeeds;
      dropItem(ctx.floor, hero.pos, new ItemGenerator(ctx.rng, ctx.depth).of('seed'));
    }
  }
  ctx.effects.push({ type: 'ate', hero: hero.id, kind, outcome });
  ctx.effects.push({ type: 'spell', hero: hero.id, sprite: 'food' });
  // Food.execute: Talent.onFoodEaten (the hero is busy for `time` yet: iron stomach lasts as long).
  onFoodEaten(ctx, hero, itemDef(kind).energy!, item, time);
  // Blandfruit.execute: a cooked blandfruit works as the potion it was cooked into, unknown.
  if (fruit) drinkPotion(ctx, hero, fruit);
}

/** Burning.DURATION, Paralysis.DURATION (roots last as long) and Slow.DURATION. */
const MEAT_BURNING_TURNS = 8;
const ROOTED_TURNS = 10;
const SLOWED_TURNS = 10;

/** The mimic a heap is, if it is one (Mimic, GoldenMimic, CrystalMimic). */
export const MIMIC_OF: Partial<Record<HeapKind, MobKind>> = { mimic: 'mimic', goldenMimic: 'goldenMimic', crystalMimic: 'crystalMimic' };

/**
 * Mimic.interact: the "chest" was a mimic. The hero is pushed aside (if they stood on it) and the mimic, holding
 * the treasure and a prize of its own (Mimic.generatePrize), springs at them with its ambush. False if there is
 * no room to move.
 */
function springMimic(ctx: Ctx, hero: Hero, heap: Heap): boolean {
  const { world, depth, level, rng, floor } = ctx;
  const cells = NEIGHBOURS8.map((n) => hero.pos + n).filter((c) => canEnter(level, c) && !charAt(world, depth, c));
  if (cells.length === 0 && hero.pos === heap.pos) {
    heap.kind = 'chest';
    return false;
  }
  const pos = heap.pos;
  // Standing on it, the hero is thrown off; opened from beside it, they stay where they are.
  if (hero.pos === pos) {
    const to = rng.element(cells)!;
    hero.pos = to;
    leaveCell(world, level, depth, pos);
    enterCell(level, to);
  }
  floor.heaps.splice(floor.heaps.indexOf(heap), 1);
  const kind = MIMIC_OF[heap.kind] ?? 'mimic';
  const mimic = scaleMob(world, createMob(`#${++world.nextId}`, kind, pos, 'hunting', floor.now + 1));
  mimic.level = depth;
  mimic.ht = mimic.hp = mobStats(mimic).ht;
  mimic.loot = mimicPrize(rng, depth, kind, heap.items);
  floor.mobs.push(mimic);
  enterCell(level, pos);
  ctx.effects.push({ type: 'mimic', depth, mob: mimic.id, hero: hero.id });
  ambush(ctx, mimic, hero);
  return true;
}

/**
 * InventoryScroll: the item a scroll of upgrade, enchantment or identify was
 * read on, found before the scroll leaves the pack (which moves the slots
 * after it). A choice the scroll cannot act on counts as none: that only
 * happens with a scroll the party did not know (see scrollTargetProblem).
 */
function scrollTarget(world: World, hero: Hero, kind: ItemKind, action: { on?: ItemRef; target?: 'weapon' | 'armor' }): Item | undefined {
  if (!isTargetedScroll(kind)) return undefined;
  const ref = action.on ?? action.target;
  const chosen = ref === undefined ? undefined : itemAt(hero, ref);
  return chosen && canTarget(world, kind, chosen) ? chosen : defaultTarget(world, hero, kind);
}

/**
 * Why a known scroll cannot be read on what was chosen, or on anything at
 * all; checked before the scroll is used up. An unknown scroll is read
 * whatever was chosen (the reader could not know what it would want).
 */
function scrollTargetProblem(world: World, hero: Hero, kind: TargetedScroll, action: { on?: ItemRef; target?: 'weapon' | 'armor' }): string | null {
  if (!knownIn(world.known, kind)) return null;
  const ref = action.on ?? action.target;
  if (ref === undefined) {
    // Identify with nothing to learn is simply read in vain, as an unknown one would be.
    return kind === 'scroll.identify' || defaultTarget(world, hero, kind) ? null : TARGET_PROBLEMS[kind];
  }
  const chosen = itemAt(hero, ref);
  if (!chosen) return 'no such item';
  return canTarget(world, kind, chosen) ? null : TARGET_PROBLEMS[kind];
}

/**
 * Using an item from the pack (Potion.drink, Scroll.doRead, InventoryStone, Spell.onCast, the trinket catalyst's
 * choice, arcane resin): the item chosen to act on, found before the used one leaves the pack (which moves the slots
 * after it). Returns how long it took.
 */
function use(ctx: Ctx, hero: Hero, action: Extract<InventoryAction, { type: 'use' }>): number {
  const { world } = ctx;
  const item = hero.items[action.item]!;
  const kind = item.kind;
  const category = itemDef(kind).category;
  const on = action.on !== undefined ? itemAt(hero, action.on) : undefined;
  const takeOne = (): void => {
    if (--item.qty <= 0) hero.items.splice(hero.items.indexOf(item), 1);
  };
  if (category === 'catalyst') {
    chooseTrinket(ctx, hero, action.item, action.choice!);
    return TIME_TO_USE;
  }
  if (kind === 'resin') {
    // ArcaneResin: a level more for the wand (resinBonus), and a charge; as much resin as its level was, and one.
    const wand = on!;
    const needed = wand.level + 1;
    item.qty -= needed;
    if (item.qty <= 0) hero.items.splice(hero.items.indexOf(item), 1);
    wand.resin = (wand.resin ?? 0) + 1;
    wand.level++;
    wand.charges = Math.min((wand.charges ?? 0) + 1, maxCharges(wand, null));
    ctx.effects.push({ type: 'upgraded', hero: hero.id, item: wand });
    return TIME_TO_USE;
  }
  if (kind === 'liquidMetal') {
    applyLiquidMetal(ctx, hero, item, on!);
    return TIME_TO_USE;
  }
  if (INVENTORY_STONES.has(kind)) {
    if (useStone(ctx, hero, kind, on!, action.choice)) takeOne();
    hero.invisible = 0;
    return TIME_TO_USE;
  }
  if (category === 'spell') {
    const { time, used } = castSpell(ctx, hero, kind, { on, cell: action.cell, choice: action.choice });
    if (used) {
      takeOne();
      // Spell.onCast: Talent.onScrollUsed, in proportion to how many one brew makes.
      const spellTalent = talentUse(kind);
      if (ctx.rng.float() < spellTalent.chance) onScrollUsed(ctx, hero, spellTalent.factor);
    }
    return time;
  }
  if (category === 'scroll') {
    const target = scrollTarget(world, hero, kind, action);
    takeOne();
    ctx.effects.push({ type: 'used', hero: hero.id, kind, identified: learn(world, kind) });
    // Scroll.readAnimation: Talent.onScrollUsed.
    readScroll(ctx, hero, kind, target, { cell: action.cell, choice: action.choice });
    const scrollTalent = talentUse(kind);
    if (isAlive(hero) && ctx.rng.float() < scrollTalent.chance) onScrollUsed(ctx, hero, scrollTalent.factor);
    return TIME_TO_USE;
  }
  // A potion, a brew or an elixir, drunk (Potion.drink).
  takeOne();
  const identified = category === 'potion' ? learn(world, kind) : false;
  ctx.effects.push({ type: 'used', hero: hero.id, kind, identified });
  drinkPotion(ctx, hero, kind, { on, cell: action.cell, choice: action.choice });
  // Potion.drink: Talent.onPotionUsed.
  const potionTalent = talentUse(kind);
  if (ctx.rng.float() < potionTalent.chance) onPotionUsed(ctx, hero, hero.pos, potionTalent.factor);
  return TIME_TO_USE;
}

/**
 * What a potion drunk or a scroll read does, once it has left the pack (Potion.apply, Scroll.doRead): the unstable
 * spellbook reads its scrolls through here (the item it acts on, if any, as the scroll would choose it).
 */
export function applyItem(ctx: Ctx, hero: Hero, kind: ItemKind, target: Item | undefined): void {
  if (itemDef(kind).category === 'scroll') readScroll(ctx, hero, kind, target);
  else drinkPotion(ctx, hero, kind);
}
