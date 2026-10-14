import { weekEnd } from '@pd/core';
import { audio } from './audio';
import type { BoardEntry, BoardKind, BoardView, Profile, RunApi, SyncAnswer } from './checked';
import { locale, t } from './i18n';
import type { RunRecord } from './rankings';
import { AVATAR, button, el, info, scoreTable, show, sprites, windowOf } from './screens';
import { type RankIcon, rankIcon, trophyKind } from './trophyicons';

/*
 * The boards of checked runs (the server's player.ts): the day's daily dungeon, the week's
 * best, the arena's week, the best ever, and the player's own runs and trophies; the player's
 * card on the title (the streak, the best, the trophies); and the end of a run's places as
 * the server scored it. Markup after the design system's Ranked cards (v16, migration.md).
 */

type Tab = 'daily' | 'week' | 'arena' | 'all' | 'device';
/** The arena of waves is no longer offered: its boards are not shown. */
const TABS: readonly Tab[] = ['daily', 'week', 'all', 'device'];
/** The icon of each board's note and of its places 1–3. */
const BOARD_ICON: Partial<Record<string, RankIcon>> = { daily: 'gold', week: 'week', arena: 'arena' };

const number = (n: number): string => n.toLocaleString(locale);

/** What a board's places win once it closes: the day's top 3 a cup (gold, silver, bronze), the week's top 10 a medal (design v19: under the place's number). */
export interface Prize {
  board: 'daily' | 'week';
  places: number;
}

const PRIZES: Record<'daily' | 'week', Prize> = { daily: { board: 'daily', places: 3 }, week: { board: 'week', places: 10 } };
const prizeOf = (tab: Tab): Prize | null => (tab === 'daily' || tab === 'week' ? PRIZES[tab] : null);

/** The prize's small icon under a rewarded place's number, saying what it is. */
function prizeIcon(prize: Prize, place: number): HTMLElement {
  const icon = rankIcon(prize.board === 'daily' ? trophyKind('daily', place) : 'week', { x1: true });
  icon.removeAttribute('aria-hidden');
  icon.setAttribute('aria-label', t.prizes.prize[prize.board === 'daily' ? 0 : 1] ?? '');
  return icon;
}

/** When a board closes (ms): the day's at the end of the UTC day, the week's at its Monday. */
export function boardCloses(tab: 'daily' | 'week', now: number): number {
  return tab === 'daily' ? Math.floor(now / 86_400_000 + 1) * 86_400_000 : weekEnd(now);
}

/** «2 дн 7 ч», «5 ч 12 мин», «9 мин»; the last minute is «a moment». */
export function countdown(ms: number): string {
  const minutes = Math.max(0, Math.ceil(ms / 60_000));
  const u = t.prizes.units;
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  if (minutes < 1) return t.prizes.closesSoon;
  return days > 0 ? `${days} ${u.d} ${hours} ${u.h}` : hours > 0 ? `${hours} ${u.h} ${minutes % 60} ${u.m}` : `${minutes} ${u.m}`;
}

/** Under the board's note: the hourglass and the time to the board's close, kept up to date while the window stands. */
function boardTimer(tab: Tab): HTMLElement | null {
  const prize = prizeOf(tab);
  if (!prize) return null;
  const [before = '', after = ''] = prize.board === 'daily' ? t.prizes.timerDaily : t.prizes.timerWeek;
  const left = el('b');
  const timer = el('p', { className: 'pd-board-timer' }, el('i'), before, left, after);
  let started = false;
  const tick = (): void => {
    left.textContent = countdown(boardCloses(prize.board, Date.now()) - Date.now());
    if (!started || timer.isConnected) {
      started = true;
      window.setTimeout(tick, 30_000);
    }
  };
  tick();
  return timer;
}

interface RowEntry {
  heroClass: BoardEntry['heroClass'];
  name: string;
  score: number;
  patron?: boolean;
}

