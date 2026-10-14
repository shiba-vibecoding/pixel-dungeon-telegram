import { hasGlyph } from './classes/state';
import { wear } from './wear';
import { talentTime, beforeHeroAct, consumeLethalMomentum } from './talents/turns';
import { hasTalent, pointsInTalent, type TalentId, upgradeProblem } from './talents/data';
import { upgradeTalent } from './talents';
import { berserkProblem, doBerserk } from './talents/berserk';
import { type ComboMove, comboProblem, useComboMove } from './talents/combo';
import { ambush as heroAmbush, ambushProblem, doFreerun, freerunProblem, gainMomentum } from './talents/rogue';
import { snipe, snipeProblem } from './talents/huntress';
import { holdFastRest } from './talents/hold-fast';
import { foresightHint, layCachedRations } from './talents/rogue';
import { onGrassTrampled, onHeroMovedOnGrass } from './talents/nature';
import { identifyBelongings, observeBelongings } from './ident';
import { mobAct, populate, randomRespawnCell, reinforce, respawn, TIME_TO_RESPAWN } from './ai';
import {
  createHero, createMob, type Footing, type Hero, heroAttackDelay, heroBelongings, heroReach, heroRings, heroSpeed, isAlive, isShopkeeper,
  type Mob, type MobKind, type PlayerInfo,
  ringBonus,
} from './actors';
import { camouflage, isEnemy } from './enchant';
import { canReach, gearTick } from './throwing';
import { heroTurns, search, TIME_TO_SEARCH } from './hero';
import { startingKit } from './heroclass';
import { type Note, noteLandmarks } from './journal';
import type { LimitedDrop } from './mobs';
import { bleedTick } from './afflict';
import { ambush } from './mobskills';
import { attack, CRIPPLE_TURNS, hurt } from './combat';
import {
  canEnter, type Char, charAt, type Ctx, dropItem, type Effect, enterCell, exploredCells, type Floor, freeCellNear, heroesOn,
  heroView, isPassable, isWater, leaveCell, observe,
  swapsWithHero,
} from './floor';
import { inventoryProblem, isInventoryAction, type InventoryAction, performInventory } from './inventory';
import { type Bones, layBones } from './bones';
import { createItem, createItems, type Heap, ItemGenerator, type ItemKind, randomDropCell, shareOfDepth } from './items';
import { inBag } from './bags';
import { chargeWands, staffReach } from './wands';
import { heroStatusTime, timeScale } from './status';
import { cursedTurn } from './cursed';
import { allySwaps, dismiss, dismissProblem } from './allies';
import { staggerTarget, stepOnPlant, sungrassHeals } from './plants';
import { discoverable } from './level/flags';
import { faceCurse, faceCurseProblem, type GhostQuest, rewardFromGhost, rewardProblem, spawnGhost, talkToGhost } from './quest';
import { trapAt, triggerTrap } from './traps';
import { evolveGas } from './gas';
import { levelSpan, partySize, regrowBoss, scaleMob } from './party';
import { scorchPack } from './cooking';
import { altarMarksHero } from './altar';
import { type ImpQuest, impRewardProblem, ringFromImp, spawnImp, talkToImp } from './imp';
import { type ItemRef, reforge, reforgeProblem, type SmithQuest, spawnBlacksmith, talkToSmith } from './smith';
import { spawnWandmaker, talkToWandmaker, type WandQuest, wandFromWandmaker, wandRewardProblem } from './wandmaker';
import { isBossDepth, LAST_SHOP_DEPTH } from './level/builder';
import { type ClassAction, classProblem, isClassAction, performClass } from './classes/actions';
import { settleTimers } from './classes/state';
import { greaterHasteMove, onRest } from './classes/duelist-talents';
import { generateLevel, type Level } from './level/generate';
import { adjacent, cellX, cellY, distance, HEIGHT, LENGTH, NEIGHBOURS8, WIDTH } from './level/geometry';
import { RoomType } from './level/room';
import { discover, F, hasFlag, T } from './level/terrain';
import { deriveSeed, Rng, seedRng, Stream } from './rng';
import { createRun, type RunState } from './run';
import { isChallenged, NO_HERBALISM, underChallenges } from './challenges';
import { bossFloorCreated, bossOccupy, bossTimedTurn, nextBossTimed, oozeTurn, type Timed } from './bosses/index';
import { chillFactor, hungerPaused, tickHero } from './buffs';
import { burnFuses, nextFuse } from './bombs';
import { levelTrinkets, PETRIFIED_SEED, SALT_CUBE, trinketLevel } from './trinkets';
import { arenaJoined, arenaLevelAt, arenaPick, arenaProblem, arenaReady, type ArenaState, arenaTurn, newArena } from './arena';
import {
  type ArtifactAction, artifactProblem, artifactsAct, artifactsTime, carriedOf, chaliceRegenDelay, disarmPresses, freezeTime, frozenBy,
  ghostFollows, ghostSeesBoss, ghostSays, heroPress, naturalism, performArtifact, petalsFor, talismanBlinds, talismanFound,
} from './artifacts';
import type { ScoreState } from './score';
import { abilityProblem, alliesFollow, copyReach, endEnduring, swapWithClone, useAbility } from './abilities';

/*
 * The shared game world. Every change goes through act(), so a server can run
 * the authoritative copy while clients replay the same calls.
 *
 * Time works as in the original's Actor queue, with one clock per depth:
 * whoever is due next acts. A player's action is stored as the hero's intent
 * and performed when that hero's turn comes; monsters act on their own. When
 * the hero who is due has no intent but a companion on the same depth is
 * waiting, a hero with no awake monster in sight simply rests, so exploring
 * never stalls. A hero in danger does hold the others up; the server decides
 * how long to wait for them (see blockers()).
 */

export type Action =
  | { type: 'move'; to: number }
  | { type: 'attack'; target: string }
  | { type: 'descend' }
  | { type: 'ascend' }
  /** Into the chasm next to the hero, down to the depth below. */
  | { type: 'jump'; to: number }
  | { type: 'wait' }
  | { type: 'search' }
  /** The sad ghost's reward, for its rose. */
  | { type: 'reward'; choice: 'weapon' | 'armor' }
  /** The ambitious imp's reward, for the tokens. */
  | { type: 'impReward' }
  /** The troll blacksmith's service: two items of a kind reforged into one, better. */
  | { type: 'reforge'; first: ItemRef; second: ItemRef }
  /** The old wandmaker's reward: a battle wand or a useful one. */
  | { type: 'wandReward'; choice: 'battle' | 'utility' }
  /** Agree to free the sad ghost of its curse, and face it. */
  | { type: 'faceCurse' }
  /** Ward.interact's «dismiss»: the ward beside the hero is gone. */
  | { type: 'dismiss'; target: string }
  /**
   * The armour ability of the class armour worn (ClassArmor.execute, abilities/): `target` the cell it is aimed at where it
   * asks for one, `choice` the warp beacon's (0 warp to it, 1 clear it).
   */
  | { type: 'special'; target?: number; choice?: number }
  /** The Amulet of Yendor's «Let's call it a day»: the party wins here. */
  | { type: 'endGame' }
  /** Live turns: what the hero is to do from now on, a turn at a time (an empty plan stops them). */
  | { type: 'plan'; steps: PlanStep[] }
  /** An artifact's action (artifacts/): Lloyd's beacon's setting and returning among them. */
  | ArtifactAction
  /** Hero.upgradeTalent: a free point put in a talent (no time passes). */
  | { type: 'talent'; talent: TalentId }
  /**
   * The subclasses' action indicator (ActionIndicator.Action.doAction): the berserker goes berserk; the freerunner
   * freeruns; the gladiator makes a combo move at a target; the assassin strikes from the shadows at a target (blinking
   * to it); the sniper fires the mark's special shot.
   */
  | { type: 'ability'; ability: 'berserk' | 'freerun' | 'snipe' }
  | { type: 'ability'; ability: 'combo'; move: ComboMove; target?: string }
  | { type: 'ability'; ability: 'ambush'; target: string }
  /**
   * The arena of waves: «To battle!» once the party has rested (or, `cancel`, not ready after all), and
   * one of the three rewards after a wave.
   */
  | { type: 'arenaReady'; cancel?: boolean }
  | { type: 'arenaPick'; choice: number }
  | InventoryAction
  /** The Duelist's and the Cleric's own: talents, weapon abilities, spells (classes/actions.ts). */
  | ClassAction;

export type ActionResult = { ok: true; effects: Effect[] } | { ok: false; reason: string };

export interface World {
  run: RunState;
  /** Generated levels by depth; depths are always generated in order. */
  levels: Record<number, Level>;
  /** The live state of every generated depth. */
  floors: Record<number, Floor>;
  heroes: Hero[];
  /** Cells the party has seen, per depth; shared by all heroes. */
  explored: Record<number, boolean[]>;
  /** The deepest depth any hero has stood on (absent in older saves); fallen heroes get up only below it. */
  reached?: number;
  /** Accepted actions so far. */
  turn: number;
  /** Last monster id handed out. */
  nextId: number;
  /** The run has ended: every hero has fallen, or the party won. */
  over: boolean;
  /** The party has won: a hero with the Amulet of Yendor called it a day, or carried it out to the surface. */
  victory: boolean;
  /**
   * Live turns (co-op and the arena): the world goes on by a clock (liveTick, a turn a tick) instead of waiting
   * for each player's move, and a player's action is a standing order (Hero.plan). Absent: classic turns.
   */
  live?: boolean;
  /** How the run was won: the Amulet's own end, or the way out to the surface (the original's «Happy end»). */
  ending?: 'amulet' | 'surface';
  /** Alchemical energy (Dungeon.energy): energy crystals picked up and items turned into energy, spent at the pot. */
  energy?: number;
  /**
   * Night when the run began (DimensionalSundial reads the clock; a checked run cannot): set by whoever starts
   * the run, day when absent. A seam for the server.
   */
  night?: boolean;
  /** The daily dungeon's boon the hero set out with (daily.ts), for the screens. */
  boon?: string;
  /** Statistics.bossScores and questScores (score.ts): what the bosses beaten and the errands done have earned, less avoidable hits; absent until the first. */
  score?: ScoreState;
  /** The Amulet of Yendor has been taken up (Statistics.amuletObtained): its question is asked once. */
  amuletTaken?: boolean;
  /** A fallen hero's bones from an earlier run on this device, for their depth to hold (bones.ts; solo only). */
  bones?: Bones;
  /** The run's challenges (Challenges.java masks, see challenges.ts); worlds saved before them have none. */
  challenges: number;
  /** Potion and scroll kinds the party has identified; knowledge is shared. */
  known: ItemKind[];
  /** The sad ghost's quest, once the ghost has appeared. */
  quest: GhostQuest | null;
  /** The old wandmaker's errand, once he has appeared. */
  wandQuest: WandQuest | null;
  /** The ambitious imp's errand, once he has appeared (absent in older saves). */
  impQuest?: ImpQuest | null;
  /** The troll blacksmith's errand, once his forge is found (absent in older saves). */
  smithQuest?: SmithQuest | null;
  /** What kind of run this is: the arena of waves (arena.ts); absent, the dungeon. */
  mode?: 'arena';
  /** The arena of waves' state, in an arena run. */
  arena?: ArenaState;
  /** The journal's notes of what the party has come across (journal.ts; absent until the first). */
  notes?: Note[];
  /** Dungeon.LimitedDrops kept by the monsters (mobs.ts): how many of each drop have come so far. */
  limitedDrops?: Partial<Record<LimitedDrop, number>>;
  /** Dungeon.mobsToChampion: monsters still to come before the next champion (CHAMPION_ENEMIES; spawner.ts). */
  mobsToChampion?: number;
  /** The bestiary (Bestiary.setSeen, countEncounter): monsters the party has seen, and how many of each were slain. */
  bestiary?: Partial<Record<MobKind, { seen: boolean; slain: number }>>;
}

