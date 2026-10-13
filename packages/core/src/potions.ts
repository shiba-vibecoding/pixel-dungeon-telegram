import { type Hero, isAlive, maxExp, type Mob } from './actors';
import { earnExp, hurt } from './combat';
import {
  buffsOf, cleanse, cure, FEATHER_TURNS, HASTE_TURNS, healOverTime, IMBUE_TURNS, isFiery, MAGICAL_SIGHT_TURNS, OOZE_TURNS,
  ROOTS_TURNS, setArcaneArmor, setBarkskin, setShield, snapFreeze, STAMINA_TURNS, updateMight, addOoze,
} from './buffs';
import { isChallenged, NO_HEALING } from './challenges';
import { type Char, charAt, type Ctx, enterCell, heroesOn, heroView, isHero, leaveCell } from './floor';
import { clearGas, clearGasAt, reachable, seedCorrosive, seedGas, setCellToWater } from './gas';
import { type Item, itemDef, type ItemKind } from './items';
import { adjacent, cellX, cellY, LENGTH, NEIGHBOURS4, NEIGHBOURS8, NEIGHBOURS9, squaredDistance } from './level/geometry';
import { F, hasFlag, T } from './level/terrain';
import { castRay, coneCells, MAGIC_BOLT, PROJECTILE, STOP_TARGET_ONLY, WONT_STOP } from './ray';
import { mobPress, trapAt, triggerTrap } from './traps';
import type { World } from './world';

/*
 * Potions as Shattered has them (items/potions, exotic, brews, elixirs): what each does drunk (Potion.apply) and
 * shattered (Potion.shatter), where it was thrown or where the drinker stands for those that are only harmful.
 * Exotic potions are known with their ordinary counterpart; brews (thrown) and elixirs (drunk) are always known.
 */

/** Potion.mustThrowPots: known, these are thrown rather than drunk (all brews but the unstable one too). */
export const MUST_THROW: ReadonlySet<ItemKind> = new Set<ItemKind>([
  'potion.toxicGas', 'potion.liquidFlame', 'potion.paralyticGas', 'potion.frost',
  'potion.corrosiveGas', 'potion.snapFreeze', 'potion.shroudingFog', 'potion.stormClouds',
  'brew.aqua', 'brew.blizzard', 'brew.caustic', 'brew.infernal', 'brew.shocking',
]);
/** Potion.canThrowPots: known, these may be drunk or thrown. */
export const CAN_THROW: ReadonlySet<ItemKind> = new Set<ItemKind>([
  'potion.purity', 'potion.levitation', 'potion.cleansing', 'elixir.honeyedHealing', 'brew.unstable',
]);

/** What drinking a potion needs besides itself: a cell (dragon's breath), an item (mastery), a choice (inspiration). */
export interface PotionUse {
  cell?: number;
  on?: Item;
  choice?: number;
}

/** Why a known potion cannot be drunk as asked (a brew is never drunk but the unstable one). */
export function drinkProblem(world: World, hero: Hero, kind: ItemKind, known: boolean, use: PotionUse): string | null {
  if (itemDef(kind).category === 'brew' && kind !== 'brew.unstable') return 'brews are thrown';
  if (!known) return null;
  if (kind === 'potion.dragonsBreath') {
    return use.cell === undefined || !Number.isInteger(use.cell) || use.cell < 0 || use.cell >= LENGTH || use.cell === hero.pos ? 'choose where to breathe' : null;
  }
  if (kind === 'potion.mastery') {
    if (!use.on) return 'choose a weapon or armour';
    const category = itemDef(use.on.kind).category;
    return (category === 'weapon' || category === 'armor') && !use.on.mastery ? null : 'that cannot be made easier';
  }
  if (kind === 'potion.divineInspiration') {
    const boosted = hero.buffs?.inspired ?? [];
    if ([1, 2, 3, 4].every((tier) => boosted.includes(tier))) return 'every tier is boosted already';
    return use.choice !== undefined && [1, 2, 3, 4].includes(use.choice) && !boosted.includes(use.choice) ? null : 'choose a tier';
  }
  return null;
}

