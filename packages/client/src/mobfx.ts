import { CHAMPION_AURA, cellX, cellY, type Effect, itemDef, type Mob, type MobBolt, S, type World } from '@pd/core';
import { audio, type Sound } from './audio';
import { fx } from './fx';
import { capitalize, t } from './i18n';
import { itemName } from './itemtext';
import { armoredStatue } from './mobsprites';
import { quality } from './quality';
import { loaded } from './shfx';
import { type Assets, type CharSprite, spdSprite } from './sprites';
import { haptic } from './telegram';
import { COLORS, type Puppet, TILE, type View } from './view';

/*
 * How Shattered's monsters look and sound beyond their sheets (sprites/*Sprite.java):
 * their spells and missiles (MagicMissile, Lightning, Beam), their words, the
 * particles they give off (ElementalSprite's flames, frost and sparks,
 * FetidRatSprite's stench, PhantomPiranhaSprite's light, the golem's
 * gathering), a champion's aura (ChampionEnemy.fx: a Flare of its colour),
 * an eye charging, a necromancer summoning, a ripper about to leap, a ghoul
 * crumpled, an ebony mimic all but invisible.
 */

const cellMiddle = (cell: number): { x: number; y: number } => ({ x: cellX(cell) * TILE + TILE / 2, y: cellY(cell) * TILE + TILE / 2 });

/** The sheets of design v21 (assets/mobs/): the monsters' balls and beams, the curses' icons, the hidden ebony mimic. */
const mobBase = `${import.meta.env.BASE_URL}assets/mobs/`;
const mobImages = new Map<string, HTMLImageElement>();

/** A sheet of assets/mobs/ (name without .png), loading it on the first ask. */
export function mobImage(name: string): HTMLImageElement {
  let image = mobImages.get(name);
  if (!image) {
    image = new Image();
    image.src = `${mobBase}${name}.png`;
    mobImages.set(name, image);
  }
  return image;
}

/** Loads them ahead of the first monster that needs one. */
export function preloadMobFx(): void {
  for (const name of ['mob-bolts', 'mob-beams', 'mob-buffs-l', 'ebony-hidden']) mobImage(name);
}

/**
 * MagicMissile's colours for the monsters' bolts, and what flies for a missile (items.png). `mob` is a ball of
 * mob-bolts.png (a row, two frames of 8x8 at 90 ms) with four squares of its trail's colour; `ray` a beam of
 * mob-beams.png (a row of 16x8 textures laid end to end), reaching `extend` farther than its target.
 */
const BOLTS: Record<MobBolt, {
  color?: string; sprite?: number; beam?: 'beam' | 'lightning' | 'chain'; sound: Sound;
  mob?: { row: number; trail: string }; ray?: { row: number; extend: number };
}> = {
  lightning: { color: '255, 255, 200', beam: 'lightning', sound: 'lightning' },
  shamanRed: { color: '255, 70, 60', sound: 'zap', mob: { row: 0, trail: '#ff6a5a' } },
  shamanBlue: { color: '90, 140, 255', sound: 'zap', mob: { row: 1, trail: '#6a9aff' } },
  shamanPurple: { color: '190, 90, 255', sound: 'zap', mob: { row: 2, trail: '#c070ff' } },
  shadow: { color: '90, 40, 120', sound: 'zap', mob: { row: 3, trail: '#8a3a9a' } },
  fire: { color: '255, 130, 40', sound: 'zap' },
  frost: { color: '170, 220, 255', sound: 'zap' },
  light: { color: '255, 255, 230', sound: 'ray', ray: { row: 2, extend: 0.6 } },
  chaos: { color: '255, 120, 220', sound: 'zap', mob: { row: 4, trail: '#ffffff' } },
  web: { color: '235, 235, 235', sound: 'miss' },
  toxic: { color: '90, 200, 60', sound: 'gas' },
  corrosion: { color: '230, 150, 60', sound: 'miss' },
  elmo: { color: '120, 255, 170', sound: 'zap' },
  deathGaze: { color: '200, 60, 255', sound: 'ray', ray: { row: 1, extend: 0 } },
  spike: { sprite: S.FISHING_SPEAR, sound: 'miss' },
  dart: { sprite: S.PARALYTIC_DART, sound: 'miss' },
  health: { color: '120, 255, 120', beam: 'beam', sound: 'ray' },
  summon: { color: '200, 200, 200', sound: 'chargeup' },
  chain: { color: '160, 160, 170', beam: 'chain', sound: 'chains' },
};

