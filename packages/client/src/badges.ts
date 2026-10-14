import {
  type BadgeId, type BadgeProgress, checkBadges as checkCore, countGame as countCore, type Effect, emptyBadgeProgress, type Hero, mergeBadgeProgress,
  type World,
} from '@pd/core';
import { lang } from './i18n';
import { mergeWith } from './cloud';

/*
 * Badges (Badges): feats remembered on this device across runs, as the core's rules earn them
 * (core badges.ts). The server earns them too, from the runs it checks, and its record joins
 * this one (adoptBadges).
 */

export type { BadgeId } from '@pd/core';

/** Where the arena's badges begin: images from here on are in meta/badges-arena.png, not badges.png. */
export const ARENA_BADGES = 64;
/** Badges that can no longer be earned (Shattered knows wands by sight): shown only to those who have them. */
export const RETIRED: ReadonlySet<BadgeId> = new Set<BadgeId>(['wands']);

/** Each badge's icon in badges.png, and its words. */
export const BADGES: ReadonlyArray<{ id: BadgeId; image: number; en: string; ru: string }> = [
  { id: 'slain1', image: 0, en: '10 enemies slain', ru: 'Убито 10 врагов' },
  { id: 'slain2', image: 1, en: '50 enemies slain', ru: 'Убито 50 врагов' },
  { id: 'slain3', image: 2, en: '150 enemies slain', ru: 'Убито 150 врагов' },
  { id: 'slain4', image: 3, en: '250 enemies slain', ru: 'Убито 250 врагов' },
  { id: 'gold1', image: 4, en: '100 gold collected', ru: 'Собрано 100 золота' },
  { id: 'gold2', image: 5, en: '500 gold collected', ru: 'Собрано 500 золота' },
  { id: 'gold3', image: 6, en: '2500 gold collected', ru: 'Собрано 2500 золота' },
  { id: 'gold4', image: 7, en: '7500 gold collected', ru: 'Собрано 7500 золота' },
  { id: 'level1', image: 8, en: 'Level 6 reached', ru: 'Достигнут 6-й уровень' },
  { id: 'level2', image: 9, en: 'Level 12 reached', ru: 'Достигнут 12-й уровень' },
  { id: 'level3', image: 10, en: 'Level 18 reached', ru: 'Достигнут 18-й уровень' },
  { id: 'level4', image: 11, en: 'Level 24 reached', ru: 'Достигнут 24-й уровень' },
  { id: 'boss1', image: 12, en: '1st boss slain', ru: 'Убит первый босс' },
  { id: 'boss2', image: 13, en: '2nd boss slain', ru: 'Убит второй босс' },
  { id: 'boss3', image: 14, en: '3rd boss slain', ru: 'Убит третий босс' },
  { id: 'boss4', image: 15, en: '4th boss slain', ru: 'Убит четвёртый босс' },
  { id: 'potions', image: 16, en: 'All potions identified', ru: 'Опознаны все зелья' },
  { id: 'scrolls', image: 17, en: 'All scrolls identified', ru: 'Опознаны все свитки' },
  { id: 'rings', image: 18, en: 'All rings identified', ru: 'Опознаны все кольца' },
  { id: 'wands', image: 19, en: 'All wands identified', ru: 'Опознаны все палочки' },
  { id: 'haggler', image: 20, en: 'Ring of Haggler obtained', ru: 'Получено кольцо торговца' },
  { id: 'thorns', image: 21, en: 'Ring of Thorns obtained', ru: 'Получено кольцо шипов' },
  { id: 'victory', image: 22, en: 'Amulet of Yendor obtained', ru: 'Амулет Йендора добыт' },
  { id: 'bags', image: 23, en: 'All bags bought', ru: 'Куплены все сумки' },
  { id: 'deathFire', image: 24, en: 'Death from fire', ru: 'Смерть от огня' },
  { id: 'deathPoison', image: 25, en: 'Death from poison', ru: 'Смерть от яда' },
  { id: 'deathGas', image: 26, en: 'Death from toxic gas', ru: 'Смерть от ядовитого газа' },
  { id: 'deathHunger', image: 27, en: 'Death from hunger', ru: 'Смерть от голода' },
  { id: 'grim', image: 29, en: 'Monster killed by a grim weapon', ru: 'Враг убит мрачным оружием' },
  { id: 'piranhas', image: 30, en: '6 piranhas killed', ru: 'Убито 6 пираний' },
  { id: 'boss1AllClasses', image: 32, en: '1st boss slain by Warrior, Mage, Rogue & Huntress', ru: 'Первый босс убит воином, магом, разбойником и охотницей' },
  { id: 'boss3AllSubclasses', image: 33, en: '3rd boss slain by every one of the eight ways', ru: 'Третий босс убит всеми восемью путями мастерства' },
  { id: 'yasd', image: 34, en: 'Death from fire, poison, toxic gas & hunger', ru: 'Смерть от огня, яда, газа и голода' },
  { id: 'allItems', image: 35, en: 'All potions, scrolls, rings & wands identified', ru: 'Опознаны все зелья, свитки, кольца и палочки' },
  { id: 'victoryAllClasses', image: 36, en: 'Amulet of Yendor obtained by Warrior, Mage, Rogue & Huntress', ru: 'Амулет добыт воином, магом, разбойником и охотницей' },
  { id: 'rare', image: 37, en: 'All rare monsters slain', ru: 'Убиты все редкие чудища' },
  { id: 'happyEnd', image: 38, en: 'Happy end', ru: 'Счастливый конец' },
  { id: 'str1', image: 40, en: '13 points of Strength attained', ru: 'Сила достигла 13' },
  { id: 'str2', image: 41, en: '15 points of Strength attained', ru: 'Сила достигла 15' },
  { id: 'str3', image: 42, en: '17 points of Strength attained', ru: 'Сила достигла 17' },
  { id: 'str4', image: 43, en: '19 points of Strength attained', ru: 'Сила достигла 19' },
  { id: 'food1', image: 44, en: '10 pieces of food eaten', ru: 'Съедено 10 порций еды' },
  { id: 'food2', image: 45, en: '20 pieces of food eaten', ru: 'Съедено 20 порций еды' },
  { id: 'food3', image: 46, en: '30 pieces of food eaten', ru: 'Съедено 30 порций еды' },
  { id: 'food4', image: 47, en: '40 pieces of food eaten', ru: 'Съедено 40 порций еды' },
  { id: 'item1', image: 48, en: 'Item of level 3 acquired', ru: 'Получен предмет 3-го уровня' },
  { id: 'item2', image: 49, en: 'Item of level 6 acquired', ru: 'Получен предмет 6-го уровня' },
  { id: 'item3', image: 50, en: 'Item of level 9 acquired', ru: 'Получен предмет 9-го уровня' },
  { id: 'item4', image: 51, en: 'Item of level 12 acquired', ru: 'Получен предмет 12-го уровня' },
  { id: 'cooked1', image: 52, en: '3 potions cooked', ru: 'Сварено 3 зелья' },
  { id: 'cooked2', image: 53, en: '6 potions cooked', ru: 'Сварено 6 зелий' },
  { id: 'cooked3', image: 54, en: '9 potions cooked', ru: 'Сварено 9 зелий' },
  { id: 'cooked4', image: 55, en: '12 potions cooked', ru: 'Сварено 12 зелий' },
  { id: 'combo', image: 56, en: '7-hit combo', ru: 'Серия из 7 ударов' },
  { id: 'deathGlyph', image: 57, en: 'Death from an enchantment', ru: 'Смерть от собственных чар' },
  { id: 'deathFalling', image: 59, en: 'Death from falling down', ru: 'Смерть от падения' },
  { id: 'games1', image: 60, en: '10 games played', ru: 'Сыграно 10 игр' },
  { id: 'games2', image: 61, en: '100 games played', ru: 'Сыграно 100 игр' },
  { id: 'games3', image: 62, en: '500 games played', ru: 'Сыграно 500 игр' },
  { id: 'games4', image: 63, en: '2000 games played', ru: 'Сыграно 2000 игр' },
  { id: 'champion', image: 39, en: 'Challenge won', ru: 'Испытание пройдено' },
  // The arena of waves (design system v14): their own sheet, meta/badges-arena.png, from image 64 (see screens.ts sprites).
  { id: 'arena5', image: ARENA_BADGES, en: 'Wave 5 held in the arena', ru: 'На арене выстояна 5-я волна' },
  { id: 'arena10', image: ARENA_BADGES + 1, en: 'Wave 10 held in the arena', ru: 'На арене выстояна 10-я волна' },
  { id: 'arena20', image: ARENA_BADGES + 2, en: 'Wave 20 held in the arena', ru: 'На арене выстояна 20-я волна' },
];

