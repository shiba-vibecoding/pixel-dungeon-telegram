import { type Floor, type Hero, isAlive, isChampionsWave, type Mob, type World } from '@pd/core';

/*
 * Shattered Pixel Dungeon's soundtrack (by Lumine Haaristo): which music plays where, as Shattered
 * switches it. Nothing here plays anything; audio.ts does, from what this decides.
 *
 * Shattered's Music plays either one track, looping (Music.play), or a list of tracks one after
 * another (Music.playTracks): each track of the list goes into the queue with its chance, in order,
 * and when the queue runs out it is drawn again. The title has its two themes; each region its
 * three tracks (the first and second a little likelier, all six entries of the list drawn in
 * turn); the region's *tense* track plays while its quest is under way (the sad ghost's in the
 * sewers, the old wandmaker's in the prison) and all the way up with the Amulet; a boss level is
 * silent until its fight, has the boss's track while the floor is sealed and its finale once the
 * boss is bleeding (BossHealthBar.bleed), and falls silent when the boss falls, until the hero
 * comes back to it; Yog-Dzewa's fall brings the dungeon's finale, which also greets the hero
 * on the Amulet's floor.
 */

/** Shattered's tracks (Assets.Music), the names of their files. */
export type Ost =
  | 'theme_1' | 'theme_2' | 'theme_finale'
  | 'sewers_1' | 'sewers_2' | 'sewers_3' | 'sewers_tense' | 'sewers_boss'
  | 'prison_1' | 'prison_2' | 'prison_3' | 'prison_tense' | 'prison_boss'
  | 'caves_1' | 'caves_2' | 'caves_3' | 'caves_tense' | 'caves_boss' | 'caves_boss_finale'
  | 'city_1' | 'city_2' | 'city_3' | 'city_tense' | 'city_boss' | 'city_boss_finale'
  | 'halls_1' | 'halls_2' | 'halls_3' | 'halls_tense' | 'halls_boss' | 'halls_boss_finale';

/** One track, looping (Music.play), or a list in turn (Music.playTracks: no shuffle anywhere it is used). */
export type Tune = { readonly loop: Ost } | { readonly tracks: readonly Ost[]; readonly chances: readonly number[] };

export const REGIONS = ['sewers', 'prison', 'caves', 'city', 'halls'] as const;
export type RegionName = (typeof REGIONS)[number];

/** TitleScene (and the rankings, the journal, the changes): the two themes in turn. */
export const TITLE: Tune = { tracks: ['theme_1', 'theme_2'], chances: [1, 1] };
/** AmuletScene and SurfaceScene, the run won: the same two, the second first. */
export const VICTORY: Tune = { tracks: ['theme_2', 'theme_1'], chances: [1, 1] };
/** LastLevel; HallsBossLevel once Yog-Dzewa has fallen; the sewers' first floor on the way out with the Amulet. */
export const FINALE: Tune = { loop: 'theme_finale' };

/** SewerLevel.SEWER_TRACK_LIST and its chances (the other regions' lists are the same shape). */
const TRACK_CHANCES: readonly number[] = [1, 1, 0.5, 0.25, 1, 0.5];

/** A region's three tracks in turn (SewerLevel.SEWER_TRACK_LIST, PrisonLevel.PRISON_TRACK_LIST...). */
export function regionTracks(region: number): Tune {
  const name = REGIONS[Math.max(0, Math.min(4, region))]!;
  const [one, two, three] = [`${name}_1`, `${name}_2`, `${name}_3`] as Ost[];
  return { tracks: [one!, two!, two!, one!, three!, three!], chances: TRACK_CHANCES };
}

export const tense = (region: number): Tune => ({ loop: `${REGIONS[Math.max(0, Math.min(4, region))]!}_tense` as Ost });

/** The boss's track, or its finale (the sewers and the prison have none: the boss's track goes on). */
export function bossTune(region: number, finale: boolean): Tune {
  const name = REGIONS[Math.max(0, Math.min(4, region))]!;
  return { loop: (finale && region >= 2 ? `${name}_boss_finale` : `${name}_boss`) as Ost };
}

/** Every track a tune may play. */
export const tracksOf = (tune: Tune): readonly Ost[] => ('loop' in tune ? [tune.loop] : tune.tracks);

/**
 * Music.playTracks: two lists are the same if one is the other shifted (the title's themes and the
 * victory's are one list), and Music.play: the same track. The same music goes on rather than starting over.
 */
export function sameTune(a: Tune | null, b: Tune | null): boolean {
  if (a === null || b === null) return a === b;
  if ('loop' in a || 'loop' in b) return 'loop' in a && 'loop' in b && a.loop === b.loop;
  const n = a.tracks.length;
  if (n !== b.tracks.length) return false;
  for (let ofs = 0; ofs < n; ofs++) {
    let same = true;
    for (let j = 0; j < n && same; j++) {
      const i = (j + ofs) % n;
      same = b.tracks[i] === a.tracks[j] && b.chances[i] === a.chances[j];
    }
    if (same) return true;
  }
  return false;
}

