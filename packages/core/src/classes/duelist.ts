import { type Hero, heroAttackDelay, heroSpeed, heroStr, isAlive, type Mob } from '../actors';
import { attack } from '../combat';
import { canEnter, charAt, type Ctx, enterCell, heroView, isHero, leaveCell } from '../floor';
import { type Item, itemDef, type ItemKind } from '../items';
import { augmentDamage, gearLevel, jround, meleeMax, meleeMin, meleeStr, weaponRch } from '../weapons';
import { dispelInvisibility } from '../artifacts';
import { canReach } from '../throwing';
import { beyond, press, throwChar } from '../displace';
import { isEnemy } from '../enchant';
import { propertiesOf } from '../props';
import { adjacent, cellX, cellY, distance, LENGTH, NEIGHBOURS8 } from '../level/geometry';
import { F, hasFlag } from '../level/terrain';
import type { World } from '../world';
import { chargeTotal, spendCharges } from './charger';
import { clearTimer, cs, hasTimer, prolongMark, setTimer } from './state';
import { hasTalent, pointsIn } from '../talents';
import type { ClassFx } from './fx';
import { onAbilityUsed, onBeforeAbility, onAbilityKill } from './duelist-talents';

/*
 * The Duelist's weapon abilities (MeleeWeapon.duelistAbility and each weapon's override): every melee weapon has
 * one, spent from the Charger's charges. A weapon's ability is one of a few families — cleave, combo strike, sneak,
 * lunge, heavy blow, spike, stance, guard, whip, harvest, spin, runic slash, charged shot — sharing their rules and
 * differing in their numbers.
 */

export type AbilityKind =
  | 'cleave' | 'combo' | 'sneak' | 'lunge' | 'heavy' | 'spike' | 'defensive' | 'dance' | 'guard' | 'whip' | 'harvest' | 'spin'
  | 'runic' | 'charged' | 'axe' | 'pick';

interface AbilityDef {
  kind: AbilityKind;
  /** Whether the ability asks for a cell (MeleeWeapon.targetingPrompt). */
  prompt: boolean;
  /** The base of the number it adds, and its scaling per level (augmented, rounded as Shattered rounds it). */
  base: number;
  scale: number;
  /** Dagger.sneakAbility's distance. */
  dist?: number;
}

/** Every weapon's ability and its numbers (duelistAbility and abilityInfo of each weapon class). */
const ABILITIES: Partial<Record<ItemKind, AbilityDef>> = {
  'weapon.wornShortsword': { kind: 'cleave', prompt: true, base: 3, scale: 1 },
  'weapon.shortsword': { kind: 'cleave', prompt: true, base: 4, scale: 1 },
  'weapon.sword': { kind: 'cleave', prompt: true, base: 5, scale: 1 },
  'weapon.longsword': { kind: 'cleave', prompt: true, base: 6, scale: 1 },
  'weapon.greatsword': { kind: 'cleave', prompt: true, base: 7, scale: 1 },
  'weapon.gloves': { kind: 'combo', prompt: true, base: 3, scale: 1 },
  'weapon.sai': { kind: 'combo', prompt: true, base: 4, scale: 1 },
  'weapon.gauntlet': { kind: 'combo', prompt: true, base: 5, scale: 1 },
  'weapon.dagger': { kind: 'sneak', prompt: true, base: 2, scale: 1, dist: 5 },
  'weapon.dirk': { kind: 'sneak', prompt: true, base: 2, scale: 1, dist: 4 },
  'weapon.assassinsBlade': { kind: 'sneak', prompt: true, base: 2, scale: 1, dist: 3 },
  'weapon.rapier': { kind: 'lunge', prompt: true, base: 5, scale: 1.5 },
  'weapon.katana': { kind: 'lunge', prompt: true, base: 8, scale: 2 },
  'weapon.cudgel': { kind: 'heavy', prompt: true, base: 3, scale: 1.5 },
  'weapon.handAxe': { kind: 'heavy', prompt: true, base: 4, scale: 1.5 },
  'weapon.mace': { kind: 'heavy', prompt: true, base: 5, scale: 1.5 },
  'weapon.battleAxe': { kind: 'heavy', prompt: true, base: 5, scale: 1.5 },
  'weapon.warHammer': { kind: 'heavy', prompt: true, base: 6, scale: 1.5 },
  'weapon.spear': { kind: 'spike', prompt: true, base: 9, scale: 2 },
  'weapon.glaive': { kind: 'spike', prompt: true, base: 12, scale: 2.5 },
  'weapon.quarterstaff': { kind: 'defensive', prompt: false, base: 3, scale: 1 },
  'weapon.scimitar': { kind: 'dance', prompt: false, base: 3, scale: 1 },
  'weapon.roundShield': { kind: 'guard', prompt: false, base: 5, scale: 1 },
  'weapon.greatshield': { kind: 'guard', prompt: false, base: 3, scale: 1 },
  'weapon.whip': { kind: 'whip', prompt: false, base: 0, scale: 0 },
  'weapon.sickle': { kind: 'harvest', prompt: true, base: 15, scale: 2.5 },
  'weapon.warScythe': { kind: 'harvest', prompt: true, base: 30, scale: 4.5 },
  'weapon.flail': { kind: 'spin', prompt: false, base: 8, scale: 2 },
  'weapon.runicBlade': { kind: 'runic', prompt: true, base: 300, scale: 50 },
  'weapon.crossbow': { kind: 'charged', prompt: false, base: 3, scale: 1 },
  'weapon.greataxe': { kind: 'axe', prompt: true, base: 15, scale: 2 },
  'weapon.pickaxe': { kind: 'pick', prompt: true, base: 8, scale: 2 },
};

