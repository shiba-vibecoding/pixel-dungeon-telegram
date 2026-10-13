import {
  type Action, adjacent, canHarden, canReforge, canUpgrade, type Effect, hardenCost, hasPickaxe, type Hero, isMine, type Item, itemAt,
  type ItemRef, type Level, pickaxeCost, questCompleted, reforgeCost, SMITH_COST, T, upgradeCost, type World, WIDTH,
} from '@pd/core';
import { audio } from './audio';
import { capitalize, t } from './i18n';
import { itemName } from './itemtext';
import { lt, plain } from './levelnames';
import { button, el, info, portrait, show, showBackpack, showQuest, slot, windowOf } from './screens';
import { COLORS, type View } from './view';

/*
 * The troll blacksmith's windows (Blacksmith.interact's WndQuest, WndBlacksmith with WndReforge, its item
 * selectors and WndSmith), the ways down to his mine and back up (CavesLevel and MiningLevel's
 * activateTransition prompts), mining with his pickaxe (Hero.handle → HeroAction.Mine), and what the
 * mine's effects show and sound like.
 */

export interface SmithEnv {
  world: World;
  hero: Hero;
  send(action: Action): void;
  close(): void;
}

const NPC = 'actors.mobs.npcs.blacksmith';
const WND = 'windows.wndblacksmith';
const say = (key: string, ...args: Array<string | number>): string => plain(lt(key, ...args));

/** A word from him: his portrait and name over what he says, then `next`. */
function speak(env: SmithEnv, text: string, next: () => void = env.close): void {
  showQuest({ world: env.world, hero: env.hero, who: 'blacksmith', text, onClose: next });
}

/** WndOptions with his portrait: a question and its answers (yes first). */
function ask(env: SmithEnv, text: string, yes: string, no: string, onYes: () => void, onNo: () => void = env.close): void {
  showQuest({
    world: env.world, hero: env.hero, who: 'blacksmith', text,
    answers: [{ label: yes, onAnswer: onYes }, { label: no, onAnswer: onNo }],
    onClose: () => undefined,
  });
}

/** Blacksmith.interact, as the core tells it. */
export function talkWithBlacksmith(env: SmithEnv, line: Extract<Effect, { type: 'blacksmith' }>['line'], questType: number): void {
  const kind = (['crystal', 'gnoll', 'fungi'] as const)[questType - 1] ?? 'crystal';
  switch (line) {
    case 'intro':
      // His greeting for the hero's class and his errand; then what troubles the mine.
      speak(env, `${say(`${NPC}.intro_quest_${env.hero.heroClass}`)}\n\n${say(`${NPC}.intro_quest_start`)}`,
        () => speak(env, say(`${NPC}.intro_quest_${kind}`)));
      return;
    case 'reminder':
      speak(env, `${say(`${NPC}.reminder`)}\n\n${say(`${NPC}.reminder_${kind}`)}`);
      return;
    case 'rewards':
      showBlacksmith(env);
      return;
    case 'smith':
      showSmith(env);
      return;
    case 'getLost':
      speak(env, say(`${NPC}.get_lost`));
      return;
    case 'service':
      env.close();
  }
}

/** A long button of WndBlacksmith: its text (Shattered's, highlights plain), enabled or not. */
function choice(text: string, enabled: boolean, onClick: () => void): HTMLButtonElement {
  const node = button(plain(text), onClick, 'quiet');
  node.disabled = !enabled;
  node.style.whiteSpace = 'normal';
  node.style.textAlign = 'left';
  return node;
}

