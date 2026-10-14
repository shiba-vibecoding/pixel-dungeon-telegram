import { scoreGhostHit } from './score';
import { familiarise, identifyBelongings } from './ident';
import { earnExp } from './hero';
import { bossAfterDamage, bossBeforeDamage, bossDied, bossHoldsOn, bossRules } from './bosses/index';
import { shieldDamage } from './seal';
import {
  baseKind, BRUTE_ENRAGED_DAMAGE, isShopkeeper, statsOf, createMob, type Hero, heroArmor, heroAttackSkill, heroDamageRoll, heroDefenseSkill,
  heroDrRoll, heroRings, heroStr, isAlive, type Mob, type MobKind, MOBS, mobStats, ringBonus, strikeStr,
} from './actors';
import {
  charAt, type Char, type Ctx, dropItem, enterCell, freeCellNear, heroesOn, isHero, isPassable, isWater, landItem, leaveCell,
  observe,
} from './floor';
import { createItem, type Item, itemDef, wandMaxCharges } from './items';
import { damageTaken, rollFactor } from './status';
import { rockArmorAbsorbs, staffBlow } from './wands';
import { guardianArmor, wardArmor } from './allies';
import { isChallenged, NO_ARMOR } from './challenges';
import { adjacent, NEIGHBOURS4, NEIGHBOURS8, NEIGHBOURS9, WIDTH } from './level/geometry';
import { armorDrMax, armorDrMin } from './armor';
import {
  armorProc, bleedImmune, type Blow, corruptSlain, deferDamage, gearSoaks, luckyDrop, procMultiplier, TERROR_TURNS, weaponProc,
} from './enchant';
import { missileProc } from './throwing';
import { gainEnergy } from './classes/monk';
import { afterImageStruck, duelFoeDied, noteDuelDamage } from './classes/duelist-armor';
import { clericHurt, clericShields, lightShield } from './classes/cleric-hooks';
import { classArmorProc, classDamageTaken, classWeaponProc, heroBlow, heroEvasion, markHarvest, meleeStrike } from './classes/hooks';
import { earthrootAbsorbs } from './plants';
import { ghostFoeSlain } from './quest';
import { mineAttackProc, mineBeforeAttack, mineDamage, mineDefense, mineMobDied } from './minemobs';
import { burnsAway, lasherCripples, rotHeartStruck, wandmakerAttack, wandmakerMobDied } from './wandmaker-mobs';
import { sacrifice } from './altar';
import { F, hasFlag, T } from './level/terrain';
import { burst, mobPress } from './traps';
import { isBossDepth } from './level/builder';
import { arenaKill } from './arena';
import { championAttackProc, championDamage, evasionAndAccuracyFactor, meleeDamageFactor } from './champions';
import { baseLootChance, createLoot, dropExtras, isEnemy, lootChanceMultiplier } from './mobs';
import {
  afterDamage, cheatDeath, crystalBite, hostGone, INFINITE_ACCURACY, INFINITE_EVASION, minionsDie, mobAttackProc, mobDamage,
  mobDamageRange, mobDefenseProc, mobDefenseSkill, parried, potDropped, reveal, steal,
} from './mobskills';
import type { World } from './world';
import { challengeFactor, chillChar, igniteChar, isMagicImmune, onHurt } from './buffs';
import { elementsResist, tenacityMultiplier, wealthBonusDrops } from './rings';
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
import {
  allyArmor, allyOwner, bladeBowProc, cloneGlyph, endDeathMark, endureAdjust, endureStrike, fearTheReaper, hawkDodges, hawkProc, natureArrowProc,
} from './abilities';

/*
 * Combat as in Char.attack: an accuracy roll against an evasion roll (Char.hit:
 * hexed a fifth worse, a champion's own factor), then the blow — a champion's
 * stronger, a weakened one two thirds as hard — through the defender's
 * defenseProc, less a roll of its armour, a third more if it is vulnerable,
 * then the attacker's attackProc, and the harm.
 */

function attackSkill(ctx: Ctx, char: Char, target: Char, weapon?: Item | null): number {
  if (isHero(char)) return heroAttackSkill(char, target.pos, weapon === undefined ? char.weapon : weapon);
  return bossRules(char)?.attackSkill?.(ctx, char, target) ?? mobStats(char).attack;
}

/**
 * Char.defenseSkill against `attacker`: a hero's; a monster's, unless the hero catches it off guard (Mob.surprisedBy:
 * it has not seen its enemy, or they are unseen) or it is paralysed — and each kind's own (a focused monk parries
 * anything, a great crab blocks the enemy it sees: mobskills.ts).
 */
function defenseSkill(char: Char, attacker?: Char, surprised?: boolean): number {
  if (isHero(char)) return heroDefenseSkill(char);
  // CrystalGuardian.defenseSkill: knocked down, it cannot dodge.
  const mine = mineDefense(char);
  if (mine !== undefined) return mine;
  // Mob.surprisedBy: the hero, unseen by it or invisible, with a weapon that can surprise (Hero.canSurpriseAttack).
  const caught = surprised ?? (attacker !== undefined && isHero(attacker) && surprises(attacker, char, attacker.weapon));
  // Mob.defenseSkill: none caught off guard, paralysed, or an ally struck by its hero.
  const base = caught || (char.paralysed ?? 0) > 0 || (char.ally && attacker !== undefined && isHero(attacker)) ? 0
    : bossRules(char)?.defenseSkill?.(char) ?? mobStats(char).defense;
  return mobDefenseSkill(char, attacker, base);
}

