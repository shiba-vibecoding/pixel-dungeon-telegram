import { familiarise, identifyBelongings } from './ident';
import { bossHurt, earnExp } from './hero';
import { shieldDamage } from './seal';
import {
  baseKind, BRUTE_ENRAGED_DAMAGE, isShopkeeper, statsOf, createMob, type Hero, heroArmor, heroAttackSkill, heroDamageRoll, heroDefenseSkill,
  heroDrRoll, heroRings, heroStr, isAlive, type Mob, MOBS, mobStats, ringBonus, strikeStr,
} from './actors';
import {
  charAt, type Char, type Ctx, dropItem, enterCell, freeCellNear, heroesOn, isHero, isPassable, isWater, landItem, leaveCell,
  observe,
} from './floor';
import { createItem, type Item, itemDef, ItemGenerator, randomRing, rollGold, wandMaxCharges } from './items';
import { damageTaken, rollFactor } from './status';
import { rockArmorAbsorbs, staffBlow } from './wands';
import { guardianArmor, wardArmor } from './allies';
import { isChallenged, NO_ARMOR } from './challenges';
import { adjacent, NEIGHBOURS4, NEIGHBOURS8 } from './level/geometry';
import {
  armorProc, type Blow, corruptSlain, deferDamage, gearSoaks, isEnemy, luckyDrop, procMultiplier, TERROR_TURNS, weaponProc,
} from './enchant';
import { missileProc } from './throwing';
import { earthrootAbsorbs } from './plants';
import { impQuestKill } from './imp';
import { curseBroken, questKill } from './quest';
import { seedGas } from './gas';
import { looseItems } from './bags';
import { sacrifice } from './altar';
import { F, hasFlag, T } from './level/terrain';
import { mobPress } from './traps';
import { isBossDepth } from './level/builder';
import { arenaKill } from './arena';
import { challengeFactor, chillChar, igniteChar, isMagicImmune, onHurt } from './buffs';
import { elementsResist, tenacityMultiplier, wealthBonusDrops, wealthDropMultiplier } from './rings';
import { bossSlainBeacon, capeTakes, chargeArtifacts, dispelInvisibility, ghostDied, ghostSeesHero } from './artifacts';
import { onAttackProc, onDefenseProc, ironStomachFactor, onMobKilled, bountyBonus } from './talents/combat';
import { berserkAbsorbs, berserkDamageFactor, deathlessEnded, deathlessFury } from './talents/berserk';
import { comboHit, parries, riposte } from './talents/combo';
import { canKO, prepLevel, prepTurns, preparedDamage, prepBonus } from './talents/rogue';
import { markTarget, specialDamage } from './talents/huntress';
import { onSoulMarkedDied, soulMarkRestoration } from './talents/warlock';
import { pointsInTalent } from './talents/data';
import { staffProc, staffProcDone } from './talents/magic';
import { tbOf } from './talents/state';

/*
 * Melee combat as in Char.attack: an accuracy roll against an evasion roll,
 * then damage minus a roll of the defender's armour.
 */

function attackSkill(char: Char, target: Char, weapon?: Item | null): number {
  return isHero(char) ? heroAttackSkill(char, target.pos, weapon === undefined ? char.weapon : weapon) : mobStats(char).attack;
}

/** Char.defenseSkill, as a monster's ranged attack (or anyone's) is weighed against it. */
export function defenseOf(char: Char): number {
  return defenseSkill(char);
}

function defenseSkill(char: Char): number {
  if (isHero(char)) return heroDefenseSkill(char);
  // A monster that has not spotted its enemy is caught off guard.
  return char.enemySeen ? mobStats(char).defense : 0;
}

export function charArmor(char: Char): number {
  return isHero(char) ? heroArmor(char) : mobStats(char).dr;
}

/**
 * Char.drRoll: how much of a blow armour takes — a hero's armour (Hero.drRoll), a monster's 0 to its armour, the earth
 * guardian's and a sentry's their own way.
 */
export function drRoll(ctx: Ctx, char: Char): number {
  if (!isHero(char) && char.kind === 'guardian') return guardianArmor(ctx, char, isChallenged(ctx.world, NO_ARMOR));
  if (!isHero(char) && char.kind === 'ward') return wardArmor(ctx, char);
  return isHero(char) ? heroDrRoll(char, ctx.rng) : ctx.rng.intRange(0, mobStats(char).dr);
}