/** Whether a weapon has an ability for the Duelist to use (the mage's staff has none). */
export const hasAbility = (item: Item | null | undefined): item is Item => !!item && ABILITIES[item.kind] !== undefined;
export const abilityKind = (item: Item): AbilityKind | undefined => ABILITIES[item.kind]?.kind;
/** Whether the ability asks for a cell to aim at (MeleeWeapon.targetingPrompt). */
export const abilityAims = (item: Item): boolean => ABILITIES[item.kind]?.prompt === true;

/** The weapon in hand or the second one. */
export const weaponOf = (hero: Hero, which: 'weapon' | 'second'): Item | null => (which === 'second' ? hero.secondWep ?? null : hero.weapon);

/* The numbers */

/** Weapon.buffedLvl for an ability: the level, and the champion's twin upgrades (MeleeWeapon.buffedLvl). */
export function buffedLevel(hero: Hero | null, wep: Item): number {
  const own = gearLevel(wep);
  if (!hero || !hasTalent(hero, 'TWIN_UPGRADES') || (hero.weapon !== wep && hero.secondWep !== wep)) return own;
  const other = hero.weapon === wep ? hero.secondWep : hero.weapon;
  if (!other || itemDef(other.kind).category !== 'weapon') return own;
  // The weaker weapon needs to be 2/1/0 tiers lower, by the talent's level.
  if (itemDef(wep.kind).tier! + (3 - pointsIn(hero, 'TWIN_UPGRADES')) <= itemDef(other.kind).tier! && gearLevel(other) > own) return gearLevel(other);
  return own;
}

/** The damage an ability adds to the blow (before the augment): the first number of every `ability_desc`. */
const boost = (def: AbilityDef, lvl: number): number => def.base + (Number.isInteger(def.scale) ? def.scale * lvl : jround(def.scale * lvl));

/** The number a weapon's ability adds at a level: a damage boost, a bleed, a duration or a percentage, as its text tells. */
export function abilityBoost(item: Item, lvl: number): number {
  const def = ABILITIES[item.kind]!;
  switch (def.kind) {
    case 'sneak': return def.base + lvl;
    case 'defensive': case 'dance': return 4 + lvl;
    case 'guard': return def.base + lvl;
    case 'charged': return 3 + lvl;
    case 'runic': return 300 + 50 * lvl;
    case 'whip': return 0;
    case 'harvest': return augmentDamage(item, boost(def, lvl));
    case 'spin': return augmentDamage(item, 8 + 2 * lvl);
    case 'combo': return augmentDamage(item, def.base + lvl);
    default: return augmentDamage(item, boost(def, lvl));
  }
}

