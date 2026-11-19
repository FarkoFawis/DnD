import { useState } from 'react';
import type { SessionPlayer, SessionState } from '@dnd/shared';
import { Sheet, sheetActions } from './Sheet.tsx';
import type { Game } from './useGame.ts';

export function SessionView({ game, session, myId }: { game: Game; session: SessionState; myId: string }) {
  const isHost = session.host.id === myId;
  const me = session.players.find((p) => p.user.id === myId);
  /** DM: the player whose sheet is open. */
  const [openId, setOpenId] = useState<string | null>(null);

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

      {me && (
        <Sheet
          key={session.campaign.id}
          title="Your character"
          character={me.character}
          actions={sheetActions(game)}
        />
      )}

      <section className="card">
        <h2 className="card-title">Party</h2>
        {isHost && session.players.length > 0 && (
          <p className="muted small mb">Tap a player to open their sheet: change HP, give or take items, edit anything.</p>
        )}
        {session.players.length === 0 ? (
          <p className="muted">Waiting for players to join…</p>
        ) : (
          <ul className="members">
            {session.players.map((p) => (
              <li key={p.user.id} className={`party-row ${p.online ? '' : 'away'}`}>
                {isHost ? (
                  <button
                    className="row-button"
                    aria-expanded={openId === p.user.id}
                    onClick={() => setOpenId(openId === p.user.id ? null : p.user.id)}
                  >
                    <PartySummary player={p} isMe={false} />
                  </button>
                ) : (
                  <div className="row-static">
                    <PartySummary player={p} isMe={p.user.id === myId} />
                  </div>
                )}
                {isHost && openId === p.user.id && (
                  <div className="dm-sheet">
                    <Sheet
                      key={p.user.id}
                      title={`${p.character.name || p.user.username}'s sheet`}
                      character={p.character}
                      actions={sheetActions(game, p.user.id)}
                    />
                  </div>
                )}
              </li>
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

function PartySummary({ player, isMe }: { player: SessionPlayer; isMe: boolean }) {
  const c = player.character;
  const pct = Math.max(0, Math.min(100, (c.hpCurrent / c.hpMax) * 100));
  return (
    <>
      <span className={`dot ${player.online ? 'on' : 'off'}`} />
      <span className="grow">
        <strong>{c.name || player.user.username}</strong>
        {isMe && <span className="muted small"> (you)</span>}
        <span className="muted small block">
          {[c.species, c.className, `Lv ${c.level}`].filter(Boolean).join(' · ')} · AC {c.armorClass} · {player.user.username}
        </span>
        <span className="hpbar" aria-hidden>
          <span style={{ width: `${pct}%` }} className={pct <= 25 ? 'low' : ''} />
        </span>
      </span>
      <span className="hp-text">
        {c.hpCurrent}/{c.hpMax}
        {c.hpTemp > 0 && <span className="muted small"> +{c.hpTemp}</span>}
      </span>
    </>
  );
}
