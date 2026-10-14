import { describe, expect, it } from 'vitest';
import { createRun, generateLevel, type Level, T, WIDTH } from '../src/index';
import { F, terrainFlags } from '../src/level/terrain';

/* Every lock on a level has its key on that level, within reach: Shattered's RegularLevel.createItems
   and the special rooms' addItemToSpawn, checked over many seeds. */

const SEEDS = 40;
/** Boss floors (every fifth) and the last floor are laid out by their own builders, without keys. */
const DEPTHS = Array.from({ length: 24 }, (_, i) => i + 1).filter((d) => d % 5 !== 0);

/** Cells one can reach from the entrance without a key: a locked or crystal door stops the way. */
function reachableWithoutKeys(level: Level): boolean[] {
  const map = level.map;
  const reached = new Array<boolean>(map.length).fill(false);
  const ok = (c: number): boolean => {
    const t = map[c]!;
    if (t === T.LOCKED_DOOR || t === T.CRYSTAL_DOOR) return false;
    const f = terrainFlags[t]!;
    return (f & F.PASSABLE) !== 0 || ((f & F.AVOID) !== 0 && (f & F.PIT) === 0) || t === T.SECRET_DOOR || t === T.BARRICADE;
  };
  const queue = [level.entrance];
  reached[level.entrance] = true;
  for (let head = 0; head < queue.length; head++) {
    const c = queue[head]!;
    for (const n of [-WIDTH - 1, -WIDTH, -WIDTH + 1, -1, 1, WIDTH - 1, WIDTH, WIDTH + 1]) {
      const next = c + n;
      if (next < 0 || next >= map.length || reached[next] || !ok(next)) continue;
      reached[next] = true;
      queue.push(next);
    }
  }
  return reached;
}

describe('keys on generated levels', () => {
  it('every locked or crystal chest and every locked or crystal door has its key on the level, within reach', () => {
    let chests = 0;
    let crystalChests = 0;
    let lockedDoors = 0;
    let crystalDoors = 0;
    for (let seed = 1; seed <= SEEDS; seed++) {
      const run = createRun(seed);
      // Floors are made in order of depth (the specials' deck carries on).
      for (let depth = 1; depth <= 24; depth++) {
        const level = generateLevel(run, depth);
        if (!DEPTHS.includes(depth)) continue;
        const where = `seed ${seed} depth ${depth}`;
        const heaps = level.spawn!.heaps;
        const reach = reachableWithoutKeys(level);
        const lying = (kind: string): number =>
          heaps.filter((h) => h.kind !== 'lockedChest' && h.kind !== 'crystalChest' && reach[h.pos])
            .flatMap((h) => h.items).filter((i) => i.kind === kind && i.depth === depth).length;

        // The secret chasm room is its own puzzle: four chests, a key on each island, levitation lying about the floor.
        const chasm = level.rooms.find((r) => r.kind === 'SecretChestChasmRoom');
        const inChasm = (cell: number): boolean => !!chasm && cell % WIDTH >= chasm.left && cell % WIDTH <= chasm.right &&
          Math.trunc(cell / WIDTH) >= chasm.top && Math.trunc(cell / WIDTH) <= chasm.bottom;
        if (chasm) {
          const inside = heaps.filter((h) => inChasm(h.pos));
          const chestsIn = inside.filter((h) => h.kind === 'lockedChest').length;
          const keysIn = inside.flatMap((h) => h.items).filter((i) => i.kind === 'key.golden' && i.depth === depth).length;
          expect(keysIn, `${where}: the chasm room's keys`).toBe(chestsIn);
          expect(heaps.some((h) => h.items.some((i) => i.kind === 'potion.levitation')), `${where}: levitation`).toBe(true);
        }
        const golden = heaps.filter((h) => h.kind === 'lockedChest' && !inChasm(h.pos)).length;
        const crystalChest = heaps.filter((h) => h.kind === 'crystalChest').length;
        const iron = level.map.filter((t) => t === T.LOCKED_DOOR).length;
        // The pit room's crystal door shuts in the one who fell into it, with the key in the remains inside.
        const pit = level.rooms.find((r) => r.kind === 'PitRoom');
        const inPit = (cell: number): boolean => !!pit && cell % WIDTH >= pit.left && cell % WIDTH <= pit.right &&
          Math.trunc(cell / WIDTH) >= pit.top && Math.trunc(cell / WIDTH) <= pit.bottom;
        if (pit) {
          const remains = heaps.filter((h) => inPit(h.pos) && h.items.some((i) => i.kind === 'key.crystal' && i.depth === depth));
          expect(remains.length, `${where}: the pit room's key`).toBe(1);
        }
        const crystalDoor = level.map.filter((t, c) => t === T.CRYSTAL_DOOR && !inPit(c)).length;
        chests += golden;
        crystalChests += crystalChest;
        lockedDoors += iron;
        crystalDoors += crystalDoor;

        expect(lying('key.golden'), `${where}: golden keys`).toBeGreaterThanOrEqual(golden);
        expect(lying('key.iron'), `${where}: iron keys`).toBeGreaterThanOrEqual(iron);
        // A crystal key fits any crystal lock; the choice room and the path room have more doors than keys.
        if (crystalChest + crystalDoor > 0) expect(lying('key.crystal'), `${where}: crystal keys`).toBeGreaterThan(0);
        if (crystalChest > 0) expect(lying('key.crystal'), `${where}: crystal keys for the chests`).toBeGreaterThanOrEqual(1);
      }
    }
    // The sample really had locks of every sort in it.
    expect(chests).toBeGreaterThan(0);
    expect(crystalChests).toBeGreaterThan(0);
    expect(lockedDoors).toBeGreaterThan(0);
    expect(crystalDoors).toBeGreaterThan(0);
  }, 300_000);
});
