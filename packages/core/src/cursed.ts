import { createMob, type Hero, type HeroClass, isAlive, type Mob, mobStats } from './actors';
import { type Ballistica, ballistica, cone, MAGIC_BOLT, PROJECTILE, STOP_SOLID, STOP_TARGET } from './ballistica';
import { armorRoll, hurt } from './combat';
import { castShadow } from './fov';
import { charAt, type Char, type Ctx, enterCell, heroView, isHero, landItem, leaveCell } from './floor';
import { createItem, type Item, itemDef, ItemGenerator, WAND_KINDS } from './items';
import { distance, LENGTH, NEIGHBOURS8, NEIGHBOURS9 } from './level/geometry';
import { F, hasFlag, T } from './level/terrain';
import { isBossDepth } from './level/builder';
import { destroyCell, seedFire, seedGas } from './gas';
import { burnHeaps, freezeHeaps } from './cooking';
import { hasProp } from './props';
import { chill, freeze, FROST_TURNS, ignite, LEVITATION_TURNS, ooze, OOZE_TURNS, PARALYSIS_TURNS } from './status';
import { mobFall, summonAround, trapAt } from './traps';
import { plant, SEED_PLANTS } from './plants';
import { isChallenged, NO_HERBALISM } from './challenges';
import { conjureImages } from './allies';
import { randomRespawnCell } from './ai';
import { beckon } from './actors';
import { scaleMob } from './party';
import { pressCell, RECHARGING_TURNS, throwChar, wandProc, zapAs } from './wands';
import { heroFall, sendHeroTo } from './world';

/*
 * CursedWand: what a cursed wand does instead of its work — something random,
 * now harmless, now dreadful: common (60%), uncommon (30%), rare (9%) or
 * very rare (1%), each kind as likely as the others of its rarity, as long as
 * it can happen where it is aimed.
 *
 * Seam for the alchemy stream: wondrous resin makes a cursed zap now and then
 * a positive one only (WondrousResin.positiveCurseEffectChance); there is no
 * resin yet, so `positiveOnly` is never true. Seams for others: the traps of
 * the levels stream (geyser, chilling and shocking traps are done here in
 * their simplest form), curse enchantments and glyphs (gear), artifacts
 * among what a wand may turn into (artifacts).
 */

/** The cursed effects, by rarity (CursedWand.COMMON_EFFECTS and the rest). */
export type CursedEffect =
  | 'burnAndFreeze' | 'spawnRegrowth' | 'randomTeleport' | 'randomGas' | 'randomAreaEffect' | 'bubbles' | 'randomWand' | 'selfOoze'
  | 'randomPlant' | 'healthTransfer' | 'explosion' | 'lightningBolt' | 'geyser' | 'summonSheep' | 'levitate' | 'alarm'
  | 'sheepPolymorph' | 'curseEquipment' | 'interFloorTeleport' | 'summonMonsters' | 'fireBall' | 'coneOfColors' | 'massInvuln' | 'petrify'
  | 'forestFire' | 'spawnGoldenMimic' | 'abortRetryFail' | 'randomTransmogrify' | 'heroShapeShift' | 'superNova' | 'sinkHole'
  | 'gravityChaos';

const EFFECTS: readonly (readonly CursedEffect[])[] = [
  ['burnAndFreeze', 'spawnRegrowth', 'randomTeleport', 'randomGas', 'randomAreaEffect', 'bubbles', 'randomWand', 'selfOoze'],
  ['randomPlant', 'healthTransfer', 'explosion', 'lightningBolt', 'geyser', 'summonSheep', 'levitate', 'alarm'],
  ['sheepPolymorph', 'curseEquipment', 'interFloorTeleport', 'summonMonsters', 'fireBall', 'coneOfColors', 'massInvuln', 'petrify'],
  ['forestFire', 'spawnGoldenMimic', 'abortRetryFail', 'randomTransmogrify', 'heroShapeShift', 'superNova', 'sinkHole', 'gravityChaos'],
];
/** CursedWand.EFFECT_CAT_CHANCES. */
const CATEGORY_CHANCES = [60, 30, 9, 1];

/** Bless.DURATION, Invulnerability (10 turns), HeroDisguise.DURATION, TimeStasis (100 turns). */
const BLESS_TURNS = 30;
const INVULNERABLE_TURNS = 10;
const DISGUISE_TURNS = 1000;
const STASIS_TURNS = 100;

/** WondrousResin.positiveCurseEffectChance (seam for the alchemy stream). */
const positiveCurseEffectChance = (_hero: Hero): number => 0;

/**
 * CursedWand.cursedZap: a random effect that can happen here, its bolt's flight (a rainbow, unless
 * the effect has its own look) and its work. `origin` is the wand (a staff's wand) zapped, if any.
 */
