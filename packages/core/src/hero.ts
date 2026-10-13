import { type Hero, heroRings, isAlive, type Mob, type MobKind } from './actors';
import { mightHTMultiplier } from './rings';
import { hungerPaused, mightOnLevelUp } from './buffs';
import { SALT_CUBE, trinketLevel } from './trinkets';
import { hurt } from './combat';
import { type Ctx, exploredCells, heroView } from './floor';
import { heroGainsExp } from './ident';
import { wandsGainExp } from './wands';
import { isBossDepth } from './level/builder';
import { cellX, cellY, HEIGHT, WIDTH } from './level/geometry';
import { discover, F, hasFlag, T } from './level/terrain';
import { sealShieldTick } from './seal';
import type { World } from './world';
import { artifactsAct, artifactsGainExp, chaliceRegenDelay, talismanBlinds, talismanFound } from './artifacts';

/*
 * The hero's own rules as Shattered Pixel Dungeon has them (Hero, Hunger,
 * Regeneration, LockedFloor): health and its growth with the levels, the
 * experience curve and what each level brings, hunger and starving, the slow
 * healing of wounds, a boss's sealed floor, searching, and the enemies the
 * hero sees (the danger indicator's list).
 */

/* Health and levels */

/** Hero.MAX_LEVEL. */
export const MAX_LEVEL = 30;
/** Bless.DURATION. */
export const BLESS_DURATION = 30;

/** Hero.updateHT's formula: 20 health, five more a level, and whatever potions of might added (HTBoost). */
export const heroHT = (hero: Hero): number => 20 + 5 * (hero.lvl - 1) + (hero.htBoost ?? 0);

/**
 * Hero.updateHT, as the change it makes when the level or the boost goes up by `amount` of health:
 * boosted, the new health is gained too. (Applied as a change, so a hero's health stays whatever it was
 * set to otherwise: the tests' sturdy heroes.)
 */
export function growHT(hero: Hero, amount: number, boostHP: boolean): void {
  // With rings of might worn, Hero.updateHT itself: the base health times their multiplier.
  if (heroRings(hero).some((ring) => ring.kind === 'ring.might')) {
    refreshMightHT(hero, boostHP);
    return;
  }
  hero.ht += amount;
  if (boostHP) hero.hp += Math.max(amount, 0);
  hero.hp = Math.min(hero.hp, hero.ht);
}

/** Hero.updateHT with rings of might: twenty, five a level and the boosts, times RingOfMight.HTMultiplier. */
export function refreshMightHT(hero: Hero, boostHP: boolean): void {
  const before = hero.ht;
  hero.ht = Math.round(mightHTMultiplier(hero) * heroHT(hero));
  if (boostHP) hero.hp += Math.max(hero.ht - before, 0);
  hero.hp = Math.min(hero.hp, hero.ht);
}

/** Hero.maxExp: what the next level costs. */
export const maxExpFor = (lvl: number): number => 5 + lvl * 5;

/**
 * Hero.earnExp: experience towards the next level; every item learns from it
 * (Item.onHeroGainExp: identification by use, see ident.ts). Each level gives
 * five health (gained at once), and a point of accuracy and of evasion; at
 * the cap, experience only makes room for more.
 */
export function earnExp(ctx: Ctx, hero: Hero, exp: number, source?: 'potion'): void {
  // (Pixel Dungeon's warlock fed on the slain here; Shattered's marks souls with the staff instead: wands.ts wandProc.)
  hero.exp += exp;
  const percent = Math.fround(exp / maxExpFor(hero.lvl));
  ctx.effects.push({ type: 'exp', hero: hero.id, amount: exp });
  // Hero.earnExp: the artifacts that charge with experience get their share of a level (a potion's too).
  artifactsGainExp(ctx, hero, percent);
  // Hero.earnExp: a potion of experience teaches the items nothing.
  if (source !== 'potion') {
    heroGainsExp(ctx, hero, percent);
    // Wand.onHeroGainExp: the wands not yet known may count more zaps towards knowing them.
    wandsGainExp(hero, percent);
  }
  let levelUp = false;
  while (hero.exp >= maxExpFor(hero.lvl)) {
    hero.exp -= maxExpFor(hero.lvl);
    if (hero.lvl < MAX_LEVEL) {
      hero.lvl++;
      levelUp = true;
      growHT(hero, 5, true);
      hero.attackSkill++;
      hero.defenseSkill++;
    } else {
      // At the cap: no stronger, but a surge of power (Buff.prolong(Bless, Bless.DURATION)).
      hero.exp = 0;
      hero.blessed = Math.max(hero.blessed ?? 0, BLESS_DURATION);
      ctx.effects.push({ type: 'levelCap', hero: hero.id });
    }
  }
  if (levelUp) {
    ctx.effects.push({ type: 'levelUp', hero: hero.id, lvl: hero.lvl });
    // ElixirOfMight.HTBoost.onLevelUp.
    mightOnLevelUp(hero);
  }
}

