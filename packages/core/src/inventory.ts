import { mend, wear } from './wear';
import { chargesKnown, identify, isIdentified, learn, WAND_USAGES_TO_KNOW } from './ident';
import {
  BACKPACK_SIZE, beckon, createMob, isShopkeeper, statsOf, type Hero, heroRangedSkill, isAlive, maxExp, type Mob, mobStats, type SubClass,
  SUBCLASSES,
} from './actors';
import { affectHunger, growHT, STARVING } from './hero';
import { affixProblem, affixSeal, detachProblem, detachSeal, type SealSource } from './seal';
import { ballistica, randomRespawnCell } from './ai';
import { attack, charArmor, CRIPPLE_TURNS, earnExp, hurt } from './combat';
import { fearless, TERROR_TURNS } from './enchant';
import { conjureImages } from './allies';
import {
  canEnter, charAt, type Ctx, dropItem, enterCell, exploredCells, heroView, isHero, isPassable, isWater, landItem, leaveCell,
} from './floor';
import {
  buyPrice, createItem, type Heap, isStackable, type Item, itemDef, type ItemKind, itemPrice, knownIn, missileStats, stacksWith,
  wandMaxCharges,
} from './items';
import { discoverable } from './level/flags';
import { adjacent, distance, LENGTH, NEIGHBOURS4, NEIGHBOURS8, NEIGHBOURS9 } from './level/geometry';
import { discover, F, hasFlag, T } from './level/terrain';
import { type Burst, burst, immuneTo, trapAt, triggerTrap } from './traps';
import { plant, SEED_PLANTS, stepOnPlant } from './plants';
import { zapWand } from './wands';
import { mine, mineProblem, TIME_TO_MINE } from './smith';
import { transmute } from './transmute';
import { drinkFromWaterskin, pickUpDew, TIME_TO_DRINK, WATERSKIN_VOLUME } from './waterskin';
import { hasRoom } from './bags';
import { wipeOut } from './altar';
import { applyArmorKit, CLASS_ARMOR, CLASS_ARMOR_OF, classSpecial, specialProblem, TIME_TO_APPLY_KIT } from './classArmor';
import type { World } from './world';
import { scaleMob } from './party';
import { underChallenges } from './challenges';
import {
  canTarget, defaultTarget, isItemRef, isTargetedScroll, itemAt, type ItemRef, TARGET_PROBLEMS, type TargetedScroll,
} from './scrolls';
import { brew, brewProblem, chooseTrinket, energizeAt, energizeProblem } from './alchemy';
import { buffsOf, isMagicImmune } from './buffs';
import { drinkPotion, drinkProblem, shatterPotion } from './potions';
import { readProblem, readScroll, scrollUseProblem } from './reading';
import { activateStone, INVENTORY_STONES, stoneProblem, useStone } from './stones';
import { castSpell, spellProblem } from './spells';
import { lightFuse, snuff } from './bombs';
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
  | { type: 'equip'; item: number }
  | { type: 'drop'; item: number }
  /** Throw a dart, the boomerang or a potion at a cell; it flies until it hits someone or something. */
  | { type: 'throw'; item: number; target: number }
  /** Zap a wand at a cell. */
  | { type: 'zap'; item: number; target: number }
  /** Buy the shop's ware the hero stands on. */
  | { type: 'buy' }
  /** Sell an item from the pack to the shopkeeper next to the hero. */
  | { type: 'sell'; item: number }
  /** Take off a worn ring, back into the pack. */
  | { type: 'remove'; ring: number }
  /** Put the weapon in hand away (KindOfWeapon's UNEQUIP), into the pack or, with no room there, at the hero's feet. */
  | { type: 'unequip' }
  /** Read the Tome of Mastery and master one of the two ways of the hero's class. */
  | { type: 'master'; item: number; subclass: SubClass }
  /** Mine the vein of dark gold next to the hero with the blacksmith's pickaxe. */
  | { type: 'mine' }
  /** The special ability of the class armour worn: a cell for the warrior's leap and the rogue's smoke bomb. */
  | { type: 'special'; target?: number }
  /**
   * AlchemyScene: brew at an alchemy pot. `inputs` are pack slots, one item from each (a stack of thrown weapons or
   * of liquid metal whole; a slot twice for two of it); `recipe` which of the recipes they make (alchemy.ts).
   */
  | { type: 'alchemy'; inputs: number[]; recipe?: number }
  /** WndEnergizeItem: turn an item from the pack (or the whole stack) into alchemical energy, at a pot. */
  | { type: 'energize'; item: number; all?: boolean }
  /**
   * BrokenSeal.AC_AFFIX: the warrior's seal, from the pack or off the armour it is on (`from`: a pack slot,
   * or 'armor' for the one worn), onto an armour (`to`, the same way); and Armor.AC_DETACH, the seal off an armour.
   */
  | { type: 'affix'; from: SealSource; to: SealSource }
  | { type: 'detach'; armor: SealSource };

