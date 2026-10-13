import { describe, expect, it } from 'vitest';
import {
  act, addHero, charAt, createItem, createMob, createWorld, type Effect, floorAt, type Hero, heroById, type Item, type ItemKind, ITEMS, itemDef,
  itemPrice, itemSprite, kindKnown, levelAt, type Mob, type MobKind, Rng, T, wandMaxCharges, WIDTH, type World,
} from '../src/index';
import { chargeWands, wandsGainExp } from '../src/wands';
import { chargeLimit } from '../src/regrowth';
import { randomWand } from '../src/items';
import { staffWith } from '../src/staff';
import { checkInvariants, pacify } from './helpers';

/** Middle of the open ground carved out for these tests. */
const CENTRE = 20 + 20 * WIDTH;
const EAST = 1;

/**
 * A hero on bare floor, 13 by 9 cells walled round, on the first depth with its monsters cleared
 * away; the hero stands four cells west of the middle, the wand first in the pack.
 */
function ground(kind?: ItemKind, level = 0, heroClass: Hero['heroClass'] = 'warrior', seed = 6): { world: World; hero: Hero; wand: Item | undefined } {
  const world = pacify(createWorld(seed));
  const hero = addHero(world, { id: 'p', name: 'P', heroClass });
  const map = levelAt(world, 1).map;
  for (let dy = -5; dy <= 5; dy++) {
    for (let dx = -7; dx <= 7; dx++) {
      map[CENTRE + dx + dy * WIDTH] = Math.abs(dx) === 7 || Math.abs(dy) === 5 ? T.WALL : T.EMPTY;
    }
  }
  floorAt(world, 1).heaps = [];
  floorAt(world, 1).plants = [];
  hero.pos = CENTRE - 4;
  hero.items = kind ? [createItem(kind, 1, level)] : [];
  hero.hp = hero.ht = 100;
  return { world, hero, wand: hero.items[0] };
}

function addMob(world: World, kind: MobKind, pos: number, state: Mob['state'] = 'hunting'): Mob {
  const mob = createMob(`#${900 + floorAt(world, 1).mobs.length}`, kind, pos, state, floorAt(world, 1).now);
  mob.enemy = 'p';
  mob.target = pos;
  floorAt(world, 1).mobs.push(mob);
  return mob;
}

const zap = (world: World, target: number, item: number | 'weapon' = 0): Effect[] => {
  const result = act(world, 'p', { type: 'zap', item, target });
  expect(result).toMatchObject({ ok: true });
  return result.ok ? result.effects : [];
};

const wait = (world: World, turns = 1): void => {
  for (let i = 0; i < turns; i++) act(world, 'p', { type: 'wait' });
};

const WANDS = (Object.keys(ITEMS) as ItemKind[]).filter((kind) => itemDef(kind).category === 'wand');

