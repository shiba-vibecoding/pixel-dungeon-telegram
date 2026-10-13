import { type Hero, isAlive, type Mob, type MobKind, type SubClass } from './actors';
import { DARKNESS, isChallenged, underChallenges } from './challenges';

import { castShadow, circleCells, LIGHT_DISTANCE, terrainBlocksSight, viewDistance } from './fov';
import { discoverable } from './level/flags';

import type { Enchantment, Glyph, Heap, HeapKind, Item, ItemKind } from './items';
import type { WellWater } from './level/builder';
import type { MeatOutcome } from './inventory';
import type { PlantInfo, PlantKind } from './plants';
import type { GhostErrand, GhostLine } from './quest';
import type { Burst, TrapKind } from './traps';
import type { WandmakerLine } from './wandmaker';
import type { ImpLine } from './imp';
import type { SmithLine } from './smith';
import type { Bolt } from './wands';
import { type GasKind, smokeCells } from './gas';
import { MAGICAL_SIGHT_DISTANCE } from './buffs';
import { EYE_OF_NEWT, trinketLevel } from './trinkets';
import type { Level } from './level/generate';
import { LENGTH, NEIGHBOURS8, WIDTH } from './level/geometry';
import { F, hasFlag, T } from './level/terrain';
import type { Rng, RngState } from './rng';
import type { World } from './world';

/*
 * The live part of a depth: its monsters, its clock and its random stream.
 * A depth only advances while a living hero is on it; otherwise it is frozen,
 * as levels the hero has left are in the original.
 */

export interface Floor {
  /** Live turns: where this depth's beat ends (see liveTick), and whether a fight is holding that beat up. */
  liveAt?: number;
  liveOpen?: boolean;
  mobs: Mob[];
  /** Random stream for everything that happens on this depth during play. */
  rng: RngState;
  /** The depth's clock: the time of the latest actor to act. */
  now: number;
  /** When the depth next tries to replenish its monsters; -1 on boss levels, which never do. */
  respawn: number;
  /** Items lying around, at most one heap per cell. */
  heaps: Heap[];
  /** Tengu's level: someone has set foot in the arena, and Tengu has appeared. */
  arenaEntered?: boolean;
  /** Plants growing here, set off by whoever steps on them. */
  plants?: PlantInfo[];
  /** Items that fell into a chasm here, on their way to the depth below. */
  falling?: Item[];
  /** Clouds of gas, as [cell, volume] pairs in cell order, and when they next spread (see gas.ts). */
  gas?: Partial<Record<GasKind, Array<[number, number]>>>;
  gasAt?: number;
  /** An altar room's sacrificial fire: where it burns, and how much more it hungers for (0 once it has gone out). */
  altar?: { pos: number; volume: number };
  /** CorrosiveGas.strength: how strong the depth's corrosive cloud is. */
  gasStrength?: { corrosive?: number };
  /** What this depth gave every hero (strength, upgrades): a hero who joins later gets theirs too (party.ts). */
  perHero?: ItemKind[];
}

/**
 * Level.drop: what the challenges forbid on the floor comes down as gold
 * instead; an item that comes down on a chasm falls through it, to land on
 * the depth below.
 */
export function landItem(ctx: Ctx, pos: number, item: Item): void {
  const landed = underChallenges(ctx.world, item);
  if (hasFlag(ctx.level.map[pos]!, F.PIT)) (ctx.floor.falling ??= []).push(landed);
  else dropItem(ctx.floor, pos, landed);
}

/** Puts an item on a cell, adding to whatever lies there already (Heap.drop: as it is, unlike landItem). */
export function dropItem(floor: Floor, pos: number, item: Item): void {
  const heap = floor.heaps.find((h) => h.pos === pos);
  if (!heap) {
    floor.heaps.push({ pos, kind: 'heap', items: [item] });
  } else if (heap.kind !== 'heap') {
    heap.items.push(item);
  } else {
    heap.items.unshift(item);
  }
}

export const isWater = (terrain: number): boolean => terrain >= T.WATER_TILES && terrain <= T.WATER;