/** The kinds of run: down the dungeon, or the arena of waves. */
export type GameMode = 'dungeon' | 'arena';

/** The Amulet's hall (LastLevel), the bottom of the dungeon: no chasm opens onto it, and nothing lies below. */
export const DEEPEST_AVAILABLE = 26;
const TIME_TO_REST = 1;
/** Blacksmith.upgrade: the hero waits while the troll works. */
const TIME_TO_REFORGE = 2;
/** Sub-stream of a depth's monster stream for the sad ghost. */
const GHOST_STREAM = 1;
const WANDMAKER_STREAM = 2;
const IMP_STREAM = 3;
const BLACKSMITH_STREAM = 4;
const BONES_STREAM = 5;
/** Sub-stream of a depth's item stream for the artifacts' pieces: the rose's petals, the hourglass's sandbags. */
const ARTIFACT_STREAM = 6;
/** Sub-stream of a depth's item stream for the talents' finds (cached rations). */
const TALENT_STREAM = 7;
/** Sub-streams of a depth's streams for a hero joining the party, by party size. */
const JOIN_STREAM = 100;

/**
 * A new run; `challenges` is a bitmask of CHALLENGES (Dungeon.challenges), 0 for none; `mode`
 * makes it the arena of waves rather than the dungeon.
 */
export function createWorld(seed: number, challenges = 0, mode: GameMode = 'dungeon', live = false): World {
  return {
    run: createRun(seed), levels: {}, floors: {}, heroes: [], explored: {}, turn: 0, nextId: 0, over: false, victory: false,
    challenges, known: [], quest: null, wandQuest: null, impQuest: null, smithQuest: null,
    ...(mode === 'arena' ? { mode, arena: newArena() } : {}),
    ...(live ? { live } : {}),
  };
}

/** Starts a new run in place for the same party, under the same challenges. */
export function restartWorld(world: World, seed: number): void {
  const party = world.heroes.map(({ id, name, heroClass }) => ({ id, name, heroClass }));
  const mode = world.mode ?? 'dungeon';
  const live = world.live ?? false;
  for (const key of ['mode', 'arena', 'live'] as const) delete world[key];
  Object.assign(world, createWorld(seed, world.challenges ?? 0, mode, live));
  for (const player of party) addHero(world, player);
}

/** Hands a world a fallen hero's bones (bones.ts): laid at once if their depth is made already (the first is, as soon as a hero arrives). */
export function giveBones(world: World, bones: Bones): void {
  world.bones = bones;
  const level = world.levels[bones.depth];
  if (level) layBones(bones, level, world.floors[bones.depth]!, Rng.seeded(deriveSeed(world.run.seed, Stream.ITEMS, bones.depth, BONES_STREAM)), world.run);
}

export function levelAt(world: World, depth: number): Level {
  if (world.mode === 'arena') return arenaLevelAt(world, depth);
  for (let d = 1; d <= depth; d++) {
    if (!world.levels[d]) {
      // A party's depths spread wider, with more rooms (party.ts); boss levels keep their layout.
      // The last shop opens only once the imp's errand is done (LastShopLevel.build).
      // SEAM(levels): the imp's shop is the Dwarf King's level's now (CityBossLevel); depth 21 becomes a halls level.
      const level = generateLevel(world.run, d, levelSpan(partySize(world)), false);
      world.levels[d] = level;
      const mobs = populate(world, level, Rng.seeded(deriveSeed(world.run.seed, Stream.MOBS, d)));
      // What the depth gives every hero, so that a hero who joins later gets theirs (party.ts).
      const found = { strength: world.run.strengthFound, upgrades: world.run.upgradesFound };
      spawnGhost(world, level, mobs, Rng.seeded(deriveSeed(world.run.seed, Stream.MOBS, d, GHOST_STREAM)));
      spawnWandmaker(world, level, mobs, Rng.seeded(deriveSeed(world.run.seed, Stream.MOBS, d, WANDMAKER_STREAM)));
      spawnImp(world, level, mobs, Rng.seeded(deriveSeed(world.run.seed, Stream.MOBS, d, IMP_STREAM)));
      spawnBlacksmith(world, level, mobs, Rng.seeded(deriveSeed(world.run.seed, Stream.MOBS, d, BLACKSMITH_STREAM)));
      world.floors[d] = {
        mobs,
        rng: seedRng(deriveSeed(world.run.seed, Stream.PLAY, d)),
        now: 0,
        plants: [...(level.plants ?? [])],
        ...(level.altar ? { altar: { ...level.altar } } : {}),
        // Boss levels, the last shop's (LastShopLevel.respawner and createItems) and the Amulet's hall
        // never fill up again, and hold only what their layout asks for.
        respawn: quietDepth(d) ? -1 : TIME_TO_RESPAWN,
        heaps: createItems(
          world.run, level, Rng.seeded(deriveSeed(world.run.seed, Stream.ITEMS, d)), quietDepth(d), world.heroes.length,
          (item) => underChallenges(world, item), levelTrinkets(world),
        ),
      };
      // A boss level's own (the imp's wares on the King's level).
      bossFloorCreated(level, world.floors[d]!, Rng.seeded(deriveSeed(world.run.seed, Stream.ITEMS, d, IMP_STREAM)));
      if (world.bones && !world.bones.placed && world.bones.depth === d) {
        layBones(world.bones, level, world.floors[d]!, Rng.seeded(deriveSeed(world.run.seed, Stream.ITEMS, d, BONES_STREAM)), world.run);
      }
      layArtifactPieces(world, level, world.floors[d]!, Rng.seeded(deriveSeed(world.run.seed, Stream.ITEMS, d, ARTIFACT_STREAM)));
      if (!quietDepth(d)) layCachedRations(world, level, world.floors[d]!, Rng.seeded(deriveSeed(world.run.seed, Stream.ITEMS, d, TALENT_STREAM)));
      const perHero: ItemKind[] = [
        ...(world.run.strengthFound > found.strength ? ['potion.strength' as const] : []),
        ...(world.run.upgradesFound > found.upgrades ? ['scroll.upgrade' as const] : []),
      ];
      if (perHero.length > 0) world.floors[d]!.perHero = perHero;
    }
  }
  return world.levels[depth]!;
}

/**
 * What a hero's artifacts find on a new depth. RegularLevel.createItems: a rose whose ghost is free sheds a
 * petal about every two depths. ShopRoom.generateItems: a shop sells sandbags to whoever carries the
 * hourglass, more of those still missing the deeper the shop.
 */
function layArtifactPieces(world: World, level: Level, floor: Floor, rng: Rng): void {
  const d = level.depth;
  if (!quietDepth(d) && world.mode !== 'arena') {
    for (let i = petalsFor(world, d); i > 0; i--) {
      const pos = randomDropCell(rng, level);
      if (pos >= 0) floor.heaps.push({ pos, kind: 'heap', items: [createItem('petal')] });
    }
  }
  const shares: Record<number, number> = { 6: 0.2, 11: 0.25, 16: 0.5, 20: 0.8, 21: 0.8 };
  const share = shares[d];
  const keeper = floor.mobs.find((mob) => isShopkeeper(mob));
  if (share === undefined || !keeper || level.shopkeeper === undefined) return;
  const hero = world.heroes.find((h) => carriedOf(h, 'artifact.hourglass'));
  const hourglass = hero ? carriedOf(hero, 'artifact.hourglass') : undefined;
  if (!hourglass || hourglass.levelUnknown || hourglass.curseUnknown || hourglass.cursed) return;
  const bags = Math.ceil((5 - (hourglass.sandBags ?? 0)) * share);
  // Free floor in the shop, where the counter has room (ShopRoom.spacesNeeded keeps four places for them).
  const shop = level.rooms.find((room) => room.type === RoomType.SHOP && within(room, keeper.pos));
  if (!shop) return;
  const free: number[] = [];
  for (let y = shop.top + 1; y < shop.bottom; y++) {
    for (let x = shop.left + 1; x < shop.right; x++) {
      const c = x + y * WIDTH;
      if (hasFlag(level.map[c]!, F.PASSABLE) && c !== keeper.pos && !floor.heaps.some((h: Heap) => h.pos === c)) free.push(c);
    }
  }
  for (let i = 0; i < bags && free.length > 0; i++) {
    floor.heaps.push({ pos: free.splice(rng.index(free.length), 1)[0]!, kind: 'forSale', items: [createItem('sandbag')] });
    hourglass.sandBags = (hourglass.sandBags ?? 0) + 1;
  }
}

/**
 * Depths that hold nothing but their layout and never fill up with monsters
 * again: the bosses' levels, the last shop's (LastShopLevel: no mobs, no
 * respawner, only bones) and the Amulet's hall.
 * The original still rolled the last shop's potion of strength and scroll of
 * upgrade, counted them and never dropped them; here they are not rolled
 * there, so the depths below make up for them.
 */
const quietDepth = (d: number): boolean => isBossDepth(d) || d === LAST_SHOP_DEPTH || d >= 26;

export function floorAt(world: World, depth: number): Floor {
  levelAt(world, depth);
  return world.floors[depth]!;
}

/**
 * The party has grown: every depth already made grows with it (party.ts) — the new hero's share
 * of what lies about and of the monsters, and bosses waiting in their lairs grow sturdier.
 * Seeded by depth and party size, so the room and every client grow it alike.
 */
function welcome(world: World): void {
  const party = world.heroes.length;
  for (const key of Object.keys(world.floors)) {
    const d = Number(key);
    const level = world.levels[d]!;
    const floor = world.floors[d]!;
    if (!quietDepth(d)) {
      shareOfDepth(
        level, Rng.seeded(deriveSeed(world.run.seed, Stream.ITEMS, d, JOIN_STREAM + party)), floor.perHero ?? [], party, floor.heaps,
        (item) => underChallenges(world, item),
      );
    }
    reinforce(world, level, floor, Rng.seeded(deriveSeed(world.run.seed, Stream.MOBS, d, JOIN_STREAM + party)), party);
    for (const mob of floor.mobs) regrowBoss(world, mob);
  }
}