function damageRoll(ctx: Ctx, char: Char, range?: readonly [number, number]): number {
  if (range) return ctx.rng.normalIntRange(range[0], range[1]);
  const [min, max] = !isHero(char) && baseKind(char.kind) === 'brute' && char.enraged ? BRUTE_ENRAGED_DAMAGE : mobStats(char as Mob).damage;
  return ctx.rng.normalIntRange(min, max);
}

/** Changes to an attacker's usual numbers, e.g. a pumped-up Goo. */
export interface AttackOverride {
  attack?: number;
  damage?: readonly [number, number];
  /**
   * What a hero strikes with instead of the weapon in hand (Belongings.thrownWeapon): a thrown weapon, or the spirit
   * bow for its arrow. Its numbers, its enchantment and its own effect make the shot.
   */
  weapon?: Item;
  /** Char.attack's accuracy of INFINITE_ACCURACY (a combo move, a sniper shot): the blow cannot miss (but may be dodged for sure). */
  sure?: boolean;
  /** Char.attack's dmgMulti and dmgBonus (a combo move's). */
  damageMultiplier?: number;
  damageBonus?: number;
  /** A combo move's own blow: it does not build the combo (Combo.doAttack calls Char.attack, not Hero.onAttackComplete). */
  move?: boolean;
}

/**
 * Hero.canSurpriseAttack: not with a weapon too heavy for them, nor with a flail. A surprised monster (Mob.surprisedBy:
 * the hero unseen by it, or invisible) cannot dodge, and some weapons hit it harder.
 */
export function surprises(hero: Hero, mob: Mob, weapon: Item | null): boolean {
  if (weapon && (weapon.kind === 'weapon.flail' || heroStr(hero) < strikeStr(hero, weapon))) return false;
  return hero.invisible > 0 || !mob.enemySeen;
}

/** Bosses resist a grim blow (Char.Property.BOSS resistances). */
const GRIM_RESISTANT: ReadonlySet<string> = new Set(['goo', 'tengu', 'dm300', 'king']);

/**
 * One blow or shot; returns whether it hit (Char.attack): accuracy against evasion; then the defender's armour is
 * rolled, the damage rolled; the defender's armour glyph acts on it (defenseProc), the armour soaks its roll, the
 * attacker's weapon acts on what is left (attackProc), and that is dealt (Char.damage, where a vorpal, grim, kinetic
 * or corrupting blow does what it does).
 */
