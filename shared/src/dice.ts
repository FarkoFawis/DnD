/**
 * The optional dice roller: what a tap on a skill, save or attack rolls, and
 * how the result reads. Pure and tested (dice.test.ts); the server throws the
 * dice (`rollPlan` with its own random numbers) so the DM can trust the result.
 *
 * 2024 rules: a d20 Test is d20 + ability modifier (+ proficiency bonus when
 * proficient), minus 2 per Exhaustion level. Advantage / Disadvantage roll two
 * d20s and keep the higher / lower. A natural 20 on an attack is a critical
 * hit (the damage dice are rolled twice), a natural 1 always misses.
 */
import type { CharacterData } from './protocol.ts';
import type { Content } from './content/index.ts';
import { weaponAttacks } from './content/attacks.ts';
import { ABILITIES, ABILITY_NAMES, SKILLS, SKILL_KEYS, deriveStats, formatModifier, type Ability, type Skill } from './rules.ts';

export const ROLL_MODES = ['normal', 'advantage', 'disadvantage'] as const;
export type RollMode = (typeof ROLL_MODES)[number];

export type RollRequest =
  | { kind: 'ability'; ability: Ability }
  | { kind: 'save'; ability: Ability }
  | { kind: 'skill'; skill: Skill }
  | { kind: 'initiative' }
  | { kind: 'spellAttack' }
  /** Attack with a weapon from the inventory (item id). */
  | { kind: 'attack'; itemId: string }
  /** Its damage. `crit`: after a natural 20. `twoHanded`: a Versatile weapon in both hands. */
  | { kind: 'damage'; itemId: string; crit?: boolean; twoHanded?: boolean };

/** What will be rolled, before any die is thrown. */
export interface RollPlan {
  kind: RollRequest['kind'];
  /** "Stealth check", "Dexterity save", "Longsword attack", "Longsword damage". */
  label: string;
  count: number;
  sides: number;
  modifier: number;
  /** Where the modifier comes from, for the player: Dexterity +3, Proficiency +2, Exhaustion -2. */
  parts: { label: string; value: number }[];
  /** Damage type, e.g. "Slashing". */
  note?: string;
}

/** A thrown roll, as the player and the DM see it. */
export interface DiceRoll {
  id: string;
  /** ISO time. */
  at: string;
  characterId: string;
  /** The character's name. */
  who: string;
  kind: RollRequest['kind'];
  label: string;
  mode: RollMode;
  sides: number;
  /** Every die thrown. With Advantage or Disadvantage: both d20s. */
  rolls: number[];
  /** d20 rolls: the die that counts. Damage: the sum of the dice. */
  kept: number;
  modifier: number;
  total: number;
  /** The d20 that counts showed a 20 or a 1 (on an attack: critical hit / miss). */
  natural: 20 | 1 | null;
  note?: string;
}

const isD20 = (kind: RollRequest['kind']) => kind !== 'damage';

/** "1d8" -> { count: 1, sides: 8 }; null when it isn't simple dice (e.g. a blowgun's flat 1). */
export function parseDice(text: string): { count: number; sides: number } | null {
  const m = /^\s*(\d{1,2})d(\d{1,3})\s*$/i.exec(text);
  return m ? { count: Number(m[1]), sides: Number(m[2]) } : null;
}

/**
 * Works out what a tap rolls for this character. Throws an Error with a
 * friendly message when the request doesn't fit the sheet.
 */
