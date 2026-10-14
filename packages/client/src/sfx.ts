import { T, type TrapKind } from '@pd/core';

/*
 * Shattered Pixel Dungeon's sound effects (Assets.Sounds), and which of them an event plays, as Shattered
 * plays them: a weapon's own hit, what a step or a falling item sounds on, how loud the hero's wounds ring.
 * Nothing here plays anything; audio.ts does.
 */

/** Shattered's 67 sound files (Assets.Sounds.all), by their names. */
export const SAMPLES = [
  'alert', 'atk_crossbow', 'atk_spiritbow', 'badge', 'beacon', 'bee', 'blast', 'bones', 'boss', 'burning', 'chains',
  'challenge', 'chargeup', 'charms', 'click', 'cursed', 'death', 'debuff', 'degrade', 'descend', 'dewdrop', 'door_open',
  'drink', 'eat', 'evoke', 'falling', 'gas', 'ghost', 'gold', 'grass', 'health_critical', 'health_warn', 'hit',
  'hit_arrow', 'hit_crush', 'hit_magic', 'hit_parry', 'hit_slash', 'hit_stab', 'hit_strong', 'item', 'levelup',
  'lightning', 'lullaby', 'mastery', 'meld', 'mimic', 'mine', 'miss', 'plant', 'puff', 'ray', 'read', 'rocks', 'scan',
  'secret', 'shatter', 'sheep', 'step', 'sturdy', 'teleport', 'tomb', 'trample', 'trap', 'unlock', 'water', 'zap',
] as const;

export type Sample = (typeof SAMPLES)[number];

/** Random.Float(min, max). */
export const between = (min: number, max: number, random: () => number = Math.random): number => min + random() * (max - min);

/* Hits */

type Hit = readonly [Sample, number];

/**
 * KindOfWeapon.hitSound and hitSoundPitch of each weapon (melee and thrown), by the name after the kind's
 * prefix, lower case: Shattered's weapons as the gear stream names them, and the ones we had before.
 */
const WEAPON_HITS: Readonly<Record<string, Hit>> = {
  // Melee (items/weapon/melee).
  wornshortsword: ['hit_slash', 1.1], gloves: ['hit', 1.3], dagger: ['hit_stab', 1.1], magesstaff: ['hit', 1.1],
  rapier: ['hit_slash', 1.3], cudgel: ['hit_crush', 1.2],
  shortsword: ['hit_slash', 1.1], handaxe: ['hit_slash', 1], spear: ['hit_stab', 0.9], quarterstaff: ['hit_crush', 1],
  dirk: ['hit_stab', 1], sickle: ['hit_slash', 1],
  sword: ['hit_slash', 1], mace: ['hit_crush', 1], scimitar: ['hit_slash', 1.2], roundshield: ['hit', 1],
  sai: ['hit_stab', 1.3], whip: ['hit', 1.1],
  longsword: ['hit_slash', 1], battleaxe: ['hit_slash', 0.9], flail: ['hit_crush', 0.8], runicblade: ['hit_slash', 1],
  assassinsblade: ['hit_stab', 0.9], crossbow: ['hit', 1], katana: ['hit_slash', 1.1],
  greatsword: ['hit_slash', 1], warhammer: ['hit_crush', 1], glaive: ['hit_slash', 0.8], greataxe: ['hit_slash', 1],
  greatshield: ['hit', 1], gauntlet: ['hit_crush', 1.2], warscythe: ['hit_slash', 0.9],
  // Pixel Dungeon's knuckleduster: Shattered's nearest, the studded gloves.
  knuckles: ['hit', 1.3],
  // Thrown (items/weapon/missiles).
  throwingstone: ['hit', 1.1], throwingknife: ['hit_slash', 1.2], throwingspike: ['hit_stab', 1.2],
  fishingspear: ['hit_stab', 1.1], throwingclub: ['hit_crush', 1.1], shuriken: ['hit_stab', 1.2],
  throwingspear: ['hit_stab', 1], kunai: ['hit_stab', 1.1], bolas: ['hit', 1],
  javelin: ['hit_stab', 1], tomahawk: ['hit_slash', 0.9], heavyboomerang: ['hit_crush', 1], boomerang: ['hit_crush', 1],
  trident: ['hit_slash', 0.9], throwinghammer: ['hit_crush', 0.8],
  // SpiritBow.SpiritArrow.
  spiritbow: ['hit_arrow', 1], spiritarrow: ['hit_arrow', 1],
};

/** The weapon's own hit (or the bare fist's: Hero.hitSound, a little higher), and its pitch. */
export function weaponHit(kind: string | null | undefined): Hit {
  if (!kind) return ['hit', 1.1];
  const name = kind.slice(kind.indexOf('.') + 1).toLowerCase();
  // Darts, plain and tipped (and Pixel Dungeon's curare and incendiary ones): Dart.hitSound.
  if (name.endsWith('dart') || name === 'curare' || name === 'incendiary') return ['hit_arrow', 1.3];
  return WEAPON_HITS[name] ?? ['hit', 1];
}

/** Weapons that parry what does no harm (Hero.blockSound: defenseFactor of 4 and more, the shields). */
export const blocks = (kind: string | null | undefined): boolean => !!kind && /\.(roundShield|greatshield)$/i.test(kind);

