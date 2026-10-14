import { type Hero, isAlive } from '../actors';
import { buffsOf } from '../buffs';
import { type Ctx, isHero } from '../floor';
import { identify, isIdentified, learn } from '../ident';
import { type Item, itemDef, type ItemKind } from '../items';
import { LENGTH, NEIGHBOURS9, WIDTH } from '../level/geometry';
import { T } from '../level/terrain';
import { shieldUp } from '../status';
import {
  hasTalent, pointsInTalent, talentBook, type TalentId, tierOfTalent, upgradeProblem,
} from './data';
import { tbOf } from './state';
import { classFoodEaten, classStoneUsed } from '../classes/hooks';
import { identifiesOnEquip, intuitionSpeed } from '../classes/duelist-talents';
import { classTalentUpgraded } from '../classes/talent-effects';

/*
 * Talent.java's static hooks: what the talents do as food is eaten, potions drunk, scrolls read, items put on or
 * picked up, and artifacts used; the item-identification speeds; and a talent's upgrade. The talents' effects in
 * combat, on the move and as turns pass are in combat.ts and turns.ts, the subclasses' in subclass/.
 */

export * from './data';
export { tbOf } from './state';

/* Talent.itemIDSpeedFactor */

/**
 * Talent.itemIDSpeedFactor: how much faster an item is known by use. Veteran's intuition for melee weapons (1.75x/2.5x)
 * and armour (2.5x/instantly at +2), the scholar's for wands (3x/instantly), the survivalist's for thrown weapons
 * (3x/instantly), the thief's for rings (2x/instantly).
 */
export function idSpeedFactor(hero: Hero, item: Item): number {
  const category = itemDef(item.kind).category;
  const f32 = Math.fround;
  let factor = 1;
  if (category === 'weapon') factor = f32(factor * f32(1 + f32(0.75 * pointsInTalent(hero, 'veterans_intuition'))));
  if (category === 'armor') factor = f32(factor * (1 + pointsInTalent(hero, 'veterans_intuition')));
  if (category === 'wand') factor = f32(factor * f32(1 + f32(2 * pointsInTalent(hero, 'scholars_intuition'))));
  if (category === 'missile') factor = f32(factor * f32(1 + f32(2 * pointsInTalent(hero, 'survivalists_intuition'))));
  if (category === 'ring') factor = f32(factor * (1 + pointsInTalent(hero, 'thiefs_intuition')));
  // The Duelist's adventurer's intuition (melee weapons 2.5x, armour 1.75x at +1; instant and 2.5x at +2).
  if (category === 'weapon' || category === 'armor') factor = f32(factor * intuitionSpeed(hero, category));
  return factor;
}

/* Talent.onTalentUpgraded */

/** Hero.upgradeTalent: a point more in a talent, and what that does at once. */
export function upgradeTalent(ctx: Ctx, hero: Hero, id: TalentId): void {
  const book = talentBook(hero);
  for (const tier of book.tiers) {
    if (tier[id] !== undefined) tier[id]!++;
  }
  ctx.effects.push({ type: 'talent', hero: hero.id, talent: id, points: pointsInTalent(hero, id) });
  onTalentUpgraded(ctx, hero, id);
  classTalentUpgraded(ctx, hero, id);
}

/** Why a talent point cannot be spent on that talent (see data.ts upgradeProblem). */
export { upgradeProblem };

/** Talent.onTalentUpgraded. */
export function onTalentUpgraded(ctx: Ctx, hero: Hero, id: TalentId): void {
  const points = pointsInTalent(hero, id);
  const world = ctx.world;
  // (For metamorphosis) the warrior's shield for a hero of another class: seal.ts maxShield reads the points.
  if (id === 'veterans_intuition' && points === 2) identify(world, hero.armor);
  if (id === 'thiefs_intuition' && points === 2) {
    for (const ring of [hero.ring, hero.misc]) if (ring && itemDef(ring.kind).category === 'ring') identify(world, ring);
    for (const item of hero.items) if (itemDef(item.kind).category === 'ring') learn(world, item.kind);
  }
  if (id === 'thiefs_intuition' && points === 1) {
    for (const ring of [hero.ring, hero.misc]) if (ring && itemDef(ring.kind).category === 'ring') learn(world, ring.kind);
  }
}

