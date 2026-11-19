import { useState } from 'react';
import type { SessionPlayer, SessionState } from '@dnd/shared';
import { CampaignConfig } from './prep/CampaignConfig.tsx';
import { Recap } from './prep/SessionLog.tsx';
import { DmTools } from './session/DmTools.tsx';
import { FightAlert } from './session/FightAlert.tsx';
import { PlayerSession } from './session/PlayerSession.tsx';
import { SessionDrawer } from './session/SessionDrawer.tsx';
import type { Game } from './useGame.ts';
import { DmParty } from './PartyGrid.tsx';

export function SessionView({ game, session, myId }: { game: Game; session: SessionState; myId: string }) {
  const isHost = session.host.id === myId;
  const me = session.players.find((p) => p.user.id === myId);

  if (isHost && session.started) {
    return (
      <>
        <FightAlert count={game.fightAlerts} />
        <DmSidebar game={game} session={session} />
        <DmTools game={game} session={session} />
        <DmParty game={game} session={session} myId={myId} />
      </>
    );
  }
  if (session.started && me) {
    return (
      <>
        <FightAlert count={game.fightAlerts} />
        <PlayerSession game={game} session={session} me={me} />
      </>
    );
  }

  return (
    <>
      <FightAlert count={game.fightAlerts} />
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

      <Lobby game={game} session={session} isHost={isHost} me={me} myId={myId} />
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
  /** DM: planning the campaign from the lobby. */
  const [configuring, setConfiguring] = useState(false);
  if (isHost && configuring) {
    return <CampaignConfig game={game} campaign={session.campaign} backLabel="Lobby" onBack={() => setConfiguring(false)} />;
  }

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
    <>
    {isHost && <Recap game={game} campaign={session.campaign} />}
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
          <button className="secondary wide mt" onClick={() => setConfiguring(true)}>
            ⚙ Configure: handouts, NPCs, log
          </button>
        </>
      )}
      <LeaveOrEnd game={game} isHost={isHost} />
    </section>
    </>
  );
}

/** DM during a running session: campaign, session code and "End session" live in the drawer. */
function DmSidebar({ game, session }: { game: Game; session: SessionState }) {
  return (
    <SessionDrawer game={game} title={session.campaign.name}>
      {() => (
        <>
          <p className="muted small drawer-label">Campaign</p>
          <p className="drawer-campaign">{session.campaign.name}</p>
          <p className="muted small drawer-label">Session code</p>
          <p className="drawer-code" aria-label="Session code">{session.code}</p>
          <p className="muted small">Late players can still join with this code.</p>
          <div className="drawer-spacer" />
          <LeaveOrEnd game={game} isHost />
        </>
      )}
    </SessionDrawer>
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
