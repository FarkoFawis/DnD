import { mkdtempSync, readdirSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { io as connect, type Socket } from 'socket.io-client';
import type { Ack, CampaignBackup, ClientToServerEvents, DiceRoll, ImportSummary, LoginResult, ServerToClientEvents, SessionState } from '@dnd/shared';
import { createApp, type IoServer } from './app.ts';
import { Store } from './store.ts';

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;

/** A server with its own database and uploads folder. */
interface World {
  store: Store;
  io: IoServer;
  url: string;
  uploadsDir: string;
}
const worlds: World[] = [];
const clients: Client[] = [];
let w: World;

async function world(users: string[]): Promise<World> {
  const store = new Store(':memory:');
  for (const name of users) store.addUser(name);
  const uploadsDir = mkdtempSync(join(tmpdir(), 'dnd-uploads-'));
  const app = createApp({ store, uploadsDir });
  await new Promise<void>((resolve) => app.httpServer.listen(0, resolve));
  const made = { store, io: app.io, uploadsDir, url: `http://localhost:${(app.httpServer.address() as AddressInfo).port}` };
  worlds.push(made);
  return made;
}

beforeEach(async () => {
  w = await world(['Faris', 'Mira', 'Jonas']);
});

afterEach(async () => {
  clients.splice(0).forEach((c) => c.disconnect());
  for (const x of worlds.splice(0)) {
    await x.io.close();
    x.store.close();
  }
});

async function login(username: string, at = w): Promise<string> {
  const res = await fetch(at.url + '/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: 'secret123' }),
  });
  return ((await res.json()) as LoginResult).token;
}

