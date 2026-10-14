import { CrystalChoiceRoom, CrystalPathRoom, CrystalVaultRoom } from './crystal';
import { DemonSpawnerRoom } from './demon-spawner';
import { MagicalFireRoom, PoolRoom, SentryRoom, ToxicGasRoom, TrapsRoom } from './hazards';
import { PitRoom, WeakFloorRoom } from './pit';
import { SacrificeRoom } from './sacrifice';
import { ImpShopRoom, ShopRoom } from './shop';
import { SPECIAL_ROOMS } from './special';
import {
  ArmoryRoom, CryptRoom, GardenRoom, LaboratoryRoom, LibraryRoom, MagicWellRoom, RunestoneRoom, StatueRoom, StorageRoom, TreasuryRoom,
} from './vaults';

/* The special rooms register themselves here (rooms/index.ts imports this module), by Shattered's class names. */

SPECIAL_ROOMS.set('ArmoryRoom', () => new ArmoryRoom());
SPECIAL_ROOMS.set('CryptRoom', () => new CryptRoom());
SPECIAL_ROOMS.set('CrystalChoiceRoom', () => new CrystalChoiceRoom());
SPECIAL_ROOMS.set('CrystalPathRoom', () => new CrystalPathRoom());
SPECIAL_ROOMS.set('CrystalVaultRoom', () => new CrystalVaultRoom());
SPECIAL_ROOMS.set('DemonSpawnerRoom', () => new DemonSpawnerRoom());
SPECIAL_ROOMS.set('GardenRoom', () => new GardenRoom());
SPECIAL_ROOMS.set('LaboratoryRoom', () => new LaboratoryRoom());
SPECIAL_ROOMS.set('LibraryRoom', () => new LibraryRoom());
SPECIAL_ROOMS.set('MagicWellRoom', () => new MagicWellRoom());
SPECIAL_ROOMS.set('MagicalFireRoom', () => new MagicalFireRoom());
SPECIAL_ROOMS.set('PitRoom', () => new PitRoom());
SPECIAL_ROOMS.set('PoolRoom', () => new PoolRoom());
SPECIAL_ROOMS.set('RunestoneRoom', () => new RunestoneRoom());
SPECIAL_ROOMS.set('SacrificeRoom', () => new SacrificeRoom());
SPECIAL_ROOMS.set('SentryRoom', () => new SentryRoom());
SPECIAL_ROOMS.set('ShopRoom', () => new ShopRoom());
SPECIAL_ROOMS.set('ImpShopRoom', () => new ImpShopRoom());
SPECIAL_ROOMS.set('StatueRoom', () => new StatueRoom());
SPECIAL_ROOMS.set('StorageRoom', () => new StorageRoom());
SPECIAL_ROOMS.set('ToxicGasRoom', () => new ToxicGasRoom());
SPECIAL_ROOMS.set('TrapsRoom', () => new TrapsRoom());
SPECIAL_ROOMS.set('TreasuryRoom', () => new TreasuryRoom());
SPECIAL_ROOMS.set('WeakFloorRoom', () => new WeakFloorRoom());
