import { useEffect, useRef } from 'react';
import type { SessionState } from '@dnd/shared';
import { RollToasts } from '../Dice.tsx';
import { DmParty } from '../PartyGrid.tsx';
import { usePrep } from '../prep/usePrep.ts';
import type { Game } from '../useGame.ts';
import { DmFight, DmToolbox } from './DmTools.tsx';
import { Page } from './Page.tsx';
import { SessionDrawer } from './SessionDrawer.tsx';
import { usePager } from './usePager.ts';

/**
 * The DM's screen during a running session. Like the players', three pages
 * side by side, changed by swiping (or the pill at the bottom):
 *
 *   Fight  ‹  Party  ›  Tools
 *
 * Party is only the portrait cards (tap one for that sheet). Fight holds
 * everything about a fight, starting with "Initiate fight". Tools holds
 * handouts, NPCs, the log and what concerns the whole party (rests, level-ups).
 * Campaign, session code and "End session" are in the drawer on the left.
 */
export function DmSession({ game, session, myId }: { game: Game; session: SessionState; myId: string }) {
  const { page, setPage, position, dragging } = usePager(-1);
  const prep = usePrep(game, session.campaign.id);
  const combat = session.combat;

  // Starting a fight brings the fight page up; ending it goes back to the party.
  const hadFight = useRef(combat !== null);
  useEffect(() => {
    if (!hadFight.current && combat) setPage(-1);
    if (hadFight.current && !combat) setPage((p) => (p === -1 ? 0 : p));
    hadFight.current = combat !== null;
  }, [combat, setPage]);

  const active = combat?.combatants.find((c) => c.id === combat.activeId);
  const fightAt = Math.max(-1, Math.min(0, position)); // -1 = fight page fully shown
  const toolsAt = Math.max(0, Math.min(1, position)); // 1 = tools page fully shown

  return (
    <>
      <SessionDrawer game={game} title={session.campaign.name}>
        {() => (
          <>
            <p className="muted small drawer-label">Campaign</p>
            <p className="drawer-campaign">{session.campaign.name}</p>
            <p className="muted small drawer-label">Session code</p>
            <p className="drawer-code" aria-label="Session code">{session.code}</p>
            <p className="muted small hint">Late players can still join with this code.</p>
            <div className="drawer-spacer" />
            <button
              className="ghost danger"
              onClick={() => {
                if (window.confirm('End the session for everyone? All characters stay saved.')) void game.end();
              }}
            >
              End session
            </button>
          </>
        )}
      </SessionDrawer>

      <div className="dm-page">
        <DmParty game={game} session={session} myId={myId} />
      </div>
      {/* Rolls from the players' dice roller, whatever page is open. */}
      <RollToasts rolls={game.rolls} />

      <Page side="left" shown={-fightAt} dragging={dragging} open={page === -1}>
        <div className="party-panel-head">
          <h2 className="party-title grow">Fight</h2>
          <button type="button" className="link back-link" onClick={() => setPage(0)}>Party ›</button>
        </div>
        <div className="fight-page">
          <DmFight game={game} session={session} prep={prep} />
        </div>
      </Page>
      <Page side="right" shown={toolsAt} dragging={dragging} open={page === 1}>
        <div className="party-panel-head">
          <button type="button" className="link back-link" onClick={() => setPage(0)}>‹ Party</button>
          <h2 className="party-title grow">Tools</h2>
          <span className="muted small">{session.campaign.name}</span>
        </div>
        <div className="fight-page">
          <DmToolbox game={game} session={session} prep={prep} active={page === 1} />
        </div>
      </Page>

      <nav className="pager" aria-label="Pages">
        <button
          type="button"
          className={`pager-tab ${page === -1 ? 'on' : ''} ${combat && page !== -1 ? 'live' : ''}`}
          aria-pressed={page === -1}
          onClick={() => setPage(-1)}
        >
          ‹ {combat && page !== -1 && active ? `Fight · ${active.name}` : 'Fight'}
        </button>
        <button type="button" className={`pager-tab ${page === 0 ? 'on' : ''}`} aria-pressed={page === 0} onClick={() => setPage(0)}>Party</button>
        <button
          type="button"
          className={`pager-tab ${page === 1 ? 'on' : ''}`}
          aria-pressed={page === 1}
          onClick={() => setPage(1)}
        >
          Tools{session.handout && page !== 1 ? ' 📜' : ''} ›
        </button>
      </nav>
    </>
  );
}
