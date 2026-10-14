/*
 * The forum stream's texts (a study of the Russian Shattered community, pd-notes/forum-pd/CATALOGUE.md): the questions
 * asked before a risky use, the verbs of the confirmations, the trap family colours, the death window's notes, the
 * newcomer's guide (the journal's third tab) and the daily labels. Every rule stated here is checked against
 * Shattered's source (marked [V] in the catalogue) and against this build's core; Russian is typed by English.
 */

/** The first letter small, for a name that stands in the middle of a sentence. */
const small = (name: string): string => name.charAt(0).toLowerCase() + name.slice(1);

export interface GuideEntry {
  /** Which entry it is, for the icon, the page and what the player has read. */
  id: string;
  title: string;
  text: string;
}

export const FORUM_EN = {
  ask: {
    cancel: 'Cancel',
    never: 'Don’t ask again',
    putOn: 'Put on',
    putOnNever: 'Put on, and don’t ask again',
    putOnTitle: (name: string) => `Put on ${name}?`,
    putOnText: (detect: string, remove: string) =>
      `Nobody knows yet whether this is cursed. About 30% of the weapons, armour and rings found are, and a cursed thing cannot be taken off. Check it first with a ${small(detect)}; a curse is lifted by a ${small(remove)} or the Well of Health.`,
    drink: 'Drink',
    drinkNever: 'Drink, and don’t ask again',
    drinkTitle: (name: string) => `Drink ${name}?`,
    drinkText: 'An enemy is in sight, and this potion is unknown. Some potions harm: poison gas, fire, paralysis. Thrown, a harmful one hits where it lands instead of you.',
    throwInstead: 'Throw it instead',
  },
  target: {
    upgrade: 'Upgrade',
    enchant: 'Enchant',
    transmute: 'Transmute',
    curse: 'Curse',
    upgradeTitle: (name: string) => `Upgrade ${name}?`,
    upgradeText: 'The scroll is spent only if you agree. An upgrade cannot be undone.',
    upgradeLoss: (chance: number) => ` The enchantment may be wiped away: ${chance}%.`,
    enchantTitle: (name: string) => `Enchant ${name}?`,
    enchantText: (magic: string) => `${magic}. The scroll is spent, and an enchantment already on it is replaced.`,
    enchantPlain: 'It takes a new enchantment, and one it already has is replaced. Nothing is used up unless you agree.',
    transmuteTitle: (name: string) => `Transmute ${name}?`,
    transmuteText: 'It becomes another item of the same kind, picked at random. This cannot be undone.',
    curseTitle: (name: string) => `Curse ${name}?`,
    curseText: 'It gains a bonus, but is cursed and cannot be taken off. Lift the curse, and the bonus goes with it.',
  },
  verbs: {
    cancel: 'Cancel',
    steal: 'Steal',
    choose: 'Choose',
    later: 'Later',
    moveSeal: 'Move the seal',
    leaveSeal: 'Leave it',
    dismiss: 'Dismiss',
    keep: 'Keep',
    energize: 'Energize',
    replace: 'Replace the run',
    holdHint: 'Hold to confirm',
    /** The hold button while held, and when full. */
    holding: 'Hold on…',
    replaced: 'Replaced',
  },
  /** The trap-colour legend, in the order of Trap.RED ... Trap.BLACK (sheet trap-colours.png): one family each, as the traps of Shattered are coloured (each trap's `color`). */
  trapColours: [
    ['red', 'alarm, guardians, pitfalls, disarming'],
    ['orange', 'fire and explosions'],
    ['yellow', 'lightning and storms'],
    ['green', 'poison gas and darts, ooze, weakening'],
    ['teal', 'teleporting (also forgetting the floor), gateways, summoning, confusion, geysers'],
    ['violet', 'curses and disintegration'],
    ['white', 'cold and flocks of sheep'],
    ['grey', 'corrosion, rockfalls, blinding flashes, grips, worn darts, the grim blast'],
    ['black', 'already triggered: safe'],
  ] as readonly (readonly [string, string])[],
  trapColourTitle: 'Trap colours',
  trapColourText: 'A trap’s pattern differs, its colour does not: the colour tells its family. Tap a trap to read exactly what it does.',
  trapColourNote: 'A trap that has gone off turns black. A known trap can be walked around or jumped over; the step onto it is asked about.',
  settings: {
    risky: 'Ask before risky use',
    riskyNote: 'Putting on an unidentified thing, or drinking an unknown potion with an enemy in sight, asks first',
  },
  /** The death window's notes: what the cause means, and what the ankh took. */
  death: {
    causeLabel: 'Cause',
    notes: {
      hunger: 'Starvation takes health every turn and stops it coming back. Food, the Well of Health and a Potion of Cleansing end hunger.',
      bleeding: 'Bleeding takes health every turn until it fades. A Potion of Healing stops it.',
      poison: 'Poison takes health every turn until it wears off. A Potion of Healing cures it.',
      burning: 'Fire burns each turn; water puts it out.',
      deferred: 'A wound that came due after the blow: the damage was dealt later than it was taken.',
      fall: 'A jump or a fall into a chasm costs at least half of the current health, then bleeding and a limp.',
      gripping: 'A gripping trap. Traps are found by searching; tap one to read what it does.',
      gas: 'Gas from a trap or a potion. A Potion of Purity gives immunity to gases.',
      lightning: 'Electricity runs through water and paralyses; do not stand in water near it.',
    } as Record<string, string>,
    other: {
      dry: 'drought', berserk: 'a berserker’s rage', chill: 'cold', magic: 'magic', holy: 'holy fire', lifeLink: 'a life link', electricity: 'electricity',
      geyser: 'a geyser', psionic: 'a psionic blast', arcaneBomb: 'an arcane bomb', flashbang: 'a flashbang', shrapnel: 'shrapnel', rocks: 'falling rocks',
      king: 'the Dwarf King’s summons', link: 'a life link',
    } as Record<string, string>,
    packLeft: 'Your pack stayed where you fell: pick it up and everything comes back to you. It is marked in the Journal.',
    packAt: (depth: number, items: number) => `The lost backpack still lies on depth ${depth}: ${items} item${items === 1 ? '' : 's'}.`,
    carried: (items: number, gold: number) => `In the pack: ${items} item${items === 1 ? '' : 's'}${gold > 0 ? `, ${gold} gold` : ''}.`,
    noAnkh: 'There was no ankh to bring you back: the run ends here.',
  },
  guide: {
    tab: 'Guide',
    intro: 'What newcomers ask most, checked against the game’s rules.',
    count: (total: number, read: number) => `${total} tips · read ${read}`,
    /** «Purity or Cleansing» as two columns (the potion, its kind, three points each). */
    purityLead: 'Two potions with similar names do different things.',
    purity: [
      ['Potion of Purity', 'regular', ['Neutralises gases and clouds around you', 'Gives immunity to gases for a while', 'Does not cure bad effects']],
      ['Potion of Cleansing', 'exotic', ['Removes every bad effect and ends hunger', 'Protects you from new ones for 5 turns', 'Can be thrown at another; brewed from Purity']],
    ] as ReadonlyArray<readonly [string, string, readonly string[]]>,
    entries: [
      { id: 'hunger', title: 'Hunger', text: 'Fullness fades every turn. About 300 turns after you were full you are “hungry”: time to look for food. At 450 you are “starving”: health drains and does not come back. A ration gives 300 turns, a pasty 450, a meat pie 900, meat 150, a dungeon berry 100.' },
      { id: 'hungerEnd', title: 'What ends hunger', text: 'Food, the Well of Health (all of it) and the Potion of Cleansing (all of it). The chalice of blood does not heal you while you starve. With the “On diet” challenge, food feeds only a third as much.' },
      { id: 'ankh', title: 'The ankh', text: 'An ordinary ankh brings you back elsewhere on the floor, far from where you fell, whole and invisible for a moment, but with the floor forgotten. You keep two things (the weapon and armour, or two you choose) and your gold; the rest lies in a “lost backpack” where you fell: go back and pick it up, and all of it returns. An ankh blessed with a full waterskin (the Bless button) revives you on the spot with a quarter of your health, cured, untouchable for 3 turns, and keeps your things. Either way the ankh is used up.' },
      { id: 'curses', title: 'Curses', text: 'About 30% of the weapons, armour, rings, wands and artifacts found are cursed. A cursed thing cannot be taken off. A stone of detect magic tells beforehand whether an item holds good or ill magic.' },
      { id: 'uncurse', title: 'Lifting a curse', text: 'A Scroll of Remove Curse lifts it from one item. The Well of Health lifts it from everything worn. A Scroll of Upgrade also frees a cursed item, and a cursed enchantment goes with a one-in-three chance.' },
      { id: 'wealth', title: 'Ring of wealth', text: 'Each level of the ring multiplies your luck at drops by 1.2. Besides, slain enemies now and then drop an extra item: mostly consumables, now and then gear, better with a higher ring. The colour of the flash at a drop tells its worth: green and blue, plain consumables; violet, a valuable one or gear +0…+1; orange, gear +2 or better.' },
      { id: 'mimics', title: 'Mimics', text: 'Tap a chest: an ordinary mimic’s description says “Something about this chest feels off…”. Golden mimics are stronger but carry better treasure. A crystal mimic avoids a fight: it steals, and runs off with its loot once it is found. Ebony mimics, drawn by the mimic tooth trinket, are almost invisible and hide in things lying on the floor: a “suspicious outline” gives them away. The tooth makes the others harder to spot.' },
      { id: 'purity', title: 'Purity or Cleansing', text: 'A Potion of Purity (“Очищение”) neutralises gases around you and gives immunity to them, but does not cure bad effects. A Potion of Cleansing (“Избавление”, brewed from Purity) removes every bad effect, ends hunger and protects you from new ones for 5 turns; it can be thrown at another.' },
      { id: 'well', title: 'The Well of Health', text: 'One draught: full health, every bad effect gone, the curse lifted from everything worn, hunger gone. Then the well runs dry. Put on any doubtful items before you drink.' },
      { id: 'seeds', title: 'Seeds in the pot', text: 'Three identical seeds make their potion, already known. Two and one: 50% the potion of the two, 25% the potion of the one, 25% a random one. Three different: about 17% each and 50% a random one. A Potion of Strength is never random, but a rotberry seed brews it; healing from seeds is limited.' },
      { id: 'score', title: 'The score', text: 'Progress: level × depth × 65 (up to 50 000). Treasure: gold plus the worth of the pack (up to 20 000). Exploration (up to 20 000) falls for items missed, hidden doors and riddles unsolved. Bosses: 1000, 2000, 3000, 4000, 5000, less for dodgeable hits. Quests: the ghost 1000, the wandmaker 2000, the imp 4000, the blacksmith by the respect earned. A win doubles it; carrying the Amulet out, ×2.5.' },
      { id: 'challenges', title: 'Challenges', text: 'Nine challenges open with the first victory (the daily dungeon has its own, on from the start): Hostile champions, Badder bosses, On diet (food feeds a third as much), Faith is my armor (armor blocks far less), Pharmacophobia (healing poisons you), Barren land (no dew, nothing takes root), Swarm intelligence, Into darkness (you see 2 cells) and Forbidden runes (every second scroll of upgrade is gone). Each one on multiplies the score: ×1.25 for one, ×1.55 for two, ×1.95 for three, and so on up to ×7.45 for all nine. They add up: do not take many at once. Tap the arrow in the list for what each one does.' },
      { id: 'drained', title: 'Drained enemies', text: 'Experience stops coming once you outgrow an enemy: a rat past level 5, a snake past 7, a gnoll past 8, a crab, slime or swarm past 9. Loot dries up two levels later. That is not a bug.' },
    ] as readonly GuideEntry[],
  },
  /** The hint under a hold button's row: «hold for 1.2 s». */
  holdFor: (seconds: string) => `hold for ${seconds} s`,
  /** The challenges window (design v23): the tag on Shattered's two new ones, and the «?» beside them. */
  challengeNew: 'new',
  challengeMore: (name: string) => `More: ${name}`,
  /** Daily and run labels. */
  label: {
    counted: 'counts',
    repeat: 'repeat',
    custom: 'own seed',
    local: 'not counted',
    countedNote: 'This run counts for the boards.',
    repeatNote: 'Today’s dungeon was played already: this repeat is practice and does not count for the boards.',
    customNote: 'A run on your own seed does not count for records or boards.',
    localNote: 'This run is played without the server: it counts for no board.',
    attemptNote: 'The attempt counts from the start of the run: leaving, or erasing the save, does not give it back.',
    hint: 'The attempt is spent when the run starts.',
    title: 'Counts?',
  },
};
