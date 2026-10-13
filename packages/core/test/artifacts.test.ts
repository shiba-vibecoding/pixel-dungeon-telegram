import { describe, expect, it } from 'vitest';
import {
  act, addHero, ARTIFACT_DECK, artifactStatus, canEnter, charAt, chargeCap, createItem, createMob, createRun, createWorld, exploredCells,
  floorAt, type Heap, heroById, heroArtifacts, heroRings, isInvisible, ItemGenerator, leaveBones, levelAt, layBones, NEIGHBOURS8, prickDeathChance, randomArtifact,
  Rng, STARVING, swapsWithHero, WIDTH, type World,
} from '../src/index';
import { chargeWands } from '../src/wands';
import { pacify } from './helpers';

function solo(heroClass: 'warrior' | 'rogue' | 'mage' | 'huntress' = 'warrior', seed = 3): World {
  const world = pacify(createWorld(seed));
  addHero(world, { id: 'p', name: 'P', heroClass });
  return world;
}

const free = (world: World, pos: number): number => {
  const level = levelAt(world, 1);
  return NEIGHBOURS8.map((n) => pos + n).find((c) => canEnter(level, c) && !charAt(world, 1, c))!;
};

const waitTurns = (world: World, n: number): void => {
  for (let i = 0; i < n; i++) {
    heroById(world, 'p')!.hunger = 0;
    act(world, 'p', { type: 'wait' });
  }
};

describe('artifacts among finds', () => {
  it('are dealt from a deck, each kind once in a run, and then come out as rings', () => {
    const run = createRun(5);
    const rng = Rng.seeded(9);
    const kinds = ARTIFACT_DECK.map(() => randomArtifact(run, rng)!.kind);
    expect(new Set(kinds).size).toBe(ARTIFACT_DECK.length);
    expect(randomArtifact(run, rng)).toBeNull();
    const generator = new ItemGenerator(rng, 3, run);
    expect(generator.of('artifact').kind.startsWith('ring.')).toBe(true);
  });

  it('come as often as rings, some cursed, none known', () => {
    let artifacts = 0;
    let cursed = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const generator = new ItemGenerator(Rng.seeded(seed), 3, createRun(seed));
      for (let i = 0; i < 40; i++) {
        const item = generator.random();
        if (!item.kind.startsWith('artifact.')) continue;
        artifacts++;
        if (item.cursed) cursed++;
        expect(item.levelUnknown && item.curseUnknown).toBe(true);
      }
    }
    expect(artifacts).toBeGreaterThan(0);
    expect(cursed).toBeLessThan(artifacts);
  });
});

describe('belongings', () => {
  it('hold an artifact, a misc thing and a ring; never two artifacts of a kind', () => {
    const world = solo();
    const hero = heroById(world, 'p')!;
    hero.items = [createItem('artifact.horn'), createItem('artifact.chalice'), createItem('ring.haste', 1, 1), createItem('artifact.horn')];
    expect(act(world, 'p', { type: 'equip', item: 0 }).ok).toBe(true);
    expect(act(world, 'p', { type: 'equip', item: 2 })).toEqual({ ok: false, reason: 'you cannot wear two of the same artifact' });
    expect(act(world, 'p', { type: 'equip', item: 0 }).ok).toBe(true);
    expect([hero.artifact?.kind, hero.misc?.kind]).toEqual(['artifact.horn', 'artifact.chalice']);
    expect(act(world, 'p', { type: 'equip', item: 0 }).ok).toBe(true);
    expect(hero.ring?.kind).toBe('ring.haste');
    expect(heroArtifacts(hero)).toHaveLength(2);
    expect(heroRings(hero)).toHaveLength(1);
    // Artifact.doEquip: put on, it is known through and through.
    expect(hero.artifact!.levelUnknown).toBeUndefined();
  });

  it('a fallen hero may leave an artifact; it comes back cursed if the run has not dealt it, as gold if it has', () => {
    const world = solo();
    const hero = heroById(world, 'p')!;
    hero.artifact = createItem('artifact.chains', 1, 3);
    const bones = leaveBones(hero, 2, 0);
    expect(bones.item.kind).toBe('artifact.chains');
    const level = levelAt(world, 2);
    const floor = { ...floorAt(world, 2), heaps: [] as Heap[] };
    world.run.artifactsLeft = ['artifact.chains'];
    layBones({ ...bones }, level, floor, Rng.seeded(1), world.run);
    const laid = floor.heaps.flatMap((h) => h.items).find((i) => i.kind === 'artifact.chains');
    expect(laid).toMatchObject({ kind: 'artifact.chains', level: 0, cursed: true });
    // Dealt now: a second such bones would come back as gold.
    const gold = { ...bones, depth: 3 };
    const other = { ...floorAt(world, 3), heaps: [] as Heap[] };
    layBones(gold, levelAt(world, 3), other, Rng.seeded(1), world.run);
    expect(other.heaps.flatMap((h) => h.items).map((i) => i.kind)).toEqual(['gold']);
    // The rogue's cloak is never left behind.
    const rogue = solo('rogue');
    expect(leaveBones(heroById(rogue, 'p')!, 2, 0).item.kind).toBe('gold');
  });
});

