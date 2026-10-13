import { wear } from './wear';
import { spawnerDamage } from './roommobs';
import { familiarise, identifyBelongings } from './ident';
import { bossHurt, earnExp } from './hero';
import { shieldDamage } from './seal';
import {
  baseKind, BRUTE_ENRAGED_DAMAGE, isShopkeeper, statsOf, createMob, type Hero, heroArmor, heroAttackSkill, heroDamageRoll, heroDefenseSkill, isAlive,
  type Mob, MOBS, mobStats, ringBonus,
} from './actors';
import {
  charAt, type Char, type Ctx, dropItem, enterCell, freeCellNear, heroesOn, isHero, isPassable, isWater, landItem, leaveCell,
  observe,
} from './floor';
import { createItem, type Item, itemDef, ItemGenerator, randomRing, rollGold, wandMaxCharges } from './items';
import { NEIGHBOURS4, NEIGHBOURS8 } from './level/geometry';
import { armorProc, TERROR_TURNS, weaponProc } from './enchant';
import { earthrootAbsorbs } from './plants';
import { impQuestKill } from './imp';
import { addQuestScore, ghostFoeSlain } from './quest';
import { seedGas } from './gas';
import { looseItems } from './bags';
import { sacrifice } from './altar';
import { F, hasFlag, T } from './level/terrain';
import { mobPress } from './traps';
import { isBossDepth } from './level/builder';
import { underChallenges } from './challenges';
import { arenaKill } from './arena';

/*
 * Melee combat as in Char.attack: an accuracy roll against an evasion roll,
 * then damage minus a roll of the defender's armour.
 */

function attackSkill(char: Char): number {
  return isHero(char) ? heroAttackSkill(char) : mobStats(char).attack;
}

function defenseSkill(char: Char, attacker?: Char): number {
  if (isHero(char)) return heroDefenseSkill(char);
  // GreatCrab.defenseSkill: it parries every blow from the one it is watching, awake and free to move.
  if (char.kind === 'greatCrab' && attacker && char.enemySeen && char.state !== 'sleeping' && (char.paralysed ?? 0) <= 0 &&
    char.enemy === attacker.id && (!isHero(attacker) || attacker.invisible <= 0)) {
    return Number.POSITIVE_INFINITY;
  }
  // A monster that has not spotted its enemy is caught off guard.
  return char.enemySeen ? mobStats(char).defense : 0;
}

export function charArmor(char: Char): number {
  return isHero(char) ? heroArmor(char) : mobStats(char).dr;
}

function damageRoll(ctx: Ctx, char: Char, range?: readonly [number, number]): number {
  if (range) return ctx.rng.normalIntRange(range[0], range[1]);
  if (isHero(char)) return heroDamageRoll(char, ctx.rng);
  const [min, max] = baseKind(char.kind) === 'brute' && char.enraged ? BRUTE_ENRAGED_DAMAGE : mobStats(char).damage;
  return ctx.rng.normalIntRange(min, max);
}

/** Changes to an attacker's usual numbers, e.g. a pumped-up Goo. */
export interface AttackOverride {
  attack?: number;
  damage?: readonly [number, number];
  /** A hero's thrown weapon, whose enchantment the shot carries (Hero.attackProc: rangedWeapon). */
  weapon?: Item;
}

