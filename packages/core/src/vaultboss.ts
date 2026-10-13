import { createMob, type Hero, isAlive, type Mob, MOBS } from './actors';
import { getStep } from './ai';
import { attack, type Hazard, hurt } from './combat';
import { burnHeaps } from './cooking';
import { ballistica, coneAOE, insideMap, PF_CIRCLE8, PF_NEIGHBOURS8, PF_NEIGHBOURS9, STOP_SOLID, subPath, WONT_STOP } from './cone';
import { type Char, charAt, type Ctx, enterCell, heroesOn, isHero, isPassable, leaveCell } from './floor';
import { castShadow, terrainBlocksSight, viewDistance } from './fov';
import { atan2, cos, sin } from './level/gen/trig';
import { adjacent, cellX, cellY, distance, WIDTH } from './level/geometry';
import { F, hasFlag, T } from './level/terrain';
import { mobConditions, mobPress } from './traps';
import type { BossSpell, ElementalForm, VaultBoss, VaultFloor } from './vault-types';
import { bossPenalty } from './vault';

/*
 * actors/mobs/quest/vault/VaultBossElemental: the greater elemental of the vault's final room (600 health),
 * fire, frost or shock in turn, its form changing at every fifth of its health lost (each form twice at
 * most). Each form has a spell aimed a turn ahead (a fireball where the hero is going, a sweeping cone of
 * cold, a lightning bolt with a ring of sparks) and a spell on the room (a wall of fire coming across it,
 * a frost vortex closing in, sparks chasing the hero), and its own weakness and resistance: fire takes
 * extra from thrown weapons and resists magic; frost takes extra from melee and resists thrown weapons;
 * shock takes extra from magic, resists melee and jolts whoever strikes it. SEAM(buffs): Frost and its
 * resistance are paralysis here (frost breaks on a blow in Shattered; here it is short instead).
 */

const TICK = 1;
const f32 = Math.fround;
const PI = f32(3.1415926);
const PI2 = f32(PI * 2);
const FORMS: readonly ElementalForm[] = ['fire', 'frost', 'shock'];

const bossOf = (mob: Mob): VaultBoss => mob.vault!.boss!;
const floorVault = (ctx: Ctx): VaultFloor | undefined => ctx.floor.vault;
const occupiedIn = (ctx: Ctx) => (cell: number): boolean => charAt(ctx.world, ctx.depth, cell) !== undefined;
const solid = (ctx: Ctx, cell: number): boolean => hasFlag(ctx.level.map[cell]!, F.SOLID);
const trueDistance = (a: number, b: number): number => {
  const dx = cellX(a) - cellX(b);
  const dy = cellY(a) - cellY(b);
  return f32(Math.sqrt(dx * dx + dy * dy));
};
const gate = (min: number, value: number, max: number): number => (value < min ? min : value > max ? max : value);

/**
 * VaultFinalRoom.processHeroStep's summoning: new VaultBossElemental() (its cooldowns, then its first form,
 * rolled), a turn before it acts, after the hero at once (aggro: no opening surprise attack), its form
 * asserted again (which halves its room spell's cooldown).
 */
export function summonBoss(ctx: Ctx, pos: number, hero: Hero): Mob {
  const boss = createMob(`#${++ctx.world.nextId}`, 'vaultBossElemental', pos, 'hunting', ctx.floor.now + 1);
  const envAttackCooldown = ctx.rng.normalIntRange(10, 15);
  const spAttackCooldown = ctx.rng.normalIntRange(6, 10);
  const formIdx = ctx.rng.int(3);
  const formChances: [number, number, number] = [2, 2, 2];
  formChances[formIdx]--;
  boss.vault = {
    boss: {
      form: FORMS[formIdx]!, formChances, envAttackCooldown, spAttackCooldown, spTargetCell: -1, lastEnemyPos: -1, lightningOfs: 0, weakAnnounced: false,
    },
  };
  Object.assign(boss, { enemy: hero.id, target: hero.pos, enemySeen: true });
  ctx.floor.mobs.push(boss);
  enterCell(ctx.level, pos);
  setForm(ctx, boss, FORMS[formIdx]!);
  return boss;
}

