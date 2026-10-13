import { type MobKind, rollMob } from '../../actors';
import { Dungeon } from './dungeon';
import { Random } from './random';
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
}

export const QuestHooks = {
  /** SEAM(mobs): Level.createMob (Bestiary.getMobRotation, champions); Pixel Dungeon's bestiary stands in. */
  createMob(): MobChoice {
    return { kind: rollMob(Random.rng, Dungeon.depth, false) };
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
