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

/** Faris hosts a new campaign, returns the DM socket and the session lobby. */
async function hostCampaign(name = 'Curse of the Hollow Crown') {
  const dm = await client(await login('Faris'));
  const { campaign } = ok(await dm.emitWithAck('campaign:create', { name }));
  const { session } = ok(await dm.emitWithAck('session:host', { campaignId: campaign.id }));
  return { dm, session, campaign };
}

/** Logs a player in, creates a character, joins the session with it. */
async function joinWithNewCharacter(username: string, code: string, characterName = `${username}'s hero`) {
  const sock = await client(await login(username));
  const { character } = ok(await sock.emitWithAck('character:create', { name: characterName }));
  const { session } = ok(await sock.emitWithAck('session:join', { code, characterId: character.id }));
  return { sock, character, session };
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

describe('characters', () => {
  it('lets players create, edit, list and delete their own characters', async () => {
    const mira = await client(await login('Mira'));
    const { character } = ok(await mira.emitWithAck('character:create', { name: 'Elowen' }));
    expect(character).toMatchObject({ data: { name: 'Elowen', level: 1 }, campaign: null, inSession: null });
    ok(await mira.emitWithAck('character:update', { characterId: character.id, patch: { className: 'Wizard' } }));
    // HP, items and coins belong to the DM unless they unlock them.
    expect(await mira.emitWithAck('item:add', { characterId: character.id, item: { name: 'Spellbook' } })).toMatchObject({ ok: false });
    expect(await mira.emitWithAck('character:adjustHp', { characterId: character.id, delta: 5 })).toMatchObject({ ok: false });
    expect(await mira.emitWithAck('character:update', { characterId: character.id, patch: { coins: { cp: 0, sp: 0, ep: 0, gp: 999, pp: 0 } } })).toMatchObject({ ok: false });
    expect(await mira.emitWithAck('character:update', { characterId: character.id, patch: { hpItemsUnlocked: true } })).toMatchObject({ ok: false });
    const { characters } = ok(await mira.emitWithAck('character:list'));
    expect(characters).toHaveLength(1);
    expect(characters[0]?.data).toMatchObject({ className: 'Wizard', inventory: [], hpItemsUnlocked: false });

    const jonas = await client(await login('Jonas'));
    expect(await jonas.emitWithAck('character:update', { characterId: character.id, patch: { level: 5 } })).toMatchObject({ ok: false });
    expect(await jonas.emitWithAck('character:delete', { characterId: character.id })).toMatchObject({ ok: false });
    ok(await mira.emitWithAck('character:delete', { characterId: character.id }));
    expect(ok(await mira.emitWithAck('character:list')).characters).toEqual([]);
    expect(await mira.emitWithAck('character:create', { name: '  ' })).toMatchObject({ ok: false });
    const full = ok(
      await mira.emitWithAck('character:create', {
        name: 'Brakka',
        data: { className: 'Barbarian', level: 3, inventory: [{ id: 'x', name: 'Greataxe', qty: 1, notes: '' }] },
      }),
    );
    expect(full.character.data).toMatchObject({ name: 'Brakka', className: 'Barbarian', level: 3, inventory: [{ name: 'Greataxe' }] });
    expect(await mira.emitWithAck('character:create', { name: 'Bad', data: { level: 99 } })).toMatchObject({ ok: false });
  });
});

describe('campaign sessions', () => {
  it('runs the lobby: pick a character, ready up, DM starts', async () => {
    const { dm, session } = await hostCampaign();
    expect(session).toMatchObject({ started: false, players: [], host: { username: 'Faris', online: true } });

    const mira = await client(await login('Mira'));
    const elowen = ok(await mira.emitWithAck('character:create', { name: 'Elowen' })).character;
    const peek = ok(await mira.emitWithAck('session:peek', { code: session.code.toLowerCase() }));
    expect(peek).toMatchObject({ campaign: { name: 'Curse of the Hollow Crown' }, rejoin: false });
    expect(peek.characters.map((c) => c.id)).toEqual([elowen.id]);
    expect(await mira.emitWithAck('session:join', { code: session.code })).toMatchObject({ ok: false });

    const dmSeesMira = nextState(dm, (s) => s.players.length === 1);
    const joined = ok(await mira.emitWithAck('session:join', { code: session.code, characterId: elowen.id }));
    expect(joined.session.players[0]).toMatchObject({ characterId: elowen.id, ready: false, character: { name: 'Elowen' } });
    await dmSeesMira;
    expect(ok(await mira.emitWithAck('session:peek', { code: session.code })).rejoin).toBe(true);

    const dmSeesReady = nextState(dm, (s) => s.players[0]?.ready === true);
    ok(await mira.emitWithAck('session:ready', { ready: true }));
    await dmSeesReady;

    expect(await mira.emitWithAck('session:start')).toMatchObject({ ok: false });
    const miraSeesStart = nextState(mira, (s) => s.started);
    ok(await dm.emitWithAck('session:start'));
    await miraSeesStart;
  });

  it('only lets owners host their campaigns and lists them', async () => {
    const { campaign } = await hostCampaign();
    const mira = await client(await login('Mira'));
    expect(await mira.emitWithAck('session:host', { campaignId: campaign.id })).toMatchObject({ ok: false });
    expect(ok(await mira.emitWithAck('campaign:list')).campaigns).toEqual([]);
  });

  it('makes sheets read-only for players in a session; the DM edits them', async () => {
    const { dm, session } = await hostCampaign();
    const { sock: mira, character } = await joinWithNewCharacter('Mira', session.code, 'Elowen');
    const { sock: jonas } = await joinWithNewCharacter('Jonas', session.code);
    ok(await dm.emitWithAck('session:start'));
    const id = character.id;

    expect(await mira.emitWithAck('character:update', { characterId: id, patch: { level: 20 } })).toMatchObject({ ok: false });
    expect(await mira.emitWithAck('character:adjustHp', { characterId: id, delta: 5 })).toMatchObject({ ok: false });
    expect(await mira.emitWithAck('item:add', { characterId: id, item: { name: 'Gold bar' } })).toMatchObject({ ok: false });
    expect(await jonas.emitWithAck('character:adjustHp', { characterId: id, delta: -5 })).toMatchObject({ ok: false });

    const miraSeesHit = nextState(mira, (s) => s.players[0]?.character.hpCurrent === 3);
    ok(await dm.emitWithAck('character:adjustHp', { characterId: id, delta: -7 }));
    await miraSeesHit;
    const given = ok(await dm.emitWithAck('item:add', { characterId: id, item: { name: 'Potion of Healing', qty: 2 } }));
    const potion = given.character.data.inventory[0]!;
    expect(ok(await dm.emitWithAck('item:update', { characterId: id, itemId: potion.id, patch: { qty: 1 } })).character.data.inventory[0]?.qty).toBe(1);
    expect(ok(await dm.emitWithAck('item:remove', { characterId: id, itemId: potion.id })).character.data.inventory).toEqual([]);
    ok(await dm.emitWithAck('character:update', { characterId: id, patch: { level: 2 } }));
    expect(await dm.emitWithAck('character:adjustHp', { characterId: id, delta: 1.5 })).toMatchObject({ ok: false });
    expect(await dm.emitWithAck('character:update', { characterId: id, patch: { inventory: [] } as never })).toMatchObject({ ok: false });
  });

  it('lets the DM unlock HP and items for one player', async () => {
    const { dm, session } = await hostCampaign();
    const { sock: mira, character } = await joinWithNewCharacter('Mira', session.code, 'Elowen');
    ok(await dm.emitWithAck('session:start'));
    const id = character.id;

    expect(await mira.emitWithAck('character:update', { characterId: id, patch: { hpItemsUnlocked: true } })).toMatchObject({ ok: false });
    ok(await dm.emitWithAck('character:update', { characterId: id, patch: { hpItemsUnlocked: true } }));

    ok(await mira.emitWithAck('character:adjustHp', { characterId: id, delta: -2 }));
    ok(await mira.emitWithAck('item:add', { characterId: id, item: { name: 'Torch', qty: 3 } }));
    ok(await mira.emitWithAck('character:update', { characterId: id, patch: { coins: { cp: 0, sp: 0, ep: 0, gp: 5, pp: 0 }, hpTemp: 2 } }));
    // Everything else stays with the DM during the session.
    expect(await mira.emitWithAck('character:update', { characterId: id, patch: { level: 20 } })).toMatchObject({ ok: false });
    expect(await mira.emitWithAck('character:update', { characterId: id, patch: { hpItemsUnlocked: false } })).toMatchObject({ ok: false });

    ok(await dm.emitWithAck('character:update', { characterId: id, patch: { hpItemsUnlocked: false } }));
    expect(await mira.emitWithAck('character:adjustHp', { characterId: id, delta: 1 })).toMatchObject({ ok: false });
  });

  it('tracks spell slots and uses, shows the DM the last action, and refreshes on a rest', async () => {
    const { dm, session } = await hostCampaign();
    const { sock: mira, character } = await joinWithNewCharacter('Mira', session.code, 'Elowen');
    const id = character.id;
    ok(await dm.emitWithAck('character:update', {
      characterId: id,
      patch: { className: 'Wizard', level: 1, spells: [{ id: 'mm', name: 'Magic Missile', level: 1, prepared: true }] },
    }));
    ok(await dm.emitWithAck('session:start'));

    // Players can't rewrite their own counters, only spend through character:use.
    expect(await mira.emitWithAck('character:update', { characterId: id, patch: { used: {} } })).toMatchObject({ ok: false });

    const dmSees = nextState(dm, (s) => s.players[0]?.character.lastAction?.name === 'Magic Missile');
    ok(await mira.emitWithAck('character:use', { characterId: id, use: { kind: 'spell', spellId: 'mm' } }));
    expect((await dmSees).players[0]?.character.lastAction).toMatchObject({ detail: '1st-level slot' });
    ok(await mira.emitWithAck('character:use', { characterId: id, use: { kind: 'spell', spellId: 'mm' } }));
    const out = await mira.emitWithAck('character:use', { characterId: id, use: { kind: 'spell', spellId: 'mm' } });
    expect(out).toMatchObject({ ok: false, error: expect.stringMatching(/No spell slots/) });

    // Only the DM calls rests during a session.
    expect(await mira.emitWithAck('character:rest', { characterId: id, kind: 'long' })).toMatchObject({ ok: false });
    expect(await mira.emitWithAck('session:rest', { kind: 'long' })).toMatchObject({ ok: false });
    const rested = nextState(mira, (s) => Object.keys(s.players[0]?.character.used ?? { x: 1 }).length === 0);
    ok(await dm.emitWithAck('session:rest', { kind: 'long' }));
    await rested;
  });

  it('handles concentration, conditions and death saves', async () => {
    const { dm, session } = await hostCampaign();
    const { sock: mira, character } = await joinWithNewCharacter('Mira', session.code, 'Elowen');
    const id = character.id;
    ok(await dm.emitWithAck('character:update', {
      characterId: id,
      patch: {
        className: 'Wizard', level: 1, hpMax: 30, hpCurrent: 30,
        spells: [{ id: 'dm', name: 'Detect Magic', level: 1, prepared: true, ref: 'detect-magic' }],
      },
    }));
    ok(await dm.emitWithAck('session:start'));

    const cast = ok(await mira.emitWithAck('character:use', { characterId: id, use: { kind: 'spell', spellId: 'dm' } }));
    expect(cast.character.data.concentration).toEqual({ name: 'Detect Magic', ref: 'detect-magic', saveDc: null });
    const hit = ok(await dm.emitWithAck('character:adjustHp', { characterId: id, delta: -24 }));
    expect(hit.character.data.concentration?.saveDc).toBe(12);
    const kept = ok(await mira.emitWithAck('character:concentration', { characterId: id, action: 'kept' }));
    expect(kept.character.data.concentration?.saveDc).toBeNull();

    // Conditions are the DM's; an incapacitating one ends concentration.
    expect(await mira.emitWithAck('character:update', { characterId: id, patch: { conditions: [] } })).toMatchObject({ ok: false });
    const stunned = ok(await dm.emitWithAck('character:update', { characterId: id, patch: { conditions: ['stunned'] } }));
    expect(stunned.character.data).toMatchObject({ conditions: ['stunned'], concentration: null });

    // Down to 0: the player records death saves, the DM sees them.
    expect(await mira.emitWithAck('character:deathSave', { characterId: id, result: 'success' })).toMatchObject({ ok: false });
    ok(await dm.emitWithAck('character:adjustHp', { characterId: id, delta: -6 }));
    const dmSees = nextState(dm, (s) => s.players[0]?.character.deathSaves.failures === 2);
    ok(await mira.emitWithAck('character:deathSave', { characterId: id, result: 'nat1' }));
    await dmSees;
    const up = ok(await mira.emitWithAck('character:deathSave', { characterId: id, result: 'nat20' }));
    expect(up.character.data).toMatchObject({ hpCurrent: 1, deathSaves: { successes: 0, failures: 0 } });
  });

  it('levels a character up through the wizard choices', async () => {
    const mira = await client(await login('Mira'));
    const { character } = ok(await mira.emitWithAck('character:create', {
      name: 'Bram',
      data: { className: 'Fighter', level: 2, hpMax: 20 },
    }));
    expect(await mira.emitWithAck('character:levelUp', { characterId: character.id, choices: {} })).toMatchObject({
      ok: false,
      error: 'Pick a subclass.',
    });
    const res = ok(await mira.emitWithAck('character:levelUp', {
      characterId: character.id,
      choices: { hpRoll: 9, subclassId: 'champion' },
    }));
    expect(res.character.data).toMatchObject({ level: 3, subclass: 'Champion', hpMax: 29 });

    // In a session the DM says when; the player still does it, on their own phone.
    const { dm, session } = await hostCampaign();
    ok(await mira.emitWithAck('session:join', { code: session.code, characterId: character.id }));
    const choices = { featId: 'ability-score-improvement', asi: { str: 2 } };
    expect(await mira.emitWithAck('character:levelUp', { characterId: character.id, choices })).toMatchObject({ ok: false });
    expect(await dm.emitWithAck('character:levelUp', { characterId: character.id, choices })).toMatchObject({ ok: false });
    expect(await mira.emitWithAck('character:update', { characterId: character.id, patch: { levelUpReady: true } })).toMatchObject({ ok: false });
    ok(await dm.emitWithAck('character:update', { characterId: character.id, patch: { levelUpReady: true } }));
    expect(ok(await mira.emitWithAck('character:levelUp', { characterId: character.id, choices })).character.data).toMatchObject({
      level: 4,
      abilities: { str: 12 },
      levelUpReady: false,
    });
    // One grant, one level.
    expect(await mira.emitWithAck('character:levelUp', { characterId: character.id, choices: {} })).toMatchObject({ ok: false });
  });

  it('stores a portrait for a character, only for its owner', async () => {
    const token = await login('Mira');
    const mira = await client(token);
    const { character } = ok(await mira.emitWithAck('character:create', { name: 'Elowen' }));
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
    const put = (tok: string, body: Buffer, type = 'image/png') =>
      fetch(`${url}/api/characters/${character.id}/portrait`, { method: 'PUT', headers: { authorization: `Bearer ${tok}`, 'content-type': type }, body: new Uint8Array(body) });

    expect((await fetch(`${url}/api/portraits/${character.id}`)).status).toBe(404);
    expect((await put(await login('Jonas'), png)).status).toBe(404);
    expect((await put(token, Buffer.from('not a picture at all'))).status).toBe(400);
    const res = await put(token, png);
    expect(res.status).toBe(200);
    const version = ((await res.json()) as { character: { data: { portrait: string } } }).character.data.portrait;
    expect(version).not.toBe('');

    const got = await fetch(`${url}/api/portraits/${character.id}?v=${version}`);
    expect(got.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await got.arrayBuffer()).equals(png)).toBe(true);

    // The version can't be set by hand, and deleting the picture clears it.
    expect(await mira.emitWithAck('character:update', { characterId: character.id, patch: { portrait: 'x' } })).toMatchObject({ ok: false });
    const del = await fetch(`${url}/api/characters/${character.id}/portrait`, { method: 'DELETE', headers: { authorization: `Bearer ${token}` } });
    expect(((await del.json()) as { character: { data: { portrait: string } } }).character.data.portrait).toBe('');
    expect((await fetch(`${url}/api/portraits/${character.id}`)).status).toBe(404);
  });

  it('lets characters travel between campaigns, one session at a time', async () => {
    const { dm, session } = await hostCampaign('Campaign A');
    const { sock: mira, character } = await joinWithNewCharacter('Mira', session.code, 'Elowen');
    ok(await dm.emitWithAck('session:start'));
    ok(await dm.emitWithAck('character:adjustHp', { characterId: character.id, delta: -4 }));

    // Faris opens a second campaign at the same time.
    const { session: b } = ok(
      await dm.emitWithAck('session:host', {
        campaignId: ok(await dm.emitWithAck('campaign:create', { name: 'Campaign B' })).campaign.id,
      }),
    );
    const mira2 = await client(await login('Mira'));
    expect(ok(await mira2.emitWithAck('session:peek', { code: b.code })).characters).toEqual([]);
    expect(await mira2.emitWithAck('session:join', { code: b.code, characterId: character.id })).toMatchObject({ ok: false });

    // After leaving A, Elowen can join B and brings her HP along.
    ok(await mira.emitWithAck('session:leave'));
    const inB = ok(await mira2.emitWithAck('session:join', { code: b.code, characterId: character.id }));
    expect(inB.session.players[0]?.character).toMatchObject({ name: 'Elowen', hpCurrent: 6 });
  });

  it('frees characters when the DM ends the session, and they can be edited again', async () => {
    const { dm, session } = await hostCampaign();
    const { sock: mira, character } = await joinWithNewCharacter('Mira', session.code);
    ok(await dm.emitWithAck('session:start'));
    const miraTold = new Promise<void>((resolve) => mira.on('session:ended', () => resolve()));
    ok(await dm.emitWithAck('session:end'));
    await miraTold;
    const list = ok(await mira.emitWithAck('character:list')).characters;
    expect(list[0]).toMatchObject({ inSession: null, campaign: { name: 'Curse of the Hollow Crown' } });
    ok(await mira.emitWithAck('character:update', { characterId: character.id, patch: { level: 2 } }));
  });

  it('keeps the session when the DM drops, and the DM gets back in', async () => {
    const { dm, session } = await hostCampaign();
    const { sock: mira } = await joinWithNewCharacter('Mira', session.code);

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
    const { dm, session } = await hostCampaign();
    const token = await login('Mira');
    const mira = await client(token);
    const { character } = ok(await mira.emitWithAck('character:create', { name: 'Elowen' }));
    ok(await mira.emitWithAck('session:join', { code: session.code, characterId: character.id }));
    ok(await mira.emitWithAck('session:ready', { ready: true }));
    ok(await dm.emitWithAck('session:start'));
    ok(await dm.emitWithAck('character:adjustHp', { characterId: character.id, delta: -6 }));

    const restarted = await startApp(store);
    try {
      const again = await client(token, restarted.url);
      const res = ok(await again.emitWithAck('session:join', { code: session.code }));
      expect(res.session.started).toBe(true);
      expect(res.session.players[0]).toMatchObject({ ready: true, character: { hpCurrent: 4 } });
      again.disconnect();
    } finally {
      await restarted.io.close();
    }
  });

  it('lets a player leave while keeping their character', async () => {
    const { dm, session } = await hostCampaign();
    const { sock: mira } = await joinWithNewCharacter('Mira', session.code);
    const dmSeesLeave = nextState(dm, (s) => s.players.length === 0);
    ok(await mira.emitWithAck('session:leave'));
    await dmSeesLeave;
    expect(await dm.emitWithAck('session:leave')).toMatchObject({ ok: false });
    expect(ok(await mira.emitWithAck('character:list')).characters[0]?.inSession).toBeNull();
  });

  it('rejects unknown codes', async () => {
    const mira = await client(await login('Mira'));
    expect(await mira.emitWithAck('session:peek', { code: 'ZZZZZ' })).toMatchObject({ ok: false });
    expect(await mira.emitWithAck('session:join', { code: 'ZZZZZ' })).toMatchObject({ ok: false });
  });
});

