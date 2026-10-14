import { isCurseEnchant, isCurseGlyph, randomArmorCurse, randomWeaponCurse } from './items';
import { TIPPED_DARTS } from './missiles';
import { heroEquipped } from './actors';
import { heldWands, gainCharge } from './wands';
import { createMob, type Hero } from './actors';
import { randomDestinationFor } from './ai';
import { buffsOf, isBoss, isMagicImmune, isMiniboss, PARALYSIS_TURNS } from './buffs';
import { charAt, type Ctx, enterCell, heroView, isHero, isPassable } from './floor';
import { energize } from './alchemy';
import {
  createItem, drawUsingDefaults, EXOTIC_OF, type Item, itemDef, ItemGenerator, type ItemKind, itemPrice, knownIn, REGULAR_OF, stacksWith,
  wandMaxCharges,
} from './items';
import { NEIGHBOURS8 } from './level/geometry';
import { F, hasFlag, T } from './level/terrain';
import { castRay, PROJECTILE } from './ray';
import { interfloorAllowed, readScroll, teleportChar, teleportToLocation } from './reading';
import { disarmTrap, springTrapKind, trapAt } from './traps';
import { upgradeItem, defaultTarget, isTargetedScroll } from './scrolls';
import { moveToDepth } from './world';
import type { World } from './world';
import { isIdentified } from './ident';
import { collect } from './inventory';
import { hasRoom } from './bags';

/*
 * Spells (items/spells), made only by alchemy: cast on an item (InventorySpell), at a cell (TargetedSpell), or
 * simply cast. What each needs comes with the action: `on` an item, `cell` a target, `choice` an option.
 */

export interface SpellUse {
  on?: Item;
  cell?: number;
  choice?: number;
}

/** What is cast at a cell. */
export const TARGETED_SPELLS: ReadonlySet<ItemKind> = new Set<ItemKind>(['spell.phaseShift', 'spell.reclaimTrap', 'spell.telekineticGrab', 'spell.wildEnergy']);

/** WndAlchemizeItem's buttons: sell one, sell all, energize one, energize all. */
export const ALCHEMIZE_CHOICES = ['sellOne', 'sellAll', 'energizeOne', 'energizeAll'] as const;

/** Why a spell cannot be cast as asked. */
export function spellProblem(world: World, hero: Hero, kind: ItemKind, use: SpellUse): string | null {
  if (isMagicImmune(hero)) return 'your magic is suppressed';
  if (TARGETED_SPELLS.has(kind)) {
    return use.cell === undefined || !Number.isInteger(use.cell) || use.cell < 0 || use.cell >= world.levels[hero.depth]!.map.length || use.cell === hero.pos
      ? 'choose a target' : null;
  }
  switch (kind) {
    case 'spell.alchemize': {
      if (!use.on) return 'choose an item';
      const choice = ALCHEMIZE_CHOICES[use.choice ?? -1];
      if (!choice) return 'choose what to do';
      const known = knownIn(world.known, use.on.kind);
      if (choice.startsWith('sell')) return itemPrice(use.on, known) > 0 && !heroEquipped(hero).includes(use.on) ? null : 'nobody would buy that';
      return null;
    }
    case 'spell.beacon':
      // BeaconOfReturning: set it here (0), or return to where it was set (1).
      if (use.choice !== 0 && use.choice !== 1) return 'choose what to do';
      if (use.choice === 1 && !hero.buffs?.beacon) return 'the beacon is not set';
      return null;
    case 'spell.summonElemental':
      if (use.on) {
        // SummonElemental.selector: a known potion of liquid flame or frost, or scroll of recharging or transmutation.
        const ok = ['potion.liquidFlame', 'potion.frost', 'scroll.recharging', 'scroll.transmutation'].includes(use.on.kind) && isIdentified(world, use.on);
        return ok ? null : 'that cannot imbue the spell';
      }
      return NEIGHBOURS8.some((n) => isPassable(world.levels[hero.depth]!, hero.pos + n) && !charAt(world, hero.depth, hero.pos + n)) ? null : 'there is no space for the elemental';
    default:
      return null;
  }
}

/**
 * Spell.onCast. Returns how long it took and whether the spell was used up (setting a beacon, an imbued summoning
 * spell and a trap taken back keep it).
 */
