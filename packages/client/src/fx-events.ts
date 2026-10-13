import { type Effect, HEIGHT, type ItemKind, labelOf, type Level, type MobKind, POTION_COLORS, T, visibleCells, WIDTH, type World } from '@pd/core';
import { type BurstOptions, fx, type Piece } from './fx';
import { type Puppet, STEP_MS, TILE, type View } from './view';
import { audio } from './audio';
import { wandFx } from './wandfx';
import { duration, levelRegion } from './sprites';
import { magicColor } from './itemtext';

/*
 * What the dungeon's events look like beyond the sprites: blood and sparks on
 * a blow, a spray in the direction it came from, bursts on a kill, fire,
 * frost and smoke, light on healing and on a level gained, and the camera
 * kicked by heavy blows, explosions and fallen bosses.
 */

const BLOOD = ['#b01818', '#d83030', '#7a0e0e'];
const ICHOR = ['#5fcf2f', '#2f8f1f', '#a6e86a'];
const BONE = ['#ece6cc', '#c4bea6', '#8f8a78'];
const SPARK = ['#ffe9a0', '#ffffff', '#ffb040'];
const ECTO = ['#c6f6ff', '#86d6ff', '#ffffff'];
const FIRE = ['#ffcf60', '#ff7a20', '#ffefa0', '#ff4010'];
const VOID = ['#b050d0', '#6a2a9a', '#e8a0ff'];
const GOLD = ['#ffe070', '#fff6c0', '#e0a020'];
const HEAL = ['#80ff80', '#c8ffc8', '#40e040'];
const FROST = ['#d6f4ff', '#9fdcff', '#ffffff'];
const SMOKE = ['#6a6a6a', '#8a8a8a', '#4a4a4a'];
const DUST = ['#b8ad8f', '#8f866c', '#d6ccae'];

/** What spills from a creature struck or slain, and whether it glows. */
function material(kind: string): { colors: readonly string[]; glow: boolean } {
  switch (kind as MobKind) {
    case 'goo': case 'acidic': case 'spinner': case 'rottingFist': case 'larva': case 'swarm':
      return { colors: ICHOR, glow: false };
    case 'skeleton': case 'undead':
      return { colors: BONE, glow: false };
    case 'golem': case 'dm300': case 'statue':
      return { colors: SPARK, glow: true };
    case 'wraith': case 'curse': case 'ghost': case 'mirror': case 'hawk':
      return { colors: ECTO, glow: true };
    case 'shadow':
      return { colors: ['#201830', '#40305a', '#0a0610'], glow: false };
    case 'ninjaLog':
      return { colors: ['#966400', '#c89040', '#5a3c00'], glow: false };
    case 'elemental': case 'burningFist':
      return { colors: FIRE, glow: true };
    case 'eye': case 'yog':
      return { colors: VOID, glow: true };
    case 'bee':
      return { colors: GOLD, glow: true };
    default:
      return { colors: BLOOD, glow: false };
  }
}

/**
 * What a creature comes apart into: chunks of meat, bone chips, blobs of slime,
 * stone and metal bits, embers that burn out, or (for ghosts) only wisps; what
 * a chunk smears where it bounces, the pool spreading under the body, and
 * whether a body is left at all.
 */
interface Gore {
  pieces: readonly Piece[];
  smear: string | null;
  pool: { color: string; edge: string } | null;
  corpse: boolean;
  /** Chunks that glow and burn out, leaving nothing. */
  embers?: boolean;
  /** Nothing solid: it leaves as a wisp. */
  wisp?: boolean;
}

const MEAT: Gore = {
  pieces: [['#c42020', '#5a0808'], ['#8a1010', '#420404'], ['#e07070', '#a03030'], ['#d83030', '#6a0a0a']],
  smear: '#7a0e0e', pool: { color: '#7a0e0e', edge: '#4e0606' }, corpse: true,
};
const BONE_CHIPS: Gore = {
  pieces: [['#ece6cc', '#8f8a78'], ['#d6cfb4', '#7a7462'], ['#c4bea6', '#6a6555']], smear: null, pool: null, corpse: true,
};
const SLIME: Gore = {
  pieces: [['#5fcf2f', '#2a6a14'], ['#a6e86a', '#4f8f2f'], ['#2f8f1f', '#164a0c']],
  smear: '#2f8f1f', pool: { color: '#2f7f1f', edge: '#1a4a10' }, corpse: true,
};
const RUBBLE: Gore = {
  pieces: [['#9a958a', '#4a4740'], ['#c0b8a4', '#5e584c'], ['#6e6a62', '#38352f'], ['#c8ccd4', '#5a5e66']], smear: null, pool: null, corpse: true,
};
const EMBERS: Gore = {
  pieces: [['#ffcf60', '#ff7a20'], ['#ffefa0', '#ffb040'], ['#ff7a20', '#c03008']], smear: null, pool: null, corpse: false, embers: true,
};
const WOOD: Gore = {
  pieces: [['#966400', '#5a3c00'], ['#c89040', '#6a4a10'], ['#7a5010', '#3a2808']], smear: null, pool: null, corpse: false,
};
const ECTOPLASM: Gore = { pieces: [], smear: null, pool: null, corpse: false, wisp: true };
const VOID_FLESH: Gore = {
  pieces: [['#b050d0', '#4a1a6a'], ['#6a2a9a', '#30104a'], ['#e8a0ff', '#8a50b0']],
  smear: '#4a1a6a', pool: { color: '#4a1a6a', edge: '#2a0a3a' }, corpse: true,
};
const CHITIN: Gore = {
  pieces: [['#ffd020', '#8a6a08'], ['#4a3a18', '#1a1206'], ['#fff0a0', '#b09030']], smear: null, pool: null, corpse: true,
};

function goreOf(kind: string): Gore {
  switch (kind as MobKind) {
    case 'goo': case 'acidic': case 'spinner': case 'rottingFist': case 'larva': case 'swarm':
      return SLIME;
    case 'skeleton': case 'undead':
      return BONE_CHIPS;
    case 'golem': case 'dm300': case 'statue':
      return RUBBLE;
    case 'wraith': case 'curse': case 'ghost': case 'mirror': case 'hawk': case 'shadow':
      return ECTOPLASM;
    case 'ninjaLog':
      return WOOD;
    case 'elemental': case 'burningFist':
      return EMBERS;
    case 'eye': case 'yog':
      return VOID_FLESH;
    case 'bee':
      return CHITIN;
    default:
      return MEAT;
  }
}

const BOSSES = new Set(['goo', 'tengu', 'dm300', 'king', 'yog']);

/** The way the last blow on each creature went, so its death can throw it apart that way. */
const blows = new Map<string, { angle: number; at: number }>();
/** A blow this recent still counts as the one that killed. */
const BLOW_MS = 1500;

/** Where a character stands on the floor (its feet), and how high its middle is over them. */
function feetOf(view: View, puppet: Puppet, now: number): { x: number; y: number; z: number } {
  const { x, y } = view.position(puppet, now);
  return { x: x + TILE / 2, y: y + TILE - 3, z: Math.min(puppet.sprite.sheet.h, TILE) / 2 - 1 };
}

/** Chunks thrown off a body: a handful on a kill (more for a boss), one or two off a heavy blow. */
function throwGibs(feet: { x: number; y: number; z: number }, gore: Gore, count: number, angle: number | undefined, force: number, now: number): void {
  if (gore.wisp || gore.pieces.length === 0) return;
  fx.gib(feet.x, feet.y, feet.z, now, {
    count, pieces: gore.pieces, smear: gore.smear, angle, glow: gore.embers, life: [500, 950],
    speed: [26 * force, 72 * force], up: [70, 70 + 60 * force], size: [2.4, 4.2],
  });
}

/** The body of a slain monster stays where it fell once its death has played (not the ghostly or fiery). */
function layBody(view: View, puppet: Puppet, gore: Gore, boss: boolean, now: number): void {
  const { sheet, anims } = puppet.sprite;
  if (!gore.corpse || puppet.isHero || !sheet.image.complete) return;
  const die = anims.die;
  const frame = die.frames[die.frames.length - 1] ?? 0;
  const end = now + duration(die);
  // The sprite stays whole to the end of its death; then the body takes its place.
  puppet.laid = true;
  puppet.removeAt = end;
  const at = view.position(puppet, end);
  fx.corpse({
    image: sheet.image, sx: (frame % sheet.cols) * sheet.w, sy: (Math.floor(frame / sheet.cols) + puppet.row) * sheet.h, w: sheet.w, h: sheet.h,
    flip: puppet.flip, x: at.x + (TILE - sheet.w) / 2, y: at.y + TILE - sheet.h, at: end,
    // A boss lies there for the rest of the visit; anything else for a minute.
    life: boss ? 3_600_000 : 60_000,
    pool: gore.pool ? { start: now + duration(die) * 0.4, radius: Math.max(4, Math.min(10, Math.round(sheet.w * 0.35))) + (boss ? 3 : 0), ...gore.pool } : undefined,
  });
}

/** HeroicLeap's jump takes a tenth of a second a cell: when it lands. */
const duration100 = (effect: { from: number; to: number }): number =>
  Math.max(1, Math.hypot((effect.to % WIDTH) - (effect.from % WIDTH), Math.trunc(effect.to / WIDTH) - Math.trunc(effect.from / WIDTH))) * 100;

const cellCentre = (cell: number): { x: number; y: number } => ({ x: (cell % WIDTH) * TILE + TILE / 2, y: Math.trunc(cell / WIDTH) * TILE + TILE / 2 });

function centreOf(view: View, id: string, now: number): { x: number; y: number } | null {
  const puppet = view.puppets.get(id);
  if (!puppet) return null;
  const { x, y } = view.position(puppet, now);
  return { x: x + TILE / 2, y: y + TILE - Math.min(puppet.sprite.sheet.h, TILE) / 2 - 1 };
}

const burst = (at: { x: number; y: number } | null, now: number, o: BurstOptions): void => {
  if (at) fx.burst(at.x, at.y, now, o);
};