export function cursedZap(ctx: Ctx, user: Hero, origin: Item | null, bolt: Ballistica, _fromHero = true): void {
  const positiveOnly = ctx.rng.float() < positiveCurseEffectChance(user);
  let effect: CursedEffect;
  const category = EFFECTS[ctx.rng.chances(CATEGORY_CHANCES)]!;
  do {
    effect = ctx.rng.oneOf(category);
  } while (!valid(ctx, effect, user, origin, bolt, positiveOnly));
  ctx.effects.push({ type: 'cursedZap', depth: ctx.depth, hero: user.id, effect });
  if (!SILENT.has(effect) && effect !== 'randomWand') {
    ctx.effects.push({ type: 'zapped', depth: ctx.depth, from: user.pos, to: bolt.collisionPos, bolt: 'rainbow' });
  }
  apply(ctx, effect, user, origin, bolt, positiveOnly);
}

/** Effects with no bolt to see (or their own). */
const SILENT: ReadonlySet<CursedEffect> = new Set([
  'selfOoze', 'alarm', 'interFloorTeleport', 'massInvuln', 'petrify', 'sinkHole', 'gravityChaos', 'lightningBolt', 'coneOfColors',
]);

/** Whether an effect can happen (CursedEffect.valid). */
function valid(ctx: Ctx, effect: CursedEffect, user: Hero, origin: Item | null, bolt: Ballistica, positiveOnly: boolean): boolean {
  const target = charAt(ctx.world, ctx.depth, bolt.collisionPos);
  switch (effect) {
    case 'randomTeleport':
      return !(positiveOnly && (!target || hasProp(target, 'immovable')));
    case 'randomWand':
      return origin !== null && itemDef(origin.kind).category === 'wand';
    case 'randomPlant': {
      const terrain = ctx.level.map[bolt.collisionPos]!;
      return terrain !== T.ALCHEMY && !hasFlag(terrain, F.PIT) && !trapAt(terrain) && !isChallenged(ctx.world, NO_HERBALISM);
    }
    case 'healthTransfer':
      return target !== undefined;
    case 'levitate':
      return positiveOnly || target !== undefined;
    case 'sheepPolymorph':
      return target !== undefined && !isHero(target) && !hasProp(target, 'boss') && !hasProp(target, 'miniboss') && !(target.state === 'passive' && !target.ally);
    case 'petrify':
      return isHero(user);
    case 'randomTransmogrify':
      // Only a wand in the pack itself (a staff's is not among the hero's belongings).
      return positiveOnly || (origin !== null && user.items.includes(origin));
    case 'heroShapeShift':
      return true;
    case 'sinkHole':
      return !isBossDepth(ctx.depth) && ctx.depth <= 25;
    default:
      return true;
  }
}

/** CursedWand.tryForWandProc: a cursed wand's zap still counts as a wand's on whoever it reaches. */
function tryForWandProc(ctx: Ctx, user: Hero, target: Char | undefined, origin: Item | null): void {
  if (target && !isHero(target) && origin && itemDef(origin.kind).category === 'wand') wandProc(ctx, user, target, Math.max(0, origin.level), 1);
}

