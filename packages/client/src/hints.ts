import { audio } from './audio';
import { lang } from './i18n';

/*
 * The learning mode: while it is on (the settings; on at first), the game says
 * a word about each thing the first time the player meets it — a monster, an
 * unknown potion, a trap, hunger, a locked door, the stairs — simply and
 * once. Hints come one at a time on a small card that never covers the hero (design system v13);
 * the ones seen are kept on this device, and can be shown again from the
 * settings.
 */

export type HintId =
  | 'monster' | 'attacked' | 'lowHealth' | 'floorItem' | 'container' | 'trap' | 'lockedDoor' | 'stairs' | 'secret'
  | 'hungry' | 'levelUp' | 'well' | 'altar' | 'alchemy' | 'shop' | 'npc' | 'boss' | 'companion' | 'waiting' | 'examine'
  | 'potion' | 'scroll' | 'weapon' | 'armor' | 'ring' | 'wand' | 'food' | 'seed' | 'missile' | 'bomb' | 'key' | 'gold'
  | 'dew' | 'vial' | 'bag' | 'ankh' | 'honeypot' | 'torch' | 'tome' | 'kit' | 'beacon' | 'arena' | 'live';

type Text = readonly [title: string, text: string];

const RU: Record<HintId, Text> = {
  monster: ['Враг!', 'Бой идёт по ходам: пока вы стоите, стоит и он.'],
  attacked: ['Вас ранили', 'Красная полоса вверху — здоровье. Оно само восстанавливается со временем.'],
  lowHealth: ['Мало здоровья', 'Отступите и отдохните или выпейте зелье исцеления. Дверь между вами и врагами — хорошее укрытие.'],
  floorItem: ['Что-то на полу', 'Всё подобранное лежит в рюкзаке.'],
  container: ['Сундук', 'Гробы и останки тоже открываются, но могут потревожить мёртвых.'],
  trap: ['Ловушка', 'Найденные ловушки герой обходит сам. Брошенный на ловушку предмет заставит её сработать без вас.'],
  lockedDoor: ['Запертая дверь', 'Нужен железный ключ с этой глубины: он лежит где-то на уровне. С ключом дверь откроется сама.'],
  stairs: ['Лестница вниз', 'Чем глубже — тем опаснее и тем лучше добыча. Сначала стоит осмотреть уровень.'],
  secret: ['Тайники', 'Если уровень кажется тупиком, ищите у стен: подземелье прячет двери и ловушки.'],
  hungry: ['Голод', 'Оранжевая полоса — сытость. Голодный герой не лечится, а потом теряет здоровье.'],
  levelUp: ['Новый уровень', 'Герой стал сильнее: больше здоровья, точнее удары. Опыт — жёлтая полоса под здоровьем.'],
  well: ['Колодец', 'Магический колодец: здоровья, знания или превращений. Встаньте в него, чтобы испить, или бросьте предмет в колодец превращений.'],
  altar: ['Алтарь', 'Жертвенный огонь притягивает монстров. Убитые на нём засчитываются как жертва, и алтарь наградит вас.'],
  alchemy: ['Алхимический котёл', 'Бросьте в котёл три семени, и сварится зелье.'],
  shop: ['Лавка', 'Ненужное можно продать торговцу из рюкзака.'],
  npc: ['Житель подземелья', 'У многих есть просьба и награда за неё.'],
  boss: ['Логово босса', 'Здесь живёт босс. Следите за его действиями и подсказками на экране: каждый бьёт по-своему. Возьмите с собой зелья.'],
  companion: ['Товарищ', 'Ваш товарищ по отряду. Вещь можно передать, бросив её на пол.'],
  waiting: ['Ход товарища', 'В бою отряд ходит по очереди: игра ждёт того, на кого напали. Отвлёкшийся товарищ не держит отряд дольше нескольких секунд.'],
  examine: ['Осмотреться', 'Узнайте, что на любой клетке: монстр, предмет, растение или ловушка.'],
  potion: ['Зелье', 'Неопознанное зелье узнаётся, только когда его выпьешь или бросишь. Одни лечат, другие вредят — пробуйте, когда рядом нет врагов.'],
  scroll: ['Свиток', 'Неопознанный свиток узнаётся при прочтении. Улучшение и зачарование спросят, на какой предмет их читать.'],
  weapon: ['Оружие', 'Число в углу — нужная сила: тяжёлое оружие без силы бьёт хуже. «?» — уровень пока неизвестен: повоюйте им или опознайте его.'],
  armor: ['Броня', 'Чем тяжелее броня, тем больше силы нужно; без силы вы станете неуклюжи. Её уровень станет ясен, если походить в ней или опознать её.'],
  ring: ['Кольцо', 'Носить можно два кольца. Что делает кольцо, станет ясно со временем. Проклятое кольцо не снять.'],
  wand: ['Палочка', 'Палочку направляют на цель. Заряды восстанавливаются сами.'],
  food: ['Еда', 'Еда в подземелье на вес золота: ешьте, когда проголодаетесь.'],
  seed: ['Семя', 'Где упадёт семя, вырастет растение. Каждое срабатывает по-своему, когда на него наступят.'],
  missile: ['Метательное оружие', 'Дротики и ножи бросают во врагов издалека.'],
  bomb: ['Бомба', 'Через пару ходов после броска взорвётся. Не стойте рядом!'],
  key: ['Ключ', 'Ключ открывает запертую дверь или сундук на этой же глубине.'],
  gold: ['Золото', 'Золото тратится в лавках на глубинах 6, 11 и 16, а на 21-й — если бес остался доволен.'],
  dew: ['Роса', 'Капля росы идёт в бурдюк, а когда он полон — лечит, если вы ранены.'],
  vial: ['Бурдюк', 'В него собирается роса. Выпейте из бурдюка, чтобы вылечиться: вы выпьете ровно столько, сколько нужно.'],
  bag: ['Сумка', 'Сумка держит семена, свитки или палочки отдельно и бережёт их от огня и холода.'],
  ankh: ['Анх', 'Если вы погибнете, анх вернёт вас к жизни один раз.'],
  honeypot: ['Горшок с мёдом', 'Разбейте его, и пчела будет сражаться за вас.'],
  torch: ['Факел', 'Зажгите факел, чтобы видеть дальше в тёмных местах.'],
  tome: ['Книга мастерства', 'Прочитайте её, чтобы выбрать путь героя: один из двух подклассов.'],
  kit: ['Набор для брони', 'Превращает надетую броню в броню класса со своей особой способностью.'],
  beacon: ['Маяк Ллойда', 'Поставьте маяк, и потом сможете вернуться в это место с любой глубины.'],
  arena: ['Арена волн', 'Монстры идут волнами через четверо ворот. После волны — передышка: павшие встают, каждый берёт награду. Отдохните и начните следующую.'],
  live: ['Живые ходы', 'Пока спокойно, герой сам идёт, куда сказано, и никого не ждёт. В бою — ходы, как обычно: время стоит, пока вы не сходите, а ходы отряда идут вместе.'],
};