/** Particle colours of a bolt's end, and of what a sprite gives off. */
const SPARKS: Record<string, readonly string[]> = {
  fire: ['#ffcf60', '#ff7a20', '#ffefa0'],
  frost: ['#d6f4ff', '#9fdcff', '#ffffff'],
  spark: ['#ffffff', '#fffcc0', '#c0e8ff'],
  rainbow: ['#ff6060', '#ffd060', '#60ff80', '#60a0ff', '#d060ff'],
  stench: ['rgba(120, 140, 60, 0.7)', 'rgba(90, 110, 40, 0.6)'],
  light: ['#ffffff', '#e8f8ff'],
  elmo: ['#80ffb0', '#c0ffe0', '#40e080'],
  shadow: ['#5a2878', '#a050d0', '#2a1040'],
  bones: ['#ece6cc', '#c4bea6'],
};

const hex = (color: number): string => `${(color >> 16) & 255}, ${(color >> 8) & 255}, ${color & 255}`;

/** An armoured statue's sheet for each armour tier, cut once. */
const statueSheets = new Map<number, CharSprite>();

/** What a monster's puppet shows besides its kind's sheet, from its state (View.sync). */
export function dressMob(assets: Assets, puppet: Puppet, mob: Mob, now: number): void {
  if (mob.kind === 'armoredStatue') {
    const tier = mob.armor ? itemDef(mob.armor.kind).tier ?? 3 : 3;
    let sprite = statueSheets.get(tier);
    if (!sprite) statueSheets.set(tier, (sprite = spdSprite(assets.spd.statue, armoredStatue(tier))));
    puppet.sprite = sprite;
  }
  const rest = mob.hidden ? 'hideStealth'
    : mob.beamCharged || mob.summoning ? 'charge'
    : (mob.leapPos ?? -1) >= 0 ? 'prep'
    : undefined;
  if (rest !== puppet.rest) {
    const resting = puppet.anim === (puppet.rest ?? 'idle');
    puppet.rest = rest;
    if (resting && puppet.alive) {
      puppet.anim = rest ?? 'idle';
      puppet.animStart = now;
    }
  }
  puppet.alpha = mob.hidden ? 0.2 : undefined;
  // An ebony mimic shows itself (design v21): a chest for 200 ms and ten white sparks, then the mimic.
  const hidden = mob.kind === 'ebonyMimic' && mob.hidden === true;
  if (puppet.ebonyHidden && !hidden && puppet.alive) {
    puppet.revealAt = now;
    const at = cellMiddle(mob.pos);
    fx.burst(at.x, at.y, now, { count: 10, colors: ['#e8f0ff', '#ffffff'], speed: [50, 80], life: [250, 300], size: [1, 1], spread: 0 });
  }
  puppet.ebonyHidden = hidden;
  const aura = mob.champion ? CHAMPION_AURA[mob.champion] : undefined;
  puppet.aura = aura ? { color: hex(aura.color), rays: aura.rays } : undefined;
  gathering.set(puppet.id, mob.teleporting === true);
}

/** A golem gathering itself to teleport (GolemSprite.teleParticles). */
const gathering = new Map<string, boolean>();

/** A new floor or run: no monster of the last is gathering any more (the table would only grow with every monster seen). */
export function resetMobFx(): void {
  gathering.clear();
}

