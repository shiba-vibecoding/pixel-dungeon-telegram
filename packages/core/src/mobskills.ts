import {
  baseKind, BRUTE_ENRAGED_DAMAGE, createMob, type Hero, isAlive, isMimic, type Mob, type MobKind, MOBS, mobSpeed, mobStats,
} from './actors';
import {
  ADRENALINE_TURNS, bleed, blind, CHARM_TURNS, cripple, degrade, freezeCell, hex, ignite, makeVulnerable, oozeOn, poison,
  weaken,
} from './afflict';
import { appear, getCloser, getFurther, randomDestination, spend } from './ai';
import { ballistica as bolt, MAGIC_BOLT, PROJECTILE, STOP_SOLID, STOP_TARGET, subPath, WONT_STOP } from './ballistica';
import { canAttackWithExtraReach, stepsAround } from './champions';
import { attack, defenseOf, hurt } from './combat';
import { type Char, charAt, type Ctx, enterCell, heroesOn, heroView, isHero, isPassable, isWater, landItem, leaveCell } from './floor';
import { castShadow, terrainBlocksSight } from './fov';
import { seedCorrosive, seedGas, seedWeb } from './gas';
import { createItem, type Item, itemDef, ItemGenerator, randomEnchantment, randomGlyph } from './items';
import { fits, isOpenSpace, mimicPrize } from './mobs';
import type { Rng } from './rng';
import type { World } from './world';
import { exoticChanceMultiplier } from './spawner';
import { distanceMap, getStep, pathLength, reached } from './pathfinder';
import { hasProp } from './props';
import { teleportChar } from './cursed';
import { randomArmor, randomWeapon } from './gear';
import { weaponRch } from './weapons';
import { shieldUp } from './status';
import { burst } from './traps';
import { looseItems } from './bags';
import { isBossDepth } from './level/builder';
import { adjacent, cellX, cellY, distance, LENGTH, trueDistance, NEIGHBOURS4, NEIGHBOURS8, WIDTH } from './level/geometry';
import { F, hasFlag, T } from './level/terrain';
import { BOSS_SLOT, bossScore } from './score';

/*
 * What each of Shattered's monsters does beyond the common Mob AI (ai.ts):
 * the DM-100's lightning, the shamans' bolts of three curses, the warlock's
 * degrading bolt, the elementals' fire, frost, light and chaos, the
 * scorpio's spikes and the trickster's darts; the guard's chains, the
 * necromancer's skeleton and the spectral one's wraiths, the spinner's webs,
 * the DM-200's exhaust and the DM-201's grenades, the golem's teleports, the
 * evil eye's deathgaze, the ripper's leap, the succubus's blink, the monk's
 * focus, the ghouls' pairs that rise again, the brute's last rage, the demon
 * spawner's rippers, the phantom piranha's escape, the thief's getaway, the
 * gnoll exile's peace until provoked, and their blows and wounds.
 */

const TICK = 1;
/** Char.INFINITE_EVASION and INFINITE_ACCURACY. */
export const INFINITE_EVASION = 1_000_000;
export const INFINITE_ACCURACY = 1_000_000;

/** PathFinder.CIRCLE8. */
const CIRCLE8 = [-WIDTH - 1, -WIDTH, -WIDTH + 1, +1, +WIDTH + 1, +WIDTH, +WIDTH - 1, -1] as const;

const solid = (ctx: Ctx, cell: number): boolean => cell < 0 || cell >= LENGTH || hasFlag(ctx.level.map[cell]!, F.SOLID);

/** Whether any hero on the depth sees a cell (Dungeon.level.heroFOV). */
export function seenByHeroes(ctx: Ctx, cell: number): boolean {
  return heroesOn(ctx.world, ctx.depth).some((hero) => heroView(ctx.world, hero)[cell]);
}

const mobById = (ctx: Ctx, id: string | undefined): Mob | undefined =>
  id === undefined ? undefined : ctx.floor.mobs.find((mob) => mob.id === id && isAlive(mob));

/** Adds a monster to the depth, to act `delay` turns from now (GameScene.add(mob, delay)). */
function addMob(ctx: Ctx, mob: Mob, delay = 0): Mob {
  mob.time = ctx.floor.now + delay;
  ctx.floor.mobs.push(mob);
  enterCell(ctx.level, mob.pos);
  return mob;
}

/** The champion a monster passes on to what it brings forth (Buff.revivePersists). */
function inherit(from: Mob, to: Mob): void {
  if (from.champion) {
    to.champion = from.champion;
    if (from.champion === 'growing') to.growth = 1.19;
  }
}

/**
 * Char.hit with magic (a bolt, a beam): the attacker's accuracy counts double against the defender's evasion
 * (a focused monk parries it all the same). Accuracy and evasion as combat.ts weighs them.
 */
export function magicHit(ctx: Ctx, attacker: Mob, defender: Char): boolean {
  const acc = ctx.rng.floatMax(mobStats(attacker).attack) * 2;
  const def = defenseOf(defender, attacker);
  if (def >= INFINITE_EVASION) {
    parried(ctx, defender);
    return false;
  }
  const hit = acc >= ctx.rng.floatMax(def);
  if (!hit) parried(ctx, defender);
  return hit;
}

/** Monk.defenseVerb: a focused monk that dodged has spent its focus (and needs six or seven turns more). */
export function parried(ctx: Ctx, defender: Char): void {
  if (isHero(defender) || !defender.focused) return;
  defender.focused = false;
  defender.focusCooldown = ctx.rng.normalFloat(6, 7);
  ctx.effects.push({ type: 'mobSays', depth: ctx.depth, mob: defender.id, line: 'parried' });
}

/** A monster's spell or missile, as the client shows it. */
function zapFx(ctx: Ctx, mob: Mob, to: number, bolt: MobBolt): void {
  ctx.effects.push({ type: 'mobZap', depth: ctx.depth, mob: mob.id, from: mob.pos, to, bolt });
}

/** What a monster throws or casts: drawn and heard as Shattered shows it (see the client's fx). */
export type MobBolt =
  | 'lightning' | 'shamanRed' | 'shamanBlue' | 'shamanPurple' | 'shadow' | 'fire' | 'frost' | 'light' | 'chaos' | 'web' | 'toxic'
  | 'corrosion' | 'elmo' | 'deathGaze' | 'spike' | 'dart' | 'health' | 'summon' | 'chain';

/** A monster's magic bolt landing, or not: the attack effect, and the harm (`source` for what resists it). */
function boltHits(ctx: Ctx, mob: Mob, enemy: Char, damage: number | null): void {
  ctx.effects.push({ type: 'attack', depth: ctx.depth, attacker: mob.id, target: enemy.id, hit: damage !== null, damage: damage ?? 0 });
  if (damage !== null) hurt(ctx, enemy, damage, mob);
}

/* Ranged attacks */

/** Ballistica.MAGIC_BOLT from the monster reaches its enemy. */
const boltReaches = (ctx: Ctx, mob: Mob, enemy: Char): boolean => bolt(ctx, mob.pos, enemy.pos, MAGIC_BOLT).collisionPos === enemy.pos;

/**
 * Mob.canAttack for those who strike otherwise than at arm's length (undefined: the common way, at arm's length
 * or a champion's reach): a bolt that reaches (DM-100, shamans, warlocks, an elemental once its bolt is ready),
 * a spike or a dart from afar (scorpios, never at arm's length; the trickster), a gnoll exile's spear two steps
 * away, a necromancer never.
 */
export function canAttackSpecial(ctx: Ctx, mob: Mob, enemy: Char): boolean | undefined {
  const near = adjacent(mob.pos, enemy.pos) || canAttackWithExtraReach(ctx, mob, enemy);
  switch (baseKind(mob.kind)) {
    case 'dm100': case 'shaman': case 'warlock':
      return near || boltReaches(ctx, mob, enemy);
    case 'elemental':
      return near || ((mob.rangedCooldown ?? 0) < 0 && boltReaches(ctx, mob, enemy));
    case 'scorpio':
      return !adjacent(mob.pos, enemy.pos) && (near || bolt(ctx, mob.pos, enemy.pos, PROJECTILE).collisionPos === enemy.pos);
    case 'necromancer': case 'spawner':
      return false;
    case 'eye':
      return eyeCanAttack(ctx, mob, enemy);
  }
  switch (mob.kind) {
    case 'gnollTrickster':
      return !adjacent(mob.pos, enemy.pos) && (near || bolt(ctx, mob.pos, enemy.pos, PROJECTILE).collisionPos === enemy.pos);
    // GnollExile.canAttack: its spear reaches two steps, around whoever stands in the way.
    case 'gnollExile':
      return near || (distance(mob.pos, enemy.pos) <= 2 && stepsAround(ctx, enemy.pos, mob.pos, 2) <= 2);
    // Statue.canAttack: a reaching weapon reaches (Weapon.canReach: spears, glaives, whips), around nobody in the way.
    case 'statue': case 'armoredStatue': {
      const reach = mob.item ? weaponRch(mob.item.kind) : 1;
      if (near || reach <= 1) return undefined;
      return distance(mob.pos, enemy.pos) <= reach && bolt(ctx, mob.pos, enemy.pos, PROJECTILE).collisionPos === enemy.pos;
    }
    default:
      return undefined;
  }
}

/**
 * Mob.doAttack for those who strike from afar: true when it did (and spent its time), false for a blow at arm's
 * length the common way.
 */
