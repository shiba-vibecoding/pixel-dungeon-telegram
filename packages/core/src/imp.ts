import { type Hero, isAlive, type Mob } from './actors';
import { BRANCH_GATES } from './branchgates';
import { type Ctx, dropItem, heroesOn, heroView } from './floor';
import { createItem, type Item, itemDef, randomEnchantment, randomGlyph, wandMaxCharges } from './items';
import type { Level } from './level/generate';
import { castShadow, terrainBlocksSight, viewDistance } from './fov';
import { adjacent } from './level/geometry';
import { Dungeon } from './level/gen/dungeon';
import { Generator } from './level/gen/generator';
import { QuestHooks } from './level/gen/quests';
import { Random } from './level/gen/random';
import type { Room } from './level/gen/room';
import { AmbitiousImpRoom } from './level/gen/rooms/quest/ambitious-imp';
import { addQuestScore } from './quest';
import type { StoredBelongings } from './vault-types';
import type { World } from './world';

/*
 * The ambitious imp of the dwarven city (Imp and Imp.Quest), as Shattered v4 has him: once a run, on
 * depth 17, 18 or 19 (the deeper, the likelier), his room stands over the sealed entrance of an old
 * dwarven vault (AmbitiousImpRoom). He asks the hero to go down for an obsidian statuette of him; his
 * spell takes the hero in, but none of their gear: he keeps it, and gives them cloth armour and an
 * escape crystal, which brings them back with one thing from the vault, as good as how well they did
 * (vault.ts). The imp's reward is that pick, among the vault's treasure (rolled here): an artifact or a
 * ring, another ring, two enchanted weapons, plate armour and a wand. Well done (over 2000 points), he
 * packs up and opens his shop by the King's throne (ImpShopRoom: the bosses' part, `impEarnedShop`).
 */

export interface ImpQuest {
  /** The depth of his room. */
  depth: number;
  /** He has asked (Imp.Quest.given); the vault is open to the hero. */
  given: boolean;
  /** The hero came back from the vault (Imp.Quest.completed). */
  done: boolean;
  /** Imp.Quest.score: how well the heist went (not the run's score: no penalties here). */
  score: number;
  /** Imp.Quest.rewardOptions: the treasure the final room holds, until the vault is made. */
  rewardOptions: Item[];
  /** Imp.Quest.reward: what the hero kept, held by the imp while their pack was full. */
  reward?: Item | null;
  /** Imp.Quest.hazardFreebies: hits from the vault's hazards that cost the quest's score nothing. */
  hazardFreebies: number;
  /** Imp.Quest.mirrorUsed: the strange mirror's item was taken (more tokens are thrown away). */
  mirrorUsed: boolean;
  /** EscapeCrystal.storedItems: each hero's belongings, kept while they are in the vault. */
  stored?: Record<string, StoredBelongings>;
  /** Statistics.vaultInjureWarned: the imp's word about being badly hurt was said (once a run). */
  injureWarned?: boolean;
}

/** What the imp says: his errand, a reminder, his thanks (as well as it went); his «psst» and «see you». */
export type ImpLine = 'intro' | 'inProgress' | 'completedBad' | 'completedGood' | 'completedGreat' | 'hey' | 'cya';

/** Imp.Quest.isCompleted and earnedShop: done, and well enough for his shop by the King (CityBossLevel, ImpShopRoom). */
export const impEarnedShop = (world: World): boolean => world.impQuest?.done === true && world.impQuest.score > 2000;

/** Item.identify(false): its level and curse known (a wand's charges too). */
function knownLevel(item: Item): Item {
  delete item.levelUnknown;
  delete item.curseUnknown;
  delete item.chargesUnknown;
  delete item.usesLeftToID;
  delete item.availableUsesToID;
  return item;
}

/**
 * Imp.Quest.spawn (CityLevel.initRooms): past depth 16, one chance in (20 - depth), once a run, his room;
 * and the treasure the vault holds for him. SEAM(artifacts): Generator.randomArtifact is null for now,
 * so a ring +2 to +4 stands first (its level known only once the elemental falls).
 */
