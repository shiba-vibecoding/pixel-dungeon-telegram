import { describe, expect, it } from 'vitest';
import { act, addHero, canEnter, charAt, createItem, createWorld, findPath, floorAt, heroById, levelAt, NEIGHBOURS8 } from '../src/index';

/*
 * Found by the soak: a scroll of teleportation read in the Dwarf King's sealed arena sent the hero to a cell outside it, from
 * which no way led back (the bot was stuck at the entrance for ever). Shattered's ScrollOfTeleportation.teleportChar
 * sends a character on a boss's level, or on a floor sealed by a fight, only where it could walk to.
 */

describe('a scroll of teleportation on a boss level', () => {
  it('lands the hero somewhere they can walk to, never behind a locked door', () => {
    for (const depth of [10, 15, 20, 25]) {
      for (let seed = 1; seed <= 8; seed++) {
        const world = createWorld(seed * 31 + depth);
        const hero = addHero(world, { id: 'me', name: 'Me', heroClass: 'warrior' });
        const level = levelAt(world, depth);
        hero.depth = depth;
        hero.pos = NEIGHBOURS8.map((n) => level.entrance + n).find((c) => canEnter(level, c) && !charAt(world, depth, c))!;
        hero.time = floorAt(world, depth).now;
        floorAt(world, depth).mobs = [];
        const start = hero.pos;
        hero.items.push(createItem('scroll.teleportation'));
        const read = act(world, 'me', { type: 'use', item: hero.items.length - 1 });
        expect(read.ok, `depth ${depth}, seed ${seed}`).toBe(true);
        const now = heroById(world, 'me')!;
        if (now.pos === start) continue;
        const none = new Set<number>();
        const way = findPath(level, start, now.pos, none) ?? findPath(level, start, now.pos, none, undefined, false, true);
        expect(way, `depth ${depth}, seed ${seed}: from ${start} to ${now.pos}`).not.toBeNull();
      }
    }
  });
});