/** Music's track queue: each track of the list with its chance, in order, drawn again when it runs out. */
export class TrackQueue {
  private queue: Ost[] = [];

  constructor(private readonly tune: Tune, private readonly random: () => number = Math.random) {}

  /** The track to play next (a lone track: always itself). Null only if a whole draw came up empty twice. */
  next(): Ost | null {
    if ('loop' in this.tune) return this.tune.loop;
    for (let tries = 0; tries < 2 && this.queue.length === 0; tries++) this.draw();
    return this.queue.shift() ?? null;
  }

  /** What follows the track now playing, without taking it (to have it ready in time). */
  peek(): Ost | null {
    if ('loop' in this.tune) return this.tune.loop;
    if (this.queue.length === 0) this.draw();
    return this.queue[0] ?? null;
  }

  private draw(): void {
    const tune = this.tune;
    if ('loop' in tune) return;
    tune.tracks.forEach((track, i) => {
      if (this.random() < tune.chances[i]!) this.queue.push(track);
    });
  }
}

/*
 * Where the hero is: what plays (Level.playLevelMusic of each level).
 */

/** The bosses whose levels have their music (Goo, Tengu, DM-300, the Dwarf King, Yog-Dzewa). */
export const MUSIC_BOSSES: ReadonlySet<string> = new Set(['goo', 'tengu', 'dm300', 'king', 'yog']);

/**
 * Seam for the bosses stream: a boss level's fight state, `Floor.boss` (bosses/state.ts) — Level.locked
 * (sealed while the fight lasts), BossHealthBar.isBleeding (`bleed`, the music's finale) and
 * BossHealthBar.isAssigned (`bar`). Read loosely, so that this builds before and after it lands.
 */
interface BossFloorState {
  locked?: boolean;
  bleed?: boolean;
  bar?: string;
}
export function bossFloorOf(floor: object | undefined): BossFloorState | undefined {
  return floor && 'boss' in floor && typeof floor.boss === 'object' && floor.boss !== null ? (floor.boss as BossFloorState) : undefined;
}

/** What the client has seen of the boss fight on the hero's depth (from its effects). */
export interface FightSeen {
  /** The boss noticed the heroes ('yell' notice, or the bosses stream's `bossFight` start) and is not yet slain. */
  fighting: boolean;
  /** The bosses stream's `bossFight` finale (BossHealthBar.bleed), until the fight ends. */
  finale: boolean;
  /** The boss fell while the hero was here: the music faded out (Yog-Dzewa's: into the finale) until the hero leaves. */
  slain: string | null;
}

/**
 * Seam for the levels stream (Shattered's quests): Ghost.Quest.active() — given, its boss not yet beaten
 * (`processed`), on the hero's depth. Our errands: the curse is beaten when it is broken, the fetid rat when
 * it is dead, the rose when it has dropped.
 */
export function ghostQuestActive(world: World, hero: Hero): boolean {
  const quest = world.quest;
  if (!quest || !quest.given || quest.done || quest.depth !== hero.depth) return false;
  // Ghost.Quest.active: its foe is still to be slain.
  return !quest.processed;
}

/**
 * Seam for the levels stream: Wandmaker.Quest.active() — Shattered's errands play the prison's tense track
 * while the hero is cursed by the corpse dust (carries it), at the ritual site with the candles, or in the
 * rot garden with its heart alive. Of ours, the corpse dust is the same errand.
 */
export function wandQuestActive(world: World, hero: Hero): boolean {
  const quest = world.wandQuest;
  if (!quest || !quest.given || !quest.wand1 || quest.depth !== hero.depth) return false;
  if (quest.type === 1) return hero.items.some((item) => item.kind === 'quest.dust');
  if (quest.type === 3) return world.floors[hero.depth]?.mobs.some((mob) => mob.kind === 'rotHeart' && isAlive(mob)) ?? false;
  return quest.ritualPos !== undefined;
}

const bossOn = (floor: Floor | undefined): Mob | undefined =>
  floor?.mobs.find((mob) => MUSIC_BOSSES.has(mob.kind) && isAlive(mob));

/**
 * Level.playLevelMusic for the hero's level: a tune, or silence (Music.end). `region` is the level's region
 * (0 sewers ... 4 demon halls; the arena's by tier).
 */