export function attackSpecial(ctx: Ctx, mob: Mob, enemy: Char): boolean {
  const adjacentNow = adjacent(mob.pos, enemy.pos);
  switch (baseKind(mob.kind)) {
    case 'dm100':
      if (adjacentNow || !boltReaches(ctx, mob, enemy)) return false;
      // DM100.doAttack: a bolt of lightning (DM100.LightningBolt), 3-10.
      spend(mob, TICK);
      zapFx(ctx, mob, enemy.pos, 'lightning');
      boltHits(ctx, mob, enemy, magicHit(ctx, mob, enemy) ? ctx.rng.normalIntRange(3, 10) : null);
      return true;
    case 'shaman': {
      if (adjacentNow || !boltReaches(ctx, mob, enemy)) return false;
      // Shaman.zap: an earthen bolt, 6-15, and half the time its mask's curse.
      spend(mob, TICK);
      const kind = mob.kind === 'blueShaman' ? 'shamanBlue' : mob.kind === 'purpleShaman' ? 'shamanPurple' : 'shamanRed';
      zapFx(ctx, mob, enemy.pos, kind);
      if (magicHit(ctx, mob, enemy)) {
        if (ctx.rng.int(2) === 0) {
          if (kind === 'shamanRed') weaken(enemy);
          else if (kind === 'shamanBlue') makeVulnerable(enemy);
          else hex(enemy);
          if (isHero(enemy)) ctx.effects.push({ type: 'afflicted', hero: enemy.id, by: kind === 'shamanRed' ? 'weakness' : kind === 'shamanBlue' ? 'vulnerable' : 'hex' });
        }
        boltHits(ctx, mob, enemy, ctx.rng.normalIntRange(6, 15));
      } else {
        boltHits(ctx, mob, enemy, null);
      }
      return true;
    }
    case 'warlock':
      if (adjacentNow || !boltReaches(ctx, mob, enemy)) return false;
      // Warlock.zap: a dark bolt, 12-18, that half the time degrades the hero's gear. The King's own (DKWarlock) costs score.
      if (mob.bossMinion && isHero(enemy)) bossScore(ctx.world, BOSS_SLOT.king, -400);
      spend(mob, TICK);
      zapFx(ctx, mob, enemy.pos, 'shadow');
      if (magicHit(ctx, mob, enemy)) {
        if (isHero(enemy) && ctx.rng.int(2) === 0) {
          degrade(enemy);
          ctx.effects.push({ type: 'afflicted', hero: enemy.id, by: 'degrade' });
        }
        boltHits(ctx, mob, enemy, ctx.rng.normalIntRange(12, 18));
      } else {
        boltHits(ctx, mob, enemy, null);
      }
      return true;
    case 'elemental':
      if (adjacentNow || (mob.rangedCooldown ?? 0) > 0 || !boltReaches(ctx, mob, enemy)) return false;
      elementalZap(ctx, mob, enemy);
      return true;
    case 'scorpio':
      // Scorpio: its serrated spike from afar, a blow like any other (Char.attack), drawn as a thrown spike.
      zapFx(ctx, mob, enemy.pos, 'spike');
      attack(ctx, mob, enemy);
      spend(mob, mobStats(mob).attackDelay ?? TICK);
      return true;
    case 'eye':
      return eyeAttack(ctx, mob, enemy);
  }
  if (mob.kind === 'gnollTrickster' && !adjacentNow) {
    // GnollTrickster: a dart from its satchel (MissileSprite with a ParalyticDart), a blow like any other.
    zapFx(ctx, mob, enemy.pos, 'dart');
    attack(ctx, mob, enemy);
    spend(mob, mobStats(mob).attackDelay ?? TICK);
    return true;
  }
  return false;
}

/* Elementals */

/** Elemental.rangedCooldown to start with, and after each bolt. */
export const rollRangedCooldown = (ctx: Pick<Ctx, 'rng'>): number => ctx.rng.normalIntRange(3, 5);

/** Elemental.zap: a bolt of its element (a chaos elemental's always lands). */
function elementalZap(ctx: Ctx, mob: Mob, enemy: Char): void {
  spend(mob, TICK);
  const kind: MobBolt = mob.kind === 'frostElemental' ? 'frost' : mob.kind === 'shockElemental' ? 'light' : mob.kind === 'chaosElemental' ? 'chaos' : 'fire';
  zapFx(ctx, mob, enemy.pos, kind);
  if (mob.kind === 'chaosElemental' || magicHit(ctx, mob, enemy)) {
    rangedProc(ctx, mob, enemy);
    ctx.effects.push({ type: 'attack', depth: ctx.depth, attacker: mob.id, target: enemy.id, hit: true, damage: 0 });
  } else {
    ctx.effects.push({ type: 'attack', depth: ctx.depth, attacker: mob.id, target: enemy.id, hit: false, damage: 0 });
  }
  mob.rangedCooldown = rollRangedCooldown(ctx);
}

/** Elemental.rangedProc: fire sets the target alight for four turns (not in water), frost chills, light blinds, chaos is chaos. */
function rangedProc(ctx: Ctx, mob: Mob, enemy: Char): void {
  switch (mob.kind) {
    case 'elemental':
      if (!isWater(ctx.level.map[enemy.pos]!)) ignite(enemy, 4);
      break;
    case 'frostElemental':
      freezeCell(ctx, enemy.pos);
      break;
    case 'shockElemental':
      blind(enemy, 5);
      if (isHero(enemy)) ctx.effects.push({ type: 'afflicted', hero: enemy.id, by: 'blindness' });
      break;
    case 'chaosElemental':
      cursedEffect(ctx, mob, enemy);
      break;
  }
}

/**
 * CursedWand.cursedZap / randomValidEffect, a chaos elemental's wild magic at its target. SEAM(wands): the cursed
 * wand's effects (cursed.ts cursedZap) are cast by a hero there; for a monster, four of the commonest stand in —
 * flames, frost (Freezing), toxic gas, or the target sent elsewhere (ScrollOfTeleportation.teleportChar).
 */
export function cursedEffect(ctx: Ctx, _mob: Mob, target: Char): void {
  switch (ctx.rng.int(4)) {
    case 0: burst(ctx, target.pos, 'fire', 1, true); break;
    case 1: freezeCell(ctx, target.pos); break;
    case 2: seedGas(ctx, target.pos, 'toxic', 200); break;
    default: teleportChar(ctx, target);
  }
}

/** Elemental.meleeProc: what a blow of each element does besides. */
function meleeProc(ctx: Ctx, mob: Mob, enemy: Char, damage: number): void {
  switch (mob.kind) {
    case 'elemental':
      if (ctx.rng.int(2) === 0 && !isWater(ctx.level.map[enemy.pos]!)) ignite(enemy);
      break;
    case 'frostElemental':
      if (ctx.rng.int(3) === 0 || isWater(ctx.level.map[enemy.pos]!)) freezeCell(ctx, enemy.pos);
      break;
    case 'shockElemental': {
      // Shocking.arc: lightning leaps to everyone within two steps of the target, and on from them; the target
      // itself takes it only in water. Each takes four tenths of the blow.
      const affected: Char[] = [];
      arc(ctx, mob, enemy, 2, affected);
      if (!isWater(ctx.level.map[enemy.pos]!)) affected.splice(affected.indexOf(enemy), 1);
      ctx.effects.push({ type: 'arcs', depth: ctx.depth, from: enemy.pos, cells: affected.map((c) => c.pos) });
      for (const char of affected) {
        if (!isAlive(char)) continue;
        const shock = Math.round(damage * 0.4);
        ctx.effects.push({ type: 'hurt', depth: ctx.depth, who: char.id, damage: shock });
        hurt(ctx, char, shock, mob);
      }
      break;
    }
    case 'chaosElemental':
      cursedEffect(ctx, mob, enemy);
      break;
  }
}

/** Shocking.arc: everyone within `dist` steps of the struck (not through walls), and on from each of them. */
function arc(ctx: Ctx, attacker: Char, defender: Char, dist: number, affected: Char[]): void {
  if (!affected.includes(defender)) affected.push(defender);
  const map = distanceMap(defender.pos, (cell) => !solid(ctx, cell), dist);
  const hit: Char[] = [];
  for (let cell = 0; cell < LENGTH; cell++) {
    if (!reached(map, cell)) continue;
    const char = charAt(ctx.world, ctx.depth, cell);
    if (char && char !== attacker && !affected.includes(char)) hit.push(char);
  }
  affected.push(...hit);
  for (const char of hit) arc(ctx, attacker, char, isWater(ctx.level.map[char.pos]!) ? 2 : 1, affected);
}

/* Blows and wounds */

/**
 * Mob.attackProc of each kind, after a blow landed (`damage` after armour): what it does besides. Returns the
 * damage, as changed.
 */
export function mobAttackProc(ctx: Ctx, mob: Mob, enemy: Char, damage: number): number {
  switch (mob.kind) {
    // Albino.attackProc: half its bites leave the target bleeding.
    case 'albino':
      if (damage > 0 && ctx.rng.int(2) === 0) bleed(ctx.rng, enemy, ctx.rng.normalFloat(2, 3));
      break;
    // CausticSlime.attackProc, FetidRat.attackProc: caustic ooze.
    case 'causticSlime':
      if (ctx.rng.int(2) === 0) oozeOn(ctx, enemy);
      break;
    case 'fetidRat':
      if (ctx.rng.int(3) === 0) oozeOn(ctx, enemy);
      break;
    case 'gnollTrickster': {
      // GnollTrickster.attackProc: the more it is let hit, the worse its darts — poison, then fire.
      mob.combo = (mob.combo ?? 0) + 1;
      const effect = ctx.rng.int(4) + mob.combo;
      if (effect > 2) {
        if (effect >= 6 && (enemy.burning ?? 0) <= 0) {
          if (hasFlag(ctx.level.map[enemy.pos]!, F.FLAMABLE)) burst(ctx, enemy.pos, 'fire', 0, true);
          ignite(enemy);
        } else {
          poison(enemy, effect - 2);
        }
      }
      break;
    }
    // Bat.attackProc: it drinks what it draws, but four.
    case 'bat': {
      const regained = Math.min(damage - 4, mob.ht - mob.hp);
      if (regained > 0) {
        mob.hp += regained;
        ctx.effects.push({ type: 'mobHealed', depth: ctx.depth, mob: mob.id, amount: regained });
      }
      break;
    }
    // Spinner.attackProc: half its bites poison for seven or eight turns, and then it backs off to web its prey.
    case 'spinner':
      if (ctx.rng.int(2) === 0) {
        poison(enemy, ctx.rng.intRange(7, 8));
        mob.webCooldown = 0;
        mob.state = 'fleeing';
      }
      break;
    case 'elemental': case 'frostElemental': case 'shockElemental': case 'chaosElemental':
      meleeProc(ctx, mob, enemy, damage);
      break;
    // Succubus.attackProc: a charmed victim's life feeds her (a shield past her health); else one kiss in three charms.
    case 'succubus':
      if (isHero(enemy) && enemy.charmed > 0) {
        const shield = mob.hp - mob.ht + 5 + damage;
        if (shield > 0) {
          mob.hp = mob.ht;
          // Barrier.setShield: shielding raised to this much (status.ts).
          shieldUp(mob, shield);
        } else {
          mob.hp += 5 + damage;
        }
        ctx.effects.push({ type: 'mobHealed', depth: ctx.depth, mob: mob.id, amount: 5 + damage });
      } else if (ctx.rng.int(3) === 0) {
        charm(ctx, enemy, mob, CHARM_TURNS / 2);
      }
      break;
    // Scorpio.attackProc: half its spikes cripple.
    case 'scorpio':
      if (ctx.rng.int(2) === 0) cripple(enemy);
      break;
    // Acidic.attackProc: its spikes always leave ooze; and they cripple as a scorpio's do.
    case 'acidic':
      oozeOn(ctx, enemy);
      if (ctx.rng.int(2) === 0) cripple(enemy);
      break;
  }
  return damage;
}