/** VaultBossElemental.setElementalForm: the new form; an aimed spell is called off for a new one at once, the room spell comes sooner. */
function setForm(ctx: Ctx, mob: Mob, form: ElementalForm): void {
  const boss = bossOf(mob);
  boss.form = form;
  if (form === 'fire') mob.paralysed = 0;
  if (form === 'frost') mob.burning = 0;
  if (boss.spTargetCell !== -1) {
    boss.spTargetCell = -1;
    boss.spAttackCooldown = 0;
  }
  boss.envAttackCooldown = Math.trunc(boss.envAttackCooldown / 2);
  boss.weakAnnounced = false;
  ctx.effects.push({ type: 'vaultBossForm', depth: ctx.depth, mob: mob.id, form });
}

/** VaultBossElemental.changeForm: another form, by how often each is left. */
function changeForm(ctx: Ctx, mob: Mob): void {
  const boss = bossOf(mob);
  let next: ElementalForm;
  do {
    next = FORMS[Math.max(0, ctx.rng.chances(boss.formChances))]!;
  } while (next === boss.form && boss.formChances.some((c, i) => c > 0 && FORMS[i] !== boss.form));
  boss.formChances[FORMS.indexOf(next)]--;
  setForm(ctx, mob, next);
}

const shockScaled = (boss: VaultBoss, cooldown: number): number => (boss.form === 'shock' ? Math.trunc(f32(cooldown * f32(0.67))) : cooldown);

/** VaultBossElemental.act: its aimed spell goes off; its cooldowns run down; at nothing, it aims a spell or casts on the room; else it fights. */
export function bossAct(ctx: Ctx, mob: Mob): void {
  const boss = bossOf(mob);
  // Elemental-like harm: frost to the fiery form, fire to the frozen one, hurts it (and does nothing else).
  if ((mob.burning ?? 0) > 0) {
    if (boss.form === 'frost') bossHurtBy(ctx, mob, ctx.rng.normalIntRange(5, 10));
    mob.burning = 0;
  }
  if (!isAlive(mob)) return;
  const heroes = heroesOn(ctx.world, ctx.depth);
  const enemy = heroes.find((h) => h.id === mob.enemy) ?? heroes[0];
  if (enemy) mob.enemy = enemy.id;
  const paralysed = (mob.paralysed ?? 0) > 0;
  if (boss.spTargetCell !== -1 && !paralysed && enemy) {
    zap(ctx, mob);
    boss.lastEnemyPos = enemy.pos;
    return;
  }
  boss.spAttackCooldown--;
  boss.envAttackCooldown--;
  if (mob.state === 'hunting' && !paralysed && enemy) {
    if (boss.spAttackCooldown <= 0) {
      mob.time += gate(1, Math.ceil(enemy.time - ctx.floor.now), 3);
      if (boss.form === 'fire') setupFireBall(ctx, mob, enemy);
      else if (boss.form === 'frost') setupFrostCone(ctx, mob, enemy);
      else setupLightningBolt(ctx, mob, enemy);
      ctx.effects.push({ type: 'interrupted', hero: enemy.id, reason: 'vault' });
      boss.lastEnemyPos = enemy.pos;
      return;
    }
    if (boss.envAttackCooldown <= 0) {
      mob.time += TICK;
      if (boss.form === 'fire') setupFireWall(ctx, mob);
      else if (boss.form === 'frost') floorVault(ctx)?.spells.push({ kind: 'frostVortex', targetCell: enemy.pos, distance: -1000, fullVortex: false, altDirection: false });
      else setupLightningChase(ctx, mob);
      boss.envAttackCooldown = shockScaled(boss, ctx.rng.normalIntRange(10, 15));
      ctx.effects.push({ type: 'interrupted', hero: enemy.id, reason: 'vault' });
      boss.lastEnemyPos = enemy.pos;
      return;
    }
  }
  const lastState = mob.state;
  fight(ctx, mob, enemy);
  if (!(lastState === 'wandering' && mob.state === 'hunting')) boss.lastEnemyPos = enemy?.pos ?? heroes[0]?.pos ?? -1;
}