/** Potion.apply: what a potion does drunk (the potion has left the pack). */
export function drinkPotion(ctx: Ctx, hero: Hero, kind: ItemKind, use: PotionUse = {}): void {
  const b = buffsOf(hero);
  switch (kind) {
    case 'potion.strength':
      hero.str++;
      ctx.effects.push({ type: 'strength', hero: hero.id });
      return;
    case 'potion.healing':
      cure(hero);
      heal(ctx, hero);
      return;
    case 'potion.mindVision':
      hero.mindVision = Math.max(hero.mindVision, 20);
      return;
    case 'potion.haste':
      b.haste = Math.max(b.haste ?? 0, HASTE_TURNS);
      return;
    case 'potion.invisibility':
      // Invisibility.DURATION.
      hero.invisible = Math.max(hero.invisible, 20);
      return;
    case 'potion.levitation':
      hero.levitating = Math.max(hero.levitating ?? 0, 20);
      return;
    case 'potion.purity':
      // BlobImmunity.DURATION.
      hero.gasImmune = Math.max(hero.gasImmune ?? 0, 20);
      return;
    case 'potion.experience':
      earnExp(ctx, hero, maxExp(hero), 'potion');
      return;
    case 'potion.shielding':
      // ~75% of a potion of healing, as a shield.
      if (isChallenged(ctx.world, NO_HEALING)) pharmacophobia(hero);
      else setShield(hero, Math.trunc(Math.fround(Math.fround(0.6) * hero.ht) + 10));
      return;
    case 'potion.magicalSight':
      b.magicalSight = Math.max(b.magicalSight ?? 0, MAGICAL_SIGHT_TURNS);
      hero.blind = 0;
      return;
    case 'potion.stamina':
      b.stamina = Math.max(b.stamina ?? 0, STAMINA_TURNS);
      return;
    case 'potion.earthenArmor':
      setBarkskin(hero, 2 + Math.trunc(hero.lvl / 3), 50);
      return;
    case 'potion.cleansing':
      cleanse(hero);
      return;
    case 'potion.dragonsBreath':
      dragonsBreath(ctx, hero, use.cell!);
      return;
    case 'potion.mastery':
      // PotionOfMastery: the chosen weapon or armour wants two strength less.
      if (use.on) {
        use.on.mastery = true;
        ctx.effects.push({ type: 'masteryPotion', hero: hero.id, item: use.on });
      }
      return;
    case 'potion.divineInspiration':
      // DivineInspirationTracker.setBoosted: a talent point more in the tier (talents.ts fills in what that gives).
      if (use.choice !== undefined) {
        (b.inspired ??= []).push(use.choice);
        ctx.effects.push({ type: 'inspired', hero: hero.id, tier: use.choice });
      }
      return;
    case 'brew.unstable': {
      // UnstableBrew.apply: one of the potions that are drunk, as if it were that one (but unknown, it teaches nothing).
      let drunk = ctx.rng.chancesOf(unstableChances(ctx.world))!;
      while (MUST_THROW.has(drunk)) drunk = ctx.rng.chancesOf(unstableChances(ctx.world))!;
      ctx.effects.push({ type: 'unstable', hero: hero.id, kind: drunk });
      drinkPotion(ctx, hero, drunk);
      return;
    }
    case 'elixir.aquaticRejuvenation':
      if (isChallenged(ctx.world, NO_HEALING)) pharmacophobia(hero);
      else b.aquaHealing = Math.max(b.aquaHealing ?? 0, Math.round(hero.ht * 1.5));
      return;
    case 'elixir.arcaneArmor':
      setArcaneArmor(hero, 5 + Math.trunc(hero.lvl / 2), 80);
      return;
    case 'elixir.dragonsBlood':
      b.fireImbue = IMBUE_TURNS;
      hero.burning = 0;
      return;
    case 'elixir.featherFall':
      b.featherFall = (b.featherFall ?? 0) + FEATHER_TURNS;
      return;
    case 'elixir.honeyedHealing':
      cure(hero);
      heal(ctx, hero);
      // Hunger.satisfy(HUNGRY / 2).
      hero.hunger = Math.max(0, hero.hunger - 130);
      return;
    case 'elixir.icyTouch':
      b.frostImbue = Math.max(b.frostImbue ?? 0, IMBUE_TURNS);
      delete hero.chill;
      delete hero.frozen;
      return;
    case 'elixir.might':
      // ElixirOfMight: a point of strength, and a boost to health for the next five levels.
      hero.str++;
      b.htBoost = 5;
      updateMight(hero);
      ctx.effects.push({ type: 'strength', hero: hero.id });
      return;
    case 'elixir.toxicEssence':
      b.toxicImbue = IMBUE_TURNS;
      hero.poison = 0;
      return;
    default:
      // The harmful ones burst where the drinker stands (Potion.apply: shatter(hero.pos)).
      shatterPotion(ctx, hero, kind, hero.pos);
  }
}