/** One blow or shot; returns whether it hit. */
export function attack(ctx: Ctx, attacker: Char, defender: Char, override: AttackOverride = {}): boolean {
  // Striking gives an invisible hero away.
  if (isHero(attacker)) attacker.invisible = 0;
  const skill = override.attack ?? attackSkill(attacker);
  const evasion = defenseSkill(defender, attacker);
  const hit = evasion !== Number.POSITIVE_INFINITY && ctx.rng.floatMax(skill) >= ctx.rng.floatMax(evasion);
  if (evasion === Number.POSITIVE_INFINITY) {
    // GreatCrab: «The crab notices the attack and blocks with its massive claw!» (and the quest's score suffers).
    ctx.effects.push({ type: 'parried', depth: ctx.depth, mob: defender.id });
    if (isHero(attacker)) addQuestScore(ctx.world, 0, -50);
  }
  if (!hit) {
    ctx.effects.push({ type: 'attack', depth: ctx.depth, attacker: attacker.id, target: defender.id, hit, damage: 0 });
    return false;
  }
  // A sniper's thrown weapons find the weak points in any armour.
  const thrown = override.damage !== undefined;
  const sniping = isHero(attacker) && attacker.subclass === 'sniper' && thrown;
  const reduction = sniping ? 0 : ctx.rng.intRange(0, charArmor(defender));
  let damage = Math.max(damageRoll(ctx, attacker, override.damage) - reduction, 0);
  if (isHero(attacker) && !isHero(defender)) damage = masteredBlow(ctx, attacker, defender, damage, thrown);
  // Goo's touch may leave caustic ooze that burns until washed off in water.
  if (!isHero(attacker) && attacker.kind === 'goo' && ctx.rng.int(3) === 0 && isHero(defender)) {
    if (defender.ooze < 0) ctx.effects.push({ type: 'oozed', hero: defender.id });
    defender.ooze = 0;
  }
  // Char.attackProc and defenseProc: what a blow does besides the damage.
  if (!isHero(attacker)) {
    // The vampire bat drinks what it draws.
    if (attacker.kind === 'bat') attacker.hp += Math.min(damage, attacker.ht - attacker.hp);
    if (baseKind(attacker.kind) === 'thief' && !attacker.item && isHero(defender)) steal(ctx, attacker, defender);
    // Elemental.attackProc: half its blows set their target alight.
    if (attacker.kind === 'elemental' && ctx.rng.int(2) === 0 && !isWater(ctx.level.map[defender.pos]!)) {
      defender.burning = Math.max(defender.burning ?? 0, ELEMENTAL_BURNING);
    }
    if (isHero(defender)) {
      // Succubus.attackProc: one kiss in three charms her victim.
      if (attacker.kind === 'succubus' && ctx.rng.int(3) === 0) {
        defender.charmed = Math.max(defender.charmed, ctx.rng.intRange(3, 7));
        defender.charmedBy = attacker.id;
        ctx.effects.push({ type: 'charmed', hero: defender.id });
      }
      // Scorpio.attackProc: half its stings cripple.
      // Albino.attackProc: half its bites leave the hero bleeding.
      if (attacker.kind === 'albino' && ctx.rng.int(2) === 0 && damage > 0) defender.bleeding = Math.max(defender.bleeding ?? 0, damage);
      // Monk.attackProc: one blow in six knocks the weapon out of the hero's hands (knuckledusters stay on).
      if (baseKind(attacker.kind) === 'monk' && ctx.rng.int(6) === 0 && defender.weapon && defender.weapon.kind !== 'weapon.knuckles' && !defender.weapon.cursed) {
        const weapon = defender.weapon;
        defender.weapon = null;
        landItem(ctx, defender.pos, weapon);
        ctx.effects.push({ type: 'disarmed', depth: ctx.depth, hero: defender.id, mob: attacker.id, item: weapon });
      }
      // Senior.attackProc: now and then a blow stuns.
      if (attacker.kind === 'senior' && ctx.rng.int(10) === 0) defender.paralysed = Math.max(defender.paralysed, 1);
      if (baseKind(attacker.kind) === 'scorpio' && ctx.rng.int(2) === 0) {
        if (defender.crippled <= 0) ctx.effects.push({ type: 'crippled', hero: defender.id });
        defender.crippled = Math.max(defender.crippled, CRIPPLE_TURNS);
      }
      // RottingFist.attackProc: one blow in three leaves caustic ooze.
      if (attacker.kind === 'rottingFist' && ctx.rng.int(3) === 0) {
        if (defender.ooze < 0) ctx.effects.push({ type: 'oozed', hero: defender.id });
        defender.ooze = 0;
      }
    }
    // Mimic.attackProc: one bite in three knocks some gold out of the hero's purse.
    if (attacker.kind === 'mimic' && isHero(defender) && ctx.rng.int(3) === 0) {
      const lost = ctx.rng.intBetween(Math.trunc(defender.gold / 10), Math.trunc(defender.gold / 2));
      if (lost > 0) {
        defender.gold -= lost;
        dropItem(ctx.floor, defender.pos, createItem('gold', lost));
      }
    }
    // CursePersonification.attackProc: each blow throws its victim back a step, if there is room.
    if (attacker.kind === 'curse') shove(ctx, attacker, defender);
    // FetidRat.attackProc: one bite in three leaves caustic ooze (and, out of water, costs the quest's score).
    if (attacker.kind === 'fetidRat' && ctx.rng.int(3) === 0 && isHero(defender)) {
      if (defender.ooze < 0) ctx.effects.push({ type: 'oozed', hero: defender.id });
      defender.ooze = 0;
      if (!isWater(ctx.level.map[defender.pos]!)) addQuestScore(ctx.world, 0, -50);
    }
    // GnollTrickster.attackProc: each hit in a row worse than the last — poison, and from the sixth on, fire.
    if (attacker.kind === 'gnollTrickster') {
      if ((attacker.combo ?? 0) >= 1 && isHero(defender)) addQuestScore(ctx.world, 0, -50);
      attacker.combo = (attacker.combo ?? 0) + 1;
      const effect = ctx.rng.int(4) + attacker.combo;
      if (effect > 2) {
        if (effect >= 6 && (defender.burning ?? 0) <= 0) {
          if (!isWater(ctx.level.map[defender.pos]!)) defender.burning = Math.max(defender.burning ?? 0, ELEMENTAL_BURNING);
        } else {
          defender.poison = Math.max(defender.poison ?? 0, effect - 2);
        }
      }
    }
    // Undead.attackProc: now and then a blow stuns.
    if (attacker.kind === 'undead' && ctx.rng.int(5) === 0) defender.paralysed = Math.max(defender.paralysed ?? 0, 1);
    // Spinner.attackProc: half its bites are venomous, and then it backs off.
    if (attacker.kind === 'spinner' && ctx.rng.int(2) === 0) {
      defender.poison = Math.max(defender.poison ?? 0, ctx.rng.intBetween(7, 9));
      attacker.state = 'fleeing';
      attacker.target = defender.pos;
    }
  }
  // Hero.attackProc and defenseProc: an enchanted weapon's blow, an inscribed armour's answer.
  if (isHero(attacker) && !isHero(defender)) {
    weaponProc(ctx, attacker, defender, damage, thrown ? override.weapon ?? null : attacker.weapon);
    // Weapon.proc: every blow that lands makes the weapon better known, and wears it a little (a thrown boomerang wears as it comes back).
    if (!thrown && attacker.weapon) {
      familiarise(ctx, attacker, attacker.weapon);
      wear(ctx, attacker, attacker.weapon);
    }
  }

  if (isHero(defender) && !isHero(attacker)) {
    const mark = ctx.effects.length;
    damage = armorProc(ctx, attacker, defender, damage);
    // Armor.proc: and every blow taken makes the armour better known, and wears it.
    familiarise(ctx, defender, defender.armor);
    wear(ctx, defender, defender.armor);
    // The glyph's backlash may have felled its wearer, or an ankh raised them anew: the blow is spent.
    if (!isAlive(defender) || ctx.effects.slice(mark).some((e) => e.type === 'resurrected')) return true;
  }
  if (!isHero(defender) && defender.kind === 'swarm') split(ctx, defender, damage);
  // FetidRat.defenseProc: struck, it lets out a puff of paralytic gas.
  if (!isHero(defender) && defender.kind === 'fetidRat') seedGas(ctx, defender.pos, 'paralytic', 20);
  // Acidic.defenseProc: striking it splashes acid back on the striker.
  if (!isHero(defender) && defender.kind === 'acidic' && isHero(attacker) && damage > 0) {
    const acid = ctx.rng.intRange(0, damage);
    if (acid > 0) {
      ctx.effects.push({ type: 'hurt', depth: ctx.depth, who: attacker.id, damage: acid });
      hurt(ctx, attacker, acid, defender);
    }
  }
  // Yog.defenseProc: struck, Yog-Dzewa spawns a larva next to it.
  if (!isHero(defender) && defender.kind === 'yog') spawnLarva(ctx, defender);
  ctx.effects.push({ type: 'attack', depth: ctx.depth, attacker: attacker.id, target: defender.id, hit, damage });
  hurt(ctx, defender, damage, attacker);
  // Pickaxe.proc: a vampire bat slain with the pickaxe leaves its blood on it, as the blacksmith wants.
  if (isHero(attacker) && attacker.weapon?.kind === 'weapon.pickaxe' && !thrown && !isHero(defender) && defender.kind === 'bat' && !isAlive(defender)) {
    attacker.weapon.bloody = true;
  }
  // Hero.defenseProc: a ring of thorns turns some of the blow back on the attacker.
  if (isHero(defender) && !isHero(attacker) && isAlive(attacker) && defender.rings.some((r) => r.kind === 'ring.thorns')) {
    const back = ctx.rng.intRange(0, damage);
    if (back > 0) {
      ctx.effects.push({ type: 'hurt', depth: ctx.depth, who: attacker.id, damage: back });
      hurt(ctx, attacker, back, defender);
    }
  }
  return true;
}

