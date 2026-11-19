import { describe, expect, it } from 'vitest';
import { generateRoomCode, normalizeRoomCode, ROOM_CODE_LENGTH } from './roomCode.ts';

describe('room codes', () => {
  it('generates codes that normalize to themselves', () => {
    for (let i = 0; i < 100; i++) {
      const code = generateRoomCode();
      expect(code).toHaveLength(ROOM_CODE_LENGTH);
      expect(normalizeRoomCode(code)).toBe(code);
    }
  });

  it('normalizes user input', () => {
    expect(normalizeRoomCode(' ab-cd e ')).toBe('ABCDE');
  });

  it('rejects ambiguous characters and wrong lengths', () => {
    expect(normalizeRoomCode('ABCD0')).toBeNull();
    expect(normalizeRoomCode('ABCD')).toBeNull();
    expect(normalizeRoomCode('ABCDEF')).toBeNull();
  });
});
