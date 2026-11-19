import {
  COINS,
  DEFAULT_CHARACTER,
  LIMITS,
  type CharacterData,
  type CharacterFeature,
  type CustomResource,
  type LastAction,
  type Item,
  type Spell,
} from './protocol.ts';
import { ABILITIES, SKILL_KEYS, type Ability, type Skill } from './rules.ts';

class Invalid extends Error {}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function text(v: unknown, field: string, max: number = LIMITS.textFieldMaxLength): string {
  if (typeof v !== 'string' || v.length > max) throw new Invalid(`Invalid ${field}.`);
  return v.trim();
}

function int(v: unknown, field: string, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) throw new Invalid(`Invalid ${field}.`);
  return v;
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], field: string): T {
  if (typeof v !== 'string' || !allowed.includes(v as T)) throw new Invalid(`Invalid ${field}.`);
  return v as T;
}

function list<T>(v: unknown, field: string, each: (x: unknown) => T): T[] {
  if (!Array.isArray(v) || v.length > LIMITS.listMaxLength) throw new Invalid(`Invalid ${field}.`);
  return v.map(each);
}

const unique = <T,>(xs: T[]) => [...new Set(xs)];

export function sanitizeItem(v: unknown): Item {
  if (!isObj(v)) throw new Invalid('Invalid item.');
  const name = text(v.name, 'item name', 80);
  if (!name) throw new Invalid('An item needs a name.');
  return {
    id: text(v.id, 'item id', 64),
    name,
    qty: int(v.qty ?? 1, 'quantity', 0, 99999),
    notes: text(v.notes ?? '', 'item notes', 500),
    ...optionalRef(v.ref),
  };
}

function sanitizeSpell(v: unknown): Spell {
  if (!isObj(v)) throw new Invalid('Invalid spell.');
  return {
    id: text(v.id, 'spell id', 64),
    name: text(v.name, 'spell name', 80),
    level: int(v.level, 'spell level', 0, 9),
    prepared: v.prepared === true,
    ...optionalRef(v.ref),
    ...(v.description ? { description: text(v.description, 'spell description', 4000) } : {}),
  };
}

function optionalRef(v: unknown): { ref?: string } {
  return v === undefined || v === null || v === '' ? {} : { ref: text(v, 'reference', 160) };
}

function sanitizeFeature(v: unknown): CharacterFeature {
  if (!isObj(v)) throw new Invalid('Invalid feature.');
  const name = text(v.name, 'feature name', 80);
  if (!name) throw new Invalid('A feature needs a name.');
  return {
    id: text(v.id, 'feature id', 64),
    name,
    source: text(v.source ?? '', 'feature source', 80),
    ...optionalRef(v.ref),
    ...(v.description ? { description: text(v.description, 'feature description', 4000) } : {}),
  };
}

function sanitizeCustomResource(v: unknown): CustomResource {
  if (!isObj(v)) throw new Invalid('Invalid limited use.');
  const name = text(v.name, 'limited use name', 80);
  if (!name) throw new Invalid('A limited use needs a name.');
  return {
    id: text(v.id, 'limited use id', 64),
    name,
    max: int(v.max, 'number of uses', 1, 99),
    resetOn: oneOf(v.resetOn, ['short', 'long'] as const, 'rest'),
  };
}

function sanitizeLastAction(v: unknown): LastAction | null {
  if (v === null) return null;
  if (!isObj(v)) throw new Invalid('Invalid last action.');
  return {
    name: text(v.name, 'action name', 80),
    ...(v.detail ? { detail: text(v.detail, 'action detail', 80) } : {}),
    ...(v.roll === true ? { roll: true } : {}),
    at: text(v.at, 'action time', 40),
  };
}

