import type { TileSheets } from './tiles';
import { baseKind, type HeroClass, LAST_SHOP_DEPTH, type MobKind } from '@pd/core';
import { type MobAnim, type MobSheet, MOB_SHEETS, SPD_SHEETS, type SpdSheet } from './mobsprites';

/* Sprite sheets and animations of the original (HeroSprite, RatSprite, …). */

export interface Sheet {
  image: HTMLImageElement;
  w: number;
  h: number;
  cols: number;
}

export interface Animation {
  fps: number;
  frames: readonly number[];
  loop: boolean;
}

export type AnimName = 'idle' | 'run' | 'attack' | 'die' | 'operate' | 'pump' | MobAnim | 'attack2' | 'pumpAttack';

export interface CharSprite {
  sheet: Sheet;
  anims: Readonly<Record<AnimName, Animation>>;
  /** Shattered's monsters (mobsprites.ts): a second way to strike now and then, what bleeds out, how dim, what it gives off. */
  altAttack?: number;
  blood?: string;
  brightness?: number;
  emitter?: MobSheet['emitter'];
}

/**
 * Shattered's boss sprites (sprites/*Sprite.java), each with its frames and timing, and the variants a
 * boss changes to: DM-300 supercharged (DM300Sprite.updateChargeState), a pylon switched on (PylonSprite.activate).
 */
export type SpriteVariant = 'dm300.charged' | 'pylon.active';

export interface Assets {
  /** Tiles and water of each region: the sewers, the prison, the caves, the city, the halls. */
  tiles: HTMLImageElement[];
  water: HTMLImageElement[];
  heroes: Record<HeroClass, CharSprite>;
  mobs: Record<MobKind, CharSprite>;
  variants: Record<SpriteVariant, CharSprite>;
  /** Shattered's custom tiles of the boss levels (assets/spd: sewer_boss, prison_exit, caves_boss, city_boss, halls_special). */
  bossTiles: Record<'sewer_boss' | 'prison_exit' | 'caves_boss' | 'city_boss' | 'halls_sp', HTMLImageElement>;
  icons: HTMLImageElement;
  items: HTMLImageElement;
  /** 16x16 plants, in the order of PLANT_KINDS (the wand of regrowth's two after Pixel Dungeon's eight). */
  plants: HTMLImageElement;
  /** Shattered's environment: tiles, water, terrain features, raised terrain, occlusion shadows, custom tiles (tiles.ts). */
  env: TileSheets;
  /** Shattered's monster sheets, by file (an armoured statue's tier is cut from the statue's when drawn). */
  spd: Record<SpdSheet, HTMLImageElement>;
  /** Shattered's effects.png (Effects.get): the chains among them. */
  effects: HTMLImageElement;
}

const anim = (fps: number, frames: number[], loop = false): Animation => ({ fps, frames, loop });

/** Animations of a character that has no special ones for operating or pumping up. */
function basic(idle: Animation, run: Animation, attack: Animation, die: Animation): Record<AnimName, Animation> {
  return {
    idle, run, attack, die, operate: idle, pump: idle, attack2: attack, pumpAttack: attack,
    zap: attack, charge: idle, crumple: die, hide: idle, hideStealth: idle, prep: idle, leap: run, cast: attack,
  };
}

/** A Shattered monster's sheet as a sprite: its animations, the ones it lacks standing in as Shattered's MobSprite does. */
export function spdSprite(image: HTMLImageElement, spec: MobSheet): CharSprite {
  const anims = basic(spec.idle, spec.run, spec.attack, spec.die);
  for (const [name, anim] of Object.entries(spec.more ?? {})) anims[name as MobAnim] = anim;
  if (spec.altAttack) anims.attack2 = spec.altAttack.anim;
  return {
    sheet: sheet(image, spec.w, spec.h), anims,
    ...(spec.altAttack ? { altAttack: spec.altAttack.chance } : {}),
    ...(spec.blood ? { blood: spec.blood } : {}),
    ...(spec.brightness ? { brightness: spec.brightness } : {}),
    ...(spec.emitter ? { emitter: spec.emitter } : {}),
  };
}

