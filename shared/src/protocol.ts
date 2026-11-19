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
import type { Combat, CombatAction } from './combat.ts';
import type { CampaignPrep, Handout, Npc } from './prep.ts';
import type { LogEntry } from './log.ts';
import type { UseRequest } from './resources.ts';
import type { DeathSaveResult } from './status.ts';
import type { DiceRoll, RollMode, RollRequest } from './dice.ts';
import type { LevelUpChoices } from './levelup.ts';

export interface Item {
  id: string;
  name: string;
  qty: number;
  notes: string;
  /** Id of the matching entry in the game content (SRD or a private pack), for its description. */
  ref?: string;
}

export interface Spell {
  id: string;
  name: string;
  /** 0 = cantrip */
  level: number;
  prepared: boolean;
  /** Id of the matching spell in the game content, for its description. */
  ref?: string;
  /** Text for a homebrew spell that isn't in any content pack. */
  description?: string;
}

/** A class feature, species trait or feat on the sheet. */
export interface CharacterFeature {
  id: string;
  name: string;
  /** Where it comes from, e.g. "Wizard 1", "Elf", "Origin feat". */
  source: string;
  /** Points into the content, see describeRef() in content/info.ts. */
  ref?: string;
  /** Text for a homebrew feature that isn't in any content pack. */
  description?: string;
}

/** A limited-use thing the player or DM adds by hand (a feat, a magic item, homebrew). */
export interface CustomResource {
  id: string;
  name: string;
  max: number;
  resetOn: 'short' | 'long';
}

/** The last thing a player used, shown to the DM next to their name. */
export interface LastAction {
  name: string;
  /** e.g. "3rd-level slot", "cantrip", "attack"; for a dice roll its total, "17". */
  detail?: string;
  /** A roll of the dice roller ("Stealth check" · "17"), not something that was used up. */
  roll?: boolean;
  /** ISO time. */
  at: string;
}

/** The spell a character is concentrating on. */
export interface Concentration {
  name: string;
  /** Spell ref in the content, for its description. */
  ref?: string;
  /** Set when the character took damage and still has to roll the Constitution save. */
  saveDc: number | null;
}

export interface DeathSaves {
  successes: number;
  failures: number;
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
  /** Lineage / ancestry / legacy, e.g. "High Elf". */
  subspecies: string;
  background: string;
  level: number;
  /**
   * Size of the class's Hit Die (6, 8, 10 or 12). 0 = look it up from the class
   * in the content (hitDieSize() in resources.ts); set for homebrew classes.
   */
  hitDie: number;
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
  features: CharacterFeature[];
  /** Changed through the item:* events, so DM and player edits never clash. */
  inventory: Item[];
  coins: Record<Coin, number>;
  /**
   * HP, items and coins belong to the DM. Players may change them on their own
   * character only while the DM has unlocked it for them.
   */
  hpItemsUnlocked: boolean;
  /**
   * The DM said this character has earned its next level. During a session the
   * player then levels up on their own phone; the flag clears when they have.
   */
  levelUpReady: boolean;
  /**
   * The DM called a Short Rest during a session: the player may now spend Hit
   * Dice on their own phone, until they say they are done (or HP is full, the
   * dice run out, a fight starts or a Long Rest follows).
   */
  resting: boolean;
  /**
   * How many of each limited thing are spent: spell slots ("slot1".."slot9",
   * "pact"), Hit Dice ("hitDice") and features (ids from limitedUses() in
   * resources.ts). Missing = 0.
   * Changed through character:use and rests, never sent as a whole.
   */
  used: Record<string, number>;
  /** Limited-use things added by hand. */
  customResources: CustomResource[];
  lastAction: LastAction | null;
  /** Condition ids (content: "prone", "poisoned", ...). Exhaustion is a level, below. */
  conditions: string[];
  /** Exhaustion level 0-6. */
  exhaustion: number;
  concentration: Concentration | null;
  /** Death saving throws, used while at 0 HP. 3 successes = stable, 3 failures = dead. */
  deathSaves: DeathSaves;
  /**
   * Version stamp of the uploaded portrait ("" = none, show the default).
   * The picture itself is at GET /api/portraits/<characterId>?v=<portrait>;
   * upload with PUT /api/characters/<id>/portrait (image body).
   */
  portrait: string;
  /** Feats, features, proficiencies, languages, anything else. */
  notes: string;
}

