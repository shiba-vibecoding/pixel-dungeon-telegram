import { createItem, type Item, type ItemKind } from './items';
import { staffWith } from './staff';

/*
 * HeroClass.initHero as Shattered Pixel Dungeon sets the four classes out:
 * everyone in cloth armour (known through and through), with a ration, a
 * waterskin and a velvet pouch, and knowing scrolls of identify; then each
 * class its own weapon, its unique item, and the two kinds it knows from the
 * start. The Warrior's broken seal comes affixed to his armour.
 *
 * Seams (docs/SHATTERED.md): what other streams port is stood in for by
 * Pixel Dungeon's items until their stream lands, each marked in KIT_SEAMS —
 * artifacts: the rogue's cloak of shadows. The stream that ports one
 * replaces its line there. The gear and wands streams' are in: the worn
 * shortsword, the throwing stones and knives, the studded gloves, the spirit
 * bow and the mage's staff (MagesStaff, staff.ts) are Shattered's own.
 */

export type HeroClass = 'warrior' | 'mage' | 'rogue' | 'huntress';

/** What a class takes from another stream, and what stands in for it meanwhile (kind, how many, its level). */
interface Seam {
  kind: ItemKind;
  qty?: number;
  level?: number;
  /** The Shattered class it stands in for, and the stream that ports it. */
  for: string;
}

/**
 * The stand-ins. A stream that ports one of these replaces its entry with the real item; `quick` says
 * which go into the quick slots (Dungeon.quickslot.setSlot in HeroClass.init…).
 */
export const KIT_SEAMS = {
  /** CloakOfShadows (artifacts): worn as Pixel Dungeon's rogue wore his ring of shadows. */
  cloakOfShadows: { kind: 'ring.shadows', level: 1, for: 'CloakOfShadows (artifacts)' },
} as const satisfies Record<string, Seam>;

const seamed = (seam: Seam): Item => createItem(seam.kind, seam.qty ?? 1, seam.level ?? 0);

export interface StartingKit {
  /** The weapon in hand. */
  weapon: Item;
  /** Cloth armour; the warrior's with the broken seal affixed. */
  armor: Item;
  /** Rings worn from the start (the rogue's cloak's stand-in). */
  rings: Item[];
  /** The backpack. */
  items: Item[];
  /** Kinds the party knows from the start (HeroClass.initHero and init…: `new X().identify()`). */
  known: ItemKind[];
  /** Kinds put in the quick slots, in order (Dungeon.quickslot.setSlot). */
  quickslots: ItemKind[];
}

/** HeroClass.initHero and initWarrior / initMage / initRogue / initHuntress. */
export function startingKit(heroClass: HeroClass): StartingKit {
  // HeroClass.initHero: cloth armour identified, a ration, the velvet pouch and the waterskin; identify is known to all.
  const armor = createItem('armor.cloth');
  const common = [createItem('food.ration'), createItem('bag.seeds'), createItem('waterskin')];
  const known: ItemKind[] = ['scroll.identify'];
  switch (heroClass) {
    case 'warrior': {
      // initWarrior: the worn shortsword, the throwing stones (in the first quick slot), the seal on the armour.
      armor.seal = { level: 0 };
      const stones = createItem('missile.throwingStone', 3);
      return {
        weapon: createItem('weapon.wornShortsword'), armor, rings: [], items: [stones, ...common],
        known: [...known, 'potion.healing', 'scroll.challenge'], quickslots: [stones.kind],
      };
    }
    case 'mage': {
      // initMage: the staff, with a wand of magic missile imbued, in the first quick slot.
      const staff = staffWith(createItem('wand.magicMissile'));
      return {
        weapon: staff, armor, rings: [], items: common,
        known: [...known, 'scroll.upgrade', 'potion.liquidFlame'], quickslots: [staff.kind],
      };
    }
    case 'rogue': {
      // initRogue: the dagger, the cloak of shadows worn (first quick slot), the throwing knives (second).
      const knives = createItem('missile.throwingKnife', 3);
      return {
        weapon: createItem('weapon.dagger'), armor, rings: [seamed(KIT_SEAMS.cloakOfShadows)], items: [knives, ...common],
        known: [...known, 'scroll.mapping', 'potion.invisibility'], quickslots: [knives.kind],
      };
    }
    case 'huntress': {
      // initHuntress: the studded gloves, the spirit bow in the first quick slot.
      const bow = createItem('spiritBow');
      return {
        weapon: createItem('weapon.gloves'), armor, rings: [], items: [bow, ...common],
        known: [...known, 'potion.mindVision', 'scroll.lullaby'], quickslots: [bow.kind],
      };
    }
  }
}
