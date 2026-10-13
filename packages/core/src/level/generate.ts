import type { MobKind } from '../actors';
import type { PlantInfo } from '../plants';
import type { ArenaRing } from './arena';
import { deriveSeed, Rng, Stream } from '../rng';
import { type RunState, useSpecial } from '../run';
import { Feeling, isBossDepth, type ItemSpawn, type ItemSpec, LAST_SHOP_DEPTH, LevelBuilder, type WellWater } from './builder';
import { stitchTerrain } from './flags';
import { SOLO_SPAN } from './geometry';
import { PAINTERS } from './painters';
import { RoomType } from './room';
import { CAVES_STYLE } from './caves';
import { CITY_STYLE } from './city';
import { HALLS_STYLE } from './halls';
import { buildLastShopLevel, LAST_SHOP_STYLE } from './last-shop';
import { buildHallsBossLevel, buildLastLevel, HALLS_BOSS_STYLE, LAST_STYLE } from './halls-boss';
import { buildCityBossLevel, CITY_BOSS_STYLE } from './city-boss';
import { buildCavesBossLevel, CAVES_BOSS_STYLE } from './caves-boss';
import { PRISON_STYLE } from './prison';
import { buildPrisonBossLevel, PRISON_BOSS_STYLE } from './prison-boss';
import { buildRegularLevel as buildRegular, type RegionStyle } from './regular';
import { SEWER_STYLE } from './sewer';
import { buildSewerBossLevel, SEWER_BOSS_STYLE } from './sewer-boss';

export interface RoomInfo {
  left: number;
  top: number;
  right: number;
  bottom: number;
  type: RoomType;
}

/** A generated level as plain, serialisable data. */
export interface Level {
  depth: number;
  feeling: Feeling;
  map: number[];
  entrance: number;
  exit: number;
  rooms: RoomInfo[];
  /** Item drops requested by the layout, rolled later from the item stream. */
  items: ItemSpawn[];
  /** Items to drop anywhere on the level, such as the key to a locked room. */
  toSpawn: ItemSpec[];
  /** Magic wells that still hold water. */
  wells: Array<{ pos: number; water: WellWater }>;
  secretDoors: number;
  /** Tengu's level: the door into the arena. */
  arenaDoor?: number;
  /** A shop's level: where the shopkeeper stands. */
  shopkeeper?: number;
  /** Where the troll blacksmith keeps his forge. */
  blacksmith?: number;
  /** Where the sacrificial fire of an altar room burns, and how much it hungers for. */
  altar?: { pos: number; volume: number };
  /** Where the Rat King holds court, beside Goo's lair. */
  ratKing?: number;
  /** Where an animated statue stands guard, and a pool's piranhas swim. */
  statue?: number;
  piranhas?: number[];
  /** Plants the level starts with (a garden's sungrass). */
  plants?: PlantInfo[];
  /**
   * The region whose look the level takes (0 sewers .. 4 demon halls), when it is not its depth's
   * (the arena of waves takes each tier's look); absent: the depth's own.
   */
  region?: number;
  /** The arena of waves: its dais, gates and pens (level/arena.ts). */
  ring?: ArenaRing;
  /**
   * Tall grass the huntress has passed through (Terrain.FURROWED_GRASS): it still stands, but sheds
   * nothing more. A seam for the levels stream, which brings Shattered's terrains: until then such
   * cells stay HIGH_GRASS and are listed here.
   */
  furrowed?: number[];
  /** Level.mobsToSpawn: what is left of the depth's rotation of monsters (MobSpawner, spawner.ts). */
  mobRotation?: MobKind[];
  /** Where a demon spawner pulses (DemonSpawnerRoom). SEAM(levels): the room places it; the monsters' stream raises it (ai.ts populate). */
  demonSpawner?: number;
}

/** How each depth is laid out (Dungeon.newLevel): each region's levels and its boss's, the last shop, the Amulet's hall. */
function layoutFor(depth: number): { style: RegionStyle; build: (level: LevelBuilder) => boolean } {
  if (depth === 5) return { style: SEWER_BOSS_STYLE, build: buildSewerBossLevel };
  if (depth === 10) return { style: PRISON_BOSS_STYLE, build: buildPrisonBossLevel };
  if (depth === 15) return { style: CAVES_BOSS_STYLE, build: buildCavesBossLevel };
  if (depth === 20) return { style: CITY_BOSS_STYLE, build: buildCityBossLevel };
  if (depth === LAST_SHOP_DEPTH) return { style: LAST_SHOP_STYLE, build: buildLastShopLevel };
  if (depth === 25) return { style: HALLS_BOSS_STYLE, build: buildHallsBossLevel };
  if (depth === 26) return { style: LAST_STYLE, build: buildLastLevel };
  const style = depth < 5 ? SEWER_STYLE : depth < 10 ? PRISON_STYLE : depth < 15 ? CAVES_STYLE : depth < 20 ? CITY_STYLE : HALLS_STYLE;
  return { style, build: (level) => buildRegular(level, style) };
}

