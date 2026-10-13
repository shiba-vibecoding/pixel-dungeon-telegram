import type { MobKind } from '@pd/core';

/*
 * Shattered Pixel Dungeon's monster sprites (sprites/<Mob>Sprite.java): the
 * sheet each is cut from (assets/spd/mobs, Shattered's sprites/*.png), the
 * frame size, and each animation's frames and speed as Shattered plays them.
 * A sheet holds a kind and its rare variants side by side, so a variant is
 * the same animations shifted along the sheet (texOffset). Also what bleeds
 * out of them (MobSprite.blood), how dim a sheet is drawn (NecroSkeletonSprite's
 * brightness) and what the sprite gives off while it lives (its emitters).
 */

export interface Anim {
  fps: number;
  frames: readonly number[];
  loop: boolean;
}

/** What a monster's sprite can show beyond idling, walking, striking and dying. */
export type MobAnim = 'zap' | 'charge' | 'crumple' | 'hide' | 'hideStealth' | 'prep' | 'leap' | 'cast';

/** What a living sprite gives off (its emitter in Shattered). */
export type Aura = 'flame' | 'frost' | 'spark' | 'rainbow' | 'stench' | 'light';

export interface MobSheet {
  /** The file in assets/spd/mobs. */
  sheet: SpdSheet;
  w: number;
  h: number;
  idle: Anim;
  run: Anim;
  attack: Anim;
  die: Anim;
  more?: Partial<Record<MobAnim, Anim>>;
  /** A second way to strike, played instead now and then (MonkSprite's kick, RipperSprite's stab: every other blow). */
  altAttack?: { anim: Anim; chance: number };
  /** MobSprite.blood, as a CSS colour. */
  blood?: string;
  /** Drawn darker (CharSprite.brightness). */
  brightness?: number;
  emitter?: Aura;
}

export type SpdSheet =
  | 'rat' | 'snake' | 'gnoll' | 'crab' | 'swarm' | 'slime' | 'skeleton' | 'thief' | 'dm100' | 'guard' | 'necromancer'
  | 'wraith' | 'bat' | 'brute' | 'shaman' | 'spinner' | 'dm200' | 'ghoul' | 'elemental' | 'monk' | 'warlock' | 'golem'
  | 'succubus' | 'eye' | 'scorpio' | 'ripper' | 'spawner' | 'mimic' | 'statue' | 'piranha' | 'bee';

export const SPD_SHEETS: readonly SpdSheet[] = [
  'rat', 'snake', 'gnoll', 'crab', 'swarm', 'slime', 'skeleton', 'thief', 'dm100', 'guard', 'necromancer',
  'wraith', 'bat', 'brute', 'shaman', 'spinner', 'dm200', 'ghoul', 'elemental', 'monk', 'warlock', 'golem',
  'succubus', 'eye', 'scorpio', 'ripper', 'spawner', 'mimic', 'statue', 'piranha', 'bee',
];

const a = (fps: number, frames: readonly number[], loop = false): Anim => ({ fps, frames, loop });
const shift = (anim: Anim, c: number): Anim => ({ ...anim, frames: anim.frames.map((f) => f + c) });

/** A sheet's animations moved along it by `c` frames (a texOffset). */
function offset(base: MobSheet, c: number, extra: Partial<MobSheet> = {}): MobSheet {
  const more = base.more ? Object.fromEntries(Object.entries(base.more).map(([k, v]) => [k, shift(v, c)])) : undefined;
  return {
    ...base, idle: shift(base.idle, c), run: shift(base.run, c), attack: shift(base.attack, c), die: shift(base.die, c),
    ...(more ? { more } : {}), ...extra,
  };
}

