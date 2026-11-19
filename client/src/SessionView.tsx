import type { SessionState } from '@dnd/shared';
import { Lobby } from './Lobby.tsx';
import { DmSession } from './session/DmSession.tsx';
import { FightAlert } from './session/FightAlert.tsx';
import { PlayerSession } from './session/PlayerSession.tsx';
import type { Game } from './useGame.ts';

export function SessionView({ game, session, myId }: { game: Game; session: SessionState; myId: string }) {
  const isHost = session.host.id === myId;
  const me = session.players.find((p) => p.user.id === myId);

  if (isHost && session.started) {
    return (
      <>
        <FightAlert count={game.fightAlerts} />
        <DmSession game={game} session={session} myId={myId} />
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
      <Lobby game={game} session={session} myId={myId} />
    </>
  );
}
