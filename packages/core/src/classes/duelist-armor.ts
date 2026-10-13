import { ipow } from '../fmath';
import { createMob, type Hero, heroAttackDelay, isAlive, type Mob } from '../actors';
import { type Ballistica, ballistica, cone, STOP_SOLID, STOP_TARGET, WONT_STOP, MAGIC_BOLT } from '../ballistica';
import { chillChar, igniteChar, setShield } from '../buffs';
import { attack, drRoll, hurt, lootAndExp } from '../combat';
import { conjuredBomb, cursedZap } from '../cursed';
import { beyond, press, teleportChar, throwChar, trajectory } from '../displace';
import { dispelInvisibility } from '../artifacts';
import { bleedImmune, enchantProc, isEnemy, luckyDrop, procMultiplier } from '../enchant';
import { charAt, type Char, type Ctx, enterCell, heroView, isHero, isWater, leaveCell } from '../floor';
import { destroyCell, seedGas, setCellToWater } from '../gas';
import { corruptionHeal } from '../allies';
import { adjacent, cellX, cellY, distance, LENGTH, NEIGHBOURS8 } from '../level/geometry';
import { canEnter } from '../floor';
import { F, hasFlag, T } from '../level/terrain';
import { hasProp, isImmune } from '../props';
import { pointsIn } from '../talents';
import { weaponProc } from '../enchant';
import { heroDamageRoll } from '../actors';
import type { World } from '../world';
import { spendArmorCharge, abilityDef, chargeUse } from './abilities';
import { clearMark, clearTimer, cs, hasTimer, marks, prolongMark, setTimer } from './state';

/*
 * The Duelist's armour abilities: Challenge (a duel with one foe while the rest look on), Elemental Strike (a cone of
 * the weapon's enchantment) and Feint (a step aside, leaving a decoy). Their talents are tier 4.
 */

const MSG = 'art:actors.hero.abilities.duelist.';
const fx = (ctx: Ctx, hero: Hero, f: import('./fx').ClassFx): void => {
  ctx.effects.push({ type: 'classFx', depth: ctx.depth, hero: hero.id, fx: f });
};

const hostile = (mob: Mob): boolean => isAlive(mob) && !mob.ally && mob.state !== 'passive';
const foeAt = (world: World, hero: Hero, cell: number): Mob | null => {
  const there = cell >= 0 && cell < LENGTH ? charAt(world, hero.depth, cell) : undefined;
  return there && !isHero(there) && hostile(there) ? there : null;
};
const trueDistance2 = (a: number, b: number): number => (cellX(a) - cellX(b)) ** 2 + (cellY(a) - cellY(b)) ** 2;

/** Mob.aggro. */
function aggro(mob: Mob, id: string): void {
  mob.enemy = id;
  if (mob.state !== 'passive') mob.state = 'hunting';
}

/* Challenge */

export const eliminationActive = (hero: Hero): boolean => hasTimer(hero, 'elimination');

/** BFS over open ground (passable or to be avoided), from a cell, to a limit: cell → steps. `blocked` cells are not entered. */
function distances(world: World, hero: Hero, from: number, blocked: ReadonlySet<number>, limit = Infinity): Map<number, number> {
  const level = world.levels[hero.depth]!;
  const dist = new Map<number, number>([[from, 0]]);
  const queue = [from];
  for (let head = 0; head < queue.length; head++) {
    const at = queue[head]!;
    const d = dist.get(at)!;
    if (d >= limit) continue;
    for (const n of NEIGHBOURS8) {
      const next = at + n;
      if (next < 0 || next >= LENGTH || dist.has(next) || !adjacent(at, next) || blocked.has(next)) continue;
      const t = level.map[next]!;
      if (!hasFlag(t, F.PASSABLE) && !hasFlag(t, F.AVOID)) continue;
      dist.set(next, d + 1);
      queue.push(next);
    }
  }
  return dist;
}

