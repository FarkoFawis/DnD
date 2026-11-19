import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { io as connect, type Socket } from 'socket.io-client';
import type { Ack, ClientToServerEvents, LoginResult, ServerToClientEvents, SessionState } from '@dnd/shared';
import { createApp, type IoServer } from './app.ts';
import { Store } from './store.ts';

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;

let store: Store;
let io: IoServer;
let url: string;
const clients: Client[] = [];

async function startApp(s: Store) {
  const app = createApp({ store: s });
  await new Promise<void>((resolve) => app.httpServer.listen(0, resolve));
  return { io: app.io, url: `http://localhost:${(app.httpServer.address() as AddressInfo).port}` };
}

beforeEach(async () => {
  store = new Store(':memory:');
  for (const name of ['Faris', 'Mira', 'Jonas']) store.addUser(name);
  ({ io, url } = await startApp(store));
});

afterEach(async () => {
  clients.splice(0).forEach((c) => c.disconnect());
  await io.close();
  store.close();
});

async function post(path: string, body: unknown, base = url) {
  const res = await fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function login(username: string, password = 'secret123', base = url): Promise<string> {
  const res = await post('/api/auth/login', { username, password }, base);
  if (res.status !== 200) throw new Error(String(res.body.error));
  return (res.body as unknown as LoginResult).token;
}

async function client(token: string, base = url): Promise<Client> {
  const c: Client = connect(base, { transports: ['websocket'], forceNew: true, auth: { token } });
  clients.push(c);
  await new Promise<void>((resolve, reject) => {
    c.on('connect', resolve);
    c.on('connect_error', reject);
  });
  return c;
}

function ok<T>(res: Ack<T>): T {
  if (!res.ok) throw new Error(res.error);
  return res;
}

function nextState(c: Client, predicate: (s: SessionState) => boolean): Promise<SessionState> {
  return new Promise((resolve) => {
    const handler = (s: SessionState) => {
      if (predicate(s)) {
        c.off('session:state', handler);
        resolve(s);
      }
    };
    c.on('session:state', handler);
  });
}

/** Faris hosts a new campaign, returns the DM socket and the session. */
async function hostCampaign(name = 'Curse of the Hollow Crown') {
  const dm = await client(await login('Faris'));
  const { campaign } = ok(await dm.emitWithAck('campaign:create', { name }));
  const { session } = ok(await dm.emitWithAck('session:host', { campaignId: campaign.id }));
  return { dm, session, campaign };
}

describe('accounts', () => {
  it('lets a pre-made account choose its password on first login, then requires it', async () => {
    expect((await post('/api/auth/status', { username: 'mira' })).body).toEqual({ exists: true, hasPassword: false });
    expect((await post('/api/auth/login', { username: 'Mira', password: '123' })).status).toBe(400);
    await login('Mira', 'hunter22');
    expect((await post('/api/auth/status', { username: 'Mira' })).body).toEqual({ exists: true, hasPassword: true });
    expect((await post('/api/auth/login', { username: 'Mira', password: 'nope-nope' })).status).toBe(401);
    expect(await login('mira', 'hunter22')).toBeTruthy();
  });

  it('rejects unknown users and locks out after repeated wrong passwords', async () => {
    expect((await post('/api/auth/login', { username: 'Stranger', password: 'whatever' })).status).toBe(401);
    await login('Jonas', 'right-one');
    for (let i = 0; i < 5; i++) await post('/api/auth/login', { username: 'Jonas', password: 'wrong' });
    expect((await post('/api/auth/login', { username: 'Jonas', password: 'right-one' })).status).toBe(429);
  });

  it('refuses sockets without a valid token', async () => {
    await expect(client('bogus')).rejects.toThrow('unauthorized');
  });
});

describe('campaign sessions', () => {
  it('lets the DM host a campaign and players join with the code', async () => {
    const { dm, session } = await hostCampaign();
    expect(session.code).toMatch(/^[A-Z2-9]{5}$/);
    expect(session.host).toMatchObject({ username: 'Faris', online: true });

    const mira = await client(await login('Mira'));
    const dmSeesMira = nextState(dm, (s) => s.players.length === 1);
    const joined = ok(await mira.emitWithAck('session:join', { code: session.code.toLowerCase() }));
    expect(joined.session.players[0]).toMatchObject({ user: { username: 'Mira' }, online: true });
    expect(joined.session.players[0]?.character).toMatchObject({ name: 'Mira', level: 1 });
    await dmSeesMira;
  });

  it('only lets owners host their campaigns and lists them', async () => {
    const { campaign } = await hostCampaign();
    const mira = await client(await login('Mira'));
    expect(await mira.emitWithAck('session:host', { campaignId: campaign.id })).toMatchObject({ ok: false });
    expect(ok(await mira.emitWithAck('campaign:list')).campaigns).toEqual([]);
  });

  it('saves characters per campaign and loads them next session', async () => {
    const { dm, session, campaign } = await hostCampaign('Campaign A');
    const mira = await client(await login('Mira'));
    ok(await mira.emitWithAck('session:join', { code: session.code }));
    const dmSeesUpdate = nextState(dm, (s) => s.players[0]?.character.className === 'Wizard');
    ok(await mira.emitWithAck('character:update', { patch: { name: 'Elowen', className: 'Wizard', level: 3, hpCurrent: 7 } }));
    await dmSeesUpdate;
    expect(await mira.emitWithAck('character:update', { patch: { level: 99 } })).toMatchObject({ ok: false });

    // End of the evening.
    const miraTold = new Promise<void>((resolve) => mira.on('session:ended', () => resolve()));
    ok(await dm.emitWithAck('session:end'));
    await miraTold;

    // A different campaign gives Mira a separate, fresh character.
    const { session: other } = ok(
      await dm.emitWithAck('session:host', {
        campaignId: ok(await dm.emitWithAck('campaign:create', { name: 'Campaign B' })).campaign.id,
      }),
    );
    const inB = ok(await mira.emitWithAck('session:join', { code: other.code }));
    expect(inB.session.players[0]?.character).toMatchObject({ name: 'Mira', className: '' });

    // Next week, Campaign A again: a new code, and Mira's character is back.
    const nextWeek = ok(await dm.emitWithAck('session:host', { campaignId: campaign.id }));
    expect(nextWeek.session.code).not.toBe(session.code);
    const back = ok(await mira.emitWithAck('session:join', { code: nextWeek.session.code }));
    expect(back.session.players[0]?.character).toMatchObject({ name: 'Elowen', className: 'Wizard', level: 3, hpCurrent: 7 });
  });

  it('keeps the session when the DM drops, and the DM gets back in', async () => {
    const { dm, session } = await hostCampaign();
    const mira = await client(await login('Mira'));
    ok(await mira.emitWithAck('session:join', { code: session.code }));

    const dmOffline = nextState(mira, (s) => !s.host.online);
    dm.disconnect();
    await dmOffline;

    const dm2 = await client(await login('Faris'));
    const dmBack = nextState(mira, (s) => s.host.online);
    const resumed = ok(await dm2.emitWithAck('session:join', { code: session.code }));
    expect(resumed.session.players).toHaveLength(1);
    await dmBack;
  });

  it('survives a server restart (everything is in the database)', async () => {
    const { session } = await hostCampaign();
    const token = await login('Mira');
    const mira = await client(token);
    ok(await mira.emitWithAck('session:join', { code: session.code }));
    ok(await mira.emitWithAck('character:update', { patch: { hpCurrent: 4 } }));

    const restarted = await startApp(store);
    try {
      const again = await client(token, restarted.url);
      const res = ok(await again.emitWithAck('session:join', { code: session.code }));
      expect(res.session.players[0]?.character.hpCurrent).toBe(4);
      again.disconnect();
    } finally {
      await restarted.io.close();
    }
  });

  it('lets a player leave while keeping their character', async () => {
    const { dm, session, campaign } = await hostCampaign();
    const mira = await client(await login('Mira'));
    ok(await mira.emitWithAck('session:join', { code: session.code }));
    ok(await mira.emitWithAck('character:update', { patch: { className: 'Rogue' } }));
    const dmSeesLeave = nextState(dm, (s) => s.players.length === 0);
    ok(await mira.emitWithAck('session:leave'));
    await dmSeesLeave;
    expect(await dm.emitWithAck('session:leave')).toMatchObject({ ok: false });
    const miraUser = store.listUsers().find((u) => u.username === 'Mira')!;
    expect(store.getOrCreateCharacter(campaign.id, miraUser).className).toBe('Rogue');
  });

  it('lets the DM change a player\'s character, but not players each other\'s', async () => {
    const { dm, session } = await hostCampaign();
    const mira = await client(await login('Mira'));
    const jonas = await client(await login('Jonas'));
    const miraId = ok(await mira.emitWithAck('session:join', { code: session.code })).session.players[0]!.user.id;
    ok(await jonas.emitWithAck('session:join', { code: session.code }));

    const miraSeesHit = nextState(mira, (s) => s.players.find((p) => p.user.id === miraId)?.character.hpCurrent === 3);
    const res = ok(await dm.emitWithAck('character:update', { userId: miraId, patch: { hpCurrent: 3 } }));
    expect(res.character.hpCurrent).toBe(3);
    await miraSeesHit;

    // A hit from the DM and a heal from the player both count.
    ok(await dm.emitWithAck('character:adjustHp', { userId: miraId, delta: -2 }));
    const healed = ok(await mira.emitWithAck('character:adjustHp', { delta: 5 }));
    expect(healed.character.hpCurrent).toBe(6);

    expect(await jonas.emitWithAck('character:update', { userId: miraId, patch: { hpCurrent: 0 } })).toMatchObject({ ok: false });
    expect(await jonas.emitWithAck('character:adjustHp', { userId: miraId, delta: -1 })).toMatchObject({ ok: false });
    expect(await dm.emitWithAck('character:adjustHp', { userId: miraId, delta: 1.5 })).toMatchObject({ ok: false });
    expect(await dm.emitWithAck('character:update', { patch: { hpCurrent: 0 } })).toMatchObject({ ok: false });
    expect(await dm.emitWithAck('character:update', { userId: 'nobody', patch: { hpCurrent: 0 } })).toMatchObject({ ok: false });
  });

  it('lets the DM give and take items, and players manage their own', async () => {
    const { dm, session } = await hostCampaign();
    const mira = await client(await login('Mira'));
    const jonas = await client(await login('Jonas'));
    const miraId = ok(await mira.emitWithAck('session:join', { code: session.code })).session.players[0]!.user.id;
    ok(await jonas.emitWithAck('session:join', { code: session.code }));

    const miraSeesItem = nextState(mira, (s) => s.players[0]?.character.inventory.length === 1);
    const given = ok(await dm.emitWithAck('item:add', { userId: miraId, item: { name: 'Potion of Healing', qty: 2 } }));
    const potion = given.character.inventory[0]!;
    expect(potion).toMatchObject({ name: 'Potion of Healing', qty: 2, notes: '' });
    await miraSeesItem;

    // Mira drinks one, then adds her own rope.
    expect(ok(await mira.emitWithAck('item:update', { itemId: potion.id, patch: { qty: 1 } })).character.inventory[0]?.qty).toBe(1);
    ok(await mira.emitWithAck('item:add', { item: { name: 'Rope' } }));
    // Jonas can't touch Mira's stuff.
    expect(await jonas.emitWithAck('item:remove', { userId: miraId, itemId: potion.id })).toMatchObject({ ok: false });
    // The DM takes the potion away.
    const after = ok(await dm.emitWithAck('item:remove', { userId: miraId, itemId: potion.id }));
    expect(after.character.inventory.map((i) => i.name)).toEqual(['Rope']);
    // qty 0 removes; nameless items and inventory via character:update are rejected.
    const rope = after.character.inventory[0]!;
    expect(ok(await mira.emitWithAck('item:update', { itemId: rope.id, patch: { qty: 0 } })).character.inventory).toEqual([]);
    expect(await mira.emitWithAck('item:add', { item: { name: '  ' } })).toMatchObject({ ok: false });
    expect(await mira.emitWithAck('character:update', { patch: { inventory: [] } as never })).toMatchObject({ ok: false });
  });

  it('rejects unknown codes', async () => {
    const mira = await client(await login('Mira'));
    expect(await mira.emitWithAck('session:join', { code: 'ZZZZZ' })).toMatchObject({ ok: false });
  });
});
