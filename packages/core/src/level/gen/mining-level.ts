import { DARKNESS } from '../../challenges';
import { createItem } from '../../items';
import { T } from '../terrain';
import { BRANCH_LEVELS } from './branches';
import type { Builder } from './builders/builder';
import { FigureEightBuilder } from './builders/loop';
import { customTile } from './custom';
import { Dungeon, Feeling } from './dungeon';
import type { GenLevel } from './genlevel';
import { Generator } from './generator';
import { CavesPainter } from './painters/regions';
import type { MobChoice } from './quests';
import { Random } from './random';
import { buildDistanceMap, DoorType, type Room } from './room';
import { CAVES_LEVEL } from './regions';
import { fitToGrid, RegularLevel } from './regular-level';
import { MineEntrance, MineGiantRoom, MineLargeRoom, MineSecretRoom, MineSmallRoom } from './rooms/quest/mine-rooms';
import { CRYSTAL, FUNGI, GNOLL, mineQuestType } from './rooms/quest/mine-type';
import type { StandardRoom } from './rooms/standard/standard';

/*
 * levels/MiningLevel and levels/painters/MiningLevelPainter: the blacksmith's mine, a side level
 * (branch 1) below his smithy on depths 12-14. One giant cave with the quest's boss, three large ones
 * each with a miniboss, six to eight small ones, two secret pockets of ore; tunnels figure-of-eight,
 * the ways between caves walled up nine times in ten (one mines through), forty-five or so veins of
 * dark gold in the walls, and the quest's own monsters (crystal wisps, gnoll guards, fungal spinners).
 */

const f32 = Math.fround;

/** MiningLevelPainter: wider margins, the dark gold counted out, the doorways rock, no chasms. */
class MiningLevelPainter extends CavesPainter {
  private goldToAdd = 0;

  protected override padding(_level: GenLevel): number {
    return 3;
  }

  setGold(amount: number): this {
    this.goldToAdd = amount;
    return this;
  }

  /** The veins the rooms made count first; then a vein or a small cluster in each room in turn until there are enough. */
  protected override generateGold(level: GenLevel, rooms: Room[]): void {
    for (let i = 0; i < level.length; i++) if (level.map[i] === T.WALL_DECO) this.goldToAdd--;
    for (const heap of level.heaps.values()) {
      for (const item of heap.items) if (item.kind === 'quest.ore') this.goldToAdd -= item.qty;
    }
    const map = level.map;
    const n4 = level.neighbours4;
    do {
      Random.shuffle(rooms);
      for (const r of rooms) {
        if (r.kind === 'MineSecretRoom') continue;
        const candidates: number[] = [];
        for (const p of r.getPoints()) {
          const i = level.pointToCell(p);
          if (level.insideMap(i) && this.goldToAdd > 0 && map[i] === T.WALL) {
            for (const j of n4) {
              if (level.insideMap(i + j) && map[i + j] !== T.WALL && r.inside(level.cellToPoint(i + j))) {
                candidates.push(i);
                break;
              }
            }
          }
        }
        if (this.goldToAdd > 0 && candidates.length > 0) {
          const pos = Random.element(candidates)!;
          map[pos] = T.WALL_DECO;
          this.goldToAdd--;
          if (this.goldToAdd > 0) {
            let i = n4[Random.Int(4)]!;
            if (level.insideMap(pos + i) && map[pos + i] === T.WALL) {
              map[pos + i] = T.WALL_DECO;
              this.goldToAdd--;
            }
            if (Random.Int(2) === 0) {
              i = n4[Random.Int(4)]!;
              if (level.insideMap(pos + i) && map[pos + i] === T.WALL) {
                map[pos + i] = T.WALL_DECO;
                this.goldToAdd--;
              }
            }
          }
        }
      }
    } while (this.goldToAdd > 0);
  }

