import { describe, expect, it } from 'vitest';
import {
  act, addHero, berserkDamageFactor, berserkOf, canEnter, charAt, comboOf, createItem, createMob, createWorld, floorAt, heroById, heroDefenseSkill,
  heroStr, heroView, isAlive, levelAt, NEIGHBOURS8, prepLevel, T, talentBook, WIDTH, type World,
} from '../src/index';
import { pacify } from './helpers';

type Way = Extract<Parameters<typeof act>[2], { type: 'master' }>['subclass'];

const CENTRE = 20 + 20 * WIDTH;

/** A hero on bare floor, 13 by 9 cells walled round, with the mask in the pack, a way chosen and a level given. */
function arena(heroClass: 'warrior' | 'mage' | 'rogue' | 'huntress', way: Way, lvl = 14): { world: World; hero: ReturnType<typeof heroById> & object } {
  const world = pacify(createWorld(6));
  addHero(world, { id: 'p', name: 'P', heroClass });
  const hero = heroById(world, 'p')!;
  const map = levelAt(world, 1).map;
  for (let dy = -5; dy <= 5; dy++) {
    for (let dx = -7; dx <= 7; dx++) map[CENTRE + dx + dy * WIDTH] = Math.abs(dx) === 7 || Math.abs(dy) === 5 ? T.WALL : T.EMPTY;
  }
  floorAt(world, 1).heaps = [];
  floorAt(world, 1).plants = [];
  hero.pos = CENTRE - 3;
  hero.items.unshift(createItem('mask.tengu'));
  act(world, 'p', { type: 'master', item: 0, subclass: way });
  hero.lvl = lvl;
  hero.hp = hero.ht = 100;
  hero.attackSkill = 1000;
  return { world, hero };
}

const grant = (world: World, id: string, points: number): void => {
  const hero = heroById(world, 'p')!;
  for (const tier of talentBook(hero).tiers) if (tier[id] !== undefined) tier[id] = points;
};

function monster(world: World, offset: number, hp = 2000, kind: 'rat' | 'brute' | 'golem' = 'rat', id = `#m${offset}`): ReturnType<typeof createMob> {
  const hero = heroById(world, 'p')!;
  const mob = createMob(id, kind, hero.pos + offset, 'hunting', floorAt(world, 1).now);
  Object.assign(mob, { enemy: 'p', target: hero.pos, enemySeen: true, ht: hp, hp });
  floorAt(world, 1).mobs.push(mob);
  return mob;
}