/** What each of Shattered's monster effects looks and sounds like (View.apply). */
export function mobEffect(view: View, effect: Effect, world: World, myId: string, now: number): void {
  const here = (depth: number): boolean => depth === view.depth;
  const at = (cell: number): { x: number; y: number } => cellMiddle(cell);
  const mobName = (id: string): string => {
    const kind = view.puppets.get(id)?.kind ?? world.floors[view.depth]?.mobs.find((m) => m.id === id)?.kind;
    return kind ? (t.mobs as Record<string, string>)[kind] ?? '' : '';
  };
  switch (effect.type) {
    case 'mobZap': {
      if (!here(effect.depth)) break;
      const bolt = BOLTS[effect.bolt];
      const caster = view.puppets.get(effect.mob);
      if (caster?.alive && effect.bolt !== 'spike' && effect.bolt !== 'dart') {
        caster.anim = 'zap';
        caster.animStart = now;
        if (cellX(effect.to) !== cellX(effect.from)) caster.flip = cellX(effect.to) < cellX(effect.from);
      }
      if (effect.bolt === 'dart' && caster?.alive) {
        // GnollTricksterSprite: its cast.
        caster.anim = 'cast';
        caster.animStart = now;
      }
      if (bolt.beam) {
        view.beams.push({ from: effect.from, to: effect.to, start: now, duration: bolt.beam === 'lightning' ? 300 : 450, color: bolt.color!, kind: bolt.beam });
      } else if (bolt.ray) {
        // Beam.DeathRay / LightRay (design v21): a texture laid along the ray, fading in three steps over half a second.
        view.beams.push({ from: effect.from, to: effect.to, start: now, duration: 500, color: bolt.color!, kind: 'ray', row: bolt.ray.row, extend: bolt.ray.extend });
      } else {
        // The fire and frost elementals shoot the wands' own bolts (wand-bolts.png).
        view.shoot(effect.from, effect.to, bolt.sprite ?? null, now, bolt.color, effect.bolt === 'fire' ? 'fire' : effect.bolt === 'frost' ? 'frost' : undefined);
        if (bolt.mob) {
          // A ball of mob-bolts.png: 600 ms from hand to hand over a long throw, and a 6x6 flash where it lands.
          const flying = view.projectiles[view.projectiles.length - 1]!;
          flying.mobBolt = bolt.mob;
          flying.duration = Math.min(600, Math.max(150, Math.max(Math.abs(cellX(effect.to) - cellX(effect.from)), Math.abs(cellY(effect.to) - cellY(effect.from))) * 80));
          const landing = at(effect.to);
          fx.burst(landing.x, landing.y, now + flying.duration, { count: 1, colors: [bolt.mob.trail], glow: true, speed: [0, 0], life: [60, 60], size: [6, 6], spread: 0 });
        }
      }
      const end = at(effect.to);
      const colors = effect.bolt === 'fire' ? SPARKS.fire! : effect.bolt === 'frost' ? SPARKS.frost! : effect.bolt === 'chaos' ? SPARKS.rainbow!
        : effect.bolt === 'elmo' ? SPARKS.elmo! : effect.bolt === 'shadow' || effect.bolt === 'deathGaze' ? SPARKS.shadow! : null;
      if (colors) fx.burst(end.x, end.y, now + 120, { count: 8, colors, glow: true, speed: [10, 40], life: [250, 500], size: [1, 2] });
      if (effect.bolt === 'lightning') fx.burst(end.x, end.y, now, { count: 3, colors: SPARKS.spark!, glow: true, speed: [20, 50], life: [150, 300] });
      audio.play(bolt.sound, 1, 1, at(effect.from));
      if (effect.bolt === 'corrosion') audio.later(250, 'gas', 1, 1, end);
      break;
    }
    case 'mobSays': {
      const name = capitalize(mobName(effect.mob));
      const lines = t.mobLines;
      switch (effect.line) {
        case 'parried':
          if (!here(effect.depth)) break;
          view.float(effect.mob, lines.parried, COLORS.neutral, now, true);
          audio.play('hit_parry', 1, 1, view.placeOf(effect.mob, now));
          break;
        case 'scorpion':
          if (here(effect.depth)) view.say(`${name}: «${lines.scorpion}»`, COLORS.negative, now);
          break;
        case 'vent': {
          const kind = view.puppets.get(effect.mob)?.kind;
          if (here(effect.depth)) view.say(kind === 'dm201' ? lines.grenade : lines.vent, COLORS.warning, now);
          break;
        }
        case 'seenPassive':
          if (here(effect.depth)) view.say(lines.seenPassive, COLORS.positive, now);
          break;
        case 'seenAggro':
          if (here(effect.depth)) view.say(lines.seenAggro, COLORS.warning, now);
          break;
        case 'teleportAway':
          if (here(effect.depth)) view.say(lines.teleportAway, COLORS.default, now);
          break;
        case 'blocked':
          if (!here(effect.depth)) break;
          view.say(lines.blocked, COLORS.negative, now);
          audio.play('hit_parry', 1, 1, view.placeOf(effect.mob, now));
          break;
        case 'thankYou':
          if (!here(effect.depth)) break;
          view.say(`${name}: «${lines.thankYou}»`, COLORS.positive, now);
          audio.play('ghost');
          break;
        case 'spawnerDied':
          view.say(lines.spawnerDied, COLORS.highlight, now);
          break;
        default:
          break;
      }
      break;
    }
    case 'afflicted':
      if (effect.hero !== myId) break;
      // The curse's icon rises over the hero (design v21): 16x16 of mob-buffs-l.png, five steps of 100 ms, then gone.
      if (effect.by !== 'blindness') view.stateIcons.push({ hero: effect.hero, ix: STATE_ICON[effect.by], start: now });
      view.say(t.mobLines.debuffs[effect.by], COLORS.negative, now);
      audio.play(effect.by === 'degrade' ? 'degrade' : 'debuff');
      haptic('hurt');
      break;
    case 'mobHealed':
      if (here(effect.depth)) view.float(effect.mob, `+${effect.amount}`, COLORS.positive, now);
      break;
    case 'arcs':
      if (!here(effect.depth)) break;
      for (const cell of effect.cells) {
        view.beams.push({ from: effect.from, to: cell, start: now, duration: 300, color: '255, 255, 200', kind: 'lightning' });
      }
      if (effect.cells.length > 0) audio.play('lightning');
      break;
    case 'summoning': {
      if (!here(effect.depth)) break;
      const caster = view.puppets.get(effect.mob);
      if (effect.pos < 0) break;
      if (caster?.alive) {
        caster.anim = 'zap';
        caster.animStart = now;
      }
      // NecromancerSprite: bones rattling where it summons (a spectral one's, shadows).
      const spectral = caster?.kind === 'spectralNecromancer';
      const end = at(effect.pos);
      fx.burst(end.x, end.y, now, { count: 6, colors: spectral ? SPARKS.shadow! : SPARKS.bones!, speed: [6, 20], life: [400, 800], rise: 10 });
      audio.play('chargeup', 0.8, 1, end);
      break;
    }
    case 'summoned': {
      if (!here(effect.depth)) break;
      const spectral = view.puppets.get(effect.mob)?.kind === 'spectralNecromancer';
      const end = at(effect.pos);
      fx.burst(end.x, end.y, now, { count: 10, colors: spectral ? SPARKS.shadow! : SPARKS.bones!, speed: [10, 40], life: [400, 700] });
      audio.play(spectral ? 'cursed' : 'bones', 1, 1, end);
      break;
    }
    case 'crumpled':
      // GhoulSprite.crumple: it falls, and lies there (View.sync keeps it, crumpled).
      break;
    case 'mobTeleported': {
      if (!here(effect.depth)) break;
      const from = at(effect.from);
      const to = at(effect.to);
      fx.burst(from.x, from.y, now, { count: 6, colors: ['#ffffff', '#dddddd'], speed: [6, 18], life: [300, 600], rise: 8 });
      fx.burst(to.x, to.y, now, { count: 6, colors: SPARKS.elmo!, glow: true, speed: [6, 18], life: [300, 600], rise: 8 });
      audio.play('teleport', 1, 1, to);
      break;
    }
    case 'gathering':
      break;
    case 'charging': {
      if (!here(effect.depth)) break;
      const caster = view.puppets.get(effect.mob);
      if (caster) {
        caster.rest = 'charge';
        caster.anim = 'charge';
        caster.animStart = now;
        if (cellX(effect.pos) !== cellX(caster.to)) caster.flip = cellX(effect.pos) < cellX(caster.to);
      }
      audio.play('chargeup', 1, 1, view.placeOf(effect.mob, now));
      break;
    }
    case 'leapReady': {
      if (!here(effect.depth)) break;
      const ripper = view.puppets.get(effect.mob);
      if (ripper) {
        ripper.rest = 'prep';
        ripper.anim = 'prep';
        ripper.animStart = now;
        if (cellX(effect.pos) !== cellX(ripper.to)) ripper.flip = cellX(effect.pos) < cellX(ripper.to);
      }
      // GameScene.targetedCell: the cell it will land on, marked.
      view.flashes.push({ cell: effect.pos, start: now, color: '255, 60, 60', duration: 900 });
      view.say(t.mobLines.leap, COLORS.warning, now);
      break;
    }
    case 'escaped':
      if (effect.kind === 'crystalMimic') view.say(t.mobLines.crystalEscaped, COLORS.negative, now);
      else if (effect.item) view.say(t.mobLines.escapes(itemName(world, effect.item)), COLORS.negative, now);
      break;
    case 'champion':
      if (here(effect.depth)) view.say(t.mobLines.championWarn, COLORS.warning, now);
      break;
    default:
      break;
  }
}

