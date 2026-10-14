import { affectHunger } from './hero';
import type { Hero } from './actors';
import { BRANCH_GATES } from './branchgates';
import { type Ctx, dropItem } from './floor';
import { identify, isIdentified } from './ident';
import { collect } from './inventory';
import { createItem, type Item, itemDef, randomEnchantment, randomGlyph, wandMaxCharges } from './items';
import type { Level } from './level/generate';
import { adjacent, NEIGHBOURS8 } from './level/geometry';
import { Dungeon } from './level/gen/dungeon';
import { Generator } from './level/gen/generator';
import { QuestHooks } from './level/gen/quests';
import { Random } from './level/gen/random';
import type { Room } from './level/gen/room';
import { BlacksmithRoom } from './level/gen/rooms/quest/blacksmith-room';
import { T } from './level/terrain';
import type { BlacksmithQuest, BlacksmithType } from './mine-types';
import { questScore } from './score';
import { isUpgradable, itemAt, type ItemRef } from './scrolls';
import { mend } from './wear';
import type { World } from './world';

export type { BlacksmithQuest, BlacksmithType } from './mine-types';

/*
 * The troll blacksmith of the caves (Blacksmith, Blacksmith.Quest, WndBlacksmith), as Shattered v3 has
 * him: once a run, on depth 12, 13 or 14 (the deeper the likelier), his smithy stands over an old mine.
 * He lends his pickaxe and sends the hero down once for dark gold — 40 pieces would do — and to put
 * an end to what troubles the mine: a giant crystal spire, a gnoll geomancer, or (only partly made in
 * Shattered, never rolled) a fungal core. Back up, the gold and the boss earn favour (50 a piece of
 * ore, 2000 at most, and 1000 for the boss), which he spends on his services: the pickaxe back (250,
 * or free from 2500 favour), reforging two items of a kind into one a level better, hardening an
 * enchantment or glyph against upgrades, upgrading an item below +2, smithing one of four items he
 * rolled ahead, or the favour's worth in gold.
 */

export const CRYSTAL = 1;
export const GNOLL = 2;
export const FUNGI = 3;

/** What he says: his errand (`intro`), a reminder, his services on offer (`rewards`; `smith`: the four items to choose from), get lost; `service` once one is done. */
export type BlacksmithLine = 'intro' | 'reminder' | 'rewards' | 'smith' | 'getLost' | 'service';

/** WndBlacksmith's buttons, and WndSmith's choice (`pick`). */
export type BlacksmithService = 'pickaxe' | 'reforge' | 'harden' | 'upgrade' | 'smith' | 'pick' | 'cashout';

export interface BlacksmithAction {
  type: 'blacksmith';
  service: BlacksmithService;
  /** reforge: the two items (the better one comes out a level higher, the other is used up). */
  first?: ItemRef;
  second?: ItemRef;
  /** harden, upgrade: the item. */
  item?: ItemRef;
  /** pick: which of the four smithed items. */
  choice?: number;
}

/** WndBlacksmith's prices. */
export const pickaxeCost = (q: BlacksmithQuest): number => (q.freePickaxe ? 0 : 250);
export const reforgeCost = (q: BlacksmithQuest): number => 500 + 1000 * q.reforges;
export const hardenCost = (q: BlacksmithQuest): number => 500 + 1000 * q.hardens;
export const upgradeCost = (q: BlacksmithQuest): number => 1000 + 1000 * q.upgrades;
export const SMITH_COST = 2000;

/** Blacksmith.Quest.completed(): the errand is over (he gave it, and the hero came back up). */
export const questCompleted = (q: BlacksmithQuest): boolean => q.given && q.completed;

/** Blacksmith.Quest.rewardsAvailable: favour left, items paid for and not yet chosen, or the pickaxe free to take. */
export function rewardsAvailable(q: BlacksmithQuest): boolean {
  return q.favor > 0 || (q.smithRewards !== null && q.smiths > 0) || (q.pickaxe !== null && q.freePickaxe);
}

/** The pickaxe as Blacksmith.Quest.reset makes it: known through and through. */
const newPickaxe = (): Item => createItem('weapon.pickaxe');

