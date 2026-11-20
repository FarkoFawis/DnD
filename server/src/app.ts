import { randomInt, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, unlink, writeFileSync } from 'node:fs';
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
  Content,
  afterConditionsSet,
  afterHpSet,
  applyDamageOrHealing,
  applyDeathSave,
  applyLevelUp,
  DEATH_SAVE_LABEL,
  type DeathSaveResult,
  type LevelUpChoices,
  PORTRAIT_MAX_BYTES,
  PORTRAIT_TYPES,
  applyRest,
  applyUse,
  canSpendHitDice,
  hitDieSize,
  spendHitDie,
  type UseRequest,
  ROLL_MODES,
  describeRoll,
  planRoll,
  rollPlan,
  type DiceRoll,
  type RollMode,
  type RollRequest,
  BACKUP_FORMAT,
  BACKUP_LIMITS,
  BACKUP_VERSION,
  HANDOUT_IMAGE_TYPES,
  backupFileName,
  parseBackup,
  type BackupImage,
  type CampaignBackup,
  type ImportSummary,
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
import { SRD } from '@dnd/shared/srd';
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
/** Brings untrusted level-up choices into shape; applyLevelUp() checks the values. */
function cleanLevelUp(v: unknown): LevelUpChoices {
  const o = (typeof v === 'object' && v !== null ? v : {}) as Record<string, unknown>;
  const s = (x: unknown, max: number) => (typeof x === 'string' ? x.slice(0, max) : '');
  const asiIn = (typeof o.asi === 'object' && o.asi !== null ? o.asi : {}) as Record<string, unknown>;
  const asi: LevelUpChoices['asi'] = {};
  for (const a of ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const) if (typeof asiIn[a] === 'number') asi[a] = asiIn[a];
  return {
    hpRoll: typeof o.hpRoll === 'number' ? o.hpRoll : null,
    subclassId: s(o.subclassId, 80),
    customSubclass: s(o.customSubclass, LIMITS.textFieldMaxLength),
    featId: s(o.featId, 80),
    customFeat: s(o.customFeat, 80),
    asi,
    spells: Array.isArray(o.spells) ? o.spells.slice(0, 40).map((x) => s(x, 80)) : [],
  };
}

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
  const smallJson = express.json({ limit: '32kb' });
  // A campaign backup is a big file with pictures in it; its route brings its own parser.
  app.use((req, res, next) => (req.path === '/api/campaigns/import' ? next() : smallJson(req, res, next)));

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

  // ---------- character portraits ----------

  /** The image bytes must really be what the header says: check the magic numbers. */
  const sniff = (b: Uint8Array): string | null => {
    if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
    if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
    if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'image/gif';
    return null;
  };

  /** Only the character's owner changes its portrait (cosmetic, so in a session too). */
  const ownCharacter = (req: express.Request, res: express.Response) => {
    const token = bearer(req.headers.authorization);
    const user = token ? store.userForToken(token) : undefined;
    if (!user) {
      res.status(401).json({ error: 'Not logged in.' });
      return undefined;
    }
    const ch = store.getCharacter(String(req.params.id));
    if (!ch || ch.userId !== user.id) {
      res.status(404).json({ error: 'That is not one of your characters.' });
      return undefined;
    }
    return ch;
  };

  const portraitChanged = (characterId: string, version: string) => {
    const character = store.updateCharacter(characterId, { portrait: version });
    if (character.inSession) broadcast(character.inSession);
    return character;
  };

  app.put(
    '/api/characters/:id/portrait',
    express.raw({ type: PORTRAIT_TYPES as unknown as string[], limit: PORTRAIT_MAX_BYTES }),
    (req, res) => {
      const ch = ownCharacter(req, res);
      if (!ch) return;
      const body: unknown = req.body;
      const mime = body instanceof Uint8Array && body.length > 12 ? sniff(body) : null;
      if (!(body instanceof Uint8Array) || !mime || !(PORTRAIT_TYPES as readonly string[]).includes(mime)) {
        res.status(400).json({ error: 'Send a JPEG, PNG or WebP picture.' });
        return;
      }
      store.setPortrait(ch.id, mime, body);
      res.json({ character: portraitChanged(ch.id, Date.now().toString(36)) });
    },
  );

  app.delete('/api/characters/:id/portrait', (req, res) => {
    const ch = ownCharacter(req, res);
    if (!ch) return;
    store.deletePortrait(ch.id);
    res.json({ character: portraitChanged(ch.id, '') });
  });

  /** Public by design: <img> can't send the login token, and character ids are unguessable. */
  app.get('/api/portraits/:id', (req, res) => {
    const p = store.getPortrait(String(req.params.id));
    if (!p) {
      res.status(404).end();
      return;
    }
    res.setHeader('Content-Type', p.mime);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // The client adds ?v=<version>, so a new upload gets a new URL.
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    res.end(Buffer.from(p.data));
  });

  // ---------- campaign backup ----------

  /** A picture from a backup file, if it really is one of the allowed kinds. */
  const decodeImage = (img: BackupImage | undefined, types: readonly string[]): { mime: string; data: Buffer } | undefined => {
    if (!img) return undefined;
    const data = Buffer.from(img.data, 'base64');
    const mime = data.length > 12 ? sniff(data) : null;
    return mime && types.includes(mime) ? { mime, data } : undefined;
  };

  // Everything the campaign needs to be rebuilt elsewhere, as one file for the DM to keep.
  app.get('/api/campaigns/:id/export', (req, res) => {
    const token = bearer(req.headers.authorization);
    const user = token ? store.userForToken(token) : undefined;
    const campaign = store.getCampaign(String(req.params.id));
    if (!user || !campaign || campaign.ownerId !== user.id) {
      res.status(403).json({ error: 'Only the DM of this campaign can save a backup of it.' });
      return;
    }
    const readImage = (url: string | null): BackupImage | undefined => {
      if (!uploadsDir || !url || !IMAGE_URL_PATTERN.test(url)) return undefined;
      try {
        const data = readFileSync(join(uploadsDir, basename(url)));
        const mime = sniff(data);
        return mime ? { mime, data: data.toString('base64') } : undefined;
      } catch {
        return undefined; // the file is gone; the handout keeps its text
      }
    };
    const backup: CampaignBackup = {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      campaign: { id: campaign.id, name: campaign.name },
      handouts: store.listPrep<Handout>(campaign.id, 'handout').map((h) => {
        const image = readImage(h.imageUrl);
        return { title: h.title, text: h.text, ...(image ? { image } : {}) };
      }),
      npcs: store.listPrep<Npc>(campaign.id, 'npc').map(({ id: _id, ...npc }) => npc),
      log: store.allLog(campaign.id),
      characters: store.campaignCharacters(campaign.id).map((c) => {
        const p = store.getPortrait(c.id);
        return { ...c, ...(p ? { portrait: { mime: p.mime, data: Buffer.from(p.data).toString('base64') } } : {}) };
      }),
    };
    res.setHeader('Content-Disposition', `attachment; filename="${backupFileName(campaign.name, new Date())}"`);
    res.json(backup);
  });

  // Loads a backup file as a new campaign of whoever sends it. Nothing that is
  // already in the database is changed: characters that still exist are left alone.
  app.post('/api/campaigns/import', express.json({ limit: BACKUP_LIMITS.maxBytes }), (req, res) => {
    const token = bearer(req.headers.authorization);
    const user = token ? store.userForToken(token) : undefined;
    if (!user) {
      res.status(401).json({ error: 'Not logged in.' });
      return;
    }
    let parsed;
    try {
      parsed = parseBackup(req.body);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
      return;
    }
    const { backup } = parsed;
    let skipped = parsed.skipped;

    // Characters go back to their players, found by username.
    const owners = new Map<string, string | undefined>();
    for (const c of backup.characters) {
      const key = c.owner.toLowerCase();
      if (!owners.has(key)) owners.set(key, store.userIdByName(c.owner));
    }
    const fresh = backup.characters.filter((c) => !store.characterExists(c.id));
    const missingPlayers = [...new Set(fresh.filter((c) => !owners.get(c.owner.toLowerCase())).map((c) => c.owner))];
    if (missingPlayers.length > 0 && req.query.skipMissing !== '1') {
      res.status(409).json({
        error: `No account here for: ${missingPlayers.join(', ')}. Add them first (npm run users -- add ${missingPlayers.join(' ')}), or load the backup without their characters.`,
        missingPlayers,
      });
      return;
    }

    const label = (c: { owner: string; data: CharacterData }) => `${c.data.name} (${c.owner})`;
    const handouts: Omit<Handout, 'id'>[] = [];
    for (const h of backup.handouts) {
      const img = uploadsDir ? decodeImage(h.image, HANDOUT_IMAGE_TYPES) : undefined;
      let imageUrl: string | null = null;
      if (img) {
        mkdirSync(uploadsDir!, { recursive: true });
        const name = `${randomUUID()}.${IMAGE_TYPES[img.mime]}`;
        writeFileSync(join(uploadsDir!, name), img.data);
        imageUrl = `/api/images/${name}`;
      }
      if (imageUrl || h.text) handouts.push({ title: h.title, text: h.text, imageUrl });
      else skipped += 1;
    }
    const names = new Set(store.listCampaigns(user.id).map((c) => c.name.toLowerCase()));
    let name = backup.campaign.name;
    for (let n = 2; names.has(name.toLowerCase()); n++) {
      const suffix = n === 2 ? ' (restored)' : ` (restored ${n - 1})`;
      name = `${backup.campaign.name.slice(0, LIMITS.campaignNameMaxLength - suffix.length)}${suffix}`;
    }
    const id = backup.campaign.id && !store.getCampaign(backup.campaign.id) ? backup.campaign.id : randomUUID();
    const restored = fresh.flatMap((c) => {
      const userId = owners.get(c.owner.toLowerCase());
      if (!userId) return [];
      const portrait = decodeImage(c.portrait, PORTRAIT_TYPES);
      return [{ ...c, userId, portrait, data: { ...c.data, portrait: portrait ? Date.now().toString(36) : '' } }];
    });
    try {
      store.restoreCampaign({ id, name, ownerId: user.id, handouts, npcs: backup.npcs, log: backup.log, characters: restored });
    } catch (e) {
      for (const h of handouts) removeImage(h.imageUrl);
      res.status(500).json({ error: `The backup could not be loaded: ${(e as Error).message}` });
      return;
    }
    const summary: ImportSummary = {
      campaign: { id, name },
      handouts: handouts.length,
      npcs: backup.npcs.length,
      sessions: new Set(backup.log.map((e) => e.session)).size,
      characters: restored.map(label),
      existing: backup.characters.filter((c) => !fresh.includes(c)).map(label),
      withoutAccount: fresh.filter((c) => !owners.get(c.owner.toLowerCase())).map(label),
      skipped,
    };
    res.json({ summary });
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

  // Bodies that are too big or not what they say (a backup that isn't JSON).
  app.use((err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    const e = err as { type?: string; status?: number };
    if (res.headersSent || !e?.type) return next(err);
    res
      .status(e.status ?? 400)
      .json({ error: e.type === 'entity.too.large' ? 'That file is too big.' : 'That file could not be read.' });
  });

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

  /** SRD plus the private packs, re-read at most every few seconds so edited packs show up. */
  let cached: { at: number; content: Content } | undefined;
  const gameContent = (): Content => {
    if (!cached || Date.now() - cached.at > 5000) {
      cached = { at: Date.now(), content: new Content([SRD, ...(contentDir ? loadContentPacks(contentDir).packs : [])]) };
    }
    return cached.content;
  };

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
      // Setting HP or conditions directly has the same side effects as damage would.
      const extra = {
        ...(patch.hpCurrent !== undefined ? afterHpSet(t.ch.data, patch.hpCurrent) : {}),
        ...(patch.conditions !== undefined ? afterConditionsSet(t.ch.data, patch.conditions) : {}),
      };
      const character = store.updateCharacter(t.ch.id, { ...extra, ...patch });
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
      const character = store.updateCharacter(t.ch.id, applyDamageOrHealing(t.ch.data, delta));
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

    // ---------- spells, limited uses, rests ----------

    /** The owner (in a session too) or the DM of the session the character is in. */
    const usable = (characterId: unknown) => {
      const ch = typeof characterId === 'string' ? store.getCharacter(characterId) : undefined;
      if (!ch) return { ok: false as const, error: 'That character no longer exists.' };
      const isDm = !!ch.inSession && socket.data.isHost === true && socket.data.code === ch.inSession;
      if (!isDm && ch.userId !== user.id) return { ok: false as const, error: 'You can only use your own character.' };
      return { ok: true as const, ch, isDm };
    };

    /** DM of its session, or its owner outside sessions. */
    const restable = (characterId: unknown) => {
      const t = usable(characterId);
      if (t.ok && !t.isDm && t.ch.inSession) return { ok: false as const, error: 'Your DM decides when the party rests.' };
      return t;
    };

    socket.on('character:use', (input, ack) => {
      const t = usable(input?.characterId);
      if (!t.ok) return ack(t);
      const req = input?.use as UseRequest | undefined;
      if (!req || typeof req !== 'object' || !['spell', 'feature', 'attack'].includes(req.kind)) {
        return ack({ ok: false, error: 'Nothing to use.' });
      }
      try {
        const clean: UseRequest =
          req.kind === 'spell'
            ? { kind: 'spell', spellId: String(req.spellId), slot: req.slot === undefined ? undefined : String(req.slot), ritual: req.ritual === true }
            : req.kind === 'feature'
              ? { kind: 'feature', useId: String(req.useId), amount: typeof req.amount === 'number' ? req.amount : undefined }
              : { kind: 'attack', name: String(req.name ?? '') };
        const spell = clean.kind === 'spell' ? t.ch.data.spells.find((x) => x.id === clean.spellId) : undefined;
        const def = spell?.ref ? gameContent().spell(spell.ref) : undefined;
        const r = applyUse(t.ch.data, clean, { concentration: def?.concentration === true });
        const character = store.updateCharacter(t.ch.id, {
          used: r.used,
          lastAction: { ...r.action, at: new Date().toISOString() },
          ...(r.concentration ? { concentration: r.concentration } : {}),
        });
        ack({ ok: true, character });
        logFor(character, { kind: 'used', what: r.action.detail ? `${r.action.name} (${r.action.detail})` : r.action.name });
        afterChange(character);
      } catch (e) {
        ack({ ok: false, error: (e as Error).message });
      }
    });

    socket.on('character:concentration', (input, ack) => {
      const t = usable(input?.characterId);
      if (!t.ok) return ack(t);
      const now = t.ch.data.concentration;
      if (!now) return ack({ ok: false, error: 'Not concentrating on anything.' });
      if (input?.action !== 'end' && input?.action !== 'kept') return ack({ ok: false, error: 'Invalid action.' });
      const character = store.updateCharacter(t.ch.id, {
        concentration: input.action === 'end' ? null : { ...now, saveDc: null },
      });
      ack({ ok: true, character });
      afterChange(character);
    });

    socket.on('character:deathSave', (input, ack) => {
      const t = usable(input?.characterId);
      if (!t.ok) return ack(t);
      try {
        const result = input?.result as DeathSaveResult;
        const character = store.updateCharacter(t.ch.id, {
          ...applyDeathSave(t.ch.data, result),
          lastAction: { name: 'Death save', detail: DEATH_SAVE_LABEL[result], at: new Date().toISOString() },
        });
        ack({ ok: true, character });
        logFor(character, { kind: 'deathSave', what: DEATH_SAVE_LABEL[result] });
        logChanges(t.ch.data, character);
        afterChange(character);
      } catch (e) {
        ack({ ok: false, error: (e as Error).message });
      }
    });

    /**
     * Levelling up happens on the player's own phone. Outside sessions the owner
     * may always; in a session only once the DM has said so (levelUpReady).
     */
    const canLevelUp = (characterId: unknown) => {
      const ch = typeof characterId === 'string' ? store.getCharacter(characterId) : undefined;
      if (!ch) return { ok: false as const, error: 'That character no longer exists.' };
      if (ch.userId !== user.id) return { ok: false as const, error: 'Players level up their own characters, on their own phone.' };
      if (ch.inSession && !ch.data.levelUpReady) {
        return { ok: false as const, error: 'Your DM decides when you level up during a session.' };
      }
      return { ok: true as const, ch };
    };

    socket.on('character:levelUp', (input, ack) => {
      const t = canLevelUp(input?.characterId);
      if (!t.ok) return ack(t);
      try {
        const character = store.updateCharacter(t.ch.id, {
          ...applyLevelUp(t.ch.data, cleanLevelUp(input?.choices), gameContent(), randomUUID),
          levelUpReady: false,
        });
        ack({ ok: true, character });
        logChanges(t.ch.data, character);
        afterChange(character);
      } catch (e) {
        ack({ ok: false, error: (e as Error).message });
      }
    });

    socket.on('character:restore', (input, ack) => {
      const t = restable(input?.characterId);
      if (!t.ok) return ack(t);
      const id = String(input?.id ?? '');
      const n = t.ch.data.used[id] ?? 0;
      if (n <= 0) return ack({ ok: false, error: 'Nothing spent there.' });
      const used = { ...t.ch.data.used, [id]: n - 1 };
      if (used[id] === 0) delete used[id];
      const character = store.updateCharacter(t.ch.id, { used });
      ack({ ok: true, character });
      afterChange(character);
    });

    socket.on('character:rest', (input, ack) => {
      const t = restable(input?.characterId);
      if (!t.ok) return ack(t);
      if (input?.kind !== 'short' && input?.kind !== 'long') return ack({ ok: false, error: 'Short or long rest?' });
      const character = store.updateCharacter(t.ch.id, restPatch(t.ch, input.kind));
      ack({ ok: true, character });
      logFor(character, { kind: 'rest', what: input.kind });
      // The DM rested one character: that player's phone shows it (see RestAlert on the client).
      if (t.isDm && character.inSession) {
        io.to(roomOf(character.inSession)).emit('session:alert', { kind: 'rest', rest: input.kind, characterId: character.id });
      }
      afterChange(character);
    });

    /** A Short Rest in a session also lets the player spend Hit Dice on their own phone. */
    const restPatch = (ch: CharacterSummary, kind: 'short' | 'long'): Partial<CharacterData> => ({
      ...applyRest(ch.data, kind),
      ...(kind === 'short' && ch.inSession ? { resting: canSpendHitDice(ch.data) } : {}),
    });

    socket.on('character:hitDice', (input, ack) => {
      const t = usable(input?.characterId);
      if (!t.ok) return ack(t);
      // Ending a rest is always fine, also one that has just ended by itself (full HP, no dice left).
      if (input?.action === 'done') {
        const character = store.updateCharacter(t.ch.id, { resting: false });
        ack({ ok: true, character });
        return afterChange(character);
      }
      if (!t.isDm && t.ch.inSession && !t.ch.data.resting) {
        return ack({ ok: false, error: 'Hit Dice are spent on a Short Rest. Your DM decides when the party rests.' });
      }
      if (input?.action !== 'spend') return ack({ ok: false, error: 'Invalid action.' });
      try {
        const die = hitDieSize(t.ch.data, gameContent());
        // The player's own die from the table, or ours when they have none at hand.
        const roll = typeof input.roll === 'number' ? input.roll : randomInt(1, die + 1);
        const r = spendHitDie(t.ch.data, die, roll);
        const character = store.updateCharacter(t.ch.id, {
          ...r.patch,
          lastAction: { name: 'Hit Die', detail: `+${r.healed} HP`, kind: 'heal', at: new Date().toISOString() },
        });
        ack({ ok: true, character, spent: { die, roll, modifier: r.modifier, healed: r.healed } });
        logFor(character, { kind: 'heal', amount: r.healed, what: `Hit Die, ${character.data.hpCurrent}/${character.data.hpMax} HP` });
        afterChange(character);
      } catch (e) {
        ack({ ok: false, error: (e as Error).message });
      }
    });

    // ---------- dice roller ----------

    socket.on('character:roll', (input, ack) => {
      const t = usable(input?.characterId);
      if (!t.ok) return ack(t);
      const mode: RollMode = ROLL_MODES.includes(input?.mode as RollMode) ? (input.mode as RollMode) : 'normal';
      try {
        const plan = planRoll(t.ch.data, input?.roll as RollRequest, gameContent());
        const result: DiceRoll = {
          ...rollPlan(plan, mode, (sides) => randomInt(1, sides + 1)),
          id: randomUUID(),
          at: new Date().toISOString(),
          characterId: t.ch.id,
          who: t.ch.data.name,
        };
        const extra = result.natural ? ` · natural ${result.natural}` : result.note ? ` ${result.note.toLowerCase()}` : '';
        const character = store.updateCharacter(t.ch.id, {
          lastAction: { name: result.label, detail: `${result.total}${extra}`, roll: true, at: result.at },
        });
        ack({ ok: true, result, character });
        logFor(character, { kind: 'roll', what: describeRoll(result) });
        const live = character.inSession ? store.getSession(character.inSession) : undefined;
        if (live) {
          // A rolled initiative goes straight into the turn order, unless the DM already set one.
          const me = plan.kind === 'initiative' ? live.combat?.combatants.find((c) => c.kind === 'player' && c.ref === t.ch.id) : undefined;
          if (live.combat && me && me.initiative === null) {
            store.setCombat(live.code, applyCombatAction(live.combat, { type: 'set', id: me.id, value: result.total }));
          }
          for (const s of io.sockets.sockets.values()) {
            if (s.data.code === live.code && s.data.isHost) s.emit('session:roll', result);
          }
        }
        afterChange(character);
      } catch (e) {
        ack({ ok: false, error: (e as Error).message });
      }
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
      // A fight ends any Short Rest that is still open.
      for (const p of store.sessionPlayers(live.code)) {
        if (store.getCharacter(p.characterId)?.data.resting) store.updateCharacter(p.characterId, { resting: false });
      }
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

    socket.on('session:rest', (input, ack) => {
      const code = socket.data.code;
      if (!code || !socket.data.isHost) return ack({ ok: false, error: 'Only the DM can call a rest.' });
      if (input?.kind !== 'short' && input?.kind !== 'long') return ack({ ok: false, error: 'Short or long rest?' });
      for (const p of store.sessionPlayers(code)) {
        const ch = store.getCharacter(p.characterId);
        if (ch) store.updateCharacter(ch.id, { ...applyRest(ch.data, input.kind), ...(input.kind === 'short' ? { resting: canSpendHitDice(ch.data) } : {}) });
      }
      const live = store.getSession(code);
      if (live?.started && live.sessionNo) store.addLog(live.campaignId, live.sessionNo, { kind: 'rest', who: '', what: input.kind });
      ack({ ok: true });
      io.to(roomOf(code)).emit('session:alert', { kind: 'rest', rest: input.kind });
      broadcast(code);
    });

    socket.on('disconnect', leaveCurrent);
  });

  return { httpServer, io };
}
