import { describe, expect, it } from 'vitest';
import {
  addHero, BOSS_SLOT, bossBeaten, bossScore, challengeMultiplier, createItem, createWorld, DARKNESS, exploredCells, explorePercent10, exploredFloors, floorAt,
  type Hero, heroById, levelAt, NO_HEALING, QUEST_SLOT, runOutcome, scoreBreakdown, scoreGhostDone, scoreGhostHit, scoreImpDone, scoreBlacksmithDone,
  scoreWandmakerDone, SWARM_INTELLIGENCE, T, WIDTH, type World,
} from '../src/index';

/** A lone warrior who has been to depth 4, level 10, with 1200 gold and the starting kit worn, the pack empty. */
function sample(challenges = 0): { world: World; hero: Hero } {
  const world = createWorld(11, challenges);
  addHero(world, { id: 'p', name: 'P', heroClass: 'warrior' });
  const hero = heroById(world, 'p')!;
  for (let d = 1; d <= 4; d++) levelAt(world, d);
  hero.depth = 4;
  hero.lvl = 10;
  hero.stats = { gold: 1200, food: 0, brewed: 0, piranhas: 0 };
  hero.items = [];
  return { world, hero };
}

/** A floor with nothing left to find: no heaps, no doors that hide or lock, no mobs; every cell seen. */
function tidy(world: World, depth: number): void {
  const level = levelAt(world, depth);
  const floor = floorAt(world, depth);
  floor.heaps = [];
  floor.mobs = [];
  delete floor.altar;
  // (A magical-fire room's eternal fire, put out: it keeps its room from counting, as in RegularLevel.levelExplorePercent.)
  delete level.eternalFire;
  level.map = level.map.map((cell) => (cell === T.SECRET_DOOR || cell === T.LOCKED_DOOR || cell === T.BARRICADE ? T.DOOR : cell));
  exploredCells(world, depth).fill(true);
}