/* Spawning (CavesLevel.initRooms) */

/**
 * Blacksmith.Quest.spawn: once a run, deeper than 11, one time in (15 - depth) — 1 in 3 on 12, 1 in 2
 * on 13, always on 14 — the smithy joins the level's rooms; the quest's kind is rolled (crystals or
 * gnolls: the fungi are not rolled), and so are the rewards he can smith. A level built again holds the
 * smithy again, without rolling anything anew.
 */
export function spawnBlacksmith(rooms: Room[]): Room[] {
  const world = Dungeon.world;
  if (!world) return rooms;
  const existing = world.smithQuest;
  if (existing) {
    if (existing.depth === Dungeon.depth && !existing.given) rooms.push(new BlacksmithRoom());
    return rooms;
  }
  if (Dungeon.depth > 11 && Random.Int(15 - Dungeon.depth) === 0) {
    rooms.push(new BlacksmithRoom());
    const type = Random.IntRange(1, 2) as BlacksmithType;
    const quest: BlacksmithQuest = {
      depth: Dungeon.depth, type, given: false, started: false, bossBeaten: false, completed: false,
      favor: 0, pickaxe: newPickaxe(), freePickaxe: false, reforges: 0, hardens: 0, upgrades: 0, smiths: 0, smithRewards: null,
    };
    generateRewards(quest);
    world.smithQuest = quest;
  }
  return rooms;
}

QuestHooks.blacksmith = spawnBlacksmith;

/**
 * Blacksmith.Quest.generateRewards: two different melee weapons, a set of thrown weapons and an armour
 * (SEAM(gear): of the floor set's tiers; Pixel Dungeon's tables stand in), all of one level (30% +0, 45%
 * +1, 20% +2, 5% +3), plain and uncursed; and, rolled first so the outcome draws no more, an
 * enchantment and a glyph kept apart for whichever is chosen, three times in ten.
 */
export function generateRewards(q: BlacksmithQuest): void {
  const rewards: Item[] = [Generator.randomWeapon(), Generator.randomWeapon()];
  while (rewards[0]!.kind === rewards[1]!.kind) {
    // SEAM(gear): Generator.undoDrop for the weapon put back (the decks are Shattered's).
    rewards.pop();
    rewards.push(Generator.randomWeapon());
  }
  rewards.push(Generator.randomMissile());
  rewards.push(Generator.randomArmor());

  const roll = Random.Float();
  const level = roll < Math.fround(0.3) ? 0 : roll < Math.fround(0.75) ? 1 : roll < Math.fround(0.95) ? 2 : 3;
  for (const item of rewards) {
    item.level = level;
    delete item.enchant;
    delete item.glyph;
    delete item.cursed;
    delete item.durability;
  }
  q.smithRewards = rewards;

  const enchant = randomEnchantment(Random.rng);
  const glyph = randomGlyph(Random.rng);
  // SEAM(alchemy): ParchmentScrap.enchantChanceMultiplier, 1 without the trinket.
  if (Random.Float() > Math.fround(0.3)) {
    delete q.smithEnchant;
    delete q.smithGlyph;
  } else {
    q.smithEnchant = enchant;
    q.smithGlyph = glyph;
  }
}

/* The pickaxe */

export const hasPickaxe = (hero: Hero): boolean => pickaxeOf(hero) !== undefined;

export const pickaxeOf = (hero: Hero): Item | undefined =>
  hero.weapon?.kind === 'weapon.pickaxe' ? hero.weapon : hero.items.find((item) => item.kind === 'weapon.pickaxe');

/** Takes the pickaxe from the hero: out of their hands (cursed or not) or out of the pack. */
function takePickaxe(hero: Hero): Item | null {
  if (hero.weapon?.kind === 'weapon.pickaxe') {
    const pick = hero.weapon;
    hero.weapon = null;
    return pick;
  }
  const index = hero.items.findIndex((item) => item.kind === 'weapon.pickaxe');
  return index < 0 ? null : hero.items.splice(index, 1)[0]!;
}

