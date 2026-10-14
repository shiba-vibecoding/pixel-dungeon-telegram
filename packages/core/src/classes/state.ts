import type { Hero, Mob } from '../actors';
import type { Item, ItemKind } from '../items';

/*
 * What the Duelist and the Cleric keep on a hero or a monster, as plain data (the classes stream).
 *
 * Shattered keeps these as buffs; most of them are FlavourBuffs, which last a number of turns of the clock
 * they were set on. Here a timer is the moment on the depth's clock at which it ends (`until`), set from the
 * hero's own time, so that a monster acting between two of the hero's turns sees it exactly as long as the
 * buff would have lasted (`hero.cooldown()`-long ones end when the hero's next turn begins, see `timerFor`).
 */

/** Everything a Duelist, a Monk, a Champion or a Cleric keeps on the hero beyond the shared fields. */
export interface ClassState {
  /** FlavourBuffs: key → the hero-clock time they end at. */
  until?: Record<string, number>;
  /** Buffs set during an action that last "until the hero's next turn" plus so much: key → the extra (settled when the hero spends time). */
  pending?: Record<string, number>;

  /* The Duelist */
  /** MeleeWeapon.Charger: charges, and the share gathered towards the next. */
  charges?: number;
  partial?: number;
  /** Sai.ComboStrikeTracker: hits in a row, the time left to land the next, and the time it began with. */
  combo?: { hits: number; left: number; initial: number };
  /** Flail.SpinAbilityTracker: spins gathered (a timer 'spin' keeps them). */
  spins?: number;
  /** RoundShield.GuardTracker: whether it has blocked a blow (a timer 'guard' keeps it). */
  blocked?: boolean;
  /** Crossbow.ChargedShot: the next shot is charged. */
  charged?: boolean;
  /** RunicBlade.RunicSlashTracker: the damage factor of the slash under way. */
  runic?: number;
  /** ElementalStrike.DirectedPowerTracker: the extra power the next blow's enchantment has. */
  directed?: number;
  /** Sickle.HarvestBleedTracker: the blow under way turns its damage into bleeding. */
  harvest?: boolean;
  /** PatientStrikeTracker: where the hero has been waiting. */
  patient?: number;
  /** PhysicalEmpower: damage added to the next hits, and how many. */
  empower?: { dmg: number; left: number };
  /** GreaterHaste: moves left that cost no time. */
  greaterHaste?: number;
  /** LiquidAgilACCTracker: blows left that cannot miss. */
  liquidUses?: number;
  /** DeadlyFollowupTracker: whom the thrown weapon marked. */
  followup?: string;
  /** VariedChargeTracker: the kind of the weapon whose ability was used last. */
  varied?: string;
  /** CombinedLethalityAbilityTracker: the weapon whose ability was used last. */
  lethality?: string;
  /** CombinedEnergyAbilityTracker: which of the two abilities has been used. */
  energyMonk?: boolean;
  energyWep?: boolean;
  /** SwiftEquipCooldown: the second use is still to come. */
  swiftSecond?: boolean;
  /** RingOfForce.BrawlersStance: active, and the turns it must last at least. */
  brawl?: { active: boolean; min: number };

  /* The Monk (MonkEnergy) */
  energy?: number;
  /** Flurry cannot be used twice at one moment (FlurryCooldownTracker): when it was last used. */
  flurryAt?: number;
  /** MonkAbility.Meditate and the other lingering parts of the abilities (their timers are in `until`). */
  meditate?: boolean;

  /* The armour abilities of the Duelist */
  duel?: { left: number; taken: number; foe: string };
  /** Challenge: the moment the elimination match's cheaper duel ends. */
  /** Feint: where the afterimage stands. */
  feint?: { pos: number; left: number; id: string };

  /* The Cleric */
  /** The cleric's quick spell (HolyTome.quickSpell). */
  quick?: string;
  /** Spells and the buffs they leave on the hero (the flags: satiated spells). */
  holy?: Record<string, number>;
  /** ShieldOfLightTracker.object: the foe whose blows the shield eases. */
  lightFoe?: string;
  /** RecallInscription.UsedItemTracker.item: the scroll or runestone to cast again. */
  recall?: ItemKind;
  /** AscendedForm.AscendBuff. */
  ascend?: { left: number; shield: number; spellCasts: number; flashCasts: number; divine: boolean };
  /** Stasis.StasisBuff.stasisAlly: the ally put out of time. */
  stasis?: { ally: Mob };
  /** LifeLink.object: the ally the hero is linked to. */
  linkObject?: string;
  /** Statistics.itemTypesDiscovered, for Trinity: the kinds of enchantment, glyph, wand, thrown weapon, ring and artifact seen. */
  seen?: string[];
  /** Trinity: what each of its forms is set to, and the effects under way (body: an enchantment or glyph; spirit: a ring). */
  trinity?: { body?: string; mind?: string; spirit?: string };
  bodyEffect?: string;
  spiritRing?: Item;
}

/** What a spell or an ability leaves on a monster. */
export interface MobMarks {
  /** Turns left of the buffs a monster carries, counted down on its own turns (Daze, ...). */
  t?: Record<string, number>;
  /** SpectatorFreeze: frozen in place while a duel goes on. */
  spectator?: number;
  /** Challenge.DuelParticipant: the duel's turns left and the harm taken. */
  duel?: { left: number; taken: number };
  /** GuidingLight.Illuminated: struck next, the blow does more. */
  lit?: boolean;
  [key: string]: unknown;
}