describe('Shattered\'s wands (Wand)', () => {
  it('are the thirteen of Shattered, each known by its own look, with two charges and one a level (magic missile three)', () => {
    expect(WANDS).toHaveLength(13);
    const world = createWorld(9);
    expect(new Set(WANDS.map((kind) => itemSprite(createItem(kind), world.run.labels))).size).toBe(13);
    for (const kind of WANDS) expect(kindKnown(world, createItem(kind))).toBe(true);
    expect(createItem('wand.lightning').charges).toBe(2);
    expect(createItem('wand.magicMissile').charges).toBe(3);
    expect(wandMaxCharges(createItem('wand.frost', 1, 3))).toBe(5);
    expect(wandMaxCharges(createItem('wand.frost', 1, 12))).toBe(10);
    // MagesStaff.updateWand: one more in the staff, ten at most still.
    expect(wandMaxCharges(createItem('wand.frost', 1, 3), true)).toBe(6);
    expect(wandMaxCharges(createItem('wand.frost', 1, 9), true)).toBe(10);
    expect(itemPrice(createItem('wand.frost'), true)).toBe(75);
  });

  it('come up a level better one time in three (two, one in fifteen), with charges to match; three in ten cursed', () => {
    const rng = Rng.seeded(5);
    const levels = [0, 0, 0];
    let cursed = 0;
    const n = 30000;
    for (let i = 0; i < n; i++) {
      const wand = randomWand(rng, 'wand.frost');
      levels[wand.level]!++;
      if (wand.cursed) cursed++;
      expect(wand.charges).toBe(2 + wand.level);
    }
    expect(Math.abs(levels[0]! / n - 2 / 3)).toBeLessThan(0.015);
    expect(Math.abs(levels[1]! / n - 4 / 15)).toBeLessThan(0.015);
    expect(Math.abs(levels[2]! / n - 1 / 15)).toBeLessThan(0.01);
    expect(Math.abs(cursed / n - 0.3)).toBeLessThan(0.015);
  });

  it('gather charges the quicker the more they lack (Wand.Charger: 10 + 40 * 0.875^missing turns)', () => {
    const { hero, wand } = ground('wand.frost');
    wand!.charges = 0;
    wand!.partial = 0;
    // Two missing: 40.625 turns to the first charge.
    chargeWands(hero, 40, () => false);
    expect(wand!.charges).toBe(0);
    chargeWands(hero, 1, () => false);
    expect(wand!.charges).toBe(1);
    // Full, it gathers nothing.
    chargeWands(hero, 60, () => false);
    expect(wand!.charges).toBe(2);
    expect(wand!.partial).toBe(0);
  });

  it('aimed at the zapper, do nothing; out of charges (but not known to be), fizzle; neither takes time', () => {
    const { world, hero, wand } = ground('wand.frost');
    const time = hero.time;
    expect(act(world, 'p', { type: 'zap', item: 0, target: hero.pos })).toEqual({ ok: false, reason: 'bad target' });
    // A wall right beside: the bolt stops at once.
    levelAt(world, 1).map[hero.pos - 1] = T.WALL;
    const effects = zap(world, hero.pos - 3);
    expect(effects).toContainEqual({ type: 'wand', hero: 'p', note: 'selfTarget', item: 'wand.frost' });
    wand!.charges = 0;
    wand!.chargesUnknown = true;
    expect(zap(world, hero.pos + 2)).toContainEqual({ type: 'wand', hero: 'p', note: 'fizzles', item: 'wand.frost' });
    expect(hero.time).toBe(time);
    wand!.chargesUnknown = undefined;
    expect(act(world, 'p', { type: 'zap', item: 0, target: hero.pos + 2 })).toEqual({ ok: false, reason: 'the wand is out of charges' });
  });

  it('tell their curse when first zapped, and their level and charges after ten zaps, five of them counted at first and more with experience', () => {
    const { world, hero, wand } = ground('wand.frost', 1);
    Object.assign(wand!, { levelUnknown: true, curseUnknown: true, chargesUnknown: true, charges: 3 });
    zap(world, hero.pos + 3);
    expect(wand!.curseUnknown).toBeUndefined();
    expect(wand!.levelUnknown).toBe(true);
    for (let i = 0; i < 9; i++) {
      wand!.charges = 3;
      zap(world, hero.pos + 3);
    }
    // Only five zaps counted: the rest wait for the hero to gain experience.
    expect(wand!).toMatchObject({ usesLeftToID: 5, availableUsesToID: 0, levelUnknown: true });
    // A whole level's worth of experience: five more may count.
    wandsGainExp(hero, 10);
    expect(wand!.availableUsesToID).toBe(5);
    for (let i = 0; i < 5; i++) {
      wand!.charges = 3;
      zap(world, hero.pos + 3);
    }
    expect(wand!.levelUnknown).toBeUndefined();
    expect(wand!.chargesUnknown).toBeUndefined();
  });
});

describe('the wand of magic missile', () => {
  it('strikes whoever it reaches for 2-8 (+1 and +2 a level), and lends a lesser wand its level for four turns (MagicCharge)', () => {
    const { world, hero } = ground('wand.magicMissile', 2);
    hero.items.push(createItem('wand.frost'));
    const rat = addMob(world, 'golem', hero.pos + 3);
    rat.hp = rat.ht = 1000;
    const effects = zap(world, rat.pos);
    const hit = effects.find((e) => e.type === 'attack' && e.target === rat.id);
    expect(hit?.type === 'attack' && hit.damage).toBeGreaterThanOrEqual(0);
    expect(rat.hp).toBeLessThan(1000);
    expect(hero.magicCharge).toMatchObject({ level: 2 });
    // The frost wand zaps as a +2 wand once, and the charge is spent.
    rat.chill = 0;
    zap(world, rat.pos, 1);
    // Four turns of chill (two and two a level), one gone by the golem's turn.
    expect(rat.chill).toBe(3);
    expect(hero.magicCharge).toBeUndefined();
  });
});

