import { useEffect, useRef, useState } from 'react';
import type { Combat, Combatant, SessionPlayer, SessionState } from '@dnd/shared';
import { ClassicSheet } from '../ClassicSheet.tsx';
import { RollSheet } from '../Dice.tsx';
import { useContent } from '../content/useContent.ts';
import { useSettings } from '../settings.ts';
import { PartyGrid } from '../PartyGrid.tsx';
import { Portrait } from '../Portrait.tsx';
import { sheetActions } from '../Sheet.tsx';
import type { Game } from '../useGame.ts';
import { useChanges, useClosing } from '../fx/hooks.ts';
import { useCharacterFx } from '../fx/sheetFx.tsx';
import { Page } from './Page.tsx';
import { PagerPill } from './PagerPill.tsx';
import { SessionDrawer } from './SessionDrawer.tsx';
import { useFightMoments } from './moments.ts';
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

  // "Your turn" wherever the player is looking; a new round only on the Fight page.
  useFightMoments(combat, { myCharacterId: me.characterId, onFightPage: page === -1 });

  const active = combat?.combatants.find((c) => c.id === combat.activeId);
  const myTurn = !!active && active.kind === 'player' && active.ref === me.characterId;

  // The handout pops up whenever the DM shows one; closed ones reopen from the drawer.
  const handout = session.handout;
  const [closedAt, setClosedAt] = useState<number | null>(null);
  const handoutOpen = handout !== null && closedAt !== handout.shownAt;

  // Being hit, healed, casting, levelling up: the effects for this player's own character.
  const content = useContent();
  useCharacterFx(me.character, content);

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
          <div className="party-panel-head narrow">
            <h2 className="party-title grow">Fight</h2>
            <button type="button" className="link back-link" onClick={() => setPage(0)}>My sheet ›</button>
          </div>
          <FightPage combat={combat} me={me} game={game} />
        </Page>
      )}
      <Page side="right" shown={partyAt} dragging={dragging} open={page === 1}>
        <div className="party-panel-head">
          <button type="button" className="link back-link" onClick={() => setPage(0)}>‹ My sheet</button>
          <h2 className="party-title grow">Party</h2>
          <span className="muted small">{session.campaign.name}</span>
        </div>
        <PartyGrid players={session.players} myId={me.user.id} content={content} />
      </Page>

      <PagerPill
        page={page}
        position={position}
        dragging={dragging}
        onPage={setPage}
        tabs={[
          ...(combat ? [{ page: -1, label: `‹ ${myTurn ? 'Your turn!' : 'Fight'}`, className: myTurn && page !== -1 ? 'alert' : '' }] : []),
          { page: 0, label: 'My sheet' },
          { page: 1, label: 'Party ›' },
        ]}
      />

      {handout && handoutOpen && <HandoutOverlay key={handout.shownAt} handout={handout} onClose={() => setClosedAt(handout.shownAt)} />}
    </>
  );
}

/** What the DM is showing, over the whole screen until closed. It fades in and out. */
function HandoutOverlay({ handout, onClose }: { handout: NonNullable<SessionState['handout']>; onClose: () => void }) {
  const { closing, close } = useClosing(onClose, 200);
  return (
    <div className={`handout-overlay ${closing ? 'closing' : ''}`} role="dialog" aria-modal aria-label={handout.title}>
      <div className="handout-scroll">
        <h2 className="handout-title">{handout.title}</h2>
        {handout.imageUrl && <img className="handout-image" src={handout.imageUrl} alt={handout.title} />}
        {handout.text && <p className="handout-text">{handout.text}</p>}
      </div>
      <button className="primary handout-close" onClick={close}>Close</button>
    </div>
  );
}

/** Everything about the fight, for a player: whose turn it is and the order of everyone in it. */
function FightPage({ combat, me, game }: { combat: Combat; me: SessionPlayer; game: Game }) {
  const myCharacterId = me.characterId;
  const order = combat.combatants;
  const rolled = order.some((c) => c.initiative !== null);
  const i = order.findIndex((c) => c.id === combat.activeId);
  const active = i >= 0 ? order[i] : undefined;
  const next = i >= 0 && order.length > 1 ? order[(i + 1) % order.length] : undefined;
  const isMe = (c: { kind: string; ref: string } | undefined) => !!c && c.kind === 'player' && c.ref === myCharacterId;
  // With the dice roller on, players can roll their own initiative; it goes straight into the order.
  const { dice } = useSettings();
  const content = useContent();
  const [rolling, setRolling] = useState(false);
  const mine = order.find(isMe);
  const canRoll = dice && !!mine && mine.initiative === null;
  return (
    <div className="fight-page">
      {/* Keyed by whose turn it is: the line comes in anew with every turn. */}
      <p key={active?.id ?? 'none'} className={`fight-status ${isMe(active) ? 'mine' : ''}`} role="status">
        {isMe(active)
          ? "It's your turn!"
          : active
            ? `${active.name}'s turn`
            : rolled
              ? 'The DM is about to start the first turn.'
              : 'Roll for initiative!'}
        {active ? (
          <span className="muted small block">
            Round {combat.round}
            {next && !isMe(active) && (isMe(next) ? ' · You are next' : ` · Next: ${next.name}`)}
          </span>
        ) : (
          <span className="muted small block hint">Your DM rolls for everyone, or asks you for your roll.</span>
        )}
      </p>
      {(canRoll || rolling) && (
        <button type="button" className="primary roll-initiative" disabled={!canRoll} onClick={() => setRolling(true)}>
          Roll my initiative
        </button>
      )}
      {rolling && (
        <RollSheet
          character={me.character}
          content={content}
          request={{ kind: 'initiative' }}
          roll={(req, mode) => game.roll(myCharacterId, req, mode)}
          shared
          onClose={() => setRolling(false)}
        />
      )}
      <h3 className="section-label">Turn order</h3>
      <ol className="turn-list">
        {order.map((c) => (
          <TurnRow key={c.id} c={c} active={c.id === combat.activeId} me={isMe(c)} />
        ))}
      </ol>
    </div>
  );
}

/** One line of the turn order. An opponent the DM keeps hidden has no name yet; it turns over when revealed. */
function TurnRow({ c, active, me }: { c: Combatant; active: boolean; me: boolean }) {
  const hidden = c.hidden === true;
  const flips = useChanges(hidden);
  return (
    <li className={`turn-row ${active ? 'active' : ''} ${c.kind} ${me ? 'me' : ''} ${hidden ? 'masked' : ''}`}>
      <span className="turn-init">{c.initiative ?? '–'}</span>
      <span key={flips} className={`grow turn-who ${flips > 0 && !hidden ? 'revealed' : ''}`}>
        {hidden ? (
          <>
            <span className="turn-mark" aria-hidden>?</span>
            <span className="muted">Unknown</span>
          </>
        ) : (
          c.name
        )}
        {me && <span className="muted small"> (you)</span>}
      </span>
      {active && <span className="badge">Turn</span>}
    </li>
  );
}