export function attack(ctx: Ctx, attacker: Char, defender: Char, override: AttackOverride = {}): boolean {
  const strike = isHero(attacker) ? (override.weapon ?? attacker.weapon) : null;
  const thrown = isHero(attacker) && override.weapon !== undefined;
  const surprised = isHero(attacker) && !isHero(defender) && surprises(attacker, defender, strike);
  const struck = { ...(strike ? { weapon: strike.kind } : {}), ...(surprised ? { surprise: true } : {}) };
  // Char.hit: an invisible hero who can surprise never misses.
  const sure = isHero(attacker) && attacker.invisible > 0 && (isHero(defender) || surprised);
  // Preparation: the assassin's strike is as strong as the turns spent unseen (read before striking gives them away).
  const turnsUnseen = isHero(attacker) ? prepTurns(attacker) : undefined;
  const prep = turnsUnseen !== undefined ? prepLevel(turnsUnseen) : undefined;
  // Striking gives an invisible hero away (Invisibility.dispel: the cloak's stealth and a time freeze too), but not
  // before it has its surprise.
  if (isHero(attacker)) dispelInvisibility(ctx, attacker);
  const skill = override.attack ?? attackSkill(attacker, defender, strike);
  // Char.hit: a hex makes the roll a fifth worse, a blessing a quarter better.
  // Hero.defenseSkill with a parry: infinite evasion, and the blow is answered.
  const parried = isHero(defender) && !isHero(attacker) && parries(ctx, defender);
  const hit = parried ? false
    : sure || override.sure || ctx.rng.floatMax(skill) * rollFactor(attacker) >= ctx.rng.floatMax(defenseSkill(defender)) * rollFactor(defender);
  if (!hit) {
    ctx.effects.push({ type: 'attack', depth: ctx.depth, attacker: attacker.id, target: defender.id, hit, damage: 0, ...struck });
    if (parried) riposte(ctx, defender as Hero, attacker as Mob);
    return false;
  }
  // A sniper's thrown weapons find the weak points in any armour, from afar.
  const sniping = isHero(attacker) && attacker.subclass === 'sniper' && thrown && !adjacent(attacker.pos, defender.pos);
  const reduction = sniping ? 0 : drRoll(ctx, defender);
  let damage = isHero(attacker) && override.damage === undefined
    ? prep !== undefined ? preparedDamage(attacker, ctx.rng, prep, strike, surprised) : heroDamageRoll(attacker, ctx.rng, surprised, strike)
    : damageRoll(ctx, attacker, override.damage);
  if (override.damageMultiplier !== undefined || override.damageBonus !== undefined) {
    damage = Math.round(damage * (override.damageMultiplier ?? 1) + (override.damageBonus ?? 0));
  }
  if (isHero(attacker)) {
    // Berserk.damageFactor (rage), and the bow's special shot (SpiritBow.damageRoll with sniperSpecial).
    damage = Math.round(berserkDamageFactor(attacker, damage));
    if (strike && itemDef(strike.kind).category === 'bow') damage = specialDamage(attacker, damage);
    if (prep !== undefined && pointsInTalent(attacker, 'bounty_hunter') > 0) Object.assign(tbOf(attacker), { bounty: true, prepLevel: prep });
  }
  // Weakness (the wand of corruption's): a weakened monster strikes two thirds as hard.
  if (!isHero(attacker) && (attacker.weakened ?? 0) > 0) damage = Math.round(damage * 0.67);
  // Hero.defenseProc: earthen armour takes half the blow, before the armour worn.
  if (isHero(defender)) damage = rockArmorAbsorbs(defender, damage);
  // Mob.defenseProc: a soul-marked monster struck by a hero gives some of it back as health.
  if (!isHero(defender) && (defender.soulMarked ?? 0) > 0) soulSiphon(ctx, attacker, defender, damage);
  const blow: Blow = {};
  // Hero.defenseProc: the berserker's rage builds on the blow, armour or no armour.
  if (isHero(defender) && !isHero(attacker)) onDefenseProc(defender, damage);
  // Hero.defenseProc: an inscribed armour's answer, before the armour soaks the blow.
  if (isHero(defender) && !isHero(attacker)) {
    const mark = ctx.effects.length;
    damage = armorProc(ctx, attacker, defender, damage, blow);
    // The glyph's backlash may have felled its wearer, or an ankh raised them anew: the blow is spent.
    if (!isAlive(defender) || ctx.effects.slice(mark).some((e) => e.type === 'resurrected')) return true;
  }
  damage = Math.max(damage - reduction, 0);
  // Vulnerable: a third more, after the armour.
  if ((defender.vulnerable ?? 0) > 0) damage = Math.round(damage * 1.33);
  // Viscosity: some of what gets past the armour is put off.
  if (isHero(defender) && blow.viscosity !== undefined) damage = deferDamage(ctx, defender, damage, blow.viscosity);
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
      if (baseKind(attacker.kind) === 'monk' && ctx.rng.int(6) === 0 && defender.weapon && defender.weapon.kind !== 'weapon.gloves' && !defender.weapon.cursed) {
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
    // Undead.attackProc: now and then a blow stuns.
    if (attacker.kind === 'undead' && ctx.rng.int(5) === 0) defender.paralysed = Math.max(defender.paralysed ?? 0, 1);
    // Spinner.attackProc: half its bites are venomous, and then it backs off.
    if (attacker.kind === 'spinner' && ctx.rng.int(2) === 0) {
      defender.poison = Math.max(defender.poison ?? 0, ctx.rng.intBetween(7, 9));
      attacker.state = 'fleeing';
      attacker.target = defender.pos;
    }
  }
  // Hero.attackProc: a thrown weapon's own effect, then the weapon's enchantment (Weapon.proc).
  let staffAfter: (() => void) | undefined;
  if (isHero(attacker) && !isHero(defender)) {
    // Hero.attackProc: Talent.onAttackProc first (provoked anger, lingering magic, sucker punch, follow-up strike).
    damage = onAttackProc(ctx, attacker, defender, damage, strike, thrown);
    // MagesStaff.proc: a battlemage's staff does what its wand does on a hit, before its enchantment.
    if (!thrown && attacker.weapon?.kind === 'weapon.magesStaff') {
      // MagesStaff.proc: mystical charge feeds the artifacts, empowered strike hits harder (and makes the wand's effect likelier).
      damage = staffProc(attacker, damage, (amount) => chargeArtifacts(ctx, attacker, amount));
      staffAfter = staffBlow(ctx, attacker, attacker.weapon, defender, damage);
      staffProcDone(attacker);
    }
    if (thrown) damage = missileProc(ctx, attacker, defender, damage, override.weapon!);
    // (No enchantment works while magic will not: MagicImmune.)
    if (damage >= 0 && isAlive(defender) && !isMagicImmune(attacker)) damage = weaponProc(ctx, attacker, defender, damage, strike, blow);
    // FireImbue.proc and FrostImbue.proc: half the blows set the foe alight; every one chills it.
    if (isAlive(defender) && (attacker.buffs?.fireImbue ?? 0) > 0 && ctx.rng.int(2) === 0) igniteChar(ctx, defender);
    if (isAlive(defender) && (attacker.buffs?.frostImbue ?? 0) > 0) chillChar(defender, 3);
    // Weapon.proc: every blow that lands makes the weapon in hand better known (a thrown one, see throwing.ts).
    if (!thrown && attacker.weapon) familiarise(ctx, attacker, attacker.weapon);
    damage = Math.max(0, damage);
    if (!isAlive(defender)) return true;
  }
  // Armor.proc: and every blow taken makes the armour better known.
  if (isHero(defender) && !isHero(attacker)) familiarise(ctx, defender, defender.armor);
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
  // EarthGuardian.attackProc: the monster it strikes turns on it.
  if (!isHero(attacker) && attacker.kind === 'guardian' && !isHero(defender) && isAlive(defender)) {
    defender.enemy = attacker.id;
    if (defender.state !== 'passive') defender.state = 'hunting';
  }
  // Yog.defenseProc: struck, Yog-Dzewa spawns a larva next to it.
  if (!isHero(defender) && defender.kind === 'yog') spawnLarva(ctx, defender);
  // Char.damage, as a vorpal blow has it: unless it kills, it is dealt as bleeding instead.
  if (blow.vorpal !== undefined && !isHero(defender) && damage <= defender.hp) {
    const bleed = Math.round(blow.vorpal * (2 + damage / 2));
    defender.bleeding = Math.max(defender.bleeding ?? 0, bleed);
    ctx.effects.push({ type: 'attack', depth: ctx.depth, attacker: attacker.id, target: defender.id, hit, damage: 0, ...struck });
    ctx.effects.push({ type: 'enchanted', depth: ctx.depth, pos: defender.pos, enchant: 'vorpal' });
    return true;
  }
  const before = defender.hp;
  const wasEnemy = isHero(attacker) && !isHero(defender) && isEnemy(defender);
  ctx.effects.push({ type: 'attack', depth: ctx.depth, attacker: attacker.id, target: defender.id, hit, damage, ...struck });
  hurt(ctx, defender, damage, attacker);
  staffAfter?.();
  if (isHero(attacker) && !isHero(defender)) {
    afterBlow(ctx, attacker, defender, damage, before, blow);
    afterHeroBlow(ctx, attacker, defender, wasEnemy, thrown, strike, prep, override.move === true);
  }
  // Pickaxe.proc: a vampire bat slain with the pickaxe leaves its blood on it, as the blacksmith wants.
  if (isHero(attacker) && attacker.weapon?.kind === 'weapon.pickaxe' && !thrown && !isHero(defender) && defender.kind === 'bat' && !isAlive(defender)) {
    attacker.weapon.bloody = true;
  }
  return true;
}

