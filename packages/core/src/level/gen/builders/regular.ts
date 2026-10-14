import { Dungeon } from '../dungeon';
import { Random } from '../random';
import { ALL, type Room } from '../room';
import type { ConnectionRoom } from '../rooms/connection/connection';
import { createConnectionRoom, MazeConnectionRoom } from '../rooms/connection/rooms';
import { isStandard } from '../rooms/standard/standard';
import { Builder } from './builder';

/*
 * levels/builders/RegularBuilder: a main path of rooms and branches off it, with tunnels
 * (connection rooms) padding the way between them.
 */

export abstract class RegularBuilder extends Builder {
  protected pathVariance = 45;
  /** The share of the rooms with several connections that go on the main path. */
  protected pathLength = 0.25;
  /** Chances of extra rooms on the path. */
  protected pathLenJitterChances = [0, 0, 0, 1];
  protected pathTunnelChances = [2, 2, 1];
  protected branchTunnelChances = [1, 1, 0];
  /** Each adjacency is looked at twice, so this joins about half of the neighbours not yet connected. */
  protected extraConnectionChance = 0.3;

  protected entrance: Room | null = null;
  protected exit: Room | null = null;
  protected shop: Room | null = null;
  protected mainPathRooms: Room[] = [];
  protected multiConnections: Room[] = [];
  protected singleConnections: Room[] = [];

  setPathVariance(v: number): this {
    this.pathVariance = v;
    return this;
  }

  setPathLength(len: number, jitter: number[]): this {
    this.pathLength = len;
    this.pathLenJitterChances = jitter;
    return this;
  }

  setTunnelLength(path: number[], branch: number[]): this {
    this.pathTunnelChances = path;
    this.branchTunnelChances = branch;
    return this;
  }

  setExtraConnectionChance(chance: number): this {
    this.extraConnectionChance = chance;
    return this;
  }

  protected setupRooms(rooms: Room[]): void {
    for (const r of rooms) r.setEmpty();
    this.entrance = this.exit = this.shop = null;
    this.mainPathRooms = [];
    this.singleConnections = [];
    this.multiConnections = [];
    for (const r of rooms) {
      if (r.isEntrance()) this.entrance = r;
      else if (r.isExit()) this.exit = r;
      else if (r.kind === 'ShopRoom' && r.maxConnections(ALL) === 1) this.shop = r;
      else if (r.maxConnections(ALL) > 1) this.multiConnections.push(r);
      else if (r.maxConnections(ALL) === 1) this.singleConnections.push(r);
    }

    // Bigger rooms are much likelier on the main loop: they come earlier in the list.
    this.weightRooms(this.multiConnections);
    Random.shuffle(this.multiConnections);
    this.multiConnections = [...new Set(this.multiConnections)];
    // Shuffled again so that the path itself does not put the big rooms first.
    Random.shuffle(this.multiConnections);

    let roomsOnMainPath = Math.trunc(Math.fround(this.multiConnections.length * this.pathLength)) + Random.chances(this.pathLenJitterChances);
    while (roomsOnMainPath > 0 && this.multiConnections.length > 0) {
      const r = this.multiConnections.shift()!;
      roomsOnMainPath -= isStandard(r) ? r.sizeFactor() : 1;
      this.mainPathRooms.push(r);
    }
  }

  protected weightRooms(rooms: Room[]): void {
    for (const r of [...rooms]) {
      if (isStandard(r)) for (let i = 1; i < r.connectionWeight(); i++) rooms.push(r);
    }
  }

  /** Places the rooms to branch onto branches from the branchable ones; false if it cannot. */
  protected createBranches(rooms: Room[], branchable: Room[], roomsToBranch: Room[], connChances: readonly number[]): boolean {
    let i = 0;
    let connectingRoomsThisBranch: Room[] = [];
    let failedBranchAttempts = 0;
    let connectionChances = [...connChances];
    while (i < roomsToBranch.length) {
      if (failedBranchAttempts > 100) return false;
      const r = roomsToBranch[i]!;
      connectingRoomsThisBranch = [];

      let curr: Room;
      do {
        curr = Random.element(branchable)!;
      } while (r.group === 'secret' && curr.group === 'connection');

      let connectingRooms = Random.chances(connectionChances);
      if (connectingRooms === -1) {
        connectionChances = [...connChances];
        connectingRooms = Random.chances(connectionChances);
      }
      connectionChances[connectingRooms]!--;

      for (let j = 0; j < connectingRooms; j++) {
        const t: ConnectionRoom = r.group === 'secret' ? new MazeConnectionRoom() : createConnectionRoom(Dungeon.depth);
        let tries = 3;
        let angle: number;
        do {
          angle = Builder.placeRoom(rooms, curr, t, this.randomBranchAngle(curr));
          tries--;
        } while (angle === -1 && tries > 0);

        if (angle === -1) {
          t.clearConnections();
          for (const c of connectingRoomsThisBranch) {
            c.clearConnections();
            rooms.splice(rooms.indexOf(c), 1);
          }
          connectingRoomsThisBranch = [];
          break;
        }
        connectingRoomsThisBranch.push(t);
        rooms.push(t);
        curr = t;
      }

      if (connectingRoomsThisBranch.length !== connectingRooms) {
        failedBranchAttempts++;
        continue;
      }

      let tries = 10;
      let angle: number;
      do {
        angle = Builder.placeRoom(rooms, curr, r, this.randomBranchAngle(curr));
        tries--;
      } while (angle === -1 && tries > 0);

      if (angle === -1) {
        r.clearConnections();
        for (const t of connectingRoomsThisBranch) {
          t.clearConnections();
          rooms.splice(rooms.indexOf(t), 1);
        }
        connectingRoomsThisBranch = [];
        failedBranchAttempts++;
        continue;
      }

      for (const t of connectingRoomsThisBranch) if (Random.Int(3) <= 1) branchable.push(t);
      if (r.maxConnections(ALL) > 1 && Random.Int(3) === 0) {
        if (isStandard(r)) for (let j = 0; j < r.connectionWeight(); j++) branchable.push(r);
        else branchable.push(r);
      }
      i++;
    }
    return true;
  }

  protected randomBranchAngle(_r: Room): number {
    return Random.Float(360);
  }

  /** The end of every regular builder: neighbours found, and about half of the unconnected ones joined. */
  protected connectExtras(rooms: Room[]): void {
    Builder.findNeighbours(rooms);
    for (const r of rooms) {
      for (const n of r.neigbours) {
        if (!n.connected.has(r) && Random.Float() < this.extraConnectionChance) r.connect(n);
      }
    }
  }
}