/** Mob.act's usual part: its conditions, then at its enemy or after them. */
function fight(ctx: Ctx, mob: Mob, enemy: Hero | undefined): void {
  if (mobConditions(ctx, mob)) {
    mob.time += TICK;
    return;
  }
  const fov = castShadow(mob.pos, terrainBlocksSight(ctx.level.map), viewDistance(ctx.depth));
  const inFov = enemy !== undefined && fov[enemy.pos] === true && enemy.invisible <= 0;
  if (enemy && inFov) {
    mob.enemySeen = true;
    mob.state = 'hunting';
    mob.target = enemy.pos;
    if (adjacent(mob.pos, enemy.pos)) {
      // Frost form hits less hard: it is meant to be fought up close.
      attack(ctx, mob, enemy, { damage: bossOf(mob).form === 'frost' ? [15, 20] : [20, 25] });
      mob.time += TICK;
      return;
    }
  }
  const target = mob.target;
  if (target !== -1 && target !== mob.pos) {
    const step = adjacent(mob.pos, target)
      ? (!charAt(ctx.world, ctx.depth, target) && isPassable(ctx.level, target) ? target : -1)
      : getStep(mob.pos, target, (cell) => isPassable(ctx.level, cell) && !(fov[cell] && charAt(ctx.world, ctx.depth, cell)));
    if (step !== -1 && !charAt(ctx.world, ctx.depth, step) && (mob.rooted ?? 0) <= 0) {
      const from = mob.pos;
      mob.pos = step;
      leaveCell(ctx.world, ctx.level, ctx.depth, from);
      enterCell(ctx.level, step);
      mobPress(ctx, mob);
      mob.time += 1 / MOBS[mob.kind].speed;
      return;
    }
  }
  mob.time += TICK;
}

/** VaultBossElemental.zap: the aimed spell, and its cooldown again (shorter in shock form). */
function zap(ctx: Ctx, mob: Mob): void {
  const boss = bossOf(mob);
  mob.time += TICK;
  if (boss.form === 'fire') doFireBall(ctx, mob, boss.spTargetCell);
  else if (boss.form === 'frost') doFrostCone(ctx, mob, boss.spTargetCell);
  else doLightningBolt(ctx, mob, boss.spTargetCell);
  boss.spAttackCooldown = shockScaled(boss, ctx.rng.normalIntRange(6, 10));
  boss.spTargetCell = -1;
}

/** Struck by the elemental's power: a hero's hit costs the quest a hundred points. */
function struck(ctx: Ctx, ch: Char, damage: number, mob: Mob | Hazard): void {
  if (damage > 0) {
    ctx.effects.push({ type: 'hurt', depth: ctx.depth, who: ch.id, damage });
    hurt(ctx, ch, damage, mob);
  }
  if (isHero(ch)) bossPenalty(ctx.world);
}

const target = (ctx: Ctx, cells: number[]): void => {
  if (cells.length > 0) ctx.effects.push({ type: 'vaultTarget', depth: ctx.depth, cells });
};

/* Fire */

function setupFireBall(ctx: Ctx, mob: Mob, enemy: Hero): void {
  const boss = bossOf(mob);
  // Where the enemy is going, or somewhere next to them.
  if (adjacent(enemy.pos, boss.lastEnemyPos)) boss.spTargetCell = enemy.pos + (enemy.pos - boss.lastEnemyPos);
  else boss.spTargetCell = enemy.pos + PF_NEIGHBOURS8[ctx.rng.int(8)]!;
  // Never inside a wall of fire.
  const wall = floorVault(ctx)?.spells.find((s): s is Extract<BossSpell, { kind: 'fireWall' }> => s.kind === 'fireWall');
  if (wall) {
    let ofs = 0;
    let valid: boolean;
    let guard = 0;
    do {
      valid = true;
      for (const cell of wall.cells) {
        if (cell === boss.spTargetCell + ofs) {
          do {
            ofs = PF_NEIGHBOURS8[ctx.rng.int(4)]!;
          } while (charAt(ctx.world, ctx.depth, ofs));
          valid = false;
          break;
        }
      }
    } while (!valid && ++guard < 50);
    boss.spTargetCell += ofs;
  }
  target(ctx, PF_NEIGHBOURS9.map((n) => boss.spTargetCell + n).filter((c) => insideMap(c) && !solid(ctx, c)));
}

/** A fireball: fire on nine cells, setting everyone there but the elemental alight. */
function doFireBall(ctx: Ctx, mob: Mob, cell: number): void {
  const cells = PF_NEIGHBOURS9.map((n) => cell + n).filter((c) => insideMap(c) && !solid(ctx, c));
  ctx.effects.push({ type: 'vaultSpell', depth: ctx.depth, spell: 'fireball', cells, from: mob.pos });
  for (const c of cells) {
    burnAt(ctx, c);
    const ch = charAt(ctx.world, ctx.depth, c);
    if (ch && ch !== mob && isAlive(ch)) {
      ch.burning = Math.max(ch.burning ?? 0, 8);
      if (isHero(ch)) bossPenalty(ctx.world);
    }
  }
}

