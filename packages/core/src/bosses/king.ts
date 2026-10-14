import { createMob, type Hero, isAlive, type Mob, type MobKind } from '../actors';
import { hurt, killMob } from '../combat';
import { ballistica, STOP_TARGET } from '../ballistica';
import { charAt, type Ctx, dropItem, heroesOn, heroView, isHero, isPassable, observe } from '../floor';
import { createItem, type Item } from '../items';
import { distance, WIDTH } from '../level/geometry';
import { F, hasFlag, T } from '../level/terrain';
import { BOTTOM_DOOR, IMP_SHOP, PEDESTALS, THRONE, TOP_DOOR } from '../level/city-boss';
import { bossHurt } from '../hero';
import { isChallenged, STRONGER_BOSSES } from '../challenges';
import { spendMob } from '../ai';
import { scaleMob } from '../party';
import {
  absorbShield, appear, assignBar, bleed, gatherParty, bossFloor, bossMob, deferDamage, fight, lockFloor, N8, removeTimed,
  say, schedule, setBarrier, show, theHero, timedOf, trueDistance, unlockFloor, yell,
} from './common';
import type { BossRules } from './rules';
import type { Timed } from './state';

/*
 * The Dwarf King (actors/mobs/DwarfKing.java) and his throne room
 * (CityBossLevel). First he fights with his court about him: every ten to
 * fourteen turns a summoning circle on a pedestal brings forth a ghoul (every
 * fourth subject a monk or a warlock), and as often he links his life with a
 * subject (sharing every blow) or swaps a subject to the hero's side. At fifty
 * health he takes his throne behind a shield of 300 and calls three waves of
 * his court; each subject slain in this phase breaks a twelfth of the shield.
 * When it breaks he comes down in a rage, every blow he takes deferred over
 * the following turns, summoning all the while. Slain, he leaves his crown;
 * the way on, and the imp's shop, open.
 */

/** The King's subjects (DwarfKing.getSubjects): his ghouls, monks, warlocks and golems. */
const SUBJECT_KINDS: ReadonlySet<MobKind> = new Set<MobKind>(['ghoul', 'monk', 'warlock', 'golem', 'senior']);
/** DwarfKing.MIN_COOLDOWN, MAX_COOLDOWN: shorter under «Badder bosses» (Challenges.STRONGER_BOSSES). */
const MIN_COOLDOWN = 10;
const MAX_COOLDOWN = 14;
const MIN_COOLDOWN_STRONGER = 8;
const MAX_COOLDOWN_STRONGER = 10;
/** DwarfKing's health under «Badder bosses» (HP = HT = 450 instead of 300; created with the King in sealCity). */
const STRONGER_HEALTH = 450;

const stronger = (ctx: Ctx): boolean => isChallenged(ctx.world, STRONGER_BOSSES);
const NONE = 0;
const LINK = 1;
const TELE = 2;

const subjects = (ctx: Ctx): Mob[] => ctx.floor.mobs.filter((m) => m.bossMinion && SUBJECT_KINDS.has(m.kind) && isAlive(m));

/* The throne room (CityBossLevel.occupyCell, seal, unseal) */

/** CityBossLevel.occupyCell: a hero inside the throne room, the doors as they were, seals it. */
export function cityOccupy(ctx: Ctx, hero: Hero): void {
  const { map } = ctx.level;
  if (map[BOTTOM_DOOR] !== T.LOCKED_DOOR && map[TOP_DOOR] === T.LOCKED_DOOR && hero.pos < BOTTOM_DOOR) sealCity(ctx, hero);
}

