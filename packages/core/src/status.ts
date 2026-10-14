import { type Hero, isAlive, type Mob, MOBS } from './actors';
import { hurt } from './combat';
import { chillPack } from './cooking';
import { type Char, type Ctx, isHero, isWater } from './floor';
import { F, hasFlag } from './level/terrain';
import { isImmune, resistance } from './props';
import { mobPress } from './traps';
import { onShieldBroken } from './talents/combat';

/*
 * The conditions Shattered's wands put creatures under (actors/buffs): Chill
 * and Frost, Corrosion and Ooze, Weakness, Vulnerable, Hex, Doom, SoulMark,
 * Corruption, Barrier, Bless and Invulnerability, Levitation on a monster.
 * Kept as turns left on the creature (Hero and Mob in actors.ts), counted down
 * on its own turns: a monster's in mobConditions, a hero's in spend.
 */

const f32 = Math.fround;

/** Chill.DURATION, Frost.DURATION, Ooze.DURATION, SoulMark.DURATION, Hex/Vulnerable/Weakness.DURATION. */
export const CHILL_TURNS = 10;
export const FROST_TURNS = 10;
export const OOZE_TURNS = 20;
export const SOUL_MARK_TURNS = 10;
/** Burning.DURATION. */
export const BURNING_TURNS = 8;
/** Paralysis.DURATION. */
export const PARALYSIS_TURNS = 10;
/** Charm.DURATION. */
export const CHARM_TURNS = 10;
/** Levitation.DURATION. */
export const LEVITATION_TURNS = 20;

/** Burning.reignite: alight for the whole of Burning.DURATION again; it thaws whatever chill there was. */
export function ignite(char: Char): void {
  if (isImmune(char, 'burning')) return;
  char.burning = Math.max(char.burning ?? 0, BURNING_TURNS);
  if ((char.chill ?? 0) > 0) char.chill = 0;
}

/** Buff.affect(ch, Chill.class, turns): more chill on top of what there is (none on what is frozen), and no more burning. */
export function chill(char: Char, turns: number): void {
  if (isImmune(char, 'chill') || (char.frozen ?? 0) > 0) return;
  char.chill = (char.chill ?? 0) + Math.round(turns * resistance(char, 'chill'));
  char.burning = 0;
}

/** Chill.speedFactor: a tenth slower for every turn of chill left, half as fast at most. */
export const chillFactor = (char: Char): number => Math.max(0.5, 1 - (char.chill ?? 0) * 0.1);

/**
 * Frost.attachTo: frozen solid for a while — no burning, no chill — and a hero's pack feels it (a
 * potion shatters, meat freezes: chillPack).
 */
export function freeze(ctx: Ctx, char: Char, turns: number): void {
  if (isImmune(char, 'frost')) return;
  char.burning = 0;
  char.chill = 0;
  char.frozen = Math.max(char.frozen ?? 0, Math.round(turns * resistance(char, 'frost')));
  if (isHero(char)) chillPack(ctx, char);
}

/** Frost.detach: thawed (by a blow, or in time); standing in water, chilled still. */
function thaw(ctx: Ctx, char: Char): void {
  char.frozen = 0;
  if (isWater(ctx.level.map[char.pos]!)) chill(char, CHILL_TURNS / 2);
}

/** Corrosion.set: at least this long, and at least this hard. */
export function corrode(char: Char, turns: number, damage: number): void {
  if (isImmune(char, 'corrosion')) return;
  const now = char.corrosion ?? { left: 0, damage: 1 };
  char.corrosion = { left: Math.max(turns, now.left), damage: Math.max(damage, now.damage) };
}

/** Ooze.set on a monster (a hero's caustic ooze is Hero.ooze). */
export function ooze(char: Char, turns: number): void {
  if (isImmune(char, 'ooze')) return;
  if (isHero(char)) char.ooze = 0;
  else char.ooze = turns;
}

/** Barrier.setShield: shielding raised to this much, never lowered. */
export function shieldUp(char: Char, amount: number): void {
  if (amount <= (char.shield ?? 0)) return;
  char.shield = amount;
  char.shieldDecay = 0;
}

/** Whether a creature flies, or floats for now (Char.flying). */
export const flies = (char: Char): boolean => (isHero(char) ? (char.levitating ?? 0) > 0 : MOBS[char.kind].flying === true || (char.levitating ?? 0) > 0);

/**
 * Char.damage, the parts the wands' conditions take: nothing harms the invulnerable; a blow
 * thaws the frozen and shakes off some of a charm (Charm.recover: five turns of it, unless it
 * holds against the heroes' allies); the doomed take two thirds more; a shield takes what it can.
 * Returns what gets through to health.
 */
