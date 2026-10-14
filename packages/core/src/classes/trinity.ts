import { createMob, type Hero, heroEquipped } from '../actors';
import { dispelInvisibility } from '../artifacts';
import { eatFromHorn } from '../artifacts/horn';
import { castChains, chainsPlanProblem } from '../artifacts/chains';
import { stealFrom } from '../artifacts/armband';
import { rootSandals } from '../artifacts/sandals';
import { scry } from '../artifacts/talisman';
import { readSpellbook } from '../artifacts/spellbook';
import { chargeCap, levelCap } from '../artifacts/artifact';
import { isMagicImmune } from '../buffs';
import { type Ctx, canEnter, charAt, enterCell, heroView, isHero } from '../floor';
import { refreshMightHT } from '../hero';
import {
  COMMON_ENCHANTMENTS, COMMON_GLYPHS, createItem, isCurseEnchant, isCurseGlyph, type Item, itemDef, ITEMS, type ItemKind, RARE_ENCHANTMENTS,
  RARE_GLYPHS, UNCOMMON_ENCHANTMENTS, UNCOMMON_GLYPHS, WAND_KINDS, wandMaxCharges,
} from '../items';
import { adjacent, distance, LENGTH, NEIGHBOURS8 } from '../level/geometry';
import { throwMissile } from '../throwing';
import { zap } from '../wands';
import { pointsInTalent as pointsIn } from '../talents';
import type { World } from '../world';
import { ABILITY_DEFS, chargeUse, spendArmorCharge } from './abilities';
import { say, tell } from './common';
import { cs, hasTimer, prolong, setTimer } from './state';

/*
 * Trinity's three forms (the Cleric's armour ability, and the spells that set them): the body form (an enchantment or glyph the
 * party has seen, for a while), the mind form (a wand or a thrown weapon seen, used once at a level the talent makes) and the
 * spirit form (a ring or an artifact seen, its effect used). What the party has seen is Statistics.itemTypesDiscovered, kept here
 * as the kinds met or made known (ClassState.seen).
 */

export type Form = 'body' | 'mind' | 'spirit';
export const FORMS: readonly Form[] = ['body', 'mind', 'spirit'];

/* What has been seen */

/** Statistics.itemTypesDiscovered, for the Cleric: the kinds the party has come across, enchantments and glyphs when known. */
export const discoveredOf = (hero: Hero): string[] => cs(hero).seen ?? [];

function see(hero: Hero, what: string): void {
  const seen = (cs(hero).seen ??= []);
  if (!seen.includes(what)) seen.push(what);
}

/** Whether nothing of an item is left to learn (Item.isIdentified): its level, its curse and a wand's charges are known. */
const known = (item: Item): boolean => !item.levelUnknown && !item.curseUnknown && !item.chargesUnknown;

/**
 * Item.collect and Item.identify (and Weapon's, Armor's and Ring's): a kind that is known when it is held is discovered, and an
 * enchantment or glyph on a known weapon or armour. Swept once a turn over what the Cleric carries, which comes to the same.
 */
export function sweepDiscovered(hero: Hero): void {
  if (hero.heroClass !== 'cleric') return;
  for (const item of [...heroEquipped(hero), ...hero.items]) {
    if (!known(item)) continue;
    const category = itemDef(item.kind).category;
    if (category === 'wand' || category === 'ring' || category === 'artifact' || category === 'missile') see(hero, item.kind);
    if (item.enchant && !isCurseEnchant(item.enchant)) see(hero, `enchant:${item.enchant}`);
    if (item.glyph && !isCurseGlyph(item.glyph)) see(hero, `glyph:${item.glyph}`);
  }
}

/* The options of each form */

// (Read when needed: items.ts and this file import each other.)
const enchants = (): readonly string[] => [...COMMON_ENCHANTMENTS, ...UNCOMMON_ENCHANTMENTS, ...RARE_ENCHANTMENTS];
const glyphs = (): readonly string[] => [...COMMON_GLYPHS, ...UNCOMMON_GLYPHS, ...RARE_GLYPHS];
/*
 * The artifacts with an effect to lend. SEAM(artifacts): the toolkit's remote alchemy and the hourglass's time bubble (Swiftthistle's
 * TimeBubble) wait for the alchemy screen and the swiftthistle seed; the cloak, the cape and the beacon have none.
 */
const ACTIVE_ARTIFACTS: readonly ItemKind[] = [
  'artifact.chalice', 'artifact.horn', 'artifact.rose', 'artifact.chains', 'artifact.armband', 'artifact.sandals', 'artifact.talisman', 'artifact.spellbook',
];
const kindsOf = (category: string): ItemKind[] => (Object.keys(ITEMS) as ItemKind[]).filter((kind) => itemDef(kind).category === category);