/** Bolt colours (as in view.ts) for the light a spell leaves where it strikes. */
const BOLT_GLOW: Readonly<Record<string, readonly string[]>> = {
  fire: FIRE, lightning: ['#ffffff', '#fffcc0', '#c0e8ff'], poison: ICHOR, magic: ['#ffffff', '#d0e8ff'], beam: VOID, shadow: VOID,
  // Shattered's wands (MagicMissile's particles).
  frost: ['#88ccff', '#ffffff', '#b8e0ff'], corrosion: ['#aaaaaa', '#ff8800'], force: DUST, earth: ['#805500', '#332500', '#fff568'],
  ward: ['#8822ff', '#c080ff'], corruption: VOID, rainbow: ['#ff4040', '#ffd040', '#40ff60', '#40c0ff', '#c060ff'], foliage: HEAL,
  death: VOID, light: ['#ffffff', '#fff8c0'], blood: ['#cc0000', '#ff4040'],
  // WildEnergy's chaotic bolt, TelekineticGrab's (MagicMissile.WARD and BEACON).
  wild: ['#d080ff', '#ffffff', '#80ffff'], grab: ['#ffffff', '#e0e0ff'],
};

/** The look of one effect; called after the view has taken it in. */
export function effectFx(effect: Effect, view: View, world: World, myId: string, now: number): void {
  const here = (depth: number): boolean => depth === view.depth;
  switch (effect.type) {
    case 'attack': {
      if (!here(effect.depth)) return;
      const from = centreOf(view, effect.attacker, now);
      const to = centreOf(view, effect.target, now);
      const attacker = view.puppets.get(effect.attacker);
      const target = view.puppets.get(effect.target);
      // The attacker lunges into the blow.
      if (attacker && from && to) {
        const len = Math.hypot(to.x - from.x, to.y - from.y) || 1;
        if (len < TILE * 1.6) {
          attacker.lungeStart = now;
          attacker.lungeX = ((to.x - from.x) / len) * 4;
          attacker.lungeY = ((to.y - from.y) / len) * 4;
        }
      }
      if (!effect.hit || !to || !target) {
        if (to) burst(to, now, { count: 3, colors: ['#ffffff', '#d0d0d0'], speed: [20, 40], life: [120, 220], size: [1, 1] });
        return;
      }
      const share = Math.min(1, effect.damage / Math.max(1, target.ht));
      const angle = from ? Math.atan2(to.y - from.y, to.x - from.x) : undefined;
      const { colors, glow } = material(target.kind);
      // The view has already marked the slain dead; its health is still from before the blow.
      const killing = !target.alive || target.hp - effect.damage <= 0;
      const heavy = share >= 0.25 || killing;
      const gore = goreOf(target.kind);
      if (angle !== undefined) {
        if (blows.size > 200) blows.clear();
        blows.set(effect.target, { angle, at: now });
        // The struck reels back along the blow, a few whole pixels, and springs back.
        const reach = heavy ? 3 : 2;
        target.knockStart = now;
        target.knockX = Math.round(Math.cos(angle) * reach);
        target.knockY = Math.round(Math.sin(angle) * reach);
        // A heavy blow cuts a white streak across them.
        if (heavy) fx.slash(to.x, to.y, angle, now);
      }
      // The «Sparks» effect: a hero's blows strike gold as well.
      if (attacker?.look?.effect === 'sparks') {
        burst(to, now, { count: 8 + Math.round(share * 12), colors: SPARKS, glow: true, speed: [40, 110], life: [180, 420], gravity: 140, drag: 0.1, size: [1, 2], angle, cone: 1.4 });
      }
      burst(to, now, {
        count: 6 + Math.round(share * 30) + Math.min(10, effect.damage) + (heavy ? 8 : 0), colors, glow,
        speed: [35, 100 + share * 90 + (heavy ? 30 : 0)], life: [280, 680], gravity: 260, drag: 0.12, size: [1, 3], angle, cone: 1.7, spread: 2,
      });
      // What spilt stays on the floor.
      if (!glow) fx.splat(to.x, to.y, now, colors, 2 + Math.round(share * 8));
      // A very heavy blow that does not kill still tears a chunk or two off.
      if (!killing && share >= 0.3) throwGibs(feetOf(view, target, now), gore, share >= 0.5 ? 2 : 1, angle, 0.8, now);
      const mine = effect.attacker === myId || effect.target === myId;
      if (effect.target === myId) {
        // The hero's own wounds: the screen's edges flush red, and the view jolts.
        fx.flash('200, 0, 0', 0.28 + share * 0.7, 380 + share * 300, now, true);
        fx.shake(1 + share * 7, 160 + share * 200, now);
        if (share >= 0.2) fx.hitStop(70);
      } else if (mine && heavy) {
        audio.play('hit', 0.55, 0.8);
        fx.shake(1.5 + share * 3, 160, now);
        fx.hitStop(55 + share * 50);
        // A heavy blow's number lands big, my killing blow's bigger still.
        const kill = killing && effect.attacker === myId;
        for (const floater of view.floaters) if (floater.start === now && floater.text === String(effect.damage)) floater.scale = kill ? 2 : 1.5;
        if (kill) {
          // And the floor round the slain is kicked up in a ring.
          const feet = feetOf(view, target, now);
          fx.ring(feet.x, feet.y, now, gore.pieces.length > 0 && !gore.embers ? [...DUST, gore.pieces[0]![0]] : DUST, 14);
          if (gore.smear) {
            for (let i = 0; i < 6; i++) {
              const a = (i / 6) * Math.PI * 2 + Math.random() * 0.5;
              fx.splat(feet.x + Math.cos(a) * 7, feet.y - 4 + Math.sin(a) * 3.5, now, [gore.smear], 1, 1);
            }
          }
        }
      }
      return;
    }
    case 'hurt': {
      if (!here(effect.depth)) return;
      const at = centreOf(view, effect.who, now);
      const puppet = view.puppets.get(effect.who);
      if (puppet) burst(at, now, { count: 3 + Math.min(10, effect.damage), ...material(puppet.kind), speed: [20, 60], life: [200, 450], gravity: 200 });
      if (effect.who === myId) fx.flash('200, 0, 0', Math.min(0.6, 0.15 + effect.damage / Math.max(1, puppet?.ht ?? 20)), 300, now, true);
      return;
    }
    case 'died': {
      if (!here(effect.depth)) return;
      const puppet = view.puppets.get(effect.who);
      const at = centreOf(view, effect.who, now) ?? cellCentre(effect.pos);
      const kind = puppet?.kind ?? effect.kind ?? '';
      const boss = BOSSES.has(kind);
      const gore = goreOf(kind);
      // A spray of droplets (kept small: the chunks below are what reads as pieces of it).
      burst(at, now, { count: boss ? 90 : 24, ...material(kind), speed: [30, boss ? 160 : 120], life: [400, boss ? 1400 : 850], gravity: 180, drag: 0.15, size: [1, boss ? 3 : 2] });
      if (!material(kind).glow) fx.splat(at.x, at.y, now, material(kind).colors, boss ? 40 : 10, boss ? 14 : 7);
      // It comes apart: chunks fly the way the killing blow went (whoever struck it, so the whole party sees them).
      const blow = blows.get(effect.who);
      blows.delete(effect.who);
      const angle = blow && now - blow.at < BLOW_MS ? blow.angle : undefined;
      const feet = puppet ? feetOf(view, puppet, now) : { x: at.x, y: at.y + 5, z: 5 };
      throwGibs(feet, gore, boss ? 16 : 4 + Math.floor(Math.random() * 4), angle, boss ? 1.3 : 1, now);
      if (puppet) layBody(view, puppet, gore, boss, now);
      // What was alive leaves as a faint wisp (a ghost as nothing else).
      burst(at, now, {
        count: (boss ? 30 : 6) * (gore.wisp ? 3 : 1), colors: gore.wisp ? [...ECTO, '#ffffff'] : ['#ffffff', '#d8e8ff'], glow: true,
        speed: [4, gore.wisp ? 24 : 14], life: [600, gore.wisp ? 1500 : 1100], rise: 18, drag: 0.3, size: [1, gore.wisp ? 3 : 1], spread: gore.wisp ? 5 : 2,
      });
      if (boss) {
        fx.shake(7, 900, now);
        fx.flash('255, 255, 255', 0.55, 500, now);
        fx.hitStop(260);
      } else if (effect.by === myId) {
        fx.shake(2, 140, now);
      }
      if (effect.who === myId) {
        fx.flash('120, 0, 0', 0.6, 1400, now, true);
        fx.shake(5, 500, now);
        fx.hitStop(300);
      }
      return;
    }
    case 'bossSlain':
      fx.shake(6, 1200, now);
      return;
    case 'amulet':
    case 'victory': {
      // The Amulet of Yendor taken, and the run won: a shower of gold over everything in sight.
      const at = centreOf(view, effect.hero, now);
      if (!at) return;
      for (let i = 0; i < 6; i++) {
        fx.burst(at.x + (Math.random() - 0.5) * 120, at.y - 60 - Math.random() * 40, now + i * 120, { count: 30, colors: GOLD, glow: true, speed: [10, 50], life: [1200, 2200], gravity: 40, drag: 0.5, size: [1, 2], spread: 30 });
      }
      fx.flash('255, 240, 160', 0.6, 1200, now);
      fx.shake(3, 600, now);
      return;
    }
    case 'yell':
      // A boss that notices the heroes: the ground trembles.
      if (here(effect.depth) && effect.line === 'notice' && BOSSES.has(effect.kind)) {
        view.bossIntro = { kind: effect.kind, start: now };
        audio.duck(0.3, 2600);
        fx.shake(4, 700, now);
        fx.flash('120, 0, 0', 0.35, 700, now, true);
      }
      return;
    case 'levelUp': {
      const at = centreOf(view, effect.hero, now);
      burst(at, now, { count: 46, colors: GOLD, glow: true, speed: [20, 70], life: [700, 1400], rise: 40, drag: 0.4, size: [1, 2], spread: 4 });
      if (effect.hero === myId) {
        fx.flash('255, 230, 120', 0.25, 500, now);
        view.levelCard = { lvl: effect.lvl, start: now };
      }
      return;
    }
    case 'healed': case 'dew': case 'vial': {
      const at = centreOf(view, effect.hero, now);
      if (effect.amount > 0) burst(at, now, { count: 6 + Math.min(20, effect.amount), colors: HEAL, glow: true, speed: [5, 20], life: [500, 1000], rise: 26, drag: 0.4, size: [1, 1], spread: 5 });
      return;
    }
    case 'pickedUp':
      if (effect.item.kind === 'gold') burst(centreOf(view, effect.hero, now), now, { count: 10, colors: GOLD, glow: true, speed: [15, 45], life: [300, 650], rise: 20, size: [1, 1] });
      return;
    case 'teleported': case 'mirrored':
      burst(centreOf(view, effect.hero, now), now, { count: 26, colors: ECTO, glow: true, speed: [10, 50], life: [400, 900], rise: 10, spread: 5 });
      return;
    case 'burst': {
      if (!here(effect.depth)) return;
      const o: Record<string, BurstOptions> = {
        fire: { count: 14, colors: FIRE, glow: true, speed: [10, 45], life: [400, 900], rise: 35, drag: 0.35, spread: 6, size: [1, 2] },
        frost: { count: 12, colors: FROST, glow: true, speed: [10, 40], life: [500, 1000], drag: 0.3, spread: 7, size: [1, 1] },
        toxic: { count: 8, colors: ['#70c040', '#a0e060', '#4a8a2a'], speed: [4, 15], life: [700, 1400], drag: 0.5, spread: 7, size: [2, 3] },
        paralytic: { count: 8, colors: ['#e8e070', '#fff8a0', '#b0a040'], speed: [4, 15], life: [700, 1400], drag: 0.5, spread: 7, size: [2, 3] },
        purity: { count: 10, colors: ['#ffffff', '#e8f4ff'], glow: true, speed: [10, 30], life: [500, 900], rise: 10, spread: 7, size: [1, 1] },
      };
      const look = o[effect.kind];
      if (!look) return;
      const r = effect.radius;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const x = (effect.pos % WIDTH) + dx;
          const y = Math.trunc(effect.pos / WIDTH) + dy;
          if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT) continue;
          fx.burst(x * TILE + TILE / 2, y * TILE + TILE / 2, now, look);
        }
      }
      if (effect.kind === 'fire' && r >= 1) fx.shake(2, 220, now);
      if (effect.kind === 'frost') fx.flash('170, 220, 255', 0.15, 300, now);
      return;
    }
    case 'exploded': {
      if (!here(effect.depth)) return;
      const at = cellCentre(effect.pos);
      fx.burst(at.x, at.y, now, { count: 60, colors: FIRE, glow: true, speed: [50, 170], life: [250, 700], drag: 0.08, gravity: 120, size: [1, 3], spread: 4 });
      fx.burst(at.x, at.y, now, { count: 30, colors: SMOKE, speed: [10, 50], life: [900, 1700], rise: 22, drag: 0.4, size: [2, 4], spread: 10 });
      fx.burst(at.x, at.y, now, { count: 18, colors: DUST, speed: [60, 140], life: [300, 700], gravity: 320, size: [1, 2] });
      fx.splat(at.x, at.y - 4, now, ['#1c1612', '#2a2019', '#3a2c20'], 34, 13);
      fx.flash('255, 200, 120', 0.4, 220, now);
      fx.shake(7, 450, now);
      fx.hitStop(90);
      // An enhanced bomb's own blast over Bomb's (FrostBomb, Firebomb, WoollyBomb...).
      const extra = effect.bomb ? BOMB_FX[effect.bomb] : undefined;
      if (extra) fx.burst(at.x, at.y, now + 40, extra);
      if (effect.bomb === 'bomb.flashbang') fx.flash('255, 255, 255', 0.8, 500, now);
      if (effect.bomb === 'bomb.holy') fx.flash('255, 250, 200', 0.5, 600, now);
      if (effect.bomb === 'bomb.noisemaker') fx.ring(at.x, at.y, now, ['#ffffff', '#ffe080'], 24);
      return;
    }
    case 'stasis':
    case 'timeFreeze':
      // TimekeepersHourglass: GameScene.flash(0x80FFFFFF) as the sand runs.
      if (effect.hero === myId && effect.on) fx.flash('255, 255, 255', 0.5, 320, now);
      return;
    case 'ghostSummoned':
      // ShaftParticle and Speck.LIGHT: the ghost comes down in a shaft of pale light.
      if (!here(effect.depth)) return;
      burst(cellCentre(effect.pos), now, { count: 18, colors: ['#ffffff', '#fffde0', '#e8f0ff'], glow: true, speed: [6, 30], life: [400, 900], drag: 0.3, size: [1, 2], angle: -Math.PI / 2, cone: Math.PI / 3 });
      return;
    case 'stealth':
      // CloakOfShadows: a puff of shadow as the hero vanishes or shows again.
      burst(centreOf(view, effect.hero, now), now, { count: 10, colors: ['#202030', '#404050'], speed: [8, 30], life: [250, 500], drag: 0.2, size: [1, 2] });
      return;
    case 'zapped': {
      if (!here(effect.depth)) return;
      const at = cellCentre(effect.to);
      const colors = BOLT_GLOW[effect.bolt ?? 'magic'] ?? BOLT_GLOW.magic!;
      // A wand's missile bursts where it lands, when it gets there; beams and lightning strike at once.
      const bolt = effect.bolt ?? 'magic';
      const flies = WAND_MISSILES.has(bolt);
      wandFx.later(flies ? wandFx.flight(cellCentre(effect.from), at) : 0, now, (t) => {
        fx.burst(at.x, at.y, t, { count: 16, colors, glow: true, speed: [20, 80], life: [250, 600], drag: 0.2, size: [1, 2] });
      });
      if (effect.bolt === 'lightning') {
        fx.flash('230, 240, 255', 0.35, 160, now);
        fx.shake(3, 220, now);
      }
      if (effect.bolt === 'fire') fx.shake(1.5, 150, now);
      return;
    }
    case 'trap':
      if (!here(effect.depth)) return;
      if (effect.mob) {
        // Under a monster, where the party can see it: the same plate going off, without shaking the screen
        // (LightningTrap: sparks and arcs; the rest a puff of dust off the plate).
        if (!visibleCells(world, view.depth)[effect.pos]) return;
        const at = cellCentre(effect.pos);
        if (effect.kind === 'lightning') {
          fx.burst(at.x, at.y, now, { count: 18, colors: BOLT_GLOW.lightning!, glow: true, speed: [40, 120], life: [200, 450], drag: 0.2, size: [1, 2] });
          fx.flash('230, 240, 255', 0.25, 160, now);
        } else {
          fx.burst(at.x, at.y, now, { count: 10, colors: DUST, speed: [20, 60], life: [300, 600], gravity: 200 });
        }
        return;
      }
      if (effect.kind === 'lightning') {
        fx.flash('230, 240, 255', 0.5, 220, now);
        fx.shake(4, 300, now);
      } else {
        const at = cellCentre(effect.pos);
        fx.burst(at.x, at.y, now, { count: 10, colors: DUST, speed: [20, 60], life: [300, 600], gravity: 200 });
      }
      return;
    case 'bones': {
      if (!here(effect.depth)) return;
      const at = cellCentre(effect.pos);
      fx.burst(at.x, at.y, now, { count: 40, colors: BONE, speed: [40, 140], life: [400, 900], gravity: 300, drag: 0.12, size: [1, 2] });
      fx.shake(3, 260, now);
      return;
    }
    case 'avalanche':
      if (!here(effect.depth)) return;
      for (const cell of effect.cells) {
        const at = cellCentre(cell);
        fx.burst(at.x, at.y - 6, now, { count: 8, colors: DUST, speed: [20, 70], life: [300, 700], gravity: 380, size: [1, 3] });
      }
      fx.shake(6, 600, now);
      return;
    case 'ability': {
      if (!here(effect.depth)) return;
      const from = cellCentre(effect.from);
      const to = cellCentre(effect.to);
      switch (effect.ability) {
        case 'heroicLeap':
          // Where it lands: dust kicked up in a ring, the ground shaking (PixelScene.shake(2, 0.5)).
          fx.burst(to.x, to.y + 4, now + duration100(effect), { count: 30, colors: DUST, speed: [40, 110], life: [300, 650], gravity: 200, angle: -Math.PI / 2, cone: Math.PI, size: [1, 2] });
          fx.shake(2, 500, now + duration100(effect));
          return;
        case 'shockwave':
          fx.shake(2, 500, now);
          return;
        case 'endure':
          // Endure's end: Speck.SCREAM, a few rising shouts about the hero's head.
          if (effect.cells) burst(centreOf(view, effect.hero, now), now, { count: 3, colors: ['#ffffff', '#ffd0d0'], glow: true, speed: [6, 18], life: [400, 800], rise: 20, size: [1, 2], spread: 4 });
          return;
        case 'elementalBlast':
          burst(centreOf(view, effect.hero, now), now, { count: 12, colors: ['#ffffff', '#ffe9a0'], glow: true, speed: [20, 60], life: [200, 500], size: [1, 1] });
          return;
        case 'smokeBomb':
          // CellEmitter.get(hero.pos).burst(Speck.WOOL, 10): a puff of wool, and light on those blinded.
          fx.burst(from.x, from.y, now, { count: 10, colors: ['#f0f0f0', '#cfcfcf', '#aaaaaa'], speed: [10, 36], life: [500, 1000], rise: 6, drag: 0.5, size: [2, 4], spread: 5 });
          for (const cell of effect.cells ?? []) {
            const mob = cellCentre(cell);
            fx.burst(mob.x, mob.y, now, { count: 4, colors: ['#ffffff', '#fff6b0'], glow: true, speed: [10, 30], life: [250, 500], size: [1, 1] });
          }
          return;
        case 'shadowClone':
        case 'perfectCopy':
          // ShadowAlly.appear: SmokeParticle.FACTORY, ten puffs.
          fx.burst(to.x, to.y, now, { count: 10, colors: SMOKE, speed: [6, 24], life: [500, 1000], rise: 10, drag: 0.5, size: [2, 3], spread: 4 });
          if (effect.ability === 'perfectCopy') fx.burst(from.x, from.y, now, { count: 10, colors: SMOKE, speed: [6, 24], life: [500, 1000], rise: 10, drag: 0.5, size: [2, 3], spread: 4 });
          return;
        case 'naturesPower':
          // LeafParticle.GENERAL burst: ten leaves about the hero.
          burst(centreOf(view, effect.hero, now), now, { count: 10, colors: ['#2a7a22', '#88cc44', '#4cc24c'], speed: [14, 40], life: [500, 900], gravity: 30, size: [1, 2], spread: 4 });
          return;
        case 'warpBeacon':
          fx.burst(to.x, to.y, now, { count: 8, colors: ['#8822ff', '#c080ff', '#ffffff'], glow: true, speed: [8, 28], life: [300, 600], rise: 16, size: [1, 1], spread: 3 });
          return;
        case 'spiritHawk':
          fx.burst(to.x, to.y, now, { count: 8, colors: ['#78e0ff', '#ffffff'], glow: true, speed: [8, 28], life: [300, 600], rise: 10, size: [1, 1], spread: 3 });
          return;
        default:
          return;
      }
    }
    case 'telefrag': {
      if (!here(effect.depth)) return;
      const at = cellCentre(effect.pos);
      fx.burst(at.x, at.y, now, { count: 30, colors: BLOOD, speed: [40, 120], life: [300, 700], gravity: 260, size: [1, 3], spread: 3 });
      fx.shake(3, 300, now);
      return;
    }
    case 'deathMarked': {
      if (!here(effect.depth) || !effect.died) return;
      // DeathMarkTracker.detach: it flashes and bursts into blood (HT * 2 of it).
      const puppet = view.puppets.get(effect.mob);
      if (!puppet) return;
      const at = centreOf(view, effect.mob, now);
      burst(at, now, { count: 30, colors: BLOOD, speed: [40, 120], life: [300, 700], gravity: 260, size: [1, 3], spread: 3 });
      fx.shake(2, 220, now);
      return;
    }
    case 'enchanted': {
      if (!here(effect.depth)) return;
      const at = cellCentre(effect.pos);
      // Each enchantment's own: Blazing's flames, Chilling's splash, Shocking's sparks, Venomous's poison, Grim's shadow...
      const colors = effect.enchant === 'blazing' ? FIRE : effect.enchant === 'shocking' ? BOLT_GLOW.lightning! : effect.enchant === 'chilling' ? FROST
        : effect.enchant === 'grim' ? VOID : effect.enchant === 'eldritch' ? ['#ff0000', '#ff6060'] : effect.enchant === 'venomous' ? ['#8a50e0', '#4400aa']
        : effect.enchant === 'vorpal' || effect.enchant === 'vampiric' ? BLOOD : [magicColor(effect.enchant), '#ffffff'];
      fx.burst(at.x, at.y, now, { count: 12, colors, glow: true, speed: [20, 60], life: [250, 550], size: [1, 1] });
      if (effect.enchant === 'grim') fx.flash('40, 0, 40', 0.4, 300, now);
      return;
    }
    case 'glyph': {
      // Each glyph's own (Affection's hearts, Entanglement's earth and a shake, Potential's energy, the curses' shadows).
      const at = centreOf(view, effect.hero, now);
      const look: Partial<Record<string, readonly string[]>> = {
        affection: ['#ff6fa8', '#ffb0d0'], entanglement: DUST, potential: ['#ffffff', '#c8f0ff'], viscosity: ['#a77ae0', '#d0b0ff'],
        thorns: BLOOD, repulsion: ['#ffffff', '#e8e2c8'], antiEntropy: FIRE, corrosion: ['#303030', '#101010'], metabolism: HEAL,
        stench: ICHOR, overgrowth: ['#4cc24c', '#2f8f1f'], multiplicity: VOID, displacement: ECTO,
      };
      burst(at, now, { count: 12, colors: look[effect.glyph] ?? [magicColor(effect.glyph), '#ffffff'], glow: true, speed: [15, 50], life: [300, 700], rise: 8 });
      if (effect.glyph === 'entanglement') fx.shake(1, 400, now);
      if (effect.glyph === 'antiEntropy' && at) burst(at, now, { count: 24, colors: FROST, speed: [30, 80], life: [300, 600], spread: 10 });
      return;
    }
    case 'geyser': {
      // GeyserTrap.activate: a splash of water upwards, and the gas's hiss.
      if (!here(effect.depth)) return;
      const at = cellCentre(effect.pos);
      fx.burst(at.x, at.y, now, { count: 40, colors: ['#5bc1e3', '#9fe0f5', '#ffffff'], speed: [40, 110], life: [300, 700], gravity: 260, angle: -Math.PI / 2, cone: Math.PI / 2 });
      audio.play('gas', 0.75);
      return;
    }
    case 'bloomed':
      // Blooming.plantGrass: leaves burst from every tuft that springs up.
      if (!here(effect.depth)) return;
      for (const cell of effect.cells) {
        const at = cellCentre(cell);
        fx.burst(at.x, at.y, now, { count: 4, colors: ['#4cc24c', '#2f8f1f', '#a6e86a'], speed: [10, 40], life: [400, 800], gravity: 60 });
      }
      return;
    case 'dazzled':
      // Dazzling.proc: a white flash (GameScene.flash) and a blast.
      if (!here(effect.depth)) return;
      fx.flash('255, 255, 255', 0.5, 300, now);
      audio.play('blast');
      return;
    case 'wondrous': {
      // Wondrous.proc: a rainbow burst (RainbowParticle.BURST).
      if (!here(effect.depth)) return;
      const at = cellCentre(effect.pos);
      fx.burst(at.x, at.y, now, { count: 25, colors: ['#ff4040', '#ffb040', '#ffff40', '#40ff40', '#40c0ff', '#a040ff'], glow: true, speed: [20, 70], life: [400, 900] });
      return;
    }
    case 'corrupted': {
      // Corruption: it rises again darkened.
      if (!here(effect.depth)) return;
      const at = cellCentre(effect.pos);
      // (Its sound comes with the 'ally' effect beside this one.)
      fx.burst(at.x, at.y, now, { count: 20, colors: ['#440066', '#b878e8', '#200030'], glow: true, speed: [10, 40], life: [500, 1000], rise: 14 });
      return;
    }
    case 'lucky': {
      // RingOfWealth.showFlareForBonusDrop: a green flare where the prize falls.
      if (!here(effect.depth)) return;
      const at = cellCentre(effect.pos);
      fx.burst(at.x, at.y, now, { count: 18, colors: ['#66ff66', '#ffffff', '#c8ffc8'], glow: true, speed: [20, 60], life: [400, 800], rise: 10 });
      audio.play('gold', 1.2, 0.7);
      return;
    }
    case 'shielded': {
      // Blocking.proc: light specks on the wielder.
      burst(centreOf(view, effect.hero, now), now, { count: 5, colors: ['#ffffff', '#c8d8ff'], glow: true, speed: [10, 30], life: [300, 600] });
      return;
    }
    case 'blinked': {
      // ScrollOfTeleportation.appear: light where it was, light where it is.
      if (!here(effect.depth)) return;
      for (const cell of [effect.from, effect.to]) {
        const at = cellCentre(cell);
        fx.burst(at.x, at.y, now, { count: 10, colors: ECTO, glow: true, speed: [10, 40], life: [300, 600], rise: 10 });
      }
      return;
    }
    case 'explosive': {
      // Explosive.proc: smoke when it warms, sparks when it is hot.
      const at = centreOf(view, effect.hero, now);
      burst(at, now, effect.state === 'warm'
        ? { count: 4, colors: SMOKE, speed: [5, 20], life: [500, 900], rise: 12 }
        : { count: 5, colors: FIRE, glow: true, speed: [20, 50], life: [200, 400] });
      return;
    }
    case 'annoying': {
      // Annoying.proc: it screams (Speck.SCREAM).
      burst(centreOf(view, effect.hero, now), now, { count: 6, colors: ['#ffffff', '#ffe0e0'], speed: [30, 60], life: [400, 700], rise: 20 });
      return;
    }
    case 'pushed': {
      // WandOfBlastWave.throwChar: dust where it is flung from.
      if (!here(effect.depth)) return;
      const at = cellCentre(effect.from);
      fx.burst(at.x, at.y + 5, now, { count: 8, colors: DUST, speed: [10, 40], life: [250, 500], gravity: 120 });
      return;
    }
    case 'enraged':
      burst(centreOf(view, effect.mob, now), now, { count: 20, colors: ['#ff3030', '#ff8080'], glow: true, speed: [20, 60], life: [300, 700], rise: 10 });
      fx.shake(2, 200, now);
      return;
    case 'plantTriggered': {
      if (!here(effect.depth)) return;
      const at = cellCentre(effect.pos);
      const colors: Record<string, readonly string[]> = {
        firebloom: FIRE, icecap: FROST, sorrowmoss: ICHOR, dreamweed: ['#e0a0ff', '#ffffff'], sungrass: HEAL, earthroot: DUST,
        fadeleaf: ECTO, rotberry: ['#c03040', '#ff8090'],
      };
      fx.burst(at.x, at.y, now, { count: 20, colors: colors[effect.kind] ?? HEAL, glow: true, speed: [10, 50], life: [400, 900], rise: 15 });
      return;
    }
    case 'shattered': {
      if (!here(effect.depth)) return;
      const at = cellCentre(effect.pos);
      fx.burst(at.x, at.y, now, { count: 14, colors: ['#ffffff', '#cfe8ff', '#a0c8e8'], speed: [30, 90], life: [200, 450], gravity: 260, size: [1, 1] });
      return;
    }
    case 'mined': {
      if (!here(effect.depth)) return;
      const at = cellCentre(effect.pos);
      fx.burst(at.x, at.y, now, { count: 14, colors: [...GOLD, ...DUST], glow: true, speed: [30, 90], life: [250, 550], gravity: 300 });
      fx.shake(1.5, 120, now);
      return;
    }
    case 'wraiths': case 'cursed': {
      if (!here(effect.depth)) return;
      const at = cellCentre(effect.pos);
      fx.burst(at.x, at.y, now, { count: 30, colors: VOID, glow: true, speed: [10, 40], life: [600, 1200], rise: 18, drag: 0.4, spread: 8 });
      fx.flash('60, 0, 80', 0.3, 400, now);
      return;
    }
    case 'sacrifice': {
      if (!here(effect.depth)) return;
      const at = cellCentre(effect.pos);
      fx.burst(at.x, at.y, now, { count: effect.outcome === 'reward' ? 70 : 24, colors: ['#9fe0ff', '#ffffff', '#4488ee'], glow: true, speed: [10, 50], life: [700, 1500], rise: 30, drag: 0.4 });
      if (effect.outcome === 'reward') fx.flash('100, 255, 255', 0.35, 700, now);
      return;
    }
    case 'wipedOut':
      fx.flash('90, 40, 140', 0.6, 900, now);
      fx.shake(5, 700, now);
      return;
    case 'fell':
      if (effect.hero === myId) fx.shake(4, 350, now);
      return;
    case 'mobFell': {
      // A little dust off the edge after it.
      if (!here(effect.depth) || !visibleCells(world, view.depth)[effect.pos]) return;
      const at = cellCentre(effect.pos);
      fx.burst(at.x, at.y + 4, now, { count: 8, colors: DUST, speed: [10, 40], life: [300, 700], gravity: 260, size: [1, 2] });
      return;
    }
    case 'bee':
      if (!here(effect.depth)) return;
      fx.burst(cellCentre(effect.from).x, cellCentre(effect.from).y, now, { count: 12, colors: ['#ffd020', '#ffe080', '#fff8d0'], glow: true, speed: [20, 70], life: [250, 500], gravity: 200 });
      return;
    case 'burnt': case 'heapBurnt': {
      if (!here(effect.depth)) return;
      const at = cellCentre(effect.pos);
      fx.burst(at.x, at.y, now, { count: 8, colors: FIRE, glow: true, speed: [5, 25], life: [500, 1000], rise: 25, drag: 0.4, spread: 6 });
      return;
    }
    /* Shattered's alchemy (effects/*.java, as particles): splashes, breath, geysers, bombs, runestones, spells. */
    case 'splash': {
      // Splash.at: droplets of the potion's colour, thrown up and falling back, and a stain where they land.
      if (!here(effect.depth)) return;
      const at = cellCentre(effect.pos);
      const colors = splashColors(world, effect.kind);
      fx.burst(at.x, at.y, now, { count: 22, colors, speed: [30, 90], life: [300, 600], gravity: 300, drag: 0.2, size: [1, 2], angle: -Math.PI / 2, cone: Math.PI * 1.4 });
      fx.splat(at.x, at.y - 4, now, colors, 8, 7);
      return;
    }
    case 'breath': {
      // PotionOfDragonsBreath: a cone of flame (FlameParticle along the ConeAOE's cells), and a kick of heat.
      if (!here(effect.depth)) return;
      const from = cellCentre(effect.from);
      for (const cell of effect.cells) {
        const at = cellCentre(cell);
        const delay = Math.hypot(at.x - from.x, at.y - from.y) * 4;
        fx.burst(at.x, at.y, now + delay, { count: 6, colors: FIRE, glow: true, speed: [5, 30], life: [350, 700], rise: 30, drag: 0.4, spread: 6, size: [1, 2] });
      }
      fx.shake(2, 250, now);
      return;
    }
    case 'geyser': {
      // AquaBrew / the geyser trap: water shot up (Splash with the water's colour, Speck.STEAM).
      if (!here(effect.depth)) return;
      const at = cellCentre(effect.pos);
      fx.burst(at.x, at.y, now, { count: 40, colors: WATER, speed: [40, 130], life: [400, 900], gravity: 320, drag: 0.15, size: [1, 2], angle: -Math.PI / 2, cone: 1.1 });
      fx.burst(at.x, at.y, now, { count: 12, colors: ['#ffffff', '#d8f0ff'], speed: [5, 20], life: [600, 1100], rise: 18, drag: 0.5, size: [2, 3], spread: 6 });
      return;
    }
    case 'grown': {
      // Regrowth, a storm cloud's rain: leaves (LeafParticle) rising from the ground that changed.
      if (!here(effect.depth) || !visibleCells(world, view.depth)[effect.pos]) return;
      const at = cellCentre(effect.pos);
      fx.burst(at.x, at.y + 4, now, { count: 3, colors: LEAVES, speed: [4, 14], life: [500, 900], rise: 12, drag: 0.5, size: [1, 2], spread: 5 });
      return;
    }
    case 'stone': {
      if (!here(effect.depth)) return;
      const at = cellCentre(effect.pos);
      switch (effect.kind) {
        case 'stone.aggression':
          // StoneOfAggression: Speck.SCREAM red over the cell.
          fx.burst(at.x, at.y, now, { count: 14, colors: ['#ff3030', '#ff8080'], glow: true, speed: [20, 50], life: [300, 600], rise: 10 });
          break;
        case 'stone.fear':
          // StoneOfFear: Speck.SCREAM in red, scattering.
          fx.burst(at.x, at.y, now, { count: 16, colors: ['#ff4444', '#880000', '#ffffff'], glow: true, speed: [30, 70], life: [300, 600] });
          break;
        case 'stone.deepSleep':
          // StoneOfDeepSleep: Speck.NOTE, notes drifting up.
          fx.burst(at.x, at.y, now, { count: 10, colors: ['#a0c8ff', '#ffffff'], glow: true, speed: [5, 20], life: [800, 1400], rise: 20, drag: 0.5, size: [2, 2], spread: 10 });
          break;
        case 'stone.blink':
          fx.burst(at.x, at.y, now, { count: 20, colors: ECTO, glow: true, speed: [10, 50], life: [400, 800], rise: 10, spread: 5 });
          break;
        case 'stone.clairvoyance':
          // StoneOfClairvoyance: CheckedCell over the cells it shows; a wide ring of light here.
          fx.burst(at.x, at.y, now, { count: 30, colors: ['#ffffff', '#c0e0ff'], glow: true, speed: [60, 120], life: [400, 700], drag: 0.1, size: [1, 1] });
          break;
        case 'stone.flock':
          // StoneOfFlock: CellEmitter's Speck.WOOL where each sheep appears.
          fx.burst(at.x, at.y, now, { count: 26, colors: WOOL, speed: [10, 50], life: [400, 800], rise: 12, drag: 0.4, size: [2, 3], spread: 12 });
          break;
        default:
          fx.burst(at.x, at.y, now, { count: 10, colors: ['#ffffff', '#d0d0ff'], glow: true, speed: [10, 40], life: [300, 600] });
      }
      return;
    }
    case 'shock': {
      // StoneOfShock: Lightning arcs out to whoever it struck, and SparkParticle at the stone.
      if (!here(effect.depth)) return;
      const at = cellCentre(effect.pos);
      fx.burst(at.x, at.y, now, { count: 30, colors: BOLT_GLOW.lightning!, glow: true, speed: [60, 160], life: [150, 350], drag: 0.1, size: [1, 1] });
      fx.flash('230, 240, 255', 0.25, 160, now);
      return;
    }
    case 'enthralled': {
      // ScrollOfSirensSong: Speck.HEART rising from the enthralled.
      if (!here(effect.depth)) return;
      burst(centreOf(view, effect.mob, now), now, { count: 8, colors: ['#ff6080', '#ff9fb0', '#ffffff'], glow: true, speed: [4, 14], life: [800, 1300], rise: 22, drag: 0.5, size: [2, 2], spread: 4 });
      return;
    }
    case 'summoned': {
      // SummonElemental: the elemental bursts out of nothing (the spell's MagicMissile and a puff of its element).
      if (!here(effect.depth)) return;
      const at = cellCentre(effect.pos);
      fx.burst(at.x, at.y, now, { count: 26, colors: FIRE, glow: true, speed: [10, 50], life: [400, 800], rise: 20, drag: 0.4, spread: 4 });
      return;
    }
    case 'censer': {
      // ChaoticCenser: a puff of the gas where it lands (its Speck), the censer's smoke at the hero.
      if (!here(effect.depth)) return;
      const to = cellCentre(effect.to);
      fx.burst(to.x, to.y, now, { count: 20, colors: GAS_PUFF[effect.gas] ?? SMOKE, speed: [5, 25], life: [700, 1300], drag: 0.5, size: [2, 3], spread: 8 });
      burst(centreOf(view, effect.hero, now), now, { count: 6, colors: SMOKE, speed: [3, 10], life: [600, 1000], rise: 15, drag: 0.5, size: [2, 2] });
      return;
    }
    case 'energized': {
      // AlchemyScene.energizeItem: SparkParticle, energy-blue, off the hero who made it.
      burst(centreOf(view, effect.hero, now), now, { count: 14, colors: ENERGY, glow: true, speed: [20, 60], life: [200, 450], drag: 0.2, size: [1, 1] });
      return;
    }
    case 'crafted':
    case 'catalyst':
      // AlchemyScene.craftItem: Speck.WOOL off the hero, the pot's smoke.
      burst(centreOf(view, effect.hero, now), now, { count: 10, colors: WOOL, speed: [5, 25], life: [400, 800], rise: 14, drag: 0.4, size: [2, 3], spread: 4 });
      return;
    case 'used': {
      // Each potion's and scroll's own effect on the hero (Potion.apply, Scroll.doRead).
      const look = USE_FX[effect.kind];
      if (look) burst(centreOf(view, effect.hero, now), now, look);
      if (effect.kind === 'scroll.retribution' || effect.kind === 'scroll.psionicBlast') {
        fx.flash('255, 255, 255', 0.6, 400, now);
        fx.shake(4, 300, now);
      }
      if (effect.kind === 'scroll.rage' || effect.kind === 'scroll.challenge') fx.flash('255, 0, 0', 0.25, 400, now);
      return;
    }
    case 'charged':
      // ScrollOfRecharging.charge: EnergyParticle, fifteen of them around the hero.
      burst(centreOf(view, effect.hero, now), now, { count: 15, colors: ['#ffffff', '#80e0ff', '#40b0ff'], glow: true, speed: [20, 50], life: [300, 600], drag: 0.5, size: [1, 1] });
      return;
    case 'berserk':
      // Berserk.startBerserking: the screen flashes red and a red glow bursts from the hero.
      fx.flash('255, 0, 0', 0.4, 500, now);
      burst(centreOf(view, effect.hero, now), now, { count: 24, colors: ['#ff3030', '#ff8040', '#a00000'], glow: true, speed: [30, 90], life: [300, 700], drag: 0.4, size: [1, 2] });
      return;
    case 'talent':
      // A point put in a talent: a golden sparkle (TalentButton.upgradeTalent has no more than the sound).
      burst(centreOf(view, effect.hero, now), now, { count: 12, colors: GOLD, glow: true, speed: [10, 40], life: [400, 800], rise: 14, size: [1, 1] });
      return;
    case 'freerun':
      // Momentum.doAction: Speck.JET, a few more with every stack.
      burst(centreOf(view, effect.hero, now), now, { count: 5 + effect.stacks, colors: ['#ffffa0', '#ffffff', '#ffe040'], glow: true, speed: [40, 100], life: [200, 450], drag: 0.6, size: [1, 2] });
      return;
    case 'metamorphed':
      // Speck.CHANGE over the hero.
      burst(centreOf(view, effect.hero, now), now, { count: 10, colors: ['#ffffff', '#c0a0ff', '#80c0ff'], glow: true, speed: [10, 50], life: [400, 900], rise: 10, size: [1, 1] });
      return;
    case 'comboMove':
      if (effect.move === 'parry') burst(centreOf(view, effect.hero, now), now, { count: 8, colors: SPARK, glow: true, speed: [30, 80], life: [150, 350], size: [1, 1] });
      return;
    case 'assassinated': {
      if (!here(effect.depth)) return;
      const puppet = view.puppets.get(effect.mob);
      if (puppet) {
        const at = view.position(puppet, now);
        burst({ x: at.x + TILE / 2, y: at.y + TILE / 2 }, now, { count: 14, colors: BLOOD, speed: [30, 90], life: [250, 500], gravity: 200, size: [1, 2] });
      }
      return;
    }
    case 'healing':
      // Healing.act: Speck.HEALING rising off the healed for a while.
      burst(centreOf(view, effect.hero, now), now, { count: 12, colors: HEAL, glow: true, speed: [3, 10], life: [700, 1200], rise: 20, drag: 0.4, size: [1, 2], spread: 5 });
      return;
    case 'masteryPotion':
    case 'inspired':
      burst(centreOf(view, effect.hero, now), now, { count: 30, colors: GOLD, glow: true, speed: [20, 60], life: [600, 1200], rise: 30, drag: 0.4, size: [1, 2] });
      return;
    case 'augmented': case 'curseInfused': case 'detected': case 'guessed': {
      const colors = effect.type === 'curseInfused' ? VOID : effect.type === 'augmented' ? SPARK : ['#ffffff', '#c0d8ff'];
      burst(centreOf(view, effect.hero, now), now, { count: 14, colors, glow: true, speed: [10, 40], life: [400, 800], rise: 12, size: [1, 1] });
      if (effect.type === 'curseInfused') fx.flash('60, 0, 80', 0.3, 400, now);
      return;
    }
    case 'frozenPotion':
      burst(centreOf(view, effect.hero, now), now, { count: 14, colors: FROST, speed: [30, 80], life: [200, 450], gravity: 260, size: [1, 1] });
      return;
    case 'noise': {
      // Noisemaker: Speck.SCREAM rings around it.
      if (!here(effect.depth)) return;
      const at = cellCentre(effect.pos);
      fx.ring(at.x, at.y, now, ['#ffffff', '#ffe080'], 16);
      return;
    }
    case 'snuffed':
      burst(centreOf(view, effect.hero, now), now, { count: 6, colors: SMOKE, speed: [3, 12], life: [500, 900], rise: 14, drag: 0.5, size: [1, 2] });
      return;
    default:
      return;
  }
}

