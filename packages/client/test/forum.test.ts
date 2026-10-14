import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  addHero, canEnter, charAt, createItem, createMob, createWorld, floorAt, heroById, levelAt, NEIGHBOURS8, T, TRAP_COLOR, TRAPS, type TrapKind, type World,
} from '@pd/core';
import { drinkRisk, enchantLossChance, equipRisk, targetEffect } from '../src/riskyuse';
import { clearMemo, loadMemo, memoValid, saveMemo } from '../src/windowmemo';
import { FORUM_EN, FORUM_RU } from '../src/i18n-forum';

type I18n = typeof import('../src/i18n');
let i18n: I18n;
let names: typeof import('../src/levelnames');
let death: typeof import('../src/deathcopy');
let labels: typeof import('../src/labels');

beforeAll(async () => {
  // The texts are chosen at load by the page's address; there is none here.
  vi.stubGlobal('location', { search: '' });
  i18n = await import('../src/i18n');
  names = await import('../src/levelnames');
  death = await import('../src/deathcopy');
  labels = await import('../src/labels');
});

function setup() {
  const world = createWorld(11);
  addHero(world, { id: 'p', name: 'P', heroClass: 'warrior' });
  const hero = heroById(world, 'p')!;
  return { world, hero };
}

/** A rat in the open beside the hero, awake. */
function ratBeside(world: World) {
  const hero = heroById(world, 'p')!;
  const level = levelAt(world, hero.depth);
  const floor = floorAt(world, hero.depth);
  const cell = NEIGHBOURS8.map((n) => hero.pos + n).find((c) => canEnter(level, c) && !charAt(world, hero.depth, c) && level.map[c] !== T.DOOR)!;
  const rat = createMob('#r1', 'rat', cell, 'hunting', floor.now);
  floor.mobs.push(rat);
  return rat;
}

describe('confirming risky use', () => {
  it('asks before putting on gear whose curse is not known, and not before the rest', () => {
    const sword = createItem('weapon.sword');
    expect(equipRisk(sword)).toBe(false);
    sword.curseUnknown = true;
    expect(equipRisk(sword)).toBe(true);
    const ring = createItem('ring.haste');
    ring.curseUnknown = true;
    expect(equipRisk(ring)).toBe(true);
    delete ring.curseUnknown;
    expect(equipRisk(ring)).toBe(false);
    // Potions and scrolls have no curse to fear.
    const potion = createItem('potion.healing');
    potion.curseUnknown = true;
    expect(equipRisk(potion)).toBe(false);
  });

  it('asks before drinking an unknown potion only while an enemy is in sight', () => {
    const { world, hero } = setup();
    const potion = createItem('potion.healing');
    world.known = world.known.filter((kind) => kind !== 'potion.healing');
    expect(drinkRisk(world, hero, potion)).toBe(false);
    ratBeside(world);
    expect(drinkRisk(world, hero, potion)).toBe(true);
    // Known, it is no gamble; a scroll is no potion.
    world.known.push('potion.healing');
    expect(drinkRisk(world, hero, potion)).toBe(false);
    expect(drinkRisk(world, hero, createItem('scroll.upgrade'))).toBe(false);
  });

  it('names what a scroll, stone or spell does for good, and the chance an upgrade wipes an enchantment', () => {
    expect(targetEffect('scroll.upgrade')).toBe('upgrade');
    expect(targetEffect('spell.magicalInfusion')).toBe('upgrade');
    expect(targetEffect('scroll.enchantment')).toBe('enchant');
    expect(targetEffect('scroll.transmutation')).toBe('transmute');
    expect(targetEffect('spell.curseInfusion')).toBe('curse');
    expect(targetEffect('scroll.identify')).toBeUndefined();
    const sword = createItem('weapon.sword');
    sword.enchant = 'blazing';
    const chances = [3, 4, 5, 6, 7, 8, 12].map((level) => enchantLossChance({ ...sword, level }));
    expect(chances).toEqual([0, 10, 20, 40, 80, 100, 100]);
    expect(enchantLossChance({ ...sword, level: 6, hardened: true })).toBe(0);
    expect(enchantLossChance({ ...createItem('weapon.sword'), level: 6 })).toBe(0);
  });
});

