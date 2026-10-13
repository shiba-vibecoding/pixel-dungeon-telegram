import { HEIGHT, T, WIDTH } from '../src/index';

/* Debug view of a map: one character per cell. */

const GLYPHS = new Map<number, string>([
  [T.WALL, '#'], [T.WALL_DECO, '#'], [T.EMPTY, '.'], [T.EMPTY_SP, '.'], [T.EMPTY_DECO, ','],
  [T.GRASS, '"'], [T.HIGH_GRASS, '&'], [T.FURROWED_GRASS, '&'], [T.DOOR, '+'], [T.OPEN_DOOR, '\''], [T.SECRET_DOOR, 'S'],
  [T.ENTRANCE, '<'], [T.ENTRANCE_SP, '<'], [T.EXIT, '>'], [T.CHASM, ' '], [T.EMBERS, ':'], [T.BOOKSHELF, 'B'], [T.PEDESTAL, 'P'],
  [T.INACTIVE_TRAP, '_'], [T.TRAP, '^'], [T.SECRET_TRAP, '.'], [T.WATER, '~'], [T.LOCKED_DOOR, 'L'], [T.CRYSTAL_DOOR, 'C'],
  [T.BARRICADE, '='], [T.STATUE, 'T'], [T.STATUE_SP, 'T'], [T.REGION_DECO, 'R'], [T.REGION_DECO_ALT, 'r'], [T.WELL, 'W'],
  [T.EMPTY_WELL, 'w'], [T.ALCHEMY, 'A'], [T.LOCKED_EXIT, 'X'], [T.UNLOCKED_EXIT, 'x'], [T.CUSTOM_DECO, 'c'],
  [T.CUSTOM_DECO_EMPTY, '.'], [T.MINE_CRYSTAL, '*'], [T.MINE_BOULDER, 'o'],
]);

export function ascii(map: readonly number[], width = WIDTH, height = HEIGHT): string {
  const rows: string[] = [];
  for (let y = 0; y < height; y++) {
    let row = '';
    for (let x = 0; x < width; x++) row += GLYPHS.get(map[x + y * WIDTH]!) ?? '?';
    rows.push(row);
  }
  return rows.join('\n');
}