const EN: Record<HintId, Text> = {
  monster: ['An enemy!', 'Fights go by turns: while you stand, so does it.'],
  attacked: ['You are hurt', 'The red bar at the top is your health. It comes back with time.'],
  lowHealth: ['Low health', 'Step back and rest, or drink a potion of healing. A door between you and the enemies is a good cover.'],
  floorItem: ['Something on the floor', 'Everything you pick up goes into the backpack.'],
  container: ['A chest', 'Tombs and remains open too, but may disturb the dead.'],
  trap: ['A trap', 'The hero walks around traps found. An item thrown onto a trap sets it off without you.'],
  lockedDoor: ['A locked door', 'It wants an iron key from this depth: one lies somewhere on the level. With the key, the door opens by itself.'],
  stairs: ['Stairs down', 'Deeper is more dangerous, and richer. Look around the level first.'],
  secret: ['Hidden things', 'If a level seems a dead end, search by the walls: the dungeon hides doors and traps.'],
  hungry: ['Hunger', 'The orange bar is how fed you are. A hungry hero does not heal, then starts losing health.'],
  levelUp: ['Level up', 'The hero grew stronger: more health, surer blows. Experience is the yellow bar under health.'],
  well: ['A well', 'A magic well: of health, awareness or transmutation. Step into it to drink, or throw an item into the well of transmutation.'],
  altar: ['An altar', 'The sacrificial fire draws monsters in. Those slain in it count as offerings, and the altar rewards you.'],
  alchemy: ['An alchemy pot', 'Throw three seeds into the pot and a potion will brew.'],
  shop: ['A shop', 'What you do not need can be sold to the shopkeeper from the backpack.'],
  npc: ['A dweller of the dungeon', 'Many have a request, and a reward for it.'],
  boss: ['A boss\'s lair', 'A boss lives here. Watch what it does and the warnings on screen: each fights in its own way. Bring potions.'],
  companion: ['A companion', 'Your party member. Hand them an item by dropping it.'],
  waiting: ['A companion\'s move', 'In a fight the party moves in turns: the game waits for whoever is attacked. A companion who looked away holds you up only a few seconds.'],
  examine: ['Look around', 'Learn what is on any cell: a monster, an item, a plant or a trap.'],
  potion: ['A potion', 'Unknown potions are learned only by drinking or throwing them. Some heal, some harm: try them with no enemies around.'],
  scroll: ['A scroll', 'An unknown scroll is learned by reading it. Upgrade and enchantment ask which item to read them on.'],
  weapon: ['A weapon', 'The number in the corner is the strength it needs: without it, you fight worse. A «?» means its level is not known yet: fight with it a while, or identify it.'],
  armor: ['Armour', 'Heavier armour needs more strength; without it you are clumsy. Its level shows once you have worn it a while, or identified it.'],
  ring: ['A ring', 'You can wear two rings. What a ring does shows in time. A cursed ring will not come off.'],
  wand: ['A wand', 'A wand is pointed at a target. Charges come back by themselves.'],
  food: ['Food', 'Food is worth its weight in gold down here: eat when you are hungry.'],
  seed: ['A seed', 'Where a seed lands, a plant grows. Each does its own thing when stepped on.'],
  missile: ['A thrown weapon', 'Darts and knives are thrown at enemies from afar.'],
  bomb: ['A bomb', 'It goes off a couple of turns after the throw. Stand back!'],
  key: ['A key', 'A key opens a locked door or chest on the same depth.'],
  gold: ['Gold', 'Gold is spent in the shops on depths 6, 11 and 16, and on depth 21 if the imp got his way.'],
  dew: ['Dew', 'A dewdrop goes into your waterskin; once it is full, dew heals you if you are hurt.'],
  vial: ['The waterskin', 'It collects dew. Drink from it to heal: you only drink as much as you need.'],
  bag: ['A bag', 'A bag keeps seeds, scrolls or wands apart and safe from fire and frost.'],
  ankh: ['An ankh', 'Should you die, the ankh brings you back to life once.'],
  honeypot: ['A honeypot', 'Shatter it and the bee inside fights for you.'],
  torch: ['A torch', 'Light it to see further in dark places.'],
  tome: ['The tome of mastery', 'Read it to choose your hero\'s way: one of two subclasses.'],
  kit: ['An armour kit', 'Turns the armour worn into class armour, with a special ability.'],
  beacon: ['Lloyd\'s beacon', 'Set it, and you can come back to this spot later from any depth.'],
  arena: ['Wave arena', 'Monsters come in waves through four gates. After each wave a breather: the fallen rise, everyone takes a reward. Rest, then start the next.'],
  live: ['Live turns', 'While all is calm, the hero walks where told and waits for no one. In a fight it is turns as ever: time stands still until you move, and the party’s moves play out together.'],
};

