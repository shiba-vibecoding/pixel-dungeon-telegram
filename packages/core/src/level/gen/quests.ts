import { createMob, type MobKind } from '../../actors';
import { hasProp } from '../../props';
import { mobRotation } from '../../spawner';
import { Dungeon } from './dungeon';
import { Random } from './random';
import type { GenLevel, MobSpawn } from './genlevel';
import type { Room } from './room';
import type { RegularLevel } from './regular-level';

/*
 * Where level generation hands over to the quests and the monsters: each quest module registers
 * its part here (Ghost.Quest.spawn, Wandmaker.Quest.spawnRoom and spawnWandmaker,
 * Blacksmith.Quest.spawn, Imp.Quest.spawn), so the rooms and builders need not know them.
 */

export interface MobChoice {
  kind: MobKind;
  /** Char.Property.LARGE: needs open space. */
  large?: boolean;
  /** What else the monster is made with (rolled as it is made: a crystal wisp's colour). */
  extra?: Partial<MobSpawn>;
}

export const QuestHooks = {
  /**
   * Level.createMob: the next of the level's rotation of monsters (MobSpawner.getMobRotation), a new one when it
   * runs out; what is left of it the level keeps for its respawns. (Champions are rolled as the monsters come.)
   */
  createMob(level: GenLevel): MobChoice {
    if (level.mobRotation.length === 0) level.mobRotation = mobRotation(Random.rng, Dungeon.depth, Dungeon.world ?? undefined);
    const kind = level.mobRotation.shift()!;
    return { kind, large: hasProp(createMob('', kind, 0, 'sleeping', 0), 'large') };
  },

  /** Ghost.Quest.spawn(level, roomExit), from SewerLevel.createMobs. */
  ghost: null as ((level: RegularLevel) => void) | null,
  /** Wandmaker.Quest.spawnRoom, from PrisonLevel.initRooms. */
  wandmakerRoom: null as ((rooms: Room[]) => Room[]) | null,
  /** Wandmaker.Quest.spawnWandmaker(level, roomEntrance), from PrisonLevel.createMobs. */
  wandmaker: null as ((level: RegularLevel) => void) | null,
  /** Blacksmith.Quest.spawn, from CavesLevel.initRooms. */
  blacksmith: null as ((rooms: Room[]) => Room[]) | null,
  /** Imp.Quest.spawn, from CityLevel.initRooms. */
  imp: null as ((rooms: Room[]) => Room[]) | null,
};
