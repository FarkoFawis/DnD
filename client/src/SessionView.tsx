import { useEffect, useRef, useState } from 'react';
import type { CharacterData, SessionPlayer, SessionState } from '@dnd/shared';
import type { Game } from './useGame.ts';

export function SessionView({ game, session, myId }: { game: Game; session: SessionState; myId: string }) {
  const isHost = session.host.id === myId;
  const me = session.players.find((p) => p.user.id === myId);

  return (
    <>
      <section className="card">
        <p className="muted">{session.campaign.name}</p>
        {isHost ? (
          <>
            <p className="room-code" aria-label="Session code">{session.code}</p>
            <p className="muted small center">Players join with this code.</p>
          </>
        ) : (
          <p className="small muted">
            Session <strong>{session.code}</strong> · DM {session.host.username}
            {!session.host.online && ' (reconnecting…)'}
          </p>
        )}
      </section>

      {me && <CharacterCard key={session.campaign.id} character={me.character} onSave={game.updateCharacter} />}

      <section className="card">
        <h2 className="card-title">Party</h2>
        {session.players.length === 0 ? (
          <p className="muted">Waiting for players to join…</p>
        ) : (
          <ul className="members">
            {session.players.map((p) => (
              <PartyRow key={p.user.id} player={p} isMe={p.user.id === myId} />
            ))}
          </ul>
        )}
        {isHost ? (
          <button
            className="ghost danger"
            onClick={() => {
              if (window.confirm('End the session for everyone? All characters stay saved.')) void game.end();
            }}
          >
            End session
          </button>
        ) : (
          <button className="ghost" onClick={() => void game.leave()}>
            Leave session
          </button>
        )}
      </section>
    </>
  );
}

function PartyRow({ player, isMe }: { player: SessionPlayer; isMe: boolean }) {
  const c = player.character;
  const pct = Math.max(0, Math.min(100, (c.hpCurrent / c.hpMax) * 100));
  return (
    <li className={player.online ? '' : 'away'}>
      <span className={`dot ${player.online ? 'on' : 'off'}`} />
      <span className="grow">
        <strong>{c.name || player.user.username}</strong>
        {isMe && <span className="muted small"> (you)</span>}
        <span className="muted small block">
          {[c.species, c.className, `Lv ${c.level}`].filter(Boolean).join(' · ')} · {player.user.username}
        </span>
        <span className="hpbar" aria-hidden>
          <span style={{ width: `${pct}%` }} className={pct <= 25 ? 'low' : ''} />
        </span>
      </span>
      <span className="hp-text">
        {c.hpCurrent}/{c.hpMax}
        {c.hpTemp > 0 && <span className="muted small"> +{c.hpTemp}</span>}
      </span>
    </li>
  );
}

/** The player's own sheet. A placeholder for the full sheet: basics + HP. */
function CharacterCard({
  character,
  onSave,
}: {
  character: CharacterData;
  onSave: (patch: Partial<CharacterData>) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState(character);
  // Take in changes from the server (e.g. another tab) without wiping a field
  // the player is typing in: only fields that changed on the server are copied.
  const last = useRef(character);
  useEffect(() => {
    const prev = last.current;
    last.current = character;
    setDraft((d) => {
      const next = { ...d };
      for (const k of Object.keys(character) as (keyof CharacterData)[]) {
        if (character[k] !== prev[k]) (next as Record<string, unknown>)[k] = character[k];
      }
      return next;
    });
  }, [character]);

  const saveText = (key: 'name' | 'className' | 'species') => {
    if (draft[key] !== character[key]) void onSave({ [key]: draft[key] });
  };
  const setNum = (key: 'level' | 'hpMax' | 'hpCurrent' | 'hpTemp', value: number) => {
    if (!Number.isFinite(value)) return;
    setDraft((d) => ({ ...d, [key]: value }));
    void onSave({ [key]: value });
  };
  const adjustHp = (delta: number) => {
    let { hpCurrent, hpTemp } = draft;
    if (delta < 0) {
      // Damage eats temporary HP first.
      const fromTemp = Math.min(hpTemp, -delta);
      hpTemp -= fromTemp;
      hpCurrent = Math.max(0, hpCurrent - (-delta - fromTemp));
    } else {
      hpCurrent = Math.min(draft.hpMax, hpCurrent + delta);
    }
    setDraft((d) => ({ ...d, hpCurrent, hpTemp }));
    void onSave({ hpCurrent, hpTemp });
  };

  return (
    <section className="card">
      <h2 className="card-title">Your character</h2>
      <div className="grid2">
        <label className="span2">
          Name
          <input value={draft.name} maxLength={40} onChange={(e) => setDraft({ ...draft, name: e.target.value })} onBlur={() => saveText('name')} />
        </label>
        <label>
          Class
          <input value={draft.className} maxLength={40} placeholder="Fighter" onChange={(e) => setDraft({ ...draft, className: e.target.value })} onBlur={() => saveText('className')} />
        </label>
        <label>
          Species
          <input value={draft.species} maxLength={40} placeholder="Elf" onChange={(e) => setDraft({ ...draft, species: e.target.value })} onBlur={() => saveText('species')} />
        </label>
        <label>
          Level
          <input type="number" inputMode="numeric" min={1} max={20} value={draft.level} onChange={(e) => setNum('level', Math.min(20, Math.max(1, e.target.valueAsNumber)))} />
        </label>
        <label>
          Max HP
          <input type="number" inputMode="numeric" min={1} value={draft.hpMax} onChange={(e) => setNum('hpMax', Math.max(1, e.target.valueAsNumber))} />
        </label>
      </div>
      <div className="hp-box">
        <div className="hp-label">Hit points</div>
        <div className="hp-row">
          <button aria-label="Take 5 damage" onClick={() => adjustHp(-5)}>−5</button>
          <button aria-label="Take 1 damage" onClick={() => adjustHp(-1)}>−1</button>
          <span className="hp-now">
            {draft.hpCurrent}
            <span className="muted"> / {draft.hpMax}</span>
          </span>
          <button aria-label="Heal 1" onClick={() => adjustHp(1)}>+1</button>
          <button aria-label="Heal 5" onClick={() => adjustHp(5)}>+5</button>
        </div>
        <label className="temp">
          Temp HP
          <input type="number" inputMode="numeric" min={0} value={draft.hpTemp} onChange={(e) => setNum('hpTemp', Math.max(0, e.target.valueAsNumber || 0))} />
        </label>
      </div>
      <p className="muted small">Saved automatically. Spells, equipment and abilities come next.</p>
    </section>
  );
}
