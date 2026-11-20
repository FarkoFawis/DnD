import { describe, expect, it } from 'vitest';
import { buildRecap, buildSummary, describeLogEntry, formatDuration, recapLines, type LogEntry, type LogEvent } from './log.ts';

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
        { kind: 'rest', who: '', what: 'short' },
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
      'The party rested: short rest.',
      'Handouts shown: Old map.',
    ]);
  });

  it('has nothing to say about an empty session', () => {
    expect(buildRecap([])).toBeNull();
    expect(buildSummary([], { campaign: 'Hollow Crown', players: ['Elowen'] })).toBeNull();
  });

  it('describes Heroic Inspiration', () => {
    expect(describeLogEntry({ kind: 'inspiration', who: 'Elowen', what: 'gained' })).toBe('Elowen gained Heroic Inspiration.');
    expect(describeLogEntry({ kind: 'inspiration', who: 'Elowen', what: 'used' })).toBe('Elowen used Heroic Inspiration.');
  });
});

describe('session summary', () => {
  const at = (minute: number, e: LogEvent, i: number): LogEntry => ({ ...e, id: i + 1, session: 4, at: `2026-11-20 ${String(19 + Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}:00` });
  const log: [number, LogEvent][] = [
    [0, { kind: 'start', who: '', what: 'Elowen, Brom, Tam' }],
    [10, { kind: 'fight', who: '', what: '2× Goblin, Mysterious stranger' }],
    [11, { kind: 'used', who: 'Elowen', what: 'Fire Bolt (cantrip)' }],
    [12, { kind: 'used', who: 'Elowen', what: 'Fire Bolt (cantrip)' }],
    [13, { kind: 'used', who: 'Elowen', what: 'Shield (1st-level slot)' }],
    [14, { kind: 'damage', who: 'Brom', amount: 13 }],
    [14, { kind: 'down', who: 'Brom' }],
    [15, { kind: 'heal', who: 'Brom', amount: 6 }],
    [16, { kind: 'defeated', who: 'Goblin 1' }],
    [17, { kind: 'defeated', who: 'Mysterious stranger' }],
    [18, { kind: 'fightEnd', who: '', amount: 3 }],
    [40, { kind: 'rest', who: '', what: 'short' }],
    [50, { kind: 'fight', who: '', what: 'Ogre' }],
    [55, { kind: 'used', who: 'Gone', what: 'Rage' }],
    [58, { kind: 'fightEnd', who: '', amount: 2 }],
    [60, { kind: 'loot', who: 'Elowen', what: '15 gp' }],
    [61, { kind: 'level', who: 'Brom', amount: 3 }],
    [125, { kind: 'end', who: '' }],
  ];
  const summary = buildSummary(log.map(([m, e], i) => at(m, e, i)), { campaign: 'Hollow Crown', players: ['Brom', 'Elowen', 'Tam'] })!;

  it('counts the evening', () => {
    expect(summary).toMatchObject({ session: 4, campaign: 'Hollow Crown', minutes: 125, fights: 2, rounds: 5, defeated: 2, rests: { short: 1, long: 0 } });
    expect(formatDuration(summary.minutes)).toBe('2:05');
    expect(formatDuration(45)).toBe('0:45');
  });

  it('lists the table first, in its order, then whoever left, and never names an opponent', () => {
    expect(summary.characters.map((c) => c.who)).toEqual(['Brom', 'Elowen', 'Tam', 'Gone']);
    expect(summary.characters[0]).toEqual({ who: 'Brom', damage: 13, healed: 6, downs: 1, used: 0, favourite: null, loot: [], level: 3 });
    expect(summary.characters[1]).toEqual({ who: 'Elowen', damage: 0, healed: 0, downs: 0, used: 3, favourite: 'Fire Bolt', loot: ['15 gp'], level: null });
    expect(summary.characters[2]).toMatchObject({ who: 'Tam', damage: 0, used: 0 });
    expect(JSON.stringify(summary)).not.toMatch(/Goblin|stranger|Ogre/);
  });
});
