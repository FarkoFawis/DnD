import type { SessionState } from '@dnd/shared';
import { Lobby } from './Lobby.tsx';
import { DmSession } from './session/DmSession.tsx';
import { FightAlert } from './session/FightAlert.tsx';
import { PlayerSession } from './session/PlayerSession.tsx';
import { RestAlert } from './session/RestAlert.tsx';
import type { Game } from './useGame.ts';

export function SessionView({ game, session, myId }: { game: Game; session: SessionState; myId: string }) {
  const isHost = session.host.id === myId;
  const me = session.players.find((p) => p.user.id === myId);
  // A rest for one character is shown to that player and to the DM who called it.
  const rest = game.restAlert;
  const restForMe = rest && (!rest.characterId || isHost || rest.characterId === me?.characterId) ? rest : null;
  const alerts = (
    <>
      <FightAlert count={game.fightAlerts} />
      <RestAlert count={restForMe?.n ?? 0} rest={restForMe?.rest ?? 'long'} />
    </>
  );

  if (isHost && session.started) {
    return (
      <>
        {alerts}
        <DmSession game={game} session={session} myId={myId} />
      </>
    );
  }
  if (session.started && me) {
    return (
      <>
        {alerts}
        <PlayerSession game={game} session={session} me={me} />
      </>
    );
  }

  return (
    <>
      {alerts}
      <Lobby game={game} session={session} myId={myId} />
    </>
  );
}
