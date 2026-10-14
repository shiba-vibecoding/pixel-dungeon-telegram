import { isBossDepth, type Level, T, type TrapKind, type World } from '@pd/core';
import { LEVELS_EN, LEVELS_RU } from './i18n-levels';
import { lang } from './i18n';

/*
 * Level.tileName and tileDesc, with each region's own (SewerLevel ... HallsLevel, MiningLevel),
 * and the traps' and feelings' names, from Shattered's texts (i18n-levels.ts).
 */

/** A line of Shattered's texts by its full key, in the player's language ('' if none). */
export function lt(key: string, ...args: Array<string | number>): string {
  const text = (lang === 'ru' ? LEVELS_RU : LEVELS_EN)[key] ?? LEVELS_EN[key] ?? '';
  return args.reduce<string>((s, arg, i) => s.replace(new RegExp(`%${i + 1}\\$[sd]`, 'g'), String(arg)).replace('%s', String(arg)).replace('%d', String(arg)), text);
}

/** Shattered's _highlighted_ words, plain. */
export const plain = (text: string): string => text.replace(/_([^_\n]+)_/g, '$1');

const L = (k: string): string => lt(`levels.level.${k}`);

/** Level.tileName. */
function baseName(tile: number): string {
  switch (tile) {
    case T.CHASM: return L('chasm_name');
    case T.EMPTY: case T.EMPTY_SP: case T.EMPTY_DECO: case T.CUSTOM_DECO_EMPTY: case T.SECRET_TRAP: return L('floor_name');
    case T.GRASS: return L('grass_name');
    case T.WATER: return L('water_name');
    case T.WALL: case T.WALL_DECO: case T.SECRET_DOOR: return L('wall_name');
    case T.DOOR: return L('closed_door_name');
    case T.OPEN_DOOR: return L('open_door_name');
    case T.ENTRANCE: case T.ENTRANCE_SP: return L('entrace_name');
    case T.EXIT: return L('exit_name');
    case T.EMBERS: return L('embers_name');
    case T.FURROWED_GRASS: return L('furrowed_grass_name');
    case T.LOCKED_DOOR: case T.HERO_LKD_DR: return L('locked_door_name');
    case T.CRYSTAL_DOOR: return L('crystal_door_name');
    case T.PEDESTAL: return L('pedestal_name');
    case T.BARRICADE: return L('barricade_name');
    case T.HIGH_GRASS: return L('high_grass_name');
    case T.LOCKED_EXIT: return L('locked_exit_name');
    case T.UNLOCKED_EXIT: return L('unlocked_exit_name');
    case T.WELL: return L('well_name');
    case T.EMPTY_WELL: return L('empty_well_name');
    case T.STATUE: case T.STATUE_SP: return L('statue_name');
    case T.INACTIVE_TRAP: return L('inactive_trap_name');
    case T.BOOKSHELF: return L('bookshelf_name');
    case T.ALCHEMY: return L('alchemy_name');
    default: return L('default_name');
  }
}

/** Level.tileDesc. */
function baseDesc(tile: number): string {
  switch (tile) {
    case T.CHASM: return L('chasm_desc');
    case T.WATER: return L('water_desc');
    case T.ENTRANCE: case T.ENTRANCE_SP: return L('entrance_desc');
    case T.EXIT: case T.UNLOCKED_EXIT: return L('exit_desc');
    case T.EMBERS: return L('embers_desc');
    case T.HIGH_GRASS: case T.FURROWED_GRASS: return L('high_grass_desc');
    case T.LOCKED_DOOR: case T.HERO_LKD_DR: return L('locked_door_desc');
    case T.CRYSTAL_DOOR: return L('crystal_door_desc');
    case T.LOCKED_EXIT: return L('locked_exit_desc');
    case T.BARRICADE: return L('barricade_desc');
    case T.INACTIVE_TRAP: return L('inactive_trap_desc');
    case T.STATUE: case T.STATUE_SP: return L('statue_desc');
    case T.ALCHEMY: return L('alchemy_desc');
    case T.EMPTY_WELL: return L('empty_well_desc');
    default: return '';
  }
}

type Region = 'sewer' | 'prison' | 'caves' | 'city' | 'halls' | 'mining';