/** Every frame: what Shattered's monsters give off (their sprites' emitters). */
export function mobAmbient(view: View, now: number, dt: number): void {
  const chance = (perSecond: number): boolean => Math.random() < (perSecond * dt) / 1000;
  for (const puppet of view.puppets.values()) {
    if (!puppet.alive) continue;
    const { x, y } = view.position(puppet, now);
    const cx = x + TILE / 2;
    const cy = y + TILE - puppet.sprite.sheet.h / 2;
    switch (puppet.sprite.emitter) {
      // ElementalSprite: FlameParticle (every 0.06 s), MagicParticle, SparkParticle.STATIC, RainbowParticle.
      case 'flame':
        if (chance(16)) fx.burst(cx - 4 + Math.random() * 8, cy + 2, now, { count: 1, colors: SPARKS.fire!, glow: true, speed: [2, 6], life: [300, 600], rise: 24, drag: 0.5, size: [1, 1], spread: 0 });
        break;
      case 'frost':
        if (chance(12)) fx.burst(cx - 5 + Math.random() * 10, cy - 4 + Math.random() * 10, now, { count: 1, colors: SPARKS.frost!, glow: true, speed: [1, 4], life: [400, 700], size: [1, 1], spread: 0 });
        break;
      case 'spark':
        if (chance(12)) fx.burst(cx - 5 + Math.random() * 10, cy - 5 + Math.random() * 10, now, { count: 1, colors: SPARKS.spark!, glow: true, speed: [0, 2], life: [80, 200], size: [1, 1], spread: 0 });
        break;
      case 'rainbow':
        if (chance(30)) fx.burst(cx, cy, now, { count: 1, colors: SPARKS.rainbow!, glow: true, speed: [8, 20], life: [300, 600], size: [1, 1], spread: 2 });
        break;
      // FetidRatSprite: Speck.STENCH.
      case 'stench':
        if (chance(1.5)) fx.burst(cx, cy, now, { count: 1, colors: SPARKS.stench!, speed: [2, 6], life: [900, 1500], rise: 6, drag: 0.4, size: [2, 3], spread: 4 });
        break;
      // PhantomPiranhaSprite: Speck.LIGHT.
      case 'light':
        if (chance(2)) fx.burst(cx - 4 + Math.random() * 8, cy - 4 + Math.random() * 8, now, { count: 1, colors: SPARKS.light!, glow: true, speed: [0, 3], life: [500, 900], size: [1, 1], spread: 0 });
        break;
      default:
        break;
    }
    // GolemSprite.teleParticles: ElmoParticle while it gathers itself.
    if (gathering.get(puppet.id) && chance(20)) {
      fx.burst(cx - 6 + Math.random() * 12, cy + 4, now, { count: 1, colors: SPARKS.elmo!, glow: true, speed: [2, 6], life: [400, 700], rise: 20, size: [1, 1], spread: 0 });
    }
  }
}

