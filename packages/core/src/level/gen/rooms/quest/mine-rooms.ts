import { T } from '../../../terrain';
import { customTile, mapSimpleImage } from '../../custom';
import { Dungeon } from '../../dungeon';
import { createItem } from '../../../../items';
import type { GenLevel } from '../../genlevel';
import { Painter } from '../../painter';
import { Random } from '../../random';
import { Point, Rect } from '../../rect';
import { type Door, DoorType, type Room } from '../../room';
import { CaveRoom } from '../standard/patch-rooms';
import { SecretRoom } from '../secret/secret';
import { CRYSTAL, FUNGI, GNOLL, mineQuestType } from './mine-type';

/*
 * levels/rooms/quest: the blacksmith's mine (MiningLevel) — its way back up (MineEntrance), the giant
 * cave of the quest's boss (MineGiantRoom: the crystal spire, the gnoll geomancer or the fungal core),
 * three large caves each with a miniboss (MineLargeRoom: a crystal guardian, a gnoll sapper with its
 * guard, a fungal sentry), small caves (MineSmallRoom) and the two secret pockets of dark gold
 * (MineSecretRoom). Each is shaped by the quest's type: crystals, the gnolls' cave-ins, or fungus.
 */

const f32 = Math.fround;

/** GameMath.gate. */
const gate = (min: number, value: number, max: number): number => (value <= min ? min : value >= max ? max : value);

/**
 * The gnoll quest's cave-ins, as every mine room has them: the doorways to non-secret rooms walled
 * up (set to EMPTY nine times in ten, which the door's own rules keep regular), then boulders and
 * rubble the thicker the nearer those walled doorways (`spread`: how far from them it thins out).
 */
function gnollCaveIn(
  room: Room, level: GenLevel, spread: number, decoReach: number, offset: number, skip: (cell: number) => boolean,
): void {
  for (const [n, door] of room.connected) {
    if (n.group !== 'secret' && door && door.type === DoorType.REGULAR) {
      if (Random.Int(10) === 0) door.set(DoorType.EMPTY);
      else door.set(DoorType.WALL);
      door.lockTypeChanges(true);
    }
  }
  const doors: Door[] = room.doors().filter((d) => d.type === DoorType.WALL);
  for (const p of room.getPoints()) {
    const cell = level.pointToCell(p);
    if (level.map[cell] !== T.EMPTY || skip(cell)) continue;
    let dist = 1000;
    for (const d of doors) dist = Math.min(dist, Point.distance(p, d));
    dist = gate(1, f32(dist - offset), spread);
    const val = Random.Float(f32(dist * dist));
    if (val <= 0.75 || dist <= 1) Painter.set(level, cell, T.MINE_BOULDER);
    else if (val <= 5 && dist <= decoReach) Painter.set(level, cell, T.EMPTY_DECO);
  }
}

/** A crystal monster's colour (CrystalWisp/Guardian/Spire: blue, green or red), rolled as it is made. */
const crystalVariant = (): number => Random.Int(3);

/** MineEntrance: the ladder back up to the smithy, in a small cave cleared around it. */
export class MineEntrance extends CaveRoom {
  override readonly kind: string = 'MineEntrance';

  override sizeCatProbs(): number[] {
    return [1, 0, 0];
  }
  override minWidth(): number {
    return Math.max(super.minWidth(), 7);
  }
  override minHeight(): number {
    return Math.max(super.minHeight(), 7);
  }
  override isEntrance(): boolean {
    return true;
  }

