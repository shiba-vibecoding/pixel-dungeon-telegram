import {
  type Action, ARTIFACT_USES, MONK_ABILITIES, type EffectId, MISC_SLOTS, type PlanStep, type FrameId, isItemRef, type ItemRef, LENGTH, type Look, OFFERS, type SkinVariant, SUBCLASSES,
  type SubClass, COMBO_MOVES, TALENTS, type TalentId,
} from '@pd/core';

/*
 * What a room accepts from a client, rebuilt field by field. An action the
 * room takes is broadcast to every player, so it must carry nothing but the
 * fields the rules read: `{ type: 'wait', junk: ... }` becomes `{ type: 'wait' }`,
 * and anything that is not an action of the rules at all is refused before the
 * world sees it. Whether the action makes sense in the dungeon is still the
 * rules' to say (act() in the core); this only checks its shape.
 */

/** A backpack slot or a worn ring's index: small and whole. */
const MAX_SLOT = 255;
/** An item's choice (an enchantment, a guess, a recipe...): small and whole. */
const MAX_CHOICE = 63;
/** Trinity's lists of what the party has seen can be long. */
const MAX_CLASS_CHOICE = 255;
/** A used item's choice: a scroll of metamorphosis names a talent and one of its options (target * 8 + option). */
const MAX_USE_CHOICE = 255;
/** The largest choice an artifact's window offers (the toolkit's levels at most). */
const MAX_ARTIFACT_CHOICE = 10;
/** Monster ids are short ('#12'); anything longer is not one. */
const MAX_ID = 64;

const isInt = (value: unknown, min: number, max: number): value is number =>
  Number.isInteger(value) && (value as number) >= min && (value as number) <= max;

const cell = (value: unknown): number | null => (isInt(value, 0, LENGTH - 1) ? value : null);
const slot = (value: unknown): number | null => (isInt(value, 0, MAX_SLOT) ? value : null);
const oneOf = <T extends string>(value: unknown, options: readonly T[]): T | null =>
  (options as readonly unknown[]).includes(value) ? (value as T) : null;
/** A backpack slot, the weapon, the armour or a worn ring (the core's ItemRef). */
const itemRef = (value: unknown): ItemRef | null => (isItemRef(value) && (typeof value !== 'number' || slot(value) !== null) ? value : null);


const ALL_SUBCLASSES: readonly SubClass[] = Object.values(SUBCLASSES).flat();

/** Where the warrior's seal is taken from or put: a backpack slot, or the armour worn (the core's SealSource). */
const sealSource = (value: unknown): number | 'armor' | null => (value === 'armor' ? 'armor' : slot(value));