/** PotionOfHealing.heal: health back over time, 80% of the most and fourteen (a vial of blood spreads it out). */
function heal(ctx: Ctx, char: Char): void {
  if (isHero(char) && isChallenged(ctx.world, NO_HEALING)) {
    pharmacophobia(char);
    return;
  }
  healOverTime(char, Math.trunc(Math.fround(Math.fround(0.8) * char.ht) + 14), 0.25, 0, true);
  if (isHero(char)) ctx.effects.push({ type: 'healing', hero: char.id });
}

/** PotionOfHealing.pharmacophobiaProc: under the challenge, healing poisons instead. */
function pharmacophobia(hero: Hero): void {
  hero.poison = Math.max(hero.poison, 4 + Math.trunc(hero.lvl / 2));
}

/** UnstableBrew.potionChances, healing out under the challenge against it. */
function unstableChances(world: World): Map<ItemKind, number> {
  return new Map<ItemKind, number>([
    ['potion.healing', isChallenged(world, NO_HEALING) ? 0 : 3], ['potion.mindVision', 2], ['potion.frost', 2], ['potion.liquidFlame', 2],
    ['potion.toxicGas', 2], ['potion.haste', 2], ['potion.invisibility', 2], ['potion.levitation', 2], ['potion.paralyticGas', 2],
    ['potion.purity', 2], ['potion.experience', 1],
  ]);
}

/** The potions whose shattering tells what they are, when seen (they override Potion.shatter). */
const SHATTER_SHOWS: ReadonlySet<ItemKind> = new Set<ItemKind>([
  'potion.frost', 'potion.liquidFlame', 'potion.toxicGas', 'potion.paralyticGas', 'potion.levitation', 'potion.purity',
  'potion.corrosiveGas', 'potion.shroudingFog', 'potion.stormClouds', 'potion.snapFreeze',
]);

/**
 * Potion.shatter: a potion breaks at a cell (thrown, or drunk when only harmful), and what is in it gets out. True
 * when this told the party what it was (a potion that does something when shattered, seen breaking).
 */
