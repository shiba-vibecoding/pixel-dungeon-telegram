import {
  artifactKnown, type ArtifactKind, artifactStatus, chargeCap, ghostOf, ghostQuestDone, ghostStrength, type Hero, isWorn, type Item, levelCap,
  SEED_CHARGE, toolkitWarming, type World,
} from '@pd/core';
import { ART_EN, ART_RU } from './i18n-artifacts';
import { lang } from './i18n';

/*
 * The artifacts' texts, Shattered's own (i18n-artifacts.ts): their names and
 * descriptions as the hero sees them, the lines their rules say, and the
 * state their card shows.
 */

/** Each artifact's class in Shattered's message keys. */
export const ARTIFACT_CLASS: Readonly<Record<ArtifactKind, string>> = {
  'artifact.cloak': 'cloakofshadows', 'artifact.horn': 'hornofplenty', 'artifact.chalice': 'chaliceofblood',
  'artifact.hourglass': 'timekeepershourglass', 'artifact.talisman': 'talismanofforesight', 'artifact.spellbook': 'unstablespellbook',
  'artifact.chains': 'etherealchains', 'artifact.rose': 'driedrose', 'artifact.armband': 'masterthievesarmband',
  'artifact.sandals': 'sandalsofnature', 'artifact.cape': 'capeofthorns', 'artifact.toolkit': 'alchemiststoolkit',
  'artifact.beacon': 'lloydsbeacon',
};

const table: Record<string, string> = lang === 'ru' ? ART_RU : ART_EN;

/** Messages.format: %d, %s, %1$d, %2$s… filled in order or by number; %% is a percent sign. */
export function format(text: string, args: ReadonlyArray<string | number> = []): string {
  let next = 0;
  return text.replace(/%(?:(\d+)\$)?([ds%])/g, (_match, index: string | undefined, kind: string) => {
    if (kind === '%') return '%';
    const value = index ? args[Number(index) - 1] : args[next++];
    return value === undefined ? '' : String(value);
  });
}

/** A text by its key (under items.artifacts, or a full key), filled in; '' when there is none. */
export function artText(key: string, args?: ReadonlyArray<string | number>): string {
  const text = table[key];
  return text === undefined ? '' : format(text, args);
}

const capital = (text: string): string => (text ? text[0]!.toUpperCase() + text.slice(1) : text);

/** The artifact's name (the sandals' grow with their level: shoes, boots, greaves). */
export function artifactName(item: Item): string {
  const cls = ARTIFACT_CLASS[item.kind as ArtifactKind];
  if (item.kind === 'artifact.sandals' && item.level > 0) return artText(`${cls}.name_${Math.min(3, item.level)}`);
  return artText(`${cls}.name`);
}

/**
 * Artifact.desc and info, as each artifact tells them: the description, what it does worn (or cursed), what is
 * known of its curse while not worn, and what each keeps (the spellbook's index, the rose's ghost and gear...).
 */
