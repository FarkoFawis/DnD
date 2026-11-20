import { describe, expect, it } from 'vitest';
import { abilityModifier, applyHpChange, deriveStats, formatModifier, partyCheckName, partyCheckValue, proficiencyBonus, rankParty, type SheetInputs } from './rules.ts';

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

describe('applyHpChange', () => {
  const hp = { hpCurrent: 10, hpMax: 18, hpTemp: 3 };
  it('takes damage from temp HP first', () => {
    expect(applyHpChange(hp, -2)).toEqual({ hpCurrent: 10, hpTemp: 1 });
    expect(applyHpChange(hp, -5)).toEqual({ hpCurrent: 8, hpTemp: 0 });
  });
  it('never goes below 0', () => {
    expect(applyHpChange(hp, -50)).toEqual({ hpCurrent: 0, hpTemp: 0 });
  });
  it('heals up to max and keeps temp HP', () => {
    expect(applyHpChange(hp, 5)).toEqual({ hpCurrent: 15, hpTemp: 3 });
    expect(applyHpChange(hp, 50)).toEqual({ hpCurrent: 18, hpTemp: 3 });
  });
});

describe('deriveStats', () => {
  const wizard = {
    level: 5,
    abilities: { str: 8, dex: 14, con: 13, int: 17, wis: 12, cha: 10 },
    saveProficiencies: ['int', 'wis'] as const,
    skillProficiencies: ['arcana', 'perception'] as const,
    skillExpertise: ['arcana'] as const,
    initiativeBonus: 0,
    spellcastingAbility: 'int' as const,
  };
  const d = deriveStats({
    ...wizard,
    saveProficiencies: [...wizard.saveProficiencies],
    skillProficiencies: [...wizard.skillProficiencies],
    skillExpertise: [...wizard.skillExpertise],
  });
  it('computes modifiers, saves and skills', () => {
    expect(d.proficiencyBonus).toBe(3);
    expect(d.modifiers).toEqual({ str: -1, dex: 2, con: 1, int: 3, wis: 1, cha: 0 });
    expect(d.saves.int).toBe(6);
    expect(d.saves.str).toBe(-1);
    expect(d.skills.arcana).toBe(9); // expertise: 3 + 2*3
    expect(d.skills.perception).toBe(4);
    expect(d.skills.stealth).toBe(2);
  });
  it('computes initiative, passive perception and spellcasting', () => {
    expect(d.initiative).toBe(2);
    expect(d.passivePerception).toBe(14);
    expect(d.spellSaveDc).toBe(14);
    expect(d.spellAttack).toBe(6);
  });
  it('has no spell numbers for non-casters', () => {
    expect(deriveStats({ ...wizard, saveProficiencies: [], skillProficiencies: [], skillExpertise: [], spellcastingAbility: null }).spellSaveDc).toBeNull();
  });
});

describe('who is best at a check', () => {
  const sheet = (p: Partial<SheetInputs>): SheetInputs => ({
    level: 5,
    abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    saveProficiencies: [],
    skillProficiencies: [],
    skillExpertise: [],
    initiativeBonus: 0,
    spellcastingAbility: null,
    ...p,
  });
  const party = [
    { id: 'brom', sheet: sheet({ abilities: { str: 16, dex: 12, con: 14, int: 8, wis: 10, cha: 10 }, saveProficiencies: ['str', 'con'] }) },
    { id: 'elowen', sheet: sheet({ abilities: { str: 8, dex: 16, con: 12, int: 17, wis: 14, cha: 10 }, skillProficiencies: ['perception'], initiativeBonus: 3 }) },
    { id: 'tam', sheet: sheet({ abilities: { str: 10, dex: 16, con: 10, int: 10, wis: 12, cha: 14 }, skillProficiencies: ['stealth'], skillExpertise: ['stealth'] }) },
  ];

  it('names every kind of check', () => {
    expect(partyCheckName('skill:sleightOfHand')).toBe('Sleight of Hand');
    expect(partyCheckName('save:con')).toBe('Constitution save');
    expect(partyCheckName('passive:perception')).toBe('Passive Perception');
    expect(partyCheckName('initiative')).toBe('Initiative');
  });

  it('gives the bonus, or the score itself for a passive check', () => {
    expect(partyCheckValue(party[1]!.sheet, 'skill:perception')).toBe(5);
    expect(partyCheckValue(party[1]!.sheet, 'passive:perception')).toBe(15);
    expect(partyCheckValue(party[0]!.sheet, 'save:con')).toBe(5);
    expect(partyCheckValue(party[1]!.sheet, 'initiative')).toBe(6);
  });

  it('orders the party best first and says who is trained', () => {
    expect(rankParty(party, 'skill:stealth').map((r) => [r.id, r.value, r.best, r.trained, r.expert])).toEqual([
      ['tam', 9, true, true, true],
      ['elowen', 3, false, false, false],
      ['brom', 1, false, false, false],
    ]);
    expect(rankParty(party, 'save:str').map((r) => [r.id, r.value, r.trained])).toEqual([['brom', 6, true], ['tam', 0, false], ['elowen', -1, false]]);
    expect(rankParty(party, 'passive:perception')[0]).toMatchObject({ id: 'elowen', value: 15, trained: true });
  });

  it('marks everyone who shares the top value and keeps the table order among them', () => {
    const ranked = rankParty(party, 'skill:acrobatics');
    expect(ranked.map((r) => [r.id, r.best])).toEqual([['elowen', true], ['tam', true], ['brom', false]]);
    expect(rankParty([], 'initiative')).toEqual([]);
  });
});
