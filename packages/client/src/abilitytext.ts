import { ABILITIES, type AbilityKind, abilityChargeUse, type Hero, type Talent, wornClassArmor, type World, staffWandOf } from '@pd/core';
import { artText } from './artifacttext';
import { lang } from './i18n';

/*
 * The armour abilities' texts, Shattered's own (i18n-abilities.ts): names, descriptions, the talents'
 * titles and what each level of them does; and the few lines of the windows that are ours.
 */

const strings = {
  en: {
    tier: 'Tier 4', free: 'free', later: "I'll decide later", choose: 'Choose', random: 'Random', info: 'Details', back: 'Back',
    abilityHead: 'Armor ability', talents: 'Talents', noTalents: 'Choose an armor ability to unlock tier 4 talents.',
    lockPoints: 'From level 21 each level gives a point.', improve: 'Upgrade', maxed: 'At its best', noPoints: 'No free points in tier 4 yet',
    pointsLeft: (n: number) => `Points to spend in tier 4: ${n}`, of: (n: number, max: number) => `${n} of ${max}`,
    charge: 'Charge', cost: (n: string) => `Charge cost: ${n}`, free0: 'Costs no charge',
    transferHead: 'Transfer armor', talentsShort: 'Talents', tapToRead: 'Tap a talent to read it',
    abilityDesc: 'Armor ability', noAbility: 'No ability chosen',
    markedTitle: 'Marked for death', deathMarkDesc: 'This enemy has been marked: it takes 25% more damage, and cannot die until the mark ends.',
    endureTitle: 'Endurance', endureDesc: (bonus: number, hits: number) => `The Warrior is now dealing bonus damage based on the damage he endured.\n\nBonus Damage: ${bonus}\nHits Left: ${hits}`,
    natureTitle: "Nature's power", natureDesc: (turns: number) => `The Huntress is briefly empowered, increasing her movement speed and attack speed with her bow.\n\nTurns remaining: ${turns}.`,
    hawkTurns: (n: number) => `Turns remaining: ${n}.`, hawkDodges: (n: number) => `Guaranteed dodges remaining: ${n}.`,
    beaconDepth: (n: number) => `Your beacon is currently placed on floor ${n}.`,
    beaconTitle: 'Warp beacon', warp: 'Teleport to beacon', clear: 'Clear beacon', cancel: 'Cancel',
    sure: 'Are you sure you want to choose this ability?', yes: "Yes, I've made my choice.", no: "No, I'll decide later.",
    randomTitle: 'Random armor ability', randomSure: 'Are you sure you want to choose your armor ability randomly?',
    noArmor: 'You have no other armor in your pack.', pickTransfer: 'Select an armor', talentsHint: 'Tier 4 talents of the ability',
  },
  ru: {
    tier: 'Ярус 4', free: 'свободно', later: 'Решу позже', choose: 'Выбрать', random: 'Наугад', info: 'Подробнее', back: 'Назад',
    abilityHead: 'Способность брони', talents: 'Таланты', noTalents: 'Выберите способность брони, и откроются таланты 4 яруса.',
    lockPoints: 'С 21 уровня каждый уровень даёт очко.', improve: 'Улучшить', maxed: 'Достиг предела', noPoints: 'Свободных очков 4 яруса пока нет',
    pointsLeft: (n: number) => `Очков 4 яруса осталось: ${n}`, of: (n: number, max: number) => `${n} из ${max}`,
    charge: 'Заряд', cost: (n: string) => `Расход заряда: ${n}`, free0: 'Заряд не тратится',
    transferHead: 'Перенос умения', talentsShort: 'Таланты', tapToRead: 'Касание по таланту — описание',
    abilityDesc: 'Способность брони', noAbility: 'Способность не выбрана',
    markedTitle: 'Отмечен для смерти', deathMarkDesc: 'Этот враг отмечен: он получает на 25% больше урона и не может умереть, пока метка не пропадёт.',
    endureTitle: 'Выносливость', endureDesc: (bonus: number, hits: number) => `Воин наносит дополнительный урон, равный тому, что он вытерпел.\n\nДоп. урон: ${bonus}\nУдаров осталось: ${hits}`,
    natureTitle: 'Сила природы', natureDesc: (turns: number) => `Охотница на время получает силу природы: она быстрее передвигается и чаще стреляет из лука.\n\nХодов осталось: ${turns}.`,
    hawkTurns: (n: number) => `Ходов осталось: ${n}.`, hawkDodges: (n: number) => `Гарантированных уклонений: ${n}.`,
    beaconDepth: (n: number) => `Ваш маяк сейчас установлен на ${n}-м этаже.`,
    beaconTitle: 'Маяк перемещения', warp: 'Телепортироваться к маяку', clear: 'Убрать маяк', cancel: 'Отмена',
    sure: 'Вы уверены, что хотите выбрать эту способность?', yes: 'Да, я сделал свой выбор.', no: 'Нет, решу позже.',
    randomTitle: 'Случайная способность брони', randomSure: 'Вы уверены, что хотите выбрать способность брони случайно?',
    noArmor: 'В рюкзаке нет другой брони.', pickTransfer: 'Выберите броню', talentsHint: 'Таланты 4 яруса этой способности',
  },
} as const;

