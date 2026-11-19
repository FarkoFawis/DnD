import { describe, expect, it } from 'vitest';
import { normalizeCharacter, sanitizeCharacterPatch } from './character.ts';
import { DEFAULT_CHARACTER } from './protocol.ts';

describe('sanitizeCharacterPatch', () => {
  it('keeps valid fields and drops unknown ones', () => {
    expect(sanitizeCharacterPatch({ name: ' Thorin ', level: 3, evil: true })).toEqual({ name: 'Thorin', level: 3 });
  });
  it('rejects bad values', () => {
    expect(() => sanitizeCharacterPatch({ level: 21 })).toThrow();
    expect(() => sanitizeCharacterPatch({ hpMax: 2.5 })).toThrow();
    expect(() => sanitizeCharacterPatch({ name: 5 })).toThrow();
    expect(() => sanitizeCharacterPatch(null)).toThrow();
  });
});

describe('normalizeCharacter', () => {
  it('fills defaults for missing fields', () => {
    expect(normalizeCharacter({ name: 'Mira' })).toEqual({ ...DEFAULT_CHARACTER, name: 'Mira' });
    expect(normalizeCharacter('garbage')).toEqual(DEFAULT_CHARACTER);
  });
});
