import { type Hero, isAlive } from './actors';
import { AGGRESSION_TURNS, buffsOf, deepSleep, isBoss, isMiniboss, TERROR_TURNS } from './buffs';
import { explode, stoneFlock } from './bombs';
import { charAt, type Ctx, exploredCells, isHero } from './floor';
import { circleCells } from './fov';
import { identify } from './ident';
import { type Augment, EXOTIC_OF, type Item, itemDef, type ItemKind, ITEMS, randomEnchantment, randomGlyph, REGULAR_OF, wandMaxCharges } from './items';
import { discover, F, hasFlag } from './level/terrain';
import { reachable } from './gas';
import { teleportToLocation } from './reading';
import { learn } from './ident';
import type { World } from './world';
import { mend } from './wear';
import { fearless } from './enchant';

/*
 * Runestones (items/stones): most are thrown and do something where they land (Runestone.activate); four are used
 * on an item of the hero's choosing (InventoryStone: augmentation, enchantment, detect magic, intuition).
 */

export const INVENTORY_STONES: ReadonlySet<ItemKind> = new Set<ItemKind>(['stone.augmentation', 'stone.enchantment', 'stone.detectMagic', 'stone.intuition']);

/** StoneOfAugmentation.WndAugment: the ways a weapon or armour can be augmented, «none» first. */
export const WEAPON_AUGMENTS: readonly (Augment | null)[] = [null, 'speed', 'damage'];
export const ARMOR_AUGMENTS: readonly (Augment | null)[] = [null, 'evasion', 'defense'];
export const augmentsFor = (item: Item): readonly (Augment | null)[] =>
  itemDef(item.kind).category === 'armor' ? ARMOR_AUGMENTS : WEAPON_AUGMENTS;

/**
 * StoneOfIntuition.WndGuess: the kinds an item could be, as the party does not know them yet (an exotic among the
 * exotics of the unknown kinds), in the order they are offered.
 */
export function intuitionChoices(world: World, item: Item): ItemKind[] {
  const category = itemDef(item.kind).category;
  const exotic = REGULAR_OF[item.kind] !== undefined;
  return (Object.keys(ITEMS) as ItemKind[])
    .filter((k) => itemDef(k).category === category && itemDef(k).sprite === undefined && !REGULAR_OF[k] && !world.known.includes(k))
    .map((k) => (exotic ? EXOTIC_OF[k] ?? k : k));
}

/** Why a known inventory stone cannot be used on that item that way. */
export function stoneProblem(world: World, kind: ItemKind, item: Item, choice: number | undefined): string | null {
  if (kind === 'stone.augmentation') {
    const options = augmentsFor(item);
    if (choice === undefined || !Number.isInteger(choice) || choice < 0 || choice >= options.length) return 'choose how to augment it';
    return options[choice] === (item.augment ?? null) ? 'it is augmented that way already' : null;
  }
  if (kind === 'stone.intuition') {
    const options = intuitionChoices(world, item);
    return choice !== undefined && Number.isInteger(choice) && choice >= 0 && choice < options.length ? null : 'choose a guess';
  }
  return null;
}

/**
 * InventoryStone.onItemSelected: the stone used on the chosen item. True if the stone is used up (a stone of
 * intuition is not, the first time).
 */
