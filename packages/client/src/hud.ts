import {
  prismaticMaxHp, frozenBy, type Hero, heroArtifacts, isAlive, isHungry, isStarving, type Look, maxExp, type MobKind, shielding,
  STARVING, stealthCloak, talentPointsAvailable, berserkOf, comboOf, momentumOf, prepTurns, highestMove, hasTimer, timerLeft, markTurns, type World,
} from '@pd/core';
import { audio } from './audio';
import { t } from './i18n';
import { AVATAR, durabilityBar, markWear, setAvatar, sprites } from './screens';
import { QUICKSLOTS } from './quickslot';
import { hasFreePoints } from './talentui';
import { BUFF_TINTS } from './shfx';
import type { LogLine } from './view';

/*
 * The in-game HUD in the design system's markup (docs/design/system): the
 * status band on top (portrait, health, experience, satiety, depth, keys,
 * menu, buffs, companions), the log and the toolbar at the bottom. The
 * middle of the screen stays free for the map and its effects.
 *
 * A wide screen (900 px and more, design system v12) arranges the same
 * nodes otherwise: the hero's panel, the party's cards and the status in a
 * column at the top left; journal, settings and menu in the top right
 * corner; the toolbar split in two islands (actions left; the quick slots
 * and the backpack right), each button with its key. The whole layer is
 * scaled up by a whole number (--ui) on big monitors, so the pixels stay sharp.
 */

/** Buff icons in buffs.png (BuffIndicator). */
export const BUFF_ICONS = {
  mindVision: 0, fire: 2, poison: 3, paralysis: 4, hunger: 5, starvation: 6, slow: 7, ooze: 8, roots: 11, invisible: 12,
  weakness: 14, combo: 17, fury: 18, healing: 19, bark: 20, charm: 21, light: 22, cripple: 23, barkskin: 24, dizzy: 29,
  levitation: 1, blindness: 16, immunity: 25, deferred: 28, bleeding: 26, sacrifice: 31,
  // Shattered's own (BuffIndicator), from its sheet (assets/spd/buffs.png): 1000 and its index.
  chill: 1015, frozen: 1015, corrosion: 1003, shield: 1020, rockArmor: 1020, magicCharge: 1050, lightningCharge: 1055,
  recharging: 1034, hexed: 1047, vulnerable: 1046, invulnerable: 1037, disguise: 1071, stasis: 1007, herbal: 1019,
  // From 1000: Shattered's buffs.png (assets/spd/buffs.png), BuffIndicator.SEAL_SHIELD and LOCKED_FLOOR.
  sealShield: 1084, lockedFloor: 1035, bless: 1037,
  // Alchemy's buffs (core buffs.ts), BuffIndicator's icons in the same sheet (tints are the designer's to draw).
  haste: 1041, stamina: 1041, magicalSight: 1000, magicImmune: 1017, foresight: 1032, fireImbue: 1055,
  frostImbue: 1055, toxicImbue: 1055, featherFall: 1001, cleanse: 1025, drowsy: 1029, magicalSleep: 1030,
  potionHealing: 1044, arcaneArmor: 1020, aquaHealing: 1044, htBoost: 1044, wellFed: 1043,
  prismaticGuard: 1020, challengeArena: 1054,
  // The artifacts': the cloak's stealth (INVISIBLE, dimmed), the hourglass's time freeze and stasis (TIME), the cape's THORNS, the talisman's FORESIGHT.
  stealth: 1012, timeFreeze: 1007, thorns: 1031,
  // The talents' and subclasses' (their BuffIndicator icons): rage, the combo, momentum, preparation, the sniper's mark, hold fast,
  // trackers that add to the next blow (WEAPON), cooldowns (TIME), empowered wands (WAND), enhanced rings and a surge (UPGRADE).
  berserk: 1040, berserking: 1040, exhausted: 1040, comboChain: 1017, momentum: 1051, freerunning: 1051, preparation: 1042, sniperMark: 1027,
  holdFast: 1020, trackerBlow: 1045, wandEmpower: 1072, enhancedRings: 1050, surge: 1050, revealedArea: 1000,
  parry: 1061,
  // Design v22: the Cleric's seven statuses and the talents' sixteen have sheets of their own (CLERIC_BUFFS, TALENT_BUFFS); the frame here is only a fallback.
  ascended: 1000, powerOfMany: 1000, bodyForm: 1000, mindForm: 1000, spiritForm: 1000, wallOfLight: 1000, hallowedGround: 1000,
  improvised: 1007, rejuvenating: 1007, seerShot: 1007, patientStrike: 1007, aggressiveBarrier: 1007, lethalHaste: 1007, swiftEquip: 1007, swiftEquip2: 1007,
  searingLight: 1007, liquidAgility: 1007, deadlyFollowup: 1007, preciseAssault: 1007, followupStrike: 1007, provokedAnger: 1007, lingeringMagic: 1007, satiatedSpells: 1007,
  // The armour abilities': Endure's stored blows (BuffIndicator.ARMOR) and Nature's Power (NATURE_POWER).
  endure: 1020, naturesPower: 1058,
  // The monsters' curses (mobs stream): BuffIndicator.VULNERABLE, HEX, DEGRADE.
  degrade: 1048,
} as const;
export type BuffName = keyof typeof BUFF_ICONS;

/** cleric-buffs.png (design v22), 7 px frames: the Cleric's statuses. */
export const CLERIC_BUFFS: Readonly<Partial<Record<BuffName, number>>> = {
  ascended: 0, powerOfMany: 1, bodyForm: 2, mindForm: 3, spiritForm: 4, wallOfLight: 5, hallowedGround: 6,
};
/** talent-buffs.png (design v22): each talent's status in the colour Talent.java gives it. */
export const TALENT_BUFFS: Readonly<Partial<Record<BuffName, number>>> = {
  improvised: 0, rejuvenating: 1, seerShot: 2, patientStrike: 3, aggressiveBarrier: 4, lethalHaste: 5, swiftEquip: 6, swiftEquip2: 7,
  searingLight: 8, liquidAgility: 9, deadlyFollowup: 10, preciseAssault: 11, followupStrike: 12, provokedAnger: 13, lingeringMagic: 14, satiatedSpells: 15,
};
/** combo-buffs.png: BuffIndicator.COMBO (frame 17) tinted by the best move there is: none, clobber, slam, parry, crush, fury. */
export const COMBO_FRAMES = ['none', 'clobber', 'slam', 'parry', 'crush', 'fury'] as const;

/** The monsters' curses have icons of their own in the design's mob-buffs.png (v21): 7×7 in the list, 16×16 in the window. */
export const MOB_BUFFS: Readonly<Partial<Record<BuffName, number>>> = { vulnerable: 0, hexed: 1, degrade: 2 };

/** A buff in the list: its name, the turns it has left where that is known, and its place in buffs-tints.png where it has one. */
export interface BuffEntry {
  name: BuffName;
  turns?: number;
  /** The combo's frame in combo-buffs.png: the best move it can make (COMBO_FRAMES). */
  frame?: number;
  /** An index of buffs-tints.png (design v19): the buffs that share one Shattered icon each have a sheet colour of their own. */
  tint?: number;
}

/**
 * The picture of a buff: its own sheet where the design has one (the monsters' curses, the Cleric's statuses, the talents', the combo's), a
 * pre-tinted frame of buffs-tints.png (v19), or a frame of Shattered's buffs.png.
 */