/** What a ring of elements can shield a hero from (RingOfElements.Resistance.FULL). */
const ELEMENTAL: ReadonlySet<string> = new Set(['poison', 'burning', 'lightning', 'gas', 'shaman', 'warlock', 'eye', 'burningFist']);

/** Shopkeeper.flee: attacked, he vanishes, and his wares with him. */
function shopkeeperFlees(ctx: Ctx, keeper: Mob): void {
  ctx.floor.heaps = ctx.floor.heaps.filter((heap) => heap.kind !== 'forSale');
  ctx.floor.mobs.splice(ctx.floor.mobs.indexOf(keeper), 1);
  leaveCell(ctx.world, ctx.level, ctx.depth, keeper.pos);
  ctx.effects.push({ type: 'shopkeeperFled', depth: ctx.depth, mob: keeper.id, pos: keeper.pos });
}

/**
 * Hero.attackProc and Mob.defenseProc for a mastered hero: the gladiator's
 * combo, the battlemage's wand charging, the assassin's surprise attacks.
 */
function masteredBlow(ctx: Ctx, hero: Hero, mob: Mob, damage: number, thrown: boolean): number {
  switch (hero.subclass) {
    case 'gladiator': {
      if (thrown) return damage;
      // Combo: hit after hit without a break, the third and every later one harder.
      hero.combo = hero.time <= hero.comboUntil ? hero.combo + 1 : 1;
      // Combo.hit: the next blow must come within this long (a normal blow takes a turn).
      hero.comboUntil = hero.time + (hero.combo >= 3 ? 1.41 - hero.combo / 10 : 1.1);
      if (hero.combo < 3) return damage;
      ctx.effects.push({ type: 'combo', hero: hero.id, count: hero.combo });
      return damage + Math.trunc((damage * (hero.combo - 2)) / 5);
    }
    case 'battlemage':
      // Each blow may give a wand in the pack a charge back.
      if (!thrown && ctx.rng.int(3) === 0) {
        const wand = hero.items.find((item) => item.charges !== undefined && item.charges < wandMaxCharges(item));
        if (wand) wand.charges = wand.charges! + 1;
      }
      return damage;
    case 'assassin':
      // A blow out of nowhere hurts all the more.
      return mob.enemySeen ? damage : damage + ctx.rng.intBetween(1, Math.max(2, damage));
    default:
      return damage;
  }
}

