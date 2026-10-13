import { type Hero, isAlive, type Mob, type MobKind } from './actors';
import { BRANCH_GATES } from './branchgates';
import { burnHeaps } from './cooking';
import { hurt } from './combat';
import { ballistica, coneAOE, insideMap, PF_NEIGHBOURS8, STOP_SOLID, STOP_TARGET, subPath, WONT_STOP } from './cone';
import {
  type Char, charAt, type Ctx, discoverCell, dropItem, enterCell, exploredCells, type Floor, heroesOn, heroView, isHero, leaveCell, observe,
} from './floor';
import { castShadow, terrainBlocksSight, viewDistance } from './fov';
import { completeImpQuest, heroLives, isUnique } from './imp';
import { collect } from './inventory';
import { type Item, itemDef } from './items';
import { discoverable } from './level/flags';
import type { Level } from './level/generate';
import { adjacent, cellX, cellY, LENGTH, WIDTH } from './level/geometry';
import { F, hasFlag, T } from './level/terrain';
import { addQuestScore } from './quest';
import { itemAt, type ItemRef } from './scrolls';
import type { VaultFlameSpawn, VaultFloor } from './vault-types';
import { bossSpellsTurn, summonBoss } from './vaultboss';
import type { World } from './world';

/*
 * The dwarven vault at play (VaultLevel, its characters and quest items, Shattered v4): the scanning
 * sentries and disintegration sentries, the flame vents (VaultFlameTraps), the strange mirror and the
 * strange door, the vault beacons, the final room and its greater elemental, and the escape crystal
 * that ends the heist with a score and one thing to keep. The guards' stealthy ways are vaultmobs.ts,
 * the elemental vaultboss.ts, the level itself level/gen/vault-level.ts.
 */

const TICK = 1;
const f32 = Math.fround;

/** The vault: the side level below the imp's room (depths 17-19, where it is the only one). */
export const isVault = (level: Level): boolean => (level.branch ?? 0) === 1 && level.depth >= 17 && level.depth <= 19;

/** The vault's fixtures, which are no monsters (NPC): immovable, never hurt. */
export const VAULT_NPCS: ReadonlySet<MobKind> = new Set<MobKind>(['vaultSentry', 'vaultLaser', 'vaultMirror', 'vaultTokenDoor']);

/** The heroes, and their mirror images (Char.Alignment.ALLY), on a cell: what the hazards strike. */
function allyAt(ctx: Ctx, cell: number): Char | undefined {
  const char = charAt(ctx.world, ctx.depth, cell);
  if (!char || !isAlive(char)) return undefined;
  return isHero(char) || char.kind === 'mirror' ? char : undefined;
}

/** Level.heroFOV: what the heroes on the depth see. */
function heroFov(ctx: Ctx): boolean[] {
  const fov = new Array<boolean>(LENGTH).fill(false);
  for (const hero of heroesOn(ctx.world, ctx.depth)) heroView(ctx.world, hero).forEach((seen, i) => {
    if (seen) fov[i] = true;
  });
  return fov;
}

/** Hit by a hazard (a scan, a ray, a vent): the first two cost the quest nothing, then a hundred points each. */
export function hazardHit(world: World): void {
  const quest = world.impQuest;
  if (quest && quest.hazardFreebies > 0) quest.hazardFreebies--;
  else addQuestScore(world, 3, -100);
}

/** The greater elemental's spells and blows cost the quest a hundred points each (Statistics.questScores[3]). */
export const bossPenalty = (world: World): void => addQuestScore(world, 3, -100);

/* The level's turn */

/**
 * The vault's floor, as the level was made: the flame vents (VaultFlameTraps' cooldowns) and the final
 * room's doors (VaultFinalRoom.entryDoor and lockedDoor, found again on the map).
 */
