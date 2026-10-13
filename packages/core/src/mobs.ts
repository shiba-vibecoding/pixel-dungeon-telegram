import { baseKind, type Hero, isMimic, type Mob, type MobKind, mobStats } from './actors';
import { type Ctx, type Floor, heroesOn, isPassable, landItem } from './floor';
import { createItem, type Item, itemDef, ItemGenerator, type ItemKind, ITEMS, rollGold } from './items';
import { hasProp } from './props';
import { NEIGHBOURS8, NEIGHBOURS9, LENGTH, WIDTH } from './level/geometry';
import { F, hasFlag } from './level/terrain';
import type { Level } from './level/generate';
import type { Rng } from './rng';
import type { World } from './world';

/*
 * Shattered's monsters, what they are worth beyond a fight: which count
 * towards a level's quota (Mob.spawningWeight, Level.mobCount), where the
 * large ones fit (Level.openSpace), and what each leaves behind
 * (Mob.lootChance, createLoot, rollToDropLoot) with the drops that grow rarer
 * the more of them have come (Dungeon.LimitedDrops).
 */

/* Where the large fit */

const solid = (level: Level, cell: number): boolean => cell < 0 || cell >= LENGTH || hasFlag(level.map[cell]!, F.SOLID);

/** PathFinder.CIRCLE8: the neighbours clockwise from the top left. */
const CIRCLE8 = [-WIDTH - 1, -WIDTH, -WIDTH + 1, +1, +WIDTH + 1, +WIDTH, +WIDTH - 1, -1] as const;

/**
 * Level.openSpace: a cell large enough for a large monster (a DM-200, a golem, a giant champion) — not solid,
 * with an open corner: an open side and, next to it, the open diagonal and the side after that.
 */
export function isOpenSpace(level: Level, cell: number): boolean {
  if (solid(level, cell)) return false;
  let open = false;
  for (let j = 1; j < CIRCLE8.length; j += 2) {
    if (solid(level, cell + CIRCLE8[j]!)) {
      open = false;
    } else if (!solid(level, cell + CIRCLE8[(j + 1) % 8]!) && !solid(level, cell + CIRCLE8[(j + 2) % 8]!)) {
      open = true;
      break;
    }
  }
  return open;
}

/** Where a monster may stand as far as its size goes: anywhere, or only in open space if it is large. */
export const fits = (level: Level, mob: Mob, cell: number): boolean => !hasProp(mob, 'large') || isOpenSpace(level, cell);

/* How many there are */

/** The folk, the harmless and the heroes' own: not Char.Alignment.ENEMY. */
const NOT_ENEMIES: ReadonlySet<MobKind> = new Set<MobKind>([
  'ghost', 'shopkeeper', 'impShopkeeper', 'wandmaker', 'imp', 'blacksmith', 'ratKing', 'sheep', 'mirror',
]);

/** Char.Alignment.ENEMY: a monster against the heroes (not the folk, not their allies). */
export const isEnemy = (mob: Mob): boolean => !NOT_ENEMIES.has(mob.kind) && !mob.ally && !mob.hidden;

/**
 * Mob.spawningWeight: how many monsters it counts as towards the level's quota — none for what is
 * summoned or guards a room (a necromancer's skeleton, a wraith, a ripper, a mimic, a statue, a piranha),
 * half for a ghoul, which comes in pairs.
 */
export function spawningWeight(mob: Mob): number {
  switch (baseKind(mob.kind)) {
    case 'skeleton': return mob.kind === 'necroSkeleton' ? 0 : 1;
    case 'wraith': case 'ripper': case 'mimic': case 'statue': case 'piranha': return 0;
    case 'ghoul': return 0.5;
    default: return 1;
  }
}

/** Level.mobCount: the enemies on a level, minibosses aside, by their spawning weights. */
export function enemyCount(floor: Floor): number {
  let count = 0;
  for (const mob of floor.mobs) if (isEnemy(mob) && !hasProp(mob, 'miniboss')) count += spawningWeight(mob);
  return Math.round(count);
}

/* What they leave */

/** Dungeon.LimitedDrops kept by the monsters: each drop of the kind makes the next rarer. */
export type LimitedDrop =
  | 'swarmHp' | 'necroHp' | 'batHp' | 'warlockHp' | 'slimeWep' | 'skeleWep' | 'theifMisc' | 'guardArm' | 'shamanWand' | 'dm200Equip'
  | 'golemEquip';

/** How many of a limited drop have come this run. */
export const dropsOf = (world: World, drop: LimitedDrop): number => world.limitedDrops?.[drop] ?? 0;

function countDrop(world: World, drop: LimitedDrop): void {
  (world.limitedDrops ??= {})[drop] = dropsOf(world, drop) + 1;
}

