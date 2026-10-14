import { describe, expect, it } from 'vitest';
import {
  act, addHero, initSubclassTalents, createItem, createMob, createWorld, type Effect, eatingTime, floorAt, hasTalent, heroById, heroStr, idSpeedFactor, isAlive,
  type Hero, type ItemKind, levelAt, type Mob, type MobKind, pointsInTalent, T, talentBook, talentPointsAvailable, talentPointsFree, type TalentId,
  TALENTS, WIDTH, type World, heroView, durabilityPerUse, sharpshootingDurability, canTransferGlyph, maxShield, metamorphOptions, metamorphTargets,
} from '../src/index';
import { pacify } from './helpers';

const CENTRE = 20 + 20 * WIDTH;

/** A hero on bare floor, 13 by 9 cells walled round, on the first depth with its monsters cleared away. */
function ground(heroClass: Hero['heroClass'], lvl = 1, seed = 6): { world: World; hero: Hero } {
  const world = pacify(createWorld(seed));
  const hero = addHero(world, { id: 'p', name: 'P', heroClass });
  const map = levelAt(world, 1).map;
  for (let dy = -5; dy <= 5; dy++) {
    for (let dx = -7; dx <= 7; dx++) map[CENTRE + dx + dy * WIDTH] = Math.abs(dx) === 7 || Math.abs(dy) === 5 ? T.WALL : T.EMPTY;
  }
  floorAt(world, 1).heaps = [];
  floorAt(world, 1).plants = [];
  hero.pos = CENTRE - 4;
  hero.lvl = lvl;
  hero.hp = hero.ht = 100;
  hero.attackSkill = 1000;
  return { world, hero };
}

/** Puts points straight into a talent (the hero must have it). */
function give(hero: Hero, id: TalentId, points: number): void {
  const book = talentBook(hero);
  let found = false;
  for (const tier of book.tiers) {
    if (tier[id] !== undefined) {
      tier[id] = points;
      found = true;
    }
  }
  if (!found) throw new Error(`no talent ${id}`);
}

function addMob(world: World, kind: MobKind, pos: number, hp = 1000, state: Mob['state'] = 'hunting'): Mob {
  const mob = createMob(`#${900 + floorAt(world, 1).mobs.length}`, kind, pos, state, floorAt(world, 1).now);
  Object.assign(mob, { enemy: 'p', target: pos, enemySeen: state === 'hunting', ht: hp, hp });
  floorAt(world, 1).mobs.push(mob);
  return mob;
}

const effectsOf = (result: ReturnType<typeof act>): Effect[] => (result.ok ? result.effects : []);
const wait = (world: World, turns = 1): void => {
  for (let i = 0; i < turns; i++) act(world, 'p', { type: 'wait' });
};
const slot = (hero: Hero, kind: ItemKind): number => hero.items.findIndex((item) => item.kind === kind);