/**
 * What follows a hero's blow: the gladiator's combo builds (Hero.onAttackComplete and shoot), the sniper's thrown weapon
 * marks its target (Hero.attackProc), a prepared strike executes what it left weak (Char.attack, Preparation.canKO).
 */
function afterHeroBlow(ctx: Ctx, hero: Hero, mob: Mob, wasEnemy: boolean, thrown: boolean, strike: Item | null, prep: number | undefined, isMove: boolean): void {
  if (!isMove && wasEnemy && hero.subclass === 'gladiator') comboHit(ctx, hero, mob);
  if (thrown && strike && itemDef(strike.kind).category === 'missile') markTarget(hero, mob, strike);
  if (prep !== undefined && isAlive(mob) && !mob.ally && canKO(hero, prep, mob)) {
    // enemy.HP = 0: whatever shield there was does not help.
    delete mob.shield;
    ctx.effects.push({ type: 'assassinated', depth: ctx.depth, mob: mob.id });
    ctx.effects.push({ type: 'hurt', depth: ctx.depth, who: mob.id, damage: mob.hp });
    hurt(ctx, mob, mob.hp, hero);
  }
}

/**
 * Char.damage's trackers: a grim blow may finish off what it left alive, the lower its health the likelier; a
 * kinetic one keeps what it overkilled for the next; a corrupting one raises what it slew on the hero's side.
 */
