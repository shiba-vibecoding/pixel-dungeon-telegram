import type { MobKind } from '../../actors';
import { DARKNESS } from '../../challenges';
import { createItem, type Item, itemDef, type ItemKind, ITEMS, randomEnchantment, randomGlyph, wandMaxCharges } from '../../items';
import type { VaultFlameSpawn, VaultMob } from '../../vault-types';
import { WIDTH } from '../geometry';
import { T } from '../terrain';
import type { TrapKind } from '../trapdefs';
import { Builder } from './builders/builder';
import { GridBuilder } from './builders/others';
import { BRANCH_LEVELS } from './branches';
import { Dungeon, Feeling } from './dungeon';
import type { GenLevel, MobSpawn } from './genlevel';
import { Generator, type GenCategory } from './generator';
import { Painter } from './painter';
import { CityPainter } from './painters/regions';
import { Random } from './random';
import type { RegionConfig } from './regular-level';
import { RegularLevel } from './regular-level';
import type { Room } from './room';
import { seamItem, type SeamItem } from './seams';

/*
 * levels/VaultLevel: the dwarven vault under the ambitious imp's room, the imp quest's side level
 * (Shattered v4). Rooms of a fixed size on a grid (GridBuilder): the entry room, about nine guarded
 * or trapped vault rooms, the tokens room with its strange door and mirror, a guarded treasure, seven
 * treasure rooms from easy to hard, and the final room. Its loot is dealt evenly from tier tables
 * (every six items of a tier: two melee weapons, a thrown weapon, an armour, a wand and a ring), its
 * guards from a rotation of three of each tier, all stealthy (vaultmobs.ts). No traps but the flame
 * vents, no hidden doors; walking onto the way out does nothing (the escape crystal leads out).
 */

/** The vault's monster classes, as the rooms ask for them (VaultLevel.T1Mobs ... T3Mobs). */
export type VaultMobClass = 'VaultSkeleton' | 'VaultDM100' | 'VaultShaman' | 'VaultDM200' | 'VaultGhoul' | 'VaultElemental' | 'VaultGolem';

export const T1_MOBS: readonly VaultMobClass[] = ['VaultSkeleton', 'VaultDM100'];
/** The vault ghoul only alone. */
export const T2_MOBS: readonly VaultMobClass[] = ['VaultShaman', 'VaultDM200', 'VaultGhoul'];
export const T3_MOBS: readonly VaultMobClass[] = ['VaultElemental', 'VaultGolem'];

const CLASS_KIND: Readonly<Record<Exclude<VaultMobClass, 'VaultElemental'>, MobKind>> = {
  VaultSkeleton: 'vaultSkeleton', VaultDM100: 'vaultDM100', VaultShaman: 'vaultShaman', VaultDM200: 'vaultDM200',
  VaultGhoul: 'vaultGhoul', VaultGolem: 'vaultGolem',
};

/** The class a vault monster kind belongs to (the elementals are all VaultElemental). */
export function vaultClassOf(kind: MobKind): VaultMobClass {
  for (const [cls, k] of Object.entries(CLASS_KIND)) if (k === kind) return cls as VaultMobClass;
  return 'VaultElemental';
}

/** The kind of a class (not VaultElemental, whose kind is rolled: randomVaultElemental). */
export const vaultKindOf = (cls: Exclude<VaultMobClass, 'VaultElemental'>): MobKind => CLASS_KIND[cls];

/** A vault monster as made for a room (Reflection.newInstance of its class): its class, and the spawn the room places. */
export interface VaultGenMob {
  cls: VaultMobClass;
  spawn: MobSpawn & { vault: VaultMob };
}

/** Char.Property.LARGE: the DM-200 and the golem need open space. */
export const isLarge = (mob: VaultGenMob): boolean => mob.cls === 'VaultDM200' || mob.cls === 'VaultGolem';
/** instanceof Elemental: the vault's elementals count as tier 3 treasure guards. */
export const isElemental = (mob: VaultGenMob): boolean => mob.cls === 'VaultElemental';

/** The tier of the treasure a monster guards: T1 1, T2 2, T3 (and elementals) 3; `base` if none. */
export function mobTier(mob: VaultGenMob, base: number): number {
  let tier = base;
  if (T1_MOBS.includes(mob.cls)) tier = 1;
  if (T2_MOBS.includes(mob.cls)) tier = 2;
  if (T3_MOBS.includes(mob.cls)) tier = 3;
  if (isElemental(mob)) tier = 3;
  return tier;
}

