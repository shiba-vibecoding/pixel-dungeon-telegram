import { beckon, createMob, isAlive } from './actors';
import { cure, freezeChar, healOverTime, isUnholy, magicDamage } from './buffs';
import { charArmor, hurt } from './combat';
import { type Char, charAt, type Ctx, enterCell, isHero } from './floor';
import { castShadow, terrainBlocksSight } from './fov';
import { type Heap, type Item, itemDef, ItemGenerator, type ItemKind } from './items';
import { isBossDepth } from './level/builder';
import { LENGTH, NEIGHBOURS8, WIDTH } from './level/geometry';
import { F, hasFlag, T } from './level/terrain';
import { destroyTerrain, seedGas } from './gas';
import { shatterPotion } from './potions';
import { plant, SEED_PLANTS } from './plants';
import { mobPress } from './traps';

/*
 * Bombs as Shattered has them (items/bombs): thrown, a bomb's fuse is lit, and two turns after it lands it goes off
 * (Bomb.Fuse) unless someone picked it up first (which snuffs it) or frost put it out. The plain bomb hurts and
 * burns down whatever can burn around it; those made better in the alchemy pot (Bomb.EnhanceBomb) do more, in a
 * wider ring: freeze, burn, flash, smoke, call sheep, regrow, smite the unholy, blast with arcane force or shrapnel.
 * A noisemaker, once its fuse has burned, waits for someone to step on it, calling the level every six turns.
 */

/** Bomb.explosionRange. */
const RANGE: Partial<Record<ItemKind, number>> = {
  bomb: 1, 'bomb.frost': 2, 'bomb.woolly': 2, 'bomb.fire': 2, 'bomb.noisemaker': 2, 'bomb.smoke': 2, 'bomb.flashbang': 2,
  'bomb.regrowth': 3, 'bomb.holy': 2, 'bomb.arcane': 2, 'bomb.shrapnel': 8,
};
/** Bomb.explodesDestructively: all but the regrowth, arcane and shrapnel bombs. */
const GENTLE: ReadonlySet<ItemKind> = new Set<ItemKind>(['bomb.regrowth', 'bomb.arcane', 'bomb.shrapnel']);

/** Bomb.Fuse: turns from landing to going off. */
export const FUSE_TURNS = 2;
/** NoisemakerFuse: turns between its calls. */
const NOISE_TURNS = 6;

export const isBomb = (kind: ItemKind): boolean => itemDef(kind).category === 'bomb';

/** Bomb.onThrow: the lit bomb lies where it landed, its fuse burning. */
export function lightFuse(ctx: Ctx, bomb: Item): void {
  bomb.fuse = ctx.floor.now + FUSE_TURNS;
}

/** When the next lit bomb on a depth burns down, if any does. */
export function nextFuse(heaps: readonly Heap[]): number | undefined {
  let next: number | undefined;
  for (const heap of heaps) {
    for (const item of heap.items) {
      if (item.fuse !== undefined && (next === undefined || item.fuse < next)) next = item.fuse;
    }
  }
  return next;
}

/**
 * Bomb.Fuse.act for the fuses due: a bomb lying in a heap goes off (Fuse.trigger); a noisemaker's first burning only
 * arms it (NoisemakerFuse), after which it goes off once someone stands on it, and calls the level every six turns.
 */
export function burnFuses(ctx: Ctx): void {
  const now = ctx.floor.now;
  for (const heap of [...ctx.floor.heaps]) {
    for (const bomb of [...heap.items]) {
      if (bomb.fuse === undefined || bomb.fuse > now) continue;
      if (bomb.kind === 'bomb.noisemaker') {
        if (bomb.triggered === undefined) {
          bomb.triggered = 0;
          bomb.fuse = now + 1;
          continue;
        }
        if (charAt(ctx.world, ctx.depth, heap.pos)) {
          takeFromHeap(ctx, heap, bomb);
          explode(ctx, bomb.kind, heap.pos);
          continue;
        }
        bomb.fuse = now + 1;
        if (--bomb.triggered <= 0) {
          for (const mob of ctx.floor.mobs) beckon(mob, heap.pos);
          ctx.effects.push({ type: 'noise', depth: ctx.depth, pos: heap.pos });
          bomb.triggered = NOISE_TURNS;
        }
        continue;
      }
      takeFromHeap(ctx, heap, bomb);
      explode(ctx, bomb.kind, heap.pos);
    }
  }
}

function takeFromHeap(ctx: Ctx, heap: Heap, item: Item): void {
  const index = heap.items.indexOf(item);
  if (index < 0) return;
  if (item.qty > 1) {
    item.qty--;
    delete item.fuse;
  } else {
    heap.items.splice(index, 1);
  }
  if (heap.items.length === 0) ctx.floor.heaps.splice(ctx.floor.heaps.indexOf(heap), 1);
}