export function buffGlyph(buff: BuffEntry): HTMLElement {
  const sheet = MOB_BUFFS[buff.name] !== undefined ? (['mob', MOB_BUFFS[buff.name]!] as const)
    : CLERIC_BUFFS[buff.name] !== undefined ? (['cleric', CLERIC_BUFFS[buff.name]!] as const)
    : TALENT_BUFFS[buff.name] !== undefined ? (['tl', TALENT_BUFFS[buff.name]!] as const)
    : buff.frame !== undefined ? (['cmb', buff.frame] as const) : null;
  const node = el('i', sheet ? sheet[0] : buff.tint !== undefined ? 'pd-tbuff' : '');
  if (sheet) node.style.setProperty('--ix', String(sheet[1]));
  else if (buff.tint !== undefined) node.dataset.tb = String(buff.tint);
  else node.dataset.b = String(BUFF_ICONS[buff.name]);
  node.dataset.buff = buff.name;
  return node;
}

/** Puts a buff's sheet colour on it, if it has one. */
const tinted = (buff: BuffEntry): BuffEntry => (buff.tint === undefined && BUFF_TINTS[buff.name] !== undefined ? { ...buff, tint: BUFF_TINTS[buff.name]! } : buff);

/** What ails or helps a hero, with the turns it has left where that is known (BuffIndicator). */
export function heroBuffs(me: Hero, world?: World): BuffEntry[] {
  const turns = (left: number): number => Math.ceil(left);
  const list: BuffEntry[] = [
    ...(me.mindVision > 0 ? [{ name: 'mindVision' as const, turns: turns(me.mindVision) }] : []),
    ...(me.invisible > 0 ? [{ name: 'invisible' as const, turns: turns(me.invisible) }] : []),
    ...(me.ooze >= 0 ? [{ name: 'ooze' as const }] : []),
    ...(me.poison > 0 ? [{ name: 'poison' as const, turns: turns(me.poison) }] : []),
    ...(me.burning > 0 ? [{ name: 'fire' as const, turns: turns(me.burning) }] : []),
    ...(me.paralysed > 0 ? [{ name: 'paralysis' as const, turns: turns(me.paralysed) }] : []),
    ...(me.rooted > 0 ? [{ name: 'roots' as const, turns: turns(me.rooted) }] : []),
    ...(me.slowed > 0 ? [{ name: 'slow' as const, turns: turns(me.slowed) }] : []),
    ...(me.weakened > 0 ? [{ name: 'weakness' as const, turns: turns(me.weakened) }] : []),
    ...(me.crippled > 0 ? [{ name: 'cripple' as const, turns: turns(me.crippled) }] : []),
    ...(me.charmed > 0 ? [{ name: 'charm' as const, turns: turns(me.charmed) }] : []),
    ...(me.light > 0 ? [{ name: 'light' as const, turns: turns(me.light) }] : []),
    ...(me.dizzy > 0 ? [{ name: 'dizzy' as const, turns: turns(me.dizzy) }] : []),
    ...((me.levitating ?? 0) > 0 ? [{ name: 'levitation' as const, turns: turns(me.levitating!) }] : []),
    ...((me.gasImmune ?? 0) > 0 ? [{ name: 'immunity' as const, turns: turns(me.gasImmune!) }] : []),
    ...((me.blind ?? 0) > 0 ? [{ name: 'blindness' as const, turns: turns(me.blind!) }] : []),
    ...((me.deferred ?? 0) > 0 ? [{ name: 'deferred' as const, turns: turns(me.deferred!) }] : []),
    ...((me.bleeding ?? 0) > 0 ? [{ name: 'bleeding' as const }] : []),
    ...((me.marked ?? 0) > 0 ? [{ name: 'sacrifice' as const, turns: turns(me.marked!) }] : []),
    ...(me.sungrass !== undefined && me.sungrass === me.pos ? [{ name: 'healing' as const }] : []),
    ...(me.earthroot && me.earthroot.pos === me.pos ? [{ name: 'bark' as const }] : []),
    ...talentBuffs(me),
    ...classBuffs(me, world),
    ...(me.barkskin > 0 ? [{ name: 'barkskin' as const, turns: turns(me.barkskin) }] : []),
    // Shattered's wands' conditions (core status.ts).
    ...((me.chill ?? 0) > 0 ? [{ name: 'chill' as const, turns: turns(me.chill!) }] : []),
    ...((me.frozen ?? 0) > 0 ? [{ name: 'frozen' as const, turns: turns(me.frozen!) }] : []),
    ...(me.corrosion ? [{ name: 'corrosion' as const, turns: turns(me.corrosion.left) }] : []),
    ...((me.shield ?? 0) > 0 ? [{ name: 'shield' as const, turns: me.shield! }] : []),
    ...(me.rockArmor ? [{ name: 'rockArmor' as const, turns: me.rockArmor.armor }] : []),
    ...(me.magicCharge ? [{ name: 'magicCharge' as const, turns: turns(me.magicCharge.turns) }] : []),
    ...((me.lightningCharge ?? 0) > 0 ? [{ name: 'lightningCharge' as const, turns: turns(me.lightningCharge!) }] : []),
    ...((me.recharging ?? 0) > 0 ? [{ name: 'recharging' as const, turns: turns(me.recharging!) }] : []),
    ...((me.hexed ?? 0) > 0 ? [{ name: 'hexed' as const, turns: turns(me.hexed!) }] : []),
    ...((me.vulnerable ?? 0) > 0 ? [{ name: 'vulnerable' as const, turns: turns(me.vulnerable!) }] : []),
    ...((me.invulnerable ?? 0) > 0 ? [{ name: 'invulnerable' as const, turns: turns(me.invulnerable!) }] : []),
    ...(me.disguise ? [{ name: 'disguise' as const, turns: turns(me.disguise.turns) }] : []),
    ...((me.stasis ?? 0) > 0 ? [{ name: 'stasis' as const, turns: turns(me.stasis!) }] : []),
    ...(me.herbal ? [{ name: 'herbal' as const, turns: me.herbal.level }] : []),
    ...(isStarving(me) ? [{ name: 'starvation' as const }] : isHungry(me) ? [{ name: 'hunger' as const }] : []),
    // WarriorShield.icon: while shielded or cooling down; the shield left, else the cooldown.
    ...(me.sealShield && (me.sealShield.shield > 0 || me.sealShield.cooldown !== 0)
      ? [{ name: 'sealShield' as const, turns: me.sealShield.shield > 0 ? me.sealShield.shield : me.sealShield.cooldown }] : []),
    ...(me.lockedFloor !== undefined ? [{ name: 'lockedFloor' as const }] : []),
    ...((me.blessed ?? 0) > 0 ? [{ name: 'bless' as const, turns: Math.ceil(me.blessed!) }] : []),
    ...alchemyBuffs(me),
    ...artifactBuffs(me),
    ...((me.degraded ?? 0) > 0 ? [{ name: 'degrade' as const, turns: turns(me.degraded!) }] : []),
    ...abilityBuffs(me),
  ];
  return list.map(tinted);
}