function afterBlow(ctx: Ctx, hero: Hero, mob: Mob, damage: number, before: number, blow: Blow): void {
  if (blow.grim !== undefined && isAlive(mob)) {
    const finalChance = blow.grim * ((mob.ht - mob.hp) / mob.ht) ** 2;
    if (ctx.rng.float() < finalChance) {
      const extra = Math.round(mob.hp * (GRIM_RESISTANT.has(mob.kind) ? 0.5 : 1));
      ctx.effects.push({ type: 'enchanted', depth: ctx.depth, pos: mob.pos, enchant: 'grim' });
      ctx.effects.push({ type: 'hurt', depth: ctx.depth, who: mob.id, damage: extra });
      hurt(ctx, mob, extra, hero);
    }
  }
  if (blow.kinetic !== undefined) {
    const add = damage > before && !mob.corrupted ? Math.round((damage - before - blow.kinetic) * procMultiplier(hero)) : 0;
    if (add > 0) hero.kinetic = add;
    else delete hero.kinetic;
  }
  if (blow.corrupting !== undefined && !isAlive(mob)) corruptSlain(ctx, mob, blow.corrupting);
}

/** What a ring of elements can shield a hero from (RingOfElements.Resistance.FULL). */
const ELEMENTAL: ReadonlySet<string> = new Set(['poison', 'burning', 'ooze', 'lightning', 'gas', 'shaman', 'warlock', 'eye', 'burningFist']);

/** Shopkeeper.flee: attacked (or caught stealing), he vanishes, and his wares with him. */
export function shopkeeperFlees(ctx: Ctx, keeper: Mob): void {
  ctx.floor.heaps = ctx.floor.heaps.filter((heap) => heap.kind !== 'forSale');
  ctx.floor.mobs.splice(ctx.floor.mobs.indexOf(keeper), 1);
  leaveCell(ctx.world, ctx.level, ctx.depth, keeper.pos);
  ctx.effects.push({ type: 'shopkeeperFled', depth: ctx.depth, mob: keeper.id, pos: keeper.pos });
}

/**
 * Mob.defenseProc under a soul mark (a warlock's): the hero's blow gives back four tenths of what it takes (as much as the
 * monster has to lose) as health, and feeds the hero (soul eater); an ally's blow only with soul siphon, less of it.
 */