/** Charm on a hero (Succubus): for a while they cannot bring themselves to strike her; the first blow they take does not shake it. */
export function charm(ctx: Ctx, enemy: Char, by: Mob, turns: number): void {
  if (!isHero(enemy)) return;
  if (enemy.charmed <= 0) ctx.effects.push({ type: 'charmed', hero: enemy.id });
  enemy.charmed = Math.max(enemy.charmed, turns);
  enemy.charmedBy = by.id;
  enemy.charmShrug = true;
}

/**
 * Mob.defenseProc of each kind, as a blow lands on it (before its armour): a fleeing thief drops a coin, a fetid
 * rat lets out its stench, an acidic scorpio splashes ooze on whoever strikes at arm's length.
 */
export function mobDefenseProc(ctx: Ctx, mob: Mob, enemy: Char, damage: number): number {
  switch (mob.kind) {
    case 'thief': case 'bandit':
      if (mob.state === 'fleeing') landItem(ctx, mob.pos, createItem('gold', 1));
      break;
    // FetidRat.defenseProc: StenchGas, which paralyses for a moment.
    case 'fetidRat':
      seedGas(ctx, mob.pos, 'stench', 20);
      break;
    case 'acidic':
      if (adjacent(mob.pos, enemy.pos)) oozeOn(ctx, enemy);
      break;
  }
  return damage;
}

/**
 * Mob.defenseSkill of each kind: a focused monk parries anything (unless paralysed or asleep), a great crab blocks
 * whatever its current enemy does while it sees it coming.
 */
export function mobDefenseSkill(mob: Mob, attacker: Char | undefined, base: number): number {
  if ((mob.kind === 'monk' || mob.kind === 'senior') && mob.focused && (mob.paralysed ?? 0) <= 0 && mob.state !== 'sleeping') return INFINITE_EVASION;
  if (mob.kind === 'greatCrab' && attacker && mob.enemySeen && mob.state !== 'sleeping' && (mob.paralysed ?? 0) <= 0 &&
    attacker.id === mob.enemy && !(isHero(attacker) && attacker.invisible > 0)) return INFINITE_EVASION;
  return base;
}

/** Mob.damageRoll of those whose blows change: a raging brute's. */
export function mobDamageRange(mob: Mob): readonly [number, number] {
  if (baseKind(mob.kind) === 'brute' && mob.enraged) return BRUTE_ENRAGED_DAMAGE;
  return mobStats(mob).damage;
}

/**
 * Char.damage of each kind, before it is taken: a slime's membrane lets little more than five through, a demon
 * spawner's mass little more than twenty (and it hurries its next ripper), a charging evil eye takes a quarter,
 * a phantom piranha struck from afar half, a great crab that sees the hero's wand coming none. A DM-201 struck
 * from afar (or with its enemy not beside it) feels threatened.
 */
export function mobDamage(ctx: Ctx, mob: Mob, damage: number, source: Char | string | null): number {
  const by = source !== null && typeof source !== 'string' ? source : null;
  switch (mob.kind) {
    case 'slime': case 'causticSlime':
      // Slime.damage: 5/6/7/8/9/10 at 5/7/10/14/19/25 incoming.
      if (damage >= 5) damage = Math.trunc(4 + (Math.sqrt(8 * (damage - 4) + 1) - 1) / 2);
      break;
    case 'spawner':
      if (damage >= 20) damage = 19 + Math.trunc((Math.sqrt(8 * (damage - 19) + 1) - 1) / 2);
      mob.spawnCooldown = (mob.spawnCooldown ?? 0) - damage;
      break;
    case 'eye':
      if (mob.beamCharged) damage = Math.trunc(damage / 4);
      break;
    case 'dm201': {
      const enemy = mob.enemy ? findChar(ctx, mob.enemy) : undefined;
      if ((by && !adjacent(mob.pos, by.pos)) || !enemy || !adjacent(mob.pos, enemy.pos)) mob.threatened = true;
      break;
    }
    case 'phantomPiranha':
      if (!by || !adjacent(mob.pos, by.pos)) damage = Math.round(damage / 2);
      break;
    case 'greatCrab':
      // GreatCrab.damage: it blocks the hero's wands (the zapped hero is its enemy and seen).
      if (source === 'wand' && mob.enemySeen && mob.state !== 'sleeping' && (mob.paralysed ?? 0) <= 0) {
        const enemy = mob.enemy ? findChar(ctx, mob.enemy) : undefined;
        if (enemy && isHero(enemy) && enemy.invisible <= 0) {
          ctx.effects.push({ type: 'mobSays', depth: ctx.depth, mob: mob.id, line: 'blocked' });
          return 0;
        }
      }
      break;
  }
  return damage;
}

const findChar = (ctx: Ctx, id: string): Char | undefined =>
  heroesOn(ctx.world, ctx.depth).find((hero) => hero.id === id) ?? mobById(ctx, id);

/** PhantomPiranha.damage, after the blow: struck from afar, it teleports beside its attacker (if there is water there), or away. */
export function afterDamage(ctx: Ctx, mob: Mob, source: Char | string | null): void {
  if (mob.kind !== 'phantomPiranha' || !isAlive(mob)) return;
  const by = source !== null && typeof source !== 'string' ? source : null;
  if (by && adjacent(mob.pos, by.pos)) return;
  if (by) {
    const cells = NEIGHBOURS8.map((n) => by.pos + n).filter((c) => isWater(ctx.level.map[c]!) && !charAt(ctx.world, ctx.depth, c));
    if (cells.length > 0) {
      appear(ctx, mob, ctx.rng.element(cells)!);
      mob.enemy = by.id;
      if (mob.state !== 'passive') mob.state = 'hunting';
      return;
    }
  }
  teleportAway(ctx, mob);
}

/** PhantomPiranha.teleportAway: to water out of the heroes' sight if there is any, else anywhere in water. */
export function teleportAway(ctx: Ctx, mob: Mob): boolean {
  const unseen: number[] = [];
  const seen: number[] = [];
  for (let cell = 0; cell < LENGTH; cell++) {
    if (!isWater(ctx.level.map[cell]!) || charAt(ctx.world, ctx.depth, cell)) continue;
    (seenByHeroes(ctx, cell) ? seen : unseen).push(cell);
  }
  const pool = unseen.length > 0 ? unseen : seen;
  if (pool.length === 0) return false;
  if (unseen.length > 0 && seenByHeroes(ctx, mob.pos)) ctx.effects.push({ type: 'mobSays', depth: ctx.depth, mob: mob.id, line: 'teleportAway' });
  appear(ctx, mob, ctx.rng.element(pool)!);
  return true;
}

/* Cheating death */

/**
 * What keeps a monster up as its health runs out: a brute's last rage (Brute.isAlive with BruteRage: a shield of
 * half its health and four, worn away four a turn, an armoured brute's one every three turns, while it hits far
 * harder), a ghoul that crumples to rise again beside a living one. True if it is not dead yet. Not for a fall.
 */
export function cheatDeath(ctx: Ctx, mob: Mob, cause: Char | string | null): boolean {
  if (cause === 'fall') {
    if (baseKind(mob.kind) === 'brute') mob.hasRaged = true;
    return false;
  }
  if (cause === 'lifelink' || cause === 'rage') return false;
  if (baseKind(mob.kind) === 'brute' && !mob.hasRaged) {
    mob.hasRaged = true;
    mob.enraged = true;
    mob.rageShield = Math.trunc(mob.ht / 2) + (mob.kind === 'shielded' ? 1 : 4);
    mob.hp = mob.rageShield;
    mob.time += TICK;
    ctx.effects.push({ type: 'enraged', depth: ctx.depth, mob: mob.id });
    return true;
  }
  if (mob.kind === 'ghoul' && !hasFlag(ctx.level.map[mob.pos]!, F.PIT)) return crumple(ctx, mob);
  return false;
}

/** BruteRage.act (ArmoredRage every third turn): the rage wears away; once spent, the brute dies. */
export function rageTick(ctx: Ctx, mob: Mob): boolean {
  if (!mob.enraged) return false;
  const loss = mob.kind === 'shielded' ? (ctx.floor.now % 3 < 1 ? 1 : 0) : 4;
  if (loss === 0) return false;
  ctx.effects.push({ type: 'hurt', depth: ctx.depth, who: mob.id, damage: Math.min(loss, mob.hp) });
  hurt(ctx, mob, loss, 'rage');
  return !isAlive(mob);
}

/* Ghouls */

/**
 * Ghoul.act: a ghoul comes with a partner, made beside it the first time it acts (awake if it is); they keep to
 * each other.
 */
function ghoulPartner(ctx: Ctx, mob: Mob): void {
  if (mob.partner !== undefined) return;
  const cells = [mob.pos + 1, mob.pos - 1, mob.pos + WIDTH, mob.pos - WIDTH]
    .filter((c) => isPassable(ctx.level, c) && !charAt(ctx.world, ctx.depth, c) && fits(ctx.level, mob, c));
  mob.partner = '';
  if (cells.length === 0) return;
  const child = createMob(`#${++ctx.world.nextId}`, 'ghoul', ctx.rng.element(cells)!, mob.state === 'sleeping' ? 'sleeping' : 'wandering', 0);
  child.partner = mob.id;
  mob.partner = child.id;
  inherit(mob, child);
  addMob(ctx, child);
  ctx.effects.push({ type: 'pushed', depth: ctx.depth, mob: child.id, from: mob.pos, to: child.pos });
}

/** GhoulLifeLink.searchForHost: another ghoul that sees the fallen one or is within four steps of it. */
function ghoulHost(ctx: Ctx, fallen: Mob, except?: string): Mob | undefined {
  for (const other of ctx.floor.mobs) {
    if (other === fallen || other.id === except || other.kind !== 'ghoul' || !isAlive(other)) continue;
    const fov = castShadow(other.pos, terrainBlocksSight(ctx.level.map), 8);
    if (fov[fallen.pos] || distance(other.pos, fallen.pos) < 4) return other;
  }
  return undefined;
}

/** Ghoul.die: with another ghoul near, it crumples instead, to rise again in five turns (five more each time it falls). */
function crumple(ctx: Ctx, mob: Mob): boolean {
  const host = ghoulHost(ctx, mob);
  if (!host) return false;
  mob.timesDowned = (mob.timesDowned ?? 0) + 1;
  mob.hp = 0;
  ctx.floor.mobs.splice(ctx.floor.mobs.indexOf(mob), 1);
  leaveCell(ctx.world, ctx.level, ctx.depth, mob.pos);
  (ctx.floor.downed ??= []).push({ mob, host: host.id, turns: mob.timesDowned * 5 });
  ctx.effects.push({ type: 'crumpled', depth: ctx.depth, mob: mob.id, pos: mob.pos });
  return true;
}

