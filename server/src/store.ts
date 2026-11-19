import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  DEFAULT_CHARACTER,
  generateRoomCode,
  normalizeCharacter,
  type CampaignSummary,
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
    `);
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
      if (res.changes === 1) return { code, campaignId, started: false };
    }
    throw new Error('Could not allocate a session code');
  }

  private sessionQuery = 'SELECT code, campaign_id AS campaignId, started FROM live_sessions';
  private toSession = (r: { code: string; campaignId: string; started: number } | undefined): LiveSession | undefined =>
    r && { code: r.code, campaignId: r.campaignId, started: r.started === 1 };

  getSession(code: string): LiveSession | undefined {
    return this.toSession(this.db.prepare(`${this.sessionQuery} WHERE code = ?`).get(code) as never);
  }

  private getSessionByCampaign(campaignId: string): LiveSession | undefined {
    return this.toSession(this.db.prepare(`${this.sessionQuery} WHERE campaign_id = ?`).get(campaignId) as never);
  }

  markStarted(code: string): void {
    this.db.prepare('UPDATE live_sessions SET started = 1 WHERE code = ?').run(code);
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