/**
 * The sound of a blow that landed (Char.attack): the attacker's weapon at a pitch of Random.Float(0.87, 1.15),
 * monsters' plain HIT; a blow that did no harm to a hero with a shield is parried instead.
 */
export function hitSound(
  weapon: string | null | undefined, fromHero: boolean, damage: number, targetWeapon: string | null | undefined, random: () => number = Math.random,
): { sound: Sample; rate: number } {
  if (damage <= 0 && blocks(targetWeapon)) return { sound: 'hit_parry', rate: between(0.96, 1.05, random) };
  const pitch = between(0.87, 1.15, random);
  if (!fromHero) return { sound: 'hit', rate: pitch };
  const [sound, base] = weaponHit(weapon);
  return { sound, rate: pitch * base };
}

/* Where things land and step */

const isWaterTerrain = (terrain: number): boolean => terrain === T.WATER;
/** Shattered's furrowed grass, if the levels stream brings it. */
const FURROWED = (T as Readonly<Record<string, number>>).FURROWED_GRASS ?? -1;
const isGrass = (terrain: number): boolean => terrain === T.GRASS || terrain === T.EMBERS || terrain === FURROWED;

/** Hero.move: a step of the hero's (trampling high grass on the way in has its own), with its pitch. */
export function stepSound(terrain: number, trampled: boolean, random: () => number = Math.random): { sound: Sample; rate: number } {
  if (isWaterTerrain(terrain)) return { sound: 'water', rate: between(0.8, 1.25, random) };
  const rate = between(0.96, 1.05, random);
  if (terrain === T.EMPTY_SP) return { sound: 'sturdy', rate };
  if (isGrass(terrain) || trampled) return { sound: trampled ? 'trample' : 'grass', rate };
  return { sound: 'step', rate };
}

/** ItemSprite.drop: an item landing, on what it lands on (at 0.8 of the volume). */
export function dropSound(terrain: number, random: () => number = Math.random): { sound: Sample; rate: number } {
  if (isWaterTerrain(terrain)) return { sound: 'water', rate: between(1, 1.45, random) };
  const rate = between(1.16, 1.25, random);
  if (terrain === T.EMPTY_SP) return { sound: 'sturdy', rate };
  if (isGrass(terrain)) return { sound: 'grass', rate };
  return { sound: 'step', rate };
}

/* The hero's wounds */

/**
 * Hero.damage: a blow that takes much of what is left rings a warning (HEALTH_WARN), a worse one a critical
 * alarm (HEALTH_CRITICAL), louder the worse; slight ones ring nothing. `before` and `after` are health and shielding.
 */
export function woundSound(before: number, after: number, ht: number): { sound: Sample; volume: number } | null {
  const damage = before - after;
  if (damage <= 0 || after <= 0 || before <= 0) return null;
  const percentDmg = damage / before;
  const percentHp = 1 - (ht - after) / ht;
  let flash = (0.25 * (percentDmg * percentDmg)) / percentHp;
  if (!(flash >= 0.05)) return null;
  flash = Math.min(1 / 3, flash);
  return flash >= 1 / 6 ? { sound: 'health_critical', volume: 1 / 3 + flash * 2 } : { sound: 'health_warn', volume: 1 / 3 + flash * 4 };
}

/* Traps, scrolls, heaps */

/**
 * Trap.trigger plays TRAP where it is seen, then the trap's own activate: the gas traps' GAS, the burning
 * one's BURNING, the shocking one's LIGHTNING, the alarm's ALERT (heard everywhere).
 */
export const TRAP_SOUNDS: Readonly<Partial<Record<TrapKind | 'paralytic' | 'fire' | 'lightning' | 'poison' | 'gripping', Sample | null>>> = {
  toxic: 'gas', paralytic: 'gas', fire: 'burning', lightning: 'lightning', alarm: 'alert', poison: null, gripping: null, summoning: null,
};

/**
 * What reading a scroll sounds (Scroll.readAnimation and each scroll's doRead): READ, but the lullaby's
 * LULLABY, the rage's CHALLENGE (our scroll of challenge) and the psionic blast's BLAST instead; recharging
 * adds CHARGEUP, teleportation TELEPORT, magic mapping SECRET (played by their effects).
 */
export function readSounds(kind: string): readonly Sample[] {
  switch (kind) {
    case 'scroll.lullaby': return ['lullaby'];
    case 'scroll.challenge': case 'scroll.rage': return ['challenge'];
    case 'scroll.psionicBlast': case 'scroll.retribution': return ['blast'];
    case 'scroll.recharging': return ['read', 'chargeup'];
    default: return ['read'];
  }
}

/** Hero.actOpenChest: a tomb's TOMB, remains' BONES, a chest's UNLOCK. */
export function openSound(heap: string): Sample {
  return heap === 'tomb' ? 'tomb' : heap === 'skeleton' || heap === 'remains' ? 'bones' : 'unlock';
}

/** WndSettings' sound slider: one of six sounds, and one time in a hundred a mimic. */
export function sliderSound(random: () => number = Math.random): Sample {
  if (Math.floor(random() * 100) === 0) return 'mimic';
  const pick: readonly Sample[] = ['gold', 'hit', 'item', 'shatter', 'evoke', 'secret'];
  return pick[Math.floor(random() * pick.length)]!;
}