/** The talents' trackers and the subclasses' buffs on a hero (core talents/), with what BuffIndicator shows beside each. */
function talentBuffs(me: Hero): BuffEntry[] {
  const list: BuffEntry[] = [];
  const b = me.tal;
  if (!b) return list;
  const rage = berserkOf(me);
  if (rage) {
    if (rage.state === 'berserk') list.push({ name: 'berserking', turns: rage.shield });
    else if (rage.state === 'recovering') list.push({ name: 'exhausted', turns: rage.levelRecovery > 0 ? Math.ceil(rage.levelRecovery) : rage.turnRecovery });
    else list.push({ name: 'berserk', turns: Math.floor(rage.power * 100) });
  }
  const combo = comboOf(me);
  if (combo) list.push({ name: 'comboChain', turns: combo.count, frame: COMBO_FRAMES.indexOf(highestMove(combo) ?? 'none') });
  if (b.parry) list.push({ name: 'parry' });
  const momentum = momentumOf(me);
  if (momentum) {
    if (momentum.freerunTurns > 0) list.push({ name: 'freerunning', turns: momentum.freerunTurns });
    else if (momentum.freerunCooldown > 0) list.push({ name: 'momentum', turns: momentum.freerunCooldown });
    else if (momentum.stacks > 0) list.push({ name: 'momentum', turns: momentum.stacks });
  }
  if (prepTurns(me) !== undefined) list.push({ name: 'preparation', turns: Math.min(9, prepTurns(me)!) });
  if (b.sniper) list.push({ name: 'sniperMark', turns: Math.ceil(b.sniper.left) });
  if (b.holdFast !== undefined && b.holdFast === me.pos) list.push({ name: 'holdFast' });
  if (b.provoked !== undefined) list.push({ name: 'provokedAnger', turns: Math.ceil(b.provoked) });
  if (b.lingering !== undefined) list.push({ name: 'lingeringMagic', turns: Math.ceil(b.lingering) });
  if (b.empowered !== undefined) list.push({ name: 'trackerBlow', turns: Math.ceil(b.empowered) });
  if (b.followup) list.push({ name: 'followupStrike', turns: Math.ceil(b.followup.left) });
  for (const key of ['improvised', 'rejuvenating', 'seerShot'] as const) if (b[key] !== undefined) list.push({ name: key, turns: Math.ceil(b[key]!) });
  if (b.wandEmpower) list.push({ name: 'wandEmpower', turns: b.wandEmpower.left });
  if (b.scrollEmpower) list.push({ name: 'wandEmpower', turns: b.scrollEmpower });
  if (b.enhancedRings !== undefined) list.push({ name: 'enhancedRings', turns: Math.ceil(b.enhancedRings) });
  if (b.surge !== undefined) list.push({ name: 'surge', turns: Math.ceil(b.surge) });
  if (b.revealed) list.push({ name: 'revealedArea', turns: Math.ceil(b.revealed.left) });
  return list;
}

/**
 * The Duelist's and the Cleric's statuses (core classes/state.ts keeps them as timers on the hero's clock): the Duelist's talents'
 * trackers and cooldowns, and the Cleric's forms, power of many, the wall of light and the hallowed ground under her.
 */
function classBuffs(me: Hero, world?: World): BuffEntry[] {
  const c = me.cls;
  if (!c) return [];
  const list: BuffEntry[] = [];
  const left = (key: string): number => Math.ceil(timerLeft(me, key));
  if (c.patient === me.pos) list.push({ name: 'patientStrike' });
  if (hasTimer(me, 'aggressive')) list.push({ name: 'aggressiveBarrier', turns: left('aggressive') });
  if ((c.greaterHaste ?? 0) > 0) list.push({ name: 'lethalHaste', turns: c.greaterHaste! });
  if (hasTimer(me, 'swift')) list.push({ name: c.swiftSecond ? 'swiftEquip2' : 'swiftEquip', turns: left('swift') });
  if (hasTimer(me, 'liqEva') || hasTimer(me, 'liqAcc')) list.push({ name: 'liquidAgility', turns: Math.max(left('liqEva'), left('liqAcc')) });
  if (hasTimer(me, 'followup') && c.followup !== undefined) list.push({ name: 'deadlyFollowup', turns: left('followup') });
  if (hasTimer(me, 'precise')) list.push({ name: 'preciseAssault', turns: left('precise') });
  if (c.holy?.satiated) list.push({ name: 'satiatedSpells' });
  if (c.ascend) list.push({ name: 'ascended', turns: Math.ceil(c.ascend.left) });
  const powered = world?.floors[me.depth]?.mobs.find((mob) => mob.hp > 0 && markTurns(mob, 'power') > 0);
  if (powered) list.push({ name: 'powerOfMany', turns: markTurns(powered, 'power') });
  if (c.bodyEffect && hasTimer(me, 'bodyForm')) list.push({ name: 'bodyForm', turns: left('bodyForm') });
  if (hasTimer(me, 'spirit')) list.push({ name: 'spiritForm', turns: left('spirit') });
  if (world && Object.keys(world.levels[me.depth]?.lightWall ?? {}).length > 0) list.push({ name: 'wallOfLight' });
  if (world?.floors[me.depth]?.hallowed?.[me.pos]) list.push({ name: 'hallowedGround' });
  return list;
}

/**
 * The armour abilities' buffs: Endure's blows to pay back (shown once the stance is over: the damage stored), Nature's Power
 * (turns left).
 */
function abilityBuffs(me: Hero): BuffEntry[] {
  const endure = me.abil?.endure;
  const nature = me.abil?.nature;
  return [
    ...(endure && !endure.enduring && me.time < endure.until ? [{ name: 'endure' as const, turns: endure.damageBonus }] : []),
    ...(nature && me.time < nature.until ? [{ name: 'naturesPower' as const, turns: Math.ceil(nature.until - me.time) }] : []),
  ];
}

/**
 * The artifacts' buffs (their BuffIndicator icons): the cloak's stealth (turns until it costs a charge), the
 * hourglass's time freeze (turns of the charge being spent; its stasis is TimeStasis, above), the cape radiating thorns, the
 * talisman's unease near a hidden trap.
 */
function artifactBuffs(me: Hero): BuffEntry[] {
  const buffs: BuffEntry[] = [];
  const cloak = stealthCloak(me);
  if (cloak?.stealth) buffs.push({ name: 'stealth', turns: Math.max(0, cloak.stealth.turnsToCost) });
  const frozen = frozenBy(me);
  if (frozen?.freeze) buffs.push({ name: 'timeFreeze', turns: Math.trunc(frozen.freeze.turnsToCost + 0.001) });
  for (const item of heroArtifacts(me)) {
    if (item.kind === 'artifact.cape' && (item.cooldown ?? 0) > 0) buffs.push({ name: 'thorns', turns: item.cooldown! });
    if (item.kind === 'artifact.talisman' && item.warn) buffs.push({ name: 'foresight', tint: 17 });
  }
  return buffs;
}

/** Alchemy's buffs on a hero (core buffs.ts), with their turns or amounts as BuffIndicator shows them. */
function alchemyBuffs(me: Hero): BuffEntry[] {
  const b = me.buffs;
  if (!b) return [];
  const list: BuffEntry[] = [];
  const timed = (name: BuffName, left: number | undefined): void => {
    if ((left ?? 0) > 0) list.push({ name, turns: Math.ceil(left!) });
  };
  timed('haste', b.haste);
  timed('stamina', b.stamina);
  timed('magicalSight', b.magicalSight);
  timed('magicImmune', b.magicImmune);
  timed('foresight', b.foresight);
  timed('fireImbue', b.fireImbue);
  timed('frostImbue', b.frostImbue);
  timed('toxicImbue', b.toxicImbue);
  timed('featherFall', b.featherFall);
  timed('cleanse', b.cleanse);
  timed('drowsy', b.drowsy);
  if (b.magicalSleep) list.push({ name: 'magicalSleep' });
  if (b.healing && b.healing.left > 0) list.push({ name: 'potionHealing', turns: Math.ceil(b.healing.left) });
  if (b.arcaneArmor && b.arcaneArmor.level > 0) list.push({ name: 'arcaneArmor', turns: b.arcaneArmor.level });
  if (b.barkskin && b.barkskin.level > 0) list.push({ name: 'barkskin', turns: b.barkskin.level });
  timed('aquaHealing', b.aquaHealing);
  timed('htBoost', b.htBoost);
  timed('wellFed', b.wellFed);
  timed('prismaticGuard', b.prismaticGuard);
  // At full strength the prismatic guard has a colour of its own (Shattered: ShieldBuff at its limit).
  const guard = list.find((buff) => buff.name === 'prismaticGuard');
  if (guard && (b.prismaticGuard ?? 0) >= prismaticMaxHp(me)) guard.tint = 8;
  if (b.challenge && b.challenge.left > 0) list.push({ name: 'challengeArena', turns: Math.ceil(b.challenge.left) });
  return list;
}

