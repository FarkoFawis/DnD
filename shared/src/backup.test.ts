import { describe, expect, it } from 'vitest';
import { BACKUP_FORMAT, BACKUP_VERSION, backupFileName, parseBackup } from './backup.ts';
import { DEFAULT_NPC } from './prep.ts';
import { DEFAULT_CHARACTER } from './protocol.ts';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0]).toString('base64');
const file = (over: Record<string, unknown> = {}) => ({
  format: BACKUP_FORMAT,
  version: BACKUP_VERSION,
  exportedAt: '2026-11-19T22:00:00.000Z',
  campaign: { id: '3f0e2c1a-0000-4000-8000-000000000001', name: '  Lost   Mine ' },
  handouts: [{ title: 'Map', text: '', image: { mime: 'image/png', data: PNG } }, { title: 'Letter', text: 'Come at once.' }],
  npcs: [{ ...DEFAULT_NPC, name: 'Goblin', hpMax: 7 }],
  log: [{ session: 1, at: '2026-11-12 19:00:00', kind: 'start', who: '', what: 'Alba' }],
  characters: [{ id: 'aaaaaaaa-0000-4000-8000-000000000001', owner: 'Mira', data: { ...DEFAULT_CHARACTER, name: 'Alba', level: 3 } }],
  ...over,
});

describe('reading a backup file', () => {
  it('accepts a good file and tidies the campaign name', () => {
    const { backup, skipped } = parseBackup(file());
    expect(skipped).toBe(0);
    expect(backup.campaign).toEqual({ id: '3f0e2c1a-0000-4000-8000-000000000001', name: 'Lost Mine' });
    expect(backup.handouts).toEqual([{ title: 'Map', text: '', image: { mime: 'image/png', data: PNG } }, { title: 'Letter', text: 'Come at once.' }]);
    expect(backup.npcs[0]).toMatchObject({ name: 'Goblin', hpMax: 7 });
    expect(backup.log).toEqual([{ session: 1, at: '2026-11-12 19:00:00', kind: 'start', who: '', what: 'Alba' }]);
    expect(backup.characters[0]).toMatchObject({ owner: 'Mira', data: { name: 'Alba', level: 3 } });
  });
  it('refuses files that are not a backup, or from a newer app', () => {
    expect(() => parseBackup({ hello: 1 })).toThrow(/not a campaign backup/);
    expect(() => parseBackup('text')).toThrow(/not a campaign backup/);
    expect(() => parseBackup(file({ version: 99 }))).toThrow(/newer version/);
    expect(() => parseBackup(file({ campaign: { name: '   ' } }))).toThrow(/no campaign name/);
  });
  it('leaves out and counts entries it cannot read, keeping the rest', () => {
    const { backup, skipped } = parseBackup(
      file({
        handouts: [{ title: 'Empty' }, { title: 'Fake', image: { mime: 'text/html', data: 'PGI+' } }, { title: 'Letter', text: 'Hi' }],
        npcs: [{ name: '' }, { name: 'Bandit', armorClass: 400 }, { ...DEFAULT_NPC, name: 'Goblin' }],
        log: [{ session: 1, at: 'yesterday', kind: 'start', who: '' }, { session: 1, at: '2026-11-12 19:00:00', kind: 'party', who: '' }],
        characters: [
          { id: 'x', owner: 'Mira', data: { name: 'Bad id' } },
          { id: 'aaaaaaaa-0000-4000-8000-000000000002', owner: '', data: { name: 'No owner' } },
          { id: 'aaaaaaaa-0000-4000-8000-000000000003', owner: 'Jonas', data: { name: 'Borin', level: 99, hpMax: 31 } },
          { id: 'aaaaaaaa-0000-4000-8000-000000000003', owner: 'Jonas', data: { name: 'Borin again' } },
        ],
      }),
    );
    expect(backup.handouts.map((h) => h.title)).toEqual(['Letter']);
    expect(backup.npcs.map((n) => n.name)).toEqual(['Goblin']);
    expect(backup.log).toEqual([]);
    // A field that is out of range falls back to its default; the character survives.
    expect(backup.characters).toHaveLength(1);
    expect(backup.characters[0]!.data).toMatchObject({ name: 'Borin', level: 1, hpMax: 31 });
    expect(skipped).toBe(2 + 2 + 2 + 3);
  });
  it('drops what belongs to a running session', () => {
    const data = { ...DEFAULT_CHARACTER, name: 'Alba', resting: true, portrait: 'abc', lastAction: { name: 'Fire Bolt', at: 'now' } };
    const { backup } = parseBackup(file({ characters: [{ id: 'aaaaaaaa-0000-4000-8000-000000000001', owner: 'Mira', data }] }));
    expect(backup.characters[0]!.data).toMatchObject({ resting: false, portrait: '', lastAction: null });
  });
  it('names the file after the campaign and the day', () => {
    expect(backupFileName('Curse of the Hollow Crown!', new Date('2026-11-19T22:00:00Z'))).toBe('curse-of-the-hollow-crown-2026-11-19.dnd-backup.json');
    expect(backupFileName('???', new Date('2026-01-02T00:00:00Z'))).toBe('campaign-2026-01-02.dnd-backup.json');
  });
});
