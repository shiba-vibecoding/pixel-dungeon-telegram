import { type Hero, isAlive, type Mob } from '../actors';
import { ballistica, STOP_TARGET } from '../ballistica';
import { charAt, type Char, type Ctx, enterCell, exploredCells, heroView, isHero, leaveCell } from '../floor';
import { appear, teleportToLocation } from '../reading';
import { distance, LENGTH, NEIGHBOURS8 } from '../level/geometry';
import { F, hasFlag } from '../level/terrain';
import { canEnter } from '../floor';
import { hasTalent, pointsInTalent as pointsIn } from '../talents';
import { isEnemy } from '../enchant';
import { say, tell } from './common';
import {
  boltTarget, type CastAction, illuminate, linkedAlly, MSG, SELF, shieldTo, spellCast, spellDef, type SpellDef, spellHurt,
} from './cleric-core';
import { clearTimer, cs, hasTimer, markTurns, marks, prolong, prolongMark, setTimer } from './state';
import { poweredAlly, stasisAlly } from './cleric-allies';
import { bodyProblem, chooseForm, mindProblem, spiritProblem } from './trinity';

/*
 * The Cleric's fourth tier: the spells her armour abilities open — Ascended Form's divine intervention, judgement and flash;
 * Power of Many's beaming ray, life link and stasis; Trinity's body, mind and spirit forms (trinity.ts).
 */

/** Ascended form's state (AscendedForm.AscendBuff). */
export interface Ascend {
  left: number;
  shield: number;
  spellCasts: number;
  flashCasts: number;
  divine: boolean;
}

export const ascendedOf = (hero: Hero): Ascend | undefined => hero.cls?.ascend;
const spell = (id: string): SpellDef => spellDef(id)!;

/** AscendBuff.DURATION. */
export const ASCEND_TURNS = 10;

/** Whether a creature is an enemy in the hero's sight. */
const foeInSight = (ctx: Ctx, hero: Hero, ch: Mob): boolean => !ch.ally && isAlive(ch) && ch.state !== 'passive' && heroView(ctx.world, hero)[ch.pos] === true;