const HERO_ANIMS: Record<AnimName, Animation> = {
  ...basic(
    anim(1, [0, 0, 0, 1, 0, 0, 1, 1], true),
    anim(20, [2, 3, 4, 5, 6, 7], true),
    anim(15, [13, 14, 15, 0]),
    anim(20, [8, 9, 10, 11, 12, 11]),
  ),
  operate: anim(8, [16, 17, 16, 17]),
};

const IMP_SPRITE = {
  w: 12,
  h: 14,
  anims: basic(
    anim(10, [0, 1, 2, 3, 0, 1, 2, 3, 0, 0, 0, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 3, 0, 0, 0, 4, 4, 4, 4, 4, 4, 4, 4], true),
    anim(20, [0], true), anim(10, [0]), anim(10, [0, 3, 2, 1, 0, 3, 2, 1, 0]),
  ),
};

/** A monster's sheet: its frame size and animations, and, for Shattered's sheets (assets/spd/<spd>.png), which file. */
interface LevelSheet {
  w: number;
  h: number;
  anims: Record<AnimName, Animation>;
  spd?: string;
}

/** Shattered's sprites for the levels stream's characters (sprites/*Sprite.java): the quests' givers and foes. */
const SPD_MOBS: Partial<Record<MobKind, LevelSheet>> = {
  // GhostSprite.
  ghost: {
    w: 14, h: 15, spd: 'ghost',
    anims: basic(anim(5, [0, 1], true), anim(10, [0, 1], true), anim(10, [0, 2, 3]), anim(8, [0, 4, 5, 6, 7])),
  },
  // FetidRatSprite: the rat sheet's fifth row.
  fetidRat: {
    w: 16, h: 15, spd: 'rat',
    anims: basic(anim(2, [32, 32, 32, 33], true), anim(10, [38, 39, 40, 41, 42], true), anim(15, [34, 35, 36, 37, 32]), anim(10, [43, 44, 45, 46])),
  },
  // GnollTricksterSprite: the gnoll sheet from frame 42.
  gnollTrickster: {
    w: 12, h: 15, spd: 'gnoll',
    anims: basic(anim(2, [42, 42, 42, 43, 42, 42, 43, 43], true), anim(12, [46, 47, 48, 49], true), anim(12, [44, 45, 42]), anim(12, [50, 51, 52])),
  },
  // SentrySprite.Red: one still frame, the first of the sentry sheet (it bobs, see render.ts).
  sentry: {
    w: 8, h: 15, spd: 'sentry',
    anims: basic(anim(1, [0], true), anim(1, [0], true), anim(1, [0], true), anim(1, [0], true)),
  },
  // GreatCrabSprite: the crab sheet from frame 32, a slower run.
  greatCrab: {
    w: 16, h: 16, spd: 'crab',
    anims: basic(anim(5, [32, 33, 32, 34], true), anim(10, [35, 36, 37, 38], true), anim(12, [39, 40, 41]), anim(12, [42, 43, 44, 45])),
  },
  // WandmakerSprite: idle, now and then a glance about; still otherwise (he burns away when he leaves).
  wandmaker: {
    w: 12, h: 14, spd: 'wandmaker',
    anims: basic(anim(10, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 3, 3, 3, 3, 3, 2, 1], true), anim(20, [0], true), anim(20, [0]), anim(20, [0])),
  },
  // RotHeartSprite: one still frame; it withers away when it dies.
  rotHeart: {
    w: 16, h: 16, spd: 'rot_heart',
    anims: basic(anim(1, [0], true), anim(1, [0], true), anim(1, [0]), anim(8, [1, 2, 3, 4, 5, 6, 7, 7, 7])),
  },
  // RotLasherSprite: still until it lashes out.
  rotLasher: {
    w: 12, h: 16, spd: 'rot_lasher',
    anims: basic(anim(1, [0], true), anim(1, [0], true), anim(24, [0, 1, 2, 2, 1]), anim(12, [3, 4, 5, 6])),
  },
  // The troll blacksmith (BlacksmithSprite): at his anvil.
  blacksmith: {
    w: 13, h: 16, spd: 'blacksmith',
    anims: basic(anim(15, [0, 0, 0, 0, 0, 0, 0, 1, 2, 2, 2, 3], true), anim(20, [0], true), anim(20, [0]), anim(20, [0])),
  },
  // The blacksmith's mine (minesprites.ts gives the crystal ones their colour, the guardian its crumpling, the
  // spire its cracks, the geomancer its rock armour). CrystalWispSprite.Blue.
  crystalWisp: {
    w: 12, h: 14, spd: 'crystal_wisp',
    anims: basic(anim(1, [0], true), anim(12, [0, 0, 0, 1], true), anim(16, [2, 3, 4, 5]), anim(15, [6, 7, 8, 9, 10, 11, 12, 11])),
  },
  // CrystalGuardianSprite.Blue.
  crystalGuardian: {
    w: 12, h: 15, spd: 'crystal_guardian',
    anims: basic(anim(2, [0, 0, 0, 0, 0, 1, 1], true), anim(15, [2, 3, 4, 5, 6, 7], true), anim(12, [8, 9, 10]), anim(5, [11, 12, 13, 14, 15, 15])),
  },
  // CrystalSpireSprite.Blue: one still frame, more cracked as it is hurt.
  crystalSpire: {
    w: 29, h: 40, spd: 'crystal_spire',
    anims: basic(anim(1, [0], true), anim(1, [0], true), anim(1, [0]), anim(1, [4])),
  },
  // GnollGuardSprite.
  gnollGuard: {
    w: 12, h: 16, spd: 'gnoll_guard',
    anims: basic(anim(2, [0, 0, 0, 1, 0, 0, 1, 1], true), anim(12, [4, 5, 6, 7], true), anim(12, [2, 3, 0]), anim(12, [8, 9, 10])),
  },
  // GnollSapperSprite.
  gnollSapper: {
    w: 12, h: 15, spd: 'gnoll_sapper',
    anims: basic(anim(2, [0, 0, 0, 1, 0, 0, 1, 1], true), anim(12, [4, 5, 6, 7], true), anim(12, [2, 3, 0]), anim(12, [8, 9, 10])),
  },
  // GnollGeomancerSprite, out of its rock armour (in it: from frame 21).
  gnollGeomancer: {
    w: 12, h: 16, spd: 'gnoll_geomancer',
    anims: basic(anim(2, [0, 0, 0, 1, 0, 0, 1, 1], true), anim(12, [4, 5, 6, 7], true), anim(12, [2, 3, 0]), anim(12, [8, 9, 10])),
  },
  // FungalSentrySprite, FungalSpinnerSprite, FungalCoreSprite.
  fungalSentry: {
    w: 18, h: 18, spd: 'fungal_sentry',
    anims: basic(anim(1, [0], true), anim(1, [0], true), anim(24, [0]), anim(12, [0])),
  },
  fungalSpinner: {
    w: 16, h: 16, spd: 'fungal_spinner',
    anims: basic(anim(10, [0, 0, 0, 0, 0, 1, 0, 1], true), anim(15, [0, 2, 0, 3], true), anim(12, [0, 4, 5, 0]), anim(12, [6, 7, 8, 9])),
  },
  fungalCore: {
    w: 27, h: 27, spd: 'fungal_core',
    anims: basic(anim(1, [0], true), anim(1, [0], true), anim(24, [0]), anim(12, [0])),
  },
  // ElementalSprite.NewbornFire: the elemental sheet from frame 14.
  newbornElemental: {
    w: 12, h: 14, spd: 'elemental',
    anims: basic(anim(10, [14, 15, 16], true), anim(12, [14, 15, 17], true), anim(15, [18, 19, 20]), anim(15, [21, 22, 23, 24, 25, 26, 27, 26])),
  },
};