function regionOf(level: Level): Region {
  if (level.mine) return 'mining';
  const region = level.region ?? Math.trunc((level.depth - 1) / 5);
  return (['sewer', 'prison', 'caves', 'city', 'halls'] as const)[Math.min(4, Math.max(0, region))]!;
}

/** The region levels' own names (SewerLevel.tileName ... MiningLevel.tileName); undefined: the level's. */
function regionName(region: Region, tile: number): string | undefined {
  const R = (k: string): string => lt(`levels.${region}level.${k}`);
  switch (region) {
    case 'sewer':
      if (tile === T.WATER) return R('water_name');
      if (tile === T.REGION_DECO || tile === T.REGION_DECO_ALT) return R('region_deco_name');
      return undefined;
    case 'prison':
      if (tile === T.WATER) return R('water_name');
      if (tile === T.REGION_DECO) return R('region_deco_name');
      if (tile === T.REGION_DECO_ALT) return R('region_deco_alt_name');
      return undefined;
    case 'caves':
      if (tile === T.GRASS) return R('grass_name');
      if (tile === T.HIGH_GRASS) return R('high_grass_name');
      if (tile === T.WATER) return R('water_name');
      if (tile === T.REGION_DECO || tile === T.REGION_DECO_ALT) return R('region_deco_name');
      return undefined;
    case 'city':
      if (tile === T.WATER) return R('water_name');
      if (tile === T.HIGH_GRASS) return R('high_grass_name');
      if (tile === T.REGION_DECO || tile === T.REGION_DECO_ALT) return R('region_deco_name');
      return undefined;
    case 'halls':
      if (tile === T.WATER) return R('water_name');
      if (tile === T.GRASS) return R('grass_name');
      if (tile === T.HIGH_GRASS) return R('high_grass_name');
      if (tile === T.STATUE || tile === T.STATUE_SP) return R('statue_name');
      if (tile === T.REGION_DECO || tile === T.REGION_DECO_ALT) return R('region_deco_name');
      return undefined;
    case 'mining':
      if (tile === T.MINE_CRYSTAL) return R('crystal_name');
      if (tile === T.MINE_BOULDER) return R('boulder_name');
      // The mine is in the caves.
      return regionName('caves', tile);
  }
}

/** The region levels' own descriptions. */
function regionDesc(region: Region, tile: number): string | undefined {
  const R = (k: string): string => lt(`levels.${region}level.${k}`);
  switch (region) {
    case 'sewer':
      if (tile === T.EMPTY_DECO) return R('empty_deco_desc');
      if (tile === T.BOOKSHELF) return R('bookshelf_desc');
      if (tile === T.REGION_DECO || tile === T.REGION_DECO_ALT) return R('region_deco_desc');
      return undefined;
    case 'prison':
      if (tile === T.EMPTY_DECO) return R('empty_deco_desc');
      if (tile === T.BOOKSHELF) return R('bookshelf_desc');
      if (tile === T.REGION_DECO) return R('region_deco_desc');
      if (tile === T.REGION_DECO_ALT) return R('region_deco_alt_desc');
      return undefined;
    case 'caves':
      if (tile === T.ENTRANCE || tile === T.ENTRANCE_SP) return R('entrance_desc');
      if (tile === T.EXIT) return R('exit_desc');
      if (tile === T.HIGH_GRASS) return R('high_grass_desc');
      if (tile === T.WALL_DECO) return R('wall_deco_desc');
      if (tile === T.BOOKSHELF) return R('bookshelf_desc');
      if (tile === T.REGION_DECO || tile === T.REGION_DECO_ALT) return R('region_deco_desc');
      return undefined;
    case 'city':
      if (tile === T.ENTRANCE || tile === T.ENTRANCE_SP) return R('entrance_desc');
      if (tile === T.EXIT) return R('exit_desc');
      if (tile === T.WALL_DECO || tile === T.EMPTY_DECO) return R('deco_desc');
      if (tile === T.STATUE || tile === T.STATUE_SP) return R('statue_desc');
      if (tile === T.BOOKSHELF) return R('bookshelf_desc');
      if (tile === T.REGION_DECO || tile === T.REGION_DECO_ALT) return R('region_deco_desc');
      return undefined;
    case 'halls':
      if (tile === T.WATER) return R('water_desc');
      if (tile === T.STATUE || tile === T.STATUE_SP) return R('statue_desc');
      if (tile === T.BOOKSHELF) return R('bookshelf_desc');
      if (tile === T.REGION_DECO || tile === T.REGION_DECO_ALT) return R('region_deco_desc');
      return undefined;
    case 'mining':
      if (tile === T.WALL) return R('wall_desc');
      if (tile === T.WALL_DECO) return `${regionDesc('caves', tile) ?? baseDesc(tile)}\n\n${R('gold_extra_desc')}`;
      if (tile === T.MINE_CRYSTAL) return R('crystal_desc');
      if (tile === T.MINE_BOULDER) return R('boulder_desc');
      if (tile === T.BARRICADE) return R('barricade_desc');
      return regionDesc('caves', tile);
  }
}