type Field = keyof CharacterData;
const FIELDS: { [K in Field]: (v: unknown) => CharacterData[K] } = {
  name: (v) => text(v, 'name'),
  className: (v) => text(v, 'class'),
  subclass: (v) => text(v, 'subclass'),
  species: (v) => text(v, 'species'),
  subspecies: (v) => text(v, 'subspecies'),
  background: (v) => text(v, 'background'),
  level: (v) => int(v, 'level', 1, 20),
  hitDie: (v) => {
    if (v !== 0 && v !== 6 && v !== 8 && v !== 10 && v !== 12) throw new Invalid('A Hit Die is a d6, d8, d10 or d12.');
    return v;
  },
  hpCurrent: (v) => int(v, 'current HP', 0, 9999),
  hpMax: (v) => int(v, 'max HP', 1, 9999),
  hpTemp: (v) => int(v, 'temp HP', 0, 9999),
  armorClass: (v) => int(v, 'armor class', 0, 99),
  speed: (v) => int(v, 'speed', 0, 999),
  initiativeBonus: (v) => int(v, 'initiative bonus', -20, 20),
  abilities: (v) => {
    if (!isObj(v)) throw new Invalid('Invalid ability scores.');
    return Object.fromEntries(ABILITIES.map((a) => [a, int(v[a], `${a} score`, 1, 30)])) as Record<Ability, number>;
  },
  saveProficiencies: (v) => unique(list(v, 'saving throws', (x) => oneOf(x, ABILITIES, 'saving throw'))),
  skillProficiencies: (v) => unique(list(v, 'skills', (x) => oneOf<Skill>(x, SKILL_KEYS, 'skill'))),
  skillExpertise: (v) => unique(list(v, 'expertise', (x) => oneOf<Skill>(x, SKILL_KEYS, 'skill'))),
  spellcastingAbility: (v) => (v === null ? null : oneOf(v, ABILITIES, 'spellcasting ability')),
  spells: (v) => list(v, 'spells', sanitizeSpell),
  features: (v) => list(v, 'features', sanitizeFeature),
  inventory: (v) => list(v, 'inventory', sanitizeItem),
  coins: (v) => {
    if (!isObj(v)) throw new Invalid('Invalid coins.');
    return Object.fromEntries(COINS.map((c) => [c, int(v[c] ?? 0, c, 0, 9_999_999)])) as CharacterData['coins'];
  },
  hpItemsUnlocked: (v) => {
    if (typeof v !== 'boolean') throw new Invalid('Invalid unlock flag.');
    return v;
  },
  levelUpReady: (v) => {
    if (typeof v !== 'boolean') throw new Invalid('Invalid level-up flag.');
    return v;
  },
  resting: (v) => {
    if (typeof v !== 'boolean') throw new Invalid('Invalid rest flag.');
    return v;
  },
  used: (v) => {
    if (!isObj(v) || Object.keys(v).length > 100) throw new Invalid('Invalid uses.');
    const out: Record<string, number> = {};
    for (const [k, n] of Object.entries(v)) {
      if (k.length > 80) throw new Invalid('Invalid uses.');
      const count = int(n, 'uses', 0, 999);
      if (count > 0) out[k] = count;
    }
    return out;
  },
  customResources: (v) => list(v, 'limited uses', sanitizeCustomResource),
  lastAction: sanitizeLastAction,
  conditions: (v) => unique(list(v, 'conditions', (x) => text(x, 'condition', 40))).filter(Boolean),
  exhaustion: (v) => int(v, 'exhaustion', 0, 6),
  concentration: (v) => {
    if (v === null) return null;
    if (!isObj(v)) throw new Invalid('Invalid concentration.');
    return {
      name: text(v.name, 'spell name', 80),
      ...optionalRef(v.ref),
      saveDc: v.saveDc === null || v.saveDc === undefined ? null : int(v.saveDc, 'save DC', 10, 30),
    };
  },
  deathSaves: (v) => {
    if (!isObj(v)) throw new Invalid('Invalid death saves.');
    return { successes: int(v.successes, 'death save successes', 0, 3), failures: int(v.failures, 'death save failures', 0, 3) };
  },
  portrait: (v) => text(v, 'portrait', 40),
  notes: (v) => text(v, 'notes', LIMITS.notesMaxLength),
};

/**
 * Validates an untrusted partial update and returns only the clean fields.
 * Unknown keys are dropped; bad values throw. `inventory` is only accepted
 * with allowInventory (it normally changes through the item:* events).
 */
export function sanitizeCharacterPatch(
  patch: unknown,
  { allowInventory = false }: { allowInventory?: boolean } = {},
): Partial<CharacterData> {
  if (!isObj(patch)) throw new Invalid('Invalid character update.');
  const out: Partial<Record<Field, unknown>> = {};
  for (const key of Object.keys(FIELDS) as Field[]) {
    if (!(key in patch)) continue;
    if (key === 'inventory' && !allowInventory) throw new Invalid('Use the item actions to change items.');
    out[key] = FIELDS[key](patch[key]);
  }
  return out as Partial<CharacterData>;
}

/**
 * Merges stored data (possibly from an older version) onto the defaults.
 * A field that fails validation falls back to its default instead of losing the rest.
 */
export function normalizeCharacter(stored: unknown): CharacterData {
  const out = structuredClone(DEFAULT_CHARACTER) as unknown as Record<string, unknown>;
  if (!isObj(stored)) return out as unknown as CharacterData;
  for (const key of Object.keys(FIELDS) as Field[]) {
    if (!(key in stored)) continue;
    try {
      out[key] = FIELDS[key](stored[key]);
    } catch {
      /* keep default */
    }
  }
  return out as unknown as CharacterData;
}
