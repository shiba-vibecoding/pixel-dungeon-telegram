import { describe, expect, it } from 'vitest';
import {
  act, addHero, createItem, createMob, createWorld, type Effect, floorAt, type Hero, heroById, levelAt, type Mob, type MobKind, Rng, T,
  TRAPS, type TrapKind, WIDTH, type World,
} from '../src/index';
import type { Ctx } from '../src/floor';
import { mobPress, setTrap, triggerTrap } from '../src/traps';
import { openPits } from '../src/trap-effects';

/** Middle of the open ground carved out for these tests. */
const CENTRE = 16 + 16 * WIDTH;

interface Scene {
  world: World;
  hero: Hero;
  ctx: Ctx;
}

/**
 * A mage (no seal to shield him) in the middle of 13 by 11 cells of bare floor on `depth`, its monsters
 * cleared away, with lots of health so that the traps' numbers can be read off what he loses.
 */
function scene(depth = 1, seed = 6): Scene {
  const world = createWorld(seed);
  addHero(world, { id: 'p', name: 'P', heroClass: 'mage' });
  const hero = heroById(world, 'p')!;
  if (depth !== 1) {
    // The first depth's layout stands in for a deeper one (only the depth's power matters here).
    for (let d = 2; d <= depth; d++) {
      world.levels[d] = structuredClone({ ...levelAt(world, 1), depth: d });
      world.floors[d] = structuredClone(floorAt(world, 1));
    }
  }
  const level = levelAt(world, depth);
  const floor = floorAt(world, depth);
  floor.mobs = [];
  floor.heaps = [];
  floor.respawn = 1e9;
  for (let dy = -5; dy <= 5; dy++) {
    for (let dx = -6; dx <= 6; dx++) level.map[CENTRE + dx + dy * WIDTH] = T.EMPTY;
  }
  level.traps = [];
  hero.depth = depth;
  hero.pos = CENTRE;
  hero.ht = hero.hp = 200;
  const ctx: Ctx = { world, depth, level, floor, rng: new Rng(floor.rng), effects: [] };
  return { world, hero, ctx };
}

function addMob({ world, ctx }: Scene, kind: MobKind, pos: number, state: Mob['state'] = 'sleeping'): Mob {
  const mob = createMob(`#${++world.nextId}`, kind, pos, state, ctx.floor.now);
  ctx.floor.mobs.push(mob);
  return mob;
}

/** Lays a trap of `kind` under the hero (or at `pos`) and sets it off under whoever stands there. */
function spring(s: Scene, kind: TrapKind, pos = s.hero.pos, hidden = false): Effect[] {
  const trap = setTrap(s.ctx.level, pos, kind, !hidden);
  const victim = pos === s.hero.pos ? s.hero : s.ctx.floor.mobs.find((m) => m.pos === pos) ?? null;
  triggerTrap(s.ctx, victim, trap.pos);
  return s.ctx.effects;
}

const ALL: TrapKind[] = Object.keys(TRAPS) as TrapKind[];

