import { type Hero, isAlive, type Mob } from '../actors';
import { ballistica, cone, IGNORE_SOFT_SOLID, MAGIC_BOLT, STOP_SOLID, STOP_TARGET, WONT_STOP } from '../ballistica';
import { dispelInvisibility } from '../artifacts';
import { freezeChar, igniteChar } from '../buffs';
import { type Char, charAt, type Ctx, exploredCells, isHero } from '../floor';
import { clearGasAt, seedFire, seedGas } from '../gas';
import { type Item, itemDef } from '../items';
import { discoverable } from '../level/flags';
import { distance, LENGTH, NEIGHBOURS8, NEIGHBOURS9, WIDTH, HEIGHT } from '../level/geometry';
import { discover, F, hasFlag, T } from '../level/terrain';
import { DARKNESS, isChallenged } from '../challenges';
import { appear } from '../reading';
import { allyWandHeal } from '../allies';
import { corrode, shieldUp } from '../status';
import { hasProp, type Harm, isImmune, resistance } from '../props';
import { floorLocked } from '../hero';
import { pointsInTalent } from '../talents';
import { hasAmulet } from '../world';
import { occupyCell, powi, throwChar, wildZap } from '../wands';
import { harm, livingAt, notAlly, openSpace, prolong, relocate, stateOf, trueDistance } from './common';

/*
 * The mage's armour abilities: ElementalBlast, WildMagic and WarpBeacon.
 */

/* Elemental blast */

type WandKind = 'wand.magicMissile' | 'wand.lightning' | 'wand.disintegration' | 'wand.fireblast' | 'wand.corrosion' | 'wand.blastWave'
  | 'wand.livingEarth' | 'wand.frost' | 'wand.prismaticLight' | 'wand.warding' | 'wand.transfusion' | 'wand.corruption' | 'wand.regrowth';

/** ElementalBlast.effectTypes: how the blast looks for each wand (MagicMissile's cones). */
const BLAST_LOOK: Readonly<Record<WandKind, 'magic' | 'lightning' | 'beam' | 'fire' | 'corrosion' | 'force' | 'earth' | 'frost' | 'rainbow' | 'ward' | 'blood' | 'corruption' | 'foliage'>> = {
  'wand.magicMissile': 'magic', 'wand.lightning': 'lightning', 'wand.disintegration': 'beam', 'wand.fireblast': 'fire',
  'wand.corrosion': 'corrosion', 'wand.blastWave': 'force', 'wand.livingEarth': 'earth', 'wand.frost': 'frost',
  'wand.prismaticLight': 'rainbow', 'wand.warding': 'ward', 'wand.transfusion': 'blood', 'wand.corruption': 'corruption',
  'wand.regrowth': 'foliage',
};

/** ElementalBlast.damageFactors: the share of 15 to 25 each wand's blast does. */
const BLAST_DAMAGE: Readonly<Record<WandKind, number>> = {
  'wand.magicMissile': 0.5, 'wand.lightning': 1, 'wand.disintegration': 1, 'wand.fireblast': 1, 'wand.corrosion': 0, 'wand.blastWave': 0.67,
  'wand.livingEarth': 0.5, 'wand.frost': 1, 'wand.prismaticLight': 0.67, 'wand.warding': 0, 'wand.transfusion': 0, 'wand.corruption': 0,
  'wand.regrowth': 0,
};

/** The wand in the hero's staff (MagesStaff.wandClass), held in hand or in the pack. */
export function staffWand(hero: Hero): Item | undefined {
  for (const item of [hero.weapon, ...hero.items]) if (item?.kind === 'weapon.magesStaff' && item.wand) return item.wand;
  return undefined;
}

export function elementalBlastProblem(hero: Hero): string | null {
  return staffWand(hero) ? null : 'art:actors.hero.abilities.mage.elementalblast.no_staff';
}

/** Terrain a plant can sprout on or grass can grow over (WandOfRegrowth's cells). */
const growable = (terrain: number): boolean =>
  terrain === T.EMPTY || terrain === T.EMPTY_DECO || terrain === T.EMBERS || terrain === T.GRASS;

