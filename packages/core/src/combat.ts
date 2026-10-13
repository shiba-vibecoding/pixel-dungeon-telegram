import { wear } from './wear';
import { familiarise, identifyBelongings } from './ident';
import { bossHurt, earnExp } from './hero';
import { shieldDamage } from './seal';
import {
  baseKind, isShopkeeper, statsOf, createMob, type Hero, heroArmor, heroAttackSkill, heroDamageRoll, heroDefenseSkill, isAlive,
  type Mob, type MobKind, mobStats, ringBonus,
} from './actors';
import {
  charAt, type Char, type Ctx, dropItem, enterCell, freeCellNear, heroesOn, isHero, isPassable, isWater, landItem, leaveCell,
  observe,
} from './floor';
import { armorStats, createItem, type Item, itemDef, randomRing, wandMaxCharges } from './items';
import { NEIGHBOURS8, NEIGHBOURS9, WIDTH } from './level/geometry';
import { armorProc, TERROR_TURNS, weaponProc } from './enchant';
import { earthrootAbsorbs } from './plants';
import { impQuestKill } from './imp';
import { curseBroken, questKill } from './quest';
import { sacrifice } from './altar';
import { F, hasFlag, T } from './level/terrain';
import { burst, mobPress } from './traps';
import { isBossDepth } from './level/builder';
import { arenaKill } from './arena';
import { ignite, rollFactor } from './afflict';
import { championAttackProc, championDamage, evasionAndAccuracyFactor, meleeDamageFactor } from './champions';
import { isEnemy, rollToDropLoot } from './mobs';
import {
  afterDamage, cheatDeath, crystalBite, hostGone, INFINITE_ACCURACY, INFINITE_EVASION, minionsDie, mobAttackProc, mobDamage,
  mobDamageRange, mobDefenseProc, mobDefenseSkill, parried, potDropped, reveal, steal,
} from './mobskills';
import type { World } from './world';

/*
 * Combat as in Char.attack: an accuracy roll against an evasion roll (Char.hit:
 * hexed a fifth worse, a champion's own factor), then the blow — a champion's
 * stronger, a weakened one two thirds as hard — through the defender's
 * defenseProc, less a roll of its armour, a third more if it is vulnerable,
 * then the attacker's attackProc, and the harm.
 */

function attackSkill(char: Char): number {
  return isHero(char) ? heroAttackSkill(char) : mobStats(char).attack;
}

/**
 * Char.defenseSkill against `attacker`: a hero's; a monster's, unless the hero catches it off guard (Mob.surprisedBy:
 * it has not seen its enemy, or they are unseen) or it is paralysed — and each kind's own (a focused monk parries
 * anything, a great crab blocks the enemy it sees: mobskills.ts).
 */
function defenseSkill(char: Char, attacker?: Char): number {
  if (isHero(char)) return heroDefenseSkill(char);
  const surprised = attacker !== undefined && isHero(attacker) && (attacker.invisible > 0 || !char.enemySeen);
  const base = surprised || (char.paralysed ?? 0) > 0 ? 0 : mobStats(char).defense;
  return mobDefenseSkill(char, attacker, base);
}

/** Char.defenseSkill, as a monster's ranged attack (or anyone's) is weighed against it. */
export function defenseOf(char: Char, attacker?: Char): number {
  return defenseSkill(char, attacker);
}

/** The most a character's armour may take off a blow: a hero's armour's; a monster's drRoll at its highest. */
export function charArmor(char: Char): number {
  if (isHero(char)) return heroArmor(char);
  const stats = mobStats(char);
  return stats.dr + (stats.dr2 ?? 0) + (stats.drFlat ?? 0) + (char.armor ? armorStats(char.armor).dr : 0);
}

/**
 * Char.drRoll: a hero's armour (a roll up to it); a monster's NormalIntRange(0, dr), and the second roll and flat
 * part its kind adds (Mob.drRoll), an armoured statue's armour on top (SEAM(gear): Armor.DRMin..DRMax).
 */
export function armorRoll(ctx: Ctx, char: Char): number {
  if (isHero(char)) return ctx.rng.intRange(0, heroArmor(char));
  const stats = mobStats(char);
  let dr = ctx.rng.normalIntRange(0, stats.dr);
  if (stats.dr2) dr += ctx.rng.normalIntRange(0, stats.dr2);
  dr += stats.drFlat ?? 0;
  if (char.armor) dr += ctx.rng.normalIntRange(0, armorStats(char.armor).dr);
  return dr;
}

