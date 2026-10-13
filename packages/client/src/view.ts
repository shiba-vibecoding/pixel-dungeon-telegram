import {
  adjacent, cellX, cellY, type Effect, F, terrainFlags, type Enchantment, heroById, isAlive, isTippedDart, itemDef, type ItemKind, itemSprite, LENGTH, type MobKind,
  visibleCells, WIDTH, type World,
  type Look, S, isInvisible, frozenBy,
} from '@pd/core';
import { artText, capital } from './artifacttext';
import { audio, type Sound } from './audio';
import { between, hitSound, openSound, readSounds, TRAP_SOUNDS, weaponHit, woundSound } from './sfx';
import { capitalize, fill, t } from './i18n';
import { itemName, magicColor, plainName } from './itemtext';
import { type Flight, flightOf } from './gearfx';
import { type AnimName, type Assets, type CharSprite, duration, heroSprite } from './sprites';
import { haptic } from './telegram';
import { DEPTH_CARD_MS } from './cards';
import { BOLT_MS_PER_CELL, wandFx } from './wandfx';
import { SPELL_FRAMES, SPELL_LIFE, type Spell } from './spellfx';
import { subclassName, tal, talentMessage, talentTitle } from './talenttext';

/*
 * What the player sees, as opposed to what the world is: characters slide
 * between cells, play attack and death animations, flash when hit; numbers
 * float up; the message log fills. Everything here is cosmetic and local.
 */

export const STEP_MS = 110;
/**
 * How long after a step ends a walker still counts as walking: the next step
 * of a walk starts within a frame or two, and the legs should not stop for it.
 */
const WALK_GRACE_MS = 70;

/** Potions whose shattering does something; the rest splash harmlessly. */
const HARMFUL: ReadonlySet<ItemKind> = new Set([
  'potion.toxicGas', 'potion.paralyticGas', 'potion.liquidFlame', 'potion.frost', 'potion.purity',
]);

/** Colours of magic bolts in flight. */
const BOLT_COLORS: Record<string, string> = {
  magic: '255, 255, 255', lightning: '255, 255, 200', fire: '255, 130, 40', poison: '120, 220, 60', beam: '200, 90, 255', shadow: '90, 40, 120',
  // Shattered's wands (MagicMissile and Beam kinds).
  frost: '136, 204, 255', corrosion: '255, 136, 0', force: '102, 68, 34', earth: '128, 85, 0', ward: '136, 34, 255', corruption: '40, 0, 40',
  rainbow: '255, 120, 220', foliage: '68, 170, 68', death: '120, 0, 160', light: '255, 255, 210', blood: '204, 0, 0',
  // Alchemy's spells: wild energy's chaotic bolt, a telekinetic grab.
  wild: '210, 130, 255', grab: '240, 240, 255',
  // LloydsBeacon's zap (MagicMissile.BEACON).
  beacon: '255, 255, 255',
};

/** The bolts of Shattered's wands (and its wards): their zappers move, and they fly as MagicMissile does (wandfx.ts). */
const WAND_BOLTS = new Set(['magic', 'fire', 'frost', 'corrosion', 'force', 'earth', 'ward', 'corruption', 'rainbow', 'foliage', 'death', 'light', 'blood']);

/** What a wand's bolt sounds like as it strikes (WandOfMagicMissile, Frost, LivingEarth, Corruption: HIT_MAGIC; Corrosion: GAS). */
const HIT_SOUNDS: Partial<Record<string, Sound>> = { magic: 'hit_magic', frost: 'hit_magic', earth: 'hit_magic', corruption: 'hit_magic', corrosion: 'gas' };

/** CursedWand's effects' sounds (their own; the zap is played with the bolt). */
const CURSED_SOUNDS: Partial<Record<string, Sound[]>> = {
  randomGas: ['gas'], selfOoze: ['shatter'], healthTransfer: ['cursed'], alarm: ['challenge', 'alert'], sheepPolymorph: ['puff', 'sheep'],
  summonSheep: ['puff', 'sheep'], fireBall: ['blast', 'burning'], massInvuln: ['teleport'], petrify: ['teleport'], forestFire: ['teleport'],
  spawnGoldenMimic: ['mimic'], gravityChaos: ['teleport'], randomTeleport: ['teleport'], interFloorTeleport: ['teleport'],
};

/** The energy counter's colour (FloatingText.ENERGY, 0x44CCFF). */
const ENERGY_COLOR = '#44ccff';

/** What a potion's splash sounds like beyond the shatter (Potion.shatter overrides: GAS, BURNING, LIGHTNING). */
const SPLASH_SOUNDS: Partial<Record<ItemKind, Sound>> = {
  'potion.toxicGas': 'gas', 'potion.paralyticGas': 'gas', 'potion.corrosiveGas': 'gas', 'potion.shroudingFog': 'gas', 'potion.stormClouds': 'gas',
  'potion.levitation': 'gas', 'potion.liquidFlame': 'burning', 'brew.infernal': 'gas', 'brew.blizzard': 'gas', 'brew.shocking': 'lightning',
};

/** Each runestone's sound where it lands (StoneOfX.activate). */
const STONE_SOUNDS: Partial<Record<ItemKind, readonly Sound[]>> = {
  'stone.blast': [], 'stone.blink': ['teleport'], 'stone.clairvoyance': ['secret', 'teleport'], 'stone.deepSleep': ['lullaby'],
  'stone.flock': ['puff', 'sheep'], 'stone.shock': [], 'stone.aggression': ['read'], 'stone.fear': ['read'],
};

/** What each potion drunk and scroll read sounds like beyond DRINK and READ (Assets.Sounds in each class). */
const USE_SOUNDS: Partial<Record<ItemKind, Sound>> = {
  'potion.invisibility': 'meld', 'potion.divineInspiration': 'levelup', 'potion.dragonsBreath': 'burning',
  'scroll.lullaby': 'lullaby', 'scroll.rage': 'challenge', 'scroll.retribution': 'blast', 'scroll.recharging': 'chargeup',
  'scroll.mapping': 'secret', 'scroll.teleportation': 'teleport', 'scroll.challenge': 'challenge', 'scroll.psionicBlast': 'blast',
  'scroll.sirensSong': 'lullaby', 'scroll.mysticalEnergy': 'chargeup', 'scroll.passage': 'teleport',
};

/** What a hero says on drinking (Potion.apply's GLog lines). */
const DRINK_LINES: Partial<Record<ItemKind, 'haste' | 'invisible' | 'seeMobs' | 'featherLight'>> = {
  'potion.haste': 'haste', 'potion.invisibility': 'invisible', 'potion.mindVision': 'seeMobs', 'elixir.featherFall': 'featherLight',
};

/** Tints of the clouds: green poison, yellow paralysis, orange flames. */
const BURST_COLORS = {
  toxic: '90, 200, 60', paralytic: '230, 220, 70', fire: '255, 120, 30', frost: '170, 220, 255', purity: '240, 250, 255',
} as const;

/** ItemSprite.Glowing: the colour each enchantment shines with (as the item's mark shows it), as «r, g, b». */
const enchantColor = (enchant: Enchantment): string => {
  const hex = magicColor(enchant).replace('#', '');
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ');
};
export const TILE = 16;

/** The middle of a cell, world pixels. */
const cellMiddle = (cell: number): { x: number; y: number } => ({ x: cellX(cell) * TILE + TILE / 2, y: cellY(cell) * TILE + TILE / 2 });

export interface Puppet {
  id: string;
  /** Where the current step started, in world pixels: wherever the walker was, not the middle of a cell. */
  fromX?: number;
  fromY?: number;
  /** A diagonal step past a wall's corner bends towards the open side (world pixels of the curve's pull), so it never cuts through the wall. */
  bend?: { x: number; y: number };
  /**
   * The cell the step on screen heads for, when the walker is shown behind the world (`to` is
   * where it really is); and the steps still to show after it, one cell each. Monsters move a
   * cell per turn, and turns can come faster than steps are drawn (a companion acting, a rest):
   * they are shown one after another, a little quicker while behind, never skipped.
   */
  aim?: number;
  queue?: Array<{ cell: number; bend?: { x: number; y: number } }>;
  /** How long the step on screen takes (ms): STEP_MS, less while catching up. */
  moveDur?: number;
  /** A hero's Pixel-Mart look (effect, the patron's star); undefined for monsters. */
  look?: Look;
  /** Hero class or monster kind. */
  kind: string;
  sprite: CharSprite;
  isHero: boolean;
  from: number;
  to: number;
  moveStart: number;
  flip: boolean;
  anim: AnimName;
  animStart: number;
  alive: boolean;
  /** Dying monsters linger until their death animation has played. */
  removeAt: number;
  flashUntil: number;
  alertUntil: number;
  sleeping: boolean;
  /** Goo, pumped up for a big hit. */
  pumped: boolean;
  /** A hero under a potion of invisibility. */
  invisible: boolean;
  /** Row of the sprite sheet: heroes are drawn in their armour's tier. */
  row: number;
  /** Shown above companions in a party. */
  label: string;
  hp: number;
  ht: number;
  /** A melee lunge: when it began, and how far towards the target (world pixels). */
  lungeStart?: number;
  lungeX?: number;
  lungeY?: number;
  /** Knocked back by a blow: when, and how far (world pixels, along the blow); it springs back at once. */
  knockStart?: number;
  knockX?: number;
  knockY?: number;
  /** Slain and leaving a body: its sprite stays whole to the end of its death, then lies as a corpse (fx.ts). */
  laid?: boolean;
  /** Burning or poisoned: embers or bubbles rise off it. */
  burning?: boolean;
  poisoned?: boolean;
  /** Floating (a potion of levitation): it hovers over the floor, its shadow below. */
  levitating?: boolean;
  /** Fallen into a chasm (a monster): when it began to drop out of sight, spinning and shrinking. */
  fallStart?: number;
  /** CharSprite's states (Shattered): FROZEN in a block of ice, CHILLED under falling snow, DARKENED (corruption, doom), SHIELDED in a halo. */
  frozen?: boolean;
  chilled?: boolean;
  darkened?: boolean;
  shielded?: boolean;
  /** WardSprite: a sentry (tier 4 and up) bobs; a ward dims as it spends its shots (1 bright, down to 0.2). */
  bob?: boolean;
  dim?: number;
  /** LotusSprite: how far its leaves fall about it (cells). */
  reach?: number;
}

/** MobSprite.FALL_TIME: how long a monster takes to drop out of sight into a chasm. */
export const FALL_MS = 1000;

export interface Floater {
  text: string;
  color: string;
  /** World pixels. */
  x: number;
  y: number;
  start: number;
  /** Bigger for a heavy blow. */
  scale?: number;
  /** Drawn in its own colour even if it looks like a number (gold found). */
  word?: boolean;
}

export interface LogLine {
  text: string;
  color: string;
  time: number;
  /** The design system's tone for the colour: good, bad, warn, hl (highlight) or muted. */
  tone?: string;
  /** The depth it was said on, for the history's markers. */
  depth?: number;
  /** The same message in a row, shown as «×N». */
  count?: number;
}

/** Log colours of the original (GLog), as the design system's line tones. */
const TONES: Record<string, string> = {
  '#44ff44': 'good', '#ff4444': 'bad', '#ff8800': 'warn', '#ffff44': 'hl', '#cccccc': 'muted',
};