function apply(ctx: Ctx, effect: CursedEffect, user: Hero, origin: Item | null, bolt: Ballistica, positiveOnly: boolean): void {
  const { rng, world, depth, level } = ctx;
  const pos = bolt.collisionPos;
  const target = (): Char | undefined => {
    const ch = charAt(world, depth, pos);
    return ch && isAlive(ch) ? ch : undefined;
  };
  const pressIfEmpty = (): void => {
    if (!target()) pressCell(ctx, pos);
  };
  const harm = (ch: Char, damage: number): void => {
    ctx.effects.push({ type: 'hurt', depth, who: ch.id, damage });
    hurt(ctx, ch, damage, isHero(ch) ? 'wand' : user);
  };
  const scaling = depth;
  switch (effect) {
    /* Common */
    case 'burnAndFreeze': {
      const ch = target();
      if (rng.int(2) === 0) {
        if (ch) ignite(ch);
        if (!positiveOnly) freeze(ctx, user, FROST_TURNS);
      } else {
        if (!positiveOnly) ignite(user);
        if (ch) freeze(ctx, ch, FROST_TURNS);
      }
      tryForWandProc(ctx, user, ch, origin);
      return;
    }
    case 'spawnRegrowth':
      pressIfEmpty();
      seedGas(ctx, pos, 'regrowth', 30);
      tryForWandProc(ctx, user, target(), origin);
      return;
    case 'randomTeleport': {
      const ch = target();
      if (ch && !hasProp(ch, 'immovable') && (positiveOnly || rng.int(2) === 0)) {
        teleportChar(ctx, ch);
        tryForWandProc(ctx, user, ch, origin);
      } else if (!positiveOnly) {
        teleportChar(ctx, user);
      }
      return;
    }
    case 'randomGas': {
      tryForWandProc(ctx, user, target(), origin);
      pressIfEmpty();
      const kind = rng.int(3);
      seedGas(ctx, pos, kind === 0 ? 'confusion' : kind === 1 ? 'toxic' : 'paralytic', kind === 0 ? 800 : kind === 1 ? 500 : 200);
      ctx.effects.push({ type: 'burst', depth, pos, kind: kind === 1 ? 'toxic' : 'paralytic', radius: 1, silent: true });
      return;
    }
    case 'randomAreaEffect': {
      tryForWandProc(ctx, user, target(), origin);
      pressIfEmpty();
      const kind = rng.int(3);
      for (const n of NEIGHBOURS9) {
        const cell = pos + n;
        if (hasFlag(level.map[cell]!, F.SOLID)) continue;
        // BurningTrap: fire; ChillingTrap: freezing air; ShockingTrap: a jolt of electricity.
        if (kind === 0) seedFire(ctx, cell, 2);
        else if (kind === 1) freezing(ctx, cell);
        else shock(ctx, cell, 10, user);
      }
      ctx.effects.push({ type: 'burst', depth, pos, kind: kind === 0 ? 'fire' : 'frost', radius: 1, silent: true });
      return;
    }
    case 'bubbles':
      pressIfEmpty();
      tryForWandProc(ctx, user, target(), origin);
      return;
    case 'randomWand': {
      // A random wand's work, as strong as the cursed one, through the cursed bolt.
      const kind = WAND_KINDS[rng.chances(WAND_KINDS.map(() => 3))]!;
      const wand = createItem(kind, 1, Math.max(0, origin?.level ?? Math.trunc(depth / 5)));
      zapAs(ctx, user, wand, bolt, bolt.path[bolt.path.length - 1]!);
      return;
    }
    case 'selfOoze': {
      const dist = distanceMap(ctx, user.pos, 2);
      for (let cell = 0; cell < LENGTH; cell++) {
        if (dist[cell]! < 0) continue;
        const ch = charAt(world, depth, cell);
        if (ch && isAlive(ch) && (!positiveOnly || !(isHero(ch) || ch.ally))) ooze(ch, OOZE_TURNS);
      }
      return;
    }

    /* Uncommon */
    case 'randomPlant': {
      tryForWandProc(ctx, user, target(), origin);
      const seed = new ItemGenerator(rng, depth).of('seed');
      plant(ctx, pos, SEED_PLANTS[seed.kind]!);
      return;
    }
    case 'healthTransfer': {
      const ch = target()!;
      const damage = scaling * 2;
      const [toHeal, toDamage] = positiveOnly || rng.int(2) === 0 ? [user as Char, ch] : [ch, user as Char];
      const healed = Math.min(toHeal.ht, toHeal.hp + Math.trunc(damage / 2)) - toHeal.hp;
      toHeal.hp += Math.max(0, healed);
      if (isHero(toHeal)) ctx.effects.push({ type: 'healed', hero: toHeal.id, amount: Math.max(0, healed) });
      else ctx.effects.push({ type: 'mobHealed', depth, mob: toHeal.id, amount: Math.max(0, healed) });
      harm(toDamage, damage);
      tryForWandProc(ctx, user, ch, origin);
      return;
    }
    case 'explosion':
      conjuredBomb(ctx, pos, user, true);
      tryForWandProc(ctx, user, target(), origin);
      return;
    case 'lightningBolt': {
      const affected: Char[] = [];
      for (const center of [user.pos, pos]) {
        ctx.effects.push({ type: 'zapped', depth, from: center - 1, to: center + 1, bolt: 'lightning' });
        for (const n of NEIGHBOURS9) {
          const ch = charAt(world, depth, center + n);
          if (ch && isAlive(ch) && !affected.includes(ch)) affected.push(ch);
        }
      }
      ctx.effects.push({ type: 'zapped', depth, from: user.pos, to: pos, bolt: 'lightning' });
      tryForWandProc(ctx, user, target(), origin);
      for (const ch of affected) {
        if (isHero(ch)) ch.recharging = Math.max(ch.recharging ?? 0, RECHARGING_TURNS / 3);
        if (positiveOnly && (isHero(ch) || ch.ally)) continue;
        // A shocking dart's damage, and a little stun.
        harm(ch, rng.normalIntRange(5 + Math.trunc(scaling / 4), 10 + Math.trunc(scaling / 4)));
        if (isAlive(ch)) ch.paralysed = Math.max(ch.paralysed ?? 0, PARALYSIS_TURNS / 2);
      }
      return;
    }
    case 'geyser':
      tryForWandProc(ctx, user, target(), origin);
      geyser(ctx, pos, user);
      return;
    case 'summonSheep':
      tryForWandProc(ctx, user, target(), origin);
      flock(ctx, pos);
      return;
    case 'levitate': {
      const ch = target();
      if ((!positiveOnly || (ch && !isHero(ch) && ch.kind === 'piranha')) && ch && !isHero(ch) && !hasProp(ch, 'immovable') && !mobFlies(ch)) {
        ch.levitating = Math.max(ch.levitating ?? 0, LEVITATION_TURNS);
      } else if (ch && isHero(ch) && !positiveOnly) {
        ch.levitating = Math.max(ch.levitating ?? 0, LEVITATION_TURNS);
      } else {
        user.levitating = Math.max(user.levitating ?? 0, LEVITATION_TURNS);
      }
      return;
    }
    case 'alarm':
      for (const mob of ctx.floor.mobs) beckon(mob, user.pos);
      ctx.effects.push({ type: 'scroll', hero: user.id, kind: 'challenge', count: ctx.floor.mobs.length });
      return;

    /* Rare */
    case 'sheepPolymorph': {
      const ch = target() as Mob;
      const index = ctx.floor.mobs.indexOf(ch);
      if (index < 0) return;
      ctx.floor.mobs.splice(index, 1);
      const sheep = createMob(`#${++world.nextId}`, 'sheep', ch.pos, 'passive', ctx.floor.now + 1);
      sheep.lifespan = 10;
      ctx.floor.mobs.push(sheep);
      ctx.effects.push({ type: 'flock', depth, cells: [ch.pos] });
      return;
    }
    case 'curseEquipment': {
      if (positiveOnly) {
        const ch = target();
        if (ch) ch.hexed = Math.max(ch.hexed ?? 0, 30);
        return;
      }
      // CursingTrap.curse: the weapon in hand (but the mage's staff) or the armour worn, the one without magic first.
      const priority: Item[] = [];
      const can: Item[] = [];
      for (const item of [user.weapon, user.armor]) {
        if (!item || item.kind === 'weapon.magesStaff') continue;
        (item.enchant || item.glyph ? can : priority).push(item);
      }
      const pool = priority.length > 0 ? priority : can;
      if (pool.length > 0) {
        const item = pool[rng.int(pool.length)]!;
        // Seam for the gear stream: a curse enchantment or glyph on what had none (Enchantment.randomCurse).
        item.cursed = true;
        delete item.curseUnknown;
        ctx.effects.push({ type: 'cursedEquip', hero: user.id, item });
      }
      return;
    }
    case 'interFloorTeleport': {
      if (!positiveOnly && depth > 1 && !isBossDepth(depth) && !user.items.some((i) => i.kind === 'quest.amulet')) {
        // From up to ten depths up, each a little likelier the closer it is.
        const start = Math.max(1, depth - 10);
        const weights = Array.from({ length: depth - 1 }, (_, i) => (i + 1 >= start ? i + 1 - start + 1 : 0));
        sendHeroTo(ctx, user, 1 + rng.chances(weights));
      } else {
        teleportChar(ctx, user);
      }
      return;
    }
    case 'summonMonsters':
      if (positiveOnly) conjureImages(ctx, user, 2);
      else summonAround(ctx, pos);
      return;
    case 'fireBall': {
      const fov = castShadow(pos, (cell) => hasFlag(level.map[cell]!, F.SOLID), 3);
      tryForWandProc(ctx, user, target(), origin);
      for (let cell = 0; cell < LENGTH; cell++) {
        if (!fov[cell] || hasFlag(level.map[cell]!, F.SOLID)) continue;
        const ch = charAt(world, depth, cell);
        if (ch && isAlive(ch) && !(positiveOnly && (isHero(ch) || ch.ally))) {
          ignite(ch);
          harm(ch, rng.normalIntRange(5 + scaling, 10 + scaling * 2));
        }
        if (hasFlag(level.map[cell]!, F.FLAMABLE)) seedFire(ctx, cell, 4);
      }
      ctx.effects.push({ type: 'blast', depth, pos, radius: 6 });
      return;
    }
    case 'coneOfColors': {
      const through = ballistica(ctx, bolt.sourcePos, pos, STOP_SOLID);
      const shape = cone(ctx, through, 8, 90, STOP_SOLID);
      ctx.effects.push({ type: 'cone', depth, from: user.pos, cells: shape.outerRays.map((ray) => ray.path[ray.dist]!), bolt: 'rainbow' });
      const affected = shape.cells.filter((cell) => cell !== user.pos).map((cell) => charAt(world, depth, cell)).filter((ch): ch is Char => !!ch && isAlive(ch));
      tryForWandProc(ctx, user, target(), origin);
      for (const ch of affected) {
        if (positiveOnly && (isHero(ch) || ch.ally)) continue;
        const damage = rng.normalIntRange(5 + scaling, 10 + scaling * 2);
        switch (rng.int(5)) {
          case 0:
            ignite(ch);
            harm(ch, damage);
            break;
          case 1:
            harm(ch, damage);
            if (isAlive(ch)) freeze(ctx, ch, FROST_TURNS);
            break;
          case 2:
            ch.poison = Math.max(ch.poison ?? 0, 3 + Math.trunc(scaling / 2));
            harm(ch, damage);
            break;
          case 3:
            ooze(ch, OOZE_TURNS);
            harm(ch, damage);
            break;
          default:
            harm(ch, damage);
            if (isAlive(ch)) ch.paralysed = Math.max(ch.paralysed ?? 0, PARALYSIS_TURNS);
        }
      }
      return;
    }
    case 'massInvuln':
      for (const ch of [...world.heroes.filter((h) => h.depth === depth && isAlive(h)), ...ctx.floor.mobs]) {
        ch.invulnerable = Math.max(ch.invulnerable ?? 0, INVULNERABLE_TURNS);
        ch.blessed = Math.max(ch.blessed ?? 0, BLESS_TURNS);
      }
      return;
    case 'petrify':
      // TimeStasis: out of time, still and unseen, for a hundred turns.
      user.stasis = Math.max(user.stasis ?? 0, STASIS_TURNS);
      user.invisible = Math.max(user.invisible, STASIS_TURNS);
      return;

    /* Very rare */
    case 'forestFire': {
      for (let cell = 0; cell < LENGTH; cell++) if (!hasFlag(level.map[cell]!, F.SOLID)) seedGas(ctx, cell, 'regrowth', 15);
      if (!positiveOnly) {
        do {
          const cell = randomRespawnCell(rng, world, level, () => true);
          if (cell >= 0) seedFire(ctx, cell, 10);
        } while (rng.int(5) !== 0);
      }
      return;
    }
    case 'spawnGoldenMimic':
      goldenMimic(ctx, pos, positiveOnly);
      return;
    case 'abortRetryFail':
      // It only seems to crash the game; the window says so (in English, as the joke would not translate).
      return;
    case 'randomTransmogrify': {
      if (!origin || !user.items.includes(origin)) return;
      user.items.splice(user.items.indexOf(origin), 1);
      let result: Item;
      do {
        result = new ItemGenerator(rng, depth).of(rng.oneOf(['weapon', 'armor', 'ring'] as const));
      } while (result.cursed || itemDef(result.kind).category === 'missile');
      result.level++;
      result.cursed = true;
      delete result.curseUnknown;
      landItem(ctx, user.pos, result);
      ctx.effects.push({ type: 'transmuted', hero: user.id, from: origin, to: result });
      return;
    }
    case 'heroShapeShift': {
      const classes = (['warrior', 'mage', 'rogue', 'huntress'] as const satisfies readonly HeroClass[]).filter((c) => c !== user.heroClass);
      user.disguise = { heroClass: rng.oneOf(classes), turns: DISGUISE_TURNS };
      return;
    }
    case 'superNova':
      user.supernova = { pos, turns: 10, harmsAllies: !positiveOnly };
      return;
    case 'sinkHole': {
      const cells: number[] = [];
      const dist = distanceMap(ctx, user.pos, 5, true);
      for (let cell = 0; cell < LENGTH; cell++) {
        if (dist[cell]! >= 0 && (!hasFlag(level.map[cell]!, F.SOLID) || hasFlag(level.map[cell]!, F.PASSABLE))) cells.push(cell);
      }
      user.sinkhole = { cells, turns: 1, depth };
      return;
    }
    case 'gravityChaos':
      user.gravity = { turns: rng.normalIntRange(30, 70), positiveOnly };
      return;
  }
}