/** Pickaxe.actions on the mine: no dropping or throwing what one must mine with. */
export function pickaxeKept(world: World, hero: Hero, item: Item): boolean {
  return item.kind === 'weapon.pickaxe' && isMine(world, world.levels[hero.depth]);
}

/** MeleeWeapon.damageRoll for the pickaxe alone (the spire and the geomancer's armour feel only the tool, not the hero's arm). */
export function pickaxeDamage(ctx: Ctx, pick: Item): number {
  const level = Math.max(0, pick.level);
  return ctx.rng.normalIntRange(2 + level, 15 + 3 * level);
}

/* The mine */

/** Dungeon.level instanceof MiningLevel: the side level of the smithy's depth. */
export function isMine(world: World, level: Level | undefined): boolean {
  return !!level && !!level.branch && (level.mine !== undefined || world.smithQuest?.depth === level.depth);
}

/** Level.insideMap, for the level's own size within the grid. */
function insideMap(level: Level, cell: number): boolean {
  const w = level.width ?? 64;
  const h = level.height ?? 64;
  const x = cell % 64;
  const y = Math.trunc(cell / 64);
  return x >= 1 && y >= 1 && x < w - 1 && y < h - 1;
}

const MINEABLE: ReadonlySet<number> = new Set([T.WALL, T.WALL_DECO, T.MINE_CRYSTAL, T.MINE_BOULDER]);

/** Hero.handle → HeroAction.Mine: on the mine, with the pickaxe, a wall, vein, crystal or boulder beside the hero. */
export function mineProblem(world: World, hero: Hero, cell: unknown): string | null {
  const level = world.levels[hero.depth];
  if (!level || !isMine(world, level)) return 'there is nothing to mine here';
  if (!hasPickaxe(hero)) return 'you have no pickaxe';
  if (typeof cell !== 'number' || !Number.isInteger(cell) || !adjacent(hero.pos, cell)) return 'too far away';
  return MINEABLE.has(level.map[cell]!) && insideMap(level, cell) ? null : 'there is nothing to mine there';
}

/** Hero.actMine: a turn's work, whatever the rock (the wall's costing three more of hunger). */
export const TIME_TO_MINE = 1;

/**
 * Hero.actMine: a vein gives a piece of dark gold (into the pack, or at the hero's feet) and leaves
 * rubble; plain rock takes effort (three more of hunger); a crystal shatters; a boulder breaks. Breaking
 * anything but a vein shatters the crystals around it as well.
 */
export function mineCell(ctx: Ctx, hero: Hero, cell: number): void {
  const level = ctx.level;
  let crystalAdjacent = NEIGHBOURS8.some((n) => level.map[cell + n] === T.MINE_CRYSTAL);
  const terrain = level.map[cell]!;
  let what: 'gold' | 'wall' | 'crystal' | 'boulder';
  let ore: number | undefined;
  if (terrain === T.WALL_DECO) {
    const gold = createItem('quest.ore');
    if (collect(hero, gold)) ore = hero.items.find((item) => item.kind === 'quest.ore')?.qty;
    else dropItem(ctx.floor, hero.pos, gold);
    level.map[cell] = T.EMPTY_DECO;
    // Mining gold does not break crystals.
    crystalAdjacent = false;
    what = 'gold';
  } else if (terrain === T.WALL) {
    affectHunger(ctx, hero, -3);
    level.map[cell] = T.EMPTY_DECO;
    what = 'wall';
  } else if (terrain === T.MINE_CRYSTAL) {
    level.map[cell] = T.EMPTY;
    what = 'crystal';
  } else {
    level.map[cell] = T.EMPTY_DECO;
    what = 'boulder';
  }
  const shattered: number[] = [];
  if (crystalAdjacent) {
    for (const n of NEIGHBOURS8) {
      if (level.map[cell + n] === T.MINE_CRYSTAL) {
        level.map[cell + n] = T.EMPTY;
        shattered.push(cell + n);
      }
    }
  }
  ctx.effects.push({
    type: 'mined', depth: ctx.depth, pos: cell, hero: hero.id, terrain: what,
    ...(shattered.length > 0 ? { shattered } : {}), ...(ore !== undefined ? { ore } : {}),
  });
}