function soulSiphon(ctx: Ctx, attacker: Char, mob: Mob, damage: number): void {
  const hero = ctx.world.heroes.find((h) => h.depth === ctx.depth && isAlive(h));
  if (!hero) return;
  let restoration = Math.min(damage, mob.hp + (mob.shield ?? 0));
  // Physical damage that does not come from the hero is less effective.
  if (!isHero(attacker)) restoration = Math.round(restoration * 0.4 * pointsInTalent(hero, 'soul_siphon') / 3);
  soulMarkRestoration(ctx, hero, restoration);
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
export type Hazard =
  | 'poison' | 'burning' | 'ooze' | 'lightning' | 'gripping' | 'hunger' | 'bones' | 'gas' | 'fall' | 'deferred' | 'bleeding' | 'dry'
  | 'berserk' | 'multiplicity' | 'bomb' | 'chill' | 'magic' | 'holy' | 'chalice' | 'noRose'
  /** Shattered's wands: a wand's own harm to the hero, corrosion, corruption wasting an ally away, a knock against a wall. */
  | 'wand' | 'corrosion' | 'corruption' | 'knockback'
  /** Alchemy's: electricity, an aqua brew's geyser, the psionic blast, the special bombs. */
  | 'electricity' | 'geyser' | 'psionic' | 'arcaneBomb' | 'flashbang' | 'holy' | 'shrapnel';

export function hurt(ctx: Ctx, victim: Char, damage: number, source: Char | Hazard): void {
  if (!isAlive(victim)) return;
  // Hero.damage: in the hourglass's stasis nothing can touch the hero.
  if (isHero(victim) && (victim.stasis ?? 0) > 0) return;
  // The sad ghost cannot be harmed; the shopkeeper will not stay to be.
  if (!isHero(victim) && victim.state === 'passive' && victim.kind !== 'bee' && !victim.corrupted) {
    if (isShopkeeper(victim)) shopkeeperFlees(ctx, victim);
    return;
  }
  const by = typeof source === 'string' ? null : source;
  // WandOfRegrowth.Lotus.damage: nothing harms it.
  if (!isHero(victim) && victim.kind === 'lotus') return;
  if (!isHero(victim)) {
    if (victim.state === 'sleeping') victim.state = 'wandering';
    victim.alerted = true;
    // In a party, a monster turns on whoever hurt it (an ally does not turn on the heroes).
    if (by && isHero(by) && !victim.ally) victim.enemy = by.id;
    // Terror.recover: struck again, a frightened monster pulls itself together.
    if ((victim.terror ?? 0) > 0 && victim.terror! < TERROR_TURNS) victim.terror = 0;
  }
  // Char.damage with RingOfElements.resist: the elements (fire, poison, ooze, lightning, gas, magic) do less.
  if (isHero(victim)) {
    const what = typeof source === 'string' ? source : isHero(source) ? '' : source.kind;
    if (ELEMENTAL.has(what)) damage = Math.round(damage * elementsResist(victim));
  }
  // Earthroot's bark takes the blows first; then armour of anti-magic soaks magic, and a blocking weapon's shield.
  if (isHero(victim)) damage = earthrootAbsorbs(victim, damage);
  if (isHero(victim)) damage = gearSoaks(ctx, victim, damage, source);
  // ScrollOfChallenge.ChallengeArena: two thirds of the harm inside it.
  if (isHero(victim)) damage = Math.round(damage * challengeFactor(victim));
  // Hero.damage: the cape of thorns takes its share of whatever hurts the hero; rings of tenacity ease the rest,
  // the more the hero is hurt (RingOfTenacity.damageMultiplier, rounded up).
  if (isHero(victim) && damage > 0) damage = capeTakes(ctx, victim, damage, typeof source === 'string' ? null : source);
  if (isHero(victim) && damage > 0) damage = Math.round(ironStomachFactor(ctx, victim, damage));
  if (isHero(victim) && damage > 0) damage = Math.ceil(damage * tenacityMultiplier(victim));
  // Char.damage: invulnerability, frost, charm, doom and shields (status.ts).
  damage = damageTaken(ctx, victim, damage, by);
  // Char.damage: the warrior's seal may raise its shield, and shields take what they can (not hunger's).
  if (isHero(victim)) damage = shieldDamage(ctx, victim, damage, source === 'hunger');
  // Berserk's shield is the last to give way (shieldUsePriority -1).
  if (isHero(victim)) damage = berserkAbsorbs(victim, damage);
  onHurt(victim);
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
  if (isHero(victim)) {
    // Berserk.berserking at zero health: deathless fury keeps the hero up on a single point; the shield spent, they fall.
    if (victim.hp <= 0 && deathlessFury(ctx, victim)) victim.hp = 1;
    else if (isAlive(victim) && deathlessEnded(victim)) victim.hp = 0;
  }
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
  const killer = by ? ctx.world.heroes.find((h) => h.id === by) : undefined;
  // Mob.die: a kill by the hero may free the next act (lethal momentum).
  if (killer) onMobKilled(ctx, killer, mob);
  mob.hp = 0;
  ctx.floor.mobs.splice(ctx.floor.mobs.indexOf(mob), 1);
  leaveCell(ctx.world, ctx.level, ctx.depth, mob.pos);
  ctx.effects.push({ type: 'died', depth: ctx.depth, who: mob.id, pos: mob.pos, kind: mob.kind, ...(by ? { by } : {}) });
  // The curse, broken, is the ghost again: nothing to learn from it, nothing left behind.
  if (mob.kind === 'curse') {
    curseBroken(ctx, mob);
    return;
  }
  // GhostHero.die: the rose's ghost bids farewell, and its rose empties.
  if (mob.kind === 'ghostHero') {
    ghostDied(ctx, mob);
    return;
  }
  sacrifice(ctx, mob);
  arenaKill(ctx, mob);
  // Mob.die: a soul-marked foe's death feeds the warlock (soul eater), and may raise a minion (necromancer's minions).
  if ((mob.soulMarked ?? 0) > 0) onSoulMarkedDied(ctx, mob);

  // Mob.die: an ally (a ward, the guardian, a corrupted monster) leaves nothing and teaches nothing:
  // what a corrupted monster had to give, it gave when it was corrupted.
  if (!mob.ally) {
    // Everyone fighting on the depth learns from the kill, not just the killer.
    const stats = mobStats(mob);
    for (const hero of heroesOn(ctx.world, ctx.depth)) {
      // Mob.die: only a monster worth something teaches anything.
      if (stats.exp > 0 && hero.lvl <= stats.maxLvl) earnExp(ctx, hero, stats.exp);
    }
  }

  questKill(ctx, mob);
  impQuestKill(ctx, mob);

  // Mob.rollToDropLoot (not for an ally): a thief's goods, the fetid rat's skull, a mimic's treasure, the loot;
  // then a lucky blow's prize (Lucky.LuckProc); then the thrown weapons stuck in it fall (PinCushion).
  if (!mob.ally) dropRemains(ctx, mob);
  if (mob.luck !== undefined) {
    landItem(ctx, mob.pos, luckyDrop(ctx, mob.luck));
    ctx.effects.push({ type: 'lucky', depth: ctx.depth, pos: mob.pos });
  }
  for (const item of mob.pinned ?? []) landItem(ctx, mob.pos, item);

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
    // Tengu, DM-300 and the King: a beacon carried grows stronger.
    if (mob.kind === 'tengu' || mob.kind === 'dm300' || mob.kind === 'king') bossSlainBeacon(ctx);
    // Tengu.die: a Tome of Mastery, here one for every hero who has not mastered yet.
    if (mob.kind === 'tengu') {
      for (const hero of ctx.world.heroes) if (!hero.subclass) dropItem(ctx.floor, mob.pos, createItem('mask.tengu'));
    }
  }
}

