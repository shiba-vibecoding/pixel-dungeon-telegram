import { type Hero, heroAttackDelay, isAlive, type Mob } from '../actors';
import { MAGIC_BOLT, PROJECTILE } from '../ballistica';
import { dispelInvisibility } from '../artifacts';
import { attack } from '../combat';
import { isDemonic, isUndead } from '../enchant';
import { charAt, type Char, type Ctx, enterCell, heroView, isHero, leaveCell } from '../floor';
import { cursedKnown } from '../ident';
import { isExotic, type Item, itemDef, type ItemKind } from '../items';
import { adjacent, cellX, cellY, distance, LENGTH, NEIGHBOURS8, WIDTH } from '../level/geometry';
import { F, hasFlag, T } from '../level/terrain';
import { isTargetedScroll } from '../scrolls';
import { activateStone, INVENTORY_STONES, useStone } from '../stones';
import { readScroll } from '../reading';
import { meleeStr } from '../weapons';
import { pressCell } from '../wands';
import { hasTalent, pointsInTalent as pointsIn } from '../talents';
import type { World } from '../world';
import { addShield, healWithBarrier, say, shedNegatives, tell } from './common';
import {
  boltTarget, type CastAction, hostileMob, illuminate, isFlier, linkedAlly, MSG, SELF, shieldTo, spellCast, spellDef, type SpellDef, spellHurt,
} from './cleric-core';
import { addTimer, clearTimer, cs, hasTimer, markTurns, marks, prolong, prolongMark, setTimer } from './state';

/*
 * The spells of the Cleric's first three tiers (actors/hero/spells): the tome's own, those her talents teach, and those her way
 * adds. Tier four's are in cleric-t4.ts.
 */

const fovOf = (world: World, hero: Hero): boolean[] => heroView(world, hero);
const spell = (id: string): SpellDef => spellDef(id)!;

/** HolyIntuition.usableOnItem: gear and wands whose curse is not known. */
function usableForIntuition(item: Item): boolean {
  const category = itemDef(item.kind).category;
  const equipable = category === 'weapon' || category === 'armor' || category === 'ring' || category === 'artifact' || category === 'missile';
  return (equipable || category === 'wand') && item.curseUnknown === true && !cursedKnown(item);
}

const isStone = (kind: ItemKind): boolean => itemDef(kind).category === 'stone';

/** RecallInscription.chargeUse: by the kind of what was used. */
function recallCost(hero: Hero): number {
  const kind = cs(hero).recall;
  if (!kind) return 0;
  if (itemDef(kind).category === 'scroll') {
    if (isExotic(kind)) return kind === 'scroll.metamorphosis' || kind === 'scroll.enchantment' ? 8 : 4;
    return kind === 'scroll.transmutation' ? 6 : 3;
  }
  if (isStone(kind)) return kind === 'stone.augmentation' || kind === 'stone.enchantment' ? 4 : 2;
  return 0;
}

/** BlessSpell.affectChar. */
function blessChar(ctx: Ctx, hero: Hero, ch: Char): void {
  const points = pointsIn(hero, 'bless');
  say(ctx, hero, { k: 'spell', at: ch.pos, name: 'flareYellow' });
  if (ch === hero) {
    hero.blessed = Math.max(hero.blessed ?? 0, 2 + 4 * points);
    shieldTo(hero, 5 + 5 * points);
    say(ctx, hero, { k: 'text', at: hero.pos, text: String(5 + 5 * points), tone: 'p', icon: 'shield' });
  } else {
    ch.blessed = Math.max(ch.blessed ?? 0, 5 + 5 * points);
    healWithBarrier(ctx, hero, ch, 5 + 5 * points, true);
  }
  if (!isHero(ch) && !ch.ally && hero.subclass === 'priest') illuminate(ch);
}

/** LayOnHands.affectChar. */
function layHands(ctx: Ctx, hero: Hero, ch: Char): void {
  const heal = 10 + 5 * pointsIn(hero, 'lay_on_hands');
  if (ch === hero) {
    const barrier = Math.max(0, Math.min(3 * heal - (hero.shield ?? 0), heal));
    addShield(hero, barrier);
    say(ctx, hero, { k: 'text', at: hero.pos, text: String(barrier), tone: 'p', icon: 'shield' });
  } else {
    healWithBarrier(ctx, hero, ch, heal, true, 3 * heal);
  }
}

