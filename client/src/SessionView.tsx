import { useEffect, useState } from 'react';
import { StatusPill } from './StatusPill.tsx';
import type { SessionPlayer, SessionState } from '@dnd/shared';
import { ClassicSheet } from './ClassicSheet.tsx';
import { Sheet, sheetActions } from './Sheet.tsx';
import type { Game } from './useGame.ts';

export function SessionView({ game, session, myId }: { game: Game; session: SessionState; myId: string }) {
  const isHost = session.host.id === myId;
  const me = session.players.find((p) => p.user.id === myId);

  if (isHost && session.started) {
    return (
      <>
        <DmSidebar game={game} session={session} />
        <InSession game={game} session={session} isHost me={undefined} myId={myId} />
      </>
    );
  }

  return (
    <>
      <section className="card">
        <p className="muted">
          {session.campaign.name}
          {!session.started && ' · Lobby'}
        </p>
        {isHost ? (
          <>
            <p className="room-code" aria-label="Session code">{session.code}</p>
            <p className="muted small center">{session.started ? 'Late players can still join with this code.' : 'Players join with this code.'}</p>
          </>
        ) : (
          <p className="small muted">
            Session <strong>{session.code}</strong> · DM {session.host.username}
            {!session.host.online && ' (reconnecting…)'}
          </p>
        )}
      </section>

      {session.started ? (
        <InSession game={game} session={session} isHost={isHost} me={me} myId={myId} />
      ) : (
        <Lobby game={game} session={session} isHost={isHost} me={me} myId={myId} />
      )}
    </>
  );
}

interface ViewProps {
  game: Game;
  session: SessionState;
  isHost: boolean;
  me: SessionPlayer | undefined;
  myId: string;
}

function Lobby({ game, session, isHost, me, myId }: ViewProps) {
  const readyCount = session.players.filter((p) => p.ready).length;
  const total = session.players.length;
  const allReady = total > 0 && readyCount === total;

  const start = () => {
    if (!allReady) {
      const msg =
        total === 0
          ? 'No players have joined yet. Start anyway?'
          : `Only ${readyCount} of ${total} players are ready. Start anyway?`;
      if (!window.confirm(msg)) return;
    }
    void game.start();
  };

  return (
    <section className="card">
      <h2 className="card-title">
        Lobby <span className="muted small">{readyCount}/{total} ready</span>
      </h2>
      {total === 0 ? (
        <p className="muted">Waiting for players to join…</p>
      ) : (
        <ul className="members">
          {session.players.map((p) => (
            <li key={p.user.id} className={`lobby-row ${p.online ? '' : 'away'}`}>
              <span className={`dot ${p.online ? 'on' : 'off'}`} />
              <span className="grow">
                <strong>{p.character.name}</strong>
                {p.user.id === myId && <span className="muted small"> (you)</span>}
                <span className="muted small block">
                  {[p.character.species, p.character.className, `Lv ${p.character.level}`].filter(Boolean).join(' · ')} · {p.user.username}
                </span>
              </span>
              <span className={`ready-tag ${p.ready ? 'yes' : ''}`}>{p.ready ? 'Ready' : 'Not ready'}</span>
            </li>
          ))}
        </ul>
      )}

      {me && (
        <button className={`primary ready-button ${me.ready ? 'is-ready' : ''}`} onClick={() => void game.setReady(!me.ready)}>
          {me.ready ? "I'm ready ✓ (tap to undo)" : 'Ready'}
        </button>
      )}
      {me && <p className="muted small center">Waiting for the DM to start the session.</p>}

      {isHost && (
        <>
          {allReady && <p className="notice good">Everyone is ready. Start the session!</p>}
          <button className={`primary start-button ${allReady ? '' : 'dim'}`} onClick={start}>
            Start session
          </button>
        </>
      )}
      <LeaveOrEnd game={game} isHost={isHost} />
    </section>
  );
}

function InSession({ game, session, isHost, me, myId }: ViewProps) {
  /** DM: the player whose sheet is open. */
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <>
      {me && (
        <ClassicSheet
          key={me.characterId}
          character={me.character}
          actions={sheetActions(game, me.characterId)}
          playerName={me.user.username}
        />
      )}

      <section className="card">
        <h2 className="card-title">Party</h2>
        {isHost && session.players.length > 0 && (
          <p className="muted small mb">Tap a player to open their sheet: change HP, give or take items, edit anything.</p>
        )}
        {session.players.length === 0 ? (
          <p className="muted">No players in this session.</p>
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
                      key={p.characterId}
                      title={`${p.character.name}'s sheet`}
                      character={p.character}
                      actions={sheetActions(game, p.characterId)}
                      dmUnlock
                    />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {!isHost && <LeaveOrEnd game={game} isHost={false} />}
      </section>
    </>
  );
}

/**
 * DM during a running session: everything except the party lives in a drawer
 * that slides in from the left (about a third of the screen, wider on phones).
 */
function DmSidebar({ game, session }: { game: Game; session: SessionState }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  return (
    <>
      <div className="dm-topbar">
        <button className="menu-toggle" aria-label="Open menu" aria-expanded={open} onClick={() => setOpen(true)}>
          <span /><span /><span />
        </button>
        <span className="dm-topbar-title">{session.campaign.name}</span>
      </div>
      <div className={`drawer-backdrop ${open ? 'open' : ''}`} onClick={() => setOpen(false)} aria-hidden />
      <aside className={`drawer ${open ? 'open' : ''}`} aria-hidden={!open} inert={!open}>
        <div className="drawer-head">
          <h1>DnD Table</h1>
          <button className="drawer-close" aria-label="Close menu" onClick={() => setOpen(false)}>✕</button>
        </div>
        <StatusPill status={game.status} />
        <p className="muted small drawer-label">Campaign</p>
        <p className="drawer-campaign">{session.campaign.name}</p>
        <p className="muted small drawer-label">Session code</p>
        <p className="drawer-code" aria-label="Session code">{session.code}</p>
        <p className="muted small">Late players can still join with this code.</p>
        <div className="drawer-spacer" />
        <LeaveOrEnd game={game} isHost />
      </aside>
    </>
  );
}

function LeaveOrEnd({ game, isHost }: { game: Game; isHost: boolean }) {
  return isHost ? (
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
