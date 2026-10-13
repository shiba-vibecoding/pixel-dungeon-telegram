import { createMob, type Hero, heroAttackSkill, heroDamageRoll, isAlive, type Mob } from './actors';
import { ballistica, MAGIC_BOLT } from './ballistica';
import { hurt, lootAndExp } from './combat';
import { canEnter, charAt, type Char, type Ctx, enterCell, heroesOn, heroView, isHero, isPassable, leaveCell } from './floor';
import { cellX, cellY, distance, NEIGHBOURS8 } from './level/geometry';
import { hasProp } from './props';
import { addRockArmor, heldWands, wandProc } from './wands';
import type { World } from './world';

/*
 * Who fights beside the heroes.
 *
 * Mirror images (MirrorImage): illusory twins of a hero, from a scroll of
 * mirror image or armour of multiplicity. Each goes for the nearest monster
 * in sight with its hero's skill and strength, and vanishes once it has
 * struck. Monsters pay them no heed, and nothing can harm them; a hero
 * walking into one swaps places with it.
 *
 * Shattered's allies (Char.Alignment.ALLY, Mob.ally): the wand of warding's
 * wards and sentries, the wand of living earth's guardian, and monsters
 * corrupted by the wand of corruption. They pick their foes among the
 * monsters, and the monsters among them and the heroes (ai.ts chooseEnemy);
 * a hero walking into one swaps places with it (a ward can be dismissed).
 * The wand of regrowth's lotus is no ally but a harmless plant.
 */

/** MirrorImage.duplicate, placed on up to `count` free cells around the hero; returns where they appeared. */
export function conjureImages(ctx: Ctx, hero: Hero, count: number): number[] {
  const { world, depth, level, rng, floor } = ctx;
  const free = NEIGHBOURS8.map((n) => hero.pos + n).filter((cell) => canEnter(level, cell) && !charAt(world, depth, cell));
  const placed: number[] = [];
  while (placed.length < count && free.length > 0) {
    const pos = free.splice(rng.index(free.length), 1)[0]!;
    const image = createMob(`#${++world.nextId}`, 'mirror', pos, 'passive', floor.now + 1);
    image.image = { owner: hero.id, attack: heroAttackSkill(hero), damage: Math.max(1, heroDamageRoll(hero, rng)) };
    floor.mobs.push(image);
    enterCell(level, pos);
    placed.push(pos);
  }
  if (placed.length > 0) ctx.effects.push({ type: 'mirrored', depth, hero: hero.id, cells: placed });
  return placed;
}

/*
 * Allies (Char.Alignment.ALLY) from alchemy: a monster enthralled by a siren's song, and a prismatic image stepping
 * out of the hero's prismatic guard. They fight the monsters near their hero (ai.ts allyAct), and the monsters they
 * strike turn on them (Mob.aggro).
 */

/**
 * AllyBuff.affectAndLoot: the monster is the hero's ally from now on; as with a kill, the hero learns from it and
 * it drops what it would have dropped.
 */
export function enthrall(ctx: Ctx, mob: Mob, hero: Hero): void {
  const wasEnemy = !mob.ally;
  mob.ally = true;
  mob.owner = hero.id;
  mob.state = 'wandering';
  mob.enemy = null;
  mob.target = hero.pos;
  for (const key of ['terror', 'terrorOf', 'charmed', 'charmedBy', 'amok', 'rage', 'beeFoe'] as const) delete mob[key];
  ctx.effects.push({ type: 'enthralled', depth: ctx.depth, mob: mob.id, hero: hero.id });
  if (wasEnemy) lootAndExp(ctx, mob, hero);
}

/** PrismaticGuard.maxHP: half the hero's health, at their level. */
export const prismaticMaxHp = (hero: Hero): number => 10 + Math.floor(hero.lvl * 2.5);

/**
 * PrismaticGuard.act: once a monster that is after someone comes within four cells, the image steps out beside
 * the hero, between them and it, with the guard's health; meanwhile that health mends a tenth of a point a turn.
 */
