import { Dungeon } from '../dungeon';
import { Random } from '../random';
import { PointF } from '../rect';
import { ALL, type Room } from '../room';
import { createConnectionRoom } from '../rooms/connection/rooms';
import { Builder } from './builder';
import { RegularBuilder } from './regular';

/*
 * levels/builders/LoopBuilder and FigureEightBuilder: the main path laid as one loop through the
 * entrance and the exit, or as two loops meeting at a landmark room; the other rooms branch off.
 */

const f32 = Math.fround;

/** x^n for a whole n, by multiplication (Math.pow is left to each engine). */
function powInt(x: number, n: number): number {
  let result = 1;
  for (let i = 0; i < n; i++) result *= x;
  return result;
}

/** The loop's shape: a circle, or flattened into an oval by the curve exponent and intensity. */
class LoopShape {
  curveExponent = 0;
  curveIntensity = 1;
  curveOffset = 0;

  set(exponent: number, intensity: number, offset: number): void {
    this.curveExponent = Math.abs(exponent);
    this.curveIntensity = f32(intensity % 1);
    this.curveOffset = f32(offset % 0.5);
  }

  targetAngle(percentAlong: number): number {
    percentAlong = f32(percentAlong + this.curveOffset);
    return f32(360 * f32(this.curveIntensity * this.curveEquation(percentAlong) + (1 - this.curveIntensity) * percentAlong - this.curveOffset));
  }

  private curveEquation(x: number): number {
    return powInt(4, 2 * this.curveExponent) * powInt((x % 0.5) - 0.25, 2 * this.curveExponent + 1) + 0.25 + 0.5 * Math.floor(2 * x);
  }
}

/** Branch angles: of four random ones, the one pointing most nearly at the loop's centre. */
function angleTowards(r: Room, center: PointF | null): number {
  if (!center) return Random.Float(360);
  let toCenter = Builder.angleBetweenPoints(new PointF(f32((r.left + r.right) / 2), f32((r.top + r.bottom) / 2)), center);
  if (toCenter < 0) toCenter = f32(toCenter + 360);
  let currAngle = Random.Float(360);
  for (let i = 0; i < 4; i++) {
    const newAngle = Random.Float(360);
    if (Math.abs(toCenter - newAngle) < Math.abs(toCenter - currAngle)) currAngle = newAngle;
  }
  return currAngle;
}

function centerOf(loop: Room[]): PointF {
  const c = new PointF();
  for (const r of loop) {
    c.x = f32(c.x + f32((r.left + r.right) / 2));
    c.y = f32(c.y + f32((r.top + r.bottom) / 2));
  }
  c.x = f32(c.x / loop.length);
  c.y = f32(c.y / loop.length);
  return c;
}

/** Each room of a loop, followed by the tunnels (connection rooms) after it. */
function withTunnels(rooms: Room[], tunnelChances: readonly number[], pathTunnels: { value: number[] }): Room[] {
  const loop: Room[] = [];
  for (const r of rooms) {
    loop.push(r);
    let tunnels = Random.chances(pathTunnels.value);
    if (tunnels === -1) {
      pathTunnels.value = [...tunnelChances];
      tunnels = Random.chances(pathTunnels.value);
    }
    pathTunnels.value[tunnels]!--;
    for (let j = 0; j < tunnels; j++) loop.push(createConnectionRoom(Dungeon.depth));
  }
  return loop;
}

/** Lays a loop out round its first room (already placed), then closes it with tunnels. */
function placeLoop(rooms: Room[], loop: Room[], startAngle: number, shape: LoopShape, collision: Room[]): boolean {
  const first = loop[0]!;
  let prev = first;
  for (let i = 1; i < loop.length; i++) {
    const r = loop[i]!;
    const targetAngle = f32(startAngle + shape.targetAngle(f32(i / loop.length)));
    if (Builder.placeRoom(rooms, prev, r, targetAngle) === -1) return false;
    prev = r;
    if (!rooms.includes(prev)) rooms.push(prev);
  }
  // Closing the loop is left to chance, as in the original.
  while (!prev.connect(first)) {
    const c = createConnectionRoom(Dungeon.depth);
    if (Builder.placeRoom(collision === loop ? loop : rooms, prev, c, Builder.angleBetweenRooms(prev, first)) === -1) return false;
    loop.push(c);
    rooms.push(c);
    prev = c;
  }
  return true;
}

export class LoopBuilder extends RegularBuilder {
  private readonly shape = new LoopShape();
  private loopCenter: PointF | null = null;

  setLoopShape(exponent: number, intensity: number, offset: number): this {
    this.shape.set(exponent, intensity, offset);
    return this;
  }