export function useStone(ctx: Ctx, hero: Hero, kind: ItemKind, item: Item, choice: number | undefined): boolean {
  switch (kind) {
    case 'stone.augmentation': {
      // StoneOfAugmentation.apply.
      const augment = augmentsFor(item)[choice!] ?? null;
      if (augment) item.augment = augment;
      else delete item.augment;
      ctx.effects.push({ type: 'augmented', hero: hero.id, item });
      return true;
    }
    case 'stone.enchantment':
      // StoneOfEnchantment: a random enchantment, or glyph, never the one it had (Weapon.enchant, Armor.inscribe).
      if (itemDef(item.kind).category === 'armor') item.glyph = randomGlyph(ctx.rng, item.glyph);
      else item.enchant = randomEnchantment(ctx.rng, item.enchant);
      mend(item);
      ctx.effects.push({ type: 'imbued', hero: hero.id, item });
      return true;
    case 'stone.detectMagic': {
      // StoneOfDetectMagic: the curse is known, and whether there is good magic (a level, an enchantment) or bad.
      delete item.curseUnknown;
      const bad = !!item.cursed;
      const good = item.level > 0 || (!bad && (!!item.enchant || !!item.glyph));
      ctx.effects.push({ type: 'detected', hero: hero.id, item, result: good && bad ? 'both' : good ? 'good' : bad ? 'bad' : 'none' });
      return true;
    }
    case 'stone.intuition': {
      // StoneOfIntuition: a right guess makes the kind known; the stone lasts two guesses.
      const guess = intuitionChoices(ctx.world, item)[choice!];
      const right = guess === item.kind;
      if (right) {
        if (itemDef(item.kind).category === 'ring') learn(ctx.world, item.kind);
        else identify(ctx.world, item);
      }
      ctx.effects.push({ type: 'guessed', hero: hero.id, kind: guess!, right });
      const b = buffsOf(hero);
      if (!b.intuitionUsed) {
        b.intuitionUsed = true;
        return false;
      }
      delete b.intuitionUsed;
      return true;
    }
    default:
      return true;
  }
}

/**
 * Runestone.activate: a thrown stone works where it lands. `cell` is where it came down (for a stone of blink, the
 * cell before whoever it hit).
 */
export function activateStone(ctx: Ctx, hero: Hero, kind: ItemKind, cell: number): void {
  const { world, depth } = ctx;
  const there = charAt(world, depth, cell);
  ctx.effects.push({ type: 'stone', depth, pos: cell, kind });
  switch (kind) {
    case 'stone.aggression':
      // StoneOfAggression: whoever it strikes draws every monster's anger (bosses aside).
      if (there && isAlive(there) && (isHero(there) || (!isBoss(there) && !isMiniboss(there)))) buffsOf(there).aggression = AGGRESSION_TURNS;
      return;
    case 'stone.blast':
      // Bomb.ConjuredBomb.
      explode(ctx, 'bomb', cell);
      return;
    case 'stone.blink':
      teleportToLocation(ctx, hero, cell);
      return;
    case 'stone.clairvoyance': {
      // StoneOfClairvoyance: everything within twenty cells is mapped, and what is hidden there found.
      const explored = exploredCells(world, depth);
      for (const c of circleCells(cell, 20)) {
        explored[c] = true;
        if (hasFlag(ctx.level.map[c]!, F.SECRET)) {
          ctx.level.map[c] = discover(ctx.level.map[c]!);
          ctx.effects.push({ type: 'discovered', depth, cell: c });
        }
      }
      return;
    }
    case 'stone.deepSleep':
      if (there && !isHero(there)) deepSleep(there);
      return;
    case 'stone.fear':
      if (there && !isHero(there) && !there.ally && isAlive(there) && !fearless(there)) {
        there.terror = TERROR_TURNS;
        there.terrorOf = hero.id;
      }
      return;
    case 'stone.flock':
      stoneFlock(ctx, cell);
      return;
    case 'stone.shock': {
      // StoneOfShock: everyone within two steps is stunned a moment, and every one of them charges the thrower's wands.
      let hits = 0;
      for (const c of reachable(ctx, cell, 2)) {
        const char = charAt(world, depth, c);
        if (!char || !isAlive(char)) continue;
        char.paralysed = Math.max(char.paralysed ?? 0, 1);
        hits++;
      }
      if (hits > 0) {
        // Belongings.charge(1 + hits): a charge for each, into every wand.
        for (const wand of hero.items) if (wand.charges !== undefined) wand.charges = Math.min(wandMaxCharges(wand), wand.charges + 1 + hits);
      }
      ctx.effects.push({ type: 'shock', depth, pos: cell, count: hits });
      return;
    }
    default:
      return;
  }
}

