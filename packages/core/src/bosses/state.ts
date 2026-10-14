import type { Item } from '../items';
import type { Mob, MobKind } from '../actors';

/*
 * The state of Shattered Pixel Dungeon's five boss fights, as plain data: what
 * each boss keeps (Goo's pumping up, Tengu's abilities, DM-300's pylons and
 * supercharge, the Dwarf King's phases and summons, Yog-Dzewa's phases, its
 * fists and its beams), and what their levels keep (Level.locked, the boss
 * health bar, PrisonBossLevel's state, the buffs and blobs the fights leave
 * on the floor). The rules are in the files beside this one.
 */

/** What a boss (or one of its fists or pylons) keeps between turns, on its Mob. */
export interface BossMob {
  /* Goo */
  /** Goo.pumpedUp: 0, or how far it has pumped itself up (two is ready to strike). */
  pumpedUp?: number;
  /** Goo.healInc: how much the murky water heals it a turn. */
  healInc?: number;

  /* Tengu */
  lastAbility?: number;
  abilitiesUsed?: number;
  arenaJumps?: number;
  abilityCooldown?: number;

  /* DM-300 */
  pylonsActivated?: number;
  supercharged?: boolean;
  chargeAnnounced?: boolean;
  turnsSinceLastAbility?: number;

  /* The Dwarf King */
  phase?: number;
  summonsMade?: number;
  summonCooldown?: number;

  /* Yog-Dzewa */
  fistSummons?: MobKind[];
  challengeSummons?: MobKind[];
  regularSummons?: MobKind[];
  /** Where its beams will strike, once the hero has had a turn to step aside. */
  targetedCells?: number[];

  /* The fists */
  rangedCooldown?: number;

  /** DwarfKing.KingDamager: a subject summoned while the King sat on his throne; its death breaks his shield. */
  kingDamager?: boolean;
  /** DM-300 and the fists: the warning that it cannot be hurt has been given. */
  invulnWarned?: boolean;

  /* A pylon: switched on (Alignment.ENEMY), and the neighbour its arcs start from. */
  active?: boolean;
  targetNeighbor?: number;
}

/** PrisonBossLevel.State. */
export type PrisonState = 'start' | 'fightStart' | 'fightPause' | 'fightArena' | 'won';

/**
 * A buff or delayed effect of a boss fight, acting on the depth's clock (Actor.time): each acts
 * when its time comes, after heroes and monsters due at the same moment (BUFF_PRIO).
 */
export type Timed = { time: number; owner: string; urgent?: boolean } & (
  /** Tengu.BombAbility: a bomb counting down (3, 2, 1), then blasting everything within two steps. */
  | { kind: 'bomb'; pos: number; timer: number }
  /** Tengu.FireAbility: a wave of fire rolling out in a direction (CIRCLE8 index). */
  | { kind: 'fire'; direction: number; cells: number[] | null; origin: number }
  /** Tengu.ShockerAbility: a shocker arcing, its diagonals and its sides by turns. */
  | { kind: 'shocker'; pos: number; ordinals: boolean | null }
  /** DM300.FallingRockBuff (DelayedRockFall): rocks about to fall on these cells. */
  | { kind: 'rocks'; cells: number[] }
  /** DM300.ventGas: the gas let out just before its target's next turn. */
  | { kind: 'vent'; from: number; collision: number; path: number[] }
  /** DwarfKing.Summoning: a summoning circle on a pedestal, `delay` turns from bringing someone forth. */
  | { kind: 'summoning'; pos: number; summon: MobKind; delay: number }
  /** LifeLink: two characters sharing every blow, for a while. */
  | { kind: 'lifeLink'; a: string; b: string }
  /** Viscosity.DeferedDamage on a boss (the King's last phase, the rusted fist): a tenth of it a turn. */
  | { kind: 'deferred'; mob: string; damage: number }
  /** Barrier on a boss (DM-300's charge from the wires, the King's shield): fading a little every turn. */
  | { kind: 'barrier'; mob: string; partial: number; holds?: boolean }
  /** Bleeding on the rotting fist (its hurt turned to bleeding). */
  | { kind: 'bleeding'; mob: string; level: number }
  /** The blobs of a boss fight (Tengu's fire and shockers, the pylons' energy): a turn of them. */
  | { kind: 'blobs' }
  /** Tengu jumps away once the blow that hurt him is done; the arena's fight ends (urgent: VFX_PRIO). */
  | { kind: 'jump' }
  | { kind: 'progress' }
);

/** What a boss's level keeps (Floor.boss). */
export interface BossFloor {
  /** Level.locked: the fight has sealed the floor. */
  locked?: boolean;
  /** BossHealthBar: whose health it shows, and whether it bleeds (the boss's last stand). */
  bar?: string;
  bleed?: boolean;
  /** PrisonBossLevel: where the fight is, Tengu while he is away from the level, what was put aside. */
  prison?: PrisonState;
  tengu?: Mob;
  stored?: Item[];
  /** PrisonBossLevel.placeTrapsInTenguCell: the traps of Tengu's cell, faded from sight. */
  tenguTraps?: number[];
  /** The bosses' buffs and delayed effects. */
  timed: Timed[];
  /** Tengu.FireAbility.FireBlob and ShockerAbility.ShockerBlob, as [cell, volume] pairs. */
  fire?: Array<[number, number]>;
  shock?: Array<[number, number]>;
  /** CavesBossLevel.PylonEnergy: the electrified cells (water and wires while a pylon is on). */
  energy?: number[];
  /** HallsBossLevel: how far the light reaches while Yog darkens the hall (YogDzewa.updateVisibility). */
  viewDistance?: number;
  /** CityBossLevel: the imp's shop has been laid out (ImpShopRoom.impSpawned), and its wares until then. */
  impShop?: boolean;
  impWares?: Item[];
}
