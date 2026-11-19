import { describe, expect, it } from 'vitest';
import { abilityModifier, formatModifier, proficiencyBonus } from './rules.ts';

describe('abilityModifier', () => {
  it.each([
    [1, -5], [8, -1], [9, -1], [10, 0], [11, 0], [12, 1], [15, 2], [20, 5], [30, 10],
  ])('score %i -> %i', (score, mod) => expect(abilityModifier(score)).toBe(mod));
});

describe('proficiencyBonus', () => {
  it.each([[1, 2], [4, 2], [5, 3], [8, 3], [9, 4], [13, 5], [17, 6], [20, 6]])(
    'level %i -> +%i',
    (level, pb) => expect(proficiencyBonus(level)).toBe(pb),
  );
});

describe('formatModifier', () => {
  it('signs values', () => {
    expect(formatModifier(3)).toBe('+3');
    expect(formatModifier(0)).toBe('+0');
    expect(formatModifier(-2)).toBe('-2');
  });
});
