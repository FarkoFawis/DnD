import { useEffect, useState, type CSSProperties } from 'react';
import type { SessionPlayer, SessionState } from '@dnd/shared';
import { Portrait } from './Portrait.tsx';
import { CampaignConfig } from './prep/CampaignConfig.tsx';
import { Recap } from './prep/SessionLog.tsx';
import type { Game } from './useGame.ts';
import { t, tx } from './i18n.tsx';

/**
 * Where the slots around the DM go, in the order players join: the DM's card
 * is in the middle column over two rows, players sit left and right of it,
 * then in a third row below.
 */
const AROUND: Array<{ col: number; row: number }> = [
  { col: 1, row: 1 },
  { col: 3, row: 1 },
  { col: 1, row: 2 },
  { col: 3, row: 2 },
  { col: 1, row: 3 },
  { col: 3, row: 3 },
  { col: 2, row: 3 },
];

const GAP = 8;

/** The room there is for seats: how wide a seat next to the DM is, and the height left between the header and the buttons. */
function useSeatRoom(): { seatWidth: number; height: number } {
  const measure = () => ({
    seatWidth: (Math.min(window.innerWidth, 480) - 32 - 2 * GAP) / 3.2,
    height: window.innerHeight - 220,
  });
  const [room, setRoom] = useState(measure);
  useEffect(() => {
    const onResize = () => setRoom(measure());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return room;
}

/**
 * The ready-up screen, the same for the DM and the players: the DM's card in
 * the middle, the players around it, empty seats as placeholders. Leave is
 * bottom left, Ready (players) or Start (DM) bottom right. When more players
 * join than fit around the DM, the DM's card goes wide to the top and the
 * players stack below it.
 */
export function Lobby({ game, session, myId }: { game: Game; session: SessionState; myId: string }) {
  const isHost = session.host.id === myId;
  const me = session.players.find((p) => p.user.id === myId);
  const players = session.players;
  const total = players.length;
  const readyCount = players.filter((p) => p.ready).length;
  const allReady = total > 0 && readyCount === total;
  const room = useSeatRoom();
  /** DM: planning the campaign from the lobby. */
  const [configuring, setConfiguring] = useState(false);
  if (isHost && configuring) {
    return <CampaignConfig game={game} campaign={session.campaign} onBack={() => setConfiguring(false)} />;
  }

  // Around the DM: four seats in two rows, or seven in three once the fifth player joins.
  // Seats are as tall as the screen allows (a portrait at best); when they would get
  // too squat, or an eighth player joins, the DM moves to the top and players stack below.
  const rows = total <= 4 ? 2 : 3;
  const roomPerSeat = (room.height - (rows - 1) * GAP) / rows;
  const stacked = total > AROUND.length || roomPerSeat < room.seatWidth * 1.15;
  const seats = stacked ? Math.ceil((total + 1) / 3) * 3 : rows === 2 ? 4 : 7;
  const seatHeight = Math.min(roomPerSeat, room.seatWidth * 1.5);

  const start = () => {
    if (!allReady) {
      const msg =
        total === 0
          ? t('No players have joined yet. Start anyway?')
          : t('Only {ready} of {total} players are ready. Start anyway?', { ready: readyCount, total });
      if (!window.confirm(msg)) return;
    }
    void game.start();
  };
  const leave = () => {
    if (isHost) {
      if (window.confirm(t('Close the lobby for everyone? All characters stay saved.'))) void game.end();
    } else if (window.confirm(t('Leave the lobby?'))) {
      void game.leave();
    }
  };

  return (
    <div className="lobby">
      <div className="lobby-head">
        <h2 className="lobby-title">{session.campaign.name}</h2>
        <span className={`muted small ${allReady ? 'ok-text' : ''}`} role="status">
          {total === 0 ? t('Waiting for players…') : allReady ? t('Everyone is ready') : t('{ready}/{total} ready', { ready: readyCount, total })}
        </span>
      </div>

      <div className={`lobby-grid ${stacked ? 'stacked' : 'around'}`} style={stacked ? undefined : { gridAutoRows: `${Math.round(seatHeight)}px` }}>
        <section className={`lobby-dm ${session.host.online ? '' : 'away'}`} aria-label={t('Dungeon Master')}>
          <div className="lobby-dm-part">
            <Crown />
            <span className="lobby-dm-label">{t('Dungeon Master')}</span>
            <strong className="lobby-dm-name">
              {session.host.username}
              {isHost && <span className="muted small"> {t('(you)')}</span>}
            </strong>
            {!session.host.online && <span className="muted small">{t('reconnecting…')}</span>}
          </div>
          <div className="lobby-dm-part">
            <span className="lobby-dm-label">{isHost ? t('Players join with') : t('Session code')}</span>
            <span className="lobby-code" aria-label={t('Session code')}>{session.code}</span>
            {isHost && (
              <button type="button" className="secondary lobby-configure" onClick={() => setConfiguring(true)}>
                {t('⚙ Configure')}
              </button>
            )}
          </div>
        </section>
        {Array.from({ length: seats }, (_, i) => {
          const at = stacked ? undefined : AROUND[i];
          const style: CSSProperties | undefined = at && { gridColumn: at.col, gridRow: at.row };
          const p = players[i];
          return p ? <Seat key={p.user.id} player={p} isMe={p.user.id === myId} style={style} /> : <div key={`free-${i}`} className="lobby-slot empty" style={style} aria-label={t('Free seat')}>+</div>;
        })}
      </div>

      {me &&
        (me.ready ? (
          <p className="muted small center mt">{t('Waiting for the DM to start the session.')}</p>
        ) : (
          <p className="muted small center mt hint">{t('Tap Ready when you are set.')}</p>
        ))}
      {isHost && total === 0 && <p className="muted small center mt hint">{t('Tell your players the code. They pick a character and sit down here.')}</p>}
      {isHost && <Recap game={game} campaign={session.campaign} />}

      <div className="lobby-bar">
        <button type="button" className="lobby-leave" aria-label={isHost ? t('Close the lobby') : t('Leave the lobby')} onClick={leave}>✕</button>
        {isHost ? (
          <button type="button" className={`primary lobby-go ${allReady ? 'pulse' : 'dim'}`} onClick={start}>
            <span>{t('Start')} <span aria-hidden>›</span></span>
          </button>
        ) : (
          me && (
            <button type="button" className={`primary lobby-go ${me.ready ? 'is-ready' : ''}`} aria-pressed={me.ready} onClick={() => void game.setReady(!me.ready)}>
              {me.ready ? t('Ready ✓') : t('Ready')}
              {me.ready && <span className="lobby-go-sub hint">{t('tap to undo')}</span>}
            </button>
          )
        )}
      </div>
    </div>
  );
}

function Seat({ player, isMe, style }: { player: SessionPlayer; isMe: boolean; style?: CSSProperties }) {
  const c = player.character;
  return (
    <div className={`lobby-slot ${player.ready ? 'ready' : ''} ${player.online ? '' : 'away'}`} style={style}>
      <Portrait characterId={player.characterId} character={c} className="lobby-art" />
      <span className="lobby-shade" aria-hidden />
      {isMe && <span className="party-you">{t('You')}</span>}
      <span className="lobby-info">
        <span className="lobby-name">{c.name || player.user.username}</span>
        <span className="lobby-player">{player.user.username}</span>
        <span className="lobby-sub">{[tx(c.className), t('Lv {n}', { n: c.level })].filter(Boolean).join(' · ')}</span>
        <span className="lobby-ready">{!player.online ? t('Offline') : player.ready ? t('Ready ✓') : t('Not ready')}</span>
      </span>
    </div>
  );
}

function Crown() {
  return (
    <svg className="lobby-crown" viewBox="0 0 48 32" aria-hidden>
      <path d="M4 28h40M6 24 3 8l11 9L24 3l10 14 11-9-3 16z" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