/**
 * new VaultX(): the monster, with what its class rolls as it is made — the DM-200's and the golem's
 * loot class (Random.oneOf, then replaced by the token), the shaman's debuff, an elemental's first
 * ranged cooldown — all stealthy (activateSteathGameplayBehaviour), asleep until a room says otherwise.
 */
export function newVaultMob(kind: MobKind): VaultGenMob {
  const vault: VaultMob = { stealth: true };
  switch (kind) {
    case 'vaultDM200':
    case 'vaultGolem':
      // DM200 and Golem: loot = Random.oneOf(WEAPON, ARMOR), replaced by the token.
      Random.Int(2);
      break;
    case 'vaultShaman':
      vault.shamanType = Random.Int(5);
      break;
    case 'vaultFireElemental':
    case 'vaultFrostElemental':
    case 'vaultShockElemental':
      vault.rangedCooldown = Random.NormalIntRange(3, 5);
      break;
  }
  return { cls: vaultClassOf(kind), spawn: { kind, pos: -1, state: 'sleeping', vault } };
}

/** VaultElemental.random: fire 40%, frost 40%, shock 20%. */
export function randomVaultElemental(): MobKind {
  const roll = Random.Float();
  if (roll < 0.4) return 'vaultFireElemental';
  if (roll < 0.8) return 'vaultFrostElemental';
  return 'vaultShockElemental';
}

/** Mob.setupStealthGameplayWanderPositions. */
export function setWander(mob: VaultGenMob, positions: number[], startingIdx: number): void {
  mob.spawn.vault.wanderPositions = positions;
  mob.spawn.vault.wanderPosIdx = startingIdx;
}

/** EquipableItem: weapons, armour, thrown weapons, rings and artifacts (not wands). */
export const isEquipable = (item: Item): boolean => ['weapon', 'armor', 'missile', 'ring', 'artifact', 'seal'].includes(itemDef(item.kind).category);

/** Item.identify(false) as the vault deals it: its level and curse known, a wand's charges too. */
function knownLevel(item: Item): void {
  delete item.levelUnknown;
  delete item.curseUnknown;
  delete item.chargesUnknown;
  delete item.usesLeftToID;
  delete item.availableUsesToID;
}

/** Item.level(n), and a wand's charges full again (Wand.curCharges = maxCharges). */
function setLevel(item: Item, level: number): void {
  item.level = level;
  if (itemDef(item.kind).category === 'wand') item.charges = wandMaxCharges(item);
}

/** Weapon.enchant(null) or enchant(): no enchantment, or a random one other than its own. */
function enchant(item: Item, on: boolean): void {
  if (on) item.enchant = randomEnchantment(Random.rng, item.enchant);
  else delete item.enchant;
}

/** Armor.inscribe(null) or inscribe(). */
function inscribe(item: Item, on: boolean): void {
  if (on) item.glyph = randomGlyph(Random.rng, item.glyph);
  else delete item.glyph;
}

/** A random item of a category, never one of the kinds already dealt (SEAM(gear): Pixel Dungeon's few kinds a tier may run out, and a kind repeats). */
function distinct(category: GenCategory, used: Set<ItemKind>, check: boolean, banned: (item: Item) => boolean = () => false): Item {
  let loot: Item;
  let tries = 0;
  do {
    loot = Generator.randomUsingDefaults(category);
    tries++;
  } while (((check && used.has(loot.kind)) || banned(loot)) && tries < 50);
  used.add(loot.kind);
  return loot;
}

const VAULT_CONFIG: RegionConfig = {
  standardRooms: () => 0,
  specialRooms: () => 0,
  painter(_level, nTraps) {
    // Water is less common and more clustered (a few leaks), grass a little more common (overgrowth over time).
    return new VaultPainter().setWater(0.15, 12).setGrass(0.30, 3).setTraps(nTraps, this.trapClasses(), this.trapChances());
  },
  // CityLevel's, never used: the vault has no traps.
  trapClasses: (): TrapKind[] => [
    'frost', 'storm', 'corrosion', 'blazing', 'disintegration', 'rockfall', 'flashing', 'guardian', 'weakening',
    'disarming', 'summoning', 'warping', 'cursing', 'pitfall', 'distortion', 'gateway', 'geyser',
  ],
  trapChances: () => [4, 4, 4, 4, 4, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1],
};