/** Bomb.doPickUp: a lit fuse is snuffed (a triggered noisemaker cannot be picked up at all). */
export function snuff(item: Item): void {
  delete item.fuse;
  delete item.triggered;
}

/** The cells within so many steps over what the blast can pass (not solid, or what can burn). */
function blastCells(ctx: Ctx, pos: number, range: number, destructive: boolean): number[] {
  const map = ctx.level.map;
  const passes = (cell: number): boolean => !hasFlag(map[cell]!, F.SOLID) || (destructive && hasFlag(map[cell]!, F.FLAMABLE));
  const dist = new Map<number, number>([[pos, 0]]);
  const queue = [pos];
  for (let head = 0; head < queue.length; head++) {
    const cell = queue[head]!;
    if (dist.get(cell)! >= range) continue;
    for (const n of NEIGHBOURS8) {
      const next = cell + n;
      if (next < 0 || next >= LENGTH || dist.has(next) || Math.abs((next % WIDTH) - (cell % WIDTH)) > 1 || !passes(next)) continue;
      dist.set(next, dist.get(cell)! + 1);
      queue.push(next);
    }
  }
  return [...dist.keys()].sort((a, b) => a - b);
}

/** Bomb.explode: a bomb of `kind` goes off at a cell. */
export function explode(ctx: Ctx, kind: ItemKind, pos: number): void {
  const { rng, depth, level } = ctx;
  const range = RANGE[kind] ?? 1;
  const destructive = !GENTLE.has(kind);
  ctx.effects.push({ type: 'exploded', depth, pos, bomb: kind });
  const hurtBy = (char: Char, damage: number, source: 'bomb' | 'arcaneBomb' | 'flashbang' | 'holy' | 'shrapnel'): void => {
    if (damage <= 0 || !isAlive(char)) return;
    ctx.effects.push({ type: 'hurt', depth, who: char.id, damage });
    hurt(ctx, char, damage, source);
  };
  const scaled = (): number => rng.normalIntRange(4 + depth, 12 + 3 * depth);
  if (destructive) {
    const cells = blastCells(ctx, pos, range, true);
    const chars: Char[] = [];
    for (const cell of cells) {
      const char = charAt(ctx.world, depth, cell);
      if (char) chars.push(char);
    }
    for (const cell of cells) {
      if (hasFlag(level.map[cell]!, F.FLAMABLE)) destroyTerrain(ctx, cell);
      const heap = ctx.floor.heaps.find((h) => h.pos === cell);
      if (heap) explodeHeap(ctx, heap);
    }
    for (const char of chars) hurtBy(char, scaled() - rng.intRange(0, charArmor(char)), 'bomb');
  }
  const around = blastCells(ctx, pos, range, false);
  const charsIn = (cells: readonly number[]): Char[] =>
    cells.map((cell) => charAt(ctx.world, depth, cell)).filter((char): char is Char => !!char && isAlive(char));
  switch (kind) {
    case 'bomb.frost':
      for (const cell of around) {
        seedGas(ctx, cell, 'freezing', 10);
        const char = charAt(ctx.world, depth, cell);
        if (char) freezeChar(ctx, char, 2, true);
      }
      break;
    case 'bomb.fire':
      for (const cell of around) seedGas(ctx, cell, 'fire', hasFlag(level.map[cell]!, F.PIT) ? 2 : 10);
      break;
    case 'bomb.smoke': {
      let center = 1000;
      for (const cell of around) {
        seedGas(ctx, cell, 'smoke', 40);
        center -= 40;
      }
      if (center > 0) seedGas(ctx, pos, 'smoke', center);
      break;
    }
    case 'bomb.flashbang':
      for (const char of charsIn(around)) {
        hurtBy(char, magicDamage(ctx, char, Math.round(scaled() / 4)), 'flashbang');
        if (isAlive(char)) char.paralysed = Math.max(char.paralysed ?? 0, 10);
      }
      break;
    case 'bomb.holy':
      for (const char of charsIn(around)) if (isUnholy(char)) hurtBy(char, magicDamage(ctx, char, Math.round(rng.normalIntRange(depth + 4, 12 + 3 * depth) * 0.5)), 'holy');
      break;
    case 'bomb.arcane':
      for (const char of charsIn(around)) hurtBy(char, magicDamage(ctx, char, Math.round(scaled())), 'arcaneBomb');
      break;
    case 'bomb.shrapnel': {
      const fov = castShadow(pos, terrainBlocksSight(level.map), range);
      for (let cell = 0; cell < LENGTH; cell++) {
        const char = fov[cell] ? charAt(ctx.world, depth, cell) : undefined;
        if (char && isAlive(char)) hurtBy(char, scaled() - rng.intRange(0, charArmor(char)), 'shrapnel');
      }
      break;
    }
    case 'bomb.woolly':
      sheepAround(ctx, pos, range + 2, isBossDepth(depth) ? 20 : 200);
      break;
    case 'bomb.regrowth':
      regrow(ctx, around);
      break;
    default:
      break;
  }
}

