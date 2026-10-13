import { COMMON_ENCHANTMENTS, COMMON_GLYPHS, isCurseEnchant, isCurseGlyph, RARE_ENCHANTMENTS, RARE_GLYPHS, UNCOMMON_ENCHANTMENTS, UNCOMMON_GLYPHS } from './items';
import { isEnchantable } from './scrolls';
import { isDart } from './missiles';
import { heldWands } from './wands';
import { beckon, type Hero, isAlive, type Mob } from './actors';
import { randomRespawnCell } from './ai';
import { conjureImages, enthrall, prismaticMaxHp } from './allies';
import {
  AMOK_TURNS, BLINDNESS_TURNS, buffsOf, CHARM_TURNS, DREAD_TURNS, DROWSY_TURNS, FORESIGHT_TURNS, isBoss, isMiniboss, MAGIC_IMMUNE_TURNS,
  RECHARGING_TURNS, TERROR_TURNS, WEAKNESS_TURNS,
} from './buffs';
import { hurt } from './combat';
import { fearless } from './enchant';
import { charAt, type Ctx, enterCell, exploredCells, heroView, isPassable, leaveCell } from './floor';
import { castShadow, terrainBlocksSight } from './fov';
import { identify, learn } from './ident';
import {
  type Enchantment, type Glyph, type Item, itemDef, type ItemKind, ITEMS, knownIn, randomEnchantment, randomGlyph, REGULAR_OF,
} from './items';
import { discoverable } from './level/flags';
import { cellX, LENGTH, NEIGHBOURS8, WIDTH } from './level/geometry';
import { RoomType } from './level/room';
import { discover, F, hasFlag, T } from './level/terrain';
import { deriveSeed, Rng } from './rng';
import { mend } from './wear';
import { enchantItem, upgradeItem } from './scrolls';
import { transmuteItem } from './transmute';
import type { World } from './world';
import { moveToDepth } from './world';
import { isBossDepth } from './level/builder';

/*
 * Scrolls as Shattered has them (items/scrolls, exotic): what each does when read (Scroll.doRead). Those read on
 * an item (InventoryScroll: upgrade, identify, remove curse, transmutation; the exotic enchantment) get it from the
 * action, chosen in the client's backpack; the siren's song a cell; the enchantment one of three enchantments.
 * Exotic scrolls are known with their ordinary counterpart.
 */

/** What reading a scroll needs besides itself. */
export interface ScrollUse {
  cell?: number;
  choice?: number;
}

/** Scroll.execute: no reading while blinded, nor while magic will not work. */
export function readProblem(hero: Hero): string | null {
  if (buffsOf(hero).magicImmune) return 'your magic is suppressed';
  if ((hero.blind ?? 0) > 0) return 'you cannot read while blinded';
  return null;
}

/** Why a known scroll cannot be read as asked: the siren's song wants a monster to sing to, the enchantment a choice. */
export function scrollUseProblem(world: World, hero: Hero, kind: ItemKind, known: boolean, use: ScrollUse, target: Item | undefined): string | null {
  if (!known) return null;
  if (kind === 'scroll.enchantment' && target) {
    return use.choice !== undefined && Number.isInteger(use.choice) && use.choice >= 0 && use.choice <= 2 ? null : 'choose an enchantment';
  }
  if (kind === 'scroll.sirensSong') {
    if (use.cell === undefined || !Number.isInteger(use.cell) || use.cell < 0 || use.cell >= LENGTH) return 'choose whom to enthrall';
  }
  return null;
}