/** What players should see happen; returned by every accepted action. */
export type Effect =
  | { type: 'attack'; depth: number; attacker: string; target: string; hit: boolean; damage: number }
  /** Someone died; for a monster, what it was and which hero (if any) slew it. */
  | { type: 'died'; depth: number; who: string; pos: number; kind?: MobKind; by?: string }
  | { type: 'noticed'; depth: number; mob: string }
  | { type: 'exp'; hero: string; amount: number }
  | { type: 'levelUp'; hero: string; lvl: number }
  | { type: 'revived'; hero: string }
  /** An ankh brought a hero back from death, at the stairs. */
  | { type: 'resurrected'; hero: string }
  /** An enchanted weapon showed its power on a blow; an inscribed armour on one taken. */
  | { type: 'enchanted'; depth: number; pos: number; enchant: Enchantment }
  | { type: 'glyph'; depth: number; hero: string; glyph: Glyph }
  /** A monster thrown back a step (armour of bounce). */
  | { type: 'pushed'; depth: number; mob: string; from: number; to: number }
  /** A scroll of enchantment gave an item its power; a scroll of upgrade drove one out. */
  | { type: 'imbued'; hero: string; item: Item }
  | { type: 'disenchanted'; hero: string; item: Item }
  /** The armour kit made a hero's armour into class armour; a class armour's special ability was used. */
  | { type: 'classArmor'; hero: string; item: Item }
  | { type: 'special'; hero: string; ability: 'leap' | 'moltenEarth' | 'smokeBomb' | 'blades'; from: number; to: number }
  /** A dwarf monk knocked the weapon out of a hero's hands; it lies at their feet. */
  | { type: 'disarmed'; depth: number; hero: string; mob: string; item: Item }
  /** A hero jumped into a chasm on `depth` and landed on the depth below. */
  | { type: 'fell'; hero: string; depth: number; pos: number }
  | { type: 'searched'; hero: string }
  | { type: 'discovered'; depth: number; cell: number }
  /** Damage that comes from no one, e.g. caustic ooze. */
  | { type: 'hurt'; depth: number; who: string; damage: number }
  | { type: 'oozed'; hero: string }
  | { type: 'pumped'; depth: number; mob: string }
  /** A boss speaks up; `hero` is whom it noticed. */
  | { type: 'yell'; depth: number; mob: string; kind: MobKind; line: 'notice' | 'death' | 'summon'; hero?: string }
  /** A warlock's shadow bolt left the hero weakened. */
  | { type: 'weakened'; hero: string }
  /** A seed took root; a plant was set off by someone stepping on it. */
  | { type: 'planted'; depth: number; pos: number; kind: PlantKind }
  | { type: 'plantTriggered'; depth: number; pos: number; kind: PlantKind; who: string }
  /** A gladiator's combo goes on; a hero masters a way. */
  | { type: 'combo'; hero: string; count: number }
  | { type: 'mastered'; hero: string; subclass: SubClass }
  /** Seeds in an alchemy pot brewed into a potion. */
  | { type: 'brewed'; depth: number; pos: number; hero?: string }
  /** A chest that was a mimic springs at the hero. */
  | { type: 'mimic'; depth: number; mob: string; hero: string }
  /** A torch lit; a succubus's charm; a scorpio's crippling sting. */
  | { type: 'lit'; hero: string }
  | { type: 'charmed'; hero: string }
  | { type: 'crippled'; hero: string }
  | { type: 'bossSlain'; depth: number; kind: MobKind }
  | { type: 'victory'; hero: string; ending: 'amulet' | 'surface' }
  /** The Amulet of Yendor taken up: its bearer is asked whether to end the run here (once a run). */
  | { type: 'amulet'; hero: string; first: boolean }
  | { type: 'opened'; depth: number; pos: number; heap: HeapKind }
  | { type: 'pickedUp'; hero: string; item: Item }
  /** Item.use: an upgraded item is about to break, or broke, from use (see wear.ts). */
  | { type: 'worn'; hero: string; item: Item; state: 'warning' | 'broken' }
  /** A scroll of upgrade read on a broken item mends it instead. */
  | { type: 'mended'; hero: string; item: Item }
  | { type: 'packFull'; hero: string }
  | { type: 'dropped'; hero: string; item: Item }
  | { type: 'equipped'; hero: string; item: Item }
  /** A potion drunk or a scroll read; `identified` when this taught the party what it is. */
  | { type: 'used'; hero: string; kind: ItemKind; identified: boolean }
  | { type: 'identified'; hero: string; kind: ItemKind }
  /** Everything about an item revealed: by a scroll of identify, or a well of awareness it was dropped into (ScrollOfIdentify: "It is %s"). */
  | { type: 'revealed'; hero: string; item: Item }
  /**
   * An item used long enough to know it (see ident.ts): a weapon's or armour's level, a ring or a wand
   * through and through; `learned` when this taught the party its kind as well.
   */
  | { type: 'familiar'; hero: string; item: Item; learned: boolean }
  /** A wand of unknown charges zapped with none left (Wand.zapper): it fizzles, and its level is known. */
  | { type: 'fizzled'; hero: string; item: Item }
  | { type: 'healed'; hero: string; amount: number }
  | { type: 'strength'; hero: string }
  | { type: 'upgraded'; hero: string; item: Item }
  | { type: 'teleported'; hero: string }
  | { type: 'mapped'; hero: string }
  | { type: 'scroll'; hero: string; kind: 'challenge' | 'lullaby' | 'recharging' | 'terror' | 'psionic' | 'removeCurse'; count: number }
  /** A hero put on something cursed: it will not come off. */
  | { type: 'cursedEquip'; hero: string; item: Item }
  /** A trap went off: under a hero (`hero`), a monster (`mob`, with `hero` empty) or nothing (an item landing on it). */
  | { type: 'trap'; depth: number; pos: number; kind: TrapKind; hero: string; mob?: string }
  /** Chasm.mobFall: a monster stepped (or was thrown) over a chasm and fell out of the level. */
  | { type: 'mobFell'; depth: number; mob: string; pos: number; kind: MobKind }
  | { type: 'thrown'; depth: number; from: number; to: number; item: ItemKind }
  /** A magic bolt: the mage's wand, or a shaman's lightning. */
  | { type: 'zapped'; depth: number; from: number; to: number; bolt?: Bolt }
  /** Rocks falling on these cells (wand of avalanche). */
  | { type: 'avalanche'; depth: number; cells: number[] }
  /** Magic sheep appear on these cells (wand of flock); one fades away; one is spoken to. */
  | { type: 'flock'; depth: number; cells: number[] }
  /** Mirror images of a hero appear on these cells. */
  | { type: 'mirrored'; depth: number; hero: string; cells: number[] }
  | { type: 'faded'; depth: number; mob: string; pos: number }
  | { type: 'baa'; depth: number; mob: string }
  /** Something thrown by a monster (Tengu's shuriken), drawn with an item sprite. */
  | { type: 'missile'; depth: number; from: number; to: number; sprite: number }
  /** Tengu vanishes in a puff of smoke and lands elsewhere. */
  | { type: 'jumped'; depth: number; mob: string; from: number; to: number }
  /** A thief made off with something from a hero's pack. */
  | { type: 'stole'; depth: number; mob: string; hero: string; item: Item }
  /** A fleeing thief with nowhere left to run turns to fight. */
  | { type: 'cornered'; depth: number; mob: string; kind: MobKind }
  /** A badly hurt brute flies into a rage. */
  | { type: 'enraged'; depth: number; mob: string }
  /** A skeleton falls apart in an explosion of bones. */
  | { type: 'bones'; depth: number; pos: number }
  /** A word with the shopkeeper: the hero may sell from the pack. */
  | { type: 'shop'; hero: string }
  | { type: 'bought'; hero: string; item: Item; price: number }
  | { type: 'sold'; hero: string; item: Item; price: number }
  /** Attacked, the shopkeeper vanished with his wares. */
  | { type: 'shopkeeperFled'; depth: number; mob: string; pos: number }
  /** Tengu's arena: sealed when the fight starts, opened when it ends. */
  | { type: 'arena'; depth: number; sealed: boolean }
  | { type: 'unlocked'; depth: number; pos: number; hero: string }
  | { type: 'ghost'; hero: string; line: GhostLine; errand: GhostErrand }
  /** The curse binding the sad ghost took shape and turned to fight. */
  | { type: 'cursed'; depth: number; mob: string; pos: number }
  /** A word with the Rat King. */
  | { type: 'ratKing'; hero: string; line: 'notSleeping' | 'busy' }
  | { type: 'well'; hero: string; water: WellWater }
  /** Something dropped into a well of transmutation came out as something else. */
  | { type: 'transmuted'; hero: string; from: Item; to: Item }
  | { type: 'wandmaker'; hero: string; line: WandmakerLine }
  | { type: 'imp'; hero: string; line: ImpLine }
  | { type: 'smith'; hero: string; line: SmithLine }
  /** A piece of dark gold ore mined out of a vein. */
  | { type: 'mined'; depth: number; pos: number; hero: string }
  /** Something eaten; mystery meat may disagree with the eater. */
  | { type: 'ate'; hero: string; kind: ItemKind; outcome: MeatOutcome | null }
  | { type: 'hunger'; hero: string; state: 'hungry' | 'starving' }
  /** Gas or flames released at a cell, reaching `radius` cells around. */
  | { type: 'burst'; depth: number; pos: number; kind: Burst; radius: number; silent?: boolean }
  /** DM-300 mended itself on a spent trap. */
  | { type: 'repaired'; depth: number; mob: string }
  /** A dewdrop picked up, and the health it gave. */
  | { type: 'dew'; hero: string; amount: number }
  /** Scrolls burnt up and meat cooked on a heap; a hero's scroll or meat caught fire in the pack. */
  | { type: 'heapBurnt'; depth: number; pos: number }
  | { type: 'burntUp'; hero: string; kind: ItemKind }
  /** Lloyd's beacon set, or used to return. */
  | { type: 'beacon'; hero: string; mode: 'set' | 'return' }
  /** Disturbed remains: wraiths rose, or the curse fell on whoever disturbed them. */
  | { type: 'wraiths'; depth: number; pos: number }
  /** A honeypot broke at rom, and a golden bee flew out to pos. */
  | { type: 'bee'; depth: number; pos: number; from: number }
  /** Dew kept in the dew vial; the vial drunk from; a full vial emptied to save its bearer from death. */
  | { type: 'dewCollected'; hero: string; full: boolean }
  | { type: 'vial'; hero: string; amount: number }
  | { type: 'vialSaved'; hero: string }
  /** The imp of the last shop greets the heroes. */
  | { type: 'greeting'; depth: number; mob: string }
  /** The sacrificial fire marked someone; an offering was made to it (the last one puts it out); a scroll of wipe out was read. */
  | { type: 'marked'; depth: number; who: string }
  | { type: 'sacrifice'; depth: number; pos: number; outcome: 'worthy' | 'unworthy' | 'reward' }
  | { type: 'wipedOut'; depth: number; hero: string }
  /** A bomb went off (which kind, for the special ones). */
  | { type: 'exploded'; depth: number; pos: number; bomb?: ItemKind }
  /** Terrain burnt down to embers, opening what it blocked. */
  | { type: 'burnt'; depth: number; pos: number }
  /** A thrown potion breaking; `identified` when what came out taught the party what it was. */
  | { type: 'shattered'; hero: string; depth: number; pos: number; kind: ItemKind; identified: boolean }
  /**
   * The arena of waves (arena.ts): a wave begins (its boss, if it has one); the last of it falls; a hero's
   * three rewards; a hero is ready for the next; the arena sinks to the next region's depth; its gates open or shut.
   */
  | { type: 'arenaWave'; depth: number; wave: number; champions: boolean; tier: number; count: number; boss?: MobKind }
  | { type: 'arenaCleared'; depth: number; wave: number }
  | { type: 'arenaOffer'; hero: string; items: Item[] }
  | { type: 'arenaReady'; hero: string; ready: boolean }
  | { type: 'arenaSinks'; depth: number; tier: number }
  | { type: 'arenaGates'; depth: number; open: boolean; cells: number[] }
  /*
   * Alchemy (alchemy.ts, potions.ts, reading.ts, stones.ts, spells.ts, bombs.ts, buffs.ts, trinkets.ts):
   * something brewed in the pot (null: a catalyst's trinkets rolled), its cost; an item turned into energy;
   * a catalyst's four trinkets offered.
   */
  | { type: 'crafted'; hero: string; item: Item | null; cost: number }
  | { type: 'energized'; hero: string; item: Item; energy: number }
  | { type: 'catalyst'; hero: string; trinkets: ItemKind[] }
  /** A monster enthralled by a siren's song; an elemental summoned; a lit fuse snuffed; a noisemaker's call. */
  | { type: 'enthralled'; depth: number; mob: string; hero: string }
  | { type: 'summoned'; depth: number; mob: string; pos: number }
  | { type: 'snuffed'; hero: string }
  | { type: 'noise'; depth: number; pos: number }
  /** A potion in a frozen hero's pack shattered; a challenge arena faded; a potion of healing began to heal. */
  | { type: 'frozenPotion'; hero: string; kind: ItemKind }
  | { type: 'arenaGone'; hero: string }
  | { type: 'healing'; hero: string }
  /** Ground changed by a blob (grass grown, water from a storm cloud or a geyser). */
  | { type: 'grown'; depth: number; pos: number }
  /** A potion breaking at a cell (its splash); a dragon's breath cone; an aqua brew's geyser. */
  | { type: 'splash'; depth: number; pos: number; kind: ItemKind }
  | { type: 'breath'; depth: number; from: number; to: number; cells: number[] }
  | { type: 'geyser'; depth: number; pos: number }
  /** What an unstable brew or spell turned out to be. */
  | { type: 'unstable'; hero: string; kind: ItemKind }
  /** A potion of mastery made an item easier; a potion of divine inspiration boosted a talent tier; a scroll of metamorphosis read. */
  | { type: 'masteryPotion'; hero: string; item: Item }
  | { type: 'inspired'; hero: string; tier: number }
  | { type: 'metamorphosis'; hero: string }
  /** Kinds a scroll of divination made known. */
  | { type: 'divined'; hero: string; kinds: ItemKind[] }
  /** A curse infused; a trap taken back by the spell; an item augmented; magic detected on an item; a guess of a stone of intuition. */
  | { type: 'curseInfused'; hero: string; item: Item }
  | { type: 'reclaimed'; hero: string; trap: TrapKind }
  | { type: 'augmented'; hero: string; item: Item }
  | { type: 'detected'; hero: string; item: Item; result: 'none' | 'good' | 'bad' | 'both' }
  | { type: 'guessed'; hero: string; kind: ItemKind; right: boolean }
  /** A thrown runestone working where it landed; a stone of shock's discharge. */
  | { type: 'stone'; depth: number; pos: number; kind: ItemKind }
  | { type: 'shock'; depth: number; pos: number; count: number }
  /** The chaotic censer spewing a gas. */
  | { type: 'censer'; hero: string; depth: number; from: number; to: number; gas: string }
  /** A queued action that became impossible before the hero's turn came. */
  | { type: 'interrupted'; hero: string; reason: string };