/** CityBossLevel.seal: the King appears on his throne; the door below locks. */
function sealCity(ctx: Ctx, hero: Hero): void {
  if (!lockFloor(ctx)) return;
  const { world, floor, level } = ctx;
  const born = createMob(`#${++world.nextId}`, 'king', THRONE, 'wandering', floor.now);
  if (isChallenged(world, STRONGER_BOSSES)) born.ht = born.hp = STRONGER_HEALTH;
  const king = scaleMob(world, born);
  king.target = hero.pos;
  king.boss = { phase: 1, summonsMade: 0, summonCooldown: 0, abilityCooldown: 0, lastAbility: NONE };
  floor.mobs.push(king);
  level.map[BOTTOM_DOOR] = T.LOCKED_DOOR;
  // Companions still below come in with the hero (Mob.restoreAllies).
  gatherParty(ctx, (pos) => pos < BOTTOM_DOOR, BOTTOM_DOOR - WIDTH);
  const heap = floor.heaps.find((h) => h.pos === BOTTOM_DOOR);
  if (heap) {
    floor.heaps.splice(floor.heaps.indexOf(heap), 1);
    for (const item of heap.items) dropItem(floor, BOTTOM_DOOR - WIDTH, item);
  }
  for (const h of heroesOn(world, ctx.depth)) observe(world, h);
  ctx.effects.push({ type: 'arena', depth: ctx.depth, sealed: true });
  fight(ctx, king, 'start');
  if (heroesOn(world, ctx.depth).some((h) => heroView(world, h)[king.pos])) {
    king.state = 'hunting';
    king.enemy = hero.id;
    king.enemySeen = true;
    KING.notice!(ctx, king, hero);
  }
}

/** CityBossLevel.unseal: both doors open; the imp's shop opens if he was helped. */
function unsealCity(ctx: Ctx, king: Mob): void {
  if (!unlockFloor(ctx)) return;
  const { level } = ctx;
  level.map[BOTTOM_DOOR] = T.DOOR;
  level.map[TOP_DOOR] = T.DOOR;
  spawnImpShop(ctx);
  for (const h of heroesOn(ctx.world, ctx.depth)) observe(ctx.world, h);
  ctx.effects.push({ type: 'arena', depth: ctx.depth, sealed: false });
  fight(ctx, king, 'end');
}

/**
 * ImpShopRoom.spawnShop, once the King is slain and if the imp's errand was done (Imp.Quest.earnedShop): the
 * imp on his pedestal, his wares along the walls (what lay inside is moved below the room).
 */
export function spawnImpShop(ctx: Ctx): void {
  const boss = bossFloor(ctx.floor);
  if (boss.impShop || ctx.world.impQuest?.done !== true) return;
  const wares = boss.impWares ?? [];
  boss.impShop = true;
  delete boss.impWares;
  const { floor } = ctx;
  const inside = (pos: number): boolean => {
    const x = pos % WIDTH;
    const y = Math.trunc(pos / WIDTH);
    return x >= IMP_SHOP.left && x <= IMP_SHOP.right && y >= IMP_SHOP.top && y <= IMP_SHOP.bottom;
  };
  const existing: Item[] = [];
  for (const heap of [...floor.heaps]) {
    if (!inside(heap.pos)) continue;
    existing.push(...heap.items);
    floor.heaps.splice(floor.heaps.indexOf(heap), 1);
  }
  const keeper = Math.trunc((IMP_SHOP.left + IMP_SHOP.right) / 2) + Math.trunc((IMP_SHOP.top + IMP_SHOP.bottom) / 2) * WIDTH;
  const imp = createMob(`#${++ctx.world.nextId}`, 'impShopkeeper', keeper, 'passive', floor.now);
  floor.mobs.push(imp);
  // ShopRoom.placeItems: round the room inside its walls, from the bottom middle (its entrance) onwards.
  const rim: number[] = [];
  const l = IMP_SHOP.left + 1;
  const r = IMP_SHOP.right - 1;
  const t = IMP_SHOP.top + 1;
  const b = IMP_SHOP.bottom - 1;
  for (let x = Math.trunc((l + r) / 2); x <= r; x++) rim.push(x + b * WIDTH);
  for (let y = b - 1; y >= t; y--) rim.push(r + y * WIDTH);
  for (let x = r - 1; x >= l; x--) rim.push(x + t * WIDTH);
  for (let y = t + 1; y <= b; y++) rim.push(l + y * WIDTH);
  for (let x = l + 1; x < Math.trunc((l + r) / 2); x++) rim.push(x + b * WIDTH);
  const inner: number[] = [];
  for (let y = t + 1; y < b; y++) for (let x = l + 1; x < r; x++) if (x + y * WIDTH !== keeper) inner.push(x + y * WIDTH);
  const spots = [...rim, ...inner].filter((pos) => isPassable(ctx.level, pos));
  wares.forEach((item, i) => {
    const pos = spots[i];
    if (pos !== undefined) floor.heaps.push({ pos, kind: 'forSale', items: [item] });
  });
  const below = IMP_SHOP.left + 2 + (IMP_SHOP.bottom + 2) * WIDTH;
  for (const item of existing) dropItem(floor, below + ctx.rng.int(5), item);
}