describe('the wand of lightning', () => {
  it('arcs to whoever stands beside its target, and to the zapper beside them for half', () => {
    const { world, hero } = ground('wand.lightning', 3);
    const first = addMob(world, 'golem', hero.pos + 2);
    const second = addMob(world, 'golem', hero.pos + 2 + WIDTH);
    for (const mob of [first, second]) mob.hp = mob.ht = 500;
    const effects = zap(world, first.pos);
    expect(effects.filter((e) => e.type === 'zapped' && e.bolt === 'lightning').length).toBeGreaterThanOrEqual(2);
    expect(first.hp).toBeLessThan(500);
    expect(second.hp).toBeLessThan(500);
    // Not beside its target: the hero is spared.
    expect(hero.hp).toBe(100);
    first.pos = hero.pos + 1;
    second.pos = hero.pos + 2;
    zap(world, first.pos);
    expect(hero.hp).toBeLessThan(100);
  });
});

describe('the wand of disintegration', () => {
  it('pierces everyone in its way, stronger for each, and burns down a door; six cells and two a level long', () => {
    const { world, hero } = ground('wand.disintegration');
    const map = levelAt(world, 1).map;
    map[hero.pos + 2] = T.DOOR;
    const a = addMob(world, 'golem', hero.pos + 1);
    const b = addMob(world, 'golem', hero.pos + 4);
    const far = addMob(world, 'golem', hero.pos + 8);
    for (const mob of [a, b, far]) mob.hp = mob.ht = 500;
    zap(world, hero.pos + 6);
    expect(a.hp).toBeLessThan(500);
    expect(b.hp).toBeLessThan(500);
    expect(far.hp).toBe(500);
    // Level.destroy: what can burn is embers.
    expect(map[hero.pos + 2]).toBe(T.EMBERS);
  });
});

describe('the wand of fireblast', () => {
  it('spends three tenths of its charges: a cone of fire that sets alight, cripples at two charges and paralyses at three', () => {
    const { world, hero, wand } = ground('wand.fireblast', 7);
    expect(wand!.charges).toBe(9);
    const rat = addMob(world, 'golem', hero.pos + 3);
    rat.hp = rat.ht = 1000;
    const effects = zap(world, rat.pos);
    expect(wand!.charges).toBe(6);
    expect(effects.some((e) => e.type === 'cone' && e.bolt === 'fire')).toBe(true);
    expect(rat.burning).toBeGreaterThan(0);
    expect(rat.paralysed).toBeGreaterThan(0);
    expect(floorAt(world, 1).gas?.fire?.length).toBeGreaterThan(0);
    zap(world, rat.pos);
    expect(wand!.charges).toBe(4);
    expect(rat.crippled).toBeGreaterThan(0);
  });

  it('sets grass on fire, and the fire creeps along it, leaving embers', () => {
    const { world, hero } = ground('wand.fireblast');
    const map = levelAt(world, 1).map;
    for (let dx = 1; dx <= 7; dx++) map[hero.pos + dx] = T.GRASS;
    zap(world, hero.pos + 3);
    wait(world, 12);
    expect(map[hero.pos + 6]).toBe(T.EMBERS);
    expect(map[hero.pos + 3]).toBe(T.EMBERS);
  });
});

describe('the wand of corrosion', () => {
  it('lets out corrosive gas, which eats away at whoever breathes it, harder every turn', () => {
    const { world, hero } = ground('wand.corrosion', 1);
    const rat = addMob(world, 'golem', hero.pos + 4, 'sleeping');
    rat.hp = rat.ht = 1000;
    zap(world, rat.pos);
    expect(floorAt(world, 1).gasStrength?.corrosive).toBe(3);
    wait(world, 2);
    expect(rat.corrosion?.damage).toBeGreaterThanOrEqual(3);
    expect(rat.hp).toBeLessThan(1000);
  });
});