/** Where the hero stands for the duel: close the gap blinks her up to 1 + points cells closer. Null: no way to the foe. */
function duelPlace(world: World, hero: Hero, target: Mob): { place: number; problem?: string } {
  const level = world.levels[hero.depth]!;
  const others = new Set<number>();
  for (const m of world.floors[hero.depth]!.mobs) others.add(m.pos);
  for (const h of world.heroes) if (h !== hero && h.depth === hero.depth) others.add(h.pos);
  const reachable = distances(world, hero, target.pos, others);
  let place = hero.pos;
  const points = pointsIn(hero, 'CLOSE_THE_GAP');
  if (points > 0 && hero.rooted <= 0) {
    const near = distances(world, hero, hero.pos, new Set(), 1 + points);
    for (const cell of near.keys()) {
      if (!reachable.has(cell) || !hasFlag(level.map[cell]!, F.PASSABLE) || cell === target.pos) continue;
      if (distance(cell, target.pos) < distance(place, target.pos)) place = cell;
      else if (distance(cell, target.pos) === distance(place, target.pos) && trueDistance2(cell, hero.pos) < trueDistance2(place, hero.pos)) place = cell;
    }
  }
  if (!reachable.has(place)) return { place, problem: `${MSG}challenge.unreachable_target` };
  if (distance(place, target.pos) > 5) return { place, problem: `${MSG}challenge.distant_target` };
  return { place };
}

export function challengeProblem(world: World, hero: Hero, cell: number | undefined): string | null {
  const target = foeAt(world, hero, cell!);
  const anyone = cell !== undefined ? charAt(world, hero.depth, cell) : undefined;
  if (!anyone || !heroView(world, hero)[cell!]) return `${MSG}challenge.no_target`;
  if (cs(hero).duel) return `${MSG}challenge.already_dueling`;
  if (!target) return `${MSG}challenge.ally_target`;
  return duelPlace(world, hero, target).problem ?? null;
}

/** Challenge.activate. */
export function doChallenge(ctx: Ctx, hero: Hero, cell: number | undefined): number {
  const { world, floor } = ctx;
  const target = foeAt(world, hero, cell!)!;
  const { place } = duelPlace(world, hero, target);
  const def = abilityDef(hero)!;
  const cost = chargeUse(hero, def);
  if (place !== hero.pos) {
    leaveCell(world, ctx.level, ctx.depth, hero.pos);
    hero.pos = place;
    enterCell(ctx.level, place);
    fx(ctx, hero, { k: 'puff', at: place });
    press(ctx, hero);
  }
  // Everyone else stands and watches, unless the foe is a boss (SpectatorFreeze: delayed for the duel's ten turns).
  const bossTarget = hasProp(target, 'boss');
  if (!bossTarget) {
    for (const other of floor.mobs) {
      if (other === target || other.ally || other.state === 'passive') continue;
      other.time = Math.max(other.time, floor.now) + DUEL_TURNS;
      marks(other).spectator = floor.now + DUEL_TURNS;
    }
  }
  marks(target).duel = { left: DUEL_TURNS, taken: 0 };
  cs(hero).duel = { left: DUEL_TURNS, taken: 0, foe: target.id };
  aggro(target, hero.id);
  fx(ctx, hero, { k: 'flash', color: 0x80ffffff });
  fx(ctx, hero, { k: 'sound', name: 'descend' });
  spendArmorCharge(hero, cost);
  dispelInvisibility(ctx, hero);
  fx(ctx, hero, { k: 'operate' });
  clearTimer(hero, 'elimination');
  return 0;
}

/** DuelParticipant.DURATION. */
const DUEL_TURNS = 10;

/** DuelParticipant.addDamage (Hero.damage): what the hero took in the duel, for the victory's healing. */
export function noteDuelDamage(hero: Hero, damage: number): void {
  if (hero.cls?.duel) hero.cls.duel.taken += damage;
}

/** Everyone who watched is let go; the time they were made to wait that is left is given back (Actor.delayChar(-cooldown)). */
function releaseSpectators(ctx: Ctx): void {
  for (const mob of ctx.floor.mobs) {
    const until = mob.marks?.spectator;
    if (until === undefined) continue;
    const left = until - ctx.floor.now;
    if (left > 0) mob.time = Math.max(ctx.floor.now, mob.time - left);
    delete mob.marks!.spectator;
  }
}

/** DuelParticipant.detach. `won`: the foe fell, or stopped being a foe. */
function endDuel(ctx: Ctx, hero: Hero, won: boolean): void {
  const duel = cs(hero).duel;
  if (!duel) return;
  delete cs(hero).duel;
  const foe = ctx.floor.mobs.find((m) => m.id === duel.foe);
  if (foe?.marks) delete foe.marks.duel;
  if (won) {
    fx(ctx, hero, { k: 'sound', name: 'boss' });
    const points = pointsIn(hero, 'INVIGORATING_VICTORY');
    if (points > 0) {
      // Heals for 30%/50%/65%/75% of the harm taken plus 5/10/15/20, by the talent's points.
      let heal = Math.round(duel.taken * (1 - ipow(Math.fround(0.707), points))) + 5 * points;
      heal = Math.min(heal, hero.ht - hero.hp);
      if (heal > 0) {
        hero.hp += heal;
        ctx.effects.push({ type: 'healed', hero: hero.id, amount: heal });
        fx(ctx, hero, { k: 'text', at: hero.pos, text: String(heal), tone: 'p', icon: 'heal' });
      }
    }
  }
  if (isAlive(hero)) {
    fx(ctx, hero, { k: 'flash', color: 0x80ffffff });
    if (pointsIn(hero, 'ELIMINATION_MATCH') > 0) setTimer(hero, 'elimination', 3);
  }
  releaseSpectators(ctx);
}