export function spawnImpRoom(rooms: Room[]): Room[] {
  const world = Dungeon.world;
  if (!world || Dungeon.branch !== 0) return rooms;
  // The level built again (Level.create's retries): his room again, his errand as it was rolled.
  if (world.impQuest) {
    if (world.impQuest.depth === Dungeon.depth) rooms.push(new AmbitiousImpRoom());
    return rooms;
  }
  if (Dungeon.depth <= 16 || Random.Int(20 - Dungeon.depth) !== 0) return rooms;
  rooms.push(new AmbitiousImpRoom());

  const options: Item[] = [];
  let artif = Generator.randomArtifact();
  if (artif) {
    knownLevel(artif);
  } else {
    artif = Generator.random('RING');
    // The ring's identification waits for the boss to be defeated.
    artif.level = Random.IntRange(2, 4);
  }
  options.push(artif);
  let ring: Item;
  do {
    ring = Generator.random('RING');
  } while (ring.kind === artif.kind);
  ring.level = Random.IntRange(2, 4);
  options.push(ring);

  const weapon = (category: 'WEP_T4' | 'WEP_T5' | 'MIS_T4' | 'MIS_T5', min: number, max: number): Item => {
    const item = Generator.random(category);
    item.enchant = randomEnchantment(Random.rng, item.enchant);
    knownLevel(item);
    item.level = Random.IntRange(min, max);
    return item;
  };
  if (Random.Int(2) === 0) {
    options.push(weapon('WEP_T5', 2, 4));
    options.push(weapon('MIS_T4', 3, 5));
  } else {
    options.push(weapon('MIS_T5', 2, 4));
    options.push(weapon('WEP_T4', 3, 5));
  }
  const plate = createItem('armor.plate');
  plate.glyph = randomGlyph(Random.rng);
  knownLevel(plate);
  plate.level = Random.IntRange(2, 4);
  options.push(plate);
  const wand = Generator.random('WAND');
  knownLevel(wand);
  wand.level = Random.IntRange(2, 4);
  wand.charges = wandMaxCharges(wand);
  options.push(wand);
  for (const item of options) delete item.cursed;

  world.impQuest = {
    depth: Dungeon.depth, given: false, done: false, score: 0, rewardOptions: options, reward: null, hazardFreebies: 2, mirrorUsed: false,
  };
  return rooms;
}

QuestHooks.imp = spawnImpRoom;

/**
 * Imp.interact: the first time, his errand (WndQuest: quest_intro_1, then quest_intro_2 once read), and
 * the vault is open; then that he is waiting; done, his thanks, which say how well it went.
 */
export function talkToImp(ctx: Ctx, hero: Hero): void {
  const quest = ctx.world.impQuest;
  if (!quest) return;
  let line: ImpLine;
  if (!quest.given) {
    quest.given = true;
    quest.done = false;
    line = 'intro';
  } else if (!quest.done) {
    line = 'inProgress';
  } else {
    line = quest.score <= 2000 ? 'completedBad' : quest.score < 4000 ? 'completedGood' : 'completedGreat';
  }
  ctx.effects.push({ type: 'imp', hero: hero.id, line });
}

/**
 * Imp.act: the reward he holds (the hero's pack was full) he puts down by him; done and pleased, he
 * leaves as soon as the hero is out of his sight («See you»); before his errand is given, he calls out
 * to a hero who comes into sight («Psst»), once each time.
 */
export function impAct(ctx: Ctx, imp: Mob): void {
  imp.time += 1;
  const quest = ctx.world.impQuest;
  if (!quest) return;
  if (quest.done && quest.reward) {
    dropItem(ctx.floor, imp.pos, quest.reward);
    quest.reward = null;
  }
  const hero = heroesOn(ctx.world, ctx.depth)[0];
  if (!hero) return;
  if (quest.done && quest.score > 2000) {
    const fov = castShadow(imp.pos, terrainBlocksSight(ctx.level.map), viewDistance(ctx.depth));
    if (!fov[hero.pos]) {
      ctx.effects.push({ type: 'imp', hero: hero.id, line: 'cya' });
      ctx.floor.mobs.splice(ctx.floor.mobs.indexOf(imp), 1);
      ctx.effects.push({ type: 'faded', depth: ctx.depth, mob: imp.id, pos: imp.pos });
    }
    return;
  }
  const explored = ctx.world.explored[ctx.depth];
  if (!quest.given && explored?.[imp.pos]) {
    const seen = heroesOn(ctx.world, ctx.depth).find((h) => heroView(ctx.world, h)[imp.pos]);
    if (!imp.greeted && seen) {
      ctx.effects.push({ type: 'imp', hero: seen.id, line: 'hey' });
      imp.greeted = true;
    }
  } else {
    imp.greeted = false;
  }
}

