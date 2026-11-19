/**
 * Pure D&D 5e rules helpers. See CLAUDE.md Part 2 for the formulas.
 * Everything here must be deterministic and unit tested.
 */

export const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;
export type Ability = (typeof ABILITIES)[number];

/** floor((score - 10) / 2) */
export function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

/** +2 at levels 1-4, +3 at 5-8, +4 at 9-12, +5 at 13-16, +6 at 17-20. */
export function proficiencyBonus(level: number): number {
  const clamped = Math.min(20, Math.max(1, Math.floor(level)));
  return 2 + Math.floor((clamped - 1) / 4);
}

/** Formats a modifier for display: 3 -> "+3", -1 -> "-1". */
export function formatModifier(mod: number): string {
  return mod >= 0 ? `+${mod}` : `${mod}`;
}