/** DuelParticipant.act, a turn's worth. */
export function duelTurn(ctx: Ctx, hero: Hero): void {
  const duel = hero.cls?.duel;
  if (!duel) return;
  duel.left--;
  if (duel.left <= 0) {
    endDuel(ctx, hero, false);
    return;
  }
  const foe = ctx.floor.mobs.find((m) => m.id === duel.foe);
  if (!foe || !isAlive(foe) || foe.ally || distance(foe.pos, hero.pos) > 5) endDuel(ctx, hero, !foe || !isAlive(foe) || foe.ally === true);
}

/** Mob.die of the duellist: the duel is won on the spot. */
export function duelFoeDied(ctx: Ctx, mob: Mob): void {
  for (const hero of ctx.world.heroes) {
    if (hero.depth === ctx.depth && hero.cls?.duel?.foe === mob.id) endDuel(ctx, hero, true);
  }
}

/* Feint */

export function feintProblem(world: World, hero: Hero, cell: number | undefined): string | null {
  if (!adjacent(hero.pos, cell!)) return `${MSG}feint.too_far`;
  if (hero.rooted > 0) return `${MSG}feint.bad_location`;
  const level = world.levels[hero.depth]!;
  if (!canEnter(level, cell!) || charAt(world, hero.depth, cell!)) return `${MSG}feint.bad_location`;
  return null;
}

/** Feint.activate: a step aside, in a turn, and an afterimage where the hero stood; enemies near or after the hero go for it. */
export function doFeint(ctx: Ctx, hero: Hero, cell: number | undefined): number {
  const { world, floor } = ctx;
  const old = hero.pos;
  const def = abilityDef(hero)!;
  spendArmorCharge(hero, chargeUse(hero, def));
  leaveCell(world, ctx.level, ctx.depth, old);
  hero.pos = cell!;
  enterCell(ctx.level, cell!);
  fx(ctx, hero, { k: 'lunge', from: old, to: cell! });
  press(ctx, hero);
  dispelInvisibility(ctx, hero);
  // It fades just before the hero's next action (Actor.HERO_PRIO + 1).
  const image = createMob(`#${++world.nextId}`, 'afterImage', old, 'passive', hero.time + 1 - 0.001);
  image.ally = true;
  image.owner = hero.id;
  floor.mobs.push(image);
  enterCell(ctx.level, old);
  for (const mob of floor.mobs) {
    if (mob === image) continue;
    if ((mob.enemy === hero.id && mob.state === 'hunting') || (hostile(mob) && mob.state !== 'sleeping' && distance(mob.pos, image.pos) <= 2)) aggro(mob, image.id);
  }
  return 1;
}

/** AfterImage.act: gone. */
export function afterImageAct(ctx: Ctx, image: Mob): void {
  ctx.floor.mobs.splice(ctx.floor.mobs.indexOf(image), 1);
  leaveCell(ctx.world, ctx.level, ctx.depth, image.pos);
  ctx.effects.push({ type: 'faded', depth: ctx.depth, mob: image.id, pos: image.pos });
}

/** AfterImage.defenseSkill: struck at, it makes the attacker lose track of the hero for a turn, and the talents answer. */
export function afterImageStruck(ctx: Ctx, attacker: Mob, image: Mob): void {
  const hero = ctx.world.heroes.find((h) => h.id === image.owner);
  if (!hero || attacker.ally) return;
  attacker.enemy = null;
  attacker.enemySeen = false;
  if (attacker.state === 'hunting') attacker.state = 'wandering';
  prolongMark(attacker, 'feint', 1);
  const points = (id: string): number => pointsIn(hero, id);
  if (points('FEIGNED_RETREAT') > 0) {
    const b = (hero.buffs ??= {});
    b.haste = Math.max(b.haste ?? 0, 2 * points('FEIGNED_RETREAT'));
  }
  if (points('EXPOSE_WEAKNESS') > 0) {
    attacker.vulnerable = Math.max(attacker.vulnerable ?? 0, 2 * points('EXPOSE_WEAKNESS'));
    attacker.weakened = Math.max(attacker.weakened ?? 0, 2 * points('EXPOSE_WEAKNESS'));
  }
  if (points('COUNTER_ABILITY') > 0) setTimer(hero, 'counter', 3);
}

