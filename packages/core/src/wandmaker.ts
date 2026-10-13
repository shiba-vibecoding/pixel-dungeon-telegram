import { createMob, type Hero } from './actors';
import { mobDied } from './combat';
import { charAt, type Ctx, dropItem, enterCell, heroSight, heroView, isPassable } from './floor';
import { collect } from './inventory';
import { identify } from './ident';
import { type Item, type ItemKind, wandMaxCharges } from './items';
import { addQuestScore } from './quest';
import { adjacent, distance, LENGTH, WIDTH } from './level/geometry';
import { JAVA_N8 } from './wandmaker-mobs';
import { F, hasFlag, T } from './level/terrain';
import { Dungeon } from './level/gen/dungeon';
import { Generator } from './level/gen/generator';
import { QuestHooks } from './level/gen/quests';
import { Random } from './level/gen/random';
import type { RegularLevel } from './level/gen/regular-level';
import type { Room } from './level/gen/room';
import { MassGraveRoom, RitualSiteRoom, RotGardenRoom } from './level/gen/rooms/quest/wandmaker-rooms';
import type { World } from './world';

/*
 * The old wandmaker of the prison (Wandmaker and Wandmaker.Quest): once a run, on depth 7, 8 or 9
 * (the deeper, the likelier), he waits in the entrance room, with two wands for whoever fetches what
 * he came for. Each errand has a room of its own on his level: corpse dust from the barricaded mass
 * grave (a curse that raises wraiths round its carrier, CorpseDust.DustGhostSpawner), embers of a
 * newborn fire elemental summoned by four ceremonial candles at the ritual site (CeremonialCandle),
 * or a rotberry seed from the heart of the locked rot garden (RotHeart, RotLasher: wandmaker-mobs.ts).
 */

/** Wandmaker.Quest.type: 1 the corpse dust, 2 the elemental's embers, 3 the rotberry seed. */
export type WandmakerType = 1 | 2 | 3;

export interface WandmakerQuest {
  type: WandmakerType;
  /** Quest.spawned: he is on his level (until then the type is only chosen, for a level being made anew). */
  spawned: boolean;
  depth: number;
  /** He has told the hero his errand. */
  given: boolean;
  /** The two wands on offer, upgraded once; both null once the quest is complete (Quest.complete). */
  wand1: Item | null;
  wand2: Item | null;
  /** CeremonialCandle.ritualPos: the middle of the ritual site's marker (the embers' errand). */
  ritualPos?: number;
  /** CorpseDust.DustGhostSpawner: the spawn power of the curse on each hero who took the dust up. */
  spawners?: Record<string, number>;
}

/** Older name, kept for the World's field. */
export type WandQuest = WandmakerQuest;

/** What he says: the errand (two windows, the hero's class's greeting first), a reminder, the wands on offer, his farewell. */
export type WandmakerLine = 'intro' | 'reminder' | 'reward' | 'farewell';

/** What the client is told of the quest's doings besides his words. */
export type WandmakerEffect =
  | { type: 'wandmaker'; hero: string; line: WandmakerLine; questType: WandmakerType }
  /** CorpseDust.doPickUp: «A chill runs down your spine.» */
  | { type: 'corpseDust'; hero: string }
  /** DustGhostSpawner: a wraith of the dust rose (Wraith.spawnAt, CURSED). */
  | { type: 'dustWraith'; depth: number; mob: string; pos: number }
  /** CeremonialCandle.checkCandles: the candles round the marker alight; all four: the elemental bursts out (BURNING). */
  | { type: 'ritual'; depth: number; pos: number; lit: number[]; mob?: string }
  /** NewbornFireElemental: charging up a blast at these cells («charging», GameScene.targetedCell); then the blast. */
  | { type: 'elementalCharge'; depth: number; mob: string; cells: number[] }
  | { type: 'elementalBlast'; depth: number; mob: string; from: number; to: number; cells: number[] }
  /** RotLasher.act: with nobody at hand, it mends (FloatingText.HEALING). */
  | { type: 'lasherMends'; depth: number; mob: string; amount: number };

/** What he is after, by errand (WndWandmaker's quest item). */
export const WANDMAKER_WANTS: Readonly<Record<WandmakerType, ItemKind>> = { 1: 'quest.dust', 2: 'quest.embers', 3: 'seed.rotberry' };

/** Quest.complete: the wands are given. */
export const wandmakerDone = (quest: WandmakerQuest | null | undefined): boolean => !!quest && quest.spawned && !quest.wand1;

/** Quest.spawnRoom chose a room for this level; Quest.spawnWandmaker then places him (one level's making). */
let questRoomSpawned = false;