/** PathFinder.buildDistanceMap over what is not solid (or, `passableToo`, also what can be walked). */
function distanceMap(ctx: Ctx, from: number, limit: number, passableToo = false): Int32Array {
  const map = ctx.level.map;
  const open = (cell: number): boolean => !hasFlag(map[cell]!, F.SOLID) || (passableToo && hasFlag(map[cell]!, F.PASSABLE));
  const dist = new Int32Array(LENGTH).fill(-1);
  dist[from] = 0;
  const queue = [from];
  for (let head = 0; head < queue.length; head++) {
    const cell = queue[head]!;
    if (dist[cell]! >= limit) continue;
    for (const n of NEIGHBOURS8) {
      const next = cell + n;
      if (next < 0 || next >= LENGTH || dist[next]! >= 0 || distance(cell, next) !== 1 || !open(next)) continue;
      dist[next] = dist[cell]! + 1;
      queue.push(next);
    }
  }
  return dist;
}

const mobFlies = (mob: Mob): boolean => (mob.levitating ?? 0) > 0 || mobStats(mob).flying === true;

/**
 * ScrollOfTeleportation.teleportChar: somewhere else on the level (out of the hero's sight, for the
 * hero), rid of roots; the immovable stay.
 */
export function teleportChar(ctx: Ctx, ch: Char): boolean {
  if (hasProp(ch, 'immovable')) return false;
  const fov = isHero(ch) ? heroView(ctx.world, ch) : null;
  const to = randomRespawnCell(ctx.rng, ctx.world, ctx.level, (cell) => !fov || !fov[cell]);
  if (to < 0 || charAt(ctx.world, ctx.depth, to)) {
    if (isHero(ch)) ctx.effects.push({ type: 'wand', hero: ch.id, note: 'noTele' });
    return false;
  }
  const from = ch.pos;
  ch.pos = to;
  leaveCell(ctx.world, ctx.level, ctx.depth, from);
  enterCell(ctx.level, to);
  ch.rooted = 0;
  if (isHero(ch)) ctx.effects.push({ type: 'teleported', hero: ch.id });
  else ctx.effects.push({ type: 'jumped', depth: ctx.depth, mob: ch.id, from, to });
  return true;
}