export function addHero(world: World, player: PlayerInfo): Hero {
  // In the arena, heroes come in on the dais of wherever it stands now.
  const depth = world.arena?.depth ?? 1;
  const level = levelAt(world, depth);
  const hero = createHero(player, depth, freeCellNear(world, level, depth, level.entrance), floorAt(world, depth).now);
  world.heroes.push(hero);
  // The arena's waves are made for whoever is there when they come; nothing lies about to share.
  if (world.arena) arenaJoined(world, hero, new Rng(floorAt(world, depth).rng));
  else if (world.heroes.length > 1) welcome(world);
  // Heroes know what they set out with, and each class its two kinds (HeroClass.initHero: `new X().identify()`).
  for (const kind of heroBelongings(hero).map((item) => item.kind).concat(startingKit(hero.heroClass).known)) {
    if (!world.known.includes(kind)) world.known.push(kind);
  }
  observe(world, hero);
  noteLandmarks(world, hero);
  return hero;
}

/** Adds a hero once; joining again (e.g. after a reconnect) keeps the existing one. */
export function joinHero(world: World, player: PlayerInfo): Hero {
  return heroById(world, player.id) ?? addHero(world, player);
}

export function heroById(world: World, id: string): Hero | undefined {
  return world.heroes.find((hero) => hero.id === id);
}

export function mobById(world: World, depth: number, id: string): Mob | undefined {
  return world.floors[depth]?.mobs.find((mob) => mob.id === id);
}

export { canEnter, exploredCells, heroView };

/** Everything the party currently sees on a depth. */
export function visibleCells(world: World, depth: number): boolean[] {
  const visible = new Array<boolean>(LENGTH).fill(false);
  for (const hero of heroesOn(world, depth)) {
    heroView(world, hero).forEach((seen, i) => {
      if (seen) visible[i] = true;
    });
  }
  return visible;
}

/**
 * Companions in a corridor step past each other: walking into a companion
 * swaps places with them, unless they are held fast (rooted, paralysed) or
 * could not stand where the walker was. In the original a hero walked
 * alone; in a party, a friend in a doorway must never wall the others in.
 */
function swapsWithCompanion(world: World, hero: Hero, other: Char): boolean {
  if (!('heroClass' in other) || other === hero || !isAlive(other)) return false;
  if (other.rooted > 0 || other.paralysed > 0) return false;
  return heroCanEnter(levelAt(world, hero.depth), other, hero.pos);
}

/** How near a monster hunting someone else must be to threaten this hero too (it may turn on them). */
const THREAT_REACH = 2;

/**
 * True when no monster in the hero's sight is after them: none hunts them, and
 * none hunting a companion stands right by. Only a threatened hero holds up
 * companions who have already decided (co-op turns, see advance): a hero who
 * merely sees a fight elsewhere rests through it until their player acts, so a
 * party is not run in lockstep by every monster anyone can see.
 */
export function isSafe(world: World, hero: Hero): boolean {
  const fov = heroView(world, hero);
  return !floorAt(world, hero.depth).mobs.some((mob) =>
    !mob.ally && mob.state === 'hunting' && fov[mob.pos] && (mob.enemy === hero.id || distance(mob.pos, hero.pos) <= THREAT_REACH));
}

/** Why an action is impossible right now, or null if it is fine. */
function problemWith(world: World, hero: Hero, action: Action): string | null {
  if (world.over) return 'the run is over';
  if (!isAlive(hero)) return 'you are dead';
  // The unstable spellbook's scroll waits to be settled first.
  if (hero.pendingScroll && action.type !== 'artifact') return 'art:unstablespellbook.prompt';
  if (isInventoryAction(action)) return inventoryProblem(world, hero, action);
  if (isClassAction(action)) return classProblem(world, hero, action);
  const inArena = arenaProblem(world, hero, action);
  if (inArena !== undefined) return inArena;
  const level = levelAt(world, hero.depth);
  switch (action.type) {
    case 'wait':
    case 'search':
      return null;
    case 'talent':
      return typeof action.talent === 'string' ? upgradeProblem(hero, action.talent) : 'no such talent';
    case 'ability': {
      const floor = floorAt(world, hero.depth);
      const ctx: Ctx = { world, depth: hero.depth, level, floor, rng: new Rng({ ...floor.rng }), effects: [] };
      switch (action.ability) {
        case 'berserk': return berserkProblem(hero);
        case 'freerun': return freerunProblem(hero);
        case 'snipe': return snipeProblem(ctx, hero);
        case 'combo': return comboProblem(ctx, hero, action.move, action.target ?? '');
        case 'ambush': return ambushProblem(ctx, hero, action.target);
        default: return 'unknown ability';
      }
    }
    case 'move':
      if (hero.rooted > 0) return 'you are rooted';
      if (Number.isInteger(action.to) && adjacent(hero.pos, action.to) && level.map[action.to] === T.LOCKED_DOOR) {
        return keyFor(hero) >= 0 ? null : 'the door is locked';
      }
      // A boss's level: its way down opens to the skeleton key it dropped.
      if (Number.isInteger(action.to) && adjacent(hero.pos, action.to) && level.map[action.to] === T.LOCKED_EXIT) {
        return keyFor(hero, 'key.skeleton') >= 0 ? null : 'the way down is locked';
      }
      // Hero.actMove: a move to where the hero stands tramples the grass or the plant there (canSelfTrample).
      if (action.to === hero.pos) return canSelfTrample(world, hero) ? null : 'cannot move there';
      if (!heroCanEnter(level, hero, action.to) || !adjacent(hero.pos, action.to)) return 'cannot move there';
      {
        const there = charAt(world, hero.depth, action.to);
        return there && !swapsWithHero(there) && !swapsWithCompanion(world, hero, there) ? 'cell is occupied' : null;
      }
    case 'attack': {
      const mob = mobById(world, hero.depth, action.target);
      if (!mob) return 'no such enemy';
      // Charmed, the hero cannot bring themselves to strike the charmer.
      if (hero.charmed > 0 && hero.charmedBy === mob.id) return 'you are charmed';
      // Hero.canAttack: next to it, or within the weapon's reach (KindOfWeapon.canReach; MagesStaff.reachFactor: a
      // battlemage's staff of disintegration reaches over a cell); a word, or an ally, only face to face.
      if (adjacent(hero.pos, mob.pos) || (mob.ally && copyReach(world, hero, mob))) return null;
      // Char.canInteract with ally warp: allies up to two cells a point away can be swapped with.
      if (mob.ally && mob.kind !== 'ward' && mob.kind !== 'lotus' && distance(hero.pos, mob.pos) <= 2 * pointsInTalent(hero, 'ally_warp')) return null;
      const reach = Math.max(heroReach(hero), staffReach(hero));
      return mob.state !== 'passive' && !mob.ally && canReach(world, level, hero, mob.pos, reach) ? null : 'too far away';
    }
    case 'dismiss':
      return dismissProblem(world, hero, action.target);
    case 'special':
      return abilityProblem(world, hero, action);
    case 'reward':
      return rewardProblem(world, hero, action.choice);
    case 'wandReward':
      return wandRewardProblem(world, hero, action.choice);
    case 'impReward':
      return impRewardProblem(world, hero);
    case 'reforge':
      return reforgeProblem(world, hero, action.first, action.second);
    case 'descend':
      // A boss level's way down may be several cells (its LevelTransition's area), once open.
      return hero.pos === level.exit || (level.exits?.includes(hero.pos) && level.map[hero.pos] === T.EXIT) ? null : 'not on the stairs';
    case 'artifact': {
      const floor = floorAt(world, hero.depth);
      return artifactProblem(world, hero, action, { world, depth: hero.depth, level, floor, rng: new Rng({ ...floor.rng }), effects: [] });
    }
    case 'faceCurse':
      return faceCurseProblem(world, hero);
    case 'jump':
      if (hero.rooted > 0) return 'you are rooted';
      if ((hero.levitating ?? 0) > 0) return 'you are floating';
      if (!Number.isInteger(action.to) || !adjacent(hero.pos, action.to) || !hasFlag(level.map[action.to]!, F.PIT)) {
        return 'no chasm there';
      }
      // Chasms never open above a boss's level, but should one, it holds.
      return isBossDepth(hero.depth + 1) || hero.depth + 1 >= DEEPEST_AVAILABLE ? 'the chasm has a bottom' : null;
    case 'ascend':
      if (hero.pos !== level.entrance) return 'not on the stairs';
      if (level.map[hero.pos] !== T.ENTRANCE) return 'the way up is flooded';
      // Hero.actAscend: only the Amulet opens the way out of the dungeon.
      return hero.depth <= 1 && !hasAmulet(hero) ? 'the way up is sealed' : null;
    case 'endGame':
      return hasAmulet(hero) ? null : 'no amulet';
    case 'plan':
      return world.live ? null : 'not a live world';
    default:
      return 'unknown action';
  }
}

/** Why an action cannot be done now (the client asks before it sends a targeted one). */
export const actionProblem = (world: World, hero: Hero, action: Action): string | null => problemWith(world, hero, action);

/** Hero.canAttack with reach: a way within so many steps over open ground (or what is to be avoided), whoever stands there. */
function reaches(level: Level, from: number, to: number, reach: number): boolean {
  if (distance(from, to) > reach) return false;
  let frontier = [to];
  const seen = new Set(frontier);
  for (let step = 0; step < reach; step++) {
    const next: number[] = [];
    for (const cell of frontier) {
      for (const n of NEIGHBOURS8) {
        const c = cell + n;
        if (!adjacent(cell, c) || seen.has(c)) continue;
        if (c === from) return true;
        if (!hasFlag(level.map[c]!, F.PASSABLE) && !hasFlag(level.map[c]!, F.AVOID)) continue;
        seen.add(c);
        next.push(c);
      }
    }
    frontier = next;
  }
  return false;
}

/** Whether a hero can do nothing this turn: paralysed, frozen solid, or out of time (TimeStasis). */
const held = (hero: Hero): boolean => hero.paralysed > 0 || (hero.frozen ?? 0) > 0 || (hero.stasis ?? 0) > 0;

/** Queues a player's action and lets the world run until someone must decide. */
export function act(world: World, heroId: string, action: Action): ActionResult {
  const hero = heroById(world, heroId);
  if (!hero) {
    return { ok: false, reason: 'unknown hero' };
  }
  const problem = problemWith(world, hero, action);
  if (problem) {
    return { ok: false, reason: problem };
  }
  // Live turns: the order stands until done or replaced; the clock (liveTick) carries it out. Choices
  // that take no time (the arena's «To battle!» and its rewards) are made at once.
  if (world.live && (action.type === 'arenaReady' || action.type === 'arenaPick')) {
    const floor = floorAt(world, hero.depth);
    const effects: Effect[] = [];
    perform({ world, depth: hero.depth, level: levelAt(world, hero.depth), floor, rng: new Rng(floor.rng), effects }, hero, action);
    world.turn++;
    return { ok: true, effects };
  }
  if (world.live) {
    hero.plan = action.type === 'plan' ? action.steps.slice(0, MAX_PLAN) : [action];
    hero.intent = null;
    world.turn++;
    return { ok: true, effects: [] };
  }
  hero.intent = action;
  const effects: Effect[] = [];
  settle(world, effects);
  world.turn++;
  return { ok: true, effects };
}

