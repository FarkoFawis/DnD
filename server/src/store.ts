import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { generateRoomCode, type Role } from '@dnd/shared';

export interface StoredMember {
  id: string;
  roomCode: string;
  name: string;
  role: Role;
}

export interface StoredRoom {
  code: string;
  name: string;
}

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/**
 * Persistent room storage. Everything the session needs lives here, so a crash
 * of any phone (or a server restart) loses nothing.
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
      CREATE TABLE IF NOT EXISTS rooms (
        code        TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        created_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS members (
        id          TEXT PRIMARY KEY,
        room_code   TEXT NOT NULL REFERENCES rooms(code) ON DELETE CASCADE,
        name        TEXT NOT NULL,
        role        TEXT NOT NULL CHECK (role IN ('dm', 'player')),
        token_hash  TEXT NOT NULL,
        created_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS members_room ON members(room_code);
    `);
  }

  createRoom(name: string): StoredRoom {
    for (let attempt = 0; attempt < 20; attempt++) {
      const code = generateRoomCode();
      const res = this.db
        .prepare('INSERT OR IGNORE INTO rooms (code, name) VALUES (?, ?)')
        .run(code, name);
      if (res.changes === 1) return { code, name };
    }
    throw new Error('Could not allocate a room code');
  }

  getRoom(code: string): StoredRoom | undefined {
    return this.db.prepare('SELECT code, name FROM rooms WHERE code = ?').get(code) as
      | StoredRoom
      | undefined;
  }

  /** Returns the new member and its secret token (only ever returned once). */
  addMember(roomCode: string, name: string, role: Role): { member: StoredMember; token: string } {
    const id = randomUUID();
    const token = randomBytes(24).toString('base64url');
    this.db
      .prepare('INSERT INTO members (id, room_code, name, role, token_hash) VALUES (?, ?, ?, ?, ?)')
      .run(id, roomCode, name, role, hashToken(token));
    return { member: { id, roomCode, name, role }, token };
  }

  listMembers(roomCode: string): StoredMember[] {
    return this.db
      .prepare(
        `SELECT id, room_code AS roomCode, name, role FROM members
         WHERE room_code = ? ORDER BY role = 'dm' DESC, created_at, rowid`,
      )
      .all(roomCode) as unknown as StoredMember[];
  }

  isNameTaken(roomCode: string, name: string): boolean {
    return (
      this.db
        .prepare('SELECT 1 FROM members WHERE room_code = ? AND lower(name) = lower(?)')
        .get(roomCode, name) !== undefined
    );
  }

  /** Looks up a member by id and verifies its token. */
  authenticate(roomCode: string, memberId: string, token: string): StoredMember | undefined {
    const row = this.db
      .prepare(
        `SELECT id, room_code AS roomCode, name, role, token_hash AS tokenHash
         FROM members WHERE id = ? AND room_code = ?`,
      )
      .get(memberId, roomCode) as (StoredMember & { tokenHash: string }) | undefined;
    if (!row || row.tokenHash !== hashToken(token)) return undefined;
    const { tokenHash: _, ...member } = row;
    return member;
  }

  removeMember(memberId: string): void {
    this.db.prepare('DELETE FROM members WHERE id = ?').run(memberId);
  }

  close(): void {
    this.db.close();
  }
}
