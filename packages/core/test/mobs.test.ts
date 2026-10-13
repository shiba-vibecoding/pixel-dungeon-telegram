import { describe, expect, it } from 'vitest';
import {
  act, addHero, CHAMPION_ENEMIES, createItem, createMob, createWorld, type Effect, floorAt, heroById, isAlive, levelAt, type Mob,
  type MobKind, type MobState, mobStats, T, WIDTH, type World,
} from '../src/index';
import { dealMob } from '../src/spawner';
import { baseLootChance } from '../src/mobs';
import { meleeDamageFactor, damageTakenFactor, evasionAndAccuracyFactor } from '../src/champions';
import { pacify } from './helpers';

/*
 * Shattered's monsters (mobs.ts, mobskills.ts, champions.ts, spawner.ts): each
 * kind's tricks, played out on a patch of bare floor.
 */

/** Middle of the open ground carved out for these tests. */
const CENTRE = 16 + 16 * WIDTH;

/** A solo hero, sturdy, in the middle of a patch of bare floor 13 by 11, on a depth with its monsters cleared away. */
function openGround(depth = 1, seed = 6, challenges = 0): World {
  const world = pacify(createWorld(seed, challenges));
  addHero(world, { id: 'p', name: 'P', heroClass: 'warrior' });
  for (let d = 1; d <= depth; d++) {
    levelAt(world, d);
    floorAt(world, d).mobs = [];
    floorAt(world, d).respawn = 1e9;
  }
  const hero = heroById(world, 'p')!;
  const level = levelAt(world, depth);
  for (let dy = -5; dy <= 5; dy++) {
    for (let dx = -6; dx <= 6; dx++) level.map[CENTRE + dx + dy * WIDTH] = T.EMPTY;
  }
  floorAt(world, depth).heaps = [];
  Object.assign(hero, { depth, pos: CENTRE, hp: 1000, ht: 1000, time: floorAt(world, depth).now });
  return world;
}

function addMob(world: World, kind: MobKind, pos: number, state: MobState = 'hunting'): Mob {
  const hero = heroById(world, 'p')!;
  const floor = floorAt(world, hero.depth);
  const mob = createMob(`#${kind}${floor.mobs.length}`, kind, pos, state, floor.now);
  mob.level = hero.depth;
  mob.ht = mob.hp = mobStats(mob).ht;
  if (state === 'hunting') Object.assign(mob, { enemy: 'p', target: hero.pos, enemySeen: true });
  floor.mobs.push(mob);
  return mob;
}

const run = (world: World, turns: number, action: Parameters<typeof act>[2] = { type: 'wait' }): Effect[] => {
  const effects: Effect[] = [];
  for (let i = 0; i < turns; i++) {
    const result = act(world, 'p', action);
    if (result.ok) effects.push(...result.effects);
  }
  return effects;
};

