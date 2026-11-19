import { useRef, useState, type FormEvent } from 'react';
import { ROOM_CODE_LENGTH } from '@dnd/shared';
import type { CampaignSummary, CharacterSummary, ImportSummary } from '@dnd/shared';
import { uploadBackup } from './api.ts';
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
      <LoadBackup game={game} />
    </>
  );
}

/** Brings a campaign back from a backup file (made in Configure → Backup). */
function LoadBackup({ game }: { game: Game }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<ImportSummary | null>(null);

  const load = async (file: File) => {
    setBusy(true);
    setDone(null);
    let res = await uploadBackup(file);
    if (!res.ok && res.missingPlayers?.length) {
      const names = res.missingPlayers.join(', ');
      if (window.confirm(`These players have no account here: ${names}.\n\nLoad the backup without their characters? To keep them, cancel, add the accounts first (npm run users -- add ${res.missingPlayers.join(' ')}) and load the file again.`)) {
        res = await uploadBackup(file, true);
      } else {
        setBusy(false);
        return;
      }
    }
    setBusy(false);
    if (!res.ok) return game.setError(res.error);
    setDone(res.summary);
    void game.refreshCampaigns();
    void game.refreshCharacters();
  };

  const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  return (
    <div className="load-backup">
      <input
        ref={input}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void load(file);
        }}
      />
      <button className="ghost" disabled={busy || game.status !== 'online'} onClick={() => input.current?.click()}>
        {busy ? 'Loading the backup…' : 'Load a backup file'}
      </button>
      {done && (
        <div className="notice good" role="status">
          <strong>{done.campaign.name}</strong> is back: {count(done.handouts, 'handout')}, {count(done.npcs, 'NPC')}, the log of {count(done.sessions, 'session')} and {count(done.characters.length, 'character')}
          {done.characters.length > 0 && ` (${done.characters.join(', ')})`}.
          {done.existing.length > 0 && <span className="block">Still here and left as they are: {done.existing.join(', ')}.</span>}
          {done.withoutAccount.length > 0 && <span className="block">Left out, no account: {done.withoutAccount.join(', ')}.</span>}
          {done.skipped > 0 && <span className="block">{count(done.skipped, 'entry', 'entries')} could not be read and were left out.</span>}
        </div>
      )}
    </div>
  );
}

function formatDate(sqliteUtc: string): string {
  const d = new Date(sqliteUtc.replace(' ', 'T') + 'Z');
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