/* Food (Talent.onFoodEaten, Food.eatingTime) */

/** The meal talents: eating takes two turns less. */
const MEAL_TALENTS: readonly TalentId[] = ['iron_stomach', 'energizing_meal', 'mystical_meal', 'invigorating_meal', 'focused_meal', 'enlightening_meal'];

/** Food.TIME_TO_EAT. */
export const TIME_TO_EAT = 3;

/**
 * Food.eatingTime: three turns; a supply ration or a berry takes one (SupplyRation and Berry.eatingTime); with a meal
 * talent, two turns less (none at all for those two).
 */
export function eatingTime(hero: Hero, kind: ItemKind = 'food.ration'): number {
  const quick = kind === 'food.supply' || kind === 'food.berry';
  const base = quick ? 1 : TIME_TO_EAT;
  return MEAL_TALENTS.some((id) => hasTalent(hero, id)) ? Math.max(0, base - 2) : base;
}

/**
 * Talent.onFoodEaten: `energy` is how much the meal fed (0 from a soul eater's kill), `source` the food (a horn of plenty
 * passes null). SEAM(classes): the duelist's and cleric's meal talents (strengthening, focused, satiated spells,
 * enlightening) go here once those classes come.
 */
export function onFoodEaten(ctx: Ctx, hero: Hero, _energy: number, source: Item | 'horn' | null, eatTime = 0): void {
  const b = tbOf(hero);
  if (hasTalent(hero, 'hearty_meal')) {
    // 4/6 health, when the hero is below a third of it (with a little rounding up).
    if (hero.hp / hero.ht < 0.334) {
      const healing = 2 + 2 * pointsInTalent(hero, 'hearty_meal');
      const amount = Math.min(healing, hero.ht - hero.hp);
      hero.hp += amount;
      ctx.effects.push({ type: 'healed', hero: hero.id, amount: healing });
    }
  }
  if (hasTalent(hero, 'iron_stomach')) {
    // Iron stomach: until the hero acts again (hero.cooldown()), damage is eased (Hero.damage).
    b.ironStomach = { until: hero.time + eatTime, depth: hero.depth };
  }
  if (hasTalent(hero, 'empowering_meal')) {
    // 2/3 bonus wand damage for the next 3 zaps.
    const boost = 1 + pointsInTalent(hero, 'empowering_meal');
    b.wandEmpower = { boost, left: Math.max(b.wandEmpower?.left ?? 0, 3) };
    ctx.effects.push({ type: 'charged', hero: hero.id });
  }
  let wandChargeTurns = 0;
  if (hasTalent(hero, 'energizing_meal')) wandChargeTurns += 2 + 3 * pointsInTalent(hero, 'energizing_meal');
  let artifactChargeTurns = 0;
  if (hasTalent(hero, 'mystical_meal')) artifactChargeTurns += 1 + 2 * pointsInTalent(hero, 'mystical_meal');
  if (hasTalent(hero, 'invigorating_meal')) {
    // Effectively 1/2 turns of haste.
    const buffs = buffsOf(hero);
    buffs.haste = Math.max(buffs.haste ?? 0, 0.67 + pointsInTalent(hero, 'invigorating_meal'));
  }
  // The Duelist's and the Cleric's meals (strengthening, focused, satiated spells, enlightening).
  classFoodEaten(ctx, hero);
  // We process these at the end as they can stack together from some talents.
  if (wandChargeTurns > 0) {
    hero.recharging = Math.max(hero.recharging ?? 0, wandChargeTurns);
    ctx.effects.push({ type: 'charged', hero: hero.id });
    ctx.effects.push({ type: 'spell', hero: hero.id, sprite: 'charge' });
  }
  if (artifactChargeTurns > 0) {
    const buffs = buffsOf(hero);
    if ((buffs.artifactRecharge ?? 0) < artifactChargeTurns) {
      buffs.artifactRecharge = artifactChargeTurns;
      // ArtifactRecharge.ignoreHornOfPlenty: a horn of plenty's own meal does not charge it.
      if (source === 'horn' || source?.kind === 'artifact.horn') buffs.artifactRechargeNoHorn = true;
      else delete buffs.artifactRechargeNoHorn;
    }
    ctx.effects.push({ type: 'charged', hero: hero.id });
    ctx.effects.push({ type: 'spell', hero: hero.id, sprite: 'charge', tint: [0, 1, 1] });
  }
}