/** WndBlacksmith: the favour he owes, and his six services. */
export function showBlacksmith(env: SmithEnv): void {
  const q = env.world.smithQuest;
  if (!q) return;
  const back = (): void => showBlacksmith({ ...env });
  const cost = pickaxeCost(q);
  const buttons = [
    choice(lt(`${WND}.pickaxe`, cost), q.pickaxe !== null && q.favor >= cost, () =>
      ask(env, `${say(`${WND}.pickaxe_verify`)}${cost === 0 ? `\n\n${say(`${WND}.pickaxe_free`)}` : ''}`,
        say(`${WND}.pickaxe_yes`), say(`${WND}.pickaxe_no`), () => env.send({ type: 'blacksmith', service: 'pickaxe' }), back)),
    choice(lt(`${WND}.reforge`, reforgeCost(q)), q.favor >= reforgeCost(q), () => showReforge(env, null, null)),
    choice(lt(`${WND}.harden`, hardenCost(q)), q.favor >= hardenCost(q), () =>
      pickItem(env, say(`${WND}$hardenselector.prompt`), (item) => canHarden(env.world, item), (ref) => env.send({ type: 'blacksmith', service: 'harden', item: ref }), back)),
    choice(lt(`${WND}.upgrade`, upgradeCost(q)), q.favor >= upgradeCost(q), () =>
      pickItem(env, say(`${WND}$upgradeselector.prompt`), (item) => canUpgrade(env.world, item), (ref) => env.send({ type: 'blacksmith', service: 'upgrade', item: ref }), back)),
    choice(lt(`${WND}.smith`, SMITH_COST), q.favor >= SMITH_COST, () =>
      ask(env, say(`${WND}.smith_verify`), say(`${WND}.smith_yes`), say(`${WND}.smith_no`), () => env.send({ type: 'blacksmith', service: 'smith' }), back)),
    choice(lt(`${WND}.cashout`), q.favor > 0, () =>
      ask(env, say(`${WND}.cashout_verify`, q.favor), say(`${WND}.cashout_yes`), say(`${WND}.cashout_no`), () => env.send({ type: 'blacksmith', service: 'cashout' }), back)),
  ];
  show(
    windowOf(
      { title: capitalize(t.mobs.blacksmith), icon: portrait('blacksmith'), onClose: env.close },
      info(say(`${WND}.prompt`, q.favor), 'pd-speech'),
      el('div', { className: 'pd-confirm-actions' }, ...buttons),
    ),
    env.close,
  );
}

/** Everything the hero has, worn first (as WndBag lists them). */
function refsOf(hero: Hero): ItemRef[] {
  return [
    ...(hero.weapon ? ['weapon' as const] : []), 'armor' as const, ...hero.rings.map((_, i) => (i === 0 ? 'ring0' as const : 'ring1' as const)),
    ...hero.items.map((_, i) => i),
  ];
}

/** GameScene.selectItem: the backpack, with only what he can work on to tap. */
function pickItem(env: SmithEnv, title: string, can: (item: Item) => boolean, onPick: (ref: ItemRef) => void, onCancel: () => void): void {
  const targets = refsOf(env.hero).filter((ref) => can(itemAt(env.hero, ref)!));
  showBackpack({
    world: env.world, hero: env.hero, onAction: env.send, onAim: () => undefined, onClose: onCancel,
    pick: { title, targets, onPick: (ref) => { env.close(); onPick(ref); }, onCancel },
  });
}

/** WndReforge: two items of a kind side by side; the weaker goes into the fire to make the stronger better. */
function showReforge(env: SmithEnv, first: ItemRef | null, second: ItemRef | null): void {
  const { world, hero } = env;
  const a = first === null ? undefined : itemAt(hero, first);
  const b = second === null ? undefined : itemAt(hero, second);
  const ready = !!a && !!b && a !== b && a.kind === b.kind;
  const choose = (which: 0 | 1): void =>
    pickItem(env, say(`${WND}$wndreforge.prompt`), (item) => canReforge(world, item),
      (ref) => showReforge(env, which === 0 ? ref : first, which === 1 ? ref : second), () => showReforge(env, first, second));
  const holder = (item: Item | undefined, which: 0 | 1): HTMLElement => {
    const node = slot(world, item, { hero, onClick: () => choose(which) });
    return node;
  };
  const go = button(say(`${WND}$wndreforge.reforge`), () => {
    if (!ready) return;
    env.close();
    audio.play('evoke');
    env.send({ type: 'blacksmith', service: 'reforge', first: first!, second: second! });
  }, 'primary');
  go.disabled = !ready;
  show(
    windowOf(
      { title: capitalize(t.mobs.blacksmith), icon: portrait('blacksmith'), onClose: () => showBlacksmith(env) },
      info(say(`${WND}$wndreforge.message`), 'pd-speech'),
      el('div', { className: 'pd-reforge' }, holder(a, 0), el('span', { className: 'pd-reforge-arrow' }), holder(b, 1)),
      a && b ? info(`${capitalize(itemName(world, a))} + ${itemName(world, b)}`, 'pd-note') : false,
      go,
    ),
    () => showBlacksmith(env),
  );
}