export function artifactInfo(world: World, hero: Hero, item: Item, names: (kind: string) => string): string[] {
  const cls = ARTIFACT_CLASS[item.kind as ArtifactKind];
  const worn = isWorn(hero, item);
  const lines: string[] = [];
  const add = (key: string, args?: ReadonlyArray<string | number>): void => {
    const text = artText(key, args);
    if (text) lines.push(text);
  };
  switch (item.kind as ArtifactKind) {
    case 'artifact.rose':
      if (!ghostQuestDone(world)) {
        add(`${cls}.desc_no_quest`);
        return lines;
      }
      add(`${cls}.desc`);
      if (worn) add(item.cursed ? `${cls}.desc_cursed` : item.level < levelCap(item) ? `${cls}.desc_hint` : '');
      if (item.ghostWeapon) add(`${cls}.desc_weapon`, [names(item.ghostWeapon.kind)]);
      if (item.ghostArmor) add(`${cls}.desc_armor`, [names(item.ghostArmor.kind)]);
      if (item.ghostWeapon || item.ghostArmor) add(`${cls}.desc_strength`, [ghostStrength(item)]);
      break;
    case 'artifact.sandals':
      add(`${cls}.desc_${Math.min(3, item.level) + 1}`);
      if (worn) add(item.cursed ? `${cls}.desc_cursed` : `${cls}.desc_hint`);
      if (item.seedEffect) add(`${cls}.desc_ability`, [names(item.seedEffect), SEED_CHARGE[item.seedEffect] ?? 20]);
      if ((item.seeds ?? []).length > 0) add(`${cls}.desc_seeds`, [item.seeds!.length]);
      break;
    case 'artifact.chalice':
      add(`${cls}.desc`);
      if (worn) add(item.cursed ? `${cls}.desc_cursed` : item.level === 0 ? `${cls}.desc_1` : item.level < levelCap(item) ? `${cls}.desc_2` : `${cls}.desc_3`);
      break;
    case 'artifact.cape':
      add(`${cls}.desc`);
      if (worn) add((item.cooldown ?? 0) === 0 ? `${cls}.desc_inactive` : `${cls}.desc_active`);
      break;
    case 'artifact.toolkit':
      add(`${cls}.desc`);
      if (worn) add(item.cursed ? `${cls}.desc_cursed` : (item.warmUp ?? 0) > 0 ? `${cls}.desc_warming` : `${cls}.desc_hint`);
      break;
    case 'artifact.spellbook': {
      add(`${cls}.desc`);
      if (worn && item.cursed) add(`${cls}.desc_cursed`);
      const index = item.scrolls;
      if (worn && item.level < levelCap(item) && index && index.length > 0) {
        add(`${cls}.desc_index`);
        lines.push(index.slice(0, 2).map(names).join(', '));
      }
      if (item.level > 0) add(`${cls}.desc_empowered`);
      break;
    }
    case 'artifact.beacon':
      add(`${cls}.desc`);
      if (item.returnTo) add(`${cls}.desc_set`, [item.returnTo.depth]);
      break;
    default:
      add(`${cls}.desc`);
      if (worn) {
        const hint = item.cursed ? `${cls}.desc_cursed`
          : item.kind === 'artifact.talisman' || item.kind === 'artifact.armband' ? `${cls}.desc_worn`
          : item.kind === 'artifact.chains' ? `${cls}.desc_equipped`
          : item.level < levelCap(item) ? `${cls}.desc_hint` : '';
        if (hint) add(hint);
      }
  }
  // Artifact.info: what is known of its curse while it is not worn.
  if (!worn && item.cursed && !item.curseUnknown) add('artifact.curse_known');
  else if (!worn && !artifactKnown(item) && !item.curseUnknown) add('artifact.not_cursed');
  return lines;
}

/** What the slot and the card show of an artifact's charge: the share of it (0-1) and its text, or null. */
export function chargeOf(world: World, hero: Hero, item: Item): { share: number; text: string; full: boolean } | null {
  // DriedRose.status: the ghost's health while it is out.
  const ghost = item.kind === 'artifact.rose' ? ghostOf(world, item) : undefined;
  if (ghost) {
    const share = ghost.hp / ghost.ht;
    return { share, text: `${Math.trunc((ghost.hp * 100) / ghost.ht)}%`, full: ghost.hp >= ghost.ht };
  }
  // AlchemistsToolkit.status: warming up.
  const warming = item.kind === 'artifact.toolkit' ? toolkitWarming(hero, item) : null;
  if (warming !== null) return { share: warming / 100, text: `${warming}%`, full: false };
  const text = artifactStatus(item);
  if (text === null) return null;
  const cap = chargeCap(item);
  const charge = item.charge ?? 0;
  // The chains' soft cap: charge past it shows as full.
  const soft = item.kind === 'artifact.chains' ? 5 + item.level * 2 : cap;
  const share = (item.cooldown ?? 0) > 0 ? 1 : soft > 0 ? Math.min(1, charge / soft) : 0;
  return { share, text, full: soft > 0 && charge >= soft };
}

/** The card's state line: what the artifact is doing now. */
export function artifactState(world: World, hero: Hero, item: Item): { text: string; on: boolean } | null {
  const ru = table === ART_RU;
  if (item.stealth) return { text: ru ? 'Вы невидимы.' : 'You are invisible.', on: true };
  if (item.freeze) return { text: artText('timekeepershourglass$timefreeze.name'), on: true };
  if ((hero.stasis ?? 0) > 0 && item.kind === 'artifact.hourglass') return { text: ru ? 'Вы вне времени.' : 'You are in stasis.', on: true };
  if (item.kind === 'artifact.rose' && ghostOf(world, item)) return { text: ru ? 'Призрак рядом с вами.' : 'The ghost is by your side.', on: true };
  if (item.kind === 'artifact.cape' && (item.cooldown ?? 0) > 0) return { text: artText('capeofthorns.desc_active'), on: true };
  if (item.kind === 'artifact.toolkit') {
    const warming = toolkitWarming(hero, item);
    if (warming !== null) return { text: artText('alchemiststoolkit.desc_warming'), on: false };
  }
  const charge = chargeOf(world, hero, item);
  if (charge?.full) return { text: ru ? 'Заряжен полностью' : 'Fully charged', on: true };
  return null;
}

export { capital };