export function spawnVaultFloor(level: Level, floor: Floor): void {
  if (!isVault(level) || floor.vault) return;
  const blobs = level.spawn?.blobs ?? [];
  const vents = blobs
    .filter((b) => b.kind === 'VaultFlameTraps')
    .map((b) => {
      const spawn = b as VaultFlameSpawn;
      return { cell: spawn.cell, cur: spawn.initialCD, after: spawn.afterTriggerCD, triggers: spawn.triggers };
    })
    .sort((a, b) => a.cell - b.cell);
  if (level.spawn) level.spawn.blobs = blobs.filter((b) => b.kind !== 'VaultFlameTraps');
  const vault: VaultFloor = { at: floor.now, vents, flames: [], spells: [] };
  const room = level.rooms.find((r) => r.kind === 'VaultFinalRoom');
  if (room) {
    const cx = Math.trunc((room.left + room.right) / 2);
    const cy = Math.trunc((room.top + room.bottom) / 2);
    const at = (x: number, y: number): number => x + y * WIDTH;
    const pairs: Array<[number, number]> = [
      [at(room.left + 4, cy), at(room.right - 4, cy)],
      [at(cx, room.top + 4), at(cx, room.bottom - 4)],
    ];
    for (const [a, b] of pairs) {
      if (level.map[a] === T.LOCKED_DOOR) vault.final = { center: at(cx, cy), entryDoor: b, lockedDoor: a, warnState: 0, lockTriggered: false };
      else if (level.map[b] === T.LOCKED_DOOR) vault.final = { center: at(cx, cy), entryDoor: a, lockedDoor: b, warnState: 0, lockTriggered: false };
    }
  }
  floor.vault = vault;
}

/** When the vault's own turn next comes, if the depth is the vault. */
export const vaultTurnAt = (floor: Floor): number | undefined => floor.vault?.at;

/** The vault's turn: the flame vents (VaultFlameTraps.act), the elemental's spells, the imp's word about being hurt. */
export function vaultTurn(ctx: Ctx): void {
  const vault = ctx.floor.vault;
  if (!vault) return;
  vault.at += TICK;
  flameVents(ctx, vault);
  bossSpellsTurn(ctx, vault);
  if (vault.resist) {
    for (const id of Object.keys(vault.resist)) if (--vault.resist[id]! <= 0) delete vault.resist[id];
  }
  injureWarning(ctx, vault);
}

/**
 * VaultFlameTraps.act: the flames burn (Blob.evolve: whoever stands in them catches fire, a heap burns, a
 * plant withers; a hero hit costs the quest), then every vent counts down and, at nothing, lets its next
 * flames out for the turn after (they show the turn before, as a warning).
 */
function flameVents(ctx: Ctx, vault: VaultFloor): void {
  const burning: number[] = [];
  const next: Array<[number, number]> = [];
  for (const [cell, amount] of vault.flames) {
    if (amount <= 0) continue;
    burning.push(cell);
    const ch = charAt(ctx.world, ctx.depth, cell);
    if (ch && isAlive(ch) && !flameImmune(ch)) {
      if (isHero(ch)) hazardHit(ctx.world);
      if (!fireImmune(ch)) {
        // Burning.reignite(ch, 4).
        ch.burning = Math.max(ch.burning ?? 0, 4);
      }
      burnHeaps(ctx, cell, 0);
      const plants = ctx.floor.plants ?? [];
      const plant = plants.findIndex((p) => p.pos === cell);
      if (plant >= 0) plants.splice(plant, 1);
    }
    if (amount - 1 > 0) next.push([cell, amount - 1]);
  }
  if (burning.length > 0) ctx.effects.push({ type: 'vaultFlames', depth: ctx.depth, cells: burning });
  vault.flames = next;
  for (const vent of vault.vents) {
    if (vent.cur <= 0) vent.cur = vent.after;
    vent.cur--;
    if (vent.cur <= 0) {
      const at = vault.flames.find(([c]) => c === vent.cell);
      if (at) at[1] += vent.triggers;
      else vault.flames.push([vent.cell, vent.triggers]);
    }
  }
}

/** Immune to the vault's flames themselves (BlobImmunity: a potion of purity's), or the fixtures. */
function flameImmune(ch: Char): boolean {
  if (isHero(ch)) return (ch.gasImmune ?? 0) > 0;
  return VAULT_NPCS.has(ch.kind);
}

