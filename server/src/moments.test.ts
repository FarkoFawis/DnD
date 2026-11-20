/**
 * The shared moments of a session: the title card when it starts, opponents
 * the DM keeps hidden, Heroic Inspiration, and the summary when it ends.
 */
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { io as connect, type Socket } from 'socket.io-client';
import { UNKNOWN_NAME, type Ack, type ClientToServerEvents, type LoginResult, type ServerToClientEvents, type SessionAlert, type SessionState, type SessionSummary } from '@dnd/shared';
import { createApp, type IoServer } from './app.ts';
import { Store } from './store.ts';

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;

let store: Store;
let io: IoServer;
let url: string;
const clients: Client[] = [];

beforeEach(async () => {
  store = new Store(':memory:');
  for (const name of ['Faris', 'Mira', 'Jonas']) store.addUser(name);
  const app = createApp({ store });
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

async function client(username: string): Promise<Client> {
  const c: Client = connect(url, { transports: ['websocket'], forceNew: true, auth: { token: await login(username) } });
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

const nextAlert = (c: Client, kind: SessionAlert['kind']) =>
  new Promise<SessionAlert>((resolve) => {
    const handler = (a: SessionAlert) => {
      if (a.kind !== kind) return;
      c.off('session:alert', handler);
      resolve(a);
    };
    c.on('session:alert', handler);
  });

/** Faris hosts "Hollow Crown"; Mira (Elowen) and Jonas (Brom) sit in the lobby. */
async function lobby() {
  const dm = await client('Faris');
  const { campaign } = ok(await dm.emitWithAck('campaign:create', { name: 'Hollow Crown' }));
  const { session } = ok(await dm.emitWithAck('session:host', { campaignId: campaign.id }));
  const mira = await client('Mira');
  const elowen = ok(await mira.emitWithAck('character:create', { name: 'Elowen' })).character;
  ok(await mira.emitWithAck('session:join', { code: session.code, characterId: elowen.id }));
  const jonas = await client('Jonas');
  const brom = ok(await jonas.emitWithAck('character:create', { name: 'Brom' })).character;
  ok(await jonas.emitWithAck('session:join', { code: session.code, characterId: brom.id }));
  return { dm, mira, jonas, campaign, elowen, brom, code: session.code };
}

describe('title card', () => {
  it('goes to every phone once, with the number of the session', async () => {
    const { dm, mira } = await lobby();
    const alerts: SessionAlert[] = [];
    mira.on('session:alert', (a) => alerts.push(a));
    const forDm = nextAlert(dm, 'start');
    ok(await dm.emitWithAck('session:start'));
    expect(await forDm).toEqual({ kind: 'start', session: 1 });
    // Starting again (a second tap, a reconnect) is not a new session.
    ok(await dm.emitWithAck('session:start'));
    ok(await dm.emitWithAck('session:rest', { kind: 'long' }));
    await expect.poll(() => alerts.length).toBe(2);
    expect(alerts).toEqual([{ kind: 'start', session: 1 }, { kind: 'rest', rest: 'long' }]);
  });
});

describe('hidden opponents', () => {
  it('are "Unknown" to the players until the DM reveals them', async () => {
    const { dm, mira, campaign } = await lobby();
    ok(await dm.emitWithAck('session:start'));
    const { npc } = ok(await dm.emitWithAck('npc:save', { campaignId: campaign.id, npc: { name: 'Cult leader', hpMax: 30 } }));
    const { npc: rat } = ok(await dm.emitWithAck('npc:save', { campaignId: campaign.id, npc: { name: 'Rat', hpMax: 2 } }));

    let dmSees = nextState(dm, (s) => s.combat !== null);
    let miraSees = nextState(mira, (s) => s.combat !== null);
    ok(await dm.emitWithAck('combat:start', { npcs: [{ npcId: npc.id, count: 1 }], hidden: true }));
    const leader = (await dmSees).combat!.combatants.find((c) => c.kind === 'npc')!;
    expect(leader).toMatchObject({ name: 'Cult leader', hidden: true, ref: npc.id });
    const masked = (await miraSees).combat!.combatants.find((c) => c.kind === 'npc')!;
    expect(masked).toEqual({ id: leader.id, kind: 'npc', ref: '', name: UNKNOWN_NAME, bonus: 0, initiative: null, d20: null, hidden: true });

    // Whoever joins the fight later is hidden or not as the DM says then.
    miraSees = nextState(mira, (s) => s.combat?.combatants.length === 4);
    ok(await dm.emitWithAck('combat:add', { npcs: [{ npcId: rat.id, count: 1 }] }));
    expect((await miraSees).combat!.combatants.filter((c) => c.kind === 'npc').map((c) => c.name).sort()).toEqual(['Rat', UNKNOWN_NAME]);
    // A reconnecting player gets the same.
    const again = ok(await mira.emitWithAck('session:join', { code: (await dmSees).code }));
    expect(again.session.combat!.combatants.some((c) => c.name === 'Cult leader')).toBe(false);

    expect(await mira.emitWithAck('combat:action', { type: 'reveal', id: leader.id, hidden: false })).toMatchObject({ ok: false });
    miraSees = nextState(mira, (s) => !!s.combat && s.combat.combatants.every((c) => !c.hidden));
    ok(await dm.emitWithAck('combat:action', { type: 'reveal', id: leader.id, hidden: false }));
    expect((await miraSees).combat!.combatants.find((c) => c.id === leader.id)).toMatchObject({ name: 'Cult leader' });
  });
});

describe('Heroic Inspiration', () => {
  it('is given by the DM, used up by the player, and logged', async () => {
    const { dm, mira, jonas, campaign, elowen, brom } = await lobby();
    ok(await dm.emitWithAck('session:start'));
    expect(elowen.data.inspiration).toBe(false);

    expect(await mira.emitWithAck('character:inspiration', { characterId: elowen.id, action: 'give' })).toMatchObject({ ok: false, error: 'Only the DM hands out Heroic Inspiration.' });
    expect(await mira.emitWithAck('character:update', { characterId: elowen.id, patch: { inspiration: true } })).toMatchObject({ ok: false });
    expect(await mira.emitWithAck('character:inspiration', { characterId: elowen.id, action: 'spend' })).toMatchObject({ ok: false });

    const told = nextAlert(mira, 'inspiration');
    let seen = nextState(jonas, (s) => s.players.some((p) => p.character.inspiration));
    expect(ok(await dm.emitWithAck('character:inspiration', { characterId: elowen.id, action: 'give' })).character.data.inspiration).toBe(true);
    expect(await told).toEqual({ kind: 'inspiration', characterId: elowen.id });
    expect((await seen).players.find((p) => p.characterId === elowen.id)!.character.inspiration).toBe(true);
    // Nobody holds two.
    expect(await dm.emitWithAck('character:inspiration', { characterId: elowen.id, action: 'give' })).toMatchObject({ ok: false });
    // Only your own.
    ok(await dm.emitWithAck('character:inspiration', { characterId: brom.id, action: 'give' }));
    expect(await mira.emitWithAck('character:inspiration', { characterId: brom.id, action: 'spend' })).toMatchObject({ ok: false });

    seen = nextState(dm, (s) => !s.players.find((p) => p.characterId === elowen.id)!.character.inspiration);
    const spent = ok(await mira.emitWithAck('character:inspiration', { characterId: elowen.id, action: 'spend' })).character.data;
    expect(spent.inspiration).toBe(false);
    expect(spent.lastAction).toMatchObject({ name: 'Heroic Inspiration', kind: 'feature' });
    await seen;
    // The DM takes Brom's back: that is not "used".
    ok(await dm.emitWithAck('character:inspiration', { characterId: brom.id, action: 'take' }));

    const { current } = ok(await dm.emitWithAck('log:get', { campaignId: campaign.id }));
    expect(current.filter((e) => e.kind === 'inspiration').map((e) => [e.who, e.what])).toEqual([
      ['Elowen', 'gained'],
      ['Brom', 'gained'],
      ['Elowen', 'used'],
    ]);
  });

  it('comes back to a Human with a Long Rest', async () => {
    const { dm, mira, elowen } = await lobby();
    ok(await dm.emitWithAck('session:start'));
    ok(await dm.emitWithAck('character:update', {
      characterId: elowen.id,
      patch: { features: [{ id: 'f1', name: 'Resourceful', source: 'Human', ref: 'species:human:Resourceful' }] },
    }));
    const seen = nextState(mira, (s) => s.players.every((p) => p.characterId !== elowen.id || p.character.inspiration));
    ok(await dm.emitWithAck('session:rest', { kind: 'long' }));
    const players = (await seen).players;
    expect(players.map((p) => [p.character.name, p.character.inspiration])).toEqual([['Elowen', true], ['Brom', false]]);
  });
});

describe('session summary', () => {
  it('reaches every phone when the DM ends a session that was played', async () => {
    const { dm, mira, campaign, elowen } = await lobby();
    ok(await dm.emitWithAck('session:start'));
    const { npc } = ok(await dm.emitWithAck('npc:save', { campaignId: campaign.id, npc: { name: 'Secret villain', hpMax: 7 } }));
    const started = nextState(dm, (s) => s.combat !== null);
    ok(await dm.emitWithAck('combat:start', { npcs: [{ npcId: npc.id, count: 1 }], hidden: true }));
    const villain = (await started).combat!.combatants.find((c) => c.kind === 'npc')!;
    ok(await dm.emitWithAck('character:adjustHp', { characterId: elowen.id, delta: -4 }));
    ok(await dm.emitWithAck('combat:action', { type: 'hp', id: villain.id, delta: -7 }));
    ok(await mira.emitWithAck('character:use', { characterId: elowen.id, use: { kind: 'attack', name: 'Dagger' } }));
    ok(await mira.emitWithAck('character:use', { characterId: elowen.id, use: { kind: 'attack', name: 'Dagger' } }));
    ok(await dm.emitWithAck('combat:action', { type: 'next' }));

    const forMira = new Promise<SessionSummary | undefined>((resolve) => mira.once('session:ended', resolve));
    const forDm = ok(await dm.emitWithAck('session:end')).summary!;
    expect(forDm).toMatchObject({ session: 1, campaign: 'Hollow Crown', fights: 1, rounds: 1, defeated: 1, rests: { short: 0, long: 0 } });
    expect(forDm.characters).toEqual([
      { who: 'Elowen', damage: 4, healed: 0, downs: 0, used: 2, favourite: 'Dagger', loot: [], level: null },
      { who: 'Brom', damage: 0, healed: 0, downs: 0, used: 0, favourite: null, loot: [], level: null },
    ]);
    expect(await forMira).toEqual(forDm);
    // The players never learn who they fought.
    expect(JSON.stringify(forDm)).not.toContain('villain');
  });

  it('is not sent for a lobby that is closed before it starts', async () => {
    const { dm, mira } = await lobby();
    const forMira = new Promise<SessionSummary | undefined>((resolve) => mira.once('session:ended', resolve));
    expect(ok(await dm.emitWithAck('session:end')).summary).toBeUndefined();
    expect(await forMira).toBeUndefined();
  });
});
