import { describe, expect, it } from 'vitest';
import { applyEvent, canEnter, charAt, createMob, F, floorAt, hasFlag, heroById, LIVE_CALM_MS, levelAt, NEIGHBOURS8, type ServerMessage, T, type World } from '@pd/core';
import { pacify } from '../../core/test/helpers';
import { type Delivery, LIVE_TURN_TIMEOUT, RoomLogic } from '../src/room-logic';
import { sanitizeAction } from '../src/messages';

const alice = { id: 'alice', name: 'Alice', heroClass: 'warrior' as const };
const bob = { id: 'bob', name: 'Bob', heroClass: 'mage' as const };

/** What one player's game makes of what the room sends them. */
class Replica {
  world: World | null = null;
  seq = 0;

  receive(message: ServerMessage): void {
    if (message.type === 'snapshot') {
      this.world = structuredClone(message.world);
      this.seq = message.seq;
    } else if (message.type === 'event') {
      expect(message.seq).toBe(this.seq + 1);
      applyEvent(this.world!, message.event);
      this.seq = message.seq;
    }
  }
}

function route(deliveries: Delivery[], replicas: Record<string, Replica>): void {
  for (const { to, message } of deliveries) {
    for (const id of to) replicas[id]?.receive(JSON.parse(JSON.stringify(message)) as ServerMessage);
  }
}

/** A live room with Alice and Bob in it, nothing awake on its depths, the first depth known. */
function party(seed: number): { room: RoomLogic; world: World; replicas: Record<'alice' | 'bob', Replica> } {
  const room = RoomLogic.create(seed);
  const world = room.state().world;
  pacify(world);
  const replicas = { alice: new Replica(), bob: new Replica() };
  route(room.connect(alice, 0), replicas);
  route(room.connect(bob, 0), replicas);
  world.explored[1] = levelAt(world, 1).map.map(() => true);
  for (const r of Object.values(replicas)) r.world!.explored[1] = world.explored[1].slice();
  // Everyone in sight of everyone about the entrance: no tall grass in the way.
  for (const w of [world, ...Object.values(replicas).map((r) => r.world!)]) {
    const level = levelAt(w, 1);
    level.map = level.map.map((t) => (t === T.HIGH_GRASS || t === T.FURROWED_GRASS ? T.GRASS : t));
  }
  return { room, world, replicas };
}

/** A rat after a hero, two cells off along an open line, on the server's world and every replica. */
function ratAfter(world: World, replicas: Record<string, Replica>, heroId: string): void {
  const hero = heroById(world, heroId)!;
  const level = levelAt(world, 1);
  // In plain sight: no tall grass in between.
  const clear = (c: number): boolean => canEnter(level, c) && !charAt(world, 1, c) && !hasFlag(level.map[c]!, F.LOS_BLOCKING);
  const n = NEIGHBOURS8.find((d) => clear(hero.pos + d) && clear(hero.pos + 2 * d))!;
  for (const w of [world, ...Object.values(replicas).map((r) => r.world!)]) {
    const rat = createMob('r1', 'rat', hero.pos + 2 * n, 'hunting', 1);
    rat.enemy = heroId;
    floorAt(w, 1).mobs.push(rat);
  }
}

describe('a live room', () => {
  it('walks a hero to where they were sent, a beat at a time, holding nobody up; every replica keeps step', () => {
    const { room, world, replicas } = party(31);
    expect(room.live).toBe(true);
    const hero = heroById(world, 'alice')!;
    const goal = levelAt(world, 1).exit;
    // Nothing to do: nothing happens.
    expect(room.nextWake(0)).toBeNull();
    route(room.receive('alice', { type: 'act', action: { type: 'plan', steps: [{ type: 'go', to: goal }] } }, 0), replicas);
    for (let t = 0; t < 200 * LIVE_CALM_MS && hero.pos !== goal; t += LIVE_CALM_MS) route(room.pump(t), replicas);
    expect(hero.pos).toBe(goal);
    expect(replicas.alice.world).toEqual(world);
    expect(replicas.bob.world).toEqual(world);
  });

  it('in a fight, waits for the hero to move, then plays the turn at once', () => {
    const { room, world, replicas } = party(32);
    ratAfter(world, replicas, 'alice');
    const turn = world.turn;
    route(room.pump(1000), replicas);
    expect(world.turn).toBe(turn);
    route(room.receive('alice', { type: 'act', action: { type: 'wait' } }, 1100), replicas);
    // Bob, beside her, is in it too: the turn goes once he has moved as well.
    if (room.state().holdingSince.bob !== undefined) route(room.receive('bob', { type: 'act', action: { type: 'wait' } }, 1150), replicas);
    expect(world.turn).toBeGreaterThan(turn + 1);
    expect(replicas.bob.world).toEqual(world);
  });

  it('does not wait long for a player who says nothing while a companion plays, nor at all for one who is away', () => {
    const { room, world, replicas } = party(33);
    ratAfter(world, replicas, 'bob');
    // Bob holds the fight up; Alice plays on.
    route(room.receive('alice', { type: 'act', action: { type: 'wait' } }, 1000), replicas);
    const turn = world.turn;
    route(room.pump(1000 + LIVE_TURN_TIMEOUT - 1), replicas);
    expect(world.turn).toBe(turn);
    route(room.pump(1000 + LIVE_TURN_TIMEOUT + 1), replicas);
    expect(world.turn).toBeGreaterThan(turn);
    // Gone, Bob is not waited for at all.
    route(room.disconnect('bob', 20_000), replicas);
    const now = world.turn;
    // (Played at once, or at the next beat.)
    route(room.receive('alice', { type: 'act', action: { type: 'wait' } }, 20_001), replicas);
    route(room.pump(21_000), replicas);
    expect(world.turn).toBeGreaterThan(now);
    expect(replicas.alice.world).toEqual(world);
  });

  it('takes plans of the right shape only', () => {
    expect(sanitizeAction({ type: 'plan', steps: [{ type: 'go', to: 40, junk: 1 }, { type: 'hunt', target: 'm3' }, { type: 'rest' }, { type: 'stride', dx: 1, dy: -1 }, { type: 'pickup' }] }))
      .toEqual({ type: 'plan', steps: [{ type: 'go', to: 40 }, { type: 'hunt', target: 'm3' }, { type: 'rest' }, { type: 'stride', dx: 1, dy: -1 }, { type: 'pickup' }] });
    expect(sanitizeAction({ type: 'plan', steps: [{ type: 'plan', steps: [] }] })).toBeNull();
    expect(sanitizeAction({ type: 'plan', steps: [{ type: 'stride', dx: 0, dy: 0 }] })).toBeNull();
    expect(sanitizeAction({ type: 'plan', steps: Array.from({ length: 65 }, () => ({ type: 'rest' })) })).toBeNull();
  });
});
