import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { io as connect, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, JoinedPayload, RoomState, ServerToClientEvents } from '@dnd/shared';
import { createApp, type IoServer } from './app.ts';
import { Store } from './store.ts';

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;

let store: Store;
let io: IoServer;
let url: string;
const clients: Client[] = [];

beforeEach(async () => {
  store = new Store(':memory:');
  const app = createApp({ store });
  io = app.io;
  await new Promise<void>((resolve) => app.httpServer.listen(0, resolve));
  url = `http://localhost:${(app.httpServer.address() as AddressInfo).port}`;
});

afterEach(async () => {
  clients.splice(0).forEach((c) => c.disconnect());
  await io.close();
  store.close();
});

async function client(): Promise<Client> {
  const c: Client = connect(url, { transports: ['websocket'], forceNew: true });
  clients.push(c);
  await new Promise<void>((resolve) => c.on('connect', resolve));
  return c;
}

function nextState(c: Client, predicate: (s: RoomState) => boolean): Promise<RoomState> {
  return new Promise((resolve) => {
    const handler = (s: RoomState) => {
      if (predicate(s)) {
        c.off('room:state', handler);
        resolve(s);
      }
    };
    c.on('room:state', handler);
  });
}

function ok<T>(res: { ok: true } & T | { ok: false; error: string }): T {
  if (!res.ok) throw new Error(res.error);
  return res;
}

describe('rooms', () => {
  it('lets a DM create a room and players join it by code', async () => {
    const dm = await client();
    const created = ok<JoinedPayload>(
      await dm.emitWithAck('room:create', { roomName: 'Friday Game', dmName: 'Faris' }),
    );
    expect(created.room.code).toMatch(/^[A-Z2-9]{5}$/);
    expect(created.room.members).toEqual([
      expect.objectContaining({ name: 'Faris', role: 'dm', online: true }),
    ]);

    const player = await client();
    const dmSeesPlayer = nextState(dm, (s) => s.members.length === 2);
    const joined = ok<JoinedPayload>(
      await player.emitWithAck('room:join', { code: created.room.code.toLowerCase(), playerName: 'Mira' }),
    );
    expect(joined.room.name).toBe('Friday Game');
    expect((await dmSeesPlayer).members.map((m) => m.name)).toEqual(['Faris', 'Mira']);
  });

  it('rejects unknown codes and duplicate names', async () => {
    const dm = await client();
    const { room } = ok<JoinedPayload>(
      await dm.emitWithAck('room:create', { roomName: 'Game', dmName: 'Faris' }),
    );
    const p = await client();
    expect(await p.emitWithAck('room:join', { code: 'ZZZZZ', playerName: 'A' })).toMatchObject({ ok: false });
    expect(await p.emitWithAck('room:join', { code: room.code, playerName: 'faris' })).toMatchObject({ ok: false });
  });

  it('keeps the room when the DM disconnects, and the DM can resume', async () => {
    const dm = await client();
    const { session, room } = ok<JoinedPayload>(
      await dm.emitWithAck('room:create', { roomName: 'Game', dmName: 'Faris' }),
    );
    const player = await client();
    ok(await player.emitWithAck('room:join', { code: room.code, playerName: 'Mira' }));

    const playerSeesDmOffline = nextState(player, (s) => s.members.some((m) => m.role === 'dm' && !m.online));
    dm.disconnect();
    await playerSeesDmOffline;

    const dm2 = await client();
    const playerSeesDmBack = nextState(player, (s) => s.members.every((m) => m.online));
    const resumed = ok<JoinedPayload>(await dm2.emitWithAck('room:resume', session));
    expect(resumed.session.memberId).toBe(session.memberId);
    await playerSeesDmBack;
  });

  it('survives a server restart (state is in the database)', async () => {
    const dm = await client();
    const { session } = ok<JoinedPayload>(
      await dm.emitWithAck('room:create', { roomName: 'Game', dmName: 'Faris' }),
    );
    // A fresh app on the same store simulates a restarted server process.
    const app2 = createApp({ store });
    await new Promise<void>((resolve) => app2.httpServer.listen(0, resolve));
    const c: Client = connect(`http://localhost:${(app2.httpServer.address() as AddressInfo).port}`, {
      transports: ['websocket'],
      forceNew: true,
    });
    clients.push(c);
    const resumed = ok<JoinedPayload>(await c.emitWithAck('room:resume', session));
    expect(resumed.room.members[0]).toMatchObject({ name: 'Faris', role: 'dm' });
    c.disconnect();
    await app2.io.close();
  });

  it('rejects a resume with a wrong token', async () => {
    const dm = await client();
    const { session } = ok<JoinedPayload>(
      await dm.emitWithAck('room:create', { roomName: 'Game', dmName: 'Faris' }),
    );
    const other = await client();
    expect(await other.emitWithAck('room:resume', { ...session, token: 'nope' })).toMatchObject({ ok: false });
  });

  it('removes a player who leaves', async () => {
    const dm = await client();
    const { room } = ok<JoinedPayload>(
      await dm.emitWithAck('room:create', { roomName: 'Game', dmName: 'Faris' }),
    );
    const player = await client();
    ok(await player.emitWithAck('room:join', { code: room.code, playerName: 'Mira' }));
    const dmSeesLeave = nextState(dm, (s) => s.members.length === 1);
    ok(await player.emitWithAck('room:leave'));
    await dmSeesLeave;
    expect(await dm.emitWithAck('room:leave')).toMatchObject({ ok: false });
  });
});