export const PORTRAIT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
/** Upload limit. The client shrinks pictures to about 400x600 first, far below this. */
export const PORTRAIT_MAX_BYTES = 400_000;

export const DEFAULT_CHARACTER: CharacterData = {
  name: '',
  className: '',
  subclass: '',
  species: '',
  subspecies: '',
  background: '',
  level: 1,
  hitDie: 0,
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
  features: [],
  inventory: [],
  coins: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
  hpItemsUnlocked: false,
  levelUpReady: false,
  resting: false,
  used: {},
  customResources: [],
  lastAction: null,
  conditions: [],
  exhaustion: 0,
  concentration: null,
  deathSaves: { successes: 0, failures: 0 },
  portrait: '',
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

/** Fields a player may only change while the DM has unlocked them (hpItemsUnlocked). */
export const DM_LOCKED_FIELDS = ['hpCurrent', 'hpTemp', 'coins', 'inventory'] as const satisfies readonly (keyof CharacterData)[];
/** Fields only the DM may ever change. */
export const DM_ONLY_FIELDS = ['hpItemsUnlocked', 'levelUpReady', 'resting', 'used', 'lastAction', 'conditions', 'exhaustion', 'concentration', 'deathSaves', 'portrait'] as const satisfies readonly (keyof CharacterData)[];

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
  /** The handout the DM is showing on everyone's screen right now, if any. */
  handout: (Handout & { /** Changes every time the DM shows one, so phones pop it up again. */ shownAt: number }) | null;
  /** The running fight, if any. Players get it without opponents' HP and AC. */
  combat: Combat | null;
}

/** Something that should grab everyone's attention for a moment. */
export interface SessionAlert {
  kind: 'fight';
}

