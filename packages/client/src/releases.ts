/*
 * What changed, version by version: the text of the «Что нового» window (newsui.ts), in Russian and English.
 * A future update only adds an entry at the head of RELEASES (newest first): a small one is a list of changes,
 * each with its tag (added / now / fixed / balance); a major one (`major`) is the big window with its header
 * and four main items, its other changes behind «All changes». The window is shown once per version, to
 * those who played before the update (news.ts).
 */

export type Tag = 'add' | 'now' | 'fix' | 'bal';
export interface Words {
  ru: string;
  en: string;
}
/** The icon of a main item of a major update. */
export type MainIcon = 'classes' | 'talents' | 'alchemy' | 'bosses';

export interface Change {
  tag: Tag;
  text: Words;
}

export interface Release {
  /** Dotted numbers, as `2.4`. */
  version: string;
  major?: boolean;
  /** A major update: the title in the banner («Shattered»), the line under it and the line above the title. */
  title?: Words;
  kick?: Words;
  sub?: Words;
  /** A major update: the four things that are new, with their icons. */
  main?: ReadonlyArray<{ icon: MainIcon; title: Words; text: Words }>;
  changes: readonly Change[];
}

const add = (ru: string, en: string): Change => ({ tag: 'add', text: { ru, en } });
const now = (ru: string, en: string): Change => ({ tag: 'now', text: { ru, en } });
const fix = (ru: string, en: string): Change => ({ tag: 'fix', text: { ru, en } });

export const RELEASES: readonly Release[] = [
  {
    version: '2.4',
    major: true,
    kick: { ru: 'Большое обновление', en: 'Major update' },
    title: { ru: 'Shattered', en: 'Shattered' },
    sub: { ru: 'Игра выросла до Shattered Pixel Dungeon v4', en: 'The game grew into Shattered Pixel Dungeon v4' },
    main: [
      {
        icon: 'classes',
        title: { ru: 'Два новых класса', en: 'Two new classes' },
        text: { ru: 'Дуэлянтка с особыми приёмами оружия и Клирик со священным томом.', en: 'The Duelist with weapon abilities and the Cleric with a holy tome.' },
      },
      {
        icon: 'talents',
        title: { ru: 'Таланты', en: 'Talents' },
        text: { ru: 'Четыре яруса, путь мастерства и способность брони.', en: 'Four tiers, a path of mastery and an armor ability.' },
      },
      {
        icon: 'alchemy',
        title: { ru: 'Алхимия', en: 'Alchemy' },
        text: { ru: 'Котёл, энергия, особые зелья, заклинания и безделушки.', en: 'The pot, energy, exotic potions, spells and trinkets.' },
      },
      {
        icon: 'bosses',
        title: { ru: 'Новые боссы и уровни', en: 'New bosses and levels' },
        text: { ru: 'Переработаны все пять регионов и их хозяева.', en: 'All five regions and their masters reworked.' },
      },
    ],
    changes: [
      add('Дуэлянтка и Клирик: рапира с выпадом и священный том с заклинаниями.', 'The Duelist and the Cleric: a rapier with a lunge and a holy tome with spells.'),
      add('Таланты четырёх ярусов у каждого класса, очки талантов за уровни и окно талантов.', 'Talents on four tiers for every class, talent points for levels, and a talents window.'),
      add('Путь мастерства на третьем ярусе: у каждого класса свои подклассы.', 'A path of mastery on the third tier: every class has its own subclasses.'),
      add('Способности брони у каждого класса и таланты четвёртого яруса.', 'Armor abilities for every class, and tier four talents.'),
      add('Алхимия: котёл, алхимическая энергия, особые зелья и свитки, рунные камни, заклинания, отвары и эликсиры, безделушки.', 'Alchemy: the pot, alchemical energy, exotic potions and scrolls, runestones, spells, brews and elixirs, trinkets.'),
      add('Артефакты, палочки и кольца Shattered; посох мага.', 'Shattered’s artifacts, wands and rings; the mage’s staff.'),
      add('Оружие, броня и метательное оружие Shattered, чары и глифы четвёртой версии.', 'Shattered’s weapons, armor and thrown weapons, the enchantments and glyphs of version 4.'),
      add('Новые чудища, чемпионы, редкие разновидности и бестиарий.', 'New monsters, champions, rare variants and a bestiary.'),
      add('Боссы, как их ведёт Shattered: Жижа, Тенгу, DM-300, Король гномов, Йог-Дзева.', 'Bosses as Shattered fights them: Goo, Tengu, DM-300, the King of Dwarves, Yog-Dzewa.'),
      add('Новые уровни, комнаты, ловушки и задания.', 'New levels, rooms, traps and quests.'),
      add('Привал: живой главный экран с костром, вашим героем и почтой; свайп меняет класс.', 'The camp: a live home screen with a fire, your hero and the mail; a swipe changes the class.'),
      add('Почта: кубки дня и медали недели приходят письмами.', 'Mail: the day’s cups and the week’s medals arrive as letters.'),
      add('Обучение по шагам для новых игроков.', 'A step-by-step tutorial for new players.'),
      add('Кубок «Первопроходец» всем, кто спускался в подземелье до обновления.', 'The «Pioneer» cup for everyone who went down the dungeon before the update.'),
      add('«Сообщить о проблеме» в настройках и на экране ошибки; за подтверждённую ошибку — значок «Охотник за багами».', '«Report a problem» in the settings and on the error screen; a confirmed bug earns the «Bug hunter» badge.'),
      add('Игра без связи: забег идёт дальше и засчитается, когда связь вернётся.', 'Play without a connection: the run goes on and counts once the connection is back.'),
      add('Правила доски: «?» в рейтинге объясняет очки, места, закрытие и равные очки.', 'Board rules: the «?» in the rankings explains the score, the places, the close and ties.'),
      add('Звуки и музыка Shattered.', 'Shattered’s sounds and music.'),
      now('Пиксель-Март: пять полок, привалы с открытками и примеркой на 10 секунд.', 'Pixel Mart: five shelves, camps with postcards and a 10-second try-on.'),
      now('Под призовым местом на доске видна награда, а доска показывает, когда закроется.', 'Prize places on the boards show their reward, and the board shows when it closes.'),
      now('Забег, начатый в прежней версии, может не продолжиться: рекорды, значки и кубки остаются.', 'A run begun in an earlier version may not be able to go on: records, badges and trophies stay.'),
      fix('Сбой сервера больше не обрывает серию и не тратит заморозку.', 'A server outage no longer breaks a streak or spends a freeze.'),
      fix('Когда Telegram свёрнут, игра перестаёт рисовать и не греет телефон.', 'With Telegram minimised, the game stops drawing and no longer warms the phone.'),
    ],
  },
];

/** The release a version names. */
export const releaseOf = (version: string): Release | undefined => RELEASES.find((release) => release.version === version);

/** The newest release: the game's version. */
export const CURRENT: Release = RELEASES[0]!;
