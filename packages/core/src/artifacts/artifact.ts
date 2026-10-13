import { createItem, type Item, itemDef, type ItemKind } from '../items';
import { cursedKnown, levelKnown, unidentified } from '../ident';
import type { RunState } from '../run';
import type { Rng } from '../rng';
import { S } from '../spd-sprites';

/*
 * Artifact: what every artifact shares. Its level (Item.level) runs from 0 to
 * its kind's cap and grows with use; it shows as +0 to +10 whatever the cap
 * (visiblyUpgraded). Most hold a charge, built up a fraction at a time, and
 * some an experience towards their next level or a cooldown. Each kind is
 * unique in a run: the Generator deals them from a deck that never refills.
 * Three in ten come cursed; worn, a cursed artifact will not come off, and
 * most of them then work against their bearer.
 */

export type ArtifactKind =
  | 'artifact.cloak' | 'artifact.horn' | 'artifact.chalice' | 'artifact.hourglass' | 'artifact.talisman' | 'artifact.spellbook'
  | 'artifact.chains' | 'artifact.rose' | 'artifact.armband' | 'artifact.sandals' | 'artifact.cape' | 'artifact.toolkit'
  | 'artifact.beacon';

export const isArtifact = (item: Item | null | undefined): boolean => !!item && itemDef(item.kind).category === 'artifact';

/** Artifact.levelCap of each kind. */
export const LEVEL_CAP: Readonly<Record<ArtifactKind, number>> = {
  'artifact.cloak': 10, 'artifact.horn': 10, 'artifact.chalice': 10, 'artifact.hourglass': 5, 'artifact.talisman': 10,
  'artifact.spellbook': 10, 'artifact.chains': 5, 'artifact.rose': 10, 'artifact.armband': 10, 'artifact.sandals': 3,
  'artifact.cape': 10, 'artifact.toolkit': 10, 'artifact.beacon': 3,
};

export const levelCap = (item: Item): number => LEVEL_CAP[item.kind as ArtifactKind] ?? 0;

/** Artifact.chargeCap of each kind at the artifact's level; 0 where it has no cap. */
export function chargeCap(item: Item): number {
  const level = item.level;
  switch (item.kind as ArtifactKind) {
    case 'artifact.cloak':
      return Math.min(level + 3, 10);
    case 'artifact.horn':
    case 'artifact.armband':
      return 5 + Math.trunc(level / 2);
    case 'artifact.hourglass':
      return 5 + level;
    case 'artifact.spellbook':
      // (int)(level()*0.6f)+2
      return Math.trunc(Math.fround(level * Math.fround(0.6))) + 2;
    case 'artifact.talisman':
    case 'artifact.rose':
    case 'artifact.sandals':
    case 'artifact.cape':
      return 100;
    case 'artifact.beacon':
      return 3 + level;
    default:
      return 0;
  }
}

/** What each kind sets out with: the cloak, the hourglass and the spellbook full, the rose full, the chains with five. */
function startingCharge(item: Item): number {
  switch (item.kind as ArtifactKind) {
    case 'artifact.cloak':
    case 'artifact.hourglass':
    case 'artifact.spellbook':
    case 'artifact.rose':
      return chargeCap(item);
    case 'artifact.chains':
      return 5;
    default:
      return 0;
  }
}

/** A new artifact's charge (the instance initialisers of each kind). */
export function initArtifact(item: Item): void {
  item.charge = startingCharge(item);
}

/** Artifact.visiblyUpgraded: the level as shown, +0 to +10 whatever the cap, once it is known. */
export const visiblyUpgraded = (item: Item): number => (levelKnown(item) ? Math.round((item.level * 10) / levelCap(item)) : 0);

/** Artifact.isIdentified: its level and its curse known. */
export const artifactKnown = (item: Item): boolean => levelKnown(item) && cursedKnown(item);

/** Artifact.value; the cloak is the rogue's own (0, never sold), and an outfitted rose is not for sale either. */
export function artifactValue(item: Item): number {
  if (item.kind === 'artifact.cloak') return 0;
  if (item.kind === 'artifact.rose' && (item.ghostWeapon || item.ghostArmor)) return 0;
  let price = 100;
  if (item.level > 0) price += 20 * visiblyUpgraded(item);
  if (item.cursed && cursedKnown(item)) price = Math.trunc(price / 2);
  return Math.max(1, price);
}