describe('the cloak of shadows', () => {
  it('hides the rogue, a charge every four turns, and recharges unused', () => {
    const world = solo('rogue');
    const hero = heroById(world, 'p')!;
    const cloak = hero.artifact!;
    expect(cloak.charge).toBe(3);
    expect(act(world, 'p', { type: 'artifact', item: 'artifact', use: 'stealth' }).ok).toBe(true);
    expect(isInvisible(hero)).toBe(true);
    expect(cloak.charge).toBe(2);
    waitTurns(world, 4);
    expect(cloak.charge).toBe(1);
    waitTurns(world, 20);
    expect(isInvisible(hero)).toBe(false);
    expect(cloak.charge).toBe(0);
    waitTurns(world, 60);
    expect(cloak.charge).toBeGreaterThan(0);
  });
});

describe('the horn of plenty', () => {
  it('fills with experience, feeds the hero, and grows on food offered to it', () => {
    const world = solo();
    const hero = heroById(world, 'p')!;
    const horn = createItem('artifact.horn');
    hero.artifact = horn;
    hero.items = [createItem('potion.experience', 6)];
    for (let i = 0; i < 6; i++) act(world, 'p', { type: 'use', item: 0 });
    hero.items = [createItem('food.ration')];
    expect(horn.charge).toBe(chargeCap(horn));
    hero.hunger = STARVING;
    expect(act(world, 'p', { type: 'artifact', item: 'artifact', use: 'eat' }).ok).toBe(true);
    expect(hero.hunger).toBeLessThan(STARVING / 2);
    expect(act(world, 'p', { type: 'artifact', item: 'artifact', use: 'store', with: 0 }).ok).toBe(true);
    expect(horn.level).toBe(1);
    expect(hero.items).toHaveLength(0);
  });
});

describe('the chalice of blood', () => {
  it('hurts more each prick, and grows a level with each', () => {
    const world = solo();
    const hero = heroById(world, 'p')!;
    hero.artifact = createItem('artifact.chalice');
    Object.assign(hero, { ht: 500, hp: 500 });
    expect(prickDeathChance(hero, hero.artifact)).toBe(0);
    expect(act(world, 'p', { type: 'artifact', item: 'artifact', use: 'prick' }).ok).toBe(true);
    expect(hero.artifact.level).toBe(1);
    expect(hero.hp).toBeLessThan(500);
    hero.hp = 1;
    expect(prickDeathChance(hero, hero.artifact)).toBe(1);
  });
});

