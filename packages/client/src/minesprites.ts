import type { Mob } from '@pd/core';
import type { Animation, AnimName, Assets, CharSprite } from './sprites';

/*
 * The blacksmith's mine's monsters as their sprites change (CrystalWispSprite/GuardianSprite/SpireSprite
 * Blue, Green and Red; CrystalSpireSprite.updateIdle; CrystalGuardianSprite.crumple; GnollGeomancerSprite's
 * rock armour): the same sheet, other frames.
 */

/** texOffset of the Green and Red sprites, per kind (Blue is 0). */
const COLOUR_OFFSET: Readonly<Record<string, number>> = { crystalWisp: 13, crystalGuardian: 21, crystalSpire: 8 };
/** GnollGeomancerSprite: in its rock armour, the statue frames, from 21. */
const GEOMANCER_STATUE = 21;

const cache = new Map<string, CharSprite>();

const shifted = (anim: Animation, by: number): Animation => ({ ...anim, frames: anim.frames.map((f) => f + by) });
const still = (frame: number, loop = true): Animation => ({ fps: 1, frames: [frame], loop });

function derive(base: CharSprite, key: string, make: () => Record<AnimName, Animation>): CharSprite {
  const id = `${key}`;
  let sprite = cache.get(id);
  if (!sprite || sprite.sheet !== base.sheet) {
    sprite = { sheet: base.sheet, anims: make() };
    cache.set(id, sprite);
  }
  return sprite;
}

/** The sprite a monster of the mine shows now, or its kind's own. */
export function mineSprite(assets: Assets, mob: Mob): CharSprite {
  const base = assets.mobs[mob.kind];
  const state = mob.mine;
  switch (mob.kind) {
    case 'crystalWisp':
    case 'crystalGuardian':
    case 'crystalSpire': {
      const by = (state?.variant ?? 0) * COLOUR_OFFSET[mob.kind]!;
      if (mob.kind === 'crystalGuardian' && state?.recovering) {
        // Crumpled: the end of its fall, until it is whole again.
        return derive(base, `guardian:${by}:down`, () => ({ ...base.anims, idle: still(15 + by), run: still(15 + by), attack: still(15 + by) }));
      }
      if (mob.kind === 'crystalSpire') {
        // CrystalSpireSprite.updateIdle: more cracked the more it is hurt.
        const hp = mob.hp / mob.ht;
        const frame = (hp > 0.9 ? 0 : hp > 0.67 ? 1 : hp > 0.33 ? 2 : 3) + by;
        return derive(base, `spire:${frame}`, () => ({
          idle: still(frame), run: still(frame), attack: still(frame, false), die: still(4 + by, false), operate: still(frame), pump: still(frame),
        }));
      }
      if (by === 0) return base;
      return derive(base, `${mob.kind}:${by}`, () => {
        const anims = { ...base.anims };
        for (const name of Object.keys(anims) as AnimName[]) anims[name] = shifted(base.anims[name], by);
        return anims;
      });
    }
    case 'gnollGeomancer': {
      if ((state?.armor ?? 0) <= 0) return base;
      return derive(base, 'geomancer:statue', () => {
        const anims = { ...base.anims };
        for (const name of ['idle', 'run', 'attack', 'operate', 'pump'] as const) anims[name] = shifted(base.anims[name], GEOMANCER_STATUE);
        // (Its idle is slower as a statue: one frame a second.)
        anims.idle = { ...anims.idle, fps: 1 };
        return anims;
      });
    }
    default:
      return base;
  }
}
