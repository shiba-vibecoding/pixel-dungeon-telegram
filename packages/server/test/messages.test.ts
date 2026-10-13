import { describe, expect, it } from 'vitest';
import { LENGTH } from '@pd/core';
import { parseClientMessage, sanitizeAction, sanitizeLook } from '../src/messages';

describe('client messages', () => {
  it('rebuilds actions from the fields the rules read, and nothing else', () => {
    expect(sanitizeAction({ type: 'wait', junk: 'x'.repeat(1000) })).toEqual({ type: 'wait' });
    expect(sanitizeAction({ type: 'move', to: 42, extra: { deep: true } })).toEqual({ type: 'move', to: 42 });
    expect(sanitizeAction({ type: 'attack', target: '#3', also: 1 })).toEqual({ type: 'attack', target: '#3' });
    expect(sanitizeAction({ type: 'use', item: 2, target: 'armor' })).toEqual({ type: 'use', item: 2, target: 'armor' });
    expect(sanitizeAction({ type: 'use', item: 2 })).toEqual({ type: 'use', item: 2 });
    // A scroll read on an item the player picked (scrolls.ts): a slot, the weapon, the armour or a worn ring.
    expect(sanitizeAction({ type: 'use', item: 2, on: 5 })).toEqual({ type: 'use', item: 2, on: 5 });
    expect(sanitizeAction({ type: 'use', item: 2, on: 'ring1' })).toEqual({ type: 'use', item: 2, on: 'ring1' });
    expect(sanitizeAction({ type: 'use', item: 2, on: 'boots' })).toBeNull();
    expect(sanitizeAction({ type: 'open', cell: 300, junk: 1 })).toEqual({ type: 'open', cell: 300 });
    expect(sanitizeAction({ type: 'reforge', first: 'ring0', second: 3 })).toEqual({ type: 'reforge', first: 'ring0', second: 3 });
    expect(sanitizeAction({ type: 'throw', item: 0, target: 100 })).toEqual({ type: 'throw', item: 0, target: 100 });
    // Shattered's wands: zapping a wand or the mage's staff, imbuing a wand into the staff, dismissing a ward.
    expect(sanitizeAction({ type: 'zap', item: 3, target: 100, x: 1 })).toEqual({ type: 'zap', item: 3, target: 100 });
    expect(sanitizeAction({ type: 'zap', item: 'weapon', target: 100 })).toEqual({ type: 'zap', item: 'weapon', target: 100 });
    expect(sanitizeAction({ type: 'imbue', staff: 'weapon', wand: 2 })).toEqual({ type: 'imbue', staff: 'weapon', wand: 2 });
    expect(sanitizeAction({ type: 'imbue', staff: 4, wand: 2, junk: true })).toEqual({ type: 'imbue', staff: 4, wand: 2 });
    expect(sanitizeAction({ type: 'dismiss', target: '#12' })).toEqual({ type: 'dismiss', target: '#12' });
    expect(sanitizeAction({ type: 'reforge', first: 'weapon', second: 3 })).toEqual({ type: 'reforge', first: 'weapon', second: 3 });
    expect(sanitizeAction({ type: 'master', item: 1, subclass: 'warden' })).toEqual({ type: 'master', item: 1, subclass: 'warden' });
    expect(sanitizeAction({ type: 'augment', item: 1, on: 'weapon', augment: 'speed' })).toEqual({ type: 'augment', item: 1, on: 'weapon', augment: 'speed' });
    expect(sanitizeAction({ type: 'augment', item: 1, on: 3, augment: 'none', x: 1 })).toEqual({ type: 'augment', item: 1, on: 3, augment: 'none' });
    expect(sanitizeAction({ type: 'shoot', item: 0, target: 40 })).toEqual({ type: 'shoot', item: 0, target: 40 });
    expect(sanitizeAction({ type: 'tip', item: 2, seed: 5, all: true })).toEqual({ type: 'tip', item: 2, seed: 5, all: true });
    expect(sanitizeAction({ type: 'tip', item: 2, seed: 5, all: 'yes' })).toEqual({ type: 'tip', item: 2, seed: 5 });
    expect(sanitizeAction({ type: 'clean', item: 2 })).toEqual({ type: 'clean', item: 2 });
    expect(sanitizeAction({ type: 'clean', item: 2, all: true })).toEqual({ type: 'clean', item: 2, all: true });
    expect(sanitizeAction({ type: 'special' })).toEqual({ type: 'special' });
    expect(sanitizeAction({ type: 'special', target: 7 })).toEqual({ type: 'special', target: 7 });
    expect(sanitizeAction({ type: 'beacon', item: 5, mode: 'return' })).toEqual({ type: 'beacon', item: 5, mode: 'return' });
    expect(sanitizeAction({ type: 'reward', choice: 'weapon' })).toEqual({ type: 'reward', choice: 'weapon' });
    // The warrior's broken seal: onto an armour, off one.
    expect(sanitizeAction({ type: 'affix', from: 'armor', to: 3, x: 1 })).toEqual({ type: 'affix', from: 'armor', to: 3 });
    expect(sanitizeAction({ type: 'affix', from: 2, to: 'armor' })).toEqual({ type: 'affix', from: 2, to: 'armor' });
    expect(sanitizeAction({ type: 'detach', armor: 'armor' })).toEqual({ type: 'detach', armor: 'armor' });
    expect(sanitizeAction({ type: 'detach', armor: 4 })).toEqual({ type: 'detach', armor: 4 });
    expect(sanitizeAction({ type: 'wandReward', choice: 'utility' })).toEqual({ type: 'wandReward', choice: 'utility' });
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
      { type: 'reforge', first: 'helmet', second: 1 }, { type: 'master', item: 1, subclass: 'pirate' },
      { type: 'augment', item: 1, on: 'weapon', augment: 'luck' }, { type: 'augment', item: 1, on: 'ring9', augment: 'speed' },
      { type: 'shoot', item: 1 }, { type: 'tip', item: 1 }, { type: 'clean', item: -1 }, { type: 'balance', item: 1, imbue: 'speed' }, { type: 'special', target: null }, { type: 'beacon', item: 1, mode: 'go' },
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