/**
 * Wandmaker.Quest.spawnRoom (PrisonLevel.initRooms): until he has appeared, a level deeper than 6
 * gets his quest room one time in (10 - depth), the errand chosen at random (and kept, should the
 * level be made anew).
 */
export function spawnWandmakerRoom(rooms: Room[]): Room[] {
  questRoomSpawned = false;
  const world = Dungeon.world;
  if (!world || world.mode === 'arena') return rooms;
  const quest = world.wandQuest;
  const type = quest && !quest.spawned ? quest.type : 0;
  if (!quest?.spawned && (type !== 0 || (Dungeon.depth > 6 && Random.Int(10 - Dungeon.depth) === 0))) {
    // Decide between 1, 2 or 3.
    const chosen = type !== 0 ? type : ((Random.Int(3) + 1) as WandmakerType);
    world.wandQuest = { type: chosen, spawned: false, depth: Dungeon.depth, given: false, wand1: null, wand2: null };
    rooms.push(chosen === 2 ? new RitualSiteRoom() : chosen === 3 ? new RotGardenRoom() : new MassGraveRoom());
    questRoomSpawned = true;
  }
  return rooms;
}

/**
 * Wandmaker.Quest.spawnWandmaker (PrisonLevel.createMobs): in the entrance room, two cells in from
 * its walls if he can (a cell, then anywhere, after thirty tries each), never on the way in, beside a
 * door, on a trap or on special floor; and his two wands rolled, of different kinds, uncursed and
 * upgraded once.
 */
export function spawnWandmaker(level: RegularLevel): void {
  if (!questRoomSpawned) return;
  questRoomSpawned = false;
  const world = Dungeon.world;
  const quest = world?.wandQuest;
  const room = level.roomEntrance;
  if (!world || !quest || !room) return;
  const gen = level.level;

  let pos: number;
  let validPos: boolean;
  let tries = 0;
  let dist = 2;
  let guard = 0;
  do {
    validPos = true;
    if (tries > 30 && dist > 0) {
      tries = 0;
      dist--;
    }
    pos = gen.pointToCell(room.random(dist));
    if (pos === gen.entrance() || gen.solid[pos]) validPos = false;
    for (const i of gen.neighbours4) if (gen.map[pos + i] === T.DOOR) validPos = false;
    if (gen.traps.has(pos) || !gen.passable[pos] || gen.map[pos] === T.EMPTY_SP) validPos = false;
    tries++;
  } while (!validPos && ++guard < 10_000);
  if (!validPos) return;
  gen.mobs.push({ kind: 'wandmaker', pos, state: 'passive' });

  quest.spawned = true;
  quest.depth = Dungeon.depth;
  quest.given = false;
  const wand1 = Generator.random('WAND');
  delete wand1.cursed;
  upgradeWand(wand1);

  let wand2 = Generator.random('WAND');
  // SEAM(wands): Generator.undoDrop for the wands drawn again (the wand deck is the wands stream's).
  while (wand2.kind === wand1.kind) wand2 = Generator.random('WAND');
  delete wand2.cursed;
  upgradeWand(wand2);
  quest.wand1 = wand1;
  quest.wand2 = wand2;

  if (quest.type === 2) {
    const site = level.rooms.find((r): r is RitualSiteRoom => r instanceof RitualSiteRoom);
    if (site?.ritualPoint) quest.ritualPos = gen.pointToCell(site.ritualPoint);
  }
}

/** SEAM(wands): Wand.upgrade: a level more (and a chance in three of lifting a curse), and a charge more. */
function upgradeWand(wand: Item): void {
  wand.level++;
  if (Random.Int(3) === 0) delete wand.cursed;
  wand.charges = Math.min((wand.charges ?? 0) + 1, wandMaxCharges(wand));
}

QuestHooks.wandmakerRoom = spawnWandmakerRoom;
QuestHooks.wandmaker = spawnWandmaker;

/** The backpack slot of what he is after (Belongings.getItem: in a bag too), or -1. */
function wantedIndex(world: World, hero: Hero): number {
  const quest = world.wandQuest;
  return quest ? hero.items.findIndex((item) => item.kind === WANDMAKER_WANTS[quest.type]) : -1;
}

/**
 * Wandmaker.interact: the first time, his errand (Quest.given); then, with what he wants in the
 * pack, his wands on offer (WndWandmaker), else a reminder.
 */
export function talkToWandmaker(ctx: Ctx, hero: Hero): void {
  const quest = ctx.world.wandQuest;
  if (!quest?.spawned || wandmakerDone(quest)) return;
  let line: WandmakerLine;
  if (quest.given) {
    line = wantedIndex(ctx.world, hero) >= 0 ? 'reward' : 'reminder';
  } else {
    quest.given = true;
    line = 'intro';
  }
  ctx.effects.push({ type: 'wandmaker', hero: hero.id, line, questType: quest.type });
}