export const T4_SPELLS: SpellDef[] = [
  {
    id: 'divineIntervention', tier: 4, aim: 'none', cost: () => 5,
    has: (hero) => hasTalent(hero, 'divineIntervention') && ascendedOf(hero) !== undefined && !ascendedOf(hero)!.divine,
    cast(ctx, hero) {
      const points = pointsIn(hero, 'divineIntervention');
      say(ctx, hero, { k: 'sound', name: 'chargeup' });
      say(ctx, hero, { k: 'operate' });
      for (const ally of ctx.floor.mobs) {
        if (ally.ally && isAlive(ally)) {
          marks(ally).divine = Math.max(Number(marks(ally).divine ?? 0), 100 + 50 * points);
          say(ctx, hero, { k: 'spell', at: ally.pos, name: 'flareYellow' });
        }
      }
      spellCast(ctx, hero, spell('divineIntervention'));
      // Applied here so that the five charges' shielding and this one do not stack.
      const ascend = ascendedOf(hero)!;
      ascend.shield = Math.max(ascend.shield, 100 + 50 * points);
      say(ctx, hero, { k: 'spell', at: hero.pos, name: 'flareYellow' });
      ascend.divine = true;
      ascend.left += 2 + points;
      return 1;
    },
  },
  {
    id: 'judgement', tier: 4, aim: 'none', cost: () => 3,
    has: (hero) => hasTalent(hero, 'judgement') && ascendedOf(hero) !== undefined,
    cast(ctx, hero) {
      const ascend = ascendedOf(hero)!;
      say(ctx, hero, { k: 'strike', at: hero.pos });
      say(ctx, hero, { k: 'flash', color: 0x80ffffff });
      say(ctx, hero, { k: 'sound', name: 'blast' });
      let base = 5 + 5 * pointsIn(hero, 'judgement');
      base += Math.round((base * ascend.spellCasts) / 3);
      for (const mob of [...ctx.floor.mobs]) {
        if (foeInSight(ctx, hero, mob)) {
          spellHurt(ctx, hero, mob, ctx.rng.normalIntRange(base, 2 * base));
          if (hero.subclass === 'priest' && isAlive(mob)) illuminate(mob);
        }
      }
      spellCast(ctx, hero, spell('judgement'));
      ascend.spellCasts = 0;
      return 1;
    },
  },
  {
    id: 'flash', tier: 4, aim: 'cell', flags: 'free',
    cost: (hero) => 2 + (ascendedOf(hero)?.flashCasts ?? 0),
    has: (hero) => hasTalent(hero, 'flash') && ascendedOf(hero) !== undefined,
    problem(world, hero, action) {
      const level = world.levels[hero.depth]!;
      const cell = action.cell!;
      const known = exploredCells(world, hero.depth)[cell] === true;
      return hasFlag(level.map[cell]!, F.SOLID) || !known || distance(hero.pos, cell) > 2 + pointsIn(hero, 'flash') ? `${MSG}flash.invalid_target` : null;
    },
    cast(ctx, hero, action) {
      if (!teleportToLocation(ctx, hero, action.cell!)) return 0;
      spellCast(ctx, hero, spell('flash'));
      ascendedOf(hero)!.flashCasts++;
      return 1;
    },
  },
  {
    id: 'bodyForm', tier: 4, aim: 'choice', cost: () => 2, has: (hero) => hasTalent(hero, 'bodyForm'),
    problem: (world, hero, action) => bodyProblem(world, hero, action.choice),
    cast(ctx, hero, action) {
      chooseForm(ctx, hero, 'body', action.choice!);
      spellCast(ctx, hero, spell('bodyForm'));
      return 1;
    },
  },
  {
    id: 'mindForm', tier: 4, aim: 'choice', cost: () => 3, has: (hero) => hasTalent(hero, 'mindForm'),
    problem: (world, hero, action) => mindProblem(world, hero, action.choice),
    cast(ctx, hero, action) {
      chooseForm(ctx, hero, 'mind', action.choice!);
      spellCast(ctx, hero, spell('mindForm'));
      return 1;
    },
  },
  {
    id: 'spiritForm', tier: 4, aim: 'choice', cost: () => 4, has: (hero) => hasTalent(hero, 'spiritForm'),
    problem: (world, hero, action) => spiritProblem(world, hero, action.choice),
    cast(ctx, hero, action) {
      chooseForm(ctx, hero, 'spirit', action.choice!);
      spellCast(ctx, hero, spell('spiritForm'));
      return 1;
    },
  },
  {
    id: 'beamingRay', tier: 4, aim: 'cell', flags: 'stop', cost: () => 1,
    has: (hero, world) => hasTalent(hero, 'beamingRay') && (poweredAlly({ floor: world.floors[hero.depth]! }) !== undefined || stasisAlly(hero) !== undefined),
    problem(world, hero, action) {
      const cell = action.cell!;
      const floor = world.floors[hero.depth]!;
      const level = world.levels[hero.depth]!;
      let ally: Char | undefined = poweredAlly({ floor });
      const stasis = stasisAlly(hero);
      if (!ally) ally = hero;
      const fov = heroView(world, hero);
      let tele = cell;
      if (hasFlag(level.map[tele]!, F.SOLID) || !fov[tele] || charAt(world, hero.depth, tele)) {
        tele = findBeamSpot(world, hero, cell, ally);
      }
      if (tele === -1) return `${MSG}beamingray.no_space`;
      const mover = ally === hero ? stasis : ally;
      if (!mover) return `${MSG}beamingray.no_space`;
      let range = 4 * pointsIn(hero, 'beamingRay');
      if (!isHero(mover) && ['yog', 'shopkeeper', 'wandmaker', 'blacksmith', 'imp', 'ghost', 'ratKing'].includes(mover.kind)) range = Math.trunc(range / 2);
      return distance(mover.pos, tele) > range ? `${MSG}beamingray.out_of_range` : null;
    },
    cast(ctx, hero, action) {
      const { world, level } = ctx;
      const cell = action.cell!;
      let ally: Mob | Hero | undefined = poweredAlly(ctx);
      const fov = heroView(world, hero);
      if (!ally) ally = hero;
      let tele = cell;
      if (hasFlag(level.map[tele]!, F.SOLID) || !fov[tele] || charAt(world, ctx.depth, tele)) tele = findBeamSpot(world, hero, cell, ally);
      let chTarget: Mob | undefined;
      const there = charAt(world, ctx.depth, cell);
      if (there && !isHero(there) && isEnemy(there)) {
        chTarget = there;
        if (hero.subclass === 'priest') illuminate(there);
      }
      let mover: Mob;
      if (ally === hero) {
        // Out of stasis: the held ally comes back where the beam lands.
        mover = stasisAlly(hero)!;
        mover.pos = tele;
        ctx.floor.mobs.push(mover);
        enterCell(level, tele);
        delete cs(hero).stasis;
        clearTimer(hero, 'stasis');
        say(ctx, hero, { k: 'ray', from: hero.pos, to: tele, name: 'sun' });
        const link = marks(mover).linkLeft;
        if (typeof link === 'number' && link > 0) {
          setTimer(hero, 'lifeLink', link);
          cs(hero).linkObject = mover.id;
        }
      } else {
        mover = ally as Mob;
        say(ctx, hero, { k: 'ray', from: mover.pos, to: tele, name: 'sun' });
        appear(ctx, mover, tele);
      }
      say(ctx, hero, { k: 'sound', name: 'ray' });
      say(ctx, hero, { k: 'strike', at: tele });
      if (!chTarget) {
        for (const ch of ctx.floor.mobs) {
          if (isEnemy(ch) && isAlive(ch) && distance(ch.pos, tele) <= 4) {
            if (!chTarget || trueDist2(chTarget.pos, mover.pos) < trueDist2(ch.pos, mover.pos)) chTarget = ch;
          }
        }
      }
      if (chTarget) {
        mover.enemy = chTarget.id;
        if (mover.state !== 'passive') mover.state = 'hunting';
        marks(mover).beamObject = chTarget.id;
      } else if (mover.directed) {
        mover.directed.defend = -1;
      }
      prolongMark(mover, 'beam', 10);
      spellCast(ctx, hero, spell('beamingRay'));
      return 1;
    },
  },
  {
    id: 'lifeLink', tier: 4, aim: 'none', cost: () => 2,
    has: (hero, world) => hasTalent(hero, 'lifeLink') && (poweredAlly({ floor: world.floors[hero.depth]! }) !== undefined || stasisAlly(hero) !== undefined),
    cast(ctx, hero) {
      const duration = Math.round(6.67 + 3.33 * pointsIn(hero, 'lifeLink'));
      let ally: Mob | undefined = poweredAlly(ctx);
      if (ally) {
        say(ctx, hero, { k: 'strike', at: ally.pos });
        say(ctx, hero, { k: 'ray', from: hero.pos, to: ally.pos, name: 'health' });
        say(ctx, hero, { k: 'sound', name: 'ray' });
        prolong(hero, 'lifeLink', duration);
        cs(hero).linkObject = ally.id;
      } else {
        ally = stasisAlly(hero)!;
        say(ctx, hero, { k: 'operate' });
        say(ctx, hero, { k: 'ray', from: hero.pos, to: hero.pos, name: 'health' });
        say(ctx, hero, { k: 'sound', name: 'ray' });
      }
      prolongMark(ally, 'lifeLink', duration);
      prolongMark(ally, 'lifeLinkSpell', duration);
      marks(ally).linkObject = hero.id;
      if (!ally.pos && ally.pos !== 0) marks(ally).linkLeft = duration;
      if (stasisAlly(hero) === ally) marks(ally).linkLeft = duration;
      spellCast(ctx, hero, spell('lifeLink'));
      return 1;
    },
  },
  {
    id: 'stasis', tier: 4, aim: 'none', cost: (hero) => (hasTimer(hero, 'stasis') ? 0 : 2),
    has: (hero, world) => hasTalent(hero, 'stasis') && (poweredAlly({ floor: world.floors[hero.depth]! }) !== undefined || hasTimer(hero, 'stasis')),
    cast(ctx, hero) {
      spellCast(ctx, hero, spell('stasis'));
      if (hasTimer(hero, 'stasis')) {
        // Calling the ally back at once.
        say(ctx, hero, { k: 'operate' });
        releaseStasis(ctx, hero);
        return 0;
      }
      const ally = poweredAlly(ctx)!;
      say(ctx, hero, { k: 'strike', at: ally.pos });
      say(ctx, hero, { k: 'ray', from: ally.pos, to: hero.pos, name: 'light' });
      ctx.floor.mobs.splice(ctx.floor.mobs.indexOf(ally), 1);
      leaveCell(ctx.world, ctx.level, ctx.depth, ally.pos);
      ctx.effects.push({ type: 'faded', depth: ctx.depth, mob: ally.id, pos: ally.pos });
      cs(hero).stasis = { ally };
      setTimer(hero, 'stasis', 30 + 30 * pointsIn(hero, 'stasis'));
      say(ctx, hero, { k: 'sound', name: 'teleport' });
      if (hasTimer(hero, 'lifeLink') && cs(hero).linkObject === ally.id) {
        clearTimer(hero, 'lifeLink');
        delete cs(hero).linkObject;
      }
      return 1;
    },
  },
];