/** Everything the rules need while simulating one depth. */
export interface Ctx {
  world: World;
  depth: number;
  level: Level;
  floor: Floor;
  rng: Rng;
  effects: Effect[];
}

export type Char = Hero | Mob;

export const isHero = (char: Char): char is Hero => 'heroClass' in char;

export function heroesOn(world: World, depth: number): Hero[] {
  return world.heroes.filter((hero) => hero.depth === depth && isAlive(hero));
}

/** The living hero or monster standing on a cell. */
export function charAt(world: World, depth: number, cell: number): Char | undefined {
  return (
    world.heroes.find((hero) => hero.depth === depth && hero.pos === cell && isAlive(hero)) ??
    world.floors[depth]?.mobs.find((mob) => mob.pos === cell)
  );
}

/** Who a hero swaps places with: the quest givers and harmless wanderers, never a shopkeeper. */
const SWAPPERS: ReadonlySet<string> = new Set(['ghost', 'sheep', 'wandmaker', 'imp', 'blacksmith', 'ratKing']);

/**
 * Harmless folk a hero swaps places with rather than being stopped by (as in
 * later versions of the game): the sad ghost, magic sheep and the quest
 * givers, so that none of them can wall a hero into a corridor. Talking to
 * them is still a bump into them; walking past simply trades cells.
 */