/* The King */

/**
 * DwarfKing.summonSubject(delay): a ghoul, and every fourth time a monk or a warlock. Under «Badder bosses» every
 * third is a monk or a warlock, every ninth a golem.
 */
function summonSubject(ctx: Ctx, king: Mob, delay: number, type?: MobKind): boolean {
  const b = bossMob(king);
  const made = b.summonsMade ?? 0;
  const monkOrWarlock = (): MobKind => (ctx.rng.int(2) === 0 ? 'monk' : 'warlock');
  let kind: MobKind;
  if (type) kind = type;
  else if (stronger(ctx)) kind = made % 3 === 2 ? (made % 9 === 8 ? 'golem' : monkOrWarlock()) : 'ghoul';
  else kind = made % 4 === 3 ? monkOrWarlock() : 'ghoul';
  const pos = summoningPos(ctx, king);
  if (pos === -1) return false;
  schedule(ctx, { kind: 'summoning', owner: king.id, pos, summon: kind, delay, time: ctx.floor.now });
  show(ctx, 'summon', { mob: king.id, pos, value: SUMMONS.indexOf(kind) });
  return true;
}

/** The kinds a summoning circle shows (its particles), in the order the client knows them. */
export const SUMMONS: readonly MobKind[] = ['ghoul', 'monk', 'warlock', 'golem'];

/** CityBossLevel.getSummoningPos: a pedestal with no summoning on it yet. */
function summoningPos(ctx: Ctx, king: Mob): number {
  const busy = timedOf(ctx, 'summoning').filter((s) => s.owner === king.id).map((s) => s.pos);
  const free = PEDESTALS.filter((p) => !busy.includes(p));
  return free.length === 0 ? -1 : ctx.rng.element(free)!;
}

/** DwarfKing.Summoning.act: a turn less; then the subject comes forth (or crushes whoever stands there). */
export function summoningTurn(ctx: Ctx, s: Extract<Timed, { kind: 'summoning' }>): void {
  s.delay--;
  s.time += 1;
  if (s.delay > 0) return;
  removeTimed(ctx, s);
  const king = ctx.floor.mobs.find((m) => m.id === s.owner && m.kind === 'king');
  if (!king) return;
  let pos = s.pos;
  if (charAt(ctx.world, ctx.depth, pos)) {
    const free = N8.map((n) => pos + n).filter((c) => isPassable(ctx.level, c) && !charAt(ctx.world, ctx.depth, c));
    if (free.length > 0) pos = ctx.rng.element(free)!;
  }
  // A sheep on the spot is killed rather than the summoning failing.
  const there = charAt(ctx.world, ctx.depth, pos);
  if (there && !isHero(there) && there.kind === 'sheep') {
    there.hp = 0;
    killMob(ctx, there);
  }
  show(ctx, 'summoned', { mob: king.id, pos, value: SUMMONS.indexOf(s.summon) });
  const occupant = charAt(ctx.world, ctx.depth, pos);
  const phase = king.boss?.phase ?? 1;
  if (!occupant) {
    const minion = scaleMob(ctx.world, createMob(`#${++ctx.world.nextId}`, s.summon, pos, 'hunting', ctx.floor.now + 1));
    minion.bossMinion = true;
    // DwarfKing.DKGhoul: no partner of its own (partnerID -2); it may still rise again by another ghoul (mobskills.ts).
    if (minion.kind === 'ghoul') minion.partner = '';
    minion.enemy = king.enemy;
    minion.target = theHero(ctx)?.pos ?? pos;
    minion.enemySeen = true;
    if (phase === 2) bossMob(minion).kingDamager = true;
    ctx.floor.mobs.push(minion);
  } else {
    const damage = ctx.rng.normalIntRange(20, 40);
    ctx.effects.push({ type: 'hurt', depth: ctx.depth, who: occupant.id, damage });
    hurt(ctx, occupant, damage, king);
    if (phase === 2) kingDamaged(ctx, king);
  }
}

