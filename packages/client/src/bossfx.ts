import {
  cellX, cellY, type Effect, FIST_ORDER, heroById, type Level, type MobKind, S, SUMMONS, WIDTH, type World,
} from '@pd/core';
import { audio } from './audio';
import { fx } from './fx';
import { t } from './i18n';
import type { Assets } from './sprites';
import { COLORS, TILE, type View } from './view';
import { bossArt, drawBossArt } from './bossart';

/*
 * How Shattered's boss fights look and sound (effects/*, sprites/*Sprite.java):
 * Goo swelling and its warning ooze, Tengu's smoke, bombs counting down, waves
 * of fire and arcing shockers; DM-300's gas and slams, the rocks it brings down,
 * its charge, the pylons' lightning and the electrified floor; the Dwarf King's
 * summoning circles, life links and screams; Yog-Dzewa's death rays, the
 * darkness and its fists' bolts. What the bosses say goes to the log and over
 * their heads; the fight's course (bossFight) is for the music (main.ts).
 */

const ORANGE = '255, 140, 40';
const PURPLE = '170, 60, 230';
const SPARK = '220, 240, 255';
const TOXIC = '90, 200, 60';

/** Colours of a fist's bolt (MagicMissile: FIRE, FOLIAGE, TOXIC, CORROSION, RAINBOW, SHADOW). */
const FIST_BOLTS: readonly string[] = ['255, 130, 40', '100, 200, 60', '120, 200, 70', '200, 120, 40', '255, 255, 210', '70, 20, 100'];
/** A summoning circle's colour by what it brings (DwarfKing.Summoning.fx). */
const SUMMON_COLORS: readonly string[] = ['230, 225, 200', '255, 150, 60', '110, 40, 160', '200, 230, 255'];

/** A boss's line, in the player's language: %s is the hero. */
export function bossLine(kind: MobKind, line: string, hero?: string): string {
  const table = t.bosses.lines;
  if (line === 'invulnerable') return t.bosses.invulnerable;
  if (line.startsWith('deferred:')) return t.bosses.deferred.replace('%d', line.slice(9));
  if (line.startsWith('bleeding:')) return `${t.bosses.bleeding} ${line.slice(9)}`;
  const own = table[kind]?.[line] ?? (line === 'invuln_warn' ? table.fist?.[line] : undefined) ?? line;
  return own.replace('%s', hero ?? '');
}

const cellPx = (cell: number): { x: number; y: number } => ({ x: cellX(cell) * TILE + TILE / 2, y: cellY(cell) * TILE + TILE / 2 });

/** Marks of what is about to strike (GameScene.targetedCell): cells, until when. */
const targets = new Map<number, number>();
/** Lines drawn a moment: lightning arcs, death rays, life links. */
const lines: Array<{ from: { x: number; y: number }; to: { x: number; y: number }; color: string; start: number; duration: number; width: number; jagged: boolean }> = [];
/** Words over a cell, not a character (a bomb's «3...»). */
const marks: Array<{ cell: number; text: string; start: number }> = [];

function arc(from: { x: number; y: number }, to: { x: number; y: number }, now: number, color = SPARK, jagged = true, width = 1, duration = 300): void {
  lines.push({ from, to, color, start: now, duration, width, jagged });
}

/** What a boss effect shows and sounds like, and what the log says. */
export function bossApply(view: View, effect: Effect, world: World, myId: string, now: number): void {
  switch (effect.type) {
    case 'yell': {
      if (effect.depth !== view.depth) return;
      const hero = heroById(world, effect.hero ?? myId);
      const text = bossLine(effect.kind, effect.line, hero ? t.classes[hero.heroClass] : '');
      view.say(`${t.mobs[effect.kind]}: «${text}»`, COLORS.negative, now);
      return;
    }
    case 'bossLine': {
      if (effect.depth !== view.depth) return;
      const text = bossLine(effect.kind, effect.line);
      if (effect.as === 'status') view.float(effect.mob, text, effect.line === '!!!' || effect.line === 'enraged' ? COLORS.negative : COLORS.warning, now, true);
      else view.say(text, effect.as === 'negative' ? COLORS.negative : effect.as === 'warn' ? COLORS.warning : COLORS.default, now);
      return;
    }
    case 'healedMob':
      if (effect.depth === view.depth) view.float(effect.mob, `+${effect.amount}`, COLORS.positive, now);
      return;
    case 'bossFx':
      if (effect.depth === view.depth) bossFx(view, effect, now);
      return;
  }
}

