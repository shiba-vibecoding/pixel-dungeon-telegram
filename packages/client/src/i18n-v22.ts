/*
 * Design v22 (the last package before Shattered): the names of the Cleric's and the talents' new status icons in Shattered's own words,
 * and the few lines the new windows say that Shattered has no text for (the Warden's plants, the score table's short lines, the mis-tap question).
 */

const cap = (text: string): string => (text ? text[0]!.toUpperCase() + text.slice(1) : text);

/** Shattered's tracker or cooldown of each talent status (the order is talent-buffs.png's). */
export const TALENT_BUFF_KEYS = {
  improvised: 'improvisedprojectilecooldown', rejuvenating: 'rejuvenatingstepscooldown', seerShot: 'seershotcooldown',
  patientStrike: 'patientstriketracker', aggressiveBarrier: 'aggressivebarriercooldown', lethalHaste: 'lethalhastecooldown',
  swiftEquip: 'swiftequipcooldown', swiftEquip2: 'swiftequipcooldown', searingLight: 'searinglightcooldown',
  liquidAgility: 'liquidagilacctracker', deadlyFollowup: 'deadlyfollowuptracker', preciseAssault: 'preciseassaulttracker',
  followupStrike: 'followupstriketracker', provokedAnger: 'provokedangertracker', lingeringMagic: 'lingeringmagictracker',
  satiatedSpells: 'satiatedspellstracker',
} as const;

/** The seven Cleric statuses and the key of each one's text (the order is cleric-buffs.png's). */
export const CLERIC_BUFF_KEYS = {
  ascended: 'actors.hero.abilities.cleric.ascendedform$ascendbuff',
  powerOfMany: 'actors.hero.abilities.cleric.powerofmany$powerbuff',
  bodyForm: 'actors.hero.spells.bodyform$bodyformbuff',
  mindForm: 'actors.hero.spells.mindform',
  spiritForm: 'actors.hero.spells.spiritform$spiritformbuff',
  wallOfLight: 'actors.hero.spells.walloflight',
  hallowedGround: 'actors.hero.spells.hallowedground',
} as const;

export type V22BuffName = keyof typeof TALENT_BUFF_KEYS | keyof typeof CLERIC_BUFF_KEYS;

export function buffNames(cls: Record<string, string>, tal: Record<string, string>): Record<V22BuffName, string> {
  const talent = Object.fromEntries(Object.entries(TALENT_BUFF_KEYS).map(([id, key]) => [id, cap(tal[`actors.hero.talent$${key}.name`] ?? id)]));
  const cleric = Object.fromEntries(Object.entries(CLERIC_BUFF_KEYS).map(([id, key]) => [id, cap(cls[`${key}.name`] ?? id)]));
  return { ...talent, ...cleric } as Record<V22BuffName, string>;
}

/** The Warden's plants, by the game's plants: the frame of warden-plants.png and warden-effects.png (WardenPlants). */
export const WARDEN_PLANTS = {
  rotberry: 0, firebloom: 1, swiftthistle: 2, sungrass: 3, icecap: 4, stormvine: 5, sorrowmoss: 6, mageroyal: 7, earthroot: 8, starflower: 9, fadeleaf: 10, blindweed: 11,
} as const;
