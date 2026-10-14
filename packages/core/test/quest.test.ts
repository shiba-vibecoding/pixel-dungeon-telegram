import { describe, expect, it } from 'vitest';
import {
  act, addHero, adjacent, canEnter, charAt, createWorld, F, floorAt, hasFlag, heroById, heroView, isSafe, levelAt, NEIGHBOURS8, RoomType,
  type World,
} from '../src/index';
import { GHOST_FOES, type GhostType } from '../src/quest';
import { pacify } from './helpers';

/** A run whose sad ghost has appeared, given the foe of `type`, and a warrior standing next to it. */
function withGhost(type: GhostType = 1): { world: World; ghostId: string } {
  for (let seed = 1; seed < 200; seed++) {
    const world = createWorld(seed);
    for (let depth = 1; depth <= 4; depth++) levelAt(world, depth);
    const quest = world.quest;
    if (!quest) continue;
    quest.type = type;
    const floor = floorAt(world, quest.depth);
    const ghost = floor.mobs.find((m) => m.kind === 'ghost')!;
    pacify(world);
    floor.mobs = [ghost];
    addHero(world, { id: 'p', name: 'P', heroClass: 'warrior' });
    const hero = heroById(world, 'p')!;
    const level = levelAt(world, quest.depth);
    hero.depth = quest.depth;
    hero.time = floor.now;
    hero.pos = beside(world, ghost.pos);
    return { world, ghostId: ghost.id };
  }
  throw new Error('no ghost in 200 runs');
}

/** A free cell next to `pos` on the hero's depth. */
function beside(world: World, pos: number): number {
  const depth = world.quest!.depth;
  const level = levelAt(world, depth);
  return NEIGHBOURS8.map((n) => pos + n).find((c) => canEnter(level, c) && hasFlag(level.map[c]!, F.PASSABLE) && !charAt(world, depth, c))!;
}

/** Talks to the ghost, wherever it has drifted. */
function talk(world: World, ghostId: string) {
  const hero = heroById(world, 'p')!;
  const ghost = floorAt(world, hero.depth).mobs.find((m) => m.id === ghostId)!;
  if (!adjacent(ghost.pos, hero.pos)) hero.pos = beside(world, ghost.pos);
  return act(world, 'p', { type: 'attack', target: ghostId });
}