export function prismaticGuard(ctx: Ctx, hero: Hero): void {
  const b = hero.buffs!;
  const fov = heroView(ctx.world, hero);
  let closest: Mob | undefined;
  for (const mob of ctx.floor.mobs) {
    if (!isAlive(mob) || mob.ally || mob.state !== 'hunting' || !fov[mob.pos]) continue;
    if (!closest || distance(hero.pos, mob.pos) < distance(hero.pos, closest.pos)) closest = mob;
  }
  if (closest && distance(hero.pos, closest.pos) < 5) {
    let best = -1;
    for (const n of NEIGHBOURS8) {
      const p = hero.pos + n;
      if (charAt(ctx.world, ctx.depth, p) || !isPassable(ctx.level, p)) continue;
      if (best === -1 || trueDistance(p, closest.pos) < trueDistance(best, closest.pos)) best = p;
    }
    if (best !== -1) {
      const image = createMob(`#${++ctx.world.nextId}`, 'prismatic', best, 'hunting', ctx.floor.now + 1);
      image.level = hero.lvl;
      image.ally = true;
      image.owner = hero.id;
      image.ht = prismaticMaxHp(hero);
      image.hp = Math.max(1, Math.floor(b.prismaticGuard!));
      image.enemy = closest.id;
      image.enemySeen = true;
      ctx.floor.mobs.push(image);
      enterCell(ctx.level, best);
      delete b.prismaticGuard;
      ctx.effects.push({ type: 'mirrored', depth: ctx.depth, hero: hero.id, cells: [best] });
      return;
    }
  }
  if (b.prismaticGuard! < prismaticMaxHp(hero)) b.prismaticGuard = Math.min(prismaticMaxHp(hero), b.prismaticGuard! + 0.1);
}

/** Level.trueDistance: as the crow flies. */
const trueDistance = (a: number, b: number): number => Math.hypot(cellX(a) - cellX(b), cellY(a) - cellY(b));

/** Whether a creature is on the heroes' side: a hero, or an ally. */
export const friendly = (char: Char): boolean => isHero(char) || char.ally === true;

/** Corruption.corruptionHeal: whole again, and rid of every ailment but a soul mark. */
export function corruptionHeal(mob: Mob): void {
  mob.hp = mob.ht;
  for (const key of [
    'poison', 'paralysed', 'burning', 'slowed', 'dizzy', 'terror', 'charmed', 'amok', 'rage', 'blind', 'rooted', 'crippled', 'bleeding',
    'chill', 'frozen', 'ooze', 'weakened', 'vulnerable', 'hexed', 'corrosion', 'doomed',
  ] as const) {
    delete mob[key];
  }
  delete mob.charmedBy;
  delete mob.terrorOf;
}

/* Wards (WandOfWarding.Ward) */

/** A ward appears where the wand's bolt landed: tier 1, shooting with the wand's level. */
export function spawnWard(ctx: Ctx, pos: number, level: number): Mob {
  const ward = createMob(`#${++ctx.world.nextId}`, 'ward', pos, 'wandering', ctx.floor.now + 1);
  ward.ally = true;
  ward.ward = { tier: 1, level, zaps: 0 };
  ctx.floor.mobs.push(ward);
  enterCell(ctx.level, pos);
  ctx.effects.push({ type: 'ally', depth: ctx.depth, mob: ward.id, event: 'warded' });
  return ward;
}

/**
 * WandOfWarding.tryToZap's measure: the tiers of the wards on the depth, and what the hero's wands
 * of warding can keep (two each, and one a level).
 */
export function wardEnergy(ctx: Ctx, hero: Hero): { current: number; max: number } {
  const current = ctx.floor.mobs.reduce((sum, mob) => sum + (mob.kind === 'ward' ? mob.ward?.tier ?? 1 : 0), 0);
  const max = heldWands(hero).reduce((sum, { wand, staff }) => sum + (wand.kind === 'wand.warding' ? 2 + (staff ?? wand).level : 0), 0);
  return { current, max };
}

/**
 * Ward.upgrade: a tier more (six at most). From the third tier on it is a sentry, much sturdier:
 * 35 health (less what its shots have cost it), then 54, then 84; at the sixth it is only mended.
 */
export function upgradeWard(ctx: Ctx, ward: Mob, level: number): void {
  const info = (ward.ward ??= { tier: 1, level, zaps: 0 });
  info.level = Math.max(info.level, level);
  switch (info.tier) {
    case 3:
      ward.ht = 35;
      ward.hp = 15 + (5 - info.zaps) * 4;
      break;
    case 4:
      ward.ht = 54;
      ward.hp += 19;
      break;
    case 5:
      ward.ht = 84;
      ward.hp += 30;
      break;
    case 6:
      allyWandHeal(ctx, ward, level, 1);
      break;
  }
  if (info.tier < 6) info.tier++;
  ctx.effects.push({ type: 'ally', depth: ctx.depth, mob: ward.id, event: 'upgraded' });
}