/* Shattered's alchemy */

const WATER = ['#9ad4ff', '#d8f0ff', '#5aa8e8'];
const LEAVES = ['#5fbf3f', '#8fdf5f', '#3f8f2f'];
const WOOL = ['#ffffff', '#ececec', '#d8d8d8'];
const ENERGY = ['#44ccff', '#a8ecff', '#ffffff'];

/** Potion.splashColor: each colour's flask (Shattered's ItemSpriteSheet potions), by the run's label. */
const FLASK: Readonly<Record<string, readonly string[]>> = {
  turquoise: ['#40e0d0', '#a0fff4'], crimson: ['#dc143c', '#ff6070'], azure: ['#3070ff', '#90b8ff'], jade: ['#20a060', '#70e0a0'],
  golden: ['#ffd030', '#fff0a0'], magenta: ['#e040e0', '#ff9cff'], charcoal: ['#404040', '#707070'], ivory: ['#fffff0', '#e8e4d0'],
  amber: ['#ffbf00', '#ffe080'], bistre: ['#6a4a2a', '#9a7a5a'], indigo: ['#5a30c0', '#9a80ff'], silver: ['#c0c0c0', '#f0f0f0'],
};
/** Brews and elixirs keep one colour of their own (their sprites). */
const BREW_SPLASH: Partial<Record<ItemKind, readonly string[]>> = {
  'brew.infernal': FIRE, 'brew.blizzard': FROST, 'brew.shocking': ['#ffffff', '#fffcc0', '#c0e8ff'], 'brew.caustic': ['#4a6a20', '#8aaa40'],
  'brew.aqua': WATER, 'brew.unstable': ['#ff60ff', '#60ffff', '#ffff60'], 'elixir.honeyedHealing': GOLD,
};