/** MnemonicPrayer.affectChar: allies' good conditions last longer, an enemy's bad ones, and it is lit. */
function mnemonic(ctx: Ctx, hero: Hero, ch: Char, extension: number): void {
  if (isHero(ch) || ch.ally) {
    say(ctx, hero, { k: 'sound', name: 'chargeup' });
    say(ctx, hero, { k: 'burst', at: ch.pos, name: 'up', count: 4 });
    const b = ch.buffs;
    if (b) {
      for (const key of ['haste', 'stamina', 'magicalSight', 'foresight', 'fireImbue', 'frostImbue', 'toxicImbue', 'featherFall', 'wellFed', 'artifactRecharge', 'aquaHealing'] as const) {
        if ((b[key] ?? 0) > 0) b[key] = (b[key] ?? 0) + extension;
      }
    }
    if ((ch.blessed ?? 0) > 0) ch.blessed = ch.blessed! + extension;
    if (isHero(ch)) {
      if ((ch.invisible ?? 0) > 0) ch.invisible += extension;
      if ((ch.recharging ?? 0) > 0) ch.recharging = ch.recharging! + extension;
      if ((ch.levitating ?? 0) > 0) ch.levitating = ch.levitating! + extension;
      if ((ch.mindVision ?? 0) > 0) ch.mindVision += extension;
      if ((ch.barkskin ?? 0) > 0) ch.barkskin += extension;
      if ((ch.cls?.greaterHaste ?? 0) > 0) ch.cls!.greaterHaste! += extension;
      for (const key of ['holyWep', 'holyArm', 'divineSense', 'aura', 'shieldOfLight', 'recall']) if (hasTimer(ch, key)) addTimer(ch, key, extension);
    }
  } else {
    say(ctx, hero, { k: 'sound', name: 'debuff' });
    say(ctx, hero, { k: 'burst', at: ch.pos, name: 'down', count: 4 });
    illuminate(ch);
    const rec = ch as unknown as Record<string, number | undefined>;
    for (const key of ['poison', 'burning', 'bleeding', 'chill', 'ooze', 'blind', 'slowed', 'crippled', 'rooted', 'paralysed', 'hexed', 'vulnerable', 'weakened', 'terror', 'charmed', 'amok']) {
      if ((rec[key] ?? 0) > 0) rec[key] = rec[key]! + extension;
    }
  }
}

/** The Wall of Light stands on the level (it costs nothing to take down). */
export const wallStanding = (world: World, depth: number): boolean => Object.keys(world.levels[depth]?.lightWall ?? {}).length > 0;

function wallOfLight(ctx: Ctx, hero: Hero, target: number): number {
  const level = ctx.level;
  const walls: Record<number, number> = (level.lightWall ??= {});
  if (Object.keys(walls).length > 0) {
    // An early end: the wall comes down, and the spell costs nothing.
    for (const key of Object.keys(walls)) delete walls[Number(key)];
    tell(ctx, hero, 'actors.hero.spells.walloflight.early_end');
    return 0;
  }
  // PathFinder.CIRCLE8, clockwise from the top left.
  const circle = [-WIDTH - 1, -WIDTH, -WIDTH + 1, 1, WIDTH + 1, WIDTH, WIDTH - 1, -1];
  const dist2 = (a: number, b: number): number => (cellX(a) - cellX(b)) ** 2 + (cellY(a) - cellY(b)) ** 2;
  let closest = hero.pos;
  let closestIdx = -1;
  for (let i = 0; i < 8; i++) {
    const c = hero.pos + circle[i]!;
    if (dist2(target, c) < dist2(target, closest)) {
      closest = c;
      closestIdx = i;
    }
  }
  // left x, left y, right x, right y (the left and right of the diagonals are purposefully inverted).
  const dirs: Array<[number, number, number, number]> = [
    [-1, 1, 1, -1], [-1, 0, 1, 0], [1, 1, -1, -1], [0, -1, 0, 1], [1, -1, -1, 1], [1, 0, -1, 0], [-1, -1, 1, 1], [0, -1, 0, 1],
  ];
  const [leftX, leftY, rightX, rightY] = dirs[closestIdx]!;
  const steps = pointsIn(hero, 'wall_of_light');
  const solid = (cell: number): boolean => hasFlag(level.map[cell]!, F.SOLID);
  const spellDefn = spell('wallOfLight');
  // The cost is calculated before the walls are added.
  spellCast(ctx, hero, spellDefn);
  const knock = circle[closestIdx]!;
  const place = (cell: number): void => {
    if (cell < WIDTH || cell >= LENGTH - WIDTH || solid(cell)) return;
    walls[cell] = 20;
    const ch = charAt(ctx.world, ctx.depth, cell);
    if (ch && !isHero(ch) && hostileMob(ch)) {
      const from = ch.pos;
      const to = cell + knock;
      if (to >= 0 && to < LENGTH && adjacent(cell, to) && !solid(to) && !charAt(ctx.world, ctx.depth, to) && hasFlag(level.map[to]!, F.PASSABLE) && !walls[to]) {
        leaveCell(ctx.world, level, ctx.depth, from);
        ch.pos = to;
        enterCell(level, to);
        ctx.effects.push({ type: 'pushed', depth: ctx.depth, mob: ch.id, from, to });
      }
      ch.paralysed = Math.max(ch.paralysed ?? 0, 1);
    }
  };
  place(closest);
  let left = closest;
  let right = closest;
  for (let i = 0; i < steps; i++) {
    if (leftY !== 0) {
      left += leftY * WIDTH;
      if (left < WIDTH || left >= LENGTH - WIDTH) break;
      place(left);
    }
    if (leftX !== 0) {
      left += leftX;
      place(left);
    }
  }
  for (let i = 0; i < steps; i++) {
    if (rightX !== 0) {
      right += rightX;
      place(right);
    }
    if (rightY !== 0) {
      right += rightY * WIDTH;
      if (right < WIDTH || right >= LENGTH - WIDTH) break;
      place(right);
    }
  }
  say(ctx, hero, { k: 'sound', name: 'chargeup' });
  say(ctx, hero, { k: 'strike', at: closest });
  return 1;
}

