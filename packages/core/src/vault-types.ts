import type { Item } from './items';

/*
 * The shapes the dwarven vault (Shattered v4's imp quest) keeps on the world's plain data: what its
 * characters carry beyond a Mob's usual fields (Mob.vault), what its floor keeps (Floor.vault: the
 * flame vents, the greater elemental's spells, the final room), and the quest's stored belongings.
 * The rules are in imp.ts, vault.ts, vaultmobs.ts and vaultboss.ts; the level in level/gen/vault-level.ts.
 */

/** Mob.vault: the vault's characters' own fields. */
export interface VaultMob {
  /* VaultSentry: a cone scanned a direction (or several) at a time, in turn. */
  scanWidth?: number;
  scanLength?: number;
  scanDirs?: number[][];
  scanDirIdx?: number;
  /* VaultSentry and VaultLaser: turns to the next scan or shot, after one, and how many in a row. */
  curCooldown?: number;
  afterScanCooldown?: number;
  scansAfterCooldown?: number;
  scansMade?: number;
  giveWarning?: boolean;
  /** VaultSentry.recentZaps: who it zapped last turn (zapped again, they take less). */
  recentZaps?: string[];
  /* VaultLaser: the cells it fires at, in turn. */
  laserDirs?: number[];
  laserDirIdx?: number;
  afterShotCooldown?: number;
  shotsAfterCooldown?: number;
  shotsFired?: number;
  /** VaultMirror.reward: the hero class's item it holds, until taken. */
  reward?: Item | null;
  /* Mob.activateSteathGameplayBehaviour: the stealth gameplay's wandering and investigating. */
  stealth?: boolean;
  wanderPositions?: number[];
  wanderPosIdx?: number;
  investigatingTurns?: number;
  /** Char.previousPos: where it stood before its last step (which way it faces). */
  previousPos?: number;
  /** VaultShaman.type: its debuff (0-1 weakness, 2-3 vulnerability, 4 hex). */
  shamanType?: number;
  /** Elemental.rangedCooldown, DM200.ventCooldown, Golem's teleport cooldowns. */
  rangedCooldown?: number;
  ventCooldown?: number;
  selfTeleCooldown?: number;
  enemyTeleCooldown?: number;
  /** Mob.maxLvl, when not the kind's: the many-enemy room's ghouls drop no token (0). */
  maxLvl?: number;
  /** VaultBossElemental's state. */
  boss?: VaultBoss;
}

export type ElementalForm = 'fire' | 'frost' | 'shock';

/** VaultBossElemental: its form, how often each is left, its cooldowns and the spell it is aiming. */
export interface VaultBoss {
  form: ElementalForm;
  formChances: [number, number, number];
  envAttackCooldown: number;
  spAttackCooldown: number;
  spTargetCell: number;
  lastEnemyPos: number;
  lightningOfs: number;
  weakAnnounced: boolean;
}

/** VaultLevel.VaultFlameTrap.setupTrap, as a blob the level is made with (Blob.seed of VaultFlameTraps). */
export interface VaultFlameSpawn {
  kind: 'VaultFlameTraps';
  cell: number;
  amount: number;
  initialCD: number;
  afterTriggerCD: number;
  triggers: number;
}

/** The greater elemental's lingering spells (its buffs FireWall, FrostCone, FrostVortex, LightningChase). */
export type BossSpell =
  | { kind: 'fireWall'; cells: number[]; direction: number; left: number }
  | { kind: 'frostCone'; startPos: number; cells: number[]; distance: number }
  | { kind: 'frostVortex'; targetCell: number; distance: number; fullVortex: boolean; altDirection: boolean }
  | { kind: 'lightningChase'; direction: number; curCell: number; midCell: number; endCell: number };

