import type { SpellDef } from './cleric-core';

/* The Cleric's spells by id: kept apart so that registering them never waits on the modules that use them. */

export const BY_ID = new Map<string, SpellDef>();

export function registerSpells(defs: readonly SpellDef[]): void {
  for (const def of defs) BY_ID.set(def.id, def);
}