export function swapsWithHero(char: Char | undefined): boolean {
  return char !== undefined && 'kind' in char && char.state === 'passive' && SWAPPERS.has(char.kind);
}

/** Level.viewDistance for heroes on a depth: shorter under the DARKNESS challenge. */
export const heroSight = (world: World, depth: number): number => viewDistance(depth, isChallenged(world, DARKNESS));

/** Field of view of one hero (Dungeon.switchLevel and Light: a torch lights up to Light.DISTANCE). */
export function heroView(world: World, hero: Hero): boolean[] {
  // Blinded, a hero sees no further than arm's reach; with an eye of newt, less far (EyeOfNewt.visionRangeMultiplier).
  let distance = (hero.blind ?? 0) > 0 ? 1
    : hero.light > 0 ? Math.max(heroSight(world, hero.depth), LIGHT_DISTANCE) : heroSight(world, hero.depth);
  const newt = trinketLevel(hero, 'trinket.eyeOfNewt');
  if (newt >= 0 && distance > 1) distance = Math.max(1, Math.round(distance * EYE_OF_NEWT.visionRangeMultiplier(newt)));
  // A smoke screen blocks sight (SmokeScreen.onBuildFlagMaps).
  const terrain = terrainBlocksSight(world.levels[hero.depth]!.map);
  const smoke = smokeCells(world.floors[hero.depth]);
  const fov = castShadow(hero.pos, smoke.size === 0 ? terrain : (cell) => terrain(cell) || smoke.has(cell), distance);
  // MagicalSight: everything there is to see within twelve cells, through walls (Level.updateFieldOfView's sense).
  if ((hero.buffs?.magicalSight ?? 0) > 0) {
    const open = discoverable(world.levels[hero.depth]!.map);
    for (const cell of circleCells(hero.pos, MAGICAL_SIGHT_DISTANCE)) if (open[cell]) fov[cell] = true;
  }
  // Arm's reach is always seen, round a corner or into a doorway too: whatever can strike the hero
  // (anything next to them may) is never an unseen blow.
  for (const n of NEIGHBOURS8) {
    const cell = hero.pos + n;
    if (cell >= 0 && cell < LENGTH && Math.abs((cell % WIDTH) - (hero.pos % WIDTH)) <= 1) fov[cell] = true;
  }
  return fov;
}