/* Potions, scrolls and runestones (Talent.onPotionUsed, onScrollUsed, onRunestoneUsed) */

/**
 * How much a potion, scroll or spell counts for the talents (Potion.talentFactor and talentChance, and Scroll's and
 * Spell's): the strong ones count double (strength, experience, mastery, inspiration, might, enchantment,
 * metamorphosis, transmutation, upgrade, magical infusion, recycle), the spells brewed in batches
 * only in proportion to how many one brew makes.
 */
export function talentUse(kind: ItemKind): { factor: number; chance: number } {
  const factor = DOUBLE.has(kind) ? 2 : 1;
  const batch = BATCH[kind];
  return { factor, chance: batch ? 1 / batch : 1 };
}

const DOUBLE: ReadonlySet<ItemKind> = new Set<ItemKind>([
  'elixir.might', 'potion.divineInspiration', 'potion.mastery', 'potion.experience', 'potion.strength', 'scroll.enchantment',
  'scroll.metamorphosis', 'scroll.transmutation', 'scroll.upgrade', 'spell.magicalInfusion', 'spell.recycle',
]);

/** Recipe.OUT_QUANTITY of the brews, elixirs and spells whose talentChance is 1/OUT_QUANTITY. */
const BATCH: Partial<Record<ItemKind, number>> = {
  'brew.aqua': 8, 'elixir.featherFall': 1, 'spell.alchemize': 8, 'spell.beacon': 5, 'spell.curseInfusion': 4,
  'spell.phaseShift': 6, 'spell.reclaimTrap': 5, 'spell.recycle': 12, 'spell.summonElemental': 6, 'spell.telekineticGrab': 8,
  'spell.wildEnergy': 5,
};

/** Talent.onPotionUsed: liquid willpower's shield and liquid nature's grass, at the cell the potion was drunk or broke. */
export function onPotionUsed(ctx: Ctx, hero: Hero, cell: number, factor: number): void {
  if (hasTalent(hero, 'liquid_willpower')) {
    // 6.5/10% of max health.
    const shield = Math.round(factor * hero.ht * Math.fround(0.03 + Math.fround(0.035 * pointsInTalent(hero, 'liquid_willpower'))));
    shieldUp(hero, (hero.shield ?? 0) + shield > 0 ? shield : 0);
    ctx.effects.push({ type: 'barrier', depth: ctx.depth, who: hero.id, amount: shield });
  }
  if (hasTalent(hero, 'liquid_nature')) liquidNature(ctx, hero, cell, factor);
}

/** The potion's cell and the cells around it grow grass (LIQUID_NATURE), roots hold the foes there. */
function liquidNature(ctx: Ctx, hero: Hero, cell: number, factor: number): void {
  const points = pointsInTalent(hero, 'liquid_nature');
  const { level, floor } = ctx;
  const cells = NEIGHBOURS9.map((n) => cell + n).filter((c) => c >= 0 && c < LENGTH && Math.abs((c % WIDTH) - (cell % WIDTH)) <= 1);
  ctx.rng.shuffle(cells);
  const grown: number[] = [];
  for (const c of cells) {
    const foe = floor.mobs.find((mob) => mob.pos === c && isAlive(mob) && !mob.ally && mob.state !== 'passive');
    // 1/2 turns of roots.
    if (foe) foe.rooted = Math.max(foe.rooted ?? 0, factor * points);
    const terrain = level.map[c]!;
    if (terrain === T.EMPTY || terrain === T.EMBERS || terrain === T.EMPTY_DECO) {
      level.map[c] = T.GRASS;
    }
    grown.push(c);
  }
  // 4/6 cells total get tall grass.
  const total = Math.trunc(factor * (2 + 2 * points));
  while (cells.length > total) cells.shift();
  for (const c of cells) {
    const t = level.map[c]!;
    if ((t === T.EMPTY || t === T.EMPTY_DECO || t === T.EMBERS || t === T.GRASS) && !floor.plants?.some((p) => p.pos === c)) {
      level.map[c] = T.HIGH_GRASS;
    }
  }
  ctx.effects.push({ type: 'bloomed', depth: ctx.depth, cells: grown });
}