/** The curse icons of mob-buffs-l.png, by what struck (the cells of the design: vulnerable, hex, degrade, weakness). */
const STATE_ICON = { vulnerable: 0, hex: 1, degrade: 2, weakness: 3 } as const;

/** A small seeded generator, so a flicker looks the same on every device and every pass of a frame. */
export function seeded(seed: number): () => number {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Bayer's 4x4 matrix: the dither at the rim of an aura. */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/** The aura's radius, in game pixels (design v21). */
export const AURA_RADIUS = 18;
/** A turn of the rays: 15 degrees every 167 ms, 24 steps for the whole circle. */
export const AURA_STEP_MS = 167;
export const AURA_STEPS = 24;

const auras = new Map<string, HTMLCanvasElement>();

/**
 * A champion's aura as Shattered's Flare shows it, in steps (design v21, PD.demo.mobFx): wedges from the middle, each
 * half its sector, bright near the centre and dithered at the rim; `colour` is "r, g, b". Cached: 24 frames to a champion.
 */
export function auraFrame(colour: string, rays: number, step: number): HTMLCanvasElement {
  const key = `${colour}/${rays}/${step}`;
  let canvas = auras.get(key);
  if (canvas) return canvas;
  const r = AURA_RADIUS;
  const size = 2 * r + 1;
  canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext('2d')!;
  const data = g.createImageData(size, size);
  const [red, green, blue] = colour.split(',').map((n) => Number(n)) as [number, number, number];
  const sector = (Math.PI * 2) / rays;
  const turn = (step * Math.PI) / 12 + Math.PI / 4;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - r;
      const dy = y - r;
      const dist = Math.sqrt(dx * dx + dy * dy) / r;
      if (dist > 1) continue;
      let angle = Math.atan2(dy, dx) - turn;
      angle = ((angle % sector) + sector) % sector;
      if (angle > sector / 2) continue;
      const threshold = (BAYER[(y % 4) * 4 + (x % 4)]! + 0.5) / 16;
      const alpha = dist < 0.3 ? 0.8 : dist < 0.55 ? 0.55 : dist < 0.8 ? 0.32 : threshold < 0.5 ? 0.16 : 0;
      const white = dist < 0.3 ? 70 : dist < 0.55 ? 25 : 0;
      const i = (y * size + x) * 4;
      data.data[i] = Math.min(255, red + white);
      data.data[i + 1] = Math.min(255, green + white);
      data.data[i + 2] = Math.min(255, blue + white);
      data.data[i + 3] = Math.round(alpha * 255);
    }
  }
  g.putImageData(data, 0, 0);
  auras.set(key, canvas);
  return canvas;
}