export function castSpell(ctx: Ctx, hero: Hero, kind: ItemKind, use: SpellUse): { time: number; used: boolean } {
  const { world } = ctx;
  hero.invisible = 0;
  switch (kind) {
    case 'spell.alchemize': {
      const item = use.on!;
      const choice = ALCHEMIZE_CHOICES[use.choice!]!;
      const one = choice.endsWith('One') && item.qty > 1;
      const portion: Item = one ? { ...item, qty: 1 } : item;
      if (one) item.qty--;
      else removeHeld(hero, item);
      if (choice.startsWith('sell')) {
        // WndTradeItem.sell.
        const price = itemPrice(portion, knownIn(world.known, portion.kind));
        hero.gold += price;
        ctx.effects.push({ type: 'sold', hero: hero.id, item: portion, price });
      } else {
        energize(ctx, hero, portion);
      }
      return { time: 0, used: true };
    }
    case 'spell.beacon': {
      const b = buffsOf(hero);
      if (use.choice === 0) {
        // BeaconOfReturning.setBeacon: it takes a turn, and keeps the spell.
        b.beacon = { depth: hero.depth, pos: hero.pos };
        ctx.effects.push({ type: 'beacon', hero: hero.id, mode: 'set' });
        return { time: 1, used: false };
      }
      const { depth, pos } = b.beacon!;
      if (depth === hero.depth) {
        // Someone standing on the spot is pushed aside (or, if they cannot be, the hero lands beside it).
        let to = pos;
        const there = charAt(world, depth, pos);
        if (there && there !== hero) {
          const free = NEIGHBOURS8.map((n) => pos + n).filter((c) => !hasFlag(ctx.level.map[c]!, F.SOLID) && !charAt(world, depth, c));
          ctx.rng.shuffle(free);
          if (free.length === 0) return { time: 0, used: false };
          if (!isHero(there) && ['yog', 'rottingFist', 'burningFist'].includes(there.kind)) to = free[0]!;
          else there.pos = free[0]!;
        }
        if (!teleportToLocation(ctx, hero, to)) return { time: 0, used: false };
      } else {
        if (!interfloorAllowed(ctx, hero)) {
          ctx.effects.push({ type: 'interrupted', hero: hero.id, reason: 'a strong force prevents the beacon from working here' });
          return { time: 0, used: false };
        }
        moveToDepth(world, hero, depth, pos);
        ctx.effects.push({ type: 'teleported', hero: hero.id });
      }
      ctx.effects.push({ type: 'beacon', hero: hero.id, mode: 'return' });
      // With the last beacon gone, the place is forgotten.
      const left = hero.items.filter((i) => i.kind === 'spell.beacon').reduce((n, i) => n + i.qty, 0);
      if (left <= 1) delete b.beacon;
      return { time: 1, used: true };
    }
    case 'spell.curseInfusion': {
      // CurseInfusion: cursed, and stronger for it (curseInfusionBonus); a weapon takes a curse enchantment and armour a
      // curse glyph (Enchantment.randomCurse, Glyph.randomCurse), a curse already there kept unless infused before.
      const item = use.on!;
      const kind = itemDef(item.kind).category;
      if (kind === 'weapon' || kind === 'bow' || kind === 'missile') {
        if (!item.enchant) item.enchant = randomWeaponCurse(ctx.rng);
        else if (!isCurseEnchant(item.enchant) || item.infused) item.enchant = randomWeaponCurse(ctx.rng, item.enchant);
      } else if (kind === 'armor') {
        if (!item.glyph) item.glyph = randomArmorCurse(ctx.rng);
        else if (!isCurseGlyph(item.glyph) || item.infused) item.glyph = randomArmorCurse(ctx.rng, item.glyph);
      }
      item.cursed = true;
      delete item.curseUnknown;
      item.infused = true;
      ctx.effects.push({ type: 'curseInfused', hero: hero.id, item });
      return { time: 1, used: true };
    }
    case 'spell.magicalInfusion':
      upgradeItem(ctx, hero, use.on!, true);
      return { time: 1, used: true };
    case 'spell.recycle':
      recycle(ctx, hero, use.on!);
      return { time: 1, used: true };
    case 'spell.phaseShift': {
      const bolt = castRay(ctx, hero.pos, use.cell!, PROJECTILE);
      ctx.effects.push({ type: 'zapped', depth: ctx.depth, from: hero.pos, to: bolt.collision, bolt: 'magic' });
      const char = charAt(world, ctx.depth, bolt.collision);
      if (char && char !== hero && teleportChar(ctx, char)) {
        if (!isHero(char)) {
          if (char.state === 'hunting') char.state = 'wandering';
          char.target = randomDestinationFor(ctx);
          if (!isBoss(char) && !isMiniboss(char)) char.paralysed = Math.max(char.paralysed ?? 0, PARALYSIS_TURNS);
        }
      }
      return { time: 1, used: true };
    }
    case 'spell.reclaimTrap': {
      const bolt = castRay(ctx, hero.pos, use.cell!, PROJECTILE);
      ctx.effects.push({ type: 'zapped', depth: ctx.depth, from: hero.pos, to: bolt.collision, bolt: 'magic' });
      const b = buffsOf(hero);
      const stored = b.reclaimed;
      if (!stored) {
        // A visible trap there is disarmed, and the spell holds it (and is not used up).
        const terrain = ctx.level.map[bolt.collision]!;
        const trap = trapAt(ctx.level, bolt.collision);
        if (trap && !hasFlag(terrain, F.SECRET)) {
          disarmTrap(ctx.level, trap);
          b.reclaimed = trap.kind;
          ctx.effects.push({ type: 'reclaimed', hero: hero.id, trap: trap.kind });
        } else {
          ctx.effects.push({ type: 'interrupted', hero: hero.id, reason: 'there is no trap there' });
        }
        return { time: 1, used: false };
      }
      delete b.reclaimed;
      ctx.effects.push({ type: 'trap', depth: ctx.depth, pos: bolt.collision, kind: stored, hero: '' });
      springTrapKind(ctx, stored, charAt(world, ctx.depth, bolt.collision) ?? null, bolt.collision);
      return { time: 1, used: true };
    }
    case 'spell.telekineticGrab':
      return { time: telekineticGrab(ctx, hero, use.cell!), used: true };
    case 'spell.wildEnergy': {
      // WildEnergy: a cursed wand's random zap (the wands stream's CursedWand), then a charge for every wand,
      // artifacts charged (the artifacts stream's) and eight turns of recharging.
      const bolt = castRay(ctx, hero.pos, use.cell!, PROJECTILE);
      ctx.effects.push({ type: 'zapped', depth: ctx.depth, from: hero.pos, to: bolt.collision, bolt: 'wild' });
      // Belongings.charge(1): every wand a charge more (the artifacts' with the artifacts stream).
      for (const { wand, staff } of heldWands(hero)) gainCharge(wand, staff, 1);
      const b = buffsOf(hero);
      hero.recharging = Math.max(hero.recharging ?? 0, 8);
      b.artifactRecharge = (b.artifactRecharge ?? 0) + 8;
      return { time: 1, used: true };
    }
    case 'spell.unstable': {
      // UnstableSpell: a random scroll, a fighting one with monsters in sight, else a quiet one, read as if unknown.
      const fov = heroView(world, hero);
      const fighting = ctx.floor.mobs.some((mob) => fov[mob.pos] && mob.state === 'hunting' && !mob.ally);
      const pool = fighting ? COMBAT_SCROLLS : CALM_SCROLLS;
      let scroll = ctx.rng.chancesOf(UNSTABLE_CHANCES)!;
      while (!pool.has(scroll)) scroll = ctx.rng.chancesOf(UNSTABLE_CHANCES)!;
      ctx.effects.push({ type: 'unstable', hero: hero.id, kind: scroll });
      readScroll(ctx, hero, scroll, isTargetedScroll(scroll) ? defaultTarget(world, hero, scroll) : undefined);
      return { time: 1, used: true };
    }
    case 'spell.summonElemental':
      if (use.on) {
        imbueSummon(hero, kind, use.on);
        return { time: 0, used: false };
      }
      summonElemental(ctx, hero);
      return { time: 1, used: true };
    default:
      return { time: 1, used: true };
  }
}