/** One row of a board: place (none on the player's own list), face, name with a patron's mark, score, and what the run came to. */
function row(place: number | null, entry: RowEntry, detail: Array<string | Node>, me: boolean, prize: Prize | null = null): HTMLElement {
  const prized = prize !== null && place !== null && place <= prize.places;
  const face = el('i', { className: 'pd-rank-face' });
  face.style.setProperty('--av', String(AVATAR[entry.heroClass]));
  const medal = place !== null && place <= 3 ? ` pd-medal-${place}` : '';
  return el(
    'div',
    { className: `pd-rank${me ? ' me' : ''}${medal}${prized ? ' prize' : ''}` },
    place !== null ? el('span', { className: 'pd-rank-n' }, String(place), prized ? prizeIcon(prize, place) : null) : null,
    face,
    el('span', { className: 'pd-rank-name' }, entry.patron ? el('i', { className: 'pd-patron-mark' }) : null, entry.name),
    el('span', { className: 'pd-rank-score', textContent: number(entry.score) }),
    el('small', { className: 'pd-rank-detail' }, ...detail),
  );
}

/** «Warrior · lv.22 · ⛶24», the depth as its icon; in the arena «Warrior · wave 23». */
function detail(heroClass: BoardEntry['heroClass'], level: number, depth: number, arena: boolean, won = false): Array<string | Node> {
  if (arena) return [`${t.classes[heroClass]} · ${t.arena.waveWord(depth)}`];
  return [`${t.classes[heroClass]} · ${t.ranked.lv}${level} · `, el('i', { className: 'pd-rank-depth' }), `${depth}${won ? ' · ★' : ''}`];
}

/** A board as rows, then (stuck to the bottom) my row if it is further down, and my place. */
export function boardRows(board: BoardView | null, arena: boolean, count = 50, prize: Prize | null = null): HTMLElement[] {
  if (!board) return [info(t.boardOffline, 'pd-note center')];
  const list = el('div', { className: 'pd-ranks' });
  board.top.slice(0, count).forEach((entry, i) => {
    list.append(row(i + 1, entry, detail(entry.heroClass, entry.level, entry.depth, arena, entry.won), i + 1 === board.rank, prize));
    // After the tenth place of the week: where the medals stop.
    if (prize?.board === 'week' && i === 9 && board.top.length > 10) list.append(el('div', { className: 'pd-ranks-cut', textContent: t.prizes.cut }));
  });
  const nodes: HTMLElement[] = [board.top.length === 0 ? info(t.noResults, 'pd-note center') : list];
  if (board.rank !== null) {
    const below = board.rank > count && board.you;
    nodes.push(
      el(
        'div',
        { className: 'pd-ranks-me' },
        below ? el('div', { className: 'pd-ranks-gap', textContent: '· · ·' }) : null,
        below ? row(board.rank, board.you!, detail(board.you!.heroClass, board.you!.level, board.you!.depth, arena, board.you!.won), true, prize) : null,
        el('div', { className: 'pd-board-place', textContent: t.ranked.placeOf(board.rank, board.total ?? board.rank) }),
      ),
    );
  } else {
    nodes.push(info(t.ranked.notYet, 'pd-note center'));
  }
  return nodes;
}

const shortDate = (time: number): string => new Date(time).toLocaleDateString(locale, { day: '2-digit', month: '2-digit' });

/** «Mine»: the shelf of trophies won, then the device's best runs, each with its date. */
function mineRows(records: readonly RunRecord[], trophies: Profile['trophies']): HTMLElement[] {
  const nodes: HTMLElement[] = [];
  if (trophies.length > 0) {
    nodes.push(
      el(
        'div',
        { className: 'pd-trophy-shelf' },
        ...trophies.slice(0, 12).map((trophy) => {
          const kind = trophy.board.split(':')[0] ?? '';
          return el('span', { title: trophyText(trophy) }, rankIcon(trophyKind(trophy.board, trophy.place), { big: true }), el('b', { textContent: `#${trophy.place}` }), t.ranked.trophyBoard[kind] ?? kind);
        }),
      ),
    );
  }
  if (records.length === 0) {
    nodes.push(info(t.noRankings, 'pd-note center'));
    return nodes;
  }
  const list = el('div', { className: 'pd-ranks mine' });
  for (const record of records) {
    const arena = record.mode === 'arena';
    const what = record.won ? '' : record.cause ? ` · ${record.cause}` : '';
    const line = row(null, record, [`${shortDate(record.date)} · `, ...detail(record.heroClass, record.lvl, record.depth, arena, record.won), what], false);
    list.append(line);
    // A run with its score table opens into it: what the points are made of (design-system rows, the table is the end screen's).
    if (record.breakdown) {
      const more = el('div', { className: 'pd-rank-more' }, scoreTable(record.breakdown));
      more.hidden = true;
      line.classList.add('more');
      line.tabIndex = 0;
      line.setAttribute('role', 'button');
      line.setAttribute('aria-expanded', 'false');
      line.setAttribute('aria-label', `${number(record.score)}. ${t.scoring.open}`);
      const toggle = (): void => {
        audio.play('click');
        more.hidden = !more.hidden;
        line.setAttribute('aria-expanded', String(!more.hidden));
      };
      line.onclick = toggle;
      line.onkeydown = (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          toggle();
        }
      };
      list.append(more);
    }
  }
  nodes.push(list);
  return nodes;
}