/** Immune to fire (Char.isImmune(Fire)): the fire elementals, the greater one in its fiery form. */
export function fireImmune(ch: Char): boolean {
  if (isHero(ch)) return false;
  return ch.kind === 'vaultFireElemental' || (ch.kind === 'vaultBossElemental' && ch.vault?.boss?.form === 'fire');
}

/**
 * Hero.ready in the vault: badly hurt (under a third of their health), the imp speaks up once a run
 * (SPDSettings.vaultInjureWarns: the client says it at most three times on a device).
 */
function injureWarning(ctx: Ctx, vault: VaultFloor): void {
  const quest = ctx.world.impQuest;
  if (!quest || quest.injureWarned) return;
  const hero = heroesOn(ctx.world, ctx.depth).find((h) => h.hp < f32(h.ht * 0.334));
  if (!hero) return;
  quest.injureWarned = true;
  ctx.effects.push({ type: 'vaultInjured', hero: hero.id, locked: vault.locked === true });
}

/* The fixtures (NPC) */

/** A vault fixture's turn (VaultSentry, VaultLaser, VaultMirror, VaultTokenDoor.act). */
export function vaultNpcAct(ctx: Ctx, mob: Mob): void {
  if (mob.kind === 'vaultSentry') sentryAct(ctx, mob);
  else if (mob.kind === 'vaultLaser') laserAct(ctx, mob);
  throwItems(ctx, mob);
  mob.time += TICK;
}

/**
 * Char.throwItems (VaultMirror and VaultTokenDoor: to the cell below): what lies where a fixture stands
 * is moved off it.
 */
function throwItems(ctx: Ctx, mob: Mob): void {
  const index = ctx.floor.heaps.findIndex((h) => h.pos === mob.pos && h.kind === 'heap');
  if (index < 0) return;
  let to: number;
  if (mob.kind === 'vaultMirror' || mob.kind === 'vaultTokenDoor') {
    to = mob.pos + WIDTH;
  } else {
    const candidates = PF_NEIGHBOURS8.map((n) => mob.pos + n).filter((c) => hasFlag(ctx.level.map[c]!, F.PASSABLE) && !charAt(ctx.world, ctx.depth, c));
    if (candidates.length === 0) return;
    to = candidates[ctx.rng.int(candidates.length)]!;
  }
  const heap = ctx.floor.heaps.splice(index, 1)[0]!;
  for (const item of heap.items) dropItem(ctx.floor, to, item);
}

const occupiedIn = (ctx: Ctx) => (cell: number): boolean => charAt(ctx.world, ctx.depth, cell) !== undefined;

/**
 * VaultSentry.act: its cooldown runs down; at nothing, it scans the cone of its current direction(s); if
 * any of it is in the hero's sight, whoever is in it and in its own sight (and not invisible) is struck by
 * lightning: 6-12, or 3-6 if struck the turn before. Then the next direction, and the next cooldown. A
 * warning the turn before, if it gives one.
 */
