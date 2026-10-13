import { createItem, type Item, type ItemKind } from './items';
import { staffWith } from './staff';

/*
 * HeroClass.initHero as Shattered Pixel Dungeon sets the four classes out:
 * everyone in cloth armour (known through and through), with a ration, a
 * waterskin and a velvet pouch, and knowing scrolls of identify; then each
 * class its own weapon, its unique item, and the two kinds it knows from the
 * start. The Warrior's broken seal comes affixed to his armour.
 *
 * The duelist (rapier, throwing spikes) and the cleric (cudgel, holy tome) are the classes stream's.
 *
 * Every kit is Shattered's own now: the gear stream's worn shortsword,
 * throwing stones and knives, studded gloves and spirit bow; the wands
 * stream's mage's staff (MagesStaff, staff.ts); the artifacts stream's cloak
 * of shadows. KIT_SEAMS, where their stand-ins were, is empty.
 */

export type HeroClass = 'warrior' | 'mage' | 'rogue' | 'huntress' | 'duelist' | 'cleric';

/** Shattered's six classes, in the order of its class choice and of the sheets (avatars.png, heroes6.png, camp-heroes.png). */
export const HERO_CLASSES: readonly HeroClass[] = ['warrior', 'mage', 'rogue', 'huntress', 'duelist', 'cleric'];

/** The stand-ins for what other streams were to port: none are left. */
export const KIT_SEAMS = {} as const;

export interface StartingKit {
  /** The weapon in hand. */
  weapon: Item;
  /** Cloth armour; the warrior's with the broken seal affixed. */
  armor: Item;
  /** The artifact worn from the start: the rogue's cloak of shadows. */
  artifact: Item | null;
  /** The backpack. */
  items: Item[];
  /** Kinds the party knows from the start (HeroClass.initHero and init…: `new X().identify()`). */
  known: ItemKind[];
  /** Kinds put in the quick slots, in order (Dungeon.quickslot.setSlot). */
  quickslots: ItemKind[];
}

/** HeroClass.initHero and initWarrior / initMage / initRogue / initHuntress / initDuelist / initCleric. */
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
        weapon: createItem('weapon.wornShortsword'), armor, artifact: null, items: [stones, ...common],
        known: [...known, 'potion.healing', 'scroll.challenge'], quickslots: [stones.kind],
      };
    }
    case 'mage': {
      // initMage: the staff, with a wand of magic missile imbued, in the first quick slot.
      const staff = staffWith(createItem('wand.magicMissile'));
      return {
        weapon: staff, armor, artifact: null, items: common,
        known: [...known, 'scroll.upgrade', 'potion.liquidFlame'], quickslots: [staff.kind],
      };
    }
    case 'rogue': {
      // initRogue: the dagger, the cloak of shadows worn (first quick slot), the throwing knives (second).
      const knives = createItem('missile.throwingKnife', 3);
      return {
        weapon: createItem('weapon.dagger'), armor, artifact: createItem('artifact.cloak'), items: [knives, ...common],
        known: [...known, 'scroll.mapping', 'potion.invisibility'], quickslots: ['artifact.cloak', knives.kind],
      };
    }
    case 'huntress': {
      // initHuntress: the studded gloves, the spirit bow in the first quick slot.
      const bow = createItem('spiritBow');
      return {
        weapon: createItem('weapon.gloves'), armor, artifact: null, items: [bow, ...common],
        known: [...known, 'potion.mindVision', 'scroll.lullaby'], quickslots: [bow.kind],
      };
    }
    case 'duelist': {
      // initDuelist: the rapier in hand (first quick slot), two throwing spikes (second; the set is three, the duelist starts with two).
      const rapier = createItem('weapon.rapier');
      const spikes = createItem('missile.throwingSpike', 2);
      return {
        weapon: rapier, armor, artifact: null, items: [spikes, ...common],
        known: [...known, 'potion.strength', 'scroll.mirrorImage'], quickslots: [rapier.kind, spikes.kind],
      };
    }
    case 'cleric': {
      // initCleric: the cudgel in hand, the holy tome worn (first quick slot).
      const tome = createItem('artifact.tome');
      return {
        weapon: createItem('weapon.cudgel'), armor, artifact: tome, items: common,
        known: [...known, 'potion.purity', 'scroll.removeCurse'], quickslots: ['artifact.tome'],
      };
    }
  }
}