/** DwarfKing.KingDamager: a twelfth of the King's health off his shield (an eighteenth under «Badder bosses»). */
function kingDamaged(ctx: Ctx, king: Mob): void {
  // (Rounded up: twelve subjects (eighteen) always break the shield, whatever a party made of his health.)
  const damage = Math.ceil(king.ht / (stronger(ctx) ? 18 : 12));
  hurtKing(ctx, king, damage, true);
}

/** A subject that carried the KingDamager died: the King's shield breaks a little (KingDamager.detach). */
export function subjectDied(ctx: Ctx, mob: Mob): void {
  if (!mob.boss?.kingDamager) return;
  const king = ctx.floor.mobs.find((m) => m.kind === 'king' && isAlive(m));
  if (king) kingDamaged(ctx, king);
}

/** DwarfKing.damage from KingDamager: past the invulnerability, into the shield. */
function hurtKing(ctx: Ctx, king: Mob, damage: number, damager: boolean): void {
  kingDamage = damager;
  hurt(ctx, king, damage, 'king');
  kingDamage = false;
}
let kingDamage = false;

/** DwarfKing.lifeLinkSubject: the furthest subject not linked yet shares his life for a hundred turns. */
function lifeLinkSubject(ctx: Ctx, king: Mob): boolean {
  const links = timedOf(ctx, 'lifeLink');
  let furthest: Mob | undefined;
  for (const m of subjects(ctx)) {
    if (links.some((l) => (l.a === king.id && l.b === m.id) || (l.b === king.id && l.a === m.id))) continue;
    if (!furthest || distance(king.pos, furthest.pos) < distance(king.pos, m.pos)) furthest = m;
  }
  if (!furthest) return false;
  schedule(ctx, { kind: 'lifeLink', owner: king.id, a: king.id, b: furthest.id, time: ctx.floor.now + 100 });
  yell(ctx, king, `lifelink_${ctx.rng.intRange(1, 2)}`);
  show(ctx, 'link', { mob: king.id, pos: king.pos, to: furthest.pos });
  return true;
}

/** DwarfKing.teleportSubject: he steps back from the hero, and his furthest subject appears at the hero's side. */
function teleportSubject(ctx: Ctx, king: Mob): boolean {
  const enemy = heroesOn(ctx.world, ctx.depth).find((h) => h.id === king.enemy);
  if (!enemy) return false;
  let furthest: Mob | undefined;
  for (const m of subjects(ctx)) {
    if (!furthest || distance(king.pos, furthest.pos) < distance(king.pos, m.pos)) furthest = m;
  }
  if (!furthest) return false;
  const solid = (c: number): boolean => hasFlag(ctx.level.map[c]!, F.SOLID);
  const trajectory = ballistica(ctx, enemy.pos, king.pos, STOP_TARGET);
  const targetCell = trajectory.path[trajectory.dist + 1];
  let bestPos = king.pos;
  if (targetCell !== undefined && !charAt(ctx.world, ctx.depth, targetCell) && !solid(targetCell)) {
    bestPos = targetCell;
  } else {
    let bestDist = trueDistance(king.pos, enemy.pos);
    for (const n of N8) {
      const c = king.pos + n;
      if (!charAt(ctx.world, ctx.depth, c) && !solid(c) && trueDistance(c, enemy.pos) > bestDist) {
        bestPos = c;
        bestDist = trueDistance(c, enemy.pos);
      }
    }
  }
  if (bestPos !== king.pos) {
    const from = king.pos;
    king.pos = bestPos;
    ctx.effects.push({ type: 'pushed', depth: ctx.depth, mob: king.id, from, to: bestPos });
  }
  let bestDist = trueDistance(enemy.pos, king.pos);
  bestPos = enemy.pos;
  for (const n of N8) {
    const c = enemy.pos + n;
    if (!charAt(ctx.world, ctx.depth, c) && !solid(c) && trueDistance(c, king.pos) < bestDist) {
      bestPos = c;
      bestDist = trueDistance(c, king.pos);
    }
  }
  if (bestPos !== enemy.pos) {
    show(ctx, 'teleport', { mob: furthest.id, pos: furthest.pos, to: bestPos });
    appear(ctx, furthest, bestPos);
  }
  yell(ctx, king, `teleport_${ctx.rng.intRange(1, 2)}`);
  return true;
}