/* Scheduling */

/*
 * Live turns (world.live: co-op and the arena), the tactical way. Each depth is either calm
 * or in a fight. Calm, nobody is held up: heroes with orders (Hero.plan) carry them out a step
 * a beat, the others simply wait, and time stands still while nobody has anything to do. In a
 * fight (a hero on the depth in danger, or the arena's wave on) it is the original's turns:
 * time goes on only once every hero due to act has said what to do — a backpack open, a potion
 * being chosen, and the monsters wait too — and then all those moves play out together in one
 * beat, not one after another. An order that lasts (a walk) counts as said. A tap on a monster
 * is a walk up to it and one blow, as in the original: heroes never fight by themselves.
 */

/** A hero's order under live turns: an action once, or something that lasts. */
export type PlanStep =
  | Action
  /** Walk to a cell, finding the way afresh at every step (around monsters in sight and companions held fast). */
  | { type: 'go'; to: number }
  /** Walk up to a monster and strike it once. */
  | { type: 'hunt'; target: string }
  /** Rest until healed, while nothing in sight is after the hero. */
  | { type: 'rest' }
  /** Walk on in a direction (a key held down) until something stands in the way. */
  | { type: 'stride'; dx: number; dy: number };

/** The longest plan a hero keeps. */
const MAX_PLAN = 64;
/** How long a beat takes (ms): calm, a step of a walk; in a fight, the least time between turns (for their moves to be seen). */
export const LIVE_CALM_MS = 150;
export const LIVE_FIGHT_MS = 220;
/** Resting or searching, turns go by quickly: nothing moves on screen. */
export const LIVE_REST_MS = 40;

/** Whether a depth is in a fight: a hero there is in danger, or the arena's wave is on. */
export function inFight(world: World, depth: number): boolean {
  if (world.arena?.phase === 'fight' && world.arena.depth === depth) return true;
  return world.heroes.some((hero) => hero.depth === depth && isAlive(hero) && !isSafe(world, hero));
}

/** A hero has something to do: an order not yet carried out. */
const hasOrders = (hero: Hero): boolean => (hero.plan?.length ?? 0) > 0;

/**
 * Whether a fight waits for this hero's move: they are in danger (a monster in sight is after them,
 * or near), or the arena's wave is on round them. A companion off exploring is not held to turns.
 */
function heldToTurns(world: World, hero: Hero): boolean {
  return (world.arena?.phase === 'fight' && world.arena.depth === hero.depth) || !isSafe(world, hero);
}

/** Where a depth's beat ends: the one under way if a fight held it up, else the next. */
function beatEnd(floor: Floor): number {
  return floor.liveOpen ? floor.liveAt! : Math.max(floor.liveAt ?? floor.now, floor.now) + 1;
}

/** Heroes a depth's fight waits for: due to act in this beat, and with nothing to do. */
export function liveWaiting(world: World, depth: number): string[] {
  if (world.over || !inFight(world, depth)) return [];
  const until = beatEnd(floorAt(world, depth));
  return heroesOn(world, depth)
    .filter((hero) => isAlive(hero) && hero.time < until && !held(hero) && !hasOrders(hero) && heldToTurns(world, hero))
    .map((hero) => hero.id);
}

/** Every hero a fight is waiting for, depth by depth. */
export function liveBlockers(world: World): string[] {
  const depths = [...new Set(world.heroes.filter(isAlive).map((hero) => hero.depth))].sort((a, b) => a - b);
  return depths.flatMap((depth) => liveWaiting(world, depth));
}

/** Whether a depth's next beat can be played: calm, when someone has something to do; in a fight, when nobody due is without orders. */
export function liveReady(world: World, depth: number): boolean {
  if (world.over) return false;
  const heroes = heroesOn(world, depth).filter(isAlive);
  if (heroes.length === 0) return false;
  // A fight goes on once nobody it waits for is without a move; calm, once someone has something to do.
  return inFight(world, depth) ? liveWaiting(world, depth).length === 0 && (heroes.some(hasOrders) || heroes.some((hero) => !heldToTurns(world, hero))) : heroes.some(hasOrders);
}

/** How long a depth's next beat takes on screen (ms). */
export function liveBeatMs(world: World, depth: number): number {
  const busy = heroesOn(world, depth).filter((hero) => isAlive(hero) && hasOrders(hero));
  const still = busy.length > 0 && busy.every((hero) => ['rest', 'wait', 'search'].includes(hero.plan![0]!.type));
  if (inFight(world, depth)) return LIVE_FIGHT_MS;
  return still ? LIVE_REST_MS : LIVE_CALM_MS;
}

/** One beat of a depth: its turns up to the beat's end, each hero doing what they were told. */
export function liveTick(world: World, depth: number): ActionResult {
  const effects: Effect[] = [];
  if (world.over || !world.levels[depth]) return { ok: true, effects };
  const floor = floorAt(world, depth);
  const until = beatEnd(floor);
  const done = advanceLive(world, depth, effects, until);
  floor.liveAt = until;
  if (done) delete floor.liveOpen;
  else floor.liveOpen = true;
  world.turn++;
  return { ok: true, effects };
}

/** When a turn falls due on a depth. */
function turnTime(world: World, floor: Floor, turn: Turn): number {
  switch (turn.kind) {
    case 'hero': return turn.hero.time;
    case 'mob': return turn.mob.time;
    case 'respawn': return floor.respawn;
    case 'boss': return turn.entry.time;
    case 'arena': return world.arena!.tick;
    case 'gas': return floor.gasAt!;
    case 'fuse': return nextFuse(floor.heaps)!;
  }
}

/**
 * A depth's turns up to `until`; heroes do what their orders say. A hero with nothing to do waits,
 * unless a fight holds them to turns: then the beat stops at them (false) until they say. True once
 * the beat is over.
 */
function advanceLive(world: World, depth: number, effects: Effect[], until: number): boolean {
  const floor = floorAt(world, depth);
  const ctx: Ctx = { world, depth, level: levelAt(world, depth), floor, rng: new Rng(floor.rng), effects };
  for (let guard = 0; guard < 10_000; guard++) {
    const turn = world.over ? undefined : nextTurn(world, depth);
    if (!turn || turnTime(world, floor, turn) >= until) return true;
    if (turn.kind !== 'hero') {
      playTurn(ctx, turn);
      continue;
    }
    const hero = turn.hero;
    floor.now = Math.max(floor.now, hero.time);
    endEnduring(ctx, hero);
    if (held(hero)) {
      spend(ctx, hero, TIME_TO_REST);
      overChasm(ctx, hero);
      continue;
    }
    let action = planned(world, hero);
    const problem = action && problemWith(world, hero, action);
    if (problem) {
      // The order cannot be carried out: it is dropped, and the player says what instead.
      effects.push({ type: 'interrupted', hero: hero.id, reason: problem });
      hero.plan = [];
      action = null;
    }
    if (!action) {
      if (heldToTurns(world, hero)) return false;
      action = { type: 'wait' };
    }
    perform(ctx, hero, action);
    if (floor.falling) itemsFall(world, depth);
    overChasm(ctx, hero);
  }
  return true;
}

/** What a hero's orders ask of them this turn; null when they have none left. */
function planned(world: World, hero: Hero): Action | null {
  const plan = (hero.plan ??= []);
  while (plan.length > 0) {
    const step = plan[0]!;
    switch (step.type) {
      case 'go': {
        const next = hero.pos === step.to ? null : stepTowards(world, hero, step.to);
        if (next === null) {
          plan.shift();
          continue;
        }
        // The last step: the order is done.
        if (next === step.to) plan.shift();
        return { type: 'move', to: next };
      }
      case 'hunt': {
        const mob = mobById(world, hero.depth, step.target);
        if (!mob || !isAlive(mob) || !visibleCells(world, hero.depth)[mob.pos]) {
          plan.shift();
          continue;
        }
        if (adjacent(mob.pos, hero.pos)) {
          // One blow, as a tap on a monster is in the original; the next takes another tap.
          plan.shift();
          return { type: 'attack', target: mob.id };
        }
        const next = stepTowards(world, hero, mob.pos);
        if (next === null) {
          plan.shift();
          continue;
        }
        return { type: 'move', to: next };
      }
      case 'rest':
        if (hero.hp >= hero.ht || !isSafe(world, hero)) {
          plan.shift();
          continue;
        }
        return { type: 'wait' };
      case 'stride': {
        const next = hero.pos + Math.sign(step.dx) + Math.sign(step.dy) * WIDTH;
        const there = charAt(world, hero.depth, next);
        // A key held down walks; it does not fight (and the ghost or the sheep step aside).
        const blocked = (there !== undefined && !('heroClass' in there) && !swapsWithHero(there)) ||
          (there !== undefined && 'heroClass' in there && !swapsWithCompanion(world, hero, there));
        if (!adjacent(hero.pos, next) || blocked || !heroCanEnter(levelAt(world, hero.depth), hero, next)) {
          plan.shift();
          continue;
        }
        return { type: 'move', to: next };
      }
      default:
        plan.shift();
        return step;
    }
  }
  return null;
}

/**
 * The next step on the way to a cell, as the party knows the depth: round the monsters in sight
 * and companions who cannot step aside, round known traps where there is a way. Null: no way.
 */
function stepTowards(world: World, hero: Hero, to: number): number | null {
  const level = levelAt(world, hero.depth);
  const seen = visibleCells(world, hero.depth);
  const blocked = new Set<number>();
  for (const mob of floorAt(world, hero.depth).mobs) if (seen[mob.pos] && !swapsWithHero(mob)) blocked.add(mob.pos);
  for (const other of world.heroes) {
    if (other !== hero && other.depth === hero.depth && isAlive(other) && !swapsWithCompanion(world, hero, other)) blocked.add(other.pos);
  }
  const floating = (hero.levitating ?? 0) > 0;
  const known = exploredCells(world, hero.depth);
  const path = findPath(level, hero.pos, to, blocked, known, floating) ?? findPath(level, hero.pos, to, blocked, known, floating, true);
  return path && path.length > 0 ? path[0]! : null;
}

type Turn =
  | { kind: 'hero'; hero: Hero } | { kind: 'mob'; mob: Mob } | { kind: 'respawn' } | { kind: 'gas' } | { kind: 'arena' } | { kind: 'fuse' }
  | { kind: 'boss'; entry: Timed };