export interface HudHandlers {
  hero(): void;
  menu(): void;
  /** A tap on the hourglass: wait a turn. */
  wait(): void;
  /** Holding it: rest until healed. */
  rest(): void;
  search(): void;
  examine(): void;
  /** A tap on a quick slot (0-5): use what it holds, or choose what it should hold. */
  quick(slot: number): void;
  /** Holding a quick slot: choose what it should hold (Toolbar's quickslot_assign). */
  assignQuick(slot: number): void;
  /** A tap on the danger indicator: the next enemy in sight. */
  danger(): void;
  backpack(): void;
  journal(): void;
  settings(): void;
  history(): void;
  /** A tap on a buff icon: what it is. */
  buff(name: BuffName, turns?: number): void;
  /** A tap on the health bar: what the numbers, the red pulse and the regeneration mean right now. */
  vitals(): void;
  /** A tap on a companion. */
  mate(id: string): void;
  /** The arena's «To battle!» (pressed again: not ready after all). */
  fight(): void;
}

/** The arena of waves in the HUD (design system v14): the wave board, «To battle!», who is ready. */
export interface ArenaHud {
  phase: 'fight' | 'rest';
  /** The wave on, or (at rest) the last one beaten. */
  wave: number;
  /** Monsters of the wave still to beat, and the share of it beaten. */
  left: number;
  beaten: number;
  champions: boolean;
  /** Co-op: how many living heroes are ready, of how many; and the names still awaited. */
  ready: readonly [number, number] | null;
  waiting: readonly string[];
  /** I pressed «To battle!» already. */
  meReady: boolean;
  /** What each companion is up to at rest, by hero id. */
  mates: Readonly<Record<string, 'ready' | 'picking' | 'resting'>>;
}

/** The status line under the HUD: one passing state at a time (the design's .pd-status). */
export interface HudStatus {
  kind: 'connecting' | 'reconnecting' | 'dead' | 'target' | 'examine' | 'waiting';
  text: string;
  /** Companions the turn waits for, shown in their colour. */
  names?: readonly string[];
  /** The item being aimed. */
  item?: number;
  cancel?: { label: string; onClick(): void };
}

export interface HudState {
  me: Hero;
  /** Other heroes in the party, for the co-op roster. */
  party: Hero[];
  online: readonly string[];
  status: HudStatus | null;
  log: readonly LogLine[];
  buffs: readonly BuffEntry[];
  /** The quick slots shown (QuickSlot), each with what it holds, or null when empty. */
  quick: ReadonlyArray<QuickState | null>;
  /** DangerIndicator: how many enemies the hero sees. */
  danger: number;
  /** Companions the party is waiting for now (their cards say «their move»). */
  waitingFor?: readonly string[];
  /** Iron keys for the current depth. */
  keys: number;
  examining: boolean;
  /** Something new in the backpack since it was last opened. */
  newLoot: boolean;
  /** What each player wears (Pixel-Mart): my portrait's frame, the patron's star by companions' names. */
  looks: Record<string, Look>;
  /** In the arena of waves: its board and readiness instead of the depth. */
  arena?: ArenaHud | null;
  /** BossHealthBar: the boss of the fight on my depth, its health and shield; bleeding at its last stand. */
  boss?: { kind: MobKind; hp: number; ht: number; shield: number; bleed: boolean } | null;
}

/** «осталось {n}»: the text with the number in bold, as the design writes it. */
function withNumber(template: string, n: string): Node[] {
  const [before = '', after = ''] = template.split('{n}');
  const parts: Node[] = [];
  if (before) parts.push(document.createTextNode(before));
  parts.push(el('b', '', n));
  if (after) parts.push(document.createTextNode(after));
  return parts;
}

export interface QuickState {
  sprite: number;
  label: string;
  aiming: boolean;
  /** QuickSlot.isPlaceholder: none of it left; drawn greyed until more is picked up. */
  placeholder?: boolean;
  /** An artifact's charge: the strip at the bottom of its icon (ShArtifact's .pd-charge). */
  charge?: { share: number; full: boolean } | null;
  wear?: { left: number; max: number } | null;
}

/** How long a log line stays, and how many are shown at once (three on short screens). */
const LOG_MS = 8000;
const HOLD_MS = 600;

type Child = Node | string | null | undefined | false;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', ...children: Child[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  for (const child of children) if (child) node.append(child);
  return node;
}

function icon(sprite: string, width?: number, height?: number): HTMLElement {
  const node = el('i', 'pd-icon');
  node.style.backgroundImage = `var(--spr-${sprite})`;
  if (width) node.style.width = `${width}px`;
  if (height) node.style.height = `${height}px`;
  return node;
}

/** A toolbar glyph from toolbar.png, cut by the design system (--w/--h: its size in pixels). */
function glyph(sprite: string, w: number, h: number): HTMLElement {
  const node = icon(sprite);
  node.style.setProperty('--w', String(w));
  node.style.setProperty('--h', String(h));
  return node;
}

/** What the status line holds: an icon or three stepping dots, then the text. */
function statusContent(status: HudStatus): Node[] {
  const text = el('span', 'pd-status-text');
  if (status.names?.length) {
    text.append(`${status.text} `);
    status.names.forEach((name, i) => text.append(...[i > 0 ? ', ' : '', el('span', 'pd-ally', name)].filter(Boolean) as Array<string | Node>));
    text.append('…');
  } else {
    text.textContent = status.text;
  }
  let lead: HTMLElement;
  if (status.kind === 'connecting' || status.kind === 'reconnecting') {
    lead = el('span', 'pd-dots', el('i'), el('i'), el('i'));
  } else if (status.kind === 'target' && status.item !== undefined) {
    lead = el('i', 'pd-item');
    lead.dataset.i = String(status.item);
    lead.style.width = '32px';
    lead.style.height = '32px';
    lead.style.backgroundSize = '256px 512px';
  } else {
    lead = icon(status.kind === 'dead' ? 'skull' : status.kind === 'examine' ? 'tool-info' : status.kind === 'waiting' ? 'busy' : 'target');
    if (status.kind === 'examine') {
      lead.style.width = '16px';
      lead.style.height = '24px';
    }
  }
  return [lead, text];
}

