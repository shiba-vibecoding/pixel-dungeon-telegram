import { createMob, type Hero, isAlive, type Mob } from '../actors';
import { getCloser, spend } from '../ai';
import { attack, hurt } from '../combat';
import { canEnter, charAt, type Ctx, dropItem, enterCell, heroesOn, heroView, isHero, leaveCell } from '../floor';
import { collect, spawnWraith } from '../inventory';
import { type Item, itemDef } from '../items';
import { armorStats } from '../armor';
import { weaponStats } from '../weapons';
import { isBossDepth } from '../level/builder';
import { castShadow, terrainBlocksSight, viewDistance } from '../fov';
import { adjacent, distance, LENGTH, NEIGHBOURS8 } from '../level/geometry';
import { F, hasFlag } from '../level/terrain';
import { levelKnown } from '../ident';
import { CLASS_ARMOR } from '../classArmor';
import { Rng } from '../rng';
import type { World } from '../world';
import { artifactKnown, chargeCap, levelCap } from './artifact';
import { carriedOf, isWorn, say, upgradeArtifact } from './common';
import { dispelInvisibility } from './invisibility';
import { artifactChargeMultiplier, magicImmune, onArtifactUsed, regenOn } from './seams';

/*
 * DriedRose: the sad ghost's, whose spirit is bound to it. Once the ghost's
 * quest is done, a full rose worn calls the ghost back as a companion
 * (GhostHero, a DirectableAlly): it follows the hero from depth to depth,
 * fights what threatens them, and can be told to hold a place or go after a
 * foe. It can be given a melee weapon and armour it is strong enough for.
 * While the ghost is out the rose heals it instead of charging; with the
 * rose taken off, the ghost fades a point a turn. Petals found on the way
 * down make rose and ghost stronger. Cursed, the rose now and then raises a
 * wraith.
 */

/** Seam (levels stream): Ghost.Quest.completed — the sad ghost's quest done and its reward taken. */
export const ghostQuestDone = (world: World): boolean => world.quest?.done === true;

/** DriedRose.ghostStrength. */
export const ghostStrength = (rose: Item): number => 13 + Math.trunc(rose.level / 2);

/** The ghost of a rose, wherever it is. */
export function ghostOf(world: World, rose: Item): Mob | undefined {
  if (!rose.ghost) return undefined;
  for (const floor of Object.values(world.floors)) {
    const ghost = floor.mobs.find((mob) => mob.id === rose.ghost);
    if (ghost) return ghost;
  }
  return undefined;
}

/** The ghost's owner's rose: worn or carried. */
const roseOf = (hero: Hero | undefined): Item | undefined => (hero ? carriedOf(hero, 'artifact.rose') : undefined);

/** Spawn points next to a cell: free, and passable or avoided (DriedRose.execute(SUMMON)). */
function spawnPoints(ctx: Ctx, pos: number): number[] {
  return NEIGHBOURS8.map((n) => pos + n).filter((p) =>
    p >= 0 && p < LENGTH && !charAt(ctx.world, ctx.depth, p) && (hasFlag(ctx.level.map[p]!, F.PASSABLE) || hasFlag(ctx.level.map[p]!, F.AVOID)));
}