function damageRoll(ctx: Ctx, char: Char, range?: readonly [number, number]): number {
  if (range) return ctx.rng.normalIntRange(range[0], range[1]);
  if (isHero(char)) return heroDamageRoll(char, ctx.rng);
  const [min, max] = mobDamageRange(char);
  return ctx.rng.normalIntRange(min, max);
}

/** Changes to an attacker's usual numbers, e.g. a pumped-up Goo. */
export interface AttackOverride {
  attack?: number;
  damage?: readonly [number, number];
  /** A hero's thrown weapon, whose enchantment the shot carries (Hero.attackProc: rangedWeapon). */
  weapon?: Item;
  /** A hidden mimic's bite (Mimic.interact): no blow's procs of its own. */
  ambush?: boolean;
}

/**
 * Char.hit: the attacker's roll (a hex a fifth worse, a champion's factor) against the defender's; infinite evasion
 * beats anything, infinite accuracy anything else.
 */
export function hitRoll(ctx: Ctx, attacker: Char, defender: Char, skill: number, accMulti = 1): boolean {
  const defense = defenseSkill(defender, attacker);
  if (defense >= INFINITE_EVASION) return false;
  if (skill >= INFINITE_ACCURACY) return true;
  const acuRoll = ctx.rng.floatMax(skill) * rollFactor(attacker) * evasionAndAccuracyFactor(attacker) * accMulti;
  const defRoll = ctx.rng.floatMax(defense) * rollFactor(defender) * evasionAndAccuracyFactor(defender);
  return acuRoll >= defRoll;
}