function sentryAct(ctx: Ctx, mob: Mob): void {
  const v = mob.vault!;
  const fov = castShadow(mob.pos, terrainBlocksSight(ctx.level.map), viewDistance(ctx.depth));
  const seen = heroFov(ctx);
  const occupied = occupiedIn(ctx);
  v.curCooldown = (v.curCooldown ?? 1) - 1;
  const curZaps: string[] = [];
  const scanCells = (dir: number): number[] => {
    const aim = ballistica(ctx.level, occupied, mob.pos, dir, WONT_STOP);
    const cells = coneAOE(ctx.level, occupied, aim, v.scanLength ?? 4, v.scanWidth ?? 90, STOP_SOLID | STOP_TARGET).cells;
    if (cells.length === 0 && aim.path.length >= 2) cells.push(aim.path[1]!);
    return cells;
  };
  const dirs = v.scanDirs ?? [];
  if (v.curCooldown <= 0 && dirs.length > 0) {
    let visible = false;
    for (const dir of dirs[v.scanDirIdx ?? 0] ?? []) {
      const cells = scanCells(dir);
      if (!visible) visible = cells.some((cell) => fov[cell] && seen[cell]);
      if (!visible) continue;
      const checked: number[] = [];
      for (const cell of cells) {
        if (!fov[cell]) continue;
        checked.push(cell);
        const ch = allyAt(ctx, cell);
        if (!ch || (isHero(ch) && ch.invisible > 0)) continue;
        const damage = (v.recentZaps ?? []).includes(ch.id) ? ctx.rng.normalIntRange(3, 6) : ctx.rng.normalIntRange(6, 12);
        curZaps.push(ch.id);
        ctx.effects.push({ type: 'vaultZap', depth: ctx.depth, mob: mob.id, to: cell, who: ch.id });
        ctx.effects.push({ type: 'hurt', depth: ctx.depth, who: ch.id, damage });
        hurt(ctx, ch, damage, mob);
        if (isHero(ch)) hazardHit(ctx.world);
      }
      ctx.effects.push({ type: 'vaultScan', depth: ctx.depth, mob: mob.id, cells: checked });
    }
    v.scanDirIdx = ((v.scanDirIdx ?? 0) + 1) % dirs.length;
    v.scansMade = (v.scansMade ?? 0) + 1;
    if (v.scansMade < (v.scansAfterCooldown ?? 1)) {
      v.curCooldown = 1;
    } else {
      v.scansMade = 0;
      v.curCooldown = v.afterScanCooldown ?? 1;
    }
  }
  v.recentZaps = curZaps;
  if (v.curCooldown === 1 && v.giveWarning && dirs.length > 0) {
    for (const dir of dirs[v.scanDirIdx ?? 0] ?? []) {
      const cells = scanCells(dir);
      if (!cells.some((cell) => seen[cell] && fov[cell])) continue;
      const marked = cells.filter((cell) => fov[cell]);
      ctx.effects.push({ type: 'vaultTarget', depth: ctx.depth, cells: marked });
      // Mainly so the hero does not pick things up while targeted.
      for (const hero of heroesOn(ctx.world, ctx.depth)) ctx.effects.push({ type: 'interrupted', hero: hero.id, reason: 'vault' });
    }
  }
}

/**
 * VaultLaser.act: its cooldown runs down; at nothing, a disintegration ray to the first wall: whatever can
 * burn along it is destroyed, and whoever is in it takes 10-20. Then its next direction and cooldown (a
 * few shots in a row for some); a warning on the cells it will strike the turn before, if it gives one.
 */
function laserAct(ctx: Ctx, mob: Mob): void {
  const v = mob.vault!;
  const occupied = occupiedIn(ctx);
  const dirs = v.laserDirs ?? [];
  if (dirs.length === 0) return;
  v.curCooldown = (v.curCooldown ?? 0) - 1;
  if (v.curCooldown <= 0) {
    const seen = heroFov(ctx);
    const beam = ballistica(ctx.level, occupied, mob.pos, dirs[v.laserDirIdx ?? 0]!, STOP_SOLID);
    let visible = false;
    let observed = false;
    for (const cell of subPath(beam, 1, beam.dist)) {
      if (seen[cell]) visible = true;
      if (hasFlag(ctx.level.map[cell]!, F.FLAMABLE)) {
        // Level.destroy: what can burn becomes embers.
        ctx.level.map[cell] = T.EMBERS;
        ctx.effects.push({ type: 'burnt', depth: ctx.depth, pos: cell });
        observed = true;
      }
      const ch = allyAt(ctx, cell);
      if (ch) {
        const damage = ctx.rng.normalIntRange(10, 20);
        ctx.effects.push({ type: 'hurt', depth: ctx.depth, who: ch.id, damage });
        hurt(ctx, ch, damage, mob);
        if (isHero(ch)) hazardHit(ctx.world);
      }
    }
    if (visible) ctx.effects.push({ type: 'vaultRay', depth: ctx.depth, mob: mob.id, from: mob.pos, to: beam.collisionPos });
    if (observed) for (const hero of heroesOn(ctx.world, ctx.depth)) observe(ctx.world, hero);
    v.laserDirIdx = ((v.laserDirIdx ?? 0) + 1) % dirs.length;
    v.shotsFired = (v.shotsFired ?? 0) + 1;
    if (v.shotsFired < (v.shotsAfterCooldown ?? 1)) {
      v.curCooldown = 1;
    } else {
      v.shotsFired = 0;
      v.curCooldown = v.afterShotCooldown ?? 0;
    }
  }
  if (v.curCooldown === 1 && v.giveWarning) {
    const seen = heroFov(ctx);
    const next = ballistica(ctx.level, occupied, mob.pos, dirs[v.laserDirIdx ?? 0]!, STOP_SOLID);
    const cells = subPath(next, 1, next.dist);
    if (cells.some((cell) => seen[cell])) {
      ctx.effects.push({ type: 'vaultTarget', depth: ctx.depth, cells });
      for (const hero of heroesOn(ctx.world, ctx.depth)) {
        if (cells.includes(hero.pos)) ctx.effects.push({ type: 'interrupted', hero: hero.id, reason: 'vault' });
      }
    }
  }
}