/**
 * ElementalBlast.activate: a blast all around the hero, four cells out (more with Blast Radius), which does what the
 * staff's wand does to those it reaches, and hurts (15 to 25, by the wand): lightning stuns, fire burns, frost freezes, a blast wave
 * throws back, transfusion charms or heals, and so on. Each creature struck beyond a hit shields the hero (Reactive Barrier).
 */
export function elementalBlast(ctx: Ctx, hero: Hero): number {
  const { world, depth, level } = ctx;
  const wand = staffWand(hero)!;
  const kind = wand.kind as WandKind;
  // The direction only matters if the blast goes off the map: the way with the most room.
  const x = hero.pos % WIDTH;
  const y = Math.trunc(hero.pos / WIDTH);
  let towards: number;
  if (Math.max(x, WIDTH - x) >= Math.max(y, HEIGHT - y)) towards = x > WIDTH / 2 ? hero.pos - 1 : hero.pos + 1;
  else towards = y > HEIGHT / 2 ? hero.pos - WIDTH : hero.pos + WIDTH;
  const aim = ballistica(ctx, hero.pos, towards, WONT_STOP);

  const size = 4 + pointsInTalent(hero, 'blastRadius');
  let props = STOP_SOLID | STOP_TARGET;
  if (kind === 'wand.disintegration' || kind === 'wand.warding') props = STOP_TARGET;
  else if (kind === 'wand.fireblast') props |= IGNORE_SOFT_SOLID;
  const area = cone(ctx, aim, size, 360, props);
  ctx.effects.push({
    type: 'ability', depth, hero: hero.id, ability: 'elementalBlast', from: hero.pos, to: hero.pos,
    cells: area.outerRays.map((ray) => ray.path[ray.dist]!), wand: kind, bolt: BLAST_LOOK[kind],
  });

  const effectMulti = 1 + 0.25 * pointsInTalent(hero, 'elementalPower');
  const explored = exploredCells(world, depth);
  const open = discoverable(level.map);
  let charsHit = 0;
  for (const cell of area.cells) {
    /* Cell effects */
    switch (kind) {
      case 'wand.lightning':
        if (level.map[cell] === T.WATER || hasFlag(level.map[cell]!, F.LIQUID)) seedGas(ctx, cell, 'electricity', 4);
        break;
      case 'wand.fireblast':
        if (level.map[cell] === T.DOOR) level.map[cell] = T.OPEN_DOOR;
        clearGasAt(ctx.floor, 'freezing', cell);
        if (hasFlag(level.map[cell]!, F.FLAMABLE)) seedFire(ctx, cell, 4);
        break;
      case 'wand.frost':
        clearGasAt(ctx.floor, 'fire', cell);
        break;
      case 'wand.prismaticLight':
        for (const n of NEIGHBOURS9) {
          const c = cell + n;
          if (c < 0 || c >= LENGTH) continue;
          if (open[c]) explored[c] = true;
          if (hasFlag(level.map[c]!, F.SECRET)) {
            level.map[c] = discover(level.map[c]!);
            explored[c] = true;
            ctx.effects.push({ type: 'discovered', depth, cell: c });
          }
        }
        break;
      case 'wand.regrowth':
        if (ctx.rng.float() < 0.33 * effectMulti && growable(level.map[cell]!) && !(ctx.floor.plants ?? []).some((p) => p.pos === cell)) {
          level.map[cell] = T.HIGH_GRASS;
        }
        break;
      default:
    }

    /* Damage */
    const mob = livingAt(ctx, cell);
    let damage = 0;
    if (mob) damage = Math.round(ctx.rng.normalIntRange(15, 25) * effectMulti * BLAST_DAMAGE[kind]);
    if (mob && damage > 0 && !isHero(mob) && !mob.ally) {
      charsHit++;
      const dealt = Math.round(damage * resistance(mob, kind as Harm));
      harm(ctx, hero, mob, dealt);
    }

    /* Other effects on the creature */
    if (!mob || mob === hero) continue;
    const foe = !isHero(mob) && !mob.ally;
    switch (kind) {
      case 'wand.lightning':
        if (isAlive(mob) && foe && !isImmune(mob, 'paralysis')) prolong(mob, 'paralysed', effectMulti * 5);
        break;
      case 'wand.fireblast':
        if (isAlive(mob) && foe) igniteChar(ctx, mob);
        break;
      case 'wand.corrosion':
        if (isAlive(mob) && foe) {
          corrode(mob, 4, Math.round(6 * effectMulti));
          charsHit++;
        }
        break;
      case 'wand.blastWave':
        if (foe && isAlive(mob)) {
          const out = ballistica(ctx, hero.pos, mob.pos, WONT_STOP);
          const knockback = Math.trunc((size + 1 - Math.trunc(trueDistance(hero.pos, mob.pos))) * effectMulti);
          throwChar(ctx, mob, ballistica(ctx, mob.pos, out.collisionPos, MAGIC_BOLT), knockback, true, true);
        }
        break;
      case 'wand.frost':
        if (isAlive(mob) && foe) freezeChar(ctx, mob, effectMulti * 10);
        break;
      case 'wand.prismaticLight':
        if (isAlive(mob) && foe) {
          if (!isImmune(mob, 'blindness')) prolong(mob, 'blind', effectMulti * 5);
          charsHit++;
        }
        break;
      case 'wand.warding':
        if (!isHero(mob) && mob.kind === 'ward') {
          allyWandHeal(ctx, mob, 0, effectMulti);
          charsHit++;
        }
        break;
      case 'wand.transfusion':
        if (!isHero(mob)) {
          if (mob.ally || (mob.charmed ?? 0) > 0) {
            let healing = Math.round(10 * effectMulti);
            let shielding = mob.hp + healing - mob.ht;
            if (shielding > 0) {
              healing -= shielding;
              shieldUp(mob, shielding);
              ctx.effects.push({ type: 'barrier', depth, who: mob.id, amount: shielding });
            } else {
              shielding = 0;
            }
            mob.hp += healing;
            if (healing > 0) ctx.effects.push({ type: 'mobHealed', depth, mob: mob.id, amount: healing });
          } else if (!hasProp(mob, 'undead')) {
            if (!isImmune(mob, 'charm')) {
              mob.charmed = Math.max(mob.charmed ?? 0, effectMulti * 5);
              mob.charmedBy = hero.id;
              mob.charmFirm = true;
            }
          } else {
            harm(ctx, hero, mob, Math.round(ctx.rng.normalIntRange(15, 25) * effectMulti));
          }
          charsHit++;
        }
        break;
      case 'wand.corruption':
        if (isAlive(mob) && foe) {
          if (!isImmune(mob, 'amok')) {
            prolong(mob, 'amok', effectMulti * 5);
            if (mob.state === 'sleeping') mob.state = 'hunting';
          }
          charsHit++;
        }
        break;
      case 'wand.regrowth':
        if (foe) {
          if (!isImmune(mob, 'roots')) prolong(mob, 'rooted', effectMulti * 5);
          charsHit++;
        }
        break;
      default:
    }
  }

  /* The blast's effects on the hero */
  switch (kind) {
    case 'wand.magicMissile':
      hero.recharging = (hero.recharging ?? 0) + effectMulti * 15;
      break;
    case 'wand.livingEarth':
      if (charsHit > 0) {
        const guardian = ctx.floor.mobs.find((m) => m.kind === 'guardian' && isAlive(m));
        if (guardian) {
          const before = guardian.hp;
          guardian.hp = Math.min(guardian.ht, guardian.hp + Math.round(effectMulti * charsHit * 5));
          if (guardian.hp > before) ctx.effects.push({ type: 'mobHealed', depth, mob: guardian.id, amount: guardian.hp - before });
        }
      }
      break;
    case 'wand.frost':
      hero.burning = 0;
      break;
    case 'wand.prismaticLight':
      hero.light = Math.max(hero.light, isChallenged(world, DARKNESS) ? effectMulti * 10 : effectMulti * 50);
      break;
    default:
  }

  charsHit = Math.min(4 + pointsInTalent(hero, 'reactiveBarrier'), charsHit);
  const barrier = pointsInTalent(hero, 'reactiveBarrier');
  if (charsHit > 0 && barrier > 0) {
    const shielding = Math.round(charsHit * 2.5 * barrier);
    shieldUp(hero, shielding);
    ctx.effects.push({ type: 'barrier', depth, who: hero.id, amount: shielding });
  }
  dispelInvisibility(ctx, hero);
  return 1;
}

