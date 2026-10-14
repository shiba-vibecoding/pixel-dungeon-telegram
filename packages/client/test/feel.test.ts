import { describe, expect, it } from 'vitest';
import { HEIGHT, type Level, T, WIDTH } from '@pd/core';
import { hapticAllowed } from '../src/telegram';
import { wallCellsOver, type Placed } from '../src/xray';

describe('haptics are rate-limited', () => {
  it('lets one buzz through for a flurry of the same kind', () => {
    expect(hapticAllowed('hit', 10_000)).toBe(true);
    expect(hapticAllowed('hit', 10_040)).toBe(false);
    expect(hapticAllowed('tick', 10_060)).toBe(false);
    expect(hapticAllowed('hit', 10_200)).toBe(true);
  });

  it('lets a stronger one through at once, and notifications over impacts', () => {
    expect(hapticAllowed('tick', 20_000)).toBe(true);
    expect(hapticAllowed('slam', 20_010)).toBe(true);
    expect(hapticAllowed('hit', 20_020)).toBe(false);
    expect(hapticAllowed('success', 20_030)).toBe(true);
    expect(hapticAllowed('error', 20_040)).toBe(true);
  });

  it('starts over when the clock goes back', () => {
    expect(hapticAllowed('slam', 50_000)).toBe(true);
    expect(hapticAllowed('hit', 100)).toBe(true);
  });
});

/** A level of open floor with a wall row: `wallRow` is solid, the rest floor. */
function level(wallRow: number): Level {
  const map = new Array<number>(WIDTH * HEIGHT).fill(T.EMPTY);
  for (let x = 0; x < WIDTH; x++) map[x + wallRow * WIDTH] = T.WALL;
  return { map } as unknown as Level;
}

const sprite = (cellX: number, cellY: number, w = 12, h = 15): Placed => ({
  image: {} as CanvasImageSource, sx: 0, sy: 0, w, h, dx: cellX * 16 + (16 - w) / 2, dy: cellY * 16 + 16 - h, flip: false,
});

describe('the x-ray over raised walls', () => {
  it('finds the wall cells that cover someone standing right behind a wall', () => {
    const cells = wallCellsOver(level(11), sprite(5, 10));
    // Their own cell (a wall below it overhangs it) and the wall's one, if the sprite reaches it.
    expect(cells).toContain(5 + 10 * WIDTH);
  });

  it('leaves alone whoever stands in the open', () => {
    expect(wallCellsOver(level(30), sprite(5, 10))).toEqual([]);
  });

  it('covers a tall sprite that reaches up into a wall above it', () => {
    const cells = wallCellsOver(level(9), sprite(5, 10, 12, 20));
    expect(cells).toContain(5 + 9 * WIDTH);
  });
});
