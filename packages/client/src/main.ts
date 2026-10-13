import {
  type Action, adjacent, blockers, liveBlockers, distance, type Mob, trapAt, buyPrice, cellX, cellY, createHero, createWorld, type Effect, exploredCells, F, findPath, hasFlag,
  HEAP_SPRITES,
  type Hero, type Item, type Level,
  type Bones, hasAmulet, heroById, type HeroClass, leaveBones, HEIGHT, isAlive, isHungry, isStarving, itemDef, itemSprite, levelAt, mobById, type MobKind,
  ORE_WANTED, type PlanStep, PLANT_KINDS, type SmithLine, T,
  visibleCells, chargesKnown, WIDTH,
  type World, charAt, swapsWithHero,
} from '@pd/core';
import * as core from '@pd/core';
import './ui.css';
import './game.css';
import { mobDescription, plantText, tileText, wellText } from './examine';
import { quickIndex, quickUse } from './quickslot';
import { fx } from './fx';
import { ambientFx, effectFx, lightsFor, regionFx, stepFx } from './fx-events';
/** The visual clock's last reading, for frame-to-frame particle steps. */
let lastVisual = 0;
/** When my hero fell, on the visual clock, or 0 while alive. */
let fallenAt = 0;
import { adoptBadges, BADGES, type BadgeId, badgeText, checkBadges, countGame, earnedBadges, reloadBadges } from './badges';
import { pullCloud, pushCloud } from './cloud';
import { audio } from './audio';
import { type ArenaHud, heroBuffs, Hud, type HudStatus, type QuickState } from './hud';
import { arenaBest, recordArena, showArenaEnd, showArenaReward } from './arenaui';
import { ArenaView } from './arenaview';
import { levelRegion } from './sprites';
import { capitalize, t } from './i18n';
import { chargesOf, itemInfo, itemName, wearOf } from './itemtext';
import { bakeLevel, type Camera, patchLevel, render } from './render';
import {
  armorTier, closeOverlay, hideOverlay, overlayOpen, windowOverMap, portrait, setAssets, showBackpack, showConfirm, showReforge, showHelp, showHero,
  refreshBackpack, showHistory, showMenu, showRankings, showAmulet, showQuest, showRunEnd, showBadges, showInfo, showSell, showSign, showTitle, showTrade, showWaiting, slot, toast, type ShareChoice,
} from './screens';
import { profileCard, rankingBlock, showBoards, trophyText } from './rankui';
import { mart } from './mart';
import { eraseDevice, showChallenges, showJournal, showSettings } from './meta';
import { netlog, sendNetlog } from './netlog';
import { looksRows, setBadgeImages, showMart, showTreat } from './martui';
import { quality } from './quality';
import { type Launch, Motion } from './motion';
import { Scenery } from './scenery';
import { Feedback } from './feedback';
import { Finds, MapControls } from './mapui';
import { type HintId, hints } from './hints';
import { lookIndex, preloadSheets, regionIndex } from './worldsheets';
import { type ShareCard, shareCard, sharePicture, storyCard } from './share';
import { rankings, recordRun, runScore } from './rankings';
import { type CheckOptions, forgetSolo, loadCheck, loadSolo, type Session, soloSession, staleSolo } from './session';
import { type BoardKind, type Profile, type RunMeta, type RunSlot, runApi, type SyncAnswer } from './checked';
import { loadAssets } from './sprites';
import { CoopMarks } from './coop-marks';
import {
  backButton, haptic, initData, initTelegram, inTelegram, launchedForDaily, onLayoutChange, platform,
  shareArena, shareDaily, telegramName, appLink, canShareMessage, canShareStory, shareMessage, shareStory, requestWriteAccess,
  homeScreenStatus, addToHomeScreen,
} from './telegram';
import { startReporting } from './report';
import { STEP_MS, TILE, View } from './view';

/*
 * Pixel Dungeon client: title screen, then a solo run (kept in local storage),
 * the daily dungeon or the arena of waves; the server (VITE_SERVER_URL) keeps the boards.
 */

const HERO_CLASSES: readonly HeroClass[] = ['warrior', 'mage', 'rogue', 'huntress'];
const SOLO_SLOT = 'pd-solo';
/** The arena of waves' solo run has a slot of its own: it never takes the dungeon run's place. */
const ARENA_SLOT = 'pd-arena';
const SERVER: string = import.meta.env.VITE_SERVER_URL ?? (import.meta.env.DEV ? `ws://${location.hostname}:8787` : '');

initTelegram('#1f1d1d');
// What goes wrong reaches whoever looks after the game (report.ts): never who, only where.
startReporting(import.meta.env.DEV ? '' : SERVER, () => {
  const world = session?.world;
  const me = world && heroById(world, session!.myId);
  return {
    platform, mode: session ? (session.mode === 'online' ? 'coop' : dailyRun ? 'daily' : 'solo') : 'title',
    ...(me ? { depth: me.depth, turn: world!.turn, heroes: world!.heroes.length } : {}),
    screen: `${innerWidth}x${innerHeight}@${devicePixelRatio}`,
  };
});

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
/*
 * The loading screen (the design's .pd-loading): the logo, a running warrior,
 * a bar in steps and a tip. If the sprites cannot be had, a window says so
 * and offers to try again.
 */
const loading = document.getElementById('loading')!;
const progress = document.createElement('div');
const progressText = document.createElement('p');
{
  const tips = [2, 7, 8, 9, 10];
  const tip = t.helpText[tips[Math.floor(Math.random() * tips.length)]!] ?? '';
  loading.className = 'pd-loading';
  loading.setAttribute('aria-busy', 'true');
  progress.className = 'pd-progress';
  progress.setAttribute('role', 'progressbar');
  progressText.className = 'pd-loading-text';
  progressText.textContent = t.loadingSprites(0);
  const logo = Object.assign(document.createElement('div'), { className: 'pd-logo' });
  logo.append(Object.assign(document.createElement('img'), { src: 'assets/banner-title.png', alt: 'Pixel Dungeon' }));
  const runner = Object.assign(document.createElement('div'), { className: 'pd-runner' });
  const hint = Object.assign(document.createElement('p'), { className: 'pd-loading-tip' });
  hint.append(Object.assign(document.createElement('b'), { textContent: t.tip }), ` ${tip}`);
  loading.replaceChildren(logo, runner, progress, progressText, hint);
}
const assets = await loadAssets(`${import.meta.env.BASE_URL}assets/`, (done) => {
  const percent = Math.round(done * 100);
  progress.style.setProperty('--v', String(done));
  progressText.textContent = t.loadingSprites(percent);
}).catch((error: unknown) => {
  const box = document.createElement('section');
  box.className = 'pd-window narrow';
  box.setAttribute('role', 'alertdialog');
  const retry = Object.assign(document.createElement('button'), { className: 'pd-button primary', textContent: t.retry, onclick: () => location.reload() });
  box.append(
    Object.assign(document.createElement('div'), { className: 'pd-error-icon' }),
    Object.assign(document.createElement('h2'), { className: 'pd-heading center', textContent: t.noConnection }),
    Object.assign(document.createElement('p'), { className: 'pd-info center', textContent: t.noConnectionText }),
    retry,
    Object.assign(document.createElement('p'), { className: 'pd-note center', textContent: String(error instanceof Error ? error.message : error) }),
  );
  const overlay = document.getElementById('overlay')!;
  overlay.replaceChildren(box);
  overlay.classList.add('open');
  throw error;
});
await Promise.all([document.fonts.load('18px Galmuri11'), document.fonts.load('15px Galmuri9')]).catch(() => undefined);
loading.remove();
setAssets(assets);

const view = new View(assets);
/** The world answering touch: doors, grass, water, what falls and what is taken (motion.ts). */
const motion = new Motion(assets);
/** The map answering a tap: the cell aimed at, the way there, a cross where there is none (feedback.ts). */
const feedback = new Feedback();
/** Each region's life: torches, drips, veins, lanterns, lava, wells, trap plates (scenery.ts). */
const scenery = new Scenery();
const hud = new Hud({
  hero: () => openHero(),
  menu: () => openMenu(),
  wait: () => {
    aim = null;
    examining = false;
    act('wait');
  },
  rest: () => startResting(),
  search: () => {
    aim = null;
    examining = false;
    act('search');
  },
  // The info button: the next tap on the map examines that cell.
  examine: () => {
    aim = null;
    examining = !examining;
  },
  quick: () => {
    examining = false;
    toggleQuickslot(0);
  },
  quick2: () => {
    examining = false;
    toggleQuickslot(1);
  },
  journal: () => openJournal(),
  settings: () => settings(hideOverlay),
  backpack: () => {
    examining = false;
    openBackpack();
  },
  history: () => showHistory(view.log, hideOverlay),
  buff: (name, turns) => toast(turns ? `${t.buffs[name]} (${t.turnsLeft(turns)})` : t.buffs[name]),
  mate: (id) => {
    const hero = session?.world && heroById(session.world, id);
    // (The arena has no depths to tell.)
    if (hero) toast(`${hero.name} · ${t.classes[hero.heroClass]}${session?.world?.arena ? '' : ` · ${t.newDepth(hero.depth)}`}`, { tone: 'ally' });
  },
  // The arena's «To battle!»; pressed again before the wave comes, not ready after all.
  fight: () => {
    const world = session?.world;
    const me = world && heroById(world, session!.myId);
    if (!world?.arena || !me || world.arena.phase !== 'rest') return;
    send(world.arena.ready.includes(me.id) ? { type: 'arenaReady', cancel: true } : { type: 'arenaReady' }, performance.now());
  },
});
/** The arena of waves dressed: sand, banners, gates, braziers, the crowd (arenaview.ts). */
const arenaView = new ArenaView();
/** The arena's reward window is up (it closes by itself if the wave starts meanwhile). */
let rewardOpen = false;
/**
 * The middle of where a level actually lies, world pixels: the grid is bigger than a level for
 * one hero (core geometry.ts), and the rest of it is solid rock.
 */
const middles = new WeakMap<Level, { x: number; y: number }>();
function levelMiddle(level: Level): { x: number; y: number } {
  let middle = middles.get(level);
  if (!middle) {
    let left = WIDTH;
    let right = 0;
    let top = HEIGHT;
    let bottom = 0;
    for (let i = 0; i < level.map.length; i++) {
      const terrain = level.map[i]!;
      if (terrain === T.WALL || terrain === T.WALL_DECO) continue;
      left = Math.min(left, i % WIDTH);
      right = Math.max(right, i % WIDTH);
      top = Math.min(top, Math.trunc(i / WIDTH));
      bottom = Math.max(bottom, Math.trunc(i / WIDTH));
    }
    middle = { x: ((left + right + 1) / 2) * TILE, y: ((top + bottom + 1) / 2) * TILE };
    middles.set(level, middle);
  }
  return middle;
}

/** The map's buttons over the log (zoom, the whole level, back to the hero) and the finds' stack (mapui.ts). */
const mapControlsActions = {
  zoomIn: () => zoomTo(Math.round(zoom.target) + 1, null),
  zoomOut: () => zoomTo(Math.round(zoom.target) - 1, null),
  whole: () => {
    // Out as far as it goes, the level's middle in the middle of the view.
    const world = session?.world;
    const me = world && heroById(world, session!.myId);
    zoomTo(zoom.min, null);
    if (me) {
      const middle = levelMiddle(levelAt(world, me.depth));
      pan.x = middle.x - (cellX(me.pos) * TILE + TILE / 2);
      pan.y = middle.y - (cellY(me.pos) * TILE + TILE / 2);
      pan.home = false;
    }
  },
  home: () => {
    pan.home = true;
  },
  attack: () => {
    const world = session?.world;
    const me = world && heroById(world, session!.myId);
    const target = world && me ? attackTarget(world, me) : null;
    if (!world || !me || !target || session!.busy) return;
    walk.reset();
    if (adjacent(me.pos, target.pos)) send({ type: 'attack', target: target.id }, performance.now());
    else walk.chase = target.id;
  },
  resume: () => {
    const goal = walk.goal;
    if (goal !== null) tapCell(goal);
  },
};
const mapControls = new MapControls(document.getElementById('ui')!, mapControlsActions);

/** The very first game: «tap where to go» over the hero until the first step is taken (kept on this device). */
let coach: HTMLElement | null = null;
let coached = stored('pd-moved') === '1';
function coachMove(me: Hero): void {
  if (coached) {
    coach?.remove();
    coach = null;
    return;
  }
  if (!coach) {
    coach = document.createElement('div');
    coach.className = 'pd-coach';
    coach.textContent = t.moveHint;
    document.getElementById('ui')!.append(coach);
  }
  const x = (cellX(me.pos) * TILE + TILE / 2 - camera.x) * camera.zoom / (canvas.width / canvas.clientWidth);
  const y = (cellY(me.pos) * TILE - camera.y) * camera.zoom / (canvas.height / canvas.clientHeight);
  coach.style.left = `${Math.round(x / hud.scale)}px`;
  coach.style.top = `${Math.round(y / hud.scale)}px`;
}

/**
 * AttackIndicator: the enemy to go for — one in sight that is after me, else the nearest awake
 * one, else the nearest asleep (a sneak attack); never a passive one (a shopkeeper, the ghost).
 */
function attackTarget(world: World, me: Hero): Mob | null {
  const visible = visibleCells(world, me.depth);
  const foes = (world.floors[me.depth]?.mobs ?? []).filter((m) => m.state !== 'passive' && visible[m.pos] && m.hp > 0 && !m.image);
  const rank = (m: Mob): number => (m.enemy === me.id && m.state === 'hunting' ? 0 : m.state === 'sleeping' ? 2 : 1) * 1000 + distance(m.pos, me.pos);
  return foes.sort((a, b) => rank(a) - rank(b) || (a.id < b.id ? -1 : 1))[0] ?? null;
}
const finds = new Finds(document.getElementById('ui')!);
/** Something was picked up since the backpack was last opened. */
let newLoot = false;

// Pixel-Mart: what this player owns, from the server; what they wear goes to the party.
void mart.refresh(SERVER);
setBadgeImages(Object.fromEntries(BADGES.map((badge) => [badge.id, badge.image])));
/** The class my hero plays in the current run. */
const myClass = (): HeroClass => (session?.world && heroById(session.world, session.myId)?.heroClass) || heroClass;
const putOnLook = (): void => session?.wear(mart.look(myClass()));
mart.onChange(putOnLook);
const camera: Camera = { x: 0, y: 0, zoom: 2 };

/* Preferences */

function stored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function store(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Not kept; fine.
  }
}

function forget(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Nothing kept anyway.
  }
}

// ?hero= and ?name= override the saved choices (handy for testing several players).
const query = new URLSearchParams(location.search);
const savedClass = query.get('hero') ?? stored('pd-class') ?? '';
let heroClass: HeroClass = (HERO_CLASSES as readonly string[]).includes(savedClass) ? (savedClass as HeroClass) : 'warrior';
let playerName = query.get('name') ?? stored('pd-name') ?? '';

function playerId(): string {
  // ?player= lets two tabs of one browser act as different players in development.
  const forced = new URLSearchParams(location.search).get('player');
  if (forced) return forced;
  let id = stored('pd-player-id');
  if (!id) {
    id = crypto.randomUUID();
    store('pd-player-id', id);
  }
  return id;
}

/** Same seed for everyone on the same (UTC) day. */
const dailySeed = (): number => core.dailySeed(core.dayOf(Date.now()));

const randomSeed = (): number => Math.floor(Math.random() * 2 ** 31);

/* Sessions */

let session: Session | null = null;
let seenGeneration = -1;
let deathShown = -1;
/** My hero just jumped into a chasm: the next change of depth is a fall. */
let justFell = false;