  /**
   * Walled and hidden doorways are rock; the rest are hidden nine times in ten (rock too), unless that
   * would cut a room off, and open ground otherwise, merging the two caves.
   */
  protected override paintDoors(l: GenLevel, rooms: Room[]): void {
    const roomMerges = new Map<Room, Room>();
    const hiddenDoorChance = f32(0.9);
    for (const r of rooms) {
      for (const n of r.connected.keys()) {
        const d = r.connected.get(n);
        if (!d) continue;
        const door = d.x + d.y * l.width;
        if (d.type === DoorType.WALL || d.type === DoorType.HIDDEN) {
          l.map[door] = T.WALL;
        } else if (Random.Float() < hiddenDoorChance) {
          d.type = DoorType.HIDDEN;
          buildDistanceMap(rooms, r);
          if (n.distance === Number.MAX_SAFE_INTEGER) {
            l.map[door] = T.EMPTY;
            d.type = DoorType.EMPTY;
          } else {
            l.map[door] = T.WALL;
          }
        } else {
          l.map[door] = T.EMPTY;
          d.type = DoorType.EMPTY;
        }
        // An open doorway always merges the two caves.
        if (l.map[door] === T.EMPTY) {
          if (roomMerges.get(r) === n || roomMerges.get(n) === r) continue;
          if (this.mergeRooms(l, r, n, d, T.EMPTY)) {
            roomMerges.set(r, n);
            roomMerges.set(n, r);
          }
        }
      }
    }
  }

  protected override decorate(level: GenLevel, rooms: Room[]): void {
    super.decorate(level, rooms);
    // No chasms in the mine: ground instead.
    for (let i = 0; i < level.length; i++) if (level.map[i] === T.CHASM) level.map[i] = T.EMPTY;
  }
}

/** The mine's kind, as the level remembers it (Level.mine). */
const MINE_KINDS = { [CRYSTAL]: 'crystal', [GNOLL]: 'gnoll', [FUNGI]: 'fungi' } as const;

export class MiningLevel extends RegularLevel {
  constructor() {
    super(CAVES_LEVEL, Feeling.NONE);
  }

  protected override builder(): Builder {
    return new FigureEightBuilder().setPathLength(f32(0.8), [1]).setTunnelLength([1], [1]);
  }

  /** One giant, three large, six to eight small and two secret caves, and the way up. */
  protected override initRooms(): Room[] {
    const rooms: Room[] = [];
    rooms.push((this.roomEntrance = new MineEntrance()));
    let s: StandardRoom = new MineGiantRoom();
    s.setSizeCat();
    rooms.push(s);
    for (let i = 0; i < 3; i++) {
      s = new MineLargeRoom();
      s.setSizeCat();
      rooms.push(s);
    }
    const small = Random.NormalIntRange(6, 8);
    for (let i = 0; i < small; i++) {
      s = new MineSmallRoom();
      s.setSizeCat();
      rooms.push(s);
    }
    for (let i = 0; i < 2; i++) rooms.push(new MineSecretRoom());
    return rooms;
  }

  /** RegularLevel.build with the mine's painter; then the darkened borders (BorderTopDarken, BorderWallsDarken). */
  override build(): boolean {
    const builder = this.builder();
    const initRooms = this.initRooms();
    Random.shuffle(initRooms);
    let rooms: Room[] | null = null;
    for (let attempt = 0; attempt < 200 && !rooms; attempt++) {
      for (const r of initRooms) {
        r.neigbours = [];
        r.connected.clear();
      }
      rooms = builder.build([...initRooms]);
    }
    if (!rooms) return false;
    this.rooms = rooms;
    const type = mineQuestType();
    const painter = new MiningLevelPainter()
      .setGold(Random.NormalIntRange(45, 47))
      .setWater(type === FUNGI ? 0.1 : 0.35, 6)
      .setGrass(type === FUNGI ? 0.65 : 0.1, 3);
    if (!painter.paint(this.level, rooms)) return false;
    const level = this.level;
    const w = level.width;
    const h = level.height;
    if (!fitToGrid(level)) return false;
    level.customTiles.push(customTile('MiningLevel.BorderTopDarken', 'caves_quest', 0, 0, w, 1, new Array<number>(w).fill(1)));
    const walls = new Array<number>(w * h);
    for (let i = 0; i < walls.length; i++) walls[i] = i % w === 0 || i % w === w - 1 ? 1 : i + 2 * w > walls.length ? 2 : -1;
    level.customTiles.push(customTile('MiningLevel.BorderWallsDarken', 'caves_quest', 0, 0, w, h, walls, true));
    return true;
  }