export class Hud {
  readonly root: HTMLElement;
  private readonly band: HTMLElement;
  private readonly avatar: HTMLElement;
  /** ShTalents' gold plus on the hero button while there are talent points to spend. */
  private readonly talentBadge: HTMLElement;
  private readonly level: HTMLElement;
  private readonly hp: HTMLElement;
  private readonly hpText: HTMLElement;
  private readonly hpLag: HTMLElement;
  private readonly xp: HTMLElement;
  private readonly food: HTMLElement;
  private readonly depth: Text;
  private readonly depthStat: HTMLElement;
  /** The arena's board and «To battle!» (hidden in the dungeon). */
  private readonly waveboard: HTMLElement;
  /** BossHealthBar: the boss's name over its health and shield. */
  private readonly bossBox: HTMLElement;
  private readonly bossName: HTMLElement;
  private readonly bossHp: HTMLElement;
  private readonly bossText: HTMLElement;
  private readonly fightBox: HTMLElement;
  private readonly fightButton: HTMLButtonElement;
  private readonly fightNote: HTMLElement;
  private readonly keys: Text;
  private readonly buffBox: HTMLElement;
  private readonly mates: HTMLElement;
  private readonly notice: HTMLElement;
  private readonly log: HTMLElement;
  private readonly more: HTMLElement;
  private readonly tools: Record<'wait' | 'search' | 'examine' | 'bag', HTMLButtonElement>;
  /** The six quick slots (QuickSlot.SIZE); as many shown as there is room for. */
  private readonly quicks: HTMLButtonElement[];
  /** The six quick slots in a row of their own above the toolbar (the 6-slot layout, design v19 .pd-quickbar). */
  private readonly quickbar: HTMLElement;
  /** How many quick slots the narrow toolbar is arranged for (2, 4 or 6), and whether examining is a long press of search. */
  private arranged = 0;
  private examineByHold = false;
  /** DangerIndicator: the count of enemies in sight, by the buffs. */
  private readonly dangerBox: HTMLButtonElement;
  /** How many enemies the badge counted last, and the timer that ends its flash. */
  private dangerSeen = 0;
  private dangerFlash = 0;
  private readonly main: HTMLElement;
  private readonly menu: HTMLButtonElement;
  private readonly toolbar: HTMLElement;
  /** The wide screen's own places: the column, the corner and the two islands. */
  private readonly column: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly corner: HTMLElement;
  private readonly islandLeft: HTMLElement;
  private readonly islandRight: HTMLElement;
  /** Whether the wide layout is on, and its whole-number scale. */
  wide = false;
  scale = 1;
  private laid = false;
  /** What each part last showed, so the DOM is only touched when something changed. */
  private shown: Record<string, string> = {};
  private hold: { start: number; timer: number; fired: boolean } | null = null;

  constructor(private readonly handlers: HudHandlers) {
    this.root = document.getElementById('ui')!;
    const tap = (fn: () => void) => (): void => {
      audio.play('click');
      fn();
    };

    const avatarButton = el('button', 'pd-avatar');
    avatarButton.ariaLabel = t.heroLabel;
    this.talentBadge = el('i', 'pd-talent-badge');
    this.talentBadge.hidden = true;
    this.avatar = el('i');
    avatarButton.append(this.avatar);
    avatarButton.onclick = tap(() => handlers.hero());
    this.level = el('span', 'pd-hero-lvl');
    this.hpText = el('span', 'pd-bar-text');
    // The wound's trace: a pale stretch where health was, melting away a moment after a blow.
    this.hpLag = el('span', 'pd-bar-lag');
    this.hp = el('div', 'pd-bar', this.hpLag, this.hpText);
    this.hp.onclick = tap(() => handlers.vitals());
    this.xp = el('div', 'pd-bar thin xp');
    this.food = el('div', 'pd-bar thin food');
    this.depth = document.createTextNode('');
    this.keys = document.createTextNode('');
    const menu = el('button', 'pd-menu');
    menu.ariaLabel = t.menu;
    menu.setAttribute('aria-keyshortcuts', 'Escape');
    menu.title = `${t.menu} (Esc)`;
    menu.onclick = tap(() => handlers.menu());
    this.menu = menu;
    this.buffBox = el('div', 'pd-buffs');
    this.mates = el('div', 'pd-mates');
    this.notice = el('div', 'pd-status');
    this.notice.setAttribute('role', 'status');
    this.waveboard = el('div', 'pd-waveboard');
    this.waveboard.setAttribute('role', 'status');
    this.waveboard.hidden = true;
    this.fightButton = el('button', 'pd-button primary', t.arena.fight);
    this.fightButton.onclick = tap(() => handlers.fight());
    this.fightNote = el('span', 'pd-fight-note');
    this.fightBox = el('div', 'pd-fight', this.fightButton, this.fightNote);
    this.fightBox.hidden = true;
    this.depthStat = el('span', 'pd-stat', icon('depth'), this.depth);
    this.main = el(
        'div',
        'pd-hud-main',
        el('div', 'pd-avatar-wrap', avatarButton, this.level, this.talentBadge),
        el(
          'div',
          'pd-hud-bars',
          this.hp,
          el(
            'div',
            'pd-bars-small',
            el('div', 'pd-bar-pair', icon('star'), this.xp),
            el('div', 'pd-bar-pair', icon('food'), this.food),
          ),
        ),
        el(
          'div',
          'pd-hud-side',
          this.depthStat,
          el('span', 'pd-stat', icon('key', 14, 18), this.keys),
        ),
        menu,
      );
    this.bossName = el('span', 'pd-boss-name');
    this.bossText = el('span', 'pd-bar-text');
    this.bossHp = el('div', 'pd-bar boss', this.bossText);
    this.bossBox = el('div', 'pd-bossbar', icon('skull'), this.bossName, this.bossHp);
    this.bossBox.setAttribute('role', 'status');
    this.bossBox.hidden = true;
    this.band = el('header', 'pd-hud', this.main, this.bossBox, this.waveboard, this.buffBox, this.mates, this.notice);

    this.more = el('button', 'pd-log-more', t.history);
    this.more.onclick = tap(() => handlers.history());
    this.log = el('div', 'pd-log', this.more);

    const tool = (label: string, className: string, key: string, ...content: Child[]): HTMLButtonElement => {
      const node = el('button', `pd-tool${className ? ` ${className}` : ''}`, ...content);
      node.ariaLabel = label;
      node.setAttribute('aria-keyshortcuts', key);
      node.dataset.key = key === ' ' ? 'Space' : key;
      return node;
    };
    this.tools = {
      wait: tool(t.waitLabel, 'wait', 'Space', glyph('tool-wait2', 12, 12)),
      search: tool(t.searchLabel, 'search', 'F', glyph('tool-search2', 12, 12)),
      examine: tool(t.examineLabel, 'info', 'X', glyph('tool-info', 8, 12)),
      bag: tool(t.backpack, 'bag', 'I', glyph('tool-backpack', 14, 15)),
    };
    this.quicks = Array.from({ length: QUICKSLOTS }, (_, slot) => {
      const node = tool(t.quickLabel, 'quick empty', String(slot + 1));
      this.holdToAssign(node, slot);
      return node;
    });
    this.quickbar = el('div', 'pd-quickbar');
    this.dangerBox = el('button', 'pd-danger');
    this.dangerBox.hidden = true;
    this.dangerBox.onclick = tap(() => handlers.danger());
    this.holdToSearch(this.tools.search);
    this.tools.examine.onclick = tap(() => handlers.examine());
    this.tools.bag.onclick = tap(() => handlers.backpack());
    this.holdToRest(this.tools.wait);
    this.toolbar = el('nav', 'pd-toolbar');
    this.toolbar.ariaLabel = t.actionsLabel;

    // The wide screen's places, filled by setLayout.
    const cornerButton = (kind: string, label: string, key: string, act: () => void): HTMLButtonElement => {
      const node = el('button', `pd-mapbtn ${kind}`);
      node.ariaLabel = label;
      if (key) node.setAttribute('aria-keyshortcuts', key);
      // A tooltip on a computer: what the button is, and its key.
      node.title = key ? `${label} (${key})` : label;
      node.onclick = tap(act);
      return node;
    };
    this.panel = el('header', 'pd-dpanel pd-dhud');
    this.column = el('div', 'pd-dcol');
    this.corner = el(
      'div',
      'pd-dcorner',
      cornerButton('journal', t.meta.journal, 'J', () => handlers.journal()),
      cornerButton('prefs', t.meta.settings, '', () => handlers.settings()),
    );
    this.islandLeft = el('nav', 'pd-dbar left');
    this.islandLeft.ariaLabel = t.actionsLabel;
    this.islandRight = el('nav', 'pd-dbar right');
    this.islandRight.ariaLabel = t.backpack;

    this.root.prepend(this.band, this.log, this.toolbar);
    this.root.append(this.fightBox);
    this.setLayout(false, 1);
  }