/* Talking to the mirror and the door; the vault's actions */

/** The dwarf tokens a hero carries. */
export const tokensOf = (hero: Hero): number => hero.items.find((item) => item.kind === 'quest.token')?.qty ?? 0;

/** VaultMirror.interact and VaultTokenDoor.interact: the mirror's scene (or nothing), the door's mechanism. */
export function talkToVaultNpc(ctx: Ctx, hero: Hero, mob: Mob): void {
  if (mob.kind === 'vaultMirror') {
    ctx.effects.push({ type: 'vaultMirror', hero: hero.id, mob: mob.id, reward: mob.vault?.reward ?? null });
  } else if (mob.kind === 'vaultTokenDoor') {
    ctx.effects.push({ type: 'vaultDoor', hero: hero.id, mob: mob.id, tokens: tokensOf(hero) });
  }
}

/** What a hero may do in the vault, besides walking and fighting. */
export type VaultAction =
  /** VaultMirror: «Take the item». */
  | { type: 'vault'; op: 'mirror' }
  /** VaultTokenDoor: «Open the door», with ten tokens. */
  | { type: 'vault'; op: 'door' }
  /** VaultBeacon (from the pack): back to the vault's entry. */
  | { type: 'vault'; op: 'beacon'; item: number }
  /** EscapeCrystal (from the pack): out of the vault, with one item kept (as the score allows). */
  | { type: 'vault'; op: 'escape'; keep?: ItemRef };

const fixtureBeside = (world: World, hero: Hero, kind: MobKind): Mob | undefined =>
  world.floors[hero.depth]?.mobs.find((mob) => mob.kind === kind && adjacent(mob.pos, hero.pos));

export function vaultActionProblem(world: World, hero: Hero, action: VaultAction): string | null {
  const level = world.levels[hero.depth];
  switch (action.op) {
    case 'mirror': {
      const mirror = fixtureBeside(world, hero, 'vaultMirror');
      return mirror?.vault?.reward ? null : 'nothing to take';
    }
    case 'door': {
      if (!fixtureBeside(world, hero, 'vaultTokenDoor')) return 'no door here';
      return tokensOf(hero) >= 10 ? null : 'not enough tokens';
    }
    case 'beacon': {
      const beacon = Number.isInteger(action.item) ? hero.items[action.item] : undefined;
      if (beacon?.kind !== 'quest.vaultBeacon') return 'that is no beacon';
      if (!level || !isVault(level)) return 'the beacon does not work here';
      return beaconTarget(world, hero) === null ? 'cant_reach' : null;
    }
    case 'escape': {
      if (!hero.items.some((item) => item.kind === 'quest.escapeCrystal')) return 'no escape crystal';
      if (!level || !isVault(level)) return 'error_start';
      const score = escapeScore(world, hero);
      if (score < 50) return 'leaving_start';
      if (action.keep === undefined) return null;
      if (score < 500) return 'nothing to keep';
      const item = itemAt(hero, action.keep);
      return item && keepable(item, score) ? null : 'that cannot come along';
    }
    default:
      return 'unknown action';
  }
}

