/**
 * Pure D&D 5e (2024) rules helpers. See CLAUDE.md Part 2 for the formulas.
 * Everything here must be deterministic and unit tested.
 */
import { t } from './i18n.ts';

export const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;
export type Ability = (typeof ABILITIES)[number];

export const ABILITY_NAMES: Record<Ability, string> = {
  str: 'Strength',
  dex: 'Dexterity',
  con: 'Constitution',
  int: 'Intelligence',
  wis: 'Wisdom',
  cha: 'Charisma',
};

/** "STR", "DEX", ... in the language of this phone. */
export const abilityShort = (a: Ability): string => t(a.toUpperCase());

export const SKILLS = {
  acrobatics: { name: 'Acrobatics', ability: 'dex' },
  animalHandling: { name: 'Animal Handling', ability: 'wis' },
  arcana: { name: 'Arcana', ability: 'int' },
  athletics: { name: 'Athletics', ability: 'str' },
  deception: { name: 'Deception', ability: 'cha' },
  history: { name: 'History', ability: 'int' },
  insight: { name: 'Insight', ability: 'wis' },
  intimidation: { name: 'Intimidation', ability: 'cha' },
  investigation: { name: 'Investigation', ability: 'int' },
  medicine: { name: 'Medicine', ability: 'wis' },
  nature: { name: 'Nature', ability: 'int' },
  perception: { name: 'Perception', ability: 'wis' },
  performance: { name: 'Performance', ability: 'cha' },
  persuasion: { name: 'Persuasion', ability: 'cha' },
  religion: { name: 'Religion', ability: 'int' },
  sleightOfHand: { name: 'Sleight of Hand', ability: 'dex' },
  stealth: { name: 'Stealth', ability: 'dex' },
  survival: { name: 'Survival', ability: 'wis' },
} as const satisfies Record<string, { name: string; ability: Ability }>;
export type Skill = keyof typeof SKILLS;
export const SKILL_KEYS = Object.keys(SKILLS) as Skill[];

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

/**
 * Applies damage (negative) or healing (positive) to hit points.
 * Damage removes temporary HP first; HP never drops below 0 or heals above max.
 */
export function applyHpChange(
  hp: { hpCurrent: number; hpMax: number; hpTemp: number },
  delta: number,
): { hpCurrent: number; hpTemp: number } {
  if (delta >= 0) {
    return { hpCurrent: Math.min(hp.hpMax, Math.max(0, hp.hpCurrent) + delta), hpTemp: hp.hpTemp };
  }
  const damage = -delta;
  const fromTemp = Math.min(hp.hpTemp, damage);
  return {
    hpCurrent: Math.max(0, hp.hpCurrent - (damage - fromTemp)),
    hpTemp: hp.hpTemp - fromTemp,
  };
}

/** The inputs the derived numbers need (a subset of CharacterData). */
export interface SheetInputs {
  level: number;
  abilities: Record<Ability, number>;
  saveProficiencies: Ability[];
  skillProficiencies: Skill[];
  skillExpertise: Skill[];
  initiativeBonus: number;
  spellcastingAbility: Ability | null;
}

export interface DerivedStats {
  proficiencyBonus: number;
  modifiers: Record<Ability, number>;
  saves: Record<Ability, number>;
  skills: Record<Skill, number>;
  initiative: number;
  passivePerception: number;
  spellSaveDc: number | null;
  spellAttack: number | null;
}

/** Every number on the sheet that follows from the raw inputs. */
export function deriveStats(c: SheetInputs): DerivedStats {
  const pb = proficiencyBonus(c.level);
  const modifiers = Object.fromEntries(ABILITIES.map((a) => [a, abilityModifier(c.abilities[a])])) as Record<
    Ability,
    number
  >;
  const saves = Object.fromEntries(
    ABILITIES.map((a) => [a, modifiers[a] + (c.saveProficiencies.includes(a) ? pb : 0)]),
  ) as Record<Ability, number>;
  const skills = Object.fromEntries(
    SKILL_KEYS.map((s) => {
      const mult = c.skillExpertise.includes(s) ? 2 : c.skillProficiencies.includes(s) ? 1 : 0;
      return [s, modifiers[SKILLS[s].ability] + mult * pb];
    }),
  ) as Record<Skill, number>;
  const castMod = c.spellcastingAbility ? modifiers[c.spellcastingAbility] : null;
  return {
    proficiencyBonus: pb,
    modifiers,
    saves,
    skills,
    initiative: modifiers.dex + c.initiativeBonus,
    passivePerception: 10 + skills.perception,
    spellSaveDc: castMod === null ? null : 8 + pb + castMod,
    spellAttack: castMod === null ? null : pb + castMod,
  };
}

// ---------- "Who is best at this?" (the DM's party view) ----------

/** Something the DM asks the table for: a skill check, a saving throw or a passive score. */
export type PartyCheck = `skill:${Skill}` | `save:${Ability}` | `passive:${'perception' | 'insight' | 'investigation'}` | 'initiative';

export const PASSIVE_SKILLS = ['perception', 'insight', 'investigation'] as const satisfies readonly Skill[];

export function partyCheckName(check: PartyCheck): string {
  if (check === 'initiative') return t('Initiative');
  const [kind, key] = check.split(':') as [string, string];
  if (kind === 'save') return t('{name} save', { name: t(ABILITY_NAMES[key as Ability]) });
  if (kind === 'passive') return t('Passive {name}', { name: t(SKILLS[key as Skill].name) });
  return t(SKILLS[key as Skill].name);
}

/** A character's number for that check: the bonus, or the score itself for a passive one. */
export function partyCheckValue(c: SheetInputs, check: PartyCheck): number {
  const stats = deriveStats(c);
  if (check === 'initiative') return stats.initiative;
  const [kind, key] = check.split(':') as [string, string];
  if (kind === 'save') return stats.saves[key as Ability];
  if (kind === 'passive') return 10 + stats.skills[key as Skill];
  return stats.skills[key as Skill];
}

/**
 * The party ordered by who is best at a check, best first. `best` marks
 * everyone who shares the top value; `trained` says the number includes
 * proficiency (`expert`: twice).
 */
export function rankParty<T extends { sheet: SheetInputs }>(
  party: readonly T[],
  check: PartyCheck,
): (T & { value: number; best: boolean; trained: boolean; expert: boolean })[] {
  const [kind, key] = check.split(':') as [string, string | undefined];
  const ranked = party.map((p) => {
    const skill = kind === 'skill' || kind === 'passive' ? (key as Skill) : null;
    const expert = !!skill && p.sheet.skillExpertise.includes(skill);
    const trained = expert || (skill ? p.sheet.skillProficiencies.includes(skill) : kind === 'save' && p.sheet.saveProficiencies.includes(key as Ability));
    return { ...p, value: partyCheckValue(p.sheet, check), best: false, trained, expert };
  });
  // Stable: ties keep the order of the table.
  ranked.sort((a, b) => b.value - a.value);
  const top = ranked[0]?.value;
  return ranked.map((r) => ({ ...r, best: r.value === top }));
}