/**
 * Ward.wandHeal: a ward's shots given back (one, one or two), a sentry's health mended (9, 12, 16),
 * so many times over (`factor`).
 */
export function allyWandHeal(ctx: Ctx, ward: Mob, level: number, factor: number): void {
  const info = ward.ward;
  if (!info) return;
  info.level = Math.max(info.level, level);
  let heal: number;
  switch (info.tier) {
    case 2:
      heal = Math.round(1 * factor);
      break;
    case 3:
      heal = Math.round(ctx.rng.intRange(1, 2) * factor);
      break;
    case 4:
      heal = Math.round(9 * factor);
      break;
    case 5:
      heal = Math.round(12 * factor);
      break;
    case 6:
      heal = Math.round(16 * factor);
      break;
    default:
      return;
  }
  if (info.tier <= 3) info.zaps = Math.max(0, info.zaps - heal);
  else ward.hp = Math.min(ward.ht, ward.hp + heal);
  ctx.effects.push({ type: 'mobHealed', depth: ctx.depth, mob: ward.id, amount: heal });
}

/** Ward.canAttack: a clear magic bolt to its foe. */
export const wardCanAttack = (ctx: Ctx, ward: Mob, foe: Char): boolean => ballistica(ctx, ward.pos, foe.pos, MAGIC_BOLT).collisionPos === foe.pos;

/**
 * Ward.zap: a bolt that never misses, as the wand of warding's level allows; a ward is spent after
 * so many shots (1, 3, 5 by tier), a sentry pays for each with health (5, 6, 7).
 */
export function wardZap(ctx: Ctx, ward: Mob, foe: Char): void {
  const info = ward.ward ?? { tier: 1, level: 0, zaps: 0 };
  ward.time += 1;
  ctx.effects.push({ type: 'zapped', depth: ctx.depth, from: ward.pos, to: foe.pos, bolt: 'death' });
  const damage = ctx.rng.normalIntRange(2 + info.level, 8 + 4 * info.level);
  ctx.effects.push({ type: 'attack', depth: ctx.depth, attacker: ward.id, target: foe.id, hit: true, damage });
  hurt(ctx, foe, damage, ward);
  const owner = heroesOn(ctx.world, ctx.depth)[0];
  if (isAlive(foe) && owner) wandProc(ctx, owner, foe, info.level, 1);
  info.zaps++;
  if (info.tier <= 3) {
    if (info.zaps >= 2 * info.tier - 1) dismiss(ctx, ward);
  } else {
    const cost = info.tier === 4 ? 5 : info.tier === 5 ? 6 : 7;
    hurt(ctx, ward, cost, 'wand');
  }
}

/** Ward.die(null) and the like: an ally gone without a fight (a spent ward, a dismissed one, a guardian back to armour). */
export function dismiss(ctx: Ctx, mob: Mob): void {
  const index = ctx.floor.mobs.indexOf(mob);
  if (index < 0) return;
  ctx.floor.mobs.splice(index, 1);
  mob.hp = 0;
  leaveCell(ctx.world, ctx.level, ctx.depth, mob.pos);
  ctx.effects.push({ type: 'faded', depth: ctx.depth, mob: mob.id, pos: mob.pos });
}

/** Ward.interact: dismissing a ward the hero stands beside (WndOptions «dismiss»). */
export function dismissProblem(world: World, hero: Hero, target: string): string | null {
  const ward = world.floors[hero.depth]?.mobs.find((mob) => mob.id === target);
  if (!ward || ward.kind !== 'ward') return 'no such ward';
  return distance(ward.pos, hero.pos) <= 1 ? null : 'too far away';
}

/* The earth guardian (WandOfLivingEarth.EarthGuardian) */

export const findGuardian = (ctx: Ctx): Mob | undefined => ctx.floor.mobs.find((mob) => mob.kind === 'guardian' && isAlive(mob));

/** A guardian takes shape where the wand's bolt landed, as strong as the armour it is made of. */
export function placeGuardian(ctx: Ctx, hero: Hero, pos: number, level: number, armor: number): Mob {
  const guardian = createMob(`#${++ctx.world.nextId}`, 'guardian', pos, 'hunting', ctx.floor.now + 1);
  guardian.ally = true;
  guardian.hp = guardian.ht = 0;
  guardian.level = ctx.depth;
  guardianInfo(ctx, guardian, hero, level, armor, true);
  ctx.floor.mobs.push(guardian);
  enterCell(ctx.level, pos);
  ctx.effects.push({ type: 'ally', depth: ctx.depth, mob: guardian.id, event: 'guardian' });
  return guardian;
}