/**
 * GhoulLifeLink.act, on the host's turn: the fallen ghoul rises once its turns are up (with a tenth of its health,
 * beside its place if someone stands on it), unless its host loses sight of it (another ghoul takes it over, or it
 * dies for good) or it lies over a chasm.
 */
function lifeLinks(ctx: Ctx, host: Mob): void {
  for (const link of [...(ctx.floor.downed ?? [])]) {
    if (link.host !== host.id) continue;
    const ghoul = link.mob;
    const fov = castShadow(host.pos, terrainBlocksSight(ctx.level.map), 8);
    if (!fov[ghoul.pos] && distance(ghoul.pos, host.pos) >= 4) {
      relink(ctx, link);
      continue;
    }
    if (hasFlag(ctx.level.map[ghoul.pos]!, F.PIT)) {
      dropLink(ctx, link);
      finishGhoul(ctx, ghoul);
      continue;
    }
    if (--link.turns > 0) continue;
    if (charAt(ctx.world, ctx.depth, ghoul.pos)) {
      const cells = NEIGHBOURS8.map((n) => ghoul.pos + n).filter((c) => isPassable(ctx.level, c) && !charAt(ctx.world, ctx.depth, c) && fits(ctx.level, ghoul, c));
      if (cells.length === 0) {
        link.turns = 0;
        continue;
      }
      ghoul.pos = ctx.rng.element(cells)!;
    }
    dropLink(ctx, link);
    ghoul.hp = Math.round(ghoul.ht / 10);
    ghoul.time = ctx.floor.now;
    if (ghoul.enemy && !findChar(ctx, ghoul.enemy)) ghoul.enemy = null;
    addMob(ctx, ghoul, 0);
    ctx.effects.push({ type: 'mobHealed', depth: ctx.depth, mob: ghoul.id, amount: ghoul.hp });
  }
}

function dropLink(ctx: Ctx, link: DownedGhoul): void {
  const downed = ctx.floor.downed ?? [];
  downed.splice(downed.indexOf(link), 1);
  if (downed.length === 0) delete ctx.floor.downed;
}

/** GhoulLifeLink.detach: another host takes the fallen one over, or it dies for good. */
function relink(ctx: Ctx, link: DownedGhoul): void {
  const host = ghoulHost(ctx, link.mob, link.host);
  if (host) {
    link.host = host.id;
    return;
  }
  dropLink(ctx, link);
  finishGhoul(ctx, link.mob);
}

/** The ghoul dies after all (Ghoul.die from GhoulLifeLink): back in the list a moment, to die the common way. */
function finishGhoul(ctx: Ctx, ghoul: Mob): void {
  ghoul.hp = 1;
  ctx.floor.mobs.push(ghoul);
  hurt(ctx, ghoul, 1, 'lifelink');
}

/** A host gone: whoever it held up is passed on, or dies (GhoulLifeLink.detach as the host dies). */
export function hostGone(ctx: Ctx, host: Mob): void {
  for (const link of [...(ctx.floor.downed ?? [])]) if (link.host === host.id) relink(ctx, link);
}

/** A ghoul lying crumpled, held up by another (GhoulLifeLink): the ghoul, its host, and the turns until it rises. */
export interface DownedGhoul {
  mob: Mob;
  host: string;
  turns: number;
}

/* Before and after a monster's turn */

/**
 * The part of a monster's turn before its AI (each kind's act before Mob.act): cooldowns, a growing champion,
 * a ghoul's partner and the fallen it holds up, a demon spawner's rippers, a golem's teleport, a necromancer or an
 * eye giving up when the hunt is over. True if that took its turn.
 */
export function mobPreAct(ctx: Ctx, mob: Mob): boolean {
  switch (baseKind(mob.kind)) {
    case 'spinner':
      if (mob.state === 'hunting' || mob.state === 'fleeing') mob.webCooldown = (mob.webCooldown ?? 0) - 1;
      break;
    case 'dm200':
      mob.ventCooldown = (mob.ventCooldown ?? 0) - 1;
      break;
    case 'elemental':
      mob.rangedCooldown ??= rollRangedCooldown(ctx);
      if (mob.state === 'hunting') mob.rangedCooldown--;
      break;
    case 'eye':
      if (mob.beamCharged && mob.state !== 'hunting') mob.beamCharged = false;
      if ((mob.beamCooldown ?? 0) > 0) mob.beamCooldown!--;
      break;
    case 'necromancer':
      if (mob.summoning && mob.state !== 'hunting') {
        mob.summoning = false;
        ctx.effects.push({ type: 'summoning', depth: ctx.depth, mob: mob.id, pos: -1 });
      }
      break;
    case 'ghoul':
      ghoulPartner(ctx, mob);
      lifeLinks(ctx, mob);
      break;
    case 'ripper':
      if (mob.state === 'wandering') mob.leapPos = -1;
      break;
    case 'golem':
      mob.selfTele = (mob.selfTele ?? 0) - 1;
      mob.enemyTele = (mob.enemyTele ?? 0) - 1;
      if (mob.teleporting) {
        // Golem.act: the teleport it gathered for, if the spot is still free and open; else it looks elsewhere.
        if (!charAt(ctx.world, ctx.depth, mob.target) && isOpenSpace(ctx.level, mob.target)) {
          const from = mob.pos;
          appear(ctx, mob, mob.target);
          ctx.effects.push({ type: 'mobTeleported', depth: ctx.depth, mob: mob.id, from, to: mob.pos });
          mob.selfTele = 30;
        } else {
          mob.target = randomDestination(ctx, mob);
        }
        mob.teleporting = false;
        spend(mob, TICK);
        return true;
      }
      break;
    case 'spawner':
      spawnRipper(ctx, mob);
      break;
  }
  if (rageTick(ctx, mob)) return true;
  return false;
}

/**
 * The part after its AI: a monk focuses again once its cooldown is over (Monk.act), a spinner and a ripper keep
 * an eye on where their enemy was (lastEnemyPos), a ripper's leap comes nearer.
 */
export function mobPostAct(ctx: Ctx, mob: Mob, lastState: Mob['state'], enemy: Char | undefined): void {
  switch (baseKind(mob.kind)) {
    case 'monk':
      if (!mob.focused && mob.state === 'hunting' && (mob.focusCooldown ?? 0) <= 0) mob.focused = true;
      break;
    case 'spinner':
      if (!(lastState === 'wandering' && mob.state === 'hunting')) {
        mob.lastEnemyPos = enemy && mob.enemySeen ? enemy.pos : heroesOn(ctx.world, ctx.depth)[0]?.pos ?? -1;
      }
      break;
    case 'ripper':
      if ((mob.paralysed ?? 0) <= 0) mob.leapCooldown = (mob.leapCooldown ?? 0) - 1;
      if (!(lastState === 'wandering' && mob.state === 'hunting')) {
        mob.lastEnemyPos = enemy ? enemy.pos : heroesOn(ctx.world, ctx.depth)[0]?.pos ?? -1;
      }
      break;
  }
}

/** Monk.spend and Monk.move: focus comes back with time, and the quicker on the move (a senior's twice as quick). */
export function focusTime(mob: Mob, time: number, travelling: boolean): void {
  if (mob.kind !== 'monk' && mob.kind !== 'senior') return;
  mob.focusCooldown = (mob.focusCooldown ?? 0) - time;
  if (travelling) mob.focusCooldown -= mob.kind === 'senior' ? 0.67 + 1.66 : 0.67;
}

/* The demon spawner */

/**
 * DemonSpawner.act: every sixty turns (less on the deeper halls, and the sooner the more it is hurt) a ripper demon
 * crawls out beside it, hunting; it never stores more than one.
 */
function spawnRipper(ctx: Ctx, mob: Mob): void {
  mob.spawnCooldown = (mob.spawnCooldown ?? 0) - 1;
  if (mob.spawnCooldown <= 0) {
    if (mob.spawnCooldown < -20) mob.spawnCooldown = -20;
    const cells = NEIGHBOURS8.map((n) => mob.pos + n).filter((c) => isPassable(ctx.level, c) && !charAt(ctx.world, ctx.depth, c));
    if (cells.length > 0) {
      const ripper = createMob(`#${++ctx.world.nextId}`, 'ripper', ctx.rng.element(cells)!, 'hunting', 0);
      ripper.enemy = mob.enemy;
      addMob(ctx, ripper, 1);
      ctx.effects.push({ type: 'pushed', depth: ctx.depth, mob: ripper.id, from: mob.pos, to: ripper.pos });
      mob.spawnCooldown += 60;
      if (ctx.depth > 21) mob.spawnCooldown -= Math.min(20, (ctx.depth - 21) * 6.67);
    }
  }
  mob.alerted = false;
}

/* The hunt, kind by kind */

/**
 * Each kind's Hunting.act where it differs from Mob.Hunting: true if it took the turn. Called with the enemy it
 * chose and whether it sees it.
 */
export function huntSpecial(ctx: Ctx, mob: Mob, enemy: Char | undefined, enemyInFov: boolean, fov: boolean[]): boolean {
  switch (baseKind(mob.kind)) {
    case 'guard':
      return guardHunt(ctx, mob, enemy, enemyInFov);
    case 'necromancer':
      return necromancerHunt(ctx, mob, enemy, enemyInFov, fov);
    case 'dm200':
      return mob.kind === 'dm201' ? dm201Hunt(ctx, mob, enemy, enemyInFov) : ventHunt(ctx, mob, enemy, enemyInFov, fov);
    case 'golem':
      return ventHunt(ctx, mob, enemy, enemyInFov, fov);
    case 'spinner':
      return spinnerWeb(ctx, mob, enemy, enemyInFov);
    case 'eye':
      // Eye.Hunting: a charged beam goes off even at an enemy out of sight.
      if (mob.beamCharged && enemy && eyeCanAttack(ctx, mob, enemy)) {
        mob.enemySeen = enemyInFov;
        eyeAttack(ctx, mob, enemy);
        return true;
      }
      return false;
    case 'ripper':
      return ripperHunt(ctx, mob, enemy, enemyInFov);
  }
  return false;
}

/** Guard.Hunting: once, an enemy in sight within five cells it cannot strike is pulled in on its chains. */
function guardHunt(ctx: Ctx, mob: Mob, enemy: Char | undefined, enemyInFov: boolean): boolean {
  if (mob.chainsUsed || !enemy || !enemyInFov || charmedBy(enemy, mob)) return false;
  if (adjacent(mob.pos, enemy.pos) || canAttackWithExtraReach(ctx, mob, enemy) || distance(mob.pos, enemy.pos) >= 5) return false;
  mob.enemySeen = true;
  return chain(ctx, mob, enemy);
}

