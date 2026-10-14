import type { Hero } from '../actors';
import type { Ctx } from '../floor';
import type { World } from '../world';
import { deriveSeed, Rng, Stream } from '../rng';
import {
  CLASS_TALENTS, pointsInTalent, readBook, talentBook, type TalentId,
} from './data';
import { onTalentUpgraded } from './index';
import { tbOf } from './state';

/*
 * ScrollOfMetamorphosis (items/scrolls/exotic): a class talent of the hero's tiers 1 to 3 is swapped for one of the same
 * tier from another class, keeping its points. The scroll offers the hero's class talents (WndMetamorphChoose), then up to
 * one random talent of the tier from each other class (WndMetamorphReplace). The options are drawn from a stream of the
 * run so that the window and the rules agree on them. SEAM(classes): the Duelist's and the Cleric's talents join the
 * pools when those classes come (CLASS_TALENTS).
 */

/** A class talent the hero may replace: its tier and the points in it. */
export interface MetamorphTarget {
  tier: number;
  talent: TalentId;
  points: number;
}

/** Talent.initClassTalents with the replacements: the hero's class talents of tiers 1 to 3 as they stand now. */
export function metamorphTargets(hero: Hero): MetamorphTarget[] {
  const book = readBook(hero);
  const targets: MetamorphTarget[] = [];
  for (let i = 0; i < 3; i++) {
    for (const original of CLASS_TALENTS[hero.heroClass][i]!) {
      const talent = (book.replaced?.[original] ?? original) as TalentId;
      targets.push({ tier: i + 1, talent, points: pointsInTalent(hero, talent) });
    }
  }
  return targets;
}

/** Options per target a choice can name. */
export const METAMORPH_OPTIONS = 8;

/**
 * WndMetamorphReplace: for each class, one random talent of the tier the hero does not have (the class that holds the replaced
 * talent offers none).
 */
export function metamorphOptions(world: World, hero: Hero, target: MetamorphTarget): TalentId[] {
  const book = readBook(hero);
  const current = Object.keys(book.tiers[target.tier - 1]!);
  const rng = Rng.seeded(deriveSeed(world.run.seed, Stream.PLAY, hero.lvl, tbOf(hero).metamorphs ?? 0, target.tier, target.talent.length));
  const options: TalentId[] = [];
  for (const cls of Object.keys(CLASS_TALENTS) as Array<keyof typeof CLASS_TALENTS>) {
    const pool = [...CLASS_TALENTS[cls][target.tier - 1]!];
    let holdsReplaced = false;
    for (const talent of [...pool]) {
      if (talent === target.talent) {
        holdsReplaced = true;
        break;
      }
      if (current.includes(talent)) pool.splice(pool.indexOf(talent), 1);
    }
    if (!holdsReplaced && pool.length > 0) options.push(rng.element(pool)!);
  }
  return options;
}

/** Why a scroll of metamorphosis cannot do what `choice` (target * 8 + option) says, or null. */
export function metamorphProblem(world: World, hero: Hero, choice: number | undefined): string | null {
  if (choice === undefined) return 'choose a talent';
  const target = metamorphTargets(hero)[Math.trunc(choice / METAMORPH_OPTIONS)];
  if (!target) return 'choose a talent';
  return metamorphOptions(world, hero, target)[choice % METAMORPH_OPTIONS] ? null : 'choose a talent';
}

/** TalentButton (METAMORPH_REPLACE) and ScrollOfMetamorphosis.onMetamorph: the swap, in place, keeping the points. */
export function metamorph(ctx: Ctx, hero: Hero, choice: number): void {
  const target = metamorphTargets(hero)[Math.trunc(choice / METAMORPH_OPTIONS)]!;
  const replacement = metamorphOptions(ctx.world, hero, target)[choice % METAMORPH_OPTIONS]!;
  const book = talentBook(hero);
  const tier = book.tiers[target.tier - 1]!;
  const next: Record<string, number> = {};
  for (const [id, points] of Object.entries(tier)) next[id === target.talent ? replacement : id] = points;
  book.tiers[target.tier - 1] = next;
  const replaced = (book.replaced ??= {});
  const originals = Object.keys(replaced);
  if (!Object.values(replaced).includes(target.talent)) {
    replaced[target.talent] = replacement;
  } else if (replaced[replacement] === target.talent) {
    // a -> b -> a: the entry goes.
    delete replaced[replacement];
  } else {
    // a -> b -> c: simplified to a -> c.
    for (const key of originals) if (replaced[key] === target.talent) replaced[key] = replacement;
  }
  tbOf(hero).metamorphs = (tbOf(hero).metamorphs ?? 0) + 1;
  ctx.effects.push({ type: 'metamorphed', hero: hero.id, from: target.talent, to: replacement });
  if (pointsInTalent(hero, replacement) > 0) onTalentUpgraded(ctx, hero, replacement);
}