/** The vault's CityPainter: no hidden doors in the vault. */
class VaultPainter extends CityPainter {
  override hiddenDoorChance(): number {
    return 0;
  }
}

/** The rooms the vault level is made of; vault-rooms.ts registers their makers (to avoid an import cycle). */
export const VAULT_ROOMS = {
  entrance: null as (() => Room) | null,
  /** VaultRoom.setupChances and createRoom. */
  setupChances: null as (() => void) | null,
  createRoom: null as (() => Room & { sizeFactor(): number }) | null,
  tokens: null as (() => Room) | null,
  simpleEnemyTreasure: null as (() => Room) | null,
  /** VaultTreasureRoom.generateRoomList and nextRoom. */
  generateTreasureList: null as (() => void) | null,
  nextTreasure: null as (() => Room) | null,
  final: null as (() => Room) | null,
};

/** The vault each level being made belongs to (the rooms' `(VaultLevel) level`). */
const VAULTS = new WeakMap<GenLevel, VaultLevel>();

/** The VaultLevel a level being made is, for its rooms. */
export function vaultOf(level: GenLevel): VaultLevel {
  const vault = VAULTS.get(level);
  if (!vault) throw new Error('not the vault');
  return vault;
}

export class VaultLevel extends RegularLevel {
  /*
   * Only during generation (no need to keep them): the equipment dealt by tier, kept in arrays so the
   * loot stays even; every six items of a tier are two melee weapons, a thrown weapon, an armour, a
   * wand and a ring.
   */
  private equipmentLoot: Array<Array<Item | null> | null> = [null, null, null, null];
  private higherTierIdx = 0;
  private lowerTierIdx = 0;
  /** No two of the same equipment kind (but armour), across the tiers. */
  private generatedClasses = new Set<ItemKind>();
  private consumableLoot: Item[][] = [];
  private mobsToSpawn: VaultMobClass[] = [];
  /** VaultLevel.T2SolveItems and T3SolveItems: shuffled in place, call after call. */
  private t2Solve: Array<'blink' | 'invisibility'> = ['blink', 'invisibility'];
  private t3Solve: Array<'blink' | 'invisibility'> = ['blink', 'invisibility'];
  /** The stones of blink the rooms added to spawn (StoneOfBlink is a stand-in: told apart by identity). */
  readonly blinkStones = new Set<Item>();

  constructor() {
    super(VAULT_CONFIG, Feeling.NONE);
    VAULTS.set(this.level, this);
  }

  protected override builder(): Builder {
    return new GridBuilder();
  }

  /** VaultLevel.nTraps: none. */
  override nTraps(): number {
    return 0;
  }

  /** VaultLevel.initRooms: the entry, vault rooms worth nine, the tokens room, a guarded treasure, seven treasure rooms, the final room. */
  protected override initRooms(): Room[] {
    const rooms: Room[] = [];
    rooms.push((this.roomEntrance = VAULT_ROOMS.entrance!()));
    VAULT_ROOMS.setupChances!();
    let i = 0;
    while (i < 9) {
      const r = VAULT_ROOMS.createRoom!();
      i += r.sizeFactor();
      rooms.push(r);
    }
    rooms.push(VAULT_ROOMS.tokens!());
    rooms.push(VAULT_ROOMS.simpleEnemyTreasure!());
    VAULT_ROOMS.generateTreasureList!();
    for (let n = 0; n < 7; n++) rooms.push(VAULT_ROOMS.nextTreasure!());
    rooms.push((this.roomExit = VAULT_ROOMS.final!()));
    return rooms;
  }

  /**
   * VaultLevel.build: what lies about is the vault's own (four tier-0 equipment, a dart, five tier-0
   * consumables and three rations), then the rooms; the cells the vault's characters keep (scans, beams,
   * rounds, vents) follow the level into the world's grid.
   */
  override build(): boolean {
    const level = this.level;
    level.itemsToSpawn = [];
    for (let i = 0; i < 4; i++) level.addItemToSpawn(this.createEquipment(0));
    level.addItemToSpawn(createItem('missile.dart', 2));
    for (let i = 0; i < 5; i++) level.addItemToSpawn(this.createConsumable(0));
    for (let i = 0; i < 3; i++) level.addItemToSpawn(Generator.randomUsingDefaults('FOOD'));
    if (!super.build()) return false;
    remapCells(level, level.contentWidth || WIDTH);
    return true;
  }

