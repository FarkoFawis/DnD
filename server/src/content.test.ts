import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { LoginResult } from '@dnd/shared';
import { createApp, type IoServer } from './app.ts';
import { loadContentPacks } from './content.ts';
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
