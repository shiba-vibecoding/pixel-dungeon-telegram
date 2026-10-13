import { baseKind, type HeroClass, LAST_SHOP_DEPTH, type MobKind } from '@pd/core';

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

export type AnimName = 'idle' | 'run' | 'attack' | 'die' | 'operate' | 'pump';

export interface CharSprite {
  sheet: Sheet;
  anims: Readonly<Record<AnimName, Animation>>;
}

export interface Assets {
  /** Tiles and water of each region: the sewers, the prison, the caves, the city, the halls. */
  tiles: HTMLImageElement[];
  water: HTMLImageElement[];
  heroes: Record<HeroClass, CharSprite>;
  mobs: Record<MobKind, CharSprite>;
  icons: HTMLImageElement;
  items: HTMLImageElement;
  /** 16x16 plants, in the order of PLANT_KINDS (the wand of regrowth's two after Pixel Dungeon's eight). */
  plants: HTMLImageElement;
}

const anim = (fps: number, frames: number[], loop = false): Animation => ({ fps, frames, loop });

/** Animations of a character that has no special ones for operating or pumping up. */
function basic(idle: Animation, run: Animation, attack: Animation, die: Animation): Record<AnimName, Animation> {
  return { idle, run, attack, die, operate: idle, pump: idle };
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

const MOB_SPRITES: Record<MobKind, { w: number; h: number; anims: Record<AnimName, Animation> }> = {
  rat: {
    w: 16,
    h: 15,
    anims: basic(anim(2, [0, 0, 0, 1], true), anim(10, [6, 7, 8, 9, 10], true), anim(15, [2, 3, 4, 5, 0]), anim(10, [11, 12, 13, 14])),
  },
  gnoll: {
    w: 12,
    h: 15,
    anims: basic(anim(2, [0, 0, 0, 1, 0, 0, 1, 1], true), anim(12, [4, 5, 6, 7], true), anim(12, [2, 3, 0]), anim(12, [8, 9, 10])),
  },
  crab: {
    w: 16,
    h: 16,
    anims: basic(anim(5, [0, 1, 0, 2], true), anim(15, [3, 4, 5, 6], true), anim(12, [7, 8, 9]), anim(12, [10, 11, 12, 13])),
  },
  ghost: {
    w: 14,
    h: 15,
    anims: basic(anim(5, [0, 1], true), anim(10, [0, 1], true), anim(5, [0, 1]), anim(20, [0])),
  },
  goo: {
    w: 20,
    h: 14,
    anims: {
      ...basic(anim(10, [0, 1], true), anim(10, [0, 1], true), anim(10, [5, 0, 6]), anim(10, [2, 3, 4])),
      pump: anim(20, [0, 1], true),
    },
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
  skeleton: {
    w: 12,
    h: 15,
    anims: basic(
      anim(12, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3], true), anim(15, [4, 5, 6, 7, 8, 9], true),
      anim(15, [14, 15, 16]), anim(12, [10, 11, 12, 13]),
    ),
  },
  thief: {
    w: 12,
    h: 13,
    anims: basic(anim(1, [0, 0, 0, 1, 0, 0, 0, 0, 1], true), anim(15, [0, 0, 2, 3, 3, 4], true), anim(12, [10, 11, 12, 0]), anim(10, [5, 6, 7, 8, 9])),
  },
  swarm: {
    w: 16,
    h: 16,
    anims: basic(anim(15, [0, 1, 2, 3, 4, 5], true), anim(15, [0, 1, 2, 3, 4, 5], true), anim(20, [6, 7, 8, 9]), anim(15, [10, 11, 12, 13, 14])),
  },
  shaman: {
    w: 12,
    h: 15,
    anims: basic(anim(2, [0, 0, 0, 1, 0, 0, 1, 1], true), anim(12, [4, 5, 6, 7], true), anim(12, [2, 3, 0]), anim(12, [8, 9, 10])),
  },
  bat: {
    w: 15,
    h: 15,
    anims: basic(anim(8, [0, 1], true), anim(12, [0, 1], true), anim(12, [2, 3, 0, 1]), anim(12, [4, 5, 6])),
  },
  brute: {
    w: 12,
    h: 16,
    anims: basic(anim(2, [0, 0, 0, 1, 0, 0, 1, 1], true), anim(12, [4, 5, 6, 7], true), anim(12, [2, 3, 0]), anim(12, [8, 9, 10])),
  },
  spinner: {
    w: 16,
    h: 16,
    anims: basic(anim(10, [0, 0, 0, 0, 0, 1, 0, 1], true), anim(15, [0, 2, 0, 3], true), anim(12, [0, 4, 5, 0]), anim(12, [6, 7, 8, 9])),
  },
  dm300: {
    w: 22,
    h: 20,
    anims: basic(anim(10, [0, 1], true), anim(10, [2, 3], true), anim(15, [4, 5, 6]), anim(20, [0, 7, 0, 7, 0, 7, 0, 7, 0, 7, 0, 7, 8])),
  },
  elemental: {
    w: 12,
    h: 14,
    anims: basic(anim(10, [0, 1, 2], true), anim(12, [0, 1, 3], true), anim(15, [4, 5, 6]), anim(15, [7, 8, 9, 10, 11, 12, 13, 12])),
  },
  monk: {
    w: 15,
    h: 14,
    anims: basic(anim(6, [1, 0, 1, 2], true), anim(15, [11, 12, 13, 14, 15, 16], true), anim(12, [3, 4, 3, 4]), anim(15, [1, 7, 8, 8, 9, 10])),
  },
  warlock: {
    w: 12,
    h: 15,
    anims: basic(anim(2, [0, 0, 0, 1, 0, 0, 1, 1], true), anim(15, [0, 2, 3, 4], true), anim(12, [0, 5, 6]), anim(15, [0, 7, 8, 8, 9, 10])),
  },
  golem: {
    w: 16,
    h: 16,
    anims: basic(anim(4, [0, 1], true), anim(12, [2, 3, 4, 5], true), anim(10, [6, 7, 8]), anim(15, [9, 10, 11, 12, 13])),
  },
  king: {
    w: 16,
    h: 16,
    anims: basic(anim(12, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2], true), anim(15, [3, 4, 5, 6, 7, 8], true), anim(15, [9, 10, 11]), anim(8, [12, 13, 14, 15])),
  },
  undead: {
    w: 12,
    h: 16,
    anims: basic(
      anim(12, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3], true), anim(15, [4, 5, 6, 7, 8, 9], true), anim(15, [14, 15, 16]),
      anim(12, [10, 11, 12, 13]),
    ),
  },
  succubus: {
    w: 12,
    h: 15,
    anims: basic(anim(8, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 2, 2, 2, 1], true), anim(15, [3, 4, 5, 6, 7, 8], true), anim(12, [9, 10, 11]), anim(10, [12])),
  },
  eye: {
    w: 16,
    h: 18,
    anims: basic(anim(8, [0, 1, 2], true), anim(12, [5, 6], true), anim(8, [4, 3]), anim(8, [7, 8, 9])),
  },
  scorpio: {
    w: 18,
    h: 17,
    anims: basic(anim(12, [0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 1, 2, 1, 2], true), anim(8, [5, 5, 6, 6], true), anim(15, [0, 3, 4]), anim(12, [0, 7, 8, 9, 10])),
  },
  yog: {
    w: 20,
    h: 19,
    anims: basic(anim(10, [0, 1, 2, 2, 1, 0, 3, 4, 4, 3, 0, 5, 6, 6, 5], true), anim(12, [0], true), anim(12, [0]), anim(10, [0, 7, 8, 9])),
  },
  rottingFist: {
    w: 24,
    h: 17,
    anims: basic(anim(2, [0, 0, 1], true), anim(3, [0, 1], true), anim(2, [0]), anim(10, [0, 2, 3, 4])),
  },
  burningFist: {
    w: 24,
    h: 17,
    anims: basic(anim(2, [0, 0, 1], true), anim(3, [0, 1], true), anim(8, [0, 5, 6]), anim(10, [0, 2, 3, 4])),
  },
  mimic: {
    w: 16,
    h: 16,
    anims: basic(anim(5, [0, 0, 0, 1, 1], true), anim(10, [0, 1, 2, 3, 3, 2, 1], true), anim(10, [0, 4, 5, 6]), anim(5, [7, 8, 9])),
  },
  larva: {
    w: 12,
    h: 8,
    anims: basic(anim(5, [4, 4, 4, 4, 4, 5, 5], true), anim(12, [0, 1, 2, 3], true), anim(15, [6, 5, 7]), anim(10, [8])),
  },
  imp: IMP_SPRITE,
  impShopkeeper: IMP_SPRITE,
  // The rare variants share their kind's sheet, further along it.
  // FetidRatSprite is the rat's; CursePersonificationSprite the wraith's.
  fetidRat: {
    w: 16,
    h: 15,
    anims: basic(anim(2, [0, 0, 0, 1], true), anim(10, [6, 7, 8, 9, 10], true), anim(15, [2, 3, 4, 5, 0]), anim(10, [11, 12, 13, 14])),
  },
  curse: {
    w: 14,
    h: 15,
    anims: basic(anim(5, [0, 1], true), anim(10, [0, 1], true), anim(10, [0, 2, 3]), anim(8, [0, 4, 5, 6, 7])),
  },
  bee: {
    w: 16,
    h: 16,
    anims: basic(anim(12, [0, 1, 1, 0, 2, 2], true), anim(15, [0, 1, 1, 0, 2, 2], true), anim(20, [3, 4, 5, 6]), anim(20, [7, 8, 9, 10])),
  },
  wraith: {
    w: 14,
    h: 15,
    anims: basic(anim(5, [0, 1], true), anim(10, [0, 1], true), anim(10, [0, 2, 3]), anim(8, [0, 4, 5, 6, 7])),
  },
  ratKing: {
    w: 16,
    h: 16,
    anims: basic(anim(2, [0, 0, 0, 1], true), anim(10, [2, 3, 4, 5, 6], true), anim(15, [0]), anim(10, [0])),
  },
  albino: {
    w: 16,
    h: 15,
    anims: basic(anim(2, [16, 16, 16, 17], true), anim(10, [22, 23, 24, 25, 26], true), anim(15, [18, 19, 20, 21]), anim(10, [27, 28, 29, 30])),
  },
  bandit: {
    w: 12,
    h: 13,
    anims: basic(anim(1, [21, 21, 21, 22, 21, 21, 21, 21, 22], true), anim(15, [21, 21, 23, 24, 24, 25], true), anim(12, [31, 32, 33]), anim(10, [25, 27, 28, 29, 30])),
  },
  shielded: {
    w: 12,
    h: 16,
    anims: basic(anim(2, [21, 21, 21, 22, 21, 21, 22, 22], true), anim(12, [25, 26, 27, 28], true), anim(12, [23, 24]), anim(12, [29, 30, 31])),
  },
  senior: {
    w: 15,
    h: 14,
    anims: basic(anim(6, [18, 17, 18, 19], true), anim(15, [28, 29, 30, 31, 32, 33], true), anim(12, [20, 21, 20, 21]), anim(15, [18, 24, 25, 25, 26, 27])),
  },
  acidic: {
    w: 18,
    h: 17,
    anims: basic(anim(12, [14, 14, 14, 14, 14, 14, 14, 14, 15, 16, 15, 16, 15, 16], true), anim(4, [19, 20], true), anim(15, [14, 17, 18]), anim(12, [14, 21, 22, 23, 24])),
  },
  mirror: { w: 12, h: 15, anims: HERO_ANIMS },
  // A prismatic image (PrismaticImage) is drawn with its hero's sheet too, until it has a sprite of its own.
  prismatic: { w: 12, h: 15, anims: HERO_ANIMS },
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
  statue: {
    w: 12,
    h: 15,
    anims: basic(anim(2, [0, 0, 0, 0, 0, 1, 1], true), anim(15, [2, 3, 4, 5, 6, 7], true), anim(12, [8, 9, 10]), anim(5, [11, 12, 13, 14, 15, 15])),
  },
  piranha: {
    w: 12,
    h: 16,
    anims: basic(anim(8, [0, 1, 2, 1], true), anim(20, [0, 1, 2, 1], true), anim(20, [3, 4, 5, 6, 7, 8, 9, 10, 11]), anim(4, [12, 13, 14])),
  },
  // Shattered's (assets/spd): WardSprite, one tier a row (see View.sync), EarthGuardianSprite and LotusSprite.
  ward: { w: 16, h: 16, anims: basic(anim(1, [0], true), anim(1, [0], true), anim(1, [0]), anim(1, [0])) },
  guardian: {
    w: 12,
    h: 15,
    anims: basic(anim(2, [0, 0, 0, 0, 0, 1, 1], true), anim(15, [2, 3, 4, 5, 6, 7], true), anim(12, [8, 9, 10]), anim(5, [11, 12, 13, 14, 15, 15])),
  },
  lotus: { w: 19, h: 16, anims: basic(anim(1, [0], true), anim(1, [0], true), anim(1, [0]), anim(1, [0])) },
  tengu: {
    w: 14,
    h: 16,
    anims: basic(anim(2, [0, 0, 0, 1], true), anim(15, [2, 3, 4, 5, 0]), anim(15, [6, 7, 7, 0]), anim(8, [8, 9, 10, 10, 10, 10, 10, 10])),
  },
};

