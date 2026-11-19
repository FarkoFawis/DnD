import { describe, expect, it } from 'vitest';
import { DEFAULT_CHARACTER, type CharacterData } from './protocol.ts';
import { afterConditionsSet, applyDamageOrHealing, applyDeathSave, concentrationDc, isDead, isDying, isStable } from './status.ts';

const char = (p: Partial<CharacterData>): CharacterData => ({ ...structuredClone(DEFAULT_CHARACTER), hpMax: 20, hpCurrent: 20, ...p });
const conc = { name: 'Bless', saveDc: null };

describe('concentration', () => {
  it('save DC is 10 or half the damage, capped at 30', () => {
    expect(concentrationDc(3)).toBe(10);
    expect(concentrationDc(21)).toBe(10);
    expect(concentrationDc(22)).toBe(11);
    expect(concentrationDc(47)).toBe(23);
    expect(concentrationDc(200)).toBe(30);
  });
  it('damage asks for a save, dropping to 0 ends it', () => {
    const c = char({ concentration: conc, hpMax: 60, hpCurrent: 60 });
    expect(applyDamageOrHealing(c, -30)).toMatchObject({ hpCurrent: 30, concentration: { name: 'Bless', saveDc: 15 } });
    expect(applyDamageOrHealing(c, -60)).toMatchObject({ hpCurrent: 0, concentration: null });
    expect(applyDamageOrHealing(c, 5).concentration).toBeUndefined();
  });
  it('an incapacitating condition ends it', () => {
    const c = char({ concentration: conc });
    expect(afterConditionsSet(c, ['prone'])).toEqual({});
    expect(afterConditionsSet(c, ['prone', 'stunned'])).toEqual({ concentration: null });
  });
});

describe('death saves', () => {
  it('start fresh at 0 HP, and massive damage kills outright', () => {
    const c = char({ hpCurrent: 5, deathSaves: { successes: 1, failures: 1 } });
    expect(applyDamageOrHealing(c, -9)).toMatchObject({ hpCurrent: 0, deathSaves: { successes: 0, failures: 0 } });
    expect(applyDamageOrHealing(c, -25)).toMatchObject({ hpCurrent: 0, deathSaves: { failures: 3 } });
    expect(applyDamageOrHealing(c, -24).deathSaves).toEqual({ successes: 0, failures: 0 });
  });
  it('counts rolls: three either way, 1 is two failures, 20 gets you up', () => {
    let c = char({ hpCurrent: 0 });
    expect(isDying(c)).toBe(true);
    c = { ...c, ...applyDeathSave(c, 'success') };
    c = { ...c, ...applyDeathSave(c, 'nat1') };
    expect(c.deathSaves).toEqual({ successes: 1, failures: 2 });
    expect({ ...c, ...applyDeathSave(c, 'nat20') }).toMatchObject({ hpCurrent: 1, deathSaves: { successes: 0, failures: 0 } });
    const dead = { ...c, ...applyDeathSave(c, 'fail') };
    expect(isDead(dead)).toBe(true);
    expect(() => applyDeathSave(dead, 'success')).toThrow(/dead/);
    let s = char({ hpCurrent: 0, deathSaves: { successes: 2, failures: 0 } });
    s = { ...s, ...applyDeathSave(s, 'success') };
    expect(isStable(s)).toBe(true);
    expect(() => applyDeathSave(s, 'success')).toThrow(/stable/);
    expect(() => applyDeathSave(char({}), 'success')).toThrow(/0 HP/);
  });
  it('damage at 0 HP is a failure and ends being stable; healing clears the saves', () => {
    const c = char({ hpCurrent: 0, deathSaves: { successes: 3, failures: 1 } });
    expect(applyDamageOrHealing(c, -4).deathSaves).toEqual({ successes: 0, failures: 2 });
    expect(applyDamageOrHealing(c, -20).deathSaves).toMatchObject({ failures: 3 });
    expect(applyDamageOrHealing(c, 6)).toMatchObject({ hpCurrent: 6, deathSaves: { successes: 0, failures: 0 } });
  });
});