/**
 * Mob.rollToDropLoot: a thief's stolen goods fall where it dies, and a mimic's treasure (Level.drop: as
 * the challenges allow; a flier slain over a chasm drops them through it), and its own loot, unless the
 * party has outgrown the monster or the armband has robbed it already.
 */
function dropRemains(ctx: Ctx, mob: Mob): void {
  const stats = mobStats(mob);
  if (mob.item) landItem(ctx, mob.pos, mob.item);
  delete mob.item;
  // FetidRat.die: its skull, for the sad ghost.
  if (mob.kind === 'fetidRat') dropItem(ctx.floor, mob.pos, createItem('quest.skull'));
  for (const item of mob.loot ?? []) landItem(ctx, mob.pos, item);
  delete mob.loot;
  const heroes = heroesOn(ctx.world, ctx.depth);
  if (heroes.some((h) => h.lvl <= stats.maxLvl + 2) && mob.robbed !== 'stolen') {
    const loot = lootOf(ctx, mob);
    // Mob.lootChance: rings of wealth make it likelier (RingOfWealth.dropChanceMultiplier).
    const wearer = heroes[0];
    // Mob.lootChance: bounty hunter adds to it after a prepared strike (RingOfWealth.dropChanceMultiplier + the bonus).
    const chance = loot.chance * ((wearer ? wealthDropMultiplier(wearer) : 1) + (wearer ? bountyBonus(wearer) : 0));
    const item = ctx.rng.float() < chance ? loot.make() : null;
    if (item) landItem(ctx, mob.pos, item);
    // RingOfWealth.tryForBonusDrop: a try for every monster, fifteen for a boss.
    if (wearer) {
      const boss = ['goo', 'tengu', 'dm300', 'king', 'yog'].includes(mob.kind);
      for (const bonus of wealthBonusDrops(ctx, wearer, boss ? 15 : 1)) landItem(ctx, mob.pos, bonus);
    }
  }
}