/** Who is due next on a depth; nothing happens on a depth without living heroes. */
function nextTurn(world: World, depth: number): Turn | undefined {
  const heroes = heroesOn(world, depth);
  if (heroes.length === 0) return undefined;
  const floor = floorAt(world, depth);
  // Ties go to heroes, then monsters, in a fixed order.
  let turn: Turn = { kind: 'hero', hero: heroes[0]! };
  let time = heroes[0]!.time;
  for (const hero of heroes) {
    if (hero.time < time) [turn, time] = [{ kind: 'hero', hero }, hero.time];
  }
  for (const mob of floor.mobs) {
    if (mob.time < time) [turn, time] = [{ kind: 'mob', mob }, mob.time];
  }
  if (floor.respawn >= 0 && floor.respawn < time) [turn, time] = [{ kind: 'respawn' }, floor.respawn];
  // The arena of waves, while a wave is on: monsters come in, and the wave may be over.
  const arena = world.arena;
  if (arena?.phase === 'fight' && arena.depth === depth && arena.tick < time) [turn, time] = [{ kind: 'arena' }, arena.tick];
  // Clouds of gas spread a turn at a time (Blob.act).
  if (floor.gasAt !== undefined && floor.gasAt < time) [turn, time] = [{ kind: 'gas' }, floor.gasAt];
  // Bomb.Fuse: a lit bomb burns down (after the hero, before the others).
  const fuse = nextFuse(floor.heaps);
  if (fuse !== undefined && fuse < time) [turn, time] = [{ kind: 'fuse' }, fuse];
  // A boss fight's buffs and blobs, after whoever is due at the same moment (an urgent one before them: VFX_PRIO).
  const entry = nextBossTimed(floor);
  if (entry && (entry.time < time || (entry.urgent === true && entry.time <= Math.max(time, floor.now)))) turn = { kind: 'boss', entry };
  return turn;
}

function companionWaiting(world: World, hero: Hero): boolean {
  return world.heroes.some((other) => other !== hero && other.depth === hero.depth && isAlive(other) && other.intent);
}

/**
 * What a hero does on their turn while their player is away or has looked away (the co-op
 * room plays it for them, so the party need not wait): strike back at a monster beside them
 * that is after them, the weakest first; otherwise wait. Never anything else: no items, no
 * steps, nothing a player would mind being chosen for them.
 */
export function autoAction(world: World, heroId: string): Action {
  const hero = heroById(world, heroId);
  if (!hero || !isAlive(hero)) return { type: 'wait' };
  const foes = floorAt(world, hero.depth).mobs
    .filter((mob) => mob.state === 'hunting' && mob.enemy === hero.id && adjacent(mob.pos, hero.pos) && !(hero.charmed > 0 && hero.charmedBy === mob.id))
    .sort((a, b) => a.hp - b.hp || (a.id < b.id ? -1 : 1));
  return foes.length > 0 ? { type: 'attack', target: foes[0]!.id } : { type: 'wait' };
}

/** Heroes everyone else on their depth is waiting for. */
export function blockers(world: World): string[] {
  const depths = new Set(world.heroes.filter(isAlive).map((hero) => hero.depth));
  const result: string[] = [];
  for (const depth of [...depths].sort((a, b) => a - b)) {
    const turn = nextTurn(world, depth);
    if (turn?.kind === 'hero' && !turn.hero.intent && companionWaiting(world, turn.hero)) {
      result.push(turn.hero.id);
    }
  }
  return result;
}

/** Runs every occupied depth until each waits for a player's decision. */
function settle(world: World, effects: Effect[]): void {
  for (let pass = 0; pass < 8; pass++) {
    const where = (): string => world.heroes.map((hero) => `${hero.depth}:${hero.hp > 0}`).join();
    const before = where();
    const depths = [...new Set(world.heroes.filter(isAlive).map((hero) => hero.depth))].sort((a, b) => a - b);
    for (const depth of depths) advance(world, depth, effects);
    // Someone changed depth: the depth they arrived on may now be able to move.
    if (where() === before) return;
  }
}

function advance(world: World, depth: number, effects: Effect[]): void {
  const floor = floorAt(world, depth);
  const ctx: Ctx = { world, depth, level: levelAt(world, depth), floor, rng: new Rng(floor.rng), effects };

  for (let guard = 0; guard < 100_000; guard++) {
    const turn = world.over ? undefined : nextTurn(world, depth);
    if (!turn) return;

    if (turn.kind !== 'hero') {
      playTurn(ctx, turn);
      continue;
    }

    const hero = turn.hero;
    floor.now = Math.max(floor.now, hero.time);
    // Hero.act: an Endure that has run its three turns turns what it took into the blows to come.
    endEnduring(ctx, hero);
    if (held(hero)) {
      // Paralysed (or frozen, or out of time): the turn passes; whatever the player chose waits.
      spend(ctx, hero, TIME_TO_REST);
      overChasm(ctx, hero);
      continue;
    }
    if (hero.intent) {
      const action = hero.intent;
      hero.intent = null;
      const problem = problemWith(world, hero, action);
      if (problem) {
        effects.push({ type: 'interrupted', hero: hero.id, reason: problem });
      } else {
        perform(ctx, hero, action);
        if (floor.falling) itemsFall(world, depth);
        overChasm(ctx, hero);
      }
      continue;
    }
    if (companionWaiting(world, hero) && isSafe(world, hero)) {
      spend(ctx, hero, TIME_TO_REST);
      overChasm(ctx, hero);
      continue;
    }
    return;
  }
}

/** A turn that is not a hero's: a monster's, the respawner's, the arena's, the gas spreading. */
function playTurn(ctx: Ctx, turn: Exclude<Turn, { kind: 'hero' }>): void {
  const { world, floor } = ctx;
  switch (turn.kind) {
    case 'mob':
      floor.now = Math.max(floor.now, turn.mob.time);
      mobAct(ctx, turn.mob);
      return;
    case 'respawn':
      floor.now = Math.max(floor.now, floor.respawn);
      respawn(ctx);
      return;
    case 'arena':
      floor.now = Math.max(floor.now, world.arena!.tick);
      arenaTurn(ctx);
      return;
    case 'gas':
      floor.now = Math.max(floor.now, floor.gasAt!);
      floor.gasAt! += 1;
      evolveGas(ctx);
      return;
    case 'boss':
      floor.now = Math.max(floor.now, turn.entry.time);
      bossTimedTurn(ctx, turn.entry);
      return;
    case 'fuse':
      floor.now = Math.max(floor.now, nextFuse(floor.heaps)!);
      burnFuses(ctx);
  }
}

/**
 * Char.spend: time passes for the hero, slowed twice as long, chilled a little longer (status.ts
 * timeScale) and quicker with a ring of haste (Pixel Dungeon's); `constant`, as Hero.spendConstant
 * (resting), it is none of these. The hero's buffs act
 * for every turn passed (hero.ts heroTurns: hunger, regeneration, the sealed floor, the seal's shield).
 */
function spend(ctx: Ctx, hero: Hero, time: number, constant = false): void {
  // Char.spendConstant: while the hourglass freezes time, the hero's acts only use up its charge.
  const frozen = frozenBy(hero);
  if (frozen && hero.depth === ctx.depth) {
    freezeTime(ctx, hero, frozen, time);
    return;
  }
  if (!constant) {
    // Char.spend: slowed or chilled, everything takes longer (rings of haste quicken only the step: heroSpeed).
    time /= timeScale(hero);
  }
  const from = hero.time;
  hero.time += time;
  // What the classes' abilities set to last until the hero's next turn now has its end.
  settleTimers(hero);
  if (hero.depth === ctx.depth) altarMarksHero(ctx, hero, time);
  // The hero's buffs, the artifacts' among them, once a turn; a cursed hourglass may steal a turn.
  const lost = heroTurns(ctx, hero, from, hero.time);
  // The talents' cooldowns and trackers count down.
  talentTime(hero, time);
  for (const ring of heroRings(hero)) wear(ctx, hero, ring, time);
  // The hero's gear as time passes: shields fade, boomerangs come back, crystal mends (throwing.ts).
  if (hero.depth === ctx.depth) gearTick(ctx, hero, time);

  // Ooze.act: caustic ooze eats at the hero every turn until it wears off, or is washed off in water.
  for (let i = Math.floor(hero.time) - Math.floor(from); i > 0 && hero.ooze >= 0 && isAlive(hero); i--) {
    oozeTurn(ctx, hero, (damage) => {
      ctx.effects.push({ type: 'hurt', depth: hero.depth, who: hero.id, damage });
      hurt(ctx, hero, damage, 'ooze');
    });
  }
  hero.mindVision = Math.max(0, hero.mindVision - time);
  hero.invisible = Math.max(0, hero.invisible - time);
  hero.paralysed = Math.max(0, hero.paralysed - time);
  hero.rooted = Math.max(0, hero.rooted - time);
  hero.slowed = Math.max(0, hero.slowed - time);
  hero.weakened = Math.max(0, hero.weakened - time);
  hero.crippled = Math.max(0, hero.crippled - time);
  hero.light = Math.max(0, hero.light - time);
  hero.charmed = Math.max(0, hero.charmed - time);
  hero.dizzy = Math.max(0, hero.dizzy - time);
  hero.barkskin = Math.max(0, (hero.barkskin ?? 0) - time);
  if (hero.blessed) hero.blessed = Math.max(0, hero.blessed - time);
  if (hero.degraded) hero.degraded = Math.max(0, hero.degraded - time);
  artifactsTime(hero, time);
  sungrassHeals(hero, time);
  if (hero.charmed <= 0) hero.charmedBy = null;

  // Wand.Charger: the wands gather charges, a turn at a time; the wands' conditions wear off (status.ts),
  // and a cursed wand's lingering effects go on (cursed.ts).
  const turns = Math.floor(hero.time) - Math.floor(hero.time - time);
  chargeWands(hero, turns, (item) => inBag(hero, item));
  heroStatusTime(ctx, hero, time, turns);
  if (hero.depth === ctx.depth) for (let i = 0; i < turns && isAlive(hero); i++) cursedTurn(ctx, hero);

  // Poison and fire hurt once for every whole turn that passes.
  const ticks = (left: number): number => Math.floor(left) - Math.floor(Math.max(0, left - time));
  if (hero.poison > 0) {
    const damage = ticks(hero.poison);
    hero.poison = Math.max(0, hero.poison - time);
    if (damage > 0 && isAlive(hero)) {
      ctx.effects.push({ type: 'hurt', depth: hero.depth, who: hero.id, damage });
      hurt(ctx, hero, damage, 'poison');
    }
  }
  // Armour of viscosity: blows held back are taken now, a tenth (a point at least) every turn (Viscosity.DeferedDamage).
  for (let i = Math.floor(hero.time) - Math.floor(hero.time - time); i > 0 && (hero.deferred ?? 0) > 0 && isAlive(hero); i--) {
    const damage = Math.min(hero.deferred!, Math.max(1, Math.trunc(hero.deferred! * 0.1)));
    hero.deferred! -= damage;
    ctx.effects.push({ type: 'hurt', depth: hero.depth, who: hero.id, damage });
    hurt(ctx, hero, damage, 'deferred');
  }
  if (hero.blind) hero.blind = Math.max(0, hero.blind - time);
  // Bleeding: every turn it hurts as much as it bleeds, and eases, until it stops (Bleeding.act).
  for (let i = Math.floor(hero.time) - Math.floor(hero.time - time); i > 0 && (hero.bleeding ?? 0) > 0 && isAlive(hero); i--) {
    const damage = bleedTick(ctx.rng, hero);
    if (damage <= 0) break;
    ctx.effects.push({ type: 'hurt', depth: hero.depth, who: hero.id, damage });
    hurt(ctx, hero, damage, 'bleeding');
  }
  if (hero.levitating) hero.levitating = Math.max(0, hero.levitating - time);
  // Shattered's buffs from alchemy (buffs.ts).
  if (isAlive(hero)) tickHero(ctx, hero, time);
  if (hero.gasImmune) hero.gasImmune = Math.max(0, hero.gasImmune - time);
  if (hero.burning > 0) {
    // Armour of brimstone: fire does not take (Char.isImmune: Burning).
    if (isWater(ctx.level.map[hero.pos]!) || hasGlyph(hero, 'brimstone')) {
      hero.burning = 0;
    } else {
      for (let i = ticks(hero.burning); i > 0 && isAlive(hero); i--) {
        const damage = ctx.rng.intRange(1, 3 + Math.trunc(hero.depth / 4));
        ctx.effects.push({ type: 'hurt', depth: hero.depth, who: hero.id, damage });
        hurt(ctx, hero, damage, 'burning');
        // Burning.act: something in the pack may catch.
        if (isAlive(hero)) scorchPack(ctx, hero);
      }
      hero.burning = Math.max(0, hero.burning - time);
    }
  }
  // hourglassRecharge.act, cursed: ((Hero) target).spend(TICK).
  if (lost > 0 && isAlive(hero)) spend(ctx, hero, lost);
}

