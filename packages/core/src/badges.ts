import { type Hero, heroBelongings } from './actors';
import { wavesCleared } from './arena';
import type { Effect } from './floor';
import { isExotic, ITEMS, type Item, itemDef, type ItemKind } from './items';
import { levelKnown } from './ident';
import type { World } from './world';

/*
 * Badges (Badges.java): feats remembered across runs. Most are earned within a run (so many
 * monsters slain, so much gold, a boss); a few gather over many runs (every class has slain Goo,
 * every rare monster has fallen). The rules live here so that the device (at once, for the
 * popup) and the server (from the checked run, for the record that counts) earn them alike.
 */

export type BadgeId =
  | 'slain1' | 'slain2' | 'slain3' | 'slain4' | 'gold1' | 'gold2' | 'gold3' | 'gold4' | 'level1' | 'level2' | 'level3' | 'level4'
  | 'potions' | 'scrolls' | 'rings' | 'wands' | 'allItems' | 'bags' | 'deathFire' | 'deathPoison' | 'deathGas' | 'deathHunger'
  | 'deathGlyph' | 'deathFalling' | 'yasd' | 'boss1' | 'boss2' | 'boss3' | 'boss4' | 'boss1AllClasses' | 'boss3AllSubclasses'
  | 'haggler' | 'thorns' | 'str1' | 'str2' | 'str3' | 'str4' | 'food1' | 'food2' | 'food3' | 'food4' | 'item1' | 'item2' | 'item3'
  | 'item4' | 'rare' | 'victory' | 'victoryAllClasses' | 'happyEnd' | 'combo' | 'cooked1' | 'cooked2' | 'cooked3' | 'cooked4' | 'grim' | 'piranhas'
  | 'games1' | 'games2' | 'games3' | 'games4' | 'champion' | 'arena5' | 'arena10' | 'arena20';

/** What a player's badges stand on: those earned, and what gathers towards the ones earned over many runs. */
export interface BadgeProgress {
  earned: BadgeId[];
  /** Rare monster kinds slain, classes that slew Goo or won, ways that slew DM-300, deaths suffered. */
  rare: string[];
  boss1: string[];
  boss3: string[];
  victories: string[];
  deaths: string[];
  games: number;
  /** The last run counted, so a run is counted once however often it is reopened. */
  lastRun?: number;
}

export const emptyBadgeProgress = (): BadgeProgress => ({ earned: [], rare: [], boss1: [], boss3: [], victories: [], deaths: [], games: 0 });

const RARE_KINDS = ['albino', 'bandit', 'shielded', 'senior', 'acidic'];
const BOSSES: Readonly<Record<string, BadgeId>> = { goo: 'boss1', tengu: 'boss2', dm300: 'boss3', king: 'boss4' };
const SUBCLASSES = ['gladiator', 'berserker', 'warlock', 'battlemage', 'freerunner', 'assassin', 'sniper', 'warden'];
const CLASSES = ['warrior', 'mage', 'rogue', 'huntress'];
// (The duelist's and the cleric's own badges: SEAM(badges) — Shattered's mastery, unlock and all-classes badges name six.)
const DEATHS: Readonly<Record<string, BadgeId>> = {
  burning: 'deathFire', poison: 'deathPoison', gas: 'deathGas', hunger: 'deathHunger', fall: 'deathFalling',
  multiplicity: 'deathGlyph', deferred: 'deathGlyph',
};

/** Kinds that go by a label until known: every one of them known means the whole category is identified. */
const LABELLED = new Map<string, ItemKind[]>();
const labelled = (category: string): ItemKind[] => {
  if (!LABELLED.has(category)) {
    LABELLED.set(category, (Object.keys(ITEMS) as ItemKind[]).filter((kind) => itemDef(kind).category === category && itemDef(kind).sprite === undefined && !isExotic(kind)));
  }
  return LABELLED.get(category)!;
};

/** Earns a badge once; returns whether it is new. */
function earner(progress: BadgeProgress, fresh: BadgeId[]): (id: BadgeId, when?: boolean) => void {
  return (id, when = true) => {
    if (when && !progress.earned.includes(id)) {
      progress.earned.push(id);
      fresh.push(id);
    }
  };
}

/** Games played: counts a run (by its seed) the first time it is seen. Returns the badges earned just now. */
export function countGame(progress: BadgeProgress, seed: number): BadgeId[] {
  if (progress.lastRun === seed) return [];
  progress.lastRun = seed;
  progress.games++;
  const fresh: BadgeId[] = [];
  const earn = earner(progress, fresh);
  earn('games1', progress.games >= 10);
  earn('games2', progress.games >= 100);
  earn('games3', progress.games >= 500);
  earn('games4', progress.games >= 2000);
  return fresh;
}

/**
 * Looks over the hero and what just happened; returns the badges earned just now, and whether
 * anything else in `progress` changed (so the caller knows to keep it).
 */