export const AT = strings[lang === 'ru' ? 'ru' : 'en'];

const capital = (text: string): string => (text ? text[0]!.toUpperCase() + text.slice(1) : text);

/** The key of an ability's messages: actors.hero.abilities.<class>.<name>. */
const keyOf = (kind: AbilityKind): string => `actors.hero.abilities.${ABILITIES[kind].key}`;

export const abilityName = (kind: AbilityKind): string => artText(`${keyOf(kind)}.name`);
export const abilityShort = (kind: AbilityKind): string => artText(`${keyOf(kind)}.short_desc`);

/** The tier 4 glow colour of an ability's card (its hero_icons frame is ABILITIES[kind].icon). */
export const ABILITY_GLOW: Readonly<Record<AbilityKind, string>> = {
  heroicLeap: '#ffcc66', shockwave: '#ff9933', endure: '#ff6a4a',
  elementalBlast: '#ff9a4a', wildMagic: '#c070ff', warpBeacon: '#6ec8ff',
  smokeBomb: '#a8a8bc', deathMark: '#ff5050', shadowClone: '#8c7ad0',
  spectralBlades: '#7fe0e0', naturesPower: '#6fd06f', spiritHawk: '#78b8ff',
};

/** ArmorAbility.desc: what it does and what it costs; the blast adds what the staff's wand makes of it. */
export function abilityDesc(kind: AbilityKind, hero?: Hero): string {
  const base = artText(`${keyOf(kind)}.desc`);
  const cost = artText('actors.hero.abilities.armorability.cost', [ABILITIES[kind].baseCharge]);
  if (kind === 'elementalBlast') {
    const wand = hero ? staffWandOf(hero) : undefined;
    const more = wand ? artText(`items.wands.wandof${wand.kind.slice(5).toLowerCase()}.eleblast_desc`) : '';
    return `${base}\n\n${more || artText('actors.hero.abilities.mage.elementalblast.generic_desc')}\n\n${cost}`;
  }
  return `${base}\n\n${cost}`;
}

/** Talent id to Shattered's key (bodySlam to body_slam). */
const snake = (talent: Talent): string => talent.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

export const talentTitle = (talent: Talent): string => artText(`actors.hero.talent.${snake(talent)}.title`);

/** Talent.desc split: an introduction, if any, and what each level does (the text has «+1: …» paragraphs). */
export function talentLevels(talent: Talent): { intro: string; levels: string[] } {
  const text = artText(`actors.hero.talent.${snake(talent)}.desc`);
  const intro: string[] = [];
  const levels: string[] = [];
  for (const paragraph of text.split('\n\n')) {
    const match = /^\+(\d):\s*([\s\S]*)$/.exec(paragraph);
    if (match) levels[Number(match[1]) - 1] = match[2]!;
    else if (levels.length === 0) intro.push(paragraph);
  }
  return { intro: intro.join('\n\n'), levels };
}

/** ArmorAbility.chargeUse as the card shows it (the cost to use it now). */
export function chargeText(world: World | undefined, hero: Hero, kind: AbilityKind): string {
  const use = abilityChargeUse(world, hero, kind);
  return Number.isInteger(use) ? String(use) : use.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

/** The class armour's charge, a percentage as ClassArmor.status shows it. */
export function armorStatus(item: { charge?: number }): string {
  return `${Math.floor(item.charge ?? 0)}%`;
}

export { capital, wornClassArmor };