/**
 * AllyBuff.affectAndLoot: a monster won over (corrupted) gives up at once what it would have left and
 * taught on dying, to the hero who won it over.
 */
export function lootAndExp(ctx: Ctx, mob: Mob, hero: Hero): void {
  dropRemains(ctx, mob);
  hero.kills++;
  const stats = mobStats(mob);
  if (stats.exp > 0 && hero.lvl <= stats.maxLvl) earnExp(ctx, hero, stats.exp);
}

/**
 * What a monster may leave behind: the chance (Mob.lootChance) and what it is (Mob.createLoot), which
 * the master thieves' armband can steal as well. A null loot is nothing after all.
 */
export function lootOf(ctx: Ctx, mob: Mob): { chance: number; make: () => Item | null } {
  const { rng } = ctx;
  const generator = (): ItemGenerator => new ItemGenerator(rng, ctx.depth, { run: ctx.world.run });
  const loot = (chance: number, make: () => Item | null): { chance: number; make: () => Item | null } => ({ chance, make });
  switch (baseKind(mob.kind)) {
    case 'gnoll':
      return loot(0.5, () => rollGold(rng, ctx.depth));
    case 'crab':
      return loot(CRAB_MEAT_CHANCE, () => createItem('food.meat'));
    case 'skeleton':
      // The worst of three weapons, one time in five.
      return loot(0.2, () => {
        let worst = generator().of('weapon');
        for (let i = 0; i < 2; i++) {
          const other = generator().of('weapon');
          if (other.level < worst.level) worst = other;
        }
        return worst;
      });
    case 'swarm':
      return loot(1 / (5 * ((mob.generation ?? 0) + 1)), () => createItem('potion.healing'));
    case 'shaman':
      return loot(0.33, () => generator().of('scroll'));
    case 'bat':
      return loot(0.125, () => createItem('potion.healing'));
    case 'brute':
      return loot(0.5, () => rollGold(rng, ctx.depth));
    case 'thief':
      // Thief: now and then a ring or an artifact (Random.oneOf(RING, ARTIFACT), lootChance 0.03).
      return loot(0.03, () => (rng.int(2) === 0 ? generator().of('ring') : generator().of('artifact')));
    case 'dm300':
      // Shattered's DM-300 once left the cape of thorns, known through and through, where the original's left a ring of thorns.
      return loot(0.333, () => createItem('artifact.cape'));
    case 'goo':
      return loot(0.333, () => createItem('artifact.beacon'));
    case 'spinner':
      return loot(0.125, () => createItem('food.meat'));
    case 'elemental':
      return loot(0.1, () => createItem('potion.liquidFlame'));
    case 'monk':
      return loot(0.083, () => createItem('food.ration'));
    case 'warlock':
      return loot(0.83, () => generator().of('potion'));
    case 'succubus':
      return loot(0.05, () => createItem('scroll.lullaby'));
    case 'eye':
      return loot(0.5, () => createItem('dew'));
    case 'scorpio':
      return loot(1, () => (rng.int(8) === 0 ? createItem('potion.healing') : rng.int(6) === 0 ? createItem('food.meat') : null));
    default:
      return loot(0, () => null);
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

/** Hero.die from something that is not a blow (a deathless berserk running out of shield): the hero falls. */
export function killHero(ctx: Ctx, hero: Hero, cause: Hazard): void {
  hero.hp = 0;
  hero.killedBy = cause;
  heroDied(ctx, hero);
}

function heroDied(ctx: Ctx, hero: Hero): void {
  if (hero.items.some((item) => item.kind === 'ankh')) {
    resurrect(ctx, hero);
    ghostSeesHero(ctx, hero, 'blessed_ankh');
    return;
  }
  ghostSeesHero(ctx, hero, 'player_killed');
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