/** WallOfLight.LightWall.evolve: a turn passes for every cell. */
export function wallTurn(ctx: Ctx): void {
  const walls = ctx.level.lightWall;
  if (!walls) return;
  for (const key of Object.keys(walls).map(Number)) {
    walls[key]!--;
    if (walls[key]! <= 0) delete walls[key];
  }
}

function hallow(ctx: Ctx, hero: Hero, target: number): number {
  const { level, floor } = ctx;
  const reach = pointsIn(hero, 'hallowed_ground');
  // PathFinder.buildDistanceMap(target, not solid, reach).
  const dist = new Map<number, number>([[target, 0]]);
  const queue = [target];
  for (let head = 0; head < queue.length; head++) {
    const at = queue[head]!;
    const d = dist.get(at)!;
    if (d >= reach) continue;
    for (const n of NEIGHBOURS8) {
      const next = at + n;
      if (next < 0 || next >= LENGTH || dist.has(next) || !adjacent(at, next) || hasFlag(level.map[next]!, F.SOLID)) continue;
      dist.set(next, d + 1);
      queue.push(next);
    }
  }
  const ground = (floor.hallowed ??= {});
  const affected: Char[] = [];
  for (const cell of dist.keys()) {
    const t = level.map[cell]!;
    if (t === T.EMPTY || t === T.EMBERS || t === T.EMPTY_DECO) {
      level.map[cell] = T.GRASS;
      ctx.effects.push({ type: 'grown', depth: ctx.depth, pos: cell });
    }
    ground[cell] = 20;
    say(ctx, hero, { k: 'burst', at: cell, name: 'shaft', count: 2 });
    const ch = charAt(ctx.world, ctx.depth, cell);
    if (ch) affected.push(ch);
  }
  const ally = linkedAlly(ctx);
  if (ally) {
    if (affected.includes(hero) && !affected.includes(ally)) affected.push(ally);
    else if (!affected.includes(hero) && affected.includes(ally)) affected.push(hero);
  }
  for (const ch of affected) {
    if (isHero(ch) || ch.ally) {
      if (isHero(ch) || ch.hp === ch.ht) {
        const barrier = Math.min(15, 30 - (ch.shield ?? 0));
        if (barrier > 0) {
          addShield(ch, barrier);
          say(ctx, hero, { k: 'text', at: ch.pos, text: String(barrier), tone: 'p', icon: 'shield' });
        }
      } else {
        const barrier = Math.max(15 - (ch.ht - ch.hp), 0);
        ch.hp += 15 - barrier;
        say(ctx, hero, { k: 'text', at: ch.pos, text: String(15 - barrier), tone: 'p', icon: 'heal' });
        if (barrier > 0) addShield(ch, barrier);
      }
    } else if (!isFlier(ch)) {
      illuminate(ch);
      ch.rooted = Math.max(ch.rooted ?? 0, 2);
    }
  }
  say(ctx, hero, { k: 'sound', name: 'meld' });
  say(ctx, hero, { k: 'strike', at: target });
  spellCast(ctx, hero, spell('hallowedGround'));
  return 1;
}

