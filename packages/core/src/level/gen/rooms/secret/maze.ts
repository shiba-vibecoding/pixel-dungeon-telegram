import type { Item } from '../../../../items';
import { T } from '../../../terrain';
import type { GenLevel } from '../../genlevel';
import { Generator } from '../../generator';
import { Maze } from '../../maze';
import { Painter } from '../../painter';
import { Random } from '../../random';
import { Point } from '../../rect';
import { DoorType } from '../../room';
import { SecretRoom } from './secret';

/**
 * PathFinder.buildDistanceMap(to, passable) on a grid `w` cells wide: each cell's distance in steps
 * (8-way, never wrapping round an edge) from `to`; Number.MAX_SAFE_INTEGER where it cannot be reached.
 */
function distanceMap(w: number, to: number, passable: readonly boolean[]): number[] {
  const size = passable.length;
  const distance = new Array<number>(size).fill(Number.MAX_SAFE_INTEGER);
  const dirLR = [-1 - w, -1, -1 + w, -w, +w, +1 - w, +1, +1 + w];
  const queue = [to];
  distance[to] = 0;
  for (let head = 0; head < queue.length; head++) {
    const step = queue[head]!;
    const nextDistance = distance[step]! + 1;
    const start = step % w === 0 ? 3 : 0;
    const end = (step + 1) % w === 0 ? 3 : 0;
    for (let i = start; i < dirLR.length - end; i++) {
      const n = step + dirLR[i]!;
      if (n >= 0 && n < size && passable[n] && distance[n]! > nextDistance) {
        queue.push(n);
        distance[n] = nextDistance;
      }
    }
  }
  return distance;
}

/** Item.upgrade for a weapon or armour (Weapon.upgrade, Armor.upgrade): from +4 the enchantment may wear off. */
function upgrade(item: Item): void {
  if ((item.enchant !== undefined || item.glyph !== undefined) && item.level >= 4) {
    // 10/20/40/80/100% from +4/5/6/7/8.
    let chance = 1;
    for (let i = 4; i < item.level; i++) chance *= 2;
    if (Random.Float(10) < chance) {
      delete item.enchant;
      delete item.glyph;
    }
  }
  item.cursed = false;
  item.level++;
}

/**
 * SecretMazeRoom: a large maze, with a chest at its far end holding a weapon or armour of the next
 * region's sort, never cursed, a third of the time one better.
 */
export class SecretMazeRoom extends SecretRoom {
  readonly kind: string = 'SecretMazeRoom';

  override minWidth(): number {
    return 14;
  }
  override minHeight(): number {
    return 14;
  }
  override maxWidth(): number {
    return 18;
  }
  override maxHeight(): number {
    return 18;
  }

  paint(level: GenLevel): void {
    Painter.fill(level, this, T.WALL);
    Painter.fill(level, this, 1, T.EMPTY);

    Maze.allowDiagonals = false;
    const maze = Maze.generateRoom(this);
    const width = this.width();
    const passable = new Array<boolean>(width * this.height()).fill(false);

    Painter.fill(level, this, 1, T.EMPTY);
    for (let x = 0; x < maze.length; x++) {
      for (let y = 0; y < maze[0]!.length; y++) {
        if (maze[x]![y] === Maze.FILLED) Painter.fill(level, x + this.left, y + this.top, 1, 1, T.WALL);
        passable[x + width * y] = maze[x]![y] === Maze.EMPTY;
      }
    }

    const entrance = this.entrance();
    const entrancePos = entrance.x - this.left + width * (entrance.y - this.top);
    const distance = distanceMap(width, entrancePos, passable);

    let bestDist = 0;
    const bestDistP = new Point();
    for (let i = 0; i < distance.length; i++) {
      if (distance[i] !== Number.MAX_SAFE_INTEGER && distance[i]! > bestDist) {
        bestDist = distance[i]!;
        bestDistP.x = (i % width) + this.left;
        bestDistP.y = Math.trunc(i / width) + this.top;
      }
    }

    // One floor set higher in probability, never cursed: Generator.randomWeapon(depth / 5 + 1, true) and
    // randomArmor(depth / 5 + 1), their curse enchantment or glyph taken off (SEAM(gear): no floor sets
    // or curse enchantments yet, so the depth's own items).
    let prize: Item;
    if (Random.Int(2) === 0) prize = Generator.randomWeapon();
    else prize = Generator.randomArmor();
    prize.cursed = false;
    // cursedKnown.
    delete prize.curseUnknown;

    // A third of the time, an extra upgrade.
    if (Random.Int(3) === 0) upgrade(prize);

    level.drop(prize, level.pointToCell(bestDistP)).kind = 'chest';

    this.entrance().set(DoorType.HIDDEN);
  }
}
