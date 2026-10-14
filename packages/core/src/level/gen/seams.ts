import { createItem, type Item } from '../../items';
import type { PlantKind } from '../../plants';

/*
 * Items level generation makes that other streams of the Shattered port are bringing in. Each is a
 * seam: until its stream lands, Pixel Dungeon's nearest item stands in (or nothing, where none would do).
 */

export type SeamItem =
  /** SEAM(gear): the arcane stylus, which inscribes armour; the scroll of enchantment stands in. */
  | 'stylus'
  /** SEAM(alchemy): runestones and the trinket catalyst. */
  | 'stoneOfEnchantment'
  | 'stoneOfIntuition'
  | 'stoneOfAugmentation'
  | 'stoneOfBlink'
  | 'trinketCatalyst'
  /** SEAM(alchemy): alchemical energy crystals. */
  | 'energyCrystal'
  /** SEAM(alchemy): exotic potions and scrolls, and the potion of haste. */
  | 'potionOfHaste'
  | 'potionOfDivineInspiration'
  | 'scrollOfTransmutation'
  | 'scrollOfMetamorphosis'
  /** SEAM(alchemy): the alchemy guide's pages; nothing stands in. */
  | 'alchemyPage'
  /** SEAM(alchemy): the scroll of retribution; Pixel Dungeon's psionic blast, which it replaced, stands in. */
  | 'scrollOfRetribution'
  /** SEAM(mobs): Honeypot.ShatteredPot, the broken pot a golden bee guards; nothing stands in. */
  | 'shatteredPot'
  /** SEAM(alchemy): the alchemize spell the shops sell; nothing stands in. */
  | 'alchemize'
  /**
   * SEAM(alchemy): the other runestones the vault's loot holds, and Shattered's seeds; the stones'
   * nearest scroll, potion or bomb stands in.
   */
  | 'stoneOfFlock'
  | 'stoneOfShock'
  | 'stoneOfFear'
  | 'stoneOfDeepSleep'
  | 'stoneOfClairvoyance'
  | 'stoneOfAggression'
  | 'stoneOfBlast'
  | 'mageroyalSeed'
  | 'stormvineSeed'
  | 'blindweedSeed'
  | 'swiftthistleSeed'
  | 'starflowerSeed';

export function seamItem(name: SeamItem): Item | null {
  switch (name) {
    // SEAM(gear): the arcane stylus; the stone of enchantment stands in.
    case 'stylus':
    case 'stoneOfEnchantment':
      return createItem('stone.enchantment');
    case 'stoneOfIntuition':
      return createItem('stone.intuition');
    case 'stoneOfAugmentation':
      return createItem('stone.augmentation');
    case 'stoneOfBlink':
      return createItem('stone.blink');
    case 'potionOfHaste':
      return createItem('potion.haste');
    case 'potionOfDivineInspiration':
      return createItem('potion.divineInspiration');
    case 'scrollOfTransmutation':
      return createItem('scroll.transmutation');
    case 'scrollOfMetamorphosis':
      return createItem('scroll.metamorphosis');
    case 'scrollOfRetribution':
      return createItem('scroll.retribution');
    case 'stoneOfFlock':
      return createItem('stone.flock');
    case 'stoneOfDeepSleep':
      return createItem('stone.deepSleep');
    case 'stoneOfShock':
      return createItem('stone.shock');
    case 'stoneOfBlast':
      return createItem('stone.blast');
    case 'stoneOfFear':
      return createItem('stone.fear');
    case 'stoneOfClairvoyance':
      return createItem('stone.clairvoyance');
    case 'stoneOfAggression':
      return createItem('stone.aggression');
    case 'energyCrystal':
      return createItem('energy');
    case 'trinketCatalyst':
      return createItem('trinket.catalyst');
    case 'shatteredPot':
      return createItem('honeypot.shattered');
    case 'alchemize':
      return createItem('spell.alchemize');
    // Shattered's own seeds.
    case 'mageroyalSeed':
      return createItem('seed.mageroyal');
    case 'starflowerSeed':
      return createItem('seed.starflower');
    case 'stormvineSeed':
      return createItem('seed.stormvine');
    case 'blindweedSeed':
      return createItem('seed.blindweed');
    case 'swiftthistleSeed':
      return createItem('seed.swiftthistle');
    // The alchemy guide's pages: their own item (inventory: picked up, the page is found).
    case 'alchemyPage':
      return null;
  }
}

/**
 * Plants the secret rooms grow: the starflower (now grown here); SEAM(plants) the blandfruit bush and
 * SEAM(wands) the wand of regrowth's seed pod and dewcatcher have none (the cell still turns to grass, as under a plant).
 */
export type SeamPlant = 'starflower' | 'blandfruitBush' | 'seedpod' | 'dewcatcher';

export function seamPlant(name: SeamPlant): PlantKind | null {
  switch (name) {
    case 'starflower':
      return 'starflower';
    case 'blandfruitBush':
    case 'seedpod':
    case 'dewcatcher':
      return null;
  }
}