function perform(ctx: Ctx, hero: Hero, action: Action): void {
  const { world, level } = ctx;
  beforeHeroAct(ctx, hero);
  if (isClassAction(action)) {
    spend(ctx, hero, performClass(ctx, hero, action));
    if (isAlive(hero)) {
      observe(world, hero);
      noteLandmarks(world, hero);
    }
    return;
  }
  if (isInventoryAction(action)) {
    spend(ctx, hero, performInventory(ctx, hero, action));
    if (isAlive(hero)) {
      observe(world, hero);
      noteLandmarks(world, hero);
    }
    return;
  }
  switch (action.type) {
    case 'wait':
      // Hero.rest: resting takes a turn, whatever slows or hastens the hero (spendConstant); and digs in (hold fast).
      spend(ctx, hero, TIME_TO_REST, true);
      onRest(hero);
      holdFastRest(hero, hero.sealShield !== undefined);
      break;

    case 'talent':
      // Hero.upgradeTalent: no time passes.
      upgradeTalent(ctx, hero, action.talent);
      break;

    case 'ability': {
      let time = 0;
      switch (action.ability) {
        case 'berserk': doBerserk(ctx, hero); break;
        case 'freerun': doFreerun(ctx, hero); break;
        case 'snipe': time = snipe(ctx, hero); break;
        case 'combo': time = useComboMove(ctx, hero, action.move, action.target ?? ''); break;
        case 'ambush': {
          // Preparation: blink beside the target, then strike as any blow is struck.
          const mob = mobById(world, hero.depth, action.target)!;
          heroAmbush(ctx, hero, mob);
          attack(ctx, hero, mob);
          time = consumeLethalMomentum(hero) ? 0 : heroAttackDelay(hero);
          break;
        }
      }
      if (action.ability === 'combo' || action.ability === 'snipe' || action.ability === 'ambush') {
        if (consumeLethalMomentum(hero)) time = 0;
      }
      if (time > 0 || action.ability === 'combo' || action.ability === 'ambush') spend(ctx, hero, time);
      break;
    }

    case 'search':
      // Hero.search(true): a deliberate search, which takes two turns.
      search(ctx, hero, true);
      spend(ctx, hero, TIME_TO_SEARCH);
      break;

    case 'move': {
      if (action.to === hero.pos) {
        // Hero.actMove: moving in place tramples the grass or sets off the plant underfoot (Level.pressCell).
        if (level.map[hero.pos] === T.HIGH_GRASS) trample(ctx, hero.pos, hero);
        stepOnPlant(ctx, hero, hero.pos);
        spend(ctx, hero, 1 / heroSpeed(hero));
        break;
      }
      if (level.map[action.to] === T.LOCKED_DOOR) {
        // The iron key turns in the lock and stays there.
        hero.items.splice(keyFor(hero), 1);
        level.map[action.to] = T.DOOR;
        ctx.effects.push({ type: 'unlocked', depth: hero.depth, pos: action.to, hero: hero.id });
      }
      if (level.map[action.to] === T.LOCKED_EXIT) {
        // Hero.actUnlock: the skeleton key opens the way down for the whole party.
        hero.items.splice(keyFor(hero, 'key.skeleton'), 1);
        level.map[action.to] = T.UNLOCKED_EXIT;
        ctx.effects.push({ type: 'unlocked', depth: hero.depth, pos: action.to, hero: hero.id });
      }
      // Vertigo: a dizzy hero staggers to some other cell, or into a wall.
      let to = action.to;
      if (hero.dizzy > 0) {
        to = staggerTarget(ctx, hero.pos);
        if (!heroCanEnter(level, hero, to) || charAt(world, hero.depth, to) || level.map[to] === T.LOCKED_DOOR) to = hero.pos;
      }
      const from = hero.pos;
      // A harmless wanderer in the way steps into the hero's place.
      const wanderer = to !== from ? charAt(world, hero.depth, to) : undefined;
      hero.pos = to;
      leaveCell(world, level, hero.depth, from);
      enterCell(level, hero.pos);
      if (wanderer && (swapsWithHero(wanderer) || swapsWithCompanion(world, hero, wanderer))) {
        wanderer.pos = from;
        enterCell(level, from);
      }
      // Hero.actMove: a freerunner builds momentum with each step.
      if (hero.pos !== from) gainMomentum(hero);
      // GreaterHaste: a move costs no time, and uses one of its moves up.
      spend(ctx, hero, greaterHasteMove(hero) ? 0 : 1 / heroSpeed(hero, footing(ctx, hero)));
      if (hero.pos === from) break;
      // The step is done, then the trap goes off; floating, the hero touches nothing (Char.move). While the
      // hourglass freezes time, traps and plants wait for it to start again (heroPress).
      const floating = (hero.levitating ?? 0) > 0;
      if (!floating && level.map[hero.pos] === T.WELL) drinkFromWell(ctx, hero);
      heroPress(ctx, hero);
      if (!floating && level.map[hero.pos] === T.HIGH_GRASS) trample(ctx, hero.pos, hero);
      // Level.occupyCell: rejuvenating steps turn the grass underfoot to tall grass now and then.
      if (!floating) onHeroMovedOnGrass(ctx, hero);
      // Level.occupyCell on a boss's level: the hero may move the fight on.
      if (isBossDepth(hero.depth)) bossOccupy(ctx, hero);
      search(ctx, hero, false);
      break;
    }

    case 'attack': {
      const mob = mobById(world, hero.depth, action.target)!;
      if (mob.ally) {
        // Mob.interact for an ally: the hero and the ally swap places; a ward asks to be dismissed.
        if (mob.kind === 'ward') {
          ctx.effects.push({ type: 'ward', hero: hero.id, mob: mob.id });
        } else if (mob.kind === 'ghostHero' && ghostIntroduces(ctx, hero, mob)) {
          // DriedRose.GhostHero.interact: its first word, before it ever trades places.
        } else if (mob.kind === 'shadow' && copyReach(world, hero, mob) && swapWithClone(ctx, hero, mob)) {
          // ShadowAlly.interact with Perfect Copy: they trade places from a distance.
          spend(ctx, hero, 1 / heroSpeed(hero));
        } else if (allySwaps(mob) && (adjacent(hero.pos, mob.pos) || hasTalent(hero, 'ally_warp'))) {
          const from = hero.pos;
          hero.pos = mob.pos;
          mob.pos = from;
          enterCell(level, hero.pos);
          if (hasTalent(hero, 'ally_warp')) {
            // Ally warp: the swap is instant, with a flash at both ends.
            ctx.effects.push({ type: 'blinked', depth: ctx.depth, who: hero.id, from, to: hero.pos });
            ctx.effects.push({ type: 'blinked', depth: ctx.depth, who: mob.id, from: hero.pos, to: from });
          } else {
            gainMomentum(hero);
            spend(ctx, hero, 1 / heroSpeed(hero));
          }
        }
        break;
      }
      // Mimic.interact: bumping into a hidden mimic, it springs (the hero's turn goes on it).
      if (mob.hidden) {
        ambush(ctx, mob, hero);
        spend(ctx, hero, 1);
        break;
      }
      // An inactive pylon is no one to talk to: a blow at it does nothing (Pylon.isInvulnerable).
      if (mob.state === 'passive' && !isEnemy(mob) && mob.kind !== 'pylon') {
        // Not a fight: a word with the sad ghost, or business with the
        // shopkeeper; it takes no time.
        if (isShopkeeper(mob)) ctx.effects.push({ type: 'shop', hero: hero.id });
        else if (mob.kind === 'wandmaker') talkToWandmaker(ctx, hero);
        else if (mob.kind === 'imp') talkToImp(ctx, hero);
        else if (mob.kind === 'blacksmith') talkToSmith(ctx, hero);
        else if (mob.kind === 'sheep') ctx.effects.push({ type: 'baa', depth: hero.depth, mob: mob.id });
        else if (mob.kind === 'ratKing') {
          // RatKing.interact: woken, he says he was not sleeping; awake, he has no time for this.
          ctx.effects.push({ type: 'ratKing', hero: hero.id, line: mob.awake ? 'busy' : 'notSleeping' });
          mob.awake = true;
        }
        else if (mob.kind === 'mirror' || mob.kind === 'bee' || mob.ally) {
          // MirrorImage.interact and Bee.interact: the hero and the ally swap places.
          const from = hero.pos;
          hero.pos = mob.pos;
          mob.pos = from;
          enterCell(level, hero.pos);
          spend(ctx, hero, 1 / heroSpeed(hero, footing(ctx, hero)));
        }
        else talkToGhost(ctx, hero);
        break;
      }
      attack(ctx, hero, mob);
      // Hero.attackDelay: a kill with lethal momentum costs no time.
      spend(ctx, hero, consumeLethalMomentum(hero) ? 0 : heroAttackDelay(hero));
      break;
    }

    case 'reward':
      rewardFromGhost(ctx, hero, action.choice);
      break;

    // Choosing takes no time: the party is resting.
    case 'arenaReady':
      arenaReady(ctx, hero, action.cancel === true);
      break;

    case 'arenaPick':
      arenaPick(ctx, hero, action.choice);
      break;

    case 'wandReward':
      wandFromWandmaker(ctx, hero, action.choice);
      break;

    case 'impReward':
      ringFromImp(ctx, hero);
      break;

    case 'faceCurse':
      faceCurse(ctx, hero);
      break;

    case 'dismiss':
      dismiss(ctx, mobById(world, hero.depth, action.target)!);
      break;

    case 'reforge':
      reforge(ctx, hero, action.first, action.second);
      spend(ctx, hero, TIME_TO_REFORGE);
      break;

    case 'descend':
      if (hero.depth >= DEEPEST_AVAILABLE) {
        // Nothing lies below the Amulet's hall: should a way on ever open there, it leads out, and the run is won.
        win(ctx, hero, 'amulet');
        return;
      }
      changeDepth(ctx, hero, hero.depth + 1, 'entrance');
      reviveFallen(world, hero.depth, ctx.effects);
      break;

    case 'jump':
      fall(ctx, hero, action.to);
      return;

    case 'ascend':
      if (hero.depth <= 1) {
        // Out of the dungeon with the Amulet: SurfaceScene, the happy end.
        win(ctx, hero, 'surface');
        return;
      }
      changeDepth(ctx, hero, hero.depth - 1, 'exit');
      break;

    case 'endGame':
      win(ctx, hero, 'amulet');
      return;

    case 'special':
      spend(ctx, hero, useAbility(ctx, hero, action, { returnTo: (depth, pos) => beaconReturn(ctx, hero, depth, pos) }));
      break;

    case 'artifact':
      spend(ctx, hero, performArtifact(ctx, hero, action, {
        teleport: () => teleportHero(ctx, hero),
        returnTo: (depth, pos) => beaconReturn(ctx, hero, depth, pos),
      }));
      break;
  }
  if (isAlive(hero)) {
    observe(world, hero);
    noteLandmarks(world, hero);
  }
}

