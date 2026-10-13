import type { RunState } from '../../../../run';
import { Dungeon, limitedAdd } from '../../dungeon';
import { Random } from '../../random';
import { type Door, Room } from '../../room';

/*
 * levels/rooms/special/SpecialRoom: the rooms off the beaten track, with a single door, each with
 * something to find or a challenge. Every run deals them from a deck that alternates rooms giving
 * equipment and rooms giving consumables; a floor takes from the front of it (60/30/10%), and the
 * kinds used go to the back.
 */

export abstract class SpecialRoom extends Room {
  readonly group: 'special' | 'secret' = 'special';
  private entranceDoor: Door | null = null;

  override minWidth(): number {
    return 5;
  }
  override maxWidth(): number {
    return 10;
  }
  override minHeight(): number {
    return 5;
  }
  override maxHeight(): number {
    return 10;
  }

  override maxConnections(_direction: number): number {
    return 1;
  }

  /** The room's one door. */
  entrance(): Door {
    if (!this.entranceDoor) {
      const first = this.connected.values().next();
      if (first.done || !first.value) throw new Error(`${this.kind} has no door`);
      this.entranceDoor = first.value;
    }
    return this.entranceDoor;
  }
}

/** Special rooms that give equipment more often than consumables (or as often). */
export const EQUIP_SPECIALS = [
  'WeakFloorRoom', 'CryptRoom', 'PoolRoom', 'ArmoryRoom', 'SentryRoom', 'StatueRoom', 'CrystalVaultRoom', 'CrystalChoiceRoom',
  'SacrificeRoom',
];
/** Special rooms that give consumables more often than equipment (the laboratory comes separately). */
export const CONSUMABLE_SPECIALS = [
  'RunestoneRoom', 'GardenRoom', 'LibraryRoom', 'StorageRoom', 'TreasuryRoom', 'MagicWellRoom', 'ToxicGasRoom', 'MagicalFireRoom',
  'TrapsRoom', 'CrystalPathRoom',
];
/** One special room using crystal keys a floor. */
export const CRYSTAL_KEY_SPECIALS = ['PitRoom', 'CrystalVaultRoom', 'CrystalChoiceRoom', 'CrystalPathRoom'];
/** One special room that makes a potion a floor. */
const POTION_SPAWN_ROOMS = ['PoolRoom', 'SentryRoom', 'StorageRoom', 'ToxicGasRoom', 'MagicalFireRoom', 'TrapsRoom'];

/** Every special room kind, by Shattered's class name; filled by the rooms' modules (rooms/index.ts). */
export const SPECIAL_ROOMS = new Map<string, () => SpecialRoom>();

/** SpecialRoom.initForRun: the run's deck, a consumable room first, then alternating. */
export function initSpecialsForRun(run: RunState): void {
  const equip = [...EQUIP_SPECIALS];
  const cons = [...CONSUMABLE_SPECIALS];
  Random.shuffle(equip);
  Random.shuffle(cons);
  const deck: string[] = [cons.shift()!];
  while (equip.length > 0 || cons.length > 0) {
    if (equip.length > 0) deck.push(equip.shift()!);
    if (cons.length > 0) deck.push(cons.shift()!);
  }
  run.specialRooms = deck;
  run.pitNeededDepth = -1;
}

/** SpecialRoom.floorSpecials: this floor's copy of the deck. */
let floorSpecials: string[] = [];

/** SpecialRoom.initForFloor: the deck as it stands, with a laboratory first on its floor in each region. */
export function initSpecialsForFloor(): void {
  floorSpecials = [...(Dungeon.run.specialRooms ?? [])];
  if (Dungeon.labRoomNeeded()) {
    limitedAdd(Dungeon.run, 'LAB_ROOM');
    floorSpecials.unshift('LaboratoryRoom');
  }
}

function removeAll(list: string[], kinds: readonly string[]): void {
  for (let i = list.length - 1; i >= 0; i--) if (kinds.includes(list[i]!)) list.splice(i, 1);
}

/** SpecialRoom.useType: off this floor's deck (with its crystal-key or potion siblings), to the back of the run's. */
function useType(type: string): void {
  const index = floorSpecials.indexOf(type);
  if (index >= 0) floorSpecials.splice(index, 1);
  if (CRYSTAL_KEY_SPECIALS.includes(type)) removeAll(floorSpecials, CRYSTAL_KEY_SPECIALS);
  if (POTION_SPAWN_ROOMS.includes(type)) removeAll(floorSpecials, POTION_SPAWN_ROOMS);
  const run = Dungeon.run.specialRooms ?? [];
  const runIndex = run.indexOf(type);
  if (runIndex >= 0) {
    run.splice(runIndex, 1);
    run.push(type);
  }
}

/** SpecialRoom.resetPitRoom: a boss depth needs no pit room. */
export function resetPitRoom(depth: number): void {
  if (Dungeon.run.pitNeededDepth === depth) Dungeon.run.pitNeededDepth = -1;
}

function make(kind: string): SpecialRoom {
  const factory = SPECIAL_ROOMS.get(kind) ?? SPECIAL_ROOMS.get('EmptySpecialRoom');
  if (!factory) throw new Error(`No special room ${kind}`);
  return factory();
}

/** SpecialRoom.createRoom: the pit below a weak floor, the laboratory, or one from the front of the deck. */
export function createSpecialRoom(): SpecialRoom {
  const run = Dungeon.run;
  if (Dungeon.depth === run.pitNeededDepth) {
    run.pitNeededDepth = -1;
    useType('PitRoom');
    return make('PitRoom');
  }
  if (floorSpecials.includes('LaboratoryRoom')) {
    useType('LaboratoryRoom');
    return make('LaboratoryRoom');
  }
  if (Dungeon.bossLevel(Dungeon.depth + 1)) {
    const weak = floorSpecials.indexOf('WeakFloorRoom');
    if (weak >= 0) floorSpecials.splice(weak, 1);
  }
  // 60% the front of the deck, 30% the next, 10% the one after.
  let index = Random.chances([6, 3, 1]);
  while (index >= floorSpecials.length) index--;
  const kind = floorSpecials[index]!;
  const room = make(kind);
  if (kind === 'WeakFloorRoom') run.pitNeededDepth = Dungeon.depth + 1;
  useType(kind);
  return room;
}

export const isSpecial = (room: Room): room is SpecialRoom => room.group === 'special' || room.group === 'secret';
