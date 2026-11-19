import { DEFAULT_CHARACTER, LIMITS, type CharacterData } from './protocol.ts';

const TEXT_FIELDS = ['name', 'className', 'species'] as const;
const INT_FIELDS = {
  level: [1, 20],
  hpCurrent: [-999, 9999],
  hpMax: [1, 9999],
  hpTemp: [0, 9999],
} as const;

/**
 * Validates an untrusted partial update and returns only the clean fields.
 * Unknown keys are dropped; bad values throw.
 */
export function sanitizeCharacterPatch(patch: unknown): Partial<CharacterData> {
  if (typeof patch !== 'object' || patch === null) throw new Error('Invalid character update.');
  const input = patch as Record<string, unknown>;
  const out: Partial<CharacterData> = {};
  for (const key of TEXT_FIELDS) {
    if (!(key in input)) continue;
    const v = input[key];
    if (typeof v !== 'string' || v.length > LIMITS.textFieldMaxLength) {
      throw new Error(`Invalid ${key}.`);
    }
    out[key] = v.trim();
  }
  for (const [key, [min, max]] of Object.entries(INT_FIELDS) as [keyof typeof INT_FIELDS, readonly [number, number]][]) {
    if (!(key in input)) continue;
    const v = input[key];
    if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
      throw new Error(`Invalid ${key}.`);
    }
    out[key] = v;
  }
  return out;
}

/** Merges stored data (possibly from an older version) onto the defaults. */
export function normalizeCharacter(stored: unknown): CharacterData {
  const base = { ...DEFAULT_CHARACTER };
  if (typeof stored !== 'object' || stored === null) return base;
  try {
    return { ...base, ...sanitizeCharacterPatch(stored) };
  } catch {
    return base;
  }
}