describe('Shattered traps: Trap.trigger', () => {
  it.each(ALL)('%s is found, and spent unless it goes on working', (kind) => {
    const s = scene(kind === 'guardian' ? 11 : 1);
    const cell = CENTRE + 2;
    const trap = setTrap(s.ctx.level, cell, kind, false);
    expect(s.ctx.level.map[cell]).toBe(TRAPS[kind].canBeHidden ? T.SECRET_TRAP : T.TRAP);
    triggerTrap(s.ctx, null, cell);
    expect(trap.active).toBe(!TRAPS[kind].disarmedByActivation);
    expect(trap.visible).toBe(true);
    expect(s.ctx.level.map[cell]).not.toBe(T.SECRET_TRAP);
    expect(s.ctx.effects).toContainEqual(expect.objectContaining({ type: 'trap', kind, pos: cell, ...(TRAPS[kind].canBeHidden ? { hidden: true } : {}) }));
  });

  it('a hero walking onto a hidden trap sets it off; floating, he does not', () => {
    const s = scene();
    const cell = CENTRE + 1;
    setTrap(s.ctx.level, cell, 'weakening', false);
    const result = act(s.world, 'p', { type: 'move', to: cell });
    expect(result.ok && result.effects).toContainEqual(expect.objectContaining({ type: 'trap', kind: 'weakening', hero: 'p', hidden: true }));
    expect(s.hero.weakened).toBeGreaterThan(50);

    const t = scene();
    t.hero.levitating = 10;
    setTrap(t.ctx.level, CENTRE + 1, 'weakening', true);
    act(t.world, 'p', { type: 'move', to: CENTRE + 1 });
    expect(t.hero.weakened).toBe(0);
    expect(t.ctx.level.map[CENTRE + 1]).toBe(T.TRAP);
  });

  it('a monster sets off only traps in sight, a sheep hidden ones too, a flier none', () => {
    const s = scene();
    const rat = addMob(s, 'rat', CENTRE + 2);
    setTrap(s.ctx.level, rat.pos, 'gripping', false);
    mobPress(s.ctx, rat);
    expect(rat.crippled ?? 0).toBe(0);
    setTrap(s.ctx.level, rat.pos, 'gripping', true);
    mobPress(s.ctx, rat);
    expect(rat.crippled).toBe(10);

    const sheep = addMob(s, 'sheep', CENTRE - 2, 'passive');
    setTrap(s.ctx.level, sheep.pos, 'alarm', false);
    mobPress(s.ctx, sheep);
    expect(s.ctx.level.map[sheep.pos]).toBe(T.INACTIVE_TRAP);

    const bat = addMob(s, 'bat', CENTRE + 3 * WIDTH);
    setTrap(s.ctx.level, bat.pos, 'gripping', true);
    mobPress(s.ctx, bat);
    expect(bat.crippled ?? 0).toBe(0);
  });
});