/* Talking to him */

/**
 * Blacksmith.interact: the first time, his errand (by the hero's class, then the quest's kind), and his
 * pickaxe into the pack (or at the hero's feet); then a reminder until the hero is back up from the
 * mine; then his services while there is anything left to have; then «get lost».
 */
export function talkToBlacksmith(ctx: Ctx, hero: Hero): void {
  const q = ctx.world.smithQuest;
  if (!q) return;
  let line: BlacksmithLine;
  if (!q.given) {
    q.given = true;
    q.completed = false;
    const pick = q.pickaxe ?? newPickaxe();
    if (collect(hero, pick)) ctx.effects.push({ type: 'pickedUp', hero: hero.id, item: pick });
    else dropItem(ctx.floor, hero.pos, pick);
    q.pickaxe = null;
    line = 'intro';
  } else if (!q.completed) {
    line = 'reminder';
  } else if (rewardsAvailable(q)) {
    // In case the run was left while choosing what to smith.
    line = q.smithRewards !== null && q.smiths > 0 ? 'smith' : 'rewards';
  } else {
    line = 'getLost';
  }
  ctx.effects.push({ type: 'blacksmith', hero: hero.id, line, questType: q.type });
}

/**
 * Blacksmith.Quest.complete, as the hero comes back up: the dark gold the party carries is weighed (50
 * favour a piece, 2000 at most) and taken, the pickaxe is given back, the boss is worth 1000 more; the
 * quest's score gains the favour, and from 2500 the pickaxe will be his gift.
 */
export function completeBlacksmith(ctx: Ctx, hero: Hero): void {
  const q = ctx.world.smithQuest;
  if (!q) return;
  q.completed = true;
  q.favor = 0;
  // The whole party comes up together: the ore of each.
  const party = [hero, ...ctx.world.heroes.filter((h) => h !== hero && h.depth === hero.depth && h.hp > 0)];
  let gold = 0;
  for (const h of party) {
    for (const item of h.items) if (item.kind === 'quest.ore') gold += item.qty;
    h.items = h.items.filter((item) => item.kind !== 'quest.ore');
  }
  q.favor += Math.min(2000, gold * 50);
  for (const h of party) {
    const pick = takePickaxe(h);
    if (pick) {
      q.pickaxe = pick;
      break;
    }
  }
  if (q.bossBeaten) q.favor += 1000;
  questScore(ctx.world, 2, q.favor);
  if (q.favor >= 2500) q.freePickaxe = true;
}

/** Blacksmith.Quest.beatBoss. */
export function beatBlacksmithBoss(world: World): void {
  if (world.smithQuest) world.smithQuest.bossBeaten = true;
}

/* His services (WndBlacksmith) */

/** WndReforge's selector: identified, uncursed, upgradable. */
export const canReforge = (world: World, item: Item): boolean => isIdentified(world, item) && !item.cursed && isUpgradable(item);

/** HardenSelector: an identified, uncursed, upgradable weapon or armour not hardened yet. */
export function canHarden(world: World, item: Item): boolean {
  const category = itemDef(item.kind).category;
  return isUpgradable(item) && isIdentified(world, item) && !item.cursed &&
    (category === 'weapon' || category === 'missile' || category === 'armor') && !item.hardened;
}

/** UpgradeSelector: an identified, uncursed, upgradable item below +2. */
export const canUpgrade = (world: World, item: Item): boolean => isUpgradable(item) && isIdentified(world, item) && !item.cursed && item.level < 2;

