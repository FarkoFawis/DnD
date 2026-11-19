import { useState, type FormEvent } from 'react';
import { ROOM_CODE_LENGTH } from '@dnd/shared';
import type { Game } from './useGame.ts';

export function Home({ game }: { game: Game }) {
  // People who run campaigns usually want to host; everyone else joins.
  const [mode, setMode] = useState<'join' | 'host'>(game.campaigns?.length ? 'host' : 'join');
  return (
    <section className="card">
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={mode === 'join'} onClick={() => setMode('join')}>
          Join a session
        </button>
        <button role="tab" aria-selected={mode === 'host'} onClick={() => setMode('host')}>
          Host (DM)
        </button>
      </div>
      {mode === 'join' ? <Join game={game} /> : <Host game={game} />}
    </section>
  );
}

function Join({ game }: { game: Game }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    await game.join(code);
    setBusy(false);
  };
  return (
    <form onSubmit={submit}>
      <label>
        Code from the DM's phone
        <input
          className="code-input"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          maxLength={ROOM_CODE_LENGTH + 2}
          autoCapitalize="characters"
          autoComplete="off"
          autoCorrect="off"
          placeholder="ABCDE"
          required
        />
      </label>
      <button className="primary" type="submit" disabled={busy || game.status !== 'online'}>
        Join
      </button>
    </form>
  );
}

function Host({ game }: { game: Game }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const create = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    if (await game.createCampaign(name)) setName('');
    setBusy(false);
  };
  return (
    <>
      <p className="muted">Pick the campaign you're running tonight.</p>
      {game.campaigns === null ? (
        <p className="muted">Loading campaigns…</p>
      ) : game.campaigns.length === 0 ? (
        <p className="muted">No campaigns yet. Create your first one below.</p>
      ) : (
        <ul className="list">
          {game.campaigns.map((c) => (
            <li key={c.id}>
              <button className="list-button" onClick={() => void game.host(c.id)} disabled={game.status !== 'online'}>
                <span>
                  <strong>{c.name}</strong>
                  <span className="muted small block">
                    {c.lastPlayedAt ? `Last played ${formatDate(c.lastPlayedAt)}` : 'Not played yet'}
                  </span>
                </span>
                {c.liveCode ? <span className="badge">Live · {c.liveCode}</span> : <span className="chev">›</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={create} className="inline-form">
        <label>
          New campaign
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Lost Mine" required />
        </label>
        <button className="secondary" type="submit" disabled={busy || game.status !== 'online'}>
          Create
        </button>
      </form>
    </>
  );
}

function formatDate(sqliteUtc: string): string {
  const d = new Date(sqliteUtc.replace(' ', 'T') + 'Z');
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
