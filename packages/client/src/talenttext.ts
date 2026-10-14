import { berserkOf, comboOf, type Hero, momentumOf, pointsInTalent, type SubClass, type TalentId, TALENTS } from '@pd/core';
import { talentLevels as armorTalentLevels, talentTitle as armorTalentTitle } from './abilitytext';
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
/** (The fourth tier's, the armour abilities', are the abilities' texts.) */
const isArmorTalent = (id: string): boolean => Object.hasOwn(TALENTS, id) && TALENTS[id as TalentId].tier === 4;
export const talentTitle = (id: TalentId | string): string => (isArmorTalent(id) ? armorTalentTitle(id as TalentId) : tal(`actors.hero.talent.${id}.title`) || String(id));

/** Talent.desc(metamorphed): the description, and the metamorphosis note when it was swapped in. */
export function talentDesc(id: TalentId | string, metamorphed = false): string {
  const desc = tal(`actors.hero.talent.${id}.desc`);
  const meta = metamorphed ? tal(`actors.hero.talent.${id}.meta_desc`) : '';
  return meta ? `${desc}\n\n${meta}` : desc;
}

/** A talent's description cut at «_+N:_» into what each point gives; text before the first (a lead) is returned as `lead`. */
export function talentLevels(id: TalentId | string, max: number): { lead: string; levels: string[] } {
  if (isArmorTalent(id)) {
    const { intro, levels } = armorTalentLevels(id as TalentId);
    return { lead: intro, levels: Array.from({ length: max }, (_, i) => levels[i] ?? '') };
  }
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

/** The longer text of a talent's or subclass's buff (its Shattered description), for the window a tap on its icon opens; '' for the rest. */
export function talentBuffInfo(hero: Hero, name: string, turns?: number): string {
  const rage = berserkOf(hero);
  const combo = comboOf(hero);
  const momentum = momentumOf(hero);
  const points = (id: TalentId): number => pointsInTalent(hero, id);
  switch (name) {
    case 'berserk':
      return rage ? tal('actors.buffs.berserk.angered_desc', Math.floor(rage.power * 100), Math.floor(Math.min(0.5, rage.power / 2) * 100),
        Math.round((8 + 2 * (hero.armor.level ?? 0)) * (1 + 2 * (1 - hero.hp / hero.ht) ** 3))) : '';
    case 'berserking':
      return tal('actors.buffs.berserk.berserk_desc', rage?.shield ?? 0);
    case 'exhausted':
      return rage ? `${tal('actors.buffs.berserk.recovering_desc')}\n\n${rage.levelRecovery > 0
        ? tal('actors.buffs.berserk.recovering_desc_levels', rage.levelRecovery.toFixed(2)) : tal('actors.buffs.berserk.recovering_desc_turns', rage.turnRecovery)}` : '';
    case 'comboChain':
      return combo ? tal('actors.buffs.combo.desc', combo.count, Math.ceil(combo.time)) : '';
    case 'momentum':
      return momentum ? (momentum.freerunCooldown > 0 && momentum.stacks === 0 ? tal('actors.buffs.momentum.resting_desc', momentum.freerunCooldown)
        : tal('actors.buffs.momentum.momentum_desc', momentum.stacks)) : '';
    case 'freerunning':
      return tal('actors.buffs.momentum.running_desc', momentum?.freerunTurns ?? 0);
    case 'preparation':
      return tal('actors.buffs.preparation.desc') + `\n\n${tal('actors.buffs.preparation.desc_invis_time', hero.tal?.prep ?? 0)}`;
    case 'sniperMark':
      return tal('actors.buffs.snipersmark.desc', turns ?? 0);
    case 'holdFast':
      return tal('actors.buffs.holdfast.desc', points('hold_fast'), 2 * points('hold_fast'), 25 + 25 * points('hold_fast'));
    case 'wandEmpower':
      return hero.tal?.wandEmpower ? tal('actors.buffs.wandempower.desc', hero.tal.wandEmpower.boost, hero.tal.wandEmpower.left)
        : tal('actors.buffs.scrollempower.desc', 2, hero.tal?.scrollEmpower ?? 0);
    case 'trackerBlow':
      return tal('actors.hero.talent$provokedangertracker.desc', turns ?? 0);
    case 'followup':
      return tal('actors.hero.talent$followupstriketracker.desc', turns ?? 0);
    case 'cooldown':
      return tal('actors.hero.talent$improvisedprojectilecooldown.desc', turns ?? 0);
    default:
      return '';
  }
}