/** How many messages the history keeps. */
const HISTORY = 200;

export const COLORS = {
  default: '#ffffff',
  positive: '#44ff44',
  negative: '#ff4444',
  warning: '#ff8800',
  highlight: '#ffff44',
  neutral: '#cccccc',
  /** CharSprite's shielding status (FloatingText.SHIELDING). */
  shield: '#bbbbff',
};

/**
 * A diagonal step with a wall (or a door, a statue) on one side and room on the
 * other: the step curves through the open cell's side instead of over the
 * wall's corner. Open on both sides, or squeezed between two walls, it goes straight.
 */
function cornerBend(map: readonly number[] | undefined, from: number, to: number): { x: number; y: number } | undefined {
  if (!map || !adjacent(from, to) || cellX(from) === cellX(to) || cellY(from) === cellY(to)) return undefined;
  const side1 = cellX(to) + cellY(from) * WIDTH;
  const side2 = cellX(from) + cellY(to) * WIDTH;
  const solid = (cell: number): boolean => ((terrainFlags[map[cell] ?? 0] ?? 0) & F.SOLID) !== 0;
  const open = solid(side1) === solid(side2) ? null : solid(side1) ? side2 : side1;
  return open === null ? undefined : { x: cellX(open) * TILE, y: cellY(open) * TILE };
}

/** Where a step from (fromX, fromY) to a cell, started at `start`, has got to by `now`; round a corner if it bends. */
function segment(
  fromX: number, fromY: number, to: number, start: number, dur: number, bend: { x: number; y: number } | undefined, now: number,
): { x: number; y: number } {
  const k = Math.min(1, Math.max(0, (now - start) / dur));
  const toX = cellX(to) * TILE;
  const toY = cellY(to) * TILE;
  if (bend && k < 1) {
    // Round the corner: a curve pulled towards the open cell beside it.
    const a = (1 - k) * (1 - k), b = 2 * (1 - k) * k, c = k * k;
    return { x: a * fromX + b * bend.x + c * toX, y: a * fromY + b * bend.y + c * toY };
  }
  return { x: fromX + (toX - fromX) * k, y: fromY + (toY - fromY) * k };
}

/** Steps a walker may be shown behind the world before the oldest are cut short. */
const MAX_BEHIND = 4;

/**
 * Moves a walker on to its next queued step once the one on screen is done, straight on from
 * where it ended; with steps piling up it walks quicker, to catch up with the world.
 */
function advance(puppet: Puppet, now: number, step: number): void {
  const queue = puppet.queue;
  while (queue && queue.length > 0 && now >= puppet.moveStart + (puppet.moveDur ?? step)) {
    const next = queue.shift()!;
    const reached = puppet.aim ?? puppet.to;
    const end = puppet.moveStart + (puppet.moveDur ?? step);
    puppet.from = reached;
    puppet.fromX = cellX(reached) * TILE;
    puppet.fromY = cellY(reached) * TILE;
    puppet.aim = next.cell;
    puppet.bend = next.bend;
    // Never quicker than a third of a step, and never more than a few steps behind: the oldest are cut short.
    while (queue.length > MAX_BEHIND) queue.shift();
    puppet.moveDur = step / Math.min(3, 1 + 0.5 * queue.length);
    // Never further behind than half a step: a long pause (a hidden tab) does not replay a whole walk.
    puppet.moveStart = Math.max(end, now - puppet.moveDur / 2);
  }
}

/** When a region's intro starts to fade (cards.ts, TIMELINES.intro). */
const INTRO_FADE_MS = 5600;

/** Whether this device has not yet shown the region's intro; notes it as shown. */
function firstVisit(region: number): boolean {
  try {
    const seen = (localStorage.getItem('pd-intro-seen') ?? '').split(',').filter(Boolean);
    if (seen.includes(String(region))) return false;
    localStorage.setItem('pd-intro-seen', [...seen, region].join(','));
    return true;
  } catch {
    // Without storage, only the card: the intro would come back every time.
    return false;
  }
}

export class View {
  readonly puppets = new Map<string, Puppet>();
  /** How long a step takes on screen (ms): STEP_MS, or under live turns the room's beat, so walks never pause. */
  stepMs = STEP_MS;
  floaters: Floater[] = [];
  /** SpellSprites over characters (spellfx.ts). */
  spells: Spell[] = [];
  /** Cells lit up for a moment: discoveries and traps, or tinted clouds of gas and flame. */
  flashes: Array<{ cell: number; start: number; color?: string; duration?: number }> = [];
  log: LogLine[] = [];
  /** What each player wears (Pixel-Mart), by hero id: their look, effect and frame, and the patron's star. */
  looks: Record<string, Look> = {};
  depth = 0;
  /** When the "boss slain" banner appeared, or 0. */
  bannerStart = 0;
  /** A boss's title card: who, and when it appeared. */
  bossIntro: { kind: MobKind; start: number } | null = null;
  /** My level-up card: the new level, and when it appeared. */
  levelCard: { lvl: number; start: number } | null = null;
  /** A new region's card on the way down: the depth, and when it appeared. */
  /** The descent's card; `intro` on a region's first visit on this device, with its few lines of text. */
  depthCard: { depth: number; start: number; intro: boolean; title?: string; sub?: string; region?: number } | null = null;
  /** The arena's wave banner: its words, its kind, and when it shows (after a sinking card, if one is up). */
  waveCard: { title: string; sub: string; kind: '' | 'champions' | 'boss'; start: number } | null = null;
  /** Thrown items and magic bolts in flight; `sprite` null for a bolt. */
  projectiles: Array<{
    from: number; to: number; start: number; duration: number; sprite: number | null; color?: string;
    /** A wand's bolt (MagicMissile): its particles' kind (wandfx.ts), and whether it is one of a cone's (a wider emitter). */
    trail?: string; wide?: boolean;
    /** A thrown weapon flies as MissileSprite has it (gearfx.ts). */
    flight?: Flight;
  }> = [];
  /** Shattered's Chains effects: the ethereal chains thrown out from a cell to a cell (effects/Chains.java). */
  chains: Array<{ from: number; to: number; start: number; duration: number }> = [];
  /** TimekeepersHourglass.timeFreeze.fx: while my hero freezes time, everything else is drawn still and grey. */
  timeFrozen = false;

  constructor(private readonly assets: Assets) {}

  /** Starts over, e.g. after changing depth or receiving a new world. */
  reset(depth: number): void {
    this.depth = depth;
    this.puppets.clear();
    this.floaters = [];
    this.flashes = [];
    this.bannerStart = 0;
    this.bossIntro = null;
    this.levelCard = null;
    this.projectiles = [];
    this.chains = [];
  }

  /** Coming into a region (or setting out): its card, over the band in the middle. */
  enterRegion(depth: number, now: number): void {
    this.depthCard = { depth, start: now, intro: firstVisit(Math.floor((depth - 1) / 5)) };
  }

  /** The arena sinks to a region: its card, «Prison» and «The arena sinks deeper». */
  arenaSinks(region: number, title: string, sub: string, now: number): void {
    this.depthCard = { depth: region * 5 + 1, start: now, intro: false, title, sub, region };
  }

  /** A wave begins: its banner, after the sinking card if that is still up. */
  waveBanner(title: string, sub: string, kind: '' | 'champions' | 'boss', now: number): void {
    const card = this.depthCard;
    const after = card && !card.intro ? card.start + DEPTH_CARD_MS : now;
    this.waveCard = { title, sub, kind, start: Math.max(now, after) };
  }

  /** A tap skips a region's intro to its fading; true if there was one to skip. */

  skipIntro(now: number): boolean {
    const card = this.depthCard;
    if (!card?.intro || now - card.start >= INTRO_FADE_MS) return false;
    card.start = now - INTRO_FADE_MS;
    return true;
  }

  /**
   * Adds a message to the log. Messages are stamped with real time whatever
   * `_now` says: the log fades by the wall clock, which hit-stop never slows.
   */
  say(text: string, color = COLORS.default, _now?: number): void {
    const now = performance.now();
    const last = this.log[this.log.length - 1];
    if (last && last.text === text && now - last.time < 8000) {
      last.count = (last.count ?? 1) + 1;
      last.time = now;
      return;
    }
    this.log.push({ text, color, time: now, tone: TONES[color.toLowerCase()], depth: this.depth || undefined });
    if (this.log.length > HISTORY) this.log.shift();
  }