export function exploredCells(world: World, depth: number): boolean[] {
  return (world.explored[depth] ??= new Array<boolean>(LENGTH).fill(false));
}

/** Adds what a hero sees to the party's shared map. */
export function observe(world: World, hero: Hero): void {
  const explored = exploredCells(world, hero.depth);
  heroView(world, hero).forEach((seen, i) => {
    if (seen) explored[i] = true;
  });
}

/** Cells a hero may step on: open ground, doors and visible traps. */
export function canEnter(level: Level, pos: number): boolean {
  if (!Number.isInteger(pos) || pos < 0 || pos >= LENGTH) return false;
  const x = pos % WIDTH;
  if (pos < WIDTH || pos >= LENGTH - WIDTH || x === 0 || x === WIDTH - 1) return false;
  const terrain = level.map[pos]!;
  return hasFlag(terrain, F.PASSABLE) || (hasFlag(terrain, F.AVOID) && !hasFlag(terrain, F.PIT));
}

/** Ground monsters walk on: they step around traps. */
export function isPassable(level: Level, pos: number): boolean {
  return pos >= 0 && pos < LENGTH && hasFlag(level.map[pos]!, F.PASSABLE);
}

/* A door is open while someone stands in it, so it no longer blocks sight. */

export function enterCell(level: Level, pos: number): void {
  if (level.map[pos] === T.DOOR) {
    level.map[pos] = T.OPEN_DOOR;
  }
}

export function leaveCell(world: World, level: Level, depth: number, pos: number): void {
  if (level.map[pos] === T.OPEN_DOOR && !charAt(world, depth, pos)) {
    level.map[pos] = T.DOOR;
  }
}

/** The cell itself if free, otherwise the nearest free walkable cell. */
export function freeCellNear(world: World, level: Level, depth: number, pos: number): number {
  const seen = new Set([pos]);
  const queue = [pos];
  for (let head = 0; head < queue.length; head++) {
    const cell = queue[head]!;
    if (canEnter(level, cell) && !charAt(world, depth, cell)) {
      return cell;
    }
    for (const n of NEIGHBOURS8) {
      const next = cell + n;
      if (next >= 0 && next < LENGTH && !seen.has(next) && canEnter(level, next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return pos;
}