/**
 * Mob.lootChance's multiplier from the hero: RingOfWealth.dropChanceMultiplier, ShardOfOblivion's.
 * SEAM(artifacts): Shattered's ring of wealth; SEAM(alchemy): the shard of oblivion (a trinket). None until then.
 */
export const dropBonus = (_hero: Hero | undefined): number => 1;

/**
 * Generator.random(Class) for a potion or scroll that may come out exotic (Mob.createLoot with
 * ExoticCrystals.consumableExoticChance). SEAM(alchemy): exotic potions and scrolls; never until then.
 */
export const consumableExoticChance = (): number => 0;

/** An item of a kind Shattered has and the port may not yet: `kind` once another stream adds it, else `fallback` (or nothing). */
export function itemOr(kind: string, fallback: ItemKind | null): Item | null {
  if (kind in ITEMS) return createItem(kind as ItemKind);
  return fallback ? createItem(fallback) : null;
}

/** A level's item generator for loot (Generator.randomUsingDefaults). */
const generator = (ctx: Ctx): ItemGenerator => new ItemGenerator(ctx.rng, ctx.depth);

/**
 * Generator.randomWeapon / randomArmor (with a floor set: DM-200s and golems use the city's and the halls'
 * odds) and a tier's weapon at +0 (a slime's). SEAM(gear): Shattered's decks and Weapon.random; Pixel
 * Dungeon's generator until then.
 */
function randomWeapon(ctx: Ctx, _floorSet?: number): Item {
  let item = generator(ctx).of('weapon');
  while (itemDef(item.kind).category !== 'weapon') item = generator(ctx).of('weapon');
  return item;
}
function randomArmor(ctx: Ctx, _floorSet?: number): Item {
  return generator(ctx).of('armor');
}
function tierWeapon(ctx: Ctx, tier: number): Item {
  const kinds = (Object.keys(ITEMS) as ItemKind[]).filter((k) => itemDef(k).category === 'weapon' && itemDef(k).tier === tier && k !== 'weapon.pickaxe');
  return createItem(ctx.rng.oneOf(kinds.length > 0 ? kinds : ['weapon.quarterstaff' as ItemKind]));
}

/** Mob.lootChance (and its own override): the chance it leaves something, before the hero's bonuses. */
export function baseLootChance(ctx: Ctx, mob: Mob): number {
  const world = ctx.world;
  const third = (drop: LimitedDrop): number => Math.pow(1 / 3, dropsOf(world, drop));
  switch (mob.kind) {
    case 'gnoll': case 'brute': return 0.5;
    case 'albino': case 'bandit': case 'shielded': case 'senior': case 'chaosElemental': case 'acidic': case 'eye':
    case 'spawner': case 'piranha': case 'phantomPiranha': case 'gnollTrickster': case 'greatCrab':
      return mob.kind === 'bandit' ? third('theifMisc') : 1;
    case 'snake': return 0.25;
    case 'crab': return 0.167;
    case 'hermitCrab': return 0.5;
    // Swarm.lootChance: the rarer the further split; five in all.
    case 'swarm': return (1 / (6 * ((mob.generation ?? 0) + 1))) * ((5 - dropsOf(world, 'swarmHp')) / 5);
    // Slime: each drop a quarter as likely as the last.
    case 'slime': case 'causticSlime': return 0.2 * Math.pow(1 / 4, dropsOf(world, 'slimeWep'));
    case 'skeleton': return 0.1667 * third('skeleWep');
    case 'thief': return 0.03 * third('theifMisc');
    case 'dm100': return 0.25;
    case 'guard': return 0.2 * third('guardArm');
    case 'necromancer': case 'spectralNecromancer': return 0.2 * ((6 - dropsOf(world, 'necroHp')) / 6);
    case 'bat': return 0.1667 * ((7 - dropsOf(world, 'batHp')) / 7);
    case 'shaman': case 'blueShaman': case 'purpleShaman': return 0.03 * third('shamanWand');
    case 'spinner': return 0.125;
    case 'dm200': case 'dm201': return 0.2 * third('dm200Equip');
    case 'ghoul': return 0.2;
    case 'elemental': case 'frostElemental': return 1 / 8;
    case 'shockElemental': return 1 / 4;
    case 'monk': return 0.083;
    case 'warlock': return 0.5;
    case 'golem': return 0.2 * third('golemEquip');
    case 'succubus': return 0.33;
    case 'scorpio': return 0.5;
    default: return 0;
  }
}

