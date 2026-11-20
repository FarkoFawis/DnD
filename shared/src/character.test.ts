import { describe, expect, it } from 'vitest';
import { normalizeCharacter, sanitizeCharacterPatch } from './character.ts';
import { DEFAULT_CHARACTER } from './protocol.ts';

describe('sanitizeCharacterPatch', () => {
  it('keeps valid fields and drops unknown ones', () => {
    expect(sanitizeCharacterPatch({ name: ' Thorin ', level: 3, evil: true })).toEqual({ name: 'Thorin', level: 3 });
  });
  it('validates nested fields', () => {
    expect(
      sanitizeCharacterPatch({
        abilities: { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 },
        skillProficiencies: ['stealth', 'stealth', 'arcana'],
        spellcastingAbility: 'int',
        spells: [{ id: 'a', name: 'Fire Bolt', level: 0, prepared: true }],
        coins: { gp: 15 },
      }),
    ).toEqual({
      abilities: { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 },
      skillProficiencies: ['stealth', 'arcana'],
      spellcastingAbility: 'int',
      spells: [{ id: 'a', name: 'Fire Bolt', level: 0, prepared: true }],
      coins: { cp: 0, sp: 0, ep: 0, gp: 15, pp: 0 },
    });
  });
  it('rejects bad values', () => {
    expect(() => sanitizeCharacterPatch({ level: 21 })).toThrow();
    expect(() => sanitizeCharacterPatch({ hpMax: 2.5 })).toThrow();
    expect(() => sanitizeCharacterPatch({ name: 5 })).toThrow();
    expect(() => sanitizeCharacterPatch({ abilities: { str: 40 } })).toThrow();
    expect(() => sanitizeCharacterPatch({ skillProficiencies: ['flying'] })).toThrow();
    expect(() => sanitizeCharacterPatch(null)).toThrow();
  });
  it('only accepts inventory when allowed', () => {
    expect(() => sanitizeCharacterPatch({ inventory: [] })).toThrow();
    expect(sanitizeCharacterPatch({ inventory: [] }, { allowInventory: true })).toEqual({ inventory: [] });
  });

  it('keeps the kind of the last action only when it is one the phones know', () => {
    const at = '2026-11-20T20:00:00.000Z';
    expect(sanitizeCharacterPatch({ lastAction: { name: 'Fire Bolt', kind: 'spell', at } })).toEqual({ lastAction: { name: 'Fire Bolt', kind: 'spell', at } });
    expect(sanitizeCharacterPatch({ lastAction: { name: 'Fire Bolt', kind: 'explosion', at } })).toEqual({ lastAction: { name: 'Fire Bolt', at } });
  });
});

describe('normalizeCharacter', () => {
  it('fills defaults for missing fields (old saves keep working)', () => {
    expect(normalizeCharacter({ name: 'Mira', level: 2 })).toEqual({ ...DEFAULT_CHARACTER, name: 'Mira', level: 2 });
    expect(normalizeCharacter('garbage')).toEqual(DEFAULT_CHARACTER);
  });
  it('drops only the broken field', () => {
    expect(normalizeCharacter({ name: 'Mira', level: 99 })).toEqual({ ...DEFAULT_CHARACTER, name: 'Mira' });
  });
});