/**
 * CursePersonification.attackProc: the victim is pushed one step straight away from the curse.
 * A monster may be pushed onto a trap or over a chasm too, and presses where it lands (Level.mobPress).
 */
function shove(ctx: Ctx, curse: Mob, victim: Char): void {
  const offset = victim.pos - curse.pos;
  if (!NEIGHBOURS8.includes(offset)) return;
  const to = victim.pos + offset;
  const room = isPassable(ctx.level, to) || (!isHero(victim) && hasFlag(ctx.level.map[to]!, F.AVOID));
  if (!room || charAt(ctx.world, ctx.depth, to)) return;
  const from = victim.pos;
  victim.pos = to;
  leaveCell(ctx.world, ctx.level, ctx.depth, from);
  enterCell(ctx.level, to);
  ctx.effects.push({ type: 'pushed', depth: ctx.depth, mob: victim.id, from, to });
  if (!isHero(victim)) mobPress(ctx, victim);
}

/** Cripple.DURATION. */
export const CRIPPLE_TURNS = 10;

function spawnLarva(ctx: Ctx, yog: Mob): void {
  const { world, depth, level, rng, floor } = ctx;
  const cells = NEIGHBOURS8.map((n) => yog.pos + n).filter((c) => isPassable(level, c) && !charAt(world, depth, c));
  if (cells.length === 0) return;
  const larva = createMob(`#${++world.nextId}`, 'larva', rng.element(cells)!, 'hunting', floor.now + 1);
  Object.assign(larva, { enemy: yog.enemy, target: yog.target });
  floor.mobs.push(larva);
  enterCell(level, larva.pos);
}