const charmedBy = (enemy: Char, mob: Mob): boolean => !isHero(mob as Char) && (mob.charmed ?? 0) > 0 && mob.charmedBy === enemy.id;

/**
 * Guard.chain: a chain thrown along a clear line; the enemy is dragged to the first free cell next to the guard
 * along it, and crippled for four turns. Not the immovable, nor over a chasm. It costs no time.
 */
function chain(ctx: Ctx, mob: Mob, enemy: Char): boolean {
  if (hasProp(enemy, 'immovable')) return false;
  const line = bolt(ctx, mob.pos, enemy.pos, PROJECTILE);
  if (line.collisionPos !== enemy.pos || line.path.length < 2 || hasFlag(ctx.level.map[line.path[1]!]!, F.PIT)) return false;
  let pullTo = -1;
  for (const cell of subPath(line, 1, line.dist)) {
    if (!solid(ctx, cell) && !charAt(ctx.world, ctx.depth, cell) && (isOpenSpace(ctx.level, cell) || !hasProp(enemy, 'large'))) {
      pullTo = cell;
      break;
    }
  }
  if (pullTo === -1) return false;
  mob.target = pullTo;
  ctx.effects.push({ type: 'mobSays', depth: ctx.depth, mob: mob.id, line: 'scorpion' });
  zapFx(ctx, mob, enemy.pos, 'chain');
  const from = enemy.pos;
  enemy.pos = pullTo;
  leaveCell(ctx.world, ctx.level, ctx.depth, from);
  enterCell(ctx.level, pullTo);
  ctx.effects.push({ type: 'pushed', depth: ctx.depth, mob: enemy.id, from, to: pullTo });
  cripple(enemy, 4);
  mob.chainsUsed = true;
  return true;
}

/* Necromancers */

/**
 * Necromancer.Hunting: with its enemy in sight within four cells and no skeleton, it summons one beside the enemy
 * (a turn to begin, two after the first, then it rises); with a skeleton, it keeps it fighting — teleports it to the
 * enemy if it lost sight of it or has a long way round, else heals it (a fifth of its health) or quickens it
 * (Adrenaline). A spectral necromancer summons a wraith every time instead. Otherwise it hunts the common way.
 */
function necromancerHunt(ctx: Ctx, mob: Mob, enemy: Char | undefined, enemyInFov: boolean, fov: boolean[]): boolean {
  mob.enemySeen = enemyInFov;
  if (enemy && enemyInFov) mob.target = enemy.pos;
  if (mob.summoning) {
    summonMinion(ctx, mob);
    return true;
  }
  let minion = mob.kind === 'necromancer' ? mobById(ctx, mob.minion) : undefined;
  if (!minion) delete mob.minion;
  if (!enemy || !enemyInFov) return false;
  if (distance(mob.pos, enemy.pos) <= 4 && !minion) {
    mob.summonPos = -1;
    // It summons around blocking terrain, but not through it (unlocked doors aside).
    const reach = distanceMap(mob.pos, (cell) => !solid(ctx, cell) || isPassable(ctx.level, cell), distance(mob.pos, enemy.pos) + 3);
    for (const n of NEIGHBOURS8) {
      const cell = enemy.pos + n;
      if (!charAt(ctx.world, ctx.depth, cell) && reached(reach, cell) && isPassable(ctx.level, cell) && fov[cell] &&
        (mob.summonPos === -1 || trueDistance(mob.pos, cell) < trueDistance(mob.pos, mob.summonPos!))) mob.summonPos = cell;
    }
    if (mob.summonPos !== -1) {
      mob.summoning = true;
      ctx.effects.push({ type: 'summoning', depth: ctx.depth, mob: mob.id, pos: mob.summonPos! });
      spend(mob, mob.summoned ? 2 * TICK : TICK);
    } else {
      spend(mob, TICK);
    }
    return true;
  }
  if (!minion) return false;
  spend(mob, TICK);
  let teleporting = !fov[minion.pos];
  if (!teleporting && !adjacent(minion.pos, enemy.pos)) {
    const steps = pathLength(minion.pos, enemy.pos, (cell) => isPassable(ctx.level, cell) && !(fov[cell] && charAt(ctx.world, ctx.depth, cell) && cell !== enemy.pos));
    if (steps === Infinity || (steps > 2 * distance(mob.pos, enemy.pos) && steps >= 4)) teleporting = true;
  }
  if (teleporting) {
    if (!adjacent(minion.pos, enemy.pos)) {
      let to = -1;
      for (const n of NEIGHBOURS8) {
        const cell = enemy.pos + n;
        if (!charAt(ctx.world, ctx.depth, cell) && isPassable(ctx.level, cell) && fov[cell] &&
          (to === -1 || trueDistance(mob.pos, cell) < trueDistance(mob.pos, to))) to = cell;
      }
      // (Only when it is seen doing it, as Shattered has it.)
      if (to !== -1 && seenByHeroes(ctx, mob.pos)) {
        mob.summoning = true;
        mob.summonPos = to;
        ctx.effects.push({ type: 'summoning', depth: ctx.depth, mob: mob.id, pos: to });
        spend(mob, TICK);
      }
    }
    return true;
  }
  // Necromancer.onZapComplete: its health ray.
  if (minion.hp < minion.ht) {
    zapFx(ctx, mob, minion.pos, 'health');
    const heal = Math.trunc(minion.ht / 5);
    minion.hp = Math.min(minion.hp + heal, minion.ht);
    ctx.effects.push({ type: 'mobHealed', depth: ctx.depth, mob: minion.id, amount: heal });
  } else if ((minion.adrenaline ?? 0) <= 0) {
    zapFx(ctx, mob, minion.pos, 'health');
    minion.adrenaline = ADRENALINE_TURNS;
  }
  return true;
}

/**
 * Necromancer.summonMinion: someone in the way is pushed aside (to the free cell beside, farthest from the
 * necromancer), or, with nowhere to push them, hurt (2-10) while it waits a turn; then the skeleton rises there
 * (or the old one appears there). SpectralNecromancer: a wraith rises, every time.
 */
function summonMinion(ctx: Ctx, mob: Mob): void {
  let pos = mob.summonPos!;
  const spectral = mob.kind === 'spectralNecromancer';
  let minion = spectral ? undefined : mobById(ctx, mob.minion);
  const blocker = charAt(ctx.world, ctx.depth, pos);
  if ((blocker && blocker !== minion) || (!spectral && !isPassable(ctx.level, pos))) {
    let pushTo = mob.pos;
    for (const n of NEIGHBOURS8) {
      const cell = pos + n;
      if (!charAt(ctx.world, ctx.depth, cell) && isPassable(ctx.level, cell) && (isOpenSpace(ctx.level, cell) || !hasProp(blocker, 'large')) &&
        trueDistance(mob.pos, cell) > trueDistance(mob.pos, pushTo)) pushTo = cell;
    }
    if (spectral && hasProp(blocker, 'immovable')) pushTo = mob.pos;
    if (pushTo !== mob.pos) {
      if (!blocker || hasProp(blocker, 'immovable')) {
        pos = mob.summonPos = pushTo;
      } else {
        const from = blocker.pos;
        blocker.pos = pushTo;
        leaveCell(ctx.world, ctx.level, ctx.depth, from);
        enterCell(ctx.level, pushTo);
        ctx.effects.push({ type: 'pushed', depth: ctx.depth, mob: blocker.id, from, to: pushTo });
      }
    } else {
      if (blocker && (isHero(blocker) || blocker.ally)) {
        const damage = ctx.rng.normalIntRange(2, 10);
        ctx.effects.push({ type: 'hurt', depth: ctx.depth, who: blocker.id, damage });
        hurt(ctx, blocker, damage, mob);
      }
      spend(mob, TICK);
      return;
    }
  }
  mob.summoning = false;
  mob.summoned = true;
  if (spectral) {
    const wraith = spawnWraith(ctx, pos, 'wraith', 4);
    if (!wraith) {
      spend(mob, TICK);
      return;
    }
    inherit(mob, wraith);
    (mob.wraiths ??= []).push(wraith.id);
    ctx.effects.push({ type: 'summoned', depth: ctx.depth, mob: mob.id, minion: wraith.id, pos });
    return;
  }
  if (!minion) {
    minion = createMob(`#${++ctx.world.nextId}`, 'necroSkeleton', pos, 'wandering', 0);
    minion.hp = 20;
    minion.master = mob.id;
    minion.enemy = mob.enemy;
    inherit(mob, minion);
    addMob(ctx, minion);
    mob.minion = minion.id;
  } else {
    appear(ctx, minion, pos);
  }
  ctx.effects.push({ type: 'summoned', depth: ctx.depth, mob: mob.id, minion: minion.id, pos });
}

/**
 * Wraith.spawnAt: a wraith rises at a cell (or beside it, if it is taken), hunting, as strong as the depth (or as
 * `level` says); one in a hundred a tormented spirit, unless the kind is given. Null if there is no room.
 */
export function spawnWraith(ctx: Ctx, at: number, kind?: 'wraith' | 'tormentedSpirit', level?: number, allowAdjacent = true): Mob | null {
  let pos = at;
  if (solid(ctx, pos) || charAt(ctx.world, ctx.depth, pos)) {
    const cells = NEIGHBOURS8.map((n) => at + n).filter((c) => !solid(ctx, c) && !charAt(ctx.world, ctx.depth, c));
    pos = allowAdjacent && cells.length > 0 ? ctx.rng.element(cells)! : -1;
  }
  if (pos === -1) return null;
  const chosen: MobKind = kind ?? (ctx.rng.float() < (1 / 100) * exoticChanceMultiplier(ctx.world) ? 'tormentedSpirit' : 'wraith');
  const wraith = createMob(`#${++ctx.world.nextId}`, chosen, pos, 'hunting', 0);
  wraith.level = level ?? ctx.depth;
  wraith.enemySeen = true;
  // Wraith.SPAWN_DELAY.
  return addMob(ctx, wraith, 2);
}

/**
 * TormentedSpirit.cleanse: its curse lifted, the spirit thanks its saviour and leaves a weapon (enchanted) or an
 * armour (inscribed) — Generator.randomWeapon / randomArmor — uncursed, half the time a level better if it was +0,
 * and is gone, teaching nothing.
 */