/** The action as the rules know it, or null if it is not one. */
export function sanitizeAction(raw: unknown): Action | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const a = raw as Record<string, unknown>;
  switch (a.type) {
    case 'descend':
    case 'ascend':
    case 'wait':
    case 'search':
    case 'impReward':
    case 'faceCurse':
    case 'endGame':
    case 'pickup':
    case 'buy':
    case 'mine':
      return { type: a.type };
    case 'arenaReady':
      // «To battle!», or, pressed again, not after all.
      return a.cancel === true ? { type: 'arenaReady', cancel: true } : { type: 'arenaReady' };
    case 'arenaPick':
      // One of the three rewards after a wave.
      return isInt(a.choice, 0, 2) ? { type: 'arenaPick', choice: a.choice } : null;
    case 'open': {
      const at = cell(a.cell);
      return at === null ? null : { type: 'open', cell: at };
    }
    case 'move':
    case 'jump': {
      const to = cell(a.to);
      return to === null ? null : { type: a.type, to };
    }
    case 'attack':
      return typeof a.target === 'string' && a.target.length > 0 && a.target.length <= MAX_ID ? { type: 'attack', target: a.target } : null;
    case 'reward': {
      const choice = oneOf(a.choice, ['weapon', 'armor'] as const);
      return choice ? { type: 'reward', choice } : null;
    }
    case 'wandReward': {
      const choice = oneOf(a.choice, ['battle', 'utility'] as const);
      return choice ? { type: 'wandReward', choice } : null;
    }
    case 'reforge': {
      const first = itemRef(a.first);
      const second = itemRef(a.second);
      return first === null || second === null ? null : { type: 'reforge', first, second };
    }
    case 'artifact': {
      // An artifact's action (the core's ArtifactAction): which artifact, which use, and what it is aimed at or takes.
      const item = itemRef(a.item);
      const use = oneOf(a.use, ARTIFACT_USES);
      if (item === null || !use) return null;
      const action: Action = { type: 'artifact', item, use };
      if (a.cell !== undefined) {
        const at = cell(a.cell);
        if (at === null) return null;
        action.cell = at;
      }
      if (a.with !== undefined) {
        const taken = slot(a.with);
        if (taken === null) return null;
        action.with = taken;
      }
      if (a.choice !== undefined) {
        if (!isInt(a.choice, 0, MAX_ARTIFACT_CHOICE)) return null;
        action.choice = a.choice;
      }
      if (a.on !== undefined) {
        const on = itemRef(a.on);
        if (on === null) return null;
        action.on = on;
      }
      return action;
    }
    case 'use': {
      const item = slot(a.item);
      if (item === null) return null;
      const use: Extract<Action, { type: 'use' }> = { type: 'use', item };
      // What a scroll (or stone, spell...) is used on: picked from the whole pack and what is worn (`target` is older clients' way).
      if (a.on !== undefined) {
        const on = itemRef(a.on);
        if (on === null) return null;
        use.on = on;
      } else if (a.target !== undefined) {
        const target = oneOf(a.target, ['weapon', 'armor'] as const);
        if (!target) return null;
        use.target = target;
      }
      // Where a dragon's breath, a siren's song or a spell is aimed; which of an item's choices.
      if (a.cell !== undefined) {
        const at = cell(a.cell);
        if (at === null) return null;
        use.cell = at;
      }
      if (a.choice !== undefined) {
        if (!isInt(a.choice, 0, MAX_USE_CHOICE)) return null;
        use.choice = a.choice;
      }
      return use;
    }
    case 'alchemy': {
      // Up to three pack slots into the pot, and which of the recipes they make.
      if (!Array.isArray(a.inputs) || a.inputs.length < 1 || a.inputs.length > 3) return null;
      const inputs: number[] = [];
      for (const raw of a.inputs as unknown[]) {
        const s = slot(raw);
        if (s === null) return null;
        inputs.push(s);
      }
      if (a.recipe === undefined) return { type: 'alchemy', inputs };
      return isInt(a.recipe, 0, MAX_CHOICE) ? { type: 'alchemy', inputs, recipe: a.recipe } : null;
    }
    case 'energize': {
      const item = slot(a.item);
      if (item === null) return null;
      return a.all === true ? { type: 'energize', item, all: true } : { type: 'energize', item };
    }
    case 'equip': {
      const item = slot(a.item);
      if (item === null) return null;
      // KindofMisc's window: which of the artifact, misc and ring slots to free for it.
      if (a.replace === undefined) return a.second === true ? { type: 'equip', item, second: true } : { type: 'equip', item };
      const replace = oneOf(a.replace, MISC_SLOTS);
      return replace ? { type: 'equip', item, replace } : null;
    }
    case 'drop':
    case 'sell': {
      const item = slot(a.item);
      return item === null ? null : { type: a.type, item };
    }
    case 'throw':
    case 'shoot': {
      const item = slot(a.item);
      const target = cell(a.target);
      return item === null || target === null ? null : { type: a.type, item, target };
    }
    case 'zap': {
      // A wand in the pack (its slot), or the mage's staff: in hand ('weapon') or in the pack.
      const item = a.item === 'weapon' ? 'weapon' : slot(a.item);
      const target = cell(a.target);
      return item === null || target === null ? null : { type: 'zap', item, target };
    }
    case 'imbue': {
      // MagesStaff.AC_IMBUE: a wand from the pack into the staff (in hand, or in the pack).
      const staff = a.staff === 'weapon' ? 'weapon' : slot(a.staff);
      const wand = slot(a.wand);
      return staff === null || wand === null ? null : { type: 'imbue', staff, wand };
    }
    case 'dismiss':
      // Ward.interact: the ward beside the hero dismissed.
      return typeof a.target === 'string' && a.target.length > 0 && a.target.length <= MAX_ID ? { type: 'dismiss', target: a.target } : null;
    case 'talent': {
      // Hero.upgradeTalent: a point in one of the talents (the rules say whether the hero has it and a point to spend).
      const talent = typeof a.talent === 'string' && Object.hasOwn(TALENTS, a.talent) ? (a.talent as TalentId) : null;
      return talent ? { type: 'talent', talent } : null;
    }
    case 'ability': {
      // The subclasses' action indicator: the berserker's rage, the freerunner's run, the sniper's mark, a combo move, a prepared strike.
      const target = typeof a.target === 'string' && a.target.length > 0 && a.target.length <= MAX_ID ? a.target : null;
      switch (a.ability) {
        case 'berserk':
        case 'freerun':
        case 'snipe':
          return { type: 'ability', ability: a.ability };
        case 'combo': {
          const move = oneOf(a.move, COMBO_MOVES);
          return move ? (target ? { type: 'ability', ability: 'combo', move, target } : { type: 'ability', ability: 'combo', move }) : null;
        }
        case 'ambush':
          return target ? { type: 'ability', ability: 'ambush', target } : null;
        default:
          return null;
      }
    }
    case 'unequip':
      return { type: 'unequip' };
    case 'remove': {
      // A worn ring or artifact, by its slot.
      const from = oneOf(a.slot, MISC_SLOTS);
      return from ? { type: 'remove', slot: from } : null;
    }
    case 'master': {
      const item = slot(a.item);
      const subclass = oneOf(a.subclass, ALL_SUBCLASSES);
      return item === null || !subclass ? null : { type: 'master', item, subclass };
    }
    case 'special': {
      // The class armour's ability: the cell it is aimed at, the warp beacon's choice (0 warp, 1 clear) or Trinity's form (0 to 2).
      const action: Action = { type: 'special' };
      if (a.target !== undefined) {
        const target = cell(a.target);
        if (target === null) return null;
        action.target = target;
      }
      if (a.choice !== undefined) {
        if (!isInt(a.choice, 0, 2)) return null;
        action.choice = a.choice;
      }
      return action;
    }
    case 'transfer': {
      // ClassArmor.AC_TRANSFER: the class armour, and the armour whose properties it takes over.
      const to = sealSource(a.to);
      const from = sealSource(a.from);
      return to === null || from === null ? null : { type: 'transfer', to, from };
    }
    case 'weaponAbility': {
      // The Duelist's weapon ability: the weapon in hand or the second one, and the cell it asks for.
      const which = a.which === undefined ? undefined : oneOf(a.which, ['weapon', 'second'] as const);
      if (which === null) return null;
      const out: Extract<Action, { type: 'weaponAbility' }> = { type: 'weaponAbility' };
      if (which) out.which = which;
      if (a.cell !== undefined) {
        const at = cell(a.cell);
        if (at === null) return null;
        out.cell = at;
      }
      return out;
    }
    case 'monk': {
      const ability = oneOf(a.ability, MONK_ABILITIES);
      if (!ability) return null;
      if (a.cell === undefined) return { type: 'monk', ability };
      const at = cell(a.cell);
      return at === null ? null : { type: 'monk', ability, cell: at };
    }
    case 'swap':
    case 'stance':
      return { type: a.type };
    case 'cast': {
      // A spell of the holy tome: its name, the cell it is aimed at, the pack slot or the choice it takes.
      if (typeof a.spell !== 'string' || !/^[A-Za-z]{3,30}$/.test(a.spell)) return null;
      const out: Extract<Action, { type: 'cast' }> = { type: 'cast', spell: a.spell };
      if (a.cell !== undefined) {
        const at = cell(a.cell);
        if (at === null) return null;
        out.cell = at;
      }
      if (a.item !== undefined) {
        const item = slot(a.item);
        if (item === null) return null;
        out.item = item;
      }
      if (a.choice !== undefined) {
        if (!isInt(a.choice, 0, MAX_CLASS_CHOICE)) return null;
        out.choice = a.choice;
      }
      return out;
    }
    case 'quick':
      // HolyTome.setQuickSpell: a spell's name, or none.
      if (a.spell === null) return { type: 'quick', spell: null };
      return typeof a.spell === 'string' && /^[A-Za-z]{3,30}$/.test(a.spell) ? { type: 'quick', spell: a.spell } : null;
    case 'augment': {
      // StoneOfAugmentation: the stone, what it is used on, and how.
      const item = slot(a.item);
      const on = itemRef(a.on);
      const augment = oneOf(a.augment, ['speed', 'damage', 'evasion', 'defense', 'none'] as const);
      return item === null || on === null || !augment ? null : { type: 'augment', item, on, augment };
    }
    case 'tip': {
      // Dart.AC_TIP: the darts, the seed, and whether as many as it will.
      const item = slot(a.item);
      const seed = slot(a.seed);
      if (item === null || seed === null) return null;
      return a.all === true ? { type: 'tip', item, seed, all: true } : { type: 'tip', item, seed };
    }
    case 'clean': {
      const item = slot(a.item);
      if (item === null) return null;
      return a.all === true ? { type: 'clean', item, all: true } : { type: 'clean', item };
    }
    case 'affix': {
      const from = sealSource(a.from);
      const to = sealSource(a.to);
      return from === null || to === null ? null : { type: 'affix', from, to };
    }
    case 'detach': {
      const armor = sealSource(a.armor);
      return armor === null ? null : { type: 'detach', armor };
    }
    case 'plan': {
      // Live turns: a standing order of a few steps, each a plain action or one that lasts.
      if (!Array.isArray(a.steps) || a.steps.length > MAX_PLAN_STEPS) return null;
      const steps: PlanStep[] = [];
      for (const raw of a.steps as unknown[]) {
        const step = sanitizePlanStep(raw);
        if (!step) return null;
        steps.push(step);
      }
      return { type: 'plan', steps };
    }
    default:
      return null;
  }
}