/* Hunger */

/** Hunger.HUNGRY and STARVING. */
export const HUNGRY = 300;
export const STARVING = 450;

export const isStarving = (hero: Hero): boolean => hero.hunger >= STARVING;
export const isHungry = (hero: Hero): boolean => hero.hunger >= HUNGRY;

/**
 * Hunger.act, a turn's worth: hunger grows by one (Pixel Dungeon's ring of satiety, while it is still
 * found, takes a tenth a level off that); once starving, health drains instead, a thousandth of the
 * hero's maximum a turn. Nothing of it while a boss has sealed the floor.
 */
function hungerTurn(ctx: Ctx, hero: Hero): void {
  // Hunger.act: none while well fed (a meat pie) or inside a challenge arena either.
  if (floorLocked(ctx.world, hero.depth) || hungerPaused(hero)) return;
  if (isStarving(hero)) {
    hero.starve = (hero.starve ?? 0) + hero.ht / 1000;
    if (hero.starve > 1) {
      const damage = Math.trunc(hero.starve);
      hero.starve -= damage;
      ctx.effects.push({ type: 'hurt', depth: hero.depth, who: hero.id, damage });
      hurt(ctx, hero, damage, 'hunger');
    }
    return;
  }
  // SaltCube.hungerGainMultiplier: a salt cube makes hunger grow slower.
  const level = hero.hunger + SALT_CUBE.hungerGainMultiplier(trinketLevel(hero, 'trinket.saltCube'));
  if (level >= STARVING) {
    // Hunger.act: the moment starving begins hurts.
    hero.hunger = STARVING;
    ctx.effects.push({ type: 'hunger', hero: hero.id, state: 'starving' });
    ctx.effects.push({ type: 'hurt', depth: hero.depth, who: hero.id, damage: 1 });
    hurt(ctx, hero, 1, 'hunger');
    return;
  }
  if (level >= HUNGRY && hero.hunger < HUNGRY) ctx.effects.push({ type: 'hunger', hero: hero.id, state: 'hungry' });
  hero.hunger = Math.max(0, level);
}

/**
 * Hunger.affectHunger: food takes hunger away (energy > 0), effort adds to it (energy < 0); more than
 * starving spills over into starvation's damage.
 */
export function affectHunger(ctx: Ctx, hero: Hero, energy: number): void {
  const old = hero.hunger;
  hero.hunger -= energy;
  if (hero.hunger < 0) {
    hero.hunger = 0;
  } else if (hero.hunger > STARVING) {
    const excess = hero.hunger - STARVING;
    hero.hunger = STARVING;
    hero.starve = (hero.starve ?? 0) + excess * (hero.ht / 1000);
    if (hero.starve > 1) {
      const damage = Math.trunc(hero.starve);
      hero.starve -= damage;
      ctx.effects.push({ type: 'hurt', depth: hero.depth, who: hero.id, damage });
      hurt(ctx, hero, damage, 'hunger');
    }
  }
  if (old < HUNGRY && hero.hunger >= HUNGRY && hero.hunger < STARVING) {
    ctx.effects.push({ type: 'hunger', hero: hero.id, state: 'hungry' });
  } else if (old < STARVING && hero.hunger >= STARVING) {
    ctx.effects.push({ type: 'hunger', hero: hero.id, state: 'starving' });
    ctx.effects.push({ type: 'hurt', depth: hero.depth, who: hero.id, damage: 1 });
    hurt(ctx, hero, 1, 'hunger');
  }
}

/* Regeneration */

/** Regeneration.REGENERATION_DELAY: a point of health every ten turns. */
export const REGENERATION_DELAY = 10;

