import { describe, expect, it } from 'vitest';
import { Content } from './content/index.ts';
import { SRD } from './content/srd.ts';
import { DEFAULT_CHARACTER, type CharacterData } from './protocol.ts';
import { applyLevelUp, emptyLevelUp, featLevels, hpGain, levelUpPlan, levelUpSpellOptions } from './levelup.ts';

const content = new Content([SRD]);
let n = 0;
const newId = () => `id${++n}`;
const char = (p: Partial<CharacterData>): CharacterData => ({ ...structuredClone(DEFAULT_CHARACTER), ...p });

describe('level-up plan', () => {
  it('lists what the level brings and only the steps it needs', () => {
    const f = levelUpPlan(char({ className: 'Fighter', level: 1 }), content)!;
    expect(f.newLevel).toBe(2);
    expect(f.features.map((x) => x.name)).toContain('Action Surge');
    expect(f.steps).toEqual(['overview', 'hp', 'review']);
    const w3 = levelUpPlan(char({ className: 'Wizard', level: 2 }), content)!;
    expect(w3.needsSubclass).toBe(true);
    expect(w3.steps).toEqual(['overview', 'hp', 'subclass', 'spells', 'review']);
    expect(w3.spells).toMatchObject({ newPrepared: 1, maxLevel: 2 });
    const w4 = levelUpPlan(char({ className: 'Wizard', subclass: 'Evoker', level: 3 }), content)!;
    expect(w4.feat).toBe('general');
    expect(w4.spells).toMatchObject({ newCantrips: 1, newPrepared: 1 });
    expect(levelUpPlan(char({ className: 'Wizard', level: 20 }), content)).toBeNull();
    expect(levelUpPlan(char({ className: 'Rogue', subclass: 'Thief', level: 18 }), content)!.feat).toBe('epic-boon');
    expect(featLevels('fighter')).toContain(6);
  });
});

describe('applying a level-up', () => {
  it('adds HP (fixed or rolled), features and the new level', () => {
    const c = char({ className: 'Fighter', level: 1, hpMax: 12, hpCurrent: 7, abilities: { ...DEFAULT_CHARACTER.abilities, con: 14 } });
    const fixed = applyLevelUp(c, emptyLevelUp(), content, newId);
    expect(fixed).toMatchObject({ level: 2, hpMax: 20, hpCurrent: 15 });
    expect(fixed.features!.map((f) => f.name)).toEqual(['Action Surge', 'Tactical Mind']);
    expect(applyLevelUp(c, { ...emptyLevelUp(), hpRoll: 10 }, content, newId).hpMax).toBe(24);
    expect(() => applyLevelUp(c, { ...emptyLevelUp(), hpRoll: 11 }, content, newId)).toThrow(/d10/);
  });

  it('picks a subclass at level 3 and gets its features', () => {
    const c = char({ className: 'Fighter', level: 2 });
    expect(() => applyLevelUp(c, emptyLevelUp(), content, newId)).toThrow(/subclass/);
    const r = applyLevelUp(c, { ...emptyLevelUp(), subclassId: 'champion' }, content, newId);
    expect(r.subclass).toBe('Champion');
    expect(r.features!.some((f) => f.ref === 'subclass:champion:Improved Critical')).toBe(true);
    expect(applyLevelUp(c, { ...emptyLevelUp(), subclassId: 'custom', customSubclass: 'Rune Knight' }, content, newId).subclass).toBe('Rune Knight');
  });

  it('applies an Ability Score Improvement, with retroactive HP for Constitution', () => {
    const c = char({ className: 'Fighter', subclass: 'Champion', level: 3, hpMax: 28, hpCurrent: 28, abilities: { ...DEFAULT_CHARACTER.abilities, con: 13, str: 19 } });
    const plan = levelUpPlan(c, content)!;
    const asi = { ...emptyLevelUp(), featId: 'ability-score-improvement', asi: { con: 1, str: 1 } };
    // d10 fixed 6 + CON 2, plus 1 for each of the 3 earlier levels.
    expect(hpGain(c, plan, asi)).toBe(11);
    const r = applyLevelUp(c, asi, content, newId);
    expect(r.abilities).toMatchObject({ con: 14, str: 20 });
    expect(r.hpMax).toBe(39);
    expect(() => applyLevelUp(c, { ...asi, asi: { str: 2 } }, content, newId)).toThrow(/above 20/);
    expect(() => applyLevelUp(c, { ...asi, asi: { con: 1 } }, content, newId)).toThrow(/Raise one ability/);
    expect(() => applyLevelUp(c, emptyLevelUp(), content, newId)).toThrow(/Pick a feat/);
    const grappler = applyLevelUp(c, { ...emptyLevelUp(), featId: 'grappler', asi: { str: 1 } }, content, newId);
    expect(grappler.features!.at(-1)).toMatchObject({ name: 'Grappler', ref: 'feat:grappler' });
  });

  it('adds new spells within the allowance', () => {
    const c = char({
      className: 'Wizard', level: 2,
      spells: [{ id: 'x', name: 'Magic Missile', level: 1, prepared: true, ref: 'magic-missile' }],
    });
    const plan = levelUpPlan(c, content)!;
    const options = levelUpSpellOptions(c, plan, content);
    expect(options.some((s) => s.id === 'magic-missile')).toBe(false);
    expect(options.some((s) => s.id === 'misty-step')).toBe(true);
    const base = { ...emptyLevelUp(), subclassId: 'evoker' };
    const r = applyLevelUp(c, { ...base, spells: ['misty-step'] }, content, newId);
    expect(r.spells!.map((s) => s.name)).toEqual(['Magic Missile', 'Misty Step']);
    expect(() => applyLevelUp(c, { ...base, spells: ['misty-step', 'web'] }, content, newId)).toThrow(/1 new spell at most/);
    expect(() => applyLevelUp(c, { ...base, spells: ['fireball'] }, content, newId)).toThrow(/from the list/);
  });
});
