import { createItem, type Item, itemDef, type ItemKind } from '../../../../items';
import { inBag } from '../../../../bags';
import { T } from '../../../terrain';
import { Dungeon, limitedDrop, limitedDropped } from '../../dungeon';
import { type GenCategory, Generator } from '../../generator';
import type { GenLevel } from '../../genlevel';
import { Painter } from '../../painter';
import { Random } from '../../random';
import { Point } from '../../rect';
import { Door, DoorType } from '../../room';
import { seamItem } from '../../seams';
import { identify, knowCurse } from './prizes';
import { SpecialRoom } from './special';

/*
 * levels/rooms/special/ShopRoom, and the imp's (levels/rooms/standard/ImpShopRoom, which extends it):
 * the shopkeeper in the middle and the wares laid out round the walls, clockwise from the door, ring
 * within ring. What is for sale is decided once, when the room is first sized.
 */

/** A shop's wares; null where Shattered sells something Pixel Dungeon has no item for yet (its place is still kept). */
export type Wares = Array<Item | null>;

/** Shattered's bags (VelvetPouch, ScrollHolder, PotionBandolier, MagicalHolster), the limited drop each is, and what each holds. */
const BAGS: ReadonlyArray<{ kind: ItemKind; drop: 'VELVET_POUCH' | 'SCROLL_HOLDER' | 'POTION_BANDOLIER' | 'MAGICAL_HOLSTER'; start: number; holds: readonly string[] }> = [
  // Seeds and runestones (Pixel Dungeon's weightstone among them); goo blobs and metal shards are not in Pixel Dungeon.
  { kind: 'bag.seeds', drop: 'VELVET_POUCH', start: 1, holds: ['seed', 'weightstone'] },
  // Scrolls (spells, arcane resin and the stylus are not in Pixel Dungeon).
  { kind: 'bag.scrolls', drop: 'SCROLL_HOLDER', start: 0, holds: ['scroll'] },
  // Potions and the waterskin (liquid metal is not in Pixel Dungeon).
  { kind: 'bag.potions', drop: 'POTION_BANDOLIER', start: 0, holds: ['potion', 'vial'] },
  // Wands, thrown weapons and bombs.
  { kind: 'bag.wands', drop: 'MAGICAL_HOLSTER', start: 0, holds: ['wand', 'missile', 'bomb'] },
];

/**
 * ShopRoom.ChooseBag: of the bags not sold yet, the one that would hold most of what lies loose in
 * the pack (the velvet pouch starting one ahead); that bag is then sold out for the run. Shattered
 * weighs them in a HashMap, whose order breaks ties arbitrarily; here ties go to the first in its list.
 * The pack is the first hero's (an empty one without a world).
 */
export function chooseBag(): Item | null {
  const run = Dungeon.run;
  const bags = BAGS.filter((bag) => !limitedDropped(run, bag.drop)).map((bag) => ({ bag, count: bag.start }));
  if (bags.length === 0) return null;
  const hero = Dungeon.world?.heroes[0];
  for (const item of hero ? hero.items.filter((i) => !inBag(hero, i)) : []) {
    const category = itemDef(item.kind).category;
    for (const b of bags) if (b.bag.holds.includes(category)) b.count++;
  }
  let best: (typeof bags)[number] | null = null;
  for (const b of bags) if (!best || b.count > best.count) best = b;
  limitedDrop(run, best!.bag.drop);
  return createItem(best!.bag.kind);
}

/** Melee weapons and thrown weapons sold as found, but plain: no enchantment, no curse, +0, known. */
function plain(item: Item): Item {
  delete item.enchant;
  item.cursed = false;
  item.level = 0;
  identify(item);
  return item;
}

/** TippedDart.randomTipped(2): darts tipped with a random seed. SEAM(gear): only the fire and paralysis darts are in Pixel Dungeon. */
function randomTippedDarts(quantity: number): Item {
  const seed = Generator.randomUsingDefaults('SEED');
  return createItem(seed.kind === 'seed.firebloom' ? 'missile.incendiary' : 'missile.curare', quantity);
}

