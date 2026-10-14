/**
 * Ranked-mode sprites from assets/meta/trophies16.png and trophies32.png (Design System «Pixel Dungeon UI», v15). They replace 🔥 ❄ 🏆 🥇 🥈 🥉 🏅 in rankui.ts.
 * Every icon is a CSS class (`.pd-tro.gold`, `.pd-tro.pioneer`...) that picks its frame of the sheet, so a sheet that grows (v20 added the
 * jade pioneer cup: frame 8 of 16 px, frame 5 of 32 px) changes no index here.
 */
export type TrophyKind = 'gold' | 'silver' | 'bronze' | 'week' | 'arena' | 'pioneer';
export type RankIcon = TrophyKind | 'flame' | 'flame-off' | 'frost';

/** The icon of a trophy record: `board` is like "daily:2026-10-12", "week:2026-W41", "arena:2026-W41". */
export function trophyKind(board: string, place: number): TrophyKind {
  const kind = board.split(':')[0];
  if (kind === 'pioneer') return 'pioneer';
  if (kind === 'week') return 'week';
  if (kind === 'arena') return 'arena';
  return place === 1 ? 'gold' : place === 2 ? 'silver' : 'bronze';
}

/** `<i class="pd-tro …">`: 16 px, or 32 px with `big`; `x1` draws it at ×1. */
export function rankIcon(kind: RankIcon, opts: { big?: boolean; x1?: boolean } = {}): HTMLElement {
  const i = document.createElement('i');
  i.className = `pd-tro ${kind}${opts.big ? ' big' : ''}${opts.x1 ? ' x1' : ''}`;
  i.setAttribute('aria-hidden', 'true');
  return i;
}
