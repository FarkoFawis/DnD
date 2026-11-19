import { useEffect, useRef, useState } from 'react';
import type { Combat, SessionPlayer, SessionState } from '@dnd/shared';
import { ClassicSheet } from '../ClassicSheet.tsx';
import { PartyGrid } from '../PartyGrid.tsx';
import { Portrait } from '../Portrait.tsx';
import { sheetActions } from '../Sheet.tsx';
import type { Game } from '../useGame.ts';
import { Page } from './Page.tsx';
import { SessionDrawer } from './SessionDrawer.tsx';
import { usePager } from './usePager.ts';

/**
 * A player's screen during a running session. Three pages side by side,
 * changed by swiping (or the pill at the bottom):
 *
 *   Fight (only while one runs)  ‹  My sheet  ›  Party
 *
 * The sheet shows nothing but the character. Session info and "Leave" are in
 * the drawer on the left; a handout the DM shows covers everything until closed.
 */
export function PlayerSession({ game, session, me }: { game: Game; session: SessionState; me: SessionPlayer }) {
  const combat = session.combat;
  const pager = usePager(combat ? -1 : 0);
  const { page, setPage, position, dragging } = pager;

  // "Initiate fight" brings the fight page up; when it ends, back to the sheet.
  const hadFight = useRef(combat !== null);
  useEffect(() => {
    if (!hadFight.current && combat) setPage(-1);
    hadFight.current = combat !== null;
  }, [combat, setPage]);

  const active = combat?.combatants.find((c) => c.id === combat.activeId);
  const myTurn = !!active && active.kind === 'player' && active.ref === me.characterId;

  // The handout pops up whenever the DM shows one; closed ones reopen from the drawer.
  const handout = session.handout;
  const [closedAt, setClosedAt] = useState<number | null>(null);
  const handoutOpen = handout !== null && closedAt !== handout.shownAt;

  const fightAt = Math.max(-1, Math.min(0, position)); // -1 = fight page fully shown
  const partyAt = Math.max(0, Math.min(1, position)); // 1 = party page fully shown

  return (
    <>
      <SessionDrawer game={game} title={session.campaign.name} attention={handout !== null && !handoutOpen}>
        {(close) => (
          <>
            <p className="muted small drawer-label">Campaign</p>
            <p className="drawer-campaign">{session.campaign.name}</p>
            <p className="muted small drawer-label">Dungeon Master</p>
            <p className="drawer-campaign">
              {session.host.username}
              {!session.host.online && <span className="muted small"> (reconnecting…)</span>}
            </p>
            <p className="muted small drawer-label">Playing as</p>
            <p className="drawer-campaign">{me.character.name} <span className="muted small">· {me.user.username}</span></p>
            <p className="muted small drawer-label">Session code</p>
            <p className="drawer-code small-code" aria-label="Session code">{session.code}</p>
            {handout && (
              <>
                <p className="muted small drawer-label">From the DM</p>
                <button
                  className="secondary drawer-action"
                  onClick={() => {
                    setClosedAt(null);
                    close();
                  }}
                >
                  📜 {handout.title}
                </button>
              </>
            )}
            <div className="drawer-spacer" />
            <button
              className="ghost"
              onClick={() => {
                if (window.confirm('Leave the session? Your character stays saved.')) void game.leave();
              }}
            >
              Leave session
            </button>
          </>
        )}
      </SessionDrawer>

      <ClassicSheet
        key={me.characterId}
        character={me.character}
        actions={sheetActions(game, me.characterId)}
        playerName={me.user.username}
        portrait={<Portrait characterId={me.characterId} character={me.character} />}
      />

      {combat && (
        <Page side="left" shown={-fightAt} dragging={dragging} open={page === -1}>
          <div className="party-panel-head">
            <h2 className="party-title grow">Fight</h2>
            <button type="button" className="link back-link" onClick={() => setPage(0)}>My sheet ›</button>
          </div>
          <FightPage combat={combat} myCharacterId={me.characterId} />
        </Page>
      )}
      <Page side="right" shown={partyAt} dragging={dragging} open={page === 1}>
        <div className="party-panel-head">
          <button type="button" className="link back-link" onClick={() => setPage(0)}>‹ My sheet</button>
          <h2 className="party-title grow">Party</h2>
          <span className="muted small">{session.campaign.name}</span>
        </div>
        <PartyGrid players={session.players} myId={me.user.id} />
      </Page>

      <nav className="pager" aria-label="Pages">
        {combat && (
          <button
            type="button"
            className={`pager-tab ${page === -1 ? 'on' : ''} ${myTurn && page !== -1 ? 'alert' : ''}`}
            aria-pressed={page === -1}
            onClick={() => setPage(-1)}
          >
            ‹ {myTurn ? 'Your turn!' : 'Fight'}
          </button>
        )}
        <button type="button" className={`pager-tab ${page === 0 ? 'on' : ''}`} aria-pressed={page === 0} onClick={() => setPage(0)}>My sheet</button>
        <button type="button" className={`pager-tab ${page === 1 ? 'on' : ''}`} aria-pressed={page === 1} onClick={() => setPage(1)}>Party ›</button>
      </nav>

      {handout && handoutOpen && (
        <div className="handout-overlay" role="dialog" aria-modal aria-label={handout.title}>
          <div className="handout-scroll">
            <h2 className="handout-title">{handout.title}</h2>
            {handout.imageUrl && <img className="handout-image" src={handout.imageUrl} alt={handout.title} />}
            {handout.text && <p className="handout-text">{handout.text}</p>}
          </div>
          <button className="primary handout-close" onClick={() => setClosedAt(handout.shownAt)}>Close</button>
        </div>
      )}
    </>
  );
}

/** Everything about the fight, for a player: whose turn it is and the order of everyone in it. */
function FightPage({ combat, myCharacterId }: { combat: Combat; myCharacterId: string }) {
  const order = combat.combatants;
  const rolled = order.some((c) => c.initiative !== null);
  const i = order.findIndex((c) => c.id === combat.activeId);
  const active = i >= 0 ? order[i] : undefined;
  const next = i >= 0 && order.length > 1 ? order[(i + 1) % order.length] : undefined;
  const isMe = (c: { kind: string; ref: string } | undefined) => !!c && c.kind === 'player' && c.ref === myCharacterId;
  return (
    <div className="fight-page">
      <p className={`fight-status ${isMe(active) ? 'mine' : ''}`} role="status">
        {isMe(active)
          ? "It's your turn!"
          : active
            ? `${active.name}'s turn`
            : rolled
              ? 'The DM is about to start the first turn.'
              : 'Roll for initiative!'}
        <span className="muted small block">
          {active ? `Round ${combat.round}` : 'Your DM rolls for everyone, or asks you for your roll.'}
          {next && !isMe(active) && (isMe(next) ? ' · You are next' : ` · Next: ${next.name}`)}
        </span>
      </p>
      <h3 className="section-label">Turn order</h3>
      <ol className="turn-list">
        {order.map((c) => (
          <li key={c.id} className={`turn-row ${c.id === combat.activeId ? 'active' : ''} ${c.kind} ${isMe(c) ? 'me' : ''}`}>
            <span className="turn-init">{c.initiative ?? '–'}</span>
            <span className="grow">
              {c.name}
              {isMe(c) && <span className="muted small"> (you)</span>}
            </span>
            {c.id === combat.activeId && <span className="badge">Turn</span>}
          </li>
        ))}
      </ol>
    </div>
  );
}
