import type { Hero } from '../actors';

/*
 * What the talents and the subclasses keep on a hero as time goes by: Talent's trackers and cooldowns (the
 * FlavourBuffs and CounterBuffs of Talent.java) and the buffs of the subclasses (Berserk, Combo, Momentum,
 * Preparation, SnipersMark, HoldFast...). Durations are turns left, counted down as the hero spends time; a
 * FlavourBuff is there while its turns are not below zero (it ends at the turn's end, after the hero's last act).
 */

/** Berserk.State. */
export type BerserkState = 'normal' | 'berserk' | 'recovering';

export interface BerserkBuff {
  state: BerserkState;
  /** Berserk.power: rage, 0 to 1 (1.5 with endless rage at its best). */
  power: number;
  /** Berserk.powerLossBuffer: turns before rage starts to fade. */
  buffer: number;
  /** Berserk.levelRecovery (levels to go) and turnRecovery (turns to go) while recovering. */
  levelRecovery: number;
  turnRecovery: number;
  /** The shield (it is a ShieldBuff) while berserk, used last. */
  shield: number;
  /** Deathless fury: berserking on from a death; the hero stands at a single point of health meanwhile (see berserk.ts). */
  deathless?: boolean;
}

/** Combo's state: the count, the time its chain has left, and the moves already spent. */
export interface ComboBuff {
  count: number;
  time: number;
  initialTime: number;
  clobberUsed?: boolean;
  parryUsed?: boolean;
}

/** Momentum's state. */
export interface MomentumBuff {
  stacks: number;
  freerunTurns: number;
  freerunCooldown: number;
  movedLastTurn: boolean;
}

export interface TalentBuffs {
  /* Cooldowns and trackers, turns left. */
  /** ImprovisedProjectileCooldown (50), RejuvenatingStepsCooldown, SeerShotCooldown (20). */
  improvised?: number;
  rejuvenating?: number;
  seerShot?: number;
  /** ProvokedAngerTracker (5), LingeringMagicTracker (5), EmpoweredStrikeTracker (10). */
  provoked?: number;
  lingering?: number;
  empowered?: number;
  /** EnhancedRings (3 per point). */
  enhancedRings?: number;
  /** FollowupStrikeTracker: the target it is for, and turns left (5). */
  followup?: { object: string; left: number };
  /** SnipersMark: the target, its extra damage and turns left (4, more with shared upgrades). */
  sniper?: { object: string; bonus: number; left: number };

  /* Counters (CounterBuffs, which persist through death). */
  /** RejuvenatingStepsFurrow, WandPreservationCounter, CachedRationsDropped, NatureBerriesDropped. */
  furrow?: number;
  preserved?: number;
  rations?: number;
  berries?: number;
  /** Berry.SeedCounter. */
  berrySeeds?: number;

  /* State. */
  /** WarriorFoodImmunity: until when (the hero's time, on that depth) damage is eased. */
  ironStomach?: { until: number; depth: number };
  /** HoldFast: the cell the hero stands rooted on. */
  holdFast?: number;
  /** WandEmpower (damage, zaps left) and ScrollEmpower (zaps left). */
  wandEmpower?: { boost: number; left: number };
  scrollEmpower?: number;
  /** How many scrolls of metamorphosis the hero has read (they seed the options). */
  metamorphs?: number;
  /** AdrenalineSurge (a warden's rotberry): turns left of a point of strength more. */
  surge?: number;
  /** ProtectiveShadowsTracker.barrierInc. */
  shadows?: number;
  /** LethalMomentumTracker: the next act costs no time. */
  lethalMomentum?: boolean;
  /** BountyHunterTracker: a prepared strike was struck this turn (the loot chance in Mob.lootChance). */
  bounty?: boolean;
  prepLevel?: number;
  /** RevealedArea (seer shot): the cell and depth shown, turns left. */
  revealed?: { depth: number; pos: number; left: number };

  /* Subclasses. */
  berserk?: BerserkBuff;
  combo?: ComboBuff;
  /** Combo.ParryTracker: a parry made, good until this time on the depth's clock; whether it parried anything. */
  parry?: { parried: boolean; until: number };
  momentum?: MomentumBuff;
  /** Preparation.turnsInvis, while invisible. */
  prep?: number;
  /** SpiritBow.sniperSpecial: the mark's special shot is flying (extra damage, where it is aimed). */
  special?: { bonus: number; target: number; kind: 'none' | 'speed' | 'damage' };
}

/** A hero's talent trackers, started on first use. */
export const tbOf = (hero: Hero): TalentBuffs => (hero.tal ??= {});

/** Counts a tracker's turns down by `time`; true if it is still there afterwards. */
export function tick<K extends keyof TalentBuffs>(buffs: TalentBuffs, key: K, time: number): boolean {
  const value = buffs[key] as number | undefined;
  if (value === undefined) return false;
  const left = value - time;
  if (left < 0) {
    delete buffs[key];
    return false;
  }
  (buffs[key] as number) = left;
  return true;
}