async function client(token: string, at = w): Promise<Client> {
  const c: Client = connect(at.url, { transports: ['websocket'], forceNew: true, auth: { token } });
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

const FIGHTER = {
  className: 'Fighter',
  level: 3,
  hpMax: 28,
  hpCurrent: 28,
  abilities: { str: 16, dex: 14, con: 14, int: 10, wis: 12, cha: 8 },
  skillProficiencies: ['athletics'],
  inventory: [{ id: 'sword', name: 'Longsword', qty: 1, notes: '', ref: 'longsword' }],
};

/** Faris runs a campaign with Mira's fighter Alba in it; the session has started. */
async function table() {
  const dmToken = await login('Faris');
  const dm = await client(dmToken);
  const { campaign } = ok(await dm.emitWithAck('campaign:create', { name: 'Hollow Crown' }));
  const { session } = ok(await dm.emitWithAck('session:host', { campaignId: campaign.id }));
  const miraToken = await login('Mira');
  const mira = await client(miraToken);
  const { character } = ok(await mira.emitWithAck('character:create', { name: 'Alba', data: FIGHTER as never }));
  ok(await mira.emitWithAck('session:join', { code: session.code, characterId: character.id }));
  ok(await dm.emitWithAck('session:start'));
  return { dm, dmToken, mira, miraToken, campaign, character, code: session.code };
}

describe('Hit Dice on a Short Rest', () => {
  it('opens when the DM calls a Short Rest, heals die + Constitution, and ends when the player is done', async () => {
    const { dm, mira, character, campaign } = await table();
    const id = character.id;
    expect(await mira.emitWithAck('character:hitDice', { characterId: id, action: 'spend', roll: 5 })).toMatchObject({ ok: false, error: expect.stringMatching(/DM decides/) });

    // 3 of 28 HP: two dice can never fill them up, so the rest stays open until Mira ends it.
    ok(await dm.emitWithAck('character:adjustHp', { characterId: id, delta: -25 }));
    const resting = nextState(mira, (s) => s.players[0]!.character.resting);
    ok(await dm.emitWithAck('session:rest', { kind: 'short' }));
    await resting;

    const first = ok(await mira.emitWithAck('character:hitDice', { characterId: id, action: 'spend', roll: 7 }));
    expect(first.spent).toEqual({ die: 10, roll: 7, modifier: 2, healed: 9 });
    expect(first.character.data).toMatchObject({ hpCurrent: 12, used: { hitDice: 1 }, resting: true });
    expect(await mira.emitWithAck('character:hitDice', { characterId: id, action: 'spend', roll: 11 })).toMatchObject({ ok: false });

    // Without a roll of their own, the server throws the d10.
    const second = ok(await mira.emitWithAck('character:hitDice', { characterId: id, action: 'spend' }));
    expect(second.spent!.roll).toBeGreaterThanOrEqual(1);
    expect(second.spent!.roll).toBeLessThanOrEqual(10);
    expect(second.character.data.used.hitDice).toBe(2);

    expect(ok(await mira.emitWithAck('character:hitDice', { characterId: id, action: 'done' })).character.data.resting).toBe(false);
    expect(await mira.emitWithAck('character:hitDice', { characterId: id, action: 'spend', roll: 3 })).toMatchObject({ ok: false });
    // Tapping Done twice does no harm.
    expect(ok(await mira.emitWithAck('character:hitDice', { characterId: id, action: 'done' })).character.data.resting).toBe(false);

    // The DM can still spend one for them, and a Long Rest brings every die back.
    ok(await dm.emitWithAck('character:hitDice', { characterId: id, action: 'spend', roll: 1 }));
    const after = ok(await dm.emitWithAck('character:rest', { characterId: id, kind: 'long' }));
    expect(after.character.data).toMatchObject({ hpCurrent: 28, used: {}, resting: false });

    const log = ok(await dm.emitWithAck('log:get', { campaignId: campaign.id })).current;
    expect(log.filter((e) => e.kind === 'heal' && e.what?.startsWith('Hit Die'))[0]).toMatchObject({ who: 'Alba', amount: 9 });
  });

  it('does not open a rest for someone at full HP, and a fight ends an open one', async () => {
    const { dm, mira, character } = await table();
    ok(await dm.emitWithAck('session:rest', { kind: 'short' }));
    expect(w.store.getCharacter(character.id)!.data.resting).toBe(false);

    ok(await dm.emitWithAck('character:adjustHp', { characterId: character.id, delta: -5 }));
    ok(await dm.emitWithAck('character:rest', { characterId: character.id, kind: 'short' }));
    expect(w.store.getCharacter(character.id)!.data.resting).toBe(true);
    ok(await dm.emitWithAck('combat:start', { npcs: [] }));
    expect(w.store.getCharacter(character.id)!.data.resting).toBe(false);
    expect(await mira.emitWithAck('character:hitDice', { characterId: character.id, action: 'spend', roll: 3 })).toMatchObject({ ok: false });
  });

  it('lets players spend them on their own outside a session, but never on someone else', async () => {
    const mira = await client(await login('Mira'));
    const jonas = await client(await login('Jonas'));
    const { character } = ok(await mira.emitWithAck('character:create', { name: 'Alba', data: { ...FIGHTER, hpCurrent: 4 } as never }));
    expect(await jonas.emitWithAck('character:hitDice', { characterId: character.id, action: 'spend', roll: 3 })).toMatchObject({ ok: false });
    const res = ok(await mira.emitWithAck('character:hitDice', { characterId: character.id, action: 'spend', roll: 3 }));
    expect(res.character.data).toMatchObject({ hpCurrent: 9, used: { hitDice: 1 } });
  });
});

describe('dice roller', () => {
  it('rolls with the bonus from the sheet and shows the DM, and only the DM, the result', async () => {
    const { dm, mira, character, campaign, code } = await table();
    const jonas = await client(await login('Jonas'));
    const { character: other } = ok(await jonas.emitWithAck('character:create', { name: 'Borin' }));
    ok(await jonas.emitWithAck('session:join', { code, characterId: other.id }));
    const seenByDm: DiceRoll[] = [];
    const seenByJonas: DiceRoll[] = [];
    dm.on('session:roll', (r) => seenByDm.push(r));
    jonas.on('session:roll', (r) => seenByJonas.push(r));

    const state = nextState(dm, (s) => s.players[0]!.character.lastAction?.roll === true);
    const { result } = ok(await mira.emitWithAck('character:roll', { characterId: character.id, roll: { kind: 'skill', skill: 'athletics' }, mode: 'advantage' }));
    expect(result).toMatchObject({ who: 'Alba', label: 'Athletics check', mode: 'advantage', modifier: 5, sides: 20 });
    expect(result.rolls).toHaveLength(2);
    expect(result.kept).toBe(Math.max(...result.rolls));
    expect(result.total).toBe(result.kept + 5);
    expect((await state).players[0]!.character.lastAction).toMatchObject({ name: 'Athletics check', roll: true });

    const damage = ok(await mira.emitWithAck('character:roll', { characterId: character.id, roll: { kind: 'damage', itemId: 'sword', crit: true } })).result;
    expect(damage).toMatchObject({ label: 'Longsword critical damage', modifier: 3, sides: 8, note: 'Slashing' });
    expect(damage.rolls).toHaveLength(2);
    expect(damage.total).toBe(damage.rolls[0]! + damage.rolls[1]! + 3);

    await new Promise((r) => setTimeout(r, 50));
    expect(seenByDm.map((r) => r.id)).toEqual([result.id, damage.id]);
    expect(seenByJonas).toEqual([]);
    const log = ok(await dm.emitWithAck('log:get', { campaignId: campaign.id })).current.filter((e) => e.kind === 'roll');
    expect(log.map((e) => e.what?.split(':')[0])).toEqual(['Athletics check', 'Longsword critical damage']);
  });

  it('refuses rolls for other people and for things that are not on the sheet', async () => {
    const { mira, character } = await table();
    const jonas = await client(await login('Jonas'));
    expect(await jonas.emitWithAck('character:roll', { characterId: character.id, roll: { kind: 'initiative' } })).toMatchObject({ ok: false });
    expect(await mira.emitWithAck('character:roll', { characterId: character.id, roll: { kind: 'attack', itemId: 'nope' } })).toMatchObject({ ok: false });
    expect(await mira.emitWithAck('character:roll', { characterId: character.id, roll: 'd20' as never })).toMatchObject({ ok: false });
    expect(await mira.emitWithAck('character:roll', { characterId: character.id, roll: { kind: 'spellAttack' } })).toMatchObject({ ok: false });
  });

  it('puts a rolled initiative into the turn order, once', async () => {
    const { dm, mira, character } = await table();
    ok(await dm.emitWithAck('combat:start', { npcs: [] }));
    const set = nextState(mira, (s) => s.combat?.combatants[0]?.initiative !== null);
    const { result } = ok(await mira.emitWithAck('character:roll', { characterId: character.id, roll: { kind: 'initiative' } }));
    expect((await set).combat!.combatants[0]).toMatchObject({ ref: character.id, initiative: result.total });
    // A second roll is shown to the DM but doesn't replace the first.
    ok(await mira.emitWithAck('character:roll', { characterId: character.id, roll: { kind: 'initiative' } }));
    expect(w.store.getSession((await set).code)!.combat!.combatants[0]!.initiative).toBe(result.total);
  });
});

describe('campaign backup', () => {
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82]);
  const exportFile = (campaignId: string, token: string, at = w) =>
    fetch(`${at.url}/api/campaigns/${campaignId}/export`, { headers: { authorization: `Bearer ${token}` } });
  const importFile = async (file: unknown, token: string, at = w, query = '') => {
    const res = await fetch(`${at.url}/api/campaigns/import${query}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: typeof file === 'string' ? file : JSON.stringify(file),
    });
    return { status: res.status, body: (await res.json()) as { summary?: ImportSummary; error?: string; missingPlayers?: string[] } };
  };

  /** A played campaign: a handout with a picture, an NPC, a log, Alba with a portrait. */
  async function played() {
    const t = await table();
    const up = await fetch(`${w.url}/api/campaigns/${t.campaign.id}/images`, {
      method: 'POST',
      headers: { 'content-type': 'image/png', authorization: `Bearer ${t.dmToken}` },
      body: PNG,
    });
    const { url: imageUrl } = (await up.json()) as { url: string };
    ok(await t.dm.emitWithAck('handout:save', { campaignId: t.campaign.id, handout: { title: 'Map', imageUrl } }));
    ok(await t.dm.emitWithAck('handout:save', { campaignId: t.campaign.id, handout: { title: 'Letter', text: 'Come at once.' } }));
    ok(await t.dm.emitWithAck('npc:save', { campaignId: t.campaign.id, npc: { name: 'Goblin', hpMax: 7, actions: 'Scimitar +4' } }));
    ok(await t.dm.emitWithAck('character:adjustHp', { characterId: t.character.id, delta: -6 }));
    ok(await t.dm.emitWithAck('item:add', { characterId: t.character.id, item: { name: 'Silver key' } }));
    await fetch(`${w.url}/api/characters/${t.character.id}/portrait`, {
      method: 'PUT',
      headers: { 'content-type': 'image/png', authorization: `Bearer ${t.miraToken}` },
      body: PNG,
    });
    return t;
  }

  it('saves everything in one file, for the DM only', async () => {
    const t = await played();
    expect((await exportFile(t.campaign.id, t.miraToken)).status).toBe(403);
    const res = await exportFile(t.campaign.id, t.dmToken);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toMatch(/attachment; filename="hollow-crown-\d{4}-\d\d-\d\d\.dnd-backup\.json"/);
    const file = (await res.json()) as CampaignBackup;
    expect(file).toMatchObject({ format: 'dnd-campaign-backup', version: 1, campaign: { id: t.campaign.id, name: 'Hollow Crown' } });
    expect(file.handouts).toMatchObject([{ title: 'Map', image: { mime: 'image/png' } }, { title: 'Letter', text: 'Come at once.' }]);
    expect(Buffer.from(file.handouts[0]!.image!.data, 'base64')).toEqual(Buffer.from(PNG));
    expect(file.npcs).toMatchObject([{ name: 'Goblin', hpMax: 7 }]);
    expect(file.log.map((e) => e.kind)).toEqual(['start', 'damage', 'loot']);
    expect(file.characters).toMatchObject([{ id: t.character.id, owner: 'Mira', data: { name: 'Alba', hpCurrent: 22 }, portrait: { mime: 'image/png' } }]);
  });

  it('brings a campaign back on a new database', async () => {
    const t = await played();
    const file = (await (await exportFile(t.campaign.id, t.dmToken)).json()) as CampaignBackup;

    // The PC's database is gone: a new one, with the accounts made again (Jonas left the group).
    const fresh = await world(['Faris', 'Mira']);
    const dmToken = await login('Faris', fresh);
    const { status, body } = await importFile(file, dmToken, fresh);
    expect(status).toBe(200);
    expect(body.summary).toMatchObject({
      campaign: { id: t.campaign.id, name: 'Hollow Crown' },
      handouts: 2,
      npcs: 1,
      sessions: 1,
      characters: ['Alba (Mira)'],
      existing: [],
      withoutAccount: [],
      skipped: 0,
    });

    const dm = await client(dmToken, fresh);
    expect(ok(await dm.emitWithAck('campaign:list')).campaigns).toMatchObject([{ id: t.campaign.id, name: 'Hollow Crown' }]);
    const { prep } = ok(await dm.emitWithAck('prep:get', { campaignId: t.campaign.id }));
    expect(prep.npcs).toMatchObject([{ name: 'Goblin', actions: 'Scimitar +4' }]);
    expect(prep.handouts).toMatchObject([{ title: 'Map' }, { title: 'Letter', imageUrl: null }]);
    const picture = await fetch(fresh.url + prep.handouts[0]!.imageUrl);
    expect(new Uint8Array(await picture.arrayBuffer())).toEqual(PNG);
    expect(readdirSync(fresh.uploadsDir)).toHaveLength(1);
    expect(ok(await dm.emitWithAck('log:get', { campaignId: t.campaign.id })).previous.map((e) => e.kind)).toEqual(['start', 'damage', 'loot']);

    const mira = await client(await login('Mira', fresh), fresh);
    const mine = ok(await mira.emitWithAck('character:list')).characters;
    expect(mine).toMatchObject([{ id: t.character.id, campaign: { name: 'Hollow Crown' }, inSession: null, data: { name: 'Alba', hpCurrent: 22, inventory: [{ name: 'Longsword' }, { name: 'Silver key' }] } }]);
    expect(mine[0]!.data.portrait).not.toBe('');
    expect((await fetch(`${fresh.url}/api/portraits/${t.character.id}`)).status).toBe(200);

    // The next session continues the count.
    const { session } = ok(await dm.emitWithAck('session:host', { campaignId: t.campaign.id }));
    ok(await mira.emitWithAck('session:join', { code: session.code, characterId: t.character.id }));
    ok(await dm.emitWithAck('session:start'));
    expect(fresh.store.getSession(session.code)!.sessionNo).toBe(2);
  });

  it('asks before leaving out characters whose player has no account', async () => {
    const t = await played();
    const file = (await (await exportFile(t.campaign.id, t.dmToken)).json()) as CampaignBackup;
    const fresh = await world(['Faris']);
    const dmToken = await login('Faris', fresh);
    const refused = await importFile(file, dmToken, fresh);
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ missingPlayers: ['Mira'], error: expect.stringMatching(/npm run users -- add Mira/) });
    expect(fresh.store.listCampaigns(fresh.store.userIdByName('Faris')!)).toEqual([]);
    expect(readdirSync(fresh.uploadsDir)).toEqual([]);

    const forced = await importFile(file, dmToken, fresh, '?skipMissing=1');
    expect(forced.body.summary).toMatchObject({ characters: [], withoutAccount: ['Alba (Mira)'], handouts: 2 });
  });

  it('changes nothing that is still there: a second copy of the campaign, characters untouched', async () => {
    const t = await played();
    const file = (await (await exportFile(t.campaign.id, t.dmToken)).json()) as CampaignBackup;
    ok(await t.dm.emitWithAck('character:adjustHp', { characterId: t.character.id, delta: -10 }));

    const { status, body } = await importFile(file, t.dmToken);
    expect(status).toBe(200);
    expect(body.summary).toMatchObject({ campaign: { name: 'Hollow Crown (restored)' }, characters: [], existing: ['Alba (Mira)'] });
    expect(body.summary!.campaign.id).not.toBe(t.campaign.id);
    expect(w.store.getCharacter(t.character.id)!.data.hpCurrent).toBe(12);
    expect(w.store.getCharacter(t.character.id)!.campaign!.id).toBe(t.campaign.id);
    expect((await importFile(file, t.dmToken)).body.summary!.campaign.name).toBe('Hollow Crown (restored 2)');
  });

  it('refuses files that are not a backup, and strangers', async () => {
    const dmToken = await login('Faris');
    expect(await importFile({ format: 'something else' }, dmToken)).toMatchObject({ status: 400, body: { error: expect.stringMatching(/not a campaign backup/) } });
    expect(await importFile('{ not json', dmToken)).toMatchObject({ status: 400, body: { error: 'That file could not be read.' } });
    expect((await importFile({}, 'wrong-token')).status).toBe(401);
  });

  it('writes only pictures that really are pictures', async () => {
    const dmToken = await login('Faris');
    const html = Buffer.from('<script>alert(1)</script>').toString('base64');
    const { body } = await importFile(
      {
        format: 'dnd-campaign-backup',
        version: 1,
        campaign: { name: 'Sneaky' },
        handouts: [{ title: 'Fake picture', text: '', image: { mime: 'image/png', data: html } }, { title: 'Fake with text', text: 'Hello', image: { mime: 'image/png', data: html } }],
      },
      dmToken,
    );
    expect(body.summary).toMatchObject({ handouts: 1, skipped: 1 });
    expect(readdirSync(w.uploadsDir)).toEqual([]);
  });
});