export function damageTaken(ctx: Ctx, victim: Char, damage: number, by: Char | null): number {
  if ((victim.invulnerable ?? 0) > 0) return 0;
  if ((victim.frozen ?? 0) > 0) thaw(ctx, victim);
  if (!isHero(victim) && victim.charmIgnoreNext) {
    // Charm.recover: ignoreNextHit.
    delete victim.charmIgnoreNext;
  } else if (!isHero(victim) && (victim.charmed ?? 0) > 0 && !(victim.charmFirm && by && !isHero(by) && by.ally)) {
    victim.charmed = Math.max(0, victim.charmed! - 5);
    if (victim.charmed <= 0) delete victim.charmedBy;
  }
  if (!isHero(victim) && victim.doomed) damage = Math.round(damage * 1.67);
  // Char.damage: a monster marked for death (Death Mark) takes a quarter more, unless it is an ally.
  if (!isHero(victim) && victim.deathMark && !victim.ally) damage = Math.trunc(damage * 1.25);
  if ((victim.shield ?? 0) > 0 && damage > 0) {
    const absorbed = Math.min(victim.shield!, damage);
    victim.shield! -= absorbed;
    damage -= absorbed;
    if (victim.shield! <= 0) {
      delete victim.shield;
      if (isHero(victim)) onShieldBroken(victim);
    }
  }
  return damage;
}

/** Barrier.act: a shield fades by a point once enough of a turn's share (a twentieth of it, a point at most) has gathered. */
function fadeShield(char: Char): void {
  if (!char.shield) return;
  // A boss's barrier fades on the floor's clock, or holds (bosses/index.ts: DM-300's charge, the King's DKBarrior).
  if (!isHero(char) && char.boss !== undefined) return;
  char.shieldDecay = (char.shieldDecay ?? 0) + Math.min(1, char.shield / 20);
  if (char.shieldDecay >= 1) {
    char.shield--;
    char.shieldDecay = 0;
  }
  if (char.shield <= 0) {
    delete char.shield;
    delete char.shieldDecay;
  }
}

/** Corrosion.act: it eats away, harder every turn (by half a point, past the depth's measure). */
function corrosionTick(ctx: Ctx, char: Char): void {
  const corrosion = char.corrosion;
  if (!corrosion) return;
  const damage = Math.trunc(corrosion.damage * resistance(char, 'corrosion'));
  if (damage > 0) {
    ctx.effects.push({ type: 'hurt', depth: ctx.depth, who: char.id, damage });
    hurt(ctx, char, damage, 'corrosion');
  }
  corrosion.damage += corrosion.damage < Math.trunc(ctx.depth / 2) + 2 ? 1 : 0.5;
  if (--corrosion.left <= 0 || !isAlive(char)) delete char.corrosion;
}

/** Ooze.act on a monster: water washes it off; otherwise it burns a little, more the deeper. */
function oozeTick(ctx: Ctx, mob: Mob): void {
  if (!mob.ooze) return;
  if (isWater(ctx.level.map[mob.pos]!) && !flies(mob)) {
    delete mob.ooze;
    return;
  }
  const depth = ctx.depth;
  const damage = depth > 5 ? 1 + Math.trunc(depth / 5) : depth === 5 ? 1 : mob.ooze % 2 === 0 ? 1 : 0;
  if (damage > 0) {
    ctx.effects.push({ type: 'hurt', depth, who: mob.id, damage });
    hurt(ctx, mob, damage, 'ooze');
  }
  if (--mob.ooze <= 0) delete mob.ooze;
}

/** Corruption.act: a corrupted monster wastes away, a hundredth of its health a turn. */
function corruptionTick(ctx: Ctx, mob: Mob): void {
  if (!mob.corrupted) return;
  mob.corruptDecay = f32((mob.corruptDecay ?? 0) + f32(mob.ht / 100));
  const damage = Math.trunc(mob.corruptDecay);
  mob.corruptDecay -= damage;
  if (damage > 0) {
    ctx.effects.push({ type: 'hurt', depth: ctx.depth, who: mob.id, damage });
    hurt(ctx, mob, damage, 'corruption');
  }
}

const countDown = (char: Char, key: 'chill' | 'hexed' | 'vulnerable' | 'blessed' | 'invulnerable' | 'weakened' | 'soulMarked' | 'blasted', by = 1): void => {
  const left = (char as Partial<Record<typeof key, number>>)[key];
  if (left === undefined || left <= 0) return;
  (char as Partial<Record<typeof key, number>>)[key] = Math.max(0, left - by);
};

