import { describe, expect, it } from 'vitest';
import { buildRecap, describeLogEntry, recapLines, type LogEntry, type LogEvent } from './log.ts';

const entries = (events: LogEvent[]): LogEntry[] =>
  events.map((e, i) => ({ ...e, id: i + 1, session: 3, at: '2026-11-19 20:00:00' }));

describe('session log', () => {
  it('describes entries in plain words', () => {
    expect(describeLogEntry({ kind: 'damage', who: 'Elowen', amount: 5, what: '7/12 HP' })).toBe('Elowen took 5 damage (7/12 HP).');
    expect(describeLogEntry({ kind: 'loot', who: 'Brom', what: '2× Rope' })).toBe('Brom got 2× Rope.');
    expect(describeLogEntry({ kind: 'fightEnd', who: '', amount: 1 })).toBe('The fight ended after 1 round.');
  });

  it('sums a session up for the recap', () => {
    const recap = buildRecap(
      entries([
        { kind: 'start', who: '', what: 'Elowen, Brom' },
        { kind: 'handout', who: '', what: 'Old map' },
        { kind: 'fight', who: '', what: '2× Goblin' },
        { kind: 'used', who: 'Elowen', what: 'Fire Bolt' },
        { kind: 'used', who: 'Elowen', what: 'Fire Bolt' },
        { kind: 'damage', who: 'Brom', amount: 4 },
        { kind: 'damage', who: 'Brom', amount: 9 },
        { kind: 'down', who: 'Brom' },
        { kind: 'heal', who: 'Brom', amount: 6 },
        { kind: 'defeated', who: 'Goblin 1' },
        { kind: 'defeated', who: 'Goblin 2' },
        { kind: 'fightEnd', who: '', amount: 3 },
        { kind: 'loot', who: 'Elowen', what: '15 gp' },
        { kind: 'end', who: '' },
      ]),
    )!;
    expect(recap.session).toBe(3);
    expect(recap.fights).toEqual([{ opponents: '2× Goblin', rounds: 3, defeated: ['Goblin 1', 'Goblin 2'] }]);
    expect(recap.characters.find((c) => c.who === 'Brom')).toMatchObject({ damage: 13, healed: 6, downs: 1 });
    expect(recapLines(recap)).toEqual([
      'At the table: Elowen, Brom.',
      'Fight against 2× Goblin, 3 rounds. Defeated: Goblin 1, Goblin 2.',
      'Elowen used Fire Bolt ×2; got 15 gp.',
      'Brom took 13 damage; regained 6 HP; dropped to 0 HP once.',
      'Handouts shown: Old map.',
    ]);
  });

  it('has nothing to say about an empty session', () => {
    expect(buildRecap([])).toBeNull();
  });
});
