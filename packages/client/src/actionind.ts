import {
  abilityKind, duelistCharges, hasTimer, itemSprite, monkEmpowered, monkEnergy, wearsForce, classState,
  ambushRange, berserkOf, bowOf, canBerserk, comboOf, type Hero, highestMove, isAlive, isInvisible, momentumOf, prepTurns, type World,
} from '@pd/core';
import { audio } from './audio';
import { t } from './i18n';
import { el } from './screens';
import { hicon, sitem } from './talentui';
import { tal } from './talenttext';
import { quickSpellOf, SPELL_ICON } from './classui';

/*
 * ActionIndicator (ui/ActionIndicator.java): the subclasses' special actions, shown as buttons while they can be used: the
 * berserker's rage at full, the gladiator's combo (its moves open in a window), the freerunner's momentum, the assassin's prepared
 * strike while unseen, the sniper's mark with the bow; and, after design v22, the Duelist's weapon ability (ready, charging, aiming),
 * the Champion's swap of weapons, the brawler's stance, the Monk's abilities and the Cleric's quick spell. Each button is a tile
 * of the colour Shattered's indicatorColor() gives it, with the action's icon (hero_icons.png or the weapon) and a number.
 */

export type ActionKind = 'berserk' | 'combo' | 'freerun' | 'ambush' | 'snipe' | 'monk' | 'swap' | 'stance' | 'weapon' | 'quick';

export interface ActionIndicatorHandlers {
  use(kind: ActionKind): void;
}

/** HeroIcon.BERSERK, COMBO, PREPARATION, MOMENTUM, SNIPERS_MARK, MONK_ABILITIES. */
const ICONS: Readonly<Partial<Record<ActionKind, number>>> = { berserk: 104, combo: 105, ambush: 106, freerun: 107, snipe: 108, monk: 110 };
/** HeroIcon.SPELL_ACTION_OFFSET: a spell's icon on the action button is the spell's own + 32 (no tile behind it). */
export const SPELL_ACTION_OFFSET = 32;

/** ActionIndicator.Action.indicatorColor(): ready, spent, and a combo move's (its colour × 0.875). */
const READY = '#5500bb';
const SPENT = '#444444';
const COMBO_COLOR = ['#dfdfdf', '#00df00', '#b2df00', '#dfdf00', '#dfb200', '#df0000'] as const;
const COMBO_ORDER = ['clobber', 'slam', 'parry', 'crush', 'fury'] as const;

interface Offer {
  kind: ActionKind;
  /** The number beside the icon (rage in percent, the combo, momentum, turns prepared, turns the mark lasts, charges, energy). */
  number: number | string;
  label: string;
  /** indicatorColor(). */
  color: string;
  /** The icon, a weapon or a spell or a HeroIcon. */
  icon: () => HTMLElement;
  /** `charging`: the share gathered towards the next charge. */
  fill?: number;
  /** `stance` on, `monk` and so on. */
  on?: boolean;
  /** A second weapon for the swap button. */
  spare?: () => HTMLElement;
  /** The number is grey (nothing to show). */
  zero?: boolean;
}