const isFist = (mob: Mob): boolean => mob.kind === 'rottingFist' || mob.kind === 'burningFist';

/** Thief.steal: a whole stack from the pack (never a key or a quest item), then off it runs. */
function steal(ctx: Ctx, thief: Mob, hero: Hero): void {
  // (Thief.steal: nor anything unique, as the warrior's seal and the waterskin are.)
  const loot = looseItems(hero).filter((item) => !['key', 'quest', 'seal', 'vial'].includes(itemDef(item.kind).category));
  if (loot.length === 0) return;
  const item = ctx.rng.element(loot)!;
  hero.items.splice(hero.items.indexOf(item), 1);
  thief.item = item;
  thief.state = 'fleeing';
  // Bandit.steal: a crazy bandit throws something in the hero's eyes as well.
  if (thief.kind === 'bandit') hero.blind = Math.max(hero.blind ?? 0, ctx.rng.intBetween(5, 12));
  ctx.effects.push({ type: 'stole', depth: ctx.depth, mob: thief.id, hero: hero.id, item });
}

/** Swarm.defenseProc: struck, the swarm splits, half of what is left flying off next to it. */
function split(ctx: Ctx, swarm: Mob, damage: number): void {
  if (swarm.hp < damage + 2) return;
  const { world, depth, level, rng, floor } = ctx;
  const cells = NEIGHBOURS4.map((n) => swarm.pos + n).filter((c) => isPassable(level, c) && !charAt(world, depth, c));
  if (cells.length === 0) return;
  const clone = createMob(`#${++world.nextId}`, 'swarm', rng.element(cells)!, 'hunting', floor.now + 1);
  clone.generation = (swarm.generation ?? 0) + 1;
  clone.hp = Math.trunc((swarm.hp - damage) / 2);
  clone.enemy = swarm.enemy;
  if ((swarm.burning ?? 0) > 0) clone.burning = swarm.burning;
  if ((swarm.poison ?? 0) > 0) clone.poison = 2;
  swarm.hp -= clone.hp;
  floor.mobs.push(clone);
  enterCell(level, clone.pos);
}

/** What hurts without being a character. */
export type Hazard = 'poison' | 'burning' | 'ooze' | 'lightning' | 'gripping' | 'hunger' | 'bones' | 'gas' | 'fall' | 'deferred' | 'bleeding' | 'dry' | 'multiplicity' | 'bomb';