/** DwarfKing.act: true when his turn is taken here. */
function kingAct(ctx: Ctx, king: Mob): boolean {
  const b = bossMob(king);
  const phase = b.phase ?? 1;
  const hard = stronger(ctx);
  const cd = (): number => (hard ? ctx.rng.normalIntRange(MIN_COOLDOWN_STRONGER, MAX_COOLDOWN_STRONGER) : ctx.rng.normalIntRange(MIN_COOLDOWN, MAX_COOLDOWN));
  if (phase === 1) {
    if ((b.summonCooldown ?? 0) <= 0 && summonSubject(ctx, king, hard ? 2 : 3)) {
      b.summonsMade = (b.summonsMade ?? 0) + 1;
      b.summonCooldown = (b.summonCooldown ?? 0) + cd();
    } else if ((b.summonCooldown ?? 0) > 0) {
      b.summonCooldown!--;
    }
    if ((king.paralysed ?? 0) > 0) {
      spendMob(king, 1);
      return true;
    }
    if ((b.abilityCooldown ?? 0) <= 0) {
      const last = b.lastAbility ?? NONE;
      if (last === NONE) b.lastAbility = ctx.rng.int(2) === 0 ? LINK : TELE;
      else if (last === LINK) b.lastAbility = ctx.rng.int(8) === 0 ? LINK : TELE;
      else b.lastAbility = ctx.rng.int(8) !== 0 ? LINK : TELE;
      if (b.lastAbility === LINK && lifeLinkSubject(ctx, king)) {
        b.abilityCooldown = (b.abilityCooldown ?? 0) + cd();
        spendMob(king, 1);
        return true;
      } else if (teleportSubject(ctx, king)) {
        b.lastAbility = TELE;
        b.abilityCooldown = (b.abilityCooldown ?? 0) + cd();
        spendMob(king, 1);
        return true;
      }
    } else {
      b.abilityCooldown!--;
    }
    return false;
  }
  if (phase === 2 && hard) return strongerWaves(ctx, king);
  if (phase === 2) {
    const made = b.summonsMade ?? 0;
    const shield = king.shield ?? 0;
    if (made < 4) {
      if (made === 0) {
        show(ctx, 'scream', { mob: king.id });
        yell(ctx, king, 'wave_1');
      }
      summonSubject(ctx, king, 3, 'ghoul');
      spendMob(king, 3);
      b.summonsMade = made + 1;
    // (Shattered's 200 and 100 of a shield of 300: four and eight subjects' worth here, for a party's sturdier King.)
    } else if (shield <= king.ht - 4 * Math.ceil(king.ht / 12) && made < 8) {
      if (made === 4) {
        show(ctx, 'scream', { mob: king.id });
        yell(ctx, king, 'wave_2');
      }
      summonSubject(ctx, king, 3, made === 7 ? (ctx.rng.int(2) === 0 ? 'monk' : 'warlock') : 'ghoul');
      b.summonsMade = made + 1;
      spendMob(king, 1);
    } else if (shield <= king.ht - 8 * Math.ceil(king.ht / 12) && made < 12) {
      show(ctx, 'scream', { mob: king.id });
      yell(ctx, king, 'wave_3');
      summonSubject(ctx, king, 4, 'warlock');
      summonSubject(ctx, king, 4, 'monk');
      summonSubject(ctx, king, 4, 'ghoul');
      summonSubject(ctx, king, 4, 'ghoul');
      b.summonsMade = 12;
      spendMob(king, 1);
    } else {
      spendMob(king, 1);
    }
    return true;
  }
  if (timedOf(ctx, 'summoning').filter((s) => s.owner === king.id).length < 4) {
    if (summonSubject(ctx, king, hard ? 2 : 3)) b.summonsMade = (b.summonsMade ?? 0) + 1;
  }
  return false;
}

