import type { RunState } from '../../../../run';
import { Dungeon } from '../../dungeon';
import { Random } from '../../random';
import { SpecialRoom } from '../special/special';

/*
 * levels/rooms/secret/SecretRoom: special rooms behind hidden doors at the end of little mazes.
 * Each region has two to three of them (more the deeper), spread over its floors; every run deals
 * the kinds from a shuffled deck, the used ones going to the back.
 */

export abstract class SecretRoom extends SpecialRoom {
  override readonly group = 'secret' as const;
}

const ALL_SECRETS = [
  'SecretGardenRoom', 'SecretLaboratoryRoom', 'SecretLibraryRoom', 'SecretLarderRoom', 'SecretWellRoom', 'SecretRunestoneRoom',
  'SecretArtilleryRoom', 'SecretChestChasmRoom', 'SecretHoneypotRoom', 'SecretHoardRoom', 'SecretMazeRoom', 'SecretSummoningRoom',
];

/** Every secret room kind, by Shattered's class name; filled by the rooms' modules (rooms/index.ts). */
export const SECRET_ROOMS = new Map<string, () => SecretRoom>();

/** Secret rooms per region (whole part), and the chance of one more (fraction). */
const BASE_REGION_SECRETS = [2, 2.25, 2.5, 2.75, 3.0];

/** SecretRoom.initForRun. */
export function initSecretsForRun(run: RunState): void {
  run.regionSecrets = BASE_REGION_SECRETS.map((chance) => {
    let n = Math.trunc(chance);
    if (Random.Float() < Math.fround(chance % 1)) n++;
    return n;
  });
  const deck = [...ALL_SECRETS];
  Random.shuffle(deck);
  run.secretRooms = deck;
}

/** SecretRoom.secretsForFloor: the region's secrets spread over its floors, the rest on its last. */
export function secretsForFloor(depth: number): number {
  if (depth === 1) return 0;
  const run = Dungeon.run;
  const regions = (run.regionSecrets ??= [0, 0, 0, 0, 0]);
  const region = Math.trunc(depth / 5);
  const floor = depth % 5;
  const floorsLeft = 5 - floor;
  let secrets: number;
  if (floorsLeft === 0) {
    secrets = regions[region] ?? 0;
  } else {
    secrets = Math.fround((regions[region] ?? 0) / floorsLeft);
    secrets = Random.Float() < Math.fround(secrets % 1) ? Math.ceil(secrets) : Math.floor(secrets);
  }
  regions[region] = (regions[region] ?? 0) - Math.trunc(secrets);
  return Math.trunc(secrets);
}

/** SecretRoom.createRoom: from the front of the deck (60/30/10%), that kind then to the back. */
export function createSecretRoom(): SecretRoom {
  const deck = (Dungeon.run.secretRooms ??= [...ALL_SECRETS]);
  let index = Random.chances([6, 3, 1]);
  while (index >= deck.length) index--;
  const kind = deck[index]!;
  const factory = SECRET_ROOMS.get(kind) ?? SECRET_ROOMS.get('EmptySecretRoom');
  if (!factory) throw new Error(`No secret room ${kind}`);
  deck.push(deck.splice(index, 1)[0]!);
  return factory();
}
