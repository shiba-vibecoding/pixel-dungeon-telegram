import { createMob, type Hero, isAlive, type Mob, type MobKind } from '../actors';
import { hurt } from '../combat';
import type { Ctx, Floor } from '../floor';
import { type Item, ItemGenerator, rollSpec } from '../items';
import type { ItemSpec } from '../level/builder';
import type { Level } from '../level/generate';
import { WIDTH } from '../level/geometry';
import type { Rng } from '../rng';
import type { World } from '../world';
import { BOSS_KINDS, bossFloor, isFist, nextTimed, removeTimed, schedule } from './common';
import { GOO } from './goo';
import { bombTurn, fireTurn, prisonOccupy, shockerTurn, TENGU, tenguBlobsTurn, tenguDartTrap, tenguTimed } from './tengu';
import { cavesOccupy, cavesPylons, DM300, energyTurn, PYLON, rocksTurn, rollPylonArcs, ventTurn } from './dm300';
import { cityOccupy, GHOUL, KING, linking, shareLinkedDamage, subjectDied, summoningTurn } from './king';
import { FISTS, hallsOccupy, LARVA, YOG } from './yog';
import type { BossRules } from './rules';
import type { Timed } from './state';

/*
 * The five boss fights wired into the rest of the rules: the hooks monsters,
 * combat and the world call (each boss's BossRules), the floor's clock of buffs
 * and blobs, a boss level's own monsters and what its cells set off when a
 * hero steps on them (Level.occupyCell).
 */

export { BOSS_KINDS, isFist } from './common';
export type { BossFloor, BossMob, PrisonState, Timed } from './state';
export { tenguDartTrap };
export { OOZE_TURNS, applyOoze, oozeTurn } from './goo';

const RULES: Partial<Record<MobKind, BossRules>> = {
  goo: GOO,
  tengu: TENGU,
  dm300: DM300,
  pylon: PYLON,
  king: KING,
  ghoul: GHOUL,
  yog: YOG,
  larva: LARVA,
  ...FISTS,
};

/** A monster's boss rules, if it has any. */
export const bossRules = (mob: Mob): BossRules | undefined => RULES[mob.kind];

/** Whether a monster is immune to a condition (Char.isImmune) by its boss rules. */
export const bossImmune = (mob: Mob, what: string): boolean => RULES[mob.kind]?.immune?.has(what) === true;

/** Level.occupyCell on a boss's level: a hero stepping somewhere may move the fight on. */
export function bossOccupy(ctx: Ctx, hero: Hero): void {
  if (ctx.world.arena) return;
  switch (ctx.depth) {
    case 10:
      prisonOccupy(ctx, hero);
      return;
    case 15:
      cavesOccupy(ctx, hero);
      return;
    case 20:
      cityOccupy(ctx, hero);
      return;
    case 25:
      hallsOccupy(ctx, hero);
      return;
  }
}

/** Char.damage for a monster with boss rules, before health is lost: what gets through, or null for nothing. */
export function bossBeforeDamage(ctx: Ctx, mob: Mob, damage: number, source: Parameters<NonNullable<BossRules['beforeDamage']>>[3]): number | null {
  // LifeLink: the blow is shared out among those linked.
  if (source !== 'link' && !linking) damage = shareLinkedDamage(ctx, mob, damage);
  const rules = RULES[mob.kind];
  return rules?.beforeDamage ? rules.beforeDamage(ctx, mob, damage, source) : damage;
}

/** Char.damage for a monster with boss rules, after health was lost. */
export function bossAfterDamage(ctx: Ctx, mob: Mob, before: number, source: Parameters<NonNullable<BossRules['afterDamage']>>[3]): void {
  RULES[mob.kind]?.afterDamage?.(ctx, mob, before, source);
}

/** Char.isAlive overridden by a boss: it holds on at no health for now. */
export const bossHoldsOn = (ctx: Ctx, mob: Mob): boolean => RULES[mob.kind]?.holdsOn?.(ctx, mob) === true;

/** Mob.die for a monster with boss rules (and a subject of the King's breaking his shield). */
export function bossDied(ctx: Ctx, mob: Mob, by?: string): void {
  subjectDied(ctx, mob);
  // Its buffs and their effects go with it (Char.destroy), the lingering ones of a fight aside.
  const boss = ctx.floor.boss;
  if (boss) boss.timed = boss.timed.filter((t) => !('mob' in t && t.mob === mob.id) && !(t.kind === 'lifeLink' && (t.a === mob.id || t.b === mob.id)));
  RULES[mob.kind]?.die?.(ctx, mob, by);
  if (BOSS_KINDS.has(mob.kind)) ctx.effects.push({ type: 'bossSlain', depth: ctx.depth, kind: mob.kind });
}

/* The floor's clock */

/** The next of the fight's buffs and effects due on the floor, for the scheduler. */
export function nextBossTimed(floor: Floor): Timed | undefined {
  return nextTimed(floor);
}