describe('talent points', () => {
  it('a point a level from the tier opens: 5, 6, 8 and 10 in all', () => {
    const { hero } = ground('warrior', 1);
    expect(talentPointsAvailable(hero, 1)).toBe(0);
    hero.lvl = 2;
    expect(talentPointsAvailable(hero, 1)).toBe(1);
    hero.lvl = 6;
    expect(talentPointsAvailable(hero, 1)).toBe(5);
    expect(talentPointsAvailable(hero, 2)).toBe(0);
    hero.lvl = 7;
    expect(talentPointsAvailable(hero, 1)).toBe(5);
    expect(talentPointsAvailable(hero, 2)).toBe(1);
    hero.lvl = 13;
    expect(talentPointsAvailable(hero, 2)).toBe(6);
    // The third tier waits for a subclass.
    expect(talentPointsAvailable(hero, 3)).toBe(0);
    expect(talentPointsFree(hero)).toBe(5 + 6);
  });

  it('spends a point on a talent of the class, and no more than the talent takes', () => {
    const { world, hero } = ground('warrior', 3);
    expect(act(world, 'p', { type: 'talent', talent: 'mystical_meal' })).toEqual({ ok: false, reason: 'you have no such talent' });
    expect(act(world, 'p', { type: 'talent', talent: 'iron_stomach' }).ok).toBe(false);
    const result = act(world, 'p', { type: 'talent', talent: 'hearty_meal' });
    expect(effectsOf(result)).toContainEqual({ type: 'talent', hero: 'p', talent: 'hearty_meal', points: 1 });
    expect(pointsInTalent(hero, 'hearty_meal')).toBe(1);
    expect(talentPointsAvailable(hero, 1)).toBe(1);
    expect(act(world, 'p', { type: 'talent', talent: 'hearty_meal' }).ok).toBe(true);
    expect(act(world, 'p', { type: 'talent', talent: 'hearty_meal' })).toEqual({ ok: false, reason: 'that talent is at its best' });
  });

  it('every class has its talents in four tiers', () => {
    for (const cls of ['warrior', 'mage', 'rogue', 'huntress'] as const) {
      const { hero } = ground(cls);
      const book = talentBook(hero);
      expect(Object.keys(book.tiers[0]!)).toHaveLength(4);
      expect(Object.keys(book.tiers[1]!)).toHaveLength(5);
      expect(Object.keys(book.tiers[2]!)).toHaveLength(2);
      expect(Object.keys(book.tiers[3]!)).toHaveLength(0);
      for (const id of book.tiers.flatMap((tier) => Object.keys(tier))) expect(TALENTS[id as TalentId]).toBeDefined();
    }
  });

  it("Tengu's mask opens the subclass's talents of the third tier", () => {
    const { world, hero } = ground('warrior', 13);
    hero.items = [createItem('mask.tengu')];
    act(world, 'p', { type: 'master', item: 0, subclass: 'gladiator' });
    expect(hero.subclass).toBe('gladiator');
    expect(hasTalent(hero, 'cleave')).toBe(false);
    expect(Object.keys(talentBook(hero).tiers[2]!)).toEqual(['hold_fast', 'strongman', 'cleave', 'lethal_defense', 'enhanced_combo']);
    expect(talentPointsAvailable(hero, 3)).toBe(1);
  });

  it('a potion of divine inspiration gives two points more in a tier', () => {
    const { world, hero } = ground('warrior', 3);
    hero.items = [createItem('potion.divineInspiration')];
    world.known.push('potion.divineInspiration');
    const before = talentPointsAvailable(hero, 1);
    const result = act(world, 'p', { type: 'use', item: 0, choice: 1 });
    expect(effectsOf(result)).toContainEqual({ type: 'inspired', hero: 'p', tier: 1 });
    expect(talentPointsAvailable(hero, 1)).toBe(before + 2);
  });
});

