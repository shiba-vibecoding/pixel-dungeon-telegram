import { createMob, type Hero, heroAttackSkill, heroDamageRoll, isAlive, type Mob, mobStats } from './actors';
import { dropMobLoot, earnExp } from './combat';
import { canEnter, charAt, type Ctx, enterCell, heroView, isPassable } from './floor';
import { cellX, cellY, distance, NEIGHBOURS8 } from './level/geometry';

/*
 * Mirror images (MirrorImage): illusory twins of a hero, from a scroll of
 * mirror image or armour of multiplicity. Each goes for the nearest monster
 * in sight with its hero's skill and strength, and vanishes once it has
 * struck. Monsters pay them no heed, and nothing can harm them; a hero
 * walking into one swaps places with it.
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
  mob.ally = hero.id;
  mob.state = 'wandering';
  mob.enemy = null;
  mob.target = hero.pos;
  for (const key of ['terror', 'terrorOf', 'charmed', 'charmedBy', 'amok', 'rage', 'beeFoe'] as const) delete mob[key];
  ctx.effects.push({ type: 'enthralled', depth: ctx.depth, mob: mob.id, hero: hero.id });
  if (!wasEnemy) return;
  dropMobLoot(ctx, mob);
  const stats = mobStats(mob);
  if (stats.exp > 0 && hero.lvl <= stats.maxLvl) earnExp(ctx, hero, stats.exp);
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
      image.ally = hero.id;
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