/**
 * Freezing.freeze (a ChillingTrap's cloud, for a moment): chill, three turns (five in water), up to
 * Chill.DURATION; at that, frozen; the frozen stay frozen. What lies there freezes; fire goes out.
 */
function freezing(ctx: Ctx, cell: number): void {
  const ch = charAt(ctx.world, ctx.depth, cell);
  if (ch && isAlive(ch)) {
    if ((ch.frozen ?? 0) > 0) ch.frozen = (ch.frozen ?? 0) + 2;
    else {
      const add = Math.min(ctx.level.map[cell]! >= T.WATER_TILES ? 5 : 3, Math.max(0, 10 - (ch.chill ?? 0)));
      if (add > 0) chill(ch, add);
      if ((ch.chill ?? 0) >= 10) freeze(ctx, ch, FROST_TURNS);
    }
  }
  freezeHeaps(ctx, cell, 0);
}

/** Electricity (a ShockingTrap's, as one jolt): whoever is there is stunned for a while, and hurt a little. */
function shock(ctx: Ctx, cell: number, power: number, user: Hero): void {
  const ch = charAt(ctx.world, ctx.depth, cell);
  if (!ch || !isAlive(ch)) return;
  ch.paralysed = Math.max(ch.paralysed ?? 0, power);
  const damage = Math.round(ctx.rng.floatMax(2 + ctx.depth / 5));
  if (damage > 0) {
    ctx.effects.push({ type: 'hurt', depth: ctx.depth, who: ch.id, damage });
    hurt(ctx, ch, damage, isHero(ch) ? 'lightning' : user);
  }
}

