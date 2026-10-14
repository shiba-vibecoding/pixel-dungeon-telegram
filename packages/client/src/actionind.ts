import {
  ambushRange, berserkOf, bowOf, canBerserk, comboOf, type Hero, highestMove, isAlive, isInvisible, momentumOf, prepTurns, type World,
} from '@pd/core';
import { audio } from './audio';
import { el } from './screens';
import { hicon } from './talentui';
import { tal } from './talenttext';

/*
 * ActionIndicator (ui/ActionIndicator.java): the subclasses' special actions, shown as buttons while they can be used: the
 * berserker's rage at full, the gladiator's combo (its moves open in a window), the freerunner's momentum, the assassin's prepared
 * strike while unseen, the sniper's mark with the bow. Each button wears the action's icon (hero_icons.png) and a number.
 */

export type ActionKind = 'berserk' | 'combo' | 'freerun' | 'ambush' | 'snipe';

export interface ActionIndicatorHandlers {
  use(kind: ActionKind): void;
}

/** HeroIcon.BERSERK, COMBO, PREPARATION, MOMENTUM, SNIPERS_MARK. */
const ICONS: Readonly<Record<ActionKind, number>> = { berserk: 104, combo: 105, ambush: 106, freerun: 107, snipe: 108 };

interface Offer {
  kind: ActionKind;
  /** The number beside the icon (rage in percent, the combo, momentum, turns prepared, turns the mark lasts). */
  number: number;
  label: string;
}

/** What the hero can do now. */
export function actionsOf(world: World, hero: Hero): Offer[] {
  if (!isAlive(hero)) return [];
  const offers: Offer[] = [];
  const rage = berserkOf(hero);
  if (rage && canBerserk(hero)) offers.push({ kind: 'berserk', number: Math.floor(rage.power * 100), label: tal('actors.buffs.berserk.action_name') });
  const combo = comboOf(hero);
  if (combo && highestMove(combo)) offers.push({ kind: 'combo', number: combo.count, label: tal('actors.buffs.combo.action_name') });
  const momentum = momentumOf(hero);
  if (momentum && momentum.stacks > 0 && momentum.freerunTurns <= 0) offers.push({ kind: 'freerun', number: momentum.stacks, label: tal('actors.buffs.momentum.action_name') });
  if (prepTurns(hero) !== undefined && isInvisible(hero) && ambushRange(hero) > 0) {
    offers.push({ kind: 'ambush', number: Math.min(9, prepTurns(hero)!), label: tal('actors.buffs.preparation.action_name') });
  }
  const mark = hero.tal?.sniper;
  if (mark && bowOf(hero)) {
    const augment = bowOf(hero)!.augment;
    const name = augment === 'speed' ? 'volley' : augment === 'damage' ? 'sniper' : 'snapshot';
    offers.push({ kind: 'snipe', number: Math.ceil(mark.left), label: tal(`actors.buffs.snipersmark.action_name_${name}`) });
  }
  void world;
  return offers;
}

export class ActionIndicator {
  readonly root: HTMLElement;
  private shown = '';

  constructor(private readonly handlers: ActionIndicatorHandlers) {
    this.root = el('nav', { className: 'pd-actionind' });
    this.root.ariaLabel = 'Actions';
    this.root.hidden = true;
    document.getElementById('ui')?.append(this.root);
  }

  update(world: World, hero: Hero): void {
    const offers = actionsOf(world, hero);
    const key = offers.map((offer) => `${offer.kind}:${offer.number}`).join();
    if (key === this.shown) return;
    this.shown = key;
    this.root.replaceChildren(
      ...offers.map((offer) => {
        const node = el('button', { className: `pd-actionbtn ${offer.kind}` }, hicon(ICONS[offer.kind]), el('b', { textContent: String(offer.number) }));
        node.ariaLabel = offer.label;
        node.title = offer.label;
        node.onclick = () => {
          audio.play('click');
          this.handlers.use(offer.kind);
        };
        return node;
      }),
    );
    this.root.hidden = offers.length === 0;
  }
}
