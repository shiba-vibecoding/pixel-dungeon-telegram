import { castShadow, LENGTH, T, WIDTH } from '@pd/core';
import { describe, expect, it } from 'vitest';
import { FOG_BLACK, FOG_CLEAR, FOG_REMEMBERED, fogHalves } from '../src/fog';

/* Two rooms, x 10..14 and x 16..20, y 10..14, one wall (x = 15) between them, rock all round. */
const map = new Array<number>(LENGTH).fill(T.WALL);
for (let y = 10; y <= 14; y++) {
  for (let x = 10; x <= 20; x++) if (x !== 15) map[y * WIDTH + x] = T.EMPTY;
}
const cell = (x: number, y: number): number => y * WIDTH + x;
const blocks = (c: number): boolean => map[c] === T.WALL;

/** What the hero sees from a cell, and the party has seen from it. */
function fogFrom(x: number, y: number): Float32Array {
  const visible = castShadow(cell(x, y), blocks, 8);
  return fogHalves(map, visible, visible);
}

describe("the fog of war as Shattered's FogOfWar lays it", () => {
  const fog = fogFrom(12, 12);
  const whole = (x: number, y: number): number => Math.max(fog[cell(x, y) * 2]!, fog[cell(x, y) * 2 + 1]!);

  it("clears the hero's own room and keeps the room beyond the wall black", () => {
    for (let y = 10; y <= 14; y++) {
      for (let x = 10; x <= 14; x++) expect(whole(x, y), `${x},${y}`).toBe(FOG_CLEAR);
      for (let x = 16; x <= 20; x++) expect(whole(x, y), `${x},${y}`).toBe(FOG_BLACK);
    }
  });

  it('lights only the near half of an inner wall, so the back of the wall stays dark', () => {
    // The wall between the rooms, seen from the left room: its left half is clear, its right half black.
    expect(fog[cell(15, 12) * 2]).toBe(FOG_CLEAR);
    expect(fog[cell(15, 12) * 2 + 1]).toBe(FOG_BLACK);
  });

  it('keeps solid rock with nothing walkable beside it black, seen or not', () => {
    const everything = new Array<boolean>(LENGTH).fill(true);
    const all = fogHalves(map, everything, everything);
    expect(all[cell(40, 40) * 2]).toBe(FOG_BLACK);
    expect(all[cell(40, 40) * 2 + 1]).toBe(FOG_BLACK);
    expect(all[cell(12, 12) * 2]).toBe(FOG_CLEAR);
  });

  it('dims what was seen and is out of sight now', () => {
    const none = new Array<boolean>(LENGTH).fill(false);
    const visible = castShadow(cell(12, 12), blocks, 8);
    const left = fogHalves(map, none, visible);
    expect(left[cell(12, 12) * 2]).toBeCloseTo(FOG_REMEMBERED, 5);
    expect(left[cell(18, 12) * 2]).toBe(FOG_BLACK);
  });
});
