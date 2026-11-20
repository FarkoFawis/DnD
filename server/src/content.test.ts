import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { io as connect, type Socket } from 'socket.io-client';
import { Content, type ClientToServerEvents, type LoginResult, type ServerToClientEvents } from '@dnd/shared';
import { SRD } from '@dnd/shared/srd';
import { createApp, type IoServer } from './app.ts';
import { loadContentPacks } from './content.ts';
import { phbCoverage } from './phbChecklist.ts';
import { Store } from './store.ts';

let dir: string;
let store: Store;
let io: IoServer;
let url: string;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'dnd-content-'));
  store = new Store(':memory:');
  store.addUser('Faris');
  const app = createApp({ store, contentDir: dir });
  io = app.io;
  await new Promise<void>((resolve) => app.httpServer.listen(0, resolve));
  url = `http://localhost:${(app.httpServer.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await io.close();
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

it('serves private content packs to logged-in users only', async () => {
  writeFileSync(
    join(dir, 'phb.json'),
    JSON.stringify({ id: 'phb', name: 'Our PHB', backgrounds: [{ id: 'noble', name: 'Noble', abilities: ['str', 'int', 'cha'], skills: ['history', 'persuasion'] }] }),
  );
  writeFileSync(join(dir, 'broken.json'), '{ not json');

  expect((await fetch(`${url}/api/content`)).status).toBe(401);

  const login = await fetch(`${url}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'Faris', password: 'secret123' }),
  });
  const { token } = (await login.json()) as LoginResult;
  const res = await fetch(`${url}/api/content`, { headers: { authorization: `Bearer ${token}` } });
  const body = (await res.json()) as { packs: { id: string; backgrounds: { name: string; equipment: unknown[] }[] }[] };
  expect(body.packs.map((p) => p.id)).toEqual(['phb']);
  expect(body.packs[0]!.backgrounds[0]).toMatchObject({ name: 'Noble', equipment: [] });

  expect(loadContentPacks(dir).problems[0]).toMatch(/^broken.json:/);
});

it("says what of the Player's Handbook is still missing", () => {
  const srdOnly = phbCoverage(new Content([SRD]));
  const group = (list: typeof srdOnly, name: string) => list.find((c) => c.group === name)!;
  expect(group(srdOnly, 'Subclasses')).toMatchObject({ total: 48 });
  expect(group(srdOnly, 'Subclasses').missing).toHaveLength(36);
  expect(group(srdOnly, 'Backgrounds').missing).toHaveLength(12);
  expect(group(srdOnly, 'Species').missing).toEqual(['Aasimar']);
  expect(group(srdOnly, 'Origin feats').missing).toEqual(['Crafter', 'Healer', 'Lucky', 'Musician', 'Tavern Brawler', 'Tough']);
  // Nothing on the "left out" list is in the free rules after all.
  expect(group(srdOnly, 'Spells the free rules leave out').missing).toHaveLength(group(srdOnly, 'Spells the free rules leave out').total);

  writeFileSync(
    join(dir, 'phb.json'),
    JSON.stringify({
      subclasses: [{ id: 'diviner', classId: 'wizard', name: 'Diviner' }],
      feats: [{ id: 'tough', name: 'Tough', category: 'origin', description: 'd' }],
      spells: [{ id: 'witch-bolt', name: 'Witch Bolt', level: 1, classes: ['wizard'], description: 'd' }],
    }),
  );
  const withPack = phbCoverage(new Content([SRD, ...loadContentPacks(dir).packs]));
  expect(group(withPack, 'Subclasses').missing).toHaveLength(35);
  expect(group(withPack, 'Subclasses').missing).not.toContain('Wizard: Diviner');
  expect(group(withPack, 'Origin feats').missing).not.toContain('Tough');
  expect(group(withPack, 'Spells the free rules leave out').missing).not.toContain('Witch Bolt');
});

it('counts the uses that a pack gives a feature, and rests give them back', async () => {
  writeFileSync(
    join(dir, 'phb.json'),
    JSON.stringify({
      feats: [{ id: 'fortunate', name: 'Fortunate', category: 'origin', description: 'd', uses: { max: 'pb', resetOn: 'long', name: 'Fortune Points' } }],
    }),
  );
  const login = await fetch(`${url}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'Faris', password: 'secret123' }),
  });
  const { token } = (await login.json()) as LoginResult;
  const socket: Socket<ServerToClientEvents, ClientToServerEvents> = connect(url, { transports: ['websocket'], forceNew: true, auth: { token } });
  try {
    await new Promise<void>((resolve, reject) => {
      socket.on('connect', resolve);
      socket.on('connect_error', reject);
    });
    const created = await socket.emitWithAck('character:create', {
      name: 'Test',
      data: { className: 'Rogue', level: 1, features: [{ id: 'f1', name: 'Fortunate', source: 'Origin feat', ref: 'feat:fortunate' }] },
    });
    if (!created.ok) throw new Error(created.error);
    const characterId = created.character.id;
    const use = { kind: 'feature' as const, useId: 'f:feat:fortunate' };

    // Proficiency Bonus +2 at level 1: two uses, the third is refused.
    for (let i = 0; i < 2; i++) expect((await socket.emitWithAck('character:use', { characterId, use })).ok).toBe(true);
    const third = await socket.emitWithAck('character:use', { characterId, use });
    expect(third).toMatchObject({ ok: false, error: expect.stringMatching(/No uses of Fortune Points left/) });

    const short = await socket.emitWithAck('character:rest', { characterId, kind: 'short' });
    expect(short.ok && short.character.data.used).toEqual({ 'f:feat:fortunate': 2 });
    const long = await socket.emitWithAck('character:rest', { characterId, kind: 'long' });
    expect(long.ok && long.character.data.used).toEqual({});
  } finally {
    socket.disconnect();
  }
});