export function roseProblem(ctx: Ctx, hero: Hero, item: Item, use: string, gear: Item | undefined, choice: number | undefined): string | null {
  const { world } = ctx;
  switch (use) {
    case 'summon':
      if (magicImmune(hero)) return 'art:magic_immune';
      if (!ghostQuestDone(world)) return 'art:driedrose.desc_no_quest';
      if (ghostOf(world, item)) return 'art:driedrose.spawned';
      if (!isWorn(hero, item)) return 'art:artifact.need_to_equip';
      if ((item.charge ?? 0) !== chargeCap(item)) return 'art:driedrose.no_charge';
      if (item.cursed) return 'art:driedrose.cursed';
      return spawnPoints(ctx, hero.pos).length > 0 ? null : 'art:driedrose.no_space';
    case 'direct':
      return ghostOf(world, item)?.pos !== undefined && ghostOf(world, item)!.hp > 0 ? null : 'art:cannot';
    case 'outfit': {
      // Not a rose that is cursed or not known through and through (smuggling).
      if (!ghostQuestDone(world) || !artifactKnown(item) || item.cursed) return 'art:cannot';
      if (!gear) return 'art:cannot';
      const category = itemDef(gear.kind).category;
      if (category !== 'weapon' && category !== 'armor') return 'art:cannot';
      if (category === 'weapon' ? item.ghostWeapon : item.ghostArmor) return 'art:cannot';
      // WndGhostHero's selectors: nothing unique, nothing that may be cursed, nothing too heavy for the ghost.
      if (gear.kind === 'weapon.pickaxe' || CLASS_ARMOR.includes(gear.kind)) return 'art:driedrose$wndghosthero.cant_unique';
      if (gear.cursed || gear.curseUnknown) return 'art:driedrose$wndghosthero.cant_cursed';
      const str = (known: Item): number => (category === 'weapon' ? weaponStats(known).str : armorStats(known).str);
      if (!levelKnown(gear) && str({ ...gear, level: 0 }) > ghostStrength(item)) return 'art:driedrose$wndghosthero.cant_strength_unknown';
      if (str(gear) > ghostStrength(item)) return 'art:driedrose$wndghosthero.cant_strength';
      return null;
    }
    case 'unoutfit':
      return (choice === 0 ? item.ghostWeapon : choice === 1 ? item.ghostArmor : undefined) ? null : 'art:cannot';
    default:
      return 'art:cannot';
  }
}

/** DriedRose.execute(SUMMON): the ghost appears beside the hero, and the rose is empty. */
export function summonGhost(ctx: Ctx, hero: Hero, item: Item): number {
  const { world, level, floor, rng } = ctx;
  const pos = rng.element(spawnPoints(ctx, hero.pos))!;
  const ghost = createMob(`#${++world.nextId}`, 'ghostHero', pos, 'hunting', floor.now + 1);
  ghost.directed = { owner: hero.id, defend: -1, moving: false };
  ghost.ally = true;
  item.ghost = ghost.id;
  updateGhost(ghost, hero, item);
  ghost.hp = ghost.ht;
  ghost.enemySeen = true;
  floor.mobs.push(ghost);
  enterCell(level, pos);
  ctx.effects.push({ type: 'ghostSummoned', depth: ctx.depth, mob: ghost.id, pos });
  if (!item.firstSummon) {
    ghostSays(ctx, ghost, 'hello', [hero.name]);
    item.firstSummon = true;
  } else if (bossFight(ctx)) {
    sayBoss(ctx, ghost);
  } else {
    sayAppeared(ctx, ghost);
  }
  dispelInvisibility(ctx, hero);
  onArtifactUsed(ctx, hero);
  item.charge = 0;
  item.partial = 0;
  return 1;
}

/** BossHealthBar.isAssigned: a boss is fighting on this depth. */
const bossFight = (ctx: Ctx): boolean =>
  isBossDepth(ctx.depth) && ctx.floor.mobs.some((mob) => ['goo', 'tengu', 'dm300', 'king', 'yog'].includes(mob.kind));

/** A line the ghost says, by its message key under driedrose$ghosthero. */
export function ghostSays(ctx: Ctx, ghost: Mob, line: string, args?: Array<string | number>): void {
  ctx.effects.push({ type: 'ghostSays', depth: ctx.depth, mob: ghost.id, line, ...(args ? { args } : {}) });
}

/** GhostHero.sayAppeared: a line about the region (only the first three on a region's first depth). */
function sayAppeared(ctx: Ctx, ghost: Mob): void {
  const region = ['sewers', 'prison', 'caves', 'city', 'halls'][Math.min(4, Math.trunc((ctx.depth - 1) / 5))]!;
  const variant = ctx.depth % 5 === 1 ? ctx.rng.intRange(1, 3) : ctx.rng.intRange(1, 6);
  ghostSays(ctx, ghost, `dialogue_${region}_${variant}`);
}