/** What spending one Hit Die did. */
export interface HitDieSpent {
  /** Size of the die: 6, 8, 10 or 12. */
  die: number;
  roll: number;
  /** Constitution modifier. */
  modifier: number;
  healed: number;
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
    input: { characterId: string; item: { name: string; qty?: number; notes?: string; ref?: string } },
    ack: CharAck,
  ) => void;
  /** Change an item's quantity/name/notes. qty 0 removes it. */
  'item:update': (
    input: { characterId: string; itemId: string; patch: Partial<Omit<Item, 'id'>> },
    ack: CharAck,
  ) => void;
  'item:remove': (input: { characterId: string; itemId: string }, ack: CharAck) => void;
  /**
   * Cast a spell, use a limited feature or make an attack. Spends a slot or a use
   * (refused when none are left) and shows the DM what was used. Its owner may
   * always do this, in a session too; so may the DM.
   */
  'character:use': (input: { characterId: string; use: UseRequest }, ack: CharAck) => void;
  /** Concentration: "end" drops the spell, "kept" clears the pending save after a successful roll. Owner or DM. */
  'character:concentration': (input: { characterId: string; action: 'end' | 'kept' }, ack: CharAck) => void;
  /** Record a death saving throw at 0 HP (the die is rolled at the table). Owner or DM. */
  'character:deathSave': (input: { characterId: string; result: DeathSaveResult }, ack: CharAck) => void;
  /** Gain a level with the choices from the level-up wizard. The owner outside sessions, or the DM. */
  'character:levelUp': (input: { characterId: string; choices: Partial<LevelUpChoices> }, ack: CharAck) => void;
  /** DM (or the owner outside a session): give back one spent slot or use. */
  'character:restore': (input: { characterId: string; id: string }, ack: CharAck) => void;
  /** Short or Long Rest for one character: the DM in a session, or its owner outside one. */
  'character:rest': (input: { characterId: string; kind: 'short' | 'long' }, ack: CharAck) => void;
  /**
   * Hit Dice on a Short Rest. "spend" heals one die + Constitution modifier:
   * `roll` is the die the player threw at the table, without it the server
   * rolls. "done" ends the player's rest. Allowed for the DM, for the owner
   * outside sessions, and for the owner in a session while the DM's Short Rest
   * is open (CharacterData.resting).
   */
  'character:hitDice': (
    input: { characterId: string; action: 'spend' | 'done'; roll?: number },
    ack: (res: Ack<{ character: CharacterSummary; spent?: HitDieSpent }>) => void,
  ) => void;
  /**
   * The optional dice roller: the server rolls a check, save or attack with the
   * sheet's bonus and shows the DM the result. Owner or DM.
   */
  'character:roll': (
    input: { characterId: string; roll: RollRequest; mode?: RollMode },
    ack: (res: Ack<{ result: DiceRoll; character: CharacterSummary }>) => void,
  ) => void;

  // --- campaigns & sessions ---
  'campaign:list': (ack: (res: Ack<{ campaigns: CampaignSummary[] }>) => void) => void;
  'campaign:create': (
    input: { name: string },
    ack: (res: Ack<{ campaign: CampaignSummary }>) => void,
  ) => void;
  // --- campaign prep ("Configure"): only the campaign's DM, any time ---
  'prep:get': (input: { campaignId: string }, ack: (res: Ack<{ prep: CampaignPrep }>) => void) => void;
  /** Create (no id) or change (with id) a handout. Upload its picture first: POST /api/campaigns/:id/images. */
  'handout:save': (
    input: { campaignId: string; handout: Partial<Handout> },
    ack: (res: Ack<{ handout: Handout }>) => void,
  ) => void;
  'handout:delete': (input: { campaignId: string; handoutId: string }, ack: (res: Ack<object>) => void) => void;
  'npc:save': (input: { campaignId: string; npc: Partial<Npc> }, ack: (res: Ack<{ npc: Npc }>) => void) => void;
  'npc:delete': (input: { campaignId: string; npcId: string }, ack: (res: Ack<object>) => void) => void;

  /**
   * The campaign's session log, for its DM: the session running now (if started)
   * and the one before it, which the client turns into the "Last time on ..." recap.
   */
  'log:get': (
    input: { campaignId: string },
    ack: (res: Ack<{ current: LogEntry[]; previous: LogEntry[] }>) => void,
  ) => void;

  // --- DM, during a session ---
  /** Put a handout on every player's screen (null takes it away again). */
  'handout:show': (input: { handoutId: string | null }, ack: (res: Ack<object>) => void) => void;
  /**
   * "Initiate fight": alerts every phone and starts a fight with all players
   * plus the chosen NPCs (`count` copies each). Initiative is not rolled yet.
   */
  'combat:start': (
    input: { npcs: { npcId: string; count: number }[] },
    ack: (res: Ack<object>) => void,
  ) => void;
  /** Add NPCs, or players who joined late, to the running fight. */
  'combat:add': (
    input: { npcs?: { npcId: string; count: number }[]; characterIds?: string[] },
    ack: (res: Ack<object>) => void,
  ) => void;
  'combat:action': (input: CombatAction, ack: (res: Ack<object>) => void) => void;
  'combat:end': (ack: (res: Ack<object>) => void) => void;

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
  /** DM: the whole party takes a Short or Long Rest. */
  'session:rest': (input: { kind: 'short' | 'long' }, ack: (res: Ack<object>) => void) => void;
}

export interface ServerToClientEvents {
  'session:state': (session: SessionState) => void;
  'session:ended': () => void;
  'session:alert': (alert: SessionAlert) => void;
  /** A player used the dice roller. Sent to the DM only. */
  'session:roll': (roll: DiceRoll) => void;
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