/** Which of the 24 steps of the turn the aura is at, `now` ms in (it stands still for reduced motion). */
export const auraStep = (now: number, still: boolean): number => (still ? 0 : Math.floor(now / AURA_STEP_MS) % AURA_STEPS);

/** Shattered's Flare: a champion's aura, rays of its colour turning behind it, drawn onto the map with `lighter`. */
export function drawAura(ctx: CanvasRenderingContext2D, puppet: Puppet, x: number, y: number, now: number): void {
  const aura = puppet.aura;
  if (!aura || !puppet.alive) return;
  const cx = x + TILE / 2;
  const cy = y + TILE - puppet.sprite.sheet.h / 2;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.drawImage(auraFrame(aura.color, aura.rays, auraStep(now, quality.reducedMotion)), Math.round(cx - AURA_RADIUS), Math.round(cy - AURA_RADIUS));
  ctx.restore();
}

/** The evil eye charging (design v21): for a second, six points of light come in to the eye from all sides. */
export function drawCharge(ctx: CanvasRenderingContext2D, puppet: Puppet, x: number, y: number, now: number): void {
  if (puppet.kind !== 'eye' || puppet.rest !== 'charge' || !puppet.alive) return;
  const q = Math.max(0, now - puppet.animStart) % 1200;
  const random = seeded(Math.floor(q / 100) + 1);
  const cx = x + TILE / 2;
  const cy = y + TILE - puppet.sprite.sheet.h / 2;
  for (let i = 0; i < 6; i++) {
    const angle = random() * Math.PI * 2;
    const reach = ((1 - ((q / 1200 + random()) % 1)) * 30 + 6) / 2;
    ctx.fillStyle = random() < 0.5 ? '#e0a0ff' : '#ffffff';
    ctx.globalAlpha = 0.9;
    ctx.fillRect(Math.round(cx + Math.cos(angle) * reach), Math.round(cy + Math.sin(angle) * reach), 1, 1);
  }
  ctx.globalAlpha = 1;
}

