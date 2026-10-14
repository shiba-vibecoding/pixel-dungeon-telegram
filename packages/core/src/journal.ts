import { type Hero, heroBelongings, type MobKind } from './actors';
import { heroView } from './floor';
import { questCompleted, rewardsAvailable } from './blacksmith';
import { lostPackOn } from './ankh';
import { Feeling } from './level/gen/dungeon';
import { cellX, cellY, WIDTH } from './level/geometry';
import { RoomType } from './level/room';
import { T } from './level/terrain';
import type { World } from './world';

/*
 * The journal's notes (Notes.LandmarkRecord), as Shattered Pixel Dungeon keeps
 * them: a depth's feeling as the hero arrives (GameScene), and what the hero
 * has seen there worth coming back to — a shop, an alchemy pot, a garden, the
 * wells, the sacrificial fire, an animated statue, where a beacon is set, and
 * the dungeon's people (Hero.checkVisibleMobs and the blobs' landmarks). A
 * note goes once it is no use any more (Notes.remove): a well drunk from, the
 * fire put out, the statue slain, the shopkeeper fled, a quest done.
 *
 * Kept on the world (World.notes), in the order they were made; the journal
 * lists them deepest first (Notes.Record.compareTo), each depth's in the
 * landmarks' order.
 */

/** Notes.Landmark, of what this dungeon has (and Pixel Dungeon's well of transmutation beside the other wells). */
export const LANDMARKS = [
  'chasmFloor', 'waterFloor', 'grassFloor', 'darkFloor', 'largeFloor', 'trapsFloor', 'secretsFloor',
  'shop', 'alchemy', 'garden', 'wellOfHealth', 'wellOfAwareness', 'wellOfTransmutation', 'sacrificialFire', 'statue',
  'beaconLocation', 'demonSpawner', 'distantWell', 'lostPack',
  'ghost', 'ratKing', 'wandmaker', 'troll', 'imp',
] as const;
export type Landmark = (typeof LANDMARKS)[number];

export interface Note {
  landmark: Landmark;
  depth: number;
}

/** Level.Feeling's landmarks (read at call time: dungeon.ts may not be loaded yet when this module is). */
function feelingNote(feeling: Feeling): Landmark | undefined {
  switch (feeling) {
    case Feeling.CHASM: return 'chasmFloor';
    case Feeling.WATER: return 'waterFloor';
    case Feeling.GRASS: return 'grassFloor';
    case Feeling.DARK: return 'darkFloor';
    case Feeling.LARGE: return 'largeFloor';
    case Feeling.TRAPS: return 'trapsFloor';
    case Feeling.SECRETS: return 'secretsFloor';
    default: return undefined;
  }
}

const WELL_NOTES = { health: 'wellOfHealth', awareness: 'wellOfAwareness', transmutation: 'wellOfTransmutation' } as const;

/** Mob.landmark: who is worth a note once seen. */
const MOB_NOTES: Partial<Record<MobKind, Landmark>> = {
  shopkeeper: 'shop', impShopkeeper: 'shop', statue: 'statue', ghost: 'ghost', ratKing: 'ratKing', wandmaker: 'wandmaker',
  blacksmith: 'troll', imp: 'imp', spawner: 'demonSpawner',
};

/** Notes.add: a note, once. */
export function addNote(world: World, landmark: Landmark, depth: number): void {
  const notes = (world.notes ??= []);
  if (!notes.some((note) => note.landmark === landmark && note.depth === depth)) notes.push({ landmark, depth });
}

/**
 * Hero.checkVisibleMobs and its blob scan, and GameScene's feeling: the landmarks in the hero's sight
 * are noted, and the notes that are no use any more go.
 */