/** WndItemtypeSelect: what a form can be set to, from what the party has seen. */
export function trinityOptions(hero: Hero, form: Form): string[] {
  const seen = new Set(discoveredOf(hero));
  switch (form) {
    case 'body':
      return [...enchants().map((e) => `enchant:${e}`), ...glyphs().map((g) => `glyph:${g}`)].filter((option) => seen.has(option));
    case 'mind':
      return [...WAND_KINDS, ...kindsOf('missile')].filter((kind) => seen.has(kind));
    case 'spirit':
      return [...kindsOf('ring'), ...ACTIVE_ARTIFACTS].filter((kind) => seen.has(kind));
  }
}

const optionProblem = (hero: Hero, form: Form, choice: number | undefined): string | null =>
  choice !== undefined && Number.isInteger(choice) && choice >= 0 && choice < trinityOptions(hero, form).length ? null : 'choose an effect';
export const bodyProblem = (_world: World, hero: Hero, choice: number | undefined): string | null => optionProblem(hero, 'body', choice);
export const mindProblem = (_world: World, hero: Hero, choice: number | undefined): string | null => optionProblem(hero, 'mind', choice);
export const spiritProblem = (_world: World, hero: Hero, choice: number | undefined): string | null => optionProblem(hero, 'spirit', choice);

/** WndItemConfirm: the form is set. */
export function chooseForm(ctx: Ctx, hero: Hero, form: Form, choice: number): void {
  const option = trinityOptions(hero, form)[choice]!;
  (cs(hero).trinity ??= {})[form] = option;
  say(ctx, hero, { k: 'operate' });
  say(ctx, hero, { k: 'sound', name: 'teleport' });
  say(ctx, hero, { k: 'spell', at: hero.pos, name: 'enchant' });
}

/* Durations and levels of the forms (BodyForm, MindForm, SpiritForm) */

/** BodyForm.duration. */
export const bodyDuration = (hero: Hero): number => Math.round(13.33 + 6.67 * pointsIn(hero, 'bodyForm'));
/** MindForm.itemLevel and effectLevel. */
export const mindLevel = (hero: Hero): number => 2 + pointsIn(hero, 'mindForm');
/** SpiritForm.ringLevel and artifactLevel. */
export const ringLevel = (hero: Hero): number => pointsIn(hero, 'spiritForm');
export const artifactLevel = (hero: Hero): number => 2 + 2 * pointsIn(hero, 'spiritForm');
/** SpiritFormBuff.DURATION. */
export const SPIRIT_TURNS = 20;

/** Trinity.trinityChargeUsePerEffect: the ability's base cost times so much for the rare and the strong. */
export function effectFactor(option: string): number {
  if (option.startsWith('enchant:')) return (RARE_ENCHANTMENTS as readonly string[]).includes(option.slice(8)) ? 2 : 1;
  if (option.startsWith('glyph:')) return (RARE_GLYPHS as readonly string[]).includes(option.slice(6)) ? 2 : 1;
  if (option === 'wand.fireblast' || option === 'wand.regrowth') return 2;
  if (option === 'artifact.rose' || option === 'artifact.spellbook') return 2;
  if (option === 'artifact.chains' || option === 'artifact.talisman' || option === 'artifact.hourglass') return 1.4;
  return 1;
}

const formOf = (choice: number | undefined): Form | undefined => (choice === undefined ? undefined : FORMS[choice]);

/** The cost of the form's effect, before heroic energy (25 for most). */
export function trinityCost(hero: Hero, choice?: number): number {
  const form = formOf(choice);
  const option = form ? cs(hero).trinity?.[form] : undefined;
  return Math.fround(25 * (option ? effectFactor(option) : 1));
}

/* Using a form */

/** An artifact made for the moment (Artifact.resetForTrinity): its level a share of its cap, no experience to gain, fully charged. */
function madeArtifact(kind: string, hero: Hero): Item {
  const item = createItem(kind as ItemKind);
  item.level = Math.round((artifactLevel(hero) * levelCap(item)) / 10);
  item.exp = -1e9;
  item.charge = chargeCap(item);
  delete item.levelUnknown;
  delete item.curseUnknown;
  return item;
}

