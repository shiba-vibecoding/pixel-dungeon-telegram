import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { T } from '@pd/core';
import { dropSound, hitSound, openSound, readSounds, SAMPLES, sliderSound, stepSound, TRAP_SOUNDS, weaponHit, woundSound } from '../src/sfx';

/** A random stream that always says `x`. */
const at = (x: number) => (): number => x;

describe("Shattered's sounds (Assets.Sounds)", () => {
  it('every sound has its file, and every file is a sound', () => {
    const dir = fileURLToPath(new URL('../public/audio/spd/', import.meta.url));
    const files = readdirSync(dir).filter((f) => f.endsWith('.mp3')).map((f) => f.slice(0, -4)).sort();
    expect(files).toEqual([...SAMPLES].sort());
    expect(SAMPLES.length).toBe(67);
    const music = readdirSync(join(dir, 'music')).filter((f) => f.endsWith('.ogg'));
    expect(music.length).toBe(31);
  });

  it("a weapon's own hit and pitch (KindOfWeapon.hitSound), the bare fist a little higher, darts an arrow's", () => {
    expect(weaponHit('weapon.dagger')).toEqual(['hit_stab', 1.1]);
    expect(weaponHit('weapon.warHammer')).toEqual(['hit_crush', 1]);
    expect(weaponHit('weapon.shortSword')).toEqual(['hit_slash', 1.1]);
    expect(weaponHit('weapon.shortsword')).toEqual(['hit_slash', 1.1]);
    expect(weaponHit('weapon.glaive')).toEqual(['hit_slash', 0.8]);
    expect(weaponHit('missile.throwingHammer')).toEqual(['hit_crush', 0.8]);
    expect(weaponHit('missile.paralyticDart')).toEqual(['hit_arrow', 1.3]);
    expect(weaponHit('missile.curare')).toEqual(['hit_arrow', 1.3]);
    expect(weaponHit('weapon.pickaxe')).toEqual(['hit', 1]);
    expect(weaponHit(null)).toEqual(['hit', 1.1]);
  });

  it("Char.attack: the blow at Random.Float(0.87, 1.15) of the weapon's pitch; monsters' plain; a shield parries a harmless one", () => {
    expect(hitSound('weapon.mace', true, 5, null, at(0))).toEqual({ sound: 'hit_crush', rate: 0.87 });
    expect(hitSound('weapon.rapier', true, 5, null, at(1))).toEqual({ sound: 'hit_slash', rate: 1.15 * 1.3 });
    expect(hitSound(null, false, 5, null, at(0.5))).toEqual({ sound: 'hit', rate: 1.01 });
    expect(hitSound(null, false, 0, 'weapon.roundShield', at(0))).toEqual({ sound: 'hit_parry', rate: 0.96 });
    expect(hitSound(null, false, 3, 'weapon.roundShield', at(0)).sound).toBe('hit');
    expect(hitSound(null, false, 0, 'weapon.sword', at(0)).sound).toBe('hit');
  });

  it("Hero.move and ItemSprite.drop: what's underfoot", () => {
    expect(stepSound(T.WATER, false, at(0))).toEqual({ sound: 'water', rate: 0.8 });
    expect(stepSound(T.EMPTY_SP, false, at(0)).sound).toBe('sturdy');
    expect(stepSound(T.GRASS, false, at(0)).sound).toBe('grass');
    expect(stepSound(T.GRASS, true, at(0)).sound).toBe('trample');
    expect(stepSound(T.EMBERS, false, at(0)).sound).toBe('grass');
    expect(stepSound(T.EMPTY, false, at(1))).toEqual({ sound: 'step', rate: 1.05 });
    expect(dropSound(T.WATER_TILES + 3, at(1))).toEqual({ sound: 'water', rate: 1.45 });
    expect(dropSound(T.HIGH_GRASS, at(0))).toEqual({ sound: 'step', rate: 1.16 });
    expect(dropSound(T.GRASS, at(0)).sound).toBe('grass');
  });

  it('Hero.damage: a slight wound rings nothing, a bad one a warning, a terrible one the critical alarm, louder the worse', () => {
    expect(woundSound(20, 18, 20)).toBeNull();
    // 0.25 * (8/20)^2 / (12/20) = 0.0667: a warning at 1/3 + 4 * 0.0667.
    const warn = woundSound(20, 12, 20)!;
    expect(warn.sound).toBe('health_warn');
    expect(warn.volume).toBeCloseTo(1 / 3 + (0.25 * 0.16) / 0.6 * 4);
    // 0.25 * (15/20)^2 / (5/20) = 0.5625, capped at 1/3: critical at 1/3 + 2/3.
    expect(woundSound(20, 5, 20)).toEqual({ sound: 'health_critical', volume: 1 });
    // Dead: Hero.die's own sound instead.
    expect(woundSound(20, 0, 20)).toBeNull();
  });

  it("the traps' own sounds after TRAP, a scroll's reading, a heap opened, the slider's sounds", () => {
    expect(TRAP_SOUNDS.toxic).toBe('gas');
    expect(TRAP_SOUNDS.alarm).toBe('alert');
    expect(TRAP_SOUNDS.gripping).toBeNull();
    expect(readSounds('scroll.lullaby')).toEqual(['lullaby']);
    expect(readSounds('scroll.challenge')).toEqual(['challenge']);
    expect(readSounds('scroll.psionicBlast')).toEqual(['blast']);
    expect(readSounds('scroll.recharging')).toEqual(['read', 'chargeup']);
    expect(readSounds('scroll.identify')).toEqual(['read']);
    expect(openSound('tomb')).toBe('tomb');
    expect(openSound('skeleton')).toBe('bones');
    expect(openSound('crystalChest')).toBe('unlock');
    expect(sliderSound(at(0))).toBe('mimic');
    expect(sliderSound(at(0.5))).toBe('shatter');
  });
});