describe("the timekeeper's hourglass", () => {
  it('freezes time: the hero acts, nothing else does, two turns a charge', () => {
    const world = solo();
    const hero = heroById(world, 'p')!;
    hero.artifact = createItem('artifact.hourglass');
    const rat = createMob('#rat', 'rat', free(world, hero.pos), 'hunting', floorAt(world, 1).now);
    Object.assign(rat, { enemy: 'p', target: hero.pos, enemySeen: true });
    floorAt(world, 1).mobs.push(rat);
    expect(act(world, 'p', { type: 'artifact', item: 'artifact', use: 'freeze' }).ok).toBe(true);
    const time = hero.time;
    const hp = hero.hp;
    waitTurns(world, 4);
    expect(hero.time).toBe(time);
    expect(hero.hp).toBe(hp);
    // Five charges: one as it starts, then one every two turns.
    expect(hero.artifact.charge).toBe(3);
    expect(hero.artifact.freeze).toBeDefined();
    // Striking breaks the freeze.
    act(world, 'p', { type: 'attack', target: '#rat' });
    expect(hero.artifact.freeze).toBeUndefined();
  });

  it('in stasis, nothing touches the hero', () => {
    const world = solo();
    const hero = heroById(world, 'p')!;
    hero.artifact = createItem('artifact.hourglass');
    const rat = createMob('#rat', 'rat', free(world, hero.pos), 'hunting', floorAt(world, 1).now);
    Object.assign(rat, { enemy: 'p', target: hero.pos, enemySeen: true });
    floorAt(world, 1).mobs.push(rat);
    const time = hero.time;
    const hp = hero.hp;
    const result = act(world, 'p', { type: 'artifact', item: 'artifact', use: 'stasis' });
    expect(result.ok && result.effects.some((e) => e.type === 'stasis' && e.on)).toBe(true);
    // Ten turns out of time (two charges), the rat beside unable to touch the hero.
    expect(hero.time - time).toBeGreaterThanOrEqual(10);
    expect(hero.hp).toBe(hp);
    expect(hero.stasis).toBeUndefined();
    expect(isInvisible(hero)).toBe(false);
    expect(hero.artifact.charge).toBe(3);
  });
});

describe('the talisman of foresight', () => {
  it('scries a cone of the level for its charge', () => {
    const world = solo();
    const hero = heroById(world, 'p')!;
    hero.artifact = { ...createItem('artifact.talisman'), charge: 100 };
    const explored = exploredCells(world, 1).filter(Boolean).length;
    const level = levelAt(world, 1);
    const target = level.exit === hero.pos ? level.entrance : level.exit;
    expect(act(world, 'p', { type: 'artifact', item: 'artifact', use: 'scry', cell: target }).ok).toBe(true);
    expect(exploredCells(world, 1).filter(Boolean).length).toBeGreaterThan(explored);
    expect(hero.artifact.charge).toBeLessThan(100);
    expect(artifactStatus(hero.artifact)).toMatch(/%$/);
  });
});

describe('the unstable spellbook', () => {
  it('reads a random scroll for a charge, never teaching what it was', () => {
    const world = solo();
    const hero = heroById(world, 'p')!;
    hero.artifact = createItem('artifact.spellbook');
    const known = [...world.known];
    const result = act(world, 'p', { type: 'artifact', item: 'artifact', use: 'read' });
    expect(result.ok).toBe(true);
    expect(hero.artifact.charge).toBe(1);
    if (hero.pendingScroll) {
      expect(act(world, 'p', { type: 'wait' })).toMatchObject({ ok: false });
      expect(act(world, 'p', { type: 'artifact', item: 'artifact', use: 'resolve', choice: 0 }).ok).toBe(true);
    }
    expect(hero.pendingScroll).toBeUndefined();
    expect(world.known).toEqual(known);
  });

  it('takes a scroll its index wants, and grows', () => {
    const world = solo();
    const hero = heroById(world, 'p')!;
    hero.artifact = createItem('artifact.spellbook');
    hero.artifact.scrolls = ['scroll.lullaby', 'scroll.terror'];
    world.known.push('scroll.terror');
    hero.items = [createItem('scroll.terror')];
    expect(act(world, 'p', { type: 'artifact', item: 'artifact', use: 'add', with: 0 }).ok).toBe(true);
    expect(hero.artifact).toMatchObject({ level: 1, scrolls: ['scroll.lullaby'] });
  });
});