/** Why the effect cannot be aimed at a cell (the artifacts' own refusals), as the text key of the artifact; null if it can. */
function aimProblem(ctx: Ctx, hero: Hero, option: string, cell: number): string | null {
  switch (option) {
    case 'artifact.chains': {
      const why = chainsPlanProblem(ctx, hero, madeArtifact(option, hero), cell);
      return why ? why.replace(/^art:/, '') : null;
    }
    case 'artifact.armband': {
      const there = charAt(ctx.world, hero.depth, cell);
      if (!adjacent(hero.pos, cell) || !there || isHero(there)) return 'masterthievesarmband.no_target';
      if (there.kind === 'shopkeeper') return 'masterthievesarmband.steal_shopkeeper';
      if (there.state === 'passive') return 'masterthievesarmband.no_target';
      return null;
    }
    case 'artifact.sandals':
      return heroView(ctx.world, hero)[cell] && distance(hero.pos, cell) <= 3 ? null : 'sandalsofnature.out_of_range';
    case 'artifact.talisman':
      return cell === hero.pos ? 'talismanofforesight.prompt' : null;
    default:
      return null;
  }
}

const NEEDS_CELL: ReadonlySet<string> = new Set(['artifact.chains', 'artifact.armband', 'artifact.sandals', 'artifact.talisman']);

export function trinityProblem(_world: World, hero: Hero, cell: number | undefined, choice: number | undefined): string | null {
  const set = cs(hero).trinity;
  if (!set?.body && !set?.mind && !set?.spirit) return 'art:actors.hero.abilities.cleric.trinity.no_imbue';
  const form = formOf(choice);
  if (!form || !set[form]) return 'choose a form';
  const option = set[form]!;
  const none = 'art:actors.hero.abilities.cleric.trinity.no_duplicate';
  const aimed = cell !== undefined && Number.isInteger(cell) && cell >= 0 && cell < LENGTH;
  if (form === 'body') {
    if (option.startsWith('enchant:') && hero.weapon?.enchant === option.slice(8)) return none;
    if (option.startsWith('glyph:') && hero.armor.glyph === option.slice(6)) return none;
    return null;
  }
  if (form === 'mind') {
    if (!aimed || cell === hero.pos) return 'choose a target';
    if (itemDef(option as ItemKind).category === 'wand' && isMagicImmune(hero)) return 'art:magic_immune';
    return null;
  }
  if (isMagicImmune(hero)) return 'art:magic_immune';
  if ([hero.ring, hero.misc, hero.artifact].some((i) => i?.kind === option)) return none;
  if (NEEDS_CELL.has(option) && !aimed) return 'choose a target';
  return null;
}

/** Uses the form the choice names; returns the time it took (nothing, and no charge, when it could not be done). */
export function doTrinity(ctx: Ctx, hero: Hero, cell: number | undefined, choice: number | undefined): number {
  const form = formOf(choice)!;
  const option = cs(hero).trinity![form]!;
  const cost = chargeUse(hero, ABILITY_DEFS.trinity, choice);
  let time: number;
  if (form === 'body') time = useBody(ctx, hero, option);
  else if (form === 'mind') time = useMind(ctx, hero, option as ItemKind, cell!);
  else time = useSpirit(ctx, hero, option as ItemKind, cell);
  if (time < 0) return 0;
  spendArmorCharge(hero, cost);
  return time;
}

/** BodyForm: the enchantment or glyph, for a while. */
function useBody(ctx: Ctx, hero: Hero, option: string): number {
  prolong(hero, 'bodyForm', bodyDuration(hero));
  cs(hero).bodyEffect = option;
  say(ctx, hero, { k: 'sound', name: 'teleport' });
  say(ctx, hero, { k: 'spell', at: hero.pos, name: 'enchant' });
  say(ctx, hero, { k: 'operate' });
  dispelInvisibility(ctx, hero);
  return 1;
}

/** MindForm.targetSelector.onSelect: a wand zapped at the target (fully charged, at the form's level), or a thrown weapon thrown. */
function useMind(ctx: Ctx, hero: Hero, kind: ItemKind, cell: number): number {
  const item = createItem(kind);
  item.level = mindLevel(hero);
  delete item.levelUnknown;
  delete item.curseUnknown;
  delete item.chargesUnknown;
  say(ctx, hero, { k: 'sound', name: 'teleport' });
  say(ctx, hero, { k: 'spell', at: hero.pos, name: 'enchant' });
  say(ctx, hero, { k: 'operate' });
  hero.items.push(item);
  const index = hero.items.length - 1;
  const wand = itemDef(kind).category === 'wand';
  let time: number;
  if (wand) {
    item.charges = wandMaxCharges(item);
    time = zap(ctx, hero, index, cell);
  } else {
    item.qty = 1;
    delete item.durability;
    // MissileWeapon.spawnedForEffect: whatever lands is gone.
    const before = new Set(ctx.floor.heaps.flatMap((heap) => heap.items));
    time = throwMissile(ctx, hero, index, cell);
    for (const heap of ctx.floor.heaps) heap.items = heap.items.filter((it) => before.has(it));
    ctx.floor.heaps = ctx.floor.heaps.filter((heap) => heap.items.length > 0);
  }
  const left = hero.items.indexOf(item);
  if (left >= 0) hero.items.splice(left, 1);
  // A zap that did not happen (a wand turned on oneself) costs nothing.
  return time === 0 && wand ? -1 : time;
}