/** Fire on a cell (Blob Fire): what can burn there turns to embers, the heap burns. */
function burnAt(ctx: Ctx, cell: number): void {
  if (hasFlag(ctx.level.map[cell]!, F.FLAMABLE)) {
    ctx.level.map[cell] = T.EMBERS;
    ctx.effects.push({ type: 'burnt', depth: ctx.depth, pos: cell });
  }
  burnHeaps(ctx, cell, 0);
}

/**
 * VaultBossElemental.setupFireWall: a wall of fire along one side of the room, with one gap, coming across
 * it: from the farthest side from the hero while above half health (a gap within 1-3 of them), otherwise
 * from the second or third farthest (a gap 4-6 away).
 */
function setupFireWall(ctx: Ctx, mob: Mob): void {
  const vault = floorVault(ctx);
  const hero = heroesOn(ctx.world, ctx.depth)[0];
  if (!vault?.final || !hero) return;
  const c = { x: cellX(vault.final.center), y: cellY(vault.final.center) };
  const h = { x: cellX(hero.pos), y: cellY(hero.pos) };
  // 0, 1, 2, 3: left, top, right, bottom.
  const wallDistances = [h.x - (c.x - 6), h.y - (c.y - 6), c.x + 6 - h.x, c.y + 6 - h.y];
  const sorted = [...wallDistances];
  // (Collections.shuffle then sort: the order is the sort's.)
  sorted.sort((a, b) => a - b);
  let wallFrom = 0;
  let minSkip: number;
  let maxSkip: number;
  if (mob.hp > mob.ht / 2) {
    minSkip = 1;
    maxSkip = 3;
    do {
      wallFrom = ctx.rng.int(4);
    } while (wallDistances[wallFrom]! < sorted[1]!);
  } else {
    minSkip = 4;
    maxSkip = 6;
    if (sorted[0] === sorted[1] && sorted[2] === sorted[3]) {
      wallFrom = ctx.rng.int(4);
    } else {
      do {
        wallFrom = ctx.rng.int(4);
      } while (wallDistances[wallFrom] === sorted[0] || wallDistances[wallFrom] === sorted[3]);
    }
  }
  const cells: number[] = [];
  let direction: number;
  const skipNear = (along: number): number => {
    let skip: number;
    let guard = 0;
    do {
      skip = ctx.rng.intRange(along === 0 ? c.x - 5 : c.y - 5, along === 0 ? c.x + 5 : c.y + 5);
    } while ((Math.abs(skip - (along === 0 ? h.x : h.y)) > maxSkip || Math.abs(skip - (along === 0 ? h.x : h.y)) < minSkip) && ++guard < 1000);
    return skip;
  };
  if (wallFrom === 1 || wallFrom === 3) {
    const y = wallFrom === 1 ? c.y - 6 : c.y + 6;
    direction = wallFrom === 1 ? WIDTH : -WIDTH;
    const skip = skipNear(0);
    for (let x = c.x - 5; x <= c.x + 5; x++) if (x !== skip) cells.push(x + y * WIDTH);
  } else {
    const x = wallFrom === 0 ? c.x - 6 : c.x + 6;
    direction = wallFrom === 0 ? 1 : -1;
    const skip = skipNear(1);
    for (let y = c.y - 5; y <= c.y + 5; y++) if (y !== skip) cells.push(x + y * WIDTH);
  }
  vault.spells.push({ kind: 'fireWall', cells: cells.slice(0, 10), direction, left: 11 });
}

/** FireWall.act: the wall (two cells deep) burns whoever it reaches, and moves on a cell; eleven turns. */
function fireWallTurn(ctx: Ctx, spell: Extract<BossSpell, { kind: 'fireWall' }>): boolean {
  const burnt: number[] = [];
  for (let i = 0; i < spell.cells.length; i++) {
    for (let j = 0; j < 2; j++) {
      const cell = spell.cells[i]! + j * spell.direction;
      if (!insideMap(cell) || solid(ctx, cell)) continue;
      burnt.push(cell);
      const ch = charAt(ctx.world, ctx.depth, cell);
      if (ch && isAlive(ch) && !(!isHero(ch) && ch.kind === 'vaultBossElemental')) {
        ch.burning = Math.max(ch.burning ?? 0, 5);
        if (isHero(ch)) bossPenalty(ctx.world);
      }
    }
    spell.cells[i] = spell.cells[i]! + spell.direction;
  }
  ctx.effects.push({ type: 'vaultSpell', depth: ctx.depth, spell: 'fireWall', cells: burnt });
  return spell.left-- > 0;
}