describe('the ethereal chains', () => {
  it('pull a monster up to the hero, a charge a cell', () => {
    const world = solo();
    const hero = heroById(world, 'p')!;
    hero.artifact = createItem('artifact.chains');
    const level = levelAt(world, 1);
    const seen = exploredCells(world, 1);
    let far = -1;
    for (let c = 0; c < seen.length && far < 0; c++) {
      if (!seen[c] || !canEnter(level, c) || charAt(world, 1, c)) continue;
      const dx = Math.abs((c % WIDTH) - (hero.pos % WIDTH));
      const dy = Math.abs(Math.floor(c / WIDTH) - Math.floor(hero.pos / WIDTH));
      if (Math.max(dx, dy) === 3 && (dx === 0 || dy === 0 || dx === dy)) far = c;
    }
    if (far < 0) return;
    const rat = createMob('#rat', 'rat', far, 'sleeping', 0);
    floorAt(world, 1).mobs.push(rat);
    const result = act(world, 'p', { type: 'artifact', item: 'artifact', use: 'cast', cell: far });
    if (!result.ok) return;
    expect(Math.max(Math.abs((rat.pos % WIDTH) - (hero.pos % WIDTH)), Math.abs(Math.floor(rat.pos / WIDTH) - Math.floor(hero.pos / WIDTH)))).toBe(1);
    expect(hero.artifact.charge).toBe(3);
  });
});

describe('the dried rose', () => {
  it('needs the sad ghost freed first; full, it calls the ghost, who follows the hero down', () => {
    const world = solo();
    const hero = heroById(world, 'p')!;
    hero.artifact = createItem('artifact.rose');
    expect(act(world, 'p', { type: 'artifact', item: 'artifact', use: 'summon' })).toEqual({ ok: false, reason: 'art:driedrose.desc_no_quest' });
    world.quest = { depth: 2, type: 'rat', given: true, dropped: true, killsLeft: 0, done: true, weapon: createItem('weapon.mace'), armor: createItem('armor.mail') };
    expect(act(world, 'p', { type: 'artifact', item: 'artifact', use: 'summon' }).ok).toBe(true);
    const ghost = floorAt(world, 1).mobs.find((mob) => mob.kind === 'ghostHero')!;
    expect(ghost).toBeDefined();
    expect(hero.artifact.charge).toBe(0);
    hero.pos = levelAt(world, 1).exit;
    expect(act(world, 'p', { type: 'descend' }).ok).toBe(true);
    expect(floorAt(world, 2).mobs.some((mob) => mob.id === ghost.id)).toBe(true);
    expect(floorAt(world, 1).mobs.some((mob) => mob.id === ghost.id)).toBe(false);
  });
});

describe("the master thieves' armband", () => {
  it('steals from a monster beside the hero, once', () => {
    const world = solo();
    const hero = heroById(world, 'p')!;
    hero.artifact = { ...createItem('artifact.armband'), charge: 5 };
    const cell = free(world, hero.pos);
    const gnoll = createMob('#g', 'gnoll', cell, 'sleeping', 0);
    floorAt(world, 1).mobs.push(gnoll);
    expect(act(world, 'p', { type: 'artifact', item: 'artifact', use: 'steal', cell }).ok).toBe(true);
    expect(gnoll.robbed).toBeDefined();
    expect(gnoll.blind).toBeGreaterThan(0);
    expect(hero.artifact.charge).toBe(4);
  });
});

describe('the sandals of nature', () => {
  it('take a seed, and can grow its plant', () => {
    const world = solo();
    const hero = heroById(world, 'p')!;
    hero.artifact = { ...createItem('artifact.sandals'), charge: 100 };
    hero.items = [createItem('seed.fadeleaf', 2)];
    expect(act(world, 'p', { type: 'artifact', item: 'artifact', use: 'feed', with: 0 }).ok).toBe(true);
    expect(hero.artifact.seedEffect).toBe('seed.fadeleaf');
    expect(act(world, 'p', { type: 'artifact', item: 'artifact', use: 'feed', with: 0 })).toMatchObject({ ok: false });
    const cell = free(world, hero.pos);
    expect(act(world, 'p', { type: 'artifact', item: 'artifact', use: 'root', cell }).ok).toBe(true);
    expect(hero.artifact.charge).toBe(88);
  });
});