/** ShopRoom.generateItems: the shop's stock for the depth, shuffled on a stream of its own. */
export function generateShopItems(): Wares {
  const items: Wares = [];
  let tier: number;
  switch (Dungeon.depth) {
    case 11:
      tier = 3;
      items.push(createItem('armor.mail'));
      break;
    case 16:
      tier = 4;
      items.push(createItem('armor.scale'));
      break;
    case 20:
    case 21:
      tier = 5;
      items.push(createItem('armor.plate'));
      items.push(createItem('torch'), createItem('torch'), createItem('torch'));
      break;
    default:
      tier = 2;
      items.push(createItem('armor.leather'));
      break;
  }
  // Generator.wepTiers and misTiers of the shop's tier.
  const w = plain(Generator.random(`WEP_T${tier}` as GenCategory));
  const m = plain(Generator.random(`MIS_T${tier}` as GenCategory));
  items.push(w, m);

  items.push(randomTippedDarts(2));
  // SEAM(alchemy): the alchemize spell, two or three.
  const alchemize = seamItem('alchemize');
  const alchemizeQty = Random.IntRange(2, 3);
  if (alchemize) alchemize.qty = alchemizeQty;
  items.push(alchemize);

  const bag = chooseBag();
  if (bag) items.push(bag);

  items.push(createItem('potion.healing'));
  items.push(Generator.randomUsingDefaults('POTION'));
  items.push(Generator.randomUsingDefaults('POTION'));

  items.push(createItem('scroll.identify'));
  items.push(createItem('scroll.removeCurse'));
  items.push(createItem('scroll.mapping'));

  for (let i = 0; i < 2; i++) items.push(Generator.randomUsingDefaults(Random.Int(2) === 0 ? 'POTION' : 'SCROLL'));

  items.push(createItem('food.overpriced'));
  items.push(createItem('food.overpriced'));

  switch (Random.Int(4)) {
    case 0:
      items.push(createItem('bomb'));
      break;
    case 1:
    case 2:
      // Bomb.DoubleBomb.
      items.push(createItem('bomb', 2));
      break;
    case 3:
      items.push(createItem('honeypot'));
      break;
  }

  items.push(createItem('ankh'));
  items.push(seamItem('stoneOfAugmentation'));

  // SEAM(artifacts): sandbags for the timekeeper's hourglass, when the hero carries one identified and uncursed.

  let rare: Item | null;
  switch (Random.Int(10)) {
    case 0:
      rare = Generator.random('WAND');
      rare.level = 0;
      rare.charges = createItem(rare.kind).charges;
      break;
    case 1:
      rare = Generator.random('RING');
      rare.level = 0;
      break;
    case 2:
      rare = Generator.random('ARTIFACT');
      break;
    default:
      rare = seamItem('stylus');
  }
  if (rare) {
    rare.cursed = false;
    knowCurse(rare);
  }
  items.push(rare);

  // A stream of its own, so what the shop stocks (sandbags, say) never shifts the level.
  Random.pushGenerator(Random.Long());
  Random.shuffle(items);
  Random.popGenerator();
  return items;
}

/** ShopRoom: the shopkeeper and his wares; doors plain. */
export class ShopRoom extends SpecialRoom {
  readonly kind: string = 'ShopRoom';
  protected itemsToSpawn: Wares | null = null;

  override minWidth(): number {
    return Math.max(7, Math.trunc(Math.sqrt(this.spacesNeeded()) + 3));
  }
  override minHeight(): number {
    return Math.max(7, Math.trunc(Math.sqrt(this.spacesNeeded()) + 3));
  }

  /** Room for the wares, four sandbags at most (whatever the hourglass) and the shopkeeper. */
  spacesNeeded(): number {
    if (this.itemsToSpawn === null) this.itemsToSpawn = generateShopItems();
    // (Sandbags are not counted, but four places are kept for them always: SEAM(artifacts), there are none.)
    return this.itemsToSpawn.length + 4 + 1;
  }

  /** The stock still to be laid out (all of it until painted). */
  wares(): Wares {
    if (this.itemsToSpawn === null) this.itemsToSpawn = generateShopItems();
    return this.itemsToSpawn;
  }

  paint(level: GenLevel): void {
    Painter.fill(level, this, T.WALL);
    Painter.fill(level, this, 1, T.EMPTY_SP);

    this.placeShopkeeper(level);
    this.placeItems(level);

    for (const door of this.doors()) door.set(DoorType.REGULAR);
  }

  protected placeShopkeeper(level: GenLevel): void {
    const pos = level.pointToCell(this.center());
    level.mobs.push({ kind: 'shopkeeper', pos, state: 'passive' });
  }