/** Level.tileName and tileDesc of a terrain on a level. */
export function terrainText(level: Level, tile: number): { name: string; desc: string } {
  const region = regionOf(level);
  return { name: regionName(region, tile) ?? baseName(tile), desc: plain(regionDesc(region, tile) ?? baseDesc(tile)) };
}

/** Shattered's class name of each trap, as its texts are keyed (levels.traps.<name>.*). */
export const trapKey = (kind: TrapKind): string =>
  kind === 'toxicVent' ? 'levels.rooms.special.toxicgasroom$toxicvent' : `levels.traps.${kind.toLowerCase()}trap`;

/** Trap.name and Trap.desc. */
export function trapText(kind: TrapKind): { name: string; desc: string } {
  return { name: lt(`${trapKey(kind)}.name`), desc: plain(lt(`${trapKey(kind)}.desc`)) };
}

/**
 * The question before a step onto a trap in sight (mistap.ts): its name and what it does, the first paragraph of
 * Shattered's description (the rest tells where it is found and how it breaks); empty where the texts have none.
 */
export function trapWarning(kind: TrapKind): { name: string; effect: string } | null {
  const { name, desc } = trapText(kind);
  const effect = desc.split('\n\n')[0]!.trim();
  if (!name || !effect) return null;
  return { name: name.charAt(0).toUpperCase() + name.slice(1), effect };
}

/** Which of the legend's families (t.forum.trapColours) a trap's colour belongs to; the spent black ones belong to none. */
export const trapFamily = (colour: number): number => (colour === 0 ? 7 : colour >= 1 && colour <= 7 ? colour - 1 : -1);

/** Level.Feeling's title and description. */
export function feelingText(feeling: string): { title: string; desc: string } {
  const key = feeling.toLowerCase();
  return { title: lt(`levels.level$feeling.${key}_title`), desc: lt(`levels.level$feeling.${key}_desc`) };
}

/** Level.Feeling in the order of the core's Feeling (NONE first), as its texts are keyed. */
const FEELINGS = ['', 'chasm', 'water', 'grass', 'dark', 'large', 'traps', 'secrets'] as const;

/** GameScene on arriving: GLog.w(Dungeon.level.feeling.desc()), or '' for a level without a feeling. */
export function feelingLine(level: Level): string {
  const feeling = FEELINGS[level.feeling] ?? '';
  return feeling ? plain(feelingText(feeling).desc) : '';
}

/**
 * GameScene on reaching a new deepest floor (to depth 25): demon spawners still alive on the floors above
 * (Statistics.spawnersAlive, less this floor's own) are felt: «a source of demonic energy above you», or on the
 * boss's floor «radiating here from the previous floors». '' when there are none.
 */
export function spawnerWarning(world: World, depth: number): string {
  if (depth > 25) return '';
  let above = 0;
  for (const [d, floor] of Object.entries(world.floors)) {
    if (Number(d) === depth) continue;
    above += floor.mobs.filter((m) => m.kind === 'spawner' && m.hp > 0).length;
  }
  if (above === 0) return '';
  return plain(lt(isBossDepth(depth) ? 'scenes.gamescene.spawner_warn_final' : 'scenes.gamescene.spawner_warn'));
}
