import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, unlink, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { createServer, type Server as HttpServer } from 'node:http';
import express from 'express';
import { Server } from 'socket.io';
import {
  DM_LOCKED_FIELDS,
  DM_ONLY_FIELDS,
  COINS,
  LIMITS,
  PASSWORD_MIN_LENGTH,
  normalizeRoomCode,
  applyHpChange,
  addCombatants,
  applyCombatAction,
  deriveStats,
  newCombat,
  npcInitiative,
  publicCombat,
  sanitizeHandout,
  sanitizeNpc,
  IMAGE_URL_PATTERN,
  PREP_LIMITS,
  type Combatant,
  type Handout,
  type LogEvent,
  type Npc,
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
  /** Folder for pictures the DM uploads for handouts. Without it, uploads are switched off. */
  uploadsDir?: string;
}

const IMAGE_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim().replace(/\s+/g, ' ');
  return text.length > 0 && text.length <= max ? text : null;
}

const MAX_FAILED_LOGINS = 5;
const LOCKOUT_MS = 5 * 60 * 1000;

export function createApp({ store, clientDist, corsOrigin, contentDir, uploadsDir }: AppOptions): {
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

  // ---------- handout pictures ----------

  // The DM's phone shrinks pictures before sending them (see client/src/prep/image.ts).
  app.post(
    '/api/campaigns/:id/images',
    express.raw({ type: Object.keys(IMAGE_TYPES), limit: PREP_LIMITS.imageMaxBytes }),
    (req, res) => {
      const token = bearer(req.headers.authorization);
      const user = token ? store.userForToken(token) : undefined;
      const campaign = store.getCampaign(String(req.params.id));
      if (!user || !campaign || campaign.ownerId !== user.id) {
        res.status(403).json({ error: 'Only the DM of this campaign can add pictures.' });
        return;
      }
      const ext = IMAGE_TYPES[String(req.headers['content-type']).split(';')[0]!.trim()];
      if (!uploadsDir || !ext || !Buffer.isBuffer(req.body) || req.body.length === 0) {
        res.status(400).json({ error: 'Choose a JPG, PNG, WebP or GIF picture.' });
        return;
      }
      mkdirSync(uploadsDir, { recursive: true });
      const name = `${randomUUID()}.${ext}`;
      writeFileSync(join(uploadsDir, name), req.body);
      res.json({ url: `/api/images/${name}` });
    },
  );
  // No login needed to view: <img> can't send the token, and the names are random and unguessable.
  if (uploadsDir) {
    app.use('/api/images', express.static(uploadsDir, { maxAge: '365d', immutable: true, index: false, dotfiles: 'deny' }));
  }
  app.use('/api/images', (_req, res) => {
    res.status(404).end();
  });
  const removeImage = (url: string | null | undefined) => {
    if (uploadsDir && url && IMAGE_URL_PATTERN.test(url)) unlink(join(uploadsDir, basename(url)), () => undefined);
  };

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
      handout: (() => {
        const h = live.shown && store.getPrep<Handout>(campaign.id, 'handout', live.shown.handoutId);
        return h && live.shown ? { ...h, shownAt: live.shown.shownAt } : null;
      })(),
      combat: live.combat,
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
    if (!state) return;
    if (!state.combat) {
      io.to(roomOf(code)).emit('session:state', state);
      return;
    }
    // Only the DM sees the opponents' HP and AC.
    const forPlayers = { ...state, combat: publicCombat(state.combat) };
    for (const s of io.sockets.sockets.values()) {
      if (s.data.code === code) s.emit('session:state', s.data.isHost ? state : forPlayers);
    }
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
      const state = sessionState(code)!;
      return isHost || !state.combat ? state : { ...state, combat: publicCombat(state.combat) };
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

    /** Session log: only while the character's session is running. */
    const logFor = (character: CharacterSummary, ...events: (Omit<LogEvent, 'who'> | false | undefined)[]) => {
      const live = character.inSession ? store.getSession(character.inSession) : undefined;
      if (!live?.started || !live.sessionNo) return;
      for (const e of events) if (e) store.addLog(live.campaignId, live.sessionNo, { ...e, who: character.data.name });
    };
    /** Log entries for a change of hit points, coins or level. */
    const logChanges = (before: CharacterData, character: CharacterSummary) => {
      const after = character.data;
      const hp = after.hpCurrent - before.hpCurrent;
      const temp = after.hpTemp - before.hpTemp;
      const lost = -Math.min(hp, 0) - Math.min(temp, 0);
      const coins = (sign: 1 | -1) =>
        COINS.flatMap((c) => {
          const d = (after.coins[c] - before.coins[c]) * sign;
          return d > 0 ? [`${d} ${c}`] : [];
        }).reverse().join(', ');
      logFor(
        character,
        lost > 0 && { kind: 'damage', amount: lost, what: `${after.hpCurrent}/${after.hpMax} HP` },
        hp > 0 && { kind: 'heal', amount: hp, what: `${after.hpCurrent}/${after.hpMax} HP` },
        hp < 0 && after.hpCurrent === 0 && { kind: 'down' },
        coins(1) !== '' && { kind: 'loot', what: coins(1) },
        coins(-1) !== '' && { kind: 'lost', what: coins(-1) },
        after.level > before.level && { kind: 'level', amount: after.level },
      );
    };
    const itemLabel = (name: string, qty: number) => (qty === 1 ? name : `${qty}× ${name}`);
    const logInventory = (before: Item[], character: CharacterSummary) => {
      const after = character.data.inventory;
      const ids = new Set([...before, ...after].map((i) => i.id));
      for (const id of ids) {
        const a = before.find((i) => i.id === id);
        const b = after.find((i) => i.id === id);
        const d = (b?.qty ?? 0) - (a?.qty ?? 0);
        if (d !== 0) logFor(character, { kind: d > 0 ? 'loot' : 'lost', what: itemLabel((b ?? a)!.name, Math.abs(d)) });
      }
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
      logChanges(t.ch.data, character);
      if (patch.inventory) logInventory(t.ch.data.inventory, character);
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
      logChanges(t.ch.data, character);
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
        logInventory(t.ch.data.inventory, character);
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

    // ---------- campaign prep ----------

    const ownCampaign = (campaignId: unknown) => {
      const campaign = typeof campaignId === 'string' ? store.getCampaign(campaignId) : undefined;
      return campaign && campaign.ownerId === user.id ? campaign : undefined;
    };
    const NOT_DM = { ok: false as const, error: 'Only the DM of this campaign can do that.' };
    /** Everyone at the table sees prep changes that are on screen (the shown handout). */
    const afterPrepChange = (campaignId: string) => {
      const live = store.getSessionByCampaign(campaignId);
      if (live) broadcast(live.code);
    };

    socket.on('prep:get', (input, ack) => {
      const campaign = ownCampaign(input?.campaignId);
      if (!campaign) return ack(NOT_DM);
      ack({
        ok: true,
        prep: { handouts: store.listPrep<Handout>(campaign.id, 'handout'), npcs: store.listPrep<Npc>(campaign.id, 'npc') },
      });
    });

    socket.on('handout:save', (input, ack) => {
      const campaign = ownCampaign(input?.campaignId);
      if (!campaign) return ack(NOT_DM);
      try {
        const data = sanitizeHandout(input?.handout);
        const id = typeof input.handout.id === 'string' ? input.handout.id : undefined;
        const before = id ? store.getPrep<Handout>(campaign.id, 'handout', id) : undefined;
        if (!before && store.countPrep(campaign.id, 'handout') >= PREP_LIMITS.handoutsPerCampaign) {
          throw new Error('This campaign has too many handouts. Delete one first.');
        }
        const handout = store.savePrep<Handout>(campaign.id, 'handout', id, data);
        if (before?.imageUrl && before.imageUrl !== handout.imageUrl) removeImage(before.imageUrl);
        ack({ ok: true, handout });
        afterPrepChange(campaign.id);
      } catch (e) {
        ack({ ok: false, error: (e as Error).message });
      }
    });

    socket.on('handout:delete', (input, ack) => {
      const campaign = ownCampaign(input?.campaignId);
      if (!campaign) return ack(NOT_DM);
      const handout = typeof input?.handoutId === 'string' ? store.getPrep<Handout>(campaign.id, 'handout', input.handoutId) : undefined;
      if (handout) {
        store.deletePrep(campaign.id, 'handout', handout.id);
        removeImage(handout.imageUrl);
      }
      ack({ ok: true });
      afterPrepChange(campaign.id);
    });

    socket.on('npc:save', (input, ack) => {
      const campaign = ownCampaign(input?.campaignId);
      if (!campaign) return ack(NOT_DM);
      try {
        const data = sanitizeNpc(input?.npc);
        const id = typeof input.npc.id === 'string' ? input.npc.id : undefined;
        if (!(id && store.getPrep(campaign.id, 'npc', id)) && store.countPrep(campaign.id, 'npc') >= PREP_LIMITS.npcsPerCampaign) {
          throw new Error('This campaign has too many NPCs. Delete one first.');
        }
        ack({ ok: true, npc: store.savePrep<Npc>(campaign.id, 'npc', id, data) });
      } catch (e) {
        ack({ ok: false, error: (e as Error).message });
      }
    });

    socket.on('npc:delete', (input, ack) => {
      const campaign = ownCampaign(input?.campaignId);
      if (!campaign) return ack(NOT_DM);
      if (typeof input?.npcId === 'string') store.deletePrep(campaign.id, 'npc', input.npcId);
      ack({ ok: true });
    });

    socket.on('log:get', (input, ack) => {
      const campaign = ownCampaign(input?.campaignId);
      if (!campaign) return ack(NOT_DM);
      const live = store.getSessionByCampaign(campaign.id);
      const now = live?.started && live.sessionNo ? live.sessionNo : undefined;
      const before = store.lastLoggedSession(campaign.id, now);
      ack({
        ok: true,
        current: now ? store.listLog(campaign.id, now) : [],
        previous: before ? store.listLog(campaign.id, before) : [],
      });
    });

    // ---------- DM tools during a session ----------

    const log = (live: { campaignId: string; sessionNo: number | null }, event: LogEvent) => {
      if (live.sessionNo) store.addLog(live.campaignId, live.sessionNo, event);
    };

    /** The running session this socket is the DM of. */
    const dmSession = () => {
      const live = socket.data.code && socket.data.isHost ? store.getSession(socket.data.code) : undefined;
      return live?.started ? live : undefined;
    };
    const NOT_RUNNING = { ok: false as const, error: 'Only the DM can do that, once the session has started.' };

    socket.on('handout:show', (input, ack) => {
      const live = dmSession();
      if (!live) return ack(NOT_RUNNING);
      if (input?.handoutId === null || input?.handoutId === undefined) store.setShownHandout(live.code, null);
      else {
        const handout = typeof input.handoutId === 'string' ? store.getPrep<Handout>(live.campaignId, 'handout', input.handoutId) : undefined;
        if (!handout) return ack({ ok: false, error: 'That handout no longer exists.' });
        store.setShownHandout(live.code, { handoutId: handout.id, shownAt: Date.now() });
        log(live, { kind: 'handout', who: '', what: handout.title });
      }
      ack({ ok: true });
      broadcast(live.code);
    });

    /** Fight entries for the chosen NPCs; several copies get numbered ("Goblin 2"). */
    const npcCombatants = (campaignId: string, picks: unknown, existing: Combatant[]): Combatant[] => {
      if (!Array.isArray(picks)) return [];
      const out: Combatant[] = [];
      for (const pick of picks.slice(0, 50) as { npcId?: unknown; count?: unknown }[]) {
        const npc = typeof pick?.npcId === 'string' ? store.getPrep<Npc>(campaignId, 'npc', pick.npcId) : undefined;
        const count = typeof pick?.count === 'number' && Number.isInteger(pick.count) ? Math.min(20, pick.count) : 1;
        if (!npc || count < 1) continue;
        const already = existing.filter((c) => c.kind === 'npc' && c.ref === npc.id).length;
        for (let i = 1; i <= count; i++) {
          out.push({
            id: randomUUID(),
            kind: 'npc',
            ref: npc.id,
            name: count + already > 1 ? `${npc.name} ${already + i}` : npc.name,
            bonus: npcInitiative(npc),
            initiative: null,
            d20: null,
            hp: { current: npc.hpMax, max: npc.hpMax },
            armorClass: npc.armorClass,
          });
        }
      }
      return out;
    };

    /** "2× Goblin, Bandit captain" */
    const opponentList = (npcs: Combatant[]) => {
      const counts = new Map<string, { name: string; n: number }>();
      for (const c of npcs) {
        const entry = counts.get(c.ref) ?? { name: c.name.replace(/ \d+$/, ''), n: 0 };
        counts.set(c.ref, { ...entry, n: entry.n + 1 });
      }
      return [...counts.values()].map((x) => (x.n > 1 ? `${x.n}× ${x.name}` : x.name)).join(', ');
    };

    const playerCombatants = (code: string, only?: unknown): Combatant[] =>
      store.sessionPlayers(code).flatMap((p) => {
        const ch = store.getCharacter(p.characterId);
        if (!ch || (Array.isArray(only) && !only.includes(ch.id))) return [];
        return [{
          id: randomUUID(),
          kind: 'player' as const,
          ref: ch.id,
          name: ch.data.name || p.user.username,
          bonus: deriveStats(ch.data).initiative,
          initiative: null,
          d20: null,
        }];
      });

    socket.on('combat:start', (input, ack) => {
      const live = dmSession();
      if (!live) return ack(NOT_RUNNING);
      if (live.combat) log(live, { kind: 'fightEnd', who: '', amount: live.combat.round });
      const npcs = npcCombatants(live.campaignId, input?.npcs, []);
      store.setCombat(live.code, newCombat([...playerCombatants(live.code), ...npcs]));
      log(live, { kind: 'fight', who: '', what: opponentList(npcs) });
      ack({ ok: true });
      io.to(roomOf(live.code)).emit('session:alert', { kind: 'fight' });
      broadcast(live.code);
    });

    socket.on('combat:add', (input, ack) => {
      const live = dmSession();
      if (!live?.combat) return ack({ ok: false, error: 'No fight is running.' });
      const inFight = new Set(live.combat.combatants.filter((c) => c.kind === 'player').map((c) => c.ref));
      const players = Array.isArray(input?.characterIds)
        ? playerCombatants(live.code, input.characterIds).filter((c) => !inFight.has(c.ref))
        : [];
      const more = [...players, ...npcCombatants(live.campaignId, input?.npcs, live.combat.combatants)];
      if (live.combat.combatants.length + more.length > 100) return ack({ ok: false, error: 'That fight is too big.' });
      store.setCombat(live.code, addCombatants(live.combat, more));
      ack({ ok: true });
      broadcast(live.code);
    });

    socket.on('combat:action', (input, ack) => {
      const live = dmSession();
      if (!live?.combat) return ack({ ok: false, error: 'No fight is running.' });
      try {
        const next = applyCombatAction(live.combat, input);
        store.setCombat(live.code, next);
        if (input.type === 'hp') {
          const before = live.combat.combatants.find((c) => c.id === input.id)!;
          const dealt = before.hp!.current - next.combatants.find((c) => c.id === input.id)!.hp!.current;
          if (dealt > 0) log(live, { kind: 'hit', who: before.name, amount: dealt });
          if (dealt > 0 && dealt === before.hp!.current) log(live, { kind: 'defeated', who: before.name });
        }
      } catch (e) {
        return ack({ ok: false, error: (e as Error).message });
      }
      ack({ ok: true });
      broadcast(live.code);
    });

    socket.on('combat:end', (ack) => {
      const live = dmSession();
      if (!live) return ack(NOT_RUNNING);
      if (live.combat) log(live, { kind: 'fightEnd', who: '', amount: live.combat.round });
      store.setCombat(live.code, null);
      ack({ ok: true });
      broadcast(live.code);
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
        if (f.live.started && f.live.sessionNo) store.addLog(f.campaign.id, f.live.sessionNo, { kind: 'join', who: ch.data.name });
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
      const before = store.getSession(code);
      const live = store.markStarted(code);
      if (live && !before?.started) {
        const names = sessionState(code)?.players.map((p) => p.character.name).join(', ');
        log(live, { kind: 'start', who: '', what: names ?? '' });
      }
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
      const live = store.getSession(code);
      if (live?.started) {
        if (live.combat) log(live, { kind: 'fightEnd', who: '', amount: live.combat.round });
        log(live, { kind: 'end', who: '' });
      }
      store.endSession(code);
      closeSession(code, socket.id);
      ack({ ok: true });
    });

    socket.on('disconnect', leaveCurrent);
  });

  return { httpServer, io };
}
