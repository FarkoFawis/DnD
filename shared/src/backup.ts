/**
 * Campaign backup: one JSON file with everything a campaign needs to be put
 * back after the database is lost: its handouts (pictures included), NPCs, the
 * session log and the characters that last played in it (portraits included).
 *
 * The DM saves it from Configure → Backup and loads it from Play → Host.
 * A file comes from outside, so parseBackup() checks every part of it like any
 * other input; the server writes only what comes out of here.
 */
import { normalizeCharacter } from './character.ts';
import { LOG_KINDS, type LogEvent, type LogKind } from './log.ts';
import { PREP_LIMITS, sanitizeHandout, sanitizeNpc, type Handout, type Npc } from './prep.ts';
import { LIMITS, PORTRAIT_MAX_BYTES, PORTRAIT_TYPES, type CharacterData } from './protocol.ts';

export const BACKUP_FORMAT = 'dnd-campaign-backup';
export const BACKUP_VERSION = 1;

/** A picture inside the file. */
export interface BackupImage {
  mime: string;
  /** base64 */
  data: string;
}

export interface BackupHandout extends Omit<Handout, 'id' | 'imageUrl'> {
  image?: BackupImage;
}

export interface BackupCharacter {
  /** Kept on import, so loading the same file twice doesn't double the characters. */
  id: string;
  /** Username of the player it belongs to. */
  owner: string;
  data: CharacterData;
  portrait?: BackupImage;
}

export interface BackupLogEntry extends LogEvent {
  session: number;
  /** SQLite UTC timestamp, "2026-11-19 21:03:47". */
  at: string;
}

export interface CampaignBackup {
  format: typeof BACKUP_FORMAT;
  version: number;
  /** ISO time. */
  exportedAt: string;
  campaign: { id: string; name: string };
  handouts: BackupHandout[];
  npcs: Omit<Npc, 'id'>[];
  log: BackupLogEntry[];
  characters: BackupCharacter[];
}

/** What loading a backup did, for the DM. */
export interface ImportSummary {
  campaign: { id: string; name: string };
  handouts: number;
  npcs: number;
  /** Sessions with a log. */
  sessions: number;
  /** "Alba (Mira)" */
  characters: string[];
  /** Characters that are still in the database; left exactly as they are. */
  existing: string[];
  /** Characters left out because their player has no account here. */
  withoutAccount: string[];
  /** Entries of the file that were unreadable and left out. */
  skipped: number;
}

export const BACKUP_LIMITS = {
  /** Upload limit for a backup file. Pictures make up nearly all of it. */
  maxBytes: 200 * 1024 * 1024,
  characters: 100,
  logEntries: 50_000,
} as const;

export const HANDOUT_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
const ID = /^[0-9a-zA-Z-]{8,64}$/;
const LOG_TIME = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
/** Any valid picture URL: sanitizeHandout only needs to know that there is a picture. */
const SOME_IMAGE = '/api/images/00000000-0000-0000-0000-000000000000.jpg';

function image(v: unknown, types: readonly string[], maxBytes: number): BackupImage | undefined {
  if (!isObj(v) || typeof v.mime !== 'string' || typeof v.data !== 'string') return undefined;
  if (!types.includes(v.mime) || v.data.length === 0 || v.data.length > Math.ceil(maxBytes / 3) * 4 + 4) return undefined;
  return BASE64.test(v.data) ? { mime: v.mime, data: v.data } : undefined;
}

const list = (v: unknown, max: number): unknown[] => (Array.isArray(v) ? v.slice(0, max) : []);

/**
 * Checks a backup file and returns only what is valid. Entries that can't be
 * read are left out and counted, so one broken handout doesn't cost the rest.
 * Throws an Error with a message for the DM when the file isn't a backup at all.
 */
export function parseBackup(raw: unknown): { backup: CampaignBackup; skipped: number } {
  if (!isObj(raw) || raw.format !== BACKUP_FORMAT) throw new Error('That file is not a campaign backup.');
  if (raw.version !== BACKUP_VERSION) throw new Error('That backup was made by a newer version of the app. Update the app first.');
  const c = isObj(raw.campaign) ? raw.campaign : {};
  const name = typeof c.name === 'string' ? c.name.trim().replace(/\s+/g, ' ').slice(0, LIMITS.campaignNameMaxLength) : '';
  if (!name) throw new Error('That backup has no campaign name.');
  let skipped = 0;
  const each = <T,>(items: unknown[], read: (v: unknown) => T | undefined): T[] =>
    items.flatMap((v) => {
      try {
        const out = read(v);
        if (out !== undefined) return [out];
      } catch {
        /* counted below */
      }
      skipped += 1;
      return [];
    });

  const handouts = each(list(raw.handouts, PREP_LIMITS.handoutsPerCampaign), (v): BackupHandout | undefined => {
    if (!isObj(v)) return undefined;
    const img = image(v.image, HANDOUT_IMAGE_TYPES, PREP_LIMITS.imageMaxBytes);
    const h = sanitizeHandout({ title: v.title, text: v.text, imageUrl: img ? SOME_IMAGE : null });
    return { title: h.title, text: h.text, ...(img ? { image: img } : {}) };
  });
  const npcs = each(list(raw.npcs, PREP_LIMITS.npcsPerCampaign), sanitizeNpc);
  const log = each(list(raw.log, BACKUP_LIMITS.logEntries), (v): BackupLogEntry | undefined => {
    if (!isObj(v) || !LOG_KINDS.includes(v.kind as LogKind)) return undefined;
    if (typeof v.session !== 'number' || !Number.isInteger(v.session) || v.session < 1 || v.session > 100_000) return undefined;
    if (typeof v.at !== 'string' || !LOG_TIME.test(v.at)) return undefined;
    return {
      session: v.session,
      at: v.at,
      kind: v.kind as LogKind,
      who: typeof v.who === 'string' ? v.who.slice(0, 120) : '',
      ...(typeof v.amount === 'number' && Number.isInteger(v.amount) ? { amount: v.amount } : {}),
      ...(typeof v.what === 'string' ? { what: v.what.slice(0, 400) } : {}),
    };
  });
  const seen = new Set<string>();
  const characters = each(list(raw.characters, BACKUP_LIMITS.characters), (v): BackupCharacter | undefined => {
    if (!isObj(v) || typeof v.id !== 'string' || !ID.test(v.id) || seen.has(v.id)) return undefined;
    const owner = typeof v.owner === 'string' ? v.owner.trim() : '';
    if (!owner || owner.length > LIMITS.usernameMaxLength || !isObj(v.data)) return undefined;
    const data = normalizeCharacter(v.data);
    if (!data.name) return undefined;
    seen.add(v.id);
    const portrait = image(v.portrait, PORTRAIT_TYPES, PORTRAIT_MAX_BYTES);
    // What belongs to a running session doesn't come back with the character.
    return { id: v.id, owner, data: { ...data, lastAction: null, resting: false, portrait: '' }, ...(portrait ? { portrait } : {}) };
  });

  return {
    backup: {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: typeof raw.exportedAt === 'string' ? raw.exportedAt.slice(0, 40) : '',
      campaign: { id: typeof c.id === 'string' && ID.test(c.id) ? c.id : '', name },
      handouts,
      npcs,
      log,
      characters,
    },
    skipped,
  };
}

/** "lost-mine-2026-11-19.dnd-backup.json" */
export function backupFileName(campaignName: string, date: Date): string {
  const slug = campaignName.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'campaign';
  return `${slug}-${date.toISOString().slice(0, 10)}.dnd-backup.json`;
}