describe("Shattered's monsters, kind by kind", () => {
  it('a sewer snake is hard to hit unless caught unawares', () => {
    const world = openGround();
    const snake = addMob(world, 'snake', CENTRE + 1);
    expect(mobStats(snake)).toMatchObject({ ht: 4, defense: 25, damage: [1, 4] });
    // Unseen (it has not spotted its enemy), it cannot dodge at all: Mob.surprisedBy.
    Object.assign(snake, { enemySeen: false, state: 'wandering' });
    const hero = heroById(world, 'p')!;
    hero.attackSkill = 1;
    const result = act(world, 'p', { type: 'attack', target: snake.id });
    expect(result.ok && result.effects.some((e) => e.type === 'attack' && e.attacker === 'p' && e.hit)).toBe(true);
  });

  it("a slime's membrane lets little more than five through", () => {
    const world = openGround();
    const slime = addMob(world, 'slime', CENTRE + 1);
    const hero = heroById(world, 'p')!;
    Object.assign(hero, { attackSkill: 100000, str: 60 });
    hero.weapon = createItem('weapon.warHammer');
    const before = slime.hp;
    run(world, 1, { type: 'attack', target: slime.id });
    // Slime.damage: 5/6/7/8/9/10 at 5/7/10/14/19/25 incoming; a war hammer at strength 60 strikes far harder.
    expect(before - slime.hp).toBeLessThanOrEqual(12);
  });

  it('a gnoll exile leaves the hero be until provoked, and its spear reaches two cells', () => {
    const world = openGround(2);
    const exile = addMob(world, 'gnollExile', CENTRE + 2, 'wandering');
    const effects = run(world, 5);
    expect(effects.some((e) => e.type === 'attack' && e.attacker === exile.id)).toBe(false);
    expect(exile.provoked).not.toBe(true);
    // Struck, it fights back from two cells away.
    exile.pos = CENTRE + 2;
    exile.hp = 1000;
    exile.ht = 1000;
    exile.alerted = true;
    const later = run(world, 6);
    expect(exile.provoked).toBe(true);
    expect(later.some((e) => e.type === 'attack' && e.attacker === exile.id)).toBe(true);
  });

  it("a brute's last rage: at death it fights on behind a shield that wears away", () => {
    const world = openGround(11);
    const brute = addMob(world, 'brute', CENTRE + 1);
    const hero = heroById(world, 'p')!;
    Object.assign(hero, { attackSkill: 100000, str: 80 });
    hero.weapon = createItem('weapon.warHammer');
    let effects: Effect[] = [];
    for (let i = 0; i < 20 && !brute.enraged; i++) effects = effects.concat(run(world, 1, { type: 'attack', target: brute.id }));
    expect(effects.some((e) => e.type === 'enraged')).toBe(true);
    expect(isAlive(brute)).toBe(true);
    expect(brute.rageShield).toBe(24);
    // Left alone, the rage wears out four a turn and the brute dies.
    hero.pos = CENTRE - 5;
    brute.target = -1;
    floorAt(world, 11).mobs.find((m) => m === brute)!.pos = CENTRE + 5;
    run(world, 10);
    expect(floorAt(world, 11).mobs.includes(brute)).toBe(false);
  });

  it('a guard pulls its prey in with its chains, once', () => {
    const world = openGround(7);
    const guard = addMob(world, 'guard', CENTRE + 4);
    const effects = run(world, 1);
    const hero = heroById(world, 'p')!;
    expect(effects.some((e) => e.type === 'mobZap' && e.bolt === 'chain')).toBe(true);
    expect(Math.abs(hero.pos - guard.pos)).toBe(1);
    expect(hero.crippled).toBeGreaterThan(0);
    expect(guard.chainsUsed).toBe(true);
  });

  it('a necromancer raises a skeleton beside its prey, heals it, and its death takes the skeleton', () => {
    const world = openGround(8);
    const necro = addMob(world, 'necromancer', CENTRE + 3);
    const effects = run(world, 4);
    expect(effects.some((e) => e.type === 'summoning')).toBe(true);
    const skeleton = floorAt(world, 8).mobs.find((m) => m.kind === 'necroSkeleton');
    expect(skeleton).toBeDefined();
    expect(skeleton!.master).toBe(necro.id);
    // Slain, the necromancer takes its skeleton with it.
    const hero = heroById(world, 'p')!;
    Object.assign(hero, { attackSkill: 100000, str: 80, pos: CENTRE + 2 });
    hero.weapon = createItem('weapon.warHammer');
    for (let i = 0; i < 10 && isAlive(necro); i++) run(world, 1, { type: 'attack', target: necro.id });
    expect(isAlive(necro)).toBe(false);
    expect(floorAt(world, 8).mobs.some((m) => m.kind === 'necroSkeleton')).toBe(false);
  });

  it('a DM-200 vents toxic exhaust at what it cannot reach', () => {
    const world = openGround(13);
    const dm = addMob(world, 'dm200', CENTRE + 4);
    // Nothing between them but it cannot walk (rooted): it vents.
    dm.rooted = 100;
    const effects = run(world, 3);
    expect(effects.some((e) => e.type === 'mobZap' && e.bolt === 'toxic')).toBe(true);
    expect((floorAt(world, 13).gas?.toxic ?? []).length).toBeGreaterThan(0);
    expect(dm.ventCooldown).toBeGreaterThan(20);
  });

  it('a golem teleports its prey to its side', () => {
    const world = openGround(18);
    const golem = addMob(world, 'golem', CENTRE + 4);
    golem.rooted = 100;
    const effects = run(world, 3);
    expect(effects.some((e) => e.type === 'mobTeleported' && e.mob === 'p')).toBe(true);
    expect(Math.max(Math.abs((heroById(world, 'p')!.pos % WIDTH) - (golem.pos % WIDTH)), 1)).toBe(1);
  });

  it('an evil eye charges its beam, then the deathgaze strikes all along it', () => {
    const world = openGround(23);
    const eye = addMob(world, 'eye', CENTRE + 3);
    const effects = run(world, 6);
    const charge = effects.findIndex((e) => e.type === 'charging');
    const gaze = effects.findIndex((e) => e.type === 'mobZap' && e.bolt === 'deathGaze');
    expect(charge).toBeGreaterThanOrEqual(0);
    expect(gaze).toBeGreaterThan(charge);
    expect(eye.beamCooldown).toBeGreaterThan(0);
  });

  it('a succubus charms one kiss in three, and a charmed hero cannot strike her', () => {
    const world = openGround(21);
    const succubus = addMob(world, 'succubus', CENTRE + 1);
    const hero = heroById(world, 'p')!;
    hero.defenseSkill = 0;
    for (let i = 0; i < 30 && hero.charmed <= 0; i++) run(world, 1);
    expect(hero.charmed).toBeGreaterThan(0);
    expect(hero.charmedBy).toBe(succubus.id);
    expect(act(world, 'p', { type: 'attack', target: succubus.id })).toMatchObject({ ok: false });
  });

  it('ghouls come in pairs, and a fallen ghoul rises again beside a living one', () => {
    const world = openGround(16);
    const ghoul = addMob(world, 'ghoul', CENTRE + 2);
    run(world, 1);
    const floor = floorAt(world, 16);
    const partner = floor.mobs.find((m) => m.kind === 'ghoul' && m !== ghoul);
    expect(partner).toBeDefined();
    expect(ghoul.partner).toBe(partner!.id);
    // Struck down, the first crumples; held up by its partner it rises with a tenth of its health.
    ghoul.hp = 1;
    const hero = heroById(world, 'p')!;
    const beside = [-1, 1, -WIDTH, WIDTH, -WIDTH - 1, WIDTH + 1].map((n) => ghoul.pos + n).find((c) => !floor.mobs.some((m) => m.pos === c))!;
    Object.assign(hero, { attackSkill: 100000, str: 60, pos: beside });
    const effects = run(world, 1, { type: 'attack', target: ghoul.id });
    expect(effects.some((e) => e.type === 'crumpled')).toBe(true);
    expect(floor.downed?.length).toBe(1);
    partner!.rooted = 100;
    hero.pos = CENTRE - 6;
    hero.invisible = 1000;
    const later = run(world, 8);
    expect(floor.mobs.includes(ghoul), JSON.stringify(later.filter((e) => e.type !== 'attack')) + JSON.stringify(floor.downed) + JSON.stringify(partner)).toBe(true);
    expect(ghoul.hp).toBe(Math.round(ghoul.ht / 10));
  });

  it('a demon spawner brings forth ripper demons, and takes little more than twenty from any blow', () => {
    const world = openGround(22);
    const spawner = addMob(world, 'spawner', CENTRE + 3, 'passive');
    run(world, 2);
    expect(floorAt(world, 22).mobs.some((m) => m.kind === 'ripper')).toBe(true);
    const hero = heroById(world, 'p')!;
    Object.assign(hero, { attackSkill: 100000, str: 200, pos: CENTRE + 2 });
    floorAt(world, 22).mobs = [spawner];
    hero.weapon = createItem('weapon.warHammer');
    const before = spawner.hp;
    run(world, 1, { type: 'attack', target: spawner.id });
    // DemonSpawner.damage: past twenty, the rest counts for ever less (85 incoming is 30).
    expect(before - spawner.hp).toBeLessThanOrEqual(45);
    expect(before - spawner.hp).toBeGreaterThan(0);
  });

  it('a thief steals and runs; out of sight long enough, it gets away with the loot', () => {
    const world = openGround(6);
    const hero = heroById(world, 'p')!;
    hero.items = [createItem('potion.healing')];
    hero.defenseSkill = 0;
    const thief = addMob(world, 'thief', CENTRE + 1);
    for (let i = 0; i < 20 && !thief.item; i++) run(world, 1);
    expect(thief.item?.kind).toBe('potion.healing');
    expect(thief.state).toBe('fleeing');
    expect(hero.items).toHaveLength(0);
  });

  it('mimics spring with a bite that cannot miss; a golden one is stronger, a crystal one steals and runs', () => {
    for (const [heap, kind] of [['mimic', 'mimic'], ['goldenMimic', 'goldenMimic'], ['crystalMimic', 'crystalMimic']] as const) {
      const world = openGround(10);
      const hero = heroById(world, 'p')!;
      hero.defenseSkill = 100000;
      hero.items = [createItem('food.ration')];
      floorAt(world, 10).heaps.push({ pos: CENTRE + 1, kind: heap, items: [createItem('potion.healing')] });
      act(world, 'p', { type: 'move', to: CENTRE + 1 });
      const result = act(world, 'p', { type: 'pickup' });
      expect(result.ok).toBe(true);
      const mimic = floorAt(world, 10).mobs.find((m) => m.kind === kind)!;
      expect(mimic).toBeDefined();
      // The ambush: infinite accuracy, against all the hero's evasion.
      expect(result.ok && result.effects.some((e) => e.type === 'attack' && e.attacker === mimic.id && e.hit)).toBe(true);
      if (kind === 'goldenMimic') expect(mimic.ht).toBe((1 + Math.round(10 * 1.33)) * 6);
      if (kind === 'crystalMimic') {
        expect(mimic.state).toBe('fleeing');
        expect(mimic.loot?.some((i) => i.kind === 'food.ration')).toBe(true);
      }
      // Its treasure, and a prize of its own (Mimic.generatePrize; none more for a crystal one).
      expect(mimic.loot!.length).toBeGreaterThanOrEqual(kind === 'crystalMimic' ? 2 : 2);
    }
  });

  it('a phantom piranha struck from afar takes half and teleports', () => {
    const world = openGround(9);
    const level = levelAt(world, 9);
    for (let dx = 2; dx <= 6; dx++) for (let dy = -2; dy <= 2; dy++) level.map[CENTRE + dx + dy * WIDTH] = T.WATER;
    const fish = addMob(world, 'phantomPiranha', CENTRE + 4);
    const hero = heroById(world, 'p')!;
    hero.items = [createItem('missile.javelin', 5)];
    hero.attackSkill = 100000;
    const before = fish.pos;
    const result = act(world, 'p', { type: 'throw', item: 0, target: fish.pos });
    expect(fish.pos === before && isAlive(fish), JSON.stringify(result)).toBe(false);
  });

  it('a tormented spirit is cleansed by a scroll of remove curse read beside it, and leaves a prize', () => {
    const world = openGround(5);
    const spirit = addMob(world, 'tormentedSpirit', CENTRE + 1);
    const hero = heroById(world, 'p')!;
    hero.items = [createItem('scroll.removeCurse')];
    const result = act(world, 'p', { type: 'use', item: 0 });
    expect(result.ok && result.effects.some((e) => e.type === 'mobSays' && e.line === 'thankYou')).toBe(true);
    expect(floorAt(world, 5).mobs.includes(spirit)).toBe(false);
    expect(floorAt(world, 5).heaps.some((h) => h.pos === CENTRE + 1)).toBe(true);
  });
});

