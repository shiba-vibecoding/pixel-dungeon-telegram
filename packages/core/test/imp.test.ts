import { describe, expect, it } from 'vitest';
import {
  act, addHero, canEnter, charAt, createRun, createWorld, floorAt, heroById, levelAt, NEIGHBOURS8, type World,
} from '../src/index';
import { generateLevel } from '../src/level/generate';
import { escapeScore } from '../src/vault';

/** A run in which the ambitious imp has turned up, with a solo hero standing next to him. */
function withImp(): { world: World; depth: number } {
  for (let seed = 1; seed < 200; seed++) {
    const world = createWorld(seed * 17);
    levelAt(world, 19);
    if (!world.impQuest) continue;
    const depth = world.impQuest.depth;
    const imp = floorAt(world, depth).mobs.find((mob) => mob.kind === 'imp')!;
    const level = levelAt(world, depth);
    const beside = NEIGHBOURS8.map((n) => imp.pos + n).find((c) => canEnter(level, c) && !charAt(world, depth, c))!;
    addHero(world, { id: 'p', name: 'P', heroClass: 'rogue' });
    const hero = heroById(world, 'p')!;
    Object.assign(hero, { depth, pos: beside, time: floorAt(world, depth).now, hp: 5000, ht: 5000 });
    floorAt(world, depth).mobs = floorAt(world, depth).mobs.filter((mob) => mob.kind === 'imp');
    floorAt(world, depth).respawn = 1e9;
    return { world, depth };
  }
  throw new Error('no imp in 200 runs');
}

describe('the ambitious imp (Imp, Imp.Quest)', () => {
  it('turns up at most once a run, on depths 17-19, by the vault\'s sealed entrance', () => {
    let seen = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const world = createWorld(seed * 31);
      levelAt(world, 19);
      const imps = [16, 17, 18, 19].flatMap((d) => floorAt(world, d).mobs.filter((m) => m.kind === 'imp').map(() => d));
      expect(imps.length).toBeLessThanOrEqual(1);
      if (!world.impQuest) continue;
      seen++;
      expect(imps).toEqual([world.impQuest.depth]);
      expect(world.impQuest.depth).toBeGreaterThanOrEqual(17);
      const level = levelAt(world, world.impQuest.depth);
      expect(level.transitions?.some((t) => t.type === 'branchExit')).toBe(true);
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('asks; his spell takes the hero into the vault without their gear, and the escape crystal brings them back', () => {
    const { world, depth } = withImp();
    const hero = heroById(world, 'p')!;
    const imp = floorAt(world, depth).mobs.find((mob) => mob.kind === 'imp')!;
    // Before he asks, the way is shut.
    const level = levelAt(world, depth);
    const way = level.transitions!.find((t) => t.type === 'branchExit')!.cell;
    const intro = act(world, 'p', { type: 'attack', target: imp.id });
    expect(intro.ok && intro.effects).toContainEqual({ type: 'imp', hero: 'p', line: 'intro' });
    expect(world.impQuest!.given).toBe(true);
    const weapon = hero.weapon;
    const items = hero.items.length;
    hero.pos = way;
    expect(act(world, 'p', { type: 'branch' }).ok).toBe(true);
    const vault = levelAt(world, depth);
    expect(vault.branch).toBe(1);
    expect(hero.depth).toBe(depth);
    expect(hero.weapon).toBeNull();
    expect(hero.armor.kind).toBe('armor.cloth');
    expect(hero.items.map((i) => i.kind)).toContain('quest.escapeCrystal');
    // Nothing explored yet: the crystal will not take the hero out (EscapeCrystal: leaving_start).
    const crystal = { type: 'vault' as const, op: 'escape' as const };
    expect(act(world, 'p', crystal)).toEqual({ ok: false, reason: 'leaving_start' });
    // The vault seen through: out, with the gear given back.
    world.explored[depth] = vault.map.map(() => true);
    expect(escapeScore(world, hero)).toBeGreaterThanOrEqual(50);
    const out = act(world, 'p', crystal);
    expect(out.ok).toBe(true);
    expect(levelAt(world, depth).branch ?? 0).toBe(0);
    expect(hero.weapon).toEqual(weapon);
    expect(hero.items.length).toBeGreaterThanOrEqual(items);
    expect(world.impQuest!.done).toBe(true);
  });

  it('the vault generates on every depth it can be on, for many runs', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const run = createRun(seed);
      for (const depth of [17, 18, 19]) {
        const vault = generateLevel(run, depth, undefined, false, null, 1);
        expect(vault.branch).toBe(1);
        expect(vault.transitions?.some((t) => t.type === 'branchEntrance')).toBe(true);
      }
    }
  });
});