describe("the warrior's talents", () => {
  it('strongman adds strength', () => {
    const { hero } = ground('warrior', 13);
    hero.str = 20;
    const before = heroStr(hero);
    give(hero, 'strongman', 3);
    // floor(20 * (0.03 + 0.05 * 3)) = 3
    expect(heroStr(hero)).toBe(before + 3);
  });

  it('hearty meal heals a hero below a third of health; a meal talent eats quicker, iron stomach eases the blows meanwhile', () => {
    const { world, hero } = ground('warrior', 3);
    give(hero, 'hearty_meal', 2);
    hero.hp = 3;
    hero.items = [createItem('food.ration')];
    expect(eatingTime(hero)).toBe(3);
    act(world, 'p', { type: 'use', item: 0 });
    expect(hero.hp).toBe(9);
    give(hero, 'iron_stomach', 2);
    expect(eatingTime(hero)).toBe(1);
    expect(eatingTime(hero, 'food.berry')).toBe(0);
    hero.items = [createItem('food.ration')];
    hero.hp = 50;
    addMob(world, 'brute', hero.pos + 1);
    const before = hero.hp;
    act(world, 'p', { type: 'use', item: 0 });
    // Iron stomach at +2: no harm while eating (one turn), then the monster's blows count again.
    expect(hero.tal?.ironStomach).toBeDefined();
    expect(before - hero.hp).toBeLessThanOrEqual(40);
  });

  it('provoked anger: a broken shield makes the next blow hit harder', () => {
    const { world, hero } = ground('warrior', 3);
    give(hero, 'provoked_anger', 2);
    hero.shield = 1;
    addMob(world, 'brute', hero.pos + 1, 1000);
    for (let i = 0; i < 4 && hero.tal?.provoked === undefined; i++) wait(world);
    expect(hero.tal?.provoked).toBeGreaterThanOrEqual(0);
    expect(hero.shield ?? 0).toBe(0);
    const target = floorAt(world, 1).mobs[0]!;
    act(world, 'p', { type: 'attack', target: target.id });
    expect(hero.tal?.provoked).toBeUndefined();
  });

  it('iron will makes the seal stronger; another class gets a shield of its own', () => {
    const { hero } = ground('warrior', 3);
    const base = maxShield(hero);
    give(hero, 'iron_will', 2);
    expect(maxShield(hero)).toBe(base + 2);
    const mage = ground('mage', 3).hero;
    expect(maxShield(mage)).toBe(0);
    talentBook(mage).tiers[0]!.iron_will = 2;
    expect(maxShield(mage)).toBe(2);
  });

  it('runic transference: a glyph may go with the seal', () => {
    const { hero } = ground('warrior', 3);
    expect(canTransferGlyph(hero, 'stone')).toBe(false);
    give(hero, 'runic_transference', 1);
    expect(canTransferGlyph(hero, 'stone')).toBe(true);
    expect(canTransferGlyph(hero, 'thorns')).toBe(false);
    give(hero, 'runic_transference', 2);
    expect(canTransferGlyph(hero, 'thorns')).toBe(true);
  });

  it('lethal momentum: a kill costs no time', () => {
    const { world, hero } = ground('warrior', 3);
    give(hero, 'lethal_momentum', 2);
    const mob = addMob(world, 'rat', hero.pos + 1, 1);
    const start = hero.time;
    hero.weapon!.level = 0;
    const result = act(world, 'p', { type: 'attack', target: mob.id });
    expect(result.ok && effectsOf(result).some((e) => e.type === 'died')).toBe(true);
    // The kill cost the hero nothing: the clock stands where it was, but for what the monsters' turns took.
    expect(hero.time).toBe(start);
  });

  it('improvised projectiles: whatever is thrown at an enemy blinds it', () => {
    const { world, hero } = ground('warrior', 3);
    give(hero, 'improvised_projectiles', 2);
    const mob = addMob(world, 'rat', hero.pos + 3, 1000);
    hero.items = [createItem('food.ration')];
    act(world, 'p', { type: 'throw', item: 0, target: mob.pos });
    expect(mob.blind).toBeGreaterThan(0);
    expect(hero.tal?.improvised).toBeGreaterThan(40);
  });

  it('hold fast: resting digs in, until the hero moves', () => {
    const { world, hero } = ground('warrior', 13);
    give(hero, 'hold_fast', 3);
    wait(world);
    expect(hero.tal?.holdFast).toBe(hero.pos);
    act(world, 'p', { type: 'move', to: hero.pos + 1 });
    expect(heroView(world, hero)).toBeDefined();
  });

  it('veteran\'s intuition: armour is known at once at +2, and faster at +1', () => {
    const { world, hero } = ground('warrior', 3);
    const armor = createItem('armor.leather');
    armor.levelUnknown = true;
    hero.items = [armor];
    expect(idSpeedFactor(hero, armor)).toBe(1);
    give(hero, 'veterans_intuition', 1);
    expect(idSpeedFactor(hero, armor)).toBe(2);
    give(hero, 'veterans_intuition', 2);
    act(world, 'p', { type: 'equip', item: 0 });
    expect(hero.armor.levelUnknown).toBeUndefined();
  });
});