export const badgeText = (id: BadgeId): string => {
  const badge = BADGES.find((b) => b.id === id)!;
  return lang === 'ru' ? badge.ru : badge.en;
};

/** What is remembered on this device. */
interface Store extends BadgeProgress {
  /** Badges already shown in the badges window; absent for stores from before it was kept. */
  seen?: BadgeId[];
}

const KEY = 'pd-badges';

function load(): Store {
  const empty: Store = emptyBadgeProgress();
  try {
    return { ...empty, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Store>) };
  } catch {
    return empty;
  }
}

const store = load();

/** The badges' store again from the device, once the cloud's copy has been folded in (cloud.ts). */
export function reloadBadges(): void {
  Object.assign(store, load());
}

// Two devices' badges are both kept: every list joined, the count of games the larger.
mergeWith(KEY, (here, cloud) => {
  try {
    const a = { ...load(), ...(here ? (JSON.parse(here) as Partial<Store>) : {}) };
    const b = { ...emptyBadgeProgress(), ...(JSON.parse(cloud) as Partial<Store>) };
    const join = <T>(x: T[] | undefined, y: T[] | undefined): T[] => [...new Set([...(x ?? []), ...(y ?? [])])];
    const merged: Store = { ...mergeBadgeProgress(a, b), seen: a.seen || b.seen ? join(a.seen, b.seen) : undefined };
    return JSON.stringify(merged);
  } catch {
    return here;
  }
});

function save(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    // Kept for this session only.
  }
}

export const earnedBadges = (): ReadonlySet<BadgeId> => new Set(store.earned);

/** Badges earned since the badges window was last opened: they get a golden dot. */
export const unseenBadges = (): ReadonlySet<BadgeId> => new Set(store.earned.filter((id) => !(store.seen ?? store.earned).includes(id)));

export function markBadgesSeen(): void {
  store.seen = [...store.earned];
  save();
}

/** Games played: counts a run the first time it is seen on this device. */
export function countGame(seed: number): BadgeId[] {
  const fresh = countCore(store, seed);
  save();
  return fresh;
}

/** Looks over the hero and what just happened; returns the badges earned just now. */
export function checkBadges(world: World, me: Hero, effects: readonly Effect[]): BadgeId[] {
  const { fresh, changed } = checkCore(store, world, me, effects);
  if (changed) save();
  return fresh;
}

/** The server's record of badges (from the runs it checked) joins this device's; returns those new here. */
export function adoptBadges(server: BadgeProgress): BadgeId[] {
  const before = new Set(store.earned);
  const merged = mergeBadgeProgress(store, server);
  Object.assign(store, merged);
  save();
  return store.earned.filter((id) => !before.has(id));
}