  /** One fewer than usual. */
  override mobLimit(): number {
    return super.mobLimit() - 1;
  }

  /** The quest's own monsters: crystal wisps (of a colour each), gnoll guards, fungal spinners; bats otherwise. */
  protected override levelMob(): MobChoice {
    switch (mineQuestType()) {
      case CRYSTAL:
        return { kind: 'crystalWisp', extra: { mine: { variant: Random.Int(3) } } };
      case GNOLL:
        return { kind: 'gnollGuard' };
      case FUNGI:
        return { kind: 'fungalSpinner' };
      default:
        return { kind: 'bat' };
    }
  }

  /** A food ration (two for the gnolls' mine, more mining to do), and a torch in the dark; never next to a hazard. */
  override createItems(): void {
    const level = this.level;
    // Bones would be laid here on a stream of their own (the world lays them, and not in the mine).
    Random.pushGenerator(Random.Long());
    Random.popGenerator();
    const dropAt = (item: ReturnType<typeof Generator.random>): void => {
      const cell = this.mineDropCell();
      if (cell < 0) return;
      if (level.map[cell] === T.HIGH_GRASS || level.map[cell] === T.FURROWED_GRASS) level.set(cell, T.GRASS);
      level.drop(item, cell);
    };
    dropAt(Generator.randomUsingDefaults('FOOD'));
    if (mineQuestType() === GNOLL) dropAt(Generator.randomUsingDefaults('FOOD'));
    if (Dungeon.isChallenged(DARKNESS)) dropAt(createItem('torch'));
  }

  /** RegularLevel.randomDropCell(MineSmallRoom.class). */
  private mineDropCell(): number {
    const level = this.level;
    for (let tries = 100; tries > 0; tries--) {
      Random.shuffle(this.rooms);
      const room = this.rooms.find((r) => r.kind === 'MineSmallRoom');
      if (!room) return -1;
      if (room === this.roomEntrance) continue;
      const pos = level.pointToCell(room.random());
      if (level.passable[pos] && !level.solid[pos] && pos !== level.exit() && !level.heaps.has(pos) &&
        room.canPlaceItem(level.cellToPoint(pos), level) && !level.findMob(pos)) {
        const trap = level.traps.get(pos);
        if (!trap || !ITEM_DESTROYING.has(trap.kind)) return pos;
      }
    }
    return -1;
  }
}

const ITEM_DESTROYING: ReadonlySet<string> = new Set(['burning', 'blazing', 'chilling', 'frost', 'explosive', 'disintegration', 'pitfall']);

/** Level.create for the mine: built until it holds, then its monsters and items. */
export function makeMiningLevel(): GenLevel {
  const MAX_ATTEMPTS = 128;
  let mining: MiningLevel | null = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS && !mining; attempt++) {
    const candidate = new MiningLevel();
    candidate.level.viewDistance = Dungeon.isChallenged(DARKNESS) ? 2 : 8;
    if (candidate.build()) mining = candidate;
  }
  if (!mining) throw new Error(`Unable to generate the mine of depth ${Dungeon.depth}`);
  const level = mining.level;
  const type = mineQuestType();
  if (type === CRYSTAL || type === GNOLL || type === FUNGI) level.mine = MINE_KINDS[type];
  level.buildFlagMaps();
  mining.createMobs();
  mining.createItems();
  return level;
}

// Blacksmith.Quest.spawn: the smithy (and so the mine) is on depth 12, 13 or 14.
for (const depth of [12, 13, 14]) BRANCH_LEVELS.set(depth, makeMiningLevel);