describe('Shattered’s score', () => {
  it('counts progress, treasure, exploration, bosses and quests, as the original does', () => {
    const { world, hero } = sample();
    for (const d of [1, 2, 3]) tidy(world, d);
    const b = scoreBreakdown(world, hero, 4, 1200);
    // Level x deepest depth x 65.
    expect(b.progress).toBe(10 * 4 * 65);
    // Gold, and what the worn kit is worth.
    expect(b.treasure).toBe(1200 + b.items);
    // Four regular floors made (depth 5 is a boss's, and not yet made); three of them tidied, so three are whole.
    expect(exploredFloors(world)).toEqual([1, 2, 3, 4]);
    expect(b.floors).toBe(4);
    expect(b.clean).toBe(3);
    expect(b.explore).toBeGreaterThanOrEqual(3 * 200);
  });

  it('caps progress at 50 000 and treasure at 20 000', () => {
    const { world, hero } = sample();
    hero.lvl = 30;
    expect(scoreBreakdown(world, hero, 26, 0).progress).toBe(50_000);
    expect(scoreBreakdown(world, hero, 20, 0).progress).toBe(30 * 20 * 65);
    hero.lvl = 1000;
    expect(scoreBreakdown(world, hero, 26, 0).progress).toBe(50_000);
    expect(scoreBreakdown(world, hero, 4, 90_000).treasure).toBe(20_000);
  });

  it('adds what the hero carries to the treasure, at its value', () => {
    const { world, hero } = sample();
    hero.items = [createItem('potion.healing', 3)];
    const b = scoreBreakdown(world, hero, 4, 100);
    expect(b.items).toBeGreaterThan(0);
    expect(b.treasure).toBe(100 + b.items);
  });

  it('scores a floor by its missed rooms: whole, half, a fifth, nothing', () => {
    const { world } = sample();
    tidy(world, 1);
    expect(explorePercent10(world, 1)).toBe(10);
    const level = levelAt(world, 1);
    const floor = floorAt(world, 1);
    // A chest where nobody has opened it, in three different rooms in turn.
    const rooms = level.rooms.filter((r) => r.right - r.left > 2 && r.bottom - r.top > 2);
    const cellIn = (i: number): number => (rooms[i]!.top + 1) * WIDTH + rooms[i]!.left + 1;
    const spots = rooms.map((_, i) => i).filter((i) => level.map[cellIn(i)] !== T.WALL);
    expect(spots.length).toBeGreaterThanOrEqual(3);
    const chest = (i: number): void => {
      floor.heaps.push({ pos: cellIn(i), kind: 'chest', items: [createItem('gold', 50)] });
    };
    chest(spots[0]!);
    expect(explorePercent10(world, 1)).toBe(5);
    chest(spots[1]!);
    expect(explorePercent10(world, 1)).toBe(2);
    chest(spots[2]!);
    expect(explorePercent10(world, 1)).toBe(0);
  });

  it('does not count a heap dropped during play, nor an unseen one in the open, but does count a key lying about', () => {
    const { world } = sample();
    tidy(world, 1);
    const level = levelAt(world, 1);
    const floor = floorAt(world, 1);
    const room = level.rooms.find((r) => r.right - r.left > 2 && r.bottom - r.top > 2)!;
    const pos = (room.top + 1) * WIDTH + room.left + 1;
    floor.heaps.push({ pos, kind: 'heap', items: [createItem('gold', 5)], auto: true });
    expect(explorePercent10(world, 1)).toBe(10);
    floor.heaps = [{ pos, kind: 'heap', items: [createItem('key.iron')] }];
    expect(explorePercent10(world, 1)).toBe(5);
    floor.heaps = [{ pos, kind: 'heap', items: [createItem('gold', 5)] }];
    expect(explorePercent10(world, 1)).toBe(10);
    exploredCells(world, 1)[pos] = false;
    expect(explorePercent10(world, 1)).toBe(5);
  });

  it("misses the magical-fire room while its fire burns, the crystal-key room while its key is unused, and not a crystal room's show heaps", () => {
    const { world, hero } = sample();
    tidy(world, 1);
    const level = levelAt(world, 1);
    const room = level.rooms.find((r) => r.right - r.left > 2 && r.bottom - r.top > 2)!;
    const pos = (room.top + 1) * WIDTH + room.left + 1;
    room.kind = 'MagicalFireRoom';
    level.eternalFire = [pos];
    expect(explorePercent10(world, 1)).toBe(5);
    delete level.eternalFire;
    room.kind = 'CrystalVaultRoom';
    hero.items = [{ ...createItem('key.crystal'), depth: 1 }];
    expect(explorePercent10(world, 1)).toBe(5);
    hero.items = [];
    floorAt(world, 1).heaps = [{ pos, kind: 'chest', items: [createItem('gold', 5)], autoExplored: true }];
    expect(explorePercent10(world, 1)).toBe(10);
  });

  it('pays each floor 50 x the floors counted, by how much of it was cleared', () => {
    const { world, hero } = sample();
    for (const d of [1, 2, 3, 4]) tidy(world, d);
    expect(scoreBreakdown(world, hero, 4, 0).explore).toBe(4 * 50 * 4);
    const floor = floorAt(world, 2);
    const level = levelAt(world, 2);
    const room = level.rooms.find((r) => r.right - r.left > 2 && r.bottom - r.top > 2)!;
    floor.heaps.push({ pos: (room.top + 1) * WIDTH + room.left + 1, kind: 'chest', items: [createItem('gold', 5)] });
    // One floor of four is half-cleared: 200 - 100.
    expect(scoreBreakdown(world, hero, 4, 0).explore).toBe(4 * 50 * 3 + 100);
  });

  it('gives the bosses their rewards, less their avoidable hits, and never below nothing', () => {
    const { world, hero } = sample();
    bossBeaten(world, 'goo', 0);
    bossScore(world, BOSS_SLOT.goo, -300);
    bossBeaten(world, 'tengu', 0);
    bossBeaten(world, 'dm300', 0);
    bossScore(world, BOSS_SLOT.king, -400);
    bossBeaten(world, 'yog', 2);
    const b = scoreBreakdown(world, hero, 4, 0);
    expect(b.bossParts).toEqual([700, 2000, 3000, -400, 7500]);
    // The King's part is below nothing, and counts as nothing.
    expect(b.bosses).toBe(700 + 2000 + 3000 + 7500);
  });

  it('gives the quests theirs', () => {
    const { world, hero } = sample();
    scoreGhostDone(world);
    scoreGhostHit(world, 100);
    scoreWandmakerDone(world);
    scoreBlacksmithDone(world, 750);
    scoreImpDone(world);
    const b = scoreBreakdown(world, hero, 4, 0);
    expect(b.questParts.slice(0, 4)).toEqual([900, 2000, 750, 4000]);
    expect(b.quests).toBe(7650);
    expect(QUEST_SLOT.imp).toBe(3);
  });

  it('multiplies by 2 for a win, 2.5 for the way out to the surface, and by Shattered’s challenge multiplier', () => {
    expect(challengeMultiplier(0)).toBe(1);
    // 1.25 ^ n to the nearest twentieth: 1.25, 1.55, 1.95, 2.45, 3.05.
    const masks = [DARKNESS, DARKNESS | SWARM_INTELLIGENCE, DARKNESS | SWARM_INTELLIGENCE | NO_HEALING];
    expect(masks.map(challengeMultiplier)).toEqual([1.25, 1.55, 1.95]);
    const { world, hero } = sample();
    const plain = scoreBreakdown(world, hero, 4, 1200);
    expect(plain.winMultiplier).toBe(1);
    expect(plain.chalMultiplier).toBe(1);
    world.victory = true;
    world.ending = 'amulet';
    expect(scoreBreakdown(world, hero, 4, 1200)).toMatchObject({ winMultiplier: 2, total: plain.total * 2 });
    world.ending = 'surface';
    expect(scoreBreakdown(world, hero, 4, 1200).winMultiplier).toBe(2.5);
    world.challenges = DARKNESS | SWARM_INTELLIGENCE;
    const b = scoreBreakdown(world, hero, 4, 1200);
    expect(b.chalMultiplier).toBe(1.55);
    expect(b.total).toBe(Math.trunc((b.progress + b.treasure + b.explore + b.bosses + b.quests) * 5 * 31 / 40));
  });

  it('sums its parts to the total runOutcome gives, whatever is in the world', () => {
    const { world, hero } = sample(DARKNESS);
    bossBeaten(world, 'goo', 0);
    scoreGhostDone(world);
    hero.items = [createItem('potion.healing', 2)];
    for (const won of [false, true]) {
      world.victory = won;
      const outcome = runOutcome(world, hero);
      const b = outcome.breakdown!;
      expect(outcome.score).toBe(b.total);
      expect(outcome.depth).toBe(4);
      const sum = b.progress + b.treasure + b.explore + b.bosses + b.quests;
      expect(sum).toBeGreaterThan(0);
      expect(b.total).toBe(Math.trunc((sum * (won ? 4 : 2) * 25) / 40));
      expect(b.winMultiplier).toBe(won ? 2 : 1);
      expect(b.chalMultiplier).toBe(1.25);
      expect(b.bosses).toBe(1000);
      expect(b.quests).toBe(1000);
    }
  });

  it('does not change the world by being asked', () => {
    const { world, hero } = sample();
    const before = JSON.stringify(world);
    runOutcome(world, hero);
    expect(JSON.stringify(world)).toBe(before);
  });
});