export function shatterPotion(ctx: Ctx, thrower: Hero | null, kind: ItemKind, cell: number): boolean {
  const { level, floor } = ctx;
  const open = (c: number): boolean => c >= 0 && c < LENGTH && !hasFlag(level.map[c]!, F.SOLID);
  /** Some of a gas into each open cell around, and what would go into a wall into the middle. */
  const ring = (gas: Parameters<typeof seedGas>[2], each: number, strength?: number): void => {
    let center = each;
    for (const n of NEIGHBOURS8) {
      if (open(cell + n)) seed(cell + n, each);
      else center += each;
    }
    seed(cell, center);
    function seed(c: number, amount: number): void {
      if (gas === 'corrosive') seedCorrosive(ctx, c, amount, strength!);
      else seedGas(ctx, c, gas, amount);
    }
  };
  ctx.effects.push({ type: 'splash', depth: ctx.depth, pos: cell, kind });
  // Potion.splash: fire at the cell goes out, and a friend there is rid of burning and ooze.
  clearGasAt(floor, 'fire', cell);
  const friend = charAt(ctx.world, ctx.depth, cell);
  if (friend && (isHero(friend) || friend.ally)) {
    friend.burning = 0;
    if (isHero(friend)) friend.ooze = -1;
    if (!isHero(friend)) delete friend.ooze;
  }
  let shows = SHATTER_SHOWS.has(kind);
  switch (kind) {
    case 'potion.frost':
      for (const n of NEIGHBOURS9) if (open(cell + n)) seedGas(ctx, cell + n, 'freezing', 10);
      break;
    case 'potion.liquidFlame':
      for (const n of NEIGHBOURS9) if (open(cell + n)) seedGas(ctx, cell + n, 'fire', 2);
      break;
    case 'potion.toxicGas':
      seedGas(ctx, cell, 'toxic', 1000);
      break;
    case 'potion.paralyticGas':
      seedGas(ctx, cell, 'paralytic', 1000);
      break;
    case 'potion.levitation':
      seedGas(ctx, cell, 'confusion', 1000);
      break;
    case 'potion.purity':
      // PotionOfPurity.DISTANCE.
      clearGas(ctx, cell, 3);
      break;
    case 'potion.corrosiveGas':
      ring('corrosive', 25, 2 + Math.trunc(ctx.depth / 5));
      break;
    case 'potion.shroudingFog':
      ring('smoke', 180);
      break;
    case 'potion.stormClouds':
      ring('storm', 120);
      break;
    case 'potion.snapFreeze':
      for (const n of NEIGHBOURS9) {
        if (!open(cell + n)) continue;
        snapFreeze(ctx, cell + n);
        const char = charAt(ctx.world, ctx.depth, cell + n);
        if (char) char.rooted = Math.max(char.rooted ?? 0, ROOTS_TURNS * 2);
      }
      break;
    case 'potion.cleansing': {
      // PotionOfCleansing.shatter: whoever it lands on is cleansed.
      const char = charAt(ctx.world, ctx.depth, cell);
      if (char) {
        cleanse(char);
        shows = true;
      }
      break;
    }
    case 'elixir.honeyedHealing': {
      // ElixirOfHoneyedHealing.shatter: whoever it lands on is cured and healed (a golden bee is won over).
      const char = charAt(ctx.world, ctx.depth, cell);
      if (char) {
        cure(char);
        heal(ctx, char);
      }
      break;
    }
    case 'brew.blizzard':
      ring('blizzard', 120);
      break;
    case 'brew.infernal':
      ring('inferno', 120);
      break;
    case 'brew.caustic':
      // CausticBrew: everyone within three steps is covered in caustic ooze.
      for (const c of reachable(ctx, cell, 3)) {
        const char = charAt(ctx.world, ctx.depth, c);
        if (char && isAlive(char)) addOoze(char);
      }
      break;
    case 'brew.shocking':
      for (const c of reachable(ctx, cell, 3)) seedGas(ctx, c, 'electricity', 20);
      break;
    case 'brew.aqua':
      geyser(ctx, cell, thrower);
      break;
    case 'brew.unstable': {
      // UnstableBrew.shatter: one of the potions that are thrown, as if it were that one.
      let thrown = ctx.rng.chancesOf(unstableChances(ctx.world))!;
      while (!MUST_THROW.has(thrown) && !CAN_THROW.has(thrown)) thrown = ctx.rng.chancesOf(unstableChances(ctx.world))!;
      ctx.effects.push({ type: 'unstable', hero: thrower?.id ?? '', kind: thrown });
      shatterPotion(ctx, thrower, thrown, cell);
      shows = false;
      break;
    }
    default:
      shows = false;
  }
  if (!shows) return false;
  return heroesOn(ctx.world, ctx.depth).some((hero) => heroView(ctx.world, hero)[cell]);
}