  override paint(level: GenLevel): void {
    super.paint(level);

    let entrance: number;
    let valid: boolean;
    do {
      valid = false;
      entrance = level.pointToCell(this.random(3));
      for (const i of level.neighbours9) if (level.map[entrance + i] !== T.WALL) valid = true;
      if (this.height() === 7 && this.width() === 7) valid = true;
    } while (level.findMob(entrance) !== undefined || !valid);
    Painter.set(level, entrance, T.ENTRANCE_SP);
    for (const i of level.neighbours8) Painter.set(level, entrance + i, T.EMPTY_SP);

    // QuestExit: the ladder, a 3x3 picture from tile (0,1) of caves_quest.
    const e = level.cellToPoint(entrance);
    const data = mapSimpleImage(0, 1, 64, 3, 3);
    level.customTiles.push(customTile('MineEntrance.QuestExit', 'caves_quest', e.x - 1, e.y - 1, 3, 3, data));

    level.addTransition(entrance, 'branchEntrance', { depth: Dungeon.depth, branch: 0, type: 'branchExit' });

    const type = mineQuestType();
    if (type === CRYSTAL) {
      for (let i = 0; i < Math.trunc((this.width() * this.height()) / 2); i++) {
        const r = this.random(1);
        if (level.distance(level.pointToCell(r), entrance) > 1 && level.map[level.pointToCell(r)] !== T.WALL) {
          Painter.set(level, r, T.MINE_CRYSTAL);
        }
      }
    } else if (type === GNOLL) {
      gnollCaveIn(this, level, 5, 3, 0.5, (cell) => level.distance(cell, entrance) <= 1);
    }
  }
}

/** MineGiantRoom: the boss's cave. */
export class MineGiantRoom extends CaveRoom {
  override readonly kind: string = 'MineGiantRoom';

  override sizeCatProbs(): number[] {
    return [0, 0, 1];
  }
  protected override fill(): number {
    return f32(0.7);
  }
  /** It holds the boss: no more ordinary monsters for its size. */
  override mobSpawnWeight(): number {
    return 1;
  }

  override paint(level: GenLevel): void {
    super.paint(level);
    const type = mineQuestType();
    if (type === CRYSTAL) {
      Painter.fillEllipse(level, this, 3, T.EMPTY);
      for (let i = 0; i < Math.trunc((this.width() * this.height()) / 2); i++) {
        const r = this.random(1);
        if (level.map[level.pointToCell(r)] !== T.WALL) Painter.set(level, r, T.MINE_CRYSTAL);
      }
      const p = this.center();
      level.mobs.push({ kind: 'crystalSpire', pos: level.pointToCell(p), state: 'passive', mine: { variant: crystalVariant() } });
      Painter.set(level, p, T.EMPTY);
    } else if (type === GNOLL) {
      Painter.fillEllipse(level, this, 3, T.EMPTY);
      gnollCaveIn(this, level, f32(3.1), 3, 0.5, () => false);
      const center = this.center();
      const centerArea = new Rect(center.x - 2, center.y - 2, center.x + 3, center.y + 3);
      Painter.fillEllipse(level, centerArea, 0, T.MINE_BOULDER);
      Painter.fill(level, centerArea, 2, T.EMPTY_DECO);
      // GnollGeomancer: its ability cooldown is rolled as it is made; it sleeps under 50 points of rock armour.
      const cooldown = Random.NormalIntRange(3, 5);
      level.mobs.push({ kind: 'gnollGeomancer', pos: level.pointToCell(center), state: 'sleeping', mine: { cooldown, armor: 50 } });
    } else if (type === FUNGI) {
      Painter.fillEllipse(level, this, 2, T.HIGH_GRASS);
      Painter.fillEllipse(level, this, 3, T.GRASS);
      Painter.fillEllipse(level, this, 4, T.HIGH_GRASS);
      Painter.fillEllipse(level, this, 5, T.GRASS);
      const p = this.center();
      level.mobs.push({ kind: 'fungalCore', pos: level.pointToCell(p), state: 'hunting' });
    } else {
      Painter.fillEllipse(level, this, 3, T.EMPTY);
    }
  }
}

/** MineLargeRoom: a large cave with its miniboss. */
export class MineLargeRoom extends CaveRoom {
  override readonly kind: string = 'MineLargeRoom';

  override sizeCatProbs(): number[] {
    return [0, 1, 0];
  }
  override minHeight(): number {
    return 11;
  }
  override minWidth(): number {
    return 11;
  }
  protected override fill(): number {
    return f32(0.55);
  }
  /** It brings its own monsters. */
  override mobSpawnWeight(): number {
    return 1;
  }