/** Mob.createLoot (and each kind's own): what it leaves, when it leaves something. */
export function createLoot(ctx: Ctx, mob: Mob): Item | null {
  const { world, rng } = ctx;
  switch (mob.kind) {
    case 'gnoll': case 'brute': case 'ghoul': return rollGold(rng, ctx.depth);
    case 'albino': case 'crab': case 'hermitCrab': case 'spinner': case 'piranha': return createItem('food.meat');
    // SEAM(alchemy): PhantomMeat; a mystery meat stands in.
    case 'phantomPiranha': return itemOr('food.phantomMeat', 'food.meat');
    case 'greatCrab': return createItem('food.meat', 2);
    case 'snake': return generator(ctx).of('seed');
    case 'swarm':
      countDrop(world, 'swarmHp');
      return createItem('potion.healing');
    case 'slime': case 'causticSlime':
      countDrop(world, 'slimeWep');
      return tierWeapon(ctx, 2);
    case 'skeleton':
      countDrop(world, 'skeleWep');
      return randomWeapon(ctx);
    case 'thief': case 'bandit':
      // Thief.loot: a ring or an artifact. SEAM(artifacts): a ring for an artifact until artifacts are among the finds.
      countDrop(world, 'theifMisc');
      return rng.int(2) === 0 ? generator(ctx).of('ring') : itemOr('artifact.random', null) ?? generator(ctx).of('ring');
    case 'dm100': return generator(ctx).of('scroll');
    case 'guard':
      countDrop(world, 'guardArm');
      return randomArmor(ctx);
    case 'necromancer': case 'spectralNecromancer':
      countDrop(world, 'necroHp');
      return createItem('potion.healing');
    case 'bat':
      countDrop(world, 'batHp');
      return createItem('potion.healing');
    case 'shielded':
      // ArmoredBrute.createLoot: plate one time in four, scale otherwise (Armor.random: SEAM(gear)).
      return createItem(rng.int(4) === 0 ? 'armor.plate' : 'armor.scale');
    case 'shaman': case 'blueShaman': case 'purpleShaman':
      countDrop(world, 'shamanWand');
      return generator(ctx).of('wand');
    case 'dm200': case 'dm201':
      countDrop(world, 'dm200Equip');
      // DM200.createLoot: a weapon or armour, as found in the dwarven city (the floor set of 4).
      return rng.int(2) === 0 ? randomWeapon(ctx, 4) : randomArmor(ctx, 4);
    case 'golem':
      countDrop(world, 'golemEquip');
      return rng.int(2) === 0 ? randomWeapon(ctx, 5) : randomArmor(ctx, 5);
    case 'elemental': return createItem('potion.liquidFlame');
    case 'frostElemental': return createItem('potion.frost');
    case 'shockElemental': return createItem('scroll.recharging');
    // SEAM(alchemy): ScrollOfTransmutation; a scroll of upgrade is not that, so a random scroll stands in.
    case 'chaosElemental': return itemOr('scroll.transmutation', null) ?? generator(ctx).of('scroll');
    case 'monk': return createItem('food.ration');
    case 'senior': return createItem('food.pasty');
    case 'warlock': {
      // Warlock.createLoot: one time in three a potion of healing, ever rarer over eight; else any other potion.
      if (rng.int(3) === 0 && rng.int(8) > dropsOf(world, 'warlockHp')) {
        countDrop(world, 'warlockHp');
        return createItem('potion.healing');
      }
      let potion: Item;
      do potion = generator(ctx).of('potion');
      while (potion.kind === 'potion.healing');
      return potion;
    }
    case 'succubus': {
      // Succubus.createLoot: any scroll but identify and upgrade.
      let scroll: Item;
      do scroll = generator(ctx).of('scroll');
      while (scroll.kind === 'scroll.identify' || scroll.kind === 'scroll.upgrade');
      return scroll;
    }
    case 'eye': return eyeLoot(ctx, mob);
    case 'scorpio': {
      // Scorpio.createLoot: any potion but healing and strength.
      let potion: Item;
      do potion = generator(ctx).of('potion');
      while (potion.kind === 'potion.healing' || potion.kind === 'potion.strength');
      return potion;
    }
    case 'acidic': return createItem('potion.experience');
    case 'spawner': return createItem('potion.healing');
    case 'gnollTrickster': {
      // GnollTrickster.createLoot: a thrown weapon at +0, uncursed, half the set. SEAM(gear): Shattered's thrown weapons.
      let missile = generator(ctx).of('weapon');
      while (itemDef(missile.kind).category !== 'missile') missile = generator(ctx).of('weapon');
      return { ...missile, qty: Math.trunc((missile.qty + 1) / 2) };
    }
    default: return null;
  }
}

/** Eye.createLoot: half the time a dewdrop (and another beside it), else a seed or a runestone (SEAM(alchemy): a seed). */
function eyeLoot(ctx: Ctx, mob: Mob): Item {
  switch (ctx.rng.int(4)) {
    case 2: return generator(ctx).of('seed');
    case 3: return itemOr('stone.random', null) ?? generator(ctx).of('seed');
    default: {
      dropBeside(ctx, mob.pos, createItem('dew'), NEIGHBOURS8);
      return createItem('dew');
    }
  }
}

