import { useState, type FormEvent } from 'react';
import type { CharacterSummary } from '@dnd/shared';
import { Sheet, sheetActions } from './Sheet.tsx';
import type { Game } from './useGame.ts';

/** Your characters, made outside sessions. Any of them can join any campaign. */
export function Characters({ game, onBack }: { game: Game; onBack: () => void }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const open = game.characters?.find((c) => c.id === openId);

  if (open) {
    return (
      <>
        <button className="back" onClick={() => setOpenId(null)}>‹ All characters</button>
        <Sheet
          key={open.id}
          title={open.data.name || 'Unnamed character'}
          character={open.data}
          actions={sheetActions(game, open.id)}
          readOnly={open.inSession !== null}
          note={
            open.inSession ? (
              <p className="notice">This character is in a session right now. Only the DM can change it until the session ends.</p>
            ) : undefined
          }
        />
        {!open.inSession && (
          <button
            className="ghost danger"
            onClick={async () => {
              if (window.confirm(`Delete ${open.data.name || 'this character'} for good?`) && (await game.deleteCharacter(open.id))) {
                setOpenId(null);
              }
            }}
          >
            Delete character
          </button>
        )}
      </>
    );
  }

  const create = async (e: FormEvent) => {
    e.preventDefault();
    const created = await game.createCharacter(name);
    if (created) {
      setName('');
      setOpenId(created.id);
    }
  };

  return (
    <>
      <button className="back" onClick={onBack}>‹ Home</button>
      <section className="card">
        <h2 className="card-title">Your characters</h2>
        {game.characters === null ? (
          <p className="muted">Loading…</p>
        ) : game.characters.length === 0 ? (
          <p className="muted">No characters yet. Create your first one below.</p>
        ) : (
          <ul className="list">
            {game.characters.map((c) => (
              <li key={c.id}>
                <button className="list-button" onClick={() => setOpenId(c.id)}>
                  <CharacterLine character={c} />
                  {c.inSession ? <span className="badge">In session</span> : <span className="chev">›</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={create} className="inline-form">
          <label>
            New character
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" maxLength={40} required />
          </label>
          <button className="secondary" type="submit" disabled={game.status !== 'online'}>
            Create
          </button>
        </form>
      </section>
    </>
  );
}

export function CharacterLine({ character: c }: { character: CharacterSummary }) {
  const d = c.data;
  return (
    <span>
      <strong>{d.name || 'Unnamed'}</strong>
      <span className="muted small block">
        {[d.species, d.className, `Level ${d.level}`].filter(Boolean).join(' · ')} · {d.hpCurrent}/{d.hpMax} HP
      </span>
      {c.campaign && <span className="muted small block">Last played in {c.campaign.name}</span>}
    </span>
  );
}