function enterGame(next: Session, roomId: string | null, welcome = t.welcome): void {
  session?.close();
  session = next;
  session.hold = overlayOpen;
  liveArrival = null;
  seenGeneration = -1;
  deathShown = -1;
  walk.reset();
  audio.playMusic('game');
  // Telegram's back button opens the menu, or closes whatever window is open.
  backButton(() => (overlayOpen() ? closeOverlay() : openMenu()));
  hud.show(true);
  newLoot = false;
  putOnLook();
  view.log = [];
  view.say(welcome);
  hideOverlay();
  // The very first game opens with how to play.
  if (!stored('pd-seen-help')) {
    store('pd-seen-help', '1');
    showHelp(hideOverlay);
  }
}

/** The current run is the daily dungeon, whose results go to the leaderboard. */
let dailyRun = false;

/** Today's daily run has its own save slot, so a reload of the Mini App does not lose it. */
const dailySlot = (): string => `pd-daily-${new Date().toISOString().slice(0, 10)}`;

// Runs of past days are of no use any more.
try {
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith('pd-daily-') && key !== dailySlot()) localStorage.removeItem(key);
  }
} catch {
  // Storage unavailable: nothing to clean.
}

/** Where the device keeps the last fallen hero's bones, until a run lays them on their depth (bones.ts). */
const BONES_KEY = 'pd-bones';

/** Bones handed to the run being played, until it lays them. */
let bonesGiven = false;

function readBones(): Bones | null {
  try {
    const bones = JSON.parse(stored(BONES_KEY) ?? 'null') as Bones | null;
    bonesGiven = bones !== null;
    return bones;
  } catch {
    return null;
  }
}

/** Checked runs (checked.ts): in Telegram (and in development), runs come from the server, which checks them. */
const api = runApi(
  SERVER,
  () => (inTelegram ? { initData: initData() } : { id: playerId(), name: playerName.trim() || t.heroDefault }),
  import.meta.env.DEV,
);

/** Each device slot's run on the server. */
const SLOT_OF: Record<string, RunSlot> = { [SOLO_SLOT]: 'dungeon', [ARENA_SLOT]: 'arena' };
const slotOf = (key: string): RunSlot => SLOT_OF[key] ?? 'daily';

/** What a checked run needs: the server, its run, and how to get the next one in its slot. */
function checkFor(slot: RunSlot, meta: RunMeta, world?: World, log?: Action[]): CheckOptions {
  return {
    api: api!, meta, world, log,
    renew: async () => {
      const hero = session?.world?.heroes[0]?.heroClass ?? heroClass;
      const answer = await api!.start(slot, hero, slot === 'dungeon' && challengesOpen() ? challenges : 0);
      return typeof answer === 'string' ? null : answer;
    },
  };
}

/** A run in a slot: the one kept on this device (checked or not), else a new one, from the server when it can give one. */
async function startRun(key: string, mode: 'dungeon' | 'arena', fresh: boolean, welcome?: string): Promise<void> {
  const slot = slotOf(key);
  const name = playerName.trim() || telegramName() || t.heroDefault;
  const chosen = slot === 'dungeon' && challengesOpen() ? challenges : 0;
  const local = (): Session =>
    soloSession(
      key, heroClass, slot === 'daily' ? dailySeed : randomSeed, name, chosen, mode, slot === 'dungeon' ? readBones : undefined, false, undefined,
      slot === 'daily' ? core.dayOf(Date.now()) : undefined,
    );
  // The run being played is written out first: what the slot holds is read next.
  session?.close();
  session = null;
  if (fresh) forgetSolo(key);
  const kept = !fresh && loadSolo(key);
  const check = kept ? loadCheck(key) : null;
  // The daily dungeon is today's: yesterday's kept run is not carried on.
  const stale = check?.meta.date !== undefined && check.meta.date !== core.dayOf(Date.now());
  if (kept && check && !stale && api) {
    enterGame(soloSession(key, heroClass, randomSeed, name, 0, mode, undefined, false, checkFor(slot, check.meta, undefined, check.log)), null, welcome);
  } else if (kept && !check && !stale) {
    // A run begun before runs were checked, or without the server: it goes on, counting nowhere.
    enterGame(local(), null, welcome);
  } else if (api) {
    showWaiting(t.ranked.preparing);
    // Carried on from another device, or new.
    const carried = fresh || slot === 'daily' ? null : await api.get(slot);
    const answer = carried && typeof carried !== 'string' && carried.run && carried.world && !carried.world.over
      ? { run: carried.run, world: carried.world }
      : await api.start(slot, heroClass, chosen);
    if (answer === 'rules') {
      location.reload();
      return;
    }
    if (typeof answer === 'string') {
      toast(t.ranked.offlineStart);
      forgetSolo(key);
      enterGame(local(), null, welcome);
    } else {
      forgetSolo(key);
      enterGame(soloSession(key, heroClass, randomSeed, name, 0, mode, undefined, false, checkFor(slot, answer.run, answer.world)), null, welcome);
      if (!answer.run.ranked) toast(t.ranked.practice);
    }
  } else {
    forgetSolo(key);
    enterGame(local(), null, welcome);
  }
  dailyRun = slot === 'daily';
  // A run carried on may still hold bones not yet laid (on the device's own runs; the server's lay their own).
  const now = session as Session | null;
  if (slot === 'dungeon' && !now?.checked && now?.world?.bones && !now.world.bones.placed) bonesGiven = true;
}

function startSolo(mode: 'continue' | 'new' | 'daily'): void {
  const daily = mode === 'daily';
  void startRun(daily ? dailySlot() : SOLO_SLOT, 'dungeon', mode === 'new', daily ? todayRules(t.ranked.rulesWelcome) : undefined);
}

/** Today's rules of the daily dungeon (core daily.ts), in words: the hardship's name, the boon's name and what it gives. */
function todayRules(words: (hardship: string, boon: string, info: string) => string): string {
  const rules = core.dailyRules(core.dayOf(Date.now()));
  const index = core.CHALLENGES.findIndex((challenge) => challenge.mask === rules.challenge);
  const [boon, info] = t.ranked.boons[rules.boon] ?? [rules.boon, ''];
  return words(t.meta.challengeList[index]?.[0] ?? '', boon, info);
}

/** Challenges for the next new solo game (a bit mask, Challenges.MASKS), kept on this device. */
let challenges = Number(stored('pd-challenges')) || 0;
/** Challenges open with the first victory, as the original's VICTORY badge opens them. */
const challengesOpen = (): boolean => earnedBadges().has('victory');

/** Erases this device's runs, badges and settings, and starts the page afresh. */
function resetDevice(): void {
  // The run must not be written back on the way out.
  session?.close();
  session = null;
  eraseDevice();
  location.reload();
}

function settings(onClose: () => void): void {
  showSettings({
    onClose, onEffects: () => resize(), onReset: resetDevice,
    ...(api && inTelegram ? { reminders: { on: stored('pd-notify') === 'on', set: (on: boolean) => void setReminders(on) } } : {}),
  });
}

/** The bot's reminders on or off: on asks Telegram to let the bot write first; false if it did not come about. */
async function setReminders(on: boolean): Promise<boolean> {
  store('pd-notify-asked', '1');
  if (on && !(await requestWriteAccess())) return false;
  if (!(await api!.notify(on))) {
    toast(t.ranked.remindersFailed);
    return false;
  }
  store('pd-notify', on ? 'on' : 'off');
  if (on) toast(t.ranked.remindersOn);
  return true;
}

/**
 * Once the title knows the player, it may ask one thing, once each: after a daily dungeon begun,
 * whether the bot may remind them of the streak; from the third launch on, to put the game on
 * the phone's home screen.
 */
let askedThisLaunch = false;
function askOnTitle(): void {
  if (askedThisLaunch || overlayOpen() || !inTelegram) return;
  if (api && profile && profile.streak.count >= 1 && !stored('pd-notify-asked')) {
    askedThisLaunch = true;
    showConfirm(t.ranked.remindersAsk, t.ranked.remindersAskText, t.ranked.remindersYes, t.ranked.remindersNo, () => {
      toTitle(false);
      void setReminders(true);
    }, () => {
      store('pd-notify-asked', '1');
      toTitle(false);
    });
    return;
  }
  if (openings >= 3 && !stored('pd-home-asked')) {
    askedThisLaunch = true;
    void homeScreenStatus().then((status) => {
      if (status !== 'missed' || overlayOpen() || session) return;
      store('pd-home-asked', '1');
      showConfirm(t.ranked.homeAsk, t.ranked.homeAskText, t.ranked.homeYes, t.ranked.notNow, () => {
        addToHomeScreen();
        toTitle(false);
      }, () => toTitle(false));
    });
  }
}

/** How many times the game has been opened on this device. */
const openings = ((): number => {
  const count = Number(stored('pd-launches') ?? 0) + 1;
  store('pd-launches', String(count));
  return count;
})();

/** The player as the server last told (checked.ts Profile); null until it has, or without checked runs. */
let profile: Profile | null = null;

/** The boards window; back to the title when closed. */
function openBoards(tab?: 'daily' | 'week' | 'arena' | 'all' | 'device'): void {
  showBoards({ api, device: rankings(), trophies: profile?.trophies, tab, onClose: toTitle });
}

/** Today's daily dungeon as the server last told: its attempt open, under way, or played (and its place). */
function dailyState(): { state: 'open' | 'going' | 'done'; place: number | null; total: number } | undefined {
  if (!profile) return undefined;
  const run = profile.runs.daily;
  const today = run?.date === profile.today && run.ranked ? run : null;
  const state = !profile.dailyDone ? 'open' : today && !today.over ? 'going' : 'done';
  return { state, place: profile.places.daily ?? null, total: profile.totals?.daily ?? 0 };
}

/** Trophies won since the device last looked: announced once each. */
function announceTrophies(trophies: Profile['trophies']): void {
  const seen = Number(stored('pd-trophies-seen') ?? 0);
  const fresh = trophies.filter((trophy) => trophy.at > seen);
  for (const trophy of fresh.slice(0, 3)) toast(t.ranked.newTrophy(trophyText(trophy)), { tone: 'badge' });
  if (fresh.length > 0) store('pd-trophies-seen', String(Math.max(...fresh.map((trophy) => trophy.at))));
}

/** Asks the server who the player is; the title shows their card once it answers. */
function refreshProfile(): void {
  void api?.me().then((answer) => {
    if (!answer) return;
    profile = answer;
    adoptBadges(answer.badges);
    announceTrophies(answer.trophies);
    if (!session && document.querySelector('.pd-title-screen')) {
      toTitle(false);
      askOnTitle();
    }
  });
}

function toTitle(ask = true): void {
  session?.close();
  session = null;
  // Nothing left half done: a walk, a shot being aimed, the look on the map.
  walk.reset();
  aim = null;
  examining = false;
  held.code = '';
  audio.playMusic('theme');
  audio.ambience(null);
  audio.muffle(false);
  backButton(null);
  hud.show(false);
  if (ask) refreshProfile();
  // The dungeon run kept on this device, or else on the server (played on another device).
  const away = profile?.runs.dungeon && !profile.runs.dungeon.over ? profile.runs.dungeon : null;
  const saved = loadSolo(SOLO_SLOT)?.heroes[0] ?? (away?.heroClass ? { heroClass: away.heroClass, lvl: away.lvl, depth: away.depth } : undefined);
  // A run an update can no longer carry on is not dropped unannounced.
  const stale = saved ? null : staleSolo(SOLO_SLOT);
  showTitle({
    heroClass,
    save: saved ? { heroClass: saved.heroClass, lvl: saved.lvl, depth: saved.depth } : null,
    askName: inTelegram ? null : playerName,
    onClass: (value) => {
      heroClass = value;
      store('pd-class', value);
    },
    onName: (value) => {
      playerName = value;
      store('pd-name', value);
    },
    onContinue: () => startSolo('continue'),
    // A new game over a saved one asks first: the saved run is lost.
    onSolo: () =>
      saved ? showConfirm(t.meta.newRunTitle, t.meta.newRunText, t.meta.newRunYes, t.meta.cancel, () => startSolo('new'), toTitle)
      : stale ? showConfirm(t.meta.newRunTitle, t.meta.staleRunText(stale.depth, t.classes[stale.heroClass]), t.meta.newRunYes, t.meta.cancel, () => startSolo('new'), toTitle)
      : startSolo('new'),
    onDaily: () => startSolo('daily'),
    onDailyBoard: api ? () => openBoards('daily') : undefined,
    dailyState: dailyState(),
    dailyRules: todayRules((hardship, boon, info) => t.ranked.rulesLine(hardship, boon, info)),
    onPractice: () => startSolo('daily'),
    profile: profile ? profileCard(profile, () => openBoards()) : undefined,
    onRankings: () => openBoards(),
    onMart: () => showMart({ heroClass, onClose: toTitle }),
    onSettings: () => settings(toTitle),
    challenges: challengesOpen() ? challenges : 0,
    onChallenges: () =>
      showChallenges({
        mask: challenges,
        unlocked: challengesOpen(),
        onChange: (mask) => {
          challenges = mask;
          store('pd-challenges', String(mask));
        },
        onClose: toTitle,
      }),
  });
}

/** The journal and catalog; from the menu it goes back to the menu, from the corner button to the game. */
function openJournal(onClose: () => void = hideOverlay): void {
  const world = session?.world;
  const me = world && heroById(world, session!.myId);
  if (world && me) showJournal({ world, hero: me, onClose });
}

function openMenu(): void {
  showMenu({
    onResume: hideOverlay,
    onHelp: () => showHelp(hideOverlay),
    onBadges: () => showBadges(hideOverlay),
    onJournal: () => openJournal(openMenu),
    onSettings: () => settings(openMenu),
    onReport: session?.mode === 'online'
      ? () => {
        hideOverlay();
        netlog('-- the player reports a problem');
        toast(sendNetlog('player report', true) ? t.reportSent : t.reportFailed);
      }
      : undefined,
    onMart: () => showMart({ heroClass: myClass(), onClose: hideOverlay }),
    onTreat: () => showTreat(hideOverlay),
    onExit: toTitle,
  });
}

/* Walking: a path is sent one step at a time; each waits for the last to be done. */

const walk = {
  queue: [] as number[],
  /** Monster to walk up to and hit. */
  chase: null as string | null,
  stairs: null as 'descend' | 'ascend' | null,
  /** Where the last walk was headed: a monster coming into sight stops it, and «go on» resumes it. */
  goal: null as number | null,
  /** A chest, tomb or remains to open once the walk has brought the hero beside it. */
  open: null as number | null,
  /** Pick up what lies at the end of the walk. */
  pickup: false,
  /** Resting until healed (a long press on the hourglass), stopped by any danger. */
  resting: false,
  lastSent: 0,
  reset(): void {
    this.queue = [];
    this.chase = null;
    this.stairs = null;
    this.pickup = false;
    this.resting = false;
    this.goal = null;
    this.open = null;
  },
};

const heapAt = (world: World, depth: number, pos: number): boolean =>
  (world.floors[depth]?.heaps ?? []).some((heap) => heap.pos === pos && heap.kind !== 'hidden');

/** Aiming a thrown weapon or a wand: the next tap on the map picks the target. */
let aim: { index: number; kind: 'throw' | 'zap' | 'special' } | null = null;

function toggleQuickslot(slot = 0): void {
  const world = session?.world;
  const me = world && heroById(world, session!.myId);
  if (!me) return;
  if (aim) {
    aim = null;
    return;
  }
  const index = quickIndex(me, slot);
  if (index < 0) return;
  const item = me.items[index]!;
  // Wand.actions: no zapping a wand known to be empty (one of unknown charges may be tried, and fizzle).
  if (item.charges === 0 && chargesKnown(item)) {
    view.say(t.noCharges, '#cccccc');
    return;
  }
  walk.reset();
  const use = quickUse(item.kind);
  if (use === 'use') send({ type: 'use', item: index }, performance.now());
  else if (use) aim = { index, kind: use };
}

/** Awake monsters the party could see last frame; a new one interrupts walking. */
let threats = new Set<string>();