describe('windows that come back', () => {
  it('are put back only in the same run, on the same turn, with the hero alive', () => {
    const memo = { run: '7:abc', turn: 40, state: { w: 'bag' } };
    expect(memoValid(memo, '7:abc', 40, true, false)).toBe(true);
    expect(memoValid(memo, '7:abc', 41, true, false)).toBe(false);
    expect(memoValid(memo, '8:abc', 40, true, false)).toBe(false);
    expect(memoValid(memo, '7:abc', 40, false, false)).toBe(false);
    expect(memoValid(memo, '7:abc', 40, true, true)).toBe(false);
    expect(memoValid(null, '7:abc', 40, true, false)).toBe(false);
  });

  it('are kept on the device and read back, or forgotten', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    });
    const memo = { run: '7:', turn: 3, kind: 'scroll.upgrade', state: { w: 'pick', index: 2, button: 1 } };
    saveMemo(memo);
    expect(loadMemo()).toEqual(memo);
    clearMemo();
    expect(loadMemo()).toBeNull();
    store.set('pd-window', '{"run":1}');
    expect(loadMemo()).toBeNull();
    store.set('pd-window', 'not json');
    expect(loadMemo()).toBeNull();
    vi.unstubAllGlobals();
    vi.stubGlobal('location', { search: '' });
  });
});

describe('how a run counts', () => {
  it('is «counts» for a checked first run, «repeat» for the day played again, «own seed» for a chosen one', () => {
    expect(labels.runLabel({ checked: true, ranked: true })).toBe('counted');
    expect(labels.runLabel({ checked: true, ranked: false })).toBe('repeat');
    expect(labels.runLabel({ checked: true, ranked: true, customSeed: true })).toBe('custom');
    expect(labels.runLabel({ checked: false, ranked: true })).toBe('local');
    // A seed of one's own beats everything: it counts nowhere.
    expect(labels.runLabel({ checked: false, ranked: false, customSeed: true })).toBe('custom');
  });

  it('says in both languages that the attempt is spent at the start and that an own seed counts for nothing', () => {
    for (const words of [FORUM_EN.label, FORUM_RU.label]) {
      expect(words.attemptNote.length).toBeGreaterThan(20);
      expect(words.customNote.length).toBeGreaterThan(20);
    }
    expect(FORUM_RU.label.customNote).toContain('не идёт');
    expect(FORUM_RU.label.counted).toBe('зачёт');
    expect(FORUM_RU.label.repeat).toBe('повтор');
    expect(FORUM_RU.label.custom).toBe('свой сид');
  });
});

describe('the forum stream’s texts', () => {
  it('have the same shape in Russian as in English, every line filled', () => {
    const shape = (value: unknown): unknown =>
      Array.isArray(value) ? value.map(shape) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shape(v)])) : typeof value;
    expect(shape(FORUM_RU)).toEqual(shape(FORUM_EN));
    const empty = (value: unknown): boolean =>
      typeof value === 'string' ? value.trim() === '' : Array.isArray(value) ? value.some(empty) : value && typeof value === 'object' ? Object.values(value).some(empty) : false;
    expect(empty(FORUM_RU)).toBe(false);
    expect(empty(FORUM_EN)).toBe(false);
    expect(FORUM_RU.guide.entries).toHaveLength(FORUM_EN.guide.entries.length);
  });

  it('give the guide the ten newcomer topics', () => {
    const titles = FORUM_RU.guide.entries.map((entry) => entry.title).join('|');
    for (const topic of ['Голод', 'Анкх', 'Проклятия', 'Кольцо богатства', 'Мимики', 'Очищение или Избавление', 'Колодец исцеления', 'Семена в котле', 'Очки', 'Испытания']) {
      expect(titles, topic).toContain(topic);
    }
  });

  it('state the numbers the game’s rules have: hunger, the score, the challenges', () => {
    const text = FORUM_RU.guide.entries.map((entry) => entry.text).join(' ');
    // Hunger.HUNGRY and STARVING; the rations; the score's parts and caps; the challenge multipliers up to eight.
    for (const part of ['300', '450', '900', '× 65', '50 000', '20 000', '×1,25', '×1,55', '×5,95', '30%']) expect(text, part).toContain(part);
  });

  it('use the verbs of the game: no «Да»/«Нет» left on the confirmations', () => {
    const { ruStrings, enStrings } = i18n;
    const answers = [
      ruStrings.jumpYes, ruStrings.jumpNo, ruStrings.danger.yes, ruStrings.danger.no, ruStrings.alch.trinketYes, ruStrings.alch.trinketNo,
      ruStrings.staffImbueYes, ruStrings.staffImbueNo, ruStrings.dismissYes, ruStrings.dismissNo, ruStrings.hero.yes, ruStrings.hero.no,
      ...Object.values(FORUM_RU.verbs), FORUM_RU.ask.putOn, FORUM_RU.ask.drink, FORUM_RU.ask.cancel,
      enStrings.jumpYes, enStrings.jumpNo, enStrings.danger.yes, enStrings.danger.no, enStrings.dismissYes, enStrings.dismissNo, enStrings.hero.yes, enStrings.hero.no,
    ];
    for (const answer of answers) expect(answer, answer).not.toMatch(/^(да|нет|yes|no)\b/i);
  });
});