/* Frost */

function frostConeCells(ctx: Ctx, mob: Mob, cell: number): number[] {
  const occupied = occupiedIn(ctx);
  const core = ballistica(ctx.level, occupied, mob.pos, cell, WONT_STOP);
  return coneAOE(ctx.level, occupied, core, 10, 50, STOP_SOLID).cells;
}

function setupFrostCone(ctx: Ctx, mob: Mob, enemy: Hero): void {
  bossOf(mob).spTargetCell = enemy.pos;
  target(ctx, frostConeCells(ctx, mob, enemy.pos).filter((c) => trueDistance(c, mob.pos) <= 2));
}

function doFrostCone(ctx: Ctx, mob: Mob, cell: number): void {
  floorVault(ctx)?.spells.push({ kind: 'frostCone', startPos: mob.pos, cells: frostConeCells(ctx, mob, cell), distance: 2 });
}

/** Frost on someone (FrostResist: frozen once, not again until free). */
function frostOn(ctx: Ctx, ch: Char, damage: number): void {
  const vault = floorVault(ctx)!;
  if (vault.resist?.[ch.id]) return;
  if (damage > 0) struck(ctx, ch, damage, 'gas');
  else if (isHero(ch)) bossPenalty(ctx.world);
  if (!isAlive(ch)) return;
  ch.paralysed = Math.max(ch.paralysed ?? 0, 2);
  (vault.resist ??= {})[ch.id] = 3;
}

/** FrostCone.act: the cold sweeps out two cells a turn, freezing (and hurting) whoever it reaches. */
function frostConeTurn(ctx: Ctx, spell: Extract<BossSpell, { kind: 'frostCone' }>): boolean {
  const reached: number[] = [];
  for (const cell of [...spell.cells]) {
    if (trueDistance(cell, spell.startPos) > spell.distance) continue;
    reached.push(cell);
    const ch = charAt(ctx.world, ctx.depth, cell);
    if (ch && isAlive(ch) && !(!isHero(ch) && ch.kind === 'vaultBossElemental')) frostOn(ctx, ch, ctx.rng.normalIntRange(10, 15));
    if (trueDistance(cell, spell.startPos) <= spell.distance - 4) spell.cells.splice(spell.cells.indexOf(cell), 1);
  }
  ctx.effects.push({ type: 'vaultSpell', depth: ctx.depth, spell: 'frost', cells: reached });
  spell.distance += 2;
  if (spell.cells.length === 0) return false;
  target(ctx, spell.cells.filter((c) => trueDistance(c, spell.startPos) <= spell.distance && trueDistance(c, spell.startPos) > spell.distance - 2));
  return true;
}

/** FrostVortex.getFurthestValid: how far a diagonal staircase goes from a cell before it meets a wall. */
function furthestValid(ctx: Ctx, start: number, dirX: number, dirY: number): number {
  let dist = 0;
  if (solid(ctx, start)) return dist;
  do {
    if (dist % 2 === 0) start += dirX;
    else start += dirY * WIDTH;
    dist++;
  } while (insideMap(start) && !solid(ctx, start));
  return dist;
}

/** FrostVortex.getCells: a diagonal line of cells `dist` out from the target, one way round. */
function vortexCells(ctx: Ctx, start: number, dist: number, dirX: number, dirY: number): number[] {
  dist = Math.abs(dist);
  if (furthestValid(ctx, start, dirX, dirY) < dist) return [];
  const xOfs = Math.trunc((dirX * (dist + 1)) / 2);
  const yOfs = Math.trunc((dirY * dist) / 2) * WIDTH;
  const initial = start + xOfs + yOfs;
  const cells = new Set<number>();
  let cell = initial;
  do {
    cells.add(cell);
    cell += -dirX + dirY * WIDTH;
  } while (insideMap(cell) && !solid(ctx, cell));
  cell = initial;
  do {
    cells.add(cell);
    cell += dirX - dirY * WIDTH;
  } while (insideMap(cell) && !solid(ctx, cell));
  return [...cells];
}