/**
 * Weapon.abilityInfo's numbers for the text (ability_desc, or typical_ability_desc while the level is unknown):
 * the range of damage the blow deals, or the one number the ability is about.
 */
export function abilityInfoArgs(item: Item, known: boolean): number[] {
  const def = ABILITIES[item.kind];
  if (!def) return [];
  const lvl = known ? gearLevel(item) : 0;
  const plus = abilityBoost(item, lvl);
  switch (def.kind) {
    case 'cleave': case 'heavy': case 'lunge': case 'spike': case 'axe': case 'pick':
      return [known ? augmentDamage(item, meleeMin(item, lvl)) + plus : meleeMin(item, 0) + plus, known ? augmentDamage(item, meleeMax(item, lvl)) + plus : meleeMax(item, 0) + plus];
    case 'whip':
      return [known ? augmentDamage(item, meleeMin(item, lvl)) : meleeMin(item, 0), known ? augmentDamage(item, meleeMax(item, lvl)) : meleeMax(item, 0)];
    case 'charged': return [3 + lvl, 3 + lvl];
    default: return [plus];
  }
}

/* Charge use, targets and refusals */

/** Weapon.baseChargeUse: a free cleave while a kill keeps the chain going, a free spin once the flail has begun. */
export function chargeUse(hero: Hero, wep: Item): number {
  const kind = ABILITIES[wep.kind]?.kind;
  if (kind === 'cleave' && hasTimer(hero, 'cleave')) return 0;
  if (kind === 'spin' && hasTimer(hero, 'spin')) return 0;
  return 1;
}

/** Hero.canAttack for a weapon: adjacent, or within its reach along open ground (KindOfWeapon.canReach). */
export function weaponReach(hero: Hero, wep: Item): number {
  let reach = weaponRch(wep.kind);
  if (wep.enchant === 'projecting') reach += 1;
  if (hero.cls?.ascend) reach += 2;
  return reach;
}
const canHit = (world: World, hero: Hero, wep: Item, target: Mob): boolean =>
  adjacent(hero.pos, target.pos) || canReach(world, world.levels[hero.depth]!, hero, target.pos, weaponReach(hero, wep));

/** A monster that can be struck: a hero's ability does not hit friends, sleepers' dreams or quest givers. */
const foeAt = (world: World, hero: Hero, cell: number): Mob | null => {
  const there = Number.isInteger(cell) && cell >= 0 && cell < LENGTH ? charAt(world, hero.depth, cell) : undefined;
  if (!there || isHero(there) || !isAlive(there) || there.state === 'passive' || there.ally) return null;
  return there;
};

const NO_TARGET = 'art:items.weapon.melee.meleeweapon.ability_no_target';
const OUT_OF_RANGE = 'art:items.weapon.melee.meleeweapon.ability_target_range';
const OCCUPIED = 'art:items.weapon.melee.meleeweapon.ability_occupied';
const CANT_USE = 'art:items.weapon.melee.meleeweapon.ability_cant_use';

/** The target families share this: a foe in sight, not the one that charmed the hero, within the weapon's reach. */
function strikeProblem(world: World, hero: Hero, wep: Item, cell: number): string | null {
  const foe = foeAt(world, hero, cell);
  if (!foe || !heroView(world, hero)[cell] || (hero.charmed > 0 && hero.charmedBy === foe.id)) return NO_TARGET;
  return canHit(world, hero, wep, foe) ? null : OUT_OF_RANGE;
}