function anim(view: View, id: string | undefined, name: 'attack' | 'zap' | 'pump' | 'pumpAttack' | 'charge' | 'idle', now: number): void {
  const puppet = id ? view.puppets.get(id) : undefined;
  if (!puppet?.alive) return;
  puppet.anim = name;
  puppet.animStart = now;
}

function bossFx(view: View, e: Extract<Effect, { type: 'bossFx' }>, now: number): void {
  const at = e.pos !== undefined ? cellPx(e.pos) : undefined;
  const flash = (cells: readonly number[] | undefined, color: string, duration: number): void => {
    for (const cell of cells ?? []) view.flashes.push({ cell, start: now, color, duration });
  };
  switch (e.fx) {
    case 'pumpUp':
      if ((e.value ?? 0) > 0) {
        anim(view, e.mob, 'pump', now);
        audio.play('chargeup', e.value === 1 ? 0.8 : 1);
        // GooSprite.pumpUp: the cells it may strike ooze darkness.
        flash(e.cells, '20, 0, 30', 1400);
      } else {
        anim(view, e.mob, 'idle', now);
      }
      return;
    case 'pumpAttack':
      anim(view, e.mob, 'pumpAttack', now);
      audio.play('burning');
      return;
    case 'puff':
      flash(e.pos !== undefined ? [e.pos] : [], '230, 230, 230', 500);
      audio.play('puff');
      return;
    case 'throw':
      if (e.pos !== undefined && e.to !== undefined) view.shoot(e.pos, e.to, e.value ?? S.TENGU_BOMB, now);
      anim(view, e.mob, 'zap', now);
      return;
    case 'bombTick':
      if (e.pos !== undefined) marks.push({ cell: e.pos, text: `${e.value}...`, start: now });
      return;
    case 'blast':
      flash(e.cells, ORANGE, 500);
      audio.play('blast');
      return;
    case 'fire':
      flash(e.cells, ORANGE, 700);
      if ((e.cells?.length ?? 0) > 0) audio.play('burning', 1, 0.7);
      else anim(view, e.mob, 'zap', now);
      return;
    case 'shock': {
      const c = e.cells ?? [];
      for (let i = 0; i + 1 < c.length; i += 2) arc(cellPx(c[i]!), cellPx(c[i + 1]!), now);
      audio.play('lightning', 1, 0.8);
      return;
    }
    case 'traps':
      // PrisonBossLevel.FadingTraps: Tengu's darts show a moment, then fade.
      flash(e.cells, '60, 200, 60', 2200);
      return;
    case 'gasZap':
      anim(view, e.mob, 'zap', now);
      if (e.pos !== undefined && e.to !== undefined) view.shoot(e.pos, e.to, null, now, TOXIC);
      audio.play('gas');
      return;
    case 'slam':
      anim(view, e.mob, 'attack', now);
      audio.play('rocks');
      return;
    case 'targeted':
      for (const cell of e.cells ?? []) targets.set(cell, now + 600 + (e.value ?? 1) * 700);
      return;
    case 'rocks':
      flash(e.cells, '150, 140, 120', 900);
      for (const cell of e.cells ?? []) targets.delete(cell);
      audio.play('rocks');
      return;
    case 'charge':
      anim(view, e.mob, 'charge', now);
      audio.play('chargeup');
      return;
    case 'discharge':
      anim(view, e.mob, 'idle', now);
      return;
    case 'shield':
      if (e.mob) view.float(e.mob, `+${e.value ?? 0}`, '#88ccff', now);
      audio.play('lightning', 1.2, 0.6);
      return;
    case 'pylon':
      flash(e.pos !== undefined ? [e.pos] : [], SPARK, 600);
      audio.play('chargeup', 1.2);
      return;
    case 'zap':
      if (at && e.mob) for (const cell of e.cells ?? []) arc(at, cellPx(cell), now);
      else flash(e.cells, SPARK, 300);
      audio.play('lightning', 1, 0.7);
      return;
    case 'dig':
      audio.play('rocks');
      return;
    case 'gate':
      flash(e.cells, ORANGE, 800);
      audio.play('blast');
      return;
    case 'summoned': {
      const kind = SUMMONS[e.value ?? 0];
      audio.play(kind === 'monk' ? 'burning' : kind === 'warlock' ? 'cursed' : kind === 'golem' ? 'chargeup' : 'bones');
      flash(e.pos !== undefined ? [e.pos] : [], SUMMON_COLORS[e.value ?? 0] ?? SPARK, 500);
      return;
    }
    case 'link':
      if (at && e.to !== undefined) arc(at, cellPx(e.to), now, '230, 60, 230', false, 2, 700);
      audio.play('ray');
      return;
    case 'teleport':
      flash([e.pos ?? -1, e.to ?? -1].filter((c) => c >= 0), '200, 200, 255', 500);
      audio.play('teleport');
      return;
    case 'scream':
      audio.play('challenge');
      return;
    case 'beam':
      if (at) for (const cell of e.cells ?? []) arc(at, cellPx(cell), now, PURPLE, false, 3, 450);
      targets.clear();
      audio.play('ray');
      return;
    case 'bolt':
      anim(view, e.mob, 'zap', now);
      if (e.pos !== undefined && e.to !== undefined) view.shoot(e.pos, e.to, null, now, FIST_BOLTS[e.value ?? 0]);
      audio.play('zap');
      return;
    case 'rise':
      flash(e.pos !== undefined ? [e.pos, e.pos - 1, e.pos + 1] : [], PURPLE, 900);
      return;
    case 'grass':
      flash(e.cells, '90, 200, 60', 500);
      return;
    case 'steam':
      flash(e.cells, '240, 240, 240', 600);
      return;
    default:
      return;
  }
}

