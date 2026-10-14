import { type Hero, heroStr } from '../actors';
import { pointsInTalent } from '../talents/data';
import { empowered } from './monk';
import type { SpellId } from './cleric-core';
import { bodyDuration, artifactLevel, mindLevel, ringLevel } from './trinity';

/*
 * The numbers Shattered puts in its descriptions (each spell's desc(), the Monk's abilities'), computed from the hero as it does,
 * for the client to fill into the messages.
 */

/** The arguments of a spell's description (ClericSpell.desc of each spell), in the order its message takes them. */
export function spellDescArgs(hero: Hero, id: SpellId): number[] {
  const p = (talent: Parameters<typeof pointsInTalent>[1]): number => pointsInTalent(hero, talent);
  switch (id) {
    case 'auraOfProtection': return [10 + 10 * p('aura_of_protection'), 25 + 25 * p('aura_of_protection')];
    case 'beamingRay': return [4 * p('beamingRay'), 30 + 5 * p('beamingRay')];
    case 'bless': return [2 + 4 * p('bless'), 5 + 5 * p('bless'), 5 + 5 * p('bless'), 5 + 5 * p('bless')];
    case 'bodyForm': return [bodyDuration(hero)];
    case 'cleanse': {
      let immunity = 2 * (p('cleanse') - 1);
      if (immunity > 0) immunity++;
      return [immunity, 10 * p('cleanse')];
    }
    case 'divineIntervention': return [100 + 50 * p('divineIntervention'), 2 + p('divineIntervention')];
    case 'divineSense': return [4 + 4 * p('divine_sense')];
    case 'hallowedGround': return [1 + 2 * p('hallowed_ground')];
    case 'holyLance': return [15 + 15 * p('holy_lance'), Math.round(27.5 + 27.5 * p('holy_lance'))];
    case 'judgement': {
      const base = 5 + 5 * p('judgement');
      const total = base + (hero.cls?.ascend ? Math.round((base * hero.cls.ascend.spellCasts) / 3) : 0);
      return [base, 2 * base, total, 2 * total];
    }
    case 'layOnHands': return [10 + 5 * p('lay_on_hands')];
    case 'lifeLink': return [4 + 2 * p('lifeLink'), 30 + 5 * p('lifeLink')];
    case 'mindForm': return [mindLevel(hero)];
    case 'mnemonicPrayer': return [2 + p('mnemonic_prayer')];
    case 'recallInscription': return [p('recall_inscription') === 2 ? 300 : 10];
    case 'shieldOfLight': return [1 + p('shield_of_light'), 2 * (1 + p('shield_of_light'))];
    case 'smite': return [5 + Math.trunc(hero.lvl / 2), 10 + hero.lvl];
    case 'spiritForm': return [ringLevel(hero), artifactLevel(hero)];
    case 'stasis': return [30 + 30 * p('stasis')];
    case 'sunray': return p('sunray') === 2 ? [6, 12, 6] : [4, 8, 4];
    case 'wallOfLight': return [1 + 2 * p('wall_of_light')];
    default: return [];
  }
}

/** The paragraphs a spell's description adds for the hero's subclass (GuidingLight's desc_priest, HolyWard's and HolyWeapon's desc_paladin). */
export function spellDescExtra(hero: Hero, id: SpellId): string | undefined {
  if (id === 'guidingLight' && hero.subclass === 'priest') return 'desc_priest';
  if ((id === 'holyWard' || id === 'holyWeapon') && hero.subclass === 'paladin') return 'desc_paladin';
  return undefined;
}

/** The arguments of a Monk ability's description: the damage of its blows is a multiple of an unarmed hit (STR - 8). */
export function monkDescArgs(hero: Hero, ability: string): number[] {
  const str = heroStr(hero) - 8;
  const power = empowered(hero);
  if (ability === 'flurry') return [2, Math.round(1.5 * str)];
  if (ability === 'kick') return power ? [9, 9 * str] : [6, 6 * str];
  return [];
}