export function placeTune(world: World, hero: Hero, region: number, seen: FightSeen): Tune | null {
  const depth = hero.depth;
  const floor = world.floors[depth];
  const amulet = world.amuletTaken === true;

  // The arena of waves (ours): the tier's tracks, a boss's or the champions' wave the region's boss track.
  if (world.arena) {
    if (seen.fighting || (world.arena.phase === 'fight' && isChampionsWave(world.arena.wave))) return bossTune(region, seen.finale);
    return regionTracks(region);
  }

  // LastLevel: the finale, and silence once the Amulet is taken.
  if (depth >= 26) return amulet ? null : FINALE;

  if (depth % 5 === 0 && depth <= 25) {
    // The boss levels. While the fight lasts: the boss's track, or its finale.
    const state = bossFloorOf(floor);
    const boss = bossOn(floor);
    const locked = state?.locked ?? (seen.fighting || (boss !== undefined && boss.state === 'hunting' && boss.enemySeen));
    if (locked && (depth !== 25 || state === undefined || state.bar !== undefined)) {
      return bossTune(region, state?.bleed ?? seen.finale);
    }
    // The boss just fell: the music faded out; Yog-Dzewa's fall brings the finale (HallsBossLevel.unseal).
    if (seen.slain !== null) return seen.slain === 'yog' && !amulet ? FINALE : null;
    // Before the fight (the boss still waits), and the halls' with the Amulet taken: silence.
    if (boss !== undefined || (depth === 25 && amulet)) return null;
    return regionTracks(region);
  }

  // The regular levels: on the way up with the Amulet, the tense track (the sewers' first floor, the finale).
  if (amulet) return region === 0 && depth === 1 ? FINALE : tense(region);
  if (region === 0 && ghostQuestActive(world, hero)) return tense(0);
  if (region === 1 && wandQuestActive(world, hero)) return tense(1);
  return regionTracks(region);
}

/**
 * How long the music takes to fade from one to the next (seconds), as Shattered fades it: half a second into a
 * boss's finale, five as a boss falls, a second as a quest begins or ends, else a crossfade of our own.
 */
export function fadeFor(from: Tune | null, to: Tune | null): number {
  const loopOf = (tune: Tune | null): string => (tune && 'loop' in tune ? tune.loop : '');
  if (loopOf(to).endsWith('_boss_finale') && loopOf(from).endsWith('_boss')) return 0.5;
  if (loopOf(from).endsWith('_boss') || loopOf(from).endsWith('_boss_finale')) return 5;
  if (loopOf(to).endsWith('_tense') || loopOf(from).endsWith('_tense')) return 1;
  return 1.5;
}

/*
 * The fallback: where a track cannot be decoded (iOS WebViews and Ogg Vorbis), the music that was here before
 * Shattered's: the original's two tunes from files, and the tunes played by music.ts.
 */

export type Fallback = 'theme' | 'game' | 'prison' | 'caves' | 'city' | 'halls' | 'boss';

export function fallbackFor(track: Ost): Fallback {
  if (track.startsWith('theme')) return 'theme';
  if (track.includes('_boss')) return 'boss';
  const region = track.slice(0, track.indexOf('_')) as RegionName;
  return region === 'sewers' ? 'game' : region;
}

/**
 * The tracks to fetch ahead on a depth (the game never waits for them): the rest of the region's, its boss's
 * near the boss's level, and the next region's first two near its stairs down.
 */
export function aheadOf(depth: number, region: number, arena: boolean): Ost[] {
  const own = tracksOf(regionTracks(region));
  const ahead: Ost[] = [...own];
  if (arena) return [...ahead, ...tracksOf(bossTune(region, false))];
  if (depth % 5 === 4 || depth % 5 === 0) ahead.push(...tracksOf(bossTune(region, false)));
  if (depth % 5 === 0 && depth < 25) ahead.push(...tracksOf(regionTracks(region + 1)).slice(0, 2));
  if (depth === 25 || depth === 26) ahead.push('theme_finale');
  return ahead.filter((track, i) => ahead.indexOf(track) === i);
}

/*
 * Beyond Shattered: the region's tense track in real danger too. An enemy hunting the hero for two seconds, or a
 * monster's blow landing, brings it in; it goes only after twelve seconds with nothing hunting, so a fight that
 * comes and goes does not toss the music back and forth.
 */

/** How long a hunt goes on before the music turns tense, and how long it stays after the last of it (ms). */
export const DANGER_ENTER_MS = 2000;
export const DANGER_LEAVE_MS = 12000;

export class DangerMeter {
  private huntedSince = -1;
  private lastThreat = Number.NEGATIVE_INFINITY;
  on = false;

  /** The danger now: `hunted`, an enemy in sight hunting the hero; `hurt`, a monster's blow landed this moment. */
  update(now: number, hunted: boolean, hurt: boolean): boolean {
    if (!hunted) this.huntedSince = -1;
    else if (this.huntedSince < 0) this.huntedSince = now;
    if (hunted || hurt) this.lastThreat = now;
    if (hurt || (hunted && now - this.huntedSince >= DANGER_ENTER_MS)) this.on = true;
    else if (this.on && now - this.lastThreat >= DANGER_LEAVE_MS) this.on = false;
    return this.on;
  }

  reset(): void {
    this.huntedSince = -1;
    this.lastThreat = Number.NEGATIVE_INFINITY;
    this.on = false;
  }
}

/**
 * In danger, the region's own tracks give way to its tense track; nothing else does (a boss's track, the finale,
 * a silent level, a quest's tense track are left as they are).
 */
export function withDanger(tune: Tune | null, region: number, danger: boolean): Tune | null {
  return danger && sameTune(tune, regionTracks(region)) ? tense(region) : tune;
}