function splashColors(world: World, kind: ItemKind): readonly string[] {
  const own = BREW_SPLASH[kind];
  if (own) return own;
  const color = POTION_COLORS[labelOf(kind, world.run.labels)];
  return FLASK[color ?? ''] ?? WATER;
}

/** A gas's puff (Speck.TOXIC, CONFUSION, CORROSION... their hardlight colours). */
const GAS_PUFF: Readonly<Record<string, readonly string[]>> = {
  toxic: ['#50ff60', '#80ff90'], paralytic: ['#ffff66', '#ffffaa'], confusion: ['#ff60a0', '#60a0ff', '#a0ff60', '#ffa060'],
  corrosive: ['#aaaaaa', '#c8b48a'], smoke: ['#202020', '#404040'], storm: ['#8ad8d8', '#c0f0f0'], stench: ['#003300', '#1a4a1a'],
  regrowth: LEAVES, inferno: ['#ee7722', '#ffaa44'], blizzard: ['#ffffff', '#d8f0ff'], fire: FIRE, freezing: FROST,
  electricity: ['#ffffff', '#fffcc0'],
};

/** What each potion drunk and scroll read looks like on its hero (the Speck or emitter its class shows). */
const USE_FX: Partial<Record<ItemKind, BurstOptions>> = {
  'potion.haste': { count: 16, colors: ['#ffff80', '#ffffff'], glow: true, speed: [20, 60], life: [300, 600], drag: 0.2, size: [1, 1] },
  'potion.invisibility': { count: 20, colors: ['#ffffff', '#d8e8ff'], glow: true, speed: [5, 20], life: [500, 900], rise: 10, drag: 0.4 },
  'potion.mindVision': { count: 14, colors: ['#ffffff', '#c0e0ff'], glow: true, speed: [30, 80], life: [300, 600], size: [1, 1] },
  'potion.magicalSight': { count: 18, colors: ['#ffffff', '#c0e0ff'], glow: true, speed: [40, 100], life: [300, 600], size: [1, 1] },
  'potion.shielding': { count: 20, colors: ['#ffffff', '#a0c8ff'], glow: true, speed: [10, 30], life: [500, 900], spread: 6, size: [1, 1] },
  'potion.earthenArmor': { count: 16, colors: ['#8a6a3a', '#b08a50', '#5fbf3f'], speed: [10, 30], life: [500, 900], gravity: 80, size: [1, 2] },
  'potion.cleansing': { count: 18, colors: ['#ffffff', '#e8f4ff'], glow: true, speed: [10, 30], life: [500, 900], rise: 12, size: [1, 1] },
  'potion.stamina': { count: 14, colors: ['#80ff80', '#ffffff'], glow: true, speed: [20, 50], life: [300, 600], size: [1, 1] },
  'potion.strength': { count: 30, colors: ['#ff6040', '#ffd080', '#ffffff'], glow: true, speed: [20, 60], life: [500, 1000], rise: 20 },
  'potion.experience': { count: 30, colors: GOLD, glow: true, speed: [20, 60], life: [500, 1000], rise: 20 },
  'elixir.might': { count: 30, colors: ['#ff6040', '#ffd080', '#ffffff'], glow: true, speed: [20, 60], life: [500, 1000], rise: 20 },
  'elixir.featherFall': { count: 14, colors: WOOL, speed: [5, 15], life: [700, 1200], gravity: 20, drag: 0.5, size: [1, 2], spread: 6 },
  'elixir.aquaticRejuvenation': { count: 14, colors: WATER, speed: [5, 20], life: [600, 1000], rise: 15, drag: 0.4, size: [1, 2] },
  'elixir.arcaneArmor': { count: 16, colors: VOID, glow: true, speed: [10, 30], life: [500, 900], spread: 6, size: [1, 1] },
  'elixir.dragonsBlood': { count: 18, colors: FIRE, glow: true, speed: [10, 30], life: [500, 900], rise: 20, size: [1, 2] },
  'elixir.icyTouch': { count: 18, colors: FROST, glow: true, speed: [10, 30], life: [500, 900], size: [1, 1] },
  'elixir.toxicEssence': { count: 18, colors: ['#50ff60', '#80ff90'], speed: [5, 20], life: [600, 1000], drag: 0.5, size: [2, 2] },
  'scroll.recharging': { count: 20, colors: ['#ffffff', '#c8e8ff', '#80c0ff'], glow: true, speed: [20, 60], life: [300, 600], size: [1, 1] },
  'scroll.mysticalEnergy': { count: 24, colors: ['#ffffff', '#c8e8ff', '#80c0ff'], glow: true, speed: [20, 70], life: [300, 700], size: [1, 1] },
  'scroll.lullaby': { count: 10, colors: ['#a0c8ff', '#ffffff'], glow: true, speed: [10, 30], life: [800, 1400], rise: 20, size: [2, 2] },
  'scroll.sirensSong': { count: 10, colors: ['#ff9fb0', '#ffffff'], glow: true, speed: [10, 30], life: [800, 1400], rise: 20, size: [2, 2] },
  'scroll.rage': { count: 20, colors: ['#ff3030', '#ff8080'], glow: true, speed: [30, 80], life: [300, 600] },
  'scroll.challenge': { count: 20, colors: ['#ff3030', '#ff8080'], glow: true, speed: [30, 80], life: [300, 600] },
  'scroll.terror': { count: 20, colors: ['#ff4444', '#880000'], glow: true, speed: [40, 90], life: [300, 600] },
  'scroll.dread': { count: 24, colors: ['#ff4444', '#440000'], glow: true, speed: [40, 90], life: [300, 600] },
  'scroll.retribution': { count: 40, colors: ['#ffffff', '#ffffc0'], glow: true, speed: [60, 160], life: [250, 500], size: [1, 2] },
  'scroll.psionicBlast': { count: 40, colors: ['#ffffff', '#ffc0ff'], glow: true, speed: [60, 160], life: [250, 500], size: [1, 2] },
  'scroll.foresight': { count: 14, colors: ['#ffffff', '#c0e0ff'], glow: true, speed: [20, 60], life: [300, 600], size: [1, 1] },
  'scroll.antiMagic': { count: 18, colors: ['#8080ff', '#ffffff'], glow: true, speed: [10, 40], life: [400, 800], size: [1, 1] },
  'scroll.divination': { count: 18, colors: GOLD, glow: true, speed: [10, 40], life: [400, 800], rise: 12, size: [1, 1] },
  'scroll.metamorphosis': { count: 18, colors: GOLD, glow: true, speed: [10, 40], life: [400, 800], rise: 12, size: [1, 1] },
  'scroll.transmutation': { count: 18, colors: ['#ffffff', '#c0ffc0'], glow: true, speed: [10, 40], life: [400, 800], size: [1, 1] },
  'scroll.prismaticImage': { count: 20, colors: ['#ff8080', '#80ff80', '#8080ff', '#ffff80'], glow: true, speed: [10, 40], life: [400, 800] },
  'brew.unstable': { count: 16, colors: ['#ff60ff', '#60ffff', '#ffff60'], glow: true, speed: [10, 40], life: [400, 800] },
};