/** FrostVortex.act: lines of frost closing in on where the hero stood, two ways (all four below half health). */
function frostVortexTurn(ctx: Ctx, mob: Mob, spell: Extract<BossSpell, { kind: 'frostVortex' }>): boolean {
  if (spell.distance === -1000) {
    let furthest = 0;
    for (const [dx, dy] of [[-1, -1], [-1, 1], [1, 1], [1, -1]] as const) furthest = Math.max(furthest, furthestValid(ctx, spell.targetCell, dx, dy));
    spell.distance = Math.min(furthest, 5);
    spell.fullVortex = mob.hp <= mob.ht / 2;
    spell.altDirection = ctx.rng.int(2) === 0;
  }
  const dirs: Array<readonly [number, number]> = spell.fullVortex
    ? [[-1, -1], [-1, 1], [1, 1], [1, -1]]
    : spell.altDirection ? [[-1, -1], [1, 1]] : [[-1, 1], [1, -1]];
  const cells = new Set<number>();
  for (const [dx, dy] of dirs) for (const c of vortexCells(ctx, spell.targetCell, spell.distance, dx, dy)) cells.add(c);
  spell.distance--;
  if (cells.size === 0) return false;
  ctx.effects.push({ type: 'vaultSpell', depth: ctx.depth, spell: 'frost', cells: [...cells] });
  for (const cell of cells) {
    const ch = charAt(ctx.world, ctx.depth, cell);
    if (ch && isAlive(ch) && !(!isHero(ch) && ch.kind === 'vaultBossElemental')) frostOn(ctx, ch, 0);
  }
  return true;
}

/* Shock */

function boltCells(ctx: Ctx, mob: Mob, cell: number): number[] {
  const bolt = ballistica(ctx.level, occupiedIn(ctx), mob.pos, cell, STOP_SOLID);
  return subPath(bolt, 0, bolt.dist);
}

function setupLightningBolt(ctx: Ctx, mob: Mob, enemy: Hero): void {
  const boss = bossOf(mob);
  boss.spTargetCell = enemy.pos;
  boss.lightningOfs = ctx.rng.int(2);
  const cells = boltCells(ctx, mob, enemy.pos);
  for (let i = boss.lightningOfs % 2; i < PF_CIRCLE8.length; i += 2) cells.push(enemy.pos + PF_CIRCLE8[i]!);
  target(ctx, cells);
}

/** Shocked by a spell: hurt, stunned a turn (ShockResist: not again until free). */
function shock(ctx: Ctx, mob: Mob, ch: Char, damage: number): void {
  const vault = floorVault(ctx)!;
  if (vault.resist?.[ch.id]) return;
  struck(ctx, ch, damage, 'lightning');
  if (!isAlive(ch)) return;
  ch.paralysed = Math.max(ch.paralysed ?? 0, 1);
  (vault.resist ??= {})[ch.id] = 2;
  void mob;
}

/** A lightning bolt along the line, and a ring of sparks round where it lands: 20-30 to whoever is in them. */
function doLightningBolt(ctx: Ctx, mob: Mob, cell: number): void {
  const boss = bossOf(mob);
  const affected = new Set(boltCells(ctx, mob, cell));
  for (let i = boss.lightningOfs % 2; i < PF_CIRCLE8.length; i += 2) affected.add(cell + PF_CIRCLE8[i]!);
  ctx.effects.push({ type: 'vaultSpell', depth: ctx.depth, spell: 'lightning', cells: [...affected], from: mob.pos });
  for (const c of affected) {
    const ch = charAt(ctx.world, ctx.depth, c);
    if (ch && ch !== mob && isAlive(ch)) shock(ctx, mob, ch, ctx.rng.normalIntRange(20, 30));
  }
}

/** VaultBossElemental.setupLightningChase: sparks from two (below half health, four) points round the room's middle. */
function setupLightningChase(ctx: Ctx, mob: Mob): void {
  const vault = floorVault(ctx);
  if (!vault?.final) return;
  const c = vault.final.center;
  const alt = ctx.rng.int(2) === 0;
  const chase = (cell: number): void => {
    vault.spells.push({ kind: 'lightningChase', direction: -1, curCell: cell, midCell: -1, endCell: -1 });
  };
  if (alt || mob.hp <= mob.ht / 2) {
    chase(c - 5 * WIDTH);
    chase(c + 5 * WIDTH);
  }
  if (!alt || mob.hp <= mob.ht / 2) {
    chase(c - 5);
    chase(c + 5);
  }
}

const floorCell = (x: number, y: number): number => Math.floor(x) + Math.floor(y) * WIDTH;
/** Java's Math.round(float). */
const round = (x: number): number => Math.floor(f32(x + 0.5));