export interface BoardsOptions {
  api: RunApi | null;
  /** The device's own table (rankings.ts). */
  device: readonly RunRecord[];
  /** Trophies won, for «Mine» (the server's profile). */
  trophies?: Profile['trophies'];
  tab?: Tab;
  onClose(): void;
}

/** The rankings window: a tab a board, each loaded when first shown. */
export function showBoards(options: BoardsOptions): void {
  const body = el('div', { className: 'pd-scroll pd-boards' });
  const note = el('p', { className: 'pd-board-note' });
  const prizes = el('div', { className: 'pd-prize-slot' });
  const tabs = el('div', { className: 'pd-tabs compact' });
  tabs.setAttribute('role', 'tablist');
  const cache = new Map<Tab, Promise<BoardView | null>>();
  let current: Tab = options.api ? (options.tab ?? 'daily') : 'device';
  const select = (tab: Tab): void => {
    current = tab;
    for (const node of tabs.children) node.setAttribute('aria-selected', String((node as HTMLElement).dataset.tab === tab));
    const icon = BOARD_ICON[tab];
    note.replaceChildren(...(icon ? [rankIcon(icon)] : []), options.api ? t.ranked.tabInfo[tab] ?? '' : t.ranked.telegramOnly);
    prizes.replaceChildren(...(options.api ? [boardTimer(tab)] : []).filter((node): node is HTMLElement => node !== null));
    if (tab === 'device' || !options.api) {
      body.replaceChildren(...mineRows(options.device.filter((record) => record.mode !== 'arena'), (options.trophies ?? []).filter((trophy) => !trophy.board.startsWith('arena:'))));
      sprites(body);
      return;
    }
    body.replaceChildren(info(t.loading, 'pd-note center'));
    if (!cache.has(tab)) cache.set(tab, options.api.board(tab as BoardKind));
    void cache.get(tab)!.then((board) => {
      if (current !== tab) return;
      body.replaceChildren(...boardRows(board, tab === 'arena', 50, prizeOf(tab)));
      sprites(body);
    });
  };
  for (const tab of options.api ? TABS : (['device'] as const)) {
    const node = el('button', {
      className: 'pd-tab',
      textContent: t.ranked.tabs[tab] ?? tab,
      onclick: () => {
        audio.play('click');
        select(tab);
      },
    });
    node.dataset.tab = tab;
    node.setAttribute('role', 'tab');
    tabs.append(node);
  }
  show(windowOf({ title: t.ranked.title, onClose: options.onClose, className: 'pd-boards-window' }, tabs, note, prizes, body), options.onClose);
  select(current);
}

/** What the camp's card says of a player the server does not know (outside Telegram): the device's own table. */
export interface CardFallback {
  best: number;
  games: number;
}

export interface CardOptions {
  /** The name shown. */
  name: string;
  /** The hero on the scene, in avatars.png; or, in the new classes' looks, a cell of avatars-skins.png. */
  avatar: number;
  skinAvatar?: boolean;
  /** The portrait frame worn (Pixel-Mart). */
  frame?: string;
  profile: Profile | null;
  fallback?: CardFallback;
  onOpen(): void;
}

/**
 * The player's card at the top of the camp: the portrait in the frame worn, the name, the streak's flame and days, the best and
 * the runs (today's place once played), frosts and trophies. Without the server's word it keeps to the name and the device's table.
 */