/**
 * What a hero's speed depends on besides the hero (Swiftness: an enemy within three steps of open ground, Flow:
 * water underfoot, Bulk: a doorway).
 */
function footing(ctx: Ctx, hero: Hero): Footing {
  const { level } = ctx;
  let enemyNear = false;
  if (hasGlyph(hero, 'swiftness')) {
    const reach = new Map<number, number>([[hero.pos, 0]]);
    const queue = [hero.pos];
    for (let head = 0; head < queue.length && !enemyNear; head++) {
      const cell = queue[head]!;
      const d = reach.get(cell)!;
      const there = charAt(ctx.world, ctx.depth, cell);
      if (there && isEnemy(there)) enemyNear = true;
      if (d >= 3) continue;
      for (const n of NEIGHBOURS8) {
        const next = cell + n;
        if (next >= 0 && next < LENGTH && !reach.has(next) && adjacent(cell, next) && isPassable(level, next)) {
          reach.set(next, d + 1);
          queue.push(next);
        }
      }
    }
  }
  return { terrain: level.map[hero.pos]!, enemyNear };
}

/** Whether a hero carries the Amulet of Yendor. */
export function hasAmulet(hero: Hero): boolean {
  return hero.items.some((item) => item.kind === 'quest.amulet');
}

/** Dungeon.win: the run is over and won, for the whole party. */
function win(ctx: Ctx, hero: Hero, ending: 'amulet' | 'surface'): void {
  const { world } = ctx;
  world.victory = true;
  world.over = true;
  world.ending = ending;
  for (const other of world.heroes) {
    other.intent = null;
    // Dungeon.win: everything the heroes carry is known for what it is.
    identifyBelongings(world, other);
  }
  ctx.effects.push({ type: 'victory', hero: hero.id, ending });
}

/**
 * HighGrass.trample: walked through, tall grass is flattened and sometimes sheds a seed or a dewdrop.
 * The huntress travels through it without trampling it: it only furrows (FURROWED_GRASS, which still
 * stands and hides, but sheds nothing more and is flattened by anyone else). Also a hard press on it (wands.ts pressCell: one thrown by a blast wave landing).
 */
export function trample(ctx: Ctx, pos: number, hero?: Hero): void {
  const level = ctx.level;
  const furrowed = isFurrowed(level, pos);
  // Armour of camouflage: trampling tall grass (or furrowing it), its wearer melts into it.
  if (hero) camouflage(hero);
  if (hero?.heroClass === 'huntress') {
    if (furrowed) return;
    furrow(level, pos);
  } else {
    ctx.level.map[pos] = T.GRASS;
    if (furrowed) {
      unfurrow(level, pos);
      return;
    }
  }
  // HighGrass.trample: barkskin for the huntress, berries from nature's bounty.
  if (hero) onGrassTrampled(ctx, hero, pos);
  // HighGrass.trample: a seed one time in 25 and a dewdrop in 6; the sandals of nature worn draw strength from it,
  // and the grass gives more (seeds up to one in 9, dew up to one in 4); cursed, nothing at all; barren land, nothing.
  const nature = naturalism(hero) ?? 0;
  if (nature < 0 || isChallenged(ctx.world, NO_HERBALISM)) return;
  // PetrifiedSeed: more found in the grass (grassLootMultiplier), and a runestone now and then instead of a seed.
  const petrified = trinketLevel(hero, 'trinket.petrifiedSeed');
  const seedChance = (1 / (25 - nature * 4)) * (petrified >= 0 ? PETRIFIED_SEED.grassLootMultiplier(petrified) : 1);
  if (ctx.rng.float() < seedChance) {
    const stone = petrified >= 0 && ctx.rng.float() < PETRIFIED_SEED.stoneInsteadOfSeedChance(petrified);
    dropItem(ctx.floor, pos, new ItemGenerator(ctx.rng, ctx.depth).of(stone ? 'stone' : 'seed'));
  }
  if (ctx.rng.float() < 1 / (6 - nature / 2)) dropItem(ctx.floor, pos, createItem('dew'));
}

/** Terrain.FURROWED_GRASS, kept beside the map until the levels stream brings the terrain (Level.furrowed). */
const isFurrowed = (level: Level, pos: number): boolean => level.map[pos] === T.HIGH_GRASS && (level.furrowed ?? []).includes(pos);
function furrow(level: Level, pos: number): void {
  (level.furrowed ??= []).push(pos);
}
/** Level.set(pos, FURROWED_GRASS) for the talents and the warden: tall grass that still stands, and sheds nothing. */
export function furrowGrass(level: Level, pos: number): void {
  level.map[pos] = T.HIGH_GRASS;
  if (!(level.furrowed ?? []).includes(pos)) furrow(level, pos);
}
function unfurrow(level: Level, pos: number): void {
  level.furrowed = (level.furrowed ?? []).filter((cell) => cell !== pos);
}

/**
 * Hero.canSelfTrample: standing in tall grass (not furrowed grass for the huntress, who would not
 * flatten it) or on a plant, and not rooted or floating, the hero may trample it where they stand.
 */
export function canSelfTrample(world: World, hero: Hero): boolean {
  if (hero.rooted > 0 || (hero.levitating ?? 0) > 0) return false;
  const level = levelAt(world, hero.depth);
  const grass = level.map[hero.pos] === T.HIGH_GRASS && !(hero.heroClass === 'huntress' && isFurrowed(level, hero.pos));
  return grass || (floorAt(world, hero.depth).plants ?? []).some((plant) => plant.pos === hero.pos);
}

/** The backpack slot of an iron key for the hero's current depth, or -1. */
function keyFor(hero: Hero, kind: 'key.iron' | 'key.skeleton' = 'key.iron'): number {
  return hero.items.findIndex((item) => item.kind === kind && item.depth === hero.depth);
}

/**
 * WellWater: water of health heals and cures; water of awareness reveals the
 * level and what the hero wears (see ident.ts). A well runs dry once drunk from.
 */
function drinkFromWell(ctx: Ctx, hero: Hero): void {
  const { level, world } = ctx;
  const index = level.wells.findIndex((well) => well.pos === hero.pos);
  // Water of transmutation does nothing to whoever wades in: it is for what is dropped into it.
  if (index >= 0 && level.wells[index]!.water === 'transmutation') {
    ctx.effects.push({ type: 'well', hero: hero.id, water: 'transmutation' });
    return;
  }
  level.map[hero.pos] = T.EMPTY_WELL;
  if (index < 0) return;
  const { water } = level.wells.splice(index, 1)[0]!;
  if (water === 'health') {
    // WaterOfHealth: healed, cured and fed.
    hero.hp = hero.ht;
    hero.poison = 0;
    hero.burning = 0;
    hero.ooze = -1;
    hero.hunger = 0;
    hero.weakened = 0;
    hero.crippled = 0;
  } else {
    // WaterOfAwareness: what the hero wears is known through and through, and the curses of all they carry (Belongings.observe).
    for (const kind of observeBelongings(world, hero)) ctx.effects.push({ type: 'identified', hero: hero.id, kind });
    const explored = exploredCells(world, hero.depth);
    discoverable(level.map).forEach((open, i) => {
      if (!open) return;
      explored[i] = true;
      if (hasFlag(level.map[i]!, F.SECRET)) level.map[i] = discover(level.map[i]!);
    });
  }
  ctx.effects.push({ type: 'well', hero: hero.id, water });
}

/** GhostHero.interact: the first time the hero speaks to the rose's ghost, it tells its story. */
function ghostIntroduces(ctx: Ctx, hero: Hero, ghost: Mob): boolean {
  const rose = carriedOf(hero, 'artifact.rose');
  if (!rose || rose.ghost !== ghost.id || rose.talkedTo) return false;
  rose.talkedTo = true;
  ghostSays(ctx, ghost, 'introduce');
  return true;
}

/**
 * InterlevelScene's RETURN: the hero goes straight to another depth (a scroll of passage, a beacon of returning), to
 * a cell there or, without one, its way in; the rose's ghost follows.
 */
/** Mob.holdAllies and restoreAllies: the rose's ghost, the shadow clone and the spirit hawk come along. */
function followHero(world: World, hero: Hero, fromDepth: number): void {
  ghostFollows(world, hero, fromDepth);
  alliesFollow(world, hero, fromDepth);
}

export function moveToDepth(world: World, hero: Hero, depth: number, pos?: number): void {
  const fromDepth = hero.depth;
  const fromLevel = levelAt(world, hero.depth);
  leaveCell(world, fromLevel, hero.depth, hero.pos);
  const level = levelAt(world, depth);
  hero.depth = depth;
  place(world, hero, level, pos ?? level.entrance);
  followHero(world, hero, fromDepth);
}

/** ScrollOfTeleportation.teleportHero: somewhere out of sight on the level, if there is anywhere. */
function teleportHero(ctx: Ctx, hero: Hero): void {
  const fov = heroView(ctx.world, hero);
  const pos = randomRespawnCell(ctx.rng, ctx.world, ctx.level, (cell) => !fov[cell]);
  if (pos === -1 || charAt(ctx.world, hero.depth, pos)) {
    ctx.effects.push({ type: 'artifact', hero: hero.id, msg: 'items.scrolls.scrollofteleportation.no_tele', tone: 'w' });
    return;
  }
  const from = hero.pos;
  hero.pos = pos;
  leaveCell(ctx.world, ctx.level, hero.depth, from);
  enterCell(ctx.level, pos);
  ctx.effects.push({ type: 'teleported', hero: hero.id });
  heroPress(ctx, hero);
}

