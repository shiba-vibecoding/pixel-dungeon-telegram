import type { Hero } from './actors';
import { DARKNESS, NO_HEALING, NO_HERBALISM, NO_SCROLLS, SWARM_INTELLIGENCE } from './challenges';
import { ipow } from './fmath';
import { collect } from './inventory';
import { createItem, ITEMS, itemDef, type ItemKind } from './items';
import type { World } from './world';

/*
 * The daily dungeon's rules: every day, the same for everyone, one hardship (one of the milder
 * challenges) and one boon the hero sets out with. Picked from the date alone, so the server
 * and every device agree on them without being told.
 */

export type BoonId = 'alchemist' | 'scholar' | 'purse' | 'supplies' | 'whetstone' | 'cartographer';
export const BOONS: readonly BoonId[] = ['alchemist', 'scholar', 'purse', 'supplies', 'whetstone', 'cartographer'];

/** The challenges a day may bring: none that starves or strips the hero. */
const HARDSHIPS: readonly number[] = [DARKNESS, SWARM_INTELLIGENCE, NO_HERBALISM, NO_SCROLLS, NO_HEALING];

export interface DailyRules {
  /** The hardship, as a challenge mask. */
  challenge: number;
  boon: BoonId;
}

function hash(text: string, salt: number): number {
  let h = 2166136261 ^ salt;
  for (const char of text) h = Math.imul(h ^ char.charCodeAt(0), 16777619);
  h = Math.imul(h ^ (h >>> 15), 2246822507);
  return (h ^ (h >>> 13)) >>> 0;
}

/** A day's rules (date as YYYY-MM-DD). A boon the hardship would make useless is passed over. */
export function dailyRules(date: string): DailyRules {
  const challenge = HARDSHIPS[hash(date, 0x5eed) % HARDSHIPS.length]!;
  const fits = BOONS.filter((boon) => !(boon === 'supplies' && challenge === NO_HEALING) && !(boon === 'scholar' && challenge === NO_SCROLLS));
  return { challenge, boon: fits[hash(date, 0xb00) % fits.length]! };
}

const kindsOf = (category: string): ItemKind[] => (Object.keys(ITEMS) as ItemKind[]).filter((kind) => itemDef(kind).category === category);

/** The hero sets out with the day's boon; the world remembers which, for the screens. */
export function applyBoon(world: World, hero: Hero, boon: BoonId): void {
  world.boon = boon;
  const know = (kinds: readonly ItemKind[]): void => {
    for (const kind of kinds) if (!world.known.includes(kind)) world.known.push(kind);
  };
  switch (boon) {
    case 'alchemist':
      // Every potion known by its colour.
      know(kindsOf('potion'));
      break;
    case 'scholar':
      know(kindsOf('scroll'));
      break;
    case 'purse':
      // Gold to spend, not gold collected: it does not add to the score.
      hero.gold += 150;
      break;
    case 'supplies':
      collect(hero, createItem('potion.healing', 2));
      collect(hero, createItem('food.ration'));
      know(['potion.healing']);
      break;
    case 'whetstone':
      if (hero.weapon) hero.weapon.level += 1;
      break;
    case 'cartographer':
      collect(hero, createItem('scroll.mapping', 3));
      know(['scroll.mapping']);
      break;
  }
}

/** Statistics.chalMultiplier in twentieths: 1.25 to the power of the challenges on, to the nearest twentieth (20 for none, 25, 31, 39 ...). */
export function challengeMultiplier20(challenges: number): number {
  let count = 0;
  for (let mask = challenges; mask; mask &= mask - 1) count++;
  // 1.25^n is exact in binary up to n = 22, so rounding its twentieths is the same on every engine.
  return Math.round(ipow(1.25, count) * 20);
}

/** How much a run's challenges raise its score (Rankings.calculateScore): 1.25 to the power of those on, rounded to a twentieth. */
export const challengeMultiplier = (challenges: number): number => challengeMultiplier20(challenges) / 20;