/** Why the weapon's ability cannot be used now, or null (MeleeWeapon.execute and each duelistAbility's early returns). */
export function abilityProblem(world: World, hero: Hero, which: 'weapon' | 'second', cell: number | undefined): string | null {
  if (hero.heroClass !== 'duelist') return 'you are no duelist';
  const wep = weaponOf(hero, which);
  if (!wep || !hasAbility(wep)) return 'no weapon with an ability';
  if (which === 'second' && hero.subclass !== 'champion') return 'no second weapon';
  if (meleeStr(wep) > heroStr(hero)) return 'art:items.weapon.melee.meleeweapon.ability_low_str';
  if (chargeTotal(hero) < chargeUse(hero, wep)) return 'art:items.weapon.melee.meleeweapon.ability_no_charge';
  const def = ABILITIES[wep.kind]!;
  if (def.prompt && (cell === undefined || !Number.isInteger(cell) || cell < 0 || cell >= LENGTH)) return 'choose a target';
  const level = world.levels[hero.depth]!;
  switch (def.kind) {
    case 'cleave': case 'combo': case 'heavy': case 'runic': case 'harvest': case 'pick':
      return strikeProblem(world, hero, wep, cell!);
    case 'spike': {
      const bad = strikeProblem(world, hero, wep, cell!);
      if (bad) return bad;
      return adjacent(hero.pos, cell!) ? OUT_OF_RANGE : null;
    }
    case 'axe':
      if (hero.hp / hero.ht >= 0.5) return CANT_USE;
      return strikeProblem(world, hero, wep, cell!);
    case 'sneak': {
      if (hero.rooted > 0 || !heroView(world, hero)[cell!] || sneakDistance(world, hero, cell!, def.dist!) < 0) return OUT_OF_RANGE;
      return charAt(world, hero.depth, cell!) ? OCCUPIED : null;
    }
    case 'lunge': {
      // The duelist can lunge out of her sight, but a target in sight must be a foe.
      if (heroView(world, hero)[cell!]) {
        const foe = foeAt(world, hero, cell!);
        if (!foe || (hero.charmed > 0 && hero.charmedBy === foe.id)) return NO_TARGET;
      }
      const reach = weaponReach(hero, wep);
      if (hero.rooted > 0 || distance(hero.pos, cell!) < 2 || distance(hero.pos, cell!) - 1 > reach) return OUT_OF_RANGE;
      return lungeCell(world, level, hero, wep, cell!) < 0 ? OUT_OF_RANGE : null;
    }
    case 'whip':
      return whipTargets(world, hero, wep).length === 0 ? NO_TARGET : null;
    case 'spin':
      return (cs(hero).spins ?? 0) >= 3 && hasTimer(hero, 'spin') ? 'art:items.weapon.melee.flail.spin_warn' : null;
    case 'charged':
      return cs(hero).charged ? CANT_USE : null;
    default:
      return null;
  }
}

/** The path distance to a cell over open ground (BArray.or(passable, avoid), PathFinder.buildDistanceMap with a limit); -1 beyond the limit. */
function sneakDistance(world: World, hero: Hero, cell: number, max: number): number {
  const level = world.levels[hero.depth]!;
  const seen = new Map<number, number>([[hero.pos, 0]]);
  const queue = [hero.pos];
  for (let head = 0; head < queue.length; head++) {
    const at = queue[head]!;
    const d = seen.get(at)!;
    if (at === cell) return d;
    if (d >= max) continue;
    for (const n of NEIGHBOURS8) {
      const next = at + n;
      if (next < 0 || next >= LENGTH || seen.has(next) || !adjacent(at, next)) continue;
      const t = level.map[next]!;
      if (!hasFlag(t, F.PASSABLE) && !hasFlag(t, F.AVOID)) continue;
      seen.set(next, d + 1);
      queue.push(next);
    }
  }
  return -1;
}

/** Squared distance, for comparing how far cells are as the crow flies (Level.trueDistance without a root). */
const trueDistance2 = (a: number, b: number): number => (cellX(a) - cellX(b)) ** 2 + (cellY(a) - cellY(b)) ** 2;

/** Rapier.lungeAbility's cell: next to the hero, within the weapon's reach of the target, free, the nearest to it as the crow flies. */
function lungeCell(world: World, level: World['levels'][number], hero: Hero, wep: Item, target: number): number {
  const reach = weaponReach(hero, wep);
  let best = -1;
  for (const n of NEIGHBOURS8) {
    const c = hero.pos + n;
    if (c < 0 || c >= LENGTH || !adjacent(hero.pos, c)) continue;
    if (distance(c, target) <= reach && !charAt(world, hero.depth, c) && canEnter(level, c)) {
      if (best === -1 || trueDistance2(c, target) < trueDistance2(best, target)) best = c;
    }
  }
  return best;
}

