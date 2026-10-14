import { Random } from './random';
import type { Rect } from './rect';
import type { Room } from './room';

/*
 * levels/features/Maze: grows walls from the edge inwards at random until no more can grow,
 * which leaves a maze. maze[x][y] is true (FILLED) for wall, false (EMPTY) for space.
 */

export const Maze = {
  EMPTY: false,
  FILLED: true,
  allowDiagonals: false,

  /** A maze filling a room, open at its doors. */
  generateRoom(r: Room): boolean[][] {
    const maze = grid(r.width(), r.height());
    for (let x = 0; x < maze.length; x++) {
      for (let y = 0; y < maze[0]!.length; y++) {
        if (x === 0 || x === maze.length - 1 || y === 0 || y === maze[0]!.length - 1) maze[x]![y] = true;
      }
    }
    for (const d of r.doors()) maze[d.x - r.left]![d.y - r.top] = false;
    return Maze.generate(maze);
  },

  /** A maze the size of a rect (its edges included). */
  generateRect(r: Rect): boolean[][] {
    return Maze.generate(grid(r.width() + 1, r.height() + 1));
  },

  /** A maze within a rect, starting from the walls of a kind already there. */
  generateFrom(r: Rect, terrain: readonly number[], width: number, filledTerrainType: number): boolean[][] {
    const maze = grid(r.width(), r.height());
    for (let x = 0; x < maze.length; x++) {
      for (let y = 0; y < maze[0]!.length; y++) {
        if (terrain[x + r.left + (y + r.top) * width] === filledTerrainType) maze[x]![y] = true;
      }
    }
    return Maze.generate(maze);
  },

  generate(maze: boolean[][]): boolean[][] {
    let fails = 0;
    while (fails < 2500) {
      // A random wall point.
      let x: number;
      let y: number;
      do {
        x = Random.Int(maze.length);
        y = Random.Int(maze[0]!.length);
      } while (!maze[x]![y]);
      const mov = decideDirection(maze, x, y);
      if (!mov) {
        fails++;
      } else {
        fails = 0;
        let moves = 0;
        do {
          x += mov[0];
          y += mov[1];
          maze[x]![y] = true;
          moves++;
        } while (Random.Int(moves) === 0 && checkValidMove(maze, x, y, mov));
      }
    }
    return maze;
  },
};

function grid(w: number, h: number): boolean[][] {
  return Array.from({ length: w }, () => new Array<boolean>(h).fill(false));
}

function decideDirection(maze: boolean[][], x: number, y: number): [number, number] | null {
  if (Random.Int(4) === 0 && checkValidMove(maze, x, y, [0, -1])) return [0, -1];
  if (Random.Int(3) === 0 && checkValidMove(maze, x, y, [1, 0])) return [1, 0];
  if (Random.Int(2) === 0 && checkValidMove(maze, x, y, [0, 1])) return [0, 1];
  if (checkValidMove(maze, x, y, [-1, 0])) return [-1, 0];
  return null;
}

function checkValidMove(maze: boolean[][], x: number, y: number, mov: readonly [number, number]): boolean {
  const sideX = 1 - Math.abs(mov[0]);
  const sideY = 1 - Math.abs(mov[1]);
  const w = maze.length;
  const h = maze[0]!.length;
  x += mov[0];
  y += mov[1];
  if (x <= 0 || x >= w - 1 || y <= 0 || y >= h - 1) return false;
  if (maze[x]![y] || maze[x + sideX]![y + sideY] || maze[x - sideX]![y - sideY]) return false;
  x += mov[0];
  y += mov[1];
  if (x <= 0 || x >= w - 1 || y <= 0 || y >= h - 1) return false;
  if (maze[x]![y]) return false;
  if (!Maze.allowDiagonals && (maze[x + sideX]![y + sideY] || maze[x - sideX]![y - sideY])) return false;
  return true;
}