/** Scroll.doRead (the scroll has left the pack, and is known now). `target`: the item it is read on, if any. */
export function readScroll(ctx: Ctx, hero: Hero, kind: ItemKind, target: Item | undefined, use: ScrollUse = {}): void {
  const { world } = ctx;
  const fov = heroView(world, hero);
  const inSight = (): Mob[] => ctx.floor.mobs.filter((mob) => fov[mob.pos] && isAlive(mob) && mob.state !== 'passive' && !mob.ally);
  // Scroll.readAnimation: reading gives an invisible hero away.
  hero.invisible = 0;
  switch (kind) {
    case 'scroll.upgrade':
      if (target) upgradeItem(ctx, hero, target);
      return;
    case 'scroll.identify':
      if (target) {
        identify(world, target);
        ctx.effects.push({ type: 'revealed', hero: hero.id, item: target });
      }
      return;
    case 'scroll.removeCurse':
      // ScrollOfRemoveCurse.uncurse: the curse is known, and lifted, a curse enchantment or glyph (and a curse
      // infusion's strength) with it.
      if (target) {
        let lifted = !!target.cursed;
        delete target.curseUnknown;
        delete target.cursed;
        if (isCurseEnchant(target.enchant)) {
          delete target.enchant;
          lifted = true;
        }
        if (isCurseGlyph(target.glyph)) {
          delete target.glyph;
          lifted = true;
        }
        if (lifted) delete target.infused;
        ctx.effects.push({ type: 'scroll', hero: hero.id, kind: 'removeCurse', count: lifted ? 1 : 0 });
      }
      return;
    case 'scroll.transmutation':
      if (target) transmuteHeld(ctx, hero, target);
      return;
    case 'scroll.mirrorImage':
      // ScrollOfMirrorImage.NIMAGES.
      conjureImages(ctx, hero, 2);
      return;
    case 'scroll.recharging':
      // ScrollOfRecharging: wands charge faster for thirty turns.
      // (Recharging: Hero.recharging, which the wands' chargers read, wands.ts.)
      hero.recharging = Math.max(hero.recharging ?? 0, RECHARGING_TURNS);
      ctx.effects.push({ type: 'scroll', hero: hero.id, kind: 'recharging', count: heldWands(hero).length });
      return;
    case 'scroll.teleportation':
      teleportPreferringUnseen(ctx, hero);
      return;
    case 'scroll.lullaby': {
      // ScrollOfLullaby: everyone in sight grows drowsy, the reader too.
      const sleepers = inSight();
      for (const mob of sleepers) buffsOf(mob).drowsy = Math.max(buffsOf(mob).drowsy ?? 0, DROWSY_TURNS);
      buffsOf(hero).drowsy = Math.max(buffsOf(hero).drowsy ?? 0, DROWSY_TURNS);
      ctx.effects.push({ type: 'scroll', hero: hero.id, kind: 'lullaby', count: sleepers.length });
      return;
    }
    case 'scroll.mapping': {
      const map = ctx.level.map;
      const explored = exploredCells(world, hero.depth);
      discoverable(map).forEach((open, i) => {
        if (!open) return;
        explored[i] = true;
        if (hasFlag(map[i]!, F.SECRET)) map[i] = discover(map[i]!);
      });
      ctx.effects.push({ type: 'mapped', hero: hero.id });
      return;
    }
    case 'scroll.rage': {
      // ScrollOfRage: every monster comes for the reader, and those in sight run amok.
      for (const mob of ctx.floor.mobs) {
        beckon(mob, hero.pos);
        if (!mob.ally && fov[mob.pos] && mob.state !== 'passive') mob.amok = Math.max(mob.amok ?? 0, AMOK_TURNS);
      }
      ctx.effects.push({ type: 'scroll', hero: hero.id, kind: 'challenge', count: ctx.floor.mobs.length });
      return;
    }
    case 'scroll.retribution': {
      // ScrollOfRetribution: the more hurt the reader, the harder it strikes everyone in sight (10% of their
      // health, plus up to 90% of what they have left), blinding them; the reader is weakened and blinded.
      const percent = (hero.ht - hero.hp) / hero.ht;
      const power = Math.min(4, 4.45 * percent);
      const targets = ctx.floor.mobs.filter((mob) => fov[mob.pos] && isAlive(mob));
      ctx.effects.push({ type: 'scroll', hero: hero.id, kind: 'psionic', count: targets.length });
      for (const mob of targets) {
        strike(ctx, mob, Math.round(mob.ht / 10 + mob.hp * power * 0.225), hero);
        if (isAlive(mob)) mob.blind = Math.max(mob.blind ?? 0, BLINDNESS_TURNS);
      }
      hero.weakened = Math.max(hero.weakened, WEAKNESS_TURNS);
      hero.blind = Math.max(hero.blind ?? 0, BLINDNESS_TURNS);
      return;
    }
    case 'scroll.terror': {
      const frightened = inSight().filter((mob) => !fearless(mob));
      for (const mob of frightened) frighten(mob, hero);
      ctx.effects.push({ type: 'scroll', hero: hero.id, kind: 'terror', count: frightened.length });
      return;
    }
    // Exotic scrolls
    case 'scroll.enchantment':
      if (target && use.choice !== undefined) {
        const options = enchantOptions(world, hero, target);
        applyEnchantment(ctx, hero, target, options[use.choice]!);
      }
      return;
    case 'scroll.divination':
      divination(ctx, hero);
      return;
    case 'scroll.antiMagic': {
      // ScrollOfAntiMagic: magic will not work on the reader, nor theirs (MagicImmune), and what magic held them lets go.
      const b = buffsOf(hero);
      b.magicImmune = Math.max(b.magicImmune ?? 0, MAGIC_IMMUNE_TURNS);
      delete b.magicalSleep;
      delete b.drowsy;
      hero.charmed = 0;
      hero.charmedBy = null;
      hero.weakened = 0;
      return;
    }
    case 'scroll.prismaticImage': {
      // ScrollOfPrismaticImage: a prismatic image already about is healed; else one waits at the hero's side.
      const image = ctx.floor.mobs.find((mob) => mob.kind === 'prismatic' && mob.owner === hero.id);
      if (image) image.hp = image.ht;
      else buffsOf(hero).prismaticGuard = prismaticMaxHp(hero);
      return;
    }
    case 'scroll.mysticalEnergy':
      // ScrollOfMysticalEnergy: artifacts charge for thirty turns (ArtifactRecharge: the artifacts stream's).
      buffsOf(hero).artifactRecharge = Math.max(buffsOf(hero).artifactRecharge ?? 0, 30);
      return;
    case 'scroll.passage':
      passage(ctx, hero);
      return;
    case 'scroll.sirensSong':
      sirensSong(ctx, hero, use.cell!);
      return;
    case 'scroll.foresight':
      buffsOf(hero).foresight = Math.max(buffsOf(hero).foresight ?? 0, FORESIGHT_TURNS);
      return;
    case 'scroll.challenge': {
      // ScrollOfChallenge: every monster comes for the reader, who fights better in the arena around them.
      for (const mob of ctx.floor.mobs) beckon(mob, hero.pos);
      buffsOf(hero).challenge = { cells: challengeArena(ctx, hero.pos), left: 100 };
      ctx.effects.push({ type: 'scroll', hero: hero.id, kind: 'challenge', count: ctx.floor.mobs.length });
      return;
    }
    case 'scroll.psionicBlast': {
      // ScrollOfPsionicBlast: half of everyone's health and half of what they have left, and blindness; the reader
      // takes half their own health, less the more there were.
      const targets = ctx.floor.mobs.filter((mob) => fov[mob.pos] && isAlive(mob));
      ctx.effects.push({ type: 'scroll', hero: hero.id, kind: 'psionic', count: targets.length });
      for (const mob of targets) {
        strike(ctx, mob, Math.round(mob.ht / 2 + mob.hp / 2), hero);
        if (isAlive(mob)) mob.blind = Math.max(mob.blind ?? 0, BLINDNESS_TURNS);
      }
      const own = Math.max(0, Math.round(hero.ht * 0.5 * 0.9 ** targets.length));
      if (own > 0) {
        ctx.effects.push({ type: 'hurt', depth: ctx.depth, who: hero.id, damage: own });
        hurt(ctx, hero, own, 'psionic');
      }
      if (isAlive(hero)) {
        hero.blind = Math.max(hero.blind ?? 0, BLINDNESS_TURNS);
        hero.weakened = Math.max(hero.weakened, WEAKNESS_TURNS * 5);
      }
      return;
    }
    case 'scroll.dread': {
      // ScrollOfDread: everyone in sight flees in dread, never to return; the fearless are only terrified.
      const struck = inSight();
      for (const mob of struck) {
        if (fearless(mob) || isBoss(mob) || isMiniboss(mob)) {
          if (!fearless(mob)) frighten(mob, hero);
        } else {
          const b = buffsOf(mob);
          b.dread = DREAD_TURNS;
          b.dreadOf = hero.id;
          mob.terror = 0;
        }
      }
      ctx.effects.push({ type: 'scroll', hero: hero.id, kind: 'terror', count: struck.length });
      return;
    }
    case 'scroll.metamorphosis':
      // ScrollOfMetamorphosis: a talent swapped for another class's (talents.ts's to fill in; until then it is read in vain).
      ctx.effects.push({ type: 'metamorphosis', hero: hero.id });
      return;
    default:
      return;
  }
}