/** FistSprite: the six fists share a sheet, each its own ten frames from `c`. */
const fist = (c: number): { w: number; h: number; file: string; anims: Record<AnimName, Animation> } => ({
  w: 24, h: 17, file: 'spd/yog_fists',
  anims: {
    ...basic(anim(2, [c, c, c + 1], true), anim(3, [c, c + 1], true), anim(3, [c]), anim(10, [c, c + 2, c + 3, c + 4])),
    zap: anim(8, [c, c + 5, c + 6]),
  },
});

/** DM300Sprite.updateChargeState: its frames, plain or supercharged (ten further along). */
const dm300 = (charged: boolean): { w: number; h: number; file: string; anims: Record<AnimName, Animation> } => {
  const c = charged ? 10 : 0;
  return {
    w: 25, h: 22, file: 'spd/dm300',
    anims: {
      ...basic(anim(charged ? 15 : 10, [c, c + 1], true), anim(charged ? 15 : 10, [c, c + 2], true), anim(15, [c + 3, c + 4, c + 5]),
        anim(20, [0, 10, 0, 10, 0, 10, 0, 10, 0, 10, 0, 10, 0, 10, 0, 10, 0, 10, 0, 10])),
      zap: anim(15, [6, 7, 7, 6]),
      charge: anim(4, [0, 10], true),
    },
  };
};