/**
 * Regeneration.act, a turn's worth: wounds close a little, unless the hero is starving or a sealed
 * floor's boss has been left alone too long. Pixel Dungeon's ring of mending, while it is still
 * found, makes it quicker.
 */
function regenerationTurn(ctx: Ctx, hero: Hero): void {
  if (!regenOn(ctx.world, hero) || hero.hp >= hero.ht || isStarving(hero)) return;
  // The chalice of blood worn quickens it (cursed, slows it); a salt cube slows it (SaltCube.healthRegenMultiplier).
  const delay = chaliceRegenDelay(hero, REGENERATION_DELAY) / SALT_CUBE.healthRegenMultiplier(trinketLevel(hero, 'trinket.saltCube'));
  hero.regen = Math.fround(hero.regen + Math.fround(1 / delay));
  if (hero.regen >= 1) {
    const heal = Math.trunc(hero.regen);
    hero.hp = Math.min(hero.ht, hero.hp + heal);
    hero.regen -= heal;
  }
}

/* A boss's sealed floor (LockedFloor) */

/**
 * Level.locked: a boss's floor is sealed while its fight is on (the bosses' levels seal and unseal it:
 * bosses/*.ts).
 */
export function floorLocked(world: World, depth: number): boolean {
  if (!isBossDepth(depth) || world.arena) return false;
  return world.floors[depth]?.boss?.locked === true;
}

/** LockedFloor.left: passive healing goes on for this many turns of a boss fight, more as the boss is hurt. */
const LOCKED_TURNS = 50;

/** LockedFloor.act, a turn's worth: the time left for passive effects runs out. */
function lockedFloorTurn(ctx: Ctx, hero: Hero): void {
  if (!floorLocked(ctx.world, hero.depth)) {
    delete hero.lockedFloor;
    return;
  }
  hero.lockedFloor ??= LOCKED_TURNS;
  if (hero.lockedFloor >= 1) hero.lockedFloor--;
}

/** Regeneration.regenOn: off once a sealed floor's time has run out. */
export const regenOn = (world: World, hero: Hero): boolean => (hero.lockedFloor ?? LOCKED_TURNS) >= 1 || !floorLocked(world, hero.depth);

/**
 * LockedFloor.addTime, from Goo.damage, Tengu.damage, DM300.damage, Pylon.damage, DwarfKing.damage,
 * YogDzewa.damage and YogFist.damage: hurting the boss keeps passive healing going (50 turns at most),
 * by `factor` turns for every point of health it lost (each boss's own, without the stronger bosses'
 * challenge).
 */
export function bossHurt(ctx: Ctx, boss: Mob, damage: number, factor: number): void {
  if (damage <= 0) return;
  for (const hero of ctx.world.heroes) {
    if (hero.depth === ctx.depth && hero.lockedFloor !== undefined) hero.lockedFloor = Math.min(hero.lockedFloor + damage * factor, LOCKED_TURNS);
  }
  void boss;
}

/** LockedFloor.removeTime, from Goo.act: Goo healing in its water takes passive healing's time away. */
export function bossHealed(ctx: Ctx, time: number): void {
  for (const hero of ctx.world.heroes) {
    if (hero.depth === ctx.depth && hero.lockedFloor !== undefined) hero.lockedFloor = Math.max(0, hero.lockedFloor - time);
  }
}

/* Turns */

/**
 * The hero's buffs that act once a turn (Hunger, Regeneration, LockedFloor, the warrior's shield), for
 * every whole turn the hero's time crossed. Shattered's buffs keep the game's own clock; the hero here
 * spends time in uneven steps, so each turn boundary passed counts once.
 */
export function heroTurns(ctx: Ctx, hero: Hero, from: number, to: number): number {
  let lost = 0;
  for (let turns = Math.floor(to) - Math.floor(from); turns > 0 && isAlive(hero); turns--) {
    // Regeneration acts right after the hero (HERO_PRIO - 1), before the rest.
    regenerationTurn(ctx, hero);
    lockedFloorTurn(ctx, hero);
    hungerTurn(ctx, hero);
    sealShieldTick(ctx, hero);
    // The artifacts' buffs (Artifact.ArtifactBuff), on the hero's own depth; the time a cursed hourglass steals.
    if (hero.depth === ctx.depth) lost += artifactsAct(ctx, hero);
    // timeStasis.detach: back in time.
    if ((hero.stasis ?? 0) > 0 && --hero.stasis! <= 0) {
      delete hero.stasis;
      ctx.effects.push({ type: 'stasis', hero: hero.id, on: false });
    }
  }
  return lost;
}