/*
 * «How» (design system v13): a gesture's picture and what to do, on a monitor with the key; and
 * an arrow at the button meant, which blinks until it is pressed or the card goes. The words are
 * our own HTML (<b> for the gesture); on a monitor «Нажмите»/«Tap» become «Щёлкните»/«Click».
 */
type Gesture = 'tap' | 'hold' | 'drag' | 'throw' | 'click' | 'rclick';
type Target = 'attack' | 'wait' | 'search' | 'examine' | 'bag' | 'quick' | 'mate' | 'fight';

interface Words {
  gesture: Gesture;
  ru: string;
  en: string;
}

interface How extends Words {
  /** On a monitor, if not the same words with a click. */
  wide?: Words;
  key?: string;
  target?: Target;
}

const tapOn = (ru: string, en: string, more: Partial<How> = {}): How => ({
  gesture: 'tap',
  ru: `<b>Нажмите</b> ${ru}`,
  en: `<b>Tap</b> ${en}`,
  ...more,
});
const REST: How = {
  gesture: 'hold',
  ru: '<b>Удерживайте</b> часы, чтобы отдохнуть до полного',
  en: '<b>Hold</b> the hourglass to rest until healed',
  wide: { gesture: 'click', ru: 'Отдохнуть до полного:', en: 'Rest until healed:' },
  key: 'R',
  target: 'wait',
};
const equip = (ru: string, en: string): How => ({
  gesture: 'drag',
  ru: `<b>Перетащите</b> ${ru} в рюкзаке или нажмите «Надеть»`,
  en: `<b>Drag</b> it ${en} in the backpack, or tap «Equip»`,
  key: 'I',
  target: 'bag',
});
const hold = (ru: string, en: string): How => ({
  gesture: 'hold',
  ru: `<b>Удерживайте</b> в рюкзаке, ${ru}`,
  en: `<b>Hold</b> it in the backpack ${en}`,
  key: 'I',
  target: 'bag',
});
const THROW: How = {
  gesture: 'throw',
  ru: '<b>Бросьте</b>: положите в быстрый слот и нажмите на цель',
  en: '<b>Throw</b>: put it in the quick slot and tap a target',
  key: '1',
  target: 'quick',
};
const EAT: How = tapOn('на рюкзак и съешьте еду', 'the backpack and eat', { key: 'I', target: 'bag' });

