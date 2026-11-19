import { useState } from 'react';
import type { CharacterSummary } from '@dnd/shared';
import { uploadPortrait } from './api.ts';
import { CharacterCreator, hasCreatorDraft } from './creator/CharacterCreator.tsx';
import { Panel } from './Panel.tsx';
import { Portrait, PortraitPicker } from './Portrait.tsx';
import { Sheet, sheetActions } from './Sheet.tsx';
import type { Game } from './useGame.ts';

const TABS = [
  { id: 'roster', label: 'Roster' },
  { id: 'create', label: 'Create' },
] as const;

/** Your characters, made outside sessions. Any of them can join any campaign. */
export function Characters({ game, onBack }: { game: Game; onBack: () => void }) {
  const [tab, setTab] = useState<'roster' | 'create'>('roster');
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
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
          hpItemsLocked={!open.data.hpItemsUnlocked}
          portrait={<PortraitPicker characterId={open.id} character={open.data} onChanged={() => void game.refreshCharacters()} />}
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

  if (creating) {
    return (
      <CharacterCreator
        onCancel={() => setCreating(false)}
        onDone={async (data, picture) => {
          const created = await game.createCharacter(data.name, data);
          if (!created) return false;
          if (picture) {
            // The character exists now; a failed upload only means no picture yet.
            await uploadPortrait(created.id, picture).then(() => game.refreshCharacters(), () => game.setError('The character was created, but the picture could not be saved. Add it on the sheet.'));
          }
          setCreating(false);
          setTab('roster');
          setOpenId(created.id);
        }}
      />
    );
  }

  const draft = tab === 'create' && hasCreatorDraft();
  return (
    <Panel title="Characters" tabs={TABS} tab={tab} onTab={setTab} onClose={onBack}>
      {tab === 'roster' ? (
        <>
          <h3 className="panel-heading">Your characters</h3>
          {game.characters === null ? (
            <p className="muted">Loading…</p>
          ) : game.characters.length === 0 ? (
            <>
              <p className="muted">No characters yet.</p>
              <button className="secondary block-button" onClick={() => setTab('create')}>Create your first one</button>
            </>
          ) : (
            <>
              <p className="muted small hint">Tap a character to open its sheet.</p>
              <ul className="rows">
                {game.characters.map((c) => (
                  <li key={c.id}>
                    <button className="row-button" onClick={() => setOpenId(c.id)}>
                      <Portrait characterId={c.id} character={c.data} className="thumb" />
                      <span className="grow">
                        <CharacterLine character={c} />
                        {c.inSession && <span className="badge">In session</span>}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      ) : (
        <>
          <h3 className="panel-heading">New character</h3>
          <p className="muted small">
            Step by step: class, background, species, ability scores, equipment and spells. Every choice comes with its rules text, and you can leave and pick up where you stopped.
          </p>
          <button className="primary block-button" onClick={() => setCreating(true)} disabled={game.status !== 'online'}>
            {draft ? 'Continue your character' : 'Start'}
          </button>
          {draft && <p className="muted small mt">You started a character and have not finished it yet.</p>}
        </>
      )}
    </Panel>
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
