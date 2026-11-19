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
      CREATE TABLE IF NOT EXISTS characters (
        campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
        user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        data        TEXT NOT NULL,
        updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (campaign_id, user_id)
      );
      CREATE TABLE IF NOT EXISTS live_sessions (
        code        TEXT PRIMARY KEY,
        campaign_id TEXT NOT NULL UNIQUE REFERENCES campaigns(id) ON DELETE CASCADE,
        started_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS session_players (
        code      TEXT NOT NULL REFERENCES live_sessions(code) ON DELETE CASCADE,
        user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        joined_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (code, user_id)
      );
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

  // ---------- live sessions ----------

  /** Returns the running session for the campaign, or starts one with a fresh code. */
  startSession(campaignId: string): LiveSession {
    const existing = this.db
      .prepare('SELECT code, campaign_id AS campaignId FROM live_sessions WHERE campaign_id = ?')
      .get(campaignId) as LiveSession | undefined;
    this.db.prepare(`UPDATE campaigns SET last_played_at = datetime('now') WHERE id = ?`).run(campaignId);
    if (existing) return existing;
    for (let attempt = 0; attempt < 20; attempt++) {
      const code = generateRoomCode();
      const res = this.db
        .prepare('INSERT OR IGNORE INTO live_sessions (code, campaign_id) VALUES (?, ?)')
        .run(code, campaignId);
      if (res.changes === 1) return { code, campaignId };
    }
    throw new Error('Could not allocate a session code');
  }

  getSession(code: string): LiveSession | undefined {
    return this.db
      .prepare('SELECT code, campaign_id AS campaignId FROM live_sessions WHERE code = ?')
      .get(code) as LiveSession | undefined;
  }

  endSession(code: string): void {
    this.db.prepare('DELETE FROM live_sessions WHERE code = ?').run(code);
  }

  addSessionPlayer(code: string, userId: string): void {
    this.db.prepare('INSERT OR IGNORE INTO session_players (code, user_id) VALUES (?, ?)').run(code, userId);
  }

  removeSessionPlayer(code: string, userId: string): void {
    this.db.prepare('DELETE FROM session_players WHERE code = ? AND user_id = ?').run(code, userId);
  }

  sessionPlayers(code: string): PublicUser[] {
    return this.db
      .prepare(
        `SELECT u.id, u.username FROM session_players p JOIN users u ON u.id = p.user_id
         WHERE p.code = ? ORDER BY p.joined_at, p.rowid`,
      )
      .all(code) as unknown as PublicUser[];
  }

  // ---------- characters (one per player per campaign) ----------

  /** Loads the character, creating a fresh one the first time a player joins a campaign. */
  getOrCreateCharacter(campaignId: string, user: PublicUser): CharacterData {
    const row = this.db
      .prepare('SELECT data FROM characters WHERE campaign_id = ? AND user_id = ?')
      .get(campaignId, user.id) as { data: string } | undefined;
    if (row) return normalizeCharacter(JSON.parse(row.data));
    const fresh: CharacterData = { ...structuredClone(DEFAULT_CHARACTER), name: user.username };
    this.db
      .prepare('INSERT INTO characters (campaign_id, user_id, data) VALUES (?, ?, ?)')
      .run(campaignId, user.id, JSON.stringify(fresh));
    return fresh;
  }

  updateCharacter(campaignId: string, user: PublicUser, patch: Partial<CharacterData>): CharacterData {
    const next = { ...this.getOrCreateCharacter(campaignId, user), ...patch };
    this.db
      .prepare(
        `UPDATE characters SET data = ?, updated_at = datetime('now') WHERE campaign_id = ? AND user_id = ?`,
      )
      .run(JSON.stringify(next), campaignId, user.id);
    return next;
  }

  close(): void {
    this.db.close();
  }
}