/** PylonSprite: a still frame, the lit one once it is switched on, a wreck once destroyed. */
const pylon = (active: boolean): { w: number; h: number; file: string; anims: Record<AnimName, Animation> } => ({
  w: 10, h: 20, file: 'spd/pylon',
  anims: basic(anim(1, [active ? 1 : 0]), anim(1, [active ? 1 : 0]), anim(1, [active ? 1 : 0]), anim(1, [2])),
});

const VARIANTS: Record<SpriteVariant, { w: number; h: number; file: string; anims: Record<AnimName, Animation> }> = {
  'dm300.charged': dm300(true),
  'pylon.active': pylon(true),
};

/** Pixel Dungeon's sheets, for those Shattered's (MOB_SHEETS) do not cover yet; the bosses' Shattered's own (assets/spd). */
const MOB_SPRITES: Partial<Record<MobKind, { w: number; h: number; file?: string; anims: Record<AnimName, Animation> }>> = {
  // Shattered's bosses (assets/spd).
  // GooSprite.
  goo: {
    w: 20,
    h: 14,
    file: 'spd/goo',
    anims: {
      ...basic(anim(10, [2, 1, 0, 0, 1], true), anim(15, [3, 2, 1, 2], true), anim(10, [8, 9, 10]), anim(10, [5, 6, 7])),
      pump: anim(20, [4, 3, 2, 1, 0], true),
      pumpAttack: anim(20, [4, 3, 2, 1, 0, 7]),
    },
  },
  // TenguSprite.
  tengu: {
    w: 14,
    h: 16,
    file: 'spd/tengu',
    anims: basic(anim(2, [0, 0, 0, 1], true), anim(15, [2, 3, 4, 5, 0]), anim(15, [6, 7, 7, 0]), anim(8, [8, 9, 10, 10, 10, 10, 10, 10])),
  },
  // KingSprite.
  king: {
    w: 16,
    h: 16,
    file: 'spd/king',
    anims: basic(anim(12, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2], true), anim(15, [3, 4, 5, 6, 7, 8], true), anim(15, [9, 10, 11]), anim(8, [12, 13, 14, 15])),
  },
  // YogSprite.
  yog: {
    w: 20,
    h: 19,
    file: 'spd/yog',
    anims: basic(anim(10, [0, 1, 2, 2, 1, 0, 3, 4, 4, 3, 0, 5, 6, 6, 5], true), anim(12, [0], true), anim(12, [0]), anim(10, [0, 7, 8, 9])),
  },
  // LarvaSprite.
  larva: {
    w: 12,
    h: 8,
    file: 'spd/larva',
    anims: basic(anim(5, [4, 4, 4, 4, 4, 5, 5], true), anim(12, [0, 1, 2, 3], true), anim(15, [6, 5, 7]), anim(10, [8])),
  },
  dm300: dm300(false),
  pylon: pylon(false),
  burningFist: fist(0),
  soiledFist: fist(10),
  rottingFist: fist(20),
  rustedFist: fist(30),
  brightFist: fist(40),
  darkFist: fist(50),
  // GhostSprite, Shattered's sheet (spd/ghost.png): it strikes and fades away as the sad ghost does not.
  ghostHero: {
    w: 14,
    h: 15,
    anims: basic(anim(5, [0, 1], true), anim(10, [0, 1], true), anim(10, [0, 2, 3]), anim(8, [0, 4, 5, 6, 7])),
  },
  ghost: {
    w: 14,
    h: 15,
    anims: basic(anim(5, [0, 1], true), anim(10, [0, 1], true), anim(5, [0, 1]), anim(20, [0])),
  },
  shopkeeper: {
    w: 14,
    h: 14,
    anims: basic(anim(10, [1, 1, 1, 1, 1, 0, 0, 0, 0], true), anim(10, [1], true), anim(10, [1]), anim(20, [0])),
  },
  wandmaker: {
    w: 12,
    h: 14,
    anims: basic(anim(10, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 3, 3, 3, 3, 3, 2, 1], true), anim(20, [0], true), anim(20, [0]), anim(20, [0])),
  },
  undead: {
    w: 12,
    h: 16,
    anims: basic(
      anim(12, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3], true), anim(15, [4, 5, 6, 7, 8, 9], true), anim(15, [14, 15, 16]),
      anim(12, [10, 11, 12, 13]),
    ),
  },
  imp: IMP_SPRITE,
  impShopkeeper: IMP_SPRITE,
  curse: {
    w: 14,
    h: 15,
    anims: basic(anim(5, [0, 1], true), anim(10, [0, 1], true), anim(10, [0, 2, 3]), anim(8, [0, 4, 5, 6, 7])),
  },
  ratKing: {
    w: 16,
    h: 16,
    anims: basic(anim(2, [0, 0, 0, 1], true), anim(10, [2, 3, 4, 5, 6], true), anim(15, [0]), anim(10, [0])),
  },
  mirror: { w: 12, h: 15, anims: HERO_ANIMS },
  // A prismatic image (PrismaticImage) is drawn with its hero's sheet too, until it has a sprite of its own.
  prismatic: { w: 12, h: 15, anims: HERO_ANIMS },
  // Feint's afterimage and Power of Many's light ally: a hero's sheet too (View.sync), faint.
  afterImage: { w: 12, h: 15, anims: HERO_ANIMS },
  lightAlly: { w: 12, h: 15, anims: HERO_ANIMS },
  blacksmith: {
    w: 13,
    h: 16,
    anims: basic(anim(15, [0, 0, 0, 0, 0, 0, 0, 1, 2, 2, 2, 3], true), anim(20, [0], true), anim(20, [0]), anim(20, [0])),
  },
  sheep: {
    w: 16,
    h: 15,
    anims: basic(anim(8, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 0], true), anim(8, [0], true), anim(8, [0]), anim(20, [4])),
  },
  // Shattered's (assets/spd): WardSprite, one tier a row (see View.sync), EarthGuardianSprite and LotusSprite.
  ward: { w: 16, h: 16, anims: basic(anim(1, [0], true), anim(1, [0], true), anim(1, [0]), anim(1, [0])) },
  guardian: {
    w: 12,
    h: 15,
    anims: basic(anim(2, [0, 0, 0, 0, 0, 1, 1], true), anim(15, [2, 3, 4, 5, 6, 7], true), anim(12, [8, 9, 10]), anim(5, [11, 12, 13, 14, 15, 15])),
  },
  lotus: { w: 19, h: 16, anims: basic(anim(1, [0], true), anim(1, [0], true), anim(1, [0]), anim(1, [0])) },
  // The armour abilities' allies: ShadowSprite (the rogue's own frames, class armour's row, drawn as a dark shadow: render.ts),
  // SpiritHawk.HawkSprite and SmokeBomb.NinjaLogSprite (assets/spd).
  shadow: { w: 12, h: 15, anims: basic(anim(1, [0, 0, 0, 1, 0, 0, 1, 1], true), anim(20, [2, 3, 4, 5, 6, 7], true), anim(15, [13, 14, 15, 0]), anim(20, [0])) },
  hawk: {
    w: 15,
    h: 15,
    anims: basic(anim(6, [0, 1], true), anim(8, [0, 1], true), anim(12, [2, 3, 0, 1]), anim(12, [4, 5, 6])),
  },
  ninjaLog: { w: 11, h: 12, anims: basic(anim(1, [0], true), anim(1, [0], true), anim(1, [0]), anim(12, [1, 2, 3, 4])) },
};

