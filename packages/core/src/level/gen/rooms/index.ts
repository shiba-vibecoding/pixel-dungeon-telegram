import { T } from '../../terrain';
import type { GenLevel } from '../genlevel';
import { Painter } from '../painter';
import { DoorType } from '../room';
import { SECRET_ROOMS, SecretRoom } from './secret/secret';
import { SPECIAL_ROOMS, SpecialRoom } from './special/special';
import { EmptyRoom, EntranceRoom, ExitRoom } from './standard/basic';
import { STANDARD_ROOMS } from './standard/registry';

/*
 * Every room kind, registered by its Shattered class name for the decks and chance tables
 * (StandardRoom.rooms, SpecialRoom's and SecretRoom's lists). Importing this module registers them.
 */

STANDARD_ROOMS.set('EmptyRoom', () => new EmptyRoom());
STANDARD_ROOMS.set('EntranceRoom', () => new EntranceRoom());
STANDARD_ROOMS.set('ExitRoom', () => new ExitRoom());

/** Stand-ins while a kind has no room of its own yet: a plain room behind a door. */
class EmptySpecialRoom extends SpecialRoom {
  readonly kind = 'EmptySpecialRoom';
  paint(level: GenLevel): void {
    Painter.fill(level, this, T.WALL);
    Painter.fill(level, this, 1, T.EMPTY);
    this.entrance().set(DoorType.REGULAR);
  }
}
class EmptySecretRoom extends SecretRoom {
  readonly kind = 'EmptySecretRoom';
  paint(level: GenLevel): void {
    Painter.fill(level, this, T.WALL);
    Painter.fill(level, this, 1, T.EMPTY);
    this.entrance().set(DoorType.HIDDEN);
  }
}
SPECIAL_ROOMS.set('EmptySpecialRoom', () => new EmptySpecialRoom());
SECRET_ROOMS.set('EmptySecretRoom', () => new EmptySecretRoom());

import './standard/register';
import './special/register';
import './secret/register';
import './quest/register';
