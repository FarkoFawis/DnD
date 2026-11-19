import { existsSync } from 'node:fs';
import { createServer, type Server as HttpServer } from 'node:http';
import express from 'express';
import { Server } from 'socket.io';
import {
  LIMITS,
  normalizeRoomCode,
  type ClientToServerEvents,
  type JoinedPayload,
  type RoomState,
  type ServerToClientEvents,
} from '@dnd/shared';
import type { Store, StoredMember } from './store.ts';

interface SocketData {
  member?: StoredMember;
}

export type IoServer = Server<ClientToServerEvents, ServerToClientEvents, object, SocketData>;

export interface AppOptions {
  store: Store;
  /** Folder with the built client to serve in production. */
  clientDist?: string;
  corsOrigin?: string | string[];
}

function cleanName(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const name = value.trim().replace(/\s+/g, ' ');
  return name.length > 0 && name.length <= max ? name : null;
}

export function createApp({ store, clientDist, corsOrigin }: AppOptions): {
  httpServer: HttpServer;
  io: IoServer;
} {
  const app = express();
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });
  if (clientDist && existsSync(clientDist)) {
    app.use(express.static(clientDist));
    // Single-page app: unknown paths get index.html.
    app.get(/^\/(?!api\/|socket\.io\/).*/, (_req, res) => {
      res.sendFile('index.html', { root: clientDist });
    });
  }

  const httpServer = createServer(app);
  const io: IoServer = new Server(httpServer, {
    cors: corsOrigin ? { origin: corsOrigin } : undefined,
  });
  // Phones lock their screens and drop sockets often. Clients handle that by
  // sending 'room:resume' with their saved token on every (re)connect.

  /** memberId -> number of open sockets (a member may have several tabs). */
  const onlineCount = new Map<string, number>();

  const roomState = (code: string): RoomState => {
    const room = store.getRoom(code);
    return {
      code,
      name: room?.name ?? '',
      members: store.listMembers(code).map((m) => ({
        id: m.id,
        name: m.name,
        role: m.role,
        online: (onlineCount.get(m.id) ?? 0) > 0,
      })),
    };
  };

  const broadcast = (code: string) => io.to(code).emit('room:state', roomState(code));

  io.on('connection', (socket) => {
    const enter = (member: StoredMember, token: string): JoinedPayload => {
      if (socket.data.member) leaveCurrent();
      socket.data.member = member;
      onlineCount.set(member.id, (onlineCount.get(member.id) ?? 0) + 1);
      void socket.join(member.roomCode);
      return {
        session: { code: member.roomCode, memberId: member.id, token },
        room: roomState(member.roomCode),
      };
    };

    const leaveCurrent = () => {
      const member = socket.data.member;
      if (!member) return;
      socket.data.member = undefined;
      const n = (onlineCount.get(member.id) ?? 1) - 1;
      if (n > 0) onlineCount.set(member.id, n);
      else onlineCount.delete(member.id);
      void socket.leave(member.roomCode);
      broadcast(member.roomCode);
    };

    socket.on('room:create', (input, ack) => {
      const roomName = cleanName(input?.roomName, LIMITS.roomNameMaxLength);
      const dmName = cleanName(input?.dmName, LIMITS.nameMaxLength);
      if (!roomName || !dmName) return ack({ ok: false, error: 'Please enter a room name and your name.' });
      const room = store.createRoom(roomName);
      const { member, token } = store.addMember(room.code, dmName, 'dm');
      const payload = enter(member, token);
      ack({ ok: true, ...payload });
      broadcast(room.code);
    });

    socket.on('room:join', (input, ack) => {
      const code = normalizeRoomCode(String(input?.code ?? ''));
      const playerName = cleanName(input?.playerName, LIMITS.nameMaxLength);
      if (!code) return ack({ ok: false, error: 'That room code does not look right.' });
      if (!playerName) return ack({ ok: false, error: 'Please enter your name.' });
      if (!store.getRoom(code)) return ack({ ok: false, error: 'No room with that code.' });
      if (store.isNameTaken(code, playerName)) {
        return ack({ ok: false, error: 'Someone in this room already uses that name.' });
      }
      const { member, token } = store.addMember(code, playerName, 'player');
      const payload = enter(member, token);
      ack({ ok: true, ...payload });
      broadcast(code);
    });

    socket.on('room:resume', (input, ack) => {
      const code = normalizeRoomCode(String(input?.code ?? ''));
      const member =
        code && typeof input?.memberId === 'string' && typeof input?.token === 'string'
          ? store.authenticate(code, input.memberId, input.token)
          : undefined;
      if (!member) return ack({ ok: false, error: 'Your saved session is no longer valid.' });
      const payload = enter(member, input.token);
      ack({ ok: true, ...payload });
      broadcast(member.roomCode);
    });

    socket.on('room:leave', (ack) => {
      const member = socket.data.member;
      if (!member) return ack({ ok: false, error: 'You are not in a room.' });
      if (member.role === 'dm') {
        return ack({ ok: false, error: 'The DM cannot leave the room (closing rooms comes later).' });
      }
      store.removeMember(member.id);
      leaveCurrent();
      ack({ ok: true });
    });

    socket.on('disconnect', leaveCurrent);
  });

  return { httpServer, io };
}
