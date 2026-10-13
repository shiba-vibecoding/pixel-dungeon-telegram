import {
  act, addHero, canEnter, charAt, createItem, createMob, createWorld, floorAt, heroById, type HeroClass, levelAt, type Mob, type MobKind,
  NEIGHBOURS8, T, WIDTH, type World, type AbilityKind, type Talent,
} from '../src/index';
import { observe } from '../src/floor';
import { pacify } from './helpers';

export const CENTRE = 20 + 20 * WIDTH;

/**
 * A hero in class armour with an ability, a full charge and a sturdy body, on a walled room of bare floor (13 by 9 cells)
 * on depth 1 with the monsters gone; the hero stands four cells west of the middle.
 */
export function ready(heroClass: HeroClass, ability: AbilityKind, talents: Partial<Record<Talent, number>> = {}, seed = 41): World {
  const world = pacify(createWorld(seed));
  addHero(world, { id: 'p', name: 'P', heroClass });
  const map = levelAt(world, 1).map;
  for (let dy = -5; dy <= 5; dy++) {
    for (let dx = -7; dx <= 7; dx++) map[CENTRE + dx + dy * WIDTH] = Math.abs(dx) === 7 || Math.abs(dy) === 5 ? T.WALL : T.EMPTY;
  }
  floorAt(world, 1).heaps = [];
  floorAt(world, 1).plants = [];
  const hero = heroById(world, 'p')!;
  hero.pos = CENTRE - 4;
  hero.armor = { ...createItem(`armor.${heroClass}`), base: 'armor.mail', level: 2, charge: 100 };
  hero.ability = ability;
  hero.talents = talents;
  Object.assign(hero, { hp: 300, ht: 300, lvl: 25, attackSkill: 100000 });
  observe(world, hero);
  return world;
}

export const FREE = (world: World, near: number, skip: number[] = []): number[] => {
  const level = levelAt(world, 1);
  return NEIGHBOURS8.map((n) => near + n).filter((c) => canEnter(level, c) && !charAt(world, 1, c) && !skip.includes(c));
};

export function foeAt(world: World, pos: number, hp = 100000, kind: MobKind = 'rat'): Mob {
  const rat = createMob(`#foe${pos}`, kind, pos, 'hunting', floorAt(world, 1).now);
  Object.assign(rat, { enemy: 'p', hp, ht: hp, enemySeen: true });
  floorAt(world, 1).mobs.push(rat);
  return rat;
}

export const dist = (a: number, b: number): number => Math.max(Math.abs((a % WIDTH) - (b % WIDTH)), Math.abs(Math.trunc(a / WIDTH) - Math.trunc(b / WIDTH)));
export const special = (world: World, use: { target?: number; choice?: number } = {}) => act(world, 'p', { type: 'special', ...use });
export const wait = (world: World, turns = 1): void => {
  for (let i = 0; i < turns; i++) act(world, 'p', { type: 'wait' });
};