/** HallowedGround.HallowedTerrain.evolve: for the turns it lasts it greens the floor, and mends or holds whoever stands in it. */
export function hallowedTurn(ctx: Ctx, hero: Hero): void {
  const ground = ctx.floor.hallowed;
  if (!ground) return;
  const chance = 10 + 10 * pointsIn(hero, 'hallowed_ground');
  const affected: Char[] = [];
  for (const key of Object.keys(ground).map(Number).sort((a, b) => a - b)) {
    const t = ctx.level.map[key]!;
    if (t === T.GRASS) {
      if (ctx.rng.int(chance) === 0) {
        ctx.level.map[key] = T.HIGH_GRASS;
        ctx.effects.push({ type: 'grown', depth: ctx.depth, pos: key });
      }
    } else if (t === T.EMPTY || t === T.EMBERS || t === T.EMPTY_DECO) {
      ctx.level.map[key] = T.GRASS;
      ctx.effects.push({ type: 'grown', depth: ctx.depth, pos: key });
    }
    const ch = charAt(ctx.world, ctx.depth, key);
    if (ch) affected.push(ch);
    ground[key]!--;
    if (ground[key]! <= 0) delete ground[key];
  }
  const ally = linkedAlly(ctx);
  if (ally) {
    if (affected.includes(hero) && !affected.includes(ally)) affected.push(ally);
    else if (!affected.includes(hero) && affected.includes(ally)) affected.push(hero);
  }
  for (const ch of affected) {
    if (isHero(ch) || ch.ally) {
      if (isHero(ch) || ch.hp === ch.ht) addShield(ch, 1);
      else ch.hp++;
    } else if (!isFlier(ch) && (ch.rooted ?? 0) <= 0) {
      ch.crippled = Math.max(ch.crippled ?? 0, 1);
    }
  }
}

const cellProblem = (world: World, hero: Hero, cell: number | undefined, flags: number, own: string): string | null =>
  boltTarget(world, hero.depth, hero, cell!, flags).who === hero ? own : null;

