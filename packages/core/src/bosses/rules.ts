import type { Hero, Mob } from '../actors';
import type { Char, Ctx } from '../floor';
import type { Hazard } from '../combat';

/*
 * The hooks a boss (or one of its minions) fills in where it differs from an
 * ordinary monster: Mob's and Char's methods Shattered's boss classes override.
 * Anything left out is the ordinary monster's (ai.ts, combat.ts).
 */
export interface BossRules {
  /** Char.attackSkill against a target. */
  attackSkill?(ctx: Ctx, mob: Mob, target: Char): number;
  /** Mob.defenseSkill, while it has seen its enemy (a monster caught unawares has none). */
  defenseSkill?(mob: Mob): number;
  /** Char.damageRoll. */
  damageRoll?(ctx: Ctx, mob: Mob): number;
  /** Char.drRoll: what its armour takes off a blow. */
  drRoll?(ctx: Ctx, mob: Mob): number;
  /** Char.attackProc: what its blow does besides the damage; returns the damage. */
  attackProc?(ctx: Ctx, mob: Mob, enemy: Char, damage: number): number;
  /** Char.defenseProc: what being struck does to the striker or around; returns the damage. */
  defenseProc?(ctx: Ctx, mob: Mob, enemy: Char, damage: number): number;
  /** Mob.act: true when its whole turn was taken here; false to go on to an ordinary monster's turn. */
  act?(ctx: Ctx, mob: Mob): boolean;
  /** Mob.canAttack. */
  canAttack?(ctx: Ctx, mob: Mob, enemy: Char): boolean;
  /** Mob.doAttack: its attack, and the time it takes. */
  doAttack?(ctx: Ctx, mob: Mob, enemy: Char): void;
  /** Mob.getCloser: true if it moved (or did what stands for it); undefined for the ordinary way. */
  getCloser?(ctx: Ctx, mob: Mob, target: number, fov: boolean[]): boolean | undefined;
  /** Mob.notice: it has seen its enemy (a hero, or one of the heroes' allies). */
  notice?(ctx: Ctx, mob: Mob, hero?: Hero): void;
  /**
   * Char.damage, before health is lost: the damage that gets through (after shields and the like),
   * or null when none does, or it was all turned into something else (bleeding, deferred damage).
   */
  beforeDamage?(ctx: Ctx, mob: Mob, damage: number, source: Char | Hazard): number | null;
  /** Char.damage, after health was lost: phases, brackets, the floor's healing time. */
  afterDamage?(ctx: Ctx, mob: Mob, before: number, source: Char | Hazard): void;
  /** Char.isAlive overridden: it holds on at no health (Tengu until his arena's fight ends). */
  holdsOn?(ctx: Ctx, mob: Mob): boolean;
  /** Mob.die: what its death brings about, after it is gone from the level. */
  die?(ctx: Ctx, mob: Mob, by?: string): void;
  /** Mob.viewDistance, if not the level's. */
  sight?: number;
  /** Mob.beckon: false when it does not heed (pylons, Yog). */
  beckon?: false;
  /** Immune to a condition (Char.immunities). */
  immune?: ReadonlySet<string>;
}