/** Dropped on a random cell next to `pos` (Dungeon.level.drop at pos + a neighbour that is not a wall). */
function dropBeside(ctx: Ctx, pos: number, item: Item, around: readonly number[] = NEIGHBOURS8): void {
  let cell: number;
  do cell = pos + around[ctx.rng.int(around.length)]!;
  while (hasFlag(ctx.level.map[cell]!, F.SOLID) && !isPassable(ctx.level, cell));
  landItem(ctx, cell, item);
}

/**
 * Mob.rollToDropLoot: unless the party has outgrown it (every hero more than two levels above its maxLvl),
 * the chance of its loot (times the heroes' bonus), and what each kind leaves besides: a gnoll exile's
 * pack, a hermit crab's armour, a caustic slime's goo, a spectral necromancer's scroll of remove curse, a
 * DM-201's metal shard. A thief's stolen goods and a mimic's treasure come out first (combat.ts).
 */
export function rollToDropLoot(ctx: Ctx, mob: Mob): void {
  const stats = mobStats(mob);
  const heroes = heroesOn(ctx.world, ctx.depth);
  if (!heroes.some((hero) => hero.lvl <= stats.maxLvl + 2)) return;
  if (ctx.rng.float() < baseLootChance(ctx, mob) * dropBonus(heroes[0])) {
    const loot = createLoot(ctx, mob);
    if (loot) landItem(ctx, mob.pos, loot);
  }
  switch (mob.kind) {
    case 'gnollExile': {
      // GnollExile.rollToDropLoot: two or three random finds, scattered about it.
      const finds = [generator(ctx).random(), generator(ctx).random()];
      if (ctx.rng.int(2) === 0) finds.push(generator(ctx).random());
      for (const find of finds) dropBeside(ctx, mob.pos, find, NEIGHBOURS9);
      break;
    }
    case 'hermitCrab':
      landItem(ctx, mob.pos, randomArmor(ctx));
      break;
    case 'causticSlime': {
      // SEAM(alchemy): GooBlob, an alchemy ingredient; nothing until it is in.
      const blob = itemOr('goo.blob', null);
      if (blob) dropBeside(ctx, mob.pos, blob);
      break;
    }
    case 'spectralNecromancer':
      dropBeside(ctx, mob.pos, createItem('scroll.removeCurse'));
      break;
    case 'dm201': {
      // SEAM(alchemy): MetalShard, an alchemy ingredient; nothing until it is in.
      const shard = itemOr('metal.shard', null);
      if (shard) dropBeside(ctx, mob.pos, shard);
      break;
    }
  }
}

/* A mimic's prize */

/**
 * Mimic.generatePrize: one find more, of gold, a thrown weapon, armour, a weapon or a ring; a golden mimic's
 * finds are uncursed and half the time a level better, an ebony mimic's always and it has one more. A crystal
 * mimic's treasure is its prize already, only uncursed. SEAM(gear): Shattered's decks.
 */
export function mimicPrize(rng: Rng, depth: number, kind: MobKind, items: Item[]): Item[] {
  const gen = new ItemGenerator(rng, depth);
  const prize = [...items];
  if (kind !== 'crystalMimic') {
    switch (rng.int(5)) {
      case 0: prize.push(rollGold(rng, depth)); break;
      case 1: {
        let missile = gen.of('weapon');
        while (itemDef(missile.kind).category !== 'missile') missile = gen.of('weapon');
        prize.push(missile);
        break;
      }
      case 2: prize.push(gen.of('armor')); break;
      case 3: {
        let weapon = gen.of('weapon');
        while (itemDef(weapon.kind).category !== 'weapon') weapon = gen.of('weapon');
        prize.push(weapon);
        break;
      }
      default: prize.push(gen.of('ring'));
    }
    if (kind === 'ebonyMimic') prize.push(gen.random());
  }
  if (kind === 'goldenMimic' || kind === 'ebonyMimic' || kind === 'crystalMimic') {
    for (const item of prize) {
      const category = itemDef(item.kind).category;
      if (!['weapon', 'armor', 'ring', 'wand', 'missile'].includes(category) && kind !== 'crystalMimic') continue;
      // SEAM(gear): a curse enchantment or glyph comes off too.
      item.cursed = false;
      if (item.level < 0) item.level = 0;
      if (kind !== 'crystalMimic' && item.level === 0 && (kind === 'ebonyMimic' || rng.int(2) === 0)) item.level = 1;
    }
  }
  return prize;
}

export { isMimic };
