import { type Hero, heroArtifacts } from '../actors';
import type { Ctx } from '../floor';
import type { Item, ItemKind } from '../items';
import { levelCap } from './artifact';

/*
 * What the artifacts' rules share: their lines in the hero's log (GLog, by
 * Shattered's message keys under items.artifacts), finding an artifact on a
 * hero, and levelling one up with what each kind does as it grows.
 */

/** GLog's kinds of line: information, positive, warning, negative. */
export type Tone = 'i' | 'p' | 'w' | 'n';

/**
 * A line for the hero's log, by its message key under items.artifacts (e.g. 'hornofplenty.eat',
 * 'cloakofshadows$cloakstealth.levelup'); `args` fill its %d and %s, `item` is named where it says %s.
 */
export function say(ctx: Ctx, hero: Hero, msg: string, tone: Tone = 'i', args?: ReadonlyArray<string | number>, item?: Item): void {
  ctx.effects.push({ type: 'artifact', hero: hero.id, msg, tone, ...(args ? { args: [...args] } : {}), ...(item ? { item } : {}) });
}

/** The artifact of a kind the hero wears, in the artifact or the misc slot. */
export const wornOf = (hero: Hero, kind: ItemKind): Item | undefined => heroArtifacts(hero).find((item) => item.kind === kind);

/** Belongings.getItem: an artifact of a kind the hero wears or carries. */
export const carriedOf = (hero: Hero, kind: ItemKind): Item | undefined =>
  wornOf(hero, kind) ?? hero.items.find((item) => item.kind === kind);

/** Artifact.isEquipped. */
export const isWorn = (hero: Hero, item: Item): boolean => hero.artifact === item || hero.misc === item;

/** The hero who wears or carries an item, if any. */
export const bearerOf = (ctx: Ctx, item: Item): Hero | undefined =>
  ctx.world.heroes.find((hero) => hero.artifact === item || hero.misc === item || hero.items.includes(item));

/**
 * Artifact.upgrade (Item.upgrade(n)), with what each kind does as it grows: the hourglass counts the
 * sandbags it would have had, the spellbook forgets scrolls it no longer has room to want, the rose
 * counts its petals and its ghost grows sturdier. Never past the kind's cap.
 */
export function upgradeArtifact(ctx: Ctx | null, item: Item, times = 1): void {
  for (let i = 0; i < times && item.level < levelCap(item); i++) {
    switch (item.kind) {
      case 'artifact.hourglass':
        // TimekeepersHourglass.upgrade: for artifact transmutation.
        item.sandBags = Math.max(item.sandBags ?? 0, item.level + 1);
        break;
      case 'artifact.spellbook':
        // UnstableSpellbook.upgrade: for artifact transmutation.
        while (item.scrolls && item.scrolls.length > 0 && item.scrolls.length > levelCap(item) - 1 - item.level) item.scrolls.shift();
        break;
      case 'artifact.rose':
        // DriedRose.upgrade: for upgrade transferring via transmutation.
        item.petals = Math.max(item.level, item.petals ?? 0);
        break;
    }
    item.level++;
    if (item.kind === 'artifact.rose' && ctx) roseGrew(ctx, item);
  }
}

/** DriedRose.upgrade: the ghost, if it is out, grows with the rose and is healed a little. */
function roseGrew(ctx: Ctx, rose: Item): void {
  if (!rose.ghost) return;
  for (const floor of Object.values(ctx.world.floors)) {
    const ghost = floor.mobs.find((mob) => mob.id === rose.ghost);
    if (!ghost) continue;
    ghost.ht = 40 + 10 * rose.level;
    ghost.hp = Math.min(ghost.hp + 8, ghost.ht);
  }
}

/** Artifact.transferUpgrade: the displayed level carried over to another artifact. */
export function transferUpgrade(ctx: Ctx | null, item: Item, visibleLevel: number): void {
  upgradeArtifact(ctx, item, Math.round((visibleLevel * levelCap(item)) / 10));
}
