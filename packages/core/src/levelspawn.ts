import { createMob, type Mob, type MobKind, mobStats } from './actors';
import type { Floor } from './floor';
import type { Level } from './level/generate';
import type { MobSpawn } from './level/gen/genlevel';
import { scaleMob } from './party';
import { linkMineMobs } from './minemobs';
import type { World } from './world';

/*
 * The monsters and characters a Shattered level was made with (Level.mobs at creation): made into
 * the world's Mobs when the depth is first visited.
 */

/** Monsters whose numbers grow with the depth they are placed on (Mob level, see actors.ts mobStats). */
const DEPTH_SCALED = new Set(['statue', 'piranha', 'mimic', 'wraith', 'curse', 'bee']);

/**
 * Kinds the rooms place that another stream ports (SEAM(mobs)), and what stands in for them: an armoured
 * statue is an animated statue (its armour kept for when it comes), a phantom piranha a piranha.
 */
const STAND_INS: Readonly<Record<string, MobKind>> = { armoredStatue: 'statue', phantomPiranha: 'piranha' };

export function mobFromSpawn(world: World, level: Level, spec: MobSpawn): Mob {
  const { kind: placed, pos, ...extra } = spec;
  const kind = STAND_INS[placed] ?? placed;
  const mob = createMob(`#${++world.nextId}`, kind, pos, spec.state ?? 'sleeping', 0);
  Object.assign(mob, extra);
  // Statue: it waits, still, until disturbed (our statues sleep where Shattered's are passive).
  if (kind === 'statue' && mob.state === 'passive') mob.state = 'sleeping';
  if (DEPTH_SCALED.has(kind)) {
    mob.level ??= level.depth;
    mob.ht = mob.hp = mobStats(mob).ht;
  }
  return mob.state === 'passive' ? mob : scaleMob(world, mob);
}

/** The level's own characters, made into Mobs; the spawn list is then dropped from the level. */
export function spawnLevelMobs(world: World, level: Level): Mob[] {
  const mobs = (level.spawn?.mobs ?? []).map((spec) => mobFromSpawn(world, level, spec));
  // GnollSapper.linkPartner: the blacksmith's mine's sappers and their guards.
  linkMineMobs(mobs);
  if (level.spawn) level.spawn.mobs = [];
  return mobs;
}

/** Moves what else the level was made with onto its floor: plants (heaps are rolled into place by world.ts). */
export function spawnLevelPlants(level: Level, floor: Floor): void {
  if (!level.spawn) return;
  floor.plants = [...(floor.plants ?? []), ...level.spawn.plants];
  level.spawn.plants = [];
}