export function noteLandmarks(world: World, hero: Hero): void {
  const depth = hero.depth;
  const level = world.levels[depth];
  const floor = world.floors[depth];
  if (!level || !floor || world.arena) return;
  const feeling = feelingNote(level.feeling);
  if (feeling) addNote(world, feeling, depth);
  const fov = heroView(world, hero);
  for (const mob of floor.mobs) {
    const landmark = MOB_NOTES[mob.kind];
    // RatKing.landmark: only beside Goo's lair.
    if (landmark && fov[mob.pos] && (mob.kind !== 'ratKing' || depth === 5)) addNote(world, landmark, depth);
  }
  for (const well of level.wells) if (fov[well.pos]) addNote(world, WELL_NOTES[well.water], depth);
  // WeakFloorRoom.WellID: the well glimpsed below the weak floor.
  for (const tile of level.customTiles ?? []) {
    if (tile.kind === 'WeakFloorRoom.HiddenWell' && fov[tile.x + tile.y * WIDTH]) addNote(world, 'distantWell', depth);
  }
  if (floor.altar && floor.altar.volume > 0 && fov[floor.altar.pos]) addNote(world, 'sacrificialFire', depth);
  if (level.map.some((terrain, cell) => terrain === T.ALCHEMY && fov[cell])) addNote(world, 'alchemy', depth);
  // Foliage, the garden's blob: a cell of the garden in sight.
  for (const room of level.rooms) {
    if (room.type !== RoomType.GARDEN) continue;
    if (fov.some((seen, cell) => seen && cellX(cell) > room.left && cellX(cell) < room.right && cellY(cell) > room.top && cellY(cell) < room.bottom)) {
      addNote(world, 'garden', depth);
    }
  }
  // BeaconOfReturning: where a hero's beacon is set (Lloyd's beacon, here).
  for (const other of world.heroes) {
    for (const item of heroBelongings(other)) if (item.kind === 'artifact.beacon' && item.returnTo) addNote(world, 'beaconLocation', item.returnTo.depth);
  }
  prune(world);
}

/** Notes.remove(landmark, depth). */
export function removeNote(world: World, landmark: Landmark, depth: number): void {
  if (world.notes) world.notes = world.notes.filter((note) => note.landmark !== landmark || note.depth !== depth);
}

/** Notes.remove, for whatever is no use any more. */
function prune(world: World): void {
  if (!world.notes) return;
  world.notes = world.notes.filter((note) => stillUseful(world, note));
}

function stillUseful(world: World, { landmark, depth }: Note): boolean {
  const level = world.levels[depth];
  const floor = world.floors[depth];
  const has = (kind: MobKind): boolean => (floor?.mobs ?? []).some((mob) => mob.kind === kind);
  switch (landmark) {
    // WellWater.affect: drunk from, or something dropped in, the well is used up.
    case 'wellOfHealth': return !!level?.wells.some((well) => well.water === 'health');
    case 'wellOfAwareness': return !!level?.wells.some((well) => well.water === 'awareness');
    case 'wellOfTransmutation': return !!level?.wells.some((well) => well.water === 'transmutation');
    // SacrificialFire: put out once it has had enough.
    case 'sacrificialFire': return (floor?.altar?.volume ?? 0) > 0;
    // Statue.die; Shopkeeper.flee.
    case 'statue': return has('statue');
    // DemonSpawner.die.
    case 'demonSpawner': return has('spawner');
    // LostBackpack.doPickUp.
    case 'lostPack': return lostPackOn(world, depth);
    case 'shop': return has('shopkeeper') || has('impShopkeeper');
    // Ghost.Quest.complete, Wandmaker's and the Imp's quests done, the Blacksmith's rewards all given.
    case 'ghost': return !world.quest?.done;
    case 'wandmaker': return !(world.wandQuest?.spawned && !world.wandQuest.wand1);
    case 'imp': return !world.impQuest?.done;
    // Blacksmith.landmark: until the errand is over and nothing is left to have of him.
    case 'troll': return !world.smithQuest || !questCompleted(world.smithQuest) || rewardsAvailable(world.smithQuest);
    case 'beaconLocation':
      return world.heroes.some((hero) => heroBelongings(hero).some((item) => item.kind === 'artifact.beacon' && item.returnTo?.depth === depth));
    default:
      return true;
  }
}

/** The journal's order: deepest first, then each depth's in the landmarks' order (Notes.getRecords). */
export function journalNotes(world: World): Note[] {
  return [...(world.notes ?? [])].sort((a, b) => b.depth - a.depth || LANDMARKS.indexOf(a.landmark) - LANDMARKS.indexOf(b.landmark));
}