/** A curse that has just struck the hero, over their head: rises in five steps of 100 ms, then fades (design v21). */
export function drawStateIcons(ctx: CanvasRenderingContext2D, view: View, heroId: string, x: number, top: number, now: number): void {
  const sheet = mobImage('mob-buffs-l');
  if (!loaded(sheet)) return;
  for (const icon of view.stateIcons) {
    if (icon.hero !== heroId) continue;
    const age = now - icon.start;
    if (age < 0 || age > 900) continue;
    const rise = Math.min(4, Math.floor(age / 100)) * 2;
    ctx.globalAlpha = age < 600 ? 1 : Math.max(0, 1 - (age - 600) / 300);
    ctx.drawImage(sheet, icon.ix * 16, 0, 16, 16, Math.round(x + (TILE - 16) / 2), Math.round(top - 14 - rise), 16, 16);
    ctx.globalAlpha = 1;
  }
}

/** A ghoul lying crumpled (design v21): a dashed red line to the ghoul that holds it up, and a dot for each turn before it rises. */
export function drawFallen(ctx: CanvasRenderingContext2D, puppet: Puppet, x: number, y: number, host: { x: number; y: number } | undefined, now: number): void {
  const link = puppet.downed;
  if (!link || !puppet.alive) return;
  if (host) {
    ctx.fillStyle = '#c03030';
    ctx.globalAlpha = Math.floor(now / 400) % 2 ? 0.55 : 0.3;
    const dx = host.x - x;
    const dy = host.y - y;
    const dots = Math.floor(Math.hypot(dx, dy) / 6);
    for (let i = 1; i < dots; i++) ctx.fillRect(Math.round(x + TILE / 2 + (dx * i) / dots), Math.round(y + TILE / 2 + (dy * i) / dots), 1, 1);
    ctx.globalAlpha = 1;
  }
  const left = Math.ceil((3 * Math.max(0, link.turns)) / link.of);
  for (let i = 0; i < 3; i++) {
    ctx.fillStyle = '#0b0b09';
    ctx.fillRect(x + 4 + i * 3, y + 3, 3, 3);
    ctx.fillStyle = i < left ? '#e04040' : '#3a2020';
    ctx.fillRect(x + 5 + i * 3, y + 4, 1, 1);
  }
}

/** A hidden ebony mimic (design v21: ebony-hidden.png): a faint chest, brighter for 133 ms in every 2.4 s; true if drawn. */
export function drawEbony(ctx: CanvasRenderingContext2D, puppet: Puppet, x: number, y: number, now: number): boolean {
  const sheet = mobImage('ebony-hidden');
  if (!loaded(sheet)) return false;
  let frame: number;
  if (puppet.ebonyHidden) frame = !quality.reducedMotion && now % 2400 < 133 ? 1 : 0;
  else if (puppet.revealAt !== undefined && now - puppet.revealAt < 200) frame = 2;
  else return false;
  ctx.drawImage(sheet, frame * 16, 0, 16, 16, Math.round(x), Math.round(y), 16, 16);
  return true;
}