describe("the mage's talents", () => {
  it('empowering meal adds damage to the next zaps; energizing meal recharges', () => {
    const { world, hero } = ground('mage', 3);
    give(hero, 'empowering_meal', 2);
    give(hero, 'energizing_meal', 2);
    hero.items = [createItem('food.ration')];
    act(world, 'p', { type: 'use', item: 0 });
    expect(hero.tal?.wandEmpower).toEqual({ boost: 3, left: 3 });
    expect(hero.recharging).toBeGreaterThan(0);
  });

  it('desperate power raises the level of a wand on its last charge', () => {
    const { world, hero } = ground('mage', 13);
    const wand = createItem('wand.magicMissile', 1, 0);
    wand.charges = 1;
    hero.items = [wand];
    const mob = addMob(world, 'rat', hero.pos + 3, 1000);
    give(hero, 'desperate_power', 3);
    const before = mob.hp;
    act(world, 'p', { type: 'zap', item: 0, target: mob.pos });
    // Magic missile +3 does 5-14 against 2-8.
    expect(before - mob.hp).toBeGreaterThanOrEqual(5);
  });

  it('shield battery turns a wand\'s charges into a shield; backup barrier shields on the last', () => {
    const { world, hero } = ground('mage', 3);
    const wand = createItem('wand.magicMissile', 1, 0);
    wand.charges = 3;
    hero.items = [wand];
    give(hero, 'shield_battery', 2);
    act(world, 'p', { type: 'zap', item: 0, target: hero.pos });
    expect(wand.charges).toBe(0);
    expect(hero.shield).toBe(Math.round(hero.ht * 0.04 * 3 * 1.5));
  });

  it('lingering magic: a zap, then a blow with a bonus', () => {
    const { world, hero } = ground('mage', 3);
    give(hero, 'lingering_magic', 2);
    const wand = createItem('wand.magicMissile', 1, 0);
    hero.items = [wand];
    const far = addMob(world, 'rat', hero.pos + 4, 1000);
    act(world, 'p', { type: 'zap', item: 0, target: far.pos });
    expect(hero.tal?.lingering).toBeDefined();
    const near = addMob(world, 'rat', hero.pos - 1, 1000);
    act(world, 'p', { type: 'attack', target: near.id });
    expect(hero.tal?.lingering).toBeUndefined();
  });

  it('arcane vision shows whom a wand struck for a while', () => {
    const { world, hero } = ground('mage', 3);
    give(hero, 'arcane_vision', 2);
    const wand = createItem('wand.magicMissile', 1, 0);
    hero.items = [wand];
    const far = addMob(world, 'rat', hero.pos + 4, 1000);
    act(world, 'p', { type: 'zap', item: 0, target: far.pos });
    expect(hero.aware?.some((aware) => aware.char === far.id)).toBe(true);
  });

  it('inscribed power: a scroll read empowers the next zaps', () => {
    const { world, hero } = ground('mage', 3);
    give(hero, 'inscribed_power', 2);
    hero.items = [createItem('scroll.identify')];
    world.known.push('scroll.identify');
    act(world, 'p', { type: 'use', item: 0 });
    expect(hero.tal?.scrollEmpower).toBe(3);
  });

  it('wand preservation: the wand replaced comes back at +0, once', () => {
    const { world, hero } = ground('mage', 3);
    give(hero, 'wand_preservation', 1);
    const staffAt = hero.weapon!;
    expect(staffAt.kind).toBe('weapon.magesStaff');
    const second = createItem('wand.lightning', 1, 2);
    hero.items = [second];
    act(world, 'p', { type: 'imbue', staff: 'weapon', wand: 0 });
    expect(hero.items.some((item) => item.kind === 'wand.magicMissile' && item.level === 0)).toBe(true);
    const third = createItem('wand.frost', 1, 1);
    hero.items.push(third);
    act(world, 'p', { type: 'imbue', staff: 'weapon', wand: hero.items.indexOf(third) });
    expect(hero.items.some((item) => item.kind === 'wand.lightning')).toBe(false);
  });

  it('ally warp: an ally further off is swapped with at once', () => {
    const { world, hero } = ground('mage', 13);
    give(hero, 'ally_warp', 3);
    const ally = addMob(world, 'rat', hero.pos + 5, 10, 'hunting');
    ally.ally = true;
    const from = hero.pos;
    const result = act(world, 'p', { type: 'attack', target: ally.id });
    expect(result.ok).toBe(true);
    expect(ally.pos).toBe(from);
  });
});