export function cleanseSpirit(ctx: Ctx, spirit: Mob): void {
  let prize: Item;
  if (ctx.rng.int(2) === 0) {
    prize = randomWeapon(ctx.rng, ctx.depth);
    prize.enchant = randomEnchantment(ctx.rng);
  } else {
    prize = randomArmor(ctx.rng, ctx.depth);
    prize.glyph = randomGlyph(ctx.rng);
  }
  prize.cursed = false;
  delete prize.curseUnknown;
  if (prize.level <= 0) prize.level = 0;
  if (prize.level === 0 && ctx.rng.int(2) === 0) prize.level = 1;
  ctx.effects.push({ type: 'mobSays', depth: ctx.depth, mob: spirit.id, line: 'thankYou' });
  landItem(ctx, spirit.pos, prize);
  ctx.floor.mobs.splice(ctx.floor.mobs.indexOf(spirit), 1);
  leaveCell(ctx.world, ctx.level, ctx.depth, spirit.pos);
  ctx.effects.push({ type: 'faded', depth: ctx.depth, mob: spirit.id, pos: spirit.pos });
}

/** Necromancer.die and SpectralNecromancer.die: its skeleton dies with it, and its wraiths. */
export function minionsDie(ctx: Ctx, mob: Mob): void {
  const minions = [mobById(ctx, mob.minion), ...(mob.wraiths ?? []).map((id) => mobById(ctx, id))];
  for (const minion of minions) {
    if (!minion || !isAlive(minion) || minion.ally) continue;
    ctx.effects.push({ type: 'hurt', depth: ctx.depth, who: minion.id, damage: minion.hp });
    hurt(ctx, minion, minion.hp, 'master');
  }
}

/* DM-200s and golems */

/** DM200.canVent and Golem.canTele: ready, and it can reach round to the target without passing through walls. */
function canReachRound(ctx: Ctx, mob: Mob, target: number, cooldown: number): boolean {
  if (cooldown > 0) return false;
  const map = distanceMap(target, (cell) => !solid(ctx, cell), distance(mob.pos, target) + 1);
  return reached(map, mob.pos);
}

/**
 * DM200.Hunting and Golem.Hunting: an enemy in sight it cannot strike — now and then (the more likely the nearer)
 * it vents its exhaust at them (a DM-200) or teleports them over (a golem); else it walks up, and failing that,
 * vents or teleports if it can, or looks for another enemy.
 */
function ventHunt(ctx: Ctx, mob: Mob, enemy: Char | undefined, enemyInFov: boolean, fov: boolean[]): boolean {
  if (!enemy || !enemyInFov || adjacent(mob.pos, enemy.pos) || canAttackWithExtraReach(ctx, mob, enemy)) return false;
  mob.enemySeen = true;
  mob.target = enemy.pos;
  const golem = mob.kind === 'golem';
  const ready = golem
    ? !hasProp(enemy, 'immovable') && canReachRound(ctx, mob, mob.target, mob.enemyTele ?? 0)
    : canReachRound(ctx, mob, mob.target, mob.ventCooldown ?? 0);
  const dist = distance(mob.pos, enemy.pos);
  if (dist >= 1 && ctx.rng.int(Math.trunc(100 / dist)) === 0 && ready) {
    if (golem) teleportEnemy(ctx, mob, enemy);
    else vent(ctx, mob, enemy);
    return true;
  }
  if (getCloser(ctx, mob, mob.target, fov)) {
    spend(mob, 1 / mobSpeed(mob));
    return true;
  }
  if (ready) {
    if (golem) teleportEnemy(ctx, mob, enemy);
    else vent(ctx, mob, enemy);
    return true;
  }
  // Mob.Hunting.handleUnreachableTarget, as the common hunt would.
  return false;
}

/** DM200.zap: a jet of toxic exhaust along the line to its enemy, a thick cloud where it ends; not again for thirty turns. */
function vent(ctx: Ctx, mob: Mob, enemy: Char): void {
  spend(mob, TICK);
  mob.ventCooldown = 30;
  const line = bolt(ctx, mob.pos, enemy.pos, STOP_TARGET);
  zapFx(ctx, mob, line.collisionPos, 'toxic');
  ctx.effects.push({ type: 'mobSays', depth: ctx.depth, mob: mob.id, line: 'vent' });
  for (const cell of subPath(line, 0, line.dist)) seedGas(ctx, cell, 'toxic', 20);
  seedGas(ctx, line.collisionPos, 'toxic', 100);
}

/**
 * Golem.teleportEnemy: the enemy appears beside the golem, on the side of it away from where they stood; not
 * again for twenty turns.
 */
function teleportEnemy(ctx: Ctx, mob: Mob, enemy: Char): void {
  spend(mob, TICK);
  zapFx(ctx, mob, enemy.pos, 'elmo');
  let best = enemy.pos;
  for (const n of NEIGHBOURS8) {
    const cell = mob.pos + n;
    if (isPassable(ctx.level, cell) && !charAt(ctx.world, ctx.depth, cell) && trueDistance(cell, enemy.pos) > trueDistance(best, enemy.pos)) best = cell;
  }
  if (best !== enemy.pos) {
    const from = enemy.pos;
    appear(ctx, enemy, best);
    ctx.effects.push({ type: 'mobTeleported', depth: ctx.depth, mob: enemy.id, from, to: best });
  }
  mob.enemyTele = 20;
}

/** Golem.Wandering: when it cannot walk where it is going, it gathers itself (two turns) to teleport there, now and then. */
export function golemWander(ctx: Ctx, mob: Mob): boolean {
  if (mob.kind !== 'golem' || isBossDepth(ctx.depth) || mob.target === -1 || mob.target === mob.pos || (mob.selfTele ?? 0) > 0) return false;
  mob.teleporting = true;
  ctx.effects.push({ type: 'gathering', depth: ctx.depth, mob: mob.id });
  spend(mob, 2 * TICK);
  return true;
}

/**
 * DM201.Hunting: threatened (struck from afar, or its enemy not beside it), it lobs a corrosive grenade at its
 * enemy in sight (CorrosiveGas, strength 8); it never moves.
 */
function dm201Hunt(ctx: Ctx, mob: Mob, enemy: Char | undefined, enemyInFov: boolean): boolean {
  if (!mob.threatened || !enemy || !enemyInFov) return false;
  mob.threatened = false;
  mob.enemySeen = true;
  spend(mob, TICK);
  zapFx(ctx, mob, enemy.pos, 'corrosion');
  ctx.effects.push({ type: 'mobSays', depth: ctx.depth, mob: mob.id, line: 'vent' });
  seedCorrosive(ctx, enemy.pos, 15, 8);
  for (const n of NEIGHBOURS8) if (!solid(ctx, enemy.pos + n)) seedCorrosive(ctx, enemy.pos + n, 5, 8);
  return true;
}

/* Spinners */

/**
 * Spinner.webPos: where to shoot a web — ahead of the enemy the way it is going, or between it and the spinner if it
 * stands still (not at an enemy that stands still within reach, which it would rather bite); only where a web
 * can be flung and can lie.
 */
function webPos(ctx: Ctx, mob: Mob, enemy: Char): number {
  const last = mob.lastEnemyPos ?? -1;
  if (mob.state !== 'fleeing' && enemy.pos === last && adjacent(mob.pos, enemy.pos)) return -1;
  const line = last === enemy.pos ? bolt(ctx, enemy.pos, mob.pos, WONT_STOP) : bolt(ctx, last, enemy.pos, WONT_STOP);
  const index = Math.max(0, line.path.indexOf(enemy.pos));
  if (line.path.length <= index + 1) return -1;
  const web = line.path[index + 1]!;
  const reach = bolt(ctx, mob.pos, web, STOP_TARGET | STOP_SOLID).collisionPos;
  return web !== enemy.pos && reach === web && isPassable(ctx.level, web) ? web : -1;
}

/**
 * Spinner.Hunting and Fleeing: a web flung at once whenever it is ready (no time spent: it acts again); and a
 * fleeing spinner turns back to the hunt once its enemy is no longer poisoned.
 */
function spinnerWeb(ctx: Ctx, mob: Mob, enemy: Char | undefined, enemyInFov: boolean): boolean {
  if (!enemy || !enemyInFov || (mob.webCooldown ?? 0) > 0 || (mob.lastEnemyPos ?? -1) === -1) return false;
  const web = webPos(ctx, mob, enemy);
  if (web === -1) return false;
  shootWeb(ctx, mob, enemy, web);
  return true;
}

/** Spinner.shootWeb: webs on the cell and the two on either side of it around the enemy; not again for ten turns. */
function shootWeb(ctx: Ctx, mob: Mob, enemy: Char, web: number): void {
  const i = CIRCLE8.findIndex((n) => enemy.pos + n === web);
  zapFx(ctx, mob, web, 'web');
  const cells = i === -1 ? [web] : [enemy.pos + CIRCLE8[(i + 7) % 8]!, web, enemy.pos + CIRCLE8[(i + 1) % 8]!];
  for (const cell of cells) if (isPassable(ctx.level, cell)) seedWeb(ctx, cell, 20);
  mob.webCooldown = 10;
}

/** Spinner.Fleeing: back to the hunt once its enemy is no longer poisoned; it webs on the run too. */
export function fleeSpecial(ctx: Ctx, mob: Mob, enemy: Char | undefined, enemyInFov: boolean): boolean {
  if (mob.kind !== 'spinner') return false;
  if ((mob.terror ?? 0) <= 0 && enemy && enemyInFov && (enemy.poison ?? 0) <= 0) {
    mob.state = 'hunting';
    return true;
  }
  return spinnerWeb(ctx, mob, enemy, enemyInFov);
}

/* Evil eyes */

/**
 * Eye.canAttack: with its beam ready, an enemy in sight it is not charmed by along a line through walls' edge
 * (or beside it) — the beam aims there; with the beam charged, it must fire; while it cools down, at arm's length.
 */
function eyeCanAttack(ctx: Ctx, mob: Mob, enemy: Char): boolean {
  const near = adjacent(mob.pos, enemy.pos) || canAttackWithExtraReach(ctx, mob, enemy);
  if ((mob.beamCooldown ?? 0) === 0) {
    const aim = bolt(ctx, mob.pos, enemy.pos, STOP_SOLID);
    const visible = !(isHero(enemy) && enemy.invisible > 0);
    if (visible && !charmedBy(enemy, mob) && seesFrom(ctx, mob, enemy.pos) && (near || subPath(aim, 1, aim.dist).includes(enemy.pos))) {
      mob.beamTarget = enemy.pos;
      return true;
    }
    return mob.beamCharged === true;
  }
  return near;
}

const seesFrom = (ctx: Ctx, mob: Mob, cell: number): boolean => castShadow(mob.pos, terrainBlocksSight(ctx.level.map), 6)[cell] === true;