export function blacksmithProblem(world: World, hero: Hero, action: BlacksmithAction): string | null {
  const q = world.smithQuest;
  if (!q || !questCompleted(q)) return 'the blacksmith will not work for you';
  const smith = world.floors[hero.depth]?.mobs.find((mob) => mob.kind === 'blacksmith');
  if (!smith || !adjacent(smith.pos, hero.pos)) return 'the blacksmith is not here';
  // While items he smithed wait to be chosen, nothing else.
  const choosing = q.smithRewards !== null && q.smiths > 0;
  if (choosing && action.service !== 'pick') return 'choose what he smithed first';
  switch (action.service) {
    case 'pickaxe':
      return q.pickaxe && q.favor >= pickaxeCost(q) ? null : 'not enough favour';
    case 'reforge': {
      if (q.favor < reforgeCost(q)) return 'not enough favour';
      if (action.first === undefined || action.second === undefined) return 'choose two items';
      const a = itemAt(hero, action.first);
      const b = itemAt(hero, action.second);
      if (!a || !b || a === b) return 'choose two different items';
      if (!canReforge(world, a) || !canReforge(world, b)) return 'these cannot be reforged';
      return a.kind === b.kind ? null : 'choose two items of the same kind';
    }
    case 'harden': {
      if (q.favor < hardenCost(q)) return 'not enough favour';
      const item = action.item === undefined ? undefined : itemAt(hero, action.item);
      return item && canHarden(world, item) ? null : 'that cannot be hardened';
    }
    case 'upgrade': {
      if (q.favor < upgradeCost(q)) return 'not enough favour';
      const item = action.item === undefined ? undefined : itemAt(hero, action.item);
      return item && canUpgrade(world, item) ? null : 'that cannot be upgraded';
    }
    case 'smith':
      return q.favor >= SMITH_COST ? null : 'not enough favour';
    case 'pick':
      if (!choosing) return 'nothing to choose';
      return Number.isInteger(action.choice) && action.choice! >= 0 && action.choice! < q.smithRewards!.length ? null : 'bad choice';
    case 'cashout':
      return q.favor > 0 ? null : 'not enough favour';
    default:
      return 'bad choice';
  }
}

/** Gives an item to the hero: into the pack, or at their feet. */
function give(ctx: Ctx, hero: Hero, item: Item): void {
  if (collect(hero, item)) ctx.effects.push({ type: 'pickedUp', hero: hero.id, item });
  else dropItem(ctx.floor, hero.pos, item);
}

/** A service done: none takes any time (the windows are the hero's). */
export function blacksmithService(ctx: Ctx, hero: Hero, action: BlacksmithAction): void {
  const q = ctx.world.smithQuest!;
  let item: Item | undefined;
  switch (action.service) {
    case 'pickaxe': {
      const cost = pickaxeCost(q);
      item = q.pickaxe!;
      give(ctx, hero, item);
      q.favor -= cost;
      q.pickaxe = null;
      break;
    }
    case 'reforge':
      item = reforge(ctx, hero, action.first!, action.second!);
      q.favor -= reforgeCost(q);
      q.reforges++;
      break;
    case 'harden':
      item = itemAt(hero, action.item!)!;
      item.hardened = true;
      q.favor -= hardenCost(q);
      q.hardens++;
      break;
    case 'upgrade':
      item = itemAt(hero, action.item!)!;
      upgradeOnce(item);
      q.favor -= upgradeCost(q);
      q.upgrades++;
      ctx.effects.push({ type: 'upgraded', hero: hero.id, item });
      break;
    case 'smith':
      q.favor -= SMITH_COST;
      q.smiths++;
      // WndSmith: the items are smithed anew if the last lot was taken (the decks left alone).
      if (!q.smithRewards || q.smithRewards.length === 0) {
        const world = ctx.world;
        Random.using(ctx.rng, () => Dungeon.generating({ depth: hero.depth, branch: 0, run: world.run, world }, () => generateRewards(q)));
      }
      ctx.effects.push({ type: 'blacksmith', hero: hero.id, line: 'smith', questType: q.type, service: 'smith' });
      return;
    case 'pick': {
      item = q.smithRewards![action.choice!]!;
      const category = itemDef(item.kind).category;
      if ((category === 'weapon' || category === 'missile') && q.smithEnchant) item.enchant = q.smithEnchant;
      else if (category === 'armor' && q.smithGlyph) item.glyph = q.smithGlyph;
      identify(ctx.world, item);
      give(ctx, hero, item);
      q.smithRewards = null;
      break;
    }
    case 'cashout':
      give(ctx, hero, createItem('gold', q.favor));
      q.favor = 0;
      break;
  }
  ctx.effects.push({ type: 'blacksmith', hero: hero.id, line: 'service', questType: q.type, service: action.service, ...(item ? { item } : {}) });
}