/**
 * A monster's turn under the wands' conditions, before it acts; true if it loses the turn (frozen
 * solid). Its frost, chill and the rest wear off a turn at a time.
 */
export function mobStatusTurn(ctx: Ctx, mob: Mob): boolean {
  // Once a turn: a monster that acts again at once (having just noticed someone) has not had another.
  if (mob.statusAt === mob.time) return (mob.frozen ?? 0) > 0;
  mob.statusAt = mob.time;
  corrosionTick(ctx, mob);
  if (!isAlive(mob)) return true;
  oozeTick(ctx, mob);
  if (!isAlive(mob)) return true;
  corruptionTick(ctx, mob);
  if (!isAlive(mob)) return true;
  fadeShield(mob);
  for (const key of ['chill', 'hexed', 'vulnerable', 'blessed', 'invulnerable', 'soulMarked', 'blasted'] as const) countDown(mob, key);
  // Weakness on a monster (the wand of corruption's) wears off too; a hero's is Hero.weakened, counted in spend.
  countDown(mob, 'weakened');
  if ((mob.levitating ?? 0) > 0 && --mob.levitating! <= 0) {
    // Levitation.detach: back on the ground, wherever that is.
    delete mob.levitating;
    mobPress(ctx, mob);
    if (!isAlive(mob)) return true;
  }
  if ((mob.frozen ?? 0) > 0) {
    if (--mob.frozen! <= 0) thaw(ctx, mob);
    mob.enemySeen = false;
    return true;
  }
  return false;
}

/** Sungrass.Health.act: health coming back, as long as the hero stays where they stood ((40 + HT) / 150 of a point a turn). */
function herbalTick(hero: Hero): void {
  const herbal = hero.herbal;
  if (!herbal) return;
  if (hero.pos !== herbal.pos) {
    delete hero.herbal;
    return;
  }
  herbal.partial = f32(herbal.partial + f32((40 + hero.ht) / 150));
  if (herbal.partial > 1) {
    const heal = Math.trunc(herbal.partial);
    herbal.partial -= heal;
    herbal.level -= heal;
    if (hero.hp < hero.ht) hero.hp = Math.min(hero.ht, hero.hp + heal);
  }
  if (herbal.level <= 0) delete hero.herbal;
}

/** The same for a hero, as `time` passes (Hero.spend): whole turns of corrosion, the rest worn off as time. */
export function heroStatusTime(ctx: Ctx, hero: Hero, time: number, ticks: number): void {
  for (let i = 0; i < ticks && isAlive(hero); i++) {
    corrosionTick(ctx, hero);
    fadeShield(hero);
    herbalTick(hero);
  }
  // (A hero's Bless runs out in world.ts spend, with the hero's other buffs.)
  for (const key of ['chill', 'hexed', 'vulnerable', 'invulnerable'] as const) countDown(hero, key, time);
  if ((hero.frozen ?? 0) > 0) {
    hero.frozen = Math.max(0, hero.frozen! - time);
    if (hero.frozen <= 0) thaw(ctx, hero);
  }
  if (hero.magicCharge) {
    hero.magicCharge.turns -= time;
    if (hero.magicCharge.turns <= 0) delete hero.magicCharge;
  }
  if (hero.lightningCharge) hero.lightningCharge = Math.max(0, hero.lightningCharge - time);
  if (hero.recharging) hero.recharging = Math.max(0, hero.recharging - time);
  if (hero.disguise && (hero.disguise.turns -= time) <= 0) delete hero.disguise;
  // TimeStasis runs out turn by turn in heroTurns (hero.ts), the hourglass's and a cursed wand's alike.
}

/** Char.speed under chill: a slowed creature is slowed only (they do not stack). */
export function timeScale(char: Char): number {
  if ((char.slowed ?? 0) > 0) return 0.5;
  return (char.chill ?? 0) > 0 ? chillFactor(char) : 1;
}

/** Char.attack's accuracy and evasion rolls: a hex makes both a fifth worse, a blessing a quarter better. */
export function rollFactor(char: Char): number {
  // A hero's Bless is already in the hero's accuracy and evasion (actors.ts heroAttackSkill, heroDefenseSkill).
  return ((char.hexed ?? 0) > 0 ? 0.8 : 1) * (!isHero(char) && (char.blessed ?? 0) > 0 ? 1.25 : 1);
}

/** Whether a cell is a pit a creature would fall into: Levitation keeps one up. */
export const wouldFall = (ctx: Ctx, char: Char, cell: number): boolean => hasFlag(ctx.level.map[cell]!, F.PIT) && !flies(char);
