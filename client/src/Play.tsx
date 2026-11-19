import { useState, type FormEvent } from 'react';
import { ROOM_CODE_LENGTH } from '@dnd/shared';
import type { CampaignSummary, CharacterSummary } from '@dnd/shared';
import { CampaignConfig } from './prep/CampaignConfig.tsx';
import { CharacterLine } from './Characters.tsx';
import type { Game } from './useGame.ts';

/** Play: join a session with a code, or host one of your campaigns. */
export function Play({ game, onBack, onCharacters }: { game: Game; onBack: () => void; onCharacters: () => void }) {
  // People who run campaigns usually want to host; everyone else joins.
  const [mode, setMode] = useState<'join' | 'host'>(game.campaigns?.length ? 'host' : 'join');
  /** The campaign the DM is planning ("Configure"). */
  const [configuring, setConfiguring] = useState<CampaignSummary | null>(null);
  if (configuring) {
    return <CampaignConfig game={game} campaign={configuring} backLabel="Campaigns" onBack={() => setConfiguring(null)} />;
  }
  return (
    <>
    <button className="back" onClick={onBack}>‹ Home</button>
    <section className="card">
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={mode === 'join'} onClick={() => setMode('join')}>
          Join a session
        </button>
        <button role="tab" aria-selected={mode === 'host'} onClick={() => setMode('host')}>
          Host (DM)
        </button>
      </div>
      {mode === 'join' ? <Join game={game} onCharacters={onCharacters} /> : <Host game={game} onConfigure={setConfiguring} />}
    </section>
    </>
  );
}

function Join({ game, onCharacters }: { game: Game; onCharacters: () => void }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  /** After a valid code: pick which character joins. */
  const [choice, setChoice] = useState<{ code: string; campaign: string; characters: CharacterSummary[] } | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const res = await game.peek(code);
    if (!res.ok) game.setError(res.error);
    else if (res.rejoin) await game.join(code);
    else setChoice({ code, campaign: res.campaign.name, characters: res.characters });
    setBusy(false);
  };

  if (choice) {
    return (
      <>
        <p className="muted">
          Joining <strong>{choice.campaign}</strong>. Who are you playing tonight?
        </p>
        {choice.characters.length === 0 ? (
          <p className="notice">
            You have no free characters. Create one first (characters already in another session can't join).
          </p>
        ) : (
          <ul className="list">
            {choice.characters.map((c) => (
              <li key={c.id}>
                <button className="list-button" disabled={busy} onClick={async () => {
                  setBusy(true);
                  await game.join(choice.code, c.id);
                  setBusy(false);
                }}>
                  <CharacterLine character={c} />
                  <span className="chev">›</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="row-gap">
          <button className="ghost" onClick={() => setChoice(null)}>Back</button>
          <button className="ghost" onClick={onCharacters}>Characters</button>
        </div>
      </>
    );
  }

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
        Next
      </button>
    </form>
  );
}

function Host({ game, onConfigure }: { game: Game; onConfigure: (c: CampaignSummary) => void }) {
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
      <p className="muted hint">Pick the campaign you're running tonight, or configure it ahead: handouts, NPCs and opponents.</p>
      {game.campaigns === null ? (
        <p className="muted">Loading campaigns…</p>
      ) : game.campaigns.length === 0 ? (
        <p className="muted">No campaigns yet. Create your first one below.</p>
      ) : (
        <ul className="list">
          {game.campaigns.map((c) => (
            <li key={c.id} className="campaign-row">
              <button className="list-button" onClick={() => void game.host(c.id)} disabled={game.status !== 'online'}>
                <span>
                  <strong>{c.name}</strong>
                  <span className="muted small block">
                    {c.lastPlayedAt ? `Last played ${formatDate(c.lastPlayedAt)}` : 'Not played yet'}
                  </span>
                </span>
                {c.liveCode ? <span className="badge">Live · {c.liveCode}</span> : <span className="chev">›</span>}
              </button>
              <button className="secondary configure-button" onClick={() => onConfigure(c)} disabled={game.status !== 'online'}>
                ⚙ Configure
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