/** A buff or delayed effect's turn. */
export function bossTimedTurn(ctx: Ctx, entry: Timed): void {
  switch (entry.kind) {
    case 'bomb':
      bombTurn(ctx, entry);
      return;
    case 'fire':
      fireTurn(ctx, entry);
      return;
    case 'shocker':
      shockerTurn(ctx, entry);
      return;
    case 'rocks':
      rocksTurn(ctx, entry);
      return;
    case 'vent':
      ventTurn(ctx, entry);
      return;
    case 'summoning':
      summoningTurn(ctx, entry);
      return;
    case 'jump':
    case 'progress':
      tenguTimed(ctx, entry);
      return;
    case 'lifeLink':
      removeTimed(ctx, entry);
      return;
    case 'deferred': {
      // Viscosity.DeferedDamage.act: a tenth of it (at least one), a turn at a time.
      const mob = ctx.floor.mobs.find((m) => m.id === entry.mob);
      if (!mob || !isAlive(mob)) {
        removeTimed(ctx, entry);
        return;
      }
      const damage = Math.max(1, Math.trunc(entry.damage * 0.1));
      entry.damage -= damage;
      entry.time += 1;
      if (entry.damage <= 0) removeTimed(ctx, entry);
      ctx.effects.push({ type: 'hurt', depth: ctx.depth, who: mob.id, damage });
      hurt(ctx, mob, damage, 'deferred');
      return;
    }
    case 'barrier': {
      // Barrier.act: it fades a point at a time, the faster the less is left (the King's holds).
      const mob = ctx.floor.mobs.find((m) => m.id === entry.mob);
      if (!mob || (mob.shield ?? 0) <= 0) {
        removeTimed(ctx, entry);
        if (mob) delete mob.shield;
        return;
      }
      if (!entry.holds) {
        entry.partial = Math.fround(entry.partial + Math.min(1, mob.shield! / 20));
        if (entry.partial >= 1) {
          mob.shield! -= 1;
          entry.partial = 0;
        }
      }
      entry.time += 1;
      return;
    }
    case 'bleeding':
      removeTimed(ctx, entry);
      return;
    case 'blobs': {
      tenguBlobsTurn(ctx);
      energyTurn(ctx);
      const boss = bossFloor(ctx.floor);
      if (boss.fire?.length || boss.shock?.length || boss.energy?.length) entry.time += 1;
      else removeTimed(ctx, entry);
      return;
    }
  }
}

/* A boss level's monsters and things */

/**
 * The monsters a boss level starts with (its createMobs): Goo in its nest (and the Rat King next door),
 * DM-300's pylons. Tengu, DM-300, the King and Yog come with their fights.
 */
export function populateBoss(world: World, level: Level, rng: Rng, nextId: () => string): Mob[] {
  if (world.arena) return [];
  switch (level.depth) {
    case 5: {
      const room = level.boss?.gooRoom;
      if (!room) return [];
      // GooBossRoom: Goo in the middle of its room, asleep.
      const pos = Math.trunc((room.left + room.right) / 2) + Math.trunc((room.top + room.bottom) / 2) * WIDTH;
      const goo = createMob(nextId(), 'goo', pos, 'sleeping', 0);
      goo.boss = { pumpedUp: 0, healInc: 1 };
      return level.ratKing === undefined ? [goo] : [goo, createMob(nextId(), 'ratKing', level.ratKing, 'passive', 0)];
    }
    case 15: {
      const pylons = cavesPylons(nextId);
      rollPylonArcs(pylons, rng);
      return pylons;
    }
    default:
      return [];
  }
}

/**
 * What a boss level's floor keeps from the start: the imp's wares on the King's level (ImpShopRoom.paint
 * decides them as the level is made; they are laid out when his shop opens).
 */
export function bossFloorCreated(level: Level, floor: Floor, rng: Rng): void {
  if (level.depth !== 20 || !level.boss?.impShop) return;
  const generator = new ItemGenerator(rng, level.depth);
  bossFloor(floor).impWares = IMP_WARES(rng).map((spec) => rollSpec(spec, generator, rng, level.depth));
}

/**
 * ShopRoom.generateItems for the imp's shop below the throne room. SEAM(levels/gear): Shattered's shop
 * list (its gear by depth, a bag, bombs, a stone of augmentation...); the last shop's wares stand in.
 */
function IMP_WARES(rng: Rng): ItemSpec[] {
  const wares: ItemSpec[] = [
    { roll: 'kind', kind: rng.oneOf(['weapon.glaive', 'weapon.warHammer', 'armor.plate'] as const) },
    { roll: 'kind', kind: 'torch' },
    { roll: 'kind', kind: 'torch' },
    { roll: 'kind', kind: 'potion.healing' },
    { roll: 'category', categories: ['potion'], tries: 1 },
    { roll: 'category', categories: ['potion'], tries: 1 },
    { roll: 'category', categories: ['potion'], tries: 1 },
    { roll: 'kind', kind: 'scroll.identify' },
    { roll: 'kind', kind: 'scroll.removeCurse' },
    { roll: 'kind', kind: 'scroll.mapping' },
    { roll: 'category', categories: ['scroll'], tries: 1 },
    { roll: 'kind', kind: 'food.overpriced' },
    { roll: 'kind', kind: 'food.overpriced' },
    { roll: 'kind', kind: 'ankh' },
  ];
  rng.shuffle(wares);
  return wares;
}

/** Mob.beckon: false for those that never heed it (pylons, Yog). */
export const heedsBeckon = (mob: Mob): boolean => RULES[mob.kind]?.beckon !== false;

/** A summoned minion of a boss (Property.BOSS_MINION): no experience, no loot. */
export const isMinion = (mob: Mob): boolean => mob.minion === true || isFist(mob);

export type { Item };
void schedule;