/** GhostHero.sayBoss: a line about the boss of the region. */
export function sayBoss(ctx: Ctx, ghost: Mob): void {
  const boss = ['goo', 'tengu', 'dm300', 'king', 'yog'][Math.min(4, Math.trunc((ctx.depth - 1) / 5))]!;
  ghostSays(ctx, ghost, `seen_${boss}_${ctx.rng.intRange(1, 3)}`);
}

/** A boss noticed the party: the ghost, if it is there, says something about it (Goo.notice and the others). */
export function ghostSeesBoss(ctx: Ctx): void {
  for (const ghost of ctx.floor.mobs) if (ghost.kind === 'ghostHero' && isAlive(ghost)) sayBoss(ctx, ghost);
}

/** Hero.die and Hero's ankh: the ghost mourns, or marvels. */
export function ghostSeesHero(ctx: Ctx, hero: Hero, line: 'player_killed' | 'blessed_ankh'): void {
  for (const ghost of ctx.floor.mobs) {
    if (ghost.kind === 'ghostHero' && ghost.directed?.owner === hero.id) ghostSays(ctx, ghost, `${line}_${ctx.rng.intRange(1, 3)}`);
  }
}

/** DirectableAlly.directTocell: hold a place, follow the hero, or go after a foe in sight. */
export function directGhost(ctx: Ctx, hero: Hero, item: Item, cell: number): number {
  const ghost = ghostOf(ctx.world, item)!;
  const ally = ghost.directed!;
  const fov = heroView(ctx.world, hero);
  const there = cell >= 0 && cell < LENGTH ? charAt(ctx.world, ctx.depth, cell) : undefined;
  if (there === hero) {
    // followHero.
    ally.defend = -1;
    ally.moving = false;
    ghost.enemy = null;
    ghost.state = 'wandering';
    ghostSays(ctx, ghost, `directed_follow_${ctx.rng.intRange(1, 5)}`);
  } else if (fov[cell] && there && !isHero(there) && there.state !== 'passive' && there.kind !== 'ghostHero' && there.kind !== 'mirror' && there.kind !== 'bee') {
    // targetChar.
    ally.defend = -1;
    ally.moving = false;
    ghost.enemy = there.id;
    ghost.state = 'hunting';
    ghost.target = there.pos;
    ghostSays(ctx, ghost, `directed_attack_${ctx.rng.intRange(1, 5)}`);
  } else {
    // defendPos.
    ally.defend = cell;
    ally.moving = true;
    ghost.enemy = null;
    ghost.state = 'wandering';
    ghostSays(ctx, ghost, `directed_position_${ctx.rng.intRange(1, 5)}`);
  }
  return 0;
}

/** WndGhostHero: a weapon or armour from the pack for the ghost to use. */
export function outfitGhost(ctx: Ctx, hero: Hero, item: Item, index: number): number {
  const gear = hero.items.splice(index, 1)[0]!;
  if (itemDef(gear.kind).category === 'weapon') item.ghostWeapon = gear;
  else item.ghostArmor = gear;
  const ghost = ghostOf(ctx.world, item);
  if (ghost) updateGhost(ghost, hero, item);
  return 0;
}

/** WndGhostHero: the ghost's weapon (0) or armour (1) back into the pack, or at the hero's feet. */
export function unoutfitGhost(ctx: Ctx, hero: Hero, item: Item, choice: number): number {
  const gear = (choice === 0 ? item.ghostWeapon : item.ghostArmor)!;
  if (choice === 0) delete item.ghostWeapon;
  else delete item.ghostArmor;
  if (!collect(hero, gear)) dropItem(ctx.floor, hero.pos, gear);
  const ghost = ghostOf(ctx.world, item);
  if (ghost) updateGhost(ghost, hero, item);
  return 0;
}

/** GhostHero.updateRose: as tough as the rose, as nimble and as accurate as the hero, armed with its gear. */
export function updateGhost(ghost: Mob, hero: Hero, rose: Item): void {
  ghost.ht = 40 + 10 * rose.level;
  ghost.ghostGear = {
    lvl: hero.lvl, str: ghostStrength(rose),
    ...(rose.ghostWeapon ? { weapon: rose.ghostWeapon } : {}), ...(rose.ghostArmor ? { armor: rose.ghostArmor } : {}),
  };
}

