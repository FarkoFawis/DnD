import { describe, expect, it } from 'vitest';
import { addCombatants, applyCombatAction, newCombat, publicCombat, type Combatant } from './combat.ts';
import { npcInitiative, sanitizeHandout, sanitizeNpc } from './prep.ts';

const c = (id: string, bonus: number, extra: Partial<Combatant> = {}): Combatant => ({
  id,
  kind: 'player',
  ref: id,
  name: id,
  bonus,
  initiative: null,
  d20: null,
  ...extra,
});

/** Dice that come up with the given numbers, in order. */
const dice = (...rolls: number[]) => () => rolls.shift()!;

describe('initiative', () => {
  it('rolls d20 + modifier for everyone and sorts highest first', () => {
    const combat = applyCombatAction(newCombat([c('a', 2), c('b', 0), c('goblin', 2, { kind: 'npc' })]), { type: 'roll' }, dice(5, 18, 10));
    expect(combat.combatants.map((x) => [x.id, x.initiative])).toEqual([['b', 18], ['goblin', 12], ['a', 7]]);
  });

  it('breaks ties by the higher modifier', () => {
    const combat = applyCombatAction(newCombat([c('slow', 0), c('quick', 3)]), { type: 'roll' }, dice(13, 10));
    expect(combat.combatants.map((x) => x.id)).toEqual(['quick', 'slow']);
  });

  it('lets the DM type a value in, and rolls only the chosen ones', () => {
    let combat = newCombat([c('a', 1), c('b', 1)]);
    combat = applyCombatAction(combat, { type: 'set', id: 'a', value: 21 });
    combat = applyCombatAction(combat, { type: 'roll', ids: ['b'] }, dice(4));
    expect(combat.combatants).toMatchObject([{ id: 'a', initiative: 21, d20: null }, { id: 'b', initiative: 5, d20: 4 }]);
    expect(() => applyCombatAction(combat, { type: 'set', id: 'a', value: 1.5 })).toThrow();
  });

  it('puts unrolled combatants last', () => {
    const combat = applyCombatAction(newCombat([c('a', 0), c('b', 0)]), { type: 'set', id: 'b', value: -1 });
    expect(combat.combatants.map((x) => x.id)).toEqual(['b', 'a']);
  });
});

describe('turns', () => {
  const start = () => applyCombatAction(newCombat([c('a', 0), c('b', 0), c('c', 0)]), { type: 'roll' }, dice(15, 10, 5));

  it('goes round the table and counts rounds', () => {
    let combat = start();
    expect(combat.activeId).toBeNull();
    for (const expected of ['a', 'b', 'c']) {
      combat = applyCombatAction(combat, { type: 'next' });
      expect([combat.activeId, combat.round]).toEqual([expected, 1]);
    }
    combat = applyCombatAction(combat, { type: 'next' });
    expect([combat.activeId, combat.round]).toEqual(['a', 2]);
    combat = applyCombatAction(combat, { type: 'prev' });
    expect([combat.activeId, combat.round]).toEqual(['c', 1]);
  });

  it('passes the turn on when the active combatant is removed', () => {
    let combat = applyCombatAction(applyCombatAction(start(), { type: 'next' }), { type: 'next' });
    combat = applyCombatAction(combat, { type: 'remove', id: 'b' });
    expect(combat.activeId).toBe('c');
    combat = applyCombatAction(combat, { type: 'remove', id: 'c' });
    expect([combat.activeId, combat.round]).toEqual(['a', 2]);
  });

  it('adds late arrivals at the end until they have an initiative', () => {
    const combat = addCombatants(start(), [c('late', 5)]);
    expect(combat.combatants.at(-1)!.id).toBe('late');
  });
});

describe('opponent hit points', () => {
  const goblin = c('g', 2, { kind: 'npc', hp: { current: 7, max: 7 }, armorClass: 15 });

  it('never leave 0..max', () => {
    let combat = applyCombatAction(newCombat([goblin]), { type: 'hp', id: 'g', delta: -10 });
    expect(combat.combatants[0]!.hp).toEqual({ current: 0, max: 7 });
    combat = applyCombatAction(combat, { type: 'hp', id: 'g', delta: 99 });
    expect(combat.combatants[0]!.hp!.current).toBe(7);
  });

  it('are hidden from players', () => {
    const shown = publicCombat(newCombat([goblin])).combatants[0]!;
    expect(shown.hp).toBeUndefined();
    expect(shown.armorClass).toBeUndefined();
    expect(shown.name).toBe('g');
  });
});

describe('campaign prep', () => {
  it('fills in NPC defaults and derives initiative from DEX', () => {
    const npc = sanitizeNpc({ name: ' Goblin ', abilities: { dex: 14 }, initiativeBonus: 1 });
    expect(npc).toMatchObject({ name: 'Goblin', role: 'opponent', hpMax: 10, abilities: { str: 10, dex: 14 } });
    expect(npcInitiative(npc)).toBe(3);
    expect(() => sanitizeNpc({ name: '' })).toThrow();
    expect(() => sanitizeNpc({ name: 'x', hpMax: 0 })).toThrow();
  });

  it('needs a title and a picture or text for a handout, and only accepts uploaded pictures', () => {
    expect(sanitizeHandout({ title: 'Map', text: 'Old mill' })).toEqual({ title: 'Map', text: 'Old mill', imageUrl: null });
    expect(() => sanitizeHandout({ title: 'Map' })).toThrow();
    expect(() => sanitizeHandout({ title: '', text: 'x' })).toThrow();
    expect(() => sanitizeHandout({ title: 'Map', imageUrl: 'https://evil.example/x.png' })).toThrow();
    const imageUrl = '/api/images/123e4567-e89b-12d3-a456-426614174000.jpg';
    expect(sanitizeHandout({ title: 'Map', imageUrl }).imageUrl).toBe(imageUrl);
  });
});