  /** Clockwise round the room from beside the door, a ring further in each time round; what will not fit, anywhere free. */
  protected placeItems(level: GenLevel): void {
    if (this.itemsToSpawn === null) this.itemsToSpawn = generateShopItems();
    const items = this.itemsToSpawn;
    // Cells kept for wares Pixel Dungeon has no item for, as if they lay there.
    const taken = new Set<number>();
    const place = (item: Item | null, cell: number): void => {
      level.drop(item, cell).kind = 'forSale';
      if (!item) taken.add(cell);
    };

    const entryInset = this.entrance().clone();
    if (entryInset.y === this.top) entryInset.y++;
    else if (entryInset.y === this.bottom) entryInset.y--;
    else if (entryInset.x === this.left) entryInset.x++;
    else entryInset.x--;

    let curItemPlace = entryInset.clone();
    let inset = 1;
    const step = (): void => {
      if (curItemPlace.x === this.left + inset && curItemPlace.y !== this.top + inset) curItemPlace.y--;
      else if (curItemPlace.y === this.top + inset && curItemPlace.x !== this.right - inset) curItemPlace.x++;
      else if (curItemPlace.x === this.right - inset && curItemPlace.y !== this.bottom - inset) curItemPlace.y++;
      else curItemPlace.x--;
    };

    let placed = 0;
    for (const item of [...items]) {
      step();
      // Back beside the door: one ring further in.
      if (curItemPlace.equals(entryInset)) {
        if (entryInset.y === this.top + inset) entryInset.y++;
        else if (entryInset.y === this.bottom - inset) entryInset.y--;
        if (entryInset.x === this.left + inset) entryInset.x++;
        else if (entryInset.x === this.right - inset) entryInset.x--;
        inset++;
        // Out of space.
        if (inset > Math.trunc((Math.min(this.width(), this.height()) - 3) / 2)) break;
        curItemPlace = entryInset.clone();
        step();
      }
      const cell = level.pointToCell(curItemPlace);
      // Tall grass would be trampled, dropping dew or seeds among the wares.
      if (level.map[cell] === T.HIGH_GRASS) level.set(cell, T.GRASS);
      place(item, cell);
      placed++;
    }
    items.splice(0, placed);

    // Not enough room to lay everything out neatly: the rest anywhere free.
    if (items.length > 0) {
      for (const p of this.getPoints()) {
        const cell = level.pointToCell(p);
        if ((level.map[cell] === T.EMPTY_SP || level.map[cell] === T.EMPTY) && !level.heaps.has(cell) && !taken.has(cell) && !level.findMob(cell)) {
          place(items.shift()!, cell);
        }
        if (items.length === 0) break;
      }
    }
    // (Shattered reports a shop that could not place everything; the rest is left unsold.)
  }
}

/**
 * ImpShopRoom: the ambitious imp's shop on the demon halls' border, 9x9 with up to two doors. It is
 * not laid out until the city's boss is beaten, at the earliest (the level paints its floor and calls
 * spawnShop then), but its wares are decided as the level is made.
 */
export class ImpShopRoom extends ShopRoom {
  override readonly kind: string = 'ImpShopRoom';
  private impSpawned = false;

  // A set size: room for 48 wares, and always the same space in the middle.
  override minWidth(): number {
    return 9;
  }
  override minHeight(): number {
    return 9;
  }
  override maxWidth(): number {
    return 9;
  }
  override maxHeight(): number {
    return 9;
  }

  override maxConnections(_direction: number): number {
    return 2;
  }

  override paint(_level: GenLevel): void {
    if (this.itemsToSpawn === null) this.itemsToSpawn = generateShopItems();
  }

  /** The imp stands on the room's pedestal, if it has one; else in the middle. */
  protected override placeShopkeeper(level: GenLevel): void {
    let pos = level.pointToCell(this.center());
    for (const p of this.getPoints()) {
      if (level.map[level.pointToCell(p)] === T.PEDESTAL) {
        pos = level.pointToCell(p);
        break;
      }
    }
    level.mobs.push({ kind: 'impShopkeeper', pos, state: 'passive' });
  }

  /** With no connections kept (the boss level's room), the door is taken to be below the middle. */
  override entrance(): Door {
    return this.connected.size === 0 ? new Door(Math.trunc((this.left + this.right) / 2) + 1, this.bottom - 1) : super.entrance();
  }

  /** Opens the shop: the imp, then his wares. */
  spawnShop(level: GenLevel): void {
    this.impSpawned = true;
    this.placeShopkeeper(level);
    this.placeItems(level);
  }

  /** Whatever lay in the room is moved out below it before the wares go in. */
  protected override placeItems(level: GenLevel): void {
    const existing: Item[] = [];
    for (const h of [...level.heaps.values()]) {
      if (this.inside(level.cellToPoint(h.pos))) {
        existing.push(...h.items);
        level.heaps.delete(h.pos);
      }
    }
    super.placeItems(level);
    if (existing.length > 0) {
      const pos = level.pointToCell(new Point(this.left + 2, this.bottom + 2));
      for (const i of existing) level.drop(i, pos + Random.Int(5));
    }
  }

  shopSpawned(): boolean {
    return this.impSpawned;
  }
}