/**
 * Eye.doAttack: with the beam cooling down or not lined up, a common blow; otherwise it charges the beam (two
 * attack's worth of time), then lets the deathgaze go.
 */
function eyeAttack(ctx: Ctx, mob: Mob, enemy: Char): boolean {
  const target = mob.beamTarget ?? enemy.pos;
  const beam = bolt(ctx, mob.pos, target, STOP_SOLID);
  if ((mob.beamCooldown ?? 0) > 0 || (!mob.beamCharged && !subPath(beam, 1, beam.dist).includes(enemy.pos))) return false;
  if (!mob.beamCharged) {
    spend(mob, 2 * TICK);
    mob.beamCharged = true;
    ctx.effects.push({ type: 'charging', depth: ctx.depth, mob: mob.id, pos: target });
    return true;
  }
  spend(mob, TICK);
  deathGaze(ctx, mob, beam.collisionPos, subPath(beam, 1, beam.dist));
  return true;
}

/**
 * Eye.deathGaze: the beam burns away what can burn along it and strikes everyone in it (a magic attack, 30-50);
 * then four to six turns before the next.
 */
function deathGaze(ctx: Ctx, mob: Mob, end: number, cells: number[]): void {
  mob.beamCharged = false;
  mob.beamCooldown = ctx.rng.intRange(4, 6);
  zapFx(ctx, mob, end, 'deathGaze');
  for (const cell of cells) {
    if (hasFlag(ctx.level.map[cell]!, F.FLAMABLE)) {
      ctx.level.map[cell] = T.EMBERS;
      ctx.effects.push({ type: 'burnt', depth: ctx.depth, pos: cell });
    }
    const char = charAt(ctx.world, ctx.depth, cell);
    if (!char || !isAlive(char)) continue;
    boltHits(ctx, mob, char, magicHit(ctx, mob, char) ? ctx.rng.normalIntRange(30, 50) : null);
  }
  delete mob.beamTarget;
}

/* Ripper demons */

/**
 * RipperDemon.Hunting: a leap made ready goes off — at the cell aimed at (bouncing off whoever stands there, who is
 * left bleeding three quarters of a blow), costing no time; an enemy in sight three or more cells away, with the
 * leap cooled down, is aimed at (just past where it is heading), the leap readied for its next turn; else the hunt.
 */
function ripperHunt(ctx: Ctx, mob: Mob, enemy: Char | undefined, enemyInFov: boolean): boolean {
  if ((mob.leapPos ?? -1) !== -1) {
    mob.leapCooldown = ctx.rng.normalIntRange(2, 4);
    if ((mob.rooted ?? 0) > 0) {
      mob.leapPos = -1;
      return true;
    }
    const leapPos = bolt(ctx, mob.pos, mob.leapPos!, STOP_TARGET | STOP_SOLID).collisionPos;
    const victim = charAt(ctx.world, ctx.depth, leapPos);
    let end = leapPos;
    if (victim) {
      let bounce = -1;
      for (const free of [true, false]) {
        for (const n of NEIGHBOURS8) {
          const cell = leapPos + n;
          if (charAt(ctx.world, ctx.depth, cell)) continue;
          if (free ? !isPassable(ctx.level, cell) : solid(ctx, cell)) continue;
          if (bounce === -1 || trueDistance(mob.pos, cell) < trueDistance(mob.pos, bounce)) bounce = cell;
        }
        if (bounce !== -1) break;
      }
      if (bounce === -1) {
        mob.leapPos = -1;
        return true;
      }
      end = bounce;
    }
    const from = mob.pos;
    ctx.effects.push({ type: 'jumped', depth: ctx.depth, mob: mob.id, from, to: end });
    if (victim && (isHero(victim) || victim.ally)) {
      // Char.hit with INFINITE_ACCURACY: only infinite evasion (a focus) escapes it.
      if (defenseOf(victim, mob) < INFINITE_EVASION) {
        bleed(ctx.rng, victim, 0.75 * ctx.rng.normalIntRange(...MOBS.ripper.damage));
        ctx.effects.push({ type: 'attack', depth: ctx.depth, attacker: mob.id, target: victim.id, hit: true, damage: 0 });
      } else {
        parried(ctx, victim);
        ctx.effects.push({ type: 'attack', depth: ctx.depth, attacker: mob.id, target: victim.id, hit: false, damage: 0 });
      }
    }
    mob.pos = end;
    leaveCell(ctx.world, ctx.level, ctx.depth, from);
    enterCell(ctx.level, end);
    mob.leapPos = -1;
    return true;
  }
  if (!enemy || !enemyInFov) return false;
  if (adjacent(mob.pos, enemy.pos) || canAttackWithExtraReach(ctx, mob, enemy)) return false;
  if ((mob.leapCooldown ?? 0) > 0 || (mob.rooted ?? 0) > 0 || distance(mob.pos, enemy.pos) < 3) return false;
  mob.enemySeen = true;
  mob.target = enemy.pos;
  let targetPos = enemy.pos;
  const last = mob.lastEnemyPos ?? enemy.pos;
  if (last !== enemy.pos) {
    let closest = 0;
    for (let i = 1; i < CIRCLE8.length; i++) {
      if (trueDistance(last, enemy.pos + CIRCLE8[i]!) < trueDistance(last, enemy.pos + CIRCLE8[closest]!)) closest = i;
    }
    targetPos = enemy.pos + CIRCLE8[(closest + 4) % 8]!;
  }
  let line = bolt(ctx, mob.pos, targetPos, STOP_TARGET | STOP_SOLID);
  if (line.collisionPos !== targetPos && targetPos !== enemy.pos) {
    targetPos = enemy.pos;
    line = bolt(ctx, mob.pos, targetPos, STOP_TARGET | STOP_SOLID);
  }
  if (line.collisionPos !== targetPos) return false;
  mob.leapPos = targetPos;
  // Not to punish the slow too much: between one attack's time and three, as long as the enemy takes to act.
  const attackDelay = mobStats(mob).attackDelay ?? TICK;
  const enemyCooldown = Math.ceil(Math.max(0, enemy.time - ctx.floor.now));
  spend(mob, Math.min(3 * attackDelay, Math.max(attackDelay, enemyCooldown)));
  ctx.effects.push({ type: 'leapReady', depth: ctx.depth, mob: mob.id, pos: targetPos });
  return true;
}

/* Thieves */

/**
 * Thief.steal: a random item out of the pack (a whole stack), if it is not unique (keys, quest items, bags, the
 * seal and the waterskin) and not upgraded; then off it runs. A bandit also blinds, poisons and cripples its victim.
 */
export function steal(ctx: Ctx, thief: Mob, hero: Hero): boolean {
  const pack = looseItems(hero);
  const item = ctx.rng.element(pack);
  if (!item || UNIQUE.has(itemDef(item.kind).category) || item.level >= 1) return false;
  // A whole stack goes (Item.detach for a stackable: one of it).
  const index = hero.items.indexOf(item);
  let taken = item;
  if (item.kind === 'honeypot' && item.qty > 1) {
    item.qty--;
    taken = createItem('honeypot');
  } else {
    hero.items.splice(index, 1);
  }
  thief.item = taken;
  // Thief.steal: a honeypot breaks in its hands, and the bee is after the thief.
  if (taken.kind === 'honeypot' && spawnBee(ctx, thief.pos, thief.id)) thief.item = createItem('honeypot.shattered');
  if (thief.kind === 'bandit') {
    blind(hero, 5);
    poison(hero, ctx.rng.intRange(5, 6));
    cripple(hero, 5);
  }
  ctx.effects.push({ type: 'stole', depth: ctx.depth, mob: thief.id, hero: hero.id, item });
  return true;
}

/** What a thief (or a crystal mimic) never takes: Item.unique. */
const UNIQUE: ReadonlySet<string> = new Set(['key', 'quest', 'seal', 'vial', 'bag', 'tome', 'kit']);

/**
 * Mob.Fleeing.escaped of each kind: a thief out of every hero's sight, six or more cells off, gets away with its
 * loot (it reappears somewhere else, empty-handed); a crystal mimic so far vanishes with its treasure.
 */
export function escaped(ctx: Ctx, mob: Mob): void {
  const heroes = heroesOn(ctx.world, ctx.depth);
  const far = !seenByHeroes(ctx, mob.pos) && heroes.every((hero) => distance(hero.pos, mob.pos) >= 6);
  if ((mob.kind === 'thief' || mob.kind === 'bandit') && mob.item && far) {
    let to = -1;
    for (let count = 32; count > 0; count--) {
      const cell = randomDestination(ctx, mob);
      if (cell !== -1 && !seenByHeroes(ctx, cell) && distance(cell, mob.pos) >= Math.trunc(count / 3) && !charAt(ctx.world, ctx.depth, cell)) {
        to = cell;
        break;
      }
    }
    if (to !== -1) appear(ctx, mob, to);
    ctx.effects.push({ type: 'escaped', depth: ctx.depth, mob: mob.id, kind: mob.kind, item: mob.item });
    delete mob.item;
    mob.state = 'wandering';
    return;
  }
  if (mob.kind === 'crystalMimic' && far) {
    ctx.effects.push({ type: 'escaped', depth: ctx.depth, mob: mob.id, kind: mob.kind });
    ctx.floor.mobs.splice(ctx.floor.mobs.indexOf(mob), 1);
    leaveCell(ctx.world, ctx.level, ctx.depth, mob.pos);
    return;
  }
  mob.state = 'wandering';
}

/* Mimics */

/**
 * Mimic.interact: a hidden mimic springs at whoever disturbs it, a bite that cannot miss (unless they are unseen) and
 * as hard as its level allows (an ebony mimic's twice that; a crystal mimic bites as it would anyway, and swallows
 * something from the pack instead); it is a mimic from then on, a crystal one off on the run, hasted.
 */
export function ambush(ctx: Ctx, mimic: Mob, hero: Hero): void {
  const level = mimicLevel(mimic);
  delete mimic.hidden;
  if (hero.invisible <= 0) {
    // Mimic.damageRoll while hidden: 2 + 2 a level, no roll (an ebony mimic's twice that); a crystal mimic's, its common one.
    const fixed = mimic.kind === 'ebonyMimic' ? 2 * (2 + 2 * level) : 2 + 2 * level;
    if (mimic.kind === 'crystalMimic') crystalSteal(ctx, mimic, hero);
    attack(ctx, mimic, hero, {
      attack: INFINITE_ACCURACY, ...(mimic.kind === 'crystalMimic' ? {} : { damage: [fixed, fixed] as const }), ambush: true,
    });
  }
  if (mimic.kind === 'crystalMimic') {
    mimic.state = 'fleeing';
    mimic.haste = hero.invisible <= 0 ? 2 : 1;
  } else {
    mimic.state = 'hunting';
  }
  mimic.enemy = hero.id;
  mimic.target = hero.pos;
  mimic.enemySeen = true;
}