/**
 * The tiles and water of a depth: 0 for the sewers (depths 1-5), 1 for the prison (6-10), 2 for the caves (11-15),
 * 3 for the city (16-20), 4 for the halls.
 */
export const regionOf = (depth: number): number => Math.min(4, Math.max(0, Math.floor((depth - 1) / 5)));

/** The region whose look a level takes: its own (the arena of waves takes its tier's), else its depth's. */
export const levelRegion = (level: { depth: number; region?: number }): 0 | 1 | 2 | 3 | 4 =>
  Math.min(4, Math.max(0, level.region ?? regionOf(level.depth))) as 0 | 1 | 2 | 3 | 4;

/** Frame of an animation `elapsed` ms after it started; non-looping ones hold the last frame. */
export function frameAt(animation: Animation, elapsed: number): number {
  const index = Math.floor((elapsed / 1000) * animation.fps);
  const frames = animation.frames;
  return animation.loop ? frames[index % frames.length]! : frames[Math.min(index, frames.length - 1)]!;
}

export function duration(animation: Animation): number {
  return (animation.frames.length / animation.fps) * 1000;
}

/**
 * An image, tried again a few times (a moment apart, past any cache) before giving up: a phone's
 * network drops a request now and then, and one missing sheet would stop the whole game loading.
 */
