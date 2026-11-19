import { describe, expect, it } from 'vitest';
import { Content } from './content/index.ts';
import { SRD } from './content/srd.ts';
import { describeRoll, parseDice, planFormula, planRoll, rollBreakdown, rollPlan } from './dice.ts';
import { DEFAULT_CHARACTER, type CharacterData } from './protocol.ts';

const content = new Content([SRD]);
const char = (p: Partial<CharacterData>): CharacterData => ({ ...structuredClone(DEFAULT_CHARACTER), ...p });
/** Dice that come up as listed, in order. */
const dice = (...values: number[]) => () => values.shift()!;

const hero = char({
  name: 'Alba',
  className: 'Fighter',
  level: 5,
  abilities: { str: 16, dex: 14, con: 14, int: 10, wis: 12, cha: 8 },
  saveProficiencies: ['str', 'con'],
  skillProficiencies: ['athletics', 'perception'],
  skillExpertise: ['athletics'],
  inventory: [
    { id: 'sword', name: 'Longsword', qty: 1, notes: '', ref: 'longsword' },
    { id: 'rope', name: 'Rope', qty: 1, notes: '' },
  ],
});

describe('what a tap rolls', () => {
  it('skills add the ability modifier and the proficiency bonus (twice with Expertise)', () => {
    expect(planRoll(hero, { kind: 'skill', skill: 'stealth' }, content)).toMatchObject({ label: 'Stealth check', modifier: 2, sides: 20 });
    expect(planRoll(hero, { kind: 'skill', skill: 'perception' }, content).modifier).toBe(1 + 3);
    const athletics = planRoll(hero, { kind: 'skill', skill: 'athletics' }, content);
    expect(athletics.modifier).toBe(3 + 6);
    expect(athletics.parts).toEqual([{ label: 'Strength', value: 3 }, { label: 'Expertise', value: 6 }]);
  });
  it('saves add proficiency only when proficient; ability checks never do', () => {
    expect(planRoll(hero, { kind: 'save', ability: 'con' }, content)).toMatchObject({ label: 'Constitution save', modifier: 5 });
    expect(planRoll(hero, { kind: 'save', ability: 'dex' }, content).modifier).toBe(2);
    expect(planRoll(hero, { kind: 'ability', ability: 'str' }, content)).toMatchObject({ label: 'Strength check', modifier: 3 });
  });
  it('initiative is Dexterity plus the extra bonus', () => {
    expect(planRoll(char({ ...hero, initiativeBonus: 3 }), { kind: 'initiative' }, content).modifier).toBe(5);
  });
  it('Exhaustion takes 2 per level off every d20 roll, but not off damage', () => {
    const tired = char({ ...hero, exhaustion: 2 });
    const plan = planRoll(tired, { kind: 'skill', skill: 'stealth' }, content);
    expect(plan.modifier).toBe(2 - 4);
    expect(plan.parts).toContainEqual({ label: 'Exhaustion', value: -4 });
    expect(planRoll(tired, { kind: 'damage', itemId: 'sword' }, content).modifier).toBe(3);
  });
  it('a weapon attack uses the same bonus as the sheet, its damage the weapon dice', () => {
    expect(planRoll(hero, { kind: 'attack', itemId: 'sword' }, content)).toMatchObject({ label: 'Longsword attack', modifier: 6 });
    const damage = planRoll(hero, { kind: 'damage', itemId: 'sword' }, content);
    expect(damage).toMatchObject({ label: 'Longsword damage', count: 1, sides: 8, modifier: 3, note: 'Slashing' });
    expect(planFormula(damage)).toBe('1d8+3');
    expect(planFormula(planRoll(hero, { kind: 'damage', itemId: 'sword', twoHanded: true }, content))).toBe('1d10+3');
    expect(planFormula(planRoll(hero, { kind: 'damage', itemId: 'sword', crit: true }, content))).toBe('2d8+3');
  });
  it('spell attacks need a spellcasting ability', () => {
    expect(() => planRoll(hero, { kind: 'spellAttack' }, content)).toThrow(/casts no spells/);
    expect(planRoll(char({ ...hero, spellcastingAbility: 'wis' }), { kind: 'spellAttack' }, content).modifier).toBe(1 + 3);
  });
  it('refuses what is not on the sheet', () => {
    expect(() => planRoll(hero, { kind: 'attack', itemId: 'rope' }, content)).toThrow(/not on your sheet/);
    expect(() => planRoll(hero, { kind: 'skill', skill: 'juggling' as never }, content)).toThrow(/Nothing to roll/);
    expect(() => planRoll(hero, undefined as never, content)).toThrow(/Nothing to roll/);
  });
});

