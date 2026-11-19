import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  DEFAULT_CHARACTER,
  generateRoomCode,
  normalizeCharacter,
  type BackupLogEntry,
  type CampaignSummary,
  type Combat,
  type Handout,
  type LogEntry,
  type LogEvent,
  type Npc,
  type CharacterData,
  type CharacterSummary,
  type PublicUser,
} from '@dnd/shared';
import { hashPassword, verifyPassword } from './passwords.ts';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export interface StoredCampaign {
  id: string;
  name: string;
  ownerId: string;
}

export interface LiveSession {
  code: string;
  campaignId: string;
  started: boolean;
  /** The handout on everyone's screen, if any. */
  shown: { handoutId: string; shownAt: number } | null;
  combat: Combat | null;
  /** Which session of the campaign this is (set when the DM starts it), for the session log. */
  sessionNo: number | null;
}

interface CharacterRow {
  id: string;
  userId: string;
  campaignId: string | null;
  campaignName: string | null;
  data: string;
  inSession: string | null;
}

/**
 * All persistent state. Nothing important lives only in memory or on a phone,
 * so a crashed phone or a restarted server loses nothing.
 */
export class Store {
  private db: DatabaseSync;

  /** Pass ':memory:' for tests. */
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS users (
        id            TEXT PRIMARY KEY,
        username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT,
        created_at    TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS auth_tokens (
        token_hash  TEXT PRIMARY KEY,
        user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS campaigns (
        id             TEXT PRIMARY KEY,
        name           TEXT NOT NULL,
        owner_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at     TEXT NOT NULL DEFAULT (datetime('now')),
        last_played_at TEXT
      );
    `);
    this.migrateToOwnedCharacters();
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS characters (
        id          TEXT PRIMARY KEY,
        user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        -- The campaign it last played in (characters can join any campaign).
        campaign_id TEXT REFERENCES campaigns(id) ON DELETE SET NULL,
        data        TEXT NOT NULL,
        created_at  TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS characters_user ON characters(user_id);
      CREATE TABLE IF NOT EXISTS live_sessions (
        code        TEXT PRIMARY KEY,
        campaign_id TEXT NOT NULL UNIQUE REFERENCES campaigns(id) ON DELETE CASCADE,
        started     INTEGER NOT NULL DEFAULT 0,
        created_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS session_players (
        code         TEXT NOT NULL REFERENCES live_sessions(code) ON DELETE CASCADE,
        user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        character_id TEXT NOT NULL UNIQUE REFERENCES characters(id) ON DELETE CASCADE,
        ready        INTEGER NOT NULL DEFAULT 0,
        joined_at    TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (code, user_id)
      );
      -- Campaign prep: handouts and NPCs ('handout' | 'npc'), JSON validated by shared/prep.ts.
      CREATE TABLE IF NOT EXISTS prep_entries (
        id          TEXT PRIMARY KEY,
        campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
        kind        TEXT NOT NULL,
        data        TEXT NOT NULL,
        created_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS prep_entries_campaign ON prep_entries(campaign_id, kind);
      -- What happened in each session of a campaign (shared/log.ts); data = JSON LogEvent.
      CREATE TABLE IF NOT EXISTS session_log (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
        session_no  INTEGER NOT NULL,
        at          TEXT NOT NULL DEFAULT (datetime('now')),
        data        TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS session_log_campaign ON session_log(campaign_id, session_no);
      -- Character portraits, kept out of the character JSON so sheets stay small.
      CREATE TABLE IF NOT EXISTS portraits (
        character_id TEXT PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE,
        mime         TEXT NOT NULL,
        data         BLOB NOT NULL,
        updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    // Added after the first databases were created.
    const liveCols = (this.db.prepare(`SELECT name FROM pragma_table_info('live_sessions')`).all() as { name: string }[]).map((c) => c.name);
    if (!liveCols.includes('shown')) this.db.exec('ALTER TABLE live_sessions ADD COLUMN shown TEXT');
    if (!liveCols.includes('combat')) this.db.exec('ALTER TABLE live_sessions ADD COLUMN combat TEXT');
    if (!liveCols.includes('session_no')) this.db.exec('ALTER TABLE live_sessions ADD COLUMN session_no INTEGER');
  }

  // ---------- session log ----------

  addLog(campaignId: string, sessionNo: number, event: LogEvent): void {
    this.db
      .prepare('INSERT INTO session_log (campaign_id, session_no, data) VALUES (?, ?, ?)')
      .run(campaignId, sessionNo, JSON.stringify(event));
  }

  /** One session's entries, oldest first. */
  listLog(campaignId: string, sessionNo: number): LogEntry[] {
    return (
      this.db
        .prepare('SELECT id, session_no AS session, at, data FROM session_log WHERE campaign_id = ? AND session_no = ? ORDER BY id')
        .all(campaignId, sessionNo) as { id: number; session: number; at: string; data: string }[]
    ).map((r) => ({ ...(JSON.parse(r.data) as LogEvent), id: r.id, session: r.session, at: r.at }));
  }

  /** Number of the newest logged session before `before` (0 = none). */
  lastLoggedSession(campaignId: string, before?: number): number {
    return (
      this.db
        .prepare('SELECT coalesce(max(session_no), 0) AS n FROM session_log WHERE campaign_id = ? AND session_no < ?')
        .get(campaignId, before ?? Number.MAX_SAFE_INTEGER) as { n: number }
    ).n;
  }

  /** Every entry of the campaign, oldest first, for a backup. */
  allLog(campaignId: string): BackupLogEntry[] {
    return (
      this.db
        .prepare('SELECT session_no AS session, at, data FROM session_log WHERE campaign_id = ? ORDER BY id')
        .all(campaignId) as { session: number; at: string; data: string }[]
    ).map((r) => ({ ...(JSON.parse(r.data) as LogEvent), session: r.session, at: r.at }));
  }

  // ---------- campaign backup ----------

  /** The characters that last played in the campaign, with their players' usernames. */
  campaignCharacters(campaignId: string): { id: string; owner: string; data: CharacterData }[] {
    return (
      this.db
        .prepare(
          `SELECT ch.id, u.username AS owner, ch.data FROM characters ch JOIN users u ON u.id = ch.user_id
           WHERE ch.campaign_id = ? ORDER BY ch.created_at, ch.rowid`,
        )
        .all(campaignId) as { id: string; owner: string; data: string }[]
    ).map((r) => ({ id: r.id, owner: r.owner, data: normalizeCharacter(JSON.parse(r.data)) }));
  }

  userIdByName(username: string): string | undefined {
    return this.findUser(username)?.id;
  }

  characterExists(id: string): boolean {
    return this.db.prepare('SELECT 1 FROM characters WHERE id = ?').get(id) !== undefined;
  }

  /**
   * Writes a checked backup (see parseBackup) as a new campaign of `ownerId`,
   * all or nothing. Characters keep their ids and get this campaign as their
   * last one; the caller leaves out those that still exist.
   */
  restoreCampaign(input: {
    id: string;
    name: string;
    ownerId: string;
    handouts: Omit<Handout, 'id'>[];
    npcs: Omit<Npc, 'id'>[];
    log: BackupLogEntry[];
    characters: { id: string; userId: string; data: CharacterData; portrait?: { mime: string; data: Uint8Array } }[];
  }): void {
    this.db.exec('BEGIN');
    try {
      this.db.prepare('INSERT INTO campaigns (id, name, owner_id) VALUES (?, ?, ?)').run(input.id, input.name, input.ownerId);
      const prep = this.db.prepare('INSERT INTO prep_entries (id, campaign_id, kind, data) VALUES (?, ?, ?, ?)');
      for (const h of input.handouts) prep.run(randomUUID(), input.id, 'handout', JSON.stringify(h));
      for (const n of input.npcs) prep.run(randomUUID(), input.id, 'npc', JSON.stringify(n));
      const log = this.db.prepare('INSERT INTO session_log (campaign_id, session_no, at, data) VALUES (?, ?, ?, ?)');
      for (const { session, at, ...event } of input.log) log.run(input.id, session, at, JSON.stringify(event));
      const last = input.log.at(-1);
      if (last) this.db.prepare('UPDATE campaigns SET last_played_at = ? WHERE id = ?').run(last.at, input.id);
      const character = this.db.prepare('INSERT INTO characters (id, user_id, campaign_id, data) VALUES (?, ?, ?, ?)');
      for (const c of input.characters) {
        character.run(c.id, c.userId, input.id, JSON.stringify(c.data));
        if (c.portrait) this.setPortrait(c.id, c.portrait.mime, c.portrait.data);
      }
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  // ---------- campaign prep ----------

  listPrep<T extends Handout | Npc>(campaignId: string, kind: 'handout' | 'npc'): T[] {
    return (
      this.db
        .prepare('SELECT id, data FROM prep_entries WHERE campaign_id = ? AND kind = ? ORDER BY created_at, rowid')
        .all(campaignId, kind) as { id: string; data: string }[]
    ).map((r) => ({ ...JSON.parse(r.data), id: r.id }) as T);
  }

  getPrep<T extends Handout | Npc>(campaignId: string, kind: 'handout' | 'npc', id: string): T | undefined {
    const r = this.db
      .prepare('SELECT id, data FROM prep_entries WHERE id = ? AND campaign_id = ? AND kind = ?')
      .get(id, campaignId, kind) as { id: string; data: string } | undefined;
    return r && ({ ...JSON.parse(r.data), id: r.id } as T);
  }

  /** Creates the entry, or replaces it when `id` is one of this campaign's entries. */
  savePrep<T extends Handout | Npc>(campaignId: string, kind: 'handout' | 'npc', id: string | undefined, data: Omit<T, 'id'>): T {
    if (id && this.getPrep(campaignId, kind, id)) {
      this.db.prepare('UPDATE prep_entries SET data = ? WHERE id = ?').run(JSON.stringify(data), id);
    } else {
      id = randomUUID();
      this.db
        .prepare('INSERT INTO prep_entries (id, campaign_id, kind, data) VALUES (?, ?, ?, ?)')
        .run(id, campaignId, kind, JSON.stringify(data));
    }
    return { ...data, id } as T;
  }

  countPrep(campaignId: string, kind: 'handout' | 'npc'): number {
    return (
      this.db.prepare('SELECT count(*) AS n FROM prep_entries WHERE campaign_id = ? AND kind = ?').get(campaignId, kind) as { n: number }
    ).n;
  }

  deletePrep(campaignId: string, kind: 'handout' | 'npc', id: string): void {
    this.db.prepare('DELETE FROM prep_entries WHERE id = ? AND campaign_id = ? AND kind = ?').run(id, campaignId, kind);
  }

  setShownHandout(code: string, shown: LiveSession['shown']): void {
    this.db.prepare('UPDATE live_sessions SET shown = ? WHERE code = ?').run(shown && JSON.stringify(shown), code);
  }

  setCombat(code: string, combat: Combat | null): void {
    this.db.prepare('UPDATE live_sessions SET combat = ? WHERE code = ?').run(combat && JSON.stringify(combat), code);
  }

  // ---------- portraits ----------

  setPortrait(characterId: string, mime: string, data: Uint8Array): void {
    this.db
      .prepare(
        `INSERT INTO portraits (character_id, mime, data) VALUES (?, ?, ?)
         ON CONFLICT(character_id) DO UPDATE SET mime = excluded.mime, data = excluded.data, updated_at = datetime('now')`,
      )
      .run(characterId, mime, data);
  }

  getPortrait(characterId: string): { mime: string; data: Uint8Array } | undefined {
    return this.db.prepare('SELECT mime, data FROM portraits WHERE character_id = ?').get(characterId) as
      | { mime: string; data: Uint8Array }
      | undefined;
  }

  deletePortrait(characterId: string): void {
    this.db.prepare('DELETE FROM portraits WHERE character_id = ?').run(characterId);
  }

  /**
   * The first prototype stored one character per (campaign, user) and had no
   * lobby. Convert those characters to player-owned ones (remembering their
   * campaign as the last one played), and drop the old live-session tables (sessions are short-lived).
   */
  private migrateToOwnedCharacters(): void {
    const cols = this.db.prepare(`SELECT name FROM pragma_table_info('characters')`).all() as { name: string }[];
    if (cols.length === 0 || cols.some((c) => c.name === 'id')) return;
    this.db.exec(`
      BEGIN;
      DROP TABLE IF EXISTS session_players;
      DROP TABLE IF EXISTS live_sessions;
      ALTER TABLE characters RENAME TO characters_v1;
      CREATE TABLE characters (
        id          TEXT PRIMARY KEY,
        user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        campaign_id TEXT REFERENCES campaigns(id) ON DELETE SET NULL,
        data        TEXT NOT NULL,
        created_at  TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO characters (id, user_id, campaign_id, data, updated_at)
        SELECT lower(hex(randomblob(16))), user_id, campaign_id, data, updated_at FROM characters_v1;
      DROP TABLE characters_v1;
      COMMIT;
    `);
  }

  // ---------- users ----------

  /** Pre-made accounts: created without a password; the friend picks one on first login. */
  addUser(username: string): PublicUser {
    const id = randomUUID();
    this.db.prepare('INSERT INTO users (id, username) VALUES (?, ?)').run(id, username);
    return { id, username };
  }

  listUsers(): (PublicUser & { hasPassword: boolean })[] {
    return (
      this.db.prepare('SELECT id, username, password_hash IS NOT NULL AS hasPassword FROM users ORDER BY username').all() as {
        id: string;
        username: string;
        hasPassword: number;
      }[]
    ).map((u) => ({ ...u, hasPassword: u.hasPassword === 1 }));
  }

  private findUser(username: string) {
    return this.db
      .prepare('SELECT id, username, password_hash AS passwordHash FROM users WHERE username = ?')
      .get(username) as { id: string; username: string; passwordHash: string | null } | undefined;
  }

  accountStatus(username: string): { exists: boolean; hasPassword: boolean } {
    const u = this.findUser(username);
    return { exists: !!u, hasPassword: !!u?.passwordHash };
  }

  /**
   * Logs in. If the account has no password yet, `password` becomes its password.
   * Returns undefined on unknown user or wrong password.
   */
  login(username: string, password: string): { token: string; user: PublicUser } | undefined {
    const u = this.findUser(username);
    if (!u) return undefined;
    if (u.passwordHash === null) {
      this.db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), u.id);
    } else if (!verifyPassword(password, u.passwordHash)) {
      return undefined;
    }
    const token = randomBytes(32).toString('base64url');
    this.db.prepare('INSERT INTO auth_tokens (token_hash, user_id) VALUES (?, ?)').run(sha256(token), u.id);
    return { token, user: { id: u.id, username: u.username } };
  }

  /** Clears the password and logs the user out everywhere, so they can choose a new one. */
  resetPassword(username: string): boolean {
    const u = this.findUser(username);
    if (!u) return false;
    this.db.prepare('UPDATE users SET password_hash = NULL WHERE id = ?').run(u.id);
    this.db.prepare('DELETE FROM auth_tokens WHERE user_id = ?').run(u.id);
    return true;
  }

  removeUser(username: string): boolean {
    return this.db.prepare('DELETE FROM users WHERE username = ?').run(username).changes === 1;
  }

  userForToken(token: string): PublicUser | undefined {
    return this.db
      .prepare(
        `SELECT u.id, u.username FROM auth_tokens t JOIN users u ON u.id = t.user_id WHERE t.token_hash = ?`,
      )
      .get(sha256(token)) as PublicUser | undefined;
  }

  logout(token: string): void {
    this.db.prepare('DELETE FROM auth_tokens WHERE token_hash = ?').run(sha256(token));
  }

  getUser(id: string): PublicUser | undefined {
    return this.db.prepare('SELECT id, username FROM users WHERE id = ?').get(id) as PublicUser | undefined;
  }

  // ---------- campaigns ----------

  createCampaign(ownerId: string, name: string): StoredCampaign {
    const id = randomUUID();
    this.db.prepare('INSERT INTO campaigns (id, name, owner_id) VALUES (?, ?, ?)').run(id, name, ownerId);
    return { id, name, ownerId };
  }

  getCampaign(id: string): StoredCampaign | undefined {
    return this.db.prepare('SELECT id, name, owner_id AS ownerId FROM campaigns WHERE id = ?').get(id) as
      | StoredCampaign
      | undefined;
  }

  /** Campaigns this user runs as DM. */
  listCampaigns(ownerId: string): CampaignSummary[] {
    return this.db
      .prepare(
        `SELECT c.id, c.name, s.code AS liveCode, c.last_played_at AS lastPlayedAt
         FROM campaigns c LEFT JOIN live_sessions s ON s.campaign_id = c.id
         WHERE c.owner_id = ? ORDER BY coalesce(c.last_played_at, c.created_at) DESC`,
      )
      .all(ownerId) as unknown as CampaignSummary[];
  }

  // ---------- characters (owned by a player) ----------

  private toSummary(row: CharacterRow): CharacterSummary {
    return {
      id: row.id,
      data: normalizeCharacter(JSON.parse(row.data)),
      campaign: row.campaignId ? { id: row.campaignId, name: row.campaignName ?? '' } : null,
      inSession: row.inSession,
    };
  }

  private characterQuery = `
    SELECT ch.id, ch.user_id AS userId, ch.campaign_id AS campaignId, c.name AS campaignName,
           ch.data, sp.code AS inSession
    FROM characters ch
    LEFT JOIN campaigns c ON c.id = ch.campaign_id
    LEFT JOIN session_players sp ON sp.character_id = ch.id`;

  listCharacters(userId: string): CharacterSummary[] {
    return (
      this.db.prepare(`${this.characterQuery} WHERE ch.user_id = ? ORDER BY ch.created_at, ch.rowid`).all(userId) as unknown as CharacterRow[]
    ).map((r) => this.toSummary(r));
  }

  countCharacters(userId: string): number {
    return (this.db.prepare('SELECT count(*) AS n FROM characters WHERE user_id = ?').get(userId) as { n: number }).n;
  }

  getCharacter(id: string): (CharacterSummary & { userId: string }) | undefined {
    const row = this.db.prepare(`${this.characterQuery} WHERE ch.id = ?`).get(id) as unknown as CharacterRow | undefined;
    return row ? { ...this.toSummary(row), userId: row.userId } : undefined;
  }

  createCharacter(userId: string, name: string, initial: Partial<CharacterData> = {}): CharacterSummary {
    const id = randomUUID();
    const data: CharacterData = { ...structuredClone(DEFAULT_CHARACTER), ...initial, name };
    this.db.prepare('INSERT INTO characters (id, user_id, data) VALUES (?, ?, ?)').run(id, userId, JSON.stringify(data));
    return this.getCharacter(id)!;
  }

  deleteCharacter(id: string): void {
    this.db.prepare('DELETE FROM characters WHERE id = ?').run(id);
  }

  updateCharacter(id: string, patch: Partial<CharacterData>): CharacterSummary {
    const current = this.getCharacter(id);
    if (!current) throw new Error('That character no longer exists.');
    const next = { ...current.data, ...patch };
    this.db
      .prepare(`UPDATE characters SET data = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(JSON.stringify(next), id);
    return this.getCharacter(id)!;
  }

  /**
   * Rule for which characters may join a session: like Terraria worlds, any
   * character can join any campaign, but only one session at a time.
   */
  canJoinCampaign(c: CharacterSummary, _campaignId: string): boolean {
    return c.inSession === null;
  }

  // ---------- live sessions ----------

  /** Returns the open session for the campaign, or opens a new lobby with a fresh code. */
  startSession(campaignId: string): LiveSession {
    const existing = this.getSessionByCampaign(campaignId);
    this.db.prepare(`UPDATE campaigns SET last_played_at = datetime('now') WHERE id = ?`).run(campaignId);
    if (existing) return existing;
    for (let attempt = 0; attempt < 20; attempt++) {
      const code = generateRoomCode();
      const res = this.db
        .prepare('INSERT OR IGNORE INTO live_sessions (code, campaign_id) VALUES (?, ?)')
        .run(code, campaignId);
      if (res.changes === 1) return { code, campaignId, started: false, shown: null, combat: null, sessionNo: null };
    }
    throw new Error('Could not allocate a session code');
  }

  private sessionQuery = 'SELECT code, campaign_id AS campaignId, started, shown, combat, session_no AS sessionNo FROM live_sessions';
  private toSession = (
    r: { code: string; campaignId: string; started: number; shown: string | null; combat: string | null; sessionNo: number | null } | undefined,
  ): LiveSession | undefined =>
    r && {
      code: r.code,
      campaignId: r.campaignId,
      started: r.started === 1,
      shown: r.shown ? JSON.parse(r.shown) : null,
      combat: r.combat ? JSON.parse(r.combat) : null,
      sessionNo: r.sessionNo,
    };

  getSession(code: string): LiveSession | undefined {
    return this.toSession(this.db.prepare(`${this.sessionQuery} WHERE code = ?`).get(code) as never);
  }

  getSessionByCampaign(campaignId: string): LiveSession | undefined {
    return this.toSession(this.db.prepare(`${this.sessionQuery} WHERE campaign_id = ?`).get(campaignId) as never);
  }

  /** Starts the session and gives it the campaign's next session number. Returns the session. */
  markStarted(code: string): LiveSession | undefined {
    const live = this.getSession(code);
    if (!live) return undefined;
    const sessionNo = live.sessionNo ?? this.lastLoggedSession(live.campaignId) + 1;
    this.db.prepare('UPDATE live_sessions SET started = 1, session_no = ? WHERE code = ?').run(sessionNo, code);
    return { ...live, started: true, sessionNo };
  }

  endSession(code: string): void {
    this.db.prepare('DELETE FROM live_sessions WHERE code = ?').run(code);
  }

  /** Puts the player's character into the session and remembers the campaign as its last one. */
  addSessionPlayer(code: string, userId: string, characterId: string, campaignId: string): void {
    this.db.exec('BEGIN');
    try {
      this.db.prepare('UPDATE characters SET campaign_id = ? WHERE id = ?').run(campaignId, characterId);
      this.db
        .prepare('INSERT INTO session_players (code, user_id, character_id) VALUES (?, ?, ?)')
        .run(code, userId, characterId);
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  setReady(code: string, userId: string, ready: boolean): void {
    this.db.prepare('UPDATE session_players SET ready = ? WHERE code = ? AND user_id = ?').run(ready ? 1 : 0, code, userId);
  }

  removeSessionPlayer(code: string, userId: string): void {
    this.db.prepare('DELETE FROM session_players WHERE code = ? AND user_id = ?').run(code, userId);
  }

  sessionPlayers(code: string): { user: PublicUser; characterId: string; ready: boolean }[] {
    return (
      this.db
        .prepare(
          `SELECT u.id, u.username, p.character_id AS characterId, p.ready FROM session_players p
           JOIN users u ON u.id = p.user_id WHERE p.code = ? ORDER BY p.joined_at, p.rowid`,
        )
        .all(code) as { id: string; username: string; characterId: string; ready: number }[]
    ).map((r) => ({ user: { id: r.id, username: r.username }, characterId: r.characterId, ready: r.ready === 1 }));
  }

  close(): void {
    this.db.close();
  }
}
