import { type Hero, type HeroClass, heroAttackDelay, isAlive, type Mob } from './actors';
import { ballistica } from './ai';
import { attack } from './combat';
import { canEnter, charAt, type Ctx, enterCell, heroView, isHero, isWater, leaveCell } from './floor';
import type { ItemKind } from './items';
import { identify } from './ident';
import { NEIGHBOURS8 } from './level/geometry';
import { immuneTo, trapAt, triggerTrap } from './traps';
import type { World } from './world';
import { S } from './spd-sprites';

/*
 * The armour kit and class armour (ArmorKit, ClassArmor and its four kinds).
 * The King of Dwarves leaves the kit; applied, it turns the armour worn into
 * the hero's class armour, as protective as before, which lends a special
 * ability at the cost of a third of the hero's health.
 */

export const CLASS_ARMOR_OF: Readonly<Record<HeroClass, ItemKind>> = {
  warrior: 'armor.warrior', mage: 'armor.mage', rogue: 'armor.rogue', huntress: 'armor.huntress', duelist: 'armor.duelist', cleric: 'armor.cleric',
};
export const CLASS_ARMOR: readonly ItemKind[] = Object.values(CLASS_ARMOR_OF);

/** ArmorKit.TIME_TO_UPGRADE; WarriorArmor.SHOCK_TIME; Roots of molten earth. */
export const TIME_TO_APPLY_KIT = 2;
const SHOCK_TURNS = 3;
const ROOTED_TURNS = 3;
const BURNING_TURNS = 8;

/**
 * ArmorKit.upgrade: the armour worn becomes the class armour, keeping its
 * level, glyph and curse; class armour hides nothing (ClassArmor: levelKnown
 * and cursedKnown).
 */
export function applyArmorKit(ctx: Ctx, hero: Hero, index: number): void {
  hero.items.splice(index, 1);
  const old = hero.armor;
  hero.armor = { ...old, kind: CLASS_ARMOR_OF[hero.heroClass], base: old.base ?? old.kind };
  identify(ctx.world, hero.armor);
  ctx.effects.push({ type: 'classArmor', hero: hero.id, item: hero.armor });
}

const wearsClassArmor = (hero: Hero): boolean => hero.armor.kind === CLASS_ARMOR_OF[hero.heroClass];

export function specialProblem(world: World, hero: Hero, target: number | undefined): string | null {
  if (!wearsClassArmor(hero)) return 'you wear no class armour';
  if (hero.hp < 3) return 'you are too weak for that';
  if (hero.heroClass === 'warrior') {
    return Number.isInteger(target) && target !== hero.pos && target! >= 0 ? null : 'choose where to leap';
  }
  if (hero.heroClass === 'rogue') {
    const level = world.levels[hero.depth]!;
    const ok = Number.isInteger(target) && heroView(world, hero)[target!] && canEnter(level, target!) && !charAt(world, hero.depth, target!);
    return ok ? null : 'choose a free place in sight to jump to';
  }
  if (hero.heroClass === 'huntress') {
    const seen = heroView(world, hero);
    const any = (world.floors[hero.depth]?.mobs ?? []).some((mob) => seen[mob.pos] && mob.state !== 'passive');
    return any ? null : 'there is no enemy in sight';
  }
  return null;
}

/** ClassArmor.doSpecial: the ability of the hero's class; a third of their health is the price. Returns the time it took. */
export function classSpecial(ctx: Ctx, hero: Hero, target: number | undefined): number {
  const { world, depth, level } = ctx;
  const seen = heroView(world, hero);
  const foes = (): Mob[] => ctx.floor.mobs.filter((mob) => seen[mob.pos] && mob.state !== 'passive' && isAlive(mob));
  const pay = (): void => {
    hero.hp -= Math.trunc(hero.hp / 3);
  };
  switch (hero.heroClass) {
    case 'warrior': {
      // Heroic leap: to the chosen spot (or just short of whoever stands there), stunning everyone around.
      const trace = ballistica(ctx, hero.pos, target!);
      let dest = trace.at(-1)!;
      if (charAt(world, depth, dest) && trace.length > 1) dest = trace[trace.length - 2]!;
      pay();
      ctx.effects.push({ type: 'special', hero: hero.id, ability: 'leap', from: hero.pos, to: dest });
      if (dest !== hero.pos) {
        leaveCell(world, level, depth, hero.pos);
        hero.pos = dest;
        enterCell(level, dest);
        if (trapAt(level.map[dest]!)) triggerTrap(ctx, hero, dest);
      }
      for (const n of NEIGHBOURS8) {
        const char = charAt(world, depth, hero.pos + n);
        if (char && !isHero(char) && char.state !== 'passive') char.paralysed = Math.max(char.paralysed ?? 0, SHOCK_TURNS);
      }
      return 1;
    }
    case 'mage': {
      // Molten earth: every enemy in sight is set alight, and held fast by the ground.
      pay();
      ctx.effects.push({ type: 'special', hero: hero.id, ability: 'moltenEarth', from: hero.pos, to: hero.pos });
      for (const mob of foes()) {
        if (!isWater(level.map[mob.pos]!) && !immuneTo(mob, 'burning')) mob.burning = Math.max(mob.burning ?? 0, BURNING_TURNS);
        mob.rooted = Math.max(mob.rooted ?? 0, ROOTED_TURNS);
      }
      return 1;
    }
    case 'rogue': {
      // Smoke bomb: whoever could see the rogue loses track of them, and the rogue is elsewhere.
      pay();
      ctx.effects.push({ type: 'special', hero: hero.id, ability: 'smokeBomb', from: hero.pos, to: target! });
      for (const mob of foes()) {
        mob.blind = Math.max(mob.blind ?? 0, 2);
        mob.state = 'wandering';
        mob.enemySeen = false;
        mob.target = -1;
      }
      leaveCell(world, level, depth, hero.pos);
      hero.pos = target!;
      enterCell(level, hero.pos);
      ctx.effects.push({ type: 'teleported', hero: hero.id });
      return 1;
    }
    case 'huntress': {
      // Spectral blades: one for every enemy in sight, striking as the huntress's own weapon would.
      const targets = foes();
      if (targets.length === 0) return 0;
      pay();
      ctx.effects.push({ type: 'special', hero: hero.id, ability: 'blades', from: hero.pos, to: hero.pos });
      for (const mob of targets) {
        ctx.effects.push({ type: 'missile', depth, from: hero.pos, to: mob.pos, sprite: S.SHURIKEN });
        if (isAlive(mob)) attack(ctx, hero, mob);
      }
      return heroAttackDelay(hero);
    }
    case 'duelist':
    case 'cleric':
      // SEAM(classes): the duelist's and the cleric's abilities (classes/) come in the next commits.
      return 0;
  }
}
