import { describe, expect, it } from 'vitest';
import {
  act, addHero, canEnter, charAt, createItem, createRun, createWorld, floorAt, heroById, levelAt, NEIGHBOURS8, type World,
} from '../src/index';
import { generateLevel } from '../src/level/generate';
import { hasPickaxe, mineProblem } from '../src/blacksmith';

/** A run with the troll blacksmith in it, a solo hero beside him, nothing else awake on his depth. */
function withSmith(): { world: World; depth: number } {
  for (let seed = 1; seed < 200; seed++) {
    const world = createWorld(seed * 13);
    levelAt(world, 14);
    const q = world.smithQuest;
    if (!q) continue;
    const smith = floorAt(world, q.depth).mobs.find((m) => m.kind === 'blacksmith')!;
    const level = levelAt(world, q.depth);
    addHero(world, { id: 'p', name: 'P', heroClass: 'warrior' });
    const hero = heroById(world, 'p')!;
    const pos = NEIGHBOURS8.map((n) => smith.pos + n).find((c) => canEnter(level, c) && !charAt(world, q.depth, c))!;
    Object.assign(hero, { depth: q.depth, pos, time: floorAt(world, q.depth).now, hp: 5000, ht: 5000 });
    floorAt(world, q.depth).mobs = [smith];
    floorAt(world, q.depth).respawn = 1e9;
    return { world, depth: q.depth };
  }
  throw new Error('no blacksmith in 200 runs');
}

describe('the troll blacksmith (Blacksmith, Blacksmith.Quest)', () => {
  it('keeps his smithy once a run, on depth 12, 13 or 14, over a crystal or a gnoll mine', () => {
    let seen = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const world = createWorld(seed * 7);
      levelAt(world, 14);
      const smiths = [11, 12, 13, 14].flatMap((d) => floorAt(world, d).mobs.filter((m) => m.kind === 'blacksmith').map(() => d));
      expect(smiths.length).toBeLessThanOrEqual(1);
      const q = world.smithQuest;
      if (!q) continue;
      seen++;
      expect(smiths).toEqual([q.depth]);
      expect([12, 13, 14]).toContain(q.depth);
      expect([1, 2]).toContain(q.type);
      expect(levelAt(world, q.depth).transitions?.some((t) => t.type === 'branchExit')).toBe(true);
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('the mine generates with its boss, for many runs and both kinds', () => {
    let crystal = 0;
    let gnoll = 0;
    for (let seed = 1; seed <= 40 && (crystal < 2 || gnoll < 2); seed++) {
      const run = createRun(seed);
      const world = { smithQuest: null, challenges: 0, heroes: [] } as unknown as World;
      for (let d = 1; d <= 14; d++) if (d % 5 !== 0) generateLevel(run, d, undefined, false, world);
      const q = world.smithQuest;
      if (!q) continue;
      const mine = generateLevel(run, q.depth, undefined, false, world, 1);
      expect(mine.branch).toBe(1);
      expect(mine.transitions?.some((t) => t.type === 'branchEntrance')).toBe(true);
      const kinds = (mine.spawn?.mobs ?? []).map((m) => m.kind);
      if (q.type === 1) {
        crystal++;
        expect(kinds).toContain('crystalSpire');
      } else {
        gnoll++;
        expect(kinds).toContain('gnollGeomancer');
      }
    }
    expect(crystal + gnoll).toBeGreaterThan(1);
  });

  it('lends his pickaxe, sends the hero down, takes the dark gold back up for favour, and pays it out', () => {
    const { world, depth } = withSmith();
    const hero = heroById(world, 'p')!;
    const smith = floorAt(world, depth).mobs.find((m) => m.kind === 'blacksmith')!;
    const intro = act(world, 'p', { type: 'attack', target: smith.id });
    expect(intro.ok && intro.effects).toContainEqual(expect.objectContaining({ type: 'blacksmith', line: 'intro' }));
    expect(hasPickaxe(hero)).toBe(true);
    // Down the old mine.
    hero.pos = levelAt(world, depth).transitions!.find((t) => t.type === 'branchExit')!.cell;
    expect(act(world, 'p', { type: 'branch' }).ok).toBe(true);
    const mine = levelAt(world, depth);
    expect(mine.branch).toBe(1);
    floorAt(world, depth).mobs = [];
    // The pickaxe digs into the rock beside the hero.
    const rock = NEIGHBOURS8.map((n) => hero.pos + n).find((c) => mineProblem(world, hero, c) === null);
    if (rock !== undefined) {
      expect(act(world, 'p', { type: 'mine', cell: rock }).ok).toBe(true);
    }
    // Back up with twenty pieces of dark gold, the boss beaten: 1000 + 1000 favour.
    hero.items.push(createItem('quest.ore', 20));
    world.smithQuest!.bossBeaten = true;
    hero.pos = mine.transitions!.find((t) => t.type === 'branchEntrance')!.cell;
    expect(act(world, 'p', { type: 'branch' }).ok).toBe(true);
    const q = world.smithQuest!;
    expect(q.completed).toBe(true);
    expect(q.favor).toBe(2000);
    expect(hero.items.some((i) => i.kind === 'quest.ore')).toBe(false);
    expect(hasPickaxe(hero)).toBe(false);
    // His services: the favour's worth in gold.
    const gold = hero.gold;
    const back = floorAt(world, depth).mobs.find((m) => m.kind === 'blacksmith')!;
    hero.pos = NEIGHBOURS8.map((n) => back.pos + n).find((c) => canEnter(levelAt(world, depth), c) && !charAt(world, depth, c))!;
    expect(act(world, 'p', { type: 'blacksmith', service: 'cashout' }).ok).toBe(true);
    expect(hero.gold + hero.items.filter((i) => i.kind === 'gold').reduce((n, i) => n + i.qty, 0)).toBeGreaterThan(gold);
  });
});
