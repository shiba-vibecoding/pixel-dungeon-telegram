import type { GenLevel } from '../../genlevel';
import { Random } from '../../random';
import type { Point } from '../../rect';
import { Room } from '../../room';
import { F, terrainFlags } from '../../../terrain';

/*
 * levels/rooms/standard/StandardRoom: the ordinary rooms of a level, in three sizes; the bigger
 * ones count as several rooms when rooms are counted (sizeFactor), and are likelier on the main
 * path and to be branched from (connectionWeight).
 */

/** StandardRoom.SizeCategory: NORMAL 4-10, LARGE 10-14, GIANT 14-18; its room value is ordinal + 1. */
export const SIZE_CATEGORIES = [
  { name: 'NORMAL', minDim: 4, maxDim: 10, roomValue: 1 },
  { name: 'LARGE', minDim: 10, maxDim: 14, roomValue: 2 },
  { name: 'GIANT', minDim: 14, maxDim: 18, roomValue: 3 },
] as const;
export type SizeCategory = (typeof SIZE_CATEGORIES)[number];

export abstract class StandardRoom extends Room {
  readonly group = 'standard' as const;
  sizeCat: SizeCategory = SIZE_CATEGORIES[0];

  /** The instance initialiser `{ setSizeCat(); }`, rolled as the room is made. */
  constructor() {
    super();
    this.setSizeCat();
  }

  /** Always normal by default; a room that may be forced to a size it would not roll uses Number.MIN_VALUE. */
  sizeCatProbs(): number[] {
    return [1, 0, 0];
  }

  /** setSizeCat(), setSizeCat(maxRoomValue) or setSizeCat(minOrdinal, maxOrdinal); false if no size fits. */
  setSizeCat(a?: number, b?: number): boolean {
    let minOrdinal = 0;
    let maxOrdinal = SIZE_CATEGORIES.length - 1;
    if (a !== undefined && b === undefined) maxOrdinal = a - 1;
    else if (a !== undefined && b !== undefined) {
      minOrdinal = a;
      maxOrdinal = b;
    }
    const probs = this.sizeCatProbs();
    if (probs.length !== SIZE_CATEGORIES.length) return false;
    for (let i = 0; i < minOrdinal; i++) probs[i] = 0;
    for (let i = maxOrdinal + 1; i < SIZE_CATEGORIES.length; i++) probs[i] = 0;
    const ordinal = Random.chances(probs);
    if (ordinal === -1) return false;
    this.sizeCat = SIZE_CATEGORIES[ordinal]!;
    return true;
  }

  override minWidth(): number {
    return this.sizeCat.minDim;
  }
  override maxWidth(): number {
    return this.sizeCat.maxDim;
  }
  override minHeight(): number {
    return this.sizeCat.minDim;
  }
  override maxHeight(): number {
    return this.sizeCat.maxDim;
  }

  /** How many rooms this one counts as. */
  sizeFactor(): number {
    return this.sizeCat.roomValue;
  }

  /** Entrance rooms get no more monsters for being large. */
  mobSpawnWeight(): number {
    return this.isEntrance() ? 1 : this.sizeFactor();
  }

  connectionWeight(): number {
    return this.sizeFactor() * this.sizeFactor();
  }

  /** Standard rooms merge where the cell just inside them is not solid. */
  override canMerge(l: GenLevel, _other: Room, p: Point, _mergeTerrain: number): boolean {
    const cell = l.pointToCell(this.pointInside(p, 1));
    return (terrainFlags[l.map[cell]!]! & F.SOLID) === 0;
  }
}

export const isStandard = (room: Room): room is StandardRoom => room.group === 'standard';