/** Terror: running from the reader for a while. */
function frighten(mob: Mob, hero: Hero): void {
  mob.terror = TERROR_TURNS;
  mob.terrorOf = hero.id;
  if (mob.state === 'sleeping') mob.state = 'hunting';
}

function strike(ctx: Ctx, mob: Mob, damage: number, hero: Hero): void {
  if (damage <= 0) return;
  ctx.effects.push({ type: 'hurt', depth: ctx.depth, who: mob.id, damage });
  hurt(ctx, mob, damage, hero);
}

/* Transmutation (ScrollOfTransmutation.onItemSelected) */

/** ScrollOfTransmutation.usableOnItem. */
export function transmutable(world: World, item: Item, reading?: ItemKind): boolean {
  const category = itemDef(item.kind).category;
  switch (category) {
    case 'weapon':
      return true;
    case 'missile':
      // ScrollOfTransmutation: a thrown weapon of another kind of its tier (no dart; transmute.ts, the gear stream's).
      return !isDart(item.kind);
    case 'potion':
      return true;
    case 'scroll':
      return item.kind !== reading || item.qty > 1 || !knownIn(world.known, item.kind);
    case 'ring':
    case 'wand':
    case 'trinket':
    case 'seed':
    case 'stone':
      return true;
    default:
      return false;
  }
}