/** Whip.duelistAbility: every enemy in sight the hero could strike with the whip. */
function whipTargets(world: World, hero: Hero, wep: Item): Mob[] {
  const seen = heroView(world, hero);
  return (world.floors[hero.depth]?.mobs ?? []).filter((mob) =>
    isAlive(mob) && isEnemy(mob) && seen[mob.pos] && !(hero.charmed > 0 && hero.charmedBy === mob.id) && canHit(world, hero, wep, mob));
}

/* Using an ability */

/** An effect for the client (classfx.ts). */
function say(ctx: Ctx, hero: Hero, fx: ClassFx): void {
  ctx.effects.push({ type: 'classFx', depth: ctx.depth, hero: hero.id, fx });
}

/** MeleeWeapon.beforeAbilityUsed: the charges go; a hurt Duelist with the aggressive barrier is shielded. */
function before(ctx: Ctx, hero: Hero, wep: Item, cost: number): void {
  spendCharges(hero, cost);
  onBeforeAbility(ctx, hero);
  void wep;
}

/** MeleeWeapon.afterAbilityUsed. */
function after(ctx: Ctx, hero: Hero, wep: Item): void {
  onAbilityUsed(ctx, hero, wep);
}

/** One blow of an ability: Char.attack with its multiplier and bonus, never missing; true if it hit. */
function blow(ctx: Ctx, hero: Hero, foe: Mob, wep: Item, multi: number, bonus: number): boolean {
  return attack(ctx, hero, foe, { ability: wep, dmgMulti: multi, dmgBonus: bonus, accMulti: Infinity });
}