/** Item.upgrade: a level more; uncursed (Weapon/Armor.upgrade), mended, a wand's charge as well. */
function upgradeOnce(item: Item): void {
  delete item.cursed;
  delete item.curseUnknown;
  item.level++;
  mend(item);
  if (item.charges !== undefined) item.charges = Math.min(item.charges + 1, wandMaxCharges(item));
}

/**
 * WndReforge: of two items of one kind, the one of the higher level (the first chosen, if level) comes out
 * a level better, keeping its enchantment or glyph; the other is used up — taken off first if worn (a
 * worn armour, which cannot be left empty here, gives its place to the better one), its warrior's seal
 * left at the hero's feet.
 */
function reforge(ctx: Ctx, hero: Hero, firstRef: ItemRef, secondRef: ItemRef): Item {
  let betterRef = firstRef;
  let worseRef = secondRef;
  if (itemAt(hero, secondRef)!.level > itemAt(hero, firstRef)!.level) [betterRef, worseRef] = [secondRef, firstRef];
  const better = itemAt(hero, betterRef)!;
  const worse = itemAt(hero, worseRef)!;
  if (worse.seal) {
    dropItem(ctx.floor, hero.pos, createItem('seal', 1, worse.seal.level));
    delete worse.seal;
  }
  if (typeof worseRef === 'number') {
    hero.items.splice(worseRef, 1);
  } else if (worseRef === 'weapon') {
    hero.weapon = null;
  } else if (worseRef === 'artifact' || worseRef === 'misc' || worseRef === 'ring') {
    hero[worseRef] = null;
  } else {
    // The worn armour goes: the better one, from the pack, is put on in its place.
    hero.items.splice(betterRef as number, 1);
    hero.armor = better;
  }
  upgradeOnce(better);
  ctx.effects.push({ type: 'upgraded', hero: hero.id, item: better });
  return better;
}

/* The ways down to the mine and back (CavesLevel and MiningLevel.activateTransition) */

const previousEnter = BRANCH_GATES.enter;
const previousLeave = BRANCH_GATES.leave;
const previousTaken = BRANCH_GATES.taken;

/** Whether a level is the smithy's depth (its main level). */
const smithyLevel = (world: World, level: Level): boolean => !level.branch && world.smithQuest?.depth === level.depth;

/**
 * CavesLevel.activateTransition: the way down only for an errand given and not done: «the way down is
 * blocked» without one; the pickaxe asked after if lost («Where is my pickaxe?!»); the first time, the
 * client asks first (quest_start_prompt) and taking the way starts the quest.
 */
BRANCH_GATES.enter = (world, hero, level) => {
  if (!smithyLevel(world, level)) return previousEnter(world, hero, level);
  const q = world.smithQuest!;
  if (!q.given || q.completed || !q.started) {
    const smith = world.floors[level.depth]?.mobs.some((mob) => mob.kind === 'blacksmith');
    if (!smith || !q.given || q.completed) return 'the way down is blocked';
    if (!hasPickaxe(hero)) return 'where is my pickaxe';
  }
  return null;
};

/** MiningLevel.activateTransition: up only with the pickaxe (the client warns of the gold first; it is the last way up). */
BRANCH_GATES.leave = (world, hero, level) => {
  if (!isMine(world, level)) return previousLeave(world, hero, level);
  const q = world.smithQuest;
  if (q && !questCompleted(q) && !hasPickaxe(hero)) return 'where is my pickaxe';
  return null;
};

BRANCH_GATES.taken = (ctx, hero, toBranch) => {
  const q = ctx.world.smithQuest;
  if (q && toBranch === 1 && smithyLevel(ctx.world, ctx.level)) q.started = true;
  else if (q && toBranch === 0 && isMine(ctx.world, ctx.level) && !questCompleted(q)) completeBlacksmith(ctx, hero);
  else previousTaken(ctx, hero, toBranch);
};