/** SpiritForm: a ring's or the chalice's passive effect for twenty turns, or an artifact's effect used once. */
function useSpirit(ctx: Ctx, hero: Hero, kind: ItemKind, cell: number | undefined): number {
  if (itemDef(kind).category === 'ring') {
    const ring = createItem(kind);
    ring.level = ringLevel(hero);
    delete ring.levelUnknown;
    delete ring.curseUnknown;
    cs(hero).spiritRing = ring;
    setTimer(hero, 'spirit', SPIRIT_TURNS);
    lend(ctx, hero);
    return 1;
  }
  const item = madeArtifact(kind, hero);
  if (kind === 'artifact.chalice') {
    item.level = artifactLevel(hero);
    cs(hero).spiritRing = item;
    setTimer(hero, 'spirit', SPIRIT_TURNS);
    lend(ctx, hero);
    return 1;
  }
  // The effects that ask for a target are refused before anything is spent.
  if (cell !== undefined && NEEDS_CELL.has(kind)) {
    const why = aimProblem(ctx, hero, kind, cell);
    if (why) {
      tell(ctx, hero, why, 'w');
      return -1;
    }
  }
  dispelInvisibility(ctx, hero);
  hero.items.push(item);
  let time = 1;
  switch (kind) {
    case 'artifact.horn':
      time = eatFromHorn(ctx, hero, item, true);
      break;
    case 'artifact.chains':
      time = castChains(ctx, hero, item, cell!);
      break;
    case 'artifact.armband':
      time = stealFrom(ctx, hero, item, cell!);
      break;
    case 'artifact.sandals':
      item.seedEffect = ctx.rng.oneOf(['seed.fadeleaf', 'seed.firebloom', 'seed.icecap', 'seed.sorrowmoss'] as ItemKind[]);
      time = rootSandals(ctx, hero, item, cell!);
      break;
    case 'artifact.talisman':
      time = scry(ctx, hero, item, cell!);
      break;
    case 'artifact.spellbook':
      time = readSpellbook(ctx, hero, item);
      break;
    case 'artifact.rose':
      summonWraith(ctx, hero);
      break;
    default:
  }
  const left = hero.items.indexOf(item);
  if (left >= 0) hero.items.splice(left, 1);
  say(ctx, hero, { k: 'sound', name: 'teleport' });
  say(ctx, hero, { k: 'operate' });
  return time;
}

/** What the spirit form shows when it lends a ring or the chalice. */
function lend(ctx: Ctx, hero: Hero): void {
  dispelInvisibility(ctx, hero);
  say(ctx, hero, { k: 'sound', name: 'teleport' });
  say(ctx, hero, { k: 'spell', at: hero.pos, name: 'enchant' });
  say(ctx, hero, { k: 'operate' });
  // RingOfMight: Hero.updateHT.
  if (cs(hero).spiritRing?.kind === 'ring.might') refreshMightHT(hero, false);
}

/** DriedRose: a corrupted wraith with the health of a ghost of that level, on a free cell beside the hero. */
function summonWraith(ctx: Ctx, hero: Hero): void {
  const free = NEIGHBOURS8.map((n) => hero.pos + n).filter(
    (c) => c >= 0 && c < LENGTH && adjacent(hero.pos, c) && !charAt(ctx.world, ctx.depth, c) && canEnter(ctx.level, c),
  );
  if (free.length === 0) return;
  const pos = ctx.rng.element(free)!;
  const wraith = createMob(`#${++ctx.world.nextId}`, 'wraith', pos, 'wandering', ctx.floor.now + 1);
  wraith.level = ctx.depth;
  wraith.hp = wraith.ht = 20 + 8 * artifactLevel(hero);
  wraith.ally = true;
  wraith.corrupted = true;
  ctx.floor.mobs.push(wraith);
  enterCell(ctx.level, pos);
  ctx.effects.push({ type: 'ally', depth: ctx.depth, mob: wraith.id, event: 'corrupted' });
}

/* Upkeep */

/** Once a turn: what the party has seen, and the end of the forms that lent something (the ring or the chalice is taken back). */
export function trinityTurn(_ctx: Ctx, hero: Hero): void {
  sweepDiscovered(hero);
  const lent = hero.cls?.spiritRing;
  if (lent && !hasTimer(hero, 'spirit')) {
    delete hero.cls!.spiritRing;
    if (lent.kind === 'ring.might') refreshMightHT(hero, false);
  }
  if (hero.cls?.bodyEffect && !hasTimer(hero, 'bodyForm')) delete hero.cls.bodyEffect;
}