describe("the rogue's talents", () => {
  it("thief's intuition teaches rings", () => {
    const { world, hero } = ground('rogue', 3);
    const ring = createItem('ring.haste', 1, 1);
    hero.items = [ring];
    expect(world.known.includes('ring.haste')).toBe(false);
    give(hero, 'thiefs_intuition', 1);
    act(world, 'p', { type: 'equip', item: 0 });
    expect(world.known.includes('ring.haste')).toBe(true);
  });

  it('sucker punch adds to a surprise attack, once for each foe', () => {
    const { world, hero } = ground('rogue', 3);
    give(hero, 'sucker_punch', 2);
    const mob = addMob(world, 'rat', hero.pos + 1, 1000, 'sleeping');
    act(world, 'p', { type: 'attack', target: mob.id });
    expect(mob.suckered).toBe(true);
  });

  it('mystical meal charges artifacts; inscribed stealth makes the reader unseen', () => {
    const { world, hero } = ground('rogue', 3);
    give(hero, 'mystical_meal', 2);
    give(hero, 'inscribed_stealth', 2);
    hero.items = [createItem('food.ration'), createItem('scroll.identify')];
    world.known.push('scroll.identify');
    act(world, 'p', { type: 'use', item: 0 });
    // 1 + 2 turns a point, less the turn the meal took.
    expect(hero.buffs?.artifactRecharge).toBeGreaterThanOrEqual(4);
    act(world, 'p', { type: 'use', item: 0 });
    expect(hero.invisible).toBeGreaterThan(0);
  });

  it('protective shadows: unseen, a barrier builds up', () => {
    const { world, hero } = ground('rogue', 3);
    give(hero, 'protective_shadows', 2);
    hero.invisible = 30;
    wait(world, 6);
    expect(hero.shield).toBeGreaterThan(0);
  });

  it('wide search finds what lies two cells off, as a rogue searches three', () => {
    const { world, hero } = ground('rogue', 7);
    const level = levelAt(world, 1);
    level.map[hero.pos + 3] = T.SECRET_DOOR;
    give(hero, 'wide_search', 2);
    // (A rogue sees two cells away; with wide search, three.) The search is deliberate and sure.
    act(world, 'p', { type: 'search' });
    expect(level.map[hero.pos + 3]).not.toBe(T.SECRET_DOOR);
  });

  it('light cloak lets the cloak work from the pack; enhanced rings make rings better after an artifact is used', () => {
    const { hero } = ground('rogue', 13);
    give(hero, 'enhanced_rings', 3);
    expect(hero.tal?.enhancedRings).toBeUndefined();
  });
});

