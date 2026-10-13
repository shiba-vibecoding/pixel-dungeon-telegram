import type { LevelBuilder } from './builder';
import { CITY_STYLE } from './city';
import { LENGTH, SOLO_SPAN, WIDTH } from './geometry';
import type { RegionStyle } from './regular';
import { Room, RoomType } from './room';
import { T } from './terrain';

/*
 * Depth 20: the King of Dwarves' throne hall (CityBossLevel). A long hall
 * lined with statues, two pedestals halfway up from which the King raises
 * his undead court, and his locked exit at the top; below it, a small
 * chamber between bookshelves with the stairs up. The hall's door locks
 * once the party is in, and opens again when the King falls.
 */

const TOP = 2;
const HALL_WIDTH = 7;
const HALL_HEIGHT = 15;
const CHAMBER_HEIGHT = 3;
// Centred on the level's own span (32), the grid's top-left part, whatever the grid's size.
const LEFT = Math.trunc((SOLO_SPAN - HALL_WIDTH) / 2);
const CENTER = LEFT + Math.trunc(HALL_WIDTH / 2);

/** CityBossLevel.pedestal: where the King summons his undead from. */
export const KING_PEDESTALS: readonly [number, number] = [
  (TOP + Math.trunc(HALL_HEIGHT / 2)) * WIDTH + CENTER - 2,
  (TOP + Math.trunc(HALL_HEIGHT / 2)) * WIDTH + CENTER + 2,
];

export const CITY_BOSS_STYLE: RegionStyle = { ...CITY_STYLE, decorate: decorateBossLevel };

export function buildCityBossLevel(level: LevelBuilder): boolean {
  const { rng, map } = level;
  level.fill(LEFT, TOP, HALL_WIDTH, HALL_HEIGHT, T.EMPTY);
  level.fill(CENTER, TOP, 1, HALL_HEIGHT, T.EMPTY_SP);
  for (let y = TOP + 1; y < TOP + HALL_HEIGHT; y += 2) {
    map[y * WIDTH + CENTER - 2] = T.STATUE_SP;
    map[y * WIDTH + CENTER + 2] = T.STATUE_SP;
  }
  const [left, right] = KING_PEDESTALS;
  map[left] = T.PEDESTAL;
  map[right] = T.PEDESTAL;
  for (let i = left + 1; i < right; i++) map[i] = T.EMPTY_SP;

  level.exit = (TOP - 1) * WIDTH + CENTER;
  map[level.exit] = T.LOCKED_EXIT;
  level.arenaDoor = (TOP + HALL_HEIGHT) * WIDTH + CENTER;
  map[level.arenaDoor] = T.DOOR;

  level.fill(LEFT, TOP + HALL_HEIGHT + 1, HALL_WIDTH, CHAMBER_HEIGHT, T.EMPTY);
  level.fill(LEFT, TOP + HALL_HEIGHT + 1, 1, CHAMBER_HEIGHT, T.BOOKSHELF);
  level.fill(LEFT + HALL_WIDTH - 1, TOP + HALL_HEIGHT + 1, 1, CHAMBER_HEIGHT, T.BOOKSHELF);
  level.entrance = (TOP + HALL_HEIGHT + 2 + rng.int(CHAMBER_HEIGHT - 1)) * WIDTH + LEFT + 1 + rng.int(HALL_WIDTH - 2);
  map[level.entrance] = T.ENTRANCE;

  // The hall, for the throne room's checks.
  const hall = new Room();
  hall.set(LEFT - 1, TOP - 1, LEFT + HALL_WIDTH, TOP + HALL_HEIGHT);
  hall.type = RoomType.BOSS_EXIT;
  const chamber = new Room();
  chamber.set(LEFT - 1, TOP + HALL_HEIGHT, LEFT + HALL_WIDTH, TOP + HALL_HEIGHT + CHAMBER_HEIGHT + 1);
  chamber.type = RoomType.ENTRANCE;
  level.rooms = [hall, chamber];
  return true;
}

function decorateBossLevel(level: LevelBuilder): void {
  const { map, rng } = level;
  for (let i = 0; i < LENGTH; i++) {
    if (map[i] === T.EMPTY && rng.int(10) === 0) map[i] = T.EMPTY_DECO;
    else if (map[i] === T.WALL && rng.int(8) === 0) map[i] = T.WALL_DECO;
  }
  map[level.arenaDoor + WIDTH + 1] = T.EMPTY;
}
