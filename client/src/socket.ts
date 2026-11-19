import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@dnd/shared';

export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/** Same origin: Vite proxies /socket.io in dev, the server serves the client in prod. */
export function createSocket(token: string): AppSocket {
  return io({ auth: { token }, reconnectionDelayMax: 3000 });
}