export const SPELLS_1_3: SpellDef[] = [
  {
    id: 'guidingLight', tier: 1, aim: 'cell', flags: 'bolt',
    cost: (hero) => (hero.subclass === 'priest' && !hasTimer(hero, 'guidingCd') ? 0 : 1),
    has: () => true,
    problem: (world, hero, action) => cellProblem(world, hero, action.cell, MAGIC_BOLT, SELF),
    cast(ctx, hero, action) {
      const { end, who } = boltTarget(ctx.world, ctx.depth, hero, action.cell!, MAGIC_BOLT);
      say(ctx, hero, { k: 'sound', name: 'zap' });
      say(ctx, hero, { k: 'ray', from: hero.pos, to: end, name: 'light' });
      if (who && !isHero(who)) {
        spellHurt(ctx, hero, who, ctx.rng.normalIntRange(2, 8));
        say(ctx, hero, { k: 'burst', at: who.pos, name: 'lightHit', count: 3 });
        if (isAlive(who)) illuminate(who);
      } else {
        pressCell(ctx, end);
      }
      spellCast(ctx, hero, spell('guidingLight'));
      if (hero.subclass === 'priest' && !hasTimer(hero, 'guidingCd')) setTimer(hero, 'guidingCd', 50);
      return 1;
    },
  },
  {
    id: 'holyWeapon', tier: 1, aim: 'none', cost: () => 2, has: () => true,
    cast(ctx, hero) {
      addTimer(hero, 'holyWep', 50);
      say(ctx, hero, { k: 'sound', name: 'read' });
      say(ctx, hero, { k: 'operate' });
      say(ctx, hero, { k: 'spell', at: hero.pos, name: 'enchant' });
      spellCast(ctx, hero, spell('holyWeapon'));
      return 1;
    },
  },
  {
    id: 'holyWard', tier: 1, aim: 'none', cost: () => 1, has: () => true,
    cast(ctx, hero) {
      addTimer(hero, 'holyArm', 50);
      say(ctx, hero, { k: 'sound', name: 'read' });
      say(ctx, hero, { k: 'operate' });
      say(ctx, hero, { k: 'spell', at: hero.pos, name: 'enchant' });
      spellCast(ctx, hero, spell('holyWard'));
      return 1;
    },
  },
  {
    id: 'holyIntuition', tier: 1, aim: 'item', cost: (hero) => 4 - pointsIn(hero, 'holy_intuition'), has: (hero) => hasTalent(hero, 'holy_intuition'),
    problem(_world, hero, action) {
      const item = action.item !== undefined ? hero.items[action.item] : undefined;
      return item && usableForIntuition(item) ? null : 'choose an item';
    },
    cast(ctx, hero, action) {
      const item = hero.items[action.item!]!;
      delete item.curseUnknown;
      tell(ctx, hero, item.cursed ? 'actors.hero.spells.holyintuition.cursed' : 'actors.hero.spells.holyintuition.uncursed', item.cursed ? 'w' : 'i');
      say(ctx, hero, { k: 'operate' });
      say(ctx, hero, { k: 'spell', at: hero.pos, name: 'identify' });
      say(ctx, hero, { k: 'sound', name: 'read' });
      spellCast(ctx, hero, spell('holyIntuition'));
      return 1;
    },
  },
  {
    id: 'shieldOfLight', tier: 1, aim: 'cell', flags: 'stop', cost: () => 1, has: (hero) => hasTalent(hero, 'shield_of_light'),
    problem(world, hero, action) {
      const ch = charAt(world, hero.depth, action.cell!);
      return !ch || isHero(ch) || ch.ally || !fovOf(world, hero)[action.cell!] ? `${MSG}shieldoflight.no_target` : null;
    },
    cast(ctx, hero, action) {
      const ch = charAt(ctx.world, ctx.depth, action.cell!) as Mob;
      say(ctx, hero, { k: 'sound', name: 'read' });
      say(ctx, hero, { k: 'operate' });
      // 1 turn less as the casting is instant.
      prolong(hero, 'shieldOfLight', 4);
      cs(hero).lightFoe = ch.id;
      if (hero.subclass === 'priest') illuminate(ch);
      say(ctx, hero, { k: 'burst', at: hero.pos, name: 'light', count: 6 });
      const ally = linkedAlly(ctx);
      if (ally) {
        prolongMark(ally, 'shieldOfLight', 3);
        marks(ally).lightFoe = ch.id;
      }
      spellCast(ctx, hero, spell('shieldOfLight'));
      return 1;
    },
  },
  {
    id: 'recallInscription', tier: 2, aim: 'none', has: (hero) => hasTalent(hero, 'recall_inscription') && hasTimer(hero, 'recall') && cs(hero).recall !== undefined,
    cost: (hero) => recallCost(hero),
    problem(_world, hero, action) {
      const kind = cs(hero).recall;
      if (!kind) return 'no such spell';
      if (isStone(kind) && !INVENTORY_STONES.has(kind)) return action.cell !== undefined && Number.isInteger(action.cell) ? null : 'choose a target';
      if (INVENTORY_STONES.has(kind) || isTargetedScroll(kind)) return action.item !== undefined && hero.items[action.item] ? null : 'choose an item';
      return null;
    },
    cast(ctx, hero, action) {
      const kind = cs(hero).recall!;
      say(ctx, hero, { k: 'operate' });
      say(ctx, hero, { k: 'spell', at: hero.pos, name: 'enchant' });
      if (isStone(kind)) {
        if (INVENTORY_STONES.has(kind)) useStone(ctx, hero, kind, hero.items[action.item!]!, action.choice);
        else activateStone(ctx, hero, kind, action.cell!);
      } else {
        readScroll(ctx, hero, kind, action.item !== undefined ? hero.items[action.item] : undefined, { cell: action.cell, choice: action.choice });
      }
      // The spell is paid for at the price the used item set.
      spellCast(ctx, hero, spell('recallInscription'));
      clearTimer(hero, 'recall');
      delete cs(hero).recall;
      return 1;
    },
  },
  {
    id: 'sunray', tier: 2, aim: 'cell', flags: 'bolt', cost: () => 1, has: (hero) => hasTalent(hero, 'sunray'),
    problem: (world, hero, action) => cellProblem(world, hero, action.cell, MAGIC_BOLT, SELF),
    cast(ctx, hero, action) {
      const { end, who } = boltTarget(ctx.world, ctx.depth, hero, action.cell!, MAGIC_BOLT);
      const points = pointsIn(hero, 'sunray');
      say(ctx, hero, { k: 'sound', name: 'ray' });
      say(ctx, hero, { k: 'ray', from: hero.pos, to: end, name: 'sun' });
      if (who && !isHero(who)) {
        say(ctx, hero, { k: 'burst', at: who.pos, name: 'lightHit', count: 5 });
        const unholy = isUndead(who) || isDemonic(who);
        const [min, max] = points === 2 ? [6, 12] : [4, 8];
        spellHurt(ctx, hero, who, unholy ? max : ctx.rng.normalIntRange(min, max));
        if (isAlive(who)) {
          const dur = 2 + 2 * points;
          const m = marks(who);
          if ((who.blind ?? 0) > 0 && markTurns(who, 'sunRecent') > 0) {
            who.paralysed = Math.max(who.paralysed ?? 0, dur);
            delete m.t!.sunRecent;
          } else if (!m.sunUsed) {
            who.blind = Math.max(who.blind ?? 0, dur);
            prolongMark(who, 'sunRecent', dur);
            m.sunUsed = true;
          }
          if (hero.subclass === 'priest') illuminate(who);
        }
      }
      spellCast(ctx, hero, spell('sunray'));
      return 1;
    },
  },
  {
    id: 'divineSense', tier: 2, aim: 'none', cost: () => 2, has: (hero) => hasTalent(hero, 'divine_sense'),
    cast(ctx, hero) {
      prolong(hero, 'divineSense', 50);
      say(ctx, hero, { k: 'sound', name: 'read' });
      say(ctx, hero, { k: 'spell', at: hero.pos, name: 'vision' });
      say(ctx, hero, { k: 'operate' });
      const ally = linkedAlly(ctx);
      if (ally) prolongMark(ally, 'divineSense', 50);
      spellCast(ctx, hero, spell('divineSense'));
      return 0;
    },
  },
  {
    id: 'bless', tier: 2, aim: 'cell', flags: 'free', cost: () => 1, has: (hero) => hasTalent(hero, 'bless'),
    problem: (world, hero, action) => (!charAt(world, hero.depth, action.cell!) || !fovOf(world, hero)[action.cell!] ? `${MSG}blessspell.no_target` : null),
    cast(ctx, hero, action) {
      const ch = charAt(ctx.world, ctx.depth, action.cell!)!;
      say(ctx, hero, { k: 'sound', name: 'teleport' });
      blessChar(ctx, hero, ch);
      if (ch === hero) say(ctx, hero, { k: 'operate' });
      else say(ctx, hero, { k: 'strike', at: ch.pos });
      const ally = linkedAlly(ctx);
      if (ally) {
        if (ch === hero) blessChar(ctx, hero, ally);
        else if (ally === ch) blessChar(ctx, hero, hero);
      }
      spellCast(ctx, hero, spell('bless'));
      return 1;
    },
  },
  {
    id: 'cleanse', tier: 3, aim: 'none', cost: () => 2, has: (hero) => hasTalent(hero, 'cleanse'),
    cast(ctx, hero) {
      const points = pointsIn(hero, 'cleanse');
      const seen = heroView(ctx.world, hero);
      const affected: Char[] = [hero, ...ctx.floor.mobs.filter((m) => m.ally && isAlive(m) && seen[m.pos])];
      const ally = linkedAlly(ctx);
      if (ally && !affected.includes(ally)) affected.push(ally);
      for (const ch of affected) {
        shedNegatives(ch);
        // 0, 2 or 4 turns where nothing harmful takes hold (one fewer than shown: the spell is instant).
        if (points > 1) {
          const b = (ch.buffs ??= {});
          b.cleanse = Math.max(b.cleanse ?? 0, 2 * (points - 1));
        }
        shieldTo(ch, 10 * points);
        say(ctx, hero, { k: 'spell', at: ch.pos, name: 'flarePink' });
      }
      say(ctx, hero, { k: 'operate' });
      say(ctx, hero, { k: 'sound', name: 'read' });
      spellCast(ctx, hero, spell('cleanse'));
      return 1;
    },
  },
  {
    id: 'radiance', tier: 3, aim: 'none', cost: () => 2, has: (hero) => hero.subclass === 'priest',
    cast(ctx, hero) {
      say(ctx, hero, { k: 'flash', color: 0x80ffffff });
      say(ctx, hero, { k: 'sound', name: 'blast' });
      // Level.viewDistance < 6: a light for a hundred turns (twenty in the dark).
      if (ctx.depth >= 22) hero.light = Math.max(hero.light, 100);
      const seen = heroView(ctx.world, hero);
      for (const mob of [...ctx.floor.mobs]) {
        if (mob.ally || !seen[mob.pos] || !isAlive(mob)) continue;
        if (marks(mob).lit) {
          delete marks(mob).lit;
          spellHurt(ctx, hero, mob, hero.lvl + 5);
        } else {
          illuminate(mob);
        }
        if (isAlive(mob) && mob.state !== 'passive' && mob.state !== 'sleeping') mob.paralysed = Math.max(mob.paralysed ?? 0, 3);
      }
      say(ctx, hero, { k: 'operate' });
      spellCast(ctx, hero, spell('radiance'));
      return 1;
    },
  },
  {
    id: 'smite', tier: 3, aim: 'cell', flags: 'stop', cost: () => 2, has: (hero) => hero.subclass === 'paladin',
    problem(world, hero, action) {
      const foe = charAt(world, hero.depth, action.cell!);
      if (!foe || foe === hero) return `${MSG}smite.no_target`;
      if (isHero(foe) || !hostileMob(foe) || (hero.charmed > 0 && hero.charmedBy === foe.id) || !fovOf(world, hero)[action.cell!]) return `${MSG}smite.invalid_enemy`;
      const reach = hero.weapon ? 1 + (hero.weapon.enchant === 'projecting' ? 1 : 0) : 1;
      return adjacent(hero.pos, foe.pos) || distance(hero.pos, foe.pos) <= reach ? null : `${MSG}smite.invalid_enemy`;
    },
    cast(ctx, hero, action) {
      const foe = charAt(ctx.world, ctx.depth, action.cell!) as Mob;
      // Applied here because of projecting: the enchantment of the blow is three times as likely.
      setTimer(hero, 'smite', 1e9);
      say(ctx, hero, { k: 'strike', at: foe.pos });
      const weapon = hero.weapon;
      const light = !weapon || itemDef(weapon.kind).category !== 'weapon' || meleeStr(weapon) <= hero.str;
      if (attack(ctx, hero, foe, { accMulti: light ? Infinity : 1 })) {
        say(ctx, hero, { k: 'strong', at: foe.pos });
        say(ctx, hero, { k: 'burst', at: foe.pos, name: 'white', count: 10 });
      }
      clearTimer(hero, 'smite');
      dispelInvisibility(ctx, hero);
      spellCast(ctx, hero, spell('smite'));
      return heroAttackDelay(hero);
    },
  },
  {
    id: 'layOnHands', tier: 3, aim: 'cell', flags: 'free', cost: () => 1, has: (hero) => hasTalent(hero, 'lay_on_hands'),
    problem(world, hero, action) {
      if (distance(hero.pos, action.cell!) > 1) return `${MSG}layonhands.invalid_target`;
      return charAt(world, hero.depth, action.cell!) ? null : `${MSG}layonhands.no_target`;
    },
    cast(ctx, hero, action) {
      const ch = charAt(ctx.world, ctx.depth, action.cell!)!;
      say(ctx, hero, { k: 'sound', name: 'teleport' });
      layHands(ctx, hero, ch);
      if (ch === hero) say(ctx, hero, { k: 'operate' });
      else say(ctx, hero, { k: 'strike', at: ch.pos });
      const ally = linkedAlly(ctx);
      if (ally) {
        if (ch === hero) layHands(ctx, hero, ally);
        else if (ally === ch) layHands(ctx, hero, hero);
      }
      spellCast(ctx, hero, spell('layOnHands'));
      return 0;
    },
  },
  {
    id: 'auraOfProtection', tier: 3, aim: 'none', cost: () => 2, has: (hero) => hasTalent(hero, 'aura_of_protection'),
    cast(ctx, hero) {
      setTimer(hero, 'aura', 20);
      say(ctx, hero, { k: 'sound', name: 'read' });
      say(ctx, hero, { k: 'operate' });
      spellCast(ctx, hero, spell('auraOfProtection'));
      return 1;
    },
  },
  {
    id: 'wallOfLight', tier: 3, aim: 'cell', flags: 'free', cost: (_hero, world) => (wallStanding(world, _hero.depth) ? 0 : 3), has: (hero) => hasTalent(hero, 'wall_of_light'),
    problem(world, hero, action) {
      if (wallStanding(world, hero.depth)) return null;
      if (action.cell === hero.pos) return `${MSG}walloflight.invalid_target`;
      // If all three tiles in front of her are blocked, the cast was made in error.
      const level = world.levels[hero.depth]!;
      const circle = [-WIDTH - 1, -WIDTH, -WIDTH + 1, 1, WIDTH + 1, WIDTH, WIDTH - 1, -1];
      const d2 = (a: number, b: number): number => (cellX(a) - cellX(b)) ** 2 + (cellY(a) - cellY(b)) ** 2;
      let idx = -1;
      let best = hero.pos;
      for (let i = 0; i < 8; i++) {
        if (d2(action.cell!, hero.pos + circle[i]!) < d2(action.cell!, best)) {
          best = hero.pos + circle[i]!;
          idx = i;
        }
      }
      const solid = (c: number): boolean => hasFlag(level.map[c]!, F.SOLID);
      return idx >= 0 && solid(best) && solid(hero.pos + circle[(idx + 1) % 8]!) && solid(hero.pos + circle[(idx + 7) % 8]!) ? `${MSG}walloflight.invalid_target` : null;
    },
    cast: (ctx, hero, action) => wallOfLight(ctx, hero, action.cell!),
  },
  {
    id: 'holyLance', tier: 3, aim: 'cell', flags: 'projectile', cost: () => 4, has: (hero) => hasTalent(hero, 'holy_lance') && !hasTimer(hero, 'lance'),
    problem: (world, hero, action) => cellProblem(world, hero, action.cell, PROJECTILE, SELF),
    cast(ctx, hero, action) {
      const { end, who } = boltTarget(ctx.world, ctx.depth, hero, action.cell!, PROJECTILE);
      const points = pointsIn(hero, 'holy_lance');
      say(ctx, hero, { k: 'sound', name: 'zap' });
      say(ctx, hero, { k: 'ray', from: hero.pos, to: end, name: 'lance' });
      if (who && !isHero(who)) {
        let min = 15 + 15 * points;
        const max = Math.round(27.5 + 27.5 * points);
        if (isUndead(who) || isDemonic(who)) min = max;
        spellHurt(ctx, hero, who, ctx.rng.normalIntRange(min, max));
        if (isAlive(who)) illuminate(who);
        say(ctx, hero, { k: 'burst', at: who.pos, name: 'white', count: 10 });
      } else {
        pressCell(ctx, end);
        say(ctx, hero, { k: 'burst', at: end, name: 'white', count: 10 });
      }
      spellCast(ctx, hero, spell('holyLance'));
      setTimer(hero, 'lance', 30);
      return 1;
    },
  },
  {
    id: 'hallowedGround', tier: 3, aim: 'cell', flags: 'stop', cost: () => 2, has: (hero) => hasTalent(hero, 'hallowed_ground'),
    problem(world, hero, action) {
      const level = world.levels[hero.depth]!;
      return hasFlag(level.map[action.cell!]!, F.SOLID) || !fovOf(world, hero)[action.cell!] ? `${MSG}hallowedground.invalid_target` : null;
    },
    cast: (ctx, hero, action) => hallow(ctx, hero, action.cell!),
  },
  {
    id: 'mnemonicPrayer', tier: 3, aim: 'cell', flags: 'stop', cost: () => 1, has: (hero) => hasTalent(hero, 'mnemonic_prayer'),
    problem: (world, hero, action) => (!charAt(world, hero.depth, action.cell!) || !fovOf(world, hero)[action.cell!] ? `${MSG}mnemonicprayer.no_target` : null),
    cast(ctx, hero, action) {
      const ch = charAt(ctx.world, ctx.depth, action.cell!)!;
      const extension = 2 + pointsIn(hero, 'mnemonic_prayer');
      mnemonic(ctx, hero, ch, extension);
      const ally = linkedAlly(ctx);
      if (ally) {
        if (ch === hero) mnemonic(ctx, hero, ally, extension);
        else if (ch === ally) mnemonic(ctx, hero, hero, extension);
      }
      if (ch === hero) say(ctx, hero, { k: 'operate' });
      else say(ctx, hero, { k: 'strike', at: ch.pos });
      spellCast(ctx, hero, spell('mnemonicPrayer'));
      return ch === hero ? 1 : 0;
    },
  },
];