function send(action: Parameters<Session['send']>[0], now: number): void {
  const me = session?.world && heroById(session.world, session.myId);
  if (action.type === 'move' && me && me.rooted > 0) {
    walk.reset();
    view.say(t.rooted, '#ffff44');
    return;
  }
  // Charmed, the hero cannot bring themselves to strike the charmer: say so rather than do nothing.
  if (action.type === 'attack' && me && me.charmed > 0 && me.charmedBy === action.target) {
    walk.reset();
    view.say(t.charmedNoAttack, '#ffff44');
    return;
  }
  walk.lastSent = now;
  session!.send(action);
  // The first thing done: the first game's hint has done its job.
  if (!coached) {
    coached = true;
    store('pd-moved', '1');
  }
}

/**
 * A companion stands in that cell and is walking (on screen): stepping in would swap places
 * with them and send them back a cell, so the walk waits for them instead. A companion
 * standing still is swapped with (see the core's swapsWithCompanion).
 */
function companionOnTheMove(world: World, me: Hero, cell: number): boolean {
  const other = world.heroes.find((h) => h !== me && h.depth === me.depth && h.pos === cell && isAlive(h));
  return !!other && view.stepLeft(other.id, fx.now) > -250;
}

/** How early (ms) the next step of a walk is sent before the last one ends on screen: about a frame. */
const FRAME_AHEAD_MS = 17;

/**
 * Live turns: what a tap, a key or a button decided (the walk's queue, the monster to chase, the chest
 * to open, the stairs, the rest) goes to the room at once as the hero's plan, which the room carries
 * out a turn a beat; the steps are never sent one by one, so nothing waits on the network.
 */
function sendPlan(world: World, now: number): void {
  const me = heroById(world, session!.myId);
  if (!me || !isAlive(me) || overlayOpen()) return;
  const steps: PlanStep[] = [];
  if (walk.chase) {
    steps.push({ type: 'hunt', target: walk.chase });
  } else if (walk.resting) {
    if (isStarving(me)) view.say(t.tooHungryToRest, '#ff4444');
    else steps.push({ type: 'rest' });
  } else if (walk.queue.length > 0 || walk.open !== null || walk.pickup || walk.stairs) {
    const to = walk.queue[walk.queue.length - 1] ?? me.pos;
    if (to !== me.pos) steps.push({ type: 'go', to });
    if (walk.open !== null) steps.push({ type: 'open', cell: walk.open });
    // A ware of a shop is bought through its window, once there (see the arrival below); anything else is picked up.
    const heap = world.floors[me.depth]?.heaps.find((h) => h.pos === to && h.kind !== 'hidden');
    if (walk.pickup && heap?.kind === 'forSale') liveArrival = to;
    else if (walk.pickup && heap) steps.push({ type: 'pickup' });
    if (walk.stairs) steps.push({ type: walk.stairs });
  } else {
    return;
  }
  const goal = walk.goal;
  walk.reset();
  walk.goal = goal;
  if (steps.length > 0) send({ type: 'plan', steps }, now);
}

/** Live turns: a shop's ware walked up to, whose window opens on arrival. */
let liveArrival: number | null = null;

function step(world: World, now: number, visible: readonly boolean[]): void {
  if (session!.beatMs !== null) {
    sendPlan(world, now);
    const me = heroById(world, session!.myId);
    if (liveArrival !== null && me?.pos === liveArrival && !me.plan?.length) {
      liveArrival = null;
      takeHere(world, me, now);
    }
    return;
  }
  const me = heroById(world, session!.myId);
  // Resting turns are not paced like steps: there is nothing to animate.
  const pace = walk.resting ? 0 : STEP_MS;
  // Online, the next step of a calm walk goes out before the room has answered the last one,
  // from where that one leads: the room's answer takes longer than a step on many networks.
  const walking = walk.queue.length > 0 || (held.code !== '' && !walk.chase && !walk.resting && !walk.stairs && !walk.pickup);
  const ahead = threats.size === 0 && walking ? session!.stepAhead : null;
  // Alone, the next step goes as the last one ends on screen (a frame early, so it follows on without a
  // pause or a hurried catch-up); online the room's answer starts each step, so the clock paces them.
  // Alone, the monsters in sight finish their steps on screen first, too (see View.othersLeft).
  const due = session!.mode === 'solo'
    ? (walk.resting || view.stepLeft(session!.myId, fx.now) <= FRAME_AHEAD_MS) && view.othersLeft(visible, fx.now) <= FRAME_AHEAD_MS
      && now - walk.lastSent >= (walk.resting ? 0 : STEP_MS / 2)
    : now - walk.lastSent >= pace;
  if (!me || !isAlive(me) || (session!.busy && ahead === null) || overlayOpen() || !due) return;
  if (ahead !== null) {
    // An arrow held down goes on from where the last step leads, as long as the way is open.
    const upcoming = walk.queue[0] ?? ahead + held.dx + held.dy * WIDTH;
    if (companionOnTheMove(world, me, upcoming)) return;
    const next = walk.queue.shift() ?? upcoming;
    const level = levelAt(world, me.depth);
    const open = findPath(level, ahead, next, occupiedCells(world, me.depth), exploredCells(world, me.depth), (me.levitating ?? 0) > 0);
    if (!adjacent(ahead, next) || open?.length !== 1) walk.reset();
    else send({ type: 'move', to: next }, now);
    return;
  }
  const level = levelAt(world, me.depth);

  // An arrow held down walks on, a step as soon as the last is done: the keyboard's own repeat
  // (a step, a pause, then a stream) is not waited for.
  if (held.code && walk.queue.length === 0 && !walk.chase && !walk.resting && !walk.stairs && !walk.pickup) {
    // Held down, a key walks; it does not fight. A monster (or anyone not of the party) in the way
    // stops the walk there, and each blow takes a press of its own, as each tap does (the ghost and the
    // sheep, who step aside, do not stop it).
    const next = me.pos + held.dx + held.dy * WIDTH;
    const there = visible[next] ? charAt(world, me.depth, next) : undefined;
    if (there && 'kind' in there && !swapsWithHero(there)) held.code = '';
    else tapCell(next, true);
  }

  if (walk.chase) {
    const mob = mobById(world, me.depth, walk.chase);
    if (!mob || !visible[mob.pos]) {
      walk.chase = null;
    } else if (adjacent(me.pos, mob.pos)) {
      walk.chase = null;
      send({ type: 'attack', target: mob.id }, now);
      return;
    } else {
      const path = findPath(
        level, me.pos, mob.pos, occupiedCells(world, me.depth, mob.pos), exploredCells(world, me.depth), (me.levitating ?? 0) > 0,
      );
      if (!path || path.length < 2) {
        walk.chase = null;
        return;
      }
      send({ type: 'move', to: path[0]! }, now);
      return;
    }
  }

  if (walk.queue.length > 0) {
    // A companion walking just ahead is followed, not swapped with: wait for them to step on.
    if (companionOnTheMove(world, me, walk.queue[0]!)) return;
    const next = walk.queue.shift()!;
    if (!adjacent(me.pos, next) || occupiedCells(world, me.depth).has(next)) {
      walk.reset();
      return;
    }
    send({ type: 'move', to: next }, now);
    return;
  }

  if (walk.open !== null) {
    const cell = walk.open;
    walk.open = null;
    if (adjacent(me.pos, cell)) {
      openAt(world, me, cell, now);
      return;
    }
  }

  if (walk.pickup) {
    walk.pickup = false;
    if (heapAt(world, me.depth, me.pos)) {
      takeHere(world, me, now);
      return;
    }
  }

  if (walk.resting) {
    if (isStarving(me)) {
      walk.resting = false;
      view.say(t.tooHungryToRest, '#ff4444');
    } else if (me.hp >= me.ht || threats.size > 0) {
      walk.resting = false;
    } else {
      send({ type: 'wait' }, now);
      return;
    }
  }

  if (walk.stairs) {
    const stairs = walk.stairs;
    walk.stairs = null;
    useStairs(world, stairs, now);
  }
}

/** Picks up what lies here, or offers a shop's ware for sale. */
/** Opens the chest, tomb or remains in the cell beside the hero; a locked chest wants the level's golden key. */
function openAt(world: World, me: Hero, cell: number, now: number): void {
  const heap = world.floors[me.depth]?.heaps.find((h) => h.pos === cell);
  if (!heap) return;
  const locked = heap.kind === 'lockedChest' || heap.kind === 'crystalChest';
  if (locked && !me.items.some((i) => i.kind === 'key.golden' && i.depth === me.depth)) {
    view.say(heap.kind === 'crystalChest' ? t.crystalChest(itemName(world, heap.items[0]!)) : t.lockedChest, '#ff8800');
    return;
  }
  send({ type: 'open', cell }, now);
}

function takeHere(world: World, me: Hero, now: number): void {
  const heap = world.floors[me.depth]?.heaps.find((h) => h.pos === me.pos);
  if (!heap || heap.kind === 'hidden') return;
  // A locked or crystal chest wants the level's golden key; through crystal one sees what it holds.
  const locked = heap.kind === 'lockedChest' || heap.kind === 'crystalChest';
  if (locked && !me.items.some((i) => i.kind === 'key.golden' && i.depth === me.depth)) {
    view.say(heap.kind === 'crystalChest' ? t.crystalChest(itemName(world, heap.items[0]!)) : t.lockedChest, '#ff8800');
    return;
  }
  if (heap.kind === 'forSale') openTrade(world, me, heap.items[0]!);
  else send({ type: 'pickup' }, now);
}

function openTrade(world: World, me: Hero, item: Item): void {
  walk.reset();
  showTrade({
    world, hero: me, item,
    price: buyPrice(item, me.depth, world.known.includes(item.kind), me.rings.some((ring) => ring.kind === 'ring.haggler')),
    onBuy: () => send({ type: 'buy' }, performance.now()),
    onClose: hideOverlay,
  });
}

/** The shopkeeper's offer for the pack; it stays open while selling. */
let selling = false;

function openShop(): void {
  const world = session?.world;
  const me = world && heroById(world, session!.myId);
  if (!world || !me) return;
  walk.reset();
  selling = true;
  showSell({
    world, hero: me,
    onSell: (index) => send({ type: 'sell', item: index }, performance.now()),
    onClose: () => {
      selling = false;
      hideOverlay();
    },
  });
}

function useStairs(world: World, stairs: 'descend' | 'ascend', now: number): void {
  // The arena has no stairs: its dais is no way up.
  if (world.arena) return;
  const me = heroById(world, session!.myId)!;
  const level = levelAt(world, me.depth);
  if (stairs === 'descend' && me.pos === level.exit) {
    send({ type: 'descend' }, now);
  } else if (stairs === 'ascend' && me.pos === level.entrance && (me.depth > 1 || hasAmulet(me))) {
    send({ type: 'ascend' }, now);
  }
}

/** Cells taken by living characters on a depth, except `except`. */
function occupiedCells(world: World, depth: number, except = -1): Set<number> {
  const cells = new Set<number>();
  // Companions step aside too (swapping places), unless they are held fast.
  for (const hero of world.heroes) {
    if (hero.depth === depth && isAlive(hero) && hero.id !== session!.myId && (hero.rooted > 0 || hero.paralysed > 0)) cells.add(hero.pos);
  }
  // Only monsters in sight are walked round: the way is planned with what the player can see, not
  // with what hides in the dark. The ghost and magic sheep step aside: the hero swaps places with them.
  const seen = visibleCells(world, depth);
  for (const mob of world.floors[depth]?.mobs ?? []) if (!swapsWithHero(mob) && seen[mob.pos]) cells.add(mob.pos);
  cells.delete(except);
  return cells;
}

/** Badges earned just now: a toast and the original's fanfare for each. */
function announceBadges(ids: readonly BadgeId[]): void {
  for (const id of ids) {
    audio.play('badge');
    toast(t.badgeEarned(badgeText(id)), { tone: 'badge', badge: BADGES.find((b) => b.id === id)?.image });
  }
}

/** The region's tune for each region (the sewers keep the original's), and the bosses that have the boss's. */
const REGION_MUSIC = ['game', 'prison', 'caves', 'city', 'halls'] as const;
const MUSIC_BOSSES: ReadonlySet<string> = new Set(['goo', 'tengu', 'dm300', 'king', 'yog']);
/** A boss fight on my depth: from the boss's cry until it falls, or the hero leaves, or the run starts over. */
let bossFight: { session: Session; generation: number; depth: number } | null = null;

function handleMyEffects(effects: readonly Effect[], myId: string): void {
  const world = session?.world;
  const me = world && heroById(world, myId);
  if (world && me) announceBadges([...countGame(world.run.seed), ...checkBadges(world, me, effects)]);
  for (const effect of effects) {
    if (effect.type === 'yell' && effect.line === 'notice' && MUSIC_BOSSES.has(effect.kind) && session && me && effect.depth === me.depth) {
      bossFight = { session, generation: session.generation, depth: effect.depth };
    }
    if (effect.type === 'bossSlain' && effect.depth === bossFight?.depth) bossFight = null;
    if (effect.type === 'ghost' && effect.hero === myId) talkWithGhost(effect.line, effect.errand);
    if (effect.type === 'ratKing' && effect.hero === myId) talkWithRatKing(effect.line);
    if (effect.type === 'wandmaker' && effect.hero === myId) talkWithWandmaker(effect.line);
    if (effect.type === 'imp' && effect.hero === myId) talkWithImp(effect.line);
    if (effect.type === 'smith' && effect.hero === myId) talkWithSmith(effect.line);
    if (effect.type === 'shop' && effect.hero === myId) openShop();
    // The Amulet of Yendor: its question for whoever takes it (once a run); the party hears of it.
    if (effect.type === 'amulet' && world && me) {
      if (effect.hero === myId) {
        walk.reset();
        if (effect.first) showAmulet(world, me, true, () => send({ type: 'endGame' }, performance.now()), hideOverlay);
      } else if (effect.first) {
        toast(t.amuletTaken(heroById(world, effect.hero)?.name ?? ''), { tone: 'ally' });
      }
    }
    if (effect.type === 'fell' && effect.hero === myId) justFell = true;
    // Hero.interrupt: an item breaking stops whatever the hero was doing.
    if (effect.type === 'worn' && effect.hero === myId && effect.state === 'broken') walk.reset();
    // What flies into the backpack is motion.ts's: from wherever it lay. The find shows a moment under the HUD.
    if (effect.type === 'pickedUp' && effect.hero === myId && effect.item.kind !== 'gold') newLoot = true;
    if (effect.type === 'pickedUp' && effect.hero === myId && world) {
      const item = effect.item;
      finds.show(item.kind === 'gold' ? 'gold' : `${item.kind}:${item.level}`, itemSprite(item, world.run.labels), capitalize(itemName(world, item)),
        item.kind.startsWith('ring.') || item.kind.startsWith('wand.') || item.kind === 'potion.strength' || item.kind === 'scroll.upgrade');
    }
    if (effect.type === 'sold' && effect.hero === myId && selling && overlayOpen()) openShop();
    if (world && me) learnFromEffect(world, me, effect);
    // Goo winding up: a warning nobody can miss, while there is still time to step back.
    if (effect.type === 'pumped' && me && effect.depth === me.depth) toast(t.gooPumpsTip, { tone: 'warn' });
    // Hunger kills quietly in the original's log: here it says what to do, and with what.
    if (effect.type === 'hunger' && effect.hero === myId && world && me) {
      const food = me.items.find((item) => itemDef(item.kind).category === 'food');
      const tip = effect.state === 'starving' ? t.starvingTip : t.hungryTip;
      toast(food ? `${tip} ${t.eatThis(itemName(world, food))}` : tip, { tone: 'warn', ...(food ? { item: itemSprite(food, world.run.labels) } : {}) });
    }
    const hurt =
      (effect.type === 'attack' && effect.target === myId) ||
      (effect.type === 'hurt' && effect.who === myId) ||
      (effect.type === 'hunger' && effect.hero === myId && effect.state === 'starving');
    if ((effect.type === 'interrupted' && effect.hero === myId) || hurt) {
      walk.queue = [];
      walk.stairs = null;
      walk.resting = false;
    }
  }
}