/** Floor.vault: what the vault keeps turn by turn. */
export interface VaultFloor {
  /** When the vault's own turn (its blobs and spells) next comes. */
  at: number;
  /** VaultFlameTraps: per vent cell, the turns left, after a burst, and bursts at once; and the flames (Blob.cur) per cell. */
  vents: Array<{ cell: number; cur: number; after: number; triggers: number }>;
  flames: Array<[number, number]>;
  /** The final room (VaultFinalRoom): its middle, its two doors, the warning given, and whether the elemental came. */
  final?: { center: number; entryDoor: number; lockedDoor: number; warnState: number; lockTriggered: boolean };
  /** Level.locked: the final room sealed while the greater elemental lives. */
  locked?: boolean;
  /** The elemental's spells under way. */
  spells: BossSpell[];
  /** FrostResist / ShockResist: whoever was frozen or stunned by a spell, until free again (id: turns). */
  resist?: Record<string, number>;
}

/** EscapeCrystal.storedItems: a hero's belongings, kept by the imp while they are in the vault. */
export interface StoredBelongings {
  weapon: Item | null;
  armor: Item;
  /** The artifact, misc and ring slots (Belongings' KindofMisc). */
  artifact: Item | null;
  misc: Item | null;
  ring: Item | null;
  items: Item[];
  gold: number;
}

/** The vault's and the skeleton key's effects (floor.ts Effect): what the client shows and says. */
export type VaultEffect =
  /** A word with the strange mirror: its scene with the item it holds, or (`reward` null) nothing more. */
  | { type: 'vaultMirror'; hero: string; mob: string; reward: Item | null }
  | { type: 'vaultMirrorTaken'; hero: string; item: Item }
  /** A word with the strange door: how many dwarf tokens the hero has; and the door opened. */
  | { type: 'vaultDoor'; hero: string; mob: string; tokens: number }
  | { type: 'vaultDoorOpened'; depth: number; pos: number; hero: string }
  /** A scanning sentry's sweep over these cells (GameScene.checkedCell), and its lightning striking someone. */
  | { type: 'vaultScan'; depth: number; mob: string; cells: number[] }
  | { type: 'vaultZap'; depth: number; mob: string; to: number; who: string }
  /** A disintegration ray, from a sentry to where it stopped. */
  | { type: 'vaultRay'; depth: number; mob: string; from: number; to: number }
  /** Cells about to be struck (GameScene.targetedCell): marked for a turn. */
  | { type: 'vaultTarget'; depth: number; cells: number[] }
  /** Flames bursting from the vents (VaultFlameTraps), or a spell of the greater elemental's, on these cells. */
  | { type: 'vaultFlames'; depth: number; cells: number[] }
  | { type: 'vaultSpell'; depth: number; spell: 'fireball' | 'fireWall' | 'frost' | 'lightning'; cells: number[]; from?: number }
  /** The final room: the imp's words as the hero comes in (prepared or not), and the charging-up warning. */
  | { type: 'vaultWarning'; hero: string; line: 'unprepared' | 'prepared' | 'final' }
  /** The final room sealed as the greater elemental appears, and open again once it falls. */
  | { type: 'vaultSealed'; depth: number; sealed: boolean; mob?: string }
  /** The greater elemental took a form; its resistances and weaknesses as they show. */
  | { type: 'vaultBossForm'; depth: number; mob: string; form: ElementalForm }
  | { type: 'vaultBossLine'; depth: number; hero: string; line: 'fireResist' | 'fireWeak' | 'frostResist' | 'frostWeak' | 'shockResist' | 'shockWeak' }
  /** The imp's word when the hero is badly hurt in the vault (once a run; `locked`: the final room is sealed). */
  | { type: 'vaultInjured'; hero: string; locked: boolean }
  /** Out of the vault with the escape crystal: the score, and what came along (null: nothing). */
  | { type: 'vaultLeft'; hero: string; score: number; item: Item | null }
  /** A dwarf token thrown away: with the mirror used, they are of no more use (DwarfToken.discard). */
  | { type: 'tokenDiscarded'; hero: string }
  /** A vault guard caught sight of someone and goes to look (sprite.showInvestigate). */
  | { type: 'investigating'; depth: number; mob: string }
  /** The skeleton key used on a cell: a lock opened, a door locked, a chest opened, a wall raised; its level up; keys thrown away. */
  | { type: 'skeletonKey'; hero: string; target: number; use: 'unlock' | 'unlockCrystal' | 'relock' | 'lock' | 'chest' | 'wall'; cells?: number[] }
  | { type: 'keyLevelUp'; hero: string }
  | { type: 'keysDiscarded'; hero: string };