function loadImage(url: string, attempt = 0): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => {
      if (attempt >= 3) {
        reject(new Error(`Failed to load ${url}`));
        return;
      }
      window.setTimeout(() => {
        const again = `${url}${url.includes('?') ? '&' : '?'}retry=${attempt + 1}`;
        loadImage(again, attempt + 1).then(resolve, reject);
      }, 400 * (attempt + 1));
    };
    image.src = url;
  });
}

const sheet = (image: HTMLImageElement, w: number, h: number): Sheet => ({ image, w, h, cols: Math.floor(image.width / w) });

/** Loads every sprite sheet; `onProgress` hears the share done, from 0 to 1. */
/** Where the sprite sheets are, for the looks loaded later. */
let assetBase = '';

/** Hero looks bought in Pixel-Mart (assets/skins/<sheet>-<variant>.png), loaded when first worn. */
const looks = new Map<string, CharSprite | null>();

/** The sheet a hero is drawn with: their look's, once loaded, or the original. */
export function heroSprite(assets: Assets, heroClass: HeroClass, skin?: string): CharSprite {
  if (!skin) return assets.heroes[heroClass];
  const key = `${heroClass}-${skin}`;
  const loaded = looks.get(key);
  if (loaded) return loaded;
  if (!looks.has(key)) {
    looks.set(key, null);
    const file = heroClass === 'huntress' ? 'ranger' : heroClass;
    void loadImage(`${assetBase}skins/${file}-${skin}.png`)
      .then((image) => looks.set(key, { sheet: sheet(image, 12, 15), anims: HERO_ANIMS }))
      .catch(() => undefined);
  }
  return assets.heroes[heroClass];
}