/** The longest plan a client may send (the core keeps 64). */
const MAX_PLAN_STEPS = 64;

/** One step of a live plan: going somewhere, hunting, resting, striding, or any action but another plan. */
function sanitizePlanStep(raw: unknown): PlanStep | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const s = raw as Record<string, unknown>;
  switch (s.type) {
    case 'go': {
      const to = cell(s.to);
      return to === null ? null : { type: 'go', to };
    }
    case 'hunt':
      return typeof s.target === 'string' && s.target.length > 0 && s.target.length <= 64 ? { type: 'hunt', target: s.target } : null;
    case 'rest':
      return { type: 'rest' };
    case 'stride':
      return isInt(s.dx, -1, 1) && isInt(s.dy, -1, 1) && (s.dx !== 0 || s.dy !== 0) ? { type: 'stride', dx: s.dx, dy: s.dy } : null;
    case 'plan':
      return null;
    default:
      return sanitizeAction(raw);
  }
}

const SKINS = [...new Set(OFFERS.flatMap((offer) => (offer.skin ? [offer.skin] : [])))] as SkinVariant[];
const EFFECTS = [...new Set(OFFERS.flatMap((offer) => (offer.effect ? [offer.effect] : [])))] as EffectId[];
const FRAMES = [...new Set(OFFERS.flatMap((offer) => (offer.frame ? [offer.frame] : [])))] as FrameId[];