  override paint(level: GenLevel): void {
    super.paint(level);
    const type = mineQuestType();
    if (type === CRYSTAL) {
      Painter.fillEllipse(level, this, 3, T.MINE_CRYSTAL);
      Painter.fillEllipse(level, this, 4, T.EMPTY);

      const p = this.random(5);
      const internal: number[] = [];
      findInternalCells(level, level.pointToCell(p), internal, new Set(), this.square());
      const inside = new Set(internal);
      // Every inner cell is closed off, even diagonally.
      for (const i of internal) {
        for (const j of level.circle8) {
          if (!inside.has(i + j) && level.map[i + j] !== T.MINE_CRYSTAL) {
            level.map[i] = T.MINE_CRYSTAL;
            break;
          }
        }
      }
      for (let i = 0; i < Math.trunc((this.width() * this.height()) / 4); i++) {
        const r = this.random(1);
        if (level.map[level.pointToCell(r)] !== T.WALL) Painter.set(level, r, T.MINE_CRYSTAL);
      }
      level.mobs.push({ kind: 'crystalGuardian', pos: level.pointToCell(p), state: 'sleeping', mine: { variant: crystalVariant() } });
      Painter.set(level, p, T.EMPTY);
    } else if (type === GNOLL) {
      Painter.fillEllipse(level, this, 3, T.EMPTY);
      // (The doorways are walled up first: their own part of gnollCaveIn, before the sapper.)
      const doorsPass = (): void => {
        for (const [n, door] of this.connected) {
          if (n.group !== 'secret' && door && door.type === DoorType.REGULAR) {
            if (Random.Int(10) === 0) door.set(DoorType.EMPTY);
            else door.set(DoorType.WALL);
            door.lockTypeChanges(true);
          }
        }
      };
      doorsPass();
      const doors = this.doors().filter((d) => d.type === DoorType.WALL);

      const sapperPos = level.pointToCell(this.random(5));
      // GnollSapper: its ability cooldown is rolled as it is made.
      const sapperCooldown = Random.NormalIntRange(4, 6);
      let guardPos: number;
      do {
        guardPos = sapperPos + level.neighbours8[Random.Int(8)]!;
      } while (level.map[guardPos] !== T.EMPTY);
      level.mobs.push({ kind: 'gnollSapper', pos: sapperPos, state: 'sleeping', mine: { cooldown: sapperCooldown, spawnPos: sapperPos, partnerAt: guardPos } });
      level.mobs.push({ kind: 'gnollGuard', pos: guardPos, state: 'sleeping' });

      const barricades = Random.Int(2) === 0 ? 2 : 1;
      for (let i = 0; i < barricades; i++) {
        const barricadePos = sapperPos + level.neighbours8[Random.Int(8)]!;
        if (level.map[barricadePos] === T.EMPTY && barricadePos !== guardPos) Painter.set(level, barricadePos, T.BARRICADE);
        else i--;
      }

      const traps = this.square() > 150 ? 3 : 2;
      for (let i = 0; i < traps; i++) {
        let r: Point;
        do {
          r = this.random(2);
        } while (level.map[level.pointToCell(r)] !== T.EMPTY || level.pointToCell(r) === sapperPos || level.pointToCell(r) === guardPos);
        Painter.set(level, r, T.TRAP);
        level.setTrap('gnollRockfall', level.pointToCell(r), true);
      }

      for (const p of this.getPoints()) {
        const cell = level.pointToCell(p);
        if (level.map[cell] !== T.EMPTY || cell === sapperPos || cell === guardPos) continue;
        let dist = 1000;
        for (const d of doors) dist = Math.min(dist, Point.distance(p, d));
        dist = gate(1, f32(dist - 0.5), 4);
        const val = Random.Float(f32(dist * dist));
        if (val <= 0.75 || dist <= 1) Painter.set(level, cell, T.MINE_BOULDER);
        else if (val <= 5 && dist <= 3) Painter.set(level, cell, T.EMPTY_DECO);
      }
    } else if (type === FUNGI) {
      for (const p of this.getPoints()) {
        const cell = level.pointToCell(p);
        if (level.map[cell] === T.EMPTY) level.map[cell] = T.HIGH_GRASS;
      }
      Painter.fillEllipse(level, this, 3, T.GRASS);
      for (let i = 0; i < Math.trunc((this.width() * this.height()) / 6); i++) {
        const r = this.random(1);
        if (level.map[level.pointToCell(r)] !== T.WALL) Painter.set(level, r, T.HIGH_GRASS);
      }
      const p = this.center();
      level.mobs.push({ kind: 'fungalSentry', pos: level.pointToCell(p), state: 'wandering' });
      Painter.set(level, p, T.GRASS);
      // No tall grass right above the sentry.
      p.y--;
      Painter.set(level, p, T.GRASS);
    } else {
      Painter.fillEllipse(level, this, 3, T.EMPTY);
    }
  }
}