  /** VaultLevel.setupEquipment: deals a tier anew once all of it is handed out. */
  private setupEquipment(): void {
    for (let i = 0; i < this.equipmentLoot.length; i++) {
      const loot = this.equipmentLoot[i];
      if (!loot || loot.every((item) => item === null)) this.setupEquipmentAtTier(i);
    }
  }

  /** VaultLevel.setupEquipmentAtTier. */
  private setupEquipmentAtTier(lootTier: number): void {
    const used = this.generatedClasses;
    const list: Item[] = [];
    const enchantFor = (item: Item): void => enchant(item, Random.Int(3) < lootTier);

    // The first weapon: a lower tier, more upgrades (T2 duplicates allowed, so many are made).
    let loot = distinct((['WEP_T2', 'WEP_T2', 'WEP_T3', 'WEP_T4'] as const)[lootTier]!, used, lootTier > 1);
    setLevel(loot, lootTier === 0 ? lootTier : lootTier + 1);
    enchantFor(loot);
    list.push(loot);

    // The second weapon: a higher tier, fewer upgrades.
    loot = distinct((['WEP_T2', 'WEP_T3', 'WEP_T4', 'WEP_T5'] as const)[lootTier]!, used, lootTier > 0);
    setLevel(loot, lootTier);
    enchantFor(loot);
    list.push(loot);

    // A thrown weapon, as the second weapon.
    loot = distinct((['MIS_T2', 'MIS_T3', 'MIS_T4', 'MIS_T5'] as const)[lootTier]!, used, true);
    setLevel(loot, lootTier);
    enchantFor(loot);
    list.push(loot);

    // Armour, as the second weapon (one a tier: no duplicate check).
    loot = createItem((['armor.leather', 'armor.mail', 'armor.scale', 'armor.plate'] as const)[lootTier]!);
    used.add(loot.kind);
    setLevel(loot, lootTier);
    inscribe(loot, Random.Int(3) < lootTier);
    list.push(loot);

    // A wand (SEAM(wands): regrowth, transfusion and corruption are banned; Pixel Dungeon's regrowth is).
    loot = distinct('WAND', used, true, (item) => item.kind === 'wand.regrowth');
    setLevel(loot, lootTier);
    list.push(loot);

    // A ring (SEAM(artifacts): wealth, might and force are banned; Pixel Dungeon has none of them).
    loot = distinct('RING', used, true);
    setLevel(loot, lootTier);
    list.push(loot);

    this.equipmentLoot[lootTier] = list;
  }

  /** VaultLevel.createEquipment: the next item of a tier's deal (T2 and T3 share a counter, T0 and T1 another). */
  createEquipment(lootTier: number): Item {
    this.setupEquipment();
    const loot = this.equipmentLoot[lootTier]!;
    let idx: number;
    if (lootTier >= 2) {
      idx = this.higherTierIdx;
      if (idx >= loot.length) {
        idx = 0;
        this.higherTierIdx = 0;
      } else {
        this.higherTierIdx++;
      }
    } else {
      idx = this.lowerTierIdx;
      if (idx >= loot.length) {
        idx = 0;
        this.lowerTierIdx = 0;
      } else {
        this.lowerTierIdx++;
      }
    }
    while (loot[idx] === null) {
      idx++;
      if (idx >= loot.length) idx = 0;
    }
    const item = loot[idx]!;
    loot[idx] = null;
    delete item.cursed;
    if (itemDef(item.kind).category === 'ring') {
      // Rings in the vault get a fifth of their identification for each guard defeated (vaultmobs.ts).
      delete item.levelUnknown;
      delete item.curseUnknown;
    } else {
      knownLevel(item);
    }
    return item;
  }

