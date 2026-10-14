import { buffNames } from './i18n-v22';
import { CLS_EN } from './i18n-classes';
import { TAL_EN } from './i18n-talents';

export const V22_BUFFS_EN = buffNames(CLS_EN, TAL_EN);

export const V22_EN = {
  warden: 'Warden', wardenSub: 'Plants give her power, not harm', wardenNote: 'For everyone else, plants work as usual.', wardenLabel: 'Warden:',
  wardenButton: 'Plants of the Warden',
  plants: {
    rotberry: 'A while of extra strength.', firebloom: 'Fire imbue instead of burns.', sungrass: 'Healing goes on even if she steps off.',
    icecap: 'Frost imbue instead of chill.', stormvine: 'A few turns of levitation.', swiftthistle: 'Time stands still, then haste.', mageroyal: 'Immune to gases and clouds.', starflower: 'Blessed, and her wands recharge.', blindweed: 'Invisibility instead of blindness.', sorrowmoss: 'Toxic imbue instead of poison.',
    earthroot: 'Bark armor that moves with her.', fadeleaf: 'To the previous depth’s exit.',
  } as Record<string, string>,
  scoreShort: ['Depth and hero level', 'Gold and the value of your pack', 'Floors explored with nothing missed', 'Bosses beaten without needless hits', 'Quests done for the dungeon folk'],
  max: 'max',
  dontAsk: 'Don’t ask again', dontAskNote: 'Bring the question back in Settings, «Game».', step: 'Step', stay: 'No',
  trapQ: 'Step onto the trap?', fireQ: 'Step into the fire?',
  fireNote: 'You will catch fire: damage every turn until it is out.',
  inHand: 'in hand', spare: 'spare', stanceOn: 'on', stanceOff: 'off', aimWord: 'Pick a target', aimCancel: 'Cancel',
  ready: 'Weapon ability', charging: 'Charging', swapWeapons: 'Swap weapons', stance: 'Brawler’s stance',
  quick: 'Quick spell', quickOff: 'Not the quick spell', quickNote: 'The star marks the quick spell: it sits on the action button, no need to open the tome.',
  charge: 'Charge', of: 'of', tierSub: ['basics', 'tier 2 talents', 'tier 3 talents', 'armor ability'], free: 'free', low: 'low charge',
  change: 'Change', take: 'Take the form', trinityNote: 'A form borrows the power of an item you have already identified this run.',
  formOf: ['Weapon enchant or armor glyph', 'Wand or thrown weapon', 'Ring or artifact'], formNone: 'nothing identified yet',
  forms: ['Body', 'Mind', 'Spirit'],
  monkNote: 'Energy builds up from kills. After an ability, rest 1 turn.', empowered: 'empowered',
  powerCost: (n: number) => `Charge ${n}`,
  scoreMine: 'Score',
};
