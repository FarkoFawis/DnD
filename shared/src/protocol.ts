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

import type { Ability, Skill } from './rules.ts';

export interface Item {
  id: string;
  name: string;
  qty: number;
  notes: string;
}

export interface Spell {
  id: string;
  name: string;
  /** 0 = cantrip */
  level: number;
  prepared: boolean;
}

export const COINS = ['cp', 'sp', 'ep', 'gp', 'pp'] as const;
export type Coin = (typeof COINS)[number];

/**
 * Raw inputs of a 2024 character sheet. Derived values (modifiers, PB, saves,
 * skills, spell DC, ...) are computed with deriveStats() in rules.ts, never stored.
 */
export interface CharacterData {
  name: string;
  className: string;
  subclass: string;
  species: string;
  background: string;
  level: number;
  hpCurrent: number;
  hpMax: number;
  hpTemp: number;
  armorClass: number;
  speed: number;
  /** Extra initiative on top of DEX (e.g. Alert feat). */
  initiativeBonus: number;
  abilities: Record<Ability, number>;
  saveProficiencies: Ability[];
  skillProficiencies: Skill[];
  skillExpertise: Skill[];
  spellcastingAbility: Ability | null;
  spells: Spell[];
  /** Changed through the item:* events, so DM and player edits never clash. */
  inventory: Item[];
  coins: Record<Coin, number>;
  /** Feats, features, proficiencies, languages, anything else. */
  notes: string;
}

export const DEFAULT_CHARACTER: CharacterData = {
  name: '',
  className: '',
  subclass: '',
  species: '',
  background: '',
  level: 1,
  hpCurrent: 10,
  hpMax: 10,
  hpTemp: 0,
  armorClass: 10,
  speed: 30,
  initiativeBonus: 0,
  abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
  saveProficiencies: [],
  skillProficiencies: [],
  skillExpertise: [],
  spellcastingAbility: null,
  spells: [],
  inventory: [],
  coins: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
  notes: '',
};

// ---------- Player-owned characters ----------

export interface CharacterSummary {
  id: string;
  data: CharacterData;
  /** The campaign it last played in (null = never played). Any character can join any campaign. */
  campaign: { id: string; name: string } | null;
  /** Code of the live session the character is in right now, if any. */
  inSession: string | null;
}

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
  characterId: string;
  online: boolean;
  ready: boolean;
  character: CharacterData;
}

export interface SessionState {
  code: string;
  campaign: { id: string; name: string };
  host: PublicUser & { online: boolean };
  /** false = lobby (players ready up), true = the DM started the session. */
  started: boolean;
  players: SessionPlayer[];
}

export type Ack<T> = ({ ok: true } & T) | { ok: false; error: string };
type CharAck = (res: Ack<{ character: CharacterSummary }>) => void;

export interface ClientToServerEvents {
  // --- characters (outside sessions: own characters; in a started session: DM only) ---
  'character:list': (ack: (res: Ack<{ characters: CharacterSummary[] }>) => void) => void;
  /** New character. `data` (e.g. from the character creator) is validated like an update; inventory is allowed here. */
  'character:create': (input: { name: string; data?: Partial<CharacterData> }, ack: CharAck) => void;
  'character:delete': (input: { characterId: string }, ack: (res: Ack<object>) => void) => void;
  'character:update': (input: { characterId: string; patch: Partial<CharacterData> }, ack: CharAck) => void;
  /** Damage (negative) or heal (positive). Sent as a change so concurrent edits never overwrite each other. */
  'character:adjustHp': (input: { characterId: string; delta: number }, ack: CharAck) => void;
  'item:add': (
    input: { characterId: string; item: { name: string; qty?: number; notes?: string } },
    ack: CharAck,
  ) => void;
  /** Change an item's quantity/name/notes. qty 0 removes it. */
  'item:update': (
    input: { characterId: string; itemId: string; patch: Partial<Omit<Item, 'id'>> },
    ack: CharAck,
  ) => void;
  'item:remove': (input: { characterId: string; itemId: string }, ack: CharAck) => void;

  // --- campaigns & sessions ---
  'campaign:list': (ack: (res: Ack<{ campaigns: CampaignSummary[] }>) => void) => void;
  'campaign:create': (
    input: { name: string },
    ack: (res: Ack<{ campaign: CampaignSummary }>) => void,
  ) => void;
  /** Open (or resume) the lobby of a campaign you own. */
  'session:host': (
    input: { campaignId: string },
    ack: (res: Ack<{ session: SessionState }>) => void,
  ) => void;
  /** Look up a code before joining: which campaign, and which of your characters may join it. */
  'session:peek': (
    input: { code: string },
    ack: (
      res: Ack<{
        campaign: { id: string; name: string };
        /** You are the DM or already in this session: just join, no character choice needed. */
        rejoin: boolean;
        characters: CharacterSummary[];
      }>,
    ) => void,
  ) => void;
  /**
   * Join with one of your characters. Without characterId it only works if you
   * are already in that session (used to get back in after a reconnect).
   */
  'session:join': (
    input: { code: string; characterId?: string },
    ack: (res: Ack<{ session: SessionState }>) => void,
  ) => void;
  /** Player: ready up (or un-ready) in the lobby. */
  'session:ready': (input: { ready: boolean }, ack: (res: Ack<object>) => void) => void;
  /** DM: start the session. The client warns first if not everyone is ready. */
  'session:start': (ack: (res: Ack<object>) => void) => void;
  /** Player leaves the session (their character stays saved). */
  'session:leave': (ack: (res: Ack<object>) => void) => void;
  /** DM ends the session for everyone (all characters stay saved). */
  'session:end': (ack: (res: Ack<object>) => void) => void;
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
  notesMaxLength: 5000,
  listMaxLength: 200,
  charactersPerUser: 50,
} as const;
