import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createServer, type Server as HttpServer } from 'node:http';
import express from 'express';
import { Server } from 'socket.io';
import {
  DM_LOCKED_FIELDS,
  DM_ONLY_FIELDS,
  LIMITS,
  PASSWORD_MIN_LENGTH,
  normalizeRoomCode,
  applyHpChange,
  sanitizeCharacterPatch,
  sanitizeItem,
  type CharacterData,
  type CharacterSummary,
  type Item,
  type ClientToServerEvents,
  type PublicUser,
  type ServerToClientEvents,
  type SessionState,
} from '@dnd/shared';
import { loadContentPacks } from './content.ts';
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
  /** Folder with extra content packs (homebrew / private book data). */
  contentDir?: string;
}

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim().replace(/\s+/g, ' ');
  return text.length > 0 && text.length <= max ? text : null;
}

const MAX_FAILED_LOGINS = 5;
const LOCKOUT_MS = 5 * 60 * 1000;

export function createApp({ store, clientDist, corsOrigin, contentDir }: AppOptions): {
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

  // Extra content packs, on top of the SRD the client already has. Logged-in
  // users only: a pack can hold text from the group's own books.
  app.get('/api/content', (req, res) => {
    const token = bearer(req.headers.authorization);
    if (!token || !store.userForToken(token)) {
      res.status(401).json({ error: 'Not logged in.' });
      return;
    }
    res.json({ packs: contentDir ? loadContentPacks(contentDir).packs : [] });
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
      started: live.started,
      players: store.sessionPlayers(code).flatMap((p) => {
        const ch = store.getCharacter(p.characterId);
        return ch
          ? [{ user: p.user, characterId: p.characterId, ready: p.ready, online: isOnline(code, p.user.id), character: ch.data }]
          : [];
      }),
    };
  };

  const broadcast = (code: string) => {
    const state = sessionState(code);
    if (state) io.to(roomOf(code)).emit('session:state', state);
  };

  /** Ends a session socket-side: tells everyone, takes all sockets out of the room. */
  const closeSession = (code: string, exceptSocketId?: string) => {
    const room = io.to(roomOf(code));
    (exceptSocketId ? room.except(exceptSocketId) : room).emit('session:ended');
    for (const s of io.sockets.sockets.values()) {
      if (s.data.code === code) {
        s.data.code = undefined;
        s.data.isHost = undefined;
      }
    }
    io.socketsLeave(roomOf(code));
    for (const key of presence.keys()) if (key.startsWith(`${code}:`)) presence.delete(key);
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

    // ---------- characters ----------

    /**
     * Who may change what on a character:
     * - the DM of the session it is in: everything;
     * - its owner, outside sessions: everything except HP, items and coins;
     * - its owner, in a session: nothing (players only read their sheet);
     * - HP, items and coins: the owner only while the DM has unlocked them
     *   (hpItemsUnlocked), in or out of a session. Only the DM sets the unlock.
     */
    const editable = (characterId: unknown, fields: readonly string[] = []) => {
      const ch = typeof characterId === 'string' ? store.getCharacter(characterId) : undefined;
      if (!ch) return { ok: false as const, error: 'That character no longer exists.' };
      const isDm = !!ch.inSession && socket.data.isHost === true && socket.data.code === ch.inSession;
      if (isDm) return { ok: true as const, ch, isDm };
      if (ch.userId !== user.id) return { ok: false as const, error: 'You can only change your own characters.' };
      if (fields.some((f) => (DM_ONLY_FIELDS as readonly string[]).includes(f))) {
        return { ok: false as const, error: 'Only the DM can change that.' };
      }
      const locked = fields.filter((f) => (DM_LOCKED_FIELDS as readonly string[]).includes(f));
      if (locked.length > 0 && !ch.data.hpItemsUnlocked) {
        return { ok: false as const, error: 'Your DM manages your HP and items. Ask them to unlock it for you.' };
      }
      if (ch.inSession && fields.some((f) => !(DM_LOCKED_FIELDS as readonly string[]).includes(f))) {
        return { ok: false as const, error: 'Your character is in a session. Only the DM can change it now.' };
      }
      return { ok: true as const, ch, isDm };
    };

    const afterChange = (character: CharacterSummary) => {
      if (character.inSession) broadcast(character.inSession);
    };

    socket.on('character:list', (ack) => {
      ack({ ok: true, characters: store.listCharacters(user.id) });
    });

    socket.on('character:create', (input, ack) => {
      const name = cleanText(input?.name, LIMITS.textFieldMaxLength);
      if (!name) return ack({ ok: false, error: 'Give your character a name.' });
      if (store.countCharacters(user.id) >= LIMITS.charactersPerUser) {
        return ack({ ok: false, error: 'You have too many characters. Delete one first.' });
      }
      let data: Partial<CharacterData> = {};
      try {
        if (input?.data !== undefined) data = sanitizeCharacterPatch(input.data, { allowInventory: true });
      } catch (e) {
        return ack({ ok: false, error: (e as Error).message });
      }
      ack({ ok: true, character: store.createCharacter(user.id, name, data) });
    });

    socket.on('character:delete', (input, ack) => {
      const t = editable(input?.characterId, ['delete']);
      if (!t.ok) return ack(t);
      if (t.ch.userId !== user.id) return ack({ ok: false, error: 'You can only delete your own characters.' });
      store.deleteCharacter(t.ch.id);
      ack({ ok: true });
    });

    socket.on('character:update', (input, ack) => {
      let patch;
      try {
        patch = sanitizeCharacterPatch(input?.patch);
      } catch (e) {
        return ack({ ok: false, error: (e as Error).message });
      }
      const t = editable(input?.characterId, Object.keys(patch));
      if (!t.ok) return ack(t);
      const character = store.updateCharacter(t.ch.id, patch);
      ack({ ok: true, character });
      afterChange(character);
    });

    socket.on('character:adjustHp', (input, ack) => {
      const t = editable(input?.characterId, ['hpCurrent']);
      if (!t.ok) return ack(t);
      const delta = input?.delta;
      if (typeof delta !== 'number' || !Number.isInteger(delta) || Math.abs(delta) > 9999) {
        return ack({ ok: false, error: 'Invalid amount.' });
      }
      // Read-modify-write is safe: node:sqlite is synchronous, so no other event runs in between.
      const character = store.updateCharacter(t.ch.id, applyHpChange(t.ch.data, delta));
      ack({ ok: true, character });
      afterChange(character);
    });

    const changeInventory = (
      characterId: unknown,
      ack: (res: { ok: true; character: CharacterSummary } | { ok: false; error: string }) => void,
      change: (items: Item[]) => Item[],
    ) => {
      const t = editable(characterId, ['inventory']);
      if (!t.ok) return ack(t);
      try {
        const inventory = sanitizeCharacterPatch({ inventory: change(t.ch.data.inventory) }, { allowInventory: true })
          .inventory!;
        const character = store.updateCharacter(t.ch.id, { inventory });
        ack({ ok: true, character });
        afterChange(character);
      } catch (e) {
        ack({ ok: false, error: (e as Error).message });
      }
    };

    socket.on('item:add', (input, ack) => {
      changeInventory(input?.characterId, ack, (items) => [
        ...items,
        sanitizeItem({ ...(typeof input?.item === 'object' ? input.item : {}), id: randomUUID() }),
      ]);
    });

    socket.on('item:update', (input, ack) => {
      changeInventory(input?.characterId, ack, (items) => {
        const i = items.findIndex((x) => x.id === input?.itemId);
        if (i < 0) throw new Error('That item is gone.');
        const next = sanitizeItem({ ...items[i], ...(typeof input?.patch === 'object' ? input.patch : {}), id: items[i]!.id });
        return next.qty === 0 ? items.filter((_, j) => j !== i) : items.map((x, j) => (j === i ? next : x));
      });
    });

    socket.on('item:remove', (input, ack) => {
      changeInventory(input?.characterId, ack, (items) => items.filter((x) => x.id !== input?.itemId));
    });

    // ---------- campaigns & sessions ----------

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

    const findLive = (rawCode: unknown) => {
      const code = normalizeRoomCode(String(rawCode ?? ''));
      if (!code) return { ok: false as const, error: 'That code does not look right.' };
      const live = store.getSession(code);
      const campaign = live && store.getCampaign(live.campaignId);
      if (!live || !campaign) return { ok: false as const, error: 'No session is running with that code.' };
      const isHost = campaign.ownerId === user.id;
      const isPlayer = store.sessionPlayers(code).some((p) => p.user.id === user.id);
      return { ok: true as const, code, live, campaign, isHost, isPlayer };
    };

    socket.on('session:peek', (input, ack) => {
      const f = findLive(input?.code);
      if (!f.ok) return ack(f);
      ack({
        ok: true,
        campaign: { id: f.campaign.id, name: f.campaign.name },
        rejoin: f.isHost || f.isPlayer,
        characters: store.listCharacters(user.id).filter((c) => store.canJoinCampaign(c, f.campaign.id)),
      });
    });

    socket.on('session:join', (input, ack) => {
      const f = findLive(input?.code);
      if (!f.ok) return ack(f);
      if (f.isHost) return ack({ ok: true, session: enter(f.code, true) });
      if (!f.isPlayer) {
        const ch = typeof input?.characterId === 'string' ? store.getCharacter(input.characterId) : undefined;
        if (!ch || ch.userId !== user.id) return ack({ ok: false, error: 'Choose one of your characters.' });
        if (!store.canJoinCampaign(ch, f.campaign.id)) {
          return ack({ ok: false, error: 'That character is already in another session.' });
        }
        if (store.listCharacters(user.id).some((c) => c.inSession)) {
          return ack({ ok: false, error: 'You are already in another session. Leave it first.' });
        }
        store.addSessionPlayer(f.code, user.id, ch.id, f.campaign.id);
      }
      ack({ ok: true, session: enter(f.code, false) });
    });

    socket.on('session:ready', (input, ack) => {
      const code = socket.data.code;
      if (!code || socket.data.isHost) return ack({ ok: false, error: 'Join a session as a player first.' });
      store.setReady(code, user.id, input?.ready === true);
      ack({ ok: true });
      broadcast(code);
    });

    socket.on('session:start', (ack) => {
      const code = socket.data.code;
      if (!code || !socket.data.isHost) return ack({ ok: false, error: 'Only the DM can start the session.' });
      store.markStarted(code);
      ack({ ok: true });
      broadcast(code);
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
      closeSession(code, socket.id);
      ack({ ok: true });
    });

    socket.on('disconnect', leaveCurrent);
  });

  return { httpServer, io };
}
