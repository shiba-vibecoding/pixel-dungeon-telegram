import type { Hero } from '../actors';
import type { Ctx } from '../floor';
import { chargerTurn } from './charger';
import { comboTurn } from './duelist';
import { monkTurn } from './monk';
import { classArmorTurn } from './abilities';
import { tomeTurn } from './cleric-core';
import { hallowedTurn, wallTurn } from './cleric-spells';
import { ascendTurn, stasisTurn } from './cleric-t4';
import { cs } from './state';
import { trinityTurn } from './trinity';

/** Everything of the classes that acts once a turn (the buffs of Shattered with an act()): the Charger, trackers, the tome, the class armour. */
export function classTurn(ctx: Ctx, hero: Hero): void {
  // GreaterHaste.act: its moves run out by the turn too.
  if ((hero.cls?.greaterHaste ?? 0) > 0 && --hero.cls!.greaterHaste! <= 0) delete hero.cls!.greaterHaste;
  if (hero.heroClass === 'duelist') {
    chargerTurn(ctx, hero);
    comboTurn(hero);
    monkTurn(hero);
    // RingOfForce.BrawlersStance.act: a stance let go of ends once it has lasted fifty turns.
    const stance = hero.cls?.brawl;
    if (stance) {
      stance.min--;
      if (!stance.active && stance.min <= 0) delete cs(hero).brawl;
    }
  }
  if (hero.heroClass === 'cleric') {
    tomeTurn(ctx, hero);
    ascendTurn(ctx, hero);
    stasisTurn(ctx, hero);
    wallTurn(ctx);
    hallowedTurn(ctx, hero);
    trinityTurn(ctx, hero);
  }
  classArmorTurn(ctx, hero);
}