/** Extra look of each enhanced bomb's blast (their explode()s over Bomb's): frost, fire, wool, smoke, light... */
const BOMB_FX: Partial<Record<ItemKind, BurstOptions>> = {
  'bomb.frost': { count: 60, colors: FROST, glow: true, speed: [30, 120], life: [500, 1000], drag: 0.2, spread: 16, size: [1, 2] },
  'bomb.fire': { count: 60, colors: FIRE, glow: true, speed: [10, 60], life: [600, 1100], rise: 30, drag: 0.4, spread: 18, size: [1, 2] },
  'bomb.woolly': { count: 60, colors: WOOL, speed: [20, 70], life: [500, 900], rise: 10, drag: 0.4, spread: 18, size: [2, 3] },
  'bomb.smoke': { count: 70, colors: GAS_PUFF.smoke!, speed: [10, 50], life: [900, 1600], drag: 0.5, spread: 18, size: [2, 4] },
  'bomb.regrowth': { count: 50, colors: [...LEAVES, ...HEAL], glow: false, speed: [20, 70], life: [500, 1000], rise: 10, drag: 0.4, spread: 18, size: [1, 2] },
  'bomb.holy': { count: 60, colors: ['#ffffff', '#fffcc0', '#ffe070'], glow: true, speed: [40, 140], life: [400, 800], drag: 0.2, size: [1, 2] },
  'bomb.arcane': { count: 60, colors: VOID, glow: true, speed: [30, 120], life: [500, 900], drag: 0.2, spread: 12, size: [1, 2] },
  'bomb.shrapnel': { count: 70, colors: ['#c0c0c0', '#ffffff', '#808080'], glow: false, speed: [100, 240], life: [200, 450], drag: 0.05, size: [1, 1] },
  'bomb.flashbang': { count: 40, colors: ['#ffffff', '#fffcc0'], glow: true, speed: [60, 160], life: [200, 400], size: [1, 2] },
  'bomb.noisemaker': { count: 20, colors: ['#ffffff', '#ffe080'], glow: true, speed: [40, 100], life: [300, 600], size: [1, 1] },
};

