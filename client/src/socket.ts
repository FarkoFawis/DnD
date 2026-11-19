import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents, Session } from '@dnd/shared';

export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/** Same origin: Vite proxies /socket.io in dev, the server serves the client in prod. */
export const socket: AppSocket = io({
  reconnectionDelayMax: 3000,
});

const SESSION_KEY = 'dnd.session';

export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export function saveSession(session: Session | null): void {
  try {
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    // Private mode etc.: the app still works, it just can't auto-rejoin.
  }
}
