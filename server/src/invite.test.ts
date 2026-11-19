import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp, type IoServer } from './app.ts';
import { Store } from './store.ts';

// A server on the internet: first passwords need the invite code.
let store: Store;
let io: IoServer;
let url: string;

beforeEach(async () => {
  store = new Store(':memory:');
  for (const name of ['Faris', 'Mira']) store.addUser(name);
  const app = createApp({ store, inviteCode: 'owlbear-42' });
  await new Promise<void>((resolve) => app.httpServer.listen(0, resolve));
  io = app.io;
  url = `http://localhost:${(app.httpServer.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await io.close();
  store.close();
});

async function post(path: string, body: unknown) {
  const res = await fetch(url + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe('invite code', () => {
  it('is needed to choose a first password, and never again after that', async () => {
    expect((await post('/api/auth/status', { username: 'Mira' })).body).toEqual({ exists: true, hasPassword: false, needsInvite: true });
    // A stranger who guesses the name cannot take the account.
    expect((await post('/api/auth/login', { username: 'Mira', password: 'stranger1' })).status).toBe(403);
    expect((await post('/api/auth/login', { username: 'Mira', password: 'stranger1', invite: 'dragon' })).status).toBe(403);
    expect(store.accountStatus('Mira').hasPassword).toBe(false);

    expect((await post('/api/auth/login', { username: 'Mira', password: 'hunter22', invite: ' owlbear-42 ' })).status).toBe(200);
    expect((await post('/api/auth/status', { username: 'Mira' })).body).toEqual({ exists: true, hasPassword: true });
    expect((await post('/api/auth/login', { username: 'Mira', password: 'hunter22' })).status).toBe(200);
    expect((await post('/api/auth/login', { username: 'Mira', password: 'stranger1', invite: 'owlbear-42' })).status).toBe(401);
  });

  it('locks the account for a while after too many wrong codes', async () => {
    for (let i = 0; i < 5; i++) await post('/api/auth/login', { username: 'Faris', password: 'whatever1', invite: `guess-${i}` });
    expect((await post('/api/auth/login', { username: 'Faris', password: 'secret123', invite: 'owlbear-42' })).status).toBe(429);
  });

  it('does not say anything about accounts that do not exist', async () => {
    expect((await post('/api/auth/status', { username: 'Nobody' })).body).toEqual({ exists: false, hasPassword: false });
  });
});