/** Takes an item out of what the hero has (worn or in the pack). */
function removeHeld(hero: Hero, item: Item): void {
  const index = hero.items.indexOf(item);
  if (index >= 0) hero.items.splice(index, 1);
}

/** UnstableSpell.scrollChances, and which are for a fight and which for quiet. */
const UNSTABLE_CHANCES = new Map<ItemKind, number>([
  ['scroll.identify', 3], ['scroll.removeCurse', 2], ['scroll.mapping', 2], ['scroll.mirrorImage', 2], ['scroll.recharging', 2],
  ['scroll.lullaby', 2], ['scroll.retribution', 2], ['scroll.rage', 2], ['scroll.teleportation', 2], ['scroll.terror', 2],
  ['scroll.transmutation', 1],
]);
const CALM_SCROLLS: ReadonlySet<ItemKind> = new Set<ItemKind>([
  'scroll.identify', 'scroll.removeCurse', 'scroll.mapping', 'scroll.recharging', 'scroll.lullaby', 'scroll.teleportation', 'scroll.transmutation',
]);
const COMBAT_SCROLLS: ReadonlySet<ItemKind> = new Set<ItemKind>([
  'scroll.mirrorImage', 'scroll.recharging', 'scroll.lullaby', 'scroll.retribution', 'scroll.rage', 'scroll.teleportation', 'scroll.terror',
]);