/**
 * PotionOfDragonsBreath: a cone of fire up to six cells long and sixty degrees wide. Doors in it burst open; cells
 * beside the drinker burn only if they can, the rest catch fire; whoever is in it burns and is crippled.
 */
function dragonsBreath(ctx: Ctx, hero: Hero, target: number): void {
  const bolt = castRay(ctx, hero.pos, target, WONT_STOP);
  const cone = coneCells(ctx, bolt, 6, 60, { ...PROJECTILE, chars: false, ignoreSoft: true });
  ctx.effects.push({ type: 'breath', depth: ctx.depth, from: hero.pos, to: bolt.path[Math.min(bolt.dist, 6)] ?? target, cells: [...cone] });
  const near: number[] = [];
  for (const cell of cone) {
    if (cell === hero.pos) continue;
    if (ctx.level.map[cell] === T.DOOR) ctx.level.map[cell] = T.OPEN_DOOR;
    if (adjacent(hero.pos, cell) && !hasFlag(ctx.level.map[cell]!, F.FLAMABLE)) near.push(cell);
    else seedGas(ctx, cell, 'fire', 5);
    const char = charAt(ctx.world, ctx.depth, cell);
    if (char && isAlive(char)) {
      if (!isHero(char) || !(char.buffs?.fireImbue ?? 0)) char.burning = Math.max(char.burning ?? 0, 8);
      char.crippled = Math.max(char.crippled ?? 0, 5);
    }
  }
  const far = (c: number): number => squaredDistance(c, hero.pos);
  for (const cell of near) {
    for (const n of NEIGHBOURS4) {
      const next = cell + n;
      if (far(next) > far(cell) && hasFlag(ctx.level.map[next]!, F.FLAMABLE) && !(ctx.floor.gas?.fire ?? []).some(([c]) => c === next)) {
        seedGas(ctx, next, 'fire', 5);
      }
    }
  }
}

/**
 * GeyserTrap.activate (the aqua brew's): water bursts up within two steps (some of the outer ring stays dry),
 * fire goes out, and everyone next to it is thrown back two cells, whoever is in the middle the way the brew flew;
 * fiery creatures are hurt as by a bomb.
 */
export function geyser(ctx: Ctx, pos: number, thrower: Hero | null): void {
  const { rng } = ctx;
  const steps = stepsAround(ctx, pos, 2);
  for (const [cell, d] of steps) {
    if ((d === 2 && rng.int(3) > 0) || d < 2) {
      setCellToWater(ctx, cell);
      clearGasAt(ctx.floor, 'fire', cell);
    }
  }
  ctx.effects.push({ type: 'geyser', depth: ctx.depth, pos });
  const scaling = ctx.depth;
  for (const n of NEIGHBOURS8) {
    const char = charAt(ctx.world, ctx.depth, pos + n);
    if (!char || !isAlive(char)) continue;
    if (isFiery(char)) hurtBy(ctx, char, Math.trunc(rng.normalIntRange(5 + scaling, 10 + scaling * 2) * 0.67));
    if (!isAlive(char)) continue;
    char.burning = 0;
    const toward = castRay(ctx, pos, char.pos, STOP_TARGET_ONLY);
    const past = castRay(ctx, toward.collision, toward.path[toward.path.length - 1]!, PROJECTILE);
    throwChar(ctx, char, past.path, past.dist, 2);
  }
  const center = charAt(ctx.world, ctx.depth, pos);
  if (center && isAlive(center)) {
    let towards = -1;
    if (thrower && thrower.pos !== pos) {
      const aim = castRay(ctx, thrower.pos, pos, STOP_TARGET_ONLY);
      if (aim.path.length > aim.dist + 1) towards = aim.path[aim.dist + 1]!;
    } else if (isHero(center)) {
      const avoid = (c: number): boolean => hasFlag(ctx.level.map[c]!, F.AVOID);
      towards = rng.element(NEIGHBOURS8.filter((n) => !avoid(pos + n) && !avoid(pos + n + n)).map((n) => pos + n)) ?? -1;
    } else {
      towards = pos + NEIGHBOURS8[rng.int(8)]!;
    }
    if (isFiery(center)) hurtBy(ctx, center, rng.normalIntRange(5 + scaling, 10 + scaling * 2));
    if (isAlive(center) && towards !== -1) {
      center.burning = 0;
      const line = castRay(ctx, pos, towards, MAGIC_BOLT);
      throwChar(ctx, center, line.path, line.dist, 2);
    }
  }
}