export async function loadAssets(base: string, onProgress?: (done: number) => void): Promise<Assets> {
  assetBase = base;
  // Pixel Dungeon's sheets still in use: the bosses and their minions, the folk, the curse; the monsters are Shattered's.
  const names = [
    'tiles0', 'water0', 'tiles1', 'water1', 'tiles2', 'water2', 'tiles3', 'water3',
    'undead', 'tiles4', 'water4',
    'imp', 'sheep', 'blacksmith', 'wraith', 'ratKing', 'warrior', 'mage', 'rogue', 'ranger', 'duelist', 'cleric', 'ghost',
    'shopkeeper', 'wandmaker', 'spd/ghost', 'spd/effects',
    'icons', 'items', 'plants', 'spd/wards', 'spd/guardian', 'spd/lotus', 'spd/spirit_hawk', 'spd/ninja_log',
    // Shattered's bosses and their levels' custom tiles.
    'spd/goo', 'spd/tengu', 'spd/dm300', 'spd/pylon', 'spd/king', 'spd/yog', 'spd/yog_fists', 'spd/larva',
    'spd/sewer_boss', 'spd/prison_exit', 'spd/caves_boss', 'spd/city_boss', 'spd/halls_special',
  ] as const;
  let loaded = 0;
  const total = names.length + SPD_SHEETS.length;
  const images = Object.fromEntries(
    await Promise.all(
      names.map(async (name) => {
        const image = await loadImage(`${base}${name}.png`);
        onProgress?.(++loaded / total);
        return [name, image] as const;
      }),
    ),
  ) as Record<(typeof names)[number], HTMLImageElement>;
  // Shattered's monster sheets (assets/spd/mobs).
  const spd = Object.fromEntries(
    await Promise.all(
      SPD_SHEETS.map(async (name) => {
        const image = await loadImage(`${base}spd/mobs/${name}.png`);
        onProgress?.(++loaded / total);
        return [name, image] as const;
      }),
    ),
  ) as Record<SpdSheet, HTMLImageElement>;

  const hero = (image: HTMLImageElement): CharSprite => ({ sheet: sheet(image, 12, 15), anims: HERO_ANIMS });
  // Shattered's sheets the quests' characters are drawn from.
  const spdMobs = new Map<string, HTMLImageElement>();
  await Promise.all([...new Set(Object.values(SPD_MOBS).map((spec) => spec!.spd!))].map(async (name) => {
    spdMobs.set(name, await loadImage(`${base}spd/${name}.png`));
  }));
  const mob = (kind: MobKind): CharSprite => {
    const shattered = MOB_SHEETS[kind] ?? MOB_SHEETS[VAULT_LOOKS[kind] ?? kind];
    if (shattered) return spdSprite(spd[shattered.sheet], shattered);
    const level = SPD_MOBS[kind];
    if (level) return { sheet: sheet(spdMobs.get(level.spd!)!, level.w, level.h), anims: level.anims };
    const spec = MOB_SPRITES[kind] ?? MOB_SPRITES.ghost!;
    // A mirror image is drawn with its hero's own sheet (see View.sync); the warrior's stands in here.
    const image = spec.file ?? (kind === 'mirror' || kind === 'prismatic' || kind === 'afterImage' || kind === 'lightAlly' ? 'warrior' : kind === 'fetidRat' ? 'rat' : kind === 'curse' ? 'wraith' : kind === 'impShopkeeper' ? 'imp'
      : kind === 'ward' ? 'spd/wards' : kind === 'guardian' ? 'spd/guardian' : kind === 'lotus' ? 'spd/lotus' : kind === 'ghostHero' ? 'spd/ghost'
      : kind === 'shadow' ? 'rogue' : kind === 'hawk' ? 'spd/spirit_hawk' : kind === 'ninjaLog' ? 'spd/ninja_log'
      : baseKind(kind));
    return { sheet: sheet(images[image as (typeof names)[number]] ?? images.ghost, spec.w, spec.h), anims: spec.anims };
  };
  // Shattered's environment (assets/spd): the regions' tiles and water, the mine's tiles, and the layers over them.
  const spdEnv = async (name: string): Promise<HTMLImageElement> => loadImage(`${base}spd/${name}.png`);
  const [sewers, prison, caves, city, halls, crystal, gnoll, w0, w1, w2, w3, w4, features, raised, occlusion] = await Promise.all([
    'tiles_sewers', 'tiles_prison', 'tiles_caves', 'tiles_city', 'tiles_halls', 'tiles_caves_crystal', 'tiles_caves_gnoll',
    'water0', 'water1', 'water2', 'water3', 'water4', 'terrain_features', 'raised_terrain', 'occlusion_shadows',
  ].map(spdEnv));
  const custom = new Map<string, HTMLImageElement>();
  for (const name of CUSTOM_TILES) {
    void loadImage(`${base}spd/custom_tiles/${name}.png`).then((image) => custom.set(name, image)).catch(() => undefined);
  }
  const variant = (name: SpriteVariant): CharSprite => {
    const spec = VARIANTS[name];
    return { sheet: sheet(images[spec.file as (typeof names)[number]], spec.w, spec.h), anims: spec.anims };
  };
  const kinds = new Set<MobKind>([...(Object.keys(MOB_SPRITES) as MobKind[]), ...(Object.keys(MOB_SHEETS) as MobKind[]), ...(Object.keys(SPD_MOBS) as MobKind[])]);
  return {
    env: {
      tiles: [sewers!, prison!, caves!, city!, halls!], minesCrystal: crystal!, minesGnoll: gnoll!, water: [w0!, w1!, w2!, w3!, w4!],
      features: features!, raised: raised!, occlusion: occlusion!, custom,
    },
    tiles: [images.tiles0, images.tiles1, images.tiles2, images.tiles3, images.tiles4],
    water: [images.water0, images.water1, images.water2, images.water3, images.water4],
    heroes: {
      warrior: hero(images.warrior),
      mage: hero(images.mage),
      rogue: hero(images.rogue),
      huntress: hero(images.ranger),
      duelist: hero(images.duelist),
      cleric: hero(images.cleric),
    },
    mobs: Object.fromEntries([...kinds].map((kind) => [kind, mob(kind)])) as Record<MobKind, CharSprite>,
    variants: { 'dm300.charged': variant('dm300.charged'), 'pylon.active': variant('pylon.active') },
    bossTiles: {
      sewer_boss: images['spd/sewer_boss'], prison_exit: images['spd/prison_exit'], caves_boss: images['spd/caves_boss'],
      city_boss: images['spd/city_boss'], halls_sp: images['spd/halls_special'],
    },
    spd,
    icons: images.icons,
    items: images.items,
    plants: images.plants,
    effects: images['spd/effects'],
  };
}

