import { ALL, Room } from '../../room';

/* levels/rooms/connection/ConnectionRoom: tunnels and bridges between the rooms that matter. */

export abstract class ConnectionRoom extends Room {
  readonly group = 'connection' as const;

  override minWidth(): number {
    return 3;
  }
  override maxWidth(): number {
    return 10;
  }
  override minHeight(): number {
    return 3;
  }
  override maxHeight(): number {
    return 10;
  }

  override minConnections(direction: number): number {
    return direction === ALL ? 2 : 0;
  }
}