  /** VaultLevel.setupConsumables: each tier a healing potion first, then four (the third tier five) in a random order. */
  private setupConsumables(): void {
    if (this.consumableLoot.length === 0) this.consumableLoot = [[], [], [], []];
    const pick = (...kinds: Array<ItemKind | SeamItem>): Item =>
      toItem(Random.oneOf(...kinds));
    // (Collections.shuffle, unseeded in the original: any order will do; here the level's stream decides.)
    if (this.consumableLoot[0]!.length === 0) {
      const t0 = [
        pick('potion.frost', 'potion.levitation'),
        pick('mageroyalSeed', 'seed.icecap', 'stormvineSeed'),
        pick('scroll.mirrorImage', 'scroll.teleportation'),
        pick('stoneOfFlock', 'stoneOfShock', 'stoneOfFear'),
      ];
      Random.shuffle(t0);
      this.consumableLoot[0] = [createItem('potion.healing'), ...t0];
    }
    if (this.consumableLoot[1]!.length === 0) {
      const t1 = [
        pick('potion.toxicGas', 'potion.paralyticGas'),
        pick('seed.firebloom', 'seed.sorrowmoss', 'blindweedSeed'),
        pick('scroll.recharging', 'scroll.terror'),
        pick('stoneOfDeepSleep', 'stoneOfClairvoyance', 'stoneOfAggression'),
      ];
      Random.shuffle(t1);
      this.consumableLoot[1] = [createItem('potion.healing'), ...t1];
    }
    if (this.consumableLoot[2]!.length === 0) {
      const t2 = [
        pick('potion.mindVision', 'potion.liquidFlame'),
        pick('swiftthistleSeed', 'seed.sungrass'),
        pick('scroll.lullaby', 'scroll.mapping'),
        pick('stoneOfBlast', 'stoneOfBlink'),
      ];
      Random.shuffle(t2);
      this.consumableLoot[2] = [createItem('potion.healing'), ...t2];
    }
    if (this.consumableLoot[3]!.length === 0) {
      const t3 = [
        pick('potion.experience', 'potion.invisibility'),
        pick('seed.earthroot', 'starflowerSeed'),
        pick('scrollOfRetribution', 'scrollOfTransmutation'),
        pick('stoneOfEnchantment', 'stoneOfAugmentation'),
        createItem('potion.healing'),
      ];
      Random.shuffle(t3);
      this.consumableLoot[3] = t3;
    }
  }

  /** VaultLevel.createConsumabe: the next consumable of a tier. */
  createConsumable(tier: number): Item {
    if (this.consumableLoot.length === 0 || this.consumableLoot[tier]!.length === 0) this.setupConsumables();
    return this.consumableLoot[tier]!.shift()!;
  }

  /** A stone of blink to spawn (VaultHardLaserTreasureRoom), known as such to findT2/T3SolveItem. */
  addBlinkStone(): void {
    const stone = seamItem('stoneOfBlink');
    if (!stone) return;
    this.blinkStones.add(stone);
    this.level.addItemToSpawn(stone);
  }

  private solve(order: Array<'blink' | 'invisibility'>): Item | null {
    Random.shuffle(order);
    for (const which of order) {
      const found = this.level.findPrizeItem((item) => (which === 'blink' ? this.blinkStones.has(item) : item.kind === 'potion.invisibility'));
      if (found) return found;
    }
    return null;
  }

  /** VaultLevel.findT3SolveItem: a stone of blink or a potion of invisibility the rooms set aside, if any. */
  findT3SolveItem(): Item | null {
    return this.solve(this.t3Solve);
  }

  /** VaultLevel.findT2SolveItem: likewise, and failing that a T3 one. */
  findT2SolveItem(): Item | null {
    return this.solve(this.t2Solve) ?? this.findT3SolveItem();
  }

  /** VaultLevel.createMob: the rotation of three monsters of each tier, shuffled; an elemental's kind rolled. */
  createMob(): VaultGenMob {
    if (this.mobsToSpawn.length === 0) {
      this.mobsToSpawn.push(...T1_MOBS);
      this.mobsToSpawn.push(Random.oneOf(...T1_MOBS));
      this.mobsToSpawn.push(...T2_MOBS);
      this.mobsToSpawn.push(...T3_MOBS);
      this.mobsToSpawn.push(Random.oneOf(...T3_MOBS));
      Random.shuffle(this.mobsToSpawn);
    }
    const cls = this.mobsToSpawn.shift()!;
    return newVaultMob(cls === 'VaultElemental' ? randomVaultElemental() : CLASS_KIND[cls]);
  }

  /** VaultLevel.returnMob: a monster a room could not use goes back to the front of the rotation. */
  returnMob(cls: VaultMobClass): void {
    this.mobsToSpawn.unshift(cls);
  }

