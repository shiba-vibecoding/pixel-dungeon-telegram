import { isAlive, type Hero, type Mob } from '../actors';
import { cure } from '../buffs';
import type { Char, Ctx } from '../floor';
import { isHero } from '../floor';
import { distance } from '../level/geometry';
import type { ClassFx } from './fx';

/* Small helpers the Duelist's and the Cleric's rules share. */

/** An effect for the client (classfx.ts). */
export function say(ctx: Ctx, hero: Hero, fx: ClassFx): void {
  ctx.effects.push({ type: 'classFx', depth: ctx.depth, hero: hero.id, fx });
}

/** A line for the log by its message key (the classes' texts, i18n-classes.ts), in a tone. */
export function tell(ctx: Ctx, hero: Hero, msg: string, tone: 'i' | 'p' | 'w' | 'n' = 'i', args?: Array<string | number>): void {
  ctx.effects.push({ type: 'artifact', hero: hero.id, msg, tone, ...(args ? { args } : {}) });
}

/** Barrier.incShield: shielding added to what is there. */
export function addShield(char: Char, amount: number): void {
  char.shield = (char.shield ?? 0) + amount;
  char.shieldDecay = 0;
}

/** Char.shielding. */
export const shielding = (char: Char): number => char.shield ?? 0;

/**
 * Heals a creature by up to `amount`, showing it; the share that is more than it was missing becomes a barrier when `overflow`
 * (Bless, Lay on Hands, Hallowed Ground). Returns [healed, shielded].
 */
export function healWithBarrier(ctx: Ctx, hero: Hero, ch: Char, amount: number, overflow: boolean, cap = Infinity): [number, number] {
  const missing = ch.ht - ch.hp;
  if (missing < amount) {
    let barrier = overflow ? Math.max(amount - missing, 0) : 0;
    let healed = 0;
    if (ch.hp !== ch.ht) {
      healed = missing;
      ch.hp = ch.ht;
    }
    if (barrier > 0) {
      barrier = Math.max(0, Math.min(cap - shielding(ch), barrier));
      if (barrier > 0) addShield(ch, barrier);
    }
    show(ctx, hero, ch, healed, barrier);
    return [healed, barrier];
  }
  ch.hp += amount;
  show(ctx, hero, ch, amount, 0);
  return [amount, 0];
}

function show(ctx: Ctx, hero: Hero, ch: Char, healed: number, shielded: number): void {
  if (healed > 0) {
    ctx.effects.push({ type: isHero(ch) ? 'healed' : 'mobHealed', ...(isHero(ch) ? { hero: ch.id } : { depth: ctx.depth, mob: ch.id }), amount: healed } as never);
    say(ctx, hero, { k: 'text', at: ch.pos, text: String(healed), tone: 'p', icon: 'heal' });
  }
  if (shielded > 0) say(ctx, hero, { k: 'text', at: ch.pos, text: String(shielded), tone: 'p', icon: 'shield' });
}

/** Every harmful condition a creature has, gone (Cleanse, Meditate: not being an ally, not lost belongings). */
export function shedNegatives(char: Char): void {
  cure(char);
  char.paralysed = 0;
  char.burning = 0;
  char.rooted = 0;
  char.charmed = 0;
  char.chill = 0;
  if (isHero(char)) {
    char.ooze = -1;
    char.charmedBy = null;
    char.deferred = 0;
    char.hexed = 0;
    char.vulnerable = 0;
    delete char.corrosion;
    delete char.frozen;
    delete char.marked;
  } else {
    delete char.terror;
    delete char.amok;
    delete char.rage;
    delete char.ooze;
    delete char.weakened;
    delete char.corrosion;
    delete char.hexed;
    delete char.vulnerable;
    delete char.frozen;
  }
}

/** Char.Property.UNDEAD or DEMONIC. */
export { isUndead, isDemonic } from '../enchant';

/** The hero's allies on the depth: monsters on their side, alive. */
export const alliesOf = (ctx: Ctx): Mob[] => ctx.floor.mobs.filter((m) => m.ally === true && isAlive(m));

/** Level.distance between two creatures. */
export const gap = (a: Char, b: Char): number => distance(a.pos, b.pos);