/* Elemental Strike */

export function elementalProblem(world: World, hero: Hero, cell: number | undefined): string | null {
  return cell === hero.pos ? 'choose a target' : null;
}

/** Elemental Strike's colours for the client, by enchantment. */
export const cleaver = (hero: Hero): string => (hero.weapon && hero.weapon.enchant) || 'plain';

export function doElementalStrike(ctx: Ctx, hero: Hero, cell: number | undefined): number {
  const { world, level } = ctx;
  const def = abilityDef(hero)!;
  spendArmorCharge(hero, chargeUse(hero, def));
  const reach = pointsIn(hero, 'ELEMENTAL_REACH');
  const aim = ballistica({ world, depth: ctx.depth, level }, hero.pos, cell!, WONT_STOP);
  const dist = Math.min(aim.dist, 4 + reach);
  const area = cone({ world, depth: ctx.depth, level }, aim, dist, 65 + 10 * reach, STOP_SOLID | STOP_TARGET);
  const cells = new Set(area.cells);
  const weapon = hero.weapon && hero.weapon.enchant ? hero.weapon : null;
  const enchant = weapon?.enchant;
  for (const ray of area.outerRays) fx(ctx, hero, { k: 'ray', from: hero.pos, to: ray.path[ray.dist]!, name: enchant ?? 'plain' });
  fx(ctx, hero, { k: 'sound', name: 'chargeup' });
  fx(ctx, hero, { k: 'strike', at: cell! });

  // The foe at the target, if there is one the hero could strike.
  let enemy: Mob | null = foeAt(world, hero, cell!);
  if (enemy && ((hero.charmed > 0 && hero.charmedBy === enemy.id) || !(adjacent(hero.pos, enemy.pos) || distance(hero.pos, enemy.pos) <= Math.max(1, reachOf(hero))))) enemy = null;

  const inCone = (): Mob[] => ctx.floor.mobs.filter((m) => hostile(m) && cells.has(m.pos));
  const targetsHit = inCone().length;
  const power = 1 + 0.3 * pointsIn(hero, 'STRIKING_FORCE');

  preAttack(ctx, hero, enchant, targetsHit, power);
  if (pointsIn(hero, 'DIRECTED_POWER') > 0) cs(hero).directed = 0.3 * targetsHit * pointsIn(hero, 'DIRECTED_POWER');
  let oldPos = -1;
  if (enemy) {
    oldPos = enemy.pos;
    if (attack(ctx, hero, enemy, { accMulti: Infinity, dmgMulti: 1, dmgBonus: 0 })) fx(ctx, hero, { k: 'strong', at: oldPos });
  }
  delete cs(hero).directed;
  perCell(ctx, hero, cells, enchant, targetsHit, power);
  perChar(ctx, hero, cells, enchant, enemy, oldPos, power, weapon);
  dispelInvisibility(ctx, hero);
  return heroAttackDelay(hero);
}

const reachOf = (hero: Hero): number => (hero.weapon ? 1 + (hero.weapon.enchant === 'projecting' ? 1 : 0) : 1);

function preAttack(ctx: Ctx, hero: Hero, enchant: string | undefined, hit: number, power: number): void {
  if (enchant === 'blocking' && hit > 0) {
    const shield = Math.round(Math.round(6 * hit * power));
    setShield(hero, shield);
    ctx.effects.push({ type: 'barrier', depth: ctx.depth, who: hero.id, amount: shield });
    fx(ctx, hero, { k: 'text', at: hero.pos, text: String(shield), tone: 'p', icon: 'shield' });
  } else if (enchant === 'vampiric' && hit > 0) {
    const heal = Math.min(Math.round(2.5 * hit * power), hero.ht - hero.hp);
    if (heal > 0) {
      hero.hp += heal;
      ctx.effects.push({ type: 'healed', hero: hero.id, amount: heal });
    }
  } else if (enchant === 'sacrificial') {
    hero.bleeding = Math.max(hero.bleeding ?? 0, Math.round(10 * power));
  }
}