/* Wild magic */

/** WildMagic.chargeUsePerShot: half a charge a shot, a third less with each point of Conserved Magic. */
const shotCost = (hero: Hero): number => 0.5 * powi(0.67, pointsInTalent(hero, 'conservedMagic'));

/** The wands in the pack Wild Magic may fire (the staff's is left alone). */
function packWands(hero: Hero): Item[] {
  return hero.items.filter((item) => itemDef(item.kind).category === 'wand');
}

/** A wand's charge in all, whole and partial. */
const wandCharge = (wand: Item): number => (wand.charges ?? 0) + (wand.partial ?? 0);

export function wildMagicProblem(hero: Hero, target: number | undefined): string | null {
  if (target === undefined || !Number.isInteger(target) || target < 0 || target >= LENGTH) return 'art:actors.hero.abilities.armorability.prompt';
  if (target === hero.pos) return 'art:actors.hero.abilities.armorability.self_target';
  const cost = shotCost(hero);
  return packWands(hero).some((wand) => (wand.charges ?? 0) >= 1 || (wand.partial ?? 0) >= cost) ? null : 'art:actors.hero.abilities.mage.wildmagic.no_wands';
}

/** Wand.buffedLvl under the WildMagicTracker: +2 to +4 (a half level more, now and then) up to +3 and Wild Power more. */
export function wildMagicLevel(hero: Hero, level: number): number {
  const wild = hero.abil?.wild;
  if (!wild) return level;
  const maxBonusLevel = 3 + pointsInTalent(hero, 'wildPower');
  return level < maxBonusLevel ? Math.min(level + wild.bonus, maxBonusLevel) : level;
}