const HOW: Partial<Record<HintId, How>> = {
  live: tapOn('на клетку — герой пойдёт туда сам; на врага — подойдёт и ударит', 'a cell and the hero walks there; an enemy, and they walk up and strike'),
  monster: tapOn('на монстра или на кнопку с его портретом', 'the monster, or the button with its portrait', {
    wide: { gesture: 'click', ru: '<b>Щёлкните</b> по монстру или нажмите', en: '<b>Click</b> the monster or press' },
    key: 'Tab',
    target: 'attack',
  }),
  attacked: REST,
  lowHealth: REST,
  floorItem: tapOn('на предмет — герой подойдёт и подберёт', 'an item and the hero walks up and takes it'),
  container: tapOn('на сундук — герой откроет его, стоя рядом', 'a chest and the hero opens it from beside it'),
  stairs: tapOn('на лестницу, чтобы спуститься', 'the stairs to go down'),
  npc: tapOn('на него, чтобы поговорить', 'them to talk'),
  shop: tapOn('на товар, чтобы купить', 'a ware to buy it'),
  secret: tapOn('на лупу у стены', 'the magnifier by a wall', {
    wide: { gesture: 'click', ru: '<b>Щёлкните по лупе</b> или нажмите', en: '<b>Click the magnifier</b> or press' },
    key: 'F',
    target: 'search',
  }),
  examine: tapOn('«?», а потом на клетку', '«?», then a cell', {
    wide: { gesture: 'rclick', ru: '<b>Правой кнопкой</b> по клетке или', en: '<b>Right-click</b> a cell, or' },
    key: 'X',
    target: 'examine',
  }),
  hungry: EAT,
  food: EAT,
  weapon: equip('в слот оружия', 'to the weapon slot'),
  armor: equip('в слот брони', 'to the armour slot'),
  ring: equip('в слот кольца', 'to a ring slot'),
  potion: hold('чтобы выпить', 'to drink it'),
  scroll: hold('чтобы прочитать', 'to read it'),
  wand: hold('и нажмите на цель', 'and tap a target'),
  missile: THROW,
  bomb: THROW,
  seed: THROW,
  companion: tapOn('на товарища, чтобы поменяться местами', 'them to change places', { target: 'mate' }),
  arena: tapOn('«К бою!», когда будете готовы', '«To battle!» when ready', { target: 'fight' }),
};

/** The button each target means. */
const TARGETS: Record<Target, string> = {
  attack: '.pd-mapbtn.attack',
  wait: '.pd-tool[aria-keyshortcuts="Space"]',
  search: '.pd-tool[aria-keyshortcuts="F"]',
  examine: '.pd-tool[aria-keyshortcuts="X"]',
  bag: '.pd-tool.bag',
  quick: '.pd-tool.quick',
  mate: '.pd-pcard, .pd-mate',
  fight: '.pd-fight .pd-button',
};

