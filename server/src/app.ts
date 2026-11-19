import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createServer, type Server as HttpServer } from 'node:http';
import express from 'express';
import { Server } from 'socket.io';
import {
  LIMITS,
  PASSWORD_MIN_LENGTH,
  normalizeRoomCode,
  applyHpChange,
  sanitizeCharacterPatch,
  sanitizeItem,
  type CharacterData,
  type Item,
  type ClientToServerEvents,
  type PublicUser,
  type ServerToClientEvents,
  type SessionState,
} from '@dnd/shared';
import type { Store } from './store.ts';

interface SocketData {
  user: PublicUser;
  /** Code of the live session this socket is in, if any. */
  code?: string;
  isHost?: boolean;
}

export type IoServer = Server<ClientToServerEvents, ServerToClientEvents, object, SocketData>;

export interface AppOptions {
  store: Store;
  /** Folder with the built client to serve in production. */
  clientDist?: string;
  corsOrigin?: string | string[];
}

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim().replace(/\s+/g, ' ');
  return text.length > 0 && text.length <= max ? text : null;
}

const MAX_FAILED_LOGINS = 5;
const LOCKOUT_MS = 5 * 60 * 1000;

export function createApp({ store, clientDist, corsOrigin }: AppOptions): {
  httpServer: HttpServer;
  io: IoServer;
} {
  const app = express();
  app.use(express.json({ limit: '32kb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  // ---------- accounts ----------

  /** username (lowercase) -> recent failed attempts, to slow down password guessing. */
  const failedLogins = new Map<string, { count: number; until: number }>();

  app.post('/api/auth/status', (req, res) => {
    const username = cleanText(req.body?.username, LIMITS.usernameMaxLength);
    res.json(username ? store.accountStatus(username) : { exists: false, hasPassword: false });
  });

  app.post('/api/auth/login', (req, res) => {
    const username = cleanText(req.body?.username, LIMITS.usernameMaxLength);
    const password = req.body?.password;
    if (!username || typeof password !== 'string') {
      res.status(400).json({ error: 'Enter your username and password.' });
      return;
    }
    const key = username.toLowerCase();
    const failed = failedLogins.get(key);
    if (failed && failed.count >= MAX_FAILED_LOGINS && failed.until > Date.now()) {
      res.status(429).json({ error: 'Too many wrong passwords. Try again in a few minutes.' });
      return;
    }
    const status = store.accountStatus(username);
    if (status.exists && !status.hasPassword && (password.length < PASSWORD_MIN_LENGTH || password.length > 200)) {
      res.status(400).json({ error: `Choose a password with at least ${PASSWORD_MIN_LENGTH} characters.` });
      return;
    }
    const result = store.login(username, password);
    if (!result) {
      const count = (failed && failed.until > Date.now() ? failed.count : 0) + 1;
      failedLogins.set(key, { count, until: Date.now() + LOCKOUT_MS });
      res.status(401).json({ error: 'Wrong username or password.' });
      return;
    }
    failedLogins.delete(key);
    res.json(result);
  });

  const bearer = (header: string | undefined) => header?.match(/^Bearer (.+)$/)?.[1];

  app.get('/api/auth/me', (req, res) => {
    const token = bearer(req.headers.authorization);
    const user = token ? store.userForToken(token) : undefined;
    if (!user) {
      res.status(401).json({ error: 'Not logged in.' });
      return;
    }
    res.json({ user });
  });

  app.post('/api/auth/logout', (req, res) => {
    const token = bearer(req.headers.authorization);
    if (token) store.logout(token);
    res.json({ ok: true });
  });

  if (clientDist && existsSync(clientDist)) {
    app.use(express.static(clientDist));
    // Single-page app: unknown paths get index.html.
    app.get(/^\/(?!api\/|socket\.io\/).*/, (_req, res) => {
      res.sendFile('index.html', { root: clientDist });
    });
  }

  // ---------- realtime ----------

  const httpServer = createServer(app);
  const io: IoServer = new Server(httpServer, {
    cors: corsOrigin ? { origin: corsOrigin } : undefined,
  });
  // Phones lock their screens and drop sockets often. Clients handle that by
  // re-sending 'session:join' with their saved code on every (re)connect.

  io.use((socket, next) => {
    const token = (socket.handshake.auth as { token?: unknown })?.token;
    const user = typeof token === 'string' ? store.userForToken(token) : undefined;
    if (!user) return next(new Error('unauthorized'));
    socket.data.user = user;
    next();
  });

  /** "code:userId" -> number of that user's sockets in that session. */
  const presence = new Map<string, number>();
  const isOnline = (code: string, userId: string) => (presence.get(`${code}:${userId}`) ?? 0) > 0;
  const roomOf = (code: string) => `session:${code}`;

  const sessionState = (code: string): SessionState | undefined => {
    const live = store.getSession(code);
    const campaign = live && store.getCampaign(live.campaignId);
    const host = campaign && store.getUser(campaign.ownerId);
    if (!live || !campaign || !host) return undefined;
    return {
      code,
      campaign: { id: campaign.id, name: campaign.name },
      host: { ...host, online: isOnline(code, host.id) },
      players: store.sessionPlayers(code).map((user) => ({
        user,
        online: isOnline(code, user.id),
        character: store.getOrCreateCharacter(campaign.id, user),
      })),
    };
  };

  const broadcast = (code: string) => {
    const state = sessionState(code);
    if (state) io.to(roomOf(code)).emit('session:state', state);
  };

  io.on('connection', (socket) => {
    const user = socket.data.user;

    const leaveCurrent = () => {
      const code = socket.data.code;
      if (!code) return;
      socket.data.code = undefined;
      socket.data.isHost = undefined;
      const key = `${code}:${user.id}`;
      const n = (presence.get(key) ?? 1) - 1;
      if (n > 0) presence.set(key, n);
      else presence.delete(key);
      void socket.leave(roomOf(code));
      broadcast(code);
    };

    const enter = (code: string, isHost: boolean): SessionState => {
      if (socket.data.code !== code) {
        leaveCurrent();
        socket.data.code = code;
        const key = `${code}:${user.id}`;
        presence.set(key, (presence.get(key) ?? 0) + 1);
        void socket.join(roomOf(code));
      }
      socket.data.isHost = isHost;
      broadcast(code);
      return sessionState(code)!;
    };

    socket.on('campaign:list', (ack) => {
      ack({ ok: true, campaigns: store.listCampaigns(user.id) });
    });

    socket.on('campaign:create', (input, ack) => {
      const name = cleanText(input?.name, LIMITS.campaignNameMaxLength);
      if (!name) return ack({ ok: false, error: 'Give the campaign a name.' });
      const c = store.createCampaign(user.id, name);
      ack({ ok: true, campaign: { id: c.id, name: c.name, liveCode: null, lastPlayedAt: null } });
    });

    socket.on('session:host', (input, ack) => {
      const campaign = typeof input?.campaignId === 'string' ? store.getCampaign(input.campaignId) : undefined;
      if (!campaign || campaign.ownerId !== user.id) {
        return ack({ ok: false, error: 'You can only host your own campaigns.' });
      }
      const live = store.startSession(campaign.id);
      ack({ ok: true, session: enter(live.code, true) });
    });

    socket.on('session:join', (input, ack) => {
      const code = normalizeRoomCode(String(input?.code ?? ''));
      if (!code) return ack({ ok: false, error: 'That code does not look right.' });
      const live = store.getSession(code);
      const campaign = live && store.getCampaign(live.campaignId);
      if (!live || !campaign) return ack({ ok: false, error: 'No session is running with that code.' });
      const isHost = campaign.ownerId === user.id;
      if (!isHost) {
        store.addSessionPlayer(code, user.id);
        store.getOrCreateCharacter(campaign.id, user);
      }
      ack({ ok: true, session: enter(code, isHost) });
    });

    socket.on('session:leave', (ack) => {
      const code = socket.data.code;
      if (!code) return ack({ ok: false, error: 'You are not in a session.' });
      if (socket.data.isHost) return ack({ ok: false, error: 'As the DM, end the session instead.' });
      store.removeSessionPlayer(code, user.id);
      // Take every tab of this user out of the session.
      for (const s of io.sockets.sockets.values()) {
        if (s.id !== socket.id && s.data.user?.id === user.id && s.data.code === code) {
          s.data.code = undefined;
          void s.leave(roomOf(code));
          s.emit('session:ended');
        }
      }
      presence.delete(`${code}:${user.id}`);
      socket.data.code = undefined;
      void socket.leave(roomOf(code));
      broadcast(code);
      ack({ ok: true });
    });

    socket.on('session:end', (ack) => {
      const code = socket.data.code;
      if (!code || !socket.data.isHost) return ack({ ok: false, error: 'Only the DM can end the session.' });
      store.endSession(code);
      io.to(roomOf(code)).except(socket.id).emit('session:ended');
      for (const s of io.sockets.sockets.values()) {
        if (s.data.code === code) {
          s.data.code = undefined;
          s.data.isHost = undefined;
        }
      }
      io.socketsLeave(roomOf(code));
      for (const key of presence.keys()) if (key.startsWith(`${code}:`)) presence.delete(key);
      ack({ ok: true });
    });

    /** Whose character this socket may edit: own as a player, anyone in the session as DM. */
    const editTarget = (
      userId: unknown,
    ): { ok: true; code: string; campaignId: string; target: PublicUser } | { ok: false; error: string } => {
      const code = socket.data.code;
      const live = code ? store.getSession(code) : undefined;
      if (!code || !live) return { ok: false, error: 'Join a session first.' };
      if (socket.data.isHost) {
        const target = store.sessionPlayers(code).find((p) => p.id === userId);
        if (!target) return { ok: false, error: 'That player is not in this session.' };
        return { ok: true, code, campaignId: live.campaignId, target };
      }
      if (userId !== undefined && userId !== user.id) {
        return { ok: false, error: 'You can only edit your own character.' };
      }
      return { ok: true, code, campaignId: live.campaignId, target: user };
    };

    socket.on('character:update', (input, ack) => {
      const t = editTarget(input?.userId);
      if (!t.ok) return ack(t);
      let patch;
      try {
        patch = sanitizeCharacterPatch(input?.patch);
      } catch (e) {
        return ack({ ok: false, error: (e as Error).message });
      }
      const character = store.updateCharacter(t.campaignId, t.target, patch);
      ack({ ok: true, character });
      broadcast(t.code);
    });

    socket.on('character:adjustHp', (input, ack) => {
      const t = editTarget(input?.userId);
      if (!t.ok) return ack(t);
      const delta = input?.delta;
      if (typeof delta !== 'number' || !Number.isInteger(delta) || Math.abs(delta) > 9999) {
        return ack({ ok: false, error: 'Invalid amount.' });
      }
      // Read-modify-write is safe: node:sqlite is synchronous, so no other event runs in between.
      const current = store.getOrCreateCharacter(t.campaignId, t.target);
      const character = store.updateCharacter(t.campaignId, t.target, applyHpChange(current, delta));
      ack({ ok: true, character });
      broadcast(t.code);
    });

    /** Applies a change to someone's inventory (own, or any player's as DM). */
    const changeInventory = (
      userId: unknown,
      ack: (res: { ok: true; character: CharacterData } | { ok: false; error: string }) => void,
      change: (items: Item[]) => Item[],
    ) => {
      const t = editTarget(userId);
      if (!t.ok) return ack(t);
      try {
        const current = store.getOrCreateCharacter(t.campaignId, t.target);
        const inventory = sanitizeCharacterPatch({ inventory: change(current.inventory) }, { allowInventory: true })
          .inventory!;
        const character = store.updateCharacter(t.campaignId, t.target, { inventory });
        ack({ ok: true, character });
        broadcast(t.code);
      } catch (e) {
        ack({ ok: false, error: (e as Error).message });
      }
    };

    socket.on('item:add', (input, ack) => {
      changeInventory(input?.userId, ack, (items) => [
        ...items,
        sanitizeItem({ ...(typeof input?.item === 'object' ? input.item : {}), id: randomUUID() }),
      ]);
    });

    socket.on('item:update', (input, ack) => {
      changeInventory(input?.userId, ack, (items) => {
        const i = items.findIndex((x) => x.id === input?.itemId);
        if (i < 0) throw new Error('That item is gone.');
        const next = sanitizeItem({ ...items[i], ...(typeof input?.patch === 'object' ? input.patch : {}), id: items[i]!.id });
        return next.qty === 0 ? items.filter((_, j) => j !== i) : items.map((x, j) => (j === i ? next : x));
      });
    });

    socket.on('item:remove', (input, ack) => {
      changeInventory(input?.userId, ack, (items) => items.filter((x) => x.id !== input?.itemId));
    });

    socket.on('disconnect', leaveCurrent);
  });

  return { httpServer, io };
}