export function wandRewardProblem(world: World, hero: Hero, choice: unknown): string | null {
  const quest = world.wandQuest;
  if (!quest?.given || wandmakerDone(quest) || wantedIndex(world, hero) < 0) return 'nothing to give';
  if (choice !== 1 && choice !== 2) return 'bad choice';
  const wandmaker = world.floors[hero.depth]?.mobs.find((mob) => mob.kind === 'wandmaker');
  return wandmaker && adjacent(wandmaker.pos, hero.pos) ? null : 'the wandmaker is not here';
}

/**
 * WndWandmaker.selectReward: what he wanted leaves the pack (the corpse dust's curse with it), the
 * chosen wand is known through and through and taken (or lies by him if there is no room); he
 * wishes the hero luck and is gone (Quest.complete: the dust's errand scores here, the others when
 * their foe falls).
 */
export function wandFromWandmaker(ctx: Ctx, hero: Hero, choice: 1 | 2): void {
  const quest = ctx.world.wandQuest!;
  const wanted = hero.items[wantedIndex(ctx.world, hero)]!;
  // Item.detach: one of a stack.
  if (--wanted.qty <= 0) hero.items.splice(hero.items.indexOf(wanted), 1);
  // CorpseDust.onDetach: the curse is dispelled.
  if (wanted.kind === 'quest.dust') dispelDust(ctx, hero);

  const reward = (choice === 1 ? quest.wand1 : quest.wand2)!;
  identify(ctx.world, reward);
  const wandmaker = ctx.floor.mobs.find((mob) => mob.kind === 'wandmaker');
  if (collect(hero, reward)) ctx.effects.push({ type: 'pickedUp', hero: hero.id, item: reward });
  else dropItem(ctx.floor, wandmaker?.pos ?? hero.pos, reward);

  ctx.effects.push({ type: 'wandmaker', hero: hero.id, line: 'farewell', questType: quest.type });
  if (wandmaker) {
    ctx.floor.mobs.splice(ctx.floor.mobs.indexOf(wandmaker), 1);
    ctx.effects.push({ type: 'died', depth: ctx.depth, who: wandmaker.id, pos: wandmaker.pos, kind: 'wandmaker' });
  }
  quest.wand1 = null;
  quest.wand2 = null;
  if (quest.type === 1) addQuestScore(ctx.world, 1, 2000);
}

/* Corpse dust (items/quest/CorpseDust) */

/** CorpseDust.doPickUp: taken up, the dust chills its carrier, and its curse (DustGhostSpawner) takes hold. */
export function dustPickedUp(ctx: Ctx, hero: Hero): void {
  const quest = ctx.world.wandQuest;
  if (!quest) return;
  ctx.effects.push({ type: 'corpseDust', hero: hero.id });
  (quest.spawners ??= {})[hero.id] ??= 0;
}

/** Wraith.SPAWN_DELAY. */
const WRAITH_SPAWN_DELAY = 2;

/**
 * CorpseDust.DustGhostSpawner.act, once a turn: while the hero carries the dust, its power grows a
 * point a turn, and once it reaches the square of the dust wraiths there would be (49 at most), a
 * new one rises somewhere the hero can see, out of reach (beyond a third of the hero's sight);
 * with nowhere for it, the power is held back to twice their number. Without the dust it falls to 0.
 */
export function dustSpawnerTurn(ctx: Ctx, hero: Hero): void {
  const spawners = ctx.world.wandQuest?.spawners;
  const power = spawners?.[hero.id];
  if (!spawners || power === undefined) return;
  if (!hero.items.some((item) => item.kind === 'quest.dust')) {
    spawners[hero.id] = 0;
    return;
  }
  let spawnPower = power + 1;
  // The wraith to come counts too.
  const wraiths = 1 + ctx.floor.mobs.filter((mob) => mob.dust !== undefined).length;
  // 1/4/9/16/25/36/49/49/... turns of power for each wraith.
  const powerNeeded = Math.min(49, wraiths * wraiths);
  if (powerNeeded <= spawnPower) {
    const fov = heroView(ctx.world, hero);
    // At least 4/3/2/1 cells away at a sight of 8 (the usual)/7/4/1.
    const minDist = Math.floor(Math.fround(heroSight(ctx.world, hero.depth) / 3) + 0.5);
    const candidates: number[] = [];
    for (let i = 0; i < LENGTH; i++) {
      if (fov[i] && !hasFlag(ctx.level.map[i]!, F.SOLID) && !charAt(ctx.world, ctx.depth, i) && distance(i, hero.pos) > minDist) candidates.push(i);
    }
    if (candidates.length > 0) {
      spawnDustWraith(ctx, ctx.rng.element(candidates)!);
      spawnPower -= powerNeeded;
    } else {
      // No excessive build-up of power.
      spawnPower = Math.min(spawnPower, 2 * wraiths);
    }
  }
  spawners[hero.id] = spawnPower;
}