/** Fire, frost, sparks and leaves over the blobs that are more than a cloud (Fire, Freezing, Electricity, Regrowth, Inferno, Blizzard). */
export function blobFx(gas: Partial<Record<string, ReadonlyArray<readonly [number, number]>>>, visible: readonly boolean[], now: number, dt: number): void {
  const chance = (perSecond: number): boolean => Math.random() < (perSecond * dt) / 1000;
  for (const [cell, volume] of gas.fire ?? []) {
    if (!visible[cell] || volume <= 0 || !chance(14)) continue;
    // FlameParticle: rising and fading.
    const x = (cell % WIDTH) * TILE + 2 + Math.random() * 12;
    const y = Math.trunc(cell / WIDTH) * TILE + 6 + Math.random() * 8;
    fx.burst(x, y, now, { count: 1, colors: FIRE, glow: true, speed: [2, 8], life: [400, 800], rise: 26, drag: 0.5, size: [1, 2], spread: 0 });
  }
  for (const [cell, volume] of gas.inferno ?? []) {
    if (!visible[cell] || volume <= 0 || !chance(10)) continue;
    const x = (cell % WIDTH) * TILE + Math.random() * TILE;
    const y = Math.trunc(cell / WIDTH) * TILE + Math.random() * TILE;
    fx.burst(x, y, now, { count: 1, colors: FIRE, glow: true, speed: [10, 30], life: [300, 600], rise: 14, drag: 0.4, size: [1, 2], spread: 0 });
  }
  for (const kind of ['freezing', 'blizzard'] as const) {
    for (const [cell, volume] of gas[kind] ?? []) {
      if (!visible[cell] || volume <= 0 || !chance(kind === 'blizzard' ? 12 : 8)) continue;
      // SnowParticle: drifting down.
      const x = (cell % WIDTH) * TILE + Math.random() * TILE;
      const y = Math.trunc(cell / WIDTH) * TILE + Math.random() * 6;
      fx.burst(x, y, now, { count: 1, colors: FROST, glow: true, speed: [2, 8], life: [600, 1000], gravity: 20, drag: 0.5, size: [1, 1], spread: 0 });
    }
  }
  for (const [cell, volume] of gas.electricity ?? []) {
    if (!visible[cell] || volume <= 0 || !chance(16)) continue;
    // SparkParticle: quick white flecks.
    const x = (cell % WIDTH) * TILE + Math.random() * TILE;
    const y = Math.trunc(cell / WIDTH) * TILE + Math.random() * TILE;
    fx.burst(x, y, now, { count: 2, colors: BOLT_GLOW.lightning!, glow: true, speed: [20, 60], life: [80, 200], size: [1, 1], spread: 0 });
  }
  for (const [cell, volume] of gas.regrowth ?? []) {
    if (!visible[cell] || volume <= 0 || !chance(3)) continue;
    // LeafParticle.LEVEL_SPECIFIC: leaves falling.
    const x = (cell % WIDTH) * TILE + Math.random() * TILE;
    const y = Math.trunc(cell / WIDTH) * TILE + Math.random() * 4;
    fx.burst(x, y, now, { count: 1, colors: LEAVES, speed: [2, 6], life: [800, 1200], gravity: 25, drag: 0.5, size: [1, 1], spread: 0 });
  }
  for (const [cell, volume] of gas.storm ?? []) {
    if (!visible[cell] || volume <= 0 || !chance(6)) continue;
    // StormCloud: rain out of the cloud.
    const x = (cell % WIDTH) * TILE + Math.random() * TILE;
    const y = Math.trunc(cell / WIDTH) * TILE;
    fx.burst(x, y, now, { count: 1, colors: WATER, speed: [0, 2], life: [250, 400], gravity: 260, size: [1, 1], spread: 0 });
  }
}