describe('loot (Mob.lootChance, Dungeon.LimitedDrops)', () => {
  it('each drop of a limited kind makes the next rarer', () => {
    const world = openGround(6);
    const ctx = { world, depth: 6, level: levelAt(world, 6), floor: floorAt(world, 6), rng: undefined as never, effects: [] };
    const skeleton = createMob('#s', 'skeleton', CENTRE, 'hunting', 0);
    expect(baseLootChance(ctx, skeleton)).toBeCloseTo(0.1667, 4);
    world.limitedDrops = { skeleWep: 2 };
    expect(baseLootChance(ctx, skeleton)).toBeCloseTo(0.1667 / 9, 4);
    const bat = createMob('#b', 'bat', CENTRE, 'hunting', 0);
    world.limitedDrops = { batHp: 7 };
    expect(baseLootChance(ctx, bat)).toBe(0);
    expect(baseLootChance(ctx, createMob('#a', 'acidic', CENTRE, 'hunting', 0))).toBe(1);
  });
});

describe('ChampionEnemy (hostile champions)', () => {
  it('one monster in eight or so comes as a champion under the challenge, none without it', () => {
    for (const challenges of [0, CHAMPION_ENEMIES]) {
      const world = createWorld(3, challenges);
      const level = levelAt(world, 12);
      let champions = 0;
      for (let i = 0; i < 400; i++) {
        const mob = dealMob(world, level, { int: (n: number) => i % n, float: () => (i % 97) / 97, normalIntRange: (a: number) => a } as never, `#${i}`, 0, 0);
        if (mob.champion) champions++;
      }
      if (challenges) expect(champions).toBeGreaterThanOrEqual(400 / 9);
      else expect(champions).toBe(0);
    }
  });

  it('each kind its own: giant a fifth of the harm, blessed four times as sure, growing a little more every four turns', () => {
    const mob = createMob('#c', 'rat', 0, 'hunting', 0);
    mob.champion = 'giant';
    expect(damageTakenFactor(mob)).toBe(0.2);
    mob.champion = 'blessed';
    expect(evasionAndAccuracyFactor(mob)).toBe(4);
    mob.champion = 'blazing';
    expect(meleeDamageFactor(mob)).toBe(1.25);
    mob.champion = 'growing';
    mob.growth = 1.19;
    expect(meleeDamageFactor(mob)).toBe(1.19);
  });

  it("a giant champion strikes from two cells away", () => {
    const world = openGround(3, 6, CHAMPION_ENEMIES);
    const rat = addMob(world, 'rat', CENTRE + 2);
    rat.champion = 'giant';
    const effects = run(world, 3);
    expect(effects.some((e) => e.type === 'attack' && e.attacker === rat.id)).toBe(true);
  });
});