  build(rooms: Room[]): Room[] | null {
    this.setupRooms(rooms);
    const entrance = this.entrance;
    if (!entrance) return null;
    entrance.setSize();
    entrance.setPos(0, 0);

    const startAngle = Random.Float(0, 360);
    this.mainPathRooms.unshift(entrance);
    if (this.exit) this.mainPathRooms.splice(Math.trunc((this.mainPathRooms.length + 1) / 2), 0, this.exit);

    const loop = withTunnels(this.mainPathRooms, this.pathTunnelChances, { value: [...this.pathTunnelChances] });
    // The tunnels closing the loop only check collisions against the loop itself (placeRoom(loop, ...)).
    if (!placeLoop(rooms, loop, startAngle, this.shape, loop)) return null;

    if (this.shop) {
      let angle: number;
      let tries = 10;
      do {
        angle = Builder.placeRoom(loop, entrance, this.shop, Random.Float(360));
        tries--;
      } while (angle === -1 && tries >= 0);
      if (angle === -1) return null;
    }

    this.loopCenter = centerOf(loop);
    const branchable = [...loop];
    const roomsToBranch = [...this.multiConnections, ...this.singleConnections];
    this.weightRooms(branchable);
    if (!this.createBranches(rooms, branchable, roomsToBranch, this.branchTunnelChances)) return null;

    this.connectExtras(rooms);
    return rooms;
  }

  protected override randomBranchAngle(r: Room): number {
    return angleTowards(r, this.loopCenter);
  }
}

export class FigureEightBuilder extends RegularBuilder {
  private readonly shape = new LoopShape();
  private landmarkRoom: Room | null = null;
  private firstLoop: Room[] = [];
  private secondLoop: Room[] = [];
  private firstLoopCenter: PointF | null = null;
  private secondLoopCenter: PointF | null = null;

  setLoopShape(exponent: number, intensity: number, offset: number): this {
    this.shape.set(exponent, intensity, offset);
    return this;
  }

  setLandmarkRoom(room: Room): this {
    this.landmarkRoom = room;
    return this;
  }

  build(rooms: Room[]): Room[] | null {
    this.setupRooms(rooms);

    if (!this.landmarkRoom) {
      // Large and giant standard rooms make the best landmarks.
      for (const r of this.mainPathRooms) {
        if (r.maxConnections(ALL) >= 4 &&
          (!this.landmarkRoom || this.landmarkRoom.minWidth() * this.landmarkRoom.minHeight() < r.minWidth() * r.minHeight())) {
          this.landmarkRoom = r;
        }
      }
      // Another room on the path to make up for it.
      if (this.multiConnections.length > 0) this.mainPathRooms.push(this.multiConnections.shift()!);
    }
    const landmark = this.landmarkRoom;
    if (!landmark) return null;
    removeFrom(this.mainPathRooms, landmark);
    removeFrom(this.multiConnections, landmark);

    let startAngle = Random.Float(0, 360);

    let roomsOnFirstLoop = Math.trunc(this.mainPathRooms.length / 2);
    if (this.mainPathRooms.length % 2 === 1) roomsOnFirstLoop += Random.Int(2);

    const roomsToLoop = [...this.mainPathRooms];
    const firstLoopTemp: Room[] = [landmark];
    for (let i = 0; i < roomsOnFirstLoop; i++) firstLoopTemp.push(roomsToLoop.shift()!);
    firstLoopTemp.splice(Math.trunc((firstLoopTemp.length + 1) / 2), 0, this.entrance!);

    const pathTunnels = { value: [...this.pathTunnelChances] };
    this.firstLoop = withTunnels(firstLoopTemp, this.pathTunnelChances, pathTunnels);

    const secondLoopTemp: Room[] = [landmark, ...roomsToLoop];
    if (this.exit) secondLoopTemp.splice(Math.trunc((secondLoopTemp.length + 1) / 2), 0, this.exit);
    this.secondLoop = withTunnels(secondLoopTemp, this.pathTunnelChances, pathTunnels);

    landmark.setSize();
    landmark.setPos(0, 0);

    if (!placeLoop(rooms, this.firstLoop, startAngle, this.shape, rooms)) return null;
    startAngle = f32(startAngle + 180);
    if (!placeLoop(rooms, this.secondLoop, startAngle, this.shape, rooms)) return null;

    if (this.shop) {
      let angle: number;
      let tries = 10;
      do {
        angle = Builder.placeRoom(rooms, this.entrance!, this.shop, Random.Float(360));
        tries--;
      } while (angle === -1 && tries >= 0);
      if (angle === -1) return null;
    }

    this.firstLoopCenter = centerOf(this.firstLoop);
    this.secondLoopCenter = centerOf(this.secondLoop);

    const branchable = [...this.firstLoop, ...this.secondLoop];
    // The landmark is in both loops: once is enough.
    removeFrom(branchable, landmark);

    const roomsToBranch = [...this.multiConnections, ...this.singleConnections];
    this.weightRooms(branchable);
    if (!this.createBranches(rooms, branchable, roomsToBranch, this.branchTunnelChances)) return null;

    this.connectExtras(rooms);
    return rooms;
  }

  protected override randomBranchAngle(r: Room): number {
    return angleTowards(r, this.firstLoop.includes(r) ? this.firstLoopCenter : this.secondLoopCenter);
  }
}

function removeFrom<T>(list: T[], value: T): void {
  const index = list.indexOf(value);
  if (index >= 0) list.splice(index, 1);
}