const trueDist2 = (a: number, b: number): number => ((a % 48) - (b % 48)) ** 2 + (Math.trunc(a / 48) - Math.trunc(b / 48)) ** 2;

/** BeamingRay: the free, seen cell next to the target nearest the ally. */
function findBeamSpot(world: Parameters<typeof heroView>[0], hero: Hero, target: number, ally: Char): number {
  const level = world.levels[hero.depth]!;
  const fov = heroView(world, hero);
  let spot = -1;
  for (const n of NEIGHBOURS8) {
    const c = target + n;
    if (c < 0 || c >= LENGTH) continue;
    if (!charAt(world, hero.depth, c) && fov[c] && canEnter(level, c)) {
      if (spot === -1 || trueDist2(spot, ally.pos) > trueDist2(c, ally.pos)) spot = c;
    }
  }
  return spot;
}

/** Stasis.StasisBuff.act: the ally comes back at a free cell by the hero. */
export function releaseStasis(ctx: Ctx, hero: Hero): void {
  const held = cs(hero).stasis?.ally;
  if (!held) return;
  const free = NEIGHBOURS8.map((n) => hero.pos + n).filter((c) => c >= 0 && c < LENGTH && !charAt(ctx.world, ctx.depth, c) && canEnter(ctx.level, c));
  const pos = free.length > 0 ? ctx.rng.element(free)! : hero.pos + NEIGHBOURS8[ctx.rng.int(8)]!;
  held.pos = pos;
  ctx.floor.mobs.push(held);
  enterCell(ctx.level, pos);
  if (held.directed) held.directed.defend = -1;
  const link = marks(held).linkLeft;
  if (typeof link === 'number' && (held.marks?.t?.lifeLink ?? 0) > 0) {
    setTimer(hero, 'lifeLink', held.marks!.t!.lifeLink!);
    cs(hero).linkObject = held.id;
  }
  ctx.effects.push({ type: 'jumped', depth: ctx.depth, mob: held.id, from: pos, to: pos });
  say(ctx, hero, { k: 'sound', name: 'teleport' });
  delete cs(hero).stasis;
  clearTimer(hero, 'stasis');
}

/** Stasis.StasisBuff.detach by running out: the ally returns on its own. */
export function stasisTurn(ctx: Ctx, hero: Hero): void {
  if (cs(hero).stasis && !hasTimer(hero, 'stasis')) releaseStasis(ctx, hero);
}

/* Ascended form */

/** AscendedForm.activate. */
export function ascend(ctx: Ctx, hero: Hero): void {
  cs(hero).ascend = { left: ASCEND_TURNS, shield: 30, spellCasts: 0, flashCasts: 0, divine: false };
}

/** AscendBuff.act, a turn's worth. */
export function ascendTurn(ctx: Ctx, hero: Hero): void {
  const a = hero.cls?.ascend;
  if (!a) return;
  a.left--;
  if (a.left <= 0) {
    delete hero.cls!.ascend;
    for (const ally of ctx.floor.mobs) if (ally.marks) delete ally.marks.divine;
  }
}

export { tell, SELF, STOP_TARGET, ballistica, markTurns, boltTarget, shieldTo };
export type { CastAction };