/* Searching (Hero.search) */

/** Hero.TIME_TO_SEARCH, and the hunger a search costs over the time it takes (HUNGER_FOR_SEARCH). */
export const TIME_TO_SEARCH = 2;
const HUNGER_FOR_SEARCH = 6;

/**
 * Hero.search: secret doors and traps in sight around the hero, a cell away (two for the rogue,
 * who detects secrets from further), are found for sure by a deliberate search, and noticed now
 * and then in passing after every step: a trap 40% of the time (less the deeper), a door 20% (down
 * to none by depth 20). A search is tiring: it costs hunger. True if something was found in sight.
 */
export function search(ctx: Ctx, hero: Hero, intentional: boolean): boolean {
  if (!isAlive(hero)) return false;
  // Pixel Dungeon's ring of detection, while it is still found, widens it.
  const distance = hero.heroClass === 'rogue' ? 2 : 1;
  const fov = heroView(ctx.world, hero);
  const cx = cellX(hero.pos);
  const cy = cellY(hero.pos);
  let found = false;
  for (let y = Math.max(cy - distance, 0); y <= Math.min(cy + distance, HEIGHT - 1); y++) {
    for (let x = Math.max(cx - distance, 0); x <= Math.min(cx + distance, WIDTH - 1); x++) {
      const p = x + y * WIDTH;
      if (!fov[p] || p === hero.pos) continue;
      if (hasFlag(ctx.level.map[p]!, F.SECRET)) {
        // A cursed talisman worn lets nothing be noticed in passing.
        const chance = intentional ? 1 : talismanBlinds(hero) ? 0 : ctx.level.map[p] === T.SECRET_DOOR ? 0.2 - hero.depth / 100 : 0.4 - hero.depth / 250;
        if (ctx.rng.float() < chance) {
          // Foresight.charge: a find charges the talisman, a door more than a trap.
          talismanFound(hero, ctx.level.map[p] === T.SECRET_DOOR);
          ctx.level.map[p] = discover(ctx.level.map[p]!);
          exploredCells(ctx.world, hero.depth)[p] = true;
          ctx.effects.push({ type: 'discovered', depth: hero.depth, cell: p });
          found = true;
        }
      }
      // Only a deliberate search turns up what lies hidden (the phantom fish).
      const hidden = intentional ? ctx.floor.heaps.find((heap) => heap.pos === p && heap.kind === 'hidden') : undefined;
      if (hidden) {
        hidden.kind = 'heap';
        ctx.effects.push({ type: 'opened', depth: hero.depth, pos: p, heap: 'hidden' });
        found = true;
      }
    }
  }
  if (intentional) {
    ctx.effects.push({ type: 'searched', hero: hero.id });
    // Searching works up an appetite, unless a boss has sealed the floor.
    if (!floorLocked(ctx.world, hero.depth)) affectHunger(ctx, hero, TIME_TO_SEARCH - HUNGER_FOR_SEARCH);
  }
  if (found) ctx.effects.push({ type: 'noticedSecret', hero: hero.id });
  return found;
}

/* The danger indicator */

/**
 * Hero.checkVisibleMobs: the enemies the hero sees (DangerIndicator counts them and steps through
 * them), in the level's order. The sad ghost, shopkeepers, quest givers and allies are no enemies.
 */
export function visibleEnemies(world: World, hero: Hero): Mob[] {
  const fov = heroView(world, hero);
  return (world.floors[hero.depth]?.mobs ?? []).filter((mob) => fov[mob.pos] && isAlive(mob) && isEnemy(mob));
}

/**
 * Mob.alignment == ENEMY: not passive (the ghost, keepers, quest givers, the bee and the images) and not charmed into an ally,
 * nor one of the hero's allies (a ward, the earthen guardian, the lotus, a corrupted monster: Char.Alignment.ALLY).
 */
export const isEnemy = (mob: Mob): boolean => mob.state !== 'passive' && mob.kind !== 'mirror' && !mob.ally;