/** WoollyBomb: sheep on every free cell within reach, for so many turns. */
function sheepAround(ctx: Ctx, pos: number, range: number, lifespan: number): void {
  const cells = blastCells(ctx, pos, range, false).filter((cell) =>
    cell % WIDTH > 0 && cell % WIDTH < WIDTH - 1 && !charAt(ctx.world, ctx.depth, cell) && !hasFlag(ctx.level.map[cell]!, F.PIT));
  const flock = [];
  for (const cell of cells) {
    const sheep = createMob(`#${++ctx.world.nextId}`, 'sheep', cell, 'passive', ctx.floor.now + 1);
    sheep.lifespan = lifespan;
    ctx.floor.mobs.push(sheep);
    enterCell(ctx.level, cell);
    flock.push(sheep);
  }
  ctx.effects.push({ type: 'flock', depth: ctx.depth, cells });
  for (const sheep of flock) mobPress(ctx, sheep);
}

/** StoneOfFlock: sheep for eight turns on every free cell within two steps. */
export function stoneFlock(ctx: Ctx, pos: number): void {
  sheepAround(ctx, pos, 2, 8);
}

/**
 * RegrowthBomb: friends in reach are cured and healed; regrowth springs up everywhere, and two or three plants
 * of random seeds take root on bare ground or grass. (Its fourth plant, a dewcatcher, seedpod or starflower,
 * waits for the plants the wands stream brings with the wand of regrowth.)
 */
function regrow(ctx: Ctx, cells: readonly number[]): void {
  const { rng, level, world, depth } = ctx;
  const candidates: number[] = [];
  for (const cell of cells) {
    const char = charAt(world, depth, cell);
    const t = level.map[cell];
    if (char) {
      if (isHero(char) || char.ally) {
        cure(char);
        healOverTime(char, Math.trunc(Math.fround(Math.fround(0.8) * char.ht) + 14), 0.25, 0, true);
      }
    } else if ((t === T.EMPTY || t === T.EMPTY_DECO || t === T.EMBERS || t === T.GRASS || t === T.HIGH_GRASS) && !ctx.floor.plants?.some((p) => p.pos === cell)) {
      candidates.push(cell);
    }
    seedGas(ctx, cell, 'regrowth', 10);
  }
  const plants = rng.chances([0, 0, 2, 1]);
  const seeds = new ItemGenerator(rng, depth);
  for (let i = 0; i < plants && candidates.length > 0; i++) {
    const cell = candidates.splice(rng.int(candidates.length), 1)[0]!;
    const kind = SEED_PLANTS[seeds.of('seed').kind];
    if (kind) plant(ctx, cell, kind);
  }
}

/**
 * Heap.explode: a chest or remains bursts open; in a heap, potions shatter, other bombs go off, and everything else
 * but equipment and unique things is destroyed.
 */
export function explodeHeap(ctx: Ctx, heap: Heap): void {
  if (heap.kind === 'chest' || heap.kind === 'skeleton') {
    heap.kind = 'heap';
    return;
  }
  if (heap.kind !== 'heap' && heap.kind !== 'hidden') return;
  heap.kind = 'heap';
  for (const item of [...heap.items]) {
    const category = itemDef(item.kind).category;
    if (['weapon', 'armor', 'ring', 'wand', 'missile', 'quest', 'key', 'tome', 'kit', 'ankh', 'bag', 'trinket', 'catalyst', 'vial', 'beacon'].includes(category) ||
      item.kind === 'potion.strength' || item.kind === 'scroll.upgrade' || item.kind === 'potion.mastery' || item.kind === 'scroll.enchantment' ||
      item.kind === 'elixir.might' || item.kind === 'spell.magicalInfusion') continue;
    heap.items.splice(heap.items.indexOf(item), 1);
    if (category === 'potion' || category === 'brew' || category === 'elixir') shatterPotion(ctx, null, item.kind, heap.pos);
    else if (category === 'bomb') {
      explode(ctx, item.kind, heap.pos);
      if (!GENTLE.has(item.kind)) break;
    }
  }
  if (heap.items.length === 0 && ctx.floor.heaps.includes(heap)) ctx.floor.heaps.splice(ctx.floor.heaps.indexOf(heap), 1);
}

/** Heap.burn's bombs: a bomb in a burning heap goes off. */
export function burnBombs(ctx: Ctx, heap: Heap): void {
  for (const item of [...heap.items]) {
    if (!isBomb(item.kind)) continue;
    takeFromHeap(ctx, heap, item);
    explode(ctx, item.kind, heap.pos);
  }
}

/** Heap.freeze's bombs: frost puts a burning fuse out (Fuse.freeze), but not an armed noisemaker's. */
export function freezeBombs(heap: Heap): void {
  for (const item of heap.items) if (item.fuse !== undefined && item.triggered === undefined) delete item.fuse;
}