/** The vault's guards are drawn as the monsters they are made from (Imp vault: VaultRat is a RatSprite, and so on). */
const VAULT_LOOKS: Partial<Record<MobKind, MobKind>> = {
  vaultRat: 'rat', vaultSkeleton: 'skeleton', vaultGhoul: 'ghoul', vaultGolem: 'golem', vaultShaman: 'shaman',
  vaultFireElemental: 'elemental', vaultFrostElemental: 'frostElemental', vaultShockElemental: 'shockElemental', vaultBossElemental: 'chaosElemental',
};

/** Shattered's environment/custom_tiles. */
const CUSTOM_TILES = [
  'carpet', 'caves_boss', 'caves_quest', 'city_boss', 'city_quest', 'halls_special', 'prison_exit', 'prison_quest', 'rat_king_room',
  'sewer_boss', 'weak_floor',
];

/** Rectangles in icons.png, from Icons.java. */
export const ICONS = {
  skull: [0, 0, 8, 8],
  busy: [8, 0, 8, 8],
  sleep: [13, 45, 9, 8],
  alert: [22, 45, 8, 8],
  depth: [45, 12, 9, 8],
  warrior: [0, 29, 16, 16],
  mage: [16, 29, 16, 16],
  rogue: [32, 29, 16, 16],
  huntress: [48, 29, 16, 16],
} as const satisfies Record<string, readonly [number, number, number, number]>;
