import { useEffect, useRef } from 'react';
import type { SessionState } from '@dnd/shared';
import { Lobby } from './Lobby.tsx';
import { DmSession } from './session/DmSession.tsx';
import { FightAlert } from './session/FightAlert.tsx';
import { MomentLayer } from './session/MomentAlert.tsx';
import { announce } from './session/moments.ts';
import { PlayerSession } from './session/PlayerSession.tsx';
import { RestAlert } from './session/RestAlert.tsx';
import type { Game } from './useGame.ts';

export function SessionView({ game, session, myId }: { game: Game; session: SessionState; myId: string }) {
  const isHost = session.host.id === myId;
  const me = session.players.find((p) => p.user.id === myId);
  // A rest for one character is shown to that player and to the DM who called it.
  const rest = game.restAlert;
  const restForMe = rest && (!rest.characterId || isHost || rest.characterId === me?.characterId) ? rest : null;
  // The DM started the session: every phone opens it with its title card.
  const started = game.startAlert;
  const seenStart = useRef(started?.n ?? 0);
  const campaignName = session.campaign.name;
  useEffect(() => {
    if (!started || started.n === seenStart.current) return;
    seenStart.current = started.n;
    announce({ tone: 'title', kicker: `Session ${started.session}`, title: campaignName, sub: started.session === 1 ? 'The adventure begins' : 'The adventure continues' });
  }, [started, campaignName]);
  // Heroic Inspiration from the DM: only that player's phone says so.
  const inspired = game.inspirationAlert;
  const seenInspired = useRef(inspired?.n ?? 0);
  const myCharacterId = me?.characterId;
  useEffect(() => {
    if (!inspired || inspired.n === seenInspired.current) return;
    seenInspired.current = inspired.n;
    if (inspired.characterId !== myCharacterId) return;
    navigator.vibrate?.(60);
    announce({ tone: 'star', kicker: 'Your DM awards you', title: 'Heroic Inspiration', sub: 'Give it up to reroll a die' });
  }, [inspired, myCharacterId]);
  const alerts = (
    <>
      <FightAlert count={game.fightAlerts} />
      <RestAlert count={restForMe?.n ?? 0} rest={restForMe?.rest ?? 'long'} />
      <MomentLayer />
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