function perCell(ctx: Ctx, hero: Hero, cells: ReadonlySet<number>, enchant: string | undefined, hit: number, power: number): void {
  const list = [...cells];
  switch (enchant) {
    case 'blazing':
      for (const c of list) seedGas(ctx, c, 'fire', Math.round(8 * power));
      break;
    case 'chilling':
      for (const c of list) seedGas(ctx, c, 'freezing', Math.round(8 * power));
      break;
    case 'shocking':
      for (const c of list) seedGas(ctx, c, 'electricity', Math.round(8 * power));
      break;
    case 'blooming': {
      // The cone's open ground greens; up to eight cells (more with force) grow tall grass.
      const shuffled = [...list];
      ctx.rng.shuffle(shuffled);
      let grass = Math.round(8 * power);
      for (const c of shuffled) {
        const t = ctx.level.map[c]!;
        if (t === T.EMPTY || t === T.EMBERS || t === T.EMPTY_DECO || t === T.GRASS) {
          const there = charAt(ctx.world, ctx.depth, c);
          if (grass > 0 && !(there && hasProp(there, 'immovable'))) {
            ctx.level.map[c] = T.HIGH_GRASS;
            grass--;
          } else ctx.level.map[c] = T.GRASS;
          ctx.effects.push({ type: 'grown', depth: ctx.depth, pos: c });
        }
      }
      break;
    }
    case 'pressurized':
      for (const c of list) if (ctx.rng.float() < power / 2) setCellToWater(ctx, c);
      break;
    default:
  }
  void hit;
  void hero;
}

