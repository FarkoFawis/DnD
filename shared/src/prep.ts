/**
 * What a DM prepares for a campaign ahead of the session ("Configure"):
 * handouts to show on the players' phones, and NPCs / opponents.
 */
import { ABILITIES, abilityModifier, type Ability } from './rules.ts';
import { t } from './i18n.ts';

/** A picture and/or a piece of text the DM can put on every player's screen. */
export interface Handout {
  id: string;
  title: string;
  text: string;
  /** Path of an uploaded picture (see POST /api/campaigns/:id/images), or null. */
  imageUrl: string | null;
}

export type NpcRole = 'npc' | 'opponent';

export interface Npc {
  id: string;
  name: string;
  /** Opponents are listed first when the DM picks who is in a fight. */
  role: NpcRole;
  armorClass: number;
  hpMax: number;
  speed: number;
  abilities: Record<Ability, number>;
  /** Extra initiative on top of DEX. */
  initiativeBonus: number;
  /** Attacks, traits, actions: free text. */
  actions: string;
  /** How they talk and behave, what they want. */
  personality: string;
  notes: string;
}

export interface CampaignPrep {
  handouts: Handout[];
  npcs: Npc[];
}

export const DEFAULT_NPC: Omit<Npc, 'id'> = {
  name: '',
  role: 'opponent',
  armorClass: 10,
  hpMax: 10,
  speed: 30,
  abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
  initiativeBonus: 0,
  actions: '',
  personality: '',
  notes: '',
};

export const PREP_LIMITS = {
  titleMaxLength: 80,
  handoutTextMaxLength: 8000,
  npcTextMaxLength: 4000,
  handoutsPerCampaign: 200,
  npcsPerCampaign: 200,
  imageMaxBytes: 6 * 1024 * 1024,
} as const;

/** Uploaded pictures live under this path; the file name is a random id. */
export const IMAGE_URL_PATTERN = /^\/api\/images\/[0-9a-f-]{36}\.(jpg|png|webp|gif)$/;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function text(v: unknown, field: string, max: number): string {
  if (v === undefined || v === null) return '';
  if (typeof v !== 'string' || v.length > max) throw new Error(t('The {field} is too long.', { field }));
  return v.trim();
}

function int(v: unknown, field: string, min: number, max: number, fallback: number): number {
  if (v === undefined) return fallback;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
    throw new Error(t('The {field} must be a whole number from {min} to {max}.', { field, min, max }));
  }
  return v;
}

/** Validates a handout coming from a client. Throws an Error with a message for the user. */
export function sanitizeHandout(v: unknown): Omit<Handout, 'id'> {
  if (!isObj(v)) throw new Error(t('Invalid handout.'));
  const title = text(v.title, 'title', PREP_LIMITS.titleMaxLength);
  const body = text(v.text, 'text', PREP_LIMITS.handoutTextMaxLength);
  const imageUrl = v.imageUrl === null || v.imageUrl === undefined || v.imageUrl === '' ? null : v.imageUrl;
  if (imageUrl !== null && (typeof imageUrl !== 'string' || !IMAGE_URL_PATTERN.test(imageUrl))) {
    throw new Error(t('Invalid picture.'));
  }
  if (!title) throw new Error(t('Give the handout a title.'));
  if (!body && !imageUrl) throw new Error(t('Add a picture or some text.'));
  return { title, text: body, imageUrl };
}

export function sanitizeNpc(v: unknown): Omit<Npc, 'id'> {
  if (!isObj(v)) throw new Error(t('Invalid NPC.'));
  const name = text(v.name, 'name', PREP_LIMITS.titleMaxLength);
  if (!name) throw new Error(t('Give them a name.'));
  const raw = isObj(v.abilities) ? v.abilities : {};
  const abilities = Object.fromEntries(
    ABILITIES.map((a) => [a, int(raw[a], `${a.toUpperCase()} score`, 1, 30, 10)]),
  ) as Record<Ability, number>;
  return {
    name,
    role: v.role === 'npc' ? 'npc' : 'opponent',
    armorClass: int(v.armorClass, 'Armor Class', 0, 40, DEFAULT_NPC.armorClass),
    hpMax: int(v.hpMax, 'hit points', 1, 9999, DEFAULT_NPC.hpMax),
    speed: int(v.speed, 'speed', 0, 500, DEFAULT_NPC.speed),
    abilities,
    initiativeBonus: int(v.initiativeBonus, 'initiative bonus', -20, 20, 0),
    actions: text(v.actions, 'actions', PREP_LIMITS.npcTextMaxLength),
    personality: text(v.personality, 'personality', PREP_LIMITS.npcTextMaxLength),
    notes: text(v.notes, 'notes', PREP_LIMITS.npcTextMaxLength),
  };
}

/** Initiative modifier of an NPC: DEX modifier plus its extra bonus. */
export function npcInitiative(npc: Pick<Npc, 'abilities' | 'initiativeBonus'>): number {
  return abilityModifier(npc.abilities.dex) + npc.initiativeBonus;
}
