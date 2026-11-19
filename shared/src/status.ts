/**
 * Conditions, concentration and death saving throws (2024 rules). Pure and
 * tested (status.test.ts). The dice are rolled at the table; the app only
 * records the outcome and reminds people of the rule.
 */
import type { CharacterData } from './protocol.ts';
import { applyHpChange } from './rules.ts';

/** The 14 on/off conditions. Exhaustion is a level (CharacterData.exhaustion). */
export const CONDITIONS = [
  ['blinded', 'Blinded'],
  ['charmed', 'Charmed'],
  ['deafened', 'Deafened'],
  ['frightened', 'Frightened'],
  ['grappled', 'Grappled'],
  ['incapacitated', 'Incapacitated'],
  ['invisible', 'Invisible'],
  ['paralyzed', 'Paralyzed'],
  ['petrified', 'Petrified'],
  ['poisoned', 'Poisoned'],
  ['prone', 'Prone'],
  ['restrained', 'Restrained'],
  ['stunned', 'Stunned'],
  ['unconscious', 'Unconscious'],
] as const;

export const conditionName = (id: string) => CONDITIONS.find(([k]) => k === id)?.[1] ?? id;

/** Conditions that end concentration because they include Incapacitated. */
const INCAPACITATING = ['incapacitated', 'paralyzed', 'petrified', 'stunned', 'unconscious'];

/** Constitution save DC to keep concentrating after damage: 10 or half the damage, at most 30. */
export function concentrationDc(damage: number): number {
  return Math.min(30, Math.max(10, Math.floor(damage / 2)));
}

export const isDead = (c: Pick<CharacterData, 'deathSaves' | 'exhaustion'>) => c.deathSaves.failures >= 3 || c.exhaustion >= 6;
export const isStable = (c: Pick<CharacterData, 'deathSaves' | 'hpCurrent'>) =>
  c.hpCurrent === 0 && c.deathSaves.successes >= 3 && c.deathSaves.failures < 3;
/** At 0 HP and still rolling death saves. */
export const isDying = (c: Pick<CharacterData, 'deathSaves' | 'hpCurrent' | 'exhaustion'>) =>
  c.hpCurrent === 0 && !isDead(c) && !isStable(c);

const NO_SAVES = { successes: 0, failures: 0 };

/**
 * Damage (negative) or healing (positive), with everything that follows from it:
 * - dropping to 0 HP starts death saves and ends concentration; damage left
 *   over that is at least the HP maximum kills outright;
 * - damage while at 0 HP is a failed death save (and ends being stable);
 * - damage while concentrating asks for a Constitution save;
 * - healing from 0 HP clears the death saves.
 */
export function applyDamageOrHealing(c: CharacterData, delta: number): Partial<CharacterData> {
  const hp = applyHpChange(c, delta);
  const out: Partial<CharacterData> = { ...hp };
  if (delta > 0) {
    if (c.hpCurrent === 0 && hp.hpCurrent > 0) out.deathSaves = { ...NO_SAVES };
    return out;
  }
  if (delta === 0) return out;
  const damage = -delta;
  const toHp = damage - (c.hpTemp - hp.hpTemp);
  if (c.hpCurrent === 0) {
    if (toHp <= 0 || isDead(c)) return out;
    const failures = toHp >= c.hpMax ? 3 : Math.min(3, c.deathSaves.failures + 1);
    out.deathSaves = { successes: isStable(c) ? 0 : c.deathSaves.successes, failures };
    return out;
  }
  if (hp.hpCurrent === 0) {
    const leftover = toHp - c.hpCurrent;
    out.deathSaves = leftover >= c.hpMax ? { successes: 0, failures: 3 } : { ...NO_SAVES };
    if (c.concentration) out.concentration = null;
    return out;
  }
  if (c.concentration) out.concentration = { ...c.concentration, saveDc: concentrationDc(damage) };
  return out;
}

/** What else changes when the DM sets HP directly (character:update). */
export function afterHpSet(c: CharacterData, hpCurrent: number): Partial<CharacterData> {
  if (hpCurrent > 0 && c.hpCurrent === 0) return { deathSaves: { ...NO_SAVES } };
  if (hpCurrent === 0 && c.hpCurrent > 0) return { deathSaves: { ...NO_SAVES }, ...(c.concentration ? { concentration: null } : {}) };
  return {};
}

/** What else changes when conditions are set: an incapacitating one ends concentration. */
export function afterConditionsSet(c: CharacterData, conditions: string[]): Partial<CharacterData> {
  return c.concentration && conditions.some((x) => INCAPACITATING.includes(x)) ? { concentration: null } : {};
}

export type DeathSaveResult = 'nat1' | 'fail' | 'success' | 'nat20';

export const DEATH_SAVE_LABEL: Record<DeathSaveResult, string> = {
  nat1: 'rolled a 1 (two failures)',
  fail: 'failure',
  success: 'success',
  nat20: 'rolled a 20 (back up with 1 HP)',
};

/** Records one death saving throw. Throws when the character isn't rolling them. */
export function applyDeathSave(c: CharacterData, result: DeathSaveResult): Partial<CharacterData> {
  if (c.hpCurrent > 0) throw new Error('Death saves are only rolled at 0 HP.');
  if (isDead(c)) throw new Error('This character is dead.');
  if (isStable(c)) throw new Error('This character is stable and rolls no more death saves.');
  const { successes, failures } = c.deathSaves;
  switch (result) {
    case 'nat20':
      return { hpCurrent: 1, deathSaves: { ...NO_SAVES } };
    case 'success':
      return { deathSaves: { successes: Math.min(3, successes + 1), failures } };
    case 'fail':
      return { deathSaves: { successes, failures: Math.min(3, failures + 1) } };
    case 'nat1':
      return { deathSaves: { successes, failures: Math.min(3, failures + 2) } };
    default:
      throw new Error('Invalid death save.');
  }
}