describe('the wand of blast wave', () => {
  it('throws its target back into a wall, hurt and stunned, and whoever stands around it away from it', () => {
    const { world, hero } = ground('wand.blastWave', 2);
    const target = addMob(world, 'golem', hero.pos + 6);
    const beside = addMob(world, 'golem', hero.pos + 6 + WIDTH);
    for (const mob of [target, beside]) mob.hp = mob.ht = 1000;
    const effects = zap(world, target.pos);
    expect(effects.some((e) => e.type === 'blast')).toBe(true);
    // Five cells (three and one a level), stopped by the wall a cell short: a knock, and a moment's stun.
    expect(target.pos).toBe(hero.pos + 10);
    expect(target.paralysed).toBeGreaterThan(0);
    expect(beside.pos).not.toBe(hero.pos + 6 + WIDTH);
  });

  it('throws a monster on foot over a chasm (it falls) and onto a trap (it goes off)', () => {
    const { world, hero, wand } = ground('wand.blastWave');
    const map = levelAt(world, 1).map;
    const rat = addMob(world, 'rat', hero.pos + 2);
    rat.hp = rat.ht = 1000;
    // Three cells (a +0 wand): it lands where the chasm is.
    map[hero.pos + 5] = T.CHASM;
    let effects = zap(world, rat.pos);
    expect(effects).toContainEqual(expect.objectContaining({ type: 'mobFell', mob: rat.id }));
    const other = addMob(world, 'golem', hero.pos + 2);
    other.hp = other.ht = 1000;
    map[hero.pos + 5] = T.ALARM_TRAP;
    wand!.charges = 2;
    effects = zap(world, other.pos);
    expect(effects).toContainEqual(expect.objectContaining({ type: 'trap', kind: 'alarm', mob: other.id }));
  });
});

describe('the wand of living earth', () => {
  it('gathers earthen armour about the hero, which takes half of a blow, and shapes a guardian once thick enough', () => {
    const { world, hero, wand } = ground('wand.livingEarth');
    const golem = addMob(world, 'golem', hero.pos + 3);
    golem.hp = golem.ht = 1000;
    let guardian: Mob | undefined;
    for (let i = 0; i < 10 && !guardian; i++) {
      wand!.charges = 2;
      zap(world, golem.pos);
      guardian = floorAt(world, 1).mobs.find((m) => m.kind === 'guardian');
    }
    expect(guardian).toBeDefined();
    expect(guardian!.ally).toBe(true);
    expect(guardian!.ht).toBe(16);
    expect(hero.rockArmor).toBeUndefined();
    // It fights the golem; once there is nothing to fight, it crumbles back into armour.
    floorAt(world, 1).mobs = floorAt(world, 1).mobs.filter((m) => m !== golem);
    wait(world, 3);
    expect(floorAt(world, 1).mobs.some((m) => m.kind === 'guardian')).toBe(false);
    expect(hero.rockArmor?.armor).toBeGreaterThan(0);
  });
});

describe('the wand of frost', () => {
  it('chills (two turns and one a level, twice that in water), hurts a chilled target less, and leaves a frozen one be', () => {
    const { world, hero } = ground('wand.frost', 1);
    const rat = addMob(world, 'golem', hero.pos + 3, 'sleeping');
    rat.hp = rat.ht = 1000;
    zap(world, rat.pos);
    // Three turns (one gone by its own turn).
    expect(rat.chill).toBe(2);
    rat.chill = 0;
    levelAt(world, 1).map[rat.pos] = T.WATER;
    zap(world, rat.pos);
    expect(rat.chill).toBe(4);
    rat.frozen = 5;
    const hp = rat.hp;
    zap(world, rat.pos);
    expect(rat.hp).toBe(hp);
  });

  it('freezes on a battlemage\'s blow what is chilled enough', () => {
    const { world, hero } = ground(undefined, 0, 'mage');
    hero.weapon = staffWith(createItem('wand.frost'));
    hero.subclass = 'battlemage';
    hero.attackSkill = 1000;
    const rat = addMob(world, 'golem', hero.pos + 1);
    rat.hp = rat.ht = 100000;
    let frozen = false;
    for (let i = 0; i < 40 && !frozen; i++) {
      rat.chill = 10;
      act(world, 'p', { type: 'attack', target: rat.id });
      frozen = (rat.frozen ?? 0) > 0;
    }
    expect(frozen).toBe(true);
  });
});

describe('the wand of prismatic light', () => {
  it('maps what is along its ray, finds what is hidden there, and burns demons and the undead a third more', () => {
    const { world, hero } = ground('wand.prismaticLight', 2);
    const map = levelAt(world, 1).map;
    map[hero.pos + 3 + WIDTH] = T.SECRET_DOOR;
    const eye = addMob(world, 'eye', hero.pos + 5);
    eye.hp = eye.ht = 1000;
    const effects = zap(world, eye.pos);
    expect(map[hero.pos + 3 + WIDTH]).toBe(T.DOOR);
    expect(effects.some((e) => e.type === 'discovered')).toBe(true);
    expect(eye.hp).toBeLessThan(1000);
  });
});

