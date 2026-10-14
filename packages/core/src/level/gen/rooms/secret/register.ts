/* The secret rooms register themselves here (rooms/index.ts imports this module). */

import { SecretArtilleryRoom } from './artillery';
import { SecretChestChasmRoom } from './chest-chasm';
import { SecretGardenRoom } from './garden';
import { SecretHoardRoom } from './hoard';
import { SecretHoneypotRoom } from './honeypot';
import { SecretLaboratoryRoom } from './laboratory';
import { SecretLarderRoom } from './larder';
import { SecretLibraryRoom } from './library';
import { SecretMazeRoom } from './maze';
import { RatKingRoom } from './rat-king';
import { SecretRunestoneRoom } from './runestone';
import { SECRET_ROOMS } from './secret';
import { SecretSummoningRoom } from './summoning';
import { SecretWellRoom } from './well';

SECRET_ROOMS.set('SecretGardenRoom', () => new SecretGardenRoom());
SECRET_ROOMS.set('SecretLaboratoryRoom', () => new SecretLaboratoryRoom());
SECRET_ROOMS.set('SecretLibraryRoom', () => new SecretLibraryRoom());
SECRET_ROOMS.set('SecretLarderRoom', () => new SecretLarderRoom());
SECRET_ROOMS.set('SecretWellRoom', () => new SecretWellRoom());
SECRET_ROOMS.set('SecretRunestoneRoom', () => new SecretRunestoneRoom());
SECRET_ROOMS.set('SecretArtilleryRoom', () => new SecretArtilleryRoom());
SECRET_ROOMS.set('SecretChestChasmRoom', () => new SecretChestChasmRoom());
SECRET_ROOMS.set('SecretHoneypotRoom', () => new SecretHoneypotRoom());
SECRET_ROOMS.set('SecretHoardRoom', () => new SecretHoardRoom());
SECRET_ROOMS.set('SecretMazeRoom', () => new SecretMazeRoom());
SECRET_ROOMS.set('SecretSummoningRoom', () => new SecretSummoningRoom());
// The Rat King's room: never dealt from the deck; the sewers' boss level makes it.
SECRET_ROOMS.set('RatKingRoom', () => new RatKingRoom());