export function planRoll(c: CharacterData, req: RollRequest, content: Content): RollPlan {
  const stats = deriveStats(c);
  const pb = stats.proficiencyBonus;
  const d20 = (label: string, parts: RollPlan['parts']): RollPlan => {
    const all = [...parts, { label: 'Exhaustion', value: -2 * c.exhaustion }].filter((p) => p.value !== 0);
    return { kind: req.kind, label, count: 1, sides: 20, modifier: all.reduce((n, p) => n + p.value, 0), parts: all };
  };
  const abilityPart = (a: Ability) => ({ label: ABILITY_NAMES[a], value: stats.modifiers[a] });
  const validAbility = (a: unknown): a is Ability => ABILITIES.includes(a as Ability);

  switch (req?.kind) {
    case 'ability':
      if (!validAbility(req.ability)) break;
      return d20(`${ABILITY_NAMES[req.ability]} check`, [abilityPart(req.ability)]);
    case 'save':
      if (!validAbility(req.ability)) break;
      return d20(`${ABILITY_NAMES[req.ability]} save`, [
        abilityPart(req.ability),
        { label: 'Proficiency', value: c.saveProficiencies.includes(req.ability) ? pb : 0 },
      ]);
    case 'skill': {
      if (!SKILL_KEYS.includes(req.skill)) break;
      const skill = SKILLS[req.skill];
      const expert = c.skillExpertise.includes(req.skill);
      const mult = expert ? 2 : c.skillProficiencies.includes(req.skill) ? 1 : 0;
      return d20(`${skill.name} check`, [abilityPart(skill.ability), { label: expert ? 'Expertise' : 'Proficiency', value: mult * pb }]);
    }
    case 'initiative':
      return d20('Initiative', [abilityPart('dex'), { label: 'Bonus', value: c.initiativeBonus }]);
    case 'spellAttack':
      if (!c.spellcastingAbility) throw new Error('This character casts no spells.');
      return d20('Spell attack', [abilityPart(c.spellcastingAbility), { label: 'Proficiency', value: pb }]);
    case 'attack':
    case 'damage': {
      const w = weaponAttacks(c, content).find((a) => a.itemId === req.itemId);
      if (!w) throw new Error('That weapon is not on your sheet.');
      if (req.kind === 'attack') {
        return d20(`${w.name} attack`, [abilityPart(w.ability), { label: 'Proficiency', value: w.proficient ? pb : 0 }]);
      }
      const dice = parseDice((req.twoHanded && w.versatileDice) || w.dice);
      const parts = [{ label: ABILITY_NAMES[w.ability], value: w.modifier }].filter((p) => p.value !== 0);
      return {
        kind: 'damage',
        label: `${w.name} ${req.crit ? 'critical damage' : 'damage'}`,
        // A weapon with flat damage (no dice) rolls nothing.
        count: dice ? dice.count * (req.crit ? 2 : 1) : 0,
        sides: dice?.sides ?? 0,
        modifier: w.modifier + (dice ? 0 : Number(w.dice) || 0),
        parts,
        note: w.damageType,
      };
    }
    default:
      break;
  }
  throw new Error('Nothing to roll.');
}

/** "1d8+3", "d20+5", "2d6". */
export function planFormula(p: Pick<RollPlan, 'count' | 'sides' | 'modifier'>): string {
  const dice = p.count > 0 ? `${p.count === 1 && p.sides === 20 ? '' : p.count}d${p.sides}` : '';
  if (!dice) return `${p.modifier}`;
  return p.modifier === 0 ? dice : `${dice}${formatModifier(p.modifier)}`;
}

/**
 * Throws the dice of a plan. `die(sides)` returns 1..sides. Advantage and
 * Disadvantage only matter for d20 rolls. Damage is never below 0.
 */
export function rollPlan(
  plan: RollPlan,
  mode: RollMode,
  die: (sides: number) => number,
): Pick<DiceRoll, 'kind' | 'label' | 'mode' | 'sides' | 'rolls' | 'kept' | 'modifier' | 'total' | 'natural' | 'note'> {
  const base = { kind: plan.kind, label: plan.label, sides: plan.sides, modifier: plan.modifier, ...(plan.note ? { note: plan.note } : {}) };
  if (!isD20(plan.kind)) {
    const rolls = Array.from({ length: plan.count }, () => die(plan.sides));
    const kept = rolls.reduce((a, b) => a + b, 0);
    return { ...base, mode: 'normal', rolls, kept, total: Math.max(0, kept + plan.modifier), natural: null };
  }
  const rolls = mode === 'normal' ? [die(20)] : [die(20), die(20)];
  const kept = mode === 'disadvantage' ? Math.min(...rolls) : Math.max(...rolls);
  return { ...base, mode, rolls, kept, total: kept + plan.modifier, natural: kept === 20 ? 20 : kept === 1 ? 1 : null };
}

export const MODE_LABEL: Record<RollMode, string> = { normal: 'Normal', advantage: 'Advantage', disadvantage: 'Disadvantage' };

/** How the total came about: "14 + 5", "14 and 9, keeps 14 + 5", "6 + 2 + 3". */
export function rollBreakdown(r: Pick<DiceRoll, 'kind' | 'rolls' | 'kept' | 'modifier'>): string {
  const mod = r.modifier === 0 ? '' : r.modifier > 0 ? ` + ${r.modifier}` : ` - ${-r.modifier}`;
  if (!isD20(r.kind)) return r.rolls.length > 0 ? `${r.rolls.join(' + ')}${mod}` : `${r.modifier}`;
  return r.rolls.length > 1 ? `${r.rolls.join(' and ')}, keeps ${r.kept}${mod}` : `${r.kept}${mod}`;
}

/** One line for the DM and the log: "Stealth check: 19 (14 + 5)". */
export function describeRoll(r: Pick<DiceRoll, 'kind' | 'label' | 'mode' | 'rolls' | 'kept' | 'modifier' | 'total' | 'natural' | 'note'>): string {
  const mode = r.mode === 'normal' ? '' : `, ${MODE_LABEL[r.mode].toLowerCase()}`;
  const natural = r.natural === null ? '' : r.kind === 'attack' || r.kind === 'spellAttack' ? (r.natural === 20 ? ', critical hit' : ', natural 1') : `, natural ${r.natural}`;
  const note = r.note ? ` ${r.note.toLowerCase()}` : '';
  return `${r.label}: ${r.total}${note} (${rollBreakdown(r)}${mode}${natural})`;
}