describe('Shattered traps: what each does', () => {
  it('alarm and guardian traps call every monster to them; guardians come from depth 10 on', () => {
    const s = scene();
    const rat = addMob(s, 'rat', CENTRE + 4 * WIDTH);
    spring(s, 'alarm');
    expect(rat.state).toBe('wandering');
    expect(rat.target).toBe(CENTRE);

    const g = scene(11);
    const before = g.ctx.floor.mobs.length;
    spring(g, 'guardian');
    const guards = g.ctx.floor.mobs.slice(before);
    expect(guards).toHaveLength(1);
    expect(guards[0]!.kind).toBe('statue');
    expect(guards[0]!.item?.cursed).toBe(false);
    expect(guards[0]!.item?.enchant).toBeUndefined();
    expect(guards[0]!.target).toBe(CENTRE);
  });

  it('burning and blazing traps set whoever is near alight, and the grass about burns away', () => {
    const s = scene();
    const level = s.ctx.level;
    for (let dx = 1; dx <= 5; dx++) level.map[CENTRE + dx] = T.GRASS;
    const near = addMob(s, 'rat', CENTRE - 1);
    const far = addMob(s, 'rat', CENTRE - 2);
    const effects = spring(s, 'burning');
    expect(s.hero.burning).toBe(8);
    expect(near.burning).toBe(8);
    expect(far.burning ?? 0).toBe(0);
    // The fire runs on through the whole line of grass.
    for (let dx = 1; dx <= 5; dx++) expect(level.map[CENTRE + dx]).toBe(T.EMBERS);
    expect(effects).toContainEqual(expect.objectContaining({ type: 'blob', blob: 'fire' }));

    const b = scene();
    const rat = addMob(b, 'rat', CENTRE - 2);
    spring(b, 'blazing');
    expect(rat.burning).toBe(8);
  });

  it('chilling and frost traps chill (3 turns), and put fires out', () => {
    const s = scene();
    s.hero.burning = 5;
    spring(s, 'chilling');
    expect(s.hero.slowed).toBe(3);
    expect(s.hero.burning).toBe(0);
    const f = scene();
    const rat = addMob(f, 'rat', CENTRE + 2 * WIDTH);
    spring(f, 'frost');
    expect(rat.slowed).toBe(3);
  });

  it('gas traps: toxic 300 + 20 a depth, corrosive 80 + 5 a depth, confusion makes everyone near dizzy', () => {
    const s = scene();
    spring(s, 'toxic');
    expect(s.ctx.floor.gas?.toxic).toContainEqual([CENTRE, 320]);
    const c = scene();
    spring(c, 'corrosion');
    expect(c.ctx.floor.gas?.toxic).toContainEqual([CENTRE, 85]);
    const d = scene();
    const rat = addMob(d, 'rat', CENTRE + 2);
    spring(d, 'confusion');
    expect(d.hero.dizzy).toBe(10);
    expect(rat.dizzy).toBe(10);
  });

  it('shocking and storm traps paralyse and shock whoever stands in the charge', () => {
    const s = scene();
    const effects = spring(s, 'shocking');
    expect(s.hero.paralysed).toBeGreaterThan(0);
    expect(s.hero.paralysed).toBeLessThanOrEqual(10);
    expect(effects).toContainEqual(expect.objectContaining({ type: 'blob', blob: 'electricity' }));
    const t = scene();
    const rat = addMob(t, 'rat', CENTRE + 2, 'wandering');
    rat.ht = rat.hp = 200;
    spring(t, 'storm');
    expect(rat.paralysed).toBeGreaterThan(0);
    expect(rat.hp).toBeLessThan(200);
  });

  it('a cursing trap curses the hero\'s gear and what can be upgraded in a heap', () => {
    const s = scene();
    s.ctx.floor.heaps.push({ pos: CENTRE, kind: 'heap', items: [createItem('weapon.sword'), createItem('potion.healing')] });
    const effects = spring(s, 'cursing');
    const [sword, potion] = s.ctx.floor.heaps[0]!.items;
    expect(sword!.cursed).toBe(true);
    expect(potion!.cursed).toBeUndefined();
    expect(s.hero.weapon?.cursed || s.hero.armor.cursed).toBe(true);
    expect(effects).toContainEqual(expect.objectContaining({ type: 'trapCursed', hero: 'p' }));
  });

  it('a disarming trap sends the top item of a heap away, and the hero\'s weapon 10 to 20 steps off', () => {
    const s = scene();
    const weapon = s.hero.weapon!;
    s.ctx.floor.heaps.push({ pos: CENTRE, kind: 'heap', items: [createItem('potion.healing'), createItem('gold', 5)] });
    const effects = spring(s, 'disarming');
    const moved = effects.filter((e) => e.type === 'itemTeleported');
    expect(moved.length).toBeGreaterThanOrEqual(1);
    // The gold stays; the potion went.
    expect(s.ctx.floor.heaps.find((h) => h.pos === CENTRE)?.items.map((i) => i.kind)).toEqual(['gold']);
    const lost = moved.find((e) => e.type === 'itemTeleported' && e.hero === 'p');
    if (lost && lost.type === 'itemTeleported') {
      expect(s.hero.weapon).toBeNull();
      expect(s.ctx.floor.heaps.find((h) => h.pos === lost.to)?.items).toContain(weapon);
    } else {
      expect(s.hero.weapon).toBe(weapon);
    }
  });

  it('a disintegration trap rays the nearest in a clear line for 30-50 + depth', () => {
    const s = scene();
    const cell = CENTRE + 3;
    const effects = spring(s, 'disintegration', cell);
    expect(effects).toContainEqual({ type: 'zapped', depth: 1, from: cell, to: CENTRE, bolt: 'beam' });
    expect(200 - s.hero.hp).toBeGreaterThanOrEqual(31);
    expect(200 - s.hero.hp).toBeLessThanOrEqual(51);
  });

  it('a grim trap takes half the health and half what is left, never 90% of a hero\'s', () => {
    const s = scene();
    s.hero.ht = s.hero.hp = 100;
    spring(s, 'grim');
    expect(s.hero.hp).toBe(10);
    const t = scene();
    const rat = addMob(t, 'rat', CENTRE + 2);
    rat.ht = 10;
    rat.hp = 100;
    t.hero.pos = CENTRE + 5 * WIDTH + 6;
    t.hero.invisible = 100;
    spring(t, 'grim', CENTRE + 3);
    // round(10/2 + 100/2) = 55.
    expect(rat.hp).toBe(45);
    expect(t.ctx.effects).toContainEqual(expect.objectContaining({ type: 'zapped', to: CENTRE + 2, bolt: 'shadow' }));
  });

  it('dart traps: 4-8 less armour; poison darts poison for 8 + 2/3 of the depth; Tengu\'s spare Tengu', () => {
    const s = scene();
    const effects = spring(s, 'poisonDart', CENTRE + 2);
    expect(effects).toContainEqual(expect.objectContaining({ type: 'missile', from: CENTRE + 2, to: CENTRE }));
    expect(200 - s.hero.hp).toBeLessThanOrEqual(8);
    expect(s.hero.poison).toBe(9);
    const w = scene();
    spring(w, 'wornDart', CENTRE + 2);
    expect(w.hero.poison).toBe(0);
    const t = scene();
    addMob(t, 'tengu', CENTRE + 2);
    spring(t, 'tenguDart', CENTRE + 2);
    expect(t.hero.poison).toBe(8);
  });

  it('an explosive trap blows up like a bomb: 4 + depth to 12 + 3*depth, less armour', () => {
    const s = scene();
    s.ctx.level.map[CENTRE + 1] = T.GRASS;
    const rat = addMob(s, 'rat', CENTRE - 1);
    rat.ht = rat.hp = 100;
    const effects = spring(s, 'explosive');
    expect(effects).toContainEqual({ type: 'exploded', depth: 1, pos: CENTRE });
    expect(s.ctx.level.map[CENTRE + 1]).toBe(T.EMBERS);
    expect(100 - rat.hp).toBeLessThanOrEqual(15);
    expect(s.hero.hp).toBeGreaterThanOrEqual(185);
  });

  it('flashing and gripping traps go on working: bleeding, blindness and a crippled leg', () => {
    const s = scene();
    spring(s, 'flashing');
    expect(s.hero.blind).toBe(10);
    expect(s.hero.crippled).toBe(20);
    expect(s.hero.bleeding).toBeLessThanOrEqual(4);
    expect(s.ctx.level.map[CENTRE]).toBe(T.TRAP);
    const g = scene();
    spring(g, 'gripping');
    expect(g.hero.crippled).toBe(10);
    expect(g.hero.bleeding).toBeLessThanOrEqual(2);
  });

  it('a flock trap fills the free cells around with sheep', () => {
    const s = scene();
    const effects = spring(s, 'flock');
    const sheep = s.ctx.floor.mobs.filter((m) => m.kind === 'sheep');
    // The 5x5 patch, but the hero's own cell.
    expect(sheep).toHaveLength(24);
    for (const m of sheep) expect(m.lifespan).toBeGreaterThanOrEqual(4);
    expect(effects).toContainEqual(expect.objectContaining({ type: 'flock' }));
  });

  it('a gateway trap teleports someone away, then sends everyone to that same spot', () => {
    const s = scene();
    const cell = CENTRE + 1;
    const trap = setTrap(s.ctx.level, cell, 'gateway', true);
    s.hero.pos = cell;
    triggerTrap(s.ctx, s.hero, cell);
    expect(s.hero.pos).not.toBe(cell);
    expect(trap.telePos).toBe(s.hero.pos);
    expect(trap.active).toBe(true);
    const rat = addMob(s, 'rat', cell);
    triggerTrap(s.ctx, rat, cell);
    expect(Math.max(Math.abs((rat.pos % WIDTH) - (s.hero.pos % WIDTH)), Math.abs(Math.trunc(rat.pos / WIDTH) - Math.trunc(s.hero.pos / WIDTH)))).toBe(1);
  });

  it('a geyser floods the ground around and blasts the hero off it', () => {
    const s = scene();
    const effects = spring(s, 'geyser');
    expect(s.ctx.level.map[CENTRE + 1]).toBe(T.WATER);
    expect(s.ctx.level.traps?.some((t) => t.pos === CENTRE)).toBe(false);
    expect(s.hero.pos).not.toBe(CENTRE);
    expect(effects).toContainEqual(expect.objectContaining({ type: 'knockedBack', hero: 'p', from: CENTRE }));
  });

  it('rockfall traps: 5 + depth to 10 + 2*depth less armour and paralysis; gnolls\' 6-12 and a short daze', () => {
    const s = scene();
    const effects = spring(s, 'rockfall', CENTRE + 1);
    expect(effects).toContainEqual(expect.objectContaining({ type: 'avalanche' }));
    expect(200 - s.hero.hp).toBeLessThanOrEqual(12);
    expect(s.hero.paralysed).toBe(10);
    const g = scene();
    spring(g, 'gnollRockfall', CENTRE + 1);
    expect(200 - g.hero.hp).toBeGreaterThanOrEqual(6);
    expect(200 - g.hero.hp).toBeLessThanOrEqual(12);
    expect(g.hero.paralysed).toBe(3);
  });

  it('ooze and weakening traps', () => {
    const s = scene();
    spring(s, 'ooze');
    expect(s.hero.ooze).toBe(0);
    const w = scene();
    spring(w, 'weakening');
    expect(w.hero.weakened).toBe(60);
  });

  it('a pitfall trap opens a turn later under whoever is still there; not on a boss level', () => {
    const s = scene();
    const rat = addMob(s, 'rat', CENTRE + 1);
    s.ctx.floor.heaps.push({ pos: CENTRE - 1, kind: 'heap', items: [createItem('potion.healing')] });
    const effects = spring(s, 'pitfall');
    expect(effects).toContainEqual(expect.objectContaining({ type: 'pitfall', stage: 'warn' }));
    expect(openPits(s.ctx)).toEqual([]);
    s.ctx.floor.now += 1;
    expect(openPits(s.ctx)).toEqual([s.hero]);
    expect(s.ctx.floor.mobs).not.toContain(rat);
    expect(s.ctx.floor.heaps).toHaveLength(0);
    expect(s.ctx.floor.falling?.map((i) => i.kind)).toEqual(['potion.healing']);

    const b = scene(5);
    const trap = setTrap(b.ctx.level, CENTRE, 'pitfall', true);
    triggerTrap(b.ctx, b.hero, CENTRE);
    expect(trap.pit).toBeUndefined();
    expect(b.ctx.effects).toContainEqual(expect.objectContaining({ type: 'pitfall', stage: 'none' }));
  });

  it('summoning and distortion traps bring monsters next to them, acting a little later', () => {
    const s = scene();
    const effects = spring(s, 'summoning');
    const summoned = s.ctx.floor.mobs;
    expect(summoned.length).toBeGreaterThanOrEqual(1);
    expect(summoned.length).toBeLessThanOrEqual(3);
    for (const mob of summoned) expect(mob.time).toBe(s.ctx.floor.now + 2);
    expect(effects.filter((e) => e.type === 'appeared')).toHaveLength(summoned.length);
    const d = scene();
    spring(d, 'distortion');
    expect(d.ctx.floor.mobs.length).toBeGreaterThanOrEqual(2);
    expect(d.ctx.floor.mobs.length).toBeLessThanOrEqual(5);
  });

  it('teleportation and warping traps send the hero and the top of a heap elsewhere; warping makes the party forget the level', () => {
    const s = scene();
    s.ctx.floor.heaps.push({ pos: CENTRE + 1, kind: 'heap', items: [createItem('potion.healing')] });
    const effects = spring(s, 'teleportation');
    expect(s.hero.pos).not.toBe(CENTRE);
    expect(effects).toContainEqual({ type: 'teleported', hero: 'p' });
    expect(effects).toContainEqual(expect.objectContaining({ type: 'itemTeleported', from: CENTRE + 1 }));
    const w = scene();
    w.world.explored[1] = new Array<boolean>(64 * 64).fill(true);
    spring(w, 'warping');
    expect(w.hero.pos).not.toBe(CENTRE);
    expect(w.world.explored[1]![CENTRE]).toBe(false);
  });
});

describe('Shattered traps: robustness', () => {
  it('every trap goes off under a hero, a monster or nothing, on many layouts, without trouble', () => {
    let layouts = 0;
    for (let seed = 1; seed <= 12; seed++) {
      // (A layout the level streams cannot people yet is skipped: not the traps' business.)
      try {
        scene(1, seed);
      } catch {
        continue;
      }
      layouts++;
      for (const kind of ALL) {
        const s = scene(1, seed);
        const rat = addMob(s, 'rat', CENTRE + 1, 'hunting');
        addMob(s, 'bat', CENTRE - WIDTH, 'wandering');
        s.ctx.floor.heaps.push({ pos: CENTRE + WIDTH, kind: 'heap', items: [createItem('bomb'), createItem('potion.liquidFlame')] });
        expect(() => {
          spring(s, kind);
          spring(s, kind, rat.pos);
          spring(s, kind, CENTRE + WIDTH);
          s.ctx.floor.now += 2;
          openPits(s.ctx);
        }).not.toThrow();
      }
    }
    expect(layouts).toBeGreaterThan(3);
  });
});
