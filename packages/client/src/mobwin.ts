import { CHAMPION_AURA, type ChampionKind, type Mob } from '@pd/core';
import { championText, mobDescription, mobName } from './examine';
import { t } from './i18n';
import { el, healthBar, hideOverlay, info, portrait, show, windowOf } from './screens';

/*
 * The creature windows of design v21 (.pd-mob-window): a champion with its aura's colour round the portrait, a tag under
 * the name and its power listed with the curse icons' sheet; a ghoul lying crumpled, its health struck through and its
 * turns to rise in dots; an ebony mimic that is only a suspicious outline.
 */

/** The cells of mob-buffs(-l).png for the six champions, after the four curses. */
export const CHAMPION_ICON: Readonly<Record<ChampionKind, number>> = { blazing: 4, projecting: 5, antiMagic: 6, giant: 7, blessed: 8, growing: 9 };

const css = (color: number): string => `#${color.toString(16).padStart(6, '0')}`;
const paragraphs = (lines: readonly string[]): HTMLElement[] => lines.flatMap((line) => line.split('\n\n')).filter((line) => line !== '').map((line) => info(line));

/** A champion's window: its portrait in a frame of its colour, the tag, its health, the lines about the kind (without the champion's own, which the list below gives). */
export function showChampion(mob: Mob, lines: readonly string[], onClose: () => void = hideOverlay): void {
  const champion = mob.champion!;
  const colour = css(CHAMPION_AURA[champion].color);
  const text = championText(mob)!;
  const face = el('span', { className: 'pd-mob-face champ' }, portrait(mob.kind));
  face.style.setProperty('--champ', colour);
  const tag = el('span', { className: 'pd-champ-tag', textContent: text.name });
  tag.style.setProperty('--champ', colour);
  const icon = el('i', { className: 'pd-mbuff large' });
  icon.style.setProperty('--ix', String(CHAMPION_ICON[champion]));
  const name = el('b', { textContent: text.name });
  name.style.color = colour;
  const box = windowOf(
    { title: mobName(mob), icon: face, onClose, className: 'pd-mob-window' },
    el('div', { className: 'pd-mob-hp' }, healthBar(Math.max(0, mob.hp), mob.ht)),
    ...paragraphs(lines),
    el('ul', { className: 'pd-mob-buffs' }, el('li', {}, icon, el('span', {}, name, text.desc))),
  );
  box.querySelector('.pd-titles')!.append(tag);
  show(box, onClose);
}

/** A ghoul lying crumpled (GhoulLifeLink): playing dead beside the one that holds it up, until it rises. */
export function showFallenGhoul(mob: Mob, turns: number, of: number, onClose: () => void = hideOverlay): void {
  const bar = healthBar(0, mob.ht);
  bar.classList.add('fallen');
  const pips = el('span', { className: 'pd-rise-pips' });
  pips.ariaLabel = String(turns);
  const left = Math.ceil((3 * Math.max(0, turns)) / Math.max(1, of));
  for (let i = 0; i < 3; i++) pips.append(el('i', { className: i < left ? 'on' : '' }));
  const tag = el('span', { className: 'pd-champ-tag dead', textContent: t.mobLines.ghoulTag });
  const box = windowOf(
    { title: mobName(mob), icon: el('span', { className: 'pd-mob-face' }, el('i', { className: 'pd-ghoul-fallen' })), onClose, className: 'pd-mob-window' },
    el('div', { className: 'pd-mob-hp' }, bar, pips),
    ...paragraphs([...mobDescription(mob), t.mobLines.ghoulRiseIn(turns)]),
  );
  box.querySelector('.pd-titles')!.append(tag);
  show(box, onClose);
}

/** An ebony mimic still hidden: a suspicious outline, and not much to say about it. */
export function showHiddenMimic(mob: Mob, onClose: () => void = hideOverlay): void {
  show(
    windowOf(
      { title: mobName(mob), icon: el('span', { className: 'pd-mob-face' }, el('i', { className: 'pd-ebony-hidden' })), onClose, className: 'pd-mob-window' },
      ...paragraphs(mobDescription(mob)),
    ),
    onClose,
  );
}
