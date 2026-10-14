import { CLS_EN, CLS_RU } from './i18n-classes';
import { TAL_EN, TAL_RU } from './i18n-talents';

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

function buffNames(cls: Record<string, string>, tal: Record<string, string>): Record<V22BuffName, string> {
  const talent = Object.fromEntries(Object.entries(TALENT_BUFF_KEYS).map(([id, key]) => [id, cap(tal[`actors.hero.talent$${key}.name`] ?? id)]));
  const cleric = Object.fromEntries(Object.entries(CLERIC_BUFF_KEYS).map(([id, key]) => [id, cap(cls[`${key}.name`] ?? id)]));
  return { ...talent, ...cleric } as Record<V22BuffName, string>;
}
export const V22_BUFFS_EN = buffNames(CLS_EN, TAL_EN);
export const V22_BUFFS_RU = buffNames(CLS_RU, TAL_RU);

/** The Warden's plants, by the game's plants: the frame of warden-plants.png and warden-effects.png (WardenPlants). */
export const WARDEN_PLANTS = { rotberry: 0, firebloom: 1, sungrass: 3, icecap: 4, dreamweed: 5, sorrowmoss: 6, earthroot: 8, fadeleaf: 10 } as const;

export const V22_EN = {
  warden: 'Warden', wardenSub: 'Plants give her power, not harm', wardenNote: 'For everyone else, plants work as usual.', wardenLabel: 'Warden:',
  wardenButton: 'Plants of the Warden',
  plants: {
    rotberry: 'A while of extra strength.', firebloom: 'Fire imbue instead of burns.', sungrass: 'Healing goes on even if she steps off.',
    icecap: 'Frost imbue instead of chill.', dreamweed: 'A few turns of levitation.', sorrowmoss: 'Toxic imbue instead of poison.',
    earthroot: 'Bark armor that moves with her.', fadeleaf: 'To the previous depth’s exit.',
  } as Record<string, string>,
  scoreShort: ['Depth and hero level', 'Gold and the value of your pack', 'Floors explored with nothing missed', 'Bosses beaten without needless hits', 'Quests done for the dungeon folk'],
  max: 'max',
  dontAsk: 'Don’t ask again', dontAskNote: 'Bring the question back in Settings, «Game».', step: 'Step', stay: 'No',
  trapQ: 'Step onto the trap?', fireQ: 'Step into the fire?',
  fireNote: 'You will catch fire: damage every turn until it is out.',
  trapNames: { toxic: 'Toxic trap', fire: 'Fire trap', paralytic: 'Paralytic trap', poison: 'Poison trap', alarm: 'Alarm trap', lightning: 'Lightning trap', gripping: 'Gripping trap', summoning: 'Summoning trap' } as Record<string, string>,
  inHand: 'in hand', spare: 'spare', stanceOn: 'on', stanceOff: 'off', aimWord: 'Pick a target', aimCancel: 'Cancel',
  ready: 'Weapon ability', charging: 'Charging', swapWeapons: 'Swap weapons', stance: 'Brawler’s stance',
  quick: 'Quick spell', quickOff: 'Not the quick spell', quickNote: 'The star marks the quick spell: it sits on the action button, no need to open the tome.',
  charge: 'Charge', of: 'of', tierSub: ['basics', 'tier 2 talents', 'tier 3 talents', 'armor ability'], free: 'free', low: 'low charge',
  change: 'Change', take: 'Take the form', trinityNote: 'A form borrows the power of an item you have already identified this run.',
  formOf: ['Weapon enchant or armor glyph', 'Wand or thrown weapon', 'Ring or artifact'], formNone: 'nothing identified yet',
  forms: ['Body', 'Mind', 'Spirit'],
  monkNote: 'Energy builds up from kills. After an ability, rest 1 turn.', empowered: 'empowered',
  powerCost: (n: number) => `Charge ${n}`,
  scoreMine: 'Score',
};

export const V22_RU: typeof V22_EN = {
  warden: 'Хранительница', wardenSub: 'Растения дают ей силу, а не вред', wardenNote: 'Остальным растения действуют как обычно.', wardenLabel: 'Хранительница:',
  wardenButton: 'Растения Хранительницы',
  plants: {
    rotberry: 'На время прибавляет силы.', firebloom: 'Огненная пропитка вместо ожога.', sungrass: 'Лечение идёт, даже если сойти.',
    icecap: 'Ледяная пропитка вместо холода.', dreamweed: 'Левитация на несколько ходов.', sorrowmoss: 'Ядовитая пропитка вместо яда.',
    earthroot: 'Броня из коры идёт вместе с ней.', fadeleaf: 'К выходу предыдущей глубины.',
  },
  scoreShort: ['Глубина и уровень героя', 'Золото и цена вещей в рюкзаке', 'Изученные этажи без пропущенного', 'Побеждённые боссы без лишних ударов', 'Выполненные задания жителей'],
  max: 'максимум',
  dontAsk: 'Больше не спрашивать', dontAskNote: 'Вернуть вопрос — в Настройках, «Игра».', step: 'Шагнуть', stay: 'Нет',
  trapQ: 'Наступить на ловушку?', fireQ: 'Шагнуть в огонь?',
  fireNote: 'Вы загоритесь: урон каждый ход, пока не потушите.',
  trapNames: { toxic: 'Токсичная ловушка', fire: 'Огненная ловушка', paralytic: 'Паралитическая ловушка', poison: 'Ядовитая ловушка', alarm: 'Сигнальная ловушка', lightning: 'Ловушка-молния', gripping: 'Хватающая ловушка', summoning: 'Ловушка призыва' },
  inHand: 'в руке', spare: 'запасное', stanceOn: 'вкл', stanceOff: 'выкл', aimWord: 'Выберите цель', aimCancel: 'Отмена',
  ready: 'Способность оружия', charging: 'Копит заряд', swapWeapons: 'Сменить оружие', stance: 'Боевая стойка',
  quick: 'Быстрое заклинание', quickOff: 'Не быстрое', quickNote: 'Звезда — быстрое заклинание: оно на кнопке действия, без открытия тома.',
  charge: 'Заряд', of: 'из', tierSub: ['основа', 'таланты 2-го яруса', 'таланты 3-го яруса', 'способность брони'], free: 'бесплатно', low: 'мало заряда',
  change: 'Сменить', take: 'Принять форму', trinityNote: 'Форма берёт силу вещи, которую вы уже опознали в этом забеге.',
  formOf: ['Чары оружия или руна брони', 'Палочка или метательное оружие', 'Кольцо или артефакт'], formNone: 'пока ничего не опознано',
  forms: ['Тело', 'Разум', 'Дух'],
  monkNote: 'Энергия копится за убийства. После приёма — отдых 1 ход.', empowered: 'усилено',
  powerCost: (n: number) => `Заряд ${n}`,
  scoreMine: 'Счёт',
};