/** roseRecharge.act: the rose heals the ghost while it is out (to full in 500 turns), else fills (in 500); cursed, a wraith now and then. */
export function roseAct(ctx: Ctx, hero: Hero, item: Item): void {
  let ghost = ghostOf(ctx.world, item);
  if (item.ghost && (!ghost || !isAlive(ghost))) {
    ghostGone(item);
    ghost = undefined;
  }
  if (ghost && !item.cursed && !magicImmune(hero)) {
    if (ghost.hp < ghost.ht && regenOn(ctx, hero)) {
      item.partial = (item.partial ?? 0) + (ghost.ht / 500) * artifactChargeMultiplier(hero);
      while (item.partial > 1) {
        ghost.hp++;
        item.partial--;
        if (ghost.hp === ghost.ht) item.partial = 0;
      }
    } else {
      item.partial = 0;
    }
    return;
  }
  const cap = chargeCap(item);
  if ((item.charge ?? 0) < cap && !item.cursed && !magicImmune(hero) && regenOn(ctx, hero)) {
    item.partial = (item.partial ?? 0) + (1 / 5) * artifactChargeMultiplier(hero);
    while (item.partial > 1) {
      item.charge = (item.charge ?? 0) + 1;
      item.partial--;
      if (item.charge === cap) {
        item.partial = 0;
        say(ctx, hero, 'driedrose.charged', 'p');
      }
    }
  } else if (item.cursed && ctx.rng.int(100) === 0) {
    const points = spawnPoints(ctx, hero.pos);
    if (points.length > 0 && spawnWraith(ctx, ctx.rng.element(points)!)) ctx.effects.push({ type: 'wraiths', depth: ctx.depth, pos: hero.pos });
  }
}

/** DriedRose.charge: four times the boost while the ghost is away; while it is out, health for it. */
export function chargeRose(ctx: Ctx, hero: Hero, item: Item, amount: number): void {
  if (item.cursed || magicImmune(hero)) return;
  const ghost = ghostOf(ctx.world, item);
  if (!ghost) {
    const cap = chargeCap(item);
    if ((item.charge ?? 0) >= cap) return;
    item.partial = (item.partial ?? 0) + 4 * amount;
    while (item.partial >= 1) {
      item.charge = (item.charge ?? 0) + 1;
      item.partial--;
    }
    if (item.charge! >= cap) {
      item.charge = cap;
      item.partial = 0;
      say(ctx, hero, 'driedrose.charged', 'p');
    }
  } else if (ghost.hp < ghost.ht) {
    const heal = Math.round((1 + item.level / 3) * amount);
    ghost.hp = Math.min(ghost.ht, ghost.hp + heal);
  }
}

/** GhostHero.destroy: the rose is empty again. */
export function ghostGone(rose: Item): void {
  delete rose.ghost;
  rose.charge = 0;
  rose.partial = 0;
}

/** GhostHero.die: it says its farewell, and its rose empties. */
export function ghostDied(ctx: Ctx, ghost: Mob): void {
  ghostSays(ctx, ghost, `${bossFight(ctx) ? 'defeated_by_boss' : 'defeated_by_enemy'}_${ctx.rng.intRange(1, 3)}`);
  const owner = ctx.world.heroes.find((hero) => hero.id === ghost.directed?.owner);
  const rose = roseOf(owner);
  if (rose?.ghost === ghost.id) ghostGone(rose);
}

/** Hostile, for the ghost: a monster that fights (not the neutral folk, nor the heroes' allies). */
const hostile = (mob: Mob): boolean =>
  isAlive(mob) && mob.state !== 'passive' && !mob.ally && mob.kind !== 'ghostHero' && mob.kind !== 'mirror' && mob.kind !== 'bee' &&
  mob.kind !== 'sheep' && mob.kind !== 'lotus';

/**
 * GhostHero.act and DirectableAlly's ways: without its rose worn it fades a point a turn; wandering, it
 * keeps by the hero (twice as fast when they are apart) or goes to hold its place, and turns on a foe
 * in sight; hunting, it goes for its foe, leaving it for the place it holds if it cannot reach it.
 */