/** Char.hit for a magic attack (a bolt, a beam): its accuracy counts double (a boss's own accuracy). */
export function magicHit(ctx: Ctx, attacker: Char, defender: Char): boolean {
  return hitRoll(ctx, attacker, defender, attackSkill(ctx, attacker, defender), 2);
}

/** Char.drRoll, for the bosses' own rolls of what armour takes (drRoll). */
export const drRollOf = (ctx: Ctx, char: Char): number => drRoll(ctx, char);

/** Char.defenseSkill, as a monster's ranged attack (or anyone's) is weighed against it. */
export function defenseOf(char: Char, attacker?: Char): number {
  return defenseSkill(char, attacker);
}

/** The most a character's armour may take off a blow: a hero's armour's; a monster's drRoll at its highest. */
export function charArmor(char: Char): number {
  if (isHero(char)) return heroArmor(char);
  const stats = mobStats(char);
  return stats.dr + (stats.dr2 ?? 0) + (stats.drFlat ?? 0) + (char.armor ? armorDrMax(char.armor) : 0);
}

/**
 * Mob.drRoll: NormalIntRange(0, dr), and the second roll and flat part its kind adds, an armoured statue's armour
 * on top (ArmoredStatue.drRoll: Armor.DRMin..DRMax).
 */
function mobDrRoll(ctx: Ctx, mob: Mob): number {
  const stats = mobStats(mob);
  let dr = ctx.rng.normalIntRange(0, stats.dr);
  if (stats.dr2) dr += ctx.rng.normalIntRange(0, stats.dr2);
  dr += stats.drFlat ?? 0;
  if (mob.armor) dr += ctx.rng.normalIntRange(armorDrMin(mob.armor), armorDrMax(mob.armor));
  return dr;
}

/**
 * Char.drRoll: how much of a blow armour takes — a hero's armour (Hero.drRoll), a monster's its kind's (Mob.drRoll), the
 * earth guardian's and a sentry's their own way.
 */
export function drRoll(ctx: Ctx, char: Char): number {
  if (isHero(char)) return heroDrRoll(char, ctx.rng);
  // A boss's own (Goo's, Tengu's, DM-300's, the King's, Yog's fists...).
  const own = bossRules(char)?.drRoll;
  if (own) return own(ctx, char);
  if (char.kind === 'guardian') return guardianArmor(ctx, char, isChallenged(ctx.world, NO_ARMOR));
  if (char.kind === 'ward') return wardArmor(ctx, char);
  // The abilities' allies: the shadow clone's share of the hero's armour, the decoy's own.
  if (char.kind === 'shadow' || char.kind === 'ninjaLog') return allyArmor(ctx, char);
  return mobDrRoll(ctx, char);
}

function damageRoll(ctx: Ctx, char: Char, range?: readonly [number, number]): number {
  if (range) return ctx.rng.normalIntRange(range[0], range[1]);
  if (isHero(char)) return heroDamageRoll(char, ctx.rng);
  const own = bossRules(char)?.damageRoll;
  if (own) return own(ctx, char);
  const [min, max] = mobDamageRange(char);
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
  /** Char.attack(enemy, dmgMulti, dmgBonus, accMulti): the Duelist's abilities strike with these (an accMulti of Infinity never misses). */
  dmgMulti?: number;
  dmgBonus?: number;
  accMulti?: number;
  /** The melee weapon a Duelist's ability strikes with (Belongings.abilityWeapon): it may be the second weapon. */
  ability?: Item;
  /** A Monk's ability blow: bare fists, whatever the armour (UnarmedAbilityTracker). */
  unarmed?: boolean;
  /** FlurryEmpowerTracker: the weapon whose enchantment the fists carry. */
  enchantFrom?: Item;
  /** Char.attack's accuracy of INFINITE_ACCURACY (a combo move, a sniper shot): the blow cannot miss (but may be dodged for sure). */
  sure?: boolean;
  /** Char.attack's dmgMulti and dmgBonus (a combo move's). */
  damageMultiplier?: number;
  damageBonus?: number;
  /** A combo move's own blow: it does not build the combo (Combo.doAttack calls Char.attack, not Hero.onAttackComplete). */
  move?: boolean;
  /** Char.attack(enemy, dmgMulti, 0, accMulti): the blow's damage roll and the accuracy roll, so many times as much (spectral blades). */
  damageMulti?: number;
  accuracyMulti?: number;
  /** A hidden mimic's bite (Mimic.interact): no blow's procs of its own. */
  ambush?: boolean;
}

/**
 * Char.hit: the attacker's roll (a hex a fifth worse, a blessing a quarter better, a champion's factor) against the
 * defender's; infinite evasion beats anything, infinite accuracy anything else. `evasion` is the hero's own (the classes'
 * guard and liquid agility: classes/hooks.ts heroEvasion).
 */