export function checkBadges(progress: BadgeProgress, world: World, me: Hero, effects: readonly Effect[]): { fresh: BadgeId[]; changed: boolean } {
  const fresh: BadgeId[] = [];
  let changed = false;
  const remember = (list: string[], value: string): void => {
    if (!list.includes(value)) {
      list.push(value);
      changed = true;
    }
  };
  const earn = earner(progress, fresh);
  const tiers = (ids: readonly BadgeId[], value: number, steps: readonly number[]): void =>
    ids.forEach((id, i) => earn(id, value >= steps[i]!));

  tiers(['slain1', 'slain2', 'slain3', 'slain4'], me.kills, [10, 50, 150, 250]);
  tiers(['gold1', 'gold2', 'gold3', 'gold4'], me.stats?.gold ?? 0, [100, 500, 2500, 7500]);
  tiers(['level1', 'level2', 'level3', 'level4'], me.lvl, [6, 12, 18, 24]);
  tiers(['str1', 'str2', 'str3', 'str4'], me.str, [13, 15, 17, 19]);
  tiers(['food1', 'food2', 'food3', 'food4'], me.stats?.food ?? 0, [10, 20, 30, 40]);
  tiers(['cooked1', 'cooked2', 'cooked3', 'cooked4'], me.stats?.brewed ?? 0, [3, 6, 9, 12]);
  earn('piranhas', (me.stats?.piranhas ?? 0) >= 6);
  // The arena of waves: so many waves held.
  if (world.arena) tiers(['arena5', 'arena10', 'arena20'], wavesCleared(world.arena), [5, 10, 20]);

  const belongings: Item[] = heroBelongings(me);
  // Badges.validateItemLevelAquired: only a level that is known counts.
  const best = Math.max(0, ...belongings.filter(levelKnown).map((item) => item.level));
  tiers(['item1', 'item2', 'item3', 'item4'], best, [3, 6, 9, 12]);
  // Pixel Dungeon's rare rings are Shattered's master thieves' armband and cape of thorns.
  earn('haggler', belongings.some((item) => item.kind === 'artifact.armband'));
  earn('thorns', belongings.some((item) => item.kind === 'artifact.cape'));
  earn('bags', ['bag.seeds', 'bag.scrolls', 'bag.wands'].every((kind) => me.items.some((item) => item.kind === kind)));

  const known = new Set(world.known);
  // (A category with nothing to label, wands here, cannot be completed: an empty set is not all of them.)
  const all = (category: string): boolean => labelled(category).length > 0 && labelled(category).every((kind) => known.has(kind));
  earn('potions', all('potion'));
  earn('scrolls', all('scroll'));
  earn('rings', all('ring'));
  earn('wands', all('wand'));
  earn('allItems', ['potions', 'scrolls', 'rings', 'wands'].every((id) => progress.earned.includes(id as BadgeId)));

  let grimAt = -1;
  for (const effect of effects) {
    if (effect.type === 'combo' && effect.hero === me.id) earn('combo', effect.count >= 7);
    if (effect.type === 'enchanted' && effect.enchant === 'grim') grimAt = effect.pos;
    if (effect.type === 'died' && effect.by === me.id) {
      if (effect.pos === grimAt) earn('grim');
      if (effect.kind && RARE_KINDS.includes(effect.kind)) remember(progress.rare, effect.kind);
    }
    if (effect.type === 'bossSlain' && effect.depth === me.depth && BOSSES[effect.kind]) {
      earn(BOSSES[effect.kind]!);
      if (effect.kind === 'goo') remember(progress.boss1, me.heroClass);
      if (effect.kind === 'dm300' && me.subclass) remember(progress.boss3, me.subclass);
    }
    // Badges.validateVictory: the Amulet in hand.
    if (effect.type === 'amulet' && effect.hero === me.id) earn('victory');
    if (effect.type === 'victory') {
      earn('victory');
      // Badges.validateHappyEnd: out on the surface with it.
      earn('happyEnd', effect.ending === 'surface');
      // Badges.validateChampion: the Amulet taken with a challenge on.
      earn('champion', (world.challenges ?? 0) > 0);
      remember(progress.victories, me.heroClass);
    }
    if (effect.type === 'died' && effect.who === me.id && me.killedBy) {
      const death = DEATHS[me.killedBy];
      if (death) {
        earn(death);
        remember(progress.deaths, death);
      }
    }
  }
  earn('rare', RARE_KINDS.every((kind) => progress.rare.includes(kind)));
  earn('boss1AllClasses', CLASSES.every((cls) => progress.boss1.includes(cls)));
  earn('boss3AllSubclasses', SUBCLASSES.every((way) => progress.boss3.includes(way)));
  earn('victoryAllClasses', CLASSES.every((cls) => progress.victories.includes(cls)));
  earn('yasd', ['deathFire', 'deathPoison', 'deathGas', 'deathHunger'].every((id) => progress.deaths.includes(id)));
  return { fresh, changed: changed || fresh.length > 0 };
}

/** Two players' records of badges as one: every list joined, the count of games the larger. */
export function mergeBadgeProgress(a: BadgeProgress, b: BadgeProgress): BadgeProgress {
  const join = <T>(x: T[] | undefined, y: T[] | undefined): T[] => [...new Set([...(x ?? []), ...(y ?? [])])];
  return {
    earned: join(a.earned, b.earned),
    rare: join(a.rare, b.rare),
    boss1: join(a.boss1, b.boss1),
    boss3: join(a.boss3, b.boss3),
    victories: join(a.victories, b.victories),
    deaths: join(a.deaths, b.deaths),
    games: Math.max(a.games ?? 0, b.games ?? 0),
    ...(a.lastRun || b.lastRun ? { lastRun: Math.max(a.lastRun ?? 0, b.lastRun ?? 0) } : {}),
  };
}