/**
 * WildMagic.activate: the wands in the pack (not the staff) are fired at the cell in random order, up to four of
 * them (one more with each point of Fire Everything), those with charge to spare a second time, and a third now and
 * then; each shot takes half a charge, as strong as the ability makes it. The whole takes a turn, or none now and then
 * (Conserved Magic).
 */
export function wildMagic(ctx: Ctx, hero: Hero, target: number): number {
  const cost = shotCost(hero);
  const fire = pointsInTalent(hero, 'fireEverything');
  let wands = packWands(hero);
  ctx.rng.shuffle(wands);
  wands = wands.filter((w) => !((w.charges ?? 0) < 1 && (w.partial ?? 0) < cost));
  const maxWands = 4 + fire;
  if (wands.length < maxWands) {
    const seconds = [...wands];
    const thirds = [...wands];
    for (const w of wands) {
      const total = wandCharge(w);
      if (total < 2 * cost) seconds.splice(seconds.indexOf(w), 1);
      if (total < 3 * cost || ctx.rng.int(4) >= fire) thirds.splice(thirds.indexOf(w), 1);
    }
    ctx.rng.shuffle(seconds);
    while (seconds.length > 0 && wands.length < maxWands) wands.push(seconds.shift()!);
    ctx.rng.shuffle(thirds);
    while (thirds.length > 0 && wands.length < maxWands) wands.push(thirds.shift()!);
  } else {
    while (wands.length > maxWands) wands.shift();
  }
  ctx.rng.shuffle(wands);

  const state = stateOf(hero);
  ctx.effects.push({ type: 'ability', depth: ctx.depth, hero: hero.id, ability: 'wildMagic', from: hero.pos, to: target });
  for (const wand of wands) {
    if (!isAlive(hero)) break;
    // Wand.buffedLvl: a half level more in two shots.
    const wild = pointsInTalent(hero, 'wildPower');
    state.wild = { bonus: Math.trunc((4 + wild + (ctx.rng.int(2) === 0 ? 1 : 0)) / 2) };
    wildZap(ctx, hero, wand, target);
    // WildMagic.afterZap: half a charge (or less) spent.
    wand.partial = (wand.partial ?? 0) - cost;
    if (wand.partial < 0) {
      wand.partial++;
      wand.charges = (wand.charges ?? 0) - 1;
    }
  }
  delete state.wild;
  dispelInvisibility(ctx, hero);
  return ctx.rng.int(4) >= pointsInTalent(hero, 'conservedMagic') ? 1 : 0;
}