  /**
   * Brings puppets in line with the world for the depth being shown. Call
   * after apply(), so monsters killed in this update can still play dead.
   */
  sync(world: World, now: number, myId = ''): void {
    const seen = new Set<string>();
    // TimekeepersHourglass.timeFreeze.fx: everything else stands still while my hero freezes time.
    const me = myId ? heroById(world, myId) : undefined;
    this.timeFrozen = !!me && frozenBy(me) !== undefined;
    const place = (
      id: string, kind: string, sprite: CharSprite, isHero: boolean, pos: number, hp: number, ht: number, sleeping: boolean,
      pumped = false,
      invisible = false,
    ): void => {
      seen.add(id);
      let puppet = this.puppets.get(id);
      if (!puppet) {
        puppet = {
          id, kind, sprite, isHero, from: pos, to: pos, moveStart: 0, flip: false, anim: 'idle', animStart: now,
          alive: hp > 0, removeAt: Infinity, flashUntil: 0, alertUntil: 0, sleeping, pumped, invisible, row: 0, label: '',
          hp, ht,
        };
        if (!puppet.alive) {
          puppet.anim = 'die';
          puppet.animStart = -1e9;
        }
        this.puppets.set(id, puppet);
      } else if (puppet.to !== pos) {
        const map = world.levels[this.depth]?.map;
        // Where the walker will stand once what is on screen has played out.
        const shown = puppet.queue?.[puppet.queue.length - 1]?.cell ?? puppet.aim ?? puppet.to;
        const end = puppet.moveStart + (puppet.moveDur ?? this.stepMs);
        const walking = puppet.anim === 'run' && (now - end < WALK_GRACE_MS || (puppet.queue?.length ?? 0) > 0);
        if (cellX(pos) !== cellX(shown)) puppet.flip = cellX(pos) < cellX(shown);
        if (adjacent(pos, shown) && (now < end || (puppet.queue?.length ?? 0) > 0)) {
          // A step while the last is still on screen: it waits its turn (see advance), however fast turns come.
          (puppet.queue ??= []).push({ cell: pos, bend: cornerBend(map, shown, pos) });
        } else if (adjacent(pos, shown) && walking && now - end < this.stepMs / 2) {
          // The next step of a walk, a little late: it starts where and when the last one ended, without a standstill.
          puppet.fromX = cellX(shown) * TILE;
          puppet.fromY = cellY(shown) * TILE;
          puppet.from = shown;
          puppet.aim = pos;
          puppet.bend = cornerBend(map, shown, pos);
          puppet.moveStart = Math.max(end, now - this.stepMs / 2);
          puppet.moveDur = this.stepMs;
        } else {
          // A fresh start, or a jump (a blink, a push): from wherever the walker is shown now.
          const here = this.position(puppet, now);
          puppet.from = this.cellOf(puppet, now);
          puppet.fromX = here.x;
          puppet.fromY = here.y;
          puppet.aim = pos;
          puppet.queue = [];
          puppet.bend = adjacent(pos, puppet.from) ? cornerBend(map, puppet.from, pos) : undefined;
          puppet.moveStart = now;
          puppet.moveDur = this.stepMs;
        }
        puppet.to = pos;
        // Legs keep their stride along a walk; only a walk's first step starts the run anew.
        if (puppet.alive && puppet.anim !== 'attack' && !walking) {
          puppet.anim = 'run';
          puppet.animStart = now;
        }
      }
      puppet.hp = hp;
      puppet.ht = ht;
      puppet.sleeping = sleeping;
      puppet.pumped = pumped;
      puppet.invisible = invisible;
      if (hp > 0 && !puppet.alive) {
        // Revived.
        puppet.alive = true;
        puppet.laid = false;
        puppet.anim = 'idle';
        puppet.animStart = now;
      }
    };

    for (const hero of world.heroes) {
      if (hero.depth === this.depth) {
        place(
          hero.id, hero.heroClass, this.assets.heroes[hero.heroClass], true, hero.pos, hero.hp, hero.ht, false, false,
          isInvisible(hero),
        );
        const puppet = this.puppets.get(hero.id)!;
        // Pixel-Mart: the hero's look, once its sheet has loaded.
        // HeroDisguise (a cursed wand's): the hero looks like one of another class for a while.
        puppet.sprite = hero.disguise ? this.assets.heroes[hero.disguise.heroClass] : heroSprite(this.assets, hero.heroClass, this.looks[hero.id]?.skin);
        puppet.look = this.looks[hero.id];
        puppet.burning = hero.burning > 0;
        puppet.poisoned = hero.poison > 0;
        puppet.levitating = (hero.levitating ?? 0) > 0;
        this.condition(puppet, (hero.frozen ?? 0) > 0, (hero.chill ?? 0) > 0, false, (hero.shield ?? 0) > 0 || (hero.invulnerable ?? 0) > 0, now);
        puppet.row = itemDef(hero.armor.kind).tier ?? 0;
        puppet.label = hero.id === myId ? '' : hero.name;
      }
    }
    for (const mob of world.floors[this.depth]?.mobs ?? []) {
      // A mirror image looks like its hero, only fainter.
      // A prismatic image too, its hero's ally.
      const owner = mob.image?.owner ?? (mob.kind === 'prismatic' ? mob.owner : undefined);
      const twin = owner !== undefined ? world.heroes.find((hero) => hero.id === owner) : undefined;
      if (twin) {
        place(mob.id, 'mirror', this.assets.heroes[twin.heroClass], false, mob.pos, mob.hp, mob.ht, false, false, true);
        this.puppets.get(mob.id)!.sprite = heroSprite(this.assets, twin.heroClass, this.looks[twin.id]?.skin);
        this.puppets.get(mob.id)!.row = itemDef(twin.armor.kind).tier ?? 0;
        continue;
      }
      place(mob.id, mob.kind, this.assets.mobs[mob.kind], false, mob.pos, mob.hp, mob.ht,
        // A statue biding its time shows no sign of sleep.
        mob.state === 'sleeping' && mob.kind !== 'statue', mob.pumped);
      const puppet = this.puppets.get(mob.id)!;
      // WardSprite.updateTier: a ward drawn as its tier is (one a row of its sheet).
      if (mob.kind === 'ward') puppet.row = (mob.ward?.tier ?? 1) - 1;
      puppet.levitating = (mob.levitating ?? 0) > 0;
      puppet.burning = (mob.burning ?? 0) > 0;
      puppet.poisoned = (mob.poison ?? 0) > 0;
      this.condition(puppet, (mob.frozen ?? 0) > 0, (mob.chill ?? 0) > 0, !!mob.corrupted || !!mob.doomed, (mob.shield ?? 0) > 0 || (mob.invulnerable ?? 0) > 0, now);
      if (mob.ward) {
        puppet.bob = mob.ward.tier >= 4;
        puppet.dim = mob.ward.tier <= 3 ? Math.max(0.2, 1 - mob.ward.zaps / (2 * mob.ward.tier - 1)) : 1;
      }
      if (mob.lotus) puppet.reach = mob.lotus.level;
    }
    for (const [id, puppet] of this.puppets) {
      if (!seen.has(id) && (puppet.alive || now >= puppet.removeAt)) this.puppets.delete(id);
    }
    for (const puppet of this.puppets.values()) advance(puppet, now, this.stepMs);

    // Finished one-off animations fall back to idle (or keep running while moving).
    for (const puppet of this.puppets.values()) {
      if (!puppet.alive) continue;
      const moving = now - puppet.moveStart < (puppet.moveDur ?? this.stepMs) + WALK_GRACE_MS || (puppet.queue?.length ?? 0) > 0;
      if (puppet.anim === 'run' && !moving) {
        puppet.anim = 'idle';
        puppet.animStart = now;
      } else if (puppet.anim !== 'idle' && puppet.anim !== 'run' && now - puppet.animStart > duration(puppet.sprite.anims[puppet.anim])) {
        puppet.anim = moving ? 'run' : 'idle';
        puppet.animStart = now;
      }
    }
    this.floaters = this.floaters.filter((floater) => now - floater.start < 1200);
    this.spells = this.spells.filter((spell) => now - spell.start < SPELL_LIFE);
    this.flashes = this.flashes.filter((flash) => now - flash.start < (flash.duration ?? 600));
    this.projectiles = this.projectiles.filter((p) => now - p.start < p.duration);
  }

  private shoot(
    from: number, to: number, sprite: number | null, now: number, color?: string, trail?: string, wide?: boolean, crossbow = false,
  ): void {
    const cells = Math.max(Math.abs(cellX(to) - cellX(from)), Math.abs(cellY(to) - cellY(from)));
    // MagicMissile flies at its own pace (200 pixels a second); a thrown thing faster, as MissileSprite has it (arrows
    // half as fast again, crossbow darts three times).
    const flight = sprite === null || trail ? undefined : flightOf(sprite, crossbow);
    const duration = trail
      ? Math.min(600, Math.max(90, Math.hypot(cellX(to) - cellX(from), cellY(to) - cellY(from)) * BOLT_MS_PER_CELL))
      : Math.max(90, (cells * 45) / (flight?.speed ?? 1));
    this.projectiles.push({ from, to, start: now, duration, sprite, color, trail, wide, ...(flight ? { flight } : {}) });
  }

  /** CharSprite.add/remove(State): the conditions a creature is shown under, with their comings and goings. */
  private condition(puppet: Puppet, frozen: boolean, chilled: boolean, darkened: boolean, shielded: boolean, now: number): void {
    if (puppet.frozen && !frozen && puppet.alive) {
      // IceBlock.melt: Splash of 0xB2D6FF.
      const at = cellMiddle(puppet.to);
      wandFx.burst('melt', at.x, at.y, now, 5);
    }
    puppet.frozen = frozen;
    puppet.chilled = chilled;
    puppet.darkened = darkened;
    puppet.shielded = shielded;
  }

  /** A zapper's motion (Shattered's CharSprite.zap): a hero swings as in an attack; a ward flashes, sparks rising off it. */
  private zapper(cell: number, target: number, now: number): void {
    for (const puppet of this.puppets.values()) {
      if (!puppet.alive || puppet.to !== cell) continue;
      if (puppet.isHero) {
        puppet.anim = 'attack';
        puppet.animStart = now;
        if (cellX(target) !== cellX(cell)) puppet.flip = cellX(target) < cellX(cell);
      } else if (puppet.kind === 'ward') {
        puppet.flashUntil = now + 160;
        const at = cellMiddle(cell);
        wandFx.burst('ward', at.x, at.y - 4, now, 2);
      }
      return;
    }
  }

  /** How long my hero's step has still to go (ms; 0 or less when standing): the walk sends the next step as it ends. */
  stepLeft(id: string, now: number): number {
    const puppet = this.puppets.get(id);
    return puppet ? puppet.moveStart + (puppet.moveDur ?? this.stepMs) + (puppet.queue?.length ?? 0) * this.stepMs - now : 0;
  }

  /**
   * How long the monsters in sight still have to walk on screen (ms): playing alone, the hero
   * waits for them before the next turn, as the original's actors waited for their sprites,
   * so a rest or a long action never makes them dash or skip across the floor.
   */
  othersLeft(visible: readonly boolean[], now: number): number {
    let left = 0;
    for (const puppet of this.puppets.values()) {
      if (puppet.isHero || !puppet.alive) continue;
      if (!visible[puppet.to] && !(puppet.aim !== undefined && visible[puppet.aim])) continue;
      left = Math.max(left, puppet.moveStart + (puppet.moveDur ?? this.stepMs) + (puppet.queue?.length ?? 0) * this.stepMs - now);
    }
    return left;
  }

  /** Interpolated position in world pixels. */
  position(puppet: Puppet, now: number): { x: number; y: number } {
    return segment(
      puppet.fromX ?? cellX(puppet.from) * TILE, puppet.fromY ?? cellY(puppet.from) * TILE, puppet.aim ?? puppet.to,
      puppet.moveStart, puppet.moveDur ?? this.stepMs, puppet.bend, now,
    );
  }

  private cellOf(puppet: Puppet, now: number): number {
    return now - puppet.moveStart >= (puppet.moveDur ?? this.stepMs) / 2 ? puppet.aim ?? puppet.to : puppet.from;
  }

  /** A hero busy with their hands (drinking, reading, eating): the operate animation, as in the original. */
  private busy(id: string, now: number): void {
    const puppet = this.puppets.get(id);
    if (puppet?.alive && puppet.anim !== 'attack') {
      puppet.anim = 'operate';
      puppet.animStart = now;
    }
  }

  /** Where a character is, world pixels (its middle), for sounds that come from it. */
  private placeOf(id: string, now: number): { x: number; y: number } | undefined {
    const puppet = this.puppets.get(id);
    if (!puppet) return undefined;
    const { x, y } = this.position(puppet, now);
    return { x: x + TILE / 2, y: y + TILE / 2 };
  }

  private float(id: string, text: string, color: string, now: number, word = false): void {
    const puppet = this.puppets.get(id);
    if (!puppet) return;
    const { x, y } = this.position(puppet, now);
    // Stack texts that appear together over the same one so they stay readable (not over a neighbour).
    const stacked = this.floaters.filter((f) => now - f.start < 250 && Math.abs(f.x - x - TILE / 2) < 4 && y - f.y >= 0 && y - f.y < 15).length;
    this.floaters.push({ text, color, x: x + TILE / 2, y: y - stacked * 7, start: now, ...(word ? { word } : {}) });
  }

  private name(world: World, id: string): string {
    if (id.startsWith('#')) {
      const mob = world.floors[this.depth]?.mobs.find((m) => m.id === id);
      return mob ? t.mobs[mob.kind] : '';
    }
    return heroById(world, id)?.name ?? '';
  }