function talkWithGhost(line: 'intro' | 'remind' | 'reward' | 'farewell', errand: 'rose' | 'rat' | 'curse'): void {
  const world = session?.world;
  const me = world && heroById(world, session!.myId);
  if (!world || !me) return;
  audio.play('ghost');
  walk.reset();
  const quest = world.quest;
  // Each errand has its own words; the curse is only taken on if the hero says yes.
  const text =
    line === 'farewell' ? t.ghost.farewell
    : errand === 'rat' ? t.ghostRat[line]
    : errand === 'curse' ? (line === 'reward' ? t.ghostCurse.reward(t.classes[me.heroClass]) : t.ghostCurse.intro)
    : t.ghost[line];
  showQuest({
    world,
    hero: me,
    who: 'ghost',
    text,
    offers: line === 'reward' && quest ? [quest.weapon, quest.armor] : [],
    onChoose: (index) => send({ type: 'reward', choice: index === 0 ? 'weapon' : 'armor' }, performance.now()),
    ...(errand === 'curse' && line === 'intro'
      ? { answers: [{ label: t.ghostCurse.yes, onAnswer: () => send({ type: 'faceCurse' }, performance.now()) }, { label: t.ghostCurse.no, onAnswer: () => undefined }] }
      : {}),
    onClose: hideOverlay,
  });
}

/** RatKing.interact: a few words, and back to his kingdom. */
function talkWithRatKing(line: 'notSleeping' | 'busy'): void {
  const world = session?.world;
  const me = world && heroById(world, session!.myId);
  if (!world || !me) return;
  walk.reset();
  showQuest({ world, hero: me, who: 'ratKing', text: t.ratKing[line], onClose: hideOverlay });
}

function talkWithWandmaker(line: 'intro' | 'remind' | 'reward' | 'farewell'): void {
  const world = session?.world;
  const me = world && heroById(world, session!.myId);
  if (!world || !me) return;
  walk.reset();
  const quest = world.wandQuest;
  showQuest({
    world,
    hero: me,
    who: 'wandmaker',
    // He may be after a rotberry seed rather than corpse dust.
    text: quest?.wants === 'berry' && line === 'intro' ? t.wandmaker.introBerry
      : quest?.wants === 'berry' && line === 'remind' ? t.wandmaker.remindBerry
      : quest?.wants === 'fish' && line === 'intro' ? t.wandmaker.introFish
      : quest?.wants === 'fish' && line === 'remind' ? t.wandmaker.remindFish
      : t.wandmaker[line],
    offers: line === 'reward' && quest ? [quest.battle, quest.utility] : [],
    onChoose: (index) => send({ type: 'wandReward', choice: index === 0 ? 'battle' : 'utility' }, performance.now()),
    onClose: hideOverlay,
  });
}

function talkWithSmith(line: SmithLine): void {
  const world = session?.world;
  const me = world && heroById(world, session!.myId);
  const quest = world?.smithQuest;
  if (!world || !me || !quest) return;
  walk.reset();
  const text =
    line === 'intro' ? t.smith.intro[quest.wants]
    : line === 'noGold' ? t.smith.noGold(ORE_WANTED)
    : t.smith[line];
  // Done with the errand: his services are on offer at once.
  if (line === 'completed' || line === 'reforge') {
    showReforge({
      world, hero: me, text,
      onReforge: (first, second) => send({ type: 'reforge', first, second }, performance.now()),
      onClose: hideOverlay,
    });
    return;
  }
  showQuest({ world, hero: me, who: 'blacksmith', text, onClose: hideOverlay });
}

function talkWithImp(line: 'intro' | 'remind' | 'reward' | 'farewell'): void {
  const world = session?.world;
  const me = world && heroById(world, session!.myId);
  const quest = world?.impQuest;
  if (!world || !me || !quest) return;
  walk.reset();
  const text =
    line === 'intro' ? t.imp.intro[quest.prey]
    : line === 'remind' ? t.imp.remind[quest.prey]
    : line === 'reward' ? t.imp.reward
    : t.imp.farewell(t.classes[me.heroClass]);
  showQuest({
    world,
    hero: me,
    who: 'imp',
    text,
    offers: line === 'reward' ? [quest.reward] : [],
    onChoose: () => send({ type: 'impReward' }, performance.now()),
    onClose: hideOverlay,
  });
}

/* Input */

function act(type: 'wait' | 'search'): void {
  const world = session?.world;
  if (!world || session!.busy) return;
  walk.reset();
  send({ type }, performance.now());
}

function tapCell(cell: number, quiet = false): void {
  const world = session?.world;
  const me = world && heroById(world, session!.myId);
  if (!world || !me || !isAlive(me)) return;
  const level = levelAt(world, me.depth);
  const visible = visibleCells(world, me.depth);
  const explored = exploredCells(world, me.depth);
  walk.reset();
  const vnow = fx.now;
  feedback.clear();
  // Aiming a shot, the tapped cell flashes for a blink: the tap was taken.
  if (explored[cell] && !quiet && aim) view.flashes.push({ cell, start: vnow, color: '255, 120, 80', duration: 260 });

  if (aim) {
    const shot = aim;
    aim = null;
    if (shot.kind === 'special') send({ type: 'special', target: cell }, performance.now());
    else if (cell !== me.pos && me.items[shot.index]) send({ type: shot.kind, item: shot.index, target: cell }, performance.now());
    return;
  }

  if (cell === me.pos) {
    if (heapAt(world, me.depth, me.pos)) takeHere(world, me, performance.now());
    else if (!world.arena && me.pos === level.exit) useStairs(world, 'descend', performance.now());
    else if (!world.arena && me.pos === level.entrance && (me.depth > 1 || hasAmulet(me))) useStairs(world, 'ascend', performance.now());
    else if (me.pos === level.entrance && heapAt(world, me.depth, me.pos) === undefined && me.depth === 1 && level.map[me.pos] === T.ENTRANCE) {
      // Hero.actAscend without the Amulet: the way out stays shut.
      toast(t.wayUpSealed);
    }
    else act('search');
    return;
  }
  const mob = world.floors[me.depth]?.mobs.find((m) => m.pos === cell);
  if (mob && visible[cell]) {
    walk.chase = mob.id;
    if (!quiet) feedback.aim(cell, true, vnow, mob.id);
    return;
  }
  if (!explored[cell]) return;
  const floating = (me.levitating ?? 0) > 0;
  // Hero.actOpenChest: a chest, a tomb or remains are opened from beside them, as in the original
  // (by a wall or in a corner, fewer wraiths can rise round a tomb); from afar, the hero walks up to one.
  const box = world.floors[me.depth]?.heaps.find((h) => h.pos === cell && h.kind !== 'heap' && h.kind !== 'forSale' && h.kind !== 'hidden');
  if (box) {
    if (adjacent(me.pos, cell)) {
      openAt(world, me, cell, performance.now());
      return;
    }
    const way = findPath(level, me.pos, cell, occupiedCells(world, me.depth), explored, floating);
    if (way && way.length > 1) {
      walk.queue = way.slice(0, -1);
      walk.open = cell;
      if (!quiet) feedback.aim(cell, false, vnow);
      return;
    }
  }
  // A vein of dark gold beside the hero, with the blacksmith's pickaxe at hand: mine it.
  const pickaxe = me.weapon?.kind === 'weapon.pickaxe' || me.items.some((i) => i.kind === 'weapon.pickaxe');
  if (level.map[cell] === T.WALL_DECO && adjacent(me.pos, cell) && pickaxe && me.depth >= 11 && me.depth <= 15) {
    send({ type: 'mine' }, performance.now());
    return;
  }
  // Chasm.heroJump: a chasm right beside the hero asks whether to jump in; floating, one drifts over it.
  if (hasFlag(level.map[cell]!, F.PIT) && !floating) {
    if (adjacent(me.pos, cell)) {
      showConfirm(t.chasm, t.jumpQuestion, t.jumpYes, t.jumpNo, () => send({ type: 'jump', to: cell }, performance.now()), hideOverlay);
    }
    return;
  }
  if (level.map[cell] === T.LOCKED_DOOR && !me.items.some((i) => i.kind === 'key.iron' && i.depth === me.depth)) {
    view.say(t.locked, '#ff8800');
    feedback.refuse(cell, vnow);
    return;
  }
  // Hero.handle: the way down from a boss's depth wants its skeleton key.
  if (level.map[cell] === T.LOCKED_EXIT && !me.items.some((i) => i.kind === 'key.skeleton' && i.depth === me.depth)) {
    view.say(t.exitLocked, '#ff8800');
    feedback.refuse(cell, vnow);
    return;
  }
  if (level.map[cell] === T.BARRICADE) {
    view.say(t.barricade, '#ff8800');
    feedback.refuse(cell, vnow);
    return;
  }
  // The alchemy pot: what it is for, then walk up to it as usual.
  if (level.map[cell] === T.ALCHEMY) view.say(t.alchemyPot, '#ffff44');
  walk.queue = findPath(level, me.pos, cell, occupiedCells(world, me.depth), explored, floating) ?? [];
  if (walk.queue.length === 0) {
    // No way around a known trap: walk up to it and say so; a tap on the trap itself steps onto it.
    const risky = findPath(level, me.pos, cell, occupiedCells(world, me.depth), explored, floating, true);
    const trap = risky?.findIndex((c) => c !== cell && hasFlag(level.map[c]!, F.AVOID)) ?? -1;
    if (risky && trap >= 0) {
      walk.queue = risky.slice(0, trap);
      view.say(t.trapInTheWay, '#ff8800');
      if (!quiet && walk.queue.length > 0) feedback.aim(walk.queue[walk.queue.length - 1]!, false, vnow);
    } else if (!quiet) {
      // No way there: say so where the finger was.
      feedback.refuse(cell, vnow);
    }
    return;
  }
  if (!quiet && walk.queue.length > 1) feedback.aim(cell, false, vnow);
  if (!quiet) walk.goal = cell;
  walk.pickup = heapAt(world, me.depth, cell);
  if (world.arena) return;
  if (cell === level.exit) walk.stairs = 'descend';
  else if (cell === level.entrance && (me.depth > 1 || hasAmulet(me))) walk.stairs = 'ascend';
}

function openHero(): void {
  const world = session?.world;
  const me = world && heroById(world, session!.myId);
  if (!world || !me) return;
  walk.reset();
  aim = null;
  showHero({
    hero: me, buffs: heroBuffs(me), onClose: hideOverlay, skin: session?.looks[me.id]?.skin,
    looks: looksRows(me.heroClass, (shelf) => showMart({ heroClass: me.heroClass, shelf, onClose: openHero })),
  });
}

function openBackpack(): void {
  const world = session?.world;
  const me = world && heroById(world, session!.myId);
  if (!world || !me) return;
  walk.reset();
  aim = null;
  newLoot = false;
  showBackpack({
    world,
    hero: me,
    onAction: (action) => send(action, performance.now()),
    onAim: (index, kind) => {
      aim = { index, kind };
    },
    onClose: hideOverlay,
  });
}

/* Zoom and looking around: pinch or wheel to zoom, drag to look about (as GameScene's camera). */

/** Zoom levels in device pixels per art pixel: whole numbers keep the art crisp; the view glides between them. */
const zoom = { base: 2, min: 1, max: 4, target: 2, delta: 0 };
try {
  // A new key since the zoom's base comes from the screen: a step taken from the old base meant another size.
  zoom.delta = Number(localStorage.getItem('pd-zoom-screen')) || 0;
} catch {
  // The default zoom, then.
}
/** How far the view has been dragged away from the hero, world pixels; it glides back when the hero moves. */
const pan = { x: 0, y: 0, home: false };
/** Where a zoom is centred, device pixels: the fingers, the cursor, or the hero. */
let zoomAnchor: { x: number; y: number } | null = null;

function clampZoom(z: number, give = 0): number {
  return Math.min(zoom.max + give, Math.max(zoom.min - give, z));
}

/** Settles on a zoom level (by steps from the wheel and keys) and remembers it. */
function zoomTo(level: number, anchor: { x: number; y: number } | null): void {
  const next = clampZoom(Math.round(level));
  if (next !== Math.round(zoom.target)) audio.play('tick', 1 + (next - zoom.base) * 0.06, 0.35);
  zoom.target = next;
  zoomAnchor = anchor;
  zoom.delta = next - zoom.base;
  try {
    localStorage.setItem('pd-zoom-screen', String(zoom.delta));
  } catch {
    // Not remembered.
  }
}

/** Changes the zoom keeping the world point under `anchor` where it is on screen. */
function applyZoom(z: number, anchor: { x: number; y: number }): void {
  const old = camera.zoom;
  if (!Number.isFinite(z) || z <= 0) return;
  if (z === old || !follow.ready || !Number.isFinite(anchor.x) || !Number.isFinite(anchor.y)) {
    camera.zoom = z;
    return;
  }
  const nx = follow.x + anchor.x / old - anchor.x / z;
  const ny = follow.y + anchor.y / old - anchor.y / z;
  // Following the hero, the view's target moves with the zoom; the drag offset makes up the difference.
  const shiftX = (canvas.width / 2) * (1 / z - 1 / old);
  const shiftY = freeMiddle >= 0 ? freeMiddle * (1 / z - 1 / old) : (canvas.height / 2) * (1 / z - 1 / old);
  pan.x += nx - follow.x + shiftX;
  pan.y += ny - follow.y + shiftY;
  follow.x = nx;
  follow.y = ny;
  camera.zoom = z;
}

const toDevice = (clientX: number, clientY: number): { x: number; y: number } => {
  const rect = canvas.getBoundingClientRect();
  // A canvas not laid out (a hidden pane) has no size to scale by.
  const sx = rect.width > 0 ? canvas.width / rect.width : 1;
  const sy = rect.height > 0 ? canvas.height / rect.height : 1;
  return { x: (clientX - rect.left) * sx, y: (clientY - rect.top) * sy };
};

/** Fingers on the map, in device pixels, and what they are doing. */
const fingers = new Map<number, { x: number; y: number }>();
let gesture:
  | { kind: 'tap' | 'pan'; x: number; y: number; panX: number; panY: number }
  | { kind: 'pinch'; dist: number; zoom: number; mid: { x: number; y: number } }
  | { kind: 'done' }
  | null = null;

const spread = (): { dist: number; mid: { x: number; y: number } } => {
  const [a, b] = [...fingers.values()];
  return { dist: Math.hypot(a!.x - b!.x, a!.y - b!.y) || 1, mid: { x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 } };
};

canvas.addEventListener('pointerdown', (event) => {
  if (!session?.world || overlayOpen()) return;
  // The HUD, log and toolbar are HTML over the canvas: what reaches here is a touch on the map.
  try {
    canvas.setPointerCapture(event.pointerId);
  } catch {
    // Not a live pointer (a synthetic event): its moves still reach the canvas.
  }
  fingers.set(event.pointerId, toDevice(event.clientX, event.clientY));
  if (fingers.size === 1) {
    const at = fingers.get(event.pointerId)!;
    gesture = { kind: 'tap', x: at.x, y: at.y, panX: pan.x, panY: pan.y };
    armPing();
  } else if (fingers.size === 2) {
    const { dist, mid } = spread();
    gesture = { kind: 'pinch', dist, zoom: camera.zoom, mid };
  }
});

