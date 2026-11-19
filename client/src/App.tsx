import { useState, type FormEvent } from 'react';
import { ROOM_CODE_LENGTH } from '@dnd/shared';
import { useRoom, type Status } from './useRoom.ts';

export function App() {
  const { status, session, room, error, setError, createRoom, joinRoom, leaveRoom } = useRoom();

  return (
    <main className="app">
      <header className="top">
        <h1>DnD Table</h1>
        <StatusDot status={status} />
      </header>
      {error && (
        <p className="error" role="alert" onClick={() => setError(null)}>
          {error}
        </p>
      )}
      {session && room ? (
        <RoomView
          room={room}
          myId={session.memberId}
          onLeave={() => void leaveRoom()}
        />
      ) : session ? (
        <p className="muted">Reconnecting to your room…</p>
      ) : (
        <Lobby
          disabled={status !== 'online'}
          onCreate={createRoom}
          onJoin={joinRoom}
        />
      )}
    </main>
  );
}

function StatusDot({ status }: { status: Status }) {
  const label = { connecting: 'Connecting', online: 'Online', offline: 'Offline' }[status];
  return (
    <span className={`status status-${status}`} aria-live="polite">
      {label}
    </span>
  );
}

function Lobby(props: {
  disabled: boolean;
  onCreate: (roomName: string, dmName: string) => Promise<boolean>;
  onJoin: (code: string, name: string) => Promise<boolean>;
}) {
  const [mode, setMode] = useState<'join' | 'create'>('join');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [roomName, setRoomName] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    if (mode === 'join') await props.onJoin(code, name);
    else await props.onCreate(roomName, name);
    setBusy(false);
  };

  return (
    <section className="card">
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={mode === 'join'} onClick={() => setMode('join')}>
          Join a game
        </button>
        <button role="tab" aria-selected={mode === 'create'} onClick={() => setMode('create')}>
          I'm the DM
        </button>
      </div>
      <form onSubmit={submit}>
        {mode === 'join' ? (
          <label>
            Room code
            <input
              className="code-input"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              maxLength={ROOM_CODE_LENGTH + 2}
              autoCapitalize="characters"
              autoComplete="off"
              inputMode="text"
              placeholder="ABCDE"
              required
            />
          </label>
        ) : (
          <label>
            Campaign / room name
            <input value={roomName} onChange={(e) => setRoomName(e.target.value)} required />
          </label>
        )}
        <label>
          Your name
          <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="nickname" required />
        </label>
        <button className="primary" type="submit" disabled={props.disabled || busy}>
          {mode === 'join' ? 'Join' : 'Create room'}
        </button>
      </form>
    </section>
  );
}

function RoomView(props: {
  room: NonNullable<ReturnType<typeof useRoom>['room']>;
  myId: string;
  onLeave: () => void;
}) {
  const { room, myId } = props;
  const me = room.members.find((m) => m.id === myId);
  return (
    <section className="card">
      <p className="muted">{room.name}</p>
      <p className="room-code" aria-label="Room code">
        {room.code}
      </p>
      <p className="muted small">Players join with this code.</p>
      <h2>At the table</h2>
      <ul className="members">
        {room.members.map((m) => (
          <li key={m.id} className={m.online ? '' : 'away'}>
            <span className={`dot ${m.online ? 'on' : 'off'}`} />
            {m.name}
            {m.role === 'dm' && <span className="badge">DM</span>}
            {m.id === myId && <span className="muted small"> (you)</span>}
          </li>
        ))}
      </ul>
      {me?.role === 'player' && (
        <button className="ghost" onClick={props.onLeave}>
          Leave room
        </button>
      )}
    </section>
  );
}