function perChar(ctx: Ctx, hero: Hero, cells: ReadonlySet<number>, enchant: string | undefined, primary: Mob | null, oldPos: number, power: number, weapon: Item | null): void {
  const { rng } = ctx;
  const affected = (): Mob[] => ctx.floor.mobs.filter((m) => isAlive(m) && !m.ally && m.state !== 'passive' && cells.has(m.pos));
  const hurtBy = (mob: Mob, amount: number): void => {
    if (amount <= 0) return;
    ctx.effects.push({ type: 'hurt', depth: ctx.depth, who: mob.id, damage: amount });
    hurt(ctx, mob, amount, hero);
  };
  const others = (): Mob[] => affected().filter((m) => m !== primary);
  const chance = (p: number): boolean => rng.float() < p;
  const missing = (m: Mob): number => 1 - m.hp / m.ht;
  switch (enchant) {
    case undefined:
    case null:
      for (const m of affected()) hurtBy(m, Math.round(power * rng.normalIntRange(6, 12)));
      break;
    case 'kinetic': {
      const stored = Math.ceil(hero.kinetic ?? 0);
      if (stored > 0) {
        for (const m of others()) hurtBy(m, Math.round(stored * 0.4 * power));
        delete hero.kinetic;
      }
      if (!primary) delete hero.kinetic;
      break;
    }
    case 'venomous':
      for (const m of others()) m.poison = (m.poison ?? 0) + Math.round(power * 10);
      break;
    case 'blooming':
      for (const m of affected()) m.rooted = Math.max(m.rooted ?? 0, Math.round(6 * power));
      break;
    case 'elastic': {
      const order = affected().sort((a, b) => distance(hero.pos, b.pos) - distance(hero.pos, a.pos));
      for (const m of order) {
        if (m === primary && oldPos !== m.pos) continue;
        if (!isAlive(m)) continue;
        const away = ballistica({ world: ctx.world, depth: ctx.depth, level: ctx.level }, hero.pos, m.pos, WONT_STOP);
        throwChar(ctx, m, trajectory(ctx, m.pos, away.collisionPos, MAGIC_BOLT), Math.round(5 * power), true);
      }
      break;
    }
    case 'eldritch':
      for (const m of affected()) {
        m.terror = Math.max(m.terror ?? 0, Math.round(power * 10));
        m.terrorOf = hero.id;
      }
      break;
    case 'lucky':
      for (const m of affected()) {
        if (chance(0.125 * power) && !m.marks?.t?.luckyStrike) {
          ctx.floor.heaps.push({ pos: m.pos, kind: 'heap', items: [luckyDrop(ctx, 0)] });
          ctx.effects.push({ type: 'lucky', depth: ctx.depth, pos: m.pos });
          prolongMark(m, 'luckyStrike', 1e6);
        }
      }
      break;
    case 'projecting':
      for (const m of others()) hurtBy(m, Math.round(heroDamageRoll(hero, rng) * 0.3 * power));
      break;
    case 'unstable':
      if (weapon) for (const m of others()) enchantProc(ctx, hero, m, heroDamageRoll(hero, rng), weapon, rng.oneOf(['blazing', 'chilling', 'shocking', 'venomous', 'vorpal'] as const), {});
      break;
    case 'vorpal':
      for (const m of others()) if (!bleedImmune(m)) m.bleeding = Math.max(m.bleeding ?? 0, Math.round(power * 10));
      break;
    case 'corrupting':
      for (const m of others()) {
        if (m.corrupted || isImmune(m, 'corruption') || !isAlive(m)) continue;
        if (chance((0.05 + 0.2 * missing(m)) * power)) corruptMob(ctx, hero, m);
      }
      break;
    case 'crystal':
      for (const m of others()) hurtBy(m, Math.round(power * rng.normalIntRange(10, 20)));
      break;
    case 'grim':
      for (const m of others()) {
        if (chance((0.06 + 0.24 * missing(m)) * power)) {
          fx(ctx, hero, { k: 'burst', at: m.pos, name: 'shadow', count: 5 });
          hurtBy(m, m.hp);
        }
      }
      break;
    case 'annoying':
      for (const m of affected()) if (chance(0.2 * power)) m.amok = Math.max(m.amok ?? 0, 6);
      break;
    case 'displacing':
      for (const m of affected()) {
        if (chance(0.5 * power) && teleportChar(ctx, m) && m.state === 'hunting') m.state = 'wandering';
      }
      break;
    case 'dazzling':
      for (const m of affected()) if (chance(0.5 * power)) m.blind = Math.max(m.blind ?? 0, 6);
      break;
    case 'explosive':
      if (chance(0.5 * power)) {
        const list = affected();
        const boom = list.length > 0 ? rng.element(list) : undefined;
        if (boom) conjuredBomb(ctx, boom.pos, hero, false);
      }
      break;
    case 'sacrificial':
      for (const m of affected()) if (!bleedImmune(m)) m.bleeding = Math.max(m.bleeding ?? 0, Math.round(12 * power));
      break;
    case 'wayward':
      for (const m of affected()) if (chance(0.5 * power)) m.hexed = Math.max(m.hexed ?? 0, 6);
      break;
    case 'polarized':
      for (const m of affected()) if (chance(0.5 * power)) hurtBy(m, rng.normalIntRange(24, 36));
      break;
    case 'friendly':
      for (const m of affected()) {
        if (chance(0.5 * power)) {
          m.charmed = Math.max(m.charmed ?? 0, 6);
          m.charmedBy = hero.id;
        }
      }
      break;
    case 'wondrous':
      for (const m of affected()) {
        if (chance(power / 2)) {
          const bolt = ballistica({ world: ctx.world, depth: ctx.depth, level: ctx.level }, hero.pos, m.pos, STOP_TARGET);
          cursedZap(ctx, hero, null, bolt);
        }
      }
      break;
    case 'pressurized': {
      const order = affected().sort((a, b) => distance(hero.pos, b.pos) - distance(hero.pos, a.pos));
      for (const m of order) {
        if (m === primary && oldPos !== m.pos) continue;
        if (!isAlive(m)) continue;
        const away = ballistica({ world: ctx.world, depth: ctx.depth, level: ctx.level }, hero.pos, m.pos, WONT_STOP);
        throwChar(ctx, m, trajectory(ctx, m.pos, away.collisionPos, MAGIC_BOLT), Math.round(2 * power), true);
      }
      break;
    }
    default:
      // blazing, chilling, shocking, blocking, vampiric: their effects are the cells' and the caster's.
  }
  void drRoll;
  void igniteChar;
  void chillChar;
  void isWater;
  void destroyCell;
  void procMultiplier;
  void weaponProc;
  void isEnemy;
  void ({} as Ballistica);
  void beyond;
  void clearMark;
}

/** Corruption on a living monster (AllyBuff.affectAndLoot): it fights for the hero now. */
function corruptMob(ctx: Ctx, hero: Hero, mob: Mob): void {
  corruptionHeal(mob);
  mob.ally = true;
  mob.corrupted = true;
  delete mob.foe;
  mob.enemy = null;
  mob.state = mob.state === 'sleeping' || mob.state === 'passive' ? 'wandering' : mob.state;
  ctx.effects.push({ type: 'ally', depth: ctx.depth, mob: mob.id, event: 'corrupted' });
  lootAndExp(ctx, mob, hero);
}

import type { Item } from '../items';
export type { Char };