const INVENTORY_ACTIONS: ReadonlySet<string> = new Set([
  'pickup', 'open', 'use', 'equip', 'drop', 'throw', 'zap', 'buy', 'sell', 'remove', 'unequip', 'master', 'mine', 'special', 'alchemy',
  'energize', 'affix', 'detach',
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
const TIME_TO_ZAP = 1;
const TIME_TO_EAT = 3;
/** PhantomFish.TIME_TO_EAT. */
const TIME_TO_EAT_FISH = 2;
/** Weightstone.TIME_TO_APPLY. */
const TIME_TO_BALANCE = 2;
/** TomeOfMastery.TIME_TO_READ. */
const TIME_TO_READ_TOME = 10;
/** Light.DURATION. */
const LIGHT_TURNS = 250;

const MIND_VISION_DURATION = 20;
const INVISIBILITY_DURATION = 15;
/** Levitation.DURATION; GasesImmunity lasts 5 turns in the original, but here gas has no lingering cloud to outlast. */
const LEVITATION_DURATION = 20;
const GAS_IMMUNITY_DURATION = 15;

/** The backpack slot of a golden key for the hero's current depth, or -1. */
const goldenKeyFor = (hero: Hero): number =>
  hero.items.findIndex((item) => item.kind === 'key.golden' && item.depth === hero.depth);

function heapAt(world: World, hero: Hero): Heap | undefined {
  return world.floors[hero.depth]?.heaps.find((heap) => heap.pos === hero.pos);
}

export function inventoryProblem(world: World, hero: Hero, action: InventoryAction): string | null {
  if (action.type === 'pickup') {
    const heap = heapAt(world, hero);
    if (!heap) return 'nothing here';
    if ((heap.kind === 'lockedChest' || heap.kind === 'crystalChest') && goldenKeyFor(hero) < 0) return 'the chest is locked';
    if (heap.kind === 'hidden') return 'nothing here';
    return heap.kind === 'forSale' ? 'that is for sale' : null;
  }
  if (action.type === 'open') {
    const heap = Number.isInteger(action.cell) ? world.floors[hero.depth]?.heaps.find((h) => h.pos === action.cell) : undefined;
    if (!heap || heap.kind === 'heap' || heap.kind === 'forSale' || heap.kind === 'hidden') return 'nothing to open';
    if (heap.pos !== hero.pos && !adjacent(heap.pos, hero.pos)) return 'too far away';
    if ((heap.kind === 'lockedChest' || heap.kind === 'crystalChest') && goldenKeyFor(hero) < 0) return 'the chest is locked';
    return null;
  }
  if (action.type === 'mine') return mineProblem(world, hero);
  if (action.type === 'alchemy') return brewProblem(world, hero, action.inputs, action.recipe ?? 0);
  if (action.type === 'energize') return energizeProblem(world, hero, action.item);
  if (action.type === 'affix') return affixProblem(hero, action.from, action.to);
  if (action.type === 'detach') return detachProblem(hero, action.armor);
  if (action.type === 'special') return specialProblem(world, hero, action.target);
  if (action.type === 'unequip') {
    if (!hero.weapon) return 'nothing in hand';
    // EquipableItem.doUnequip: a cursed weapon will not leave the hand.
    return hero.weapon.cursed ? CURSED : null;
  }
  if (action.type === 'remove') {
    if (!Number.isInteger(action.ring) || !hero.rings[action.ring]) return 'no such ring';
    if (hero.rings[action.ring]!.cursed) return CURSED;
    return hasRoom(hero, hero.rings[action.ring]!) ? null : 'your pack is full';
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
      if (category !== 'weapon' && category !== 'armor' && category !== 'ring') return 'that cannot be equipped';
      // A cursed item, once worn, will not come off (EquipableItem.doUnequip).
      if (category === 'ring') return hero.rings.length >= 2 && hero.rings.every((ring) => ring.cursed) ? CURSED : null;
      // ClassArmor.doEquip: class armour is for its own class only.
      if (CLASS_ARMOR.includes(item.kind) && item.kind !== CLASS_ARMOR_OF[hero.heroClass]) return 'that armour is not made for you';
      return hero[category]?.cursed ? CURSED : null;
    }
    case 'drop':
      return null;
    case 'master':
      if (item.kind !== 'tome.mastery') return 'that is no tome';
      if (hero.subclass) return 'you have already mastered a way';
      return SUBCLASSES[hero.heroClass].includes(action.subclass) ? null : 'not a way for you';
    case 'sell':
      if (!shopkeeperBeside(world, hero)) return 'nobody to sell to';
      return itemPrice(item, knownIn(world.known, item.kind)) > 0 ? null : 'nobody would buy that';
    case 'throw':
    case 'zap': {
      // Item.AC_THROW: anything in the pack may be thrown (a bag would scatter what it holds: not that).
      const fits = action.type === 'throw' ? category !== 'bag' : category === 'wand';
      if (!fits) return `that cannot be ${action.type === 'throw' ? 'thrown' : 'zapped'}`;
      if (!Number.isInteger(action.target) || action.target < 0 || action.target >= LENGTH || action.target === hero.pos) {
        return 'bad target';
      }
      // Wand.actions: no zapping a wand known to be empty; one of unknown charges may be tried, and fizzle.
      return action.type === 'zap' && (item.charges ?? 0) <= 0 && chargesKnown(item) ? 'the wand is out of charges' : null;
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
  if (category === 'kit' && CLASS_ARMOR.includes(hero.armor.kind)) return 'your armour is already a class armour';
  if (category === 'vial' && !item.volume) return 'your waterskin is empty';
  if (category === 'wipeout' && (hero.blind ?? 0) > 0) return 'you cannot read while blinded';
  if (action.target !== undefined && action.target !== 'weapon' && action.target !== 'armor') return 'bad target';
  if (action.on !== undefined && !isItemRef(action.on)) return 'bad target';
  if (action.cell !== undefined && (!Number.isInteger(action.cell) || action.cell < 0 || action.cell >= LENGTH)) return 'bad target';
  if (action.choice !== undefined && (!Number.isInteger(action.choice) || action.choice < 0 || action.choice > 63)) return 'bad choice';
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
    if (item.kind === 'liquidMetal') return 'it needs no repair';
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
      mine(ctx, hero);
      return TIME_TO_MINE;
    // BrokenSeal.affixToArmor and Armor.AC_DETACH take no time.
    case 'affix':
      affixSeal(ctx, hero, action.from, action.to);
      return 0;
    case 'detach':
      detachSeal(ctx, hero, action.armor);
      return 0;
    case 'special':
      return classSpecial(ctx, hero, action.target);
    case 'alchemy':
      // AlchemyScene: brewing takes no time.
      brew(ctx, hero, action.inputs, action.recipe ?? 0);
      return 0;
    case 'energize':
      energizeAt(ctx, hero, action.item, action.all === true);
      return 0;
    case 'use':
      if (itemDef(hero.items[action.item]!.kind).category === 'food') {
        eat(ctx, hero, action.item);
        return TIME_TO_EAT;
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
      if (itemDef(hero.items[action.item]!.kind).category === 'honeypot') {
        // Honeypot.execute: shattered right where the hero stands; the shattered pot is left in hand.
        const pot = hero.items[action.item]!;
        if (--pot.qty <= 0) hero.items.splice(action.item, 1);
        shatterHoneypot(ctx, hero.pos);
        if (!collect(hero, createItem('honeypot.shattered'))) landItem(ctx, hero.pos, createItem('honeypot.shattered'));
        return TIME_TO_THROW;
      }
      if (itemDef(hero.items[action.item]!.kind).category === 'kit') {
        applyArmorKit(ctx, hero, action.item);
        return TIME_TO_APPLY_KIT;
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
      const ring = hero.rings.splice(action.ring, 1)[0]!;
      hero.items.push(ring);
      ctx.effects.push({ type: 'dropped', hero: hero.id, item: ring });
      return TIME_TO_EQUIP;
    }
    case 'equip': {
      const item = hero.items[action.item]!;
      if (itemDef(item.kind).category === 'ring') {
        // Two rings at most: a third takes the place of the first that is not cursed.
        hero.items.splice(action.item, 1);
        if (hero.rings.length >= 2) hero.items.push(hero.rings.splice(hero.rings.findIndex((ring) => !ring.cursed), 1)[0]!);
        hero.rings.push(item);
        ctx.effects.push({ type: 'equipped', hero: hero.id, item });
        // Ring.doEquip: put on, a ring's curse is known (it binds itself at once, if it is cursed).
        delete item.curseUnknown;
        if (item.cursed) ctx.effects.push({ type: 'cursedEquip', hero: hero.id, item });
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
      return TIME_TO_DROP;
    }
    case 'throw': {
      // Shuriken fly twice as fast as anything else (Shuriken.DLY).
      const thrown = hero.items[action.item]!;
      const delay = itemDef(thrown.kind).category === 'missile' ? missileStats(thrown).delay : 1;
      throwItem(ctx, hero, action.item, action.target);
      return TIME_TO_THROW * delay;
    }
    case 'zap':
      zap(ctx, hero, action.item, action.target);
      return TIME_TO_ZAP;
    case 'buy': {
      // WndTradeItem.buy: the gold goes, the ware comes into the pack.
      const heap = heapAt(ctx.world, hero)!;
      const item = heap.items.shift()!;
      const price = buyPrice(item, hero.depth, knownIn(ctx.world.known, item.kind), haggles(hero));
      hero.gold -= price;
      collect(hero, item);
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

/** Wearing a ring of haggler, shops ask half. */
const haggles = (hero: Hero): boolean => hero.rings.some((ring) => ring.kind === 'ring.haggler');

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
  if (itemDef(item.kind).category === 'honeypot') {
    // Honeypot.onThrow: it breaks where it lands, unless it falls down a chasm.
    if (--item.qty <= 0) hero.items.splice(index, 1);
    const end = ballistica(ctx, hero.pos, target).at(-1)!;
    ctx.effects.push({ type: 'thrown', depth: ctx.depth, from: hero.pos, to: end, item: 'honeypot' });
    if (hasFlag(ctx.level.map[end]!, F.PIT)) landItem(ctx, end, createItem('honeypot'));
    else {
      shatterHoneypot(ctx, end);
      // Honeypot.shatter: what is left of the pot lies there (ShatteredPot).
      landItem(ctx, end, createItem('honeypot.shattered'));
    }
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
    return;
  }
  const boomerang = item.kind === 'missile.boomerang';
  let thrown = item;
  if (!boomerang) {
    if (item.qty > 1) {
      item.qty--;
      thrown = { kind: item.kind, qty: 1, level: item.level };
    } else {
      hero.items.splice(index, 1);
    }
  }
  const trace = ballistica(ctx, hero.pos, target);
  const end = trace.at(-1)!;
  ctx.effects.push({ type: 'thrown', depth: ctx.depth, from: hero.pos, to: end, item: item.kind });
  const victim = charAt(ctx.world, ctx.depth, end);
  let hit = false;
  if (victim && !isHero(victim)) {
    const stats = missileStats(thrown);
    hit = attack(ctx, hero, victim, {
      attack: heroRangedSkill(hero, thrown, adjacent(hero.pos, end)),
      damage: [stats.min, stats.max],
      weapon: thrown,
    });

    if (hit && isAlive(victim)) missileProc(ctx, thrown, victim);
    // The boomerang wears with every hit, as a melee weapon does.
    if (hit && boomerang) wear(ctx, hero, item);
  }
  // IncendiaryDart.onThrow: missing, it sets whatever can burn where it lands alight, and burns up with it.
  if (!hit && thrown.kind === 'missile.incendiary' && hasFlag(ctx.level.map[end]!, F.FLAMABLE)) {
    burst(ctx, end, 'fire', 0);
    return;
  }
  if (!boomerang && !hit) {
    landItem(ctx, end, thrown);
    pressUnderItem(ctx, end);
  }
}

/**
 * Level.drop's press(cell, null): an item landing on a trap sets it off, and on a plant sets it
 * off too (the old trick of clearing a trap with a thrown dart). Not on a chasm: it falls through.
 */
function pressUnderItem(ctx: Ctx, pos: number): void {
  if (hasFlag(ctx.level.map[pos]!, F.PIT)) return;
  if (trapAt(ctx.level.map[pos]!)) triggerTrap(ctx, null, pos);
  stepOnPlant(ctx, null, pos);
}

/** MissileWeapon.proc: what each kind of thrown weapon does besides its damage. */
function missileProc(ctx: Ctx, thrown: Item, victim: Mob): void {
  switch (thrown.kind) {
    case 'missile.curare':
      // CurareDart: the poison paralyses for a moment.
      victim.paralysed = Math.max(victim.paralysed ?? 0, 3);
      break;
    case 'missile.incendiary':
      if (!isWater(ctx.level.map[victim.pos]!) && !immuneTo(victim, 'burning')) victim.burning = Math.max(victim.burning ?? 0, 8);
      break;
    case 'missile.javelin':
      // Javelin: a crippling wound.
      victim.crippled = Math.max(victim.crippled ?? 0, CRIPPLE_TURNS);
      break;
    case 'missile.tomahawk': {
      // Tamahawk: it bleeds as hard as it was struck.
      const blow = [...ctx.effects].reverse().find((e) => e.type === 'attack' && e.target === victim.id);
      const damage = blow?.type === 'attack' ? blow.damage : 0;
      if (damage > 0) victim.bleeding = Math.max(victim.bleeding ?? 0, damage);
      break;
    }
  }
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
  ctx.effects.push({
    type: 'shattered', hero: hero.id, depth: ctx.depth, pos: end, kind, identified: shows && itemDef(kind).category === 'potion' ? learn(ctx.world, kind) : false,
  });
}

/**
 * Wand.zapper: using a wand tells the party what it is, and a charge is spent;
 * with none left (which only a wand of unknown charges lets one try) it
 * fizzles, and its level is known.
 */
function zap(ctx: Ctx, hero: Hero, index: number, target: number): void {
  const wand = hero.items[index]!;
  if (learn(ctx.world, wand.kind)) ctx.effects.push({ type: 'identified', hero: hero.id, kind: wand.kind });
  if ((wand.charges ?? 0) <= 0) {
    delete wand.levelUnknown;
    ctx.effects.push({ type: 'fizzled', hero: hero.id, item: wand });
    return;
  }
  wand.charges = (wand.charges ?? 1) - 1;
  hero.invisible = 0;
  zapWand(ctx, hero, wand, target);
  // Wand.wandUsed: zapped often enough, a wand is known through and through.
  if (!isIdentified(ctx.world, wand) && (wand.familiarity = (wand.familiarity ?? 0) + 1) >= WAND_USAGES_TO_KNOW) {
    identify(ctx.world, wand);
    ctx.effects.push({ type: 'familiar', hero: hero.id, item: wand, learned: false });
  }
  // Wand.wandUsed: each zap wears the wand.
  wear(ctx, hero, wand);
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
      stack.qty += item.qty;
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
  if (heap.kind === 'mimic' && springMimic(ctx, hero, heap)) return false;
  // A locked or crystal chest: the golden key turns in its lock and stays there.
  if (heap.kind === 'lockedChest' || heap.kind === 'crystalChest') hero.items.splice(goldenKeyFor(hero), 1);
  if (heap.kind !== 'heap') {
    ctx.effects.push({ type: 'opened', depth: ctx.depth, pos: heap.pos, heap: heap.kind });
    disturb(ctx, hero, heap);
    heap.kind = 'heap';
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
    } else if (collect(hero, item)) {
      ctx.effects.push({ type: 'pickedUp', hero: hero.id, item });
      if (item.kind === 'seed.rotberry') rotberryRoar(ctx, hero);
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
  if (left.some((item) => item.kind !== 'dew')) ctx.effects.push({ type: 'packFull', hero: hero.id });
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
  if (heap.kind === 'skeleton' && heap.items.some((item) => item.cursed) && !spawnWraith(ctx, heap.pos)) {
    const damage = Math.trunc(hero.hp / 2);
    ctx.effects.push({ type: 'wraiths', depth: ctx.depth, pos: heap.pos });
    ctx.effects.push({ type: 'hurt', depth: ctx.depth, who: hero.id, damage });
    hurt(ctx, hero, damage, 'bones');
  }
}

/** Wraith.spawnAt: a wraith rises on a free open cell, already after the hero, and acts a little later. */
function spawnWraith(ctx: Ctx, pos: number): boolean {
  if (!isPassable(ctx.level, pos) || charAt(ctx.world, ctx.depth, pos)) return false;
  const wraith = createMob(`#${++ctx.world.nextId}`, 'wraith', pos, 'hunting', ctx.floor.now + WRAITH_SPAWN_DELAY);
  wraith.level = ctx.depth;
  wraith.enemySeen = true;
  ctx.floor.mobs.push(wraith);
  enterCell(ctx.level, pos);
  return true;
}

/**
 * Honeypot.shatter: out flies a golden bee, where the pot broke or, if
 * someone stands there, on a free cell beside.
 */
function shatterHoneypot(ctx: Ctx, pos: number): void {
  const { world, depth, level, rng, floor } = ctx;
  let at = pos;
  if (charAt(world, depth, pos)) {
    at = rng.element(NEIGHBOURS4.map((n) => pos + n).filter((c) => isPassable(level, c) && !charAt(world, depth, c))) ?? -1;
  }
  if (at === -1) return;
  const bee = createMob(`#${++world.nextId}`, 'bee', at, 'passive', floor.now + 1);
  bee.level = depth;
  bee.ht = bee.hp = mobStats(bee).ht;
  // Alert from the start: no monster catches it off guard.
  bee.enemySeen = true;
  floor.mobs.push(bee);
  enterCell(level, at);
  ctx.effects.push({ type: 'bee', depth, pos: at, from: pos });
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
function eat(ctx: Ctx, hero: Hero, index: number): void {
  const item = hero.items[index]!;
  const kind = item.kind;
  const fruit = item.potion;
  if (--item.qty <= 0) hero.items.splice(index, 1);
  affectHunger(ctx, hero, itemDef(kind).energy!);
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
  ctx.effects.push({ type: 'ate', hero: hero.id, kind, outcome });
  // Blandfruit.execute: a cooked blandfruit works as the potion it was cooked into, unknown.
  if (fruit) drinkPotion(ctx, hero, fruit);
}

/** Burning.DURATION, Paralysis.DURATION (roots last as long) and Slow.DURATION. */
const MEAT_BURNING_TURNS = 8;
const ROOTED_TURNS = 10;
const SLOWED_TURNS = 10;

/**
 * Mimic.spawnAt: the "chest" was a mimic. The hero is pushed aside and the
 * mimic, holding the treasure, attacks. False if there is no room to move.
 */
function springMimic(ctx: Ctx, hero: Hero, heap: Heap): boolean {
  const { world, depth, level, rng, floor } = ctx;
  const cells = NEIGHBOURS8.map((n) => hero.pos + n).filter((c) => canEnter(level, c) && !charAt(world, depth, c));
  if (cells.length === 0) {
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
  const mimic = scaleMob(world, createMob(`#${++world.nextId}`, 'mimic', pos, 'hunting', floor.now + 1));
  mimic.level = depth;
  mimic.ht = mimic.hp = mobStats(mimic).ht;
  Object.assign(mimic, { enemy: hero.id, target: hero.pos, enemySeen: true, loot: heap.items });
  floor.mobs.push(mimic);
  enterCell(level, pos);
  ctx.effects.push({ type: 'mimic', depth, mob: mimic.id, hero: hero.id });
  return true;
}

/** Rotberry.Seed.collect: picked, the seed lets out a roar that brings the whole level running. */
function rotberryRoar(ctx: Ctx, hero: Hero): void {
  const roused = ctx.floor.mobs.filter((mob) => mob.state !== 'passive');
  for (const mob of roused) beckon(mob, hero.pos);
  ctx.effects.push({ type: 'scroll', hero: hero.id, kind: 'challenge', count: roused.length });
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
    wand.charges = Math.min((wand.charges ?? 0) + 1, wandMaxCharges(wand));
    ctx.effects.push({ type: 'upgraded', hero: hero.id, item: wand });
    return TIME_TO_USE;
  }
  if (INVENTORY_STONES.has(kind)) {
    if (useStone(ctx, hero, kind, on!, action.choice)) takeOne();
    hero.invisible = 0;
    return TIME_TO_USE;
  }
  if (category === 'spell') {
    const { time, used } = castSpell(ctx, hero, kind, { on, cell: action.cell, choice: action.choice });
    if (used) takeOne();
    return time;
  }
  if (category === 'scroll') {
    const target = scrollTarget(world, hero, kind, action);
    takeOne();
    ctx.effects.push({ type: 'used', hero: hero.id, kind, identified: learn(world, kind) });
    readScroll(ctx, hero, kind, target, { cell: action.cell, choice: action.choice });
    return TIME_TO_USE;
  }
  // A potion, a brew or an elixir, drunk (Potion.drink).
  takeOne();
  const identified = category === 'potion' ? learn(world, kind) : false;
  ctx.effects.push({ type: 'used', hero: hero.id, kind, identified });
  drinkPotion(ctx, hero, kind, { on, cell: action.cell, choice: action.choice });
  return TIME_TO_USE;
}