export function hitRoll(
  ctx: Ctx, attacker: Char, defender: Char, skill: number, accMulti = 1, surprised?: boolean, evasion: { factor: number; infinite: boolean } = { factor: 1, infinite: false },
): boolean {
  // HawkAlly.defenseSkill: a spirit hawk dodges outright the blows Swift Spirit has given it.
  if (!isHero(defender) && defender.kind === 'hawk' && hawkDodges(ctx.world, defender)) return false;
  const defense = defenseSkill(defender, attacker, surprised);
  // GreatCrab.defenseSkill: each blow of the hero's it blocks costs the ghost's quest fifty points.
  if (!isHero(defender) && defender.kind === 'greatCrab' && isHero(attacker) && defense >= INFINITE_EVASION) scoreGhostHit(ctx.world, 50);
  if (evasion.infinite || defense >= INFINITE_EVASION) return false;
  if (skill >= INFINITE_ACCURACY || accMulti === Infinity) return true;
  const acuRoll = ctx.rng.floatMax(skill) * rollFactor(attacker) * evasionAndAccuracyFactor(attacker) * accMulti;
  const defRoll = ctx.rng.floatMax(defense) * rollFactor(defender) * evasionAndAccuracyFactor(defender) * evasion.factor;
  return acuRoll >= defRoll;
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
  // RotLasher.attack, DustWraith.attack: what going for the hero costs the wandmaker's quest.
  if (!isHero(attacker)) wandmakerAttack(ctx, attacker, defender);
  // The blacksmith's mine: an invulnerable gnoll geomancer or downed guardian; a guardian's blow costing the quest's score.
  if (mineBeforeAttack(ctx, attacker, defender)) return false;
  const strike = isHero(attacker) ? (override.weapon ?? override.ability ?? (override.unarmed ? null : meleeStrike(attacker))) : null;
  const thrown = isHero(attacker) && override.weapon !== undefined;
  // Feint.AfterImage.defenseSkill: a blow at the decoy loses the attacker the hero.
  if (!isHero(defender) && defender.kind === 'afterImage') {
    if (!isHero(attacker)) afterImageStruck(ctx, attacker, defender);
    return false;
  }
  // The classes (classes/hooks.ts): what the Duelist's talents and weapons and the Cleric's blessings do to a blow.
  const mods = isHero(attacker) ? heroBlow(ctx, attacker, defender, strike, override, thrown) : null;
  const surprised = isHero(attacker) && !isHero(defender) && surprises(attacker, defender, strike);
  const struck = { ...(strike ? { weapon: strike.kind } : {}), ...(surprised ? { surprise: true } : {}) };
  // Char.hit: an invisible attacker who can surprise never misses (INFINITE_ACCURACY; a focused monk's parry beats even that).
  const sure = isHero(attacker) && attacker.invisible > 0 && (isHero(defender) || surprised);
  // Preparation: the assassin's strike is as strong as the turns spent unseen (read before striking gives them away).
  const turnsUnseen = isHero(attacker) ? prepTurns(attacker) : undefined;
  const prep = turnsUnseen !== undefined ? prepLevel(turnsUnseen) : undefined;
  // Striking gives an invisible hero away (Invisibility.dispel: the cloak's stealth and a time freeze too), but not
  // before it has its surprise.
  if (isHero(attacker)) dispelInvisibility(ctx, attacker);
  // Hero.defenseSkill with a parry: infinite evasion, and the blow is answered.
  const parry = isHero(defender) && !isHero(attacker) && parries(ctx, defender);
  // Char.hit: infinite evasion beats infinite accuracy; the hero's own evasion is the classes' (a guard, a focus, liquid agility).
  const evasion = isHero(defender) && !parry ? heroEvasion(ctx, defender, attacker) : { factor: 1, infinite: false };
  const accMulti = (override.accMulti ?? 1) * (mods?.accuracy ?? 1) * (override.accuracyMulti ?? 1);
  const skill = sure || override.sure ? INFINITE_ACCURACY : (override.attack ?? attackSkill(ctx, attacker, defender, strike));
  const hit = !parry && hitRoll(ctx, attacker, defender, skill, accMulti, surprised, evasion);
  if (!hit) {
    if (isHero(attacker) && !thrown) mods?.after();
    parried(ctx, defender);
    ctx.effects.push({ type: 'attack', depth: ctx.depth, attacker: attacker.id, target: defender.id, hit, damage: 0, ...struck });
    if (parry) riposte(ctx, defender as Hero, attacker as Mob);
    return false;
  }
  // A sniper's thrown weapons find the weak points in any armour, from afar.
  const sniping = isHero(attacker) && attacker.subclass === 'sniper' && thrown && !adjacent(attacker.pos, defender.pos);
  const reduction = sniping || override.unarmed ? 0 : drRoll(ctx, defender);
  let damage = isHero(attacker) && override.damage === undefined
    ? prep !== undefined ? preparedDamage(attacker, ctx.rng, prep, strike, surprised) : heroDamageRoll(attacker, ctx.rng, surprised, strike, override.unarmed === true)
    : damageRoll(ctx, attacker, override.damage);
  // Char.attack: dmg * dmgMulti + dmgBonus, then the blessings and curses that scale a blow.
  if (isHero(attacker) && (override.dmgMulti !== undefined || override.dmgBonus !== undefined)) {
    damage = Math.floor((damage * (override.dmgMulti ?? 1) + (override.dmgBonus ?? 0)) + 0.5);
  }
  if (override.damageMultiplier !== undefined || override.damageBonus !== undefined) {
    damage = Math.round(damage * (override.damageMultiplier ?? 1) + (override.damageBonus ?? 0));
  }
  if (isHero(attacker)) {
    // Berserk.damageFactor (rage), and the bow's special shot (SpiritBow.damageRoll with sniperSpecial).
    damage = Math.round(berserkDamageFactor(attacker, damage));
    if (strike && itemDef(strike.kind).category === 'bow') damage = specialDamage(attacker, damage);
    if (prep !== undefined && pointsInTalent(attacker, 'bounty_hunter') > 0) Object.assign(tbOf(attacker), { bounty: true, prepLevel: prep });
  }
  if (mods) damage = mods.damage(damage);
  if (!isHero(attacker)) damage = classDamageTaken(ctx, attacker, defender, damage);
  // ChampionEnemy.meleeDamageFactor; Weakness: two thirds as hard (anyone's).
  damage *= meleeDamageFactor(attacker);
  if ((attacker.weakened ?? 0) > 0) damage *= 0.67;
  // Char.attack(enemy, dmgMulti, 0, accMulti): the blow's damage roll, so many times as much (spectral blades).
  if (override.damageMulti !== undefined) damage *= override.damageMulti;
  damage = Math.round(damage);
  // Endure: the stored damage is added to the endurer's next blows; while enduring, a blow on them is halved (and stored).
  if (isHero(attacker)) damage = endureStrike(attacker, attacker.time, damage);
  if (isHero(defender)) damage = Math.round(endureAdjust(defender, ctx.floor.now, damage));
  // Hero.defenseProc: earthen armour takes half the blow, before the armour worn.
  if (isHero(defender)) damage = rockArmorAbsorbs(defender, damage);
  if (!isHero(defender)) {
    // Mob.defenseProc of the struck monster's kind, before its armour (a swarm splits, a thief drops a coin...).
    if (defender.kind === 'swarm') split(ctx, defender, damage);
    damage = mobDefenseProc(ctx, defender, attacker, damage);
    // RotHeart.defenseProc: struck, it lets out toxic gas.
    if (defender.kind === 'rotHeart') rotHeartStruck(ctx, defender);
    // Mob.defenseProc: a soul-marked monster struck by a hero gives some of it back as health.
    if (isHero(attacker) && (defender.soulMarked ?? 0) > 0) soulSiphon(ctx, attacker, defender, damage);
  }
  const blow: Blow = {};
  // Hero.defenseProc: the berserker's rage builds on the blow, armour or no armour.
  if (isHero(defender) && !isHero(attacker)) onDefenseProc(defender, damage);
  // Hero.defenseProc: an inscribed armour's answer, before the armour soaks the blow.
  if (isHero(defender) && !isHero(attacker)) {
    const mark = ctx.effects.length;
    damage = classArmorProc(ctx, attacker, defender, damage, blow, () => armorProc(ctx, attacker, defender, damage, blow));
    // The glyph's backlash may have felled its wearer, or an ankh raised them anew: the blow is spent.
    if (!isAlive(defender) || ctx.effects.slice(mark).some((e) => e.type === 'resurrected')) return true;
  }
  // Char.defenseProc: the shield of light eases the blows of the foe it was cast on.
  if (!isHero(attacker)) damage = lightShield(ctx, attacker, defender, damage);
  damage = Math.max(damage - reduction, 0);
  // Vulnerable: a third more, after the armour (effectiveDamage *= 1.33f, an int).
  if ((defender.vulnerable ?? 0) > 0) damage = Math.trunc(damage * 1.33);
  // Viscosity: some of what gets past the armour is put off.
  if (isHero(defender) && blow.viscosity !== undefined) damage = deferDamage(ctx, defender, damage, blow.viscosity);
  // A boss's own attackProc (Goo's and the rotting fist's ooze...).
  if (!isHero(attacker) && !override.ambush) {
    const proc = bossRules(attacker)?.attackProc;
    if (proc) damage = proc(ctx, attacker, defender, damage);
  }
  // Char.attackProc: what a monster's blow does besides the damage (mobskills.ts), a champion's too.
  if (!isHero(attacker) && !override.ambush) {
    if ((attacker.kind === 'thief' || attacker.kind === 'bandit') && !attacker.item && isHero(defender) && !attacker.ally) {
      if (steal(ctx, attacker, defender)) attacker.state = 'fleeing';
    }
    damage = mobAttackProc(ctx, attacker, defender, damage);
    // A fungal sentry's poison, a gnoll guard's warning (minemobs.ts); RotLasher.attackProc: its lash cripples.
    mineAttackProc(ctx, attacker, defender, damage);
    if (attacker.kind === 'rotLasher') lasherCripples(ctx, defender);
    championAttackProc(ctx, attacker, defender, (char) => igniteChar(ctx, char));
    // HawkAlly.attackProc: its talons blind and cripple.
    if (attacker.kind === 'hawk') hawkProc(ctx, allyOwner(ctx.world, attacker), defender);
    // CursePersonification.attackProc: each blow throws its victim back a step, if there is room.
    if (attacker.kind === 'curse') shove(ctx, attacker, defender);
    // Undead.attackProc: now and then a blow stuns.
    if (attacker.kind === 'undead' && ctx.rng.int(5) === 0) defender.paralysed = Math.max(defender.paralysed ?? 0, 1);
    // CrystalMimic.attackProc, out in the open: whom it bites is thrown aside, and it runs.
    if (attacker.kind === 'crystalMimic') crystalBite(ctx, attacker, defender);
  }
  // Hero.attackProc: a thrown weapon's own effect, then the weapon's enchantment (Weapon.proc).
  let staffAfter: (() => void) | undefined;
  if (isHero(attacker) && !isHero(defender)) {
    // Hero.attackProc: Talent.onAttackProc first (provoked anger, lingering magic, sucker punch, follow-up strike).
    damage = onAttackProc(ctx, attacker, defender, damage, strike, thrown);
    // The Duelist's patient strike and deadly followup.
    if (mods) damage = mods.proc(damage);
    // MagesStaff.proc: a battlemage's staff does what its wand does on a hit, before its enchantment.
    if (!thrown && attacker.weapon?.kind === 'weapon.magesStaff') {
      // MagesStaff.proc: mystical charge feeds the artifacts, empowered strike hits harder (and makes the wand's effect likelier).
      damage = staffProc(attacker, damage, (amount) => chargeArtifacts(ctx, attacker, amount));
      staffAfter = staffBlow(ctx, attacker, attacker.weapon, defender, damage);
      staffProcDone(attacker);
    }
    if (thrown) damage = missileProc(ctx, attacker, defender, damage, override.weapon!);
    // (No enchantment works while magic will not: MagicImmune.)
    if (damage >= 0 && isAlive(defender) && !isMagicImmune(attacker)) damage = classWeaponProc(ctx, attacker, defender, damage, strike ?? override.enchantFrom ?? null, blow, () => weaponProc(ctx, attacker, defender, damage, strike ?? override.enchantFrom ?? null, blow));
    // Talent.onAttackProc, Spirit Blades: a blade's blow may carry the spirit bow's enchantment too.
    if (damage >= 0 && isAlive(defender)) damage = bladeBowProc(ctx, attacker, defender, damage, blow);
    // FireImbue.proc and FrostImbue.proc: half the blows set the foe alight; every one chills it.
    if (isAlive(defender) && (attacker.buffs?.fireImbue ?? 0) > 0 && ctx.rng.int(2) === 0) igniteChar(ctx, defender);
    if (isAlive(defender) && (attacker.buffs?.frostImbue ?? 0) > 0) chillChar(defender, 3);
    // Weapon.proc: every blow that lands makes the weapon in hand better known (a thrown one, see throwing.ts).
    if (!thrown && (override.ability ?? attacker.weapon) && !override.unarmed) familiarise(ctx, attacker, (override.ability ?? attacker.weapon)!);
    damage = Math.max(0, damage);
    if (!isAlive(defender)) {
      if (!thrown) mods?.after();
      return true;
    }
  }
  // Armor.proc: and every blow taken makes the armour better known.
  if (isHero(defender) && !isHero(attacker)) familiarise(ctx, defender, defender.armor);
  // EarthGuardian.attackProc: the monster it strikes turns on it.
  if (!isHero(attacker) && attacker.kind === 'guardian' && !isHero(defender) && isAlive(defender)) {
    defender.enemy = attacker.id;
    if (defender.state !== 'passive') defender.state = 'hunting';
  }
  // Char.damage, as a vorpal blow has it: unless it kills, it is dealt as bleeding instead.
  if (blow.vorpal !== undefined && !isHero(defender) && damage <= defender.hp) {
    const bleed = Math.round(blow.vorpal * (2 + damage / 2));
    defender.bleeding = Math.max(defender.bleeding ?? 0, bleed);
    ctx.effects.push({ type: 'attack', depth: ctx.depth, attacker: attacker.id, target: defender.id, hit, damage: 0, ...struck });
    ctx.effects.push({ type: 'enchanted', depth: ctx.depth, pos: defender.pos, enchant: 'vorpal' });
    return true;
  }
  // Sickle.HarvestBleedTracker: the blow's damage is dealt as bleeding instead (unless the foe cannot bleed).
  if (isHero(attacker) && attacker.cls?.harvest && !isHero(defender) && !bleedImmune(defender)) {
    defender.bleeding = Math.max(defender.bleeding ?? 0, damage);
    markHarvest(defender);
    ctx.effects.push({ type: 'attack', depth: ctx.depth, attacker: attacker.id, target: defender.id, hit, damage: 0, ...struck });
    mods?.after();
    return true;
  }
  const before = defender.hp;
  const wasEnemy = isHero(attacker) && !isHero(defender) && isEnemy(defender);
  ctx.effects.push({ type: 'attack', depth: ctx.depth, attacker: attacker.id, target: defender.id, hit, damage, ...struck });
  hurt(ctx, defender, damage, attacker);
  mods?.landed(defender, wasEnemy, damage);
  staffAfter?.();
  if (isHero(attacker) && !isHero(defender)) {
    afterBlow(ctx, attacker, defender, damage, before, blow);
    afterHeroBlow(ctx, attacker, defender, wasEnemy, thrown, strike, prep, override.move === true);
  }
  if (mods && !thrown) mods.after();
  // ShadowAlly.defenseProc: with Cloned Armor, the hero's glyph answers a blow on the clone.
  if (!isHero(defender) && defender.kind === 'shadow' && !isHero(attacker) && isAlive(attacker)) cloneGlyph(ctx, defender, attacker);
  // SpiritBow.proc under Nature's Power: Nature's Wrath and Wild Momentum.
  if (isHero(attacker) && thrown && override.weapon && itemDef(override.weapon.kind).category === 'bow') natureArrowProc(ctx, attacker, defender);
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
  | 'berserk' | 'multiplicity' | 'bomb' | 'chill' | 'magic' | 'holy' | 'chalice' | 'noRose'
  /** Shattered's wands: a wand's own harm to the hero, corrosion, corruption wasting an ally away, a knock against a wall. */
  | 'wand' | 'corrosion' | 'corruption' | 'knockback'
  /** Alchemy's: electricity, an aqua brew's geyser, the psionic blast, the special bombs. */
  | 'lifeLink'
  | 'electricity' | 'geyser' | 'psionic' | 'arcaneBomb' | 'flashbang' | 'holy' | 'shrapnel'
  /** Shattered's monsters: a brute's rage spent, a ghoul's host gone, a minion's master slain. */
  | 'rage' | 'lifelink' | 'master'
  /** The bosses' own: DM-300's falling rocks, the King's summoning and his KingDamager, a life link. */
  | 'rocks' | 'king' | 'link';

/** Who cannot be harmed: the folk (the sad ghost, the quest givers, the sheep), the heroes' passive allies; a shopkeeper will not stay to be. */
const untouchable = (mob: Mob): boolean => mob.state === 'passive' && !isEnemy(mob) && !mob.corrupted;

export function hurt(ctx: Ctx, victim: Char, damage: number, source: Char | Hazard): void {
  // Char.damage: nothing for the dead, nor for negative damage.
  if (!isAlive(victim) || damage < 0) return;
  // Hero.damage: in the hourglass's stasis nothing can touch the hero.
  if (isHero(victim) && (victim.stasis ?? 0) > 0) return;
  // The folk cannot be harmed (the sad ghost, the quest givers, the sheep); the shopkeeper will not stay to be.
  if (!isHero(victim) && untouchable(victim)) {
    if (isShopkeeper(victim)) shopkeeperFlees(ctx, victim);
    return;
  }
  const by = typeof source === 'string' ? null : source;
  // Hero.damage: harm that comes from no one is halved while enduring (what comes from a character was, in Char.attack).
  if (isHero(victim) && typeof source === 'string') damage = Math.round(endureAdjust(victim, ctx.floor.now, damage));
  // WandOfRegrowth.Lotus.damage: nothing harms it.
  if (!isHero(victim) && victim.kind === 'lotus') return;
  // RotHeart.damage, RotLasher.damage: fire takes them away at once.
  if (!isHero(victim) && source === 'burning' && burnsAway(ctx, victim)) return;
  // The blacksmith's mine: a downed guardian mends instead of dying, the geomancer's armour and thirds, a guard armoured by its sapper.
  if (!isHero(victim)) {
    damage = mineDamage(ctx, victim, damage, source);
    if (damage < 0) return;
  }
  // A boss's own Char.damage: invulnerable, deferring, linked... (bosses/*.ts).
  if (!isHero(victim) && bossRules(victim)) {
    const through = bossBeforeDamage(ctx, victim, damage, source);
    // (A negative blow does nothing: the soiled fist deep in grass.)
    if (through === null || through < 0) return;
    damage = through;
  }
  // Char.damage: the Cleric's link of life, aura of protection and power of many.
  damage = Math.round(clericHurt(ctx, victim, damage, source));
  if (!isHero(victim)) {
    // Mob.damage: it wakes, and unless it hunts already (or flees), it is alerted to who struck it.
    if (victim.state === 'sleeping') victim.state = 'wandering';
    if (victim.state !== 'fleeing' && victim.state !== 'hunting') victim.alerted = true;
    // Mimic.damage: struck, a hidden mimic is out.
    if (victim.hidden) reveal(ctx, victim);
    // Statue.damage: struck, a statue comes to life.
    if ((victim.kind === 'statue' || victim.kind === 'armoredStatue') && victim.state === 'wandering') victim.state = 'hunting';
    // In a party, a monster turns on whoever hurt it (an ally does not turn on the heroes).
    if (by && isHero(by) && !victim.ally) victim.enemy = by.id;
    // Terror.recover: struck again, a frightened monster pulls itself together.
    if ((victim.terror ?? 0) > 0 && victim.terror! < TERROR_TURNS) victim.terror = 0;
    // Each kind's own Char.damage (a slime's membrane, a charging eye...), and a champion's.
    damage = mobDamage(ctx, victim, damage, source);
    damage = championDamage(victim, damage);
  }
  // Char.damage with RingOfElements.resist: the elements (fire, poison, ooze, lightning, gas, magic) do less.
  if (isHero(victim)) {
    const what = typeof source === 'string' ? source : isHero(source) ? '' : source.kind;
    if (ELEMENTAL.has(what)) damage = Math.round(damage * elementsResist(victim));
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
  // Ascended form's shield and divine intervention's come before the others (shieldUsePriority 1).
  damage = clericShields(ctx, victim, damage);
  // Char.damage: invulnerability, frost, charm, doom and shields (status.ts).
  damage = damageTaken(ctx, victim, damage, by);
  // Char.damage: the warrior's seal may raise its shield, and shields take what they can (not hunger's).
  if (isHero(victim)) damage = shieldDamage(ctx, victim, damage, source === 'hunger');
  // Hero.damage: Challenge's duel counts what the hero takes.
  if (isHero(victim)) noteDuelDamage(victim, damage);
  // Berserk's shield is the last to give way (shieldUsePriority -1).
  if (isHero(victim)) damage = berserkAbsorbs(victim, damage);
  const before = victim.hp;
  onHurt(victim);
  victim.hp -= damage;
  // Char.damage: a monster marked for death does not die at no health, but waits for the mark to end (abilities/rogue.ts).
  if (!isHero(victim) && victim.deathMark) {
    if (victim.hp < 0) victim.hp = 0;
    if (victim.hp === 0) fearTheReaper(ctx, victim);
  }
  if (isHero(victim)) {
    // Berserk.berserking at zero health: deathless fury keeps the hero up on a single point; the shield spent, they fall.
    if (victim.hp <= 0 && deathlessFury(ctx, victim)) victim.hp = 1;
    else if (isAlive(victim) && deathlessEnded(victim)) victim.hp = 0;
  }
  if (!isHero(victim)) {
    // Goo.damage, Tengu.damage…: phases, brackets, the sealed floor's healing (LockedFloor.addTime).
    if (bossRules(victim)) bossAfterDamage(ctx, victim, before, source);
    afterDamage(ctx, victim, source);
  }
  // (Tengu holds on at no health in his arena until its fight is over: Tengu.isAlive.)
  if (!isAlive(victim) && !(!isHero(victim) && bossHoldsOn(ctx, victim))) {
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

/** Mob.die, for whatever kills a monster outright (a boss's fight ending, its subjects dying with it). */
export function killMob(ctx: Ctx, mob: Mob, by?: string): void {
  if (!ctx.floor.mobs.includes(mob)) return;
  mob.hp = 0;
  mobDied(ctx, mob, by);
}

/**
 * Char.die from outside a blow: a hawk whose time ran out, a decoy replaced, a monster whose death mark has ended at no
 * health. `by` is the hero credited with the kill.
 */
export function finishOff(ctx: Ctx, mob: Mob, by?: string): void {
  if (!ctx.floor.mobs.includes(mob)) return;
  if (by) {
    const hero = ctx.world.heroes.find((h) => h.id === by);
    if (hero) hero.kills++;
  }
  mobDied(ctx, mob, by);
}

export function mobDied(ctx: Ctx, mob: Mob, by?: string): void {
  duelFoeDied(ctx, mob);
  const killer = by ? ctx.world.heroes.find((h) => h.id === by) : undefined;
  // Mob.die: a kill by the hero may free the next act (lethal momentum).
  if (killer) onMobKilled(ctx, killer, mob);
  mob.hp = 0;
  // Char.die: something else forces the death of a monster marked for death; the mark goes (and shields the rogue).
  if (mob.deathMark) endDeathMark(ctx, mob, true);
  // (Already gone: slain as its blow was being dealt, e.g. the King's court as he takes to his throne.)
  const index = ctx.floor.mobs.indexOf(mob);
  if (index < 0) return;
  ctx.floor.mobs.splice(index, 1);
  leaveCell(ctx.world, ctx.level, ctx.depth, mob.pos);
  ctx.effects.push({ type: 'died', depth: ctx.depth, who: mob.id, pos: mob.pos, kind: mob.kind, ...(by ? { by } : {}) });
  // GhostHero.die: the rose's ghost bids farewell, and its rose empties.
  if (mob.kind === 'ghostHero') {
    ghostDied(ctx, mob);
    return;
  }
  sacrifice(ctx, mob);
  arenaKill(ctx, mob);
  // Mob.die: a soul-marked foe's death feeds the warlock (soul eater), and may raise a minion (necromancer's minions).
  if ((mob.soulMarked ?? 0) > 0) onSoulMarkedDied(ctx, mob);
  // Mob.destroy: the bestiary counts the slain.
  if (isEnemy(mob)) countSlain(ctx.world, mob.kind);

  // Mob.die: an ally (a ward, the guardian, a corrupted monster) leaves nothing and teaches nothing:
  // what a corrupted monster had to give, it gave when it was corrupted.
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
      // Mob.destroy: a Monk gains energy from every enemy that falls.
      if (!mob.ally && mob.state !== 'passive') gainEnergy(ctx, hero, mob);
    }
  }

  // The quests' foes: the sad ghost's, the blacksmith's mine's bosses, the old wandmaker's.
  ghostFoeSlain(ctx, mob, by);
  mineMobDied(ctx, mob);

  // Mob.rollToDropLoot (not for an ally): a thief's goods, the fetid rat's skull, a mimic's treasure, the loot;
  // then a lucky blow's prize (Lucky.LuckProc); then the thrown weapons stuck in it fall (PinCushion).
  if (!mob.ally) dropRemains(ctx, mob);
  if (mob.luck !== undefined) {
    landItem(ctx, mob.pos, luckyDrop(ctx, mob.luck));
    ctx.effects.push({ type: 'lucky', depth: ctx.depth, pos: mob.pos });
  }
  for (const item of mob.pinned ?? []) landItem(ctx, mob.pos, item);
  // RotHeart.die, NewbornFireElemental.die: what the old wandmaker is after.
  wandmakerMobDied(ctx, mob);

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

  // A boss's death (Goo.die, Tengu.die...): its level unseals, its drops, its last words; a beacon carried grows stronger.
  bossDied(ctx, mob, by);
  if (mob.kind === 'tengu' || mob.kind === 'dm300' || mob.kind === 'king') bossSlainBeacon(ctx);
}

/** Bestiary.countEncounter: one more of a kind slain (and so seen). */
export function countSlain(world: World, kind: MobKind): void {
  const entry = ((world.bestiary ??= {})[kind] ??= { seen: true, slain: 0 });
  entry.seen = true;
  entry.slain++;
}

/**
 * Mob.rollToDropLoot: a thief's stolen goods fall where it dies, and a mimic's treasure (Level.drop: as
 * the challenges allow; a flier slain over a chasm drops them through it), and its own loot, unless the
 * party has outgrown the monster or the armband has robbed it already.
 */
function dropRemains(ctx: Ctx, mob: Mob): void {
  const stats = mobStats(mob);
  // Thief.rollToDropLoot and Mimic.rollToDropLoot: a thief's stolen goods, a mimic's treasure (not a statue's weapon).
  if (mob.item && mob.kind !== 'statue' && mob.kind !== 'armoredStatue') landItem(ctx, mob.pos, mob.item);
  // Thief.rollToDropLoot: a shattered pot it carried lies there now, its bee guarding it.
  if (mob.item?.kind === 'honeypot.shattered' || mob.loot?.some((i) => i.kind === 'honeypot.shattered')) potDropped(ctx, mob.id, mob.pos);
  // Statue.die: its weapon (and an armoured one's armour), known for what they are.
  if ((mob.kind === 'statue' || mob.kind === 'armoredStatue') && mob.item) landItem(ctx, mob.pos, mob.item);
  if (mob.armor) landItem(ctx, mob.pos, mob.armor);
  delete mob.item;
  delete mob.armor;
  for (const item of mob.loot ?? []) landItem(ctx, mob.pos, item);
  delete mob.loot;
  const heroes = heroesOn(ctx.world, ctx.depth);
  if (heroes.some((h) => h.lvl <= stats.maxLvl + 2)) {
    const wearer = heroes[0];
    if (mob.robbed !== 'stolen') {
      const loot = lootOf(ctx, mob);
      // Mob.lootChance: bounty hunter adds to it after a prepared strike; rings of wealth make it likelier (RingOfWealth.dropChanceMultiplier), and the shard of oblivion.
      const item = ctx.rng.float() < loot.chance * (lootChanceMultiplier(ctx.world, wearer) + (wearer ? bountyBonus(wearer) : 0)) ? loot.make() : null;
      if (item) landItem(ctx, mob.pos, item);
    }
    // RingOfWealth.tryForBonusDrop: a try for every monster, fifteen for a boss.
    if (wearer) {
      const boss = ['goo', 'tengu', 'dm300', 'king', 'yog'].includes(mob.kind);
      for (const bonus of wealthBonusDrops(ctx, wearer, boss ? 15 : 1)) landItem(ctx, mob.pos, bonus);
    }
  }
  // What each kind leaves besides (mobs.ts): a gnoll exile's pack, a hermit crab's armour, goo, a shard...
  dropExtras(ctx, mob);
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
  gainEnergy(ctx, hero, mob);
}

/**
 * What a monster may leave behind: the chance (Mob.lootChance) and what it is (Mob.createLoot), which
 * the master thieves' armband can steal as well. A null loot is nothing after all.
 */
export function lootOf(ctx: Ctx, mob: Mob): { chance: number; make: () => Item | null } {
  const loot = (chance: number, make: () => Item | null): { chance: number; make: () => Item | null } => ({ chance, make });
  switch (mob.kind) {
    case 'dm300':
      // Shattered's DM-300 once left the cape of thorns, known through and through, where the original's left a ring of thorns.
      return loot(0.333, () => createItem('artifact.cape'));
    case 'goo':
      return loot(0.333, () => createItem('artifact.beacon'));
    default:
      // Mob.lootChance and Mob.createLoot of Shattered's monsters (mobs.ts).
      return loot(baseLootChance(ctx, mob), () => createLoot(ctx, mob));
  }
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
    damage = Math.max(0, damage - (drRoll(ctx, victim) + drRoll(ctx, victim)));
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