describe('the cape of thorns', () => {
  it('stores up harm, then turns some of it back', () => {
    const world = solo();
    const hero = heroById(world, 'p')!;
    hero.artifact = createItem('artifact.cape');
    Object.assign(hero, { ht: 2000, hp: 2000, defenseSkill: 0 });
    const rat = createMob('#rat', 'rat', free(world, hero.pos), 'hunting', floorAt(world, 1).now);
    Object.assign(rat, { enemy: 'p', target: hero.pos, enemySeen: true, ht: 5000, hp: 5000 });
    floorAt(world, 1).mobs.push(rat);
    let radiated = false;
    for (let i = 0; i < 200 && !radiated; i++) {
      hero.hunger = 0;
      act(world, 'p', { type: 'wait' });
      radiated = (hero.artifact.cooldown ?? 0) > 0;
    }
    expect(radiated).toBe(true);
  });
});

describe("the alchemist's toolkit", () => {
  it('warms up once worn', () => {
    const world = solo();
    const hero = heroById(world, 'p')!;
    hero.items = [createItem('artifact.toolkit')];
    expect(act(world, 'p', { type: 'equip', item: 0 }).ok).toBe(true);
    expect(hero.artifact!.warmUp).toBeGreaterThan(99);
    waitTurns(world, 5);
    expect(hero.artifact!.warmUp).toBeLessThan(100);
  });
});

describe('with the wands', () => {
  it("the rose's ghost is one of the heroes' allies: the hero trades places with it, monsters may fight it", () => {
    const world = solo();
    const hero = heroById(world, 'p')!;
    hero.artifact = createItem('artifact.rose');
    hero.artifact.charge = 100;
    world.quest = { depth: 2, type: 'rat', given: true, dropped: true, killsLeft: 0, done: true, weapon: createItem('weapon.mace'), armor: createItem('armor.mail') };
    expect(act(world, 'p', { type: 'artifact', item: 'artifact', use: 'summon' }).ok).toBe(true);
    const ghost = floorAt(world, 1).mobs.find((mob) => mob.kind === 'ghostHero')!;
    expect(ghost.ally).toBe(true);
    expect(swapsWithHero(ghost)).toBe(true);
  });

  it("zapping a wand ends the cloak's stealth (Wand.wandUsed: Invisibility.dispel)", () => {
    const world = solo('rogue');
    const hero = heroById(world, 'p')!;
    hero.items.unshift({ ...createItem('wand.magicMissile'), charges: 2 });
    expect(act(world, 'p', { type: 'artifact', item: 'artifact', use: 'stealth' }).ok).toBe(true);
    expect(isInvisible(hero)).toBe(true);
    const target = NEIGHBOURS8.map((n) => hero.pos + 2 * n).find((c) => canEnter(levelAt(world, 1), c))!;
    expect(act(world, 'p', { type: 'zap', item: 0, target }).ok).toBe(true);
    expect(isInvisible(hero)).toBe(false);
  });

  it('rings of energy recharge wands faster (RingOfEnergy.wandChargeMultiplier)', () => {
    const world = solo('mage');
    const hero = heroById(world, 'p')!;
    const plain = { ...createItem('wand.frost'), charges: 0, partial: 0 };
    hero.items = [plain];
    chargeWands(hero, 5, () => false);
    const without = plain.partial!;
    plain.partial = 0;
    hero.ring = createItem('ring.energy', 1, 1);
    chargeWands(hero, 5, () => false);
    expect(plain.partial!).toBeCloseTo(without * Math.fround(1.175 ** 2), 4);
  });
});