/** Performs a vault action: the time it takes, or 'leave' (out of the vault: world.ts takes the hero up). */
export function vaultAction(ctx: Ctx, hero: Hero, action: VaultAction): number | 'leave' {
  switch (action.op) {
    case 'mirror': {
      // VaultMirror: «Take the item» (Item.doPickUp, or at the hero's feet); the mirror is used.
      const mirror = fixtureBeside(ctx.world, hero, 'vaultMirror')!;
      const reward = mirror.vault!.reward!;
      if (collect(hero, reward)) ctx.effects.push({ type: 'pickedUp', hero: hero.id, item: reward });
      else dropItem(ctx.floor, hero.pos, reward);
      mirror.vault!.reward = null;
      if (ctx.world.impQuest) ctx.world.impQuest.mirrorUsed = true;
      ctx.effects.push({ type: 'vaultMirrorTaken', hero: hero.id, item: reward });
      return 1;
    }
    case 'door': {
      // VaultTokenDoor: the tokens merge into the door, which unlocks and is gone; the doorway is seen.
      const door = fixtureBeside(ctx.world, hero, 'vaultTokenDoor')!;
      ctx.floor.mobs.splice(ctx.floor.mobs.indexOf(door), 1);
      ctx.level.map[door.pos] = T.DOOR;
      discoverCell(ctx.level, door.pos);
      exploredCells(ctx.world, ctx.depth)[door.pos] = true;
      hero.items = hero.items.filter((item) => item.kind !== 'quest.token');
      ctx.effects.push({ type: 'vaultDoorOpened', depth: ctx.depth, pos: door.pos, hero: hero.id });
      return 0;
    }
    case 'beacon': {
      // VaultBeacon.onCast: ScrollOfTeleportation.teleportToLocation to the entry.
      const to = beaconTarget(ctx.world, hero)!;
      const beacon = hero.items[action.item]!;
      if (--beacon.qty <= 0) hero.items.splice(action.item, 1);
      leaveCell(ctx.world, ctx.level, ctx.depth, hero.pos);
      hero.pos = to;
      enterCell(ctx.level, to);
      ctx.effects.push({ type: 'teleported', hero: hero.id });
      return 1;
    }
    case 'escape':
      leaveVault(ctx, hero, action.keep);
      return 'leave';
  }
}