/** Beam.DeathRay, LightRay, HealthRay; Lightning's arcs; Guard's Chains: drawn for a moment between two cells. */
export function drawBeams(ctx: CanvasRenderingContext2D, view: View, now: number): void {
  for (const beam of view.beams) {
    const k = (now - beam.start) / beam.duration;
    if (k < 0 || k > 1) continue;
    const from = cellMiddle(beam.from);
    const to = cellMiddle(beam.to);
    ctx.save();
    ctx.globalCompositeOperation = beam.kind === 'chain' ? 'source-over' : 'lighter';
    ctx.globalAlpha = 1 - k;
    if (beam.kind === 'lightning') {
      // Lightning (design v21): a broken line of five pieces, bent up to 9 pixels across, new every 66 ms; blue and wide
      // under white, a thin pale one beside them, the last frame at half strength.
      const seed = Math.floor((now - beam.start) / 66) + beam.from * 31 + beam.to * 17;
      const strength = k > 0.78 ? 0.5 : 1;
      ctx.globalAlpha = 1;
      pixelLine(ctx, bolt(from, to, seed + 3), 3, '#4a7aff', strength * 0.8);
      pixelLine(ctx, bolt(from, to, seed + 3), 1, '#ffffff', strength);
      pixelLine(ctx, bolt(from, to, seed + 17), 1, '#bcd4ff', strength * 0.7);
    } else if (beam.kind === 'ray') {
      // A ray of mob-beams.png: its texture laid end to end along the line, 1, then two thirds, then a third of full strength.
      const sheet = mobImage('mob-beams');
      if (loaded(sheet)) {
        const reach = 1 + (beam.extend ?? 0);
        const end = { x: from.x + (to.x - from.x) * reach, y: from.y + (to.y - from.y) * reach };
        const length = Math.hypot(end.x - from.x, end.y - from.y);
        ctx.globalAlpha = k < 1 / 3 ? 1 : k < 2 / 3 ? 0.66 : 0.33;
        ctx.translate(from.x, from.y);
        ctx.rotate(Math.atan2(end.y - from.y, end.x - from.x));
        for (let at = 0; at < length; at += 16) {
          const piece = Math.min(16, length - at);
          ctx.drawImage(sheet, 0, (beam.row ?? 0) * 8, piece, 8, at, -4, piece, 8);
        }
      }
    } else if (beam.kind === 'chain') {
      ctx.strokeStyle = `rgb(${beam.color})`;
      ctx.lineWidth = 2;
      ctx.setLineDash([3, 2]);
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
    } else {
      // Beam: a bright core in a broad glow, narrowing as it fades.
      const width = 6 * (1 - k) + 1;
      ctx.strokeStyle = `rgba(${beam.color}, 0.5)`;
      ctx.lineWidth = width + 3;
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = Math.max(1, width / 3);
      ctx.stroke();
    }
    ctx.restore();
  }
}

/** Lightning's broken line (design v21): five pieces, each point bent across the line by up to 9 pixels. */
export function bolt(from: { x: number; y: number }, to: { x: number; y: number }, seed: number): Array<{ x: number; y: number }> {
  const random = seeded(seed);
  const points = [from];
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  for (let i = 1; i < 5; i++) {
    const across = (random() - 0.5) * 18;
    points.push({ x: from.x + (dx * i) / 5 + (-dy / length) * across, y: from.y + (dy * i) / 5 + (dx / length) * across });
  }
  points.push(to);
  return points;
}

/** A line drawn pixel by pixel, `width` pixels thick. */
function pixelLine(ctx: CanvasRenderingContext2D, points: ReadonlyArray<{ x: number; y: number }>, width: number, colour: string, alpha: number): void {
  ctx.fillStyle = colour;
  ctx.globalAlpha = alpha;
  const half = Math.floor(width / 2);
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const steps = Math.max(1, Math.round(Math.hypot(b.x - a.x, b.y - a.y)));
    for (let j = 0; j <= steps; j++) {
      ctx.fillRect(Math.round(a.x + ((b.x - a.x) * j) / steps) - half, Math.round(a.y + ((b.y - a.y) * j) / steps) - half, width, width);
    }
  }
  ctx.globalAlpha = 1;
}