/** The particles, flashes and shakes of a boss effect (called from fx-events). */
export function bossParticles(effect: Effect, view: View, now: number): void {
  if (effect.type !== 'bossFx' || effect.depth !== view.depth) return;
  const burstAt = (cell: number, colors: readonly string[], count: number, glow = true, rise = 0): void => {
    const { x, y } = cellPx(cell);
    fx.burst(x, y, now, { count, colors, glow, speed: [10, 60], life: [300, 800], drag: 0.3, rise, spread: 5, size: [1, 2] });
  };
  switch (effect.fx) {
    case 'pumpAttack':
      fx.shake(3, 200, now);
      return;
    case 'puff':
      if (effect.pos !== undefined) burstAt(effect.pos, ['#e0e0e0', '#ffffff', '#a0a0a0'], 18, false, 10);
      return;
    case 'blast':
      for (const cell of effect.cells ?? []) burstAt(cell, ['#ffcf60', '#ff7a20', '#ffefa0'], 6);
      fx.flash('255, 200, 120', 0.35, 220, now);
      fx.shake(4, 300, now);
      return;
    case 'fire':
      for (const cell of effect.cells ?? []) burstAt(cell, ['#ffcf60', '#ff7a20', '#ff4010'], 4, true, 25);
      return;
    case 'shock':
      for (const cell of effect.cells ?? []) burstAt(cell, ['#ffffff', '#c0e8ff'], 3);
      return;
    case 'flash':
      fx.flash('255, 255, 255', 0.5, 450, now);
      return;
    case 'flashDark':
      fx.flash('0, 0, 0', 0.8, 700, now);
      return;
    case 'slam':
      fx.shake(3, 700, now);
      return;
    case 'rocks':
      for (const cell of effect.cells ?? []) burstAt(cell, ['#b8ad8f', '#8f866c', '#d6ccae'], 5, false);
      fx.shake(3, 700, now);
      return;
    case 'dig':
      fx.shake(5, 1000, now);
      return;
    case 'charge':
      if (effect.mob) {
        const p = view.puppets.get(effect.mob);
        if (p) burstAt(p.to, ['#ffffff', '#c0e8ff', '#fffcc0'], 20);
      }
      return;
    case 'gate':
      for (const cell of effect.cells ?? []) burstAt(cell, ['#ffcf60', '#ff7a20', '#555555'], 10);
      fx.shake(5, 600, now);
      return;
    case 'zap':
      for (const cell of effect.cells ?? []) burstAt(cell, ['#ffffff', '#c0e8ff'], 3);
      return;
    case 'summoned':
      if (effect.pos !== undefined) burstAt(effect.pos, [`rgb(${SUMMON_COLORS[effect.value ?? 0]})`, '#ffffff'], 12);
      return;
    case 'scream':
      fx.shake(2, 400, now);
      return;
    case 'beam':
      fx.flash('170, 60, 230', 0.2, 300, now);
      return;
    case 'dark':
      fx.flash('0, 0, 0', 0.5, 900, now);
      return;
    case 'rise':
      if (effect.pos !== undefined) for (const c of [effect.pos - 1, effect.pos, effect.pos + 1]) burstAt(c, ['#4a1a6a', '#000000', '#6a2a9a'], 12, false, 30);
      fx.shake(3, 500, now);
      return;
    case 'grass':
      for (const cell of effect.cells ?? []) burstAt(cell, ['#5fcf2f', '#2f8f1f'], 4, false);
      return;
    case 'steam':
      for (const cell of effect.cells ?? []) burstAt(cell, ['#ffffff', '#e0e8f0'], 8, false, 20);
      return;
    default:
      return;
  }
}