/**
 * DwarfKing.act, phase 2 under «Badder bosses»: eighteen subjects in four waves, each broken by an eighteenth of
 * his shield (Shattered's 450 of a shield of 450: the second wave once it is down to 300, the third at 150).
 */
function strongerWaves(ctx: Ctx, king: Mob): boolean {
  const b = bossMob(king);
  const made = b.summonsMade ?? 0;
  const shield = king.shield ?? 0;
  const part = Math.ceil(king.ht / 18);
  const scream = (line: string): void => {
    show(ctx, 'scream', { mob: king.id });
    yell(ctx, king, line);
  };
  if (made < 6) {
    if (made === 0) scream('wave_1');
    summonSubject(ctx, king, 3, 'ghoul');
    summonSubject(ctx, king, 3, 'ghoul');
    spendMob(king, 3);
    b.summonsMade = made + 2;
  } else if (shield <= king.ht - 6 * part && made < 12) {
    if (made === 6) scream('wave_2');
    summonSubject(ctx, king, 3, 'ghoul');
    summonSubject(ctx, king, 3, 'ghoul');
    summonSubject(ctx, king, 3, made === 6 ? 'monk' : 'warlock');
    b.summonsMade = made + 3;
    spendMob(king, 3);
  } else if (shield <= king.ht - 12 * part && made < 18) {
    if (made === 12) {
      scream('wave_3');
      summonSubject(ctx, king, 3, 'warlock');
      summonSubject(ctx, king, 3, 'monk');
      summonSubject(ctx, king, 3, 'ghoul');
      summonSubject(ctx, king, 3, 'ghoul');
      b.summonsMade = made + 4;
      spendMob(king, 3);
    } else {
      summonSubject(ctx, king, 3, 'golem');
      summonSubject(ctx, king, 3, 'golem');
      b.summonsMade = made + 2;
      spendMob(king, 1);
    }
  } else {
    spendMob(king, 1);
  }
  return true;
}

/** LifeLink in Char.damage: a blow on a linked character is shared out among it and those it is linked with. */
export function shareLinkedDamage(ctx: Ctx, mob: Mob, damage: number): number {
  const links = timedOf(ctx, 'lifeLink').filter((l) => l.a === mob.id || l.b === mob.id);
  if (links.length === 0) return damage;
  const others: Mob[] = [];
  for (const link of links) {
    const other = ctx.floor.mobs.find((m) => m.id === (link.a === mob.id ? link.b : link.a) && isAlive(m));
    if (other) others.push(other);
    else removeTimed(ctx, link);
  }
  damage = Math.ceil(damage / (others.length + 1));
  for (const other of others) {
    linking = true;
    ctx.effects.push({ type: 'hurt', depth: ctx.depth, who: other.id, damage });
    hurt(ctx, other, damage, 'link');
    linking = false;
  }
  return damage;
}
/** Damage passed on by a life link is not shared again. */
export let linking = false;