export function hurt(ctx: Ctx, victim: Char, damage: number, source: Char | Hazard): void {
  if (!isAlive(victim)) return;
  // The sad ghost cannot be harmed; the shopkeeper will not stay to be.
  if (!isHero(victim) && victim.state === 'passive' && victim.kind !== 'bee') {
    if (isShopkeeper(victim)) shopkeeperFlees(ctx, victim);
    return;
  }
  const by = typeof source === 'string' ? null : source;
  if (!isHero(victim)) {
    if (victim.state === 'sleeping') victim.state = 'wandering';
    victim.alerted = true;
    // In a party, a monster turns on whoever hurt it.
    if (by && isHero(by)) victim.enemy = by.id;
    // Terror.recover: struck again, a frightened monster pulls itself together.
    if ((victim.terror ?? 0) > 0 && victim.terror! < TERROR_TURNS) victim.terror = 0;
  }
  // A ring of elements: now and then, elemental harm is much reduced (Char.damage with a resistance).
  if (isHero(victim)) {
    const elements = ringBonus(victim, 'ring.elements');
    const what = typeof source === 'string' ? source : isHero(source) ? '' : source.kind;
    if (elements > 0 && ELEMENTAL.has(what) && ctx.rng.int(elements + 3) >= 3) damage = ctx.rng.intRange(0, damage);
  }
  // Earthroot's bark takes the blows first.
  if (isHero(victim)) damage = earthrootAbsorbs(victim, damage);
  // Char.damage: the warrior's seal may raise its shield, and shields take what they can (not hunger's).
  if (isHero(victim)) damage = shieldDamage(ctx, victim, damage, source === 'hunger');
  if (!isHero(victim) && victim.kind === 'yog') {
    // Yog.damage: each living fist halves the harm, and they all come to defend it.
    const fists = ctx.floor.mobs.filter(isFist);
    damage >>= fists.length;
    for (const fist of fists) {
      if (fist.state !== 'hunting') fist.state = 'wandering';
      fist.target = victim.pos;
    }
  }
  // DemonSpawner.damage: heavy blows blunted, every point hastening its next demon.
  if (!isHero(victim) && victim.kind === 'demonSpawner') damage = spawnerDamage(victim, damage);
  victim.hp -= damage;
  // Goo.damage, Tengu.damage…: hurting a boss keeps a sealed floor's healing going (LockedFloor.addTime).
  if (!isHero(victim)) bossHurt(ctx, victim, damage);
  // Brute.damage: below a quarter of its health, the brute flies into a rage.
  if (!isHero(victim) && baseKind(victim.kind) === 'brute' && isAlive(victim) && !victim.enraged && victim.hp < victim.ht / 4) {
    victim.enraged = true;
    victim.time += 1;
    ctx.effects.push({ type: 'enraged', depth: ctx.depth, mob: victim.id });
  }
  if (!isAlive(victim)) {
    if (isHero(victim)) {
      victim.killedBy = typeof source === 'string' ? source : isHero(source) ? source.heroClass : source.kind;
      heroDied(ctx, victim);
    } else {
      if (by && isHero(by)) {
        by.kills++;
        if (victim.kind === 'piranha') statsOf(by).piranhas++;
      }
      mobDied(ctx, victim, by && isHero(by) ? by.id : undefined);
    }
  }
}

/** Burning.DURATION, as an elemental's touch sets it. */
const ELEMENTAL_BURNING = 8;

/** Crab.lootChance. */
const CRAB_MEAT_CHANCE = 0.167;