describe('traps named in the question before a step', () => {
  it('every trap that can lie in sight has a name and an effect in Shattered’s words', () => {
    // The ones without a name of their own: Tengu’s hidden darts, the vault’s inactive flames; the question then falls back to «Trap».
    const nameless = new Set<string>(['tenguDart', 'vaultFlame']);
    for (const kind of Object.keys(TRAPS) as TrapKind[]) {
      const warning = names.trapWarning(kind);
      if (nameless.has(kind)) continue;
      expect(warning, kind).not.toBeNull();
      expect(warning!.name.length, kind).toBeGreaterThan(2);
      expect(warning!.effect.length, kind).toBeGreaterThan(20);
      // One paragraph: the rest of a description is not the question.
      expect(warning!.effect, kind).not.toContain('\n');
    }
  });

  it('the legend’s colour families agree with the colours Shattered gives its traps', () => {
    const legend = FORUM_RU.trapColours;
    const family = (kind: TrapKind): string => legend[names.trapFamily(TRAPS[kind].color)]![0];
    expect(family('blazing')).toBe('оранжевый');
    expect(family('shocking')).toBe('жёлтый');
    expect(family('toxic')).toBe('зелёный');
    expect(family('teleportation')).toBe('бирюзовый');
    expect(family('cursing')).toBe('фиолетовый');
    expect(family('chilling')).toBe('белый');
    expect(family('corrosion')).toBe('серый');
    expect(family('alarm')).toBe('красный');
    // The spent black ones are in no family.
    expect(names.trapFamily(TRAP_COLOR.BLACK)).toBe(-1);
  });
});

describe('the death window', () => {
  const HAZARDS = [
    'poison', 'burning', 'ooze', 'lightning', 'gripping', 'hunger', 'bones', 'gas', 'fall', 'deferred', 'bleeding', 'dry', 'berserk', 'multiplicity', 'bomb', 'chill',
    'magic', 'holy', 'chalice', 'noRose', 'wand', 'corrosion', 'corruption', 'knockback', 'lifeLink', 'electricity', 'geyser', 'psionic', 'arcaneBomb', 'flashbang',
    'shrapnel', 'rage', 'lifelink', 'master', 'rocks', 'king', 'link',
  ];

  it('names every hazard that can kill the hero, not the raw word', () => {
    for (const hazard of HAZARDS) expect(death.causeName(hazard), hazard).not.toBe(hazard);
    expect(death.causeName('rat')).not.toBe('rat');
    expect(death.causeName(null)).toBe('');
  });

  it('explains hunger, bleeding, deferred damage and a trap in a line', () => {
    for (const cause of ['hunger', 'bleeding', 'deferred', 'gripping', 'poison', 'fall']) expect(death.causeNote(cause), cause).not.toBe('');
    expect(death.causeNote('rat')).toBe('');
  });

  it('counts what the ankh takes: the stacks in the pack but not the keys, and the gold', () => {
    const { hero } = setup();
    hero.items = [createItem('potion.healing'), createItem('key.iron'), createItem('scroll.upgrade')];
    hero.gold = 120;
    expect(death.packWorth(hero)).toEqual({ items: 2, gold: 120 });
    expect(death.packLine(hero)).toContain('120');
  });
});