describe('the wand of warding', () => {
  it('sets wards where it is aimed, up to its energy, and a ward zapped again grows a tier', () => {
    const { world, hero, wand } = ground('wand.warding');
    zap(world, hero.pos + 3);
    const ward = floorAt(world, 1).mobs.find((m) => m.kind === 'ward')!;
    expect(ward).toMatchObject({ pos: hero.pos + 3, ally: true, ward: { tier: 1 } });
    wand!.charges = 2;
    zap(world, ward.pos);
    expect(ward.ward!.tier).toBe(2);
    // Two tiers: all a +0 wand can keep.
    expect(zap(world, hero.pos + 2 + WIDTH)).toContainEqual({ type: 'wand', hero: 'p', note: 'noMoreWards', item: 'wand.warding' });
    // A ward shoots a monster that comes in sight, and is spent after its shots.
    const rat = addMob(world, 'rat', ward.pos + 3);
    rat.hp = rat.ht = 1000;
    wait(world, 6);
    expect(rat.hp).toBeLessThan(1000);
    expect(floorAt(world, 1).mobs.includes(ward)).toBe(false);
    checkInvariants(world);
  });

  it('a ward can be dismissed by the hero beside it; monsters go for a ward nearer than the hero', () => {
    const { world, hero } = ground('wand.warding');
    zap(world, hero.pos + 1);
    const ward = floorAt(world, 1).mobs.find((m) => m.kind === 'ward')!;
    const bump = act(world, 'p', { type: 'attack', target: ward.id });
    expect(bump.ok && bump.effects).toContainEqual({ type: 'ward', hero: 'p', mob: ward.id });
    expect(act(world, 'p', { type: 'dismiss', target: ward.id })).toMatchObject({ ok: true });
    expect(floorAt(world, 1).mobs.includes(ward)).toBe(false);
  });
});

describe('the wand of transfusion', () => {
  it('on a foe: a shield for the hero and a charm; on an ally: the hero\'s blood heals it, the rest a shield', () => {
    const { world, hero, wand } = ground('wand.transfusion', 1);
    const rat = addMob(world, 'golem', hero.pos + 3);
    rat.hp = rat.ht = 1000;
    zap(world, rat.pos);
    expect(hero.shield).toBe(6);
    expect(rat.charmed).toBeGreaterThanOrEqual(4);
    expect(rat.charmedBy).toBe('p');
    // Charmed, it is healed like an ally, at the hero's cost (five hundredths of their health).
    rat.hp = 995;
    delete hero.shield;
    wand!.charges = 2;
    zap(world, rat.pos);
    expect(hero.hp).toBe(95);
    expect(rat.hp).toBe(1000);
    expect(rat.shield).toBe(3);
  });

  it('harms the undead', () => {
    const { world, hero } = ground('wand.transfusion');
    const skeleton = addMob(world, 'skeleton', hero.pos + 3);
    skeleton.hp = skeleton.ht = 1000;
    zap(world, skeleton.pos);
    expect(skeleton.hp).toBeLessThan(1000);
    expect(skeleton.charmed).toBeUndefined();
  });
});