/** WndSmith: the four things he smithed (two weapons, thrown weapons, an armour); one to take. */
export function showSmith(env: SmithEnv): void {
  const rewards = env.world.smithQuest?.smithRewards;
  if (!rewards) return;
  showQuest({
    world: env.world, hero: env.hero, who: 'blacksmith', text: say(`${WND}$wndsmith.prompt`),
    offers: rewards,
    onChoose: (index) => env.send({ type: 'blacksmith', service: 'pick', choice: index }),
    onClose: env.close,
  });
}

/* The ways down and up */

/**
 * CavesLevel.activateTransition (the smithy's ladder) and MiningLevel.activateTransition (the way back up): his
 * questions before the hero goes. False if the hero does not stand on one of these.
 */
export function smithBranch(env: SmithEnv): boolean {
  const { world, hero } = env;
  const level = world.levels[hero.depth];
  const transition = level?.transitions?.find((tr) => tr.cell === hero.pos && (tr.type === 'branchExit' || tr.type === 'branchEntrance'));
  const q = world.smithQuest;
  if (!level || !transition || !q) return false;
  const go = (): void => env.send({ type: 'branch' });
  if (transition.type === 'branchExit' && !level.branch && q.depth === hero.depth) {
    if (!q.given || q.completed || !q.started) {
      const smith = world.floors[hero.depth]?.mobs.some((m) => m.kind === 'blacksmith');
      if (!smith || !q.given || q.completed) {
        env.close();
        toastLine(say(`${NPC}.entrance_blocked`));
      } else if (!hasPickaxe(hero)) {
        speak(env, say(`${NPC}.lost_pick`));
      } else {
        ask(env, say(`${NPC}.quest_start_prompt`), say(`${NPC}.enter_yes`), say(`${NPC}.enter_no`), go);
      }
      return true;
    }
    go();
    return true;
  }
  if (transition.type === 'branchEntrance' && isMine(world, level)) {
    if (questCompleted(q)) {
      go();
      return true;
    }
    if (!hasPickaxe(hero)) {
      speak(env, say(`${NPC}.lost_pick`));
      return true;
    }
    // The whole party's dark gold is weighed.
    const gold = world.heroes.filter((h) => h.depth === hero.depth).reduce((sum, h) => sum + h.items.filter((i) => i.kind === 'quest.ore').reduce((n, i) => n + i.qty, 0), 0);
    const how = gold < 10 ? 'none' : gold < 20 ? 'low' : gold < 30 ? 'med' : gold < 40 ? 'high' : 'full';
    let text = say(`${NPC}.exit_warn_${how}`);
    const kind = (['crystal', 'gnoll', 'fungi'] as const)[q.type - 1] ?? 'crystal';
    if (!q.bossBeaten) text += `\n\n${say(`${NPC}.exit_warn_${kind}`)}`;
    ask(env, text, say(`${NPC}.exit_yes`), say(`${NPC}.exit_no`), go);
    return true;
  }
  return false;
}

/** For refusals with no window: said in the log by whoever shows it (set by main.ts). */
let toastLine: (text: string) => void = () => undefined;
export function setSmithToast(fn: (text: string) => void): void {
  toastLine = fn;
}

/* Mining */

const MINEABLE: ReadonlySet<number> = new Set([T.WALL, T.WALL_DECO, T.MINE_CRYSTAL, T.MINE_BOULDER]);

/**
 * Hero.handle on the mine, with the pickaxe: a wall, vein, crystal or boulder tapped is mined — at once if
 * beside the hero (`'mine'`), else after walking up to it (`'walk'`); null if it is nothing to mine.
 */
