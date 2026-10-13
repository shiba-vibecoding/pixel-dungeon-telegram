import { createItem } from '../../items';
import type { TrapKind } from '../trapdefs';
import { Feeling } from './dungeon';
import type { GenLevel } from './genlevel';
import { CavesPainter, CityPainter, HallsPainter, PrisonPainter, SewerPainter } from './painters/regions';
import { QuestHooks } from './quests';
import { Random } from './random';
import type { RegionConfig } from './regular-level';
import { Dungeon } from './dungeon';
import { SPECIAL_ROOMS } from './rooms/special/special';

/* levels/SewerLevel, PrisonLevel, CavesLevel, CityLevel and HallsLevel: what each region's floors are made of. */

const water = (level: GenLevel, normal: number, flooded: number): number => (level.feeling === Feeling.WATER ? flooded : normal);
const grass = (level: GenLevel, normal: number, grassy: number): number => (level.feeling === Feeling.GRASS ? grassy : normal);

export const SEWER_LEVEL: RegionConfig = {
  // 4 to 6, 5 on average; 1 to 2 special rooms, 1.8 on average.
  standardRooms: (forceMax) => (forceMax ? 6 : 4 + Random.chances([1, 3, 1])),
  specialRooms: (forceMax) => (forceMax ? 2 : 1 + Random.chances([1, 4])),
  painter(level, nTraps) {
    return new SewerPainter()
      .setWater(water(level, 0.3, 0.85), 5)
      .setGrass(grass(level, 0.2, 0.8), 4)
      .setTraps(nTraps, this.trapClasses(), this.trapChances());
  },
  trapClasses: (): TrapKind[] => (Dungeon.depth === 1
    ? ['wornDart']
    : ['chilling', 'shocking', 'toxic', 'wornDart', 'alarm', 'ooze', 'confusion', 'flock', 'summoning', 'teleportation', 'gateway']),
  trapChances: () => (Dungeon.depth === 1 ? [1] : [4, 4, 4, 4, 2, 2, 1, 1, 1, 1, 1]),
  beforeMobs: (level) => QuestHooks.ghost?.(level),
};

export const PRISON_LEVEL: RegionConfig = {
  // 5 to 6; 1 to 3 special rooms, 2 on average.
  standardRooms: (forceMax) => (forceMax ? 6 : 5 + Random.chances([1, 1])),
  specialRooms: (forceMax) => (forceMax ? 3 : 1 + Random.chances([1, 3, 1])),
  painter(level, nTraps) {
    return new PrisonPainter()
      .setWater(water(level, 0.3, 0.9), 4)
      .setGrass(grass(level, 0.2, 0.8), 3)
      .setTraps(nTraps, this.trapClasses(), this.trapChances());
  },
  trapClasses: (): TrapKind[] => [
    'chilling', 'shocking', 'toxic', 'burning', 'poisonDart', 'alarm', 'ooze', 'gripping',
    'confusion', 'flock', 'summoning', 'teleportation', 'gateway', 'geyser',
  ],
  trapChances: () => [4, 4, 4, 4, 4, 2, 2, 2, 1, 1, 1, 1, 1, 1],
  initRooms: (rooms) => QuestHooks.wandmakerRoom?.(rooms) ?? rooms,
  beforeMobs: (level) => QuestHooks.wandmaker?.(level),
};

export const CAVES_LEVEL: RegionConfig = {
  // 6 to 7, 6.33 on average; 2 to 3 special rooms, 2.2 on average.
  standardRooms: (forceMax) => (forceMax ? 7 : 6 + Random.chances([2, 1])),
  specialRooms: (forceMax) => (forceMax ? 3 : 2 + Random.chances([4, 1])),
  painter(level, nTraps) {
    return new CavesPainter()
      .setWater(water(level, 0.3, 0.85), 6)
      .setGrass(grass(level, 0.15, 0.65), 3)
      .setTraps(nTraps, this.trapClasses(), this.trapChances());
  },
  trapClasses: (): TrapKind[] => [
    'burning', 'poisonDart', 'frost', 'storm', 'corrosion', 'gripping', 'rockfall', 'guardian',
    'confusion', 'summoning', 'warping', 'pitfall', 'gateway', 'geyser',
  ],
  trapChances: () => [4, 4, 4, 4, 4, 2, 2, 2, 1, 1, 1, 1, 1, 1],
  initRooms: (rooms) => QuestHooks.blacksmith?.(rooms) ?? rooms,
};

export const CITY_LEVEL: RegionConfig = {
  // 6 to 8, 7 on average; 2 to 3 special rooms, 2.33 on average.
  standardRooms: (forceMax) => (forceMax ? 8 : 6 + Random.chances([1, 3, 1])),
  specialRooms: (forceMax) => (forceMax ? 3 : 2 + Random.chances([2, 1])),
  painter(level, nTraps) {
    return new CityPainter()
      .setWater(water(level, 0.3, 0.9), 4)
      .setGrass(grass(level, 0.2, 0.8), 3)
      .setTraps(nTraps, this.trapClasses(), this.trapChances());
  },
  trapClasses: (): TrapKind[] => [
    'frost', 'storm', 'corrosion', 'blazing', 'disintegration', 'rockfall', 'flashing', 'guardian', 'weakening',
    'disarming', 'summoning', 'warping', 'cursing', 'pitfall', 'distortion', 'gateway', 'geyser',
  ],
  trapChances: () => [4, 4, 4, 4, 4, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1],
  initRooms: (rooms) => QuestHooks.imp?.(rooms) ?? rooms,
};

export const HALLS_LEVEL: RegionConfig = {
  // 8 to 9, 8.33 on average; 2 to 3 special rooms, 2.5 on average.
  standardRooms: (forceMax) => (forceMax ? 9 : 8 + Random.chances([2, 1])),
  specialRooms: (forceMax) => (forceMax ? 3 : 2 + Random.chances([1, 1])),
  painter(level, nTraps) {
    return new HallsPainter()
      .setWater(water(level, 0.15, 0.7), 6)
      .setGrass(grass(level, 0.1, 0.65), 3)
      .setTraps(nTraps, this.trapClasses(), this.trapChances());
  },
  trapClasses: (): TrapKind[] => [
    'frost', 'storm', 'corrosion', 'blazing', 'disintegration', 'rockfall', 'flashing', 'guardian', 'weakening',
    'disarming', 'summoning', 'warping', 'cursing', 'grim', 'pitfall', 'distortion', 'gateway', 'geyser',
  ],
  trapChances: () => [4, 4, 4, 4, 4, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  // HallsLevel.initRooms: a demon spawner on every floor.
  initRooms: (rooms) => {
    const spawner = SPECIAL_ROOMS.get('DemonSpawnerRoom');
    if (spawner) rooms.push(spawner());
    return rooms;
  },
  // HallsLevel.create: two torches for the dark.
  create: (level) => {
    level.addItemToSpawn(createItem('torch'));
    level.addItemToSpawn(createItem('torch'));
  },
  // HallsLevel: the deeper, the darker.
  viewDistance: (vd) => Math.min(26 - Dungeon.depth, vd),
};

/** Which region a regular depth belongs to (Dungeon.newLevel). */
export function regionFor(depth: number): RegionConfig {
  if (depth <= 4) return SEWER_LEVEL;
  if (depth <= 9) return PRISON_LEVEL;
  if (depth <= 14) return CAVES_LEVEL;
  if (depth <= 19) return CITY_LEVEL;
  return HALLS_LEVEL;
}
