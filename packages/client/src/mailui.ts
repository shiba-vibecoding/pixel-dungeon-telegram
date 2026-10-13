import { audio } from './audio';
import type { Gift, Letter, Profile, RunApi } from './checked';
import { locale, t } from './i18n';
import { button, el, show, sprites, toast, windowOf } from './screens';
import { rankIcon, trophyKind } from './trophyicons';

/*
 * The mail window (design system v18, «Почта»): the letters of finished boards, newest first, each with what it
 * gives and «Claim»; claiming is the server's word (it puts the trophy on the «Mine» shelf, once). Unread letters
 * have a gold dot; claimed ones are dimmer and say «Received». Letters are kept thirty days.
 */

const DAY = 86_400_000;

/** How many letters wait to be claimed: the number on the camp's mail icon. */
export const unclaimed = (letters: readonly Letter[]): number => letters.filter((letter) => letter.claimed === undefined).length;

/** «today», «yesterday», the weekday within a week, else the date. */
function when(at: number, now: number): string {
  const days = Math.floor((now - at) / DAY);
  if (days <= 0) return t.mail.today;
  if (days === 1) return t.mail.yesterday;
  if (days < 7) return new Date(at).toLocaleDateString(locale, { weekday: 'short', timeZone: 'UTC' });
  return new Date(at).toLocaleDateString(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

/** The board's day as «12.10» (UTC, as its day is). */
function dayOf(board: string): string {
  const [, date = ''] = board.split(':');
  const [, month = '', day = ''] = date.split('-');
  return `${Number(day)}.${month}`;
}

/** The letter's words, with its place picked out. */
function words(letter: Letter): HTMLElement {
  const [, when = ''] = letter.board.split(':');
  const text = letter.kind === 'cup'
    ? t.mail.cupText(dayOf(letter.board), letter.place, letter.total)
    : t.mail.medalText(String(Number(when.split('-W')[1] ?? 0)), letter.place, letter.total);
  return el('p', { className: 'pd-letter-text' }, text.before, el('em', { textContent: text.em }), text.after);
}

/** One gift: its icon and name. A kind this client does not know is left out (an update will show it). */
function gift(item: Gift): HTMLElement | null {
  if (item.type !== 'trophy') return null;
  const kind = trophyKind(item.board, item.place);
  return el('span', { className: 'pd-gift' }, rankIcon(kind, { x1: true }), t.mail.gifts[kind] ?? '');
}

export interface MailOptions {
  letters: readonly Letter[];
  api: RunApi;
  /** The mailbox changed (a claim): the letters and the trophies as the server has them. */
  onChange(letters: Letter[], trophies: Profile['trophies']): void;
  onClose(): void;
}

export function showMail(options: MailOptions): void {
  let letters = [...options.letters];
  // The dots are of what was unread when the window opened; the server is told they have been looked at.
  const unread = new Set(letters.filter((letter) => !letter.read && letter.claimed === undefined).map((letter) => letter.id));
  let busy = false;
  const list = el('div', { className: 'pd-mail' });
  const foot = el('div', { className: 'pd-mail-foot' });
  const scroll = el('div', { className: 'pd-scroll' }, list);

  const apply = (answer: { mail: Letter[]; trophies: Profile['trophies'] } | null, done: string): void => {
    busy = false;
    if (!answer) {
      toast(t.mail.offline, { tone: 'warn' });
      render();
      return;
    }
    audio.play('gold', 1.2, 0.5);
    toast(done, { tone: 'good' });
    letters = answer.mail;
    options.onChange(answer.mail, answer.trophies);
    render();
  };
  const claim = (id: string): void => {
    if (busy) return;
    busy = true;
    render();
    void options.api.mail('claim', id).then((answer) => apply(answer, t.mail.claimedToast));
  };
  const claimAll = (): void => {
    if (busy) return;
    busy = true;
    render();
    void options.api.mail('claimAll').then((answer) => apply(answer, t.mail.claimedToast));
  };

  const render = (): void => {
    const first = letters.find((letter) => letter.claimed === undefined);
    const now = Date.now();
    if (letters.length === 0) {
      list.replaceChildren(el('p', { className: 'pd-mail-empty', textContent: t.mail.empty }));
      foot.replaceChildren();
      foot.hidden = true;
    } else {
      list.replaceChildren(
        ...letters.map((letter) => {
          const done = letter.claimed !== undefined;
          const act = el(
            'div',
            { className: 'pd-letter-act' },
            el('span', { className: 'pd-letter-gifts' }, ...letter.gifts.map(gift)),
            done
              ? el('span', { className: 'pd-letter-done', textContent: t.mail.got })
              : (() => {
                  const node = button(t.mail.claim, () => claim(letter.id), letter === first ? 'primary' : '');
                  node.disabled = busy;
                  return node;
                })(),
          );
          const kind = letter.kind === 'cup' ? trophyKind(letter.board, letter.place) : 'week';
          return el(
            'article',
            { className: `pd-letter${done ? ' claimed' : unread.has(letter.id) ? ' unread' : ''}` },
            el('span', { className: 'pd-letter-ico' }, rankIcon(kind, { big: true })),
            el('header', { className: 'pd-letter-head' }, el('b', { textContent: letter.kind === 'cup' ? t.mail.cup : t.mail.medal }), el('time', { textContent: when(letter.at, now) })),
            words(letter),
            act,
          );
        }),
      );
      foot.hidden = false;
      const all = button(t.mail.claimAll, claimAll, 'quiet');
      all.disabled = busy || first === undefined;
      foot.replaceChildren(el('span', { textContent: t.mail.keep }), all);
    }
    sprites(list);
  };

  const icon = el('i', { className: 'pd-icon' });
  icon.style.cssText = 'width:32px;height:32px;background-image:var(--spr-mail)';
  show(windowOf({ title: t.mail.title, icon, onClose: options.onClose, className: 'pd-mail-window' }, scroll, foot), options.onClose);
  render();
  if (unread.size > 0) void options.api.mail('readAll').then((answer) => answer && options.onChange(answer.mail, answer.trophies));
}