/** What the hero can do now. */
export function actionsOf(world: World, hero: Hero): Offer[] {
  if (!isAlive(hero)) return [];
  const offers: Offer[] = [];
  const rage = berserkOf(hero);
  if (rage && canBerserk(hero)) {
    offers.push({ kind: 'berserk', number: `${Math.floor(rage.power * 100)}%`, label: tal('actors.buffs.berserk.action_name'), color: '#660000', icon: () => hicon(ICONS.berserk!) });
  }
  const combo = comboOf(hero);
  const move = combo ? highestMove(combo) : null;
  if (combo && move) {
    offers.push({ kind: 'combo', number: combo.count, label: tal('actors.buffs.combo.action_name'), color: COMBO_COLOR[COMBO_ORDER.indexOf(move) + 1]!, icon: () => hicon(ICONS.combo!) });
  }
  const momentum = momentumOf(hero);
  if (momentum && momentum.stacks > 0 && momentum.freerunTurns <= 0) {
    offers.push({ kind: 'freerun', number: momentum.stacks, label: tal('actors.buffs.momentum.action_name'), color: SPENT, icon: () => hicon(ICONS.freerun!) });
  }
  if (prepTurns(hero) !== undefined && isInvisible(hero) && ambushRange(hero) > 0) {
    offers.push({ kind: 'ambush', number: Math.min(9, prepTurns(hero)!), label: tal('actors.buffs.preparation.action_name'), color: SPENT, icon: () => hicon(ICONS.ambush!) });
  }
  const mark = hero.tal?.sniper;
  if (mark && bowOf(hero)) {
    const augment = bowOf(hero)!.augment;
    const name = augment === 'speed' ? 'volley' : augment === 'damage' ? 'sniper' : 'snapshot';
    offers.push({ kind: 'snipe', number: '', label: tal(`actors.buffs.snipersmark.action_name_${name}`), color: SPENT, icon: () => hicon(ICONS.snipe!) });
  }
  // The Duelist's weapon ability (MeleeWeapon.Charger as an Action): the weapon in hand, its charges, and whether one can be spent now.
  const weapon = hero.weapon;
  if (hero.heroClass === 'duelist' && weapon && abilityKind(weapon)) {
    const kind = abilityKind(weapon);
    const free = (kind === 'cleave' && hasTimer(hero, 'cleave')) || (kind === 'spin' && hasTimer(hero, 'spin'));
    const have = Math.floor(duelistCharges(hero));
    const ready = free || have >= 1;
    offers.push({
      kind: 'weapon', number: have, label: `${t.v22.ready}: ${have}`, color: ready ? READY : SPENT, icon: () => sitem(itemSprite(weapon, world.run.labels)),
      ...(ready ? {} : { fill: classState(hero).partial ?? 0 }), zero: !ready,
    });
  }
  // MonkEnergy: abilities while there is energy; the Champion's swap of weapons; the Duelist's brawler's stance with a ring of force.
  if (hero.subclass === 'monk' && monkEnergy(hero) >= 1) {
    offers.push({ kind: 'monk', number: Math.floor(monkEnergy(hero)), label: tal('actors.buffs.monkenergy.action'), color: monkEmpowered(hero) ? '#aaee22' : '#a08840', icon: () => hicon(ICONS.monk!) });
  }
  if (hero.subclass === 'champion' && weapon) {
    const second = hero.secondWep;
    offers.push({
      kind: 'swap', number: '', label: t.v22.swapWeapons, color: READY, icon: () => sitem(itemSprite(weapon, world.run.labels)),
      spare: () => (second ? sitem(itemSprite(second, world.run.labels)) : el('i')),
    });
  }
  if (hero.heroClass === 'duelist' && wearsForce(hero)) {
    const on = !!classState(hero).brawl?.active;
    offers.push({
      kind: 'stance', number: on ? t.v22.stanceOn : t.v22.stanceOff, label: tal('items.rings.ringofforce.ability_name') || t.v22.stance, color: READY, on, zero: !on,
      icon: () => {
        // DUEL_BRAWL, large_buffs 65.
        const icon = el('i', { className: 'pd-tbuff2 large' });
        icon.style.setProperty('--ix', '1');
        icon.style.setProperty('--iy', '4');
        return icon;
      },
    });
  }
  // The Cleric's quick spell: its icon + 32, a dark blue tile (a free spell is brighter).
  const quick = quickSpellOf(world, hero);
  if (quick) {
    const cost = quick.cost(hero, world);
    offers.push({
      kind: 'quick', number: '', label: t.v22.quick, color: cost <= 0 ? '#0063ff' : '#002157', icon: () => hicon((SPELL_ICON[quick.id] ?? 40) + SPELL_ACTION_OFFSET),
    });
  }
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

  /** `aiming`: the action whose target the player is choosing now (the weapon's ability), so its button blinks gold. */
  update(world: World, hero: Hero, aiming?: ActionKind): void {
    const offers = actionsOf(world, hero);
    const key = offers.map((offer) => `${offer.kind}:${offer.number}:${offer.color}:${offer.on ?? ''}:${Math.floor((offer.fill ?? 0) * 8)}:${aiming === offer.kind ? 'a' : ''}`).join();
    if (key === this.shown) return;
    this.shown = key;
    this.root.replaceChildren(
      ...offers.map((offer) => {
        const isAiming = aiming === offer.kind;
        const classes = ['pd-actind', offer.kind === 'swap' ? 'swap' : '', offer.kind === 'stance' ? `stance${offer.on ? ' on' : ''}` : '', offer.fill !== undefined ? 'charging' : '', isAiming ? 'aiming' : '']
          .filter(Boolean).join(' ');
        const node = el('button', { className: classes });
        node.style.setProperty('--ind', offer.color);
        if (offer.fill !== undefined) node.style.setProperty('--v', String(offer.fill));
        if (offer.kind === 'swap') {
          node.append(el('span', { className: 'pd-wslot' }, offer.icon()), el('i', { className: 'pd-swap-ico' }), el('span', { className: 'pd-wslot spare' }, offer.spare!()));
        } else {
          node.append(offer.icon());
          if (offer.number !== '') node.append(el('span', { className: `pd-actind-n${offer.zero ? ' zero' : ''}`, textContent: String(offer.number) }));
        }
        if (offer.fill !== undefined) node.append(el('span', { className: 'pd-actind-fill' }));
        if (isAiming) {
          node.append(el('i', { className: 'pd-actind-aim' }));
          node.setAttribute('aria-pressed', 'true');
          node.title = t.v22.aimWord;
        } else if (offer.kind === 'weapon') node.setAttribute('aria-pressed', 'false');
        if (offer.kind === 'stance') node.setAttribute('aria-pressed', String(!!offer.on));
        node.ariaLabel = isAiming ? t.v22.aimWord : offer.label;
        if (!isAiming) node.title = offer.label;
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