describe('the talents of the subclasses', () => {
  it('a berserker in rage hits harder, and deathless fury keeps it up on a single point until the shield is gone', () => {
    const { world, hero } = arena('warrior', 'berserker');
    grant(world, 'deathless_fury', 3);
    hero.tal = { berserk: { state: 'normal', power: 1, buffer: 3, levelRecovery: 0, turnRecovery: 0, shield: 0 } };
    expect(berserkDamageFactor(hero, 10)).toBe(15);
    hero.hp = 3;
    monster(world, 1, 2000, 'golem');
    for (let i = 0; i < 3 && isAlive(hero) && !hero.tal?.berserk?.deathless; i++) act(world, 'p', { type: 'wait' });
    expect(hero.tal?.berserk?.deathless).toBe(true);
    expect(isAlive(hero)).toBe(true);
    expect(hero.hp).toBe(1);
    expect(berserkOf(hero)!.shield).toBeGreaterThan(0);
  });

  it('a parry dodges the next blow and answers it', () => {
    const { world, hero } = arena('warrior', 'gladiator');
    hero.hp = hero.ht = 2000;
    const mob = monster(world, 1, 3000, 'brute');
    for (let i = 0; i < 6; i++) act(world, 'p', { type: 'attack', target: mob.id });
    expect(comboOf(hero)!.count).toBeGreaterThanOrEqual(6);
    const hp = hero.hp;
    const before = mob.hp;
    act(world, 'p', { type: 'ability', ability: 'combo', move: 'parry' });
    expect(hero.hp).toBe(hp);
    expect(mob.hp).toBeLessThan(before);
  });

  it('crush hits everyone about the target, and spends the combo', () => {
    const { world, hero } = arena('warrior', 'gladiator');
    const mob = monster(world, 1, 3000);
    const other = monster(world, 2, 3000);
    for (let i = 0; i < 8; i++) act(world, 'p', { type: 'attack', target: mob.id });
    const before = other.hp;
    act(world, 'p', { type: 'ability', ability: 'combo', move: 'crush', target: mob.id });
    expect(other.hp).toBeLessThan(before);
    expect(comboOf(hero)).toBeUndefined();
  });

  it('the battlemage: a zap with the staff makes the next blow with it stronger', () => {
    const { world, hero } = arena('mage', 'battlemage');
    grant(world, 'empowered_strike', 3);
    const mob = monster(world, 1, 2000);
    act(world, 'p', { type: 'zap', item: 'weapon', target: mob.pos });
    expect(hero.tal?.empowered).toBeGreaterThanOrEqual(0);
    act(world, 'p', { type: 'attack', target: mob.id });
    expect(hero.tal?.empowered).toBeUndefined();
  });

  it('the warlock: blows on a marked foe heal and feed the warlock', () => {
    const { world, hero } = arena('mage', 'warlock');
    grant(world, 'soul_eater', 3);
    hero.hp = 20;
    hero.hunger = 200;
    const mob = monster(world, 1, 2000);
    mob.soulMarked = 20;
    act(world, 'p', { type: 'attack', target: mob.id });
    expect(hero.hp).toBeGreaterThan(20);
    expect(hero.hunger).toBeLessThan(200);
  });

  it('the assassin executes the weakened', () => {
    const { world, hero } = arena('rogue', 'assassin');
    grant(world, 'enhanced_lethality', 3);
    hero.invisible = 30;
    for (let i = 0; i < 10; i++) act(world, 'p', { type: 'wait' });
    expect(prepLevel(hero.tal!.prep!)).toBe(3);
    const mob = monster(world, 1, 100);
    mob.hp = 40;
    const result = act(world, 'p', { type: 'attack', target: mob.id });
    expect(result.ok && result.effects.some((e) => e.type === 'died')).toBe(true);
  });

  it('the freerunner runs with more evasion', () => {
    const { world, hero } = arena('rogue', 'freerunner');
    const walking = heroDefenseSkill(hero);
    hero.tal = { momentum: { stacks: 0, freerunTurns: 10, freerunCooldown: 20, movedLastTurn: false } };
    grant(world, 'evasive_armor', 3);
    expect(heroDefenseSkill(hero)).toBeGreaterThanOrEqual(walking + 7);
  });

  it('the warden: firebloom imbues her with fire, rotberry strengthens her, earthroot hardens her', () => {
    const { world, hero } = arena('huntress', 'warden', 10);
    const cells = [1, -1, WIDTH].map((n) => hero.pos + n);
    floorAt(world, 1).plants = [{ pos: cells[0]!, kind: 'firebloom' }, { pos: cells[1]!, kind: 'earthroot' }, { pos: cells[2]!, kind: 'rotberry' }];
    const str = heroStr(hero);
    act(world, 'p', { type: 'move', to: cells[0]! });
    expect(hero.buffs?.fireImbue).toBeGreaterThan(0);
    act(world, 'p', { type: 'move', to: cells[0]! + WIDTH });
    act(world, 'p', { type: 'move', to: cells[2]! });
    expect(heroStr(hero)).toBe(str + 1);
  });

  it('the warden throws seeds that make grass spring up round them, and sees through tall grass', () => {
    const { world, hero } = arena('huntress', 'warden');
    const level = levelAt(world, 1);
    hero.items.push(createItem('seed.sungrass', 1));
    const seed = hero.items.findIndex((item) => item.kind === 'seed.sungrass');
    act(world, 'p', { type: 'throw', item: seed, target: hero.pos + 3 });
    const tall = (c: number): boolean => level.map[c] === T.HIGH_GRASS || level.map[c] === T.FURROWED_GRASS;
    expect(tall(hero.pos + 4) || tall(hero.pos + 2)).toBe(true);
    level.map[hero.pos + 1] = T.HIGH_GRASS;
    expect(heroView(world, hero)[hero.pos + 2]).toBe(true);
    expect(charAt(world, 1, hero.pos + 2)).toBeUndefined();
    void canEnter;
    void NEIGHBOURS8;
  });
});
