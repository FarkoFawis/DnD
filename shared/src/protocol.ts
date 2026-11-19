/**
 * Contract shared by client and server.
 * Add new events here first, then implement them on both sides.
 *
 * Flow: log in over HTTP (/api/auth/*) -> get a token -> open the socket with
 * `auth: { token }` -> host a campaign session or join one with its code.
 */

// ---------- Accounts (HTTP) ----------

export interface PublicUser {
  id: string;
  username: string;
}

/** POST /api/auth/status { username } */
export interface AccountStatus {
  exists: boolean;
  /** false = pre-made account that still needs its owner to choose a password. */
  hasPassword: boolean;
}

/** POST /api/auth/login { username, password } -> LoginResult (200) or { error } (4xx) */
export interface LoginResult {
  token: string;
  user: PublicUser;
}

export const PASSWORD_MIN_LENGTH = 6;

// ---------- Characters ----------

/**
 * Raw inputs of a character sheet. Derived values (modifiers, PB, ...) are
 * computed with shared/rules.ts, never stored. Grows as the sheet grows.
 */
export interface CharacterData {
  name: string;
  className: string;
  species: string;
  level: number;
  hpCurrent: number;
  hpMax: number;
  hpTemp: number;
}

export const DEFAULT_CHARACTER: CharacterData = {
  name: '',
  className: '',
  species: '',
  level: 1,
  hpCurrent: 10,
  hpMax: 10,
  hpTemp: 0,
};

// ---------- Campaigns & live sessions (socket) ----------

export interface CampaignSummary {
  id: string;
  name: string;
  /** Code of the session currently running for this campaign, if any. */
  liveCode: string | null;
  lastPlayedAt: string | null;
}

export interface SessionPlayer {
  user: PublicUser;
  online: boolean;
  character: CharacterData;
}

export interface SessionState {
  code: string;
  campaign: { id: string; name: string };
  host: PublicUser & { online: boolean };
  players: SessionPlayer[];
}

export type Ack<T> = ({ ok: true } & T) | { ok: false; error: string };

export interface ClientToServerEvents {
  'campaign:list': (ack: (res: Ack<{ campaigns: CampaignSummary[] }>) => void) => void;
  'campaign:create': (
    input: { name: string },
    ack: (res: Ack<{ campaign: CampaignSummary }>) => void,
  ) => void;
  /** Start (or resume) the live session of a campaign you own. */
  'session:host': (
    input: { campaignId: string },
    ack: (res: Ack<{ session: SessionState }>) => void,
  ) => void;
  /** Join a live session by its code. Your character for that campaign is loaded. */
  'session:join': (input: { code: string }, ack: (res: Ack<{ session: SessionState }>) => void) => void;
  /** Player leaves the session (their character stays saved). */
  'session:leave': (ack: (res: Ack<object>) => void) => void;
  /** Host ends the session for everyone (all characters stay saved). */
  'session:end': (ack: (res: Ack<object>) => void) => void;
  /** Update your own character in the current session. Saved immediately. */
  'character:update': (
    input: { patch: Partial<CharacterData> },
    ack: (res: Ack<{ character: CharacterData }>) => void,
  ) => void;
}

export interface ServerToClientEvents {
  'session:state': (session: SessionState) => void;
  'session:ended': () => void;
}

export const LIMITS = {
  usernameMaxLength: 24,
  nameMaxLength: 40,
  campaignNameMaxLength: 60,
  textFieldMaxLength: 40,
} as const;