/** A pool of light, in world pixels. */
export interface Light {
  x: number;
  y: number;
  radius: number;
  /** "r, g, b". */
  color: string;
  strength: number;
}

/**
 * The regions' own life (SewerLevel.Sink, PrisonLevel.Torch, CavesLevel.Vein,
 * CityLevel.Smoke, HallsLevel.Stream), on the decorated walls in sight:
 * water dripping from the sewers' pipes, the prison's torches, glints in the
 * caves' gold veins, smoke over the dwarven city, and embers rising from the
 * demon halls' streams.
 */
export function regionFx(level: Level, visible: readonly boolean[], now: number, dt: number): void {
  const r = levelRegion(level);
  const perCell = [0.6, 9, 0.5, 1.2, 2.5][r]! * (dt / 1000);
  for (let cell = 0; cell < level.map.length; cell++) {
    const terrain = level.map[cell]!;
    const source = r === 4 ? terrain === T.WATER : terrain === T.WALL_DECO;
    if (!source || !visible[cell] || Math.random() >= perCell) continue;
    const x = (cell % WIDTH) * TILE;
    const y = Math.trunc(cell / WIDTH) * TILE;
    switch (r) {
      case 0:
        fx.burst(x + 7 + Math.random() * 2, y + TILE - 2, now, { count: 1, colors: ['#9fd0e8', '#d8f0ff'], speed: [0, 2], life: [500, 700], gravity: 120, size: [1, 1], spread: 0 });
        break;
      case 1:
        fx.burst(x + 8, y + 5, now, { count: 1, colors: FIRE, glow: true, speed: [1, 5], life: [250, 500], rise: 14, drag: 0.5, size: [1, 2], spread: 1 });
        break;
      case 2:
        fx.burst(x + 2 + Math.random() * 12, y + 2 + Math.random() * 12, now, { count: 1, colors: GOLD, glow: true, speed: [0, 1], life: [300, 600], size: [1, 1], spread: 0 });
        break;
      case 3:
        fx.burst(x + 4 + Math.random() * 8, y + 4, now, { count: 1, colors: ['#5a5a5a', '#7a7a7a', '#4a4a4a'], speed: [1, 4], life: [1200, 2000], rise: 8, drag: 0.6, size: [2, 3], spread: 1 });
        break;
      default:
        fx.burst(x + Math.random() * TILE, y + TILE - 3, now, { count: 1, colors: FIRE, glow: true, speed: [1, 4], life: [600, 1000], rise: 16, drag: 0.5, size: [1, 1], spread: 0 });
    }
  }
}

