import type { SubClass, TalentId } from '@pd/core';
import { fill, lang } from './i18n';
import { TAL_EN, TAL_RU } from './i18n-talents';

/*
 * The talents' and subclasses' texts, Shattered's own (i18n-talents.ts): names, descriptions cut into levels, the lines of
 * the buffs they bring and of the windows that show them.
 */

const table: Record<string, string> = lang === 'ru' ? TAL_RU : TAL_EN;

/** A text by its key in Shattered's message files; '' when there is none. */
export function tal(key: string, ...args: Array<string | number>): string {
  const text = table[key];
  return text === undefined ? '' : fill(text, ...args);
}

/** Talent.title. */
export const talentTitle = (id: TalentId | string): string => tal(`actors.hero.talent.${id}.title`) || String(id);

/** Talent.desc(metamorphed): the description, and the metamorphosis note when it was swapped in. */
export function talentDesc(id: TalentId | string, metamorphed = false): string {
  const desc = tal(`actors.hero.talent.${id}.desc`);
  const meta = metamorphed ? tal(`actors.hero.talent.${id}.meta_desc`) : '';
  return meta ? `${desc}\n\n${meta}` : desc;
}

/** A talent's description cut at «_+N:_» into what each point gives; text before the first (a lead) is returned as `lead`. */
export function talentLevels(id: TalentId | string, max: number): { lead: string; levels: string[] } {
  const text = tal(`actors.hero.talent.${id}.desc`);
  const parts = text.split(/_\+(\d):_\s*/);
  const lead = parts[0]!.trim();
  const levels: string[] = new Array<string>(max).fill('');
  for (let i = 1; i + 1 < parts.length; i += 2) {
    const n = Number(parts[i]);
    if (n >= 1 && n <= max) levels[n - 1] = parts[i + 1]!.trim();
  }
  return { lead, levels };
}

/** Emphasis in Shattered's texts: _text_ is highlighted. */
export function emphasized(text: string): Array<Node | string> {
  const nodes: Array<Node | string> = [];
  text.split(/_([^_]+)_/).forEach((part, i) => {
    if (part === '') return;
    if (i % 2 === 1) {
      const em = document.createElement('em');
      em.textContent = part;
      nodes.push(em);
    } else nodes.push(part);
  });
  return nodes;
}

/** HeroSubClass.title, shortDesc and desc. */
export const subclassName = (way: SubClass): string => tal(`actors.hero.herosubclass.${way}`) || way;
export const subclassShort = (way: SubClass): string => tal(`actors.hero.herosubclass.${way}_short_desc`);
export const subclassDesc = (way: SubClass): string => tal(`actors.hero.herosubclass.${way}_desc`);

/** The text with its emphasis marks taken out (for a plain place). */
export const plain = (text: string): string => text.replace(/_([^_]+)_/g, '$1');

/** The core's lines for the log (Effect `tmsg`) and the reasons it refuses with («tal:buff.line»), as Shattered says them. */
const MESSAGES: Readonly<Record<string, string>> = {
  'wand_preservation.preserved': 'items.weapon.melee.magesstaff.preserved',
  'rogues_foresight.hint': 'scenes.gamescene.secret_hint',
};

export function talentMessage(key: string, ...args: Array<string | number>): string {
  const full = MESSAGES[key];
  return full ? tal(full, ...args) : '';
}

/** A refusal that is one of Shattered's lines («tal:combo.bad_target»), or ''. */
export function talentReason(reason: string): string {
  return reason.startsWith('tal:') ? tal(`actors.buffs.${reason.slice(4)}`) : '';
}