  /**
   * The phone's arrangement or the wide screen's (from 900 px), and the wide one's whole-number
   * scale. The same nodes move between places; nothing else in the layer (the map's buttons,
   * the finds) is touched.
   */
  setLayout(wide: boolean, scale: number): void {
    if (this.laid && this.wide === wide && this.scale === (wide ? scale : 1)) return;
    this.laid = true;
    this.wide = wide;
    this.scale = wide ? scale : 1;
    this.root.classList.toggle('pd-ui', wide);
    this.root.classList.toggle('pd-wide', wide);
    this.root.style.setProperty('--ui', String(this.scale));
    // The key under each button on the wide screen's islands.
    for (const button of Object.values(this.tools)) {
      button.querySelector('.pd-key')?.remove();
      if (wide) button.prepend(el('span', 'pd-key', button.dataset.key ?? ''));
    }
    this.menu.className = wide ? 'pd-mapbtn menu' : 'pd-menu';
    this.mates.className = wide ? 'pd-party' : 'pd-mates';
    delete this.shown.mates;
    for (let slot = 0; slot < QUICKSLOTS; slot++) delete this.shown[`quick${slot}`];
    if (wide) {
      this.main.querySelector('.pd-menu, .pd-mapbtn.menu')?.remove();
      this.corner.append(this.menu);
      this.panel.append(this.main, this.buffBox);
      this.column.append(this.panel, this.mates, this.notice);
      this.islandLeft.append(this.tools.wait, this.tools.examine, this.tools.search);
      this.islandRight.append(...this.quicks, this.tools.bag);
      this.corner.append(this.dangerBox);
      this.band.remove();
      this.toolbar.remove();
      // The arena's board stands at the top in the middle.
      this.waveboard.classList.add('top');
      this.root.prepend(this.column, this.corner, this.waveboard, this.log, this.islandLeft, this.islandRight);
    } else {
      this.main.append(this.menu);
      this.waveboard.classList.remove('top');
      this.band.append(this.main, this.waveboard, this.buffBox, this.mates, this.notice);
      this.arranged = 0;
      this.arrangeToolbar(this.quicksShown);
      this.band.append(this.dangerBox);
      this.column.remove();
      this.corner.remove();
      this.islandLeft.remove();
      this.islandRight.remove();
      this.root.prepend(this.band, this.log, this.toolbar);
    }
  }

  /** How many quick slots are shown now (the last state's). */
  private quicksShown = 4;

  /**
   * The narrow toolbar for 2, 4 or 6 quick slots (design v19, ShQuickslots): 2 beside wait, examine, search and the pack;
   * 4 in one row of seven (examining is a long press of search); 6 in a row of their own above the four buttons.
   * Wait (the hourglass) and search (the magnifier) are never neighbours (the forum study's U2): a turn spent standing still
   * must not be taken for a search, nor the reverse; examine, or the quick slots, stand between them.
   */
  private arrangeToolbar(count: number): void {
    this.quicksShown = count;
    if (this.wide || this.arranged === count) return;
    this.arranged = count;
    const { wait, search, examine, bag } = this.tools;
    this.examineByHold = count === 4;
    // Design v23 (Toolbar2): a flex row of equal buttons with 6 px between them and 6 px more after wait and before search (three groups: time, things,
    // search and pack); with four slots the extra 6 px go (`dense`), so 360 px still gives 44 px buttons; six slots stand in a row above.
    this.toolbar.className = `pd-toolbar tb2${count >= 6 ? ' q6' : count === 4 ? ' dense' : ''}`;
    search.classList.toggle('gap', count < 6);
    if (count >= 6) {
      this.quickbar.replaceChildren(...this.quicks.slice(0, 6));
      this.toolbar.replaceChildren(this.quickbar, wait, examine, search, bag);
    } else if (count === 4) {
      this.quickbar.replaceChildren();
      this.toolbar.replaceChildren(wait, ...this.quicks.slice(0, 4), search, bag);
    } else {
      this.quickbar.replaceChildren();
      this.toolbar.replaceChildren(wait, examine, ...this.quicks.slice(0, count), search, bag);
    }
    this.toolbar.style.setProperty('--tools', String(4 + count));
  }

  /** Search: a tap searches; where there is no examine button (4 quick slots), holding it examines. */
  private holdToSearch(button: HTMLButtonElement): void {
    let timer = 0;
    let fired = false;
    button.addEventListener('pointerdown', () => {
      fired = false;
      clearTimeout(timer);
      if (!this.examineByHold) return;
      timer = window.setTimeout(() => {
        fired = true;
        audio.play('click');
        this.handlers.examine();
      }, HOLD_MS);
    });
    const stop = (): void => clearTimeout(timer);
    button.addEventListener('pointerleave', stop);
    button.addEventListener('pointercancel', stop);
    button.addEventListener('pointerup', stop);
    button.onclick = () => {
      if (fired) {
        fired = false;
        return;
      }
      audio.play('click');
      this.handlers.search();
    };
  }