/** LightningChase.act: the sparks move two cells a turn, turning towards the hero, shocking whoever they cross. */
function lightningChaseTurn(ctx: Ctx, mob: Mob, spell: Extract<BossSpell, { kind: 'lightningChase' }>): boolean {
  const hero = heroesOn(ctx.world, ctx.depth)[0];
  if (!hero) return false;
  const heroX = cellX(hero.pos);
  const heroY = cellY(hero.pos);
  let curX: number;
  let curY: number;
  const angle = (x: number, y: number): number => f32(atan2(f32(heroY - y), f32(heroX - x)));
  const hit = (cell: number): void => {
    const ch = charAt(ctx.world, ctx.depth, cell);
    if (ch && ch !== mob && isAlive(ch)) shock(ctx, mob, ch, ctx.rng.normalIntRange(10, 15));
  };
  if (spell.direction === -1) {
    curX = f32(cellX(spell.curCell) + 0.5);
    curY = f32(cellY(spell.curCell) + 0.5);
    spell.direction = angle(curX, curY);
  } else {
    const struckCells = [spell.curCell];
    hit(spell.curCell);
    if (!insideMap(spell.midCell) || solid(ctx, spell.midCell)) return false;
    struckCells.push(spell.midCell);
    hit(spell.midCell);
    if (!insideMap(spell.endCell) || solid(ctx, spell.endCell)) return false;
    struckCells.push(spell.endCell);
    hit(spell.endCell);
    ctx.effects.push({ type: 'vaultSpell', depth: ctx.depth, spell: 'lightning', cells: struckCells });
    curX = f32(cellX(spell.endCell) + 0.5);
    curY = f32(cellY(spell.endCell) + 0.5);
    let targetAngle = angle(curX, curY);
    if (Math.abs(f32(spell.direction - targetAngle)) > PI) targetAngle = f32(spell.direction > targetAngle ? targetAngle + PI2 : targetAngle - PI2);
    const maxMove = ctx.rng.floatRange(f32(PI / 8), f32(PI / 6));
    if (spell.direction > targetAngle) spell.direction = f32(spell.direction - Math.min(f32(spell.direction - targetAngle), maxMove));
    else spell.direction = f32(spell.direction + Math.min(f32(targetAngle - spell.direction), maxMove));
    if (spell.direction > PI) spell.direction = f32(spell.direction - PI2);
    else if (spell.direction < -PI) spell.direction = f32(spell.direction + PI2);
  }
  let endX = f32(curX + f32(2 * f32(cos(spell.direction))));
  let endY = f32(curY + f32(2 * f32(sin(spell.direction))));
  endX = f32(round(f32(2 * endX)) / 2);
  endY = f32(round(f32(2 * endY)) / 2);
  const midX = f32(curX + f32(f32(endX - curX) * 0.5));
  const midY = f32(curY + f32(f32(endY - curY) * 0.5));
  spell.endCell = floorCell(endX, endY);
  spell.midCell = floorCell(midX, midY);
  spell.curCell = floorCell(curX, curY);
  return true;
}

/** The elemental's lingering spells, a turn each (its buffs act after the monsters). */
export function bossSpellsTurn(ctx: Ctx, vault: VaultFloor): void {
  if (vault.spells.length === 0) return;
  const boss = ctx.floor.mobs.find((m) => m.kind === 'vaultBossElemental');
  if (!boss) {
    vault.spells = [];
    return;
  }
  vault.spells = vault.spells.filter((spell) => {
    switch (spell.kind) {
      case 'fireWall':
        return fireWallTurn(ctx, spell);
      case 'frostCone':
        return frostConeTurn(ctx, spell);
      case 'frostVortex':
        return frostVortexTurn(ctx, boss, spell);
      case 'lightningChase':
        return lightningChaseTurn(ctx, boss, spell);
    }
  });
}

/* Its resistances and weaknesses */

/** A hero's blow (melee or thrown) is under way: the damage that follows is not magic (VaultBossElemental.damage's sources). */
let blow: 'melee' | 'thrown' | null = null;

/** VaultBossElemental.defenseSkill: never dodging a thrown weapon from afar in fire form; half as evasive to melee in frost form. */
export function bossEvasion(defender: Char, attacker: Char, thrown: boolean, evasion: number): number {
  if (isHero(defender) || defender.kind !== 'vaultBossElemental' || !isHero(attacker)) return evasion;
  const form = bossOf(defender).form;
  if (form === 'fire' && thrown && !adjacent(defender.pos, attacker.pos)) return 0;
  if (form === 'frost' && !thrown) return Math.trunc(evasion / 2);
  return evasion;
}