function mobDied(ctx: Ctx, mob: Mob, by?: string): void {
  mob.hp = 0;
  ctx.floor.mobs.splice(ctx.floor.mobs.indexOf(mob), 1);
  leaveCell(ctx.world, ctx.level, ctx.depth, mob.pos);
  ctx.effects.push({ type: 'died', depth: ctx.depth, who: mob.id, pos: mob.pos, kind: mob.kind, ...(by ? { by } : {}) });
  sacrifice(ctx, mob);
  arenaKill(ctx, mob);

  // Everyone fighting on the depth learns from the kill, not just the killer.
  const stats = mobStats(mob);
  const heroes = heroesOn(ctx.world, ctx.depth);
  for (const hero of heroes) {
    // Mob.die: only a monster worth something teaches anything (and feeds a warlock).
    if (stats.exp > 0 && hero.lvl <= stats.maxLvl) earnExp(ctx, hero, stats.exp);
  }

  ghostFoeSlain(ctx, mob, by);
  impQuestKill(ctx, mob);

  // A thief's stolen goods fall where it dies, and a mimic's treasure (Level.drop: as the challenges allow;
  // a flier slain over a chasm drops them through it).
  if (mob.item) landItem(ctx, mob.pos, mob.item);
  for (const item of mob.loot ?? []) landItem(ctx, mob.pos, item);

  // Mob.dropLoot, unless the party has outgrown the monster.
  if (heroes.some((h) => h.lvl <= stats.maxLvl + 2)) {
    const loot = dropLoot(ctx, mob);
    if (loot) landItem(ctx, mob.pos, loot);
  }


  if (mob.kind === 'skeleton') explode(ctx, mob);

  if (mob.kind === 'yog') {
    // Its fists die with it.
    for (const fist of ctx.floor.mobs.filter(isFist)) {
      ctx.effects.push({ type: 'hurt', depth: ctx.depth, who: fist.id, damage: fist.hp });
      fist.hp = 0;
      mobDied(ctx, fist);
    }
  }
  if (mob.kind === 'goo' || mob.kind === 'tengu' || mob.kind === 'dm300' || mob.kind === 'king' || mob.kind === 'yog') {
    const { level } = ctx;
    // Goo's lair dries out behind the heroes; Tengu's arena opens; the rock
    // in DM-300's way back crumbles.
    if (level.map[level.entrance] === T.WATER) level.map[level.entrance] = T.ENTRANCE;
    if (level.arenaDoor !== undefined && (level.map[level.arenaDoor] === T.LOCKED_DOOR || level.map[level.arenaDoor] === T.WALL)) {
      level.map[level.arenaDoor] = level.map[level.arenaDoor] === T.WALL ? T.EMPTY_DECO : T.DOOR;
      ctx.effects.push({ type: 'arena', depth: ctx.depth, sealed: false });
    }
    // Goo, Tengu, DM-300 and the King drop a skeleton key for the locked way down; Yog's fall opens it.
    if (mob.kind === 'yog') {
      if (level.map[level.exit] === T.LOCKED_EXIT) level.map[level.exit] = T.UNLOCKED_EXIT;
    } else if (!ctx.world.arena) {
      // (The arena has no locked way down for it to open.)
      dropItem(ctx.floor, mob.pos, { ...createItem('key.skeleton'), depth: ctx.depth });
    }
    ctx.effects.push({ type: 'yell', depth: ctx.depth, mob: mob.id, kind: mob.kind, line: 'death' });
    ctx.effects.push({ type: 'bossSlain', depth: ctx.depth, kind: mob.kind });
    // King.die: the armour kit.
    if (mob.kind === 'king') dropItem(ctx.floor, mob.pos, createItem('kit.armor'));
    // Tengu.die: a Tome of Mastery, here one for every hero who has not mastered yet.
    if (mob.kind === 'tengu') {
      for (const hero of ctx.world.heroes) if (!hero.subclass) dropItem(ctx.floor, mob.pos, createItem('tome.mastery'));
    }
  }
}

/** What a monster leaves behind (Mob.loot and lootChance, or its own dropLoot). */
function dropLoot(ctx: Ctx, mob: Mob): Item | null {
  const { rng } = ctx;
  const generator = (): ItemGenerator => new ItemGenerator(rng, ctx.depth);
  switch (baseKind(mob.kind)) {
    // GnollTrickster.createLoot: always a set of thrown weapons, plain, uncursed and known, half of them.
    case 'gnollTrickster': {
      let loot = generator().of('weapon');
      // SEAM(gear): Generator.Category.MISSILE; Pixel Dungeon's weapon table holds the thrown ones.
      for (let i = 0; i < 20 && itemDef(loot.kind).category !== 'missile'; i++) loot = generator().of('weapon');
      if (itemDef(loot.kind).category !== 'missile') loot = createItem('missile.dart', 4);
      loot.level = 0;
      delete loot.cursed;
      delete loot.enchant;
      delete loot.levelUnknown;
      delete loot.curseUnknown;
      loot.qty = Math.trunc((loot.qty + 1) / 2);
      return loot;
    }
    // DemonSpawner: always a potion of healing.
    case 'demonSpawner':
      return createItem('potion.healing');
    // GreatCrab: always two pieces of mystery meat.
    case 'greatCrab':
      return createItem('food.meat', 2);
    case 'gnoll':
      return rng.float() < 0.5 ? rollGold(rng, ctx.depth) : null;
    case 'crab':
      return rng.float() < CRAB_MEAT_CHANCE ? createItem('food.meat') : null;
    case 'skeleton': {
      // The worst of three weapons, one time in five.
      if (rng.int(5) !== 0) return null;
      let loot = generator().of('weapon');
      for (let i = 0; i < 2; i++) {
        const other = generator().of('weapon');
        if (other.level < loot.level) loot = other;
      }
      return loot;
    }
    case 'swarm':
      return rng.int(5 * ((mob.generation ?? 0) + 1)) === 0 ? createItem('potion.healing') : null;
    case 'shaman':
      return rng.float() < 0.33 ? generator().of('scroll') : null;
    case 'bat':
      return rng.float() < 0.125 ? createItem('potion.healing') : null;
    case 'brute':
      return rng.float() < 0.5 ? rollGold(rng, ctx.depth) : null;
    case 'thief':
      return rng.float() < 0.01 ? randomRing(rng, 'ring.haggler') : null;
    case 'dm300':
      return rng.float() < 0.333 ? randomRing(rng, 'ring.thorns') : null;
    case 'goo':
      return rng.float() < 0.333 ? createItem('beacon') : null;
    case 'spinner':
      return rng.float() < 0.125 ? createItem('food.meat') : null;
    case 'elemental':
      return rng.float() < 0.1 ? createItem('potion.liquidFlame') : null;
    case 'monk':
      return rng.float() < 0.083 ? createItem('food.ration') : null;
    case 'warlock':
      return rng.float() < 0.83 ? generator().of('potion') : null;
    case 'succubus':
      return rng.float() < 0.05 ? createItem('scroll.lullaby') : null;
    case 'eye':
      return rng.float() < 0.5 ? createItem('dew') : null;
    case 'scorpio':
      if (rng.int(8) === 0) return createItem('potion.healing');
      return rng.int(6) === 0 ? createItem('food.meat') : null;
    default:
      return null;
  }
}