/** One blow or shot; returns whether it hit. */
export function attack(ctx: Ctx, attacker: Char, defender: Char, override: AttackOverride = {}): boolean {
  // Striking gives an invisible hero away.
  if (isHero(attacker)) attacker.invisible = 0;
  const skill = override.attack ?? attackSkill(attacker);
  const hit = hitRoll(ctx, attacker, defender, skill);
  if (!hit) {
    parried(ctx, defender);
    ctx.effects.push({ type: 'attack', depth: ctx.depth, attacker: attacker.id, target: defender.id, hit, damage: 0 });
    return false;
  }
  // A sniper's thrown weapons find the weak points in any armour.
  const thrown = override.damage !== undefined;
  const sniping = isHero(attacker) && attacker.subclass === 'sniper' && thrown;
  const reduction = sniping ? 0 : armorRoll(ctx, defender);
  let raw = damageRoll(ctx, attacker, override.damage);
  // ChampionEnemy.meleeDamageFactor; Weakness: two thirds as hard.
  raw *= meleeDamageFactor(attacker);
  if ((attacker.weakened ?? 0) > 0) raw *= 0.67;
  raw = Math.round(raw);
  // Mob.defenseProc of the struck monster's kind, before its armour (a swarm splits, a thief drops a coin...).
  if (!isHero(defender)) {
    if (defender.kind === 'swarm') split(ctx, defender, raw);
    raw = mobDefenseProc(ctx, defender, attacker, raw);
  }
  let damage = Math.max(raw - reduction, 0);
  // Vulnerable: a third more, after the armour.
  if ((defender.vulnerable ?? 0) > 0) damage = Math.trunc(damage * 1.33);
  if (isHero(attacker) && !isHero(defender)) damage = masteredBlow(ctx, attacker, defender, damage, thrown);
  // Goo's touch may leave caustic ooze that burns until washed off in water.
  if (!isHero(attacker) && attacker.kind === 'goo' && ctx.rng.int(3) === 0 && isHero(defender)) {
    if (defender.ooze < 0) ctx.effects.push({ type: 'oozed', hero: defender.id });
    defender.ooze = 0;
  }
  // Char.attackProc: what a monster's blow does besides the damage (mobskills.ts), a champion's too.
  if (!isHero(attacker) && !override.ambush) {
    if ((attacker.kind === 'thief' || attacker.kind === 'bandit') && !attacker.item && isHero(defender) && !attacker.ally) {
      if (steal(ctx, attacker, defender)) attacker.state = 'fleeing';
    }
    damage = mobAttackProc(ctx, attacker, defender, damage);
    championAttackProc(ctx, attacker, defender, (char) => ignite(char));
    if (isHero(defender)) {
      // RottingFist.attackProc: one blow in three leaves caustic ooze.
      if (attacker.kind === 'rottingFist' && ctx.rng.int(3) === 0) {
        if (defender.ooze < 0) ctx.effects.push({ type: 'oozed', hero: defender.id });
        defender.ooze = 0;
      }
    }
    // CursePersonification.attackProc: each blow throws its victim back a step, if there is room.
    if (attacker.kind === 'curse') shove(ctx, attacker, defender);
    // Undead.attackProc: now and then a blow stuns.
    if (attacker.kind === 'undead' && ctx.rng.int(5) === 0) defender.paralysed = Math.max(defender.paralysed ?? 0, 1);
    // CrystalMimic.attackProc, out in the open: whom it bites is thrown aside, and it runs.
    if (attacker.kind === 'crystalMimic') crystalBite(ctx, attacker, defender);
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

/**
 * Swarm.defenseProc: struck for less than it has left, the swarm splits — a clone with half of what will be left
 * flies off beside it (not into walls; into traps and chasms all the same), burning or poisoned as it is, the same
 * champion, teaching nothing.
 */
function split(ctx: Ctx, swarm: Mob, damage: number): void {
  if (swarm.hp < damage + 2) return;
  const { world, depth, level, rng, floor } = ctx;
  const cells = [swarm.pos + 1, swarm.pos - 1, swarm.pos + WIDTH, swarm.pos - WIDTH].filter((c) =>
    !hasFlag(level.map[c]!, F.SOLID) && !charAt(world, depth, c) && (isPassable(level, c) || hasFlag(level.map[c]!, F.AVOID)));
  if (cells.length === 0) return;
  const clone = createMob(`#${++world.nextId}`, 'swarm', rng.element(cells)!, 'hunting', floor.now + 1);
  clone.generation = (swarm.generation ?? 0) + 1;
  clone.hp = Math.trunc((swarm.hp - damage) / 2);
  clone.enemy = swarm.enemy;
  if ((swarm.burning ?? 0) > 0) clone.burning = swarm.burning;
  if ((swarm.poison ?? 0) > 0) clone.poison = 2;
  if (swarm.champion) {
    clone.champion = swarm.champion;
    if (swarm.champion === 'growing') clone.growth = 1.19;
  }
  swarm.hp -= clone.hp;
  floor.mobs.push(clone);
  enterCell(level, clone.pos);
  ctx.effects.push({ type: 'pushed', depth, mob: clone.id, from: swarm.pos, to: clone.pos });
  if (!hasFlag(level.map[clone.pos]!, F.PASSABLE)) mobPress(ctx, clone);
}

/** What hurts without being a character. */
export type Hazard =
  | 'poison' | 'burning' | 'ooze' | 'lightning' | 'gripping' | 'hunger' | 'bones' | 'gas' | 'fall' | 'deferred' | 'bleeding' | 'dry'
  | 'multiplicity' | 'bomb'
  /** Shattered's monsters: a brute's rage spent, a ghoul's host gone, a minion's master slain, a wand (a great crab blocks it). */
  | 'rage' | 'lifelink' | 'master' | 'wand';

/** Who cannot be harmed: the folk (the sad ghost, the quest givers, the sheep); a shopkeeper will not stay to be. */
const untouchable = (mob: Mob): boolean => mob.state === 'passive' && !isEnemy(mob);

export function hurt(ctx: Ctx, victim: Char, damage: number, source: Char | Hazard): void {
  if (!isAlive(victim)) return;
  if (!isHero(victim) && untouchable(victim)) {
    if (isShopkeeper(victim)) shopkeeperFlees(ctx, victim);
    return;
  }
  const by = typeof source === 'string' ? null : source;
  if (!isHero(victim)) {
    // Mob.damage: it wakes, and unless it hunts already (or flees), it is alerted to who struck it.
    if (victim.state === 'sleeping') victim.state = 'wandering';
    if (victim.state !== 'fleeing' && victim.state !== 'hunting') victim.alerted = true;
    // Mimic.damage: struck, a hidden mimic is out.
    if (victim.hidden) reveal(ctx, victim);
    // Statue.damage: struck, a statue comes to life.
    if ((victim.kind === 'statue' || victim.kind === 'armoredStatue') && victim.state === 'wandering') victim.state = 'hunting';
    // In a party, a monster turns on whoever hurt it.
    if (by && isHero(by) && !victim.ally) victim.enemy = by.id;
    // Terror.recover: struck again, a frightened monster pulls itself together.
    if ((victim.terror ?? 0) > 0 && victim.terror! < TERROR_TURNS) victim.terror = 0;
    // Each kind's own Char.damage (a slime's membrane, a charging eye...), and a champion's.
    damage = mobDamage(ctx, victim, damage, source);
    damage = championDamage(victim, damage);
    if (damage > 0 && (victim.barrier ?? 0) > 0) {
      // A succubus's Barrier takes what it can.
      const absorbed = Math.min(victim.barrier!, damage);
      victim.barrier! -= absorbed;
      damage -= absorbed;
    }
  }
  // A ring of elements: now and then, elemental harm is much reduced (Char.damage with a resistance).
  if (isHero(victim)) {
    const elements = ringBonus(victim, 'ring.elements');
    const what = typeof source === 'string' ? source : isHero(source) ? '' : source.kind;
    if (elements > 0 && ELEMENTAL.has(what) && ctx.rng.int(elements + 3) >= 3) damage = ctx.rng.intRange(0, damage);
    // Charm.recover: a blow shakes off five turns of a charm (but the one that came with a succubus's kiss).
    if (victim.charmed > 0 && damage > 0) {
      if (victim.charmShrug) {
        victim.charmShrug = false;
      } else {
        victim.charmed = Math.max(0, victim.charmed - 5);
        if (victim.charmed <= 0) victim.charmedBy = null;
      }
    }
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
  victim.hp -= damage;
  // Goo.damage, Tengu.damage…: hurting a boss keeps a sealed floor's healing going (LockedFloor.addTime).
  if (!isHero(victim)) {
    bossHurt(ctx, victim, damage);
    afterDamage(ctx, victim, source);
  }
  if (!isAlive(victim)) {
    if (isHero(victim)) {
      victim.killedBy = typeof source === 'string' ? source : isHero(source) ? source.heroClass : source.kind;
      heroDied(ctx, victim);
    } else {
      // A brute's last rage, a ghoul crumpling beside another: not dead yet.
      if (cheatDeath(ctx, victim, source)) return;
      if (by && isHero(by)) {
        by.kills++;
        if (baseKind(victim.kind) === 'piranha') statsOf(by).piranhas++;
      }
      if (source === 'fall') victim.fell = true;
      mobDied(ctx, victim, by && isHero(by) ? by.id : undefined);
    }
  }
}

function mobDied(ctx: Ctx, mob: Mob, by?: string): void {
  mob.hp = 0;
  const index = ctx.floor.mobs.indexOf(mob);
  if (index >= 0) ctx.floor.mobs.splice(index, 1);
  leaveCell(ctx.world, ctx.level, ctx.depth, mob.pos);
  ctx.effects.push({ type: 'died', depth: ctx.depth, who: mob.id, pos: mob.pos, kind: mob.kind, ...(by ? { by } : {}) });
  // The curse, broken, is the ghost again: nothing to learn from it, nothing left behind.
  if (mob.kind === 'curse') {
    curseBroken(ctx, mob);
    return;
  }
  sacrifice(ctx, mob);
  arenaKill(ctx, mob);
  // Mob.destroy: the bestiary counts the slain.
  if (isEnemy(mob)) countSlain(ctx.world, mob.kind);

  if (!mob.ally) {
    // Mob.destroy: everyone fighting on the depth learns from the kill, not just the killer — what the monster is
    // worth, if they have not outgrown it; a split swarm teaches nothing; Mob.die from a fall teaches half (rounded
    // up or down at random).
    const stats = mobStats(mob);
    let exp = mob.kind === 'swarm' && (mob.generation ?? 0) > 0 ? 0 : stats.exp;
    if (mob.fell) {
      if (exp % 2 === 1) exp += ctx.rng.int(2);
      exp = Math.trunc(exp / 2);
    }
    for (const hero of heroesOn(ctx.world, ctx.depth)) {
      if (exp > 0 && hero.lvl <= stats.maxLvl) earnExp(ctx, hero, exp);
    }
  }

  questKill(ctx, mob);
  impQuestKill(ctx, mob);

  if (!mob.ally) {
    // Thief.rollToDropLoot and Mimic.rollToDropLoot: a thief's stolen goods, a mimic's treasure (Level.drop: as the
    // challenges allow; a flier slain over a chasm drops them through it).
    if (mob.item && mob.kind !== 'statue' && mob.kind !== 'armoredStatue') landItem(ctx, mob.pos, mob.item);
    // Thief.rollToDropLoot: a shattered pot it carried lies there now, its bee guarding it.
    if (mob.item?.kind === 'honeypot.shattered' || mob.loot?.some((i) => i.kind === 'honeypot.shattered')) potDropped(ctx, mob.id, mob.pos);
    // Statue.die: its weapon (and an armoured one's armour), known for what they are.
    if ((mob.kind === 'statue' || mob.kind === 'armoredStatue') && mob.item) landItem(ctx, mob.pos, mob.item);
    if (mob.armor) landItem(ctx, mob.pos, mob.armor);
    // FetidRat.die: its skull, for the sad ghost.
    if (mob.kind === 'fetidRat') dropItem(ctx.floor, mob.pos, createItem('quest.skull'));
    for (const item of mob.loot ?? []) landItem(ctx, mob.pos, item);
    delete mob.item;
    delete mob.loot;
    // Mob.rollToDropLoot (mobs.ts); the bosses' own.
    rollToDropLoot(ctx, mob);
    bossLoot(ctx, mob);
  }

  // Skeleton.die: not when it fell.
  if (baseKind(mob.kind) === 'skeleton' && !mob.fell) explode(ctx, mob);
  // Necromancer.die: its skeleton (its wraiths) with it; a ghoul's fallen partner may lose its host.
  if (baseKind(mob.kind) === 'necromancer') minionsDie(ctx, mob);
  if (mob.kind === 'ghoul') hostGone(ctx, mob);
  // ChampionEnemy.Blazing.detach: fire all round as it dies (not when it falls into a chasm), but not on water.
  if (mob.champion === 'blazing' && !mob.fell) {
    for (const n of NEIGHBOURS9) {
      const cell = mob.pos + n;
      if (!hasFlag(ctx.level.map[cell]!, F.SOLID) && !isWater(ctx.level.map[cell]!)) burst(ctx, cell, 'fire', 0, true);
    }
  }
  // DemonSpawner.die: the demonic energy here lessens.
  if (mob.kind === 'spawner') ctx.effects.push({ type: 'mobSays', depth: ctx.depth, mob: mob.id, line: 'spawnerDied' });

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
    if (level.map[level.entrance] === T.WATER_TILES) level.map[level.entrance] = T.ENTRANCE;
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

/** Bestiary.countEncounter: one more of a kind slain (and so seen). */
export function countSlain(world: World, kind: MobKind): void {
  const entry = ((world.bestiary ??= {})[kind] ??= { seen: true, slain: 0 });
  entry.seen = true;
  entry.slain++;
}

/** The bosses' loot, as Pixel Dungeon had it until the bosses stream: Goo's beacon, DM-300's ring of thorns. */
function bossLoot(ctx: Ctx, mob: Mob): void {
  const { rng } = ctx;
  if (!heroesOn(ctx.world, ctx.depth).some((hero) => hero.lvl <= mobStats(mob).maxLvl + 2)) return;
  if (mob.kind === 'goo' && rng.float() < 0.333) landItem(ctx, mob.pos, createItem('beacon'));
  if (mob.kind === 'dm300' && rng.float() < 0.333) landItem(ctx, mob.pos, randomRing(rng, 'ring.thorns'));
}

/**
 * Skeleton.die: its bones fly apart, 6-12 to everyone around — armour twice as good against them (two rolls).
 */
function explode(ctx: Ctx, skeleton: Mob): void {
  ctx.effects.push({ type: 'bones', depth: ctx.depth, pos: skeleton.pos });
  for (const n of NEIGHBOURS8) {
    const victim = charAt(ctx.world, ctx.depth, skeleton.pos + n);
    if (!victim || !isAlive(victim)) continue;
    let damage = ctx.rng.normalIntRange(6, 12);
    damage = Math.max(0, damage - (armorRoll(ctx, victim) + armorRoll(ctx, victim)));
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