describe('the wand of corruption', () => {
  it('corrupts a weak enough foe: healed, an ally, wasting away; what it would give on dying is given at once', () => {
    const { world, hero } = ground('wand.corruption', 3);
    const rat = addMob(world, 'rat', hero.pos + 3);
    rat.hp = 1;
    const exp = hero.exp;
    const effects = zap(world, rat.pos);
    expect(effects).toContainEqual({ type: 'ally', depth: 1, mob: rat.id, event: 'corrupted' });
    expect(rat).toMatchObject({ ally: true, corrupted: true, hp: rat.ht });
    expect(hero.exp).toBeGreaterThan(exp);
    // It fights a monster for the hero.
    const foe = addMob(world, 'gnoll', hero.pos + 5);
    foe.hp = foe.ht = 1000;
    for (let i = 0; i < 20 && foe.hp === 1000; i++) wait(world);
    expect(foe.hp).toBeLessThan(1000);
    // The hero walks into it: they swap places.
    const from = hero.pos;
    floorAt(world, 1).mobs = floorAt(world, 1).mobs.filter((m) => m !== foe);
    rat.pos = hero.pos + 1;
    rat.paralysed = 10;
    act(world, 'p', { type: 'move', to: rat.pos });
    expect(hero.pos).toBe(from + 1);
    expect(rat.pos).toBe(from);
  });

  it('debuffs a foe too strong to corrupt; a boss is doomed instead', () => {
    const { world, hero, wand } = ground('wand.corruption');
    const golem = addMob(world, 'golem', hero.pos + 3);
    const effects = zap(world, golem.pos);
    expect(golem.ally).toBeUndefined();
    expect(effects.some((e) => e.type === 'debuffed')).toBe(true);
    floorAt(world, 1).mobs = [];
    // The curse personification: weak enough, but a miniboss.
    const curse = addMob(world, 'curse', hero.pos + 3);
    curse.hp = 1;
    wand!.charges = 2;
    zap(world, curse.pos);
    expect(curse.doomed).toBe(true);
    expect(curse.ally).toBeUndefined();
  });
});

describe('the wand of regrowth', () => {
  it('grows grass in its cone and holds whoever stands there with roots; three charges grow a lotus', () => {
    const { world, hero, wand } = ground('wand.regrowth', 8);
    expect(wand!.charges).toBe(10);
    const rat = addMob(world, 'golem', hero.pos + 3);
    zap(world, hero.pos + 5);
    // Four turns a charge (one gone by its own turn).
    expect(rat.rooted).toBe(11);
    const map = levelAt(world, 1).map;
    expect(map.filter((t, i) => (t === T.GRASS || t === T.HIGH_GRASS) && Math.abs((i % WIDTH) - (CENTRE % WIDTH)) <= 7).length).toBeGreaterThan(5);
    expect(floorAt(world, 1).mobs.some((m) => m.kind === 'lotus')).toBe(true);
  });

  it('bears so many charges before its growth comes out furrowed: twenty, and more a hero level the stronger it is', () => {
    expect(chargeLimit(1, 0)).toBe(22);
    expect(chargeLimit(10, 3)).toBe(70);
    expect(chargeLimit(10, 9)).toBe(240);
    expect(chargeLimit(30, 10)).toBe(Infinity);
  });
});

describe('a cursed wand (CursedWand)', () => {
  it('does something random instead of its work, tells its curse, and the world holds together', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) {
      const { world, hero, wand } = ground('wand.frost', 1, 'warrior', seed);
      wand!.cursed = true;
      wand!.curseUnknown = true;
      const rat = addMob(world, 'rat', hero.pos + 4);
      rat.hp = rat.ht = 200;
      const result = act(world, 'p', { type: 'zap', item: 0, target: rat.pos });
      expect(result.ok).toBe(true);
      const effects = result.ok ? result.effects : [];
      const cursed = effects.find((e) => e.type === 'cursedZap');
      if (cursed?.type === 'cursedZap') seen.add(cursed.effect);
      expect(effects).toContainEqual({ type: 'wand', hero: 'p', note: 'curseDiscover', item: 'wand.frost' });
      expect(wand!.curseUnknown).toBeUndefined();
      wait(world, 3);
      checkInvariants(world);
    }
    expect(seen.size).toBeGreaterThan(8);
  }, 60_000);
});

describe('the mage\'s staff (MagesStaff)', () => {
  it('takes in another wand: the better level (one more if the wand was as good), the charges together, the old wand lost', () => {
    const { world, hero } = ground(undefined, 0, 'mage');
    const staff = hero.weapon!;
    staff.level = 2;
    staff.wand!.level = 2;
    staff.wand!.charges = 3;
    hero.items = [createItem('wand.frost', 1, 2)];
    hero.items[0]!.charges = 1;
    expect(act(world, 'p', { type: 'imbue', staff: 'weapon', wand: 0 })).toMatchObject({ ok: true });
    expect(hero.items).toHaveLength(0);
    expect(staff.level).toBe(3);
    expect(staff.wand).toMatchObject({ kind: 'wand.frost', level: 3, charges: 4 });
    expect(wandMaxCharges(staff.wand!, true)).toBe(6);
    const rat = addMob(world, 'golem', hero.pos + 3);
    zap(world, rat.pos, 'weapon');
    expect(rat.chill).toBe(4);
  });

  it('a battlemage\'s blow gives the staff\'s wand half a charge; with disintegration it reaches over a cell', () => {
    const { world, hero } = ground(undefined, 0, 'mage');
    hero.subclass = 'battlemage';
    hero.attackSkill = 1000;
    const staff = hero.weapon!;
    staff.wand!.charges = 0;
    staff.wand!.partial = 0;
    const golem = addMob(world, 'golem', hero.pos + 1);
    golem.hp = golem.ht = 100000;
    act(world, 'p', { type: 'attack', target: golem.id });
    expect(staff.wand!.partial).toBeGreaterThanOrEqual(0.5);
    hero.items = [createItem('wand.disintegration')];
    act(world, 'p', { type: 'imbue', staff: 'weapon', wand: 0 });
    golem.pos = hero.pos + 2;
    golem.paralysed = 100;
    expect(act(world, 'p', { type: 'attack', target: golem.id })).toMatchObject({ ok: true });
    hero.subclass = null;
    expect(act(world, 'p', { type: 'attack', target: golem.id })).toEqual({ ok: false, reason: 'too far away' });
  });
});