/** Uses the weapon's ability, returning the time it took (Hero.spendAndNext, or none for the instant ones). */
export function useAbility(ctx: Ctx, hero: Hero, which: 'weapon' | 'second', cell: number | undefined): number {
  const wep = weaponOf(hero, which)!;
  const def = ABILITIES[wep.kind]!;
  const lvl = buffedLevel(hero, wep);
  const cost = chargeUse(hero, wep);
  const plus = abilityBoost(wep, lvl);
  const delay = (): number => heroAttackDelay(hero);
  switch (def.kind) {
    case 'cleave': {
      // Sword.cleaveAbility: a kill is instant, and the next cleave within five turns is free.
      const foe = foeAt(ctx.world, hero, cell!)!;
      before(ctx, hero, wep, cost);
      say(ctx, hero, { k: 'strike', at: foe.pos });
      if (blow(ctx, hero, foe, wep, 1, plus)) say(ctx, hero, { k: 'strong', at: foe.pos });
      dispelInvisibility(ctx, hero);
      let time: number;
      if (!isAlive(foe)) {
        time = 0;
        onAbilityKill(ctx, hero, foe);
        // Buff.prolong(CleaveTracker, 4): one less as the attack was instant.
        if (hasTimer(hero, 'cleave')) clearTimer(hero, 'cleave');
        else setTimer(hero, 'cleave', 4);
      } else {
        time = delay();
        clearTimer(hero, 'cleave');
      }
      after(ctx, hero, wep);
      return time;
    }
    case 'combo': {
      // Sai.comboStrikeAbility: each hit in a row since the last ability adds its boost.
      const foe = foeAt(ctx.world, hero, cell!)!;
      before(ctx, hero, wep, cost);
      say(ctx, hero, { k: 'strike', at: foe.pos });
      const recent = cs(hero).combo?.hits ?? 0;
      delete cs(hero).combo;
      const hit = blow(ctx, hero, foe, wep, 1, plus * recent);
      if (hit && !isAlive(foe)) onAbilityKill(ctx, hero, foe);
      dispelInvisibility(ctx, hero);
      if (recent >= 2 && hit) say(ctx, hero, { k: 'strong', at: foe.pos });
      after(ctx, hero, wep);
      return delay();
    }
    case 'sneak': {
      // Dagger.sneakAbility: a step to a free cell within reach, unseen for a few turns.
      before(ctx, hero, wep, cost);
      // Buff.prolong(Invisibility, turns - 1): the ability is instant.
      hero.invisible = Math.max(hero.invisible, 2 + lvl - 1);
      leaveCell(ctx.world, ctx.level, ctx.depth, hero.pos);
      hero.pos = cell!;
      enterCell(ctx.level, hero.pos);
      press(ctx, hero);
      say(ctx, hero, { k: 'puff', at: hero.pos });
      after(ctx, hero, wep);
      return 0;
    }
    case 'lunge': {
      // Rapier.lungeAbility.
      const foe = foeAt(ctx.world, hero, cell!);
      const dest = lungeCell(ctx.world, ctx.level, hero, wep, cell!);
      const from = hero.pos;
      leaveCell(ctx.world, ctx.level, ctx.depth, from);
      hero.pos = dest;
      enterCell(ctx.level, dest);
      press(ctx, hero);
      say(ctx, hero, { k: 'lunge', from, to: dest });
      if (foe && isAlive(foe) && canHit(ctx.world, hero, wep, foe)) {
        before(ctx, hero, wep, cost);
        say(ctx, hero, { k: 'strike', at: foe.pos });
        if (blow(ctx, hero, foe, wep, 1, plus)) say(ctx, hero, { k: 'strong', at: foe.pos });
        if (!isAlive(foe)) onAbilityKill(ctx, hero, foe);
        dispelInvisibility(ctx, hero);
        after(ctx, hero, wep);
        return delay();
      }
      // It spends a charge but otherwise does not count as an ability use.
      spendCharges(hero, 1);
      ctx.effects.push({ type: 'artifact', hero: hero.id, msg: 'items.weapon.melee.rapier.ability_no_target', tone: 'w' });
      return 1 / heroSpeed(hero);
    }
    case 'heavy': {
      // Mace.heavyBlowAbility: no extra damage unless the foe is taken by surprise; a foe left standing is dazed.
      const foe = foeAt(ctx.world, hero, cell!)!;
      const surprise = hero.invisible > 0 || !foe.enemySeen;
      before(ctx, hero, wep, cost);
      say(ctx, hero, { k: 'strike', at: foe.pos });
      if (blow(ctx, hero, foe, wep, 1, surprise ? plus : 0)) {
        say(ctx, hero, { k: 'strong', at: foe.pos });
        if (isAlive(foe)) {
          // Buff.affect(enemy, Daze, 5).
          prolongMark(foe, 'daze', 5);
          say(ctx, hero, { k: 'mark', at: foe.pos, name: 'daze' });
        } else onAbilityKill(ctx, hero, foe);
      }
      dispelInvisibility(ctx, hero);
      after(ctx, hero, wep);
      return delay();
    }
    case 'spike': {
      // Spear.spikeAbility: the foe is driven back a cell.
      const foe = foeAt(ctx.world, hero, cell!)!;
      before(ctx, hero, wep, cost);
      say(ctx, hero, { k: 'strike', at: foe.pos });
      const old = foe.pos;
      if (blow(ctx, hero, foe, wep, 1, plus)) {
        if (isAlive(foe) && foe.pos === old) throwChar(ctx, foe, beyond(ctx, hero.pos, foe.pos), 1, true);
        else if (!isAlive(foe)) onAbilityKill(ctx, hero, foe);
        say(ctx, hero, { k: 'strong', at: old });
      }
      dispelInvisibility(ctx, hero);
      after(ctx, hero, wep);
      return delay();
    }
    case 'defensive':
      // Quarterstaff: evasion tripled for 3 + level turns (one less, as the ability is instant).
      before(ctx, hero, wep, cost);
      setTimer(hero, 'defensive', 3 + lvl);
      say(ctx, hero, { k: 'operate', weapon: wep.kind });
      after(ctx, hero, wep);
      return 0;
    case 'dance':
      // Scimitar: sword dance, 1.5 times as accurate and 0.6 faster, for 3 + level turns.
      before(ctx, hero, wep, cost);
      setTimer(hero, 'dance', 3 + lvl);
      say(ctx, hero, { k: 'operate', weapon: wep.kind });
      after(ctx, hero, wep);
      return 0;
    case 'guard':
      // RoundShield.guardAbility: the next blow is dodged; it takes a turn.
      before(ctx, hero, wep, cost);
      setTimer(hero, 'guard', def.base + lvl);
      cs(hero).blocked = false;
      say(ctx, hero, { k: 'operate', weapon: wep.kind });
      after(ctx, hero, wep);
      return 1;
    case 'whip': {
      const foes = whipTargets(ctx.world, hero, wep);
      let closest = foes[0]!;
      for (const mob of foes) if (trueDistance2(hero.pos, mob.pos) < trueDistance2(hero.pos, closest.pos)) closest = mob;
      before(ctx, hero, wep, cost);
      say(ctx, hero, { k: 'sound', name: 'whip' });
      say(ctx, hero, { k: 'strike', at: hero.pos });
      for (const mob of foes) {
        // The ability does no extra damage.
        if (!isAlive(mob)) continue;
        blow(ctx, hero, mob, wep, 1, 0);
        if (!isAlive(mob)) onAbilityKill(ctx, hero, mob);
      }
      dispelInvisibility(ctx, hero);
      after(ctx, hero, wep);
      return delay();
    }
    case 'harvest': {
      // Sickle.harvestAbility: the blow's damage becomes bleeding, which lasts and counts as the ability's if it kills.
      const foe = foeAt(ctx.world, hero, cell!)!;
      before(ctx, hero, wep, cost);
      say(ctx, hero, { k: 'strike', at: foe.pos });
      cs(hero).harvest = true;
      if (blow(ctx, hero, foe, wep, 0, plus)) say(ctx, hero, { k: 'strong', at: foe.pos });
      delete cs(hero).harvest;
      dispelInvisibility(ctx, hero);
      if (!isAlive(foe)) onAbilityKill(ctx, hero, foe);
      after(ctx, hero, wep);
      return delay();
    }
    case 'spin': {
      // Flail: a spin gathers force for the next blow, up to three; the first costs a charge, the rest nothing.
      before(ctx, hero, wep, cost);
      const spins = hasTimer(hero, 'spin') ? (cs(hero).spins ?? 0) + 1 : 1;
      cs(hero).spins = spins;
      setTimer(hero, 'spin', 3);
      say(ctx, hero, { k: 'sound', name: `chains${spins}` });
      say(ctx, hero, { k: 'operate', weapon: wep.kind });
      after(ctx, hero, wep);
      return 1;
    }
    case 'runic': {
      // RunicBlade: a slash whose enchantment is three and a half times as likely to work.
      const foe = foeAt(ctx.world, hero, cell!)!;
      before(ctx, hero, wep, cost);
      cs(hero).runic = 3 + 0.5 * lvl;
      say(ctx, hero, { k: 'strike', at: foe.pos });
      if (blow(ctx, hero, foe, wep, 1, 0)) {
        say(ctx, hero, { k: 'strong', at: foe.pos });
        if (!isAlive(foe)) onAbilityKill(ctx, hero, foe);
      }
      delete cs(hero).runic;
      dispelInvisibility(ctx, hero);
      after(ctx, hero, wep);
      return delay();
    }
    case 'charged':
      // Crossbow: the next shot is charged, and cannot miss.
      before(ctx, hero, wep, cost);
      cs(hero).charged = true;
      say(ctx, hero, { k: 'operate', weapon: wep.kind });
      after(ctx, hero, wep);
      return 0;
    case 'axe': {
      // Greataxe: only hurt; a kill is instant.
      const foe = foeAt(ctx.world, hero, cell!)!;
      before(ctx, hero, wep, cost);
      say(ctx, hero, { k: 'strike', at: foe.pos });
      if (blow(ctx, hero, foe, wep, 1, augmentDamage(wep, 15 + 2 * lvl))) say(ctx, hero, { k: 'strong', at: foe.pos });
      dispelInvisibility(ctx, hero);
      let time = delay();
      if (!isAlive(foe)) {
        time = 0;
        onAbilityKill(ctx, hero, foe);
      }
      after(ctx, hero, wep);
      return time;
    }
    case 'pick': {
      // Pickaxe: more against things of metal, swarms, bees, crabs, spinners and scorpios; the foe left standing is vulnerable.
      const foe = foeAt(ctx.world, hero, cell!)!;
      const hard = propertiesOf(foe).includes('inorganic') || ['swarm', 'bee', 'crab', 'spinner', 'scorpio', 'acidic'].includes(foe.kind);
      before(ctx, hero, wep, cost);
      say(ctx, hero, { k: 'strike', at: foe.pos });
      if (blow(ctx, hero, foe, wep, 1, hard ? augmentDamage(wep, 8 + 2 * lvl) : 0)) {
        if (isAlive(foe)) foe.vulnerable = Math.max(foe.vulnerable ?? 0, 3);
        else onAbilityKill(ctx, hero, foe);
        say(ctx, hero, { k: 'strong', at: foe.pos });
      }
      dispelInvisibility(ctx, hero);
      after(ctx, hero, wep);
      return delay();
    }
  }
}