/** Imp.Quest.complete: the heist's score, added to the run's (Statistics.questScores[3]). */
export function completeImpQuest(world: World, score: number): void {
  const quest = world.impQuest!;
  quest.done = true;
  quest.score = score;
  addQuestScore(world, 3, score);
}

/** Whether a level is the one with the imp's room (CityLevel with AmbitiousImpRoom). */
const impLevel = (world: World, level: Level): boolean => !level.branch && world.impQuest?.depth === level.depth;

/**
 * CityLevel.activateTransition for the imp's pit: closed until his errand is given, and once it is done
 * (SEAM(challenges): nor under the ascension challenge or with lost inventory, neither of which is here yet).
 * Other levels' ways go to whatever the other quests decide.
 */
const enterBefore = BRANCH_GATES.enter;
BRANCH_GATES.enter = (world, hero, level) => {
  if (!impLevel(world, level)) return enterBefore(world, hero, level);
  const quest = world.impQuest!;
  if (!quest.given) return 'the vault is sealed';
  if (quest.done) return 'the vault is sealed';
  return null;
};

/** Hero.live: every passing ailment and boon ends, hunger and regeneration start afresh. */
export function heroLives(hero: Hero): void {
  Object.assign(hero, {
    regen: 0, ooze: -1, poison: 0, burning: 0, paralysed: 0, rooted: 0, slowed: 0, weakened: 0, crippled: 0, light: 0, charmed: 0,
    charmedBy: null, dizzy: 0, mindVision: 0, invisible: 0, hunger: 0, combo: 0, comboUntil: 0, barkskin: 0,
  });
  for (const key of ['sungrass', 'earthroot', 'deferred', 'blind', 'bleeding', 'marked', 'levitating', 'gasImmune', 'starve', 'blessed', 'lockedFloor', 'sealShield'] as const) {
    delete hero[key];
  }
}

/**
 * CityLevel.activateTransition, on going down: the hero is made whole (Hero.live, full health), their
 * belongings go into the imp's keeping (EscapeCrystal.storeHeroBelongings: gear, pack and gold), and
 * they go in with cloth armour and the escape crystal.
 */
export function enterVault(world: World, hero: Hero): void {
  const quest = world.impQuest;
  if (!quest || !isAlive(hero)) return;
  heroLives(hero);
  hero.hp = hero.ht;
  const stored = (quest.stored ??= {});
  if (!stored[hero.id]) {
    stored[hero.id] = { weapon: hero.weapon, armor: hero.armor, rings: hero.rings, items: hero.items, gold: hero.gold };
    hero.weapon = null;
    hero.rings = [];
    hero.items = [];
    hero.gold = 0;
  } else {
    hero.items = hero.items.filter((item) => item.kind !== 'quest.escapeCrystal');
  }
  hero.items.unshift(createItem('quest.escapeCrystal'));
  hero.armor = createItem('armor.cloth');
}

const takenBefore = BRANCH_GATES.taken;
BRANCH_GATES.taken = (ctx, hero, toBranch) => {
  if (toBranch === 1 && ctx.world.impQuest?.depth === hero.depth) enterVault(ctx.world, hero);
  else takenBefore(ctx, hero, toBranch);
};

/** The imp beside a hero (to talk to). */
export const impBeside = (world: World, hero: Hero): Mob | undefined =>
  world.floors[hero.depth]?.mobs.find((mob) => mob.kind === 'imp' && adjacent(mob.pos, hero.pos));

/** Whether an item is one of a kind (Item.unique): never taken out of the vault, nor dropped in a pile of others. */
export function isUnique(item: Item): boolean {
  if (item.unique) return true;
  const category = itemDef(item.kind).category;
  return category === 'quest' || category === 'key' || category === 'seal' || category === 'vial' || category === 'bag';
}