describe('the sad ghost (Ghost, Ghost.Quest)', () => {
  it('appears once per run, on depth 2 to 4 (always by 4), its foe that of its floor, with a weapon and an armour of tier 2 to 5 ready', () => {
    let seen = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const world = createWorld(seed);
      for (let depth = 1; depth <= 4; depth++) levelAt(world, depth);
      const ghosts = [1, 2, 3, 4].flatMap((d) => floorAt(world, d).mobs.filter((m) => m.kind === 'ghost').map(() => d));
      expect(ghosts.length).toBeLessThanOrEqual(1);
      if (ghosts.length === 1) {
        seen++;
        const quest = world.quest!;
        expect(quest.depth).toBe(ghosts[0]);
        // Ghost.Quest.spawn: a rat on depth 2, a gnoll on 3, a crab on 4.
        expect(quest.type).toBe(quest.depth - 1);
        expect(quest.weapon.kind.startsWith('weapon.')).toBe(true);
        expect(quest.armor.kind.startsWith('armor.')).toBe(true);
        expect(quest.weapon.level).toBe(quest.armor.level);
        expect(quest.weapon.level).toBeLessThanOrEqual(3);
      }
    }
    expect(seen).toBeGreaterThan(30);
  });

  it('drifts about the level', () => {
    const { world, ghostId } = withGhost();
    const hero = heroById(world, 'p')!;
    const ghost = floorAt(world, hero.depth).mobs.find((m) => m.id === ghostId)!;
    const cells = new Set([ghost.pos]);
    for (let i = 0; i < 60; i++) {
      act(world, 'p', { type: 'search' });
      cells.add(ghost.pos);
    }
    expect(cells.size).toBeGreaterThan(3);
  });

  it('cannot be hurt, is no threat; talking to it gives the quest, and its foe comes out out of sight', () => {
    const { world, ghostId } = withGhost(2);
    const hero = heroById(world, 'p')!;
    const floor = floorAt(world, hero.depth);
    const ghost = floor.mobs.find((m) => m.id === ghostId)!;
    expect(isSafe(world, hero)).toBe(true);
    const result = talk(world, ghostId);
    expect(result.ok && result.effects).toEqual([{ type: 'ghost', hero: 'p', line: 'intro', questType: 2 }]);
    expect(ghost.hp).toBe(1);
    expect(world.quest!.given).toBe(true);
    const foe = floor.mobs.find((m) => m.kind === 'gnollTrickster')!;
    expect(foe).toBeDefined();
    expect(heroView(world, hero)[foe.pos]).toBeFalsy();
    // Then only a reminder, and nothing to give yet.
    const again = talk(world, ghostId);
    expect(again.ok && again.effects).toEqual([{ type: 'ghost', hero: 'p', line: 'remind', questType: 2 }]);
    expect(act(world, 'p', { type: 'reward', choice: 'weapon' })).toEqual({ ok: false, reason: 'nothing to give' });
  });

  for (const type of [1, 2, 3] as const) {
    it(`the ${GHOST_FOES[type]} slain, the ghost calls the hero back and gives the chosen reward, then fades`, () => {
      const { world, ghostId } = withGhost(type);
      const hero = heroById(world, 'p')!;
      const quest = world.quest!;
      const floor = floorAt(world, quest.depth);
      talk(world, ghostId);
      const foe = floor.mobs.find((m) => m.kind === GHOST_FOES[type])!;
      Object.assign(hero, { attackSkill: 1000, ht: 5000, hp: 5000 });
      // Bring it over and slay it (the great crab parries what it sees coming: a blow from behind its back, then).
      foe.pos = beside(world, hero.pos);
      Object.assign(foe, { state: 'hunting', enemy: 'p', enemySeen: false });
      const effects = [];
      for (let k = 0; k < 200 && floor.mobs.includes(foe); k++) {
        if (type === 3) foe.enemySeen = false;
        // (The trickster keeps its distance, as Shattered's does: it is brought back each time.)
        if (type === 2 && !adjacent(foe.pos, hero.pos)) foe.pos = beside(world, hero.pos);
        const r = adjacent(foe.pos, hero.pos) ? act(world, 'p', { type: 'attack', target: foe.id }) : act(world, 'p', { type: 'wait' });
        if (r.ok) effects.push(...r.effects);
      }
      expect(floor.mobs.includes(foe)).toBe(false);
      expect(effects).toContainEqual({ type: 'ghost', hero: 'p', line: 'findMe', questType: type });
      expect(quest.processed).toBe(true);
      const reward = talk(world, ghostId);
      expect(reward.ok && reward.effects).toEqual([{ type: 'ghost', hero: 'p', line: 'reward', questType: type }]);
      const choice = type === 2 ? 'weapon' : 'armor';
      const item = quest[choice];
      const given = act(world, 'p', { type: 'reward', choice });
      expect(given.ok && given.effects.at(-1)).toMatchObject({ type: 'died', kind: 'ghost' });
      expect(given.ok && given.effects).toContainEqual({ type: 'ghost', hero: 'p', line: 'farewell', questType: type });
      expect(hero.items.some((i) => i.kind === item.kind && i.level === item.level)).toBe(true);
      expect(floor.mobs.some((m) => m.kind === 'ghost')).toBe(false);
      expect(quest.done).toBe(true);
      expect(act(world, 'p', { type: 'reward', choice })).toEqual({ ok: false, reason: 'nothing to give' });
    });
  }
});

describe('the Rat King', () => {
  it("holds court in a hidden treasury beside Goo's lair, and has no time for heroes", () => {
    let kings = 0;
    for (let seed = 1; seed <= 15; seed++) {
      const world = pacify(createWorld(seed));
      const level = levelAt(world, 5);
      const room = level.rooms.find((r) => r.type === RoomType.RAT_KING);
      const king = floorAt(world, 5).mobs.find((m) => m.kind === 'ratKing');
      expect(!!room).toBe(!!king);
      if (!king) continue;
      kings++;
      const chests = floorAt(world, 5).heaps.filter((h) => h.kind === 'chest' || h.kind === 'mimic');
      expect(chests.filter((h) => h.kind === 'mimic')).toHaveLength(1);
      addHero(world, { id: 'p', name: 'P', heroClass: 'rogue' });
      const hero = heroById(world, 'p')!;
      hero.depth = 5;
      hero.pos = NEIGHBOURS8.map((n) => king.pos + n).find((c) => canEnter(level, c) && !charAt(world, 5, c))!;
      const first = act(world, 'p', { type: 'attack', target: king.id });
      expect(first.ok && first.effects).toEqual([{ type: 'ratKing', hero: 'p', line: 'notSleeping' }]);
      const second = act(world, 'p', { type: 'attack', target: king.id });
      expect(second.ok && second.effects).toEqual([{ type: 'ratKing', hero: 'p', line: 'busy' }]);
      expect(king.hp).toBe(1);
    }
    expect(kings).toBeGreaterThan(3);
  });
});
