import { CHAMPION_AURA, cellX, cellY, type Effect, itemDef, type Mob, type MobBolt, S, type World } from '@pd/core';
import { audio, type Sound } from './audio';
import { fx } from './fx';
import { capitalize, t } from './i18n';
import { itemName } from './itemtext';
import { armoredStatue } from './mobsprites';
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

/** MagicMissile's colours for the monsters' bolts, and what flies for a missile (items.png). */
const BOLTS: Record<MobBolt, { color?: string; sprite?: number; beam?: 'beam' | 'lightning' | 'chain'; sound: Sound }> = {
  lightning: { color: '255, 255, 200', beam: 'lightning', sound: 'lightning' },
  shamanRed: { color: '255, 70, 60', sound: 'zap' },
  shamanBlue: { color: '90, 140, 255', sound: 'zap' },
  shamanPurple: { color: '190, 90, 255', sound: 'zap' },
  shadow: { color: '90, 40, 120', sound: 'zap' },
  fire: { color: '255, 130, 40', sound: 'zap' },
  frost: { color: '170, 220, 255', sound: 'zap' },
  light: { color: '255, 255, 230', beam: 'beam', sound: 'ray' },
  chaos: { color: '255, 120, 220', sound: 'zap' },
  web: { color: '235, 235, 235', sound: 'miss' },
  toxic: { color: '90, 200, 60', sound: 'gas' },
  corrosion: { color: '230, 150, 60', sound: 'miss' },
  elmo: { color: '120, 255, 170', sound: 'zap' },
  deathGaze: { color: '200, 60, 255', beam: 'beam', sound: 'ray' },
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
  const aura = mob.champion ? CHAMPION_AURA[mob.champion] : undefined;
  puppet.aura = aura ? { color: hex(aura.color), rays: aura.rays } : undefined;
  gathering.set(puppet.id, mob.teleporting === true);
}

/** A golem gathering itself to teleport (GolemSprite.teleParticles). */
const gathering = new Map<string, boolean>();

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
      } else {
        view.shoot(effect.from, effect.to, bolt.sprite ?? null, now, bolt.color);
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
    case 'debuffed':
      if (effect.hero !== myId) break;
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

/** Shattered's Flare: a champion's aura, rays of its colour turning behind it (90 degrees a second). */
export function drawAura(ctx: CanvasRenderingContext2D, puppet: Puppet, x: number, y: number, now: number): void {
  const aura = puppet.aura;
  if (!aura || !puppet.alive) return;
  const { w, h } = puppet.sprite.sheet;
  const radius = Math.max(Math.max(w, h) + 4, 16) / 2 + 2;
  const cx = x + TILE / 2;
  const cy = y + TILE - h / 2;
  const turn = ((now / 1000) * Math.PI) / 2 + Math.PI / 4;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
  glow.addColorStop(0, `rgba(${aura.color}, 0.7)`);
  glow.addColorStop(0.5, `rgba(${aura.color}, 0.35)`);
  glow.addColorStop(1, `rgba(${aura.color}, 0)`);
  ctx.fillStyle = glow;
  for (let i = 0; i < aura.rays; i++) {
    const a = turn + (i * Math.PI * 2) / aura.rays;
    const b = a + Math.PI / aura.rays;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius);
    ctx.lineTo(cx + Math.cos(b) * radius, cy + Math.sin(b) * radius);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
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
      // Lightning: a jagged line, new every frame.
      ctx.strokeStyle = `rgb(${beam.color})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      const steps = Math.max(2, Math.round(Math.hypot(to.x - from.x, to.y - from.y) / 6));
      for (let i = 1; i < steps; i++) {
        const f = i / steps;
        ctx.lineTo(from.x + (to.x - from.x) * f + (Math.random() - 0.5) * 6, from.y + (to.y - from.y) * f + (Math.random() - 0.5) * 6);
      }
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
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