  /** A quick slot: a tap uses it; holding it chooses what it holds (QuickSlotButton's long click). */
  private holdToAssign(button: HTMLButtonElement, slot: number): void {
    let timer = 0;
    let fired = false;
    button.addEventListener('pointerdown', () => {
      fired = false;
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        fired = true;
        this.handlers.assignQuick(slot);
      }, HOLD_MS);
    });
    const stop = (): void => clearTimeout(timer);
    button.addEventListener('pointerleave', stop);
    button.addEventListener('pointercancel', stop);
    button.addEventListener('pointerup', stop);
    button.onclick = (): void => {
      audio.play('click');
      if (!fired) this.handlers.quick(slot);
    };
  }

  /** The hourglass: a tap waits a turn; holding it fills a bar in steps, then rests until healed. */
  private holdToRest(button: HTMLButtonElement): void {
    const stop = (): void => {
      if (!this.hold) return;
      clearInterval(this.hold.timer);
      button.classList.remove('holding');
      button.style.removeProperty('--hold');
      this.hold = null;
    };
    button.addEventListener('pointerdown', () => {
      stop();
      audio.play('click');
      button.classList.remove('resting');
      const hold = { start: performance.now(), fired: false, timer: 0 };
      hold.timer = window.setInterval(() => {
        const v = Math.min(1, (performance.now() - hold.start) / HOLD_MS);
        button.style.setProperty('--hold', String(Math.floor(v * 8) / 8));
        if (v >= 1 && !hold.fired) {
          hold.fired = true;
          clearInterval(hold.timer);
          button.classList.remove('holding');
          this.handlers.rest();
        }
      }, 30);
      button.classList.add('holding');
      this.hold = hold;
    });
    button.addEventListener('pointerup', () => {
      const hold = this.hold;
      stop();
      if (hold && !hold.fired) this.handlers.wait();
    });
    button.addEventListener('pointerleave', stop);
    button.addEventListener('pointercancel', stop);
  }

  show(on: boolean): void {
    this.root.hidden = !on;
  }

  /** Sets a part's content only when it changed. */
  private changed(key: string, value: string): boolean {
    if (this.shown[key] === value) return false;
    this.shown[key] = value;
    return true;
  }

  update(state: HudState, resting: boolean): void {
    const { me } = state;
    const dead = !isAlive(me);
    if (this.changed('av', `${me.heroClass}:${state.looks[me.id]?.skin ?? ''}`)) setAvatar(this.avatar, me.heroClass, state.looks[me.id]?.skin);
    // Pixel-Mart: the portrait's frame.
    const frame = state.looks[me.id]?.frame ?? '';
    if (this.changed('frame', frame)) {
      const portrait = this.avatar.parentElement!;
      portrait.className = `pd-avatar${frame ? ` framed frame-${frame}` : ''}`;
    }
    if (this.changed('lvl', String(me.lvl))) this.level.textContent = String(me.lvl);
    const free = !dead && hasFreePoints(me);
    if (this.changed('talent', String(free))) {
      this.talentBadge.hidden = !free;
      this.talentBadge.parentElement?.classList.toggle('talent', free);
    }
    const hp = Math.max(0, me.hp);
    // StatusPane: the shield (the warrior's seal) over the health bar, and «hp+shield/ht».
    const shield = shielding(me);
    if (this.changed('hp', `${hp}/${me.ht}/${me.poison > 0}/${shield}`)) {
      const share = hp / me.ht;
      const before = Number(this.hp.style.getPropertyValue('--v') || share);
      this.hp.style.setProperty('--v', String(share));
      // Healing fills at once; a wound leaves its trace, which follows down after a beat (CSS).
      if (share >= before) this.hpLag.style.setProperty('--lag', String(share));
      else window.setTimeout(() => this.hpLag.style.setProperty('--lag', String(share)), 0);
      this.hp.classList.toggle('low', hp <= me.ht / 4);
      this.hp.classList.toggle('poisoned', me.poison > 0);
      this.hp.classList.toggle('shield', shield > 0);
      this.hp.style.setProperty('--shield', String(Math.min(1, shield / me.ht)));
      this.hpText.textContent = shield > 0 ? `${hp}+${shield}/${me.ht}` : `${hp}/${me.ht}`;
    }
    if (this.changed('xp', `${me.exp}/${maxExp(me)}`)) this.xp.style.setProperty('--v', String(Math.min(1, me.exp / maxExp(me))));
    if (this.changed('food', String(Math.round(me.hunger)))) {
      this.food.style.setProperty('--v', String(Math.max(0, 1 - me.hunger / STARVING)));
      this.food.classList.toggle('hungry', isHungry(me) && !isStarving(me));
      this.food.classList.toggle('starving', isStarving(me));
    }
    if (this.changed('depth', String(me.depth))) this.depth.data = String(me.depth);
    // The arena has no depths to speak of: its board says where the party stands.
    this.depthStat.style.display = state.arena ? 'none' : '';
    this.updateArena(state.arena ?? null, dead);
    if (this.changed('keys', String(state.keys))) this.keys.data = String(state.keys);
    const boss = state.boss;
    if (this.changed('boss', boss ? `${boss.kind}:${boss.hp}/${boss.ht}:${boss.shield}:${boss.bleed}` : '')) {
      this.bossBox.hidden = !boss;
      if (boss) {
        this.bossName.textContent = t.mobs[boss.kind];
        this.bossHp.style.setProperty('--v', String(Math.max(0, boss.hp) / boss.ht));
        this.bossHp.style.setProperty('--shield', String(Math.min(1, boss.shield / boss.ht)));
        this.bossHp.classList.toggle('shield', boss.shield > 0);
        this.bossBox.classList.toggle('bleeding', boss.bleed);
        this.bossText.textContent = boss.shield > 0 ? `${boss.hp}+${boss.shield}/${boss.ht}` : `${boss.hp}/${boss.ht}`;
      }
    }
    this.avatar.parentElement!.classList.toggle('dead', dead);

    const buffKey = state.buffs.map((b) => `${b.name}${b.tint ?? ''}${b.frame ?? ''}:${b.turns !== undefined && b.turns <= 3 ? 'f' : ''}`).join(',');
    if (this.changed('buffs', buffKey)) {
      this.buffBox.replaceChildren(
        ...state.buffs.map((buff) => {
          const glyphNode = buffGlyph(buff);
          const node = el('button', `pd-buff${buff.turns !== undefined && buff.turns <= 3 ? ' fading' : ''}`, glyphNode);
          node.ariaLabel = t.buffs[buff.name];
          node.onclick = () => this.handlers.buff(buff.name, buff.turns);
          return node;
        }),
      );
      sprites(this.buffBox);
    }

    const arena = state.arena;
    const mateKey = state.party
      .map((h) => `${h.id}:${h.name}:${h.heroClass}:${Math.max(0, h.hp)}/${h.ht}:${h.depth}:${state.online.includes(h.id)}:${state.looks[h.id]?.patron ?? ''}:${state.waitingFor?.includes(h.id) ?? false}:${arena?.mates[h.id] ?? ''}`)
      .join('|') + `@${me.depth}:${Boolean(arena)}`;
    if (this.changed('mates', mateKey)) {
      this.mates.hidden = state.party.length === 0;
      this.mates.replaceChildren(
        ...state.party.map((hero) => {
          const face = el('i', 'pd-mate-face');
          face.style.setProperty('--av', String(AVATAR[hero.heroClass]));
          const bar = el('div', 'pd-bar');
          bar.style.setProperty('--v', String(Math.max(0, hero.hp) / hero.ht));
          const away = hero.depth !== me.depth || !state.online.includes(hero.id);
          const turn = Boolean(state.waitingFor?.includes(hero.id));
          // The wide screen's card says what the companion is up to.
          // At the arena's rest: ready, picking a reward, or resting.
          const rest = arena?.mates[hero.id];
          const what = !isAlive(hero) ? t.mateFallen
            : !state.online.includes(hero.id) ? t.mateOffline
            : rest === 'ready' ? t.arena.readyMark
            : rest === 'picking' ? t.arena.picking
            : rest === 'resting' ? t.arena.resting
            : hero.depth !== me.depth ? t.mateOnDepth(hero.depth)
            : turn ? t.mateTurn : '';
          // The arena has no depths: none on the cards either.
          const depth = arena ? '' : String(hero.depth);
          const node = el(
            'button',
            `${this.wide ? 'pd-pcard' : 'pd-mate'}${!isAlive(hero) ? ' dead' : turn ? ' turn' : away ? ' away' : ''}${rest === 'ready' ? ' ready' : ''}`,
            face,
            el('span', 'pd-mate-name', state.looks[hero.id]?.patron ? el('i', 'pd-patron-mark sm') : null, hero.name),
            this.wide ? el('span', 'pd-mate-depth', depth) : bar,
            this.wide ? bar : el('span', 'pd-mate-depth', depth),
            this.wide && el('span', 'pd-pstate', what),
          );
          node.onclick = () => this.handlers.mate(hero.id);
          return node;
        }),
      );
    }

    const status = state.status;
    if (this.changed('notice', status ? `${status.kind}|${status.text}|${status.names?.join(',') ?? ''}|${status.item ?? ''}` : '')) {
      this.notice.hidden = !status;
      this.notice.className = `pd-status${status ? ` ${status.kind}` : ''}`;
      this.notice.replaceChildren();
      if (status) this.notice.append(...statusContent(status));
      if (status?.cancel) {
        const cancel = el('button', 'pd-button small', status.cancel.label);
        const onClick = status.cancel.onClick;
        cancel.onclick = () => {
          audio.play('click');
          onClick();
        };
        this.notice.append(cancel);
      }
      sprites(this.notice);
    }

    this.updateLog(state.log);

    // Toolbar.layout: as many slots as the screen has room for; the toolbar's columns follow.
    this.quicks.forEach((button, slot) => {
      button.hidden = slot >= state.quick.length;
      this.drawQuick(`quick${slot}`, button, state.quick[slot] ?? null);
    });
    if (this.changed('quickCount', String(state.quick.length))) this.arrangeToolbar(state.quick.length);
    if (this.changed('danger', String(state.danger))) {
      // A new enemy in sight: the badge flashes three times (design v19, .new for 1.5 s).
      if (state.danger > this.dangerSeen) {
        this.dangerBox.classList.add('new');
        clearTimeout(this.dangerFlash);
        this.dangerFlash = window.setTimeout(() => this.dangerBox.classList.remove('new'), 1500);
      }
      this.dangerSeen = state.danger;
      this.dangerBox.hidden = state.danger === 0;
      this.dangerBox.textContent = String(state.danger);
      this.dangerBox.ariaLabel = t.hero.danger(state.danger);
    }
    this.tools.examine.setAttribute('aria-pressed', String(state.examining));
    this.tools.bag.classList.toggle('alert', state.newLoot);
    this.tools.wait.classList.toggle('resting', resting);
    for (const button of Object.values(this.tools)) button.disabled = dead;
  }

  /**
   * The arena's board: «Wave 7 · 5 left» and how much of it is beaten, in a fight; «Breather ·
   * Wave 8 · Ready 2/3» at rest. And at rest «To battle!» over the log, with who is awaited.
   */
  private updateArena(arena: ArenaHud | null, dead: boolean): void {
    const key = arena
      ? `${arena.phase}:${arena.wave}:${arena.left}:${arena.beaten.toFixed(2)}:${arena.champions}:${arena.ready?.join('/') ?? ''}:${this.wide}`
      : '';
    if (this.changed('waveboard', key)) {
      this.waveboard.hidden = !arena;
      if (arena) {
        const rest = arena.phase === 'rest';
        this.waveboard.className = `pd-waveboard${rest ? ' rest' : ''}${!rest && arena.champions ? ' champions' : ''}${this.wide ? ' top' : ''}`;
        if (rest) {
          this.waveboard.replaceChildren(
            el('span', 'pd-wave-n', t.arena.rest),
            el('span', 'pd-wave-left', t.arena.wave(arena.wave + 1)),
            ...(arena.ready ? [el('span', 'pd-wave-ready', t.arena.ready(arena.ready[0], arena.ready[1]))] : []),
          );
        } else {
          const bar = el('div', 'pd-bar');
          bar.style.setProperty('--v', String(arena.beaten));
          this.waveboard.replaceChildren(
            el('span', 'pd-wave-n', t.arena.wave(arena.wave)),
            el('span', 'pd-wave-left', ...withNumber(t.arena.left, String(arena.left))),
            bar,
          );
        }
      }
    }
    const fight = arena?.phase === 'rest' && !dead;
    const fightKey = fight ? `${arena.meReady}:${arena.ready?.join('/') ?? ''}:${arena.waiting.join(',')}` : '';
    if (this.changed('fight', fightKey)) {
      this.fightBox.hidden = !fight;
      if (fight) {
        this.fightButton.classList.toggle('waiting', arena.meReady);
        this.fightButton.setAttribute('aria-pressed', String(arena.meReady));
        // Alone, the button simply starts the wave: nothing to say under it.
        const note: Node[] = [];
        if (arena.ready) {
          note.push(document.createTextNode(t.arena.ready(arena.ready[0], arena.ready[1])));
          if (arena.waiting.length > 0) note.push(document.createTextNode(' · '), ...withNumber(t.arena.waitingFor, arena.waiting.join(', ')));
        }
        this.fightNote.replaceChildren(...note);
        this.fightNote.hidden = note.length === 0;
      }
    }
  }

  /** A quick slot's button: the item, its count or charges, its wear; the key on a wide screen. */

  private drawQuick(key: string, button: HTMLButtonElement, quick: QuickState | null): void {
    const charge = quick?.charge ? `${Math.round(quick.charge.share * 100)}${quick.charge.full ? 'f' : ''}` : '';
    if (!this.changed(key, quick ? `${quick.sprite}:${quick.label}:${quick.aiming}:${quick.wear?.left ?? ''}:${quick.placeholder ?? ''}:${charge}` : '')) return;
    button.classList.toggle('empty', !quick);
    button.classList.toggle('placeholder', Boolean(quick?.placeholder));
    button.classList.toggle('targeting', Boolean(quick?.aiming));
    const label = this.wide ? [el('span', 'pd-key', button.dataset.key ?? '')] : [];
    if (quick) {
      const item = el('i', 'pd-item');
      item.dataset.i = String(quick.sprite);
      button.replaceChildren(...label, item);
      if (quick.label) button.append(el('span', 'pd-qty', quick.label));
      if (quick.wear) {
        button.append(durabilityBar(quick.wear.left, quick.wear.max));
        markWear(button);
      } else {
        button.classList.remove('has-dur', 'broken');
      }
      if (quick.charge) {
        const strip = el('span', `pd-charge${quick.charge.full ? ' full' : ''}`);
        strip.style.setProperty('--v', String(quick.charge.share));
        button.append(strip);
      }
      sprites(button);
    } else {
      button.replaceChildren(...label);
    }
  }

  /** The last few lines, older ones dimmer; each goes out after a while and frees the band. */
  private updateLog(log: readonly LogLine[]): void {
    const now = performance.now();
    const max = innerHeight < 700 ? 3 : 4;
    const lines = log.filter((line) => now - line.time < LOG_MS).slice(-max);
    const key = lines.map((line) => `${line.time}:${line.count ?? 1}`).join(',');
    if (!this.changed('log', key)) return;
    this.log.hidden = lines.length === 0;
    this.log.replaceChildren(
      ...lines.map((line, i) => {
        const row = el('div', `pd-log-line${line.tone ? ` ${line.tone}` : ''}`, line.text);
        if ((line.count ?? 1) > 1) row.append(el('span', 'pd-n', `×${line.count}`));
        row.dataset.age = String(Math.min(3, lines.length - 1 - i));
        return row;
      }),
      this.more,
    );
  }

  /** The band of the screen left for the map, in CSS pixels from the top: between the HUD and the log or toolbar. */
  freeZone(): { top: number; bottom: number } {
    if (this.root.hidden) return { top: 0, bottom: innerHeight };
    // Wide, the column and the islands sit at the sides: the map has the whole height.
    if (this.wide) return { top: 0, bottom: this.islandLeft.getBoundingClientRect().top };
    const top = this.band.getBoundingClientRect().bottom;
    const toolbar = this.toolbar.getBoundingClientRect().top;
    return { top, bottom: toolbar };
  }

  /** The HUD's height, for toasts to appear under it (wide, they come at the top). */
  height(): number {
    if (this.root.hidden || this.wide) return 0;
    return this.band.getBoundingClientRect().bottom;
  }
}
