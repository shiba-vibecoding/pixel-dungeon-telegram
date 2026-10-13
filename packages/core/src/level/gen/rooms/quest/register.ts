/* The quest rooms register themselves here (rooms/index.ts imports this module). */

import { SPECIAL_ROOMS } from '../special/special';
import { STANDARD_ROOMS } from '../standard/registry';
import { MassGraveRoom, RitualSiteRoom, RotGardenRoom } from './wandmaker-rooms';

// The old wandmaker's (Wandmaker.Quest.spawnRoom adds them itself; never dealt from a deck).
SPECIAL_ROOMS.set('MassGraveRoom', () => new MassGraveRoom());
SPECIAL_ROOMS.set('RotGardenRoom', () => new RotGardenRoom());
STANDARD_ROOMS.set('RitualSiteRoom', () => new RitualSiteRoom());

// The ambitious imp's dwarven vault (VaultLevel, BRANCH_LEVELS 17-19): its rooms are dealt by the vault level itself.
import './vault-rooms';
import './vault-treasure';
import './vault-final';

export {};