const RAT: MobSheet = {
  sheet: 'rat', w: 16, h: 15,
  idle: a(2, [0, 0, 0, 1], true), run: a(10, [6, 7, 8, 9, 10], true), attack: a(15, [2, 3, 4, 5, 0]), die: a(10, [11, 12, 13, 14]),
};
const GNOLL: MobSheet = {
  sheet: 'gnoll', w: 12, h: 15,
  idle: a(2, [0, 0, 0, 1, 0, 0, 1, 1], true), run: a(12, [4, 5, 6, 7], true), attack: a(12, [2, 3, 0]), die: a(12, [8, 9, 10]),
};
const CRAB: MobSheet = {
  sheet: 'crab', w: 16, h: 16, blood: '#ffea80',
  idle: a(5, [0, 1, 0, 2], true), run: a(15, [3, 4, 5, 6], true), attack: a(12, [7, 8, 9]), die: a(12, [10, 11, 12, 13]),
};
const SLIME: MobSheet = {
  sheet: 'slime', w: 14, h: 12, blood: '#88cc44',
  idle: a(3, [0, 1, 1, 0], true), run: a(10, [0, 2, 3, 3, 2, 0], true), attack: a(15, [2, 3, 4, 6, 5]), die: a(10, [0, 5, 6, 7]),
};
const SKELETON: MobSheet = {
  sheet: 'skeleton', w: 12, h: 15, blood: '#cccccc',
  idle: a(12, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3], true), run: a(15, [4, 5, 6, 7, 8, 9], true),
  attack: a(15, [14, 15, 16]), die: a(12, [10, 11, 12, 13]),
};
const NECRO: MobSheet = {
  sheet: 'necromancer', w: 16, h: 16,
  idle: a(1, [0, 0, 0, 1, 0, 0, 0, 0, 1], true), run: a(8, [0, 0, 0, 2, 3, 4], true),
  attack: a(10, [5, 6, 7, 8]), die: a(10, [9, 10, 11, 12]),
  more: { zap: a(10, [5, 6, 7, 8]), charge: a(5, [7, 8], true) },
};
const WRAITH: MobSheet = {
  sheet: 'wraith', w: 14, h: 15, blood: 'rgba(0, 0, 0, 0.53)',
  idle: a(5, [0, 1], true), run: a(10, [0, 1], true), attack: a(10, [0, 2, 3]), die: a(8, [0, 4, 5, 6, 7]),
};
const BRUTE: MobSheet = {
  sheet: 'brute', w: 12, h: 16,
  idle: a(2, [0, 0, 0, 1, 0, 0, 1, 1], true), run: a(12, [4, 5, 6, 7], true), attack: a(12, [2, 3, 0]), die: a(12, [8, 9, 10]),
};
const SHAMAN: MobSheet = {
  sheet: 'shaman', w: 12, h: 15,
  idle: a(2, [0, 0, 0, 1, 0, 0, 1, 1], true), run: a(12, [4, 5, 6, 7], true), attack: a(12, [2, 3, 0]), die: a(12, [8, 9, 10]),
  more: { zap: a(12, [2, 3, 0]) },
};
const DM200: MobSheet = {
  sheet: 'dm200', w: 21, h: 18, blood: '#ffff88',
  idle: a(10, [0, 1], true), run: a(10, [2, 3], true), attack: a(15, [4, 5, 6]), die: a(8, [9, 10, 11]),
  more: { zap: a(15, [7, 8, 8, 7]) },
};
const ELEMENTAL: MobSheet = {
  sheet: 'elemental', w: 12, h: 14, blood: '#ffbb33', emitter: 'flame',
  idle: a(10, [0, 1, 2], true), run: a(12, [0, 1, 3], true), attack: a(15, [4, 5, 6]), die: a(15, [7, 8, 9, 10, 11, 12, 13, 12]),
  more: { zap: a(15, [4, 5, 6]) },
};
const MONK: MobSheet = {
  sheet: 'monk', w: 15, h: 14,
  idle: a(6, [1, 0, 1, 2], true), run: a(15, [11, 12, 13, 14, 15, 16], true), attack: a(12, [3, 4, 3, 4]), die: a(15, [1, 7, 8, 8, 9, 10]),
  altAttack: { anim: a(10, [5, 6, 5]), chance: 0.5 },
};
const SCORPIO: MobSheet = {
  sheet: 'scorpio', w: 17, h: 17, blood: '#44ff22',
  idle: a(12, [0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 1, 2, 1, 2], true), run: a(8, [5, 5, 6, 6], true), attack: a(15, [0, 3, 4]), die: a(12, [0, 7, 8, 9, 10]),
  more: { zap: a(15, [0, 3, 4]) },
};
const MIMIC: MobSheet = {
  sheet: 'mimic', w: 16, h: 16,
  idle: a(5, [3, 3, 3, 4, 4], true), run: a(10, [3, 4, 5, 6, 6, 5, 4], true), attack: a(10, [3, 7, 8, 9]), die: a(5, [10, 11, 12]),
  more: { hideStealth: a(1, [0], true), hide: a(1, [1, 1, 1, 1, 1, 2], true) },
};
const PIRANHA: MobSheet = {
  sheet: 'piranha', w: 12, h: 16,
  idle: a(8, [0, 1, 2, 1], true), run: a(20, [0, 1, 2, 1], true), attack: a(20, [3, 4, 5, 6, 7, 8, 9, 10, 11]), die: a(4, [12, 13, 14]),
};

