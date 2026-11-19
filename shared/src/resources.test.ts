import { describe, expect, it } from 'vitest';
import { DEFAULT_CHARACTER, type CharacterData } from './protocol.ts';
import { applyRest, applyUse, castOptions, limitedUses, spellSlots } from './resources.ts';

const char = (p: Partial<CharacterData>): CharacterData => ({ ...structuredClone(DEFAULT_CHARACTER), ...p });
const slots = (p: Partial<CharacterData>) => spellSlots(char(p)).map((s) => s.max);

describe('spell slots (2024)', () => {
  it('full casters follow the full table', () => {
    expect(slots({ className: 'Wizard', level: 1 })).toEqual([2]);
    expect(slots({ className: 'Cleric', level: 5 })).toEqual([4, 3, 2]);
    expect(slots({ className: 'Bard', level: 20 })).toEqual([4, 3, 3, 3, 3, 2, 2, 1, 1]);
  });
  it('half casters get slots from level 1 and round up', () => {
    expect(slots({ className: 'Paladin', level: 1 })).toEqual([2]);
    expect(slots({ className: 'Ranger', level: 3 })).toEqual([3]);
    expect(slots({ className: 'Paladin', level: 5 })).toEqual([4, 2]);
    expect(slots({ className: 'Paladin', level: 9 })).toEqual([4, 3, 2]);
  });
  it('third-caster subclasses start at 3', () => {
    expect(slots({ className: 'Fighter', subclass: 'Eldritch Knight', level: 2 })).toEqual([]);
    expect(slots({ className: 'Fighter', subclass: 'Eldritch Knight', level: 7 })).toEqual([4, 2]);
    expect(slots({ className: 'Fighter', subclass: 'Champion', level: 7 })).toEqual([]);
  });
  it('warlocks have pact slots that all share one level', () => {
    expect(spellSlots(char({ className: 'Warlock', level: 1 }))).toEqual([{ level: 1, id: 'pact', max: 1, pact: true }]);
    expect(spellSlots(char({ className: 'Warlock', level: 5 }))[0]).toMatchObject({ level: 3, max: 2 });
    expect(spellSlots(char({ className: 'Warlock', level: 11 }))[0]).toMatchObject({ level: 5, max: 3 });
  });
});

describe('limited uses', () => {
  it('scales class features with level and abilities', () => {
    const barb = limitedUses(char({ className: 'Barbarian', level: 6 }));
    expect(barb.find((u) => u.id === 'rage')?.max).toBe(4);
    const bard = limitedUses(char({ className: 'Bard', level: 1, abilities: { ...DEFAULT_CHARACTER.abilities, cha: 16 } }));
    expect(bard[0]).toMatchObject({ id: 'bardic-inspiration', max: 3, resetOn: 'long' });
    const fighter = limitedUses(char({ className: 'Fighter', level: 2 })).map((u) => u.id);
    expect(fighter).toEqual(['second-wind', 'action-surge']);
  });
  it('adds species traits and custom entries', () => {
    const c = char({ species: 'Orc', level: 5, customResources: [{ id: 'x', name: 'Lucky', max: 2, resetOn: 'long' }] });
    expect(limitedUses(c).map((u) => [u.id, u.max])).toEqual([
      ['adrenaline-rush', 3],
      ['relentless-endurance', 1],
      ['custom:x', 2],
    ]);
  });
});

describe('using things', () => {
  const wiz = char({
    className: 'Wizard',
    level: 3,
    spells: [
      { id: 'fb', name: 'Fire Bolt', level: 0, prepared: true },
      { id: 'mm', name: 'Magic Missile', level: 1, prepared: true },
      { id: 'mi', name: 'Misty Step', level: 2, prepared: true },
    ],
  });

  it('cantrips are free', () => {
    const r = applyUse(wiz, { kind: 'spell', spellId: 'fb' });
    expect(r.used).toEqual({});
    expect(r.action).toEqual({ name: 'Fire Bolt', detail: 'cantrip' });
  });

  it('a leveled spell spends the lowest free slot, or the one chosen', () => {
    expect(applyUse(wiz, { kind: 'spell', spellId: 'mm' }).used).toEqual({ slot1: 1 });
    const up = applyUse(wiz, { kind: 'spell', spellId: 'mm', slot: 'slot2' });
    expect(up.used).toEqual({ slot2: 1 });
    expect(up.action.detail).toBe('2nd-level slot');
    expect(() => applyUse(wiz, { kind: 'spell', spellId: 'mi', slot: 'slot1' })).toThrow(/level 2/);
  });

  it('refuses when no slot is left and moves up when the low ones are spent', () => {
    const spent = char({ ...wiz, used: { slot1: 4 } });
    expect(castOptions(spent, 1).map((s) => s.id)).toEqual(['slot2']);
    expect(applyUse(spent, { kind: 'spell', spellId: 'mm' }).used).toEqual({ slot1: 4, slot2: 1 });
    const none = char({ ...wiz, used: { slot1: 4, slot2: 2 } });
    expect(() => applyUse(none, { kind: 'spell', spellId: 'mm' })).toThrow(/No spell slots/);
  });

  it('features run out and pools spend several at once', () => {
    const f = char({ className: 'Fighter', level: 2, used: { 'action-surge': 1 } });
    expect(() => applyUse(f, { kind: 'feature', useId: 'action-surge' })).toThrow(/Short or Long Rest/);
    const pal = char({ className: 'Paladin', level: 2 });
    expect(applyUse(pal, { kind: 'feature', useId: 'lay-on-hands', amount: 7 }).used).toEqual({ 'lay-on-hands': 7 });
    expect(() => applyUse(pal, { kind: 'feature', useId: 'lay-on-hands', amount: 11 })).toThrow(/Only 10/);
  });
});

describe('rests', () => {
  it('a short rest gives back pact slots, short-rest features and one shortOne use', () => {
    const c = char({ className: 'Fighter', level: 2, used: { 'action-surge': 1, 'second-wind': 2 } });
    expect(applyRest(c, 'short')).toEqual({ used: { 'second-wind': 1 } });
    const w = char({ className: 'Warlock', level: 3, used: { pact: 2 } });
    expect(applyRest(w, 'short')).toEqual({ used: {} });
    const wiz = char({ className: 'Wizard', level: 3, used: { slot1: 2 } });
    expect(applyRest(wiz, 'short')).toEqual({ used: { slot1: 2 } });
  });
  it('a long rest restores everything and HP', () => {
    const c = char({ className: 'Wizard', level: 3, hpMax: 20, hpCurrent: 3, hpTemp: 4, used: { slot1: 2 } });
    expect(applyRest(c, 'long')).toEqual({ used: {}, hpCurrent: 20, hpTemp: 0 });
  });
});