export function profileCard(options: CardOptions): HTMLElement {
  const { profile } = options;
  const streak = profile?.streak.count ?? 0;
  const face = el('i', { className: options.skinAvatar ? 'skin' : '' });
  face.style.setProperty('--av', String(options.avatar));
  const portrait = el('span', { className: `pd-profile-face${options.frame ? ` frame-${options.frame}` : ''}` }, face);
  const facts: Node[] = [];
  const fact = (label: string, value: string, className = ''): void => {
    if (facts.length > 0) facts.push(document.createTextNode(' · '));
    // Each fact keeps to one line; the line breaks between them.
    facts.push(el('span', { className: 'pd-fact' }, `${label} `, el('b', { className, textContent: value })));
  };
  const best = profile?.best ?? options.fallback?.best ?? 0;
  const games = profile?.games ?? options.fallback?.games ?? 0;
  if (best > 0) fact(t.ranked.best, number(best));
  fact(t.ranked.games, String(games));
  if (profile?.dailyDone && profile.places.daily) fact(t.ranked.today, `#${profile.places.daily}`, 'place');
  const side = el('span', { className: 'pd-profile-side' });
  if (profile && profile.streak.freezes > 0) {
    side.append(el('span', { className: 'pd-counter frost', title: t.ranked.freezeInfo }, rankIcon('frost'), String(profile.streak.freezes)));
  }
  if (profile && profile.trophies.length > 0) side.append(el('span', { className: 'pd-counter trophies' }, rankIcon('gold'), String(profile.trophies.length)));
  return el(
    'button',
    {
      className: 'pd-profile framed',
      ariaLabel: t.camp.profileHint,
      onclick: () => {
        audio.play('click');
        options.onOpen();
      },
    },
    portrait,
    el(
      'span',
      { className: 'pd-profile-text' },
      el('span', { className: 'pd-profile-name', textContent: options.name }),
      profile ? el('span', { className: `pd-profile-streak${streak > 0 ? '' : ' off'}` }, rankIcon(streak > 0 ? 'flame' : 'flame-off', { x1: true }), streak > 0 ? t.ranked.streak(streak) : t.ranked.streakNone) : null,
      el('span', { className: 'pd-profile-facts' }, ...facts),
    ),
    side.childElementCount > 0 ? side : null,
  );
}

/** A trophy's words: which board, which place, and when. */
export function trophyText(trophy: { board: string; place: number }): string {
  const [kind = '', when = ''] = trophy.board.split(':');
  return `${t.ranked.trophy(t.ranked.trophyBoard[kind] ?? kind, trophy.place)} (${when})`;
}

/** The end of a run as the server scored it: checked, a record, its places best first; or why it does not count. */
export function rankingBlock(answer: Promise<SyncAnswer | null> | null): HTMLElement {
  const block = el('div', { className: 'pd-ranking' });
  if (!answer) {
    block.append(el('p', { className: 'pd-checked off', textContent: t.ranked.unchecked }));
    return block;
  }
  block.append(el('p', { className: 'pd-checked pending', textContent: t.ranked.checking }));
  void answer.then((reply) => {
    if (!reply?.finished) {
      block.replaceChildren(el('p', { className: 'pd-checked off', textContent: t.ranked.offline }));
      return;
    }
    const places = (Object.entries(reply.places ?? {}).filter(([, place]) => typeof place === 'number') as Array<[string, number]>)
      .sort((a, b) => a[1] - b[1]);
    block.replaceChildren(
      el('p', { className: 'pd-checked', textContent: t.ranked.checked }),
      reply.record ? el('p', { className: 'pd-new-record', textContent: t.ranked.record }) : '',
      places.length > 0
        ? el(
          'div',
          { className: 'pd-places' },
          ...places.map(([kind, place]) => {
            const top = place <= 3;
            const icon = top && BOARD_ICON[kind] ? rankIcon(kind === 'daily' ? trophyKind('daily', place) : BOARD_ICON[kind]!) : null;
            return el('span', { className: `pd-place${top ? ' top' : ''}` }, icon, el('b', { textContent: `#${place}` }), t.ranked.placeShort[kind] ?? kind);
          }),
        )
        : !reply.finished.ranked ? info(t.ranked.practice, 'pd-note center') : '',
    );
  });
  return block;
}