/**
 * Recycle.onItemSelected: one of the item turns into another of its kind, never the same: a potion or scroll by
 * the default odds (exotic for exotic), a seed, a runestone, a tipped dart.
 */
function recycle(ctx: Ctx, hero: Hero, item: Item): void {
  const { rng } = ctx;
  const category = itemDef(item.kind).category;
  const draw = (): ItemKind => {
    if (category === 'potion' || category === 'scroll') {
      const kind = drawUsingDefaults(rng, category);
      return REGULAR_OF[item.kind] ? EXOTIC_OF[kind] ?? kind : kind;
    }
    if (category === 'seed') return new ItemGenerator(rng, ctx.depth).of('seed').kind;
    if (category === 'stone') return drawUsingDefaults(rng, 'stone');
    // TippedDart.randomTipped: a dart tipped with another seed.
    return rng.element(Object.values(TIPPED_DARTS) as ItemKind[])!;
  };
  let kind = draw();
  while (kind === item.kind) kind = draw();
  if (--item.qty <= 0) removeHeld(hero, item);
  const result = createItem(kind);
  if (!collect(hero, result)) ctx.floor.heaps.push({ pos: hero.pos, kind: 'heap', items: [result] });
  ctx.effects.push({ type: 'transmuted', hero: hero.id, from: { ...item, qty: 1 }, to: result });
}

/**
 * TelekineticGrab.affectTarget: everything in a heap where the bolt stops comes into the pack, if there is room
 * (no chest, tomb or remains: those stay shut). Returns the time it took: none, but what picking up costs past the first.
 */
function telekineticGrab(ctx: Ctx, hero: Hero, cell: number): number {
  const bolt = castRay(ctx, hero.pos, cell, PROJECTILE);
  ctx.effects.push({ type: 'zapped', depth: ctx.depth, from: hero.pos, to: bolt.collision, bolt: 'grab' });
  const heap = ctx.floor.heaps.find((h) => h.pos === bolt.collision);
  if (!heap || heap.kind === 'hidden') {
    ctx.effects.push({ type: 'interrupted', hero: hero.id, reason: 'there is nothing to grab there' });
    return 1;
  }
  if (heap.kind !== 'heap') {
    ctx.effects.push({ type: 'interrupted', hero: hero.id, reason: 'that cannot be grabbed' });
    return 1;
  }
  let taken = 0;
  while (heap.items.length > 0) {
    const item = heap.items[0]!;
    if (item.kind !== 'gold' && item.kind !== 'energy' && !hasRoom(hero, item) && !hero.items.some((other) => stacksWith(other, item))) break;
    heap.items.shift();
    if (item.kind === 'energy') ctx.world.energy = (ctx.world.energy ?? 0) + item.qty;
    else collect(hero, item);
    ctx.effects.push({ type: 'pickedUp', hero: hero.id, item });
    taken++;
  }
  if (heap.items.length === 0) ctx.floor.heaps.splice(ctx.floor.heaps.indexOf(heap), 1);
  else ctx.effects.push({ type: 'packFull', hero: hero.id });
  return Math.max(0, taken - 1);
}

/** SummonElemental.selector: the spell takes on an element from what it is imbued with. */
function imbueSummon(hero: Hero, kind: ItemKind, with_: Item): void {
  const element = ({ 'potion.liquidFlame': 'fire', 'potion.frost': 'frost', 'scroll.recharging': 'shock', 'scroll.transmutation': 'chaos' } as const)[
    with_.kind as 'potion.liquidFlame'];
  if (--with_.qty <= 0) removeHeld(hero, with_);
  const spells = hero.items.find((item) => item.kind === kind && !item.element) ?? hero.items.find((item) => item.kind === kind);
  if (spells) spells.element = element;
}

/**
 * SummonElemental.onCast: an elemental fighting for the hero steps out next to them (one already about comes back
 * to their side instead). The mobs stream brings Shattered's newborn and elemental allies; until then it is a
 * fire elemental, as an ally.
 */
function summonElemental(ctx: Ctx, hero: Hero): void {
  const free = NEIGHBOURS8.map((n) => hero.pos + n).filter((c) => isPassable(ctx.level, c) && !charAt(ctx.world, ctx.depth, c));
  const cell = ctx.rng.element(free)!;
  const elemental = createMob(`#${++ctx.world.nextId}`, 'elemental', cell, 'wandering', ctx.floor.now + 1);
  elemental.ally = true;
  elemental.owner = hero.id;
  elemental.target = hero.pos;
  ctx.floor.mobs.push(elemental);
  enterCell(ctx.level, cell);
  ctx.effects.push({ type: 'summoned', depth: ctx.depth, mob: elemental.id, pos: cell });
}