/**
 * MineLargeRoom.findInternalCells: the cells reachable from one (four ways) without crossing crystal,
 * in the order the original's recursion finds them. (`limit` only guards against a ring with a gap.)
 */
function findInternalCells(level: GenLevel, cell: number, internal: number[], seen: Set<number>, limit: number): void {
  for (const i of level.neighbours4) {
    const next = cell + i;
    if (!seen.has(next) && level.map[next] !== T.MINE_CRYSTAL && seen.size < limit && level.insideMap(next)) {
      seen.add(next);
      internal.push(next);
      findInternalCells(level, next, internal, seen, limit);
    }
  }
}

/** MineSmallRoom: a small cave, crystals or cave-ins as the quest has it. */
export class MineSmallRoom extends CaveRoom {
  override readonly kind: string = 'MineSmallRoom';

  override minWidth(): number {
    return Math.max(6, super.minWidth());
  }
  override minHeight(): number {
    return Math.max(6, super.minHeight());
  }
  override sizeCatProbs(): number[] {
    return [1, 0, 0];
  }
  protected override fill(): number {
    return f32(0.4);
  }

  override paint(level: GenLevel): void {
    super.paint(level);
    const type = mineQuestType();
    if (type === CRYSTAL) {
      for (let i = 0; i < Math.trunc((this.width() * this.height()) / 3); i++) {
        const r = this.random(1);
        if (level.map[level.pointToCell(r)] !== T.WALL) Painter.set(level, r, T.MINE_CRYSTAL);
      }
    } else if (type === GNOLL) {
      gnollCaveIn(this, level, 5, 2, 0, () => false);
    }
  }
}

/** MineSecretRoom: a pocket of rock behind a hidden way, rich in dark gold. */
export class MineSecretRoom extends SecretRoom {
  readonly kind: string = 'MineSecretRoom';

  override maxWidth(): number {
    return 7;
  }
  override maxHeight(): number {
    return 7;
  }

  paint(level: GenLevel): void {
    Painter.fill(level, this, T.WALL);
    this.entrance().set(DoorType.HIDDEN);

    const type = mineQuestType();
    if (type === CRYSTAL) {
      Painter.fill(level, this, 1, T.MINE_CRYSTAL);
    } else if (type === GNOLL) {
      Painter.fill(level, this, 1, T.EMPTY_SP);
      level.drop(createItem('quest.ore', Random.NormalIntRange(4, 5)), level.pointToCell(this.center())).kind = 'chest';
      return;
    } else if (type === FUNGI) {
      Painter.fill(level, this, 1, T.HIGH_GRASS);
    } else {
      Painter.fill(level, this, 1, T.EMPTY);
    }

    const goldAmount = Random.NormalIntRange(4, 5);
    for (let i = 0; i < goldAmount; i++) {
      let cell: number;
      do {
        cell = level.pointToCell(this.random(1));
      } while (level.map[cell] === T.WALL_DECO);
      // (As the original: the vein goes where a second roll puts it, not where the first one looked.)
      Painter.set(level, this.random(1), T.WALL_DECO);
    }
  }
}