export function ghostAct(ctx: Ctx, ghost: Mob): void {
  const { world, depth } = ctx;
  const ally = ghost.directed!;
  const hero = world.heroes.find((h) => h.id === ally.owner);
  const rose = roseOf(hero);
  if (hero && rose) updateGhost(ghost, hero, rose);
  if (!hero || !rose || !isWorn(hero, rose) || rose.ghost !== ghost.id || magicImmune(hero)) {
    // NoRoseDamage: no armour stops it.
    hurt(ctx, ghost, 1, 'noRose');
    if (!isAlive(ghost)) return;
  }
  const fov = castShadow(ghost.pos, terrainBlocksSight(ctx.level.map), viewDistance(depth));
  const heroFov = hero && hero.depth === depth ? heroView(world, hero) : new Array<boolean>(LENGTH).fill(false);
  // Mob.chooseEnemy for an intelligent ally: its foe while it lives; else the nearest awake foe in sight.
  let enemy = ctx.floor.mobs.find((mob) => mob.id === ghost.enemy && hostile(mob));
  if (!enemy || ghost.state === 'wandering') {
    const foes = ctx.floor.mobs.filter((mob) => hostile(mob) && fov[mob.pos] && mob.state !== 'sleeping' && mob.state !== 'wandering');
    enemy = foes.sort((a, b) => distance(ghost.pos, a.pos) - distance(ghost.pos, b.pos))[0] ?? (ghost.state === 'hunting' ? enemy : undefined);
    if (ally.moving) enemy = undefined;
    ghost.enemy = enemy?.id ?? null;
  }
  const enemyInFov = enemy !== undefined && fov[enemy.pos]!;
  const canAttack = (foe: Mob): boolean => adjacent(ghost.pos, foe.pos);
  if (ghost.state !== 'hunting') {
    // DirectableAlly.Wandering.
    if (enemy && enemyInFov && !ally.moving && (ally.defend === -1 || !heroFov[ally.defend] || canAttack(enemy))) {
      ghost.enemySeen = true;
      ghost.state = 'hunting';
      ghost.target = enemy.pos;
    } else {
      const target = ally.defend !== -1 ? ally.defend : hero && hero.depth === depth ? hero.pos : ghost.pos;
      // GhostHero.speed: twice as fast going back to the hero.
      const speed = ally.defend === -1 && hero && distance(ghost.pos, hero.pos) > 1 ? 2 : 1;
      if (target !== ghost.pos && !(target === hero?.pos && adjacent(ghost.pos, target)) && getCloser(ctx, ghost, target, fov)) {
        spend(ghost, 1 / speed);
        if (ghost.pos === ally.defend) ally.moving = false;
      } else {
        // Unable to get closer to the place it was sent to: it holds where it is.
        if (ally.moving) {
          ally.defend = ghost.pos;
          ally.moving = false;
        }
        spend(ghost, 1);
      }
      return;
    }
  }
  // DirectableAlly.Hunting and Mob.Hunting.
  if (enemy && enemyInFov && ally.defend !== -1 && heroFov[ally.defend] && !canAttack(enemy)) {
    ghost.target = ally.defend;
    ghost.state = 'wandering';
    spend(ghost, 1);
    return;
  }
  ghost.enemySeen = enemyInFov;
  if (enemy && enemyInFov && canAttack(enemy)) {
    ghostAttack(ctx, ghost, enemy);
    return;
  }
  if (enemy && enemyInFov) ghost.target = enemy.pos;
  else if (!enemy) {
    ghost.state = 'wandering';
    spend(ghost, 1);
    return;
  }
  if (ghost.target !== -1 && getCloser(ctx, ghost, ghost.target, fov)) {
    spend(ghost, 1);
  } else {
    spend(ghost, 1);
    if (!enemyInFov) ghost.state = 'wandering';
  }
}