/** ScrollOfTeleportation.teleportToLocation to the vault's entry: reachable, open and free; or null. */
function beaconTarget(world: World, hero: Hero): number | null {
  const level = world.levels[hero.depth]!;
  const to = level.transitions?.find((t) => t.type === 'branchEntrance')?.cell ?? level.entrance;
  const open = (cell: number): boolean => hasFlag(level.map[cell]!, F.PASSABLE) || hasFlag(level.map[cell]!, F.AVOID);
  if (!open(to) || charAt(world, hero.depth, to)) return null;
  const seen = new Set([to]);
  const queue = [to];
  for (let head = 0; head < queue.length; head++) {
    const cell = queue[head]!;
    if (cell === hero.pos) return to;
    for (const n of PF_NEIGHBOURS8) {
      const next = cell + n;
      if (!seen.has(next) && insideMap(next) && adjacent(cell, next) && (open(next) || next === hero.pos)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return null;
}

/* The escape crystal */

/** VaultLevel.levelExplorePercent: every hundredth of what can be seen, seen, is 1.25% explored (80% is all of it). */
export function explorePercent(world: World, depth: number): number {
  const level = world.levels[depth]!;
  const visited = world.explored[depth] ?? [];
  const open = discoverable(level.map);
  let seen = 0;
  let total = 0;
  for (let i = 0; i < LENGTH; i++) {
    if (open[i]) total++;
    if (visited[i]) seen++;
  }
  return total === 0 ? 0 : Math.min(1, f32(f32(seen * 1.25) / total));
}

/**
 * EscapeCrystal.execute: the heist's score. The statuette in hand is 4000; otherwise up to 1000 for
 * exploring, 100 a token (up to 1000), or 1250 once the strange door is open, and up to 750 for how
 * hurt the greater elemental is (all 750 once it is gone); rounded down to fifties.
 */
export function escapeScore(world: World, hero: Hero): number {
  if (hero.items.some((item) => item.kind === 'quest.impStatue')) return 4000;
  let score = Math.trunc(f32(1000 * explorePercent(world, hero.depth)));
  const floor = world.floors[hero.depth];
  const mobs = floor?.mobs ?? [];
  if (!mobs.some((mob) => mob.kind === 'vaultTokenDoor')) score += 1250;
  else score += Math.min(1000, 100 * tokensOf(hero));
  if (floor?.vault?.final?.lockTriggered) {
    const boss = mobs.find((mob) => mob.kind === 'vaultBossElemental');
    score += boss ? Math.trunc(f32(750 * f32(boss.hp / boss.ht))) : 750;
  }
  return Math.trunc(score / 50) * 50;
}

/** What the imp says as the hero would leave: from «at least leave the first room» to «excellent work!». */
export function escapeMessage(score: number): 'leaving_start' | 'leaving_early' | 'leaving_partly_explored' | 'leaving_fully_explored' | 'leaving_partial_victory' | 'leaving_victory' {
  if (score < 50) return 'leaving_start';
  if (score < 500) return 'leaving_early';
  if (score <= 1000) return 'leaving_partly_explored';
  if (score <= 2000) return 'leaving_fully_explored';
  if (score < 4000) return 'leaving_partial_victory';
  return 'leaving_victory';
}

/** EquipableItem, and wands: what the lowest reward is not. */
const equipable = (item: Item): boolean => ['weapon', 'armor', 'missile', 'ring', 'artifact', 'wand', 'seal'].includes(itemDef(item.kind).category);

/**
 * EscapeCrystal's item selector: never the crystal; up to 1000 points, a consumable; up to 4000, an item
 * of +0 (+1 over 2000; sealed armour one more, its seal staying behind); with the statuette, anything
 * that is not one of a kind.
 */
export function keepable(item: Item, score: number): boolean {
  if (item.kind === 'quest.escapeCrystal') return false;
  if (score <= 1000) return !isUnique(item) && !equipable(item);
  if (score < 4000) {
    const maxLevel = score > 2000 ? 1 : 0;
    if (itemDef(item.kind).category === 'armor' && item.seal) return item.level <= maxLevel + 1;
    return item.level <= maxLevel && !isUnique(item);
  }
  return !isUnique(item);
}

/**
 * EscapeCrystal.leaveVault: made whole again, the hero gets their belongings back from the imp, with the
 * one item they chose (one of a stack; sealed armour without the seal), which the imp holds if their pack
 * is full. The quest is complete, with its score.
 */
function leaveVault(ctx: Ctx, hero: Hero, keepRef: ItemRef | undefined): void {
  const world = ctx.world;
  const quest = world.impQuest!;
  const score = escapeScore(world, hero);
  heroLives(hero);
  hero.hp = hero.ht;
  let keep: Item | null = keepRef !== undefined && score >= 500 ? itemAt(hero, keepRef) ?? null : null;
  if (keep) {
    keep = JSON.parse(JSON.stringify(keep)) as Item;
    if (itemDef(keep.kind).category === 'armor' && keep.seal) delete keep.seal;
    if (keep.qty > 0 && !equipable(keep)) keep.qty = 1;
  }
  const stored = quest.stored?.[hero.id];
  if (stored) {
    hero.weapon = stored.weapon;
    hero.armor = stored.armor;
    hero.rings = stored.rings;
    hero.items = stored.items;
    hero.gold = stored.gold;
    delete quest.stored![hero.id];
  } else {
    hero.items = hero.items.filter((item) => item.kind !== 'quest.escapeCrystal');
  }
  if (keep && !collect(hero, keep)) quest.reward = keep;
  completeImpQuest(world, score);
  ctx.effects.push({ type: 'vaultLeft', hero: hero.id, score, item: keep });
}

/** VaultLevel.activateTransition: walking onto the way out does nothing; the escape crystal leads out. */
const leaveBefore = BRANCH_GATES.leave;
BRANCH_GATES.leave = (world, hero, level) => (isVault(level) ? 'use the escape crystal' : leaveBefore(world, hero, level));

/** DwarfToken.doPickUp: once the mirror is used, a token is thrown away. */
export const tokenDiscarded = (world: World, item: Item): boolean => item.kind === 'quest.token' && world.impQuest?.mirrorUsed === true;

/* The final room */

/**
 * VaultFinalRoom.processHeroStep: walking towards the locked door, the imp's word ten cells away (whether
 * the hero looks ready: a melee weapon, a thrown weapon, an armour and a wand of +2 or better, and the
 * mirror used), a charging-up at four; within three, the greater elemental appears in the middle (or next
 * to it), both doors lock and the room is sealed.
 */
export function vaultStep(ctx: Ctx, hero: Hero): void {
  const vault = ctx.floor.vault;
  const final = vault?.final;
  if (!vault || !final || final.lockTriggered) return;
  const distance = Math.max(Math.abs(cellX(hero.pos) - cellX(final.lockedDoor)), Math.abs(cellY(hero.pos) - cellY(final.lockedDoor)));
  if (distance <= 3) {
    let bossPos = final.center;
    if (charAt(ctx.world, ctx.depth, bossPos)) {
      const candidates = PF_NEIGHBOURS8.map((n) => bossPos + n).filter((c) => !charAt(ctx.world, ctx.depth, c));
      if (candidates.length === 0) return;
      bossPos = candidates[ctx.rng.int(candidates.length)]!;
    }
    ctx.level.map[final.entryDoor] = T.LOCKED_DOOR;
    const boss = summonBoss(ctx, bossPos, hero);
    vault.locked = true;
    final.lockTriggered = true;
    ctx.effects.push({ type: 'vaultSealed', depth: ctx.depth, sealed: true, mob: boss.id });
  } else if (distance === 4 && final.warnState < 2) {
    ctx.effects.push({ type: 'vaultWarning', hero: hero.id, line: 'final' });
    ctx.effects.push({ type: 'interrupted', hero: hero.id, reason: 'vault' });
    final.warnState = 2;
  } else if (distance >= 5 && final.warnState === 2) {
    final.warnState = 1;
  } else if (distance <= 10 && final.warnState < 1) {
    ctx.effects.push({ type: 'interrupted', hero: hero.id, reason: 'vault' });
    ctx.effects.push({ type: 'vaultWarning', hero: hero.id, line: prepared(ctx.world, hero) ? 'prepared' : 'unprepared' });
    final.warnState = 1;
  } else if (distance > 12) {
    final.warnState = 0;
  }
}

/** Whether the hero looks ready for the elemental: +2 vault loot of each kind, and the mirror's gift. */
function prepared(world: World, hero: Hero): boolean {
  const criteria = [false, false, false, false];
  for (const item of [hero.weapon, hero.armor, ...hero.rings, ...hero.items]) {
    if (!item || item.level < 2) continue;
    const category = itemDef(item.kind).category;
    if (category === 'weapon') criteria[0] = true;
    else if (category === 'missile') criteria[1] = true;
    else if (category === 'armor') criteria[2] = true;
    else if (category === 'wand') criteria[3] = true;
  }
  return criteria.every(Boolean) && world.impQuest?.mirrorUsed === true;
}

/** VaultLevel.unseal and VaultFinalRoom.unlock: the greater elemental fallen, the doors open, and the treasury's rings are known. */
export function vaultUnseal(ctx: Ctx): void {
  const vault = ctx.floor.vault;
  if (!vault?.final) return;
  vault.locked = false;
  ctx.level.map[vault.final.entryDoor] = T.DOOR;
  ctx.level.map[vault.final.lockedDoor] = T.DOOR;
  for (const heap of ctx.floor.heaps) {
    const item = heap.items[0];
    if (item && itemDef(item.kind).category === 'ring' && item.levelUnknown) {
      delete item.levelUnknown;
      delete item.curseUnknown;
    }
  }
  vault.spells = [];
  ctx.effects.push({ type: 'vaultSealed', depth: ctx.depth, sealed: false });
}