type Side = 'top' | 'bottom' | 'left' | 'right';
/** Where the arrow stands by its button: above the bottom bar, left of the map's buttons, beside the party. */
const sideOf = (target: Target, wide: boolean): Side =>
  target === 'attack' ? (wide ? 'left' : 'top') : target === 'mate' ? (wide ? 'right' : 'bottom') : 'top';

/** The first of the buttons that is on screen now. */
function onScreen(root: HTMLElement, selector: string): HTMLElement | null {
  for (const node of root.querySelectorAll<HTMLElement>(selector)) {
    const box = node.getBoundingClientRect();
    if (box.width > 0 && box.height > 0 && !node.hidden) return node;
  }
  return null;
}

const ENABLED = 'pd-hints';
const SEEN = 'pd-hints-seen';
/** The shortest pause between two hints, so they never pile up. */
const GAP_MS = 2500;
/** A hint goes away by itself after a while; the next waits for it. */
const SHOW_MS = 14_000;

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // For this session only.
  }
}

class Hints {
  /** On at first; the settings turn it off. */
  enabled = read(ENABLED) !== 'off';
  private seen = new Set<string>((read(SEEN) ?? '').split(',').filter(Boolean));
  private queue: Array<{ id: HintId; icon?: () => HTMLElement }> = [];
  private card: HTMLElement | null = null;
  private lastShown = -Infinity;
  private timer = 0;
  /** Until the card goes by itself; it stands still while a finger or the mouse is on it. */
  private left = SHOW_MS;
  private since = 0;
  private root: HTMLElement | null = null;
  /** The arrow at the button meant, and that button. */
  private arrow: { node: HTMLElement; target: HTMLElement; side: Side; at: string } | null = null;
  /** A button the card means that is not on screen yet (the attack shows a moment after the enemy). */
  private wanted: Target | null = null;

  /** Where the cards appear (the interface layer). */
  attach(root: HTMLElement): void {
    this.root = root;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    write(ENABLED, on ? 'on' : 'off');
    if (!on) this.dismiss(true);
  }

  /** Every hint as new again. */
  reset(): void {
    this.seen.clear();
    write(SEEN, '');
  }

  /** The first time something is met, its hint (if learning is on); later times, nothing. */
  first(id: HintId, icon?: () => HTMLElement): void {
    if (!this.enabled || this.seen.has(id) || this.queue.some((q) => q.id === id)) return;
    this.queue.push({ id, icon });
    this.pump();
  }

  /** Called every frame: keeps the arrow by its button, and shows the next hint once the last has gone and a moment has passed. */
  pump(): void {
    this.placeArrow();
    if (!this.root || this.card || this.queue.length === 0) return;
    if (performance.now() - this.lastShown < GAP_MS) return;
    const { id, icon } = this.queue.shift()!;
    this.seen.add(id);
    write(SEEN, [...this.seen].join(','));
    this.show(this.root, id, icon);
  }

  private show(root: HTMLElement, id: HintId, icon?: () => HTMLElement): void {
    const ru = lang === 'ru';
    const wide = root.classList.contains('pd-wide');
    const [title, text] = (ru ? RU : EN)[id];
    const how = HOW[id];
    const target = how?.target ? onScreen(root, TARGETS[how.target]) : null;

    const card = document.createElement('section');
    card.className = 'pd-hint';
    card.setAttribute('role', 'status');
    card.style.setProperty('--hint-ms', `${SHOW_MS / 1000}s`);

    // The picture: a portrait as it is; an item, or else the button's own glyph, in a slot.
    const head = document.createElement('div');
    head.className = 'pd-hint-head';
    const picture = icon?.() ?? (target?.querySelector('.pd-icon')?.cloneNode(true) as HTMLElement | undefined);
    if (picture?.classList.contains('pd-portrait')) {
      head.append(picture);
    } else if (picture) {
      const slot = document.createElement('span');
      slot.className = 'pd-slot';
      slot.append(picture);
      head.append(slot);
    }
    const name = document.createElement('b');
    name.textContent = title;
    head.append(name);
    const body = document.createElement('p');
    body.textContent = text;
    card.append(head, body);

    if (how) {
      const words: Words = !wide
        ? how
        : how.wide ?? {
            gesture: how.gesture === 'tap' ? 'click' : how.gesture,
            ru: how.ru.replace('Нажмите', 'Щёлкните'),
            en: how.en.replace('Tap', 'Click'),
          };
      const line = document.createElement('div');
      line.className = 'pd-hint-how';
      const gesture = document.createElement('i');
      gesture.className = `pd-gesture ${words.gesture}`;
      const say = document.createElement('span');
      say.innerHTML = ru ? words.ru : words.en;
      line.append(gesture, say);
      if (wide && how.key) {
        const key = document.createElement('span');
        key.className = 'pd-keycap';
        key.textContent = how.key;
        line.append(key);
      }
      card.append(line);
    }

    const ok = document.createElement('button');
    ok.className = 'pd-button small';
    ok.textContent = ru ? 'Понятно' : 'Got it';
    ok.onclick = () => {
      audio.play('click');
      this.dismiss();
    };
    const off = document.createElement('button');
    off.className = 'pd-hint-off';
    off.textContent = ru ? 'Больше не подсказывать' : 'No more hints';
    off.onclick = () => {
      audio.play('click');
      this.setEnabled(false);
    };
    const row = document.createElement('div');
    row.className = 'pd-hint-row';
    row.append(off, ok);
    const time = document.createElement('i');
    time.className = 'pd-hint-time';
    card.append(row, time);

    card.addEventListener('pointerenter', () => {
      window.clearTimeout(this.timer);
      this.left -= performance.now() - this.since;
    });
    card.addEventListener('pointerleave', () => this.countDown());
    root.append(card);
    this.card = card;
    this.lastShown = performance.now();
    this.left = SHOW_MS;
    this.countDown();
    audio.play('click', 1.4, 0.5);

    this.wanted = how?.target ?? null;
    this.placeArrow();
  }