/** LloydsBeacon.execute(RETURN): back to where it was set, at once — on this level a monster there steps aside. */
function beaconReturn(ctx: Ctx, hero: Hero, depth: number, pos: number): void {
  const { world } = ctx;
  if (depth !== hero.depth) disarmPresses(ctx, hero);
  const fromDepth = hero.depth;
  leaveCell(world, ctx.level, hero.depth, hero.pos);
  if (depth === hero.depth) {
    const mob = ctx.floor.mobs.find((m) => m.pos === pos);
    const aside = mob ? NEIGHBOURS8.map((n) => pos + n).find((c) => !charAt(world, depth, c) && isPassable(ctx.level, c)) : undefined;
    if (mob && aside !== undefined) mob.pos = aside;
  }
  hero.depth = depth;
  place(world, hero, levelAt(world, depth), pos);
  followHero(world, hero, fromDepth);
  ctx.effects.push({ type: 'teleported', hero: hero.id });
  const there = levelAt(world, depth);
  if (depth === ctx.depth && trapAt(there.map[hero.pos]!) && !(hero.levitating ?? 0)) triggerTrap(ctx, hero, hero.pos);
}

function changeDepth(ctx: Ctx, hero: Hero, depth: number, arrival: 'entrance' | 'exit'): void {
  const { world } = ctx;
  // Level.beforeTransition: what time stood still for is undone.
  disarmPresses(ctx, hero);
  const fromLevel = levelAt(world, hero.depth);
  const fromDepth = hero.depth;
  const from = hero.pos;
  const level = levelAt(world, depth);
  hero.depth = depth;
  leaveCell(world, fromLevel, fromDepth, from);
  place(world, hero, level, arrival === 'entrance' ? level.entrance : level.exit);
  // Mob.holdAllies and restoreAllies: the rose's ghost comes along.
  followHero(world, hero, fromDepth);
  // GameScene.create: rogue's foresight hints at a secret room; iron stomach does not persist between floors.
  foresightHint({ ...ctx, depth, level, floor: floorAt(world, depth) }, hero);
}

/**
 * Chasm.heroFall and heroLand: down through the chasm to the depth below,
 * landing hard and crippled. Under a weak floor lies that depth's pit room.
 */
function fall(ctx: Ctx, hero: Hero, into: number): void {
  const { world, level, effects } = ctx;
  const weakFloor = level.rooms.some((room) => room.type === RoomType.WEAK_FLOOR && within(room, into));
  effects.push({ type: 'fell', hero: hero.id, depth: hero.depth, pos: into });
  disarmPresses(ctx, hero);
  const fromDepth = hero.depth;
  const depth = hero.depth + 1;
  const below = levelAt(world, depth);
  const floor = floorAt(world, depth);
  const rng = new Rng(floor.rng);
  leaveCell(world, level, hero.depth, hero.pos);
  hero.depth = depth;
  hero.pos = landingCell(world, depth, rng, weakFloor);
  hero.time = floor.now;
  enterCell(below, hero.pos);
  // ElixirOfFeatherFall.FeatherBuff: the fall hurts nothing, and uses up ten turns of it (Chasm.heroLand).
  const feather = hero.buffs?.featherFall ?? 0;
  if (feather > 0) {
    hero.buffs!.featherFall = feather - 10;
    if (hero.buffs!.featherFall! <= 0) delete hero.buffs!.featherFall;
    observe(world, hero);
    reviveFallen(world, depth, effects);
    return;
  }
  hero.crippled = Math.max(hero.crippled, CRIPPLE_TURNS);
  const damage = rng.intRange(Math.trunc(hero.ht / 3), Math.trunc(hero.ht / 2));
  effects.push({ type: 'hurt', depth, who: hero.id, damage });
  hurt({ world, depth, level: below, floor, rng, effects }, hero, damage, 'fall');
  if (!isAlive(hero)) return;
  observe(world, hero);
  followHero(world, hero, fromDepth);
  reviveFallen(world, depth, effects);
}

/** Chasm.heroFall where the hero stands (the ground gave way under them: a cursed wand's sinkhole). */
export function heroFall(ctx: Ctx, hero: Hero): void {
  if (isBossDepth(hero.depth + 1) || hero.depth + 1 >= DEEPEST_AVAILABLE) return;
  fall(ctx, hero, hero.pos);
}

/**
 * InterlevelScene.Mode.RETURN to another depth, somewhere on it (a cursed wand's teleport across
 * floors): at a random spot, as RegularLevel.randomRespawnCell picks.
 */
export function sendHeroTo(ctx: Ctx, hero: Hero, depth: number): void {
  const { world } = ctx;
  const from = levelAt(world, hero.depth);
  leaveCell(world, from, hero.depth, hero.pos);
  hero.depth = depth;
  const there = floorAt(world, depth);
  hero.pos = landingCell(world, depth, new Rng(there.rng), false);
  hero.time = there.now;
  enterCell(levelAt(world, depth), hero.pos);
  observe(world, hero);
  ctx.effects.push({ type: 'teleported', hero: hero.id });
}

/** Level.press on a chasm: a hero no longer floating (or blinked onto it) falls through. */
function overChasm(ctx: Ctx, hero: Hero): void {
  if (!isAlive(hero) || hero.depth !== ctx.depth || (hero.levitating ?? 0) > 0) return;
  if (!hasFlag(ctx.level.map[hero.pos]!, F.PIT) || isBossDepth(hero.depth + 1) || hero.depth + 1 >= DEEPEST_AVAILABLE) return;
  fall(ctx, hero, hero.pos);
}

/** Where a hero may step: open ground, doors and visible traps, and chasms too while floating. */
export function heroCanEnter(level: Level, hero: Hero, pos: number): boolean {
  if (canEnter(level, pos)) return true;
  return (hero.levitating ?? 0) > 0 && Number.isInteger(pos) && pos >= 0 && pos < LENGTH && hasFlag(level.map[pos]!, F.PIT) &&
    pos % WIDTH > 0 && pos % WIDTH < WIDTH - 1 && pos >= WIDTH && pos < LENGTH - WIDTH;
}

const within = (room: { left: number; top: number; right: number; bottom: number }, pos: number): boolean =>
  cellX(pos) > room.left && cellX(pos) < room.right && cellY(pos) > room.top && cellY(pos) < room.bottom;

/** Rooms something falling from above may land in; never into a locked one, or a shop. */
const LANDING_ROOMS: ReadonlySet<RoomType> = new Set([
  RoomType.STANDARD, RoomType.TUNNEL, RoomType.PASSAGE, RoomType.ENTRANCE, RoomType.EXIT,
]);

/** Level.randomRespawnCell, or RegularLevel.pitCell for what comes through a weak floor. */
function landingCell(world: World, depth: number, rng: Rng, intoPit: boolean): number {
  const level = levelAt(world, depth);
  const pit = level.rooms.filter((room) => room.type === RoomType.PIT);
  const rooms = intoPit && pit.length > 0 ? pit : level.rooms.filter((room) => LANDING_ROOMS.has(room.type));
  for (let attempt = 0; attempt < 200 && rooms.length > 0; attempt++) {
    const room = rng.element(rooms)!;
    const pos = rng.intBetween(room.left + 1, room.right) + rng.intBetween(room.top + 1, room.bottom) * WIDTH;
    if (isPassable(level, pos) && !charAt(world, depth, pos)) return pos;
  }
  return freeCellNear(world, level, depth, level.entrance);
}

/** Dungeon.dropToChasm: what fell into a chasm turns up somewhere on the depth below. */
function itemsFall(world: World, depth: number): void {
  if (isBossDepth(depth + 1) || depth + 1 >= DEEPEST_AVAILABLE) return;
  const items = world.floors[depth]!.falling ?? [];
  delete world.floors[depth]!.falling;
  const floor = floorAt(world, depth + 1);
  const rng = new Rng(floor.rng);
  for (const item of items) dropItem(floor, landingCell(world, depth + 1, rng, false), item);
}

function place(world: World, hero: Hero, level: Level, near: number): void {
  hero.pos = freeCellNear(world, level, hero.depth, near);
  hero.time = floorAt(world, hero.depth).now;
  enterCell(level, hero.pos);
  observe(world, hero);
}

/**
 * Fallen heroes get back up at the stairs when a companion goes deeper than the party has
 * been before: going up and down again is no cure.
 */
function reviveFallen(world: World, depth: number, effects: Effect[]): void {
  // Worlds from before this was kept: as deep as anyone stands now.
  const reached = world.reached ?? Math.max(0, ...world.heroes.filter((h) => h.depth !== depth || !isAlive(h)).map((h) => h.depth));
  world.reached = Math.max(reached, depth);
  if (depth <= reached) return;
  const level = levelAt(world, depth);
  for (const fallen of world.heroes) {
    if (isAlive(fallen)) continue;
    // Back on their feet, rid of whatever ailed them.
    Object.assign(fallen, {
      hp: Math.max(1, Math.floor(fallen.ht / 2)), depth, intent: null, regen: 0, ooze: -1,
      poison: 0, burning: 0, paralysed: 0, rooted: 0, slowed: 0, hunger: 0, weakened: 0, crippled: 0, charmed: 0,
      charmedBy: null, deferred: 0, blind: 0, bleeding: 0,
    });
    place(world, fallen, level, level.entrance);
    effects.push({ type: 'revived', hero: fallen.id });
  }
}

/**
 * Shortest walkable path (excluding `from`), or null; used by clients for
 * tap-to-move. With `known`, the path only crosses explored cells, so tapping
 * never reveals the layout of unexplored areas.
 */
export function findPath(
  level: Level,
  from: number,
  to: number,
  blocked: ReadonlySet<number> = new Set(),
  known?: readonly boolean[],
  /** A floating hero drifts over chasms (and traps). */
  floating = false,
  /** Walk over visible traps too: for when no way around them exists. */
  throughTraps = false,
): number[] | null {
  if (known && !known[to]) return null;
  if (from === to) return [];
  const previous = new Map<number, number>([[from, -1]]);
  const queue = [from];
  for (let head = 0; head < queue.length; head++) {
    const cell = queue[head]!;
    for (const n of NEIGHBOURS8) {
      const next = cell + n;
      if (next < 0 || next >= LENGTH || previous.has(next) || !adjacent(cell, next)) continue;
      // A locked door may end a path: walking into it unlocks it with a key.
      const lockedGoal = next === to && (level.map[next] === T.LOCKED_DOOR || level.map[next] === T.LOCKED_EXIT);
      const overPit = floating && hasFlag(level.map[next]!, F.PIT) && canEnter(level, next) === false && next % WIDTH > 0 &&
        next % WIDTH < WIDTH - 1 && next >= WIDTH && next < LENGTH - WIDTH;
      if ((!canEnter(level, next) && !lockedGoal && !overPit) || (blocked.has(next) && next !== to)) continue;
      // Walk around visible traps, unless one is where the player wants to go or the hero floats.
      if (next !== to && !floating && !throughTraps && hasFlag(level.map[next]!, F.AVOID)) continue;
      if (known && !known[next]) continue;
      previous.set(next, cell);
      if (next === to) {
        const path = [to];
        for (let p = cell; p !== from; p = previous.get(p)!) path.unshift(p);
        return path;
      }
      queue.push(next);
    }
  }
  return null;
}