export function mineTarget(world: World, hero: Hero, level: Level, cell: number): 'mine' | 'walk' | null {
  if (!isMine(world, level) || !hasPickaxe(hero) || !MINEABLE.has(level.map[cell]!)) return null;
  const x = cell % WIDTH;
  const y = Math.trunc(cell / WIDTH);
  if (x < 1 || y < 1 || x >= (level.width ?? WIDTH) - 1 || y >= (level.height ?? WIDTH) - 1) return null;
  return adjacent(hero.pos, cell) ? 'mine' : 'walk';
}

/* What the view shows */

/** The mine's and the blacksmith's effects in the view: sounds, flashes, the log. True if it was one of them. */
export function mineEffect(view: View, effect: Effect, myId: string, now: number): boolean {
  const here = (depth: number): boolean => depth === view.depth;
  const flash = (cells: readonly number[], color: string, duration = 500): void => {
    for (const cell of cells) view.flashes.push({ cell, start: now, color, duration });
  };
  switch (effect.type) {
    case 'mined': {
      if (!here(effect.depth)) return true;
      // Hero.actMine: gold rings out (evoke), rock grinds (mine), crystal shatters, a boulder breaks quieter.
      if (effect.terrain === 'gold') {
        flash([effect.pos], '255, 210, 90');
        audio.play('evoke');
        const ore = effect.ore;
        if (effect.hero === myId && ore !== undefined && ore % 5 === 0) {
          view.say(say('items.quest.darkgold.you_now_have', ore), ore >= 40 ? COLORS.positive : COLORS.default, now);
        }
      } else if (effect.terrain === 'crystal') {
        flash([effect.pos], '255, 255, 255');
        audio.play('shatter');
      } else {
        flash([effect.pos], '140, 140, 140');
        audio.play('mine', 1, effect.terrain === 'boulder' ? 0.6 : 1);
      }
      if (effect.shattered) {
        flash(effect.shattered, '255, 255, 255');
        audio.play('shatter');
      }
      return true;
    }
    case 'blacksmith':
      if (effect.line === 'service' && effect.hero === myId) audio.play('evoke');
      return true;
    case 'mineEvent': {
      if (!here(effect.depth)) return true;
      const mine = effect.hero === myId;
      const hit = (): void => {
        const puppet = effect.mob ? view.puppets.get(effect.mob) : undefined;
        if (puppet) puppet.flashUntil = now + 160;
      };
      switch (effect.what) {
        case 'spireHit':
          hit();
          audio.play('shatter', 1.2);
          break;
        case 'spireWarning':
          audio.play('mine');
          if (mine) view.say(say('actors.mobs.crystalspire.warning'), COLORS.warning, now);
          break;
        case 'spireAlert':
          audio.play('rocks');
          if (mine) view.say(say('actors.mobs.crystalspire.alert'), COLORS.negative, now);
          break;
        case 'spireShattered':
          flash(effect.cells ?? [], '255, 255, 255', 700);
          audio.play('shatter');
          audio.play('rocks');
          break;
        case 'spikes':
          flash(effect.cells ?? [], '255, 255, 255');
          audio.play('shatter');
          break;
        case 'targeted':
        case 'rockfallWarning':
          flash(effect.cells ?? [], '255, 60, 60', 900);
          break;
        case 'rockThrow':
          audio.play('miss');
          if (effect.to !== undefined) flash([effect.to], '85, 85, 85');
          break;
        case 'rockfall':
        case 'dash':
          flash(effect.cells ?? [], '85, 85, 85');
          audio.play('rocks');
          break;
        case 'shatter':
          flash(effect.cells ?? [], '255, 255, 255');
          audio.play('shatter');
          break;
        case 'geoHit':
          hit();
          audio.play('mine');
          break;
        case 'geoWarning':
          if (mine) view.say(say('actors.mobs.gnollgeomancer.warning'), COLORS.warning, now);
          break;
        case 'geoAlert':
          audio.play('rocks');
          if (mine) view.say(say('actors.mobs.gnollgeomancer.alert'), COLORS.negative, now);
          break;
        case 'spearWarn':
          if (mine) view.say(say('actors.mobs.gnollguard.spear_warn'), COLORS.negative, now);
          break;
        case 'immune':
          audio.play('hit_parry');
          break;
        default:
          break;
      }
      return true;
    }
    default:
      return false;
  }
}