/** The boss health bar (BossHealthBar): the boss it follows on my depth, its health and shield, bleeding at the last. */
export function bossBar(world: World, depth: number): { kind: MobKind; hp: number; ht: number; shield: number; bleed: boolean } | null {
  const floor = world.floors[depth];
  const id = floor?.boss?.bar;
  if (!floor || !id) return null;
  const mob = floor.mobs.find((m) => m.id === id);
  if (!mob || mob.hp <= 0) return null;
  return { kind: mob.kind, hp: mob.hp, ht: mob.ht, shield: mob.shield ?? 0, bleed: floor.boss?.bleed === true };
}

/** What a boss fight leaves on the floor, under the characters: its level's art, fire and sparks, bombs, circles, marks. */
export function drawBossGround(
  ctx: CanvasRenderingContext2D, world: World, level: Level, assets: Assets, explored: readonly boolean[], visible: readonly boolean[], now: number,
): void {
  const floor = world.floors[level.depth];
  const art = bossArt(world, level, floor);
  if (art.length > 0) drawBossArt(ctx, assets, art, 'ground', explored, visible);
  const boss = floor?.boss;
  if (!boss) return;
  const tile = (cell: number): { x: number; y: number } => ({ x: cellX(cell) * TILE, y: cellY(cell) * TILE });
  // Tengu's fire about to catch, and the shockers' charge.
  for (const [cell, volume] of boss.fire ?? []) {
    if (!visible[cell]) continue;
    const { x, y } = tile(cell);
    ctx.fillStyle = `rgba(255, ${volume > 1 ? 180 : 110}, 40, ${0.25 + 0.15 * Math.sin(now / 80 + cell)})`;
    ctx.fillRect(x, y, TILE, TILE);
  }
  for (const [cell] of boss.shock ?? []) {
    if (!visible[cell]) continue;
    const { x, y } = tile(cell);
    ctx.fillStyle = `rgba(200, 230, 255, ${0.2 + 0.2 * Math.abs(Math.sin(now / 50 + cell * 3))})`;
    ctx.fillRect(x, y, TILE, TILE);
  }
  // The pylons' energy in the water and the wires: sparks drifting towards their source.
  for (const cell of boss.energy ?? []) {
    if (!visible[cell] || (cell * 7 + Math.floor(now / 140)) % 9 !== 0) continue;
    const { x, y } = tile(cell);
    ctx.fillStyle = 'rgba(230, 245, 255, 0.85)';
    ctx.fillRect(x + ((cell * 5 + Math.floor(now / 90)) % 14) + 1, y + ((cell * 3 + Math.floor(now / 70)) % 14) + 1, 1, 1);
  }
  for (const entry of boss.timed) {
    if (entry.kind === 'summoning' && explored[entry.pos]) {
      // DwarfKing.Summoning: the circle charging on its pedestal, coloured by what it brings.
      const { x, y } = cellPx(entry.pos);
      const color = SUMMON_COLORS[Math.max(0, SUMMONS.indexOf(entry.summon))] ?? SPARK;
      const pulse = 0.5 + 0.5 * Math.sin(now / 120);
      ctx.strokeStyle = `rgba(${color}, ${0.5 + 0.4 * pulse})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(x, y + 3, 6 + pulse * 1.5, 3 + pulse, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = `rgba(${color}, 0.8)`;
      for (let i = 0; i < 3; i++) ctx.fillRect(Math.round(x - 4 + ((i * 37 + now / 30) % 8)), Math.round(y - ((now / 20 + i * 7) % 10)), 1, 1);
    }
    if ((entry.kind === 'bomb' || entry.kind === 'shocker') && explored[entry.pos]) {
      // Tengu's bomb (smoking) and shockers (sparking), stuck to the floor.
      const { x, y } = tile(entry.pos);
      const sprite = entry.kind === 'bomb' ? S.TENGU_BOMB : S.TENGU_SHOCKER;
      ctx.drawImage(assets.items, (sprite % 16) * 16, Math.floor(sprite / 16) * 16, 16, 16, x, y, 16, 16);
      if (visible[entry.pos] && entry.kind === 'bomb') {
        ctx.fillStyle = 'rgba(120, 120, 120, 0.5)';
        ctx.fillRect(x + 7 + Math.round(Math.sin(now / 200) * 2), y + 1 - ((now / 60) % 6), 2, 2);
      }
    }
  }
  // Where rocks or beams are about to strike.
  for (const [cell, until] of targets) {
    if (now > until) {
      targets.delete(cell);
      continue;
    }
    if (!visible[cell]) continue;
    const { x, y } = tile(cell);
    const blink = Math.floor(now / 160) % 2 === 0;
    ctx.strokeStyle = `rgba(255, 60, 40, ${blink ? 0.9 : 0.55})`;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 2.5, y + 2.5, TILE - 5, TILE - 5);
    ctx.beginPath();
    ctx.moveTo(x + TILE / 2, y + 4);
    ctx.lineTo(x + TILE / 2, y + TILE - 4);
    ctx.moveTo(x + 4, y + TILE / 2);
    ctx.lineTo(x + TILE - 4, y + TILE / 2);
    ctx.stroke();
  }
}

/** Over the characters: the level's art that stands in front (walls, overhangs), and the lines and marks of the moment. */
export function drawBossTop(
  ctx: CanvasRenderingContext2D, world: World, level: Level, assets: Assets, explored: readonly boolean[], visible: readonly boolean[], now: number,
): void {
  const floor = world.floors[level.depth];
  const art = bossArt(world, level, floor);
  if (art.length > 0) drawBossArt(ctx, assets, art, 'wall', explored, visible);
  // Life links while they last (LifeLink: a faint thread between the two).
  for (const entry of floor?.boss?.timed ?? []) {
    if (entry.kind !== 'lifeLink') continue;
    const a = floor!.mobs.find((m) => m.id === entry.a);
    const b = floor!.mobs.find((m) => m.id === entry.b);
    if (!a || !b || !(visible[a.pos] || visible[b.pos])) continue;
    ctx.strokeStyle = `rgba(230, 60, 230, ${0.25 + 0.15 * Math.sin(now / 200)})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    const pa = cellPx(a.pos);
    const pb = cellPx(b.pos);
    ctx.moveTo(pa.x, pa.y);
    ctx.lineTo(pb.x, pb.y);
    ctx.stroke();
  }
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!;
    const k = (now - line.start) / line.duration;
    if (k >= 1) {
      lines.splice(i, 1);
      continue;
    }
    ctx.strokeStyle = `rgba(${line.color}, ${1 - k})`;
    ctx.lineWidth = line.width;
    ctx.beginPath();
    ctx.moveTo(line.from.x, line.from.y);
    if (line.jagged) {
      // Lightning: a crooked line, new every frame.
      const steps = 5;
      for (let s = 1; s < steps; s++) {
        const f = s / steps;
        ctx.lineTo(line.from.x + (line.to.x - line.from.x) * f + (Math.random() - 0.5) * 6, line.from.y + (line.to.y - line.from.y) * f + (Math.random() - 0.5) * 6);
      }
    }
    ctx.lineTo(line.to.x, line.to.y);
    ctx.stroke();
    if (line.width >= 3) {
      ctx.strokeStyle = `rgba(255, 255, 255, ${0.8 * (1 - k)})`;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
  ctx.lineWidth = 1;
}

/** The words over cells (a bomb counting down), drawn at screen scale by the caller's float routine. */
export function cellMarks(now: number): Array<{ x: number; y: number; text: string; age: number }> {
  for (let i = marks.length - 1; i >= 0; i--) if (now - marks[i]!.start > 1000) marks.splice(i, 1);
  return marks.map((m) => ({ ...cellPx(m.cell), text: m.text, age: now - m.start }));
}

/** Forgets the marks and lines of a fight (a new depth, a new run). */
export function resetBossFx(): void {
  targets.clear();
  lines.length = 0;
  marks.length = 0;
}

void FIST_ORDER;
void WIDTH;