/**
 * EarthGuardian.setInfo: a stronger wand makes it sturdier (16 health and 8 more a level); the
 * health given mends it; its evasion is half the hero's.
 */
export function guardianInfo(ctx: Ctx, guardian: Mob, hero: Hero, level: number, health: number, fresh = false): void {
  const info = (guardian.guardian ??= { level: -1, defense: 0 });
  if (level > info.level) {
    info.level = level;
    guardian.ht = 16 + 8 * level;
  }
  const before = guardian.hp;
  guardian.hp = Math.min(guardian.ht, guardian.hp + health);
  info.defense = Math.trunc((hero.lvl + 4) / 2);
  if (!fresh && guardian.hp > before) ctx.effects.push({ type: 'mobHealed', depth: ctx.depth, mob: guardian.id, amount: guardian.hp - before });
}

/** EarthGuardian.Wandering: with no foe in sight, it crumbles back into the hero's armour, all its health with it. */
export function dissolveGuardian(ctx: Ctx, guardian: Mob): void {
  const hero = heroesOn(ctx.world, ctx.depth)[0];
  if (hero) addRockArmor(hero, guardian.guardian?.level ?? 0, guardian.hp);
  ctx.effects.push({ type: 'ally', depth: ctx.depth, mob: guardian.id, event: 'dissolved' });
  dismiss(ctx, guardian);
}

/** EarthGuardian.drRoll: the wand's level to three times it and three (to two more, without armour: NO_ARMOR). */
export function guardianArmor(ctx: Ctx, guardian: Mob, noArmor: boolean): number {
  const level = guardian.guardian?.level ?? 0;
  return noArmor ? ctx.rng.normalIntRange(level, 2 + level) : ctx.rng.normalIntRange(level, 3 + 3 * level);
}

/** Ward.drRoll: a sentry's armour, as the depth allows, the better the higher its tier. */
export function wardArmor(ctx: Ctx, ward: Mob): number {
  const tier = ward.ward?.tier ?? 1;
  if (tier <= 3) return 0;
  return Math.round(ctx.rng.normalIntRange(0, 3 + Math.trunc(ctx.depth / 2)) / (7 - tier));
}

/* The lotus (WandOfRegrowth.Lotus) */

/** A lotus grows where the regrowth's cone was aimed: it lasts 25 turns and three more a level. */
export function growLotus(ctx: Ctx, pos: number, level: number): void {
  const lotus = createMob(`#${++ctx.world.nextId}`, 'lotus', pos, 'passive', ctx.floor.now + 1);
  lotus.lotus = { level };
  lotus.hp = lotus.ht = 25 + 3 * level;
  ctx.floor.mobs.push(lotus);
  enterCell(ctx.level, pos);
  ctx.effects.push({ type: 'ally', depth: ctx.depth, mob: lotus.id, event: 'lotus' });
}

/** Lotus.act: it withers a little every turn, and is gone once spent. */
export function lotusAct(ctx: Ctx, lotus: Mob): void {
  lotus.time += 1;
  if (--lotus.hp <= 0) dismiss(ctx, lotus);
}

/** Lotus.seedPreservation: the chance a plant set off within its reach leaves its seed behind. */
export function seedPreservation(ctx: Ctx, pos: number): number {
  let chance = 0;
  for (const lotus of ctx.floor.mobs) {
    if (lotus.kind !== 'lotus' || !lotus.lotus) continue;
    const dx = cellX(lotus.pos) - cellX(pos);
    const dy = cellY(lotus.pos) - cellY(pos);
    if (Math.sqrt(dx * dx + dy * dy) <= lotus.lotus.level) chance = Math.max(chance, Math.min(1, 0.4 + 0.04 * lotus.lotus.level));
  }
  return chance;
}

/**
 * Mob.interact for an ally: a hero walking into it swaps places with it (not with what cannot move:
 * a ward, which can be dismissed instead).
 */
export function allySwaps(mob: Mob): boolean {
  return mob.ally === true && !hasProp(mob, 'immovable') && isAlive(mob);
}