/** Wraith.spawnAt(pos, DustWraith): as strong as the depth, hunting at once, a little after it appears. */
function spawnDustWraith(ctx: Ctx, pos: number): void {
  const wraith = createMob(`#${++ctx.world.nextId}`, 'wraith', pos, 'hunting', ctx.floor.now + WRAITH_SPAWN_DELAY);
  wraith.level = ctx.depth;
  wraith.dust = 0;
  wraith.enemySeen = true;
  ctx.floor.mobs.push(wraith);
  enterCell(ctx.level, pos);
  ctx.effects.push({ type: 'dustWraith', depth: ctx.depth, mob: wraith.id, pos });
}

/** DustGhostSpawner.dispel: the curse lifted, every dust wraith on the level falls. */
export function dispelDust(ctx: Ctx, hero: Hero): void {
  const spawners = ctx.world.wandQuest?.spawners;
  if (spawners) delete spawners[hero.id];
  for (const mob of ctx.floor.mobs.filter((m) => m.dust !== undefined)) {
    mobDied(ctx, mob);
  }
}

/** CorpseDust: no actions at all, not even dropping it. */
export const UNDROPPABLE: ReadonlySet<ItemKind> = new Set<ItemKind>(['quest.dust']);

/* Ceremonial candles (items/quest/CeremonialCandle) */

/**
 * CeremonialCandle.checkCandles, when a candle is dropped or thrown: on the ritual site, the candles
 * lying (in plain heaps) on the four cells beside the marker's middle are alight; with all four,
 * they are spent and a newborn fire elemental bursts out, hunting, where the middle is (beside it,
 * should someone stand there).
 */
export function checkCandles(ctx: Ctx): void {
  const ritualPos = ctx.world.wandQuest?.ritualPos;
  if (ritualPos === undefined) return;
  const x = ritualPos % WIDTH;
  const y = Math.trunc(ritualPos / WIDTH);
  const room = ctx.level.rooms.find((r) => x > r.left && x < r.right && y > r.top && y < r.bottom);
  if (room?.kind !== 'RitualSiteRoom') return;

  const cells = [ritualPos - WIDTH, ritualPos + 1, ritualPos + WIDTH, ritualPos - 1];
  const heaps = cells.map((cell) => ctx.floor.heaps.find((h) => h.pos === cell));
  const lit: number[] = [];
  let allCandles = true;
  for (const heap of heaps) {
    if (heap && heap.kind === 'heap' && heap.items.some((item) => item.kind === 'quest.candle')) lit.push(heap.pos);
    else allCandles = false;
  }
  if (!allCandles) {
    if (lit.length > 0) ctx.effects.push({ type: 'ritual', depth: ctx.depth, pos: ritualPos, lit });
    return;
  }

  for (const heap of heaps as NonNullable<(typeof heaps)[number]>[]) {
    heap.items = heap.items.filter((item) => item.kind !== 'quest.candle');
    if (heap.items.length === 0) ctx.floor.heaps.splice(ctx.floor.heaps.indexOf(heap), 1);
  }

  let pos = ritualPos;
  if (charAt(ctx.world, ctx.depth, ritualPos)) {
    const candidates = JAVA_N8.map((n) => ritualPos + n).filter((cell) =>
      (isPassable(ctx.level, cell) || hasFlag(ctx.level.map[cell]!, F.AVOID)) && !charAt(ctx.world, ctx.depth, cell));
    if (candidates.length > 0) pos = ctx.rng.element(candidates)!;
  }
  // GameScene.add(elemental, 1): it acts a turn later. Elemental.rangedCooldown is rolled as it is made.
  const elemental = createMob(`#${++ctx.world.nextId}`, 'newbornElemental', pos, 'hunting', ctx.floor.now + 1);
  elemental.rangedCooldown = ctx.rng.normalIntRange(3, 5);
  elemental.targetingPos = -1;
  ctx.floor.mobs.push(elemental);
  enterCell(ctx.level, pos);
  ctx.effects.push({ type: 'ritual', depth: ctx.depth, pos: ritualPos, lit, mob: elemental.id });
}

/** Whether the quest's hero has the dust's curse on them (for the client's music and the HUD). */
export const dustCursed = (world: World, hero: Hero): boolean => world.wandQuest?.spawners?.[hero.id] !== undefined;

/** For tests: makes the next prison level its quest room's level, with this errand. */
export function forceWandmakerType(world: World, type: WandmakerType): void {
  world.wandQuest = { type, spawned: false, depth: 0, given: false, wand1: null, wand2: null };
}

