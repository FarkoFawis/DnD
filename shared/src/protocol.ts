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
  /**
   * Update a character in the current session. Saved immediately.
   * Players edit their own; the DM may pass `userId` to edit any player's.
   */
  'character:update': (
    input: { patch: Partial<CharacterData>; userId?: string },
    ack: (res: Ack<{ character: CharacterData }>) => void,
  ) => void;
  /**
   * Damage (negative) or heal (positive) a character. Sent as a change, not a
   * new value, so a hit from the DM and a potion from the player never overwrite
   * each other. Same permissions as 'character:update'.
   */
  /** Give an item (DM to a player, or a player to themself). */
  'item:add': (
    input: { item: { name: string; qty?: number; notes?: string }; userId?: string },
    ack: (res: Ack<{ character: CharacterData }>) => void,
  ) => void;
  /** Change an item's quantity/name/notes. qty 0 removes it. */
  'item:update': (
    input: { itemId: string; patch: Partial<Omit<Item, 'id'>>; userId?: string },
    ack: (res: Ack<{ character: CharacterData }>) => void,
  ) => void;
  'item:remove': (
    input: { itemId: string; userId?: string },
    ack: (res: Ack<{ character: CharacterData }>) => void,
  ) => void;
  'character:adjustHp': (
    input: { delta: number; userId?: string },
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
  notesMaxLength: 5000,
  listMaxLength: 200,
} as const;