/** Light this frame: the prison's torches, whatever burns, fire elementals and fists. */
export function lightsFor(level: Level, visible: readonly boolean[], view: View, now: number): Light[] {
  const lights: Light[] = [];
  const flicker = (seed: number): number => 0.85 + 0.15 * Math.sin(now / 70 + seed) * Math.sin(now / 23 + seed * 3);
  // (The arena's stands hold a crowd, not torches: arenaview.ts lights its braziers.)
  if (levelRegion(level) === 1 && !level.ring) {
    for (let cell = 0; cell < level.map.length; cell++) {
      if (level.map[cell] !== T.WALL_DECO || !visible[cell]) continue;
      lights.push({ x: (cell % WIDTH) * TILE + 8, y: Math.trunc(cell / WIDTH) * TILE + 6, radius: 38, color: '255, 150, 60', strength: 0.22 * flicker(cell) });
    }
  }
  for (const puppet of view.puppets.values()) {
    if (!puppet.alive) continue;
    const fiery = puppet.burning || puppet.kind === 'elemental' || puppet.kind === 'burningFist';
    if (!fiery) continue;
    const { x, y } = view.position(puppet, now);
    lights.push({ x: x + 8, y: y + 8, radius: 34, color: '255, 140, 50', strength: 0.25 * flicker(x + y) });
  }
  return lights;
}

/** The wands' bolts that fly as missiles (MagicMissile), not beams or arcs. */
const WAND_MISSILES = new Set(['magic', 'fire', 'frost', 'corrosion', 'force', 'earth', 'ward', 'corruption', 'rainbow', 'foliage']);

/** Every frame: embers off whoever burns, bubbles off the poisoned, sparkles behind bolts in flight. */
/** Pixel-Mart effects' colours. */
const SPARKS = ['#fff3b0', '#ffcc66', '#ffeba4', '#ffffff'];
const FIREFLIES = ['#d8ff8a', '#fff7a0', '#b8ff6a'];
const SNOW = ['#ffffff', '#e8f4ff', '#bfe3ff'];

export function ambientFx(view: View, now: number, dt: number): void {
  const chance = (perSecond: number): boolean => Math.random() < (perSecond * dt) / 1000;
  for (const puppet of view.puppets.values()) {
    if (!puppet.alive) continue;
    const { x, y } = view.position(puppet, now);
    if (puppet.burning && chance(14)) {
      fx.burst(x + 3 + Math.random() * 10, y + 6 + Math.random() * 8, now, { count: 1, colors: FIRE, glow: true, speed: [2, 8], life: [400, 800], rise: 22, drag: 0.5, size: [1, 1], spread: 0 });
    }
    // Badly wounded, a walker leaves drops behind it.
    if (puppet.hp < puppet.ht * 0.4 && now - puppet.moveStart < STEP_MS && chance(3.5)) {
      const smear = goreOf(puppet.kind).smear;
      if (smear) fx.splat(x + TILE / 2, y + TILE - 7, now, [smear], 1, 2.5);
    }
    // ShadowSprite: a smoke of darkness rises off the clone (CityLevel.Smoke every 0.2 s).
    if (puppet.kind === 'shadow' && chance(5)) {
      fx.burst(x + 4 + Math.random() * 8, y + 4, now, { count: 1, colors: ['#3a2f55', '#1a1226', '#50407a'], speed: [1, 4], life: [900, 1500], rise: 10, drag: 0.6, size: [2, 3], spread: 1 });
    }
    if (puppet.poisoned && chance(3)) {
      fx.burst(x + 4 + Math.random() * 8, y + 6, now, { count: 1, colors: ICHOR, speed: [1, 4], life: [500, 900], rise: 10, drag: 0.5, size: [1, 1], spread: 0 });
    }
    // Pixel-Mart effects a hero wears, seen by the whole party.
    const effect = puppet.look?.effect;
    if (effect === 'fireflies' && chance(2.5)) {
      // Fireflies drift about the hero, glowing.
      fx.burst(x + Math.random() * 16, y + Math.random() * 14, now, { count: 1, colors: FIREFLIES, glow: true, speed: [3, 9], life: [900, 1600], rise: 4, drag: 0.4, size: [1, 1], spread: 0 });
    }
    if (effect === 'snow' && chance(6)) {
      // Snow falls about the hero, from just above their head.
      fx.burst(x - 8 + Math.random() * 32, y - 14, now, { count: 1, colors: SNOW, speed: [2, 6], life: [900, 1400], gravity: 18, drag: 0.6, size: [1, 1], spread: 0 });
    }
  }
  // WarpBeacon.WarpBeaconTracker.fx: ward particles pouring up from the beacon (a pour every 0.05 s).
  for (const cell of view.beacons) {
    if (!chance(20)) continue;
    const at = cellCentre(cell);
    fx.burst(at.x + (Math.random() - 0.5) * 8, at.y + 2, now, { count: 1, colors: ['#8822ff', '#b070ff', '#d8b0ff'], glow: true, speed: [2, 8], life: [400, 800], rise: 22, size: [1, 1], spread: 1 });
  }
  // The wands' missiles pour their particles; snow about the chilled, leaves about a lotus (wandfx.ts).
  wandFx.emit(view.projectiles, view.puppets.values(), (cell) => ({ x: (cell % WIDTH) * TILE + TILE / 2, y: Math.trunc(cell / WIDTH) * TILE + TILE / 2 }), now);
  for (const p of view.projectiles) {
    if (p.leaves && chance(100)) {
      // LeafParticle.GENERAL, poured off the arrow (an emitter at 0.01 s).
      const k = Math.min(1, (now - p.start) / p.duration);
      const lx = ((p.from % WIDTH) + ((p.to % WIDTH) - (p.from % WIDTH)) * k) * TILE + TILE / 2;
      const ly = (Math.trunc(p.from / WIDTH) + (Math.trunc(p.to / WIDTH) - Math.trunc(p.from / WIDTH)) * k) * TILE + TILE / 2;
      fx.burst(lx, ly, now, { count: 1, colors: ['#2a7a22', '#88cc44', '#4cc24c'], speed: [2, 10], life: [300, 600], gravity: 30, size: [1, 2], spread: 1 });
    }
    if (p.sprite !== null || p.trail || !chance(90)) continue;
    const k = Math.min(1, (now - p.start) / p.duration);
    const x = ((p.from % WIDTH) + ((p.to % WIDTH) - (p.from % WIDTH)) * k) * TILE + TILE / 2;
    const y = (Math.trunc(p.from / WIDTH) + (Math.trunc(p.to / WIDTH) - Math.trunc(p.from / WIDTH)) * k) * TILE + TILE / 2;
    fx.burst(x, y, now, { count: 1, colors: p.color ? [`rgb(${p.color})`, '#ffffff'] : ['#90c8ff', '#ffffff'], glow: true, speed: [2, 10], life: [150, 350], size: [1, 1], spread: 1 });
  }
}

/** What a step stirs where the foot left: water splashes, grass rustles, a dry floor puffs a little dust. */
export function stepFx(terrain: number, cell: number, now: number): void {
  const x = (cell % WIDTH) * TILE + TILE / 2;
  const y = Math.trunc(cell / WIDTH) * TILE + TILE - 2;
  if (terrain >= T.WATER_TILES && terrain <= T.WATER) {
    fx.burst(x, y - 1, now, { count: 5, colors: ['#9ad4ff', '#d8f0ff', '#5fa8e0'], speed: [14, 34], life: [220, 420], gravity: 220, drag: 0.2, angle: -Math.PI / 2, cone: 1.6, size: [1, 1], spread: 3 });
  } else if (terrain === T.GRASS || terrain === T.HIGH_GRASS) {
    fx.burst(x, y - 2, now, { count: 3, colors: ['#6aa84f', '#93c47d', '#38761d'], speed: [8, 20], life: [300, 520], gravity: 120, drag: 0.3, angle: -Math.PI / 2, cone: 2.2, size: [1, 1], spread: 3 });
  } else if (terrain !== T.EMBERS) {
    fx.burst(x, y, now, { count: 2, colors: ['rgba(190, 180, 160, 0.7)', 'rgba(140, 130, 115, 0.6)'], speed: [4, 10], life: [260, 420], rise: 6, drag: 0.3, size: [1, 1], spread: 4 });
  } else {
    fx.burst(x, y, now, { count: 3, colors: ['#ff9933', '#ffcc66', '#ff5522'], glow: true, speed: [6, 14], life: [240, 420], rise: 14, drag: 0.4, size: [1, 1], spread: 3 });
  }
}