describe('migration', () => {
  it('turns first-prototype characters into player-owned ones', async () => {
    const { DatabaseSync } = await import('node:sqlite');
    const { mkdtempSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const path = join(mkdtempSync(join(tmpdir(), 'dnd-')), 'old.sqlite');
    const old = new DatabaseSync(path);
    old.exec(`
      CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE, password_hash TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
      CREATE TABLE campaigns (id TEXT PRIMARY KEY, name TEXT NOT NULL, owner_id TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), last_played_at TEXT);
      CREATE TABLE characters (campaign_id TEXT NOT NULL, user_id TEXT NOT NULL, data TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (campaign_id, user_id));
      CREATE TABLE live_sessions (code TEXT PRIMARY KEY, campaign_id TEXT NOT NULL UNIQUE, started_at TEXT);
      CREATE TABLE session_players (code TEXT NOT NULL, user_id TEXT NOT NULL, PRIMARY KEY (code, user_id));
      INSERT INTO users (id, username) VALUES ('u1', 'Mira'), ('u2', 'Faris');
      INSERT INTO campaigns (id, name, owner_id) VALUES ('c1', 'Old Campaign', 'u2');
      INSERT INTO characters (campaign_id, user_id, data) VALUES ('c1', 'u1', '{"name":"Elowen","level":3}');
      INSERT INTO live_sessions (code, campaign_id) VALUES ('ABCDE', 'c1');
      INSERT INTO session_players (code, user_id) VALUES ('ABCDE', 'u1');
    `);
    old.close();
    const migrated = new Store(path);
    const [ch] = migrated.listCharacters('u1');
    expect(ch).toMatchObject({ data: { name: 'Elowen', level: 3 }, campaign: { name: 'Old Campaign' }, inSession: null });
    migrated.close();
  });
});
