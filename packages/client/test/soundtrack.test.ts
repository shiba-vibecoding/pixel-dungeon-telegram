import { describe, expect, it } from 'vitest';
import { addHero, createItem, createMob, createWorld, type Floor, type Mob, type World } from '@pd/core';
import {
  aheadOf, bossTune, fadeFor, fallbackFor, type FightSeen, FINALE, placeTune, regionTracks, sameTune, tense, TITLE, TrackQueue,
  tracksOf, type Tune, VICTORY,
} from '../src/soundtrack';

const NO_FIGHT: FightSeen = { fighting: false, finale: false, slain: null };

/** A hero standing on `depth`, the floor there holding `mobs` (and a boss floor's state, if given). */
function standOn(depth: number, mobs: Mob[] = [], boss?: object): { world: World; hero: ReturnType<typeof addHero> } {
  const world = createWorld(7);
  const hero = addHero(world, { id: 'p', name: 'P', heroClass: 'warrior' });
  hero.depth = depth;
  world.floors[depth] = { mobs, ...(boss ? { boss } : {}) } as unknown as Floor;
  return { world, hero };
}

const region = (depth: number): number => Math.max(0, Math.min(4, Math.floor((depth - 1) / 5)));
const tuneAt = (world: World, hero: ReturnType<typeof addHero>, seen: FightSeen = NO_FIGHT): Tune | null =>
  placeTune(world, hero, region(hero.depth), seen);

describe("Shattered's music: Music.playTracks", () => {
  it('a region plays its three tracks in turn, the first two likelier (SewerLevel.SEWER_TRACK_LIST)', () => {
    const tune = regionTracks(1);
    expect(tracksOf(tune)).toEqual(['prison_1', 'prison_2', 'prison_2', 'prison_1', 'prison_3', 'prison_3']);
    expect('chances' in tune && tune.chances).toEqual([1, 1, 0.5, 0.25, 1, 0.5]);
  });

  it('the queue takes each track with its chance, in order, and draws again when it runs out', () => {
    // Every draw at 0.4: the chances of 1 and 0.5 pass, 0.25 does not.
    const queue = new TrackQueue(regionTracks(0), () => 0.4);
    const played = Array.from({ length: 10 }, () => queue.next());
    expect(played).toEqual([
      'sewers_1', 'sewers_2', 'sewers_2', 'sewers_3', 'sewers_3',
      'sewers_1', 'sewers_2', 'sewers_2', 'sewers_3', 'sewers_3',
    ]);
    // At 0.9 only the sure ones.
    const sure = new TrackQueue(regionTracks(4), () => 0.9);
    expect([sure.peek(), sure.next(), sure.next(), sure.next(), sure.next()]).toEqual(['halls_1', 'halls_1', 'halls_2', 'halls_3', 'halls_1']);
    // A lone track loops.
    expect(new TrackQueue(FINALE).next()).toBe('theme_finale');
  });

  it("the same list shifted is the same music (the title's and the victory's themes), and the same lone track", () => {
    expect(sameTune(TITLE, VICTORY)).toBe(true);
    expect(sameTune(TITLE, regionTracks(0))).toBe(false);
    expect(sameTune(regionTracks(2), regionTracks(2))).toBe(true);
    expect(sameTune(tense(2), { loop: 'caves_tense' })).toBe(true);
    expect(sameTune(tense(2), regionTracks(2))).toBe(false);
    expect(sameTune(null, null)).toBe(true);
    expect(sameTune(null, FINALE)).toBe(false);
  });
});