/* The ability's lingering effects in the rest of the rules */

/** Hero.defenseSkill: the quarterstaff's stance triples evasion; a guard dodges the next blow outright (see classDefence). */
export const defensiveStance = (hero: Hero, at: number = hero.time): boolean => hasTimer(hero, 'defensive', at);

/** Sai.ComboStrikeTracker.addHit: a hit on an enemy by a Duelist builds the next combo strike. */
export function addComboHit(hero: Hero, foe: Mob, slain: boolean): void {
  const state = cs(hero);
  const combo = (state.combo ??= { hits: 0, left: 0, initial: 5 });
  combo.hits++;
  if (combo.left <= 5) {
    combo.left = 5;
    combo.initial = 5;
  }
  if (slain) {
    combo.left = 15;
    combo.initial = 15;
  }
  void foe;
}

/** ComboStrikeTracker.act, a turn's worth. */
export function comboTurn(hero: Hero): void {
  const combo = hero.cls?.combo;
  if (!combo) return;
  combo.left -= 1;
  if (combo.left <= 0) delete hero.cls!.combo;
}

/** Flail.accuracyFactor and damageRoll: a spun flail strikes true and hard, once. Returns the damage added, or -1 when there is no spin. */
export function takeSpin(hero: Hero, wep: Item | null): number {
  if (!wep || wep.kind !== 'weapon.flail' || !hasTimer(hero, 'spin')) return -1;
  const spins = cs(hero).spins ?? 0;
  clearTimer(hero, 'spin');
  delete cs(hero).spins;
  return spins * augmentDamage(wep, 8 + 2 * buffedLevel(hero, wep));
}

/**
 * KindOfWeapon.doEquip's swift equip: with the talent, a weapon put on takes no time while the cooldown is not running (or its
 * second use is still unspent). True if this one was swift.
 */
export function swiftEquip(hero: Hero): boolean {
  const points = pointsIn(hero, 'SWIFT_EQUIP');
  if (points === 0) return false;
  const state = cs(hero);
  if (!hasTimer(hero, 'swift')) {
    setTimer(hero, 'swift', 19);
    state.swiftSecond = points === 2;
    return true;
  }
  if (state.swiftSecond) {
    state.swiftSecond = false;
    return true;
  }
  return false;
}

/** Crossbow.proc: the charged shot throws its target four cells back. */
export function chargedShot(ctx: Ctx, hero: Hero, foe: Mob): void {
  delete cs(hero).charged;
  if (isAlive(foe)) throwChar(ctx, foe, beyond(ctx, hero.pos, foe.pos), 4, true);
}

/** Whether the hero holds the weapons' charged crossbow shot for a melee blow with a crossbow. */
export const crossbowCharged = (hero: Hero, wep: Item | null): boolean => !!wep && wep.kind === 'weapon.crossbow' && cs(hero).charged === true;