  /** The arrow at the button meant, once it is on screen. */
  private point(root: HTMLElement, wanted: Target): void {
    const target = onScreen(root, TARGETS[wanted]);
    if (!target) return;
    this.wanted = null;
    const side = sideOf(wanted, root.classList.contains('pd-wide'));
    const arrow = document.createElement('i');
    arrow.className = `pd-pointer${side === 'top' ? '' : side === 'bottom' ? ' up' : ` ${side}`}`;
    root.append(arrow);
    target.classList.add('pd-spot');
    this.arrow = { node: arrow, target, side, at: '' };
    // Pressing the button meant is the lesson learnt: the arrow goes, the card stays to be read.
    target.addEventListener('click', () => this.dropArrow(), { once: true });
  }

  private countDown(): void {
    window.clearTimeout(this.timer);
    this.since = performance.now();
    this.timer = window.setTimeout(() => this.dismiss(), Math.max(0, this.left));
  }

  /** The arrow beside its button, in the layer's own pixels (the layer may be scaled by --ui). */
  private placeArrow(): void {
    if (this.wanted && this.card && this.root) this.point(this.root, this.wanted);
    const arrow = this.arrow;
    if (!arrow || !this.root) return;
    const layer = this.root.getBoundingClientRect();
    const box = arrow.target.getBoundingClientRect();
    if (box.width === 0) {
      arrow.node.style.display = 'none';
      arrow.at = '';
      return;
    }
    const ui = parseFloat(getComputedStyle(this.root).getPropertyValue('--ui')) || 1;
    const x = (box.left - layer.left) / ui;
    const y = (box.top - layer.top) / ui;
    const w = box.width / ui;
    const h = box.height / ui;
    const size = arrow.node.offsetWidth || 32;
    const gap = 4;
    const left = arrow.side === 'left' ? x - size - gap : arrow.side === 'right' ? x + w + gap : x + w / 2 - size / 2;
    const top = arrow.side === 'top' ? y - size - gap : arrow.side === 'bottom' ? y + h + gap : y + h / 2 - size / 2;
    const at = `${Math.round(left)},${Math.round(top)}`;
    if (at === arrow.at) return;
    arrow.at = at;
    arrow.node.style.display = '';
    arrow.node.style.left = `${Math.round(left)}px`;
    arrow.node.style.top = `${Math.round(top)}px`;
  }

  private dropArrow(): void {
    this.wanted = null;
    this.arrow?.node.remove();
    this.arrow?.target.classList.remove('pd-spot');
    this.arrow = null;
  }

  private dismiss(all = false): void {
    window.clearTimeout(this.timer);
    this.dropArrow();
    this.card?.remove();
    this.card = null;
    this.lastShown = performance.now();
    if (all) this.queue = [];
  }
}

export const hints = new Hints();