/* Warp beacon */

/** WarpBeacon.targetedPos/targetingPrompt: a cell is asked for only to place a beacon with Remote Beacon. */
export function beaconNeedsTarget(hero: Hero): boolean {
  return hero.abil?.beacon === undefined && pointsInTalent(hero, 'remoteBeacon') > 0;
}

/** Why the beacon cannot be placed or used: `choice` 0 warps to it, 1 clears it. */
export function warpBeaconProblem(ctx: Ctx, hero: Hero, target: number | undefined, choice: number | undefined, charge: number, cost: number): string | null {
  const beacon = hero.abil?.beacon;
  if (beacon) {
    if (choice !== 0 && choice !== 1) return 'art:actors.hero.abilities.mage.warpbeacon.window_desc';
    if (choice === 1) return null;
    const longrange = pointsInTalent(hero, 'longrangeWarp');
    if (beacon.depth !== hero.depth && longrange <= 0) return 'art:actors.hero.abilities.mage.warpbeacon.depths';
    const needed = beaconCost(hero, cost, beacon.depth !== hero.depth);
    if (charge < needed) return 'art:items.armor.classarmor.low_charge';
    if (beacon.depth !== hero.depth && (floorLocked(ctx.world, hero.depth) || hasAmulet(hero))) {
      return floorLocked(ctx.world, hero.depth) ? 'art:actors.hero.abilities.mage.warpbeacon.locked_floor' : 'art:items.scrolls.scrollofteleportation.no_tele';
    }
    return null;
  }
  const cell = target ?? hero.pos;
  if (!Number.isInteger(cell) || cell < 0 || cell >= LENGTH) return 'art:actors.hero.abilities.armorability.prompt';
  if (!exploredCells(ctx.world, hero.depth)[cell]) return 'art:actors.hero.abilities.mage.warpbeacon.invalid_beacon';
  if (distance(hero.pos, cell) > 4 * pointsInTalent(hero, 'remoteBeacon')) return 'art:actors.hero.abilities.mage.warpbeacon.too_far';
  const terrain = ctx.level.map[cell]!;
  const walkable = hasFlag(terrain, F.PASSABLE) || hasFlag(terrain, F.AVOID);
  if (hasFlag(terrain, F.PIT) || (hasFlag(terrain, F.SOLID) && !hasFlag(terrain, F.PASSABLE)) || !walkable || !connected(ctx, cell, hero.pos)) {
    return 'art:actors.hero.abilities.mage.warpbeacon.invalid_beacon';
  }
  return null;
}