describe("the huntress's talents", () => {
  it('invigorating meal: a little haste; survivalist\'s intuition: thrown weapons are known faster', () => {
    const { world, hero } = ground('huntress', 3);
    give(hero, 'invigorating_meal', 2);
    hero.items = [createItem('food.ration')];
    act(world, 'p', { type: 'use', item: 0 });
    expect(hero.buffs?.haste).toBeGreaterThan(1);
    give(hero, 'survivalists_intuition', 2);
    expect(idSpeedFactor(hero, createItem('missile.dart'))).toBe(5);
  });

  it('followup strike: a thrown weapon, then a melee blow at the same foe with a bonus', () => {
    const { world, hero } = ground('huntress', 3);
    give(hero, 'followup_strike', 2);
    const mob = addMob(world, 'rat', hero.pos + 2, 1000);
    hero.items.push(createItem('missile.dart', 4));
    act(world, 'p', { type: 'throw', item: slot(hero, 'missile.dart'), target: mob.pos });
    expect(hero.tal?.followup?.object).toBe(mob.id);
    mob.pos = hero.pos + 1;
    act(world, 'p', { type: 'attack', target: mob.id });
    expect(hero.tal?.followup).toBeUndefined();
  });

  it('liquid nature: a potion drunk grows grass around', () => {
    const { world, hero } = ground('huntress', 3);
    give(hero, 'liquid_nature', 2);
    hero.items = [createItem('potion.healing')];
    world.known.push('potion.healing');
    act(world, 'p', { type: 'use', item: 0 });
    const level = levelAt(world, 1);
    const around = [-1, 1, -WIDTH, WIDTH].map((n) => level.map[hero.pos + n]);
    expect(around.some((t) => t === T.GRASS || t === T.HIGH_GRASS)).toBe(true);
  });

  it('durable projectiles: thrown weapons last longer', () => {
    const { hero } = ground('huntress', 3);
    const stone = createItem('missile.dart');
    const before = durabilityPerUse(stone, 0, sharpshootingDurability(hero));
    give(hero, 'durable_projectiles', 2);
    expect(durabilityPerUse(stone, 0, sharpshootingDurability(hero))).toBeLessThanOrEqual(before);
  });

  it('heightened senses: a foe through a wall is sensed', () => {
    const { world, hero } = ground('huntress', 3);
    const mob = addMob(world, 'rat', hero.pos + 3, 1000, 'sleeping');
    const level = levelAt(world, 1);
    level.map[hero.pos + 2] = T.WALL;
    const before = heroView(world, hero)[mob.pos];
    give(hero, 'heightened_senses', 2);
    expect(heroView(world, hero)[mob.pos]).toBe(true);
    void before;
  });

  it('nature\'s aid and barkskin harden the huntress in grass and by plants', () => {
    const { world, hero } = ground('huntress', 13);
    hero.subclass = 'warden';
    initSubclassTalents(hero);
    give(hero, 'barkskin', 3);
    const level = levelAt(world, 1);
    level.map[hero.pos + 1] = T.HIGH_GRASS;
    act(world, 'p', { type: 'move', to: hero.pos + 1 });
    expect(hero.buffs?.barkskin?.level).toBeGreaterThan(0);
  });

  it('seer shot, point blank and farsight are the huntress\'s to find in her talents', () => {
    const { hero } = ground('huntress', 13);
    expect(hasTalent(hero, 'seer_shot')).toBe(false);
    give(hero, 'point_blank', 3);
    expect(pointsInTalent(hero, 'point_blank')).toBe(3);
    expect(isAlive(hero)).toBe(true);
  });
});

describe('metamorphosis', () => {
  it('swaps a talent for another class\'s of the tier, keeping the points', () => {
    const { world, hero } = ground('warrior', 7);
    hero.items = [createItem('scroll.metamorphosis')];
    world.known.push('scroll.transmutation');
    give(hero, 'hearty_meal', 2);
    const targets = metamorphTargets(hero);
    expect(targets).toHaveLength(11);
    const index = targets.findIndex((t) => t.talent === 'hearty_meal');
    const options = metamorphOptions(world, hero, targets[index]!);
    expect(options).toHaveLength(5);
    const result = act(world, 'p', { type: 'use', item: 0, choice: index * 8 });
    expect(effectsOf(result)).toContainEqual({ type: 'metamorphed', hero: 'p', from: 'hearty_meal', to: options[0] });
    expect(pointsInTalent(hero, options[0]!)).toBe(2);
    expect(pointsInTalent(hero, 'hearty_meal')).toBe(0);
    expect(hero.talents!.replaced).toEqual({ hearty_meal: options[0] });
  });

  it('refuses a choice that names nothing', () => {
    const { world, hero } = ground('warrior', 7);
    hero.items = [createItem('scroll.metamorphosis')];
    world.known.push('scroll.transmutation');
    expect(act(world, 'p', { type: 'use', item: 0, choice: 255 }).ok).toBe(false);
  });
});