/** Talent.onScrollUsed: inscribed power's empowered zaps and inscribed stealth's invisibility. */
export function onScrollUsed(ctx: Ctx, hero: Hero, factor: number): void {
  const b = tbOf(hero);
  if (hasTalent(hero, 'inscribed_power')) {
    // 2/3 empowered wand zaps.
    b.scrollEmpower = Math.max(b.scrollEmpower ?? 0, Math.trunc(factor * (1 + pointsInTalent(hero, 'inscribed_power'))));
    ctx.effects.push({ type: 'spell', hero: hero.id, sprite: 'charge', tint: [1, 0.8, 0.4] });
  }
  if (hasTalent(hero, 'inscribed_stealth')) {
    // 3/5 turns of stealth.
    hero.invisible = Math.max(hero.invisible, factor * (1 + 2 * pointsInTalent(hero, 'inscribed_stealth')));
    ctx.effects.push({ type: 'stealth', hero: hero.id, on: true });
  }
}

/** Talent.onRunestoneUsed: nothing for the four classes (the cleric's recall inscription lives with the classes stream). */
export function onRunestoneUsed(ctx: Ctx, hero: Hero, kind: ItemKind): void {
  // The cleric's recall inscription.
  classStoneUsed(ctx, hero, kind);
}

/** Talent.onArtifactUsed: enhanced rings, a level more on every ring for a while. */
export function onArtifactUsed(_ctx: Ctx, hero: Hero): void {
  if (hasTalent(hero, 'enhanced_rings')) {
    const b = tbOf(hero);
    b.enhancedRings = Math.max(b.enhancedRings ?? 0, 3 * pointsInTalent(hero, 'enhanced_rings'));
  }
}

/* Items put on and taken up (Talent.onItemEquipped, onItemCollected) */

/** Talent.onItemEquipped: the thief learns rings on putting them on, and veteran's intuition knows armour at once. */
export function onItemEquipped(ctx: Ctx, hero: Hero, item: Item): void {
  const category = itemDef(item.kind).category;
  let known = false;
  if (pointsInTalent(hero, 'veterans_intuition') === 2 && category === 'armor') known = true;
  // Adventurer's intuition at +2: a weapon is known on sight.
  if (category === 'weapon' && identifiesOnEquip(hero)) known = true;
  if (hasTalent(hero, 'thiefs_intuition') && category === 'ring') {
    if (pointsInTalent(hero, 'thiefs_intuition') === 2) known = true;
    learn(ctx.world, item.kind);
  }
  if (known && !isIdentified(ctx.world, item)) identify(ctx.world, item);
}

/** Talent.onItemCollected: with the thief's best intuition, a ring picked up is known for what it is. */
export function onItemCollected(ctx: Ctx, hero: Hero, item: Item): void {
  if (pointsInTalent(hero, 'thiefs_intuition') === 2 && itemDef(item.kind).category === 'ring') learn(ctx.world, item.kind);
}

/* Per-class numbers that other modules ask for */

/** The warrior's Iron Will: points in it (a seal's shield is that much stronger; for another class it is the whole shield). */
export const ironWillPoints = (hero: Hero): number => pointsInTalent(hero, 'iron_will');

/** BrokenSeal.canTransferGlyph: with runic transference at +2 any glyph, at +1 a common or uncommon one. */
export function canTransferGlyph(hero: Hero, glyph: string | undefined): boolean {
  if (!glyph) return false;
  const points = pointsInTalent(hero, 'runic_transference');
  if (points === 2) return true;
  return points === 1 && !RARE_GLYPHS.has(glyph);
}
const RARE_GLYPHS: ReadonlySet<string> = new Set(['affection', 'antiMagic', 'thorns']);

/** Armor.upgrade: the level from which an armour's glyph may be lost on upgrading, later with a metamorphed runic transference. */
export function glyphLossStart(hero: Hero | undefined): number {
  return 4 + (hero && hero.heroClass !== 'warrior' && hasTalent(hero, 'runic_transference') ? 1 + pointsInTalent(hero, 'runic_transference') : 0);
}

export { tierOfTalent };