/**
 * The tiles and water of a depth: 0 for the sewers (depths 1-5), 1 for the prison (6-10), 2 for the caves (11-15),
 * 3 for the city (16-20) and the last shop (21, LastShopLevel.tilesTex), 4 for the halls.
 */
export const regionOf = (depth: number): number =>
  depth === LAST_SHOP_DEPTH ? 3 : Math.min(4, Math.max(0, Math.floor((depth - 1) / 5)));

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
  const names = [
    'tiles0', 'water0', 'tiles1', 'water1', 'tiles2', 'water2', 'spinner', 'dm300', 'tiles3', 'water3',
    'elemental', 'monk', 'warlock', 'golem', 'king', 'undead', 'tiles4', 'water4',
    'succubus', 'eye', 'scorpio', 'yog', 'rottingFist', 'burningFist', 'larva', 'mimic', 'statue', 'piranha', 'imp', 'sheep', 'blacksmith', 'wraith', 'ratKing', 'bee', 'warrior', 'mage', 'rogue', 'ranger', 'rat', 'gnoll', 'crab', 'goo', 'ghost',
    'skeleton', 'thief', 'swarm', 'shaman', 'bat', 'brute', 'tengu', 'shopkeeper', 'wandmaker',
    'icons', 'items', 'plants', 'spd/wards', 'spd/guardian', 'spd/lotus',
  ] as const;
  let loaded = 0;
  const images = Object.fromEntries(
    await Promise.all(
      names.map(async (name) => {
        const image = await loadImage(`${base}${name}.png`);
        onProgress?.(++loaded / names.length);
        return [name, image] as const;
      }),
    ),
  ) as Record<(typeof names)[number], HTMLImageElement>;

  const hero = (image: HTMLImageElement): CharSprite => ({ sheet: sheet(image, 12, 15), anims: HERO_ANIMS });
  const mob = (kind: MobKind): CharSprite => {
    const spec = MOB_SPRITES[kind];
    // A mirror image is drawn with its hero's own sheet (see View.sync); the warrior's stands in here.
    const image = kind === 'mirror' || kind === 'prismatic' ? 'warrior' : kind === 'fetidRat' ? 'rat' : kind === 'curse' ? 'wraith' : kind === 'impShopkeeper' ? 'imp'
      : kind === 'ward' ? 'spd/wards' : kind === 'guardian' ? 'spd/guardian' : kind === 'lotus' ? 'spd/lotus' : baseKind(kind);
    return { sheet: sheet(images[image as (typeof names)[number]], spec.w, spec.h), anims: spec.anims };
  };
  return {
    tiles: [images.tiles0, images.tiles1, images.tiles2, images.tiles3, images.tiles4],
    water: [images.water0, images.water1, images.water2, images.water3, images.water4],
    heroes: {
      warrior: hero(images.warrior),
      mage: hero(images.mage),
      rogue: hero(images.rogue),
      huntress: hero(images.ranger),
    },
    mobs: Object.fromEntries((Object.keys(MOB_SPRITES) as MobKind[]).map((kind) => [kind, mob(kind)])) as Record<MobKind, CharSprite>,
    icons: images.icons,
    items: images.items,
    plants: images.plants,
  };
}

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
