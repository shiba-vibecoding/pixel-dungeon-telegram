import { describe, expect, it } from 'vitest';
import { LENGTH } from '@pd/core';
import { parseClientMessage, sanitizeAction, sanitizeLook } from '../src/messages';

describe('client messages', () => {
  it('rebuilds actions from the fields the rules read, and nothing else', () => {
    expect(sanitizeAction({ type: 'wait', junk: 'x'.repeat(1000) })).toEqual({ type: 'wait' });
    // Down to a depth's side level (the mine, the vault) or back.
    expect(sanitizeAction({ type: 'branch', to: 5 })).toEqual({ type: 'branch' });
    expect(sanitizeAction({ type: 'move', to: 42, extra: { deep: true } })).toEqual({ type: 'move', to: 42 });
    expect(sanitizeAction({ type: 'attack', target: '#3', also: 1 })).toEqual({ type: 'attack', target: '#3' });
    expect(sanitizeAction({ type: 'use', item: 2, target: 'armor' })).toEqual({ type: 'use', item: 2, target: 'armor' });
    expect(sanitizeAction({ type: 'use', item: 2 })).toEqual({ type: 'use', item: 2 });
    // A scroll read on an item the player picked (scrolls.ts): a slot, the weapon, the armour or a worn ring.
    expect(sanitizeAction({ type: 'use', item: 2, on: 5 })).toEqual({ type: 'use', item: 2, on: 5 });
    expect(sanitizeAction({ type: 'use', item: 2, on: 'misc' })).toEqual({ type: 'use', item: 2, on: 'misc' });
    expect(sanitizeAction({ type: 'use', item: 2, on: 'ring1' })).toBeNull();
    expect(sanitizeAction({ type: 'use', item: 2, on: 'boots' })).toBeNull();
    expect(sanitizeAction({ type: 'open', cell: 300, junk: 1 })).toEqual({ type: 'open', cell: 300 });
    // The troll blacksmith's services, and mining on his mine.
    expect(sanitizeAction({ type: 'blacksmith', service: 'reforge', first: 'ring', second: 3, item: 1 })).toEqual({ type: 'blacksmith', service: 'reforge', first: 'ring', second: 3 });
    expect(sanitizeAction({ type: 'blacksmith', service: 'harden', item: 'armor', choice: 2 })).toEqual({ type: 'blacksmith', service: 'harden', item: 'armor' });
    expect(sanitizeAction({ type: 'blacksmith', service: 'upgrade', item: 4 })).toEqual({ type: 'blacksmith', service: 'upgrade', item: 4 });
    expect(sanitizeAction({ type: 'blacksmith', service: 'pick', choice: 3, item: 2 })).toEqual({ type: 'blacksmith', service: 'pick', choice: 3 });
    expect(sanitizeAction({ type: 'blacksmith', service: 'cashout', first: 1 })).toEqual({ type: 'blacksmith', service: 'cashout' });
    expect(sanitizeAction({ type: 'vault', op: 'door', x: 1 })).toEqual({ type: 'vault', op: 'door' });
    expect(sanitizeAction({ type: 'vault', op: 'escape', keep: 'weapon' })).toEqual({ type: 'vault', op: 'escape', keep: 'weapon' });
    expect(sanitizeAction({ type: 'vault', op: 'escape' })).toEqual({ type: 'vault', op: 'escape' });
    expect(sanitizeAction({ type: 'vault', op: 'beacon', item: 2 })).toEqual({ type: 'vault', op: 'beacon', item: 2 });
    expect(sanitizeAction({ type: 'vault', op: 'steal' })).toBeNull();
    expect(sanitizeAction({ type: 'skeletonKey', item: 0, target: 200 })).toEqual({ type: 'skeletonKey', item: 0, target: 200 });
    expect(sanitizeAction({ type: 'skeletonKey', item: 0, target: -1 })).toBeNull();
    expect(sanitizeAction({ type: 'blacksmith', service: 'pickaxe' })).toEqual({ type: 'blacksmith', service: 'pickaxe' });
    expect(sanitizeAction({ type: 'blacksmith', service: 'smith' })).toEqual({ type: 'blacksmith', service: 'smith' });
    expect(sanitizeAction({ type: 'mine', cell: 130, x: 1 })).toEqual({ type: 'mine', cell: 130 });
    expect(sanitizeAction({ type: 'throw', item: 0, target: 100 })).toEqual({ type: 'throw', item: 0, target: 100 });
    expect(sanitizeAction({ type: 'throw', item: 0, target: 100 })).toEqual({ type: 'throw', item: 0, target: 100 });
    // Shattered's wands: zapping a wand or the mage's staff, imbuing a wand into the staff, dismissing a ward.
    expect(sanitizeAction({ type: 'zap', item: 3, target: 100, x: 1 })).toEqual({ type: 'zap', item: 3, target: 100 });
    expect(sanitizeAction({ type: 'zap', item: 'weapon', target: 100 })).toEqual({ type: 'zap', item: 'weapon', target: 100 });
    expect(sanitizeAction({ type: 'imbue', staff: 'weapon', wand: 2 })).toEqual({ type: 'imbue', staff: 'weapon', wand: 2 });
    expect(sanitizeAction({ type: 'imbue', staff: 4, wand: 2, junk: true })).toEqual({ type: 'imbue', staff: 4, wand: 2 });
    expect(sanitizeAction({ type: 'dismiss', target: '#12' })).toEqual({ type: 'dismiss', target: '#12' });
    expect(sanitizeAction({ type: 'master', item: 1, subclass: 'warden' })).toEqual({ type: 'master', item: 1, subclass: 'warden' });
    // Alchemy: an item's cell and choice; the pot's ingredients and recipe; turning an item into energy.
    expect(sanitizeAction({ type: 'use', item: 1, on: 'weapon', choice: 2, junk: 1 })).toEqual({ type: 'use', item: 1, on: 'weapon', choice: 2 });
    expect(sanitizeAction({ type: 'use', item: 1, cell: 300 })).toEqual({ type: 'use', item: 1, cell: 300 });
    expect(sanitizeAction({ type: 'alchemy', inputs: [3, 3, 0], recipe: 1, x: 1 })).toEqual({ type: 'alchemy', inputs: [3, 3, 0], recipe: 1 });
    expect(sanitizeAction({ type: 'alchemy', inputs: [4] })).toEqual({ type: 'alchemy', inputs: [4] });
    expect(sanitizeAction({ type: 'energize', item: 2, all: true })).toEqual({ type: 'energize', item: 2, all: true });
    expect(sanitizeAction({ type: 'energize', item: 2, all: 'yes' })).toEqual({ type: 'energize', item: 2 });
    expect(sanitizeAction({ type: 'augment', item: 1, on: 'weapon', augment: 'speed' })).toEqual({ type: 'augment', item: 1, on: 'weapon', augment: 'speed' });
    expect(sanitizeAction({ type: 'augment', item: 1, on: 3, augment: 'none', x: 1 })).toEqual({ type: 'augment', item: 1, on: 3, augment: 'none' });
    expect(sanitizeAction({ type: 'shoot', item: 0, target: 40 })).toEqual({ type: 'shoot', item: 0, target: 40 });
    expect(sanitizeAction({ type: 'tip', item: 2, seed: 5, all: true })).toEqual({ type: 'tip', item: 2, seed: 5, all: true });
    expect(sanitizeAction({ type: 'tip', item: 2, seed: 5, all: 'yes' })).toEqual({ type: 'tip', item: 2, seed: 5 });
    expect(sanitizeAction({ type: 'clean', item: 2 })).toEqual({ type: 'clean', item: 2 });
    expect(sanitizeAction({ type: 'clean', item: 2, all: true })).toEqual({ type: 'clean', item: 2, all: true });
    expect(sanitizeAction({ type: 'special' })).toEqual({ type: 'special' });
    expect(sanitizeAction({ type: 'special', target: 7 })).toEqual({ type: 'special', target: 7 });
    // The armour ability's warp beacon choice, the class armour's transfer, a point of talent.
    expect(sanitizeAction({ type: 'special', choice: 1, x: 2 })).toEqual({ type: 'special', choice: 1 });
    expect(sanitizeAction({ type: 'special', choice: 3 })).toBeNull();
    expect(sanitizeAction({ type: 'transfer', to: 'armor', from: 4, junk: 1 })).toEqual({ type: 'transfer', to: 'armor', from: 4 });
    expect(sanitizeAction({ type: 'transfer', to: 'weapon', from: 4 })).toBeNull();
    expect(sanitizeAction({ type: 'talent', talent: 'bodySlam' })).toEqual({ type: 'talent', talent: 'bodySlam' });
    expect(sanitizeAction({ type: 'talent', talent: 'nonsense' })).toBeNull();
    // The classes' actions: a Duelist's weapon ability, a Monk's, a Cleric's spells, Trinity's form.
    expect(sanitizeAction({ type: 'weaponAbility', which: 'second', cell: 5, junk: 1 })).toEqual({ type: 'weaponAbility', which: 'second', cell: 5 });
    expect(sanitizeAction({ type: 'weaponAbility', which: 'third' })).toBeNull();
    expect(sanitizeAction({ type: 'weaponAbility' })).toEqual({ type: 'weaponAbility' });
    expect(sanitizeAction({ type: 'monk', ability: 'flurry', cell: 9 })).toEqual({ type: 'monk', ability: 'flurry', cell: 9 });
    expect(sanitizeAction({ type: 'monk', ability: 'nonsense' })).toBeNull();
    expect(sanitizeAction({ type: 'swap' })).toEqual({ type: 'swap' });
    expect(sanitizeAction({ type: 'cast', spell: 'guidingLight', cell: 12, junk: 1 })).toEqual({ type: 'cast', spell: 'guidingLight', cell: 12 });
    expect(sanitizeAction({ type: 'cast', spell: 'bodyForm', choice: 3 })).toEqual({ type: 'cast', spell: 'bodyForm', choice: 3 });
    expect(sanitizeAction({ type: 'cast', spell: 'x' })).toBeNull();
    expect(sanitizeAction({ type: 'quick', spell: null })).toEqual({ type: 'quick', spell: null });
    expect(sanitizeAction({ type: 'quick', spell: 'bless' })).toEqual({ type: 'quick', spell: 'bless' });
    expect(sanitizeAction({ type: 'special', choice: 2, target: 4 })).toEqual({ type: 'special', choice: 2, target: 4 });
    // The talents of every tier, and nothing off the table (a prototype's names too).
    expect(sanitizeAction({ type: 'talent', talent: 'hearty_meal', x: 1 })).toEqual({ type: 'talent', talent: 'hearty_meal' });
    expect(sanitizeAction({ type: 'talent', talent: 'toString' })).toBeNull();
    expect(sanitizeAction({ type: 'talent', talent: 7 })).toBeNull();
    // The subclasses' indicator.
    expect(sanitizeAction({ type: 'ability', ability: 'berserk', x: 1 })).toEqual({ type: 'ability', ability: 'berserk' });
    expect(sanitizeAction({ type: 'ability', ability: 'combo', move: 'parry' })).toEqual({ type: 'ability', ability: 'combo', move: 'parry' });
    expect(sanitizeAction({ type: 'ability', ability: 'combo', move: 'parry', target: '#m1' })).toEqual({ type: 'ability', ability: 'combo', move: 'parry', target: '#m1' });
    expect(sanitizeAction({ type: 'ability', ability: 'combo', move: 'nonsense' })).toBeNull();
    expect(sanitizeAction({ type: 'ability', ability: 'ambush' })).toBeNull();
    expect(sanitizeAction({ type: 'ability', ability: 'ambush', target: '#m1' })).toEqual({ type: 'ability', ability: 'ambush', target: '#m1' });
    expect(sanitizeAction({ type: 'ability', ability: 'fly' })).toBeNull();
    expect(sanitizeAction({ type: 'use', item: 3, choice: 2 })).toEqual({ type: 'use', item: 3, choice: 2 });
    // Artifacts (the core's ArtifactAction): worn by slot or carried by index, a use, and what it aims at or takes.
    expect(sanitizeAction({ type: 'artifact', item: 5, use: 'return', mode: 'x' })).toEqual({ type: 'artifact', item: 5, use: 'return' });
    expect(sanitizeAction({ type: 'artifact', item: 'artifact', use: 'cast', cell: 300 })).toEqual({ type: 'artifact', item: 'artifact', use: 'cast', cell: 300 });
    expect(sanitizeAction({ type: 'artifact', item: 'misc', use: 'store', with: 3 })).toEqual({ type: 'artifact', item: 'misc', use: 'store', with: 3 });
    expect(sanitizeAction({ type: 'artifact', item: 'artifact', use: 'resolve', choice: 1, on: 'weapon' }))
      .toEqual({ type: 'artifact', item: 'artifact', use: 'resolve', choice: 1, on: 'weapon' });
    expect(sanitizeAction({ type: 'equip', item: 2, replace: 'misc' })).toEqual({ type: 'equip', item: 2, replace: 'misc' });
    expect(sanitizeAction({ type: 'remove', slot: 'ring', ring: 0 })).toEqual({ type: 'remove', slot: 'ring' });
    expect(sanitizeAction({ type: 'reward', choice: 'weapon' })).toEqual({ type: 'reward', choice: 'weapon' });
    // The warrior's broken seal: onto an armour, off one.
    expect(sanitizeAction({ type: 'affix', from: 'armor', to: 3, x: 1 })).toEqual({ type: 'affix', from: 'armor', to: 3 });
    expect(sanitizeAction({ type: 'affix', from: 2, to: 'armor' })).toEqual({ type: 'affix', from: 2, to: 'armor' });
    expect(sanitizeAction({ type: 'detach', armor: 'armor' })).toEqual({ type: 'detach', armor: 'armor' });
    expect(sanitizeAction({ type: 'detach', armor: 4 })).toEqual({ type: 'detach', armor: 4 });
    expect(sanitizeAction({ type: 'wandReward', choice: 2 })).toEqual({ type: 'wandReward', choice: 2 });
    expect(sanitizeAction({ type: 'wandReward', choice: 1, extra: 'x' })).toEqual({ type: 'wandReward', choice: 1 });
    // The arena of waves: ready for the next wave, and one of three rewards.
    expect(sanitizeAction({ type: 'arenaReady', wave: 99 })).toEqual({ type: 'arenaReady' });
    expect(sanitizeAction({ type: 'arenaReady', cancel: true })).toEqual({ type: 'arenaReady', cancel: true });
    expect(sanitizeAction({ type: 'arenaReady', cancel: 'yes' })).toEqual({ type: 'arenaReady' });
    expect(sanitizeAction({ type: 'arenaPick', choice: 2, item: { kind: 'scroll.upgrade' } })).toEqual({ type: 'arenaPick', choice: 2 });
  });

  it('refuses what is not an action of the rules', () => {
    for (const bad of [
      null, 'wait', 3, {}, { type: 'fly' }, { type: '__proto__' },
      { type: 'move' }, { type: 'move', to: -1 }, { type: 'move', to: LENGTH }, { type: 'move', to: 1.5 }, { type: 'move', to: '7' },
      { type: 'attack', target: 5 }, { type: 'attack', target: '' }, { type: 'attack', target: 'x'.repeat(65) },
      { type: 'use', item: 1, target: 'ring' }, { type: 'drop', item: 1000 }, { type: 'reward', choice: 'gold' },
      { type: 'blacksmith', service: 'reforge', first: 'helmet', second: 1 }, { type: 'blacksmith', service: 'reforge', first: 1 },
      { type: 'blacksmith', service: 'bribe' }, { type: 'blacksmith' }, { type: 'blacksmith', service: 'harden' },
      { type: 'blacksmith', service: 'pick', choice: 4 }, { type: 'blacksmith', service: 'pick' }, { type: 'reforge', first: 1, second: 2 },
      { type: 'mine' }, { type: 'mine', cell: -1 }, { type: 'mine', cell: LENGTH }, { type: 'master', item: 1, subclass: 'pirate' },
      { type: 'balance', item: 1, imbue: 'luck' }, { type: 'special', target: null }, { type: 'beacon', item: 1, mode: 'go' },
      { type: 'affix', from: 'weapon', to: 1 }, { type: 'affix', from: 1 }, { type: 'affix', from: 1, to: 1000 }, { type: 'detach' },
      { type: 'detach', armor: 'ring0' }, { type: 'detach', armor: -1 },
      { type: 'arenaPick' }, { type: 'arenaPick', choice: 3 }, { type: 'arenaPick', choice: -1 }, { type: 'arenaPick', choice: '1' },
      { type: 'wandReward' }, { type: 'wandReward', choice: 0 }, { type: 'wandReward', choice: 3 }, { type: 'wandReward', choice: 'battle' },
      { type: 'reforge', first: 'helmet', second: 1 }, { type: 'master', item: 1, subclass: 'pirate' },
      { type: 'use', item: 1, choice: 256 }, { type: 'use', item: 1, cell: -1 }, { type: 'use', item: 1, choice: 0.5 },
      { type: 'alchemy', inputs: [] }, { type: 'alchemy', inputs: [1, 2, 3, 4] }, { type: 'alchemy', inputs: [1, 'a'] },
      { type: 'alchemy', inputs: 1 }, { type: 'alchemy', inputs: [1], recipe: -1 }, { type: 'energize', item: -1 },
      { type: 'augment', item: 1, on: 'weapon', augment: 'luck' }, { type: 'augment', item: 1, on: 'ring9', augment: 'speed' },
      { type: 'shoot', item: 1 }, { type: 'tip', item: 1 }, { type: 'clean', item: -1 }, { type: 'balance', item: 1, imbue: 'speed' }, { type: 'special', target: null },
      { type: 'artifact', item: 1, use: 'fly' }, { type: 'artifact', item: 'cape', use: 'zap' },
      { type: 'artifact', item: 1, use: 'zap', cell: -1 }, { type: 'artifact', item: 1, use: 'resolve', choice: 99 },
      { type: 'equip', item: 1, replace: 'belt' }, { type: 'remove', ring: 0 },
      { type: 'affix', from: 'weapon', to: 1 }, { type: 'affix', from: 1 }, { type: 'affix', from: 1, to: 1000 }, { type: 'detach' },
      { type: 'detach', armor: 'ring0' }, { type: 'detach', armor: -1 },
      { type: 'arenaPick' }, { type: 'arenaPick', choice: 3 }, { type: 'arenaPick', choice: -1 }, { type: 'arenaPick', choice: '1' },
      { type: 'zap', item: 'armor', target: 5 }, { type: 'zap', item: 1, target: LENGTH }, { type: 'imbue', staff: 'ring0', wand: 1 },
      { type: 'imbue', staff: 'weapon' }, { type: 'dismiss', target: 4 }, { type: 'dismiss' },
    ]) {
      expect(sanitizeAction(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it('keeps only looks Pixel-Mart has, and never the patron mark', () => {
    expect(sanitizeLook({ skin: 'royal', effect: 'snow', frame: 'gold', patron: true, x: 1 })).toEqual({ skin: 'royal', effect: 'snow', frame: 'gold' });
    expect(sanitizeLook({ skin: 'golden', effect: 7 })).toEqual({});
    expect(sanitizeLook('royal')).toEqual({});
  });

  it('reads each kind of message, an action of the wrong shape as null', () => {
    expect(parseClientMessage({ type: 'act', action: { type: 'wait', payload: 'x' } })).toEqual({ type: 'act', action: { type: 'wait' } });
    expect(parseClientMessage({ type: 'act', action: { type: 'teleport' } })).toEqual({ type: 'act', action: null });
    expect(parseClientMessage({ type: 'sync', extra: 1 })).toEqual({ type: 'sync' });
    expect(parseClientMessage({ type: 'restart' })).toEqual({ type: 'restart' });
    expect(parseClientMessage({ type: 'look', look: { frame: 'shadow', patron: true } })).toEqual({ type: 'look', look: { frame: 'shadow' } });
    expect(parseClientMessage({ type: 'signal', signal: { kind: 'emote', emote: 'help' } })).toEqual({ type: 'signal', signal: { kind: 'emote', emote: 'help' } });
    expect(parseClientMessage({ type: 'hello' })).toBeNull();
    expect(parseClientMessage([1, 2])).toBeNull();
  });
});