/**
 * Artifact.status: what its slot shows — nothing while it is not identified or is cursed; the
 * cooldown while there is one; then the charge, as a percentage, as charge/cap, or alone.
 * (The rose's ghost's health and the toolkit's warming up are the client's to show, see artifactStatus.)
 */
export function artifactStatus(item: Item): string | null {
  if (!artifactKnown(item) || item.cursed) return null;
  if ((item.cooldown ?? 0) !== 0) return String(item.cooldown);
  const cap = chargeCap(item);
  const charge = item.charge ?? 0;
  if (cap === 100) return `${charge}%`;
  if (cap > 0) return `${charge}/${cap}`;
  return charge !== 0 ? String(charge) : null;
}

/** The artifact's picture as it is now: the horn fuller, the chalice redder, the sandals grown into greaves, the rose blooming. */
export function artifactSprite(item: Item): number {
  switch (item.kind as ArtifactKind) {
    case 'artifact.horn': {
      // HornOfPlenty: by the charge it holds.
      const charge = item.charge ?? 0;
      return charge >= 8 ? S.ARTIFACT_HORN4 : charge >= 5 ? S.ARTIFACT_HORN3 : charge >= 2 ? S.ARTIFACT_HORN2 : S.ARTIFACT_HORN1;
    }
    case 'artifact.chalice':
      return item.level >= 7 ? S.ARTIFACT_CHALICE3 : item.level >= 3 ? S.ARTIFACT_CHALICE2 : S.ARTIFACT_CHALICE1;
    case 'artifact.sandals':
      return item.level >= 3 ? S.ARTIFACT_GREAVES : item.level === 2 ? S.ARTIFACT_BOOTS : item.level === 1 ? S.ARTIFACT_SHOES : S.ARTIFACT_SANDALS;
    case 'artifact.rose':
      return item.level >= 10 ? S.ARTIFACT_ROSE3 : item.level >= 5 ? S.ARTIFACT_ROSE2 : S.ARTIFACT_ROSE1;
    default:
      return itemDef(item.kind).sprite!;
  }
}

/*
 * Generator.randomArtifact: the run's deck of artifacts, each kind once. The cloak is the rogue's,
 * the holy tome the cleric's and the skeleton key the vault's (none of them dealt); Shattered's
 * Generator never deals the cape of thorns nor Lloyd's beacon either (see dropLoot for theirs).
 */
export const ARTIFACT_DECK: readonly ItemKind[] = [
  'artifact.toolkit', 'artifact.chalice', 'artifact.rose', 'artifact.chains', 'artifact.horn', 'artifact.armband',
  'artifact.sandals', 'artifact.talisman', 'artifact.hourglass', 'artifact.spellbook',
];

/** The kinds the run's deck still holds (absent in a run from before artifacts: all of them). */
export const artifactsLeft = (run: RunState): ItemKind[] => (run.artifactsLeft ??= [...ARTIFACT_DECK]);

/** Artifact.random: always +0, three in ten cursed; and as found it tells neither its level nor its curse. */
export function rollArtifact(kind: ItemKind, rng: Rng): Item {
  const item = createItem(kind);
  if (rng.float() < 0.3) item.cursed = true;
  return unidentified(item);
}

/** Generator.randomArtifact: an artifact the run has not dealt yet, or null when none is left. */
export function randomArtifact(run: RunState, rng: Rng): Item | null {
  const left = artifactsLeft(run);
  if (left.length === 0) return null;
  const kind = left.splice(rng.int(left.length), 1)[0]!;
  return rollArtifact(kind, rng);
}

/** Generator.removeArtifact: the kind is taken out of the run's deck; false if it was dealt already. */
export function removeArtifact(run: RunState, kind: ItemKind): boolean {
  const left = artifactsLeft(run);
  const at = left.indexOf(kind);
  if (at < 0) return false;
  left.splice(at, 1);
  return true;
}
