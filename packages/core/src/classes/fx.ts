import type { ItemKind } from '../items';

/*
 * What players see of the Duelist's and the Cleric's doing (the one effect `classFx`): each is a sprite
 * animation, a particle burst or a sound of Shattered's, played by the client (classfx.ts). `hero` is whose
 * sprite it is; cells are where it happens.
 */
export type ClassFx =
  /** hero.sprite.attack(at): the swing of an ability's blow. */
  | { k: 'strike'; at: number }
  /** hero.sprite.jump(from, to): a lunge (Rapier) or a leap. */
  | { k: 'lunge'; from: number; to: number }
  /** CellEmitter WOOL puffs and Sounds.PUFF: the sneak (Dagger) and the duel's blink. */
  | { k: 'puff'; at: number }
  /** hero.sprite.operate(): a stance taken, a shield raised, a crossbow charged. */
  | { k: 'operate'; weapon?: ItemKind }
  /** Sounds.HIT_STRONG: a blow of an ability landed hard. */
  | { k: 'strong'; at: number }
  /** The whip cracks (Weapon.throwSound) and the flail's chains. */
  | { k: 'sound'; name: string }
  /** FloatingText over a character: a number or a word, in a tone. */
  | { k: 'text'; at: number; text: string; tone: 'p' | 'n' | 'w' | 'i'; icon?: 'shield' | 'heal' }
  /** The Monk's and the armour abilities' lingering marks, for the client to draw. */
  | { k: 'mark'; at: number; name: string }
  /** A flash of the whole screen (GameScene.flash). */
  | { k: 'flash'; color: number }
  /** A particle burst (CellEmitter): which kind, how many. */
  | { k: 'burst'; at: number; name: string; count: number }
  /** A ray or a bolt drawn from one cell to another. */
  | { k: 'ray'; from: number; to: number; name: string }
  /** A talent point was spent. */
  | { k: 'talent'; talent: string; points: number }
  /** A named spell effect at a cell (SpellSprite, Flare, ...). */
  | { k: 'spell'; at: number; name: string };