describe('throwing the dice', () => {
  const stealth = planRoll(hero, { kind: 'skill', skill: 'stealth' }, content);
  it('a normal roll is one d20 plus the modifier', () => {
    expect(rollPlan(stealth, 'normal', dice(14))).toMatchObject({ rolls: [14], kept: 14, total: 16, natural: null });
  });
  it('Advantage keeps the higher of two, Disadvantage the lower', () => {
    expect(rollPlan(stealth, 'advantage', dice(7, 15))).toMatchObject({ rolls: [7, 15], kept: 15, total: 17 });
    expect(rollPlan(stealth, 'disadvantage', dice(7, 15))).toMatchObject({ rolls: [7, 15], kept: 7, total: 9 });
  });
  it('marks a natural 20 and a natural 1 of the die that counts', () => {
    expect(rollPlan(stealth, 'normal', dice(20)).natural).toBe(20);
    expect(rollPlan(stealth, 'advantage', dice(1, 12)).natural).toBeNull();
    expect(rollPlan(stealth, 'disadvantage', dice(1, 20)).natural).toBe(1);
  });
  it('damage adds up all dice and ignores Advantage', () => {
    const crit = planRoll(hero, { kind: 'damage', itemId: 'sword', crit: true }, content);
    expect(rollPlan(crit, 'advantage', dice(6, 2))).toMatchObject({ mode: 'normal', rolls: [6, 2], kept: 8, total: 11, note: 'Slashing' });
  });
  it('damage never goes below 0', () => {
    const weak = char({ ...hero, abilities: { ...hero.abilities, str: 1 } });
    expect(rollPlan(planRoll(weak, { kind: 'damage', itemId: 'sword' }, content), 'normal', dice(1)).total).toBe(0);
  });
});

describe('reading a roll', () => {
  const attack = planRoll(hero, { kind: 'attack', itemId: 'sword' }, content);
  it('shows how the total came about', () => {
    expect(rollBreakdown(rollPlan(attack, 'normal', dice(13)))).toBe('13 + 6');
    expect(rollBreakdown(rollPlan(attack, 'advantage', dice(13, 4)))).toBe('13 and 4, keeps 13 + 6');
    expect(rollBreakdown(rollPlan(planRoll(char({ ...hero, exhaustion: 3 }), { kind: 'ability', ability: 'cha' }, content), 'normal', dice(10)))).toBe('10 - 7');
  });
  it('gives the DM one line', () => {
    expect(describeRoll(rollPlan(attack, 'normal', dice(20)))).toBe('Longsword attack: 26 (20 + 6, critical hit)');
    expect(describeRoll(rollPlan(attack, 'disadvantage', dice(9, 3)))).toBe('Longsword attack: 9 (9 and 3, keeps 3 + 6, disadvantage)');
    expect(describeRoll(rollPlan(planRoll(hero, { kind: 'damage', itemId: 'sword' }, content), 'normal', dice(5)))).toBe('Longsword damage: 8 slashing (5 + 3)');
  });
  it('reads dice text', () => {
    expect(parseDice('2d6')).toEqual({ count: 2, sides: 6 });
    expect(parseDice('1')).toBeNull();
  });
});