/** A look of things Pixel-Mart has; `patron` is the server's to set, never the client's. */
export function sanitizeLook(raw: unknown): Look {
  if (typeof raw !== 'object' || raw === null) return {};
  const l = raw as Record<string, unknown>;
  const look: Look = {};
  const skin = oneOf(l.skin, SKINS);
  const effect = oneOf(l.effect, EFFECTS);
  const frame = oneOf(l.frame, FRAMES);
  if (skin) look.skin = skin;
  if (effect) look.effect = effect;
  if (frame) look.frame = frame;
  return look;
}

/**
 * A client's message as the room will handle it. An action of the wrong shape
 * is null (the sender hears it was refused); a signal is checked by validSignal
 * (signals.ts) when it is relayed.
 */
export type RoomMessage =
  | { type: 'act'; action: Action | null }
  | { type: 'restart' }
  | { type: 'sync' }
  | { type: 'look'; look: Look }
  | { type: 'signal'; signal: unknown };

/** A client's message, rebuilt, or null if it is not one. */
export function parseClientMessage(raw: unknown): RoomMessage | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const m = raw as Record<string, unknown>;
  switch (m.type) {
    case 'act':
      return { type: 'act', action: sanitizeAction(m.action) };
    case 'restart':
    case 'sync':
      return { type: m.type };
    case 'look':
      return { type: 'look', look: sanitizeLook(m.look) };
    case 'signal':
      return { type: 'signal', signal: m.signal };
    default:
      return null;
  }
}
