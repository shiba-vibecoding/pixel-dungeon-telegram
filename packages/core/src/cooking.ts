import type { Hero } from './actors';
import { hasRoom, looseItems } from './bags';
import { type Ctx, landItem } from './floor';
import { createItem, type Item, itemDef } from './items';
import { distance } from './level/geometry';
import { burnBombs, freezeBombs } from './bombs';

/*
 * What fire and frost do to things (Heap.burn and freeze, Burning and Frost
 * on a hero): scrolls burn up, and mystery meat is chargrilled by fire or
 * frozen into carpaccio by frost, whether lying about or in a burning or
 * freezing hero's pack.
 */

/** Heap.burn: on every heap within reach of a fire, scrolls burn up and meat is cooked. */
export function burnHeaps(ctx: Ctx, pos: number, radius: number): void {
  for (const heap of ctx.floor.heaps) {
    if (heap.kind !== 'heap' || distance(heap.pos, pos) > radius) continue;
    // Heap.burn: a bomb in it goes off.
    burnBombs(ctx, heap);
    let burnt = false;
    heap.items = heap.items.flatMap((item): Item[] => {
      if (itemDef(item.kind).category === 'scroll') {
        burnt = true;
        return [];
      }
      if (item.kind === 'food.meat') {
        burnt = true;
        return [createItem('food.steak', item.qty)];
      }
      return [item];
    });
    if (burnt) ctx.effects.push({ type: 'heapBurnt', depth: ctx.depth, pos: heap.pos });
  }
  ctx.floor.heaps = ctx.floor.heaps.filter((heap) => heap.items.length > 0);
}

/** Heap.freeze: on every heap within reach of the frost, meat freezes. */
export function freezeHeaps(ctx: Ctx, pos: number, radius: number): void {
  for (const heap of ctx.floor.heaps) {
    if (heap.kind !== 'heap' || distance(heap.pos, pos) > radius) continue;
    freezeBombs(heap);
    heap.items = heap.items.map((item) => (item.kind === 'food.meat' ? createItem('food.carpaccio', item.qty) : item));
  }
}

/** Burning.act on a hero: something from the pack catches; a scroll burns up, a piece of meat is cooked. */
export function scorchPack(ctx: Ctx, hero: Hero): void {
  // A scroll holder keeps its scrolls from the fire.
  const item = ctx.rng.element(looseItems(hero));
  if (!item) return;
  const scroll = itemDef(item.kind).category === 'scroll';
  if (!scroll && item.kind !== 'food.meat') return;
  takeOne(hero, item);
  if (!scroll) give(ctx, hero, createItem('food.steak'));
  ctx.effects.push({ type: 'burntUp', hero: hero.id, kind: item.kind });
}

/** Frost.attachTo on a hero: a piece of meat in the pack freezes. */
export function chillPack(ctx: Ctx, hero: Hero): void {
  const item = ctx.rng.element(looseItems(hero));
  if (item?.kind !== 'food.meat') return;
  takeOne(hero, item);
  give(ctx, hero, createItem('food.carpaccio'));
}

function takeOne(hero: Hero, item: Item): void {
  if (--item.qty <= 0) hero.items.splice(hero.items.indexOf(item), 1);
}

/** Into the pack, stacking, or where the hero stands if it will not go in. */
function give(ctx: Ctx, hero: Hero, item: Item): void {
  const stack = hero.items.find((i) => i.kind === item.kind);
  if (stack) stack.qty += item.qty;
  else if (hasRoom(hero, item)) hero.items.push(item);
  else landItem(ctx, hero.pos, item);
}