canvas.addEventListener('pointermove', (event) => {
  if (!fingers.has(event.pointerId) || !gesture) return;
  fingers.set(event.pointerId, toDevice(event.clientX, event.clientY));
  if (gesture.kind === 'tap' || gesture.kind === 'pan') {
    const at = fingers.get(event.pointerId)!;
    const dx = at.x - gesture.x;
    const dy = at.y - gesture.y;
    // A finger that travels is looking around, not tapping.
    const slop = 10 * (canvas.width / (canvas.clientWidth || canvas.width));
    if (gesture.kind === 'tap' && Math.hypot(dx, dy) > slop) gesture = { ...gesture, kind: 'pan' };
    if (gesture.kind === 'pan') {
      pan.x = gesture.panX - dx / camera.zoom;
      pan.y = gesture.panY - dy / camera.zoom;
      pan.home = false;
    }
  } else if (gesture.kind === 'pinch' && fingers.size >= 2) {
    const { dist, mid } = spread();
    // The zoom follows the fingers, a little past the ends, and the point between them stays put.
    const z = clampZoom(gesture.zoom * (dist / gesture.dist), 0.6);
    zoom.target = z;
    applyZoom(z, mid);
    pan.x -= (mid.x - gesture.mid.x) / camera.zoom;
    pan.y -= (mid.y - gesture.mid.y) / camera.zoom;
    follow.x -= (mid.x - gesture.mid.x) / camera.zoom;
    follow.y -= (mid.y - gesture.mid.y) / camera.zoom;
    gesture.mid = mid;
    pan.home = false;
  }
});

const lift = (event: PointerEvent): void => {
  if (!fingers.has(event.pointerId)) return;
  const at = fingers.get(event.pointerId)!;
  fingers.delete(event.pointerId);
  if (gesture?.kind === 'pinch') {
    // Let go: the view settles on the nearest whole zoom, round the point between the fingers.
    zoomTo(camera.zoom, gesture.mid);
    gesture = fingers.size > 0 ? { kind: 'done' } : null;
    return;
  }
  if (fingers.size > 0) return;
  const tapped = gesture?.kind === 'tap' && event.type === 'pointerup';
  gesture = null;
  if (tapped) tapAt(at.x, at.y);
};
canvas.addEventListener('pointerup', lift);
canvas.addEventListener('pointercancel', lift);

/* Co-op signals (coop-marks.ts): a long press on the map pings that cell for the party. */
const coop = new CoopMarks(hud.root);
const LONG_PRESS_MS = 450;
let pressTimer = 0;

/** Called as a finger comes down: held still long enough, the touch becomes a ping instead of a tap. */
function armPing(): void {
  clearTimeout(pressTimer);
  const started = gesture;
  if (session?.mode !== 'online' || started?.kind !== 'tap') return;
  pressTimer = window.setTimeout(() => {
    // A drag or a pinch, a lifted finger or a new touch each replace the gesture: then it was not a hold.
    if (gesture !== started || !session?.world || overlayOpen()) return;
    const x = Math.floor((camera.x + started.x / camera.zoom) / TILE);
    const y = Math.floor((camera.y + started.y / camera.zoom) / TILE);
    if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT) return;
    // The touch is spent: lifting the finger walks nowhere.
    gesture = { kind: 'done' };
    if (coop.ping(session, view.depth, x + y * WIDTH)) haptic('hit');
  }, LONG_PRESS_MS);
}

/** The mouse wheel (and a touchpad's pinch) zooms by steps, round the cursor. */
let wheelSum = 0;
canvas.addEventListener('wheel', (event) => {
  if (!session?.world || overlayOpen()) return;
  event.preventDefault();
  wheelSum += event.deltaMode === 1 ? event.deltaY * 40 : event.deltaY;
  // A touchpad's pinch comes as many small steps with ctrl held.
  const notch = event.ctrlKey ? 25 : 60;
  if (Math.abs(wheelSum) < notch) return;
  zoomTo(Math.round(zoom.target) - Math.sign(wheelSum), toDevice(event.clientX, event.clientY));
  wheelSum = 0;
}, { passive: false });

/* Learning mode: a word about each thing the first time it is met (hints.ts) */

hints.attach(document.getElementById('ui')!);

// A run that could not be written (the device out of space) is said once a session, not lost unannounced.
let saveFailShown = false;
addEventListener('pd-save-failed', () => {
  if (saveFailShown) return;
  saveFailShown = true;
  toast(t.meta.saveFailed, { tone: 'warn' });
});

const HINT_CATEGORIES: ReadonlySet<string> = new Set([
  'potion', 'scroll', 'weapon', 'armor', 'ring', 'wand', 'food', 'seed', 'missile', 'bomb', 'key', 'gold', 'vial', 'bag',
  'ankh', 'honeypot', 'torch', 'tome', 'kit', 'beacon', 'weightstone',
]);
const NPCS: ReadonlySet<string> = new Set(['ghost', 'wandmaker', 'blacksmith', 'imp', 'ratKing']);
const BOSS_DEPTHS: ReadonlySet<number> = new Set([5, 10, 15, 20, 25]);

/** An item's picture for a hint card. */
const itemPicture = (sprite: number) => (): HTMLElement => {
  const icon = document.createElement('i');
  icon.className = 'pd-item';
  icon.style.setProperty('--ix', String(sprite % 16));
  icon.style.setProperty('--iy', String(Math.floor(sprite / 16)));
  return icon;
};

/** What the player sees for the first time, after each turn: monsters, items, traps, doors, stairs, wells... */
function learnFromSight(world: World, me: Hero, level: Level, visible: readonly boolean[]): void {
  if (!hints.enabled || !isAlive(me)) return;
  const floor = world.floors[me.depth];
  for (const mob of floor?.mobs ?? []) {
    if (!visible[mob.pos]) continue;
    if (mob.state === 'passive') {
      if (NPCS.has(mob.kind)) hints.first('npc', () => portrait(mob.kind));
      if (mob.kind === 'shopkeeper') hints.first('shop', () => portrait(mob.kind));
    } else if (mob.state !== 'sleeping') {
      // (Its words are of classic turns; under live turns the world's own hint has said how fights go.)
      if (!world.live) hints.first('monster', () => portrait(mob.kind));
    }
  }
  if (me.hp > 0 && me.hp < me.ht * 0.4) hints.first('lowHealth');
  for (const heap of floor?.heaps ?? []) {
    if (!visible[heap.pos] || heap.kind === 'hidden') continue;
    if (heap.kind === 'heap') hints.first('floorItem', itemPicture(itemSprite(heap.items[0]!, world.run.labels)));
    else if (heap.kind !== 'forSale') hints.first('container', itemPicture(HEAP_SPRITES[heap.kind]));
  }
  for (let cell = 0; cell < visible.length; cell++) {
    if (!visible[cell]) continue;
    const terrain = level.map[cell]!;
    // A trap one can see: a hidden one says nothing.
    if (trapAt(terrain) && !hasFlag(terrain, F.SECRET)) hints.first('trap');
    if (terrain === T.LOCKED_DOOR) hints.first('lockedDoor');
    if (terrain === T.WELL) hints.first('well');
    if (terrain === T.ALCHEMY) hints.first('alchemy');
  }
  if (visible[level.exit] && me.depth < 26) hints.first('stairs');
  if (level.altar && visible[level.altar.pos]) hints.first('altar');
  // The arena: a word about the waves; it has no secrets, stairs or bosses' lairs to explain.
  if (world.arena && !overlayOpen()) hints.first('arena');
  if (world.live && !overlayOpen()) hints.first('live');
  if (me.depth >= 2 && !world.arena) hints.first('secret');
  if (BOSS_DEPTHS.has(me.depth) && !world.arena) hints.first('boss');
  if (world.turn > 60) hints.first('examine');
  if (session?.mode === 'online' && world.heroes.some((h) => h.id !== me.id && h.depth === me.depth && visible[h.pos])) {
    hints.first('companion', () => portrait(world.heroes.find((h) => h.id !== me.id)!.heroClass));
  }
}

/** What happens to the player for the first time: an item of a kind picked up, a wound, hunger, a level gained. */
function learnFromEffect(world: World, me: Hero, effect: Effect): void {
  if (!hints.enabled) return;
  const mine = session?.myId;
  if (effect.type === 'pickedUp' && effect.hero === mine) {
    const category = itemDef(effect.item.kind).category;
    if (HINT_CATEGORIES.has(category)) hints.first(category as HintId, itemPicture(itemSprite(effect.item, world.run.labels)));
  }
  if ((effect.type === 'dew' || effect.type === 'dewCollected') && effect.hero === mine) hints.first('dew');
  if (effect.type === 'attack' && effect.target === mine && effect.hit && effect.damage > 0) hints.first('attacked');
  if (effect.type === 'hunger' && effect.hero === mine) hints.first('hungry');
  if (effect.type === 'levelUp' && effect.hero === mine) hints.first('levelUp');
  if (effect.type === 'shop' && effect.hero === mine) hints.first('shop');
  void me;
}

/* The mouse over the map (design system v13): quiet corners on the cell under it, red over a foe, and
   nothing that pops up; the right button examines. */

/** The cell under the mouse and its corners on the map. */
const hover = { cell: -1, frame: document.createElement('div') };
hover.frame.className = 'pd-hover';
hover.frame.style.display = 'none';
canvas.insertAdjacentElement('afterend', hover.frame);

/** The map cell under a point of the screen (CSS pixels), or -1. */
function cellUnder(clientX: number, clientY: number): number {
  const rect = canvas.getBoundingClientRect();
  const px = (clientX - rect.left) * (canvas.width / rect.width);
  const py = (clientY - rect.top) * (canvas.height / rect.height);
  const x = Math.floor((camera.x + px / camera.zoom) / TILE);
  const y = Math.floor((camera.y + py / camera.zoom) / TILE);
  return x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT ? -1 : x + y * WIDTH;
}

function hideHover(): void {
  hover.cell = -1;
  hover.frame.style.display = 'none';
}

/** The corners a cell gets: red over a monster in sight, gold over the rest explored, none in the unknown. */
function hoverKind(cell: number): 'foe' | 'cell' | null {
  const world = session?.world;
  const me = world && heroById(world, session!.myId);
  if (!world || !me || !exploredCells(world, me.depth)[cell]) return null;
  const char = visibleCells(world, me.depth)[cell] ? charAt(world, me.depth, cell) : undefined;
  return char && 'kind' in char && char.state !== 'passive' ? 'foe' : 'cell';
}

canvas.addEventListener('pointermove', (event) => {
  if (event.pointerType !== 'mouse' || event.buttons !== 0 || !session?.world || overlayOpen()) return;
  const cell = cellUnder(event.clientX, event.clientY);
  if (cell === hover.cell) return;
  hideHover();
  hover.cell = cell;
  if (cell < 0) return;
  const kind = hoverKind(cell);
  hover.frame.className = `pd-hover${kind === 'foe' ? ' foe' : ''}`;
  hover.frame.style.display = kind ? '' : 'none';
  placeHover();
});
canvas.addEventListener('pointerleave', hideHover);
canvas.addEventListener('pointerdown', hideHover);
// The right button: what the cell is, as «examine» and a tap with it do.
canvas.addEventListener('contextmenu', (event) => {
  event.preventDefault();
  hideHover();
  const cell = cellUnder(event.clientX, event.clientY);
  if (cell >= 0 && session?.world && !overlayOpen()) examineCell(cell);
});

/** The hovered cell's corners follow the map as the camera moves. */
function placeHover(): void {
  if (hover.cell < 0 || hover.frame.style.display === 'none') return;
  const rect = canvas.getBoundingClientRect();
  const k = rect.width / canvas.width;
  const size = TILE * camera.zoom * k;
  hover.frame.style.left = `${rect.left + ((hover.cell % WIDTH) * TILE - camera.x) * camera.zoom * k}px`;
  hover.frame.style.top = `${rect.top + (Math.trunc(hover.cell / WIDTH) * TILE - camera.y) * camera.zoom * k}px`;
  hover.frame.style.width = hover.frame.style.height = `${size}px`;
}

function tapAt(px: number, py: number): void {
  if (!session?.world || overlayOpen()) return;
  // A region's intro is read first: the tap that skips it does nothing else.
  if (view.skipIntro(fx.now)) return;
  const x = Math.floor((camera.x + px / camera.zoom) / TILE);
  const y = Math.floor((camera.y + py / camera.zoom) / TILE);
  if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT) return;
  if (examining) {
    examining = false;
    examineCell(x + y * WIDTH);
    return;
  }
  tapCell(x + y * WIDTH);
}

/** The examine tool is on: the next tap on the map tells what is there. */
let examining = false;

/** What is at a cell: a monster or hero in sight, an item lying there, or the terrain. */
function examineCell(pos: number): void {
  const world = session?.world;
  const me = world && heroById(world, session!.myId);
  if (!world || !me) return;
  if (!exploredCells(world, me.depth)[pos]) {
    view.say(t.examineUnknown, '#cccccc');
    return;
  }
  const seen = visibleCells(world, me.depth)[pos];
  const char = seen ? charAt(world, me.depth, pos) : undefined;
  if (char && 'kind' in char) {
    const state = char.state === 'passive' ? '' : t.mobStates[char.state] ?? '';
    const health = char.state === 'passive' ? '' : t.examineHealth(Math.max(0, char.hp), char.ht);
    showInfo(t.mobs[char.kind], [mobDescription(char), state], hideOverlay, {
      icon: portrait(char.kind),
      ...(health ? { health: [Math.max(0, char.hp), char.ht] as const } : {}),
    });
    return;
  }
  if (char) {
    showInfo(char.name, [`${capitalize(t.classes[char.heroClass])}, ${t.levelShort} ${char.lvl}`], hideOverlay, {
      icon: portrait(char.heroClass, armorTier(char)),
      health: [Math.max(0, char.hp), char.ht],
    });
    return;
  }
  const heap = world.floors[me.depth]?.heaps.find((h) => h.pos === pos && h.kind !== 'hidden');
  if (heap && (seen || heap.kind !== 'heap')) {
    if (heap.kind === 'heap' || heap.kind === 'forSale') {
      const item = heap.items[0]!;
      showInfo(itemName(world, item), itemInfo(world, me, item), hideOverlay, { icon: slot(world, item, { hero: me }) });
    } else {
      showInfo(t.heapNames[heap.kind] ?? '', [], hideOverlay);
    }
    return;
  }
  const plant = world.floors[me.depth]?.plants?.find((p) => p.pos === pos);
  const level = levelAt(world, me.depth);
  const { name, desc } = plant ? plantText(plant.kind) : tileText(level.map[pos]!);
  const well = level.map[pos] === T.WELL ? level.wells.find((w) => w.pos === pos) : undefined;
  // Level.tileDesc: and what covers it (Web.tileDesc).
  const webbed = seen && world.floors[me.depth]?.gas?.web?.some(([cell]) => cell === pos);
  showInfo(name, [well ? wellText(well.water) : desc, ...(webbed ? [t.webHere] : [])], hideOverlay);
}

function startResting(): void {
  const world = session?.world;
  const me = world && heroById(world, session!.myId);
  walk.reset();
  if (me && isStarving(me)) {
    view.say(t.tooHungryToRest, '#ff4444');
    return;
  }
  walk.resting = true;
  view.say(t.resting, '#cccccc');
}

/** The direction key held down, if any: the hero walks on while it is. */
const held = { code: '', dx: 0, dy: 0, striding: false };
addEventListener('keyup', (event) => {
  if (event.code !== held.code) return;
  held.code = '';
  // Live turns: the stride the key began stops with it.
  if (held.striding && session?.beatMs != null) send({ type: 'plan', steps: [] }, performance.now());
  held.striding = false;
});
addEventListener('blur', () => {
  held.code = '';
});

const KEYS: Record<string, [number, number]> = {
  ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
  KeyW: [0, -1], KeyS: [0, 1], KeyA: [-1, 0], KeyD: [1, 0],
  KeyQ: [-1, -1], KeyE: [1, -1], KeyZ: [-1, 1], KeyC: [1, 1],
  Numpad8: [0, -1], Numpad2: [0, 1], Numpad4: [-1, 0], Numpad6: [1, 0],
  Numpad7: [-1, -1], Numpad9: [1, -1], Numpad1: [-1, 1], Numpad3: [1, 1],
};