/** GhostHero.damageRoll, attackProc: its weapon's blow and the strength it has to spare, or bare 1 to strength-8. */
function ghostAttack(ctx: Ctx, ghost: Mob, foe: Mob): void {
  const gear = ghost.ghostGear!;
  let damage: number;
  if (gear.weapon) {
    const stats = weaponStats(gear.weapon);
    damage = ctx.rng.normalIntRange(stats.min, stats.max);
    const excess = gear.str - stats.str;
    if (excess > 0) damage += ctx.rng.normalIntRange(0, excess);
  } else {
    damage = ctx.rng.normalIntRange(1, gear.str - 8);
  }
  attack(ctx, ghost, foe, { damage: [damage, damage] });
  // Mob.aggro: the foe turns on the ghost (an ally it may fight: ai.ts chooseEnemy).
  if (isAlive(foe) && foe.state !== 'passive') {
    foe.enemy = ghost.id;
    if (foe.state === 'sleeping') foe.state = 'hunting';
  }
  spend(ghost, gear.weapon ? weaponStats(gear.weapon).delay : 1);
}

/** Mob.holdAllies and restoreAllies: a hero's ghost follows them to another depth, to a cell beside them. */
export function ghostFollows(world: World, hero: Hero, fromDepth: number): void {
  const rose = roseOf(hero);
  if (!rose?.ghost) return;
  const from = world.floors[fromDepth];
  const ghost = from?.mobs.find((mob) => mob.id === rose.ghost);
  const to = world.floors[hero.depth];
  const level = world.levels[hero.depth];
  if (!ghost || !from || !to || !level || fromDepth === hero.depth) return;
  const cells = NEIGHBOURS8.map((n) => hero.pos + n).filter((c) =>
    c >= 0 && c < LENGTH && canEnter(level, c) && !hasFlag(level.map[c]!, F.AVOID) && !charAt(world, hero.depth, c));
  from.mobs.splice(from.mobs.indexOf(ghost), 1);
  if (world.levels[fromDepth]) leaveCell(world, world.levels[fromDepth]!, fromDepth, ghost.pos);
  if (cells.length === 0) {
    // No room beside the hero: it fades for now, and the rose empties.
    ghostGone(rose);
    return;
  }
  // restoreAllies: one of the free cells beside the hero, at random.
  ghost.pos = cells[new Rng(to.rng).index(cells.length)]!;
  ghost.time = to.now + 1;
  ghost.directed!.defend = -1;
  ghost.directed!.moving = false;
  ghost.state = 'wandering';
  ghost.enemy = null;
  to.mobs.push(ghost);
  enterCell(level, ghost.pos);
}

/** DriedRose.Petal.doPickUp: a petal makes the rose a level stronger; without a rose it stays where it is. */
export function pickPetal(ctx: Ctx, hero: Hero): 'none' | 'full' | 'grew' {
  const rose = carriedOf(hero, 'artifact.rose');
  if (!rose) {
    say(ctx, hero, 'driedrose$petal.no_rose', 'w');
    return 'none';
  }
  if (rose.level >= levelCap(rose)) {
    say(ctx, hero, 'driedrose$petal.no_room');
    return 'full';
  }
  upgradeArtifact(ctx, rose);
  say(ctx, hero, rose.level === levelCap(rose) ? 'driedrose$petal.maxlevel' : 'driedrose$petal.levelup', rose.level === levelCap(rose) ? 'p' : 'i');
  return 'grew';
}

/** RegularLevel.createItems: about a petal every two depths, for a hero whose rose is known, uncursed and its quest done. */
export function petalsFor(world: World, depth: number): number {
  const hero = heroesOn(world, depth)[0] ?? world.heroes.find(isAlive) ?? world.heroes[0];
  const rose = roseOf(hero);
  if (!rose || !artifactKnown(rose) || rose.cursed || !ghostQuestDone(world)) return 0;
  const needed = Math.ceil((Math.trunc(depth / 2) - (rose.petals ?? 0)) / 3);
  let dropped = 0;
  for (let i = 1; i <= needed; i++) {
    // The player may miss one petal and still complete the rose.
    if ((rose.petals ?? 0) < 11) {
      rose.petals = (rose.petals ?? 0) + 1;
      dropped++;
    }
  }
  return dropped;
}