/**
 * Bomb.ConjuredBomb.explode: a blast reaching a cell around (through what is open or burns); what
 * burns is gone, what lies there burns, and everyone caught takes a bomb's damage less their armour.
 */
export function conjuredBomb(ctx: Ctx, cell: number, user: Hero, harmsAllies: boolean): void {
  const map = ctx.level.map;
  ctx.effects.push({ type: 'exploded', depth: ctx.depth, pos: cell });
  const affected: Char[] = [];
  for (const n of NEIGHBOURS9) {
    const c = cell + n;
    if (c < 0 || c >= LENGTH || (hasFlag(map[c]!, F.SOLID) && !hasFlag(map[c]!, F.FLAMABLE))) continue;
    if (hasFlag(map[c]!, F.FLAMABLE)) destroyCell(ctx, c);
    burnHeaps(ctx, c, 0);
    const ch = charAt(ctx.world, ctx.depth, c);
    if (ch) affected.push(ch);
  }
  for (const ch of affected) {
    if (!isAlive(ch) || (!harmsAllies && (isHero(ch) || ch.ally))) continue;
    const damage = ctx.rng.normalIntRange(4 + ctx.depth, 12 + 3 * ctx.depth) - armorRoll(ctx, ch);
    if (damage <= 0) continue;
    ctx.effects.push({ type: 'hurt', depth: ctx.depth, who: ch.id, damage });
    hurt(ctx, ch, damage, isHero(ch) ? 'bomb' : user);
  }
}