/** Skeleton.die: its bones fly apart, hurting everyone around. */
function explode(ctx: Ctx, skeleton: Mob): void {
  ctx.effects.push({ type: 'bones', depth: ctx.depth, pos: skeleton.pos });
  for (const n of NEIGHBOURS8) {
    const victim = charAt(ctx.world, ctx.depth, skeleton.pos + n);
    if (!victim || !isAlive(victim)) continue;
    const [min, max] = MOBS.skeleton.damage;
    const damage = Math.max(0, ctx.rng.normalIntRange(min, max) - ctx.rng.intRange(0, Math.trunc(charArmor(victim) / 2)));
    ctx.effects.push({ type: 'hurt', depth: ctx.depth, who: victim.id, damage });
    hurt(ctx, victim, damage, isHero(victim) ? 'bones' : skeleton);
  }
}

function heroDied(ctx: Ctx, hero: Hero): void {
  if (hero.items.some((item) => item.kind === 'ankh')) {
    resurrect(ctx, hero);
    return;
  }
  sacrifice(ctx, hero);
  hero.hp = 0;
  hero.intent = null;
  leaveCell(ctx.world, ctx.level, ctx.depth, hero.pos);
  ctx.effects.push({ type: 'died', depth: ctx.depth, who: hero.id, pos: hero.pos });
  if (!ctx.world.heroes.some(isAlive)) {
    ctx.world.over = true;
    // Hero.die: once it is all over, everything the heroes carried is known for what it was.
    for (const other of ctx.world.heroes) identifyBelongings(ctx.world, other);
  }
}

/**
 * Hero.resurrect, with an ankh: back on their feet at the stairs (or where
 * they fell, on a boss's level), whole and
 * rid of every ailment, but with nothing left in the pack except keys and
 * quest items, no gold, and no experience towards the next level.
 */
function resurrect(ctx: Ctx, hero: Hero): void {
  const { world, level, depth } = ctx;
  hero.items = hero.items.filter((item) => ['key', 'quest', 'tome'].includes(itemDef(item.kind).category));
  Object.assign(hero, {
    hp: hero.ht, gold: 0, exp: 0, killedBy: null, intent: null, ooze: -1, poison: 0, burning: 0, paralysed: 0, rooted: 0,
    slowed: 0, weakened: 0, crippled: 0, charmed: 0, charmedBy: null, hunger: 0, deferred: 0, blind: 0, bleeding: 0, dizzy: 0,
    levitating: 0,
  });
  // On a boss's level the hero gets up where they fell: the stairs may be sealed off from the fight.
  if (!isBossDepth(depth)) {
    leaveCell(world, level, depth, hero.pos);
    hero.pos = freeCellNear(world, level, depth, level.entrance);
    enterCell(level, hero.pos);
  }
  observe(world, hero);
  ctx.effects.push({ type: 'resurrected', hero: hero.id });
}

/** Hero.earnExp, now in hero.ts. */
export { earnExp };