export const KING: BossRules = {
  attackSkill() {
    return 26;
  },
  defenseSkill() {
    return 22;
  },
  damageRoll(ctx) {
    return ctx.rng.normalIntRange(15, 25);
  },
  drRoll(ctx) {
    return ctx.rng.normalIntRange(0, 10);
  },
  act(ctx, king) {
    return kingAct(ctx, king);
  },
  getCloser(_ctx, king) {
    // Property.IMMOVABLE on his throne.
    return king.boss?.phase === 2 ? false : undefined;
  },
  notice(ctx, king, hero) {
    if (!assignBar(ctx, king)) return;
    yell(ctx, king, 'notice', hero);
  },
  beforeDamage(ctx, king, damage, source) {
    const b = bossMob(king);
    const phase = b.phase ?? 1;
    if (phase === 2 && !kingDamage) {
      say(ctx, king, 'invulnerable', 'status');
      return null;
    }
    if (phase === 3 && source !== 'deferred') {
      if (damage >= 0) {
        deferDamage(ctx, king, damage);
        say(ctx, king, `deferred:${damage}`, 'status');
      }
      return null;
    }
    // DKBarrior: his shield takes it first.
    return absorbShield(king, damage);
  },
  afterDamage(ctx, king, before) {
    const b = bossMob(king);
    const taken = before - king.hp;
    // LockedFloor.addTime(dmg/3f), dmg/5f under «Badder bosses».
    bossHurt(ctx, king, taken, stronger(ctx) ? 1 / 5 : 1 / 3);
    const phase = b.phase ?? 1;
    if (phase === 1) {
      b.abilityCooldown = (b.abilityCooldown ?? 0) - taken / 8;
      b.summonCooldown = (b.summonCooldown ?? 0) - taken / 8;
      // His health floor: 50 of 300, 100 of 450 under «Badder bosses».
      const floorHp = stronger(ctx) ? Math.trunc((king.ht * 2) / 9) : Math.trunc(king.ht / 6);
      if (king.hp <= floorHp) {
        king.hp = floorHp;
        say(ctx, king, 'invulnerable', 'status');
        show(ctx, 'teleport', { mob: king.id, pos: king.pos, to: THRONE });
        appear(ctx, king, THRONE);
        b.phase = 2;
        b.summonsMade = 0;
        // DKBarrior: a shield as great as his health, which holds.
        setBarrier(ctx, king, king.ht, true);
        const boss = bossFloor(ctx.floor);
        boss.timed = boss.timed.filter((t) => !(t.kind === 'summoning' && t.owner === king.id) && t.kind !== 'lifeLink');
        for (const m of subjects(ctx)) {
          m.hp = 0;
          killMob(ctx, m);
        }
        fight(ctx, king, 'phase', 2);
      }
    } else if (phase === 2 && (king.shield ?? 0) === 0) {
      b.phase = 3;
      b.summonsMade = 1;
      show(ctx, 'scream', { mob: king.id });
      yell(ctx, king, 'enraged', theHero(ctx));
      bleed(ctx, king, true);
      fight(ctx, king, 'phase', 3);
    } else if (phase === 3 && before > 20 && king.hp < 20 && king.hp > 0) {
      yell(ctx, king, 'losing');
    }
    // DwarfKing.isAlive: he cannot die before his last phase.
    if (b.phase !== 3 && king.hp <= 0) king.hp = 1;
  },
  die(ctx, king) {
    const { floor } = ctx;
    const heap = floor.heaps.find((h) => h.pos === THRONE);
    if (heap) {
      floor.heaps.splice(floor.heaps.indexOf(heap), 1);
      for (const item of heap.items) dropItem(floor, THRONE + WIDTH, item);
    }
    dropItem(floor, king.pos === THRONE ? king.pos + WIDTH : king.pos, createItem('crown.king'));
    unsealCity(ctx, king);
    for (const m of subjects(ctx)) {
      m.hp = 0;
      killMob(ctx, m);
    }
    const boss = bossFloor(floor);
    boss.timed = boss.timed.filter((t) => t.owner !== king.id);
    yell(ctx, king, 'defeated');
  },
};