/** The item transmuted where it is: in hand, worn, or in the pack (a whole stack of thrown weapons). */
function transmuteHeld(ctx: Ctx, hero: Hero, item: Item): void {
  const result = transmuteItem(item, ctx.rng, ctx.depth);
  if (!result) return;
  if (hero.weapon === item) {
    hero.weapon = result;
  } else if (hero.ring === item || hero.misc === item || hero.artifact === item) {
    // A worn ring (or artifact) changes in its slot.
    if (hero.ring === item) hero.ring = result;
    else if (hero.misc === item) hero.misc = result;
    else hero.artifact = result;
  } else {
    const index = hero.items.indexOf(item);
    if (index < 0) return;
    const whole = itemDef(item.kind).category === 'missile' || item.qty <= 1;
    if (whole) hero.items.splice(index, 1);
    else item.qty--;
    const stack = hero.items.find((other) => other.kind === result.kind && itemDef(other.kind).category !== 'missile' && other !== item &&
      ['potion', 'scroll', 'seed', 'stone'].includes(itemDef(other.kind).category));
    if (stack) stack.qty += result.qty;
    else hero.items.push(result);
  }
  ctx.effects.push({ type: 'transmuted', hero: hero.id, from: item, to: result });
}

/* Teleportation (ScrollOfTeleportation) */