function hurtBy(ctx: Ctx, char: Char, damage: number): void {
  if (damage <= 0) return;
  ctx.effects.push({ type: 'hurt', depth: ctx.depth, who: char.id, damage });
  hurt(ctx, char, damage, 'geyser');
}

/** Steps from a cell over what is not solid, as PathFinder.buildDistanceMap(cell, not solid, radius). */
function stepsAround(ctx: Ctx, pos: number, radius: number): Map<number, number> {
  const reach = reachable(ctx, pos, radius);
  const dist = new Map<number, number>([[pos, 0]]);
  const queue = [pos];
  for (let head = 0; head < queue.length; head++) {
    const cell = queue[head]!;
    for (const n of NEIGHBOURS8) {
      const next = cell + n;
      if (!reach.has(next) || dist.has(next) || Math.abs(cellX(next) - cellX(cell)) > 1) continue;
      dist.set(next, dist.get(cell)! + 1);
      queue.push(next);
    }
  }
  return dist;
}

/**
 * WandOfBlastWave.throwChar (a seam the wands stream shares): a character is thrown along a path, `power` cells at
 * most (half for a boss), stopping before anyone; hitting something on the way hurts and stuns it a moment.
 */
export function throwChar(ctx: Ctx, char: Char, path: readonly number[], pathDist: number, power: number): void {
  if (!isHero(char) && ['goo', 'tengu', 'dm300', 'king', 'yog'].includes(char.kind)) power = Math.trunc((power + 1) / 2);
  let dist = Math.min(pathDist, power);
  let collided = dist === pathDist;
  if (dist <= 0 || (char.rooted ?? 0) > 0 || (!isHero(char) && ['yog', 'rottingFist', 'burningFist'].includes(char.kind))) return;
  if (charAt(ctx.world, ctx.depth, path[dist]!)) {
    dist--;
    collided = true;
  }
  if (dist < 0) return;
  const to = path[dist]!;
  if (to === char.pos) return;
  const from = char.pos;
  char.pos = to;
  leaveCell(ctx.world, ctx.level, ctx.depth, from);
  enterCell(ctx.level, to);
  ctx.effects.push({ type: 'pushed', depth: ctx.depth, mob: char.id, from, to });
  if (collided) {
    const damage = ctx.rng.normalIntRange(dist, 2 * dist);
    if (damage > 0) {
      ctx.effects.push({ type: 'hurt', depth: ctx.depth, who: char.id, damage });
      hurt(ctx, char, damage, 'knockback');
    }
    if (isAlive(char)) char.paralysed = Math.max(char.paralysed ?? 0, 1 + dist / 2);
  }
  if (!isAlive(char)) return;
  if (isHero(char)) {
    if (!(char.levitating ?? 0) && trapAt(ctx.level.map[to]!)) triggerTrap(ctx, char, to);
  } else {
    mobPress(ctx, char as Mob);
  }
}

