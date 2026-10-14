// Generates packages/client/src/i18n-classes.ts from Shattered Pixel Dungeon's message files: the Duelist's and the
// Cleric's texts — their class and subclass blurbs, talents, armour abilities, spells, buffs, the weapons' abilities,
// the holy tome and the windows they use — in English and Russian, keyed as there (lower case, full keys).
// Usage: node packages/client/scripts/gen-class-texts.mjs [path/to/spd-src]
// Default source: ../spd-src (next to pd-ts). The output is committed; the message files are only a reference.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const spd = resolve(process.argv[2] ?? resolve(here, '../../../../spd-src'));
const messages = resolve(spd, 'core/src/main/assets/messages');
const out = resolve(here, '../src/i18n-classes.ts');

/** The talents of the two classes (tiers 1-4, subclasses, armour abilities) and the universal ones they share. */
const TALENTS = [
  'strengthening_meal', 'adventurers_intuition', 'patient_strike', 'aggressive_barrier', 'focused_meal', 'liquid_agility', 'weapon_recharging',
  'lethal_haste', 'swift_equip', 'precise_assault', 'deadly_followup', 'varied_charge', 'twin_upgrades', 'combined_lethality',
  'unencumbered_spirit', 'monastic_vigor', 'combined_energy', 'close_the_gap', 'invigorating_victory', 'elimination_match', 'elemental_reach',
  'striking_force', 'directed_power', 'feigned_retreat', 'expose_weakness', 'counter_ability',
  'satiated_spells', 'holy_intuition', 'searing_light', 'shield_of_light', 'enlightening_meal', 'recall_inscription', 'sunray', 'divine_sense',
  'bless', 'cleanse', 'light_reading', 'holy_lance', 'hallowed_ground', 'mnemonic_prayer', 'lay_on_hands', 'aura_of_protection', 'wall_of_light',
  'divine_intervention', 'judgement', 'flash', 'body_form', 'mind_form', 'spirit_form', 'beaming_ray', 'life_link', 'stasis', 'heroic_energy',
];
/** Whole classes of keys (prefixes of the lower-cased key), kept as they are. */
const PREFIXES = [
  'actors.hero.heroclass.duelist', 'actors.hero.heroclass.cleric',
  'actors.hero.herosubclass.champion', 'actors.hero.herosubclass.monk', 'actors.hero.herosubclass.priest', 'actors.hero.herosubclass.paladin',
  'actors.hero.abilities.armorability', 'actors.hero.abilities.duelist.', 'actors.hero.abilities.cleric.',
  'actors.hero.spells.',
  'actors.hero.hero.new_talent', 'actors.hero.hero.unspent', 'actors.hero.hero.level_up',
  'actors.buffs.monkenergy', 'actors.buffs.greaterhaste', 'actors.buffs.physicalempower', 'actors.buffs.haste.', 'actors.buffs.barrier.',
  'actors.buffs.vulnerable.', 'actors.buffs.weakness.', 'actors.buffs.invulnerability.', 'actors.buffs.lifelink', 'actors.buffs.bless.',
  'actors.buffs.recharging.', 'actors.buffs.artifactrecharge.', 'actors.buffs.cleansing', 'actors.buffs.doom.', 'actors.buffs.bleeding.',
  'actors.buffs.cripple.', 'actors.buffs.paralysis.', 'actors.buffs.charm.', 'actors.buffs.invisibility.', 'actors.buffs.combo',
  'items.weapon.melee.', 'items.weapon.weapon.', 'items.weapon.enchantments.', 'items.artifacts.holytome',
  'items.armor.duelistarmor', 'items.armor.clericarmor', 'items.armor.classarmor', 'items.armor.armor.',
  'windows.wndclericspells', 'windows.wndmonkabilities', 'windows.wndhero', 'windows.wndinfotalent', 'windows.wndchooseability',
  'windows.wndheroinfo',
  'items.kindofweapon.', 'items.rings.ringofforce$brawlersstance', 'items.rings.ringofforce.ability',
  'actors.mobs.npcs.', 
];
/** Keys of the talents: actors.hero.talent.<name>.* */
const wanted = (key) => {
  if (key.startsWith('actors.hero.talent.')) {
    const name = key.slice('actors.hero.talent.'.length).split(/[.$]/)[0];
    return TALENTS.includes(name) || name.endsWith('tracker') || name.endsWith('cooldown');
  }
  if (key.startsWith('actors.mobs.npcs.')) return false;
  return PREFIXES.some((p) => key.startsWith(p));
};

function read(file) {
  const map = new Map();
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const at = line.indexOf('=');
    if (at <= 0 || line.startsWith('#')) continue;
    map.set(line.slice(0, at).trim().toLowerCase(), line.slice(at + 1));
  }
  return map;
}

/** Shattered's markup: \n for a new line, _highlight_ (plain here), '' for a quote in MessageFormat. */
const clean = (text) => text.replace(/\\+n/g, '\n').replace(/\\u([0-9a-fA-F]{4})/g, (_m, h) => String.fromCharCode(parseInt(h, 16)))
  .replace(/_([^_\n]+)_/g, '$1').replace(/\\'/g, "'");

function texts(lang) {
  const suffix = lang === 'en' ? '' : `_${lang}`;
  const all = new Map([
    ...read(resolve(messages, `items/items${suffix}.properties`)),
    ...read(resolve(messages, `actors/actors${suffix}.properties`)),
    ...read(resolve(messages, `windows/windows${suffix}.properties`)),
  ]);
  const result = {};
  for (const [key, value] of all) if (wanted(key)) result[key] = clean(value);
  return result;
}

const en = texts('en');
const ru = texts('ru');
for (const key of Object.keys(en)) ru[key] ??= en[key];
const body = (obj) => Object.keys(en).sort().map((key) => `  ${JSON.stringify(key)}: ${JSON.stringify(obj[key])},`).join('\n');

// One file for each language: the page loads only the one it shows (see i18n.ts).
const header = `// Generated by packages/client/scripts/gen-class-texts.mjs from Shattered Pixel Dungeon's message files
// (core/src/main/assets/messages, GPL-3.0): the Duelist's and the Cleric's texts, keyed as there (lower case). Do not edit by hand.

`;
writeFileSync(out, `${header}export const CLS_EN: Record<string, string> = {
${body(en)}
};
`);
// Shattered's Russian file has a typo here; the game says it right.
for (const key of Object.keys(ru)) ru[key] = ru[key].replace('Усиляющий', 'Усиливающий');
writeFileSync(out.replace(/\.ts$/, '.ru.ts'), `${header}export const CLS_RU: Record<string, string> = {
${body(ru)}
};
`);
console.log(`${Object.keys(en).length} texts written to ${out}`);