/** ScrollOfTeleportation.appear: a character is somewhere else at once (pressing nothing). */
export function appear(ctx: Ctx, char: Hero | Mob, pos: number): void {
  const from = char.pos;
  char.pos = pos;
  leaveCell(ctx.world, ctx.level, ctx.depth, from);
  enterCell(ctx.level, pos);
  char.rooted = 0;
  if ('heroClass' in char) ctx.effects.push({ type: 'teleported', hero: char.id });
  else ctx.effects.push({ type: 'jumped', depth: ctx.depth, mob: char.id, from, to: pos });
}

/** ScrollOfTeleportation.teleportChar: somewhere random on the level (Level.randomRespawnCell, never hidden). */
export function teleportChar(ctx: Ctx, char: Hero | Mob): boolean {
  if (!('heroClass' in char) && ['yog', 'rottingFist', 'burningFist'].includes(char.kind)) return false;
  for (let count = 0; count < 20; count++) {
    const pos = randomRespawnCell(ctx.rng, ctx.world, ctx.level, (cell) => cell !== char.pos);
    if (pos !== -1 && !hasFlag(ctx.level.map[pos]!, F.SECRET)) {
      appear(ctx, char, pos);
      return true;
    }
  }
  return false;
}

/** ScrollOfTeleportation.teleportToLocation: to a chosen cell, if it can be walked to and nobody stands there. */
export function teleportToLocation(ctx: Ctx, char: Hero | Mob, pos: number): boolean {
  const map = ctx.level.map;
  const walkable = (cell: number): boolean => hasFlag(map[cell]!, F.PASSABLE) || hasFlag(map[cell]!, F.AVOID);
  if (!walkable(pos)) return false;
  const there = charAt(ctx.world, ctx.depth, pos);
  if (there && there !== char) return false;
  // PathFinder.buildDistanceMap(pos, passable or avoid): it has to be reachable on foot.
  const seen = new Set([pos]);
  const queue = [pos];
  let reached = false;
  for (let head = 0; head < queue.length && !reached; head++) {
    const cell = queue[head]!;
    for (const n of NEIGHBOURS8) {
      const next = cell + n;
      if (next < 0 || next >= LENGTH || seen.has(next) || Math.abs(cellX(next) - cellX(cell)) > 1) continue;
      if (next === char.pos) reached = true;
      if (!walkable(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  if (!reached) return false;
  appear(ctx, char, pos);
  return true;
}

/**
 * ScrollOfTeleportation.teleportPreferringUnseen: somewhere in a room the party has not seen yet (but none locked
 * away), else anywhere; on a level without rooms, anywhere it can reach.
 */
export function teleportPreferringUnseen(ctx: Ctx, hero: Hero): boolean {
  const { level, world } = ctx;
  const explored = exploredCells(world, hero.depth);
  const candidates: number[] = [];
  const locked: ReadonlySet<number> = new Set([T.LOCKED_DOOR, T.BARRICADE]);
  for (const room of level.rooms) {
    if (room.type !== RoomType.STANDARD && room.type !== RoomType.TUNNEL && room.type !== RoomType.PASSAGE &&
      room.type !== RoomType.ENTRANCE && room.type !== RoomType.EXIT) {
      let shut = false;
      for (let y = room.top; y <= room.bottom && !shut; y++) {
        for (let x = room.left; x <= room.right; x++) if (locked.has(level.map[x + y * WIDTH]!)) shut = true;
      }
      if (shut) continue;
    }
    for (let y = room.top + 1; y < room.bottom; y++) {
      for (let x = room.left + 1; x < room.right; x++) {
        const cell = x + y * WIDTH;
        if (isPassable(level, cell) && !explored[cell] && !hasFlag(level.map[cell]!, F.SECRET) && !charAt(world, ctx.depth, cell)) candidates.push(cell);
      }
    }
  }
  if (candidates.length === 0) return teleportChar(ctx, hero);
  appear(ctx, hero, ctx.rng.element(candidates)!);
  return true;
}

/** ScrollOfPassage: back to the first floor of this part of the dungeon (the one before, from its first floor). */
function passage(ctx: Ctx, hero: Hero): void {
  if (!interfloorAllowed(ctx, hero)) {
    ctx.effects.push({ type: 'interrupted', hero: hero.id, reason: 'a strong force prevents you from leaving' });
    return;
  }
  const depth = Math.max(1, hero.depth - 1 - ((hero.depth - 2) % 5));
  moveToDepth(ctx.world, hero, depth);
  ctx.effects.push({ type: 'teleported', hero: hero.id });
}

/** Dungeon.interfloorTeleportAllowed: not out of a boss's locked lair while it lives. */
export function interfloorAllowed(ctx: Ctx, hero: Hero): boolean {
  if (!isBossDepth(hero.depth)) return true;
  return !ctx.floor.mobs.some(isBoss);
}

/** ScrollOfChallenge.ChallengeArena.setup: up to three steps around the reader, fewer in a cramped place. */
function challengeArena(ctx: Ctx, pos: number): number[] {
  let dist: number;
  if ([5, 10, 20].includes(ctx.depth)) {
    dist = 1;
  } else {
    const seen = castShadow(pos, terrainBlocksSight(ctx.level.map), 8).filter(Boolean).length;
    dist = seen < 30 ? 1 : seen >= 100 ? 3 : 2;
  }
  const map = ctx.level.map;
  const walkable = (cell: number): boolean => hasFlag(map[cell]!, F.PASSABLE) || hasFlag(map[cell]!, F.AVOID);
  const steps = new Map<number, number>([[pos, 0]]);
  const queue = [pos];
  for (let head = 0; head < queue.length; head++) {
    const cell = queue[head]!;
    if (steps.get(cell)! >= dist) continue;
    for (const n of NEIGHBOURS8) {
      const next = cell + n;
      if (next < 0 || next >= LENGTH || steps.has(next) || Math.abs(cellX(next) - cellX(cell)) > 1 || !walkable(next)) continue;
      steps.set(next, steps.get(cell)! + 1);
      queue.push(next);
    }
  }
  return [...steps.keys()].sort((a, b) => a - b);
}

/**
 * ScrollOfSirensSong: the monster chosen is the hero's ally from now on (a boss only charmed); everyone else in
 * sight is charmed. Read on nobody, the others are still charmed.
 */
function sirensSong(ctx: Ctx, hero: Hero, cell: number): void {
  const fov = heroView(ctx.world, hero);
  const there = charAt(ctx.world, ctx.depth, cell);
  const target = there && !('heroClass' in there) && !there.ally && there.state !== 'passive' ? there : undefined;
  for (const mob of ctx.floor.mobs) {
    if (mob === target || mob.ally || !fov[mob.pos] || mob.state === 'passive') continue;
    charm(mob, hero);
  }
  if (!target) {
    ctx.effects.push({ type: 'interrupted', hero: hero.id, reason: 'the song finds nobody to enthrall' });
    return;
  }
  if (isBoss(target) || isMiniboss(target)) charm(target, hero);
  else enthrall(ctx, target, hero);
}

function charm(mob: Mob, hero: Hero): void {
  mob.charmed = Math.max(mob.charmed ?? 0, CHARM_TURNS);
  mob.charmedBy = hero.id;
}

/**
 * ScrollOfDivination: four kinds of potion, scroll or ring the party does not know yet are known now, drawn by
 * thirds from each (Random.chances over 3, 3, 3, a kind less each time).
 */
function divination(ctx: Ctx, hero: Hero): void {
  const { world, rng } = ctx;
  const unknown = (category: string): ItemKind[] =>
    (Object.keys(ITEMS) as ItemKind[]).filter((k) => itemDef(k).category === category && !REGULAR_OF[k] && itemDef(k).sprite === undefined &&
      !world.known.includes(k));
  const pools = [unknown('potion'), unknown('scroll'), unknown('ring')];
  let total = pools.reduce((n, pool) => n + pool.length, 0);
  let left = 4;
  const base = [3, 3, 3];
  let probs = [...base];
  const learned: ItemKind[] = [];
  while (left > 0 && total > 0) {
    const i = probs.some((p) => p > 0) ? rng.chances(probs) : -1;
    if (i === -1) {
      probs = [...base];
      continue;
    }
    const pool = pools[i]!;
    if (pool.length === 0) {
      probs[i] = 0;
      continue;
    }
    probs[i]!--;
    const kind = pool.splice(rng.int(pool.length), 1)[0]!;
    learn(world, kind);
    learned.push(kind);
    left--;
    total--;
  }
  ctx.effects.push({ type: 'divined', hero: hero.id, kinds: learned });
}

/* Enchantment (ScrollOfEnchantment) */

/** ScrollOfEnchantment.enchantable: what can be enchanted or inscribed (the gear stream's isEnchantable). */
export const enchantable = (item: Item): boolean => isEnchantable(item);

/** The enchantments' and glyphs' rarity (Weapon.Enchantment and Armor.Glyph common, uncommon, rare; items.ts). */
const enchantTiers = (): readonly (readonly Enchantment[])[] => [COMMON_ENCHANTMENTS, UNCOMMON_ENCHANTMENTS, RARE_ENCHANTMENTS];
const glyphTiers = (): readonly (readonly Glyph[])[] => [COMMON_GLYPHS, UNCOMMON_GLYPHS, RARE_GLYPHS];

/**
 * The three enchantments (or glyphs) a scroll of enchantment offers for an item: a common one, an uncommon one, and
 * any other (Enchantment.randomCommon, randomUncommon, random), never what it has. Drawn from a stream fixed by the
 * world's turn, so the client shows the very choice the rules will make.
 */
export function enchantOptions(world: World, hero: Hero, item: Item): Array<Enchantment | Glyph> {
  const rng = Rng.seeded(deriveSeed(world.run.seed, ENCHANT_STREAM, world.turn, hero.depth));
  const armor = itemDef(item.kind).category === 'armor';
  const existing = armor ? item.glyph : item.enchant;
  const tiers: readonly (readonly string[])[] = armor ? glyphTiers() : enchantTiers();
  const from = (pool: readonly string[], except: readonly (string | undefined)[]): string => {
    const choices = pool.filter((e) => !except.includes(e));
    return choices[rng.int(choices.length)]!;
  };
  const common = from(tiers[0]!, [existing]);
  const uncommon = from(tiers[1]!, [existing]);
  let any: string;
  do {
    any = armor ? randomGlyph(rng, existing as Glyph | undefined) : randomEnchantment(rng, existing as Enchantment | undefined);
  } while (any === common || any === uncommon);
  return [common, uncommon, any] as Array<Enchantment | Glyph>;
}

const ENCHANT_STREAM = 76;

/** WndEnchantSelect.onSelect: the item takes the chosen enchantment (or glyph), and comes out mended. */
function applyEnchantment(ctx: Ctx, hero: Hero, item: Item, magic: Enchantment | Glyph): void {
  if (itemDef(item.kind).category === 'armor') item.glyph = magic as Glyph;
  else item.enchant = magic as Enchantment;
  mend(item);
  ctx.effects.push({ type: 'imbued', hero: hero.id, item });
}

/** For stones of enchantment: a random enchantment or glyph, as the scroll of enchantment did of old. */
export const enchantRandomly = enchantItem;