/** WarpBeacon.activate's PathFinder.buildDistanceMap(target, passable | avoid): the hero can get there from the cell. */
function connected(ctx: Ctx, from: number, to: number): boolean {
  const seen = new Set([from]);
  const queue = [from];
  for (let head = 0; head < queue.length; head++) {
    const cell = queue[head]!;
    if (cell === to) return true;
    for (const n of NEIGHBOURS8) {
      const next = cell + n;
      if (next < 0 || next >= LENGTH || seen.has(next) || Math.abs((next % WIDTH) - (cell % WIDTH)) > 1) continue;
      const terrain = ctx.level.map[next]!;
      if (!hasFlag(terrain, F.PASSABLE) && !hasFlag(terrain, F.AVOID)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return false;
}

/** The charge a warp costs: more across depths (1.833 down to 1.167 times with Long-range Warp). */
export function beaconCost(hero: Hero, cost: number, across: boolean): number {
  return across ? cost * (1.833 - 0.333 * pointsInTalent(hero, 'longrangeWarp')) : cost;
}

/** What the warp beacon does: the time taken and the charge spent. */
export function warpBeacon(
  ctx: Ctx, hero: Hero, target: number | undefined, choice: number | undefined, cost: number, deps: { returnTo(depth: number, pos: number): void },
): { time: number; charge: number } {
  const beacon = hero.abil?.beacon;
  if (!beacon) {
    // Placed where the hero stands, or (Remote Beacon) a cell they can see or know. Placing costs no charge.
    const cell = target ?? hero.pos;
    hero.abil = { ...hero.abil, beacon: { depth: hero.depth, pos: cell } };
    ctx.effects.push({ type: 'ability', depth: ctx.depth, hero: hero.id, ability: 'warpBeacon', from: hero.pos, to: cell });
    dispelInvisibility(ctx, hero);
    return { time: 1, charge: 0 };
  }
  if (choice === 1) {
    delete hero.abil!.beacon;
    return { time: 0, charge: 0 };
  }
  const across = beacon.depth !== hero.depth;
  const charge = beaconCost(hero, cost, across);
  if (across) {
    ctx.effects.push({ type: 'ability', depth: ctx.depth, hero: hero.id, ability: 'warpBeacon', from: hero.pos, to: beacon.pos });
    dispelInvisibility(ctx, hero);
    deps.returnTo(beacon.depth, beacon.pos);
    return { time: 0, charge };
  }
  const existing = charAt(ctx.world, ctx.depth, beacon.pos);
  if (existing && existing !== hero && isAlive(existing)) {
    const frag = pointsInTalent(hero, 'telefrag');
    if (frag > 0) {
      // The hero takes a little of the blow (never to the last point); the one in the way, far more.
      const heroHp = hero.hp + (hero.shield ?? 0);
      harm(ctx, hero, hero, Math.min(5 * frag, heroHp - 1), 'wand');
      harm(ctx, hero, existing, ctx.rng.normalIntRange(10 * frag, 15 * frag));
      ctx.effects.push({ type: 'telefrag', depth: ctx.depth, pos: beacon.pos });
    }
    const now = charAt(ctx.world, ctx.depth, beacon.pos);
    if (now && now !== hero && isAlive(now) && now.pos === beacon.pos) {
      const toPush: Char = hasProp(now, 'immovable') ? hero : now;
      const candidates = NEIGHBOURS8.map((n) => beacon.pos + n).filter((cell) =>
        cell >= 0 && cell < LENGTH && !hasFlag(ctx.level.map[cell]!, F.SOLID) && !charAt(ctx.world, ctx.depth, cell) &&
        (!hasProp(toPush, 'large') || openSpace(ctx, cell)));
      ctx.rng.shuffle(candidates);
      if (candidates.length > 0) {
        const to = candidates[0]!;
        ctx.effects.push({ type: 'ability', depth: ctx.depth, hero: hero.id, ability: 'warpBeacon', from: hero.pos, to: beacon.pos });
        if (toPush === hero) {
          appear(ctx, hero, to);
        } else {
          appear(ctx, hero, beacon.pos);
          const from = toPush.pos;
          relocate(ctx, toPush, to);
          ctx.effects.push({ type: 'pushed', depth: ctx.depth, mob: toPush.id, from, to });
          occupyCell(ctx, toPush);
        }
        occupyCell(ctx, hero);
      } else {
        ctx.effects.push({ type: 'artifact', hero: hero.id, msg: 'items.scrolls.scrollofteleportation.no_tele', tone: 'w' });
      }
    } else {
      warpTo(ctx, hero, beacon.pos);
    }
  } else {
    warpTo(ctx, hero, beacon.pos);
  }
  dispelInvisibility(ctx, hero);
  return { time: 0, charge };
}

function warpTo(ctx: Ctx, hero: Hero, pos: number): void {
  ctx.effects.push({ type: 'ability', depth: ctx.depth, hero: hero.id, ability: 'warpBeacon', from: hero.pos, to: pos });
  appear(ctx, hero, pos);
  occupyCell(ctx, hero);
}

export type { Mob };
export { notAlly };