/**
 * A hero's blow lands on the elemental (Char.attack, before its damage): VaultBossElemental.defenseProc (in
 * shock form a melee striker takes a 5-10 jolt) and the blow's kind for its damage (the next hurt).
 */
export function bossBlow(ctx: Ctx, attacker: Char, defender: Char, thrown: boolean): void {
  if (isHero(defender) || defender.kind !== 'vaultBossElemental' || !isHero(attacker)) return;
  blow = thrown ? 'thrown' : 'melee';
  if (bossOf(defender).form === 'shock' && !thrown) {
    const damage = ctx.rng.intRange(5, 10);
    ctx.effects.push({ type: 'vaultBossLine', depth: ctx.depth, hero: attacker.id, line: 'shockResist' });
    ctx.effects.push({ type: 'hurt', depth: ctx.depth, who: attacker.id, damage });
    hurt(ctx, attacker, damage, 'lightning');
  }
}

/**
 * VaultBossElemental.damage: the form's resistance or weakness (fire: magic a quarter, thrown +10; frost:
 * thrown a quarter, melee +10; shock: magic +10, melee a quarter); its cooldowns shortened by the harm; and
 * never through more than one fifth of its health at a blow: at each fifth it changes form.
 */
export function bossDamage(ctx: Ctx, mob: Mob, damage: number, source: Char | Hazard): number {
  const boss = bossOf(mob);
  const kind = blow;
  blow = null;
  const fromHero = typeof source !== 'string' && isHero(source);
  const magic = (fromHero && kind === null) || source === 'lightning' || source === 'burning';
  const hero = fromHero ? source.id : heroesOn(ctx.world, ctx.depth)[0]?.id ?? '';
  const line = (l: 'fireResist' | 'fireWeak' | 'frostResist' | 'frostWeak' | 'shockResist' | 'shockWeak'): void => {
    ctx.effects.push({ type: 'vaultBossLine', depth: ctx.depth, hero, line: l });
  };
  if (boss.form === 'fire') {
    if (magic) {
      damage = Math.trunc(damage / 4);
      if (fromHero) {
        line('fireResist');
        boss.spAttackCooldown -= 3;
        boss.envAttackCooldown -= 5;
      }
    } else if (fromHero && kind === 'thrown') {
      if (!boss.weakAnnounced) line('fireWeak');
      boss.weakAnnounced = true;
      damage += 10;
    }
  } else if (boss.form === 'frost') {
    if (fromHero && kind === 'thrown') {
      line('frostResist');
      damage = Math.trunc(damage / 4);
    } else if (fromHero) {
      if (!boss.weakAnnounced) line('frostWeak');
      boss.weakAnnounced = true;
      damage += 10;
    }
  } else if (magic) {
    if (!boss.weakAnnounced) line('shockWeak');
    boss.weakAnnounced = true;
    damage += 10;
  } else if (typeof source !== 'string' && !(fromHero && kind === 'thrown')) {
    damage = Math.trunc(damage / 4);
  }

  const bracket = Math.trunc(mob.ht / 5);
  const curBracket = Math.ceil(f32(mob.hp / bracket));
  let hp = mob.hp - damage;
  const taken = mob.hp - hp;
  if (taken > 0) {
    boss.envAttackCooldown = Math.trunc(f32(boss.envAttackCooldown - f32(taken / 24)));
    boss.spAttackCooldown = Math.trunc(f32(boss.spAttackCooldown - f32(taken / 12)));
  }
  if (hp > 0 && hp <= (curBracket - 1) * bracket) {
    // Not through more than one bracket at a time; and a new form.
    hp = Math.max(hp, (curBracket - 2) * bracket);
    let newForm: number;
    do {
      newForm = ctx.rng.int(3);
    } while (FORMS[newForm] === boss.form);
    changeForm(ctx, mob);
    mob.time += TICK;
  }
  return mob.hp - hp;
}

/** Hurt by its own kind of harm (frost in fire form, fire in frost form): 5-10. */
function bossHurtBy(ctx: Ctx, mob: Mob, damage: number): void {
  ctx.effects.push({ type: 'hurt', depth: ctx.depth, who: mob.id, damage });
  hurt(ctx, mob, damage, 'gas');
}

/** VaultBossElemental.die: the boss slain (the level unseals: vault.ts). */
export function bossDied(ctx: Ctx, mob: Mob): void {
  ctx.effects.push({ type: 'bossSlain', depth: ctx.depth, kind: mob.kind });
  void distance;
}
