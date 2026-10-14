import { Dungeon } from '../../dungeon';
import { Random } from '../../random';
import type { StandardRoom } from './standard';

/*
 * StandardRoom.createRoom, EntranceRoom.createEntrance and ExitRoom.createExit: which kinds of
 * room each depth draws from, with Shattered's chances. The rooms' modules register their makers
 * (rooms/index.ts); a kind with no maker yet is never drawn.
 */

export const STANDARD_ROOMS = new Map<string, () => StandardRoom>();

const STANDARD_KINDS = [
  'SewerPipeRoom', 'RingRoom', 'WaterBridgeRoom', 'RegionDecoPatchRoom', 'CircleBasinRoom',
  'RegionDecoLineRoom', 'SegmentedRoom', 'PillarsRoom', 'ChasmBridgeRoom', 'CellBlockRoom',
  'CaveRoom', 'RegionDecoBridgeRoom', 'CavesFissureRoom', 'CirclePitRoom', 'CircleWallRoom',
  'HallwayRoom', 'LibraryHallRoom', 'LibraryRingRoom', 'StatuesRoom', 'SegmentedLibraryRoom',
  'RuinsRoom', 'RegionDecoPatchRoom', 'ChasmRoom', 'SkullsRoom', 'RitualRoom',
  'PlantsRoom', 'AquariumRoom', 'PlatformRoom', 'BurnedRoom', 'FissureRoom', 'GrassyGraveRoom', 'StripedRoom', 'StudyRoom',
  'SuspiciousChestRoom', 'MinefieldRoom',
];

const STANDARD_CHANCES: number[][] = (() => {
  const c: number[][] = [];
  c[1] = [16, 8, 8, 4, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 1, 0, 1, 1, 0, 0];
  c[2] = [16, 8, 8, 4, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1];
  c[4] = c[3] = c[2];
  c[5] = [16, 8, 8, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  c[6] = [0, 0, 0, 0, 0, 10, 10, 10, 5, 5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1];
  c[10] = c[9] = c[8] = c[7] = c[6];
  c[11] = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 16, 8, 8, 4, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1];
  c[15] = c[14] = c[13] = c[12] = c[11];
  c[16] = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 10, 10, 10, 5, 5, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1];
  c[20] = c[19] = c[18] = c[17] = c[16];
  c[21] = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 10, 10, 10, 5, 5, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1];
  c[26] = c[25] = c[24] = c[23] = c[22] = c[21];
  return c;
})();

const ENTRANCE_KINDS = [
  'WaterBridgeEntranceRoom', 'RegionDecoPatchEntranceRoom', 'RingEntranceRoom', 'CircleBasinEntranceRoom',
  'RegionDecoLineEntranceRoom', 'ChasmBridgeEntranceRoom', 'PillarsEntranceRoom', 'CellBlockEntranceRoom',
  'CaveEntranceRoom', 'RegionDecoBridgeEntranceRoom', 'CavesFissureEntranceRoom', 'CircleWallEntranceRoom',
  'HallwayEntranceRoom', 'StatuesEntranceRoom', 'LibraryHallEntranceRoom', 'LibraryRingEntranceRoom',
  'RegionDecoPatchEntranceRoom', 'RuinsEntranceRoom', 'ChasmEntranceRoom', 'RitualEntranceRoom',
];

const EXIT_KINDS = [
  'WaterBridgeExitRoom', 'RegionDecoPatchExitRoom', 'RingExitRoom', 'CircleBasinExitRoom',
  'RegionDecoLineExitRoom', 'ChasmBridgeExitRoom', 'PillarsExitRoom', 'CellBlockExitRoom',
  'CaveExitRoom', 'RegionDecoBridgeExitRoom', 'CavesFissureExitRoom', 'CircleWallExitRoom',
  'HallwayExitRoom', 'StatuesExitRoom', 'LibraryHallExitRoom', 'LibraryRingExitRoom',
  'RegionDecoPatchExitRoom', 'RuinsExitRoom', 'ChasmExitRoom', 'RitualExitRoom',
];

const ENTRANCE_CHANCES: number[][] = (() => {
  const c: number[][] = [];
  // The first two floors only use the simpler entrance rooms.
  c[1] = [4, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  c[2] = c[1];
  c[3] = [4, 3, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  c[5] = c[4] = c[3];
  c[6] = [0, 0, 0, 0, 4, 3, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  c[10] = c[9] = c[8] = c[7] = c[6];
  c[11] = [0, 0, 0, 0, 0, 0, 0, 0, 4, 3, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0];
  c[15] = c[14] = c[13] = c[12] = c[11];
  c[16] = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 3, 2, 1, 0, 0, 0, 0];
  c[20] = c[19] = c[18] = c[17] = c[16];
  c[21] = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 3, 2, 1];
  c[26] = c[25] = c[24] = c[23] = c[22] = c[21];
  return c;
})();

const EXIT_CHANCES: number[][] = (() => {
  const c: number[][] = [];
  // Floor 1 only uses the simpler exit rooms.
  c[1] = [4, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  c[2] = [4, 3, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  c[5] = c[4] = c[3] = c[2];
  c[6] = [0, 0, 0, 0, 4, 3, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  c[10] = c[9] = c[8] = c[7] = c[6];
  c[11] = [0, 0, 0, 0, 0, 0, 0, 0, 4, 3, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0];
  c[15] = c[14] = c[13] = c[12] = c[11];
  c[16] = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 3, 2, 1, 0, 0, 0, 0];
  c[20] = c[19] = c[18] = c[17] = c[16];
  c[21] = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 3, 2, 1];
  c[26] = c[25] = c[24] = c[23] = c[22] = c[21];
  return c;
})();

const depthRow = (table: number[][]): number[] => table[Math.min(Math.max(Dungeon.depth, 1), 26)]!;

/** Draws a kind by the chances, among those with a maker (the plain room of its sort if none has one). */
function draw(kinds: readonly string[], chances: readonly number[], fallback: string): StandardRoom {
  const available = chances.map((c, i) => (STANDARD_ROOMS.has(kinds[i]!) ? c : 0));
  const index = Random.chances(available);
  return STANDARD_ROOMS.get(index < 0 ? fallback : kinds[index]!)!();
}

/** StandardRoom.createRoom. */
export const createStandardRoom = (): StandardRoom => draw(STANDARD_KINDS, depthRow(STANDARD_CHANCES), 'EmptyRoom');
/** EntranceRoom.createEntrance. */
export const createEntranceRoom = (): StandardRoom => draw(ENTRANCE_KINDS, depthRow(ENTRANCE_CHANCES), 'EntranceRoom');
/** ExitRoom.createExit. */
export const createExitRoom = (): StandardRoom => draw(EXIT_KINDS, depthRow(EXIT_CHANCES), 'ExitRoom');
