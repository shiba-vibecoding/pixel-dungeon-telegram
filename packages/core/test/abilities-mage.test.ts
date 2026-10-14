import { describe, expect, it } from 'vitest';
import { act, createItem, heroById, type AbilityKind, type ItemKind, type Mob, type Talent, type World } from '../src/index';
import { staffWith } from '../src/staff';
import { CENTRE, foeAt, ready, special } from './abilities-helpers';

function mage(ability: AbilityKind, wand: ItemKind | null, talents: Partial<Record<Talent, number>> = {}, level = 0): World {
  const world = ready('mage', ability, talents);
  const hero = heroById(world, 'p')!;
  hero.weapon = createItem('weapon.magesStaff');
  if (wand) hero.weapon = staffWith(createItem(wand, 1, level));
  hero.items = [];
  return world;
}

describe("the mage's abilities", () => {
  it('elemental blast needs the staff with a wand in it', () => {
    const world = mage('elementalBlast', null);
    expect(special(world)).toEqual({ ok: false, reason: 'art:actors.hero.abilities.mage.elementalblast.no_staff' });
  });

  it('elemental blast hurts everyone round the hero for 15 to 25 by the wand, at 35 charge', () => {
    const world = mage('elementalBlast', 'wand.frost');
    const hero = heroById(world, 'p')!;
    const near = foeAt(world, hero.pos + 2);
    const far = foeAt(world, hero.pos + 6);
    const ally = foeAt(world, hero.pos - 1);
    ally.ally = true;
    hero.burning = 5;
    expect(special(world).ok).toBe(true);
    expect(100000 - near.hp).toBeGreaterThanOrEqual(15);
    expect(near.frozen ?? 0).toBeGreaterThan(0);
    expect(far.hp).toBe(100000);
    expect(ally.hp).toBe(100000);
    expect(hero.burning).toBe(0);
    expect(100 - hero.armor.charge!).toBeCloseTo(35, 0);
  });

  it('elemental blast does what the wand does: stuns, throws back, charms, sends amok, roots, blinds, burns, corrodes', () => {
    const results: Record<string, (rat: Mob, before: number) => boolean> = {
      'wand.lightning': (rat) => (rat.paralysed ?? 0) > 0,
      'wand.blastWave': (rat, before) => rat.pos > before,
      'wand.transfusion': (rat) => (rat.charmed ?? 0) > 0,
      'wand.corruption': (rat) => (rat.amok ?? 0) > 0,
      'wand.regrowth': (rat) => (rat.rooted ?? 0) > 0,
      'wand.prismaticLight': (rat) => (rat.blind ?? 0) > 0,
      'wand.fireblast': (rat) => (rat.burning ?? 0) > 0,
      'wand.corrosion': (rat) => rat.corrosion !== undefined,
    };
    for (const [wand, check] of Object.entries(results)) {
      const world = mage('elementalBlast', wand as ItemKind);
      const hero = heroById(world, 'p')!;
      const rat = foeAt(world, hero.pos + 2);
      const before = rat.pos;
      expect(special(world).ok, wand).toBe(true);
      expect(check(rat, before), wand).toBe(true);
    }
  });

  it('elemental blast shields the hero for each creature struck with reactive barrier', () => {
    const world = mage('elementalBlast', 'wand.lightning', { reactiveBarrier: 4 });
    const hero = heroById(world, 'p')!;
    foeAt(world, hero.pos + 2);
    foeAt(world, hero.pos - 2);
    special(world);
    expect(hero.shield ?? 0).toBeGreaterThan(0);
  });

  it('blast radius widens it', () => {
    const reach = (world: World): boolean => {
      const rat = foeAt(world, heroById(world, 'p')!.pos + 7);
      special(world);
      return rat.hp < 100000;
    };
    expect(reach(mage('elementalBlast', 'wand.lightning'))).toBe(false);
    expect(reach(mage('elementalBlast', 'wand.lightning', { blastRadius: 4 }))).toBe(true);
  });

  it('wild magic fires the wands in the pack at the cell, half a charge each, and not the staff', () => {
    const world = mage('wildMagic', 'wand.lightning');
    const hero = heroById(world, 'p')!;
    hero.items = [createItem('wand.magicMissile'), createItem('wand.frost')];
    const staffCharges = hero.weapon!.wand!.charges;
    const rat = foeAt(world, hero.pos + 3);
    const charges = hero.items.map((w) => (w.charges ?? 0) + (w.partial ?? 0));
    expect(special(world)).toEqual({ ok: false, reason: 'art:actors.hero.abilities.armorability.prompt' });
    expect(special(world, { target: hero.pos })).toEqual({ ok: false, reason: 'art:actors.hero.abilities.armorability.self_target' });
    expect(special(world, { target: rat.pos }).ok).toBe(true);
    expect(rat.hp).toBeLessThan(100000);
    const spent = hero.items.map((w, i) => charges[i]! - ((w.charges ?? 0) + (w.partial ?? 0)));
    expect(spent.every((c) => c >= 0.49 && c <= 2.01)).toBe(true);
    expect(hero.weapon!.wand!.charges).toBe(staffCharges);
    expect(hero.abil?.wild).toBeUndefined();
    expect(100 - hero.armor.charge!).toBeCloseTo(25, 0);
  });

  it('wild magic with no wand to fire is refused', () => {
    const world = mage('wildMagic', 'wand.lightning');
    expect(special(world, { target: CENTRE })).toEqual({ ok: false, reason: 'art:actors.hero.abilities.mage.wildmagic.no_wands' });
  });

  it('wild magic fires a wand with charge to spare a second time', () => {
    const world = mage('wildMagic', 'wand.lightning');
    const hero = heroById(world, 'p')!;
    hero.items = [createItem('wand.magicMissile', 1, 3)];
    const rat = foeAt(world, hero.pos + 3);
    const before = hero.items[0]!.charges!;
    special(world, { target: rat.pos });
    // Half a charge a shot: two shots if it had a whole charge or more to spare, three with fire everything.
    expect(before - (hero.items[0]!.charges! + (hero.items[0]!.partial ?? 0))).toBeGreaterThan(0.9);
  });

  it('warp beacon is placed where the hero stands for free, and warps back to it at once for 35 charge', () => {
    const world = mage('warpBeacon', 'wand.frost');
    const hero = heroById(world, 'p')!;
    const home = hero.pos;
    expect(special(world).ok).toBe(true);
    expect(hero.abil?.beacon).toEqual({ depth: 1, pos: home });
    expect(hero.armor.charge!).toBeGreaterThan(99);
    hero.pos = home + 5;
    expect(special(world)).toEqual({ ok: false, reason: 'art:actors.hero.abilities.mage.warpbeacon.window_desc' });
    const before = hero.time;
    expect(special(world, { choice: 0 }).ok).toBe(true);
    expect(hero.pos).toBe(home);
    expect(hero.time).toBe(before);
    expect(100 - hero.armor.charge!).toBeCloseTo(35, 0);
    expect(special(world, { choice: 1 }).ok).toBe(true);
    expect(hero.abil?.beacon).toBeUndefined();
  });

  it('warp beacon pushes aside whoever stands on it, or telefrags them', () => {
    const world = mage('warpBeacon', 'wand.frost', { telefrag: 4 });
    const hero = heroById(world, 'p')!;
    const home = hero.pos;
    special(world);
    hero.pos = home + 5;
    const rat = foeAt(world, home);
    const hp = hero.hp;
    expect(special(world, { choice: 0 }).ok).toBe(true);
    expect(hero.pos).toBe(home);
    expect(rat.hp).toBeLessThan(100000);
    expect(hp - hero.hp).toBeLessThanOrEqual(20);
    expect(rat.pos).not.toBe(home);
  });

  it('remote beacon sets the beacon up to four cells a point away; without long-range warp it does not cross depths', () => {
    const world = mage('warpBeacon', 'wand.frost', { remoteBeacon: 1 });
    const hero = heroById(world, 'p')!;
    expect(special(world, { target: hero.pos + 6 })).toEqual({ ok: false, reason: 'art:actors.hero.abilities.mage.warpbeacon.too_far' });
    expect(special(world, { target: hero.pos + 3 }).ok).toBe(true);
    expect(hero.abil?.beacon?.pos).toBe(hero.pos + 3);
    const plain = mage('warpBeacon', 'wand.frost');
    heroById(plain, 'p')!.abil = { beacon: { depth: 2, pos: CENTRE } };
    expect(special(plain, { choice: 0 })).toEqual({ ok: false, reason: 'art:actors.hero.abilities.mage.warpbeacon.depths' });
    expect(act(plain, 'p', { type: 'wait' }).ok).toBe(true);
  });
});