addEventListener('keydown', (event) => {
  const world = session?.world;
  const me = world && heroById(world, session!.myId);
  if (!world || !me || overlayOpen()) {
    if (event.code === 'Escape' && session && overlayOpen()) closeOverlay();
    return;
  }
  const dir = KEYS[event.code];
  if (dir) {
    // Held down, the walking goes on by itself (see step); the keyboard's repeats are not needed.
    if (!event.repeat) {
      held.code = event.code;
      held.dx = dir[0];
      held.dy = dir[1];
      const next = me.pos + dir[0] + dir[1] * WIDTH;
      const there = visibleCells(world, me.depth)[next] ? charAt(world, me.depth, next) : undefined;
      if (session!.beatMs !== null && !aim && !(there && 'kind' in there && !swapsWithHero(there)) && !heapAt(world, me.depth, next)) {
        // Live turns: the hero strides on while the key is down (see keyup); never into a fight.
        walk.reset();
        held.striding = true;
        send({ type: 'plan', steps: [{ type: 'stride', dx: dir[0], dy: dir[1] }] }, performance.now());
      } else {
        // A monster there is struck once a press; anything else, as a tap.
        if (session!.beatMs !== null && there && 'kind' in there && !swapsWithHero(there) && !aim) {
          walk.reset();
          send({ type: 'attack', target: there.id }, performance.now());
        } else {
          tapCell(next);
        }
      }
    }
  } else if (event.code === 'Space' || event.code === 'Numpad5' || event.code === 'Period') {
    act('wait');
  } else if (event.code === 'KeyR') {
    startResting();
  } else if (event.code === 'KeyF') {
    act('search');
  } else if (event.code === 'KeyI') {
    openBackpack();
  } else if (event.code === 'KeyG') {
    if (heapAt(world, me.depth, me.pos)) takeHere(world, me, performance.now());
  } else if (event.code === 'Enter') {
    tapCell(me.pos);
  } else if (event.code === 'Escape') {
    if (aim) aim = null;
    else openMenu();
  } else if (event.code === 'KeyT' || event.code === 'Digit1') {
    toggleQuickslot(0);
  } else if (event.code === 'Digit2') {
    toggleQuickslot(1);
  } else if (event.code === 'KeyX') {
    aim = null;
    examining = !examining;
  } else if (event.code === 'Tab') {
    mapControlsActions.attack();
  } else if (event.code === 'KeyV') {
    mapControlsActions.resume();
  } else if (event.code === 'KeyH') {
    mapControlsActions.home();
  } else if (event.code === 'KeyM') {
    mapControlsActions.whole();
  } else if (event.code === 'KeyJ') {
    openJournal();
  } else if (event.code === 'Equal' || event.code === 'NumpadAdd') {
    zoomTo(Math.round(zoom.target) + 1, null);
  } else if (event.code === 'Minus' || event.code === 'NumpadSubtract') {
    zoomTo(Math.round(zoom.target) - 1, null);
  } else {
    return;
  }
  event.preventDefault();
});

/* Layout */

function resize(): void {
  // Light effects draw a coarser canvas: pixel art stays crisp, there are just fewer pixels to fill.
  const dpr = Math.min(devicePixelRatio || 1, quality.light ? 1.5 : 3);
  const wide = canvas.clientWidth * dpr;
  const tall = canvas.clientHeight * dpr;
  // The art is coarse, so a canvas past a few million pixels (a big monitor, a scaled desktop, 4K)
  // is drawn at a half or a third and stretched without smoothing: the same picture, a fraction
  // of the pixels to fill every frame. Phones stay under the budget and are drawn whole.
  const budget = quality.light ? 1.6e6 : 3.3e6;
  const shrink = Math.max(1, Math.ceil(Math.sqrt((wide * tall) / budget)));
  canvas.width = Math.round(wide / shrink);
  canvas.height = Math.round(tall / shrink);
  // The size of a pixel comes from the screen, not the window: about 12 tiles across a phone's
  // narrow side, 16 across a monitor's. Resizing a window on a computer then shows more or less
  // of the dungeon, as the desktop original does, instead of zooming it. Integer zoom, for crisp
  // pixels; out to the whole level across the window, in to twice as close.
  const narrow = Math.min(canvas.width, canvas.height);
  // A wide screen (design system v12): the interface in a layer scaled by a whole number, and the
  // map's tile chosen so 27-30 cells show across and at least 13 down.
  const W = canvas.clientWidth;
  const H = canvas.clientHeight;
  const wideScreen = W >= 900;
  hud.setLayout(wideScreen, Math.max(1, Math.min(4, Math.floor(H / 720), Math.floor(W / 1100))));
  const fine = typeof matchMedia === 'function' && matchMedia('(pointer: fine)').matches;
  const screenNarrow = Math.min(screen.width || canvas.clientWidth, screen.height || canvas.clientHeight);
  // A small window (Telegram's on a computer) still shows at least 9 tiles across.
  const windowNarrow = Math.min(canvas.clientWidth, canvas.clientHeight);
  const cssScale = wideScreen
    ? Math.max(2, Math.min(Math.round(W / 448), Math.floor(H / 208)))
    : Math.max(1, Math.min(Math.round(screenNarrow / (TILE * (fine ? 16 : 12))), Math.floor(windowNarrow / (TILE * 9))));
  zoom.base = Math.max(1, Math.round((cssScale * dpr) / shrink));
  zoom.min = Math.max(1, Math.min(zoom.base, Math.floor(narrow / (TILE * WIDTH))));
  zoom.max = Math.max(zoom.base + 2, zoom.base * 2);
  zoom.target = clampZoom(zoom.base + zoom.delta);
  camera.zoom = zoom.target;
}

/** Toasts appear just under the HUD, however tall it has grown (buffs, companions, a notice). */
let hudBottom = -1;

function placeToasts(): void {
  const bottom = Math.round(hud.height());
  if (bottom === hudBottom) return;
  hudBottom = bottom;
  document.documentElement.style.setProperty('--hud-bottom', `${bottom}px`);
}
addEventListener('resize', resize);
onLayoutChange(() => requestAnimationFrame(resize));
resize();

/* Frame loop */

/** Stands in for the hero while an online session is still connecting. */
const placeholderHero: Hero = createHero({ id: '', name: '', heroClass: 'warrior' }, 1, 0, 0);

let baked: HTMLCanvasElement | null = null;
let bakedKey = '';
/** The map the baked tiles show, and for which depth and world. */
let bakedMap = new Uint8Array(0);
let bakedFor = '';
let visible: boolean[] = [];
let busySince = 0;

/** A quiet dungeon behind the title screen. */
const backdrop = (() => {
  const world = createWorld(20240501);
  const level = levelAt(world, 1);
  const all = new Array<boolean>(level.map.length).fill(true);
  return { level, baked: bakeLevel(level, assets), all, view: new View(assets) };
})();

/** What I picked up, waiting for its moment to set off (motion.ts). */
let launches: Launch[] = [];

/**
 * What is picked up flies from where it lay into the backpack on the toolbar:
 * it leaves the floor at the size it had there, swings up in a smooth arc and
 * shrinks into the pack, which gives a little hop as it lands.
 */
function flyToBag(launch: Launch): void {
  const bag = document.querySelector<HTMLElement>('.pd-tool.bag');
  if (!bag || quality.reducedMotion) return;
  // World pixels to CSS pixels.
  const scale = camera.zoom / (canvas.width / (canvas.clientWidth || canvas.width));
  const rect = canvas.getBoundingClientRect();
  const x = rect.left + (launch.x - camera.x) * scale;
  const y = rect.top + (launch.y - camera.y) * scale;
  const target = bag.getBoundingClientRect();
  const icon = document.createElement('i');
  icon.className = 'pd-item pd-flying';
  icon.style.setProperty('--ix', String(launch.sprite % 16));
  icon.style.setProperty('--iy', String(Math.floor(launch.sprite / 16)));
  icon.style.left = `${x - 16}px`;
  icon.style.top = `${y - 16}px`;
  document.body.append(icon);
  // Should the animation never finish (a hidden tab), the icon does not linger.
  const lost = window.setTimeout(() => icon.remove(), 1500);
  const dx = target.left + target.width / 2 - x;
  const dy = target.top + target.height / 2 - y;
  // The icon is 32 CSS pixels; on the floor the item was 16 world pixels.
  const from = (16 * scale) / 32;
  const to = 0.6;
  // A quadratic arc through a point above the start, sampled so the path stays a curve.
  const cx = dx * 0.25;
  const cy = Math.min(0, dy) - 70;
  const frames: Keyframe[] = [];
  for (let i = 0; i <= 16; i++) {
    const k = i / 16;
    const px = 2 * (1 - k) * k * cx + k * k * dx;
    const py = 2 * (1 - k) * k * cy + k * k * dy;
    const s = from + (to - from) * k * k + Math.sin(k * Math.PI) * 0.15;
    frames.push({ transform: `translate(${px}px, ${py}px) scale(${s}) rotate(${Math.sin(k * Math.PI) * -12}deg)`, opacity: k > 0.9 ? 1 - (k - 0.9) * 5 : 1 });
  }
  audio.play('whoosh', 1.1, 0.25);
  icon.animate(frames, { duration: 560, easing: 'cubic-bezier(0.45, 0, 0.6, 1)' }).finished.then(() => {
    clearTimeout(lost);
    icon.remove();
    bag.classList.remove('got');
    void bag.offsetWidth;
    bag.classList.add('got');
    audio.play('pop', 1, 0.3);
  }, () => icon.remove());
}

/** When the low-health heartbeat last pulsed, on the visual clock. */
let lastBeat = 0;

/** Which foot: footsteps alternate a touch in pitch. */
let stride = 1;

/** The soft camera: where it looks, eased after the hero (see tick). */
const follow = { x: 0, y: 0, depth: 0, ready: false };
/** How far behind the camera trails: the time it takes to close two thirds of the gap. */
const CAMERA_LAG_MS = 85;

/** When the last game frame was drawn, for telling a phone that struggles. */
let lastFrame = 0;
/** Since when the party has been waiting for my move (0: it is not), and whether I have been told. */
let holdingSince = 0;
/** The wait for companions last written in the co-op log. */
const loggedWait = { count: 0, since: 0 };
let holdingFelt = false;

/** The middle of the free band, in device pixels, eased from frame to frame; -1 until known. */
let freeMiddle = -1;
let freeDepth = 0;

/** Where my hero was last frame, for footstep and stairs sounds. */
let lastPlace = { generation: -1, depth: 0, pos: -1 };

/** The hero's light (#vignette): moved by the compositor to wherever the hero is on screen. */
const vignette = document.getElementById('vignette');
let vignetteState = '';

function placeVignette(on: boolean, x = 0, y = 0): void {
  if (!vignette) return;
  // Canvas pixels to CSS pixels.
  const css = (canvas.clientWidth || canvas.width) / canvas.width;
  const inner = Math.round(TILE * camera.zoom * 3 * css);
  const outer = Math.round(Math.max(canvas.clientWidth, canvas.clientHeight) * 0.7);
  const state = on ? `${Math.round(x * css)},${Math.round(y * css)},${inner},${outer}` : 'off';
  if (state === vignetteState) return;
  vignetteState = state;
  vignette.classList.toggle('on', on);
  if (!on) return;
  // Its middle sits on the screen's corner (game.css); moved from there onto the hero.
  vignette.style.transform = `translate(${Math.round(x * css)}px, ${Math.round(y * css)}px)`;
  vignette.style.setProperty('--inner', `${inner}px`);
  vignette.style.setProperty('--outer', `${outer}px`);
}