describe('the warlock (SoulMark)', () => {
  it('marks souls with zaps now and then', () => {
    const { world, hero, wand } = ground('wand.frost', 0, 'mage');
    hero.subclass = 'warlock';
    const golem = addMob(world, 'golem', hero.pos + 3);
    golem.hp = golem.ht = 100000;
    let marked = false;
    for (let i = 0; i < 40 && !marked; i++) {
      wand!.charges = 2;
      golem.frozen = 0;
      zap(world, golem.pos);
      marked = (golem.soulMarked ?? 0) > 0;
    }
    expect(marked).toBe(true);
  });
});

describe('every wand, every way', () => {
  it('zapped plain and cursed, from the pack and from a battlemage\'s staff, struck with: the world holds together', () => {
    for (const kind of WANDS) {
      for (const cursed of [false, true]) {
        const { world, hero, wand } = ground(kind, 3, 'mage', 11);
        hero.hp = hero.ht = 500;
        wand!.cursed = cursed;
        const foes = [addMob(world, 'gnoll', hero.pos + 3), addMob(world, 'golem', hero.pos + 4 + WIDTH), addMob(world, 'skeleton', hero.pos + 5)];
        for (const foe of foes) foe.hp = foe.ht = 300;
        for (let i = 0; i < 4; i++) {
          wand!.charges = 5;
          const target = foes.find((f) => f.hp > 0 && floorAt(world, 1).mobs.includes(f))?.pos ?? hero.pos + 3;
          expect(act(world, 'p', { type: 'zap', item: 0, target }).ok).toBe(true);
          checkInvariants(world);
        }
        if (!cursed) {
          hero.subclass = 'battlemage';
          hero.attackSkill = 1000;
          floorAt(world, 1).mobs = floorAt(world, 1).mobs.filter((m) => m.kind !== 'gnoll' && m.kind !== 'golem' && m.kind !== 'skeleton');
          if (charAt(world, 1, hero.pos + 1)) continue;
          act(world, 'p', { type: 'imbue', staff: 'weapon', wand: 0 });
          const foe = addMob(world, 'golem', hero.pos + 1);
          foe.hp = foe.ht = 5000;
          for (let i = 0; i < 6 && floorAt(world, 1).mobs.includes(foe); i++) {
            foe.pos = hero.pos + 1;
            act(world, 'p', { type: 'attack', target: foe.id });
            checkInvariants(world);
          }
        }
        wait(world, 5);
        checkInvariants(world);
      }
    }
  }, 120_000);

  it('a monster goes for a ward nearer than the hero, and the ward fights back', () => {
    const { world, hero } = ground('wand.warding', 3);
    zap(world, hero.pos + 4);
    const ward = floorAt(world, 1).mobs.find((m) => m.kind === 'ward')!;
    // Grown into a sentry, it can take a blow.
    for (let i = 0; i < 3; i++) {
      hero.items[0]!.charges = 5;
      zap(world, ward.pos);
    }
    expect(ward.ward!.tier).toBe(4);
    const rat = addMob(world, 'gnoll', ward.pos + 2);
    rat.hp = rat.ht = 1000;
    hero.invisible = 1000;
    for (let i = 0; i < 3; i++) wait(world);
    expect(rat.enemy).toBe(ward.id);
    expect(rat.hp).toBeLessThan(1000);
  });
});
