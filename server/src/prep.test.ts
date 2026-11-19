import { existsSync, mkdtempSync, readdirSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { io as connect, type Socket } from 'socket.io-client';
import type { Ack, ClientToServerEvents, LoginResult, ServerToClientEvents, SessionState } from '@dnd/shared';
import { createApp, type IoServer } from './app.ts';
import { Store } from './store.ts';

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;

let store: Store;
let io: IoServer;
let url: string;
let uploadsDir: string;
const clients: Client[] = [];

beforeEach(async () => {
  store = new Store(':memory:');
  for (const name of ['Faris', 'Mira', 'Jonas']) store.addUser(name);
  uploadsDir = mkdtempSync(join(tmpdir(), 'dnd-uploads-'));
  const app = createApp({ store, uploadsDir });
  await new Promise<void>((resolve) => app.httpServer.listen(0, resolve));
  io = app.io;
  url = `http://localhost:${(app.httpServer.address() as AddressInfo).port}`;
});

afterEach(async () => {
  clients.splice(0).forEach((c) => c.disconnect());
  await io.close();
  store.close();
});

async function login(username: string): Promise<string> {
  const res = await fetch(url + '/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: 'secret123' }),
  });
  return ((await res.json()) as LoginResult).token;
}

async function client(token: string): Promise<Client> {
  const c: Client = connect(url, { transports: ['websocket'], forceNew: true, auth: { token } });
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

/** Faris runs a campaign with Mira in it; the session has started. */
async function table() {
  const dmToken = await login('Faris');
  const dm = await client(dmToken);
  const { campaign } = ok(await dm.emitWithAck('campaign:create', { name: 'Hollow Crown' }));
  const { session } = ok(await dm.emitWithAck('session:host', { campaignId: campaign.id }));
  const mira = await client(await login('Mira'));
  const { character } = ok(await mira.emitWithAck('character:create', { name: 'Elowen', data: { abilities: { str: 8, dex: 16, con: 12, int: 17, wis: 12, cha: 10 } } }));
  ok(await mira.emitWithAck('session:join', { code: session.code, characterId: character.id }));
  ok(await dm.emitWithAck('session:start'));
  return { dm, dmToken, mira, campaign, character, code: session.code };
}

const upload = (campaignId: string, token: string, type = 'image/png') =>
  fetch(`${url}/api/campaigns/${campaignId}/images`, {
    method: 'POST',
    headers: { 'content-type': type, authorization: `Bearer ${token}` },
    body: new Uint8Array([137, 80, 78, 71]),
  });

describe('campaign prep', () => {
  it('lets only the DM plan handouts and NPCs, and keeps them with the campaign', async () => {
    const { dm, mira, campaign } = await table();
    const { npc } = ok(await dm.emitWithAck('npc:save', { campaignId: campaign.id, npc: { name: 'Goblin', hpMax: 7, armorClass: 15, personality: 'Cowardly, loves shiny things' } }));
    ok(await dm.emitWithAck('npc:save', { campaignId: campaign.id, npc: { ...npc, hpMax: 9 } }));
    ok(await dm.emitWithAck('handout:save', { campaignId: campaign.id, handout: { title: 'Letter', text: 'Meet me at the mill.' } }));
    expect(await dm.emitWithAck('handout:save', { campaignId: campaign.id, handout: { title: 'Empty' } })).toMatchObject({ ok: false });

    const { prep } = ok(await dm.emitWithAck('prep:get', { campaignId: campaign.id }));
    expect(prep.npcs).toMatchObject([{ id: npc.id, name: 'Goblin', hpMax: 9, role: 'opponent' }]);
    expect(prep.handouts).toMatchObject([{ title: 'Letter', imageUrl: null }]);

    expect(await mira.emitWithAck('prep:get', { campaignId: campaign.id })).toMatchObject({ ok: false });
    expect(await mira.emitWithAck('npc:save', { campaignId: campaign.id, npc: { name: 'Hacker' } })).toMatchObject({ ok: false });
    expect(await mira.emitWithAck('npc:delete', { campaignId: campaign.id, npcId: npc.id })).toMatchObject({ ok: false });
    expect(ok(await dm.emitWithAck('prep:get', { campaignId: campaign.id })).prep.npcs).toHaveLength(1);
  });

  it('stores uploaded pictures for the DM only and removes them with the handout', async () => {
    const { dm, dmToken, campaign } = await table();
    expect((await upload(campaign.id, await login('Mira'))).status).toBe(403);
    expect((await upload(campaign.id, dmToken, 'image/svg+xml')).status).toBe(400);
    const res = await upload(campaign.id, dmToken);
    const { url: imageUrl } = (await res.json()) as { url: string };
    expect((await fetch(url + imageUrl)).headers.get('content-type')).toBe('image/png');

    const { handout } = ok(await dm.emitWithAck('handout:save', { campaignId: campaign.id, handout: { title: 'Map', imageUrl } }));
    expect(readdirSync(uploadsDir)).toHaveLength(1);
    ok(await dm.emitWithAck('handout:delete', { campaignId: campaign.id, handoutId: handout.id }));
    await expect.poll(() => existsSync(join(uploadsDir, imageUrl.split('/').pop()!))).toBe(false);
  });
});

describe('DM tools in a session', () => {
  it("puts a handout on the players' screens and takes it away again", async () => {
    const { dm, mira, campaign } = await table();
    const { handout } = ok(await dm.emitWithAck('handout:save', { campaignId: campaign.id, handout: { title: 'Letter', text: 'Meet me at the mill.' } }));
    expect(await mira.emitWithAck('handout:show', { handoutId: handout.id })).toMatchObject({ ok: false });

    let seen = nextState(mira, (s) => s.handout !== null);
    ok(await dm.emitWithAck('handout:show', { handoutId: handout.id }));
    expect((await seen).handout).toMatchObject({ title: 'Letter', text: 'Meet me at the mill.' });

    seen = nextState(mira, (s) => s.handout === null);
    ok(await dm.emitWithAck('handout:show', { handoutId: null }));
    await seen;
  });

  it('starts a fight: alerts everyone, rolls initiative, hides opponent HP from players', async () => {
    const { dm, mira, campaign, character } = await table();
    const { npc } = ok(await dm.emitWithAck('npc:save', { campaignId: campaign.id, npc: { name: 'Goblin', hpMax: 7, armorClass: 15, abilities: { str: 8, dex: 14, con: 10, int: 10, wis: 8, cha: 8 } } }));
    expect(await mira.emitWithAck('combat:start', { npcs: [] })).toMatchObject({ ok: false });

    const alert = new Promise((resolve) => mira.once('session:alert', resolve));
    let dmSees = nextState(dm, (s) => s.combat !== null);
    let miraSees = nextState(mira, (s) => s.combat !== null);
    ok(await dm.emitWithAck('combat:start', { npcs: [{ npcId: npc.id, count: 2 }] }));
    expect(await alert).toEqual({ kind: 'fight' });

    const combat = (await dmSees).combat!;
    expect(combat.combatants.map((c) => c.name).sort()).toEqual(['Elowen', 'Goblin 1', 'Goblin 2']);
    expect(combat.combatants.find((c) => c.ref === character.id)).toMatchObject({ kind: 'player', bonus: 3, initiative: null });
    const goblin = combat.combatants.find((c) => c.kind === 'npc')!;
    expect(goblin).toMatchObject({ bonus: 2, hp: { current: 7, max: 7 }, armorClass: 15 });
    expect((await miraSees).combat!.combatants.every((c) => c.hp === undefined && c.armorClass === undefined)).toBe(true);

    dmSees = nextState(dm, (s) => !!s.combat?.combatants.every((c) => c.initiative !== null));
    ok(await dm.emitWithAck('combat:action', { type: 'roll' }));
    const rolled = (await dmSees).combat!.combatants;
    for (const c of rolled) expect(c.initiative).toBe(c.d20! + c.bonus);
    expect(rolled.map((c) => c.initiative)).toEqual([...rolled.map((c) => c.initiative!)].sort((a, b) => b - a));

    miraSees = nextState(mira, (s) => s.combat?.combatants[0]?.initiative === 30);
    ok(await dm.emitWithAck('combat:action', { type: 'set', id: goblin.id, value: 30 }));
    expect((await miraSees).combat!.combatants[0]!.id).toBe(goblin.id);
    ok(await dm.emitWithAck('combat:action', { type: 'hp', id: goblin.id, delta: -3 }));
    ok(await dm.emitWithAck('combat:action', { type: 'next' }));
    expect(await mira.emitWithAck('combat:action', { type: 'next' })).toMatchObject({ ok: false });
    expect(store.getSession((await dmSees).code)!.combat).toMatchObject({ activeId: goblin.id, round: 1, combatants: [{ hp: { current: 4 } }, {}, {}] });

    miraSees = nextState(mira, (s) => s.combat === null);
    ok(await dm.emitWithAck('combat:end'));
    await miraSees;
  });

  it('logs what happens and offers it as the recap of the next session', async () => {
    const { dm, mira, campaign, character } = await table();
    const { npc } = ok(await dm.emitWithAck('npc:save', { campaignId: campaign.id, npc: { name: 'Goblin', hpMax: 7 } }));
    const { handout } = ok(await dm.emitWithAck('handout:save', { campaignId: campaign.id, handout: { title: 'Old map', text: 'X marks the spot' } }));
    ok(await dm.emitWithAck('handout:show', { handoutId: handout.id }));
    const started = nextState(dm, (s) => s.combat !== null);
    ok(await dm.emitWithAck('combat:start', { npcs: [{ npcId: npc.id, count: 2 }] }));
    const goblin = (await started).combat!.combatants.find((c) => c.kind === 'npc')!;
    ok(await dm.emitWithAck('character:adjustHp', { characterId: character.id, delta: -4 }));
    ok(await dm.emitWithAck('character:adjustHp', { characterId: character.id, delta: 2 }));
    ok(await dm.emitWithAck('combat:action', { type: 'hp', id: goblin.id, delta: -20 }));
    ok(await dm.emitWithAck('combat:end'));
    ok(await dm.emitWithAck('item:add', { characterId: character.id, item: { name: 'Rope', qty: 2 } }));
    ok(await dm.emitWithAck('character:update', { characterId: character.id, patch: { coins: { cp: 0, sp: 0, ep: 0, gp: 15, pp: 0 } } }));

    expect(await mira.emitWithAck('log:get', { campaignId: campaign.id })).toMatchObject({ ok: false });
    const during = ok(await dm.emitWithAck('log:get', { campaignId: campaign.id }));
    expect(during.previous).toEqual([]);
    expect(during.current.map((e) => [e.kind, e.who, e.amount ?? e.what])).toEqual([
      ['start', '', 'Elowen'],
      ['handout', '', 'Old map'],
      ['fight', '', '2× Goblin'],
      ['damage', 'Elowen', 4],
      ['heal', 'Elowen', 2],
      ['hit', goblin.name, 7],
      ['defeated', goblin.name, undefined],
      ['fightEnd', '', 1],
      ['loot', 'Elowen', '2× Rope'],
      ['loot', 'Elowen', '15 gp'],
    ]);

    ok(await dm.emitWithAck('session:end'));
    // Editing a character outside a session is not logged.
    ok(await mira.emitWithAck('character:update', { characterId: character.id, patch: { level: 2 } }));
    ok(await dm.emitWithAck('session:host', { campaignId: campaign.id }));
    const lobby = ok(await dm.emitWithAck('log:get', { campaignId: campaign.id }));
    expect(lobby.current).toEqual([]);
    expect(lobby.previous.at(-1)).toMatchObject({ kind: 'end', session: 1 });
    ok(await dm.emitWithAck('session:start'));
    const second = ok(await dm.emitWithAck('log:get', { campaignId: campaign.id }));
    expect(second.current).toMatchObject([{ kind: 'start', session: 2 }]);
    expect(second.previous).toHaveLength(lobby.previous.length);
  });
});