function drawBackdrop(now: number): void {
  placeVignette(false);
  const { level, all } = backdrop;
  const middle = levelMiddle(level);
  camera.x = Math.round(middle.x - canvas.width / camera.zoom / 2 + Math.sin(now / 9000) * 60);
  camera.y = Math.round(middle.y - canvas.height / camera.zoom / 2 + Math.cos(now / 11000) * 40);
  render(
    ctx, { level, baked: backdrop.baked, visible: all, explored: all, heaps: [], seeAll: false },
    backdrop.view, '', assets, camera, now,
  );
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = 'rgba(15, 13, 13, 0.6)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

/** Under a window the map is drawn at 15 frames a second: dimmed and still, it needs no more, and the window's taps and scrolling get the phone to themselves. */
const UNDER_WINDOW_MS = 66;
let lastUnderWindow = 0;

/** Frames of the co-op log's current stretch: how many, how many slow, the slowest (ms). */
const frames = { count: 0, slow: 0, worst: 0, since: 0, prev: 0, sentAt: 0 };

/** Writes how smoothly frames came, every 15 s of online play; and sends the log every few minutes, to see what players feel. */
function noteFrame(now: number): void {
  const dt = frames.prev ? now - frames.prev : 0;
  frames.prev = now;
  if (session?.mode !== 'online' || document.hidden) {
    frames.since = now;
    return;
  }
  if (!frames.since) frames.since = now;
  // A window over the map draws it on purpose at 15 a second.
  if (dt > 0 && dt < 2000 && !windowOverMap()) {
    frames.count++;
    if (dt > 100) frames.slow++;
    frames.worst = Math.max(frames.worst, dt);
  }
  if (now - frames.since >= 15_000) {
    const seconds = (now - frames.since) / 1000;
    netlog(`frames: ${Math.round(frames.count / seconds)} a second, ${frames.slow} slow (>100 ms), worst ${Math.round(frames.worst)} ms`);
    Object.assign(frames, { count: 0, slow: 0, worst: 0, since: now });
  }
  if (!frames.sentAt) frames.sentAt = now;
  else if (now - frames.sentAt > 4 * 60_000) {
    frames.sentAt = now;
    sendNetlog('periodic');
  }
}

function frame(now: number): void {
  requestAnimationFrame(frame);
  noteFrame(now);
  if (session && windowOverMap()) {
    if (now - lastUnderWindow < UNDER_WINDOW_MS) return;
    lastUnderWindow = now;
    // These slow frames are on purpose: «auto» effects must not take them for a struggling phone.
    lastFrame = now;
  }
  tick(now);
}

function tick(now: number): void {
  if (!session) {
    drawBackdrop(now);
    return;
  }
  const world = session.world;
  const me = world && heroById(world, session.myId);
  if (!world || !me) {
    drawBackdrop(now);
    hud.update(
      {
        me: placeholderHero, party: [], online: [], log: [], buffs: [], quick: null,
        status: session.status ? { kind: session.status === t.reconnecting ? 'reconnecting' : 'connecting', text: session.status } : null,
        keys: 0, examining: false, newLoot: false, looks: {},
      },
      false,
    );
    placeToasts();
    return;
  }

  // Low on health, the edges of the view pulse red like a heartbeat, quicker the nearer death.
  if (session.world) {
    const self = heroById(session.world, session.myId);
    if (self && isAlive(self) && self.hp <= self.ht / 4) {
      const danger = 1 - self.hp / (self.ht / 4);
      const vnowBeat = fx.time(now);
      if (vnowBeat - lastBeat > 1150 - danger * 450) {
        lastBeat = vnowBeat;
        fx.flash('170, 0, 0', 0.16 + danger * 0.22, 520, vnowBeat, true);
      }
    }
  }
  // A phone that cannot keep up gets light effects («auto» in quality.ts).
  if (quality.frame(now - lastFrame)) {
    resize();
    toast(t.effectsLightened);
  }
  lastFrame = now;
  // The visual clock: real time, slowed for a moment by a heavy blow's hit-stop.
  const vnow = fx.time(now);
  if (isAlive(me)) fallenAt = 0;
  const dt = lastVisual ? vnow - lastVisual : 0;
  lastVisual = vnow;

  if (session.generation !== seenGeneration || me.depth !== view.depth) {
    if (session.generation !== seenGeneration) deathShown = -1;
    seenGeneration = session.generation;
    view.reset(me.depth);
    fx.reset();
    follow.ready = false;
    pan.x = 0;
    pan.y = 0;
    pan.home = false;
    walk.reset();
    bakedKey = '';
    threats = new Set();
  }

  const level = levelAt(world, me.depth);
  // Chunks thrown in a fight land on this floor, never in its walls.
  fx.floor = level.map;

  // Footsteps, doors and stairs of my own hero.
  if (lastPlace.generation === session.generation && isAlive(me)) {
    if (me.depth !== lastPlace.depth) {
      audio.play(justFell ? 'falling' : 'descend');
      // A new depth comes up out of the dark.
      fx.flash('0, 0, 0', 1, 650, vnow);
      // GameScene's greetings: the depth, a new region, and the level's feeling (the arena, sinking, has its own: handleArenaEffects).
      if (!world.arena) {
        view.say(justFell ? t.fell(me.depth) : me.depth > lastPlace.depth ? t.descended(me.depth) : t.ascended(me.depth));
        // Down into a new region: its card.
        if (me.depth > lastPlace.depth && me.depth % 5 === 1) view.enterRegion(me.depth, vnow);
        if (me.depth === 6 && lastPlace.depth === 5) view.say(t.enterPrison, '#ffff44');
        if (me.depth === 11 && lastPlace.depth === 10) view.say(t.enterCaves, '#ffff44');
        if (me.depth === 16 && lastPlace.depth === 15) view.say(t.enterCity, '#ffff44');
        if (me.depth === 21 && lastPlace.depth === 20) view.say(t.enterHalls, '#ffff44');
        if (me.depth === 26 && lastPlace.depth === 25) view.say(t.enterLast, '#ffff44');
        const feeling = t.feelings[level.feeling];
        if (feeling && me.depth > lastPlace.depth) view.say(feeling, '#ffff44');
      }
      justFell = false;
    } else if (me.pos !== lastPlace.pos) {
      feedback.stepped(me.pos, vnow);
      // The view comes home to the walking hero.
      if (pan.x !== 0 || pan.y !== 0) pan.home = true;
      const terrain = level.map[me.pos]!;
      // Footsteps: never quite the same twice, left foot and right a touch apart.
      stride = -stride;
      // Each surface underfoot sounds its own: stone, water, grass, the wood of a doorway, hot embers.
      const pitch = 1 + stride * 0.05;
      if (terrain >= T.WATER_TILES && terrain <= T.WATER) audio.play('water', pitch, 0.5);
      else if (terrain === T.OPEN_DOOR || terrain === T.DOOR) audio.play('stepWood', pitch, 0.55);
      else audio.play('step', pitch, 0.45);
      if (terrain === T.GRASS || terrain === T.HIGH_GRASS) audio.play('stepGrass', pitch, 0.4);
      if (terrain === T.EMBERS) audio.play('sizzle', 1.3, 0.12);
      // And what the step stirs where it left: dust, a splash, a few blades of grass.
      stepFx(level.map[lastPlace.pos] ?? terrain, lastPlace.pos, vnow);
      // Stepping onto a sign reads it.
      // Below the last shop the signs burst into flames as one reads them (Sign.read).
      const tip = t.signs[me.depth - 1] ?? t.signBurns;
      if (terrain === T.SIGN && tip) {
        if (walk.queue.length > 0 || held.code) {
          // Passed over on the way somewhere: read in passing, into the log, and the walk goes on.
          view.say(`${t.signTitle} ${tip}`, '#ffff44');
        } else {
          walk.reset();
          showSign(tip, hideOverlay);
        }
      }
    }
  }
  // Setting out: the sewers' card.
  // Setting out into the arena: its own card, the pit's name over the sewers' emblem.
  if (lastPlace.generation !== session.generation && world.arena && world.arena.wave === 0 && world.turn < 3) {
    view.arenaSinks(0, t.arena.title, t.arena.sub, vnow);
  } else if (lastPlace.generation !== session.generation && me.depth === 1 && world.turn < 3) view.enterRegion(1, vnow);
  lastPlace = { generation: session.generation, depth: me.depth, pos: me.pos };

  const key = `${me.depth}:${world.turn}:${session.generation}`;
  if (key !== bakedKey) {
    // The tiles are baked once per depth; after that only the cells that changed are redrawn.
    const where = `${me.depth}:${session.generation}`;
    if (!baked || bakedFor !== where) {
      baked = bakeLevel(level, assets);
      bakedMap = Uint8Array.from(level.map);
      bakedFor = where;
    } else {
      patchLevel(baked, bakedMap, level, assets);
    }
    visible = visibleCells(world, me.depth);
    bakedKey = key;

    learnFromSight(world, me, level, visible);
    // A newly spotted awake monster stops a walk, as in the original.
    const inSight = new Set(
      (world.floors[me.depth]?.mobs ?? [])
        .filter((m) => m.state !== 'sleeping' && m.state !== 'passive' && visible[m.pos])
        .map((m) => m.id),
    );
    // (Under live turns the player steers as things happen, and a fight slows the clock: a walk goes on.)
    if ([...inSight].some((id) => !threats.has(id))) {
      walk.queue = [];
      walk.stairs = null;
    }
    threats = inSight;
  }

  const effects = session.drain();
  if (effects.length > 0) {
    view.apply(effects, world, session.myId, vnow);
    // The backpack, if open, shows the pack as it is now (an item put on, dropped, picked up).
    const mine = session.myId;
    if (effects.some((e) => ('hero' in e && e.hero === mine) || ('who' in e && e.who === mine))) refreshBackpack(world, me);
    for (const effect of effects) effectFx(effect, view, world, session.myId, vnow);
    motion.effects(effects, world, me.depth, (e) => itemSprite(e.item, world.run.labels));
    scenery.effects(effects, me.depth, vnow);
    handleMyEffects(effects, session.myId);
    if (world.arena) handleArenaEffects(effects, world, me, vnow);
  }
  // An online session learns my class with its first snapshot: wear the look for it.
  if (!session.looks[session.myId] && session.mode === 'solo') putOnLook();
  view.looks = session.looks;
  // Live turns: a step on screen lasts the room's beat, so walks run on without a pause.
  view.stepMs = session.beatMs ?? STEP_MS;
  view.sync(world, vnow, session.myId);
  step(world, now, visible);
  fx.update(vnow, dt);
  ambientFx(view, vnow, dt);
  regionFx(level, visible, vnow, dt);

  const mine = view.puppets.get(me.id);
  const at = mine ? view.position(mine, vnow) : { x: cellX(me.pos) * TILE, y: cellY(me.pos) * TILE };
  // The world is heard from where the hero stands; each region has its air; a window over the
  // game, or the hero fallen, muffles the music.
  audio.listen(at.x + TILE / 2, at.y + TILE / 2);
  // The last shop (depth 21) sounds and looks like the city it was built in, though the halls' tune plays
  // there; the arena of waves takes its tier's look and tune.
  const region = level.region ?? regionIndex(me.depth);
  audio.ambience(levelRegion(level));
  preloadSheets(levelRegion(level));
  // Each region has its tune, and a boss fight its own while it lasts.
  if (bossFight && (bossFight.session !== session || bossFight.generation !== session.generation || bossFight.depth !== me.depth)) bossFight = null;
  // A champions' wave in the arena is a boss fight from its first monster to its last.
  const champions = world.arena?.phase === 'fight' && core.isChampionsWave(world.arena.wave);
  audio.playMusic(bossFight || champions ? 'boss' : REGION_MUSIC[region]!);
  audio.muffle(overlayOpen() || !isAlive(me));
  const kick = fx.shakeOffset(vnow);
  // The hero stands in the middle of the band the HUD and the toolbar leave free, not of the screen.
  // When that band changes (a buff, a notice, companions), the view glides there rather than jumps.
  const free = hud.freeZone();
  const wanted = ((free.top + free.bottom) / 2) * (canvas.height / (canvas.clientHeight || 1));
  freeMiddle = freeMiddle < 0 || view.depth !== freeDepth ? wanted : freeMiddle + (wanted - freeMiddle) * Math.min(1, dt / 140);
  freeDepth = view.depth;
  const middle = freeMiddle;
  // The view follows the hero softly: it eases after them (a short exponential lag), so a walk
  // starts and stops with a little weight instead of the map jerking under them. A jump of
  // more than a few cells (a new depth, a teleport, a fall) is not followed but cut to.
  // The zoom glides to its level, round its anchor (the fingers, the cursor, or the hero).
  if (gesture?.kind !== 'pinch' && camera.zoom !== zoom.target) {
    const z = Math.abs(zoom.target - camera.zoom) < 0.004
      ? zoom.target
      : camera.zoom + (zoom.target - camera.zoom) * (1 - Math.exp(-Math.max(0, dt) / 70));
    applyZoom(z, zoomAnchor ?? { x: canvas.width / 2, y: middle });
    if (z === zoom.target) zoomAnchor = null;
  }
  // A step brings the view home from wherever it was dragged.
  if (pan.home) {
    const back = Math.exp(-Math.max(0, dt) / 110);
    pan.x *= back;
    pan.y *= back;
    if (Math.hypot(pan.x, pan.y) < 0.05) {
      pan.x = 0;
      pan.y = 0;
      pan.home = false;
    }
  }
  // Not so far that the level leaves the screen.
  const reach = (WIDTH * TILE) / 2;
  pan.x = Math.max(-reach, Math.min(reach, pan.x));
  pan.y = Math.max(-reach, Math.min(reach, pan.y));
  const targetX = at.x + TILE / 2 - canvas.width / camera.zoom / 2 + pan.x;
  const targetY = at.y + TILE / 2 - middle / camera.zoom + pan.y;
  const dragging = gesture?.kind === 'pan' || gesture?.kind === 'pinch';
  const far = !dragging && Math.hypot(targetX - follow.x, targetY - follow.y) > TILE * 4 && !pan.home;
  if (dragging && follow.ready && follow.depth === me.depth) {
    // Under the finger the map moves with it, not after it.
    follow.x = targetX;
    follow.y = targetY;
  } else if (!follow.ready || far || follow.depth !== me.depth) {
    follow.x = targetX;
    follow.y = targetY;
  } else {
    const ease = 1 - Math.exp(-Math.max(0, dt) / CAMERA_LAG_MS);
    follow.x += (targetX - follow.x) * ease;
    follow.y += (targetY - follow.y) * ease;
  }
  follow.ready = true;
  follow.depth = me.depth;
  camera.x = follow.x + kick.x;
  camera.y = follow.y + kick.y;
  // What lies hidden (the phantom fish) is not drawn until found.
  const heaps = (world.floors[me.depth]?.heaps ?? []).filter((heap) => heap.kind !== 'hidden').map((heap) => ({
    pos: heap.pos,
    sprite: heap.kind === 'heap' || heap.kind === 'forSale' ? itemSprite(heap.items[0]!, world.run.labels) : HEAP_SPRITES[heap.kind],
    // Rings and wands lying about glow, gold and blue.
    ...(heap.kind === 'heap' && heap.items[0]!.kind.startsWith('ring.') ? { aura: '#ffd27a' }
      : heap.kind === 'heap' && heap.items[0]!.kind.startsWith('wand.') ? { aura: '#8fc4ff' } : {}),
  }));
  motion.update(level, heaps, visible, view, session.myId, `${session.generation}:${me.depth}`, vnow);
  for (const launch of motion.takeLaunches()) if (!launch.gold) launches.push(launch);
  launches = launches.filter((launch) => {
    if (launch.at > vnow) return true;
    flyToBag(launch);
    return false;
  });
  const plants = (world.floors[me.depth]?.plants ?? []).map((p) => ({ pos: p.pos, index: PLANT_KINDS.indexOf(p.kind) }));
  // Clouds of gas: green toxic, yellow paralytic.
  const clouds = world.floors[me.depth]?.gas ?? {};
  const gas = [
    ...(clouds.toxic ?? []).map(([pos, volume]) => ({ pos, volume, color: '80, 200, 60' })),
    ...(clouds.paralytic ?? []).map(([pos, volume]) => ({ pos, volume, color: '230, 220, 70' })),
  ];
  const webs = (clouds.web ?? []).map(([pos, volume]) => ({ pos, volume }));
  const explored = exploredCells(world, me.depth);
  const scene = {
    level, baked: baked!, visible, explored, heaps, plants, gas, webs, seeAll: me.mindVision > 0,
      ...((world.floors[me.depth]?.altar?.volume ?? 0) > 0 ? { altar: world.floors[me.depth]!.altar!.pos } : {}),
    focus: { x: at.x + TILE / 2, y: at.y + TILE / 2 },
    lights: world.arena ? [...lightsFor(level, visible, view, vnow), ...arenaView.lights(level, visible, vnow)] : lightsFor(level, visible, view, vnow),
    heapLook: (pos: number, at: number) => motion.heapLook(pos, at),
    under: (c: CanvasRenderingContext2D) => {
      scenery.draw(c, level, visible, explored, vnow);
      motion.draw(c, level, visible, explored, vnow);
      if (world.arena) arenaView.draw(c, level, explored, vnow, world.arena.phase === 'rest');
    },
    over: (c: CanvasRenderingContext2D) => {
      motion.drawOver(c, vnow);
      feedback.draw(
        c, walk.queue, (id) => mobById(world, me.depth, id)?.pos,
        walk.queue.length === 0 && !walk.chase && !session!.busy, vnow,
      );
    },
    mourning: isAlive(me) ? 0 : Math.min(1, (vnow - (fallenAt ||= vnow)) / 1200),
    middle,
    // The cards sit above the hero, not on them: a third of the way down the free band.
    cardY: (free.top + (free.bottom - free.top) * 0.3) * (canvas.height / (canvas.clientHeight || 1)),
  };
  // The arena's wall and stands stand in the light of the crowd's own torches, whatever the party sees.
  render(ctx, world.arena ? { ...scene, visible: arenaView.shown(level, visible) } : scene, view, session.myId, assets, camera, vnow);
  coop.frame(ctx, { session, world, view, camera, free, now: vnow });
  placeVignette(!quality.light, (scene.focus.x - camera.x) * camera.zoom, (scene.focus.y - camera.y) * camera.zoom);
  mapControls.update(
    Math.round(zoom.target) < zoom.max, Math.round(zoom.target) > zoom.min, Math.hypot(pan.x, pan.y) > TILE * 1.5 && !pan.home,
    document.querySelector<HTMLElement>('#ui .pd-log')?.offsetHeight ?? 120,
  );
  // The attack indicator and «go on», right there on the map's column.
  if (walk.goal === me.pos) walk.goal = null;
  const foe = isAlive(me) ? attackTarget(world, me) : null;
  placeHover();
  hints.pump();
  if (overlayOpen() && hover.cell >= 0) hideHover();
  mapControls.indicators(
    foe ? { key: `${foe.id}:${foe.kind}`, portrait: () => portrait(foe.kind) } : null,
    // «Go on»: a walk stopped short of where it was headed (under live turns, the plan ran out before the goal).
    isAlive(me) && walk.goal !== null && (session.beatMs !== null
      ? !me.plan?.length && me.pos !== walk.goal
      : walk.queue.length === 0 && !walk.chase && !session.busy),
  );
  coachMove(me);

  // Who the dungeon is waiting for, once my action has been queued for a moment. Under live turns, the
  // companions a fight waits for once I have made my move (and none while it waits for mine).
  const live = session.beatMs !== null;
  const holders = live ? liveBlockers(world) : blockers(world);
  if (session.busy) busySince ||= now;
  else busySince = 0;
  const waitingFor =
    (live ? !holders.includes(me.id) : busySince && now - busySince > 400)
      ? holders.filter((id) => id !== me.id).map((id) => heroById(world, id)?.name ?? '?')
      : [];
  // Waits, written in the co-op log: how many companions and how long (a long one sends the log).
  const waitingNow = waitingFor.length;
  if (waitingNow !== loggedWait.count) {
    if (loggedWait.count > 0) {
      const lasted = now - loggedWait.since;
      netlog(`waited ${(lasted / 1000).toFixed(1)} s for ${loggedWait.count} companion(s)`);
      if (lasted > 4000 && session.mode === 'online') sendNetlog('long wait');
    }
    if (waitingNow > 0) {
    netlog(`waiting for ${waitingNow} companion(s)`);
    hints.first('waiting');
  }
    loggedWait.count = waitingNow;
    loggedWait.since = now;
  }
  // The other way round: the party is held up by me. Said (and felt) once it lasts a moment.
  const holdingUp = session.mode === 'online' && isAlive(me) && !session.busy && holders.includes(me.id);
  if (holdingUp) {
    if (!holdingSince) holdingSince = now;
    else if (!holdingFelt && now - holdingSince > 700) {
      holdingFelt = true;
      haptic('hit');
    }
  } else {
    holdingSince = 0;
    holdingFelt = false;
  }
  const quickItem = me.items[quickIndex(me, 0)];
  const quickItem2 = hud.wide ? me.items[quickIndex(me, 1)] : undefined;
  const quickState = (item: Item | undefined, aiming: boolean): QuickState | null =>
    item
      ? {
          sprite: itemSprite(item, world.run.labels),
          label: chargesOf(item) ?? (item.qty > 1 ? String(item.qty) : ''),
          aiming,
          wear: wearOf(world, item),
        }
      : null;
  const cancelChoice = (): void => {
    aim = null;
    examining = false;
  };
  // One state at a time, the most pressing: the connection, death, a target to choose, examining, companions.
  const aimed = aim && aim.index >= 0 ? me.items[aim.index] : undefined;
  const status: HudStatus | null =
    session.status ? { kind: session.status === t.reconnecting ? 'reconnecting' : 'connecting', text: session.status }
    : !isAlive(me) && !world.over ? { kind: 'dead', text: `${t.youDied}. ${world.arena ? t.arena.fallenCoop : t.youDiedCoop}` }
    : aim ? { kind: 'target', text: t.chooseTarget, cancel: { label: t.cancel, onClick: cancelChoice }, ...(aimed ? { item: itemSprite(aimed, world.run.labels) } : {}) }
    : examining ? { kind: 'examine', text: t.examinePrompt, cancel: { label: t.cancel, onClick: cancelChoice } }
    : waitingFor.length > 0 ? { kind: 'waiting', text: t.waitingShort, names: waitingFor }
    : holdingFelt ? { kind: 'waiting', text: t.partyWaitsForYou }
    : null;
  hud.update(
    {
      me,
      party: session.mode === 'online' ? world.heroes.filter((h) => h.id !== me.id) : [],
      online: session.online,
      status,
      log: view.log,
      buffs: heroBuffs(me),
      examining,
      newLoot,
      looks: session.looks,
      keys: me.items.filter((i) => (i.kind === 'key.iron' || i.kind === 'key.skeleton') && i.depth === me.depth).length,
      quick: quickState(quickItem, aim !== null && aim.index === quickIndex(me, 0)),
      quick2: quickState(quickItem2, aim !== null && aim.index === quickIndex(me, 1)),
      waitingFor: session.mode === 'online' ? holders.filter((id) => id !== me.id) : [],
      arena: arenaHud(world, me, session.mode === 'online'),
    },
    walk.resting,
  );
  placeToasts();
  // The arena's reward: up as soon as nothing else is, gone if the wave began meanwhile (a companion's «To battle!»).
  if (world.arena && !world.over) {
    const offer = world.arena.offers[me.id];
    if (offer && isAlive(me) && !overlayOpen() && world.arena.phase === 'rest') {
      rewardOpen = true;
      walk.reset();
      showArenaReward({
        world, hero: me, wave: world.arena.wave, items: offer, coop: session.mode === 'online',
        onTake: (index) => {
          rewardOpen = false;
          send({ type: 'arenaPick', choice: index }, performance.now());
        },
      });
    } else if (!offer && rewardOpen) {
      rewardOpen = false;
      hideOverlay();
    }
  }

  // Bones laid on their depth are this run's now: the device forgets them.
  if (bonesGiven && world.bones?.placed) {
    bonesGiven = false;
    forget(BONES_KEY);
  }
  if (world.over && deathShown !== session.generation && world.arena) {
    deathShown = session.generation;
    showArenaRunEnd(world, me, session.mode === 'solo');
  }
  if (world.over && deathShown !== session.generation) {
    deathShown = session.generation;
    const solo = session.mode === 'solo';
    const victory = world.victory;
    // Bones.leave: a hero fallen alone in an ordinary run leaves something for the next.
    if (!victory && solo && !dailyRun && !session.checked) store(BONES_KEY, JSON.stringify(leaveBones(me, Math.floor(Math.random() * 4), Math.random())));
    if (victory) {
      audio.play('levelup');
      haptic('success');
    }
    // A checked run's end as the server scores it (its places on the boards); none for one played on the device alone.
    const answer = session.checked ? session.checked.finished() : null;
    if (answer) void answer.then((reply) => reply?.badges && announceBadges(reply.badges.filter((id) => !earnedBadges().has(id))));
    const deepestNow = Object.keys(world.levels).length;
    // Scored as the server scores it (core verify.ts runOutcome: challenges raise it).
    const scoreNow = core.runOutcome(world, me).score;
    const killer = me.killedBy && (t.causes[me.killedBy] ?? t.mobs[me.killedBy as MobKind] ?? t.classes[me.killedBy as HeroClass] ?? me.killedBy);
    const shareText = dailyRun ? t.shareText(scoreNow, deepestNow) : t.shareTextRun(scoreNow, deepestNow);
    const share = shareChoices(async () => {
      const reply = answer ? await answer : null;
      return {
        name: me.name || playerName || telegramName() || t.heroLabel, heroClass: me.heroClass, level: me.lvl, depth: deepestNow, score: scoreNow,
        place: reply?.places?.daily ?? reply?.places?.week ?? null, won: victory, cause: killer ? capitalize(t.killedBy(killer)) : t.soloFell(me.depth),
        title: dailyRun ? undefined : 'Pixel Dungeon',
      };
    }, shareText, 'daily');
    window.setTimeout(() => {
      if (!session?.world?.over) return;
      if (!victory) haptic('error');
      const cause = me.killedBy && (t.causes[me.killedBy] ?? t.mobs[me.killedBy as MobKind] ?? t.classes[me.killedBy as HeroClass] ?? me.killedBy);
      // Rankings: the run takes its place among this device's best.
      const deepest = Object.keys(world.levels).length;
      const gold = me.stats?.gold ?? me.gold;
      const place = recordRun({
        key: `${world.run.seed}:${me.id}:${world.turn}`,
        score: scoreNow,
        name: me.name || playerName || telegramName() || t.heroLabel,
        heroClass: me.heroClass,
        lvl: me.lvl,
        depth: deepest,
        gold,
        won: victory,
        cause: cause ? capitalize(cause) : '',
        mode: dailyRun ? 'daily' : solo ? 'solo' : 'coop',
        date: Date.now(),
      });
      // The table and the badges follow the account (cloud.ts).
      pushCloud();
      showRunEnd({
        place,
        victory,
        title: victory ? (world.ending === 'surface' ? t.happyEnd : t.victory) : solo ? t.youDied : t.partyFell,
        cause: victory ? (world.ending === 'surface' ? t.happyEndText : t.victoryText) : [t.soloFell(me.depth), cause ? t.killedBy(cause) : ''].filter(Boolean).join(' '),
        hero: { name: me.name || playerName || telegramName() || t.heroLabel, heroClass: me.heroClass, lvl: me.lvl, depth: me.depth, gold: me.gold, kills: me.kills },
        restartLabel: victory ? t.newRun : solo ? t.tryAgain : t.restartRun,
        onRestart: () => {
          session?.restart();
          hideOverlay();
        },
        onExit: () => toTitle(),
        score: scoreNow,
        ranking: rankingBlock(answer),
        onBoards: api ? () => openBoards(dailyRun ? 'daily' : 'week') : undefined,
        share,
      });
    }, 1200);
  }
}

/** The arena's board, «To battle!» and who is ready, for the HUD; null in the dungeon. */
function arenaHud(world: World, me: Hero, coop: boolean): ArenaHud | null {
  const arena = world.arena;
  if (!arena) return null;
  const living = world.heroes.filter(isAlive);
  const left = core.arenaRemaining(world);
  // A swarm that splits makes a wave bigger than it came.
  const total = Math.max(arena.count, left, 1);
  const rest = arena.phase === 'rest';
  const mates: Record<string, 'ready' | 'picking' | 'resting'> = {};
  if (rest) for (const hero of living) mates[hero.id] = arena.ready.includes(hero.id) ? 'ready' : arena.offers[hero.id] ? 'picking' : 'resting';
  return {
    phase: arena.phase,
    wave: arena.wave,
    left,
    beaten: rest ? 1 : 1 - left / total,
    champions: core.isChampionsWave(arena.wave),
    ready: coop ? [living.filter((hero) => arena.ready.includes(hero.id)).length, living.length] : null,
    waiting: coop ? living.filter((hero) => hero.id !== me.id && !arena.ready.includes(hero.id)).map((hero) => hero.name) : [],
    meReady: arena.ready.includes(me.id),
    mates,
  };
}

/** What the arena's effects mean for the screen: banners, the crowd, the log, the gates' sound. */
function handleArenaEffects(effects: readonly Effect[], world: World, me: Hero, now: number): void {
  for (const effect of effects) {
    switch (effect.type) {
      case 'arenaWave': {
        const boss = effect.boss;
        const kind = boss ? 'boss' : effect.champions ? 'champions' : '';
        const sub = boss ? t.arena.bossComes(t.mobs[boss]) : effect.champions ? t.arena.champions : t.regionNames[effect.tier] ?? '';
        view.waveBanner(t.arena.wave(effect.wave), sub, kind, now);
        view.say(t.arena.gatesRise(effect.wave), '#ff9933');
        audio.play(effect.champions ? 'boss' : 'alert', 1, 0.8);
        haptic('hit');
        break;
      }
      case 'arenaGates':
        if (effect.depth === me.depth && effect.cells.length > 0) {
          // The nearest gate is the one heard.
          const near = effect.cells.reduce((best, cell) => (distance(cell, me.pos) < distance(best, me.pos) ? cell : best));
          arenaView.gatesMoved(effect.open, near);
        }
        break;
      case 'arenaCleared':
        view.say(t.arena.beaten(effect.wave), '#44ff44');
        view.say(t.arena.crowd, '#ffff44');
        arenaView.cheer(now);
        haptic('success');
        break;
      case 'arenaSinks': {
        const region = t.regionNames[effect.tier] ?? '';
        view.arenaSinks(effect.tier, region, t.arena.sinks, now);
        view.say(t.arena.sunk(region), '#ffff44');
        audio.play('descend');
        break;
      }
      case 'arenaReady':
        if (effect.ready && effect.hero !== me.id && session?.mode === 'online') view.say(t.arena.isReady(heroById(world, effect.hero)?.name ?? ''), '#5ec8c0');
        break;
      case 'arenaOffer':
        if (effect.hero === me.id) view.say(t.arena.pickReward, '#ffff44');
        break;
      case 'revived':
        if (effect.hero === me.id) view.say(t.arena.rose, '#44ff44');
        break;
      default:
        break;
    }
  }
}

/** The end of an arena run: the record, the numbers, everyone's share in co-op; into the rankings. */
function showArenaRunEnd(world: World, me: Hero, solo: boolean): void {
  const arena = world.arena!;
  const answer = session?.checked ? session.checked.finished() : null;
  const cleared = core.wavesCleared(arena);
  const score = core.arenaScore(world, me.id);
  const best = arenaBest();
  const newRecord = recordArena(cleared);
  const name = me.name || playerName || telegramName() || t.heroLabel;
  const cause = me.killedBy && (t.causes[me.killedBy] ?? t.mobs[me.killedBy as MobKind] ?? t.classes[me.killedBy as HeroClass] ?? me.killedBy);
  recordRun({
    key: `${world.run.seed}:${me.id}:${world.turn}`,
    score,
    name,
    heroClass: me.heroClass,
    lvl: me.lvl,
    depth: cleared,
    gold: me.stats?.gold ?? me.gold,
    won: false,
    cause: cause ? capitalize(cause) : '',
    mode: 'arena',
    date: Date.now(),
  });
  pushCloud();
  window.setTimeout(() => {
    if (!session?.world?.over) return;
    haptic('error');
    showArenaEnd({
      solo,
      wave: arena.wave,
      cleared,
      region: t.regionNames[core.tierOf(arena.wave)] ?? '',
      kills: arena.kills,
      score,
      newRecord,
      best: newRecord ? cleared : best,
      party: [me, ...world.heroes.filter((hero) => hero.id !== me.id)].map((hero) => ({
        name: hero.name, heroClass: hero.heroClass, kills: hero.kills, score: core.arenaScore(world, hero.id), me: hero.id === me.id,
      })),
      onAgain: () => {
        session?.restart();
        hideOverlay();
      },
      ranking: rankingBlock(answer),
      onBoards: api ? () => openBoards('arena') : undefined,
      share: shareChoices(async () => {
        const reply = answer ? await answer : null;
        return {
          name, heroClass: me.heroClass, level: me.lvl, depth: cleared, score, place: reply?.places?.arena ?? null, won: false,
          cause: cause ? capitalize(cause) : '', title: t.arena.title, arena: true,
        };
      }, t.arena.shareText(cleared, score), 'arena'),
      onExit: toTitle,
    });
  }, 1200);
}

/**
 * The ways to share a result: a story with its picture and a challenge sent to a chat (both through
 * the server, which keeps the picture at a public address), and a link (a picture where the phone can).
 */
function shareChoices(card: () => Promise<ShareCard>, text: string, start: 'daily' | 'arena'): ShareChoice[] {
  const choices: ShareChoice[] = [];
  const link = (): void => {
    void (async () => {
      const shared = await sharePicture(await card(), text);
      if (!shared && (await (start === 'arena' ? shareArena(text) : shareDaily(text))) === 'copied') toast(t.linkCopied);
    })();
  };
  if (api && canShareStory()) {
    choices.push({
      label: t.ranked.shareStory,
      run: () => {
        toast(t.ranked.sharePreparing);
        void (async () => {
          const blob = await storyCard(await card(), t.ranked.storyCall);
          const url = blob && (await api.card(blob));
          if (url) shareStory(url, `${text} ${appLink(start)}`);
          else toast(t.ranked.shareFailed);
        })();
      },
    });
  }
  if (api && canShareMessage()) {
    choices.push({
      label: t.ranked.shareChat,
      run: () => {
        toast(t.ranked.sharePreparing);
        void (async () => {
          const blob = await shareCard(await card());
          const url = blob && (await api.card(blob));
          const id = await api.challenge(text, url, start);
          if (id) await shareMessage(id);
          else link();
        })();
      },
    });
  }
  choices.push({ label: choices.length > 0 ? t.ranked.shareLink : t.shareResult, run: link });
  return choices;
}

requestAnimationFrame(frame);

addEventListener('pd-run-restored', () => toast(t.ranked.restored));

if (launchedForDaily()) {
  // Opened from a shared daily result: straight into today's dungeon.
  startSolo('daily');
} else {
  toTitle();
}


// Badges and the rankings from the player's other devices: on the title at once, once they come.
void pullCloud().then(() => {
  reloadBadges();
  if (!session && document.querySelector('.pd-title-screen')) toTitle(false);
  pushCloud();
});

if (import.meta.env.DEV) {
  // Debug handle for the browser console. advance() runs frames on a virtual
  // clock, for automated tests in hidden tabs where animation frames never fire.
  let virtual = performance.now();
  const advance = (ms: number): void => {
    virtual = Math.max(virtual, performance.now());
    for (let t = 0; t < ms; t += 33) tick((virtual += 33));
  };
  /** Runs frames in real time for `ms`, so a screenshot right after shows a consistent frame. */
  const play = async (ms: number): Promise<void> => {
    const end = performance.now() + ms;
    while (performance.now() < end) {
      tick(performance.now());
      await new Promise((resolve) => setTimeout(resolve, 33));
    }
  };
  Object.assign(window, { __pd: { get session() { return session; }, camera, view, motion, walk, advance, play, resize, core, fx, startSolo, audio, tick, held, tapCell } });
}