  apply(effects: readonly Effect[], world: World, myId: string, now: number): void {
    const searchedByMe = effects.some((e) => e.type === 'searched' && e.hero === myId);
    let discovered = false;
    // Traps announce their own gas and flames.
    let trapped = false;
    const mobKind = (depth: number, id: string, fallback: MobKind): MobKind =>
      world.floors[depth]?.mobs.find((mob) => mob.id === id)?.kind ?? fallback;
    // What the party sees on the depth shown, worked out only if something needs it.
    let sight: boolean[] | undefined;
    const seen = (cell: number): boolean => (sight ??= visibleCells(world, this.depth))[cell] === true;
    // A thrown weapon or a bolt that the next blow of this batch is struck with (KindOfWeapon.hitSound).
    let thrownKind: string | null = null;
    let bolt: string | null = null;
    // Hero.damage: my hero's health before each blow of the batch, for the warnings it rings.
    const me = heroById(world, myId);
    let woundsLeft = 0;
    for (const effect of effects) {
      if (effect.type === 'attack' && effect.hit && effect.target === myId) woundsLeft += effect.damage;
      if (effect.type === 'hurt' && effect.who === myId) woundsLeft += effect.damage;
    }
    const wounded = (damage: number): void => {
      if (!me || damage <= 0) return;
      const after = me.hp + woundsLeft - damage;
      const sound = isAlive(me) ? woundSound(after + damage, after, me.ht) : null;
      woundsLeft -= damage;
      if (sound) audio.play(sound.sound, 1, sound.volume);
    };
    for (const effect of effects) {
      switch (effect.type) {
        case 'attack': {
          if (effect.depth !== this.depth) break;
          const attacker = this.puppets.get(effect.attacker);
          const target = this.puppets.get(effect.target);
          if (attacker) {
            attacker.anim = 'attack';
            attacker.animStart = now;
            if (target && cellX(target.to) !== cellX(attacker.to)) attacker.flip = cellX(target.to) < cellX(attacker.to);
          }
          const place = this.placeOf(effect.target, now);
          // Char.attack: the attacker's weapon sounds the blow (a thrown one's, a bolt's own), a shield parries
          // what does no harm; a surprise blow strikes hard (Mob.damage: HIT_STRONG); a miss whooshes.
          const striker = heroById(world, effect.attacker);
          const weapon = striker ? (effect.weapon ?? thrownKind ?? striker.weapon?.kind ?? null) : null;
          if (effect.hit) {
            if (target) target.flashUntil = now + 160;
            const toHero = !effect.target.startsWith('#');
            this.float(effect.target, String(effect.damage), toHero ? COLORS.negative : COLORS.warning, now);
            if (striker && bolt) {
              // The bolt's impact sounds as it lands (the 'zapped' effect, HIT_SOUNDS: HIT_MAGIC for the magic missile,
              // frost, living earth and corruption, Wand.onZap); a beam, lightning and fire sound as they are cast.
            } else {
              const blow = hitSound(weapon, !!striker, effect.damage, heroById(world, effect.target)?.weapon?.kind);
              audio.play(blow.sound, blow.rate, 1, place);
            }
            // Mob.damage: a surprise attack's blow strikes hard, late for an arrow or a dart.
            if (striker && effect.surprise) {
              audio.later(weaponHit(weapon)[0] === 'hit_arrow' ? 125 : 0, 'hit_strong', 1, 1, place);
            }
            if (effect.target === myId) {
              haptic('hurt');
              wounded(effect.damage);
            } else if (effect.attacker === myId) haptic('hit');
          } else {
            this.float(effect.target, t.miss, COLORS.neutral, now);
            audio.play('miss', 1, 1, place);
          }
          if (striker) {
            thrownKind = null;
            bolt = null;
          }
          break;
        }
        case 'died': {
          if (effect.depth === this.depth) {
            const puppet = this.puppets.get(effect.who);
            if (puppet) {
              puppet.alive = false;
              puppet.anim = 'die';
              puppet.animStart = now;
              puppet.removeAt = puppet.isHero ? Infinity : now + duration(puppet.sprite.anims.die) + 700;
              if (puppet.kind === 'ward') {
                // WardSprite.die: no death to play, it fades away over two seconds as sparks rise off it.
                puppet.anim = 'idle';
                puppet.removeAt = now + 2000;
                const at = cellMiddle(puppet.to);
                wandFx.burst('ward', at.x, at.y, now, 10);
              } else if (puppet.frozen) {
                // IceBlock.melt: the ice splashes off.
                const at = cellMiddle(puppet.to);
                wandFx.burst('melt', at.x, at.y, now, 5);
              }
            }
          }
          if (effect.who.startsWith('#')) {
            const kind = this.puppets.get(effect.who)?.kind as MobKind | undefined;
            if (kind && effect.depth === this.depth) this.say(t.killed(t.mobs[kind]), COLORS.neutral, now);
          } else {
            audio.play('death');
            if (effect.who !== myId) this.say(t.heroDied(this.name(world, effect.who)), COLORS.negative, now);
          }
          break;
        }
        case 'noticed': {
          if (effect.depth !== this.depth) break;
          const puppet = this.puppets.get(effect.mob);
          if (puppet) puppet.alertUntil = now + 1200;
          const mob = world.floors[this.depth]?.mobs.find((m) => m.id === effect.mob);
          if (mob?.enemy === myId) this.say(capitalize(t.noticed(t.mobs[mob.kind])), COLORS.warning, now);
          break;
        }
        case 'exp':
          this.float(effect.hero, `+${effect.amount} XP`, COLORS.positive, now);
          break;
        case 'levelUp':
          this.float(effect.hero, t.levelUpFloat, COLORS.highlight, now);
          if (effect.hero === myId) {
            this.say(t.myLevelUp(effect.lvl), COLORS.highlight, now);
            audio.play('levelup');
            audio.duck(0.3, 1600);
            haptic('success');
          } else {
            this.say(t.levelUp(this.name(world, effect.hero), effect.lvl), COLORS.highlight, now);
          }
          break;
        case 'discovered':
          if (effect.depth === this.depth) this.flashes.push({ cell: effect.cell, start: now });
          if (!discovered) {
            this.say(t.found, COLORS.highlight, now);
            audio.play('secret');
          }
          discovered = true;
          break;
        case 'searched': {
          const puppet = this.puppets.get(effect.hero);
          if (puppet?.alive) {
            puppet.anim = 'operate';
            puppet.animStart = now;
          }
          break;
        }
        case 'revived':
          this.say(t.revived(this.name(world, effect.hero)), COLORS.positive, now);
          break;
        case 'resurrected':
          // Up again at the stairs: no sliding across the map (GameScene, RESURRECT: TELEPORT).
          this.puppets.delete(effect.hero);
          audio.play('teleport');
          this.say(effect.hero === myId ? t.resurrected : t.resurrectedCompanion(this.name(world, effect.hero)), COLORS.highlight, now);
          if (effect.hero === myId) haptic('success');
          break;
        case 'hurt':
          if (effect.depth === this.depth) this.float(effect.who, String(effect.damage), COLORS.negative, now);
          if (effect.who === myId) wounded(effect.damage);
          break;
        case 'oozed':
          if (effect.hero === myId) this.say(t.oozed, COLORS.negative, now);
          break;
        case 'pumped':
          if (effect.depth !== this.depth) break;
          this.float(effect.mob, '!!!', COLORS.negative, now);
          this.say(t.gooPumps, COLORS.negative, now);
          break;
        case 'yell': {
          if (effect.depth !== this.depth) break;
          const hero = heroById(world, effect.hero ?? myId);
          const notice = effect.line === 'notice';
          const line =
            effect.kind === 'goo' ? notice ? t.gooNotice : t.gooDeath
            : effect.kind === 'dm300' ? notice ? t.dm300Notice : t.dm300Death
            : effect.kind === 'yog' ? notice ? t.yogNotice : t.yogDeath
            : effect.kind === 'king'
              ? effect.line === 'summon' ? t.kingSummon : notice ? t.kingNotice : t.kingDeath(hero ? t.classes[hero.heroClass] : '')
            : notice ? t.tenguNotice(hero ? t.classes[hero.heroClass] : '') : t.tenguDeath;
          this.say(`${t.mobs[effect.kind]}: «${line}»`, COLORS.negative, now);
          break;
        }
        case 'bossSlain':
          this.bannerStart = now;
          this.say(t.bossSlain[effect.kind] ?? '', COLORS.highlight, now);
          audio.play('boss');
          audio.duck(0.25, 2500);
          haptic('success');
          break;
        case 'opened':
          // Hero.actOpenChest: a tomb's sound, remains', a chest's lock.
          if (effect.depth === this.depth) audio.play(openSound(effect.heap), 1, 1, cellMiddle(effect.pos));
          break;
        case 'pickedUp': {
          // Whoever takes something stoops for it.
          const taker = this.puppets.get(effect.hero);
          if (taker?.alive && taker.anim !== 'attack') {
            taker.anim = 'operate';
            taker.animStart = now;
          }
          if (effect.item.kind === 'gold') this.float(effect.hero, `+${effect.item.qty}`, COLORS.highlight, now, true);
          if (effect.hero !== myId) break;
          if (effect.item.kind === 'gold') {
            this.say(t.youFoundGold(effect.item.qty), COLORS.highlight, now);
            // Gold.doPickUp.
            audio.play('gold');
          } else {
            this.say(t.youPicked(itemName(world, effect.item)), COLORS.default, now);
            audio.play('item');
          }
          break;
        }
        case 'packFull':
          if (effect.hero === myId) this.say(t.packFull, COLORS.warning, now);
          break;
        case 'dropped':
          // What it lands on sounds as it lands (motion.ts: ItemSprite.drop).
          break;
        case 'equipped':
          if (effect.hero === myId) this.say(t.equippedItem(itemName(world, effect.item)), COLORS.default, now);
          break;
        case 'used': {
          const category = itemDef(effect.kind).category;
          const potion = category === 'potion' || category === 'brew' || category === 'elixir';
          // Potion.drink: DRINK; a scroll read: READ, or its own (sfx.ts readSounds); and what the item adds (USE_SOUNDS).
          const sounds = potion ? (['drink'] as const) : readSounds(effect.kind);
          for (const sound of sounds) audio.play(sound, 1, 1, this.placeOf(effect.hero, now));
          const extra = USE_SOUNDS[effect.kind];
          if (extra && !(sounds as readonly Sound[]).includes(extra)) audio.later(160, extra, 1, 1, this.placeOf(effect.hero, now));
          const line = DRINK_LINES[effect.kind];
          if (effect.hero === myId && line) this.say(t.alch[line], COLORS.default, now);
          this.busy(effect.hero, now);
          if (effect.identified) this.say(t.itWas(t.items[effect.kind]), COLORS.highlight, now);
          if (effect.hero === myId && effect.kind === 'potion.levitation') this.say(t.floating, COLORS.default, now);
          if (effect.hero === myId && effect.kind === 'potion.purity') this.say(t.noSmell, COLORS.default, now);
          break;
        }
        case 'identified':
          if (effect.hero === myId) this.say(t.identifiedAs(t.items[effect.kind]), COLORS.highlight, now);
          break;
        case 'revealed':
          // ScrollOfIdentify: "It is %s".
          if (effect.hero === myId) this.say(t.identifiedAs(itemName(world, effect.item)), COLORS.highlight, now);
          break;
        case 'familiar': {
          // Weapon.proc, Armor.proc, RingBuff.act: what it was called, and what it turns out to be; Wand.wandUsed: just its name.
          if (effect.hero !== myId) break;
          const item = effect.item;
          if (item.kind.startsWith('wand.')) {
            this.say(t.familiarWand(itemName(world, item)), COLORS.highlight, now);
          } else {
            const was = effect.learned ? t.unknownRing(t.gems[world.run.labels[item.kind] ?? 0]!) : plainName(world, item);
            this.say(t.familiar(was, itemName(world, item)), COLORS.highlight, now);
          }
          break;
        }
        case 'fizzled':
          if (effect.hero === myId) this.say(t.noCharges, COLORS.warning, now);
          break;
        case 'healed':
          if (effect.amount > 0) this.float(effect.hero, `+${effect.amount}`, COLORS.positive, now);
          break;
        case 'strength':
          this.float(effect.hero, `+1 ${t.strShort}`, COLORS.positive, now);
          if (effect.hero === myId) this.say(t.stronger, COLORS.positive, now);
          break;
        case 'upgraded':
          if (effect.hero === myId) this.say(t.upgradedItem(itemName(world, effect.item)), COLORS.highlight, now);
          break;
        case 'worn':
          // Item.use: the bearer hears of it, if they know the item's level; breaking is loud.
          if (effect.hero !== myId) break;
          if (itemDef(effect.item.kind).category === 'missile') {
            // MissileWeapon.decrementDurability (TippedDart's own words).
            const tipped = isTippedDart(effect.item.kind);
            const warning = effect.state === 'warning';
            this.say(warning ? (tipped ? t.gear.tipAboutToBreak : t.gear.aboutToBreak) : tipped ? t.gear.tipHasBroken : t.gear.hasBroken,
              warning ? COLORS.warning : COLORS.negative, now);
            if (!warning) audio.play('degrade');
            break;
          }
          if (effect.state === 'warning') {
            this.say(t.goingToBreak(itemName(world, { ...effect.item, durability: undefined })), COLORS.warning, now);
          } else {
            this.say(t.hasBroken(itemName(world, { ...effect.item, durability: undefined })), COLORS.negative, now);
            audio.play('degrade');
            haptic('error');
          }
          break;
        case 'mended':
          if (effect.hero === myId) this.say(t.mended(itemName(world, effect.item)), COLORS.positive, now);
          break;
        case 'teleported':
          // Appear at once in the new place rather than sliding across the map.
          this.puppets.delete(effect.hero);
          audio.play('teleport');
          if (effect.hero === myId) this.say(t.teleported, COLORS.default, now);
          break;
        case 'mapped':
          // ScrollOfMagicMapping: SECRET, as the map comes.
          if (effect.hero === myId) {
            this.say(t.mapped, COLORS.highlight, now);
            audio.play('secret');
          }
          break;
        case 'scroll':
          if (effect.kind === 'removeCurse') {
            if (effect.hero === myId) this.say(effect.count > 0 ? t.uncursed : t.nothingCursed, COLORS.default, now);
          } else if (effect.kind === 'recharging') {
            // ScrollOfRecharging: the charge-up, and energy gathering on the reader.
            audio.play('chargeup');
            const at = this.placeOf(effect.hero, now);
            if (at) wandFx.burst('energy', at.x, at.y, now, 15);
            if (effect.hero === myId) this.say(effect.count > 0 ? t.recharged : t.nothingToRecharge, COLORS.default, now);
          } else if (effect.kind === 'psionic') {
            if (effect.hero === myId) this.say(t.psionic, COLORS.warning, now);
          } else {
            this.say(effect.kind === 'challenge' ? t.challenge : effect.kind === 'terror' ? t.terror : t.lullaby, COLORS.warning, now);
          }
          break;
        case 'enchanted':
          // The weapon's glow flares up on whoever it struck.
          if (effect.depth === this.depth) {
            this.flashes.push({ cell: effect.pos, start: now, color: enchantColor(effect.enchant), duration: 500 });
          }
          break;
        case 'glyph':
          if (effect.depth === this.depth) this.float(effect.hero, t.glyphShort[effect.glyph], COLORS.highlight, now);
          break;
        case 'pushed':
          break;
        case 'imbued':
          // ScrollOfEnchantment: what reading it sounds (READ) is all.
          if (effect.hero === myId) this.say(t.imbued(itemName(world, effect.item)), COLORS.highlight, now);
          break;
        case 'disenchanted':
          if (effect.hero === myId) this.say(t.disenchanted(itemName(world, effect.item)), COLORS.warning, now);
          break;
        case 'mobFell': {
          // Chasm.mobFall: the monster drops out of sight, spinning and shrinking (MobSprite.fall).
          if (effect.depth !== this.depth) break;
          const puppet = this.puppets.get(effect.mob);
          if (puppet) {
            puppet.alive = false;
            puppet.fallStart = now;
            puppet.removeAt = now + FALL_MS;
          }
          if (seen(effect.pos)) {
            audio.play('falling', 1, 1, { x: cellX(effect.pos) * TILE + TILE / 2, y: cellY(effect.pos) * TILE + TILE / 2 });
            this.say(t.mobFell(t.mobs[effect.kind]), COLORS.neutral, now);
          }
          break;
        }
        case 'fell':
          if (effect.hero !== myId && effect.depth === this.depth) {
            this.puppets.delete(effect.hero);
            this.say(t.fellCompanion(this.name(world, effect.hero)), COLORS.warning, now);
          }
          break;
        case 'shattered':
          audio.play('shatter');
          if (effect.identified) this.say(t.itWas(t.items[effect.kind]), COLORS.highlight, now);
          else if (effect.hero === myId && !HARMFUL.has(effect.kind)) this.say(t.splashes, COLORS.default, now);
          break;
        case 'burst':
          if (effect.depth !== this.depth) break;
          for (let y = -effect.radius; y <= effect.radius; y++) {
            for (let x = -effect.radius; x <= effect.radius; x++) {
              const cell = effect.pos + x + y * WIDTH;
              if (cellX(effect.pos) + x >= 0 && cellX(effect.pos) + x < WIDTH && cell >= 0 && cell < LENGTH) {
                this.flashes.push({ cell, start: now, color: BURST_COLORS[effect.kind], duration: 1400 });
              }
            }
          }
          // The gas potions' GAS, liquid flame's BURNING (a trap's gas and flames are its own).
          if (!trapped && (effect.kind === 'toxic' || effect.kind === 'paralytic')) audio.play('gas', 1, 1, cellMiddle(effect.pos));
          if (!trapped && effect.kind === 'fire') audio.play('burning', 1, 1, cellMiddle(effect.pos));
          if (!trapped && !effect.silent) this.say(t.bursts[effect.kind], COLORS.warning, now);
          break;
        case 'unlocked':
          audio.play('unlock');
          if (effect.hero === myId) this.say(t.unlocked, COLORS.default, now);
          break;
        case 'well':
          audio.play('drink');
          if (effect.hero === myId) {
            this.say(
            effect.water === 'health' ? t.wellHealth : effect.water === 'awareness' ? t.wellAwareness : t.wellTransmutation,
            COLORS.positive, now,
          );
            haptic('success');
          }
          break;
        case 'thrown':
          thrownKind = effect.item;
          // Item.throwSound.
          if (effect.depth === this.depth) audio.play('miss', 1.5, 0.6, cellMiddle(effect.from));
          if (effect.depth === this.depth) {
            // Item.throwSound (a crossbow's shot for a dart, with a crossbow in hand).
            const thrower = world.heroes.find((h) => h.depth === effect.depth && h.pos === effect.from);
            const crossbow = thrower?.weapon?.kind === 'weapon.crossbow' && (effect.item === 'missile.dart' || effect.item.endsWith('Dart'));
            this.shoot(effect.from, effect.to, itemSprite({ kind: effect.item, qty: 1, level: 0 }, world.run.labels), now, undefined, undefined, undefined, crossbow);
            audio.play(crossbow ? 'atk_crossbow' : 'miss', crossbow ? 1 : 1.5, 0.6, cellMiddle(effect.from));
          }
          break;
        case 'zapped': {
          const kind = effect.bolt ?? 'magic';
          // (The blow it strikes next is the bolt's: its impact sounds as it lands, below.)
          bolt = kind;
          const here = effect.depth === this.depth;
          const from = cellMiddle(effect.from);
          const to = cellMiddle(effect.to);
          if (here && WAND_BOLTS.has(kind)) this.zapper(effect.from, effect.to, now);
          if (here && wandFx.isBeam(kind)) {
            // Beam.DeathRay, LightRay, HealthRay: at once from end to end, fading.
            wandFx.beam(from.x, from.y, to.x, to.y, kind, now);
          } else if (here && kind === 'lightning') {
            // Lightning: an arc, and sparks off what it strikes.
            if (effect.from === effect.to) wandFx.arc(from.x, from.y - 8, to.x, to.y + 4, now);
            else wandFx.arc(from.x, from.y, to.x, to.y, now);
            wandFx.burst('spark', to.x, to.y, now, 3);
            this.flashes.push({ cell: effect.to, start: now, color: '255, 255, 220', duration: 200 });
          } else if (here) {
            this.shoot(effect.from, effect.to, null, now, BOLT_COLORS[kind], WAND_BOLTS.has(kind) ? kind : undefined);
          }
          const at = here ? from : undefined;
          // Shattered's sounds: a ray for the beams, lightning's own, the zap for every missile.
          audio.play(wandFx.isBeam(kind) ? 'ray' : kind === 'lightning' ? 'lightning' : 'zap', 1, 1, at);
          // On striking: magic hits (DamageWand's missiles, frost, living earth, corruption), corrosive gas let out.
          const arrive = here && !wandFx.isBeam(kind) && kind !== 'lightning' ? Math.min(600, Math.hypot(cellX(effect.to) - cellX(effect.from), cellY(effect.to) - cellY(effect.from)) * BOLT_MS_PER_CELL) : 0;
          const impact = HIT_SOUNDS[kind];
          if (impact) audio.later(arrive, impact, between(0.87, 1.15), 1, here ? to : undefined);
          break;
        }
        case 'avalanche':
          if (effect.depth !== this.depth) break;
          for (const cell of effect.cells) this.flashes.push({ cell, start: now, color: '150, 140, 120', duration: 900 });
          audio.play('rocks');
          break;
        case 'disarmed':
          if (effect.hero === myId) {
            this.say(t.disarmed(t.mobs[mobKind(effect.depth, effect.mob, 'monk')], itemName(world, effect.item)), COLORS.negative, now);
          }
          break;
        case 'transmuted':
          audio.play('evoke');
          if (effect.hero === myId) this.say(t.transmuted(itemName(world, effect.from), itemName(world, effect.to)), COLORS.highlight, now);
          break;
        case 'classArmor':
          audio.play('evoke');
          if (effect.hero === myId) this.say(t.classArmorMade(itemName(world, effect.item)), COLORS.highlight, now);
          break;
        case 'special':
          audio.play(effect.ability === 'smokeBomb' ? 'puff' : effect.ability === 'moltenEarth' ? 'burning' : effect.ability === 'leap' ? 'rocks' : 'miss');
          if (effect.ability === 'smokeBomb') {
            this.flashes.push({ cell: effect.from, start: now, color: '200, 200, 200', duration: 600 });
            this.puppets.delete(effect.hero);
          }
          if (effect.hero === myId) this.say(t.specialUsed[effect.ability]!, COLORS.highlight, now);
          break;
        case 'mined':
          // Hero.actMine: a vein of gold struck out (EVOKE).
          if (effect.depth !== this.depth) break;
          this.flashes.push({ cell: effect.pos, start: now, color: '255, 210, 90', duration: 500 });
          audio.play('evoke', 1, 1, cellMiddle(effect.pos));
          break;
        case 'smith':
          break;
        case 'mirrored':
          if (effect.depth !== this.depth) break;
          for (const cell of effect.cells) this.flashes.push({ cell, start: now, color: '200, 220, 255', duration: 500 });
          if (effect.hero === myId) this.say(t.mirrored(effect.cells.length), COLORS.default, now);
          break;
        case 'flock':
          if (effect.depth !== this.depth) break;
          for (const cell of effect.cells) this.flashes.push({ cell, start: now, color: '255, 255, 255', duration: 500 });
          // StoneOfFlock, FlockTrap: PUFF and SHEEP.
          audio.play('puff');
          audio.play('sheep', between(0.91, 1.1));
          break;
        case 'faded':
          if (effect.depth !== this.depth) break;
          this.puppets.delete(effect.mob);
          this.flashes.push({ cell: effect.pos, start: now, color: '255, 255, 255', duration: 500 });
          break;
        case 'baa':
          if (effect.depth === this.depth) {
            this.float(effect.mob, t.baa[Math.floor(Math.random() * t.baa.length)]!, COLORS.default, now);
            // Sheep.interact.
            audio.play('sheep', between(0.91, 1.1));
          }
          break;
        case 'missile':
          if (effect.depth === this.depth) this.shoot(effect.from, effect.to, effect.sprite, now);
          // SpiritArrow.throwSound: the spirit bow's own.
          if (effect.sprite === S.SPIRIT_ARROW) audio.play('atk_spiritbow', 0.87 + Math.random() * 0.28);
          else audio.play('miss', 1.4, 0.6);
          break;
        case 'jumped':
          // Gone in a puff of smoke, and there at once in the new place.
          if (effect.depth !== this.depth) break;
          this.puppets.delete(effect.mob);
          this.flashes.push({ cell: effect.from, start: now, color: '220, 220, 220', duration: 500 });
          this.flashes.push({ cell: effect.to, start: now, color: '220, 220, 220', duration: 500 });
          audio.play('puff');
          break;
        case 'stole':
          if (effect.hero === myId) this.say(t.stole(t.mobs[mobKind(effect.depth, effect.mob, 'thief')], itemName(world, effect.item)), COLORS.warning, now);
          else if (effect.depth === this.depth) this.say(t.robbed(this.name(world, effect.hero)), COLORS.warning, now);
          break;
        case 'cornered':
          if (effect.depth === this.depth) this.say(t.cornered(t.mobs[effect.kind]), COLORS.warning, now);
          break;
        case 'enraged':
          if (effect.depth !== this.depth) break;
          this.float(effect.mob, '!!!', COLORS.negative, now);
          this.say(t.enraged(t.mobs[mobKind(effect.depth, effect.mob, 'brute')]), COLORS.warning, now);
          break;
        case 'bones':
          if (effect.depth !== this.depth) break;
          audio.play('bones', 1, 1, cellMiddle(effect.pos));
          this.flashes.push({ cell: effect.pos, start: now, color: '230, 225, 200', duration: 700 });
          break;
        case 'bought':
        case 'sold':
          if (effect.hero !== myId) break;
          audio.play('gold');
          this.say(
            (effect.type === 'bought' ? t.bought : t.sold)(itemName(world, effect.item), effect.price),
            COLORS.highlight, now,
          );
          break;
        case 'shopkeeperFled':
          if (effect.depth !== this.depth) break;
          this.puppets.delete(effect.mob);
          this.flashes.push({ cell: effect.pos, start: now, color: '220, 220, 220', duration: 600 });
          audio.play('puff');
          this.say(t.shopkeeperFled, COLORS.warning, now);
          break;
        case 'shop':
          break;
        case 'arena':
          if (effect.depth === this.depth && effect.sealed) {
            this.say(effect.depth === 15 ? t.lairSealed : t.arenaSealed, COLORS.warning, now);
            audio.play(effect.depth === 15 ? 'rocks' : 'door_open', 0.7);
          }
          break;
        case 'weakened':
          if (effect.hero === myId) this.say(t.weakened, COLORS.negative, now);
          break;
        case 'plantTriggered':
          if (effect.depth !== this.depth) break;
          this.flashes.push({ cell: effect.pos, start: now, color: '120, 220, 120', duration: 700 });
          if (effect.who === myId && t.plants[effect.kind]) this.say(t.plants[effect.kind], COLORS.warning, now);
          break;
        /* Shattered's wands */
        case 'wand': {
          if (effect.hero !== myId) break;
          const note = t.wandNotes[effect.note];
          if (!note) break;
          const name = effect.item ? t.items[effect.item] : '';
          const tone = effect.note === 'curseDiscover' ? COLORS.negative
            : effect.note === 'staffImbued' || effect.note === 'charged' ? COLORS.positive
            : effect.note === 'selfTarget' ? COLORS.default : COLORS.warning;
          this.say(note(name), tone, now);
          if (effect.note === 'curseDiscover') audio.play('cursed');
          if (effect.note === 'staffImbued') {
            // MagesStaff.imbueWand: a burst of Elmo's fire off the mage.
            audio.play('burning');
            const at = this.placeOf(effect.hero, now);
            if (at) wandFx.burst('elmo', at.x, at.y, now, 12);
          }
          break;
        }
        case 'cone': {
          // MagicMissile's cones: a missile to the tip of every outer ray (every other one, if there are many).
          if (effect.depth !== this.depth) break;
          const step = effect.cells.length > 16 ? 2 : 1;
          this.zapper(effect.from, effect.cells[Math.floor(effect.cells.length / 2)] ?? effect.from, now);
          for (let i = 0; i < effect.cells.length; i += step) this.shoot(effect.from, effect.cells[i]!, null, now, BOLT_COLORS[effect.bolt], effect.bolt, true);
          // WandOfFireblast.fx: the zap and the roar of fire; the others, the zap alone.
          audio.play('zap', 1, 1, cellMiddle(effect.from));
          if (effect.bolt === 'fire') audio.play('burning', 1, 1, cellMiddle(effect.from));
          break;
        }
        case 'blast':
          // WandOfBlastWave.BlastWave: a ripple out from where it struck.
          if (effect.depth !== this.depth) break;
          {
            const at = cellMiddle(effect.pos);
            wandFx.ripple(at.x, at.y, effect.radius, now);
          }
          audio.play('blast', 1, 1, cellMiddle(effect.pos));
          break;
        case 'barrier':
          // Barrier (ShieldBuff): FloatingText.SHIELDING over whoever got it.
          if (effect.depth === this.depth && effect.amount > 0) this.float(effect.who, `+${effect.amount}`, COLORS.shield, now);
          break;
        case 'mobHealed':
          if (effect.depth === this.depth && effect.amount > 0) this.float(effect.mob, `+${effect.amount}`, COLORS.positive, now);
          break;
        case 'ally': {
          if (effect.depth !== this.depth) break;
          const word = t.allyEvents[effect.event];
          if (word) this.float(effect.mob, word, effect.event === 'doomed' ? COLORS.negative : '#cc66ff', now, true);
          const place = this.placeOf(effect.mob, now);
          if (effect.event === 'dissolved') {
            // EarthGuardian / Ward dissolving: a puff of their particles where they stood.
            const kind = this.puppets.get(effect.mob)?.kind;
            if (place) wandFx.burst(kind === 'ward' ? 'ward' : kind === 'lotus' ? 'foliage' : 'earth', place.x, place.y, now, 10);
            this.puppets.delete(effect.mob);
          }
          // Corruption and doom: the cursed sound; a ward or guardian rising, a lotus growing: the zap's.
          audio.play(effect.event === 'corrupted' || effect.event === 'doomed' ? 'cursed' : 'zap', 1, 1, place);
          break;
        }
        case 'debuffed': {
          if (effect.depth !== this.depth) break;
          const word = t.debuffNames[effect.debuff];
          if (word) this.float(effect.mob, word, COLORS.warning, now, true);
          break;
        }
        case 'cursedZap': {
          if (effect.hero !== myId) break;
          const line = t.cursedEffects[effect.effect];
          if (line) this.say(line, effect.effect === 'massInvuln' ? COLORS.positive : COLORS.warning, now);
          // CursedWand's effects' own sounds.
          for (const name of CURSED_SOUNDS[effect.effect] ?? []) audio.play(name);
          break;
        }
        case 'supernova':
          // SuperNovaTracker: the ball of energy grows, turn by turn, where the wand struck.
          if (effect.depth !== this.depth) break;
          this.flashes.push({ cell: effect.pos, start: now, color: '255, 255, 80', duration: 700 });
          if (effect.turns > 0) this.say(`${effect.turns}...`, COLORS.warning, now);
          else audio.play('blast');
          break;
        case 'sinkhole':
          if (effect.depth !== this.depth) break;
          for (const cell of effect.cells) this.flashes.push({ cell, start: now, color: '90, 70, 50', duration: 800 });
          audio.play('rocks');
          break;
        case 'ward':
          break;
        case 'planted':
          // Plant.couch: PLANT, where it is seen.
          if (effect.depth === this.depth && seen(effect.pos)) audio.play('plant', 1, 1, cellMiddle(effect.pos));
          break;
        case 'combo':
          if (effect.hero === myId) this.float(effect.hero, tal('actors.buffs.combo.combo', effect.count), COLORS.highlight, now, true);
          break;
        case 'mastered':
          // TengusMask: MASTERY.
          if (effect.hero === myId) {
            this.say(t.mastered(capital(subclassName(effect.subclass))), COLORS.highlight, now);
            audio.play('mastery');
          }
          break;
        case 'talent':
          // TalentButton.upgradeTalent: LEVELUP, a little higher and quieter.
          if (effect.hero === myId) {
            audio.play('levelup', 0.7, 1.2);
            this.say(`${capital(talentTitle(effect.talent))} (${effect.points})`, COLORS.positive, now);
          }
          break;
        case 'spell':
          // SpellSprite.show.
          if (this.puppets.has(effect.hero)) this.spells.push({ hero: effect.hero, frame: SPELL_FRAMES[effect.sprite], ...(effect.tint ? { tint: effect.tint } : {}), start: now });
          break;
        case 'charged':
          // ScrollOfRecharging.charge: energy sparks around the hero.
          if (effect.hero === myId) audio.play('chargeup');
          break;
        case 'berserk':
          // Berserk.startBerserking: SpellSprite.BERSERK, CHALLENGE, the screen flashing red, the shield's worth floating.
          if (this.puppets.has(effect.hero)) this.spells.push({ hero: effect.hero, frame: SPELL_FRAMES.berserk, start: now });
          this.float(effect.hero, `+${effect.amount}`, COLORS.shield, now);
          if (effect.hero === myId) audio.play('challenge');
          break;
        case 'comboMove':
          // Combo.doAttack: the strike's own sound is the hit's; a parry rings.
          if (effect.move === 'parry') audio.play('hit_parry', 1, 0.96 + Math.random() * 0.09);
          if (effect.hero === myId) this.float(effect.hero, capital(tal(`actors.buffs.combo$combomove.${effect.move}.name`)), COLORS.highlight, now, true);
          break;
        case 'comboEnd':
          break;
        case 'leapt':
          // Hero.jump: a leap to the target (enhanced combo).
          if (effect.depth === this.depth) audio.play('miss', 1, 0.8);
          break;
        case 'freerun':
          // Momentum.doAction: MISS at a lower pitch, a jet of speed, SpellSprite.HASTE in yellow.
          audio.play('miss', 1, 0.8);
          if (this.puppets.has(effect.hero)) this.spells.push({ hero: effect.hero, frame: SPELL_FRAMES.haste, tint: [1, 1, 0], start: now });
          break;
        case 'snipe':
          // SpiritBow.sniperSpecial: the special shot's name over the hero.
          if (effect.hero === myId) this.float(effect.hero, capital(tal(`actors.buffs.snipersmark.action_name_${effect.kind === 'none' ? 'snapshot' : effect.kind === 'speed' ? 'volley' : 'sniper'}`)), COLORS.highlight, now, true);
          break;
        case 'hit':
          // WandEmpower and PhysicalEmpower: HIT_STRONG at 0.75, 1.2.
          if (effect.hero === myId) audio.play('hit_strong', 0.75, 1.2);
          break;
        case 'tmsg':
          if (effect.hero === myId) {
            const line = talentMessage(effect.key, ...(effect.args ?? []));
            if (line) this.say(capital(line), effect.tone === 'w' ? COLORS.warning : effect.tone === 'n' ? COLORS.negative : effect.tone === 'p' ? COLORS.positive : COLORS.default, now);
          }
          break;
        case 'metamorphed':
          // ScrollOfMetamorphosis.onMetamorph: READ, a swirl of change over the hero.
          if (effect.hero === myId) {
            audio.play('read');
            this.say(`${capital(talentTitle(effect.from))} → ${capital(talentTitle(effect.to))}`, COLORS.highlight, now);
          }
          break;
        case 'assassinated':
          // Preparation: «assassinated» over the foe.
          if (effect.depth === this.depth) this.float(effect.mob, tal('actors.buffs.preparation.assassinated'), COLORS.negative, now, true);
          break;
        case 'brewed':
          if (effect.depth !== this.depth) break;
          audio.play('puff');
          this.flashes.push({ cell: effect.pos, start: now, color: '255, 255, 255', duration: 700 });
          this.say(t.brewed, COLORS.highlight, now);
          break;
        case 'mimic':
          if (effect.depth !== this.depth) break;
          this.say(t.isMimic, COLORS.negative, now);
          audio.play('mimic');
          if (effect.hero === myId) haptic('hurt');
          break;
        case 'charmed':
          // Succubus.attackProc: CHARMS.
          if (effect.hero === myId) this.say(t.charmed, COLORS.negative, now);
          audio.play('charms', 1, 1, this.placeOf(effect.hero, now));
          break;
        case 'crippled':
          if (effect.hero === myId) this.say(t.crippled, COLORS.negative, now);
          break;
        case 'lit':
          audio.play('burning', 1.4, 0.5);
          if (effect.hero === myId) this.say(t.lit, COLORS.default, now);
          break;
        case 'repaired':
          if (effect.depth !== this.depth) break;
          this.float(effect.mob, '+', COLORS.positive, now);
          this.say(t.repaired, COLORS.negative, now);
          break;
        case 'trap':
          trapped = true;
          if (effect.mob) {
            // Level.mobPress: a monster sets off a trap; heard and seen only where the party can see it
            // (but an alarm rings throughout the dungeon).
            const here = effect.depth === this.depth && seen(effect.pos);
            if (!here) {
              if (effect.kind === 'alarm' && effect.depth === this.depth) audio.play('alert');
              break;
            }
            this.flashes.push({ cell: effect.pos, start: now });
            // Trap.trigger: TRAP where it is seen, then the trap's own.
            const at = cellMiddle(effect.pos);
            audio.play('trap', 1, 1, at);
            const own = TRAP_SOUNDS[effect.kind];
            if (own) audio.play(own, 1, 1, at);
            const kind = this.puppets.get(effect.mob)?.kind as MobKind | undefined;
            if (kind) this.say(t.mobTrap(t.mobs[kind]), COLORS.warning, now);
            if (effect.kind === 'alarm') this.say(t.traps.alarm, COLORS.warning, now);
            break;
          }
          if (effect.depth === this.depth) this.flashes.push({ cell: effect.pos, start: now });
          audio.play('trap');
          if (TRAP_SOUNDS[effect.kind]) audio.play(TRAP_SOUNDS[effect.kind]!);
          if (effect.hero === myId) {
            this.say(t.plateClicks, COLORS.warning, now);
            this.say(t.traps[effect.kind], COLORS.negative, now);
            haptic('hurt');
          } else if (effect.depth === this.depth) {
            this.say(t.companionTrap(this.name(world, effect.hero)), COLORS.warning, now);
          }
          break;
        case 'ate':
          audio.play('eat', 1, 1, this.placeOf(effect.hero, now));
          this.busy(effect.hero, now);
          if (effect.hero === myId) {
            this.say(effect.kind === 'food.meat' ? t.ateMeat : effect.kind === 'food.overpriced' ? t.ateOk : t.ateFood, COLORS.default, now);
            // Mystery meat's surprises are bad ones; frozen carpaccio's are good.
            if (effect.outcome) this.say(t.meat[effect.outcome], effect.kind === 'food.meat' ? COLORS.warning : COLORS.positive, now);
          }
          break;
        case 'hunger':
          if (effect.hero === myId) {
            this.say(effect.state === 'hungry' ? t.hungry : t.starving, effect.state === 'hungry' ? COLORS.warning : COLORS.negative, now);
            if (effect.state === 'starving') haptic('error');
          }
          break;
        case 'dew':
          audio.play('dewdrop');
          if (effect.amount > 0) this.float(effect.hero, `+${effect.amount}`, COLORS.positive, now);
          break;
        case 'burnt':
        case 'heapBurnt':
          if (effect.depth === this.depth) this.flashes.push({ cell: effect.pos, start: now });
          break;
        case 'burntUp':
          if (effect.hero === myId) this.say(t.burntUp(itemName(world, { kind: effect.kind, qty: 1, level: 0 })), COLORS.warning, now);
          break;
        case 'exploded':
          if (effect.depth === this.depth) {
            audio.play('blast', 1, 1, cellMiddle(effect.pos));
            this.flashes.push({ cell: effect.pos, start: now, duration: 400 });
          }
          break;
        case 'dewCollected':
          audio.play('dewdrop');
          if (effect.hero === myId) this.say(effect.full ? t.vialFull : t.dewCollected, effect.full ? COLORS.positive : COLORS.default, now);
          break;
        case 'vial':
          audio.play('drink');
          if (effect.amount > 0) this.float(effect.hero, `+${effect.amount}`, COLORS.positive, now);
          break;
        case 'dewFull':
          if (effect.hero === myId) this.say(t.hero.dewFull, COLORS.default, now);
          break;
        case 'levelCap':
          // Hero.earnExp at the cap: LEVELUP.
          if (effect.hero === myId) {
            this.say(t.hero.levelCap, COLORS.positive, now);
            audio.play('levelup');
          }
          break;
        // Hero.noticed_smth is said once for what was found ('discovered', above).
        case 'shielded':
          // WarriorShield.activate: the shield's worth floats up over the warrior (FloatingText.SHIELDING).
          this.float(effect.hero, `+${effect.amount}`, COLORS.shield, now);
          if (effect.hero === myId) audio.play('levelup', 1.6, 0.4);
          break;
        case 'sealAffixed':
          if (effect.hero === myId) {
            this.say(t.hero.affixed, COLORS.positive, now);
            audio.play('unlock');
          }
          break;
        case 'sealDetached':
          if (effect.hero === myId) this.say(t.hero.detached, COLORS.default, now);
          break;
        case 'greeting':
          if (effect.depth === this.depth) this.say(`${t.mobs.impShopkeeper}: «${t.impGreeting}»`, COLORS.default, now);
          break;
        case 'marked':
          if (effect.depth === this.depth) {
            audio.play('burning');
            this.float(effect.who, t.marked, COLORS.warning, now);
          }
          break;
        case 'sacrifice':
          if (effect.depth === this.depth) {
            this.say(t.sacrifice[effect.outcome], effect.outcome === 'reward' ? COLORS.highlight : COLORS.warning, now);
            this.flashes.push({ cell: effect.pos, start: now, color: '102, 255, 255', duration: 900 });
          }
          break;
        case 'wipedOut':
          if (effect.depth === this.depth) {
            audio.play('cursed');
            this.say(t.wipedOut, COLORS.negative, now);
          }
          break;
        case 'bee':
          if (effect.depth === this.depth) {
            audio.play('shatter');
            audio.play('bee');
          }
          break;
        case 'wraiths':
          audio.play('cursed');
          if (effect.depth === this.depth) {
            this.flashes.push({ cell: effect.pos, start: now, duration: 500 });
            this.say(t.wraiths, COLORS.negative, now);
          }
          break;
        case 'cursed':
          audio.play('ghost');
          if (effect.depth === this.depth) this.say(t.cursed, COLORS.negative, now);
          break;
        case 'beacon':
          // LloydsBeacon: BEACON as it is set; the return is a teleport.
          audio.play(effect.mode === 'set' ? 'beacon' : 'teleport');
          if (effect.hero === myId && effect.mode === 'set') this.say(t.beaconDone, COLORS.default, now);
          break;
        /* Shattered's alchemy: the pot, its items and their effects (sounds as Assets.Sounds, texts as Shattered's). */
        case 'crafted':
          // AlchemyScene's own puff plays in its window; a trinket chosen from the catalyst puffs here (TrinketCatalyst).
          if (effect.hero === myId && effect.item) {
            if (itemDef(effect.item.kind).category === 'trinket' && effect.cost === 0) audio.play('puff');
            this.say(capitalize(fill(t.alch.youNowHave, itemName(world, effect.item))), COLORS.positive, now);
          }
          break;
        case 'dust':
          if (effect.hero === myId) this.say(t.gear.dust, COLORS.warning, now);
          break;
        case 'crystal':
          if (effect.hero !== myId) break;
          this.say(
            { flawed: t.gear.crystalFlawed, cracked: t.gear.crystalCracked, shattered: t.gear.crystalShattered, fixed: t.gear.crystalFixed }[effect.state],
            effect.state === 'fixed' ? COLORS.positive : effect.state === 'flawed' ? COLORS.warning : COLORS.negative, now);
          if (effect.state === 'shattered') audio.play('shatter');
          break;
        case 'explosive':
          if (effect.hero !== myId) break;
          this.float(effect.hero, effect.state === 'warm' ? t.gear.explosiveWarm : t.gear.explosiveHot, COLORS.warning, now);
          this.say(effect.state === 'warm' ? t.gear.explosiveDescWarm : t.gear.explosiveDescHot, effect.state === 'warm' ? COLORS.warning : COLORS.negative, now);
          break;
        case 'annoying':
          // Annoying.proc: one of its lines, and the level comes running.
          if (effect.hero === myId) this.say(t.gear.annoying[effect.line - 1] ?? '', COLORS.negative, now);
          audio.play('cursed');
          break;
        case 'shielded':
          this.float(effect.hero, `+${effect.amount}`, COLORS.highlight, now);
          break;
        case 'corrupted':
          if (effect.depth === this.depth) this.say(t.corrupted(t.mobs[mobKind(effect.depth, effect.mob, 'rat')]), COLORS.highlight, now);
          break;
        case 'tipped':
          if (effect.hero === myId) this.say(t.tipped(effect.qty, itemName(world, { kind: effect.kind, qty: effect.qty, level: 0 })), COLORS.default, now);
          break;
        case 'blinked':
          // ScrollOfTeleportation.appear: there at once, in a flash of light.
          if (effect.depth !== this.depth) break;
          this.puppets.delete(effect.who);
          this.flashes.push({ cell: effect.from, start: now, color: '255, 255, 255', duration: 400 });
          this.flashes.push({ cell: effect.to, start: now, color: '255, 255, 255', duration: 400 });
          audio.play('teleport');
          break;
        case 'energized':
          if (effect.hero === myId) {
            this.say(fill(t.alch.energized, itemName(world, effect.item), effect.energy), COLORS.highlight, now);
            this.float(effect.hero, `+${effect.energy}`, ENERGY_COLOR, now);
          }
          break;
        case 'catalyst':
          if (effect.hero === myId) this.say(t.alch.catalystRolled, COLORS.highlight, now);
          break;
        case 'enthralled':
          // ScrollOfSirensSong.Enthralled: hearts over the monster, and CHARMS.
          audio.play('charms', 1, 1, effect.depth === this.depth ? this.placeOf(effect.mob, now) : undefined);
          if (effect.hero === myId) this.say(fill(t.alch.enthralledLine, capitalize(this.name(world, effect.mob))), COLORS.positive, now);
          break;
        case 'summoned':
          if (effect.depth === this.depth) audio.play('burning', 1.2, 0.8, cellMiddle(effect.pos));
          break;
        case 'snuffed':
          if (effect.hero === myId) this.say(t.alch.snuffFuse, COLORS.default, now);
          break;
        case 'noise':
          // Noisemaker: its ALERT, heard from wherever it lies.
          if (effect.depth === this.depth) audio.play('alert', 1, 1, cellMiddle(effect.pos));
          break;
        case 'frozenPotion':
          if (effect.hero === myId) {
            audio.play('shatter');
            this.say(t.alch.frozenPotion, COLORS.warning, now);
          }
          break;
        case 'arenaGone':
          if (effect.hero === myId) this.say(t.alch.arenaGone, COLORS.default, now);
          break;
        case 'healing':
          if (effect.hero === myId) this.say(t.alch.heal, COLORS.positive, now);
          break;
        case 'splash':
          // Potion.shatter's sound for what the splash leaves: a gas hisses (GAS), fire roars (BURNING).
          if (effect.depth === this.depth) {
            const sound = SPLASH_SOUNDS[effect.kind];
            if (sound) audio.play(sound, 1, 1, cellMiddle(effect.pos));
          }
          break;
        case 'breath':
          if (effect.depth === this.depth) {
            audio.play('burning', 1, 1, cellMiddle(effect.from));
            for (const cell of effect.cells) this.flashes.push({ cell, start: now, color: '255, 120, 30', duration: 900 });
          }
          break;
        case 'geyser':
          if (effect.depth === this.depth) audio.play('water', 0.8, 1, cellMiddle(effect.pos));
          break;
        case 'unstable':
          break;
        case 'masteryPotion':
          if (effect.hero === myId) {
            audio.play('mastery');
            this.say(itemDef(effect.item.kind).category === 'armor' ? t.alch.armorEasier : t.alch.weaponEasier, COLORS.positive, now);
          }
          break;
        case 'inspired':
          audio.play('levelup');
          if (effect.hero === myId) this.say(fill(t.alch.inspiredLine, effect.tier), COLORS.positive, now);
          break;
        case 'metamorphosis':
          if (effect.hero === myId) this.say(t.alch.metamorphNoTalents, COLORS.default, now);
          break;
        case 'divined':
          if (effect.hero === myId) {
            this.say(effect.kinds.length > 0 ? `${t.alch.divinationText} ${effect.kinds.map((kind) => t.items[kind]).join(', ')}` : t.alch.divinationNone, COLORS.highlight, now);
          }
          break;
        case 'curseInfused':
          audio.play('cursed');
          break;
        case 'reclaimed':
          audio.play('lightning', 1.3, 0.6);
          break;
        case 'augmented':
          if (effect.hero === myId) {
            audio.play('read');
            const augment = effect.item.augment;
            const line = augment === 'speed' ? t.alch.augmentedSpeed : augment === 'damage' ? t.alch.augmentedDamage
              : augment === 'evasion' ? t.alch.augmentedEvasion : augment === 'defense' ? t.alch.augmentedDefense : null;
            if (line) this.say(line, COLORS.positive, now);
          }
          break;
        case 'detected':
          if (effect.hero === myId) {
            audio.play('read');
            const line = { none: t.alch.detectedNone, good: t.alch.detectedGood, bad: t.alch.detectedBad, both: t.alch.detectedBoth }[effect.result];
            this.say(line, effect.result === 'bad' ? COLORS.warning : effect.result === 'none' ? COLORS.default : COLORS.positive, now);
          }
          break;
        case 'guessed':
          if (effect.hero === myId) {
            audio.play('read');
            this.say(effect.right ? t.alch.guessRight : t.alch.guessWrong, effect.right ? COLORS.positive : COLORS.warning, now);
          }
          break;
        case 'stone': {
          // Each runestone's own sound where it lands (StoneOfX.activate).
          if (effect.depth !== this.depth) break;
          const sounds = STONE_SOUNDS[effect.kind] ?? ['read'];
          for (const sound of sounds) audio.play(sound, 1, 1, cellMiddle(effect.pos));
          break;
        }
        case 'shock':
          if (effect.depth === this.depth) {
            audio.play('lightning', 1, 1, cellMiddle(effect.pos));
            this.flashes.push({ cell: effect.pos, start: now, color: '255, 255, 255', duration: 300 });
          }
          break;
        case 'censer': {
          // ChaoticCenser: a warning first in Shattered; here its puff of gas, and GAS.
          if (effect.depth === this.depth) audio.play('gas', 1, 1, cellMiddle(effect.to));
          const gas = (t.alch as Record<string, string>)[`gas_${effect.gas}`];
          if (effect.hero === myId && gas) this.say(fill(t.alch.spew, gas), COLORS.warning, now);
          break;
        }
        case 'artifact': {
          // GLog's lines of the artifacts' rules, by Shattered's message keys; %s names the item, if there is one.
          if (effect.hero !== myId) break;
          const args = effect.item ? [itemName(world, effect.item), ...(effect.args ?? [])] : effect.args;
          const text = artText(effect.msg, args);
          const tone = { p: COLORS.positive, w: COLORS.warning, n: COLORS.negative, i: COLORS.default }[effect.tone];
          if (text) this.say(capital(text), tone, now);
          if (effect.msg.endsWith('levelup') || effect.msg.endsWith('level_up') || effect.msg.endsWith('maxlevel')) audio.play('levelup', 1.3, 0.5);
          if (effect.msg === 'chaliceofblood.onprick') audio.play('cursed');
          if (effect.msg.startsWith('timekeepershourglass$sandbag') || effect.msg.startsWith('driedrose$petal')) audio.play('dewdrop');
          if (effect.msg === 'hornofplenty.eat') audio.play('eat');
          break;
        }
        case 'stealth':
          // CloakOfShadows: Sounds.MELD as the cloak wraps the hero; the sprite fades (State.INVISIBLE, see sync).
          if (effect.on) audio.play('meld', 1, 1, this.placeOf(effect.hero, now));
          this.busy(effect.hero, now);
          break;
        case 'stasis':
        case 'timeFreeze':
          // TimekeepersHourglass: GameScene.flash(0x80FFFFFF) and Sounds.TELEPORT as it starts.
          if (effect.on) audio.play('teleport');
          break;
        case 'scried':
          // TalismanOfForesight.scry: Sounds.SCAN, and SECRET if something hidden was found; checkedCell on every cell swept.
          if (effect.depth !== this.depth) break;
          audio.play('scan');
          if (effect.noticed) audio.play('secret');
          for (const cell of effect.cells) this.flashes.push({ cell, start: now, color: '170, 120, 255', duration: 700 });
          this.busy(effect.hero, now);
          break;
        case 'chained':
          // EtherealChains: Sounds.CHAINS, and the ethereal chain thrown out (Chains: 200 ms, and 50 a cell).
          if (effect.depth !== this.depth) break;
          audio.play('chains', 1, 1, cellMiddle(effect.from));
          this.chains.push({
            from: effect.from, to: effect.to, start: now,
            duration: 200 + (Math.hypot(cellX(effect.to) - cellX(effect.from), cellY(effect.to) - cellY(effect.from)) * TILE * 1000) / 320,
          });
          break;
        case 'ghostSummoned':
          // DriedRose: the ghost appears in a shaft of light (ShaftParticle, Speck.LIGHT) with Sounds.GHOST.
          if (effect.depth !== this.depth) break;
          audio.play('ghost');
          this.flashes.push({ cell: effect.pos, start: now, color: '255, 255, 220', duration: 900 });
          break;
        case 'ghostSays': {
          // GhostHero.yell: the ghost's line, under its name.
          if (effect.depth !== this.depth) break;
          const line = artText(`driedrose$ghosthero.${effect.line}`, effect.args);
          if (line) this.say(`${capital(t.mobs.ghostHero)}: «${line}»`, COLORS.highlight, now);
          if (effect.line.startsWith('defeated') || effect.line.startsWith('player_killed') || effect.line === 'introduce') audio.play('ghost');
          break;
        }
        case 'spellbookRead':
          // The unstable spellbook reads a scroll for the hero: Scroll.readAnimation.
          if (effect.hero === myId) this.say(capital(t.items[effect.kind] ?? ''), COLORS.highlight, now);
          break;
        case 'surprised':
          // Surprise.hit: the armband's theft caught the monster unawares.
          if (effect.depth === this.depth) {
            this.float(effect.mob, '!', COLORS.highlight, now);
            audio.play('hit_strong');
          }
          break;
        case 'interrupted': {
          // The artifacts' refusals are Shattered's lines (art: keys); 'art:cannot' says nothing.
          if (effect.reason.startsWith('art:') && effect.hero === myId) {
            const line = artText(effect.reason.slice(4));
            if (line) this.say(capital(line), COLORS.warning, now);
            break;
          }
          // Only the reasons worth telling: a refused move into a wall says nothing.
          const why = t.reasons[effect.reason];
          if (effect.hero === myId && why) this.say(why, COLORS.warning, now);
          break;
        }
        case 'cursedEquip':
          // EquipableItem.equipCursed: CURSED.
          if (effect.hero === myId) {
            this.say(t.cursedEquip(itemName(world, effect.item)), COLORS.negative, now);
            audio.play('cursed');
          }
          break;
        case 'victory':
          break;
      }
    }
    if (searchedByMe && !discovered) this.say(t.nothingFound, COLORS.neutral, now);
    if (me && !isAlive(me) && effects.some((e) => e.type === 'died' && e.who === myId)) haptic('error');
  }
}