/** The deepest depth the port can generate. */
export const DEEPEST_LEVEL = 26;

const MAX_ATTEMPTS = 128;

function rollFeeling(rng: Rng, depth: number): Feeling {
  if (depth <= 1 || isBossDepth(depth) || depth >= 26) {
    return Feeling.NONE;
  }
  switch (rng.int(10)) {
    case 0:
      return isBossDepth(depth + 1) ? Feeling.NONE : Feeling.CHASM;
    case 1:
      return Feeling.WATER;
    case 2:
      return Feeling.GRASS;
    default:
      return Feeling.NONE;
  }
}

/**
 * Generates the layout of `depth` for a run. Levels must be generated in
 * order of depth, because a weak floor on one level puts a pit room on the
 * next and special rooms rotate through the run.
 *
 * `impQuestDone` (Imp.Quest.isCompleted) is the one piece of the world
 * beyond the run that shapes a layout: the last shop's level (depth 21) only
 * has its shop once the imp's errand is done. It is read when the depth is
 * first made, from the world every client and the room share.
 */
export function generateLevel(run: RunState, depth: number, span = SOLO_SPAN, impQuestDone = false): Level {
  if (depth < 1 || depth > DEEPEST_LEVEL) {
    throw new Error(`Depth ${depth} is not generated yet; the port covers the sewers and the prison (1-${DEEPEST_LEVEL})`);
  }

  const rng = Rng.seeded(deriveSeed(run.seed, Stream.LAYOUT, depth));
  const feeling = rollFeeling(rng, depth);
  const pitNeeded = depth > 1 && run.weakFloorCreated;
  const boss = isBossDepth(depth);

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    // Each attempt starts clean: a failed one leaves no rooms, items or
    // rotated specials behind (the original kept some of them).
    const specials = boss
      ? []
      : run.specials.filter((type) => PAINTERS.has(type) && !(type === RoomType.WEAK_FLOOR && isBossDepth(depth + 1)));
    const level = new LevelBuilder(rng, depth, feeling, specials, boss ? SOLO_SPAN : span);
    level.pitRoomNeeded = pitNeeded && !boss;
    level.blacksmithWanted = !run.blacksmithSpawned;
    level.impQuestDone = impQuestDone;
    const { style, build } = layoutFor(depth);
    if (!build(level)) {
      continue;
    }

    style.decorate(level);
    stitchTerrain(level.map);

    for (const used of level.usedSpecials) {
      useSpecial(run, used);
    }
    run.weakFloorCreated = level.weakFloorCreated;
    if (level.blacksmithPlaced) run.blacksmithSpawned = true;
    // Pixel Dungeon's dew vial no longer turns up in the sewers: every hero sets out with a waterskin (HeroClass.initHero).

    return {
      depth,
      feeling,
      map: level.map,
      entrance: level.entrance,
      exit: level.exit,
      rooms: level.rooms.map(({ left, top, right, bottom, type }) => ({ left, top, right, bottom, type })),
      items: level.items,
      toSpawn: level.toSpawn,
      wells: level.wells,
      secretDoors: level.secretDoors,
      ...(level.arenaDoor >= 0 ? { arenaDoor: level.arenaDoor } : {}),
      ...(level.shopkeeper >= 0 ? { shopkeeper: level.shopkeeper } : {}),
      ...(level.statue >= 0 ? { statue: level.statue } : {}),
      ...(level.blacksmith >= 0 ? { blacksmith: level.blacksmith } : {}),
      ...(level.ratKing >= 0 ? { ratKing: level.ratKing } : {}),
      ...(level.altar ? { altar: level.altar } : {}),
      ...(level.piranhas.length > 0 ? { piranhas: level.piranhas } : {}),
      ...(level.plants.length > 0 ? { plants: level.plants } : {}),
    };
  }
  throw new Error(`Unable to generate depth ${depth} after ${MAX_ATTEMPTS} attempts`);
}