/**
 * GeyserTrap.activate: water bursts out within two cells (most of the outer ring), putting out fire;
 * everyone around is thrown back two cells, and whoever stood on it in some direction.
 */
function geyser(ctx: Ctx, pos: number, user: Hero): void {
  const { level, rng } = ctx;
  const dist = distanceMap(ctx, pos, 2);
  for (let cell = 0; cell < LENGTH; cell++) {
    if (dist[cell]! < 0) continue;
    if (dist[cell]! === 2 && rng.int(3) === 0) continue;
    const terrain = level.map[cell]!;
    // Level.setCellToWater: open ground (not a trap, a well, the stairs) floods.
    if (terrain === T.EMPTY || terrain === T.EMPTY_DECO || terrain === T.GRASS || terrain === T.EMBERS || terrain === T.HIGH_GRASS || terrain === T.EMPTY_SP) {
      level.map[cell] = T.WATER;
    }
  }
  ctx.effects.push({ type: 'burst', depth: ctx.depth, pos, kind: 'frost', radius: 2, silent: true });
  for (const n of NEIGHBOURS8) {
    const ch = charAt(ctx.world, ctx.depth, pos + n);
    if (!ch || !isAlive(ch)) continue;
    if (hasProp(ch, 'fiery')) {
      const damage = Math.trunc(rng.normalIntRange(5 + ctx.depth, 10 + ctx.depth * 2) * 0.67);
      ctx.effects.push({ type: 'hurt', depth: ctx.depth, who: ch.id, damage });
      hurt(ctx, ch, damage, user);
    }
    if (!isAlive(ch)) continue;
    ch.burning = 0;
    const trace = ballistica(ctx, pos, ch.pos, STOP_TARGET);
    throwChar(ctx, ch, ballistica(ctx, trace.collisionPos, trace.path[trace.path.length - 1]!, PROJECTILE), 2, true, true);
  }
  const ch = charAt(ctx.world, ctx.depth, pos);
  if (ch && isAlive(ch)) {
    let towards = -1;
    if (isHero(ch)) {
      const safe = NEIGHBOURS8.filter((n) => !hasFlag(level.map[pos + n]!, F.AVOID) && !hasFlag(level.map[pos + 2 * n]!, F.AVOID));
      if (safe.length > 0) towards = pos + safe[rng.int(safe.length)]!;
    } else {
      towards = pos + NEIGHBOURS8[rng.int(8)]!;
    }
    if (towards >= 0) {
      ch.burning = 0;
      throwChar(ctx, ch, ballistica(ctx, pos, towards, MAGIC_BOLT), 2, true, true);
    }
  }
}

/** FlockTrap.activate: magic sheep on every free cell within two, for six turns; each presses its cell. */
function flock(ctx: Ctx, pos: number): void {
  const dist = distanceMap(ctx, pos, 2);
  const cells: number[] = [];
  const sheep: Mob[] = [];
  for (let cell = 0; cell < LENGTH; cell++) {
    if (dist[cell]! < 0 || charAt(ctx.world, ctx.depth, cell) || hasFlag(ctx.level.map[cell]!, F.PIT)) continue;
    const one = createMob(`#${++ctx.world.nextId}`, 'sheep', cell, 'passive', ctx.floor.now + 1);
    one.lifespan = 6;
    ctx.floor.mobs.push(one);
    enterCell(ctx.level, cell);
    cells.push(cell);
    sheep.push(one);
  }
  ctx.effects.push({ type: 'flock', depth: ctx.depth, cells });
  // Before the sheep stand there, the traps under them go off (and plants).
  for (const one of sheep) pressCell(ctx, one.pos);
}

/**
 * SpawnGoldenMimic: a golden mimic springs up where the bolt landed (or beside whoever stands there),
 * holding a weapon, armour, ring or wand of +1 or better.
 */
function goldenMimic(ctx: Ctx, pos: number, positiveOnly: boolean): void {
  const { rng, world, depth, level, floor } = ctx;
  let cell = pos;
  if (charAt(world, depth, pos)) {
    const free = NEIGHBOURS8.map((n) => pos + n).filter((c) => hasFlag(level.map[c]!, F.PASSABLE) && !charAt(world, depth, c));
    if (free.length === 0) return;
    cell = free[rng.int(free.length)]!;
  }
  const mimic = scaleMob(world, createMob(`#${++world.nextId}`, 'mimic', cell, 'hunting', floor.now + 1));
  // GoldenMimic: as strong as a mimic a third deeper.
  mimic.level = Math.round(depth * 1.33);
  mimic.ht = mimic.hp = mobStats(mimic).ht;
  mimic.enemySeen = true;
  if (!positiveOnly) {
    let reward: Item;
    do {
      reward = new ItemGenerator(rng, depth).of(rng.oneOf(['weapon', 'armor', 'ring', 'wand'] as const));
    } while (reward.level < 1 || itemDef(reward.kind).category === 'missile');
    mimic.loot = [reward];
  }
  floor.mobs.push(mimic);
  enterCell(level, cell);
  ctx.effects.push({ type: 'mimic', depth, mob: mimic.id, hero: world.heroes[0]?.id ?? '' });
}