/** Every monster drawn from Shattered's sheets; the rest (bosses, folk) keep Pixel Dungeon's for now. */
export const MOB_SHEETS: Partial<Record<MobKind, MobSheet>> = {
  // The sewers.
  rat: RAT,
  albino: { ...RAT, idle: a(2, [16, 16, 16, 17], true), run: a(10, [22, 23, 24, 25, 26], true), attack: a(15, [18, 19, 20, 21]), die: a(10, [27, 28, 29, 30]) },
  fetidRat: {
    ...RAT, emitter: 'stench',
    idle: a(2, [32, 32, 32, 33], true), run: a(10, [38, 39, 40, 41, 42], true), attack: a(15, [34, 35, 36, 37, 32]), die: a(10, [43, 44, 45, 46]),
  },
  snake: {
    sheet: 'snake', w: 12, h: 11,
    idle: a(10, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 3, 2, 1, 1], true),
    run: a(8, [4, 5, 6, 7], true), attack: a(15, [8, 9, 10, 9, 0]), die: a(10, [11, 12, 13]),
  },
  gnoll: GNOLL,
  gnollExile: offset(GNOLL, 21),
  gnollTrickster: offset(GNOLL, 42, { more: { cast: a(12, [44, 45, 42]) } }),
  crab: CRAB,
  hermitCrab: offset(CRAB, 16, { run: a(10, [19, 20, 21, 22], true) }),
  greatCrab: offset(CRAB, 32, { run: a(10, [35, 36, 37, 38], true) }),
  swarm: {
    sheet: 'swarm', w: 16, h: 16, blood: '#8ba077',
    idle: a(15, [0, 1, 2, 3, 4, 5], true), run: a(15, [0, 1, 2, 3, 4, 5], true), attack: a(20, [6, 7, 8, 9]), die: a(15, [10, 11, 12, 13, 14]),
  },
  slime: SLIME,
  causticSlime: offset(SLIME, 9, { blood: undefined }),
  // The prison.
  skeleton: SKELETON,
  necroSkeleton: { ...SKELETON, brightness: 0.75 },
  thief: {
    sheet: 'thief', w: 12, h: 13,
    idle: a(1, [0, 0, 0, 1, 0, 0, 0, 0, 1], true), run: a(15, [0, 0, 2, 3, 3, 4], true), attack: a(12, [10, 11, 12, 0]), die: a(10, [5, 6, 7, 8, 9]),
  },
  bandit: {
    sheet: 'thief', w: 12, h: 13,
    idle: a(1, [21, 21, 21, 22, 21, 21, 21, 21, 22], true), run: a(15, [21, 21, 23, 24, 24, 25], true), attack: a(12, [31, 32, 33]),
    die: a(10, [25, 27, 28, 29, 30]),
  },
  dm100: {
    sheet: 'dm100', w: 16, h: 14, blood: '#ffff88',
    idle: a(1, [0, 1], true), run: a(12, [6, 7, 8, 9], true), attack: a(12, [2, 3, 4, 0]), die: a(12, [10, 11, 12, 13, 14, 15]),
    more: { zap: a(8, [5, 5, 1]) },
  },
  guard: {
    sheet: 'guard', w: 12, h: 16,
    idle: a(2, [0, 0, 0, 1, 0, 0, 1, 1], true), run: a(15, [2, 3, 4, 5, 6, 7], true), attack: a(12, [8, 9, 10]), die: a(8, [11, 12, 13, 14]),
  },
  necromancer: NECRO,
  spectralNecromancer: offset(NECRO, 16),
  wraith: WRAITH,
  tormentedSpirit: offset(WRAITH, 9, { blood: 'rgba(187, 0, 0, 0.53)' }),
  // The caves.
  bat: {
    sheet: 'bat', w: 15, h: 15,
    idle: a(8, [0, 1], true), run: a(12, [0, 1], true), attack: a(12, [2, 3, 0, 1]), die: a(12, [4, 5, 6]),
  },
  brute: BRUTE,
  shielded: { ...BRUTE, idle: a(2, [21, 21, 21, 22, 21, 21, 22, 22], true), run: a(12, [25, 26, 27, 28], true), attack: a(12, [23, 24]), die: a(12, [29, 30, 31]) },
  shaman: SHAMAN,
  blueShaman: offset(SHAMAN, 21),
  purpleShaman: offset(SHAMAN, 42),
  spinner: {
    sheet: 'spinner', w: 16, h: 16, blood: '#bfe5b8',
    idle: a(10, [0, 0, 0, 0, 0, 1, 0, 1], true), run: a(15, [0, 2, 0, 3], true), attack: a(12, [0, 4, 5, 0]), die: a(12, [6, 7, 8, 9]),
    more: { zap: a(12, [0, 4, 5, 0]) },
  },
  dm200: DM200,
  dm201: offset(DM200, 12, { idle: a(2, [12, 13], true), run: a(2, [12, 13], true) }),
  // The city.
  ghoul: {
    sheet: 'ghoul', w: 12, h: 14,
    idle: a(2, [0, 0, 0, 1], true), run: a(12, [2, 3, 4, 5, 6, 7], true), attack: a(12, [0, 8, 9]), die: a(15, [0, 10, 11, 12, 13]),
    more: { crumple: a(15, [0, 10, 11, 12]) },
  },
  elemental: ELEMENTAL,
  frostElemental: offset(ELEMENTAL, 28, { blood: '#8ee3ff', emitter: 'frost' }),
  shockElemental: offset(ELEMENTAL, 42, { blood: '#ffff85', emitter: 'spark' }),
  chaosElemental: offset(ELEMENTAL, 56, { blood: '#e3e3e3', emitter: 'rainbow' }),
  monk: MONK,
  senior: {
    ...MONK,
    idle: a(6, [18, 17, 18, 19], true), run: a(15, [28, 29, 30, 31, 32, 33], true), attack: a(12, [20, 21, 20, 21]), die: a(15, [18, 24, 25, 25, 26, 27]),
    altAttack: { anim: a(10, [22, 23, 22]), chance: 0.3 },
  },
  warlock: {
    sheet: 'warlock', w: 12, h: 15,
    idle: a(2, [0, 0, 0, 1, 0, 0, 1, 1], true), run: a(15, [0, 2, 3, 4], true), attack: a(12, [0, 5, 6]), die: a(15, [0, 7, 8, 8, 9, 10]),
    more: { zap: a(12, [0, 5, 6]) },
  },
  golem: {
    sheet: 'golem', w: 17, h: 19, blood: '#80706c',
    idle: a(4, [0, 1], true), run: a(12, [2, 3, 4, 5], true), attack: a(10, [6, 7, 8]), die: a(15, [9, 10, 11, 12, 13]),
    more: { zap: a(10, [6, 7, 8]) },
  },
  // The halls.
  succubus: {
    sheet: 'succubus', w: 12, h: 15,
    idle: a(8, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 2, 2, 2, 1], true), run: a(15, [3, 4, 5, 6, 7, 8], true),
    attack: a(12, [9, 10, 11]), die: a(10, [12]),
  },
  eye: {
    sheet: 'eye', w: 16, h: 18,
    idle: a(8, [0, 1, 2], true), run: a(12, [5, 6], true), attack: a(8, [4, 3]), die: a(8, [7, 8, 9]),
    more: { zap: a(8, [4, 3]), charge: a(12, [3, 4], true) },
  },
  scorpio: SCORPIO,
  acidic: {
    ...SCORPIO, blood: '#66ff22',
    idle: a(12, [15, 15, 15, 15, 15, 15, 15, 15, 16, 17, 16, 17, 16, 17], true), run: a(4, [20, 21], true), attack: a(15, [15, 18, 19]),
    die: a(12, [15, 22, 23, 24, 25]), more: { zap: a(15, [15, 18, 19]) },
  },
  ripper: {
    sheet: 'ripper', w: 15, h: 14,
    idle: a(4, [1, 0, 1, 2], true), run: a(15, [3, 4, 5, 6, 7, 8], true), attack: a(12, [0, 9, 10, 9]), die: a(15, [1, 13, 14, 15, 16]),
    altAttack: { anim: a(12, [0, 9, 11, 9]), chance: 0.5 },
    more: { prep: a(1, [9], true), leap: a(1, [12], true) },
  },
  spawner: {
    sheet: 'spawner', w: 16, h: 16,
    idle: a(8, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], true),
    run: a(8, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], true),
    attack: a(8, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]),
    die: a(8, [0]),
  },
  // Anywhere.
  mimic: MIMIC,
  goldenMimic: offset(MIMIC, 16),
  crystalMimic: offset(MIMIC, 32),
  ebonyMimic: offset(MIMIC, 48),
  statue: {
    sheet: 'statue', w: 12, h: 15, blood: '#cdcdb7',
    idle: a(2, [0, 0, 0, 0, 0, 1, 1], true), run: a(15, [2, 3, 4, 5, 6, 7], true), attack: a(12, [8, 9, 10]), die: a(5, [11, 12, 13, 14, 15, 15]),
  },
  piranha: PIRANHA,
  phantomPiranha: offset(PIRANHA, 21, { emitter: 'light' }),
  bee: {
    sheet: 'bee', w: 16, h: 16, blood: '#ffd500',
    idle: a(12, [0, 1, 1, 0, 2, 2], true), run: a(15, [0, 1, 1, 0, 2, 2], true), attack: a(20, [3, 4, 5, 6]), die: a(20, [7, 8, 9, 10]),
  },
};

/** StatueSprite.setArmor: an armoured statue is drawn in its armour's tier, further along the sheet (not when it dies). */
const STATUE_TIERS = [0, 21, 32, 43, 54, 65];

export function armoredStatue(tier: number): MobSheet {
  const c = STATUE_TIERS[Math.max(0, Math.min(5, tier))]!;
  const base = MOB_SHEETS.statue!;
  return { ...base, idle: shift(base.idle, c), run: shift(base.run, c), attack: shift(base.attack, c) };
}