describe("Shattered's music: Level.playLevelMusic", () => {
  it('a regular level plays its region\'s tracks; the last shop and the deep halls the halls\'', () => {
    for (const [depth, name] of [[1, 'sewers'], [7, 'prison'], [12, 'caves'], [18, 'city'], [21, 'halls'], [24, 'halls']] as const) {
      const { world, hero } = standOn(depth);
      expect(tuneAt(world, hero)).toEqual(regionTracks(['sewers', 'prison', 'caves', 'city', 'halls'].indexOf(name)));
    }
  });

  it("the sad ghost's quest under way: the sewers' tense track, until its boss is beaten", () => {
    const { world, hero } = standOn(3);
    const quest: NonNullable<World['quest']> = { depth: 3, type: 'curse', given: true, dropped: false, killsLeft: 8, done: false, weapon: createItem('weapon.sword'), armor: createItem('armor.leather') };
    world.quest = quest;
    expect(tuneAt(world, hero)).toEqual(tense(0));
    // Elsewhere in the sewers, the region's tracks (Ghost.Quest.active: on its own depth).
    hero.depth = 2;
    world.floors[2] = { mobs: [] } as unknown as Floor;
    expect(tuneAt(world, hero)).toEqual(regionTracks(0));
    hero.depth = 3;
    quest.freed = true;
    expect(tuneAt(world, hero)).toEqual(regionTracks(0));
    // The fetid rat: tense until it has come out and been killed.
    world.quest = { ...quest, type: 'rat', freed: false };
    expect(tuneAt(world, hero)).toEqual(tense(0));
    world.quest.dropped = true;
    world.floors[3]!.mobs.push(createMob('#9', 'fetidRat', 40, 'hunting', 0));
    expect(tuneAt(world, hero)).toEqual(tense(0));
    world.floors[3]!.mobs[0]!.hp = 0;
    expect(tuneAt(world, hero)).toEqual(regionTracks(0));
    // Not yet given: nothing changes.
    world.quest = { ...quest, given: false };
    expect(tuneAt(world, hero)).toEqual(regionTracks(0));
  });

  it("the wandmaker's corpse dust carried: the prison's tense track", () => {
    const { world, hero } = standOn(8);
    world.wandQuest = { depth: 8, given: true, done: false, battle: createItem('wand.firebolt'), utility: createItem('wand.blink'), wants: 'dust' };
    expect(tuneAt(world, hero)).toEqual(regionTracks(1));
    hero.items.push(createItem('quest.dust'));
    expect(tuneAt(world, hero)).toEqual(tense(1));
    world.wandQuest.done = true;
    expect(tuneAt(world, hero)).toEqual(regionTracks(1));
  });

  it('a boss level: silent until the fight, the boss\'s track while it lasts, silent once the boss falls, then the region\'s', () => {
    const goo = createMob('#1', 'goo', 300, 'sleeping', 0);
    const { world, hero } = standOn(5, [goo]);
    expect(tuneAt(world, hero)).toBeNull();
    expect(tuneAt(world, hero, { ...NO_FIGHT, fighting: true })).toEqual(bossTune(0, false));
    // Seen hunting the heroes (after a reload, with no cry heard): the fight is on.
    goo.state = 'hunting';
    goo.enemySeen = true;
    expect(tuneAt(world, hero)).toEqual({ loop: 'sewers_boss' });
    goo.hp = 0;
    expect(tuneAt(world, hero, { fighting: false, finale: false, slain: 'goo' })).toBeNull();
    // Back on the level later: the region's tracks.
    expect(tuneAt(world, hero)).toEqual(regionTracks(0));
  });

  it("the bosses stream's floor state: sealed for the boss's track, bleeding for its finale (none for Goo and Tengu)", () => {
    const dm = createMob('#1', 'dm300', 300, 'hunting', 0);
    const { world, hero } = standOn(15, [dm], { locked: true, bleed: false });
    expect(tuneAt(world, hero)).toEqual({ loop: 'caves_boss' });
    (world.floors[15] as unknown as { boss: { bleed: boolean } }).boss.bleed = true;
    expect(tuneAt(world, hero)).toEqual({ loop: 'caves_boss_finale' });
    expect(bossTune(1, true)).toEqual({ loop: 'prison_boss' });
    expect(bossTune(3, true)).toEqual({ loop: 'city_boss_finale' });
    // Unsealed with the boss still about (not yet fought): silence.
    (world.floors[15] as unknown as { boss: { locked: boolean } }).boss.locked = false;
    expect(tuneAt(world, hero)).toBeNull();
    // The halls': sealed but with no health bar yet, silence (HallsBossLevel: locked && BossHealthBar.isAssigned).
    const yog = createMob('#2', 'yog', 300, 'passive', 0);
    const halls = standOn(25, [yog], { locked: true });
    expect(tuneAt(halls.world, halls.hero)).toBeNull();
    (halls.world.floors[25] as unknown as { boss: { bar: string } }).boss.bar = '#2';
    expect(tuneAt(halls.world, halls.hero)).toEqual({ loop: 'halls_boss' });
  });

  it("Yog-Dzewa's fall brings the dungeon's finale; the Amulet's floor has it, and is silent once it is taken", () => {
    const { world, hero } = standOn(25);
    expect(tuneAt(world, hero, { fighting: false, finale: false, slain: 'yog' })).toEqual(FINALE);
    expect(tuneAt(world, hero)).toEqual(regionTracks(4));
    const last = standOn(26);
    expect(tuneAt(last.world, last.hero)).toEqual(FINALE);
    last.world.amuletTaken = true;
    expect(tuneAt(last.world, last.hero)).toBeNull();
  });

  it('on the way up with the Amulet: every region\'s tense track, the halls\' boss level silent, the first floor the finale', () => {
    const halls = standOn(25);
    halls.world.amuletTaken = true;
    expect(tuneAt(halls.world, halls.hero)).toBeNull();
    for (const [depth, tune] of [[23, tense(4)], [17, tense(3)], [9, tense(1)], [4, tense(0)], [1, FINALE], [10, regionTracks(1)]] as const) {
      const { world, hero } = standOn(depth);
      world.amuletTaken = true;
      expect(tuneAt(world, hero)).toEqual(tune);
    }
  });

  it("fades as Shattered's: half a second into a finale, five as a boss falls, one for a quest's track, else a crossfade", () => {
    expect(fadeFor(bossTune(2, false), bossTune(2, true))).toBe(0.5);
    expect(fadeFor(bossTune(2, true), null)).toBe(5);
    expect(fadeFor(bossTune(4, false), FINALE)).toBe(5);
    expect(fadeFor(regionTracks(0), tense(0))).toBe(1);
    expect(fadeFor(tense(1), regionTracks(1))).toBe(1);
    expect(fadeFor(TITLE, regionTracks(0))).toBe(1.5);
  });

  it('where a track will not decode, the music from before: the original\'s tunes and the ones played here', () => {
    expect(fallbackFor('theme_2')).toBe('theme');
    expect(fallbackFor('sewers_3')).toBe('game');
    expect(fallbackFor('sewers_tense')).toBe('game');
    expect(fallbackFor('caves_1')).toBe('caves');
    expect(fallbackFor('city_boss_finale')).toBe('boss');
    expect(fallbackFor('halls_tense')).toBe('halls');
  });

  it("fetches ahead the region's tracks, the boss's near its level, the next region's past it", () => {
    expect(aheadOf(2, 0, false)).toEqual(['sewers_1', 'sewers_2', 'sewers_3']);
    expect(aheadOf(9, 1, false)).toEqual(['prison_1', 'prison_2', 'prison_3', 'prison_boss']);
    expect(aheadOf(10, 1, false)).toEqual(['prison_1', 'prison_2', 'prison_3', 'prison_boss', 'caves_1', 'caves_2']);
    expect(aheadOf(25, 4, false)).toContain('theme_finale');
  });
});