/** The hero's class state, started on first use. */
export const cs = (hero: Hero): ClassState => (hero.cls ??= {});

/** A monster's marks, started on first use. */
export const marks = (mob: Mob): MobMarks => (mob.marks ??= {});

/* Timers: FlavourBuffs on the hero's clock */

/** Whether a timer is running at a moment (the hero's own time by default; a monster's turn passes its own). */
export function hasTimer(hero: Hero, key: string, at: number = hero.time): boolean {
  if (hero.cls?.pending?.[key] !== undefined) return true;
  return (hero.cls?.until?.[key] ?? -Infinity) > at;
}

/** Turns left of a timer (0 when it is not running). */
export function timerLeft(hero: Hero, key: string): number {
  if (hero.cls?.pending?.[key] !== undefined) return hero.cls.pending[key]! + 1;
  return Math.max(0, (hero.cls?.until?.[key] ?? 0) - hero.time);
}

/** Buff.prolong(hero, X, duration): runs for at least that long from now. */
export function prolong(hero: Hero, key: string, duration: number): void {
  const state = cs(hero);
  state.until ??= {};
  state.until[key] = Math.max(state.until[key] ?? 0, hero.time + duration);
}

/** Buff.affect(hero, X, duration) on a FlavourBuff already there: that much longer. */
export function addTimer(hero: Hero, key: string, duration: number): void {
  const state = cs(hero);
  state.until ??= {};
  state.until[key] = Math.max(state.until[key] ?? 0, hero.time) + duration;
}

/** Buff.affect(hero, X, duration): runs that long from now, replacing what was left. */
export function setTimer(hero: Hero, key: string, duration: number): void {
  const state = cs(hero);
  (state.until ??= {})[key] = hero.time + duration;
}

/**
 * Buff.prolong(hero, X, hero.cooldown() + extra): lasts until the hero's next turn, and `extra` more. The hero
 * is in the middle of the action that sets it, so the end is settled when the action's time is spent (settle).
 */
export function prolongForAction(hero: Hero, key: string, extra = 0): void {
  const state = cs(hero);
  const old = state.pending?.[key];
  (state.pending ??= {})[key] = Math.max(old ?? -Infinity, extra);
}

/** Called once the hero has spent the time of an action: what lasts "until the next turn" now has its end. */
export function settleTimers(hero: Hero): void {
  const state = hero.cls;
  if (!state?.pending) return;
  for (const [key, extra] of Object.entries(state.pending)) {
    (state.until ??= {})[key] = Math.max(state.until[key] ?? 0, hero.time + extra);
  }
  delete state.pending;
}

/** Buff.detach. */
export function clearTimer(hero: Hero, key: string): void {
  if (hero.cls?.until) delete hero.cls.until[key];
  if (hero.cls?.pending) delete hero.cls.pending[key];
}

/** Whether the hero holds an item (it is the weapon in hand, the second one, or in the pack): by reference. */
export const holds = (hero: Hero, item: Item): boolean =>
  hero.weapon === item || hero.secondWep === item || hero.items.includes(item);

/* A monster's buffs are counted in its own turns. */

/** Whether a monster carries a buff of the classes' (turns left). */
export const markTurns = (mob: Mob, key: string): number => mob.marks?.t?.[key] ?? 0;

/** Buff.prolong(mob, X, turns). */
export function prolongMark(mob: Mob, key: string, turns: number): void {
  const m = marks(mob);
  (m.t ??= {})[key] = Math.max(m.t[key] ?? 0, turns);
}

/** Buff.detach. */
export function clearMark(mob: Mob, key: string): void {
  if (mob.marks?.t) delete mob.marks.t[key];
}

/** A monster's turn: its buffs wear down by one. */
export function markTurn(mob: Mob): void {
  const t = mob.marks?.t;
  if (!t) return;
  for (const key of Object.keys(t)) {
    // PowerBuff.act: it waits while a beaming ray or a life link is on the ally.
    if (key === 'power' && ((t.beam ?? 0) > 0 || (t.lifeLinkSpell ?? 0) > 0)) continue;
    t[key]! -= 1;
    if (t[key]! <= 0) delete t[key];
  }
}

/* Trinity's body form: an enchantment or a glyph lent for a while (BodyForm.BodyFormBuff) */

/** The enchantment or glyph of the body form, while it lasts. */
export function bodyForm(hero: Hero): { enchant?: string; glyph?: string } | undefined {
  const effect = hero.cls?.bodyEffect;
  if (!effect || !hasTimer(hero, 'bodyForm')) return undefined;
  return effect.startsWith('enchant:') ? { enchant: effect.slice(8) } : { glyph: effect.slice(6) };
}

/** Armor.hasGlyph for a hero: the armour's glyph, or the one the body form lends. */
export const hasGlyph = (hero: Hero, glyph: string): boolean => hero.armor.glyph === glyph || bodyForm(hero)?.glyph === glyph;

/** SpiritForm.SpiritFormBuff.ring(): the ring whose passive effect the hero has for a while. */
export function spiritRing(hero: Hero): Item | undefined {
  const item = hero.cls?.spiritRing;
  return item && item.kind.startsWith('ring.') && hasTimer(hero, 'spirit') ? item : undefined;
}

/** SpiritFormBuff.artifact() when it is the chalice: the level its regeneration has. */
export function spiritChalice(hero: Hero): Item | undefined {
  const item = hero.cls?.spiritRing;
  return item && item.kind === 'artifact.chalice' && hasTimer(hero, 'spirit') ? item : undefined;
}