/**
 * Mimic.spawnAt(pos, EbonyMimic.class): an ebony mimic hides at a cell (on a heap or a door, or anywhere), all but
 * invisible, with its treasure and prize (MimicTooth's ebony mimics: SEAM(alchemy) places them, RegularLevel.createItems
 * the levels stream). Returns it, to go into the level's monsters.
 */
export function hiddenEbonyMimic(world: World, depth: number, rng: Rng, pos: number, items: Item[] = []): Mob {
  const mimic = createMob(`#${++world.nextId}`, 'ebonyMimic', pos, 'passive', 0);
  mimic.level = depth;
  mimic.ht = mimic.hp = mobStats(mimic).ht;
  mimic.hidden = true;
  mimic.loot = mimicPrize(rng, depth, 'ebonyMimic', items);
  return mimic;
}

/** Mimic.stopHiding: struck, or bumped into, a hidden mimic is out, hunting. */
export function reveal(ctx: Ctx, mimic: Mob): void {
  if (!mimic.hidden) return;
  delete mimic.hidden;
  mimic.state = 'hunting';
  const hero = heroesOn(ctx.world, ctx.depth).find((h) => heroView(ctx.world, h)[mimic.pos]);
  if (hero) {
    mimic.enemy = hero.id;
    mimic.target = hero.pos;
  }
  ctx.effects.push({ type: 'mimic', depth: ctx.depth, mob: mimic.id, hero: hero?.id ?? '' });
}

const mimicLevel = (mimic: Mob): number => (mimic.kind === 'goldenMimic' ? Math.round((mimic.level ?? 1) * 1.33) : mimic.level ?? 1);

/** CrystalMimic.steal: something not upgraded and not unique from the pack (ten tries), into its treasure. */
function crystalSteal(ctx: Ctx, mimic: Mob, hero: Hero): void {
  const pack = looseItems(hero);
  let item: Item | undefined;
  for (let tries = 10; tries >= 0; tries--) {
    item = ctx.rng.element(pack);
    if (item && !UNIQUE.has(itemDef(item.kind).category) && item.level <= 0) break;
  }
  if (!item || UNIQUE.has(itemDef(item.kind).category) || item.level >= 1) return;
  hero.items.splice(hero.items.indexOf(item), 1);
  (mimic.loot ??= []).push(item);
  ctx.effects.push({ type: 'stole', depth: ctx.depth, mob: mimic.id, hero: hero.id, item });
}

/**
 * CrystalMimic.attackProc when it is out: whom it bites is sent to a free cell beside it, and it runs again.
 */
export function crystalBite(ctx: Ctx, mimic: Mob, enemy: Char): void {
  if (mimic.kind !== 'crystalMimic') return;
  const cells = NEIGHBOURS8.map((n) => mimic.pos + n).filter((c) => isPassable(ctx.level, c) && !charAt(ctx.world, ctx.depth, c));
  if (cells.length > 0) appear(ctx, enemy, ctx.rng.element(cells)!);
  mimic.state = 'fleeing';
}

/* Gnoll exiles */

/**
 * GnollExile's Passive state: it wanders, leaving the heroes be, and lets them know (once in a while, while they
 * see it and it them); struck, or put under something, it turns to fight. True if that took its turn.
 */
export function exileWander(ctx: Ctx, mob: Mob, enemy: Char | undefined, enemyInFov: boolean, justAlerted: boolean): 'aggro' | 'calm' {
  if (mob.kind !== 'gnollExile' || mob.provoked) return 'aggro';
  const debuffed = (mob.poison ?? 0) > 0 || (mob.burning ?? 0) > 0 || (mob.crippled ?? 0) > 0 || (mob.weakened ?? 0) > 0 ||
    (mob.vulnerable ?? 0) > 0 || (mob.hexed ?? 0) > 0 || (mob.bleeding ?? 0) > 0 || (mob.charmed ?? 0) > 0 || (mob.terror ?? 0) > 0;
  if (debuffed) {
    mob.provoked = true;
    return 'aggro';
  }
  const heroSeen = heroesOn(ctx.world, ctx.depth).some((hero) => enemy === hero && enemyInFov && heroView(ctx.world, hero)[mob.pos]);
  if (heroSeen) {
    if ((mob.seenCooldown ?? 0) <= 0) ctx.effects.push({ type: 'mobSays', depth: ctx.depth, mob: mob.id, line: 'seenPassive' });
    mob.seenCooldown = 30;
  } else {
    mob.seenCooldown = (mob.seenCooldown ?? 0) - 1;
  }
  if (enemyInFov && justAlerted) {
    mob.provoked = true;
    return 'aggro';
  }
  return 'calm';
}

/* Piranhas */

/** Piranha's AI: an enemy is only seen if a way through the water leads to it (within eight cells). */
export function piranhaSees(ctx: Ctx, mob: Mob, enemy: Char): boolean {
  const map = distanceMap(enemy.pos, (cell) => isWater(ctx.level.map[cell]!), 8);
  return reached(map, mob.pos);
}

/** Piranha.getCloser: a step through the water only. */
export function piranhaStep(ctx: Ctx, mob: Mob, target: number, fov: boolean[]): number {
  if (adjacent(mob.pos, target)) return !charAt(ctx.world, ctx.depth, target) && isWater(ctx.level.map[target]!) && isPassable(ctx.level, target) ? target : -1;
  return getStep(mob.pos, target, (cell) => isWater(ctx.level.map[cell]!) && isPassable(ctx.level, cell) && !(fov[cell] && charAt(ctx.world, ctx.depth, cell)));
}


/* Golden bees */

/**
 * Honeypot.shatter: a golden bee flies out where the pot broke (beside it, if someone stands there), as strong as the
 * depth (Bee.spawn), guarding the pot's pieces where they lie, or after whoever holds them. Null with no room.
 */
export function spawnBee(ctx: Ctx, pos: number, holder: string | null): Mob | null {
  let at = pos;
  if (charAt(ctx.world, ctx.depth, pos)) {
    at = ctx.rng.element(NEIGHBOURS4.map((n) => pos + n).filter((c) => !solid(ctx, c) && !charAt(ctx.world, ctx.depth, c))) ?? -1;
  }
  if (at === -1) return null;
  const bee = createMob(`#${++ctx.world.nextId}`, 'bee', at, 'wandering', 0);
  bee.level = ctx.depth;
  bee.ht = bee.hp = mobStats(bee).ht;
  bee.pot = { pos: holder ? -1 : pos, holder };
  addMob(ctx, bee, 0);
  ctx.effects.push({ type: 'bee', depth: ctx.depth, pos: at, from: pos });
  return bee;
}

const bees = (ctx: Ctx): Mob[] => ctx.floor.mobs.filter((mob) => mob.kind === 'bee' && !mob.ally && mob.pot);

/** ShatteredPot.pickupPot: the bees guarding the pieces at `pos` go after whoever picked them up. */
export function potPickedUp(ctx: Ctx, holder: string, pos: number): void {
  for (const bee of bees(ctx)) if (bee.pot!.pos === pos) bee.pot = { pos: -1, holder };
}

/** ShatteredPot.dropPot: the bees after whoever held the pieces guard them where they now lie. */
export function potDropped(ctx: Ctx, holder: string, pos: number): void {
  for (const bee of bees(ctx)) if (bee.pot!.holder === holder) bee.pot = { pos, holder: null };
}

/**
 * Bee.chooseEnemy: whoever holds the pot's pieces; with the pieces lying about, whoever comes within three cells of
 * them (monsters first, the nearest to the bee, then the hero); with the pot gone, as any monster would.
 */
function beeEnemy(ctx: Ctx, bee: Mob, fov: boolean[]): Char | undefined {
  const pot = bee.pot ?? { pos: -1, holder: null };
  const heroes = heroesOn(ctx.world, ctx.depth);
  if (pot.holder !== null) {
    const holder = findChar(ctx, pot.holder);
    if (holder && isAlive(holder)) return holder;
  }
  if (pot.pos === -1) {
    const seen = heroes.filter((hero) => fov[hero.pos] && hero.invisible <= 0);
    return seen.sort((a, b) => distance(bee.pos, a.pos) - distance(bee.pos, b.pos))[0];
  }
  const current = bee.enemy ? findChar(ctx, bee.enemy) : undefined;
  if (current && isAlive(current) && bee.state === 'hunting' && distance(current.pos, pot.pos) <= 3) return current;
  let closest: Char | undefined;
  for (const mob of ctx.floor.mobs) {
    if (mob === bee || distance(mob.pos, pot.pos) > 3 || mob.state === 'passive' || mob.hidden || mob.kind === 'bee') continue;
    if (!closest || distance(closest.pos, bee.pos) > distance(mob.pos, bee.pos)) closest = mob;
  }
  if (closest) return closest;
  return heroes.find((hero) => distance(hero.pos, pot.pos) <= 3);
}

/**
 * Bee.act and its getCloser: a bee stings its enemy at arm's length (a monster stung turns on it); otherwise it
 * heads for the one holding its pot, for its enemy while near the pot, else back to the pot.
 */
export function beeAct(ctx: Ctx, bee: Mob): void {
  const fov = castShadow(bee.pos, terrainBlocksSight(ctx.level.map), 4);
  const enemy = beeEnemy(ctx, bee, fov);
  bee.enemy = enemy?.id ?? null;
  bee.state = enemy ? 'hunting' : 'wandering';
  bee.enemySeen = enemy !== undefined && fov[enemy.pos] === true;
  if (enemy && adjacent(bee.pos, enemy.pos)) {
    attack(ctx, bee, enemy);
    // Bee.attackProc: a monster stung turns on the bee (Mob.aggro).
    if (!isHero(enemy) && isAlive(enemy)) enemy.beeFoe = bee.id;
    spend(bee, TICK);
    return;
  }
  const pot = bee.pot ?? { pos: -1, holder: null };
  let target = enemy && bee.enemySeen ? enemy.pos : bee.target;
  if (enemy && pot.holder === enemy.id) target = enemy.pos;
  else if (pot.pos !== -1 && (!enemy || distance(target, pot.pos) > 3)) target = pot.pos;
  else if (!enemy && (target === -1 || target === bee.pos)) target = randomDestination(ctx, bee);
  bee.target = target;
  if (target !== -1 && target !== bee.pos && getCloser(ctx, bee, target, fov)) spend(bee, 1 / mobSpeed(bee));
  else spend(bee, TICK);
}