  /** Puts a monster on the level (level.mobs.add). */
  addMob(mob: VaultGenMob): void {
    this.level.mobs.push(mob.spawn);
  }

  /**
   * VaultLevel.createItems: what is to spawn lies somewhere in the standard rooms (clearing tall grass);
   * two torches in the dark (on a stream of their own); and a potion of healing almost always in a room
   * next to the entry room.
   */
  override createItems(): void {
    const level = this.level;
    const place = (item: Item | null, cell: number): void => {
      if (cell < 0) return;
      level.drop(item, cell).kind = 'heap';
      if (level.map[cell] === T.HIGH_GRASS || level.map[cell] === T.FURROWED_GRASS) {
        level.map[cell] = T.GRASS;
        level.losBlocking[cell] = false;
      }
    };
    for (const item of level.itemsToSpawn) place(item, this.randomDropCell());

    Random.pushGenerator(Random.Long());
    if (Dungeon.isChallenged(DARKNESS)) {
      for (let i = 0; i < 2; i++) place(createItem('torch'), this.randomDropCell());
    }
    Random.popGenerator();

    let tries = 1000;
    let cell: number;
    let room: Room | undefined;
    do {
      cell = this.randomDropCell();
      room = cell >= 0 ? level.room(cell) : undefined;
      tries--;
    } while ((!room || !room.connected.has(this.roomEntrance!)) && tries > 0);
    place(createItem('potion.healing'), cell);
  }

  /** VaultLevel.createMobs: the rooms place the monsters. */
  override createMobs(): void {}
}

/** A consumable of the vault's tables: an item kind, or a seam's stand-in. */
function toItem(kind: ItemKind | SeamItem): Item {
  return (kind as string) in ITEMS ? createItem(kind as ItemKind) : seamItem(kind as SeamItem) ?? createItem('potion.healing');
}

/** The cells a vault character keeps besides where it stands, moved with the level into the world's grid (regular-level.ts fitToGrid). */
function remapCells(level: GenLevel, w: number): void {
  if (w === WIDTH) return;
  const move = (cell: number): number => (cell % w) + Math.trunc(cell / w) * WIDTH;
  for (const mob of level.mobs) {
    const vault = mob.vault;
    if (!vault) continue;
    if (vault.scanDirs) vault.scanDirs = vault.scanDirs.map((dirs) => dirs.map(move));
    if (vault.laserDirs) vault.laserDirs = vault.laserDirs.map(move);
    if (vault.wanderPositions) vault.wanderPositions = vault.wanderPositions.map(move);
  }
}

/**
 * VaultLevel.VaultFlameTrap.setupTrap: a vent on a cell (an inactive, always visible trap), firing after
 * `initialCD` turns, then every `afterTriggerCD`, `triggers` turns of flame at a time (VaultFlameTraps).
 */
export function setupFlameTrap(level: GenLevel, cell: number, initialCD: number, afterTriggerCD: number, triggers: number): void {
  const spawn: VaultFlameSpawn = { kind: 'VaultFlameTraps', cell, amount: 0, initialCD, afterTriggerCD, triggers };
  const existing = level.blobs.findIndex((b) => b.kind === 'VaultFlameTraps' && b.cell === cell);
  if (existing >= 0) level.blobs.splice(existing, 1, spawn);
  else level.blobs.push(spawn);
  const trap = level.setTrap('vaultFlame', cell, true);
  trap.active = false;
  Painter.set(level, cell, T.INACTIVE_TRAP);
}

/** Dungeon.newLevel for the vault: made until it fits, its items laid; its monsters are the rooms'. */
export function makeVaultLevel(): GenLevel {
  // One level, built again until it works, as Level.create does (what it dealt so far stays dealt).
  const vault = new VaultLevel();
  const level = vault.level;
  level.viewDistance = Dungeon.isChallenged(DARKNESS) ? 2 : 8;
  for (let attempt = 0; attempt < 128; attempt++) {
    level.resetContents();
    Dungeon.droppedToChasm = [];
    if (!vault.build()) continue;
    level.buildFlagMaps();
    vault.createItems();
    return level;
  }
  throw new Error(`Unable to generate the vault at depth ${Dungeon.depth}`);
}

/** Imp.Quest.spawn: the imp's room only on depths 17 to 19, so the vault is below one of them. */
for (const depth of [17, 18, 19]) BRANCH_LEVELS.set(depth, makeVaultLevel);