/* The lingering effects, on the hero's turns (CursedWand's trackers) */

/**
 * SuperNovaTracker, GravityChaosTracker and PitfallTrap.DelayedPit, a turn at a time: a supernova
 * grows for ten turns, then a bomb goes off on every open cell it reaches; gravity throws everyone
 * about every few turns; the ground around gives way after a turn.
 */
export function cursedTurn(ctx: Ctx, hero: Hero): void {
  const nova = hero.supernova;
  if (nova && hero.depth === ctx.depth) {
    nova.turns--;
    ctx.effects.push({ type: 'supernova', depth: ctx.depth, pos: nova.pos, turns: Math.max(0, nova.turns) });
    if (nova.turns < 0) {
      delete hero.supernova;
      const fov = castShadow(nova.pos, (cell) => hasFlag(ctx.level.map[cell]!, F.SOLID), 8);
      for (let cell = 0; cell < LENGTH; cell++) {
        if (!fov[cell] || hasFlag(ctx.level.map[cell]!, F.SOLID)) continue;
        conjuredBomb(ctx, cell, hero, nova.harmsAllies);
        if (!isAlive(hero)) return;
      }
    }
  }
  const gravity = hero.gravity;
  if (gravity && (gravity.next ?? 0) <= 0) {
    const dir = NEIGHBOURS8[ctx.rng.int(NEIGHBOURS8.length)]!;
    const chars: Char[] = [...ctx.world.heroes.filter((h) => h.depth === ctx.depth && isAlive(h)), ...ctx.floor.mobs];
    let blocked: Char[] = [];
    for (const ch of chars) {
      if (hasProp(ch, 'immovable') || (gravity.positiveOnly && (isHero(ch) || ch.ally))) continue;
      if (!isHero(ch) && ch.state === 'sleeping') ch.state = 'wandering';
      const path = ballistica(ctx, ch.pos, ch.pos + dir, MAGIC_BOLT);
      if (path.dist === 1 && charAt(ctx.world, ctx.depth, path.collisionPos)) blocked.push(ch);
      else throwChar(ctx, ch, path, 3, false, false);
    }
    // Those blocked by someone who has since moved go on.
    for (let pass = 0; pass < 8 && blocked.length > 0; pass++) {
      const still: Char[] = [];
      for (const ch of blocked) {
        const path = ballistica(ctx, ch.pos, ch.pos + dir, MAGIC_BOLT);
        if (path.dist === 1 && charAt(ctx.world, ctx.depth, path.collisionPos)) still.push(ch);
        else throwChar(ctx, ch, path, 3, false, false);
      }
      if (still.length === blocked.length) break;
      blocked = still;
    }
    gravity.turns--;
    gravity.next = ctx.rng.intRange(1, 3);
    if (gravity.turns <= 0) {
      delete hero.gravity;
      ctx.effects.push({ type: 'wand', hero: hero.id, note: 'gravityEnd' });
    }
  } else if (gravity) {
    gravity.next = (gravity.next ?? 1) - 1;
  }
  const sink = hero.sinkhole;
  if (sink && --sink.turns < 0) {
    delete hero.sinkhole;
    if (sink.depth !== ctx.depth) return;
    let fell = false;
    for (const cell of sink.cells) {
      if (hasFlag(ctx.level.map[cell]!, F.SOLID) && !hasFlag(ctx.level.map[cell]!, F.PASSABLE)) continue;
      const ch = charAt(ctx.world, ctx.depth, cell);
      if (ch && isAlive(ch)) {
        if (isHero(ch)) fell = ch === hero || fell;
        else if (!mobFlies(ch) && !(ch.state === 'passive' && hasProp(ch, 'immovable'))) mobFall(ctx, ch);
      }
      const heap = ctx.floor.heaps.find((h) => h.pos === cell);
      if (heap && heap.kind !== 'forSale' && heap.kind !== 'lockedChest' && heap.kind !== 'crystalChest') {
        (ctx.floor.falling ??= []).push(...heap.items);
        ctx.floor.heaps.splice(ctx.floor.heaps.indexOf(heap), 1);
      }
    }
    ctx.effects.push({ type: 'sinkhole', depth: ctx.depth, cells: sink.cells });
    if (fell && !(hero.levitating ?? 0)) heroFall(ctx, hero);
  }
}
